"""
# ============================================================
# 多模态模块 - REST API
# ============================================================
# 核心作用：提供多模态支持的 HTTP 接口
# 包含：媒体上传、Vision 分析、Audio 分析、多模态消息、统计
# 运行流程：
#   1. 前端通过 multipart/form-data 上传媒体
#   2. 后端验证 + 存储 + 返回 media_id
#   3. 前端调用 /vision/analyze 或 /audio/analyze
#   4. 前端通过 /chat/send 发送多模态消息
# 输入参数：multipart 文件 + JSON 请求体
# 输出结果：JSON 响应（含媒体项、分析结果、消息）
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from .manager import get_manager
from .models import MediaType, MessageRole


router = APIRouter(prefix="/multimodal", tags=["multimodal"])


# ============================================================
# Pydantic 模型
# ============================================================

class VisionAnalyzeRequest(BaseModel):
    """Vision 分析请求"""

    media_id: str
    analysis_type: str = Field(default="full", pattern="^(full|ocr|objects|ui|description)$")


class AudioAnalyzeRequest(BaseModel):
    """Audio 分析请求"""

    media_id: str
    language_hint: Optional[str] = None


class ChatSendRequest(BaseModel):
    """多模态消息发送请求"""

    session_id: str
    text: Optional[str] = None
    media_ids: List[str] = Field(default_factory=list)
    uploaded_by: str = "default_user"
    metadata: Optional[Dict[str, Any]] = None


# ============================================================
# 健康检查 + 统计
# ============================================================

@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查

    Returns:
        Dict[str, Any]: 健康状态
    """
    return get_manager().health()


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """统计信息

    Returns:
        Dict[str, Any]: 统计
    """
    return {
        "success": True,
        "stats": get_manager().get_stats(),
    }


# ============================================================
# 媒体管理
# ============================================================

