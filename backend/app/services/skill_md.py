"""
# ============================================================
# SKILL.md 解析器与导入/导出
# ============================================================
# 核心作用：解析、导入、导出 SKILL.md 文件
# 兼容标准：Vercel skills CLI 生态系统
# 创建日期：2026-07-27
# 模块版本：v1.0.0
# ============================================================
"""

import io
import json
import logging
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)


# ============================================================
# SKILL.md 数据模型
# ============================================================

class SkillFrontmatter(BaseModel):
    """SKILL.md YAML 头"""
    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(..., min_length=1, max_length=512)
    argument_hint: Optional[str] = Field(default=None, max_length=64)
    allowed_tools: List[str] = Field(default_factory=list)
    model: Optional[str] = Field(default=None)
    user_invocable: bool = Field(default=True)
    disable_model_invocation: bool = Field(default=False)
    context: Optional[str] = Field(default=None)
    agent: Optional[str] = Field(default=None)
    version: Optional[str] = Field(default="1.0.0")
    tags: List[str] = Field(default_factory=list)


class ParsedSkill(BaseModel):
    """解析后的 SKILL.md"""
    frontmatter: SkillFrontmatter
    body: str
    valid: bool = True
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


# ============================================================
# 解析器
# ============================================================

# YAML 头正则：^---$ ... ^---$（首尾三横线包裹）
FRONTMATTER_PATTERN = re.compile(
    r"\A\s*---\s*\n(.*?)\n---\s*\n(.*)",
    re.DOTALL,
)


