"""
# ============================================================
# DiffView 核心服务 - 多格式 diff + 快照 + 版本对比
# ============================================================
# 核心作用：增强 Git DiffView 能力，支持多格式 diff 输出、
#           文件快照管理、任意引用对比、暂存/取消暂存、
#           行内差异高亮、过滤搜索。
# 运行流程：
#   1. compare_files / compare_refs 生成多格式 diff
#   2. snapshot_create / snapshot_restore 管理工作区快照
#   3. stage_file / unstage_file 暂存控制
#   4. filter_by_status / search_by_path 提供筛选能力
# 输入参数：通过 DiffView 服务的各个方法参数
# 输出结果：标准化的 diff 数据结构（dict / dataclass）
# 设计原则：
#   - 零外部依赖（除 GitManager 已有 GitPython）
#   - 线程安全（threading.RLock）
#   - 路径白名单（必须位于已注册项目内）
#   - Pydantic 兼容的纯 dataclass 输出
# 创建日期：2026-07-28
# 模块版本：v1.0.0 - Cycle 9 P1-7
# ============================================================
"""

import hashlib
import json
import logging
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 常量与配置
# ============================================================

# 快照元数据目录名（存放于项目根 / .diffview / ）
SNAPSHOT_DIRNAME = ".diffview"
SNAPSHOT_META_FILE = "metadata.json"
SNAPSHOT_FILE_PREFIX = "snap_"

# 状态码
class DiffStatus(str, Enum):
    """文件 diff 状态码"""
    ADDED = "added"
    MODIFIED = "modified"
    DELETED = "deleted"
    RENAMED = "renamed"
    UNTRACKED = "untracked"
    UNMODIFIED = "unmodified"


class DiffFormat(str, Enum):
    """diff 输出格式"""
    UNIFIED = "unified"           # 标准 unified diff 文本
    SIDE_BY_SIDE = "side_by_side"  # 并排双列 diff
    JSON_PATCH = "json_patch"     # JSON 结构化 diff
    STATS = "stats"               # 仅统计信息


# 单文件最大 patch 字符数（防止超大文件返回）
MAX_PATCH_CHARS = 200_000
# 快照元数据最大条目数
MAX_SNAPSHOTS_PER_PROJECT = 200
# 文件路径白名单最大长度
MAX_PATH_LENGTH = 1024


# ============================================================
# 数据类
# ============================================================

@dataclass
class DiffLine:
    """diff 单行数据"""
    line_type: str  # add / del / ctx / meta
    content: str
    old_line_no: Optional[int] = None
    new_line_no: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class FileDiff:
    """单文件 diff 结果"""
    path: str
    status: str
    additions: int = 0
    deletions: int = 0
    old_path: Optional[str] = None
    is_staged: bool = False
    # 多格式输出
    patch_unified: str = ""
    lines: List[DiffLine] = field(default_factory=list)
    side_by_side: Dict[str, Any] = field(default_factory=dict)
    json_patch: List[Dict[str, Any]] = field(default_factory=list)
    # 错误信息（读取失败时填充）
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "status": self.status,
            "additions": self.additions,
            "deletions": self.deletions,
            "old_path": self.old_path,
            "is_staged": self.is_staged,
            "patch_unified": self.patch_unified,
            "lines": [line.to_dict() for line in self.lines],
            "side_by_side": self.side_by_side,
            "json_patch": self.json_patch,
            "error": self.error,
        }


@dataclass
class DiffStats:
    """diff 统计信息"""
    total_files: int = 0
    total_additions: int = 0
    total_deletions: int = 0
    by_status: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DiffResult:
    """一次 diff 操作结果"""
    format: str
    files: List[FileDiff] = field(default_factory=list)
    stats: DiffStats = field(default_factory=DiffStats)
    base_ref: Optional[str] = None
    target_ref: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "format": self.format,
            "files": [f.to_dict() for f in self.files],
            "stats": self.stats.to_dict(),
            "base_ref": self.base_ref,
            "target_ref": self.target_ref,
            "error": self.error,
        }


@dataclass
class Snapshot:
    """工作区快照"""
    id: str
    project_path: str
    label: str
    description: str
    created_at: str
    file_count: int
    total_size: int
    file_hashes: Dict[str, str] = field(default_factory=dict)
    # 存储路径（项目根 / .diffview / snap_xxx / ）
    storage_dir: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 辅助函数
# ============================================================

