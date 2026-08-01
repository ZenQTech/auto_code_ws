/**
 * # ============================================================
 * # MCP × 可观测性面板 (Cycle 53 G53-INTEGRATION)
 * # ============================================================
 * # 核心作用：集成 4 大可观测性能力的主应用面板
 * # 5-Tab UI:
 * #   - Tab 1 (🔭 分布式追踪): Tracer - OpenTelemetry 追踪系统
 * #   - Tab 2 (📊 指标+仪表盘): PromQL + Grafana - 指标查询与可视化
 * #   - Tab 3 (🎯 SLO/SLI): SLOCalculator - 服务质量目标与错误预算
 * #   - Tab 4 (🐒 混沌工程): ChaosMonkey - 故障注入测试
 * #   - Tab 5 (📖 集成文档): 4 引擎使用指南
 * # 输入参数：onClose 回调
 * # 输出结果：完整 UI 面板
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-INTEGRATION 初次创建
 * # ====================================
 */

import { useState, useRef, useEffect } from 'react';
import {
  Tracer,
  createDefaultTracerConfig,
} from '../utils/observability/tracer';
import { InMemorySpanExporter } from '../utils/observability/spanExporter';
import { Span } from '../utils/observability/span';
import type { SpanData } from '../utils/observability/traceTypes';
import { PromQLBuilder, PromQLTemplates } from '../utils/observability/promql';
import { GrafanaDashboardBuilder, createApplicationMonitoringDashboard } from '../utils/observability/grafanaDashboard';
import {
  SLOCalculator,
  createAvailabilitySLI,
  createLatencySLI,
  createSLO,
} from '../utils/observability/slo';
import type { SLOReport } from '../utils/observability/slo';
import {
  ChaosMonkey,
  createNetworkLatencyExperiment,
  createExceptionInjectionExperiment,
  createCpuStressExperiment,
} from '../utils/observability/chaosMonkey';
import type { ChaosReport, ChaosEvent } from '../utils/observability/chaosMonkey';

interface McpObservabilityPanelProps {
  onClose: () => void;
}

type TabKey = 'tracing' | 'promql' | 'slo' | 'chaos' | 'docs';

// ====================================
// 主组件
// ====================================

