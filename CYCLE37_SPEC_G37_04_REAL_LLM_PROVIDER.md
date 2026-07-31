# SPEC: G37-04 RealLLMProvider (真实 LLM Provider 集成)

## 基本信息
- **任务编号**: G37-04
- **任务名称**: RealLLMProvider - DeepSeek + Volcengine Ark Coding Plan 集成
- **优先级**: P0
- **依赖**: Cycle 36 LLMProviderAdapter
- **可被依赖**: G37-01/02/03 真实 LLM 接入
- **周期**: Cycle 37 (2026-07-31)

---

## 一、设计目标

集成两个真实 LLM Provider，从 Demo 走向生产：
- **DeepSeekProvider**: OpenAI 兼容协议 + SSE 流式 + Function Calling + Thinking Mode
- **VolcengineArkProvider**: Coding Plan 协议 + SSE 流式 + 双协议支持（OpenAI / Anthropic）
- 环境变量管理 API Key（.env，.gitignore）
- 完整的错误处理 / 重试 / 限流
- 使用量统计 + 成本计算
- 浏览器 / Node.js 双环境兼容
- 单元测试 + Mock 集成测试（无需真实 API Key 即可测试）

## 二、核心组件

### 2.1 Provider 配置
```typescript
export interface DeepSeekConfig {
  apiKey: string;                // process.env.DEEPSEEK_API_KEY
  baseURL?: string;              // 默认 'https://api.deepseek.com/v1'
  defaultModel?: string;         // 默认 'deepseek-chat'
  timeoutMs?: number;            // 默认 60000
  maxRetries?: number;           // 默认 3
}

export interface VolcengineArkConfig {
  apiKey: string;                // process.env.ARK_API_KEY
  baseURL?: string;              // 默认 'https://ark.cn-beijing.volces.com/api/v3'
  defaultModel?: string;         // 默认 'ep-20240101000000-xxxxx' (Coding Plan endpoint)
  protocol?: 'openai' | 'anthropic'; // 默认 'openai'
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;                 // USD
  requestId?: string;
}
```

### 2.2 DeepSeekProvider
```typescript
export class DeepSeekProvider implements LLMProvider {
  readonly name: string = 'deepseek';
  readonly supportedModels: string[];
  
  constructor(config: DeepSeekConfig);
  
  // 基础方法
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: StreamOptions): AsyncGenerator<StreamChunk>;
  embed(text: string | string[]): Promise<number[][]>;
  
  // 高级方法
  chatWithTools(messages: Message[], tools: ToolDefinition[], options?: ChatOptions): Promise<ChatResponse>;
  thinkThenAnswer(prompt: string, options?: ThinkOptions): Promise<{ thinking: string; answer: string }>;
  
  // 元信息
  getModelInfo(model: string): ModelInfo;
  calculateCost(usage: ProviderUsage, model: string): number;
}
```

### 2.3 VolcengineArkProvider
```typescript
export class VolcengineArkProvider implements LLMProvider {
  readonly name: string = 'volcengine-ark';
  readonly supportedModels: string[];  // 9 个 Coding Plan 模型
  
  constructor(config: VolcengineArkConfig);
  
  // 同 DeepSeek
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: StreamOptions): AsyncGenerator<StreamChunk>;
  embed(text: string | string[]): Promise<number[][]>;
  chatWithTools(messages: Message[], tools: ToolDefinition[], options?: ChatOptions): Promise<ChatResponse>;
  
  // Coding Plan 特有
  listCodingPlanModels(): CodingPlanModel[];
  getEndpointInfo(endpointId: string): EndpointInfo;
}
```

