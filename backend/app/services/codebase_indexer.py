"""
# ============================================================
# CodebaseIndexer 服务 (v1.0.0)
# Cycle 68 G68-01
# ============================================================
# 核心作用：项目级代码库索引服务，提供文件元数据、符号提取、文本搜索
#           三类能力，为 LLM/Agent 提供按需检索相关代码片段
# 运行流程：
#   1. build_index(root)  → 扫描项目，构建文件/符号/文本三类索引
#   2. search(query, top_k) → 多策略并行搜索（text + symbol）→ 合并排序
#   3. get_file(path, line_range) → 读取文件片段
#   4. on_file_changed(path) → FS Watch 触发，失效 + 增量重建
# 设计要点：
#   - 轻量级符号提取（正则），避免 tree-sitter 重依赖
#   - 多语言支持（Python / TypeScript / Rust / Go / 通用）
#   - 路径白名单 + 二进制检测 + 大小限制
#   - 线程安全（threading.Lock）
#   - 增量更新 + 懒构建
# 输入参数：项目根路径、查询条件
# 输出结果：文件/符号/搜索结果列表
# 对标：Codex `codex-rs/project_index`（rg 索引）+ Trae（BM25+Embedding）
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 68 G68-01 初次创建
# ====================================
"""

import hashlib
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# ============================================================
# 常量
# ============================================================

# 默认忽略目录
DEFAULT_IGNORE_DIRS: Tuple[str, ...] = (
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    "dist",
    "build",
    "target",
    ".next",
    ".cache",
    "coverage",
    ".pytest_cache",
    ".mypy_cache",
    ".tox",
    "vendor",
    "third_party",
)

# 默认忽略文件后缀
DEFAULT_IGNORE_SUFFIXES: Tuple[str, ...] = (
    ".pyc",
    ".pyo",
    ".so",
    ".o",
    ".a",
    ".lib",
    ".dll",
    ".exe",
    ".bin",
    ".lock",
    ".log",
    ".tmp",
    ".bak",
    ".swp",
    ".swo",
)

# 文件大小限制
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# 单索引最大文件数
MAX_FILES_PER_INDEX = 50000

# 符号提取正则（按语言）
SYMBOL_PATTERNS: Dict[str, List[Tuple[str, str, re.Pattern]]] = {
    "python": [
        ("function", "def", re.compile(r"^def\s+(\w+)\s*\(")),
        ("class", "class", re.compile(r"^class\s+(\w+)\s*[:\(]")),
        ("method", "def", re.compile(r"^(\s+)def\s+(\w+)\s*\(")),
        ("async_function", "async def", re.compile(r"^async\s+def\s+(\w+)\s*\(")),
    ],
    "typescript": [
        ("function", "function", re.compile(r"^(?:export\s+)?function\s+(\w+)\s*[<\(]")),
        ("class", "class", re.compile(r"^(?:export\s+)?class\s+(\w+)")),
        ("interface", "interface", re.compile(r"^(?:export\s+)?interface\s+(\w+)")),
        ("const", "const", re.compile(r"^(?:export\s+)?const\s+(\w+)\s*[:=]")),
    ],
    "javascript": [
        ("function", "function", re.compile(r"^(?:export\s+)?function\s+(\w+)\s*\(")),
        ("class", "class", re.compile(r"^(?:export\s+)?class\s+(\w+)")),
        ("const", "const", re.compile(r"^(?:export\s+)?const\s+(\w+)\s*=")),
    ],
    "rust": [
        ("function", "fn", re.compile(r"^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)")),
        ("struct", "struct", re.compile(r"^(?:pub\s+)?struct\s+(\w+)")),
        ("enum", "enum", re.compile(r"^(?:pub\s+)?enum\s+(\w+)")),
        ("trait", "trait", re.compile(r"^(?:pub\s+)?trait\s+(\w+)")),
    ],
    "go": [
        ("function", "func", re.compile(r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)")),
        ("struct", "struct", re.compile(r"^type\s+(\w+)\s+struct")),
        ("interface", "interface", re.compile(r"^type\s+(\w+)\s+interface")),
    ],
    "java": [
        ("class", "class", re.compile(r"^(?:public\s+)?class\s+(\w+)")),
        ("method", "method", re.compile(r"^\s*(?:public|private|protected)\s+\w+\s+(\w+)\s*\(")),
    ],
}

# 文件后缀 → 语言映射
EXTENSION_LANGUAGE: Dict[str, str] = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".sh": "bash",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".json": "json",
    ".toml": "toml",
    ".md": "markdown",
    ".txt": "text",
}

