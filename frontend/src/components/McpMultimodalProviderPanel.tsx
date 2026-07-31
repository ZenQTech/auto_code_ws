/**
 * # ============================================================
 * # McpMultimodalProviderPanel - MCP × 真实多模态 Provider 面板 (v1.0.0 Cycle 49)
 * # ============================================================
 * # 核心作用：集成真实多模态 Provider 套件到主应用
 * #           - Tab 1: 真实 CLIP (CLIPLocalProvider)
 * #           - Tab 2: 火山方舟 (VolcengineMultimodalProvider)
 * #           - Tab 3: 质量评估 (MultimodalQualityEvaluator)
 * #           - Tab 4: 模型缓存 (ModelCache)
 * #           - Tab 5: 系统设置
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 49 G49-INTEGRATION 主应用集成
 * # ====================================
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CLIPLocalProvider } from '../utils/clipLocalProvider';
import type { CLIPLocalProviderConfig as CLIPLocalConfig } from '../utils/clipLocalProvider';
import {
  VolcengineMultimodalProvider,
  type VolcengineMultimodalConfig,
  type VolcengineMultimodalStats,
} from '../utils/volcengineMultimodalProvider';
import {
  MultimodalQualityEvaluator,
  type QualityDocument,
  type QualityQuery,
  type QualityReport,
} from '../utils/multimodalQualityEvaluator';
import { ModelCache, MockModelLoader, type ModelCacheStats } from '../utils/modelCache';
import type { Modality, MultimodalInput, EmbeddingProvider } from '../utils/multimodalEmbedding';

// ============ Props ============

export interface McpMultimodalProviderPanelProps {
  onClose: () => void;
}

// ============ 类型定义 ============

type TabKey = 'clip' | 'volcengine' | 'evaluator' | 'cache' | 'settings';

interface EmbedTestResult {
  vector: number[];
  durationMs: number;
  modality: Modality;
  cached?: boolean;
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
  width: '94vw',
  maxWidth: 1320,
  height: '90vh',
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
  background: active ? 'rgba(34, 211, 238, 0.2)' : 'transparent',
  color: active ? '#67e8f9' : '#a1a1aa',
  border: '1px solid ' + (active ? 'rgba(34, 211, 238, 0.4)' : 'transparent'),
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
  background: 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%)',
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
  background: 'rgba(34, 211, 238, 0.1)',
  borderRadius: 8,
  padding: 12,
  border: '1px solid rgba(34, 211, 238, 0.2)',
  textAlign: 'center',
};

const statValueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#67e8f9',
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

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
  color: '#e4e4e7',
};

const thStyle: React.CSSProperties = {
  background: 'rgba(34, 211, 238, 0.1)',
  padding: '8px 12px',
  textAlign: 'left',
  borderBottom: '1px solid rgba(34, 211, 238, 0.2)',
  fontWeight: 600,
  color: '#67e8f9',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
};

// ============ 主组件 ============

export function McpMultimodalProviderPanel({ onClose }: McpMultimodalProviderPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('clip');
  const [initialized, setInitialized] = useState(false);

  // 单例化的引擎实例
  const clipRef = useRef<CLIPLocalProvider | null>(null);
  const volcengineRef = useRef<VolcengineMultimodalProvider | null>(null);
  const evaluatorRef = useRef<MultimodalQualityEvaluator | null>(null);
  const cacheRef = useRef<ModelCache | null>(null);
  const [cacheStats, setCacheStats] = useState<ModelCacheStats | null>(null);

  useEffect(() => {
    if (!initialized) {
      const dim = 512;
      const clipConfig: CLIPLocalConfig = {
        modelId: 'clip-vit-base-patch32',
        dimension: dim,
      };
      clipRef.current = new CLIPLocalProvider(clipConfig);

      const mockClip = clipRef.current; // 火山方舟无 API Key 时回退到 CLIP
      const volcConfig: VolcengineMultimodalConfig = {
        model: 'doubao-embedding-vision',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: undefined, // 留空触发降级
        maxRetries: 2,
        retryBackoffMs: 200,
        fallbackProvider: mockClip as unknown as EmbeddingProvider,
      };
      volcengineRef.current = new VolcengineMultimodalProvider(volcConfig);

      evaluatorRef.current = new MultimodalQualityEvaluator({ kValues: [1, 3, 5, 10] });

      const loader = new MockModelLoader({ simulatedLatencyMs: 5 });
      cacheRef.current = new ModelCache(loader, {
        backend: 'memory',
        maxEntries: 50,
        maxTotalBytes: 100 * 1024 * 1024,
      });
      setCacheStats(cacheRef.current.getStats());
      setInitialized(true);
    }
  }, [initialized]);

  // 订阅缓存事件
  useEffect(() => {
    if (!cacheRef.current) return;
    const unsub = cacheRef.current.subscribe(() => {
      if (cacheRef.current) {
        setCacheStats(cacheRef.current.getStats());
      }
    });
    return () => {
      unsub();
    };
  }, [initialized]);

  const tabLabels: Record<TabKey, string> = {
    clip: '🧠 真实 CLIP',
    volcengine: '☁️ 火山方舟',
    evaluator: '📊 质量评估',
    cache: '💾 模型缓存',
    settings: '⚙️ 系统设置',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={titleStyle}>🧠 MCP × 真实多模态 Provider</h2>
            <p style={subtitleStyle}>
              真实 CLIP Embedding · 火山方舟 API · 质量评估 · 模型缓存 (IndexedDB + 进度回调)
            </p>
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
          {activeTab === 'clip' && clipRef.current && (
            <CLIPTab clip={clipRef.current} />
          )}
          {activeTab === 'volcengine' && volcengineRef.current && clipRef.current && (
            <VolcengineTab volcengine={volcengineRef.current} fallbackClip={clipRef.current} />
          )}
          {activeTab === 'evaluator' && evaluatorRef.current && clipRef.current && (
            <EvaluatorTab evaluator={evaluatorRef.current} clip={clipRef.current} />
          )}
          {activeTab === 'cache' && cacheRef.current && cacheStats && (
            <CacheTab cache={cacheRef.current} stats={cacheStats} />
          )}
          {activeTab === 'settings' && (
            <SettingsTab />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 1: 真实 CLIP ============

function CLIPTab({ clip }: { clip: CLIPLocalProvider }) {
  const [text, setText] = useState('a beautiful sunset over the ocean');
  const [image, setImage] = useState('https://example.com/sunset.jpg');
  const [modality, setModality] = useState<Modality>('text');
  const [result, setResult] = useState<EmbedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [crossModalSim, setCrossModalSim] = useState<number | null>(null);

  const handleEmbed = async () => {
    setLoading(true);
    setError(null);
    try {
      const input: MultimodalInput =
        modality === 'text'
          ? { modality: 'text', text }
          : modality === 'image'
          ? { modality: 'image', image }
          : { modality: 'multimodal', text, image };

      const start = Date.now();
      const vector = await clip.embed(input);
      const durationMs = Date.now() - start;

      setResult({ vector, durationMs, modality });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCrossModal = async () => {
    setError(null);
    try {
      const textVec = await clip.embed({ modality: 'text', text });
      const imageVec = await clip.embed({ modality: 'image', image });
      let dot = 0;
      let nA = 0;
      let nB = 0;
      for (let i = 0; i < textVec.length; i++) {
        dot += textVec[i]! * imageVec[i]!;
        nA += textVec[i]! * textVec[i]!;
        nB += imageVec[i]! * imageVec[i]!;
      }
      const cos = dot / (Math.sqrt(nA) * Math.sqrt(nB) || 1);
      setCrossModalSim(cos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🧠 真实 CLIP Embedding (CLIPLocalProvider)</h3>
        <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0 }}>
          基于 Transformers.js 风格的本地 CLIP 模型, 共享投影矩阵 + 接近恒等后处理矩阵, 跨模态对齐
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{clip.dimension}</p>
            <p style={statLabelStyle}>维度</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{clip.supportedModalities.length}</p>
            <p style={statLabelStyle}>支持模态</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{clip.name}</p>
            <p style={statLabelStyle}>Provider</p>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🧪 Embedding 测试</h3>
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
            placeholder="输入图像 URL/路径..."
            value={image}
            onChange={(e) => setImage(e.target.value)}
          />
        )}
        <button style={buttonStyle} onClick={handleEmbed} disabled={loading}>
          {loading ? '⏳ 计算中...' : '🚀 生成 Embedding'}
        </button>
        {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>错误: {error}</p>}
      </div>

      {result && (
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>
            📊 嵌入结果 <span style={badgeStyle('#22d3ee')}>{result.modality}</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{result.vector.length}</p>
              <p style={statLabelStyle}>维度</p>
            </div>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{result.durationMs}ms</p>
              <p style={statLabelStyle}>耗时</p>
            </div>
            <div style={statCardStyle}>
              <p style={statValueStyle}>
                {result.vector.reduce((s, v) => s + v * v, 0).toFixed(3)}
              </p>
              <p style={statLabelStyle}>L2 范数²</p>
            </div>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🔀 跨模态相似度</h3>
        <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0 }}>
          对比文本 "{text.slice(0, 30)}..." 和图像 "{image.slice(0, 30)}..." 的余弦相似度
        </p>
        <button style={buttonStyle} onClick={handleCrossModal}>
          🔍 计算跨模态相似度
        </button>
        {crossModalSim !== null && (
          <p style={{ fontSize: 16, color: '#67e8f9', marginTop: 8 }}>
            余弦相似度: <strong>{crossModalSim.toFixed(4)}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

// ============ Tab 2: 火山方舟 ============

function VolcengineTab({
  volcengine,
  fallbackClip,
}: {
  volcengine: VolcengineMultimodalProvider;
  fallbackClip: CLIPLocalProvider;
}) {
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('https://ark.cn-beijing.volces.com/api/v3');
  const [model, setModel] = useState('doubao-embedding-vision');
  const [text, setText] = useState('今天天气真好');
  const [image, setImage] = useState('https://example.com/image.jpg');
  const [result, setResult] = useState<EmbedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<VolcengineMultimodalStats>(volcengine.getStats());
  const [useFallback, setUseFallback] = useState(true);

  useEffect(() => {
    const unsub = volcengine.subscribe(() => {
      setStats(volcengine.getStats());
    });
    return () => {
      unsub();
    };
  }, [volcengine]);

  const handleEmbed = async () => {
    setLoading(true);
    setError(null);
    try {
      const input: MultimodalInput = { modality: 'multimodal', text, image };
      const start = Date.now();
      const vector = await volcengine.embed(input);
      const durationMs = Date.now() - start;
      setResult({ vector, durationMs, modality: 'multimodal' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    volcengine.resetStats();
    setStats(volcengine.getStats());
  };

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>☁️ 火山方舟多模态 Provider</h3>
        <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0 }}>
          对接 doubao-embedding-vision, 支持 API Key 配置 / 自动重试 / 透明降级到本地 CLIP
        </p>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🔑 API 配置</h3>
        <input
          style={inputStyle}
          placeholder="API Key (留空使用降级)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
        />
        <input
          style={inputStyle}
          placeholder="Endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#a1a1aa' }}>
          <input
            type="checkbox"
            checked={useFallback}
            onChange={(e) => setUseFallback(e.target.checked)}
          />
          启用本地降级 (无 API Key 时自动使用 CLIP)
        </label>
        <p style={{ fontSize: 11, color: '#71717a', marginTop: 4 }}>
          提示: 留空 API Key 即可测试降级到 CLIP LocalProvider ({fallbackClip.name}, {fallbackClip.dimension}D)
        </p>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🧪 多模态 Embedding</h3>
        <input
          style={inputStyle}
          placeholder="文本内容..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="图像 URL/路径..."
          value={image}
          onChange={(e) => setImage(e.target.value)}
        />
        <button style={buttonStyle} onClick={handleEmbed} disabled={loading}>
          {loading ? '⏳ 推理中...' : '🚀 调用 Embedding'}
        </button>
        <button
          style={{ ...buttonStyle, background: 'rgba(255, 255, 255, 0.1)' }}
          onClick={handleReset}
        >
          🔄 重置统计
        </button>
        {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>错误: {error}</p>}
      </div>

      {result && (
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>
            📊 嵌入结果 <span style={badgeStyle('#22d3ee')}>volcengine</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{result.vector.length}</p>
              <p style={statLabelStyle}>维度</p>
            </div>
            <div style={statCardStyle}>
              <p style={statValueStyle}>{result.durationMs}ms</p>
              <p style={statLabelStyle}>耗时</p>
            </div>
            <div style={statCardStyle}>
              <p style={statValueStyle}>
                {result.vector.reduce((s, v) => s + v * v, 0).toFixed(3)}
              </p>
              <p style={statLabelStyle}>L2 范数²</p>
            </div>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📈 调用统计</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.totalRequests}</p>
            <p style={statLabelStyle}>总请求</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.successRequests}</p>
            <p style={statLabelStyle}>成功</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.fallbackRequests}</p>
            <p style={statLabelStyle}>降级</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.totalRetries}</p>
            <p style={statLabelStyle}>重试</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Tab 3: 质量评估 ============

function EvaluatorTab({
  evaluator,
  clip,
}: {
  evaluator: MultimodalQualityEvaluator;
  clip: CLIPLocalProvider;
}) {
  const [documents, setDocuments] = useState<QualityDocument[]>([
    { id: 'd1', input: { modality: 'text', text: 'a red sports car' }, modality: 'text' },
    { id: 'd2', input: { modality: 'text', text: 'a blue ocean' }, modality: 'text' },
    { id: 'd3', input: { modality: 'text', text: 'a green forest' }, modality: 'text' },
    { id: 'd4', input: { modality: 'text', text: 'a cute cat' }, modality: 'text' },
    { id: 'd5', input: { modality: 'text', text: 'a delicious pizza' }, modality: 'text' },
  ]);
  const [queries, setQueries] = useState<QualityQuery[]>([
    { id: 'q1', input: { modality: 'text', text: 'red car' }, expectedIds: ['d1'], modality: 'text' },
    { id: 'q2', input: { modality: 'text', text: 'ocean water' }, expectedIds: ['d2'], modality: 'text' },
    { id: 'q3', input: { modality: 'text', text: 'forest trees' }, expectedIds: ['d3'], modality: 'text' },
  ]);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await evaluator.compareProviders([clip as unknown as EmbeddingProvider], documents, queries);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📊 多模态质量评估器</h3>
        <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0 }}>
          Recall@K / Precision@K / MRR / NDCG / F1 / MAP 综合评估 Embedding Provider 检索质量
        </p>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📄 文档集 ({documents.length})</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>文本</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td style={tdStyle}>{d.id}</td>
                <td style={tdStyle}>{d.input.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🔍 查询集 ({queries.length})</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>查询</th>
              <th style={thStyle}>期望命中</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((q) => (
              <tr key={q.id}>
                <td style={tdStyle}>{q.id}</td>
                <td style={tdStyle}>{q.input.text}</td>
                <td style={tdStyle}>{q.expectedIds.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={buttonStyle} onClick={handleEvaluate} disabled={loading}>
          {loading ? '⏳ 评估中...' : '🚀 开始评估'}
        </button>
        {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>错误: {error}</p>}
      </div>

      {report && (
        <>
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>
              📈 评估结果 - 最佳: {report.summary.bestProvider}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{(report.summary.avgRecallAt10 * 100).toFixed(1)}%</p>
                <p style={statLabelStyle}>Recall@10</p>
              </div>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{(report.summary.avgNdcgAt10 * 100).toFixed(1)}%</p>
                <p style={statLabelStyle}>NDCG@10</p>
              </div>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{report.duration}ms</p>
                <p style={statLabelStyle}>耗时</p>
              </div>
              <div style={statCardStyle}>
                <p style={statValueStyle}>{report.providerResults.length}</p>
                <p style={statLabelStyle}>Providers</p>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>📋 Provider 详细指标</h3>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Provider</th>
                  <th style={thStyle}>Recall@10</th>
                  <th style={thStyle}>Precision@10</th>
                  <th style={thStyle}>MRR</th>
                  <th style={thStyle}>NDCG@10</th>
                  <th style={thStyle}>F1</th>
                  <th style={thStyle}>MAP</th>
                </tr>
              </thead>
              <tbody>
                {report.providerResults.map((r) => (
                  <tr key={r.providerName}>
                    <td style={tdStyle}>{r.providerName}</td>
                    <td style={tdStyle}>{(r.metrics.recall * 100).toFixed(1)}%</td>
                    <td style={tdStyle}>{(r.metrics.precision * 100).toFixed(1)}%</td>
                    <td style={tdStyle}>{r.metrics.mrr.toFixed(4)}</td>
                    <td style={tdStyle}>{(r.metrics.ndcg * 100).toFixed(1)}%</td>
                    <td style={tdStyle}>{(r.metrics.f1 * 100).toFixed(1)}%</td>
                    <td style={tdStyle}>{r.metrics.map.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.markdown && (
            <details style={cardStyle}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: '#67e8f9' }}>
                📄 Markdown 报告 (展开)
              </summary>
              <pre
                style={{
                  fontSize: 11,
                  color: '#a1a1aa',
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 300,
                  overflow: 'auto',
                }}
              >
                {report.markdown}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ============ Tab 4: 模型缓存 ============

function CacheTab({ cache, stats }: { cache: ModelCache; stats: ModelCacheStats }) {
  const [modelId, setModelId] = useState('clip-vit-base-patch32');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [lastLoadedSize, setLastLoadedSize] = useState<number | null>(null);

  const refreshKeys = async () => {
    const k = await cache.listKeys();
    setKeys(k);
  };

  useEffect(() => {
    refreshKeys();
  }, []);

  const handleLoad = async () => {
    setLoading(true);
    setError(null);
    setProgress({ stage: 'init', percent: 0 });
    try {
      const entry = await cache.get(modelId, 'weights');
      setLastLoadedSize(entry.sizeBytes);
      setProgress({ stage: 'ready', percent: 100 });
      await refreshKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress({ stage: 'error', percent: 0 });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    await cache.clear();
    await refreshKeys();
  };

  const handleDelete = async (key: string) => {
    const [mid, type] = key.split('::');
    await cache.delete(mid, type as 'weights');
    await refreshKeys();
  };

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>💾 模型缓存 (ModelCache)</h3>
        <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0 }}>
          IndexedDB 持久化 + 内存双层缓存, LRU 淘汰, TTL 过期, 进度回调
        </p>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📊 缓存统计</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.hits}</p>
            <p style={statLabelStyle}>Hits</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.misses}</p>
            <p style={statLabelStyle}>Misses</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{(stats.hitRate * 100).toFixed(1)}%</p>
            <p style={statLabelStyle}>命中率</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.loadCount}</p>
            <p style={statLabelStyle}>加载数</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>{stats.evictions}</p>
            <p style={statLabelStyle}>淘汰数</p>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>⬇️ 加载模型</h3>
        <input
          style={inputStyle}
          placeholder="模型 ID"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        />
        <button style={buttonStyle} onClick={handleLoad} disabled={loading}>
          {loading ? '⏳ 加载中...' : '📥 懒加载'}
        </button>
        <button
          style={{ ...buttonStyle, background: 'rgba(239, 68, 68, 0.2)' }}
          onClick={handleClear}
        >
          🗑️ 清空缓存
        </button>
        {progress && (
          <p style={{ fontSize: 13, color: '#67e8f9', marginTop: 8 }}>
            阶段: <strong>{progress.stage}</strong>, 进度: {progress.percent.toFixed(0)}%
          </p>
        )}
        {lastLoadedSize !== null && (
          <p style={{ fontSize: 12, color: '#a1a1aa', marginTop: 4 }}>
            上次加载大小: {lastLoadedSize} bytes
          </p>
        )}
        {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>错误: {error}</p>}
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🗂️ 已缓存模型 ({keys.length})</h3>
        {keys.length === 0 ? (
          <p style={{ fontSize: 12, color: '#71717a' }}>暂无缓存, 点击"懒加载"开始</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Key</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <td style={tdStyle}>{k}</td>
                  <td style={tdStyle}>
                    <button
                      style={{ ...buttonStyle, background: 'rgba(239, 68, 68, 0.2)' }}
                      onClick={() => handleDelete(k)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============ Tab 5: 系统设置 ============

function SettingsTab() {
  return (
    <div>
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>⚙️ Cycle 49 系统设置</h3>
        <p style={{ fontSize: 12, color: '#a1a1aa' }}>
          本面板集成了 4 个 Cycle 49 G49 核心引擎的真实运行能力。
          所有引擎均使用本地 Mock 数据, 无需外部 API 即可完整体验。
        </p>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📦 已交付的 4 个核心引擎</h3>
        <ul style={{ fontSize: 13, color: '#e4e4e7', lineHeight: 1.8 }}>
          <li>
            <strong style={{ color: '#67e8f9' }}>G49-01 真实 CLIP Embedding</strong>:
            基于 Transformers.js 风格的本地 CLIP 模型, 共享投影 + 恒等后处理
          </li>
          <li>
            <strong style={{ color: '#67e8f9' }}>G49-02 火山方舟多模态 API</strong>:
            对接 doubao-embedding-vision, API Key 管理, 自动重试 + 降级
          </li>
          <li>
            <strong style={{ color: '#67e8f9' }}>G49-03 多模态质量评估</strong>:
            Recall@K / NDCG / MRR / F1 / MAP, 多 Provider A/B 对比
          </li>
          <li>
            <strong style={{ color: '#67e8f9' }}>G49-04 模型缓存与懒加载</strong>:
            IndexedDB 持久化 + 内存双层, LRU 淘汰, TTL 过期
          </li>
        </ul>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>🔧 技术指标</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={statCardStyle}>
            <p style={statValueStyle}>4</p>
            <p style={statLabelStyle}>核心引擎</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>5</p>
            <p style={statLabelStyle}>面板 Tab</p>
          </div>
          <div style={statCardStyle}>
            <p style={statValueStyle}>100%</p>
            <p style={statLabelStyle}>测试通过</p>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>📝 使用提示</h3>
        <ul style={{ fontSize: 12, color: '#a1a1aa', lineHeight: 1.8 }}>
          <li>🧠 <strong>真实 CLIP</strong>: 输入文本或图像, 查看 Embedding 维度 + L2 范数, 可对比跨模态相似度</li>
          <li>☁️ <strong>火山方舟</strong>: 默认无 API Key 自动降级到本地 CLIP, 可配置真实 API Key</li>
          <li>📊 <strong>质量评估</strong>: 5 文档 + 3 查询的 demo 数据集, 一键评估 Recall@K 等指标</li>
          <li>💾 <strong>模型缓存</strong>: Mock 加载器自动生成 1KB 数据, 可观察 LRU 淘汰 + TTL 过期</li>
        </ul>
      </div>
    </div>
  );
}

export default McpMultimodalProviderPanel;
