"""
# ============================================================
# ApplyPatch 服务 (v1.0.0)
# Cycle 68 G68-02
# ============================================================
# 核心作用：多文件原子编辑服务（apply_patch V4A grammar）
#           解析 → 校验 → 预览 → 事务性应用
# 运行流程：
#   1. parse(text)              → List[PatchOp]
#   2. validate(ops, root)      → ValidationResult
#   3. preview(ops, root)       → List[FileDiff]
#   4. apply(text, root, force) → ApplyResult (含 snapshot)
# 设计要点：
#   - V4A grammar 支持 Update / Add / Delete
#   - hunk 解析：@@ 标记 + context/remove/add 行
#   - hash 校验：expected vs actual（force 跳过）
#   - 事务性：失败自动回滚 + snapshot 备份
#   - 路径安全：拒绝 ..、绝对路径越权
#   - 性能：<500ms/10 文件（小文件场景）
# 输入参数：V4A patch 文本、项目根路径
# 输出结果：解析后的 ops、校验结果、preview diff、apply result
# 对标：Codex `codex-rs/apply_patch` (V4A grammar) +
#       Trae AST-aware transactional edits
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 68 G68-02 初次创建
# ====================================
"""

import difflib
import hashlib
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .file_storage import (
    FileNotFoundError,
    FileStorage,
    FileTooLargeError,
    PathNotAllowedError,
    compute_hash,
    get_file_storage,
)

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================


# V4A 语法标记
BEGIN_PATCH = "*** Begin Patch"
END_PATCH = "*** End Patch"
UPDATE_FILE = "*** Update File:"
ADD_FILE = "*** Add File:"
DELETE_FILE = "*** Delete File:"

# Patch 大小限制
MAX_PATCH_SIZE = 100 * 1024 * 1024  # 100MB
MAX_FILES_PER_PATCH = 50
MAX_HUNK_PER_FILE = 200

# 解析时间限制
MAX_PARSE_TIME_MS = 5000


# ============================================================
# 异常类型
# ============================================================


class ApplyPatchError(Exception):
    """apply_patch 基础异常"""
    pass


class PatchParseError(ApplyPatchError):
    """V4A 语法错误"""
    def __init__(self, message: str, line: int = 0):
        super().__init__(message)
        self.line = line


class PatchTooLargeError(ApplyPatchError):
    """patch 过大"""
    pass


class TooManyFilesError(ApplyPatchError):
    """patch 涉及文件数超过限制"""
    pass


class ConflictsDetectedError(ApplyPatchError):
    """hash 校验冲突"""
    def __init__(self, conflicts: List["Conflict"]):
        super().__init__(f"conflicts detected: {len(conflicts)}")
        self.conflicts = conflicts


class ApplyFailedError(ApplyPatchError):
    """应用过程中失败"""
    def __init__(self, message: str, op: Optional["PatchOp"] = None):
        super().__init__(message)
        self.failed_op = op


# ============================================================
# 数据模型
# ============================================================


class OpType(str, Enum):
    UPDATE = "update"
    ADD = "add"
    DELETE = "delete"


@dataclass
class HunkLine:
    """hunk 中的单行"""
    type: str  # context | add | remove
    content: str


@dataclass
class Hunk:
    """单个 hunk"""
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: List[HunkLine] = field(default_factory=list)


@dataclass
class PatchOp:
    """patch 中的单个文件操作"""
    type: OpType
    path: str
    hunks: List[Hunk] = field(default_factory=list)
    content: str = ""  # 仅 add 操作
    expected_hash: str = ""  # 仅 update 操作（可选）

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "type": self.type.value,
            "path": self.path,
        }
        if self.type == OpType.UPDATE:
            result["hunks"] = len(self.hunks)
            if self.expected_hash:
                result["expected_hash"] = self.expected_hash
        elif self.type == OpType.ADD:
            result["content_length"] = len(self.content)
        return result


