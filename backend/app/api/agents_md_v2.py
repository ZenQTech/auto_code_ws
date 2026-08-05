"""
# ============================================================
# AGENTS.md v2 API 路由
# Cycle 70 G70-01 - 对标 Codex CLI AGENTS.md 多层级发现
# ============================================================
# 端点：
#   - POST   /api/agents-md-v2/load              加载多层级拼接结果
#   - GET    /api/agents-md-v2/config            获取配置
#   - PUT    /api/agents-md-v2/config            更新配置
#   - POST   /api/agents-md-v2/detect-root       检测项目根
# 创建日期：2026-08-05
# 模块版本：v1.0.0
# ============================================================
"""

import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Request

from backend.app.services.agents_md_resolver import (
    AgentsMdConfig,
    get_agents_md_resolver,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def get_resolver():
    """获取 resolver 单例"""
    return get_agents_md_resolver()


@router.post("/agents-md-v2/load")
async def load_agents_md(body: Dict[str, Any]):
    """加载给定 cwd 的 AGENTS.md 多层级拼接结果

    请求体：
      {
        "cwd": "/path/to/cwd",
        "config": {  // 可选，覆盖持久化配置
          "max_bytes": 32768,
          "max_depth": 10,
          "fallback_filenames": [...],
          "project_root_markers": [...],
          "developer_instructions": "..."
        }
      }
    """
    resolver = get_resolver()
    cwd = body.get("cwd", "").strip()
    if not cwd:
        raise HTTPException(status_code=400, detail="cwd 字段不能为空")

    config_data = body.get("config")
    config = None
    if config_data:
        try:
            config = AgentsMdConfig.from_dict(config_data)
        except (ValueError, TypeError) as e:
            raise HTTPException(status_code=400, detail=f"配置参数非法: {e}")

    try:
        result = resolver.resolve(cwd, config=config)
        return {"success": True, **result.to_dict()}
    except (OSError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"加载失败: {e}")


@router.get("/agents-md-v2/config")
async def get_config():
    """获取当前 AGENTS.md 配置"""
    resolver = get_resolver()
    return {
        "success": True,
        "config": resolver.get_config().to_dict(),
    }


@router.put("/agents-md-v2/config")
async def update_config(body: Dict[str, Any]):
    """更新 AGENTS.md 配置（部分字段更新）"""
    resolver = get_resolver()
    try:
        new_config = resolver.update_config(body)
        return {"success": True, "config": new_config.to_dict()}
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"配置更新失败: {e}")


@router.post("/agents-md-v2/detect-root")
async def detect_root(body: Dict[str, Any]):
    """从给定路径向上检测项目根

    请求体：
      {
        "cwd": "/path/to/dir",
        "markers": [".git", ".hg"]  // 可选
      }
    """
    resolver = get_resolver()
    cwd = body.get("cwd", "").strip()
    if not cwd:
        raise HTTPException(status_code=400, detail="cwd 字段不能为空")

    markers = body.get("markers")
    project_root, matched = resolver.detect_project_root(cwd, markers=markers)

    return {
        "success": True,
        "cwd": cwd,
        "project_root": project_root,
        "matched_marker": matched,
    }
