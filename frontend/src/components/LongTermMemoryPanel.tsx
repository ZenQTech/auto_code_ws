/**
 * # ============================================================
 * # LongTermMemoryPanel - 长期记忆面板 (v1.0.0 Cycle 38 G38-02)
 * # ============================================================
 * # 核心作用：UI 面板，提供 MemGPT 风格分层记忆管理
 * #           核心记忆 + 回忆记忆 + 归档记忆
 * # 对标产品：MemGPT (Letta) / Zep / LangChain Memory
 * # ============================================================
 */

import { useState, useEffect } from 'react';
import { LongTermMemoryEngine, type MemoryItem, type MemoryLayer } from '../utils/longTermMemory';

export interface LongTermMemoryPanelProps {
  onClose?: () => void;
}

type TabType = 'overview' | 'remember' | 'query' | 'context' | 'maintain';

export function LongTermMemoryPanel({ onClose }: LongTermMemoryPanelProps) {
  const [engine] = useState(() => new LongTermMemoryEngine());
  const [tab, setTab] = useState<TabType>('overview');
  const [content, setContent] = useState('');
  const [layer, setLayer] = useState<MemoryLayer>('recall');
  const [tags, setTags] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryItem[]>([]);
  const [context, setContext] = useState('');
  const [stats, setStats] = useState(engine.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(engine.getStats());
    }, 2000);
    return () => clearInterval(interval);
  }, [engine]);

  const handleRemember = async () => {
    if (!content.trim()) return;
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    await engine.remember(content, {
      layer,
      tags: tagList,
    });
    setContent('');
    setStats(engine.getStats());
  };

  const handleQuery = async () => {
    if (!query.trim()) return;
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const res = await engine.queryMemories(query, { tags: tagList, topK: 10 });
    setResults(res);
  };

  const handleBuildContext = async () => {
    const ctx = await engine.buildContext(query || 'general');
    setContext(ctx);
  };

  const handleMaintain = async () => {
    const report = await engine.runMaintenance();
    alert(
      `维护完成：衰减 ${report.decayedCount}，归档 ${report.archivedCount}，清理 ${report.evictedCount}，合并 ${report.consolidatedCount}，耗时 ${report.durationMs}ms`,
    );
    setStats(engine.getStats());
  };

  return (
    <div
      style={{
        padding: 16,
        background: '#fff',
        borderRadius: 8,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🧠 长期记忆</h2>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'remember', 'query', 'context', 'maintain'] as TabType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 12px',
              background: tab === t ? '#3b82f6' : '#f3f4f6',
              color: tab === t ? '#fff' : '#374151',
              border: '1px solid ' + (tab === t ? '#3b82f6' : '#d1d5db'),
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t === 'overview' ? '概览' : t === 'remember' ? '记忆' : t === 'query' ? '检索' : t === 'context' ? '上下文' : '维护'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'overview' && (
          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div style={{ padding: 12, background: '#eff6ff', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>总记忆数</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#1e40af' }}>
                  {stats.totalItems}
                </div>
              </div>
              <div style={{ padding: 12, background: '#fef3c7', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>平均重要性</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#b45309' }}>
                  {stats.avgImportance.toFixed(2)}
                </div>
              </div>
              <div style={{ padding: 12, background: '#dcfce7', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>核心层</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#15803d' }}>
                  {stats.byLayer.core ?? 0}
                </div>
              </div>
              <div style={{ padding: 12, background: '#fce7f3', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>回忆层</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#be185d' }}>
                  {stats.byLayer.recall ?? 0}
                </div>
              </div>
              <div style={{ padding: 12, background: '#e0e7ff', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>归档层</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#4338ca' }}>
                  {stats.byLayer.archive ?? 0}
                </div>
              </div>
              <div style={{ padding: 12, background: '#fed7aa', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>总访问</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#c2410c' }}>
                  {stats.totalAccesses}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'remember' && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                内容
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="要记住的内容"
                style={{
                  width: '100%',
                  minHeight: 80,
                  padding: 8,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                层级
              </label>
              <select
                value={layer}
                onChange={(e) => setLayer(e.target.value as MemoryLayer)}
                style={{
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                }}
              >
                <option value="core">核心</option>
                <option value="recall">回忆</option>
                <option value="archive">归档</option>
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                标签（逗号分隔）
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tag1, tag2"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              onClick={handleRemember}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              记住
            </button>
          </div>
        )}

        {tab === 'query' && (
          <div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索关键词"
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                marginBottom: 8,
                boxSizing: 'border-box',
              }}
            />
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="标签过滤（可选）"
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                marginBottom: 8,
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleQuery}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                marginBottom: 12,
              }}
            >
              检索
            </button>
            <div>
              {results.length === 0 && (
                <div style={{ color: '#6b7280', fontSize: 13 }}>暂无结果</div>
              )}
              {results.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: 10,
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    marginBottom: 8,
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{r.content.slice(0, 60)}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    层：{r.layer} | 重要度：{r.importance.toFixed(2)} | 标签：{r.tags.join(', ') || '无'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'context' && (
          <div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="查询关键词"
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                marginBottom: 8,
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleBuildContext}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                marginBottom: 12,
              }}
            >
              构建上下文
            </button>
            <pre
              style={{
                background: '#f9fafb',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              {context || '（点击"构建上下文"生成）'}
            </pre>
          </div>
        )}

        {tab === 'maintain' && (
          <div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
              运行记忆维护流程：衰减 + 归档迁移 + 容量管理 + 相似合并
            </p>
            <button
              onClick={handleMaintain}
              style={{
                padding: '8px 16px',
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              执行维护
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default LongTermMemoryPanel;
