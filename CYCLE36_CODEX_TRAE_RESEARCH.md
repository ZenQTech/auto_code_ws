# CYCLE 36 互联网调研报告 - 真实 LLM 集成 + 流式响应 + 多模态

## 调研时间
- 2026-07-31
- 调研人: System
- 主题: Real LLM Provider + End-to-End Task Execution

---

## 一、调研背景

### 1.1 现状
当前项目已具备（Cycle 35 交付）:
- ✅ 4 大核心引擎：WorkflowOrchestrator / AgentCommunication / TaskCheckpoint / AgentScheduler
- ✅ 工作流编排 + 智能体通信 + 任务调度能力
- ❌ **缺真实 LLM Provider 集成**：当前使用 Mock 节点执行器
- ❌ **缺流式响应能力**：无法实时输出 LLM 生成内容
- ❌ **缺多模态处理**：仅支持文本，无法处理图像/语音/文件

### 1.2 目标
1. **真实 LLM 接入**: Anthropic Claude / OpenAI GPT / Ollama 本地模型
2. **流式响应**: SSE 流式输出，实时 UI 渲染
3. **多模态支持**: 图像理解 / 语音转录 / 文件解析

---

## 二、Anthropic Claude API 调研

### 2.1 官方 SDK 信息
**来源**: https://platform.claude.com/docs/en/api/sdks/typescript
- **包名**: `@anthropic-ai/sdk`
- **TypeScript 支持**: 4.9+
- **运行环境**: Node.js 20+ / Deno / Bun / Cloudflare Workers / Vercel Edge / Jest 28+ / **Web 浏览器**（需 `dangerouslyAllowBrowser: true`）

### 2.2 核心 API
```typescript
// 基础调用
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const message = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(message.content[0].text);

// 流式调用
const stream = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  stream: true,
  messages: [{ role: 'user', content: 'Hello' }],
});
for await (const event of stream) {
  console.log(event.type);
}
```

### 2.3 关键能力
- **Token 计数**: `message.usage.input_tokens` / `output_tokens`
- **SSE 流式**: 服务端事件流（Server-Sent Events）
- **Tool Use (Function Calling)**: 支持 Zod schemas
- **多模态**: 支持图像输入
- **Prompt Caching**: 通过 `providerOptions.anthropic.cacheControl`

### 2.4 模型选型
| 模型 | 用途 | 价格（Input/Output per 1M tokens）|
|------|------|-----------------------------------|
| claude-opus-4-8 | 复杂推理 | 高 |
| claude-sonnet-4-5 | 日常编程 | 中 |
| claude-haiku-4-5 | 高并发轻量 | 低 |

---

## 三、OpenAI API 调研

### 3.1 官方 SDK 信息
**来源**: https://developers.openai.com/api/docs/guides/production-best-practices
- **包名**: `openai`
- **关键参数**: `model` / `messages` / `temperature` / `max_completion_tokens` / `stream` / `response_format`

### 3.2 核心 API
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 30000,
});

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 1024,
});

// 流式
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [...],
  stream: true,
});
for await (const chunk of stream) {
  console.log(chunk.choices[0]?.delta?.content);
}
```

### 3.3 模型与价格（截至 2026-06）
| 模型 | 输入/输出价格 per 1M tokens | 用途 |
|------|----------------------------|------|
| gpt-4o | $2.50 / $10.00 | 高精度业务 |
| gpt-4o-mini | $0.15 / $0.60 | 成本优化 |
| o1-mini | 高 | 复杂推理 |

### 3.4 多模态
- **图像**: base64 或 URL（注意 CORS 限制）
- **音频**: gpt-4o-audio-preview
- **响应格式**: json_object / json_schema (Structured Outputs)

---

## 四、Ollama 本地 LLM 调研

### 4.1 官方信息
**来源**: https://ollama.com/ / https://docs.ollama.com/
- **包名**: `ollama`
- **运行端口**: `http://localhost:11434`
- **OpenAI 兼容**: `http://localhost:11434/v1` 端点
- **License**: MIT（开源免费）
- **平台**: macOS / Windows / Linux + Docker

