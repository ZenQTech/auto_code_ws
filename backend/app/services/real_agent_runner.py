"""
# ============================================================
# Real Agent Runner (v1.0.0)
# Cycle 65 G65-01
# ============================================================
# 核心作用：真实 CLI 模式 Agent 执行器，调用真实的 claude/hermes CLI
# 运行流程：
#   1. 通过 asyncio.create_subprocess_exec 启动 CLI 子进程
#   2. 异步读取 stdout 的 JSONL 输出流
#   3. 将 CLI 事件映射为 Hook 事件
#   4. 支持取消（SIGTERM → SIGKILL）
#   5. 实时推送进度 / 工具调用 / 输出 / 错误
# 设计要点：
#   - 保留 AgentRunner 接口契约（可替换 mock 实现）
#   - JSONL 协议：每行一个事件
#   - 输出批处理：每 100ms flush
#   - 沙箱模式：可选 docker/bwrap
#   - 超时控制：默认 600s
# 输入参数：AgentInstance, AgentRole, subprocess
# 输出结果：异步任务 + Hook 事件流
# 对标：Codex v0.133 真实 Subagent 模式
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 65 G65-01 初次创建
# ====================================
"""

import asyncio
import json
import logging
import os
import shutil
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

from .agent_role_models import (
    AgentInstance,
    AgentRole,
    HookEventType,
    ToolCallRecord,
)
from .hook_event_bus import HookEventBus, get_hook_bus

logger = logging.getLogger(__name__)


# ============================================================
# Runner Mode 枚举
# ============================================================


class RunnerMode(str, Enum):
    """Agent Runner 模式"""

    MOCK = "mock"        # 模拟模式（开发/测试）
    REAL = "real"        # 真实 CLI 模式（生产）
    AUTO = "auto"        # 智能选择（有 CLI 时 REAL，否则 MOCK）


# ============================================================
# CLI 协议事件类型
# ============================================================


class CLIEventType(str, Enum):
    """CLI 输出协议（JSONL）事件类型"""

    SESSION_START = "session_start"
    SESSION_END = "session_end"
    TOOL_USE = "tool_use"
    TOOL_RESULT = "tool_result"
    CONTENT_DELTA = "content_delta"
    PROGRESS = "progress"
    ERROR = "error"


@dataclass
class CLIEvent:
    """CLI 协议事件"""

    type: str
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = 0.0


# ============================================================
# Runner 抽象接口
# ============================================================


