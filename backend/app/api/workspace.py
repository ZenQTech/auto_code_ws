"""
# ============================================================
# 工作空间 API 路由（V4.5 新增 - VSCode 风格资源管理器）
# ============================================================
# 核心作用：提供项目管理、文件树遍历、文件内容读取等端点
# 运行流程：
#   1. GET  /api/workspace/projects — 列出 workspace/ 下所有项目目录
#   2. POST /api/workspace/projects — 创建新项目目录
#   3. GET  /api/workspace/tree — 返回指定路径的目录树 JSON
#   4. GET  /api/workspace/file — 返回指定文件的完整内容
# 输入参数：
#   - projects: 无（GET）/ project_name（POST）
#   - tree: project（项目名）, path（相对路径，可选）
#   - file: project（项目名）, path（相对文件路径）
# 输出结果：JSON 格式的项目列表、目录树、文件内容
# 修改记录：
#   - 2026-06-24 | v4.5.0 | 初始版本
# ============================================================
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# 工作空间根目录
WORKSPACE_ROOT = settings.get_project_root() / "workspace"

# 支持预览的文件扩展名
PREVIEWABLE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml",
    ".md", ".html", ".htm", ".css", ".scss", ".less",
    ".cpp", ".cc", ".cxx", ".h", ".hpp", ".c",
    ".rs", ".go", ".java", ".kt", ".swift",
    ".xml", ".toml", ".ini", ".cfg", ".conf",
    ".sh", ".bash", ".zsh", ".fish",
    ".sql", ".r", ".rb", ".php", ".lua",
    ".cmake", ".txt", ".log", ".env", ".gitignore",
    ".dockerfile", ".makefile",
}


# ============================================================
# 请求/响应模型
# ============================================================

class CreateProjectRequest(BaseModel):
    """创建项目请求"""
    name: str = Field(..., min_length=1, max_length=64, description="项目名称")


class FileTreeNode(BaseModel):
    """文件树节点"""
    name: str
    path: str
    type: str  # "file" | "directory"
    children: Optional[List["FileTreeNode"]] = None
    size: Optional[int] = None
    extension: Optional[str] = None


class FileContentResponse(BaseModel):
    """文件内容响应"""
    path: str
    name: str
    extension: str
    content: str
    lines: int
    previewable: bool


# ============================================================
# 工具函数
# ============================================================

def _safe_project_path(project_name: str, rel_path: str = "") -> Path:
    """
    安全获取项目路径，防止路径穿越攻击
    参数：
      - project_name: 项目名称
      - rel_path: 相对路径（可选）
    返回值：安全的绝对路径
    """
    # 防止 .. 路径穿越
    safe_name = project_name.replace("..", "").replace("/", "").replace("\\", "")
    project_dir = (WORKSPACE_ROOT / safe_name).resolve()
    # 确保项目目录在 workspace/ 下
    if not str(project_dir).startswith(str(WORKSPACE_ROOT.resolve())):
        raise HTTPException(status_code=403, detail="非法项目路径")
    if rel_path:
        safe_rel = rel_path.replace("..", "")
        return (project_dir / safe_rel).resolve()
    return project_dir


def _build_tree(path: Path, base_path: Path, prefix: str = "") -> List[FileTreeNode]:
    """
    构建目录树
    参数：
      - path: 当前扫描的路径
      - base_path: 项目根路径（用于计算相对路径）
      - prefix: 路径前缀（用于递归）
    返回值：FileTreeNode 列表
    运行步骤：
      1. 列出当前目录所有文件和子目录
      2. 排序：目录在前，文件在后，各自按字母序
      3. 递归构建子节点
    """
    nodes = []
    try:
        entries = sorted(path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return nodes

    for entry in entries:
        # 跳过隐藏文件和 __pycache__
        if entry.name.startswith(".") or entry.name == "__pycache__":
            continue

        rel = str(entry.relative_to(base_path))
        node_prefix = f"{prefix}/{entry.name}" if prefix else entry.name

        if entry.is_dir():
            children = _build_tree(entry, base_path, node_prefix)
            nodes.append(FileTreeNode(
                name=entry.name,
                path=rel,
                type="directory",
                children=children,
            ))
        else:
            ext = entry.suffix.lower()
            size = entry.stat().st_size
            nodes.append(FileTreeNode(
                name=entry.name,
                path=rel,
                type="file",
                size=size,
                extension=ext,
            ))

    return nodes


# ============================================================
# API 端点
# ============================================================

@router.get("/projects")
async def list_projects():
    """
    列出 workspace/ 下所有项目目录
    运行步骤：
      1. 确保 workspace/ 目录存在
      2. 列出所有子目录
      3. 返回项目名列表
    返回值：{ projects: [{name, path, file_count}] }
    """
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    projects = []
    try:
        for entry in sorted(WORKSPACE_ROOT.iterdir(), key=lambda e: e.name.lower()):
            if entry.is_dir() and not entry.name.startswith("."):
                # 统计文件数
                file_count = sum(1 for _ in entry.rglob("*") if _.is_file() and not _.name.startswith("."))
                projects.append({
                    "name": entry.name,
                    "path": str(entry),
                    "file_count": file_count,
                })
    except Exception as e:
        logger.error(f"列出项目失败: {e}")
        raise HTTPException(status_code=500, detail=f"列出项目失败: {e}")

    return {"projects": projects}


@router.post("/projects")
async def create_project(body: CreateProjectRequest):
    """
    创建新项目目录
    运行步骤：
      1. 校验项目名合法性
      2. 在 workspace/ 下创建项目目录
      3. 创建 README.md 占位文件
    返回值：{ name, path, created }
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名不能为空")

    # 安全校验
    safe_name = name.replace("..", "").replace("/", "").replace("\\", "")
    if safe_name != name:
        raise HTTPException(status_code=400, detail="项目名包含非法字符")

    project_dir = WORKSPACE_ROOT / safe_name
    if project_dir.exists():
        raise HTTPException(status_code=409, detail=f"项目 '{safe_name}' 已存在")

    try:
        project_dir.mkdir(parents=True, exist_ok=False)
        # 创建 README.md 占位文件
        readme = project_dir / "README.md"
        readme.write_text(f"# {safe_name}\n\n项目初始化完成。\n", encoding="utf-8")
        logger.info(f"项目已创建: {safe_name}")
    except Exception as e:
        logger.error(f"创建项目失败: {e}")
        raise HTTPException(status_code=500, detail=f"创建项目失败: {e}")

    return {"name": safe_name, "path": str(project_dir), "created": True}


