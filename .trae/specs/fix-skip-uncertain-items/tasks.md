# Tasks

- [x] Task 1: 修复后端 confirm_stage("clarifying") 允许跳过不确定项
  - 在 `workflow_engine.py` 的 `confirm_stage("clarifying")` 中，将 `clarification_complete` 检查从硬错误改为自动补全
  - 当 `clarification_complete=False` 时自动设为 `True`（用户显式跳过），而非返回错误
  - 保留 `requirement_doc` 非空检查（必须已有需求文档才能推进）
  - **验证**：`clarification_complete=False` 时确认请求成功推进到 designing

- [x] Task 2: 修复前端 onConfirm 回调检查 API 响应
  - 在 `App.tsx` 的两个 `onConfirm` 回调中，检查 `clarify/confirm` API 返回的 JSON
  - 仅当 `response.success === true` 时才关闭弹窗并调用 `handleStartDesignPhase()`
  - 失败时保持弹窗打开，可增加 toast 提示
  - **验证**：API 返回失败时不关闭弹窗、不触发 `handleStartDesignPhase`

# Task Dependencies
- Task 1 和 Task 2 无依赖关系，可并行执行
