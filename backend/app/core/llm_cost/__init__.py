"""
# ============================================================
# Hermes LLM Cost Tracker - 成本精细化追踪
# ============================================================
# 核心作用：基于 Per-Run Attribution Ledger 模型，实现 LLM 调用成本的
#           多维度精细化追踪（user/project/feature/agent/model）
# 运行流程：
#   1. 每次 LLM 调用产生一条 CostRecord
#   2. 按 6 维度归因（user_id / project_id / agent_id / model / route / feature）
#   3. 7 个计费组件（cache_miss / cache_read / cache_write / output / reasoning / tool / image）
#   4. 按维度查询 + 聚合 + 预算告警
# 输入参数：
#   - record: LLMCallRecord
# 输出结果：
#   - 成本明细（JSONL 持久化）
#   - 按维度聚合的成本统计
# 修改记录：
#   - 2026-07-29 | v1.0.0 | Cycle 15 P1-2 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import os
import threading
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
class CostDimension(str, Enum):
    """成本归因维度"""
    USER = "user"
    PROJECT = "project"
    AGENT = "agent"
    MODEL = "model"
    ROUTE = "route"
    FEATURE = "feature"


class AlertLevel(str, Enum):
    """告警级别"""
    OK = "ok"
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


# ============================================================
# 数据模型
# ============================================================
@dataclass
class LLMCallRecord:
    """单次 LLM 调用成本记录（Per-Run Attribution Ledger）"""
    record_id: str = field(default_factory=lambda: f"llm_{uuid.uuid4().hex[:12]}")
    user_id: str = "anonymous"
    project_id: str = "default"
    agent_id: str = ""
    model: str = ""
    route: str = ""                     # 路由（如 chat / embedding / tool）
    feature: str = ""                   # 功能模块
    goal_id: str = ""                   # 关联 Goal
    run_id: str = ""                    # Agent Run ID

    # 7 个计费组件
    tokens_input_cache_miss: int = 0    # 输入 - 缓存未命中
    tokens_input_cache_read: int = 0    # 输入 - 缓存读取
    tokens_input_cache_write: int = 0   # 输入 - 缓存写入
    tokens_output: int = 0              # 输出
    tokens_reasoning: int = 0           # 推理
    tokens_tool: int = 0                # 工具调用
    tokens_image: int = 0               # 图像输入

    # 价格 (per 1K tokens)
    cost_per_1k_input: float = 0.0
    cost_per_1k_output: float = 0.0
    cost_per_1k_reasoning: float = 0.0
    cost_per_1k_tool: float = 0.0
    cost_per_1k_image: float = 0.0
    cost_cache_read_multiplier: float = 0.1  # 缓存读取折扣倍数
    cost_cache_write_multiplier: float = 1.25  # 缓存写入溢价

    # 元数据
    latency_ms: int = 0
    success: bool = True
    error: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LLMCallRecord":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

    def total_tokens(self) -> int:
        """总 token 数"""
        return (
            self.tokens_input_cache_miss
            + self.tokens_input_cache_read
            + self.tokens_input_cache_write
            + self.tokens_output
            + self.tokens_reasoning
            + self.tokens_tool
            + self.tokens_image
        )

    def total_cost(self) -> float:
        """总成本（USD）"""
        # 输入
        input_cost = (
            self.tokens_input_cache_miss * self.cost_per_1k_input / 1000
            + self.tokens_input_cache_read * self.cost_per_1k_input * self.cost_cache_read_multiplier / 1000
            + self.tokens_input_cache_write * self.cost_per_1k_input * self.cost_cache_write_multiplier / 1000
        )
        # 输出
        output_cost = self.tokens_output * self.cost_per_1k_output / 1000
        # 推理
        reasoning_cost = self.tokens_reasoning * self.cost_per_1k_reasoning / 1000
        # 工具
        tool_cost = self.tokens_tool * self.cost_per_1k_tool / 1000
        # 图像
        image_cost = self.tokens_image * self.cost_per_1k_image / 1000
        return input_cost + output_cost + reasoning_cost + tool_cost + image_cost

    def cost_breakdown(self) -> Dict[str, float]:
        """成本分解"""
        return {
            "input": self.tokens_input_cache_miss * self.cost_per_1k_input / 1000
            + self.tokens_input_cache_read * self.cost_per_1k_input * self.cost_cache_read_multiplier / 1000
            + self.tokens_input_cache_write * self.cost_per_1k_input * self.cost_cache_write_multiplier / 1000,
            "output": self.tokens_output * self.cost_per_1k_output / 1000,
            "reasoning": self.tokens_reasoning * self.cost_per_1k_reasoning / 1000,
            "tool": self.tokens_tool * self.cost_per_1k_tool / 1000,
            "image": self.tokens_image * self.cost_per_1k_image / 1000,
        }


@dataclass
class CostBudget:
    """成本预算"""
    budget_id: str = field(default_factory=lambda: f"bud_{uuid.uuid4().hex[:8]}")
    dimension: str = CostDimension.USER.value
    dimension_value: str = ""
    soft_limit_usd: float = 100.0       # 软上限
    hard_limit_usd: float = 200.0       # 硬上限
    period: str = "monthly"             # 周期（monthly / weekly / daily / total）
    enabled: bool = True
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CostBudget":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ============================================================
# LLM Cost Tracker
# ============================================================
class LLMCostTracker:
    """
    LLM 成本精细化追踪器

    功能：
      - 记录每次 LLM 调用（Per-Run Ledger）
      - 6 维度归因
      - 7 计费组件细分
      - 按维度聚合统计
      - 预算 + 告警
      - 持久化
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        """初始化"""
        if storage_dir is None:
            storage_dir = os.path.join(os.path.expanduser("~"), ".hermes", "llm_costs")
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.records_file = self.storage_dir / "records.jsonl"
        self.budgets_file = self.storage_dir / "budgets.jsonl"

        # 线程安全
        self._lock = threading.RLock()
        self._records: List[LLMCallRecord] = []
        self._budgets: Dict[str, CostBudget] = {}
        self._alerts: List[Dict[str, Any]] = []
        self._stats = {
            "total_records": 0,
            "total_cost_usd": 0.0,
            "total_tokens": 0,
            "alerts_triggered": 0,
        }

        # 加载持久化
        self._load()

        logger.info(f"LLMCostTracker 初始化完成 storage_dir={self.storage_dir}")

    # ============================================================
    # 持久化
    # ============================================================
    def _append_record(self, record: LLMCallRecord) -> None:
        try:
            with open(self.records_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"追加成本记录失败: {e}")

    def _save_budgets(self) -> None:
        try:
            with open(self.budgets_file, "w", encoding="utf-8") as f:
                for b in self._budgets.values():
                    f.write(json.dumps(b.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"保存预算失败: {e}")

    def _load(self) -> None:
        if self.records_file.exists():
            try:
                with open(self.records_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            rec = LLMCallRecord.from_dict(data)
                            self._records.append(rec)
                            self._stats["total_records"] += 1
                            self._stats["total_cost_usd"] += rec.total_cost()
                            self._stats["total_tokens"] += rec.total_tokens()
            except Exception as e:
                logger.error(f"加载成本记录失败: {e}")

        if self.budgets_file.exists():
            try:
                with open(self.budgets_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            b = CostBudget.from_dict(data)
                            self._budgets[b.budget_id] = b
            except Exception as e:
                logger.error(f"加载预算失败: {e}")

    # ============================================================
    # 记录
    # ============================================================
    def record_call(self, record: LLMCallRecord) -> Dict[str, Any]:
        """
        记录一次 LLM 调用

        返回：包含 record_id、total_cost、alert_level
        """
        with self._lock:
            self._records.append(record)
            self._append_record(record)
            cost = record.total_cost()
            self._stats["total_records"] += 1
            self._stats["total_cost_usd"] += cost
            self._stats["total_tokens"] += record.total_tokens()

            # 检查预算告警
            alert_level = AlertLevel.OK.value
            triggered_budgets = []

            for budget in self._budgets.values():
                if not budget.enabled:
                    continue
                # 仅检查匹配维度
                actual_value = self._get_dimension_value(record, budget.dimension)
                if actual_value != budget.dimension_value:
                    continue
                # 累计成本
                current_cost = self._aggregate_by_dimension(budget.dimension, budget.dimension_value)
                if current_cost >= budget.hard_limit_usd:
                    alert_level = AlertLevel.CRITICAL.value
                    triggered_budgets.append({
                        "budget_id": budget.budget_id,
                        "level": AlertLevel.CRITICAL.value,
                        "current_cost": current_cost,
                        "hard_limit": budget.hard_limit_usd,
                    })
                elif current_cost >= budget.soft_limit_usd and alert_level != AlertLevel.CRITICAL.value:
                    alert_level = AlertLevel.WARNING.value
                    triggered_budgets.append({
                        "budget_id": budget.budget_id,
                        "level": AlertLevel.WARNING.value,
                        "current_cost": current_cost,
                        "soft_limit": budget.soft_limit_usd,
                    })

            if triggered_budgets:
                self._alerts.append({
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "record_id": record.record_id,
                    "triggered_budgets": triggered_budgets,
                })
                self._stats["alerts_triggered"] += len(triggered_budgets)

            return {
                "success": True,
                "record_id": record.record_id,
                "total_cost_usd": cost,
                "total_tokens": record.total_tokens(),
                "alert_level": alert_level,
                "triggered_budgets": triggered_budgets,
            }

    def _get_dimension_value(self, record: LLMCallRecord, dimension: str) -> str:
        """从记录中获取指定维度的值"""
        if dimension == CostDimension.USER.value:
            return record.user_id
        elif dimension == CostDimension.PROJECT.value:
            return record.project_id
        elif dimension == CostDimension.AGENT.value:
            return record.agent_id
        elif dimension == CostDimension.MODEL.value:
            return record.model
        elif dimension == CostDimension.ROUTE.value:
            return record.route
        elif dimension == CostDimension.FEATURE.value:
            return record.feature
        return ""

    def _aggregate_by_dimension(self, dimension: str, value: str) -> float:
        """按维度聚合成本"""
        total = 0.0
        for r in self._records:
            if self._get_dimension_value(r, dimension) == value:
                total += r.total_cost()
        return total

    # ============================================================
    # 预算管理
    # ============================================================
    def set_budget(self, budget: CostBudget) -> CostBudget:
        """设置预算"""
        with self._lock:
            self._budgets[budget.budget_id] = budget
            self._save_budgets()
            logger.info(
                f"预算已设置 budget_id={budget.budget_id} "
                f"dimension={budget.dimension}={budget.dimension_value} "
                f"soft={budget.soft_limit_usd} hard={budget.hard_limit_usd}"
            )
            return budget

    def get_budget(self, budget_id: str) -> Optional[CostBudget]:
        with self._lock:
            return self._budgets.get(budget_id)

    def list_budgets(self) -> List[CostBudget]:
        with self._lock:
            return list(self._budgets.values())

    def delete_budget(self, budget_id: str) -> bool:
        with self._lock:
            if budget_id not in self._budgets:
                return False
            del self._budgets[budget_id]
            self._save_budgets()
            return True

    # ============================================================
    # 聚合查询
    # ============================================================
    def aggregate(
        self,
        dimension: str,
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        按维度聚合成本

        返回：[{dimension_value, total_cost, total_tokens, call_count}, ...]
        """
        with self._lock:
            buckets: Dict[str, Dict[str, Any]] = {}
            for r in self._records:
                if start and r.timestamp < start:
                    continue
                if end and r.timestamp > end:
                    continue
                value = self._get_dimension_value(r, dimension)
                if value == "":
                    continue
                if value not in buckets:
                    buckets[value] = {
                        "dimension_value": value,
                        "total_cost": 0.0,
                        "total_tokens": 0,
                        "call_count": 0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                    }
                buckets[value]["total_cost"] += r.total_cost()
                tokens = r.total_tokens()
                buckets[value]["total_tokens"] += tokens
                buckets[value]["call_count"] += 1
                buckets[value]["input_tokens"] += (
                    r.tokens_input_cache_miss
                    + r.tokens_input_cache_read
                    + r.tokens_input_cache_write
                )
                buckets[value]["output_tokens"] += r.tokens_output
            # 按 total_cost 降序
            results = list(buckets.values())
            results.sort(key=lambda x: x["total_cost"], reverse=True)
            return results

    def get_summary(self) -> Dict[str, Any]:
        """总览"""
        with self._lock:
            model_agg = self.aggregate(CostDimension.MODEL.value)
            user_agg = self.aggregate(CostDimension.USER.value)
            project_agg = self.aggregate(CostDimension.PROJECT.value)
            agent_agg = self.aggregate(CostDimension.AGENT.value)
            return {
                "success": True,
                "summary": {
                    **self._stats,
                    "top_models": model_agg[:5],
                    "top_users": user_agg[:5],
                    "top_projects": project_agg[:5],
                    "top_agents": agent_agg[:5],
                    "storage_dir": str(self.storage_dir),
                },
            }

    def get_records(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        model: Optional[str] = None,
        goal_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[LLMCallRecord]:
        """查询成本记录"""
        with self._lock:
            results = list(self._records)
            if user_id:
                results = [r for r in results if r.user_id == user_id]
            if project_id:
                results = [r for r in results if r.project_id == project_id]
            if model:
                results = [r for r in results if r.model == model]
            if goal_id:
                results = [r for r in results if r.goal_id == goal_id]
            return results[-limit:][::-1]

    def get_alerts(self, limit: int = 50) -> List[Dict[str, Any]]:
        """获取告警历史"""
        with self._lock:
            return self._alerts[-limit:][::-1]

    def clear_records(self) -> int:
        """清空记录（测试用）"""
        with self._lock:
            count = len(self._records)
            self._records.clear()
            self._stats["total_records"] = 0
            self._stats["total_cost_usd"] = 0.0
            self._stats["total_tokens"] = 0
            try:
                if self.records_file.exists():
                    self.records_file.unlink()
            except Exception:
                pass
            return count


# ============================================================
# 全局单例
# ============================================================
_tracker_instance: Optional[LLMCostTracker] = None
_tracker_lock = threading.Lock()


def get_tracker() -> LLMCostTracker:
    """获取全局成本追踪器"""
    global _tracker_instance
    with _tracker_lock:
        if _tracker_instance is None:
            _tracker_instance = LLMCostTracker()
        return _tracker_instance


def reset_tracker() -> None:
    """重置全局单例（测试用）"""
    global _tracker_instance
    with _tracker_lock:
        _tracker_instance = None
