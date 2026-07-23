# Hermes 工作流路由与交互体验修复 Spec

## Why
平台存在 4 个关键问题导致用户体验断裂：① 流式对话使用 `chat -q` 模式，Hermes CLI 不输出 thinking 标签，导致前端看不到思考过程；② 停止按钮仅修改 UI 状态，无 AbortController 中断请求，也无后端子进程取消机制；③ 聊天端点将用户消息直接转发给 Hermes CLI 自由对话，完全绕过 WorkflowEngine 的 SOP 流程，导致 Hermes 直接写代码而非按工作流执行；④ App.tsx 向 BrandHeader 传递已删除的 `appMode` prop 导致 TypeScript 编译错误。

## What Changes
- 修改 `HermesExecutor.chat_streaming()` 命令格式，`chat -q` → `-p` 模式，确保 CLI 输出 thinking 标签
- 前端 `chatWithHermesStreaming` 引入 `AbortController`，`handleStop` 调用 abort
- 后端 `BaseCLIExecutor` 新增 `cancel()` 方法，通过 `process.kill()` 终止子进程
- `HermesService` 新增开发需求自动检测与 WorkflowEngine 路由：coding 模式下检测到开发需求时自动调用 `start_workflow`
- 删除 `App.tsx` 中 BrandHeader 的 `appMode` prop 透传

## Impact
- Affected specs: workflow-sop-full-implementation, fix-clarification-interaction
- Affected code:
  - `hermes_integration/hermes_executor.py` - 修改 chat_streaming 命令格式
  - `cli_integration/base_executor.py` - 新增 cancel() 方法
  - `backend/app/services/hermes_service.py` - 新增开发需求检测 + WorkflowEngine 路由
  - `frontend/src/hooks/useApi.ts` - 引入 AbortController
  - `frontend/src/App.tsx` - 修复 handleStop + 删除 appMode prop

---

## ADDED Requirements

### Requirement: 流式对话输出 Thinking 过程
系统 SHALL 在流式对话中输出 Hermes CLI 的完整思考过程（`<thinking>` 标签内容），前端以可折叠方式展示。

#### Scenario: 流式对话包含 thinking
- **WHEN** 用户发送消息触发流式对话
- **THEN** HermesExecutor 使用 `-p` 模式（含完整 system prompt）调用 CLI
- **AND** CLI 输出中的 `<thinking>...</thinking>` 标签被解析为 thinking 事件
- **AND** thinking 事件通过 SSE 流式推送到前端
- **AND** 前端 ThinkingBlock 组件以可折叠方式渲染思考内容

#### Scenario: Thinking 内容为实时流式
- **WHEN** CLI 输出 thinking 内容
- **THEN** 前端实时追加显示，而非等待 thinking 标签闭合
- **AND** ThinkingBlock 默认折叠，用户可点击展开

### Requirement: 停止生成按钮终止所有生成
系统 SHALL 在用户点击停止生成按钮时，立即终止所有正在进行的 CLI 子进程和网络请求。

#### Scenario: 前端停止按钮
- **WHEN** 用户点击停止生成按钮
- **THEN** 前端调用 `AbortController.abort()` 中断 fetch 请求
- **AND** 前端调用后端停止端点（如 `POST /api/hermes/stop`）
- **AND** 后端终止对应的 CLI 子进程（`process.kill()`）
- **AND** 前端更新 UI 状态为已停止

#### Scenario: 后端子进程终止
- **WHEN** 后端收到停止请求
- **THEN** `BaseCLIExecutor.cancel()` 方法通过 `process.kill()` 终止子进程
- **AND** 子进程的输出流被关闭
- **AND** SSE 流发送 `done` 事件

### Requirement: Coding 模式下自动路由到 WorkflowEngine
系统 SHALL 在 coding 模式下检测到开发需求时，自动启动 WorkflowEngine 的 SOP 流程，而非让 Hermes CLI 自由对话直接写代码。

#### Scenario: 开发需求自动检测
- **WHEN** 用户在 coding 模式下发送消息
- **THEN** `HermesService` 检测消息是否包含开发需求关键词
- **AND** 若为开发需求，自动调用 `WorkflowEngine.start_workflow(session_id, user_input)`
- **AND** 返回工作流启动确认消息，引导用户进入需求澄清阶段
- **AND** 不直接调用 Hermes CLI 生成代码

#### Scenario: 非开发需求保持原有行为
- **WHEN** 用户在 chat 模式下发送消息，或 coding 模式下发送非开发需求消息
- **THEN** 保持原有流式对话行为，直接调用 Hermes CLI

---

## FIXED Requirements

### Requirement: BrandHeader TypeScript 类型修复
**问题**: `App.tsx` 向 `BrandHeader` 传递 `appMode` prop，但该 prop 已在 v1.3.0 中删除。
**修复**: 从 `App.tsx` 中删除 `appMode={appMode ?? undefined}` 行。

### Requirement: Thinking 实时流式追加
**问题**: Thinking 内容可能在标签闭合后才一次性展示。
**修复**: 在 SSE 解析中，检测到 `<thinking>` 开始标签后，后续内容实时作为 thinking 事件推送，直到 `</thinking>` 闭合。
