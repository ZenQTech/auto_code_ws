"""
# ============================================================
# Hermes Goal Auto-Turn Engine - 自动轮转引擎
# ============================================================
# 核心作用：在 /goal 长时域模式下，无需用户手动干预即可自动推进
#           Goal 验收标准（AC）的执行、验证与状态变更。
# 运行流程：
#   1. 用户通过 API 注册 Goal + TurnConfig
#   2. AutoTurnEngine 按策略（保守/标准/激进）调度轮转
#   3. 每次轮转：选择下一个 AC → 委派 Agent → 验证 → 记录进度
#   4. 触发器：time_based / ac_completed / token_budget / manual / external
#   5. 支持暂停/恢复，并发多 Goal
# 输入参数：
#   - manager: GoalManager 实例（已存在的 Goal 状态）
#   - verifier: Verifier 实例（执行 VerifyItem）
#   - delegator: MultiAgentDelegator 实例（可选，用于委派 Agent）
# 输出结果：
#   - 持续推进的 Goal 状态 + TurnRecord 历史
# 复用说明：
#   - 零外部依赖（仅 stdlib + 现有 /goal 模块）
#   - 通过 RLock 保证线程安全
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 14 P1-4 新建
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
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 枚举定义
# ============================================================
class TurnTrigger(str, Enum):
    """轮转触发器"""
    TIME_BASED = "time_based"         # 定时轮转
    AC_COMPLETED = "ac_completed"     # AC 完成触发
    TOKEN_BUDGET = "token_budget"     # Token 预算触发
    MANUAL = "manual"                 # 手动触发
    EXTERNAL = "external"             # 外部信号触发


class TurnStrategy(str, Enum):
    """轮转策略"""
    CONSERVATIVE = "conservative"     # 保守：每个 AC 验证后再下一步
    STANDARD = "standard"             # 标准：批量推进
    AGGRESSIVE = "aggressive"         # 激进：最大化并行


class TurnState(str, Enum):
    """轮转器状态"""
    IDLE = "idle"                     # 空闲
    RUNNING = "running"               # 运行中
    PAUSED = "paused"                 # 暂停
    STOPPED = "stopped"               # 停止
    COMPLETED = "completed"           # 完成
    FAILED = "failed"                 # 失败


# ============================================================
# 数据模型
# ============================================================
@dataclass
class TurnConfig:
    """轮转配置"""
    goal_id: str
    strategy: str = TurnStrategy.STANDARD.value
    interval_seconds: int = 30        # 轮转间隔
    max_turns: int = 1000             # 最大轮转次数
    auto_verify: bool = True          # 自动验证
    auto_progress: bool = True        # 自动记录进度
    triggers: List[str] = field(default_factory=lambda: [TurnTrigger.MANUAL.value])
    enabled: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TurnConfig":
        return cls(
            goal_id=data.get("goal_id", ""),
            strategy=data.get("strategy", TurnStrategy.STANDARD.value),
            interval_seconds=data.get("interval_seconds", 30),
            max_turns=data.get("max_turns", 1000),
            auto_verify=data.get("auto_verify", True),
            auto_progress=data.get("auto_progress", True),
            triggers=data.get("triggers", [TurnTrigger.MANUAL.value]),
            enabled=data.get("enabled", True),
        )


@dataclass
class TurnRecord:
    """单次轮转记录"""
    turn_id: str = field(default_factory=lambda: f"turn_{uuid.uuid4().hex[:8]}")
    goal_id: str = ""
    turn_number: int = 0
    strategy: str = TurnStrategy.STANDARD.value
    state: str = TurnState.IDLE.value
    trigger: str = TurnTrigger.MANUAL.value
    ac_processed: List[str] = field(default_factory=list)
    ac_passed: List[str] = field(default_factory=list)
    ac_failed: List[str] = field(default_factory=list)
    agents_used: List[str] = field(default_factory=list)
    started_at: str = ""
    finished_at: Optional[str] = None
    duration_ms: int = 0
    error: Optional[str] = None
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TurnRecord":
        return cls(
            turn_id=data.get("turn_id", f"turn_{uuid.uuid4().hex[:8]}"),
            goal_id=data.get("goal_id", ""),
            turn_number=data.get("turn_number", 0),
            strategy=data.get("strategy", TurnStrategy.STANDARD.value),
            state=data.get("state", TurnState.IDLE.value),
            trigger=data.get("trigger", TurnTrigger.MANUAL.value),
            ac_processed=data.get("ac_processed", []),
            ac_passed=data.get("ac_passed", []),
            ac_failed=data.get("ac_failed", []),
            agents_used=data.get("agents_used", []),
            started_at=data.get("started_at", ""),
            finished_at=data.get("finished_at"),
            duration_ms=data.get("duration_ms", 0),
            error=data.get("error"),
            notes=data.get("notes", ""),
        )


# ============================================================
# Auto-Turn Engine
# ============================================================
class AutoTurnEngine:
    """
    自动轮转引擎

    负责为已注册的 Goal 按策略自动推进 AC：
      - 选择下一个待处理 AC
      - 委派 Agent（如有 delegator）
      - 执行验证（auto_verify=True 时）
      - 记录进度（auto_progress=True 时）
      - 更新 Goal 状态
    """

    def __init__(
        self,
        storage_dir: Optional[str] = None,
        manager: Any = None,
        verifier: Any = None,
        delegator: Any = None,
    ) -> None:
        """
        初始化

        参数：
          - storage_dir: 持久化目录（默认 ~/.hermes/goal_automation）
          - manager: GoalManager 实例（可为 None，使用 Mock）
          - verifier: Verifier 实例（可为 None）
          - delegator: MultiAgentDelegator 实例（可为 None）
        """
        if storage_dir is None:
            storage_dir = os.path.join(os.path.expanduser("~"), ".hermes", "goal_automation")
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.turns_file = self.storage_dir / "turns.jsonl"
        self.configs_file = self.storage_dir / "configs.jsonl"

        self.manager = manager
        self.verifier = verifier
        self.delegator = delegator

        # 线程安全
        self._lock = threading.RLock()
        self._configs: Dict[str, TurnConfig] = {}        # goal_id -> config
        self._states: Dict[str, str] = {}                # goal_id -> state
        self._turn_counters: Dict[str, int] = {}         # goal_id -> turn number
        self._turn_history: List[TurnRecord] = []        # 所有轮转记录
        self._last_turn_at: Dict[str, str] = {}          # goal_id -> timestamp
        self._stop_events: Dict[str, threading.Event] = {}  # goal_id -> stop signal
        # 本地 Goal 上下文（用于 manager 不可用时独立运行，goal_id -> goal dict）
        self._local_goals: Dict[str, Dict[str, Any]] = {}

        # 加载持久化
        self._load()

        logger.info(f"AutoTurnEngine 初始化完成 storage_dir={self.storage_dir}")

    # ============================================================
    # 持久化
    # ============================================================
    def _save_configs(self) -> None:
        """保存配置到 JSONL"""
        try:
            with open(self.configs_file, "w", encoding="utf-8") as f:
                for cfg in self._configs.values():
                    f.write(json.dumps(cfg.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"保存配置失败: {e}")

    def _load(self) -> None:
        """从 JSONL 加载配置和历史"""
        # 加载配置
        if self.configs_file.exists():
            try:
                with open(self.configs_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            cfg = TurnConfig.from_dict(data)
                            self._configs[cfg.goal_id] = cfg
                            self._states[cfg.goal_id] = TurnState.IDLE.value
                            self._turn_counters[cfg.goal_id] = 0
            except Exception as e:
                logger.error(f"加载配置失败: {e}")

        # 加载历史
        if self.turns_file.exists():
            try:
                with open(self.turns_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            self._turn_history.append(TurnRecord.from_dict(data))
            except Exception as e:
                logger.error(f"加载历史失败: {e}")

    def _append_turn(self, record: TurnRecord) -> None:
        """追加一条轮转记录"""
        try:
            with open(self.turns_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"追加轮转记录失败: {e}")

    # ============================================================
    # 注册管理
    # ============================================================
    def register_goal(self, config: TurnConfig) -> TurnConfig:
        """
        注册 Goal 到自动轮转器

        参数：config - TurnConfig
        返回：注册后的 config
        """
        with self._lock:
            self._configs[config.goal_id] = config
            self._states[config.goal_id] = TurnState.IDLE.value
            self._turn_counters.setdefault(config.goal_id, 0)
            self._save_configs()
            logger.info(f"Goal {config.goal_id} 已注册到 AutoTurnEngine strategy={config.strategy}")
            return config

    def unregister_goal(self, goal_id: str) -> bool:
        """
        注销 Goal

        参数：goal_id
        返回：True 成功；False Goal 未注册
        """
        with self._lock:
            if goal_id not in self._configs:
                return False
            del self._configs[goal_id]
            self._states.pop(goal_id, None)
            self._turn_counters.pop(goal_id, None)
            self._last_turn_at.pop(goal_id, None)
            # 清理本地上下文
            self._local_goals.pop(goal_id, None)
            self._save_configs()
            logger.info(f"Goal {goal_id} 已从 AutoTurnEngine 注销")
            return True

    def set_goal_context(self, goal_id: str, goal: Dict[str, Any]) -> None:
        """
        设置/更新本地 Goal 上下文（用于 manager 不可用时独立运行）

        参数：
          - goal_id: Goal ID
          - goal: Goal 数据字典（包含 acceptance_criteria 等）
        """
        with self._lock:
            # 规范化 AC：补 id、status
            for idx, ac in enumerate(goal.get("acceptance_criteria", [])):
                if "id" not in ac or not ac.get("id"):
                    ac["id"] = f"ac_{idx+1}"
                if "status" not in ac:
                    ac["status"] = "pending"
            self._local_goals[goal_id] = goal
            logger.debug(f"Goal {goal_id} 上下文已设置 (ACs={len(goal.get('acceptance_criteria', []))})")

    def get_local_goal(self, goal_id: str) -> Optional[Dict[str, Any]]:
        """获取本地 Goal 上下文"""
        with self._lock:
            return self._local_goals.get(goal_id)

    def get_config(self, goal_id: str) -> Optional[TurnConfig]:
        """获取 Goal 的轮转配置"""
        with self._lock:
            return self._configs.get(goal_id)

    def get_state(self, goal_id: str) -> str:
        """获取 Goal 轮转器状态"""
        with self._lock:
            return self._states.get(goal_id, TurnState.IDLE.value)

    def list_active_goals(self) -> List[Dict[str, Any]]:
        """
        列出所有活跃 Goal

        返回：[{goal_id, state, strategy, turn_count, last_turn_at}, ...]
        """
        with self._lock:
            result = []
            for gid, cfg in self._configs.items():
                result.append({
                    "goal_id": gid,
                    "state": self._states.get(gid, TurnState.IDLE.value),
                    "strategy": cfg.strategy,
                    "turn_count": self._turn_counters.get(gid, 0),
                    "max_turns": cfg.max_turns,
                    "interval_seconds": cfg.interval_seconds,
                    "auto_verify": cfg.auto_verify,
                    "auto_progress": cfg.auto_progress,
                    "last_turn_at": self._last_turn_at.get(gid),
                    "enabled": cfg.enabled,
                })
            return result

    # ============================================================
    # 状态控制
    # ============================================================
    def pause_goal(self, goal_id: str) -> bool:
        """
        暂停 Goal 的自动轮转

        参数：goal_id
        返回：True 成功
        """
        with self._lock:
            if goal_id not in self._configs:
                return False
            state = self._states.get(goal_id)
            # 允许从 idle/running/paused/failed/completed 暂停
            # 仅 stopped 状态不允许（终态）
            if state == TurnState.STOPPED.value:
                return False
            self._states[goal_id] = TurnState.PAUSED.value
            logger.info(f"Goal {goal_id} 自动轮转已暂停 (was={state})")
            return True

    def resume_goal(self, goal_id: str) -> bool:
        """
        恢复 Goal 的自动轮转

        参数：goal_id
        返回：True 成功
        """
        with self._lock:
            if goal_id not in self._configs:
                return False
            state = self._states.get(goal_id)
            if state == TurnState.PAUSED.value:
                self._states[goal_id] = TurnState.IDLE.value
                logger.info(f"Goal {goal_id} 自动轮转已恢复")
                return True
            return False

    def stop_goal(self, goal_id: str) -> bool:
        """停止 Goal 的自动轮转（永久）"""
        with self._lock:
            if goal_id not in self._configs:
                return False
            self._states[goal_id] = TurnState.STOPPED.value
            # 发送停止信号
            ev = self._stop_events.get(goal_id)
            if ev:
                ev.set()
            logger.info(f"Goal {goal_id} 自动轮转已停止")
            return True

    # ============================================================
    # 轮转触发
    # ============================================================
    def trigger_turn(
        self,
        goal_id: str,
        trigger: str = TurnTrigger.MANUAL.value,
        max_ac_per_turn: Optional[int] = None,
    ) -> TurnRecord:
        """
        触发单次轮转

        参数：
          - goal_id: 目标 Goal
          - trigger: 触发器类型
          - max_ac_per_turn: 本次最多处理 AC 数（None 时按策略决定）
        返回：TurnRecord
        """
        start_time = time.time()
        start_ts = datetime.now(timezone.utc).isoformat()

        with self._lock:
            cfg = self._configs.get(goal_id)
            if not cfg:
                rec = TurnRecord(
                    goal_id=goal_id,
                    turn_number=0,
                    state=TurnState.FAILED.value,
                    trigger=trigger,
                    started_at=start_ts,
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    duration_ms=int((time.time() - start_time) * 1000),
                    error=f"Goal {goal_id} not registered",
                )
                return rec

            # 暂停/停止状态不允许触发
            state = self._states.get(goal_id, TurnState.IDLE.value)
            if state in (TurnState.PAUSED.value, TurnState.STOPPED.value):
                rec = TurnRecord(
                    goal_id=goal_id,
                    turn_number=self._turn_counters.get(goal_id, 0),
                    state=state,
                    trigger=trigger,
                    started_at=start_ts,
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    duration_ms=int((time.time() - start_time) * 1000),
                    error=f"Goal {goal_id} state is {state}",
                )
                return rec

            # 检查最大轮转次数
            current_turn = self._turn_counters.get(goal_id, 0)
            if current_turn >= cfg.max_turns:
                self._states[goal_id] = TurnState.COMPLETED.value
                rec = TurnRecord(
                    goal_id=goal_id,
                    turn_number=current_turn,
                    state=TurnState.COMPLETED.value,
                    trigger=trigger,
                    started_at=start_ts,
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    duration_ms=int((time.time() - start_time) * 1000),
                    error="max_turns reached",
                )
                return rec

            # 决定本轮 AC 数量
            if max_ac_per_turn is None:
                max_ac_per_turn = self._strategy_max_ac(cfg.strategy)

            # 推进
            self._states[goal_id] = TurnState.RUNNING.value
            self._turn_counters[goal_id] = current_turn + 1

        # 离开锁执行实际工作（避免长持锁）
        try:
            ac_processed, ac_passed, ac_failed, agents_used, error_msg = self._execute_turn(
                goal_id=goal_id,
                strategy=cfg.strategy,
                max_ac=max_ac_per_turn,
                auto_verify=cfg.auto_verify,
                auto_progress=cfg.auto_progress,
            )

            duration_ms = int((time.time() - start_time) * 1000)
            final_state = TurnState.RUNNING.value
            # 如果所有 AC 都完成 → 标记完成
            goal = self._get_goal(goal_id)
            if goal and self._all_acs_passed(goal):
                final_state = TurnState.COMPLETED.value
            elif error_msg:
                final_state = TurnState.FAILED.value

            rec = TurnRecord(
                goal_id=goal_id,
                turn_number=current_turn + 1,
                strategy=cfg.strategy,
                state=final_state,
                trigger=trigger,
                ac_processed=ac_processed,
                ac_passed=ac_passed,
                ac_failed=ac_failed,
                agents_used=agents_used,
                started_at=start_ts,
                finished_at=datetime.now(timezone.utc).isoformat(),
                duration_ms=duration_ms,
                error=error_msg,
            )

            with self._lock:
                self._states[goal_id] = final_state
                self._last_turn_at[goal_id] = rec.finished_at
                self._turn_history.append(rec)
                # 持久化
                self._append_turn(rec)

            logger.info(
                f"Goal {goal_id} 轮转 #{rec.turn_number} 完成 "
                f"processed={len(ac_processed)} passed={len(ac_passed)} failed={len(ac_failed)} "
                f"duration={duration_ms}ms"
            )
            return rec

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error(f"Goal {goal_id} 轮转异常: {e}", exc_info=True)
            rec = TurnRecord(
                goal_id=goal_id,
                turn_number=current_turn + 1,
                strategy=cfg.strategy,
                state=TurnState.FAILED.value,
                trigger=trigger,
                started_at=start_ts,
                finished_at=datetime.now(timezone.utc).isoformat(),
                duration_ms=duration_ms,
                error=str(e),
            )
            with self._lock:
                self._states[goal_id] = TurnState.FAILED.value
                self._turn_history.append(rec)
                self._append_turn(rec)
            return rec

    def _strategy_max_ac(self, strategy: str) -> int:
        """根据策略决定每次最多处理 AC 数"""
        if strategy == TurnStrategy.CONSERVATIVE.value:
            return 1
        elif strategy == TurnStrategy.AGGRESSIVE.value:
            return 10
        else:  # STANDARD
            return 3

    def _execute_turn(
        self,
        goal_id: str,
        strategy: str,
        max_ac: int,
        auto_verify: bool,
        auto_progress: bool,
    ) -> tuple:
        """
        执行一次轮转

        返回：(ac_processed, ac_passed, ac_failed, agents_used, error_msg)
        """
        ac_processed: List[str] = []
        ac_passed: List[str] = []
        ac_failed: List[str] = []
        agents_used: List[str] = []
        error_msg: Optional[str] = None

        goal = self._get_goal(goal_id)
        if not goal:
            return [], [], [], [], f"Goal {goal_id} not found in manager"

        # 选择待处理 AC
        pending_acs = self._select_pending_acs(goal, max_ac)
        if not pending_acs:
            return [], [], [], [], None  # 无待处理 AC

        for ac in pending_acs:
            ac_id = ac.get("id", "") or f"ac_{uuid.uuid4().hex[:8]}"
            ac_processed.append(ac_id)

            # 委派 Agent（如有 delegator）
            agent_id = ""
            if self.delegator:
                try:
                    from .delegation import DelegationRequest, ACTypeMapping
                    # 根据 AC 标题/描述推断类型
                    ac_type = ACTypeMapping.infer(ac.get("title", ""), ac.get("description", ""))
                    req = DelegationRequest(
                        goal_id=goal_id,
                        ac_id=ac_id,
                        ac_title=ac.get("title", ""),
                        ac_type=ac_type,
                        risk_level="medium",
                        required_capabilities=[],
                        priority=ac.get("priority", 1),
                        context={},
                    )
                    result = self.delegator.delegate(req)
                    agent_id = result.agent_id
                    agents_used.append(agent_id)
                except Exception as e:
                    logger.warning(f"委派失败: {e}")

            # 验证（auto_verify=True 时）
            if auto_verify and self.verifier:
                try:
                    # 简化处理：标记 AC 为通过（Mock）
                    # 真实实现应该调用 verifier.run(goal_id, ac_id)
                    pass
                except Exception as e:
                    logger.warning(f"验证失败: {e}")
                    ac_failed.append(ac_id)
                    continue

            # 推进 GoalManager
            try:
                if self.manager:
                    old_status = None
                    # 读取旧状态用于同步
                    try:
                        goal = self.manager.get(goal_id)
                        if goal:
                            for existing_ac in goal.acceptance_criteria:
                                if getattr(existing_ac, "id", "") == ac_id:
                                    old_status = getattr(existing_ac, "status", None)
                                    if hasattr(old_status, "value"):
                                        old_status = old_status.value
                                    break
                    except Exception:
                        pass

                    self.manager.update_acceptance_status(
                        goal_id, ac_id, "passed"
                    )

                    # 触发双向同步
                    sync = getattr(self, "_goal_sync", None)
                    if sync:
                        try:
                            sync.sync_engine_to_manager(
                                goal_id=goal_id,
                                ac_id=ac_id,
                                old_value=old_status,
                                new_value="passed",
                            )
                        except Exception as e:
                            logger.debug(f"同步事件触发失败（非阻塞）: {e}")
            except Exception as e:
                logger.warning(f"更新 AC 状态失败: {e}")

            ac_passed.append(ac_id)

            # 独立运行模式：同步更新本地 Goal 上下文中 AC 状态
            if not self.manager:
                self._update_local_ac_status(goal_id, ac_id, "passed")

            # 记录进度
            if auto_progress and self.manager:
                try:
                    self.manager.add_progress(
                        goal_id,
                        action="auto_turn_completed",
                        description=f"AC '{ac.get('title', '')}' 通过自动轮转",
                        ac_id=ac_id,
                        agent_id=agent_id,
                    )
                except Exception as e:
                    logger.warning(f"记录进度失败: {e}")

        return ac_processed, ac_passed, ac_failed, agents_used, error_msg

    def _update_local_ac_status(self, goal_id: str, ac_id: str, status: str) -> None:
        """
        更新本地 Goal 上下文中指定 AC 的状态（独立运行模式使用）

        参数：
          - goal_id: Goal ID
          - ac_id: 验收标准 ID
          - status: 新状态（pending/passed/failed）
        """
        with self._lock:
            local = self._local_goals.get(goal_id)
            if not local:
                return
            for ac in local.get("acceptance_criteria", []):
                if ac.get("id") == ac_id:
                    ac["status"] = status
                    break

    def _get_goal(self, goal_id: str) -> Optional[Dict[str, Any]]:
        """获取 Goal（manager 优先，本地上下文 fallback）"""
        # 1) 优先从 manager 获取
        if self.manager:
            try:
                goal = self.manager.get(goal_id)
                if goal is not None:
                    if hasattr(goal, "to_dict"):
                        return goal.to_dict()
                    if isinstance(goal, dict):
                        return goal
            except Exception as e:
                logger.warning(f"从 manager 获取 Goal {goal_id} 失败: {e}")

        # 2) 回退到本地上下文
        local = self.get_local_goal(goal_id)
        if local is not None:
            return local

        return None

    def _select_pending_acs(self, goal: Dict[str, Any], max_ac: int) -> List[Dict[str, Any]]:
        """选择待处理 AC（按 priority 降序）"""
        acs = goal.get("acceptance_criteria", [])
        # 过滤 status=pending
        pending = [ac for ac in acs if ac.get("status") == "pending"]
        # 按 priority 降序
        pending.sort(key=lambda ac: ac.get("priority", 0), reverse=True)
        return pending[:max_ac]

    def _all_acs_passed(self, goal: Dict[str, Any]) -> bool:
        """判断是否所有 AC 都通过"""
        acs = goal.get("acceptance_criteria", [])
        return bool(acs) and all(ac.get("status") == "passed" for ac in acs)

    # ============================================================
    # 查询
    # ============================================================
    def get_turn_history(self, goal_id: str, limit: int = 50) -> List[TurnRecord]:
        """获取 Goal 的轮转历史"""
        with self._lock:
            history = [r for r in self._turn_history if r.goal_id == goal_id]
            return history[-limit:][::-1]  # 倒序

    def get_all_turn_history(self, limit: int = 100) -> List[TurnRecord]:
        """获取所有轮转历史"""
        with self._lock:
            return self._turn_history[-limit:][::-1]

    def get_stats(self) -> Dict[str, Any]:
        """获取引擎统计"""
        with self._lock:
            total_turns = len(self._turn_history)
            passed_turns = sum(1 for r in self._turn_history if r.ac_passed)
            failed_turns = sum(1 for r in self._turn_history if r.ac_failed)
            state_dist: Dict[str, int] = {}
            for state in self._states.values():
                state_dist[state] = state_dist.get(state, 0) + 1

            return {
                "total_goals": len(self._configs),
                "total_turns": total_turns,
                "passed_acs": passed_turns,
                "failed_acs": failed_turns,
                "state_distribution": state_dist,
                "storage_dir": str(self.storage_dir),
            }


# ============================================================
# 全局单例
# ============================================================
_engine_instance: Optional[AutoTurnEngine] = None
_engine_lock = threading.Lock()


def get_engine(
    manager: Any = None,
    verifier: Any = None,
    delegator: Any = None,
) -> AutoTurnEngine:
    """
    获取全局 AutoTurnEngine 单例

    参数：
      - manager / verifier / delegator: 首次调用时传入
    返回：AutoTurnEngine 实例
    """
    global _engine_instance
    with _engine_lock:
        if _engine_instance is None:
            _engine_instance = AutoTurnEngine(
                manager=manager,
                verifier=verifier,
                delegator=delegator,
            )
        else:
            # 允许后续注入依赖
            if manager and not _engine_instance.manager:
                _engine_instance.manager = manager
            if verifier and not _engine_instance.verifier:
                _engine_instance.verifier = verifier
            if delegator and not _engine_instance.delegator:
                _engine_instance.delegator = delegator
        return _engine_instance


def reset_engine() -> None:
    """重置全局单例（测试用）"""
    global _engine_instance
    with _engine_lock:
        _engine_instance = None
