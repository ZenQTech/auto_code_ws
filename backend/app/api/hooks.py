"""
# ============================================================
# Hooks API 路由 (v1.0.0) - Cycle 4 P0-4 Hook 事件完整化
# ============================================================
# 核心作用：暴露 10 类 Hook 事件的 REST API + 触发接口
# 端点：
#   - GET    /api/hooks                       列出所有 hook 配置
#   - GET    /api/hooks/events                列出 10 种事件类型
#   - GET    /api/hooks/summary               注册表摘要
#   - POST   /api/hooks/configs               添加 hook 配置
#   - DELETE /api/hooks/configs/{idx}         删除 hook 配置
#   - POST   /api/hooks/load                  从文件加载配置
#   - GET    /api/hooks/history               查看触发历史
#   - POST   /api/hooks/dispatch              触发事件（手动测试）
#   - POST   /api/hooks/test                  测试单个 hook
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 4 P0-4 Hook 事件完整化
# ============================================================
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel, Field

from backend.app.services.hooks_registry import (
    HooksRegistry,
    HookConfig,
    HookDefinition,
    HookEventType,
    get_hooks_registry,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class HookDefinitionRequest(BaseModel):
    """Hook 定义请求"""
    type: str = Field(default="command", description="hook 类型（command/prompt/function）")
    command: str = Field(default="", description="shell 命令")
    timeout: int = Field(default=60, ge=1, le=600, description="超时时间（秒）")
    env: Dict[str, str] = Field(default_factory=dict, description="附加环境变量")
    cwd: Optional[str] = Field(default=None, description="工作目录")
    name: Optional[str] = Field(default=None, description="友好名称")


class HookConfigRequest(BaseModel):
    """Hook 配置请求"""
    event: str = Field(..., description="事件类型（10 种之一）")
    matcher: str = Field(default="", description="匹配模式（正则）")
    hooks: List[HookDefinitionRequest] = Field(default_factory=list, description="hook 列表")


class AddHookRequest(BaseModel):
    """添加 hook 请求"""
    event: str = Field(..., description="事件类型")
    matcher: str = Field(default="", description="匹配模式")
    type: str = Field(default="command", description="hook 类型")
    command: str = Field(..., description="shell 命令")
    timeout: int = Field(default=60, ge=1, le=600, description="超时（秒）")
    name: Optional[str] = Field(default=None, description="友好名称")


class DispatchRequest(BaseModel):
    """触发事件请求"""
    event: str = Field(..., description="事件类型")
    payload: Dict[str, Any] = Field(default_factory=dict, description="事件 payload")


class LoadConfigRequest(BaseModel):
    """加载配置请求"""
    config_path: str = Field(..., description="配置文件路径")


# ============================================================
# 端点
# ============================================================

@router.get("/events")
async def list_hook_events():
    """
    列出 10 种 Hook 事件类型

    返回值：{
        "events": [
            {"name": "SessionStart", "description": "..."},
            ...
        ]
    }
    """
    event_descriptions = {
        "SessionStart": "会话开始时触发，可用于初始化资源、加载用户偏好",
        "UserPromptSubmit": "用户消息提交时触发，可用于预处理、关键词检测",
        "PreToolUse": "工具调用前触发，可用于权限检查、参数验证",
        "PostToolUse": "工具调用后触发，可用于日志、结果处理、副作用",
        "PermissionRequest": "权限请求时触发，可用于自动审批、审计",
        "PreCompact": "上下文压缩前触发，可用于备份重要信息",
        "PostCompact": "上下文压缩后触发，可用于恢复状态",
        "SubagentStart": "SubAgent 启动时触发，可用于注入上下文",
        "SubagentStop": "SubAgent 停止时触发，可用于结果收集、清理",
        "SessionEnd": "会话结束时触发，可用于清理、归档、统计",
    }
    return {
        "events": [
            {"name": name, "description": event_descriptions.get(name, "")}
            for name in HookEventType.all_events()
        ],
        "total": len(HookEventType.all_events()),
    }


@router.get("/summary")
async def get_summary():
    """
    获取注册表摘要信息

    返回值：注册表摘要
    """
    registry = get_hooks_registry()
    return registry.get_summary()


@router.get("")
async def list_all_hooks():
    """
    列出所有 hook 配置

    返回值：所有 hook 配置（event, matcher, hooks）
    """
    registry = get_hooks_registry()
    return {
        "configs": [c.to_dict() for c in registry.configs],
        "total": len(registry.configs),
    }


@router.post("/configs")
async def add_hook_config(request: HookConfigRequest):
    """
    添加一个完整的 hook 配置（event + matcher + hooks 列表）

    参数：
      - request: HookConfigRequest
    返回值：添加结果
    """
    if request.event not in HookEventType.all_events():
        raise HTTPException(
            status_code=400,
            detail=f"未知事件类型: {request.event}，"
                   f"有效类型: {HookEventType.all_events()}",
        )

    try:
        config = HookConfig(
            event=request.event,
            matcher=request.matcher,
            hooks=[HookDefinition.from_dict(h.model_dump()) for h in request.hooks],
        )
        get_hooks_registry().add(config)
        return {
            "success": True,
            "config": config.to_dict(),
            "message": f"Hook 配置已添加: event={request.event}, matcher={request.matcher}",
        }
    except Exception as e:
        logger.error(f"添加 hook 配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/configs/{idx}")
async def delete_hook_config(idx: int):
    """
    删除指定索引的 hook 配置

    参数：
      - idx: 配置索引（从 0 开始）
    返回值：删除结果
    """
    registry = get_hooks_registry()
    configs = registry.configs
    if idx < 0 or idx >= len(configs):
        raise HTTPException(
            status_code=404,
            detail=f"索引 {idx} 超出范围 (0-{len(configs)-1})",
        )

    removed = configs[idx]
    # 通过重新构造来删除
    new_configs = [c for i, c in enumerate(registry._configs) if i != idx]
    registry._configs = new_configs
    return {
        "success": True,
        "removed": removed.to_dict(),
        "message": f"已删除索引 {idx} 的配置",
    }


@router.post("/load")
async def load_config_from_file(request: LoadConfigRequest):
    """
    从文件加载 hook 配置

    参数：
      - request: { config_path: "..." }
    返回值：加载结果
    """
    config_path = Path(request.config_path)
    if not config_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"配置文件不存在: {config_path}",
        )

    try:
        get_hooks_registry().load_from_file(config_path)
        return {
            "success": True,
            "summary": get_hooks_registry().get_summary(),
            "message": f"已加载配置: {config_path}",
        }
    except Exception as e:
        logger.error(f"加载配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear")
async def clear_hooks():
    """
    清空所有 hook 配置

    返回值：清空结果
    """
    get_hooks_registry().clear()
    return {
        "success": True,
        "message": "已清空所有 hook 配置",
    }


@router.get("/history")
async def get_history(limit: int = 50):
    """
    查看触发历史

    参数：
      - limit: 返回最近 N 条
    返回值：触发历史
    """
    history = get_hooks_registry().history
    return {
        "history": history[-limit:],
        "total": len(history),
    }


@router.post("/dispatch")
async def dispatch_event(request: DispatchRequest):
    """
    触发一个 hook 事件（手动测试）

    参数：
      - request: { event: "...", payload: {...} }
    返回值：所有执行 hook 的结果
    """
    if request.event not in HookEventType.all_events():
        raise HTTPException(
            status_code=400,
            detail=f"未知事件类型: {request.event}",
        )

    try:
        actions = await get_hooks_registry().dispatch(request.event, request.payload)
        return {
            "success": True,
            "event": request.event,
            "executed": len(actions),
            "actions": [a.to_dict() for a in actions],
            "blocking": any(a.is_blocking for a in actions),
        }
    except Exception as e:
        logger.error(f"事件触发失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test")
async def test_single_hook(request: AddHookRequest):
    """
    测试单个 hook（不注册到注册表，临时执行）

    参数：
      - request: hook 定义
    返回值：执行结果
    """
    if request.event not in HookEventType.all_events():
        raise HTTPException(
            status_code=400,
            detail=f"未知事件类型: {request.event}",
        )

    # 构造临时注册表
    temp_registry = HooksRegistry()
    temp_registry.add(HookConfig(
        event=request.event,
        matcher=request.matcher,
        hooks=[HookDefinition(
            type=request.type,
            command=request.command,
            timeout=request.timeout,
            name=request.name or "test_hook",
        )],
    ))

    # 构造测试 payload
    test_payload = {
        "tool_name": "TestTool",
        "user_input": "test input",
        "session_id": "test-session",
        "subagent_id": "test-subagent",
        "task": "test task",
    }

    try:
        actions = await temp_registry.dispatch(request.event, test_payload)
        return {
            "success": True,
            "event": request.event,
            "actions": [a.to_dict() for a in actions],
        }
    except Exception as e:
        logger.error(f"Hook 测试失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