### 2.4 错误处理与重试
```typescript
export class LLMError extends Error {
  constructor(
    public code: LLMErrorCode,
    message: string,
    public statusCode?: number,
    public details?: unknown
  );
}

export type LLMErrorCode =
  | 'AUTHENTICATION_ERROR'   // 401
  | 'RATE_LIMIT'             // 429
  | 'INVALID_REQUEST'        // 400
  | 'MODEL_NOT_FOUND'        // 404
  | 'CONTEXT_LENGTH_EXCEEDED'// 400 (specific)
  | 'SERVER_ERROR'           // 500-504
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'STREAM_INTERRUPTED'
  | 'UNKNOWN';

export class RetryStrategy {
  // 指数退避 + 抖动
  // 仅重试: RATE_LIMIT / SERVER_ERROR / NETWORK_ERROR / TIMEOUT
  // 不重试: AUTHENTICATION_ERROR / INVALID_REQUEST / MODEL_NOT_FOUND
}
```

### 2.5 限流（Rate Limiter）
```typescript
export interface RateLimitConfig {
  requestsPerMinute: number;     // RPM
  tokensPerMinute: number;      // TPM
  burstSize?: number;           // 默认 = RPM
}

export class TokenBucketRateLimiter {
  constructor(config: RateLimitConfig);
  async acquire(estimatedTokens?: number): Promise<void>;
  // 阻塞直到有足够配额
  release(actualTokens: number): void;
  getStats(): { availableTokens: number; queueLength: number };
}
```

### 2.6 使用量追踪
```typescript
export interface UsageRecord {
  provider: string;
  model: string;
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  durationMs: number;
  success: boolean;
  errorCode?: LLMErrorCode;
  requestId?: string;
}

export class UsageTracker {
  // 继承自 Cycle 36
  // 增强: 按 provider / model 聚合
  record(usage: UsageRecord): void;
  query(filter: UsageFilter): UsageRecord[];
  aggregate(groupBy: 'provider' | 'model' | 'day'): UsageAggregate[];
  getTotalCost(provider?: string, since?: number): number;
  export(format: 'json' | 'csv'): string;
}
```

## 三、环境变量与配置

### 3.1 .env.example 模板
```bash
# DeepSeek API
DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_DEFAULT_MODEL=deepseek-chat

# Volcengine Ark Coding Plan
ARK_API_KEY=your-ark-api-key-here
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_DEFAULT_MODEL=ep-your-coding-plan-endpoint-id
ARK_PROTOCOL=openai

# 全局配置
LLM_TIMEOUT_MS=60000
LLM_MAX_RETRIES=3
LLM_ENABLE_RATE_LIMIT=true
LLM_RPM=60
LLM_TPM=90000
```

### 3.2 .gitignore
```
# API Keys
.env
.env.local
.env.*.local

# Logs
*.log
logs/

# Coverage
coverage/
.nyc_output/

# Build
dist/
build/
*.tsbuildinfo

# Dependencies
node_modules/
```

### 3.3 配置加载器
```typescript
export class ConfigLoader {
  // 浏览器: 从 window.__ENV__ 或 localStorage
  // Node.js: 从 process.env 或 .env 文件
  
  load(): ProviderConfigs;
  validate(configs: ProviderConfigs): ValidationResult;
  isProviderAvailable(name: string): boolean;
  getApiKey(name: string): string | undefined;  // 不会输出到日志
  maskApiKey(key: string): string;             // sk-xxxxxxxxxxxx → sk-***xxxx
}
```

## 四、协议实现

### 4.1 DeepSeek (OpenAI 兼容)
```
POST {baseURL}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [{"role": "user", "content": "..."}],
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": true,
  "tools": [...],
  "response_format": {"type": "json_object"}
}
```

### 4.2 DeepSeek 流式响应 (SSE)
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### 4.3 DeepSeek Thinking Mode
```typescript
// DeepSeek Reasoner 模型（deepseek-reasoner）
// 响应包含 reasoning_content 字段
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "最终答案",
      "reasoning_content": "推理过程..."
    }
  }]
}

// 调用
const result = await provider.thinkThenAnswer(prompt);
// { thinking: "推理过程", answer: "最终答案" }
```