@router.get("/tree")
async def get_file_tree(
    project: str = Query(..., description="项目名称"),
    path: str = Query(default="", description="相对路径（空=根目录）"),
):
    """
    获取目录树
    运行步骤：
      1. 获取安全的项目路径
      2. 构建目录树
      3. 返回 JSON 树结构
    参数：
      - project: 项目名称
      - path: 相对路径，默认为空（根目录）
    返回值：{ project, root_path, tree: [FileTreeNode] }
    """
    project_dir = _safe_project_path(project)
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail=f"项目 '{project}' 不存在")

    target_path = _safe_project_path(project, path) if path else project_dir
    if not target_path.exists():
        raise HTTPException(status_code=404, detail=f"路径不存在: {path}")

    tree = _build_tree(target_path, project_dir)
    return {
        "project": project,
        "root_path": str(project_dir),
        "path": path or "/",
        "tree": tree,
    }


@router.get("/file")
async def get_file_content(
    project: str = Query(..., description="项目名称"),
    path: str = Query(..., description="相对文件路径"),
):
    """
    获取文件内容
    运行步骤：
      1. 获取安全的文件路径
      2. 检查文件是否存在
      3. 检查是否支持预览
      4. 读取文件内容并返回
    参数：
      - project: 项目名称
      - path: 相对文件路径
    返回值：FileContentResponse
    """
    file_path = _safe_project_path(project, path)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail=f"路径不是文件: {path}")

    ext = file_path.suffix.lower()
    previewable = ext in PREVIEWABLE_EXTENSIONS

    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        logger.error(f"读取文件失败: {file_path} - {e}")
        raise HTTPException(status_code=500, detail=f"读取文件失败: {e}")

    lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)

    return {
        "path": path,
        "name": file_path.name,
        "extension": ext,
        "content": content,
        "lines": lines,
        "previewable": previewable,
    }


# ============================================================
# V4.5.1 新增：文件操作（删除/复制/重命名）
# ============================================================

@router.delete("/file")
async def delete_file(
    project: str = Query(..., description="项目名称"),
    path: str = Query(..., description="相对文件路径"),
):
    """
    删除文件
    参数：project、path
    返回值：{deleted, path}
    """
    file_path = _safe_project_path(project, path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    if file_path.is_dir():
        shutil.rmtree(file_path)
        logger.info(f"目录已删除: {path}")
        return {"deleted": True, "path": path, "type": "directory"}
    file_path.unlink()
    logger.info(f"文件已删除: {path}")
    return {"deleted": True, "path": path, "type": "file"}


@router.post("/file/copy")
async def copy_file(
    project: str = Query(..., description="项目名称"),
    path: str = Query(..., description="源文件路径"),
    target: str = Query(..., description="目标路径（相对项目根目录）"),
):
    """
    复制文件
    参数：project、path（源）、target（目标）
    返回值：{copied, from, to}
    """
    src = _safe_project_path(project, path)
    dst = _safe_project_path(project, target)
    if not src.exists():
        raise HTTPException(status_code=404, detail="源文件不存在")
    if dst.exists():
        raise HTTPException(status_code=409, detail="目标文件已存在")
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)
    logger.info(f"文件已复制: {path} -> {target}")
    return {"copied": True, "from": path, "to": target}


@router.post("/file/rename")
async def rename_file(
    project: str = Query(..., description="项目名称"),
    path: str = Query(..., description="原文件路径"),
    new_name: str = Query(..., description="新文件名（仅文件名，不含路径）"),
):
    """
    重命名文件
    参数：project、path、new_name
    返回值：{renamed, from, to}
    """
    src = _safe_project_path(project, path)
    if not src.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    new_name = new_name.replace("..", "").replace("/", "").replace("\\", "")
    dst = src.parent / new_name
    if dst.exists():
        raise HTTPException(status_code=409, detail="目标文件名已存在")
    src.rename(dst)
    new_path = str(dst.relative_to(_safe_project_path(project)))
    logger.info(f"文件已重命名: {path} -> {new_path}")
    return {"renamed": True, "from": path, "to": new_path}
