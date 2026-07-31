/**
 * # ============================================================
 * # RAGPanel - RAG 知识库管理面板 (v1.0.0 Cycle 37 G37-01)
 * # ============================================================
 * # 核心作用：UI 面板，提供 RAG 知识库的文档管理、检索问答功能
 * #           支持添加文档 / 检索 / 完整 RAG 问答流程 / 统计
 * # 运行流程：
 * #   1. 文档管理：添加 / 列表 / 删除文档
 * #   2. 检索：输入查询，展示 topK 检索结果
 * #   3. RAG 问答：基于知识库生成答案 + 来源引用
 * #   4. 统计：文档数 / chunk 数 / 检索次数
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 37 G37-01 初次创建
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RAGEngine,
  createRAGEngine,
  RetrievalResult,
  RAGResponse,
  Document,
  Citation,
} from '../utils/ragEngine';

export interface RAGPanelProps {
  initialEngine?: RAGEngine;
  onClose?: () => void;
}

type TabType = 'documents' | 'retrieve' | 'query' | 'stats';

export function RAGPanel({ initialEngine, onClose }: RAGPanelProps) {
  const [engine] = useState(() => initialEngine ?? createRAGEngine());
  const [tab, setTab] = useState<TabType>('documents');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [newDocText, setNewDocText] = useState('');
  const [newDocSource, setNewDocSource] = useState('manual.md');
  const [isAdding, setIsAdding] = useState(false);

  const [queryText, setQueryText] = useState('');
  const [retrievalResults, setRetrievalResults] = useState<RetrievalResult[]>([]);
  const [ragResponse, setRagResponse] = useState<RAGResponse | null>(null);
  const [topK, setTopK] = useState(5);
  const [isSearching, setIsSearching] = useState(false);

  const [stats, setStats] = useState({
    totalDocuments: 0,
    totalChunks: 0,
    totalQueries: 0,
    avgRetrievalTimeMs: 0,
    avgGenerationTimeMs: 0,
  });

  // 刷新文档列表和统计
  const refresh = useCallback(() => {
    setDocuments(engine.listDocuments());
    setStats(engine.getStats());
  }, [engine]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 添加文档
  const handleAddDocument = async () => {
    if (!newDocText.trim() || isAdding) return;
    setIsAdding(true);
    try {
      await engine.addDocument(newDocText, newDocSource);
      setNewDocText('');
      refresh();
    } catch (err) {
      console.error('添加文档失败:', err);
    } finally {
      setIsAdding(false);
    }
  };

  // 删除文档
  const handleDeleteDocument = async (id: string) => {
    if (!confirm('确定要删除此文档吗？')) return;
    await engine.deleteDocument(id);
    refresh();
  };

  // 检索
  const handleRetrieve = async () => {
    if (!queryText.trim() || isSearching) return;
    setIsSearching(true);
    try {
      const results = await engine.retrieve(queryText, { topK });
      setRetrievalResults(results);
    } catch (err) {
      console.error('检索失败:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // RAG 问答
  const handleQuery = async () => {
    if (!queryText.trim() || isSearching) return;
    setIsSearching(true);
    try {
      const response = await engine.query(queryText, { topK, useRerank: true });
      setRagResponse(response);
      setRetrievalResults(response.retrievalResults);
    } catch (err) {
      console.error('问答失败:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // 预置示例文档
  const seedSampleData = async () => {
    setIsAdding(true);
    try {
      await engine.addDocument(
        'React 是一个用于构建用户界面的 JavaScript 库。它由 Facebook 开发并维护。React 使用组件化的开发模式，支持声明式编程和虚拟 DOM。',
        'react-intro.md'
      );
      await engine.addDocument(
        'TypeScript 是 JavaScript 的超集，添加了静态类型系统。它由 Microsoft 开发，可以编译成纯 JavaScript。TypeScript 提供了更好的 IDE 支持和代码提示。',
        'typescript-intro.md'
      );
      await engine.addDocument(
        '机器学习是人工智能的一个分支。它使计算机能够从数据中学习，而无需明确编程。常见的机器学习算法包括决策树、神经网络、支持向量机等。',
        'ml-intro.md'
      );
      refresh();
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="rag-panel" style={{ padding: 16, background: '#fff', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>📚 RAG 知识库</h2>
        {onClose && (
          <button onClick={onClose} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>关闭</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['documents', 'retrieve', 'query', 'stats'] as TabType[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 12px',
              background: tab === t ? '#3b82f6' : '#f3f4f6',
              color: tab === t ? '#fff' : '#374151',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t === 'documents' ? '文档管理' : t === 'retrieve' ? '检索' : t === 'query' ? '问答' : '统计'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'documents' && (
          <div>
            <div style={{ marginBottom: 16, padding: 12, background: '#f9fafb', borderRadius: 6 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>添加文档</h3>
              <input
                value={newDocSource}
                onChange={e => setNewDocSource(e.target.value)}
                placeholder="来源（如 manual.md）"
                style={{ width: '100%', padding: 6, marginBottom: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
              />
              <textarea
                value={newDocText}
                onChange={e => setNewDocText(e.target.value)}
                placeholder="文档内容..."
                style={{ width: '100%', minHeight: 80, padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleAddDocument}
                  disabled={isAdding || !newDocText.trim()}
                  style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                >
                  {isAdding ? '添加中...' : '添加文档'}
                </button>
                <button
                  onClick={seedSampleData}
                  disabled={isAdding}
                  style={{ padding: '6px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                >
                  加载示例
                </button>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>文档列表 ({documents.length})</h3>
              {documents.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: 13 }}>暂无文档</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {documents.map(doc => (
                    <div key={doc.id} style={{ padding: 10, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{doc.metadata.source}</div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                            {doc.chunks?.length || 0} 个 chunks · {doc.content.length} 字符
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          style={{ padding: '4px 8px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                        >
                          删除
                        </button>
                      </div>
                      <div style={{ fontSize: 12, color: '#374151', marginTop: 6, maxHeight: 60, overflow: 'hidden' }}>
                        {doc.content.slice(0, 150)}{doc.content.length > 150 && '...'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'retrieve' && (
          <div>
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 13 }}>topK:</label>
              <input
                type="number"
                min={1}
                max={20}
                value={topK}
                onChange={e => setTopK(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                style={{ width: 60, padding: 4, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </div>
            <textarea
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              placeholder="输入查询问题..."
              style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, marginBottom: 8, resize: 'vertical' }}
            />
            <button
              onClick={handleRetrieve}
              disabled={isSearching || !queryText.trim()}
              style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
            >
              {isSearching ? '检索中...' : '检索'}
            </button>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>检索结果 ({retrievalResults.length})</h3>
              {retrievalResults.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: 13 }}>暂无结果</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {retrievalResults.map((r, i) => (
                    <div key={r.chunk.id} style={{ padding: 10, background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1e40af' }}>#{i + 1} · 来源: {r.source}</span>
                        <span style={{ fontSize: 12, color: '#1e40af' }}>分数: {r.score.toFixed(3)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#1f2937' }}>{r.chunk.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'query' && (
          <div>
            <textarea
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              placeholder="输入问题，将基于知识库生成答案..."
              style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, marginBottom: 8, resize: 'vertical' }}
            />
            <button
              onClick={handleQuery}
              disabled={isSearching || !queryText.trim()}
              style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
            >
              {isSearching ? '生成中...' : '生成答案'}
            </button>

            {ragResponse && (
              <div style={{ marginTop: 16 }}>
                <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 6, border: '1px solid #86efac', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#166534', margin: '0 0 8px' }}>💡 答案</h3>
                  <div style={{ fontSize: 13, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{ragResponse.answer}</div>
                </div>

                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                  ⏱️ 检索 {ragResponse.metadata.retrievalTimeMs}ms · 生成 {ragResponse.metadata.generationTimeMs}ms
                </div>

                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>📖 来源引用 ({ragResponse.citations.length})</h3>
                {ragResponse.citations.length === 0 ? (
                  <p style={{ color: '#6b7280', fontSize: 13 }}>无来源引用</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ragResponse.citations.map((c: Citation, i) => (
                      <div key={c.chunkId} style={{ padding: 8, background: '#fefce8', borderRadius: 4, border: '1px solid #fde047' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#854d0e', marginBottom: 2 }}>
                          [{i + 1}] {c.title || c.source}
                        </div>
                        <div style={{ fontSize: 12, color: '#1f2937' }}>{c.snippet}</div>
                        <div style={{ fontSize: 11, color: '#854d0e', marginTop: 4 }}>相关度: {(c.relevanceScore * 100).toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'stats' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <StatCard label="文档总数" value={stats.totalDocuments} />
            <StatCard label="Chunk 总数" value={stats.totalChunks} />
            <StatCard label="查询次数" value={stats.totalQueries} />
            <StatCard label="平均检索时间" value={`${stats.avgRetrievalTimeMs}ms`} />
            <StatCard label="平均生成时间" value={`${stats.avgGenerationTimeMs}ms`} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: '#1f2937' }}>{value}</div>
    </div>
  );
}

export default RAGPanel;