def _now_iso() -> str:
    """返回 ISO 8601 格式的 UTC 时间字符串（含微秒，确保排序稳定）"""
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _normalize_path(path: str, project_root: Path) -> str:
    """
    规范化文件路径为相对项目的相对路径
    参数：
      - path: 原始路径（绝对或相对）
      - project_root: 项目根目录
    返回值：相对项目根的 POSIX 风格路径
    异常：ValueError 当路径不在项目内或越界时
    """
    if not path:
        raise ValueError("path 不能为空")
    p = Path(path)
    if p.is_absolute():
        try:
            rel = p.relative_to(project_root)
        except ValueError as e:
            raise ValueError(f"path 必须在项目内: {path}") from e
    else:
        # 相对路径直接使用
        rel = p
    # 拒绝向上越界（即便以 /../ 形式）
    rel_str = rel.as_posix()
    if rel_str.startswith("..") or "/../" in ("/" + rel_str) or rel_str == "..":
        raise ValueError(f"path 越界: {path}")
    return rel_str


def _safe_relpath(path: str, project_root: Path) -> Optional[Path]:
    """
    安全计算相对项目根的相对路径；失败返回 None
    """
    try:
        return Path(path).resolve().relative_to(project_root.resolve())
    except (ValueError, OSError):
        return None


def _file_sha256(file_path: Path) -> str:
    """计算文件 SHA-256 哈希；空文件返回固定哈希"""
    h = hashlib.sha256()
    try:
        if not file_path.exists() or not file_path.is_file():
            return "empty"
        with file_path.open("rb") as f:
            for chunk in iter(lambda: f.read(64 * 1024), b""):
                h.update(chunk)
    except OSError as e:
        logger.warning(f"读取文件失败 {file_path}: {e}")
        return "unreadable"
    return h.hexdigest()


# ============================================================
# 行级 patch 解析
# ============================================================

_META_LINE_RE = re.compile(r"^(---|\+\+\+|@@)")
_ADD_LINE_RE = re.compile(r"^\+(?!\+\+)")
_DEL_LINE_RE = re.compile(r"^-(?!--)")


def parse_patch_lines(patch_text: str) -> List[DiffLine]:
    """
    解析 unified diff 文本为结构化行列表
    参数：
      - patch_text: unified diff 文本
    返回值：DiffLine 列表
    说明：
      - add / del / ctx / meta 四种 line_type
      - 自动跟踪 old/new 行号（基于 @@ 块）
    """
    lines: List[DiffLine] = []
    if not patch_text:
        return lines

    old_line = 0
    new_line = 0
    in_hunk = False

    for raw in patch_text.splitlines():
        if raw.startswith("@@"):
            # 例如: @@ -1,3 +1,4 @@
            m = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", raw)
            if m:
                old_line = int(m.group(1))
                new_line = int(m.group(2))
                in_hunk = True
            lines.append(DiffLine(
                line_type="meta",
                content=raw,
                old_line_no=None,
                new_line_no=None,
            ))
            continue

        if not in_hunk:
            # 文件级头（--- / +++）
            if _META_LINE_RE.match(raw):
                lines.append(DiffLine(line_type="meta", content=raw))
            continue

        if raw.startswith("+"):
            lines.append(DiffLine(
                line_type="add",
                content=raw[1:],
                old_line_no=None,
                new_line_no=new_line,
            ))
            new_line += 1
        elif raw.startswith("-"):
            lines.append(DiffLine(
                line_type="del",
                content=raw[1:],
                old_line_no=old_line,
                new_line_no=None,
            ))
            old_line += 1
        elif raw.startswith("\\"):
            # "\ No newline at end of file" 标记行
            lines.append(DiffLine(line_type="meta", content=raw))
        else:
            # 上下文行（包括以空格开头的行）
            content = raw[1:] if raw.startswith(" ") else raw
            lines.append(DiffLine(
                line_type="ctx",
                content=content,
                old_line_no=old_line,
                new_line_no=new_line,
            ))
            old_line += 1
            new_line += 1

    return lines


# ============================================================
# 并排 diff 构造
# ============================================================

def build_side_by_side(diff_lines: List[DiffLine]) -> Dict[str, Any]:
    """
    基于行级 diff 构造并排视图
    返回值：{"rows": [{"left": {...}, "right": {...}}, ...]}
    """
    rows: List[Dict[str, Any]] = []
    # 简化策略：ctx 行左右相同；del 行仅左；add 行仅右
    # 复杂字符级内联差异不在此实现
    left_pending: Optional[DiffLine] = None

    for line in diff_lines:
        if line.line_type == "meta":
            rows.append({
                "left": {"type": "meta", "content": line.content, "line_no": None},
                "right": {"type": "meta", "content": line.content, "line_no": None},
            })
        elif line.line_type == "ctx":
            left_pending = None
            rows.append({
                "left": {
                    "type": "ctx",
                    "content": line.content,
                    "line_no": line.old_line_no,
                },
                "right": {
                    "type": "ctx",
                    "content": line.content,
                    "line_no": line.new_line_no,
                },
            })
        elif line.line_type == "del":
            left_pending = line
            rows.append({
                "left": {
                    "type": "del",
                    "content": line.content,
                    "line_no": line.old_line_no,
                },
                "right": {"type": "empty", "content": "", "line_no": None},
            })
        elif line.line_type == "add":
            # 若左侧有待配对的 del，可尝试配对；此处简化为独立行
            rows.append({
                "left": {"type": "empty", "content": "", "line_no": None},
                "right": {
                    "type": "add",
                    "content": line.content,
                    "line_no": line.new_line_no,
                },
            })
            left_pending = None

    return {"rows": rows, "row_count": len(rows)}


