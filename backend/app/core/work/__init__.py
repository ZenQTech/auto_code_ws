"""
# TRAE Work 多模态协作子系统
# ============================================================
# 核心作用：实现 TRAE Work 4 大子系统（Design/Voice/Memory/Video）
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 子系统：
#   - Design Mode: 6 模板 + NL 编辑 + 设计系统 + 代码导出
#   - Voice Chat:  会话管理 + 项目上下文注入 + Web 搜索
#   - Global Memory: 项目级知识库 + 多维度检索
#   - Video: 元数据 + 关键帧 + 摘要 + Mock 生成
#
# 入口：
#   - get_work_manager()：获取统一管理器
#   - GLOBAL_DESIGN_MODE / GLOBAL_VOICE_CHAT / GLOBAL_MEMORY / GLOBAL_VIDEO
# ============================================================
"""

from .design import GLOBAL_DESIGN_MODE, DesignMode
from .manager import WorkManager, get_work_manager
from .memory import GLOBAL_MEMORY, GlobalMemoryService
from .models import (
    DesignDraft,
    DesignExportFormat,
    DesignSystem,
    DesignTemplate,
    KnowledgeCategory,
    KnowledgeEntry,
    KnowledgeSource,
    KnowledgeStatus,
    NLEditChange,
    VideoFrame,
    VideoGeneration,
    VideoMetadata,
    VideoScene,
    VideoStatus,
    VideoStyle,
    VideoSummary,
    VoiceMessage,
    VoiceSession,
    WebSearchResult,
    WorkStats,
)
from .video import GLOBAL_VIDEO, VideoService
from .voice import GLOBAL_VOICE_CHAT, VoiceChatService


__all__ = [
    # 数据模型
    "DesignDraft",
    "DesignSystem",
    "DesignTemplate",
    "DesignExportFormat",
    "NLEditChange",
    "KnowledgeCategory",
    "KnowledgeEntry",
    "KnowledgeSource",
    "KnowledgeStatus",
    "VoiceMessage",
    "VoiceSession",
    "WebSearchResult",
    "VideoMetadata",
    "VideoFrame",
    "VideoScene",
    "VideoSummary",
    "VideoStatus",
    "VideoStyle",
    "VideoGeneration",
    "WorkStats",
    # 服务类
    "DesignMode",
    "VoiceChatService",
    "GlobalMemoryService",
    "VideoService",
    "WorkManager",
    # 全局单例
    "GLOBAL_DESIGN_MODE",
    "GLOBAL_VOICE_CHAT",
    "GLOBAL_MEMORY",
    "GLOBAL_VIDEO",
    "get_work_manager",
]
