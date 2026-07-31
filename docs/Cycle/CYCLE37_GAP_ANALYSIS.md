# CYCLE 37 差距分析报告

## 周期信息
- **周期**: Cycle 37
- **主题**: RAG 知识库 + Tool Use + Agent Loop + 真实 LLM 集成
- **时间**: 2026-07-31
- **依赖**: [CYCLE37_CODEX_TRAE_RESEARCH.md](CYCLE37_CODEX_TRAE_RESEARCH.md)

---

## 一、现状梳理

### 1.1 已有能力（CYCLE 36 及之前）

#### 1.1.1 LLM Provider 层（Cycle 36）
- **文件**: [llmProviderAdapter.ts](frontend/src/utils/llmProviderAdapter.ts) (~700 行)
- **能力**:
  - 4 个 Provider：Mock、Anthropic、OpenAI、Ollama
  - 统一接口 `LLMProvider`（chat / stream / countTokens / calculateCost / on）
  - `LLMProviderRegistry` 单例管理
  - `UsageTracker` 跟踪 Token + 成本
- **限制**:
  - ⚠️ Anthropic / OpenAI / Ollama 仅为占位实现（返回 Mock 响应）
  - ❌ 无真实 HTTP 调用
  - ❌ 无 Tool Use 协议
  - ❌ 无 Thinking Mode 支持

#### 1.1.2 流式响应层（Cycle 36）
- **文件**: [streamingResponseEngine.ts](frontend/src/utils/streamingResponseEngine.ts) (~520 行)
- **能力**:
  - StreamSession 生命周期管理
  - 暂停 / 恢复 / 取消
  - TTFT / ITPS 统计
  - React hook 集成
- **限制**:
  - ⚠️ 真实 SSE 协议需 Provider 配合实现

#### 1.1.3 多模态层（Cycle 36）
- **文件**: [multiModalProcessor.ts](frontend/src/utils/multiModalProcessor.ts) (~620 行)
- **能力**:
  - 图像处理：缩放 / 压缩 / 缩略图 / EXIF
  - 音频处理：录制 / 电平 / 转写
  - 文件解析：TXT / MD / JSON
  - 多模态融合
- **复用价值**:
  - ✅ PDF 解析可扩展（需新增 PDFLoader）
  - ✅ 图像处理可用于多模态 RAG

#### 1.1.4 工作流 / 智能体层（Cycle 30 + 35）
- **WorkflowOrchestratorEngine**（Cycle 35）: DAG 工作流编排
- **AgentCommunicationEngine**（Cycle 35）: 智能体通信
- **OrchestratedAgentEngine**（Cycle 30）: 6 阶段 Orchestrated Mode
- **复用价值**:
  - ✅ Agent Loop 可复用 Orchestrated Mode 的 Plan 审批
  - ✅ Tool Use 工具执行可复用 WorkflowOrchestrator 的步骤

#### 1.1.5 UI 基础设施（多 Cycle 累计）
- BrandHeader / AppLayout / App.tsx 已支持 30+ 菜单项
- 现有模式：每个 P0 任务配套 UI 面板 + 主应用集成
- 复用价值: ✅ 直接复用现有集成模式

### 1.2 当前测试覆盖
- **TypeScript**: 0 错误
- **测试总数**: 4822 passing / 0 failing
- **测试文件数**: 174
- **覆盖率**: 维持 > 80%

---

## 二、差距识别

### 2.1 核心差距

| 差距 | 影响 | 优先级 |
|------|------|--------|
| **G37-01 缺失 RAG 引擎** | 无法构建知识库问答 | P0 |
| **G37-02 缺失 Tool Use 引擎** | LLM 无法调用工具 | P0 |
| **G37-03 缺失 Agent Loop 引擎** | 无多步推理能力 | P0 |
| **G37-04 真实 LLM Provider 未实现** | 仅 Mock，Demo 而非生产 | P0 |

### 2.2 次要差距

