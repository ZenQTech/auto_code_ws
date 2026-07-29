"""
# TRAE Work - REST API
# ============================================================
# 核心作用：暴露 TRAE Work 4 大子系统的 HTTP 接口
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 端点清单（28 个）：
#   Design Mode (9):
#     - GET  /work/design/health
#     - GET  /work/design/stats
#     - POST /work/design/drafts
#     - GET  /work/design/drafts
#     - GET  /work/design/drafts/{draft_id}
#     - PUT  /work/design/drafts/{draft_id}
#     - DELETE /work/design/drafts/{draft_id}
#     - POST /work/design/drafts/{draft_id}/nl-edit
#     - POST /work/design/drafts/{draft_id}/export
#
#   Design System (5):
#     - POST   /work/design/systems
#     - GET    /work/design/systems
#     - GET    /work/design/systems/{system_id}
#     - PUT    /work/design/systems/{system_id}
#     - DELETE /work/design/systems/{system_id}
#
#   Voice Chat (5):
#     - GET  /work/voice/health
#     - POST /work/voice/sessions
#     - GET  /work/voice/sessions
#     - GET  /work/voice/sessions/{session_id}
#     - POST /work/voice/sessions/{session_id}/messages
#     - GET  /work/voice/sessions/{session_id}/context
#     - POST /work/voice/web-search
#     - POST /work/voice/transcribe
#     - POST /work/voice/synthesize
#
#   Global Memory (8):
#     - GET    /work/memory/health
#     - POST   /work/memory/entries
#     - GET    /work/memory/entries
#     - GET    /work/memory/entries/{entry_id}
#     - PUT    /work/memory/entries/{entry_id}
#     - DELETE /work/memory/entries/{entry_id}
#     - POST   /work/memory/search
#     - GET    /work/memory/projects
#     - GET    /work/memory/stats
#
#   Video (8):
#     - GET  /work/video/health
#     - POST /work/video/upload
#     - GET  /work/video/videos
#     - GET  /work/video/videos/{video_id}
#     - DELETE /work/video/videos/{video_id}
#     - POST /work/video/videos/{video_id}/extract-frames
#     - POST /work/video/videos/{video_id}/summarize
#     - POST /work/video/generate
#     - GET  /work/video/generations
#     - GET  /work/video/stats
# ============================================================
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .manager import get_work_manager


router = APIRouter(prefix="/work", tags=["trae-work"])


# ============================================================
# Pydantic 模型
# ============================================================


class DesignDraftCreate(BaseModel):
    """创建草图请求"""
    name: str
    template: str = "web"
    description: str = ""
    owner: str = "default_user"
    style: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None


class DesignDraftUpdate(BaseModel):
    """更新草图请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    style: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None


class NLEditRequest(BaseModel):
    """NL 编辑请求"""
    instruction: str = Field(..., min_length=1, max_length=500)


class DesignExportRequest(BaseModel):
    """设计导出请求"""
    format: str = "html"


class DesignSystemCreate(BaseModel):
    """创建设计系统请求"""
    name: str
    colors: Optional[Dict[str, str]] = None
    typography: Optional[Dict[str, Any]] = None
    spacing: Optional[Dict[str, int]] = None
    components: Optional[Dict[str, Any]] = None
    owner: str = "default_user"


class DesignSystemUpdate(BaseModel):
    """更新设计系统请求"""
    colors: Optional[Dict[str, str]] = None
    typography: Optional[Dict[str, Any]] = None
    spacing: Optional[Dict[str, int]] = None
    components: Optional[Dict[str, Any]] = None


class VoiceSessionCreate(BaseModel):
    """创建语音会话请求"""
    user_id: str = "default_user"
    project_id: str
    initial_message: Optional[str] = None


class VoiceMessageRequest(BaseModel):
    """发送语音消息请求"""
    text: str = Field(..., min_length=1, max_length=4000)
    audio_id: Optional[str] = None
    use_context: bool = True
    use_web_search: bool = False
    web_search_query: Optional[str] = None


class WebSearchRequest(BaseModel):
    """Web 搜索请求"""
    query: str = Field(..., min_length=1, max_length=500)
    max_results: int = Field(default=5, ge=1, le=20)
    sources: Optional[List[str]] = None


class TranscribeRequest(BaseModel):
    """STT 请求"""
    audio_id: str
    text_hint: Optional[str] = None