### 4.4 Volcengine Ark Coding Plan
```
# Coding Plan 9 个模型
- doubao-pro-32k
- doubao-pro-128k
- doubao-lite-32k
- doubao-lite-128k
- deepseek-v3
- deepseek-r1
- kimi-k2
- glm-4.6
- qwen3-coder-480b-a35b-instruct

# API 调用（OpenAI 协议）
POST {baseURL}/chat/completions
Authorization: Bearer {apiKey}
{
  "model": "{endpointId}",  // 用户的 Coding Plan endpoint
  "messages": [...],
  "stream": true
}
```

## 五、成本计算

### 5.1 DeepSeek 定价（2026-07）
```typescript
export const DEEPSEEK_PRICING = {
  'deepseek-chat': { input: 0.14 / 1_000_000, output: 0.28 / 1_000_000 }, // $/token
  'deepseek-reasoner': { input: 0.55 / 1_000_000, output: 2.19 / 1_000_000 },
  'deepseek-coder': { input: 0.14 / 1_000_000, output: 0.28 / 1_000_000 },
};
```

### 5.2 Volcengine Ark Coding Plan 定价
```typescript
// Coding Plan 包月订阅制，9 模型统一 ¥49/月
// 按 token 计算（API 调用）
export const ARK_CODING_PLAN_PRICING = {
  // 实际计费模式：包月 + API token 计费
  // API 部分按模型不同计费
  'doubao-pro-32k': { input: 0.8 / 1_000_000, output: 2.0 / 1_000_000 },
  'deepseek-v3': { input: 2.0 / 1_000_000, output: 8.0 / 1_000_000 },
  // ...
};
```

### 5.3 成本计算函数
```typescript
function calculateCost(usage: ProviderUsage, model: string, provider: string): number {
  const pricing = provider === 'deepseek' ? DEEPSEEK_PRICING : ARK_PRICING;
  const rate = pricing[model] || pricing.default;
  return usage.promptTokens * rate.input + usage.completionTokens * rate.output;
}
```

## 六、测试覆盖

### 6.1 单元测试（Mock HTTP）
| 模块 | 测试数 | 重点 |
|------|--------|------|
| DeepSeekProvider | 18 | chat / stream / tools / think / 错误 / 重试 |
| VolcengineArkProvider | 16 | chat / stream / 双协议 / Coding Plan |
| RetryStrategy | 8 | 指数退避 / 抖动 / 不重试错误 |
| TokenBucketRateLimiter | 8 | 获取 / 释放 / 队列 / 统计 |
| ConfigLoader | 10 | 浏览器 / Node / 验证 / 掩码 |
| UsageTracker | 6 | 记录 / 查询 / 聚合 / 导出 |
| 协议转换 | 6 | OpenAI ↔ Internal / 流式解析 |
| 成本计算 | 6 | 多个模型 / 边界值 |
| **合计** | **78** | - |

### 6.2 集成测试（真实 API，可选）
- 配置 API Key 后运行
- 跳过 CI / 自动测试
- 标记为 `*.integration.test.ts`

## 七、关键算法

### 7.1 SSE 解析
```typescript
async function* parseSSE(response: Response): AsyncGenerator<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        
        try {
          const parsed = JSON.parse(data);
          yield {
            type: 'text',
            text: parsed.choices?.[0]?.delta?.content || '',
            timestamp: Date.now(),
            // DeepSeek thinking
            thinking: parsed.choices?.[0]?.delta?.reasoning_content,
          };
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  }
}
```

