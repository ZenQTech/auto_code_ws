# 修复需求澄清第二轮后失效 + StageStatus 枚举错误

## Why
1. 澄清第二轮提交后，`clarify_round` 返回 `clarification_complete=True` 且 `questions=[]`（0 个问题），导致 `clarify_questions` SSE 事件 `complete: true` + 空 questions。前端 `ClarificationModal` 因 `questions.length > 0` 为 false 而不渲染，`showClarifyModal=false` 弹窗关闭，用户看不到"确认需求文档"按钮。
2. `clarification_service.py` 写入 `workflow_stages` 时使用小写 `'completed'`，但 `StageStatus` 枚举值为大写 `COMPLETED`，导致 `get_workflow_status` 查询时报 `LookupError`。

## What Changes
- **后端**：`clarification_service.py` 将 `'completed'` 改为 `'COMPLETED'`（两处）
- **前端**：`App.tsx` 当 `clarificationData.isComplete=true` 且 `questions` 为空时，仍显示弹窗（含"确认进入架构设计"按钮）

## Impact
- Affected specs: clarify-popup-and-thinking, fix-clarification-multi-round
- Affected code:
  - `backend/app/services/clarification_service.py` (line ~290, ~373)
  - `frontend/src/App.tsx` (ClarificationModal 渲染条件)

## MODIFIED Requirements
### Requirement: 澄清完成时应显示确认弹窗
系统 SHALL 在澄清完成（`isComplete=true`）时，即使 `questions` 为空，仍显示 `ClarificationModal` 弹窗，含"确认需求文档，进入架构设计"按钮。

#### Scenario: 第三轮澄清完成
- **WHEN** `clarify_questions` 事件携带 `complete: true` 且 `questions: []`
- **THEN** `ClarificationModal` 弹窗仍显示，展示 `summary` 和完成操作按钮
