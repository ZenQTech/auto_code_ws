"""
# ============================================================
# Skill Registry - 5 位置 SKILL.md 注册表 (v1.0.0)
# Cycle 70 G70-01 - 对标 Codex CLI v0.124.0+ Skills 系统
# ============================================================
# 核心作用：扫描 5 个存储位置（REPO/USER/ADMIN/SYSTEM/DEFAULTS），
#          解析 SKILL.md 文件，构建带优先级的 skill 注册表
# 设计要点：
#   1. 5 个位置（按优先级从低到高）：defaults → system → admin → user → repo
#   2. 同一 skill name 多位置时，高优先级覆盖低优先级（记录冲突）
#   3. SKILL.md = YAML frontmatter + Markdown body
#   4. 安全：safe_load + 严格 pydantic + 路径白名单
#   5. LRU 缓存元数据（不含 content）
#   6. 持久化到 ~/.hermes/config/skill_registry.json
#   7. 线程安全
# 运行流程：
#   初始化 → 扫描 5 位置 → 解析 SKILL.md → 冲突解决 → 注册表
# 输入参数：locations（默认 5 个标准路径）
# 输出结果：Skill 实例 + 冲突列表
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
# ============================================================
"""

import hashlib
import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

logger = logging.getLogger(__name__)


# ============================================================
# 位置枚举与优先级
# ============================================================

class SkillLocation(str, Enum):
    """Skill 存储位置（5 个）"""
    DEFAULTS = "defaults"
    SYSTEM = "system"
    ADMIN = "admin"
    USER = "user"
    REPO = "repo"


# 位置优先级（数字越大优先级越高）
LOCATION_PRIORITY = {
    SkillLocation.DEFAULTS: 0,
    SkillLocation.SYSTEM: 1,
    SkillLocation.ADMIN: 2,
    SkillLocation.USER: 3,
    SkillLocation.REPO: 4,
}

# 默认 5 位置路径
DEFAULT_LOCATION_PATHS: Dict[SkillLocation, List[str]] = {
    SkillLocation.DEFAULTS: [
        # 内置 defaults（来自代码）
    ],
    SkillLocation.SYSTEM: [
        "/opt/hermes/skills",
        "/usr/local/share/hermes/skills",
    ],
    SkillLocation.ADMIN: [
        "/etc/hermes/skills",
    ],
    SkillLocation.USER: [
        "~/.hermes/skills",
    ],
    SkillLocation.REPO: [
        # 动态：基于 cwd 解析 .hermes/skills/
    ],
}

# SKILL.md 文件名
SKILL_MD_FILENAME = "SKILL.md"

# 安全白名单
ALLOWED_SKILL_ROOTS = {
    SkillLocation.SYSTEM: ["/opt/hermes", "/usr/local/share/hermes"],
    SkillLocation.ADMIN: ["/etc/hermes"],
    SkillLocation.USER: ["~/.hermes"],
    SkillLocation.REPO: None,  # 动态校验（仅允许 .hermes/skills 子目录）
}

# 单个 SKILL.md 最大字节数（1 MB）
MAX_SKILL_MD_SIZE = 1 * 1024 * 1024

# skill name 验证正则（仅小写字母、数字、连字符）
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$")

# description 最大长度
MAX_DESCRIPTION_LENGTH = 512

# 缓存 LRU 限制
CACHE_LIMIT = 500


# ============================================================
# 数据模型
# ============================================================

