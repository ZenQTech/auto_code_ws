# 修复 onConfirm 闭包捕获 null 状态导致静默失败

## Why
`onConfirm` 是 JSX 内联函数，在渲染时捕获 `workflowStatus` 和 `sessionDetail` 的当前值。这两个状态均为异步加载（`useEffect` + API fetch），存在时间窗口内值为 `null`。当用户点击「跳过不确定项」时，`if (wfId)` 检查失败，回调静默退出——API 从未发出、无任何错误提示、用户看到按钮点击无反应。

终端日志中完全没有 `/api/workflow/{id}/clarify/confirm` 请求，证实了这一点。

## What Changes
- App.tsx 新增 `workflowIdRef`（useRef），随 `sessionDetail?.session?.workflow_id` 变化实时更新
- 两处 `onConfirm` 回调使用 `workflowIdRef.current` 替代 `sessionDetail?.session?.workflow_id`，消除闭包过期问题

## Impact
- Affected code: `frontend/src/App.tsx`

## MODIFIED Requirements

### Requirement: onConfirm 回调的 workflow_id 获取
原：从 `sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id` 获取（均为异步状态，可能为 null）
新：从 `workflowIdRef.current` 获取（useRef 始终持有最新值），`workflowStatus?.workflow_id` 作为回退

#### Scenario: 异步状态已加载
- **WHEN** `sessionDetail` 和 `workflowStatus` 均已加载
- **THEN** `onConfirm` 正常获取 workflow_id 并发起 API 调用

#### Scenario: 异步状态尚未加载
- **WHEN** `sessionDetail` 和 `workflowStatus` 均为 null（首次渲染时）
- **THEN** `onConfirm` 通过 `workflowIdRef.current` 获取到已加载的值（ref 实时同步），正常发起 API 调用
