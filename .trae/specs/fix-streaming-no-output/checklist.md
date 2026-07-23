# Checklist

## 命令格式
- [x] `chat_streaming` 不再使用 `-p` 参数
- [x] 有 system_prompt 时拼接进 `chat -q` 的 query
- [x] 无 system_prompt 时使用 `chat -q "{message}"`
- [x] 移除 `-Q` 静默模式

## 验证
- [x] Python 语法编译通过
- [x] 实测 `hermes --yolo chat -q "你好"` 有非空输出
- [x] 发送消息后前端有内容显示（端到端测试 text 事件数=1, done=True）
- [x] 无临时文件
