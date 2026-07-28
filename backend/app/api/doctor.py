"""
# ============================================================
# Doctor REST API - 环境诊断系统
# ============================================================
# 核心作用：提供 doctor 功能的 REST API 端点
# 端点：
#   - GET  /health                 - 健康检查
#   - GET  /run                    - 完整诊断
#   - GET  /run?category={name}    - 单类诊断
#   - GET  /{category}             - 类别诊断
#   - POST /feedback               - 反馈诊断结果
#   - GET  /history                - 历史报告列表
#   - GET  /history/{id}           - 单个历史报告
#   - GET  /fix/{check_id}         - 获取修复建议
#   - GET  /categories             - 列出所有分类
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.doctor import (
    CHECKER_REGISTRY,
    CATEGORY_TITLES,
    DoctorReport,
    FixAdvisor,
    get_doctor_runner,
    get_fix_advisor,
    get_formatter,
    get_history_store,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Doctor"])


# ============================================================
# 请求/响应模型
# ============================================================
class FeedbackRequest(BaseModel):
    """反馈请求"""
    report_id: str
    user_comment: Optional[str] = None
    contact_email: Optional[str] = None
    auto_collected: bool = Field(default=True, description="是否自动收集系统信息")


class FeedbackResponse(BaseModel):
    """反馈响应"""
    success: bool
    feedback_id: str
    message: str
    timestamp: str


class CategoryInfo(BaseModel):
    """分类信息"""
    name: str
    title: str
    description: str
    check_count_estimate: int


# ============================================================
# 反馈存储（简化：JSONL）
# ============================================================
def _get_feedback_path() -> Path:
    """反馈文件路径"""
    hermes_home = Path.home() / ".hermes"
    fb_dir = hermes_home / "doctor" / "feedback"
    fb_dir.mkdir(parents=True, exist_ok=True)
    return fb_dir / "feedback.jsonl"


def _save_feedback(data: Dict[str, Any]) -> str:
    """保存反馈到 JSONL"""
    feedback_id = f"fb_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    data["feedback_id"] = feedback_id
    data["timestamp"] = datetime.now(timezone.utc).isoformat()
    path = _get_feedback_path()
    with open(path, "a", encoding="utf-8") as f:
        import json
        f.write(json.dumps(data, ensure_ascii=False) + "\n")
    return feedback_id


# ============================================================
# 端点实现
# ============================================================
@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    return {
        "success": True,
        "service": "doctor",
        "version": "1.0.0",
        "categories": list(CHECKER_REGISTRY.keys()),
        "features": [
            "environment_check",
            "workspace_check",
            "llm_check",
            "database_check",
            "mcp_check",
            "dependencies_check",
            "fix_advisor",
            "report_history",
        ],
    }


@router.get("/categories")
async def list_categories() -> Dict[str, Any]:
    """列出所有诊断分类"""
    categories = []
    descriptions = {
        "environment": "环境变量 / Shell 工具 / OS 信息",
        "workspace": "工作区状态 / Git 仓库 / .trae 配置",
        "llm": "API 可达性 / 模型可用性 / Token 预算",
        "database": "连接 / 迁移 / 表结构",
        "mcp": "服务器配置 / 启动状态 / 协议版本",
        "dependencies": "运行时依赖版本 / 第三方包",
    }
    for name, cls in CHECKER_REGISTRY.items():
        # 尝试估算检查项数
        try:
            instance = cls()
            check_count = len(instance.run_checks())
        except Exception:
            check_count = 0
        categories.append({
            "name": name,
            "title": CATEGORY_TITLES.get(name, name),
            "description": descriptions.get(name, ""),
            "check_count_estimate": check_count,
        })
    return {"success": True, "count": len(categories), "categories": categories}


@router.get("/run")
async def run_diagnosis(
    category: Optional[str] = Query(default=None, description="指定分类"),
    save_history: bool = Query(default=True, description="是否保存到历史"),
) -> Dict[str, Any]:
    """
    运行诊断
    - 不传 category：运行全部 6 大类
    - 传 category：运行单个分类
    """
    runner = get_doctor_runner()

    if category:
        if category not in CHECKER_REGISTRY:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_category",
                    "valid_categories": list(CHECKER_REGISTRY.keys()),
                },
            )
        report = runner.run_all(parallel=True, categories=[category])
    else:
        report = runner.run_all(parallel=True)

    # 保存历史
    if save_history:
        try:
            store = get_history_store()
            store.save(report)
        except Exception as e:
            logger.warning(f"failed to save doctor history: {e}")

    return {
        "success": True,
        "report": report.to_dict(),
    }


@router.post("/feedback")
async def submit_feedback(req: FeedbackRequest) -> FeedbackResponse:
    """提交诊断反馈"""
    # 验证 report_id 是否存在
    history = get_history_store()
    if not history.get(req.report_id):
        raise HTTPException(
            status_code=404,
            detail={"error": "report_not_found", "report_id": req.report_id},
        )

    feedback_id = _save_feedback({
        "report_id": req.report_id,
        "user_comment": req.user_comment,
        "contact_email": req.contact_email,
        "auto_collected": req.auto_collected,
    })

    return FeedbackResponse(
        success=True,
        feedback_id=feedback_id,
        message="feedback recorded, thank you!",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/history")
async def list_history(limit: int = Query(default=20, ge=1, le=100)) -> Dict[str, Any]:
    """列出历史报告"""
    history = get_history_store()
    reports = history.list_reports(limit=limit)
    return {
        "success": True,
        "count": len(reports),
        "total": history.count(),
        "reports": reports,
    }


@router.get("/history/{report_id}")
async def get_history_report(report_id: str) -> Dict[str, Any]:
    """获取单个历史报告（仅元信息，不含完整内容）"""
    history = get_history_store()
    report = history.get(report_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail={"error": "report_not_found", "report_id": report_id},
        )
    return {
        "success": True,
        "summary": {
            "report_id": report.report_id,
            "timestamp": report.timestamp,
            "hostname": report.hostname,
            "hermes_version": report.hermes_version,
            "duration_ms": report.duration_ms,
            "overall_status": report.overall_status,
            "summary": report.summary,
        },
    }


@router.get("/fix/{check_id:path}")
async def get_fix_suggestion(check_id: str) -> Dict[str, Any]:
    """获取修复建议"""
    advisor = get_fix_advisor()
    fix = advisor.get_fix(check_id)
    if not fix:
        raise HTTPException(
            status_code=404,
            detail={"error": "fix_not_found", "check_id": check_id},
        )
    return {
        "success": True,
        "fix": fix.to_dict(),
    }


@router.get("/fixes/all/list")
async def list_all_fixes() -> Dict[str, Any]:
    """列出所有可用修复"""
    advisor = get_fix_advisor()
    all_fixes = advisor.list_all()
    # 统计
    total = sum(len(v) for v in all_fixes.values())
    return {
        "success": True,
        "total": total,
        "by_category": all_fixes,
    }


# ============================================================
# 兜底路由：/{category} 必须放在最后！
# FastAPI 按注册顺序匹配路由，若 /{category} 在前会拦截所有路径
# ============================================================
@router.get("/{category}")
async def run_category(category: str) -> Dict[str, Any]:
    """运行单个分类诊断（兜底路由）"""
    if category not in CHECKER_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_category",
                "valid_categories": list(CHECKER_REGISTRY.keys()),
            },
        )
    runner = get_doctor_runner()
    cat_report = runner.run_category(category)
    return {
        "success": True,
        "category": cat_report.to_dict(),
    }
