"""
# ============================================================
# Agent Runner (v1.0.0)
# Cycle 64 G64-01
# ============================================================
# 核心作用：异步执行 Agent 任务，发出 Hook 事件
# 运行流程：
#   1. spawn_instance() 创建 AgentInstance 并启动 asyncio.Task
#   2. 任务在后台执行，模拟真实 Agent 行为
#   3. 执行中发出 PreToolUse / PostToolUse / Progress / Output 事件
#   4. 完成发出 SubagentStop 事件
#   5. 支持 cancel/pause/resume
# 设计要点：
#   - 默认 mock 模式（无需真实 LLM 即可运行）
#   - 可选真实模式（接入 CLI）
#   - 工具调用模拟（read/write/bash）
#   - 进度报告
# 输入参数：AgentRole, AgentInstance, HookEventBus
# 输出结果：异步任务 + 事件流
# 对标：Codex v0.133 SubagentStart Hook 机制
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 64 G64-01 初次创建
# ====================================
"""

import asyncio
import logging
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .agent_role_models import (
    AgentInstance,
    AgentRole,
    HookEventType,
    ToolCallRecord,
)
from .hook_event_bus import HookEventBus, get_hook_bus

logger = logging.getLogger(__name__)


# ============================================================
# 任务进度配置
# ============================================================


# Mock 模式：每个 role 的模拟工具调用序列
MOCK_TOOL_SEQUENCES: Dict[str, List[Dict[str, Any]]] = {
    "default": [
        {"tool": "read", "args": {"path": "/workspace/main.py"}},
        {"tool": "analyze", "args": {"scope": "file"}},
        {"tool": "output", "args": {"chunk": "Based on analysis, here is the plan..."}},
    ],
    "worker": [
        {"tool": "bash", "args": {"cmd": "ls -la"}},
        {"tool": "read", "args": {"path": "/workspace/src/app.ts"}},
        {"tool": "write", "args": {"path": "/workspace/src/app.ts", "content": "// updated"}},
        {"tool": "bash", "args": {"cmd": "npm test"}},
        {"tool": "output", "args": {"chunk": "All tests passed."}},
    ],
    "explorer": [
        {"tool": "glob", "args": {"pattern": "**/*.py"}},
        {"tool": "read", "args": {"path": "/workspace/README.md"}},
        {"tool": "grep", "args": {"pattern": "TODO"}},
        {"tool": "output", "args": {"chunk": "Found 3 TODOs in the codebase."}},
    ],
    "monitor": [
        {"tool": "bash", "args": {"cmd": "ps aux"}},
        {"tool": "output", "args": {"chunk": "Process list captured."}},
    ],
}