@router.post("/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    uploaded_by: str = Form(...),
    session_id: Optional[str] = Form(None),
) -> Dict[str, Any]:
    """上传图像

    Args:
        file: 图像文件
        uploaded_by: 上传者
        session_id: 关联 Session ID

    Returns:
        Dict[str, Any]: 上传结果
    """
    # 保存临时文件
    tmp_path = f"/tmp/hermes_upload_{os.getpid()}_{uploaded_by}.tmp"
    try:
        with open(tmp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        media = get_manager().upload_media(
            source_path=tmp_path,
            media_type=MediaType.IMAGE.value,
            uploaded_by=uploaded_by,
            session_id=session_id,
        )

        return {
            "success": True,
            "media": media.to_dict(),
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    finally:
        # 清理临时文件
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


@router.post("/upload/audio")
async def upload_audio(
    file: UploadFile = File(...),
    uploaded_by: str = Form(...),
    session_id: Optional[str] = Form(None),
) -> Dict[str, Any]:
    """上传音频

    Args:
        file: 音频文件
        uploaded_by: 上传者
        session_id: 关联 Session ID

    Returns:
        Dict[str, Any]: 上传结果
    """
    tmp_path = f"/tmp/hermes_upload_{os.getpid()}_{uploaded_by}.tmp"
    try:
        with open(tmp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        media = get_manager().upload_media(
            source_path=tmp_path,
            media_type=MediaType.AUDIO.value,
            uploaded_by=uploaded_by,
            session_id=session_id,
        )

        return {
            "success": True,
            "media": media.to_dict(),
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


@router.get("/media/{media_id}")
async def get_media(media_id: str) -> Dict[str, Any]:
    """获取媒体详情

    Args:
        media_id: 媒体 ID

    Returns:
        Dict[str, Any]: 媒体详情
    """
    media = get_manager().get_media(media_id)
    if not media:
        raise HTTPException(status_code=404, detail=f"Media not found: {media_id}")
    return {
        "success": True,
        "media": media.to_dict(),
    }


@router.get("/media")
async def list_media(
    type: Optional[str] = Query(None, description="媒体类型"),
    uploaded_by: Optional[str] = Query(None, description="上传者"),
    session_id: Optional[str] = Query(None, description="Session ID"),
    limit: int = Query(50, ge=1, le=500),
) -> Dict[str, Any]:
    """列出媒体

    Args:
        type: 媒体类型过滤
        uploaded_by: 上传者过滤
        session_id: Session 过滤
        limit: 最大数量

    Returns:
        Dict[str, Any]: 媒体列表
    """
    results = get_manager().list_media(
        media_type=type,
        uploaded_by=uploaded_by,
        session_id=session_id,
        limit=limit,
    )
    return {
        "success": True,
        "count": len(results),
        "media": [m.to_dict() for m in results],
    }


@router.delete("/media/{media_id}")
async def delete_media(
    media_id: str,
    uploaded_by: Optional[str] = Query(None, description="上传者校验"),
) -> Dict[str, Any]:
    """删除媒体

    Args:
        media_id: 媒体 ID
        uploaded_by: 上传者校验

    Returns:
        Dict[str, Any]: 删除结果
    """
    try:
        removed = get_manager().delete_media(media_id, uploaded_by=uploaded_by)
        return {
            "success": True,
            "removed": removed,
            "media_id": media_id,
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")


# ============================================================
# Vision 分析
# ============================================================

@router.post("/vision/analyze")
async def vision_analyze(req: VisionAnalyzeRequest) -> Dict[str, Any]:
    """执行 Vision 分析

    Args:
        req: 分析请求

    Returns:
        Dict[str, Any]: 分析结果
    """
    try:
        analysis = get_manager().analyze_vision(
            media_id=req.media_id,
            analysis_type=req.analysis_type,
        )
        return {
            "success": True,
            "analysis": analysis.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vision analysis failed: {e}")


@router.get("/vision/analyses")
async def list_vision_analyses(
    media_id: Optional[str] = Query(None, description="媒体 ID 过滤"),
    limit: int = Query(50, ge=1, le=500),
) -> Dict[str, Any]:
    """列出 Vision 分析结果

    Args:
        media_id: 媒体 ID 过滤
        limit: 最大数量

    Returns:
        Dict[str, Any]: 分析列表
    """
    results = get_manager().list_vision_analyses(media_id=media_id, limit=limit)
    return {
        "success": True,
        "count": len(results),
        "analyses": [a.to_dict() for a in results],
    }


# ============================================================
# Audio 分析
# ============================================================

@router.post("/audio/analyze")
async def audio_analyze(req: AudioAnalyzeRequest) -> Dict[str, Any]:
    """执行 Audio 分析

    Args:
        req: 分析请求

    Returns:
        Dict[str, Any]: 分析结果
    """
    try:
        analysis = get_manager().analyze_audio(
            media_id=req.media_id,
            language_hint=req.language_hint,
        )
        return {
            "success": True,
            "analysis": analysis.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio analysis failed: {e}")


@router.get("/audio/analyses")
async def list_audio_analyses(
    media_id: Optional[str] = Query(None, description="媒体 ID 过滤"),
    limit: int = Query(50, ge=1, le=500),
) -> Dict[str, Any]:
    """列出 Audio 分析结果

    Args:
        media_id: 媒体 ID 过滤
        limit: 最大数量

    Returns:
        Dict[str, Any]: 分析列表
    """
    results = get_manager().list_audio_analyses(media_id=media_id, limit=limit)
    return {
        "success": True,
        "count": len(results),
        "analyses": [a.to_dict() for a in results],
    }


# ============================================================
# 多模态消息
# ============================================================

@router.post("/chat/send")
async def chat_send(req: ChatSendRequest) -> Dict[str, Any]:
    """发送多模态消息

    Args:
        req: 发送请求

    Returns:
        Dict[str, Any]: 消息 + 回复
    """
    try:
        message = get_manager().send_message(
            session_id=req.session_id,
            text_content=req.text,
            media_ids=req.media_ids,
            uploaded_by=req.uploaded_by,
            metadata=req.metadata,
        )

        # 获取助手回复
        messages = get_manager().list_messages(req.session_id, limit=10)
        assistant_reply = None
        for m in messages:
            if m.role == "assistant" and m.metadata.get("reply_to") == message.message_id:
                assistant_reply = m.to_dict()
                break

        return {
            "success": True,
            "message": message.to_dict(),
            "reply": assistant_reply,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat send failed: {e}")


@router.get("/chat/messages/{session_id}")
async def list_messages(
    session_id: str,
    limit: int = Query(100, ge=1, le=500),
) -> Dict[str, Any]:
    """列出会话消息

    Args:
        session_id: 会话 ID
        limit: 最大数量

    Returns:
        Dict[str, Any]: 消息列表
    """
    results = get_manager().list_messages(session_id=session_id, limit=limit)
    return {
        "success": True,
        "count": len(results),
        "session_id": session_id,
        "messages": [m.to_dict() for m in results],
    }


@router.get("/chat/messages/{session_id}/{message_id}")
async def get_message(
    session_id: str,
    message_id: str,
) -> Dict[str, Any]:
    """获取单条消息

    Args:
        session_id: 会话 ID
        message_id: 消息 ID

    Returns:
        Dict[str, Any]: 消息详情
    """
    message = get_manager().get_message(message_id)
    if not message or message.session_id != session_id:
        raise HTTPException(status_code=404, detail=f"Message not found: {message_id}")
    return {
        "success": True,
        "message": message.to_dict(),
    }