### 4.2 核心 API
```typescript
import ollama from 'ollama';

// 基础调用
const response = await ollama.chat({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(response.message.content);

// 流式
const stream = await ollama.chat({
  model: 'llama3.2',
  messages: [...],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.message.content);
}

// Embeddings
const result = await ollama.embeddings({
  model: 'nomic-embed-text',
  prompt: 'text',
});

// 模型管理
const { models } = await ollama.list();
```

### 4.3 支持模型
- **文本**: Llama / Mistral / Qwen / Gemma / DeepSeek / Phi
- **多模态**: gemma3 / Llama 3.2 Vision / LLaVA
- **代码**: qwen3-coder / codestral / deepseek-coder
- **Embeddings**: nomic-embed-text / embeddinggemma

### 4.4 优势
- ✅ 零云依赖（数据隐私）
- ✅ 无 API Key（本地运行）
- ✅ 无 Token 费用
- ✅ OpenAI 兼容 API（迁移成本低）

### 4.5 限制
- ❌ 受本地硬件限制（GPU/RAM）
- ❌ 模型质量上限低于云端大模型
- ❌ 不适合生产 SLA 场景

---

## 五、流式响应技术调研

### 5.1 协议对比

| 协议 | 优势 | 劣势 | 适用场景 |
|------|------|------|----------|
| **SSE** | 简单/HTTP/单向 | 单向 | LLM 流式输出 |
| **WebSocket** | 双向/全双工 | 复杂 | 实时聊天 |
| **HTTP/2 Stream** | 双向/底层 | 实现复杂 | gRPC 场景 |

### 5.2 LLM 流式实现模式
```typescript
// 模式 1: AsyncIterable
const stream = await client.messages.create({ ..., stream: true });
for await (const event of stream) {
  // 处理增量事件
}

// 模式 2: Callback-based
const stream = client.messages.stream({ ... });
stream.on('text', (text) => { /* 增量回调 */ });
const finalMessage = await stream.finalMessage();

// 模式 3: 浏览器 SSE
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages }),
});
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  // 解析 SSE 格式: "data: {...}\n\n"
}
```

### 5.3 流式 UI 模式
- **打字机效果**: 逐字渲染
- **节流更新**: 16ms 帧间隔（60fps）
- **Markdown 实时渲染**: 增量解析
- **可中断控制**: AbortController

---

## 六、多模态处理调研

### 6.1 图像
- **输入格式**: base64 / URL
- **Token 成本**: 与分辨率非线性增长
- **预处理**: 缩放至 720p 平衡成本与精度
- **OCR**: GPT-4o / Claude Vision

### 6.2 语音
- **Web Speech API**: 浏览器内置（Chrome/Safari）
- **OpenAI Whisper**: 离线转录
- **流式识别**: 实时字幕

### 6.3 文件
- **PDF**: pdf.js 解析
- **DOCX**: mammoth.js
- **Markdown**: marked
- **代码**: Monaco Editor

---

## 七、统一 Provider 适配器设计

### 7.1 抽象层接口
```typescript
interface LLMProvider {
  name: string;
  models: string[];
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<Chunk>;
  countTokens(text: string): number;
  calculateCost(usage: Usage): number;
}
```

### 7.2 适配器实现
- `AnthropicProvider` - Claude API
- `OpenAIProvider` - GPT API
- `OllamaProvider` - 本地模型
- `MockProvider` - 测试用

### 7.3 关键功能
- **统一消息格式**: 内部格式 <-> Provider 格式转换
- **Token 计数**: 各 Provider 独立实现
- **成本计算**: 按模型定价
- **错误重试**: 指数退避
- **速率限制**: 自动排队

---

## 八、与项目现有能力集成

