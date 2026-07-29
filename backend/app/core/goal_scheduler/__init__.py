"""
# ============================================================
# Hermes Goal Scheduler - 多 Goal 并发隔离调度器
# ============================================================
# 核心作用：在多个 Goal 并发轮转时实现资源隔离、优先级调度
#           与公平排队，避免单 Goal 占用全部资源
# 运行流程：
#   1. 注册 Goal 时附带 ResourceQuota（max_tokens / max_turns / max_concurrent / priority）
#   2. 调度器维护活跃 Goal 集合 + 资源使用计数
#   3. 每次轮转前查询：哪些 Goal 可以执行
#   4. 超额 Goal 降级为 queued 状态，等待资源释放
#   5. 资源使用完成时通知等待队列
# 输入参数：
#   - engine: AutoTurnEngine 实例
#   - manager: GoalManager 实例
# 输出结果：
#   - 调度决策（哪些 Goal 优先执行）
#   - 资源使用统计
# 修改记录：
#   - 2026-07-29 | v1.0.0 | Cycle 15 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 枚举
# ============================================================
class SchedulingPolicy(str, Enum):
    """调度策略"""
    FIFO = "fifo"                       # 先进先出
    PRIORITY = "priority"               # 优先级
    FAIR_SHARE = "fair_share"           # 公平共享
    DEADLINE = "deadline"               # 截止时间


class GoalPriority(str, Enum):
    """Goal 优先级"""
    LOW = "low"               # 1
    NORMAL = "normal"         # 2（默认）
    HIGH = "high"             # 3
    URGENT = "urgent"         # 4
    CRITICAL = "critical"     # 5


class QuotaStatus(str, Enum):
    """配额状态"""
    OK = "ok"                         # 正常
    WARNING = "warning"               # 接近上限
    THROTTLED = "throttled"           # 限流
    EXHAUSTED = "exhausted"           # 耗尽


# 优先级 → 数值
PRIORITY_VALUE: Dict[GoalPriority, int] = {
    GoalPriority.LOW: 1,
    GoalPriority.NORMAL: 2,
    GoalPriority.HIGH: 3,
    GoalPriority.URGENT: 4,
    GoalPriority.CRITICAL: 5,
}


# ============================================================
# 数据模型
# ============================================================
@dataclass
class ResourceQuota:
    """单 Goal 资源配额"""
    goal_id: str
    max_tokens: int = 100000          # Token 上限
    max_turns: int = 1000             # 最大轮转次数
    max_concurrent: int = 1           # 最大并发数（>1 时允许多个并行 turn）
    priority: str = GoalPriority.NORMAL.value
    weight: float = 1.0               # 公平共享权重
    deadline: Optional[str] = None    # 截止时间（ISO 格式）
    soft_limit: float = 0.8           # 软上限（达到此比例时进入 WARNING）

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResourceQuota":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class ResourceUsage:
    """单 Goal 资源使用情况"""
    goal_id: str
    tokens_used: int = 0
    turns_used: int = 0
    concurrent_active: int = 0
    last_active_at: Optional[str] = None
    last_dequeued_at: Optional[str] = None
    last_completed_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResourceUsage":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class ScheduleDecision:
    """调度决策"""
    decision_id: str = field(default_factory=lambda: f"dec_{uuid.uuid4().hex[:8]}")
    goal_id: str = ""
    can_run: bool = False
    reason: str = ""
    queue_position: int = 0
    priority_value: int = 0
    resource_status: str = QuotaStatus.OK.value
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Goal Scheduler
# ============================================================
class GoalScheduler:
    """多 Goal 并发隔离调度器

    功能：
      - 注册/注销 Goal + 资源配额
      - 全局并发上限（max_concurrent_goals）
      - 优先级 + 公平共享调度
      - Token / Turn 限流
      - 等待队列
      - 资源使用统计
    """

    def __init__(
        self,
        storage_dir: Optional[str] = None,
        engine: Any = None,
        manager: Any = None,
        policy: str = SchedulingPolicy.PRIORITY.value,
        max_concurrent_goals: int = 5,
    ) -> None:
        """
        初始化

        参数：
          - storage_dir: 持久化目录
          - engine: AutoTurnEngine 实例
          - manager: GoalManager 实例
          - policy: 调度策略
          - max_concurrent_goals: 全局最大并发 Goal 数
        """
        if storage_dir is None:
            storage_dir = os.path.join(os.path.expanduser("~"), ".hermes", "goal_scheduler")
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.quotas_file = self.storage_dir / "quotas.jsonl"
        self.usage_file = self.storage_dir / "usage.jsonl"
        self.decisions_file = self.storage_dir / "decisions.jsonl"

        self.engine = engine
        self.manager = manager
        self.policy = policy
        self.max_concurrent_goals = max_concurrent_goals

        # 线程安全
        self._lock = threading.RLock()
        self._quotas: Dict[str, ResourceQuota] = {}     # goal_id -> quota
        self._usage: Dict[str, ResourceUsage] = {}      # goal_id -> usage
        self._waiting_queue: List[str] = []             # 等待执行的 goal_id 列表
        self._active_goals: set = set()                 # 正在执行的 goal_id
        self._decisions: List[ScheduleDecision] = []    # 历史决策
        self._stats = {
            "total_decisions": 0,
            "granted": 0,
            "throttled": 0,
            "exhausted": 0,
            "queued": 0,
        }

        # 加载持久化
        self._load()

        logger.info(
            f"GoalScheduler 初始化完成 storage_dir={self.storage_dir} "
            f"policy={policy} max_concurrent={max_concurrent_goals}"
        )

    # ============================================================
    # 持久化
    # ============================================================
    def _save_quotas(self) -> None:
        try:
            with open(self.quotas_file, "w", encoding="utf-8") as f:
                for q in self._quotas.values():
                    f.write(json.dumps(q.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"保存配额失败: {e}")

    def _save_usage(self) -> None:
        try:
            with open(self.usage_file, "w", encoding="utf-8") as f:
                for u in self._usage.values():
                    f.write(json.dumps(u.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"保存使用情况失败: {e}")

    def _append_decision(self, dec: ScheduleDecision) -> None:
        try:
            with open(self.decisions_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(dec.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"追加决策失败: {e}")

    def _load(self) -> None:
        if self.quotas_file.exists():
            try:
                with open(self.quotas_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            q = ResourceQuota.from_dict(data)
                            self._quotas[q.goal_id] = q
            except Exception as e:
                logger.error(f"加载配额失败: {e}")

        if self.usage_file.exists():
            try:
                with open(self.usage_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            u = ResourceUsage.from_dict(data)
                            self._usage[u.goal_id] = u
            except Exception as e:
                logger.error(f"加载使用情况失败: {e}")

    # ============================================================
    # 配额管理
    # ============================================================
    def register_quota(self, quota: ResourceQuota) -> ResourceQuota:
        """注册/更新 Goal 资源配额"""
        with self._lock:
            self._quotas[quota.goal_id] = quota
            if quota.goal_id not in self._usage:
                self._usage[quota.goal_id] = ResourceUsage(goal_id=quota.goal_id)
            self._save_quotas()
            self._save_usage()
            logger.info(
                f"Goal {quota.goal_id} 配额已注册 "
                f"max_tokens={quota.max_tokens} max_turns={quota.max_turns} "
                f"priority={quota.priority}"
            )
            return quota

    def unregister_quota(self, goal_id: str) -> bool:
        """注销 Goal 配额"""
        with self._lock:
            if goal_id not in self._quotas:
                return False
            del self._quotas[goal_id]
            self._usage.pop(goal_id, None)
            self._active_goals.discard(goal_id)
            if goal_id in self._waiting_queue:
                self._waiting_queue.remove(goal_id)
            self._save_quotas()
            self._save_usage()
            return True

    def get_quota(self, goal_id: str) -> Optional[ResourceQuota]:
        """获取配额"""
        with self._lock:
            return self._quotas.get(goal_id)

    def list_quotas(self) -> List[ResourceQuota]:
        """列出所有配额"""
        with self._lock:
            return list(self._quotas.values())

    # ============================================================
    # 资源使用追踪
    # ============================================================
    def record_token_usage(self, goal_id: str, tokens: int) -> None:
        """记录 Token 使用"""
        with self._lock:
            usage = self._usage.setdefault(goal_id, ResourceUsage(goal_id=goal_id))
            usage.tokens_used += tokens
            self._save_usage()

    def record_turn(self, goal_id: str) -> None:
        """记录一次轮转"""
        with self._lock:
            usage = self._usage.setdefault(goal_id, ResourceUsage(goal_id=goal_id))
            usage.turns_used += 1
            usage.last_active_at = datetime.now(timezone.utc).isoformat()
            self._save_usage()

    def mark_active(self, goal_id: str) -> None:
        """标记为活跃"""
        with self._lock:
            usage = self._usage.setdefault(goal_id, ResourceUsage(goal_id=goal_id))
            usage.concurrent_active += 1
            usage.last_active_at = datetime.now(timezone.utc).isoformat()
            self._active_goals.add(goal_id)
            # 移出等待队列
            if goal_id in self._waiting_queue:
                self._waiting_queue.remove(goal_id)
            self._save_usage()

    def mark_inactive(self, goal_id: str) -> None:
        """标记为非活跃"""
        with self._lock:
            usage = self._usage.setdefault(goal_id, ResourceUsage(goal_id=goal_id))
            if usage.concurrent_active > 0:
                usage.concurrent_active -= 1
            usage.last_completed_at = datetime.now(timezone.utc).isoformat()
            if usage.concurrent_active == 0:
                self._active_goals.discard(goal_id)
            self._save_usage()

    def get_usage(self, goal_id: str) -> Optional[ResourceUsage]:
        """获取使用情况"""
        with self._lock:
            return self._usage.get(goal_id)

    # ============================================================
    # 配额状态
    # ============================================================
    def _check_quota_status(self, goal_id: str) -> QuotaStatus:
        """检查配额状态"""
        quota = self._quotas.get(goal_id)
        usage = self._usage.get(goal_id)
        if not quota or not usage:
            return QuotaStatus.OK

        # Token 耗尽
        if usage.tokens_used >= quota.max_tokens:
            return QuotaStatus.EXHAUSTED
        # Turn 耗尽
        if usage.turns_used >= quota.max_turns:
            return QuotaStatus.EXHAUSTED
        # 接近上限（warning）
        token_ratio = usage.tokens_used / max(1, quota.max_tokens)
        turn_ratio = usage.turns_used / max(1, quota.max_turns)
        if token_ratio >= quota.soft_limit or turn_ratio >= quota.soft_limit:
            return QuotaStatus.WARNING
        return QuotaStatus.OK

    # ============================================================
    # 调度决策
    # ============================================================
    def request_schedule(self, goal_id: str) -> ScheduleDecision:
        """
        请求调度决策

        返回：ScheduleDecision
        """
        with self._lock:
            self._stats["total_decisions"] += 1

            quota = self._quotas.get(goal_id)
            priority_value = PRIORITY_VALUE.get(
                GoalPriority(quota.priority) if quota else GoalPriority.NORMAL,
                2,
            )
            decision = ScheduleDecision(
                goal_id=goal_id,
                priority_value=priority_value,
            )

            # 1. 检查配额耗尽
            quota_status = self._check_quota_status(goal_id)
            decision.resource_status = quota_status.value
            if quota_status == QuotaStatus.EXHAUSTED:
                decision.can_run = False
                decision.reason = "quota_exhausted"
                self._stats["exhausted"] += 1
                self._decisions.append(decision)
                self._append_decision(decision)
                return decision

            # 2. 检查单 Goal 并发上限
            usage = self._usage.get(goal_id)
            if quota and usage and usage.concurrent_active >= quota.max_concurrent:
                decision.can_run = False
                decision.reason = "max_concurrent_reached"
                decision.queue_position = self._enqueue(goal_id)
                self._stats["throttled"] += 1
                self._decisions.append(decision)
                self._append_decision(decision)
                return decision

            # 3. 检查全局并发上限
            if len(self._active_goals) >= self.max_concurrent_goals:
                decision.can_run = False
                decision.reason = "global_max_concurrent_reached"
                decision.queue_position = self._enqueue(goal_id)
                self._stats["throttled"] += 1
                self._decisions.append(decision)
                self._append_decision(decision)
                return decision

            # 4. 通过：允许执行
            decision.can_run = True
            decision.reason = "ok"
            self._stats["granted"] += 1
            self._decisions.append(decision)
            self._append_decision(decision)
            return decision

    def _enqueue(self, goal_id: str) -> int:
        """加入等待队列，返回队列位置（1-based）"""
        if goal_id not in self._waiting_queue:
            # 按优先级插入
            quota = self._quotas.get(goal_id)
            if quota:
                pval = PRIORITY_VALUE.get(GoalPriority(quota.priority), 2)
                # 找到第一个优先级低于当前的位置
                inserted = False
                for idx, existing in enumerate(self._waiting_queue):
                    existing_quota = self._quotas.get(existing)
                    if existing_quota:
                        existing_pval = PRIORITY_VALUE.get(
                            GoalPriority(existing_quota.priority), 2
                        )
                        if pval > existing_pval:
                            self._waiting_queue.insert(idx, goal_id)
                            inserted = True
                            break
                if not inserted:
                    self._waiting_queue.append(goal_id)
            else:
                self._waiting_queue.append(goal_id)
            self._stats["queued"] += 1
        return self._waiting_queue.index(goal_id) + 1

    def dequeue_next(self) -> Optional[str]:
        """从等待队列取下一个 Goal"""
        with self._lock:
            while self._waiting_queue:
                goal_id = self._waiting_queue.pop(0)
                if goal_id in self._quotas and self._check_quota_status(goal_id) != QuotaStatus.EXHAUSTED:
                    usage = self._usage.get(goal_id)
                    quota = self._quotas.get(goal_id)
                    if usage and quota and usage.concurrent_active < quota.max_concurrent:
                        usage.last_dequeued_at = datetime.now(timezone.utc).isoformat()
                        self._save_usage()
                        return goal_id
            return None

    def get_waiting_queue(self) -> List[Dict[str, Any]]:
        """获取等待队列（带详情）"""
        with self._lock:
            result = []
            for idx, goal_id in enumerate(self._waiting_queue):
                quota = self._quotas.get(goal_id)
                result.append({
                    "position": idx + 1,
                    "goal_id": goal_id,
                    "priority": quota.priority if quota else "normal",
                })
            return result

    def get_active_goals(self) -> List[str]:
        """获取活跃 Goal 列表"""
        with self._lock:
            return list(self._active_goals)

    # ============================================================
    # 公平共享（预留扩展）
    # ============================================================
    def fair_share_score(self, goal_id: str) -> float:
        """
        计算公平共享得分（用于 FAIR_SHARE 策略）

        得分 = (实际使用 / 配额) / 权重
        得分越低越优先
        """
        with self._lock:
            quota = self._quotas.get(goal_id)
            usage = self._usage.get(goal_id)
            if not quota or not usage:
                return 0.0
            token_ratio = usage.tokens_used / max(1, quota.max_tokens)
            turn_ratio = usage.turns_used / max(1, quota.max_turns)
            avg_ratio = (token_ratio + turn_ratio) / 2
            weight = max(0.1, quota.weight)
            return avg_ratio / weight

    # ============================================================
    # 统计
    # ============================================================
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock:
            quota_dist: Dict[str, int] = {}
            for q in self._quotas.values():
                quota_dist[q.priority] = quota_dist.get(q.priority, 0) + 1

            return {
                "success": True,
                "stats": {
                    **self._stats,
                    "total_quotas": len(self._quotas),
                    "active_goals": len(self._active_goals),
                    "waiting_goals": len(self._waiting_queue),
                    "max_concurrent_goals": self.max_concurrent_goals,
                    "policy": self.policy,
                    "priority_distribution": quota_dist,
                    "storage_dir": str(self.storage_dir),
                },
            }

    def get_decisions(self, goal_id: Optional[str] = None, limit: int = 50) -> List[ScheduleDecision]:
        """获取调度决策历史"""
        with self._lock:
            decisions = list(self._decisions)
            if goal_id:
                decisions = [d for d in decisions if d.goal_id == goal_id]
            return decisions[-limit:][::-1]

    def clear_decisions(self) -> int:
        """清空决策历史（用于测试）"""
        with self._lock:
            count = len(self._decisions)
            self._decisions.clear()
            try:
                if self.decisions_file.exists():
                    self.decisions_file.unlink()
            except Exception:
                pass
            return count


# ============================================================
# 全局单例
# ============================================================
_scheduler_instance: Optional[GoalScheduler] = None
_scheduler_lock = threading.Lock()


def get_scheduler(
    engine: Any = None,
    manager: Any = None,
    policy: Optional[str] = None,
    max_concurrent_goals: Optional[int] = None,
) -> GoalScheduler:
    """
    获取全局 GoalScheduler 单例
    """
    global _scheduler_instance
    with _scheduler_lock:
        if _scheduler_instance is None:
            _scheduler_instance = GoalScheduler(
                engine=engine,
                manager=manager,
                policy=policy or SchedulingPolicy.PRIORITY.value,
                max_concurrent_goals=max_concurrent_goals or 5,
            )
        else:
            if engine and not _scheduler_instance.engine:
                _scheduler_instance.engine = engine
            if manager and not _scheduler_instance.manager:
                _scheduler_instance.manager = manager
        return _scheduler_instance


def reset_scheduler() -> None:
    """重置全局单例（测试用）"""
    global _scheduler_instance
    with _scheduler_lock:
        _scheduler_instance = None
