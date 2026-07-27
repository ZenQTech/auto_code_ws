"""
# ============================================================
# LLM 缓存服务 (v1.0.0) - Cycle 6 P0-7-A
# ============================================================
# 核心作用：为 LLM 调用提供 4 层缓存，减少 API 成本和延迟
#           参考 Codex v0.145.0 增量 Markdown 渲染 + Cloudflare Agents SDK fiber-refactor
# 运行流程：
#   1. L1 精确匹配缓存（SHA-256 内容哈希）
#   2. L2 语义缓存（TF-IDF 关键词相似度，~95% 阈值）
#   3. L3 Prompt 前缀缓存（复用 provider-side KV-Cache key）
#   4. L4 Singleflight 去重（进程内 Map + 等待 future）
# 输入参数：
#   - system: 系统 prompt
#   - user: 用户 prompt
#   - max_tokens: 最大 token 数
#   - model: 模型名称（用于 key 隔离）
# 输出结果：缓存命中返回字符串；未命中返回 None
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 6 P0-7-A 新建
#     - 4 层缓存架构：exact + semantic + prefix + singleflight
#     - TTLCache (LRU) 基础实现
#     - Hash 计算 + 内容归一化
#     - 统计接口（hit/miss/saved_cost）
# ============================================================
"""

import asyncio
import hashlib
import json
import logging
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 数据结构
# ============================================================


@dataclass
class CacheEntry:
    """
    缓存条目

    字段：
      - key: 缓存键（SHA-256）
      - system: 系统 prompt
      - user: 用户 prompt
      - response: LLM 响应内容
      - model: 模型名称
      - max_tokens: 最大 token 数
      - created_at: 创建时间（秒）
      - last_accessed_at: 最后访问时间（秒）
      - access_count: 访问次数
      - hit_count: 命中次数
      - estimated_tokens: 估算的输入 token 数
    """

    key: str
    system: str
    user: str
    response: str
    model: str
    max_tokens: int
    created_at: float
    last_accessed_at: float
    access_count: int = 0
    hit_count: int = 0
    estimated_tokens: int = 0


@dataclass
class CacheStats:
    """
    缓存统计

    字段：
      - total_requests: 总请求数
      - l1_hits: L1 精确匹配命中数
      - l2_hits: L2 语义匹配命中数
      - l3_hits: L3 前缀匹配命中数
      - l4_dedup_hits: L4 singleflight 去重命中数
      - misses: 未命中数
      - hit_rate: 命中率（0.0-1.0）
      - saved_tokens: 节省的 token 数（估算）
      - saved_cost_usd: 节省的成本（USD，估算）
      - evictions: 驱逐数
    """

    total_requests: int = 0
    l1_hits: int = 0
    l2_hits: int = 0
    l3_hits: int = 0
    l4_dedup_hits: int = 0
    misses: int = 0
    hit_rate: float = 0.0
    saved_tokens: int = 0
    saved_cost_usd: float = 0.0
    evictions: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_requests": self.total_requests,
            "l1_hits": self.l1_hits,
            "l2_hits": self.l2_hits,
            "l3_hits": self.l3_hits,
            "l4_dedup_hits": self.l4_dedup_hits,
            "misses": self.misses,
            "hit_rate": round(self.hit_rate, 4),
            "saved_tokens": self.saved_tokens,
            "saved_cost_usd": round(self.saved_cost_usd, 4),
            "evictions": self.evictions,
        }


# ============================================================
# L1: 精确匹配缓存
# ============================================================


