"""
# ============================================================
# 思考流 REST API (v1.0.0)
# Cycle 67 G67-01
# ====================================
# 核心作用：暴露 ThinkingStreamService 为 REST API
# 端点：
#   GET    /api/thinking/{session_id}              获取 session 全部 step
#   GET    /api/thinking/{session_id}/current      获取当前 running step
#   DELETE /api/thinking/{session_id}              清空 session step 历史
#   GET    /api/thinking/{session_id}/export       导出为 JSON / Markdown
#   GET    /api/thinking/{session_id}/stats        统计信息
# 输入参数：session_id, format
# 输出结果：JSON 响应
# 对标：Codex PR #6006 reasoning stream
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 67 G67-01 初次创建
# ====================================
"""

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..services.thinking_stream import (
    ThinkingStep,
    get_thinking_stream_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/thinking", tags=["thinking"])


# ============================================================
# 请求/响应模型
# ============================================================


class ThinkingStepResponse(BaseModel):
    """单条 step 响应"""
    step_id: str
    session_id: str
    agent_id: str
    step_index: int
    content: str
    started_at: float
    ended_at: Optional[float] = None
    status: str
    summary: str = ""
    model: str = ""
    tokens: int = 0
    duration_ms: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ThinkingListResponse(BaseModel):
    """step 列表响应"""
    success: bool = True
    session_id: str
    total: int
    steps: List[ThinkingStepResponse]


class ThinkingCurrentResponse(BaseModel):
    """当前 step 响应"""
    success: bool = True
    session_id: str
    step: Optional[ThinkingStepResponse] = None


class ThinkingStatsResponse(BaseModel):
    """统计信息响应"""
    success: bool = True
    session_id: str
    total_steps: int
    total_tokens: int
    running_steps: int
    completed_steps: int
    truncated_steps: int
    total_duration_ms: int


# ============================================================
# 辅助函数
# ============================================================


def _step_to_response(step: ThinkingStep) -> ThinkingStepResponse:
    """ThinkingStep → Response"""
    duration_ms = 0
    if step.ended_at:
        duration_ms = int((step.ended_at - step.started_at) * 1000)
    elif step.status == "running":
        import time
        duration_ms = int((time.time() - step.started_at) * 1000)
    return ThinkingStepResponse(
        step_id=step.step_id,
        session_id=step.session_id,
        agent_id=step.agent_id,
        step_index=step.step_index,
        content=step.content,
        started_at=step.started_at,
        ended_at=step.ended_at,
        status=step.status,
        summary=step.summary,
        model=step.model,
        tokens=step.tokens,
        duration_ms=duration_ms,
        metadata=step.metadata,
    )


# ============================================================
# 端点
# ============================================================


@router.get("/{session_id}", response_model=ThinkingListResponse)
async def list_thinking_steps(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=200),
) -> ThinkingListResponse:
    """
    获取 session 的思考 step 列表（最新的在前）
    """
    service = get_thinking_stream_service()
    steps = service.get_session_steps(session_id, limit=limit, reverse=True)
    return ThinkingListResponse(
        session_id=session_id,
        total=service.count_session_steps(session_id),
        steps=[_step_to_response(s) for s in steps],
    )


@router.get("/{session_id}/current", response_model=ThinkingCurrentResponse)
async def get_current_thinking_step(session_id: str) -> ThinkingCurrentResponse:
    """获取 session 当前正在运行的 step"""
    service = get_thinking_stream_service()
    current = service.get_current_step(session_id)
    return ThinkingCurrentResponse(
        session_id=session_id,
        step=_step_to_response(current) if current else None,
    )


@router.get("/{session_id}/stats", response_model=ThinkingStatsResponse)
async def get_thinking_stats(session_id: str) -> ThinkingStatsResponse:
    """获取 session 思考统计信息"""
    service = get_thinking_stream_service()
    steps = service.get_session_steps(session_id, limit=200, reverse=False)
    total_tokens = sum(s.tokens for s in steps)
    total_duration = 0
    running = completed = truncated = 0
    for s in steps:
        if s.status == "running":
            running += 1
        elif s.status == "completed":
            completed += 1
        elif s.status == "truncated":
            truncated += 1
        if s.ended_at:
            total_duration += int((s.ended_at - s.started_at) * 1000)
    return ThinkingStatsResponse(
        session_id=session_id,
        total_steps=len(steps),
        total_tokens=total_tokens,
        running_steps=running,
        completed_steps=completed,
        truncated_steps=truncated,
        total_duration_ms=total_duration,
    )


@router.get("/{session_id}/export")
async def export_thinking(
    session_id: str,
    format: str = Query(default="json", pattern="^(json|markdown)$"),
) -> JSONResponse:
    """
    导出 session 思考记录
    format: json | markdown
    """
    service = get_thinking_stream_service()
    steps = service.get_session_steps(session_id, limit=200, reverse=False)

    if format == "json":
        data = {
            "session_id": session_id,
            "exported_at": __import__("time").time(),
            "total": len(steps),
            "steps": [_step_to_response(s).model_dump() for s in steps],
        }
        return JSONResponse(
            content=data,
            headers={
                "Content-Disposition": (
                    f'attachment; filename="thinking_{session_id}.json"'
                )
            },
        )

    # markdown
    lines = [f"# Thinking Stream: {session_id}\n"]
    for s in steps:
        lines.append(f"## Step {s.step_index + 1} ({s.status})")
        lines.append(f"- started: {s.started_at}")
        if s.ended_at:
            lines.append(f"- ended: {s.ended_at}")
        lines.append(f"- tokens: {s.tokens}")
        if s.model:
            lines.append(f"- model: {s.model}")
        if s.summary:
            lines.append(f"- summary: {s.summary}")
        lines.append("")
        lines.append("```")
        lines.append(s.content)
        lines.append("```")
        lines.append("")
    md = "\n".join(lines)
    return JSONResponse(
        content={"session_id": session_id, "format": "markdown", "content": md},
        headers={
            "Content-Disposition": (
                f'attachment; filename="thinking_{session_id}.md"'
            )
        },
    )


@router.delete("/{session_id}")
async def clear_thinking(session_id: str) -> Dict[str, Any]:
    """清空 session 全部思考记录"""
    service = get_thinking_stream_service()
    cleared = service.clear_session(session_id)
    return {
        "success": True,
        "session_id": session_id,
        "cleared": cleared,
        "message": f"已清空 {cleared} 个 step",
    }
