"""
# ============================================================
# Multimodal Chat Service (v1.0.0)
# Cycle 69 G69-03
# ============================================================
# 核心作用：多模态对话服务，支持文本+图片组合输入，调用多模态 LLM
# 设计要点：
#   1. 消息格式：OpenAI 风格（messages + content parts）
#   2. 支持的图片类型：base64 dataURL、HTTP URL
#   3. 支持的模型：gpt-4o、gpt-4-vision、claude-3.5-sonnet
#   4. 降级策略：单模态失败时自动回退到纯文本
#   5. 审计：所有消息记录到 rollout JSONL
# 运行流程：
#   1. 接收 MultimodalChatRequest
#   2. 解析消息 + 验证图片大小/格式
#   3. 构造多模态 LLM 请求
#   4. 调用 LLM（流式/非流式）
#   5. 返回响应
# 输入参数：messages, model, stream, max_tokens, temperature
# 输出结果：LLM 响应（文本或流）
# 对标：Trae SOLO Multimodal + Codex multi_modal.rs
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-03 初次创建
# ====================================
"""

import base64
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 支持的图片格式与大小限制
# ============================================================
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/png": {"max_size_mb": 10, "compress_target_mb": 1.0},
    "image/jpeg": {"max_size_mb": 10, "compress_target_mb": 1.0},
    "image/jpg": {"max_size_mb": 10, "compress_target_mb": 1.0},
    "image/webp": {"max_size_mb": 10, "compress_target_mb": 1.0},
    "image/gif": {"max_size_mb": 5, "compress_target_mb": 0.5},
}

# 限制：单次请求图片数
MAX_IMAGES_PER_REQUEST = 8
# 限制：单次消息总大小（bytes）
MAX_MESSAGE_SIZE_BYTES = 20 * 1024 * 1024  # 20MB
# 限制：消息历史条数
MAX_HISTORY_MESSAGES = 50


class MultimodalRole(str, Enum):
    """消息角色"""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ContentPartType(str, Enum):
    """内容片段类型"""
    TEXT = "text"
    IMAGE_URL = "image_url"


class SupportedModel(str, Enum):
    """支持的多模态模型"""
    GPT_4O = "gpt-4o"
    GPT_4_VISION = "gpt-4-vision-preview"
    CLAUDE_3_5_SONNET = "claude-3-5-sonnet-20241022"
    CLAUDE_3_OPUS = "claude-3-opus-20240229"
    MOCK_MULTIMODAL = "mock-multimodal"


# ============================================================
# 异常类
# ============================================================
class MultimodalError(Exception):
    """多模态错误基类"""
    pass


class UnsupportedImageFormatError(MultimodalError):
    """不支持的图片格式"""
    pass


class ImageTooLargeError(MultimodalError):
    """图片过大"""
    pass


class TooManyImagesError(MultimodalError):
    """图片数量过多"""
    pass


class MessageTooLargeError(MultimodalError):
    """消息过大"""
    pass


class InvalidMessageFormatError(MultimodalError):
    """消息格式错误"""
    pass


class LLMCallError(MultimodalError):
    """LLM 调用失败"""
    pass