@dataclass
class Conflict:
    """hash 校验冲突"""
    file: str
    expected_hash: str
    actual_hash: str
    op_type: str
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file": self.file,
            "expected_hash": self.expected_hash,
            "actual_hash": self.actual_hash,
            "op_type": self.op_type,
            "reason": self.reason,
        }


@dataclass
class FileDiff:
    """单个文件的 diff"""
    file: str
    type: str
    before_hash: str
    after_hash: str
    diff: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file": self.file,
            "type": self.type,
            "before_hash": self.before_hash,
            "after_hash": self.after_hash,
            "diff": self.diff,
        }


@dataclass
class ParseResult:
    """解析结果"""
    valid: bool
    ops: List[PatchOp] = field(default_factory=list)
    error: str = ""
    error_line: int = 0
    ops_count: int = 0
    files: List[str] = field(default_factory=list)
    file_hashes: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "ops": [op.to_dict() for op in self.ops],
            "ops_count": self.ops_count,
            "files": self.files,
            "file_hashes": self.file_hashes,
            "error": self.error,
            "error_line": self.error_line,
        }


@dataclass
class ValidationResult:
    """校验结果"""
    safe: bool
    conflicts: List[Conflict] = field(default_factory=list)
    diffs: List[FileDiff] = field(default_factory=list)
    ops_count: int = 0
    error: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "safe": self.safe,
            "conflicts": [c.to_dict() for c in self.conflicts],
            "diffs": [d.to_dict() for d in self.diffs],
            "ops_count": self.ops_count,
            "error": self.error,
        }


@dataclass
class ApplyResult:
    """应用结果"""
    success: bool
    snapshot_id: Optional[str] = None
    applied_ops: int = 0
    duration_ms: int = 0
    error: str = ""
    failed_op: Optional[Dict[str, Any]] = None
    rolled_back: bool = False
    diffs: List[FileDiff] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "snapshot_id": self.snapshot_id,
            "applied_ops": self.applied_ops,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "failed_op": self.failed_op,
            "rolled_back": self.rolled_back,
            "diffs": [d.to_dict() for d in self.diffs],
        }


# ============================================================
# V4A Parser
# ============================================================


