"""
# ============================================================
# Vibe Coding API (v1.0.0)
# Cycle 58 G58-01 补全：Cycle 59 G59-FIX 后端实现
# ============================================================
# 核心作用：提供 Vibe Coding 模式的 REST + SSE API
#           对应前端 useVibeCoding Hook
# 运行流程：
#   1. POST /api/vibe-coding/session - 创建 session
#   2. GET /api/vibe-coding/session/{id} - 查询 session
#   3. POST /api/vibe-coding/session/{id}/pause - 暂停
#   4. POST /api/vibe-coding/session/{id}/resume - 恢复
#   5. POST /api/vibe-coding/session/{id}/cancel - 取消
#   6. GET /api/vibe-coding/session/{id}/events - SSE 事件流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 59 G59-FIX 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
import uuid
from collections import deque
from datetime import datetime
from enum import Enum
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vibe-coding", tags=["vibe-coding"])


# ============================================================
# 枚举与模型
# ============================================================


class VibeState(str, Enum):
    IDLE = "idle"
    CLARIFYING = "clarifying"
    PLANNING = "planning"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    DONE = "done"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    ERROR = "error"


class VibeStepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class VibeStep(BaseModel):
    id: str
    name: str
    status: VibeStepStatus = VibeStepStatus.PENDING
    startedAt: Optional[str] = None
    completedAt: Optional[str] = None
    output: Optional[str] = None
    error: Optional[str] = None
    retryCount: int = 0


class VibeSession(BaseModel):
    id: str
    prompt: str
    model: str
    createdAt: str
    updatedAt: str
    state: VibeState
    planId: Optional[str] = None
    steps: List[VibeStep] = Field(default_factory=list)
    metrics: Dict[str, int] = Field(default_factory=lambda: {"tokens": 0, "duration": 0, "filesChanged": 0})


# ============================================================
# Session 注册表
# ============================================================


class VibeSessionRegistry:
    """VibeSession 注册表（内存存储，单实例）"""

    def __init__(self) -> None:
        self._sessions: Dict[str, VibeSession] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def create(self, prompt: str, model: str) -> VibeSession:
        async with self._lock:
            sid = f"vibe-{uuid.uuid4().hex[:16]}"
            now = datetime.utcnow().isoformat() + "Z"
            # 初始步骤
            initial_steps = [
                VibeStep(id=f"step-{i+1}", name=name, status=VibeStepStatus.PENDING)
                for i, name in enumerate([
                    "澄清需求",
                    "生成 Plan",
                    "执行步骤",
                    "质量评审",
                ])
            ]
            session = VibeSession(
                id=sid,
                prompt=prompt,
                model=model,
                createdAt=now,
                updatedAt=now,
                state=VibeState.CLARIFYING,
                steps=initial_steps,
            )
            self._sessions[sid] = session
            self._subscribers[sid] = []
            # 异步启动状态机模拟
            asyncio.create_task(self._run_state_machine(sid))
            return session

    async def get(self, session_id: str) -> Optional[VibeSession]:
        return self._sessions.get(session_id)

    async def list_all(self) -> List[VibeSession]:
        return list(self._sessions.values())

    async def update_state(self, session_id: str, new_state: VibeState) -> bool:
        if session_id not in self._sessions:
            return False
        self._sessions[session_id].state = new_state
        self._sessions[session_id].updatedAt = datetime.utcnow().isoformat() + "Z"
        await self._broadcast(session_id, {
            "type": "vibe_state_changed",
            "state": new_state.value,
            "timestamp": time.time(),
        })
        return True

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        if session_id not in self._subscribers:
            self._subscribers[session_id] = []
        self._subscribers[session_id].append(q)
        return q

    async def unsubscribe(self, session_id: str, q: asyncio.Queue) -> None:
        if session_id in self._subscribers:
            try:
                self._subscribers[session_id].remove(q)
            except ValueError:
                pass

    async def _broadcast(self, session_id: str, event: Dict[str, Any]) -> None:
        for q in self._subscribers.get(session_id, []):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(f"vibe-coding: subscriber queue full session={session_id}")

    async def _run_state_machine(self, session_id: str) -> None:
        """异步状态机模拟：clarifying → planning → executing → reviewing → done"""
        try:
            await asyncio.sleep(1.0)
            await self.update_state(session_id, VibeState.PLANNING)
            await self._broadcast_step(session_id, 0, VibeStepStatus.COMPLETED, started=True)

            await asyncio.sleep(1.0)
            await self.update_state(session_id, VibeState.EXECUTING)
            await self._broadcast_step(session_id, 1, VibeStepStatus.COMPLETED, started=True)

            await asyncio.sleep(1.0)
            await self._broadcast_step(session_id, 2, VibeStepStatus.RUNNING, started=True)

            # 等待（外部可通过 pause/cancel 干预）
            for _ in range(5):
                if self._sessions.get(session_id, VibeSession(
                    id="", prompt="", model="", createdAt="", updatedAt="", state=VibeState.DONE
                )).state in (VibeState.PAUSED, VibeState.CANCELLED, VibeState.ERROR):
                    return
                await asyncio.sleep(0.5)

            await self._broadcast_step(session_id, 2, VibeStepStatus.COMPLETED)
            await self.update_state(session_id, VibeState.REVIEWING)
            await self._broadcast_step(session_id, 3, VibeStepStatus.RUNNING, started=True)

            await asyncio.sleep(1.0)
            await self._broadcast_step(session_id, 3, VibeStepStatus.COMPLETED)
            await self.update_state(session_id, VibeState.DONE)
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"vibe-coding: state machine error session={session_id} err={exc}")
            await self.update_state(session_id, VibeState.ERROR)

    async def _broadcast_step(self, session_id: str, step_idx: int, status: VibeStepStatus, started: bool = False) -> None:
        s = self._sessions.get(session_id)
        if not s:
            return
        if step_idx < 0 or step_idx >= len(s.steps):
            return
        step = s.steps[step_idx]
        step.status = status
        if started and not step.startedAt:
            step.startedAt = datetime.utcnow().isoformat() + "Z"
        if status in (VibeStepStatus.COMPLETED, VibeStepStatus.FAILED, VibeStepStatus.SKIPPED):
            step.completedAt = datetime.utcnow().isoformat() + "Z"
        s.updatedAt = datetime.utcnow().isoformat() + "Z"
        event_type = (
            "vibe_step_started" if started and status == VibeStepStatus.RUNNING
            else "vibe_step_completed" if status == VibeStepStatus.COMPLETED
            else "vibe_step_failed" if status == VibeStepStatus.FAILED
            else "vibe_step_skipped"
        )
        await self._broadcast(session_id, {
            "type": event_type,
            "step": step.model_dump(),
            "timestamp": time.time(),
        })


# 全局单例
_registry: Optional[VibeSessionRegistry] = None


def get_registry() -> VibeSessionRegistry:
    global _registry
    if _registry is None:
        _registry = VibeSessionRegistry()
    return _registry


# ============================================================
# 请求/响应模型
# ============================================================


class CreateSessionRequest(BaseModel):
    prompt: str
    model: str = "claude-sonnet-4-20250514"


class CreateSessionResponse(BaseModel):
    session: VibeSession


class GetSessionResponse(BaseModel):
    session: VibeSession


class StateResponse(BaseModel):
    success: bool
    session_id: str
    state: str
    message: Optional[str] = None


# ============================================================
# API 端点
# ============================================================


@router.post("/session", response_model=CreateSessionResponse)
async def create_session(req: CreateSessionRequest):
    """创建 Vibe Coding session"""
    if not req.prompt or not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    if len(req.prompt) > 10000:
        raise HTTPException(status_code=400, detail="prompt 长度不能超过 10000 字符")
    session = await get_registry().create(prompt=req.prompt, model=req.model)
    return CreateSessionResponse(session=session)


@router.get("/session", response_model=GetSessionResponse)
async def list_sessions():
    """列出所有 sessions（最新在前）"""
    sessions = await get_registry().list_all()
    if not sessions:
        raise HTTPException(status_code=404, detail="没有 sessions")
    # 取最新一个
    sessions_sorted = sorted(sessions, key=lambda s: s.createdAt, reverse=True)
    return GetSessionResponse(session=sessions_sorted[0])


@router.get("/session/{session_id}", response_model=GetSessionResponse)
async def get_session(session_id: str):
    """获取 session 详情"""
    session = await get_registry().get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} 不存在")
    return GetSessionResponse(session=session)


@router.post("/session/{session_id}/pause", response_model=StateResponse)
async def pause_session(session_id: str):
    """暂停 session"""
    session = await get_registry().get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} 不存在")
    await get_registry().update_state(session_id, VibeState.PAUSED)
    return StateResponse(success=True, session_id=session_id, state=VibeState.PAUSED.value, message="已暂停")


@router.post("/session/{session_id}/resume", response_model=StateResponse)
async def resume_session(session_id: str):
    """恢复 session"""
    session = await get_registry().get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} 不存在")
    if session.state != VibeState.PAUSED:
        raise HTTPException(status_code=409, detail=f"Session 状态不允许恢复: {session.state.value}")
    await get_registry().update_state(session_id, VibeState.EXECUTING)
    return StateResponse(success=True, session_id=session_id, state=VibeState.EXECUTING.value, message="已恢复")


@router.post("/session/{session_id}/cancel", response_model=StateResponse)
async def cancel_session(session_id: str):
    """取消 session"""
    session = await get_registry().get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} 不存在")
    await get_registry().update_state(session_id, VibeState.CANCELLED)
    return StateResponse(success=True, session_id=session_id, state=VibeState.CANCELLED.value, message="已取消")


@router.get("/session/{session_id}/events")
async def session_events(session_id: str):
    """SSE 事件流"""
    session = await get_registry().get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} 不存在")

    async def event_generator():
        q = await get_registry().subscribe(session_id)
        # 初始事件
        yield f"event: vibe_session_started\ndata: {json.dumps(session.model_dump(), ensure_ascii=False)}\n\n"
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                    if event.get("state") in ("done", "cancelled", "error") or event.get("type") == "vibe_step_completed":
                        # 终态继续等待（不立即断开）
                        pass
                except asyncio.TimeoutError:
                    # 心跳
                    yield f"event: heartbeat\ndata: {json.dumps({'timestamp': time.time()})}\n\n"
        except asyncio.CancelledError:
            logger.info(f"vibe-coding events: client disconnected session={session_id}")
            await get_registry().unsubscribe(session_id, q)
            raise

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
