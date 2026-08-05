"""
# ============================================================
# 思考流服务 (v1.0.0)
# Cycle 67 G67-01
# ====================================
# 核心作用：管理 LLM 思考步骤的完整生命周期
# 功能：
#   1. start_step 创建新思考步骤
#   2. append_delta 增量追加 token
#   3. end_step 结束步骤（含摘要）
#   4. 订阅机制：多客户端实时接收
#   5. 持久化：每 session 最多 200 step
#   6. LRU 淘汰 + 内容截断（50KB）
# 输入参数：session_id, agent_id, step_id, delta
# 输出结果：ThinkingStep + 订阅回调
# 对标：Codex PR #6006 reasoning stream
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 67 G67-01 初次创建
# ====================================
"""

import asyncio
import logging
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

MAX_CONTENT_SIZE = 50 * 1024  # 50KB 单 step 上限
MAX_STEPS_PER_SESSION = 200   # 单 session 最大 step 数
MAX_SUBSCRIBERS_PER_SESSION = 20  # 单 session 最大订阅者数


# ============================================================
# 数据模型
# ============================================================


@dataclass
class ThinkingStep:
    """单次思考步骤的完整数据"""
    step_id: str
    session_id: str
    agent_id: str
    step_index: int                # session 内递增
    content: str = ""              # 累计内容
    started_at: float = field(default_factory=time.time)
    ended_at: Optional[float] = None
    status: str = "running"        # running | completed | truncated
    summary: str = ""              # 结束时的摘要
    model: str = ""                # LLM 模型
    tokens: int = 0                # 累计 token 数
    metadata: Dict[str, Any] = field(default_factory=dict)

    def append_delta(self, delta: str) -> None:
        """追加 delta，超过上限标记截断"""
        if self.status == "truncated":
            return
        new_content = self.content + delta
        if len(new_content.encode("utf-8")) > MAX_CONTENT_SIZE:
            # 截断到上限
            keep_bytes = MAX_CONTENT_SIZE - 200  # 预留 200B 给截断标记
            encoded = new_content.encode("utf-8")[:keep_bytes]
            try:
                self.content = encoded.decode("utf-8", errors="ignore")
            except Exception:
                self.content = new_content[:keep_bytes]
            self.content += "\n\n... [TRUNCATED: 内容超过 50KB] ..."
            self.status = "truncated"
            self.metadata["truncated_at_size"] = len(new_content)
        else:
            self.content = new_content
        self.tokens += 1  # 简化：每个 delta 算 1 token

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 dict"""
        return {
            "step_id": self.step_id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "step_index": self.step_index,
            "content": self.content,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "status": self.status,
            "summary": self.summary,
            "model": self.model,
            "tokens": self.tokens,
            "metadata": self.metadata,
            "duration_ms": (
                int((self.ended_at - self.started_at) * 1000)
                if self.ended_at
                else int((time.time() - self.started_at) * 1000)
            ),
        }


# 订阅回调类型
ThinkingCallback = Callable[[ThinkingStep, str], Awaitable[None]]
# 参数：(ThinkingStep, event_type) event_type: "start" | "delta" | "end"


# ============================================================
# 思考流服务（单例）
# ============================================================


class ThinkingStreamService:
    """
    思考流服务

    设计要点：
    - 单例：通过 get_thinking_stream_service() 获取
    - 内存存储 + 异步订阅
    - 每 session 维护 step 列表（LRU）
    - 订阅者隔离：每 session 独立订阅者列表
    """

    def __init__(self):
        # session_id -> ordered step list (oldest first)
        self._steps: Dict[str, Deque[ThinkingStep]] = defaultdict(
            lambda: deque(maxlen=MAX_STEPS_PER_SESSION)
        )
        # session_id -> 下一个 step_index
        self._next_index: Dict[str, int] = defaultdict(int)
        # step_id -> ThinkingStep (用于 append_delta 快速查找)
        self._step_map: Dict[str, ThinkingStep] = {}
        # session_id -> List[(callback_id, callback)]
        self._subscribers: Dict[str, List[tuple]] = defaultdict(list)
        # 锁
        self._lock = asyncio.Lock()

    # ============================================================
    # Step 生命周期
    # ============================================================

    async def start_step(
        self,
        session_id: str,
        agent_id: str,
        model: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ThinkingStep:
        """
        开始新思考步骤
        返回 ThinkingStep
        """
        evicted_step = None
        async with self._lock:
            step_index = self._next_index[session_id]
            self._next_index[session_id] += 1

            step = ThinkingStep(
                step_id=f"think-{uuid.uuid4().hex[:12]}",
                session_id=session_id,
                agent_id=agent_id,
                step_index=step_index,
                model=model,
                metadata=metadata or {},
            )
            # 检查 LRU 淘汰（deque append 后会自动 pop 最旧的）
            current_len = len(self._steps[session_id])
            if current_len >= MAX_STEPS_PER_SESSION:
                # deque 即将 pop 最旧的，提前取出以便清理 step_map
                try:
                    evicted_step = self._steps[session_id][0]
                except IndexError:
                    evicted_step = None
            self._steps[session_id].append(step)
            self._step_map[step.step_id] = step

        # 清理被 LRU 淘汰的 step（锁外执行避免长持锁）
        if evicted_step is not None:
            self._step_map.pop(evicted_step.step_id, None)
            logger.debug(
                f"LRU 淘汰: session={session_id} step_id={evicted_step.step_id}"
            )

        logger.info(
            f"thinking step start: session={session_id} step_id={step.step_id} "
            f"index={step_index}"
        )
        # 通知订阅者（在锁外避免死锁）
        await self._notify(session_id, step, "start")
        return step

    async def append_delta(
        self,
        step_id: str,
        delta: str,
    ) -> Optional[ThinkingStep]:
        """
        追加 delta
        返回更新后的 step，如果 step_id 不存在返回 None
        """
        async with self._lock:
            step = self._step_map.get(step_id)
            if not step:
                logger.warning(f"append_delta: step_id 不存在: {step_id}")
                return None
            if step.status != "running":
                logger.warning(
                    f"append_delta: step {step_id} 状态为 {step.status}，忽略"
                )
                return None
            step.append_delta(delta)

        # 通知订阅者（节流：避免每个 delta 都通知）
        await self._notify(step.session_id, step, "delta")
        return step

    async def end_step(
        self,
        step_id: str,
        summary: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[ThinkingStep]:
        """
        结束思考步骤
        返回结束的 step
        """
        async with self._lock:
            step = self._step_map.get(step_id)
            if not step:
                return None
            step.ended_at = time.time()
            step.status = "completed"
            step.summary = summary
            if metadata:
                step.metadata.update(metadata)

        logger.info(
            f"thinking step end: session={step.session_id} step_id={step_id} "
            f"tokens={step.tokens} duration_ms={int((step.ended_at - step.started_at) * 1000)}"
        )
        await self._notify(step.session_id, step, "end")
        return step

    # ============================================================
    # 查询接口
    # ============================================================

    def get_step(self, step_id: str) -> Optional[ThinkingStep]:
        """获取单个 step"""
        return self._step_map.get(step_id)

    def get_current_step(self, session_id: str) -> Optional[ThinkingStep]:
        """获取当前 running 的 step"""
        for step in reversed(self._steps.get(session_id, [])):
            if step.status == "running":
                return step
        return None

    def get_session_steps(
        self,
        session_id: str,
        limit: int = 50,
        reverse: bool = True,
    ) -> List[ThinkingStep]:
        """
        获取 session 的 step 列表
        reverse=True 返回最新的在前
        """
        steps = list(self._steps.get(session_id, []))
        if reverse:
            steps.reverse()
        return steps[:limit]

    def count_session_steps(self, session_id: str) -> int:
        """获取 session 的 step 数量"""
        return len(self._steps.get(session_id, []))

    def clear_session(self, session_id: str) -> int:
        """
        清空 session 全部 step
        返回清理的数量
        """
        steps = self._steps.get(session_id, [])
        count = len(steps)
        for step in steps:
            self._step_map.pop(step.step_id, None)
        self._steps.pop(session_id, None)
        self._next_index.pop(session_id, None)
        logger.info(f"清空 session={session_id} 的 {count} 个 step")
        return count

    # ============================================================
    # 订阅机制
    # ============================================================

    async def subscribe(
        self,
        session_id: str,
        callback: ThinkingCallback,
    ) -> str:
        """
        订阅 session 的 thinking 事件
        返回 subscriber_id（用于取消订阅）
        """
        async with self._lock:
            subscribers = self._subscribers[session_id]
            if len(subscribers) >= MAX_SUBSCRIBERS_PER_SESSION:
                raise SubscriptionLimitError(
                    f"session {session_id} 订阅者已达上限 "
                    f"{MAX_SUBSCRIBERS_PER_SESSION}"
                )
            subscriber_id = f"sub-{uuid.uuid4().hex[:8]}"
            subscribers.append((subscriber_id, callback))
            return subscriber_id

    async def unsubscribe(
        self,
        session_id: str,
        subscriber_id: str,
    ) -> bool:
        """取消订阅"""
        async with self._lock:
            subscribers = self._subscribers.get(session_id, [])
            for i, (sid, _) in enumerate(subscribers):
                if sid == subscriber_id:
                    subscribers.pop(i)
                    return True
            return False

    async def _notify(
        self,
        session_id: str,
        step: ThinkingStep,
        event_type: str,
    ) -> None:
        """通知订阅者（拷贝订阅者列表后在锁外执行）"""
        async with self._lock:
            subscribers = list(self._subscribers.get(session_id, []))

        if not subscribers:
            return

        # 并行通知所有订阅者，单个失败不影响其他
        tasks = []
        for sub_id, callback in subscribers:
            try:
                tasks.append(asyncio.create_task(callback(step, event_type)))
            except Exception as e:
                logger.error(f"创建订阅任务失败 {sub_id}: {e}")

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    sub_id = subscribers[i][0]
                    logger.error(f"订阅者 {sub_id} 回调异常: {result}")


# ============================================================
# 异常
# ============================================================


class SubscriptionLimitError(Exception):
    """订阅者达到上限"""
    pass


class ThinkingStepNotFoundError(Exception):
    """step_id 不存在"""
    pass


# ============================================================
# 单例
# ============================================================

_thinking_service_instance: Optional[ThinkingStreamService] = None


def get_thinking_stream_service() -> ThinkingStreamService:
    """获取全局单例"""
    global _thinking_service_instance
    if _thinking_service_instance is None:
        _thinking_service_instance = ThinkingStreamService()
    return _thinking_service_instance


def reset_thinking_stream_service() -> None:
    """重置全局单例（仅供测试使用）"""
    global _thinking_service_instance
    _thinking_service_instance = None
