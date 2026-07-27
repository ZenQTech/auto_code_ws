"""
# MCP 工具安全模块
# 核心作用：路径安全验证
#   - 防止路径遍历攻击
#   - 防止访问工作空间外文件
#   - 允许的根目录：/tmp, /home/qizheng/auto_code_data, /home/qizheng/auto_code_ws
"""
import os
from pathlib import Path
from typing import Optional

# 允许的根目录白名单
ALLOWED_ROOTS = [
    "/tmp",
    os.path.expanduser("~/auto_code_data"),
    os.path.expanduser("~/auto_code_ws"),
    os.getcwd(),  # 当前工作目录
]


def validate_path(path: str, workspace_root: str) -> Optional[Path]:
    """
    验证路径安全性
    返回：
      - Path 对象（绝对路径，已 resolve）
      - None（路径不安全）
    规则：
      1. 路径必须在 ALLOWED_ROOTS 之一内
      2. 不能包含 .. 路径遍历
      3. 不能访问系统敏感目录
    """
    if not path:
        return None

    # 展开用户目录
    expanded = os.path.expanduser(path)
    try:
        resolved = Path(expanded).resolve(strict=False)
    except (OSError, RuntimeError):
        return None

    # 路径遍历检查
    parts = resolved.parts
    if ".." in parts:
        return None

    # 工作空间根检查
    allowed = [Path(r).resolve() for r in ALLOWED_ROOTS if r]
    if workspace_root:
        allowed.insert(0, Path(workspace_root).resolve())

    for root in allowed:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue

    return None
