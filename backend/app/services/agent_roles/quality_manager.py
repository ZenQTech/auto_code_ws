"""
# ============================================================
# 质量保障与迭代管理智能体
# ============================================================
# 核心定位：全系统质量与项目生命周期的统一管理者
# 核心作用：按 5 个阶段执行全链路质量保障与项目管理，
#           通过刚性流转规则确保质量管控无死角
# 运行流程：
#   阶段一：单模块安全校验
#   阶段二：测试脚本生成
#   阶段三：多模块集成校验
#   阶段四：全局系统评测
#   阶段五：迭代闭环与版本管理
# 输入参数：
#   - module_code: 模块代码（阶段一）
#   - module_spec: 模块规格（阶段二）
#   - all_modules: 所有模块（阶段三）
#   - integrated_code: 集成代码（阶段四）
#   - project_context: 项目上下文（阶段五）
# 输出结果：各阶段报告
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
# ============================================================
"""

import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class SafetyReport:
    """单模块安全校验报告"""
    passed: bool = False
    issues: List[Dict[str, str]] = field(default_factory=list)
    boundary_issues: List[str] = field(default_factory=list)
    emergency_stop_issues: List[str] = field(default_factory=list)
    hardcode_issues: List[str] = field(default_factory=list)
    summary: str = ""


@dataclass
class TestScripts:
    """测试脚本"""
    unit_tests: str = ""
    simulation_tests: str = ""
    benchmark_scripts: str = ""
    edge_case_tests: str = ""
    emergency_stop_tests: str = ""
    test_report_template: str = ""


@dataclass
class IntegrationReport:
    """集成校验报告"""
    passed: bool = False
    interface_issues: List[str] = field(default_factory=list)
    type_consistency_issues: List[str] = field(default_factory=list)
    dependency_conflicts: List[str] = field(default_factory=list)
    circular_dependencies: List[str] = field(default_factory=list)
    compilation_errors: List[str] = field(default_factory=list)
    summary: str = ""


@dataclass
class EvaluationReport:
    """全局系统评测报告"""
    passed: bool = False
    architecture_score: float = 0.0
    code_quality_score: float = 0.0
    realtime_score: float = 0.0
    safety_score: float = 0.0
    issues: List[Dict[str, str]] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    final_conclusion: str = ""
    summary: str = ""


@dataclass
class DeliveryPackage:
    """交付物"""
    changelog: str = ""
    delivery_structure: str = ""
    git_commit_guidelines: str = ""
    version_tag: str = ""
    reusable_assets: List[str] = field(default_factory=list)
    summary: str = ""


@dataclass
class BoundaryCheck:
    """阶段边界校验"""
    allowed: bool = True
    violation: str = ""


@dataclass
class EscalationDecision:
    """升级判定"""
    should_escalate: bool = False
    target_stage: str = ""
    reason: str = ""


QUALITY_MANAGER_SYSTEM_PROMPT = """你是一个专业的质量保障与迭代管理智能体（全系统质量与项目生命周期的统一管理者）。

## 核心职责
按 5 个阶段执行全链路质量保障与项目管理，通过刚性流转规则确保质量管控无死角。

## 阶段间刚性边界
- 阶段一仅负责单模块内部安全校验，禁止涉足跨模块接口兼容性校验
- 阶段二在阶段一通过后方可激活
- 阶段三必须在所有模块开发及单模块测试全部完成后激活
- 阶段四在阶段三通过且跨模块安全测试通过后激活
- 阶段五全流程每个节点完成后同步更新状态
- 禁止跳过任何前置环节

## 强制升级条件
- 阶段一发现涉及多模块的安全缺陷 → 立即升级至阶段三处理
- 阶段三发现架构级缺陷或全局性安全问题 → 立即升级至阶段四做全局评审
- 阶段四发现需架构重构的系统性问题 → 强制触发总架构师介入
"""