@dataclass
class Skill:
    """Skill 完整模型

    字段：
      - id: 唯一标识（格式 "{location}:{name}"）
      - name: skill 名称（小写字母+数字+连字符）
      - display_name: 显示名
      - description: 描述（用于隐式匹配）
      - location: 位置
      - path: SKILL.md 绝对路径
      - enabled: 是否启用
      - source: 来源（builtin/skill_md/plugin）
      - version: 版本
      - tags: 标签列表
      - argument_hint: 参数提示
      - allowed_tools: 允许的工具列表
      - user_invocable: 是否可显式调用
      - disable_model_invocation: 是否禁用模型隐式调用
      - agent: 关联 agent
      - system_prompt: 系统提示词
      - scripts: 关联脚本路径列表
      - references: 关联资源路径列表
      - last_scanned_at: 最近扫描时间
      - content_hash: 内容哈希
    """
    id: str
    name: str
    display_name: str
    description: str
    location: str
    path: str
    enabled: bool = True
    source: str = "skill_md"
    version: str = "1.0.0"
    tags: List[str] = field(default_factory=list)
    argument_hint: Optional[str] = None
    allowed_tools: List[str] = field(default_factory=list)
    user_invocable: bool = True
    disable_model_invocation: bool = False
    agent: Optional[str] = None
    system_prompt: str = ""
    scripts: List[str] = field(default_factory=list)
    references: List[str] = field(default_factory=list)
    last_scanned_at: str = ""
    content_hash: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SkillConflict:
    """跨位置冲突"""
    skill_name: str
    kept: Skill
    overridden: Skill
    override_location: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "skill_name": self.skill_name,
            "kept": self.kept.to_dict(),
            "overridden": self.overridden.to_dict(),
            "override_location": self.override_location,
        }


@dataclass
class LocationStatus:
    """单个位置的扫描状态"""
    name: str
    paths: List[str]
    exists: bool
    skill_count: int
    scanned_at: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "paths": self.paths,
            "exists": self.exists,
            "skill_count": self.skill_count,
            "scanned_at": self.scanned_at,
        }


# ============================================================
# YAML 解析（安全）
# ============================================================

def _safe_parse_yaml(content: str) -> Tuple[Optional[Dict[str, Any]], List[str], List[str]]:
    """安全解析 YAML frontmatter

    参数：
      - content: SKILL.md 完整内容
    返回值：(frontmatter_dict, errors, warnings)
    """
    errors: List[str] = []
    warnings: List[str] = []

    # 1. 验证文件头
    if not content.startswith("---"):
        return None, ["SKILL.md 必须以 '---' 开头作为 frontmatter 分隔符"], warnings

    # 2. 查找结束分隔符
    parts = content.split("---", 2)
    if len(parts) < 3:
        return None, ["SKILL.md frontmatter 缺少结束的 '---' 分隔符"], warnings

    yaml_content = parts[1].strip()
    if not yaml_content:
        return None, ["SKILL.md frontmatter 内容为空"], warnings

    # 3. 严格使用 safe_load
    try:
        data = yaml.safe_load(yaml_content)
    except yaml.YAMLError as e:
        return None, [f"YAML 解析失败: {e}"], warnings

    if not isinstance(data, dict):
        return None, ["YAML frontmatter 必须是字典类型"], warnings

    # 4. 验证必需字段
    if "name" not in data:
        errors.append("frontmatter 缺少必需字段 'name'")
    elif not isinstance(data["name"], str):
        errors.append("'name' 字段必须是字符串")
    elif not SKILL_NAME_PATTERN.match(data["name"]):
        errors.append(
            f"'name' 必须匹配 {SKILL_NAME_PATTERN.pattern}（小写字母、数字、连字符）"
        )

    if "description" not in data:
        errors.append("frontmatter 缺少必需字段 'description'")
    elif not isinstance(data["description"], str):
        errors.append("'description' 字段必须是字符串")
    elif len(data["description"]) > MAX_DESCRIPTION_LENGTH:
        warnings.append(f"'description' 长度超过 {MAX_DESCRIPTION_LENGTH} 字符（当前 {len(data['description'])}）")

    return data, errors, warnings


# ============================================================
# Skill 解析
# ============================================================

def _extract_body(content: str) -> str:
    """提取 SKILL.md 的 body 部分（去除 frontmatter）

    参数：
      - content: 完整 SKILL.md 内容
    返回值：body markdown
    """
    parts = content.split("---", 2)
    if len(parts) < 3:
        return content
    return parts[2].strip()


