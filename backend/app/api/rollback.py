"""
# ============================================================
# Rollback API 端点 (v1.0.0)
# Cycle 61 G61-07
# ============================================================
# 核心作用：暴露 RollbackManager 为 REST API
# 运行流程：
#   1. POST /api/rollback/snapshots            创建快照
#   2. GET  /api/rollback/snapshots            列出快照
#   3. GET  /api/rollback/snapshots/{id}       快照详情
#   4. POST /api/rollback/rollback             回退（按 commit hash）
#   5. POST /api/rollback/rollback-by-snapshot 按 snapshot_id 回退
#   6. POST /api/rollback/rollback-batch       批量回退
#   7. GET  /api/rollback/git-log              git log
#   8. GET  /api/rollback/history              回退历史
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-07 初次创建
# ====================================
"""

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.rollback import (
    RollbackResult,
    Snapshot,
    SnapshotSource,
    get_manager,
    reset_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rollback", tags=["rollback"])


# ============================================================
# 数据模型
# ============================================================


class CreateSnapshotRequest(BaseModel):
    """创建快照请求"""
    repo_path: str = Field(..., min_length=1, max_length=4096)
    message: str = Field(..., min_length=1, max_length=500)
    source: str = Field(default="manual")
    plan_id: Optional[str] = Field(default=None, max_length=128)
    step_id: Optional[str] = Field(default=None, max_length=128)
    author: str = Field(default="hermes", max_length=128)
    add_all: bool = Field(default=True)


class SnapshotResponse(BaseModel):
    """快照响应"""
    snapshot: Dict[str, Any]


class SnapshotListResponse(BaseModel):
    """快照列表响应"""
    count: int
    snapshots: List[Dict[str, Any]]


class RollbackRequest(BaseModel):
    """回退请求"""
    repo_path: str = Field(..., min_length=1, max_length=4096)
    commit_hash: str = Field(..., min_length=4, max_length=128)
    message: Optional[str] = Field(default=None, max_length=500)


class RollbackBySnapshotRequest(BaseModel):
    """按 snapshot_id 回退请求"""
    repo_path: str = Field(..., min_length=1, max_length=4096)
    snapshot_id: str = Field(..., min_length=1, max_length=128)
    message: Optional[str] = Field(default=None, max_length=500)


class RollbackBatchRequest(BaseModel):
    """批量回退请求"""
    repo_path: str = Field(..., min_length=1, max_length=4096)
    commit_hashes: List[str] = Field(..., min_items=1, max_items=20)


class RollbackResultResponse(BaseModel):
    """回退结果响应"""
    result: Dict[str, Any]


class RollbackBatchResponse(BaseModel):
    """批量回退结果响应"""
    count: int
    results: List[Dict[str, Any]]
    all_success: bool


class GitLogEntry(BaseModel):
    """git log 条目"""
    commit_hash: str
    short_hash: str
    message: str
    author: str
    timestamp: int


class GitLogResponse(BaseModel):
    """git log 响应"""
    repo_path: str
    count: int
    entries: List[Dict[str, Any]]


# ============================================================
# 端点
# ============================================================


@router.post("/snapshots", response_model=SnapshotResponse)
async def create_snapshot(req: CreateSnapshotRequest):
    """
    创建代码快照（git add + commit）

    输入参数：CreateSnapshotRequest
    输出结果：SnapshotResponse
    """
    try:
        source = SnapshotSource(req.source)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的 source: {req.source}")

    manager = get_manager()
    snap = await manager.create_snapshot(
        repo_path=req.repo_path,
        message=req.message,
        source=source,
        plan_id=req.plan_id,
        step_id=req.step_id,
        author=req.author,
        add_all=req.add_all,
    )
    if snap is None:
        raise HTTPException(
            status_code=400,
            detail="创建快照失败（路径无效 / 非 git 仓库 / 无变更 / commit 失败）",
        )
    return SnapshotResponse(snapshot=snap.to_dict())


@router.get("/snapshots", response_model=SnapshotListResponse)
async def list_snapshots(
    plan_id: Optional[str] = Query(default=None, max_length=128),
    limit: int = Query(default=50, ge=1, le=200),
):
    """列出快照"""
    manager = get_manager()
    snaps = manager.list_snapshots(plan_id=plan_id, limit=limit)
    return SnapshotListResponse(
        count=len(snaps),
        snapshots=[s.to_dict() for s in snaps],
    )


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotResponse)
async def get_snapshot(snapshot_id: str):
    """获取快照详情"""
    manager = get_manager()
    snap = manager.get_snapshot(snapshot_id)
    if snap is None:
        raise HTTPException(status_code=404, detail=f"快照不存在: {snapshot_id}")
    return SnapshotResponse(snapshot=snap.to_dict())


@router.post("/rollback", response_model=RollbackResultResponse)
async def rollback(req: RollbackRequest):
    """回退到指定 commit"""
    manager = get_manager()
    result = await manager.rollback(
        repo_path=req.repo_path,
        commit_hash=req.commit_hash,
        message=req.message,
    )
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error or "回退失败")
    return RollbackResultResponse(result=result.to_dict())


@router.post("/rollback-by-snapshot", response_model=RollbackResultResponse)
async def rollback_by_snapshot(req: RollbackBySnapshotRequest):
    """按 snapshot_id 回退"""
    manager = get_manager()
    snap = manager.get_snapshot(req.snapshot_id)
    if snap is None:
        raise HTTPException(status_code=404, detail=f"快照不存在: {req.snapshot_id}")
    result = await manager.rollback(
        repo_path=req.repo_path,
        commit_hash=snap.commit_hash,
        message=req.message or f"Rollback to snapshot {snap.snapshot_id}",
    )
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error or "回退失败")
    return RollbackResultResponse(result=result.to_dict())


@router.post("/rollback-batch", response_model=RollbackBatchResponse)
async def rollback_batch(req: RollbackBatchRequest):
    """批量回退"""
    manager = get_manager()
    results = await manager.rollback_multiple(
        repo_path=req.repo_path,
        commit_hashes=req.commit_hashes,
    )
    all_success = all(r.success for r in results)
    return RollbackBatchResponse(
        count=len(results),
        results=[r.to_dict() for r in results],
        all_success=all_success,
    )


@router.get("/git-log", response_model=GitLogResponse)
async def git_log(
    repo_path: str = Query(..., min_length=1, max_length=4096),
    limit: int = Query(default=30, ge=1, le=200),
):
    """获取 git log"""
    if not os.path.isdir(repo_path):
        raise HTTPException(status_code=400, detail=f"路径不存在: {repo_path}")
    manager = get_manager()
    entries = manager.get_git_log(repo_path=repo_path, limit=limit)
    return GitLogResponse(
        repo_path=repo_path,
        count=len(entries),
        entries=entries,
    )


@router.get("/history")
async def rollback_history(limit: int = Query(default=50, ge=1, le=200)):
    """回退历史"""
    manager = get_manager()
    history = manager.get_rollback_history(limit=limit)
    return {
        "count": len(history),
        "history": [r.to_dict() for r in history],
    }