class AgentRunner:
    """
    Agent 异步任务执行器
    - 管理 agent_id -> asyncio.Task 映射
    - 在任务执行中发出 Hook 事件
    - 支持取消/暂停/恢复
    - 默认 MOCK 模式（无需真实 LLM 即可运行）
    """

    # 接口契约：与 RealAgentRunner 共享 RunnerMode 标识
    mode = "mock"

    def __init__(self, hook_bus: Optional[HookEventBus] = None):
        self._hook_bus = hook_bus or get_hook_bus()
        # agent_id -> asyncio.Task
        self._tasks: Dict[str, asyncio.Task] = {}
        # agent_id -> cancel_event
        self._cancel_events: Dict[str, asyncio.Event] = {}
        # agent_id -> pause_event
        self._pause_events: Dict[str, asyncio.Event] = {}

    async def start(
        self,
        instance: AgentInstance,
        role: AgentRole,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> None:
        """
        启动 agent 任务
        - 创建 asyncio.Task
        - 立即返回，任务在后台执行
        """
        cancel_event = asyncio.Event()
        pause_event = asyncio.Event()
        pause_event.set()  # 默认未暂停
        self._cancel_events[instance.agent_id] = cancel_event
        self._pause_events[instance.agent_id] = pause_event

        # 创建任务
        task = asyncio.create_task(
            self._run(instance, role, cancel_event, pause_event, progress_callback)
        )
        self._tasks[instance.agent_id] = task

        # 立即发出 SubagentStart 事件
        await self._hook_bus.publish(
            instance.agent_id,
            HookEventType.SUBAGENT_START,
            {
                "role_name": role.name,
                "task": instance.task,
                "nickname": instance.nickname,
                "started_at": instance.started_at,
            },
        )

    async def _run(
        self,
        instance: AgentInstance,
        role: AgentRole,
        cancel_event: asyncio.Event,
        pause_event: asyncio.Event,
        progress_callback: Optional[Callable[[float], None]],
    ) -> None:
        """执行 agent 任务（在 asyncio.Task 中运行）"""
        try:
            instance.status = "running"
            # 模拟工具调用序列
            sequence = MOCK_TOOL_SEQUENCES.get(
                role.name,
                MOCK_TOOL_SEQUENCES["default"],
            )
            total_steps = len(sequence) + 2  # +2 for start + end overhead
            for i, step in enumerate(sequence):
                # 检查取消
                if cancel_event.is_set():
                    instance.status = "cancelled"
                    instance.error = "cancelled by user"
                    instance.finished_at = time.time()
                    await self._hook_bus.publish(
                        instance.agent_id,
                        HookEventType.CANCELLED,
                        {"reason": "user requested cancel"},
                    )
                    return
                # 检查暂停
                await pause_event.wait()
                # 更新进度
                instance.progress = (i + 1) / total_steps
                if progress_callback:
                    progress_callback(instance.progress)
                # 发出 PreToolUse
                tool = step.get("tool", "unknown")
                instance.current_tool = tool
                instance.status = "tool_calling"
                tc = ToolCallRecord(
                    tool_name=tool,
                    arguments=step.get("args", {}),
                    started_at=time.time(),
                )
                await self._hook_bus.publish(
                    instance.agent_id,
                    HookEventType.PRE_TOOL_USE,
                    {
                        "tool_name": tool,
                        "arguments": step.get("args", {}),
                        "tool_call_id": tc.tool_call_id,
                    },
                )
                # 模拟工具执行延迟
                await asyncio.sleep(0.1)
                # 发出 PostToolUse
                tc.finished_at = time.time()
                tc.duration_ms = int((tc.finished_at - tc.started_at) * 1000)
                # 模拟结果
                if tool == "output":
                    tc.result = step.get("args", {}).get("chunk", "")
                elif tool == "bash":
                    tc.result = {"stdout": "ok", "exit_code": 0}
                else:
                    tc.result = {"ok": True}
                instance.tool_calls_count += 1
                await self._hook_bus.publish(
                    instance.agent_id,
                    HookEventType.POST_TOOL_USE,
                    {
                        "tool_name": tool,
                        "result": tc.result,
                        "duration_ms": tc.duration_ms,
                        "tool_call_id": tc.tool_call_id,
                    },
                )
                # 如果是 output 事件，发出 Output 事件
                if tool == "output":
                    instance.status = "output_streaming"
                    await self._hook_bus.publish(
                        instance.agent_id,
                        HookEventType.OUTPUT,
                        {"content": tc.result if isinstance(tc.result, str) else str(tc.result)},
                    )
            # 完成
            instance.status = "idle"
            instance.progress = 1.0
            instance.finished_at = time.time()
            instance.result = (
                f"任务完成（{instance.tool_calls_count} 次工具调用，"
                f"{int(instance.finished_at - instance.started_at)}s）"
            )
            instance.current_tool = None
            await self._hook_bus.publish(
                instance.agent_id,
                HookEventType.SUBAGENT_STOP,
                {
                    "status": "idle",
                    "result": instance.result,
                    "duration_s": instance.finished_at - instance.started_at,
                    "tool_calls": instance.tool_calls_count,
                },
            )
        except asyncio.CancelledError:
            instance.status = "cancelled"
            instance.finished_at = time.time()
            instance.error = instance.error or "task cancelled"
            logger.info(f"Agent 任务被取消: {instance.agent_id}")
            await self._hook_bus.publish(
                instance.agent_id,
                HookEventType.CANCELLED,
                {"reason": "task cancelled"},
            )
        except Exception as e:  # noqa: BLE001
            instance.status = "failed"
            instance.finished_at = time.time()
            instance.error = str(e)
            logger.exception(f"Agent 任务失败: {instance.agent_id}: {e}")
            await self._hook_bus.publish(
                instance.agent_id,
                HookEventType.ERROR,
                {"error": str(e), "error_type": type(e).__name__},
            )
        finally:
            # 清理
            self._tasks.pop(instance.agent_id, None)
            self._cancel_events.pop(instance.agent_id, None)
            self._pause_events.pop(instance.agent_id, None)

    async def cancel(self, agent_id: str, reason: str = "user requested") -> bool:
        """
        取消 agent 任务
        返回 True 表示成功
        """
        if agent_id in self._cancel_events:
            self._cancel_events[agent_id].set()
            return True
        return False

    async def pause(self, agent_id: str) -> bool:
        """暂停 agent 任务"""
        if agent_id in self._pause_events:
            self._pause_events[agent_id].clear()
            return True
        return False

    async def resume(self, agent_id: str) -> bool:
        """恢复 agent 任务"""
        if agent_id in self._pause_events:
            self._pause_events[agent_id].set()
            return True
        return False

    def is_running(self, agent_id: str) -> bool:
        """检查 agent 是否正在运行"""
        return agent_id in self._tasks

    def get_stats(self) -> Dict[str, Any]:
        """统计"""
        return {
            "active_tasks": len(self._tasks),
            "hook_bus": self._hook_bus.get_stats(),
        }


# ============================================================
# 全局单例
# ============================================================


_runner: Optional[AgentRunner] = None


def get_agent_runner() -> AgentRunner:
    """获取全局 AgentRunner（单例）"""
    global _runner
    if _runner is None:
        _runner = AgentRunner()
    return _runner


def reset_agent_runner() -> None:
    """重置全局 AgentRunner（用于测试）"""
    global _runner
    _runner = None
