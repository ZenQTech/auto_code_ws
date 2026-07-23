# Checklist

## Thinking 输出
- [x] `chat_with_hermes_streaming` 调用 `chat_streaming` 时传入 `system_prompt`
- [x] `_build_chat_command` 被调用以提取 system prompt
- [x] -p 模式 prompt 长度限制 < 1500 字符
- [x] 前端能看到折叠的 ThinkingBlock 内容

## 验证
- [x] Python 语法编译通过
- [x] 短消息不会因 prompt 过长导致处理慢
- [x] 无临时文件
