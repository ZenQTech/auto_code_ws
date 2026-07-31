# CYCLE 36 G36-02 SPEC: Streaming Response Engine

## 文档信息
- **版本**: v1.0.0
- **创建时间**: 2026-07-31
- **优先级**: P0
- **对标产品**: Vercel AI SDK / OpenAI ChatKit / LangChain Streaming

---

## 一、目标

### 1.1 核心目标
为项目提供统一的流式响应管理能力，支持 LLM 输出的实时 UI 渲染。

### 1.2 业务价值
- 实时显示 LLM 生成内容（打字机效果）
- 降低首 token 时间（TTFT）感知
- 支持中断、暂停、恢复
- 统一多种流式协议（SSE / WebSocket / AsyncIterable）

### 1.3 核心场景
1. **Chat 应用**: LLM 对话流式输出
2. **工作流**: 工作流节点执行进度实时显示
3. **智能体**: 智能体响应流式推送
4. **代码生成**: 代码逐行生成与高亮

---

## 二、架构设计

### 2.1 核心抽象

```typescript
/**
 * 流式响应统一抽象
 */
export interface StreamSession {
  readonly id: string;
  readonly status: StreamStatus;
  
  // 控制
  pause(): void;
  resume(): void;
  cancel(): void;
  
  // 订阅
  onChunk(callback: (chunk: StreamChunk) => void): Unsubscribe;
  onComplete(callback: (final: StreamComplete) => void): Unsubscribe;
  onError(callback: (error: StreamError) => void): Unsubscribe;
  
  // 状态
  getStats(): StreamStats;
}

export type StreamStatus = 'pending' | 'streaming' | 'paused' | 'completed' | 'cancelled' | 'error';
```

### 2.2 引擎架构

```typescript
class StreamingResponseEngine {
  // 创建流
  createStream(options: CreateStreamOptions): StreamSession;
  
  // 包装 Provider 流
  wrapProviderStream(provider: AsyncIterable<any>): StreamSession;
  
  // 主动发送
  emitChunk(streamId: string, chunk: StreamChunk): void;
  completeStream(streamId: string, final: StreamComplete): void;
  errorStream(streamId: string, error: StreamError): void;
  
  // 查询
  getStream(streamId: string): StreamSession | undefined;
  listStreams(filter?: StreamFilter): StreamSession[];
  
  // 统计
  getStats(): AggregateStreamStats;
}
```

### 2.3 类型定义

```typescript
export interface StreamChunk {
  streamId: string;
  sequence: number;
  type: 'text' | 'tool_call' | 'metadata' | 'heartbeat';
  text?: string;
  toolCall?: ToolCall;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface StreamComplete {
  streamId: string;
  finalContent: string;
  usage: TokenUsage;
  durationMs: number;
  totalChunks: number;
  finishReason: string;
}

export interface StreamError {
  streamId: string;
  error: Error;
  recoverable: boolean;
  timestamp: number;
}

export interface StreamStats {
  streamId: string;
  status: StreamStatus;
  chunksEmitted: number;
  bytesEmitted: number;
  durationMs: number;
  pausedDurationMs: number;
  ttftMs?: number;  // Time To First Token
  itps?: number;    // Instantaneous Tokens Per Second
  avgItps?: number; // Average ITPS
}

export interface CreateStreamOptions {
  provider: ProviderName;
  model: string;
  messages: Message[];
  config?: StreamConfig;
}

export interface StreamConfig {
  throttleMs?: number;       // 节流间隔（默认 16ms = 60fps）
  bufferSize?: number;        // 缓冲区大小（默认 100）
  heartbeatMs?: number;       // 心跳间隔（默认 15000ms）
  autoReconnect?: boolean;    // 自动重连
  maxRetries?: number;        // 最大重试
}
```

### 2.4 错误处理

```typescript
export class StreamError extends Error {
  constructor(
    public streamId: string,
    public type: 'connection' | 'parse' | 'abort' | 'timeout' | 'unknown',
    public recoverable: boolean,
    message: string
  ) {
    super(message);
  }
}
```

---

## 三、协议适配器

### 3.1 SSE 适配器
```typescript
class SSEAdapter {
  parseChunk(rawChunk: string): StreamChunk[];
  serialize(chunk: StreamChunk): string;
  formatEvent(event: string, data: any): string;
}
```

**SSE 格式**:
```
event: message
data: {"text": "Hello"}

event: done
data: [DONE]

```

### 3.2 AsyncIterable 适配器
```typescript
class AsyncIterableAdapter {
  fromProvider<T>(stream: AsyncIterable<T>, transformer: (item: T) => StreamChunk): AsyncIterable<StreamChunk>;
  toProvider<T>(stream: AsyncIterable<StreamChunk>, transformer: (chunk: StreamChunk) => T): AsyncIterable<T>;
}
```

### 3.3 WebSocket 适配器（未来扩展）
```typescript
class WebSocketAdapter {
  connect(url: string): WebSocket;
  send(ws: WebSocket, chunk: StreamChunk): void;
  onMessage(ws: WebSocket, callback: (chunk: StreamChunk) => void): void;
}
```

---

## 四、核心功能

### 4.1 流式创建与消费

```typescript
const engine = getDefaultStreamingResponseEngine();

// 创建流
const stream = engine.createStream({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Write a poem' }],
});

// 订阅文本块
stream.onChunk((chunk) => {
  if (chunk.type === 'text') {
    uiAppendText(chunk.text);
  }
});

// 订阅完成
stream.onComplete((final) => {
  console.log('Done in', final.durationMs, 'ms');
  console.log('Tokens:', final.usage);
});

// 订阅错误
stream.onError((err) => {
  console.error('Stream error:', err);
});
```

