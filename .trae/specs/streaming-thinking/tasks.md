# Tasks

- [x] Task 1: CLI 执行器流式化改造
  - [x] 1.1 在 `cli_integration/executor.py` 中新增 `execute_streaming()` 方法，使用 `readline()` 逐行读取 stdout
  - [x] 1.2 每读取一行立即调用 `stream_callback(line)`，进程结束后调用 `stream_callback(None)` 表示完成
  - [x] 1.3 支持超时控制，超时时终止进程并回调错误

- [x] Task 2: Hermes 执行器流式化改造
  - [x] 2.1 在 `hermes_integration/hermes_executor.py` 中新增 `chat_streaming()` 方法
  - [x] 2.2 实现思考内容识别：检测 ` thinking` XML 标签，将标签内内容标记为 `thinking` 类型，标签外标记为 `text` 类型
  - [x] 2.3 每识别到一个内容块，通过 `stream_callback(type, content)` 回调
  - [x] 2.4 输出完成后回调 `stream_callback("done", None)`

- [x] Task 3: 后端 SSE 流式 API
  - [x] 3.1 在 `backend/app/services/hermes_service.py` 中新增 `chat_with_hermes_streaming()` 异步生成器方法
  - [x] 3.2 在 `backend/app/api/hermes.py` 中新增 `POST /api/hermes/chat/stream` SSE 端点
  - [x] 3.3 使用 FastAPI `StreamingResponse` + `text/event-stream`，推送 SSE 格式事件

- [x] Task 4: 前端流式 API 调用
  - [x] 4.1 在 `frontend/src/hooks/useApi.ts` 中新增 `chatWithHermesStreaming()` 函数，使用 `fetch` + `ReadableStream` 读取 SSE
  - [x] 4.2 支持 `onThinking`、`onText`、`onDone`、`onError` 回调

- [x] Task 5: 前端思考折叠组件
  - [x] 5.1 创建 `frontend/src/components/ThinkingBlock.tsx` 思考折叠组件
  - [x] 5.2 支持折叠/展开切换，带平滑过渡动画
  - [x] 5.3 思考中状态显示动态旋转图标 + "思考中..."文字
  - [x] 5.4 思考完成状态显示"思考过程"标题 + 展开/收起按钮
  - [x] 5.5 展开时内容区域实时追加更新

- [x] Task 6: 前端流式消息渲染
  - [x] 6.1 修改 `App.tsx` 中 `handleSendMessage()` 支持流式模式
  - [x] 6.2 发送消息后立即创建空的 Hermes 消息占位（含 ThinkingBlock 和内容区域）
  - [x] 6.3 实时接收 thinking 块并更新 ThinkingBlock 内容
  - [x] 6.4 实时接收 text 块并追加到消息内容区域
  - [x] 6.5 接收 done 信号后更新消息状态为完成

- [x] Task 7: 输出状态指示器
  - [x] 7.1 在消息气泡顶部添加状态标签区域
  - [x] 7.2 "思考中"状态：金橙色旋转动画图标 + 文字
  - [x] 7.3 "回答中"状态：金橙色脉冲动画图标 + 文字，消息末尾闪烁光标
  - [x] 7.4 "回答完成"状态：绿色勾选图标 + 文字，闪烁光标消失
  - [x] 7.5 在 `index.css` 中添加状态指示器动画关键帧

- [x] Task 8: 构建验证
  - [x] 8.1 运行前端构建确保无编译错误
  - [x] 8.2 运行后端检查确保无语法错误

# Task Dependencies
- Task 2 依赖 Task 1（流式执行器基础）
- Task 3 依赖 Task 2（流式 Hermes 对话）
- Task 4 可与 Task 3 并行开发
- Task 5 可与 Task 3-4 并行开发
- Task 6 依赖 Task 4、Task 5（API + 组件就绪）
- Task 7 依赖 Task 6（消息渲染就绪）
- Task 8 依赖 Task 1-7 全部完成
