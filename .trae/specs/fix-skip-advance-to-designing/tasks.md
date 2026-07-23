# Tasks

- [x] Task 1: 前端统一"跳过不确定项"选项到确认推进路径
  - 在 `frontend/src/components/ClarificationCard.tsx` 的 `handleSubmit` 中，汇总答案后判断任一选中项文本是否包含"跳过不确定项"
  - 若包含：调用 `onConfirm?.(workflowId)`（不设 `submitted`、不调用 `onSubmit`），使其走 `/clarify/confirm` → 架构设计路径
  - 若不包含：保持原有 `onSubmit(answersText)` 逻辑不变
  - 同步更新文件头修改记录与函数注释
  - **验证**：勾选"跳过不确定项"选项并提交时，仅触发 `POST /clarify/confirm`，不触发 `POST /hermes/chat/stream`

- [x] Task 2: 后端 confirm_stage("clarifying") 空文档兜底
  - 在 `backend/app/services/workflow_engine.py` 的 `confirm_stage("clarifying")` 中，当 `requirement_doc` 为空时，先调用 `self.clarification_service.finalize_requirement_doc(workflow_id)` 生成文档并 refresh，再继续原推进逻辑
  - 仅当 finalize 后 `requirement_doc` 仍为空才返回 `{"success": False, ...}`
  - 需确认 `WorkflowEngine` 已持有 `clarification_service` 引用；若无则退回原有失败返回（不引入新依赖）
  - 同步更新文件头修改记录
  - **验证**：`requirement_doc` 为空时点击跳过确认，工作流成功推进到 `designing`

- [x] Task 3: 重新构建前端产物
  - 在 `frontend/` 执行构建，刷新 `frontend/dist`，确保后端 StaticFiles 提供最新 bundle
  - **验证**：`frontend/dist` 产物 mtime 更新，无构建错误

# Task Dependencies
- Task 1 与 Task 2 无依赖，可并行执行
- Task 3 依赖 Task 1 完成
