"""
# ============================================================
# Hermes Worktree v2 - REST API
# ============================================================
# 核心作用：提供 Worktree v2 隔离执行系统的 REST API
# 端点：
#   - GET  /health                            健康检查
#   - GET  /list                              列出 Worktree
#   - GET  /stats                             统计信息
#   - GET  /expired                           过期 Worktree
#   - POST /create                            创建 Worktree
#   - POST /batch/merge                       批量合并（必须在 {worktree_id} 之前）
#   - POST /batch/cleanup                     批量清理
#   - POST /scan/expired                      扫描过期
#   - GET  /{worktree_id}                     Worktree 详情
#   - GET  /{worktree_id}/state               状态查询
#   - PUT  /{worktree_id}/state               状态转换
#   - POST /{worktree_id}/commit              提交更改
#   - POST /{worktree_id}/merge               合并
#   - POST /{worktree_id}/resolve             冲突解决
#   - POST /{worktree_id}/cleanup             清理
#   - GET  /{worktree_id}/metrics             指标
#   - GET  /{worktree_id}/lifecycle           生命周期摘要
# 修改记录：
#   - 2026-07-28 | v2.0.0 | Cycle 13 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.worktree import (
    WorktreeManager,
    WorktreeStatus,
    WorktreeState,
    get_worktree_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/worktree", tags=["worktree-v2"])


# ============================================================
# Pydantic 模型
# ============================================================
class CreateWorktreeRequest(BaseModel):
    """创建 Worktree 请求"""
    task_id: str = Field(..., description="任务 ID")
    module_name: str = Field(..., description="模块名")
    instance_id: str = Field("", description="CLI 实例 ID")
    repo_path: str = Field("", description="主仓库路径")
    worktree_base: str = Field("", description="Worktree 基础目录")
    ttl_hours: int = Field(24, description="过期时长（小时）")
    tags: List[str] = Field(default_factory=list, description="标签")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


class StateTransitionRequest(BaseModel):
    """状态转换请求"""
    new_status: str = Field(..., description="新状态")
    note: str = Field("", description="备注")


class CommitRequest(BaseModel):
    """提交请求"""
    message: str = Field("", description="提交信息")
    actor: str = Field("instance", description="提交者")


class MergeRequest(BaseModel):
    """合并请求"""
    target_branch: str = Field("main", description="目标分支")
    strategy: str = Field("auto", description="合并策略")
    no_ff: bool = Field(True, description="是否创建合并提交")


class ResolveRequest(BaseModel):
    """冲突解决请求"""
    strategy: str = Field("ai_assisted", description="解决策略")


class CleanupRequest(BaseModel):
    """清理请求"""
    archive: bool = Field(True, description="是否归档")


class BatchWorktreeRequest(BaseModel):
    """批量操作请求"""
    worktree_ids: List[str] = Field(..., description="Worktree ID 列表")
    target_branch: str = Field("main", description="目标分支")
    strategy: str = Field("auto", description="合并策略")
    archive: bool = Field(True, description="是否归档")


# ============================================================
# 工具函数
# ============================================================
def _get_manager() -> WorktreeManager:
    return get_worktree_manager()


def _state_to_dict(wt: WorktreeState) -> Dict[str, Any]:
    return wt.to_dict()


# ============================================================
# 端点实现（注意：固定路径必须在动态路径之前注册）
# ============================================================
@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    mgr = _get_manager()
    return mgr.health_check()


@router.get("/list")
async def list_worktrees(
    status: Optional[str] = Query(None, description="按状态过滤"),
    module: Optional[str] = Query(None, description="按模块过滤"),
    task_id: Optional[str] = Query(None, description="按任务过滤"),
    only_active: bool = Query(False, description="仅活跃"),
) -> Dict[str, Any]:
    """列出 Worktree"""
    mgr = _get_manager()
    status_enum = None
    if status:
        try:
            status_enum = WorktreeStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    worktrees = mgr.list(
        status=status_enum,
        module=module,
        task_id=task_id,
        only_active=only_active,
    )
    return {
        "success": True,
        "total": len(worktrees),
        "worktrees": [_state_to_dict(w) for w in worktrees],
    }


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """统计信息"""
    mgr = _get_manager()
    return {
        "success": True,
        "stats": mgr.get_stats(),
    }


@router.get("/expired")
async def get_expired() -> Dict[str, Any]:
    """列出过期 Worktree"""
    mgr = _get_manager()
    expired = mgr.scan_expired()
    return {
        "success": True,
        "total": len(expired),
        "expired": [_state_to_dict(w) for w in expired],
    }


@router.post("/create")
async def create_worktree(req: CreateWorktreeRequest) -> Dict[str, Any]:
    """创建 Worktree"""
    mgr = _get_manager()
    try:
        wt = mgr.create(
            task_id=req.task_id,
            module_name=req.module_name,
            instance_id=req.instance_id,
            repo_path=req.repo_path,
            worktree_base=req.worktree_base,
            ttl_hours=req.ttl_hours,
            tags=req.tags,
            metadata=req.metadata,
        )
        return {
            "success": True,
            "worktree": _state_to_dict(wt),
            "message": f"Worktree {wt.worktree_id} created",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Create worktree failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 批量操作端点（必须在动态路径之前）
@router.post("/batch/merge")
async def batch_merge(req: BatchWorktreeRequest) -> Dict[str, Any]:
    """批量合并"""
    mgr = _get_manager()
    results = mgr.merger.batch_merge(
        req.worktree_ids,
        target_branch=req.target_branch,
        strategy=req.strategy,
    )
    return {
        "success": True,
        "total": len(results),
        "succeeded": sum(1 for r in results if r.success),
        "failed": sum(1 for r in results if not r.success),
        "results": [r.to_dict() for r in results],
    }


@router.post("/batch/cleanup")
async def batch_cleanup(req: BatchWorktreeRequest) -> Dict[str, Any]:
    """批量清理"""
    mgr = _get_manager()
    results = mgr.cleanup_batch(req.worktree_ids, archive=req.archive)
    return {
        "success": True,
        "total": len(results),
        "results": [_state_to_dict(w) for w in results],
    }


@router.post("/scan/expired")
async def scan_expired() -> Dict[str, Any]:
    """扫描并自动转换过期 Worktree"""
    mgr = _get_manager()
    expired = mgr.scan_expired()
    return {
        "success": True,
        "expired_count": len(expired),
        "expired": [_state_to_dict(w) for w in expired],
    }


# 动态路径端点（必须放在最后）
@router.get("/{worktree_id}")
async def get_worktree(worktree_id: str) -> Dict[str, Any]:
    """Worktree 详情"""
    mgr = _get_manager()
    wt = mgr.get(worktree_id)
    if wt is None:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")
    return {
        "success": True,
        "worktree": _state_to_dict(wt),
    }


@router.get("/{worktree_id}/state")
async def get_state(worktree_id: str) -> Dict[str, Any]:
    """状态查询"""
    mgr = _get_manager()
    try:
        wt = mgr.get_or_raise(worktree_id)
        return {
            "success": True,
            "worktree_id": wt.worktree_id,
            "status": wt.status.value,
            "is_terminal": wt.is_terminal(),
            "created_at": wt.created_at,
            "activated_at": wt.activated_at,
            "completed_at": wt.completed_at,
            "expires_at": wt.expires_at,
            "last_activity_at": wt.last_activity_at,
            "ttl_hours": wt.ttl_hours,
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")


@router.put("/{worktree_id}/state")
async def transition_state(worktree_id: str, req: StateTransitionRequest) -> Dict[str, Any]:
    """状态转换"""
    mgr = _get_manager()
    try:
        new_status = WorktreeStatus(req.new_status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {req.new_status}")
    try:
        wt = mgr.transition(worktree_id, new_status, note=req.note)
        return {
            "success": True,
            "worktree": _state_to_dict(wt),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{worktree_id}/commit")
async def commit_worktree(worktree_id: str, req: CommitRequest) -> Dict[str, Any]:
    """提交更改"""
    mgr = _get_manager()
    try:
        wt = mgr.commit(worktree_id, message=req.message, actor=req.actor)
        return {
            "success": True,
            "worktree_id": wt.worktree_id,
            "metrics": wt.metrics.to_dict(),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")


@router.post("/{worktree_id}/merge")
async def merge_worktree(worktree_id: str, req: MergeRequest) -> Dict[str, Any]:
    """合并 Worktree"""
    mgr = _get_manager()
    try:
        result = mgr.merge(
            worktree_id,
            target_branch=req.target_branch,
            strategy=req.strategy,
        )
        return {
            "success": result.success,
            "result": result.to_dict(),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")


@router.post("/{worktree_id}/resolve")
async def resolve_conflict(worktree_id: str, req: ResolveRequest) -> Dict[str, Any]:
    """冲突解决"""
    mgr = _get_manager()
    try:
        wt = mgr.resolve_conflict(worktree_id, strategy=req.strategy)
        return {
            "success": True,
            "worktree": _state_to_dict(wt),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{worktree_id}/cleanup")
async def cleanup_worktree(worktree_id: str, req: CleanupRequest) -> Dict[str, Any]:
    """清理 Worktree"""
    mgr = _get_manager()
    try:
        wt = mgr.cleanup(worktree_id, archive=req.archive)
        return {
            "success": True,
            "worktree": _state_to_dict(wt),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{worktree_id}/metrics")
async def get_metrics(worktree_id: str) -> Dict[str, Any]:
    """Worktree 指标"""
    mgr = _get_manager()
    try:
        return {
            "success": True,
            "metrics": mgr.get_metrics(worktree_id),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")


@router.get("/{worktree_id}/lifecycle")
async def get_lifecycle(worktree_id: str) -> Dict[str, Any]:
    """生命周期摘要"""
    mgr = _get_manager()
    try:
        wt = mgr.get_or_raise(worktree_id)
        return {
            "success": True,
            "lifecycle": mgr.lifecycle.get_lifecycle_summary(worktree_id),
            "events": [e.to_dict() for e in wt.events[-20:]],  # 最近 20 个事件
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Worktree not found: {worktree_id}")
