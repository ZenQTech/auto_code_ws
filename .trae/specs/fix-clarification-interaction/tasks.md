# Tasks

- [x] Task 1: RequirementClarifier 增强 - 输出结构化 JSON + 多轮对话支持
  - [x] 1.1 修改 `clarify()` 方法，输出结构化 JSON（含 questions 列表、clarification_complete 标记、missing_dimensions）
  - [x] 1.2 新增 `clarify_round()` 方法，接收对话历史，生成下一轮澄清问题
  - [x] 1.3 修改 `generate_requirement_doc()` 使用结构化对话历史
  - [x] 1.4 新增 `_parse_clarify_response()` 解析 AI 返回的结构化 JSON

- [x] Task 2: 创建 ClarificationService 桥接服务
  - [x] 2.1 创建 `backend/app/services/clarification_service.py`
  - [x] 2.2 实现 `start_clarification(workflow_id, user_input)` - 生成首轮问题
  - [x] 2.3 实现 `handle_user_response(workflow_id, user_message)` - 处理用户回复，生成下一轮问题
  - [x] 2.4 实现 `is_clarification_complete(workflow_id)` - 判定澄清是否完成
  - [x] 2.5 实现 `finalize_requirement_doc(workflow_id)` - 汇总生成需求文档

- [x] Task 3: HermesService 阶段感知 Prompt 切换
  - [x] 3.1 修改 `_build_chat_command()`，新增 session_id 参数
  - [x] 3.2 查询 Session 的 workflow_stage，若为 "clarifying" 则使用 REQUIREMENT_CLARIFIER_SYSTEM_PROMPT
  - [x] 3.3 clarifying 模式下，用户消息路由到 ClarificationService.handle_user_response()
  - [x] 3.4 修改 `chat_with_hermes_streaming()` 传递 session_id

- [x] Task 4: 新增 API 端点
  - [x] 4.1 `POST /api/hermes/clarify/respond` - 接收用户澄清回复，返回 Agent 回复（SSE 流式）
  - [x] 4.2 `GET /api/workflow/{id}/clarify/questions` - 获取当前澄清问题列表
  - [x] 4.3 `POST /api/workflow/{id}/clarify/confirm` - 用户确认需求文档

- [x] Task 5: 前端交互式需求澄清 UI
  - [x] 5.1 创建 `frontend/src/components/ClarificationCard.tsx` - 澄清问题结构化卡片组件
  - [x] 5.2 创建 `frontend/src/components/ClarificationProgress.tsx` - 澄清进度指示器
  - [x] 5.3 修改 `App.tsx`，在 clarifying 阶段渲染澄清 UI 替代纯文本聊天
  - [x] 5.4 修改 `MessageBubble.tsx`，支持澄清问题的特殊渲染
  - [x] 5.5 实现"确认需求文档"按钮和需求文档预览模态框

- [x] Task 6: WorkflowEngine + models 集成
  - [x] 6.1 `Workflow` 模型新增 `clarification_questions`（JSON）、`clarification_round`（Integer）、`clarification_complete`（Boolean）
  - [x] 6.2 修改 `start_workflow()`，启动时调用 ClarificationService.start_clarification()
  - [x] 6.3 修改 `confirm_stage("clarifying")`，确认前校验 requirement_doc 非空
  - [x] 6.4 修改 `validate_stage_boundary()` clarifying→designing 增加 clarification_complete 检查

- [x] Task 7: 集成测试与验证
  - [x] 7.1 编写 ClarificationService 单元测试
  - [x] 7.2 编写阶段感知 Prompt 切换测试
  - [x] 7.3 编写前后端联调测试（SSE 流式 + 多轮对话）
  - [x] 7.4 全量回归测试
  - [x] 7.5 清理测试脚本

# Task Dependencies
- Task 2 依赖 Task 1（ClarificationService 调用增强后的 RequirementClarifier）
- Task 3 依赖 Task 2（HermesService 调用 ClarificationService）
- Task 4 依赖 Task 3（API 端点调用 HermesService）
- Task 5 依赖 Task 4（前端调用 API 端点）
- Task 6 可与 Task 1-4 并行（纯数据模型和 WorkflowEngine 修改）
- Task 7 依赖 Task 1-6