class V4AParser:
    """
    V4A grammar parser
    支持：
      *** Begin Patch
      *** Update File: path
      @@
       context
      -removed
      +added
      *** Add File: path
      +content
      *** Delete File: path
      *** End Patch
    """

    def __init__(self, max_ops: int = MAX_FILES_PER_PATCH):
        self._max_ops = max_ops

    def parse(self, text: str) -> ParseResult:
        """
        解析 V4A 文本
        时间复杂度：O(n)，n = 字符数
        空间复杂度：O(m)，m = ops 数
        """
        if not text or not text.strip():
            return ParseResult(
                valid=False,
                error="empty patch",
            )
        if len(text) > MAX_PATCH_SIZE:
            return ParseResult(
                valid=False,
                error=f"patch too large ({len(text)} > {MAX_PATCH_SIZE})",
            )

        lines = text.split("\n")
        ops: List[PatchOp] = []
        current_op: Optional[PatchOp] = None
        in_hunk = False
        current_hunk: Optional[Hunk] = None
        in_patch = False
        seen_begin = False
        seen_end = False

        for i, raw_line in enumerate(lines):
            line_no = i + 1
            stripped = raw_line.rstrip("\r")

            if stripped == BEGIN_PATCH:
                if seen_begin:
                    return ParseResult(
                        valid=False,
                        error=f"duplicate Begin Patch at line {line_no}",
                        error_line=line_no,
                    )
                seen_begin = True
                in_patch = True
                continue

            if stripped == END_PATCH:
                if not seen_begin:
                    return ParseResult(
                        valid=False,
                        error=f"End Patch without Begin at line {line_no}",
                        error_line=line_no,
                    )
                if current_op is not None and in_hunk:
                    # 收尾最后一个 hunk
                    if current_hunk is not None:
                        current_op.hunks.append(current_hunk)
                    in_hunk = False
                    current_hunk = None
                if current_op is not None:
                    ops.append(current_op)
                    current_op = None
                seen_end = True
                in_patch = False
                continue

            if not in_patch:
                # Begin 之前的行忽略
                continue

            # Update / Add / Delete 文件标记
            if stripped.startswith(UPDATE_FILE):
                # 收尾上一个 op 的 hunk
                if current_op is not None:
                    if in_hunk and current_hunk is not None:
                        current_op.hunks.append(current_hunk)
                    ops.append(current_op)
                path = stripped[len(UPDATE_FILE):].strip()
                if not path:
                    return ParseResult(
                        valid=False,
                        error=f"empty path in Update File at line {line_no}",
                        error_line=line_no,
                    )
                current_op = PatchOp(type=OpType.UPDATE, path=path)
                in_hunk = False
                current_hunk = None
                continue

            if stripped.startswith(ADD_FILE):
                # 收尾上一个 op 的 hunk
                if current_op is not None:
                    if in_hunk and current_hunk is not None:
                        current_op.hunks.append(current_hunk)
                    ops.append(current_op)
                path = stripped[len(ADD_FILE):].strip()
                if not path:
                    return ParseResult(
                        valid=False,
                        error=f"empty path in Add File at line {line_no}",
                        error_line=line_no,
                    )
                current_op = PatchOp(type=OpType.ADD, path=path)
                in_hunk = False
                current_hunk = None
                continue

            if stripped.startswith(DELETE_FILE):
                # 收尾上一个 op 的 hunk
                if current_op is not None:
                    if in_hunk and current_hunk is not None:
                        current_op.hunks.append(current_hunk)
                    ops.append(current_op)
                path = stripped[len(DELETE_FILE):].strip()
                if not path:
                    return ParseResult(
                        valid=False,
                        error=f"empty path in Delete File at line {line_no}",
                        error_line=line_no,
                    )
                current_op = PatchOp(type=OpType.DELETE, path=path)
                in_hunk = False
                current_hunk = None
                continue

            # hunk 起始标记（支持完整 header 或裸 @@）
            if stripped.startswith("@@"):
                if current_op is None:
                    return ParseResult(
                        valid=False,
                        error=f"@@ without file header at line {line_no}",
                        error_line=line_no,
                    )
                if current_op.type != OpType.UPDATE:
                    return ParseResult(
                        valid=False,
                        error=f"@@ only allowed in Update File (line {line_no})",
                        error_line=line_no,
                    )
                in_hunk = True
                if stripped == "@@":
                    # 裸 @@：使用默认行号（1-based，继续上一 hunk）
                    if current_hunk is not None:
                        # 收尾上一个 hunk
                        current_op.hunks.append(current_hunk)
                    current_hunk = Hunk(
                        old_start=1,
                        old_count=1,
                        new_start=1,
                        new_count=1,
                    )
                else:
                    hunk_header = self._parse_hunk_header(stripped)
                    if hunk_header is None:
                        return ParseResult(
                            valid=False,
                            error=f"invalid hunk header at line {line_no}: {stripped}",
                            error_line=line_no,
                        )
                    if current_hunk is not None:
                        current_op.hunks.append(current_hunk)
                    current_hunk = Hunk(
                        old_start=hunk_header[0],
                        old_count=hunk_header[1],
                        new_start=hunk_header[2],
                        new_count=hunk_header[3],
                    )
                continue

            # hunk 内容行 / add 文件内容行
            if current_op is None:
                return ParseResult(
                    valid=False,
                    error=f"unexpected content at line {line_no}: {stripped!r}",
                    error_line=line_no,
                )

            if current_op.type == OpType.UPDATE and in_hunk and current_hunk is not None:
                # hunk 行
                if stripped == "":
                    # 空行作为 context
                    current_hunk.lines.append(HunkLine(type="context", content=""))
                elif stripped.startswith(" "):
                    current_hunk.lines.append(HunkLine(type="context", content=stripped[1:]))
                elif stripped.startswith("-"):
                    current_hunk.lines.append(HunkLine(type="remove", content=stripped[1:]))
                elif stripped.startswith("+"):
                    current_hunk.lines.append(HunkLine(type="add", content=stripped[1:]))
                else:
                    # 非前缀行 → 视为 hunk 结束
                    if current_hunk is not None:
                        current_op.hunks.append(current_hunk)
                    in_hunk = False
                    current_hunk = None
            elif current_op.type == OpType.ADD:
                # add 文件的所有行都是 + 内容（无前缀）
                if stripped.startswith("+"):
                    current_op.content += stripped[1:] + "\n"
                else:
                    # add 文件允许无 + 前缀的纯内容行（兼容模式）
                    current_op.content += stripped + "\n"
            elif current_op.type == OpType.DELETE:
                # delete 文件忽略后续行
                continue

        # 收尾
        if not seen_begin:
            return ParseResult(
                valid=False,
                error="missing Begin Patch marker",
            )
        if not seen_end:
            return ParseResult(
                valid=False,
                error="missing End Patch marker",
            )
        if current_op is not None:
            if in_hunk and current_hunk is not None:
                current_op.hunks.append(current_hunk)
            ops.append(current_op)

        if len(ops) > self._max_ops:
            return ParseResult(
                valid=False,
                error=f"too many ops ({len(ops)} > {self._max_ops})",
            )

        files = [op.path for op in ops]

        return ParseResult(
            valid=True,
            ops=ops,
            ops_count=len(ops),
            files=files,
        )

    def _parse_hunk_header(self, line: str) -> Optional[Tuple[int, int, int, int]]:
        """
        解析 @@ -old_start,old_count +new_start,new_count @@
        返回 (old_start, old_count, new_start, new_count) 或 None
        """
        m = re.match(
            r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@",
            line,
        )
        if not m:
            return None
        old_start = int(m.group(1))
        old_count = int(m.group(2)) if m.group(2) else 1
        new_start = int(m.group(3))
        new_count = int(m.group(4)) if m.group(4) else 1
        return (old_start, old_count, new_start, new_count)


