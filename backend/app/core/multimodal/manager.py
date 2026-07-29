"""
# ============================================================
# 多模态模块 - 媒体管理器
# ============================================================
# 核心作用：统一管理媒体文件、Vision 分析、Audio 分析、多模态消息
# 运行流程：
#   1. 上传时验证路径 + 格式 + 大小
#   2. 计算 SHA-256 校验和 + 提取元数据
#   3. 存储到白名单目录 + 写入索引
#   4. 分析时调度 Vision/Audio 引擎
#   5. 多模态消息关联 Session
#   6. 提供统计与查询接口
# 输入参数：文件路径、用户标识、Session ID、分析类型
# 输出结果：媒体项、分析结果、消息对象
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from .audio import AudioEngine, validate_audio
from .models import (
    MediaItem,
    MediaType,
    MultimodalMessage,
    VisionAnalysis,
    AudioAnalysis,
    compute_checksum,
    get_storage_dir,
    _new_id,
    _now_iso,
)
from .vision import VisionEngine, validate_image


# 文件名白名单字符
SAFE_FILENAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.\-\u4e00-\u9fa5]+$")


class MediaManager:
    """媒体管理器

    统一管理媒体上传、存储、分析、消息
    线程安全（RLock）

    Attributes:
        storage_dir: 存储根目录
        media_index: 媒体索引（media_id -> MediaItem）
        vision_analyses: Vision 分析索引
        audio_analyses: Audio 分析索引
        messages: 多模态消息索引
        vision_engine: Vision 引擎
        audio_engine: Audio 引擎
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        """初始化管理器

        Args:
            storage_dir: 存储根目录（默认从环境变量或使用 /tmp/hermes_multimodal）
        """
        self._lock = threading.RLock()
        self._storage_dir = Path(storage_dir or get_storage_dir())
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        (self._storage_dir / "media").mkdir(exist_ok=True)
        (self._storage_dir / "thumbnails").mkdir(exist_ok=True)
        (self._storage_dir / "analyses").mkdir(exist_ok=True)

        self._media_index: Dict[str, MediaItem] = {}
        self._vision_analyses: Dict[str, VisionAnalysis] = {}
        self._audio_analyses: Dict[str, AudioAnalysis] = {}
        self._messages: Dict[str, MultimodalMessage] = {}

        self._vision_engine = VisionEngine()
        self._audio_engine = AudioEngine()

        # 加载已存在的索引
        self._load_index()

    # ============================================================
    # 媒体管理
    # ============================================================

    def upload_media(
        self,
        source_path: str,
        media_type: str,
        uploaded_by: str,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> MediaItem:
        """上传媒体文件

        Args:
            source_path: 源文件路径
            media_type: 媒体类型（image/audio）
            uploaded_by: 上传者
            session_id: 关联的 Session ID（可选）
            metadata: 附加元数据（可选）

        Returns:
            MediaItem: 媒体项

        Raises:
            ValueError: 格式错误或文件过大
            FileNotFoundError: 文件不存在
        """
        with self._lock:
            if not os.path.exists(source_path):
                raise FileNotFoundError(f"Source file not found: {source_path}")

            # 验证
            if media_type == MediaType.IMAGE.value:
                ok, info = validate_image(source_path)
                if not ok:
                    raise ValueError(f"Image validation failed: {info}")
                mime_type = info
            elif media_type == MediaType.AUDIO.value:
                ok, info = validate_audio(source_path)
                if not ok:
                    raise ValueError(f"Audio validation failed: {info}")
                mime_type = info
            else:
                raise ValueError(f"Unsupported media type: {media_type}")

            # 计算校验和
            raw_checksum = compute_checksum(source_path)
            full_checksum = f"sha256:{raw_checksum}"

            # 检查是否已存在（去重）
            for existing in self._media_index.values():
                if existing.checksum == full_checksum and existing.uploaded_by == uploaded_by:
                    return existing

            # 生成目标路径
            file_ext = Path(source_path).suffix
            media_id = _new_id("med")
            safe_filename = self._sanitize_filename(media_id + file_ext)
            target_path = self._storage_dir / "media" / safe_filename

            # 拷贝文件
            shutil.copy2(source_path, target_path)
            file_size = os.path.getsize(target_path)

            # 提取尺寸/时长
            width = None
            height = None
            duration = None

            if media_type == MediaType.IMAGE.value:
                width, height = self._vision_engine._extract_image_info(str(target_path), mime_type)
                # 生成缩略图
                thumb_path = self._storage_dir / "thumbnails" / safe_filename
                self._vision_engine.generate_thumbnail(str(target_path), str(thumb_path))
            elif media_type == MediaType.AUDIO.value:
                duration = self._audio_engine._estimate_duration(str(target_path), mime_type, file_size)

            # 创建 MediaItem
            media_item = MediaItem(
                media_id=media_id,
                type=media_type,
                mime_type=mime_type,
                file_path=str(target_path),
                file_size=file_size,
                width=width,
                height=height,
                duration=duration,
                checksum=full_checksum,
                thumbnail_path=str(self._storage_dir / "thumbnails" / safe_filename) if media_type == MediaType.IMAGE.value else None,
                metadata=metadata or {},
                uploaded_at=_now_iso(),
                uploaded_by=uploaded_by,
                session_id=session_id,
            )

            # 写入索引
            self._media_index[media_id] = media_item
            self._save_index()

            return media_item

    def get_media(self, media_id: str) -> Optional[MediaItem]:
        """获取媒体项

        Args:
            media_id: 媒体 ID

        Returns:
            Optional[MediaItem]: 媒体项
        """
        with self._lock:
            return self._media_index.get(media_id)

    def list_media(
        self,
        media_type: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[MediaItem]:
        """列出媒体

        Args:
            media_type: 媒体类型过滤
            uploaded_by: 上传者过滤
            session_id: Session ID 过滤
            limit: 最大数量

        Returns:
            List[MediaItem]: 媒体列表
        """
        with self._lock:
            results = list(self._media_index.values())
            if media_type:
                results = [m for m in results if m.type == media_type]
            if uploaded_by:
                results = [m for m in results if m.uploaded_by == uploaded_by]
            if session_id:
                results = [m for m in results if m.session_id == session_id]

            # 按时间倒序
            results.sort(key=lambda m: m.uploaded_at, reverse=True)
            return results[:limit]

    def delete_media(self, media_id: str, uploaded_by: Optional[str] = None) -> bool:
        """删除媒体

        Args:
            media_id: 媒体 ID
            uploaded_by: 上传者校验（可选）

        Returns:
            bool: 是否删除成功
        """
        with self._lock:
            media = self._media_index.get(media_id)
            if not media:
                return False

            # 权限校验
            if uploaded_by and media.uploaded_by != uploaded_by:
                raise PermissionError(f"Media {media_id} not owned by {uploaded_by}")

            # 删除文件
            try:
                if os.path.exists(media.file_path):
                    os.remove(media.file_path)
                if media.thumbnail_path and os.path.exists(media.thumbnail_path):
                    os.remove(media.thumbnail_path)
            except Exception:
                pass

            # 删除索引
            del self._media_index[media_id]
            self._save_index()
            return True

    # ============================================================
    # Vision 分析
    # ============================================================

    def analyze_vision(
        self,
        media_id: str,
        analysis_type: str = "full",
    ) -> VisionAnalysis:
        """执行 Vision 分析

        Args:
            media_id: 媒体 ID
            analysis_type: 分析类型

        Returns:
            VisionAnalysis: 分析结果

        Raises:
            ValueError: 媒体不是图像或不存在
        """
        with self._lock:
            media = self._media_index.get(media_id)
            if not media:
                raise ValueError(f"Media not found: {media_id}")
            if media.type != MediaType.IMAGE.value:
                raise ValueError(f"Media is not an image: {media.type}")

            analysis = self._vision_engine.analyze(
                media_id=media_id,
                file_path=media.file_path,
                analysis_type=analysis_type,
            )

            # 保存分析结果
            self._vision_analyses[analysis.analysis_id] = analysis
            self._save_analyses()
            return analysis

    def list_vision_analyses(
        self,
        media_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[VisionAnalysis]:
        """列出 Vision 分析结果

        Args:
            media_id: 媒体 ID 过滤
            limit: 最大数量

        Returns:
            List[VisionAnalysis]: 分析结果列表
        """
        with self._lock:
            results = list(self._vision_analyses.values())
            if media_id:
                results = [a for a in results if a.media_id == media_id]
            results.sort(key=lambda a: a.created_at, reverse=True)
            return results[:limit]

    # ============================================================
    # Audio 分析
    # ============================================================

    def analyze_audio(
        self,
        media_id: str,
        language_hint: Optional[str] = None,
    ) -> AudioAnalysis:
        """执行 Audio 分析

        Args:
            media_id: 媒体 ID
            language_hint: 语言提示

        Returns:
            AudioAnalysis: 分析结果

        Raises:
            ValueError: 媒体不是音频或不存在
        """
        with self._lock:
            media = self._media_index.get(media_id)
            if not media:
                raise ValueError(f"Media not found: {media_id}")
            if media.type != MediaType.AUDIO.value:
                raise ValueError(f"Media is not an audio: {media.type}")

            analysis = self._audio_engine.analyze(
                media_id=media_id,
                file_path=media.file_path,
                language_hint=language_hint,
            )

            # 保存分析结果
            self._audio_analyses[analysis.analysis_id] = analysis
            self._save_analyses()
            return analysis

    def list_audio_analyses(
        self,
        media_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[AudioAnalysis]:
        """列出 Audio 分析结果

        Args:
            media_id: 媒体 ID 过滤
            limit: 最大数量

        Returns:
            List[AudioAnalysis]: 分析结果列表
        """
        with self._lock:
            results = list(self._audio_analyses.values())
            if media_id:
                results = [a for a in results if a.media_id == media_id]
            results.sort(key=lambda a: a.created_at, reverse=True)
            return results[:limit]

    # ============================================================
    # 多模态消息
    # ============================================================

    def send_message(
        self,
        session_id: str,
        text_content: Optional[str],
        media_ids: Optional[List[str]] = None,
        uploaded_by: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> MultimodalMessage:
        """发送多模态消息

        Args:
            session_id: 会话 ID
            text_content: 文本内容
            media_ids: 引用的媒体 ID 列表
            uploaded_by: 发送者
            metadata: 附加元数据

        Returns:
            MultimodalMessage: 消息对象
        """
        with self._lock:
            # 验证媒体
            media_ids = media_ids or []
            for mid in media_ids:
                if mid not in self._media_index:
                    raise ValueError(f"Media not found: {mid}")

            message = MultimodalMessage(
                message_id=_new_id("msg"),
                session_id=session_id,
                role="user",
                text_content=text_content,
                media_items=media_ids,
                metadata=metadata or {},
                created_at=_now_iso(),
            )

            self._messages[message.message_id] = message
            self._save_messages()

            # 生成助手回复
            response = self._generate_response(message)
            if response:
                assistant_message = MultimodalMessage(
                    message_id=_new_id("msg"),
                    session_id=session_id,
                    role="assistant",
                    text_content=response,
                    media_items=[],
                    metadata={"reply_to": message.message_id},
                    created_at=_now_iso(),
                )
                self._messages[assistant_message.message_id] = assistant_message
                self._save_messages()

            return message

    def _generate_response(self, message: MultimodalMessage) -> Optional[str]:
        """生成助手回复（Mock）

        Args:
            message: 用户消息

        Returns:
            Optional[str]: 回复内容
        """
        if not message.media_items:
            # 纯文本
            if message.text_content:
                return f"我已收到您的消息：{message.text_content[:50]}"
            return "我已收到您的消息"

        # 多模态消息
        parts = []
        for mid in message.media_items:
            media = self._media_index.get(mid)
            if not media:
                continue
            if media.type == MediaType.IMAGE.value:
                # 检查是否有 Vision 分析
                vis = next(
                    (a for a in self._vision_analyses.values() if a.media_id == mid),
                    None,
                )
                if vis:
                    parts.append(f"图像分析：{vis.description[:80]}")
                else:
                    parts.append("图像已接收（待分析）")
            elif media.type == MediaType.AUDIO.value:
                aud = next(
                    (a for a in self._audio_analyses.values() if a.media_id == mid),
                    None,
                )
                if aud:
                    parts.append(f"音频转写：{aud.transcript[:80]}")
                else:
                    parts.append("音频已接收（待转写）")

        if parts:
            return "；".join(parts)
        return "我已收到您的多模态消息"

    def list_messages(
        self,
        session_id: str,
        limit: int = 100,
    ) -> List[MultimodalMessage]:
        """列出会话消息

        Args:
            session_id: 会话 ID
            limit: 最大数量

        Returns:
            List[MultimodalMessage]: 消息列表
        """
        with self._lock:
            results = [m for m in self._messages.values() if m.session_id == session_id]
            results.sort(key=lambda m: m.created_at)
            return results[:limit]

    def get_message(self, message_id: str) -> Optional[MultimodalMessage]:
        """获取消息

        Args:
            message_id: 消息 ID

        Returns:
            Optional[MultimodalMessage]: 消息对象
        """
        with self._lock:
            return self._messages.get(message_id)

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息

        Returns:
            Dict[str, Any]: 统计字典
        """
        with self._lock:
            image_count = sum(1 for m in self._media_index.values() if m.type == MediaType.IMAGE.value)
            audio_count = sum(1 for m in self._media_index.values() if m.type == MediaType.AUDIO.value)
            total_size = sum(m.file_size for m in self._media_index.values())

            return {
                "total_media": len(self._media_index),
                "image_count": image_count,
                "audio_count": audio_count,
                "total_size_bytes": total_size,
                "vision_analyses": len(self._vision_analyses),
                "audio_analyses": len(self._audio_analyses),
                "messages": len(self._messages),
                "storage_dir": str(self._storage_dir),
            }

    def health(self) -> Dict[str, Any]:
        """健康检查

        Returns:
            Dict[str, Any]: 健康状态
        """
        return {
            "service": "multimodal",
            "status": "healthy",
            "storage_dir": str(self._storage_dir),
            "storage_exists": self._storage_dir.exists(),
            "media_count": len(self._media_index),
            "vision_analyses_count": len(self._vision_analyses),
            "audio_analyses_count": len(self._audio_analyses),
            "messages_count": len(self._messages),
        }

    # ============================================================
    # 辅助方法
    # ============================================================

    def _sanitize_filename(self, filename: str) -> str:
        """清洗文件名

        Args:
            filename: 原始文件名

        Returns:
            str: 安全的文件名
        """
        # 替换危险字符
        safe = re.sub(r"[^a-zA-Z0-9._\-]", "_", filename)
        # 防止路径穿越
        safe = safe.replace("..", "_")
        return safe

    def _index_path(self) -> Path:
        """获取索引文件路径

        Returns:
            Path: 索引文件路径
        """
        return self._storage_dir / "index.jsonl"

    def _analyses_path(self) -> Path:
        """获取分析结果文件路径

        Returns:
            Path: 分析结果文件路径
        """
        return self._storage_dir / "analyses.jsonl"

    def _messages_path(self) -> Path:
        """获取消息文件路径

        Returns:
            Path: 消息文件路径
        """
        return self._storage_dir / "messages.jsonl"

    def _save_index(self) -> None:
        """保存媒体索引"""
        try:
            with open(self._index_path(), "w", encoding="utf-8") as f:
                for item in self._media_index.values():
                    f.write(json.dumps(item.to_dict()) + "\n")
        except Exception:
            pass

    def _save_analyses(self) -> None:
        """保存分析结果"""
        try:
            with open(self._analyses_path(), "w", encoding="utf-8") as f:
                for a in self._vision_analyses.values():
                    f.write(json.dumps({"type": "vision", "data": a.to_dict()}) + "\n")
                for a in self._audio_analyses.values():
                    f.write(json.dumps({"type": "audio", "data": a.to_dict()}) + "\n")
        except Exception:
            pass

    def _save_messages(self) -> None:
        """保存消息"""
        try:
            with open(self._messages_path(), "w", encoding="utf-8") as f:
                for m in self._messages.values():
                    f.write(json.dumps(m.to_dict()) + "\n")
        except Exception:
            pass

    def _load_index(self) -> None:
        """加载索引"""
        # 媒体索引
        try:
            if self._index_path().exists():
                with open(self._index_path(), "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            item = MediaItem.from_dict(data)
                            self._media_index[item.media_id] = item
                        except Exception:
                            continue
        except Exception:
            pass

        # 分析结果
        try:
            if self._analyses_path().exists():
                with open(self._analyses_path(), "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                            if entry.get("type") == "vision":
                                a = VisionAnalysis.from_dict(entry["data"])
                                self._vision_analyses[a.analysis_id] = a
                            elif entry.get("type") == "audio":
                                a = AudioAnalysis.from_dict(entry["data"])
                                self._audio_analyses[a.analysis_id] = a
                        except Exception:
                            continue
        except Exception:
            pass

        # 消息
        try:
            if self._messages_path().exists():
                with open(self._messages_path(), "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            m = MultimodalMessage.from_dict(json.loads(line))
                            self._messages[m.message_id] = m
                        except Exception:
                            continue
        except Exception:
            pass


# 全局单例
_manager: Optional[MediaManager] = None
_manager_lock = threading.Lock()


def get_manager() -> MediaManager:
    """获取全局 MediaManager 单例

    Returns:
        MediaManager: 管理器实例
    """
    global _manager
    if _manager is None:
        with _manager_lock:
            if _manager is None:
                _manager = MediaManager()
    return _manager
