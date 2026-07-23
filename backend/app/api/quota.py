"""
# ============================================================
# 配额管控 API 路由（V4.1 新增）
# ============================================================
# 核心作用：提供配额查询、告警状态、管控规则等 API 端点
# 运行流程：
#   1. 接收前端请求
#   2. 从 QuotaManager 获取实时配额数据
#   3. 返回结构化 JSON 响应
# 输入参数：无（GET 请求）
# 输出结果：配额统计、告警状态、管控规则等 JSON 数据
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本
# ============================================================
"""

import logging
from fastapi import APIRouter

from backend.app.services.quota_manager import quota_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/overview")
async def get_quota_overview():
    """
    获取配额总览
    返回值包含：
      - alert_level: 当前告警等级（0=无/1=一级/2=二级/3=三级）
      - is_fused: 是否已熔断
      - max_parallel: 当前允许的最大并行任务数
      - max_calls_per_minute: 当前允许的单分钟最大调用次数
      - usage_5h/usage_week/usage_month: 各维度用量详情
      - total_tokens: 累计 Token 消耗
      - model_stats: 单模型统计
    """
    return {
        "status": "ok",
        "data": quota_manager.get_stats(),
    }


@router.get("/alert")
async def get_alert_status():
    """
    获取告警状态
    返回值包含：
      - alert_level: 当前告警等级
      - is_fused: 是否已熔断
      - alert_message: 告警描述信息
    """
    level = quota_manager.get_alert_level()
    is_fused = quota_manager.is_fused()

    alert_messages = {
        0: "配额充足，正常运行",
        1: "配额消耗达到 50%，已触发一级告警",
        2: "配额消耗达到 80%，已触发二级告警",
        3: "配额已用尽，已触发三级熔断",
    }

    return {
        "status": "ok",
        "data": {
            "alert_level": level,
            "is_fused": is_fused,
            "alert_message": alert_messages.get(level, "未知状态"),
            "max_parallel": quota_manager.get_max_parallel(),
            "max_calls_per_minute": quota_manager.get_max_calls_per_minute(),
        },
    }


@router.get("/limits")
async def get_current_limits():
    """
    获取当前管控限制
    返回值包含：
      - can_make_call: 是否可以发起新的 API 调用
      - max_parallel: 最大并行任务数
      - max_calls_per_minute: 单分钟最大调用次数
    """
    return {
        "status": "ok",
        "data": {
            "can_make_call": quota_manager.can_make_call(),
            "max_parallel": quota_manager.get_max_parallel(),
            "max_calls_per_minute": quota_manager.get_max_calls_per_minute(),
        },
    }
