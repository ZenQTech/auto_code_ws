"""
# ============================================================
# Multimodal Chat API (v1.0.0)
# Cycle 69 G69-03
# ============================================================
# 核心作用：暴露 MultimodalChatService 为 REST API
#   POST /api/multimodal-chat/chat         多模态对话（非流式）
#   POST /api/multimodal-chat/chat/stream  多模态对话（SSE 流式）
#   POST /api/multimodal-chat/vision/analyze 图片分析（OCR/描述）
#   GET  /api/multimodal-chat/models       列出支持的多模态模型
#   GET  /api/multimodal-chat/stats        服务统计
#   GET  /api/multimodal-chat/health       健康检查
#   POST /api/multimodal-chat/transcribe   语音转写（mock）
# 输入参数：JSON body（messages, model, stream, ...）
# 输出结果：JSON 响应 或 SSE 流
# 对标：Trae SOLO Multimodal + Codex multi_modal.rs
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-03 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.multimodal_chat import (
    ChatRequest,
    ChatResponse,
    ContentPart,
    ContentPartType,
    ImageTooLargeError,
    InvalidMessageFormatError,
    LLMCallError,
    MAX_IMAGES_PER_REQUEST,
    MAX_MESSAGE_SIZE_BYTES,
    MessageTooLargeError,
    MultimodalError,
    MultimodalMessage,
    MultimodalRole,
    SupportedModel,
    TooManyImagesError,
    UnsupportedImageFormatError,
    VoiceTranscript,
    get_multimodal_chat_service,
    validate_messages,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/multimodal-chat", tags=["multimodal-chat"])


# ============================================================
# Pydantic Models
# ============================================================
class ContentPartRequest(BaseModel):
    """内容片段请求"""
    type: str = Field(..., description="text | image_url")
    text: Optional[str] = None
    image_url: Optional[Dict[str, str]] = None


class MultimodalMessageRequest(BaseModel):
    """多模态消息请求"""
    role: str = Field(..., description="user | assistant | system")
    content: Any = Field(..., description="str 或 List[ContentPart]")
    name: Optional[str] = None


class MultimodalChatAPIRequest(BaseModel):
    """多模态聊天 API 请求"""
    messages: List[MultimodalMessageRequest]
    model: str = Field(default=SupportedModel.GPT_4O.value)
    stream: bool = Field(default=False)
    max_tokens: int = Field(default=4096, ge=1, le=32000)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    system_prompt: Optional[str] = None
    session_id: Optional[str] = None
    user_id: Optional[str] = None


class MultimodalChatAPIResponse(BaseModel):
    """多模态聊天 API 响应"""
    success: bool = True
    response: Optional[Dict[str, Any]] = None
    error: str = ""


class VisionAnalyzeAPIRequest(BaseModel):
    """Vision 分析请求"""
    image_data: str = Field(..., description="base64 dataURL 或 HTTP URL")
    prompt: str = Field(default="请详细描述这张图片")
    model: str = Field(default=SupportedModel.GPT_4O.value)
    analysis_type: str = Field(default="description", pattern="^(description|ocr|objects|ui)$")


class VisionAnalyzeAPIResponse(BaseModel):
    """Vision 分析响应"""
    success: bool = True
    description: str
    confidence: float = 0.0
    model_used: str
    analysis_type: str
    tokens_used: int = 0


class VoiceTranscribeRequest(BaseModel):
    """语音转写请求"""
    audio_data: Optional[str] = Field(default=None, description="base64 音频数据")
    audio_url: Optional[str] = Field(default=None, description="音频 URL")
    language: str = Field(default="zh-CN")
    is_final: bool = Field(default=True)


class VoiceTranscribeResponse(BaseModel):
    """语音转写响应"""
    success: bool = True
    transcript: str
    is_final: bool = True
    confidence: float = 0.0
    language: str = "zh-CN"
    duration_ms: int = 0


class ModelInfo(BaseModel):
    """模型信息"""
    id: str
    name: str
    supports_vision: bool = True
    max_tokens: int = 4096
    is_mock: bool = False


class StatsResponse(BaseModel):
    """统计响应"""
    success: bool = True
    stats: Dict[str, Any]


class HealthResponse(BaseModel):
    """健康检查响应"""
    success: bool = True
    status: str
    service: str
    version: str
    supported_models: List[str]


# ============================================================
# Health & Stats
# ============================================================
SERVICE_VERSION = "1.0.0"


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """健康检查"""
    return HealthResponse(
        success=True,
        status="ok",
        service="multimodal_chat",
        version=SERVICE_VERSION,
        supported_models=[m.value for m in SupportedModel],
    )


@router.get("/stats", response_model=StatsResponse)
async def stats() -> StatsResponse:
    """服务统计"""
    service = get_multimodal_chat_service()
    return StatsResponse(
        success=True,
        stats=service.get_stats(),
    )


@router.get("/models", response_model=List[ModelInfo])
async def list_models() -> List[ModelInfo]:
    """列出支持的多模态模型"""
    return [
        ModelInfo(
            id=SupportedModel.GPT_4O.value,
            name="GPT-4o (OpenAI)",
            supports_vision=True,
            max_tokens=4096,
            is_mock=False,
        ),
        ModelInfo(
            id=SupportedModel.GPT_4_VISION.value,
            name="GPT-4 Vision Preview",
            supports_vision=True,
            max_tokens=4096,
            is_mock=False,
        ),
        ModelInfo(
            id=SupportedModel.CLAUDE_3_5_SONNET.value,
            name="Claude 3.5 Sonnet (Anthropic)",
            supports_vision=True,
            max_tokens=8192,
            is_mock=False,
        ),
        ModelInfo(
            id=SupportedModel.CLAUDE_3_OPUS.value,
            name="Claude 3 Opus (Anthropic)",
            supports_vision=True,
            max_tokens=4096,
            is_mock=False,
        ),
        ModelInfo(
            id=SupportedModel.MOCK_MULTIMODAL.value,
            name="Mock Multimodal (Test/Fallback)",
            supports_vision=True,
            max_tokens=4096,
            is_mock=True,
        ),
    ]


# ============================================================
# 转换辅助函数
# ============================================================
def _api_request_to_internal(req: MultimodalChatAPIRequest) -> ChatRequest:
    """将 API 请求转换为内部 ChatRequest"""
    internal_messages: List[MultimodalMessage] = []
    for msg_req in req.messages:
        # 验证角色
        if msg_req.role not in [r.value for r in MultimodalRole]:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid role: {msg_req.role}",
            )
        content_data = msg_req.content
        parts: List[ContentPart] = []
        if isinstance(content_data, str):
            parts.append(ContentPart(type=ContentPartType.TEXT.value, text=content_data))
        elif isinstance(content_data, list):
            for p in content_data:
                if isinstance(p, dict):
                    try:
                        parts.append(ContentPart.from_dict(p))
                    except InvalidMessageFormatError as e:
                        raise HTTPException(status_code=400, detail=str(e))
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid content type: {type(content_data)}"
            )
        if not parts:
            raise HTTPException(status_code=400, detail="Empty content")
        internal_messages.append(
            MultimodalMessage(
                role=msg_req.role,
                content=parts,
                name=msg_req.name,
            )
        )

    return ChatRequest(
        messages=internal_messages,
        model=req.model,
        stream=req.stream,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        system_prompt=req.system_prompt,
        session_id=req.session_id,
        user_id=req.user_id,
    )


# ============================================================
# Chat Endpoints
# ============================================================
@router.post("/chat", response_model=MultimodalChatAPIResponse)
async def chat(req: MultimodalChatAPIRequest) -> MultimodalChatAPIResponse:
    """多模态对话（非流式）"""
    try:
        chat_req = _api_request_to_internal(req)
    except (InvalidMessageFormatError, Exception) as e:
        raise HTTPException(status_code=400, detail=str(e))

    service = get_multimodal_chat_service()
    try:
        response = await service.chat(chat_req)
        return MultimodalChatAPIResponse(
            success=True,
            response=response.to_dict(),
        )
    except UnsupportedImageFormatError as e:
        raise HTTPException(status_code=415, detail=str(e))
    except ImageTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e))
    except TooManyImagesError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except MessageTooLargeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except InvalidMessageFormatError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LLMCallError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except MultimodalError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in multimodal chat")
        raise HTTPException(status_code=500, detail=f"Internal error: {e}")


@router.post("/chat/stream")
async def chat_stream(req: MultimodalChatAPIRequest):
    """多模态对话（SSE 流式）"""
    try:
        chat_req = _api_request_to_internal(req)
    except (InvalidMessageFormatError, Exception) as e:
        raise HTTPException(status_code=400, detail=str(e))

    service = get_multimodal_chat_service()
    return StreamingResponse(
        _stream_response(service, chat_req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _stream_response(
    service,
    req: ChatRequest,
) -> AsyncIterator[str]:
    """生成 SSE 流式响应"""
    response_id = f"chatcmpl-{int(time.time() * 1000)}"
    created = int(time.time())

    try:
        # 发送首条事件
        yield _sse_event("start", {
            "id": response_id,
            "model": req.model,
            "created": created,
        })

        # 流式内容
        async for chunk in service.stream_chat(req):
            yield _sse_event("content", {
                "id": response_id,
                "delta": chunk,
            })

        # 结束事件
        yield _sse_event("done", {
            "id": response_id,
            "finish_reason": "stop",
        })

    except Exception as e:
        logger.exception("Stream error")
        yield _sse_event("error", {
            "id": response_id,
            "error": str(e),
        })


def _sse_event(event_type: str, data: Dict[str, Any]) -> str:
    """构造 SSE 事件"""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ============================================================
# Vision 分析
# ============================================================
@router.post("/vision/analyze", response_model=VisionAnalyzeAPIResponse)
async def vision_analyze(req: VisionAnalyzeAPIRequest) -> VisionAnalyzeAPIResponse:
    """Vision 分析（图片描述/OCR/对象识别/UI 分析）"""
    import base64

    # 构造多模态消息
    content_parts: List[Dict[str, Any]] = []
    if req.image_data.startswith("data:"):
        # 验证 base64
        try:
            header, b64_data = req.image_data.split(",", 1)
            base64.b64decode(b64_data)
        except (ValueError, base64.binascii.Error) as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": req.image_data, "detail": "auto"},
        })
    else:
        # HTTP URL
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": req.image_data, "detail": "auto"},
        })

    content_parts.insert(0, {"type": "text", "text": req.prompt})

    try:
        chat_req = ChatRequest(
            messages=[MultimodalMessage(role="user", content=[
                ContentPart.from_dict(p) for p in content_parts
            ])],
            model=req.model,
            max_tokens=2048,
            temperature=0.3,
        )
    except InvalidMessageFormatError as e:
        raise HTTPException(status_code=400, detail=str(e))

    service = get_multimodal_chat_service()
    try:
        response = await service.chat(chat_req)
        return VisionAnalyzeAPIResponse(
            success=True,
            description=response.content,
            confidence=0.85,  # Mock 置信度
            model_used=response.model,
            analysis_type=req.analysis_type,
            tokens_used=response.usage.get("total_tokens", 0),
        )
    except Exception as e:
        logger.exception("Vision analyze failed")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 语音转写（Mock 实现）
# ============================================================
@router.post("/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe(req: VoiceTranscribeRequest) -> VoiceTranscribeResponse:
    """
    语音转写
    注意：实际转写由前端 Web Speech API 完成
    此端点用于：(1) 备用服务端转写 (2) 审计 (3) 测试
    """
    # Mock 实现：返回示例转写结果
    if req.audio_data:
        # base64 音频存在
        try:
            import base64
            audio_bytes = base64.b64decode(req.audio_data)
            duration_ms = int(len(audio_bytes) / 32)  # 粗略估算
        except Exception:
            duration_ms = 1000
    else:
        duration_ms = 1000

    # Mock 转写（实际由 Web Speech API 在浏览器中完成）
    return VoiceTranscribeResponse(
        success=True,
        transcript="[Mock transcription] Please use Web Speech API in browser",
        is_final=req.is_final,
        confidence=0.9,
        language=req.language,
        duration_ms=duration_ms,
    )


# ============================================================
# 配置端点
# ============================================================
@router.get("/config")
async def get_config() -> Dict[str, Any]:
    """获取多模态配置"""
    return {
        "success": True,
        "config": {
            "max_images_per_request": MAX_IMAGES_PER_REQUEST,
            "max_message_size_mb": MAX_MESSAGE_SIZE_BYTES // (1024 * 1024),
            "supported_image_formats": [
                "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"
            ],
            "supported_languages": [
                "zh-CN", "zh-HK", "en-US", "en-GB", "ja-JP",
                "ko-KR", "es-ES", "fr-FR", "de-DE",
            ],
            "stream_chunk_interval_ms": 50,
        },
    }
