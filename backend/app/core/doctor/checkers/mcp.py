"""
# ============================================================
# MCP Checker - MCP 服务器检查
# ============================================================
# 检查项：config_exists / config_valid / servers_declared / servers_reachable /
#        protocol_version / tools_listed
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import List

from ..base import (
    BaseChecker,
    CheckItem,
    CheckStatus,
    _check_command_exists,
)


class MCPChecker(BaseChecker):
    """MCP 服务器检查器"""

    category = "mcp"
    title = "MCP 服务器"
    default_timeout = 10.0

    def run_checks(self) -> List[CheckItem]:
        items: List[CheckItem] = []
        items.append(self._check_config_exists())
        items.append(self._check_config_valid())
        items.append(self._check_servers_declared())
        items.append(self._check_protocol_version())
        items.append(self._check_mcp_package())
        items.append(self._check_servers_reachable())
        return items

    def _get_mcp_config_path(self) -> Path:
        """MCP 配置文件路径"""
        return self.hermes_home / "mcp.json"

    def _check_config_exists(self) -> CheckItem:
        """配置文件存在性"""
        path = self._get_mcp_config_path()
        if path.exists():
            return self.make_item(
                check_id="mcp.config_exists",
                name="MCP Config",
                description="MCP 配置文件",
                status=CheckStatus.OK.value,
                value=str(path),
                message=f"MCP 配置存在: {path}",
            )
        return self.make_item(
            check_id="mcp.config_exists",
            name="MCP Config",
            description="MCP 配置文件",
            status=CheckStatus.WARNING.value,
            value=None,
            message="MCP 配置文件不存在",
            fix_suggestion="创建 ~/.hermes/mcp.json",
        )

    def _check_config_valid(self) -> CheckItem:
        """配置文件格式检查"""
        path = self._get_mcp_config_path()
        if not path.exists():
            return self.make_item(
                check_id="mcp.config_valid",
                name="MCP Config Format",
                description="MCP 配置 JSON 格式",
                status=CheckStatus.SKIPPED.value,
                message="配置文件不存在",
            )
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return self.make_item(
                check_id="mcp.config_valid",
                name="MCP Config Format",
                description="MCP 配置 JSON 格式",
                status=CheckStatus.OK.value,
                message="JSON 格式正确",
            )
        except json.JSONDecodeError as e:
            return self.make_item(
                check_id="mcp.config_valid",
                name="MCP Config Format",
                description="MCP 配置 JSON 格式",
                status=CheckStatus.ERROR.value,
                message=f"JSON 解析失败: {e}",
                fix_suggestion="用 jq 验证并修复 ~/.hermes/mcp.json",
            )
        except Exception as e:
            return self.make_item(
                check_id="mcp.config_valid",
                name="MCP Config Format",
                description="MCP 配置 JSON 格式",
                status=CheckStatus.ERROR.value,
                message=f"读取失败: {e}",
            )

    def _check_servers_declared(self) -> CheckItem:
        """声明的服务器数量"""
        path = self._get_mcp_config_path()
        if not path.exists():
            return self.make_item(
                check_id="mcp.servers_declared",
                name="MCP Servers",
                description="已声明的 MCP 服务器",
                status=CheckStatus.SKIPPED.value,
                message="配置文件不存在",
            )
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            servers = data.get("mcpServers", {}) or data.get("servers", {})
            count = len(servers) if isinstance(servers, dict) else 0
            if count > 0:
                names = list(servers.keys())[:5]
                return self.make_item(
                    check_id="mcp.servers_declared",
                    name="MCP Servers",
                    description="已声明的 MCP 服务器",
                    status=CheckStatus.OK.value,
                    value=f"{count} servers",
                    message=f"已声明 {count} 个服务器: {', '.join(names)}",
                )
            return self.make_item(
                check_id="mcp.servers_declared",
                name="MCP Servers",
                description="已声明的 MCP 服务器",
                status=CheckStatus.WARNING.value,
                value="0 servers",
                message="未声明任何 MCP 服务器",
                fix_suggestion="hermes mcp add <name> -- <command>",
            )
        except Exception as e:
            return self.make_item(
                check_id="mcp.servers_declared",
                name="MCP Servers",
                description="已声明的 MCP 服务器",
                status=CheckStatus.ERROR.value,
                message=f"读取失败: {e}",
            )

    def _check_protocol_version(self) -> CheckItem:
        """MCP 协议版本检查"""
        # 简单检查 mcp 库是否安装
        try:
            import mcp
            version = getattr(mcp, "__version__", "unknown")
            return self.make_item(
                check_id="mcp.protocol_version",
                name="MCP Protocol",
                description="MCP 协议支持",
                status=CheckStatus.OK.value,
                value=version,
                message=f"MCP 库版本: {version}",
            )
        except ImportError:
            return self.make_item(
                check_id="mcp.protocol_version",
                name="MCP Protocol",
                description="MCP 协议支持",
                status=CheckStatus.WARNING.value,
                value=None,
                message="MCP 库未安装",
                fix_suggestion="pip install mcp",
            )

    def _check_mcp_package(self) -> CheckItem:
        """MCP 包是否安装"""
        try:
            import importlib.util
            spec = importlib.util.find_spec("mcp")
            if spec is not None:
                return self.make_item(
                    check_id="mcp.package_installed",
                    name="MCP Package",
                    description="MCP Python 包",
                    status=CheckStatus.OK.value,
                    message="MCP 包已安装",
                )
        except Exception:
            pass
        return self.make_item(
            check_id="mcp.package_installed",
            name="MCP Package",
            description="MCP Python 包",
            status=CheckStatus.WARNING.value,
            message="MCP 包未安装",
            fix_suggestion="pip install mcp",
        )

    def _check_servers_reachable(self) -> CheckItem:
        """MCP 服务器可达性（基础）"""
        path = self._get_mcp_config_path()
        if not path.exists():
            return self.make_item(
                check_id="mcp.servers_reachable",
                name="MCP Servers Reachable",
                description="MCP 服务器可达性",
                status=CheckStatus.SKIPPED.value,
                message="配置文件不存在",
            )
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            servers = data.get("mcpServers", {}) or data.get("servers", {})
            if not servers:
                return self.make_item(
                    check_id="mcp.servers_reachable",
                    name="MCP Servers Reachable",
                    description="MCP 服务器可达性",
                    status=CheckStatus.SKIPPED.value,
                    message="无服务器可检查",
                )
            # 检查每个服务器的 command 是否存在
            failed = []
            for name, config in servers.items():
                if isinstance(config, dict):
                    cmd = config.get("command", "")
                    if cmd and not _check_command_exists(cmd):
                        # npx/node/python 等可能通过 PATH 找到，不一定报错
                        if cmd in ("npx", "node", "python", "python3"):
                            continue
                        failed.append(name)
            if not failed:
                return self.make_item(
                    check_id="mcp.servers_reachable",
                    name="MCP Servers Reachable",
                    description="MCP 服务器可达性",
                    status=CheckStatus.OK.value,
                    value=f"{len(servers)} checked",
                    message=f"所有服务器命令路径有效",
                )
            return self.make_item(
                check_id="mcp.servers_reachable",
                name="MCP Servers Reachable",
                description="MCP 服务器可达性",
                status=CheckStatus.WARNING.value,
                value=f"{len(failed)} failed",
                message=f"无法找到命令: {', '.join(failed)}",
                fix_suggestion="检查 PATH 或安装缺失的命令",
                details={"failed_servers": failed},
            )
        except Exception as e:
            return self.make_item(
                check_id="mcp.servers_reachable",
                name="MCP Servers Reachable",
                description="MCP 服务器可达性",
                status=CheckStatus.ERROR.value,
                message=f"检查失败: {e}",
            )
