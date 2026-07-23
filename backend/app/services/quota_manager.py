"""
# ============================================================
# 配额全流程管控管理器（V4.1 新增）
# ============================================================
# 核心作用：实时监控全量+单模型 API 调用次数与 Token 消耗，
#           实现三级告警与熔断机制，动态调整并行任务上限
# 运行流程：
#   1. 系统启动时初始化配额管理器，读取全局配置
#   2. 每次 API 调用后记录调用次数与 Token 消耗
#   3. 实时计算三个时间维度的配额消耗百分比
#   4. 达到阈值时触发对应等级的告警/熔断
#   5. 配额恢复时自动降级管控规则
# 输入参数：
#   - record_call(model_name, tokens_used): 记录一次 API 调用
#   - get_alert_level(): 获取当前告警等级
#   - get_max_parallel(): 获取当前允许的最大并行任务数
# 输出结果：告警等级、配额剩余、并行上限等管控参数
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现三级告警熔断与并行限流联动
# ============================================================
"""

import time
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple
from collections import defaultdict, deque

from backend.app.config import settings

logger = logging.getLogger(__name__)


class QuotaManager:
    """
    配额全流程管控管理器
    作用：实时监控 API 调用配额，触发三级告警与熔断机制
    调用方：main.py（初始化）、CLI 执行器（记录调用）、API 路由（查询状态）
    被调用方：无（顶层管控）
    """

    # 告警等级枚举
    ALERT_NONE = 0       # 无告警
    ALERT_LEVEL_1 = 1    # 一级告警（50%）
    ALERT_LEVEL_2 = 2    # 二级告警（80%）
    ALERT_LEVEL_3 = 3    # 三级告警/熔断（100%）

    def __init__(self):
        """
        初始化配额管理器
        运行步骤：
          1. 从全局配置读取配额参数
          2. 初始化三个时间维度的调用记录队列
          3. 初始化单模型独立统计
          4. 启动后台监控线程
        """
        quota_config = settings.quota

        # 配额基准
        self.quota_5h: int = quota_config.get("per_5_hours", 6000)
        self.quota_week: int = quota_config.get("per_week", 45000)
        self.quota_month: int = quota_config.get("per_month", 90000)

        # 告警阈值（百分比）
        self.threshold_1: float = quota_config.get("alert_level_1", 50) / 100.0
        self.threshold_2: float = quota_config.get("alert_level_2", 80) / 100.0
        self.threshold_3: float = quota_config.get("alert_level_3", 100) / 100.0

        # 并行任务上限（按告警等级）
        self.max_parallel_normal: int = quota_config.get("max_parallel_normal", 5)
        self.max_parallel_l1: int = quota_config.get("max_parallel_level_1", 3)
        self.max_parallel_l2: int = quota_config.get("max_parallel_level_2", 2)
        self.max_parallel_l3: int = quota_config.get("max_parallel_level_3", 1)

        # 单分钟调用上限（按告警等级）
        self.max_calls_per_minute_normal: int = quota_config.get("max_calls_per_minute_normal", 20)
        self.max_calls_per_minute_l1: int = quota_config.get("max_calls_per_minute_level_1", 15)
        self.max_calls_per_minute_l2: int = quota_config.get("max_calls_per_minute_level_2", 10)
        self.max_calls_per_minute_l3: int = quota_config.get("max_calls_per_minute_level_3", 5)

        # 熔断恢复规则
        self.auto_restart_high_priority: bool = quota_config.get("auto_restart_high_priority", True)
        self.auto_restart_wait_minutes: int = quota_config.get("auto_restart_wait_minutes", 60)

        # 低优先级任务防饿死
        self.low_priority_starvation_hours: int = quota_config.get("low_priority_starvation_hours", 24)

        # ---- 调用记录 ----
        # 5 小时滚动窗口：记录 (timestamp, model_name, tokens)
        self._calls_5h: deque = deque()
        # 每周记录
        self._calls_week: deque = deque()
        # 每月记录
        self._calls_month: deque = deque()

        # 单模型独立统计：model_name -> deque of (timestamp, tokens)
        self._model_calls: Dict[str, deque] = defaultdict(deque)

        # 累计 Token 消耗
        self._total_tokens_input: int = 0
        self._total_tokens_output: int = 0

        # 当前告警等级
        self._current_alert_level: int = self.ALERT_NONE

        # 是否已熔断
        self._is_fused: bool = False

        # 熔断时间戳
        self._fuse_timestamp: Optional[float] = None

        # 告警回调列表
        self._alert_callbacks: list = []

        # 线程安全锁
        self._lock = threading.Lock()

        # 后台清理线程
        self._cleanup_thread: Optional[threading.Thread] = None
        self._running: bool = False

        logger.info(
            "配额管理器初始化完成 | 5h配额=%d 周配额=%d 月配额=%d | "
            "阈值: %.0f%%/%.0f%%/%.0f%%",
            self.quota_5h, self.quota_week, self.quota_month,
            self.threshold_1 * 100, self.threshold_2 * 100, self.threshold_3 * 100,
        )

    # ============================================================
    # 调用记录
    # ============================================================

    def record_call(self, model_name: str = "default", tokens_input: int = 0, tokens_output: int = 0):
        """
        记录一次 API 调用
        参数：
          model_name: 模型名称
          tokens_input: 输入 Token 数
          tokens_output: 输出 Token 数
        运行步骤：
          1. 加锁保护并发写入
          2. 记录调用时间戳到三个时间维度队列
          3. 更新单模型统计
          4. 更新累计 Token 消耗
          5. 清理过期记录
          6. 重新评估告警等级
        """
        now = time.time()
        total_tokens = tokens_input + tokens_output

        with self._lock:
            # 记录到三个时间维度
            self._calls_5h.append((now, model_name, total_tokens))
            self._calls_week.append((now, model_name, total_tokens))
            self._calls_month.append((now, model_name, total_tokens))

            # 单模型统计
            self._model_calls[model_name].append((now, total_tokens))

            # 累计 Token
            self._total_tokens_input += tokens_input
            self._total_tokens_output += tokens_output

            # 清理过期记录
            self._cleanup_expired()

            # 重新评估告警等级
            self._evaluate_alert_level()

    def _cleanup_expired(self):
        """
        清理过期的调用记录
        运行步骤：
          1. 清理 5 小时前的记录
          2. 清理本周前的记录（周一 00:00 为界）
          3. 清理本月前的记录（订阅日 00:00 为界）
        """
        now = time.time()
        five_hours_ago = now - 5 * 3600

        # 清理 5 小时窗口
        while self._calls_5h and self._calls_5h[0][0] < five_hours_ago:
            self._calls_5h.popleft()

        # 清理周窗口（本周一 00:00）
        today = datetime.now(timezone.utc)
        monday = today - timedelta(days=today.weekday())
        week_start = monday.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        while self._calls_week and self._calls_week[0][0] < week_start:
            self._calls_week.popleft()

        # 清理月窗口（本月 1 日 00:00）
        month_start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()
        while self._calls_month and self._calls_month[0][0] < month_start:
            self._calls_month.popleft()

        # 清理单模型过期记录
        for model_name in list(self._model_calls.keys()):
            model_q = self._model_calls[model_name]
            while model_q and model_q[0][0] < five_hours_ago:
                model_q.popleft()
            if not model_q:
                del self._model_calls[model_name]

    # ============================================================
    # 配额消耗统计
    # ============================================================

    def _get_usage_5h(self) -> Tuple[int, float]:
        """
        获取 5 小时滚动窗口的调用次数和消耗百分比
        返回值：(调用次数, 消耗百分比 0.0-1.0)
        """
        count = len(self._calls_5h)
        percentage = count / self.quota_5h if self.quota_5h > 0 else 0.0
        return count, percentage

    def _get_usage_week(self) -> Tuple[int, float]:
        """获取本周调用次数和消耗百分比"""
        count = len(self._calls_week)
        percentage = count / self.quota_week if self.quota_week > 0 else 0.0
        return count, percentage

    def _get_usage_month(self) -> Tuple[int, float]:
        """获取本月调用次数和消耗百分比"""
        count = len(self._calls_month)
        percentage = count / self.quota_month if self.quota_month > 0 else 0.0
        return count, percentage

    # ============================================================
    # 告警等级评估
    # ============================================================

    def _evaluate_alert_level(self):
        """
        评估当前告警等级
        运行步骤：
          1. 计算三个时间维度的消耗百分比
          2. 取最严格的告警等级
          3. 如果等级变化，触发告警回调
          4. 更新当前等级和熔断状态
        """
        _, pct_5h = self._get_usage_5h()
        _, pct_week = self._get_usage_week()
        _, pct_month = self._get_usage_month()

        # 取最严格的维度
        max_pct = max(pct_5h, pct_week, pct_month)

        # 确定告警等级
        if max_pct >= self.threshold_3:
            new_level = self.ALERT_LEVEL_3
        elif max_pct >= self.threshold_2:
            new_level = self.ALERT_LEVEL_2
        elif max_pct >= self.threshold_1:
            new_level = self.ALERT_LEVEL_1
        else:
            new_level = self.ALERT_NONE

        # 检查等级是否变化
        if new_level != self._current_alert_level:
            old_level = self._current_alert_level
            self._current_alert_level = new_level

            # 更新熔断状态
            if new_level == self.ALERT_LEVEL_3:
                self._is_fused = True
                self._fuse_timestamp = time.time()
                logger.critical(
                    "【配额熔断】全量配额用尽！5h=%.1f%% 周=%.1f%% 月=%.1f%% | 暂停所有大模型调用",
                    pct_5h * 100, pct_week * 100, pct_month * 100,
                )
            elif old_level == self.ALERT_LEVEL_3 and new_level < self.ALERT_LEVEL_3:
                # 熔断恢复
                self._is_fused = False
                self._fuse_timestamp = None
                logger.info(
                    "【配额恢复】熔断解除 | 当前等级=%d | 5h=%.1f%% 周=%.1f%% 月=%.1f%%",
                    new_level, pct_5h * 100, pct_week * 100, pct_month * 100,
                )

            # 触发告警回调
            self._trigger_alert_callbacks(old_level, new_level, pct_5h, pct_week, pct_month)

    def _trigger_alert_callbacks(self, old_level: int, new_level: int,
                                  pct_5h: float, pct_week: float, pct_month: float):
        """
        触发告警回调
        参数：
          old_level: 旧告警等级
          new_level: 新告警等级
          pct_5h/pct_week/pct_month: 各维度消耗百分比
        """
        alert_messages = {
            self.ALERT_LEVEL_1: (
                "【一级告警】配额消耗达到 50% | "
                f"5h={pct_5h*100:.1f}% 周={pct_week*100:.1f}% 月={pct_month*100:.1f}% | "
                "并行上限降至 3 个"
            ),
            self.ALERT_LEVEL_2: (
                "【二级告警】配额消耗达到 80%，普通配额用尽 | "
                f"5h={pct_5h*100:.1f}% 周={pct_week*100:.1f}% 月={pct_month*100:.1f}% | "
                "并行上限降至 2 个"
            ),
            self.ALERT_LEVEL_3: (
                "【三级熔断】全量配额用尽！ | "
                f"5h={pct_5h*100:.1f}% 周={pct_week*100:.1f}% 月={pct_month*100:.1f}% | "
                "已暂停所有大模型调用"
            ),
        }

        if new_level in alert_messages:
            msg = alert_messages[new_level]
            if new_level >= self.ALERT_LEVEL_2:
                logger.warning(msg)
            else:
                logger.info(msg)

        # 调用外部回调
        for callback in self._alert_callbacks:
            try:
                callback(old_level, new_level, pct_5h, pct_week, pct_month)
            except Exception as e:
                logger.error("告警回调执行失败: %s", e)

    def register_alert_callback(self, callback):
        """
        注册告警回调函数
        参数：
          callback: 回调函数，签名为 (old_level, new_level, pct_5h, pct_week, pct_month)
        """
        self._alert_callbacks.append(callback)

    # ============================================================
    # 管控规则查询
    # ============================================================

    def get_alert_level(self) -> int:
        """获取当前告警等级"""
        return self._current_alert_level

    def is_fused(self) -> bool:
        """检查是否已熔断"""
        return self._is_fused

    def get_max_parallel(self) -> int:
        """
        获取当前允许的最大并行任务数
        根据告警等级动态返回
        """
        level_map = {
            self.ALERT_NONE: self.max_parallel_normal,
            self.ALERT_LEVEL_1: self.max_parallel_l1,
            self.ALERT_LEVEL_2: self.max_parallel_l2,
            self.ALERT_LEVEL_3: self.max_parallel_l3,
        }
        return level_map.get(self._current_alert_level, self.max_parallel_normal)

    def get_max_calls_per_minute(self) -> int:
        """
        获取当前允许的单分钟最大调用次数
        根据告警等级动态返回
        """
        level_map = {
            self.ALERT_NONE: self.max_calls_per_minute_normal,
            self.ALERT_LEVEL_1: self.max_calls_per_minute_l1,
            self.ALERT_LEVEL_2: self.max_calls_per_minute_l2,
            self.ALERT_LEVEL_3: self.max_calls_per_minute_l3,
        }
        return level_map.get(self._current_alert_level, self.max_calls_per_minute_normal)

    def can_make_call(self) -> bool:
        """
        检查是否可以发起新的 API 调用
        三级熔断时返回 False
        """
        return not self._is_fused

    # ============================================================
    # 统计信息查询
    # ============================================================

    def get_stats(self) -> Dict:
        """
        获取完整的配额统计信息
        返回值：
          {
            "alert_level": int,          # 当前告警等级
            "is_fused": bool,            # 是否熔断
            "max_parallel": int,         # 当前最大并行数
            "max_calls_per_minute": int, # 当前单分钟最大调用
            "usage_5h": {"count": int, "quota": int, "percentage": float},
            "usage_week": {"count": int, "quota": int, "percentage": float},
            "usage_month": {"count": int, "quota": int, "percentage": float},
            "total_tokens_input": int,
            "total_tokens_output": int,
            "total_tokens": int,
            "model_stats": {model_name: {"count": int, "tokens": int}},
          }
        """
        count_5h, pct_5h = self._get_usage_5h()
        count_week, pct_week = self._get_usage_week()
        count_month, pct_month = self._get_usage_month()

        model_stats = {}
        for model_name, model_q in self._model_calls.items():
            model_stats[model_name] = {
                "count": len(model_q),
                "tokens": sum(t for _, t in model_q),
            }

        return {
            "alert_level": self._current_alert_level,
            "is_fused": self._is_fused,
            "max_parallel": self.get_max_parallel(),
            "max_calls_per_minute": self.get_max_calls_per_minute(),
            "usage_5h": {
                "count": count_5h,
                "quota": self.quota_5h,
                "percentage": round(pct_5h * 100, 2),
            },
            "usage_week": {
                "count": count_week,
                "quota": self.quota_week,
                "percentage": round(pct_week * 100, 2),
            },
            "usage_month": {
                "count": count_month,
                "quota": self.quota_month,
                "percentage": round(pct_month * 100, 2),
            },
            "total_tokens_input": self._total_tokens_input,
            "total_tokens_output": self._total_tokens_output,
            "total_tokens": self._total_tokens_input + self._total_tokens_output,
            "model_stats": model_stats,
        }

    # ============================================================
    # 后台管理
    # ============================================================

    def start_background_cleanup(self, interval: int = 60):
        """
        启动后台定期清理线程
        参数：
          interval: 清理间隔（秒），默认 60 秒
        """
        if self._running:
            return
        self._running = True

        def _cleanup_loop():
            while self._running:
                time.sleep(interval)
                with self._lock:
                    self._cleanup_expired()
                    self._evaluate_alert_level()

        self._cleanup_thread = threading.Thread(target=_cleanup_loop, daemon=True)
        self._cleanup_thread.start()
        logger.info("配额管理器后台清理线程已启动 | 间隔=%ds", interval)

    def stop_background_cleanup(self):
        """停止后台清理线程"""
        self._running = False
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=5)
        logger.info("配额管理器后台清理线程已停止")


# 全局配额管理器单例
quota_manager = QuotaManager()