class L1ExactCache:
    """
    L1 精确匹配缓存

    使用 SHA-256 内容哈希作为 key，支持 LRU 淘汰
    默认容量 1000 条目
    """

    def __init__(self, max_size: int = 1000, ttl_seconds: int = 3600):
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._max_size = max_size
        self._ttl_seconds = ttl_seconds
        self._lock = asyncio.Lock()

    def _normalize(self, system: str, user: str) -> str:
        """
        归一化内容（去多余空白）后计算 SHA-256
        """
        # 归一化空白
        sys_norm = re.sub(r"\s+", " ", system.strip())
        user_norm = re.sub(r"\s+", " ", user.strip())
        content = f"{sys_norm}|||{user_norm}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    async def get(self, system: str, user: str, model: str) -> Optional[CacheEntry]:
        """
        获取缓存条目
        """
        key = self._normalize(system, user)
        async with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            # 检查 TTL
            if time.time() - entry.created_at > self._ttl_seconds:
                del self._cache[key]
                return None
            # 检查 model 匹配
            if entry.model != model:
                return None
            # 更新 LRU
            entry.last_accessed_at = time.time()
            entry.access_count += 1
            entry.hit_count += 1
            self._cache.move_to_end(key)
            return entry

    async def put(
        self,
        system: str,
        user: str,
        model: str,
        max_tokens: int,
        response: str,
    ) -> CacheEntry:
        """
        放入缓存
        """
        key = self._normalize(system, user)
        async with self._lock:
            now = time.time()
            # 估算 token 数（简单按字符数 / 4）
            estimated_tokens = (len(system) + len(user)) // 4
            entry = CacheEntry(
                key=key,
                system=system,
                user=user,
                response=response,
                model=model,
                max_tokens=max_tokens,
                created_at=now,
                last_accessed_at=now,
                access_count=0,
                hit_count=0,
                estimated_tokens=estimated_tokens,
            )
            self._cache[key] = entry
            # LRU 淘汰
            if len(self._cache) > self._max_size:
                self._cache.popitem(last=False)
            return entry

    async def clear(self) -> int:
        """
        清空缓存
        """
        async with self._lock:
            count = len(self._cache)
            self._cache.clear()
            return count

    async def size(self) -> int:
        async with self._lock:
            return len(self._cache)


# ============================================================
# L2: 语义缓存（TF-IDF 关键词相似度）
# ============================================================


class L2SemanticCache:
    """
    L2 语义缓存

    使用 TF-IDF 关键词相似度（~95% 阈值）作为匹配依据
    当 L1 未命中时，查找最相似的缓存条目
    """

    def __init__(self, max_size: int = 500, threshold: float = 0.85):
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._max_size = max_size
        self._threshold = threshold
        self._lock = asyncio.Lock()

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """
        简单分词：转小写 + 提取中英文词
        """
        # 提取英文词
        en_words = re.findall(r"[a-zA-Z]+", text.lower())
        # 提取中文字符（每个字符作为一个 token）
        zh_chars = re.findall(r"[\u4e00-\u9fff]", text)
        return en_words + zh_chars

    @staticmethod
    def _tfidf_similarity(text1: str, text2: str) -> float:
        """
        计算两个文本的 TF-IDF 相似度（简化版）
        使用 Jaccard + 长度比作为近似
        """
        tokens1 = set(L2SemanticCache._tokenize(text1))
        tokens2 = set(L2SemanticCache._tokenize(text2))

        if not tokens1 or not tokens2:
            return 0.0

        # Jaccard 相似度
        intersection = tokens1 & tokens2
        union = tokens1 | tokens2
        jaccard = len(intersection) / len(union) if union else 0.0

        # 长度比惩罚（避免长短差异过大）
        len_ratio = min(len(tokens1), len(tokens2)) / max(len(tokens1), len(tokens2))

        return jaccard * len_ratio

    def _normalize(self, system: str, user: str) -> str:
        content = f"{system.strip()}|||{user.strip()}"
        return hashlib.md5(content.encode("utf-8")).hexdigest()

    async def get(
        self, system: str, user: str, model: str
    ) -> Optional[CacheEntry]:
        """
        查找最相似的缓存条目
        """
        target_text = f"{system}\n{user}"
        async with self._lock:
            best_entry: Optional[CacheEntry] = None
            best_score: float = 0.0

            for entry in self._cache.values():
                if entry.model != model:
                    continue
                if time.time() - entry.created_at > 3600:
                    continue
                score = self._tfidf_similarity(target_text, f"{entry.system}\n{entry.user}")
                if score > best_score:
                    best_score = score
                    best_entry = entry

            if best_entry is None or best_score < self._threshold:
                return None

            best_entry.last_accessed_at = time.time()
            best_entry.access_count += 1
            best_entry.hit_count += 1
            self._cache.move_to_end(best_entry.key)
            return best_entry

    async def put(
        self,
        system: str,
        user: str,
        model: str,
        max_tokens: int,
        response: str,
    ) -> CacheEntry:
        """
        放入缓存
        """
        key = self._normalize(system, user)
        async with self._lock:
            now = time.time()
            estimated_tokens = (len(system) + len(user)) // 4
            entry = CacheEntry(
                key=key,
                system=system,
                user=user,
                response=response,
                model=model,
                max_tokens=max_tokens,
                created_at=now,
                last_accessed_at=now,
                access_count=0,
                hit_count=0,
                estimated_tokens=estimated_tokens,
            )
            self._cache[key] = entry
            if len(self._cache) > self._max_size:
                self._cache.popitem(last=False)
            return entry

    async def clear(self) -> int:
        async with self._lock:
            count = len(self._cache)
            self._cache.clear()
            return count

    async def size(self) -> int:
        async with self._lock:
            return len(self._cache)


