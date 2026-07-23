"""
# ============================================================
# Hermes 跨 Session Memory 增强
# ============================================================
# 核心作用：由 Hermes 内核自动管理跨会话记忆，
#           在用户对话及项目完成后进行总结与记忆，
#           并自动编写 Skills
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
# ============================================================
"""

import asyncio
import logging
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)


@dataclass
class SessionSummary:
    """会话总结"""
    session_id: str = ""
    title: str = ""
    key_points: List[str] = field(default_factory=list)
    decisions: List[str] = field(default_factory=list)
    technologies: List[str] = field(default_factory=list)
    summary: str = ""
    created_at: str = ""


@dataclass
class UserPreferences:
    """用户偏好"""
    coding_style: str = ""
    preferred_languages: List[str] = field(default_factory=list)
    preferred_frameworks: List[str] = field(default_factory=list)
    project_background: str = ""
    common_patterns: List[str] = field(default_factory=list)


@dataclass
class Skill:
    """可复用 Skill"""
    name: str = ""
    description: str = ""
    category: str = ""
    content: str = ""
    tags: List[str] = field(default_factory=list)
    created_at: str = ""


class HermesMemoryManager:
    """
    Hermes 跨 Session Memory 管理器
    作用：自动总结对话、提取用户偏好、生成 Skills
    """

    def __init__(self, memory_dir: Optional[str] = None):
        """
        初始化 Memory 管理器
        参数：
          - memory_dir: 记忆存储目录（默认 ~/.hermes/memory/）
        """
        if memory_dir:
            self.memory_dir = Path(memory_dir)
        else:
            self.memory_dir = Path.home() / ".hermes" / "memory"

        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.preferences_file = self.memory_dir / "user_preferences.json"
        self.skills_dir = self.memory_dir / "skills"
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir = self.memory_dir / "sessions"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    async def summarize_session(
        self, session_id: str, conversations: List[Dict[str, Any]]
    ) -> SessionSummary:
        """
        对话总结
        运行步骤：
          1. 提取对话要点
          2. 识别关键决策
          3. 识别技术栈
          4. 存储总结
        参数：
          - session_id: 会话 ID
          - conversations: 对话记录列表
        返回值：SessionSummary 对象
        """
        summary = SessionSummary(
            session_id=session_id,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        if not conversations:
            return summary

        # 提取用户消息
        user_messages = [
            c.get("content", "") for c in conversations
            if c.get("role") == "user"
        ]

        # 提取关键点
        for msg in user_messages:
            # 简单关键词提取
            keywords = ["开发", "实现", "创建", "设计", "修复", "优化",
                       "ROS", "机器人", "仿真", "Gazebo", "控制", "感知"]
            for kw in keywords:
                if kw in msg and kw not in summary.key_points:
                    summary.key_points.append(kw)

        # 提取技术栈
        tech_keywords = ["Python", "C++", "ROS2", "ROS", "FastAPI", "React",
                        "TypeScript", "Docker", "Gazebo", "Isaac", "Sim"]
        for msg in user_messages:
            for tech in tech_keywords:
                if tech.lower() in msg.lower() and tech not in summary.technologies:
                    summary.technologies.append(tech)

        # 生成摘要
        if user_messages:
            summary.title = user_messages[0][:50] if user_messages[0] else "未命名会话"
            summary.summary = f"会话包含 {len(user_messages)} 条用户消息，"
            summary.summary += f"涉及技术: {', '.join(summary.technologies) if summary.technologies else '未识别'}"

        # 存储到文件
        summary_file = self.sessions_dir / f"{session_id}.json"
        try:
            summary_data = {
                "session_id": summary.session_id,
                "title": summary.title,
                "key_points": summary.key_points,
                "decisions": summary.decisions,
                "technologies": summary.technologies,
                "summary": summary.summary,
                "created_at": summary.created_at,
            }
            await asyncio.to_thread(
                summary_file.write_text,
                json.dumps(summary_data, ensure_ascii=False, indent=2),
            )
        except (OSError, IOError) as e:
            logger.warning(f"存储会话总结失败: {e}")

        return summary

    async def extract_preferences(
        self, session_id: str, conversations: List[Dict[str, Any]]
    ) -> UserPreferences:
        """
        用户偏好提取
        运行步骤：
          1. 加载已有偏好
          2. 从对话中提取新偏好
          3. 合并并存储
        参数：
          - session_id: 会话 ID
          - conversations: 对话记录列表
        返回值：UserPreferences 对象
        """
        # 加载已有偏好
        preferences = await self._load_preferences()

        user_messages = [
            c.get("content", "") for c in conversations
            if c.get("role") == "user"
        ]

        # 提取编码风格偏好
        style_indicators = {
            "面向对象": ["class", "继承", "多态", "封装"],
            "函数式": ["lambda", "map", "filter", "reduce"],
            "简洁": ["简单", "简洁", "最小化"],
            "健壮": ["异常处理", "错误处理", "容错", "鲁棒"],
        }
        for msg in user_messages:
            for style, indicators in style_indicators.items():
                if any(ind in msg for ind in indicators):
                    if not preferences.coding_style:
                        preferences.coding_style = style

        # 提取语言偏好
        lang_keywords = {
            "Python": ["python", "py", "pytest"],
            "C++": ["c++", "cpp", "cmake", "catkin"],
            "TypeScript": ["typescript", "ts", "react", "node"],
            "JavaScript": ["javascript", "js", "node"],
        }
        for msg in user_messages:
            for lang, keywords in lang_keywords.items():
                if any(kw in msg.lower() for kw in keywords):
                    if lang not in preferences.preferred_languages:
                        preferences.preferred_languages.append(lang)

        # 存储偏好
        await self._save_preferences(preferences)

        return preferences

    async def generate_skills(
        self, project_context: Dict[str, Any]
    ) -> List[Skill]:
        """
        自动编写 Skills
        运行步骤：
          1. 分析项目中的通用模式
          2. 编写可复用的 Skills
          3. 存储到 Skills 库
        参数：
          - project_context: 项目上下文
        返回值：Skill 列表
        """
        skills: List[Skill] = []

        # 从项目上下文中识别可复用模式
        project_type = project_context.get("type", "")
        technologies = project_context.get("technologies", [])

        # ROS2 项目模板
        if "ROS" in str(technologies) or "ros" in project_type.lower():
            skills.append(Skill(
                name="ROS2 节点模板生成",
                description="生成标准 ROS2 节点代码模板",
                category="ROS2",
                content="# ROS2 节点模板\n\n```python\nimport rclpy\nfrom rclpy.node import Node\n\nclass TemplateNode(Node):\n    def __init__(self):\n        super().__init__('template_node')\n        self.get_logger().info('节点已启动')\n\ndef main(args=None):\n    rclpy.init(args=args)\n    node = TemplateNode()\n    rclpy.spin(node)\n    node.destroy_node()\n    rclpy.shutdown()\n```",
                tags=["ros2", "node", "template"],
                created_at=datetime.now(timezone.utc).isoformat(),
            ))

        # FastAPI 项目模板
        if "FastAPI" in str(technologies) or "fastapi" in project_type.lower():
            skills.append(Skill(
                name="FastAPI 路由模板生成",
                description="生成标准 FastAPI 路由代码模板",
                category="FastAPI",
                content="# FastAPI 路由模板\n\n```python\nfrom fastapi import APIRouter, Depends\nfrom pydantic import BaseModel\n\nrouter = APIRouter()\n\nclass RequestModel(BaseModel):\n    pass\n\n@router.get(\"/items\")\nasync def list_items():\n    return {\"items\": []}\n```",
                tags=["fastapi", "router", "template"],
                created_at=datetime.now(timezone.utc).isoformat(),
            ))

        # React 组件模板
        if "React" in str(technologies) or "react" in project_type.lower():
            skills.append(Skill(
                name="React 组件模板生成",
                description="生成标准 React 组件代码模板",
                category="React",
                content="# React 组件模板\n\n```tsx\nimport React from 'react';\n\ninterface Props {\n  title: string;\n}\n\nexport default function TemplateComponent({ title }: Props) {\n  return <div>{title}</div>;\n}\n```",
                tags=["react", "component", "template"],
                created_at=datetime.now(timezone.utc).isoformat(),
            ))

        # 存储 Skills
        for skill in skills:
            skill_file = self.skills_dir / f"{skill.name.replace(' ', '_').lower()}.json"
            try:
                await asyncio.to_thread(
                    skill_file.write_text,
                    json.dumps({
                        "name": skill.name,
                        "description": skill.description,
                        "category": skill.category,
                        "content": skill.content,
                        "tags": skill.tags,
                        "created_at": skill.created_at,
                    }, ensure_ascii=False, indent=2),
                )
            except (OSError, IOError) as e:
                logger.warning(f"存储 Skill 失败: {e}")

        return skills

    async def load_session_memory(self, session_id: str) -> Optional[SessionSummary]:
        """加载会话记忆"""
        summary_file = self.sessions_dir / f"{session_id}.json"
        if not summary_file.exists():
            return None

        try:
            text = await asyncio.to_thread(summary_file.read_text)
            data = json.loads(text)
            return SessionSummary(
                session_id=data.get("session_id", ""),
                title=data.get("title", ""),
                key_points=data.get("key_points", []),
                decisions=data.get("decisions", []),
                technologies=data.get("technologies", []),
                summary=data.get("summary", ""),
                created_at=data.get("created_at", ""),
            )
        except (json.JSONDecodeError, OSError, IOError) as e:
            logger.warning(f"加载会话记忆失败: {e}")
            return None

    async def load_user_preferences(self) -> UserPreferences:
        """加载用户偏好"""
        return await self._load_preferences()

    async def list_skills(self) -> List[Skill]:
        """列出所有 Skills"""
        skills: List[Skill] = []
        if self.skills_dir.exists():
            for skill_file in self.skills_dir.glob("*.json"):
                try:
                    text = await asyncio.to_thread(skill_file.read_text)
                    data = json.loads(text)
                    skills.append(Skill(
                        name=data.get("name", ""),
                        description=data.get("description", ""),
                        category=data.get("category", ""),
                        content=data.get("content", ""),
                        tags=data.get("tags", []),
                        created_at=data.get("created_at", ""),
                    ))
                except (json.JSONDecodeError, OSError, IOError) as e:
                    logger.warning(f"加载 Skill 文件失败 {skill_file}: {e}")
        return skills

    async def _load_preferences(self) -> UserPreferences:
        """从文件加载用户偏好"""
        if not self.preferences_file.exists():
            return UserPreferences()

        try:
            text = await asyncio.to_thread(self.preferences_file.read_text)
            data = json.loads(text)
            return UserPreferences(
                coding_style=data.get("coding_style", ""),
                preferred_languages=data.get("preferred_languages", []),
                preferred_frameworks=data.get("preferred_frameworks", []),
                project_background=data.get("project_background", ""),
                common_patterns=data.get("common_patterns", []),
            )
        except (json.JSONDecodeError, OSError, IOError) as e:
            logger.warning(f"加载用户偏好失败: {e}")
            return UserPreferences()

    async def _save_preferences(self, preferences: UserPreferences):
        """存储用户偏好到文件"""
        try:
            await asyncio.to_thread(
                self.preferences_file.write_text,
                json.dumps({
                    "coding_style": preferences.coding_style,
                    "preferred_languages": preferences.preferred_languages,
                    "preferred_frameworks": preferences.preferred_frameworks,
                    "project_background": preferences.project_background,
                    "common_patterns": preferences.common_patterns,
                }, ensure_ascii=False, indent=2),
            )
        except (OSError, IOError) as e:
            logger.warning(f"存储用户偏好失败: {e}")
