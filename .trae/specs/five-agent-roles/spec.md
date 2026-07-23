# 5 个智能体角色实现 Spec

> **来源**: [project-optimization-roadmap Task 2](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **优先级**: P0（核心工作流，依赖 Task 1）
> **依赖**: loop-engineering-workflow-engine

## Why

Loop Engineering 工作流的核心价值在于每个阶段都有专业智能体角色执行特定任务。当前项目缺少结构化的智能体角色定义，Hermes 仅作为通用对话引擎使用。本 spec 定义 5 个强制智能体角色，每个角色有明确的核心定位、职责边界、触发规则和输出规范，确保工作流各阶段有专业能力支撑。

**架构说明**: Hermes 作为总调度师，创建 Claude Code CLI 子实例。每个 Claude Code CLI 实例内部已有 agent teams 机制，因此平台层不需要实现多 agent 并行调度，而是聚焦于角色定义和 prompt 注入。

## What Changes

- **新增 5 个智能体角色模块**：requirement_clarifier、chief_architect、prompt_engineer、critical_reviewer、quality_manager
- **每个角色包含**：核心类、system prompt 常量、数据类（输入/输出）、核心方法
- **集成到工作流引擎**：各角色在对应阶段自动激活

## Impact

- Affected specs: loop-engineering-workflow-engine（被依赖）、git-worktree-isolation（prompt_engineer 需要 worktree）
- Affected code:
  - `backend/app/services/agent_roles/__init__.py` — 新建
  - `backend/app/services/agent_roles/requirement_clarifier.py` — 新建
  - `backend/app/services/agent_roles/chief_architect.py` — 新建
  - `backend/app/services/agent_roles/prompt_engineer.py` — 新建
  - `backend/app/services/agent_roles/critical_reviewer.py` — 新建
  - `backend/app/services/agent_roles/quality_manager.py` — 新建

---

## ADDED Requirements

---

### Requirement: 需求澄清智能体

系统 SHALL 在用户提交开发任务后，首先激活需求澄清智能体（RequirementClarifier），通过多轮对话引导用户补充关键细节，输出标准化需求文档。

**核心定位**: 需求翻译官与标准化专家

**触发规则**: 工作流启动时自动激活（clarifying 阶段）；需求变更时重新激活

#### Scenario: 多轮需求澄清对话
- **WHEN** 用户输入模糊开发构想（如"做一个机器人避障功能"）
- **THEN** `clarify(user_input, context)` 方法 SHALL：
  1. 分析用户输入，识别信息缺口
  2. 构建澄清对话提示词（注入 REQUIREMENT_CLARIFIER_SYSTEM_PROMPT）
  3. 调用 Hermes 进行对话
  4. 返回 Hermes 的回复文本
- **AND** 引导用户补充以下 6 个关键维度：
  - 功能需求（Functional Requirements）
  - 非功能需求（性能、安全、可靠性）
  - 约束条件（硬件、软件、环境）
  - 环境要求（运行环境、仿真平台）
  - 安全红线（急停条件、速度限制）
  - 验收标准（如何判断功能已正确实现）
- **AND** 每轮对话聚焦 1-2 个关键维度
- **AND** 对话轮次控制在 3-5 轮

#### Scenario: 生成标准化需求文档
- **WHEN** 需求澄清智能体收集到足够信息
- **THEN** `generate_requirement_doc(conversation_history)` 方法 SHALL：
  1. 汇总对话历史
  2. 调用 Hermes 生成结构化需求文档
  3. 返回 Markdown 格式的需求文档
- **AND** 文档 SHALL 包含以下章节：
  - 1. 功能需求
  - 2. 非功能需求（性能/安全/可靠性）
  - 3. 约束条件（硬件/软件/ROS 版本）
  - 4. 环境要求
  - 5. 安全红线
  - 6. 验收标准
  - 7. 不确定项与待确认项

#### Scenario: 需求变更处理
- **WHEN** 工作流执行中用户提出需求变更
- **THEN** `handle_change(change_request, current_doc)` 方法 SHALL：
  1. 分析变更请求
  2. 评估影响范围（受影响章节、是否需要架构评审）
  3. 返回 ChangeAnalysis 对象
- **AND** ChangeAnalysis SHALL 包含：
  - affected_sections: 受影响的章节列表
  - impact_scope: 影响范围描述
  - requires_architecture_review: 是否需要触发架构重新设计
  - summary: 变更摘要

#### Scenario: System Prompt 规范
- **WHEN** 需求澄清智能体被激活
- **THEN** 注入的 system prompt SHALL 包含：
  - 核心职责描述（需求翻译官与标准化专家）
  - 6 个关键维度引导模板
  - 对话规则（每轮 1-2 维度、3-5 轮控制）
  - 输出规范（标准化需求文档格式）
  - 中文回复要求

#### 技术实现

**文件**: `backend/app/services/agent_roles/requirement_clarifier.py`

**类**: `RequirementClarifier`
- 构造函数: `__init__(hermes_service)` — 接收 HermesService 实例
- 常量: `REQUIREMENT_CLARIFIER_SYSTEM_PROMPT` — 完整 system prompt
- 方法:
  - `get_system_prompt() -> str`
  - `async clarify(user_input: str, context: Optional[Dict]) -> str`
  - `async generate_requirement_doc(conversation_history: str) -> str`
  - `async handle_change(change_request: str, current_doc: str) -> ChangeAnalysis`

**数据类**:
- `ClarificationQuestion`: dimension, question, importance
- `ChangeAnalysis`: affected_sections, impact_scope, requires_architecture_review, summary

**成功标准**:
- 需求文档覆盖 6 个关键维度
- 对话轮次 3-5 轮内完成澄清
- 需求变更响应时间 < 30 秒

---

### Requirement: 总架构师智能体

系统 SHALL 在需求文档确认后激活总架构师智能体（ChiefArchitect），负责全系统架构的统一治理，集成顶层设计、重构与局部适配能力，输出 spec.md、checklist.md、task.md、验收标准.md 四个文档。

**核心定位**: 全系统架构的统一治理者

**触发规则**: 需求文档确认 / 架构批判反馈 / 全局系统性问题上报 / 核心需求变更

#### Scenario: 全局架构设计
- **WHEN** 需求文档确认后
- **THEN** `design_architecture(requirement_doc)` 方法 SHALL：
  1. 分析需求文档
  2. 调用 Hermes 设计系统架构
  3. 输出四文档（按 '---' 分隔）
  4. 返回 ArchitectureOutput 对象
- **AND** ArchitectureOutput SHALL 包含：
  - spec: spec.md 内容
  - checklist: checklist.md 内容
  - tasks: task.md 内容
  - acceptance: 验收标准.md 内容
  - scope: "global"

#### Scenario: 局部适配
- **WHEN** 用户提出局部变更请求
- **THEN** `adapt_local(change_request, current_arch)` 方法 SHALL：
  1. 先执行红线自检（check_redline）
  2. 评估影响范围（evaluate_scope）
  3. 若影响模块 ≥ 2，触发强制升级
  4. 否则执行局部适配
  5. 返回 AdaptationResult 对象

#### Scenario: 红线自检
- **WHEN** 总架构师处理局部适配任务时
- **THEN** `check_redline(adaptation, current_arch)` 方法 SHALL 检查以下 4 条权责红线：
  1. 是否以局部适配名义修改系统核心架构
  2. 是否修改跨模块全局接口规范
  3. 是否修改核心算法选型
  4. 是否修改核心安全约束与性能指标
- **AND** 返回 RedlineCheck 对象（passed + violations 列表）
- **AND** 一旦触犯红线，立即中止当前工作流，转为架构级处理流程

#### Scenario: 影响范围评估
- **WHEN** 需要评估变更影响
- **THEN** `evaluate_scope(change, current_arch)` 方法 SHALL 返回 ScopeAssessment：
  - scope: "global" / "local"
  - affected_modules: 受影响模块列表
  - affected_interfaces: 受影响接口列表
  - risk_level: "high" / "medium" / "low"

#### Scenario: 强制升级条件
- **WHEN** 局部适配过程中发现实际影响模块数 ≥ 2
- **THEN** 任务即刻升级为全局架构变更
- **AND** 涉及接口变更且影响 ≥ 2 个模块的，必须先获得人工确认

#### Scenario: 四文档生成
- **WHEN** 需要单独生成某个文档
- **THEN** 以下方法 SHALL 各自生成对应文档：
  - `generate_spec(architecture) -> str` — 生成 spec.md
  - `generate_checklist(architecture) -> str` — 生成 checklist.md
  - `generate_tasks(architecture) -> str` — 生成 task.md
  - `generate_acceptance_criteria(architecture, critic_feedback) -> str` — 生成验收标准.md

#### Scenario: System Prompt 规范
- **WHEN** 总架构师智能体被激活
- **THEN** 注入的 system prompt SHALL 包含：
  - 核心职责（全系统架构统一治理者）
  - 工作流程（分析需求 → 评估范围 → 全局设计/局部适配 → 输出四文档）
  - 权责红线（4 条绝对禁止项）
  - 强制升级条件
  - 四文档输出规范（spec.md/checklist.md/task.md/验收标准.md 格式模板）

#### 技术实现

**文件**: `backend/app/services/agent_roles/chief_architect.py`

**类**: `ChiefArchitect`
- 构造函数: `__init__(hermes_service)`
- 常量: `CHIEF_ARCHITECT_SYSTEM_PROMPT`
- 方法:
  - `get_system_prompt() -> str`
  - `async design_architecture(requirement_doc: str) -> ArchitectureOutput`
  - `async adapt_local(change_request: str, current_arch: str) -> AdaptationResult`
  - `async evaluate_scope(change: str, current_arch: str) -> ScopeAssessment`
  - `async check_redline(adaptation: str, current_arch: str) -> RedlineCheck`
  - `async generate_spec(architecture: str) -> str`
  - `async generate_checklist(architecture: str) -> str`
  - `async generate_tasks(architecture: str) -> str`
  - `async generate_acceptance_criteria(architecture: str, critic_feedback: str) -> str`
  - `_parse_architecture_output(output: str) -> ArchitectureOutput`

**数据类**:
- `ArchitectureOutput`: spec, checklist, tasks, acceptance, scope
- `AdaptationResult`: success, changes, affected_modules, redline_violations, requires_escalation
- `ScopeAssessment`: scope, affected_modules, affected_interfaces, risk_level
- `RedlineCheck`: passed, violations

**成功标准**:
- 四文档（spec/checklist/task/验收标准）完整输出
- 影响范围评估准确率 > 90%
- 红线自检覆盖率 100%
- 局部适配升级判定零漏报

---

### Requirement: 提示词工程智能体

系统 SHALL 在总架构师完成任务拆解后激活提示词工程智能体（PromptEngineer），对架构内容做结构化优化，生成无歧义、可直接执行的标准化提示词，并注入独立 Claude Code CLI 实例。

**核心定位**: 架构提示词标准化专家

**触发规则**: task.md 确认后自动激活（prompting 阶段）

#### Scenario: 解析任务文档
- **WHEN** 总架构师完成 task.md
- **THEN** `parse_tasks(task_md)` 方法 SHALL：
  1. 解析 Markdown 结构
  2. 提取每个模块的名称、描述、优先级、依赖、复杂度、风险等级、验收标准
  3. 返回 `List[ModuleTask]`

#### Scenario: 提示词优化
- **WHEN** 需要为单个模块优化提示词
- **THEN** `optimize_prompt(module_task, architecture_context)` 方法 SHALL：
  1. 构建优化提示词（注入 PROMPT_ENGINEER_SYSTEM_PROMPT + 模块信息 + 架构上下文）
  2. 调用 Hermes 进行优化
  3. 返回优化后的提示词
- **AND** 优化后的提示词 SHALL 包含：
  - 任务目标（一句话描述）
  - 详细需求（结构化描述）
  - 核心约束（安全红线、性能指标、接口规范）
  - 输出要求（文件路径、命名规范、代码风格）
  - 依赖上下文（依赖的其他模块和接口信息）

#### Scenario: 注入 Claude Code CLI 实例
- **WHEN** 提示词优化完成
- **THEN** `inject_to_claude_cli(optimized_prompt, module_name, repo_path)` 方法 SHALL：
  1. 创建独立 worktree（如果有 worktree_manager）
  2. 通过 AgentManager 创建 Claude Code CLI 实例
  3. 返回 AgentInstance 对象（含 agent_id、optimized_prompt、worktree_path、branch_name）

#### Scenario: 提示词质量校验
- **WHEN** 提示词优化完成
- **THEN** `validate_prompt(optimized_prompt)` 方法 SHALL 检查：
  - 语义歧义评分（0-1，越低越好，> 0.3 视为不合格）
  - 核心约束覆盖率（0-1，越高越好，< 0.8 视为不合格）
  - 输出要求完整性
- **AND** 返回 ValidationResult 对象（valid + issues + ambiguity_score + constraint_coverage）

#### Scenario: System Prompt 规范
- **WHEN** 提示词工程智能体被激活
- **THEN** 注入的 system prompt SHALL 包含：
  - 核心职责（架构提示词标准化专家）
  - 提示词优化规则（消除歧义、固化约束、明确输出、保留上下文）
  - 输出格式模板（任务目标/详细需求/核心约束/输出要求/依赖上下文）

#### 技术实现

**文件**: `backend/app/services/agent_roles/prompt_engineer.py`

**类**: `PromptEngineer`
- 构造函数: `__init__(hermes_service, agent_manager=None, worktree_manager=None)`
- 常量: `PROMPT_ENGINEER_SYSTEM_PROMPT`
- 方法:
  - `get_system_prompt() -> str`
  - `async parse_tasks(task_md: str) -> List[ModuleTask]`
  - `async optimize_prompt(module_task: ModuleTask, architecture_context: str) -> str`
  - `async inject_to_claude_cli(optimized_prompt: str, module_name: str, repo_path: str) -> Optional[AgentInstance]`
  - `async validate_prompt(optimized_prompt: str) -> ValidationResult`

**数据类**:
- `ModuleTask`: name, description, priority, dependencies, complexity, risk_level, acceptance_criteria
- `AgentInstance`: agent_id, module_name, optimized_prompt, worktree_path, branch_name
- `ValidationResult`: valid, issues, ambiguity_score, constraint_coverage

**成功标准**:
- 提示词优化后语义歧义消除率 100%
- 核心约束（安全红线/性能指标/接口规范）覆盖率 100%
- 多模块并行注入成功率 > 95%

---

### Requirement: 批判反思智能体

系统 SHALL 在总架构师输出四个文档后激活批判反思智能体（CriticalReviewer），从算法合理性、系统稳定性、工程可实现性、实时性、安全性 5 个维度做全维度批判评审。

**核心定位**: 架构风险官与合规专家

**重要约束**: 该智能体只在总架构师输出四个文档后被调用，之后不再调用。

**触发规则**: 总架构师输出四文档后自动激活（仅此一次）

#### Scenario: 全维度批判评审
- **WHEN** 总架构师完成 spec.md、checklist.md、task.md、验收标准.md 四个文档
- **THEN** `review_architecture(spec, checklist, tasks, acceptance)` 方法 SHALL 从 5 个维度逐一评审：
  1. **算法合理性**: 算法选型是否适合场景、是否有更优方案
  2. **系统稳定性**: 异常处理、故障恢复、资源管理是否完善
  3. **工程可实现性**: 技术栈是否可行、依赖是否可获取、工作量是否合理
  4. **实时性**: 控制周期、延迟、抖动是否满足要求
  5. **安全性**: 安全红线是否完整、急停逻辑是否覆盖、边界条件是否处理
- **AND** 返回 ReviewReport 对象，包含：
  - passed: 是否通过（无 critical 缺陷且所有维度评分 ≥ 60）
  - defects: 缺陷列表（每个缺陷含 severity/critical|major|minor、dimension、impact、root_cause、suggestion）
  - dimension_scores: 各维度评分（0-100）
  - summary: 评审总结

#### Scenario: 合规性校验
- **WHEN** 总架构师完成局部适配
- **THEN** `check_compliance(adaptation_result)` 方法 SHALL 校验：
  - 是否影响核心架构
  - 是否引发依赖冲突
  - 是否扩大影响范围
- **AND** 返回 ComplianceReport 对象

#### Scenario: 风险等级复核
- **WHEN** 总架构师在 task.md 中标记了各模块的风险等级
- **THEN** `review_risk_labels(tasks)` 方法 SHALL：
  - 检查高风险模块是否有漏标、错标
  - 检查风险缓解措施是否充分
- **AND** 返回 RiskReviewReport 对象

#### Scenario: 版本对比评审
- **WHEN** 架构经过修改后重新提交
- **THEN** `compare_versions(old_docs, new_docs)` 方法 SHALL：
  - 确认上一轮缺陷是否已修复
  - 确认是否引入新缺陷
  - 确认是否仍有遗留缺陷
- **AND** 返回 DiffReport 对象

#### Scenario: System Prompt 规范
- **WHEN** 批判反思智能体被激活
- **THEN** 注入的 system prompt SHALL 包含：
  - 核心职责（架构风险官与合规专家）
  - 5 个评审维度详细标准
  - 缺陷等级定义（Critical/Major/Minor）
  - 输出格式（评审总结 + 维度评分 + 缺陷清单）

#### 技术实现

**文件**: `backend/app/services/agent_roles/critical_reviewer.py`

**类**: `CriticalReviewer`
- 构造函数: `__init__(hermes_service)`
- 常量: `CRITICAL_REVIEWER_SYSTEM_PROMPT`
- 方法:
  - `get_system_prompt() -> str`
  - `async review_architecture(spec, checklist, tasks, acceptance) -> ReviewReport`
  - `async check_compliance(adaptation_result: str) -> ComplianceReport`
  - `async review_risk_labels(tasks: str) -> RiskReviewReport`
  - `async compare_versions(old_docs: Dict, new_docs: Dict) -> DiffReport`
  - `_parse_review_report(output: str) -> ReviewReport`

**数据类**:
- `DefectItem`: id, title, description, severity, dimension, impact, root_cause, suggestion
- `ReviewReport`: passed, defects, dimension_scores, summary
- `ComplianceReport`: passed, core_architecture_affected, dependency_conflicts, scope_expanded, issues
- `RiskReviewReport`: mislabeled, mitigation_insufficient, passed
- `DiffReport`: fixed_defects, new_defects, remaining_defects, passed

**成功标准**:
- 5 个维度评审覆盖率 100%
- 缺陷等级分类准确率 > 90%
- 高风险模块漏标率 = 0%
- 架构迭代对比评审覆盖率 100%

---

### Requirement: 质量保障与迭代管理智能体

系统 SHALL 在所有 Claude Code CLI 实例完成编码后激活质量保障与迭代管理智能体（QualityManager），按 5 个阶段执行全链路质量保障与项目管理，通过刚性流转规则确保质量管控无死角。

**核心定位**: 全系统质量与项目生命周期的统一管理者

**触发规则**: 按阶段依次激活，严格遵循阶段间刚性边界

#### Scenario: 阶段一 — 单模块安全校验
- **WHEN** 单个模块代码编写完成
- **THEN** `execute_stage_1(module_code)` 方法 SHALL 执行：
  - 边界条件校验、异常数据兜底处理、入参合法性校验
  - 机器人运动控制极限值约束校验
  - 急停逻辑分支校验
  - 异常故障兜底机制校验
  - 传感器数据异常处理校验
  - 模块接口定义、依赖版本是否符合全局规范
  - 参数硬编码问题检查
  - 跨包引用规范符合性检查
  - 复用代码兼容性、正确性、版本适配性校验
- **AND** 返回 SafetyReport 对象（passed + boundary_issues + emergency_stop_issues + hardcode_issues + summary）

#### Scenario: 阶段二 — 测试脚本生成
- **WHEN** 阶段一通过
- **THEN** `execute_stage_2(module_spec)` 方法 SHALL 生成：
  - 单元测试代码
  - 仿真测试脚本
  - 核心算法性能 benchmark 脚本
  - 参数敏感性分析脚本
  - 极限工况与故障注入测试脚本
  - 急停分支测试、边界条件测试、异常工况测试脚本
  - 标准化测试报告模板（执行命令、环境依赖、通过判定标准）
- **AND** 返回 TestScripts 对象

#### Scenario: 阶段三 — 多模块集成校验
- **WHEN** 所有模块开发及单模块测试全部完成
- **THEN** `execute_stage_3(all_modules)` 方法 SHALL 执行：
  - 多模块接口兼容性校验
  - ROS 话题/服务数据类型一致性校验
  - 调用时序匹配度校验
  - 依赖包版本冲突检查
  - 编译依赖完整性检查
  - ROS/ROS2 包工程规范符合性校验
  - 跨包引用正确性校验
  - 全量代码编译校验
  - 跨模块安全联动深度校验
  - ROS2 QoS 配置合理性校验
  - 节点生命周期管理规范性校验
  - 隐式循环依赖扫描
- **AND** 返回 IntegrationReport 对象

#### Scenario: 阶段四 — 全局系统评测
- **WHEN** 阶段三通过且跨模块安全测试通过
- **THEN** `execute_stage_4(integrated_code)` 方法 SHALL 执行：
  - 全量代码全局深度评测（架构合理性、代码质量、工程规范符合性）
  - 机器人系统全链路实时性评测
  - 核心算法专项评测
  - 安全专项评测
  - 全局逻辑漏洞、性能瓶颈、架构缺陷挖掘
- **AND** 返回 EvaluationReport 对象（含终审结论 pass/fail/conditional_pass）

#### Scenario: 阶段五 — 迭代闭环与版本管理
- **WHEN** 全流程各节点完成、最终交付前
- **THEN** `execute_stage_5(project_context)` 方法 SHALL 执行：
  - 跟踪全流程需求变更、架构迭代、代码修改、测试问题的闭环情况
  - 同步更新全链路状态
  - 归档系统评测报告、测试报告
  - 输出标准化 CHANGELOG
  - 整理最终交付物
  - 筛选项目优质通用资产
  - 输出 Git 提交规范、版本号规则
- **AND** 返回 DeliveryPackage 对象

#### Scenario: 阶段间刚性边界
- **WHEN** 质量保障智能体执行中
- **THEN** `check_stage_boundary(current_stage, action)` 方法 SHALL 确保：
  - 阶段一仅负责单模块内部安全校验，禁止涉足跨模块接口兼容性校验
  - 阶段二在阶段一通过后方可激活
  - 阶段三必须在所有模块开发及单模块测试全部完成后激活
  - 阶段四在阶段三通过且跨模块安全测试通过后激活
  - 阶段五全流程每个节点完成后同步更新状态
  - 禁止跳过任何前置环节
- **AND** 返回 BoundaryCheck 对象（allowed + violation）

#### Scenario: 强制升级条件
- **WHEN** 质量保障智能体发现特定问题
- **THEN** `evaluate_escalation(findings)` 方法 SHALL：
  - 阶段一发现涉及多模块的安全缺陷 → 立即升级至阶段三
  - 阶段三发现架构级缺陷或全局性安全问题 → 立即升级至阶段四
  - 阶段四发现需架构重构的系统性问题 → 强制触发总架构师介入
- **AND** 返回 EscalationDecision 对象（should_escalate + target_stage + reason）

#### Scenario: System Prompt 规范
- **WHEN** 质量保障智能体被激活
- **THEN** 注入的 system prompt SHALL 包含：
  - 核心职责（全系统质量与项目生命周期统一管理者）
  - 5 阶段详细职责描述
  - 阶段间刚性边界规则
  - 强制升级条件

#### 技术实现

**文件**: `backend/app/services/agent_roles/quality_manager.py`

**类**: `QualityManager`
- 构造函数: `__init__(hermes_service)`
- 常量: `QUALITY_MANAGER_SYSTEM_PROMPT`
- 方法:
  - `get_system_prompt() -> str`
  - `async execute_stage_1(module_code: str) -> SafetyReport`
  - `async execute_stage_2(module_spec: str) -> TestScripts`
  - `async execute_stage_3(all_modules: str) -> IntegrationReport`
  - `async execute_stage_4(integrated_code: str) -> EvaluationReport`
  - `async execute_stage_5(project_context: str) -> DeliveryPackage`
  - `check_stage_boundary(current_stage: str, action: str) -> BoundaryCheck`
  - `evaluate_escalation(findings: Dict) -> EscalationDecision`
  - 解析辅助方法: `_parse_safety_report`, `_parse_test_scripts`, `_parse_integration_report`, `_parse_evaluation_report`, `_parse_delivery_package`

**数据类**:
- `SafetyReport`: passed, issues, boundary_issues, emergency_stop_issues, hardcode_issues, summary
- `TestScripts`: unit_tests, simulation_tests, benchmark_scripts, edge_case_tests, emergency_stop_tests, test_report_template
- `IntegrationReport`: passed, interface_issues, type_consistency_issues, dependency_conflicts, circular_dependencies, compilation_errors, summary
- `EvaluationReport`: passed, architecture_score, code_quality_score, realtime_score, safety_score, issues, recommendations, final_conclusion, summary
- `DeliveryPackage`: changelog, delivery_structure, git_commit_guidelines, version_tag, reusable_assets, summary
- `BoundaryCheck`: allowed, violation
- `EscalationDecision`: should_escalate, target_stage, reason

**成功标准**:
- 5 阶段全部正确执行
- 阶段间刚性边界零违规
- 强制升级条件零漏报
- 安全校验覆盖率 100%（高安全风险模块）
- 全局评测终审结论准确率 > 95%

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| 智能体角色 prompt 过于复杂 | 所有角色 | 中 | 分阶段测试 + prompt 模板化管理 |
| 角色输出格式不统一 | 工作流质量 | 中 | 每个角色定义明确的输出规范 |
| 角色间上下文传递丢失 | 工作流连贯性 | 中 | 结构化上下文传递 + 关键信息摘要 |
| Hermes 调用超时 | 角色执行 | 中 | 合理设置超时时间（120-300s） |

## 成功标准

- 5 个角色全部实现并正确触发
- 每个角色的 system prompt 包含核心定位、职责、红线、输出规范
- 所有角色的核心方法正确实现
- 角色输出可被下游阶段正确消费
