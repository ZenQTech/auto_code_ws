"""
# ============================================================
# Rules Resolver - 多文件类型 + 4 层加载架构
# ============================================================
# 核心作用：扩展 AGENTS.md 内存系统，支持 CLAUDE.md、GEMINI.md 等
# 兼容标准：
#   - AGENTS.md（OpenAI 开放标准）
#   - CLAUDE.md（Claude Code 4 层架构）
#   - GEMINI.md（Gemini CLI）
#   - .cursorrules（Cursor）
#   - README.md（特定 AI 章节）
# 创建日期：2026-07-27
# 模块版本：v1.0.0
# ============================================================
"""

import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 数据模型
# ============================================================

class RuleFileType(str, Enum):
    """规则文件类型"""
    AGENTS_MD = "AGENTS.md"
    CLAUDE_MD = "CLAUDE.md"
    GEMINI_MD = "GEMINI.md"
    CURSORRULES = ".cursorrules"
    README_MD = "README.md"
    OVERRIDE = "AGENTS.override.md"


class RuleLayer(str, Enum):
    """规则所在层级"""
    USER = "user"               # 用户级（~/.hermes/rules/）
    PROJECT = "project"         # 项目级（<root>/）
    SUB_DIRECTORY = "sub_directory"  # 子目录级
    OVERRIDE = "override"       # 覆盖级（强制最高优先级）


# 优先级（数字越大优先级越高）
LAYER_PRIORITY = {
    RuleLayer.USER: 1,
    RuleLayer.PROJECT: 2,
    RuleLayer.SUB_DIRECTORY: 3,
    RuleLayer.OVERRIDE: 4,
}


@dataclass
class RuleFile:
    """规则文件"""
    id: str
    file_type: RuleFileType
    file_path: str
    relative_path: str
    project_path: str
    layer: RuleLayer
    priority: int
    content: str
    content_hash: str
    size: int
    enabled: bool = True
    last_loaded_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "file_type": self.file_type.value,
            "file_path": self.file_path,
            "relative_path": self.relative_path,
            "project_path": self.project_path,
            "layer": self.layer.value,
            "priority": self.priority,
            "content": self.content,
            "content_hash": self.content_hash,
            "size": self.size,
            "enabled": self.enabled,
            "last_loaded_at": self.last_loaded_at,
        }


# ============================================================
# Rules Resolver 服务
# ============================================================

