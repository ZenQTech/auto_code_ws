"""
# ============================================================
# ClaudeCLI API 路由 (v1.0.0)
# Cycle 61 G61-01-T2
# ============================================================
# 核心作用：暴露 ClaudeCLIProcess 进程编排能力为 REST + SSE API
# 运行流程：
#   1. /health 探测 cli 可用性 + 沙箱状态
#   2. /exec 启动进程（返回 process_id）
#   3. /events/{id} SSE 事件流
#   4. /cancel/{id} 取消
#   5. /sandbox 探测所有沙箱可用性
# 设计要点：
#   - 严格输入校验（prompt 长度、timeout 上限）
#   - SSE 标准事件格式
#   - 全链路异常处理 + 资源清理
# 输入参数：HTTP 请求
# 输出结果：JSON 响应 + SSE 流
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-01-T2 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..services.claude_cli import (
    ClaudeCLIOptions,
    ClaudeCLIProcess,
    CLIEvent,
    CLIEventType,
    CLIState,
    get_registry,
)
from ..services.sandbox_manager import (
    SANDBOX_PRIORITY,
    SandboxType,
    get_sandbox_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/claude-cli", tags=["claude-cli"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class ExecRequest(BaseModel):
    """启动执行请求"""
    prompt: str = Field(..., min_length=1, max_length=100_000, description="提示词")
    model: Optional[str] = Field(default=None, max_length=128, description="模型名称")
    sandbox: Optional[str] = Field(
        default=None,
        description="沙箱类型：docker / gvisor / firejail / none，None 表示自动选择",
    )
    timeout: int = Field(default=300, ge=1, le=1800, description="超时秒数")
    max_tokens: int = Field(default=8192, ge=1, le=200_000, description="最大 token 数")
    tools: List[str] = Field(
        default_factory=lambda: ["read", "write", "bash"],
        max_length=32,
        description="工具列表",
    )
    cwd: Optional[str] = Field(default=None, max_length=4096, description="工作目录")
    cpu_quota: float = Field(default=0.8, ge=0.1, le=1.0, description="CPU 配额 (0-1)")
    mem_limit_mb: int = Field(default=512, ge=64, le=8192, description="内存限制 (MB)")
    auto_fallback: bool = Field(default=True, description="CLI 不可用时自动降级")
    args: Optional[List[str]] = Field(default=None, max_length=64, description="额外参数")
    stream: bool = Field(default=True, description="是否使用 SSE 流式")

    @field_validator("sandbox")
    @classmethod
    def validate_sandbox(cls, v):
        if v is None:
            return v
        valid = {s.value for s in SandboxType}
        if v not in valid:
            raise ValueError(f"sandbox 必须是 {valid} 之一，实际 {v}")
        return v

    @field_validator("tools")
    @classmethod
    def validate_tools(cls, v):
        for t in v:
            if not isinstance(t, str) or not t.strip():
                raise ValueError(f"tools 元素必须是非空字符串，实际 {t}")
        return v

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


class ExecResponse(BaseModel):
    """启动执行响应"""
    id: str
    status: str
    created_at: float
    sandbox: Optional[str] = None
    mode: str  # 'subprocess' | 'fallback'


class EventResponse(BaseModel):
    """事件响应（非流式）"""
    id: str
    type: str
    timestamp: float
    content: str = ""
    metadata: Optional[Dict[str, Any]] = None


class HealthResponse(BaseModel):
    """健康检查响应"""
    available: bool
    mode: str  # 'subprocess' | 'fallback'
    version: Optional[str] = None
    sandboxes: Dict[str, bool] = {}


class CancelResponse(BaseModel):
    """取消响应"""
    success: bool
    id: str
    error: Optional[str] = None


class SandboxInfo(BaseModel):
    """沙箱信息"""
    type: str
    available: bool
    binary_path: Optional[str] = None


# ============================================================
# 错误码常量
# ============================================================

ERROR_CODES = {
    "CLI_NOT_FOUND": "Claude CLI 不在 PATH",
    "CLI_TIMEOUT": "Claude CLI 执行超时",
    "CLI_OOM": "Claude CLI 内存溢出",
    "CLI_SANDBOX_ERROR": "沙箱启动失败",
    "CLI_INVALID_INPUT": "输入参数非法",
    "CLI_NOT_REGISTERED": "进程 ID 不存在或已结束",
    "CLI_INTERNAL_ERROR": "内部错误",
}


# ============================================================
# 端点
# ====================================


@router.get("/health", response_model=HealthResponse)
async def health():
    """
    健康检查：探测 claude CLI + 所有沙箱可用性

    输入参数：无
    输出结果：HealthResponse
    """
    from cli_integration import claude_code_shell as shell

    available = await shell.is_available_async()
    mode = "subprocess" if available else "fallback"

    # 探测沙箱
    sandboxes_status: Dict[str, bool] = {}
    try:
        mgr = await get_sandbox_manager()
        status = await mgr.health_check()
        for s in SANDBOX_PRIORITY:
            sandboxes_status[s.value] = status.get(s, False)
    except Exception as e:
        logger.warning(f"health: sandbox probe failed: {e}")
        for s in SANDBOX_PRIORITY:
            sandboxes_status[s.value] = False

    return HealthResponse(
        available=available,
        mode=mode,
        version=shell.__version__ if hasattr(shell, "__version__") else None,
        sandboxes=sandboxes_status,
    )


@router.post("/exec", response_model=ExecResponse)
async def exec(req: ExecRequest):
    """
    启动 Claude CLI 进程。

    - stream=false：同步等待完成，返回所有事件（适合短任务）
    - stream=true：返回 202 + process_id，客户端订阅 /events/{id}
    """
    sandbox_type = (
        SandboxType(req.sandbox) if req.sandbox else None
    )
    options = ClaudeCLIOptions(
        model=req.model,
        sandbox=sandbox_type,
        timeout=req.timeout,
        max_tokens=req.max_tokens,
        tools=req.tools,
        cwd=req.cwd,
        cpu_quota=req.cpu_quota,
        mem_limit_mb=req.mem_limit_mb,
        auto_fallback=req.auto_fallback,
        args=req.args,
    )

    if req.stream:
        # 流式：仅启动，返回 process_id
        proc = ClaudeCLIProcess()
        # 预创建 STARTED 事件（验证可启动）
        try:
            started = await proc.start(req.prompt, options)
            sandbox_used = started.metadata.get("sandbox") if started.metadata else None
            return ExecResponse(
                id=proc.process_id,
                status="running",
                created_at=started.timestamp,
                sandbox=sandbox_used,
                mode="fallback" if proc._fallback_used else "subprocess",
            )
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail={"code": "CLI_INVALID_INPUT", "message": str(e)},
            )
        except RuntimeError as e:
            raise HTTPException(
                status_code=503,
                detail={"code": "CLI_INTERNAL_ERROR", "message": str(e)},
            )

    # 同步：一次性执行完，返回所有事件
    events: List[EventResponse] = []
    try:
        async for ev in exec_prompt_full(req.prompt, options):
            events.append(
                EventResponse(
                    id=ev.id,
                    type=ev.type.value,
                    timestamp=ev.timestamp,
                    content=ev.content,
                    metadata=ev.metadata,
                )
            )
        return JSONResponse(
            {
                "id": events[0].id if events else f"cli-{uuid.uuid4().hex[:16]}",
                "events": [e.model_dump() for e in events],
                "event_count": len(events),
            }
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail={"code": "CLI_INVALID_INPUT", "message": str(e)},
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "CLI_INTERNAL_ERROR", "message": str(e)},
        )


@router.get("/events/{process_id}")
async def events(process_id: str, request: Request):
    """
    SSE 事件流：订阅指定 process_id 的 Claude CLI 事件。

    输入参数：process_id (str)
    输出结果：SSE 事件流
    """
    proc = get_registry().get(process_id)
    if proc is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "CLI_NOT_REGISTERED", "message": f"process {process_id} not found"},
        )

    async def event_generator() -> AsyncIterator[str]:
        try:
            # 流式转发已注册 process 的事件
            # 由于 ClaudeCLIProcess 的 stream() 是阻塞的，我们采用轮询方式
            # 每 100ms 检查 process 状态变化
            last_state: Optional[CLIState] = None
            start_time = time.time()
            max_wait = 1800  # 30 分钟（与 max_timeout 一致）
            while True:
                # 检查客户端是否断开
                if await request.is_disconnected():
                    logger.info(f"events: client disconnected process_id={process_id}")
                    break

                # 轮询 process 状态
                current = proc.state
                if current != last_state:
                    yield _sse_event(
                        "state",
                        {
                            "process_id": process_id,
                            "state": current.value,
                            "timestamp": time.time(),
                        },
                    )
                    last_state = current

                # 终止状态
                if proc.is_terminal:
                    # 发送最后一个 EXIT 事件
                    result = proc.result()
                    yield _sse_event(
                        "exit",
                        {
                            "process_id": process_id,
                            "state": result.state.value,
                            "exit_code": result.exit_code,
                            "duration": result.duration,
                            "total_bytes": result.total_bytes,
                            "chunk_count": result.chunk_count,
                            "error": result.error,
                            "timestamp": time.time(),
                        },
                    )
                    break

                # 超时保护
                if (time.time() - start_time) > max_wait:
                    logger.warning(
                        f"events: SSE polling timeout process_id={process_id}"
                    )
                    break

                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            logger.info(f"events: cancelled process_id={process_id}")
            raise
        except Exception as e:
            logger.exception(f"events: error process_id={process_id}: {e}")
            yield _sse_event(
                "error",
                {"process_id": process_id, "error": str(e), "timestamp": time.time()},
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/cancel/{process_id}", response_model=CancelResponse)
async def cancel(process_id: str):
    """
    取消正在进行的进程。

    输入参数：process_id (str)
    输出结果：CancelResponse
    """
    proc = get_registry().get(process_id)
    if proc is None:
        return CancelResponse(
            success=False,
            id=process_id,
            error="process not found or already terminated",
        )
    cancelled = proc.cancel()
    return CancelResponse(success=cancelled, id=process_id)


@router.get("/sandbox", response_model=List[SandboxInfo])
async def sandbox_list():
    """
    列出所有沙箱及其可用性。

    输入参数：无
    输出结果：List[SandboxInfo]
    """
    mgr = await get_sandbox_manager()
    status = await mgr.health_check(force=True)
    result: List[SandboxInfo] = []
    for s in SANDBOX_PRIORITY:
        result.append(
            SandboxInfo(
                type=s.value,
                available=status.get(s, False),
                binary_path=None,
            )
        )
    return result


@router.get("/processes")
async def list_processes():
    """
    列出所有活跃进程（用于调试和监控）。

    输入参数：无
    输出结果：JSON
    """
    procs = get_registry().all()
    return {
        "count": len(procs),
        "processes": [
            {
                "id": p.process_id,
                "state": p.state.value,
                "sandbox": p._sandbox_used.value if p._sandbox_used else None,
                "fallback": p._fallback_used,
            }
            for p in procs
        ],
    }


# ============================================================
# 内部辅助
# ====================================


def _sse_event(event_type: str, data: Dict[str, Any]) -> str:
    """生成 SSE 事件字符串"""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def exec_prompt_full(
    prompt: str, options: ClaudeCLIOptions
) -> AsyncIterator[CLIEvent]:
    """
    完整执行 prompt 并返回所有事件（用于非流式模式）。
    """
    proc = ClaudeCLIProcess()
    async for ev in proc.stream(prompt, options):
        yield ev
