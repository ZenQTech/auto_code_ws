"""
# ============================================================
# 多模态模块 - 数据模型
# ============================================================
# 核心作用：定义多模态支持所需的所有数据模型
# 包含：媒体项、Vision 分析、Audio 分析、多模态消息
# 运行流程：作为数据载体在各模块间传递
# 输入参数：字段值（来自 API 请求或内部构造）
# 输出结果：可序列化的数据模型对象
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


def _new_id(prefix: str) -> str:
    """生成短 ID

    Args:
        prefix: 前缀（med/vis/aud/msg）

    Returns:
        str: 形如 'med_abc123def456' 的 ID
    """
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now_iso() -> str:
    """返回当前时间的 ISO 格式字符串

    Returns:
        str: ISO 格式时间字符串
    """
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class MediaType(str, Enum):
    """媒体类型枚举"""

    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    DOCUMENT = "document"


class MessageRole(str, Enum):
    """消息角色枚举"""

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


@dataclass
class MediaItem:
    """媒体项实体

    表示一个上传的媒体文件（图像/音频/视频/文档）
    包含元数据、存储路径、校验和、缩略图

    Attributes:
        media_id: 媒体唯一标识
        type: 媒体类型（image/audio/video/document）
        mime_type: MIME 类型
        file_path: 文件存储路径
        file_size: 文件大小（字节）
        width: 图像宽度（可选）
        height: 图像高度（可选）
        duration: 时长（秒，音频/视频可选）
        checksum: SHA-256 校验和
        thumbnail_path: 缩略图路径（可选）
        metadata: 附加元数据
        uploaded_at: 上传时间
        uploaded_by: 上传者标识
        session_id: 关联的会话 ID（可选）
    """

    media_id: str = field(default_factory=lambda: _new_id("med"))
    type: str = MediaType.IMAGE.value
    mime_type: str = ""
    file_path: str = ""
    file_size: int = 0
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None
    checksum: str = ""
    thumbnail_path: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    uploaded_at: str = field(default_factory=_now_iso)
    uploaded_by: str = ""
    session_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 可 JSON 序列化的字典
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MediaItem":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            MediaItem: 媒体项对象
        """
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class VisionAnalysis:
    """Vision 分析结果

    描述对图像的 AI 分析结果
    包含整体描述、检测对象、OCR 文本、UI 元素

    Attributes:
        analysis_id: 分析唯一标识
        media_id: 关联的媒体 ID
        description: 整体描述
        detected_objects: 检测到的对象列表
        ocr_text: OCR 提取的文本
        ui_elements: UI 元素列表
        confidence: 置信度（0.0-1.0）
        model: 使用的模型名称
        created_at: 创建时间
        analysis_type: 分析类型（full/ocr/objects/ui）
    """

    analysis_id: str = field(default_factory=lambda: _new_id("vis"))
    media_id: str = ""
    description: str = ""
    detected_objects: List[Dict[str, Any]] = field(default_factory=list)
    ocr_text: Optional[str] = None
    ui_elements: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    model: str = "mock-vision-v1"
    created_at: str = field(default_factory=_now_iso)
    analysis_type: str = "full"

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 可 JSON 序列化的字典
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "VisionAnalysis":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            VisionAnalysis: 分析结果对象
        """
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class AudioAnalysis:
    """Audio 分析结果

    描述对音频的 AI 分析结果
    包含转写文本、语言、情感、关键片段

    Attributes:
        analysis_id: 分析唯一标识
        media_id: 关联的媒体 ID
        transcript: 转写文本
        language: 识别语言
        sentiment: 情感（positive/neutral/negative）
        duration: 时长（秒）
        key_segments: 关键片段列表
        confidence: 置信度（0.0-1.0）
        model: 使用的模型名称
        created_at: 创建时间
    """

    analysis_id: str = field(default_factory=lambda: _new_id("aud"))
    media_id: str = ""
    transcript: str = ""
    language: str = "zh-CN"
    sentiment: str = "neutral"
    duration: float = 0.0
    key_segments: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    model: str = "mock-audio-v1"
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 可 JSON 序列化的字典
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AudioAnalysis":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            AudioAnalysis: 分析结果对象
        """
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class MultimodalMessage:
    """多模态消息

    表示一个多模态对话消息
    包含文本、媒体引用、角色、时间戳

    Attributes:
        message_id: 消息唯一标识
        session_id: 关联的会话 ID
        role: 角色（user/assistant/system）
        text_content: 文本内容
        media_items: 引用的媒体 ID 列表
        metadata: 附加元数据
        created_at: 创建时间
        response: 助手回复内容（可选）
    """

    message_id: str = field(default_factory=lambda: _new_id("msg"))
    session_id: str = ""
    role: str = MessageRole.USER.value
    text_content: Optional[str] = None
    media_items: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_now_iso)
    response: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 可 JSON 序列化的字典
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MultimodalMessage":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            MultimodalMessage: 消息对象
        """
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


def compute_checksum(file_path: str) -> str:
    """计算文件的 SHA-256 校验和

    Args:
        file_path: 文件路径

    Returns:
        str: SHA-256 校验和（hex 格式）
    """
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def get_storage_dir() -> str:
    """获取多模态存储目录

    Returns:
        str: 存储目录路径
    """
    import os
    base = os.environ.get("HERMES_MULTIMODAL_DIR", "/tmp/hermes_multimodal")
    return base