# ============================================================
# Hunk Apply（应用到原文件）
# ============================================================


def apply_hunks_to_text(original: str, hunks: List[Hunk]) -> str:
    """
    将 hunks 应用到原始文本，返回新文本
    时间复杂度：O(n + m)，n = 原文本行数，m = hunks 总行数
    """
    original_lines = original.split("\n")
    result_lines: List[str] = list(original_lines)

    # 倒序应用 hunk（避免行号错位）
    for hunk in reversed(hunks):
        start_idx = max(0, hunk.old_start - 1)
        new_segment: List[str] = []

        for hline in hunk.lines:
            if hline.type == "context":
                new_segment.append(hline.content)
            elif hline.type == "add":
                new_segment.append(hline.content)
            # remove 行不输出

        end_idx = start_idx + hunk.old_count
        result_lines = result_lines[:start_idx] + new_segment + result_lines[end_idx:]

    return "\n".join(result_lines)


# ============================================================
# ApplyPatchService
# ============================================================


class ApplyPatchService:
    """
    apply_patch 服务

    用法：
        service = get_apply_patch_service()
        result = service.parse(text)
        result = service.validate(text, root)
        diffs = service.preview(text, root)
        result = service.apply(text, root, force=False)
    """

    def __init__(
        self,
        file_storage: Optional[FileStorage] = None,
        snapshot_callback: Optional[Any] = None,
    ):
        """
        参数：
          - file_storage: FileStorage 实例
          - snapshot_callback: 可选回调 create_snapshot(paths, session_id) -> snapshot_id
        """
        self._fs = file_storage or get_file_storage()
        self._parser = V4AParser()
        self._snapshot_callback = snapshot_callback
        self._lock = __import__("threading").Lock()

    # ============================================================
    # 路径安全
    # ============================================================

    def _safe_path(self, root: str, rel_path: str) -> str:
        """
        拼接 root + rel_path，并校验合法性
        拒绝 ..、绝对路径
        """
        if not root or not rel_path:
            raise PathNotAllowedError("empty root or path")
        if rel_path.startswith("/"):
            raise PathNotAllowedError(f"absolute path not allowed: {rel_path}")
        # 规范化
        rel_clean = rel_path.replace("\\", "/")
        if ".." in rel_clean.split("/"):
            raise PathNotAllowedError(f"path traversal detected: {rel_path}")
        abs_path = (Path(root) / rel_clean).resolve()
        root_abs = Path(root).resolve()
        try:
            abs_path.relative_to(root_abs)
        except ValueError:
            raise PathNotAllowedError(f"path escapes root: {rel_path}")
        return str(abs_path)

    # ============================================================
    # Parse
    # ============================================================

    def parse(self, text: str) -> ParseResult:
        """仅解析 V4A 文本（不涉及文件）"""
        return self._parser.parse(text)

    # ============================================================
    # Validate
    # ============================================================

    def validate(
        self,
        text: str,
        root: str,
        force: bool = False,
    ) -> ValidationResult:
        """
        解析 + 校验 hash
        时间复杂度：O(n + m)，n=patch 字符数，m=涉及文件数
        """
        # 1. 解析
        parse_result = self._parser.parse(text)
        if not parse_result.valid:
            return ValidationResult(
                safe=False,
                ops_count=0,
                error=parse_result.error,
            )

        conflicts: List[Conflict] = []
        diffs: List[FileDiff] = []

        for op in parse_result.ops:
            try:
                abs_path = self._safe_path(root, op.path)
            except PathNotAllowedError as e:
                return ValidationResult(
                    safe=False,
                    ops_count=len(parse_result.ops),
                    error=f"path not allowed: {e}",
                )

            if op.type == OpType.UPDATE:
                try:
                    if not self._fs.exists(abs_path):
                        return ValidationResult(
                            safe=False,
                            ops_count=len(parse_result.ops),
                            error=f"file not found for update: {op.path}",
                        )
                    original = self._fs.read_text(abs_path)
                except (FileNotFoundError, FileTooLargeError) as e:
                    return ValidationResult(
                        safe=False,
                        ops_count=len(parse_result.ops),
                        error=f"read failed: {e}",
                    )

                before_hash = compute_hash(original.encode("utf-8"))

                # 应用 hunks
                try:
                    new_text = apply_hunks_to_text(original, op.hunks)
                except Exception as e:
                    return ValidationResult(
                        safe=False,
                        ops_count=len(parse_result.ops),
                        error=f"hunk apply failed: {e}",
                    )

                after_hash = compute_hash(new_text.encode("utf-8"))

                # hash 冲突检查
                if op.expected_hash and op.expected_hash != before_hash:
                    conflicts.append(Conflict(
                        file=op.path,
                        expected_hash=op.expected_hash,
                        actual_hash=before_hash,
                        op_type="update",
                        reason="expected_hash mismatch",
                    ))

                # 生成 unified diff
                diff_text = "\n".join(difflib.unified_diff(
                    original.splitlines(keepends=False),
                    new_text.splitlines(keepends=False),
                    fromfile=f"a/{op.path}",
                    tofile=f"b/{op.path}",
                    lineterm="",
                ))

                diffs.append(FileDiff(
                    file=op.path,
                    type="update",
                    before_hash=before_hash,
                    after_hash=after_hash,
                    diff=diff_text,
                ))

            elif op.type == OpType.ADD:
                original = ""
                before_hash = ""
                if self._fs.exists(abs_path):
                    if not force:
                        conflicts.append(Conflict(
                            file=op.path,
                            expected_hash="<not exist>",
                            actual_hash=compute_hash(b""),
                            op_type="add",
                            reason="file already exists",
                        ))
                    else:
                        # force 模式：覆盖
                        try:
                            original = self._fs.read_text(abs_path)
                            before_hash = compute_hash(original.encode("utf-8"))
                        except (FileNotFoundError, FileTooLargeError):
                            before_hash = ""

                after_hash = compute_hash(op.content.encode("utf-8"))

                # 生成 diff
                if before_hash:
                    diff_text = "\n".join(difflib.unified_diff(
                        original.splitlines(keepends=False),
                        op.content.splitlines(keepends=False),
                        fromfile=f"a/{op.path}",
                        tofile=f"b/{op.path}",
                        lineterm="",
                    ))
                else:
                    # 新增文件：完整 + 内容
                    diff_lines = [f"--- /dev/null", f"+++ b/{op.path}"]
                    for line in op.content.splitlines():
                        diff_lines.append(f"+{line}")
                    diff_text = "\n".join(diff_lines)

                diffs.append(FileDiff(
                    file=op.path,
                    type="add",
                    before_hash=before_hash,
                    after_hash=after_hash,
                    diff=diff_text,
                ))

            elif op.type == OpType.DELETE:
                if not self._fs.exists(abs_path):
                    if not force:
                        conflicts.append(Conflict(
                            file=op.path,
                            expected_hash="<exists>",
                            actual_hash="<missing>",
                            op_type="delete",
                            reason="file not found",
                        ))
                    before_hash = ""
                else:
                    try:
                        original = self._fs.read_text(abs_path)
                        before_hash = compute_hash(original.encode("utf-8"))
                    except (FileNotFoundError, FileTooLargeError):
                        before_hash = ""

                diff_lines = [f"--- a/{op.path}", f"+++ /dev/null"]
                if before_hash:
                    for line in original.splitlines():
                        diff_lines.append(f"-{line}")
                diff_text = "\n".join(diff_lines)

                diffs.append(FileDiff(
                    file=op.path,
                    type="delete",
                    before_hash=before_hash,
                    after_hash="",
                    diff=diff_text,
                ))

        # 计算 file_hashes（用于 preview）
        file_hashes: Dict[str, str] = {}
        for op in parse_result.ops:
            try:
                abs_path = self._safe_path(root, op.path)
                if self._fs.exists(abs_path):
                    file_hashes[op.path] = compute_hash(self._fs.read(abs_path))
            except (FileNotFoundError, FileTooLargeError, PathNotAllowedError):
                file_hashes[op.path] = ""

        # safe = 无冲突
        safe = len(conflicts) == 0
        if force:
            safe = True
            conflicts = []

        return ValidationResult(
            safe=safe,
            conflicts=conflicts,
            diffs=diffs,
            ops_count=len(parse_result.ops),
        )

    # ============================================================
    # Preview
    # ============================================================

    def preview(self, text: str, root: str) -> ValidationResult:
        """预览 patch（不应用）"""
        return self.validate(text, root, force=False)

    # ============================================================
    # Apply
    # ============================================================

    def apply(
        self,
        text: str,
        root: str,
        force: bool = False,
        create_snapshot: bool = True,
        session_id: Optional[str] = None,
    ) -> ApplyResult:
        """
        应用 patch（事务性）
        时间复杂度：O(m × f)，m=文件数，f=平均文件大小
        """
        start_time = time.time()
        # 1. 校验
        validation = self.validate(text, root, force=force)
        if not validation.safe:
            error_msg = validation.error or "conflicts_detected"
            return ApplyResult(
                success=False,
                applied_ops=0,
                duration_ms=int((time.time() - start_time) * 1000),
                error=error_msg,
                failed_op=(
                    {"conflicts": [c.to_dict() for c in validation.conflicts]}
                    if validation.conflicts else None
                ),
                rolled_back=False,
                diffs=validation.diffs,
            )

        parse_result = self._parser.parse(text)
        if not parse_result.valid:
            return ApplyResult(
                success=False,
                applied_ops=0,
                duration_ms=int((time.time() - start_time) * 1000),
                error=f"parse_error: {parse_result.error}",
            )

        # 2. 创建 snapshot（如果启用）
        snapshot_id: Optional[str] = None
        if create_snapshot and self._snapshot_callback is not None:
            try:
                paths = [self._safe_path(root, op.path) for op in parse_result.ops
                         if op.type in (OpType.UPDATE, OpType.DELETE)]
                snapshot_id = self._snapshot_callback(
                    paths=paths,
                    session_id=session_id or "apply-patch",
                )
            except Exception as e:
                logger.warning(f"snapshot creation failed: {e}")

        # 3. 备份原始内容（用于回滚）
        backups: Dict[str, bytes] = {}
        for op in parse_result.ops:
            try:
                abs_path = self._safe_path(root, op.path)
            except PathNotAllowedError as e:
                return ApplyResult(
                    success=False,
                    snapshot_id=snapshot_id,
                    applied_ops=0,
                    duration_ms=int((time.time() - start_time) * 1000),
                    error=f"path_not_allowed: {e}",
                    rolled_back=True,
                    diffs=validation.diffs,
                )

            if op.type in (OpType.UPDATE, OpType.DELETE):
                if abs_path in backups:
                    continue
                try:
                    if self._fs.exists(abs_path):
                        backups[abs_path] = self._fs.read(abs_path)
                except (FileNotFoundError, FileTooLargeError) as e:
                    return ApplyResult(
                        success=False,
                        snapshot_id=snapshot_id,
                        applied_ops=0,
                        duration_ms=int((time.time() - start_time) * 1000),
                        error=f"backup_failed: {e}",
                        rolled_back=True,
                        diffs=validation.diffs,
                    )

        # 4. 应用每个 op
        applied_count = 0
        try:
            for op in parse_result.ops:
                abs_path = self._safe_path(root, op.path)
                if op.type == OpType.UPDATE:
                    original = self._fs.read_text(abs_path)
                    new_text = apply_hunks_to_text(original, op.hunks)
                    self._fs.write(abs_path, new_text.encode("utf-8"))
                elif op.type == OpType.ADD:
                    # add 模式下若文件已存在且 force 则覆盖
                    content_bytes = op.content.encode("utf-8")
                    self._fs.write(abs_path, content_bytes)
                elif op.type == OpType.DELETE:
                    self._fs.delete(abs_path)
                applied_count += 1
        except Exception as e:
            # 5. 回滚
            logger.error(f"apply failed at op {applied_count}, rolling back: {e}")
            for path, content in backups.items():
                try:
                    self._fs.write(path, content)
                except Exception as rb_e:
                    logger.error(f"rollback failed for {path}: {rb_e}")

            # 找失败的 op
            failed_op: Optional[Dict[str, Any]] = None
            if applied_count < len(parse_result.ops):
                failed = parse_result.ops[applied_count]
                failed_op = {
                    "type": failed.type.value,
                    "file": failed.path,
                }

            return ApplyResult(
                success=False,
                snapshot_id=snapshot_id,
                applied_ops=applied_count,
                duration_ms=int((time.time() - start_time) * 1000),
                error=f"apply_failed: {e}",
                failed_op=failed_op,
                rolled_back=True,
                diffs=validation.diffs,
            )

        return ApplyResult(
            success=True,
            snapshot_id=snapshot_id,
            applied_ops=applied_count,
            duration_ms=int((time.time() - start_time) * 1000),
            diffs=validation.diffs,
        )

    # ============================================================
    # 状态查询
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """返回服务统计"""
        return {
            "max_files_per_patch": MAX_FILES_PER_PATCH,
            "max_patch_size": MAX_PATCH_SIZE,
            "max_hunk_per_file": MAX_HUNK_PER_FILE,
            "fs_config": self._fs.get_stats(),
        }


# ============================================================
# 全局单例
# ============================================================


_apply_patch_service: Optional[ApplyPatchService] = None


def get_apply_patch_service() -> ApplyPatchService:
    """获取全局 ApplyPatchService 实例"""
    global _apply_patch_service
    if _apply_patch_service is None:
        _apply_patch_service = ApplyPatchService()
    return _apply_patch_service


def reset_apply_patch_service() -> None:
    """重置全局实例（仅测试）"""
    global _apply_patch_service
    _apply_patch_service = None
