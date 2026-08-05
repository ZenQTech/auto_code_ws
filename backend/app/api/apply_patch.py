"""
# ============================================================
# ApplyPatch API (v1.0.0)
# Cycle 68 G68-02
# ============================================================
# 核心作用：暴露 ApplyPatchService 为 REST API
#   POST /api/apply-patch/validate   解析 + 校验
#   POST /api/apply-patch/preview    生成 diff 预览
#   POST /api/apply-patch/apply      事务性应用
#   GET  /api/apply-patch/stats      服务统计
# 输入参数：JSON body（patch_text, root, force, create_snapshot）
# 输出结果：JSON response
# 对标：Codex `codex-rs/apply_patch` 内部 API
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 68 G68-02 初次创建
# ====================================
"""

import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.apply_patch import (
    ApplyPatchError,
    ApplyPatchService,
    ConflictsDetectedError,
    PatchParseError,
    PatchTooLargeError,
    get_apply_patch_service,
)
from app.services.file_storage import PathNotAllowedError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/apply-patch", tags=["apply-patch"])


# ============================================================
# Request / Response Models
# ============================================================


class PatchRequest(BaseModel):
    """通用 patch 请求"""
    patch_text: str = Field(..., min_length=1, description="V4A patch 文本")
    root: str = Field(..., description="项目根目录绝对路径")
    force: bool = Field(default=False, description="跳过 hash 校验")
    create_snapshot: bool = Field(default=True, description="应用前是否创建快照")
    session_id: Optional[str] = Field(default=None, description="会话 ID（用于 snapshot 归属）")


class ValidateResponse(BaseModel):
    valid: bool
    ops_count: int = 0
    files: List[str] = Field(default_factory=list)
    file_hashes: Dict[str, str] = Field(default_factory=dict)
    error: str = ""
    error_line: int = 0
    ops: List[Dict[str, Any]] = Field(default_factory=list)


class PreviewResponse(BaseModel):
    safe: bool
    ops_count: int = 0
    diffs: List[Dict[str, Any]] = Field(default_factory=list)
    conflicts: List[Dict[str, Any]] = Field(default_factory=list)
    error: str = ""


class ApplyResponse(BaseModel):
    success: bool
    snapshot_id: Optional[str] = None
    applied_ops: int = 0
    duration_ms: int = 0
    error: str = ""
    failed_op: Optional[Dict[str, Any]] = None
    rolled_back: bool = False
    diffs: List[Dict[str, Any]] = Field(default_factory=list)


class StatsResponse(BaseModel):
    max_files_per_patch: int
    max_patch_size: int
    max_hunk_per_file: int
    fs_config: Dict[str, Any]


# ============================================================
# Endpoints
# ============================================================


@router.post("/validate", response_model=ValidateResponse)
async def validate_patch(request: PatchRequest) -> ValidateResponse:
    """
    解析 V4A patch + 收集 file_hashes
    不做 hash 冲突校验
    """
    service = get_apply_patch_service()
    try:
        # 仅解析（不做 hash 校验）
        parse_result = service.parse(request.patch_text)
        if not parse_result.valid:
            return ValidateResponse(
                valid=False,
                ops_count=0,
                error=parse_result.error,
                error_line=parse_result.error_line,
            )

        # 收集 file_hashes（可选）
        file_hashes: Dict[str, str] = {}
        from app.services.file_storage import (
            FileNotFoundError,
            FileTooLargeError,
            compute_hash,
            get_file_storage,
        )
        fs = get_file_storage()
        for op in parse_result.ops:
            try:
                # 校验路径
                abs_path = service._safe_path(request.root, op.path)
                if fs.exists(abs_path):
                    file_hashes[op.path] = compute_hash(fs.read(abs_path))
                else:
                    file_hashes[op.path] = ""
            except (FileNotFoundError, FileTooLargeError, PathNotAllowedError):
                file_hashes[op.path] = ""

        return ValidateResponse(
            valid=True,
            ops_count=parse_result.ops_count,
            files=parse_result.files,
            file_hashes=file_hashes,
            ops=[op.to_dict() for op in parse_result.ops],
        )
    except PatchParseError as e:
        raise HTTPException(status_code=400, detail=f"PARSE_ERROR: {e}")
    except PatchTooLargeError as e:
        raise HTTPException(status_code=413, detail=f"PATCH_TOO_LARGE: {e}")
    except ApplyPatchError as e:
        raise HTTPException(status_code=500, detail=f"VALIDATE_FAILED: {e}")


@router.post("/preview", response_model=PreviewResponse)
async def preview_patch(request: PatchRequest) -> PreviewResponse:
    """
    预览 patch（不应用）
    - 返回每个文件的 unified diff
    - 返回 hash 冲突列表
    """
    service = get_apply_patch_service()
    try:
        result = service.preview(request.patch_text, request.root)
        return PreviewResponse(
            safe=result.safe,
            ops_count=result.ops_count,
            diffs=[d.to_dict() for d in result.diffs],
            conflicts=[c.to_dict() for c in result.conflicts],
            error=result.error,
        )
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=f"PERMISSION_DENIED: {e}")
    except ApplyPatchError as e:
        raise HTTPException(status_code=500, detail=f"PREVIEW_FAILED: {e}")


@router.post("/apply", response_model=ApplyResponse)
async def apply_patch(request: PatchRequest) -> ApplyResponse:
    """
    应用 patch（事务性）
    - 失败自动回滚
    - 可选创建 snapshot
    """
    service = get_apply_patch_service()
    start = time.time()
    try:
        result = service.apply(
            text=request.patch_text,
            root=request.root,
            force=request.force,
            create_snapshot=request.create_snapshot,
            session_id=request.session_id,
        )
        # 如果 result 含 conflicts 且未 force，返回 409
        if not result.success and result.failed_op and "conflicts" in result.failed_op:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "CONFLICTS_DETECTED",
                    "conflicts": result.failed_op["conflicts"],
                },
            )
        return ApplyResponse(
            success=result.success,
            snapshot_id=result.snapshot_id,
            applied_ops=result.applied_ops,
            duration_ms=result.duration_ms,
            error=result.error,
            failed_op=result.failed_op,
            rolled_back=result.rolled_back,
            diffs=[d.to_dict() for d in result.diffs],
        )
    except HTTPException:
        raise
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=f"PERMISSION_DENIED: {e}")
    except PatchParseError as e:
        raise HTTPException(status_code=400, detail=f"PARSE_ERROR: {e}")
    except PatchTooLargeError as e:
        raise HTTPException(status_code=413, detail=f"PATCH_TOO_LARGE: {e}")
    except ApplyPatchError as e:
        raise HTTPException(status_code=500, detail=f"APPLY_FAILED: {e}")


@router.get("/stats", response_model=StatsResponse)
async def get_stats() -> StatsResponse:
    """获取 apply_patch 服务统计"""
    service = get_apply_patch_service()
    stats = service.get_stats()
    return StatsResponse(**stats)
