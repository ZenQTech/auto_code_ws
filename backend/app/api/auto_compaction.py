"""
# Auto-Compaction REST API
# ============================================================
# 核心作用：暴露 Auto-Compaction 引擎的 HTTP 接口
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 端点（22 个）：
#   引擎控制（5）：check, run, plan, verify, rollback
#   分层管理（5）：tier, hot, cold, incremental, search
#   配置（4）：config (GET/PUT), session-config (GET/PUT)
#   流水线（3）：analyze, summarize, verify (单阶段)
#   统计（4）：stats, history, savings, health
# ============================================================
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auto_compaction.engine import GLOBAL_ENGINE, AutoCompactionEngine
from app.core.auto_compaction.models import (
    AutoCompactionConfig,
    DEFAULT_CONFIG,
    Strategy,
)


class CheckRequest(BaseModel):
    """check 请求体"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    config: Optional[Dict[str, Any]] = None


class RunRequest(BaseModel):
    """run 请求体"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    strategy: Optional[str] = None
    force: bool = False
    config: Optional[Dict[str, Any]] = None


class PlanRequest(BaseModel):
    """plan 请求体"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    strategy: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class VerifyRequest(BaseModel):
    """verify 请求体"""
    original_messages: Optional[List[Dict[str, Any]]] = None
    config: Optional[Dict[str, Any]] = None


class IncrementalRequest(BaseModel):
    """incremental 请求体"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    config: Optional[Dict[str, Any]] = None


class PipelineAnalyzeRequest(BaseModel):
    """pipeline analyze 请求体"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)