| 差距 | 影响 | 优先级 |
|------|------|--------|
| 文档加载器仅支持 TXT/MD/JSON | 缺少 PDF / HTML | P1 |
| Embedding 仅 Mock | 无法真实向量化 | P1 |
| 缺少 Anthropic 真实实现 | 协议占位 | P1 |
| 缺少向量数据库 | 仅 IndexedDB 轻量级 | P2 |
| 缺少 Cross-Encoder Reranker | 重排序仅启发式 | P2 |

### 2.3 安全差距

| 差距 | 风险 | 缓解 |
|------|------|------|
| API Key 缺乏标准管理方式 | 泄漏到 Git | 环境变量 + .gitignore + .env.example |
| 无 Rate Limit 处理 | API 限流失败 | 重试 + 退避 + 队列 |
| 无使用预算告警 | 成本失控 | UsageTracker + 告警（Cycle 30 已有） |

---

## 三、4 大 P0 任务设计

### 3.1 G37-01 RAGEngine

**核心组件**:
```
RAGEngine
├── Document Loaders
│   ├── TextLoader (TXT)
│   ├── MarkdownLoader (MD)
│   ├── JSONLoader
│   ├── HTMLLoader (新增)
│   └── PDFLoader (扩展 MultiModalProcessor)
├── Text Splitter
│   └── RecursiveCharacterTextSplitter (300-400 tokens, 3 overlap)
├── Embedding
│   ├── MockEmbedding (零依赖)
│   ├── OpenAIEmbedding (OpenAI 协议, 复用 RealLLMProvider)
│   └── BM25Sparse (关键词)
├── Vector Store
│   ├── MemoryVectorStore (纯前端)
│   └── IndexedDBVectorStore (持久化)
├── Retrievers
│   ├── VectorRetriever (Cosine Similarity)
│   ├── BM25Retriever (TF-IDF)
│   ├── HybridRetriever (RRF k=60, 30/70 权重)
│   └── QueryFusionRetriever (多查询)
├── Rerankers
│   ├── HeuristicReranker (长度 / 时间 / 来源)
│   └── CrossEncoderReranker (可选, P2)
└── CitationEngine (Source Citation)
```

**API 设计**:
```typescript
class RAGEngine {
  // 文档管理
  addDocument(doc: Document): Promise<string>;
  addDocuments(docs: Document[]): Promise<string[]>;
  listDocuments(filter?: { tags?: string[]; source?: string }): Document[];
  deleteDocument(id: string): boolean;
  
  // 检索
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrievalResult[]>;
  hybridRetrieve(query: string, options?: HybridRetrieveOptions): Promise<RetrievalResult[]>;
  
  // RAG 完整流程
  query(question: string, options?: RAGQueryOptions): Promise<RAGResponse>;
  
  // 持久化
  save(): Promise<void>;
  load(): Promise<void>;
}
```

**测试覆盖目标**: 60+ 单元测试
- Document Loaders: 10+
- Text Splitter: 8+
- Embedding: 8+
- Retrievers: 15+
- Rerankers: 8+
- CitationEngine: 5+
- RAGEngine 集成: 6+

### 3.2 G37-02 ToolUseEngine

**核心组件**:
```
ToolUseEngine
├── Tool Registry
│   ├── Builtin Tools
│   │   ├── web_search (HTTP)
│   │   ├── http_get (HTTP)
│   │   ├── code_exec (受限执行)
│   │   └── file_read (本地)
│   └── Custom Tools (用户定义)
├── Tool Schema
│   ├── OpenAI Function Calling Schema
│   └── Anthropic Tool Use Schema
├── Protocol Adapters
│   ├── OpenAIToolAdapter (DeepSeek / Volcengine 兼容)
│   └── AnthropicToolAdapter
├── Tool Executor
│   ├── LocalExecutor
│   ├── HTTPExecutor
│   └── MCPExecutor (P2)
├── Permission Manager
│   ├── Allow / Deny / Ask
│   └── Tool-level + Argument-level
└── History & Replay
    ├── ToolCallHistory
    └── ReplayEngine
```