# 评分权重
SYMBOL_MATCH_SCORE = 1.0
TEXT_MATCH_SCORE_BASE = 0.5
EXACT_MATCH_BOOST = 0.3
PATH_MATCH_BOOST = 0.2


# ============================================================
# 数据模型
# ============================================================


@dataclass
class FileEntry:
    """文件元数据条目"""

    path: str
    abs_path: str
    size: int
    mtime: float
    hash: str
    language: str
    line_count: int
    is_binary: bool
    is_ignored: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "abs_path": self.abs_path,
            "size": self.size,
            "mtime": self.mtime,
            "hash": self.hash,
            "language": self.language,
            "line_count": self.line_count,
            "is_binary": self.is_binary,
            "is_ignored": self.is_ignored,
        }


@dataclass
class SymbolEntry:
    """符号条目（函数/类/方法/变量）"""

    name: str
    kind: str
    file: str
    line: int
    signature: str
    language: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "file": self.file,
            "line": self.line,
            "signature": self.signature,
            "language": self.language,
        }


@dataclass
class TextHit:
    """文本搜索命中"""

    file: str
    line_start: int
    line_end: int
    snippet: str
    matched_terms: List[str]
    score: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": "text",
            "file": self.file,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "snippet": self.snippet,
            "matched_terms": self.matched_terms,
            "score": self.score,
        }


@dataclass
class SearchResult:
    """统一搜索结果（text 或 symbol）"""

    type: str  # "text" | "symbol"
    file: str
    line: Optional[int] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    name: Optional[str] = None
    kind: Optional[str] = None
    signature: Optional[str] = None
    snippet: Optional[str] = None
    score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "type": self.type,
            "file": self.file,
            "score": self.score,
        }
        if self.line is not None:
            result["line"] = self.line
        if self.line_start is not None:
            result["line_start"] = self.line_start
        if self.line_end is not None:
            result["line_end"] = self.line_end
        if self.name is not None:
            result["name"] = self.name
        if self.kind is not None:
            result["kind"] = self.kind
        if self.signature is not None:
            result["signature"] = self.signature
        if self.snippet is not None:
            result["snippet"] = self.snippet
        return result


@dataclass
class CodebaseStats:
    """代码库索引统计"""

    session_id: str
    project_root: str
    total_files: int
    total_symbols: int
    total_lines: int
    languages: Dict[str, int] = field(default_factory=dict)
    indexed_at: float = 0.0
    build_time_ms: int = 0
    fs_watch_active: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "project_root": self.project_root,
            "total_files": self.total_files,
            "total_symbols": self.total_symbols,
            "total_lines": self.total_lines,
            "languages": self.languages,
            "indexed_at": self.indexed_at,
            "build_time_ms": self.build_time_ms,
            "fs_watch_active": self.fs_watch_active,
        }


# ============================================================
# 异常
# ============================================================


class CodebaseIndexerError(Exception):
    """代码库索引器基础异常"""


class ProjectNotFoundError(CodebaseIndexerError):
    """项目根目录不存在"""


class InvalidQueryError(CodebaseIndexerError):
    """无效查询"""


class IndexNotFoundError(CodebaseIndexerError):
    """索引未找到"""


class FileTooLargeError(CodebaseIndexerError):
    """文件过大"""


# ============================================================
# 主服务
# ============================================================


