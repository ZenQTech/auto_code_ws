"""
# TRAE Work 多模态协作 - 数据模型
# ============================================================
# 核心作用：定义 TRAE Work 4 大子系统的所有数据结构
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 子系统：
#   - Design Mode: 设计草图、设计系统、代码导出
#   - Voice Chat: 语音会话、Web 搜索
#   - Global Memory: 知识条目、跨会话记忆
#   - Video: 视频元数据、关键帧、摘要、生成
#
# 通用工具：
#   - _now_iso(): ISO 时间戳
#   - _new_id(prefix): 唯一 ID 生成
#   - safe_filename(): 文件名安全清洗
#   - path_within(): 路径白名单校验
# ============================================================
"""

from __future__ import annotations

import os
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    """获取当前 ISO 时间戳（UTC）"""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _new_id(prefix: str) -> str:
    """生成唯一 ID"""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ============================================================
# 通用安全工具
# ============================================================

_FILENAME_INVALID_RE = re.compile(r"[^\w\-.]")


def safe_filename(name: str, max_length: int = 64) -> str:
    """清洗文件名（仅保留字母数字、下划线、连字符、点）"""
    if not name:
        return "unnamed"
    cleaned = _FILENAME_INVALID_RE.sub("_", name)
    cleaned = cleaned.strip("._")
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]
    return cleaned or "unnamed"


def path_within(path: str, base: str) -> bool:
    """校验路径是否在 base 之内（防穿越）"""
    try:
        abs_path = os.path.realpath(path)
        abs_base = os.path.realpath(base)
        return os.path.commonpath([abs_path, abs_base]) == abs_base
    except (ValueError, OSError):
        return False


# ============================================================
# 枚举定义
# ============================================================


class DesignTemplate(str, Enum):
    """设计模板类型"""

    WEB = "web"             # 通用 Web 页面
    MOBILE = "mobile"       # 移动端 App
    LANDING = "landing"     # 落地页
    COMPONENTS = "components"  # 组件库
    POSTER = "poster"       # 海报
    DASHBOARD = "dashboard"  # 仪表盘


class DesignExportFormat(str, Enum):
    """设计导出格式"""

    HTML = "html"
    REACT = "react"
    TAILWIND = "tailwind"
    VUE = "vue"


class KnowledgeCategory(str, Enum):
    """知识条目类别"""

    PREFERENCE = "preference"   # 用户偏好
    FACT = "fact"               # 事实
    CONTEXT = "context"         # 上下文
    RULE = "rule"               # 规则
    TODO = "todo"               # 待办


class KnowledgeStatus(str, Enum):
    """知识条目状态"""

    ACTIVE = "active"
    ARCHIVED = "archived"
    DEPRECATED = "deprecated"


class KnowledgeSource(str, Enum):
    """知识条目来源"""

    USER = "user"
    CONVERSATION = "conversation"
    AGENT = "agent"
    IMPORT = "import"


class VideoStatus(str, Enum):
    """视频生成状态"""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class VideoStyle(str, Enum):
    """视频风格"""

    REALISTIC = "realistic"
    ANIMATED = "animated"
    ABSTRACT = "abstract"
    CINEMATIC = "cinematic"


# ============================================================
# Design Mode 数据模型
# ============================================================


@dataclass
class DesignComponent:
    """设计组件（按钮、卡片、输入框等）"""

    component_id: str
    type: str                       # button | input | card | nav | hero | footer
    label: str = ""
    props: Dict[str, Any] = field(default_factory=dict)
    position: Optional[Dict[str, int]] = None  # {"x": 0, "y": 0, "w": 100, "h": 50}


@dataclass
class DesignDraft:
    """设计草图"""

    draft_id: str
    name: str
    template: str
    description: str
    style: Dict[str, Any] = field(default_factory=dict)   # colors, fonts, spacing
    components: List[Dict[str, Any]] = field(default_factory=list)
    html: str = ""
    owner: str = "default_user"
    created_at: str = ""
    updated_at: str = ""
    version: int = 1
    tags: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = _now_iso()
        if not self.updated_at:
            self.updated_at = self.created_at

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DesignSystem:
    """设计系统（颜色、字体、间距、组件库）"""

    system_id: str
    name: str
    colors: Dict[str, str] = field(default_factory=dict)
    typography: Dict[str, Any] = field(default_factory=dict)
    spacing: Dict[str, int] = field(default_factory=dict)
    components: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    owner: str = "default_user"

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = _now_iso()
        if not self.updated_at:
            self.updated_at = self.created_at

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class NLEditChange:
    """自然语言编辑产生的变更记录"""

    change_id: str
    type: str                       # color | border-radius | size | font | spacing | alignment
    target: str                     # button | primary | text | hero | ...
    old_value: Any = None
    new_value: Any = None
    instruction: str = ""           # 原始指令

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Voice Chat 数据模型
# ============================================================


