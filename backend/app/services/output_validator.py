"""
# ============================================================
# 后端核心服务 - 统一输出规范校验器
# ============================================================
# 核心作用：校验调度平台全部 11 种角色的输出是否严格遵循
#           统一输出规范，包括章节数量、章节顺序、必要字段、
#           结构化数据格式等维度的自动化校验
# 运行流程：
#   1. 接收角色类型（role）和输出内容（content）
#   2. 根据角色类型加载对应的输出规范定义
#   3. 执行对应的专项校验方法：
#      a. 需求澄清（3 章）：需求概述、结构化需求、约束与边界
#      b. 架构设计（5 章）：架构概述、模块划分、接口设计、数据流设计、技术选型
#      c. 批判性反思（3 章 + 结构化缺陷列表字段）
#      d. 任务规划（标准化 JSON Schema）
#      e. 编码输出（7 章）：代码文件路径、功能说明、编译/运行依赖、复用说明、完整代码、自测说明、修改说明
#      f. 安全检查（4 章）：总体结论、模块安全结果、结构化问题列表、后续建议
#      g. 测试脚本（5 章）：脚本路径、测试覆盖、执行命令、通过标准、完整脚本
#      h. 集成校验（8 章）
#      i. 系统评测（8 章）
#      j. 交付归档（7 章）
#      k. 通用校验（自动检测角色并执行对应校验）
#   4. 汇总校验结果，返回结构化报告
# 输入参数：
#   - role: str，角色类型标识符
#   - content: str，角色输出的原始文本内容
# 输出结果：OutputValidationReport 对象，包含校验状态、评分、问题列表
# 修改记录：
#   版本 1.0.0 | 2026-06-24 | 初始创建，实现全部 11 种角色输出规范校验
# ============================================================
"""

import json as json_module
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class OutputValidationStatus(str, Enum):
    """
    输出校验状态枚举
    取值：
      - PASSED: 校验通过，输出完全符合规范
      - FAILED: 校验不通过，存在结构性缺陷
      - WARNING: 基本符合，但存在非关键性问题
    """
    PASSED = "passed"
    FAILED = "failed"
    WARNING = "warning"


@dataclass
class OutputIssue:
    """
    输出校验发现的问题
    字段说明：
      - severity: 严重程度（error/warning/info）
      - chapter: 出问题的章节名称
      - description: 问题描述
      - expected: 期望的格式
      - actual: 实际的格式（截取前 100 字符）
    """
    severity: str = "warning"
    chapter: str = ""
    description: str = ""
    expected: str = ""
    actual: str = ""


@dataclass
class OutputValidationReport:
    """
    输出校验综合报告
    字段说明：
      - status: 校验状态（passed/failed/warning）
      - score: 格式评分（0-100）
      - role: 校验的角色类型
      - role_name: 角色中文名称
      - issues: 发现的问题列表
      - summary: 校验摘要
      - passed_chapters: 通过的章节列表
      - failed_chapters: 未通过的章节列表
    """
    status: OutputValidationStatus = OutputValidationStatus.PASSED
    score: float = 100.0
    role: str = ""
    role_name: str = ""
    issues: List[OutputIssue] = field(default_factory=list)
    summary: str = ""
    passed_chapters: List[str] = field(default_factory=list)
    failed_chapters: List[str] = field(default_factory=list)


# ============================================================
# 各角色统一输出规范定义
# ============================================================

# 需求澄清角色：3 个固定章节
REQUIREMENT_CLARIFICATION_SPEC: Dict[str, Any] = {
    "role_name": "需求澄清",
    "chapter_count": 3,
    "chapters": [
        {
            "name": "需求概述",
            "keywords": ["需求概述", "需求摘要", "需求描述"],
            "required": True,
            "description": "对用户原始需求的概括与理解",
        },
        {
            "name": "结构化需求",
            "keywords": ["结构化需求", "标准化需求", "优化后需求"],
            "required": True,
            "description": "将模糊需求转化为结构化、无歧义的标准需求",
        },
        {
            "name": "约束与边界",
            "keywords": ["约束", "边界", "限制条件", "前置条件"],
            "required": True,
            "description": "明确需求的约束条件、边界范围、前置依赖",
        },
    ],
}

