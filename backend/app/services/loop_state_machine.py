"""
# ============================================================
# LoopStateMachine - 显式状态机服务 (v1.0.0)
# Cycle 58 G58-03
# ============================================================
# 核心作用：定义 Loop Engineering 的显式状态机
#           跟踪当前阶段、进度、ETA、迁移历史
# 运行流程：
#   1. LoopStateMachine 维护当前 stage
#   2. transition() 方法记录状态变更（带历史）
#   3. SSE 推送 loop_state_changed 事件
#   4. 前端通过 /api/loop-state/machine/events 订阅
# 设计要点：
#   - 状态机显式定义迁移规则（避免隐式状态）
#   - 全局单例（通过 machine_registry）
#   - SSE 事件自动重连
# 输入参数：session_id, stage
# 输出结果：loop_state_changed 事件流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
# ====================================
"""

import asyncio
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator, Deque, Dict, List, Optional

logger = logging.getLogger(__name__)

# ============================================================
# 状态机定义
# ============================================================


class LoopStage(str, Enum):
    """Loop 状态机阶段（对齐 Loop Engineering v7 + Codex/TRAE Solo 模式）"""
    IDLE = "idle"               # 初始空闲
    CLARIFYING = "clarifying"   # 需求澄清中
    DESIGNING = "designing"     # 架构设计中
    PROMPTING = "prompting"     # 提示词优化中
    EXECUTING = "executing"     # 任务执行中
    REVIEWING = "reviewing"     # 质量评审中
    DONE = "done"               # 已完成
    PAUSED = "paused"           # 暂停
    ERROR = "error"             # 异常
    CANCELLED = "cancelled"     # 取消


# 允许的状态迁移图
ALLOWED_TRANSITIONS: Dict[LoopStage, List[LoopStage]] = {
    LoopStage.IDLE: [LoopStage.CLARIFYING, LoopStage.DESIGNING, LoopStage.CANCELLED],
    LoopStage.CLARIFYING: [LoopStage.DESIGNING, LoopStage.CLARIFYING, LoopStage.CANCELLED, LoopStage.ERROR, LoopStage.PAUSED],
    LoopStage.DESIGNING: [LoopStage.PROMPTING, LoopStage.DESIGNING, LoopStage.CANCELLED, LoopStage.ERROR, LoopStage.PAUSED],
    LoopStage.PROMPTING: [LoopStage.EXECUTING, LoopStage.PROMPTING, LoopStage.CANCELLED, LoopStage.ERROR, LoopStage.PAUSED],
    LoopStage.EXECUTING: [LoopStage.REVIEWING, LoopStage.EXECUTING, LoopStage.CANCELLED, LoopStage.ERROR, LoopStage.PAUSED],
    LoopStage.REVIEWING: [LoopStage.DONE, LoopStage.REVIEWING, LoopStage.EXECUTING, LoopStage.ERROR, LoopStage.PAUSED],
    LoopStage.DONE: [LoopStage.IDLE],
    LoopStage.PAUSED: [LoopStage.CLARIFYING, LoopStage.DESIGNING, LoopStage.PROMPTING, LoopStage.EXECUTING, LoopStage.REVIEWING, LoopStage.CANCELLED],
    LoopStage.ERROR: [LoopStage.IDLE, LoopStage.CANCELLED],
    LoopStage.CANCELLED: [LoopStage.IDLE],
}


@dataclass
class LoopTransition:
    """一次状态迁移"""
    from_state: LoopStage
    to_state: LoopStage
    at: float
    metadata: Dict = field(default_factory=dict)


@dataclass
class LoopStateSnapshot:
    """状态快照"""
    stage: LoopStage
    progress: float
    eta_seconds: float
    session_id: str
    sub_state: Dict = field(default_factory=dict)


# ============================================================
# 状态机实现
# ============================================================


