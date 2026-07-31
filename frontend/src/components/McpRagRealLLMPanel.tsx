/**
 * # ============================================================
 * # McpRagRealLLMPanel - MCP × RAG × 真实 LLM 端到端面板 (v1.0.0 Cycle 46)
 * # ============================================================
 * # 核心作用：MCP × RAG × 真实 LLM 端到端集成面板
 * #           - Tab 1: 智能对话 - RAG + 真实 LLM 查询
 * #           - Tab 2: 监控 - RAGMonitor 实时质量指标
 * #           - Tab 3: 调试 - RAGDebugger trace + 回放
 * #           - Tab 4: E2E 测试 - RAGE2ETestSuite 一键运行
 * # ============================================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 46 G46 主应用集成
 * # ============================================================
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { McpRagRealLLM, type McpRagRealLLMResult, type RAGPhase } from '../utils/mcpRagRealLLM';
import { RAGMonitor, type RAGQueryRecord, type AlertEvent, type WindowAggregation } from '../utils/ragMonitor';
import { RAGDebugger, type RAGSession, type TraceEvent, type StageAnalysis } from '../utils/ragDebugger';
import { RAGE2ETestSuite, DEFAULT_E2E_SCENARIOS, type E2ETestSuiteResult } from '../utils/ragE2ETestSuite';
import { McpRagEngine } from '../utils/mcpRagEngine';
import { McpRagAgent } from '../utils/mcpRagAgent';
import { MockProvider, type LLMProvider, type ProviderName } from '../utils/llmProviderAdapter';

// ============ Props ============

export interface McpRagRealLLMPanelProps {
  onClose: () => void;
  llmProviderName?: ProviderName;
}

// ============ 类型定义 ============

type TabKey = 'chat' | 'monitor' | 'debugger' | 'e2e';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ index: number; title: string; snippet: string; score: number }>;
  provider?: string;
  tokens?: { input: number; output: number; total: number };
  cost?: number;
  durationMs?: number;
  timestamp: number;
}

// ============ 主组件 ============

export function McpRagRealLLMPanel({ onClose, llmProviderName = 'mock' }: McpRagRealLLMPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [initialized, setInitialized] = useState(false);

  // 单例化的引擎实例
  const engineRef = useRef<McpRagRealLLM | null>(null);
  const monitorRef = useRef<RAGMonitor | null>(null);
  const debuggerRef = useRef<RAGDebugger | null>(null);
  const e2eRef = useRef<RAGE2ETestSuite | null>(null);

  // 初始化
  useEffect(() => {
    if (!initialized) {
      const monitor = new RAGMonitor();
      const dbg = new RAGDebugger();
      const e2e = new RAGE2ETestSuite();

      // 简单的 mock agent 用于演示
      const mockRagEngine = new McpRagEngine({});
      const mockAgent = new McpRagAgent(mockRagEngine);

      const realLLM = new McpRagRealLLM(mockAgent, {
        providers: [
          { provider: llmProviderName, priority: 10 },
          { provider: 'mock', priority: 100 },
        ],
        maxRetries: 1,
        retryDelayMs: 500,
      });

      // 注册 mock provider
      if (llmProviderName !== 'mock') {
        const mockProvider = new MockProvider();
        realLLM.registerProvider(mockProvider);
      }

      engineRef.current = realLLM;
      monitorRef.current = monitor;
      debuggerRef.current = dbg;
      e2eRef.current = e2e;
      setInitialized(true);
    }
  }, [initialized, llmProviderName]);

  const tabLabels: Record<TabKey, string> = {
    chat: '💬 智能对话',
    monitor: '📊 质量监控',
    debugger: '🔍 调试回放',
    e2e: '✅ E2E 测试',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={titleStyle}>🤖 MCP × RAG × 真实 LLM 端到端</h2>
            <p style={subtitleStyle}>多 Provider 协商 · 质量监控 · 调试回放 · E2E 自动化测试</p>
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
          {activeTab === 'chat' && engineRef.current && (
            <ChatTab engine={engineRef.current} />
          )}
          {activeTab === 'monitor' && monitorRef.current && (
            <MonitorTab monitor={monitorRef.current} />
          )}
          {activeTab === 'debugger' && debuggerRef.current && (
            <DebuggerTab debugger={debuggerRef.current} />
          )}
          {activeTab === 'e2e' && e2eRef.current && (
            <E2ETab suite={e2eRef.current} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 1: 智能对话 ============

function ChatTab({ engine }: { engine: McpRagRealLLM }) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<RAGPhase | null>(null);
  const [forceProvider, setForceProvider] = useState<ProviderName | 'auto'>('auto');

  const handleRun = useCallback(async () => {
    if (!query.trim() || running) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setRunning(true);
    setQuery('');

    try {
      const result = await engine.query(userMsg.content, {
        forceProvider: forceProvider === 'auto' ? undefined : forceProvider,
        onProgress: (phase) => setCurrentPhase(phase),
      });

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-r`,
        role: 'assistant',
        content: result.answer || '(无答案)',
        citations: result.citations.map((c) => ({
          index: c.index,
          title: c.title || c.documentId,
          snippet: c.snippet,
          score: c.score,
        })),
        provider: `${result.providerUsed}/${result.modelUsed}${result.fallback ? ' (fallback)' : ''}`,
        tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens, total: result.usage.totalTokens },
        cost: result.cost,
        durationMs: result.timings.totalMs,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        id: `msg-${Date.now()}-e`,
        role: 'assistant',
        content: `❌ 错误: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setRunning(false);
      setCurrentPhase(null);
    }
  }, [query, running, engine, forceProvider]);

  return (
    <div style={chatContainerStyle}>
      <div style={providerBarStyle}>
        <label style={labelStyle}>Provider:</label>
        <select
          value={forceProvider}
          onChange={(e) => setForceProvider(e.target.value as ProviderName | 'auto')}
          style={selectStyle}
          disabled={running}
        >
          <option value="auto">Auto (按优先级协商)</option>
          <option value="volcengine-ark">火山方舟 (Volcengine Ark)</option>
          <option value="deepseek">DeepSeek</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="mock">Mock (本地测试)</option>
        </select>
        {currentPhase && (
          <span style={phaseIndicatorStyle}>
            阶段: <strong>{currentPhase}</strong>
          </span>
        )}
      </div>

      <div style={messagesContainerStyle}>
        {messages.length === 0 ? (
          <div style={emptyStateStyle}>
            <p>👋 开始一次 MCP × RAG × LLM 端到端查询</p>
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
              示例查询："什么是 Hermes 平台？" / "列出所有 MCP 服务器" / "MCP 协议如何工作？"
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={msg.role === 'user' ? userMessageStyle : assistantMessageStyle}
            >
              <div style={messageHeaderStyle}>
                <strong>{msg.role === 'user' ? '👤 用户' : '🤖 助手'}</strong>
                {msg.provider && (
                  <span style={providerBadgeStyle}>
                    {msg.provider}
                  </span>
                )}
                {msg.tokens && (
                  <span style={metaBadgeStyle}>
                    {msg.tokens.total} tokens · ${msg.cost?.toFixed(4)} · {msg.durationMs}ms
                  </span>
                )}
              </div>
              <div style={messageContentStyle}>{msg.content}</div>
              {msg.citations && msg.citations.length > 0 && (
                <div style={citationsStyle}>
                  <strong style={{ fontSize: 12 }}>引用:</strong>
                  {msg.citations.map((c) => (
                    <div key={c.index} style={citationItemStyle}>
                      <span style={citationIndexStyle}>[{c.index}]</span>{' '}
                      <strong>{c.title}</strong> · 相关性: {c.score.toFixed(3)}
                      <div style={citationSnippetStyle}>"{c.snippet}"</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div style={inputBarStyle}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleRun()}
          placeholder="输入查询问题..."
          style={inputStyle}
          disabled={running}
        />
        <button
          onClick={handleRun}
          disabled={running || !query.trim()}
          style={runButtonStyle(running || !query.trim())}
        >
          {running ? '⏳ 执行中...' : '🚀 发送'}
        </button>
      </div>
    </div>
  );
}

// ============ Tab 2: 质量监控 ============

function MonitorTab({ monitor }: { monitor: RAGMonitor }) {
  const [stats, setStats] = useState(monitor.getStats());
  const [window, setWindow] = useState<WindowAggregation>(monitor.getWindowAggregation());
  const [recentRecords, setRecentRecords] = useState<RAGQueryRecord[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  useEffect(() => {
    const refresh = () => {
      setStats(monitor.getStats());
      setWindow(monitor.getWindowAggregation());
      setRecentRecords(monitor.getHistory(20).reverse());
      setAlerts(monitor.getAlerts(undefined, 'warning').reverse());
    };
    refresh();
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [monitor]);

  return (
    <div style={monitorContainerStyle}>
      <h3 style={sectionTitleStyle}>📈 整体统计</h3>
      <div style={statsGridStyle}>
        <StatBox label="总查询数" value={stats.totalRecords} icon="📊" />
        <StatBox label="成功率" value={`${((stats.totalRecords > 0 ? stats.successCount / stats.totalRecords : 0) * 100).toFixed(1)}%`} icon="✅" />
        <StatBox label="总 Token" value={stats.totalTokensUsed.toLocaleString()} icon="🔢" />
        <StatBox label="总成本" value={`$${stats.totalCost.toFixed(4)}`} icon="💰" />
        <StatBox label="平均延迟" value={`${stats.avgLatencyMs.toFixed(0)}ms`} icon="⏱️" />
        <StatBox label="P95 延迟" value={`${stats.p95LatencyMs}ms`} icon="⏱️" />
        <StatBox label="命中率" value={`${(stats.avgHitRate * 100).toFixed(1)}%`} icon="🎯" />
        <StatBox label="告警数" value={stats.alertCount} icon="⚠️" />
      </div>

      <h3 style={sectionTitleStyle}>⏰ 时间窗口聚合 ({window.queryCount} 查询)</h3>
      <div style={statsGridStyle}>
        <StatBox label="窗口查询数" value={window.queryCount} icon="📊" />
        <StatBox label="窗口成功率" value={`${(window.successRate * 100).toFixed(1)}%`} icon="✅" />
        <StatBox label="窗口 Token" value={window.totalTokens} icon="🔢" />
        <StatBox label="窗口成本" value={`$${window.totalCost.toFixed(4)}`} icon="💰" />
        <StatBox label="平均延迟" value={`${window.avgLatencyMs.toFixed(0)}ms`} icon="⏱️" />
        <StatBox label="P95 延迟" value={`${window.p95LatencyMs}ms`} icon="⏱️" />
      </div>

      <h3 style={sectionTitleStyle}>📜 最近查询</h3>
      <div style={tableContainerStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>时间</th>
              <th style={thStyle}>查询</th>
              <th style={thStyle}>Provider</th>
              <th style={thStyle}>耗时</th>
              <th style={thStyle}>Token</th>
              <th style={thStyle}>状态</th>
            </tr>
          </thead>
          <tbody>
            {recentRecords.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>暂无数据</td></tr>
            ) : recentRecords.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>{new Date(r.timestamp).toLocaleTimeString()}</td>
                <td style={tdStyle}>{r.query.slice(0, 40)}</td>
                <td style={tdStyle}>{r.provider}</td>
                <td style={tdStyle}>{r.latency.totalMs}ms</td>
                <td style={tdStyle}>{r.tokens.total}</td>
                <td style={tdStyle}>
                  <span style={r.success ? statusOkStyle : statusErrStyle}>
                    {r.success ? '✅' : '❌'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alerts.length > 0 && (
        <>
          <h3 style={sectionTitleStyle}>⚠️ 告警</h3>
          <div style={alertsContainerStyle}>
            {alerts.slice(0, 10).map((alert) => (
              <div key={alert.id} style={alertItemStyle(alert.severity)}>
                <strong>[{alert.severity.toUpperCase()}] {alert.type}</strong>
                <p style={{ margin: '4px 0' }}>{alert.message}</p>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {new Date(alert.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div style={statBoxStyle}>
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
    </div>
  );
}

// ============ Tab 3: 调试回放 ============

function DebuggerTab({ debugger: dbg }: { debugger: RAGDebugger }) {
  const [sessions, setSessions] = useState<RAGSession[]>(dbg.getRecentSessions(20).reverse());
  const [selectedSession, setSelectedSession] = useState<RAGSession | null>(sessions[0] ?? null);
  const [analysis, setAnalysis] = useState<StageAnalysis[]>([]);
  const [replay, setReplay] = useState<{ currentTimeMs: number; speed: number; paused: boolean; currentEventIndex: number } | null>(null);

  useEffect(() => {
    if (selectedSession) {
      setAnalysis(dbg.analyzeStages(selectedSession.id));
      const ctrl = dbg.getReplayControl(selectedSession.id);
      if (ctrl) setReplay({ ...ctrl });
    }
  }, [selectedSession, dbg]);

  const handleStartReplay = () => {
    if (!selectedSession) return;
    const ctrl = dbg.startReplay(selectedSession.id, 1.0);
    setReplay({ ...ctrl });
  };

  const handleAdvance = () => {
    if (!selectedSession) return;
    const ctrl = dbg.advanceReplay(selectedSession.id);
    if (ctrl) setReplay({ ...ctrl });
  };

  const handlePause = () => {
    if (!selectedSession) return;
    dbg.pauseReplay(selectedSession.id);
    const ctrl = dbg.getReplayControl(selectedSession.id);
    if (ctrl) setReplay({ ...ctrl });
  };

  const handleResume = () => {
    if (!selectedSession) return;
    dbg.resumeReplay(selectedSession.id);
    const ctrl = dbg.getReplayControl(selectedSession.id);
    if (ctrl) setReplay({ ...ctrl });
  };

  const handleExportMarkdown = () => {
    if (!selectedSession) return;
    const md = dbg.exportSessionAsMarkdown(selectedSession.id);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag-session-${selectedSession.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMermaid = () => {
    if (!selectedSession) return;
    const mermaid = dbg.exportSessionAsMermaid(selectedSession.id);
    const blob = new Blob([mermaid], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag-session-${selectedSession.id}.mmd`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={debuggerContainerStyle}>
      <h3 style={sectionTitleStyle}>📋 会话列表</h3>
      <div style={sessionListStyle}>
        {sessions.length === 0 ? (
          <div style={{ padding: 20, color: '#9ca3af', textAlign: 'center' }}>
            暂无会话
          </div>
        ) : sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedSession(s)}
            style={sessionItemStyle(selectedSession?.id === s.id)}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>{s.query.slice(0, 50)}</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>
              {s.id.slice(-12)} · {s.totalDurationMs ?? 0}ms · {s.status}
            </div>
          </button>
        ))}
      </div>

      {selectedSession && (
        <>
          <div style={debuggerControlsStyle}>
            <h3 style={sectionTitleStyle}>🎬 会话回放控制</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={handleStartReplay} style={controlButtonStyle}>▶️ 开始</button>
              <button onClick={handleAdvance} style={controlButtonStyle}>⏭️ 推进</button>
              <button onClick={handlePause} style={controlButtonStyle}>⏸️ 暂停</button>
              <button onClick={handleResume} style={controlButtonStyle}>▶️ 继续</button>
              <button onClick={handleExportMarkdown} style={controlButtonStyle}>📄 导出 MD</button>
              <button onClick={handleExportMermaid} style={controlButtonStyle}>📊 导出 Mermaid</button>
            </div>
            {replay && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#4b5563' }}>
                <strong>回放状态:</strong> {replay.paused ? '⏸️ 已暂停' : '▶️ 播放中'} ·{' '}
                当前事件: {replay.currentEventIndex + 1} / {selectedSession.events.length} ·{' '}
                速度: {replay.speed}x
              </div>
            )}
          </div>

          <h3 style={sectionTitleStyle}>📊 阶段耗时分析</h3>
          <div style={tableContainerStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>阶段</th>
                  <th style={thStyle}>事件数</th>
                  <th style={thStyle}>总耗时</th>
                  <th style={thStyle}>平均</th>
                  <th style={thStyle}>最大</th>
                  <th style={thStyle}>占比</th>
                </tr>
              </thead>
              <tbody>
                {analysis.map((a) => (
                  <tr key={a.stage}>
                    <td style={tdStyle}>{a.stage}</td>
                    <td style={tdStyle}>{a.eventCount}</td>
                    <td style={tdStyle}>{a.totalDurationMs}ms</td>
                    <td style={tdStyle}>{a.avgDurationMs.toFixed(1)}ms</td>
                    <td style={tdStyle}>{a.maxDurationMs}ms</td>
                    <td style={tdStyle}>{a.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={sectionTitleStyle}>📝 事件列表</h3>
          <div style={eventsContainerStyle}>
            {selectedSession.events.map((event) => (
              <div key={event.id} style={eventItemStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }}>{event.stage}: {event.name}</strong>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>
                    {event.durationMs !== undefined ? `${event.durationMs}ms` : ''}
                  </span>
                </div>
                {event.input !== undefined && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#4b5563' }}>Input</summary>
                    <pre style={preStyle}>{JSON.stringify(event.input, null, 2)}</pre>
                  </details>
                )}
                {event.output !== undefined && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#4b5563' }}>Output</summary>
                    <pre style={preStyle}>{JSON.stringify(event.output, null, 2)}</pre>
                  </details>
                )}
                {event.error && (
                  <div style={{ color: '#dc2626', fontSize: 11, marginTop: 4 }}>
                    ❌ {event.error.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============ Tab 4: E2E 测试 ============

function E2ETab({ suite }: { suite: RAGE2ETestSuite }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<E2ETestSuiteResult | null>(null);
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown'>('markdown');

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const res = await suite.runAll();
      setResult(res);
    } finally {
      setRunning(false);
    }
  }, [suite]);

  const handleExport = () => {
    if (!result) return;
    const content = exportFormat === 'json' ? suite.exportReport(result) : suite.exportReportAsMarkdown(result);
    const ext = exportFormat === 'json' ? 'json' : 'md';
    const mimeType = exportFormat === 'json' ? 'application/json' : 'text/markdown';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag-e2e-report.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={e2eContainerStyle}>
      <div style={e2eHeaderStyle}>
        <h3 style={sectionTitleStyle}>🧪 E2E 测试套件</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={labelStyle}>导出:</label>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'json' | 'markdown')}
            style={selectStyle}
          >
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
          </select>
          <button
            onClick={handleRun}
            disabled={running}
            style={runButtonStyle(running)}
          >
            {running ? '⏳ 运行中...' : `🚀 运行 ${DEFAULT_E2E_SCENARIOS.length} 个场景`}
          </button>
          {result && (
            <button onClick={handleExport} style={controlButtonStyle}>
              📥 导出报告
            </button>
          )}
        </div>
      </div>

      {result && (
        <>
          <h3 style={sectionTitleStyle}>📊 测试结果</h3>
          <div style={statsGridStyle}>
            <StatBox label="总测试数" value={result.totalTests} icon="📊" />
            <StatBox label="通过" value={result.passedTests} icon="✅" />
            <StatBox label="失败" value={result.failedTests} icon="❌" />
            <StatBox label="通过率" value={`${(result.passRate * 100).toFixed(1)}%`} icon="🎯" />
            <StatBox label="平均耗时" value={`${result.benchmarks.avgDurationMs.toFixed(0)}ms`} icon="⏱️" />
            <StatBox label="P95 耗时" value={`${result.benchmarks.p95DurationMs}ms`} icon="⏱️" />
            <StatBox label="命中率" value={`${(result.quality.avgHitRate * 100).toFixed(1)}%`} icon="🎯" />
            <StatBox label="引用准确率" value={`${(result.quality.avgCitationAccuracy * 100).toFixed(1)}%`} icon="📑" />
          </div>

          <h3 style={sectionTitleStyle}>📋 各分类统计</h3>
          <div style={tableContainerStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>分类</th>
                  <th style={thStyle}>总测试数</th>
                  <th style={thStyle}>通过</th>
                  <th style={thStyle}>失败</th>
                  <th style={thStyle}>通过率</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.byCategory).map(([cat, stats]) => (
                  <tr key={cat}>
                    <td style={tdStyle}><strong>{cat}</strong></td>
                    <td style={tdStyle}>{stats.total}</td>
                    <td style={tdStyle}>{stats.passed}</td>
                    <td style={tdStyle}>{stats.failed}</td>
                    <td style={tdStyle}>{(stats.passRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={sectionTitleStyle}>📜 详细结果</h3>
          <div style={tableContainerStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>场景</th>
                  <th style={thStyle}>分类</th>
                  <th style={thStyle}>通过</th>
                  <th style={thStyle}>耗时</th>
                  <th style={thStyle}>失败原因</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.scenarioId}>
                    <td style={tdStyle}>{r.scenarioId}</td>
                    <td style={tdStyle}>{r.scenarioName}</td>
                    <td style={tdStyle}>{r.category}</td>
                    <td style={tdStyle}>
                      <span style={r.passed ? statusOkStyle : statusErrStyle}>
                        {r.passed ? '✅' : '❌'}
                      </span>
                    </td>
                    <td style={tdStyle}>{r.durationMs}ms</td>
                    <td style={tdStyle}>{r.failureReason ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!result && !running && (
        <div style={emptyStateStyle}>
          <p>👆 点击"运行"按钮执行全部 {DEFAULT_E2E_SCENARIOS.length} 个 E2E 测试场景</p>
        </div>
      )}
    </div>
  );
}

// ============ 样式 ============

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const contentStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  width: '100%',
  maxWidth: 1400,
  height: '90vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 24px',
  borderBottom: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  margin: 0,
  color: '#111827',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  margin: '4px 0 0 0',
};

const closeButtonStyle: React.CSSProperties = {
  background: '#f3f4f6',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #e5e7eb',
  padding: '0 16px',
  gap: 4,
};

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  background: active ? '#dbeafe' : 'transparent',
  border: 'none',
  padding: '12px 16px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: active ? 600 : 400,
  color: active ? '#1e40af' : '#6b7280',
  borderBottom: active ? '2px solid #1e40af' : '2px solid transparent',
  borderRadius: '6px 6px 0 0',
});

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 16,
};

// Chat Tab
const chatContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const providerBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  padding: '8px 12px',
  background: '#f9fafb',
  borderRadius: 6,
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  fontSize: 13,
  background: '#fff',
};

const phaseIndicatorStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#4b5563',
  marginLeft: 'auto',
};

const messagesContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 12,
  background: '#fafafa',
  borderRadius: 6,
  marginBottom: 12,
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  color: '#9ca3af',
  padding: 40,
  fontSize: 14,
};

const userMessageStyle: React.CSSProperties = {
  background: '#dbeafe',
  padding: 12,
  borderRadius: 8,
  marginBottom: 8,
};

const assistantMessageStyle: React.CSSProperties = {
  background: '#fff',
  padding: 12,
  borderRadius: 8,
  marginBottom: 8,
  border: '1px solid #e5e7eb',
};

const messageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 8,
  fontSize: 13,
};

const providerBadgeStyle: React.CSSProperties = {
  background: '#e0e7ff',
  color: '#3730a3',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
};

const metaBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  marginLeft: 'auto',
};

const messageContentStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  color: '#1f2937',
};

const citationsStyle: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px solid #e5e7eb',
  fontSize: 12,
};

const citationItemStyle: React.CSSProperties = {
  background: '#f9fafb',
  padding: 8,
  borderRadius: 4,
  marginTop: 4,
};

const citationIndexStyle: React.CSSProperties = {
  background: '#1e40af',
  color: '#fff',
  padding: '1px 6px',
  borderRadius: 3,
  fontWeight: 600,
};

const citationSnippetStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  marginTop: 4,
  fontStyle: 'italic',
};

const inputBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  fontSize: 14,
};

const runButtonStyle = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? '#d1d5db' : '#1e40af',
  color: '#fff',
  border: 'none',
  padding: '10px 20px',
  borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 14,
  fontWeight: 600,
});

// Monitor Tab
const monitorContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  margin: '8px 0',
  color: '#1f2937',
};

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 12,
};

const statBoxStyle: React.CSSProperties = {
  background: '#f9fafb',
  padding: 12,
  borderRadius: 6,
  border: '1px solid #e5e7eb',
  textAlign: 'center',
};

const tableContainerStyle: React.CSSProperties = {
  overflowX: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  background: '#f3f4f6',
  padding: '10px 12px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  color: '#374151',
  borderBottom: '1px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 12,
};

const statusOkStyle: React.CSSProperties = { color: '#059669' };
const statusErrStyle: React.CSSProperties = { color: '#dc2626' };

const alertsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const alertItemStyle = (severity: string): React.CSSProperties => ({
  background: severity === 'critical' || severity === 'error' ? '#fef2f2' : '#fffbeb',
  border: `1px solid ${severity === 'critical' || severity === 'error' ? '#fecaca' : '#fed7aa'}`,
  padding: 10,
  borderRadius: 6,
  fontSize: 12,
});

// Debugger Tab
const debuggerContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const sessionListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 200,
  overflowY: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: 4,
};

const sessionItemStyle = (selected: boolean): React.CSSProperties => ({
  background: selected ? '#dbeafe' : 'transparent',
  border: 'none',
  padding: 8,
  borderRadius: 4,
  cursor: 'pointer',
  textAlign: 'left',
});

const debuggerControlsStyle: React.CSSProperties = {
  background: '#f9fafb',
  padding: 12,
  borderRadius: 6,
  border: '1px solid #e5e7eb',
};

const controlButtonStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const eventsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 300,
  overflowY: 'auto',
};

const eventItemStyle: React.CSSProperties = {
  background: '#fafafa',
  padding: 8,
  borderRadius: 4,
  border: '1px solid #e5e7eb',
};

const preStyle: React.CSSProperties = {
  fontSize: 11,
  background: '#f3f4f6',
  padding: 8,
  borderRadius: 4,
  margin: '4px 0',
  maxHeight: 200,
  overflow: 'auto',
};

// E2E Tab
const e2eContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const e2eHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
};

export default McpRagRealLLMPanel;
