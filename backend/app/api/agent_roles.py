"""
# ============================================================
# Agent Roles REST API (v2.0.0)
# Cycle 63 G63-02 → Cycle 64 G64-01 升级（AgentRunner 集成）
# ====================================
# 核心作用：暴露 AgentRoleManager + AgentRunner 为 REST API
# 运行流程：
#   1. GET    /api/agent-roles                            列出所有角色
#   2. GET    /api/agent-roles/{name}                     获取角色详情
#   3. POST   /api/agent-roles                            注册角色
#   4. PUT    /api/agent-roles/{name}                     更新角色
#   5. DELETE /api/agent-roles/{name}                     删除角色
#   6. POST   /api/agent-roles/{name}/spawn               spawn 实例 + 启动执行
#   7. GET    /api/agent-roles/instances                  列出实例
#   8. GET    /api/agent-roles/instances/{id}             实例详情
#   9. POST   /api/agent-roles/instances/{id}/cancel      取消实例
#  10. POST   /api/agent-roles/instances/{id}/pause       暂停实例
#  11. POST   /api/agent-roles/instances/{id}/resume      恢复实例
#  12. GET    /api/agent-roles/instances/{id}/events      实例的 Hook 事件历史
#  13. GET    /api/agent-roles/_stats                     统计
#  14. POST   /api/agent-roles/load-toml                  从 TOML 加载
#  15. GET    /api/agent-roles/runner/stats               AgentRunner 统计
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# 注意：/instances 必须放在 /{name} 之前避免路径冲突
# 设计要点：
#   - spawn 后立即异步执行任务
#   - 通过 HookEventBus 跟踪进度
#   - 支持实时事件流查询
#   - 取消/暂停/恢复操作幂等
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-02 初次创建
#   - 2026-08-04 | v2.0.0 | Cycle 64 G64-01 增加：
#                                - AgentRunner.start() 集成（spawn 后异步执行）
#                                - /pause /resume 端点
#                                - /events 端点查询 Hook 事件历史
#                                - /runner/stats 端点
# ====================================
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from ..services.agent_role_models import (
    AgentInstance,
    AgentRole,
    CreateRoleRequest,
    HookEventType,
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
from ..services.agent_runner import (
    AgentRunner,
    get_agent_runner,
    reset_agent_runner,
)
from ..services.hook_event_bus import (
    HookEvent,
    HookEventBus,
    get_hook_bus,
    reset_hook_bus,
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
    runner = get_agent_runner()
    return {
        "success": True,
        "stats": manager.get_stats(),
        "runner": runner.get_stats(),
    }


@router.get("/runner/stats")
async def get_runner_stats() -> Dict[str, Any]:
    """获取 AgentRunner 统计信息"""
    runner = get_agent_runner()
    bus = get_hook_bus()
    return {
        "success": True,
        "runner": runner.get_stats(),
        "hook_bus": bus.get_stats(),
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
    """
    spawn 实例并启动异步执行
    v2.0.0 升级：spawn 后立即通过 AgentRunner 启动任务，发出 SubagentStart Hook 事件
    """
    manager = get_agent_role_manager()
    runner = get_agent_runner()
    try:
        role = manager.get_role(name)
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

    # 启动异步执行
    try:
        await runner.start(instance, role)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"AgentRunner.start 失败: {e}")
        # 启动失败时回滚 instance 状态
        instance.status = "failed"
        instance.error = f"runner.start failed: {e}"
        instance.finished_at = __import__("time").time()
        raise HTTPException(status_code=500, detail=f"任务启动失败: {e}") from e

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
    """
    取消实例
    v2.0.0 升级：优先通过 AgentRunner 异步取消，失败时回退到 manager
    """
    manager = get_agent_role_manager()
    runner = get_agent_runner()
    try:
        manager.get_instance(agent_id)  # 校验存在
    except AgentInstanceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    # 优先通过 runner 取消（异步任务）
    if runner.is_running(agent_id):
        await runner.cancel(agent_id)
    # 同步 manager 状态
    instance = manager.cancel_instance(agent_id)
    return {
        "success": True,
        "instance": instance.model_dump(),
    }


@router.post("/instances/{agent_id}/pause")
async def pause_instance(agent_id: str) -> Dict[str, Any]:
    """
    暂停实例
    v2.0.0 新增：仅在任务正在运行时有效
    """
    manager = get_agent_role_manager()
    runner = get_agent_runner()
    try:
        instance = manager.get_instance(agent_id)
    except AgentInstanceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    if not runner.is_running(agent_id):
        raise HTTPException(
            status_code=400,
            detail=f"实例未在运行中（status={instance.status}），无法暂停",
        )

    success = await runner.pause(agent_id)
    instance.paused = True
    return {
        "success": success,
        "instance": instance.model_dump(),
    }


@router.post("/instances/{agent_id}/resume")
async def resume_instance(agent_id: str) -> Dict[str, Any]:
    """
    恢复实例
    v2.0.0 新增：恢复被暂停的任务
    """
    manager = get_agent_role_manager()
    runner = get_agent_runner()
    try:
        instance = manager.get_instance(agent_id)
    except AgentInstanceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    success = await runner.resume(agent_id)
    instance.paused = False
    return {
        "success": success,
        "instance": instance.model_dump(),
    }


@router.get("/instances/{agent_id}/events")
async def list_instance_events(
    agent_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
) -> Dict[str, Any]:
    """
    查询实例的 Hook 事件历史
    v2.0.0 新增：按时间倒序返回最近 N 条事件
    """
    bus = get_hook_bus()
    events = bus.get_history(agent_id, limit=limit)
    return {
        "success": True,
        "agent_id": agent_id,
        "events": [e.to_dict() for e in events],
        "total": len(events),
    }


# ============================================================
# WebSocket 实时事件推送
# ============================================================


@router.websocket("/ws/{agent_id}")
async def websocket_agent_events(websocket: WebSocket, agent_id: str):
    """
    订阅指定 agent 的 Hook 事件流（WebSocket）
    - 客户端建立连接后立即收到一条 initial 消息（包含历史事件 + 当前实例状态）
    - 后续每条 Hook 事件都实时推送给客户端
    - 客户端发送 "ping" 收到 "pong" 心跳
    - 客户端发送 "cancel" 可触发实例取消
    """
    await websocket.accept()
    bus = get_hook_bus()
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    loop = asyncio.get_event_loop()

    def _on_event(event):
        # 在 bus 的事件循环线程中调用，转发到本 WS 的 queue
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except Exception:  # noqa: BLE001
            pass

    sub_id = bus.subscribe(agent_id, _on_event)

    try:
        # 发送 initial 消息
        manager = get_agent_role_manager()
        try:
            instance = manager.get_instance(agent_id)
            instance_dict = instance.model_dump()
        except AgentInstanceNotFoundError:
            instance_dict = None

        history = bus.get_history(agent_id, limit=50)
        await websocket.send_json(
            {
                "type": "initial",
                "agent_id": agent_id,
                "instance": instance_dict,
                "history": [e.to_dict() for e in history],
            }
        )

        # 持续读取客户端消息
        while True:
            # 同时处理：客户端消息、事件队列
            send_task = asyncio.create_task(queue.get())
            recv_task = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait(
                {send_task, recv_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()

            if send_task in done:
                event = send_task.result()
                await websocket.send_json(
                    {
                        "type": "event",
                        "event": event.to_dict(),
                    }
                )

            if recv_task in done:
                try:
                    data = recv_task.result()
                except WebSocketDisconnect:
                    break
                if data == "ping":
                    await websocket.send_text("pong")
                elif data == "cancel":
                    runner = get_agent_runner()
                    if runner.is_running(agent_id):
                        await runner.cancel(agent_id)
                    await websocket.send_json(
                        {"type": "cancelled", "agent_id": agent_id}
                    )
                else:
                    # 兼容 JSON 格式
                    try:
                        import json
                        msg = json.loads(data)
                        if msg.get("type") == "ping":
                            await websocket.send_text("pong")
                    except Exception:  # noqa: BLE001
                        pass
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.exception(f"Agent WebSocket 错误: {e}")
    finally:
        bus.unsubscribe(agent_id, sub_id)


# ============================================================
# 测试辅助端点（仅测试环境使用）
# ====================================================================================


@router.post("/_test/reset")
async def reset_test_state() -> Dict[str, Any]:
    """
    重置 manager/runner/hook_bus 单例（仅测试用）
    生产环境应禁用（通过环境变量控制）
    """
    import os
    if os.environ.get("ENABLE_TEST_ENDPOINTS", "").lower() not in ("1", "true"):
        raise HTTPException(status_code=403, detail="测试端点已禁用")
    reset_agent_runner()
    reset_hook_bus()
    return {
        "success": True,
        "message": "test state reset",
    }
