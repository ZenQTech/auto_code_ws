"""
# ============================================================
# Project Agent Scanner - 目录扫描器 (Cycle 9 P0-17)
# ============================================================
# 核心作用：扫描项目内 .trae/agents/ 目录及其子目录中的所有 *.md 文件，
#           收集为 ProjectAgent 列表
# 扫描规则：
#   - 递归扫描 .trae/agents/**/*.md
#   - 忽略隐藏文件（以 . 开头）
#   - 跳过 _ 前缀文件（视为模板/草稿）
#   - 解析失败的文件记录 warning 但不中断
# 输入参数：项目根目录
# 输出结果：ProjectAgent 列表
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P0-17 初始化
# ============================================================
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Union

from .parser import ProjectAgent, parse_agent_file

logger = logging.getLogger(__name__)


class ProjectAgentScanner:
    """项目级子智能体扫描器

    Usage:
        scanner = ProjectAgentScanner("/path/to/project")
        agents = scanner.scan()
        for a in agents:
            print(a.name, a.description)
    """

    AGENTS_DIRNAME = ".trae"
    AGENTS_SUBDIR = "agents"

    def __init__(self, project_path: Union[str, Path]):
        """初始化扫描器

        Args:
            project_path: 项目根目录绝对路径
        """
        self.project_path = Path(project_path).absolute()
        self.agents_dir = self.project_path / self.AGENTS_DIRNAME / self.AGENTS_SUBDIR

    @property
    def agents_dir_exists(self) -> bool:
        """agents 目录是否存在"""
        return self.agents_dir.is_dir()

    def scan(self) -> List[ProjectAgent]:
        """扫描 .trae/agents/ 目录并返回所有解析成功的子智能体

        Returns:
            ProjectAgent 列表
        """
        if not self.agents_dir_exists:
            return []

        agents: List[ProjectAgent] = []
        for md_file in self.agents_dir.rglob("*.md"):
            # 跳过隐藏文件与 _ 模板
            if any(part.startswith(".") and part not in (".trae",) for part in md_file.parts):
                continue
            if md_file.stem.startswith("_"):
                continue

            agent = parse_agent_file(md_file)
            if agent:
                agents.append(agent)
            # 解析失败已由 parse_agent_file 内部记录 warning

        logger.info(
            f"Scanned {self.agents_dir}: found {len(agents)} agents"
        )
        return agents

    def scan_with_errors(self) -> tuple:
        """扫描并同时返回解析失败的错误列表

        Returns:
            (agents, errors) - agents 是成功解析的列表，
                              errors 是 (file_path, error_message) 列表
        """
        if not self.agents_dir_exists:
            return [], []

        agents: List[ProjectAgent] = []
        errors: List[tuple] = []
        for md_file in self.agents_dir.rglob("*.md"):
            if any(part.startswith(".") and part not in (".trae",) for part in md_file.parts):
                continue
            if md_file.stem.startswith("_"):
                continue

            try:
                agent = parse_agent_file(md_file)
                if agent:
                    agents.append(agent)
                else:
                    errors.append((str(md_file), "parse returned None"))
            except Exception as e:
                errors.append((str(md_file), str(e)))

        return agents, errors

    def find_by_name(self, name: str) -> Optional[ProjectAgent]:
        """扫描并按 name 查找单个子智能体

        Args:
            name: 子智能体名称

        Returns:
            找到则返回 ProjectAgent，否则 None
        """
        for agent in self.scan():
            if agent.name == name:
                return agent
        return None
