"""
# ============================================================
# AutoFollow 服务 - Loop 阶段到前端面板的智能映射 (v1.0.0)
# Cycle 58 G58-04
# ============================================================
# 核心作用：定义 Loop Engineering 状态阶段到前端面板的自动映射关系
#           支持每 session 的 Auto-Follow 开关、配置和事件分发
# 运行流程：
#   1. STAGE_TO_PANEL 默认映射表
#   2. AutoFollowConfig 每 session 的可配置项
#   3. AutoFollowService 接收 stage 变化，生成 panel 切换事件
#   4. SSE 推送 auto_follow_suggested 事件给前端
#   5. 前端 useAutoFollow 监听后自动打开目标面板
# 设计要点：
#   - 默认 Auto-Follow 开启（用户可在前端设置关闭）
#   - 阶段→面板映射可被用户/配置覆盖
#   - 防抖 500ms 由前端 useAutoFollow 处理
#   - 服务端不强制，只做"建议"
# 输入参数：session_id, LoopStage
# 输出结果：AutoFollowEvent 列表 + SSE 流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
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

from .loop_state_machine import LoopStage

logger = logging.getLogger(__name__)


# ============================================================
# 类型与常量
# ============================================================


class PanelKey(str, Enum):
    """前端面板键（与前端 PanelKey 对齐）"""
    PLAN_EXECUTOR = "planExecutor"
    VIBE_CODING = "vibeCoding"
    LOOP_STATE = "loopState"
    CLAUDE_SHELL = "claudeShell"
    AGENT_CHAT = "agentChat"
    DIFF_VIEW = "diffView"
    COMMIT_HISTORY = "commitHistory"
    TEST_RUNNER = "testRunner"
    ARCHITECTURE = "architecture"
    PROGRESS_OVERVIEW = "progressOverview"


class AutoFollowMode(str, Enum):
    """Auto-Follow 工作模式"""
    OFF = "off"                     # 关闭：不产生事件
    SUGGEST = "suggest"             # 建议：产生建议事件，前端可选择是否跟随
    FORCE = "force"                 # 强制：直接广播需跟随（前端应跟随）


@dataclass
class AutoFollowEvent:
    """Auto-Follow 事件（推送给前端）"""
    session_id: str
    target_panel: PanelKey
    reason: str
    source_stage: str
    mode: str
    at: float
    metadata: Dict = field(default_factory=dict)


@dataclass
class AutoFollowConfig:
    """每 session 的 Auto-Follow 配置"""
    enabled: bool = True
    mode: AutoFollowMode = AutoFollowMode.SUGGEST
    # 自定义 stage→panel 映射（覆盖默认）
    custom_mapping: Dict[str, str] = field(default_factory=dict)
    # 黑名单 panel：即使映射命中也不打开
    blocked_panels: List[str] = field(default_factory=list)
    # 白名单 panel：只允许这些被打开
    allowed_panels: Optional[List[str]] = None

    def to_dict(self) -> Dict:
        return {
            "enabled": self.enabled,
            "mode": self.mode.value,
            "custom_mapping": dict(self.custom_mapping),
            "blocked_panels": list(self.blocked_panels),
            "allowed_panels": list(self.allowed_panels) if self.allowed_panels is not None else None,
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "AutoFollowConfig":
        if not d:
            return cls()
        return cls(
            enabled=bool(d.get("enabled", True)),
            mode=AutoFollowMode(d.get("mode", "suggest")),
            custom_mapping=dict(d.get("custom_mapping") or {}),
            blocked_panels=list(d.get("blocked_panels") or []),
            allowed_panels=list(d.get("allowed_panels")) if d.get("allowed_panels") is not None else None,
        )


# ============================================================
# 默认映射表
# ============================================================

# Loop Stage -> 默认 Panel
DEFAULT_STAGE_TO_PANEL: Dict[LoopStage, PanelKey] = {
    LoopStage.IDLE: PanelKey.PROGRESS_OVERVIEW,
    LoopStage.CLARIFYING: PanelKey.AGENT_CHAT,
    LoopStage.DESIGNING: PanelKey.ARCHITECTURE,
    LoopStage.PROMPTING: PanelKey.PLAN_EXECUTOR,
    LoopStage.EXECUTING: PanelKey.VIBE_CODING,
    LoopStage.REVIEWING: PanelKey.DIFF_VIEW,
    LoopStage.DONE: PanelKey.PROGRESS_OVERVIEW,
    LoopStage.PAUSED: PanelKey.PROGRESS_OVERVIEW,
    LoopStage.ERROR: PanelKey.LOOP_STATE,
    LoopStage.CANCELLED: PanelKey.LOOP_STATE,
}

# 阶段到 reason 文案
STAGE_TO_REASON: Dict[LoopStage, str] = {
    LoopStage.IDLE: "Loop 已重置",
    LoopStage.CLARIFYING: "需求澄清中",
    LoopStage.DESIGNING: "架构设计中",
    LoopStage.PROMPTING: "提示词优化中",
    LoopStage.EXECUTING: "任务执行中",
    LoopStage.REVIEWING: "质量评审中",
    LoopStage.DONE: "Loop 已完成",
    LoopStage.PAUSED: "Loop 已暂停",
    LoopStage.ERROR: "Loop 异常",
    LoopStage.CANCELLED: "Loop 已取消",
}


def resolve_panel(
    stage: LoopStage,
    config: AutoFollowConfig,
) -> Optional[PanelKey]:
    """
    根据 stage 和 config 解析目标 panel

    输入参数：stage, config
    输出结果：目标 PanelKey 或 None（无匹配）
    """
    # 1. 自定义映射优先
    custom = config.custom_mapping.get(stage.value)
    if custom:
        try:
            target = PanelKey(custom)
        except ValueError:
            logger.warning(f"resolve_panel: 未知 panel {custom} 在 custom_mapping")
        else:
            if _is_panel_allowed(target, config):
                return target

    # 2. 默认映射
    target = DEFAULT_STAGE_TO_PANEL.get(stage)
    if target is None:
        return None
    if not _is_panel_allowed(target, config):
        return None
    return target


def _is_panel_allowed(panel: PanelKey, config: AutoFollowConfig) -> bool:
    """检查 panel 是否被 config 允许"""
    if panel.value in config.blocked_panels:
        return False
    if config.allowed_panels is not None and panel.value not in config.allowed_panels:
        return False
    return True


# ============================================================
# Auto-Follow 服务
# ============================================================


class AutoFollowService:
    """
    Auto-Follow 服务（单例）

    维护每 session 的配置和订阅者，并对外暴露：
      - handle_stage_change()  当 stage 变化时调用，生成事件
      - subscribe()            订阅事件
      - get_config() / set_config()  读写配置
    """

    def __init__(self):
        self._configs: Dict[str, AutoFollowConfig] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._history: Dict[str, Deque[AutoFollowEvent]] = {}
        self._lock = asyncio.Lock()
        self._last_event_at: Dict[str, float] = {}
        # 最小事件间隔（防服务端刷屏），由客户端防抖兜底
        self.min_interval_s: float = 0.1

    async def get_config(self, session_id: str) -> AutoFollowConfig:
        """获取 session 配置（不存在则返回默认）"""
        async with self._lock:
            return self._configs.get(session_id, AutoFollowConfig())

    async def set_config(self, session_id: str, config: AutoFollowConfig) -> AutoFollowConfig:
        """设置 session 配置"""
        async with self._lock:
            self._configs[session_id] = config
            logger.info(
                f"set_config: session={session_id} enabled={config.enabled} mode={config.mode.value}"
            )
            return config

    async def update_config(
        self,
        session_id: str,
        enabled: Optional[bool] = None,
        mode: Optional[str] = None,
        custom_mapping: Optional[Dict[str, str]] = None,
        blocked_panels: Optional[List[str]] = None,
        allowed_panels: Optional[List[str]] = None,
    ) -> AutoFollowConfig:
        """部分更新 session 配置"""
        config = await self.get_config(session_id)
        if enabled is not None:
            config.enabled = bool(enabled)
        if mode is not None:
            try:
                config.mode = AutoFollowMode(mode)
            except ValueError:
                raise ValueError(f"未知 mode: {mode}（允许: {[m.value for m in AutoFollowMode]}）")
        if custom_mapping is not None:
            config.custom_mapping = dict(custom_mapping)
        if blocked_panels is not None:
            config.blocked_panels = list(blocked_panels)
        # 允许将 allowed_panels 设为 None 表示解除限制
        if allowed_panels is not None:
            config.allowed_panels = list(allowed_panels)
        return await self.set_config(session_id, config)

    async def handle_stage_change(
        self,
        session_id: str,
        from_stage: LoopStage,
        to_stage: LoopStage,
        metadata: Optional[Dict] = None,
    ) -> Optional[AutoFollowEvent]:
        """
        处理 stage 变化，生成 Auto-Follow 事件

        输入参数：session_id, from_stage, to_stage, metadata
        输出结果：AutoFollowEvent 或 None（关闭/无匹配时）
        """
        config = await self.get_config(session_id)
        if not config.enabled or config.mode == AutoFollowMode.OFF:
            return None

        # 服务端防刷屏
        now = time.time()
        last_at = self._last_event_at.get(session_id, 0.0)
        if now - last_at < self.min_interval_s:
            return None
        self._last_event_at[session_id] = now

        target = resolve_panel(to_stage, config)
        if target is None:
            return None

        event = AutoFollowEvent(
            session_id=session_id,
            target_panel=target,
            reason=STAGE_TO_REASON.get(to_stage, to_stage.value),
            source_stage=to_stage.value,
            mode=config.mode.value,
            at=now,
            metadata=dict(metadata or {}),
        )
        # 写入历史
        await self._append_history(session_id, event)
        # 广播
        await self._broadcast(session_id, event)
        logger.info(
            f"handle_stage_change: session={session_id} {from_stage.value}->{to_stage.value} "
            f"-> {target.value} mode={config.mode.value}"
        )
        return event

    async def _append_history(self, session_id: str, event: AutoFollowEvent) -> None:
        """追加事件到历史（最多 50 条）"""
        if session_id not in self._history:
            self._history[session_id] = deque(maxlen=50)
        self._history[session_id].append(event)

    def get_history(self, session_id: str) -> List[AutoFollowEvent]:
        """获取历史事件"""
        return list(self._history.get(session_id, []))

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        """订阅事件"""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        if session_id not in self._subscribers:
            self._subscribers[session_id] = []
        self._subscribers[session_id].append(queue)
        return queue

    async def unsubscribe(self, session_id: str, queue: asyncio.Queue) -> None:
        """取消订阅"""
        subs = self._subscribers.get(session_id, [])
        if queue in subs:
            subs.remove(queue)

    async def _broadcast(self, session_id: str, event: AutoFollowEvent) -> None:
        """广播到所有订阅者"""
        subs = list(self._subscribers.get(session_id, []))
        if not subs:
            return
        payload = {
            "type": "auto_follow_suggested",
            "session_id": event.session_id,
            "target_panel": event.target_panel.value,
            "reason": event.reason,
            "source_stage": event.source_stage,
            "mode": event.mode,
            "timestamp": event.at,
            "metadata": event.metadata,
        }
        dead = []
        for q in subs:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            await self.unsubscribe(session_id, q)


# ============================================================
# 全局单例
# ============================================================

_service: Optional[AutoFollowService] = None


def get_service() -> AutoFollowService:
    """获取全局服务实例"""
    global _service
    if _service is None:
        _service = AutoFollowService()
    return _service


# ============================================================
# SSE 事件流
# ============================================================


async def stream_auto_follow_events(
    session_id: str,
    heartbeat_interval: float = 15.0,
) -> AsyncIterator[Dict]:
    """
    生成 Auto-Follow SSE 事件流

    输入参数：session_id, heartbeat_interval
    输出结果：AsyncIterator[Dict]
    """
    service = get_service()
    queue = await service.subscribe(session_id)

    try:
        # 1. 立即发送一次初始状态（包含配置 + 最近历史）
        config = await service.get_config(session_id)
        history = service.get_history(session_id)
        yield {
            "type": "auto_follow_init",
            "session_id": session_id,
            "config": config.to_dict(),
            "recent_events": [
                {
                    "target_panel": e.target_panel.value,
                    "reason": e.reason,
                    "source_stage": e.source_stage,
                    "at": e.at,
                }
                for e in history[-5:]
            ],
        }
        # 2. 持续监听
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat_interval)
                yield event
            except asyncio.TimeoutError:
                yield {
                    "type": "heartbeat",
                    "session_id": session_id,
                    "timestamp": time.time(),
                }
    except asyncio.CancelledError:
        pass
    finally:
        await service.unsubscribe(session_id, queue)
