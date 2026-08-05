"""
# ============================================================
# SessionReplayService - 会话回放系统 (v1.0.0)
# Cycle 69 G69-02
# ============================================================
# 核心作用：提供会话完整回放与审计能力：
#   1. 扫描本地 JSONL 文件，提取 SessionMetadata
#   2. 解析每条 turn（user / assistant / tool / reasoning）
#   3. 生成自包含 HTML（可离线打开）
#   4. 书签管理（持久化到 ~/.hermes/bookmarks/）
#   5. Retention Policy（自动压缩 + 清理）
#   6. 4 种主题样式（default / dark / light / oxide-blue）
# 运行流程：
#   1. list_sessions()   → 扫描所有 rollout JSONL 文件
#   2. load_session()    → 解析所有 turn
#   3. render_html()     → 用 jinja2/str 模板生成自包含 HTML
#   4. apply_retention() → 压缩 + 清理
# 设计要点：
#   - 不依赖 jinja2（用 str.format 简化部署）
#   - 所有用户内容 HTML escape 防 XSS
#   - 单 HTML < 10MB
#   - session_id 严格校验防路径遍历
#   - Retention 可配置 max_age_days / max_size_bytes
# 输入参数：session_id, ReplayConfig, RetentionPolicy
# 输出结果：SessionMetadata / ReplayTurn / HTML / Bookmark
# 对标：codex-replay + Codex session picker + Codex JSONL
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-02 初次创建
# ====================================
"""

from __future__ import annotations

import builtins
import gzip
import hashlib
import json
import logging
import os
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from glob import glob
from html import escape as html_escape
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

HERMES_BASE_DIR = Path.home() / ".hermes"
SESSIONS_DIR = HERMES_BASE_DIR / "sessions"
ROLLOUTS_DIR = HERMES_BASE_DIR / "rollouts"
BOOKMARKS_DIR = HERMES_BASE_DIR / "bookmarks"
INDEX_FILE = HERMES_BASE_DIR / "session_index.json"
HTML_OUTPUT_DIR = HERMES_BASE_DIR / "replays"

