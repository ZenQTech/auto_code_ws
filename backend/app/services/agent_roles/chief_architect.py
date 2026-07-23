"""
# ============================================================
# 总架构师智能体
# ============================================================
# 核心定位：全系统架构的统一治理者
# 核心作用：集成顶层设计、重构与局部适配能力，输出
#           spec.md、checklist.md、task.md、验收标准.md 四个文档
# 运行流程：
#   1. 分析需求文档，评估影响范围
#   2. 全局架构范畴 → 执行完整架构设计
#   3. 局部适配范畴 → 执行局部变更（全程自检红线）
#   4. 与批判反思智能体讨论验收标准
#   5. 输出四个文档
# 输入参数：
#   - requirement_doc: 需求文档
#   - change_request: 变更请求（局部适配时）
#   - current_arch: 当前架构（局部适配时）
# 输出结果：ArchitectureOutput（含 spec/checklist/task/acceptance 四文档）
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
#   - 2026-07-22 | v1.1.0 | 新增 generate_draft_acceptance() 和 revise_acceptance() 方法，
#     支持与 CriticalReviewer 协作完成验收标准开发
#   - 2026-07-22 | v1.2.0 | 新增交互式需求引导能力：
#       * 新增 TaskFramework dataclass
#       * 新增 CHIEF_ARCHITECT_GUIDANCE_PROMPT（6维度结构化引导）
#       * 新增 gather_requirements 方法（多轮需求收集）
#       * 新增 generate_task_framework 方法（任务框架生成）
# ============================================================
"""

import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ArchitectureOutput:
    """架构设计输出"""
    spec: str = ""  # spec.md
    checklist: str = ""  # checklist.md
    tasks: str = ""  # task.md
    acceptance: str = ""  # 验收标准.md
    scope: str = ""  # 影响范围：global/local


@dataclass
class AdaptationResult:
    """局部适配结果"""
    success: bool = False
    changes: List[str] = field(default_factory=list)
    affected_modules: List[str] = field(default_factory=list)
    redline_violations: List[str] = field(default_factory=list)
    requires_escalation: bool = False


@dataclass
class ScopeAssessment:
    """影响范围评估"""
    scope: str = ""  # global/local
    affected_modules: List[str] = field(default_factory=list)
    affected_interfaces: List[str] = field(default_factory=list)
    risk_level: str = "low"  # high/medium/low


@dataclass
class RedlineCheck:
    """红线自检结果"""
    passed: bool = True
    violations: List[str] = field(default_factory=list)


@dataclass
class TaskFramework:
    """
    任务框架数据结构
    用途：承载需求分析完成后的结构化任务框架
    字段说明：
      - project_overview: 项目概述（一句话描述）
      - modules: 模块划分列表，每个模块含 name/priority/description
      - dependencies: 模块依赖关系列表，每个含 from_module/to_module
      - tech_stack: 技术选型字典，key 为技术类别，value 为选型与理由
      - risks: 风险识别列表，每个含 risk/severity/mitigation
    """
    project_overview: str = ""
    modules: List[Dict[str, str]] = field(default_factory=list)
    dependencies: List[Dict[str, str]] = field(default_factory=list)
    tech_stack: Dict[str, str] = field(default_factory=dict)
    risks: List[Dict[str, str]] = field(default_factory=list)


