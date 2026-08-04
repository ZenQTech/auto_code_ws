"""
# ============================================================
# Agent Roles REST API (v1.0.0)
# Cycle 63 G63-02
# ============================================================
# 核心作用：暴露 AgentRoleManager 为 REST API
# 运行流程：
#   1. GET    /api/agent-roles                 列出所有角色
#   2. GET    /api/agent-roles/{name}          获取角色详情
#   3. POST   /api/agent-roles                 注册角色
#   4. PUT    /api/agent-roles/{name}          更新角色
#   5. DELETE /api/agent-roles/{name}          删除角色
#   6. POST   /api/agent-roles/{name}/spawn    spawn 实例
#   7. GET    /api/agent-roles/instances       列出实例
#   8. GET    /api/agent-roles/instances/{id}  实例详情
#   9. POST   /api/agent-roles/instances/{id}/cancel  取消
#  10. GET    /api/agent-roles/_stats          统计
#  11. POST   /api/agent-roles/load-toml       从 TOML 加载
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# 注意：/instances 必须放在 /{name} 之前避免路径冲突
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-02 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.agent_role_models import (
    AgentInstance,
    AgentRole,
    CreateRoleRequest,
    SpawnAgentRequest,
    UpdateRoleRequest,
)
from ..services.agent_role_manager import (
    AgentRoleManager,
    AgentInstanceNotFoundError,
    ConcurrencyLimitError,
    RoleAlreadyExistsError,
    RoleNotFoundError,
    RoleValidationError,
    get_agent_role_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent-roles", tags=["agent-roles"])


# ============================================================
# TOML 加载请求
# ============================================================


class LoadTOMLRequest(BaseModel):
    toml_path: str = Field(..., min_length=1, max_length=512)
    override: bool = False


# ============================================================
# 静态路径端点（必须放在 /{name} 之前）
# ============================================================


@router.get("/_stats")
async def get_stats() -> Dict[str, Any]:
    """获取统计信息"""
    manager = get_agent_role_manager()
    return {
        "success": True,
        "stats": manager.get_stats(),
    }


@router.get("/instances")
async def list_instances(
    role_name: Optional[str] = Query(default=None, max_length=64),
    status: Optional[str] = Query(default=None, max_length=32),
) -> Dict[str, Any]:
    """列出实例"""
    manager = get_agent_role_manager()
    instances = manager.list_instances(role_name=role_name, status=status)
    return {
        "success": True,
        "instances": [i.model_dump() for i in instances],
        "total": len(instances),
    }


@router.post("/load-toml")
async def load_toml(req: LoadTOMLRequest) -> Dict[str, Any]:
    """从 TOML 文件加载并注册角色"""
    manager = get_agent_role_manager()
    try:
        role = manager.register_role_from_toml(req.toml_path, override=req.override)
    except RoleValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RoleAlreadyExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception(f"load_toml 失败: {e}")
        raise HTTPException(status_code=500, detail=f"加载失败: {e}") from e
    return {
        "success": True,
        "role": role.model_dump(),
    }


@router.get("")
async def list_roles() -> Dict[str, Any]:
    """列出所有角色"""
    manager = get_agent_role_manager()
    roles = manager.list_roles()
    return {
        "success": True,
        "roles": [r.model_dump() for r in roles],
        "total": len(roles),
    }


@router.post("")
async def create_role(req: CreateRoleRequest) -> Dict[str, Any]:
    """注册新角色"""
    manager = get_agent_role_manager()
    try:
        role = AgentRole(**req.model_dump())
        manager.register_role(role)
    except RoleAlreadyExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        # Pydantic ValidationError 也会进入这里
        logger.exception(f"create_role 失败: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "success": True,
        "role": role.model_dump(),
    }


# ============================================================
# 动态路径端点（/{name}）
# ============================================================


@router.get("/{name}")
async def get_role(name: str) -> Dict[str, Any]:
    """获取角色详情"""
    manager = get_agent_role_manager()
    try:
        role = manager.get_role(name)
    except RoleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {
        "success": True,
        "role": role.model_dump(),
    }


@router.put("/{name}")
async def update_role(name: str, req: UpdateRoleRequest) -> Dict[str, Any]:
    """更新角色"""
    manager = get_agent_role_manager()
    try:
        updates = {k: v for k, v in req.model_dump().items() if v is not None}
        role = manager.update_role(name, **updates)
    except RoleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RoleValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception(f"update_role 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {
        "success": True,
        "role": role.model_dump(),
    }


@router.delete("/{name}")
async def delete_role(name: str) -> Dict[str, Any]:
    """删除角色"""
    manager = get_agent_role_manager()
    try:
        success = manager.delete_role(name)
    except RoleValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ConcurrencyLimitError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if not success:
        raise HTTPException(status_code=404, detail=f"角色不存在: {name}")
    return {
        "success": True,
        "name": name,
    }


@router.post("/{name}/spawn")
async def spawn_instance(name: str, req: SpawnAgentRequest) -> Dict[str, Any]:
    """spawn 实例"""
    manager = get_agent_role_manager()
    try:
        instance = manager.spawn_instance(
            role_name=name,
            task=req.task,
            nickname=req.nickname,
        )
    except RoleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ConcurrencyLimitError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception(f"spawn_instance 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {
        "success": True,
        "instance": instance.model_dump(),
    }


@router.get("/instances/{agent_id}")
async def get_instance(agent_id: str) -> Dict[str, Any]:
    """获取实例详情"""
    manager = get_agent_role_manager()
    try:
        instance = manager.get_instance(agent_id)
    except AgentInstanceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {
        "success": True,
        "instance": instance.model_dump(),
    }


@router.post("/instances/{agent_id}/cancel")
async def cancel_instance(agent_id: str) -> Dict[str, Any]:
    """取消实例"""
    manager = get_agent_role_manager()
    try:
        instance = manager.cancel_instance(agent_id)
    except AgentInstanceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {
        "success": True,
        "instance": instance.model_dump(),
    }
