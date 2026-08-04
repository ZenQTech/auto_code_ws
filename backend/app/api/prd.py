"""
# ============================================================
# PRD 生成器 API (v1.0.0)
# Cycle 63 G63-01
# ============================================================
# 核心作用：暴露 PRDManager 为 REST API
# 运行流程：
#   1. POST /api/prd/generate            生成新 PRD
#   2. GET  /api/prd/{prd_id}            获取 PRD 详情
#   3. POST /api/prd/{prd_id}/iterate    基于反馈迭代
#   4. POST /api/prd/{prd_id}/diff       计算 diff
#   5. GET  /api/prd/_list               列出所有 PRD
#   6. DELETE /api/prd/{prd_id}          删除 PRD
#   7. GET  /api/prd/_stats              统计信息
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# 注意：/_list 和 /_stats 必须放在 /{prd_id} 路由之前，避免路径冲突
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-01 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.prd_generator import (
    PRDManager,
    PRDNotFoundError,
    PRDValidationError,
    PRDRateLimitError,
    get_prd_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prd", tags=["prd"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class GenerateRequest(BaseModel):
    requirement: str = Field(..., min_length=10, max_length=10000)
    context: Optional[Dict[str, Any]] = None
    template: str = Field(default="default", max_length=64)
    user_id: str = Field(default="anonymous", max_length=128)


class IterateRequest(BaseModel):
    feedback: str = Field(..., min_length=5, max_length=5000)
    base_version: Optional[int] = Field(default=None, ge=1)
    user_id: str = Field(default="anonymous", max_length=128)


class DiffRequest(BaseModel):
    from_version: int = Field(..., ge=1)
    to_version: int = Field(..., ge=1)


# ============================================================
# API 端点
# ============================================================


@router.post("/generate")
async def generate_prd(req: GenerateRequest) -> Dict[str, Any]:
    """
    生成新 PRD

    请求体：
      {
        "requirement": "实现一个 Todo List 应用",
        "context": {"tech_stack": ["React"]},  // 可选
        "template": "default",                  // 可选
        "user_id": "user-123"                   // 可选（限流用）
      }

    响应：
      {
        "success": true,
        "prd": { ... PRDDocument ... },
        "version": 1
      }
    """
    manager = get_prd_manager()
    try:
        prd = await manager.generate_prd(
            requirement=req.requirement,
            context=req.context,
            template=req.template,
            user_id=req.user_id,
        )
    except PRDValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except PRDRateLimitError as e:
        raise HTTPException(
            status_code=429,
            detail=str(e),
            headers={"Retry-After": str(e.retry_after)},
        ) from e
    except Exception as e:  # noqa: BLE001
        logger.exception(f"generate_prd 失败: {e}")
        raise HTTPException(status_code=500, detail=f"生成失败: {e}") from e

    return {
        "success": True,
        "prd": prd.to_dict(),
        "version": prd.version,
    }


# ============================================================
# 静态路径端点（必须放在 /{prd_id} 之前）
# ============================================================


@router.get("/_list")
async def list_prds() -> Dict[str, Any]:
    """
    列出所有 PRD（仅元信息）

    使用 /_list 而非 /list，避免与 /{prd_id} 路径冲突

    响应：
      {
        "success": true,
        "prds": [
          { "prd_id": "prd-abc", "title": "...", "current_version": 2, "updated_at": ... }
        ],
        "total": int
      }
    """
    manager = get_prd_manager()
    prds = manager.list_prds()
    return {
        "success": True,
        "prds": prds,
        "total": len(prds),
    }


@router.get("/_stats")
async def get_stats() -> Dict[str, Any]:
    """
    统计信息

    响应：
      {
        "success": true,
        "stats": {
          "total_prds": int,
          "total_versions": int,
          "rate_limit_per_hour": int
        }
      }
    """
    manager = get_prd_manager()
    return {
        "success": True,
        "stats": manager.get_stats(),
    }


# ============================================================
# 动态路径端点
# ============================================================


@router.get("/{prd_id}")
async def get_prd(
    prd_id: str,
    version: Optional[int] = Query(default=None, ge=1),
    include_history: bool = Query(default=False),
) -> Dict[str, Any]:
    """
    获取 PRD 详情

    查询参数：
      - version: 指定版本（默认最新）
      - include_history: 是否包含历史版本

    响应：
      {
        "success": true,
        "prd": { ... PRDDocument ... },
        "current_version": int,
        "history": [ ... PRDVersion ... ]  // 仅 include_history=true
      }
    """
    manager = get_prd_manager()
    try:
        content, versions = manager.get_prd(prd_id, version=version)
    except PRDNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    response = {
        "success": True,
        "prd": content.to_dict(),
        "current_version": versions[-1].version,
    }
    if include_history:
        response["history"] = [v.to_dict() for v in versions]
    return response


@router.post("/{prd_id}/iterate")
async def iterate_prd(prd_id: str, req: IterateRequest) -> Dict[str, Any]:
    """
    基于反馈迭代 PRD

    请求体：
      {
        "feedback": "增加用户登录功能",
        "base_version": 1,  // 可选，默认最新
        "user_id": "user-123"
      }

    响应：
      {
        "success": true,
        "prd": { ... PRDDocument v2 ... },
        "version": 2,
        "diff": [ ... DiffOps ... ]
      }
    """
    manager = get_prd_manager()
    try:
        new_prd, diff_ops = await manager.iterate_prd(
            prd_id=prd_id,
            feedback=req.feedback,
            base_version=req.base_version,
            user_id=req.user_id,
        )
    except PRDNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PRDValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except PRDRateLimitError as e:
        raise HTTPException(
            status_code=429,
            detail=str(e),
            headers={"Retry-After": str(e.retry_after)},
        ) from e
    except Exception as e:  # noqa: BLE001
        logger.exception(f"iterate_prd 失败: {e}")
        raise HTTPException(status_code=500, detail=f"迭代失败: {e}") from e

    return {
        "success": True,
        "prd": new_prd.to_dict(),
        "version": new_prd.version,
        "diff": [d.to_dict() for d in diff_ops],
    }


@router.post("/{prd_id}/diff")
async def diff_prd(prd_id: str, req: DiffRequest) -> Dict[str, Any]:
    """
    计算两个版本之间的 diff

    请求体：
      {
        "from_version": 1,
        "to_version": 2
      }

    响应：
      {
        "success": true,
        "diff": [ ... DiffOps ... ],
        "summary": "新增 1 项，删除 0 项，修改 2 项"
      }
    """
    manager = get_prd_manager()
    try:
        diff_ops = manager.compute_diff(
            prd_id=prd_id,
            from_version=req.from_version,
            to_version=req.to_version,
        )
    except PRDNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return {
        "success": True,
        "diff": [d.to_dict() for d in diff_ops],
        "summary": _summarize_diff_inline(diff_ops),
    }


@router.delete("/{prd_id}")
async def delete_prd(prd_id: str) -> Dict[str, Any]:
    """删除 PRD"""
    manager = get_prd_manager()
    success = manager.delete_prd(prd_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"PRD 不存在: {prd_id}")
    return {"success": True, "prd_id": prd_id}


# ============================================================
# 工具函数
# ============================================================


def _summarize_diff_inline(diff_ops: List[Any]) -> str:
    """生成 diff 摘要"""
    if not diff_ops:
        return "无变化"
    added = sum(1 for d in diff_ops if d.op == "added")
    removed = sum(1 for d in diff_ops if d.op == "removed")
    modified = sum(1 for d in diff_ops if d.op == "modified")
    return f"新增 {added} 项，删除 {removed} 项，修改 {modified} 项"