class CodebaseIndexer:
    """
    代码库索引服务
    - 文件元数据索引
    - 符号提取（多语言）
    - 文本搜索
    - 增量更新（FS Watch 集成）
    """

    def __init__(
        self,
        max_file_size: int = MAX_FILE_SIZE,
        max_files: int = MAX_FILES_PER_INDEX,
        ignore_dirs: Optional[Tuple[str, ...]] = None,
        ignore_suffixes: Optional[Tuple[str, ...]] = None,
    ):
        self._max_file_size = max_file_size
        self._max_files = max_files
        self._ignore_dirs = ignore_dirs or DEFAULT_IGNORE_DIRS
        self._ignore_suffixes = ignore_suffixes or DEFAULT_IGNORE_SUFFIXES

        # 索引数据（按 session_id 隔离）
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    # ============================================================
    # 路径工具
    # ============================================================

    def _is_ignored_path(self, path: str) -> bool:
        """检查路径是否应该被忽略"""
        parts = Path(path).parts
        for part in parts:
            if part in self._ignore_dirs:
                return True
            if part.startswith(".") and part not in (".", ".."):
                # 隐藏目录（但保留 . 和 ..）
                # 例外：常见的非忽略点文件
                if part in (".github", ".vscode", ".idea"):
                    continue
                return True
        if Path(path).suffix in self._ignore_suffixes:
            return True
        return False

    def _detect_language(self, path: str) -> str:
        """根据文件后缀检测语言"""
        suffix = Path(path).suffix.lower()
        return EXTENSION_LANGUAGE.get(suffix, "unknown")

    def _is_binary(self, content: bytes) -> bool:
        """通过检查 null bytes 判断是否二进制"""
        sample = content[:8192]
        return b"\x00" in sample

    def _read_text_lines(self, path: str) -> List[str]:
        """读取文件并按行拆分（二进制文件返回空列表）"""
        try:
            with open(path, "rb") as f:
                content = f.read()
        except (OSError, IOError) as e:
            logger.warning(f"读取文件失败 {path}: {e}")
            return []
        if self._is_binary(content):
            return []
        try:
            return content.decode("utf-8").splitlines()
        except UnicodeDecodeError:
            try:
                return content.decode("latin-1").splitlines()
            except Exception:
                return []

    def _compute_hash(self, content: bytes) -> str:
        """计算 SHA-256 前 16 字符"""
        return hashlib.sha256(content).hexdigest()[:16]

    # ============================================================
    # 符号提取
    # ============================================================

    def _extract_symbols(
        self, file_path: str, lines: List[str], language: str
    ) -> List[SymbolEntry]:
        """从文件中提取符号"""
        patterns = SYMBOL_PATTERNS.get(language, [])
        symbols: List[SymbolEntry] = []

        for line_no, line in enumerate(lines, start=1):
            stripped = line.lstrip()
            indent = len(line) - len(stripped)

            for kind, _keyword, pattern in patterns:
                # 跳过 method 模式的过宽匹配
                if kind == "method" and indent == 0:
                    continue
                m = pattern.match(line)
                if m:
                    name = m.group(1) if m.lastindex else m.group(0)
                    signature = line.rstrip()[:200]
                    symbols.append(
                        SymbolEntry(
                            name=name,
                            kind=kind,
                            file=file_path,
                            line=line_no,
                            signature=signature,
                            language=language,
                        )
                    )
                    break  # 一行只匹配一个

        return symbols

    # ============================================================
    # 索引构建
    # ============================================================

    def build_index(
        self,
        session_id: str,
        project_root: str,
        force_rebuild: bool = False,
    ) -> CodebaseStats:
        """
        构建项目代码库索引

        Args:
            session_id: 索引会话 ID
            project_root: 项目根目录绝对路径
            force_rebuild: 是否强制重建

        Returns:
            CodebaseStats 统计信息

        Raises:
            ProjectNotFoundError: 项目根目录不存在
        """
        if not project_root or not os.path.isdir(project_root):
            raise ProjectNotFoundError(f"项目根目录不存在: {project_root}")

        start_time = time.time()
        file_index: Dict[str, FileEntry] = {}
        symbol_index: List[SymbolEntry] = []
        language_counter: Dict[str, int] = {}
        total_lines = 0
        files_scanned = 0

        for root, dirs, files in os.walk(project_root):
            # 过滤忽略目录
            dirs[:] = [d for d in dirs if d not in self._ignore_dirs]

            for filename in files:
                if files_scanned >= self._max_files:
                    logger.warning(
                        f"达到最大文件数限制 {self._max_files}, 停止扫描"
                    )
                    break

                abs_path = os.path.join(root, filename)
                rel_path = os.path.relpath(abs_path, project_root)

                if self._is_ignored_path(rel_path):
                    continue

                try:
                    stat = os.stat(abs_path)
                except OSError as e:
                    logger.debug(f"跳过 {abs_path}: {e}")
                    continue

                if stat.st_size > self._max_file_size:
                    logger.debug(f"跳过过大文件 {abs_path}: {stat.st_size}")
                    continue

                # 读取并分类
                lines = self._read_text_lines(abs_path)
                is_binary = len(lines) == 0 and stat.st_size > 0

                # 计算哈希
                try:
                    with open(abs_path, "rb") as f:
                        content = f.read()
                    file_hash = self._compute_hash(content)
                except (OSError, IOError):
                    file_hash = ""

                language = self._detect_language(rel_path)
                language_counter[language] = language_counter.get(language, 0) + 1

                file_index[rel_path] = FileEntry(
                    path=rel_path,
                    abs_path=abs_path,
                    size=stat.st_size,
                    mtime=stat.st_mtime,
                    hash=file_hash,
                    language=language,
                    line_count=len(lines),
                    is_binary=is_binary,
                    is_ignored=False,
                )

                # 提取符号
                if not is_binary and language in SYMBOL_PATTERNS:
                    symbols = self._extract_symbols(rel_path, lines, language)
                    symbol_index.extend(symbols)

                total_lines += len(lines)
                files_scanned += 1

        build_time_ms = int((time.time() - start_time) * 1000)
        stats = CodebaseStats(
            session_id=session_id,
            project_root=project_root,
            total_files=len(file_index),
            total_symbols=len(symbol_index),
            total_lines=total_lines,
            languages=language_counter,
            indexed_at=time.time(),
            build_time_ms=build_time_ms,
            fs_watch_active=False,
        )

        with self._lock:
            self._sessions[session_id] = {
                "project_root": project_root,
                "file_index": file_index,
                "symbol_index": symbol_index,
                "stats": stats,
                "dirty_files": set(),
            }

        logger.info(
            f"索引构建完成: session={session_id} files={len(file_index)} "
            f"symbols={len(symbol_index)} time={build_time_ms}ms"
        )

        return stats

    # ============================================================
    # 索引查询
    # ============================================================

    def get_stats(self, session_id: str) -> CodebaseStats:
        """获取索引统计"""
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise IndexNotFoundError(f"索引不存在: {session_id}")
            return session["stats"]

    def get_file(
        self, session_id: str, path: str, line_start: int = 0, line_end: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        读取文件片段

        Args:
            session_id: 索引会话
            path: 相对路径
            line_start: 起始行（0-indexed）
            line_end: 结束行（None = 到文件末尾）

        Returns:
            { path, language, total_lines, lines: [{line_no, content}] }
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise IndexNotFoundError(f"索引不存在: {session_id}")
            project_root = session["project_root"]
            file_index = session["file_index"]

        file_entry = file_index.get(path)
        if not file_entry:
            raise FileNotFoundError(f"索引中无此文件: {path}")

        abs_path = os.path.join(project_root, path)
        if not os.path.exists(abs_path):
            raise FileNotFoundError(f"文件不存在: {abs_path}")

        try:
            with open(abs_path, "rb") as f:
                content = f.read()
        except (OSError, IOError) as e:
            raise FileNotFoundError(f"读取失败: {e}")

        if self._is_binary(content):
            raise CodebaseIndexerError(f"二进制文件: {path}")

        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("latin-1", errors="replace")

        all_lines = text.splitlines()
        total_lines = len(all_lines)

        if line_end is None or line_end > total_lines:
            line_end = total_lines
        if line_start < 0:
            line_start = 0
        if line_start > line_end:
            line_start = line_end

        lines = [
            {"line_no": i + 1, "content": all_lines[i]}
            for i in range(line_start, line_end)
        ]

        return {
            "path": path,
            "language": file_entry.language,
            "total_lines": total_lines,
            "lines": lines,
        }

    def search(
        self,
        session_id: str,
        query: str,
        top_k: int = 20,
        file_pattern: Optional[str] = None,
        include_symbols: bool = True,
    ) -> List[SearchResult]:
        """
        搜索代码库

        Args:
            session_id: 索引会话
            query: 搜索关键词
            top_k: 返回结果数
            file_pattern: 文件名 glob 模式（如 "*.py"）
            include_symbols: 是否包含符号搜索

        Returns:
            SearchResult 列表
        """
        if not query or not query.strip():
            raise InvalidQueryError("查询不能为空")
        if len(query) > 500:
            raise InvalidQueryError("查询过长（>500 chars）")

        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise IndexNotFoundError(f"索引不存在: {session_id}")
            project_root = session["project_root"]
            file_index = session["file_index"]
            symbol_index = session["symbol_index"]

        # 关键词提取
        terms = self._tokenize(query)
        if not terms:
            return []

        # 文件过滤
        candidate_files = self._filter_files(file_index, file_pattern)

        # 1. 文本搜索
        text_hits: List[TextHit] = []
        for rel_path in candidate_files:
            abs_path = os.path.join(project_root, rel_path)
            lines = self._read_text_lines(abs_path)
            if not lines:
                continue

            hit = self._scan_lines(rel_path, lines, terms)
            if hit:
                text_hits.append(hit)

        # 2. 符号搜索
        symbol_hits: List[SearchResult] = []
        if include_symbols:
            for sym in symbol_index:
                score = self._match_symbol(sym, terms)
                if score > 0:
                    symbol_hits.append(
                        SearchResult(
                            type="symbol",
                            file=sym.file,
                            line=sym.line,
                            name=sym.name,
                            kind=sym.kind,
                            signature=sym.signature,
                            score=score,
                        )
                    )

        # 3. 合并 + 排序
        merged: List[SearchResult] = []
        for hit in text_hits:
            merged.append(
                SearchResult(
                    type="text",
                    file=hit.file,
                    line_start=hit.line_start,
                    line_end=hit.line_end,
                    snippet=hit.snippet,
                    score=hit.score,
                )
            )
        merged.extend(symbol_hits)
        merged.sort(key=lambda r: r.score, reverse=True)
        return merged[:top_k]

    def _tokenize(self, query: str) -> List[str]:
        """分词（支持驼峰、下划线、空格分隔）"""
        # 1. 先拆分驼峰（保持原大小写）
        #    fetchData -> fetch, Data；FetchData -> Fetch, Data
        camel_parts = re.findall(
            r"[A-Z][a-z]*|[A-Z]+(?=[A-Z][a-z]|\b)|[a-z]+|[0-9]+", query
        )
        # 2. 每个部分转小写，并按非字母数字拆分（处理下划线、空格等）
        result: List[str] = []
        for part in camel_parts:
            sub = re.findall(r"[a-z]+|[0-9]+", part.lower())
            for s in sub:
                if s:
                    result.append(s)
        return result

    def _filter_files(
        self, file_index: Dict[str, FileEntry], file_pattern: Optional[str]
    ) -> List[str]:
        """按 glob 模式过滤文件"""
        if not file_pattern:
            return list(file_index.keys())

        import fnmatch
        return [p for p in file_index if fnmatch.fnmatch(p, file_pattern)]

    def _scan_lines(
        self, file_path: str, lines: List[str], terms: List[str]
    ) -> Optional[TextHit]:
        """扫描文件行，查找匹配"""
        matched_lines: List[int] = []
        matched_terms: Set[str] = set()

        for line_no, line in enumerate(lines):
            line_lower = line.lower()
            for term in terms:
                if term in line_lower:
                    matched_lines.append(line_no)
                    matched_terms.add(term)
                    break

        if not matched_lines:
            return None

        # 合并连续行
        clusters: List[Tuple[int, int]] = []
        current_start = matched_lines[0]
        current_end = matched_lines[0]
        for ln in matched_lines[1:]:
            if ln <= current_end + 3:  # 3 行内合并
                current_end = ln
            else:
                clusters.append((current_start, current_end))
                current_start = ln
                current_end = ln
        clusters.append((current_start, current_end))

        # 取第一个 cluster（最强匹配）
        line_start, line_end = clusters[0]
        context_start = max(0, line_start - 2)
        context_end = min(len(lines) - 1, line_end + 2)

        snippet_lines = lines[context_start : context_end + 1]
        snippet = "\n".join(snippet_lines)

        # 评分
        score = TEXT_MATCH_SCORE_BASE
        if all(t in "\n".join(lines).lower() for t in terms):
            score += EXACT_MATCH_BOOST
        # 文件名匹配加成
        file_path_lower = file_path.lower()
        for term in terms:
            if term in file_path_lower:
                score += PATH_MATCH_BOOST
                break
        # 匹配行数加成
        score += min(0.2, len(matched_lines) * 0.01)

        return TextHit(
            file=file_path,
            line_start=line_start + 1,
            line_end=line_end + 1,
            snippet=snippet,
            matched_terms=sorted(matched_terms),
            score=min(1.0, score),
        )

    def _match_symbol(self, sym: SymbolEntry, terms: List[str]) -> float:
        """计算符号与查询的匹配分数"""
        name_lower = sym.name.lower()
        score = 0.0
        for term in terms:
            if term == name_lower:
                score += SYMBOL_MATCH_SCORE
            elif term in name_lower:
                score += 0.7
        return min(1.0, score)

    # ============================================================
    # 增量更新
    # ============================================================

    def on_file_changed(self, session_id: str, path: str) -> None:
        """
        FS Watch 回调：标记文件为脏

        Args:
            session_id: 索引会话
            path: 相对路径
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            session["dirty_files"].add(path)

        # 异步重建该文件（同步执行简化版）
        self._reindex_file(session_id, path)

    def _reindex_file(self, session_id: str, path: str) -> None:
        """重建单个文件的索引条目"""
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            project_root = session["project_root"]
            file_index = session["file_index"]
            symbol_index = session["symbol_index"]

        abs_path = os.path.join(project_root, path)

        # 1. 移除旧条目
        if path in file_index:
            old_entry = file_index[path]
            symbol_index[:] = [
                s for s in symbol_index if not (s.file == path)
            ]
            # 更新统计
            session["stats"].total_symbols = len(symbol_index)
            session["stats"].total_lines -= old_entry.line_count
            lang = old_entry.language
            if lang in session["stats"].languages:
                session["stats"].languages[lang] = max(
                    0, session["stats"].languages[lang] - 1
                )

        # 2. 文件不存在 → 标记删除
        if not os.path.exists(abs_path):
            if path in file_index:
                del file_index[path]
                session["stats"].total_files = len(file_index)
            with self._lock:
                session["dirty_files"].discard(path)
            return

        # 3. 重建条目
        try:
            stat = os.stat(abs_path)
        except OSError:
            return
        if stat.st_size > self._max_file_size:
            return

        try:
            with open(abs_path, "rb") as f:
                content = f.read()
        except (OSError, IOError):
            return

        lines = self._read_text_lines(abs_path)
        is_binary = self._is_binary(content)
        language = self._detect_language(path)
        file_hash = self._compute_hash(content)

        new_entry = FileEntry(
            path=path,
            abs_path=abs_path,
            size=stat.st_size,
            mtime=stat.st_mtime,
            hash=file_hash,
            language=language,
            line_count=len(lines),
            is_binary=is_binary,
            is_ignored=False,
        )

        with self._lock:
            file_index[path] = new_entry
            session["stats"].total_files = len(file_index)
            session["stats"].total_lines += len(lines)
            if not is_binary and language in SYMBOL_PATTERNS:
                symbols = self._extract_symbols(path, lines, language)
                symbol_index.extend(symbols)
                session["stats"].total_symbols = len(symbol_index)
            lang_counter = session["stats"].languages
            lang_counter[language] = lang_counter.get(language, 0) + 1
            session["dirty_files"].discard(path)

    def remove_session(self, session_id: str) -> bool:
        """移除索引会话"""
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False

    def list_sessions(self) -> List[str]:
        """列出所有索引会话"""
        with self._lock:
            return list(self._sessions.keys())


# ============================================================
# 全局单例
# ============================================================


_codebase_indexer: Optional[CodebaseIndexer] = None
_codebase_indexer_lock = threading.Lock()


def get_codebase_indexer() -> CodebaseIndexer:
    """获取全局 CodebaseIndexer 实例（线程安全）"""
    global _codebase_indexer
    if _codebase_indexer is None:
        with _codebase_indexer_lock:
            if _codebase_indexer is None:
                _codebase_indexer = CodebaseIndexer()
    return _codebase_indexer


def reset_codebase_indexer() -> None:
    """重置全局实例（仅测试）"""
    global _codebase_indexer
    _codebase_indexer = None
