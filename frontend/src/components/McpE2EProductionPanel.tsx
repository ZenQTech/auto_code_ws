/**
 * # ============================================================
 * # McpE2EProductionPanel - MCP × 真实 E2E 生产面板 (v1.0.0 Cycle 50)
 * # ============================================================
 * # 核心作用：集成真实生产环境核心组件到主应用
 * #           - Tab 1: 真实火山方舟 (RealVolcengineClient)
 * #           - Tab 2: E2E 端到端测试 (MultimodalRAGE2ETestSuite)
 * #           - Tab 3: 监控与可观测性 (MetricsRegistry)
 * #           - Tab 4: API Key 管理 (ApiKeyManager)
 * #           - Tab 5: 限流与配额 (RateLimiter)
 * #           - Tab 6: 部署与文档
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 50 G50-INTEGRATION 主应用集成
 * # ====================================
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRealVolcengineClient, type RealVolcengineStats, type RealVolcengineEvent } from '../utils/realVolcengineClient';
import { MultimodalRAGE2ETestSuite, createE2ETestSuite, type E2ETestSuiteReport } from '../utils/multimodalRAGE2ETestSuite';
import { MetricsRegistry, getMetricsRegistry, type MetricsEvent } from '../utils/metricsRegistry';
import { createApiKeyManager, getApiKeyManager, type ApiKeyProvider, type ApiKeyAuditEvent } from '../utils/apiKeyManager';
import { RateLimiter, createVolcengineRateLimiter, type RateLimitStrategy, type RateLimitEvent, type RateLimitStats } from '../utils/rateLimiter';

// ============ Props ============

export interface McpE2EProductionPanelProps {
  onClose: () => void;
}

// ============ 类型定义 ============

type TabKey = 'volcengine' | 'e2e' | 'metrics' | 'apikey' | 'ratelimit' | 'deployment';

interface E2EProgress {
  scenarioId: string;
  scenarioName: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  durationMs?: number;
  recallAtK?: number;
  cacheHitRate?: number;
}

// ============ 主组件 ============

export default function McpE2EProductionPanel({ onClose }: McpE2EProductionPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('volcengine');
  const [metrics] = useState<MetricsRegistry>(() => getMetricsRegistry());
  const [apiKeyMgr] = useState(() => getApiKeyManager());
  const [client] = useState(() => createRealVolcengineClient({ apiKeyManager: apiKeyMgr, onMetric: (m) => metrics.inc('volcengine_api_requests_total', { status: m.type, endpoint: m.type === 'success' ? 'api' : 'fallback' }) }));
  const [rateLimiter] = useState(() => createVolcengineRateLimiter());

  // ===== Tab 1: Volcengine =====
  const [volcengineApiKey, setVolcengineApiKey] = useState('');
  const [volcengineInput, setVolcengineInput] = useState({ modality: 'text' as 'text' | 'image' | 'multimodal', text: '一只可爱的小猫咪', image: '' });
  const [volcengineResult, setVolcengineResult] = useState<{ embedding: number[]; cost: number; latencyMs: number; endpoint: string; tokens: number } | null>(null);
  const [volcengineStats, setVolcengineStats] = useState<RealVolcengineStats>(client.getStats());
  const [volcengineEvents, setVolcengineEvents] = useState<RealVolcengineEvent[]>([]);

  useEffect(() => {
    const unsub = client.subscribe((e) => {
      setVolcengineStats(client.getStats());
      setVolcengineEvents((prev) => [e, ...prev].slice(0, 50));
    });
    return () => unsub();
  }, [client]);

  // ===== Tab 2: E2E =====
  const [e2eSuite] = useState(() => createE2ETestSuite());
  const [e2eRunning, setE2eRunning] = useState(false);
  const [e2eReport, setE2eReport] = useState<E2ETestSuiteReport | null>(null);
  const [e2eProgress, setE2eProgress] = useState<E2EProgress[]>([]);

  // ===== Tab 3: Metrics =====
  const [metricsOutput, setMetricsOutput] = useState('');
  const [metricsFormat, setMetricsFormat] = useState<'prometheus' | 'json'>('prometheus');
  const [metricEvents, setMetricEvents] = useState<MetricsEvent[]>([]);

  useEffect(() => {
    const unsub = metrics.subscribe((e) => {
      setMetricEvents((prev) => [e, ...prev].slice(0, 50));
    });
    return () => unsub();
  }, [metrics]);

  // ===== Tab 4: API Key =====
  const [keyInput, setKeyInput] = useState('');
  const [keyProvider, setKeyProvider] = useState<ApiKeyProvider>('volcengine');
  const [keyAuditEvents, setKeyAuditEvents] = useState<ApiKeyAuditEvent[]>([]);
  const [keyStats, setKeyStats] = useState(apiKeyMgr.getStats());
  const [keyProviders, setKeyProviders] = useState(apiKeyMgr.listProviders());

  useEffect(() => {
    const unsub = apiKeyMgr.subscribe((e) => {
      setKeyAuditEvents((prev) => [e, ...prev].slice(0, 50));
      setKeyStats(apiKeyMgr.getStats());
      setKeyProviders(apiKeyMgr.listProviders());
    });
    return () => unsub();
  }, [apiKeyMgr]);

  // ===== Tab 5: Rate Limiter =====
  const [rlStrategy, setRlStrategy] = useState<RateLimitStrategy>('token-bucket');
  const [rlStats, setRlStats] = useState<RateLimitStats>(rateLimiter.getStats());
  const [rlEvents, setRlEvents] = useState<RateLimitEvent[]>([]);
  const [rlConfig, setRlConfig] = useState({ windowMs: 60000, maxRequests: 60, burstCapacity: 10, refillRate: 1 });

  useEffect(() => {
    const unsub = rateLimiter.subscribe((e) => {
      setRlEvents((prev) => [e, ...prev].slice(0, 50));
      setRlStats(rateLimiter.getStats());
    });
    return () => unsub();
  }, [rateLimiter]);

  // ===== 操作处理 =====

  const handleSetApiKey = async () => {
    if (!keyInput.trim()) return;
    try {
      await apiKeyMgr.setApiKey(keyProvider, keyInput);
      setKeyInput('');
    } catch (err) {
      alert(`设置 API Key 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleVolcengineEmbed = async () => {
    try {
      const input: { modality: 'text' | 'image' | 'multimodal'; text?: string; image?: string } = { modality: volcengineInput.modality };
      if (volcengineInput.text) input.text = volcengineInput.text;
      if (volcengineInput.image) input.image = volcengineInput.image;
      const result = await client.embed(input);
      setVolcengineResult({
        embedding: result.embedding,
        cost: result.cost,
        latencyMs: result.latencyMs,
        endpoint: result.endpoint,
        tokens: result.usage.totalTokens,
      });
    } catch (err) {
      alert(`Embedding 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRunE2E = async () => {
    if (e2eRunning) return;
    setE2eRunning(true);
    setE2eReport(null);
    setE2eProgress([
      { scenarioId: 'ecommerce-product-search', scenarioName: '电商商品检索', status: 'pending' },
      { scenarioId: 'knowledge-base-qa', scenarioName: '知识库问答', status: 'pending' },
      { scenarioId: 'hybrid-search', scenarioName: '混合检索', status: 'pending' },
      { scenarioId: 'cache-stress', scenarioName: '缓存压力测试', status: 'pending' },
    ]);
    const updateProgress = (scenarioId: string, update: Partial<E2EProgress>) => {
      setE2eProgress((prev) => prev.map((p) => (p.scenarioId === scenarioId ? { ...p, ...update } : p)));
    };
    const sub = e2eSuite.subscribe((e) => {
      if (e.type === 'scenario-complete' && e.scenarioId) {
        const scenario = e2eProgress.find((p) => p.scenarioId === e.scenarioId);
        if (scenario) {
          updateProgress(e.scenarioId, { status: 'passed', durationMs: e.latencyMs });
        }
      }
    });
    try {
      const report = await e2eSuite.runAll();
      setE2eReport(report);
      report.scenarios.forEach((s) => {
        updateProgress(s.scenarioId, {
          status: s.passed ? 'passed' : 'failed',
          durationMs: s.durationMs,
          recallAtK: s.metrics.recallAtK,
          cacheHitRate: s.metrics.cacheHitRate,
        });
      });
    } catch (err) {
      alert(`E2E 失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      sub();
      setE2eRunning(false);
    }
  };

  const handleExportMetrics = () => {
    const output = metricsFormat === 'prometheus' ? metrics.exportPrometheus() : JSON.stringify(metrics.exportJson(), null, 2);
    setMetricsOutput(output);
  };

  const handleAcquiringToken = () => {
    const result = rateLimiter.acquire(1);
    if (!result.allowed) {
      alert(`限流: 需等待 ${result.retryAfterMs}ms`);
    }
  };

  const handleResetAll = () => {
    if (confirm('确认清空所有状态？(API Key 不会被删除)')) {
      client.resetStats();
      metrics.reset();
      rateLimiter.reset();
      setVolcengineStats(client.getStats());
      setVolcengineEvents([]);
      setMetricEvents([]);
      setRlEvents([]);
      setRlStats(rateLimiter.getStats());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              🚀 MCP × 真实 E2E 生产面板
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Cycle 50 G50-INTEGRATION | 真实 API + 端到端测试 + 监控 + 安全 + 部署
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleResetAll}
              className="px-3 py-1 text-sm bg-orange-100 hover:bg-orange-200 dark:bg-orange-900 dark:hover:bg-orange-800 text-orange-700 dark:text-orange-200 rounded"
            >
              重置状态
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded"
            >
              关闭
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-4 overflow-x-auto">
          {[
            { key: 'volcengine', label: '🔥 真实火山方舟', icon: '1' },
            { key: 'e2e', label: '🧪 E2E 端到端', icon: '2' },
            { key: 'metrics', label: '📊 监控指标', icon: '3' },
            { key: 'apikey', label: '🔑 API Key', icon: '4' },
            { key: 'ratelimit', label: '⏱️ 限流配额', icon: '5' },
            { key: 'deployment', label: '📦 部署文档', icon: '6' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabKey)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <span className="mr-1 text-xs opacity-60">{tab.icon}.</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'volcengine' && (
            <VolcengineTab
              apiKeyConfigured={apiKeyMgr.hasApiKey('volcengine')}
              apiKey={volcengineApiKey}
              setApiKey={setVolcengineApiKey}
              input={volcengineInput}
              setInput={setVolcengineInput}
              onSubmit={handleVolcengineEmbed}
              result={volcengineResult}
              stats={volcengineStats}
              events={volcengineEvents}
            />
          )}
          {activeTab === 'e2e' && (
            <E2ETab
              running={e2eRunning}
              progress={e2eProgress}
              report={e2eReport}
              onRun={handleRunE2E}
              suite={e2eSuite}
            />
          )}
          {activeTab === 'metrics' && (
            <MetricsTab
              metrics={metrics}
              format={metricsFormat}
              setFormat={setMetricsFormat}
              output={metricsOutput}
              events={metricEvents}
              onExport={handleExportMetrics}
            />
          )}
          {activeTab === 'apikey' && (
            <ApiKeyTab
              provider={keyProvider}
              setProvider={setKeyProvider}
              keyInput={keyInput}
              setKeyInput={setKeyInput}
              onSetKey={handleSetApiKey}
              auditEvents={keyAuditEvents}
              stats={keyStats}
              providers={keyProviders}
              mgr={apiKeyMgr}
            />
          )}
          {activeTab === 'ratelimit' && (
            <RateLimitTab
              rateLimiter={rateLimiter}
              strategy={rlStrategy}
              setStrategy={setRlStrategy}
              stats={rlStats}
              events={rlEvents}
              config={rlConfig}
              setConfig={setRlConfig}
              onAcquire={handleAcquiringToken}
            />
          )}
          {activeTab === 'deployment' && (
            <DeploymentTab />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 1: 真实火山方舟 ============

interface VolcengineTabProps {
  apiKeyConfigured: boolean;
  apiKey: string;
  setApiKey: (k: string) => void;
  input: { modality: 'text' | 'image' | 'multimodal'; text: string; image: string };
  setInput: (i: { modality: 'text' | 'image' | 'multimodal'; text: string; image: string }) => void;
  onSubmit: () => void;
  result: { embedding: number[]; cost: number; latencyMs: number; endpoint: string; tokens: number } | null;
  stats: RealVolcengineStats;
  events: RealVolcengineEvent[];
}

function VolcengineTab({ apiKeyConfigured, apiKey, setApiKey, input, setInput, onSubmit, result, stats, events }: VolcengineTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 输入区 */}
        <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <h3 className="text-sm font-semibold mb-3">输入</h3>
          {!apiKeyConfigured && (
            <div className="mb-3 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
              ⚠️ 未配置 API Key,将自动降级到本地 CLIP
            </div>
          )}
          <div className="mb-3">
            <label className="text-xs text-gray-500">模态</label>
            <select
              value={input.modality}
              onChange={(e) => setInput({ ...input, modality: e.target.value as 'text' | 'image' | 'multimodal' })}
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            >
              <option value="text">文本</option>
              <option value="image">图像</option>
              <option value="multimodal">多模态</option>
            </select>
          </div>
          {(input.modality === 'text' || input.modality === 'multimodal') && (
            <div className="mb-3">
              <label className="text-xs text-gray-500">文本</label>
              <textarea
                value={input.text}
                onChange={(e) => setInput({ ...input, text: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                rows={3}
                placeholder="输入要嵌入的文本..."
              />
            </div>
          )}
          {(input.modality === 'image' || input.modality === 'multimodal') && (
            <div className="mb-3">
              <label className="text-xs text-gray-500">图像 URL</label>
              <input
                type="text"
                value={input.image}
                onChange={(e) => setInput({ ...input, image: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                placeholder="https://example.com/image.jpg"
              />
            </div>
          )}
          <button
            onClick={onSubmit}
            className="w-full px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded"
          >
            提交 Embedding 请求
          </button>
        </div>

        {/* 结果区 */}
        <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <h3 className="text-sm font-semibold mb-3">结果</h3>
          {result ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">端点:</span>
                <span className={`font-mono px-2 py-0.5 rounded ${result.endpoint === 'api' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {result.endpoint}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">延迟:</span>
                <span className="font-mono">{result.latencyMs}ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">成本:</span>
                <span className="font-mono">${result.cost.toFixed(6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tokens:</span>
                <span className="font-mono">{result.tokens}</span>
              </div>
              <div className="mt-2">
                <div className="text-gray-500 mb-1">向量 (前 10 维):</div>
                <div className="font-mono text-xs p-2 bg-gray-50 dark:bg-gray-800 rounded break-all">
                  [{result.embedding.slice(0, 10).map((v) => v.toFixed(3)).join(', ')}...]
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400">提交请求以查看结果</div>
          )}
        </div>
      </div>

      {/* 统计 */}
      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">调用统计</h3>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <StatBox label="总请求" value={stats.totalRequests} />
          <StatBox label="成功" value={stats.successRequests} color="green" />
          <StatBox label="降级" value={stats.fallbackRequests} color="yellow" />
          <StatBox label="限流" value={stats.rateLimitedRequests} color="red" />
          <StatBox label="重试" value={stats.retriedRequests} />
          <StatBox label="错误" value={stats.errorRequests} color="red" />
          <StatBox label="总成本" value={`$${stats.totalCostUsd.toFixed(4)}`} />
          <StatBox label="总 Tokens" value={stats.totalTokens} />
        </div>
      </div>

      {/* 事件流 */}
      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">事件流 (最近 50 条)</h3>
        <div className="max-h-48 overflow-y-auto text-xs font-mono space-y-1">
          {events.length === 0 ? (
            <div className="text-gray-400">暂无事件</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className="p-1 bg-gray-50 dark:bg-gray-800 rounded">
                <span className="text-gray-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className="ml-2 font-semibold">{e.type}</span>
                {(e as { endpoint?: string }).endpoint && (
                  <span className="ml-2 text-gray-500">endpoint={String((e as { endpoint?: string }).endpoint)}</span>
                )}
                {(e as { error?: string }).error && (
                  <span className="ml-2 text-red-500">{String((e as { error?: string }).error)}</span>
                )}
                {(e as { durationMs?: number }).durationMs && (
                  <span className="ml-2 text-gray-500">{String((e as { durationMs?: number }).durationMs)}ms</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 2: E2E 测试 ============

interface E2ETabProps {
  running: boolean;
  progress: E2EProgress[];
  report: E2ETestSuiteReport | null;
  onRun: () => void;
  suite: MultimodalRAGE2ETestSuite;
}

function E2ETab({ running, progress, report, onRun, suite }: E2ETabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">端到端测试套件</h3>
        <button
          onClick={onRun}
          disabled={running}
          className="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {running ? '运行中...' : '运行所有场景'}
        </button>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h4 className="text-xs font-semibold mb-2">场景进度</h4>
        <div className="space-y-2">
          {progress.map((p) => (
            <div key={p.scenarioId} className="flex items-center gap-3 text-xs">
              <span className={`w-2 h-2 rounded-full ${
                p.status === 'pending' ? 'bg-gray-300' :
                p.status === 'running' ? 'bg-blue-500 animate-pulse' :
                p.status === 'passed' ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span className="flex-1 font-medium">{p.scenarioName}</span>
              {p.recallAtK !== undefined && (
                <span className="text-gray-500">Recall@K: {p.recallAtK.toFixed(3)}</span>
              )}
              {p.cacheHitRate !== undefined && (
                <span className="text-gray-500">Cache: {(p.cacheHitRate * 100).toFixed(0)}%</span>
              )}
              {p.durationMs !== undefined && (
                <span className="text-gray-500">{p.durationMs}ms</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {report && (
        <>
          <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
            <h4 className="text-xs font-semibold mb-2">汇总</h4>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <StatBox label="总场景" value={report.summary.totalScenarios} />
              <StatBox label="通过" value={report.summary.passedScenarios} color="green" />
              <StatBox label="失败" value={report.summary.failedScenarios} color="red" />
              <StatBox label="通过率" value={`${(report.summary.passRate * 100).toFixed(1)}%`} />
              <StatBox label="总查询" value={report.summary.totalQueries} />
              <StatBox label="总文档" value={report.summary.totalDocuments} />
              <StatBox label="平均 Recall" value={report.summary.avgRecallAtK.toFixed(3)} />
              <StatBox label="平均 P95" value={`${report.summary.avgP95LatencyMs.toFixed(1)}ms`} />
            </div>
          </div>

          <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
            <h4 className="text-xs font-semibold mb-2">场景详情</h4>
            <div className="space-y-2 text-xs">
              {report.scenarios.map((s) => (
                <div key={s.scenarioId} className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                  <div className="flex items-center gap-2">
                    <span>{s.passed ? '✅' : '❌'}</span>
                    <span className="font-semibold">{s.scenarioName}</span>
                    <span className="text-gray-500">({s.scenarioId})</span>
                  </div>
                  <div className="mt-1 text-gray-500">
                    Recall@K={s.metrics.recallAtK.toFixed(3)} |
                    P95={s.metrics.p95LatencyMs.toFixed(1)}ms |
                    Cache={(s.metrics.cacheHitRate * 100).toFixed(0)}%
                  </div>
                  {s.failures.length > 0 && (
                    <div className="mt-1 text-red-500">
                      失败: {s.failures.join('; ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
            <h4 className="text-xs font-semibold mb-2">导出</h4>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard?.writeText(suite.exportMarkdown(report))}
                className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded"
              >
                复制 Markdown
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([suite.exportJson(report)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `e2e-report-${Date.now()}.json`;
                  a.click();
                }}
                className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded"
              >
                下载 JSON
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============ Tab 3: 监控指标 ============

interface MetricsTabProps {
  metrics: MetricsRegistry;
  format: 'prometheus' | 'json';
  setFormat: (f: 'prometheus' | 'json') => void;
  output: string;
  events: MetricsEvent[];
  onExport: () => void;
}

function MetricsTab({ metrics, format, setFormat, output, events, onExport }: MetricsTabProps) {
  const allMetrics = metrics.listMetrics();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">Prometheus 指标</h3>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'prometheus' | 'json')}
          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded"
        >
          <option value="prometheus">Prometheus 格式</option>
          <option value="json">JSON 格式</option>
        </select>
        <button onClick={onExport} className="px-3 py-1 text-sm bg-blue-500 text-white rounded">
          导出
        </button>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h4 className="text-xs font-semibold mb-2">已注册指标 ({allMetrics.length})</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {allMetrics.map((m) => (
            <div key={m} className="px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded font-mono truncate">
              {m}
            </div>
          ))}
        </div>
      </div>

      {output && (
        <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <h4 className="text-xs font-semibold mb-2">导出输出</h4>
          <pre className="text-xs font-mono p-3 bg-gray-50 dark:bg-gray-800 rounded overflow-x-auto max-h-64">
            {output}
          </pre>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h4 className="text-xs font-semibold mb-2">事件流</h4>
        <div className="max-h-32 overflow-y-auto text-xs font-mono space-y-1">
          {events.length === 0 ? (
            <div className="text-gray-400">暂无事件</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className="p-1 bg-gray-50 dark:bg-gray-800 rounded">
                <span className="text-gray-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className="ml-2 font-semibold">{e.type}</span>
                {'metricName' in e && <span className="ml-2 text-gray-500">{String(e.metricName)}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 4: API Key 管理 ============

interface ApiKeyTabProps {
  provider: ApiKeyProvider;
  setProvider: (p: ApiKeyProvider) => void;
  keyInput: string;
  setKeyInput: (k: string) => void;
  onSetKey: () => void;
  auditEvents: ApiKeyAuditEvent[];
  stats: { totalCreates: number; totalGets: number; totalRotates: number; totalDeletes: number; totalErrors: number };
  providers: ApiKeyProvider[];
  mgr: ReturnType<typeof getApiKeyManager>;
}

function ApiKeyTab({ provider, setProvider, keyInput, setKeyInput, onSetKey, auditEvents, stats, providers, mgr }: ApiKeyTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <h3 className="text-sm font-semibold mb-3">添加 API Key</h3>
          <div className="mb-3">
            <label className="text-xs text-gray-500">服务商</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ApiKeyProvider)}
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            >
              <option value="volcengine">火山方舟</option>
              <option value="openai">OpenAI</option>
              <option value="claude">Claude</option>
              <option value="gemini">Gemini</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">Qwen</option>
              <option value="glm">GLM</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-500">API Key (加密存储)</label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              placeholder="输入 API Key..."
            />
          </div>
          <button
            onClick={onSetKey}
            className="w-full px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded"
          >
            加密保存
          </button>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <h3 className="text-sm font-semibold mb-3">统计</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <StatBox label="创建" value={stats.totalCreates} />
            <StatBox label="读取" value={stats.totalGets} />
            <StatBox label="轮换" value={stats.totalRotates} />
            <StatBox label="删除" value={stats.totalDeletes} />
            <StatBox label="错误" value={stats.totalErrors} color="red" />
            <StatBox label="Provider" value={providers.length} />
          </div>
          <div className="mt-3">
            <h4 className="text-xs font-semibold mb-1">已配置 Provider</h4>
            <div className="flex flex-wrap gap-1">
              {providers.length === 0 ? (
                <span className="text-xs text-gray-400">无</span>
              ) : (
                providers.map((p) => (
                  <span key={p} className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                    {p}
                    <button onClick={() => mgr.deleteApiKey(p)} className="ml-1 text-red-500">×</button>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">审计日志</h3>
        <div className="max-h-48 overflow-y-auto text-xs font-mono space-y-1">
          {auditEvents.length === 0 ? (
            <div className="text-gray-400">暂无审计事件</div>
          ) : (
            auditEvents.map((e, i) => (
              <div key={i} className="p-1 bg-gray-50 dark:bg-gray-800 rounded">
                <span className="text-gray-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className="ml-2 font-semibold">{e.type}</span>
                <span className="ml-2 text-blue-500">{e.provider}</span>
                <span className="ml-2 text-gray-500">keyId={e.keyId}</span>
                {e.note && <span className="ml-2 text-gray-500">({e.note})</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 5: 限流配额 ============

interface RateLimitTabProps {
  rateLimiter: RateLimiter;
  strategy: RateLimitStrategy;
  setStrategy: (s: RateLimitStrategy) => void;
  stats: RateLimitStats;
  events: RateLimitEvent[];
  config: { windowMs: number; maxRequests: number; burstCapacity: number; refillRate: number };
  setConfig: (c: { windowMs: number; maxRequests: number; burstCapacity: number; refillRate: number }) => void;
  onAcquire: () => void;
}

function RateLimitTab({ strategy, setStrategy, stats, events, onAcquire }: RateLimitTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <h3 className="text-sm font-semibold mb-3">限流策略</h3>
          <div className="mb-3">
            <label className="text-xs text-gray-500">策略</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as RateLimitStrategy)}
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            >
              <option value="token-bucket">令牌桶 (Token Bucket)</option>
              <option value="sliding-window">滑动窗口 (Sliding Window)</option>
              <option value="fixed-window">固定窗口 (Fixed Window)</option>
              <option value="leaky-bucket">漏桶 (Leaky Bucket)</option>
            </select>
          </div>
          <button
            onClick={onAcquire}
            className="w-full px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded"
          >
            申请令牌
          </button>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <h3 className="text-sm font-semibold mb-3">统计</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <StatBox label="通过" value={stats.totalAcquires} color="green" />
            <StatBox label="拒绝" value={stats.totalRejects} color="red" />
            <StatBox label="释放" value={stats.totalReleases} />
            <StatBox label="重置" value={stats.totalResets} />
            <StatBox label="配额超限" value={stats.totalQuotaExceeded} color="yellow" />
            <StatBox label="当前令牌" value={stats.currentTokens ?? 0} />
          </div>
        </div>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">事件流</h3>
        <div className="max-h-48 overflow-y-auto text-xs font-mono space-y-1">
          {events.length === 0 ? (
            <div className="text-gray-400">暂无事件</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className="p-1 bg-gray-50 dark:bg-gray-800 rounded">
                <span className="text-gray-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className="ml-2 font-semibold">{e.type}</span>
                {('retryAfterMs' in e && e.retryAfterMs !== undefined) && (
                  <span className="ml-2 text-yellow-500">retry after {e.retryAfterMs}ms</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 6: 部署文档 ============

function DeploymentTab() {
  return (
    <div className="space-y-4 text-sm">
      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">📦 部署清单</h3>
        <ul className="text-xs space-y-1 list-disc list-inside">
          <li><code>frontend/Dockerfile</code> - 前端 Docker 镜像 (Node 24 + Nginx 1.27)</li>
          <li><code>deployment/nginx.conf</code> - Nginx 配置 (CSP / HSTS / Gzip / 缓存)</li>
          <li><code>docker-compose.production.yml</code> - 完整编排 (frontend + backend + postgres + 可选 prometheus + grafana)</li>
          <li><code>deployment/prometheus.yml</code> - Prometheus 抓取配置</li>
          <li><code>deployment/grafana-datasources.yml</code> - Grafana 数据源</li>
          <li><code>deployment/postgres-init.sql</code> - PostgreSQL 初始化 (扩展 + 表结构)</li>
        </ul>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">🚀 快速启动</h3>
        <pre className="text-xs font-mono p-3 bg-gray-50 dark:bg-gray-800 rounded overflow-x-auto">
{`# 1. 创建 .env.production
cp .env.example .env.production
vim .env.production  # 填入真实配置

# 2. 构建并启动
docker compose -f docker-compose.production.yml up -d

# 3. (可选) 启动监控
docker compose -f docker-compose.production.yml --profile monitoring up -d

# 4. 健康检查
curl http://localhost:8080/healthz  # 前端
curl http://localhost:8000/health    # 后端
curl http://localhost:9090/-/healthy # Prometheus (如果启用)`}
        </pre>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">🔒 安全检查清单</h3>
        <ul className="text-xs space-y-1 list-disc list-inside">
          <li>✅ CSP / HSTS / X-Frame-Options 已配置</li>
          <li>✅ API Key AES-256-CBC 加密存储</li>
          <li>✅ 限流保护 (4 种策略)</li>
          <li>✅ 容器非 root 用户运行</li>
          <li>✅ 资源限制 (CPU / Memory)</li>
          <li>✅ 监控告警 (Prometheus)</li>
          <li>✅ 审计日志完整</li>
          <li>✅ 错误信息脱敏</li>
        </ul>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">📊 性能指标目标</h3>
        <ul className="text-xs space-y-1 list-disc list-inside">
          <li>Embedding P95 延迟: &lt; 200ms (fallback) / &lt; 1000ms (真实 API)</li>
          <li>缓存命中率: &gt; 50% (热查询)</li>
          <li>Recall@K: &gt; 0.85 (知识库场景)</li>
          <li>API 错误率: &lt; 1%</li>
          <li>容器内存: frontend &lt; 512MB / backend &lt; 4GB</li>
        </ul>
      </div>

      <div className="text-xs text-gray-500">
        📚 完整文档请参考: <code>DEPLOYMENT.md</code> 和 <code>SECURITY.md</code>
      </div>
    </div>
  );
}

// ============ 工具组件 ============

function StatBox({ label, value, color }: { label: string; value: string | number; color?: 'green' | 'red' | 'yellow' }) {
  const colorClass = color === 'green' ? 'text-green-600' : color === 'red' ? 'text-red-600' : color === 'yellow' ? 'text-yellow-600' : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-mono font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}
