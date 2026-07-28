"""
# ============================================================
# Project Agents Module - .trae/agents/ 子智能体目录路由 (Cycle 9 P0-17)
# ============================================================
# 核心作用：扫描项目内 .trae/agents/*.md 文件，解析 YAML frontmatter，
#           将子智能体注册到 multi-agent registry，使其可通过
#           @identifier 形式在会话中调用。
# 模块组件：
#   - parser.py: 解析 markdown frontmatter
#   - scanner.py: 扫描目录
#   - registry.py: 统一注册入口
# 输入参数：项目路径
# 输出结果：注册的 ProjectAgent 列表
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P0-17 初始化
# ============================================================
"""

from .parser import ProjectAgent, parse_agent_file, parse_frontmatter
from .scanner import ProjectAgentScanner
from .registry import (
    ProjectAgentRegistry,
    extract_at_references,
    get_global_registry,
    reset_global_registry,
)

__all__ = [
    "ProjectAgent",
    "parse_agent_file",
    "parse_frontmatter",
    "ProjectAgentScanner",
    "ProjectAgentRegistry",
    "extract_at_references",
    "get_global_registry",
    "reset_global_registry",
]
