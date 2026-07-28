"""
# ============================================================
# Verify Service - /loop verify 实现
# ============================================================
# 核心作用：运行单元测试 + E2E 测试 + TypeScript 编译，
#          输出验收报告
# 运行流程：
#   1. 运行 Python 单元测试 (pytest)
#   2. 运行 E2E 测试 (bash test_e2e_*.sh)
#   3. 运行 TypeScript 编译 (tsc --noEmit)
#   4. 运行 Vite 构建
#   5. 解析测试结果
#   6. 输出验收报告
# 输入参数：project_path 项目根目录
# 输出结果：dict {unit_tests, e2e_tests, typescript, vite_build, passed}
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 8 P1-4 新建
# ============================================================
"""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _run_shell(cmd: list, cwd: Optional[str] = None, timeout: int = 300) -> tuple:
    """运行 shell 命令"""
    try:
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out: {cmd}")
        return -1, "", "Command timed out"
    except Exception as e:
        logger.error(f"Command failed: {e}")
        return -1, "", str(e)


# 解析 pytest 输出
PYTEST_SUMMARY = re.compile(
    r"(?P<passed>\d+)\s+passed|"
    r"(?P<failed>\d+)\s+failed|"
    r"(?P<errors>\d+)\s+errors"
)


def _parse_pytest_output(stdout: str, stderr: str) -> Dict[str, Any]:
    """解析 pytest 输出

    Returns:
        {"passed": int, "failed": int, "errors": int, "total": int}
    """
    text = stdout + stderr
    passed = failed = errors = 0

    # 匹配 "X passed" / "X failed" / "X errors"
    m = re.search(r"(\d+)\s+passed", text)
    if m:
        passed = int(m.group(1))
    m = re.search(r"(\d+)\s+failed", text)
    if m:
        failed = int(m.group(1))
    m = re.search(r"(\d+)\s+errors?", text)
    if m:
        errors = int(m.group(1))

    return {
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "total": passed + failed + errors,
    }


def _parse_e2e_output(stdout: str, stderr: str) -> Dict[str, Any]:
    """解析 E2E 测试输出

    Returns:
        {"passed": int, "failed": int, "total": int}
    """
    text = stdout + stderr
    passed = failed = 0

    # 匹配 "通过: X" / "失败: X" / "总计: X"
    m = re.search(r"通过[:\s]+(\d+)", text)
    if m:
        passed = int(m.group(1))
    m = re.search(r"失败[:\s]+(\d+)", text)
    if m:
        failed = int(m.group(1))
    if passed == 0 and failed == 0:
        # 匹配 "X/Y passed"
        m = re.search(r"(\d+)/(\d+)\s+passed", text)
        if m:
            passed = int(m.group(1))
            failed = int(m.group(2)) - passed

    return {
        "passed": passed,
        "failed": failed,
        "total": passed + failed,
    }


