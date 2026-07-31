# SPEC: G37-01 RAGEngine (RAG 知识库引擎)

## 基本信息
- **任务编号**: G37-01
- **任务名称**: RAGEngine - RAG 知识库引擎
- **优先级**: P0
- **依赖**: Cycle 36 MultiModalProcessor (PDF 扩展, P1)
- **可被依赖**: G37-03 AgentLoopEngine
- **周期**: Cycle 37 (2026-07-31)

---

## 一、设计目标

构建一个生产可用的 RAG（Retrieval-Augmented Generation）知识库引擎，支持：
- 多格式文档加载（TXT / MD / JSON / HTML / PDF）
- 智能文本切片（300-400 tokens + 3 token overlap）
- Embedding 向量化（Mock + OpenAI 兼容）
- 混合检索（Vector + BM25 + RRF）
- Re-ranking（启发式 + 未来 Cross-Encoder）
- Source Citation（来源引用）
- 本地持久化（IndexedDB）

## 二、核心组件

### 2.1 Document 类型
```typescript
export interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;        // 文件路径 / URL
    title?: string;
    author?: string;
    createdAt: number;
    updatedAt: number;
    tags?: string[];
    mimeType?: string;
    size?: number;
  };
  chunks?: DocumentChunk[];
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;           // 在文档中的位置
  startOffset: number;
  endOffset: number;
  embedding?: number[];    // 懒加载
  metadata: Record<string, unknown>;
}
```

### 2.2 Loaders（文档加载器）
```typescript
export interface DocumentLoader {
  readonly name: string;
  readonly supportedMimeTypes: string[];
  load(source: string | File | Blob): Promise<Document>;
}

export class TextLoader implements DocumentLoader { /* TXT */ }
export class MarkdownLoader implements DocumentLoader { /* MD */ }
export class JSONLoader implements DocumentLoader { /* JSON */ }
export class HTMLLoader implements DocumentLoader { /* HTML → text */ }
export class PDFLoader implements DocumentLoader { /* PDF → text, 扩展 MultiModalProcessor */ }
```

### 2.3 Splitter（文本切片器）
```typescript
export interface TextSplitter {
  split(text: string, options?: SplitOptions): string[];
}

export interface SplitOptions {
  chunkSize?: number;       // 默认 400 tokens
  chunkOverlap?: number;    // 默认 3 tokens
  separators?: string[];    // 默认 ["\n\n", "\n", "。", "！", "？", " ", ""]
  keepSeparator?: boolean;  // 默认 true
}

export class RecursiveCharacterTextSplitter implements TextSplitter {
  // Recursive: 先按 \n\n, 再按 \n, 再按句子, ...
  // Token 估算: ~1.5 字符/token (英文), ~1 字符/token (中文)
}
```

### 2.4 Embedding（嵌入模型）
```typescript
export interface EmbeddingModel {
  readonly name: string;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class MockEmbedding implements EmbeddingModel {
  // 基于 TF-IDF 的简单 Embedding
  // dimension: 256
}

export class OpenAICompatibleEmbedding implements EmbeddingModel {
  // 调用 OpenAI 协议（DeepSeek / Volcengine 兼容）
  // baseURL, apiKey, model
}

export class BM25SparseEmbedding implements EmbeddingModel {
  // 关键词稀疏向量
  // 用于混合检索
}
```

### 2.5 Vector Store（向量存储）
```typescript
export interface VectorStore {
  add(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  search(query: number[], topK: number, filter?: object): Promise<SearchResult[]>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): number;
}

export class MemoryVectorStore implements VectorStore {
  // 纯内存，进程内
}

export class IndexedDBVectorStore implements VectorStore {
  // IndexedDB 持久化
  // 数据库名: 'rag-vector-store'
  // 表名: 'vectors'
}
```

### 2.6 Retrievers（检索器）
```typescript
export interface Retriever {
  retrieve(query: string, topK: number): Promise<RetrievalResult[]>;
}

export interface RetrievalResult {
  chunk: DocumentChunk;
  score: number;
  rank: number;
  source: 'vector' | 'bm25' | 'hybrid' | 'fusion';
}

export class VectorRetriever implements Retriever {
  // Cosine Similarity
}

export class BM25Retriever implements Retriever {
  // BM25 算法
}

export class HybridRetriever implements Retriever {
  // RRF k=60, 30% sparse / 70% dense
  constructor(
    private vectorRetriever: VectorRetriever,
    private bm25Retriever: BM25Retriever,
    private options?: { k?: number; weights?: [number, number] }
  ) {}
}

export class QueryFusionRetriever implements Retriever {
  // 1. LLM 生成 4 个查询变体
  // 2. 对每个变体执行 HybridRetriever
  // 3. RRF 融合所有结果
  // 4. 返回 topK
  constructor(
    private hybridRetriever: HybridRetriever,
    private llmProvider: LLMProvider
  ) {}
}
```