export default function McpObservabilityPanel({ onClose }: McpObservabilityPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('tracing');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              🔭 MCP × 可观测性面板
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Cycle 53 G53-INTEGRATION | 分布式追踪 + 指标监控 + SLO/SLI + 混沌工程
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
          {[
            { key: 'tracing', label: '🔭 分布式追踪', icon: '1' },
            { key: 'promql', label: '📊 指标+仪表盘', icon: '2' },
            { key: 'slo', label: '🎯 SLO/SLI', icon: '3' },
            { key: 'chaos', label: '🐒 混沌工程', icon: '4' },
            { key: 'docs', label: '📖 集成文档', icon: '5' },
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
          {activeTab === 'tracing' && <TracingTab />}
          {activeTab === 'promql' && <PromQLTab />}
          {activeTab === 'slo' && <SLOTab />}
          {activeTab === 'chaos' && <ChaosTab />}
          {activeTab === 'docs' && <DocsTab />}
        </div>
      </div>
    </div>
  );
}

// ====================================
// Tab 1: 分布式追踪
// ====================================

function TracingTab() {
  const [spans, setSpans] = useState<SpanData[]>([]);
  const [progress, setProgress] = useState('');
  const [traceId, setTraceId] = useState<string>('');
  const exporterRef = useRef<InMemorySpanExporter | null>(null);
  const tracerRef = useRef<Tracer | null>(null);

  useEffect(() => {
    return () => {
      void exporterRef.current?.shutdown();
    };
  }, []);

  const handleRun = async () => {
    setProgress('初始化 Tracer...');
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(createDefaultTracerConfig('mcp-observability-demo'));
    exporterRef.current = exporter;
    tracerRef.current = tracer;

    await exporter.start();
    setProgress('创建追踪上下文...');

    // 模拟多 Span 工作流
    await tracer.withSpan('http.request', async (span) => {
      const rootId = span.getTraceId();
      setTraceId(rootId);
      span.setAttribute('http.method', 'GET');
      span.setAttribute('http.url', 'https://api.example.com/users');

      await tracer.withSpan('db.query', async (dbSpan) => {
        dbSpan.setAttribute('db.system', 'postgresql');
        dbSpan.setAttribute('db.statement', 'SELECT * FROM users');
        await new Promise((r) => setTimeout(r, 50));
      }, { kind: 'client' });

      await tracer.withSpan('cache.lookup', async (cacheSpan) => {
        cacheSpan.setAttribute('cache.system', 'redis');
        cacheSpan.setAttribute('cache.key', 'user:123');
        cacheSpan.addEvent('cache.hit');
      }, { kind: 'client' });

      await new Promise((r) => setTimeout(r, 50));
    });

    setProgress('刷新导出器...');
    const exportedSpans = exporter.getSpans();
    setSpans(exportedSpans);
    setProgress(`完成: 导出 ${exportedSpans.length} 个 Span`);
  };

  const handleClear = () => {
    setSpans([]);
    setProgress('');
    setTraceId('');
    exporterRef.current?.clear();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">🔭 分布式追踪</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> 基于 OpenTelemetry 规范的分布式追踪系统。支持 W3C Trace Context 标准、Span 生命周期管理、批量 Span 导出。
        模拟 HTTP 请求 → DB 查询 → 缓存查询 三个嵌套 Span。
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleRun}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded"
        >
          生成追踪
        </button>
        <button
          onClick={handleClear}
          className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white text-sm font-medium rounded"
        >
          清空
        </button>
      </div>

      {traceId && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <strong>Trace ID:</strong> <code className="text-xs">{traceId}</code>
        </div>
      )}

      {progress && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <strong>状态:</strong> {progress}
        </div>
      )}

      {spans.length > 0 && <SpanList spans={spans} />}
    </div>
  );
}