class RulesResolver:
    """
    多文件类型规则解析器
    - 支持 AGENTS.md、CLAUDE.md、GEMINI.md、.cursorrules、README.md
    - 4 层加载：user → project → sub_directory → override
    - 优先级机制：override > sub_directory > project > user
    - 冲突检测
    """

    # 支持的文件类型
    SUPPORTED_FILE_TYPES = [
        RuleFileType.AGENTS_MD,
        RuleFileType.CLAUDE_MD,
        RuleFileType.GEMINI_MD,
        RuleFileType.CURSORRULES,
        RuleFileType.README_MD,
    ]

    # 排除目录
    EXCLUDE_DIRS = {
        ".git", "node_modules", "__pycache__", "venv", ".venv",
        "dist", "build", ".next", "target", "bin", "obj",
    }

    # 最大文件大小（5MB）
    MAX_FILE_SIZE = 5 * 1024 * 1024

    def __init__(self):
        self._rules: Dict[str, RuleFile] = {}
        self._user_rules_path = Path.home() / ".hermes" / "rules"
        logger.info(f"RulesResolver 初始化完成（user_rules={self._user_rules_path}）")

    # ============================================================
    # 扫描
    # ============================================================

    def scan(
        self,
        project_path: str,
        file_types: Optional[List[str]] = None,
        max_depth: int = 3,
        include_user_layer: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        扫描项目规则文件

        参数:
            project_path: 项目根路径
            file_types: 要扫描的文件类型（None = 全部支持类型）
            max_depth: 最大扫描深度
            include_user_layer: 是否包含用户级规则

        返回:
            找到的规则列表
        """
        if file_types is None:
            file_types = [ft.value for ft in self.SUPPORTED_FILE_TYPES]

        project = Path(project_path)
        if not project.exists() or not project.is_dir():
            logger.warning(f"项目路径不存在: {project_path}")
            return []

        found: List[RuleFile] = []

        # Layer 1: User 级（~/.hermes/rules/）
        if include_user_layer and self._user_rules_path.exists():
            user_files = self._user_rules_path.rglob("*")
            for f in user_files:
                if f.is_file() and f.name in file_types:
                    rule = self._create_rule(
                        f, project, RuleLayer.USER, max_depth=99,
                    )
                    if rule:
                        found.append(rule)

        # Layer 2: Project 级（项目根）
        for ft_name in file_types:
            project_file = project / ft_name
            if project_file.exists() and project_file.is_file():
                rule = self._create_rule(
                    project_file, project, RuleLayer.PROJECT, max_depth=max_depth,
                )
                if rule:
                    found.append(rule)

        # Layer 3: Sub-directory 级
        for ft_name in file_types:
            pattern = f"**/{ft_name}"
            for sub_file in project.glob(pattern):
                if sub_file == project / ft_name:
                    continue  # 跳过根
                # 检查深度
                rel = sub_file.relative_to(project)
                depth = len(rel.parts) - 1
                if depth > max_depth:
                    continue
                # 排除目录
                if any(excluded in sub_file.parts for excluded in self.EXCLUDE_DIRS):
                    continue

                rule = self._create_rule(
                    sub_file, project, RuleLayer.SUB_DIRECTORY, max_depth=max_depth,
                )
                if rule:
                    found.append(rule)

        # Layer 4: Override 级
        override_file = project / RuleFileType.OVERRIDE.value
        if override_file.exists():
            rule = self._create_rule(
                override_file, project, RuleLayer.OVERRIDE, max_depth=99,
            )
            if rule:
                found.append(rule)

        # 保存到内存
        for rule in found:
            self._rules[rule.id] = rule

        # 按优先级排序
        found.sort(key=lambda r: r.priority, reverse=True)

        logger.info(f"扫描 {project_path}: 找到 {len(found)} 个规则文件")
        return [r.to_dict() for r in found]

    def _create_rule(
        self,
        file_path: Path,
        project: Path,
        layer: RuleLayer,
        max_depth: int,
    ) -> Optional[RuleFile]:
        """创建 RuleFile 对象"""
        try:
            # 读取文件
            content = self._read_file(file_path)
            if content is None:
                return None

            content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
            rel_path = str(file_path.relative_to(project)) if file_path.is_relative_to(project) else str(file_path)

            rule = RuleFile(
                id=str(uuid.uuid4()),
                file_type=self._detect_file_type(file_path.name),
                file_path=str(file_path),
                relative_path=rel_path,
                project_path=str(project),
                layer=layer,
                priority=LAYER_PRIORITY[layer],
                content=content,
                content_hash=content_hash,
                size=len(content),
                enabled=True,
                last_loaded_at=datetime.now(timezone.utc).isoformat(),
            )
            return rule
        except Exception as e:
            logger.error(f"创建 rule 失败 ({file_path}): {e}")
            return None

    def _read_file(self, file_path: Path) -> Optional[str]:
        """读取文件内容（含安全检查）"""
        try:
            if not file_path.exists() or not file_path.is_file():
                return None
            # 文件大小检查
            size = file_path.stat().st_size
            if size > self.MAX_FILE_SIZE:
                logger.warning(f"文件过大（{size} bytes），跳过: {file_path}")
                return None
            # 读取
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            # README.md 只提取 AI 章节（## AI Context / ## Instructions 等）
            if file_path.name == "README.md":
                content = self._extract_ai_section(content)
                if not content:
                    return None
            return content
        except Exception as e:
            logger.error(f"读取文件失败 {file_path}: {e}")
            return None

    def _extract_ai_section(self, content: str) -> str:
        """从 README.md 中提取 AI 相关章节"""
        import re
        # 匹配 ## AI Context、## AI Instructions、## AI Guide 等
        pattern = re.compile(
            r"^##\s+(AI\s+(Context|Instructions?|Guide|Rules?)|For\s+AI|AI\s+Notes?)\s*$(.*?)(?=^##\s|\Z)",
            re.MULTILINE | re.IGNORECASE | re.DOTALL,
        )
        matches = pattern.findall(content)
        if matches:
            return "\n\n".join(m[2].strip() for m in matches)
        return ""

    def _detect_file_type(self, filename: str) -> RuleFileType:
        """根据文件名检测文件类型"""
        for ft in RuleFileType:
            if ft.value == filename:
                return ft
        return RuleFileType.AGENTS_MD  # 默认

    # ============================================================
    # 合并
    # ============================================================

    def merge_rules(
        self,
        project_path: str,
        enabled_only: bool = True,
        max_total_size: int = 16000,
    ) -> Dict[str, Any]:
        """
        合并项目所有启用的规则，按层级和优先级

        参数:
            project_path: 项目路径
            enabled_only: 仅包含启用的
            max_total_size: 最大总字符数（防止撑爆上下文）

        返回:
            {
                "merged_content": "...",
                "layers": [...],
                "total_size": 1234,
                "truncated": False,
                "rules_count": 5
            }
        """
        # 筛选项目规则
        rules = [
            r for r in self._rules.values()
            if r.project_path == project_path and (not enabled_only or r.enabled)
        ]
        # 按优先级排序（高到低）
        rules.sort(key=lambda r: r.priority, reverse=True)

        layers_used: Dict[str, int] = {}
        merged_parts: List[str] = []
        current_size = 0
        truncated = False

        for rule in rules:
            header = f"# {rule.file_type} ({rule.relative_path}) [Layer: {rule.layer.value}]"
            section = f"{header}\n{rule.content}\n"

            # 严格遵守 max_total_size
            if current_size + len(section) > max_total_size:
                truncated = True
                # 截断到剩余空间
                remaining = max_total_size - current_size
                if remaining > 200:  # 至少保留 200 字符
                    section = section[:remaining] + "\n... (truncated)"
                    merged_parts.append(section)
                    current_size += len(section)
                    layers_used[rule.layer.value] = layers_used.get(rule.layer.value, 0) + 1
                break

            merged_parts.append(section)
            current_size += len(section)
            layers_used[rule.layer.value] = layers_used.get(rule.layer.value, 0) + 1

        return {
            "merged_content": "\n\n".join(merged_parts),
            "layers": [{"layer": k, "count": v} for k, v in layers_used.items()],
            "total_size": current_size,
            "truncated": truncated,
            "rules_count": len(merged_parts),
        }

    # ============================================================
    # CRUD
    # ============================================================

    def list_rules(
        self,
        project_path: Optional[str] = None,
        enabled_only: bool = False,
    ) -> List[Dict[str, Any]]:
        """列出所有规则"""
        rules = list(self._rules.values())
        if project_path:
            rules = [r for r in rules if r.project_path == project_path]
        if enabled_only:
            rules = [r for r in rules if r.enabled]
        rules.sort(key=lambda r: (r.project_path, r.priority), reverse=True)
        return [r.to_dict() for r in rules]

    def enable(self, rule_id: str) -> bool:
        """启用规则"""
        if rule_id not in self._rules:
            return False
        self._rules[rule_id].enabled = True
        return True

    def disable(self, rule_id: str) -> bool:
        """禁用规则"""
        if rule_id not in self._rules:
            return False
        self._rules[rule_id].enabled = False
        return True

    def delete(self, rule_id: str) -> bool:
        """删除规则"""
        if rule_id not in self._rules:
            return False
        del self._rules[rule_id]
        return True

    def get(self, rule_id: str) -> Optional[Dict[str, Any]]:
        """获取单个规则"""
        if rule_id not in self._rules:
            return None
        return self._rules[rule_id].to_dict()

    def detect_conflicts(self, project_path: str) -> List[Dict[str, Any]]:
        """
        检测项目中的规则冲突
        - 同名不同层级的文件
        - 同路径不同内容
        """
        rules = [r for r in self._rules.values() if r.project_path == project_path]
        conflicts = []

        # 按 file_type 分组
        type_groups: Dict[str, List[RuleFile]] = {}
        for r in rules:
            type_groups.setdefault(r.file_type.value, []).append(r)

        for ft_name, group in type_groups.items():
            if len(group) > 1:
                # 同类型多文件 = 多层级覆盖
                layers = [r.layer.value for r in group]
                conflicts.append({
                    "type": "multi_layer_override",
                    "file_type": ft_name,
                    "files": [
                        {
                            "path": r.relative_path,
                            "layer": r.layer,
                            "priority": r.priority,
                        }
                        for r in group
                    ],
                    "winning_layer": max(group, key=lambda x: x.priority).layer.value,
                })

        return conflicts


# 全局单例
_resolver_instance: Optional[RulesResolver] = None


def get_rules_resolver() -> RulesResolver:
    """获取全局规则解析器"""
    global _resolver_instance
    if _resolver_instance is None:
        _resolver_instance = RulesResolver()
    return _resolver_instance