### 2.7 Rerankers（重排序器）
```typescript
export interface Reranker {
  rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]>;
}

export class HeuristicReranker implements Reranker {
  // 综合考虑:
  // 1. 原始分数（vector + bm25）
  // 2. 长度惩罚（避免过长/过短）
  // 3. 时间新鲜度
  // 4. 来源可信度（可选）
}

export class CrossEncoderReranker implements Reranker {  // P2
  // 调用 Cross-Encoder 模型
  // 需要外部 API
}
```

### 2.8 CitationEngine
```typescript
export interface Citation {
  chunkId: string;
  documentId: string;
  source: string;            // 文件路径 / URL
  title?: string;
  snippet: string;           // 引用片段
  startOffset: number;
  endOffset: number;
  relevanceScore: number;
}

export class CitationEngine {
  extractCitations(
    question: string,
    results: RetrievalResult[],
    options?: { maxCitations?: number; minScore?: number }
  ): Citation[];
  
  formatCitations(citations: Citation[], format: 'markdown' | 'html' | 'plain'): string;
}
```

## 三、RAGEngine 主类

```typescript
export interface RAGEngineOptions {
  embeddingModel?: EmbeddingModel;       // 默认 MockEmbedding
  vectorStore?: VectorStore;             // 默认 MemoryVectorStore
  splitter?: TextSplitter;               // 默认 RecursiveCharacterTextSplitter
  retriever?: Retriever;                 // 默认 HybridRetriever
  reranker?: Reranker;                   // 默认 HeuristicReranker
  citationEngine?: CitationEngine;       // 默认 new CitationEngine()
  llmProvider?: LLMProvider;             // 用于 QueryFusion + 答案生成
}

export class RAGEngine {
  // 文档管理
  addDocument(doc: Document | string, source?: string, options?: AddOptions): Promise<string>;
  addDocuments(docs: Document[], options?: AddOptions): Promise<string[]>;
  listDocuments(filter?: DocumentFilter): Document[];
  getDocument(id: string): Document | undefined;
  deleteDocument(id: string): Promise<boolean>;
  
  // 检索
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrievalResult[]>;
  hybridRetrieve(query: string, options?: HybridRetrieveOptions): Promise<RetrievalResult[]>;
  
  // RAG 完整流程
  query(question: string, options?: RAGQueryOptions): Promise<RAGResponse>;
  
  // 持久化
  save(storeName?: string): Promise<void>;
  load(storeName?: string): Promise<void>;
  
  // 统计
  getStats(): RAGStats;
}

export interface RAGResponse {
  answer: string;            // LLM 生成的答案
  citations: Citation[];     // 来源引用
  retrievalResults: RetrievalResult[];  // 原始检索结果
  metadata: {
    retrievalTimeMs: number;
    generationTimeMs: number;
    totalTokens?: number;
    cost?: number;
  };
}

export interface RAGQueryOptions {
  topK?: number;             // 默认 5
  useRerank?: boolean;       // 默认 true
  useFusion?: boolean;       // 默认 false
  citationFormat?: 'markdown' | 'html' | 'plain';
  maxContextTokens?: number; // 默认 4000
  llmOptions?: ChatOptions;
}
```

## 四、配置化

```typescript
export const DEFAULT_RAG_CONFIG: RAGEngineOptions = {
  embeddingModel: new MockEmbedding({ dimension: 256 }),
  vectorStore: new MemoryVectorStore(),
  splitter: new RecursiveCharacterTextSplitter({ chunkSize: 400, chunkOverlap: 3 }),
  reranker: new HeuristicReranker(),
  citationEngine: new CitationEngine(),
};

export function createRAGEngine(options?: RAGEngineOptions): RAGEngine {
  return new RAGEngine({ ...DEFAULT_RAG_CONFIG, ...options });
}
```

## 五、测试覆盖

