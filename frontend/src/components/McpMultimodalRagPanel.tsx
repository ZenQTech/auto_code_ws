/**
 * # ============================================================
 * # McpMultimodalRagPanel - MCP × 多模态 RAG 面板 (v1.0.0 Cycle 48)
 * # ============================================================
 * # 核心作用：集成多模态 RAG 性能优化套件到主应用
 * #           - Tab 1: 多模态 Embedding (CLIP 风格)
 * #           - Tab 2: 图文混合索引 (Cross-Modal Vector Index)
 * #           - Tab 3: 跨模态缓存 (Multimodal Semantic Cache)
 * #           - Tab 4: 性能基准 (Multimodal Benchmark)
 * #           - Tab 5: 系统设置
 * # ============================================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 48 G48 主应用集成
 * # ============================================================
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MultimodalEmbedding, type EmbeddingResult, type Modality } from '../utils/multimodalEmbedding';
import { MultimodalVectorIndex, type CrossModalSearchResult } from '../utils/multimodalVectorIndex';
import { MultimodalSemanticCache, type MultimodalCacheStats, type MultimodalCacheHit } from '../utils/multimodalSemanticCache';
import { MultimodalRAGBenchmark, type MultimodalBenchmarkReport } from '../utils/multimodalBenchmark';

// ============ Props ============

export interface McpMultimodalRagPanelProps {
  onClose: () => void;
}

// ============ 类型定义 ============

type TabKey = 'embedding' | 'index' | 'cache' | 'benchmark' | 'settings';

interface BenchmarkResult {
  report?: MultimodalBenchmarkReport;
  running: boolean;
  error?: string;
}

// ============ 样式 ============

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  backdropFilter: 'blur(4px)',
};

const contentStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  borderRadius: 16,
  width: '92vw',
  maxWidth: 1280,
  height: '88vh',
  display: 'flex',
  flexDirection: 'column',
  color: '#e4e4e7',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '20px 24px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: 'rgba(0, 0, 0, 0.2)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: 0,
  color: '#fff',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#a1a1aa',
  margin: '4px 0 0 0',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.15)',
  color: '#fca5a5',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  borderRadius: 8,
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '12px 24px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'rgba(0, 0, 0, 0.15)',
  overflowX: 'auto',
};

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
  color: active ? '#c4b5fd' : '#a1a1aa',
  border: '1px solid ' + (active ? 'rgba(139, 92, 246, 0.4)' : 'transparent'),
  borderRadius: 8,
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  transition: 'all 0.15s',
});

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  border: '1px solid rgba(255, 255, 255, 0.08)',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
  color: '#e4e4e7',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#e4e4e7',
  fontSize: 13,
  width: '100%',
  marginBottom: 8,
};

const buttonStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  marginRight: 8,
};

const statCardStyle: React.CSSProperties = {
  background: 'rgba(139, 92, 246, 0.1)',
  borderRadius: 8,
  padding: 12,
  border: '1px solid rgba(139, 92, 246, 0.2)',
  textAlign: 'center',
};

const statValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: '#c4b5fd',
  margin: 0,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#a1a1aa',
  margin: '4px 0 0 0',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  background: color + '20',
  color: color,
  border: '1px solid ' + color + '40',
  marginRight: 4,
});

// ============ 主组件 ============

export function McpMultimodalRagPanel({ onClose }: McpMultimodalRagPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('embedding');
  const [initialized, setInitialized] = useState(false);

  // 单例化的引擎实例
  const embeddingRef = useRef<MultimodalEmbedding | null>(null);
  const indexRef = useRef<MultimodalVectorIndex | null>(null);
  const cacheRef = useRef<MultimodalSemanticCache<string> | null>(null);
  const benchmarkRef = useRef<MultimodalRAGBenchmark | null>(null);

  useEffect(() => {
    if (!initialized) {
      const dim = 256;
      embeddingRef.current = new MultimodalEmbedding({ dimension: dim });
      indexRef.current = new MultimodalVectorIndex({ dimension: dim });
      cacheRef.current = new MultimodalSemanticCache<string>({ dimension: dim });
      benchmarkRef.current = new MultimodalRAGBenchmark({ dimension: dim });
      setInitialized(true);
    }
  }, [initialized]);

  const tabLabels: Record<TabKey, string> = {
    embedding: '🎨 多模态 Embedding',
    index: '🖼️ 图文混合索引',
    cache: '💾 跨模态缓存',
    benchmark: '⚡ 性能基准',
    settings: '⚙️ 系统设置',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={titleStyle}>🎨 MCP × 多模态 RAG</h2>
            <p style={subtitleStyle}>CLIP 风格 Embedding · 图文混合索引 · 跨模态缓存 · 性能基准</p>
          </div>
          <button style={closeButtonStyle} onClick={onClose}>
            ✕ 关闭
          </button>
        </div>

        {/* Tabs */}
        <div style={tabsStyle}>
          {(Object.keys(tabLabels) as TabKey[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={tabButtonStyle(activeTab === tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={contentAreaStyle}>
          {activeTab === 'embedding' && embeddingRef.current && (
            <EmbeddingTab embedding={embeddingRef.current} />
          )}
          {activeTab === 'index' && indexRef.current && (
            <IndexTab index={indexRef.current} />
          )}
          {activeTab === 'cache' && cacheRef.current && (
            <CacheTab cache={cacheRef.current} />
          )}
          {activeTab === 'benchmark' && benchmarkRef.current && (
            <BenchmarkTab benchmark={benchmarkRef.current} />
          )}
          {activeTab === 'settings' && (
            <SettingsTab />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 1: 多模态 Embedding ============

function EmbeddingTab({ embedding }: { embedding: MultimodalEmbedding }) {
  const [text, setText] = useState('a red sports car');
  const [image, setImage] = useState('https://example.com/red-car.jpg');
  const [modality, setModality] = useState<Modality>('multimodal');
  const [result, setResult] = useState<EmbeddingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const providers = embedding.listProviders();

  const handleEmbed = async () => {
    setLoading(true);
    setError(null);
    try {
      let r: EmbeddingResult;
      if (modality === 'text') {
        r = await embedding.embedText(text);
      } else if (modality === 'image') {
        r = await embedding.embedImage(image);
      } else {
        r = await embedding.embedMultimodal(text, image);
      }
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Providers Stats */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🎨 多模态 Embedding 引擎</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {providers.map((p) => (
            <div key={p.name} style={statCardStyle}>
              <p style={statValueStyle}>{p.dimension}</p>
              <p style={statLabelStyle}>{p.name} dim</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0 }}>
          模态支持: {providers[0]?.modalities.join(', ')}
        </p>
      </div>

      {/* Embedding Form */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🧪 实时 Embedding 测试</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['text', 'image', 'multimodal'] as Modality[]).map((m) => (
            <button
              key={m}
              style={tabButtonStyle(modality === m)}
              onClick={() => setModality(m)}
            >
              {m}
            </button>
          ))}
        </div>
        {modality !== 'image' && (
          <input
            style={inputStyle}
            placeholder="输入文本..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        {modality !== 'text' && (
          <input
            style={inputStyle}
            placeholder="输入图像 URL 或路径..."
            value={image}
            onChange={(e) => setImage(e.target.value)}
          />
        )}
        <button style={buttonStyle} onClick={handleEmbed} disabled={loading}>
          {loading ? '⏳ 计算中...' : '🚀 生成 Embedding'}
        </button>
        {error && <p style={{ color: '#fca5a5', fontSize: 13 }}>错误: {error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>
            📊 嵌入结果
            <span style={badgeStyle('#8b5cf6')}>{result.provider}</span>
            {result.cached && <span style={badgeStyle('#10b981')}>缓存</span>}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{result.dimension}</p>
              <p style={statLabelStyle}>维度</p>
            </div>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{result.modality}</p>
              <p style={statLabelStyle}>模态</p>
            </div>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{result.durationMs}ms</p>
              <p style={statLabelStyle}>耗时</p>
            </div>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{(result.vector.reduce((s, v) => s + v * v, 0)).toFixed(3)}</p>
              <p style={statLabelStyle}>L2 范数²</p>
            </div>
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#a1a1aa' }}>
              查看向量前 10 维
            </summary>
            <pre style={{ fontSize: 11, color: '#a1a1aa', overflow: 'auto', maxHeight: 200 }}>
              {JSON.stringify(result.vector.slice(0, 10), null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Engine Stats */}
      <EngineStatsCard embedding={embedding} />
    </div>
  );
}

function EngineStatsCard({ embedding }: { embedding: MultimodalEmbedding }) {
  const [stats, setStats] = useState(embedding.getStats());

  useEffect(() => {
    const unsub = embedding.subscribe(() => setStats(embedding.getStats()));
    return () => { unsub(); };
  }, [embedding]);

  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>📈 引擎统计</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div style={statCardStyle}>
          <p style={statValueStyle}>{stats.totalEmbeds}</p>
          <p style={statLabelStyle}>总嵌入数</p>
        </div>
        <div style={statCardStyle}>
          <p style={statValueStyle}>{stats.totalCacheHits}</p>
          <p style={statLabelStyle}>缓存命中</p>
        </div>
        <div style={statCardStyle}>
          <p style={statValueStyle}>{(stats.cacheHitRate * 100).toFixed(1)}%</p>
          <p style={statLabelStyle}>命中率</p>
        </div>
        <div style={statCardStyle}>
          <p style={statValueStyle}>{stats.totalFallbacks}</p>
          <p style={statLabelStyle}>降级次数</p>
        </div>
      </div>
    </div>
  );
}

// ============ Tab 2: 图文混合索引 ============

function IndexTab({ index }: { index: MultimodalVectorIndex }) {
  const [text, setText] = useState('a red sports car');
  const [image, setImage] = useState('https://example.com/car.jpg');
  const [queryModality, setQueryModality] = useState<Modality>('text');
  const [results, setResults] = useState<CrossModalSearchResult[]>([]);
  const [stats, setStats] = useState(index.getStats());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = index.subscribe(() => setStats(index.getStats()));
    return () => { unsub(); };
  }, [index]);

  const handleSeed = async () => {
    setLoading(true);
    try {
      await index.addDocuments([
        { id: 'demo-1', text: 'a red sports car parked in the garage', image: 'car1.jpg', primaryModality: 'multimodal' },
        { id: 'demo-2', text: 'a blue ocean with white waves', image: 'ocean1.jpg', primaryModality: 'multimodal' },
        { id: 'demo-3', text: 'a green forest with tall pine trees', image: 'forest1.jpg', primaryModality: 'multimodal' },
        { id: 'demo-4', text: 'a cute orange cat sitting on a sofa', image: 'cat1.jpg', primaryModality: 'multimodal' },
        { id: 'demo-5', text: 'a bright yellow sun in the blue sky', image: 'sun1.jpg', primaryModality: 'multimodal' },
        { id: 'demo-6', text: 'snow-capped mountain peaks', image: 'mountain1.jpg', primaryModality: 'multimodal' },
        { id: 'demo-7', text: 'a delicious pepperoni pizza', image: 'pizza1.jpg', primaryModality: 'multimodal' },
        { id: 'demo-8', text: 'a rocket launching into space', image: 'rocket1.jpg', primaryModality: 'multimodal' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    try {
      let r: CrossModalSearchResult[];
      if (queryModality === 'text') {
        r = await index.searchByText(text, { topK: 5 });
      } else if (queryModality === 'image') {
        r = await index.searchByImage(image, { topK: 5 });
      } else {
        r = await index.searchByMultimodal(text, image, { topK: 5 });
      }
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Index Stats */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🖼️ 图文混合向量索引</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.totalDocuments}</p>
            <p style={statLabelStyle}>总文档</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.textDocuments}</p>
            <p style={statLabelStyle}>文本</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.imageDocuments}</p>
            <p style={statLabelStyle}>图像</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.multimodalDocuments}</p>
            <p style={statLabelStyle}>多模态</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.dimension}</p>
            <p style={statLabelStyle}>维度</p>
          </div>
        </div>
      </div>

      {/* Seed Data */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📥 数据准备</h3>
        <button style={buttonStyle} onClick={handleSeed} disabled={loading}>
          📚 加载 8 个示例文档
        </button>
        <button style={buttonStyle} onClick={() => index.clear()}>
          🗑️ 清空索引
        </button>
      </div>

      {/* Search Form */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🔍 跨模态检索</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['text', 'image', 'multimodal'] as Modality[]).map((m) => (
            <button
              key={m}
              style={tabButtonStyle(queryModality === m)}
              onClick={() => setQueryModality(m)}
            >
              {m}
            </button>
          ))}
        </div>
        {queryModality !== 'image' && (
          <input
            style={inputStyle}
            placeholder="查询文本..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        {queryModality !== 'text' && (
          <input
            style={inputStyle}
            placeholder="查询图像 URL..."
            value={image}
            onChange={(e) => setImage(e.target.value)}
          />
        )}
        <button style={buttonStyle} onClick={handleSearch} disabled={loading}>
          {loading ? '⏳ 检索中...' : '🔎 检索'}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>📋 检索结果 ({results.length})</h3>
          {results.map((r) => (
            <div
              key={r.document.id}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, color: '#c4b5fd' }}>#{r.rank + 1} {r.document.id}</span>
                  <span style={badgeStyle('#8b5cf6')}>{r.matchedModality}</span>
                  {r.document.isMultimodal && <span style={badgeStyle('#10b981')}>多模态</span>}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>
                  {(r.score * 100).toFixed(1)}%
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#a1a1aa', margin: '4px 0 0 0' }}>
                {r.document.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Tab 3: 跨模态缓存 ============

function CacheTab({ cache }: { cache: MultimodalSemanticCache<string> }) {
  const [key, setKey] = useState('how to make a cake');
  const [value, setValue] = useState('Mix flour, eggs, and sugar, then bake at 350°F for 30 minutes.');
  const [hit, setHit] = useState<MultimodalCacheHit<string> | null>(null);
  const [stats, setStats] = useState(cache.getStats());

  useEffect(() => {
    const unsub = cache.subscribe(() => setStats(cache.getStats()));
    return () => { unsub(); };
  }, [cache]);

  const handleSet = async () => {
    await cache.set({ modality: 'text', text: key }, value);
  };

  const handleGet = async () => {
    const r = await cache.get({ modality: 'text', text: key });
    setHit(r);
  };

  return (
    <div>
      {/* Stats */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>💾 跨模态语义缓存</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.totalEntries}</p>
            <p style={statLabelStyle}>总条目</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.totalQueries}</p>
            <p style={statLabelStyle}>总查询</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{(stats.hitRate * 100).toFixed(1)}%</p>
            <p style={statLabelStyle}>命中率</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{(stats.crossModalityHitRate * 100).toFixed(1)}%</p>
            <p style={statLabelStyle}>跨模态命中</p>
          </div>
        </div>
      </div>

      {/* Operations */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>⚙️ 缓存操作</h3>
        <input
          style={inputStyle}
          placeholder="缓存 Key (文本)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="缓存 Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button style={buttonStyle} onClick={handleSet}>💾 SET</button>
        <button style={buttonStyle} onClick={handleGet}>🔍 GET</button>
        <button style={buttonStyle} onClick={() => { cache.clear(); setHit(null); }}>🗑️ CLEAR</button>
      </div>

      {/* Hit Result */}
      {hit && (
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>
            ✨ 命中结果
            <span style={badgeStyle('#8b5cf6')}>{hit.hitType}</span>
            <span style={badgeStyle('#10b981')}>sim: {(hit.similarity * 100).toFixed(1)}%</span>
          </h3>
          <pre style={{ fontSize: 12, color: '#a1a1aa', overflow: 'auto' }}>
            {JSON.stringify({ value: hit.entry.value, hitType: hit.hitType, similarity: hit.similarity }, null, 2)}
          </pre>
        </div>
      )}

      {/* Detailed Stats */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📊 详细统计</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.exactHits}</p>
            <p style={statLabelStyle}>精确命中</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.semanticTextHits}</p>
            <p style={statLabelStyle}>文本语义</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.semanticImageHits}</p>
            <p style={statLabelStyle}>图像语义</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.semanticFusedHits}</p>
            <p style={statLabelStyle}>融合语义</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.semanticCrossHits}</p>
            <p style={statLabelStyle}>跨模态</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.misses}</p>
            <p style={statLabelStyle}>未命中</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Tab 4: 性能基准 ============

function BenchmarkTab({ benchmark }: { benchmark: MultimodalRAGBenchmark }) {
  const [result, setResult] = useState<BenchmarkResult>({ running: false });
  const [docCount, setDocCount] = useState(20);
  const [queryCount, setQueryCount] = useState(15);

  const handleRun = async () => {
    setResult({ running: true });
    try {
      const docs = Array.from({ length: docCount }, (_, i) => ({
        id: `bench-doc-${i}`,
        text: `Benchmark document ${i} about topic ${i % 10} with random content ${Math.random()}`,
        image: i % 3 === 0 ? `bench-img-${i}.jpg` : undefined,
        primaryModality: (i % 3 === 0 ? 'multimodal' : (i % 2 === 0 ? 'text' : 'image')) as Modality,
      }));
      const queries = Array.from({ length: queryCount }, (_, i) => ({
        id: `bench-q-${i}`,
        text: i % 2 === 0 ? `query about topic ${i % 10}` : undefined,
        image: i % 2 === 1 ? `bench-q-img-${i}.jpg` : undefined,
        modality: (i % 4 === 0 ? 'multimodal' : (i % 2 === 0 ? 'text' : 'image')) as Modality,
        expectedIds: [`bench-doc-${i % 10}`],
      }));
      const report = await benchmark.runFullSuite({
        testName: 'UI-Benchmark',
        documents: docs,
        queries,
        cacheLoader: async (q) => `answer-${q.text ?? q.image ?? 'default'}`,
      });
      setResult({ report, running: false });
    } catch (e) {
      setResult({ running: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>⚡ 多模态 RAG 性能基准</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>文档数:</label>
          <input
            style={{ ...inputStyle, width: 80, marginBottom: 0 }}
            type="number"
            value={docCount}
            onChange={(e) => setDocCount(parseInt(e.target.value) || 10)}
          />
          <label style={{ fontSize: 13 }}>查询数:</label>
          <input
            style={{ ...inputStyle, width: 80, marginBottom: 0 }}
            type="number"
            value={queryCount}
            onChange={(e) => setQueryCount(parseInt(e.target.value) || 5)}
          />
          <button style={buttonStyle} onClick={handleRun} disabled={result.running}>
            {result.running ? '⏳ 运行中...' : '🚀 运行基准'}
          </button>
        </div>
      </div>

      {result.error && (
        <div style={cardStyle}>
          <p style={{ color: '#fca5a5' }}>错误: {result.error}</p>
        </div>
      )}

      {result.report && (
        <>
          {/* Summary */}
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>📊 基准测试汇总</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{result.report.summary.totalDocuments}</p>
                <p style={statLabelStyle}>文档数</p>
              </div>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{result.report.summary.totalQueries}</p>
                <p style={statLabelStyle}>查询数</p>
              </div>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{(result.report.summary.overallHitRate * 100).toFixed(1)}%</p>
                <p style={statLabelStyle}>缓存命中率</p>
              </div>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{result.report.summary.avgP95LatencyMs.toFixed(1)}</p>
                <p style={statLabelStyle}>P95 延迟</p>
              </div>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{(result.report.summary.avgRecallAt5 * 100).toFixed(1)}%</p>
                <p style={statLabelStyle}>Recall@5</p>
              </div>
            </div>
          </div>

          {/* Embedding Performance */}
          {result.report.embeddingPerformance.length > 0 && (
            <div style={cardStyle}>
              <h3 style={cardTitleStyle}>🎨 嵌入性能</h3>
              {result.report.embeddingPerformance.map((e) => (
                <div key={e.testName} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 11, color: '#a1a1aa' }}>总数</span>
                    <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{e.totalEmbeddings}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: '#a1a1aa' }}>平均延迟</span>
                    <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{e.avgLatencyMs.toFixed(2)}ms</p>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: '#a1a1aa' }}>P95</span>
                    <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{e.p95LatencyMs.toFixed(2)}ms</p>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: '#a1a1aa' }}>吞吐量</span>
                    <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{e.throughput.toFixed(1)} qps</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Retrieval Latency */}
          {result.report.retrievalLatency.length > 0 && (
            <div style={cardStyle}>
              <h3 style={cardTitleStyle}>🔍 检索延迟</h3>
              {result.report.retrievalLatency.map((r) => (
                <div key={r.testName} style={{ marginBottom: 8 }}>
                  <span style={badgeStyle('#8b5cf6')}>{r.modality}</span>
                  <span style={{ fontSize: 12, color: '#a1a1aa', marginLeft: 8 }}>
                    {r.totalQueries} 查询 · P50: {r.p50LatencyMs.toFixed(1)}ms · P95: {r.p95LatencyMs.toFixed(1)}ms · P99: {r.p99LatencyMs.toFixed(1)}ms
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Quality */}
          {result.report.retrievalQuality && (
            <div style={cardStyle}>
              <h3 style={cardTitleStyle}>🎯 检索质量</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                <div style={statCardStyle}>
                  <p style={statValueStyle}>{(result.report.retrievalQuality.recallAt1 * 100).toFixed(1)}%</p>
                  <p style={statLabelStyle}>Recall@1</p>
                </div>
                <div style={statCardStyle}>
                  <p style={statValueStyle}>{(result.report.retrievalQuality.recallAt5 * 100).toFixed(1)}%</p>
                  <p style={statLabelStyle}>Recall@5</p>
                </div>
                <div style={statCardStyle}>
                  <p style={statValueStyle}>{(result.report.retrievalQuality.recallAt10 * 100).toFixed(1)}%</p>
                  <p style={statLabelStyle}>Recall@10</p>
                </div>
                <div style={statCardStyle}>
                  <p style={statValueStyle}>{result.report.retrievalQuality.mrr.toFixed(3)}</p>
                  <p style={statLabelStyle}>MRR</p>
                </div>
                <div style={statCardStyle}>
                  <p style={statValueStyle}>{result.report.retrievalQuality.ndcgAt10.toFixed(3)}</p>
                  <p style={statLabelStyle}>NDCG@10</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============ Tab 5: 系统设置 ============

function SettingsTab() {
  return (
    <div>
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>⚙️ 多模态 RAG 系统设置</h3>
        <p style={{ fontSize: 13, color: '#a1a1aa' }}>
          本面板集成多模态 RAG 性能优化套件,所有引擎均支持可插拔配置。
        </p>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🔧 引擎能力</h3>
        <ul style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.8 }}>
          <li>🎨 <strong>MultimodalEmbedding</strong>: CLIP 风格多模态 Embedding,支持文本/图像/多模态融合,多 Provider (Mock/CLIP/火山方舟),自动降级</li>
          <li>🖼️ <strong>MultimodalVectorIndex</strong>: 基于 FAISS-WASM 的图文混合索引,支持跨模态检索,模态感知打分,元数据过滤</li>
          <li>💾 <strong>MultimodalSemanticCache</strong>: 三级命中策略 (精确/同模态语义/跨模态语义),跨模态阈值自动调整</li>
          <li>⚡ <strong>MultimodalRAGBenchmark</strong>: 自动化性能基准,支持 Recall/MRR/NDCG 质量评估,延迟直方图,Markdown 报告</li>
        </ul>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📈 性能指标</h3>
        <ul style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.8 }}>
          <li>嵌入推理: P95 &lt; 50ms (Mock), 火山方舟 API &lt; 500ms</li>
          <li>跨模态检索: P95 &lt; 100ms (FAISS-WASM Flat, 10K 文档)</li>
          <li>缓存命中: &lt; 5ms (L1 精确), &lt; 20ms (L2 语义)</li>
          <li>跨模态命中率: 30%+ (视数据分布)</li>
        </ul>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🔗 集成链路</h3>
        <p style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.6 }}>
          1. <strong>MultimodalEmbedding</strong> 提供统一的嵌入 API<br />
          2. <strong>MultimodalVectorIndex</strong> 负责文档索引与跨模态检索<br />
          3. <strong>MultimodalSemanticCache</strong> 缓存 RAG 响应,降低重复 LLM 调用<br />
          4. <strong>MultimodalRAGBenchmark</strong> 持续监控性能,提供回归检测
        </p>
      </div>
    </div>
  );
}

export default McpMultimodalRagPanel;
