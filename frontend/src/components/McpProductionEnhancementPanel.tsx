/**
 * # ============================================================
 * # MCP × 生产化增强面板 (Cycle 52 G52-INTEGRATION)
 * # ============================================================
 * # 核心作用：集成 4 大生产化能力的主应用面板
 * # 5-Tab UI:
 * #   - Tab 1 (🚀 灰度发布): CanaryDeployment - 渐进式发布 + 自动回滚
 * #   - Tab 2 (🌐 多区域): MultiRegionRouter - 5 种路由策略
 * #   - Tab 3 (📈 自动扩缩容): AutoScaler - 基于指标弹性伸缩
 * #   - Tab 4 (🛡️ 灾备恢复): DisasterRecovery - 备份 + 故障切换
 * #   - Tab 5 (📖 集成文档): 4 引擎使用指南
 * # 输入参数：onClose 回调
 * # 输出结果：完整 UI 面板
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-INTEGRATION 初次创建
 * # ====================================
 */

import { useState, useRef } from 'react';
import { CanaryDeployment, createCanaryStrategy } from '../utils/canaryDeployment';
import type { CanaryReport, CanaryStrategy } from '../utils/canaryDeployment';
import { MultiRegionRouter, createDefaultRegions, createDefaultRoutingStrategy } from '../utils/multiRegionRouter';
import type { RoutingReport, RoutingRequest } from '../utils/multiRegionRouter';
import { AutoScaler, createDefaultScalingConfig } from '../utils/autoScaler';
import type { ScalingReport } from '../utils/autoScaler';
import { DisasterRecovery, createDefaultDRConfig } from '../utils/disasterRecovery';
import type { DRReport } from '../utils/disasterRecovery';

interface McpProductionEnhancementPanelProps {
  onClose: () => void;
}

type TabKey = 'canary' | 'region' | 'scaler' | 'dr' | 'docs';

// ============================================================
// 主组件
// ============================================================

export default function McpProductionEnhancementPanel({ onClose }: McpProductionEnhancementPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('canary');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              🚀 MCP × 生产化增强面板
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Cycle 52 G52-INTEGRATION | 灰度发布 + 多区域 + 自动扩缩容 + 灾备恢复
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
            { key: 'canary', label: '🚀 灰度发布', icon: '1' },
            { key: 'region', label: '🌐 多区域', icon: '2' },
            { key: 'scaler', label: '📈 自动扩缩容', icon: '3' },
            { key: 'dr', label: '🛡️ 灾备恢复', icon: '4' },
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
          {activeTab === 'canary' && <CanaryTab />}
          {activeTab === 'region' && <RegionTab />}
          {activeTab === 'scaler' && <ScalerTab />}
          {activeTab === 'dr' && <DRTab />}
          {activeTab === 'docs' && <DocsTab />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 1: 灰度发布
// ============================================================

function CanaryTab() {
  const [strategyName, setStrategyName] = useState('my-service');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<CanaryReport | null>(null);
  const [progress, setProgress] = useState<string>('');
  const deploymentRef = useRef<CanaryDeployment | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setReport(null);
    setProgress('初始化灰度策略...');

    const strategy: CanaryStrategy = createCanaryStrategy(
      strategyName,
      [
        { name: '1% Smoke Test', trafficPercent: 1, durationMs: 2000, minHealthScore: 0.7 },
        { name: '25% Canary', trafficPercent: 25, durationMs: 3000, minHealthScore: 0.7 },
        { name: '100% Full Rollout', trafficPercent: 100, durationMs: 2000, minHealthScore: 0.6 },
      ],
      { maxErrorRate: 0.05, maxP95LatencyMs: 500, minQps: 50, maxCpuUsage: 0.8 },
      { sampleIntervalMs: 200, autoRollback: true }
    );

    const deployment = new CanaryDeployment(strategy);
    deploymentRef.current = deployment;

    deployment.subscribe((event) => {
      if (event.type === 'stage-start') {
        setProgress(`阶段 ${event.stageIndex + 1}: ${event.stage.name} (${event.stage.trafficPercent}% 流量)`);
      } else if (event.type === 'stage-rollback') {
        setProgress(`⚠️ 回滚: ${event.reason}`);
      } else if (event.type === 'stage-promote') {
        setProgress(`✅ 推进到阶段 ${event.toStage + 1}`);
      }
    });

    const result = await deployment.execute();
    setReport(result);
    setProgress(`完成: ${result.summary}`);
    setRunning(false);
  };

  const handleStop = () => {
    deploymentRef.current?.abort();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">🚀 灰度发布控制</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> 渐进式流量切换 + 健康度评估 + 自动回滚。模拟 1% → 25% → 100% 三阶段发布。
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">服务名称</label>
          <input
            type="text"
            value={strategyName}
            onChange={(e) => setStrategyName(e.target.value)}
            disabled={running}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        {running ? (
          <button
            onClick={handleStop}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded"
          >
            停止
          </button>
        ) : (
          <button
            onClick={handleRun}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded"
          >
            启动灰度
          </button>
        )}
      </div>

      {progress && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <strong>状态:</strong> {progress}
        </div>
      )}

      {report && <CanaryReportView report={report} />}
    </div>
  );
}

