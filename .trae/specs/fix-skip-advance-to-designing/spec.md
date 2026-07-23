# 修复"跳过不确定项"未推进到架构设计阶段 Spec

## Why
用户点击/选择"跳过不确定项，进入系统架构设计"后，工作流（如 7e864480）仍停留在 `clarifying` 阶段，反复调用需求澄清智能体，从未进入"架构设计与批判迭代阶段"。

根因：该跳过意图存在**两条不一致的处理路径**：
- **按钮路径**（ClarificationCard 的 `跳过按钮`）→ `onConfirm` → `POST /clarify/confirm` → `confirm_stage("clarifying")` → `advance_stage` → 推进到 `designing`。正确。
- **选项路径**（后端把"跳过不确定项，进入架构设计"作为澄清问题的**候选选项**下发；用户勾选后点击"提交回答"）→ `handleSubmit` → `onSubmit` → `handleSendClarifyAnswer` → `chat/stream` → `handle_user_response`。此路径仅在 `clarification_service` 中把 `clarification_complete` 置为 True 并生成需求文档，**从不调用 `advance_stage`**，因此工作流永远停在 `clarifying`，前端持续弹出新一轮澄清卡片。

日志佐证：全程只有 `POST /api/hermes/chat/stream`（澄清模式），从未出现 `/clarify/confirm` 或 `/architecture/start-design-phase` 调用。

## What Changes
- **前端（核心修复）**：`ClarificationCard.handleSubmit` 检测到任一选中答案包含"跳过不确定项"关键词时，改为调用 `onConfirm(workflowId)`（走确认→推进→架构设计弹窗路径），而非把它作为普通答案 `onSubmit` 提交到 `chat/stream`。这样按钮与选项两种跳过入口行为统一。
- **后端（健壮性兜底）**：`confirm_stage("clarifying")` 在 `requirement_doc` 为空时，不再直接返回失败，而是先调用 `clarification_service.finalize_requirement_doc()` 生成需求文档再推进，避免用户直接点击跳过按钮（此前从未 finalize）时 `confirm` 因文档为空而静默失败、弹窗卡住。

## Impact
- Affected specs: `architecture-critique-iteration`、`fix-skip-uncertain-items`、`fix-skip-option-loop`
- Affected code:
  - `frontend/src/components/ClarificationCard.tsx` — `handleSubmit` 跳过意图分流
  - `backend/app/services/workflow_engine.py` — `confirm_stage("clarifying")` 空文档兜底
  - （只读依赖，不改）`backend/app/services/clarification_service.py`、`backend/app/api/workflow.py`

## MODIFIED Requirements

### Requirement: 跳过不确定项统一走确认推进路径
无论用户是点击"跳过不确定项，进入架构设计"**按钮**，还是在澄清问题中勾选同名**选项**并提交，系统 SHALL 统一走"确认需求 → `confirm_stage("clarifying")` → `advance_stage` → 启动架构设计阶段"路径，最终将 `current_stage` 推进到 `designing` 并触发架构设计批判迭代弹窗。

#### Scenario: 用户勾选"跳过不确定项"选项并提交
- **WHEN** 用户在澄清卡片中勾选包含"跳过不确定项"的选项并点击"提交回答"
- **THEN** 前端不发送 `chat/stream` 澄清请求，而是调用 `onConfirm(workflowId)`，触发 `/clarify/confirm`，工作流推进到 `designing` 并弹出架构设计模态

#### Scenario: 用户点击"跳过不确定项"按钮
- **WHEN** 用户点击跳过按钮
- **THEN** 行为不变，`onConfirm` 正常触发确认与推进

### Requirement: 确认阶段空文档兜底
`confirm_stage("clarifying")` SHALL 在 `requirement_doc` 为空时先调用 `finalize_requirement_doc()` 生成需求文档，再执行 `advance_stage`；仅当生成后仍为空才返回失败。

#### Scenario: 需求文档尚未生成时点击跳过
- **WHEN** 用户在澄清尚未 finalize 时触发跳过确认，`requirement_doc` 为空
- **THEN** 后端先生成需求文档，再自动补全 `clarification_complete=True` 并推进到 `designing`

#### Scenario: 需求文档已存在
- **WHEN** `requirement_doc` 非空
- **THEN** 行为不变，直接推进