# ============================================================
# L3: 前缀缓存
# ============================================================


class L3PrefixCache:
    """
    L3 前缀缓存

    复用 provider-side KV-Cache（Claude prompt caching / OpenAI automatic caching）
    通过共享 system prompt 的前缀来减少 input token 计费
    """

    def __init__(self, max_size: int = 100, ttl_seconds: int = 300):
        self._cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        self._max_size = max_size
        self._ttl_seconds = ttl_seconds
        self._lock = asyncio.Lock()

    def _extract_prefix(self, system: str) -> str:
        """
        提取 system prompt 的前 256 字符作为前缀 key
        """
        return system[:256]

    async def get_prefix_hit(self, system: str) -> Optional[Dict[str, Any]]:
        """
        检查是否有匹配的前缀缓存

        返回值：
          - None: 未命中
          - Dict: {"prefix_hash": str, "usage_count": int, "saved_tokens": int}
        """
        prefix = self._extract_prefix(system)
        prefix_key = hashlib.sha256(prefix.encode("utf-8")).hexdigest()
        async with self._lock:
            entry = self._cache.get(prefix_key)
            if entry is None:
                return None
            if time.time() - entry["created_at"] > self._ttl_seconds:
                del self._cache[prefix_key]
                return None
            entry["usage_count"] += 1
            entry["saved_tokens"] += len(prefix) // 4
            self._cache.move_to_end(prefix_key)
            return entry

    async def register_prefix(self, system: str) -> str:
        """
        注册一个新的前缀缓存

        返回值：prefix_key
        """
        prefix = self._extract_prefix(system)
        prefix_key = hashlib.sha256(prefix.encode("utf-8")).hexdigest()
        async with self._lock:
            self._cache[prefix_key] = {
                "prefix": prefix,
                "prefix_hash": prefix_key,
                "created_at": time.time(),
                "usage_count": 0,
                "saved_tokens": 0,
            }
            if len(self._cache) > self._max_size:
                self._cache.popitem(last=False)
            return prefix_key

    async def clear(self) -> int:
        async with self._lock:
            count = len(self._cache)
            self._cache.clear()
            return count

    async def size(self) -> int:
        async with self._lock:
            return len(self._cache)


# ============================================================
# L4: Singleflight 去重
# ============================================================