# ============================================================
# JSON Patch 构造
# ============================================================

def build_json_patch(
    diff_lines: List[DiffLine],
    file_path: str,
) -> List[Dict[str, Any]]:
    """
    基于行级 diff 构造 JSON Patch (RFC 6902 风格的简化版)
    返回值：操作列表，每项形如 {"op": "add"|"remove", "line": N, "content": "..."}
    """
    ops: List[Dict[str, Any]] = []
    for line in diff_lines:
        if line.line_type == "add" and line.new_line_no is not None:
            ops.append({
                "op": "add",
                "line": line.new_line_no,
                "content": line.content,
            })
        elif line.line_type == "del" and line.old_line_no is not None:
            ops.append({
                "op": "remove",
                "line": line.old_line_no,
                "content": line.content,
            })
    return ops


# ============================================================
# Git 集成辅助
# ============================================================

def _run_git(repo: Path, args: List[str], timeout: int = 10) -> Tuple[int, str, str]:
    """
    在指定 git 仓库中运行 git 命令
    返回值：(returncode, stdout, stderr)
    """
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo)] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "git command timeout"
    except FileNotFoundError:
        return 127, "", "git not installed"
    except Exception as e:  # noqa: BLE001
        return 1, "", f"git exec error: {e}"


def _is_git_repo(path: Path) -> bool:
    """检查目录是否为 Git 仓库根（含 .git 子目录）"""
    if not path.exists() or not path.is_dir():
        return False
    git_dir = path / ".git"
    if git_dir.exists():
        return True
    # 兼容 git worktree / 父目录场景：通过 git rev-parse 验证
    rc, _, _ = _run_git(path, ["rev-parse", "--show-toplevel"], timeout=5)
    return rc == 0


def _git_toplevel(path: Path) -> Optional[Path]:
    """获取 git 仓库的顶层目录"""
    rc, out, _ = _run_git(path, ["rev-parse", "--show-toplevel"], timeout=5)
    if rc != 0:
        return None
    return Path(out.strip()).resolve()


def _build_unified_diff_from_text(
    old_text: str,
    new_text: str,
    old_path: str,
    new_path: str,
) -> str:
    """
    从两段文本构造 unified diff
    简化实现：使用 difflib.unified_diff
    """
    import difflib
    diff = difflib.unified_diff(
        old_text.splitlines(keepends=True),
        new_text.splitlines(keepends=True),
        fromfile=f"a/{old_path}",
        tofile=f"b/{new_path}",
        n=3,
    )
    return "".join(diff)


# ============================================================
# 快照管理
# ============================================================

