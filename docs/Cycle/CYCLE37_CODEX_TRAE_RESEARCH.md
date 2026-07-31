# CYCLE 37 互联网调研报告

## 调研信息
- **周期**: Cycle 37
- **调研主题**: RAG 知识库 + Tool Use + Agent Loop + 真实 LLM 集成
- **调研时间**: 2026-07-31
- **目标方向**: A. RAG 知识库 + Tool Use（用户确认）
- **API 对接**: DeepSeek + 火山方舟 Coding Plan

---

## 一、调研范围

### 1.1 核心主题
1. **RAG 架构**: 文档加载、切片、Embedding、向量检索、混合检索、Re-ranking
2. **Function Calling / Tool Use 协议**: OpenAI、Anthropic、DeepSeek
3. **Agent Loop 模式**: ReAct、Plan-and-Execute、Reflexion
4. **真实 LLM 集成**: DeepSeek API、火山方舟 Coding Plan

### 1.2 调研来源
全部来源均为官方文档或权威学术资源：
- DeepSeek 官方 API 文档
- 火山方舟官方文档
- OpenAI 官方文档
- Anthropic 官方文档
- LangChain / LlamaIndex 官方文档
- arXiv 学术论文

---

## 二、DeepSeek API 调研

**来源**: [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/)

### 2.1 核心规格
- **Base URL**: `https://api.deepseek.com`（Beta: `https://api.deepseek.com/beta`）
- **协议**: OpenAI 兼容
- **模型**:
  - `deepseek-v4-flash`（快速）
  - `deepseek-v4-pro`（高质量）
- **SDK**: 直接使用 OpenAI Python SDK / Node SDK

### 2.2 Function Calling（Tool Use）
- ✅ OpenAI 兼容 Function Calling
- ✅ 支持多函数并行调用（最多 128 个）
- ✅ `strict` 模式（Beta）：模型严格遵循 JSON Schema
- ✅ Tool message 格式：`{role: "tool", tool_call_id, content}`
- ✅ `tool_choice` 参数：`none` / `auto` / 指定 function

### 2.3 思考模式（Thinking Mode）
- 默认开启（`thinking: {type: "enabled"}`）
- `reasoning_content` 字段返回 CoT
- **Tool Calls 后必须传回** `reasoning_content`（否则 API 忽略）
- `reasoning_effort`：`high`（默认）/ `max`
- 思考模式下 `temperature` / `top_p` / `presence_penalty` / `frequency_penalty` 失效

### 2.4 JSON Output
- 设置 `response_format: {type: "json_object"}`
- 提示词需引导 JSON 输出
- 适合数据处理自动化

### 2.5 流式响应（SSE）
- `stream: true` 启用
- OpenAI 标准 SSE 协议
- 通过 `chunk.choices[0].delta.content` 增量获取

### 2.6 上下文硬盘缓存（KV Cache）
- 自动缓存命中区域的 token 价格大幅降低
- 适合长上下文场景

### 2.7 对本项目的启示
1. **Provider 复用 Cycle 36 架构**: DeepSeek 走 OpenAI 兼容协议，Cycle 36 的 `BaseLLMProvider` 可直接复用
2. **Tool Use 协议**: OpenAI 兼容（DeepSeek 协议 = OpenAI 协议）
3. **流式响应**: SSE 标准（与 Cycle 36 StreamingResponseEngine 兼容）
4. **思考模式**: 可作为可选项（默认启用，用户可禁用）
5. **环境变量**: `DEEPSEEK_API_KEY`

---

## 三、Volcengine Ark Coding Plan 调研