def parse_skill_md(content: str) -> ParsedSkill:
    """
    解析 SKILL.md 文件内容
    - 提取 YAML frontmatter（必需）
    - 提取 Markdown body
    - 验证字段格式

    参数:
        content: SKILL.md 文件内容
    返回:
        ParsedSkill 实例
    """
    errors: List[str] = []
    warnings: List[str] = []

    # 匹配 YAML 头
    match = FRONTMATTER_PATTERN.match(content)
    if not match:
        return ParsedSkill(
            frontmatter=SkillFrontmatter(name="unknown", description="(missing)"),
            body=content,
            valid=False,
            errors=["未找到 YAML frontmatter（必须以 --- 开头和结尾）"],
        )

    yaml_content, body = match.group(1), match.group(2)

    # 安全加载 YAML
    try:
        data = yaml.safe_load(yaml_content) or {}
        if not isinstance(data, dict):
            errors.append("YAML 头必须是字典类型")
            data = {}
    except yaml.YAMLError as e:
        return ParsedSkill(
            frontmatter=SkillFrontmatter(name="unknown", description="(yaml_error)"),
            body=body,
            valid=False,
            errors=[f"YAML 解析失败: {e}"],
        )

    # 字段名映射（支持 - 和 _）
    normalized = {}
    for key, value in data.items():
        # 转换 key 为 snake_case（kebab-case → snake_case）
        norm_key = key.replace("-", "_")
        normalized[norm_key] = value

    # 验证
    try:
        frontmatter = SkillFrontmatter(**normalized)
    except ValidationError as e:
        for err in e.errors():
            errors.append(f"{err['loc'][0]}: {err['msg']}")
        # 构造最低限度 frontmatter
        try:
            frontmatter = SkillFrontmatter(
                name=normalized.get("name", "unknown"),
                description=normalized.get("description", ""),
            )
        except Exception:
            frontmatter = SkillFrontmatter(name="unknown", description="")

    # 警告
    if not body.strip():
        warnings.append("Markdown body 为空")
    if len(body) > 50000:
        warnings.append(f"Body 长度较大（{len(body)} 字符），可能影响性能")

    return ParsedSkill(
        frontmatter=frontmatter,
        body=body.strip(),
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


def build_skill_md(frontmatter: SkillFrontmatter, body: str) -> str:
    """
    构建 SKILL.md 文件内容
    """
    # 转 dict，移除 None 值
    data = frontmatter.model_dump(exclude_none=True)
    # 转回 kebab-case 风格（保持与 Vercel 兼容）
    data = {k.replace("_", "-"): v for k, v in data.items()}

    yaml_content = yaml.dump(
        data,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )
    return f"---\n{yaml_content}---\n\n{body}\n"


# ============================================================
# 导入/导出服务
# ============================================================

class SkillImportResult(BaseModel):
    """导入结果"""
    success: bool
    skill_id: Optional[str] = None
    skill_name: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class SkillImportExportService:
    """
    SKILL.md 导入/导出服务
    - 单文件导入/导出
    - 批量 zip 导入/导出
    - 与现有 skills 表集成
    """

    def __init__(self, skills_service=None):
        """
        参数:
            skills_service: 已有的 SkillsService 实例（用于集成存储）
        """
        self.skills_service = skills_service

    def import_from_file(
        self,
        file_content: str,
        filename: str = "SKILL.md",
        overwrite: bool = False,
    ) -> SkillImportResult:
        """
        从 SKILL.md 文件内容导入

        参数:
            file_content: 文件内容
            filename: 文件名（用于错误信息）
            overwrite: 是否覆盖同名 skill
        """
        parsed = parse_skill_md(file_content)
        if not parsed.valid:
            return SkillImportResult(
                success=False,
                errors=parsed.errors,
                warnings=parsed.warnings,
            )

        return self._save_parsed_skill(parsed, overwrite=overwrite)

    def import_from_zip(
        self,
        zip_bytes: bytes,
        overwrite: bool = False,
    ) -> List[SkillImportResult]:
        """
        从 zip 包批量导入
        - zip 内可包含多个 SKILL.md
        - 自动识别 skill 目录结构
        """
        results: List[SkillImportResult] = []

        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
                for name in zf.namelist():
                    # 只处理 .md 文件
                    if not name.endswith(".md"):
                        continue
                    # 跳过 __MACOSX 等系统文件
                    if name.startswith("__"):
                        continue

                    try:
                        content = zf.read(name).decode("utf-8")
                        result = self.import_from_file(
                            content,
                            filename=name,
                            overwrite=overwrite,
                        )
                        result.skill_name = parsed_skill_name(content) or name
                        results.append(result)
                    except Exception as e:
                        results.append(SkillImportResult(
                            success=False,
                            errors=[f"读取 {name} 失败: {e}"],
                        ))
        except zipfile.BadZipFile as e:
            return [SkillImportResult(success=False, errors=[f"无效的 zip 文件: {e}"])]

        return results

    def export_to_md(self, skill: Dict[str, Any]) -> str:
        """
        将 skill 数据导出为 SKILL.md
        """
        frontmatter = SkillFrontmatter(
            name=skill["name"],
            description=skill.get("description", ""),
            argument_hint=None,
            allowed_tools=skill.get("tools", []),
            model=None,
            version=skill.get("version", "1.0.0"),
            tags=[],
        )
        body = skill.get("system_prompt", "")
        return build_skill_md(frontmatter, body)

    def export_to_zip(self, skills: List[Dict[str, Any]]) -> bytes:
        """
        批量导出为 zip
        """
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for skill in skills:
                content = self.export_to_md(skill)
                # zip 路径使用 skill name
                safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", skill["name"])
                path = f"{safe_name}/SKILL.md"
                zf.writestr(path, content)
        return buffer.getvalue()

    def _save_parsed_skill(
        self,
        parsed: ParsedSkill,
        overwrite: bool = False,
    ) -> SkillImportResult:
        """保存到 skills service（如果已注入）"""
        if self.skills_service is None:
            # 没有注入服务，仅返回解析结果
            return SkillImportResult(
                success=parsed.valid,
                skill_name=parsed.frontmatter.name,
                warnings=parsed.warnings,
                errors=parsed.errors,
            )

        fm = parsed.frontmatter
        # 检查是否已存在
        existing = self.skills_service.find_by_name(fm.name) if hasattr(
            self.skills_service, "find_by_name"
        ) else None

        if existing and not overwrite:
            return SkillImportResult(
                success=False,
                skill_name=fm.name,
                errors=[f"Skill '{fm.name}' 已存在，请启用 overwrite 或使用不同名称"],
            )

        try:
            skill_data = {
                "name": fm.name,
                "display_name": fm.name,
                "description": fm.description,
                "system_prompt": parsed.body,
                "tools": fm.allowed_tools,
                "source": "skill_md_import",
                "version": fm.version or "1.0.0",
                "enabled": True,
            }

            if existing and overwrite and hasattr(self.skills_service, "update_skill"):
                skill_id = existing["id"]
                self.skills_service.update_skill(skill_id, skill_data)
            else:
                if hasattr(self.skills_service, "create_skill"):
                    skill_id = self.skills_service.create_skill(skill_data)
                else:
                    skill_id = None

            return SkillImportResult(
                success=True,
                skill_id=skill_id,
                skill_name=fm.name,
                warnings=parsed.warnings,
            )
        except Exception as e:
            return SkillImportResult(
                success=False,
                skill_name=fm.name,
                errors=[f"保存失败: {e}"],
            )


def parsed_skill_name(content: str) -> Optional[str]:
    """从 SKILL.md 内容中提取 name 字段（辅助函数）"""
    parsed = parse_skill_md(content)
    if parsed.valid:
        return parsed.frontmatter.name
    return None