class LoopStateMachine:
    """
    Loop 状态机实例（每个 session 一个）
    
    输入参数：session_id (str)
    """
    
    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id or f"loop-{uuid.uuid4().hex[:16]}"
        self._stage: LoopStage = LoopStage.IDLE
        self._progress: float = 0.0
        self._eta_seconds: float = 0.0
        self._sub_state: Dict = {}
        self._history: Deque[LoopTransition] = deque(maxlen=200)
        self._subscribers: List[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        self._created_at: float = time.time()
    
    @property
    def stage(self) -> LoopStage:
        return self._stage
    
    @property
    def progress(self) -> float:
        return self._progress
    
    @property
    def eta_seconds(self) -> float:
        return self._eta_seconds
    
    @property
    def history(self) -> List[LoopTransition]:
        return list(self._history)
    
    def snapshot(self) -> LoopStateSnapshot:
        """获取当前快照"""
        return LoopStateSnapshot(
            stage=self._stage,
            progress=self._progress,
            eta_seconds=self._eta_seconds,
            session_id=self.session_id,
            sub_state=dict(self._sub_state),
        )
    
    def is_transition_allowed(self, from_stage: LoopStage, to_stage: LoopStage) -> bool:
        """检查状态迁移是否被允许"""
        if from_stage == to_stage:
            return True
        allowed = ALLOWED_TRANSITIONS.get(from_stage, [])
        return to_stage in allowed
    
    async def transition(
        self,
        to_stage: LoopStage,
        progress: Optional[float] = None,
        eta_seconds: Optional[float] = None,
        metadata: Optional[Dict] = None,
        force: bool = False,
    ) -> bool:
        """
        状态迁移
        
        输入参数：
          - to_stage: 目标阶段
          - progress: 新进度（0-1）
          - eta_seconds: 预计剩余秒数
          - metadata: 附加元数据
          - force: 是否强制（跳过校验）
        
        输出结果：bool 是否成功
        """
        async with self._lock:
            from_stage = self._stage
            
            if not force and not self.is_transition_allowed(from_stage, to_stage):
                logger.warning(
                    f"transition: not allowed session={self.session_id} "
                    f"from={from_stage.value} to={to_stage.value}"
                )
                return False
            
            self._stage = to_stage
            if progress is not None:
                self._progress = max(0.0, min(1.0, progress))
            if eta_seconds is not None:
                self._eta_seconds = max(0.0, eta_seconds)
            if metadata:
                self._sub_state.update(metadata)
            
            transition = LoopTransition(
                from_state=from_stage,
                to_state=to_stage,
                at=time.time(),
                metadata=metadata or {},
            )
            self._history.append(transition)
            
            await self._broadcast(transition)
            
            logger.info(
                f"transition: session={self.session_id} "
                f"{from_stage.value} -> {to_stage.value} progress={self._progress:.2f}"
            )
            return True
    
    def set_progress(self, progress: float, eta_seconds: Optional[float] = None) -> None:
        """设置进度（不触发状态变更）"""
        self._progress = max(0.0, min(1.0, progress))
        if eta_seconds is not None:
            self._eta_seconds = max(0.0, eta_seconds)
    
    async def subscribe(self) -> asyncio.Queue:
        """订阅状态变更"""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.append(queue)
        return queue
    
    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        """取消订阅"""
        if queue in self._subscribers:
            self._subscribers.remove(queue)
    
    async def _broadcast(self, transition: LoopTransition) -> None:
        """广播状态变更到所有订阅者"""
        snapshot = self.snapshot()
        event = {
            "type": "loop_state_changed",
            "session_id": self.session_id,
            "stage": snapshot.stage.value,
            "progress": snapshot.progress,
            "eta_seconds": snapshot.eta_seconds,
            "sub_state": snapshot.sub_state,
            "transition": {
                "from_state": transition.from_state.value,
                "to_state": transition.to_state.value,
                "at": transition.at,
                "metadata": transition.metadata,
            },
        }
        
        # 清理死订阅者并推送
        dead = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # 推送失败，标记为死订阅者
                dead.append(queue)
        for q in dead:
            self._subscribers.remove(q)


# ============================================================
# 全局状态机注册表
# ============================================================


class LoopMachineRegistry:
    """全局状态机注册表（单例）"""
    
    def __init__(self):
        self._machines: Dict[str, LoopStateMachine] = {}
        self._lock = asyncio.Lock()
    
    async def get_or_create(self, session_id: Optional[str] = None) -> LoopStateMachine:
        """获取或创建状态机"""
        async with self._lock:
            if session_id and session_id in self._machines:
                return self._machines[session_id]
            
            machine = LoopStateMachine(session_id)
            self._machines[machine.session_id] = machine
            return machine
    
    def get(self, session_id: str) -> Optional[LoopStateMachine]:
        """获取状态机（不创建）"""
        return self._machines.get(session_id)
    
    async def remove(self, session_id: str) -> None:
        """移除状态机"""
        async with self._lock:
            self._machines.pop(session_id, None)
    
    def list_sessions(self) -> List[str]:
        """列出所有 session_id"""
        return list(self._machines.keys())


# 单例
_registry: Optional[LoopMachineRegistry] = None


def get_registry() -> LoopMachineRegistry:
    """获取全局注册表"""
    global _registry
    if _registry is None:
        _registry = LoopMachineRegistry()
    return _registry


# ============================================================
# SSE 流生成
# ============================================================


async def stream_machine_events(
    session_id: Optional[str] = None,
    heartbeat_interval: float = 15.0,
) -> AsyncIterator[Dict]:
    """
    生成 SSE 事件流
    
    输入参数：session_id, heartbeat_interval
    输出结果：AsyncIterator[Dict]
    """
    machine = await get_registry().get_or_create(session_id)
    queue = await machine.subscribe()
    
    try:
        # 1. 立即发送当前快照
        snapshot = machine.snapshot()
        yield {
            "type": "loop_state_changed",
            "session_id": machine.session_id,
            "stage": snapshot.stage.value,
            "progress": snapshot.progress,
            "eta_seconds": snapshot.eta_seconds,
            "sub_state": snapshot.sub_state,
        }
        
        # 2. 持续监听变化
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat_interval)
                yield event
            except asyncio.TimeoutError:
                # 发送心跳
                yield {
                    "type": "heartbeat",
                    "session_id": machine.session_id,
                    "timestamp": time.time(),
                }
    except asyncio.CancelledError:
        pass
    finally:
        await machine.unsubscribe(queue)