class SnapshotManager:
    """
    工作区快照管理器
    作用：为指定项目创建 / 列出 / 恢复 / 删除快照
    存储：<project>/.diffview/snap_<id>/{metadata.json, files/}
    线程安全：RLock 保护所有操作
    """

    def __init__(self, project_path: Path):
        self.project_path = Path(project_path).resolve()
        self.snapshot_root = self.project_path / SNAPSHOT_DIRNAME
        self._lock = threading.RLock()
        self._ensure_root()

    def _ensure_root(self) -> None:
        """确保快照根目录存在"""
        try:
            self.snapshot_root.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.error(f"创建快照根目录失败 {self.snapshot_root}: {e}")

    def _meta_path(self) -> Path:
        return self.snapshot_root / SNAPSHOT_META_FILE

    def _load_meta(self) -> List[Dict[str, Any]]:
        """加载快照元数据列表；不存在返回空"""
        path = self._meta_path()
        if not path.exists():
            return []
        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
            return []
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"读取快照元数据失败 {path}: {e}")
            return []

    def _save_meta(self, items: List[Dict[str, Any]]) -> None:
        """保存快照元数据"""
        path = self._meta_path()
        try:
            with path.open("w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logger.error(f"保存快照元数据失败 {path}: {e}")
            raise

    def list_snapshots(self) -> List[Snapshot]:
        """列出所有快照（按创建时间倒序）"""
        with self._lock:
            items = self._load_meta()
        items_sorted = sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)
        return [self._to_snapshot(item) for item in items_sorted]

    def _to_snapshot(self, item: Dict[str, Any]) -> Snapshot:
        """从 dict 还原为 Snapshot"""
        return Snapshot(
            id=item.get("id", ""),
            project_path=item.get("project_path", str(self.project_path)),
            label=item.get("label", ""),
            description=item.get("description", ""),
            created_at=item.get("created_at", ""),
            file_count=int(item.get("file_count", 0)),
            total_size=int(item.get("total_size", 0)),
            file_hashes=item.get("file_hashes", {}),
            storage_dir=item.get("storage_dir", ""),
        )

    def get_snapshot(self, snapshot_id: str) -> Optional[Snapshot]:
        """根据 ID 获取快照"""
        for snap in self.list_snapshots():
            if snap.id == snapshot_id:
                return snap
        return None

    def create_snapshot(
        self,
        label: str = "",
        description: str = "",
        include_globs: Optional[List[str]] = None,
        max_file_size: int = 50 * 1024 * 1024,  # 50MB
    ) -> Snapshot:
        """
        创建当前工作区快照
        参数：
          - label: 人类可读标签
          - description: 描述信息
          - include_globs: 包含的文件 glob 列表（如 ["*.py", "src/**"]）；
                          为 None 时使用默认（所有文件，排除 .git/.diffview）
          - max_file_size: 单文件最大字节数
        返回值：创建的 Snapshot
        异常：ValueError / OSError
        """
        with self._lock:
            self._ensure_root()
            snap_id = f"{int(time.time())}_{uuid.uuid4().hex[:8]}"
            storage_dir = self.snapshot_root / f"{SNAPSHOT_FILE_PREFIX}{snap_id}"
            files_dir = storage_dir / "files"
            files_dir.mkdir(parents=True, exist_ok=True)

            # 收集文件
            if include_globs is None:
                # 默认：所有非 .git / .diffview 文件
                files_to_capture: List[Path] = []
                for p in self.project_path.rglob("*"):
                    if not p.is_file():
                        continue
                    rel = _safe_relpath(str(p), self.project_path)
                    if rel is None:
                        continue
                    rel_parts = rel.parts
                    if any(part in (".git", SNAPSHOT_DIRNAME, "__pycache__", "node_modules") for part in rel_parts):
                        continue
                    files_to_capture.append(p)
            else:
                files_to_capture = []
                for pattern in include_globs:
                    for p in self.project_path.glob(pattern):
                        if p.is_file():
                            files_to_capture.append(p)

            file_hashes: Dict[str, str] = {}
            total_size = 0
            captured = 0
            for src in files_to_capture:
                try:
                    rel = src.relative_to(self.project_path)
                except ValueError:
                    continue
                if src.stat().st_size > max_file_size:
                    # 跳过超大文件，仅记录哈希
                    file_hashes[rel.as_posix()] = f"skipped:{_file_sha256(src)}"
                    continue
                target = files_dir / rel
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, target)
                except OSError as e:
                    logger.warning(f"复制文件到快照失败 {src}: {e}")
                    continue
                file_hashes[rel.as_posix()] = _file_sha256(src)
                total_size += src.stat().st_size
                captured += 1

            snap = Snapshot(
                id=snap_id,
                project_path=str(self.project_path),
                label=label or snap_id,
                description=description,
                created_at=_now_iso(),
                file_count=captured,
                total_size=total_size,
                file_hashes=file_hashes,
                storage_dir=str(storage_dir),
            )

            # 写入元数据
            items = self._load_meta()
            items.append({
                "id": snap.id,
                "project_path": snap.project_path,
                "label": snap.label,
                "description": snap.description,
                "created_at": snap.created_at,
                "file_count": snap.file_count,
                "total_size": snap.total_size,
                "file_hashes": snap.file_hashes,
                "storage_dir": snap.storage_dir,
            })
            # 限制最大条目数
            if len(items) > MAX_SNAPSHOTS_PER_PROJECT:
                # 删最早的
                items_sorted = sorted(items, key=lambda x: x.get("created_at", ""))
                removed = items_sorted[: len(items) - MAX_SNAPSHOTS_PER_PROJECT]
                for old in removed:
                    old_dir = Path(old.get("storage_dir", ""))
                    if old_dir.exists():
                        shutil.rmtree(old_dir, ignore_errors=True)
                items = items_sorted[len(items) - MAX_SNAPSHOTS_PER_PROJECT:]
            self._save_meta(items)
            return snap

    def restore_snapshot(self, snapshot_id: str) -> Tuple[bool, str, int]:
        """
        恢复快照到工作区
        返回值：(success, message, file_count)
        警告：会覆盖当前工作区对应文件！调用方需二次确认。
        """
        with self._lock:
            snap = self.get_snapshot(snapshot_id)
            if snap is None:
                return False, f"snapshot not found: {snapshot_id}", 0
            storage_dir = Path(snap.storage_dir)
            files_dir = storage_dir / "files"
            if not files_dir.exists():
                return False, f"snapshot files missing: {files_dir}", 0

            restored = 0
            errors: List[str] = []
            for src in files_dir.rglob("*"):
                if not src.is_file():
                    continue
                rel = _safe_relpath(str(src), files_dir)
                if rel is None:
                    continue
                target = self.project_path / rel
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, target)
                    restored += 1
                except OSError as e:
                    errors.append(f"{rel}: {e}")
            if errors:
                return False, f"partial restore ({restored} ok, {len(errors)} failed): {errors[:3]}", restored
            return True, f"restored {restored} files from snapshot {snapshot_id}", restored

    def delete_snapshot(self, snapshot_id: str) -> Tuple[bool, str]:
        """删除快照"""
        with self._lock:
            items = self._load_meta()
            target = None
            for it in items:
                if it.get("id") == snapshot_id:
                    target = it
                    break
            if target is None:
                return False, f"snapshot not found: {snapshot_id}"
            storage_dir = Path(target.get("storage_dir", ""))
            if storage_dir.exists():
                shutil.rmtree(storage_dir, ignore_errors=True)
            items = [it for it in items if it.get("id") != snapshot_id]
            self._save_meta(items)
            return True, f"deleted snapshot {snapshot_id}"


