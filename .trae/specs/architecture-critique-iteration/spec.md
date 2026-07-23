# 架构设计与批判迭代阶段 Spec

## Why
当前系统在需求澄清完成后直接跳到任务执行，缺少架构设计、批判反思和需求迭代的关键环节。需要在需求澄清阶段之后、代码开发阶段之前，插入一个完整的"架构设计与批判迭代"阶段，确保架构方案经过充分批判和优化后再进入开发。

## What Changes
- 新增 designing 阶段的 7 个步骤：生成专用智能体 → 架构批判分析 → 需求迭代优化 → 弹窗确认 → 人类审核 → 验收标准制定 → 文档生成与 Git 初始化
- 新增 `critique_architect` 和 `quality_manager` 两个智能体角色
- 新增架构设计结果展示弹窗（`ArchitectureModal`）
- 新增用户确认/返回修改的交互流程
- 新增 spec.md / tasks.md / checklist.md 自动生成与 Git 提交

## Impact
- Affected specs: loop-engineering-workflow-engine, clarify-uncertain-items-check
- Affected code: `workflow_engine.py`, `hermes_service.py`, `App.tsx`, `ClarificationModal.tsx`, 新增 `ArchitectureModal.tsx`, 新增 `critique_architect.py`, `quality_manager.py`

## ADDED Requirements

### Requirement: 架构设计阶段自动触发
系统 SHALL 在用户单击"跳过不确定项，进入架构设计"按钮后，自动将工作流推进到 designing 阶段，并启动架构设计流程。

#### Scenario: 触发架构设计
- **WHEN** 用户在需求澄清完成弹窗中单击"跳过不确定项，进入架构设计"
- **THEN** 工作流 `current_stage` 变更为 `designing`，后端开始执行架构设计流程

### Requirement: 专用智能体生成
系统 SHALL 在进入 designing 阶段后，生成"质量保障与迭代管理智能体"和"批判反思智能体"，并加载其系统提示词。

#### Scenario: 智能体生成
- **WHEN** designing 阶段启动
- **THEN** `quality_manager` 和 `critique_architect` 两个智能体被初始化，具备完整的系统提示词和功能接口

### Requirement: 全维度架构批判分析
批判反思智能体 SHALL 基于需求文档执行全维度架构批判分析，覆盖系统架构、模块划分、接口设计、性能优化、安全策略等方面，输出结构化缺陷清单及修复方案。

#### Scenario: 架构批判分析
- **WHEN** 批判反思智能体收到分析指令
- **THEN** 输出包含缺陷ID、严重程度、位置描述、影响范围的缺陷清单，以及对应的详细修复方案

### Requirement: 需求文档迭代优化
批判反思智能体 SHALL 针对已确认的需求文档进行系统性迭代优化，重点关注需求完整性、逻辑一致性、技术可行性、用户体验等维度，生成需求文档 V2.0。

#### Scenario: 需求迭代
- **WHEN** 架构批判完成后
- **THEN** 生成迭代后的需求文档 V2.0，标注与 V1.0 的变更点

### Requirement: 架构设计结果弹窗
系统 SHALL 将迭代优化后的需求文档 V2.0 以模态对话框形式弹出，标题固定为"架构设计与批判迭代阶段"，包含文档预览区、确认按钮、返回修改按钮。

#### Scenario: 弹窗展示
- **WHEN** 需求文档 V2.0 生成完成
- **THEN** `ArchitectureModal` 以全屏遮罩+居中卡片形式弹出，标题为"架构设计与批判迭代阶段"

### Requirement: 人类审核确认
系统 SHALL 等待用户对迭代后的架构设计进行审核确认：
- 确认不通过 → 返回重新架构批判与需求迭代
- 确认通过 → 进入任务验收标准制定阶段

#### Scenario: 用户确认通过
- **WHEN** 用户单击"确认通过"
- **THEN** 系统进入验收标准制定阶段

#### Scenario: 用户返回修改
- **WHEN** 用户单击"返回修改"
- **THEN** 系统重新执行架构批判与需求迭代流程

### Requirement: 验收标准制定
总架构师智能体与质量保障智能体 SHALL 协作制定详细的任务验收标准，覆盖功能验证、代码质量、性能指标、安全合规、兼容性等方面。

#### Scenario: 验收标准生成
- **WHEN** 用户确认通过后
- **THEN** 生成包含所有功能点验证方法、非功能需求量化指标、测试环境要求的验收标准文档

### Requirement: 文档生成与 Git 初始化
系统 SHALL 生成 spec.md、tasks.md、checklist.md 的初始版本，自动创建 Git 仓库，初始化项目结构，并将文档提交至主分支。

#### Scenario: 文档生成
- **WHEN** 验收标准制定完成
- **THEN** spec.md / tasks.md / checklist.md 生成完毕，Git 仓库已初始化，文档已提交

## MODIFIED Requirements

### Requirement: 工作流阶段推进
`workflow_engine.confirm_stage("clarifying")` SHALL 在确认后自动调用 `advance_stage` 推进到 designing 阶段。

#### Scenario: 阶段推进
- **WHEN** `confirm_stage("clarifying")` 被调用
- **THEN** 工作流 `current_stage` 从 `clarifying` 变更为 `designing`，`advance_stage` 自动触发 designing 阶段的初始化逻辑