# 架构设计角色：5 个固定章节
ARCHITECTURE_DESIGN_SPEC: Dict[str, Any] = {
    "role_name": "架构设计",
    "chapter_count": 5,
    "chapters": [
        {
            "name": "架构概述",
            "keywords": ["架构概述", "总体架构", "系统架构"],
            "required": True,
            "description": "系统整体架构的宏观描述",
        },
        {
            "name": "模块划分",
            "keywords": ["模块划分", "模块设计", "组件划分"],
            "required": True,
            "description": "系统模块/组件的划分与职责定义",
        },
        {
            "name": "接口设计",
            "keywords": ["接口设计", "接口定义", "API设计"],
            "required": True,
            "description": "模块间接口、数据格式、通信协议定义",
        },
        {
            "name": "数据流设计",
            "keywords": ["数据流", "数据流向", "数据流转"],
            "required": True,
            "description": "系统数据流向、存储、处理流程设计",
        },
        {
            "name": "技术选型与依赖",
            "keywords": ["技术选型", "依赖", "技术栈", "工具链"],
            "required": True,
            "description": "技术栈选型理由、依赖清单、版本约束",
        },
    ],
}

# 批判性反思角色：3 个章节 + 结构化缺陷列表字段
CRITICAL_REFLECTION_SPEC: Dict[str, Any] = {
    "role_name": "批判性反思",
    "chapter_count": 3,
    "chapters": [
        {
            "name": "反思概述",
            "keywords": ["反思概述", "审查概述", "总体评价"],
            "required": True,
            "description": "对审查对象的总体评价与反思范围",
        },
        {
            "name": "缺陷列表",
            "keywords": ["缺陷列表", "问题列表", "缺陷清单"],
            "required": True,
            "description": "结构化的缺陷列表，包含缺陷 ID、严重程度、描述、影响范围",
        },
        {
            "name": "改进建议",
            "keywords": ["改进建议", "优化建议", "修复方案"],
            "required": True,
            "description": "针对每个缺陷的具体改进建议",
        },
    ],
    # 缺陷列表的结构化字段要求
    "defect_fields": [
        {"name": "缺陷ID", "key": "defect_id", "required": True},
        {"name": "缺陷等级", "key": "defect_level", "required": True},
        {"name": "影响范围", "key": "influence_scope", "required": True},
        {"name": "问题描述", "key": "problem_description", "required": True},
        {"name": "根因分析", "key": "root_cause_analysis", "required": True},
        {"name": "修复建议", "key": "repair_suggestion", "required": True},
        {"name": "优先级", "key": "priority", "required": True},
    ],
}

# 任务规划角色：标准化 JSON Schema
TASK_PLANNING_SPEC: Dict[str, Any] = {
    "role_name": "任务规划",
    "chapter_count": 0,
    "json_schema": {
        "type": "object",
        "required_fields": [
            "original_prompt",
            "optimized_prompt",
            "sub_tasks",
            "total_tasks",
        ],
        "sub_task_fields": [
            "id",
            "title",
            "description",
            "priority",
            "dependencies",
            "estimated_complexity",
        ],
    },
}

# 编码输出角色：7 个固定章节
CODING_SPEC: Dict[str, Any] = {
    "role_name": "编码输出",
    "chapter_count": 7,
    "chapters": [
        {
            "name": "代码文件路径",
            "keywords": ["代码文件路径", "文件路径", "代码文件"],
            "required": True,
            "description": "本次编码涉及的所有文件完整相对路径",
        },
        {
            "name": "功能说明",
            "keywords": ["功能说明", "功能描述", "核心作用"],
            "required": True,
            "description": "每个文件的功能说明与核心作用",
        },
        {
            "name": "编译/运行依赖",
            "keywords": ["编译依赖", "运行依赖", "依赖说明"],
            "required": True,
            "description": "编译和运行所需的依赖清单",
        },
        {
            "name": "复用说明",
            "keywords": ["复用说明", "复用", "代码复用"],
            "required": True,
            "description": "标注是否复用记忆库内容、复用来源、适配修改",
        },
        {
            "name": "完整代码",
            "keywords": ["完整代码", "代码实现", "源代码"],
            "required": True,
            "description": "每个文件的完整可执行代码",
        },
        {
            "name": "自测说明",
            "keywords": ["自测说明", "测试说明", "验证说明"],
            "required": True,
            "description": "代码的自测方法、测试用例、预期结果",
        },
        {
            "name": "修改说明",
            "keywords": ["修改说明", "变更说明", "迭代说明"],
            "required": False,
            "description": "迭代修改任务的修改记录（非迭代任务可省略）",
        },
    ],
}

