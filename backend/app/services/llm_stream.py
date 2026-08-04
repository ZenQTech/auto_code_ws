"""
# ============================================================
# LLM 流式输出服务 (v1.0.0)
# Cycle 62 G62-03
# ====================================
# 核心作用：将 LLM 的 token-by-token 输出通过 WebSocket 实时推送给前端
# 运行流程：
#   1. create_stream() 创建 LLMStreamSession
#   2. session.start() 启动后台任务，从 LLM 接收 token
#   3. 每个 token 通过 ws_manager.broadcast_to() 推送
#   4. 完成或错误时发送 done/error 事件
#   5. 客户端可通过 WebSocket 订阅 session_id
# 设计要点：
#   - 完全异步，非阻塞
#   - 支持取消（client disconnect 或 timeout）
#   - 支持背压（缓冲区满时丢弃中间 token，仅保留首尾）
#   - 完整事件类型：start/token/done/error/cancel
# 输入参数：session_id, llm_caller, prompt, model
# 输出结果：WebSocket 实时消息流
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-03 初次创建
# ====================================
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 数据类型
# ============================================================


class StreamEventType(str, Enum):
    """流式事件类型"""
    START = "start"           # 流开始
    TOKEN = "token"           # 单个 token
    DELTA = "delta"           # 增量内容（多个 token 聚合）
    REASONING = "reasoning"   # 思考阶段内容
    TOOL_CALL = "tool_call"   # 工具调用
    PROGRESS = "progress"     # 进度更新
    ERROR = "error"           # 错误
    CANCEL = "cancel"         # 取消
    DONE = "done"             # 完成


@dataclass
class StreamEvent:
    """流式事件"""
    type: StreamEventType
    session_id: str
    timestamp: float = field(default_factory=time.time)

    # 通用字段
    content: str = ""
    delta: str = ""
    accumulated: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    # 完成/错误
    error: Optional[str] = None
    usage: Optional[Dict[str, int]] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "type": self.type.value,
            "session_id": self.session_id,
            "timestamp": self.timestamp,
        }
        if self.content:
            result["content"] = self.content
        if self.delta:
            result["delta"] = self.delta
        if self.accumulated:
            result["accumulated"] = self.accumulated
        if self.metadata:
            result["metadata"] = self.metadata
        if self.error:
            result["error"] = self.error
        if self.usage:
            result["usage"] = self.usage
        return result


@dataclass
class LLMStreamSession:
    """LLM 流式会话"""
    session_id: str
    prompt: str
    model: str
    system_prompt: str = ""
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    accumulated: str = ""
    token_count: int = 0
    reasoning: str = ""
    is_cancelled: bool = False
    is_completed: bool = False
    error: Optional[str] = None
    usage: Optional[Dict[str, int]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "prompt": self.prompt[:200] + "..." if len(self.prompt) > 200 else self.prompt,
            "model": self.model,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "elapsed_s": (
                (self.completed_at or time.time()) - (self.started_at or self.created_at)
            ),
            "token_count": self.token_count,
            "accumulated_length": len(self.accumulated),
            "is_cancelled": self.is_cancelled,
            "is_completed": self.is_completed,
            "error": self.error,
            "usage": self.usage,
        }


# ============================================================
# LLM Caller 抽象
# ============================================================


LLMCaller = Callable[[str, str, str], AsyncIterator[str]]
"""
LLMCaller 协议：接收 (system_prompt, prompt, model) 返回 AsyncIterator[str]
"""


# ============================================================
# 流管理器
# ============================================================


class LLMStreamManager:
    """
    LLM 流管理器（全局单例）

    职责：
    1. 维护活跃流式会话
    2. 调度 LLM 调用并推送 token
    3. 提供流创建/取消/查询接口
    """

    MAX_BUFFER_TOKENS = 100  # 背压：缓冲区最多累积 token 数
    FLUSH_INTERVAL_S = 0.1  # 聚合推送间隔（秒）

    def __init__(self) -> None:
        # session_id -> LLMStreamSession
        self._sessions: Dict[str, LLMStreamSession] = {}
        # session_id -> asyncio.Task
        self._tasks: Dict[str, asyncio.Task] = {}
        # 锁
        self._lock = asyncio.Lock()

    async def create(
        self,
        prompt: str,
        model: str = "default",
        system_prompt: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> LLMStreamSession:
        """创建新流式会话（不启动）"""
        async with self._lock:
            session_id = f"stream-{uuid.uuid4().hex[:12]}"
            session = LLMStreamSession(
                session_id=session_id,
                prompt=prompt,
                model=model,
                system_prompt=system_prompt,
                metadata=metadata or {},
            )
            self._sessions[session_id] = session
            logger.info(
                f"流式会话已创建: {session_id} model={model} prompt_len={len(prompt)}"
            )
            return session

    async def start(
        self,
        session_id: str,
        llm_caller: LLMCaller,
    ) -> LLMStreamSession:
        """启动流式会话（后台任务）"""
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError(f"会话不存在: {session_id}")
        if session.is_completed or session.is_cancelled:
            raise ValueError(f"会话已结束: {session_id}")

        # 启动后台任务
        task = asyncio.create_task(
            self._run_stream(session, llm_caller),
            name=f"stream-{session_id}",
        )
        self._tasks[session_id] = task
        return session

    async def cancel(self, session_id: str) -> bool:
        """取消流式会话"""
        session = self._sessions.get(session_id)
        if session is None:
            return False
        session.is_cancelled = True
        task = self._tasks.get(session_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        logger.info(f"流式会话已取消: {session_id}")
        return True

    async def _run_stream(
        self,
        session: LLMStreamSession,
        llm_caller: LLMCaller,
    ) -> None:
        """运行流式会话（内部）"""
        # 延迟导入避免循环依赖（ws.py 在 app 包下而非 services 子包）
        from app.ws import manager as ws_manager  # noqa: E402

        session.started_at = time.time()

        # 发送 start 事件
        await ws_manager.broadcast_to(
            session.session_id,
            StreamEvent(
                type=StreamEventType.START,
                session_id=session.session_id,
                metadata={"model": session.model, "prompt_length": len(session.prompt)},
            ).to_dict(),
        )

        # 缓冲聚合
        buffer: List[str] = []
        last_flush = time.time()

        try:
            async for token in llm_caller(
                session.system_prompt, session.prompt, session.model,
            ):
                if session.is_cancelled:
                    break

                session.token_count += 1
                session.accumulated += token
                buffer.append(token)

                # 背压：缓冲满或时间到则推送
                now = time.time()
                if (
                    len(buffer) >= self.MAX_BUFFER_TOKENS
                    or now - last_flush >= self.FLUSH_INTERVAL_S
                ):
                    delta = "".join(buffer)
                    buffer.clear()
                    last_flush = now
                    await ws_manager.broadcast_to(
                        session.session_id,
                        StreamEvent(
                            type=StreamEventType.DELTA,
                            session_id=session.session_id,
                            delta=delta,
                            accumulated=session.accumulated,
                        ).to_dict(),
                    )

            # 推送剩余 buffer
            if buffer:
                await ws_manager.broadcast_to(
                    session.session_id,
                    StreamEvent(
                        type=StreamEventType.DELTA,
                        session_id=session.session_id,
                        delta="".join(buffer),
                        accumulated=session.accumulated,
                    ).to_dict(),
                )
                buffer.clear()

            # 完成
            session.is_completed = True
            session.completed_at = time.time()
            session.usage = {
                "prompt_tokens": len(session.prompt) // 4,
                "completion_tokens": session.token_count,
                "total_tokens": (len(session.prompt) // 4) + session.token_count,
            }
            await ws_manager.broadcast_to(
                session.session_id,
                StreamEvent(
                    type=StreamEventType.DONE,
                    session_id=session.session_id,
                    accumulated=session.accumulated,
                    usage=session.usage,
                ).to_dict(),
            )
            logger.info(
                f"流式会话完成: {session.session_id} "
                f"tokens={session.token_count} elapsed={session.completed_at - session.started_at:.2f}s"
            )
        except asyncio.CancelledError:
            session.is_cancelled = True
            session.completed_at = time.time()
            await ws_manager.broadcast_to(
                session.session_id,
                StreamEvent(
                    type=StreamEventType.CANCEL,
                    session_id=session.session_id,
                    accumulated=session.accumulated,
                ).to_dict(),
            )
            raise
        except Exception as e:  # noqa: BLE001
            session.error = str(e)
            session.completed_at = time.time()
            logger.exception(f"流式会话失败: {session.session_id} err={e}")
            await ws_manager.broadcast_to(
                session.session_id,
                StreamEvent(
                    type=StreamEventType.ERROR,
                    session_id=session.session_id,
                    error=str(e),
                ).to_dict(),
            )

    def get(self, session_id: str) -> Optional[LLMStreamSession]:
        """获取会话"""
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[Dict[str, Any]]:
        """列出所有会话"""
        return [s.to_dict() for s in self._sessions.values()]

    def get_stats(self) -> Dict[str, Any]:
        """获取管理器统计"""
        active = sum(
            1 for s in self._sessions.values()
            if not s.is_completed and not s.is_cancelled
        )
        completed = sum(1 for s in self._sessions.values() if s.is_completed)
        cancelled = sum(1 for s in self._sessions.values() if s.is_cancelled)
        return {
            "total": len(self._sessions),
            "active": active,
            "completed": completed,
            "cancelled": cancelled,
        }

    async def cleanup_old_sessions(self, max_age_s: float = 3600) -> int:
        """清理过期会话（默认 1 小时）"""
        now = time.time()
        to_delete = [
            sid for sid, s in self._sessions.items()
            if s.completed_at and (now - s.completed_at) > max_age_s
        ]
        for sid in to_delete:
            del self._sessions[sid]
            if sid in self._tasks:
                del self._tasks[sid]
        if to_delete:
            logger.info(f"清理过期流式会话: {len(to_delete)} 个")
        return len(to_delete)


# ============================================================
# Mock LLM Caller（用于测试和演示）
# ============================================================


async def mock_llm_caller(
    system_prompt: str,
    prompt: str,
    model: str,
) -> AsyncIterator[str]:
    """
    Mock LLM 调用器（按字符分割模拟 token 流式输出）

    用于：
    - 单元测试
    - 前端无 LLM 时的演示
    - CI 环境
    """
    response = f"这是一个针对 '{prompt[:30]}...' 的模拟回复。"
    for char in response:
        await asyncio.sleep(0.02)  # 模拟 LLM 延迟
        yield char


# ============================================================
# 全局单例
# ============================================================

_manager: Optional[LLMStreamManager] = None


def get_stream_manager() -> LLMStreamManager:
    """获取全局流管理器"""
    global _manager
    if _manager is None:
        _manager = LLMStreamManager()
    return _manager


def reset_stream_manager() -> None:
    """重置（用于测试）"""
    global _manager
    _manager = None