class PipelineSummarizeRequest(BaseModel):
    """pipeline summarize 请求体"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    indices: Optional[List[int]] = None


class PipelineVerifyRequest(BaseModel):
    """pipeline verify 请求体"""
    original_messages: List[Dict[str, Any]] = Field(default_factory=list)
    blocks: List[Dict[str, Any]] = Field(default_factory=list)


router = APIRouter(prefix="/api/auto-compaction", tags=["auto-compaction"])


def _get_engine() -> AutoCompactionEngine:
    """获取引擎实例"""
    return GLOBAL_ENGINE


# ============================================================
# 健康检查 & 统计
# ============================================================

@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    return _get_engine().health()


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """全局统计"""
    return _get_engine().get_stats()


# ============================================================
# 引擎控制
# ============================================================

@router.post("/check")
async def check(
    session_id: str = Query(...),
    request: CheckRequest = Body(...),
) -> Dict[str, Any]:
    """检测是否需要压缩"""
    engine = _get_engine()
    cfg = AutoCompactionConfig.from_dict(request.config) if request.config else None
    return engine.check(session_id, request.messages, cfg).to_dict()


@router.post("/run")
async def run(
    session_id: str = Query(...),
    request: RunRequest = Body(...),
) -> Dict[str, Any]:
    """执行压缩"""
    engine = _get_engine()
    cfg = AutoCompactionConfig.from_dict(request.config) if request.config else None
    result = engine.run(
        session_id, request.messages, cfg,
        strategy=request.strategy, force=request.force,
    )
    return result.to_dict()


@router.post("/plan")
async def plan(
    session_id: str = Query(...),
    request: PlanRequest = Body(...),
) -> Dict[str, Any]:
    """仅生成压缩计划"""
    engine = _get_engine()
    cfg = AutoCompactionConfig.from_dict(request.config) if request.config else None
    p = engine.plan(session_id, request.messages, cfg, strategy=request.strategy)
    return p.to_dict()


@router.post("/verify")
async def verify(
    session_id: str = Query(...),
    request: VerifyRequest = Body(default_factory=VerifyRequest),
) -> Dict[str, Any]:
    """验证会话压缩质量"""
    engine = _get_engine()
    cfg = AutoCompactionConfig.from_dict(request.config) if request.config else None
    result = engine.verify(session_id, request.original_messages, cfg)
    return result.to_dict()


@router.post("/rollback")
async def rollback(
    session_id: str = Query(...),
) -> Dict[str, Any]:
    """回滚会话压缩"""
    engine = _get_engine()
    success = engine.rollback(session_id)
    if not success:
        # 会话不存在时也返回 success=false（而不是 404）
        return {"success": False, "session_id": session_id, "reason": "no_session_or_no_snapshot"}
    return {"success": True, "session_id": session_id}


# ============================================================
# 会话分层管理
# ============================================================

@router.get("/sessions/{session_id}/tier")
async def get_tier(session_id: str) -> Dict[str, Any]:
    """获取会话冷热分层"""
    engine = _get_engine()
    tier = engine.get_tier(session_id)
    if not tier:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return tier.to_dict()


@router.get("/sessions/{session_id}/hot")
async def get_hot(session_id: str) -> Dict[str, Any]:
    """获取 hot tier"""
    engine = _get_engine()
    tier = engine.get_tier(session_id)
    if not tier:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return {
        "session_id": session_id,
        "count": len(tier.hot),
        "total_tokens": tier.total_hot_tokens,
        "messages": tier.hot,
    }


@router.get("/sessions/{session_id}/cold")
async def get_cold(session_id: str) -> Dict[str, Any]:
    """获取 cold tier"""
    engine = _get_engine()
    tier = engine.get_tier(session_id)
    if not tier:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return {
        "session_id": session_id,
        "count": len(tier.cold),
        "total_tokens": tier.total_cold_tokens,
        "indexed_keywords": len(tier.cold_index),
        "blocks": [b.to_dict() for b in tier.cold],
    }


@router.post("/sessions/{session_id}/incremental")
async def incremental(
    session_id: str,
    request: IncrementalRequest = Body(...),
) -> Dict[str, Any]:
    """增量压缩"""
    engine = _get_engine()
    cfg = AutoCompactionConfig.from_dict(request.config) if request.config else None
    result = engine.incremental(session_id, request.messages, cfg)
    return result.to_dict()


@router.get("/sessions/{session_id}/search")
async def search(
    session_id: str,
    query: str = Query(...),
    top_k: int = Query(5, ge=1, le=20),
) -> Dict[str, Any]:
    """在 cold tier 中搜索"""
    engine = _get_engine()
    blocks = engine.search(session_id, query, top_k)
    return {
        "session_id": session_id,
        "query": query,
        "count": len(blocks),
        "blocks": [b.to_dict() for b in blocks],
    }


# ============================================================
# 配置
# ============================================================

@router.get("/config")
async def get_config(session_id: Optional[str] = Query(None)) -> Dict[str, Any]:
    """获取配置"""
    engine = _get_engine()
    return engine.get_config(session_id).to_dict()


@router.put("/config")
async def update_config(
    config: Dict[str, Any] = Body(...),
    session_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """更新配置"""
    engine = _get_engine()
    new_cfg = AutoCompactionConfig.from_dict(config)
    engine.set_config(new_cfg, session_id)
    return {"success": True, "config": engine.get_config(session_id).to_dict()}


@router.get("/sessions/{session_id}/config")
async def get_session_config(session_id: str) -> Dict[str, Any]:
    """获取会话级配置"""
    engine = _get_engine()
    return engine.get_config(session_id).to_dict()


@router.put("/sessions/{session_id}/config")
async def update_session_config(
    session_id: str,
    config: Dict[str, Any] = Body(...),
) -> Dict[str, Any]:
    """更新会话级配置"""
    engine = _get_engine()
    new_cfg = AutoCompactionConfig.from_dict(config)
    engine.set_config(new_cfg, session_id)
    return {"success": True, "session_id": session_id, "config": new_cfg.to_dict()}


# ============================================================
# 流水线（单阶段）
# ============================================================

@router.post("/pipeline/analyze")
async def pipeline_analyze(
    session_id: str = Query(...),
    request: PipelineAnalyzeRequest = Body(...),
) -> Dict[str, Any]:
    """单阶段：Analyze"""
    engine = _get_engine()
    return engine.run_stage("analyze", session_id, request.messages)


@router.post("/pipeline/summarize")
async def pipeline_summarize(
    session_id: str = Query(...),
    request: PipelineSummarizeRequest = Body(...),
) -> Dict[str, Any]:
    """单阶段：Summarize"""
    engine = _get_engine()
    kwargs = {"indices": request.indices} if request.indices is not None else {}
    return engine.run_stage("summarize", session_id, request.messages, **kwargs)


@router.post("/pipeline/verify")
async def pipeline_verify(
    session_id: str = Query(...),
    request: PipelineVerifyRequest = Body(...),
) -> Dict[str, Any]:
    """单阶段：Verify"""
    engine = _get_engine()
    return engine.run_stage(
        "verify", session_id, request.original_messages, blocks=request.blocks
    )


# ============================================================
# 会话历史与节省
# ============================================================

@router.get("/sessions/{session_id}/history")
async def get_history(
    session_id: str,
    limit: int = Query(20, ge=1, le=100),
) -> Dict[str, Any]:
    """获取会话压缩历史"""
    engine = _get_engine()
    history = engine.get_session_history(session_id, limit)
    return {
        "session_id": session_id,
        "count": len(history),
        "history": history,
    }


@router.get("/sessions/{session_id}/savings")
async def get_savings(session_id: str) -> Dict[str, Any]:
    """获取会话节省统计"""
    engine = _get_engine()
    return engine.get_session_savings(session_id)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> Dict[str, Any]:
    """删除会话分层"""
    engine = _get_engine()
    engine.tiers.remove(session_id)
    return {"success": True, "session_id": session_id}