CHIEF_ARCHITECT_SYSTEM_PROMPT = """你是一个专业的总架构师智能体（全系统架构的统一治理者）。

## 核心职责
你负责全系统架构的统一治理，集成顶层设计、重构与局部适配能力。

## 工作流程
1. 分析需求文档，评估影响范围
2. 属于全局架构范畴 → 执行完整架构设计
3. 属于局部适配范畴 → 执行局部变更（全程自检红线）
4. 与批判反思智能体讨论验收标准
5. 输出四个文档：spec.md、checklist.md、task.md、验收标准.md

## 权责红线（绝对禁止）
以下行为绝对禁止，一旦涉及立即中止当前工作流，转为架构级处理流程：
- 以局部适配名义修改系统核心架构
- 修改跨模块全局接口规范
- 修改核心算法选型
- 修改核心安全约束与性能指标

## 强制升级条件
- 局部适配过程中发现实际影响模块数 ≥ 2 → 即刻升级为全局架构变更
- 涉及接口变更且影响 ≥ 2 个模块 → 必须先获得人工确认

## 输出规范

### spec.md 格式
# 架构设计文档 (spec.md)

## 1. 模块视图
[系统模块划分、职责、接口]

## 2. 接口契约
[模块间接口定义、数据格式、通信协议]

## 3. 安全与性能基线
[安全约束、性能指标、可靠性要求]

## 4. 技术选型
[技术栈、框架、库版本]

## 5. 部署架构
[部署拓扑、资源需求]

### checklist.md 格式
# 架构合规检查清单

- [ ] 模块职责单一，无循环依赖
- [ ] 接口契约完整，含错误处理
- [ ] 安全红线已覆盖所有模块
- [ ] 性能指标可量化、可测量
- [ ] 技术选型版本明确、兼容性已验证
- [ ] 部署方案可执行

### task.md 格式
# 任务分解文档

## 模块1: [名称]
- 描述: [详细描述]
- 优先级: high/medium/low
- 依赖: [依赖模块]
- 预估复杂度: 0.0-1.0
- 风险等级: 高/中/低
- 验收标准: [具体标准]

### 验收标准.md 格式
# 验收标准

## 模块级验收
[每个模块的具体验收标准]

## 集成验收
[模块间集成验收标准]

## 系统级验收
[端到端系统验收标准]

## 安全验收
[安全红线验收标准]
"""


CHIEF_ARCHITECT_GUIDANCE_PROMPT = """你是一个专业的总架构师智能体，负责通过交互式引导收集完整的需求信息。

## 核心职责
通过结构化提问，逐步引导用户补充需求细节，确保需求文档覆盖所有关键维度。

## 六大引导维度
你必须从以下 6 个维度分析用户需求，识别信息缺口并生成引导问题：

1. **功能目标（Functional Goals）**
   - 用户期望的具体功能特性
   - 核心业务流程与用例
   - 用户角色与权限划分

2. **技术栈（Tech Stack）**
   - 编程语言偏好
   - 框架与库的选择
   - 开发工具链要求

3. **性能指标（Performance）**
   - 响应时间要求
   - 吞吐量期望
   - 并发用户数/连接数
   - 数据处理规模

4. **安全要求（Security）**
   - 认证方式（OAuth、JWT、SAML 等）
   - 授权模型（RBAC、ABAC 等）
   - 数据加密标准
   - 审计日志要求

5. **部署环境（Deployment）**
   - 目标操作系统
   - 硬件资源规格
   - 网络拓扑结构
   - 容器化/编排需求

6. **约束条件（Constraints）**
   - 时间限制（交付期限）
   - 资源限制（人力、预算）
   - 兼容性要求（向后兼容、平台兼容）
   - 合规性要求（行业标准、法规）

## 输出格式
你必须以严格的 JSON 格式输出，结构如下：

```json
{
  "dimensions_covered": ["功能目标", "技术栈"],
  "dimensions_missing": ["性能指标", "安全要求", "部署环境", "约束条件"],
  "questions": [
    {
      "dimension": "性能指标",
      "question": "系统需要支持多少并发用户？期望的响应时间是多少？",
      "priority": "high"
    }
  ],
  "sufficient": false
}
```

## 关键规则
- 每轮最多生成 5 个问题，优先高优先级维度
- 当至少 4 个维度有明确答案时，sufficient 设为 true
- 最多 5 轮提问，超过后自动标记 sufficient 为 true
- 问题必须具体、可量化，避免模糊提问
"""


