# Cycle 18 P1-2 任务总结：SSE 流式拦截器

## 任务目标

实现一个统一的 SSE（Server-Sent Events）流式拦截器，集中处理：
- 事件路由（按 event.type 分发到 callback）
- 心跳检测（超时无 chunk 自动断开 + 重连）
- 断线自动重连（指数退避）
- 取消支持（AbortSignal 透传）
- 错误处理 + 上报（集成 GlobalErrorHandler）
- 解析器抽象（支持自定义后端格式）

## 完成情况

✅ **100% 完成**

## 交付物清单

### 核心代码文件

| 文件 | 版本 | 行数 | 说明 |
|------|------|------|------|
| [sseInterceptor.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/sseInterceptor.ts) | v1.0.0 | ~430 | SSE 流式拦截器核心实现 |

### 测试文件

| 文件 | 测试数 | 覆盖范围 |
|------|--------|---------|
| [sseInterceptor.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/sseInterceptor.test.ts) | 21 | 事件路由 / 解析器 / 取消 / 错误处理 / SSEError 类 / 流状态 |
| [test_e2e_cycle18_p1_2.sh](file:///home/qizheng/auto_code_ws/tests/test_e2e_cycle18_p1_2.sh) | 21 断言 | 文件存在性 / 功能完整性 / 单元测试 / TypeScript / 全部测试 |

**总计**：21 单元测试 + 21 E2E 断言 = **42 个验证点**

## 关键设计决策

### 1. 事件路由（替代手动 switch/case）

```ts
// 旧写法（chatWithHermesStreaming）
switch (event.type) {
  case 'thinking': onThinking?.(event.content); break;
  case 'text': onText?.(event.content); break;
  // ...
}

// 新写法（createSSEStream）
const stream = createSSEStream({
  events: {
    thinking: (data) => appendThinking(data.content),
    text: (data) => appendText(data.content),
    // ...
  },
});
```

### 2. 心跳检测（防流卡死）

```ts
heartbeatMs: 30000,  // 默认 30s 无 chunk 视为断流
```

- 每次收到 chunk 重置心跳计时器
- 超时后 `reader.cancel()` 触发 reader.read() 返回 done
- 错误处理循环自动重连

### 3. 自动重连（指数退避）

```ts
retry: {
  enabled: true,
  maxAttempts: 3,
  backoffMs: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
}
```

- 默认 1s → 2s → 4s（上限 10s）
- 业务错误（server type=error）也触发重连
- 用户主动 abort 不重试

### 4. 解析器抽象

```ts
export interface SSEParser {
  parse(buffer: string, leftover: string): { events: SSEEvent[]; remaining: string };
  format?(event: Partial<SSEEvent>): string;
}
```

- 默认实现 `defaultSSEParser`：标准 SSE 格式
- 支持跨 chunk 拼接
- 解析失败时降级为 `{ raw: string }`

### 5. 错误分类

```ts
type SSEErrorType = 
  | 'connection'  // 连接失败
  | 'parse'       // 解析失败
  | 'timeout'     // 心跳超时
  | 'aborted'     // 用户取消
  | 'server'      // 服务端 error 事件
  | 'unknown';
```

## 拦截器能力矩阵

| 能力 | 实现状态 | 配置项 |
|------|---------|--------|
| 事件路由 | ✅ | `events` map |
| 通配回调 | ✅ | `onEvent` |
| 心跳检测 | ✅ | `heartbeatMs` (默认 30s) |
| 自动重连 | ✅ | `retry / maxRetries / retryBackoff` |
| 指数退避 | ✅ | `retryBackoff(attempt)` |
| 用户取消 | ✅ | `signal` AbortSignal |
| 主动取消 | ✅ | `sse.cancel()` |
| 错误分类 | ✅ | 6 种 SSEErrorType |
| 全局错误上报 | ✅ | `silent: false` |
| 静默模式 | ✅ | `silent: true` |
| 自定义解析器 | ✅ | `parser` 选项 |
| 单 handler 异常隔离 | ✅ | handler 异常不影响流继续 |
| 服务端 error 事件 | ✅ | 自动识别并抛 SSEError |
| 流状态查询 | ✅ | `isActive / getRetryCount` |

## 验证结果

### 单元测试
- ✅ sseInterceptor 单元测试：**21/21 通过**
- ✅ 全部 utils/hooks 测试：**793/793 通过**

### TypeScript 编译
- ✅ **0 错误**

### E2E 验证
- ✅ **21/21 断言通过**

## 后续应用

### 候选重构目标（按优先级）

1. **chatWithHermesStreaming** (useWorkflowApi.ts:185) — 168 行手写 SSE → 用新拦截器可减少 50%+ 代码
2. **useSSEReconnect** — 已有完整重连逻辑，可统一接口
3. **useSystemApi.ts:724** — 第三个手写 SSE 解析

### 不在本次范围

- ❌ 重构现有 chatWithHermesStreaming（保持向后兼容）
- ❌ EventSource API 适配（项目用 POST SSE）

## 迁移示例（未来）

```ts
// 旧代码（chatWithHermesStreaming）
export async function chatWithHermesStreaming(message, sessionId, callbacks, sessionMode, signal) {
  const response = await fetch('/api/hermes/chat/stream', { ... });
  const reader = response.body?.getReader();
  // ... 80+ 行手写解析
}

// 新代码（用 sseInterceptor）
import { createSSEStream } from '../utils/sseInterceptor';

export async function chatWithHermesStreaming(message, sessionId, callbacks, sessionMode, signal) {
  const stream = createSSEStream({
    url: '/api/hermes/chat/stream',
    method: 'POST',
    body: { message, session_id: sessionId, session_mode: sessionMode },
    signal,
    events: {
      thinking: (data) => callbacks.onThinking?.(data.content),
      text: (data) => callbacks.onText?.(data.content),
      clarify_questions: (data) => callbacks.onClarifyQuestions?.(data),
      // ...其他事件
      done: () => callbacks.onDone?.(),
    },
    onError: (err) => callbacks.onError?.(err.message),
  });
  await stream.start();
}
```

## 相关文档

- [CYCLE18_P1_2_SPEC.md](file:///home/qizheng/auto_code_ws/CYCLE18_P1_2_SPEC.md) - 详细规范
- [sseInterceptor.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/sseInterceptor.ts) - 核心实现
- [test_e2e_cycle18_p1_2.sh](file:///home/qizheng/auto_code_ws/tests/test_e2e_cycle18_p1_2.sh) - E2E 测试
