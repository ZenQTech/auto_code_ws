# Checklist

## execute_streaming 进程引用
- [x] `execute_streaming()` 创建子进程后立即 `self._current_process = process`
- [x] `execute_streaming()` 的 finally 块清理 `self._current_process = None`
- [x] 异常路径（如超时）也清理进程引用

## 停止生成全链路
- [x] 前端 `handleStop` 调用 `AbortController.abort()` + `fetch('/api/hermes/stop')`
- [x] 后端 `POST /api/hermes/stop` 调用 `hermes_executor.cancel()`
- [x] `cancel()` 找到 `_current_process` 并 `process.kill()`
- [x] 子进程被 SIGKILL 终止
- [x] SSE 流停止推送新事件

## 验证
- [x] Python 语法编译通过
- [x] 无临时文件