**API 设计**:
```typescript
class ToolUseEngine {
  // 工具注册
  register(tool: ToolDefinition): void;
  unregister(name: string): boolean;
  list(filter?: { tag?: string; source?: ToolSource }): ToolDefinition[];
  
  // 协议转换
  toOpenAITools(tools: ToolDefinition[]): OpenAITool[];
  fromOpenAIToolCall(call: OpenAIToolCall): ToolCall;
  toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[];
  fromAnthropicToolUse(block: AnthropicToolUse): ToolCall;
  
  // 执行
  execute(call: ToolCall, options?: ExecuteOptions): Promise<ToolResult>;
  
  // 权限
  setPermission(toolName: string, permission: Permission): void;
  
  // 历史
  getHistory(filter?: { toolName?: string }): ToolCallRecord[];
  replay(recordId: string): Promise<ToolResult>;
}
```

**测试覆盖目标**: 50+ 单元测试
- Tool Registry: 8+
- Schema 转换: 12+
- Protocol Adapters: 10+
- Executor: 10+
- Permission: 6+
- History/Replay: 4+

### 3.3 G37-03 AgentLoopEngine

**核心组件**:
```
AgentLoopEngine
├── Agent Mode
│   ├── ReActMode
│   ├── PlanAndExecuteMode
│   └── ReflexionMode (P2)
├── State Manager
│   ├── AgentState (Messages + Memory + Scratchpad)
│   └── Step (Thought / Action / Observation)
├── Tool Selector
│   ├── AutoSelect (LLM 决定)
│   └── ManualSelect (强制指定)
├── Terminate Conditions
│   ├── MaxSteps (默认 10)
│   ├── GoalAchieved (LLM 自评)
│   ├── ConfidenceThreshold
│   └── Timeout
├── Explanation Engine
│   ├── Thought Logger
│   └── Action Logger
└── Human-in-the-Loop
    ├── ApprovalRequest
    └── ApprovalGate
```

**API 设计**:
```typescript
class AgentLoopEngine {
  // 启动
  run(options: AgentRunOptions): Promise<AgentResult>;
  runStream(options: AgentRunOptions): AsyncIterable<AgentEvent>;
  
  // 状态
  getState(agentId: string): AgentState;
  pause(agentId: string): void;
  resume(agentId: string): void;
  cancel(agentId: string): void;
  
  // 模式
  setMode(agentId: string, mode: AgentMode): void;
  
  // 人机协作
  requestApproval(agentId: string, stepId: string): Promise<boolean>;
}
```

**复用 Cycle 30 OrchestratedAgentEngine**:
- Plan 阶段 → G37-03 启动时生成计划
- Approval → G37-03 Human-in-the-Loop
- Journal → G37-03 决策日志

**测试覆盖目标**: 40+ 单元测试
- ReAct Mode: 12+
- Plan-and-Execute: 8+
- State Manager: 8+
- Terminate: 6+
- HITL: 6+

### 3.4 G37-04 RealLLMProvider

**核心组件**:
```
RealLLMProvider
├── DeepSeekProvider
│   ├── BaseURL: https://api.deepseek.com
│   ├── Env: DEEPSEEK_API_KEY
│   ├── Models: deepseek-v4-flash, deepseek-v4-pro
│   ├── Features: Function Calling, JSON Output, Thinking
│   └── SSE Stream: 标准 OpenAI SSE
├── VolcengineArkProvider
│   ├── BaseURL (OpenAI 协议): https://ark.cn-beijing.volces.com/api/coding/v3
│   ├── BaseURL (Anthropic 协议): https://ark.cn-beijing.volces.com/api/coding
│   ├── Env: ARK_API_KEY
│   ├── Models: 9 个 (doubao / MiniMax / glm / deepseek / kimi)
│   ├── Features: 9 模型 + 双协议 + 多模态
│   └── SSE Stream: OpenAI 兼容
├── EnvConfigManager
│   ├── .env 加载
│   ├── 占位符校验
│   └── 缺失 API Key 警告
└── RateLimit & Retry
    ├── 指数退避
    ├── 限流检测
    └── 自动重试
```

