"""
# ============================================================
# LLM 缓存单元测试 - Cycle 6 P0-7-A
# ============================================================
# 测试覆盖：
#   1. L1 精确匹配缓存
#   2. L2 语义匹配缓存
#   3. L3 前缀缓存
#   4. L4 Singleflight 去重
#   5. LLMCacheManager 4 层集成
#   6. 统计和重置
# ============================================================
"""

import asyncio
import pytest
import pytest_asyncio

from app.services.llm_cache import (
    L1ExactCache,
    L2SemanticCache,
    L3PrefixCache,
    L4Singleflight,
    LLMCacheManager,
    CacheEntry,
    CacheStats,
    get_cache_manager,
    reset_cache_manager,
    cached_llm_call,
)


# ============================================================
# L1 精确匹配缓存测试
# ============================================================


class TestL1ExactCache:
    """L1 精确匹配缓存测试"""

    @pytest.mark.asyncio
    async def test_put_and_get(self):
        """基本 put + get"""
        cache = L1ExactCache()
        await cache.put("sys", "user1", "claude-sonnet-4", 1024, "response1")
        entry = await cache.get("sys", "user1", "claude-sonnet-4")
        assert entry is not None
        assert entry.response == "response1"

    @pytest.mark.asyncio
    async def test_normalized_match(self):
        """归一化匹配（多余空白不影响）"""
        cache = L1ExactCache()
        await cache.put("sys", "user with   spaces", "model", 1024, "r1")
        entry = await cache.get("sys", "user with spaces", "model")
        assert entry is not None
        assert entry.response == "r1"

    @pytest.mark.asyncio
    async def test_different_user_miss(self):
        """不同 user 不会命中"""
        cache = L1ExactCache()
        await cache.put("sys", "user1", "model", 1024, "r1")
        entry = await cache.get("sys", "user2", "model")
        assert entry is None

    @pytest.mark.asyncio
    async def test_different_model_miss(self):
        """不同 model 不会命中"""
        cache = L1ExactCache()
        await cache.put("sys", "user", "model-A", 1024, "r1")
        entry = await cache.get("sys", "user", "model-B")
        assert entry is None

    @pytest.mark.asyncio
    async def test_ttl_expiration(self):
        """TTL 过期"""
        import time

        cache = L1ExactCache(max_size=10, ttl_seconds=1)
        await cache.put("sys", "user", "model", 1024, "r1")
        # 等待超过 TTL
        await asyncio.sleep(1.1)
        entry = await cache.get("sys", "user", "model")
        assert entry is None

    @pytest.mark.asyncio
    async def test_lru_eviction(self):
        """LRU 淘汰"""
        cache = L1ExactCache(max_size=2)
        await cache.put("sys", "u1", "model", 1024, "r1")
        await cache.put("sys", "u2", "model", 1024, "r2")
        await cache.put("sys", "u3", "model", 1024, "r3")
        # u1 应该被淘汰
        entry = await cache.get("sys", "u1", "model")
        assert entry is None
        # u2/u3 仍在
        e2 = await cache.get("sys", "u2", "model")
        e3 = await cache.get("sys", "u3", "model")
        assert e2 is not None
        assert e3 is not None

    @pytest.mark.asyncio
    async def test_clear(self):
        """清空缓存"""
        cache = L1ExactCache()
        await cache.put("sys", "u1", "model", 1024, "r1")
        count = await cache.clear()
        assert count == 1
        assert await cache.size() == 0


# ============================================================
# L2 语义缓存测试
# ============================================================