**来源**: [火山方舟 Coding Plan 文档](https://docs.volcengine.com/docs/82379/2188958) | [Coding Plan 活动](https://www.volcengine.com/activity/codingplan)

### 3.1 核心规格
- **Base URL**（OpenAI 兼容）: `https://ark.cn-beijing.volces.com/api/coding/v3`
- **Base URL**（Anthropic 兼容）: `https://ark.cn-beijing.volces.com/api/coding`
- **⚠️ 注意**: 使用 `https://ark.cn-beijing.volces.com/api/v3` 不会消耗 Coding Plan 额度，**会产生额外费用**
- **环境变量**: `ARK_API_KEY`
- **API Key 管理**: [console.volcengine.com/ark/region:cn-beijing/apikey](https://console.volcengine.com/ark/region:cn-beijing/apikey)

### 3.2 支持的模型（Coding Plan）
- `doubao-seed-2.1-turbo`
- `doubao-seed-2.0-lite`
- `MiniMax-m2.7`（豆包 MiniMax）
- `MiniMax-m3`（豆包 MiniMax 最新）
- `glm-5.2`（智谱）
- `deepseek-v4-flash`
- `deepseek-v4-pro`
- `kimi-k2.6`
- `kimi-k2.7-code`

**特殊值**: `ark-code-latest` 表示"使用 Coding Plan 默认模型"

### 3.3 思考模式
- 通过 `extra_body: {thinking: {type: "disabled"}}` 禁用
- 通过 `extra_body: {thinking: {type: "enabled"}}` 启用

### 3.4 Function Calling
- 兼容 OpenAI Function Calling 协议
- 通过 `tools` 参数定义

### 3.5 流式响应
- `stream: true` 启用
- OpenAI 兼容 SSE 协议
- Python SDK 用 `with completion:` 确保连接关闭

### 3.6 多模态
- 视觉理解模型支持 image_url（URL 或 Base64）
- 适用模型：视觉理解类模型

### 3.7 自定义 Header
- `X-Client-Request-Id`: 串联日志
- 可用于数据加密能力

### 3.8 对本项目的启示
1. **多模型 Coding Plan**: 一套 API Key 可用 9 个模型（价值极高）
2. **多协议支持**: 同时支持 OpenAI + Anthropic 协议
3. **环境变量**: `ARK_API_KEY`
4. **多模态**: 可作为 Cycle 36 MultiModalProcessor 的真实后端
5. **流式响应**: 标准 SSE，兼容

---

## 四、OpenAI Function Calling 调研

**来源**: [OpenAI Function Calling 文档](https://platform.openai.com/docs/guides/function-calling)

### 4.1 协议核心
```typescript
{
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather of a location, the user should supply a location first.",
        parameters: {
          type: "object",
          properties: { location: { type: "string", description: "City and state" } },
          required: ["location"]
        }
      }
    }
  ]
}
```

### 4.2 关键特性
- **Parallel Function Calls**: 一次请求调用多个函数
- **Strict Mode**: `additionalProperties: false` + 所有字段 `required`
- **tool_choice**: `none` / `auto` / `{type: "function", function: {name: "..."}}`
- **Custom Tools**: 自由文本输入
- **Built-in Tools**: web_search / code_interpreter / file_search

### 4.3 响应格式
```typescript
{
  id: "chatcmpl-...",
  choices: [{
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_xxx",
        type: "function",
        function: { name: "get_weather", arguments: '{"location":"Hangzhou"}' }
      }]
    }
  }]
}
```

### 4.4 对本项目的启示
1. **Function Calling 是 LLM 应用核心**: 几乎所有 LLM Provider 都支持
2. **Protocol 标准化**: OpenAI 协议是事实标准
3. **Cycle 37 工具调用引擎**: 基于 OpenAI 协议实现，自动兼容 DeepSeek / 火山方舟

---

## 五、Anthropic Tool Use 调研

**来源**: [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)

### 5.1 协议核心
```typescript
{
  tools: [
    {
      name: "get_weather",  // ^[a-zA-Z0-9_-]{1,64}$
      description: "Get current weather...",
      input_schema: {  // JSON Schema
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"]
      }
    }
  ]
}
```

### 5.2 关键特性
- **Client Tools**: 用户定义 + Anthropic 模式（bash, text_editor）
- **Server Tools**: Anthropic 基础设施执行（web_search, web_fetch, code_execution, tool_search）
- **Strict Mode**: Beta 模式
- **Parallel Tool Use**: 一次请求调用多个工具
- **Stop Reason**: `tool_use` / `end_turn` / `max_tokens` 等

### 5.3 响应格式
```typescript
{
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "I'll check the weather." },
    { type: "tool_use", id: "toolu_xxx", name: "get_weather", input: { location: "Hangzhou" } }
  ]
}
```

### 5.4 对本项目的启示
1. **Anthropic 协议与 OpenAI 不同**: 单独的协议适配层
2. **Cycle 36 已有 AnthropicProvider 占位**: 需要补全真实实现
3. **Tool Use 标准化**: 工具定义可跨协议复用

---

## 六、RAG 架构调研

**来源**: [LangChain Retrieval](https://docs.langchain.com/oss/javascript/langchain/retrieval) | [LlamaIndex Hybrid Search](https://developers.llamaindex.ai/python/examples/vector_stores/milvushybridindexdemo/) | [arXiv 2511.10297](https://arxiv.org/html/2511.10297v2)

### 6.1 RAG 三种架构
| 架构 | 描述 | 适用场景 |
|------|------|----------|
| **2-Step RAG** | Query → Retrieve → Generate | 简单问答、固定流程 |
| **Agentic RAG** | LLM 自主决定何时检索 | 复杂多跳推理 |
| **Hybrid RAG** | 2-Step + Agentic + 中间校验 | 生产可用、平衡控制与灵活 |

### 6.2 RAG 核心组件

#### 6.2.1 Document Loaders（文档加载器）
- TXT / Markdown / JSON / CSV / PDF / HTML
- 输出标准化 `Document` 对象

#### 6.2.2 Text Splitters（文本切片器）
- **RecursiveCharacterTextSplitter**: 300-400 tokens, 3-token overlap（最优）
- **SentenceSplitter**: 按句子切分
- **SemanticSplitter**: 按语义切分

#### 6.2.3 Embedding Models（嵌入模型）
- OpenAI `text-embedding-3-small/large`
- BGE（开源）
- 本项目: DeepSeek / Volcengine 兼容 OpenAI 协议

#### 6.2.4 Vector Stores（向量存储）
- Milvus / Qdrant / Pinecone / Weaviate
- 本项目: 纯前端 + IndexedDB（轻量级）

#### 6.2.5 Retrievers（检索器）
- **Vector Retriever**: Cosine Similarity
- **BM25 Retriever**: 关键词
- **Hybrid Retriever**: 两者混合 + RRF / Weighted Scoring
- **QueryFusionRetriever**: 多查询生成 + 多检索 + 融合

### 6.3 Hybrid Search + Reranking
- **RRF (Reciprocal Rank Fusion)**: `score = Σ 1 / (k + rank_i)`, k=60
- **Weighted Scoring**: `score = α * dense + β * sparse`
- **最优权重**: 30% sparse / 70% dense（来自 arXiv 2511.10297）

### 6.4 Re-ranking 策略
- **Cross-Encoder**: BGE-reranker / Cohere Rerank
- **LLM-based**: 使用 LLM 评分
- **启发式**: 长度 / 时间 / 来源可信度

### 6.5 对本项目的启示
1. **Hybrid Search 必需**: 单一检索策略不够，混合提升准确率
2. **Chunk 策略**: 300-400 tokens + overlap 是最佳实践
3. **RRF 简单有效**: 默认使用 RRF k=60
4. **Source Citation**: 必须返回来源引用（生产可用）
5. **多查询融合**: 提升召回率（生成多个变体查询）

---

## 七、Agent Loop 调研

**来源**: [LangChain Agentic RAG](https://docs.langchain.com/oss/javascript/langchain/retrieval) | [Anthropic Tool Use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)

### 7.1 ReAct 模式
**Reasoning + Acting**:
1. **Thought**: 思考下一步
2. **Action**: 选择工具
3. **Observation**: 观察工具结果
4. 循环直至目标达成

### 7.2 Plan-and-Execute 模式
1. **Plan**: LLM 生成完整计划
2. **Execute**: 逐步执行
3. **Re-plan**: 根据结果调整计划
4. 适合复杂多步任务

### 7.3 Reflexion 模式
- 自我反思 + 改进
- 适合需要从错误中学习的任务

### 7.4 Human-in-the-Loop
- 关键决策需要人类确认
- Anthropic 推荐: 高风险操作必须人类确认
- 本项目: 支持 Approval Flow

### 7.5 终止条件
- 最大步数（防死循环）
- 目标达成（LLM 自我判断）
- 置信度阈值
- 超时

### 7.6 决策可解释性
- Thought / Action / Observation 三段式
- 每步可追溯
- 适合生产审计

---

## 八、调研结论

### 8.1 技术选型

| 模块 | 选型 | 理由 |
|------|------|------|
| **RAG** | Hybrid Search (Vector + BM25) + RRF k=60 | arXiv 实证最优 |
| **Embedding** | OpenAI 兼容接口（DeepSeek / Volcengine） | 复用真实 LLM API |
| **Vector Store** | IndexedDB + 纯前端 | 零后端依赖 |
| **Chunking** | RecursiveCharacterTextSplitter (300-400 tokens, 3 overlap) | 实证最优 |
| **Tool Use 协议** | OpenAI 兼容（DeepSeek / Volcengine 通用） | 行业标准 |
| **Anthropic 协议** | 独立适配层 | 已有占位实现 |
| **Agent Loop** | ReAct（默认）+ Plan-and-Execute | 灵活度最高 |
| **Terminate** | 最大步数 + 目标达成 + 置信度 | 三重保险 |

### 8.2 4 大 P0 任务最终化

| 任务 | 核心能力 | 复用 Cycle 36 |
|------|----------|---------------|
| **G37-01 RAGEngine** | 文档加载 + 切片 + Embedding + 向量检索 + BM25 + 混合检索 + Re-ranking + Source Citation | 复用 MultiModalProcessor（PDF 解析） |
| **G37-02 ToolUseEngine** | 工具注册 + 权限 + OpenAI/DeepSeek 协议 + Anthropic 协议 + 执行器 + 历史回放 | 复用 UsageTracker（工具调用统计） |
| **G37-03 AgentLoopEngine** | ReAct + Plan-and-Execute + 工具选择 + 多步状态 + 终止条件 + 可解释性 + Human-in-the-Loop | 复用 StreamingResponseEngine（流式推理） |
| **G37-04 RealLLMProvider** | DeepSeekProvider + VolcengineArkProvider + 环境变量 + SSE 流式 + Tool Use + Usage 统计 | 扩展 LLMProviderAdapter（占位 → 真实） |

### 8.3 安全设计
- ✅ API Key 仅通过环境变量（DEEPSEEK_API_KEY / ARK_API_KEY）
- ✅ `.env` 严格 .gitignore
- ✅ `.env.example` 模板（无敏感信息）
- ✅ 代码中所有 API Key 引用使用占位符
- ✅ Usage Tracker 自动统计 + 成本计算
- ✅ 错误重试 + Rate Limit 保护

### 8.4 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| API Key 泄漏 | **高** | 环境变量 + .gitignore + .env.example |
| API 限流 | 中 | 重试 + 退避 + 队列 |
| Tool Use 协议差异 | 中 | OpenAI 为主，Anthropic 独立适配 |
| RAG 准确率 | 中 | Hybrid Search + Reranking + Citation |
| Agent 死循环 | 中 | 最大步数 + 超时 + 目标达成 |
| Embedding 成本 | 低 | 缓存 + 复用 + 限速 |
| 真实 API 联调失败 | 中 | Mock fallback + 离线模式 |

---

## 九、参考资料

### 9.1 官方 API 文档
- [DeepSeek API 文档](https://api-docs.deepseek.com/) - 2026-07-31
- [DeepSeek 对话补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion)
- [DeepSeek Tool Calls 指南](https://api-docs.deepseek.com/guides/tool_calls/)
- [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode)
- [火山方舟 Coding Plan 文档](https://docs.volcengine.com/docs/82379/2188958)
- [火山方舟 OpenAI 兼容 API](https://www.volcengine.com/docs/82379/1330626?lang=en)
- [火山方舟流式输出](https://www.volcengine.com/docs/82379/2123275?lang=zh)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use 概览](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [Anthropic 工具定义](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/define-tools)
- [Anthropic API 概览](https://docs.anthropic.com/claude/reference/overview)

### 9.2 RAG 架构
- [LangChain Retrieval 文档](https://docs.langchain.com/oss/javascript/langchain/retrieval) - 2026-07
- [LlamaIndex Hybrid Search (BM25)](https://developers.llamaindex.ai/python/examples/vector_stores/milvushybridindexdemo/)
- [LlamaIndex Milvus Full-Text Search](https://developers.llamaindex.ai/python/examples/vector_stores/milvusfulltextsearchdemo/)
- [LlamaIndex Query Fusion Retriever](https://developers.llamaindex.ai/python/examples/low_level/fusion_retriever/)
- [arXiv 2511.10297 - Local Hybrid RAG](https://arxiv.org/html/2511.10297v2) - Paolo Astrino, 2025-11-28

### 9.3 引用统计
- **官方 API 文档**: 10 篇（DeepSeek 4 + Volcengine 3 + OpenAI 1 + Anthropic 3）
- **RAG 框架文档**: 4 篇（LangChain 1 + LlamaIndex 3）
- **学术论文**: 1 篇（arXiv 2511.10297）
- **总计**: 15 个权威来源

---

## 十、下一阶段

Phase 2: 差距分析（基于调研结果 + 现有代码梳理）
- 现状: Cycle 36 已完成 LLMProviderAdapter（4 Provider） + StreamingResponseEngine + MultiModalProcessor
- 差距: RAG 引擎、Tool Use 引擎、Agent Loop 引擎、真实 LLM 集成

详见 [CYCLE37_GAP_ANALYSIS.md](CYCLE37_GAP_ANALYSIS.md)（待编写）
