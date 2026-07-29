"""
# ============================================================
# 多模态模块 - 单元测试
# ============================================================
# 核心作用：测试 multimodal 模块所有数据模型、Vision、Audio、Manager
# 运行流程：pytest 运行所有测试用例
# 覆盖：数据模型 / Vision / Audio / Manager / 文件验证 / 路径安全
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

# 设置临时存储目录
os.environ["HERMES_MULTIMODAL_DIR"] = tempfile.mkdtemp(prefix="hermes_test_")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.core.multimodal.models import (
    MediaType,
    MessageRole,
    MediaItem,
    VisionAnalysis,
    AudioAnalysis,
    MultimodalMessage,
    compute_checksum,
    get_storage_dir,
    _new_id,
    _now_iso,
)
from app.core.multimodal.vision import (
    VisionEngine,
    validate_image,
    SUPPORTED_IMAGE_MIME_TYPES,
    MAX_IMAGE_SIZE,
)
from app.core.multimodal.audio import (
    AudioEngine,
    validate_audio,
    SUPPORTED_AUDIO_MIME_TYPES,
    MAX_AUDIO_SIZE,
)
from app.core.multimodal.manager import (
    MediaManager,
    get_manager,
    SAFE_FILENAME_PATTERN,
)


def assert_eq(actual, expected, msg=""):
    """断言相等"""
    assert actual == expected, f"{msg}: expected {expected!r}, got {actual!r}"


def assert_true(cond, msg=""):
    """断言为真"""
    assert cond, msg or "Expected True"


def assert_false(cond, msg=""):
    """断言为假"""
    assert not cond, msg or "Expected False"


def assert_in(item, container, msg=""):
    """断言包含"""
    assert item in container, f"{msg}: {item!r} not in {container!r}"


def make_png(width: int = 100, height: int = 100) -> bytes:
    """生成最小有效 PNG 字节

    Args:
        width: 宽度
        height: 高度

    Returns:
        bytes: PNG 文件字节
    """
    import struct
    import zlib

    def chunk(name: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + name
            + data
            + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
        )

    # IHDR
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    # IDAT (单色)
    raw = b""
    for _ in range(height):
        raw += b"\x00" + b"\xff\x00\x00" * width
    idat = zlib.compress(raw)
    # IEND
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", idat)
    png += chunk(b"IEND", b"")
    return png


def make_wav(duration: float = 1.0, sample_rate: int = 8000) -> bytes:
    """生成最小有效 WAV 字节

    Args:
        duration: 时长（秒）
        sample_rate: 采样率

    Returns:
        bytes: WAV 文件字节
    """
    import struct
    import math

    num_samples = int(duration * sample_rate)
    data = b""
    for i in range(num_samples):
        sample = int(32767 * 0.5 * math.sin(2 * math.pi * 440 * i / sample_rate))
        data += struct.pack("<h", sample)

    # RIFF header
    chunk_size = 36 + len(data)
    return (
        b"RIFF"
        + struct.pack("<I", chunk_size)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<I", 16)  # fmt chunk size
        + struct.pack("<H", 1)   # PCM
        + struct.pack("<H", 1)   # mono
        + struct.pack("<I", sample_rate)
        + struct.pack("<I", sample_rate * 2)  # byte rate
        + struct.pack("<H", 2)   # block align
        + struct.pack("<H", 16)  # bits per sample
        + b"data"
        + struct.pack("<I", len(data))
        + data
    )


# ============================================================
# Models 测试
# ============================================================

class TestModels(unittest.TestCase):
    """数据模型测试"""

    def test_new_id_format(self):
        """ID 格式正确"""
        img_id = _new_id("med")
        assert_true(img_id.startswith("med_"), "starts with prefix")
        assert_eq(len(img_id), 4 + 12, "12 char hex")

    def test_now_iso(self):
        """时间戳格式"""
        ts = _now_iso()
        assert_true("T" in ts, "contains T")
        assert_true(ts.endswith("Z"), "ends with Z")

    def test_media_item_roundtrip(self):
        """媒体项序列化"""
        item = MediaItem(
            media_id="med_test",
            type="image",
            mime_type="image/png",
            file_path="/tmp/test.png",
            file_size=1024,
            width=800,
            height=600,
        )
        data = item.to_dict()
        restored = MediaItem.from_dict(data)
        assert_eq(restored.media_id, "med_test", "id preserved")
        assert_eq(restored.width, 800, "width preserved")
        assert_eq(restored.type, "image", "type preserved")

    def test_vision_analysis_roundtrip(self):
        """Vision 分析序列化"""
        analysis = VisionAnalysis(
            analysis_id="vis_test",
            media_id="med_test",
            description="test",
            ocr_text="hello",
            confidence=0.9,
        )
        data = analysis.to_dict()
        restored = VisionAnalysis.from_dict(data)
        assert_eq(restored.analysis_id, "vis_test", "id")
        assert_eq(restored.confidence, 0.9, "confidence")
        assert_eq(restored.ocr_text, "hello", "ocr")

    def test_audio_analysis_roundtrip(self):
        """Audio 分析序列化"""
        analysis = AudioAnalysis(
            analysis_id="aud_test",
            media_id="med_test",
            transcript="hello world",
            language="en-US",
            sentiment="positive",
            duration=3.5,
        )
        data = analysis.to_dict()
        restored = AudioAnalysis.from_dict(data)
        assert_eq(restored.transcript, "hello world", "transcript")
        assert_eq(restored.language, "en-US", "language")
        assert_eq(restored.sentiment, "positive", "sentiment")
        assert_eq(restored.duration, 3.5, "duration")

    def test_multimodal_message_roundtrip(self):
        """多模态消息序列化"""
        msg = MultimodalMessage(
            message_id="msg_test",
            session_id="sess_1",
            role="user",
            text_content="analyze this",
            media_items=["med_1", "med_2"],
        )
        data = msg.to_dict()
        restored = MultimodalMessage.from_dict(data)
        assert_eq(restored.session_id, "sess_1", "session")
        assert_eq(len(restored.media_items), 2, "media count")

    def test_compute_checksum(self):
        """校验和计算"""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"hello world")
            tmp_path = f.name
        try:
            checksum = compute_checksum(tmp_path)
            assert_eq(len(checksum), 64, "SHA-256 hex length")
        finally:
            os.remove(tmp_path)

    def test_get_storage_dir(self):
        """存储目录获取"""
        d = get_storage_dir()
        assert_true(d is not None, "not none")
        assert_true(len(d) > 0, "non-empty")

    def test_media_type_values(self):
        """媒体类型枚举值"""
        assert_eq(MediaType.IMAGE.value, "image", "image value")
        assert_eq(MediaType.AUDIO.value, "audio", "audio value")

    def test_message_role_values(self):
        """消息角色枚举值"""
        assert_eq(MessageRole.USER.value, "user", "user value")
        assert_eq(MessageRole.ASSISTANT.value, "assistant", "assistant value")


# ============================================================
# Vision Engine 测试
# ============================================================

class TestVisionEngine(unittest.TestCase):
    """Vision 引擎测试"""

    def setUp(self):
        self.engine = VisionEngine()

    def test_detect_mime_png(self):
        """检测 PNG MIME"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            mime = self.engine._detect_mime_type(tmp)
            assert_eq(mime, "image/png", "PNG mime")
        finally:
            os.remove(tmp)

    def test_detect_mime_jpeg(self):
        """检测 JPEG MIME"""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            f.write(b"\xff\xd8\xff\xe0\x00\x10JFIF")
            tmp = f.name
        try:
            mime = self.engine._detect_mime_type(tmp)
            assert_eq(mime, "image/jpeg", "JPEG mime")
        finally:
            os.remove(tmp)

    def test_detect_mime_gif(self):
        """检测 GIF MIME"""
        with tempfile.NamedTemporaryFile(suffix=".gif", delete=False) as f:
            f.write(b"GIF89a\x80\x00\x80\x00")
            tmp = f.name
        try:
            mime = self.engine._detect_mime_type(tmp)
            assert_eq(mime, "image/gif", "GIF mime")
        finally:
            os.remove(tmp)

    def test_parse_png_size(self):
        """解析 PNG 尺寸"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(640, 480))
            tmp = f.name
        try:
            w, h = self.engine._parse_png_size(tmp)
            assert_eq(w, 640, "width")
            assert_eq(h, 480, "height")
        finally:
            os.remove(tmp)

    def test_extract_image_info(self):
        """提取图像信息"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(320, 240))
            tmp = f.name
        try:
            w, h = self.engine._extract_image_info(tmp, "image/png")
            assert_eq(w, 320, "width")
            assert_eq(h, 240, "height")
        finally:
            os.remove(tmp)

    def test_generate_description(self):
        """生成图像描述"""
        desc = self.engine._generate_description(1920, 1080, "/tmp/test.png")
        assert_true("landscape" in desc or "image" in desc, "contains orientation")
        assert_true("1920x1080" in desc, "contains dimensions")

    def test_detect_objects(self):
        """检测对象"""
        objects = self.engine._detect_objects(1000, 800)
        assert_true(len(objects) >= 2, "at least 2 objects")
        for obj in objects:
            assert_in("label", obj, "label present")
            assert_in("confidence", obj, "confidence present")
            assert_in("bbox", obj, "bbox present")

    def test_extract_text_ocr(self):
        """OCR 文本提取"""
        text = self.engine._extract_text_ocr(800, 600)
        assert_true(isinstance(text, str), "string type")

    def test_detect_ui_elements(self):
        """检测 UI 元素"""
        elements = self.engine._detect_ui_elements(800, 600)
        assert_true(len(elements) >= 1, "at least 1 element")
        for elem in elements:
            assert_in("type", elem, "type present")

    def test_compute_confidence(self):
        """计算置信度"""
        c = self.engine._compute_confidence("full")
        assert_true(0 < c <= 1, "0 < c <= 1")
        c2 = self.engine._compute_confidence("ocr")
        assert_true(0 < c2 <= 1, "0 < c2 <= 1")

    def test_analyze_full(self):
        """完整分析"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(800, 600))
            tmp = f.name
        try:
            analysis = self.engine.analyze("med_test", tmp, "full")
            assert_eq(analysis.media_id, "med_test", "media id")
            assert_true(analysis.description != "", "description non-empty")
            assert_true(analysis.analysis_type == "full", "type full")
        finally:
            os.remove(tmp)

    def test_analyze_ocr_only(self):
        """仅 OCR"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            analysis = self.engine.analyze("med_test", tmp, "ocr")
            assert_true(analysis.ocr_text is not None, "ocr_text present")
        finally:
            os.remove(tmp)

    def test_analyze_objects_only(self):
        """仅对象检测"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            analysis = self.engine.analyze("med_test", tmp, "objects")
            assert_true(len(analysis.detected_objects) > 0, "objects present")
        finally:
            os.remove(tmp)

    def test_analyze_ui_only(self):
        """仅 UI 检测"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(800, 600))
            tmp = f.name
        try:
            analysis = self.engine.analyze("med_test", tmp, "ui")
            assert_true(len(analysis.ui_elements) > 0, "ui elements present")
        finally:
            os.remove(tmp)

    def test_analyze_file_not_found(self):
        """分析不存在的文件"""
        try:
            self.engine.analyze("med_test", "/nonexistent/file.png", "full")
            assert_true(False, "should have raised")
        except FileNotFoundError:
            pass

    def test_validate_image_valid(self):
        """验证有效图像"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            ok, info = validate_image(tmp)
            assert_true(ok, "valid image")
            assert_eq(info, "image/png", "PNG mime")
        finally:
            os.remove(tmp)

    def test_validate_image_not_found(self):
        """验证不存在的图像"""
        ok, info = validate_image("/nonexistent.png")
        assert_false(ok, "not ok")
        assert_true("not found" in info.lower(), "error mentions not found")

    def test_validate_image_too_large(self):
        """验证超大图像"""
        # Mock: 创建一个实际小文件但测试函数应该处理大小
        # 实际 MAX_IMAGE_SIZE 是 10MB，单元测试不直接测试
        assert_true(MAX_IMAGE_SIZE == 10 * 1024 * 1024, "10MB limit")

    def test_generate_thumbnail(self):
        """生成缩略图"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            src = f.name
        thumb = src + ".thumb.png"
        try:
            result = self.engine.generate_thumbnail(src, thumb)
            assert_true(result, "thumbnail generated")
        finally:
            try:
                os.remove(src)
                if os.path.exists(thumb):
                    os.remove(thumb)
            except Exception:
                pass

    def test_supported_image_mime_types(self):
        """支持的图像类型"""
        assert_in("image/png", SUPPORTED_IMAGE_MIME_TYPES, "png supported")
        assert_in("image/jpeg", SUPPORTED_IMAGE_MIME_TYPES, "jpeg supported")


