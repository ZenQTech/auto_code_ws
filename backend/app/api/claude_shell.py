"""
# ============================================================
# ClaudeShell API 端点 (v1.0.0)
# Cycle 58 G58-02
# ============================================================
# 核心作用：暴露 ClaudeCodeShell 进程化能力为 REST API
# 运行流程：
#   1. /health 探测 claude CLI 是否可用
#   2. /invoke 同步调用
#   3. /stream 流式调用（SSE）
#   4. /cancel 取消正在进行的调用
# 设计要点：
#   - 严格输入校验
#   - 错误返回标准 HTTP 状态码
#   - SSE 事件格式遵循 W3C 标准
# 输入参数：HTTP 请求
# 输出结果：JSON 响应 + SSE 流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-02 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

import os
import sys
# 兼容 cli_integration 位于工作空间根目录的情况
_WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _WORKSPACE_ROOT not in sys.path:
    sys.path.insert(0, _WORKSPACE_ROOT)

from cli_integration import claude_code_shell as shell

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/claude-shell", tags=["claude-shell"])

# ============================================================
# 活跃流追踪（用于 cancel 端点）
# ============================================================
_ACTIVE_STREAMS: Dict[str, Dict[str, Any]] = {}


# ============================================================
# Pydantic 数据模型
# ============================================================


class InvokeRequest(BaseModel):
    """调用请求体"""
    prompt: str = Field(..., min_length=1, max_length=100_000, description="提示词")
    args: Optional[List[str]] = Field(default=None, max_length=64, description="额外 CLI 参数")
    cwd: Optional[str] = Field(default=None, max_length=4096, description="工作目录")
    timeout: int = Field(default=300, ge=1, le=1800, description="超时秒数")
    env: Optional[Dict[str, str]] = Field(default=None, description="自定义环境变量")
    
    @field_validator("args")
    @classmethod
    def validate_args(cls, v):
        if v is None:
            return v
        for arg in v:
            if not isinstance(arg, str):
                raise ValueError("args 元素必须为字符串")
            if any(c in arg for c in (";", "|", "&", "$", "`", "\n")):
                raise ValueError(f"参数包含危险字符: {arg[:50]}")
        return v
    
    @field_validator("env")
    @classmethod
    def validate_env(cls, v):
        if v is None:
            return v
        for key in v:
            if key in ("LD_PRELOAD", "LD_LIBRARY_PATH", "PATH", "HOME"):
                raise ValueError(f"不允许覆盖环境变量: {key}")
        return v


class ChunkResponse(BaseModel):
    """单块输出"""
    stream_id: str
    chunk: str
    stream: str  # 'stdout' | 'stderr' | 'system'
    timestamp: float


class InvokeResponse(BaseModel):
    """调用响应"""
    stream_id: str
    success: bool
    exit_code: Optional[int]
    error: Optional[str]
    mode: str
    duration: float
    chunks: List[ChunkResponse]


class HealthResponse(BaseModel):
    """健康检查响应"""
    available: bool
    mode: str  # 'subprocess' | 'fallback'
    version: Optional[str] = None


class CancelRequest(BaseModel):
    """取消请求"""
    stream_id: str = Field(..., min_length=1, max_length=128)


# ============================================================
# 端点定义
# ============================================================


@router.get("/health", response_model=HealthResponse)
async def health():
    """
    健康检查：探测 claude CLI 是否可用
    
    输入参数：无
    输出结果：HealthResponse
    """
    available = await shell.is_available_async()
    return HealthResponse(
        available=available,
        mode="subprocess" if available else "fallback",
    )


@router.post("/invoke", response_model=InvokeResponse)
async def invoke(req: InvokeRequest):
    """
    同步调用 claude CLI
    
    输入参数：InvokeRequest
    输出结果：InvokeResponse
    """
    logger.info(f"invoke: prompt_len={len(req.prompt)} cwd={req.cwd} timeout={req.timeout}")
    
    try:
        result = await shell.invoke(
            prompt=req.prompt,
            args=req.args,
            cwd=req.cwd,
            timeout=req.timeout,
            env=req.env,
        )
        return InvokeResponse(
            stream_id=result.stream_id,
            success=result.success,
            exit_code=result.exit_code,
            error=result.error,
            mode=result.mode,
            duration=result.duration,
            chunks=[
                ChunkResponse(
                    stream_id=c.stream_id,
                    chunk=c.chunk,
                    stream=c.stream,
                    timestamp=c.timestamp,
                )
                for c in result.chunks
            ],
        )
    except Exception as e:
        logger.exception(f"invoke: unexpected error err={e}")
        raise HTTPException(status_code=500, detail=f"内部错误: {e}")


@router.post("/stream")
async def stream(req: InvokeRequest):
    """
    流式调用 claude CLI（SSE 响应）
    
    输入参数：InvokeRequest
    输出结果：SSE 事件流
    """
    stream_id = f"cs-{uuid.uuid4().hex[:16]}"
    logger.info(f"stream: stream_id={stream_id} prompt_len={len(req.prompt)}")
    
    async def event_generator():
        # 1. 发送开始事件
        yield f"event: start\ndata: {json.dumps({'stream_id': stream_id, 'timestamp': time.time()})}\n\n"
        
        # 2. 流式输出
        try:
            async for chunk in shell.stream_invoke(
                prompt=req.prompt,
                args=req.args,
                cwd=req.cwd,
                timeout=req.timeout,
            ):
                payload = {
                    "stream_id": chunk.stream_id,
                    "chunk": chunk.chunk,
                    "stream": chunk.stream,
                    "timestamp": chunk.timestamp,
                }
                yield f"event: {chunk.stream}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            
            # 3. 发送结束事件
            yield f"event: end\ndata: {json.dumps({'stream_id': stream_id, 'success': True, 'timestamp': time.time()})}\n\n"
        except asyncio.CancelledError:
            logger.info(f"stream: client cancelled stream_id={stream_id}")
            yield f"event: cancelled\ndata: {json.dumps({'stream_id': stream_id, 'timestamp': time.time()})}\n\n"
            raise
        except Exception as e:
            logger.exception(f"stream: error stream_id={stream_id} err={e}")
            yield f"event: error\ndata: {json.dumps({'stream_id': stream_id, 'error': str(e), 'timestamp': time.time()})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/cancel")
async def cancel(req: CancelRequest):
    """
    取消正在进行的流式调用（仅标记，不强制杀进程）
    
    输入参数：CancelRequest
    输出结果：JSON
    """
    logger.info(f"cancel: stream_id={req.stream_id}")
    if req.stream_id in _ACTIVE_STREAMS:
        _ACTIVE_STREAMS[req.stream_id]["cancelled"] = True
        return JSONResponse({"success": True, "stream_id": req.stream_id})
    return JSONResponse({"success": False, "error": "stream not found"}, status_code=404)