function SpanList({ spans }: { spans: SpanData[] }) {
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-sm">导出的 Spans ({spans.length})</h4>
      {spans.map((span, i) => (
        <div
          key={i}
          className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm font-mono"
        >
          <div className="flex justify-between">
            <span className="font-semibold text-blue-600 dark:text-blue-400">{span.name}</span>
            <span className="text-xs text-gray-500">
              {span.durationMs !== undefined ? `${span.durationMs}ms` : '-'}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            <span>SID: {span.spanId.substring(0, 8)}...</span>
            {span.parentSpanId && <span> | Parent: {span.parentSpanId.substring(0, 8)}...</span>}
            <span> | Status: {span.status.code}</span>
            <span> | Kind: {span.kind}</span>
          </div>
          {Object.keys(span.attributes).length > 0 && (
            <div className="text-xs mt-1 text-gray-600 dark:text-gray-400">
              Attrs: {Object.entries(span.attributes).map(([k, v]) => `${k}=${v}`).join(', ')}
            </div>
          )}
          {span.events.length > 0 && (
            <div className="text-xs mt-1 text-purple-600 dark:text-purple-400">
              Events: {span.events.map((e) => e.name).join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ====================================
// Tab 2: PromQL + Grafana
// ====================================

function PromQLTab() {
  const [service, setService] = useState('mcp-api');
  const [query, setQuery] = useState('');
  const [dashboardJson, setDashboardJson] = useState('');

  const handleQuery = (type: string) => {
    let q = '';
    switch (type) {
      case 'qps':
        q = PromQLTemplates.qps(service);
        break;
      case 'error':
        q = PromQLTemplates.httpErrorRate(service);
        break;
      case 'latency':
        q = PromQLTemplates.httpRequestRate(service);
        break;
      case 'availability':
        q = PromQLTemplates.availability(service);
        break;
      case 'cpu':
        q = PromQLTemplates.cpuUsage(service);
        break;
      case 'memory':
        q = PromQLTemplates.memoryUsage(service);
        break;
      case 'custom': {
        const builder = new PromQLBuilder();
        q = builder
          .metric('http_requests_total', { service, status: '200' })
          .fn('rate', '[5m]')
          .by('method', 'endpoint')
          .toString();
        break;
      }
    }
    setQuery(q);
  };

  const handleGenerateDashboard = () => {
    const builder = createApplicationMonitoringDashboard(service);
    setDashboardJson(builder.toString());
  };

  const queries: Array<{ key: string; label: string }> = [
    { key: 'qps', label: 'QPS' },
    { key: 'error', label: '错误率' },
    { key: 'latency', label: '请求率' },
    { key: 'availability', label: '可用性' },
    { key: 'cpu', label: 'CPU' },
    { key: 'memory', label: '内存' },
    { key: 'custom', label: '自定义' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">📊 PromQL + Grafana 仪表盘</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> 使用 PromQLBuilder 以编程方式构建 Prometheus 查询。GrafanaDashboardBuilder 生成可导入的 Grafana 仪表盘 JSON。
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">服务名称</label>
        <input
          type="text"
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">查询模板</label>
        <div className="flex flex-wrap gap-2">
          {queries.map((q) => (
            <button
              key={q.key}
              onClick={() => handleQuery(q.key)}
              className="px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-800/60 text-blue-800 dark:text-blue-200 rounded"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {query && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
          <div className="text-sm font-medium mb-1">生成的 PromQL:</div>
          <pre className="text-xs bg-gray-900 text-green-400 p-2 rounded overflow-x-auto">{query}</pre>
        </div>
      )}

      <div className="border-t pt-4">
        <button
          onClick={handleGenerateDashboard}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded"
        >
          生成 Grafana 仪表盘
        </button>
      </div>

      {dashboardJson && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
          <div className="text-sm font-medium mb-1">Grafana Dashboard JSON (前 800 字符):</div>
          <pre className="text-xs bg-gray-900 text-yellow-300 p-2 rounded overflow-x-auto max-h-60">
            {dashboardJson.substring(0, 800)}
            {dashboardJson.length > 800 ? '\n... (truncated)' : ''}
          </pre>
          <div className="text-xs text-gray-500 mt-1">总长度: {dashboardJson.length} 字符</div>
        </div>
      )}
    </div>
  );
}

// ====================================
// Tab 3: SLO/SLI
// ====================================

function SLOTab() {
  const [service, setService] = useState('mcp-api');
  const [target, setTarget] = useState(0.99);
  const [latencyThreshold, setLatencyThreshold] = useState(500);
  const [report, setReport] = useState<SLOReport | null>(null);
  const [progress, setProgress] = useState('');
  const calculatorRef = useRef<SLOCalculator | null>(null);

  const handleCompute = async () => {
    setProgress('初始化 SLOCalculator...');
    const calculator = new SLOCalculator();
    calculatorRef.current = calculator;

    // 注册 SLI
    const availSLI = createAvailabilitySLI(service);
    const latSLI = createLatencySLI(service, latencyThreshold);
    calculator.registerSLI(availSLI);
    calculator.registerSLI(latSLI);

    // 注册 SLO (使用 name 而非 id)
    const availSLOName = `${service}-availability-slo`;
    const latSLOName = `${service}-latency-slo`;
    const availSLO = createSLO({
      name: availSLOName,
      sliId: availSLI.id,
      target,
      enabled: true,
    });
    const latSLO = createSLO({
      name: latSLOName,
      sliId: latSLI.id,
      target: 0.95,
      enabled: true,
    });
    calculator.registerSLO(availSLO);
    calculator.registerSLO(latSLO);

    setProgress('生成模拟数据...');
    // 模拟数据点
    for (let i = 0; i < 100; i++) {
      const ts = Date.now() - (100 - i) * 1000;
      const goodAvail = Math.random() < target + 0.005;
      calculator.recordDataPoint(availSLI.id, goodAvail ? 1 : 0, 1, ts);
      const lat = Math.random() * latencyThreshold * 1.2;
      const goodLat = lat <= latencyThreshold;
      calculator.recordDataPoint(latSLI.id, goodLat ? 1 : 0, 1, ts);
    }

    setProgress('生成报告...');
    const r = calculator.generateReport(availSLOName);
    if (r) {
      setReport(r);
      setProgress(`完成: ${r.met ? '达标' : '未达标'}`);
    } else {
      setProgress('未生成报告');
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">🎯 SLO/SLI 计算器</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> SLO (Service Level Objective) 是服务质量目标，SLI (Service Level Indicator) 是服务质量指标。
        错误预算 = (1 - SLO) × 总事件数。模拟 100 个数据点计算可用性 SLO。
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">服务</label>
          <input
            type="text"
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">可用性目标</label>
          <input
            type="number"
            step="0.001"
            min="0"
            max="1"
            value={target}
            onChange={(e) => setTarget(parseFloat(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">P95 延迟阈值 (ms)</label>
          <input
            type="number"
            value={latencyThreshold}
            onChange={(e) => setLatencyThreshold(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
      </div>

      <button
        onClick={handleCompute}
        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded"
      >
        计算 SLO
      </button>

      {progress && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <strong>状态:</strong> {progress}
        </div>
      )}

      {report && <SLOReportView report={report} />}
    </div>
  );
}

function SLOReportView({ report }: { report: SLOReport }) {
  const budgetStatusColor: Record<string, string> = {
    healthy: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
    critical: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
    exhausted: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  };

  return (
    <div className="space-y-3">
      <div className={`p-3 rounded ${report.met ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
        <div className="font-semibold mb-1">
          {report.name} {report.met ? '✅ 达标' : '❌ 未达标'}
        </div>
        <div className="text-sm">SLI: {(report.sliValue * 100).toFixed(3)}% / 目标: {(report.target * 100).toFixed(1)}%</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="错误预算" value={report.errorBudget.remaining} sub={`/ ${report.errorBudget.total}`} />
        <Stat label="消耗率" value={`${(report.errorBudget.consumedRatio * 100).toFixed(1)}%`} />
        <Stat
          label="状态"
          value={report.errorBudget.status}
          className={budgetStatusColor[report.errorBudget.status] ?? ''}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
          <strong>燃烧率:</strong> {report.burnRate.toFixed(3)}
          <div className="text-xs text-gray-500 mt-1">等级: {report.burnRateAlert}</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
          <strong>趋势:</strong> {report.trend}
          <div className="text-xs text-gray-500 mt-1">窗口: {Math.round(report.window.durationMs / 1000)}s</div>
        </div>
      </div>
    </div>
  );
}

// ====================================
// Tab 4: 混沌工程
// ====================================

function ChaosTab() {
  const [target, setTarget] = useState('mcp-api');
  const [intensity, setIntensity] = useState(0.5);
  const [duration, setDuration] = useState(500);
  const [report, setReport] = useState<ChaosReport | null>(null);
  const [progress, setProgress] = useState('');
  const [events, setEvents] = useState<ChaosEvent[]>([]);
  const monkeyRef = useRef<ChaosMonkey | null>(null);

  useEffect(() => {
    return () => {
      monkeyRef.current?.reset();
    };
  }, []);

  const runExp = async (type: 'latency' | 'exception' | 'cpu') => {
    setProgress('初始化 Chaos Monkey...');
    setReport(null);
    setEvents([]);
    const monkey = new ChaosMonkey();
    monkeyRef.current = monkey;
    monkey.subscribe((e) => {
      setEvents((prev) => [...prev, e].slice(-20));
    });

    let experiment;
    switch (type) {
      case 'latency':
        experiment = createNetworkLatencyExperiment(target, {
          delayMs: Math.floor(intensity * 1000),
          durationMs: duration,
          intensity,
        });
        break;
      case 'exception':
        experiment = createExceptionInjectionExperiment(target, {
          message: 'Chaos: 测试异常',
          durationMs: duration,
          intensity,
        });
        break;
      case 'cpu':
        experiment = createCpuStressExperiment(target, {
          durationMs: duration,
          intensity,
        });
        break;
    }

    experiment.preValidation = async () => true;
    experiment.postValidation = async () => true;
    experiment.recoveryTimeoutMs = 1000;

    setProgress(`运行实验: ${experiment.name}...`);
    const result = await monkey.runExperiment(experiment);
    setReport(result);
    setProgress(`完成: ${result.summary}`);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">🐒 Chaos Monkey 故障注入</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> 模拟各种故障场景验证系统韧性。支持 7 种故障类型 (网络延迟/丢包/异常注入/内存/CPU/超时/限流)。
        自动评估恢复时间和韧性评分。
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">目标服务</label>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">强度 (0-1)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={intensity}
            onChange={(e) => setIntensity(parseFloat(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">持续时间 (ms)</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => runExp('latency')}
          className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded"
        >
          🐢 网络延迟
        </button>
        <button
          onClick={() => runExp('exception')}
          className="px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded"
        >
          💥 异常注入
        </button>
        <button
          onClick={() => runExp('cpu')}
          className="px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded"
        >
          🔥 CPU 压力
        </button>
      </div>

      {progress && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <strong>状态:</strong> {progress}
        </div>
      )}

      {report && <ChaosReportView report={report} />}

      {events.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-xs">
          <strong>事件流 (最近 {events.length}):</strong>
          <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
            {events.map((e, i) => (
              <div key={i} className="font-mono text-gray-600 dark:text-gray-400">
                [{new Date(e.timestamp).toISOString().substring(11, 19)}] {e.type}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChaosReportView({ report }: { report: ChaosReport }) {
  return (
    <div className="space-y-3">
      <div className={`p-3 rounded ${report.success ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
        <div className="font-semibold mb-1">{report.summary}</div>
        <div className="text-sm">
          韧性评分: <strong>{(report.resilienceScore * 100).toFixed(1)}</strong> / 100
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="故障类型" value={report.faultInjected.type} />
        <Stat label="恢复时间" value={`${report.recoveryTimeMs}ms`} />
        <Stat label="错误数" value={report.errorsObserved.length} />
      </div>

      {report.recommendations.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded text-sm">
          <h4 className="font-medium mb-2">建议</h4>
          <ul className="list-disc list-inside space-y-1 text-xs">
            {report.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ====================================
// Tab 5: 集成文档
// ====================================

function DocsTab() {
  return (
    <div className="space-y-4 prose dark:prose-invert max-w-none text-sm">
      <h3 className="text-lg font-semibold">📖 Cycle 53 集成文档</h3>

      <section className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
        <h4 className="font-semibold mb-2">🔭 1. 分布式追踪 (G53-01)</h4>
        <p className="text-gray-700 dark:text-gray-300">
          基于 OpenTelemetry 规范的分布式追踪系统。核心组件:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 text-xs space-y-1 mt-2">
          <li><code>Tracer</code> - 追踪器主类，管理 Span 生命周期、采样决策、批量导出</li>
          <li><code>Span</code> / <code>NonRecordingSpan</code> - 追踪基本单元</li>
          <li><code>traceContext</code> - W3C Trace Context 标准的 traceparent/tracestate 解析与生成</li>
          <li><code>BatchSpanProcessor</code> - 批量 Span 处理器，支持背压</li>
          <li><code>InMemorySpanExporter</code> / <code>ConsoleSpanExporter</code> - Span 导出器</li>
          <li><code>AlwaysOnSampler</code> / <code>AlwaysOffSampler</code> / <code>TraceIdRatioBasedSampler</code> / <code>ParentBasedSampler</code> - 采样器</li>
        </ul>
      </section>

      <section className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
        <h4 className="font-semibold mb-2">📊 2. 指标 + 仪表盘 (G53-02)</h4>
        <p className="text-gray-700 dark:text-gray-300">
          PromQL 查询构建器和 Grafana 仪表盘生成器:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 text-xs space-y-1 mt-2">
          <li><code>PromQLBuilder</code> - 流式 API 构建 PromQL 查询 (metric, fn, op, by, without, on)</li>
          <li><code>PromQLTemplates</code> - 预置模板 (qps, httpErrorRate, cpuUsage, memoryUsage, availability)</li>
          <li><code>GrafanaDashboardBuilder</code> - 生成可导入的 Grafana Dashboard JSON</li>
          <li><code>createDefaultObservabilityDashboard()</code> - 一键生成完整可观测性仪表盘</li>
          <li>支持面板: timeseries, stat, gauge, table, bar, piechart, heatmap</li>
          <li>支持变量: query, interval, datasource, custom</li>
        </ul>
      </section>

      <section className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
        <h4 className="font-semibold mb-2">🎯 3. SLO/SLI (G53-03)</h4>
        <p className="text-gray-700 dark:text-gray-300">
          服务质量目标计算器和错误预算跟踪:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 text-xs space-y-1 mt-2">
          <li><code>SLOCalculator</code> - 核心计算器，支持 SLI/SLO 注册、事件记录、报告生成</li>
          <li><code>createAvailabilitySLI</code> / <code>createLatencySLI</code> - SLI 工厂函数</li>
          <li><code>createSLO</code> - SLO 工厂函数</li>
          <li>SLI 类型: availability, latency, throughput, correctness, freshness, custom</li>
          <li>错误预算状态: healthy, warning, critical, exhausted</li>
          <li>燃烧率等级: ok, low, medium, high, critical</li>
          <li>趋势分析: improving, stable, degrading</li>
        </ul>
      </section>

      <section className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
        <h4 className="font-semibold mb-2">🐒 4. Chaos Monkey (G53-04)</h4>
        <p className="text-gray-700 dark:text-gray-300">
          故障注入测试套件:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 text-xs space-y-1 mt-2">
          <li><code>ChaosMonkey</code> - 主类，支持实验编排、错误记录、报告生成</li>
          <li><code>NetworkLatencyInjector</code> - 网络延迟注入 (拦截 fetch)</li>
          <li><code>NetworkPacketLossInjector</code> - 网络丢包注入</li>
          <li><code>ExceptionInjector</code> - 异常注入 (按函数名)</li>
          <li><code>MemoryPressureInjector</code> - 内存压力注入</li>
          <li><code>CpuStressInjector</code> - CPU 压力注入</li>
          <li><code>TimeoutInjector</code> - 超时注入</li>
          <li><code>RateLimitingInjector</code> - 限流注入</li>
          <li>韧性评分: 综合恢复状态、错误数、恢复时间</li>
        </ul>
      </section>

      <section className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
        <h4 className="font-semibold mb-2">🔗 与 Cycle 52 集成</h4>
        <p className="text-gray-700 dark:text-gray-300">
          Cycle 53 的可观测性组件与 Cycle 52 的生产化增强组件深度集成:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 text-xs space-y-1 mt-2">
          <li>🛡️ 灾备恢复 → 通过 SLO/SLI 验证恢复后是否达标</li>
          <li>📈 自动扩缩容 → 通过 PromQL 监控实时触发扩缩</li>
          <li>🚀 灰度发布 → 通过 Chaos Monkey 验证新版本韧性</li>
          <li>🌐 多区域 → 通过分布式追踪追踪跨区域请求</li>
        </ul>
      </section>
    </div>
  );
}

// ====================================
// 通用组件
// ====================================

function Stat({ label, value, sub, className }: { label: string; value: string | number; sub?: string; className?: string }) {
  return (
    <div className={`p-2 bg-gray-50 dark:bg-gray-800 rounded ${className ?? ''}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
