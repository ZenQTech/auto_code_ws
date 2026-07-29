"""
# ============================================================
# Hermes Python/TypeScript SDK - REST API
# ============================================================
# 核心作用：为 Hermes Python/TypeScript SDK 提供后端 API
# 端点：
#   - GET  /api/sdk/health                   健康检查
#   - POST /api/sdk/threads                  启动 Thread
#   - GET  /api/sdk/threads                  列出 Thread
#   - GET  /api/sdk/threads/{id}             获取 Thread 状态
#   - DELETE /api/sdk/threads/{id}           关闭 Thread
#   - POST /api/sdk/threads/{id}/runs        同步 Run
#   - POST /api/sdk/threads/{id}/runs/stream 流式 Run
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 13 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sdk", tags=["hermes-sdk"])


# ============================================================
# 路径白名单
# ============================================================
ALLOWED_PROJECT_PATHS = [
    re.compile(r"^/home/qizheng/auto_code_data"),
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/tmp/test-sdk"),
    re.compile(r"^/tmp/sdk_test_"),
    re.compile(r"^/tmp/e2e_sdk_"),
    re.compile(r"^/tmp/pytest-of-"),
    re.compile(r"^/tmp/tmp"),
]


def is_project_path_allowed(path: str) -> bool:
    if not path:
        return True
    p = Path(path).resolve()
    for pattern in ALLOWED_PROJECT_PATHS:
        if pattern.match(str(p)):
            return True
    return False


# ============================================================
# 数据模型
# ============================================================
@dataclass
class ThreadRecord:
    thread_id: str = ""
    sandbox: str = "workspace_write"
    model: str = "claude-sonnet-4.5"
    project_id: str = ""
    working_directory: str = ""
    system_prompt: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_active_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    status: str = "active"  # active/closed
    run_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class _Storage:
    """In-memory thread storage."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._threads: Dict[str, ThreadRecord] = {}

    def save(self, record: ThreadRecord) -> ThreadRecord:
        with self._lock:
            self._threads[record.thread_id] = record
            return record

    def get(self, thread_id: str) -> Optional[ThreadRecord]:
        with self._lock:
            return self._threads.get(thread_id)

    def list(self) -> List[ThreadRecord]:
        with self._lock:
            return list(self._threads.values())

    def delete(self, thread_id: str) -> bool:
        with self._lock:
            return self._threads.pop(thread_id, None) is not None


_storage = _Storage()


# ============================================================
# Pydantic 模型
# ============================================================
class StartThreadRequest(BaseModel):
    sandbox: str = Field("workspace_write", description="Sandbox: read_only/workspace_write/full_access")
    model: str = Field("claude-sonnet-4.5", description="模型名称")
    project_id: str = Field("", description="项目 ID")
    working_directory: str = Field("", description="工作目录")
    system_prompt: str = Field("", description="系统提示词")


class RunRequest(BaseModel):
    prompt: str = Field(..., description="用户输入提示词")
    output_schema: Optional[Dict[str, Any]] = Field(None, description="结构化输出 schema")
    metadata: Optional[Dict[str, Any]] = Field(None, description="元数据")
    stream: bool = Field(False, description="是否流式")


# ============================================================
# 工具函数
# ============================================================
def _new_thread_id() -> str:
    return f"th_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"


def _new_run_id() -> str:
    return f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"


def _check_api_key(authorization: Optional[str]) -> None:
    """API Key 校验（占位）"""
    # 真实环境应从数据库或环境变量校验
    # 这里仅做格式检查
    if authorization and not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")


def _generate_response(prompt: str, model: str) -> str:
    """生成模拟响应（无 LLM 真实调用）"""
    cleaned = prompt.strip().replace("\n", " ")[:200]
    return f"[Hermes {model}] I received your request: \"{cleaned}\". This is a stub response."


# ============================================================
# 端点实现
# ============================================================
@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    threads = _storage.list()
    return {
        "success": True,
        "service": "hermes-sdk",
        "version": "1.0.0",
        "active_threads": len([t for t in threads if t.status == "active"]),
        "total_threads": len(threads),
        "features": [
            "thread_start",
            "thread_resume",
            "run_sync",
            "run_stream",
            "structured_output",
            "sandbox_modes",
        ],
    }