**API 设计**:
```typescript
class DeepSeekProvider extends BaseLLMProvider {
  // 继承 BaseLLMProvider 所有能力
  // 重写: chat / stream / validateConfig
  
  // Tool Use
  supportsTools(): boolean;
  
  // Thinking Mode
  supportsThinking(): boolean;
  setThinking(enabled: boolean, effort?: 'high' | 'max'): void;
}

class VolcengineArkProvider extends BaseLLMProvider {
  // 类似的实现
}
```

**EnvConfigManager**:
```typescript
class EnvConfigManager {
  // 从环境变量加载配置
  loadConfig(): ProviderConfig[];
  
  // 检查是否配置了某个 Provider
  hasApiKey(provider: ProviderName): boolean;
  
  // 获取 API Key（带占位符检测）
  getApiKey(provider: ProviderName): string | null;
  
  // 列出所有可用 Provider
  listAvailable(): ProviderName[];
}
```

**测试覆盖目标**: 50+ 单元测试
- DeepSeekProvider: 15+（含 Mock HTTP）
- VolcengineArkProvider: 15+
- EnvConfigManager: 8+
- RateLimit/Retry: 8+
- 集成: 4+

**Mock 策略**:
- 使用 `fetch` mock（jest-fetch-mock 或全局 mock）
- 测试环境不调用真实 API
- 提供 `withRealApi: true` 选项（手动测试）

---

## 四、与 Cycle 36 的关系

### 4.1 复用

| Cycle 36 模块 | Cycle 37 复用方式 |
|---------------|-------------------|
| `BaseLLMProvider` | G37-04 DeepSeekProvider / VolcengineArkProvider 继承 |
| `LLMProvider` 接口 | G37-04 实现 chat/stream |
| `LLMProviderRegistry` | G37-04 注册新 Provider |
| `UsageTracker` | G37-04 记录真实 API 使用量 |
| `StreamSession` | G37-04 真实 SSE 流式响应 |
| `Message` / `StreamChunk` | G37-04 适配 |
| `PROVIDER_MODELS` | G37-04 扩展 DeepSeek + Volcengine 模型 |
| `StreamingResponseEngine` | G37-03 Agent Loop 实时流式推理 |
| `MultiModalProcessor.PDFLoader` (P1) | G37-01 RAG 文档加载 |

### 4.2 扩展点

| 现有模块 | Cycle 37 扩展 |
|----------|---------------|
| `ProviderName` 类型 | 新增 `deepseek` / `volcengine` |
| `ModelInfo` | 新增 DeepSeek / Volcengine 模型元数据 |
| `MODEL_PRICING` | 新增 DeepSeek / Volcengine 价格 |
| `ChatOptions` | 新增 `tools` / `thinking` / `tool_choice` 字段 |
| `StreamChunk` | 新增 `tool_calls` / `reasoning_content` 字段 |

---

## 五、安全与合规

### 5.1 API Key 管理
- ✅ 环境变量: `DEEPSEEK_API_KEY` / `ARK_API_KEY`
- ✅ `.gitignore`: `.env` / `.env.local` / `.env.*.local`
- ✅ `.env.example`: 模板（无敏感信息）
- ✅ 代码: 仅使用 `process.env.X` 读取
- ✅ 文档: 不在 SPEC / 文档中硬编码任何 API Key
- ✅ 警告: API Key 缺失时 UI 提示用户配置

### 5.2 数据安全
- ✅ RAG 文档本地存储（IndexedDB）
- ✅ LLM API Key 不离开用户环境（前端直连）
- ✅ Tool 执行结果不外发（除 LLM 调用）
- ✅ Agent 日志本地化（IndexedDB）

### 5.3 风险控制
- ✅ UsageTracker 跟踪 + 告警
- ✅ Rate Limit 自动重试
- ✅ Tool Use 权限管理
- ✅ Human-in-the-Loop 高风险操作

---

## 六、任务依赖关系