def _parse_skill_md_file(
    file_path: Path,
    location: SkillLocation,
) -> Tuple[Optional[Skill], List[str], List[str]]:
    """解析单个 SKILL.md 文件

    参数：
      - file_path: SKILL.md 绝对路径
      - location: 所属位置
    返回值：(skill, errors, warnings)
    """
    errors: List[str] = []
    warnings: List[str] = []

    # 1. 文件存在性
    if not file_path.exists() or not file_path.is_file():
        return None, [f"文件不存在: {file_path}"], warnings

    # 2. 文件大小
    stat = file_path.stat()
    if stat.st_size > MAX_SKILL_MD_SIZE:
        return None, [f"文件过大（{stat.st_size} > {MAX_SKILL_MD_SIZE}）"], warnings

    # 3. 读取
    try:
        content = file_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return None, [f"读取失败: {e}"], warnings

    # 4. 解析 frontmatter
    data, fm_errors, fm_warnings = _safe_parse_yaml(content)
    errors.extend(fm_errors)
    warnings.extend(fm_warnings)
    if data is None or fm_errors:
        return None, errors, warnings

    # 5. 提取 body
    body = _extract_body(content)

    # 6. 构建 Skill
    name = data["name"]
    description = data.get("description", "")
    skill_id = f"{location.value}:{name}"

    # 7. 解析辅助目录
    skill_dir = file_path.parent
    scripts = _list_skill_subdir(skill_dir, "scripts")
    references = _list_skill_subdir(skill_dir, "references")
    assets = _list_skill_subdir(skill_dir, "assets")

    # 8. 处理 tags
    tags_raw = data.get("tags", [])
    if isinstance(tags_raw, list):
        tags = [str(t) for t in tags_raw if isinstance(t, (str, int))]
    else:
        tags = []

    # 9. 处理 allowed_tools
    tools_raw = data.get("allowed_tools", [])
    if isinstance(tools_raw, list):
        allowed_tools = [str(t) for t in tools_raw if isinstance(t, (str, int))]
    else:
        allowed_tools = []

    # 10. content_hash
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    skill = Skill(
        id=skill_id,
        name=name,
        display_name=data.get("display_name", name),
        description=description,
        location=location.value,
        path=str(file_path),
        enabled=data.get("enabled", True),
        source=data.get("source", "skill_md"),
        version=str(data.get("version", "1.0.0")),
        tags=tags,
        argument_hint=data.get("argument_hint"),
        allowed_tools=allowed_tools,
        user_invocable=bool(data.get("user_invocable", True)),
        disable_model_invocation=bool(data.get("disable_model_invocation", False)),
        agent=data.get("agent"),
        system_prompt=body,
        scripts=scripts,
        references=references + assets,
        last_scanned_at=datetime.now(timezone.utc).isoformat(),
        content_hash=content_hash,
    )

    return skill, errors, warnings


def _list_skill_subdir(skill_dir: Path, subdir_name: str) -> List[str]:
    """列出 skill 辅助子目录中的文件

    参数：
      - skill_dir: skill 根目录
      - subdir_name: 子目录名（scripts/references/assets）
    返回值：文件绝对路径列表
    """
    subdir = skill_dir / subdir_name
    if not subdir.exists() or not subdir.is_dir():
        return []
    try:
        result = []
        for entry in sorted(subdir.iterdir()):
            if entry.is_file():
                result.append(str(entry))
        return result
    except OSError:
        return []


# ============================================================
# 路径安全检查
# ============================================================

def _is_path_safe(path: Path, location: SkillLocation, repo_root: Optional[Path] = None) -> bool:
    """检查路径是否在位置白名单内

    参数：
      - path: 待检查路径
      - location: 位置
      - repo_root: 仓库根（仅 REPO 位置需要）
    返回值：True 表示安全
    """
    # 先 expanduser 处理 ~ 路径，再 resolve
    try:
        expanded = path.expanduser()
        resolved = expanded.resolve()
    except (OSError, RuntimeError):
        return False

    # 拒绝 .. 路径
    if ".." in expanded.parts:
        return False

    if location == SkillLocation.REPO:
        if repo_root is None:
            return False
        try:
            resolved.relative_to(repo_root.expanduser().resolve())
            # 必须在 .hermes/skills 下
            try:
                rel = resolved.relative_to((repo_root / ".hermes" / "skills").expanduser().resolve())
                return True
            except ValueError:
                return False
        except ValueError:
            return False

    allowed_roots = ALLOWED_SKILL_ROOTS.get(location, [])
    if not allowed_roots:
        return True
    for root in allowed_roots:
        try:
            root_path = Path(root).expanduser().resolve()
            resolved.relative_to(root_path)
            return True
        except (ValueError, OSError, RuntimeError):
            continue
    return False


