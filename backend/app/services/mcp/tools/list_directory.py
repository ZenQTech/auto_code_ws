"""
# list_directory MCP 工具
# 作用：列出目录内容
"""
import os
from pathlib import Path
from typing import Dict, Any, List

LIST_DIRECTORY_TOOL = {
    "name": "list_directory",
    "description": "列出目录内容（文件/子目录），返回 JSON 数组。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "目录路径（默认工作空间根）",
            },
            "max_depth": {
                "type": "integer",
                "description": "递归深度（0=仅当前层，默认 0）",
                "default": 0,
            },
        },
        "required": [],
    },
}


async def list_directory(arguments: Dict[str, Any], workspace_root: str) -> Dict[str, Any]:
    """
    列出目录
    """
    try:
        from .security import validate_path
        path = arguments.get("path", workspace_root)
        max_depth = arguments.get("max_depth", 0)

        if not isinstance(max_depth, int) or max_depth < 0 or max_depth > 5:
            max_depth = 0

        resolved = validate_path(path, workspace_root)
        if resolved is None:
            return {"success": False, "content": "", "is_error": True, "error_message": f"路径不安全: {path}"}

        if not os.path.exists(resolved):
            return {"success": False, "content": "", "is_error": True, "error_message": f"目录不存在: {resolved}"}

        if not os.path.isdir(resolved):
            return {"success": False, "content": "", "is_error": True, "error_message": f"不是目录: {resolved}"}

        items: List[Dict[str, Any]] = []

        def _walk(current: Path, depth: int):
            """
            递归遍历目录
            参数：current 当前目录路径，depth 剩余递归深度
            """
            try:
                for entry in sorted(current.iterdir()):
                    rel = str(entry.relative_to(resolved))
                    items.append({
                        "name": entry.name,
                        "path": str(entry),
                        "relative_path": rel,
                        "type": "directory" if entry.is_dir() else "file",
                        "size": entry.stat().st_size if entry.is_file() else 0,
                    })
                    if depth > 0 and entry.is_dir():
                        _walk(entry, depth - 1)
            except PermissionError:
                pass

        _walk(Path(resolved), max_depth)

        return {
            "success": True,
            "content": items,  # JSON 数组
            "is_error": False,
            "error_message": None,
            "metadata": {"path": str(resolved), "count": len(items)},
        }
    except Exception as e:
        return {
            "success": False,
            "content": "",
            "is_error": True,
            "error_message": f"列目录失败: {str(e)}",
        }
