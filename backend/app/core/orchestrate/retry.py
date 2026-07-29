"""
# Orchestrate 重试编排器 + 熔断器
# ============================================================
# 核心作用：实现标准化的重试策略和熔断机制
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 功能：
#   - 指数退避（带抖动）
#   - 熔断器（连续失败阈值）
#   - 失败时降级
#   - 幂等键追踪
# ============================================================
"""

from __future__ import annotations

import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .models import (
    CircuitBreakerState,
    RetryPolicy,
)


# ============================================================
# 熔断器
# ============================================================

@dataclass
class CircuitBreaker:
    """熔断器

    三种状态：
    - CLOSED: 正常状态，请求直通
    - OPEN: 已熔断，拒绝所有请求
    - HALF_OPEN: 半开状态，允许少量试探请求
    """
    threshold: int = 5
    reset_timeout_ms: int = 60000
    state: CircuitBreakerState = CircuitBreakerState.CLOSED
    failure_count: int = 0
    success_count: int = 0
    last_failure_time: float = 0.0
    last_state_change: float = field(default_factory=time.time)
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def allow_request(self) -> bool:
        """检查是否允许请求通过"""
        with self._lock:
            if self.state == CircuitBreakerState.CLOSED:
                return True
            if self.state == CircuitBreakerState.OPEN:
                # 检查是否到达恢复时间
                if (time.time() * 1000 - self.last_failure_time) >= self.reset_timeout_ms:
                    self._transition(CircuitBreakerState.HALF_OPEN)
                    return True
                return False
            if self.state == CircuitBreakerState.HALF_OPEN:
                # 半开状态只允许一个请求
                return True
            return False

    def record_success(self) -> None:
        """记录成功"""
        with self._lock:
            self.success_count += 1
            if self.state == CircuitBreakerState.HALF_OPEN:
                # 半开状态成功 → 关闭熔断器
                self._transition(CircuitBreakerState.CLOSED)
                self.failure_count = 0
            elif self.state == CircuitBreakerState.CLOSED:
                # 连续成功可以降低失败计数
                if self.failure_count > 0:
                    self.failure_count = max(0, self.failure_count - 1)

    def record_failure(self) -> None:
        """记录失败"""
        with self._lock:
            self.failure_count += 1
            self.last_failure_time = time.time() * 1000
            if self.state == CircuitBreakerState.HALF_OPEN:
                # 半开状态失败 → 重新熔断
                self._transition(CircuitBreakerState.OPEN)
            elif self.state == CircuitBreakerState.CLOSED:
                if self.failure_count >= self.threshold:
                    self._transition(CircuitBreakerState.OPEN)

    def reset(self) -> None:
        """强制重置熔断器"""
        with self._lock:
            self._transition(CircuitBreakerState.CLOSED)
            self.failure_count = 0
            self.success_count = 0

    def _transition(self, new_state: CircuitBreakerState) -> None:
        """状态转换"""
        self.state = new_state
        self.last_state_change = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "state": self.state.value,
            "threshold": self.threshold,
            "reset_timeout_ms": self.reset_timeout_ms,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "last_failure_time": self.last_failure_time,
        }


# ============================================================
# 重试队列项
# ============================================================

@dataclass
class RetryItem:
    """重试队列项"""
    item_id: str = field(default_factory=lambda: f"retry_{uuid.uuid4().hex[:12]}")
    stage_id: str = ""
    pipeline_id: str = ""
    attempt: int = 1
    max_attempts: int = 3
    next_retry_at: float = 0.0
    last_error: str = ""
    idempotency_key: str = field(default_factory=lambda: f"idem_{uuid.uuid4().hex[:16]}")
    created_at: float = field(default_factory=time.time)
    # 重试时的输入（用于重放）
    inputs: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "item_id": self.item_id,
            "stage_id": self.stage_id,
            "pipeline_id": self.pipeline_id,
            "attempt": self.attempt,
            "max_attempts": self.max_attempts,
            "next_retry_at": self.next_retry_at,
            "last_error": self.last_error,
            "idempotency_key": self.idempotency_key,
            "created_at": self.created_at,
            "inputs": self.inputs,
        }


# ============================================================
# 重试编排器
# ============================================================

