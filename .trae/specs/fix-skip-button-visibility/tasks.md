# Tasks

- [x] Task 1: 修复 ClarificationCard 跳过按钮显示条件
  - 在 `ClarificationCard.tsx` 的「空状态」区域（`questions.length === 0 && !isComplete`），当 `roundNumber >= 3` 时显示「跳过不确定项，进入架构设计」按钮
  - 同时保留原有 `roundNumber >= 6` 条件下在问题列表中的跳过按钮
  - **验证**：round 3-5 且 questions=0 时可见跳过按钮，点击后正常进入架构设计

- [x] Task 2: 修复 onConfirm 回调静默失败
  - `onConfirm` 使用 `workflowStatus?.workflow_id` 但该值可能为 null（闭包过期 / 状态未加载）
  - 改为 `sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id` 双重回退
  - **验证**：点击跳过按钮时 workflow_id 始终可用，API 调用不静默失败

# Task Dependencies
- 无依赖，两个文件各自修改