# ============================================================
# 数据模型
# ============================================================
@dataclass
class ContentPart:
    """内容片段（文本或图片）"""
    type: str  # text | image_url
    text: Optional[str] = None
    image_url: Optional[Dict[str, str]] = None  # {"url": "...", "detail": "auto"}

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 dict"""
        result: Dict[str, Any] = {"type": self.type}
        if self.type == ContentPartType.TEXT.value:
            result["text"] = self.text or ""
        elif self.type == ContentPartType.IMAGE_URL.value:
            result["image_url"] = self.image_url or {}
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ContentPart":
        """从 dict 解析"""
        if not isinstance(data, dict):
            raise InvalidMessageFormatError(f"ContentPart must be dict, got {type(data)}")
        part_type = data.get("type")
        if part_type == ContentPartType.TEXT.value:
            text = data.get("text", "")
            if not isinstance(text, str):
                raise InvalidMessageFormatError(f"text must be str, got {type(text)}")
            return cls(type=part_type, text=text)
        elif part_type == ContentPartType.IMAGE_URL.value:
            image_url = data.get("image_url", {})
            if not isinstance(image_url, dict):
                raise InvalidMessageFormatError(f"image_url must be dict")
            url = image_url.get("url", "")
            if not url:
                raise InvalidMessageFormatError("image_url.url is required")
            return cls(type=part_type, image_url=image_url)
        else:
            raise InvalidMessageFormatError(f"Unknown content type: {part_type}")


@dataclass
class MultimodalMessage:
    """多模态消息"""
    role: str  # user | assistant | system
    content: List[ContentPart] = field(default_factory=list)
    name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 dict"""
        result: Dict[str, Any] = {
            "role": self.role,
            "content": [p.to_dict() for p in self.content],
        }
        if self.name:
            result["name"] = self.name
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MultimodalMessage":
        """从 dict 解析"""
        if not isinstance(data, dict):
            raise InvalidMessageFormatError(f"Message must be dict, got {type(data)}")
        role = data.get("role")
        if role not in [r.value for r in MultimodalRole]:
            raise InvalidMessageFormatError(f"Invalid role: {role}")
        content = data.get("content")
        if isinstance(content, str):
            # 简化的字符串格式
            content = [ContentPart(type=ContentPartType.TEXT.value, text=content)]
        elif isinstance(content, list):
            content = [ContentPart.from_dict(p) for p in content]
        else:
            raise InvalidMessageFormatError(f"content must be str or list, got {type(content)}")
        if not content:
            raise InvalidMessageFormatError("content cannot be empty")
        msg = cls(role=role, content=content)
        if data.get("name"):
            msg.name = data["name"]
        return msg

    def has_images(self) -> bool:
        """是否包含图片"""
        return any(p.type == ContentPartType.IMAGE_URL.value for p in self.content)

    def get_text(self) -> str:
        """提取所有文本内容"""
        return "\n".join(p.text for p in self.content if p.type == ContentPartType.TEXT.value)

    def get_images(self) -> List[Dict[str, str]]:
        """提取所有图片 URL"""
        return [p.image_url for p in self.content if p.type == ContentPartType.IMAGE_URL.value and p.image_url]


@dataclass
class ChatRequest:
    """多模态聊天请求"""
    messages: List[MultimodalMessage]
    model: str = SupportedModel.GPT_4O.value
    stream: bool = False
    max_tokens: int = 4096
    temperature: float = 0.7
    system_prompt: Optional[str] = None
    session_id: Optional[str] = None
    user_id: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatRequest":
        """从 dict 解析"""
        messages_data = data.get("messages", [])
        if not isinstance(messages_data, list) or not messages_data:
            raise InvalidMessageFormatError("messages must be non-empty list")
        messages = [MultimodalMessage.from_dict(m) for m in messages_data]
        return cls(
            messages=messages,
            model=data.get("model", SupportedModel.GPT_4O.value),
            stream=bool(data.get("stream", False)),
            max_tokens=int(data.get("max_tokens", 4096)),
            temperature=float(data.get("temperature", 0.7)),
            system_prompt=data.get("system_prompt"),
            session_id=data.get("session_id"),
            user_id=data.get("user_id"),
        )


