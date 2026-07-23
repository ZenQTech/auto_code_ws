# Thinking 过程不可见与对话超时修复 Spec

## Why
用户输入"深度学习"后等待 120 秒后超时，但 `chat_with_hermes_streaming` 调用 `hermes_executor.chat_streaming()` 时**未传递 `system_prompt` 参数**（第 437-440 行），导致命令降级为 `chat -q` 模式，Hermes CLI 不输出 `<thinking>` 标签，前端 `ThinkingBlock` 始终折叠但无内容。同时 `chat -q` 模式下 CLI 输出含大量冗余内容（如完整的"安全红线"/"物流标准"/"安全验收" 等详细规范），导致响应超时。

## What Changes
- 修改 `chat_with_hermes_streaming()`，通过 `_build_chat_command()` 获取 system prompt，并将其传给 `hermes_executor.chat_streaming()`
- 优化 `chat_streaming()` 的 `-p` 模式构建逻辑，避免 prompt 过长导致 CLI 处理慢
- 在 `chat_streaming()` 调用时设置更长的超时（300s）

## Impact
- Affected specs: fix-hermes-workflow-ux
- Affected code:
  - `backend/app/services/hermes_service.py` - 修复 system_prompt 传递
  - `hermes_integration/hermes_executor.py` - 优化 -p 模式构建

---

## ADDED Requirements

### Requirement: 流式对话正确传递 system_prompt
系统 SHALL 在 `chat_with_hermes_streaming()` 中从 `_build_chat_command()` 提取 system prompt，传递给 `hermes_executor.chat_streaming()` 的 `system_prompt` 参数，确保使用 `-p` 模式输出 thinking 标签。

#### Scenario: 正常对话触发 thinking 输出
- **WHEN** 用户在 chat 或 coding 模式下发送消息
- **THEN** `chat_with_hermes_streaming` 调用 `_build_chat_command()` 提取 system_prompt
- **AND** 将 system_prompt 传递给 `hermes_executor.chat_streaming(system_prompt=...)`
- **AND** CLI 使用 `-p` 模式输出 `<thinking>` 标签
- **AND** 前端 ThinkingBlock 正确折叠展示思考内容

#### Scenario: 短消息不超时
- **WHEN** 短消息（如"深度学习"）触发流式对话
- **THEN** 命令构建快速（<1s）
- **AND** CLI 在合理时间内（<60s）返回 thinking + text
- **AND** 前端实时显示

### Requirement: -p 模式 prompt 长度控制
系统 SHALL 在 `-p` 模式下，system prompt 长度控制在合理范围（<2000 字符），避免 CLI 处理过慢。

#### Scenario: system prompt 过长截断
- **WHEN** `_build_chat_command()` 返回的 system prompt 超过 2000 字符
- **THEN** 仅保留前 2000 字符（保留通用 system 角色说明）
- **AND** CLI 处理时间 < 60s

---

## FIXED Requirements

### Requirement: chat_streaming system_prompt 传递
**问题**: `chat_with_hermes_streaming` 调用 `chat_streaming()` 时未传 `system_prompt` 参数。
**修复**: 从 `_build_chat_command()` 提取 system_prompt，传递给 `chat_streaming(system_prompt=...)`。
