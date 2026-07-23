# 停止生成按钮无效修复 Spec

## Why
用户点击停止生成按钮后，Hermes 仍在生成内容。根因：`BaseCLIExecutor._current_process` 属性仅在非流式路径 `_run_once()`（第 419 行）中被设置，但流式路径 `execute_streaming()`（第 517 行）创建子进程时**没有保存进程引用**到 `self._current_process`。这导致 `cancel()` 方法在流式路径下永远找不到进程，无法终止 CLI 子进程。同时，`/api/hermes/stop` 端点虽然存在但因找不到进程而静默返回失败。

## What Changes
- 修改 `BaseCLIExecutor.execute_streaming()`，在创建子进程后立即保存到 `self._current_process`，并在 finally 块中清理
- 同时修复 `_run_once()` 中的进程保存逻辑（保险起见增加异常处理）
- 在 `hermes_executor.py` 中也保存进程引用（虽然通过父类继承，但显式更安全）

## Impact
- Affected specs: fix-hermes-workflow-ux, fix-thinking-not-visible
- Affected code:
  - `cli_integration/base_executor.py` - 修复 execute_streaming 的进程保存

---

## ADDED Requirements

### Requirement: 流式执行保存进程引用
系统 SHALL 在 `execute_streaming()` 创建子进程后立即保存到 `self._current_process`，使 `cancel()` 方法能正确终止流式执行中的子进程。

#### Scenario: 流式执行保存进程
- **WHEN** `execute_streaming()` 创建子进程（`asyncio.create_subprocess_shell`）
- **THEN** 立即执行 `self._current_process = process`
- **AND** 在 finally 块中执行 `self._current_process = None`

#### Scenario: cancel() 终止流式子进程
- **WHEN** 用户在前端点击停止按钮
- **THEN** `handleStop` 调用 `AbortController.abort()` 中断前端 fetch
- **AND** 调用 `POST /api/hermes/stop` 端点
- **AND** 后端调用 `hermes_executor.cancel()` → `BaseCLIExecutor.cancel()`
- **AND** `cancel()` 找到 `_current_process` 并调用 `process.kill()`
- **AND** 子进程被终止，SSE 流停止推送新事件

#### Scenario: cancel() 幂等性
- **WHEN** 用户多次点击停止按钮
- **THEN** 后续调用因 `_current_process = None` 返回 False
- **AND** 不抛出异常
