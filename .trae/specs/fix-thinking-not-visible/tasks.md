# Tasks

- [x] Task 1: 修复 system_prompt 传递
  - [x] 1.1 修改 `hermes_service.py` 中 `chat_with_hermes_streaming` 调用 `chat_streaming` 时传入 `system_prompt`
  - [x] 1.2 从 `_build_chat_command()` 提取 system prompt 内容
  - [x] 1.3 在 `-p` 模式下做长度截断（>1500 字符时截断）
  - [x] 1.4 超时从默认延长到 300s

- [x] Task 2: 验证
  - [x] 2.1 Python 语法编译通过
  - [x] 2.2 无临时文件创建