# 安全检查角色：4 个固定章节
SECURITY_CHECK_SPEC: Dict[str, Any] = {
    "role_name": "安全检查",
    "chapter_count": 4,
    "chapters": [
        {
            "name": "总体结论",
            "keywords": ["总体结论", "检查结论", "安全结论", "总体评估"],
            "required": True,
            "description": "安全检查的总体结论与风险等级判定",
        },
        {
            "name": "模块安全结果",
            "keywords": ["模块安全", "模块结果", "各模块安全"],
            "required": True,
            "description": "各模块的安全检查结果详情",
        },
        {
            "name": "结构化问题列表",
            "keywords": ["问题列表", "结构化问题", "漏洞列表", "安全漏洞"],
            "required": True,
            "description": "结构化的安全问题清单，含风险等级与修复建议",
        },
        {
            "name": "后续建议",
            "keywords": ["后续建议", "改进建议", "整改建议", "安全建议"],
            "required": True,
            "description": "安全改进的后续建议与行动计划",
        },
    ],
}

# 测试脚本角色：5 个固定章节
TEST_SCRIPT_SPEC: Dict[str, Any] = {
    "role_name": "测试脚本",
    "chapter_count": 5,
    "chapters": [
        {
            "name": "脚本路径",
            "keywords": ["脚本路径", "文件路径", "测试脚本路径"],
            "required": True,
            "description": "测试脚本的完整文件路径",
        },
        {
            "name": "测试覆盖",
            "keywords": ["测试覆盖", "覆盖范围", "测试范围"],
            "required": True,
            "description": "测试覆盖的三个核心维度说明",
        },
        {
            "name": "执行命令",
            "keywords": ["执行命令", "运行命令", "执行方式"],
            "required": True,
            "description": "测试脚本的执行命令与参数说明",
        },
        {
            "name": "通过标准",
            "keywords": ["通过标准", "判定标准", "验收标准"],
            "required": True,
            "description": "测试通过的判定标准",
        },
        {
            "name": "完整脚本",
            "keywords": ["完整脚本", "测试代码", "脚本代码"],
            "required": True,
            "description": "完整的可执行测试脚本代码",
        },
    ],
}

# 集成校验角色：8 个固定章节
INTEGRATION_CHECK_SPEC: Dict[str, Any] = {
    "role_name": "集成校验",
    "chapter_count": 8,
    "chapters": [
        {
            "name": "集成概述",
            "keywords": ["集成概述", "集成范围", "校验范围"],
            "required": True,
            "description": "集成校验的范围与目标说明",
        },
        {
            "name": "模块接口校验",
            "keywords": ["接口校验", "接口验证", "接口测试"],
            "required": True,
            "description": "各模块间接口的兼容性校验结果",
        },
        {
            "name": "数据流校验",
            "keywords": ["数据流校验", "数据验证", "数据一致性"],
            "required": True,
            "description": "跨模块数据流的正确性校验",
        },
        {
            "name": "安全联动校验",
            "keywords": ["安全联动", "安全机制", "联动校验"],
            "required": True,
            "description": "全链路安全机制、急停逻辑、故障兜底的联动验证",
        },
        {
            "name": "性能校验",
            "keywords": ["性能校验", "性能测试", "资源占用"],
            "required": True,
            "description": "集成后的性能指标校验",
        },
        {
            "name": "异常场景校验",
            "keywords": ["异常场景", "异常处理", "容错测试"],
            "required": True,
            "description": "异常工况下的系统行为校验",
        },
        {
            "name": "问题清单",
            "keywords": ["问题清单", "问题列表", "缺陷列表"],
            "required": True,
            "description": "集成校验发现的问题汇总",
        },
        {
            "name": "集成结论",
            "keywords": ["集成结论", "校验结论", "通过判定"],
            "required": True,
            "description": "集成校验的最终结论与通过判定",
        },
    ],
}

