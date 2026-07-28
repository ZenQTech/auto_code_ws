"""
# ============================================================
# Hermes Doctor - 基础模块
# ============================================================
# 核心作用：定义 doctor 系统的数据模型、基类、工具函数
# 运行流程：
#   1. 数据模型：CheckItem / CategoryReport / DoctorReport / FixSuggestion
#   2. 基类：BaseChecker（所有诊断器的抽象基类）
#   3. 工具：路径白名单、敏感信息脱敏、超时控制
# 输出结果：可供 6 个 checker 共用的基类和工具
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import threading
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple


# ============================================================
# 状态枚举
# ============================================================
class CheckStatus(str, Enum):
    """检查项状态"""
    OK = "ok"
    WARNING = "warning"
    ERROR = "error"
    SKIPPED = "skipped"


# 状态严重度（用于排序）
_STATUS_SEVERITY = {
    CheckStatus.ERROR: 3,
    CheckStatus.WARNING: 2,
    CheckStatus.SKIPPED: 1,
    CheckStatus.OK: 0,
}


def _status_severity(s: str) -> int:
    """获取状态严重度（用于排序）"""
    return _STATUS_SEVERITY.get(CheckStatus(s), 0)


# ============================================================
# 数据模型
# ============================================================
@dataclass
class CheckItem:
    """单个检查项"""
    id: str
    name: str
    category: str
    description: str
    status: str  # ok / warning / error / skipped
    value: Optional[str] = None
    expected: Optional[str] = None
    message: str = ""
    fix_suggestion: Optional[str] = None
    duration_ms: int = 0
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class FixSuggestion:
    """修复建议"""
    check_id: str
    title: str
    steps: List[str]
    risk_level: str = "low"  # low / medium / high
    automated: bool = False
    estimated_time: str = "1m"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CategoryReport:
    """单类诊断报告"""
    category: str
    title: str
    total_checks: int = 0
    ok_count: int = 0
    warning_count: int = 0
    error_count: int = 0
    skipped_count: int = 0
    duration_ms: int = 0
    overall_status: str = "ok"
    items: List[CheckItem] = field(default_factory=list)
    error: Optional[str] = None

    def add_item(self, item: CheckItem) -> None:
        """添加检查项并更新计数"""
        self.items.append(item)
        self.total_checks += 1
        s = item.status
        if s == CheckStatus.OK.value:
            self.ok_count += 1
        elif s == CheckStatus.WARNING.value:
            self.warning_count += 1
        elif s == CheckStatus.ERROR.value:
            self.error_count += 1
        elif s == CheckStatus.SKIPPED.value:
            self.skipped_count += 1

    def finalize(self) -> None:
        """根据统计计算 overall_status"""
        if self.error_count > 0:
            self.overall_status = CheckStatus.ERROR.value
        elif self.warning_count > 0:
            self.overall_status = CheckStatus.WARNING.value
        elif self.ok_count == 0 and self.total_checks > 0:
            self.overall_status = CheckStatus.SKIPPED.value
        else:
            self.overall_status = CheckStatus.OK.value

    def to_dict(self) -> Dict[str, Any]:
        return {
            "category": self.category,
            "title": self.title,
            "total_checks": self.total_checks,
            "ok_count": self.ok_count,
            "warning_count": self.warning_count,
            "error_count": self.error_count,
            "skipped_count": self.skipped_count,
            "duration_ms": self.duration_ms,
            "overall_status": self.overall_status,
            "items": [item.to_dict() for item in self.items],
            "error": self.error,
        }


@dataclass
class DoctorReport:
    """完整诊断报告"""
    report_id: str
    timestamp: str
    hostname: str
    hermes_version: str
    duration_ms: int = 0
    overall_status: str = "ok"
    categories: Dict[str, CategoryReport] = field(default_factory=dict)
    summary: Dict[str, int] = field(default_factory=dict)

    def finalize(self) -> None:
        """计算总状态和汇总"""
        total = {"ok": 0, "warning": 0, "error": 0, "skipped": 0}
        for cat in self.categories.values():
            total["ok"] += cat.ok_count
            total["warning"] += cat.warning_count
            total["error"] += cat.error_count
            total["skipped"] += cat.skipped_count
        total["total"] = sum(v for k, v in total.items() if k != "total")
        self.summary = total

        if total["error"] > 0:
            self.overall_status = CheckStatus.ERROR.value
        elif total["warning"] > 0:
            self.overall_status = CheckStatus.WARNING.value
        else:
            self.overall_status = CheckStatus.OK.value

    def to_dict(self) -> Dict[str, Any]:
        return {
            "report_id": self.report_id,
            "timestamp": self.timestamp,
            "hostname": self.hostname,
            "hermes_version": self.hermes_version,
            "duration_ms": self.duration_ms,
            "overall_status": self.overall_status,
            "summary": self.summary,
            "categories": {k: v.to_dict() for k, v in self.categories.items()},
        }


# ============================================================
# 工具函数
# ============================================================
SENSITIVE_KEYS = {
    "api_key", "apikey", "secret", "token", "password",
    "auth", "credential", "private_key", "access_key",
}


def _redact_value(key: str, value: str) -> str:
    """脱敏敏感字段值"""
    if not value:
        return ""
    key_lower = key.lower()
    if any(s in key_lower for s in SENSITIVE_KEYS):
        if len(value) <= 8:
            return "***"
        return f"{value[:4]}***{value[-2:]}"
    return value


def _run_command(
    cmd: List[str],
    timeout: float = 5.0,
    cwd: Optional[Path] = None,
) -> Tuple[int, str, str]:
    """
    运行 shell 命令并返回 (returncode, stdout, stderr)
    超时控制：超过 timeout 秒强制终止
    """
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd) if cwd else None,
            check=False,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"command timeout after {timeout}s"
    except FileNotFoundError as e:
        return -1, "", f"command not found: {e}"
    except Exception as e:
        return -1, "", f"command error: {e}"


def _get_command_output(cmd: List[str], timeout: float = 5.0) -> Optional[str]:
    """获取命令输出（去除空白），失败返回 None"""
    rc, stdout, _ = _run_command(cmd, timeout=timeout)
    if rc == 0 and stdout.strip():
        return stdout.strip()
    return None


def _parse_version(version_str: str) -> Tuple[int, ...]:
    """解析版本号为元组 (major, minor, patch)"""
    if not version_str:
        return (0,)
    # 提取第一个 x.y.z 模式
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", version_str)
    if m:
        third = m.group(3)
        if third is not None:
            return (int(m.group(1)), int(m.group(2)), int(third))
        return (int(m.group(1)), int(m.group(2)))
    # 仅 major
    m = re.search(r"(\d+)", version_str)
    if m:
        return (int(m.group(1)),)
    return (0,)


def _compare_versions(current: str, required: str) -> int:
    """
    比较版本
    返回值：1 = current >= required，0 = current < required
    """
    cur = _parse_version(current)
    req = _parse_version(required)
    # 补齐到相同长度
    while len(cur) < len(req):
        cur = cur + (0,)
    while len(req) < len(cur):
        req = req + (0,)
    return 1 if cur >= req else 0


def _check_command_exists(cmd: str) -> bool:
    """检查命令是否在 PATH 中"""
    if not cmd:
        return False
    # 绝对路径：直接检查文件
    if cmd.startswith("/") or cmd.startswith("./") or cmd.startswith("../"):
        return Path(cmd).exists()
    # 命令名：通过 shutil.which 查找
    return shutil.which(cmd) is not None


def _check_port_reachable(host: str, port: int, timeout: float = 2.0) -> bool:
    """检查 TCP 端口可达"""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _check_http_reachable(url: str, timeout: float = 2.0) -> Tuple[bool, int, str]:
    """检查 HTTP URL 可达性，返回 (success, status_code, error)"""
    try:
        import httpx
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url)
            return True, resp.status_code, ""
    except ImportError:
        return _check_http_reachable_urllib(url, timeout)
    except Exception as e:
        return False, 0, str(e)


def _check_http_reachable_urllib(url: str, timeout: float = 2.0) -> Tuple[bool, int, str]:
    """urllib 兜底 HTTP 检查"""
    try:
        import urllib.request
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return True, resp.status, ""
    except Exception as e:
        return False, 0, str(e)


# ============================================================
# 基类：所有 checker 继承
# ============================================================
class BaseChecker(ABC):
    """
    诊断器基类
    子类需实现：
      - category: 分类标识
      - title: 分类标题
      - run_checks(): 返回 List[CheckItem]
    """

    category: str = "base"
    title: str = "基础检查"
    default_timeout: float = 5.0

    def __init__(self, hermes_home: Optional[Path] = None, project_path: Optional[Path] = None):
        """
        参数：
          - hermes_home: ~/.hermes 路径
          - project_path: 项目工作目录
        """
        self.hermes_home = hermes_home or Path.home() / ".hermes"
        self.project_path = project_path or Path.cwd()
        self._items: List[CheckItem] = []

    @abstractmethod
    def run_checks(self) -> List[CheckItem]:
        """执行所有检查，返回 CheckItem 列表"""
        ...

    def make_item(
        self,
        check_id: str,
        name: str,
        description: str,
        status: str,
        message: str = "",
        value: Optional[str] = None,
        expected: Optional[str] = None,
        fix_suggestion: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        duration_ms: int = 0,
    ) -> CheckItem:
        """便捷创建 CheckItem"""
        # 自动脱敏 value
        if value and any(s in check_id.lower() for s in ("api_key", "token", "secret", "password")):
            value = _redact_value(check_id, value)
        return CheckItem(
            id=check_id,
            name=name,
            category=self.category,
            description=description,
            status=status,
            value=value,
            expected=expected,
            message=message,
            fix_suggestion=fix_suggestion,
            duration_ms=duration_ms,
            details=details or {},
        )

    def run_with_timeout(self, timeout: Optional[float] = None) -> CategoryReport:
        """带超时控制的运行"""
        timeout = timeout or self.default_timeout
        start = time.time()
        report = CategoryReport(category=self.category, title=self.title)

        def _runner():
            try:
                items = self.run_checks()
                for item in items:
                    report.add_item(item)
            except Exception as e:
                report.error = f"{type(e).__name__}: {e}"
                # 创建一个 error 状态检查项
                report.add_item(self.make_item(
                    check_id=f"{self.category}.runner_error",
                    name="Runner Error",
                    description=f"诊断器 {self.category} 执行失败",
                    status=CheckStatus.ERROR.value,
                    message=str(e),
                    fix_suggestion="检查日志并重试",
                ))

        thread = threading.Thread(target=_runner, daemon=True)
        thread.start()
        thread.join(timeout=timeout)
        if thread.is_alive():
            report.error = f"checker timeout after {timeout}s"
            report.add_item(self.make_item(
                check_id=f"{self.category}.timeout",
                name="Timeout",
                description=f"诊断器 {self.category} 超时",
                status=CheckStatus.WARNING.value,
                message=f"执行超过 {timeout}s",
                fix_suggestion="减小检查范围或增加超时",
            ))

        report.duration_ms = int((time.time() - start) * 1000)
        report.finalize()
        return report


# ============================================================
# 报告 ID 生成
# ============================================================
def generate_report_id() -> str:
    """生成报告 ID: doc_YYYYMMDD_HHMMSS_xxxx"""
    ts = time.strftime("%Y%m%d_%H%M%S")
    suffix = uuid.uuid4().hex[:6]
    return f"doc_{ts}_{suffix}"


def get_hostname() -> str:
    """获取主机名"""
    try:
        return socket.gethostname()
    except Exception:
        return "unknown"


def get_python_version() -> str:
    """获取 Python 版本"""
    return platform.python_version()


def get_platform_info() -> str:
    """获取平台信息"""
    return f"{platform.system()} {platform.release()} ({platform.machine()})"


def get_shell_info() -> str:
    """获取当前 shell"""
    return os.environ.get("SHELL", "unknown")