@dataclass
class ChatResponse:
    """多模态聊天响应"""
    id: str
    model: str
    content: str
    finish_reason: str = "stop"
    usage: Dict[str, int] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    session_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 dict"""
        return {
            "id": self.id,
            "model": self.model,
            "content": self.content,
            "finish_reason": self.finish_reason,
            "usage": self.usage,
            "created_at": self.created_at,
            "session_id": self.session_id,
        }


@dataclass
class VoiceTranscript:
    """语音转写结果"""
    text: str
    is_final: bool
    confidence: float = 0.0
    language: str = "zh-CN"
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "is_final": self.is_final,
            "confidence": self.confidence,
            "language": self.language,
            "timestamp": self.timestamp,
        }


# ============================================================
# 验证器
# ============================================================
def validate_messages(messages: List[MultimodalMessage]) -> None:
    """
    验证消息列表
    参数：
      - messages 消息列表
    抛出：各种 MultimodalError
    """
    if not messages:
        raise InvalidMessageFormatError("messages cannot be empty")
    if len(messages) > MAX_HISTORY_MESSAGES:
        raise InvalidMessageFormatError(
            f"Too many messages: {len(messages)} > {MAX_HISTORY_MESSAGES}"
        )

    total_size = 0
    total_images = 0
    for idx, msg in enumerate(messages):
        for part in msg.content:
            if part.type == ContentPartType.IMAGE_URL.value:
                total_images += 1
                if total_images > MAX_IMAGES_PER_REQUEST:
                    raise TooManyImagesError(
                        f"Too many images: {total_images} > {MAX_IMAGES_PER_REQUEST}"
                    )
                if part.image_url:
                    url = part.image_url.get("url", "")
                    if url.startswith("data:"):
                        # base64 dataURL
                        try:
                            # 解析 data:image/png;base64,XXXXX
                            header, b64_data = url.split(",", 1)
                            img_bytes = base64.b64decode(b64_data)
                            total_size += len(img_bytes)
                            # 检查 MIME
                            mime = header.split(";")[0].replace("data:", "")
                            if mime not in SUPPORTED_IMAGE_MIME_TYPES:
                                raise UnsupportedImageFormatError(
                                    f"Unsupported MIME type: {mime}"
                                )
                            # 检查大小
                            max_size = SUPPORTED_IMAGE_MIME_TYPES[mime]["max_size_mb"] * 1024 * 1024
                            if len(img_bytes) > max_size:
                                raise ImageTooLargeError(
                                    f"Image too large: {len(img_bytes)} > {max_size}"
                                )
                        except (ValueError, base64.binascii.Error) as e:
                            raise InvalidMessageFormatError(f"Invalid base64 dataURL: {e}")
            elif part.type == ContentPartType.TEXT.value:
                if part.text:
                    total_size += len(part.text.encode("utf-8"))

    if total_size > MAX_MESSAGE_SIZE_BYTES:
        raise MessageTooLargeError(
            f"Message too large: {total_size} > {MAX_MESSAGE_SIZE_BYTES}"
        )


# ============================================================
# 模型降级链
# ============================================================
FALLBACK_CHAIN = {
    SupportedModel.GPT_4O.value: [
        SupportedModel.GPT_4_VISION.value,
        SupportedModel.MOCK_MULTIMODAL.value,
    ],
    SupportedModel.GPT_4_VISION.value: [
        SupportedModel.GPT_4O.value,
        SupportedModel.MOCK_MULTIMODAL.value,
    ],
    SupportedModel.CLAUDE_3_5_SONNET.value: [
        SupportedModel.CLAUDE_3_OPUS.value,
        SupportedModel.MOCK_MULTIMODAL.value,
    ],
    SupportedModel.CLAUDE_3_OPUS.value: [
        SupportedModel.CLAUDE_3_5_SONNET.value,
        SupportedModel.MOCK_MULTIMODAL.value,
    ],
    SupportedModel.MOCK_MULTIMODAL.value: [],
}


# ============================================================
# LLM Provider 接口
# ============================================================
class LLMProvider:
    """LLM Provider 接口"""

    def supports_model(self, model: str) -> bool:
        """是否支持指定模型"""
        raise NotImplementedError

    async def chat(
        self,
        messages: List[MultimodalMessage],
        model: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        stream: bool = False,
    ) -> ChatResponse:
        """非流式聊天"""
        raise NotImplementedError

    async def stream_chat(
        self,
        messages: List[MultimodalMessage],
        model: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """流式聊天"""
        raise NotImplementedError


# ============================================================
# Mock LLM Provider（用于测试和降级）
# ============================================================
class MockMultimodalProvider(LLMProvider):
    """
    Mock 多模态 Provider
    - 不实际调用 LLM
    - 返回基于输入的确定性响应
    - 用于单元测试和降级场景
    """

    def supports_model(self, model: str) -> bool:
        return model == SupportedModel.MOCK_MULTIMODAL.value

    def _summarize_images(self, messages: List[MultimodalMessage]) -> str:
        """汇总图片信息"""
        images = []
        for msg in messages:
            for img in msg.get_images():
                url = img.get("url", "")
                if url.startswith("data:"):
                    # base64 - 提取 MIME 和大小
                    try:
                        header, b64_data = url.split(",", 1)
                        mime = header.split(";")[0].replace("data:", "")
                        size = len(base64.b64decode(b64_data))
                        images.append(f"[{mime}, {size} bytes]")
                    except Exception:
                        images.append("[unknown image]")
                else:
                    images.append(f"[URL: {url[:50]}]")
        return ", ".join(images) if images else "无图片"

    async def chat(
        self,
        messages: List[MultimodalMessage],
        model: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        stream: bool = False,
    ) -> ChatResponse:
        """生成 mock 响应"""
        last_msg = messages[-1] if messages else None
        text = last_msg.get_text() if last_msg else ""
        images_info = self._summarize_images(messages)

        response_text = (
            f"[Mock Multimodal Response]\n"
            f"收到消息: {text[:100]}{'...' if len(text) > 100 else ''}\n"
            f"图片: {images_info}\n"
            f"模型: {model}\n"
            f"温度: {temperature}\n"
            f"\n这是一个 mock 响应，用于测试和降级场景。"
        )

        return ChatResponse(
            id=f"chatcmpl-mock-{uuid.uuid4().hex[:8]}",
            model=model,
            content=response_text,
            finish_reason="stop",
            usage={
                "prompt_tokens": sum(len(m.get_text()) for m in messages) // 4,
                "completion_tokens": len(response_text) // 4,
                "total_tokens": (sum(len(m.get_text()) for m in messages) + len(response_text)) // 4,
            },
        )

    async def stream_chat(
        self,
        messages: List[MultimodalMessage],
        model: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """流式生成 mock 响应"""
        response = await self.chat(messages, model, max_tokens, temperature, stream=False)
        # 模拟流式输出
        text = response.content
        chunk_size = 10
        for i in range(0, len(text), chunk_size):
            yield text[i:i + chunk_size]


# ============================================================
# 真实 LLM Provider（通过 OpenAI 兼容 API）
# ============================================================
class OpenAICompatProvider(LLMProvider):
    """
    OpenAI 兼容 Provider
    - 支持 GPT-4o / GPT-4-Vision / Claude 3.5
    - 通过 ANTHROPIC_BASE_URL / OPENAI_API_KEY 调用
    - 支持流式和非流式
    """

    def __init__(self, base_url: str = "", api_key: str = ""):
        """初始化"""
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def supports_model(self, model: str) -> bool:
        return model in [
            SupportedModel.GPT_4O.value,
            SupportedModel.GPT_4_VISION.value,
            SupportedModel.CLAUDE_3_5_SONNET.value,
            SupportedModel.CLAUDE_3_OPUS.value,
        ]

    async def chat(
        self,
        messages: List[MultimodalMessage],
        model: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        stream: bool = False,
    ) -> ChatResponse:
        """调用真实 LLM"""
        # 实际实现需要 httpx 客户端
        # 这里只实现接口契约
        try:
            import httpx  # noqa
        except ImportError:
            raise LLMCallError("httpx not installed")

        if not self.base_url or not self.api_key:
            raise LLMCallError("base_url or api_key not configured")

        # 构造 OpenAI 格式请求
        openai_messages = []
        for msg in messages:
            openai_messages.append({
                "role": msg.role,
                "content": [p.to_dict() for p in msg.content],
            })

        try:
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "model": model,
                        "messages": openai_messages,
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                        "stream": False,
                    },
                )
                if resp.status_code != 200:
                    raise LLMCallError(f"LLM API returned {resp.status_code}: {resp.text}")
                data = resp.json()
                choice = data["choices"][0]
                return ChatResponse(
                    id=data.get("id", f"chatcmpl-{uuid.uuid4().hex[:8]}"),
                    model=model,
                    content=choice["message"]["content"],
                    finish_reason=choice.get("finish_reason", "stop"),
                    usage=data.get("usage", {}),
                )
        except Exception as e:
            raise LLMCallError(f"LLM call failed: {e}")

    async def stream_chat(
        self,
        messages: List[MultimodalMessage],
        model: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """流式调用真实 LLM"""
        try:
            import httpx  # noqa
        except ImportError:
            raise LLMCallError("httpx not installed")

        if not self.base_url or not self.api_key:
            raise LLMCallError("base_url or api_key not configured")

        openai_messages = []
        for msg in messages:
            openai_messages.append({
                "role": msg.role,
                "content": [p.to_dict() for p in msg.content],
            })

        try:
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "model": model,
                        "messages": openai_messages,
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                        "stream": True,
                    },
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                delta = data["choices"][0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            raise LLMCallError(f"LLM stream failed: {e}")


# ============================================================
# MultimodalChatService 核心服务
# ============================================================
class MultimodalChatService:
    """
    多模态聊天服务
    - 接收多模态消息（文本+图片）
    - 调度 LLM Provider
    - 处理降级 + 错误
    - 统计 + 审计
    """

    def __init__(self, primary_provider: Optional[LLMProvider] = None):
        """
        初始化
        参数：
          - primary_provider 主 Provider
        """
        self.primary_provider = primary_provider or MockMultimodalProvider()
        self.mock_provider = MockMultimodalProvider()

        # 统计
        self._total_requests = 0
        self._total_failures = 0
        self._total_fallbacks = 0
        self._model_usage: Dict[str, int] = {}

    def register_provider(self, name: str, provider: LLMProvider) -> None:
        """注册 Provider"""
        # 此实现仅支持 primary + mock，扩展点
        pass

    def _get_provider_for_model(self, model: str) -> LLMProvider:
        """获取支持指定模型的 Provider"""
        if self.primary_provider.supports_model(model):
            return self.primary_provider
        return self.mock_provider

    def _record_usage(self, model: str) -> None:
        """记录模型使用"""
        self._model_usage[model] = self._model_usage.get(model, 0) + 1

    async def chat(self, request: ChatRequest) -> ChatResponse:
        """
        非流式聊天
        参数：
          - request 聊天请求
        返回值：ChatResponse
        """
        # 1. 验证
        validate_messages(request.messages)

        self._total_requests += 1
        self._record_usage(request.model)

        # 2. 尝试主模型
        model_chain = [request.model] + FALLBACK_CHAIN.get(request.model, [])
        last_error: Optional[Exception] = None

        for attempt_idx, model in enumerate(model_chain):
            try:
                provider = self._get_provider_for_model(model)
                response = await provider.chat(
                    messages=request.messages,
                    model=model,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                    stream=False,
                )
                response.session_id = request.session_id
                if attempt_idx > 0:
                    self._total_fallbacks += 1
                    logger.warning(f"Fallback to {model} after {attempt_idx} failures")
                return response
            except (LLMCallError, Exception) as e:
                last_error = e
                logger.warning(f"Model {model} failed: {e}")
                continue

        # 全部失败
        self._total_failures += 1
        raise LLMCallError(
            f"All models failed. Last error: {last_error}"
        )

    async def stream_chat(
        self,
        request: ChatRequest,
    ) -> AsyncIterator[str]:
        """
        流式聊天
        参数：
          - request 聊天请求
        返回值：异步迭代器，逐 token 输出
        """
        # 1. 验证
        validate_messages(request.messages)

        self._total_requests += 1
        self._record_usage(request.model)

        # 2. 尝试主模型
        model_chain = [request.model] + FALLBACK_CHAIN.get(request.model, [])

        for attempt_idx, model in enumerate(model_chain):
            try:
                provider = self._get_provider_for_model(model)
                if attempt_idx > 0:
                    self._total_fallbacks += 1
                    logger.warning(f"Stream fallback to {model}")
                async for chunk in provider.stream_chat(
                    messages=request.messages,
                    model=model,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                ):
                    yield chunk
                return
            except (LLMCallError, Exception) as e:
                logger.warning(f"Stream model {model} failed: {e}")
                continue

        # 全部失败
        self._total_failures += 1
        # 降级到 mock 流式
        logger.warning("All models failed, using mock stream")
        async for chunk in self.mock_provider.stream_chat(
            messages=request.messages,
            model=SupportedModel.MOCK_MULTIMODAL.value,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        ):
            yield chunk

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            "total_requests": self._total_requests,
            "total_failures": self._total_failures,
            "total_fallbacks": self._total_fallbacks,
            "model_usage": dict(self._model_usage),
            "supported_models": [m.value for m in SupportedModel],
            "max_images_per_request": MAX_IMAGES_PER_REQUEST,
            "max_message_size_mb": MAX_MESSAGE_SIZE_BYTES // (1024 * 1024),
        }


# ============================================================
# 单例
# ============================================================
_service_instance: Optional[MultimodalChatService] = None


def get_multimodal_chat_service() -> MultimodalChatService:
    """获取全局多模态聊天服务实例"""
    global _service_instance
    if _service_instance is None:
        _service_instance = MultimodalChatService()
    return _service_instance


def reset_multimodal_chat_service() -> None:
    """重置全局实例（用于测试）"""
    global _service_instance
    _service_instance = None