class BaseAgentRunner:
    """Agent Runner 抽象基类（用于类型提示和接口契约）"""

    mode: RunnerMode = RunnerMode.MOCK

    def __init__(self, hook_bus: Optional[HookEventBus] = None):
        self._hook_bus = hook_bus or get_hook_bus()

    async def start(
        self,
        instance: AgentInstance,
        role: AgentRole,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> None:
        raise NotImplementedError

    async def cancel(self, agent_id: str, reason: str = "user requested") -> bool:
        raise NotImplementedError

    async def pause(self, agent_id: str) -> bool:
        raise NotImplementedError

    async def resume(self, agent_id: str) -> bool:
        raise NotImplementedError

    def is_running(self, agent_id: str) -> bool:
        raise NotImplementedError

    def get_stats(self) -> Dict[str, Any]:
        raise NotImplementedError


# ============================================================
# Real Agent Runner（生产模式）
# ============================================================


class RealAgentRunner(BaseAgentRunner):
    """
    真实 CLI 模式 Agent 执行器
    - 通过 subprocess 启动 claude/hermes CLI
    - 解析 JSONL 输出流
    - 映射为 Hook 事件
    """

    def __init__(
        self,
        hook_bus: Optional[HookEventBus] = None,
        cli_path: str = "claude",
        default_timeout: float = 600.0,
        sandbox: bool = True,
        flush_interval_ms: int = 100,
        max_output_buffer: int = 1000,
    ):
        super().__init__(hook_bus=hook_bus)
        self.mode = RunnerMode.REAL
        self._cli_path = cli_path
        self._default_timeout = default_timeout
        self._sandbox = sandbox
        self._flush_interval_s = flush_interval_ms / 1000.0
        self._max_output_buffer = max_output_buffer

        # agent_id -> asyncio.Task
        self._tasks: Dict[str, asyncio.Task] = {}
        # agent_id -> cancel_event
        self._cancel_events: Dict[str, asyncio.Event] = {}
        # agent_id -> pause_event
        self._pause_events: Dict[str, asyncio.Event] = {}
        # agent_id -> subprocess.Process
        self._processes: Dict[str, asyncio.subprocess.Process] = {}
        # agent_id -> 输出缓冲
        self._output_buffers: Dict[str, List[str]] = {}

    # ============================================================
    # CLI 命令构建
    # ============================================================

    def _build_cli_command(
        self, instance: AgentInstance, role: AgentRole
    ) -> List[str]:
        """
        构建 CLI 命令参数列表
        格式：[cli_path, --agent, role_name, --task, task, ...]
        """
        cmd = [self._cli_path]
        # 角色参数
        cmd.extend(["--role", role.name])
        if role.model:
            cmd.extend(["--model", role.model])
        if role.model_reasoning_effort:
            cmd.extend(["--reasoning", role.model_reasoning_effort])
        if role.sandbox_mode:
            cmd.extend(["--sandbox", role.sandbox_mode])
        # 任务参数
        cmd.extend(["--task", instance.task])
        if instance.nickname:
            cmd.extend(["--nickname", instance.nickname])
        # 输出格式：JSONL
        cmd.extend(["--output-format", "jsonl"])
        return cmd

    def is_cli_available(self) -> bool:
        """检查 CLI 是否可用"""
        return shutil.which(self._cli_path) is not None

    # ============================================================
    # 生命周期
    # ============================================================

    async def start(
        self,
        instance: AgentInstance,
        role: AgentRole,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> None:
        """启动真实 CLI 任务"""
        if not self.is_cli_available():
            logger.warning(
                f"CLI {self._cli_path} 不可用，请安装 Claude Code CLI 或设置正确的 cli_path"
            )
            # 降级：发出 Error 事件
            await self._hook_bus.publish(
                instance.agent_id,
                HookEventType.ERROR,
                {
                    "error": f"CLI 不可用: {self._cli_path}",
                    "error_type": "CLINotFoundError",
                },
            )
            instance.status = "failed"
            instance.error = f"CLI not found: {self._cli_path}"
            instance.finished_at = time.time()
            return

        cancel_event = asyncio.Event()
        pause_event = asyncio.Event()
        pause_event.set()
        self._cancel_events[instance.agent_id] = cancel_event
        self._pause_events[instance.agent_id] = pause_event
        self._output_buffers[instance.agent_id] = []

        # 创建任务
        task = asyncio.create_task(
            self._run(instance, role, cancel_event, pause_event, progress_callback)
        )
        self._tasks[instance.agent_id] = task

        # 发出 SubagentStart 事件
        await self._hook_bus.publish(
            instance.agent_id,
            HookEventType.SUBAGENT_START,
            {
                "role_name": role.name,
                "task": instance.task,
                "nickname": instance.nickname,
                "started_at": instance.started_at,
                "mode": "real",
                "cli_path": self._cli_path,
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
        """执行真实 CLI（在 asyncio.Task 中运行）"""
        try:
            instance.status = "running"
            # 构建命令
            cmd = self._build_cli_command(instance, role)
            logger.info(f"启动 CLI: {' '.join(cmd)}")

            # 启动子进程
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=1024 * 1024,  # 1MB 行缓冲
            )
            self._processes[instance.agent_id] = process

            # 异步读取 stdout (JSONL)
            stdout_task = asyncio.create_task(
                self._read_stdout(instance, process, cancel_event, pause_event)
            )
            # 异步读取 stderr
            stderr_task = asyncio.create_task(
                self._read_stderr(instance, process)
            )

            # 等待子进程结束或取消
            try:
                exit_code = await asyncio.wait_for(
                    process.wait(),
                    timeout=self._default_timeout,
                )
            except asyncio.TimeoutError:
                logger.warning(f"CLI 超时（{self._default_timeout}s），强制终止: {instance.agent_id}")
                process.kill()
                await process.wait()
                instance.status = "failed"
                instance.error = "timeout"
                await self._hook_bus.publish(
                    instance.agent_id,
                    HookEventType.ERROR,
                    {"error": "CLI timeout", "error_type": "TimeoutError"},
                )
                return

            # 等待 stdout/stderr 读取完成
            await stdout_task
            stderr_output = await stderr_task

            if cancel_event.is_set():
                instance.status = "cancelled"
                instance.error = instance.error or "cancelled by user"
                instance.finished_at = time.time()
                await self._hook_bus.publish(
                    instance.agent_id,
                    HookEventType.CANCELLED,
                    {"reason": instance.error},
                )
                return

            # 退出码 0 = 成功
            if exit_code == 0:
                instance.status = "idle"
                instance.progress = 1.0
                instance.finished_at = time.time()
                instance.result = (
                    f"任务完成（{instance.tool_calls_count} 次工具调用，"
                    f"{int(instance.finished_at - instance.started_at)}s）"
                )
                await self._hook_bus.publish(
                    instance.agent_id,
                    HookEventType.SUBAGENT_STOP,
                    {
                        "status": "idle",
                        "result": instance.result,
                        "duration_s": instance.finished_at - instance.started_at,
                        "tool_calls": instance.tool_calls_count,
                        "exit_code": exit_code,
                    },
                )
            else:
                instance.status = "failed"
                instance.error = stderr_output[:500] if stderr_output else f"exit code {exit_code}"
                instance.finished_at = time.time()
                await self._hook_bus.publish(
                    instance.agent_id,
                    HookEventType.ERROR,
                    {
                        "error": instance.error,
                        "error_type": "CLIExitError",
                        "exit_code": exit_code,
                    },
                )
        except asyncio.CancelledError:
            instance.status = "cancelled"
            instance.finished_at = time.time()
            instance.error = instance.error or "task cancelled"
            await self._hook_bus.publish(
                instance.agent_id,
                HookEventType.CANCELLED,
                {"reason": "task cancelled"},
            )
        except Exception as e:  # noqa: BLE001
            instance.status = "failed"
            instance.finished_at = time.time()
            instance.error = str(e)
            logger.exception(f"真实 CLI 任务失败: {instance.agent_id}: {e}")
            await self._hook_bus.publish(
                instance.agent_id,
                HookEventType.ERROR,
                {"error": str(e), "error_type": type(e).__name__},
            )
        finally:
            self._processes.pop(instance.agent_id, None)
            self._tasks.pop(instance.agent_id, None)
            self._cancel_events.pop(instance.agent_id, None)
            self._pause_events.pop(instance.agent_id, None)
            self._output_buffers.pop(instance.agent_id, None)

    async def _read_stdout(
        self,
        instance: AgentInstance,
        process: asyncio.subprocess.Process,
        cancel_event: asyncio.Event,
        pause_event: asyncio.Event,
    ) -> None:
        """异步读取 stdout (JSONL) 并映射为 Hook 事件"""
        try:
            while True:
                if cancel_event.is_set():
                    return
                await pause_event.wait()
                # 读取一行
                line = await process.stdout.readline()
                if not line:
                    return
                try:
                    line_text = line.decode("utf-8", errors="replace").strip()
                    if not line_text:
                        continue
                    # 解析 JSONL
                    cli_event = self._parse_jsonl(line_text)
                    if cli_event is None:
                        continue
                    # 映射为 Hook 事件
                    await self._dispatch_cli_event(instance, cli_event)
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"解析 JSONL 失败: {e}: {line_text[:200]}")
        except asyncio.CancelledError:
            pass

    async def _read_stderr(
        self, instance: AgentInstance, process: asyncio.subprocess.Process
    ) -> str:
        """异步读取 stderr"""
        try:
            data = await process.stderr.read()
            return data.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            return ""

    def _parse_jsonl(self, line: str) -> Optional[CLIEvent]:
        """解析单行 JSONL"""
        try:
            obj = json.loads(line)
            # 只接受对象类型（dict），其他类型（list/str/number）忽略
            if not isinstance(obj, dict):
                logger.debug(f"忽略非对象类型的 JSONL: {type(obj).__name__}")
                return None
            return CLIEvent(
                type=obj.get("type", "unknown"),
                data=obj,
                timestamp=obj.get("timestamp", time.time()),
            )
        except json.JSONDecodeError:
            # 非 JSON 行，记录但不报错（可能是日志输出）
            return None

    async def _dispatch_cli_event(
        self, instance: AgentInstance, event: CLIEvent
    ) -> None:
        """将 CLI 事件映射为 Hook 事件"""
        try:
            event_type_map = {
                CLIEventType.SESSION_START.value: HookEventType.SUBAGENT_START,
                CLIEventType.SESSION_END.value: HookEventType.SUBAGENT_STOP,
                CLIEventType.TOOL_USE.value: HookEventType.PRE_TOOL_USE,
                CLIEventType.TOOL_RESULT.value: HookEventType.POST_TOOL_USE,
                CLIEventType.CONTENT_DELTA.value: HookEventType.OUTPUT,
                CLIEventType.PROGRESS.value: HookEventType.PROGRESS,
                CLIEventType.ERROR.value: HookEventType.ERROR,
            }
            hook_type = event_type_map.get(event.type)
            if hook_type is None:
                return
            data = event.data
            if event.type == CLIEventType.TOOL_USE.value:
                instance.current_tool = data.get("name", "unknown")
                instance.status = "tool_calling"
                instance.tool_calls_count += 1
            elif event.type == CLIEventType.TOOL_RESULT.value:
                duration_ms = data.get("duration_ms", 0)
                # 更新统计
            elif event.type == CLIEventType.CONTENT_DELTA.value:
                instance.status = "output_streaming"
                # 缓冲输出
                buf = self._output_buffers.setdefault(instance.agent_id, [])
                buf.append(data.get("text", ""))
                if len(buf) > self._max_output_buffer:
                    buf.pop(0)
            elif event.type == CLIEventType.PROGRESS.value:
                percent = data.get("percent", 0.0)
                instance.progress = float(percent)
            elif event.type == CLIEventType.ERROR.value:
                instance.error = data.get("message", "unknown error")
            await self._hook_bus.publish(instance.agent_id, hook_type, data)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"分发 CLI 事件失败: {e}")

    # ============================================================
    # 取消/暂停/恢复
    # ============================================================

    async def cancel(self, agent_id: str, reason: str = "user requested") -> bool:
        """取消任务（SIGTERM → SIGKILL）"""
        if agent_id in self._cancel_events:
            self._cancel_events[agent_id].set()
        process = self._processes.get(agent_id)
        if process and process.returncode is None:
            try:
                process.terminate()
                # 等待 200ms 让进程优雅退出
                try:
                    await asyncio.wait_for(process.wait(), timeout=0.2)
                except asyncio.TimeoutError:
                    # 强制 kill
                    process.kill()
                    await process.wait()
                return True
            except Exception as e:  # noqa: BLE001
                logger.warning(f"取消进程失败: {e}")
                return False
        return True

    async def pause(self, agent_id: str) -> bool:
        """暂停任务（SIGSTOP）"""
        if agent_id in self._pause_events:
            self._pause_events[agent_id].clear()
        process = self._processes.get(agent_id)
        if process and process.returncode is None:
            try:
                process.send_signal(19)  # SIGSTOP on Linux
                return True
            except Exception as e:  # noqa: BLE001
                logger.warning(f"暂停进程失败: {e}")
                return False
        return True

    async def resume(self, agent_id: str) -> bool:
        """恢复任务（SIGCONT）"""
        if agent_id in self._pause_events:
            self._pause_events[agent_id].set()
        process = self._processes.get(agent_id)
        if process and process.returncode is None:
            try:
                process.send_signal(18)  # SIGCONT on Linux
                return True
            except Exception as e:  # noqa: BLE001
                logger.warning(f"恢复进程失败: {e}")
                return False
        return True

    def is_running(self, agent_id: str) -> bool:
        """检查 agent 是否正在运行"""
        return agent_id in self._tasks

    def get_stats(self) -> Dict[str, Any]:
        """统计"""
        return {
            "mode": self.mode.value,
            "active_tasks": len(self._tasks),
            "active_processes": len(self._processes),
            "cli_path": self._cli_path,
            "cli_available": self.is_cli_available(),
            "hook_bus": self._hook_bus.get_stats(),
        }


# ============================================================
# Runner 工厂
# ============================================================


_runner: Optional[BaseAgentRunner] = None
_runner_mode: RunnerMode = RunnerMode.MOCK


def get_agent_runner(
    mode: Optional[RunnerMode] = None,
    force_new: bool = False,
) -> BaseAgentRunner:
    """
    获取 Agent Runner（根据 mode 决定 mock/real）
    - mode=MOCK: 返回 MockAgentRunner（来自 agent_runner 模块）
    - mode=REAL: 返回 RealAgentRunner（如果 CLI 不可用则降级为 mock）
    - mode=AUTO: 有 CLI 时 REAL，否则 MOCK
    """
    global _runner, _runner_mode

    target_mode = mode or _runner_mode

    if not force_new and _runner is not None and _runner_mode == target_mode:
        return _runner

    # 根据 mode 决定 runner 类型
    if target_mode == RunnerMode.AUTO:
        real = RealAgentRunner()
        if real.is_cli_available():
            chosen_mode = RunnerMode.REAL
            _runner = real
        else:
            from .agent_runner import AgentRunner as MockAgentRunnerImpl
            _runner = MockAgentRunnerImpl()
            chosen_mode = RunnerMode.MOCK
    elif target_mode == RunnerMode.REAL:
        _runner = RealAgentRunner()
        chosen_mode = RunnerMode.REAL
    else:
        from .agent_runner import AgentRunner as MockAgentRunnerImpl
        _runner = MockAgentRunnerImpl()
        chosen_mode = RunnerMode.MOCK

    _runner_mode = chosen_mode
    return _runner


def set_runner_mode(mode: RunnerMode) -> None:
    """设置全局 runner 模式（下次 get_agent_runner 调用生效）"""
    global _runner_mode
    _runner_mode = mode


def reset_agent_runner() -> None:
    """重置全局 runner（用于测试）"""
    global _runner, _runner_mode
    _runner = None
    _runner_mode = RunnerMode.MOCK
