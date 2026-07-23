# 需求澄清完成条件改为"需求文档无不确定项" + 最大 12 轮限制

## Why
当前澄清完成由 AI 自行判断（`clarification_complete`），但 AI 常在仍存在"不确定项与待确认项"时提前标记完成。需改为：需求文档中不存在"不确定项"章节时才判定完成。若 6 轮后仍有不确定项，每轮询问用户是否继续，最多 12 轮，第 13 轮强制进入架构设计。

## What Changes
- `clarification_service.py`: `handle_user_response` 增加不确定项检测 + 轮次上限逻辑
- `requirement_clarifier.py`: `clarify_round` 提示词增加"若仍有不确定项，列出但不标记完成"
- 前端: `ClarificationCard` 增加"仍有 X 项不确定，继续澄清 / 跳过进入架构设计"按钮

## Impact
- Affected code: `backend/app/services/clarification_service.py`, `backend/app/services/agent_roles/requirement_clarifier.py`, `frontend/src/components/ClarificationCard.tsx`

## ADDED Requirements
### Requirement: 需求文档无不确定项才算完成
系统 SHALL 在每轮澄清后检查需求文档是否包含"不确定项"或"待确认项"章节，若存在则标记 `clarification_complete=False`。

#### Scenario: 第 4 轮后仍有不确定项
- **WHEN** 需求文档包含"不确定项与待确认项"表格（含 6 个条目）
- **THEN** `clarification_complete=False`，继续下一轮澄清

### Requirement: 6 轮后询问是否继续
系统 SHALL 在 ≥6 轮后仍有不确定项时，在澄清问题中追加"仍有 X 项不确定，是否继续澄清？"提示。

### Requirement: 最大 12 轮限制
系统 SHALL 在第 13 轮强制设置 `clarification_complete=True` 并进入架构设计。
