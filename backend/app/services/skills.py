"""
# ============================================================
# Skills 插件系统
# ============================================================
# 核心作用：管理 Skills 插件（自定义工具和工作流）
# 设计要点：
#   1. 内置 Skills：code-reviewer、test-generator、doc-generator
#   2. 用户自定义 Skills：可通过 API 创建/更新/删除
#   3. 启用/禁用：影响是否注入到 LLM 提示词
#   4. 提示词构建：拼接所有 enabled skills 的 system_prompt
# 运行流程：
#   注册 → 启用 → LLM 会话 → 自动注入 system prompt
# 输入参数：name、display_name、description、system_prompt、tools
# 输出结果：Skill 实例 + 拼接后的 system prompt
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 2 T4 初始化
# ============================================================
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# 内置 Skills（不可删除）
BUILTIN_SKILLS = [
    {
        "name": "code-reviewer",
        "display_name": "代码审查",
        "description": "自动审查代码变更，识别 bug、性能问题、风格违规",
        "system_prompt": (
            "你是一位资深的代码审查专家。在分析代码时，请关注：\n"
            "1. 潜在的 bug 和边界条件\n"
            "2. 性能瓶颈（O(n²) 循环、内存泄漏等）\n"
            "3. 安全问题（SQL 注入、XSS、权限绕过）\n"
            "4. 代码风格和可维护性\n"
            "5. 测试覆盖度\n"
            "请用具体行号引用代码，并按严重程度排序。"
        ),
        "tools": ["read_file", "list_directory"],
        "enabled": True,
        "source": "builtin",
        "version": "1.0.0",
    },
    {
        "name": "test-generator",
        "display_name": "测试生成",
        "description": "基于代码自动生成单元测试和集成测试",
        "system_prompt": (
            "你是一位测试工程师。生成测试时请：\n"
            "1. 覆盖正常路径和异常路径\n"
            "2. 包含边界值测试（0、空、负数、极大值）\n"
            "3. 使用 AAA 模式（Arrange-Act-Assert）\n"
            "4. 每个测试一个清晰的断言\n"
            "5. 使用有意义的测试名称（test_xxx_when_yyy_should_zzz）\n"
            "6. 避免测试间依赖"
        ),
        "tools": ["read_file", "write_file"],
        "enabled": True,
        "source": "builtin",
        "version": "1.0.0",
    },
    {
        "name": "doc-generator",
        "display_name": "文档生成",
        "description": "为代码自动生成文档（API、函数、类）",
        "system_prompt": (
            "你是一位技术文档专家。生成文档时请：\n"
            "1. 使用清晰的标题层级\n"
            "2. 为每个公开 API 编写参数说明、返回值、异常\n"
            "3. 提供完整可运行的示例代码\n"
            "4. 说明使用场景和最佳实践\n"
            "5. 标注版本变更和弃用信息"
        ),
        "tools": ["read_file"],
        "enabled": True,
        "source": "builtin",
        "version": "1.0.0",
    },
]


class SkillService:
    """
    Skills 插件管理服务
    """

    def __init__(self, session_factory):
        self.session_factory = session_factory
        # 内存中的 Skills 缓存（包含内置 + 用户）
        self._skills: Dict[str, Dict[str, Any]] = {}
        self._builtin_ids: List[str] = []
        # 初始化时加载内置 Skills
        self._init_builtin()
        logger.info("SkillService 初始化完成（内置 %d 个）" % len(self._builtin_ids))

    def _init_builtin(self):
        """初始化内置 Skills"""
        for skill in BUILTIN_SKILLS:
            skill_id = f"builtin-{skill['name']}"
            skill["id"] = skill_id
            skill["created_at"] = datetime.now(timezone.utc).isoformat()
            skill["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._skills[skill_id] = skill
            self._builtin_ids.append(skill_id)

    # ============================================================
    # CRUD
    # ============================================================
    def list_skills(self, enabled_only: bool = False) -> List[Dict[str, Any]]:
        """
        列出所有 Skills
        参数：enabled_only 仅返回启用的
        返回值：Skill 列表
        """
        if enabled_only:
            return [s for s in self._skills.values() if s.get("enabled", False)]
        return list(self._skills.values())

    def get_skill(self, skill_id: str) -> Optional[Dict[str, Any]]:
        """获取 Skill 详情"""
        return self._skills.get(skill_id)

    def create_skill(
        self,
        name: str,
        display_name: str,
        description: str,
        system_prompt: str,
        tools: Optional[List[str]] = None,
        source: str = "user",
        version: str = "1.0.0",
    ) -> Dict[str, Any]:
        """
        创建 Skill
        返回值：新 Skill
        """
        # 名称唯一性检查
        for s in self._skills.values():
            if s.get("name") == name:
                raise ValueError(f"Skill name 已存在: {name}")

        skill_id = f"user-{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        skill = {
            "id": skill_id,
            "name": name,
            "display_name": display_name,
            "description": description,
            "system_prompt": system_prompt,
            "tools": tools or [],
            "enabled": True,
            "source": source,
            "version": version,
            "created_at": now,
            "updated_at": now,
        }
        self._skills[skill_id] = skill
        logger.info(f"Skill 创建: {skill_id} ({name})")
        return skill

    def update_skill(self, skill_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        更新 Skill（内置 Skills 不可更新除 enabled 外的字段）
        """
        if skill_id not in self._skills:
            return None
        skill = self._skills[skill_id]
        is_builtin = skill_id in self._builtin_ids

        for key, value in updates.items():
            if is_builtin and key not in ("enabled",):
                logger.warning(f"内置 Skill {skill_id} 不可修改 {key}，跳过")
                continue
            skill[key] = value
        skill["updated_at"] = datetime.now(timezone.utc).isoformat()
        return skill

    def delete_skill(self, skill_id: str) -> bool:
        """
        删除 Skill（内置不可删除）
        返回值：是否成功
        """
        if skill_id in self._builtin_ids:
            logger.warning(f"内置 Skill {skill_id} 不可删除")
            return False
        if skill_id in self._skills:
            del self._skills[skill_id]
            logger.info(f"Skill 删除: {skill_id}")
            return True
        return False

    def set_enabled(self, skill_id: str, enabled: bool) -> Optional[Dict[str, Any]]:
        """
        启用/禁用 Skill
        """
        if skill_id not in self._skills:
            return None
        self._skills[skill_id]["enabled"] = enabled
        self._skills[skill_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        return self._skills[skill_id]

    # ============================================================
    # 提示词构建
    # ============================================================
    def build_system_prompt(self, base_prompt: str = "") -> str:
        """
        构建注入到 LLM 的系统提示词
        参数：base_prompt 基础提示词
        返回值：拼接后的完整提示词
        """
        enabled = [s for s in self._skills.values() if s.get("enabled", False)]
        if not enabled:
            return base_prompt

        skill_prompts = []
        for s in enabled:
            section = (
                f"### Skill: {s['display_name']} ({s['name']} v{s['version']})\n"
                f"{s['description']}\n\n"
                f"{s['system_prompt']}\n"
            )
            if s.get("tools"):
                section += f"\n可用工具: {', '.join(s['tools'])}\n"
            skill_prompts.append(section)

        skills_block = (
            "## Active Skills\n\n"
            "以下 Skills 已在当前会话中激活，请在回答时遵循其指令：\n\n"
            + "\n---\n".join(skill_prompts)
        )

        if base_prompt:
            return f"{base_prompt}\n\n{skills_block}"
        return skills_block