class L4Singleflight:
    """
    L4 Singleflight 去重

    在同一 key 有正在进行的请求时，新请求等待 future 完成
    避免雷鸣群（thundering herd）问题
    """

    def __init__(self):
        self._in_flight: Dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    def _key(self, system: str, user: str, model: str) -> str:
        content = f"{model}|||{system.strip()}|||{user.strip()}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    async def get_or_create(
        self, system: str, user: str, model: str
    ) -> Tuple[bool, asyncio.Future]:
        """
        获取或创建 future

        返回值：(is_new, future)
          - is_new=True: 当前请求是第一个，需要执行 LLM 调用
          - is_new=False: 当前请求是等待者，可以等待 future 完成
        """
        key = self._key(system, user, model)
        async with self._lock:
            existing = self._in_flight.get(key)
            if existing is not None and not existing.done():
                return False, existing
            # 创建新 future
            future: asyncio.Future = asyncio.Future()
            self._in_flight[key] = future
            return True, future

    async def complete(
        self,
        system: str,
        user: str,
        model: str,
        response: Optional[str] = None,
        error: Optional[Exception] = None,
    ) -> None:
        """
        标记 future 完成（成功或失败）

        参数：
          - response: 成功响应（error=None 时使用）
          - error: 异常（失败时使用）
        """
        key = self._key(system, user, model)
        async with self._lock:
            future = self._in_flight.pop(key, None)
        if future is None:
            return
        if future.done():
            return
        if error is not None:
            future.set_exception(error)
        else:
            future.set_result(response)

    async def active_count(self) -> int:
        async with self._lock:
            return len(self._in_flight)


# ============================================================
# LLM Cache Manager: 4 层缓存统一管理
# ============================================================