class ChiefArchitect:
    """
    总架构师智能体
    作用：全系统架构统一治理，输出四文档
    """

    def __init__(self, hermes_service):
        """
        初始化总架构师智能体
        参数：
          - hermes_service: HermesService 实例
        """
        self.hermes_service = hermes_service

    def get_system_prompt(self) -> str:
        """获取 system prompt"""
        return CHIEF_ARCHITECT_SYSTEM_PROMPT

    async def design_architecture(
        self, requirement_doc: str
    ) -> ArchitectureOutput:
        """
        全局架构设计
        运行步骤：
          1. 分析需求文档
          2. 设计系统架构
          3. 输出四文档
        参数：
          - requirement_doc: 需求文档
        返回值：ArchitectureOutput 对象
        """
        prompt = (
            f"{CHIEF_ARCHITECT_SYSTEM_PROMPT}\n\n"
            f"需求文档：\n{requirement_doc}\n\n"
            f"请基于以上需求文档，按照输出规范生成四个文档。"
            f"先输出 spec.md，然后 checklist.md，然后 task.md，最后验收标准.md。"
            f"每个文档之间用 '---' 分隔。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=600,  # v5.5.0 修复：从 300 提升到 600，匹配 4 个长文档生成时间
        )

        if not result.success:
            return ArchitectureOutput(
                spec=f"# 架构设计失败\n\n{result.error_message}",
                scope="global",
            )

        return self._parse_architecture_output(result.stdout)

    async def adapt_local(
        self, change_request: str, current_arch: str
    ) -> AdaptationResult:
        """
        局部适配
        运行步骤：
          1. 分析变更请求
          2. 执行红线自检
          3. 判断是否需要升级
        参数：
          - change_request: 变更请求
          - current_arch: 当前架构文档
        返回值：AdaptationResult 对象
        """
        # 先执行红线自检
        redline = await self.check_redline(change_request, current_arch)
        if not redline.passed:
            return AdaptationResult(
                success=False,
                redline_violations=redline.violations,
                requires_escalation=True,
            )

        # 评估影响范围
        scope = await self.evaluate_scope(change_request, current_arch)
        if len(scope.affected_modules) >= 2:
            return AdaptationResult(
                success=False,
                affected_modules=scope.affected_modules,
                requires_escalation=True,
            )

        # 执行局部适配
        prompt = (
            f"{CHIEF_ARCHITECT_SYSTEM_PROMPT}\n\n"
            f"当前架构：\n{current_arch}\n\n"
            f"变更请求：\n{change_request}\n\n"
            f"这是一个局部适配任务。请分析变更内容，输出：\n"
            f"1. 具体变更列表\n"
            f"2. 受影响的模块\n"
            f"3. 确认未触犯权责红线"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )

        adaptation = AdaptationResult(success=result.success)
        if result.success:
            # 解析输出
            for line in result.stdout.split("\n"):
                line = line.strip()
                if line.startswith("- ") or line.startswith("* "):
                    adaptation.changes.append(line.lstrip("- *").strip())

        return adaptation

    async def evaluate_scope(
        self, change: str, current_arch: str = ""
    ) -> ScopeAssessment:
        """
        影响范围评估
        参数：
          - change: 变更内容
          - current_arch: 当前架构
        返回值：ScopeAssessment 对象
        """
        prompt = (
            f"你是一个架构影响范围评估专家。\n\n"
            f"当前架构：\n{current_arch}\n\n"
            f"变更内容：\n{change}\n\n"
            f"请评估此变更的影响范围：\n"
            f"1. 范围：global（全局架构变更）/ local（局部适配）\n"
            f"2. 受影响模块：[列表]\n"
            f"3. 受影响接口：[列表]\n"
            f"4. 风险等级：high/medium/low"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        assessment = ScopeAssessment()
        if result.success:
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "范围" in line or "scope" in line.lower():
                    if "global" in line.lower() or "全局" in line:
                        assessment.scope = "global"
                    else:
                        assessment.scope = "local"
                elif "受影响模块" in line:
                    modules = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    assessment.affected_modules = [
                        m.strip() for m in modules.split(",") if m.strip()
                    ]
                elif "风险等级" in line:
                    if "high" in line.lower() or "高" in line:
                        assessment.risk_level = "high"
                    elif "medium" in line.lower() or "中" in line:
                        assessment.risk_level = "medium"

        return assessment

    async def check_redline(
        self, adaptation: str, current_arch: str = ""
    ) -> RedlineCheck:
        """
        红线自检
        检查是否触犯权责红线：
        - 是否修改系统核心架构
        - 是否修改跨模块全局接口规范
        - 是否修改核心算法选型
        - 是否修改核心安全约束与性能指标
        参数：
          - adaptation: 适配内容
          - current_arch: 当前架构
        返回值：RedlineCheck 对象
        """
        prompt = (
            f"你是一个架构红线审查专家。请检查以下变更是否触犯权责红线。\n\n"
            f"当前架构：\n{current_arch}\n\n"
            f"变更内容：\n{adaptation}\n\n"
            f"权责红线（绝对禁止）：\n"
            f"1. 以局部适配名义修改系统核心架构\n"
            f"2. 修改跨模块全局接口规范\n"
            f"3. 修改核心算法选型\n"
            f"4. 修改核心安全约束与性能指标\n\n"
            f"请逐条检查，输出：\n"
            f"红线1: 通过/违规 - [说明]\n"
            f"红线2: 通过/违规 - [说明]\n"
            f"红线3: 通过/违规 - [说明]\n"
            f"红线4: 通过/违规 - [说明]\n"
            f"总结: 通过/违规"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        check = RedlineCheck()
        if result.success:
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "违规" in line:
                    check.passed = False
                    check.violations.append(line)
                elif "总结" in line and "违规" in line:
                    check.passed = False

        return check

    async def generate_spec(self, architecture: str) -> str:
        """生成 spec.md"""
        prompt = (
            f"基于以下架构分析，生成 spec.md 文档：\n\n{architecture}\n\n"
            f"请按照 spec.md 输出规范生成完整文档。"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )
        return result.stdout if result.success else ""

    async def generate_checklist(self, architecture: str) -> str:
        """生成 checklist.md"""
        prompt = (
            f"基于以下架构分析，生成 checklist.md 文档：\n\n{architecture}\n\n"
            f"请按照 checklist.md 输出规范生成完整文档。"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )
        return result.stdout if result.success else ""

    async def generate_tasks(self, architecture: str) -> str:
        """生成 task.md"""
        prompt = (
            f"基于以下架构分析，生成 task.md 文档：\n\n{architecture}\n\n"
            f"请按照 task.md 输出规范生成完整文档，包含模块拆分、优先级、依赖关系、风险等级。"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )
        return result.stdout if result.success else ""

    async def generate_acceptance_criteria(
        self, architecture: str, critic_feedback: str = ""
    ) -> str:
        """生成验收标准.md"""
        feedback_section = (
            f"\n\n批判反思智能体的反馈：\n{critic_feedback}"
            if critic_feedback else ""
        )
        prompt = (
            f"基于以下架构分析，生成验收标准.md 文档：\n\n{architecture}{feedback_section}\n\n"
            f"请按照验收标准.md 输出规范生成完整文档，"
            f"包含模块级验收、集成验收、系统级验收、安全验收。"
        )
        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )
        return result.stdout if result.success else ""

    async def generate_draft_acceptance(
        self, task_framework: str, requirement_doc: str
    ) -> str:
        """
        生成初步的验收标准文档
        作用：基于任务框架和需求文档，生成包含 8 个章节的验收标准草案，
              供 CriticalReviewer 评审后迭代修订
        调用方：workflow_engine（验收标准协作开发阶段）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 融合任务框架和需求文档
          2. 按 8 章结构生成验收标准草案
          3. 返回 Markdown 格式的验收标准文档
        参数：
          - task_framework: str，任务框架文档（含模块分解、接口定义等）
          - requirement_doc: str，需求文档
        返回值：str，Markdown 格式的验收标准草案
        """
        prompt = (
            f"{CHIEF_ARCHITECT_SYSTEM_PROMPT}\n\n"
            f"## 任务：生成验收标准草案\n\n"
            f"## 任务框架\n{task_framework[:8000]}\n\n"
            f"## 需求文档\n{requirement_doc[:8000]}\n\n"
            f"请基于以上任务框架和需求文档，生成一份完整的验收标准文档。"
            f"验收标准必须包含以下 8 个章节，每个章节都要有具体、可量化、可执行的验收条目：\n\n"
            f"## 1. 模块级验收\n"
            f"每个模块的验证方法、通过条件、测试用例数量要求。\n"
            f"明确列出每个模块需要验证的功能点、接口、边界条件。\n\n"
            f"## 2. 集成验收\n"
            f"模块间接口的验证方法、数据流完整性验证、跨模块调用链验证。\n"
            f"包含接口契约一致性检查、消息格式兼容性验证。\n\n"
            f"## 3. 系统级验收\n"
            f"端到端功能验证，包括完整业务流程走通、用户场景覆盖。\n"
            f"明确系统级测试用例和预期结果。\n\n"
            f"## 4. 代码质量验收\n"
            f"Lint 规则、测试覆盖率要求（如 ≥ 80%）、注释完整性要求。\n"
            f"代码风格一致性检查、圈复杂度限制。\n\n"
            f"## 5. 性能验收\n"
            f"响应时间、吞吐量、资源使用率（CPU/内存/磁盘）的量化指标。\n"
            f"并发场景下的性能基准和压测要求。\n\n"
            f"## 6. 安全验收\n"
            f"安全红线检查、权限验证、数据保护措施、输入校验。\n"
            f"急停逻辑验证、异常场景安全回退验证。\n\n"
            f"## 7. 兼容性验收\n"
            f"多环境验证要求（操作系统、硬件平台、依赖版本）。\n"
            f"前后向兼容性检查。\n\n"
            f"## 8. 验收环境要求\n"
            f"测试环境配置、测试数据准备、测试工具清单。\n"
            f"环境搭建步骤和验证方法。\n\n"
            f"## 输出要求\n"
            f"直接输出 Markdown 格式的验收标准文档，"
            f"每个条目都包含明确的验证方法和量化通过条件。"
            f"不要输出任何其他内容，只输出验收标准文档本身。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,
        )

        if result.success and result.stdout:
            logger.info(
                f"验收标准草案生成完成，长度={len(result.stdout)} 字符"
            )
            return result.stdout
        else:
            logger.warning(f"验收标准草案生成失败: {result.error_message}")
            # 降级：返回基于模板的验收标准
            return (
                f"# 验收标准（降级生成）\n\n"
                f"> **注意**：由于 AI 服务不可用，以下为基于模板的验收标准，"
                f"需人工审核完善。\n\n"
                f"## 1. 模块级验收\n"
                f"待人工补充：各模块的验证方法和通过条件\n\n"
                f"## 2. 集成验收\n"
                f"待人工补充：模块间接口验证方法\n\n"
                f"## 3. 系统级验收\n"
                f"待人工补充：端到端功能验证\n\n"
                f"## 4. 代码质量验收\n"
                f"待人工补充：Lint 规则、测试覆盖率要求\n\n"
                f"## 5. 性能验收\n"
                f"待人工补充：响应时间、吞吐量等指标\n\n"
                f"## 6. 安全验收\n"
                f"待人工补充：安全红线、权限验证等\n\n"
                f"## 7. 兼容性验收\n"
                f"待人工补充：多环境验证要求\n\n"
                f"## 8. 验收环境要求\n"
                f"待人工补充：测试环境、数据、工具\n\n"
                f"## 原始需求\n{requirement_doc[:2000]}\n"
            )

    async def revise_acceptance(
        self, acceptance_doc: str, review_feedback: str
    ) -> str:
        """
        根据评审反馈修订验收标准文档
        作用：接收 CriticalReviewer 的评审反馈（缺失项、模糊项、建议），
              逐条修订验收标准，确保覆盖所有评审意见
        调用方：workflow_engine（验收标准迭代修订阶段）
        被调用方：hermes_service（执行 AI 调用）
        运行步骤：
          1. 分析评审反馈中的缺失项、模糊项、建议
          2. 逐条修订对应章节的验收标准
          3. 确保修订后的条目可量化、可执行
          4. 返回修订后的验收标准文档
        参数：
          - acceptance_doc: str，当前验收标准文档
          - review_feedback: str，CriticalReviewer 的评审反馈
        返回值：str，修订后的 Markdown 格式验收标准文档
        """
        prompt = (
            f"{CHIEF_ARCHITECT_SYSTEM_PROMPT}\n\n"
            f"## 任务：修订验收标准文档\n\n"
            f"## 当前验收标准\n{acceptance_doc[:8000]}\n\n"
            f"## 评审反馈\n{review_feedback[:4000]}\n\n"
            f"请根据评审反馈逐条修订验收标准文档。修订要求：\n"
            f"1. 针对反馈中提到的缺失项，补充对应的验收条目\n"
            f"2. 针对反馈中提到的模糊项，明确量化指标和验证方法\n"
            f"3. 针对反馈中的建议，评估并采纳合理建议\n"
            f"4. 保持 8 章结构不变\n"
            f"5. 每个条目必须包含明确的验证方法和量化通过条件\n\n"
            f"## 输出要求\n"
            f"直接输出修订后的完整 Markdown 格式验收标准文档，"
            f"不要输出任何其他内容。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=600,  # v5.5.0 修复：从 300 提升到 600
        )

        if result.success and result.stdout:
            logger.info(
                f"验收标准修订完成，长度={len(result.stdout)} 字符"
            )
            return result.stdout
        else:
            logger.warning(f"验收标准修订失败: {result.error_message}")
            # 降级：返回原验收标准+反馈标注
            return (
                f"{acceptance_doc}\n\n"
                f"---\n\n"
                f"## 待修订项（基于评审反馈）\n\n"
                f"> **注意**：由于 AI 服务不可用，以下反馈需人工处理。\n\n"
                f"{review_feedback[:2000]}\n"
            )

    # ---- 六大引导维度名称（中文） ----
    _ALL_DIMENSIONS = [
        "功能目标",
        "技术栈",
        "性能指标",
        "安全要求",
        "部署环境",
        "约束条件",
    ]

    async def gather_requirements(
        self,
        requirement_doc: str,
        user_responses: str,
        round_number: int,
    ) -> Dict[str, Any]:
        """
        交互式需求收集引导
        运行步骤：
          1. 分析当前需求文档和用户回答，识别已覆盖维度
          2. 找出尚未覆盖的维度
          3. 生成下一轮引导问题
          4. 判断是否收集充分（≥4个维度有明确答案，或≥5轮）
        参数：
          - requirement_doc: 当前累积的需求文档
          - user_responses: 上一轮用户的回答内容
          - round_number: 当前轮次编号（从 1 开始）
        返回值：dict，包含：
          - dimensions_covered: 已覆盖的维度列表
          - dimensions_missing: 缺失的维度列表
          - questions: 本轮的引导问题列表
          - sufficient: 是否已收集充分
        """
        import json as _json

        # 关键规则：最多 5 轮，超过则强制 sufficient
        if round_number > 5:
            logger.info(
                "需求收集已达最大轮次 %d，强制标记 sufficient=True",
                round_number - 1,
            )
            return {
                "dimensions_covered": self._ALL_DIMENSIONS,
                "dimensions_missing": [],
                "questions": [],
                "sufficient": True,
            }

        prompt = (
            f"{CHIEF_ARCHITECT_GUIDANCE_PROMPT}\n\n"
            f"## 第 {round_number} 轮需求收集\n\n"
            f"### 当前需求文档\n{requirement_doc}\n\n"
            f"### 上一轮用户回答\n{user_responses}\n\n"
            f"请分析当前需求覆盖情况，识别信息缺口，"
            f"生成第 {round_number} 轮的引导问题。"
            f"严格按 JSON 格式输出。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )

        if not result.success:
            logger.error("需求收集 LLM 调用失败: %s", result.error_message)
            return {
                "dimensions_covered": [],
                "dimensions_missing": self._ALL_DIMENSIONS.copy(),
                "questions": [],
                "sufficient": True,
            }

        return self._parse_gather_result(result.stdout, round_number)

    def _parse_gather_result(
        self, output: str, round_number: int
    ) -> Dict[str, Any]:
        """
        解析 LLM 返回的需求收集结果
        运行步骤：
          1. 尝试从输出中提取 JSON 块
          2. 解析 dimensions_covered / dimensions_missing / questions / sufficient
          3. 边界校验：确保字段存在且格式正确
          4. 超轮次强制 sufficient
        参数：
          - output: LLM 原始输出文本
          - round_number: 当前轮次
        返回值：标准化的 dict
        """
        import json as _json
        import re as _re

        # 尝试提取 JSON 块
        json_match = _re.search(r"\{[\s\S]*\}", output)
        if not json_match:
            logger.warning("无法从 LLM 输出中解析 JSON，返回默认结果")
            return {
                "dimensions_covered": [],
                "dimensions_missing": self._ALL_DIMENSIONS.copy(),
                "questions": [],
                "sufficient": round_number >= 5,
            }

        try:
            parsed = _json.loads(json_match.group(0))
        except _json.JSONDecodeError as e:
            logger.warning("JSON 解析失败: %s", e)
            return {
                "dimensions_covered": [],
                "dimensions_missing": self._ALL_DIMENSIONS.copy(),
                "questions": [],
                "sufficient": round_number >= 5,
            }

        # 提取并标准化字段
        dimensions_covered = parsed.get("dimensions_covered", [])
        if not isinstance(dimensions_covered, list):
            dimensions_covered = []

        dimensions_missing = parsed.get("dimensions_missing", [])
        if not isinstance(dimensions_missing, list):
            dimensions_missing = self._ALL_DIMENSIONS.copy()

        questions = parsed.get("questions", [])
        if not isinstance(questions, list):
            questions = []

        # 过滤非法 question 条目
        questions = [
            q for q in questions
            if isinstance(q, dict) and "dimension" in q and "question" in q
        ]

        # 每轮最多 5 个问题
        questions = questions[:5]

        sufficient = parsed.get("sufficient", False)
        if not isinstance(sufficient, bool):
            sufficient = len(dimensions_covered) >= 4

        # 边界：超过 5 轮强制 sufficient
        if round_number >= 5:
            sufficient = True

        return {
            "dimensions_covered": dimensions_covered,
            "dimensions_missing": dimensions_missing,
            "questions": questions,
            "sufficient": sufficient,
        }

    async def generate_task_framework(
        self, requirement_doc: str
    ) -> TaskFramework:
        """
        基于完整需求文档生成结构化任务框架
        运行步骤：
          1. 分析需求文档，提取核心信息
          2. 生成项目概述
          3. 划分功能模块并分配优先级
          4. 构建模块依赖关系 DAG
          5. 推荐技术选型并给出理由
          6. 识别潜在风险并提出缓解措施
        参数：
          - requirement_doc: 完整的需求文档（需已覆盖 ≥4 个维度）
        返回值：TaskFramework 对象
        """
        # 构建生成 prompt
        prompt = (
            f"你是一个专业的架构师，请基于以下需求文档，"
            f"生成结构化的任务框架。\n\n"
            f"## 需求文档\n{requirement_doc}\n\n"
            f"请按以下格式输出（严格 JSON）：\n\n"
            f"```json\n"
            f"{{\n"
            f'  "project_overview": "一句话描述项目",\n'
            f'  "modules": [\n'
            f'    {{"name": "模块名", "priority": "high/medium/low", "description": "描述"}},\n'
            f'    ...\n'
            f'  ],\n'
            f'  "dependencies": [\n'
            f'    {{"from_module": "上游模块", "to_module": "下游模块"}},\n'
            f'    ...\n'
            f'  ],\n'
            f'  "tech_stack": {{\n'
            f'    "编程语言": "Python 3.10+（理由：...）",\n'
            f'    "框架": "FastAPI（理由：...）",\n'
            f'    ...\n'
            f'  }},\n'
            f'  "risks": [\n'
            f'    {{"risk": "风险描述", "severity": "high/medium/low", "mitigation": "缓解措施"}},\n'
            f'    ...\n'
            f'  ]\n'
            f"}}\n"
            f"```\n\n"
            f"要求：\n"
            f"- 模块划分合理，每个模块职责单一\n"
            f"- 依赖关系形成有向无环图（DAG）\n"
            f"- 技术选型带理由\n"
            f"- 风险识别务实、缓解措施具体可执行"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=600,  # v5.5.0 修复：从 300 提升到 600
        )

        if not result.success:
            logger.error("任务框架生成失败: %s", result.error_message)
            return TaskFramework(
                project_overview=f"生成失败: {result.error_message}",
            )

        return self._parse_task_framework(result.stdout)

    def _parse_task_framework(self, output: str) -> TaskFramework:
        """
        解析 LLM 返回的任务框架 JSON
        运行步骤：
          1. 从输出中提取 JSON 块
          2. 解析为 TaskFramework 对象
          3. 边界校验：确保各字段非空/合法
        参数：
          - output: LLM 原始输出文本
        返回值：TaskFramework 对象
        """
        import json as _json
        import re as _re

        framework = TaskFramework()

        json_match = _re.search(r"\{[\s\S]*\}", output)
        if not json_match:
            logger.warning("无法从 LLM 输出中解析任务框架 JSON")
            return framework

        try:
            parsed = _json.loads(json_match.group(0))
        except _json.JSONDecodeError as e:
            logger.warning("任务框架 JSON 解析失败: %s", e)
            return framework

        # 项目概述
        framework.project_overview = str(
            parsed.get("project_overview", "")
        )

        # 模块划分
        raw_modules = parsed.get("modules", [])
        if isinstance(raw_modules, list):
            for m in raw_modules:
                if isinstance(m, dict):
                    framework.modules.append({
                        "name": str(m.get("name", "")),
                        "priority": str(m.get("priority", "medium")),
                        "description": str(m.get("description", "")),
                    })

        # 依赖关系
        raw_deps = parsed.get("dependencies", [])
        if isinstance(raw_deps, list):
            for d in raw_deps:
                if isinstance(d, dict):
                    framework.dependencies.append({
                        "from_module": str(d.get("from_module", "")),
                        "to_module": str(d.get("to_module", "")),
                    })

        # 技术选型
        raw_tech = parsed.get("tech_stack", {})
        if isinstance(raw_tech, dict):
            framework.tech_stack = {
                str(k): str(v) for k, v in raw_tech.items()
            }

        # 风险识别
        raw_risks = parsed.get("risks", [])
        if isinstance(raw_risks, list):
            for r in raw_risks:
                if isinstance(r, dict):
                    framework.risks.append({
                        "risk": str(r.get("risk", "")),
                        "severity": str(r.get("severity", "medium")),
                        "mitigation": str(r.get("mitigation", "")),
                    })

        return framework

    def _parse_architecture_output(self, output: str) -> ArchitectureOutput:
        """解析架构输出，拆分为四个文档"""
        arch = ArchitectureOutput(scope="global")

        # 按 '---' 分隔四个文档
        parts = output.split("---")
        parts = [p.strip() for p in parts if p.strip()]

        if len(parts) >= 1:
            arch.spec = parts[0]
        if len(parts) >= 2:
            arch.checklist = parts[1]
        if len(parts) >= 3:
            arch.tasks = parts[2]
        if len(parts) >= 4:
            arch.acceptance = parts[3]

        # 如果只有一部分，尝试按标题分割
        if len(parts) == 1:
            content = parts[0]
            for marker in ["# 架构合规检查清单", "# 任务分解文档", "# 验收标准"]:
                idx = content.find(marker)
                if idx > 0:
                    if not arch.checklist:
                        arch.checklist = content[idx:]
                        arch.spec = content[:idx]
                    elif not arch.tasks:
                        arch.tasks = content[idx:]
                        arch.checklist = content[:idx]
                    elif not arch.acceptance:
                        arch.acceptance = content[idx:]
                        arch.tasks = content[:idx]
                    content = content[:idx]

        return arch