for d in (SESSIONS_DIR, ROLLOUTS_DIR, BOOKMARKS_DIR, HTML_OUTPUT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# session_id 严格校验：仅允许 [a-zA-Z0-9_-]，1-128 字符
SESSION_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
DEFAULT_MAX_AGE_DAYS = 90
DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024  # 100MB
DEFAULT_COMPRESS_AFTER_DAYS = 7
MAX_HTML_SIZE_BYTES = 10 * 1024 * 1024  # 10MB


# ============================================================
# 数据模型
# ============================================================


class ReplayTheme(str, Enum):
    """主题"""
    DEFAULT = "default"
    DARK = "dark"
    LIGHT = "light"
    OXIDE_BLUE = "oxide-blue"


@dataclass
class SessionMetadata:
    """会话元数据"""
    session_id: str
    title: str = ""                # 第一条 user message
    created_at: str = ""
    updated_at: str = ""
    total_turns: int = 0
    total_tokens: int = 0
    cwd: str = ""
    git_branch: Optional[str] = None
    duration_ms: int = 0
    rollout_path: str = ""         # JSONL 文件路径
    size_bytes: int = 0
    model: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ToolCall:
    """工具调用"""
    name: str
    args: Dict[str, Any] = field(default_factory=dict)
    output: str = ""
    call_id: str = ""
    duration_ms: int = 0
    exit_code: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ReplayTurn:
    """回放轮次"""
    turn_index: int
    timestamp: str
    role: str                     # user | assistant | tool | system
    content: str = ""
    reasoning: Optional[str] = None
    tool_calls: List[ToolCall] = field(default_factory=list)
    tool_outputs: List[str] = field(default_factory=list)
    tokens: int = 0
    duration_ms: int = 0
    model: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["tool_calls"] = [tc.to_dict() if hasattr(tc, "to_dict") else tc for tc in self.tool_calls]
        # raw 字段包含原始 payload（如 user message 的 message 字段），
        # 其中可能含有 <script> 等敏感字符。不放入 JSON，防止 XSS。
        d.pop("raw", None)
        return d


@dataclass
class ReplayConfig:
    """回放配置"""
    show_reasoning: bool = True
    show_tool_calls: bool = True
    show_system: bool = False
    theme: ReplayTheme = ReplayTheme.DEFAULT
    from_timestamp: Optional[str] = None
    to_timestamp: Optional[str] = None
    speed: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["theme"] = self.theme.value
        return d


@dataclass
class RetentionPolicy:
    """保留策略"""
    max_age_days: int = DEFAULT_MAX_AGE_DAYS
    max_size_bytes: int = DEFAULT_MAX_SIZE_BYTES
    compress_after_days: int = DEFAULT_COMPRESS_AFTER_DAYS

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Bookmark:
    """书签"""
    bookmark_id: str
    session_id: str
    turn_index: int
    label: str
    created_at: str
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RetentionResult:
    """Retention 应用结果"""
    compressed: int = 0
    cleaned: int = 0
    total_size_before: int = 0
    total_size_after: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class StorageStats:
    """存储统计"""
    total_sessions: int = 0
    total_size_bytes: int = 0
    total_bookmarks: int = 0
    oldest_session_at: Optional[str] = None
    by_age_days: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 自定义异常
# ============================================================


class SessionReplayError(Exception):
    """通用错误"""
    pass


class SessionNotFoundError(SessionReplayError):
    """会话不存在"""
    pass


class InvalidSessionIdError(SessionReplayError):
    """session_id 格式错误"""
    pass


class RenderTooLargeError(SessionReplayError):
    """HTML 渲染超过限制"""
    pass


# ============================================================
# 服务实现
# ============================================================


class SessionReplayService:
    """
    SessionReplayService 主类。

    用法：
        svc = SessionReplayService()
        sessions = svc.list_sessions(limit=50)
        turns = svc.load_session(sessions[0].session_id)
        html = svc.render_html(sessions[0].session_id)
    """

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = Path(base_dir) if base_dir else HERMES_BASE_DIR
        self.sessions_dir = self.base_dir / "sessions"
        self.rollouts_dir = self.base_dir / "rollouts"
        self.bookmarks_dir = self.base_dir / "bookmarks"
        self.html_output_dir = self.base_dir / "replays"
        for d in (self.sessions_dir, self.rollouts_dir, self.bookmarks_dir, self.html_output_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------
    # session_id 校验
    # ------------------------------------------------------------

    @staticmethod
    def validate_session_id(session_id: str) -> None:
        if not session_id or not SESSION_ID_PATTERN.match(session_id):
            raise InvalidSessionIdError(
                f"Invalid session_id format: {session_id!r}. Allowed: [a-zA-Z0-9_-]{{1,128}}"
            )

    # ------------------------------------------------------------
    # 会话列表
    # ------------------------------------------------------------

    def list_sessions(self, limit: int = 100) -> List[SessionMetadata]:
        """列出所有会话（按 updated_at 倒序）"""
        sessions: List[SessionMetadata] = []
        # 扫描两个目录
        for base in (self.sessions_dir, self.rollouts_dir):
            if not base.exists():
                continue
            for pattern in ("**/rollout-*.jsonl", "**/rollout-*.jsonl.gz", "**/*.jsonl"):
                for path in base.glob(pattern):
                    try:
                        meta = self._parse_session_metadata(path)
                        if meta:
                            sessions.append(meta)
                    except Exception as e:
                        logger.warning("failed to parse session %s: %s", path, e)
        # 去重（按 session_id 保留最新的）
        unique: Dict[str, SessionMetadata] = {}
        for s in sessions:
            existing = unique.get(s.session_id)
            if existing is None or s.updated_at > existing.updated_at:
                unique[s.session_id] = s
        # 排序 + 截取
        result = sorted(unique.values(), key=lambda s: s.updated_at, reverse=True)
        return result[:limit]

    def _parse_session_metadata(self, path: Path) -> Optional[SessionMetadata]:
        """从 JSONL 文件中解析元数据"""
        if not path.exists():
            return None
        size = path.stat().st_size
        # session_id 优先从文件名提取
        session_id = self._session_id_from_path(path)
        if not session_id:
            return None
        # 读取文件，提取元信息
        opener = gzip.open if path.suffix == ".gz" else builtins.open
        title = ""
        created_at = ""
        updated_at = ""
        total_turns = 0
        total_tokens = 0
        cwd = ""
        git_branch = None
        duration_ms = 0
        first_ts = None
        last_ts = None
        model = None
        try:
            with opener(path, "rt", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    item_type = item.get("type", "")
                    payload = item.get("payload", item)
                    ts = item.get("timestamp", "")
                    if ts and not first_ts:
                        first_ts = ts
                    if ts:
                        last_ts = ts
                    if item_type == "session_meta" or payload.get("kind") == "session_meta":
                        created_at = payload.get("created_at", created_at) or created_at
                        cwd = payload.get("cwd", cwd) or cwd
                        git_branch = payload.get("git_branch", git_branch) or git_branch
                        model = payload.get("model", model) or model
                        total_turns = payload.get("total_turns", total_turns) or total_turns
                        total_tokens = payload.get("total_tokens", total_tokens) or total_tokens
                        if "session_id" in payload:
                            session_id = payload["session_id"]
                    elif item_type == "response_item" or item_type == "event_msg":
                        # 计算 turn
                        if item_type == "event_msg":
                            msg_type = payload.get("type", "")
                            if msg_type in ("user_message", "agent_message", "turn_started"):
                                total_turns += 1
                            if msg_type == "user_message" and not title:
                                title = payload.get("message", "")[:200]
                        # token 累加
                        if "tokens" in payload:
                            total_tokens += int(payload["tokens"])
        except (OSError, gzip.BadGzipFile) as e:
            logger.warning("failed to read %s: %s", path, e)
            return None
        if not created_at and first_ts:
            created_at = first_ts
        if not updated_at and last_ts:
            updated_at = last_ts
        return SessionMetadata(
            session_id=session_id,
            title=title or f"Session {session_id[:8]}",
            created_at=created_at,
            updated_at=updated_at,
            total_turns=total_turns,
            total_tokens=total_tokens,
            cwd=cwd,
            git_branch=git_branch,
            duration_ms=duration_ms,
            rollout_path=str(path),
            size_bytes=size,
            model=model,
        )

    def _session_id_from_path(self, path: Path) -> str:
        """从路径中提取 session_id（路径如 sessions/{session_id}/rollout.jsonl）"""
        # 跳过通用目录名
        parent = path.parent.name
        if parent and parent not in ("sessions", "rollouts", ".", "/") and SESSION_ID_PATTERN.match(parent):
            return parent
        # 文件名匹配 rollout-{session_id}.jsonl
        m = re.search(r"rollout[-_]([a-zA-Z0-9_-]+)\.jsonl", path.name)
        if m:
            return m.group(1)
        # 最后回退：path.stem
        if SESSION_ID_PATTERN.match(path.stem):
            return path.stem
        return ""

    # ------------------------------------------------------------
    # 加载会话
    # ------------------------------------------------------------

    def load_session(self, session_id: str) -> List[ReplayTurn]:
        """加载会话的所有 turn"""
        self.validate_session_id(session_id)
        path = self._find_rollout_path(session_id)
        if path is None:
            raise SessionNotFoundError(f"Session not found: {session_id}")
        return self._parse_turns(path)

    def _find_rollout_path(self, session_id: str) -> Optional[Path]:
        """查找会话的 JSONL 文件"""
        candidates = [
            self.sessions_dir / session_id / "rollout.jsonl",
            self.rollouts_dir / f"rollout-{session_id}.jsonl",
            self.rollouts_dir / session_id / "rollout.jsonl",
        ]
        for c in candidates:
            if c.exists():
                return c
        # 模糊匹配
        for base in (self.sessions_dir, self.rollouts_dir):
            if not base.exists():
                continue
            for path in base.glob(f"**/*{session_id}*.jsonl"):
                if SESSION_ID_PATTERN.match(path.stem.replace("rollout-", "")) or session_id in path.name:
                    return path
        return None

    def _parse_turns(self, path: Path) -> List[ReplayTurn]:
        """解析 JSONL 为 turn 列表"""
        opener = gzip.open if path.suffix == ".gz" else builtins.open
        turns: List[ReplayTurn] = []
        idx = 0
        try:
            with opener(path, "rt", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    turn = self._item_to_turn(item, idx)
                    if turn is not None:
                        turns.append(turn)
                        idx += 1
        except (OSError, gzip.BadGzipFile) as e:
            logger.warning("failed to read %s: %s", path, e)
        return turns

    def _item_to_turn(self, item: Dict[str, Any], idx: int) -> Optional[ReplayTurn]:
        """将单个 JSONL item 转为 ReplayTurn"""
        item_type = item.get("type", "")
        payload = item.get("payload", item)
        ts = item.get("timestamp", item.get("ts", ""))
        if item_type == "response_item":
            sub_type = payload.get("type", payload.get("role", "text"))
            role = payload.get("role", "assistant")
            content = ""
            reasoning = None
            tool_calls: List[ToolCall] = []
            if sub_type == "text" or "text" in payload:
                content = payload.get("text", payload.get("content", ""))
            elif sub_type == "reasoning":
                reasoning = payload.get("text", payload.get("summary", ""))
                content = payload.get("text", "")
            elif sub_type == "function_call":
                tool_calls.append(ToolCall(
                    name=payload.get("name", "tool"),
                    args=payload.get("arguments", payload.get("args", {})),
                    call_id=payload.get("call_id", str(uuid.uuid4())),
                ))
            elif sub_type == "function_call_output":
                return ReplayTurn(
                    turn_index=idx,
                    timestamp=ts,
                    role="tool",
                    content=payload.get("output", ""),
                    tool_outputs=[payload.get("output", "")],
                )
            return ReplayTurn(
                turn_index=idx,
                timestamp=ts,
                role=role,
                content=content,
                reasoning=reasoning,
                tool_calls=tool_calls,
                tokens=int(payload.get("tokens", 0)),
                duration_ms=int(payload.get("duration_ms", 0)),
                model=payload.get("model"),
                raw=item,
            )
        elif item_type == "event_msg":
            msg_type = payload.get("type", "")
            role = "system"
            content = ""
            if msg_type == "user_message":
                role = "user"
                content = payload.get("message", "")
            elif msg_type == "agent_message":
                role = "assistant"
                content = payload.get("message", "")
            elif msg_type == "tool_call":
                role = "tool"
                content = payload.get("output", "")
            elif msg_type == "turn_started":
                return None  # 不生成 turn
            elif msg_type == "turn_completed":
                return None
            return ReplayTurn(
                turn_index=idx,
                timestamp=ts,
                role=role,
                content=content,
                tokens=int(payload.get("tokens", 0)),
                duration_ms=int(payload.get("duration_ms", 0)),
                raw=item,
            )
        elif item_type == "session_meta" or payload.get("kind") == "session_meta":
            return None  # 元数据不生成 turn
        # 兜底：直接转 raw
        return ReplayTurn(
            turn_index=idx,
            timestamp=ts,
            role=payload.get("role", "system"),
            content=str(payload)[:500],
            raw=item,
        )

    # ------------------------------------------------------------
    # 渲染 HTML
    # ------------------------------------------------------------

    def render_html(self, session_id: str, config: Optional[ReplayConfig] = None) -> str:
        """生成自包含 HTML（可离线打开）"""
        self.validate_session_id(session_id)
        config = config or ReplayConfig()
        turns = self.load_session(session_id)
        html = self._render_html_template(turns, config, session_id)
        if len(html.encode("utf-8")) > MAX_HTML_SIZE_BYTES:
            raise RenderTooLargeError(f"Rendered HTML exceeds {MAX_HTML_SIZE_BYTES} bytes")
        # 持久化
        out_path = self.html_output_dir / f"{session_id}.html"
        try:
            out_path.write_text(html, encoding="utf-8")
        except OSError as e:
            logger.warning("failed to write replay HTML %s: %s", out_path, e)
        return html

    def _render_html_template(self, turns: List[ReplayTurn], config: ReplayConfig, session_id: str) -> str:
        """生成自包含 HTML（无 jinja2 依赖，使用 str.replace）"""
        # 主题 CSS
        css = THEME_CSS.get(config.theme.value, THEME_CSS["default"])
        # 过滤 turns
        filtered = []
        for t in turns:
            if not config.show_system and t.role == "system":
                continue
            if not config.show_tool_calls and t.role == "tool":
                continue
            if not config.show_reasoning and t.reasoning:
                # 移除 reasoning 字段
                t.reasoning = None
            filtered.append(t)
        # 序列化 turns（HTML escape）
        turns_data = []
        for t in filtered:
            d = t.to_dict()
            # HTML escape 文本字段
            d["content"] = html_escape(d.get("content", "") or "")
            d["reasoning"] = html_escape(d.get("reasoning", "") or "") if d.get("reasoning") else None
            turns_data.append(d)
        turns_json = json.dumps(turns_data, ensure_ascii=False)
        # 使用 str.replace 避免 CSS 中 {} 与 .format 冲突
        html = HTML_TEMPLATE
        html = html.replace("__CSS__", css)
        html = html.replace("__SESSION_ID__", html_escape(session_id))
        html = html.replace("__TURNS_JSON__", turns_json)
        html = html.replace("__TOTAL_TURNS__", str(len(filtered)))
        html = html.replace("__SHOW_REASONING__", str(config.show_reasoning).lower())
        html = html.replace("__SHOW_TOOL_CALLS__", str(config.show_tool_calls).lower())
        html = html.replace("__SHOW_SYSTEM__", str(config.show_system).lower())
        html = html.replace("__SPEED__", str(config.speed))
        return html

    # ------------------------------------------------------------
    # 书签
    # ------------------------------------------------------------

    def save_bookmark(
        self,
        session_id: str,
        turn_index: int,
        label: str,
        note: str = "",
    ) -> Bookmark:
        """添加书签"""
        self.validate_session_id(session_id)
        if turn_index < 0:
            raise SessionReplayError(f"turn_index must be >= 0, got {turn_index}")
        if not label:
            label = f"Bookmark at turn {turn_index}"
        bookmark = Bookmark(
            bookmark_id=f"bm-{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            turn_index=turn_index,
            label=label[:200],
            note=note[:1000],
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        # 持久化
        bm_file = self.bookmarks_dir / f"{session_id}.jsonl"
        try:
            with builtins.open(bm_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(bookmark.to_dict(), ensure_ascii=False) + "\n")
        except OSError as e:
            logger.warning("failed to write bookmark: %s", e)
            raise SessionReplayError(f"Failed to save bookmark: {e}") from e
        return bookmark

    def list_bookmarks(self, session_id: str) -> List[Bookmark]:
        """列出某会话的所有书签"""
        self.validate_session_id(session_id)
        bm_file = self.bookmarks_dir / f"{session_id}.jsonl"
        if not bm_file.exists():
            return []
        bookmarks: List[Bookmark] = []
        try:
            with builtins.open(bm_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        d = json.loads(line)
                        bookmarks.append(Bookmark(**d))
                    except (json.JSONDecodeError, TypeError):
                        continue
        except OSError:
            return []
        return bookmarks

    def delete_bookmark(self, session_id: str, bookmark_id: str) -> bool:
        """删除书签"""
        self.validate_session_id(session_id)
        bm_file = self.bookmarks_dir / f"{session_id}.jsonl"
        if not bm_file.exists():
            return False
        kept: List[str] = []
        removed = False
        try:
            with builtins.open(bm_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in lines:
                line_stripped = line.strip()
                if not line_stripped:
                    kept.append(line)
                    continue
                try:
                    d = json.loads(line_stripped)
                    if d.get("bookmark_id") == bookmark_id:
                        removed = True
                        continue
                except json.JSONDecodeError:
                    pass
                kept.append(line)
            with builtins.open(bm_file, "w", encoding="utf-8") as f:
                f.writelines(kept)
        except OSError as e:
            logger.warning("failed to delete bookmark: %s", e)
            return False
        return removed

    # ------------------------------------------------------------
    # Retention
    # ------------------------------------------------------------

    def apply_retention(self, policy: Optional[RetentionPolicy] = None) -> RetentionResult:
        """应用保留策略：清理过期 + 压缩老文件"""
        policy = policy or RetentionPolicy()
        result = RetentionResult()
        now = time.time()
        # 1. 计算当前总大小
        for base in (self.sessions_dir, self.rollouts_dir):
            if not base.exists():
                continue
            for path in base.rglob("*.jsonl"):
                try:
                    result.total_size_before += path.stat().st_size
                except OSError:
                    pass
        # 2. 压缩
        for base in (self.sessions_dir, self.rollouts_dir):
            if not base.exists():
                continue
            for path in base.rglob("*.jsonl"):
                try:
                    stat = path.stat()
                    age_days = (now - stat.st_mtime) / 86400
                    if age_days > policy.compress_after_days and not str(path).endswith(".gz"):
                        gz_path = path.with_suffix(path.suffix + ".gz")
                        if gz_path.exists():
                            continue
                        with builtins.open(path, "rb") as f_in:
                            with gzip.open(gz_path, "wb") as f_out:
                                f_out.writelines(f_in)
                        # 保留原 mtime（用于后续 retention 判断）
                        orig_mtime = stat.st_mtime
                        path.unlink()
                        os.utime(gz_path, (orig_mtime, orig_mtime))
                        result.compressed += 1
                except OSError as e:
                    logger.warning("compress failed for %s: %s", path, e)
        # 3. 清理过期
        for base in (self.sessions_dir, self.rollouts_dir):
            if not base.exists():
                continue
            for path in base.rglob("*.jsonl*"):
                try:
                    stat = path.stat()
                    age_days = (now - stat.st_mtime) / 86400
                    if age_days > policy.max_age_days:
                        path.unlink()
                        result.cleaned += 1
                except OSError as e:
                    logger.warning("cleanup failed for %s: %s", path, e)
        # 4. 计算清理后大小
        for base in (self.sessions_dir, self.rollouts_dir):
            if not base.exists():
                continue
            for path in base.rglob("*.jsonl*"):
                try:
                    result.total_size_after += path.stat().st_size
                except OSError:
                    pass
        return result

    # ------------------------------------------------------------
    # 统计 & 导出
    # ------------------------------------------------------------

    def get_stats(self) -> StorageStats:
        """获取存储统计"""
        stats = StorageStats()
        sessions = self.list_sessions(limit=10000)
        stats.total_sessions = len(sessions)
        if sessions:
            stats.oldest_session_at = min((s.created_at for s in sessions if s.created_at), default=None)
        for s in sessions:
            stats.total_size_bytes += s.size_bytes
        # 书签统计
        if self.bookmarks_dir.exists():
            for bm_file in self.bookmarks_dir.glob("*.jsonl"):
                try:
                    with builtins.open(bm_file, "r", encoding="utf-8") as f:
                        for line in f:
                            if line.strip():
                                stats.total_bookmarks += 1
                except OSError:
                    pass
        return stats

    def export_session(self, session_id: str, format: str = "json") -> bytes:
        """导出会话"""
        self.validate_session_id(session_id)
        turns = self.load_session(session_id)
        if format == "json":
            return json.dumps(
                [t.to_dict() for t in turns],
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8")
        elif format == "jsonl":
            return "\n".join(
                json.dumps(t.to_dict(), ensure_ascii=False) for t in turns
            ).encode("utf-8")
        elif format == "md":
            return self._export_markdown(turns, session_id).encode("utf-8")
        else:
            raise SessionReplayError(f"Unknown format: {format}")

    def _export_markdown(self, turns: List[ReplayTurn], session_id: str) -> str:
        """导出 Markdown 格式"""
        lines = [f"# Session {session_id}", ""]
        for t in turns:
            role_label = {"user": "👤 User", "assistant": "🤖 Assistant", "tool": "🔧 Tool", "system": "⚙️ System"}.get(t.role, t.role)
            lines.append(f"## Turn {t.turn_index} - {role_label}")
            if t.timestamp:
                lines.append(f"*{t.timestamp}*")
            lines.append("")
            if t.content:
                lines.append(t.content)
            if t.reasoning:
                lines.append("")
                lines.append(f"> **Reasoning:** {t.reasoning}")
            for tc in t.tool_calls:
                lines.append("")
                lines.append(f"**Tool Call**: `{tc.name}`")
                if tc.args:
                    lines.append("```json")
                    lines.append(json.dumps(tc.args, ensure_ascii=False, indent=2))
                    lines.append("```")
            lines.append("")
            lines.append("---")
            lines.append("")
        return "\n".join(lines)


# ============================================================
# HTML 模板 & 主题 CSS
# ============================================================


THEME_CSS: Dict[str, str] = {
    "default": """
        :root {
            --bg-app: #ffffff;
            --bg-panel: #f8f9fa;
            --bg-elevated: #ffffff;
            --text-primary: #1a1a1a;
            --text-secondary: #6c757d;
            --accent: #0d6efd;
            --border: #dee2e6;
        }
    """,
    "dark": """
        :root {
            --bg-app: #1a1a1a;
            --bg-panel: #2d2d2d;
            --bg-elevated: #363636;
            --text-primary: #e0e0e0;
            --text-secondary: #999999;
            --accent: #4dabf7;
            --border: #444444;
        }
    """,
    "light": """
        :root {
            --bg-app: #fafafa;
            --bg-panel: #ffffff;
            --bg-elevated: #f0f0f0;
            --text-primary: #222222;
            --text-secondary: #555555;
            --accent: #1976d2;
            --border: #e0e0e0;
        }
    """,
    "oxide-blue": """
        :root {
            --bg-app: #0e1e2b;
            --bg-panel: #15303f;
            --bg-elevated: #1a3a4f;
            --text-primary: #e3f2fd;
            --text-secondary: #90caf9;
            --accent: #29b6f6;
            --border: #1e4d63;
        }
    """,
}


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Session Replay - __SESSION_ID__</title>
<style>
__CSS__
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg-app);
    color: var(--text-primary);
    padding: 24px;
    line-height: 1.6;
}
.container { max-width: 900px; margin: 0 auto; }
header {
    background: var(--bg-panel);
    padding: 16px 24px;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin-bottom: 24px;
}
h1 { color: var(--text-primary); font-size: 24px; margin-bottom: 8px; }
.meta { color: var(--text-secondary); font-size: 14px; }
.controls {
    display: flex;
    gap: 12px;
    margin-top: 12px;
    flex-wrap: wrap;
}
.controls button {
    background: var(--accent);
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
}
.controls button:hover { opacity: 0.85; }
.turn {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
}
.turn-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--text-secondary);
}
.role {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 12px;
}
.role-user { background: #d1e7dd; color: #0a3622; }
.role-assistant { background: #cfe2ff; color: #052c65; }
.role-tool { background: #fff3cd; color: #664d03; }
.role-system { background: #e2e3e5; color: #2b2f33; }
[data-theme="dark"] .role-user,
[data-theme="oxide-blue"] .role-user,
[data-theme="dark"] .role-assistant,
[data-theme="oxide-blue"] .role-assistant,
[data-theme="dark"] .role-tool,
[data-theme="oxide-blue"] .role-tool {
    background: var(--bg-elevated);
    color: var(--text-primary);
}
.turn-content {
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text-primary);
}
.reasoning {
    background: var(--bg-elevated);
    border-left: 3px solid var(--accent);
    padding: 8px 12px;
    margin-top: 8px;
    border-radius: 4px;
    font-size: 13px;
    color: var(--text-secondary);
}
.tool-call {
    background: var(--bg-elevated);
    padding: 8px 12px;
    margin-top: 8px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 13px;
}
pre { background: var(--bg-elevated); padding: 8px; border-radius: 4px; overflow-x: auto; }
.bookmark {
    background: #fff3cd;
    border: 1px solid #ffc107;
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-block;
    font-size: 12px;
    margin-left: 8px;
}
.toolbar {
    position: sticky;
    top: 0;
    background: var(--bg-app);
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    z-index: 10;
    margin-bottom: 16px;
}
.empty { color: var(--text-secondary); text-align: center; padding: 40px; }
</style>
</head>
<body>
<div class="container">
<header>
    <h1>📼 Session Replay</h1>
    <div class="meta">Session ID: <code>__SESSION_ID__</code> | Total Turns: __TOTAL_TURNS__</div>
    <div class="controls">
        <button onclick="replayAll()">▶ Play All</button>
        <button onclick="pauseReplay()">⏸ Pause</button>
        <button onclick="showAll()">👁 Show All</button>
        <button onclick="toggleReasoning()">🧠 Toggle Reasoning</button>
        <button onclick="exportJSON()">⬇ Export JSON</button>
    </div>
</header>
<div id="replay-container"></div>
</div>
<script>
const TURNS = __TURNS_JSON__;
const CONFIG = {
    showReasoning: __SHOW_REASONING__,
    showToolCalls: __SHOW_TOOL_CALLS__,
    showSystem: __SHOW_SYSTEM__,
    speed: __SPEED__
};
let playInterval = null;
let visibleCount = 0;

function render() {
    const container = document.getElementById('replay-container');
    container.innerHTML = '';
    const toShow = TURNS.slice(0, visibleCount);
    if (toShow.length === 0) {
        container.innerHTML = '<div class="empty">No turns to display</div>';
        return;
    }
    for (const t of toShow) {
        if (!CONFIG.showSystem && t.role === 'system') continue;
        if (!CONFIG.showToolCalls && t.role === 'tool') continue;
        const div = document.createElement('div');
        div.className = 'turn';
        div.id = 'turn-' + t.turn_index;
        let html = '<div class="turn-header">';
        html += '<span class="role role-' + t.role + '">' + t.role + '</span>';
        html += '<span>Turn ' + t.turn_index + ' • ' + (t.timestamp || '') + '</span>';
        html += '</div>';
        if (t.content) {
            html += '<div class="turn-content">' + t.content + '</div>';
        }
        if (CONFIG.showReasoning && t.reasoning) {
            html += '<div class="reasoning">🧠 ' + t.reasoning + '</div>';
        }
        if (CONFIG.showToolCalls && t.tool_calls && t.tool_calls.length) {
            for (const tc of t.tool_calls) {
                html += '<div class="tool-call"><strong>🔧 ' + (tc.name || 'tool') + '</strong>';
                if (tc.args && Object.keys(tc.args).length) {
                    html += '<pre>' + JSON.stringify(tc.args, null, 2) + '</pre>';
                }
                html += '</div>';
            }
        }
        div.innerHTML = html;
        container.appendChild(div);
    }
    // 自动滚动
    const last = container.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function replayAll() {
    if (playInterval) clearInterval(playInterval);
    visibleCount = 0;
    render();
    const interval = Math.max(100, 1000 / CONFIG.speed);
    playInterval = setInterval(() => {
        visibleCount++;
        if (visibleCount >= TURNS.length) {
            clearInterval(playInterval);
            playInterval = null;
        }
        render();
    }, interval);
}

function pauseReplay() {
    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
    }
}

function showAll() {
    visibleCount = TURNS.length;
    render();
}

function toggleReasoning() {
    CONFIG.showReasoning = !CONFIG.showReasoning;
    render();
}

function exportJSON() {
    const blob = new Blob([JSON.stringify(TURNS, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '__SESSION_ID__.json';
    a.click();
    URL.revokeObjectURL(url);
}

// 初始渲染全部
visibleCount = TURNS.length;
render();
</script>
</body>
</html>"""


# ============================================================
# 模块级单例
# ============================================================

_replay_service_instance: Optional[SessionReplayService] = None


def get_session_replay_service() -> SessionReplayService:
    global _replay_service_instance
    if _replay_service_instance is None:
        _replay_service_instance = SessionReplayService()
    return _replay_service_instance


def reset_session_replay_service_for_test(base_dir: Optional[Path] = None) -> SessionReplayService:
    global _replay_service_instance
    _replay_service_instance = SessionReplayService(base_dir=base_dir)
    return _replay_service_instance
