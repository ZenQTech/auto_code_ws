# 首轮澄清问题推送与 SSE ABORTED 终极修复 Spec

## Why
三个关联问题：① coding 模式启动工作流后，首轮澄清问题虽已写入数据库（`workflow.clarification_questions`），但 `chat_with_hermes_streaming` 的成功路径只 yield 了 `text`+`workflow_started`+`done` 三个事件，**没有 yield `clarify_questions` 结构化事件**，导致前端 ClarificationCard 永不渲染；② start_workflow 异常分支无 `return`，fall-through 到普通对话，而此时 session 已切到 clarifying 阶段，`_build_chat_command` 用澄清 Prompt 让 LLM **自由生成纯文本"Phase 1"问题列表**（用户截图现象）；③ 上一轮为"消除 ABORTED"加的 `reader.cancel()` 方向反了——`cancel()` 语义是客户端主动中止流，在后端连接未自然 EOF 时恰恰制造 `net::ERR_ABORTED`。`cleanup-empty` 的 ABORTED 是页面卸载正常现象，无害。

## What Changes
- `workflow_engine.start_workflow` 改用 `clarification_service.start_clarification()` 初始化首轮澄清（生成问题 + 初始化内存 state + 持久化），并返回首轮 ClarifyResult
- `chat_with_hermes_streaming` 工作流成功路径：在 `done` 前 yield `clarify_questions` 结构化事件（复用 `_format_clarify_result_for_sse`）
- `chat_with_hermes_streaming` 异常分支补 `return`，避免 fall-through 到 LLM 自由回复
- `useApi.ts` 移除 `done`/`error` 分支的 `reader.cancel()`，改为让流自然结束（保留 AbortError 处理）
- 可选优化 `cleanup-empty`：改用 `navigator.sendBeacon`（POST），消除卸载噪音

## Impact
- Affected specs: clarify-interactive-options, fix-streaming-no-output, fix-clarification-interaction
- Affected code:
  - `backend/app/services/workflow_engine.py` - start_workflow 用 start_clarification + 返回首轮结果
  - `backend/app/services/hermes_service.py` - 工作流路由 yield clarify_questions + except return
  - `frontend/src/hooks/useApi.ts` - 移除 reader.cancel()
  - `frontend/src/App.tsx` + `backend/app/api/sessions.py` - cleanup-empty 改 sendBeacon/POST（可选）

---

## ADDED Requirements

### Requirement: 首轮澄清问题以结构化事件推送
系统 SHALL 在 coding 模式启动工作流后，将首轮澄清问题作为 `clarify_questions` 结构化事件推送给前端，使 ClarificationCard 立即渲染为选项卡片。

#### Scenario: 工作流启动推送首轮问题
- **WHEN** coding 模式检测到开发需求并成功启动工作流
- **THEN** start_workflow 通过 ClarificationService 生成首轮澄清问题（含 options）
- **AND** SSE 事件序列为：`text`(引导消息) → `workflow_started` → `clarify_questions`(含 options) → `done`
- **AND** 前端 `onClarifyQuestions` 回调收到结构化问题
- **AND** ClarificationCard 渲染为可选项卡片，而非纯文本

#### Scenario: ClarificationService 状态初始化
- **WHEN** start_workflow 初始化澄清
- **THEN** 调用 `clarification_service.start_clarification(workflow_id, user_input)`
- **AND** ClarificationService._states 中存在该 workflow 的 ClarificationState（round=1）
- **AND** 后续 handle_user_response 能正确延续多轮对话

### Requirement: 异常分支不 fall-through
系统 SHALL 在工作流启动失败时正确终止生成器，避免 fall-through 到普通对话导致 LLM 用澄清 Prompt 自由生成纯文本问题。

#### Scenario: 工作流启动失败
- **WHEN** start_workflow 抛出异常
- **THEN** yield 失败提示 text 事件后立即 `return`
- **AND** 不继续执行普通流式对话流程

### Requirement: 消除 SSE 主动中止
系统 SHALL 让 SSE 流自然结束，不主动调用 `reader.cancel()`，避免产生 `net::ERR_ABORTED`。

#### Scenario: done 事件自然结束
- **WHEN** 前端收到 `{"type":"done"}` 事件
- **THEN** 调用 `onDone()` 后 `return`（不调用 reader.cancel）
- **AND** 后端关闭连接时 `reader.read()` 自然返回 `{done:true}`
- **AND** 浏览器不再记录 `net::ERR_ABORTED`

#### Scenario: 用户主动停止保留 abort
- **WHEN** 用户点击停止按钮
- **THEN** `handleStop` 仍通过 AbortController.abort() 中止
- **AND** AbortError 被识别并静默处理（保留现有行为）

---

## MODIFIED Requirements

### Requirement: cleanup-empty 卸载请求（可选优化）
**原行为**: `beforeunload` 中 `fetch(cleanup-empty, {method:'DELETE', keepalive:true})`，页面卸载时被浏览器中止，DevTools 记录 ERR_ABORTED（无害）。
**新行为（可选）**: 改用 `navigator.sendBeacon`（需后端 cleanup-empty 支持 POST），消除卸载噪音。若实现成本高可保留现状（不影响功能）。
