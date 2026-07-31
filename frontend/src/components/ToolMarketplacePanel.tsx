/**
 * # ============================================================
 * # ToolMarketplacePanel - 工具市场面板 (v1.0.0 Cycle 37 G37-02)
 * # ============================================================
 * # 核心作用：UI 面板，展示已注册工具 / 内置工具市场 / 工具测试
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ToolUseEngine,
  createToolUseEngine,
  registerBuiltinTools,
  BUILTIN_TOOLS,
  ToolDefinition,
  ToolCall,
  ToolCallResult,
  ToolMarketplace,
  FunctionExecutor,
  ToolStats,
} from '../utils/toolUseEngine';

export interface ToolMarketplacePanelProps {
  initialEngine?: ToolUseEngine;
  onClose?: () => void;
}

type TabType = 'registered' | 'marketplace' | 'test' | 'stats';

export function ToolMarketplacePanel({ initialEngine, onClose }: ToolMarketplacePanelProps) {
  const [engine] = useState(() => {
    const e = initialEngine ?? createToolUseEngine();
    if (e.listTools().length === 0) {
      registerBuiltinTools(e);
    }
    return e;
  });

  const [marketplace] = useState(() => {
    const mp = new ToolMarketplace();
    // 预置工具市场条目
    for (const { definition } of BUILTIN_TOOLS) {
      mp.publish({
        id: definition.name,
        name: definition.description,
        description: definition.description,
        category: definition.category || 'misc',
        version: '1.0.0',
        author: 'Cycle 37',
        rating: 4.5,
        downloadCount: Math.floor(Math.random() * 1000),
        tags: [definition.category || 'misc', definition.permission],
        definition,
        installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
      });
    }
    return mp;
  });

  const [tab, setTab] = useState<TabType>('registered');
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [testToolName, setTestToolName] = useState('');
  const [testArgs, setTestArgs] = useState('{}');
  const [testResult, setTestResult] = useState<ToolCallResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const [history, setHistory] = useState<ToolCallResult[]>([]);
  const [stats, setStats] = useState({
    totalCalls: 0,
    successCalls: 0,
    failureCalls: 0,
    avgDurationMs: 0,
  });

  const refresh = useCallback(() => {
    setTools(engine.listTools());
    setHistory(engine.getHistory());
    setStats(engine.getStats());
  }, [engine]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 启用/禁用
  const toggleTool = (name: string, enabled: boolean) => {
    if (enabled) {
      engine.disableTool(name);
    } else {
      engine.enableTool(name);
    }
    refresh();
  };

  // 测试工具
  const handleTest = async () => {
    if (!testToolName || isRunning) return;
    setIsRunning(true);
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(testArgs);
      } catch (e) {
        setTestResult({
          callId: 'test',
          name: testToolName,
          success: false,
          error: { code: 'INVALID_ARGS', message: '参数不是合法 JSON' },
          durationMs: 0,
          timestamp: Date.now(),
        });
        return;
      }

      const call: ToolCall = {
        id: `call_${Date.now()}`,
        name: testToolName,
        arguments: args,
      };
      const result = await engine.executeCall(call);
      setTestResult(result);
      refresh();
    } catch (err) {
      console.error('测试失败:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const filteredTools = useMemo(() => {
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    );
  }, [tools, searchQuery]);

  const marketplaceResults = useMemo(() => {
    return marketplace.search(searchQuery);
  }, [marketplace, searchQuery]);

  return (
    <div style={{ padding: 16, background: '#fff', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🔧 工具市场</h2>
        {onClose && <button onClick={onClose} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>关闭</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['registered', 'marketplace', 'test', 'stats'] as TabType[]).map(t => (
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
            {t === 'registered' ? '已注册' : t === 'marketplace' ? '市场' : t === 'test' ? '测试' : '统计'}
          </button>
        ))}
      </div>

      <input
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="搜索工具..."
        style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, marginBottom: 12 }}
      />

      <div style={{ flex: 1, overflow: 'auto' }}>
        {(tab === 'registered' || tab === 'marketplace') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(tab === 'registered' ? filteredTools : marketplaceResults.map(e => e.definition)).map(tool => (
              <div key={tool.name} style={{ padding: 10, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1f2937' }}>
                      {tool.name}
                      <span style={{ marginLeft: 8, padding: '2px 6px', fontSize: 10, background: tool.permission === 'dangerous' ? '#fee2e2' : tool.permission === 'confirmed' ? '#fef3c7' : '#d1fae5', color: tool.permission === 'dangerous' ? '#b91c1c' : tool.permission === 'confirmed' ? '#92400e' : '#065f46', borderRadius: 3 }}>
                        {tool.permission}
                      </span>
                      {tool.category && (
                        <span style={{ marginLeft: 6, padding: '2px 6px', fontSize: 10, background: '#e0e7ff', color: '#3730a3', borderRadius: 3 }}>
                          {tool.category}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{tool.description}</div>
                  </div>
                  {tab === 'registered' && (
                    <button
                      onClick={() => {
                        const reg = engine['registry'].get(tool.name);
                        if (reg) toggleTool(tool.name, reg.enabled);
                      }}
                      style={{
                        padding: '4px 8px',
                        background: engine['registry'].get(tool.name)?.enabled ? '#fee2e2' : '#d1fae5',
                        color: engine['registry'].get(tool.name)?.enabled ? '#b91c1c' : '#065f46',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      {engine['registry'].get(tool.name)?.enabled ? '禁用' : '启用'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'test' && (
          <div>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>选择工具：</label>
            <select
              value={testToolName}
              onChange={e => setTestToolName(e.target.value)}
              style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 12, fontSize: 13 }}
            >
              <option value="">-- 选择工具 --</option>
              {tools.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>

            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>参数（JSON）：</label>
            <textarea
              value={testArgs}
              onChange={e => setTestArgs(e.target.value)}
              style={{ width: '100%', minHeight: 80, padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', marginBottom: 8, resize: 'vertical' }}
            />

            <button
              onClick={handleTest}
              disabled={!testToolName || isRunning}
              style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
            >
              {isRunning ? '执行中...' : '执行'}
            </button>

            {testResult && (
              <div style={{ marginTop: 16, padding: 10, background: testResult.success ? '#f0fdf4' : '#fee2e2', borderRadius: 6, border: `1px solid ${testResult.success ? '#86efac' : '#fecaca'}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  {testResult.success ? '✅ 成功' : '❌ 失败'} · {testResult.durationMs}ms
                </div>
                {testResult.success ? (
                  <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', color: '#1f2937' }}>
                    {JSON.stringify(testResult.result, null, 2)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 12, color: '#b91c1c' }}>
                    错误: {testResult.error?.message}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>调用历史 ({history.length})</h3>
              {history.slice(-5).reverse().map((h, i) => (
                <div key={i} style={{ padding: 6, background: '#f9fafb', borderRadius: 4, marginBottom: 4, fontSize: 11 }}>
                  <span style={{ color: h.success ? '#10b981' : '#ef4444' }}>{h.success ? '✓' : '✗'}</span> {h.name} · {h.durationMs}ms
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'stats' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <StatCard label="总调用" value={stats.totalCalls} />
            <StatCard label="成功" value={stats.successCalls} />
            <StatCard label="失败" value={stats.failureCalls} />
            <StatCard label="平均耗时" value={`${stats.avgDurationMs}ms`} />
            <StatCard label="已注册工具" value={tools.length} />
            <StatCard label="历史记录" value={history.length} />
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

export default ToolMarketplacePanel;
