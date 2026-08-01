/**
 * # ============================================================
 * # MCP × 真实平台配置面板 (Cycle 54 G54-INTEGRATION)
 * # ============================================================
 * # 5-Tab 集成：OTLP + Pushgateway + Grafana + Jaeger/Tempo + 文档
 * # ====================================
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { OTLPExporter, createDefaultOTLPEndpoint, createJaegerOTLPEndpoint, createTempoOTLPEndpoint } from '../utils/platformIntegration/otlpExporter';
import { PrometheusPushgateway, createPushgatewayEndpoint, createCounter, createGauge } from '../utils/platformIntegration/prometheusPushgateway';
import { GrafanaClient, createGrafanaCloudEndpoint, createSelfHostedGrafanaEndpoint, createDefaultDatasourceSet, generateDatasourceProvisioningYaml, generateDashboardProviderYaml } from '../utils/platformIntegration/grafanaCloud';
import { TraceBackendAdapter, createJaegerEndpoint, createTempoEndpoint } from '../utils/platformIntegration/traceBackendAdapter';
import type { TransportMode, PlatformEvent } from '../utils/platformIntegration/platformTypes';
import type { SpanData } from '../utils/observability/traceTypes';

type TabKey = 'otlp' | 'prometheus' | 'grafana' | 'trace' | 'docs';

interface McpPlatformIntegrationPanelProps {
  onClose: () => void;
}

export default function McpPlatformIntegrationPanel({ onClose }: McpPlatformIntegrationPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('otlp');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              🔌 MCP × 真实平台配置面板
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Cycle 54 G54-INTEGRATION | OTLP + Prometheus + Grafana + Jaeger/Tempo
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded"
          >
            关闭
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-4 overflow-x-auto">
          {([
            { key: 'otlp', label: '🔌 OTLP' },
            { key: 'prometheus', label: '📊 Prometheus' },
            { key: 'grafana', label: '📈 Grafana' },
            { key: 'trace', label: '🔍 追踪后端' },
            { key: 'docs', label: '📖 集成文档' },
          ] as Array<{ key: TabKey; label: string }>).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'otlp' && <OTLPTab />}
          {activeTab === 'prometheus' && <PrometheusTab />}
          {activeTab === 'grafana' && <GrafanaTab />}
          {activeTab === 'trace' && <TraceTab />}
          {activeTab === 'docs' && <DocsTab />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 1: OTLP 配置
// ============================================================

function OTLPTab() {
  const [endpoint, setEndpoint] = useState('http://localhost:4318');
  const [mode, setMode] = useState<TransportMode>('mock');
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string; latencyMs?: number }>({ type: 'idle', message: '' });
  const [exportResult, setExportResult] = useState<string>('');
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const exporterRef = React.useRef<OTLPExporter | null>(null);

  useEffect(() => {
    return () => {
      exporterRef.current?.shutdown();
    };
  }, []);

  const handleTest = useCallback(async () => {
    exporterRef.current?.shutdown();
    const exporter = new OTLPExporter({
      mode,
      enabled,
      endpoint: createDefaultOTLPEndpoint('otlp-test', endpoint, { timeoutMs: 5000 }),
    });
    exporterRef.current = exporter;
    const unsub = exporter.subscribe((e) => {
      setEvents((prev) => [e, ...prev].slice(0, 20));
    });
    await exporter.start();
    const health = await exporter.healthCheck();
    setStatus({
      type: health.status === 'connected' ? 'success' : 'error',
      message: health.status === 'connected' ? '连接成功' : (health.error ?? '连接失败'),
      latencyMs: health.latencyMs,
    });
    unsub();
  }, [endpoint, mode, enabled]);

  const handleExport = useCallback(async () => {
    if (!exporterRef.current) {
      const exporter = new OTLPExporter({
        mode,
        enabled,
        endpoint: createDefaultOTLPEndpoint('otlp-test', endpoint, { timeoutMs: 5000 }),
      });
      exporterRef.current = exporter;
      exporter.subscribe((e) => setEvents((prev) => [e, ...prev].slice(0, 20)));
      await exporter.start();
    }
    const spans: SpanData[] = Array.from({ length: 3 }, (_, i) => ({
      traceId: i.toString(16).padStart(32, '0'),
      spanId: i.toString(16).padStart(16, '0'),
      name: `test-span-${i}`,
      kind: 'internal' as const,
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 100,
      durationMs: 100,
      attributes: { 'service.name': 'demo', 'span.index': i },
      status: { code: 'OK' },
      events: [],
      links: [],
      resource: { serviceName: 'demo', serviceVersion: '1.0.0', deploymentEnvironment: 'test' },
      sampled: true,
    }));
    const result = await exporterRef.current.export(spans);
    setExportResult(
      `✅ 导出 ${result.successCount} 成功 / ${result.failureCount} 失败\n` +
      `⏱️  耗时 ${result.durationMs}ms\n` +
      `🔁 重试 ${result.retries} 次\n` +
      (result.errors ? `❌ 错误: ${result.errors.join(', ')}` : '')
    );
  }, [endpoint, mode, enabled]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            OTLP 端点 URL
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://localhost:4318"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">传输模式</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as TransportMode)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="mock">Mock 模式</option>
            <option value="real">真实模式</option>
            <option value="hybrid">混合模式</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded"
          />
          启用 OTLP Exporter
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded"
        >
          🔍 测试连接
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded"
        >
          📤 发送测试 Spans
        </button>
        <button
          onClick={() => {
            setEndpoint('http://jaeger-collector:4318');
            setMode('real');
          }}
          className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded"
        >
          🦅 切换 Jaeger
        </button>
        <button
          onClick={() => {
            setEndpoint('http://tempo-distributor:4318');
            setMode('real');
          }}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded"
        >
          🕐 切换 Tempo
        </button>
      </div>

      {status.type !== 'idle' && (
        <div
          className={`p-3 rounded text-sm ${
            status.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}
        >
          {status.type === 'success' ? '✅' : '❌'} {status.message}
          {status.latencyMs !== undefined && ` (${status.latencyMs}ms)`}
        </div>
      )}

      {exportResult && (
        <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto whitespace-pre-wrap">
{exportResult}
        </pre>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">预置端点</h3>
          <div className="space-y-1">
            <button
              onClick={() => setEndpoint('http://otel-collector:4318')}
              className="block w-full text-left text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              OpenTelemetry Collector (4318)
            </button>
            <button
              onClick={() => setEndpoint('http://jaeger-collector:4318')}
              className="block w-full text-left text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              Jaeger OTLP (4318)
            </button>
            <button
              onClick={() => setEndpoint('http://tempo-distributor:4318')}
              className="block w-full text-left text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              Tempo OTLP (4318)
            </button>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">事件日志</h3>
          <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs space-y-1 max-h-40 overflow-y-auto">
            {events.length === 0 ? (
              <div className="text-gray-400">无事件</div>
            ) : (
              events.map((e, i) => (
                <div key={i} className="text-gray-700 dark:text-gray-300">
                  <span className="text-gray-400">{new Date(e.timestamp).toLocaleTimeString()}</span> {e.type}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 2: Prometheus Pushgateway
// ============================================================

function PrometheusTab() {
  const [endpoint, setEndpoint] = useState('http://localhost:9091');
  const [jobName, setJobName] = useState('hermes-app');
  const [instance, setInstance] = useState('host-1');
  const [mode, setMode] = useState<TransportMode>('mock');
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [result, setResult] = useState<string>('');
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const pgRef = React.useRef<PrometheusPushgateway | null>(null);

  useEffect(() => {
    return () => {
      pgRef.current?.shutdown();
    };
  }, []);

  const ensurePg = useCallback(() => {
    if (pgRef.current) return pgRef.current;
    const pg = new PrometheusPushgateway({
      mode,
      enabled: true,
      endpoint: createPushgatewayEndpoint('pg', endpoint, { timeoutMs: 5000 }),
      jobName,
      instance,
    });
    pg.subscribe((e) => setEvents((prev) => [e, ...prev].slice(0, 20)));
    pgRef.current = pg;
    return pg;
  }, [endpoint, jobName, instance, mode]);

  const handleTest = useCallback(async () => {
    const pg = ensurePg();
    await pg.start();
    const health = await pg.healthCheck();
    setStatus({
      type: health.status === 'connected' ? 'success' : 'error',
      message: health.status === 'connected' ? '连接成功' : (health.error ?? '连接失败'),
    });
  }, [ensurePg]);

  const handlePush = useCallback(async () => {
    const pg = ensurePg();
    await pg.start();
    pg.addCounter(createCounter('http_requests_total', 100, { method: 'GET', status: '200' }, 'Total HTTP requests'));
    pg.addCounter(createCounter('http_requests_total', 5, { method: 'GET', status: '500' }, 'Total HTTP requests'));
    pg.addGauge(createGauge('memory_usage_bytes', 1024 * 1024 * 256, { instance }, 'Memory usage in bytes'));
    const r = await pg.push();
    setResult(
      `✅ 推送 ${r.successCount} 指标\n` +
      `❌ 失败 ${r.failureCount}\n` +
      `⏱️  耗时 ${r.durationMs}ms\n` +
      `🔁 重试 ${r.retries} 次`
    );
  }, [ensurePg, instance]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pushgateway URL</label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Job Name</label>
          <input
            type="text"
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Instance</label>
          <input
            type="text"
            value={instance}
            onChange={(e) => setInstance(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="text-sm text-gray-700 dark:text-gray-300">传输模式</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as TransportMode)}
          className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
        >
          <option value="mock">Mock</option>
          <option value="real">Real</option>
          <option value="hybrid">Hybrid</option>
        </select>
      </div>

      <div className="flex gap-2">
        <button onClick={handleTest} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded">
          🔍 测试连接
        </button>
        <button onClick={handlePush} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded">
          📤 推送指标
        </button>
      </div>

      {status.type !== 'idle' && (
        <div
          className={`p-3 rounded text-sm ${
            status.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}
        >
          {status.type === 'success' ? '✅' : '❌'} {status.message}
        </div>
      )}

      {result && (
        <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs whitespace-pre-wrap">
{result}
        </pre>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">事件</h3>
        <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs space-y-1 max-h-40 overflow-y-auto">
          {events.length === 0 ? <div className="text-gray-400">无事件</div> : events.map((e, i) => (
            <div key={i} className="text-gray-700 dark:text-gray-300">
              <span className="text-gray-400">{new Date(e.timestamp).toLocaleTimeString()}</span> {e.type}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 3: Grafana Cloud
// ============================================================

function GrafanaTab() {
  const [apiKey, setApiKey] = useState('demo-api-key-123');
  const [region, setRegion] = useState<'us' | 'eu' | 'asia'>('us');
  const [mode, setMode] = useState<TransportMode>('mock');
  const [provisioningYaml, setProvisioningYaml] = useState('');
  const [providerYaml, setProviderYaml] = useState('');
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [uploadResult, setUploadResult] = useState<string>('');
  const [datasources, setDatasources] = useState<Array<{ name: string; type: string; url: string }>>([]);
  const clientRef = React.useRef<GrafanaClient | null>(null);

  const handleGenerate = useCallback(() => {
    const ds = createDefaultDatasourceSet();
    setProvisioningYaml(generateDatasourceProvisioningYaml(apiKey, ds));
    setProviderYaml(
      generateDashboardProviderYaml(apiKey, {
        name: 'hermes-dashboards',
        folder: 'Hermes',
        folderUid: 'hermes-folder',
        type: 'file',
        updateIntervalSeconds: 30,
      })
    );
  }, [apiKey]);

  const handleTest = useCallback(async () => {
    const endpoint = region === 'us'
      ? createGrafanaCloudEndpoint(apiKey, 'us')
      : region === 'eu'
      ? createGrafanaCloudEndpoint(apiKey, 'eu')
      : createGrafanaCloudEndpoint(apiKey, 'asia');
    const client = new GrafanaClient({
      mode,
      enabled: true,
      endpoint,
    });
    clientRef.current = client;
    await client.start();
    const health = await client.healthCheck();
    setStatus({
      type: health.status === 'connected' ? 'success' : 'error',
      message: health.status === 'connected' ? '连接成功' : (health.error ?? '连接失败'),
    });
    const ds = await client.listDatasources();
    setDatasources(ds.data.map((d) => ({ name: d.name, type: d.type, url: d.url })));
  }, [apiKey, region, mode]);

  const handleUpload = useCallback(async () => {
    if (!clientRef.current) {
      handleTest();
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!clientRef.current) return;
    const result = await clientRef.current.uploadDashboard(
      {
        title: 'Hermes Demo Dashboard',
        uid: 'hermes-demo',
        panels: [],
        schemaVersion: 38,
      },
      { message: 'Uploaded from Hermes UI' }
    );
    setUploadResult(
      `📊 上传状态: ${result.status === 200 ? '成功' : '失败'}\n` +
      `🆔 Dashboard UID: ${result.data.uid ?? 'N/A'}\n` +
      `🔗 URL: ${result.data.url ?? 'N/A'}\n` +
      (result.message ? `💬 消息: ${result.message}` : '')
    );
  }, [handleTest]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">区域</label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as 'us' | 'eu' | 'asia')}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="us">US (grafana.com)</option>
            <option value="eu">EU (grafana.eu)</option>
            <option value="asia">Asia (grafana.cn)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">传输模式</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as TransportMode)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="mock">Mock</option>
            <option value="real">Real</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleTest} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded">
          🔍 测试连接
        </button>
        <button onClick={handleGenerate} className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded">
          🛠️ 生成 Provisioning YAML
        </button>
        <button onClick={handleUpload} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded">
          📤 上传 Demo Dashboard
        </button>
      </div>

      {status.type !== 'idle' && (
        <div
          className={`p-3 rounded text-sm ${
            status.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}
        >
          {status.type === 'success' ? '✅' : '❌'} {status.message}
        </div>
      )}

      {datasources.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">数据源列表</h3>
          <div className="grid grid-cols-3 gap-2">
            {datasources.map((ds) => (
              <div key={ds.name} className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                <div className="font-medium">{ds.name}</div>
                <div className="text-gray-500">{ds.type}</div>
                <div className="text-gray-400 truncate">{ds.url}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadResult && (
        <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs whitespace-pre-wrap">
{uploadResult}
        </pre>
      )}

      {provisioningYaml && (
        <details className="border border-gray-200 dark:border-gray-700 rounded p-3">
          <summary className="text-sm font-semibold cursor-pointer">📄 Datasource Provisioning YAML</summary>
          <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs overflow-x-auto">
{provisioningYaml}
          </pre>
        </details>
      )}

      {providerYaml && (
        <details className="border border-gray-200 dark:border-gray-700 rounded p-3">
          <summary className="text-sm font-semibold cursor-pointer">📄 Dashboard Provider YAML</summary>
          <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs overflow-x-auto">
{providerYaml}
          </pre>
        </details>
      )}
    </div>
  );
}

// ============================================================
// Tab 4: 追踪后端 (Jaeger/Tempo)
// ============================================================

function TraceTab() {
  const [backendType, setBackendType] = useState<'jaeger' | 'tempo'>('jaeger');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(16686);
  const [mode, setMode] = useState<TransportMode>('mock');
  const [services, setServices] = useState<Array<{ name: string; operations?: string[] }>>([]);
  const [searchResults, setSearchResults] = useState<Array<{ traceId: string; rootService?: string; rootOperation?: string; durationMs: number; spanCount: number }>>([]);
  const [traceDetail, setTraceDetail] = useState<{ traceId: string; spanCount: number; services: string[] } | null>(null);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const adapterRef = React.useRef<TraceBackendAdapter | null>(null);

  useEffect(() => {
    // 根据 backendType 切换默认端口
    if (backendType === 'jaeger') setPort(16686);
    else setPort(3200);
  }, [backendType]);

  useEffect(() => {
    return () => {
      adapterRef.current?.shutdown();
    };
  }, []);

  const handleListServices = useCallback(async () => {
    const endpoint = backendType === 'jaeger' ? createJaegerEndpoint(host, port) : createTempoEndpoint(host, port);
    const adapter = new TraceBackendAdapter({ mode, enabled: true, endpoint, backendType });
    adapterRef.current = adapter;
    await adapter.start();
    const result = await adapter.listServices();
    setServices(result);
    setStatus({ type: 'success', message: `发现 ${result.length} 个服务` });
  }, [backendType, host, port, mode]);

  const handleSearch = useCallback(async () => {
    if (!adapterRef.current) {
      await handleListServices();
    }
    if (!adapterRef.current) return;
    const results = await adapterRef.current.searchTraces({ limit: 10 });
    setSearchResults(results);
  }, [handleListServices]);

  const handleGetTrace = useCallback(async (traceId: string) => {
    if (!adapterRef.current) return;
    const detail = await adapterRef.current.getTrace(traceId);
    if (detail) {
      setTraceDetail({
        traceId: detail.traceId,
        spanCount: detail.spans.length,
        services: Array.from(new Set(Object.values(detail.processes).map((p) => p.serviceName))),
      });
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">后端类型</label>
          <select
            value={backendType}
            onChange={(e) => setBackendType(e.target.value as 'jaeger' | 'tempo')}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="jaeger">Jaeger</option>
            <option value="tempo">Tempo</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Host</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">传输模式</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as TransportMode)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="mock">Mock</option>
            <option value="real">Real</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleListServices} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded">
          📋 列出服务
        </button>
        <button onClick={handleSearch} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded">
          🔍 搜索 Traces
        </button>
      </div>

      {status.type !== 'idle' && (
        <div
          className={`p-3 rounded text-sm ${
            status.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}
        >
          {status.type === 'success' ? '✅' : '❌'} {status.message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">服务列表</h3>
          <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs space-y-1 max-h-60 overflow-y-auto">
            {services.length === 0 ? <div className="text-gray-400">点击"列出服务"开始</div> : services.map((s) => (
              <div key={s.name} className="p-1">
                <div className="font-medium text-gray-800 dark:text-gray-200">{s.name}</div>
                {s.operations && (
                  <div className="text-gray-500 ml-2">{s.operations.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Trace 搜索结果</h3>
          <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs space-y-1 max-h-60 overflow-y-auto">
            {searchResults.length === 0 ? <div className="text-gray-400">点击"搜索 Traces"开始</div> : searchResults.map((t) => (
              <div
                key={t.traceId}
                className="p-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                onClick={() => handleGetTrace(t.traceId)}
              >
                <div className="font-mono text-xs text-gray-600 dark:text-gray-300">{t.traceId.slice(0, 16)}...</div>
                <div className="text-gray-500">{t.rootService} / {t.rootOperation}</div>
                <div className="text-gray-400">⏱ {t.durationMs}ms · 📦 {t.spanCount} spans</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {traceDetail && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-sm">
          <div className="font-medium mb-1">Trace 详情</div>
          <div>ID: <span className="font-mono">{traceDetail.traceId}</span></div>
          <div>Spans: {traceDetail.spanCount}</div>
          <div>Services: {traceDetail.services.join(', ')}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tab 5: 集成文档
// ============================================================

function DocsTab() {
  return (
    <div className="prose dark:prose-invert max-w-none text-sm space-y-4">
      <h2 className="text-lg font-bold">📖 真实可观测性平台集成指南</h2>
      <p>
        Cycle 54 将本地可观测性工具与 4 大主流后端平台打通。本指南说明如何在生产环境中部署和配置这些集成。
      </p>

      <h3 className="text-base font-semibold">🔌 G54-01: OpenTelemetry OTLP</h3>
      <p>通过 OTLP HTTP/JSON 协议将追踪数据导出到 OpenTelemetry Collector、Jaeger 或 Tempo。</p>
      <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs">
{`// 创建 OTLP 导出器
const exporter = new OTLPExporter({
  mode: 'real',
  endpoint: createDefaultOTLPEndpoint(
    'otel-collector',
    'http://otel-collector:4318'
  ),
  resourceAttributes: {
    'service.name': 'my-service',
    'deployment.environment': 'production',
  },
});

// 启动并导出 spans
await exporter.start();
await exporter.export(spans);

// 切换到 Jaeger
const jaegerExp = new OTLPExporter({
  mode: 'real',
  endpoint: createJaegerOTLPEndpoint('jaeger', 4318),
});`}
      </pre>

      <h3 className="text-base font-semibold">📊 G54-02: Prometheus Pushgateway</h3>
      <p>将短期/批处理任务的指标推送到 Pushgateway，再由 Prometheus 抓取。</p>
      <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs">
{`// 创建 Pushgateway
const pg = new PrometheusPushgateway({
  mode: 'real',
  endpoint: createPushgatewayEndpoint('pg', 'http://pushgateway:9091'),
  jobName: 'batch-job',
  instance: 'worker-1',
});

// 添加并推送指标
pg.addCounter(createCounter('jobs_total', 1, { status: 'success' }));
pg.addGauge(createGauge('queue_size', 42));
await pg.push();`}
      </pre>

      <h3 className="text-base font-semibold">📈 G54-03: Grafana Cloud</h3>
      <p>通过 Grafana HTTP API 上传仪表盘、配置 Datasource、生成 Provisioning YAML。</p>
      <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs">
{`// 连接 Grafana Cloud
const client = new GrafanaClient({
  mode: 'real',
  endpoint: createGrafanaCloudEndpoint('api-key-xxx', 'us'),
});

// 上传仪表盘
await client.uploadDashboard(myDashboardJson);

// 生成 Provisioning 配置
const yaml = generateDatasourceProvisioningYaml('api-key', [
  { name: 'Prometheus', type: 'prometheus', access: 'proxy', url: 'http://prom:9090' },
]);`}
      </pre>

      <h3 className="text-base font-semibold">🔍 G54-04: Jaeger / Tempo 适配器</h3>
      <p>统一的 HTTP API 适配层，搜索、查询分布式追踪数据。</p>
      <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs">
{`// 连接 Jaeger
const jaeger = new TraceBackendAdapter({
  mode: 'real',
  endpoint: createJaegerEndpoint('jaeger', 16686),
  backendType: 'jaeger',
});

// 列出服务
const services = await jaeger.listServices();

// 搜索 traces
const results = await jaeger.searchTraces({
  service: 'api-gateway',
  operation: 'GET /users',
  limit: 20,
});

// 获取 trace 详情
const detail = await jaeger.getTrace('abc123');`}
      </pre>

      <h3 className="text-base font-semibold">🔄 与 Cycle 53 可观测性集成</h3>
      <ul className="list-disc list-inside space-y-1 text-xs">
        <li><strong>Tracer</strong>: 使用 OTLPExporter 替代 InMemoryExporter，将 Span 发送到 Collector</li>
        <li><strong>PromQL</strong>: 配合 Grafana Cloud 实现真实查询可视化</li>
        <li><strong>SLO</strong>: 通过 Prometheus Pushgateway 推送 SLI 数据，触发告警</li>
        <li><strong>Chaos Monkey</strong>: 故障注入后通过 Jaeger/Tempo 查看影响范围</li>
      </ul>

      <h3 className="text-base font-semibold">🚀 部署建议</h3>
      <ol className="list-decimal list-inside space-y-1 text-xs">
        <li>开发环境使用 <code>mode: 'mock'</code> 快速验证</li>
        <li>预发环境使用 <code>mode: 'hybrid'</code> 失败回退</li>
        <li>生产环境使用 <code>mode: 'real'</code> + 健康检查</li>
        <li>通过环境变量注入 API Key 和端点 URL</li>
        <li>启用重试和断路器应对网络抖动</li>
      </ol>
    </div>
  );
}