# 系统评测角色：8 个固定章节
SYSTEM_EVALUATION_SPEC: Dict[str, Any] = {
    "role_name": "系统评测",
    "chapter_count": 8,
    "chapters": [
        {
            "name": "评测概述",
            "keywords": ["评测概述", "评测范围", "评测目标"],
            "required": True,
            "description": "系统评测的范围、目标、方法概述",
        },
        {
            "name": "功能完整性评测",
            "keywords": ["功能完整性", "功能评测", "需求覆盖"],
            "required": True,
            "description": "需求功能的实现完整度评测",
        },
        {
            "name": "代码质量评测",
            "keywords": ["代码质量", "质量评测", "规范符合"],
            "required": True,
            "description": "代码规范性、可读性、可维护性评测",
        },
        {
            "name": "安全评测",
            "keywords": ["安全评测", "安全性", "安全审计"],
            "required": True,
            "description": "系统安全性综合评测",
        },
        {
            "name": "性能评测",
            "keywords": ["性能评测", "性能指标", "基准测试"],
            "required": True,
            "description": "系统性能指标评测",
        },
        {
            "name": "鲁棒性评测",
            "keywords": ["鲁棒性", "稳定性", "容错性"],
            "required": True,
            "description": "系统在异常条件下的稳定性评测",
        },
        {
            "name": "问题汇总",
            "keywords": ["问题汇总", "问题列表", "缺陷汇总"],
            "required": True,
            "description": "评测过程中发现的所有问题汇总",
        },
        {
            "name": "评测结论",
            "keywords": ["评测结论", "总体结论", "通过判定"],
            "required": True,
            "description": "系统评测的最终结论与通过判定",
        },
    ],
}

# 交付归档角色：7 个固定章节
DELIVERY_ARCHIVE_SPEC: Dict[str, Any] = {
    "role_name": "交付归档",
    "chapter_count": 7,
    "chapters": [
        {
            "name": "交付概述",
            "keywords": ["交付概述", "交付清单", "交付物概述"],
            "required": True,
            "description": "交付物的总体概述与清单",
        },
        {
            "name": "需求实现情况",
            "keywords": ["需求实现", "实现情况", "完成度"],
            "required": True,
            "description": "需求实现情况的完整说明",
        },
        {
            "name": "核心变更内容",
            "keywords": ["核心变更", "变更内容", "架构调整"],
            "required": True,
            "description": "本次交付的核心变更与架构调整说明",
        },
        {
            "name": "测试结果",
            "keywords": ["测试结果", "测试报告", "验证结果"],
            "required": True,
            "description": "全量测试结果与覆盖率报告",
        },
        {
            "name": "依赖变更",
            "keywords": ["依赖变更", "依赖更新", "版本变更"],
            "required": True,
            "description": "依赖项的变更清单",
        },
        {
            "name": "使用说明",
            "keywords": ["使用说明", "部署说明", "运行说明"],
            "required": True,
            "description": "部署、运行、使用的详细说明",
        },
        {
            "name": "注意事项",
            "keywords": ["注意事项", "已知问题", "限制说明"],
            "required": True,
            "description": "使用注意事项、已知限制、后续计划",
        },
    ],
}

# 角色类型到规范的映射表
ROLE_SPEC_MAP: Dict[str, Dict[str, Any]] = {
    "requirement_clarification": REQUIREMENT_CLARIFICATION_SPEC,
    "architecture_design": ARCHITECTURE_DESIGN_SPEC,
    "critical_reflection": CRITICAL_REFLECTION_SPEC,
    "task_planning": TASK_PLANNING_SPEC,
    "coding": CODING_SPEC,
    "security_check": SECURITY_CHECK_SPEC,
    "test_script": TEST_SCRIPT_SPEC,
    "integration_check": INTEGRATION_CHECK_SPEC,
    "system_evaluation": SYSTEM_EVALUATION_SPEC,
    "delivery_archive": DELIVERY_ARCHIVE_SPEC,
}


# ============================================================
# 统一输出规范校验器
# ============================================================

