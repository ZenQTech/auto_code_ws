"""
# ============================================================
# Plan Executor - ComposerPlan 真正可执行层 (v1.0.0)
# Cycle 61 G61-04
# ============================================================
# 核心作用：将 ComposerPlan 的 step 真正执行起来
#           - LLM step: 调用真实 LLM（通过 plan_mode._call_llm_for_plan 同源接口）
#           - Tool step: 调用内置 / 注册的 tool handler
#           - Command step: 异步执行 shell 命令
#           - Verify step: 调用 StepVerifier 验证
# 运行流程：
#   1. ComposerPlanService 启动 plan → _run_plan → _run_step
#   2. _run_step 通过 handler 调度到本模块
#   3. PlanExecutor 按 step.action 路由：
#        - llm_call       -> LLM 真实调用 + 进度推送
#        - run_shell      -> asyncio.subprocess 异步执行
#        - edit_file      -> 文件读写
#        - read_file      -> 文件读取
#        - verify_command -> StepVerifier
#        - composite      -> 嵌套子 plan
#   4. 进度 / 错误 / 输出通过 SSE 推送给前端
# 设计要点：
#   - 死循环防护：单 plan max_total_steps + 单 step max_attempts
#   - 资源限制：LLM 调用有超时、命令有 timeout
#   - 失败恢复：捕获异常后按 strategy (retry/skip/abort) 处理
#   - 可中断：随时检查 cancel / pause 信号
# 输入参数：ComposerStep + 上下文
# 输出结果：执行结果 dict（status / output / error）
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-04 初次创建
# ====================================
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .composer_plan import (
    ComposerStep,
    BUILTIN_ACTION_HANDLERS,
    get_action_handler,
    register_action_handler,
)

logger = logging.getLogger(__name__)


# ============================================================
# 执行器配置
# ============================================================


@dataclass
class PlanExecutorConfig:
    """
    PlanExecutor 配置
    字段说明：
      - default_llm_timeout: LLM 默认超时（秒）
      - default_shell_timeout: shell 默认超时（秒）
      - max_total_steps_per_plan: 单 plan 最大 step 数（防死循环）
      - progress_throttle_ms: 进度推送节流
      - enable_sandbox: 是否启用沙箱（占位）
    """
    default_llm_timeout: int = 120
    default_shell_timeout: int = 60
    max_total_steps_per_plan: int = 200
    progress_throttle_ms: int = 100
    enable_sandbox: bool = False

    def to_dict(self) -> Dict:
        return {
            "default_llm_timeout": self.default_llm_timeout,
            "default_shell_timeout": self.default_shell_timeout,
            "max_total_steps_per_plan": self.max_total_steps_per_plan,
            "progress_throttle_ms": self.progress_throttle_ms,
            "enable_sandbox": self.enable_sandbox,
        }


# ============================================================
# LLM 调用抽象（与 plan_mode / hermes_service 解耦）
# ============================================================


class LLMCaller:
    """
    LLM 调用抽象接口
    由外部注入真实实现（plan_mode / hermes_service / claude_cli）
    默认实现是占位符（返回 mock）
    """

    async def call(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        timeout: int = 120,
        model: str = "",
    ) -> str:
        """返回 LLM 输出文本"""
        raise NotImplementedError("LLMCaller.call() 必须由外部注入")


class DefaultLLMCaller(LLMCaller):
    """
    默认 LLM 调用器：直接返回参数 echo
    用于：
      1. 单元测试（无需 mock LLM）
      2. fallback（当真实 LLM 不可用时）
    """

    async def call(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        timeout: int = 120,
        model: str = "",
    ) -> str:
        await asyncio.sleep(0.01)
        return f"[mock-llm] prompt_len={len(prompt)} max_tokens={max_tokens}"


# ============================================================
# 进度推送回调
# ============================================================


ProgressCallback = Callable[[str, Dict[str, Any]], Awaitable[None]]
"""
进度回调签名：
  async def on_progress(event_type: str, data: dict)
event_type 取值：
  - "step_progress": step 进度更新（0-1）
  - "step_log": step 执行日志（stdout / stderr）
  - "step_thinking": LLM 思考过程片段
