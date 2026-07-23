# 修复 Shell 命令中反引号注入导致 EOF in backquote substitution 错误

## Why
工作流引擎在"需求澄清阶段"将用户输入嵌入 shell 命令时，仅转义了双引号（`"`），未转义反引号（`` ` ``）和 `$()` 等 shell 元字符。当用户输入包含未闭合的反引号时，`/bin/sh -c` 将其解析为命令替换，导致 `Syntax error: EOF in backquote substitution` 错误，工作流直接失败。

## What Changes
- 在所有将用户输入嵌入 shell 命令字符串的位置，增加反引号和 `$` 符号的转义
- 涉及文件：
  - `hermes_integration/hermes_executor.py` - `chat()`、`chat_streaming()`、`optimize_prompt()` 
  - `backend/app/services/hermes_service.py` - `_build_chat_command()`、`_build_optimize_command()`、`_build_plan_command()`
  - `backend/app/services/prompt_optimizer.py` - `_build_optimize_command()`
  - `backend/app/services/task_planner.py` - `_build_plan_command()`
  - `backend/app/services/validator.py` - `_build_validation_command()`
  - `backend/app/services/agent_roles/` 下所有调用 `execute(command=...)` 的文件

## Impact
- Affected specs: loop-engineering-workflow-engine, hermes-scheduling-upgrade
- Affected code: 上述所有文件

## ADDED Requirements
### Requirement: Shell 命令输入安全转义
系统 SHALL 在将用户输入嵌入 `asyncio.create_subprocess_shell()` 命令字符串前，转义反引号（`` ` `` → `\``）和美元符号（`$` → `\$`），防止 shell 命令替换注入。

#### Scenario: 用户输入含反引号时工作流正常执行
- **WHEN** 用户在需求描述中包含反引号字符（如 `` ` ``）
- **THEN** shell 命令正常执行，不触发 `EOF in backquote substitution` 错误

#### Scenario: 用户输入含 `$()` 时不被解析为命令替换
- **WHEN** 用户输入包含 `$(command)` 语法
- **THEN** `$` 被转义为 `\$`，不被 shell 解析为命令替换
