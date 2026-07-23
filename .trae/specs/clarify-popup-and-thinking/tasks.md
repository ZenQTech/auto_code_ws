# Tasks
- [x] Task 1: 后端 - 确认 `clarify_questions` SSE 事件完整发送
  - [x] 1.1 确认 `_format_clarify_result_for_sse` 同时发送 `text`（含 summary/思考过程）和 `clarify_questions`（结构化数据）
  - [x] 1.2 确认首轮（`start_workflow`）和第二轮（`handle_user_response`）均正确发送
  - [x] 1.3 v2.7.0: 流式方法也增加 `not is_clarifying_mode` 守卫
- [x] Task 2: 前端 - `ClarificationCard` 改造为独立模态弹窗
  - [x] 2.1 创建 `ClarificationModal` 组件（半透明遮罩 + 居中卡片 + 点击遮罩不关闭）
  - [x] 2.2 将 `ClarificationCard` 嵌入 `ClarificationModal`
  - [x] 2.3 提交成功后关闭弹窗，恢复聊天交互
- [x] Task 3: 前端 - 澄清阶段思考过程展示
  - [x] 3.1 后端 `_format_clarify_result_for_sse` 发送 `thinking` 事件（含分析过程）
  - [x] 3.2 前端 ThinkingBlock 接收 `thinking` 事件并展示（已有逻辑）
- [x] Task 4: 前端 - `App.tsx` 弹窗渲染与状态管理
  - [x] 4.1 新增 `showClarifyModal` state
  - [x] 4.2 `handleClarifyQuestions` 中设置弹窗显隐
  - [x] 4.3 提交/确认/继续后关闭弹窗
- [x] Task 5: 验证 - 后端语法检查通过，所有文件修改到位

# Task Dependencies
- Task 2 依赖 Task 1（确认数据源正确）
- Task 3 依赖 Task 1
- Task 4 依赖 Task 2、Task 3
- Task 5 依赖 Task 1-4
