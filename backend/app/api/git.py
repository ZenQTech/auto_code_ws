"""
# ============================================================
# Git 版本管理 API（V4.1）
# ============================================================
# 核心作用：提供 Git 仓库状态查询、自动提交、版本标签、
#           分支管理、提交历史等 RESTful API 端点
# 运行流程：
#   - GET /api/git/status: 获取 Git 仓库完整状态
#   - POST /api/git/commit: 触发自动提交
#   - POST /api/git/tag: 创建语义化版本标签
#   - GET /api/git/branches: 获取分支列表
#   - GET /api/git/log: 获取提交历史
#   - POST /api/git/diff-files: 获取工作区文件级 diff 列表（v4.5.0 新增）
#   - POST /api/git/checkout-file: 回退指定文件的工作区修改（v4.5.0 新增）
# 输入参数：通过请求体和查询参数传递
# 输出结果：JSON 格式的 Git 操作结果
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现 Git 版本管理 API
#   - 2026-06-26 | v4.1.1 | 修复 GitManager 双实例问题，改用 request.app.state.git_manager
#   - 2026-07-24 | v4.5.0 | 新增 diff-files / checkout-file 端点，支撑 Module D DiffView
# ============================================================
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel, Field

from ..config import settings
from ..services.git_manager import (
    GitManager,
    CommitMode,
    MilestoneType,
    GitStatus,
    CommitResult,
    TagResult,
    BranchInfo,
    CommitLogEntry,
    FileDiffEntry,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class CommitRequest(BaseModel):
    """
    自动提交请求
    字段说明：
      - task_id: 任务 ID
      - task_name: 任务名称
      - mode: 提交模式（per_module / milestone / disabled），可选
      - milestone: 里程碑类型（architecture_confirmed / all_modules_done /
                   integration_passed / final_delivery），可选
      - force: 是否强制执行（跳过人工修改检测），默认 False
    """
    task_id: str = Field(default="", description="任务 ID")
    task_name: str = Field(default="", description="任务名称")
    mode: Optional[str] = Field(default=None, description="提交模式")
    milestone: Optional[str] = Field(default=None, description="里程碑类型")
    force: bool = Field(default=False, description="是否强制执行（跳过人工修改检测）")


class TagRequest(BaseModel):
    """
    版本标签创建请求
    字段说明：
      - version: 语义化版本号，格式 MAJOR.MINOR.PATCH
      - message: 标签附注信息
      - changes: 核心变更说明
    """
    version: str = Field(..., min_length=1, max_length=64, description="语义化版本号")
    message: str = Field(default="", description="标签附注信息")
    changes: str = Field(default="", description="核心变更说明")


class MergeCheckRequest(BaseModel):
    """
    合并冲突检测请求
    字段说明：
      - source_branch: 源分支名
      - target_branch: 目标分支名
    """
    source_branch: str = Field(..., min_length=1, description="源分支名")
    target_branch: str = Field(..., min_length=1, description="目标分支名")


class MergeRequest(BaseModel):
    """
    分支合并请求
    字段说明：
      - source_branch: 源分支名
      - target_branch: 目标分支名
      - no_ff: 是否禁用快进合并
    """
    source_branch: str = Field(..., min_length=1, description="源分支名")
    target_branch: str = Field(..., min_length=1, description="目标分支名")
    no_ff: bool = Field(default=False, description="禁用快进合并")


class CreateBranchRequest(BaseModel):
    """
    创建分支请求
    字段说明：
      - branch_name: 新分支名称
      - base_branch: 基准分支名（可选，默认当前分支）
    """
    branch_name: str = Field(..., min_length=1, max_length=256, description="新分支名称")
    base_branch: Optional[str] = Field(default=None, description="基准分支名")


class SwitchBranchRequest(BaseModel):
    """
    切换分支请求
    字段说明：
      - branch_name: 目标分支名
    """
    branch_name: str = Field(..., min_length=1, description="目标分支名")


class CheckoutFileRequest(BaseModel):
    """
    回退（撤销）文件请求（v4.5.0 新增）
    字段说明：
      - file_path: 待回退的文件相对路径
    """
    file_path: str = Field(..., min_length=1, max_length=1024, description="待回退的文件路径")


# ============================================================
# API 端点
# ============================================================

@router.get("/status")
async def get_git_status(request: Request):
    """
    获取 Git 仓库完整状态
    调用方：前端 Git 管理面板
    被调用方：GitManager
    返回值：GitStatus 对象，包含仓库状态、分支、工作区变更等
    """
    gm = request.app.state.git_manager
    status = gm.get_status()

    # 将 GitStatus 数据类转换为可 JSON 序列化的字典
    return {
        "is_repo": status.is_repo,
        "current_branch": status.current_branch,
        "is_clean": status.is_clean,
        "modified_files": status.modified_files,
        "staged_files": status.staged_files,
        "untracked_files": status.untracked_files,
        "ahead_count": status.ahead_count,
        "behind_count": status.behind_count,
        "last_commit": status.last_commit,
        "tags": status.tags,
        "config": gm.get_config_summary(),
    }


@router.post("/commit")
async def trigger_auto_commit(request: Request, body: CommitRequest):
    """
    触发自动提交
    运行步骤：
      1. 解析提交模式和里程碑类型
      2. 若未设置 force，先检测人工修改
      3. 调用 GitManager.auto_commit 执行提交
      4. 返回提交结果
    调用方：任务执行引擎、工作流编排层
    被调用方：GitManager
    参数：
      - body: CommitRequest
    返回值：提交结果字典
    """
    gm = request.app.state.git_manager

    # 解析提交模式
    mode = None
    if body.mode:
        try:
            mode = CommitMode(body.mode)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"无效的提交模式: {body.mode}，"
                       f"有效值: {[m.value for m in CommitMode]}",
            )

    # 解析里程碑类型
    milestone = None
    if body.milestone:
        try:
            milestone = MilestoneType(body.milestone)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"无效的里程碑类型: {body.milestone}，"
                       f"有效值: {[m.value for m in MilestoneType]}",
            )

    # 非强制模式下，先检测人工修改
    if not body.force:
        human_check = gm.check_human_modifications()
        if human_check["has_modifications"]:
            return {
                "success": False,
                "message": "检测到工作区有未提交的修改，请确认是否包含人工修改",
                "human_modifications": human_check,
                "commit_hash": "",
                "files_changed": [],
            }

    # 执行自动提交
    result = gm.auto_commit(
        task_id=body.task_id,
        task_name=body.task_name,
        mode=mode,
        milestone=milestone,
    )

    return {
        "success": result.success,
        "message": result.message,
        "commit_hash": result.commit_hash,
        "files_changed": result.files_changed,
        "human_changes_detected": result.human_changes_detected,
        "human_changes_warning": result.human_changes_warning,
    }


@router.post("/tag")
async def create_version_tag(request: Request, body: TagRequest):
    """
    创建语义化版本标签
    运行步骤：
      1. 校验版本号格式
      2. 调用 GitManager.create_tag 创建标签
      3. 返回创建结果
    调用方：版本发布流程
    被调用方：GitManager
    参数：
      - body: TagRequest
    返回值：标签创建结果字典
    """
    gm = request.app.state.git_manager

    result = gm.create_tag(
        version=body.version,
        message=body.message,
        changes=body.changes,
    )

    if not result.success:
        raise HTTPException(status_code=400, detail=result.message)

    return {
        "success": result.success,
        "tag_name": result.tag_name,
        "commit_hash": result.commit_hash,
        "message": result.message,
    }


@router.get("/tags")
async def list_tags(request: Request):
    """
    获取所有版本标签列表
    调用方：前端版本管理面板
    被调用方：GitManager
    返回值：标签信息列表
    """
    gm = request.app.state.git_manager
    tags = gm.get_tags()
    return {"tags": tags, "count": len(tags)}


@router.get("/branches")
async def list_branches(request: Request):
    """
    获取所有分支列表
    调用方：前端分支管理面板
    被调用方：GitManager
    返回值：分支信息列表，包含当前分支和保护分支标记
    """
    gm = request.app.state.git_manager
    branches = gm.get_branches()

    return {
        "branches": [
            {
                "name": b.name,
                "is_current": b.is_current,
                "is_protected": b.is_protected,
                "last_commit": b.last_commit,
                "last_commit_date": b.last_commit_date,
            }
            for b in branches
        ],
        "count": len(branches),
        "current_branch": gm.get_current_branch(),
    }


@router.post("/branches")
async def create_branch(request: Request, body: CreateBranchRequest):
    """
    创建新分支
    调用方：前端分支管理面板
    被调用方：GitManager
    参数：
      - body: CreateBranchRequest
    返回值：操作结果
    """
    gm = request.app.state.git_manager

    success = gm.create_branch(
        branch_name=body.branch_name,
        base_branch=body.base_branch,
    )

    if not success:
        raise HTTPException(status_code=400, detail="创建分支失败，请检查分支名是否已存在")

    return {
        "success": True,
        "message": f"分支 {body.branch_name} 创建成功",
        "branch_name": body.branch_name,
    }


@router.post("/branches/switch")
async def switch_branch(request: Request, body: SwitchBranchRequest):
    """
    切换到指定分支
    调用方：前端分支管理面板
    被调用方：GitManager
    参数：
      - body: SwitchBranchRequest
    返回值：操作结果
    """
    gm = request.app.state.git_manager

    success = gm.switch_branch(branch_name=body.branch_name)

    if not success:
        raise HTTPException(
            status_code=400,
            detail="切换分支失败，请检查分支是否存在且工作区是否干净",
        )

    return {
        "success": True,
        "message": f"已切换到分支: {body.branch_name}",
        "current_branch": body.branch_name,
    }


@router.get("/log")
async def get_commit_log(
    request: Request,
    max_count: int = Query(default=50, ge=1, le=500, description="最大返回条数"),
    branch: Optional[str] = Query(default=None, description="指定分支名"),
):
    """
    获取提交历史
    调用方：前端提交历史面板
    被调用方：GitManager
    参数：
      - max_count: 最大返回条数（1-500，默认 50）
      - branch: 指定分支名（可选，默认当前分支）
    返回值：提交日志列表
    """
    gm = request.app.state.git_manager
    entries = gm.get_commit_log(max_count=max_count, branch=branch)

    return {
        "commits": [
            {
                "hash": e.hash,
                "author": e.author,
                "date": e.date,
                "message": e.message,
                "is_auto_commit": e.is_auto_commit,
            }
            for e in entries
        ],
        "count": len(entries),
    }


@router.post("/merge/check")
async def check_merge(request: Request, body: MergeCheckRequest):
    """
    合并前冲突检测
    运行步骤：
      1. 校验源分支和目标分支
      2. 模拟合并并检测冲突
      3. 返回检测结果
    调用方：合并工作流
    被调用方：GitManager
    参数：
      - body: MergeCheckRequest
    返回值：冲突检测结果
    """
    gm = request.app.state.git_manager

    result = gm.check_merge_conflicts(
        source_branch=body.source_branch,
        target_branch=body.target_branch,
    )

    return {
        "can_merge": result.can_merge,
        "has_conflicts": result.has_conflicts,
        "conflict_files": result.conflict_files,
        "source_branch": result.source_branch,
        "target_branch": result.target_branch,
        "details": result.details,
    }


@router.post("/merge")
async def merge_branches(request: Request, body: MergeRequest):
    """
    执行分支合并（带冲突检测）
    运行步骤：
      1. 先执行冲突检测
      2. 若有冲突则拒绝合并
      3. 执行合并
      4. 返回合并结果
    调用方：合并工作流
    被调用方：GitManager
    参数：
      - body: MergeRequest
    返回值：合并结果
    """
    gm = request.app.state.git_manager

    result = gm.merge_branch(
        source_branch=body.source_branch,
        target_branch=body.target_branch,
        no_ff=body.no_ff,
    )

    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "合并失败"))

    return result


@router.get("/config")
async def get_git_config(request: Request):
    """
    获取当前 Git 配置摘要
    调用方：前端配置面板
    被调用方：GitManager
    返回值：配置信息字典
    """
    gm = request.app.state.git_manager
    return gm.get_config_summary()


# ============================================================
# v4.5.0 新增 - Module D DiffView API
# ============================================================

@router.post("/diff-files")
async def get_diff_files(
    request: Request,
    staged: bool = Query(default=False, description="是否仅返回已暂存变更"),
):
    """
    获取工作区文件级 diff 列表（v4.5.0 新增）
    作用：前端 DiffView 组件调用，列出所有变更文件及每文件的
          path / status / additions / deletions / patch
    运行步骤：
      1. 从 request.app.state.git_manager 获取 GitManager 实例
      2. 调用 gm.get_diff_files(staged=staged) 获取 diff 列表
      3. 将结果转换为 JSON 可序列化的字典列表
      4. 同时返回汇总统计（文件数、新增行数、删除行数）
    调用方：前端 DiffView.tsx
    被调用方：GitManager.get_diff_files
    参数：
      - staged: 是否仅返回已暂存变更
    返回值：{
        files: [{ path, status, additions, deletions, patch, is_staged }],
        total_files: int,
        total_additions: int,
        total_deletions: int,
      }
    """
    gm = request.app.state.git_manager
    entries: List[FileDiffEntry] = gm.get_diff_files(staged=staged)

    files = [
        {
            "path": e.path,
            "status": e.status,
            "additions": e.additions,
            "deletions": e.deletions,
            "patch": e.patch,
            "is_staged": e.is_staged,
        }
        for e in entries
    ]

    return {
        "files": files,
        "total_files": len(files),
        "total_additions": sum(e.additions for e in entries),
        "total_deletions": sum(e.deletions for e in entries),
        "staged_only": staged,
    }


@router.post("/checkout-file")
async def checkout_file(request: Request, body: CheckoutFileRequest):
    """
    回退（撤销）指定文件的工作区修改（v4.5.0 新增）
    作用：前端 DiffView"回退"按钮调用，撤销该文件的未提交修改
    运行步骤：
      1. 校验 file_path 字段已由 pydantic 强制非空
      2. 调用 gm.checkout_file 执行回退
      3. 失败时返回 400 错误，成功时返回结果字典
    调用方：前端 DiffView.tsx
    被调用方：GitManager.checkout_file
    参数：
      - body: CheckoutFileRequest
    返回值：操作结果字典 { success, message, file_path }
    """
    gm = request.app.state.git_manager
    result = gm.checkout_file(file_path=body.file_path)

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("message", "回退文件失败"),
        )

    return result
