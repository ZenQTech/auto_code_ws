# Tasks

- [x] Task 1: 修正 chat_streaming 命令格式
  - [x] 1.1 修改 `hermes_executor.py`：有 system_prompt 时拼接进 `chat -q` 的 query，移除 `-p`
  - [x] 1.2 移除 `-Q` 静默模式（保留 thinking 等中间输出）
  - [x] 1.3 保留 tirith banner 过滤逻辑，并增强过滤元信息行/装饰框线

- [x] Task 2: 验证
  - [x] 2.1 Python 语法编译通过
  - [x] 2.2 实测 `hermes --yolo chat -q "你好"` 有正常输出
  - [x] 2.3 端到端测试 chat_streaming：text 事件 + done 事件正常，正文干净
  - [x] 2.4 无临时文件
