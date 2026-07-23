# Tasks

- [x] Task 1: 修复 execute_streaming 未保存进程引用
  - [x] 1.1 在 `cli_integration/base_executor.py` 的 `execute_streaming()` 中，子进程创建后立即 `self._current_process = process`
  - [x] 1.2 在 `execute_streaming()` 的 finally 块中清理 `self._current_process = None`
  - [x] 1.3 验证取消流程：fetch abort + /api/hermes/stop + process.kill() 全链路

- [x] Task 2: 验证
  - [x] 2.1 Python 语法编译通过
  - [x] 2.2 验证 _current_process 在流式路径被正确保存
  - [x] 2.3 验证 cancel() 能终止流式子进程
  - [x] 2.4 清理临时文件
