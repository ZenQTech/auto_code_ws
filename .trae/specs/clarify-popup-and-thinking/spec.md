# 澄清阶段思考过程可见 + 问题弹窗化

## Why
1. 澄清阶段的 AI 回复以纯 Markdown 文本形式呈现在聊天中，未渲染为交互式 `ClarificationCard`，用户无法点击选项提交，只能看到原始文本
2. 澄清阶段无思考过程展示（AI 的分析推理过程不可见）
3. 澄清问题应参考 Trae IDE AskUserQuestion 的**独立弹窗**形式，而非内嵌在聊天流中

## What Changes
- **后端**：确认 `clarify_questions` SSE 事件正确发送且包含 `round`/`maxRounds` 字段
- **前端**：将 `ClarificationCard` 从聊天流内嵌改为**独立模态弹窗**，半透明遮罩 + 居中卡片
- **前端**：在澄清阶段增加"AI 正在分析需求..."的思考状态提示
- **前端**：确保 `clarify_questions` SSE 事件被正确消费并驱动弹窗显示

## Impact
- Affected specs: clarify-interactive-options, fix-clarification-multi-round
- Affected code:
  - `frontend/src/components/ClarificationCard.tsx`（改为弹窗模式）
  - `frontend/src/App.tsx`（弹窗渲染逻辑 + 思考提示）
  - 可能 `backend/app/services/hermes_service.py`（确认 SSE 事件发送）

## ADDED Requirements
### Requirement: 澄清问题独立弹窗
系统 SHALL 在收到 `clarify_questions` SSE 事件后，以独立模态弹窗（半透明遮罩 + 居中卡片）展示澄清问题，而非内嵌在聊天消息流中。

#### Scenario: 工作流启动后弹出澄清弹窗
- **WHEN** 后端推送首轮 `clarify_questions` 事件
- **THEN** 聊天区上方出现半透明遮罩，居中显示 `ClarificationCard` 弹窗，聊天区不可交互

### Requirement: 澄清阶段思考过程可视化
系统 SHALL 在澄清阶段展示 AI 分析需求的过程提示（如"AI 正在分析需求..."、"已识别 6 个需求维度"等）。

#### Scenario: 工作流启动后显示思考过程
- **WHEN** 工作流启动并进入澄清阶段
- **THEN** 在弹出澄清弹窗前，先显示可折叠的思考过程块（含 AI 的分析推理）
