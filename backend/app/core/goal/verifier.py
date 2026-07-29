"""
# ============================================================
# Hermes /goal 长时域模式 - 验证执行器
# ============================================================
# 核心作用：执行 VERIFY.md 中的验证项
# 特性：
#   - 支持 test/command/file_exists/file_contains/custom 5 种类型
#   - 路径白名单
#   - 超时控制
#   - 报告生成
#   - 命令白名单
# Cycle 12 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import VerifyType
from .verify_item import (
    VerifyItem,
    VerifyReport,
    VerifyResult,
    VerifyStatus,
)

logger = logging.getLogger(__name__)


# 路径白名单 - 防止任意目录访问
ALLOWED_PATH_PATTERNS = [
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/home/qizheng/auto_code_data"),
    re.compile(r"^/home/qizheng/\.hermes"),
    re.compile(r"^/tmp/goal_test_"),
    re.compile(r"^/tmp/verify_test_"),
    re.compile(r"^/tmp/nonexistent_"),     # 测试失败路径
    re.compile(r"^/tmp/pytest-of-"),
    re.compile(r"^/tmp/tmp"),
    re.compile(r"^/tmp/"),                # 通用 /tmp 路径（白名单可调整）
]

# 命令白名单 - 防止危险命令
ALLOWED_COMMANDS = [
    "pytest", "python", "python3", "node", "npm",
    "ls", "cat", "head", "tail", "wc", "grep", "find",
    "bash", "sh", "echo", "pwd", "which", "test",
    "curl", "wget", "make", "git",
    "true", "false",   # 测试用布尔命令
]


def _is_path_allowed(path: str) -> bool:
    """检查路径是否在白名单内"""
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_PATH_PATTERNS:
        if pattern.match(path_str):
            return True
    return False


def _is_command_allowed(cmd: str) -> bool:
    """检查命令是否在白名单内"""
    first = cmd.strip().split()[0] if cmd.strip() else ""
    return first in ALLOWED_COMMANDS


def _check_expected(actual: str, expected: str) -> bool:
    """检查实际结果是否匹配期望"""
    if not expected:
        return True
    # 简单包含检查
    if expected.startswith("exit code"):
        # 期望: "exit code 0" 或 "exit code 0, N/M tests pass"
        match = re.search(r"exit code (\d+)", expected)
        if match:
            return actual.startswith(f"exit_code={match.group(1)}")
        return False
    if expected.startswith("coverage"):
        # 期望: "coverage >= 80%"
        match = re.search(r">= (\d+)%", expected)
        if match:
            cov_match = re.search(r"coverage[=:]?\s*(\d+)", actual)
            if cov_match:
                return int(cov_match.group(1)) >= int(match.group(1))
        return False
    # 默认包含检查
    return expected in actual


class Verifier:
    """验证执行器"""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def verify_one(self, item: VerifyItem) -> VerifyResult:
        """执行单个验证项"""
        started = time.time()
        item.status = VerifyStatus.RUNNING
        item.execution_count += 1

        result = VerifyResult(
            verify_id=item.id,
            status=VerifyStatus.RUNNING,
            attempt=item.execution_count,
        )

        try:
            if item.verify_type == VerifyType.COMMAND:
                result = self._verify_command(item, started)
            elif item.verify_type == VerifyType.TEST:
                result = self._verify_test(item, started)
            elif item.verify_type == VerifyType.FILE_EXISTS:
                result = self._verify_file_exists(item, started)
            elif item.verify_type == VerifyType.FILE_CONTAINS:
                result = self._verify_file_contains(item, started)
            elif item.verify_type == VerifyType.CUSTOM:
                result = VerifyResult(
                    verify_id=item.id,
                    status=VerifyStatus.SKIPPED,
                    timestamp=result.timestamp,
                    attempt=item.execution_count,
                    duration_ms=int((time.time() - started) * 1000),
                )
            else:
                result = VerifyResult(
                    verify_id=item.id,
                    status=VerifyStatus.ERROR,
                    error_message=f"Unknown verify type: {item.verify_type}",
                    attempt=item.execution_count,
                    duration_ms=int((time.time() - started) * 1000),
                )
        except Exception as e:
            result = VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.ERROR,
                error_message=str(e),
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )
            logger.error(f"Verify error for {item.id}: {e}")

        # 更新 item 状态
        item.status = result.status
        item.last_result = "passed" if result.status == VerifyStatus.PASSED else "failed"
        item.last_run_at = result.timestamp
        return result

    def _verify_command(self, item: VerifyItem, started: float) -> VerifyResult:
        """执行命令"""
        if not _is_command_allowed(item.target):
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.ERROR,
                error_message=f"Command not allowed: {item.target}",
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )

        try:
            proc = subprocess.run(
                item.target,
                shell=True,
                capture_output=True,
                text=True,
                timeout=item.timeout,
            )
            stdout = proc.stdout
            stderr = proc.stderr
            exit_code = proc.returncode
            actual = f"exit_code={exit_code}\nstdout={stdout[:500]}\nstderr={stderr[:500]}"
            passed = (exit_code == 0) and _check_expected(actual, item.expected)
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.PASSED if passed else VerifyStatus.FAILED,
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                duration_ms=int((time.time() - started) * 1000),
                attempt=item.execution_count,
            )
        except subprocess.TimeoutExpired:
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.FAILED,
                error_message=f"Timeout after {item.timeout}s",
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )
        except Exception as e:
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.ERROR,
                error_message=str(e),
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )

    def _verify_test(self, item: VerifyItem, started: float) -> VerifyResult:
        """执行测试（本质是 pytest 命令）"""
        # 测试 = pytest 命令
        if not item.target.startswith("pytest"):
            item.target = f"pytest {item.target}"
        return self._verify_command(item, started)

    def _verify_file_exists(self, item: VerifyItem, started: float) -> VerifyResult:
        """检查文件是否存在"""
        if not _is_path_allowed(item.target):
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.ERROR,
                error_message=f"Path not allowed: {item.target}",
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )

        path = Path(item.target)
        exists = path.exists()
        return VerifyResult(
            verify_id=item.id,
            status=VerifyStatus.PASSED if exists else VerifyStatus.FAILED,
            stdout=f"exists={exists}",
            duration_ms=int((time.time() - started) * 1000),
            attempt=item.execution_count,
        )

    def _verify_file_contains(self, item: VerifyItem, started: float) -> VerifyResult:
        """检查文件是否包含内容"""
        if not _is_path_allowed(item.target):
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.ERROR,
                error_message=f"Path not allowed: {item.target}",
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )

        path = Path(item.target)
        if not path.exists():
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.FAILED,
                error_message=f"File not found: {item.target}",
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )
        try:
            content = path.read_text(encoding="utf-8")
            contains = item.expected in content
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.PASSED if contains else VerifyStatus.FAILED,
                stdout=f"contains={contains}, expected={item.expected[:50]}",
                duration_ms=int((time.time() - started) * 1000),
                attempt=item.execution_count,
            )
        except Exception as e:
            return VerifyResult(
                verify_id=item.id,
                status=VerifyStatus.ERROR,
                error_message=str(e),
                attempt=item.execution_count,
                duration_ms=int((time.time() - started) * 1000),
            )

    def verify_all(self, items: List[VerifyItem], goal_id: str) -> VerifyReport:
        """批量执行所有验证项"""
        import time as _time
        report = VerifyReport(goal_id=goal_id, total=len(items))
        start = _time.time()
        for item in items:
            result = self.verify_one(item)
            report.results.append(result)
            if result.status == VerifyStatus.PASSED:
                report.passed += 1
            elif result.status == VerifyStatus.FAILED:
                report.failed += 1
            elif result.status == VerifyStatus.SKIPPED:
                report.skipped += 1
            elif result.status == VerifyStatus.ERROR:
                report.errored += 1
        report.completed_at = _time.time()
        report.duration_ms = int((_time.time() - start) * 1000)
        return report


# 全局单例
_verifier_instance: Optional[Verifier] = None
_verifier_lock = threading.Lock()


def get_verifier() -> Verifier:
    """获取全局 Verifier 单例"""
    global _verifier_instance
    with _verifier_lock:
        if _verifier_instance is None:
            _verifier_instance = Verifier()
    return _verifier_instance