class RetryOrchestrator:
    """重试编排器

    用法：
        orchestrator = RetryOrchestrator()
        for attempt in orchestrator.iter_retry(policy):
            try:
                result = execute_stage(...)
                orchestrator.record_success(breaker)
                break
            except Exception as e:
                orchestrator.record_failure(breaker, str(e))
                if not orchestrator.should_retry(attempt, policy):
                    raise
    """

    def __init__(self) -> None:
        self._queue: List[RetryItem] = []
        self._breakers: Dict[str, CircuitBreaker] = {}
        self._lock = threading.RLock()
        # 已处理过的幂等键（用于去重）
        self._seen_idempotency_keys: set = set()

    # ============================================================
    # 熔断器管理
    # ============================================================

    def get_breaker(self, stage_id: str, policy: RetryPolicy) -> CircuitBreaker:
        """获取或创建熔断器"""
        with self._lock:
            if stage_id not in self._breakers:
                self._breakers[stage_id] = CircuitBreaker(
                    threshold=policy.circuit_breaker_threshold,
                    reset_timeout_ms=policy.circuit_breaker_reset_ms,
                )
            return self._breakers[stage_id]

    def allow_execution(self, stage_id: str, policy: RetryPolicy) -> bool:
        """检查是否允许执行（熔断器未开启）"""
        breaker = self.get_breaker(stage_id, policy)
        return breaker.allow_request()

    def record_success(self, stage_id: str, policy: RetryPolicy) -> None:
        """记录成功"""
        breaker = self.get_breaker(stage_id, policy)
        breaker.record_success()

    def record_failure(self, stage_id: str, policy: RetryPolicy, error: str = "") -> None:
        """记录失败"""
        breaker = self.get_breaker(stage_id, policy)
        breaker.record_failure()

    def get_breaker_status(self, stage_id: str) -> Optional[Dict[str, Any]]:
        """获取熔断器状态"""
        with self._lock:
            breaker = self._breakers.get(stage_id)
            return breaker.to_dict() if breaker else None

    def reset_breaker(self, stage_id: str) -> bool:
        """重置熔断器"""
        with self._lock:
            if stage_id in self._breakers:
                self._breakers[stage_id].reset()
                return True
            return False

    # ============================================================
    # 重试决策
    # ============================================================

    def should_retry(
        self,
        attempt: int,
        policy: RetryPolicy,
        error: str = "",
    ) -> bool:
        """判断是否应该重试"""
        if attempt >= policy.max_attempts:
            return False
        return True

    def compute_backoff_ms(
        self,
        attempt: int,
        policy: RetryPolicy,
    ) -> int:
        """计算退避延迟（毫秒）"""
        # 指数退避
        delay = policy.base_delay_ms * (policy.backoff_multiplier ** (attempt - 1))
        # 限制最大延迟
        delay = min(delay, policy.max_delay_ms)
        # 抖动
        if policy.jitter:
            delay = int(delay * random.uniform(0.5, 1.5))
        return max(0, int(delay))

    # ============================================================
    # 重试队列
    # ============================================================

    def enqueue_retry(
        self,
        stage_id: str,
        pipeline_id: str,
        attempt: int,
        max_attempts: int,
        error: str,
        inputs: Dict[str, Any],
    ) -> RetryItem:
        """加入重试队列"""
        item = RetryItem(
            stage_id=stage_id,
            pipeline_id=pipeline_id,
            attempt=attempt,
            max_attempts=max_attempts,
            last_error=error,
            inputs=inputs,
        )
        with self._lock:
            self._queue.append(item)
        return item

    def list_queue(self, pipeline_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """列出重试队列"""
        with self._lock:
            items = self._queue
            if pipeline_id:
                items = [i for i in items if i.pipeline_id == pipeline_id]
            return [i.to_dict() for i in items]

    def remove_item(self, item_id: str) -> bool:
        """移除重试项"""
        with self._lock:
            for i, item in enumerate(self._queue):
                if item.item_id == item_id:
                    self._queue.pop(i)
                    return True
            return False

    def flush_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        """立即重试（返回项信息后移除）"""
        with self._lock:
            for item in self._queue:
                if item.item_id == item_id:
                    return item.to_dict()
        return None

    def clear_queue(self, pipeline_id: Optional[str] = None) -> int:
        """清空队列"""
        with self._lock:
            if pipeline_id:
                before = len(self._queue)
                self._queue = [i for i in self._queue if i.pipeline_id != pipeline_id]
                return before - len(self._queue)
            else:
                count = len(self._queue)
                self._queue.clear()
                return count

    # ============================================================
    # 幂等性
    # ============================================================

    def register_idempotency_key(self, key: str) -> bool:
        """注册幂等键，返回是否首次注册"""
        with self._lock:
            if key in self._seen_idempotency_keys:
                return False
            self._seen_idempotency_keys.add(key)
            return True

    def is_duplicate(self, key: str) -> bool:
        """检查是否是重复的幂等键"""
        with self._lock:
            return key in self._seen_idempotency_keys

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取编排器统计"""
        with self._lock:
            return {
                "queue_size": len(self._queue),
                "breaker_count": len(self._breakers),
                "open_breakers": sum(
                    1 for b in self._breakers.values()
                    if b.state == CircuitBreakerState.OPEN
                ),
                "half_open_breakers": sum(
                    1 for b in self._breakers.values()
                    if b.state == CircuitBreakerState.HALF_OPEN
                ),
                "idempotency_keys_tracked": len(self._seen_idempotency_keys),
            }

    def list_breakers(self) -> List[Dict[str, Any]]:
        """列出所有熔断器状态"""
        with self._lock:
            return [
                {"stage_id": sid, **b.to_dict()}
                for sid, b in self._breakers.items()
            ]
