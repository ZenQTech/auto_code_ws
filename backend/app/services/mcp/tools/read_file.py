"""
# read_file MCP 工具
# 作用：读取文件内容
# 参数：
#   - path: 文件路径（必须在工作空间白名单内）
# 返回：文件内容字符串
# 错误：路径不安全/文件不存在/超过大小限制
"""
import os
from pathlib import Path
from typing import Dict, Any

MAX_FILE_SIZE = 1 * 1024 * 1024  # 1MB

READ_FILE_TOOL = {
    "name": "read_file",
    "description": "读取文件内容（最大 1MB）。文件路径必须在工作空间白名单内。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "要读取的文件路径（绝对路径或工作空间相对路径）",
            },
        },
        "required": ["path"],
    },
}


async def read_file(arguments: Dict[str, Any], workspace_root: str) -> Dict[str, Any]:
    """
    读取文件
    参数：
      - arguments: {"path": "..."}
      - workspace_root: 工作空间根目录
    返回：MCP 工具结果 dict
    """
    try:
        from .security import validate_path
        path = arguments.get("path", "")
        if not path:
            return {"success": False, "content": "", "is_error": True, "error_message": "path 参数必填"}

        # 安全检查
        resolved = validate_path(path, workspace_root)
        if resolved is None:
            return {"success": False, "content": "", "is_error": True, "error_message": f"路径不安全: {path}"}

        if not os.path.exists(resolved):
            return {"success": False, "content": "", "is_error": True, "error_message": f"文件不存在: {resolved}"}

        if not os.path.isfile(resolved):
            return {"success": False, "content": "", "is_error": True, "error_message": f"不是文件: {resolved}"}

        # 大小检查
        size = os.path.getsize(resolved)
        if size > MAX_FILE_SIZE:
            return {
                "success": False,
                "content": "",
                "is_error": True,
                "error_message": f"文件过大: {size} > {MAX_FILE_SIZE} bytes",
            }

        # 读取文件
        with open(resolved, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        return {
            "success": True,
            "content": content,
            "is_error": False,
            "error_message": None,
            "metadata": {"size": size, "path": str(resolved)},
        }
    except Exception as e:
        return {
            "success": False,
            "content": "",
            "is_error": True,
            "error_message": f"读取文件失败: {str(e)}",
        }
