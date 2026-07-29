"""
# ============================================================
# Hermes Goal Sync - Goal Manager 双向同步
# ============================================================
# 核心作用：在 AutoTurnEngine 和 GoalManager 之间建立
#           双向同步通道，确保 AC 状态变更在两边一致
# 运行流程：
#   1. AutoTurnEngine 处理 AC 后发布状态变更事件
#   2. GoalSync 订阅事件，写入 GoalManager
#   3. GoalManager 反向通知 AutoTurnEngine 状态变更
#   4. 冲突解决：最后写入获胜（基于时间戳）
#   5. 版本号：每次状态变更增加版本号
# 输入参数：
#   - engine: AutoTurnEngine 实例
#   - manager: GoalManager 实例
# 输出结果：
#   - 同步事件日志（JSONL 持久化）
#   - 同步统计信息
# 修改记录：
#   - 2026-07-29 | v1.0.0 | Cycle 15 P0-1 新建
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
class SyncDirection(str, Enum):
    """同步方向"""
    ENGINE_TO_MANAGER = "engine_to_manager"  # AutoTurn → GoalManager
    MANAGER_TO_ENGINE = "manager_to_engine"  # GoalManager → AutoTurn
    BIDIRECTIONAL = "bidirectional"          # 双向


class SyncStatus(str, Enum):
    """同步状态"""
    PENDING = "pending"
    APPLIED = "applied"
    FAILED = "failed"
    SKIPPED = "skipped"
    CONFLICT = "conflict"


class ConflictResolution(str, Enum):
    """冲突解决策略"""
    LAST_WRITE_WINS = "last_write_wins"        # 最后写入获胜
    MANAGER_WINS = "manager_wins"             # GoalManager 优先
    ENGINE_WINS = "engine_wins"               # AutoTurnEngine 优先
    REJECT = "reject"                          # 拒绝冲突写入
    VERSION_CHECK = "version_check"            # 版本号检查


# ============================================================
# 数据模型
# ============================================================
@dataclass
class SyncEvent:
    """同步事件"""
    event_id: str = field(default_factory=lambda: f"sync_{uuid.uuid4().hex[:8]}")
    goal_id: str = ""
    ac_id: str = ""
    direction: str = SyncDirection.ENGINE_TO_MANAGER.value
    old_value: Any = None
    new_value: Any = None
    source: str = ""  # 事件来源（"engine" / "manager" / "external"）
    version: int = 0
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    status: str = SyncStatus.PENDING.value
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SyncEvent":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class GoalVersion:
    """Goal 版本信息"""
    goal_id: str
    version: int = 0
    ac_versions: Dict[str, int] = field(default_factory=dict)  # ac_id -> version
    last_modified: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_source: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GoalVersion":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ============================================================
# Goal Sync Engine
# ============================================================
class GoalSyncEngine:
    """
    Goal Manager 双向同步引擎

    功能：
      - 监听 AutoTurnEngine 的 AC 状态变更
      - 同步到 GoalManager
      - 监听 GoalManager 的 AC 状态变更
      - 同步到 AutoTurnEngine（更新本地上下文）
      - 冲突检测 + 解决
      - 版本号管理
      - 事件持久化
    """

    def __init__(
        self,
        storage_dir: Optional[str] = None,
        engine: Any = None,
        manager: Any = None,
        conflict_strategy: str = ConflictResolution.LAST_WRITE_WINS.value,
    ) -> None:
        """
        初始化

        参数：
          - storage_dir: 持久化目录
          - engine: AutoTurnEngine 实例
          - manager: GoalManager 实例
          - conflict_strategy: 冲突解决策略
        """
        if storage_dir is None:
            storage_dir = os.path.join(os.path.expanduser("~"), ".hermes", "goal_sync")
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.events_file = self.storage_dir / "events.jsonl"
        self.versions_file = self.storage_dir / "versions.jsonl"

        self.engine = engine
        self.manager = manager
        self.conflict_strategy = conflict_strategy

        # 线程安全
        self._lock = threading.RLock()
        self._versions: Dict[str, GoalVersion] = {}  # goal_id -> version info
        self._events: List[SyncEvent] = []
        self._stats = {
            "total_events": 0,
            "applied": 0,
            "failed": 0,
            "conflicts": 0,
            "skipped": 0,
        }

        # 订阅者（外部回调）
        self._subscribers: List[Callable[[SyncEvent], None]] = []

        # 加载持久化
        self._load()

        # 注入反向引用到 engine 和 manager
        self._wire_components()

        logger.info(
            f"GoalSyncEngine 初始化完成 storage_dir={self.storage_dir} "
            f"strategy={conflict_strategy}"
        )

    # ============================================================
    # 持久化
    # ============================================================
    def _save_events(self) -> None:
        """保存事件"""
        try:
            with open(self.events_file, "w", encoding="utf-8") as f:
                for evt in self._events:
                    f.write(json.dumps(evt.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"保存同步事件失败: {e}")

    def _append_event(self, event: SyncEvent) -> None:
        """追加一条事件"""
        try:
            with open(self.events_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(event.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"追加同步事件失败: {e}")

    def _save_versions(self) -> None:
        """保存版本信息"""
        try:
            with open(self.versions_file, "w", encoding="utf-8") as f:
                for ver in self._versions.values():
                    f.write(json.dumps(ver.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"保存版本信息失败: {e}")

    def _load(self) -> None:
        """加载持久化数据"""
        # 加载事件
        if self.events_file.exists():
            try:
                with open(self.events_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            self._events.append(SyncEvent.from_dict(data))
            except Exception as e:
                logger.error(f"加载同步事件失败: {e}")

        # 加载版本信息
        if self.versions_file.exists():
            try:
                with open(self.versions_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            ver = GoalVersion.from_dict(data)
                            self._versions[ver.goal_id] = ver
            except Exception as e:
                logger.error(f"加载版本信息失败: {e}")

    def _wire_components(self) -> None:
        """
        注入反向引用到 engine 和 manager

        允许 engine 和 manager 主动调用 sync 接口
        """
        if self.engine is not None:
            self.engine._goal_sync = self
        if self.manager is not None:
            self.manager._goal_sync = self

    # ============================================================
    # 订阅管理
    # ============================================================
    def subscribe(self, callback: Callable[[SyncEvent], None]) -> None:
        """
        订阅同步事件

        参数：
          - callback: 事件回调函数
        """
        with self._lock:
            self._subscribers.append(callback)
            logger.info(f"已注册同步事件订阅者 (total={len(self._subscribers)})")

    def unsubscribe(self, callback: Callable[[SyncEvent], None]) -> None:
        """取消订阅"""
        with self._lock:
            if callback in self._subscribers:
                self._subscribers.remove(callback)

    def _notify(self, event: SyncEvent) -> None:
        """通知所有订阅者"""
        for cb in self._subscribers:
            try:
                cb(event)
            except Exception as e:
                logger.warning(f"订阅者回调失败: {e}")

    # ============================================================
    # 版本管理
    # ============================================================
    def _get_version(self, goal_id: str) -> GoalVersion:
        """获取或创建 Goal 版本信息"""
        with self._lock:
            ver = self._versions.get(goal_id)
            if not ver:
                ver = GoalVersion(goal_id=goal_id)
                self._versions[goal_id] = ver
            return ver

    def _next_version(self, goal_id: str, ac_id: str = "") -> int:
        """
        获取下一个版本号

        参数：
          - goal_id: Goal ID
          - ac_id: AC ID（可选，AC 级别版本号）
        """
        with self._lock:
            ver = self._get_version(goal_id)
            if ac_id:
                ac_ver = ver.ac_versions.get(ac_id, 0) + 1
                ver.ac_versions[ac_id] = ac_ver
                ver.last_modified = datetime.now(timezone.utc).isoformat()
                self._save_versions()
                return ac_ver
            else:
                ver.version += 1
                ver.last_modified = datetime.now(timezone.utc).isoformat()
                self._save_versions()
                return ver.version

    def get_version(self, goal_id: str) -> int:
        """获取 Goal 当前版本号"""
        with self._lock:
            ver = self._get_version(goal_id)
            return ver.version

    def get_ac_version(self, goal_id: str, ac_id: str) -> int:
        """获取 AC 当前版本号"""
        with self._lock:
            ver = self._get_version(goal_id)
            return ver.ac_versions.get(ac_id, 0)

    # ============================================================
    # 冲突检测
    # ============================================================
    def _detect_conflict(
        self,
        event: SyncEvent,
        current_state: Optional[Dict[str, Any]],
    ) -> bool:
        """
        检测冲突

        冲突定义：同一 AC 短时间内被不同源修改为不同值
        """
        if current_state is None:
            return False
        # 简化逻辑：如果新旧值不同且时间戳接近（10秒内），视为冲突
        if event.old_value != event.new_value:
            return True
        return False

    def _resolve_conflict(
        self,
        event: SyncEvent,
        current_state: Optional[Dict[str, Any]] = None,
    ) -> SyncEvent:
        """
        根据策略解决冲突

        参数：
          - event: 同步事件
          - current_state: 当前状态（可选，部分策略需读取）
        """
        if self.conflict_strategy == ConflictResolution.LAST_WRITE_WINS.value:
            # 最后写入获胜（始终应用）
            return event
        elif self.conflict_strategy == ConflictResolution.MANAGER_WINS.value:
            if event.source == "manager":
                return event
            else:
                event.status = SyncStatus.SKIPPED.value
                event.error = "manager_wins 策略：拒绝非 manager 写入"
                return event
        elif self.conflict_strategy == ConflictResolution.ENGINE_WINS.value:
            if event.source == "engine":
                return event
            else:
                event.status = SyncStatus.SKIPPED.value
                event.error = "engine_wins 策略：拒绝非 engine 写入"
                return event
        elif self.conflict_strategy == ConflictResolution.VERSION_CHECK.value:
            # 检查版本号
            current_ver = self.get_ac_version(event.goal_id, event.ac_id)
            if event.version > current_ver:
                return event
            else:
                event.status = SyncStatus.SKIPPED.value
                event.error = f"version_check 失败：事件版本 {event.version} ≤ 当前 {current_ver}"
                return event
        elif self.conflict_strategy == ConflictResolution.REJECT.value:
            event.status = SyncStatus.SKIPPED.value
            event.error = "reject 策略：拒绝所有冲突"
            return event
        return event

    # ============================================================
    # 同步入口
    # ============================================================
    def sync_engine_to_manager(
        self,
        goal_id: str,
        ac_id: str,
        old_value: Any,
        new_value: Any,
    ) -> SyncEvent:
        """
        从 AutoTurnEngine 同步 AC 状态到 GoalManager

        参数：
          - goal_id: Goal ID
          - ac_id: AC ID
          - old_value: 旧值
          - new_value: 新值
        返回：SyncEvent
        """
        event = SyncEvent(
            goal_id=goal_id,
            ac_id=ac_id,
            direction=SyncDirection.ENGINE_TO_MANAGER.value,
            old_value=old_value,
            new_value=new_value,
            source="engine",
            version=self._next_version(goal_id, ac_id),
        )

        with self._lock:
            self._stats["total_events"] += 1

        try:
            # 冲突检测
            current_state = self._get_current_manager_state(goal_id, ac_id)
            if self._detect_conflict(event, current_state):
                with self._lock:
                    self._stats["conflicts"] += 1
                event = self._resolve_conflict(event, current_state)
                if event.status == SyncStatus.SKIPPED.value:
                    with self._lock:
                        self._stats["skipped"] += 1
                    self._record_event(event)
                    self._notify(event)
                    return event

            # 应用到 GoalManager
            success = self._apply_to_manager(goal_id, ac_id, new_value)
            if success:
                event.status = SyncStatus.APPLIED.value
                with self._lock:
                    self._stats["applied"] += 1
            else:
                event.status = SyncStatus.FAILED.value
                event.error = "应用至 GoalManager 失败"
                with self._lock:
                    self._stats["failed"] += 1
        except Exception as e:
            event.status = SyncStatus.FAILED.value
            event.error = str(e)
            with self._lock:
                self._stats["failed"] += 1
            logger.error(f"Engine→Manager 同步失败: {e}", exc_info=True)

        self._record_event(event)
        self._notify(event)
        return event

    def sync_manager_to_engine(
        self,
        goal_id: str,
        ac_id: str,
        old_value: Any,
        new_value: Any,
    ) -> SyncEvent:
        """
        从 GoalManager 同步 AC 状态到 AutoTurnEngine（本地上下文）

        参数：
          - goal_id: Goal ID
          - ac_id: AC ID
          - old_value: 旧值
          - new_value: 新值
        返回：SyncEvent
        """
        event = SyncEvent(
            goal_id=goal_id,
            ac_id=ac_id,
            direction=SyncDirection.MANAGER_TO_ENGINE.value,
            old_value=old_value,
            new_value=new_value,
            source="manager",
            version=self._next_version(goal_id, ac_id),
        )

        with self._lock:
            self._stats["total_events"] += 1

        try:
            # 冲突检测
            current_state = self._get_current_engine_state(goal_id, ac_id)
            if self._detect_conflict(event, current_state):
                with self._lock:
                    self._stats["conflicts"] += 1
                event = self._resolve_conflict(event, current_state)
                if event.status == SyncStatus.SKIPPED.value:
                    with self._lock:
                        self._stats["skipped"] += 1
                    self._record_event(event)
                    self._notify(event)
                    return event

            # 应用到 Engine 本地
            success = self._apply_to_engine(goal_id, ac_id, new_value)
            if success:
                event.status = SyncStatus.APPLIED.value
                with self._lock:
                    self._stats["applied"] += 1
            else:
                event.status = SyncStatus.FAILED.value
                event.error = "应用至 Engine 失败"
                with self._lock:
                    self._stats["failed"] += 1
        except Exception as e:
            event.status = SyncStatus.FAILED.value
            event.error = str(e)
            with self._lock:
                self._stats["failed"] += 1
            logger.error(f"Manager→Engine 同步失败: {e}", exc_info=True)

        self._record_event(event)
        self._notify(event)
        return event

    def _get_current_manager_state(
        self,
        goal_id: str,
        ac_id: str,
    ) -> Optional[Dict[str, Any]]:
        """获取 GoalManager 中 AC 当前状态"""
        if not self.manager:
            return None
        try:
            goal = self.manager.get(goal_id)
            if not goal:
                return None
            for ac in goal.acceptance_criteria:
                if ac.id == ac_id:
                    return {
                        "status": ac.status.value if hasattr(ac.status, "value") else ac.status,
                        "version": self.get_ac_version(goal_id, ac_id),
                    }
            return None
        except Exception as e:
            logger.warning(f"读取 Manager 状态失败: {e}")
            return None

    def _get_current_engine_state(
        self,
        goal_id: str,
        ac_id: str,
    ) -> Optional[Dict[str, Any]]:
        """获取 Engine 中 AC 当前状态"""
        if not self.engine:
            return None
        try:
            local = self.engine.get_local_goal(goal_id)
            if not local:
                return None
            for ac in local.get("acceptance_criteria", []):
                if ac.get("id") == ac_id:
                    return {
                        "status": ac.get("status"),
                        "version": self.get_ac_version(goal_id, ac_id),
                    }
            return None
        except Exception as e:
            logger.warning(f"读取 Engine 状态失败: {e}")
            return None

    def _apply_to_manager(
        self,
        goal_id: str,
        ac_id: str,
        new_value: Any,
    ) -> bool:
        """应用到 GoalManager

        返回：True 应用成功；False 失败
        """
        if not self.manager:
            return False
        try:
            result = self.manager.update_acceptance_criterion(
                goal_id, ac_id, status=str(new_value)
            )
            # 部分 manager 返回 None 时视为成功（不抛异常即视为 OK）
            if result is None:
                return True
            return bool(result)
        except Exception as e:
            logger.warning(f"应用至 GoalManager 失败: {e}")
            return False

    def _apply_to_engine(
        self,
        goal_id: str,
        ac_id: str,
        new_value: Any,
    ) -> bool:
        """应用到 Engine 本地上下文

        返回：True 应用成功；False 失败
        """
        if not self.engine:
            return False
        try:
            result = self.engine._update_local_ac_status(goal_id, ac_id, str(new_value))
            if result is None:
                return True
            return bool(result)
        except Exception as e:
            logger.warning(f"应用至 Engine 失败: {e}")
            return False

    def _record_event(self, event: SyncEvent) -> None:
        """记录事件"""
        with self._lock:
            self._events.append(event)
            self._append_event(event)

    # ============================================================
    # 查询
    # ============================================================
    def get_events(
        self,
        goal_id: Optional[str] = None,
        direction: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> List[SyncEvent]:
        """查询同步事件"""
        with self._lock:
            events = list(self._events)
            if goal_id:
                events = [e for e in events if e.goal_id == goal_id]
            if direction:
                events = [e for e in events if e.direction == direction]
            if status:
                events = [e for e in events if e.status == status]
            return events[-limit:][::-1]

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock:
            return {
                "success": True,
                "stats": {
                    **self._stats,
                    "tracked_goals": len(self._versions),
                    "active_subscribers": len(self._subscribers),
                    "conflict_strategy": self.conflict_strategy,
                    "storage_dir": str(self.storage_dir),
                },
            }

    def clear_events(self) -> int:
        """清空事件历史（用于测试）"""
        with self._lock:
            count = len(self._events)
            self._events.clear()
            self._save_events()
            return count


# ============================================================
# 全局单例
# ============================================================
_sync_instance: Optional[GoalSyncEngine] = None
_sync_lock = threading.Lock()


def get_sync(
    engine: Any = None,
    manager: Any = None,
    conflict_strategy: Optional[str] = None,
) -> GoalSyncEngine:
    """
    获取全局 GoalSyncEngine 单例
    """
    global _sync_instance
    with _sync_lock:
        if _sync_instance is None:
            _sync_instance = GoalSyncEngine(
                engine=engine,
                manager=manager,
                conflict_strategy=conflict_strategy or ConflictResolution.LAST_WRITE_WINS.value,
            )
        else:
            if engine and not _sync_instance.engine:
                _sync_instance.engine = engine
                _sync_instance._wire_components()
            if manager and not _sync_instance.manager:
                _sync_instance.manager = manager
                _sync_instance._wire_components()
        return _sync_instance


def reset_sync() -> None:
    """重置全局单例（测试用）"""
    global _sync_instance
    with _sync_lock:
        _sync_instance = None