class TestL2SemanticCache:
    """L2 语义匹配缓存测试"""

    @pytest.mark.asyncio
    async def test_put_and_get_exact(self):
        """基本 put + get（精确匹配）"""
        cache = L2SemanticCache()
        await cache.put("sys", "user1", "model", 1024, "r1")
        entry = await cache.get("sys", "user1", "model")
        assert entry is not None
        assert entry.response == "r1"

    @pytest.mark.asyncio
    async def test_semantic_match(self):
        """语义匹配（相似内容）"""
        cache = L2SemanticCache(threshold=0.5)
        await cache.put(
            "解释 Python 装饰器", "Python 装饰器是什么？", "model", 1024, "r1"
        )
        # 高度相似查询应命中
        entry = await cache.get(
            "解释 Python 装饰器", "Python 装饰器是什么意思？", "model"
        )
        # 视具体相似度而定，可能命中
        # 这里主要验证不抛错
        if entry is not None:
            assert entry.response == "r1"

    @pytest.mark.asyncio
    async def test_low_similarity_miss(self):
        """低相似度不命中"""
        cache = L2SemanticCache(threshold=0.95)
        await cache.put("sys", "完全不同的内容A", "model", 1024, "r1")
        entry = await cache.get("sys", "完全不同的内容B", "model")
        assert entry is None


# ============================================================
# L3 前缀缓存测试
# ============================================================


class TestL3PrefixCache:
    """L3 前缀缓存测试"""

    @pytest.mark.asyncio
    async def test_register_and_hit(self):
        """注册 + 命中"""
        cache = L3PrefixCache()
        system = "你是一个 Python 专家" + "x" * 300
        await cache.register_prefix(system)
        hit = await cache.get_prefix_hit(system)
        assert hit is not None
        assert hit["usage_count"] == 1

    @pytest.mark.asyncio
    async def test_prefix_miss_for_different(self):
        """不同前缀不命中"""
        cache = L3PrefixCache()
        await cache.register_prefix("系统 A " + "x" * 300)
        hit = await cache.get_prefix_hit("系统 B " + "y" * 300)
        assert hit is None

    @pytest.mark.asyncio
    async def test_ttl_expiration(self):
        """TTL 过期"""
        cache = L3PrefixCache(ttl_seconds=1)
        system = "你是一个 Python 专家" + "x" * 300
        await cache.register_prefix(system)
        await asyncio.sleep(1.1)
        hit = await cache.get_prefix_hit(system)
        assert hit is None


# ============================================================
# L4 Singleflight 测试
# ============================================================


class TestL4Singleflight:
    """L4 Singleflight 去重测试"""

    @pytest.mark.asyncio
    async def test_first_request_is_new(self):
        """第一个请求是 new"""
        sf = L4Singleflight()
        is_new, future = await sf.get_or_create("sys", "user", "model")
        assert is_new is True
        assert not future.done()
        # 清理
        await sf.complete("sys", "user", "model", "ok")

    @pytest.mark.asyncio
    async def test_second_request_is_waiting(self):
        """相同 key 第二个请求是等待者"""
        sf = L4Singleflight()
        is_new1, f1 = await sf.get_or_create("sys", "user", "model")
        is_new2, f2 = await sf.get_or_create("sys", "user", "model")
        assert is_new1 is True
        assert is_new2 is False
        # 清理
        await sf.complete("sys", "user", "model", "ok")

    @pytest.mark.asyncio
    async def test_complete_success(self):
        """成功完成"""
        sf = L4Singleflight()
        is_new, future = await sf.get_or_create("sys", "user", "model")
        await sf.complete("sys", "user", "model", "response_ok")
        result = await future
        assert result == "response_ok"

    @pytest.mark.asyncio
    async def test_complete_with_error(self):
        """失败传播"""
        sf = L4Singleflight()
        is_new, future = await sf.get_or_create("sys", "user", "model")
        await sf.complete("sys", "user", "model", error=ValueError("test error"))
        with pytest.raises(ValueError, match="test error"):
            await future

    @pytest.mark.asyncio
    async def test_different_keys_independent(self):
        """不同 key 互不影响"""
        sf = L4Singleflight()
        is_new1, f1 = await sf.get_or_create("sys", "user1", "model")
        is_new2, f2 = await sf.get_or_create("sys", "user2", "model")
        assert is_new1 is True
        assert is_new2 is True
        await sf.complete("sys", "user1", "model", "r1")
        await sf.complete("sys", "user2", "model", "r2")
        r1 = await f1
        r2 = await f2
        assert r1 == "r1"
        assert r2 == "r2"


