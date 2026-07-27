"""
# ============================================================
# LLM 缓存 API 端点 (v1.0.0) - Cycle 6 P0-7-A
# ============================================================
# 核心作用：提供 LLM 缓存的查询/统计/清空/测试接口
# 运行流程：
#   1. GET /api/cache/stats - 获取缓存统计
#   2. POST /api/cache/clear - 清空所有缓存
#   3. POST /api/cache/test - 测试缓存查找（不执行 LLM）
#   4. POST /api/cache/put - 手动写入缓存（admin）
#   5. GET /api/cache/config - 获取缓存配置
# 输入参数：见各端点
# 输出结果：JSON 响应
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 6 P0-7-A 新建
# ============================================================
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.llm_cache import (
    LLMCacheManager,
    get_cache_manager,
    reset_cache_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cache", tags=["cache"])


# ============================================================
# Request/Response Models
# ============================================================


class CacheTestRequest(BaseModel):
    """测试缓存查找请求"""

    system: str = Field(..., description="系统 prompt")
    user: str = Field(..., description="用户 prompt")
    model: str = Field(default="claude-sonnet-4", description="模型名称")
    max_tokens: int = Field(default=4096, description="最大 token 数")


class CachePutRequest(BaseModel):
    """手动写入缓存请求"""

    system: str = Field(..., description="系统 prompt")
    user: str = Field(..., description="用户 prompt")
    model: str = Field(default="claude-sonnet-4", description="模型名称")
    max_tokens: int = Field(default=4096, description="最大 token 数")
    response: str = Field(..., description="LLM 响应内容")


class CacheClearResponse(BaseModel):
    """清空缓存响应"""

    l1_cleared: int
    l2_cleared: int
    l3_cleared: int
    total_cleared: int


# ============================================================
# 端点
# ============================================================


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """
    获取缓存统计信息

    返回值：
      - l1_hits/l2_hits/l3_hits/l4_dedup_hits: 各层命中数
      - total_requests: 总请求数
      - hit_rate: 命中率 (0.0-1.0)
      - saved_tokens: 节省的 token 数
      - saved_cost_usd: 节省的成本（USD）
      - l1_size/l2_size/l3_size: 各层当前大小
      - l4_active: L4 in-flight 数量
    """
    try:
        cache = await get_cache_manager()
        stats = await cache.get_stats()
        return {"success": True, "stats": stats}
    except Exception as e:
        logger.error(f"获取缓存统计失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear")
async def clear_cache() -> Dict[str, Any]:
    """
    清空所有 4 层缓存

    返回值：每层清空的条目数
    """
    try:
        cache = await get_cache_manager()
        result = await cache.clear_all()
        result["total_cleared"] = (
            result["l1_cleared"] + result["l2_cleared"] + result["l3_cleared"]
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"清空缓存失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test")
async def test_cache(request: CacheTestRequest) -> Dict[str, Any]:
    """
    测试缓存查找（不执行 LLM）

    用于验证缓存是否命中，便于调试
    """
    try:
        cache = await get_cache_manager()
        response, hit_layer = await cache.get(
            request.system, request.user, request.model, request.max_tokens
        )
        return {
            "success": True,
            "hit_layer": hit_layer,
            "cache_hit": response is not None,
            "response_preview": response[:200] if response else None,
        }
    except Exception as e:
        logger.error(f"缓存测试失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/put")
async def put_cache(request: CachePutRequest) -> Dict[str, Any]:
    """
    手动写入缓存（admin 端点）

    用于预热缓存或调试
    """
    try:
        cache = await get_cache_manager()
        await cache.put(
            request.system,
            request.user,
            request.model,
            request.max_tokens,
            request.response,
        )
        return {
            "success": True,
            "message": "缓存写入成功",
            "system_length": len(request.system),
            "user_length": len(request.user),
            "response_length": len(request.response),
        }
    except Exception as e:
        logger.error(f"写入缓存失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset")
async def reset_cache() -> Dict[str, Any]:
    """
    重置全局缓存管理器（创建新实例）

    主要用于测试场景
    """
    try:
        reset_cache_manager()
        cache = await get_cache_manager()
        stats = await cache.get_stats()
        return {
            "success": True,
            "message": "缓存管理器已重置",
            "stats": stats,
        }
    except Exception as e:
        logger.error(f"重置缓存失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
async def get_config() -> Dict[str, Any]:
    """
    获取缓存配置信息
    """
    cache = await get_cache_manager()
    return {
        "success": True,
        "config": {
            "l1_max_size": cache.l1._max_size,
            "l1_ttl_seconds": cache.l1._ttl_seconds,
            "l2_max_size": cache.l2._max_size,
            "l2_threshold": cache.l2._threshold,
            "l3_max_size": cache.l3._max_size,
            "l3_ttl_seconds": cache.l3._ttl_seconds,
            "cost_per_1k_input_usd": cache._cost_per_1k_input,
            "cost_per_1k_output_usd": cache._cost_per_1k_output,
        },
    }
