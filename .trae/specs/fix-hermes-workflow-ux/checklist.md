# Checklist

## Thinking 过程可见
- [x] `chat_streaming` 使用 `-p` 模式（含 system prompt）
- [x] CLI 输出 `<thinking>` 标签被正确解析
- [x] thinking 事件通过 SSE 流式推送到前端
- [x] ThinkingBlock 组件可折叠渲染思考内容
- [x] thinking 内容实时流式追加（非等标签闭合）

## 停止生成功能
- [x] `chatWithHermesStreaming` 创建并暴露 `AbortController`
- [x] `handleStop` 调用 `abortController.abort()`
- [x] `BaseCLIExecutor` 有 `cancel()` 方法
- [x] `HermesExecutor` 暴露 `cancel()`
- [x] `POST /api/hermes/stop` 端点存在
- [x] 停止后子进程被 kill，SSE 流关闭

## Coding 模式工作流路由
- [x] `_is_development_request()` 正确检测开发需求
- [x] coding 模式 + 开发需求 → 自动调用 `start_workflow()`
- [x] 工作流启动后返回引导消息
- [x] `HermesService` 接受 `workflow_engine` 参数
- [x] chat 模式保持原有行为不变

## TypeScript 编译
- [x] `App.tsx` 不再传递 `appMode` 给 `BrandHeader`
- [x] `npx tsc --noEmit` 零错误

## 集成测试
- [x] Thinking 输出测试通过
- [x] 停止按钮测试通过
- [x] 工作流路由测试通过
- [x] TypeScript 编译测试通过
- [x] 全量回归测试通过
- [x] 测试脚本已清理
