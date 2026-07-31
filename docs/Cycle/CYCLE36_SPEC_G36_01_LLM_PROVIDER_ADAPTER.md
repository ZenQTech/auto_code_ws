# CYCLE 36 G36-01 SPEC: LLM Provider Adapter

## 文档信息
- **版本**: v1.0.0
- **创建时间**: 2026-07-31
- **优先级**: P0
- **对标产品**: LiteLLM / Vercel AI SDK / LangChain

---

## 一、目标

### 1.1 核心目标
为项目提供统一的 LLM Provider 抽象层，支持多家 LLM Provider 的无缝切换。

### 1.2 支持 Provider
1. **Anthropic Claude** - Anthropic SDK
2. **OpenAI** - OpenAI SDK（含 GPT-4o / GPT-4o-mini / o1）
3. **Ollama** - 本地 LLM（OpenAI 兼容 API）
4. **Mock Provider** - 测试/演示用

### 1.3 业务价值
- 业务代码与具体 Provider 解耦
- 切换 Provider 无需修改业务代码
- 统一 Token 计数与成本计算
- 统一错误处理与重试

---

## 二、架构设计

### 2.1 抽象接口

```typescript
/**
 * LLM Provider 统一接口
 */
export interface LLMProvider {
  // 基础元信息
  readonly name: ProviderName;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly models: ModelInfo[];
  
  // 核心 API
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk>;
  
  // 工具
  countTokens(text: string, model?: string): number;
  calculateCost(usage: TokenUsage, model?: string): number;
  validateConfig(): { valid: boolean; errors: string[] };
  
  // 生命周期
  initialize(): Promise<void>;
  dispose(): void;
}
```

### 2.2 类型定义

```typescript
export type ProviderName = 'anthropic' | 'openai' | 'ollama' | 'mock';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MultimodalContent[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface MultimodalContent {
  type: 'text' | 'image' | 'audio' | 'file';
  text?: string;
  data?: string; // base64
  mimeType?: string;
  url?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface ChatResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_use' | 'error';
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'usage' | 'done' | 'error';
  text?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
  error?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  inputCostPerMTokens: number;
  outputCostPerMTokens: number;
  capabilities: ('text' | 'image' | 'audio' | 'tool_use')[];
}
```

### 2.3 错误处理

```typescript
export class LLMError extends Error {
  constructor(
    public provider: ProviderName,
    public type: 'auth' | 'rate_limit' | 'network' | 'invalid_request' | 'overloaded' | 'unknown',
    public retryable: boolean,
    public statusCode?: number,
    message?: string
  ) {
    super(message || `${provider} ${type} error`);
  }
}
```

### 2.4 重试策略

```typescript
export interface RetryConfig {
  maxRetries: number;        // 默认 3
  initialDelayMs: number;     // 默认 1000
  maxDelayMs: number;         // 默认 30000
  backoffMultiplier: number;  // 默认 2
  retryableErrors: string[];  // ['rate_limit', 'overloaded', 'network']
}
```

---

## 三、Provider 实现

### 3.1 AnthropicProvider
- **SDK**: `@anthropic-ai/sdk`
- **端点**: `https://api.anthropic.com`
- **认证**: `x-api-key` header + `anthropic-version: 2023-06-01`
- **关键差异**:
  - `system` 消息分离
  - `max_tokens` 必填
  - 消息格式转换：`content` 数组 vs 字符串

### 3.2 OpenAIProvider
- **SDK**: `openai`
- **端点**: `https://api.openai.com/v1`
- **认证**: `Authorization: Bearer <key>`
- **关键差异**:
  - `developer` role 替代 `system`
  - `max_completion_tokens` 替代 `max_tokens`
  - `response_format` 支持结构化输出

### 3.3 OllamaProvider
- **SDK**: `ollama`
- **端点**: `http://localhost:11434`（可配置）
- **认证**: 无（本地）
- **关键差异**:
  - OpenAI 兼容端点
  - 模型需本地预装
  - 支持 vision 模型处理图像

### 3.4 MockProvider
- **用途**: 单元测试 + 离线演示
- **特性**:
  - 固定响应（如 echo）
  - 模拟延迟
  - 模拟错误
  - 模拟流式输出

---

## 四、核心 API

### 4.1 Provider 注册
```typescript
const registry = LLMProviderRegistry.getInstance();

registry.register('anthropic', new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-5',
}));

registry.register('ollama', new OllamaProvider({
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2',
}));

// 获取
const provider = registry.get('anthropic');
```

### 4.2 统一调用
```typescript
const provider = registry.getDefault();
const response = await provider.chat(
  [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
  { temperature: 0.7, maxTokens: 1024 }
);
console.log(response.content);
console.log(`Tokens: ${response.usage.totalTokens}, Cost: $${provider.calculateCost(response.usage)}`);
```

### 4.3 流式调用
```typescript
const stream = provider.stream(messages, options);
for await (const chunk of stream) {
  if (chunk.type === 'text') {
    process.stdout.write(chunk.text);
  } else if (chunk.type === 'usage') {
    console.log('Usage:', chunk.usage);
  } else if (chunk.type === 'done') {
    console.log('\nDone');
  }
}
```

### 4.4 中断控制
```typescript
const controller = new AbortController();
const promise = provider.chat(messages, { signal: controller.signal });
setTimeout(() => controller.abort(), 5000);
try {
  await promise;
} catch (e) {
  if (e.name === 'AbortError') console.log('Aborted');
}
```

