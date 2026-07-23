"""
# ============================================================
# 批判反思智能体
# ============================================================
# 核心定位：架构风险官与合规专家
# 核心作用：从算法合理性、系统稳定性、工程可实现性、
#           实时性、安全性 5 个维度做全维度批判评审
# 重要约束：该智能体只在总架构师输出四个文档后被调用，
#           之后不再调用
# 运行流程：
#   1. 接收总架构师输出的四个文档
#   2. 从 5 个维度逐一评审
#   3. 输出结构化缺陷清单
#   4. 执行合规性校验、风险等级复核、版本对比评审
#   5. 具备全链路智能评审能力：单模块评审、跨模块集成评审、
#      需求-代码可追溯性验证、结构化评审报告生成
# 输入参数：
#   - spec/checklist/tasks/acceptance: 四个文档
#   - adaptation_result: 局部适配结果（合规性校验时）
#   - old_docs/new_docs: 版本对比评审时
# 输出结果：ReviewReport / ComplianceReport / RiskReviewReport /
#           DiffReport / FullChainReviewReport
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
#   - 2026-07-01 | v1.1.0 | 新增 iterate_requirements() 方法，支持需求文档迭代优化
#   - 2026-07-22 | v1.2.0 | 新增全链路智能评审能力：review_single_module()、
#     review_cross_module()、verify_traceability()、generate_review_report()、
#     FullChainReviewReport 数据类、FULL_CHAIN_REVIEWER_PROMPT
#   - 2026-07-22 | v1.3.0 | 新增验收标准协作评审能力：review_acceptance_criteria()、
#     verify_100_percent_verifiable()，支持与 ChiefArchitect 协作完成验收标准开发
# ============================================================
"""

import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class DefectItem:
    """缺陷项"""
    id: str = ""
    title: str = ""
    description: str = ""
    severity: str = "minor"  # critical/major/minor
    dimension: str = ""  # 所属评审维度
    impact: str = ""  # 影响范围
    root_cause: str = ""  # 根因分析
    suggestion: str = ""  # 修复方案


@dataclass
class ReviewReport:
    """全维度评审报告"""
    passed: bool = False
    defects: List[DefectItem] = field(default_factory=list)
    dimension_scores: Dict[str, float] = field(default_factory=dict)
    summary: str = ""


@dataclass
class ComplianceReport:
    """合规性校验报告"""
    passed: bool = False
    core_architecture_affected: bool = False
    dependency_conflicts: List[str] = field(default_factory=list)
    scope_expanded: bool = False
    issues: List[str] = field(default_factory=list)


@dataclass
class RiskReviewReport:
    """风险等级复核报告"""
    mislabeled: List[str] = field(default_factory=list)  # 错标/漏标的高风险模块
    mitigation_insufficient: List[str] = field(default_factory=list)
    passed: bool = False


@dataclass
class DiffReport:
    """版本对比评审报告"""
    fixed_defects: List[str] = field(default_factory=list)
    new_defects: List[str] = field(default_factory=list)
    remaining_defects: List[str] = field(default_factory=list)
    passed: bool = False


@dataclass
class FullChainReviewReport:
    """
    全链路智能评审报告
    作用：汇总单模块评审、跨模块集成评审、可追溯性验证的完整结果，
          支持通过 SSE 推送至前端
    字段说明：
      - overall_score: 总体评分（0-100）
      - dimension_scores: 各维度评分，如 correctness/security/standards/completeness
      - defects: 缺陷列表，每条包含 ID、严重等级、位置、描述、修复建议
      - coverage_matrix: 需求覆盖矩阵，需求项 → 代码文件 → 行号
      - coverage_percentage: 需求覆盖率（0-100）
      - passed: 是否通过评审（无 critical 缺陷且各维度达标）
      - summary: 评审总结文本
    """
    overall_score: float = 0.0
    dimension_scores: Dict[str, float] = field(default_factory=dict)
    defects: List[DefectItem] = field(default_factory=list)
    coverage_matrix: Dict[str, List[str]] = field(default_factory=dict)
    coverage_percentage: float = 0.0
    passed: bool = False
    summary: str = ""


FULL_CHAIN_REVIEWER_PROMPT = """你是一个专业的全链路智能评审专家（架构风险官 + 合规专家 + 代码审查员）。

## 核心职责
对代码实现进行全链路智能评审，覆盖单模块语义审查、跨模块集成审查、
需求-代码可追溯性验证三大核心能力。

## 单模块评审维度
1. **语义正确性**: 代码逻辑是否满足模块需求规范？
2. **边界条件覆盖**: 异常输入、极端值、空值处理是否完备？
3. **安全漏洞扫描**: 注入风险、权限检查、敏感信息泄露
4. **规范合规性**: 命名规范、注释完整性、代码风格
5. **验收标准匹配**: 逐条检查验收标准是否被代码实现覆盖

## 跨模块集成评审维度
1. **接口一致性**: 模块间接口是否匹配？
2. **数据类型一致性**: 传递的数据类型是否兼容？
3. **调用顺序**: 调用顺序是否满足依赖约束？
4. **循环依赖检测**: 是否存在隐式循环依赖？
5. **全局状态一致性**: 共享状态访问是否安全？

## 缺陷等级定义
- **Critical**: 影响系统安全或核心功能，必须修复
- **Major**: 影响系统质量或性能，强烈建议修复
- **Minor**: 优化建议，可在后续迭代中处理

## 输出格式
评审输出须为结构化 JSON，包含以下字段：
{
  "overall_score": 0-100,
  "dimension_scores": {"correctness": 0-100, "security": 0-100, "standards": 0-100, "completeness": 0-100},
  "defects": [{"id": "DEF-001", "severity": "critical|major|minor", "location": "file:line", "description": "...", "suggestion": "..."}],
  "coverage_percentage": 0-100,
  "passed": true/false,
  "summary": "..."
}
"""