class OutputValidator:
    """
    统一输出规范校验器
    作用：校验全部 11 种角色的输出是否严格遵循统一输出规范
    调用方：调度引擎（scheduler）、任务执行引擎
    被调用方：无（独立校验模块）
    """

    def __init__(self):
        """
        初始化输出校验器
        运行步骤：
          1. 从全局配置读取安全相关配置
          2. 初始化日志记录器
        """
        self._security_config = settings.security
        self._max_review_iterations = self._security_config.get(
            "max_review_iterations", 3
        )
        logger.info(
            f"输出规范校验器初始化完成，"
            f"支持 {len(ROLE_SPEC_MAP)} 种角色类型"
        )

    # ==========================================================
    # 通用校验入口
    # ==========================================================

    def validate(self, role: str, content: str) -> OutputValidationReport:
        """
        自动检测角色类型并执行对应的输出规范校验
        运行步骤：
          1. 校验角色类型有效性
          2. 校验内容非空
          3. 加载角色对应的输出规范
          4. 对 JSON 格式角色执行 JSON Schema 校验
          5. 对章节格式角色执行章节结构校验
          6. 汇总问题并计算评分
        参数：
          - role: 角色类型标识符
          - content: 角色输出的原始文本内容
        返回值：OutputValidationReport 对象
        """
        # 步骤 1：校验角色类型有效性
        if role not in ROLE_SPEC_MAP:
            return OutputValidationReport(
                status=OutputValidationStatus.FAILED,
                score=0.0,
                role=role,
                issues=[
                    OutputIssue(
                        severity="error",
                        chapter="全局",
                        description=f"未知的角色类型: {role}",
                        expected=f"有效角色类型: {list(ROLE_SPEC_MAP.keys())}",
                        actual=role,
                    )
                ],
                summary=f"角色类型 '{role}' 不在支持的 10 种角色范围内",
            )

        # 步骤 2：校验内容非空
        if not content or not content.strip():
            return OutputValidationReport(
                status=OutputValidationStatus.FAILED,
                score=0.0,
                role=role,
                issues=[
                    OutputIssue(
                        severity="error",
                        chapter="全局",
                        description="输出内容为空",
                        expected="非空的文本内容",
                        actual="空字符串",
                    )
                ],
                summary="输出内容为空，无法进行格式校验",
            )

        spec = ROLE_SPEC_MAP[role]

        # 步骤 3：根据角色类型选择校验策略
        if role == "task_planning":
            return self._validate_json_format(role, content, spec)
        else:
            return self._validate_chapter_format(role, content, spec)

    # ==========================================================
    # 章节格式校验
    # ==========================================================

    def _validate_chapter_format(
        self,
        role: str,
        content: str,
        spec: Dict[str, Any],
    ) -> OutputValidationReport:
        """
        章节格式校验（适用于非 JSON 格式的角色输出）
        运行步骤：
          1. 提取内容中的所有章节标题（## 开头的行）
          2. 逐一比对规范要求的章节是否都存在
          3. 校验章节顺序是否正确
          4. 对批判性反思角色额外校验缺陷列表字段
          5. 计算评分并汇总问题
        参数：
          - role: 角色类型
          - content: 输出内容
          - spec: 该角色的格式规范定义
        返回值：OutputValidationReport 对象
        """
        issues: List[OutputIssue] = []
        passed_chapters: List[str] = []
        failed_chapters: List[str] = []

        # 提取所有二级标题（## 开头）
        detected_chapters = self._extract_chapter_titles(content)

        expected_chapters = spec.get("chapters", [])
        required_count = sum(1 for ch in expected_chapters if ch.get("required", True))

        # 校验章节数量
        if len(detected_chapters) < required_count:
            issues.append(
                OutputIssue(
                    severity="error",
                    chapter="全局",
                    description=(
                        f"章节数量不足：检测到 {len(detected_chapters)} 个章节，"
                        f"至少需要 {required_count} 个章节"
                    ),
                    expected=f"至少 {required_count} 个章节",
                    actual=f"{len(detected_chapters)} 个章节",
                )
            )

        # 逐一校验每个期望章节是否存在
        for idx, chapter_spec in enumerate(expected_chapters):
            chapter_name = chapter_spec["name"]
            is_required = chapter_spec.get("required", True)
            keywords = chapter_spec.get("keywords", [])

            # 检测章节是否存在于输出中
            found = self._find_chapter_in_content(detected_chapters, keywords)

            if found:
                passed_chapters.append(chapter_name)
            elif is_required:
                failed_chapters.append(chapter_name)
                issues.append(
                    OutputIssue(
                        severity="error",
                        chapter=chapter_name,
                        description=f"缺少必要章节: {chapter_name}",
                        expected=f"包含 '{chapter_name}' 章节（关键词: {keywords}）",
                        actual="未找到匹配的章节标题",
                    )
                )
            else:
                # 可选章节缺失不算错误
                issues.append(
                    OutputIssue(
                        severity="info",
                        chapter=chapter_name,
                        description=f"可选章节未包含: {chapter_name}",
                        expected=f"建议包含 '{chapter_name}' 章节",
                        actual="未找到匹配的章节标题",
                    )
                )

        # 对批判性反思角色，额外校验缺陷列表的结构化字段
        if role == "critical_reflection":
            defect_issues = self._validate_defect_fields(content, spec)
            issues.extend(defect_issues)
            if defect_issues:
                for di in defect_issues:
                    if di.severity == "error" and "缺陷列表（结构化字段）" not in failed_chapters:
                        failed_chapters.append("缺陷列表（结构化字段）")

        # 计算评分
        total_expected = required_count
        if role == "critical_reflection":
            total_expected += 1

        passed_count = len(passed_chapters)
        if total_expected > 0:
            score = (passed_count / total_expected) * 100.0
        else:
            score = 100.0

        # 判定状态
        has_error = any(iss.severity == "error" for iss in issues)
        if has_error:
            status = OutputValidationStatus.FAILED
        elif issues:
            status = OutputValidationStatus.WARNING
        else:
            status = OutputValidationStatus.PASSED

        return OutputValidationReport(
            status=status,
            score=round(score, 1),
            role=role,
            role_name=spec.get("role_name", role),
            issues=issues,
            summary=(
                f"{spec.get('role_name', role)}格式校验"
                f"{'通过' if status == OutputValidationStatus.PASSED else '未通过'}，"
                f"评分: {score:.1f}，通过章节: {passed_chapters}，"
                f"未通过章节: {failed_chapters}"
            ),
            passed_chapters=passed_chapters,
            failed_chapters=failed_chapters,
        )

    # ==========================================================
    # JSON 格式校验（任务规划角色）
    # ==========================================================

    def _validate_json_format(
        self,
        role: str,
        content: str,
        spec: Dict[str, Any],
    ) -> OutputValidationReport:
        """
        JSON 格式校验（适用于任务规划角色的 JSON Schema 校验）
        运行步骤：
          1. 尝试从内容中提取 JSON 字符串
          2. 解析 JSON
          3. 校验顶层必要字段
          4. 校验子任务字段完整性
          5. 返回校验结果
        参数：
          - role: 角色类型
          - content: 输出内容
          - spec: JSON Schema 规范定义
        返回值：OutputValidationReport 对象
        """
        issues: List[OutputIssue] = []
        passed_chapters: List[str] = []
        failed_chapters: List[str] = []

        json_schema = spec.get("json_schema", {})
        required_fields = json_schema.get("required_fields", [])
        sub_task_fields = json_schema.get("sub_task_fields", [])

        # 尝试提取 JSON 内容
        json_str = self._extract_json_from_content(content)
        if json_str is None:
            return OutputValidationReport(
                status=OutputValidationStatus.FAILED,
                score=0.0,
                role=role,
                role_name=spec.get("role_name", role),
                issues=[
                    OutputIssue(
                        severity="error",
                        chapter="全局",
                        description="无法从输出中提取有效的 JSON 内容",
                        expected="合法的 JSON 字符串",
                        actual=content[:200],
                    )
                ],
                summary="任务规划输出未包含有效的 JSON 数据",
            )

        # 解析 JSON
        try:
            data = json_module.loads(json_str)
        except json_module.JSONDecodeError as e:
            return OutputValidationReport(
                status=OutputValidationStatus.FAILED,
                score=0.0,
                role=role,
                role_name=spec.get("role_name", role),
                issues=[
                    OutputIssue(
                        severity="error",
                        chapter="全局",
                        description=f"JSON 解析失败: {str(e)}",
                        expected="合法的 JSON 格式",
                        actual=json_str[:200],
                    )
                ],
                summary=f"JSON 解析失败: {str(e)}",
            )

        # 校验顶层必要字段
        for field in required_fields:
            if field not in data:
                failed_chapters.append(f"顶层字段: {field}")
                issues.append(
                    OutputIssue(
                        severity="error",
                        chapter="JSON Schema",
                        description=f"缺少必要字段: {field}",
                        expected=f"JSON 对象必须包含 '{field}' 字段",
                        actual=f"已有字段: {list(data.keys())}",
                    )
                )
            else:
                passed_chapters.append(f"顶层字段: {field}")

        # 校验子任务字段
        sub_tasks = data.get("sub_tasks", [])
        if isinstance(sub_tasks, list) and len(sub_tasks) > 0:
            for i, task in enumerate(sub_tasks):
                if not isinstance(task, dict):
                    failed_chapters.append(f"子任务[{i}]类型错误")
                    issues.append(
                        OutputIssue(
                            severity="error",
                            chapter=f"子任务[{i}]",
                            description=f"子任务 [{i}] 不是有效的 JSON 对象",
                            expected="JSON 对象",
                            actual=str(type(task).__name__),
                        )
                    )
                    continue
                for field in sub_task_fields:
                    if field not in task:
                        failed_chapters.append(f"子任务[{i}].{field}")
                        issues.append(
                            OutputIssue(
                                severity="error",
                                chapter=f"子任务[{i}]",
                                description=f"子任务 [{i}] 缺少必要字段: {field}",
                                expected=f"子任务必须包含 '{field}' 字段",
                                actual=f"已有字段: {list(task.keys())}",
                            )
                        )
                        continue
                    passed_chapters.append(f"子任务[{i}].{field}")
        elif not isinstance(sub_tasks, list):
            failed_chapters.append("sub_tasks 类型")
            issues.append(
                OutputIssue(
                    severity="error",
                    chapter="JSON Schema",
                    description="sub_tasks 字段必须是数组类型",
                    expected="Array",
                    actual=str(type(sub_tasks).__name__),
                )
            )

        # 计算评分
        total_checks = len(required_fields)
        if isinstance(sub_tasks, list):
            total_checks += len(sub_tasks) * len(sub_task_fields)

        passed_checks = len(passed_chapters)
        if total_checks > 0:
            score = (passed_checks / total_checks) * 100.0
        else:
            score = 100.0

        has_error = any(iss.severity == "error" for iss in issues)
        status = (
            OutputValidationStatus.FAILED
            if has_error
            else OutputValidationStatus.PASSED
        )

        return OutputValidationReport(
            status=status,
            score=round(score, 1),
            role=role,
            role_name=spec.get("role_name", role),
            issues=issues,
            summary=(
                f"任务规划 JSON Schema 校验"
                f"{'通过' if status == OutputValidationStatus.PASSED else '未通过'}，"
                f"评分: {score:.1f}"
            ),
            passed_chapters=passed_chapters,
            failed_chapters=failed_chapters,
        )

    # ==========================================================
    # 批判性反思 - 缺陷列表结构化字段校验
    # ==========================================================

    def _validate_defect_fields(
        self,
        content: str,
        spec: Dict[str, Any],
    ) -> List[OutputIssue]:
        """
        校验批判性反思角色中缺陷列表的结构化字段
        运行步骤：
          1. 定位「缺陷列表」章节
          2. 提取该章节中的缺陷条目
          3. 逐一校验每个缺陷条目是否包含必要字段：
             defect_id、defect_level、influence_scope、
             problem_description、root_cause_analysis、
             repair_suggestion、priority
        参数：
          - content: 输出内容
          - spec: 批判性反思的格式规范
        返回值：发现的问题列表
        """
        issues: List[OutputIssue] = []
        defect_fields = spec.get("defect_fields", [])

        # 定位缺陷列表章节
        defect_section = self._extract_section(
            content, ["缺陷列表", "问题列表", "缺陷清单"]
        )
        if defect_section is None:
            issues.append(
                OutputIssue(
                    severity="error",
                    chapter="缺陷列表",
                    description="无法定位「缺陷列表」章节，无法校验结构化字段",
                    expected="包含「缺陷列表」章节",
                    actual="未找到该章节",
                )
            )
            return issues

        # 检测缺陷条目（以 - 或数字开头的列表项）
        defect_entries = re.findall(
            r'(?:^|\n)\s*(?:[-*]\s*|\d+[.)]\s*)((?:缺陷ID|缺陷编号|ID)[^\n]*)',
            defect_section,
            re.IGNORECASE,
        )

        if not defect_entries:
            # 尝试更宽松的匹配
            defect_entries = re.findall(
                r'(?:^|\n)\s*(?:[-*]\s*|\d+[.)]\s*)((?:严重|缺陷|问题|风险)[^\n]*)',
                defect_section,
                re.IGNORECASE,
            )

        if not defect_entries:
            issues.append(
                OutputIssue(
                    severity="warning",
                    chapter="缺陷列表",
                    description="缺陷列表章节中未检测到结构化的缺陷条目",
                    expected="以列表形式组织的缺陷条目",
                    actual=defect_section[:200],
                )
            )
            return issues

        # 校验每个缺陷条目的字段完整性
        for i, entry in enumerate(defect_entries):
            for field_def in defect_fields:
                field_name = field_def["name"]
                is_required = field_def.get("required", True)
                # 检测字段关键词是否存在于条目中
                found_field = any(
                    keyword in entry
                    for keyword in [field_name, field_def.get("key", "")]
                )
                if not found_field and is_required:
                    issues.append(
                        OutputIssue(
                            severity="error",
                            chapter=f"缺陷列表[条目{i+1}]",
                            description=f"缺陷条目 {i+1} 缺少必要字段: {field_name}",
                            expected=f"每个缺陷条目需包含 '{field_name}'",
                            actual=entry[:100],
                        )
                    )

        return issues

    # ==========================================================
    # 各角色专项校验方法
    # ==========================================================

    def validate_requirement_clarification(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验需求澄清角色输出（3 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("requirement_clarification", content)

    def validate_architecture_design(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验架构设计角色输出（5 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("architecture_design", content)

    def validate_critical_reflection(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验批判性反思角色输出（3 个章节 + 结构化缺陷列表字段）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("critical_reflection", content)

    def validate_task_planning(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验任务规划角色输出（标准化 JSON Schema）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("task_planning", content)

    def validate_coding_output(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验编码输出角色（7 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("coding", content)

    def validate_security_check(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验安全检查角色输出（4 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("security_check", content)

    def validate_test_script(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验测试脚本角色输出（5 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("test_script", content)

    def validate_integration_check(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验集成校验角色输出（8 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("integration_check", content)

    def validate_system_evaluation(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验系统评测角色输出（8 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("system_evaluation", content)

    def validate_delivery_archive(
        self, content: str
    ) -> OutputValidationReport:
        """
        校验交付归档角色输出（7 个章节）
        参数：
          - content: 输出内容
        返回值：OutputValidationReport 对象
        """
        return self.validate("delivery_archive", content)

    # ==========================================================
    # 辅助方法
    # ==========================================================

    def _extract_chapter_titles(self, content: str) -> List[str]:
        """
        从内容中提取所有二级标题（## 开头）
        运行步骤：
          1. 按行分割内容
          2. 匹配以 ## 开头的行（排除 ### 三级标题）
          3. 返回标题文本列表
        参数：
          - content: 原始文本内容
        返回值：章节标题列表
        """
        titles: List[str] = []
        for line in content.split("\n"):
            stripped = line.strip()
            # 匹配 ## 开头但不是 ### 的行
            if re.match(r'^##\s+[^#]', stripped):
                title = stripped.lstrip("#").strip()
                titles.append(title)
        return titles

    def _find_chapter_in_content(
        self,
        detected_titles: List[str],
        keywords: List[str],
    ) -> bool:
        """
        在检测到的章节标题中查找匹配关键词的章节
        运行步骤：
          1. 遍历检测到的标题
          2. 对每个标题检查是否包含任一关键词
          3. 找到即返回 True
        参数：
          - detected_titles: 检测到的章节标题列表
          - keywords: 该章节的关键词列表
        返回值：是否找到匹配的章节
        """
        for title in detected_titles:
            for keyword in keywords:
                if keyword in title:
                    return True
        return False

    def _extract_section(
        self,
        content: str,
        keywords: List[str],
    ) -> Optional[str]:
        """
        从内容中提取指定章节的文本
        运行步骤：
          1. 查找匹配关键词的章节起始位置
          2. 提取该章节到下一个同级章节之间的内容
        参数：
          - content: 原始文本内容
          - keywords: 章节关键词列表
        返回值：章节文本内容，未找到返回 None
        """
        lines = content.split("\n")
        start_idx = -1
        for i, line in enumerate(lines):
            stripped = line.strip()
            if re.match(r'^##\s+', stripped):
                title = stripped.lstrip("#").strip()
                for keyword in keywords:
                    if keyword in title:
                        start_idx = i
                        break
            if start_idx >= 0:
                break

        if start_idx < 0:
            return None

        # 提取从该章节到下一个 ## 章节之间的内容
        section_lines = []
        for i in range(start_idx, len(lines)):
            if i > start_idx and re.match(r'^##\s+', lines[i].strip()):
                break
            section_lines.append(lines[i])

        return "\n".join(section_lines)

    def _extract_json_from_content(self, content: str) -> Optional[str]:
        """
        从内容中提取 JSON 字符串
        运行步骤：
          1. 尝试直接解析整个内容为 JSON
          2. 尝试提取 ```json 代码块中的内容
          3. 尝试提取 { } 包裹的 JSON 对象
        参数：
          - content: 原始文本内容
        返回值：JSON 字符串，提取失败返回 None
        """
        # 尝试直接解析
        stripped = content.strip()
        try:
            json_module.loads(stripped)
            return stripped
        except json_module.JSONDecodeError:
            pass

        # 尝试提取 ```json 代码块
        code_block_match = re.search(
            r'```(?:json)?\s*\n(.*?)\n```',
            content,
            re.DOTALL,
        )
        if code_block_match:
            candidate = code_block_match.group(1).strip()
            try:
                json_module.loads(candidate)
                return candidate
            except json_module.JSONDecodeError:
                pass

        # 尝试提取最外层 { } 包裹的 JSON
        brace_match = re.search(r'\{.*\}', content, re.DOTALL)
        if brace_match:
            candidate = brace_match.group(0)
            try:
                json_module.loads(candidate)
                return candidate
            except json_module.JSONDecodeError:
                pass

        return None