### 8.1 与 WorkflowOrchestratorEngine 集成
- **替换 Mock 节点执行器**: `llm` 节点使用真实 LLM
- **流式进度回调**: 节点执行过程中实时上报
- **Token 预算控制**: 工作流级别 Token 上限

### 8.2 与 AgentCommunicationEngine 集成
- **真实智能体对话**: A2A 消息携带 LLM 响应
- **流式消息推送**: Pub/Sub 增量分发
- **多智能体协作**: LLM 智能体协同完成任务

### 8.3 与 TaskCheckpointEngine 集成
- **LLM 对话快照**: 保存对话状态
- **Token 用量记录**: 每个 checkpoint 关联 Token
- **Time Travel 调试**: 回溯对话历史

### 8.4 与 AgentSchedulerEngine 集成
- **LLM 任务调度**: 按优先级调度 LLM 调用
- **资源限制**: 按 Token 预算排队
- **并发控制**: 防止速率限制

---

## 九、风险评估

### 9.1 技术风险
| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| API Key 泄露 | 高 | 环境变量 + 后端代理 |
| 速率限制 | 中 | 指数退避 + 请求队列 |
| CORS 限制 | 高 | 后端代理转发 |
| 成本失控 | 中 | Token 预算实时监控 |
| 流式中断 | 中 | AbortController + 重试 |

### 9.2 安全风险
- **API Key 存储**: localStorage 加密或后端代理
- **CORS**: 浏览器直连需 `dangerouslyAllowBrowser: true`
- **PII 处理**: 不向 LLM 发送敏感数据

### 9.3 性能风险
- **流式延迟**: 首 token 时间（TTFT）控制
- **内存泄漏**: 流式消费必须正确释放
- **UI 卡顿**: 大响应需节流渲染

---

## 十、参考资源

### 10.1 官方文档
- Anthropic: https://platform.claude.com/docs/
- OpenAI: https://platform.openai.com/docs/
- Ollama: https://docs.ollama.com/
- Vercel AI SDK: https://sdk.vercel.ai/docs

### 10.2 调研来源
- Anthropic TypeScript SDK: https://platform.claude.com/docs/en/api/sdks/typescript
- Anthropic Streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
- Vercel AI SDK + Claude: https://claudeguide.io/vercel-ai-sdk-claude
- OpenAI Best Practices: https://developers.openai.com/api/docs/guides/production-best-practices
- Ollama Ollama Patterns: https://lobehub.com/skills/neversight-learn-skills.dev-ai-infrastructure-ollama
- Ollama Node.js Guide: https://mljourney.com/how-to-use-ollama-with-javascript-and-node-js/

### 10.3 调研时间
- 2026-07-31
- 信息来源: 各 Provider 官方网站与权威技术博客

---

## 十一、结论与建议

### 11.1 核心结论
1. **三家 Provider 均成熟**: Anthropic / OpenAI / Ollama 均提供完善的 TypeScript SDK
2. **流式是必备**: SSE + AsyncIterable 是 LLM 应用标配
3. **Ollama 是本地首选**: OpenAI 兼容 + 零成本 + 数据隐私
4. **统一抽象层必要**: 避免业务代码耦合特定 Provider

### 11.2 推荐方案
- **G36-01**: LLM Provider Adapter（统一抽象层）
- **G36-02**: Streaming Response Engine（流式响应 + UI 集成）
- **G36-03**: Multi-Modal Processor（图像/语音/文件）

### 11.3 实施优先级
1. **P0 - LLM Provider Adapter**: 立即可交付，价值最大
2. **P0 - Streaming Response Engine**: 体验关键，UI 必备
3. **P1 - Multi-Modal Processor**: 高级功能，可后续迭代

### 11.4 后续方向
- **Cycle 37**: Token 预算 + 成本可视化 + 评测
- **Cycle 38**: Tool Use / Function Calling 深度集成
- **Cycle 39**: RAG / Embeddings 集成
- **Cycle 40**: 端到端真实任务流（Workflow + LLM）
