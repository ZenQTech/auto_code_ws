# Checklist

## RequirementClarifier 增强
- [x] `clarify()` 输出结构化 JSON（questions、clarification_complete、missing_dimensions）
- [x] `clarify_round()` 支持多轮对话，接收对话历史
- [x] `generate_requirement_doc()` 使用结构化对话历史生成需求文档
- [x] `_parse_clarify_response()` 正确解析 JSON 输出

## ClarificationService 桥接
- [x] `start_clarification()` 生成首轮澄清问题并持久化
- [x] `handle_user_response()` 处理用户回复并生成下一轮问题
- [x] `is_clarification_complete()` 正确判定澄清是否完成
- [x] `finalize_requirement_doc()` 汇总生成需求文档并写入 Workflow

## HermesService Prompt 切换
- [x] `_build_chat_command()` 接受 session_id 参数
- [x] clarifying 阶段使用 REQUIREMENT_CLARIFIER_SYSTEM_PROMPT
- [x] 非 clarifying 阶段使用原有通用 prompt
- [x] 用户消息正确路由到 ClarificationService

## API 端点
- [x] `POST /api/hermes/clarify/respond` 返回 SSE 流式响应
- [x] `GET /api/workflow/{id}/clarify/questions` 返回当前问题列表
- [x] `POST /api/workflow/{id}/clarify/confirm` 确认需求文档

## 前端 UI
- [x] `ClarificationCard` 组件正确渲染结构化澄清问题
- [x] `ClarificationProgress` 显示当前轮次和进度
- [x] `App.tsx` 在 clarifying 阶段渲染澄清 UI
- [x] `MessageBubble` 支持澄清问题特殊渲染
- [x] 需求文档确认按钮和预览模态框正常工作

## WorkflowEngine 集成
- [x] `Workflow` 模型包含 clarification_questions、clarification_round、clarification_complete
- [x] `start_workflow()` 自动调用 ClarificationService
- [x] `confirm_stage("clarifying")` 校验 requirement_doc 非空
- [x] `validate_stage_boundary()` 包含 clarification_complete 检查

## 集成测试
- [x] ClarificationService 单元测试通过
- [x] Prompt 切换测试通过
- [x] 前后端联调 SSE 流式 + 多轮对话通过
- [x] 全量回归测试通过
- [x] 测试脚本已清理
