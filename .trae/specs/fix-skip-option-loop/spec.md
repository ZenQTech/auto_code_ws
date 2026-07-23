# 修复澄清阶段"跳过不确定项"选项无法跳出循环

## Why
ClarificationCard 中的「跳过不确定项，进入架构设计」是一个交互式问题选项。用户点击后，ClarificationCard 将其作为普通答案提交（`handleSubmit` → `handleSendClarifyAnswer` → chat/stream），而非触发 `onConfirm` 回调。该答案被送入 `handle_user_response`，AI 可能返回 `complete=True`，但后续 `_has_uncertain_items` 检测到需求文档含"不确定项"关键词后强制 `complete=False`，形成无限循环。

## What Changes
- `handle_user_response` 中：当用户消息明确包含"跳过不确定项"时，跳过 `_has_uncertain_items` 检查，直接完成澄清（不限轮次）
- 用户继续确认不确定项时行为不变，正常继续澄清

## Impact
- Affected code: `backend/app/services/clarification_service.py`

## MODIFIED Requirements

### Requirement: 用户显式跳过不确定项
当用户消息包含「跳过不确定项」时（不限轮次），SHALL 跳过不确定项检查，直接完成澄清。

#### Scenario: 用户选择跳过
- **WHEN** 用户消息含"跳过不确定项"
- **THEN** 不执行 `_has_uncertain_items` 检查，直接 `complete=True`

#### Scenario: 用户继续确认不确定项
- **WHEN** 用户消息不含"跳过不确定项"
- **THEN** 行为不变，正常继续澄清流程