@dataclass
class VoiceMessage:
    """语音会话消息"""

    message_id: str
    role: str                       # user | assistant
    text: str = ""
    audio_id: Optional[str] = None  # 关联音频 ID
    timestamp: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class WebSearchResult:
    """Web 搜索结果项"""

    title: str
    url: str
    snippet: str
    source: str = "mock"
    relevance: float = 0.0
    fetched_at: str = ""

    def __post_init__(self) -> None:
        if not self.fetched_at:
            self.fetched_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VoiceSession:
    """语音会话"""

    session_id: str
    user_id: str
    project_id: str
    messages: List[Dict[str, Any]] = field(default_factory=list)
    context_refs: List[str] = field(default_factory=list)  # 引用的 memory entry IDs
    web_search_results: List[Dict[str, Any]] = field(default_factory=list)
    started_at: str = ""
    last_active_at: str = ""
    status: str = "active"  # active | closed | archived

    def __post_init__(self) -> None:
        now = _now_iso()
        if not self.started_at:
            self.started_at = now
        if not self.last_active_at:
            self.last_active_at = now

    def touch(self) -> None:
        """更新最后活跃时间"""
        self.last_active_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Global Memory 数据模型
# ============================================================


@dataclass
class KnowledgeEntry:
    """知识条目"""

    entry_id: str
    project_id: str
    category: str
    content: str
    tags: List[str] = field(default_factory=list)
    source: str = "user"
    confidence: float = 1.0
    created_at: str = ""
    updated_at: str = ""
    last_used_at: str = ""
    use_count: int = 0
    status: str = "active"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        now = _now_iso()
        if not self.created_at:
            self.created_at = now
        if not self.updated_at:
            self.updated_at = now
        if not self.last_used_at:
            self.last_used_at = now

    def touch(self) -> None:
        """记录使用"""
        self.last_used_at = _now_iso()
        self.use_count += 1

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Video 数据模型
# ============================================================


@dataclass
class VideoMetadata:
    """视频元数据"""

    video_id: str
    file_path: str
    duration: float = 0.0          # 秒
    width: int = 0
    height: int = 0
    fps: float = 30.0
    codec: str = "h264"
    file_size: int = 0
    thumbnail_path: Optional[str] = None
    uploaded_by: str = "default_user"
    uploaded_at: str = ""
    title: str = ""
    description: str = ""

    def __post_init__(self) -> None:
        if not self.uploaded_at:
            self.uploaded_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VideoFrame:
    """视频关键帧"""

    frame_id: str
    video_id: str
    timestamp: float                # 秒
    file_path: str
    description: str = ""
    is_key_frame: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VideoScene:
    """视频场景片段"""

    scene_id: str
    start: float                    # 秒
    end: float
    description: str
    key_frame_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VideoSummary:
    """视频摘要"""

    summary_id: str
    video_id: str
    key_frames: List[str] = field(default_factory=list)  # 帧 ID 列表
    duration: float = 0.0
    transcript: str = ""
    scenes: List[Dict[str, Any]] = field(default_factory=list)
    summary_text: str = ""
    created_at: str = ""
    model: str = "mock-video-v1"

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VideoGeneration:
    """视频生成任务"""

    gen_id: str
    prompt: str
    duration: float = 5.0
    resolution: str = "1280x720"
    style: str = "realistic"
    output_path: str = ""
    status: str = "queued"
    progress: float = 0.0
    created_at: str = ""
    completed_at: str = ""
    owner: str = "default_user"
    error: str = ""

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 全局统计
# ============================================================


@dataclass
class WorkStats:
    """TRAE Work 统计"""

    design_drafts: int = 0
    design_systems: int = 0
    nl_edits_applied: int = 0
    voice_sessions: int = 0
    voice_messages: int = 0
    web_searches: int = 0
    knowledge_entries: int = 0
    knowledge_active: int = 0
    knowledge_searches: int = 0
    videos_uploaded: int = 0
    video_frames_extracted: int = 0
    video_summaries: int = 0
    video_generations: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
