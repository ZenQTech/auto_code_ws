# 流式思考与实时输出 Spec

## Why
当前平台所有 Hermes 对话均为阻塞式请求-响应模式：用户发送消息后需等待 CLI 完全执行完毕才能看到完整回复，期间仅显示跳动圆点动画。用户无法看到 Hermes 的思考过程，也无法感知输出进度。需要引入流式输出机制，让思考过程可折叠展示、输出实时可见、状态动态反馈。

## What Changes
- CLI 执行器从 `process.communicate()` 阻塞模式改为逐行流式读取
- Hermes 执行器新增流式执行方法，支持实时回调
- 后端新增 SSE（Server-Sent Events）流式 API 端点
- 前端对话界面支持实时流式渲染，消息内容逐字追加
- 新增思考过程折叠/展开组件，思考内容可交互查看
- 新增输出状态指示器（思考中 / 回答中 / 回答完成）
- 思考中状态显示动态旋转/脉冲动画
- 回答中状态显示逐字输出效果 + 闪烁光标
- 回答完成状态显示完成标记

## Impact
- Affected specs: hermes-scheduling-upgrade（对话流程）、frontend-beautification（UI 交互）
- Affected code: cli_integration/executor.py, hermes_integration/hermes_executor.py, backend/app/services/hermes_service.py, backend/app/api/hermes.py, frontend/src/App.tsx, frontend/src/hooks/useApi.ts, frontend/src/components/*

---

## ADDED Requirements

### Requirement: CLI 流式输出执行
CLI 执行器 SHALL 支持流式读取子进程输出，逐行回调而非等待进程完全结束。

#### Scenario: 流式执行命令
- **WHEN** 调用流式执行方法
- **THEN** 每读取到一行 stdout 输出，立即通过回调函数传递该行内容
- **AND** 进程结束后通过回调传递完成信号

#### Scenario: 流式执行超时
- **WHEN** 流式执行超过超时时间
- **THEN** 终止子进程并通过回调传递超时错误

---

### Requirement: Hermes 流式对话
Hermes 执行器 SHALL 提供流式对话方法，支持实时输出思考过程和回答内容。

#### Scenario: 流式对话
- **WHEN** 用户发送消息
- **THEN** Hermes 的思考过程（thinking）和回答内容（text）以流式方式逐块返回
- **AND** 思考内容标记为 `thinking` 类型，回答内容标记为 `text` 类型

#### Scenario: 思考内容识别
- **WHEN** Hermes 输出包含思考标记（如 `<think>` 标签或特定格式）
- **THEN** 思考内容被识别并标记为 thinking 类型
- **AND** 非思考内容标记为 text 类型

---

### Requirement: SSE 流式 API 端点
后端 SHALL 提供 SSE 流式 API 端点，支持服务器向客户端实时推送 Hermes 输出。

#### Scenario: 流式对话请求
- **WHEN** 客户端发起 SSE 流式对话请求
- **THEN** 服务端建立 SSE 连接，持续推送 `thinking`、`text`、`done`、`error` 事件
- **AND** 每个事件包含 `type` 和 `content` 字段

#### Scenario: 流式对话完成
- **WHEN** Hermes 输出全部完成
- **THEN** 服务端发送 `done` 事件并关闭 SSE 连接

#### Scenario: 流式对话错误
- **WHEN** 执行过程中发生错误
- **THEN** 服务端发送 `error` 事件（含错误信息）并关闭连接

---

### Requirement: 前端实时流式渲染
前端对话界面 SHALL 支持实时流式渲染 Hermes 输出，消息内容逐步追加显示。

#### Scenario: 流式消息接收
- **WHEN** 前端收到 SSE 流式数据块
- **THEN** 消息内容实时追加到对应的 Hermes 消息气泡中
- **AND** 用户无需刷新即可看到内容逐步增长

#### Scenario: 流式消息状态
- **WHEN** 消息处于流式接收中
- **THEN** 消息气泡显示"回答中"状态指示器
- **WHEN** 流式接收完成
- **THEN** 状态指示器切换为"回答完成"

---

### Requirement: 思考过程可折叠展示
Hermes 的思考过程 SHALL 以可折叠/展开的方式展示在消息气泡中。

#### Scenario: 思考过程默认折叠
- **WHEN** Hermes 消息包含思考内容
- **THEN** 思考内容默认折叠，显示"思考中..."或"思考过程"标题及展开按钮

#### Scenario: 展开思考过程
- **WHEN** 用户点击展开按钮
- **THEN** 思考内容展开显示，带平滑过渡动画
- **AND** 展开按钮变为收起按钮

#### Scenario: 思考过程实时更新
- **WHEN** 思考内容仍在流式接收中
- **THEN** 折叠区域内的思考内容实时追加更新
- **AND** 标题显示"思考中..."带动态动画

---

### Requirement: 输出状态动态指示
对话界面 SHALL 显示 Hermes 当前的输出状态，包含动态视觉效果。

#### Scenario: 思考中状态
- **WHEN** Hermes 正在输出思考内容
- **THEN** 消息气泡顶部显示"思考中..."标签，带旋转或脉冲动画图标

#### Scenario: 回答中状态
- **WHEN** Hermes 正在输出回答内容
- **THEN** 消息气泡顶部显示"回答中..."标签，消息末尾显示闪烁光标

#### Scenario: 回答完成状态
- **WHEN** Hermes 输出全部完成
- **THEN** 状态标签切换为"回答完成"，带完成勾选图标，闪烁光标消失

---

## MODIFIED Requirements

### Requirement: Hermes 对话流程（来自 hermes-scheduling-upgrade）
对话流程 SHALL 支持流式输出模式：
- 用户发送消息后，前端立即创建空的 Hermes 消息占位
- 后端通过 SSE 实时推送思考过程和回答内容
- 前端实时渲染流式内容，显示动态状态指示器
- 思考过程可折叠/展开
- 保留原有非流式 JSON API 作为降级方案
