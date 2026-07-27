"""
# ============================================================
# AGENTS.md Memory API 路由
# ============================================================
# 端点：
#   - POST   /api/agents-md/scan              扫描项目 AGENTS.md
#   - GET    /api/agents-md/list              列出已加载的
#   - GET    /api/agents-md/{id}              获取单个详情
#   - POST   /api/agents-md/{id}/enable       启用
#   - POST   /api/agents-md/{id}/disable      禁用
#   - GET    /api/agents-md/inject/preview    预览注入块
#   - POST   /api/rules/scan                  多类型规则扫描（Cycle 3）
#   - GET    /api/rules/list                  列出所有规则（Cycle 3）
#   - GET    /api/rules/preview               预览合并后的注入（Cycle 3）
#   - GET    /api/rules/conflicts             冲突检测（Cycle 3）
# 创建日期：2026-07-27
# 模块版本：v1.1.0 - Cycle 3 多文件类型 + 4 层架构
# ============================================================
"""

import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Request, Query

from backend.app.services.rules_resolver import get_rules_resolver

logger = logging.getLogger(__name__)
router = APIRouter()


def get_agents_md_service(request: Request):
    svc = getattr(request.app.state, "agents_md_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="AgentsMdMemoryService 未初始化")
    return svc


@router.post("/agents-md/scan")
async def scan_agents_md(
    request: Request,
    body: Dict[str, Any],
):
    """扫描项目 AGENTS.md"""
    svc = get_agents_md_service(request)
    project_path = body.get("project_path", "")
    max_depth = body.get("max_depth", 3)
    include_subdirs = body.get("include_subdirs", True)
    if not project_path:
        raise HTTPException(status_code=400, detail="project_path 不能为空")
    memories = svc.scan_project(
        project_path=project_path,
        max_depth=max_depth,
        include_subdirs=include_subdirs,
    )
    return {
        "success": True,
        "project_path": project_path,
        "found_count": len(memories),
        "memories": [
            {k: v for k, v in m.items() if k != "content"} for m in memories
        ],
    }


@router.get("/agents-md/list")
async def list_agents_md(
    request: Request,
    enabled_only: bool = Query(False),
):
    """列出 AGENTS.md 记忆"""
    svc = get_agents_md_service(request)
    items = svc.list_memories(enabled_only=enabled_only)
    # 排除 content 以减少响应大小
    return {
        "success": True,
        "memories": [
            {k: v for k, v in m.items() if k != "content"} for m in items
        ],
        "count": len(items),
    }


@router.get("/agents-md/{memory_id}")
async def get_agents_md(memory_id: str, request: Request):
    """获取单个 AGENTS.md 详情（含内容）"""
    svc = get_agents_md_service(request)
    mem = svc.get_memory(memory_id)
    if not mem:
        raise HTTPException(status_code=404, detail=f"AGENTS.md 不存在: {memory_id}")
    return {"success": True, "memory": mem}


@router.post("/agents-md/{memory_id}/enable")
async def enable_agents_md(memory_id: str, request: Request):
    """启用 AGENTS.md"""
    svc = get_agents_md_service(request)
    mem = svc.set_enabled(memory_id, True)
    if not mem:
        raise HTTPException(status_code=404, detail=f"AGENTS.md 不存在: {memory_id}")
    return {"success": True, "memory": {k: v for k, v in mem.items() if k != "content"}}


@router.post("/agents-md/{memory_id}/disable")
async def disable_agents_md(memory_id: str, request: Request):
    """禁用 AGENTS.md"""
    svc = get_agents_md_service(request)
    mem = svc.set_enabled(memory_id, False)
    if not mem:
        raise HTTPException(status_code=404, detail=f"AGENTS.md 不存在: {memory_id}")
    return {"success": True, "memory": {k: v for k, v in mem.items() if k != "content"}}


@router.get("/agents-md/inject/preview")
async def preview_inject(request: Request):
    """预览注入块"""
    svc = get_agents_md_service(request)
    block = svc.build_injection_block()
    return {
        "success": True,
        "injection": block,
        "length": len(block),
        "enabled_count": len([m for m in svc.list_memories() if m.get("enabled")]),
    }


# ============================================================
# Cycle 3 v1.0.0: 多文件类型规则（AGENTS.md/CLAUDE.md 等）
# ============================================================

@router.post("/rules/scan")
async def scan_rules(
    request: Request,
    body: Dict[str, Any],
):
    """
    Cycle 3 v1.0.0: 扫描多类型规则文件
    """
    project_path = body.get("project_path", "")
    file_types = body.get("file_types")
    max_depth = body.get("max_depth", 3)
    include_user_layer = body.get("include_user_layer", True)
    if not project_path:
        raise HTTPException(status_code=400, detail="project_path 不能为空")
    resolver = get_rules_resolver()
    rules = resolver.scan(
        project_path=project_path,
        file_types=file_types,
        max_depth=max_depth,
        include_user_layer=include_user_layer,
    )
    return {
        "success": True,
        "project_path": project_path,
        "rules": rules,
        "count": len(rules),
    }


@router.get("/rules/list")
async def list_rules(
    project_path: Optional[str] = None,
    enabled_only: bool = False,
):
    """
    Cycle 3 v1.0.0: 列出所有规则
    """
    resolver = get_rules_resolver()
    rules = resolver.list_rules(project_path=project_path, enabled_only=enabled_only)
    return {
        "success": True,
        "rules": rules,
        "count": len(rules),
    }


@router.get("/rules/preview")
async def preview_rules(
    project_path: str,
    max_total_size: int = 16000,
):
    """
    Cycle 3 v1.0.0: 预览合并后的规则内容
    """
    resolver = get_rules_resolver()
    result = resolver.merge_rules(
        project_path=project_path,
        max_total_size=max_total_size,
    )
    return {
        "success": True,
        **result,
    }


@router.get("/rules/conflicts")
async def rules_conflicts(project_path: str):
    """
    Cycle 3 v1.0.0: 检测规则冲突
    """
    resolver = get_rules_resolver()
    conflicts = resolver.detect_conflicts(project_path=project_path)
    return {
        "success": True,
        "conflicts": conflicts,
        "count": len(conflicts),
    }


@router.post("/rules/{rule_id}/enable")
async def enable_rule(rule_id: str):
    """Cycle 3 v1.0.0: 启用规则"""
    resolver = get_rules_resolver()
    success = resolver.enable(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"规则不存在: {rule_id}")
    return {"success": True}


@router.post("/rules/{rule_id}/disable")
async def disable_rule(rule_id: str):
    """Cycle 3 v1.0.0: 禁用规则"""
    resolver = get_rules_resolver()
    success = resolver.disable(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"规则不存在: {rule_id}")
    return {"success": True}
