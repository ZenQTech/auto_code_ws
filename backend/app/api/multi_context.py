"""
# ============================================================
# 多源上下文选择器 API (v1.0.0)
# Cycle 62 G62-02
# ====================================
# 核心作用：暴露 ContextManager 为 REST API
# 运行流程：
#   1. POST /api/context/items            添加上下文项到 bundle
#   2. GET  /api/context/bundles          列出所有 bundles
#   3. GET  /api/context/bundles/{id}     获取指定 bundle 详情
#   4. DELETE /api/context/bundles/{id}   删除 bundle
#   5. DELETE /api/context/items/{bid}/{iid}  从 bundle 移除项
#   6. GET  /api/context/stats            统计信息
#   7. POST /api/context/reset            重置（测试用）
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-02 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.multi_context import (
    ContextBundle,
    ContextItem,
    ContextManager,
    ContextSourceType,
    get_context_manager,
    reset_context_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/context", tags=["multi-context"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class AddItemRequest(BaseModel):
    """添加上下文项请求"""
    bundle_id: str = Field(..., min_length=1, max_length=128)
    source_type: str = Field(..., min_length=1, max_length=32)
    source_data: Dict[str, Any] = Field(default_factory=dict)


class AddItemResponse(BaseModel):
    """添加上下文项响应"""
    success: bool
    item: Dict[str, Any]
    bundle: Dict[str, Any]


class BundleListResponse(BaseModel):
    """bundle 列表响应"""
    success: bool
    bundles: list
    count: int


class BundleDetailResponse(BaseModel):
    """bundle 详情响应"""
    success: bool
    bundle: Dict[str, Any]


class DeleteResponse(BaseModel):
    """删除响应"""
    success: bool
    removed: bool


class StatsResponse(BaseModel):
    """统计响应"""
    success: bool
    stats: Dict[str, Any]


# ============================================================
# 辅助函数
# ============================================================


def _parse_source_type(s: str) -> ContextSourceType:
    """解析源类型（容错）"""
    try:
        return ContextSourceType(s)
    except ValueError:
        valid = [t.value for t in ContextSourceType]
        raise HTTPException(
            status_code=400,
            detail=f"无效 source_type: {s}，有效值: {valid}",
        ) from None


# ============================================================
# API 端点
# ============================================================


@router.post("/items")
async def add_item(req: AddItemRequest) -> Dict[str, Any]:
    """
    添加上下文项到指定 bundle

    请求体：
      {
        "bundle_id": "user-123",
        "source_type": "file",
        "source_data": {"path": "/abs/path"}
      }
    响应：
      {
        "success": true,
        "item": {...},
        "bundle": {...}
      }
    """
    manager = get_context_manager()
    source_type = _parse_source_type(req.source_type)
    try:
        item = await manager.add_item(
            bundle_id=req.bundle_id,
            source_type=source_type,
            source_data=req.source_data,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(f"add_item 失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"添加失败: {e}",
        ) from e
    bundle = manager.get_bundle(req.bundle_id)
    return {
        "success": True,
        "item": item.to_dict(),
        "bundle": bundle.to_dict() if bundle else None,
    }


@router.get("/bundles")
async def list_bundles() -> Dict[str, Any]:
    """
    列出所有 bundles

    响应：{"success": true, "bundles": [...], "count": N}
    """
    manager = get_context_manager()
    bundles = manager.list_bundles()
    return {
        "success": True,
        "bundles": [b.to_dict() for b in bundles],
        "count": len(bundles),
    }


@router.get("/bundles/{bundle_id}")
async def get_bundle(bundle_id: str) -> Dict[str, Any]:
    """获取指定 bundle 详情"""
    manager = get_context_manager()
    bundle = manager.get_bundle(bundle_id)
    if not bundle:
        raise HTTPException(
            status_code=404,
            detail=f"bundle 不存在: {bundle_id}",
        )
    return {
        "success": True,
        "bundle": bundle.to_dict(),
    }


@router.delete("/bundles/{bundle_id}")
async def delete_bundle(bundle_id: str) -> Dict[str, Any]:
    """删除 bundle"""
    manager = get_context_manager()
    removed = await manager.delete_bundle(bundle_id)
    return {
        "success": True,
        "removed": removed,
        "bundle_id": bundle_id,
    }


@router.delete("/bundles/{bundle_id}/items/{item_id}")
async def remove_item(bundle_id: str, item_id: str) -> Dict[str, Any]:
    """从 bundle 移除 item"""
    manager = get_context_manager()
    removed = await manager.remove_item(bundle_id, item_id)
    return {
        "success": True,
        "removed": removed,
        "bundle_id": bundle_id,
        "item_id": item_id,
    }


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """统计信息"""
    manager = get_context_manager()
    return {
        "success": True,
        "stats": manager.get_stats(),
    }


@router.post("/reset")
async def reset() -> Dict[str, Any]:
    """重置全局管理器（测试用）"""
    reset_context_manager()
    return {"success": True}
