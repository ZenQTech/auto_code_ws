"""
# ============================================================
# MCP (Model Context Protocol) 内置工具集
# ============================================================
# 核心作用：实现 4 个内置 MCP 工具
#   1. read_file - 读取文件内容
#   2. write_file - 写入文件
#   3. run_command - 执行 shell 命令（白名单）
#   4. list_directory - 列出目录内容
# 安全约束：
#   - 所有文件操作必须在工作空间目录白名单内
#   - run_command 必须在白名单命令集合内
#   - 单个工具调用超时 30 秒
#   - 输出最大 1MB
# ============================================================
"""

from .read_file import read_file, READ_FILE_TOOL
from .write_file import write_file, WRITE_FILE_TOOL
from .run_command import run_command, RUN_COMMAND_TOOL
from .list_directory import list_directory, LIST_DIRECTORY_TOOL

BUILTIN_TOOLS = {
    "read_file": {
        "handler": read_file,
        "schema": READ_FILE_TOOL,
    },
    "write_file": {
        "handler": write_file,
        "schema": WRITE_FILE_TOOL,
    },
    "run_command": {
        "handler": run_command,
        "schema": RUN_COMMAND_TOOL,
    },
    "list_directory": {
        "handler": list_directory,
        "schema": LIST_DIRECTORY_TOOL,
    },
}

__all__ = [
    "BUILTIN_TOOLS",
    "read_file",
    "write_file",
    "run_command",
    "list_directory",
]