```
G37-01 RAGEngine
├── 独立（可并行）
└── 依赖 Cycle 36 MultiModalProcessor (PDF 扩展, P1)

G37-02 ToolUseEngine
├── 独立（可并行）
└── 复用 Cycle 36 UsageTracker

G37-03 AgentLoopEngine
├── 依赖 G37-02 ToolUseEngine
├── 依赖 G37-04 RealLLMProvider
└── 复用 Cycle 30 OrchestratedAgentEngine

G37-04 RealLLMProvider
├── 独立（可并行）
├── 复用 Cycle 36 BaseLLMProvider
└── 复用 Cycle 36 StreamingResponseEngine
```

**实施顺序**: G37-01 / G37-02 / G37-04 并行 → G37-03 依赖

---

## 七、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| API Key 泄漏 | **高** | 环境变量 + .gitignore + .env.example + 文档提示 |
| 真实 API 联调失败 | 中 | Mock 优先 + 离线模式 + 文档化测试步骤 |
| DeepSeek SSE 协议差异 | 中 | 标准 OpenAI SSE + 单测覆盖 |
| 火山方舟 9 模型维护 | 中 | PROVIDER_MODELS 配置化 + 文档 |
| RAG 准确率不达标 | 中 | Hybrid Search + RRF + 启发式 Rerank + Source Citation |
| Agent 死循环 | 中 | MaxSteps + Timeout + 目标检测 + 用户中断 |
| Tool Use 权限失控 | 中 | 三级权限（Allow/Deny/Ask）+ 高危操作 HITL |
| Embedding 成本 | 低 | 缓存 + 复用 + Mock 默认 |
| IndexedDB 容量 | 低 | 限制单文档 10MB + 压缩 |

---

## 八、成功标准

### 8.1 G37-01 RAGEngine
- ✅ 支持 5+ 文档格式（TXT/MD/JSON/HTML/PDF）
- ✅ Hybrid Search 召回率 > 80%（手动评估）
- ✅ RRF 集成 + Source Citation
- ✅ 60+ 单元测试

### 8.2 G37-02 ToolUseEngine
- ✅ 支持 OpenAI + Anthropic 协议
- ✅ 5+ 内置工具（web_search / http_get / code_exec / file_read / calculator）
- ✅ 工具执行 + 错误处理 + 重试
- ✅ 权限管理 + History 回放
- ✅ 50+ 单元测试

### 8.3 G37-03 AgentLoopEngine
- ✅ ReAct 模式 + Plan-and-Execute 模式
- ✅ 决策可解释（Thought/Action/Observation）
- ✅ 终止条件 4 重保险
- ✅ Human-in-the-Loop
- ✅ 40+ 单元测试

### 8.4 G37-04 RealLLMProvider
- ✅ DeepSeekProvider 完整实现
- ✅ VolcengineArkProvider 完整实现
- ✅ 环境变量配置 + .env.example
- ✅ Tool Use 协议完整
- ✅ Thinking Mode 支持
- ✅ SSE 流式响应
- ✅ 50+ 单元测试（Mock fetch）

### 8.5 全局
- ✅ TypeScript 0 错误
- ✅ 全量测试 100% 通过
- ✅ 4 大 UI 面板 + 主应用集成
- ✅ Cycle 36 测试 0 回归

---

## 九、决策点（已确认）

1. ✅ **调研方向**: A（RAG + Tool Use）
2. ✅ **任务节奏**: 扩展到 4 大 P0 任务
3. ✅ **API 对接**: DeepSeek + Volcengine Ark Coding Plan
4. ✅ **API Key 管理**: 环境变量 + .env.example

---

## 十、下一阶段

Phase 3: 编写 4 份 SPEC 文档
- CYCLE37_SPEC_G37_01_RAG_ENGINE.md
- CYCLE37_SPEC_G37_02_TOOL_USE_ENGINE.md
- CYCLE37_SPEC_G37_03_AGENT_LOOP_ENGINE.md
- CYCLE37_SPEC_G37_04_REAL_LLM_PROVIDER.md
