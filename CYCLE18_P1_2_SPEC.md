# Cycle 18 P1-2 Spec: SSE 流式拦截器

## 目标

统一所有 SSE 流式响应处理，提供：
- 事件路由（按 event type 路由到 callback）
- 心跳检测（超时检测）
- 断线重连（指数退避）
- 取消支持（AbortSignal）
- 错误处理 + 上报
- 解析器抽象（适配不同后端格式）

## 当前问题

### 重复实现
- `chatWithHermesStreaming` (useWorkflowApi.ts:185-352) — 自实现 SSE 解析
- `useSSEReconnect` (useSSEReconnect.ts) — 自实现重连 + 心跳
- `useSystemApi.ts:724` — 第三个自实现 SSE 解析

每个实现都重复：
- `TextDecoder + ReadableStream` 读取
- `\n\n` 分隔 + `data: ` 提取
- `JSON.parse` + 事件分发
- 错误处理

### 缺失能力
- 没有心跳检测（chatWithHermesStreaming 流卡死时无感知）
- 没有自动重连（chatWithHermesStreaming 断流即失败）
- 没有错误分类上报

## 设计

### 核心 API

```typescript
// 创建 SSE 流
const stream = createSSEStream({
  url: '/api/hermes/chat/stream',
  method: 'POST',
  body: { message, session_id },
  signal: abortController.signal,
  // 心跳检测
  heartbeatMs: 5000,
  // 自动重连
  retry: {
    enabled: true,
    maxAttempts: 3,
    backoffMs: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  },
  // 事件路由
  events: {
    thinking: (data) => onThinking?.(data.content),
    text: (data) => onText?.(data.content),
    done: (data) => onDone?.(),
    error: (data) => onError?.(data.content),
  },
  // 错误处理
  onConnectionError: (err) => reportError(err, 'sse_error'),
  silent: false,
});

await stream.start();
// 取消时
stream.cancel();
```

### 事件路由机制

通过 events map 自动分发，替代手动 switch/case：

```typescript
const stream = createSSEStream({
  url: '/api/stream/events',
  events: {
    thinking: (data) => appendThinking(data.content),
    text: (data) => appendText(data.content),
    workflow_started: (data) => onWorkflowStarted(data),
  },
});
```

### 适配器模式

不同后端 SSE 格式可能不同（如 text/event-stream vs 自定义），通过 parser 抽象：

```typescript
interface SSEParser {
  parse(chunk: string): SSEEvent[];
  format(event: object): string;
}

const defaultParser: SSEParser = {
  parse(chunk) {
    // 解析 "data: {...}\n\n" 格式
  },
  format(event) {
    return `data: ${JSON.stringify(event)}\n\n`;
  },
};
```

## 文件结构

```
frontend/src/utils/
├── sseInterceptor.ts          # 核心拦截器
├── sseInterceptor.test.ts     # 单元测试
└── sseTypes.ts                # 类型定义
```

## 验收标准

- ✅ 单元测试 ≥ 20 个，覆盖：
  - 事件路由（按 type 分发）
  - 心跳检测
  - 断线重连（指数退避）
  - AbortSignal 取消
  - 错误分类 + 上报
  - 解析器单元测试
- ✅ TypeScript 编译 0 错误
- ✅ 现有 chatWithHermesStreaming 保持工作（不破坏现有消费者）

## 实施步骤

### Phase 1: Spec + 核心实现
1. 创建 `sseInterceptor.ts`
2. 实现事件路由 + 解析器
3. 实现心跳检测
4. 实现自动重连（指数退避）

### Phase 2: 单元测试
1. 单元测试覆盖所有路径
2. TypeScript 检查

### Phase 3: 文档 + 提交
1. 创建 CYCLE18_P1_2_SUMMARY.md
2. Git 提交

## 不在本次范围

- ❌ 重构 chatWithHermesStreaming 使用新拦截器（保持向后兼容）
- ❌ 重构 useSSEReconnect（功能已完整，暂不重构）
- ❌ Server-Sent Events (EventSource API) 适配（项目用 fetch + ReadableStream）
