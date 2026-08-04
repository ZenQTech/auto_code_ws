"""
# ============================================================
# Stage Detector REST API (v1.0.0)
# Cycle 63 G63-03
# ====================================
# 核心作用：暴露 StageDetector 为 REST API
# 运行流程：
#   1. GET  /api/stage/{session_id}             获取当前阶段
#   2. POST /api/stage/detect                   从文本检测阶段
#   3. POST /api/stage/force                    强制设置阶段
#   4. GET  /api/stage/{session_id}/history     阶段历史
#   5. POST /api/stage/auto-follow              启用/禁用 Auto-Follow
#   6. GET  /api/stage/_stats                   统计
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# 对标：Trae SOLO Auto-Follow
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-03 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query

from ..services.stage_detector import (
    InvalidStageError,
    StageDetector,
    get_stage_detector,
)
from ..services.stage_models import (
    AutoFollowRequest,
    DetectStageRequest,
    ForceStageRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stage", tags=["stage"])


# ============================================================
# 静态路径（必须放在 /{session_id} 之前）
# ============================================================


@router.get("/_stats")
async def get_stats() -> Dict[str, Any]:
    """统计信息"""
    detector = get_stage_detector()
    return {
        "success": True,
        "stats": detector.get_stats(),
    }


@router.post("/detect")
async def detect_stage(req: DetectStageRequest) -> Dict[str, Any]:
    """从文本检测阶段"""
    detector = get_stage_detector()
    try:
        state = await detector.detect_from_text(
            session_id=req.session_id,
            text=req.text,
            use_llm=req.use_llm,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(f"detect_stage 失败: {e}")
        raise HTTPException(status_code=500, detail=f"检测失败: {e}") from e
    return {
        "success": True,
        "state": state.to_dict(),
    }


@router.post("/force")
async def force_stage(req: ForceStageRequest) -> Dict[str, Any]:
    """强制设置阶段"""
    detector = get_stage_detector()
    try:
        state = detector.force_stage(
            session_id=req.session_id,
            stage=req.stage,
            reason=req.reason,
        )
    except InvalidStageError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "success": True,
        "state": state.to_dict(),
    }


# ============================================================
# 动态路径 /{session_id}
# ============================================================


@router.get("/{session_id}")
async def get_state(session_id: str) -> Dict[str, Any]:
    """获取当前阶段状态"""
    detector = get_stage_detector()
    state = detector.get_state(session_id)
    return {
        "success": True,
        "state": state.to_dict(),
    }


@router.get("/{session_id}/history")
async def get_history(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=500),
) -> Dict[str, Any]:
    """获取阶段历史"""
    detector = get_stage_detector()
    history = detector.get_history(session_id, limit=limit)
    return {
        "success": True,
        "events": [e.model_dump() for e in history],
        "total": len(history),
    }


@router.post("/auto-follow")
async def set_auto_follow(req: AutoFollowRequest) -> Dict[str, Any]:
    """设置 Auto-Follow"""
    detector = get_stage_detector()
    state = detector.set_auto_follow(req.session_id, req.enabled)
    return {
        "success": True,
        "state": state.to_dict(),
    }
