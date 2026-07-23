"""
# ============================================================
# Git Worktree API
# ============================================================
# 核心作用：提供 Git Worktree 的创建、合并、清理、列表接口
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
# ============================================================
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateWorktreeRequest(BaseModel):
    repo_path: str = Field(..., description="仓库路径")
    module_name: str = Field(..., description="模块名称")
    instance_id: str = Field(..., description="实例 ID")


class WorktreeResponse(BaseModel):
    worktree_id: str
    repo_path: str
    worktree_path: str
    branch_name: str
    module_name: str
    instance_id: str
    status: str


class MergeRequest(BaseModel):
    worktree_id: str = Field(..., description="Worktree ID")
    repo_path: str = Field(..., description="仓库路径")


class MergeResponse(BaseModel):
    success: bool
    worktree_id: str
    branch_name: str
    conflicts: List[str] = []
    message: str = ""


@router.post("/create", response_model=WorktreeResponse)
async def create_worktree(request: Request, body: CreateWorktreeRequest):
    """创建 Git Worktree"""
    if not hasattr(request.app.state, 'worktree_manager'):
        raise HTTPException(status_code=503, detail="Worktree 管理器未初始化")
    worktree_manager = request.app.state.worktree_manager
    info = await worktree_manager.create_worktree(
        repo_path=body.repo_path,
        module_name=body.module_name,
        instance_id=body.instance_id,
    )
    return WorktreeResponse(
        worktree_id=info.worktree_id,
        repo_path=info.repo_path,
        worktree_path=info.worktree_path,
        branch_name=info.branch_name,
        module_name=info.module_name,
        instance_id=info.instance_id,
        status=info.status,
    )


@router.post("/merge", response_model=MergeResponse)
async def merge_worktree(request: Request, body: MergeRequest):
    """合并 Worktree"""
    if not hasattr(request.app.state, 'worktree_manager'):
        raise HTTPException(status_code=503, detail="Worktree 管理器未初始化")
    worktree_manager = request.app.state.worktree_manager
    result = await worktree_manager.merge_worktree(
        worktree_id=body.worktree_id,
        repo_path=body.repo_path,
    )
    return MergeResponse(
        success=result.success,
        worktree_id=result.worktree_id,
        branch_name=result.branch_name,
        conflicts=result.conflicts,
        message=result.message,
    )


@router.delete("/{worktree_id}")
async def delete_worktree(
    request: Request, worktree_id: str, repo_path: str = ""
):
    """清理 Worktree"""
    if not hasattr(request.app.state, 'worktree_manager'):
        raise HTTPException(status_code=503, detail="Worktree 管理器未初始化")
    worktree_manager = request.app.state.worktree_manager
    await worktree_manager.cleanup_worktree(worktree_id, repo_path)
    return {"success": True, "message": f"Worktree {worktree_id} 已清理"}


@router.get("/list")
async def list_worktrees(request: Request, repo_path: str = ""):
    """列出所有 Worktree"""
    if not hasattr(request.app.state, 'worktree_manager'):
        raise HTTPException(status_code=503, detail="Worktree 管理器未初始化")
    worktree_manager = request.app.state.worktree_manager
    worktrees = await worktree_manager.list_worktrees(repo_path)
    return {
        "worktrees": [
            {
                "worktree_path": wt.worktree_path,
                "branch_name": wt.branch_name,
                "status": wt.status,
            }
            for wt in worktrees
        ]
    }