class SynthesizeRequest(BaseModel):
    """TTS 请求"""
    text: str = Field(..., min_length=1, max_length=2000)


class KnowledgeEntryCreate(BaseModel):
    """创建知识条目请求"""
    project_id: str
    category: str
    content: str = Field(..., min_length=1, max_length=16384)
    tags: Optional[List[str]] = None
    source: str = "user"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metadata: Optional[Dict[str, Any]] = None


class KnowledgeEntryUpdate(BaseModel):
    """更新知识条目请求"""
    content: Optional[str] = Field(default=None, max_length=16384)
    tags: Optional[List[str]] = None
    category: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    status: Optional[str] = None


class MemorySearchRequest(BaseModel):
    """记忆检索请求"""
    project_id: str
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=5, ge=1, le=50)
    categories: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    min_relevance: float = Field(default=0.0, ge=0.0, le=1.0)


class VideoUploadRequest(BaseModel):
    """视频上传请求"""
    file_path: str
    file_size: int = Field(..., gt=0, le=100 * 1024 * 1024)
    uploaded_by: str = "default_user"
    title: str = ""
    description: str = ""


class VideoExtractFramesRequest(BaseModel):
    """提取关键帧请求"""
    frame_count: int = Field(default=5, ge=1, le=20)


class VideoSummarizeRequest(BaseModel):
    """视频摘要请求"""
    frame_count: int = Field(default=5, ge=1, le=20)
    include_transcript: bool = True


class VideoGenerateRequest(BaseModel):
    """视频生成请求"""
    prompt: str = Field(..., min_length=1, max_length=2000)
    duration: float = Field(default=5.0, gt=0, le=60.0)
    resolution: str = "1280x720"
    style: str = "realistic"
    owner: str = "default_user"


# ============================================================
# Design Mode 端点
# ============================================================


@router.get("/design/health")
async def design_health() -> Dict[str, Any]:
    """Design Mode 健康检查"""
    return {
        "status": "ok",
        "module": "design",
        "stats": get_work_manager().design.get_stats(),
    }


@router.get("/design/stats")
async def design_stats() -> Dict[str, Any]:
    """Design Mode 统计"""
    return {"success": True, "stats": get_work_manager().design.get_stats()}


