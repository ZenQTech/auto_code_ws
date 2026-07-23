# 需求澄清交互式选择 UI 与 SSE 中止修复 Spec

## Why
两个问题：① 浏览器持续报 `net::ERR_ABORTED http://localhost:8080/api/hermes/chat/stream`，根因是前端 SSE reader 在收到 `done`/`error` 事件后直接 `return`，未调用 `reader.cancel()`，导致 Chromium 将未正常读完 EOF 的连接标记为 ABORTED（无害但污染控制台）。② 需求澄清阶段当前以纯文本展示问题，不支持像 Trae IDE solo 模式 AskUserQuestion 那样的"选项选择 + 自由文本输入"交互；全链路（dataclass、Prompt、SSE、前端）均无 `options` 字段。此外 `setWorkflowStatus` 从未被赋值，导致 clarifying 分流逻辑实际从未触发。

## What Changes
- 修复前端 SSE：收到 `done`/`error` 后、`return` 前调用 `reader.cancel()`，消除 ERR_ABORTED
- `ClarificationQuestion` dataclass 新增 `options: List[str]` 和 `allow_multiple: bool` 字段
- 合并 `requirement_clarifier.py` 中重复定义的 `ClarifyResult` dataclass
- 更新 `REQUIREMENT_CLARIFIER_SYSTEM_PROMPT`，要求模型为每个问题输出候选 options（每个问题 2-4 个选项）
- `_parse_clarify_response` 解析 options 字段
- SSE 新增结构化事件 `clarify_questions`（透传结构化问题数据，含 options），替代纯 Markdown 文本
- 前端 `ClarificationCard` 改造为交互式选择卡片：每个问题渲染可点击选项 + 始终提供"其他（自由输入）"项
- 修复 `setWorkflowStatus`：发送消息后从工作流状态 API 拉取并赋值，使 clarifying 分流生效
- 前端解析改为消费结构化 SSE 事件而非正则解析 Markdown

## Impact
- Affected specs: fix-clarification-interaction, fix-hermes-workflow-ux, fix-streaming-no-output
- Affected code:
  - `frontend/src/hooks/useApi.ts` - reader.cancel() 修复 + 解析 clarify_questions 事件
  - `backend/app/services/agent_roles/requirement_clarifier.py` - options 字段 + 合并 ClarifyResult + Prompt
  - `backend/app/services/clarification_service.py` - 透传 options
  - `backend/app/services/hermes_service.py` - SSE clarify_questions 事件
  - `frontend/src/components/ClarificationCard.tsx` - 交互式选择 UI
  - `frontend/src/App.tsx` - setWorkflowStatus 赋值 + 消费结构化事件

---

## ADDED Requirements

### Requirement: 消除 SSE 流的 ERR_ABORTED
系统 SHALL 在前端 SSE reader 收到终止事件后正确释放流资源，避免浏览器标记连接为 ABORTED。

#### Scenario: done 事件后释放 reader
- **WHEN** 前端 `chatWithHermesStreaming` 收到 `{"type":"done"}` 事件
- **THEN** 在 `return` 之前调用 `await reader.cancel()`
- **AND** 不再产生 `net::ERR_ABORTED` 控制台错误

#### Scenario: error 事件后释放 reader
- **WHEN** 前端收到 `{"type":"error"}` 事件
- **THEN** 在 `return` 之前调用 `await reader.cancel()`

### Requirement: 澄清问题支持候选选项
系统 SHALL 在需求澄清问题中支持候选选项，使前端能以选择交互方式呈现。

#### Scenario: 问题数据结构含 options
- **WHEN** RequirementClarifier 生成澄清问题
- **THEN** 每个 `ClarificationQuestion` 包含 `dimension`、`question`、`importance`、`options`（候选项列表）、`allow_multiple`（是否多选）字段
- **AND** options 为 2-4 个具体可选方案

#### Scenario: Prompt 要求模型产出选项
- **WHEN** 调用需求澄清 system prompt
- **THEN** Prompt 要求模型为每个问题给出 2-4 个候选选项
- **AND** JSON 输出格式包含 `options` 数组

#### Scenario: SSE 透传结构化问题
- **WHEN** 澄清服务返回问题
- **THEN** 通过 SSE 事件 `{"type":"clarify_questions","questions":[...]}` 透传结构化数据
- **AND** 每个问题含完整 options 信息

### Requirement: 前端交互式选择澄清卡片
系统 SHALL 在前端以交互式选择卡片呈现澄清问题，每个问题提供可点击选项及自由文本输入项。

#### Scenario: 渲染选项按钮
- **WHEN** 前端收到含 options 的澄清问题
- **THEN** 每个问题渲染为可点击的选项按钮（单选或多选）
- **AND** 始终额外提供"其他（自由输入）"选项

#### Scenario: 提交选择
- **WHEN** 用户选择选项或填写自由输入后提交
- **THEN** 将所有问题的回答汇总为结构化文本
- **AND** 通过澄清回复端点提交给后端
- **AND** 后端生成下一轮问题或完成澄清

#### Scenario: 自由输入项
- **WHEN** 用户选择"其他"选项
- **THEN** 展示文本输入框供用户补充自定义内容

### Requirement: 修复 workflowStatus 赋值
系统 SHALL 在前端正确维护 `workflowStatus` 状态，使 clarifying 阶段分流逻辑生效。

#### Scenario: 拉取并赋值工作流状态
- **WHEN** 会话存在关联工作流
- **THEN** 前端调用工作流状态 API 并 `setWorkflowStatus`
- **AND** clarifying 阶段的消息走澄清专用路径

---

## MODIFIED Requirements

### Requirement: ClarifyResult 单一定义
**问题**: `requirement_clarifier.py` 重复定义了两个 `ClarifyResult` dataclass（第 44-63、75-86 行），后者覆盖前者。
**修复**: 合并为单一定义，保留所有必要字段（raw_text、questions、clarification_complete、missing_dimensions、summary）。

### Requirement: _format_clarify_result_for_sse 输出结构化事件
**原行为**: 仅输出拼接的 Markdown 文本 `### 需要您补充以下信息：`。
**新行为**: 同时输出结构化 `clarify_questions` 事件（含 options），前端优先消费结构化数据；保留 Markdown 文本作为降级兼容。
