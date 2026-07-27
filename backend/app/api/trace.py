"""
# ============================================================
# Trace API - TRACE 编译与执行 REST API（Cycle 7 P0-11）
# ============================================================
# 核心作用：暴露 TRACE 编译、规则管理、执行检查的 REST API
# 端点：
#   - POST /api/trace/compile         编译用户消息为规则
#   - POST /api/trace/check           预检查工具调用
#   - GET  /api/trace/rules           列出规则
#   - GET  /api/trace/rules/{id}      获取单条规则
#   - DELETE /api/trace/rules/{id}    停用规则
#   - DELETE /api/trace/rules/{id}/hard  物理删除
#   - GET  /api/trace/stats           统计
#   - POST /api/trace/clear           清空 session 规则
#   - GET  /api/trace/health          健康检查
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-11 新建
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.trace_compiler import (
    TraceCompiler, CorrectionIntent, get_trace_compiler, reset_trace_compiler,
)
from backend.app.services.rule_store import (
    RuleStore, CompiledRule, get_rule_store, reset_rule_store,
)
from backend.app.services.enforcement_engine import (
    EnforcementEngine, EnforcementResult, get_enforcement_engine, reset_enforcement_engine,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# Request/Response Models
# ============================================================
class CompileRequest(BaseModel):
    """编译请求"""
    session_id: str = Field(default="default", description="Session ID")
    user_message: str = Field(..., min_length=1, description="用户消息")
    scope: str = Field(default="session", description="规则作用域: session/user/global")
    source_message_id: Optional[str] = Field(default=None, description="源消息 ID")
    auto_add: bool = Field(default=True, description="是否自动添加到规则库")


class CompileResponse(BaseModel):
    """编译响应"""
    success: bool
    is_correction: bool
    intent: Dict[str, Any]
    rule_id: Optional[str] = None
    compiled_rule: Optional[Dict[str, Any]] = None
    message: str = ""


class CheckRequest(BaseModel):
    """预检查请求"""
    session_id: str = Field(default="default", description="Session ID")
    tool_name: str = Field(..., description="工具名称")
    tool_args: Dict[str, Any] = Field(default_factory=dict, description="工具参数")


class CheckResponse(BaseModel):
    """预检查响应"""
    allowed: bool
    rule_id: Optional[str] = None
    rule_subject: Optional[str] = None
    reason: Optional[str] = None
    suggestion: Optional[str] = None
    tier: Optional[int] = None
    action: Optional[str] = None
    check_time_ms: float = 0.0
    warnings: List[str] = Field(default_factory=list)


# ============================================================
# 辅助函数
# ============================================================
def _get_components():
    """获取三个核心组件"""
    return (
        get_trace_compiler(),
        get_rule_store(),
        get_enforcement_engine(),
    )


# ============================================================
# 端点
# ============================================================
@router.get("/health")
async def health():
    """健康检查"""
    compiler, store, engine = _get_components()
    return {
        "status": "ok",
        "compiler_ready": compiler is not None,
        "store_ready": store is not None,
        "engine_ready": engine is not None,
    }


@router.post("/compile", response_model=CompileResponse)
async def compile_message(req: CompileRequest):
    """编译用户消息为规则"""
    compiler, store, _ = _get_components()

    # 1. 检测 + 编译
    intent, rule = compiler.compile_from_message(
        user_message=req.user_message,
        session_id=req.session_id,
        scope=req.scope,
        source_message_id=req.source_message_id,
    )

    # 2. 非纠正消息
    if not intent.is_correction:
        return CompileResponse(
            success=True,
            is_correction=False,
            intent={
                "is_correction": False,
                "category": intent.category,
                "target": intent.target,
                "subject": intent.subject,
                "confidence": intent.confidence,
                "detected_keywords": intent.detected_keywords,
            },
            message="未检测到纠正意图",
        )

    # 3. 编译失败（理论上不该发生）
    if rule is None:
        raise HTTPException(status_code=500, detail="规则编译失败")

    # 4. confidence 过低
    if intent.confidence < TraceCompiler.CONFIDENCE_THRESHOLD:
        return CompileResponse(
            success=True,
            is_correction=True,
            intent={
                "is_correction": True,
                "category": intent.category,
                "target": intent.target,
                "subject": intent.subject,
                "confidence": intent.confidence,
            },
            compiled_rule=rule.to_dict(),
            message=f"置信度 {intent.confidence} 低于阈值, 未自动添加",
        )

    # 5. 自动添加
    if req.auto_add:
        store.add_rule(rule)
        return CompileResponse(
            success=True,
            is_correction=True,
            intent={
                "is_correction": True,
                "category": intent.category,
                "target": intent.target,
                "subject": intent.subject,
                "confidence": intent.confidence,
                "detected_keywords": intent.detected_keywords,
            },
            rule_id=rule.rule_id,
            compiled_rule=rule.to_dict(),
            message="规则已编译并添加",
        )

    return CompileResponse(
        success=True,
        is_correction=True,
        intent={
            "is_correction": True,
            "category": intent.category,
            "target": intent.target,
            "subject": intent.subject,
            "confidence": intent.confidence,
            "detected_keywords": intent.detected_keywords,
        },
        compiled_rule=rule.to_dict(),
        message="规则已编译 (auto_add=False)",
    )


@router.post("/check", response_model=CheckResponse)
async def check_tool_call(req: CheckRequest):
    """预检查工具调用"""
    _, _, engine = _get_components()
    result = await engine.pre_tool_check(
        tool_name=req.tool_name,
        tool_args=req.tool_args,
        session_id=req.session_id,
    )
    return CheckResponse(
        allowed=result.allowed,
        rule_id=result.rule_id,
        rule_subject=result.rule_subject,
        reason=result.reason,
        suggestion=result.suggestion,
        tier=result.tier,
        action=result.action,
        check_time_ms=result.check_time_ms,
        warnings=result.warnings,
    )


@router.get("/rules")
async def list_rules(
    session_id: Optional[str] = Query(None, description="Session ID（可选）"),
    include_inactive: bool = Query(default=False, description="是否包含停用规则"),
    scope_filter: Optional[str] = Query(default=None, description="仅显示指定 scope: session/user/global"),
):
    """列出规则

    - 提供 session_id 时: 返回该 session + user + global scope 的所有 active 规则
    - 不提供 session_id 时: 返回全部规则（管理用）
    """
    _, store, _ = _get_components()
    if session_id is None:
        rules = store.list_rules(session_id=None, include_inactive=include_inactive)
    else:
        # 复用 get_active_rules 逻辑 (含 user/global scope)
        rules = store.get_active_rules(session_id, include_user_scope=True, include_global_scope=True)
        if include_inactive:
            # 合并已停用规则
            inactive = store.list_rules(
                session_id=session_id, include_inactive=True
            )
            active_ids = {r.rule_id for r in rules}
            rules = rules + [r for r in inactive if r.rule_id not in active_ids]
        # scope 过滤
        if scope_filter:
            rules = [r for r in rules if r.scope == scope_filter]
    return {
        "success": True,
        "count": len(rules),
        "rules": [r.to_dict() for r in rules],
    }


@router.get("/rules/{rule_id}")
async def get_rule(rule_id: str):
    """获取单条规则"""
    _, store, _ = _get_components()
    rule = store.get_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail=f"规则 {rule_id} 不存在")
    return {
        "success": True,
        "rule": rule.to_dict(),
    }


@router.delete("/rules/{rule_id}")
async def deactivate_rule(rule_id: str):
    """停用规则"""
    _, store, _ = _get_components()
    success = store.deactivate_rule(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"规则 {rule_id} 不存在")
    return {
        "success": True,
        "message": f"规则 {rule_id} 已停用",
    }


@router.delete("/rules/{rule_id}/hard")
async def delete_rule(rule_id: str):
    """物理删除规则"""
    _, store, _ = _get_components()
    success = store.delete_rule(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"规则 {rule_id} 不存在")
    return {
        "success": True,
        "message": f"规则 {rule_id} 已删除",
    }


@router.get("/stats")
async def get_stats(
    session_id: Optional[str] = Query(None, description="Session ID（可选）"),
):
    """统计"""
    _, store, _ = _get_components()
    stats = store.get_stats(session_id=session_id)
    return {
        "success": True,
        "stats": stats,
    }


@router.post("/clear")
async def clear_session_rules(
    session_id: str = Body(..., embed=True),
):
    """清空 session 规则"""
    _, store, _ = _get_components()
    count = store.clear_session(session_id)
    return {
        "success": True,
        "cleared": count,
        "message": f"已清空 {count} 条规则",
    }


@router.get("/subjects")
async def list_subjects():
    """列出所有已知主题及其规则信息"""
    from backend.app.services.trace_compiler import SUBJECT_PATTERNS
    subjects = []
    for name, data in SUBJECT_PATTERNS.items():
        subjects.append({
            "name": name,
            "tier": data["tier"],
            "rule_type": data["rule_type"],
            "check": data["check"],
            "tier_rationale": data["tier_rationale"],
        })
    return {
        "success": True,
        "count": len(subjects),
        "subjects": sorted(subjects, key=lambda x: (x["tier"], x["name"])),
    }
