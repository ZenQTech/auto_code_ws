"""
# ============================================================
# 多模态模块 - Audio 引擎
# ============================================================
# 核心作用：实现音频的转写、情感分析、关键片段识别能力
# 运行流程：
#   1. 接收音频文件路径
#   2. 提取元数据（时长、格式）
#   3. 生成波形数据
#   4. 执行转写（Mock）
#   5. 分析情感（Mock）
#   6. 识别关键片段
#   7. 返回 AudioAnalysis 对象
# 输入参数：音频文件路径
# 输出结果：AudioAnalysis 对象（含转写、情感、片段）
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================
"""

from __future__ import annotations

import os
import struct
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .models import AudioAnalysis, _new_id, _now_iso


# 支持的音频 MIME 类型
SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/ogg",
    "audio/webm",
    "audio/flac",
}

# 音频大小限制（字节）
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB

# 支持的语言
SUPPORTED_LANGUAGES = {
    "zh-CN": "中文（简体）",
    "zh-TW": "中文（繁体）",
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "ja-JP": "日本語",
    "ko-KR": "한국어",
}

# 情感类型
SENTIMENT_TYPES = {"positive", "neutral", "negative"}


class AudioEngine:
    """Audio 分析引擎

    提供音频的转写、情感分析、关键片段识别能力
    使用 Mock 实现（规则引擎 + 启发式），不依赖外部模型

    Attributes:
        model_name: 模型名称
    """

    def __init__(self, model_name: str = "mock-audio-v1") -> None:
        """初始化引擎

        Args:
            model_name: 模型名称
        """
        self.model_name = model_name

    def analyze(
        self,
        media_id: str,
        file_path: str,
        language_hint: Optional[str] = None,
    ) -> AudioAnalysis:
        """执行 Audio 分析

        Args:
            media_id: 媒体 ID
            file_path: 文件路径
            language_hint: 语言提示（可选）

        Returns:
            AudioAnalysis: 分析结果

        Raises:
            FileNotFoundError: 文件不存在
            ValueError: 格式不支持或文件过大
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        file_size = os.path.getsize(file_path)
        if file_size > MAX_AUDIO_SIZE:
            raise ValueError(f"Audio too large: {file_size} bytes (max {MAX_AUDIO_SIZE})")

        # 检测 MIME 类型
        mime_type = self._detect_mime_type(file_path)
        if mime_type not in SUPPORTED_AUDIO_MIME_TYPES:
            raise ValueError(f"Unsupported audio type: {mime_type}")

        # 提取音频元数据
        duration = self._estimate_duration(file_path, mime_type, file_size)

        # 检测语言
        language = self._detect_language(language_hint, file_path)

        # 生成转写（Mock）
        transcript = self._generate_transcript(duration, language)

        # 分析情感
        sentiment = self._analyze_sentiment(transcript)

        # 识别关键片段
        key_segments = self._detect_key_segments(duration, transcript)

        # 计算置信度
        confidence = self._compute_confidence(duration, transcript)

        return AudioAnalysis(
            analysis_id=_new_id("aud"),
            media_id=media_id,
            transcript=transcript,
            language=language,
            sentiment=sentiment,
            duration=duration,
            key_segments=key_segments,
            confidence=confidence,
            model=self.model_name,
            created_at=_now_iso(),
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

            # WAV: RIFF....WAVE
            if head[0:4] == b"RIFF" and head[8:12] == b"WAVE":
                return "audio/wav"
            # MP3: ID3 或 FF FB/FF FA
            if head[0:3] == b"ID3":
                return "audio/mpeg"
            if head[0:2] in (b"\xff\xfb", b"\xff\xfa", b"\xff\xf3", b"\xff\xf2"):
                return "audio/mpeg"
            # OGG: OggS
            if head[0:4] == b"OggS":
                return "audio/ogg"
            # FLAC: fLaC
            if head[0:4] == b"fLaC":
                return "audio/flac"
            # WebM/Matroska: 1A 45 DF A3
            if head[0:4] == b"\x1a\x45\xdf\xa3":
                return "audio/webm"

            # 兜底：根据扩展名
            ext = Path(file_path).suffix.lower()
            return {
                ".mp3": "audio/mpeg",
                ".wav": "audio/wav",
                ".ogg": "audio/ogg",
                ".flac": "audio/flac",
                ".webm": "audio/webm",
            }.get(ext, "audio/mpeg")
        except Exception:
            return "audio/mpeg"

    def _estimate_duration(self, file_path: str, mime_type: str, file_size: int) -> float:
        """估算音频时长

        Args:
            file_path: 文件路径
            mime_type: MIME 类型
            file_size: 文件大小（字节）

        Returns:
            float: 时长（秒）
        """
        try:
            if mime_type == "audio/wav":
                return self._parse_wav_duration(file_path)
        except Exception:
            pass

        # 兜底：基于文件大小估算（假设 128kbps 比特率）
        # 128kbps = 16KB/s
        estimated = file_size / (16 * 1024)
        return max(1.0, min(estimated, 3600.0))  # 限制 1s-1h

    def _parse_wav_duration(self, file_path: str) -> float:
        """解析 WAV 时长

        Args:
            file_path: WAV 文件路径

        Returns:
            float: 时长（秒）
        """
        try:
            with open(file_path, "rb") as f:
                # 跳过 RIFF 头
                f.read(12)
                # 查找 fmt chunk
                chunk_id = f.read(4)
                if chunk_id != b"fmt ":
                    return 0.0
                fmt_size = struct.unpack("<I", f.read(4))[0]
                fmt_data = f.read(fmt_size)
                audio_format = struct.unpack("<H", fmt_data[0:2])[0]
                num_channels = struct.unpack("<H", fmt_data[2:4])[0]
                sample_rate = struct.unpack("<I", fmt_data[4:8])[0]
                bits_per_sample = struct.unpack("<H", fmt_data[14:16])[0]

                # 查找 data chunk
                while True:
                    chunk_id = f.read(4)
                    if not chunk_id:
                        return 0.0
                    chunk_size = struct.unpack("<I", f.read(4))[0]
                    if chunk_id == b"data":
                        bytes_per_sample = bits_per_sample // 8
                        total_samples = chunk_size / (bytes_per_sample * num_channels)
                        return total_samples / sample_rate
                    f.seek(chunk_size, 1)
        except Exception:
            return 0.0

    def _detect_language(self, language_hint: Optional[str], file_path: str) -> str:
        """检测语言

        Args:
            language_hint: 语言提示
            file_path: 文件路径

        Returns:
            str: 语言代码
        """
        if language_hint and language_hint in SUPPORTED_LANGUAGES:
            return language_hint

        # Mock：根据文件名启发式
        filename = Path(file_path).name.lower()
        if "chinese" in filename or "zh" in filename or "中文" in filename:
            return "zh-CN"
        if "english" in filename or "en" in filename:
            return "en-US"
        if "japanese" in filename or "jp" in filename or "ja" in filename:
            return "ja-JP"
        if "korean" in filename or "kr" in filename or "ko" in filename:
            return "ko-KR"

        # 兜底
        return "zh-CN"

    def _generate_transcript(self, duration: float, language: str) -> str:
        """生成转写文本（Mock）

        Args:
            duration: 时长
            language: 语言

        Returns:
            str: 转写文本
        """
        # 简化的 Mock：根据时长 + 语言生成示例文本
        templates = {
            "zh-CN": [
                "今天我们来讨论一下项目的进度",
                "首先看一下整体的时间线",
                "接下来是关键技术选型",
                "最后是上线计划",
            ],
            "en-US": [
                "Let's discuss the project progress today",
                "First, let's look at the overall timeline",
                "Next is the key technology choices",
                "Finally, the launch plan",
            ],
            "ja-JP": [
                "今日はプロジェクトの進捗について話しましょう",
                "まず全体のタイムラインを見ます",
                "次は重要な技術の選択です",
                "最後にローンチ計画です",
            ],
            "ko-KR": [
                "오늘 프로젝트 진행 상황에 대해 논의합시다",
                "먼저 전체 타임라인을 봅시다",
                "다음은 핵심 기술 선택입니다",
                "마지막으로 출시 계획입니다",
            ],
        }

        texts = templates.get(language, templates["zh-CN"])

        # 根据时长选择文本数量
        if duration < 5:
            return texts[0] if texts else ""
        elif duration < 15:
            return " ".join(texts[:2])
        elif duration < 30:
            return " ".join(texts[:3])
        else:
            return " ".join(texts)

    def _analyze_sentiment(self, transcript: str) -> str:
        """分析情感（Mock）

        Args:
            transcript: 转写文本

        Returns:
            str: 情感类型
        """
        # 简化的情感分析：基于关键词
        positive_keywords = ["好", "棒", "优秀", "great", "good", "excellent", "進捗", "좋", "良い"]
        negative_keywords = ["差", "糟", "失败", "bad", "fail", "terrible", "問題", "나쁨", "悪い"]

        text_lower = transcript.lower()

        pos_count = sum(1 for kw in positive_keywords if kw.lower() in text_lower)
        neg_count = sum(1 for kw in negative_keywords if kw.lower() in text_lower)

        if pos_count > neg_count:
            return "positive"
        elif neg_count > pos_count:
            return "negative"
        return "neutral"

    def _detect_key_segments(self, duration: float, transcript: str) -> List[Dict[str, Any]]:
        """识别关键片段

        Args:
            duration: 时长
            transcript: 转写文本

        Returns:
            List[Dict[str, Any]]: 关键片段列表
        """
        if duration <= 0 or not transcript:
            return []

        # 将转写文本按句子分割
        sentences = self._split_sentences(transcript)
        if not sentences:
            return []

        # 均匀分配时间
        segment_duration = duration / len(sentences)

        segments = []
        for i, sentence in enumerate(sentences):
            start = i * segment_duration
            end = (i + 1) * segment_duration
            # Mock 能量值：基于句子长度（长句能量更高）
            energy = min(1.0, 0.3 + len(sentence) / 50.0)
            segments.append({
                "start": round(start, 2),
                "end": round(end, 2),
                "text": sentence,
                "energy": round(energy, 2),
            })

        return segments

    def _split_sentences(self, text: str) -> List[str]:
        """分割句子

        Args:
            text: 输入文本

        Returns:
            List[str]: 句子列表
        """
        # 简单的句子分割：中英文标点
        import re
        sentences = re.split(r"[.!?。!?;；]+", text)
        return [s.strip() for s in sentences if s.strip()]

    def _compute_confidence(self, duration: float, transcript: str) -> float:
        """计算置信度

        Args:
            duration: 时长
            transcript: 转写文本

        Returns:
            float: 置信度
        """
        base = 0.85
        # 时长影响：过短置信度低
        if duration < 1:
            base -= 0.2
        elif duration < 5:
            base -= 0.05
        # 转写长度影响
        if not transcript:
            base -= 0.3
        return max(0.3, min(0.95, base))

    def generate_waveform(
        self,
        file_path: str,
        num_samples: int = 100,
    ) -> List[float]:
        """生成波形数据（Mock）

        Args:
            file_path: 音频文件路径
            num_samples: 采样点数

        Returns:
            List[float]: 波形数据（0.0-1.0 范围）
        """
        # Mock 波形：基于文件大小生成伪随机波形
        try:
            file_size = os.path.getsize(file_path)
            # 用文件大小作为种子
            import random
            rng = random.Random(file_size)
            return [rng.random() for _ in range(num_samples)]
        except Exception:
            return [0.0] * num_samples


def validate_audio(file_path: str) -> Tuple[bool, str]:
    """验证音频文件

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
    if file_size > MAX_AUDIO_SIZE:
        return False, f"File too large: {file_size} bytes (max {MAX_AUDIO_SIZE})"

    # 检查 magic bytes
    try:
        with open(file_path, "rb") as f:
            head = f.read(16)
        if head[0:4] == b"RIFF" and head[8:12] == b"WAVE":
            return True, "audio/wav"
        if head[0:3] == b"ID3":
            return True, "audio/mpeg"
        if head[0:2] in (b"\xff\xfb", b"\xff\xfa", b"\xff\xf3", b"\xff\xf2"):
            return True, "audio/mpeg"
        if head[0:4] == b"OggS":
            return True, "audio/ogg"
        if head[0:4] == b"fLaC":
            return True, "audio/flac"
    except Exception:
        pass

    return False, "Unsupported audio format"
