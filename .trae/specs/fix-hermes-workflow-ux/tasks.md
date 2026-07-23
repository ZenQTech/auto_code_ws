# Tasks

- [x] Task 1: 修复流式对话 Thinking 输出
  - [x] 1.1 修改 `hermes_executor.py` 中 `chat_streaming()` 命令格式：`chat -q` → `-p` 模式
  - [x] 1.2 在 `_build_chat_command` 中构建带 system prompt 的完整 prompt
  - [x] 1.3 确保 thinking 标签解析在 `-p` 模式下正常工作
  - [x] 1.4 验证 ThinkingBlock 组件能正确渲染流式 thinking 内容

- [x] Task 2: 实现停止生成功能
  - [x] 2.1 前端 `useApi.ts` 中 `chatWithHermesStreaming` 引入 `AbortController`
  - [x] 2.2 `AbortController` 通过回调返回给调用方
  - [x] 2.3 `App.tsx` 中 `handleStop` 调用 `abortController.abort()`
  - [x] 2.4 后端 `base_executor.py` 新增 `cancel()` 方法（`process.kill()`）
  - [x] 2.5 `hermes_executor.py` 暴露 `cancel()` 方法
  - [x] 2.6 后端新增 `POST /api/hermes/stop` 端点
  - [x] 2.7 `handleStop` 同时调用后端 stop 端点终止子进程

- [x] Task 3: Coding 模式下自动路由到 WorkflowEngine
  - [x] 3.1 `hermes_service.py` 新增 `_is_development_request(message)` 检测方法
  - [x] 3.2 修改 `chat_with_hermes_streaming()`，coding 模式 + 开发需求 → 调用 `workflow_engine.start_workflow()`
  - [x] 3.3 工作流启动后返回引导消息："已启动 SOP 工作流，进入需求澄清阶段..."
  - [x] 3.4 `HermesService.__init__` 接受 `workflow_engine` 参数
  - [x] 3.5 `main.py` 中注入 `workflow_engine` 到 `HermesService`
  - [x] 3.6 前端 coding 模式下 `handleSendMessage` 适配工作流启动响应

- [x] Task 4: TypeScript 类型错误修复
  - [x] 4.1 删除 `App.tsx` 中 BrandHeader 的 `appMode={appMode ?? undefined}` prop

- [x] Task 5: 集成测试与验证
  - [x] 5.1 验证流式对话 thinking 输出
  - [x] 5.2 验证停止按钮终止功能
  - [x] 5.3 验证 coding 模式工作流路由
  - [x] 5.4 验证 TypeScript 编译零错误
  - [x] 5.5 全量回归测试
  - [x] 5.6 清理测试脚本

# Task Dependencies
- Task 1 无依赖
- Task 2 无依赖（与 Task 1 可并行）
- Task 3 无依赖（与 Task 1/2 可并行）
- Task 4 无依赖（与 Task 1/2/3 可并行）
- Task 5 依赖 Task 1-4