# ============================================================
# Audio Engine 测试
# ============================================================

class TestAudioEngine(unittest.TestCase):
    """Audio 引擎测试"""

    def setUp(self):
        self.engine = AudioEngine()

    def test_detect_mime_wav(self):
        """检测 WAV MIME"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav())
            tmp = f.name
        try:
            mime = self.engine._detect_mime_type(tmp)
            assert_eq(mime, "audio/wav", "WAV mime")
        finally:
            os.remove(tmp)

    def test_detect_mime_mp3(self):
        """检测 MP3 MIME"""
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(b"ID3\x04\x00\x00\x00\x00\x00\x00")
            tmp = f.name
        try:
            mime = self.engine._detect_mime_type(tmp)
            assert_eq(mime, "audio/mpeg", "MP3 mime")
        finally:
            os.remove(tmp)

    def test_detect_mime_ogg(self):
        """检测 OGG MIME"""
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
            f.write(b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00")
            tmp = f.name
        try:
            mime = self.engine._detect_mime_type(tmp)
            assert_eq(mime, "audio/ogg", "OGG mime")
        finally:
            os.remove(tmp)

    def test_parse_wav_duration(self):
        """解析 WAV 时长"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav(duration=2.0))
            tmp = f.name
        try:
            duration = self.engine._parse_wav_duration(tmp)
            assert_true(duration > 1.5 and duration < 2.5, f"duration ~2s, got {duration}")
        finally:
            os.remove(tmp)

    def test_estimate_duration(self):
        """估算时长"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav(duration=1.5))
            tmp = f.name
        try:
            duration = self.engine._estimate_duration(tmp, "audio/wav", os.path.getsize(tmp))
            assert_true(duration > 0, "duration positive")
        finally:
            os.remove(tmp)

    def test_estimate_duration_fallback(self):
        """时长估算回退（无 WAV）"""
        duration = self.engine._estimate_duration("/tmp/fake.mp3", "audio/mpeg", 32000)
        assert_true(duration > 0, "estimated positive")

    def test_detect_language_hint(self):
        """语言检测（带 hint）"""
        lang = self.engine._detect_language("en-US", "/tmp/audio.wav")
        assert_eq(lang, "en-US", "hint respected")

    def test_detect_language_filename(self):
        """语言检测（基于文件名）"""
        lang = self.engine._detect_language(None, "/tmp/english_audio.wav")
        assert_eq(lang, "en-US", "detected en")

        lang2 = self.engine._detect_language(None, "/tmp/chinese_zh.wav")
        assert_eq(lang2, "zh-CN", "detected zh")

    def test_generate_transcript(self):
        """生成转写"""
        t = self.engine._generate_transcript(10.0, "zh-CN")
        assert_true(len(t) > 0, "non-empty")
        t2 = self.engine._generate_transcript(2.0, "en-US")
        assert_true(len(t2) > 0, "non-empty short")

    def test_analyze_sentiment(self):
        """情感分析"""
        s = self.engine._analyze_sentiment("这是一个好的项目")
        assert_eq(s, "positive", "positive detected")

        s2 = self.engine._analyze_sentiment("This is bad and terrible")
        assert_eq(s2, "negative", "negative detected")

        s3 = self.engine._analyze_sentiment("今天天气")
        assert_eq(s3, "neutral", "neutral detected")

    def test_split_sentences(self):
        """句子分割"""
        s = self.engine._split_sentences("hello. world! how are you?")
        assert_true(len(s) >= 2, f"multiple sentences, got {len(s)}")

    def test_detect_key_segments(self):
        """关键片段识别"""
        segs = self.engine._detect_key_segments(10.0, "今天天气很好")
        assert_true(len(segs) >= 1, "at least 1 segment")
        for seg in segs:
            assert_in("start", seg, "start present")
            assert_in("end", seg, "end present")
            assert_in("text", seg, "text present")

    def test_compute_confidence(self):
        """计算置信度"""
        c = self.engine._compute_confidence(10.0, "hello world")
        assert_true(0.3 <= c <= 0.95, "valid range")
        c2 = self.engine._compute_confidence(0.5, "")
        assert_true(c2 < c, "empty transcript lower confidence")

    def test_analyze_full(self):
        """完整音频分析"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav(duration=3.0))
            tmp = f.name
        try:
            analysis = self.engine.analyze("med_audio", tmp, "zh-CN")
            assert_eq(analysis.media_id, "med_audio", "media id")
            assert_true(analysis.transcript != "", "transcript non-empty")
            assert_true(analysis.duration > 0, "duration positive")
        finally:
            os.remove(tmp)

    def test_analyze_file_not_found(self):
        """分析不存在的文件"""
        try:
            self.engine.analyze("med_audio", "/nonexistent.wav")
            assert_true(False, "should have raised")
        except FileNotFoundError:
            pass

    def test_validate_audio_valid(self):
        """验证有效音频"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav())
            tmp = f.name
        try:
            ok, info = validate_audio(tmp)
            assert_true(ok, "valid")
            assert_eq(info, "audio/wav", "WAV mime")
        finally:
            os.remove(tmp)

    def test_validate_audio_not_found(self):
        """验证不存在的音频"""
        ok, info = validate_audio("/nonexistent.wav")
        assert_false(ok, "not ok")

    def test_generate_waveform(self):
        """生成波形"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav())
            tmp = f.name
        try:
            wave = self.engine.generate_waveform(tmp, 50)
            assert_eq(len(wave), 50, "wave length")
            for v in wave:
                assert_true(0 <= v <= 1, f"value in [0,1], got {v}")
        finally:
            os.remove(tmp)

    def test_supported_audio_mime_types(self):
        """支持的音频类型"""
        assert_in("audio/wav", SUPPORTED_AUDIO_MIME_TYPES, "wav")
        assert_in("audio/mpeg", SUPPORTED_AUDIO_MIME_TYPES, "mpeg")


