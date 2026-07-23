# Tasks

- [x] Task 1: workflow_engine.start_workflow 初始化首轮澄清并返回结果
  - [x] 1.1 阅读 `workflow_engine.py` start_workflow 现有首轮问题生成逻辑
  - [x] 1.2 改为调用 `clarification_service.start_clarification(workflow.id, user_input)`，完成生成+state初始化+持久化
  - [x] 1.3 将首轮 ClarifyResult 暴露给调用方（暂存到 workflow._clarify_result 临时属性）

- [x] Task 2: hermes_service 工作流路由 yield clarify_questions + except return
  - [x] 2.1 工作流成功路径：在 done 前用 `_format_clarify_result_for_sse(首轮结果)` yield `clarify_questions` 事件
  - [x] 2.2 事件顺序：text(引导) → workflow_started → clarify_questions → done
  - [x] 2.3 except 分支末尾补 `return`，避免 fall-through

- [x] Task 3: 移除 SSE reader.cancel()
  - [x] 3.1 `useApi.ts` 的 done 分支移除 `await reader.cancel()`，仅 onDone + return
  - [x] 3.2 error 分支移除 `await reader.cancel()`，仅 onError + return
  - [x] 3.3 保留 AbortError 识别与静默处理

- [x] Task 4: 验证
  - [x] 4.1 后端 Python 语法编译通过
  - [x] 4.2 端到端验证：事件序列含 clarify_questions（含 options），顺序正确，done 在末尾
  - [x] 4.3 前端诊断检查（useApi.ts 无错误）
  - [x] 4.4 确认 ERR_ABORTED 不再由 reader.cancel 产生（已移除）
  - [x] 4.5 清理临时文件（无临时文件产生）

# Task Dependencies
- Task 2 依赖 Task 1（需要 start_workflow 返回首轮结果）
- Task 3 独立，可与 Task 1/2 并行
- Task 4 依赖 Task 1-3
