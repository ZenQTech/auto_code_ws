"""
# ============================================================
# Sandbox API (v1.0.0)
# Cycle 69 G69-01
# ============================================================
# 核心作用：暴露 SandboxExecutor 为 REST API
#   POST   /api/sandbox/create       创建 sandbox
#   POST   /api/sandbox/{id}/start   启动 sandbox
#   POST   /api/sandbox/{id}/exec    在 sandbox 中执行命令
#   POST   /api/sandbox/{id}/stop    停止 sandbox
#   DELETE /api/sandbox/{id}         销毁 sandbox
#   GET    /api/sandbox/list         列出所有 sandbox
#   GET    /api/sandbox/{id}/audit   获取审计日志
#   GET    /api/sandbox/stats        获取全局统计
# 输入参数：JSON body（work_dir, resource_preset, network_policy, ...）
# 输出结果：JSON response（SandboxInfo / SandboxResult）
# 对标：Codex codex-sandbox + Docker Sandboxes
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-01 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.sandbox_executor import (
    BackendType,
    FsPolicy,
    InvalidConfigError,
    NetworkPolicy,
    ResourceLimits,
    SandboxAlreadyExistsError,
    SandboxConfig,
    SandboxError,
    SandboxExecutor,
    SandboxNotFoundError,
    SandboxStatus,
    SandboxTimeoutError,
    get_sandbox_executor,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sandbox", tags=["sandbox"])


# ============================================================
# Request / Response Models
# ============================================================


class NetworkPolicyModel(BaseModel):
    mode: str = Field(default="deny", description="deny | allow-all")
    allowed_domains: List[str] = Field(default_factory=list)
    allowed_ports: List[int] = Field(default_factory=lambda: [443, 80])
    allow_localhost: bool = False


class FsPolicyModel(BaseModel):
    mode: str = "restricted"
    writable_paths: List[str] = Field(default_factory=list)
    readable_paths: List[str] = Field(default_factory=list)
    max_file_size_mb: int = 100


class CreateSandboxRequest(BaseModel):
    work_dir: str = Field(..., description="工作目录绝对路径")
    resource_preset: str = Field(default="default", description="small/default/large/xlarge")
    network_policy: Optional[NetworkPolicyModel] = None
    fs_policy: Optional[FsPolicyModel] = None
    init_hook: Optional[str] = None
    env_vars: Dict[str, str] = Field(default_factory=dict)
    ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    image: str = "python:3.11-slim"
    backend: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SandboxResponse(BaseModel):
    sandbox_id: str
    backend: str
    status: str
    work_dir: str
    created_at: str
    started_at: Optional[str] = None
    stopped_at: Optional[str] = None
    pid: Optional[int] = None
    container_id: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)


class ExecRequest(BaseModel):
    command: List[str] = Field(..., min_length=1)
    timeout: int = Field(default=600, ge=1, le=86400)
    env: Dict[str, str] = Field(default_factory=dict)


class ExecResponse(BaseModel):
    sandbox_id: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    command: List[str] = Field(default_factory=list)
    timed_out: bool = False
    resource_usage: Dict[str, Any] = Field(default_factory=dict)


class AuditResponse(BaseModel):
    sandbox_id: str
    events: List[Dict[str, Any]] = Field(default_factory=list)
    total: int = 0


class StatsResponse(BaseModel):
    total: int
    by_status: Dict[str, int] = Field(default_factory=dict)
    by_backend: Dict[str, int] = Field(default_factory=dict)
    total_disk_mb: float = 0.0
    oldest_created_at: Optional[str] = None


class ListResponse(BaseModel):
    sandboxes: List[SandboxResponse] = Field(default_factory=list)
    total: int = 0


# ============================================================
# 辅助函数
# ============================================================


def _info_to_response(info) -> SandboxResponse:
    return SandboxResponse(
        sandbox_id=info.sandbox_id,
        backend=info.backend.value if hasattr(info.backend, "value") else str(info.backend),
        status=info.status.value if hasattr(info.status, "value") else str(info.status),
        work_dir=info.work_dir,
        created_at=info.created_at,
        started_at=info.started_at,
        stopped_at=info.stopped_at,
        pid=info.pid,
        container_id=info.container_id,
        config=info.config.to_dict() if info.config else {},
    )


def _to_config(req: CreateSandboxRequest) -> SandboxConfig:
    network_policy = NetworkPolicy(
        mode=req.network_policy.mode if req.network_policy else "deny",
        allowed_domains=(req.network_policy.allowed_domains if req.network_policy and req.network_policy.allowed_domains else [
            "api.anthropic.com",
            "api.openai.com",
            "api.github.com",
            "github.com",
        ]),
        allowed_ports=(req.network_policy.allowed_ports if req.network_policy and req.network_policy.allowed_ports else [443, 80]),
        allow_localhost=(req.network_policy.allow_localhost if req.network_policy else False),
    )
    fs_policy = FsPolicy(
        mode=req.fs_policy.mode if req.fs_policy else "restricted",
        writable_paths=req.fs_policy.writable_paths if req.fs_policy else [],
        readable_paths=req.fs_policy.readable_paths if req.fs_policy else [],
        max_file_size_mb=req.fs_policy.max_file_size_mb if req.fs_policy else 100,
    )
    backend = None
    if req.backend:
        try:
            backend = BackendType(req.backend)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid backend: {req.backend}")
    return SandboxConfig(
        work_dir=req.work_dir,
        resource_preset=req.resource_preset,
        network_policy=network_policy,
        fs_policy=fs_policy,
        init_hook=req.init_hook,
        env_vars=req.env_vars,
        auto_cleanup=True,
        ttl_seconds=req.ttl_seconds,
        image=req.image,
        backend=backend,
        metadata=req.metadata,
    )


# ============================================================
# REST 端点
# ============================================================


@router.post("/create", response_model=SandboxResponse, status_code=201)
def create_sandbox(req: CreateSandboxRequest) -> SandboxResponse:
    """创建 sandbox"""
    executor = get_sandbox_executor()
    config = _to_config(req)
    try:
        info = executor.create(config)
        return _info_to_response(info)
    except InvalidConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SandboxAlreadyExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except SandboxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/start", response_model=SandboxResponse)
def start_sandbox(sandbox_id: str) -> SandboxResponse:
    """启动 sandbox"""
    executor = get_sandbox_executor()
    try:
        info = executor.start(sandbox_id)
        return _info_to_response(info)
    except SandboxNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SandboxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/exec", response_model=ExecResponse)
def exec_in_sandbox(sandbox_id: str, req: ExecRequest) -> ExecResponse:
    """在 sandbox 中执行命令"""
    executor = get_sandbox_executor()
    try:
        result = executor.exec(sandbox_id, req.command, req.timeout, req.env)
        return ExecResponse(
            sandbox_id=result.sandbox_id,
            exit_code=result.exit_code,
            stdout=result.stdout,
            stderr=result.stderr,
            duration_ms=result.duration_ms,
            command=result.command,
            timed_out=result.timed_out,
            resource_usage=result.resource_usage.to_dict(),
        )
    except SandboxNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InvalidConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SandboxTimeoutError as e:
        raise HTTPException(status_code=408, detail=str(e))
    except SandboxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{sandbox_id}/stop", response_model=SandboxResponse)
def stop_sandbox(sandbox_id: str) -> SandboxResponse:
    """停止 sandbox（不删除）"""
    executor = get_sandbox_executor()
    try:
        executor.stop(sandbox_id)
        info = executor.get(sandbox_id)
        if info is None:
            raise HTTPException(status_code=404, detail=f"Sandbox {sandbox_id} not found after stop")
        return _info_to_response(info)
    except SandboxNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SandboxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{sandbox_id}")
def delete_sandbox(sandbox_id: str) -> Dict[str, Any]:
    """销毁 sandbox（删除所有资源）"""
    executor = get_sandbox_executor()
    try:
        executor.cleanup(sandbox_id)
        return {"sandbox_id": sandbox_id, "status": "destroyed"}
    except SandboxNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SandboxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=ListResponse)
def list_sandboxes(
    status: Optional[str] = Query(default=None, description="按状态过滤"),
    limit: int = Query(default=100, ge=1, le=1000),
) -> ListResponse:
    """列出所有 sandbox"""
    executor = get_sandbox_executor()
    status_enum = None
    if status:
        try:
            status_enum = SandboxStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    sandboxes = executor.list_sandboxes(status_enum)[:limit]
    return ListResponse(
        sandboxes=[_info_to_response(s) for s in sandboxes],
        total=len(sandboxes),
    )


@router.get("/{sandbox_id}/audit", response_model=AuditResponse)
def get_audit_log(
    sandbox_id: str,
    last_n: int = Query(default=100, ge=1, le=10000),
) -> AuditResponse:
    """获取 sandbox 审计日志"""
    executor = get_sandbox_executor()
    try:
        events = executor.read_audit_log(sandbox_id, last_n)
        return AuditResponse(sandbox_id=sandbox_id, events=events, total=len(events))
    except SandboxNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/stats", response_model=StatsResponse)
def get_stats() -> StatsResponse:
    """获取全局统计"""
    executor = get_sandbox_executor()
    stats = executor.get_stats()
    return StatsResponse(**stats.to_dict())


@router.post("/retention/apply")
def apply_retention(max_age_days: int = Query(default=30, ge=1, le=365)) -> Dict[str, Any]:
    """手动触发 retention"""
    executor = get_sandbox_executor()
    cleaned = executor.apply_retention(max_age_days)
    return {"cleaned": cleaned, "max_age_days": max_age_days}
