/**
 * # ============================================================
 * # 部署验证面板 (Cycle 51 G51-INTEGRATION)
 * # ============================================================
 * # 核心作用：提供 UI 界面执行 Docker 健康检查 + E2E 流程验证
 * #           + 监控栈验证 + 性能压测的一站式面板
 * # Tab 内容：
 * #   1. 健康检查 - Docker Compose 完整服务栈健康状态
 * #   2. E2E 流程 - 前端 → API → DB → 火山方舟 完整调用链
 * #   3. 监控验证 - Prometheus + Grafana 接入
 * #   4. 性能压测 - QPS/P95/错误率 实时报告
 * #   5. 部署文档 - Docker / Nginx / 故障排查
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 51 G51-INTEGRATION 初次创建
 * # ====================================
 */

import { useState, useEffect, useRef } from 'react';
import {
  HealthChecker,
  createDefaultStackConfig,
  exportHealthReportMarkdown,
  type HealthCheckReport,
} from '../utils/healthChecker';
import {
  E2EFlowValidator,
  createSmokeTestFlow,
  createFullStackFlow,
  exportE2EFlowReportMarkdown,
  type E2EFlowReport,
} from '../utils/e2eFlowValidator';
import {
  MonitoringStackValidator,
  exportMonitoringReportMarkdown,
  type MonitoringReport,
} from '../utils/monitoringStackValidator';
import {
  LoadTester,
  exportPerfReportMarkdown,
  type PerfReport,
  type LoadTestProgress,
} from '../utils/loadTester';

// ============ Props ============

export interface McpDeploymentValidationPanelProps {
  onClose: () => void;
}

// ============ Tab Key ============

type TabKey = 'health' | 'e2e' | 'monitoring' | 'perf' | 'docs';

// ============ 组件 ============

export default function McpDeploymentValidationPanel({ onClose }: McpDeploymentValidationPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('health');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              🚀 MCP × 部署验证面板
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Cycle 51 G51-INTEGRATION | 健康检查 + E2E 流程 + 监控验证 + 性能压测
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
            { key: 'health', label: '🏥 健康检查', icon: '1' },
            { key: 'e2e', label: '🧪 E2E 流程', icon: '2' },
            { key: 'monitoring', label: '📊 监控验证', icon: '3' },
            { key: 'perf', label: '⚡ 性能压测', icon: '4' },
            { key: 'docs', label: '📚 部署文档', icon: '5' },
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
          {activeTab === 'health' && <HealthTab />}
          {activeTab === 'e2e' && <E2ETab />}
          {activeTab === 'monitoring' && <MonitoringTab />}
          {activeTab === 'perf' && <PerfTab />}
          {activeTab === 'docs' && <DocsTab />}
        </div>
      </div>
    </div>
  );
}

// ============ Tab 1: 健康检查 ============

