"""
# ============================================================
# Hermes Goal Templates - 模板库管理（Manager）
# ============================================================
# 核心作用：管理 Goal 模板的注册、查询、实例化、统计
# 运行流程：
#   1. 启动时自动加载内置模板（6 类）
#   2. 支持用户通过 API 注册/更新/删除自定义模板
#   3. 实例化时生成 goal_id + 完整 AC 列表 + 初始配置
# 特性：
#   - 内置模板不可删除但可 fork 为自定义模板
#   - 模板版本管理（每次 update 递增 version）
#   - 实例化计数（instantiations +1）
#   - 线程安全（RLock）
#   - 持久化（JSON 文件 + 原子写入）
# 复用说明：
#   - 零外部依赖（仅 stdlib）
#   - 与 /goal 系统解耦（仅生成初始配置数据，不直接创建 Goal）
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 14 P1-5 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .models import (
    AcceptanceCriterionTemplate,
    GoalTemplate,
    TemplateCategory,
    TemplateInstantiation,
    TemplateSource,
)

logger = logging.getLogger(__name__)


# ============================================================
# 名称验证
# ============================================================
# 名称允许：英文/数字/中文/常见符号（_-./ + 空格），最长 128 字符
_NAME_PATTERN = re.compile(r"^[\w\s\-./()（）[\]【】]{1,128}$", re.UNICODE)
_TAG_PATTERN = re.compile(r"^[\w\-./]{1,32}$", re.UNICODE)


def _validate_name(name: str) -> Tuple[bool, str]:
    """验证模板名称"""
    if not name or not name.strip():
        return False, "name is empty"
    if len(name) > 128:
        return False, "name too long (max 128)"
    if not _NAME_PATTERN.match(name):
        return False, "name contains invalid characters"
    return True, ""


def _validate_tags(tags: List[str]) -> Tuple[bool, str]:
    """验证标签列表"""
    if not isinstance(tags, list):
        return False, "tags must be a list"
    for tag in tags:
        if not isinstance(tag, str):
            return False, "each tag must be a string"
        if not _TAG_PATTERN.match(tag):
            return False, f"tag '{tag}' contains invalid characters"
    return True, ""


# ============================================================
# 全局单例
# ============================================================
_global_manager: Optional[TemplateManager] = None
_global_lock = threading.Lock()


def get_manager(storage_dir: Optional[str] = None) -> TemplateManager:
    """
    获取全局模板管理器单例
    参数：
      - storage_dir: 存储目录（仅在首次创建时生效）
    """
    global _global_manager
    with _global_lock:
        if _global_manager is None:
            _global_manager = TemplateManager(storage_dir=storage_dir)
        return _global_manager


def reset_manager() -> None:
    """重置全局模板管理器（用于测试）"""
    global _global_manager
    with _global_lock:
        _global_manager = None


# ============================================================
# 模板库管理器
# ============================================================
class TemplateManager:
    """Goal 模板库管理器"""

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        """
        初始化模板库管理器
        参数：
          - storage_dir: 持久化目录（None 则使用临时目录）
        """
        self._lock = threading.RLock()
        self._templates: Dict[str, GoalTemplate] = {}
        self._instantiations: List[TemplateInstantiation] = []

        if storage_dir:
            self._storage_dir = Path(storage_dir)
        else:
            import tempfile
            self._storage_dir = Path(tempfile.mkdtemp(prefix="goal_templates_"))
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._templates_file = self._storage_dir / "templates.jsonl"
        self._instantiations_file = self._storage_dir / "instantiations.jsonl"

        # 加载持久化数据
        self._load_templates()
        self._load_instantiations()

        # 初始化时若无内置模板则自动加载
        if not any(t.is_builtin() for t in self._templates.values()):
            self._install_builtin_templates()

    # ============================================================
    # 持久化
    # ============================================================
    def _load_templates(self) -> None:
        """从文件加载模板"""
        if not self._templates_file.exists():
            return
        try:
            with open(self._templates_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        tpl = GoalTemplate.from_dict(data)
                        self._templates[tpl.template_id] = tpl
                    except (json.JSONDecodeError, KeyError, TypeError) as e:
                        logger.warning("Failed to load template: %s", e)
        except OSError as e:
            logger.warning("Failed to read templates file: %s", e)

    def _save_template(self, tpl: GoalTemplate) -> None:
        """追加保存模板到文件（每次保存追加，最后会清理过期）"""
        try:
            with open(self._templates_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(tpl.to_dict(), ensure_ascii=False) + "\n")
        except OSError as e:
            logger.error("Failed to save template: %s", e)

    def _rewrite_templates(self) -> None:
        """重写整个模板文件（用于更新/删除后）"""
        try:
            tmp = self._templates_file.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                for tpl in self._templates.values():
                    f.write(json.dumps(tpl.to_dict(), ensure_ascii=False) + "\n")
            tmp.replace(self._templates_file)
        except OSError as e:
            logger.error("Failed to rewrite templates file: %s", e)

    def _load_instantiations(self) -> None:
        """加载实例化历史"""
        if not self._instantiations_file.exists():
            return
        try:
            with open(self._instantiations_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        self._instantiations.append(TemplateInstantiation.from_dict(data))
                    except (json.JSONDecodeError, KeyError, TypeError) as e:
                        logger.warning("Failed to load instantiation: %s", e)
        except OSError as e:
            logger.warning("Failed to read instantiations file: %s", e)

    def _append_instantiation(self, inst: TemplateInstantiation) -> None:
        """追加实例化历史"""
        try:
            with open(self._instantiations_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(inst.to_dict(), ensure_ascii=False) + "\n")
        except OSError as e:
            logger.error("Failed to save instantiation: %s", e)

    # ============================================================
    # 内置模板
    # ============================================================
    def _install_builtin_templates(self) -> None:
        """安装 6 类内置模板"""
        builtin_templates = self._get_builtin_template_definitions()
        for tpl in builtin_templates:
            tpl.source = TemplateSource.BUILTIN.value
            self._templates[tpl.template_id] = tpl
            self._save_template(tpl)
        logger.info("Installed %d builtin templates", len(builtin_templates))

    def _get_builtin_template_definitions(self) -> List[GoalTemplate]:
        """获取内置模板定义"""
        return [
            # 1. 功能开发模板
            GoalTemplate(
                template_id="tpl_builtin_feature_dev",
                name="功能开发模板",
                description="标准功能开发流程：需求分析 → 设计 → 实现 → 测试 → 文档",
                category=TemplateCategory.DEVELOPMENT.value,
                source=TemplateSource.BUILTIN.value,
                tags=["feature", "development", "agile"],
                acceptance_criteria=[
                    AcceptanceCriterionTemplate(
                        ac_id="ac_req",
                        title="需求分析",
                        description="分析用户需求，明确功能边界与验收标准",
                        priority=9,
                        ac_type="documentation",
                        risk_level="low",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_design",
                        title="架构设计",
                        description="设计模块结构、接口定义、数据流",
                        priority=8,
                        ac_type="documentation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_impl",
                        title="功能实现",
                        description="按设计文档实现功能代码",
                        priority=7,
                        ac_type="implementation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_test",
                        title="单元测试",
                        description="为核心功能编写单元测试，覆盖率 ≥80%",
                        priority=6,
                        ac_type="testing",
                        risk_level="low",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_doc",
                        title="文档完善",
                        description="补充 README/API 文档/使用示例",
                        priority=3,
                        ac_type="documentation",
                        risk_level="low",
                    ),
                ],
                default_strategy="standard",
                default_max_turns=30,
                default_triggers=["manual", "ac_completed"],
                recommended_agents=["architect", "implementer", "tester", "documenter"],
                estimated_duration_min=240,
                created_by="system",
            ),
            # 2. Bug 修复模板
            GoalTemplate(
                template_id="tpl_builtin_bug_fix",
                name="Bug 修复模板",
                description="Bug 修复流程：复现 → 定位 → 修复 → 回归测试",
                category=TemplateCategory.DEVELOPMENT.value,
                source=TemplateSource.BUILTIN.value,
                tags=["bug", "fix", "hotfix"],
                acceptance_criteria=[
                    AcceptanceCriterionTemplate(
                        ac_id="ac_repro",
                        title="Bug 复现",
                        description="编写最小复现步骤，输出复现脚本",
                        priority=9,
                        ac_type="testing",
                        risk_level="low",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_locate",
                        title="根因分析",
                        description="定位 Bug 根因，记录分析过程",
                        priority=8,
                        ac_type="documentation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_fix",
                        title="代码修复",
                        description="实施修复方案，最小化变更",
                        priority=7,
                        ac_type="implementation",
                        risk_level="high",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_regression",
                        title="回归测试",
                        description="验证修复有效且未引入新 Bug",
                        priority=8,
                        ac_type="testing",
                        risk_level="high",
                    ),
                ],
                default_strategy="conservative",
                default_max_turns=20,
                default_triggers=["manual"],
                recommended_agents=["implementer", "verifier", "tester"],
                estimated_duration_min=120,
                created_by="system",
            ),
            # 3. 代码重构模板
            GoalTemplate(
                template_id="tpl_builtin_refactor",
                name="代码重构模板",
                description="安全重构流程：基线测试 → 重构 → 行为不变验证",
                category=TemplateCategory.REFACTORING.value,
                source=TemplateSource.BUILTIN.value,
                tags=["refactor", "cleanup", "tech-debt"],
                acceptance_criteria=[
                    AcceptanceCriterionTemplate(
                        ac_id="ac_baseline",
                        title="基线测试",
                        description="建立重构前的测试基线（100% 通过）",
                        priority=9,
                        ac_type="testing",
                        risk_level="low",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_analyze",
                        title="重构分析",
                        description="识别代码异味、设计改进方案",
                        priority=7,
                        ac_type="documentation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_refactor",
                        title="分步重构",
                        description="按小步增量原则重构，每步保持测试通过",
                        priority=6,
                        ac_type="implementation",
                        risk_level="high",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_verify",
                        title="行为不变验证",
                        description="对比基线，验证对外行为完全一致",
                        priority=9,
                        ac_type="testing",
                        risk_level="high",
                    ),
                ],
                default_strategy="conservative",
                default_max_turns=40,
                default_triggers=["manual", "ac_completed"],
                recommended_agents=["architect", "implementer", "tester", "reviewer"],
                estimated_duration_min=360,
                created_by="system",
            ),
            # 4. 研究探索模板
            GoalTemplate(
                template_id="tpl_builtin_research",
                name="研究探索模板",
                description="技术调研流程：背景 → 调研 → 验证 → 报告",
                category=TemplateCategory.RESEARCH.value,
                source=TemplateSource.BUILTIN.value,
                tags=["research", "investigation", "poc"],
                acceptance_criteria=[
                    AcceptanceCriterionTemplate(
                        ac_id="ac_bg",
                        title="背景调研",
                        description="收集相关技术资料、竞品分析",
                        priority=8,
                        ac_type="documentation",
                        risk_level="low",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_compare",
                        title="方案对比",
                        description="对比 3+ 候选方案，列出优劣",
                        priority=7,
                        ac_type="documentation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_poc",
                        title="PoC 验证",
                        description="搭建最小可运行示例验证可行性",
                        priority=6,
                        ac_type="implementation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_report",
                        title="调研报告",
                        description="输出调研报告 + 选型建议 + 实施路径",
                        priority=5,
                        ac_type="documentation",
                        risk_level="low",
                    ),
                ],
                default_strategy="aggressive",
                default_max_turns=25,
                default_triggers=["manual"],
                recommended_agents=["architect", "documenter", "verifier"],
                estimated_duration_min=300,
                created_by="system",
            ),
            # 5. 测试开发模板
            GoalTemplate(
                template_id="tpl_builtin_test_dev",
                name="测试开发模板",
                description="测试用例开发流程：覆盖分析 → 用例设计 → 实现 → 覆盖率验证",
                category=TemplateCategory.TESTING.value,
                source=TemplateSource.BUILTIN.value,
                tags=["test", "qa", "coverage"],
                acceptance_criteria=[
                    AcceptanceCriterionTemplate(
                        ac_id="ac_analysis",
                        title="覆盖分析",
                        description="分析现有覆盖率，识别未覆盖路径",
                        priority=8,
                        ac_type="documentation",
                        risk_level="low",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_design",
                        title="用例设计",
                        description="设计测试用例（等价类/边界值/异常）",
                        priority=7,
                        ac_type="documentation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_impl",
                        title="用例实现",
                        description="实现测试代码，覆盖核心路径与边界",
                        priority=6,
                        ac_type="implementation",
                        risk_level="medium",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_verify",
                        title="覆盖率验证",
                        description="运行测试 + 覆盖率 ≥80%",
                        priority=9,
                        ac_type="testing",
                        risk_level="high",
                    ),
                ],
                default_strategy="standard",
                default_max_turns=20,
                default_triggers=["manual"],
                recommended_agents=["tester", "implementer", "verifier"],
                estimated_duration_min=180,
                created_by="system",
            ),
            # 6. 部署发布模板
            GoalTemplate(
                template_id="tpl_builtin_deployment",
                name="部署发布模板",
                description="安全部署流程：预检查 → 灰度 → 监控 → 全面发布",
                category=TemplateCategory.DEVOPS.value,
                source=TemplateSource.BUILTIN.value,
                tags=["deploy", "release", "devops"],
                acceptance_criteria=[
                    AcceptanceCriterionTemplate(
                        ac_id="ac_precheck",
                        title="部署前检查",
                        description="环境检查 + 配置验证 + 回滚预案",
                        priority=9,
                        ac_type="testing",
                        risk_level="high",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_canary",
                        title="灰度发布",
                        description="10% 流量灰度，观察关键指标",
                        priority=8,
                        ac_type="implementation",
                        risk_level="critical",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_monitor",
                        title="监控告警",
                        description="设置关键指标监控 + 告警阈值",
                        priority=7,
                        ac_type="implementation",
                        risk_level="high",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_full",
                        title="全量发布",
                        description="灰度验证通过后全量发布",
                        priority=6,
                        ac_type="implementation",
                        risk_level="critical",
                    ),
                    AcceptanceCriterionTemplate(
                        ac_id="ac_post",
                        title="发布后验证",
                        description="核心功能 smoke test + 用户反馈收集",
                        priority=8,
                        ac_type="testing",
                        risk_level="high",
                    ),
                ],
                default_strategy="conservative",
                default_max_turns=15,
                default_triggers=["manual"],
                recommended_agents=["implementer", "tester", "verifier", "reviewer"],
                estimated_duration_min=90,
                created_by="system",
            ),
        ]

    # ============================================================
    # CRUD
    # ============================================================
    def register_template(self, tpl: GoalTemplate) -> GoalTemplate:
        """
        注册模板（新增或更新）
        参数：
          - tpl: 模板对象
        返回：保存后的模板
        异常：ValueError 当名称非法 / category 非法 / 试图修改内置模板
        """
        with self._lock:
            # 验证
            valid, err = _validate_name(tpl.name)
            if not valid:
                raise ValueError(f"Invalid name: {err}")
            valid, err = _validate_tags(tpl.tags)
            if not valid:
                raise ValueError(f"Invalid tags: {err}")
            if tpl.category not in [c.value for c in TemplateCategory]:
                raise ValueError(f"Invalid category: {tpl.category}")
            if not tpl.acceptance_criteria:
                raise ValueError("acceptance_criteria must not be empty")

            # 新增模板时自动生成 ID
            if not tpl.template_id:
                tpl.template_id = f"tpl_{uuid.uuid4().hex[:8]}"

            # 更新逻辑
            existing = self._templates.get(tpl.template_id)
            if existing and existing.is_builtin():
                # 内置模板禁止修改（需先 fork）
                if tpl.source != TemplateSource.BUILTIN.value:
                    raise ValueError(
                        f"Cannot modify builtin template {tpl.template_id}; please fork first"
                    )
                # 同源（builtin）的同 ID 注册 → 幂等返回现有
                return existing

            if existing:
                tpl.version = existing.version + 1
                tpl.created_at = existing.created_at
                tpl.instantiations = existing.instantiations
                tpl.last_used_at = existing.last_used_at
            tpl.updated_at = datetime.now(timezone.utc).isoformat()

            self._templates[tpl.template_id] = tpl
            self._rewrite_templates()
            return tpl

    def unregister_template(self, template_id: str) -> bool:
        """注销模板（仅自定义模板可注销）"""
        with self._lock:
            tpl = self._templates.get(template_id)
            if not tpl:
                return False
            if tpl.is_builtin():
                logger.warning("Cannot unregister builtin template %s", template_id)
                return False
            del self._templates[template_id]
            self._rewrite_templates()
            return True

    def get_template(self, template_id: str) -> Optional[GoalTemplate]:
        """获取模板"""
        with self._lock:
            return self._templates.get(template_id)

    def list_templates(
        self,
        category: Optional[str] = None,
        source: Optional[str] = None,
        tag: Optional[str] = None,
        keyword: Optional[str] = None,
    ) -> List[GoalTemplate]:
        """
        列出模板（支持过滤）
        参数：
          - category: 按类别过滤
          - source: 按来源过滤（builtin/custom）
          - tag: 按标签过滤
          - keyword: 按名称/描述/标签关键词搜索
        返回：模板列表
        """
        with self._lock:
            results = list(self._templates.values())

        if category:
            results = [t for t in results if t.category == category]
        if source:
            results = [t for t in results if t.source == source]
        if tag:
            results = [t for t in results if tag in t.tags]
        if keyword:
            kw_lower = keyword.lower()
            results = [
                t for t in results
                if kw_lower in t.name.lower()
                or kw_lower in t.description.lower()
                or any(kw_lower in tag.lower() for tag in t.tags)
            ]
        # 按 instantiations 降序 + name 升序
        results.sort(key=lambda t: (-t.instantiations, t.name))
        return results

    def fork_template(
        self,
        template_id: str,
        new_name: Optional[str] = None,
        new_tags: Optional[List[str]] = None,
    ) -> Optional[GoalTemplate]:
        """
        Fork 内置模板为自定义模板
        参数：
          - template_id: 源模板 ID
          - new_name: 新模板名称（默认 "源名 (Copy)"）
          - new_tags: 新标签（默认继承 + "forked"）
        返回：新模板（未保存，需要调用 register_template 保存）
        """
        with self._lock:
            src = self._templates.get(template_id)
            if not src:
                return None

        new_id = f"tpl_fork_{uuid.uuid4().hex[:8]}"
        new_tpl = GoalTemplate.from_dict(src.to_dict())
        new_tpl.template_id = new_id
        new_tpl.name = new_name or f"{src.name} (Copy)"
        new_tpl.source = TemplateSource.CUSTOM.value
        new_tpl.version = 1
        new_tpl.instantiations = 0
        new_tpl.last_used_at = None
        new_tpl.created_at = datetime.now(timezone.utc).isoformat()
        new_tpl.updated_at = datetime.now(timezone.utc).isoformat()
        new_tpl.created_by = "user"

        tags = list(new_tags) if new_tags else list(src.tags)
        if "forked" not in tags:
            tags.append("forked")
        new_tpl.tags = tags

        return new_tpl

    # ============================================================
    # 实例化
    # ============================================================
    def instantiate(
        self,
        template_id: str,
        goal_id: Optional[str] = None,
    ) -> Optional[Tuple[GoalTemplate, TemplateInstantiation, Dict[str, Any]]]:
        """
        实例化模板为 Goal 配置
        参数：
          - template_id: 模板 ID
          - goal_id: 目标 Goal ID（None 则自动生成）
        返回：(模板, 实例化记录, Goal 初始配置) 或 None（模板不存在）
        """
        with self._lock:
            tpl = self._templates.get(template_id)
            if not tpl:
                return None

            # 更新统计
            tpl.instantiations += 1
            tpl.last_used_at = datetime.now(timezone.utc).isoformat()

            actual_goal_id = goal_id or f"goal_{uuid.uuid4().hex[:8]}"
            inst = TemplateInstantiation(
                template_id=template_id,
                goal_id=actual_goal_id,
                ac_count=len(tpl.acceptance_criteria),
            )

            # 生成 Goal 初始配置
            goal_config = {
                "goal_id": actual_goal_id,
                "title": tpl.name,
                "description": tpl.description,
                "category": tpl.category,
                "tags": list(tpl.tags),
                "acceptance_criteria": [ac.to_dict() for ac in tpl.acceptance_criteria],
                "turn_config": {
                    "strategy": tpl.default_strategy,
                    "max_turns": tpl.default_max_turns,
                    "triggers": list(tpl.default_triggers),
                },
                "recommended_agents": list(tpl.recommended_agents),
                "template_id": template_id,
                "template_version": tpl.version,
            }

            self._instantiations.append(inst)
            self._append_instantiation(inst)
            self._rewrite_templates()
            return tpl, inst, goal_config

    def get_instantiation_history(
        self,
        template_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[TemplateInstantiation]:
        """获取实例化历史"""
        with self._lock:
            results = list(self._instantiations)

        if template_id:
            results = [i for i in results if i.template_id == template_id]
        # 倒序
        results = list(reversed(results))
        return results[:limit]

    # ============================================================
    # 导入/导出
    # ============================================================
    def export_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        """导出模板为 JSON 字典"""
        with self._lock:
            tpl = self._templates.get(template_id)
            if not tpl:
                return None
            return tpl.to_dict()

    def import_template(
        self,
        data: Dict[str, Any],
        new_template_id: Optional[str] = None,
    ) -> GoalTemplate:
        """从 JSON 字典导入模板"""
        with self._lock:
            tpl = GoalTemplate.from_dict(data)
            if new_template_id:
                tpl.template_id = new_template_id
            else:
                tpl.template_id = f"tpl_imported_{uuid.uuid4().hex[:8]}"
            tpl.source = TemplateSource.CUSTOM.value
            tpl.version = 1
            tpl.instantiations = 0
            tpl.last_used_at = None
            tpl.created_at = datetime.now(timezone.utc).isoformat()
            tpl.updated_at = datetime.now(timezone.utc).isoformat()
            tpl.created_by = "import"

            return self.register_template(tpl)

    # ============================================================
    # 统计
    # ============================================================
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock:
            templates = list(self._templates.values())
            total = len(templates)
            builtin = sum(1 for t in templates if t.is_builtin())
            custom = total - builtin

            by_category: Dict[str, int] = {}
            for t in templates:
                by_category[t.category] = by_category.get(t.category, 0) + 1

            total_instantiations = sum(t.instantiations for t in templates)
            most_used = sorted(templates, key=lambda t: -t.instantiations)[:5]
            most_used_info = [
                {
                    "template_id": t.template_id,
                    "name": t.name,
                    "instantiations": t.instantiations,
                }
                for t in most_used
                if t.instantiations > 0
            ]

            return {
                "total_templates": total,
                "builtin_templates": builtin,
                "custom_templates": custom,
                "by_category": by_category,
                "total_instantiations": total_instantiations,
                "most_used": most_used_info,
                "categories": [c.value for c in TemplateCategory],
                "sources": [s.value for s in TemplateSource],
            }

    def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        with self._lock:
            return {
                "status": "ok",
                "templates_loaded": len(self._templates),
                "builtin_loaded": sum(1 for t in self._templates.values() if t.is_builtin()),
                "instantiations_recorded": len(self._instantiations),
                "storage_dir": str(self._storage_dir),
            }
