"""
# ============================================================
# 多模态支持模块 - Multimodal
# ============================================================
# 核心作用：实现 Vision（图像）和 Audio（音频）多模态支持
# 包含：数据模型、Vision 处理、Audio 处理、媒体管理、REST API
# 运行流程：
#   1. 用户通过 /api/multimodal/upload/image 或 /upload/audio 上传媒体
#   2. MediaManager 验证格式、大小、计算校验和、生成缩略图
#   3. Vision/Audio 模块执行分析（OCR、转写、对象检测）
#   4. 用户通过 /api/multimodal/chat/send 发送多模态消息
#   5. Manager 关联 Session 存储消息历史
# 输入参数：通过 REST API 接收 multipart/form-data 和 JSON
# 输出结果：媒体文件 + 分析结果 + 多模态会话消息
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 多模态支持初始化
# ============================================================
"""

from .models import (
    MediaType,
    MessageRole,
    MediaItem,
    VisionAnalysis,
    AudioAnalysis,
    MultimodalMessage,
)

from .manager import MediaManager, get_manager
from .vision import VisionEngine
from .audio import AudioEngine

__all__ = [
    "MediaType",
    "MessageRole",
    "MediaItem",
    "VisionAnalysis",
    "AudioAnalysis",
    "MultimodalMessage",
    "MediaManager",
    "get_manager",
    "VisionEngine",
    "AudioEngine",
]
