"""
# write_file MCP 工具
# 作用：写入文件内容
# 参数：
#   - path: 文件路径
#   - content: 文件内容
#   - append: 是否追加（默认覆盖）
# 返回：写入字节数
"""
import os
from typing import Dict, Any

WRITE_FILE_TOOL = {
    "name": "write_file",
    "description": "写入文件内容（最大 1MB）。路径必须在工作空间白名单内。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "要写入的文件路径",
            },
            "content": {
                "type": "string",
                "description": "要写入的内容",
            },
            "append": {
                "type": "boolean",
                "description": "是否追加（默认 false=覆盖）",
                "default": False,
            },
        },
        "required": ["path", "content"],
    },
}


async def write_file(arguments: Dict[str, Any], workspace_root: str) -> Dict[str, Any]:
    """
    写入文件
    """
    try:
        from .security import validate_path
        path = arguments.get("path", "")
        content = arguments.get("content", "")
        append = arguments.get("append", False)

        if not path:
            return {"success": False, "content": "", "is_error": True, "error_message": "path 参数必填"}

        if not isinstance(content, str):
            return {"success": False, "content": "", "is_error": True, "error_message": "content 必须是字符串"}

        if len(content.encode("utf-8")) > 1024 * 1024:
            return {"success": False, "content": "", "is_error": True, "error_message": "内容超过 1MB"}

        resolved = validate_path(path, workspace_root)
        if resolved is None:
            return {"success": False, "content": "", "is_error": True, "error_message": f"路径不安全: {path}"}

        # 自动创建父目录
        parent = os.path.dirname(resolved)
        if parent and not os.path.exists(parent):
            os.makedirs(parent, exist_ok=True)

        mode = "a" if append else "w"
        with open(resolved, mode, encoding="utf-8") as f:
            f.write(content)

        size = os.path.getsize(resolved)
        return {
            "success": True,
            "content": f"已写入 {size} bytes",
            "is_error": False,
            "error_message": None,
            "metadata": {"size": size, "path": str(resolved), "append": append},
        }
    except Exception as e:
        return {
            "success": False,
            "content": "",
            "is_error": True,
            "error_message": f"写入文件失败: {str(e)}",
        }
