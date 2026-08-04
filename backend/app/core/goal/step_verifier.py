"""
# ============================================================
# Step Verifier - Step 自动验证服务 (v1.0.0)
# Cycle 61 G61-02 - Goal mode 完整循环 UI
# # ============================================================
# 核心作用：为 Plan 中的每个 Step 提供自动验证能力
#           支持多种验证类型：command / file / llm_judge / custom
# 运行流程：
#   1. Step 执行完成后，触发 verify
#   2. 根据 verify_type 选择验证策略
#   3. 返回 VerifyResult (passed / failed + reason)
#   4. 与 VerifyItem 关联（可选）
# 设计要点：
#   - 4 种验证类型可插拔
#   - 超时控制
#   - 失败重试 + 详细错误信息
#   - 与 Goal.verify_item 体系集成
# 输入参数：step, verify_type, target, expected, timeout
# 输出结果：VerifyResult (passed, reason, duration_ms, details)
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-02 初次创建
# ====================================
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, Optional

from .plan import PlanStep, StepStatus
from .verify_item import VerifyItem, VerifyResult, VerifyStatus, VerifyType

logger = logging.getLogger(__name__)


class VerifierError(Exception):
    """Verifier 错误基类"""


class CommandTimeoutError(VerifierError):
    """命令执行超时"""


class FileNotFoundError_(VerifierError):
    """文件不存在"""


@dataclass
class StepVerifyResult:
    """Step 验证结果"""

    step_id: str
    passed: bool
    reason: str = ""
    duration_ms: int = 0
    details: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step_id": self.step_id,
            "passed": self.passed,
            "reason": self.reason,
            "duration_ms": self.duration_ms,
            "details": self.details,
            "error": self.error,
        }


class StepVerifier:
    """Step 自动验证器"""

    def __init__(self, default_timeout: int = 60) -> None:
        self.default_timeout = default_timeout
        # 自定义验证器回调
        self._custom_verifiers: Dict[str, Callable[..., Awaitable[StepVerifyResult]]] = {}

    def register_custom(
        self,
        name: str,
        callback: Callable[..., Awaitable[StepVerifyResult]],
    ) -> None:
        """注册自定义验证器"""
        self._custom_verifiers[name] = callback

    async def verify_step(
        self,
        step: PlanStep,
        verify_type: str = "command",
        target: str = "",
        expected: str = "",
        timeout: int = 0,
    ) -> StepVerifyResult:
        """
        验证 Step

        参数:
            step: PlanStep 实例
            verify_type: command / file / exists / contains / llm_judge / custom
            target: 验证目标（命令/文件路径/字符串）
            expected: 期望值
            timeout: 超时（秒），0 表示使用默认

        返回:
            StepVerifyResult
        """
        start = time.time()
        effective_timeout = timeout if timeout > 0 else self.default_timeout
        verify_type_lower = verify_type.lower()

        try:
            if verify_type_lower == "command":
                result = await self._verify_command(target, expected, effective_timeout)
            elif verify_type_lower == "file":
                result = await self._verify_file(target, expected, effective_timeout)
            elif verify_type_lower == "exists":
                result = self._verify_exists(target)
            elif verify_type_lower == "contains":
                result = self._verify_contains(target, expected)
            elif verify_type_lower == "llm_judge":
                result = await self._verify_llm_judge(target, expected, effective_timeout)
            elif verify_type_lower == "custom":
                result = await self._verify_custom(step, target, expected)
            else:
                return StepVerifyResult(
                    step_id=step.step_id,
                    passed=False,
                    reason=f"未知的验证类型: {verify_type}",
                    duration_ms=int((time.time() - start) * 1000),
                    error=f"Unknown verify_type: {verify_type}",
                )

            result.step_id = step.step_id
            result.duration_ms = int((time.time() - start) * 1000)
            return result
        except asyncio.TimeoutError as e:
            return StepVerifyResult(
                step_id=step.step_id,
                passed=False,
                reason=f"验证超时 ({effective_timeout}s)",
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )
        except VerifierError as e:
            return StepVerifyResult(
                step_id=step.step_id,
                passed=False,
                reason=str(e),
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )
        except Exception as e:
            logger.exception("verify_step unexpected error")
            return StepVerifyResult(
                step_id=step.step_id,
                passed=False,
                reason=f"验证异常: {e}",
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )

    async def _verify_command(
        self, command: str, expected: str, timeout: int
    ) -> StepVerifyResult:
        """执行 shell 命令并验证输出"""
        if not command:
            raise VerifierError("command 验证类型必须提供 target (shell 命令)")
        try:
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
                except Exception:
                    pass
                raise CommandTimeoutError(f"command timeout after {timeout}s") from e
            stdout_text = stdout.decode("utf-8", errors="replace")
            stderr_text = stderr.decode("utf-8", errors="replace")
            passed = proc.returncode == 0
            details = {
                "returncode": proc.returncode,
                "stdout": stdout_text[:5000],  # 截断防止过大
                "stderr": stderr_text[:2000],
            }
            if expected and expected not in stdout_text:
                passed = False
                details["expected_not_found"] = expected
            reason = (
                f"命令成功，returncode={proc.returncode}"
                if passed
                else f"命令失败，returncode={proc.returncode}, stderr={stderr_text[:200]}"
            )
            return StepVerifyResult(
                step_id="",
                passed=passed,
                reason=reason,
                details=details,
            )
        except CommandTimeoutError:
            raise
        except Exception as e:
            raise VerifierError(f"命令执行失败: {e}") from e

    async def _verify_file(
        self, file_path: str, expected: str, timeout: int
    ) -> StepVerifyResult:
        """验证文件内容（可选择 expected 子字符串）"""
        if not file_path:
            raise VerifierError("file 验证类型必须提供 target (文件路径)")
        if not os.path.exists(file_path):
            raise FileNotFoundError_(f"文件不存在: {file_path}")
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception as e:
            raise VerifierError(f"读取文件失败: {e}") from e
        if expected:
            passed = expected in content
            return StepVerifyResult(
                step_id="",
                passed=passed,
                reason=(
                    f"文件包含 '{expected}'"
                    if passed
                    else f"文件不包含 '{expected}'"
                ),
                details={
                    "file_path": file_path,
                    "size": len(content),
                    "expected_found": passed,
                },
            )
        return StepVerifyResult(
            step_id="",
            passed=True,
            reason=f"文件存在 ({len(content)} 字符)",
            details={"file_path": file_path, "size": len(content)},
        )

    def _verify_exists(self, target: str) -> StepVerifyResult:
        """验证文件/目录存在"""
        if not target:
            raise VerifierError("exists 验证类型必须提供 target (路径)")
        exists = os.path.exists(target)
        return StepVerifyResult(
            step_id="",
            passed=exists,
            reason=("存在" if exists else "不存在"),
            details={"path": target, "exists": exists},
        )

    def _verify_contains(self, target: str, expected: str) -> StepVerifyResult:
        """验证 target 字符串包含 expected"""
        if not target:
            raise VerifierError("contains 验证类型必须提供 target (字符串)")
        if not expected:
            raise VerifierError("contains 验证类型必须提供 expected (子串)")
        passed = expected in target
        return StepVerifyResult(
            step_id="",
            passed=passed,
            reason=(
                f"包含 '{expected}'" if passed else f"不包含 '{expected}'"
            ),
            details={"target_length": len(target), "expected": expected},
        )

    async def _verify_llm_judge(
        self, content: str, criteria: str, timeout: int
    ) -> StepVerifyResult:
        """使用 LLM Judge 验证（占位实现，依赖 LLM HTTP 调用）"""
        # 在没有 LLM 的情况下回退为 contains
        logger.info("LLM Judge 暂未启用，回退为 contains 验证")
        if not criteria:
            raise VerifierError("llm_judge 验证类型必须提供 expected (判定标准)")
        return self._verify_contains(content, criteria)

    async def _verify_custom(
        self, step: PlanStep, target: str, expected: str
    ) -> StepVerifyResult:
        """调用自定义验证器"""
        if target not in self._custom_verifiers:
            raise VerifierError(f"自定义验证器未注册: {target}")
        callback = self._custom_verifiers[target]
        return await callback(step, target, expected)


# ============================================================
# 全局单例
# ============================================================

_verifier_instance: Optional[StepVerifier] = None


def get_step_verifier() -> StepVerifier:
    """获取全局 StepVerifier 单例"""
    global _verifier_instance
    if _verifier_instance is None:
        _verifier_instance = StepVerifier()
    return _verifier_instance


def reset_step_verifier() -> None:
    """重置单例（仅供测试）"""
    global _verifier_instance
    _verifier_instance = None
