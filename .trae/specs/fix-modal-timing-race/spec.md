# 修复澄清完成时弹窗不显示（运行时状态竞争）

## Why
代码逻辑已验证全部正确（SSE 事件发送、解析、状态更新、渲染条件均无误），但运行时存在状态竞争导致 `ClarificationModal` 不渲染。`onDone` 回调中的 `fetchWorkflowStatus` → `setWorkflowStatus` 触发额外重渲染，可能在弹窗渲染前覆盖了 `showClarifyModal` 状态。

## What Changes
- `App.tsx`: 新增 `useEffect` 监听 `clarificationData.isComplete`，强制 `setShowClarifyModal(true)`
- `hermes_service.py`: 当 `questions=[]` 且 `complete=true` 时，`questions_text` 改为"需求澄清已完成"而非空标题

## Impact
- Affected code: `frontend/src/App.tsx`, `backend/app/services/hermes_service.py`