### 7.2 指数退避重试
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (!isRetryable(error) || attempt === options.maxRetries) {
        throw error;
      }
      
      const delay = Math.min(
        options.initialDelay * Math.pow(2, attempt),
        options.maxDelay
      ) * (1 + Math.random() * 0.2 - 0.1);
      
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  throw lastError!;
}
```

### 7.3 速率限制
```typescript
class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  
  async acquire(estimatedTokens = 1): Promise<void> {
    this.refill();
    
    while (this.tokens < estimatedTokens) {
      const waitTime = this.getWaitTime(estimatedTokens);
      await new Promise(r => setTimeout(r, waitTime));
      this.refill();
    }
    
    this.tokens -= estimatedTokens;
  }
  
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const refillRate = this.config.tokensPerMinute / 60;
    this.tokens = Math.min(
      this.config.burstSize,
      this.tokens + elapsed * refillRate
    );
    this.lastRefill = now;
  }
}
```

## 八、安全与限制

### 8.1 API Key 安全
- ⚠️ **绝不**硬编码 API Key
- ⚠️ **绝不**提交 .env 到 Git
- ⚠️ **绝不**在日志中输出完整 API Key
- ✅ 使用环境变量 / 密钥管理服务
- ✅ 错误信息中 mask API Key
- ✅ 前端调用时通过后端代理（推荐）

### 8.2 数据隐私
- 不上传敏感数据到第三方
- 提示词模板化避免泄漏业务逻辑
- 流式响应完成后清理内存

### 8.3 速率限制
- 默认 60 RPM / 90K TPM
- 可配置 burst
- 超过限制排队等待

### 8.4 错误处理
- 网络错误：3 次重试
- 429 限流：等待 Retry-After
- 401 鉴权：立即失败
- 5xx 服务器：3 次重试
- 4xx 客户端错误：立即失败

## 九、性能目标

- chat 响应: < 3s（首 token）
- stream TTFT: < 500ms
- 流式 ITPS: > 20 tokens/s
- 重试开销: < 5s
- 内存占用: < 10MB / Provider

## 十、API 示例

```typescript
import { DeepSeekProvider, VolcengineArkProvider } from './realLLMProvider';

// 1. DeepSeek
const deepseek = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

const response = await deepseek.chat(
  [{ role: 'user', content: '你好' }],
  { model: 'deepseek-chat', temperature: 0.7 }
);

console.log(response.content);
console.log(`Cost: $${response.usage.cost}`);

// 2. DeepSeek Stream
for await (const chunk of deepseek.stream([{ role: 'user', content: '讲个故事' }])) {
  if (chunk.text) process.stdout.write(chunk.text);
}

// 3. DeepSeek Function Calling
const tools = [
  { name: 'get_weather', description: '...', parameters: {...} }
];
const toolResponse = await deepseek.chatWithTools(
  [{ role: 'user', content: '北京天气' }],
  tools
);
console.log(toolResponse.toolCalls);

// 4. DeepSeek Thinking
const { thinking, answer } = await deepseek.thinkThenAnswer('9.11 和 9.9 哪个大？');
console.log('思考:', thinking);
console.log('答案:', answer);

// 5. Volcengine Ark
const ark = new VolcengineArkProvider({
  apiKey: process.env.ARK_API_KEY!,
  defaultModel: 'ep-20240101000000-xxxxx',
});

const arkResponse = await ark.chat([
  { role: 'user', content: 'Hello' }
]);
console.log(arkResponse.content);

// 6. 列出 Coding Plan 模型
const models = ark.listCodingPlanModels();
console.log(models);
```

## 十一、配置到 Cycle 36 LLMProviderAdapter

```typescript
// 在主应用中注册
import { getDefaultLLMProviderRegistry } from './llmProviderAdapter';
import { DeepSeekProvider, VolcengineArkProvider } from './realLLMProvider';

const registry = getDefaultLLMProviderRegistry();

if (process.env.DEEPSEEK_API_KEY) {
  registry.register('deepseek', new DeepSeekProvider({
    apiKey: process.env.DEEPSEEK_API_KEY,
  }));
}

if (process.env.ARK_API_KEY) {
  registry.register('volcengine-ark', new VolcengineArkProvider({
    apiKey: process.env.ARK_API_KEY,
  }));
}

// 之后所有 LLMProvider 相关代码均可使用
```

## 十二、未来扩展

- P1: Anthropic API 直接接入
- P1: OpenAI 官方 API（gpt-4o, gpt-4-turbo）
- P1: 提示词缓存（Prompt Caching）
- P1: Function Calling 并行执行
- P2: 多模态（图像输入）
- P2: Fine-tuning API
- P2: Batch API（批量请求）