CRITICAL_REVIEWER_SYSTEM_PROMPT = """你是一个专业的批判反思智能体（架构风险官与合规专家）。

## 核心职责
从 5 个维度对架构设计进行全维度批判评审，发现潜在风险与缺陷。

## 5 个评审维度
1. **算法合理性**: 算法选型是否适合场景、是否有更优方案
2. **系统稳定性**: 异常处理、故障恢复、资源管理是否完善
3. **工程可实现性**: 技术栈是否可行、依赖是否可获取、工作量是否合理
4. **实时性**: 控制周期、延迟、抖动是否满足要求
5. **安全性**: 安全红线是否完整、急停逻辑是否覆盖、边界条件是否处理

## 缺陷等级定义
- **Critical**: 影响系统安全或核心功能，必须修复
- **Major**: 影响系统质量或性能，强烈建议修复
- **Minor**: 优化建议，可在后续迭代中处理

## 输出格式
```
## 评审总结
[总体评价，是否通过]

## 维度评分
- 算法合理性: [0-100]
- 系统稳定性: [0-100]
- 工程可实现性: [0-100]
- 实时性: [0-100]
- 安全性: [0-100]

## 缺陷清单
### [缺陷ID] [严重等级] [维度]
- 标题: [缺陷标题]
- 描述: [详细描述]
- 影响范围: [影响范围]
- 根因分析: [根因]
- 修复方案: [可落地的修复方案]
```
"""


