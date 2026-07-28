"""
# ============================================================
# Environment Checker - 环境检查
# ============================================================
# 检查项：python_version / node_version / git_version / os / shell /
#        encoding / anthropic_api_key / anthropic_base_url / home_dir / hermes_home
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path
from typing import List

from ..base import (
    BaseChecker,
    CheckItem,
    CheckStatus,
    _check_command_exists,
    _get_command_output,
    _redact_value,
)


class EnvironmentChecker(BaseChecker):
    """环境检查器"""

    category = "environment"
    title = "环境变量"
    default_timeout = 10.0

    def run_checks(self) -> List[CheckItem]:
        items: List[CheckItem] = []
        items.append(self._check_python())
        items.append(self._check_node())
        items.append(self._check_git())
        items.append(self._check_os())
        items.append(self._check_shell())
        items.append(self._check_encoding())
        items.append(self._check_anthropic_api_key())
        items.append(self._check_anthropic_base_url())
        items.append(self._check_home_dir())
        items.append(self._check_hermes_home())
        return items

    def _check_python(self) -> CheckItem:
        """Python 版本检查"""
        v = platform.python_version()
        ok = sys.version_info >= (3, 10)
        return self.make_item(
            check_id="environment.python_version",
            name="Python Version",
            description="Python 解释器版本",
            status=CheckStatus.OK.value if ok else CheckStatus.ERROR.value,
            value=v,
            expected=">=3.10",
            message=f"当前 Python {v}" + ("" if ok else "，需要 3.10+"),
            fix_suggestion="升级 Python 到 3.10+",
        )

    def _check_node(self) -> CheckItem:
        """Node.js 版本检查"""
        v = _get_command_output(["node", "--version"], timeout=3.0)
        if not v:
            return self.make_item(
                check_id="environment.node_version",
                name="Node.js Version",
                description="Node.js 运行时（前端构建需要）",
                status=CheckStatus.WARNING.value,
                value=None,
                expected=">=18.0",
                message="未检测到 Node.js，前端无法构建",
                fix_suggestion="安装 Node.js 18+",
            )
        # 提取版本号
        import re
        m = re.search(r"v?(\d+\.\d+\.\d+)", v)
        version_str = m.group(1) if m else v
        major = int(m.group(1).split(".")[0]) if m else 0
        ok = major >= 18
        return self.make_item(
            check_id="environment.node_version",
            name="Node.js Version",
            description="Node.js 运行时（前端构建需要）",
            status=CheckStatus.OK.value if ok else CheckStatus.WARNING.value,
            value=version_str,
            expected=">=18.0",
            message=f"Node.js {version_str}",
            fix_suggestion="升级 Node.js 到 18+" if not ok else None,
        )

    def _check_git(self) -> CheckItem:
        """Git 版本检查"""
        v = _get_command_output(["git", "--version"], timeout=3.0)
        if not v:
            return self.make_item(
                check_id="environment.git_version",
                name="Git Version",
                description="Git 版本控制",
                status=CheckStatus.ERROR.value,
                value=None,
                expected=">=2.30",
                message="未检测到 Git",
                fix_suggestion="安装 Git",
            )
        import re
        m = re.search(r"(\d+\.\d+\.\d+)", v)
        version_str = m.group(1) if m else v
        # 简单比较
        parts = version_str.split(".")
        major = int(parts[0]) if parts else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
        ok = (major, minor) >= (2, 30)
        return self.make_item(
            check_id="environment.git_version",
            name="Git Version",
            description="Git 版本控制",
            status=CheckStatus.OK.value if ok else CheckStatus.WARNING.value,
            value=version_str,
            expected=">=2.30",
            message=f"Git {version_str}",
            fix_suggestion="升级 Git 到 2.30+" if not ok else None,
        )

    def _check_os(self) -> CheckItem:
        """操作系统检查"""
        info = f"{platform.system()} {platform.release()}"
        supported = platform.system() in ("Linux", "Darwin")
        # WSL 检测
        is_wsl = "microsoft" in platform.release().lower() or "WSL" in platform.release()
        if is_wsl:
            supported = True
        return self.make_item(
            check_id="environment.os",
            name="Operating System",
            description="操作系统",
            status=CheckStatus.OK.value if supported else CheckStatus.ERROR.value,
            value=info,
            expected="Linux/macOS/WSL2",
            message=info,
            fix_suggestion="切换到 Linux/macOS/WSL2" if not supported else None,
        )

    def _check_shell(self) -> CheckItem:
        """Shell 检查"""
        shell = os.environ.get("SHELL", "unknown")
        supported = any(s in shell for s in ("bash", "zsh", "sh"))
        return self.make_item(
            check_id="environment.shell",
            name="Shell",
            description="当前 Shell",
            status=CheckStatus.OK.value if supported else CheckStatus.WARNING.value,
            value=shell,
            expected="bash/zsh",
            message=f"当前 shell: {shell}",
            fix_suggestion="切换到 bash 或 zsh" if not supported else None,
        )

    def _check_encoding(self) -> CheckItem:
        """编码检查"""
        encoding = (
            os.environ.get("LANG", "")
            or os.environ.get("LC_ALL", "")
            or sys.getdefaultencoding()
        )
        ok = "UTF-8" in encoding.upper() or "utf8" in encoding.lower()
        return self.make_item(
            check_id="environment.encoding",
            name="Character Encoding",
            description="字符编码",
            status=CheckStatus.OK.value if ok else CheckStatus.WARNING.value,
            value=encoding,
            expected="UTF-8",
            message=f"当前编码: {encoding}",
            fix_suggestion="export LANG=en_US.UTF-8" if not ok else None,
        )

    def _check_anthropic_api_key(self) -> CheckItem:
        """ANTHROPIC_API_KEY 检查"""
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if key:
            return self.make_item(
                check_id="environment.anthropic_api_key",
                name="ANTHROPIC_API_KEY",
                description="Anthropic API 密钥",
                status=CheckStatus.OK.value,
                value=_redact_value("api_key", key),
                expected="已设置",
                message="API 密钥已设置",
            )
        return self.make_item(
            check_id="environment.anthropic_api_key",
            name="ANTHROPIC_API_KEY",
            description="Anthropic API 密钥",
            status=CheckStatus.ERROR.value,
            value=None,
            expected="已设置",
            message="ANTHROPIC_API_KEY 未设置",
            fix_suggestion="export ANTHROPIC_API_KEY=sk-ant-...",
        )

    def _check_anthropic_base_url(self) -> CheckItem:
        """ANTHROPIC_BASE_URL 检查"""
        url = os.environ.get("ANTHROPIC_BASE_URL", "")
        if not url:
            return self.make_item(
                check_id="environment.anthropic_base_url",
                name="ANTHROPIC_BASE_URL",
                description="Anthropic API 网关地址",
                status=CheckStatus.WARNING.value,
                value=None,
                expected="已设置",
                message="ANTHROPIC_BASE_URL 未设置，将使用默认值",
                fix_suggestion="export ANTHROPIC_BASE_URL=https://api.anthropic.com",
            )
        # URL 格式校验
        if not (url.startswith("http://") or url.startswith("https://")):
            return self.make_item(
                check_id="environment.anthropic_base_url",
                name="ANTHROPIC_BASE_URL",
                description="Anthropic API 网关地址",
                status=CheckStatus.WARNING.value,
                value=url,
                expected="http(s)://...",
                message=f"URL 格式异常: {url}",
                fix_suggestion="修正 URL 格式",
            )
        return self.make_item(
            check_id="environment.anthropic_base_url",
            name="ANTHROPIC_BASE_URL",
            description="Anthropic API 网关地址",
            status=CheckStatus.OK.value,
            value=url,
            expected="已设置",
            message=f"API 网关: {url}",
        )

    def _check_home_dir(self) -> CheckItem:
        """$HOME 目录检查"""
        home = Path.home()
        try:
            writable = os.access(home, os.W_OK)
            exists = home.exists()
        except Exception:
            writable = False
            exists = False
        ok = writable and exists
        return self.make_item(
            check_id="environment.home_dir",
            name="$HOME Directory",
            description="用户主目录",
            status=CheckStatus.OK.value if ok else CheckStatus.ERROR.value,
            value=str(home),
            expected="存在且可写",
            message=f"$HOME={home} (可写: {writable})",
            fix_suggestion="chmod 755 $HOME" if not ok else None,
        )

    def _check_hermes_home(self) -> CheckItem:
        """~/.hermes 目录检查"""
        if not self.hermes_home.exists():
            return self.make_item(
                check_id="environment.hermes_home",
                name="Hermes Home",
                description="Hermes 配置目录",
                status=CheckStatus.WARNING.value,
                value=None,
                expected="~/.hermes",
                message=f"{self.hermes_home} 不存在，首次运行时会自动创建",
                fix_suggestion="mkdir -p ~/.hermes",
            )
        return self.make_item(
            check_id="environment.hermes_home",
            name="Hermes Home",
            description="Hermes 配置目录",
            status=CheckStatus.OK.value,
            value=str(self.hermes_home),
            expected="已初始化",
            message=f"Hermes Home: {self.hermes_home}",
        )
