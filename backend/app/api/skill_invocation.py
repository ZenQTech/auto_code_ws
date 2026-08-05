"""
# ============================================================
# Skill Invocation API 路由
# Cycle 70 G70-01 - 对标 Codex CLI Skills 显式/隐式调用
# ============================================================
# 端点：
#   - POST   /api/skill-invocation/match         隐式匹配
#   - POST   /api/skill-invocation/invoke        显式调用
#   - POST   /api/skill-invocation/process       统一入口（自动识别显式/隐式）
#   - GET    /api/skill-invocation/history       调用历史
# 创建日期：2026-08-05
# 模块版本：v1.0.0
# ============================================================
"""

import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query

from backend.app.services.skill_invocation import get_skill_invocation_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/skill-invocation/match")
async def match_skills(body: Dict[str, Any]):
    """隐式匹配 skill

    请求体：
      {
        "query": "请帮我审查代码",
        "top_k": 3,           // 可选，默认 3
        "threshold": 0.2      // 可选，默认 0.2
      }
    """
    service = get_skill_invocation_service()
    query = body.get("query", "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query 字段不能为空")

    top_k = body.get("top_k", 3)
    threshold = body.get("threshold")

    try:
        matches, duration_ms = service.match_implicit(
            query, top_k=top_k, threshold=threshold,
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"参数非法: {e}")

    return {
        "success": True,
        "matches": [m.to_dict() for m in matches],
        "count": len(matches),
        "threshold": threshold or 0.2,
        "inference_ms": duration_ms,
    }


@router.post("/skill-invocation/invoke")
async def invoke_skill(body: Dict[str, Any]):
    """显式调用 skill

    请求体：
      {
        "skill_name": "code-reviewer",
        "args": {"file_path": "src/api/users.py"},
        "context": "请审查这段代码"
      }
    """
    service = get_skill_invocation_service()
    skill_name = body.get("skill_name", "").strip()
    if not skill_name:
        raise HTTPException(status_code=400, detail="skill_name 字段不能为空")

    args = body.get("args", {})
    context = body.get("context")

    invocation, skill = service.invoke_explicit(
        skill_name, args=args, context=context,
    )

    if skill is None:
        # 调用失败
        if invocation and not invocation.success:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": invocation.error,
                    "invocation": invocation.to_dict(),
                },
            )
        raise HTTPException(
            status_code=404, detail=f"Skill 不存在: {skill_name}",
        )

    return {
        "success": True,
        "invocation": invocation.to_dict() if invocation else None,
        "skill": skill.to_dict(),
    }


@router.post("/skill-invocation/process")
async def process_invocation(body: Dict[str, Any]):
    """统一处理入口（自动识别显式/隐式）

    请求体：
      {
        "query": "请审查代码" | "$code-reviewer 审查 src/api/users.py",
        "args": {}  // 可选
      }
    """
    service = get_skill_invocation_service()
    query = body.get("query", "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query 字段不能为空")

    args = body.get("args", {})
    return {
        "success": True,
        **service.process(query, args=args),
    }


@router.get("/skill-invocation/history")
async def get_history(limit: int = Query(50, ge=1, le=1000)):
    """获取调用历史"""
    service = get_skill_invocation_service()
    history = service.get_history(limit=limit)
    return {
        "success": True,
        "history": [inv.to_dict() for inv in history],
        "count": len(history),
    }