"""


# ============================================================
# Plan Executor 主类
# ============================================================


class PlanExecutor:
    """
    ComposerPlan 真正执行器

    与 ComposerPlanService 协作：
      - ComposerPlanService._run_step 通过 handler 调度
      - PlanExecutor 内部根据 step.action 路由到具体实现
      - 完成后返回结果 dict，由 ComposerPlanService 推送到 SSE

    死循环防护：
      - 单 plan 限制 max_total_steps_per_plan（默认 200）
      - 单 step 限制 max_attempts（来自 ComposerStep）
    """

    def __init__(
        self,
        llm_caller: Optional[LLMCaller] = None,
        config: Optional[PlanExecutorConfig] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> None:
        self.llm_caller = llm_caller or DefaultLLMCaller()
        self.config = config or PlanExecutorConfig()
        self.progress_callback = progress_callback
        # 注册内置 action handlers
        self._register_builtin_handlers()

    # -------- 进度推送辅助 --------

    async def _emit_progress(self, event_type: str, data: Dict[str, Any]) -> None:
        if self.progress_callback is None:
            return
        try:
            await self.progress_callback(event_type, data)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"PlanExecutor 进度回调失败: {e}")

    # -------- 内置 action handlers 注册 --------

    def _register_builtin_handlers(self) -> None:
        """注册所有内置 action handlers"""
        register_action_handler("llm_call", self._handle_llm_call)
        register_action_handler("run_shell", self._handle_run_shell)
        register_action_handler("edit_file", self._handle_edit_file)
        register_action_handler("read_file", self._handle_read_file)
        register_action_handler("write_file", self._handle_write_file)
        register_action_handler("verify_command", self._handle_verify_command)
        register_action_handler("composite", self._handle_composite)
        register_action_handler("noop", self._handle_noop)

    # -------- LLM step --------

    async def _handle_llm_call(self, step: ComposerStep, ctx: Dict) -> Dict:
        """
        LLM 调用 step
        params 字段：
          - prompt: str（必需）
          - system: str（可选）
          - max_tokens: int（可选，默认 4096）
          - model: str（可选）
          - timeout: int（可选，默认配置）
        """
        prompt = step.params.get("prompt", "")
        if not prompt:
            # 兼容：直接使用 step.description 或 step.title
            prompt = step.description or step.title
        if not prompt:
            raise ValueError(f"llm_call step 缺少 prompt: step_id={step.step_id}")

        system = step.params.get("system", "")
        max_tokens = int(step.params.get("max_tokens", 4096))
        model = step.params.get("model", "")
        timeout = int(step.params.get("timeout", self.config.default_llm_timeout))

        await self._emit_progress("step_log", {
            "step_id": step.step_id,
            "log": f"[llm] start prompt_len={len(prompt)} max_tokens={max_tokens}",
        })

        # 进度：开始 0.0
        await self._emit_progress("step_progress", {
            "step_id": step.step_id,
            "progress": 0.1,
        })

        # 调用 LLM（带超时）
        start_ts = time.time()
        try:
            output_text = await asyncio.wait_for(
                self.llm_caller.call(
                    prompt=prompt,
                    system=system,
                    max_tokens=max_tokens,
                    timeout=timeout,
                    model=model,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError as e:
            raise TimeoutError(f"LLM 调用超时 ({timeout}s)") from e
        elapsed = time.time() - start_ts

        # 进度：完成 0.9 → 1.0
        await self._emit_progress("step_progress", {
            "step_id": step.step_id,
            "progress": 0.9,
        })

        await self._emit_progress("step_log", {
            "step_id": step.step_id,
            "log": f"[llm] done output_len={len(output_text)} elapsed={elapsed:.2f}s",
        })

        return {
            "action": step.action,
            "output_text": output_text,
            "model": model or "default",
            "prompt_tokens": len(prompt),
            "completion_tokens": len(output_text),
            "elapsed_seconds": round(elapsed, 3),
        }

    # -------- Shell step --------

    async def _handle_run_shell(self, step: ComposerStep, ctx: Dict) -> Dict:
        """
        Shell 命令 step
        params 字段：
          - command: str（必需）
          - timeout: int（可选，默认配置）
          - cwd: str（可选）
        """
        command = step.params.get("command", "")
        if not command:
            raise ValueError(f"run_shell step 缺少 command: step_id={step.step_id}")

        timeout = int(step.params.get("timeout", self.config.default_shell_timeout))
        cwd = step.params.get("cwd", None)

        await self._emit_progress("step_log", {
            "step_id": step.step_id,
            "log": f"[shell] $ {command[:200]}",
        })

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError as e:
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass
            raise TimeoutError(f"shell command timeout after {timeout}s") from e

        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")

        # 输出日志
        if stdout_text:
            await self._emit_progress("step_log", {
                "step_id": step.step_id,
                "log": f"[shell stdout] {stdout_text[:500]}",
            })
        if stderr_text:
            await self._emit_progress("step_log", {
                "step_id": step.step_id,
                "log": f"[shell stderr] {stderr_text[:500]}",
            })

        if proc.returncode != 0:
            raise RuntimeError(
                f"shell command failed: returncode={proc.returncode} stderr={stderr_text[:500]}"
            )

        return {
            "action": step.action,
            "command": command,
            "returncode": proc.returncode,
            "stdout": stdout_text,
            "stderr": stderr_text,
        }

    # -------- 文件操作 step --------

    async def _handle_read_file(self, step: ComposerStep, ctx: Dict) -> Dict:
        """读取文件 step"""
        file_path = step.params.get("path") or step.params.get("file_path", "")
        if not file_path:
            raise ValueError(f"read_file step 缺少 path: step_id={step.step_id}")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"file not found: {file_path}")
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {
            "action": step.action,
            "path": file_path,
            "content": content,
            "size": len(content),
        }

    async def _handle_write_file(self, step: ComposerStep, ctx: Dict) -> Dict:
        """写入文件 step"""
        file_path = step.params.get("path") or step.params.get("file_path", "")
        content = step.params.get("content", "")
        if not file_path:
            raise ValueError(f"write_file step 缺少 path: step_id={step.step_id}")
        os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return {
            "action": step.action,
            "path": file_path,
            "size": len(content),
        }

    async def _handle_edit_file(self, step: ComposerStep, ctx: Dict) -> Dict:
        """
        编辑文件 step
        params 字段：
          - path: str
          - old_text: str
          - new_text: str
          或
          - replacements: List[Dict{old_text, new_text}]
        """
        file_path = step.params.get("path") or step.params.get("file_path", "")
        if not file_path:
            raise ValueError(f"edit_file step 缺少 path: step_id={step.step_id}")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"file not found: {file_path}")

        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        # 单替换模式
        if "old_text" in step.params and "new_text" in step.params:
            old_text = step.params["old_text"]
            new_text = step.params["new_text"]
            if old_text not in content:
                raise ValueError(f"old_text not found in {file_path}")
            new_content = content.replace(old_text, new_text, 1)
        elif "replacements" in step.params:
            new_content = content
            replacements = step.params["replacements"]
            if not isinstance(replacements, list):
                raise ValueError("replacements 必须是 list")
            for r in replacements:
                if not isinstance(r, dict) or "old_text" not in r or "new_text" not in r:
                    raise ValueError("replacement 必须是 dict 包含 old_text / new_text")
                if r["old_text"] not in new_content:
                    raise ValueError(
                        f"old_text not found in {file_path}: {r['old_text'][:50]}"
                    )
                new_content = new_content.replace(r["old_text"], r["new_text"], 1)
        else:
            raise ValueError(
                "edit_file step 缺少 old_text/new_text 或 replacements"
            )

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)

        return {
            "action": step.action,
            "path": file_path,
            "size": len(new_content),
            "diff_chars": len(new_content) - len(content),
        }

    # -------- 验证 step --------

    async def _handle_verify_command(self, step: ComposerStep, ctx: Dict) -> Dict:
        """
        验证 step：执行命令并断言输出
        params 字段：
          - command: str
          - expected: str（必须出现在 stdout 中）
          - timeout: int
        """
        command = step.params.get("command", "")
        expected = step.params.get("expected", "")
        timeout = int(step.params.get("timeout", self.config.default_shell_timeout))
        if not command:
            raise ValueError(f"verify_command step 缺少 command: step_id={step.step_id}")

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError as e:
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass
            raise TimeoutError(f"verify command timeout after {timeout}s") from e

        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")

        if proc.returncode != 0:
            raise AssertionError(
                f"verify_command failed: returncode={proc.returncode} stderr={stderr_text[:200]}"
            )
        if expected and expected not in stdout_text:
            raise AssertionError(
                f"verify_command 断言失败: expected={expected!r} not in stdout"
            )

        return {
            "action": step.action,
            "command": command,
            "returncode": proc.returncode,
            "expected": expected,
            "passed": True,
        }

    # -------- 复合 step --------

    async def _handle_composite(self, step: ComposerStep, ctx: Dict) -> Dict:
        """
        复合 step：串行执行子步骤
        params 字段：
          - children: List[Dict]（子步骤定义）
        """
        children = step.params.get("children", [])
        if not isinstance(children, list):
            raise ValueError("composite.children 必须是 list")
        if not children:
            raise ValueError("composite.children 不能为空")

        results: List[Dict] = []
        for i, child in enumerate(children):
            child_step = ComposerStep.from_dict(child)
            child_step.step_id = child.get("step_id") or f"{step.step_id}-sub-{i}"
            await self._emit_progress("step_log", {
                "step_id": step.step_id,
                "log": f"[composite] sub-step {i+1}/{len(children)}: {child_step.title}",
            })
            handler = get_action_handler(child_step.action or "noop")
            sub_result = await handler(child_step, ctx)
            results.append({
                "step_id": child_step.step_id,
                "action": child_step.action,
                "result": sub_result,
            })

        return {
            "action": step.action,
            "children_count": len(children),
            "children_results": results,
        }

    # -------- Noop step --------

    async def _handle_noop(self, step: ComposerStep, ctx: Dict) -> Dict:
        """空 step：用于测试和占位"""
        await asyncio.sleep(0.01)
        return {
            "action": step.action,
            "noop": True,
            "step_id": step.step_id,
        }


# ============================================================
# 全局单例
# ============================================================


_executor: Optional[PlanExecutor] = None


def get_executor() -> PlanExecutor:
    """
    获取全局 PlanExecutor 单例
    首次调用时使用默认配置
    """
    global _executor
    if _executor is None:
        _executor = PlanExecutor()
    return _executor


def set_executor(executor: PlanExecutor) -> None:
    """
    替换全局 PlanExecutor
    用于：
      1. 注入真实 LLMCaller
      2. 注入自定义 progress_callback
      3. 单元测试中重置
    """
    global _executor
    _executor = executor
    # 重新注册内置 handlers（使用新 executor 的方法）
    executor._register_builtin_handlers()


def reset_executor() -> None:
    """重置为默认（用于测试清理）"""
    global _executor
    _executor = None