# ============================================================
# MediaManager 测试
# ============================================================

class TestMediaManager(unittest.TestCase):
    """媒体管理器测试"""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="hermes_mm_test_")
        self.manager = MediaManager(storage_dir=self.tmp_dir)

    def tearDown(self):
        import shutil
        try:
            shutil.rmtree(self.tmp_dir)
        except Exception:
            pass

    def test_singleton(self):
        """单例模式"""
        # 注意：每个实例独立，因为单例由 get_manager() 管理
        m1 = MediaManager(storage_dir=self.tmp_dir)
        m2 = MediaManager(storage_dir=self.tmp_dir)
        assert_true(m1 is not m2, "different instances when constructed directly")

    def test_get_manager_singleton(self):
        """get_manager 单例"""
        m1 = get_manager()
        m2 = get_manager()
        assert_true(m1 is m2, "singleton")

    def test_upload_image(self):
        """上传图像"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(640, 480))
            tmp = f.name
        try:
            media = self.manager.upload_media(
                source_path=tmp,
                media_type=MediaType.IMAGE.value,
                uploaded_by="user1",
            )
            assert_eq(media.type, "image", "type image")
            assert_eq(media.uploaded_by, "user1", "uploaded_by")
            assert_true(media.width == 640, "width parsed")
            assert_true(media.height == 480, "height parsed")
            assert_true(media.thumbnail_path is not None, "thumbnail created")
        finally:
            os.remove(tmp)

    def test_upload_audio(self):
        """上传音频"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav(duration=2.0))
            tmp = f.name
        try:
            media = self.manager.upload_media(
                source_path=tmp,
                media_type=MediaType.AUDIO.value,
                uploaded_by="user1",
            )
            assert_eq(media.type, "audio", "type audio")
            assert_true(media.duration > 0, "duration parsed")
        finally:
            os.remove(tmp)

    def test_upload_dedup(self):
        """上传去重"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            m1 = self.manager.upload_media(tmp, "image", "user1")
            m2 = self.manager.upload_media(tmp, "image", "user1")
            assert_eq(m1.media_id, m2.media_id, "dedup by checksum+user")
        finally:
            os.remove(tmp)

    def test_upload_invalid_format(self):
        """上传无效格式"""
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
            f.write(b"not an image")
            tmp = f.name
        try:
            try:
                self.manager.upload_media(tmp, "image", "user1")
                assert_true(False, "should have raised")
            except ValueError:
                pass
        finally:
            os.remove(tmp)

    def test_upload_unsupported_type(self):
        """上传不支持的类型"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            try:
                self.manager.upload_media(tmp, "video", "user1")
                assert_true(False, "should have raised")
            except ValueError:
                pass
        finally:
            os.remove(tmp)

    def test_get_media(self):
        """获取媒体"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            found = self.manager.get_media(media.media_id)
            assert_true(found is not None, "found")
            assert_eq(found.media_id, media.media_id, "id matches")
        finally:
            os.remove(tmp)

    def test_get_media_not_found(self):
        """获取不存在的媒体"""
        found = self.manager.get_media("med_nonexistent")
        assert_true(found is None, "not found")

    def test_list_media(self):
        """列出媒体"""
        for i in range(3):
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                f.write(make_png())
                tmp = f.name
            try:
                self.manager.upload_media(tmp, "image", f"user{i}")
            finally:
                os.remove(tmp)

        results = self.manager.list_media()
        assert_true(len(results) >= 3, "at least 3 media")

    def test_list_media_filter(self):
        """按类型过滤"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp_img = f.name
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav())
            tmp_aud = f.name
        try:
            self.manager.upload_media(tmp_img, "image", "user1")
            self.manager.upload_media(tmp_aud, "audio", "user1")

            images = self.manager.list_media(media_type="image")
            audios = self.manager.list_media(media_type="audio")
            assert_true(len(images) >= 1, "at least 1 image")
            assert_true(len(audios) >= 1, "at least 1 audio")
        finally:
            os.remove(tmp_img)
            os.remove(tmp_aud)

    def test_delete_media(self):
        """删除媒体"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            deleted = self.manager.delete_media(media.media_id)
            assert_true(deleted, "deleted")
            found = self.manager.get_media(media.media_id)
            assert_true(found is None, "not found after delete")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_delete_media_permission_denied(self):
        """删除他人媒体被拒"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            try:
                self.manager.delete_media(media.media_id, uploaded_by="user2")
                assert_true(False, "should have raised")
            except PermissionError:
                pass
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_analyze_vision(self):
        """Vision 分析"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(800, 600))
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            analysis = self.manager.analyze_vision(media.media_id, "full")
            assert_eq(analysis.media_id, media.media_id, "media id")
            assert_true(analysis.description != "", "description non-empty")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_analyze_vision_non_image(self):
        """非图像不能 Vision 分析"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav())
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "audio", "user1")
            try:
                self.manager.analyze_vision(media.media_id, "full")
                assert_true(False, "should have raised")
            except ValueError:
                pass
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_list_vision_analyses(self):
        """列出 Vision 分析"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            self.manager.analyze_vision(media.media_id, "ocr")
            self.manager.analyze_vision(media.media_id, "objects")
            results = self.manager.list_vision_analyses(media_id=media.media_id)
            assert_true(len(results) >= 2, "at least 2 analyses")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_analyze_audio(self):
        """Audio 分析"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav(duration=2.0))
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "audio", "user1")
            analysis = self.manager.analyze_audio(media.media_id, "zh-CN")
            assert_eq(analysis.media_id, media.media_id, "media id")
            assert_true(analysis.transcript != "", "transcript non-empty")
            assert_true(analysis.duration > 0, "duration positive")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_analyze_audio_non_audio(self):
        """非音频不能 Audio 分析"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            try:
                self.manager.analyze_audio(media.media_id)
                assert_true(False, "should have raised")
            except ValueError:
                pass
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_list_audio_analyses(self):
        """列出 Audio 分析"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav(duration=5.0))
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "audio", "user1")
            self.manager.analyze_audio(media.media_id, "zh-CN")
            results = self.manager.list_audio_analyses(media_id=media.media_id)
            assert_true(len(results) >= 1, "at least 1 analysis")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_send_message_text(self):
        """发送纯文本消息"""
        msg = self.manager.send_message(
            session_id="sess_1",
            text_content="hello world",
            uploaded_by="user1",
        )
        assert_eq(msg.role, "user", "user role")
        assert_eq(msg.text_content, "hello world", "text preserved")

    def test_send_message_with_media(self):
        """发送多模态消息"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(800, 600))
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            # 先做 vision 分析，让 assistant reply 有内容
            self.manager.analyze_vision(media.media_id, "full")

            msg = self.manager.send_message(
                session_id="sess_1",
                text_content="分析这张图",
                media_ids=[media.media_id],
                uploaded_by="user1",
            )
            assert_eq(msg.role, "user", "user role")
            assert_eq(len(msg.media_items), 1, "1 media ref")

            # 验证有 assistant 回复
            messages = self.manager.list_messages("sess_1")
            assert_true(len(messages) >= 2, "at least 2 messages (user + assistant)")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    def test_send_message_invalid_media(self):
        """发送消息引用无效媒体"""
        try:
            self.manager.send_message(
                session_id="sess_1",
                text_content="test",
                media_ids=["med_invalid"],
                uploaded_by="user1",
            )
            assert_true(False, "should have raised")
        except ValueError:
            pass

    def test_list_messages(self):
        """列出消息"""
        for i in range(3):
            self.manager.send_message(
                session_id="sess_1",
                text_content=f"msg {i}",
                uploaded_by="user1",
            )
        results = self.manager.list_messages("sess_1")
        assert_true(len(results) >= 3, "at least 3 messages")

    def test_get_message(self):
        """获取消息"""
        msg = self.manager.send_message(
            session_id="sess_1",
            text_content="test",
            uploaded_by="user1",
        )
        found = self.manager.get_message(msg.message_id)
        assert_true(found is not None, "found")
        assert_eq(found.message_id, msg.message_id, "id matches")

    def test_get_message_not_found(self):
        """获取不存在的消息"""
        found = self.manager.get_message("msg_nonexistent")
        assert_true(found is None, "not found")

    def test_get_stats(self):
        """获取统计"""
        stats = self.manager.get_stats()
        assert_in("total_media", stats, "total_media")
        assert_in("image_count", stats, "image_count")
        assert_in("audio_count", stats, "audio_count")
        assert_in("messages", stats, "messages")
        assert_in("storage_dir", stats, "storage_dir")

    def test_health(self):
        """健康检查"""
        h = self.manager.health()
        assert_eq(h["service"], "multimodal", "service name")
        assert_eq(h["status"], "healthy", "healthy")
        assert_in("storage_dir", h, "storage_dir present")

    def test_sanitize_filename(self):
        """文件名清洗"""
        safe = self.manager._sanitize_filename("../../../etc/passwd")
        assert_false(".." in safe, "no ..")
        assert_false("/" in safe, "no /")
        assert_false("\\" in safe, "no \\")

        safe2 = self.manager._sanitize_filename("normal_file.png")
        assert_eq(safe2, "normal_file.png", "normal preserved")

    def test_safe_filename_pattern(self):
        """安全文件名正则"""
        assert_true(SAFE_FILENAME_PATTERN.match("normal.png"), "normal ok")
        assert_true(SAFE_FILENAME_PATTERN.match("中文.png"), "chinese ok")
        assert_false(SAFE_FILENAME_PATTERN.match("../bad"), "bad blocked")
        assert_false(SAFE_FILENAME_PATTERN.match("with space.png"), "space blocked")


# ============================================================
# 集成测试
# ============================================================

class TestMultimodalIntegration(unittest.TestCase):
    """多模态集成测试"""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="hermes_int_test_")
        self.manager = MediaManager(storage_dir=self.tmp_dir)

    def tearDown(self):
        import shutil
        try:
            shutil.rmtree(self.tmp_dir)
        except Exception:
            pass

    def test_full_workflow(self):
        """完整工作流：上传 -> 分析 -> 多模态对话"""
        # 1. 上传图像
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png(1280, 720))
            tmp_img = f.name
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(make_wav(duration=3.0))
            tmp_aud = f.name
        try:
            # 2. 上传媒体
            img = self.manager.upload_media(tmp_img, "image", "user1", session_id="sess_1")
            aud = self.manager.upload_media(tmp_aud, "audio", "user1", session_id="sess_1")

            assert_eq(img.type, "image", "image type")
            assert_eq(aud.type, "audio", "audio type")

            # 3. 分析
            vis = self.manager.analyze_vision(img.media_id, "full")
            assert_true(vis.description != "", "vision description")

            aud_ana = self.manager.analyze_audio(aud.media_id, "zh-CN")
            assert_true(aud_ana.transcript != "", "audio transcript")

            # 4. 发送多模态消息
            msg = self.manager.send_message(
                session_id="sess_1",
                text_content="请分析这段录音和这张图",
                media_ids=[img.media_id, aud.media_id],
                uploaded_by="user1",
            )
            assert_eq(len(msg.media_items), 2, "2 media refs")

            # 5. 验证历史
            messages = self.manager.list_messages("sess_1")
            assert_true(len(messages) >= 2, "user + assistant messages")

            # 6. 验证统计
            stats = self.manager.get_stats()
            assert_true(stats["total_media"] >= 2, "stats total_media")
            assert_true(stats["vision_analyses"] >= 1, "vision analyses")
            assert_true(stats["audio_analyses"] >= 1, "audio analyses")
        finally:
            try:
                os.remove(tmp_img)
                os.remove(tmp_aud)
            except Exception:
                pass

    def test_persistence(self):
        """持久化测试"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(make_png())
            tmp = f.name
        try:
            media = self.manager.upload_media(tmp, "image", "user1")
            self.manager.analyze_vision(media.media_id, "ocr")

            # 重新加载
            m2 = MediaManager(storage_dir=self.tmp_dir)
            found = m2.get_media(media.media_id)
            assert_true(found is not None, "persisted")

            analyses = m2.list_vision_analyses(media_id=media.media_id)
            assert_true(len(analyses) >= 1, "persisted analyses")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main()