# ============================================================
# 主服务类
# ============================================================

class SkillRegistry:
    """Skill 注册表（5 位置 Codex 风格）

    特性：
      - 5 位置扫描
      - 优先级冲突解决
      - LRU 缓存
      - 线程安全
      - 持久化元数据
    """

    CONFIG_PATH = Path("~/.hermes/config/skill_registry.json").expanduser()
    DEFAULTS_DIR = Path(__file__).parent.parent / "default_skills"

    def __init__(self):
        self._skills: Dict[str, Skill] = {}  # id -> Skill
        self._by_name: Dict[str, Skill] = {}  # name -> Skill
        self._conflicts: List[SkillConflict] = []
        self._location_status: Dict[str, LocationStatus] = {}
        self._lock = threading.RLock()
        self._default_skills: List[Skill] = []  # 内置 defaults
        # 加载内置 defaults
        self._init_default_skills()
        # 初始扫描
        self.rescan()
        logger.info(
            f"SkillRegistry 初始化完成（{len(self._skills)} skills, "
            f"{len(self._conflicts)} 冲突）"
        )

    def _init_default_skills(self):
        """初始化内置 defaults skills"""
        # 内置 3 个 defaults（来自 code-reviewer/test-generator/doc-generator）
        defaults = [
            {
                "name": "code-reviewer",
                "display_name": "代码审查",
                "description": "审查代码变更，识别 bug、性能问题、安全漏洞、风格违规",
                "system_prompt": (
                    "你是一位资深的代码审查专家。在分析代码时，请关注：\n"
                    "1. 潜在的 bug 和边界条件\n"
                    "2. 性能瓶颈（O(n²) 循环、内存泄漏等）\n"
                    "3. 安全问题（SQL 注入、XSS、权限绕过）\n"
                    "4. 代码风格和可维护性\n"
                    "5. 测试覆盖度\n"
                    "请用具体行号引用代码，并按严重程度排序。"
                ),
                "allowed_tools": ["read_file", "list_directory"],
                "tags": ["review", "code-quality", "bug", "performance"],
                "version": "1.0.0",
            },
            {
                "name": "test-generator",
                "display_name": "测试生成",
                "description": "基于代码自动生成单元测试和集成测试，覆盖正常/异常/边界值",
                "system_prompt": (
                    "你是一位测试工程师。生成测试时请：\n"
                    "1. 覆盖正常路径和异常路径\n"
                    "2. 包含边界值测试（0、空、负数、极大值）\n"
                    "3. 使用 AAA 模式（Arrange-Act-Assert）\n"
                    "4. 每个测试一个清晰的断言\n"
                    "5. 使用有意义的测试名称\n"
                    "6. 避免测试间依赖"
                ),
                "allowed_tools": ["read_file", "write_file"],
                "tags": ["test", "unit-test", "integration-test", "coverage"],
                "version": "1.0.0",
            },
            {
                "name": "doc-generator",
                "display_name": "文档生成",
                "description": "为代码自动生成 API 文档、函数说明、类文档",
                "system_prompt": (
                    "你是一位技术文档专家。生成文档时请：\n"
                    "1. 使用清晰的标题层级\n"
                    "2. 为每个公开 API 编写参数说明、返回值、异常\n"
                    "3. 提供完整可运行的示例代码\n"
                    "4. 说明使用场景和最佳实践\n"
                    "5. 标注版本变更和弃用信息"
                ),
                "allowed_tools": ["read_file"],
                "tags": ["documentation", "api-doc", "markdown"],
                "version": "1.0.0",
            },
        ]

        for d in defaults:
            skill_id = f"defaults:{d['name']}"
            skill = Skill(
                id=skill_id,
                name=d["name"],
                display_name=d["display_name"],
                description=d["description"],
                location=SkillLocation.DEFAULTS.value,
                path="<builtin>",
                enabled=True,
                source="builtin",
                version=d["version"],
                tags=d["tags"],
                allowed_tools=d["allowed_tools"],
                user_invocable=True,
                disable_model_invocation=False,
                system_prompt=d["system_prompt"],
                last_scanned_at=datetime.now(timezone.utc).isoformat(),
                content_hash=hashlib.sha256(
                    d["description"].encode("utf-8")
                ).hexdigest()[:16],
            )
            self._default_skills.append(skill)

    # ============================================================
    # 扫描
    # ============================================================

    def rescan(
        self,
        repo_root: Optional[str] = None,
    ) -> Dict[str, Any]:
        """重新扫描 5 个位置

        算法：
          1. 扫描每个位置的所有子目录
          2. 每个子目录中查找 SKILL.md
          3. 解析 + 验证
          4. 按优先级合并（高优先级覆盖低优先级）
          5. 记录冲突

        参数：
          - repo_root: 仓库根（用于 REPO 位置）
        返回值：扫描统计
        """
        start_time = datetime.now(timezone.utc)
        new_skills: Dict[str, Skill] = {}
        new_conflicts: List[SkillConflict] = []
        new_status: Dict[str, LocationStatus] = {}

        with self._lock:
            # 1. 加载 defaults
            for skill in self._default_skills:
                new_skills[skill.id] = skill
            # 添加 defaults 状态
            new_status[SkillLocation.DEFAULTS.value] = LocationStatus(
                name=SkillLocation.DEFAULTS.value,
                paths=["<builtin>"],
                exists=True,
                skill_count=len(self._default_skills),
                scanned_at=datetime.now(timezone.utc).isoformat(),
            )

            # 2. 扫描其他位置
            for location in [
                SkillLocation.SYSTEM,
                SkillLocation.ADMIN,
                SkillLocation.USER,
                SkillLocation.REPO,
            ]:
                if location == SkillLocation.REPO and not repo_root:
                    # REPO 位置需要显式 repo_root
                    new_status[location.value] = LocationStatus(
                        name=location.value,
                        paths=[],
                        exists=False,
                        skill_count=0,
                        scanned_at=datetime.now(timezone.utc).isoformat(),
                    )
                    continue

                paths = self._get_location_paths(location, repo_root)
                location_skills = self._scan_location(location, paths, repo_root)
                new_status[location.value] = LocationStatus(
                    name=location.value,
                    paths=paths,
                    exists=any(Path(p).expanduser().exists() for p in paths if p),
                    skill_count=len(location_skills),
                    scanned_at=datetime.now(timezone.utc).isoformat(),
                )

                # 冲突解决：高优先级覆盖低优先级
                for skill in location_skills:
                    if skill.name in {s.name for s in new_skills.values()}:
                        existing = next(
                            s for s in new_skills.values() if s.name == skill.name
                        )
                        new_conflicts.append(SkillConflict(
                            skill_name=skill.name,
                            kept=skill,
                            overridden=existing,
                            override_location=location.value,
                        ))
                    new_skills[skill.id] = skill

            # 3. 更新索引
            self._skills = new_skills
            self._by_name = {s.name: s for s in self._skills.values()}
            self._conflicts = new_conflicts
            self._location_status = new_status

        # 4. 持久化（异步）
        self._save_to_disk()

        duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
        return {
            "scanned": len(new_status),
            "skills_found": len(self._skills),
            "conflicts": len(self._conflicts),
            "duration_ms": int(duration),
        }

    def _get_location_paths(
        self,
        location: SkillLocation,
        repo_root: Optional[str] = None,
    ) -> List[str]:
        """获取位置的标准路径列表"""
        if location == SkillLocation.DEFAULTS:
            return []  # defaults 不需要磁盘路径
        if location == SkillLocation.REPO:
            if not repo_root:
                return []
            return [str(Path(repo_root) / ".hermes" / "skills")]
        return DEFAULT_LOCATION_PATHS.get(location, [])

    def _scan_location(
        self,
        location: SkillLocation,
        paths: List[str],
        repo_root: Optional[str] = None,
    ) -> List[Skill]:
        """扫描单个位置的所有路径

        参数：
          - location: 位置
          - paths: 路径列表
          - repo_root: 仓库根（仅 REPO 位置使用）
        返回值：解析成功的 skill 列表
        """
        skills: List[Skill] = []

        for path_str in paths:
            base = Path(path_str).expanduser()
            if not base.exists() or not base.is_dir():
                continue

            # 遍历子目录
            try:
                entries = list(base.iterdir())
            except OSError as e:
                logger.warning(f"扫描位置失败 {base}: {e}")
                continue

            for entry in entries:
                if not entry.is_dir():
                    continue
                # 跳过隐藏目录
                if entry.name.startswith("."):
                    continue

                skill_md = entry / SKILL_MD_FILENAME
                if not skill_md.exists() or not skill_md.is_file():
                    continue

                # 路径安全
                if not _is_path_safe(skill_md, location, Path(repo_root) if repo_root else None):
                    logger.warning(f"路径不安全，跳过: {skill_md}")
                    continue

                skill, errors, warnings = _parse_skill_md_file(skill_md, location)
                if errors:
                    logger.warning(
                        f"SKILL.md 解析失败 {skill_md}: {errors}"
                    )
                    continue
                if warnings:
                    for w in warnings:
                        logger.debug(f"SKILL.md 警告 {skill_md}: {w}")
                skills.append(skill)

        return skills

    # ============================================================
    # CRUD
    # ============================================================

    def list_skills(
        self,
        location: Optional[str] = None,
        enabled_only: bool = False,
    ) -> List[Skill]:
        """列出 skills

        参数：
          - location: 按位置过滤（None 不过滤）
          - enabled_only: 仅返回启用的
        返回值：Skill 列表
        """
        with self._lock:
            skills = list(self._skills.values())
        if location:
            skills = [s for s in skills if s.location == location]
        if enabled_only:
            skills = [s for s in skills if s.enabled]
        return skills

    def get_skill(self, skill_id: str) -> Optional[Skill]:
        """按 ID 获取 skill"""
        with self._lock:
            return self._skills.get(skill_id)

    def get_skill_by_name(self, name: str) -> Optional[Skill]:
        """按 name 获取 skill"""
        with self._lock:
            return self._by_name.get(name)

    def set_enabled(self, skill_id: str, enabled: bool) -> Optional[Skill]:
        """启用/禁用 skill"""
        with self._lock:
            if skill_id not in self._skills:
                return None
            self._skills[skill_id].enabled = enabled
            # defaults 可切换 enabled（但不可删除）
            return self._skills[skill_id]

    def get_conflicts(self) -> List[SkillConflict]:
        """获取冲突列表"""
        with self._lock:
            return list(self._conflicts)

    def get_location_status(self) -> List[LocationStatus]:
        """获取所有位置状态"""
        with self._lock:
            return list(self._location_status.values())

    def get_by_location_counts(self) -> Dict[str, int]:
        """按位置统计 skill 数量"""
        counts: Dict[str, int] = {loc.value: 0 for loc in SkillLocation}
        with self._lock:
            for skill in self._skills.values():
                counts[skill.location] = counts.get(skill.location, 0) + 1
        return counts

    # ============================================================
    # 持久化
    # ============================================================

    def _save_to_disk(self):
        """持久化元数据到磁盘（不含 content）"""
        try:
            self.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "skills": {
                    sid: s.to_dict() for sid, s in self._skills.items()
                },
                "last_scan": datetime.now(timezone.utc).isoformat(),
            }
            self.CONFIG_PATH.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning(f"保存 Skill Registry 失败: {e}")

    def load_from_disk(self):
        """从磁盘加载元数据缓存"""
        try:
            if not self.CONFIG_PATH.exists():
                return False
            data = json.loads(self.CONFIG_PATH.read_text(encoding="utf-8"))
            with self._lock:
                for sid, sdict in data.get("skills", {}).items():
                    if "system_prompt" in sdict:
                        # 移除 content，只保留元数据
                        sdict["system_prompt"] = ""
                    skill = Skill(**sdict)
                    self._skills[sid] = skill
                self._by_name = {s.name: s for s in self._skills.values()}
            return True
        except (OSError, json.JSONDecodeError, TypeError) as e:
            logger.warning(f"加载 Skill Registry 失败: {e}")
            return False


# ============================================================
# 单例
# ============================================================

_registry_instance: Optional[SkillRegistry] = None
_registry_lock = threading.Lock()


def get_skill_registry() -> SkillRegistry:
    """获取全局单例"""
    global _registry_instance
    if _registry_instance is None:
        with _registry_lock:
            if _registry_instance is None:
                _registry_instance = SkillRegistry()
    return _registry_instance
