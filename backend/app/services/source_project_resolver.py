"""
智能体生成源代码项目根目录解析工具
=====================================

v5.9.0 新增（source-code-workspace-isolation spec，v5.8.0 早期版本回退后）

职责：
  - 把每个工作流的源代码仓库根目录解析到 `/home/qizheng/auto_code_data/<project_name>/`
  - 物理隔离平台工作区 `/home/qizheng/auto_code_ws/`，避免污染
  - **不**预设任何目录结构（让 LLM 决定项目形态）

设计原则：
  - 平台只提供"一个空的根目录"
  - LLM 在提示词中明确被告知"自行决定所有代码文件放置位置"
  - LLM 输出 `# FILE: <rel_path>` 标记后，平台按标记路径写入
  - 平台不再校验路径必须以 `src/<pkg>/` 开头
  - 平台不再自动生成 ROS2 模板（package.xml/setup.py/launch/config）

调用方：_run_executing_phase（生成代码时）
        _run_reviewing_phase（编译运行时探测项目类型）
        git_manager（commit 智能体生成的代码时）
"""
import os
import re
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 默认用户级数据根目录
DEFAULT_DATA_ROOT = "/home/qizheng/auto_code_data"


def sanitize_project_name(title: str) -> str:
    """
    把 session title 清洗为合法的目录名

    规则：
      - 保留英文字母、数字、下划线、连字符
      - 移除其他字符（中文、空格、特殊符号）
      - 全部小写
      - 至少保留 1 个字符；空字符串返回空字符串（调用方 fallback）

    示例：
      "智能仓储v3" → "v3"
      "Project 智能体-1.0" → "project-10"
      "" → ""
    """
    if not title:
        return ""
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", title)
    cleaned = cleaned.lower().strip("_").strip("-")
    return cleaned


def ensure_data_root() -> Path:
    """
    确保 /home/qizheng/auto_code_data/ 存在且可写

    Returns: Path 对象
    """
    data_root = Path(DEFAULT_DATA_ROOT)
    if not data_root.exists():
        try:
            data_root.mkdir(parents=True, exist_ok=True)
            logger.info(f"创建用户数据根目录: {data_root}")
        except OSError as exc:
            logger.error(f"无法创建数据根目录 {data_root}: {exc}")
            raise
    return data_root


def resolve_project_root(
    workflow_id: str,
    session_id: Optional[str] = None,
    title: Optional[str] = None,
) -> Path:
    """
    解析项目根目录

    解析优先级：
      1. /home/qizheng/auto_code_data/<sanitized_title>/（用户已有同名项目）
      2. /home/qizheng/auto_code_data/project_<wf_id_short>/（fallback 命名）

    v5.9.0 行为：只创建空目录，**不**预设任何子目录结构（如 src/、launch/、config/）
                  —— 这些由 LLM 决定。

    Args:
        workflow_id: 工作流 ID
        session_id: 会话 ID（暂未使用，预留）
        title: 项目标题（用于同名匹配）

    Returns:
        Path 对象，绝对路径
    """
    if not workflow_id:
        raise ValueError("workflow_id 不能为空")

    data_root = ensure_data_root()
    wf_short = workflow_id.replace("-", "")[:8] or "unknown"

    # 优先级 1：用户已建的同名项目
    sanitized = sanitize_project_name(title or "")
    if sanitized:
        candidate = data_root / sanitized
        if candidate.exists():
            logger.info(f"项目根目录解析：命中已有项目 {candidate}")
            return candidate

    # 优先级 2：workflow_id 命名
    project_dir = f"project_{wf_short}"
    project_root = data_root / project_dir

    if not project_root.exists():
        # v5.9.0：只创建空目录，不预设 src/、launch/ 等
        project_root.mkdir(parents=True, exist_ok=True)
        logger.info(f"项目根目录不存在，已创建空目录: {project_root}")
    else:
        logger.info(f"项目根目录解析：使用已有目录 {project_root}")

    return project_root


def detect_project_type(project_root: Path) -> str:
    """
    探测项目类型（用于 reviewing 阶段编译运行决策）

    Returns: 'ros2_ament_python' | 'ros2_ament_cmake' | 'python_setup_py' |
             'python_pyproject' | 'unknown'
    """
    project_root = Path(project_root)
    if not project_root.is_dir():
        return 'unknown'

    src_dir = project_root / 'src'
    # 1. ROS2 colcon workspace：找 src/<pkg>/package.xml
    if src_dir.is_dir():
        for child in src_dir.iterdir():
            if not child.is_dir():
                continue
            pkg_xml = child / 'package.xml'
            if pkg_xml.exists():
                try:
                    content = pkg_xml.read_text(encoding='utf-8')
                    if 'ament_python' in content:
                        return 'ros2_ament_python'
                    if 'ament_cmake' in content:
                        return 'ros2_ament_cmake'
                except Exception:
                    pass
                return 'ros2_ament_python'  # 默认为 ament_python

    # 2. 纯 Python: setup.py
    if (project_root / 'setup.py').exists():
        return 'python_setup_py'

    # 3. 纯 Python: pyproject.toml
    if (project_root / 'pyproject.toml').exists():
        return 'python_pyproject'

    return 'unknown'


def find_ros2_package(project_root: Path) -> Optional[str]:
    """
    找 ROS2 package 名（src/<pkg>/package.xml）

    Returns: package 名（如 "coverage_navigation"），找不到返回 None
    """
    src_dir = Path(project_root) / 'src'
    if not src_dir.is_dir():
        return None
    for child in src_dir.iterdir():
        if child.is_dir() and (child / 'package.xml').exists():
            return child.name
    return None


def find_python_entry_point(project_root: Path) -> Optional[str]:
    """
    找纯 Python 项目的主入口（从 setup.py 或 pyproject.toml 的 entry_points/script）

    Returns: entry point 名（如 'agent_main'），找不到返回 None
    """
    import re as _re
    project_root = Path(project_root)
    setup_py = project_root / 'setup.py'
    if setup_py.exists():
        try:
            content = setup_py.read_text(encoding='utf-8')
            # 找 console_scripts 块
            m = _re.search(
                r"console_scripts\s*:\s*\[([^\]]+)\]", content, _re.DOTALL
            )
            if m:
                block = m.group(1)
                # 取第一个 "name = module:main"
                m2 = _re.search(r"['\"](\w+)['\"]\s*=\s*([\w.]+):(\w+)", block)
                if m2:
                    return m2.group(1)
        except Exception:
            pass

    pyproject = project_root / 'pyproject.toml'
    if pyproject.exists():
        try:
            content = pyproject.read_text(encoding='utf-8')
            m = _re.search(
                r"\[\[project\.scripts\]\](.*?)(?=\n\[|$)", content, _re.DOTALL
            )
            if m:
                block = m.group(1)
                m2 = _re.search(r"(\w+)\s*=\s*([\w.]+):(\w+)", block)
                if m2:
                    return m2.group(1)
        except Exception:
            pass

    return None


__all__ = [
    "DEFAULT_DATA_ROOT",
    "sanitize_project_name",
    "ensure_data_root",
    "resolve_project_root",
    "detect_project_type",
    "find_ros2_package",
    "find_python_entry_point",
]
