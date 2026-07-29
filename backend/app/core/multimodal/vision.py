"""
# ============================================================
# 多模态模块 - Vision 引擎
# ============================================================
# 核心作用：实现图像的 Vision 分析能力（OCR、UI 元素检测、对象识别）
# 运行流程：
#   1. 接收图像文件路径
#   2. 提取元数据（尺寸、格式）
#   3. 执行 OCR 文本提取（Mock）
#   4. 检测 UI 元素（Mock）
#   5. 识别对象（Mock）
#   6. 生成整体描述
#   7. 返回 VisionAnalysis 对象
# 输入参数：图像文件路径
# 输出结果：VisionAnalysis 对象（含描述、OCR、对象、UI 元素）
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================
"""

from __future__ import annotations

import io
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .models import VisionAnalysis, _new_id, _now_iso


# 支持的图像 MIME 类型
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
}

# 图像大小限制（字节）
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


class VisionEngine:
    """Vision 分析引擎

    提供图像的 OCR、UI 元素检测、对象识别能力
    使用 Mock 实现（规则引擎 + 启发式），不依赖外部模型

    Attributes:
        model_name: 模型名称
    """

    def __init__(self, model_name: str = "mock-vision-v1") -> None:
        """初始化引擎

        Args:
            model_name: 模型名称
        """
        self.model_name = model_name

    def analyze(
        self,
        media_id: str,
        file_path: str,
        analysis_type: str = "full",
    ) -> VisionAnalysis:
        """执行 Vision 分析

        Args:
            media_id: 媒体 ID
            file_path: 文件路径
            analysis_type: 分析类型（full/ocr/objects/ui）

        Returns:
            VisionAnalysis: 分析结果

        Raises:
            FileNotFoundError: 文件不存在
            ValueError: 格式不支持或文件过大
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        file_size = os.path.getsize(file_path)
        if file_size > MAX_IMAGE_SIZE:
            raise ValueError(f"Image too large: {file_size} bytes (max {MAX_IMAGE_SIZE})")

        # 检测 MIME 类型
        mime_type = self._detect_mime_type(file_path)
        if mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
            raise ValueError(f"Unsupported image type: {mime_type}")

        # 提取图像信息
        width, height = self._extract_image_info(file_path, mime_type)

        # 根据分析类型执行不同子任务
        description = ""
        detected_objects: List[Dict[str, Any]] = []
        ocr_text: Optional[str] = None
        ui_elements: List[Dict[str, Any]] = []

        if analysis_type in ("full", "description"):
            description = self._generate_description(width, height, file_path)

        if analysis_type in ("full", "objects"):
            detected_objects = self._detect_objects(width, height)

        if analysis_type in ("full", "ocr"):
            ocr_text = self._extract_text_ocr(width, height)

        if analysis_type in ("full", "ui"):
            ui_elements = self._detect_ui_elements(width, height)

        # 计算整体置信度
        confidence = self._compute_confidence(analysis_type)

        return VisionAnalysis(
            analysis_id=_new_id("vis"),
            media_id=media_id,
            description=description,
            detected_objects=detected_objects,
            ocr_text=ocr_text,
            ui_elements=ui_elements,
            confidence=confidence,
            model=self.model_name,
            created_at=_now_iso(),
            analysis_type=analysis_type,
        )

    def _detect_mime_type(self, file_path: str) -> str:
        """检测 MIME 类型（基于 magic bytes）

        Args:
            file_path: 文件路径

        Returns:
            str: MIME 类型
        """
        try:
            with open(file_path, "rb") as f:
                head = f.read(16)

            # PNG: 89 50 4E 47
            if head.startswith(b"\x89PNG\r\n\x1a\n"):
                return "image/png"
            # JPEG: FF D8 FF
            if head.startswith(b"\xff\xd8\xff"):
                return "image/jpeg"
            # GIF: GIF87a / GIF89a
            if head.startswith(b"GIF8"):
                return "image/gif"
            # WebP: RIFF....WEBP
            if head[0:4] == b"RIFF" and head[8:12] == b"WEBP":
                return "image/webp"

            # 兜底：根据扩展名
            ext = Path(file_path).suffix.lower()
            return {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
            }.get(ext, "image/png")
        except Exception:
            return "image/png"

    def _extract_image_info(self, file_path: str, mime_type: str) -> Tuple[int, int]:
        """提取图像尺寸信息

        Args:
            file_path: 文件路径
            mime_type: MIME 类型

        Returns:
            Tuple[int, int]: (宽度, 高度)
        """
        try:
            if mime_type == "image/png":
                return self._parse_png_size(file_path)
            elif mime_type in ("image/jpeg", "image/jpg"):
                return self._parse_jpeg_size(file_path)
            elif mime_type == "image/gif":
                return self._parse_gif_size(file_path)
            elif mime_type == "image/webp":
                return self._parse_webp_size(file_path)
            return (800, 600)
        except Exception:
            return (800, 600)

    def _parse_png_size(self, file_path: str) -> Tuple[int, int]:
        """解析 PNG 尺寸

        Args:
            file_path: 文件路径

        Returns:
            Tuple[int, int]: (宽度, 高度)
        """
        with open(file_path, "rb") as f:
            f.read(16)  # 跳过 PNG 头 + IHDR 长度 + 类型
            w = int.from_bytes(f.read(4), "big")
            h = int.from_bytes(f.read(4), "big")
        return (w, h)

    def _parse_jpeg_size(self, file_path: str) -> Tuple[int, int]:
        """解析 JPEG 尺寸

        Args:
            file_path: 文件路径

        Returns:
            Tuple[int, int]: (宽度, 高度)
        """
        with open(file_path, "rb") as f:
            data = f.read()
        return self._jpeg_size_from_data(data)

    def _jpeg_size_from_data(self, data: bytes) -> Tuple[int, int]:
        """从 JPEG 数据中解析尺寸

        Args:
            data: JPEG 字节数据

        Returns:
            Tuple[int, int]: (宽度, 高度)
        """
        i = 2
        while i < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3):
                h = int.from_bytes(data[i + 5 : i + 7], "big")
                w = int.from_bytes(data[i + 7 : i + 9], "big")
                return (w, h)
            length = int.from_bytes(data[i + 2 : i + 4], "big")
            i += 2 + length
        return (800, 600)

    def _parse_gif_size(self, file_path: str) -> Tuple[int, int]:
        """解析 GIF 尺寸

        Args:
            file_path: 文件路径

        Returns:
            Tuple[int, int]: (宽度, 高度)
        """
        with open(file_path, "rb") as f:
            f.read(6)  # GIF 头
            w = int.from_bytes(f.read(2), "little")
            h = int.from_bytes(f.read(2), "little")
        return (w, h)

    def _parse_webp_size(self, file_path: str) -> Tuple[int, int]:
        """解析 WebP 尺寸

        Args:
            file_path: 文件路径

        Returns:
            Tuple[int, int]: (宽度, 高度)
        """
        with open(file_path, "rb") as f:
            f.read(16)
            # VP8 格式
            w = int.from_bytes(f.read(2), "little") & 0x3FFF
            h = int.from_bytes(f.read(2), "little") & 0x3FFF
        return (w, h)

    def _generate_description(self, width: int, height: int, file_path: str) -> str:
        """生成整体描述（Mock）

        Args:
            width: 宽度
            height: 高度
            file_path: 文件路径

        Returns:
            str: 整体描述
        """
        aspect_ratio = width / max(height, 1)
        orientation = "landscape" if aspect_ratio > 1.2 else "portrait" if aspect_ratio < 0.8 else "square"
        size_class = "large" if width * height > 1920 * 1080 else "medium" if width * height > 640 * 480 else "small"

        filename = Path(file_path).name
        return (
            f"A {size_class} {orientation} image ({width}x{height}) named '{filename}'. "
            f"Contains UI elements and visual content suitable for analysis."
        )

    def _detect_objects(self, width: int, height: int) -> List[Dict[str, Any]]:
        """检测对象（Mock）

        Args:
            width: 宽度
            height: 高度

        Returns:
            List[Dict[str, Any]]: 检测到的对象列表
        """
        # 简化的对象检测：根据尺寸推断
        objects = []

        # 顶部 1/4 区域：可能是 logo/header
        if width > 400:
            objects.append({
                "label": "header",
                "confidence": 0.85,
                "bbox": [0, 0, width, height // 4],
            })

        # 中部 1/2 区域：可能是主要内容
        objects.append({
            "label": "main_content",
            "confidence": 0.78,
            "bbox": [0, height // 4, width, height * 3 // 4],
        })

        # 底部 1/4 区域：可能是 footer
        if height > 200:
            objects.append({
                "label": "footer",
                "confidence": 0.72,
                "bbox": [0, height * 3 // 4, width, height],
            })

        return objects

    def _extract_text_ocr(self, width: int, height: int) -> str:
        """OCR 文本提取（Mock）

        Args:
            width: 宽度
            height: 高度

        Returns:
            str: 提取的文本
        """
        # 简化的 OCR：基于尺寸启发式
        if width < 200 or height < 100:
            return ""

        # Mock 一些常见 UI 文本
        common_texts = [
            "Login",
            "Sign In",
            "Submit",
            "Cancel",
            "Save",
            "Delete",
            "Edit",
            "Settings",
        ]

        # 根据图像尺寸选择文本数量
        if width * height > 1920 * 1080:
            return "\n".join(common_texts[:5])
        elif width * height > 640 * 480:
            return "\n".join(common_texts[:3])
        return common_texts[0] if common_texts else ""

    def _detect_ui_elements(self, width: int, height: int) -> List[Dict[str, Any]]:
        """检测 UI 元素（Mock）

        Args:
            width: 宽度
            height: 高度

        Returns:
            List[Dict[str, Any]]: UI 元素列表
        """
        elements = []

        # 推断可能的按钮位置
        if width > 300 and height > 200:
            elements.append({
                "type": "button",
                "label": "Primary Action",
                "bbox": [width // 2 - 50, height - 60, width // 2 + 50, height - 30],
                "confidence": 0.88,
            })

        # 推断可能的输入框
        if width > 200:
            elements.append({
                "type": "input",
                "label": "Text Field",
                "value": "",
                "bbox": [width // 4, height // 3, width * 3 // 4, height // 3 + 30],
                "confidence": 0.82,
            })

        # 推断可能的列表/卡片
        if width > 400 and height > 400:
            elements.append({
                "type": "list",
                "label": "Item List",
                "bbox": [20, height // 4, width - 20, height * 3 // 4],
                "confidence": 0.75,
            })

        return elements

    def _compute_confidence(self, analysis_type: str) -> float:
        """计算整体置信度

        Args:
            analysis_type: 分析类型

        Returns:
            float: 置信度（0.0-1.0）
        """
        if analysis_type == "full":
            return 0.85
        elif analysis_type == "ocr":
            return 0.90
        elif analysis_type == "objects":
            return 0.80
        elif analysis_type == "ui":
            return 0.78
        return 0.75

    def generate_thumbnail(
        self,
        source_path: str,
        target_path: str,
        max_size: int = 256,
    ) -> bool:
        """生成缩略图

        Args:
            source_path: 源图像路径
            target_path: 目标缩略图路径
            max_size: 最大尺寸（宽或高）

        Returns:
            bool: 是否成功
        """
        try:
            # 简化的缩略图：拷贝文件 + 标记（避免依赖 PIL）
            import shutil

            # 创建目标目录
            os.makedirs(os.path.dirname(target_path), exist_ok=True)

            # 直接复制（占位实现）
            shutil.copy2(source_path, target_path)
            return True
        except Exception:
            return False


def validate_image(file_path: str) -> Tuple[bool, str]:
    """验证图像文件

    Args:
        file_path: 文件路径

    Returns:
        Tuple[bool, str]: (是否有效, 错误信息或 MIME 类型)
    """
    if not os.path.exists(file_path):
        return False, "File not found"

    file_size = os.path.getsize(file_path)
    if file_size == 0:
        return False, "File is empty"
    if file_size > MAX_IMAGE_SIZE:
        return False, f"File too large: {file_size} bytes (max {MAX_IMAGE_SIZE})"

    # 检查 magic bytes
    try:
        with open(file_path, "rb") as f:
            head = f.read(16)
        if head.startswith(b"\x89PNG\r\n\x1a\n"):
            return True, "image/png"
        if head.startswith(b"\xff\xd8\xff"):
            return True, "image/jpeg"
        if head.startswith(b"GIF8"):
            return True, "image/gif"
        if head[0:4] == b"RIFF" and head[8:12] == b"WEBP":
            return True, "image/webp"
    except Exception:
        pass

    return False, "Unsupported image format"
