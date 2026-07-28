"""
# ============================================================
# DiffView REST API 路由
# ============================================================
# 端点：
#   - POST   /api/diff-view/workspace          工作区 diff（多格式）
#   - POST   /api/diff-view/compare            任意 ref 对比
#   - POST   /api/diff-view/snapshot-vs-worktree  快照 vs 工作区
#   - GET    /api/diff-view/snapshots          列出快照
#   - POST   /api/diff-view/snapshots          创建快照
#   - POST   /api/diff-view/snapshots/{id}/restore  恢复快照
#   - DELETE /api/diff-view/snapshots/{id}     删除快照
#   - POST   /api/diff-view/stage              暂存文件
#   - POST   /api/diff-view/unstage            取消暂存
#   - POST   /api/diff-view/stage-all          暂存所有
#   - GET    /api/diff-view/health             健康检查
# 创建日期：2026-07-28
# 模块版本：v1.0.0 - Cycle 9 P1-7
# ============================================================
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.diff_view import (
    DiffFormat,
    DiffViewService,
    get_diff_view_service,
    reset_global_registry,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求 / 响应模型
# ============================================================

class DiffWorkspaceRequest(BaseModel):
    """
    工作区 diff 请求
    字段说明：
      - project_path: 项目根目录（必填）
      - staged: 是否对比暂存区（默认 False）
      - format: 输出格式 unified/side_by_side/json_patch/stats
      - path_filter: 路径子串过滤
      - status_filter: 状态过滤列表
    """
    project_path: str = Field(..., min_length=1, description="项目根目录")
    staged: bool = Field(default=False, description="是否对比暂存区")
    format: str = Field(default="unified", description="输出格式")
    path_filter: Optional[str] = Field(default=None, description="路径子串过滤")
    status_filter: Optional[List[str]] = Field(default=None, description="状态过滤列表")


class DiffRefsRequest(BaseModel):
    """
    任意 ref 对比请求
    字段说明：
      - project_path: 项目根目录
      - base_ref: 基础 ref（commit/branch/tag）
      - target_ref: 目标 ref
      - format: 输出格式
      - path_filter: 路径子串过滤
    """
    project_path: str = Field(..., min_length=1)
    base_ref: str = Field(..., min_length=1)
    target_ref: str = Field(..., min_length=1)
    format: str = Field(default="unified")
    path_filter: Optional[str] = Field(default=None)


class DiffSnapshotRequest(BaseModel):
    """快照 vs 工作区 diff 请求"""
    project_path: str = Field(..., min_length=1)
    snapshot_id: str = Field(..., min_length=1)


class CreateSnapshotRequest(BaseModel):
    """创建快照请求"""
    project_path: str = Field(..., min_length=1)
    label: str = Field(default="", description="人类可读标签")
    description: str = Field(default="", description="描述")
    include_globs: Optional[List[str]] = Field(default=None, description="包含的 glob 列表")


class StageRequest(BaseModel):
    """暂存 / 取消暂存请求"""
    project_path: str = Field(..., min_length=1)
    file_path: str = Field(..., min_length=1, max_length=1024)


class StageAllRequest(BaseModel):
    """暂存所有请求"""
    project_path: str = Field(..., min_length=1)


# ============================================================
# 工具方法
# ============================================================

def _validate_project_path(project_path: str) -> str:
    """校验项目路径非空"""
    if not project_path or not project_path.strip():
        raise HTTPException(status_code=400, detail="project_path 不能为空")
    return project_path.strip()


def _get_service(project_path: str) -> DiffViewService:
    try:
        return get_diff_view_service(project_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# Diff 端点
# ============================================================

@router.post("/workspace")
async def diff_workspace(req: DiffWorkspaceRequest):
    """
    工作区 diff（多格式输出）
    """
    pp = _validate_project_path(req.project_path)
    svc = _get_service(pp)
    try:
        result = svc.diff_workspace(
            staged=req.staged,
            format=req.format,
            path_filter=req.path_filter,
            status_filter=req.status_filter,
        )
        return {
            "success": True,
            "action": "diff_workspace",
            "data": result.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.error(f"diff_workspace failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compare")
async def diff_compare(req: DiffRefsRequest):
    """
    比较任意两个 ref（commit/branch/tag）
    """
    pp = _validate_project_path(req.project_path)
    svc = _get_service(pp)
    try:
        result = svc.diff_refs(
            base_ref=req.base_ref,
            target_ref=req.target_ref,
            format=req.format,
            path_filter=req.path_filter,
        )
        return {
            "success": True,
            "action": "diff_compare",
            "data": result.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.error(f"diff_compare failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/snapshot-vs-worktree")
async def diff_snapshot(req: DiffSnapshotRequest):
    """
    对比快照与当前工作区
    """
    pp = _validate_project_path(req.project_path)
    svc = _get_service(pp)
    try:
        result = svc.diff_snapshot_to_workspace(req.snapshot_id)
        if result.error:
            return {
                "success": False,
                "action": "diff_snapshot",
                "error": result.error,
            }
        return {
            "success": True,
            "action": "diff_snapshot",
            "data": result.to_dict(),
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"diff_snapshot failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 快照端点
# ============================================================

@router.get("/snapshots")
async def list_snapshots(
    project_path: str = Query(..., min_length=1, description="项目根目录"),
):
    """列出快照"""
    pp = _validate_project_path(project_path)
    svc = _get_service(pp)
    try:
        snaps = svc.list_snapshots()
        return {
            "success": True,
            "action": "list_snapshots",
            "count": len(snaps),
            "snapshots": [s.to_dict() for s in snaps],
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"list_snapshots failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/snapshots")
async def create_snapshot(req: CreateSnapshotRequest):
    """创建快照"""
    pp = _validate_project_path(req.project_path)
    svc = _get_service(pp)
    try:
        snap = svc.create_snapshot(
            label=req.label,
            description=req.description,
            include_globs=req.include_globs,
        )
        return {
            "success": True,
            "action": "create_snapshot",
            "snapshot": snap.to_dict(),
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"create_snapshot failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/snapshots/{snapshot_id}/restore")
async def restore_snapshot(
    snapshot_id: str,
    project_path: str = Query(..., min_length=1),
):
    """恢复快照到工作区"""
    pp = _validate_project_path(project_path)
    svc = _get_service(pp)
    try:
        ok, msg, count = svc.restore_snapshot(snapshot_id)
        return {
            "success": ok,
            "action": "restore_snapshot",
            "snapshot_id": snapshot_id,
            "message": msg,
            "file_count": count,
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"restore_snapshot failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/snapshots/{snapshot_id}")
async def delete_snapshot(
    snapshot_id: str,
    project_path: str = Query(..., min_length=1),
):
    """删除快照"""
    pp = _validate_project_path(project_path)
    svc = _get_service(pp)
    try:
        ok, msg = svc.delete_snapshot(snapshot_id)
        if not ok:
            raise HTTPException(status_code=404, detail=msg)
        return {
            "success": True,
            "action": "delete_snapshot",
            "snapshot_id": snapshot_id,
            "message": msg,
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.error(f"delete_snapshot failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 暂存端点
# ============================================================

@router.post("/stage")
async def stage_file(req: StageRequest):
    """暂存单个文件"""
    pp = _validate_project_path(req.project_path)
    svc = _get_service(pp)
    try:
        ok, msg = svc.stage_file(req.file_path)
        return {
            "success": ok,
            "action": "stage",
            "file_path": req.file_path,
            "message": msg,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.error(f"stage failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/unstage")
async def unstage_file(req: StageRequest):
    """取消暂存单个文件"""
    pp = _validate_project_path(req.project_path)
    svc = _get_service(pp)
    try:
        ok, msg = svc.unstage_file(req.file_path)
        return {
            "success": ok,
            "action": "unstage",
            "file_path": req.file_path,
            "message": msg,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.error(f"unstage failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stage-all")
async def stage_all(req: StageAllRequest):
    """暂存所有变更"""
    pp = _validate_project_path(req.project_path)
    svc = _get_service(pp)
    try:
        ok, msg = svc.stage_all()
        return {
            "success": ok,
            "action": "stage_all",
            "message": msg,
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"stage_all failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 健康检查 / 元信息
# ============================================================

@router.get("/health")
async def health():
    """健康检查"""
    return {
        "success": True,
        "action": "health",
        "service": "diff_view",
        "version": "1.0.0",
        "supported_formats": [f.value for f in DiffFormat],
    }


@router.get("/formats")
async def list_formats():
    """支持的输出格式列表"""
    return {
        "success": True,
        "action": "list_formats",
        "formats": [
            {
                "name": DiffFormat.UNIFIED.value,
                "description": "标准 unified diff 文本",
            },
            {
                "name": DiffFormat.SIDE_BY_SIDE.value,
                "description": "并排双列 diff",
            },
            {
                "name": DiffFormat.JSON_PATCH.value,
                "description": "JSON 结构化 diff (RFC 6902 风格)",
            },
            {
                "name": DiffFormat.STATS.value,
                "description": "仅统计信息（文件数/新增/删除）",
            },
        ],
    }
