# Tasks

- [x] Task 1: 新增 workflowIdRef 并同步 sessionDetail 的 workflow_id
  - 在 App.tsx 中新增 `const workflowIdRef = useRef<string | null | undefined>()`
  - 新增 `useEffect`：当 `sessionDetail?.session?.workflow_id` 变化时更新 `workflowIdRef.current`
  - **验证**：ref 值始终与最新 sessionDetail 同步

- [x] Task 2: 两处 onConfirm 回调使用 ref 替代闭包状态
  - 将 `const wfId = sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id` 改为 `const wfId = workflowIdRef.current || workflowStatus?.workflow_id`
  - **验证**：点击按钮时 API 调用正常发出

# Task Dependencies
- Task 2 依赖 Task 1
