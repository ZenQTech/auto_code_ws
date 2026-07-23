"""
# ============================================================
# 安全审核 API 路由（V4.3 新增 - 代码优化 Task 1）
# ============================================================
# 核心作用：提供安全审核记录的查询和创建 API 端点，
#           对接 SecurityReviewManager 和 SecurityReviewPanel
# 运行流程：
#   1. GET /api/security/review?task_id=xxx — 查询指定任务的安全审核记录
#   2. POST /api/security/review — 创建新的安全审核
# 输入参数：
#   - GET：task_id（可选，不传返回全部）
#   - POST：module_name, code_path, risk_level
# 输出结果：SecurityReview 记录列表或单条记录
# 修改记录：
#   - 2026-06-24 | v4.3.0 | 初始版本，补全缺失的安全审核路由
# ============================================================
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.security_checker import SecurityReviewManager

logger = logging.getLogger(__name__)

# 全局安全审核管理器单例
security_review_manager = SecurityReviewManager()

router = APIRouter()


# ============================================================
# Pydantic 模型
# ============================================================

class CreateReviewRequest(BaseModel):
    """
    创建安全审核请求
    字段说明：
      - module_name: 审核模块名称
      - code_path: 代码文件路径
      - risk_level: 风险等级（extremely_high/high/medium/low）
      - reviewer: 审核人（可选）
    """
    module_name: str = Field(..., description="审核模块名称")
    code_path: str = Field(..., description="代码文件路径")
    risk_level: str = Field(..., description="风险等级")
    reviewer: str = Field(default="", description="审核人")


class ReviewResponse(BaseModel):
    """
    安全审核记录响应
    """
    review_id: str
    module_name: str
    code_path: str
    risk_level: str
    status: str
    created_at: str
    review_items: List[dict] = []
    history: List[dict] = []


# ============================================================
# API 端点
# ============================================================

@router.get("/review")
async def get_reviews(
    task_id: Optional[str] = Query(default=None, description="任务 ID"),
):
    """
    查询安全审核记录
    运行步骤：
      1. 从持久化目录加载所有审核记录
      2. 若传入 task_id，过滤对应任务记录
      3. 返回记录列表
    调用方：前端 SecurityReviewPanel.tsx
    被调用方：SecurityReviewManager
    参数：
      - task_id: 可选，任务 ID
    返回值：审核记录列表
    """
    try:
        records = security_review_manager.load_persisted_records()
        if task_id:
            records = [r for r in records if r.get("task_id") == task_id]
        return {"status": "ok", "data": records}
    except Exception as e:
        logger.error(f"查询安全审核记录失败: {e}")
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


@router.post("/review")
async def create_review(body: CreateReviewRequest):
    """
    创建安全审核记录
    运行步骤：
      1. 调用 SecurityReviewManager.create_review 创建审核
      2. 返回创建的审核记录
    调用方：前端 SecurityReviewPanel.tsx
    被调用方：SecurityReviewManager
    参数：
      - body: CreateReviewRequest
    返回值：创建的审核记录
    """
    try:
        review = security_review_manager.create_review(
            module_name=body.module_name,
            code_path=body.code_path,
            risk_level=body.risk_level,
            reviewer=body.reviewer,
        )
        # 构建响应
        resp = ReviewResponse(
            review_id=review.get("review_id", ""),
            module_name=review.get("module_name", body.module_name),
            code_path=review.get("code_path", body.code_path),
            risk_level=review.get("risk_level", body.risk_level),
            status=review.get("status", "pending"),
            created_at=review.get("created_at", ""),
            review_items=review.get("review_items", []),
            history=review.get("history", []),
        )
        logger.info(f"安全审核已创建: {body.module_name} (风险={body.risk_level})")
        return {"status": "ok", "data": resp.model_dump()}
    except Exception as e:
        logger.error(f"创建安全审核失败: {e}")
        raise HTTPException(status_code=500, detail=f"创建失败: {str(e)}")
