"""
# ============================================================
# 重试策略
# ============================================================
# 核心作用：提供指数退避重试机制
# 特性：错误分类、退避时间可配置、最多重试次数控制
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import time
from enum import Enum
from functools import wraps
from typing import Any, Callable, Optional, Tuple, Type

logger = logging.getLogger(__name__)


class RetryableErrorType(str, Enum):
    """可重试错误类型"""
    CONNECTION_ERROR = "connection_error"
    TIMEOUT_ERROR = "timeout_error"
    SERVER_ERROR = "server_error"
    RATE_LIMIT = "rate_limit"
    UNKNOWN = "unknown"


class RetryStrategy:
    """
    重试策略
    默认：最多 3 次，指数退避 1s, 5s, 15s
    """

    def __init__(
        self,
        max_retries: int = 3,
        backoff_schedule: Optional[Tuple[float, ...]] = None,
        retryable_exceptions: Tuple[Type[Exception], ...] = (Exception,),
    ):
        self.max_retries = max_retries
        self.backoff_schedule = backoff_schedule or (1.0, 5.0, 15.0)
        self.retryable_exceptions = retryable_exceptions
        # 统计
        self.total_attempts = 0
        self.total_retries = 0
        self.successful_after_retry = 0

    def should_retry(self, attempt: int, exc: Exception) -> bool:
        """判断是否应该重试"""
        if attempt >= self.max_retries:
            return False
        return isinstance(exc, self.retryable_exceptions)

    def get_backoff(self, attempt: int) -> float:
        """获取第 N 次重试的退避时间"""
        if attempt < len(self.backoff_schedule):
            return self.backoff_schedule[attempt]
        return self.backoff_schedule[-1]

    def execute(self, func: Callable, *args, **kwargs) -> Any:
        """执行函数，自动重试"""
        last_exc: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            self.total_attempts += 1
            try:
                result = func(*args, **kwargs)
                if attempt > 0:
                    self.successful_after_retry += 1
                return result
            except self.retryable_exceptions as e:
                last_exc = e
                if not self.should_retry(attempt, e):
                    raise
                backoff = self.get_backoff(attempt)
                self.total_retries += 1
                logger.warning(
                    f"attempt {attempt + 1} failed: {e}, "
                    f"retrying in {backoff}s (next attempt {attempt + 2}/{self.max_retries + 1})"
                )
                time.sleep(backoff)
        if last_exc:
            raise last_exc
        return None

    async def execute_async(self, func: Callable, *args, **kwargs) -> Any:
        """执行异步函数，自动重试"""
        import asyncio
        last_exc: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            self.total_attempts += 1
            try:
                if asyncio.iscoroutinefunction(func):
                    result = await func(*args, **kwargs)
                else:
                    result = func(*args, **kwargs)
                if attempt > 0:
                    self.successful_after_retry += 1
                return result
            except self.retryable_exceptions as e:
                last_exc = e
                if not self.should_retry(attempt, e):
                    raise
                backoff = self.get_backoff(attempt)
                self.total_retries += 1
                logger.warning(
                    f"async attempt {attempt + 1} failed: {e}, "
                    f"retrying in {backoff}s"
                )
                await asyncio.sleep(backoff)
        if last_exc:
            raise last_exc
        return None

    def stats(self) -> dict:
        """统计信息"""
        return {
            "total_attempts": self.total_attempts,
            "total_retries": self.total_retries,
            "successful_after_retry": self.successful_after_retry,
            "success_rate": (
                (self.total_attempts - self.total_retries) / self.total_attempts
                if self.total_attempts > 0
                else 0.0
            ),
        }


def retry_with_backoff(
    max_retries: int = 3,
    backoff_schedule: Optional[Tuple[float, ...]] = None,
    retryable_exceptions: Tuple[Type[Exception], ...] = (Exception,),
):
    """
    装饰器：自动重试函数
    用法：
        @retry_with_backoff(max_retries=3)
        def my_func():
            ...
    """
    strategy = RetryStrategy(
        max_retries=max_retries,
        backoff_schedule=backoff_schedule,
        retryable_exceptions=retryable_exceptions,
    )

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            return strategy.execute(func, *args, **kwargs)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            return await strategy.execute_async(func, *args, **kwargs)

        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper

    return decorator