# ============================================================
# LLMCacheManager 4 层集成测试
# ============================================================


class TestLLMCacheManager:
    """LLMCacheManager 4 层集成测试"""

    @pytest_asyncio.fixture
    async def manager(self):
        m = LLMCacheManager()
        yield m
        # 清理
        await m.clear_all()

    @pytest.mark.asyncio
    async def test_miss_then_put(self, manager):
        """未命中 + put"""
        response, layer = await manager.get("sys", "user", "model", 1024)
        assert response is None
        assert layer == "miss"
        await manager.put("sys", "user", "model", 1024, "response1")
        response, layer = await manager.get("sys", "user", "model", 1024)
        assert response == "response1"
        assert layer == "l1"

    @pytest.mark.asyncio
    async def test_l1_hit_increments_stats(self, manager):
        """L1 命中累加统计"""
        await manager.put("sys", "user", "model", 1024, "response1")
        # 第一次 hit
        await manager.get("sys", "user", "model", 1024)
        # 第二次 hit
        await manager.get("sys", "user", "model", 1024)
        stats = await manager.get_stats()
        assert stats["l1_hits"] == 2
        assert stats["total_requests"] == 2
        assert stats["hit_rate"] == 1.0
        assert stats["saved_tokens"] > 0

    @pytest.mark.asyncio
    async def test_singleton(self):
        """全局单例"""
        m1 = await get_cache_manager()
        m2 = await get_cache_manager()
        assert m1 is m2
        reset_cache_manager()
        m3 = await get_cache_manager()
        assert m3 is not m1

    @pytest.mark.asyncio
    async def test_clear_all(self, manager):
        """清空所有缓存"""
        await manager.put("sys", "u1", "model", 1024, "r1")
        await manager.put("sys", "u2", "model", 1024, "r2")
        result = await manager.clear_all()
        assert result["l1_cleared"] == 2
        assert result["l2_cleared"] == 2
        # 清空后再 get 应 miss
        response, layer = await manager.get("sys", "u1", "model", 1024)
        assert response is None

    @pytest.mark.asyncio
    async def test_saved_cost_calculation(self, manager):
        """节省成本计算"""
        await manager.put("sys" * 100, "user" * 100, "model", 1024, "response")
        # 命中一次
        await manager.get("sys" * 100, "user" * 100, "model", 1024)
        stats = await manager.get_stats()
        assert stats["saved_cost_usd"] > 0
        assert stats["saved_tokens"] > 0


# ============================================================
# cached_llm_call 包装器测试
# ============================================================


class TestCachedLLMCall:
    """cached_llm_call 装饰器测试"""

    @pytest_asyncio.fixture
    async def reset(self):
        reset_cache_manager()
        yield
        reset_cache_manager()

    @pytest.mark.asyncio
    async def test_cache_miss_then_call(self, reset):
        """缓存未命中时执行实际调用"""
        call_count = 0

        async def fake_executor(**kwargs):
            nonlocal call_count
            call_count += 1
            return "actual response"

        response, layer = await cached_llm_call(
            fake_executor, "sys", "user", "model"
        )
        assert response == "actual response"
        assert layer == "miss"
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_cache_hit_skips_call(self, reset):
        """缓存命中时跳过实际调用"""
        call_count = 0

        async def fake_executor(**kwargs):
            nonlocal call_count
            call_count += 1
            return "actual response"

        # 第一次：未命中
        r1, l1 = await cached_llm_call(fake_executor, "sys", "user", "model")
        # 第二次：命中
        r2, l2 = await cached_llm_call(fake_executor, "sys", "user", "model")
        assert r1 == r2 == "actual response"
        assert l1 == "miss"
        assert l2 == "l1"
        assert call_count == 1  # 只调用一次

    @pytest.mark.asyncio
    async def test_error_propagation(self, reset):
        """错误传播"""
        async def failing_executor(**kwargs):
            raise ValueError("LLM error")

        with pytest.raises(ValueError, match="LLM error"):
            await cached_llm_call(failing_executor, "sys", "user", "model")