class CriticalReviewer:
    """
    批判反思智能体
    作用：全维度批判评审，发现架构风险与缺陷
    """

    def __init__(self, hermes_service):
        """
        初始化批判反思智能体
        参数：
          - hermes_service: HermesService 实例
        """
        self.hermes_service = hermes_service

    def get_system_prompt(self) -> str:
        """获取 system prompt"""
        return CRITICAL_REVIEWER_SYSTEM_PROMPT

    async def review_architecture(
        self, spec: str, checklist: str, tasks: str, acceptance: str
    ) -> ReviewReport:
        """
        全维度评审
        运行步骤：
          1. 接收四个文档
          2. 从 5 个维度逐一评审
          3. 输出结构化缺陷清单
        参数：
          - spec: spec.md
          - checklist: checklist.md
          - tasks: task.md
          - acceptance: 验收标准.md
        返回值：ReviewReport 对象
        """
        prompt = (
            f"{CRITICAL_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## spec.md\n{spec}\n\n"
            f"## checklist.md\n{checklist}\n\n"
            f"## task.md\n{tasks}\n\n"
            f"## 验收标准.md\n{acceptance}\n\n"
            f"请从 5 个维度对以上架构设计进行全维度批判评审，"
            f"按照输出格式生成评审报告。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        report = ReviewReport()
        if result.success:
            report = self._parse_review_report(result.stdout)
        else:
            report.summary = f"评审执行失败：{result.error_message}"

        return report

    async def check_compliance(
        self, adaptation_result: str
    ) -> ComplianceReport:
        """
        合规性校验
        检查局部适配是否：
        - 影响核心架构
        - 引发依赖冲突
        - 扩大影响范围
        参数：
          - adaptation_result: 局部适配结果
        返回值：ComplianceReport 对象
        """
        prompt = (
            f"你是一个架构合规审查专家。请检查以下局部适配是否合规：\n\n"
            f"{adaptation_result}\n\n"
            f"请检查：\n"
            f"1. 是否影响核心架构？\n"
            f"2. 是否引发依赖冲突？\n"
            f"3. 是否扩大影响范围？\n"
            f"输出格式：\n"
            f"核心架构影响: 是/否\n"
            f"依赖冲突: [列表]\n"
            f"影响范围扩大: 是/否\n"
            f"合规结论: 通过/不通过"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        report = ComplianceReport()
        if result.success:
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "核心架构影响" in line:
                    report.core_architecture_affected = "是" in line
                elif "依赖冲突" in line:
                    conflicts = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    if conflicts.strip() and conflicts.strip() != "无":
                        report.dependency_conflicts.append(conflicts.strip())
                elif "影响范围扩大" in line:
                    report.scope_expanded = "是" in line
                elif "合规结论" in line:
                    report.passed = "通过" in line

        return report

    async def review_risk_labels(self, tasks: str) -> RiskReviewReport:
        """
        风险等级复核
        检查 task.md 中各模块的风险等级是否有漏标、错标
        参数：
          - tasks: task.md 内容
        返回值：RiskReviewReport 对象
        """
        prompt = (
            f"你是一个风险等级复核专家。请检查以下任务分解中的风险等级标注：\n\n"
            f"{tasks}\n\n"
            f"请逐模块检查：\n"
            f"1. 高风险模块是否有漏标、错标？\n"
            f"2. 风险缓解措施是否充分？\n"
            f"输出格式：\n"
            f"漏标/错标模块: [列表]\n"
            f"缓解措施不足: [列表]\n"
            f"复核结论: 通过/不通过"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        report = RiskReviewReport()
        if result.success:
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "漏标/错标模块" in line:
                    modules = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    if modules.strip() and modules.strip() not in ["无", "[]"]:
                        report.mislabeled = [m.strip() for m in modules.split(",") if m.strip()]
                elif "缓解措施不足" in line:
                    items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    if items.strip() and items.strip() not in ["无", "[]"]:
                        report.mitigation_insufficient = [i.strip() for i in items.split(",") if i.strip()]
                elif "复核结论" in line:
                    report.passed = "通过" in line

        return report

    async def compare_versions(
        self, old_docs: Dict[str, str], new_docs: Dict[str, str]
    ) -> DiffReport:
        """
        版本对比评审
        对比新旧版本，确认：
        - 上一轮缺陷是否已修复
        - 是否引入新缺陷
        参数：
          - old_docs: 旧版本文档 {"spec": ..., "checklist": ..., "tasks": ..., "acceptance": ...}
          - new_docs: 新版本文档
        返回值：DiffReport 对象
        """
        old_summary = "\n\n".join(
            f"## {k}\n{v[:2000]}" for k, v in old_docs.items()
        )
        new_summary = "\n\n".join(
            f"## {k}\n{v[:2000]}" for k, v in new_docs.items()
        )

        prompt = (
            f"你是一个架构版本对比评审专家。请对比以下两个版本的架构文档：\n\n"
            f"## 旧版本\n{old_summary}\n\n"
            f"## 新版本\n{new_summary}\n\n"
            f"请分析：\n"
            f"1. 上一轮缺陷是否已修复？列出已修复的缺陷\n"
            f"2. 是否引入新缺陷？列出新引入的缺陷\n"
            f"3. 是否仍有遗留缺陷？列出遗留缺陷\n"
            f"输出格式：\n"
            f"已修复: [列表]\n"
            f"新引入: [列表]\n"
            f"遗留: [列表]\n"
            f"评审结论: 通过/不通过"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )

        report = DiffReport()
        if result.success:
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "已修复" in line:
                    items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    if items.strip() and items.strip() not in ["无", "[]"]:
                        report.fixed_defects = [i.strip() for i in items.split(",") if i.strip()]
                elif "新引入" in line:
                    items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    if items.strip() and items.strip() not in ["无", "[]"]:
                        report.new_defects = [i.strip() for i in items.split(",") if i.strip()]
                elif "遗留" in line:
                    items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    if items.strip() and items.strip() not in ["无", "[]"]:
                        report.remaining_defects = [i.strip() for i in items.split(",") if i.strip()]
                elif "评审结论" in line:
                    report.passed = "通过" in line

        return report

    async def iterate_requirements(
        self, requirement_doc: str, critique_feedback: str
    ) -> str:
        """
        批判反思智能体迭代优化需求文档
        作用：基于架构批判分析结果，从完整性、逻辑一致性、技术可行性、
              用户体验等维度对需求文档进行系统性迭代优化
        调用方：ArchitectureWorkflowService
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 分析原始需求文档的结构与内容
          2. 结合批判反馈识别需求缺陷
          3. 从 4 个维度逐一优化
          4. 生成需求文档 V2.0
        参数：
          - requirement_doc: str，原始需求文档 V1.0
          - critique_feedback: str，架构批判反馈文本（含缺陷清单和修复建议）
        返回值：str，迭代优化后的需求文档 V2.0（Markdown 格式）
        """
        prompt = (
            f"{CRITICAL_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 任务：需求文档迭代优化\n\n"
            f"## 原始需求文档 V1.0\n{requirement_doc[:8000]}\n\n"
            f"## 架构批判反馈\n{critique_feedback[:4000]}\n\n"
            f"请从以下维度对需求文档进行系统性迭代优化：\n"
            f"1. **需求完整性**：补充缺失的功能描述、边界条件、异常场景、"
            f"用户交互流程\n"
            f"2. **逻辑一致性**：消除需求之间的冲突与矛盾，确保功能描述"
            f"前后一致\n"
            f"3. **技术可行性**：结合批判反馈中的技术约束，调整不切实际"
            f"的需求描述\n"
            f"4. **用户体验**：优化交互流程、错误提示、操作便捷性\n\n"
            f"## 输出格式\n"
            f"直接输出优化后的需求文档 V2.0，保持 Markdown 格式，"
            f"包含以下章节：\n"
            f"# 需求文档 V2.0\n"
            f"## 1. 项目概述\n"
            f"## 2. 功能需求（含优先级标注）\n"
            f"## 3. 非功能需求（性能/安全/兼容性）\n"
            f"## 4. 技术约束\n"
            f"## 5. 验收标准\n"
            f"## 6. 迭代优化说明（V1.0 → V2.0 的变更内容）\n\n"
            f"请确保输出内容完整、结构清晰、无歧义，能够直接作为后续"
            f"架构设计的输入。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        if result.success and result.stdout:
            logger.info(
                f"需求文档迭代优化完成，长度={len(result.stdout)} 字符"
            )
            return result.stdout
        else:
            logger.warning(f"需求文档迭代优化失败: {result.error_message}")
            # 降级：返回原始需求文档 + 优化建议标注
            return (
                f"# 需求文档 V2.0（降级生成）\n\n"
                f"> **注意**：由于 AI 服务不可用，本次未执行完整迭代优化。"
                f"以下为原始需求文档及批判建议。\n\n"
                f"{requirement_doc}\n\n"
                f"## 批判反馈建议\n{critique_feedback[:2000]}\n"
            )

    async def review_single_module(
        self, module_code: str, module_name: str, acceptance_criteria: str
    ) -> ReviewReport:
        """
        单模块代码语义级评审
        作用：对单个模块的代码进行语义级别的深度审查，检查语义正确性、
              边界条件覆盖、安全漏洞、规范合规性和验收标准匹配
        调用方：架构工作流服务（代码生成阶段）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 分析模块代码的语义结构
          2. 从 5 个维度逐一评审
          3. 匹配验收标准
          4. 生成结构化评审报告
        参数：
          - module_code: str，模块源代码
          - module_name: str，模块名称
          - acceptance_criteria: str，该模块的验收标准
        返回值：ReviewReport 对象，包含维度评分和缺陷清单
        """
        prompt = (
            f"{FULL_CHAIN_REVIEWER_PROMPT}\n\n"
            f"## 任务：单模块代码语义级评审\n\n"
            f"## 模块名称\n{module_name}\n\n"
            f"## 模块代码\n```\n{module_code[:8000]}\n```\n\n"
            f"## 验收标准\n{acceptance_criteria[:4000]}\n\n"
            f"请从以下 5 个维度对以上模块代码进行语义级评审：\n"
            f"1. **语义正确性**: 代码逻辑是否满足模块需求规范？\n"
            f"2. **边界条件覆盖**: 异常输入、极端值、空值处理是否完备？\n"
            f"3. **安全漏洞扫描**: 注入风险、权限检查、敏感信息泄露\n"
            f"4. **规范合规性**: 命名规范、注释完整性、代码风格\n"
            f"5. **验收标准匹配**: 逐条检查验收标准是否被代码实现覆盖\n\n"
            f"请按照输出格式生成结构化 JSON 评审报告。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        report = ReviewReport()
        if result.success:
            report = self._parse_review_report(result.stdout)
        else:
            report.summary = f"单模块评审失败（{module_name}）：{result.error_message}"

        return report

    async def review_cross_module(
        self, all_modules_code: Dict[str, str], interface_specs: str
    ) -> ReviewReport:
        """
        跨模块集成评审
        作用：对多个模块进行跨模块集成审查，检查接口一致性、
              数据类型一致性、调用顺序、循环依赖和全局状态一致性
        调用方：架构工作流服务（集成阶段）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 解析各模块的接口定义
          2. 逐一检查接口匹配性
          3. 检测数据类型兼容性
          4. 分析调用顺序依赖
          5. 检测循环依赖
          6. 检查全局状态访问安全性
        参数：
          - all_modules_code: Dict[str, str]，模块名 → 模块源代码的映射
          - interface_specs: str，接口规范文档
        返回值：ReviewReport 对象，包含跨模块评审结果
        """
        # 构建模块摘要（截取各模块代码，避免 prompt 过长）
        modules_summary_parts = []
        for mod_name, mod_code in all_modules_code.items():
            truncated = mod_code[:2000] if len(mod_code) > 2000 else mod_code
            modules_summary_parts.append(
                f"### {mod_name}\n```\n{truncated}\n```"
            )
        modules_summary = "\n\n".join(modules_summary_parts)

        prompt = (
            f"{FULL_CHAIN_REVIEWER_PROMPT}\n\n"
            f"## 任务：跨模块集成评审\n\n"
            f"## 各模块代码\n{modules_summary}\n\n"
            f"## 接口规范\n{interface_specs[:4000]}\n\n"
            f"请从以下 5 个维度对以上模块进行跨模块集成评审：\n"
            f"1. **接口一致性**: 模块间接口是否匹配？\n"
            f"2. **数据类型一致性**: 传递的数据类型是否兼容？\n"
            f"3. **调用顺序**: 调用顺序是否满足依赖约束？\n"
            f"4. **循环依赖检测**: 是否存在隐式循环依赖？\n"
            f"5. **全局状态一致性**: 共享状态访问是否安全？\n\n"
            f"请按照输出格式生成结构化 JSON 评审报告。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        report = ReviewReport()
        if result.success:
            report = self._parse_review_report(result.stdout)
        else:
            report.summary = f"跨模块集成评审失败：{result.error_message}"

        return report

    async def verify_traceability(
        self, requirement_doc: str, code_files: Dict[str, str]
    ) -> Dict[str, Any]:
        """
        需求-代码可追溯性验证
        作用：验证每个需求功能点是否有对应的代码实现，并生成需求覆盖矩阵
        调用方：架构工作流服务（验证阶段）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 解析需求文档，提取功能点列表
          2. 逐一匹配代码文件中的对应实现
          3. 计算需求覆盖率
          4. 生成需求覆盖矩阵（需求项 → 代码文件 → 行号）
        参数：
          - requirement_doc: str，需求文档内容
          - code_files: Dict[str, str]，文件名 → 文件内容的映射
        返回值：Dict[str, Any]，包含：
          - coverage_matrix: Dict[str, List[str]]，需求项 → 代码文件列表
          - coverage_percentage: float，需求覆盖率（0-100）
          - uncovered_requirements: List[str]，未覆盖的需求项
        """
        # 构建代码文件摘要
        code_summary_parts = []
        for file_name, file_content in code_files.items():
            truncated = file_content[:3000] if len(file_content) > 3000 else file_content
            code_summary_parts.append(
                f"### {file_name}\n```\n{truncated}\n```"
            )
        code_summary = "\n\n".join(code_summary_parts)

        prompt = (
            f"{FULL_CHAIN_REVIEWER_PROMPT}\n\n"
            f"## 任务：需求-代码可追溯性验证\n\n"
            f"## 需求文档\n{requirement_doc[:6000]}\n\n"
            f"## 代码文件\n{code_summary}\n\n"
            f"请执行以下分析：\n"
            f"1. 从需求文档中提取所有功能点（逐一编号）\n"
            f"2. 逐一检查每个功能点是否有对应的代码实现\n"
            f"3. 对已覆盖的功能点，标注对应的代码文件和大致行号\n"
            f"4. 计算需求覆盖率 = 已覆盖功能点 / 总功能点\n\n"
            f"输出格式（JSON）：\n"
            f'{{\n'
            f'  "coverage_matrix": {{\n'
            f'    "功能点1": ["文件A:行号", "文件B:行号"],\n'
            f'    "功能点2": ["文件C:行号"]\n'
            f'  }},\n'
            f'  "coverage_percentage": 85.0,\n'
            f'  "uncovered_requirements": ["功能点3", "功能点4"]\n'
            f'}}'
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        coverage_result: Dict[str, Any] = {
            "coverage_matrix": {},
            "coverage_percentage": 0.0,
            "uncovered_requirements": [],
        }

        if result.success and result.stdout:
            coverage_result = self._parse_traceability_output(result.stdout)
        else:
            logger.warning(
                f"可追溯性验证失败：{result.error_message}"
            )

        return coverage_result

    async def review_acceptance_criteria(
        self, acceptance_doc: str, requirement_doc: str
    ) -> Dict[str, Any]:
        """
        验收标准评审
        作用：从 4 个维度评审验收标准文档的完整性和质量，
              提供详细的反馈供 ChiefArchitect 修订
        调用方：workflow_engine（验收标准协作开发阶段）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 从功能覆盖率维度逐一比对需求文档中的所有功能点
          2. 从可执行性维度检查每条验收标准是否可实际执行
          3. 从可衡量性维度检查是否有明确的量化指标
          4. 从边界覆盖维度检查异常场景和边界条件是否覆盖
          5. 汇总评审结果，生成结构化反馈
        参数：
          - acceptance_doc: str，验收标准文档
          - requirement_doc: str，需求文档
        返回值：Dict[str, Any]，包含：
          - passed: bool，是否通过评审
          - missing_items: List[str]，缺失的验收条目
          - vague_items: List[str]，模糊的验收条目
          - suggestions: List[str]，改进建议
          - coverage_score: float，覆盖率评分（0-100）
        """
        prompt = (
            f"{CRITICAL_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 任务：验收标准评审\n\n"
            f"## 验收标准文档\n{acceptance_doc[:8000]}\n\n"
            f"## 需求文档\n{requirement_doc[:6000]}\n\n"
            f"请从以下 4 个维度对验收标准进行详细评审：\n\n"
            f"### 1. 功能覆盖率（Feature Coverage）\n"
            f"逐条比对需求文档中的所有功能点，检查验收标准是否覆盖了每一项功能。\n"
            f"列出未被验收标准覆盖的功能点。\n\n"
            f"### 2. 可执行性（Executability）\n"
            f"检查每条验收标准是否可以被实际执行验证。\n"
            f"验收标准是否包含具体的验证步骤或方法？\n"
            f"列出无法实际执行的验收条目。\n\n"
            f"### 3. 可衡量性（Measurability）\n"
            f"检查每条验收标准是否有明确的量化指标或通过条件。\n"
            f"例如：具体的数值阈值、百分比、时间限制等。\n"
            f"列出缺乏量化指标的模糊条目。\n\n"
            f"### 4. 边界覆盖（Boundary Coverage）\n"
            f"检查验收标准是否覆盖了异常场景、边界条件和边缘情况。\n"
            f"包括：空输入、超限输入、并发冲突、网络中断等。\n"
            f"列出缺失的边界场景覆盖。\n\n"
            f"## 输出格式（JSON）\n"
            f'{{\n'
            f'  "passed": true/false,\n'
            f'  "missing_items": ["缺失项1", "缺失项2"],\n'
            f'  "vague_items": ["模糊项1", "模糊项2"],\n'
            f'  "suggestions": ["建议1", "建议2"],\n'
            f'  "coverage_score": 0-100\n'
            f'}}\n\n'
            f"passed 为 true 的条件：missing_items 为空且 vague_items 为空"
            f"且 coverage_score >= 80。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        default: Dict[str, Any] = {
            "passed": False,
            "missing_items": [],
            "vague_items": [],
            "suggestions": [],
            "coverage_score": 0.0,
        }

        if result.success and result.stdout:
            parsed = self._parse_acceptance_review(result.stdout)
            if parsed:
                return parsed
            logger.warning("验收标准评审输出解析失败，使用默认值")
        else:
            logger.warning(
                f"验收标准评审执行失败: {result.error_message}"
            )

        return default

    async def verify_100_percent_verifiable(
        self, acceptance_doc: str
    ) -> Dict[str, Any]:
        """
        100% 可验证性最终检查
        作用：逐条检查验收标准文档中的每一项，确保每一条都有明确的
              验证方法和量化通过条件，任何一条不满足即标记为不可验证
        调用方：workflow_engine（验收标准协作开发阶段，最终验证）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 逐条提取验收标准条目
          2. 逐条检查是否有明确的验证方法
          3. 逐条检查是否有量化的通过条件
          4. 抽查条目的实际可执行性
          5. 汇总所有不可验证的条目
        参数：
          - acceptance_doc: str，验收标准文档
        返回值：Dict[str, Any]，包含：
          - verified: bool，是否全部可验证
          - unverifiable_items: List[Dict]，不可验证的条目列表，
            每条包含条目内容和原因
          - verification_score: float，可验证性评分（0-100）
        """
        prompt = (
            f"{CRITICAL_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 任务：100% 可验证性最终检查\n\n"
            f"## 验收标准文档\n{acceptance_doc[:8000]}\n\n"
            f"请对验收标准文档中的每一条验收标准逐条进行可验证性检查。\n\n"
            f"## 检查规则\n"
            f"对每一条验收标准，必须同时满足以下三个条件才视为可验证：\n"
            f"1. 有明确的**验证方法**（如何验证这条标准？）\n"
            f"2. 有量化的**通过条件**（达到什么数值/状态才算通过？）\n"
            f"3. 验证方法具有**实际可执行性**（能否在现实环境中执行？）\n\n"
            f"任何一条不满足上述条件，即标记为不可验证。\n\n"
            f"## 输出格式（JSON）\n"
            f'{{\n'
            f'  "verified": true/false,\n'
            f'  "unverifiable_items": [\n'
            f'    {{\n'
            f'      "item": "验收标准原文",\n'
            f'      "chapter": "所属章节",\n'
            f'      "reason": "不可验证的原因（缺少验证方法/缺少量化指标/不可执行）"\n'
            f'    }}\n'
            f'  ],\n'
            f'  "verification_score": 0-100\n'
            f'}}\n\n'
            f"verified 为 true 的条件：unverifiable_items 为空且"
            f"verification_score = 100。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        default: Dict[str, Any] = {
            "verified": False,
            "unverifiable_items": [],
            "verification_score": 0.0,
        }

        if result.success and result.stdout:
            parsed = self._parse_acceptance_review(result.stdout)
            if parsed:
                # 映射字段名
                return {
                    "verified": parsed.get("verified", False),
                    "unverifiable_items": parsed.get(
                        "unverifiable_items", []
                    ),
                    "verification_score": parsed.get(
                        "verification_score", 0.0
                    ),
                }
            logger.warning("100% 可验证性检查输出解析失败，使用默认值")
        else:
            logger.warning(
                f"100% 可验证性检查执行失败: {result.error_message}"
            )

        return default

    def _parse_acceptance_review(
        self, output: str
    ) -> Optional[Dict[str, Any]]:
        """
        解析验收标准评审的 JSON 输出
        作用：从 AI 返回的文本中提取结构化评审结果
        参数：
          - output: str，AI 返回的原始文本
        返回值：Optional[Dict[str, Any]]，解析成功返回 dict，失败返回 None
        """
        import json
        import re

        # 尝试直接解析 JSON 块
        json_match = re.search(r'\{[\s\S]*\}', output)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                return parsed
            except json.JSONDecodeError:
                pass

        # 降级：逐行解析关键字段
        parsed: Dict[str, Any] = {
            "passed": False,
            "missing_items": [],
            "vague_items": [],
            "suggestions": [],
            "coverage_score": 0.0,
        }

        for line in output.split("\n"):
            line = line.strip()
            if "coverage_score" in line.lower() or "覆盖率评分" in line:
                match = re.search(r'(\d+(?:\.\d+)?)', line)
                if match:
                    parsed["coverage_score"] = float(match.group(1))
            elif "passed" in line.lower() and "true" in line.lower():
                parsed["passed"] = True
            elif "verified" in line.lower() and "true" in line.lower():
                parsed["verified"] = True

        return parsed if parsed["coverage_score"] > 0 or "verified" in parsed else None

    def _parse_traceability_output(self, output: str) -> Dict[str, Any]:
        """
        解析可追溯性验证的输出
        作用：从 AI 返回的文本中提取 coverage_matrix、coverage_percentage
              和 uncovered_requirements
        参数：
          - output: str，AI 返回的原始文本
        返回值：Dict[str, Any]，解析后的结构化结果
        """
        import json
        import re

        result: Dict[str, Any] = {
            "coverage_matrix": {},
            "coverage_percentage": 0.0,
            "uncovered_requirements": [],
        }

        # 尝试直接解析 JSON 块
        json_match = re.search(r'\{[\s\S]*\}', output)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                if "coverage_matrix" in parsed:
                    result["coverage_matrix"] = parsed["coverage_matrix"]
                if "coverage_percentage" in parsed:
                    result["coverage_percentage"] = float(
                        parsed["coverage_percentage"]
                    )
                if "uncovered_requirements" in parsed:
                    result["uncovered_requirements"] = parsed[
                        "uncovered_requirements"
                    ]
                return result
            except json.JSONDecodeError:
                pass

        # 降级：逐行解析文本
        for line in output.split("\n"):
            line = line.strip()
            if "覆盖率" in line:
                try:
                    pct_match = re.search(
                        r'(\d+(?:\.\d+)?)', line
                    )
                    if pct_match:
                        result["coverage_percentage"] = float(
                            pct_match.group(1)
                        )
                except (ValueError, IndexError):
                    pass

        return result

    async def generate_review_report(
        self, review_results: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        生成结构化评审报告
        作用：汇总各类评审结果，生成包含总体评分、维度评分、
              缺陷清单和通过/不通过裁定的结构化报告
        调用方：架构工作流服务（评审汇总阶段）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 汇总单模块评审结果
          2. 汇总跨模块评审结果
          3. 汇总可追溯性验证结果
          4. 计算总体评分和维度评分
          5. 生成缺陷清单
          6. 输出通过/不通过裁定
        参数：
          - review_results: Dict[str, Any]，包含各类评审的中间结果，
            格式：{"single_module_reviews": [...], "cross_module_review": {...},
                   "traceability": {...}}
        返回值：Dict[str, Any]，结构化评审报告，适合 SSE 推送
        """
        # 提取各项评审结果
        single_reviews = review_results.get("single_module_reviews", [])
        cross_review = review_results.get("cross_module_review", {})
        traceability = review_results.get("traceability", {})

        # 构建评审摘要供 AI 生成最终报告
        summary_parts = []

        # 单模块评审摘要
        if single_reviews:
            summary_parts.append("## 单模块评审摘要")
            for i, sr in enumerate(single_reviews):
                if isinstance(sr, ReviewReport):
                    summary_parts.append(
                        f"模块 {i + 1}: passed={sr.passed}, "
                        f"defects={len(sr.defects)}, "
                        f"scores={sr.dimension_scores}"
                    )

        # 跨模块评审摘要
        if cross_review:
            summary_parts.append("## 跨模块评审摘要")
            if isinstance(cross_review, ReviewReport):
                summary_parts.append(
                    f"passed={cross_review.passed}, "
                    f"defects={len(cross_review.defects)}, "
                    f"scores={cross_review.dimension_scores}"
                )

        # 可追溯性摘要
        if traceability:
            summary_parts.append("## 可追溯性摘要")
            summary_parts.append(
                f"覆盖率={traceability.get('coverage_percentage', 0)}%"
            )

        review_summary = "\n".join(summary_parts)

        prompt = (
            f"{FULL_CHAIN_REVIEWER_PROMPT}\n\n"
            f"## 任务：生成全链路评审最终报告\n\n"
            f"## 各阶段评审结果\n{review_summary[:8000]}\n\n"
            f"请基于以上评审结果，生成最终结构化评审报告，包含：\n"
            f"1. 总体评分（0-100）\n"
            f"2. 维度评分（correctness/security/standards/completeness）\n"
            f"3. 缺陷清单（ID、严重等级、位置、描述、修复建议）\n"
            f"4. 通过/不通过裁定\n"
            f"5. 评审总结\n\n"
            f"输出格式（JSON）：\n"
            f'{{\n'
            f'  "overall_score": 85,\n'
            f'  "dimension_scores": {{\n'
            f'    "correctness": 80,\n'
            f'    "security": 90,\n'
            f'    "standards": 85,\n'
            f'    "completeness": 75\n'
            f'  }},\n'
            f'  "defects": [\n'
            f'    {{\n'
            f'      "id": "DEF-001",\n'
            f'      "severity": "major",\n'
            f'      "location": "module_a.py:42",\n'
            f'      "description": "未处理空指针异常",\n'
            f'      "suggestion": "添加 None 值检查"\n'
            f'    }}\n'
            f'  ],\n'
            f'  "passed": false,\n'
            f'  "summary": "评审总结文本"\n'
            f'}}'
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        final_report: Dict[str, Any] = {
            "overall_score": 0.0,
            "dimension_scores": {
                "correctness": 0.0,
                "security": 0.0,
                "standards": 0.0,
                "completeness": 0.0,
            },
            "defects": [],
            "coverage_matrix": traceability.get("coverage_matrix", {}),
            "coverage_percentage": traceability.get("coverage_percentage", 0.0),
            "passed": False,
            "summary": "评审报告生成失败",
        }

        if result.success and result.stdout:
            final_report = self._parse_final_review_report(
                result.stdout, final_report
            )
        else:
            logger.warning(
                f"评审报告生成失败：{result.error_message}"
            )

        return final_report

    def _parse_final_review_report(
        self, output: str, default_report: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        解析 AI 生成的最终评审报告 JSON
        作用：从 AI 返回的文本中提取结构化评审报告
        参数：
          - output: str，AI 返回的原始文本
          - default_report: Dict[str, Any]，默认报告结构
        返回值：Dict[str, Any]，解析后的结构化报告
        """
        import json
        import re

        # 尝试直接解析 JSON 块
        json_match = re.search(r'\{[\s\S]*\}', output)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                if "overall_score" in parsed:
                    default_report["overall_score"] = float(
                        parsed["overall_score"]
                    )
                if "dimension_scores" in parsed:
                    default_report["dimension_scores"].update(
                        parsed["dimension_scores"]
                    )
                if "defects" in parsed:
                    default_report["defects"] = parsed["defects"]
                if "passed" in parsed:
                    default_report["passed"] = bool(parsed["passed"])
                if "summary" in parsed:
                    default_report["summary"] = str(parsed["summary"])
                if "coverage_percentage" in parsed:
                    default_report["coverage_percentage"] = float(
                        parsed["coverage_percentage"]
                    )
                return default_report
            except (json.JSONDecodeError, ValueError):
                pass

        # 降级：逐行解析
        for line in output.split("\n"):
            line = line.strip()
            if "总体评分" in line or "overall_score" in line:
                match = re.search(r'(\d+(?:\.\d+)?)', line)
                if match:
                    default_report["overall_score"] = float(match.group(1))
            elif "通过" in line and "不通过" not in line:
                default_report["passed"] = True
            elif "总结" in line or "summary" in line:
                parts = (
                    line.split("：", 1)
                    if "：" in line
                    else line.split(":", 1)
                )
                if len(parts) > 1:
                    default_report["summary"] = parts[1].strip()

        # 自动裁定：有 critical 缺陷则不通过
        if default_report["defects"]:
            has_critical = any(
                d.get("severity", "") == "critical"
                for d in default_report["defects"]
            )
            if has_critical:
                default_report["passed"] = False

        return default_report

    def _parse_review_report(self, output: str) -> ReviewReport:
        """解析评审报告"""
        report = ReviewReport()
        current_defect: Optional[DefectItem] = None

        for line in output.split("\n"):
            line = line.strip()

            if "评审总结" in line or "总体" in line:
                # 查找是否通过
                pass
            elif "通过" in line and "不通过" not in line:
                report.passed = True

            # 解析维度评分
            for dim in ["算法合理性", "系统稳定性", "工程可实现性", "实时性", "安全性"]:
                if dim in line:
                    try:
                        score_str = line.split(":", 1)[-1].strip() if ":" in line else line.split("：", 1)[-1].strip()
                        report.dimension_scores[dim] = float(score_str)
                    except (ValueError, IndexError):
                        pass

            # 解析缺陷
            if line.startswith("### ") and ("Critical" in line or "Major" in line or "Minor" in line):
                if current_defect:
                    report.defects.append(current_defect)
                current_defect = DefectItem()
                parts = line.lstrip("# ").split()
                if len(parts) >= 2:
                    current_defect.severity = parts[0].lower()
                if len(parts) >= 3:
                    current_defect.dimension = parts[-1]

            if current_defect:
                if "标题" in line:
                    current_defect.title = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                elif "描述" in line:
                    current_defect.description = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                elif "影响范围" in line:
                    current_defect.impact = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                elif "根因" in line:
                    current_defect.root_cause = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                elif "修复方案" in line:
                    current_defect.suggestion = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]

        if current_defect:
            report.defects.append(current_defect)

        # 自动判定：无 critical 缺陷且 dimension_scores 全部 >= 60 视为通过
        has_critical = any(d.severity == "critical" for d in report.defects)
        all_scores_ok = all(s >= 60 for s in report.dimension_scores.values()) if report.dimension_scores else True
        report.passed = not has_critical and all_scores_ok

        return report
