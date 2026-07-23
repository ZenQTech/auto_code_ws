# Tasks

- [x] Task 1: 修复 SSE ERR_ABORTED（前端 reader 释放）
  - [x] 1.1 `useApi.ts` 的 `chatWithHermesStreaming` 在 `done` 事件 return 前调用 `await reader.cancel()`
  - [x] 1.2 `error` 事件 return 前同样调用 `await reader.cancel()`
  - [x] 1.3 用 try/catch 包裹 cancel，避免 cancel 自身报错

- [x] Task 2: 后端澄清问题支持 options
  - [x] 2.1 `requirement_clarifier.py` 合并重复的 `ClarifyResult` dataclass 为单一定义
  - [x] 2.2 `ClarificationQuestion` 新增 `options: List[str]` 和 `allow_multiple: bool` 字段
  - [x] 2.3 更新 `REQUIREMENT_CLARIFIER_SYSTEM_PROMPT`，要求每个问题输出 2-4 个候选 options，JSON 格式含 options
  - [x] 2.4 `_parse_clarify_response` 解析 options 和 allow_multiple

- [x] Task 3: 澄清服务与 SSE 透传 options
  - [x] 3.1 `clarification_service.py` 的 question dict 与序列化补充 options/allow_multiple
  - [x] 3.2 `hermes_service.py` 的 `_format_clarify_result_for_sse` 新增 `clarify_questions` 结构化事件（含 options），保留 Markdown 文本降级

- [x] Task 4: 前端交互式选择卡片
  - [x] 4.1 `useApi.ts` 解析 `clarify_questions` 事件，新增 `onClarifyQuestions` 回调
  - [x] 4.2 `ClarificationCard.tsx` 改造：每个问题渲染选项按钮（单选/多选）+ "其他（自由输入）"项
  - [x] 4.3 `ClarificationCard` 新增提交逻辑：汇总所有问题回答为结构化文本
  - [x] 4.4 `App.tsx` 消费 `clarify_questions` 事件，更新 clarificationData

- [x] Task 5: 修复 workflowStatus 赋值
  - [x] 5.1 `App.tsx` 在会话加载/消息发送后拉取工作流状态并 `setWorkflowStatus`
  - [x] 5.2 验证 clarifying 分流生效（后端透传 workflow_id/workflow_stage + workflow_started 事件）

- [x] Task 6: 验证
  - [x] 6.1 前端诊断检查（ClarificationCard/App.tsx/useApi.ts 均无错误）
  - [x] 6.2 后端 Python 语法编译通过
  - [x] 6.3 ERR_ABORTED 修复确认（reader.cancel 已就位）
  - [x] 6.4 端到端验证 clarify_questions 结构化事件（options/allow_multiple 正确）
  - [x] 6.5 清理临时文件（无临时文件产生）

# Task Dependencies
- Task 3 依赖 Task 2（options 字段）
- Task 4 依赖 Task 3（消费 SSE 事件）
- Task 5 与 Task 1-4 可并行
- Task 6 依赖 Task 1-5
