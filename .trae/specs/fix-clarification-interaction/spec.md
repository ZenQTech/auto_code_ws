# 需求澄清交互断连修复 Spec

## Why
用户输入开发需求后，无法在网页端看到任何需求澄清阶段的交互对话。根因分析发现：`RequirementClarifier` 类已定义但从未被任何模块实例化或调用，`HermesService` 使用通用聊天 prompt 而非需求澄清专用 prompt，`WorkflowEngine` 的 clarifying 阶段是纯被动状态机不触发 AI 对话，API 层没有需求澄清专用端点，前端没有交互式澄清 UI。需求澄清功能存在完整的"定义-调用-展示"三层断连。

## What Changes
- 新增 `ClarificationService` 桥接服务，连接 WorkflowEngine 的 clarifying 阶段与 RequirementClarifier 的实际 AI 调用
- 修改 `HermesService._build_chat_command()`，当 Session 处于 clarifying 阶段时，自动切换为需求澄清专用 system prompt
- 新增 API 端点 `POST /api/hermes/clarify/confirm` 供前端提交澄清确认
- 新增 API 端点 `GET /api/workflow/{id}/clarify/questions` 获取当前澄清问题
- 修改前端 `App.tsx`，在 clarifying 阶段展示交互式需求澄清问答 UI
- 修改 `WorkflowEngine.start_workflow()`，启动时自动调用 RequirementClarifier 生成首轮澄清问题
- 新增 `MessageBubble` 组件对澄清问题的特殊渲染支持
- 新增 `ClarificationCard` 前端组件用于交互式澄清对话

## Impact
- Affected specs: workflow-sop-full-implementation, loop-engineering-workflow-engine
- Affected code:
  - `backend/app/services/agent_roles/requirement_clarifier.py` - 增强 clarify() 方法输出结构化 JSON
  - `backend/app/services/hermes_service.py` - 新增阶段感知的 prompt 切换逻辑
  - `backend/app/services/` - 新增 `clarification_service.py` 桥接服务
  - `backend/app/api/hermes.py` - 新增 clarify/confirm 端点
  - `backend/app/api/workflow.py` - 新增 clarify/questions 端点
  - `backend/app/services/workflow_engine.py` - start_workflow 集成 ClarificationService
  - `backend/app/models.py` - Session/Workflow 模型新增 clarification 字段
  - `frontend/src/App.tsx` - 新增 clarifying 阶段 UI 分支
  - `frontend/src/components/` - 新增 `ClarificationCard.tsx`

---

## ADDED Requirements

### Requirement: ClarificationService 桥接层
系统 SHALL 提供 `ClarificationService` 作为 WorkflowEngine 与 RequirementClarifier 之间的桥接层，负责在 clarifying 阶段驱动需求澄清的 AI 对话。

#### Scenario: 工作流启动时自动生成首轮澄清问题
- **WHEN** WorkflowEngine.start_workflow() 被调用
- **THEN** ClarificationService 自动调用 RequirementClarifier.clarify() 生成首轮澄清问题
- **AND** 将问题持久化到 Workflow.clarification_questions 字段
- **AND** 将问题内容写入 clarifying 阶段的 WorkflowStage.output_doc

#### Scenario: 用户回复后生成下一轮澄清问题
- **WHEN** 用户在 clarifying 阶段发送消息
- **THEN** ClarificationService 将用户回复追加到对话历史
- **AND** 调用 RequirementClarifier.clarify() 生成下一轮澄清问题或判定澄清完成
- **AND** 若澄清完成，调用 generate_requirement_doc() 生成需求文档
- **AND** 更新 Workflow.requirement_doc 和 Workflow.clarification_complete 标记

### Requirement: HermesService 阶段感知 Prompt 切换
系统 SHALL 在 HermesService 中实现阶段感知机制，当 Session 处于 clarifying 阶段时自动使用需求澄清专用 system prompt。

#### Scenario: clarifying 阶段对话
- **WHEN** Session 的 workflow_stage 为 "clarifying"
- **THEN** HermesService 使用 REQUIREMENT_CLARIFIER_SYSTEM_PROMPT 替代通用聊天 prompt
- **AND** 用户的每次回复都作为澄清对话的输入
- **AND** 澄清对话轮次控制在 3-5 轮

#### Scenario: 非 clarifying 阶段对话
- **WHEN** Session 的 workflow_stage 不为 "clarifying" 或无工作流
- **THEN** HermesService 使用原有的通用聊天 prompt
- **AND** 保持现有对话行为不变

### Requirement: 前端交互式需求澄清 UI
系统 SHALL 在前端提供交互式需求澄清 UI，在 clarifying 阶段替代纯文本聊天界面，展示结构化澄清问题和用户输入引导。

#### Scenario: clarifying 阶段 UI 展示
- **WHEN** 前端检测到 workflow.current_stage 为 "clarifying"
- **THEN** 在聊天区顶部展示澄清进度指示器（如 "需求澄清 · 第 2/5 轮"）
- **AND** 将 Agent 消息中的澄清问题以结构化卡片形式渲染
- **AND** 高亮显示需要用户关注的维度（功能需求/约束条件/安全要求等）

#### Scenario: 用户提交澄清回复
- **WHEN** 用户在 clarifying 阶段输入回复并发送
- **THEN** 前端调用 POST /api/hermes/clarify/respond 提交回复
- **AND** 后端生成下一轮澄清问题或判定完成
- **AND** 流式返回 Agent 回复

#### Scenario: 澄清完成确认
- **WHEN** 后端判定需求澄清完成（对话轮次足够或信息充分）
- **THEN** 后端生成标准化需求文档
- **AND** 前端展示需求文档预览，提供"确认"和"继续补充"两个按钮
- **AND** 用户确认后调用 confirm_stage("clarifying") 推进到下一阶段

### Requirement: WorkflowEngine clarifying 阶段集成
系统 SHALL 在 WorkflowEngine 的 clarifying 阶段集成 ClarificationService，使状态机与 AI 对话联动。

#### Scenario: 工作流启动时初始化澄清
- **WHEN** start_workflow() 被调用
- **THEN** 创建并调用 ClarificationService 生成首轮澄清问题
- **AND** 将澄清问题写入 clarifying 阶段 stage 的 output_doc
- **AND** 将 clarification_round 设为 1

#### Scenario: validate_stage_boundary 检查澄清完成
- **WHEN** 校验 clarifying → designing 边界
- **THEN** 检查 Workflow.clarification_complete 为 True
- **AND** 检查 Workflow.requirement_doc 非空
- **AND** 检查 Workflow.human_confirmed_requirement 为 True