### 4.2 中断控制

```typescript
// 中断
stream.cancel();

// 暂停
stream.pause();
// ... 一些时间后 ...
stream.resume();
```

### 4.3 实时统计

```typescript
// 获取实时统计
const stats = stream.getStats();
console.log(`TTFT: ${stats.ttftMs}ms, ITPS: ${stats.itps}`);

// 聚合统计
const aggregate = engine.getStats();
console.log(`Total streams: ${aggregate.totalStreams}`);
console.log(`Avg TTFT: ${aggregate.avgTtftMs}ms`);
```

### 4.4 自动重连
```typescript
const stream = engine.createStream({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages: [...],
  config: {
    autoReconnect: true,
    maxRetries: 3,
  },
});
```

---

## 五、UI 集成

### 5.1 React Hook

```typescript
function useStreamingResponse(options: UseStreamingOptions): {
  text: string;
  status: StreamStatus;
  usage?: TokenUsage;
  error?: StreamError;
  start: () => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  reset: () => void;
};

function useStreamingOptions {
  provider: ProviderName;
  model: string;
  messages: Message[];
  throttleMs?: number;
  onComplete?: (final: StreamComplete) => void;
  onError?: (error: StreamError) => void;
}
```

### 5.2 打字机 UI 组件
- **StreamingText**: 逐字渲染文本
- **StreamingMarkdown**: 流式 Markdown 渲染
- **StreamingCode**: 流式代码高亮

### 5.3 状态展示
- 流式进度条（基于 ITPS）
- Token 用量实时显示
- 中断/恢复按钮
- 错误提示

---

## 六、缓冲区与节流

### 6.1 缓冲区设计
```typescript
class ChunkBuffer {
  private buffer: StreamChunk[] = [];
  private maxSize: number;
  
  push(chunk: StreamChunk): void;
  drain(): StreamChunk[];
  size(): number;
  clear(): void;
}
```

### 6.2 节流策略
- **默认**: 16ms 帧间隔（60fps）
- **快速模式**: 8ms（120fps）
- **节能模式**: 100ms（10fps）
- **可配置**: 用户可调整

### 6.3 背压处理
- 缓冲区满时暂停流
- 缓冲区有空时恢复流
- 防止内存溢出

---

## 七、性能优化

### 7.1 性能指标
- **TTFT (Time To First Token)**: < 500ms
- **ITPS (Instantaneous Tokens Per Second)**: 实时显示
- **UI 渲染**: 60fps 不掉帧

### 7.2 优化策略
- **批量渲染**: 多个 chunk 合并为单次渲染
- **虚拟滚动**: 长文本流式渲染
- **Worker 线程**: 解析在 Worker 中进行
- **IndexedDB 缓存**: 流式历史本地缓存

---

## 八、测试策略

### 8.1 单元测试
- 引擎创建/管理流
- 协议适配器
- 中断/恢复逻辑
- 缓冲区与节流
- 错误处理
- 统计计算

### 8.2 集成测试
- 与 LLM Provider 集成
- 与 UI 组件集成
- 多流并发
- 大响应流

### 8.3 性能测试
- 1000 并发流
- 100K chunks 流
- 内存泄漏检测

---

## 九、API 接口清单

### 9.1 导出类
```typescript
export class StreamingResponseEngine { ... }
export class StreamSessionImpl implements StreamSession { ... }
export class ChunkBuffer { ... }
export class StreamError extends Error { ... }
export class SSEAdapter { ... }
export class AsyncIterableAdapter { ... }
```

### 9.2 导出 Hook
```typescript
export function useStreamingResponse(options: UseStreamingOptions): UseStreamingReturn;
export function useStreamStats(streamId: string): StreamStats;
export function useStreamHistory(filter?: StreamFilter): StreamSession[];
```

### 9.3 工具函数
```typescript
export function createStreamFromProvider(provider: LLMProvider, options: any): StreamSession;
export function streamToAsyncIterable<T>(stream: StreamSession): AsyncIterable<T>;
export function calculateITPS(stream: StreamSession): number;
```

---

## 十、交付清单

### 10.1 代码文件
- `frontend/src/utils/streamingResponseEngine.ts` (~800 行)
- `frontend/src/utils/streamingResponseEngine.test.ts` (~500 行)
- `frontend/src/utils/sseAdapter.ts` (~200 行)
- `frontend/src/utils/sseAdapter.test.ts` (~150 行)
- `frontend/src/utils/useStreamingResponse.ts` (~200 行)
- `frontend/src/utils/useStreamingResponse.test.ts` (~200 行)

### 10.2 UI 文件
- `frontend/src/components/StreamingChatPanel.tsx` (~600 行)
- `frontend/src/components/StreamingChatPanel.test.tsx` (~400 行)
- `frontend/src/components/StreamingText.tsx` (~200 行)
- `frontend/src/components/StreamingText.test.tsx` (~150 行)
- `frontend/src/components/StreamingMarkdown.tsx` (~300 行)
- `frontend/src/components/StreamingMarkdown.test.tsx` (~200 行)

### 10.3 集成文件
- `frontend/src/App.tsx` (修改)
- `frontend/src/components/AppLayout.tsx` (修改)
- `frontend/src/components/BrandHeader.tsx` (修改)

---

## 十一、依赖

### 11.1 新增依赖
无（使用浏览器原生 Fetch API + ReadableStream）

### 11.2 不需要
- 不引入新框架
- 不引入新状态管理库

---

## 十二、版本与变更

- **v1.0.0**: 初始版本（Cycle 36 G36-02）

### 变更记录
- 2026-07-31 | v1.0.0 | Cycle 36 G36-02 初始创建
