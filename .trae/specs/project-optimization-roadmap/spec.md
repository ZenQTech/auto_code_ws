# 项目优化路线图 Spec：Loop Engineering 工作流

> **基于**: [开源项目调研报告 v2.2.0](file:///home/qizheng/auto_code_ws/docs/开源项目调研报告.md)
> **当前项目版本**: v2.10.4（前端）+ 后端 FastAPI
> **Spec 版本**: v2.0.0（重构版）

## Why

当前项目已建立 Hermes 总调度 + Claude Code CLI 子实例的架构基础，但缺少结构化的 Loop Engineering 工作流。业界领先项目（OMC 的 5 阶段 Team Pipeline、Composio AO 的 Reaction 系统、Aider 的 lint+test 循环）已验证：只有将需求澄清、架构设计、提示词工程、代码执行、质量评审、迭代闭环串联为完整工作流，才能真正实现高质量、可落地的 AI 编程。本 spec 基于调研报告中的最佳实践，结合项目现有架构，设计完整的 Loop Engineering 工作流。

## What Changes

### 核心变更：Loop Engineering 工作流
- **新增 5 个强制智能体角色**：需求澄清智能体、总架构师智能体、提示词工程智能体、批判反思智能体、质量保障与迭代管理智能体
- **新增完整工作流引擎**：需求澄清 → 架构设计 → 提示词工程 → Claude Code CLI 执行 → 质量评审 → 迭代闭环
- **新增 Git Worktree 隔离**：每个 Claude Code CLI 实例独立 worktree + branch
- **新增 Git 自动 Commit**：原子 commit + 智能 message
- **新增 Web Dashboard**：工作流阶段可视化监控
- **升级 CodeViewer → Monaco Editor**：LSP 级代码查看与编辑
- **跨 Session Memory**：由 Hermes 内核自动管理（对话总结 + 项目记忆 + 自动编写 Skills）

### 不做的变更（明确排除）
- ❌ 多 Agent 并行调度（Claude Code CLI 内部已有 agent teams，无需在平台层重复实现）
- ❌ 多 LLM Provider 抽象（仅支持用户修改 API key）
- ❌ 智能模型路由
- ❌ 语音输入
- ❌ MCP 协议
- ❌ 企业级 RBAC
- ❌ 声明式工作流引擎（Microsoft Conductor 风格）
- ❌ Docker 沙盒
- ❌ 代理间通信（OpenAgents 风格）
- ❌ Slack/Linear 集成

## Impact

- Affected specs: 所有现有 spec（本 spec 为顶层路线图）
- Affected code:
  - `backend/app/models.py` — 新增 Workflow、WorkflowStage、AgentRole 等模型
  - `backend/app/services/` — 新增 workflow_engine、agent_roles/* 等服务
  - `backend/app/api/` — 新增 workflow、dashboard 端点
  - `cli_integration/` — 新增 worktree_manager
  - `hermes_integration/` — 增强 HermesService 支持工作流编排
  - `frontend/src/components/` — 新增 WorkflowDashboard、StageViewer、PipelineViewer 等组件
  - `frontend/src/App.tsx` — 集成工作流面板

---

## ADDED Requirements

---

### Requirement: Loop Engineering 工作流引擎

系统 SHALL 实现完整的 Loop Engineering 工作流，以 Hermes 为总调度师和评判师，串联需求澄清、架构设计、提示词工程、Claude Code CLI 执行、质量评审、迭代闭环的全流程。

**借鉴来源**: OMC（5 阶段 Team Pipeline）、Composio AO（Reaction 系统）、Aider（lint+test 循环）、OpenHands（自修复测试循环）

**架构说明**: Hermes 作为总调度师，创建 Claude Code CLI 子实例。每个 Claude Code CLI 实例内部已有 agent teams 机制，因此平台层不需要实现多 agent 并行调度，而是聚焦于工作流编排和智能体角色管理。

#### Scenario: 完整工作流执行
- **WHEN** 用户在编程模式下提交一个开发任务（如"开发一个 ROS2 机器人导航模块"）
- **THEN** 系统按以下阶段依次执行:
  1. **需求澄清阶段**: 需求澄清智能体与用户多轮对话，引导用户补充关键细节，输出标准化需求文档
  2. **架构设计阶段**: 总架构师智能体基于需求文档，与批判反思智能体讨论验收标准，输出 spec.md、checklist.md、task.md、验收标准.md 四个文档
  3. **提示词工程阶段**: 提示词工程智能体按模块拆分任务，优化提示词，注入独立 Claude Code CLI 实例
  4. **执行阶段**: 各 Claude Code CLI 实例在独立 worktree 中并行执行编码任务
  5. **质量评审阶段**: 质量保障与迭代管理智能体按 5 个阶段（单模块校验 → 测试生成 → 集成校验 → 全局评测 → 迭代闭环）执行质量保障
  6. **迭代闭环**: 代码不通过则打回重新优化实现，直到所有代码正常跑通

#### Scenario: 工作流阶段可视化
- **WHEN** 工作流执行中
- **THEN** 前端 Dashboard 实时显示当前阶段、进度、各智能体状态
- **AND** 每个阶段的输出文档可点击查看
- **AND** 阶段切换时有明确的视觉过渡

#### Scenario: 工作流中断与恢复
- **WHEN** 任一阶段失败（如需求不明确、架构评审不通过、代码质量不达标）
- **THEN** 工作流自动回退到对应阶段重新执行
- **AND** 保留已完成阶段的输出，避免重复工作
- **AND** 用户可手动干预（跳过/重试某阶段）

#### 技术方案

**后端新增**:
- `backend/app/models.py` — 新增模型:
  - `Workflow`: id, session_id, status (pending/clarifying/designing/prompting/executing/reviewing/iterating/completed/failed), current_stage, created_at, updated_at
  - `WorkflowStage`: id, workflow_id, stage_name, status, agent_role, input_doc, output_doc, started_at, completed_at
  - `AgentRole`: id, name, description, system_prompt, trigger_rules (JSON)
- `backend/app/services/workflow_engine.py` — WorkflowEngine:
  - `start_workflow(session_id, user_input) -> Workflow`
  - `advance_stage(workflow_id) -> WorkflowStage`
  - `rollback_stage(workflow_id, target_stage) -> WorkflowStage`
  - `get_workflow_status(workflow_id) -> WorkflowStatus`
  - 阶段状态机: `pending → clarifying → designing → prompting → executing → reviewing → (iterating → executing) | completed | failed`
- `backend/app/services/agent_roles/` — 各智能体角色实现:
  - `requirement_clarifier.py` — 需求澄清智能体
  - `chief_architect.py` — 总架构师智能体
  - `prompt_engineer.py` — 提示词工程智能体
  - `critical_reviewer.py` — 批判反思智能体
  - `quality_manager.py` — 质量保障与迭代管理智能体
- `backend/app/api/workflow.py` — Workflow API:
  - `POST /api/workflow/start` — 启动工作流
  - `GET /api/workflow/{id}/status` — 获取工作流状态
  - `POST /api/workflow/{id}/advance` — 推进到下一阶段
  - `POST /api/workflow/{id}/rollback` — 回退到指定阶段
  - `GET /api/workflow/{id}/stages` — 获取所有阶段详情

**Hermes 集成改造**:
- `hermes_integration/hermes_executor.py` — 增强 HermesExecutor:
  - 新增 `start_workflow(session_id, user_input)` 方法
  - 新增 `execute_agent_role(role, context)` 方法 — 以指定角色身份执行
  - Hermes 负责创建和管理所有智能体角色实例

**前端新增**:
- `frontend/src/components/WorkflowDashboard.tsx` — 工作流主面板
  - 阶段进度条（6 阶段可视化）
  - 当前阶段高亮 + 动画
  - 各阶段输出文档预览
- `frontend/src/components/StageViewer.tsx` — 单阶段详情查看器
  - 阶段输入/输出文档展示
  - 智能体对话记录
  - 阶段操作按钮（重试/跳过）

**风险**:
- 工作流执行时间较长（可能数十分钟），需提供清晰的进度反馈
- 阶段间上下文传递可能丢失关键信息
- 迭代闭环可能导致无限循环，需设置最大迭代次数

**成功标准**:
- 6 阶段工作流正确串联执行
- 阶段切换延迟 < 2 秒
- 迭代闭环最多 3 轮自动终止
- 工作流 Dashboard 实时反映当前状态

---

### Requirement: 需求澄清智能体

系统 SHALL 在用户提交开发任务后，首先激活需求澄清智能体，通过多轮对话引导用户补充关键细节，输出标准化需求文档。

**核心定位**: 需求翻译官与标准化专家

#### Scenario: 多轮需求澄清对话
- **WHEN** 用户输入模糊开发构想（如"做一个机器人避障功能"）
- **THEN** 需求澄清智能体主动提问，引导用户补充:
  - 机器人类型与运动模型
  - 传感器类型与数据格式
  - 避障算法偏好与性能指标
  - 仿真环境要求（Gazebo/Isaac Sim）
  - 安全红线（急停距离、最大速度限制）
  - ROS/依赖版本信息
- **AND** 每轮对话聚焦 1-2 个关键维度
- **AND** 对话轮次控制在 3-5 轮

#### Scenario: 输出标准化需求文档
- **WHEN** 需求澄清智能体收集到足够信息
- **THEN** 输出结构化需求文档，包含:
  - 功能需求（Functional Requirements）
  - 非功能需求（性能、安全、可靠性）
  - 约束条件（硬件、软件、环境）
  - 验收标准初稿
  - 不确定项与待确认项
- **AND** 文档格式为 Markdown，无歧义

#### Scenario: 需求变更处理
- **WHEN** 工作流执行中用户提出需求变更
- **THEN** 需求澄清智能体重新激活
- **AND** 分析变更影响范围
- **AND** 同步更新需求文档并标注变更历史

#### 技术方案

**后端实现**:
- `backend/app/services/agent_roles/requirement_clarifier.py`:
  - `clarify(user_input, context) -> AsyncIterator[Message]` — 多轮对话流式输出
  - `generate_requirement_doc(conversation_history) -> str` — 生成标准化需求文档
  - `handle_change(change_request, current_doc) -> ChangeAnalysis` — 处理需求变更
- 触发规则: 工作流启动时自动激活；需求变更时重新激活
- 通过 HermesExecutor 以特定 system prompt 调用 Hermes

**成功标准**:
- 需求文档覆盖 6 个关键维度（功能/性能/安全/约束/环境/验收）
- 对话轮次 3-5 轮内完成澄清
- 需求变更响应时间 < 30 秒

---

### Requirement: 总架构师智能体

系统 SHALL 在需求文档确认后激活总架构师智能体，负责全系统架构的统一治理，集成顶层设计、重构与局部适配能力，输出 spec.md、checklist.md、task.md、验收标准.md 四个文档。

**核心定位**: 全系统架构的统一治理者

#### Scenario: 架构设计流程
- **WHEN** 需求文档确认后
- **THEN** 总架构师智能体执行以下步骤:
  1. 分析需求文档，评估影响范围
  2. 属于全局架构范畴 → 执行完整架构设计
  3. 属于局部适配范畴 → 执行局部变更（全程自检红线）
- **AND** 与批判反思智能体讨论验收标准
- **AND** 输出四个文档: spec.md、checklist.md、task.md、验收标准.md

#### Scenario: 架构设计输出规范
- **WHEN** 总架构师完成架构设计
- **THEN** 输出文档包含:
  - **spec.md**: 模块视图、接口契约、安全与性能基线
  - **checklist.md**: 架构合规检查清单
  - **task.md**: 按模块拆分的任务列表（含依赖关系）
  - **验收标准.md**: 与批判反思智能体共同确认的详细验收标准
- **AND** 文档格式参考 Trae 的 /spec 功能输出

#### Scenario: 权责红线 — 禁止越权
- **WHEN** 总架构师处理局部适配任务时
- **THEN** 绝对禁止:
  - 以局部适配名义修改系统核心架构
  - 修改跨模块全局接口规范
  - 修改核心算法选型
  - 修改核心安全约束与性能指标
- **AND** 一旦涉及上述禁止项，立即中止当前工作流，转为架构级处理流程

#### Scenario: 强制升级条件
- **WHEN** 局部适配过程中发现实际影响模块数 ≥ 2
- **THEN** 任务即刻升级为全局架构变更
- **AND** 涉及接口变更且影响 ≥ 2 个模块的，必须先获得人工确认

#### 技术方案

**后端实现**:
- `backend/app/services/agent_roles/chief_architect.py`:
  - `design_architecture(requirement_doc) -> ArchitectureOutput` — 全局架构设计
  - `adapt_local(change_request, current_arch) -> AdaptationResult` — 局部适配
  - `evaluate_scope(change) -> ScopeAssessment` — 影响范围评估
  - `check_redline(adaptation) -> RedlineCheck` — 红线自检
  - 输出方法:
    - `generate_spec(architecture) -> str`
    - `generate_checklist(architecture) -> str`
    - `generate_tasks(architecture) -> str`
    - `generate_acceptance_criteria(architecture, critic_feedback) -> str`
- 触发规则: 需求文档确认 / 架构批判反馈 / 全局系统性问题上报 / 核心需求变更
- 内部流转: 分析触发事件 → 评估影响范围 → 全局架构/局部适配 → 输出四文档

**成功标准**:
- 四文档（spec/checklist/task/验收标准）完整输出
- 影响范围评估准确率 > 90%
- 红线自检覆盖率 100%
- 局部适配升级判定零漏报

---

### Requirement: 提示词工程智能体

系统 SHALL 在总架构师完成任务拆解后激活提示词工程智能体，对架构内容做结构化优化，生成无歧义、可直接执行的标准化提示词，并注入独立 Claude Code CLI 实例。

**核心定位**: 架构提示词标准化专家

#### Scenario: 提示词优化与注入
- **WHEN** 总架构师完成 task.md（按模块拆分的任务列表）
- **THEN** 提示词工程智能体执行:
  1. 解析 task.md，提取每个模块的任务描述
  2. 对每个模块的提示词做结构化优化:
     - 消除语义歧义
     - 固化核心约束（安全红线、性能指标、接口规范）
     - 明确下游执行要求（输出格式、文件路径、命名规范）
  3. 为每个模块创建独立 Claude Code CLI 实例
  4. 将优化后的提示词注入对应实例
- **AND** 保障架构信息在传递过程中无失真、无遗漏

#### Scenario: 多模块并行注入
- **WHEN** task.md 包含 3 个独立模块（如"感知模块"、"规划模块"、"控制模块"）
- **THEN** 提示词工程智能体创建 3 个 Claude Code CLI 实例
- **AND** 每个实例在独立 Git worktree 中运行
- **AND** 各实例并行执行，互不干扰

#### 技术方案

**后端实现**:
- `backend/app/services/agent_roles/prompt_engineer.py`:
  - `parse_tasks(task_md) -> List[ModuleTask]` — 解析 task.md
  - `optimize_prompt(module_task, architecture_context) -> str` — 提示词优化
  - `inject_to_claude_cli(optimized_prompt, worktree) -> AgentInstance` — 注入 Claude Code CLI
  - `validate_prompt(optimized_prompt) -> ValidationResult` — 提示词质量校验
- 依赖: WorktreeManager（创建独立 worktree）、AgentManager（管理 CLI 实例）
- 触发规则: task.md 确认后自动激活

**成功标准**:
- 提示词优化后语义歧义消除率 100%
- 核心约束（安全红线/性能指标/接口规范）覆盖率 100%
- 多模块并行注入成功率 > 95%

---

### Requirement: 批判反思智能体

系统 SHALL 在总架构师输出四个文档后激活批判反思智能体，从算法合理性、系统稳定性、工程可实现性、实时性、安全性 5 个维度做全维度批判评审。

**核心定位**: 架构风险官与合规专家

**重要约束**: 该智能体只在总架构师输出四个文档后被调用，之后不再调用。

#### Scenario: 全维度批判评审
- **WHEN** 总架构师完成 spec.md、checklist.md、task.md、验收标准.md 四个文档
- **THEN** 批判反思智能体从 5 个维度逐一评审:
  1. **算法合理性**: 算法选型是否适合场景、是否有更优方案
  2. **系统稳定性**: 异常处理、故障恢复、资源管理是否完善
  3. **工程可实现性**: 技术栈是否可行、依赖是否可获取、工作量是否合理
  4. **实时性**: 控制周期、延迟、抖动是否满足要求
  5. **安全性**: 安全红线是否完整、急停逻辑是否覆盖、边界条件是否处理
- **AND** 输出结构化缺陷清单，明确:
  - 缺陷等级（Critical/Major/Minor）
  - 影响范围
  - 根因分析
  - 可落地的修复方案

#### Scenario: 合规性校验
- **WHEN** 总架构师完成局部适配
- **THEN** 批判反思智能体校验:
  - 是否影响核心架构
  - 是否引发依赖冲突
  - 是否扩大影响范围
- **AND** 输出合规自检结果

#### Scenario: 风险等级标记复核
- **WHEN** 总架构师在 task.md 中标记了各模块的风险等级
- **THEN** 批判反思智能体逐项复核:
  - 高风险模块是否有漏标、错标
  - 风险缓解措施是否充分
- **AND** 输出风险复核报告

#### Scenario: 架构迭代对比评审
- **WHEN** 架构经过修改后重新提交
- **THEN** 批判反思智能体对比新旧版本:
  - 确认上一轮缺陷是否已修复
  - 确认是否引入新缺陷
- **AND** 输出缺陷闭环报告

#### 技术方案

**后端实现**:
- `backend/app/services/agent_roles/critical_reviewer.py`:
  - `review_architecture(spec, checklist, tasks, acceptance) -> ReviewReport` — 全维度评审
  - `check_compliance(adaptation_result) -> ComplianceReport` — 合规性校验
  - `review_risk_labels(tasks) -> RiskReviewReport` — 风险等级复核
  - `compare_versions(old_docs, new_docs) -> DiffReport` — 版本对比评审
- 触发规则: 总架构师输出四文档后自动激活（仅此一次）
- 通过 HermesExecutor 以特定 system prompt 调用 Hermes

**成功标准**:
- 5 个维度评审覆盖率 100%
- 缺陷等级分类准确率 > 90%
- 高风险模块漏标率 = 0%
- 架构迭代对比评审覆盖率 100%

---

### Requirement: 质量保障与迭代管理智能体

系统 SHALL 在所有 Claude Code CLI 实例完成编码后激活质量保障与迭代管理智能体，按 5 个阶段执行全链路质量保障与项目管理，通过刚性流转规则确保质量管控无死角。

**核心定位**: 全系统质量与项目生命周期的统一管理者

#### Scenario: 阶段一 — 单模块安全校验
- **WHEN** 单个模块代码编写完成、本地静态检查与预编译校验通过
- **THEN** 质量保障智能体执行:
  - 边界条件校验、异常数据兜底处理、入参合法性校验
  - 机器人运动控制极限值约束校验
  - 急停逻辑分支校验
  - 异常故障兜底机制校验
  - 传感器数据异常处理校验
  - 模块接口定义、依赖版本是否符合全局规范
  - 参数硬编码问题检查
  - 跨包引用规范符合性检查
  - 复用代码兼容性、正确性、版本适配性校验
- **AND** 对高安全风险模块做专项全场景覆盖校验
- **AND** 输出单模块安全校验报告

#### Scenario: 阶段二 — 测试脚本生成
- **WHEN** 阶段一通过、高风险模块人工审核通过
- **THEN** 质量保障智能体生成:
  - 单元测试代码
  - 仿真测试脚本
  - 核心算法性能 benchmark 脚本
  - 参数敏感性分析脚本
  - 多场景仿真测试脚本
  - 极限工况与故障注入测试脚本
  - 急停分支测试、边界条件测试、异常工况测试脚本
  - 实时控制模块的控制周期抖动、延迟测试脚本
  - 多传感器融合的数据同步、异常值处理、鲁棒性测试脚本
- **AND** 输出标准化测试报告模板（执行命令、环境依赖、通过判定标准）

#### Scenario: 阶段三 — 多模块集成校验
- **WHEN** 所有模块开发及单模块测试全部完成并打点确认
- **THEN** 质量保障智能体执行:
  - 多模块接口兼容性校验
  - ROS 话题/服务数据类型一致性校验
  - 调用时序匹配度校验
  - 依赖包版本冲突检查
  - 编译依赖完整性检查
  - ROS/ROS2 包工程规范符合性校验
  - 跨包引用正确性校验
  - 全量代码编译校验
  - 跨模块安全联动深度校验（基础层/逻辑层/边界层）
  - ROS2 QoS 配置合理性校验
  - 节点生命周期管理规范性校验
  - 隐式循环依赖扫描
- **AND** 输出集成校验报告（问题定位、影响范围、修复建议）
- **AND** 触发阶段二生成跨模块安全测试脚本

#### Scenario: 阶段四 — 全局系统评测
- **WHEN** 阶段三通过、跨模块安全测试通过
- **THEN** 质量保障智能体执行:
  - 全量代码全局深度评测（架构合理性、代码质量、工程规范符合性）
  - 机器人系统全链路实时性评测（端到端控制延迟、时序稳定性、调度合理性）
  - 核心算法专项评测（算法选型合理性、性能指标、场景适配性、鲁棒性、安全冗余度）
  - 安全专项评测（安全架构、急停逻辑、故障兜底能力、边界条件处理）
  - 全局逻辑漏洞、性能瓶颈、架构缺陷挖掘
- **AND** 输出结构化评测报告与优先级优化建议
- **AND** 给出明确的终审是否通过结论

#### Scenario: 阶段五 — 迭代闭环与版本管理
- **WHEN** 全流程各节点完成、最终交付前
- **THEN** 质量保障智能体执行:
  - 跟踪全流程需求变更、架构迭代、代码修改、测试问题的闭环情况
  - 同步更新全链路状态
  - 归档系统评测报告、测试报告
  - 输出标准化 CHANGELOG（遵循语义化版本标准）
  - 整理最终交付物（标准化目录结构归档）
  - 筛选项目优质通用资产（通用化提炼、质量校验、标准化入库）
  - 输出 Git 提交规范、版本号规则、提交信息标准
  - 输出最终交付版本的 Tag 与说明文档
- **AND** 配合智能体调度平台完成版本管理，不直接执行 Git 操作

#### Scenario: 阶段间刚性边界
- **WHEN** 质量保障智能体执行中
- **THEN** 严格遵守:
  - 阶段一仅负责单模块内部安全校验，禁止涉足跨模块接口兼容性校验
  - 阶段二在阶段一通过后方可激活
  - 阶段三必须在所有模块开发及单模块测试全部完成后激活
  - 阶段四在阶段三通过且跨模块安全测试通过后激活
  - 阶段五全流程每个节点完成后同步更新状态
- **AND** 禁止跳过任何前置环节

#### Scenario: 强制升级条件
- **WHEN** 阶段一发现涉及多模块的安全缺陷
- **THEN** 立即升级至阶段三处理
- **WHEN** 阶段三发现架构级缺陷或全局性安全问题
- **THEN** 立即升级至阶段四做全局评审
- **WHEN** 阶段四发现需架构重构的系统性问题
- **THEN** 强制触发总架构师介入

#### 技术方案

**后端实现**:
- `backend/app/services/agent_roles/quality_manager.py`:
  - `execute_stage_1(module_code) -> SafetyReport` — 单模块安全校验
  - `execute_stage_2(module_spec) -> TestScripts` — 测试脚本生成
  - `execute_stage_3(all_modules) -> IntegrationReport` — 多模块集成校验
  - `execute_stage_4(integrated_code) -> EvaluationReport` — 全局系统评测
  - `execute_stage_5(project_context) -> DeliveryPackage` — 迭代闭环与版本管理
  - `check_stage_boundary(current_stage, action) -> BoundaryCheck` — 阶段边界校验
  - `evaluate_escalation(findings) -> EscalationDecision` — 升级判定
- 触发规则: 按阶段依次激活，严格遵循阶段间刚性边界

**成功标准**:
- 5 阶段全部正确执行
- 阶段间刚性边界零违规
- 强制升级条件零漏报
- 安全校验覆盖率 100%（高安全风险模块）
- 全局评测终审结论准确率 > 95%

---

### Requirement: Git Worktree 隔离

系统 SHALL 为每个 Claude Code CLI 实例创建独立的 Git worktree，确保多模块并行开发时不产生代码冲突。

**借鉴来源**: Composio Agent Orchestrator（Workspace slot）、Claude Squad（Git worktree 隔离）

#### Scenario: 提示词工程阶段自动创建 worktree
- **WHEN** 提示词工程智能体为每个模块创建 Claude Code CLI 实例
- **THEN** 系统自动为每个实例创建独立 worktree（路径: `<repo>/.worktrees/<module-name>-<instance-id>`）
- **AND** 在新 worktree 中创建独立分支（命名: `module/<module-name>/<instance-id>`）
- **AND** 实例的所有文件操作限定在该 worktree 内

#### Scenario: 质量评审通过后合并 worktree
- **WHEN** 所有模块代码通过质量评审
- **THEN** 系统自动合并各 worktree 的变更到主分支
- **AND** 清理已合并的 worktree

#### 技术方案

**后端新增**:
- `backend/app/services/worktree_manager.py` — WorktreeManager:
  - `create_worktree(repo_path, module_name, instance_id) -> WorktreeInfo`
  - `merge_worktree(worktree_id) -> MergeResult`
  - `cleanup_worktree(worktree_id)`
  - `list_worktrees(repo_path) -> List[WorktreeInfo]`
- `backend/app/models.py` — 新增 Worktree 模型
- `backend/app/api/worktree.py` — Worktree API

**成功标准**:
- worktree 创建耗时 < 2 秒
- 多模块并行操作零冲突
- worktree 自动清理成功率 > 95%

---

### Requirement: Git 自动 Commit + Push

系统 SHALL 在 Claude Code CLI 实例完成代码修改后自动执行 Git commit 和 push，生成智能 commit message。

**借鉴来源**: Aider（原子 Git commit + 智能 message）

#### Scenario: 模块代码完成后自动 commit
- **WHEN** Claude Code CLI 实例完成一个模块的代码编写
- **THEN** 系统自动执行 `git add <changed_files>`
- **AND** 自动生成描述性 commit message（如 "feat(perception): 实现激光雷达障碍物检测模块"）
- **AND** 自动执行 `git push` 到远程分支

#### Scenario: 用户可禁用自动 commit
- **WHEN** 用户在设置中关闭"自动 Git commit"
- **THEN** 系统不自动 commit，用户可手动操作

#### 技术方案

**后端改造**:
- `backend/app/services/git_manager.py` — 增强 GitManager:
  - `auto_commit(instance_id, changed_files) -> CommitResult`
  - `generate_commit_message(changes, module_context) -> str`
  - `auto_push(branch) -> PushResult`
- 配置项: `git.auto_commit`, `git.auto_push`

**成功标准**:
- 代码修改后 3 秒内自动 commit
- commit message 描述准确率 > 80%

---

### Requirement: Web Dashboard 工作流监控

系统 SHALL 提供可视化 Dashboard，实时展示 Loop Engineering 工作流的各阶段状态和进度。

**借鉴来源**: Composio AO（Kanban 视图）、Agentrooms（Web UI）

#### Scenario: Dashboard 显示工作流阶段
- **WHEN** 工作流启动后
- **THEN** Dashboard 显示 6 阶段进度条:
  - 需求澄清 → 架构设计 → 提示词工程 → 执行 → 质量评审 → 迭代闭环
- **AND** 当前阶段高亮显示
- **AND** 已完成阶段显示绿色勾
- **AND** 失败阶段显示红色叉

#### Scenario: 阶段详情查看
- **WHEN** 用户点击某个阶段
- **THEN** 展开显示该阶段的:
  - 输入/输出文档
  - 智能体对话记录
  - 执行耗时
  - 操作按钮（重试/跳过/查看详情）

#### 技术方案

**前端新增**:
- `frontend/src/components/WorkflowDashboard.tsx` — 工作流主面板
- `frontend/src/components/StageViewer.tsx` — 阶段详情查看器
- WebSocket 实时状态更新

**成功标准**:
- Dashboard 加载时间 < 1 秒
- 状态更新延迟 < 500ms
- 阶段切换动画流畅（60fps）

---

### Requirement: Monaco Editor 升级 CodeViewer

系统 SHALL 将 CodeViewer 升级为 Monaco Editor，提供代码智能补全、语法检查、跳转定义等 IDE 级功能。

**借鉴来源**: OpenCode（内置 LSP）、OMC（LSP 集成）

#### Scenario: 代码智能补全与诊断
- **WHEN** 用户在 CodeViewer 中查看/编辑代码
- **THEN** Monaco Editor 提供:
  - 语法高亮（TypeScript/Python/C++/JSON/YAML/CMake）
  - 智能补全（TypeScript 内置，Python/C++ 基础补全）
  - 错误诊断（红色波浪线 + 悬停详情）
  - 多 Tab 文件编辑

#### 技术方案

**前端改造**:
- 安装 `@monaco-editor/react`
- 重构 `CodeViewer.tsx` 为 Monaco Editor 封装
- 代码分割 + 懒加载

**成功标准**:
- Monaco Editor 首次加载 < 2 秒
- 支持至少 6 种语言语法高亮
- TypeScript 智能补全可用

---

### Requirement: 跨 Session Memory（Hermes 内核管理）

系统 SHALL 由 Hermes 内核自动管理跨会话记忆，在用户对话及项目完成后进行总结与记忆，并自动编写 Skills。

**借鉴来源**: Hermes Agent（memory-first 架构）、OMC（状态与记忆）

#### Scenario: 对话后自动总结
- **WHEN** 用户完成一次对话会话
- **THEN** Hermes 自动总结对话要点
- **AND** 提取用户偏好（编码风格、常用技术栈、项目背景）
- **AND** 存储为持久化记忆

#### Scenario: 项目完成后自动编写 Skills
- **WHEN** 一个项目的工作流全部完成
- **THEN** Hermes 自动分析项目中的通用模式
- **AND** 编写可复用的 Skills（如"ROS2 节点模板生成"、"Gazebo 仿真配置"）
- **AND** 存储到 Skills 库供后续项目使用

#### 技术方案

**Hermes 集成**:
- `hermes_integration/hermes_executor.py` — 增强:
  - `summarize_session(session_id) -> SessionSummary`
  - `extract_preferences(session_id) -> UserPreferences`
  - `generate_skills(project_context) -> List[Skill]`
- 记忆存储: 利用现有 `memory_store.py` + `.hermes/memory/` 目录

**成功标准**:
- 对话总结覆盖率 100%
- Skills 自动生成准确率 > 70%
- 记忆加载时间 < 500ms

---

## MODIFIED Requirements

### Requirement: HermesService 增强（原 backend/app/services/hermes_service.py）

**原行为**: HermesService 负责聊天、提示词优化、任务规划、agent 生命周期管理。

**新行为**: 新增工作流编排能力，支持:
- 启动和管理 Loop Engineering 工作流
- 以指定智能体角色身份调用 Hermes
- 阶段推进和回退控制
- 工作流状态查询

**变更原因**: Loop Engineering 工作流的核心调度引擎。

#### Scenario: 以指定角色身份调用
- **WHEN** 工作流引擎需要激活某个智能体角色
- **THEN** HermesService 以该角色的 system prompt 调用 Hermes
- **AND** 角色的职责描述和权责红线注入到 system prompt 中
- **AND** 角色的输出规范作为输出格式约束

---

### Requirement: AgentManager 扩展（原 cli_integration/agent_manager.py）

**原行为**: 管理单个 Claude Code CLI 实例的生命周期。

**新行为**: 管理多个 Claude Code CLI 实例池，支持:
- 提示词工程智能体创建多个 CLI 实例
- 每个实例绑定独立 worktree
- 实例状态监控（running/completed/failed）
- 实例完成后自动触发质量评审

**变更原因**: 支持多模块并行编码执行。

---

### Requirement: Session 模型扩展（原 backend/app/models.py Session）

**原行为**: Session 包含 id、title、mode、status、deleted_at、last_active_at。

**新行为**: 新增字段:
- `workflow_id` — 关联的 Workflow（可为空，chat 模式无工作流）
- `workflow_stage` — 当前工作流阶段

**变更原因**: 支持工作流与会话的关联。

---

## REMOVED Requirements

无。所有现有功能保留，仅在此基础上扩展。

---

## 优先级排序

| 优先级 | 任务 | 影响 | 工作量 | 依赖 |
|--------|------|------|--------|------|
| 🔴 P0 | Task 1: Loop Engineering 工作流引擎 | 极高 | 高 | 无 |
| 🔴 P0 | Task 2: 5 个智能体角色实现 | 极高 | 高 | Task 1 |
| 🔴 P0 | Task 3: Git Worktree 隔离 | 高 | 中 | Task 2（提示词工程阶段需要） |
| 🟡 P1 | Task 4: Web Dashboard 工作流监控 | 高 | 中 | Task 1 |
| 🟡 P1 | Task 5: Git 自动 Commit + Push | 中 | 低 | 无 |
| 🟡 P1 | Task 6: Monaco Editor 升级 | 中 | 中 | 无 |
| 🟢 P2 | Task 7: 跨 Session Memory（Hermes 内核） | 中 | 中 | 无 |

---

## 风险总览

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| 工作流执行时间过长 | Task 1, 2 | 高 | 清晰的进度反馈 + 阶段超时机制 |
| 智能体角色 prompt 过于复杂 | Task 2 | 中 | 分阶段测试 + prompt 模板化管理 |
| 阶段间上下文丢失 | Task 1, 2 | 中 | 结构化上下文传递 + 关键信息摘要 |
| Git worktree 磁盘占用 | Task 3 | 中 | 自动清理策略 + 磁盘告警 |
| 迭代闭环无限循环 | Task 1, 2 | 中 | 最大迭代次数限制（3 轮） |
| Monaco Editor 包体积 | Task 6 | 低 | 代码分割 + 懒加载 |

---

## 成功标准总览

| 维度 | 指标 | 目标值 |
|------|------|--------|
| 工作流完整性 | 6 阶段正确串联执行 | 100% |
| 智能体角色 | 5 个角色全部实现并正确触发 | 100% |
| 架构输出 | 四文档（spec/checklist/task/验收标准）完整输出 | 100% |
| 质量保障 | 5 阶段质量评审全部执行 | 100% |
| 并行隔离 | 多模块 worktree 零冲突 | 100% |
| Git 自动化 | 自动 commit 成功率 | ≥ 95% |
| Dashboard | 工作流状态实时更新延迟 | < 500ms |
| 代码编辑 | Monaco Editor 支持语言数 | ≥ 6 |
| 迭代控制 | 最大迭代轮次 | ≤ 3 |
