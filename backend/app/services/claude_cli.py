"""
# ============================================================
# ClaudeCLIProcess - Claude Code CLI 进程编排层 (v1.0.0)
# Cycle 61 G61-01-T1
# ============================================================
# 核心作用：在 cli_integration/claude_code_shell.py 基础上，封装更高层
#   的 CLI 进程编排能力，包括：
#   - 沙箱选择（Docker / gVisor / firejail / none）
#   - 资源限制（CPU / MEM / TIME）
#   - 健康检查与失败降级
#   - 进程生命周期管理
#   - 与 SSE 事件系统的对接
# 运行流程：
#   1. ClaudeCLIProcess 接收 prompt + options
#   2. SandboxManager 选择合适沙箱（按优先级）
#   3. 若 claude CLI 不可用，自动降级到 LLM HTTP fallback
#   4. 启动 subprocess 并通过 ClaudeShellChunk 流式输出
#   5. 资源超限自动 kill + 资源清理
# 设计要点：
#   - 高风险模块：所有用户输入必须经过 sanitization
#   - 异步设计：asyncio 兼容
#   - 沙箱失败可降级，不阻塞业务
#   - 全链路异常处理，确保资源不泄漏
# 输入参数：prompt (str), options (ClaudeCLIOptions)
# 输出结果：AsyncIterator[CLIEvent] / ClaudeCLIProcess 实例
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-01-T1 初次创建
# ====================================
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

# 兼容 cli_integration 位于工作空间根目录的情况
_WORKSPACE_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
if _WORKSPACE_ROOT not in sys.path:
    sys.path.insert(0, _WORKSPACE_ROOT)

from cli_integration import claude_code_shell as shell

from .sandbox_manager import (
    SandboxManager,
    SandboxType,
    SandboxResult,
    get_sandbox_manager,
    get_sandbox_manager_sync,
)

logger = logging.getLogger(__name__)


# ============================================================
# 常量与配置
# ============================================================

# 资源默认值
DEFAULT_CPU_QUOTA = 0.8          # 80% 单核
DEFAULT_MEM_LIMIT_MB = 512       # 512 MB
DEFAULT_TIMEOUT_SECONDS = 300    # 5 分钟
MAX_TIMEOUT_SECONDS = 1800       # 30 分钟（绝对上限）
MAX_OUTPUT_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_CONCURRENT_PROCESSES = 5     # 全局最大并发 CLI 数


# ============================================================
# 枚举与数据模型
# ============================================================

class CLIEventType(str, Enum):
    """SSE 事件类型"""
    STARTED = "cli_started"
    STDOUT = "cli_stdout"
    STDERR = "cli_stderr"
    THINKING = "cli_thinking"
    TOOL_CALL = "cli_tool_call"
    TOOL_RESULT = "cli_tool_result"
    EXIT = "cli_exit"
    FALLBACK = "cli_fallback"
    ERROR = "cli_error"


class CLIState(str, Enum):
    """进程状态机"""
    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"
    OOM = "oom"
    FALLBACK = "fallback"


@dataclass
class ClaudeCLIOptions:
    """调用选项"""
    model: Optional[str] = None
    sandbox: Optional[SandboxType] = None
    timeout: int = DEFAULT_TIMEOUT_SECONDS
    max_tokens: int = 8192
    tools: List[str] = field(default_factory=lambda: ["read", "write", "bash"])
    cwd: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    args: Optional[List[str]] = None
    cpu_quota: float = DEFAULT_CPU_QUOTA
    mem_limit_mb: int = DEFAULT_MEM_LIMIT_MB
    auto_fallback: bool = True


@dataclass
class CLIEvent:
    """SSE 事件负载"""
    id: str
    type: CLIEventType
    timestamp: float
    content: str = ""
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class ClaudeCLIResult:
    """执行结果汇总"""
    process_id: str
    state: CLIState
    exit_code: Optional[int] = None
    error: Optional[str] = None
    started_at: float = 0.0
    finished_at: float = 0.0
    duration: float = 0.0
    total_bytes: int = 0
    chunk_count: int = 0
    sandbox_used: Optional[SandboxType] = None
    fallback_used: bool = False


# ============================================================
# 进程注册表（全局）
# ============================================================

class _ProcessRegistry:
    """全局进程注册表，追踪所有活跃进程以支持 cancel / 资源限制"""

    def __init__(self) -> None:
        self._processes: Dict[str, "ClaudeCLIProcess"] = {}
        self._lock = asyncio.Lock()

    async def register(self, process: "ClaudeCLIProcess") -> bool:
        """
        注册进程。超过 MAX_CONCURRENT_PROCESSES 时返回 False。
        """
        async with self._lock:
            if len(self._processes) >= MAX_CONCURRENT_PROCESSES:
                return False
            self._processes[process.process_id] = process
            return True

    async def unregister(self, process_id: str) -> None:
        async with self._lock:
            self._processes.pop(process_id, None)

    def get(self, process_id: str) -> Optional["ClaudeCLIProcess"]:
        return self._processes.get(process_id)

    def all(self) -> List["ClaudeCLIProcess"]:
        return list(self._processes.values())


_REGISTRY = _ProcessRegistry()


def get_registry() -> _ProcessRegistry:
    """获取全局进程注册表（单例）"""
    return _REGISTRY


# ============================================================
# ClaudeCLIProcess - 单个进程封装
# ============================================================

class ClaudeCLIProcess:
    """
    Claude CLI 进程封装：管理单个 subprocess 的完整生命周期

    职责：
      - 与 cli_integration/claude_code_shell.py 对接
      - 通过 SandboxManager 注入沙箱参数
      - 监控资源超限（CPU / MEM / TIME）
      - 提供流式事件 AsyncIterator
    """

    def __init__(
        self,
        process_id: Optional[str] = None,
        sandbox_manager: Optional[SandboxManager] = None,
    ) -> None:
        self.process_id = process_id or f"cli-{uuid.uuid4().hex[:16]}"
        # 使用同步版本获取 SandboxManager（懒加载），实际调用在 async 上下文
        self._sandbox_manager = sandbox_manager or get_sandbox_manager_sync()
        self._state = CLIState.IDLE
        self._started_at: float = 0.0
        self._finished_at: float = 0.0
        self._exit_code: Optional[int] = None
        self._error: Optional[str] = None
        self._total_bytes = 0
        self._chunk_count = 0
        self._sandbox_used: Optional[SandboxType] = None
        self._fallback_used = False
        self._cancel_event = asyncio.Event()
        self._stream_id: Optional[str] = None
        self._lock = asyncio.Lock()

    # --------------------------------------------------------
    # 属性访问
    # --------------------------------------------------------

    @property
    def state(self) -> CLIState:
        return self._state

    @property
    def is_running(self) -> bool:
        return self._state in (CLIState.STARTING, CLIState.RUNNING)

    @property
    def is_terminal(self) -> bool:
        return self._state in (
            CLIState.COMPLETED,
            CLIState.FAILED,
            CLIState.CANCELLED,
            CLIState.TIMEOUT,
            CLIState.OOM,
            CLIState.FALLBACK,
        )

    # --------------------------------------------------------
    # 生命周期：启动
    # --------------------------------------------------------

    async def start(self, prompt: str, options: ClaudeCLIOptions) -> CLIEvent:
        """
        启动进程并发出 STARTED 事件。

        输入参数：prompt (str), options (ClaudeCLIOptions)
        输出结果：CLIEvent (STARTED)
        异常：RuntimeError - 启动失败 / 资源不足
        """
        if self._state != CLIState.IDLE:
            raise RuntimeError(f"进程已在状态 {self._state}，不能重复 start")

        # 校验 timeout
        if options.timeout <= 0 or options.timeout > MAX_TIMEOUT_SECONDS:
            raise ValueError(
                f"timeout 必须在 (0, {MAX_TIMEOUT_SECONDS}] 秒内，实际 {options.timeout}"
            )

        # 注册到全局注册表
        if not await _REGISTRY.register(self):
            raise RuntimeError(f"超过最大并发数 {MAX_CONCURRENT_PROCESSES}")

        self._state = CLIState.STARTING
        self._started_at = time.time()
        self._error = None

        # 1. 选择沙箱
        sandbox_result = await self._resolve_sandbox(options)
        self._sandbox_used = sandbox_result.sandbox_type

        # 2. 检查 claude CLI 是否可用
        cli_available = await shell.is_available_async()

        # 3. 若不可用 + auto_fallback 开启 → 标记 fallback
        if not cli_available:
            if not options.auto_fallback:
                self._state = CLIState.FAILED
                self._error = "CLI_NOT_FOUND: claude CLI 不在 PATH"
                self._finished_at = time.time()
                await _REGISTRY.unregister(self.process_id)
                raise RuntimeError(self._error)
            self._fallback_used = True
            self._state = CLIState.FALLBACK
            logger.warning(
                f"ClaudeCLIProcess: claude CLI 不可用，启用 LLM HTTP fallback "
                f"process_id={self.process_id}"
            )

        return CLIEvent(
            id=self.process_id,
            type=CLIEventType.STARTED,
            timestamp=self._started_at,
            content=f"started mode={'subprocess' if not self._fallback_used else 'fallback'}",
            metadata={
                "model": options.model,
                "sandbox": self._sandbox_used.value if self._sandbox_used else None,
                "timeout": options.timeout,
                "stream_id": self._stream_id,
            },
        )

    # --------------------------------------------------------
    # 生命周期：流式执行
    # --------------------------------------------------------

    async def stream(
        self, prompt: str, options: ClaudeCLIOptions
    ) -> AsyncIterator[CLIEvent]:
        """
        启动并流式返回事件。

        输入参数：prompt (str), options (ClaudeCLIOptions)
        输出结果：AsyncIterator[CLIEvent]
        异常：ValueError - 输入非法 / RuntimeError - 启动失败
        """
        # start 阶段（已发出 STARTED 事件）
        started_event = await self.start(prompt, options)
        yield started_event

        if self._state == CLIState.FALLBACK:
            # fallback 模式：直接调 LLM HTTP 并流式返回
            async for ev in self._stream_fallback(prompt, options):
                yield ev
            return

        # subprocess 模式
        self._state = CLIState.RUNNING

        # 注入沙箱参数
        effective_args = self._apply_sandbox_args(options, started_event)

        # 设置超时 watchdog
        try:
            async with asyncio.timeout(options.timeout):
                async for chunk in shell.stream_invoke(
                    prompt=prompt,
                    args=effective_args,
                    cwd=options.cwd,
                    timeout=options.timeout,
                    env=options.env,
                ):
                    # 检查取消
                    if self._cancel_event.is_set():
                        self._state = CLIState.CANCELLED
                        self._finished_at = time.time()
                        yield self._make_exit_event(0, "cancelled by user")
                        return

                    # 字节累计
                    chunk_bytes = len(chunk.chunk.encode("utf-8"))
                    self._total_bytes += chunk_bytes
                    if self._total_bytes > MAX_OUTPUT_BYTES:
                        self._state = CLIState.FAILED
                        self._error = f"MAX_OUTPUT_BYTES exceeded ({MAX_OUTPUT_BYTES})"
                        self._finished_at = time.time()
                        yield CLIEvent(
                            id=self.process_id,
                            type=CLIEventType.ERROR,
                            timestamp=time.time(),
                            content=self._error,
                        )
                        yield self._make_exit_event(-1, self._error)
                        return

                    self._chunk_count += 1
                    yield self._convert_chunk(chunk)

                # 正常结束
                self._state = CLIState.COMPLETED
                self._finished_at = time.time()
                yield self._make_exit_event(0, "completed")
        except asyncio.TimeoutError:
            self._state = CLIState.TIMEOUT
            self._error = f"timeout after {options.timeout}s"
            self._finished_at = time.time()
            logger.warning(
                f"ClaudeCLIProcess: timeout process_id={self.process_id} "
                f"timeout={options.timeout}s"
            )
            yield CLIEvent(
                id=self.process_id,
                type=CLIEventType.ERROR,
                timestamp=time.time(),
                content=self._error,
            )
            yield self._make_exit_event(-1, self._error)
        except Exception as e:
            self._state = CLIState.FAILED
            self._error = str(e)
            self._finished_at = time.time()
            logger.exception(f"ClaudeCLIProcess: error process_id={self.process_id}")
            yield CLIEvent(
                id=self.process_id,
                type=CLIEventType.ERROR,
                timestamp=time.time(),
                content=self._error,
            )
            yield self._make_exit_event(-1, self._error)
        finally:
            await _REGISTRY.unregister(self.process_id)

    # --------------------------------------------------------
    # 生命周期：取消
    # --------------------------------------------------------

    def cancel(self) -> bool:
        """
        标记取消请求。设置 _cancel_event，由 stream 协程检查后退出。

        输入参数：无
        输出结果：bool (True 表示已标记)
        """
        if not self.is_running:
            return False
        self._cancel_event.set()
        logger.info(
            f"ClaudeCLIProcess: cancel requested process_id={self.process_id} "
            f"state={self._state.value}"
        )
        return True

    # --------------------------------------------------------
    # 结果汇总
    # --------------------------------------------------------

    def result(self) -> ClaudeCLIResult:
        """返回当前结果汇总（用于 API 响应）"""
        duration = (
            (self._finished_at or time.time()) - self._started_at
            if self._started_at > 0
            else 0.0
        )
        return ClaudeCLIResult(
            process_id=self.process_id,
            state=self._state,
            exit_code=self._exit_code,
            error=self._error,
            started_at=self._started_at,
            finished_at=self._finished_at,
            duration=duration,
            total_bytes=self._total_bytes,
            chunk_count=self._chunk_count,
            sandbox_used=self._sandbox_used,
            fallback_used=self._fallback_used,
        )

    # --------------------------------------------------------
    # 内部辅助
    # --------------------------------------------------------

    async def _resolve_sandbox(self, options: ClaudeCLIOptions) -> SandboxResult:
        """解析沙箱选择"""
        if options.sandbox is not None:
            return await self._sandbox_manager.acquire(
                sandbox_type=options.sandbox,
                cpu_quota=options.cpu_quota,
                mem_limit_mb=options.mem_limit_mb,
            )
        # 自动选择：sandbox_manager 内部按优先级选择
        return await self._sandbox_manager.acquire_auto(
            cpu_quota=options.cpu_quota,
            mem_limit_mb=options.mem_limit_mb,
        )

    def _apply_sandbox_args(
        self, options: ClaudeCLIOptions, started_event: CLIEvent
    ) -> Optional[List[str]]:
        """根据沙箱返回结果调整 CLI 参数"""
        base_args = list(options.args) if options.args else []
        if self._sandbox_used == SandboxType.DOCKER:
            base_args.extend(["--sandbox", "docker"])
        elif self._sandbox_used == SandboxType.GVISOR:
            base_args.extend(["--sandbox", "gvisor"])
        elif self._sandbox_used == SandboxType.FIREJAIL:
            base_args.extend(["--sandbox", "firejail"])
        # SandboxType.NONE：不追加
        return base_args if base_args else None

    def _convert_chunk(self, chunk: shell.ClaudeShellChunk) -> CLIEvent:
        """
        将 shell.ClaudeShellChunk 映射为 CLIEvent。

        规则：
          - stream == "stderr" → STDERR 事件
          - 内容以 "[thinking]" 开头 → THINKING 事件
          - 内容以 "[tool_call]" 开头 → TOOL_CALL 事件
          - 默认 → STDOUT 事件
        """
        content = chunk.chunk
        if chunk.stream == "stderr":
            return CLIEvent(
                id=self.process_id,
                type=CLIEventType.STDERR,
                timestamp=chunk.timestamp,
                content=content,
            )
        if content.startswith("[thinking]"):
            return CLIEvent(
                id=self.process_id,
                type=CLIEventType.THINKING,
                timestamp=chunk.timestamp,
                content=content[len("[thinking]"):].lstrip(),
            )
        if content.startswith("[tool_call]"):
            return CLIEvent(
                id=self.process_id,
                type=CLIEventType.TOOL_CALL,
                timestamp=chunk.timestamp,
                content=content[len("[tool_call]"):].lstrip(),
                metadata={"stream_id": chunk.stream_id},
            )
        return CLIEvent(
            id=self.process_id,
            type=CLIEventType.STDOUT,
            timestamp=chunk.timestamp,
            content=content,
            metadata={"stream_id": chunk.stream_id},
        )

    def _make_exit_event(self, code: int, reason: str) -> CLIEvent:
        """生成 EXIT 事件"""
        self._exit_code = code
        return CLIEvent(
            id=self.process_id,
            type=CLIEventType.EXIT,
            timestamp=time.time(),
            content=reason,
            metadata={"exit_code": code, "state": self._state.value},
        )

    async def _stream_fallback(
        self, prompt: str, options: ClaudeCLIOptions
    ) -> AsyncIterator[CLIEvent]:
        """
        LLM HTTP fallback 流式输出。
        优先尝试通过 shell.invoke 的 fallback 模式获取输出。
        """
        try:
            result = await shell.invoke(
                prompt=prompt,
                args=options.args,
                cwd=options.cwd,
                timeout=options.timeout,
                env=options.env,
            )
            # 模拟 THINKING 事件
            yield CLIEvent(
                id=self.process_id,
                type=CLIEventType.THINKING,
                timestamp=time.time(),
                content=f"Fallback 模式（无 claude CLI），使用 mode={result.mode}",
            )
            for chunk in result.chunks:
                if self._cancel_event.is_set():
                    self._state = CLIState.CANCELLED
                    self._finished_at = time.time()
                    yield self._make_exit_event(0, "cancelled by user")
                    return
                self._total_bytes += len(chunk.chunk.encode("utf-8"))
                self._chunk_count += 1
                yield CLIEvent(
                    id=self.process_id,
                    type=(
                        CLIEventType.STDERR
                        if chunk.stream == "stderr"
                        else CLIEventType.STDOUT
                    ),
                    timestamp=chunk.timestamp,
                    content=chunk.chunk,
                )
            self._state = CLIState.COMPLETED
            self._finished_at = time.time()
            yield self._make_exit_event(result.exit_code or 0, "fallback completed")
        except Exception as e:
            self._state = CLIState.FAILED
            self._error = f"fallback failed: {e}"
            self._finished_at = time.time()
            logger.exception(
                f"ClaudeCLIProcess: fallback failed process_id={self.process_id}"
            )
            yield CLIEvent(
                id=self.process_id,
                type=CLIEventType.ERROR,
                timestamp=time.time(),
                content=self._error,
            )
            yield self._make_exit_event(-1, self._error)
        finally:
            await _REGISTRY.unregister(self.process_id)


# ============================================================
# 模块级便捷函数
# ============================================================

async def exec_prompt(
    prompt: str,
    options: Optional[ClaudeCLIOptions] = None,
) -> AsyncIterator[CLIEvent]:
    """
    一次性执行 prompt 并返回事件流（便捷函数）。

    输入参数：prompt (str), options (Optional[ClaudeCLIOptions])
    输出结果：AsyncIterator[CLIEvent]
    """
    opts = options or ClaudeCLIOptions()
    proc = ClaudeCLIProcess()
    async for event in proc.stream(prompt, opts):
        yield event