function HealthTab() {
  const [baseHost, setBaseHost] = useState('localhost');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<HealthCheckReport | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const checkerRef = useRef<HealthChecker | null>(null);

  const handleCheck = async () => {
    setRunning(true);
    setEvents([]);
    const checker = new HealthChecker({
      services: createDefaultStackConfig(baseHost),
    });
    checkerRef.current = checker;
    checker.subscribe((e) => {
      if (e.type === 'service-pass') setEvents((prev) => [`✅ ${e.service} (尝试 ${e.attempt})`, ...prev].slice(0, 20));
      if (e.type === 'service-fail') setEvents((prev) => [`❌ ${e.service}: ${e.error ?? '失败'}`, ...prev].slice(0, 20));
    });
    try {
      const r = await checker.checkAll();
      setReport(r);
    } catch (err) {
      setEvents((prev) => [`Error: ${err instanceof Error ? err.message : String(err)}`, ...prev]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">Docker Compose 健康检查</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          验证完整生产堆栈 5 个服务: frontend / backend / postgres / prometheus / grafana
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={baseHost}
            onChange={(e) => setBaseHost(e.target.value)}
            placeholder="Base host (default: localhost)"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
          <button
            onClick={handleCheck}
            disabled={running}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {running ? '检查中...' : '开始健康检查'}
          </button>
        </div>
      </div>

      {report && <HealthReportView report={report} />}

      {events.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded">
          <h4 className="text-sm font-semibold mb-2">事件流</h4>
          <div className="space-y-1 text-xs font-mono">
            {events.map((e, i) => (
              <div key={i} className="text-gray-700 dark:text-gray-300">{e}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthReportView({ report }: { report: HealthCheckReport }) {
  const statusColor = report.overallPassed ? 'text-green-600' : 'text-red-600';
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">健康检查报告</h3>
        <span className={`text-sm font-bold ${statusColor}`}>{report.overallPassed ? '✅ HEALTHY' : '❌ UNHEALTHY'}</span>
      </div>
      <div className="grid grid-cols-4 gap-3 text-center mb-4">
        <Stat label="总服务" value={report.totalServices} />
        <Stat label="通过" value={report.passedServices} color="text-green-600" />
        <Stat label="失败" value={report.failedServices} color="text-red-600" />
        <Stat label="关键失败" value={report.criticalFailures} color="text-orange-600" />
      </div>
      <div className="space-y-2">
        {report.services.map((s) => (
          <div key={s.name} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded">
            <div className="flex items-center gap-2">
              <span>{s.passed ? '✅' : '❌'}</span>
              <span className="font-medium text-sm">{s.name}</span>
              <span className="text-xs text-gray-500">({s.type})</span>
              {s.required && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">关键</span>}
            </div>
            <span className="text-xs text-gray-500">{s.durationMs}ms</span>
          </div>
        ))}
      </div>
      {report.recommendations.length > 0 && (
        <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded">
          <h4 className="text-sm font-semibold mb-1">修复建议</h4>
          <ul className="text-xs space-y-0.5 text-gray-700 dark:text-gray-300">
            {report.recommendations.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = '' }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

// ============ Tab 2: E2E 流程 ============

function E2ETab() {
  const [flowType, setFlowType] = useState<'smoke' | 'full'>('smoke');
  const [frontendUrl, setFrontendUrl] = useState('http://localhost:8080');
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<E2EFlowReport | null>(null);

  const handleRun = async () => {
    setRunning(true);
    try {
      const validator = new E2EFlowValidator();
      const flow = flowType === 'smoke'
        ? createSmokeTestFlow(frontendUrl, backendUrl)
        : createFullStackFlow(frontendUrl, backendUrl);
      const r = await validator.runFlow(flow);
      setReport(r);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">E2E 流程验证</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          端到端验证完整调用链: 前端 → API → DB → 火山方舟
        </p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            type="text"
            value={frontendUrl}
            onChange={(e) => setFrontendUrl(e.target.value)}
            placeholder="前端 URL"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="后端 URL"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setFlowType('smoke')}
            className={`px-3 py-1.5 text-sm rounded ${flowType === 'smoke' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            快速冒烟 (2 步)
          </button>
          <button
            onClick={() => setFlowType('full')}
            className={`px-3 py-1.5 text-sm rounded ${flowType === 'full' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            完整流程 (11 步)
          </button>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {running ? '运行中...' : '运行 E2E 流程'}
        </button>
      </div>

      {report && <E2EReportView report={report} />}
    </div>
  );
}

function E2EReportView({ report }: { report: E2EFlowReport }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{report.flowName}</h3>
        <span className={`text-sm font-bold ${report.overallPassed ? 'text-green-600' : 'text-red-600'}`}>
          {report.overallPassed ? '✅ PASSED' : '❌ FAILED'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 text-center mb-4">
        <Stat label="总步骤" value={report.totalSteps} />
        <Stat label="通过" value={report.passedSteps} color="text-green-600" />
        <Stat label="失败" value={report.failedSteps} color="text-red-600" />
        <Stat label="跳过" value={report.skippedSteps} color="text-gray-500" />
      </div>
      <div className="space-y-1">
        {report.steps.map((s) => (
          <div key={s.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded text-sm">
            <div className="flex items-center gap-2">
              <span>{s.passed ? (s.durationMs === 0 ? '⏭️' : '✅') : '❌'}</span>
              <span className="font-mono text-xs">{s.id}</span>
              <span className="text-gray-600 dark:text-gray-400">{s.description}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {s.statusCode !== undefined && <span className="font-mono">HTTP {s.statusCode}</span>}
              <span className="text-gray-500">{s.durationMs}ms</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ Tab 3: 监控验证 ============

function MonitoringTab() {
  const [prometheusUrl, setPrometheusUrl] = useState('http://localhost:9090');
  const [grafanaUrl, setGrafanaUrl] = useState('http://localhost:3000');
  const [expectedMetrics, setExpectedMetrics] = useState('http_requests_total,up');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<MonitoringReport | null>(null);

  const handleValidate = async () => {
    setRunning(true);
    try {
      const validator = new MonitoringStackValidator({
        prometheusUrl,
        grafanaUrl: grafanaUrl || undefined,
        expectedMetrics: expectedMetrics.split(',').map((s) => s.trim()).filter(Boolean),
      });
      const r = await validator.validate();
      setReport(r);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">Prometheus + Grafana 验证</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          验证 scrape 目标 + 期望指标 + Grafana 数据源
        </p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            type="text"
            value={prometheusUrl}
            onChange={(e) => setPrometheusUrl(e.target.value)}
            placeholder="Prometheus URL"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
          <input
            type="text"
            value={grafanaUrl}
            onChange={(e) => setGrafanaUrl(e.target.value)}
            placeholder="Grafana URL (可选)"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <input
          type="text"
          value={expectedMetrics}
          onChange={(e) => setExpectedMetrics(e.target.value)}
          placeholder="期望指标 (逗号分隔)"
          className="w-full px-3 py-2 mb-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
        />
        <button
          onClick={handleValidate}
          disabled={running}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {running ? '验证中...' : '验证监控栈'}
        </button>
      </div>

      {report && <MonitoringReportView report={report} />}
    </div>
  );
}

function MonitoringReportView({ report }: { report: MonitoringReport }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">监控栈报告</h3>
        <span className={`text-sm font-bold ${report.overallPassed ? 'text-green-600' : 'text-red-600'}`}>
          {report.overallPassed ? '✅ MONITORING OK' : '❌ MONITORING ISSUES'}
        </span>
      </div>
      <div className="space-y-3">
        <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded">
          <h4 className="text-sm font-semibold mb-2">Prometheus {report.prometheus.available ? '✅' : '❌'}</h4>
          {report.prometheus.available ? (
            <div className="text-xs space-y-1">
              <div>版本: {report.prometheus.version ?? 'unknown'}</div>
              <div>Scrape 目标: {report.prometheus.activeTargets}/{report.prometheus.totalTargets} up</div>
              {report.prometheus.targets.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {report.prometheus.targets.map((t, i) => (
                    <div key={i} className="font-mono">
                      {t.health === 'up' ? '✓' : '✗'} {t.job} ({t.instance}) - {t.health}
                    </div>
                  ))}
                </div>
              )}
              {report.prometheus.expectedMetrics.length > 0 && (
                <div className="mt-2">
                  <div className="font-semibold mb-1">期望指标:</div>
                  {report.prometheus.expectedMetrics.map((m, i) => (
                    <div key={i} className="font-mono">
                      {m.found ? '✓' : '✗'} {m.name}{m.type ? ` (${m.type})` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-red-600">错误: {report.prometheus.error}</div>
          )}
        </div>
        {report.grafana.error !== 'Grafana URL not configured' && (
          <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded">
            <h4 className="text-sm font-semibold mb-2">Grafana {report.grafana.available ? '✅' : '❌'}</h4>
            {report.grafana.available ? (
              <div className="text-xs">
                <div>数据源: {report.grafana.dataSources.length}</div>
                <div>Prometheus 数据源: {report.grafana.prometheusDatasourceFound ? '✅' : '❌'}</div>
              </div>
            ) : (
              <div className="text-xs text-red-600">错误: {report.grafana.error}</div>
            )}
          </div>
        )}
      </div>
      {report.recommendations.length > 0 && (
        <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded">
          <h4 className="text-sm font-semibold mb-1">修复建议</h4>
          <ul className="text-xs space-y-0.5 text-gray-700 dark:text-gray-300">
            {report.recommendations.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============ Tab 4: 性能压测 ============

function PerfTab() {
  const [url, setUrl] = useState('http://localhost:8080/healthz');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [connections, setConnections] = useState(10);
  const [duration, setDuration] = useState(5); // 秒
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<PerfReport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setReport(null);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    const tester = new LoadTester();
    try {
      const r = await tester.run({
        url,
        method,
        connections,
        durationMs: duration * 1000,
        signal: controller.signal,
        onProgress: (p) => setProgress(p.percent),
      });
      setReport(r);
    } catch (err) {
      console.error(err);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">性能压测</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          并发请求 + QPS/P95/错误率 实时统计
        </p>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="目标 URL"
            className="col-span-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          >
            <option>GET</option>
            <option>POST</option>
          </select>
          <input
            type="number"
            value={connections}
            onChange={(e) => setConnections(parseInt(e.target.value) || 1)}
            placeholder="并发"
            min="1"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <div className="flex gap-2 items-center mb-2">
          <label className="text-sm">持续时间 (秒):</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
            min="1"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        {running ? (
          <>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <button
              onClick={handleStop}
              className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded"
            >
              停止压测
            </button>
          </>
        ) : (
          <button
            onClick={handleRun}
            className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded"
          >
            开始压测
          </button>
        )}
      </div>

      {report && <PerfReportView report={report} />}
    </div>
  );
}

function PerfReportView({ report }: { report: PerfReport }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">压测报告</h3>
        <span className={`text-sm font-bold ${report.passed ? 'text-green-600' : 'text-red-600'}`}>
          {report.passed ? '✅ PASSED' : '❌ FAILED'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <Stat label="QPS" value={Math.round(report.qps * 10) / 10} />
        <Stat label="P95 (ms)" value={Math.round(report.p95LatencyMs * 10) / 10} />
        <Stat label="错误率" value={Math.round(report.errorRate * 10000) / 100} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded">
          <div className="text-xs text-gray-500">总请求</div>
          <div className="font-bold">{report.totalRequests}</div>
        </div>
        <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded">
          <div className="text-xs text-gray-500">成功 / 失败</div>
          <div className="font-bold">{report.successfulRequests} / {report.failedRequests}</div>
        </div>
        <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded">
          <div className="text-xs text-gray-500">P50 (ms)</div>
          <div className="font-bold">{report.p50LatencyMs.toFixed(1)}</div>
        </div>
        <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded">
          <div className="text-xs text-gray-500">P99 (ms)</div>
          <div className="font-bold">{report.p99LatencyMs.toFixed(1)}</div>
        </div>
      </div>
      {Object.keys(report.statusCodeDistribution).length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-semibold mb-1">状态码分布</h4>
          <div className="text-xs space-y-0.5">
            {Object.entries(report.statusCodeDistribution).map(([code, count]) => (
              <div key={code}>HTTP {code}: {count}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Tab 5: 部署文档 ============

function DocsTab() {
  return (
    <div className="space-y-4 text-sm">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">一键部署 (Docker Compose)</h3>
        <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
{`# 1. 配置环境变量
cp .env.example .env
# 编辑 .env, 设置 VOLCENGINE_API_KEY 等

# 2. 启动核心服务
docker compose -f docker-compose.production.yml up -d

# 3. 启动监控 (可选)
docker compose -f docker-compose.production.yml --profile monitoring up -d

# 4. 检查状态
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f
`}
        </pre>
      </div>

      <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">端点检查清单</h3>
        <ul className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
          <li>✓ <code>http://localhost:8080/healthz</code> - 前端健康</li>
          <li>✓ <code>http://localhost:8000/health</code> - 后端健康</li>
          <li>✓ <code>http://localhost:8000/api/v1/rag/search</code> - RAG 搜索</li>
          <li>✓ <code>http://localhost:8000/api/v1/multimodal/embed</code> - 多模态</li>
          <li>✓ <code>http://localhost:8000/api/v1/volcengine/embed</code> - 火山方舟</li>
          <li>✓ <code>http://localhost:9090/-/healthy</code> - Prometheus 健康</li>
          <li>✓ <code>http://localhost:3000/api/health</code> - Grafana 健康</li>
        </ul>
      </div>

      <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">故障排查</h3>
        <ul className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
          <li>• 端口冲突: <code>netstat -tlnp | grep -E '8080|8000|9090|3000'</code></li>
          <li>• 容器日志: <code>docker logs -f &lt;container&gt;</code></li>
          <li>• 数据库: <code>docker exec -it postgres pg_isready -U postgres</code></li>
          <li>• 磁盘空间: <code>docker system df</code></li>
          <li>• 重启服务: <code>docker compose restart &lt;service&gt;</code></li>
          <li>• 清理: <code>docker system prune -a</code></li>
        </ul>
      </div>

      <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded">
        <h3 className="font-semibold mb-2">安全检查清单</h3>
        <ul className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
          <li>✓ API Key 通过 ApiKeyManager 加密存储 (Web Crypto AES-GCM)</li>
          <li>✓ 限流保护 60 RPS / 每月 1M tokens</li>
          <li>✓ CSP / HSTS / X-Frame-Options</li>
          <li>✓ 审计日志 (create/get/rotate/delete/expire/error)</li>
          <li>✓ 健康检查 / 启动顺序 / 自动重启</li>
          <li>✓ HTTPS 强制 (生产环境)</li>
        </ul>
      </div>
    </div>
  );
}
