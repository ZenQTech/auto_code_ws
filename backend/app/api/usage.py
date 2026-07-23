"""
# ============================================================
# 用量监控 API 路由模块
# ============================================================
# 核心作用：提供用量数据查询接口，供前端用量面板调用
# 运行流程：
#   - GET /api/usage/overview: 返回用量概览数据
#     包含 recent_5h_api_calls / remaining_calls / total_tokens
# 输入参数：无（通过 UsageMonitor 单例获取数据）
# 输出结果：JSON 格式的用量概览数据
# ============================================================
# 修改记录：
#   v1.0.0 - 2026-06-17：初始版本，实现用量概览接口
# ============================================================
"""

import logging

from fastapi import APIRouter

from ..services.usage_monitor import usage_monitor

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/overview")
async def get_usage_overview():
    """
    获取用量概览数据
    调用方：前端 UsagePanel 组件
    被调用方：UsageMonitor.get_cached_usage()
    运行步骤：
      1. 调用 UsageMonitor 获取缓存用量数据
      2. 提取 recent_5h_api_calls / remaining_calls / total_tokens
      3. 返回 JSON 格式的用量概览
    参数：无
    返回值：包含用量概览字段的 JSON 字典
      - recent_5h_api_calls: int，最近 5 小时 API 调用次数
      - remaining_calls: int，剩余可用调用次数
      - total_tokens: int，累计 Token 消耗
      - is_mock: bool，是否为模拟数据
    """
    usage = await usage_monitor.get_cached_usage()

    return {
        "recent_5h_api_calls": usage.recent_5h_api_calls,
        "remaining_calls": usage.remaining_calls,
        "total_tokens": usage.total_tokens,
        "is_local": usage.is_local,
    }