class QualityManager:
    """质量保障与迭代管理智能体"""

    def __init__(self, hermes_service):
        self.hermes_service = hermes_service

    def get_system_prompt(self) -> str:
        return QUALITY_MANAGER_SYSTEM_PROMPT

    async def execute_stage_1(self, module_code: str) -> SafetyReport:
        """单模块安全校验"""
        prompt = (
            f"{QUALITY_MANAGER_SYSTEM_PROMPT}\n\n"
            f"## 阶段一：单模块安全校验\n\n"
            f"模块代码：\n```\n{module_code[:8000]}\n```\n\n"
            f"请从以下维度进行安全校验：\n"
            f"1. 边界条件校验 2. 异常数据兜底处理 3. 入参合法性校验\n"
            f"4. 急停逻辑分支校验 5. 异常故障兜底机制 6. 参数硬编码问题\n"
            f"7. 跨包引用规范符合性\n\n"
            f"输出格式：\n"
            f"校验结论: 通过/不通过\n"
            f"边界问题: [列表]\n急停问题: [列表]\n硬编码问题: [列表]\n"
            f"其他问题: [列表]\n总结: [描述]"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )
        report = SafetyReport()
        if result.success:
            report = self._parse_safety_report(result.stdout)
        else:
            report.summary = f"校验执行失败：{result.error_message}"
        return report

    async def execute_stage_2(self, module_spec: str) -> TestScripts:
        """测试脚本生成"""
        prompt = (
            f"{QUALITY_MANAGER_SYSTEM_PROMPT}\n\n"
            f"## 阶段二：测试脚本生成\n\n"
            f"模块规格：\n{module_spec}\n\n"
            f"请生成：1. 单元测试代码 2. 仿真测试脚本 3. 核心算法性能 benchmark\n"
            f"4. 参数敏感性分析脚本 5. 极限工况与故障注入测试\n"
            f"6. 急停分支测试 7. 边界条件测试 8. 异常工况测试\n"
            f"同时输出标准化测试报告模板（执行命令、环境依赖、通过判定标准）。"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )
        scripts = TestScripts()
        if result.success:
            scripts = self._parse_test_scripts(result.stdout)
        else:
            scripts.test_report_template = f"生成失败：{result.error_message}"
        return scripts

    async def execute_stage_3(self, all_modules: str) -> IntegrationReport:
        """多模块集成校验"""
        prompt = (
            f"{QUALITY_MANAGER_SYSTEM_PROMPT}\n\n"
            f"## 阶段三：多模块集成校验\n\n"
            f"所有模块信息：\n{all_modules[:8000]}\n\n"
            f"请从以下维度进行集成校验：\n"
            f"1. 多模块接口兼容性 2. ROS 话题/服务数据类型一致性\n"
            f"3. 调用时序匹配度 4. 依赖包版本冲突 5. 编译依赖完整性\n"
            f"6. 跨包引用正确性 7. 隐式循环依赖扫描\n"
            f"8. ROS2 QoS 配置合理性 9. 节点生命周期管理规范性\n\n"
            f"输出格式：\n校验结论: 通过/不通过\n"
            f"接口问题: [列表]\n类型一致性问题: [列表]\n依赖冲突: [列表]\n"
            f"循环依赖: [列表]\n编译错误: [列表]\n总结: [描述]"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )
        report = IntegrationReport()
        if result.success:
            report = self._parse_integration_report(result.stdout)
        else:
            report.summary = f"集成校验执行失败：{result.error_message}"
        return report

    async def execute_stage_4(self, integrated_code: str) -> EvaluationReport:
        """全局系统评测"""
        prompt = (
            f"{QUALITY_MANAGER_SYSTEM_PROMPT}\n\n"
            f"## 阶段四：全局系统评测\n\n"
            f"集成代码：\n```\n{integrated_code[:8000]}\n```\n\n"
            f"请从以下维度进行全局评测：\n"
            f"1. 架构合理性（评分 0-100）2. 代码质量（评分 0-100）\n"
            f"3. 全链路实时性（评分 0-100）4. 安全性（评分 0-100）\n"
            f"5. 全局逻辑漏洞、性能瓶颈、架构缺陷挖掘\n\n"
            f"输出格式：\n终审结论: pass/fail/conditional_pass\n"
            f"架构评分: [0-100]\n代码质量评分: [0-100]\n"
            f"实时性评分: [0-100]\n安全评分: [0-100]\n"
            f"问题列表: [列表]\n优化建议: [列表]\n总结: [描述]"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )
        report = EvaluationReport()
        if result.success:
            report = self._parse_evaluation_report(result.stdout)
        else:
            report.summary = f"全局评测执行失败：{result.error_message}"
        return report

    async def execute_stage_5(self, project_context: str) -> DeliveryPackage:
        """迭代闭环与版本管理"""
        prompt = (
            f"{QUALITY_MANAGER_SYSTEM_PROMPT}\n\n"
            f"## 阶段五：迭代闭环与版本管理\n\n"
            f"项目上下文：\n{project_context[:8000]}\n\n"
            f"请执行：\n"
            f"1. 跟踪全流程需求变更、架构迭代、代码修改、测试问题的闭环情况\n"
            f"2. 输出标准化 CHANGELOG（遵循语义化版本标准）\n"
            f"3. 整理最终交付物（标准化目录结构归档）\n"
            f"4. 筛选项目优质通用资产\n"
            f"5. 输出 Git 提交规范、版本号规则、提交信息标准\n"
            f"6. 输出最终交付版本的 Tag 与说明文档\n\n"
            f"输出格式：\nCHANGELOG: [内容]\n"
            f"交付结构: [内容]\nGit 规范: [内容]\n"
            f"版本 Tag: [内容]\n可复用资产: [列表]\n总结: [描述]"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )
        package = DeliveryPackage()
        if result.success:
            package = self._parse_delivery_package(result.stdout)
        else:
            package.summary = f"交付管理执行失败：{result.error_message}"
        return package

    def check_stage_boundary(self, current_stage: str, action: str) -> BoundaryCheck:
        """阶段边界校验"""
        stage_order = ["stage_1", "stage_2", "stage_3", "stage_4", "stage_5"]
        if current_stage not in stage_order:
            return BoundaryCheck(allowed=False, violation=f"未知阶段: {current_stage}")
        current_idx = stage_order.index(current_stage)
        if action == "advance" and current_idx >= len(stage_order) - 1:
            return BoundaryCheck(allowed=False, violation="已是最后阶段")
        if action == "skip" and current_idx < len(stage_order) - 1:
            return BoundaryCheck(allowed=False, violation="禁止跳过前置环节")
        return BoundaryCheck(allowed=True)

    def evaluate_escalation(self, findings: Dict[str, Any]) -> EscalationDecision:
        """升级判定"""
        decision = EscalationDecision()
        stage = findings.get("stage", "")
        has_multi_module = findings.get("multi_module_issue", False)
        has_architecture_issue = findings.get("architecture_issue", False)
        has_systemic_issue = findings.get("systemic_issue", False)

        if stage == "stage_1" and has_multi_module:
            decision.should_escalate = True
            decision.target_stage = "stage_3"
            decision.reason = "阶段一发现涉及多模块的安全缺陷，升级至阶段三"
        elif stage == "stage_3" and (has_architecture_issue or has_systemic_issue):
            decision.should_escalate = True
            decision.target_stage = "stage_4"
            decision.reason = "阶段三发现架构级缺陷或全局性安全问题，升级至阶段四"
        elif stage == "stage_4" and has_systemic_issue:
            decision.should_escalate = True
            decision.target_stage = "architect"
            decision.reason = "阶段四发现需架构重构的系统性问题，强制触发总架构师介入"

        return decision

    # ============================================================
    # 解析辅助方法
    # ============================================================

    def _parse_safety_report(self, output: str) -> SafetyReport:
        report = SafetyReport()
        for line in output.split("\n"):
            line = line.strip()
            if "校验结论" in line:
                report.passed = "通过" in line
            elif "边界问题" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.boundary_issues = [i.strip() for i in items.split(",") if i.strip()]
            elif "急停问题" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.emergency_stop_issues = [i.strip() for i in items.split(",") if i.strip()]
            elif "硬编码问题" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.hardcode_issues = [i.strip() for i in items.split(",") if i.strip()]
            elif "总结" in line:
                report.summary = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
        return report

    def _parse_test_scripts(self, output: str) -> TestScripts:
        scripts = TestScripts()
        current_section = ""
        for line in output.split("\n"):
            line = line.strip()
            if "单元测试" in line:
                current_section = "unit"
            elif "仿真测试" in line:
                current_section = "simulation"
            elif "benchmark" in line.lower() or "性能" in line:
                current_section = "benchmark"
            elif "极限工况" in line or "故障注入" in line:
                current_section = "edge"
            elif "急停" in line:
                current_section = "emergency"
            elif "测试报告模板" in line or "报告模板" in line:
                current_section = "template"
            else:
                if current_section == "unit":
                    scripts.unit_tests += line + "\n"
                elif current_section == "simulation":
                    scripts.simulation_tests += line + "\n"
                elif current_section == "benchmark":
                    scripts.benchmark_scripts += line + "\n"
                elif current_section == "edge":
                    scripts.edge_case_tests += line + "\n"
                elif current_section == "emergency":
                    scripts.emergency_stop_tests += line + "\n"
                elif current_section == "template":
                    scripts.test_report_template += line + "\n"
        return scripts

    def _parse_integration_report(self, output: str) -> IntegrationReport:
        report = IntegrationReport()
        for line in output.split("\n"):
            line = line.strip()
            if "校验结论" in line:
                report.passed = "通过" in line
            elif "接口问题" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.interface_issues = [i.strip() for i in items.split(",") if i.strip()]
            elif "类型一致性" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.type_consistency_issues = [i.strip() for i in items.split(",") if i.strip()]
            elif "依赖冲突" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.dependency_conflicts = [i.strip() for i in items.split(",") if i.strip()]
            elif "循环依赖" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.circular_dependencies = [i.strip() for i in items.split(",") if i.strip()]
            elif "编译错误" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.compilation_errors = [i.strip() for i in items.split(",") if i.strip()]
            elif "总结" in line:
                report.summary = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
        return report

    def _parse_evaluation_report(self, output: str) -> EvaluationReport:
        report = EvaluationReport()
        for line in output.split("\n"):
            line = line.strip()
            if "终审结论" in line:
                conclusion = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                report.final_conclusion = conclusion.strip()
                report.passed = "pass" in conclusion.strip().lower()
            elif "架构评分" in line:
                try:
                    report.architecture_score = float(line.split("：", 1)[-1].strip() if "：" in line else line.split(":", 1)[-1].strip())
                except ValueError:
                    pass
            elif "代码质量评分" in line:
                try:
                    report.code_quality_score = float(line.split("：", 1)[-1].strip() if "：" in line else line.split(":", 1)[-1].strip())
                except ValueError:
                    pass
            elif "实时性评分" in line:
                try:
                    report.realtime_score = float(line.split("：", 1)[-1].strip() if "：" in line else line.split(":", 1)[-1].strip())
                except ValueError:
                    pass
            elif "安全评分" in line:
                try:
                    report.safety_score = float(line.split("：", 1)[-1].strip() if "：" in line else line.split(":", 1)[-1].strip())
                except ValueError:
                    pass
            elif "优化建议" in line:
                items = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                if items.strip() and items.strip() not in ["无", "[]"]:
                    report.recommendations = [i.strip() for i in items.split(",") if i.strip()]
            elif "总结" in line:
                report.summary = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
        return report

    def _parse_delivery_package(self, output: str) -> DeliveryPackage:
        package = DeliveryPackage()
        current_section = ""
        for line in output.split("\n"):
            line = line.strip()
            if "CHANGELOG" in line:
                current_section = "changelog"
            elif "交付结构" in line:
                current_section = "structure"
            elif "Git 规范" in line:
                current_section = "git"
            elif "版本 Tag" in line:
                current_section = "tag"
            elif "可复用资产" in line:
                current_section = "assets"
            elif "总结" in line:
                current_section = "summary"
            else:
                if current_section == "changelog":
                    package.changelog += line + "\n"
                elif current_section == "structure":
                    package.delivery_structure += line + "\n"
                elif current_section == "git":
                    package.git_commit_guidelines += line + "\n"
                elif current_section == "tag":
                    package.version_tag += line + "\n"
                elif current_section == "assets" and line.startswith("-"):
                    package.reusable_assets.append(line.lstrip("- ").strip())
                elif current_section == "summary":
                    package.summary += line + "\n"
        return package
