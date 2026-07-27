"""
# run_command MCP 工具
# 作用：执行 shell 命令（白名单 + 超时）
# 安全：
#   - 必须在白名单命令集合内
#   - 30 秒超时
#   - 输出最大 1MB
"""
import asyncio
import shlex
from typing import Dict, Any

MAX_OUTPUT_SIZE = 1 * 1024 * 1024
COMMAND_TIMEOUT = 30

# 白名单命令（防止任意命令执行）
ALLOWED_COMMANDS = {
    "ls", "cat", "head", "tail", "grep", "find", "wc", "sort", "uniq",
    "echo", "pwd", "date", "whoami", "ps", "df", "du", "stat",
    "git", "python3", "pip3", "node", "npm", "yarn", "pnpm",
    "test", "[", "true", "false",
}

# 黑名单参数（防止危险操作）
DANGEROUS_PATTERNS = [
    "rm -rf", "rm -fr", "sudo", "chmod 777", "chown",
    "mkfs", "dd if=", "> /dev/", "| sh", "| bash", "| python",
    "curl", "wget", "ssh", "scp", "rsync",
    "eval", "exec",
]

RUN_COMMAND_TOOL = {
    "name": "run_command",
    "description": "执行白名单 shell 命令（30 秒超时，输出最大 1MB）。支持命令：ls, cat, grep, find, git status, python3 等。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "要执行的 shell 命令",
            },
            "cwd": {
                "type": "string",
                "description": "工作目录（可选，默认工作空间根）",
            },
        },
        "required": ["command"],
    },
}


async def run_command(arguments: Dict[str, Any], workspace_root: str) -> Dict[str, Any]:
    """
    执行 shell 命令
    """
    try:
        from .security import validate_path
        command = arguments.get("command", "").strip()
        cwd = arguments.get("cwd", workspace_root)

        if not command:
            return {"success": False, "content": "", "is_error": True, "error_message": "command 参数必填"}

        # 黑名单检查
        for pattern in DANGEROUS_PATTERNS:
            if pattern in command:
                return {
                    "success": False,
                    "content": "",
                    "is_error": True,
                    "error_message": f"命令包含危险模式: {pattern}",
                }

        # 白名单检查（解析第一个 token）
        try:
            first_token = shlex.split(command)[0]
        except ValueError as e:
            return {
                "success": False,
                "content": "",
                "is_error": True,
                "error_message": f"命令解析失败: {e}",
            }

        if first_token not in ALLOWED_COMMANDS:
            return {
                "success": False,
                "content": "",
                "is_error": True,
                "error_message": f"命令不在白名单: {first_token}（允许: {', '.join(sorted(ALLOWED_COMMANDS)[:10])}...）",
            }

        # 验证 cwd
        resolved_cwd = validate_path(cwd, workspace_root)
        if resolved_cwd is None or not resolved_cwd.exists() or not resolved_cwd.is_dir():
            return {
                "success": False,
                "content": "",
                "is_error": True,
                "error_message": f"工作目录无效: {cwd}",
            }

        # 执行命令
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(resolved_cwd),
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=COMMAND_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            return {
                "success": False,
                "content": "",
                "is_error": True,
                "error_message": f"命令执行超时（{COMMAND_TIMEOUT}s）",
            }

        stdout_str = stdout.decode("utf-8", errors="replace")[:MAX_OUTPUT_SIZE]
        stderr_str = stderr.decode("utf-8", errors="replace")[:MAX_OUTPUT_SIZE]

        output = stdout_str
        if stderr_str:
            output += f"\n[stderr]\n{stderr_str}"

        return {
            "success": proc.returncode == 0,
            "content": output,
            "is_error": proc.returncode != 0,
            "error_message": None if proc.returncode == 0 else f"exit code {proc.returncode}",
            "metadata": {"returncode": proc.returncode, "command": command},
        }
    except Exception as e:
        return {
            "success": False,
            "content": "",
            "is_error": True,
            "error_message": f"命令执行失败: {str(e)}",
        }