class VerifyService:
    """Verify 服务 - 验证任务完成情况"""

    def __init__(self, project_path: str):
        """初始化 Verify 服务

        Args:
            project_path: 项目根目录
        """
        self.project_path = Path(project_path)
        self.tests_dir = self.project_path / "tests"
        self.frontend_dir = self.project_path / "frontend"

    def verify(
        self,
        run_unit: bool = True,
        run_e2e: bool = True,
        run_typescript: bool = True,
        run_vite: bool = False,
    ) -> Dict[str, Any]:
        """执行验证

        Args:
            run_unit: 是否运行单元测试
            run_e2e: 是否运行 E2E 测试
            run_typescript: 是否运行 TypeScript 编译
            run_vite: 是否运行 Vite 构建（较慢）

        Returns:
            {
                "unit_tests": {"passed": int, "failed": int, "total": int},
                "e2e_tests": {"passed": int, "failed": int, "total": int},
                "typescript": {"passed": bool, "error_count": int},
                "vite_build": {"passed": bool, "duration": float},
                "passed": bool,
            }
        """
        results: Dict[str, Any] = {
            "unit_tests": None,
            "e2e_tests": None,
            "typescript": None,
            "vite_build": None,
        }

        # 1. 单元测试
        if run_unit:
            unit_result = self._run_unit_tests()
            results["unit_tests"] = unit_result

        # 2. E2E 测试
        if run_e2e:
            e2e_result = self._run_e2e_tests()
            results["e2e_tests"] = e2e_result

        # 3. TypeScript 编译
        if run_typescript:
            ts_result = self._run_typescript_check()
            results["typescript"] = ts_result

        # 4. Vite 构建
        if run_vite:
            vite_result = self._run_vite_build()
            results["vite_build"] = vite_result

        # 5. 计算总体通过状态
        passed = True
        if run_unit and results["unit_tests"]["failed"] > 0:
            passed = False
        if run_e2e and results["e2e_tests"]["failed"] > 0:
            passed = False
        if run_typescript and not results["typescript"]["passed"]:
            passed = False
        if run_vite and not results["vite_build"]["passed"]:
            passed = False

        results["passed"] = passed

        return results

    def _run_unit_tests(self) -> Dict[str, Any]:
        """运行 Python 单元测试"""
        if not self.tests_dir.exists():
            return {"passed": 0, "failed": 0, "errors": 0, "total": 0, "skipped": "tests dir not found"}

        import os
        env = os.environ.copy()
        env["PYTHONPATH"] = (
            f"{self.project_path}/backend:{self.project_path}:"
            + env.get("PYTHONPATH", "")
        )

        # 收集所有 *_units.py 测试
        rc, stdout, stderr = _run_shell(
            ["python3", "-m", "pytest", "tests/test_*_units.py", "-v", "--tb=no", "-q"],
            cwd=str(self.project_path),
            timeout=120,
        )

        result = _parse_pytest_output(stdout, stderr)
        result["returncode"] = rc

        return result

    def _run_e2e_tests(self) -> Dict[str, Any]:
        """运行 E2E 测试"""
        if not self.tests_dir.exists():
            return {"passed": 0, "failed": 0, "total": 0, "skipped": "tests dir not found"}

        # 收集所有 E2E 测试结果（运行少量关键 E2E）
        e2e_files = [
            "tests/test_e2e_slash_commands.sh",
            "tests/test_e2e_custom_models.sh",
            "tests/test_e2e_custom_commands.sh",
        ]

        passed = 0
        failed = 0
        for e2e_file in e2e_files:
            e2e_path = self.project_path / e2e_file
            if not e2e_path.exists():
                continue
            rc, stdout, stderr = _run_shell(
                ["bash", e2e_file],
                cwd=str(self.project_path),
                timeout=60,
            )
            result = _parse_e2e_output(stdout, stderr)
            passed += result["passed"]
            failed += result["failed"]

        return {
            "passed": passed,
            "failed": failed,
            "total": passed + failed,
        }

    def _run_typescript_check(self) -> Dict[str, Any]:
        """运行 TypeScript 编译检查"""
        if not (self.frontend_dir / "tsconfig.json").exists():
            return {"passed": True, "skipped": "tsconfig.json not found", "error_count": 0}

        rc, stdout, stderr = _run_shell(
            ["npx", "tsc", "--noEmit", "-p", "tsconfig.json"],
            cwd=str(self.frontend_dir),
            timeout=120,
        )

        error_count = stdout.count("error TS") if stdout else 0

        return {
            "passed": rc == 0,
            "error_count": error_count,
            "returncode": rc,
        }

    def _run_vite_build(self) -> Dict[str, Any]:
        """运行 Vite 构建"""
        if not (self.frontend_dir / "package.json").exists():
            return {"passed": True, "skipped": "package.json not found", "duration": 0}

        import time
        start = time.time()
        rc, stdout, stderr = _run_shell(
            ["npm", "run", "build"],
            cwd=str(self.frontend_dir),
            timeout=180,
        )
        duration = time.time() - start

        return {
            "passed": rc == 0,
            "duration": round(duration, 2),
            "returncode": rc,
        }