---

## 五、Token 计数与成本

### 5.1 Token 计数策略
- **Anthropic**: 使用 `client.messages.countTokens()`（若可用）或估算
- **OpenAI**: 使用 `tiktoken` 库
- **Ollama**: 估算（基于字符数 / 4）
- **Mock**: 固定返回 100

### 5.2 成本计算
```typescript
const PRICING = {
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'ollama-llama3.2': { input: 0, output: 0 }, // 本地免费
};
```

### 5.3 用量统计
```typescript
class UsageTracker {
  record(usage: TokenUsage, model: string): void;
  getTotal(): AggregateUsage;
  getByProvider(): Record<string, AggregateUsage>;
  getByModel(): Record<string, AggregateUsage>;
  reset(): void;
}
```

---

## 六、错误处理与重试

### 6.1 错误分类

| 错误类型 | 是否重试 | 退避策略 |
|----------|----------|----------|
| `auth` | ❌ 不重试 | 立即抛出 |
| `rate_limit` | ✅ 重试 | 指数退避 + 抖动 |
| `network` | ✅ 重试 | 指数退避 |
| `overloaded` | ✅ 重试 | 指数退避 |
| `invalid_request` | ❌ 不重试 | 立即抛出 |
| `unknown` | ⚠️ 1次 | 指数退避 |

### 6.2 重试实现
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  signal?: AbortSignal
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || attempt === config.maxRetries) throw e;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const delay = Math.min(
        config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt) + Math.random() * 1000,
        config.maxDelayMs
      );
      await sleep(delay);
    }
  }
  throw lastError!;
}
```

---

## 七、配置管理

### 7.1 Provider 配置
```typescript
export interface ProviderConfig {
  name: ProviderName;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  customHeaders?: Record<string, string>;
}
```

### 7.2 配置存储
- **localStorage**: 用户配置（API Key 等）
- **环境变量**: 默认配置（开发/生产）
- **配置文件**: 高级配置（生产部署）

### 7.3 配置 UI
- API Key 输入（密码框 + 显示切换）
- Base URL 配置
- 模型选择下拉
- 连接测试按钮
- 状态显示

---

## 八、测试策略

### 8.1 单元测试
- MockProvider 全功能测试
- 消息格式转换测试
- Token 计数测试
- 成本计算测试
- 错误处理测试
- 重试逻辑测试

### 8.2 集成测试
- 真实 Provider 连接测试（需 API Key）
- 流式响应测试
- 多轮对话测试
- 工具调用测试

### 8.3 测试覆盖率
- 目标 ≥ 80%
- 关键路径 ≥ 95%

---

## 九、API 接口清单

### 9.1 导出函数
```typescript
export class LLMProviderRegistry { ... }
export class AnthropicProvider implements LLMProvider { ... }
export class OpenAIProvider implements LLMProvider { ... }
export class OllamaProvider implements LLMProvider { ... }
export class MockProvider implements LLMProvider { ... }
export class UsageTracker { ... }
export class LLMError extends Error { ... }
export function withRetry<T>(...): Promise<T>;
export function getDefaultLLMProvider(): LLMProvider;
export function resetDefaultLLMProvider(): void;
```

### 9.2 工具函数
```typescript
export function convertMessages(messages: Message[], target: ProviderName): any[];
export function estimateTokens(text: string): number;
export function calculateCost(usage: TokenUsage, model: string, pricing: PricingMap): number;
export function isRetryableError(error: unknown): boolean;
```

---

## 十、交付清单

### 10.1 代码文件
- `frontend/src/utils/llmProviderAdapter.ts` (~1000 行)
- `frontend/src/utils/llmProviderAdapter.test.ts` (~500 行)
- `frontend/src/utils/anthropicProvider.ts` (~400 行)
- `frontend/src/utils/anthropicProvider.test.ts` (~200 行)
- `frontend/src/utils/openaiProvider.ts` (~400 行)
- `frontend/src/utils/openaiProvider.test.ts` (~200 行)
- `frontend/src/utils/ollamaProvider.ts` (~300 行)
- `frontend/src/utils/ollamaProvider.test.ts` (~200 行)
- `frontend/src/utils/mockProvider.ts` (~200 行)
- `frontend/src/utils/mockProvider.test.ts` (~200 行)
- `frontend/src/utils/usageTracker.ts` (~200 行)
- `frontend/src/utils/usageTracker.test.ts` (~200 行)

### 10.2 UI 文件
- `frontend/src/components/LLMProviderPanel.tsx` (~500 行)
- `frontend/src/components/LLMProviderPanel.test.tsx` (~300 行)

### 10.3 集成文件
- `frontend/src/App.tsx` (修改)
- `frontend/src/components/AppLayout.tsx` (修改)
- `frontend/src/components/BrandHeader.tsx` (修改)

---

## 十一、依赖

### 11.1 新增依赖
```json
{
  "@anthropic-ai/sdk": "^0.40.0",
  "openai": "^4.0.0",
  "ollama": "^0.5.0"
}
```

### 11.2 不需要
- 不引入新构建工具
- 不引入新框架

---

## 十二、版本与变更

- **v1.0.0**: 初始版本（Cycle 36 G36-01）

### 变更记录
- 2026-07-31 | v1.0.0 | Cycle 36 G36-01 初始创建