@router.post("/threads")
async def start_thread(req: StartThreadRequest) -> Dict[str, Any]:
    """启动新 Thread"""
    # 校验 sandbox
    if req.sandbox not in ("read_only", "workspace_write", "full_access"):
        raise HTTPException(status_code=400, detail=f"Invalid sandbox: {req.sandbox}")
    # 校验 working_directory
    if req.working_directory and not is_project_path_allowed(req.working_directory):
        raise HTTPException(status_code=400, detail=f"Working directory not in whitelist: {req.working_directory}")
    record = ThreadRecord(
        thread_id=_new_thread_id(),
        sandbox=req.sandbox,
        model=req.model,
        project_id=req.project_id,
        working_directory=req.working_directory,
        system_prompt=req.system_prompt,
    )
    _storage.save(record)
    return {
        "success": True,
        "thread_id": record.thread_id,
        "sandbox": record.sandbox,
        "model": record.model,
        "project_id": record.project_id,
        "created_at": record.created_at,
    }


@router.get("/threads")
async def list_threads() -> Dict[str, Any]:
    """列出所有 Thread"""
    threads = _storage.list()
    return {
        "success": True,
        "total": len(threads),
        "threads": [t.to_dict() for t in threads],
    }


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """获取 Thread 状态"""
    _check_api_key(authorization)
    record = _storage.get(thread_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")
    return {
        "success": True,
        **record.to_dict(),
    }


@router.delete("/threads/{thread_id}")
async def close_thread(thread_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """关闭 Thread"""
    _check_api_key(authorization)
    record = _storage.get(thread_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")
    record.status = "closed"
    _storage.save(record)
    return {
        "success": True,
        "thread_id": thread_id,
        "status": "closed",
    }


@router.post("/threads/{thread_id}/runs")
async def run_thread(
    thread_id: str,
    req: RunRequest,
    authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """同步 Run"""
    _check_api_key(authorization)
    record = _storage.get(thread_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")
    if record.status == "closed":
        raise HTTPException(status_code=400, detail=f"Thread is closed: {thread_id}")
    # 模拟运行
    start = time.time()
    final_response = _generate_response(req.prompt, record.model)
    elapsed_ms = int((time.time() - start) * 1000) + 10  # 至少 10ms
    # 更新 Thread
    record.run_count += 1
    record.last_active_at = datetime.now(timezone.utc).isoformat()
    _storage.save(record)
    # 构造返回
    run_id = _new_run_id()
    prompt_tokens = max(1, len(req.prompt) // 4)
    completion_tokens = max(1, len(final_response) // 4)
    return {
        "success": True,
        "thread_id": thread_id,
        "run_id": run_id,
        "status": "completed",
        "final_response": final_response,
        "text": final_response,
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
        "collected_items": [],
        "metadata": {
            "elapsed_ms": elapsed_ms,
            "model": record.model,
            "sandbox": record.sandbox,
        },
    }


@router.post("/threads/{thread_id}/runs/stream")
async def run_thread_stream(
    thread_id: str,
    req: RunRequest,
    authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """流式 Run（模拟事件流）"""
    _check_api_key(authorization)
    record = _storage.get(thread_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")
    if record.status == "closed":
        raise HTTPException(status_code=400, detail=f"Thread is closed: {thread_id}")
    # 生成事件流（模拟分片）
    run_id = _new_run_id()
    full_text = _generate_response(req.prompt, record.model)
    # 简单分片（按 16 字符）
    chunk_size = 16
    chunks = [full_text[i:i + chunk_size] for i in range(0, len(full_text), chunk_size)]
    events: List[Dict[str, Any]] = []
    # run_started
    events.append({
        "type": "run_started",
        "run_id": run_id,
        "thread_id": thread_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    # text_delta
    for i, chunk in enumerate(chunks):
        events.append({
            "type": "text_delta",
            "text": chunk,
            "delta": chunk,
            "run_id": run_id,
            "thread_id": thread_id,
            "index": i,
        })
    # run_completed
    prompt_tokens = max(1, len(req.prompt) // 4)
    completion_tokens = max(1, len(full_text) // 4)
    events.append({
        "type": "run_completed",
        "run_id": run_id,
        "thread_id": thread_id,
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    })
    # 更新 Thread
    record.run_count += 1
    record.last_active_at = datetime.now(timezone.utc).isoformat()
    _storage.save(record)
    return {
        "success": True,
        "events": events,
        "final": {
            "thread_id": thread_id,
            "run_id": run_id,
            "status": "completed",
            "final_response": full_text,
            "text": full_text,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        },
    }
