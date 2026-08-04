"""
# ============================================================
# AGENTS.md / CLAUDE.md 指令加载 API (v1.0.0)
# Cycle 62 G62-04
# ====================================
# 核心作用：暴露 AgentsInstructionLoader 为 REST API
# 运行流程：
#   1. GET  /api/agents/load?project_path=...  加载项目指令
#   2. POST /api/agents/reload                强制重新加载
#   3. GET  /api/agents/system-prompt         获取合并后的 system prompt
#   4. GET  /api/agents/stats                 加载器统计
#   5. POST /api/agents/invalidate            清除缓存
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-04 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.agents_loader import (
    AgentsInstructionLoader,
    InstructionSet,
    get_loader,
    reset_loader,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents-loader"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class LoadAgentsRequest(BaseModel):
    project_path: str = Field(..., min_length=1, max_length=4096)
    force: bool = False


class SystemPromptRequest(BaseModel):
    project_path: str = Field(..., min_length=1, max_length=4096)
    base_prompt: str = Field(default="", max_length=10000)


# ============================================================
# API 端点
# ============================================================


@router.post("/load")
async def load_agents(req: LoadAgentsRequest) -> Dict[str, Any]:
    """
    加载项目的所有 AGENTS.md / CLAUDE.md 指令文件

    请求体：{"project_path": "/path/to/project", "force": false}
    响应：{"success": true, "instruction_set": {...}}
    """
    loader = get_loader()
    try:
        inst_set = loader.load(req.project_path, force=req.force)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"load_agents 失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"加载失败: {e}",
        ) from e
    return {
        "success": True,
        "instruction_set": inst_set.to_dict(),
    }


@router.post("/reload")
async def reload_agents(req: LoadAgentsRequest) -> Dict[str, Any]:
    """强制重新加载（忽略缓存）"""
    loader = get_loader()
    inst_set = loader.reload(req.project_path)
    return {
        "success": True,
        "instruction_set": inst_set.to_dict(),
    }


@router.get("/load")
async def load_agents_get(
    project_path: str = Query(..., min_length=1, max_length=4096),
    force: bool = Query(default=False),
) -> Dict[str, Any]:
    """GET 形式的加载接口（便于浏览器直接访问）"""
    loader = get_loader()
    inst_set = loader.load(project_path, force=force)
    return {
        "success": True,
        "instruction_set": inst_set.to_dict(),
    }


@router.post("/system-prompt")
async def build_system_prompt(req: SystemPromptRequest) -> Dict[str, Any]:
    """
    构建合并后的 system prompt

    请求体：{"project_path": "...", "base_prompt": "..."}
    响应：{"success": true, "system_prompt": "...", "char_count": N}
    """
    loader = get_loader()
    try:
        prompt = loader.build_system_prompt(
            req.project_path, base_prompt=req.base_prompt,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(f"build_system_prompt 失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"构建失败: {e}",
        ) from e
    return {
        "success": True,
        "system_prompt": prompt,
        "char_count": len(prompt),
    }


@router.get("/system-prompt")
async def build_system_prompt_get(
    project_path: str = Query(..., min_length=1, max_length=4096),
    base_prompt: str = Query(default="", max_length=10000),
) -> Dict[str, Any]:
    """GET 形式"""
    loader = get_loader()
    prompt = loader.build_system_prompt(
        project_path, base_prompt=base_prompt,
    )
    return {
        "success": True,
        "system_prompt": prompt,
        "char_count": len(prompt),
    }


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """获取加载器统计信息"""
    loader = get_loader()
    return {
        "success": True,
        "stats": loader.get_stats(),
    }


@router.post("/invalidate")
async def invalidate_cache(req: LoadAgentsRequest) -> Dict[str, Any]:
    """清除指定项目的缓存"""
    loader = get_loader()
    removed = loader.invalidate(req.project_path)
    return {
        "success": True,
        "removed": removed,
        "project_path": req.project_path,
    }


@router.post("/reset")
async def reset() -> Dict[str, Any]:
    """重置全局单例（主要用于测试）"""
    reset_loader()
    return {"success": True}
