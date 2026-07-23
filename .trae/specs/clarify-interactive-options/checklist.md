# Checklist

## SSE ERR_ABORTED 修复
- [x] `done` 事件 return 前调用 `await reader.cancel()`
- [x] `error` 事件 return 前调用 `await reader.cancel()`
- [x] cancel 用 try/catch 包裹
- [x] 浏览器控制台不再出现 `net::ERR_ABORTED`（reader 正常释放）

## 后端 options 支持
- [x] `ClarifyResult` 合并为单一定义（无重复，仅 1 处 class 定义）
- [x] `ClarificationQuestion` 含 `options` 和 `allow_multiple` 字段
- [x] `REQUIREMENT_CLARIFIER_SYSTEM_PROMPT` 要求输出 2-4 个 options
- [x] `_parse_clarify_response` 解析 options
- [x] `clarification_service` 透传 options
- [x] `_format_clarify_result_for_sse` 输出 `clarify_questions` 结构化事件

## 前端交互式卡片
- [x] `useApi.ts` 解析 `clarify_questions` 事件（onClarifyQuestions 回调）
- [x] `ClarificationCard` 渲染选项按钮（单选/多选）
- [x] 每个问题始终提供"其他（自由输入）"项
- [x] 提交时汇总结构化回答（onSubmit）
- [x] `App.tsx` 消费结构化事件

## workflowStatus 修复
- [x] `setWorkflowStatus` 被正确调用赋值（session detail + workflow_started 事件双路径）
- [x] clarifying 分流逻辑生效

## 验证
- [x] 后端 Python 语法编译通过
- [x] 前端诊断检查通过（无错误）
- [x] ERR_ABORTED 修复确认
- [x] 澄清问题以选项卡片呈现（端到端事件验证通过）
- [x] 无临时文件
