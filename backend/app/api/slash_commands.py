"""
# ============================================================
# Slash Commands API 路由 (v1.0.0) - Cycle 8 P0-12
# ============================================================
# 核心作用：暴露 Slash Commands 系统的 REST API
# 端点：
#   - GET    /api/slash-commands              列出所有命令
#   - GET    /api/slash-commands/summary      注册表摘要
#   - GET    /api/slash-commands/{name}       查询命令详情
#   - POST   /api/slash-commands/execute      执行命令
#   - GET    /api/slash-commands/categories   按分类列出
#   - GET    /api/slash-commands/search       搜索命令
#   - GET    /api/slash-commands/history      执行历史
#   - POST   /api/slash-commands/history/clear 清空历史
#   - PATCH  /api/slash-commands/{name}/toggle 启用/禁用命令
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-12
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.slash_command_registry import (
    CommandCategory,
    SlashCommand,
    SlashCommandArg,
    SlashCommandRegistry,
)
from backend.app.services.slash_command_executor import (
    ExecutionContext,
    ExecutionResult,
    ExecutionStatus,
    SlashCommandExecutor,
    get_executor,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================


class ExecuteCommandRequest(BaseModel):
    """执行命令请求"""

    command: str = Field(..., description="命令名（不含 /），例如 'plan'")
    args: List[str] = Field(default_factory=list, description="参数列表")
    context: Optional[Dict[str, Any]] = Field(default=None, description="执行上下文")


class ToggleCommandRequest(BaseModel):
    """切换命令启用状态请求"""

    enabled: bool = Field(..., description="是否启用")


# ============================================================
# 端点
# ============================================================


@router.get("/summary")
async def get_registry_summary():
    """
    获取注册表摘要

    返回值：{
        total, enabled, disabled, built_in, custom, by_category
    }
    """
    registry = SlashCommandRegistry.get_instance()
    return registry.summary()


@router.get("/categories")
async def list_categories():
    """
    列出所有命令分类及每个分类下的命令数量

    返回值：{
        categories: [
            {name, label, count}
        ]
    }
    """
    registry = SlashCommandRegistry.get_instance()
    summary = registry.summary()

    category_labels = {
        CommandCategory.NAVIGATION: "导航与会话",
        CommandCategory.WORKSPACE: "工作区与项目",
        CommandCategory.MODE: "模式切换",
        CommandCategory.AGENT: "智能体管理",
        CommandCategory.UX: "显示与设置",
        CommandCategory.LOOP: "Loop Engineering",
        CommandCategory.CUSTOM: "用户自定义",
    }

    categories = []
    for cat in CommandCategory:
        cmds = registry.list_by_category(cat, enabled_only=False)
        enabled_cmds = [c for c in cmds if c.enabled]
        categories.append({
            "name": cat.value,
            "label": category_labels.get(cat, cat.value),
            "total": len(cmds),
            "enabled": len(enabled_cmds),
            "commands": [c.to_dict() for c in cmds],
        })

    return {
        "categories": categories,
        "summary": summary,
    }


@router.get("/search")
async def search_commands(
    q: str = Query("", description="搜索关键词"),
    enabled_only: bool = Query(True, description="仅返回启用的命令"),
    limit: int = Query(50, ge=1, le=200, description="返回数量上限"),
):
    """
    搜索命令

    参数：
      - q: 搜索关键词（按名称/描述/别名模糊匹配）
      - enabled_only: 是否只返回启用的命令
      - limit: 返回数量上限

    返回值：{
        query, total, commands
    }
    """
    registry = SlashCommandRegistry.get_instance()
    results = registry.search(q)
    if enabled_only:
        results = [c for c in results if c.enabled]
    results = results[:limit]
    return {
        "query": q,
        "total": len(results),
        "commands": [c.to_dict() for c in results],
    }


@router.get("")
async def list_commands(
    category: Optional[str] = Query(None, description="按分类过滤"),
    enabled_only: bool = Query(True, description="仅返回启用的命令"),
):
    """
    列出所有命令

    参数：
      - category: 按分类过滤 (navigation/workspace/mode/agent/ux/loop/custom)
      - enabled_only: 是否仅返回启用的命令

    返回值：{
        total, commands
    }
    """
    registry = SlashCommandRegistry.get_instance()

    if category:
        try:
            cat = CommandCategory(category)
            cmds = registry.list_by_category(cat, enabled_only=enabled_only)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"未知分类: {category}，有效分类: {[c.value for c in CommandCategory]}",
            )
    else:
        cmds = registry.list_all(enabled_only=enabled_only)

    return {
        "total": len(cmds),
        "category": category,
        "commands": [c.to_dict() for c in cmds],
    }


@router.get("/{name}")
async def get_command(name: str):
    """
    获取命令详情

    参数：
      - name: 命令名

    返回值：命令详细信息
    """
    registry = SlashCommandRegistry.get_instance()
    cmd = registry.get(name)
    if cmd is None:
        raise HTTPException(status_code=404, detail=f"未知命令: /{name}")
    return {
        "command": cmd.to_dict(),
    }


@router.post("/execute")
async def execute_command(request: ExecuteCommandRequest):
    """
    执行一个 Slash Command

    请求体：
      {
        "command": "plan",
        "args": ["实现 OAuth 2.1"],
        "context": {
          "user_id": "user-123",
          "session_id": "session-456",
          "project": "my-project",
          "app_mode": "coding"
        }
      }

    返回值：ExecutionResult
    """
    # 构造 ExecutionContext
    ctx_data = request.context or {}
    context = ExecutionContext(
        user_id=ctx_data.get("user_id"),
        session_id=ctx_data.get("session_id"),
        project=ctx_data.get("project"),
        app_mode=ctx_data.get("app_mode"),
        extra=ctx_data.get("extra", {}),
    )

    executor = get_executor()
    result = executor.execute(request.command, request.args, context)

    return result.to_dict()


@router.get("/history/list")
async def get_history(limit: int = Query(50, ge=1, le=500, description="返回数量上限")):
    """
    获取命令执行历史

    参数：
      - limit: 返回最近 N 条

    返回值：{
        total, history
    }
    """
    executor = get_executor()
    history = executor.get_history(limit=limit)
    return {
        "total": len(history),
        "limit": limit,
        "history": [h.to_dict() for h in history],
    }


@router.post("/history/clear")
async def clear_history():
    """
    清空命令执行历史

    返回值：清空结果
    """
    executor = get_executor()
    executor.clear_history()
    return {
        "success": True,
        "message": "已清空命令执行历史",
    }


@router.patch("/{name}/toggle")
async def toggle_command(name: str, request: ToggleCommandRequest):
    """
    启用/禁用命令

    参数：
      - name: 命令名
      - request: { enabled: bool }

    返回值：更新结果
    """
    registry = SlashCommandRegistry.get_instance()
    cmd = registry.get(name)
    if cmd is None:
        raise HTTPException(status_code=404, detail=f"未知命令: /{name}")

    # 找到原始命令并修改 enabled
    # 由于 SlashCommand 是 dataclass，这里直接修改其属性
    cmd.enabled = request.enabled
    return {
        "success": True,
        "command": cmd.to_dict(),
        "message": f"命令 /{name} 已{'启用' if request.enabled else '禁用'}",
    }


# ============================================================
# 帮助端点
# ============================================================


@router.get("/help/details")
async def get_help():
    """
    获取所有命令的帮助信息（用于 /help 命令）

    返回值：{
        total, categories: [{name, label, commands: [...]}]
    }
    """
    registry = SlashCommandRegistry.get_instance()
    all_cmds = registry.list_all(enabled_only=True)

    category_labels = {
        CommandCategory.NAVIGATION: "导航与会话",
        CommandCategory.WORKSPACE: "工作区与项目",
        CommandCategory.MODE: "模式切换",
        CommandCategory.AGENT: "智能体管理",
        CommandCategory.UX: "显示与设置",
        CommandCategory.LOOP: "Loop Engineering",
    }

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for cmd in all_cmds:
        cat_key = cmd.category.value
        if cat_key not in grouped:
            grouped[cat_key] = []
        grouped[cat_key].append({
            "name": cmd.name,
            "description": cmd.description,
            "shortcut": cmd.shortcut,
            "icon": cmd.icon,
            "args": [a.__dict__ for a in cmd.args],
        })

    categories = []
    for cat in CommandCategory:
        cmds = grouped.get(cat.value, [])
        if cmds:
            categories.append({
                "name": cat.value,
                "label": category_labels.get(cat, cat.value),
                "commands": cmds,
            })

    return {
        "total": len(all_cmds),
        "categories": categories,
    }