# ============================================================
# DiffView 主服务
# ============================================================

class DiffViewService:
    """
    DiffView 核心服务
    能力：
      1. 多格式 diff（unified / side_by_side / json_patch / stats）
      2. 工作区 / 任意 ref 之间 diff
      3. 快照管理（create / list / restore / delete）
      4. 文件暂存 / 取消暂存
      5. 过滤与搜索
    线程安全：所有方法使用 RLock 保护
    """

    def __init__(self, project_path: Path):
        self.project_path = Path(project_path).resolve()
        self.snapshot_manager = SnapshotManager(self.project_path)
        self._lock = threading.RLock()

    # ----- 工具方法 -----

    def _to_file_obj(self) -> Optional[FileDiff]:
        return None  # placeholder

    def _check_project(self) -> None:
        """校验项目路径存在"""
        if not self.project_path.exists() or not self.project_path.is_dir():
            raise ValueError(f"project_path 不存在: {self.project_path}")

    # ----- 核心 diff 接口 -----

    def diff_workspace(
        self,
        staged: bool = False,
        format: str = "unified",
        path_filter: Optional[str] = None,
        status_filter: Optional[List[str]] = None,
    ) -> DiffResult:
        """
        对工作区进行 diff（已暂存或未暂存）
        参数：
          - staged: True 暂存区，False 工作区未暂存
          - format: 输出格式
          - path_filter: 路径子串过滤
          - status_filter: 状态过滤列表
        返回值：DiffResult
        """
        self._check_project()
        format_value = self._validate_format(format)
        with self._lock:
            raw_files = self._git_diff_files(staged=staged)
        files: List[FileDiff] = []
        for fd in raw_files:
            # 过滤
            if status_filter and fd.status not in status_filter:
                continue
            if path_filter and path_filter not in fd.path:
                continue
            # 多格式输出
            self._populate_formats(fd, format_value)
            files.append(fd)
        stats = self._compute_stats(files)
        return DiffResult(
            format=format_value,
            files=files,
            stats=stats,
            base_ref="INDEX" if staged else "WORKTREE",
            target_ref="WORKTREE",
        )

    def diff_refs(
        self,
        base_ref: str,
        target_ref: str,
        format: str = "unified",
        path_filter: Optional[str] = None,
    ) -> DiffResult:
        """
        比较任意两个 ref (commit / branch / tag)
        参数：
          - base_ref: 基础 ref
          - target_ref: 目标 ref
          - format: 输出格式
        返回值：DiffResult
        """
        self._check_project()
        if not base_ref or not target_ref:
            raise ValueError("base_ref 和 target_ref 不能为空")
        if base_ref == target_ref:
            return DiffResult(
                format=self._validate_format(format),
                base_ref=base_ref,
                target_ref=target_ref,
                error="base_ref and target_ref are identical",
            )
        format_value = self._validate_format(format)
        with self._lock:
            raw_files = self._git_diff_refs(base_ref, target_ref)
        files: List[FileDiff] = []
        for fd in raw_files:
            if path_filter and path_filter not in fd.path:
                continue
            self._populate_formats(fd, format_value)
            files.append(fd)
        stats = self._compute_stats(files)
        return DiffResult(
            format=format_value,
            files=files,
            stats=stats,
            base_ref=base_ref,
            target_ref=target_ref,
        )

    def diff_snapshot_to_workspace(self, snapshot_id: str) -> DiffResult:
        """
        对比快照与当前工作区
        """
        self._check_project()
        snap = self.snapshot_manager.get_snapshot(snapshot_id)
        if snap is None:
            return DiffResult(
                format="unified",
                error=f"snapshot not found: {snapshot_id}",
            )
        with self._lock:
            files = self._diff_snapshot_vs_worktree(snap)
        stats = self._compute_stats(files)
        return DiffResult(
            format="unified",
            files=files,
            stats=stats,
            base_ref=f"snapshot:{snapshot_id}",
            target_ref="WORKTREE",
        )

    # ----- 暂存控制 -----

    def stage_file(self, file_path: str) -> Tuple[bool, str]:
        """
        暂存单个文件
        返回值：(success, message)
        """
        self._check_project()
        rel = self._validate_rel_path(file_path)
        toplevel = _git_toplevel(self.project_path) or self.project_path
        rc, out, err = _run_git(toplevel, ["add", "--", rel])
        if rc == 0:
            return True, f"staged: {rel}"
        return False, f"git add failed: {err or out}"

    def unstage_file(self, file_path: str) -> Tuple[bool, str]:
        """
        取消暂存单个文件
        """
        self._check_project()
        rel = self._validate_rel_path(file_path)
        toplevel = _git_toplevel(self.project_path) or self.project_path
        # reset HEAD 对该文件取消暂存
        rc, out, err = _run_git(toplevel, ["reset", "HEAD", "--", rel])
        if rc == 0:
            return True, f"unstaged: {rel}"
        return False, f"git reset failed: {err or out}"

    def stage_all(self) -> Tuple[bool, str]:
        """暂存所有变更"""
        self._check_project()
        toplevel = _git_toplevel(self.project_path) or self.project_path
        rc, out, err = _run_git(toplevel, ["add", "-A"])
        if rc == 0:
            return True, "staged all changes"
        return False, f"git add -A failed: {err or out}"

    # ----- 快照接口 -----

    def create_snapshot(
        self,
        label: str = "",
        description: str = "",
        include_globs: Optional[List[str]] = None,
    ) -> Snapshot:
        return self.snapshot_manager.create_snapshot(
            label=label,
            description=description,
            include_globs=include_globs,
        )

    def list_snapshots(self) -> List[Snapshot]:
        return self.snapshot_manager.list_snapshots()

    def restore_snapshot(self, snapshot_id: str) -> Tuple[bool, str, int]:
        return self.snapshot_manager.restore_snapshot(snapshot_id)

    def delete_snapshot(self, snapshot_id: str) -> Tuple[bool, str]:
        return self.snapshot_manager.delete_snapshot(snapshot_id)

    # ----- 内部方法 -----

    def _validate_format(self, format: str) -> str:
        """校验并规范化 format"""
        try:
            return DiffFormat(format).value
        except ValueError as e:
            raise ValueError(
                f"unsupported format: {format} (expected: {[f.value for f in DiffFormat]})"
            ) from e

    def _validate_rel_path(self, file_path: str) -> str:
        """校验并返回相对项目根的路径"""
        if not file_path:
            raise ValueError("file_path 不能为空")
        if len(file_path) > MAX_PATH_LENGTH:
            raise ValueError(f"file_path 长度超过 {MAX_PATH_LENGTH}")
        return _normalize_path(file_path, self.project_path)

    def _git_diff_files(self, staged: bool) -> List[FileDiff]:
        """
        通过 git 命令行收集工作区 diff
        不依赖 GitPython，零外部依赖
        """
        toplevel = _git_toplevel(self.project_path) or self.project_path
        if toplevel is None:
            return []

        # 1. 获取文件状态列表
        status_args = ["diff", "--name-status", "--no-renames"]
        if staged:
            status_args = ["diff", "--cached", "--name-status", "--no-renames"]
        rc, out, err = _run_git(toplevel, status_args, timeout=15)
        status_map: Dict[str, str] = {}
        if rc == 0 and out.strip():
            for line in out.strip().splitlines():
                parts = line.split("\t")
                if len(parts) >= 2:
                    code, path = parts[0], parts[1]
                    status_map[path] = self._map_status_code(code)

        # 2. untracked 文件
        rc2, out2, _ = _run_git(
            toplevel, ["ls-files", "--others", "--exclude-standard"], timeout=10
        )
        if rc2 == 0 and out2.strip():
            for p in out2.strip().splitlines():
                status_map[p] = DiffStatus.UNTRACKED.value

        # 3. 获取 diff 文本
        diff_args = ["diff", "--no-renames", "--no-color"]
        if staged:
            diff_args = ["diff", "--cached", "--no-renames", "--no-color"]
        rc3, diff_text, _ = _run_git(toplevel, diff_args, timeout=20)
        if rc3 != 0:
            diff_text = ""

        # 解析 diff 文本为 per-file patch
        file_patches: Dict[str, str] = self._split_diff_text(diff_text)

        # 4. 构造 FileDiff 列表
        results: List[FileDiff] = []
        for path, status in status_map.items():
            patch = file_patches.get(path, "")
            if not patch and status != DiffStatus.UNTRACKED.value:
                # 某些边缘情况下 diff 文本可能为空但 status 标识为修改
                patch = ""
            elif status == DiffStatus.UNTRACKED.value:
                # 构造 untracked 文件的伪 patch
                patch = self._build_untracked_patch(toplevel / path)

            lines = parse_patch_lines(patch)
            additions = sum(1 for ln in lines if ln.line_type == "add")
            deletions = sum(1 for ln in lines if ln.line_type == "del")
            results.append(FileDiff(
                path=path,
                status=status,
                additions=additions,
                deletions=deletions,
                is_staged=staged,
                patch_unified=patch[:MAX_PATCH_CHARS],
                lines=lines,
            ))

        return results

    def _git_diff_refs(self, base_ref: str, target_ref: str) -> List[FileDiff]:
        """比较任意两个 ref"""
        toplevel = _git_toplevel(self.project_path)
        if toplevel is None:
            return []

        # 1. name-status
        rc, out, err = _run_git(
            toplevel, ["diff", "--name-status", "--no-renames", base_ref, target_ref],
            timeout=15,
        )
        status_map: Dict[str, str] = {}
        if rc == 0 and out.strip():
            for line in out.strip().splitlines():
                parts = line.split("\t")
                if len(parts) >= 2:
                    code, path = parts[0], parts[1]
                    status_map[path] = self._map_status_code(code)
        if not status_map:
            return []

        # 2. patch
        rc2, diff_text, _ = _run_git(
            toplevel, ["diff", "--no-renames", "--no-color", base_ref, target_ref],
            timeout=20,
        )
        if rc2 != 0:
            diff_text = ""
        file_patches = self._split_diff_text(diff_text)

        results: List[FileDiff] = []
        for path, status in status_map.items():
            patch = file_patches.get(path, "")
            lines = parse_patch_lines(patch)
            additions = sum(1 for ln in lines if ln.line_type == "add")
            deletions = sum(1 for ln in lines if ln.line_type == "del")
            results.append(FileDiff(
                path=path,
                status=status,
                additions=additions,
                deletions=deletions,
                is_staged=False,
                patch_unified=patch[:MAX_PATCH_CHARS],
                lines=lines,
            ))
        return results

    def _diff_snapshot_vs_worktree(self, snap: Snapshot) -> List[FileDiff]:
        """对比快照文件与工作区当前内容"""
        storage_dir = Path(snap.storage_dir) / "files"
        results: List[FileDiff] = []
        if not storage_dir.exists():
            return results

        # 遍历快照中的所有文件
        snap_files = {p.relative_to(storage_dir).as_posix() for p in storage_dir.rglob("*") if p.is_file()}

        # 遍历工作区所有文件（仅比对快照范围内的相对路径 + 工作区新增文件）
        worktree_files: Dict[str, Path] = {}
        for rel_str in snap_files:
            worktree_path = self.project_path / rel_str
            if worktree_path.exists() and worktree_path.is_file():
                worktree_files[rel_str] = worktree_path

        # 扫描工作区中所有非 .diffview / .git / __pycache__ / node_modules 文件
        # 以检测新增文件
        for p in self.project_path.rglob("*"):
            if not p.is_file():
                continue
            try:
                rel = p.relative_to(self.project_path)
            except ValueError:
                continue
            rel_str = rel.as_posix()
            parts = rel.parts
            # 跳过 .diffview / .git / 缓存目录
            if any(part in (SNAPSHOT_DIRNAME, ".git", "__pycache__", "node_modules") for part in parts):
                continue
            if rel_str not in worktree_files:
                worktree_files[rel_str] = p

        for rel_str in sorted(snap_files | set(worktree_files.keys())):
            snap_file = storage_dir / rel_str
            worktree_file = worktree_files.get(rel_str)

            if not worktree_file:
                # 工作区已删除
                snap_text = self._read_text(snap_file)
                patch = _build_unified_diff_from_text(
                    snap_text, "", rel_str, rel_str
                )
                lines = parse_patch_lines(patch)
                results.append(FileDiff(
                    path=rel_str,
                    status=DiffStatus.DELETED.value,
                    additions=0,
                    deletions=sum(1 for ln in lines if ln.line_type == "del"),
                    patch_unified=patch,
                    lines=lines,
                ))
                continue

            if not snap_file.exists():
                # 工作区新增
                work_text = self._read_text(worktree_file)
                patch = _build_unified_diff_from_text(
                    "", work_text, rel_str, rel_str
                )
                lines = parse_patch_lines(patch)
                results.append(FileDiff(
                    path=rel_str,
                    status=DiffStatus.ADDED.value,
                    additions=sum(1 for ln in lines if ln.line_type == "add"),
                    deletions=0,
                    patch_unified=patch,
                    lines=lines,
                ))
                continue

            snap_text = self._read_text(snap_file)
            work_text = self._read_text(worktree_file)
            if snap_text == work_text:
                continue  # 未变化
            patch = _build_unified_diff_from_text(
                snap_text, work_text, rel_str, rel_str
            )
            lines = parse_patch_lines(patch)
            results.append(FileDiff(
                path=rel_str,
                status=DiffStatus.MODIFIED.value,
                additions=sum(1 for ln in lines if ln.line_type == "add"),
                deletions=sum(1 for ln in lines if ln.line_type == "del"),
                patch_unified=patch,
                lines=lines,
            ))
        return results

    def _populate_formats(self, fd: FileDiff, format_value: str) -> None:
        """根据 format 填充 FileDiff 的额外字段"""
        if format_value == DiffFormat.SIDE_BY_SIDE.value:
            fd.side_by_side = build_side_by_side(fd.lines)
        elif format_value == DiffFormat.JSON_PATCH.value:
            fd.json_patch = build_json_patch(fd.lines, fd.path)
        elif format_value == DiffFormat.STATS.value:
            # 仅保留统计信息，lines/patch 截断
            fd.lines = []
            fd.patch_unified = ""
        # UNIFIED 默认：已有 patch_unified / lines

    def _compute_stats(self, files: List[FileDiff]) -> DiffStats:
        """计算汇总统计"""
        by_status: Dict[str, int] = {}
        total_add = 0
        total_del = 0
        for f in files:
            by_status[f.status] = by_status.get(f.status, 0) + 1
            total_add += f.additions
            total_del += f.deletions
        return DiffStats(
            total_files=len(files),
            total_additions=total_add,
            total_deletions=total_del,
            by_status=by_status,
        )

    @staticmethod
    def _map_status_code(code: str) -> str:
        """git status code 映射到 DiffStatus"""
        code = code.strip()
        if code.startswith("A"):
            return DiffStatus.ADDED.value
        if code.startswith("M"):
            return DiffStatus.MODIFIED.value
        if code.startswith("D"):
            return DiffStatus.DELETED.value
        if code.startswith("R"):
            return DiffStatus.RENAMED.value
        if code.startswith("??"):
            return DiffStatus.UNTRACKED.value
        return DiffStatus.MODIFIED.value

    @staticmethod
    def _split_diff_text(diff_text: str) -> Dict[str, str]:
        """
        将 multi-file unified diff 拆分为 per-file 字典
        键：文件路径（b/ 之后的部分）
        值：该文件的完整 diff 文本
        """
        if not diff_text:
            return {}
        result: Dict[str, str] = {}
        current_path: Optional[str] = None
        current_lines: List[str] = []

        def flush() -> None:
            if current_path is not None:
                result[current_path] = "\n".join(current_lines)

        for line in diff_text.splitlines():
            if line.startswith("diff --git"):
                flush()
                current_lines = [line]
                current_path = None
            elif line.startswith("--- "):
                current_lines.append(line)
            elif line.startswith("+++ "):
                current_lines.append(line)
                # 从 "+++ b/path" 提取 path
                if line.startswith("+++ b/"):
                    current_path = line[len("+++ b/"):].strip()
            else:
                if current_path is not None:
                    current_lines.append(line)
        flush()
        return result

    @staticmethod
    def _build_untracked_patch(file_path: Path) -> str:
        """为 untracked 文件构造伪 patch"""
        try:
            text = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        rel = file_path.name
        lines = text.splitlines()
        header = [
            f"diff --git a/{rel} b/{rel}",
            f"new file mode 100644",
            "--- /dev/null",
            f"+++ b/{rel}",
            f"@@ -0,0 +1,{len(lines)} @@",
        ]
        body = [f"+{ln}" for ln in lines]
        return "\n".join(header + body)

    @staticmethod
    def _read_text(file_path: Path) -> str:
        """读取文本（容错）"""
        try:
            return file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""


# ============================================================
# 全局单例
# ============================================================

_GLOBAL_REGISTRY: Dict[str, DiffViewService] = {}
_GLOBAL_LOCK = threading.RLock()


def get_diff_view_service(project_path: str) -> DiffViewService:
    """
    获取指定项目的 DiffViewService（按项目路径缓存）
    参数：
      - project_path: 项目根目录绝对路径
    返回值：DiffViewService 实例
    异常：ValueError 当路径无效时
    """
    if not project_path:
        raise ValueError("project_path 不能为空")
    p = Path(project_path).resolve()
    key = str(p)
    with _GLOBAL_LOCK:
        if key not in _GLOBAL_REGISTRY:
            _GLOBAL_REGISTRY[key] = DiffViewService(p)
        return _GLOBAL_REGISTRY[key]


def reset_global_registry() -> None:
    """重置全局注册表（仅供测试使用）"""
    with _GLOBAL_LOCK:
        _GLOBAL_REGISTRY.clear()