| 模块 | 测试数 | 重点 |
|------|--------|------|
| Document 类型 | 5 | 结构 / 序列化 |
| Loaders | 12 | 5 个 Loader 各 2+ |
| Splitter | 8 | 切片 / overlap / 中英文 |
| Embedding | 10 | Mock 确定性 / 相似度 / 批量 |
| Vector Store | 12 | 增删查 / 持久化 / 过滤 |
| Retrievers | 18 | 4 个各 4-5 |
| Rerankers | 6 | 启发式分数 |
| CitationEngine | 5 | 提取 / 格式化 |
| RAGEngine | 14 | 完整流程 / 持久化 / 统计 |
| **合计** | **90** | - |

## 六、关键算法

### 6.1 RecursiveCharacterTextSplitter
```
function split(text, options) {
  const { chunkSize, chunkOverlap, separators } = options;
  const finalChunks = [];
  
  // 1. 选择合适的 separator（按优先级）
  let separator = separators[separators.length - 1];
  for (const sep of separators) {
    if (text.includes(sep)) {
      separator = sep;
      break;
    }
  }
  
  // 2. 按 separator 切分
  const splits = text.split(separator);
  
  // 3. 合并成 chunks
  let currentChunk = '';
  for (const split of splits) {
    if (tokenCount(currentChunk + split) > chunkSize) {
      finalChunks.push(currentChunk);
      // 保留 overlap
      currentChunk = currentChunk.slice(-chunkOverlap) + split;
    } else {
      currentChunk += separator + split;
    }
  }
  finalChunks.push(currentChunk);
  
  return finalChunks;
}
```

### 6.2 RRF (Reciprocal Rank Fusion)
```
function RRF(rankings, k = 60) {
  const scores = new Map();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i++) {
      const id = ranking[i].id;
      const score = 1 / (k + i + 1);
      scores.set(id, (scores.get(id) || 0) + score);
    }
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
```

### 6.3 BM25
```
function BM25(query, documents, k1 = 1.5, b = 0.75) {
  const tokenizedQuery = tokenize(query);
  const scores = new Map();
  
  // 1. 计算 IDF
  const N = documents.length;
  const df = new Map();
  for (const doc of documents) {
    for (const term of new Set(tokenize(doc))) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [term, freq] of df) {
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }
  
  // 2. 计算每个文档的 BM25 分数
  for (const doc of documents) {
    const docTokens = tokenize(doc);
    const docLen = docTokens.length;
    const avgdl = avgDocLength(documents);
    let score = 0;
    for (const term of tokenizedQuery) {
      const tf = docTokens.filter(t => t === term).length;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * docLen / avgdl);
      score += (idf.get(term) || 0) * numerator / denominator;
    }
    scores.set(doc, score);
  }
  
  return scores;
}
```

## 七、安全与限制

- 单文档大小限制: 10MB
- 检索结果数量限制: 默认 topK=5, 最大 20
- Token 上限: 默认 4000, 最大 16000
- 持久化: 仅 IndexedDB（同源）
- 错误处理: 文档加载失败返回错误而非崩溃

## 八、性能目标

- 文档加载: < 1s (10MB 以内)
- 文本切片: < 100ms (10K tokens)
- Embedding: < 500ms (单个文档)
- 向量检索: < 50ms (10K 向量)
- 混合检索: < 200ms (10K + 10K)
- 完整 RAG 流程: < 3s (含 LLM 调用)

## 九、API 示例

```typescript
import { createRAGEngine, MockEmbedding, IndexedDBVectorStore } from './ragEngine';

// 1. 创建引擎
const engine = createRAGEngine({
  embeddingModel: new MockEmbedding({ dimension: 256 }),
  vectorStore: new IndexedDBVectorStore('my-rag'),
});

// 2. 添加文档
const docId = await engine.addDocument(
  'React 是一个用于构建用户界面的 JavaScript 库。',
  'react-intro.md'
);

// 3. 检索
const results = await engine.retrieve('什么是 React？', { topK: 5 });

// 4. 完整 RAG
const response = await engine.query('React 是什么？', {
  topK: 5,
  useRerank: true,
  citationFormat: 'markdown',
});
console.log(response.answer);
console.log(response.citations);

// 5. 持久化
await engine.save();
```

## 十、未来扩展

- P1: PDFLoader (扩展 MultiModalProcessor)
- P1: HTMLLoader 增强（CSS 选择器）
- P1: 多模态 RAG（图像检索）
- P2: Cross-Encoder Reranker
- P2: GraphRAG（图结构知识库）
- P2: Self-RAG（自反思检索）
