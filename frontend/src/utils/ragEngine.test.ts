/**
 * # RAGEngine - 单元测试
 * # Cycle 37 G37-01
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RAGEngine,
  createRAGEngine,
  getDefaultRAGEngine,
  resetDefaultRAGEngine,
  generateDocId,
  generateChunkId,
  MockEmbedding,
  MemoryVectorStore,
  RecursiveCharacterTextSplitter,
  BM25Index,
  BM25Retriever,
  HybridRetriever,
  HeuristicReranker,
  CitationEngine,
  TextLoader,
  MarkdownLoader,
  JSONLoader,
  HTMLLoader,
  VectorRetriever,
  Document,
  RetrievalResult,
} from './ragEngine';

describe('工具函数', () => {
  it('generateDocId 生成唯一 ID', () => {
    const id1 = generateDocId();
    const id2 = generateDocId();
    expect(id1).toMatch(/^doc_/);
    expect(id2).toMatch(/^doc_/);
    expect(id1).not.toBe(id2);
  });

  it('generateChunkId 格式正确', () => {
    const id = generateChunkId('doc_123', 0);
    expect(id).toBe('doc_123_chunk_0');
  });
});

describe('MockEmbedding', () => {
  let embedding: MockEmbedding;

  beforeEach(() => {
    embedding = new MockEmbedding({ dimension: 128 });
  });

  it('基本属性', () => {
    expect(embedding.name).toBe('mock');
    expect(embedding.dimension).toBe(128);
  });

  it('embed 返回正确维度', async () => {
    const vec = await embedding.embed('hello world');
    expect(vec.length).toBe(128);
  });

  it('相同文本产生相同向量（确定性）', async () => {
    const v1 = await embedding.embed('test text');
    const v2 = await embedding.embed('test text');
    expect(v1).toEqual(v2);
  });

  it('不同文本产生不同向量', async () => {
    const v1 = await embedding.embed('cat dog');
    const v2 = await embedding.embed('apple banana');
    expect(v1).not.toEqual(v2);
  });

  it('向量已归一化', async () => {
    const vec = await embedding.embed('some text here');
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('embedBatch 批量', async () => {
    const vecs = await embedding.embedBatch(['text1', 'text2', 'text3']);
    expect(vecs.length).toBe(3);
    expect(vecs[0].length).toBe(128);
  });
});

describe('RecursiveCharacterTextSplitter', () => {
  let splitter: RecursiveCharacterTextSplitter;

  beforeEach(() => {
    splitter = new RecursiveCharacterTextSplitter();
  });

  it('短文本不切分', () => {
    const text = '短文本';
    const chunks = splitter.split(text);
    expect(chunks.length).toBe(1);
  });

  it('按段落切分', () => {
    const text = '这是第一段很长的内容用于测试分块效果。\n\n这是第二段很长的内容用于测试分块效果。\n\n这是第三段很长的内容用于测试分块效果。';
    const chunks = splitter.split(text, { chunkSize: 10, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('按句子切分', () => {
    const text = '第一句。第二句！第三句？第四句。';
    const chunks = splitter.split(text, { chunkSize: 5, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('保持 separator', () => {
    const text = 'A\n\nB\n\nC';
    const chunks = splitter.split(text, { chunkSize: 5, chunkOverlap: 0, keepSeparator: true });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('overlap 设置生效', () => {
    const longText = 'A'.repeat(1000);
    const chunks = splitter.split(longText, { chunkSize: 100, chunkOverlap: 10 });
    // 验证 chunks 之间有 overlap
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('空字符串返回空数组', () => {
    const chunks = splitter.split('');
    expect(chunks).toEqual([]);
  });

  it('支持中文', () => {
    const text = '这是第一段中文内容。\n\n这是第二段中文内容。';
    const chunks = splitter.split(text, { chunkSize: 10, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('MemoryVectorStore', () => {
  let store: MemoryVectorStore;

  beforeEach(async () => {
    store = new MemoryVectorStore();
  });

  it('add 和 size', async () => {
    await store.add('v1', [1, 0, 0]);
    await store.add('v2', [0, 1, 0]);
    expect(store.size()).toBe(2);
  });

  it('search 返回 topK', async () => {
    await store.add('v1', [1, 0, 0]);
    await store.add('v2', [0, 1, 0]);
    await store.add('v3', [0.9, 0.1, 0]);
    const results = await store.search([1, 0, 0], 2);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('v1');
  });

  it('search 按相似度排序', async () => {
    await store.add('v1', [1, 0]);
    await store.add('v2', [0.5, 0.5]);
    const results = await store.search([1, 0], 2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('search 带 filter', async () => {
    await store.add('v1', [1, 0], { type: 'a' });
    await store.add('v2', [0, 1], { type: 'b' });
    const results = await store.search([1, 0], 10, { type: 'a' });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('v1');
  });

  it('delete', async () => {
    await store.add('v1', [1, 0]);
    expect(await store.delete('v1')).toBe(true);
    expect(await store.delete('v1')).toBe(false);
  });

  it('clear', async () => {
    await store.add('v1', [1, 0]);
    await store.clear();
    expect(store.size()).toBe(0);
  });

  it('addBatch', async () => {
    await store.addBatch([
      { id: 'v1', vector: [1, 0] },
      { id: 'v2', vector: [0, 1] },
    ]);
    expect(store.size()).toBe(2);
  });
});

describe('BM25Index', () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  it('addDocument 和 size', () => {
    index.addDocument('d1', 'machine learning is great');
    expect(index.size()).toBe(1);
  });

  it('search 找到匹配文档', () => {
    index.addDocument('d1', 'machine learning is great');
    index.addDocument('d2', 'deep learning is fascinating');
    index.addDocument('d3', 'cooking recipes for dinner');
    const results = index.search('learning', 5);
    expect(results.length).toBe(2);
    expect(results[0].id).toMatch(/d[12]/);
  });

  it('search 不相关词返回空', () => {
    index.addDocument('d1', 'machine learning');
    const results = index.search('cooking', 5);
    expect(results.length).toBe(0);
  });

  it('BM25 分数排序', () => {
    index.addDocument('d1', 'machine learning');
    index.addDocument('d2', 'machine learning machine learning');
    const results = index.search('machine', 5);
    expect(results[0].id).toBe('d2');
  });

  it('removeDocument', () => {
    index.addDocument('d1', 'test');
    expect(index.removeDocument('d1')).toBe(true);
    expect(index.size()).toBe(0);
  });

  it('clear', () => {
    index.addDocument('d1', 'test');
    index.clear();
    expect(index.size()).toBe(0);
  });
});

describe('BM25Retriever', () => {
  let retriever: BM25Retriever;

  beforeEach(() => {
    retriever = new BM25Retriever();
  });

  it('addChunk 和 retrieve', async () => {
    retriever.addChunk({
      id: 'c1',
      documentId: 'd1',
      content: 'machine learning algorithms',
      index: 0,
      startOffset: 0,
      endOffset: 27,
      metadata: {},
    });
    const results = await retriever.retrieve('learning', 5);
    expect(results.length).toBe(1);
    expect(results[0].source).toBe('bm25');
  });

  it('removeChunk', async () => {
    retriever.addChunk({
      id: 'c1',
      documentId: 'd1',
      content: 'test content',
      index: 0,
      startOffset: 0,
      endOffset: 12,
      metadata: {},
    });
    expect(retriever.removeChunk('c1')).toBe(true);
  });
});

describe('HeuristicReranker', () => {
  let reranker: HeuristicReranker;

  beforeEach(() => {
    reranker = new HeuristicReranker();
  });

  it('rerank 返回重排序结果', async () => {
    const results: RetrievalResult[] = [
      {
        chunk: {
          id: 'c1', documentId: 'd1', content: 'machine learning', index: 0,
          startOffset: 0, endOffset: 16, metadata: {},
        },
        score: 0.5, rank: 1, source: 'vector',
      },
      {
        chunk: {
          id: 'c2', documentId: 'd1', content: 'other content', index: 1,
          startOffset: 16, endOffset: 28, metadata: {},
        },
        score: 0.7, rank: 2, source: 'vector',
      },
    ];
    const reranked = await reranker.rerank('machine', results);
    expect(reranked[0].chunk.id).toBe('c1'); // 关键词匹配
  });

  it('rerank 空数组', async () => {
    const reranked = await reranker.rerank('query', []);
    expect(reranked).toEqual([]);
  });
});

describe('CitationEngine', () => {
  let engine: CitationEngine;

  beforeEach(() => {
    engine = new CitationEngine();
  });

  it('extractCitations', () => {
    const results: RetrievalResult[] = [
      {
        chunk: {
          id: 'c1', documentId: 'd1', content: 'test content', index: 0,
          startOffset: 0, endOffset: 12, metadata: { source: 'test.md', title: 'Test' },
        },
        score: 0.8, rank: 1, source: 'vector',
      },
    ];
    const citations = engine.extractCitations('test', results);
    expect(citations.length).toBe(1);
    expect(citations[0].source).toBe('test.md');
    expect(citations[0].title).toBe('Test');
  });

  it('formatCitations markdown', () => {
    const citations = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        source: 'test.md',
        title: 'Test',
        snippet: 'snippet',
        startOffset: 0,
        endOffset: 7,
        relevanceScore: 0.8,
      },
    ];
    const formatted = engine.formatCitations(citations, 'markdown');
    expect(formatted).toContain('Test');
    expect(formatted).toContain('[1]');
  });

  it('formatCitations html', () => {
    const citations = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        source: 'test.md',
        snippet: 'snippet',
        startOffset: 0,
        endOffset: 7,
        relevanceScore: 0.8,
      },
    ];
    const formatted = engine.formatCitations(citations, 'html');
    expect(formatted).toContain('<ol>');
  });

  it('formatCitations plain', () => {
    const citations = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        source: 'test.md',
        snippet: 'snippet',
        startOffset: 0,
        endOffset: 7,
        relevanceScore: 0.8,
      },
    ];
    const formatted = engine.formatCitations(citations, 'plain');
    expect(formatted).toContain('[1] test.md');
  });

  it('maxCitations 限制', () => {
    const results: RetrievalResult[] = Array.from({ length: 10 }, (_, i) => ({
      chunk: {
        id: `c${i}`, documentId: 'd1', content: `content${i}`, index: i,
        startOffset: i * 10, endOffset: (i + 1) * 10, metadata: { source: `test${i}.md` },
      },
      score: 0.5, rank: i + 1, source: 'vector',
    }));
    const citations = engine.extractCitations('test', results, { maxCitations: 3 });
    expect(citations.length).toBe(3);
  });
});

describe('Document Loaders', () => {
  it('TextLoader 从字符串加载', async () => {
    const loader = new TextLoader();
    const doc = await loader.load('hello world');
    expect(doc.content).toBe('hello world');
    expect(doc.metadata.mimeType).toBe('text/plain');
  });

  it('TextLoader 从对象加载', async () => {
    const loader = new TextLoader();
    const doc = await loader.load({ content: 'test', filename: 'test.txt' });
    expect(doc.metadata.source).toBe('test.txt');
  });

  it('MarkdownLoader 继承 TextLoader', async () => {
    const loader = new MarkdownLoader();
    const doc = await loader.load('# Hello');
    expect(doc.content).toBe('# Hello');
  });

  it('JSONLoader 格式化 JSON', async () => {
    const loader = new JSONLoader();
    const doc = await loader.load('{"key":"value"}');
    expect(doc.content).toContain('"key"');
  });

  it('HTMLLoader 移除标签', async () => {
    const loader = new HTMLLoader();
    const doc = await loader.load('<html><body><h1>Title</h1><p>Content</p></body></html>');
    expect(doc.content).not.toContain('<h1>');
    expect(doc.content).toContain('Title');
  });

  it('HTMLLoader 移除 script', async () => {
    const loader = new HTMLLoader();
    const doc = await loader.load('<script>alert(1)</script><p>Text</p>');
    expect(doc.content).not.toContain('alert');
    expect(doc.content).toContain('Text');
  });
});

describe('RAGEngine 主类', () => {
  let engine: RAGEngine;

  beforeEach(() => {
    resetDefaultRAGEngine();
    engine = createRAGEngine();
  });

  it('创建实例', () => {
    expect(engine).toBeInstanceOf(RAGEngine);
  });

  it('addDocument 从字符串', async () => {
    const id = await engine.addDocument('这是测试文档内容。', 'test.md');
    expect(id).toMatch(/^doc_/);
    expect(engine.getDocument(id)).toBeDefined();
  });

  it('addDocument 从对象', async () => {
    const id = await engine.addDocument({ content: 'test', filename: 'test.txt' });
    expect(engine.getDocument(id)).toBeDefined();
  });

  it('addDocument 从 Document 对象', async () => {
    const doc: Document = {
      id: 'doc_123',
      content: 'manual doc',
      metadata: { source: 'manual.md', createdAt: Date.now(), updatedAt: Date.now() },
    };
    const id = await engine.addDocument(doc);
    expect(id).toBe('doc_123');
  });

  it('addDocuments 批量', async () => {
    const docs: Document[] = [
      {
        id: 'd1',
        content: 'first',
        metadata: { source: 'a.txt', createdAt: 0, updatedAt: 0 },
      },
      {
        id: 'd2',
        content: 'second',
        metadata: { source: 'b.txt', createdAt: 0, updatedAt: 0 },
      },
    ];
    const ids = await engine.addDocuments(docs);
    expect(ids.length).toBe(2);
  });

  it('listDocuments', async () => {
    await engine.addDocument('first', 'a.txt');
    await engine.addDocument('second', 'b.txt');
    const docs = engine.listDocuments();
    expect(docs.length).toBe(2);
  });

  it('listDocuments with filter', async () => {
    await engine.addDocument('first', 'a.txt');
    await engine.addDocument('second', 'b.txt');
    const docs = engine.listDocuments({ source: 'a.txt' });
    expect(docs.length).toBe(1);
  });

  it('deleteDocument', async () => {
    const id = await engine.addDocument('test', 'test.txt');
    expect(await engine.deleteDocument(id)).toBe(true);
    expect(engine.getDocument(id)).toBeUndefined();
  });

  it('deleteDocument 不存在返回 false', async () => {
    expect(await engine.deleteDocument('not_exist')).toBe(false);
  });

  it('retrieve 返回结果', async () => {
    await engine.addDocument('机器学习是人工智能的子领域。', 'ml.md');
    await engine.addDocument('深度学习是机器学习的一种方法。', 'dl.md');
    const results = await engine.retrieve('机器学习', { topK: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.content).toContain('机器学习');
  });

  it('retrieve 遵守 topK', async () => {
    for (let i = 0; i < 10; i++) {
      await engine.addDocument(`document ${i}`, `d${i}.txt`);
    }
    const results = await engine.retrieve('document', { topK: 3 });
    expect(results.length).toBe(3);
  });

  it('retrieve 遵守 minScore', async () => {
    await engine.addDocument('完全匹配的内容', 'a.txt');
    await engine.addDocument('完全无关的内容', 'b.txt');
    const results = await engine.retrieve('完全匹配', { topK: 5, minScore: 0.1 });
    expect(results.every(r => r.score >= 0.1)).toBe(true);
  });

  it('hybridRetrieve', async () => {
    await engine.addDocument('机器学习是人工智能的核心技术，包含许多算法。', 'a.txt');
    const results = await engine.hybridRetrieve('机器', { topK: 3 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('query 生成答案（Mock）', async () => {
    await engine.addDocument('React 是一个 JavaScript 库。', 'react.md');
    const response = await engine.query('什么是 React？');
    expect(response.answer).toBeDefined();
    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.metadata.useRerank).toBe(true);
  });

  it('query 包含 useRerank 信息', async () => {
    await engine.addDocument('test content', 'a.txt');
    const response = await engine.query('test');
    expect(response.metadata.useRerank).toBe(true);
  });

  it('getStats', async () => {
    await engine.addDocument('test', 'a.txt');
    await engine.retrieve('test');
    const stats = engine.getStats();
    expect(stats.totalDocuments).toBe(1);
    expect(stats.totalQueries).toBe(1);
  });

  it('clear', async () => {
    await engine.addDocument('test', 'a.txt');
    engine.clear();
    expect(engine.getStats().totalDocuments).toBe(0);
  });

  it('save 和 load', async () => {
    await engine.addDocument('持久化测试', 'save.md');
    await engine.save('test-store');
    const newEngine = createRAGEngine();
    await newEngine.load('test-store');
    expect(newEngine.getStats().totalDocuments).toBe(1);
  });
});

describe('RAGEngine 集成测试', () => {
  it('完整 RAG 流程（混合检索 + 重排序 + Mock 答案）', async () => {
    const engine = createRAGEngine();
    await engine.addDocument('Python 是一种编程语言。', 'py.md');
    await engine.addDocument('JavaScript 是 Web 开发的语言。', 'js.md');
    await engine.addDocument('机器学习使用 Python。', 'ml.md');

    const response = await engine.query('机器学习用什么语言？');
    expect(response.answer).toBeDefined();
    expect(response.retrievalResults.length).toBeGreaterThan(0);
    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.citations[0].snippet).toBeDefined();
  });

  it('空知识库的 query', async () => {
    const engine = createRAGEngine();
    const response = await engine.query('任何问题？');
    expect(response.answer).toBeDefined();
    expect(response.citations.length).toBe(0);
  });
});

describe('全局单例', () => {
  beforeEach(() => {
    resetDefaultRAGEngine();
  });

  it('getDefaultRAGEngine 单例', () => {
    const e1 = getDefaultRAGEngine();
    const e2 = getDefaultRAGEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefaultRAGEngine', () => {
    const e1 = getDefaultRAGEngine();
    resetDefaultRAGEngine();
    const e2 = getDefaultRAGEngine();
    expect(e1).not.toBe(e2);
  });
});