@router.post("/design/drafts")
async def design_create_draft(req: DesignDraftCreate) -> Dict[str, Any]:
    """创建设计草图"""
    try:
        draft = get_work_manager().design.create_draft(
            name=req.name,
            template=req.template,
            description=req.description,
            owner=req.owner,
            style=req.style,
            tags=req.tags,
        )
        get_work_manager().save_index("design.draft_created", draft.to_dict())
        return {"success": True, "draft": draft.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/design/drafts")
async def design_list_drafts(
    owner: Optional[str] = Query(None),
    template: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> Dict[str, Any]:
    """列出设计草图"""
    drafts = get_work_manager().design.list_drafts(
        owner=owner, template=template, limit=limit
    )
    return {
        "success": True,
        "count": len(drafts),
        "drafts": [d.to_dict() for d in drafts],
    }


@router.get("/design/drafts/{draft_id}")
async def design_get_draft(draft_id: str) -> Dict[str, Any]:
    """获取设计草图"""
    draft = get_work_manager().design.get_draft(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
    return {"success": True, "draft": draft.to_dict()}


@router.put("/design/drafts/{draft_id}")
async def design_update_draft(
    draft_id: str, req: DesignDraftUpdate
) -> Dict[str, Any]:
    """更新设计草图"""
    draft = get_work_manager().design.update_draft(
        draft_id,
        name=req.name,
        description=req.description,
        style=req.style,
        tags=req.tags,
    )
    if not draft:
        raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
    return {"success": True, "draft": draft.to_dict()}


@router.delete("/design/drafts/{draft_id}")
async def design_delete_draft(draft_id: str) -> Dict[str, Any]:
    """删除设计草图"""
    removed = get_work_manager().design.delete_draft(draft_id)
    return {"success": True, "removed": removed, "draft_id": draft_id}


@router.post("/design/drafts/{draft_id}/nl-edit")
async def design_nl_edit(
    draft_id: str, req: NLEditRequest
) -> Dict[str, Any]:
    """自然语言编辑"""
    draft, changes = get_work_manager().design.apply_nl_edit(
        draft_id, req.instruction
    )
    if not draft:
        raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
    return {
        "success": True,
        "draft": draft.to_dict(),
        "applied_changes": [c.to_dict() for c in changes],
    }


@router.post("/design/drafts/{draft_id}/export")
async def design_export(
    draft_id: str, req: DesignExportRequest
) -> Dict[str, Any]:
    """导出代码"""
    try:
        result = get_work_manager().design.export_code(
            draft_id, export_format=req.format
        )
        if not result:
            raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# Design System 端点
# ============================================================


@router.post("/design/systems")
async def design_create_system(req: DesignSystemCreate) -> Dict[str, Any]:
    """创建设计系统"""
    system = get_work_manager().design.create_system(
        name=req.name,
        colors=req.colors,
        typography=req.typography,
        spacing=req.spacing,
        components=req.components,
        owner=req.owner,
    )
    return {"success": True, "system": system.to_dict()}


@router.get("/design/systems")
async def design_list_systems(
    owner: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """列出设计系统"""
    systems = get_work_manager().design.list_systems(owner=owner)
    return {
        "success": True,
        "count": len(systems),
        "systems": [s.to_dict() for s in systems],
    }


@router.get("/design/systems/{system_id}")
async def design_get_system(system_id: str) -> Dict[str, Any]:
    """获取设计系统"""
    system = get_work_manager().design.get_system(system_id)
    if not system:
        raise HTTPException(status_code=404, detail=f"System not found: {system_id}")
    return {"success": True, "system": system.to_dict()}


@router.put("/design/systems/{system_id}")
async def design_update_system(
    system_id: str, req: DesignSystemUpdate
) -> Dict[str, Any]:
    """更新设计系统"""
    system = get_work_manager().design.update_system(
        system_id,
        colors=req.colors,
        typography=req.typography,
        spacing=req.spacing,
        components=req.components,
    )
    if not system:
        raise HTTPException(status_code=404, detail=f"System not found: {system_id}")
    return {"success": True, "system": system.to_dict()}


@router.delete("/design/systems/{system_id}")
async def design_delete_system(system_id: str) -> Dict[str, Any]:
    """删除设计系统"""
    removed = get_work_manager().design.delete_system(system_id)
    return {"success": True, "removed": removed, "system_id": system_id}


# ============================================================
# Voice Chat 端点
# ============================================================


@router.get("/voice/health")
async def voice_health() -> Dict[str, Any]:
    """Voice Chat 健康检查"""
    return {
        "status": "ok",
        "module": "voice",
        "stats": get_work_manager().voice.get_stats(),
    }


@router.post("/voice/sessions")
async def voice_create_session(req: VoiceSessionCreate) -> Dict[str, Any]:
    """创建语音会话"""
    session = get_work_manager().voice.create_session(
        user_id=req.user_id,
        project_id=req.project_id,
        initial_message=req.initial_message,
    )
    get_work_manager().save_index(
        "voice.session_created",
        {"session_id": session.session_id, "project_id": session.project_id},
    )
    return {"success": True, "session": session.to_dict()}


@router.get("/voice/sessions")
async def voice_list_sessions(
    user_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> Dict[str, Any]:
    """列出语音会话"""
    sessions = get_work_manager().voice.list_sessions(
        user_id=user_id, project_id=project_id, limit=limit
    )
    return {
        "success": True,
        "count": len(sessions),
        "sessions": [s.to_dict() for s in sessions],
    }


@router.get("/voice/sessions/{session_id}")
async def voice_get_session(session_id: str) -> Dict[str, Any]:
    """获取语音会话"""
    session = get_work_manager().voice.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return {"success": True, "session": session.to_dict()}


@router.delete("/voice/sessions/{session_id}")
async def voice_close_session(session_id: str) -> Dict[str, Any]:
    """关闭语音会话"""
    closed = get_work_manager().voice.close_session(session_id)
    return {"success": True, "closed": closed, "session_id": session_id}


@router.post("/voice/sessions/{session_id}/messages")
async def voice_send_message(
    session_id: str, req: VoiceMessageRequest
) -> Dict[str, Any]:
    """发送语音消息"""
    try:
        result = get_work_manager().voice.send_message(
            session_id=session_id,
            text=req.text,
            audio_id=req.audio_id,
            use_context=req.use_context,
            use_web_search=req.use_web_search,
            web_search_query=req.web_search_query,
        )
        get_work_manager().save_index(
            "voice.message_sent",
            {
                "session_id": session_id,
                "text_preview": req.text[:100],
                "context_refs": result.get("context_refs", []),
            },
        )
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/voice/sessions/{session_id}/context")
async def voice_get_context(
    session_id: str,
    query: Optional[str] = Query(None),
    max_refs: int = Query(5, ge=1, le=20),
) -> Dict[str, Any]:
    """获取会话上下文"""
    try:
        result = get_work_manager().voice.get_context(
            session_id=session_id, query=query, max_refs=max_refs
        )
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/voice/web-search")
async def voice_web_search(req: WebSearchRequest) -> Dict[str, Any]:
    """Web 搜索"""
    results = get_work_manager().voice.web_search(
        query=req.query, max_results=req.max_results, sources=req.sources
    )
    return {"success": True, "count": len(results), "results": results}


@router.post("/voice/transcribe")
async def voice_transcribe(req: TranscribeRequest) -> Dict[str, Any]:
    """语音转文本"""
    result = get_work_manager().voice.transcribe(
        audio_id=req.audio_id, text_hint=req.text_hint
    )
    return {"success": True, **result}


@router.post("/voice/synthesize")
async def voice_synthesize(req: SynthesizeRequest) -> Dict[str, Any]:
    """文本转语音"""
    result = get_work_manager().voice.synthesize(req.text)
    return {"success": True, **result}


# ============================================================
# Global Memory 端点
# ============================================================


@router.get("/memory/health")
async def memory_health() -> Dict[str, Any]:
    """Global Memory 健康检查"""
    return {
        "status": "ok",
        "module": "memory",
        "stats": get_work_manager().memory.get_stats(),
    }


@router.post("/memory/entries")
async def memory_create_entry(req: KnowledgeEntryCreate) -> Dict[str, Any]:
    """创建知识条目"""
    try:
        entry = get_work_manager().memory.create_entry(
            project_id=req.project_id,
            category=req.category,
            content=req.content,
            tags=req.tags,
            source=req.source,
            confidence=req.confidence,
            metadata=req.metadata,
        )
        get_work_manager().save_index(
            "memory.entry_created",
            {
                "entry_id": entry.entry_id,
                "project_id": entry.project_id,
                "category": entry.category,
            },
        )
        return {"success": True, "entry": entry.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/memory/entries")
async def memory_list_entries(
    project_id: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    tags: Optional[str] = Query(None, description="逗号分隔的标签列表"),
    status: str = Query("active"),
    limit: int = Query(50, ge=1, le=500),
) -> Dict[str, Any]:
    """列出知识条目"""
    tag_list = [t.strip() for t in tags.split(",")] if tags else None
    entries = get_work_manager().memory.list_entries(
        project_id=project_id,
        category=category,
        tags=tag_list,
        status=status,
        limit=limit,
    )
    return {
        "success": True,
        "count": len(entries),
        "entries": [e.to_dict() for e in entries],
    }


@router.get("/memory/entries/{entry_id}")
async def memory_get_entry(entry_id: str) -> Dict[str, Any]:
    """获取知识条目"""
    entry = get_work_manager().memory.get_entry(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Entry not found: {entry_id}")
    return {"success": True, "entry": entry.to_dict()}


@router.put("/memory/entries/{entry_id}")
async def memory_update_entry(
    entry_id: str, req: KnowledgeEntryUpdate
) -> Dict[str, Any]:
    """更新知识条目"""
    try:
        entry = get_work_manager().memory.update_entry(
            entry_id,
            content=req.content,
            tags=req.tags,
            category=req.category,
            confidence=req.confidence,
            status=req.status,
        )
        if not entry:
            raise HTTPException(status_code=404, detail=f"Entry not found: {entry_id}")
        return {"success": True, "entry": entry.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/memory/entries/{entry_id}")
async def memory_delete_entry(entry_id: str) -> Dict[str, Any]:
    """删除知识条目"""
    removed = get_work_manager().memory.delete_entry(entry_id)
    return {"success": True, "removed": removed, "entry_id": entry_id}


@router.post("/memory/search")
async def memory_search(req: MemorySearchRequest) -> Dict[str, Any]:
    """检索知识条目"""
    entries = get_work_manager().memory.search(
        project_id=req.project_id,
        query=req.query,
        top_k=req.top_k,
        categories=req.categories,
        tags=req.tags,
        min_relevance=req.min_relevance,
    )
    return {
        "success": True,
        "count": len(entries),
        "query": req.query,
        "project_id": req.project_id,
        "results": [e.to_dict() for e in entries],
    }


@router.get("/memory/projects")
async def memory_list_projects() -> Dict[str, Any]:
    """列出所有项目"""
    projects = get_work_manager().memory.list_projects()
    return {"success": True, "count": len(projects), "projects": projects}


@router.get("/memory/stats")
async def memory_stats(project_id: Optional[str] = Query(None)) -> Dict[str, Any]:
    """获取统计"""
    stats = get_work_manager().memory.get_stats(project_id=project_id)
    return {"success": True, "stats": stats}


# ============================================================
# Video 端点
# ============================================================


@router.get("/video/health")
async def video_health() -> Dict[str, Any]:
    """Video 健康检查"""
    return {
        "status": "ok",
        "module": "video",
        "stats": get_work_manager().video.get_stats(),
    }


@router.post("/video/upload")
async def video_upload(req: VideoUploadRequest) -> Dict[str, Any]:
    """上传视频"""
    try:
        meta = get_work_manager().video.upload_video(
            file_path=req.file_path,
            file_size=req.file_size,
            uploaded_by=req.uploaded_by,
            title=req.title,
            description=req.description,
        )
        get_work_manager().save_index(
            "video.uploaded",
            {"video_id": meta.video_id, "duration": meta.duration},
        )
        return {"success": True, "video": meta.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/video/videos")
async def video_list_videos(
    uploaded_by: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> Dict[str, Any]:
    """列出视频"""
    videos = get_work_manager().video.list_videos(
        uploaded_by=uploaded_by, limit=limit
    )
    return {
        "success": True,
        "count": len(videos),
        "videos": [v.to_dict() for v in videos],
    }


@router.get("/video/videos/{video_id}")
async def video_get(video_id: str) -> Dict[str, Any]:
    """获取视频元数据"""
    video = get_work_manager().video.get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")
    return {"success": True, "video": video.to_dict()}


@router.delete("/video/videos/{video_id}")
async def video_delete(video_id: str) -> Dict[str, Any]:
    """删除视频"""
    removed = get_work_manager().video.delete_video(video_id)
    return {"success": True, "removed": removed, "video_id": video_id}


@router.post("/video/videos/{video_id}/extract-frames")
async def video_extract_frames(
    video_id: str, req: VideoExtractFramesRequest
) -> Dict[str, Any]:
    """提取关键帧"""
    try:
        frames = get_work_manager().video.extract_keyframes(
            video_id, frame_count=req.frame_count
        )
        return {
            "success": True,
            "count": len(frames),
            "frames": [f.to_dict() for f in frames],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/video/videos/{video_id}/summarize")
async def video_summarize(
    video_id: str, req: VideoSummarizeRequest
) -> Dict[str, Any]:
    """生成视频摘要"""
    try:
        summary = get_work_manager().video.summarize(
            video_id,
            frame_count=req.frame_count,
            include_transcript=req.include_transcript,
        )
        get_work_manager().save_index(
            "video.summary_created",
            {"summary_id": summary.summary_id, "video_id": video_id},
        )
        return {"success": True, "summary": summary.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/video/generate")
async def video_generate(req: VideoGenerateRequest) -> Dict[str, Any]:
    """生成视频（Mock）"""
    try:
        gen = get_work_manager().video.generate_video(
            prompt=req.prompt,
            duration=req.duration,
            resolution=req.resolution,
            style=req.style,
            owner=req.owner,
        )
        get_work_manager().save_index(
            "video.generated",
            {"gen_id": gen.gen_id, "status": gen.status, "duration": gen.duration},
        )
        return {"success": True, "generation": gen.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/video/generations")
async def video_list_generations(
    owner: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> Dict[str, Any]:
    """列出生成任务"""
    gens = get_work_manager().video.list_generations(owner=owner, limit=limit)
    return {
        "success": True,
        "count": len(gens),
        "generations": [g.to_dict() for g in gens],
    }


@router.get("/video/stats")
async def video_stats() -> Dict[str, Any]:
    """Video 统计"""
    return {"success": True, "stats": get_work_manager().video.get_stats()}


# ============================================================
# 全局统计
# ============================================================


@router.get("/stats")
async def work_stats() -> Dict[str, Any]:
    """TRAE Work 全局统计"""
    return {"success": True, "stats": get_work_manager().get_stats()}


@router.get("/health")
async def work_health() -> Dict[str, Any]:
    """TRAE Work 全局健康检查"""
    return get_work_manager().health()
