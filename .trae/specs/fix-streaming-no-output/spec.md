# 流式对话无输出回归修复 Spec

## Why
发送消息后无任何输出就结束。根因：v2.6.0 修复 thinking 时让 `chat_streaming()` 在有 `system_prompt` 时使用 `hermes -p "..."` 命令，但 **Hermes CLI 根本不支持 `-p` 参数**（`-p` 是 Claude Code CLI 的参数）。实测 `hermes --yolo -p "你好"` 报错 `invalid choice: '你好'` 并立即退出，stdout 为空，导致前端收不到任何 text/thinking 事件。Hermes 的 `chat` 子命令只有 `-q QUERY` 参数，没有独立的 system prompt 参数。

## What Changes
- 修改 `chat_streaming()`，将 `system_prompt` 内容拼接进 `chat -q` 的 query 字符串，而非使用不存在的 `-p` 参数
- 移除 `-Q` 静默模式（quiet 模式会抑制 thinking 等中间输出），保留 banner 过滤逻辑处理噪音

## Impact
- Affected specs: fix-thinking-not-visible, fix-hermes-workflow-ux
- Affected code:
  - `hermes_integration/hermes_executor.py` - 修正 chat_streaming 命令格式

---

## ADDED Requirements

### Requirement: 使用合法的 Hermes CLI 命令格式
系统 SHALL 在 `chat_streaming()` 中使用 Hermes CLI 实际支持的 `chat -q` 命令格式，禁止使用不存在的 `-p` 参数。

#### Scenario: 有 system_prompt 时拼接进 query
- **WHEN** `chat_streaming()` 收到非空 `system_prompt`
- **THEN** 构建命令 `chat -q "{system_prompt}\n\n用户消息：{message}\n\n请用中文回复。"`
- **AND** 不使用 `-p` 参数
- **AND** CLI 正常返回输出（非空 stdout）

#### Scenario: 无 system_prompt 时直接使用 query
- **WHEN** `chat_streaming()` 无 `system_prompt`
- **THEN** 构建命令 `chat -q "{message}"`
- **AND** CLI 正常返回输出

#### Scenario: 发送消息有输出
- **WHEN** 用户在网页发送任意消息
- **THEN** 前端收到至少一个 text 事件
- **AND** 对话内容正常显示，不再"无输出结束"

---

## FIXED Requirements

### Requirement: 移除非法 -p 参数
**问题**: `chat_streaming()` 使用 `hermes -p "..."`，Hermes CLI 不支持该参数，命令立即失败。
**修复**: 改用 `chat -q "{完整内容}"`，将 system_prompt 拼接进 query。