class LLMCacheManager:
    """
    LLM 缓存管理器（4 层架构）

    流程：
      1. L1 精确匹配 → 命中返回
      2. L4 singleflight 检查 → 等待 in-flight 请求
      3. L2 语义匹配 → 命中返回
      4. L3 前缀注册 → 记录 prefix usage
      5. 未命中 → 实际 LLM 调用 → 写入 L1 + L2
    """

    def __init__(
        self,
        l1_max_size: int = 1000,
        l2_max_size: int = 500,
        l3_max_size: int = 100,
        l2_threshold: float = 0.85,
        l1_ttl: int = 3600,
        l3_ttl: int = 300,
        # 成本估算（USD per 1K tokens）
        cost_per_1k_input: float = 0.003,
        cost_per_1k_output: float = 0.015,
    ):
        self.l1 = L1ExactCache(max_size=l1_max_size, ttl_seconds=l1_ttl)
        self.l2 = L2SemanticCache(max_size=l2_max_size, threshold=l2_threshold)
        self.l3 = L3PrefixCache(max_size=l3_max_size, ttl_seconds=l3_ttl)
        self.l4 = L4Singleflight()
        self._stats = CacheStats()
        self._stats_lock = asyncio.Lock()
        # 成本估算
        self._cost_per_1k_input = cost_per_1k_input
        self._cost_per_1k_output = cost_per_1k_output

    async def get(
        self, system: str, user: str, model: str, max_tokens: int = 4096
    ) -> Tuple[Optional[str], str]:
        """
        4 层缓存查找

        返回值：(response, hit_layer)
          - response: 响应内容（None 表示未命中）
          - hit_layer: 'l1' | 'l2' | 'l3' | 'l4' | 'miss'
        """
        async with self._stats_lock:
            self._stats.total_requests += 1

        # L1: 精确匹配
        entry = await self.l1.get(system, user, model)
        if entry is not None:
            await self._record_hit("l1", entry.estimated_tokens)
            return entry.response, "l1"

        # L4: Singleflight 去重
        is_new, future = await self.l4.get_or_create(system, user, model)
        if not is_new:
            # 等待 in-flight 请求完成
            try:
                response = await asyncio.wait_for(future, timeout=120.0)
                await self._record_hit("l4", (len(system) + len(user)) // 4)
                return response, "l4"
            except asyncio.TimeoutError:
                logger.warning(f"Singleflight wait timeout: {model}")

        # L2: 语义匹配
        entry = await self.l2.get(system, user, model)
        if entry is not None:
            await self._record_hit("l2", entry.estimated_tokens)
            # 回填 L1
            await self.l1.put(system, user, model, max_tokens, entry.response)
            return entry.response, "l2"

        # L3: 前缀缓存（只记录，不直接返回）
        prefix_hit = await self.l3.get_prefix_hit(system)
        if prefix_hit is not None:
            # 命中前缀，节省的 token 已在 L3 内部累计
            return None, "l3_partial"

        return None, "miss"

    async def put(
        self,
        system: str,
        user: str,
        model: str,
        max_tokens: int,
        response: str,
    ) -> None:
        """
        写入 L1 + L2 缓存 + 完成 L4 future
        """
        # 完成 L4 future（唤醒等待者）
        await self.l4.complete(system, user, model, response)
        # 写入 L1 + L2
        await self.l1.put(system, user, model, max_tokens, response)
        await self.l2.put(system, user, model, max_tokens, response)
        # 注册 L3 前缀
        await self.l3.register_prefix(system)

    async def fail(
        self, system: str, user: str, model: str, error: Exception
    ) -> None:
        """
        标记 LLM 调用失败
        """
        await self.l4.complete(system, user, model, error=error)

    async def _record_hit(self, layer: str, saved_tokens: int) -> None:
        async with self._stats_lock:
            if layer == "l1":
                self._stats.l1_hits += 1
            elif layer == "l2":
                self._stats.l2_hits += 1
            elif layer == "l3":
                self._stats.l3_hits += 1
            elif layer == "l4":
                self._stats.l4_dedup_hits += 1
            # 节省的 token = saved_tokens（输入）+ 估算输出
            self._stats.saved_tokens += saved_tokens
            # 估算节省的成本（输入 + 输出）
            input_cost = (saved_tokens / 1000) * self._cost_per_1k_input
            output_cost = (saved_tokens / 1000) * self._cost_per_1k_output
            self._stats.saved_cost_usd += input_cost + output_cost
            # 计算命中率
            total_hits = (
                self._stats.l1_hits
                + self._stats.l2_hits
                + self._stats.l3_hits
                + self._stats.l4_dedup_hits
            )
            if self._stats.total_requests > 0:
                self._stats.hit_rate = total_hits / self._stats.total_requests

    async def get_stats(self) -> Dict[str, Any]:
        """
        获取统计信息
        """
        async with self._stats_lock:
            stats = self._stats.to_dict()
        stats["l1_size"] = await self.l1.size()
        stats["l2_size"] = await self.l2.size()
        stats["l3_size"] = await self.l3.size()
        stats["l4_active"] = await self.l4.active_count()
        return stats

    async def clear_all(self) -> Dict[str, int]:
        """
        清空所有 4 层缓存
        """
        l1_count = await self.l1.clear()
        l2_count = await self.l2.clear()
        l3_count = await self.l3.clear()
        return {
            "l1_cleared": l1_count,
            "l2_cleared": l2_count,
            "l3_cleared": l3_count,
        }


# ============================================================
# 全局单例
# ============================================================

_cache_manager: Optional[LLMCacheManager] = None
_cache_manager_lock = asyncio.Lock()


async def get_cache_manager() -> LLMCacheManager:
    """
    获取全局缓存管理器（异步单例）
    """
    global _cache_manager
    async with _cache_manager_lock:
        if _cache_manager is None:
            _cache_manager = LLMCacheManager()
        return _cache_manager


def reset_cache_manager() -> None:
    """
    重置全局缓存管理器（测试用）
    """
    global _cache_manager
    _cache_manager = None


# ============================================================
# 便捷装饰器/函数
# ============================================================


async def cached_llm_call(
    executor_func,
    system: str,
    user: str,
    model: str,
    max_tokens: int = 4096,
    **kwargs,
) -> Tuple[str, str]:
    """
    带缓存的 LLM 调用包装器

    参数：
      - executor_func: 实际的 LLM 执行函数 (async) -> str
      - system/user/model/max_tokens: 缓存 key 参数
      - **kwargs: 透传给 executor_func

    返回值：(response, hit_layer)
      - response: 响应内容
      - hit_layer: 'l1' | 'l2' | 'l3' | 'l4' | 'miss'
    """
    cache = await get_cache_manager()
    # 查找缓存
    cached, layer = await cache.get(system, user, model, max_tokens)
    if cached is not None:
        return cached, layer
    # 实际调用
    try:
        response = await executor_func(system=system, user=user, max_tokens=max_tokens, **kwargs)
        await cache.put(system, user, model, max_tokens, response)
        return response, layer
    except Exception as e:
        await cache.fail(system, user, model, e)
        raise