function CanaryReportView({ report }: { report: CanaryReport }) {
  return (
    <div className="space-y-3">
      <div className={`p-3 rounded ${report.status === 'completed' ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
        <div className="font-semibold mb-1">{report.summary}</div>
        {report.rollbackReason && (
          <div className="text-sm text-red-700 dark:text-red-300">原因: {report.rollbackReason}</div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="最终流量" value={`${report.currentTrafficPercent}%`} />
        <Stat label="耗时 (ms)" value={report.durationMs} />
        <Stat label="阶段数" value={report.stages.length} />
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-sm">阶段结果</h4>
        {report.stages.map((stage, i) => (
          <div
            key={i}
            className={`p-2 rounded text-sm ${
              stage.passed ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'
            }`}
          >
            <div className="flex justify-between">
              <span className="font-medium">{stage.name}</span>
              <span>{stage.trafficPercent}% 流量</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              耗时: {stage.durationMs}ms | 健康度: {stage.avgHealthScore.toFixed(2)} | 状态:{' '}
              {stage.passed ? '✅ 通过' : '❌ 失败'}
            </div>
          </div>
        ))}
      </div>

      {report.finalMetrics && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <h4 className="font-medium mb-2">最终指标</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>CPU: {(report.finalMetrics.cpuUsage * 100).toFixed(1)}%</div>
            <div>内存: -</div>
            <div>QPS: {report.finalMetrics.qps.toFixed(0)}</div>
            <div>P95: {report.finalMetrics.p95LatencyMs.toFixed(0)}ms</div>
            <div>错误率: {(report.finalMetrics.errorRate * 100).toFixed(2)}%</div>
            <div>健康度: {report.finalMetrics.healthScore.toFixed(2)}</div>
          </div>
        </div>
      )}

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

// ============================================================
// Tab 2: 多区域
// ============================================================

function RegionTab() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RoutingReport | null>(null);
  const routerRef = useRef<MultiRegionRouter | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setReport(null);

    const router = new MultiRegionRouter(createDefaultRoutingStrategy('geo'));
    createDefaultRegions().forEach((r) => router.addRegion(r));
    routerRef.current = router;

    const requests: RoutingRequest[] = Array.from({ length: 10 }, (_, i) => ({
      id: `req-${i}`,
      clientLocation: { code: 'client', name: 'Client', latitude: 39 + Math.random() * 2, longitude: 116 + Math.random() * 2 },
      path: '/api/data',
      method: 'GET',
    }));

    const result = await router.routeBatch(requests);
    setReport(result);
    setRunning(false);
  };

  const handleStop = () => {
    routerRef.current?.abort();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">🌐 多区域路由</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> 默认 3 区域 (北京/上海/Virginia) + 5 路由策略 (latency/round-robin/weighted/geo/failover)。
        模拟 10 个请求的批量路由。
      </div>

      {running ? (
        <button
          onClick={handleStop}
          className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded"
        >
          停止
        </button>
      ) : (
        <button
          onClick={handleRun}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded"
        >
          启动路由测试
        </button>
      )}

      {report && <RegionReportView report={report} />}
    </div>
  );
}

function RegionReportView({ report }: { report: RoutingReport }) {
  return (
    <div className="space-y-3">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
        <div className="font-semibold">{report.summary}</div>
        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          策略: {report.strategyType} | 耗时: {report.durationMs}ms
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="总请求" value={report.totalRequests} />
        <Stat label="成功率" value={`${((report.successfulRequests / report.totalRequests) * 100).toFixed(1)}%`} />
        <Stat label="P95 (ms)" value={report.overallP95LatencyMs.toFixed(0)} />
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-sm">区域分布</h4>
        {Object.entries(report.regionDistribution).map(([regionId, count]) => (
          <div key={regionId} className="flex justify-between bg-gray-50 dark:bg-gray-800 p-2 rounded text-sm">
            <span>{regionId}</span>
            <span>{count} 请求</span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-sm">区域统计</h4>
        {report.regionStats.map((s) => (
          <div key={s.regionId} className="bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs">
            <div className="font-medium">{s.regionId}</div>
            <div className="grid grid-cols-2 gap-1 mt-1">
              <div>总: {s.totalRequests}</div>
              <div>成功: {s.successfulRequests}</div>
              <div>失败: {s.failedRequests}</div>
              <div>错误率: {(s.errorRate * 100).toFixed(1)}%</div>
              <div>平均: {s.avgLatencyMs.toFixed(0)}ms</div>
              <div>P95: {s.p95LatencyMs.toFixed(0)}ms</div>
            </div>
          </div>
        ))}
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

// ============================================================
// Tab 3: 自动扩缩容
// ============================================================

function ScalerTab() {
  const [serviceName, setServiceName] = useState('web-service');
  const [duration, setDuration] = useState(3);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ScalingReport | null>(null);
  const [progress, setProgress] = useState<string>('');
  const scalerRef = useRef<AutoScaler | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setReport(null);
    setProgress('初始化自动扩缩容...');

    const scaler = new AutoScaler(
      createDefaultScalingConfig(serviceName, {
        minInstances: 1,
        maxInstances: 5,
        initialInstances: 2,
        sampleIntervalMs: 100,
        cooldownMs: 200,
        stepSize: 1,
      })
    );
    scalerRef.current = scaler;

    scaler.subscribe((event) => {
      if (event.type === 'scale-up') {
        setProgress(`↑ 扩容: ${event.action.fromInstances} → ${event.action.toInstances}`);
      } else if (event.type === 'scale-down') {
        setProgress(`↓ 缩容: ${event.action.fromInstances} → ${event.action.toInstances}`);
      } else if (event.type === 'cooldown') {
        setProgress(`⏸ 冷却中 (${event.remainingMs}ms)`);
      }
    });

    const result = await scaler.start(duration * 1000);
    setReport(result);
    setProgress('完成');
    setRunning(false);
  };

  const handleStop = () => {
    scalerRef.current?.abort();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">📈 自动扩缩容</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> 基于 CPU/内存/QPS/延迟的滑动窗口评估。模拟 3 秒扩缩容循环, 范围 1-5 实例。
      </div>

      <div className="grid grid-cols-2 gap-2 items-end">
        <div>
          <label className="block text-sm font-medium mb-1">服务名称</label>
          <input
            type="text"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            disabled={running}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">持续 (秒)</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
            disabled={running}
            min="1"
            max="60"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-800"
          />
        </div>
      </div>

      {running ? (
        <button
          onClick={handleStop}
          className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded"
        >
          停止
        </button>
      ) : (
        <button
          onClick={handleRun}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded"
        >
          启动扩缩容
        </button>
      )}

      {progress && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <strong>状态:</strong> {progress}
        </div>
      )}

      {report && <ScalerReportView report={report} />}
    </div>
  );
}

function ScalerReportView({ report }: { report: ScalingReport }) {
  return (
    <div className="space-y-3">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
        <div className="font-semibold text-sm">{report.summary}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="扩容次数" value={report.scaleUpCount} />
        <Stat label="缩容次数" value={report.scaleDownCount} />
        <Stat label="总采样" value={report.totalSamples} />
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-sm">操作历史</h4>
        {report.history.length === 0 ? (
          <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 p-2 rounded">无扩缩容操作</div>
        ) : (
          report.history.map((action, i) => (
            <div
              key={i}
              className={`p-2 rounded text-sm ${
                action.type === 'scale-up' ? 'bg-green-50 dark:bg-green-900/20' : 'bg-orange-50 dark:bg-orange-900/20'
              }`}
            >
              <div className="flex justify-between">
                <span className="font-medium">
                  {action.type === 'scale-up' ? '↑ 扩容' : '↓ 缩容'}
                </span>
                <span>
                  {action.fromInstances} → {action.toInstances}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">{action.reason}</div>
            </div>
          ))
        )}
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

// ============================================================
// Tab 4: 灾备恢复
// ============================================================

function DRTab() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<DRReport | null>(null);
  const [progress, setProgress] = useState<string>('');
  const drRef = useRef<DisasterRecovery | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setReport(null);
    setProgress('初始化灾备监控...');

    const dr = new DisasterRecovery(
      createDefaultDRConfig('primary-db', 'standby-db')
    );
    drRef.current = dr;

    dr.subscribe((event) => {
      if (event.type === 'backup-complete') {
        setProgress(`✅ 备份完成: ${event.backup.type} (${(event.backup.sizeBytes / 1024).toFixed(0)} KB)`);
      } else if (event.type === 'failover-start') {
        setProgress(`⚠️ 故障切换: ${event.failover.fromNodeId} → ${event.failover.toNodeId}`);
      } else if (event.type === 'failover-complete') {
        setProgress(`✅ 切换完成 (RTO: ${event.failover.recoveryTimeMs}ms)`);
      }
    });

    const result = await dr.start(2000);
    setReport(result);
    setProgress('完成');
    setRunning(false);
  };

  const handleStop = () => {
    drRef.current?.abort();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">🛡️ 灾备恢复</h3>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm">
        <strong>说明:</strong> 主备数据库 + 健康检查 + 自动故障切换 + 定期备份。模拟 2 秒灾备监控, 默认主+1 备。
      </div>

      {running ? (
        <button
          onClick={handleStop}
          className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded"
        >
          停止
        </button>
      ) : (
        <button
          onClick={handleRun}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded"
        >
          启动灾备监控
        </button>
      )}

      {progress && (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm">
          <strong>状态:</strong> {progress}
        </div>
      )}

      {report && <DRReportView report={report} />}
    </div>
  );
}

function DRReportView({ report }: { report: DRReport }) {
  return (
    <div className="space-y-3">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
        <div className="font-semibold text-sm">{report.summary}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="备份数" value={report.totalBackups} />
        <Stat label="成功备份" value={report.successfulBackups} />
        <Stat label="切换次数" value={report.failoverCount} />
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-sm">节点状态</h4>
        {report.nodes.map((node) => (
          <div
            key={node.id}
            className={`p-2 rounded text-sm ${
              node.role === 'primary'
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : node.role === 'failed'
                ? 'bg-red-50 dark:bg-red-900/20'
                : 'bg-gray-50 dark:bg-gray-800'
            }`}
          >
            <div className="flex justify-between">
              <span className="font-medium">{node.name}</span>
              <span className="text-xs">{node.role}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              连续失败: {node.consecutiveFailures} | 健康: {node.healthy ? '✅' : '❌'}
            </div>
          </div>
        ))}
      </div>

      {report.failovers.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">故障切换历史</h4>
          {report.failovers.map((f) => (
            <div key={f.id} className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-sm">
              <div className="font-medium">{f.fromNodeId} → {f.toNodeId}</div>
              <div className="text-xs text-gray-500 mt-1">
                RTO: {f.recoveryTimeMs}ms | 数据丢失: {f.dataLossBytes} 字节
              </div>
              <div className="text-xs text-gray-500">原因: {f.reason}</div>
            </div>
          ))}
        </div>
      )}

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

// ============================================================
// Tab 5: 集成文档
// ============================================================

function DocsTab() {
  return (
    <div className="space-y-4 text-sm">
      <h3 className="text-lg font-semibold">📖 集成文档</h3>

      <section className="space-y-2">
        <h4 className="font-medium">🚀 灰度发布 (CanaryDeployment)</h4>
        <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
{`import { CanaryDeployment, createCanaryStrategy } from '../utils/canaryDeployment';

const strategy = createCanaryStrategy('my-service', [
  { name: '1% Smoke', trafficPercent: 1, durationMs: 5000, minHealthScore: 0.7 },
  { name: '50% Half', trafficPercent: 50, durationMs: 10000, minHealthScore: 0.65 },
  { name: '100% Full', trafficPercent: 100, durationMs: 10000, minHealthScore: 0.6 },
], { maxErrorRate: 0.05, maxP95LatencyMs: 500, minQps: 50, maxCpuUsage: 0.8 }, { autoRollback: true });

const deployment = new CanaryDeployment(strategy);
deployment.subscribe((event) => console.log(event));
const report = await deployment.execute();`}
        </pre>
      </section>

      <section className="space-y-2">
        <h4 className="font-medium">🌐 多区域路由 (MultiRegionRouter)</h4>
        <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
{`import { MultiRegionRouter, createDefaultRegions, createDefaultRoutingStrategy } from '../utils/multiRegionRouter';

const router = new MultiRegionRouter(createDefaultRoutingStrategy('geo'));
createDefaultRegions().forEach((r) => router.addRegion(r));

const requests = [{ id: '1', clientLocation: {...}, path: '/api', method: 'GET' }];
const report = await router.routeBatch(requests);`}
        </pre>
      </section>

      <section className="space-y-2">
        <h4 className="font-medium">📈 自动扩缩容 (AutoScaler)</h4>
        <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
{`import { AutoScaler, createDefaultScalingConfig } from '../utils/autoScaler';

const scaler = new AutoScaler(createDefaultScalingConfig('web', {
  minInstances: 1,
  maxInstances: 10,
  initialInstances: 2,
}));

scaler.subscribe((event) => {
  if (event.type === 'scale-up' || event.type === 'scale-down') {
    console.log(\`实例数: \${event.newInstances.length}\`);
  }
});

const report = await scaler.start(60000); // 60 秒`}
        </pre>
      </section>

      <section className="space-y-2">
        <h4 className="font-medium">🛡️ 灾备恢复 (DisasterRecovery)</h4>
        <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
{`import { DisasterRecovery, createDefaultDRConfig } from '../utils/disasterRecovery';

const dr = new DisasterRecovery(createDefaultDRConfig('primary', 'standby'));

dr.subscribe((event) => {
  if (event.type === 'failover-complete') {
    console.log(\`RTO: \${event.failover.recoveryTimeMs}ms\`);
  }
});

// 手动故障切换
const failover = await dr.manualFailover('node-standby-1', 'Planned maintenance');

// 启动监控
const report = await dr.start(3600000); // 1 小时`}
        </pre>
      </section>

      <section className="space-y-2">
        <h4 className="font-medium">📊 关键指标</h4>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li><strong>RTO (Recovery Time Objective):</strong> 故障切换耗时, 目标 &lt; 1 分钟</li>
          <li><strong>RPO (Recovery Point Objective):</strong> 数据丢失容忍, 目标 &lt; 5 秒</li>
          <li><strong>SLA:</strong> 服务可用性 ≥ 99.95%</li>
          <li><strong>灰度发布:</strong> 健康度阈值 ≥ 0.6, 自动回滚</li>
          <li><strong>扩缩容:</strong> 冷却期 ≥ 5 秒, 避免抖动</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="font-medium">🔗 关联能力</h4>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Cycle 50 G50-04: Docker Compose 部署栈</li>
          <li>Cycle 51 G51-01: HealthChecker 健康检查</li>
          <li>Cycle 51 G51-04: LoadTester 性能压测</li>
          <li>Cycle 52 G52-01~04: 4 大生产化能力</li>
        </ul>
      </section>
    </div>
  );
}

// ============================================================
// 辅助组件
// ============================================================

function Stat({ label, value, color = '' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className={`p-2 rounded ${color || 'bg-gray-50 dark:bg-gray-800'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-bold text-lg">{value}</div>
    </div>
  );
}
