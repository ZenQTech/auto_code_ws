/**
 * UnifiedDashboardPanel - 集成 Dashboard 面板
 * Cycle 33 G33-02
 *
 * 功能：
 *   - 预置 Dashboard 展示
 *   - 指标采集与展示
 *   - 阈值告警
 *   - 引擎健康度
 *   - 报告导出
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  UnifiedDashboardEngine,
  getDefaultDashboardEngine,
  type DashboardPanel,
  type Metric,
  type ThresholdAlert,
} from '../utils/unifiedDashboardEngine';

export interface UnifiedDashboardPanelProps {
  engine?: UnifiedDashboardEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'dashboard' | 'panels' | 'alerts' | 'health';

export const UnifiedDashboardPanel: React.FC<UnifiedDashboardPanelProps> = ({
  engine: engineProp,
  isOpen: _isOpen,
  onClose,
}) => {
  const engine = useMemo(
    () => engineProp || getDefaultDashboardEngine(),
    [engineProp],
  );
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDashboard, setSelectedDashboard] = useState<string | null>(null);

  useEffect(() => {
    const events = ['metric-collected', 'panel-created', 'threshold-exceeded', 'dashboard-updated'];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const stats = useMemo(() => engine.getStats(), [engine, refreshKey]);
  const dashboards = useMemo(() => engine.listDashboards(), [engine, refreshKey]);

  useEffect(() => {
    if (!selectedDashboard && dashboards.length > 0) {
      setSelectedDashboard(dashboards[0].id);
    }
  }, [dashboards, selectedDashboard]);

  return (
    <div className="unified-dashboard-panel" data-testid="unified-dashboard-panel">
      <div className="panel-header">
        <h2>集成 Dashboard (Unified Dashboard)</h2>
        {onClose && (
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
      </div>

      <div className="panel-stats">
        <span>指标: {stats.totalMetrics}</span>
        <span>面板: {stats.totalPanels}</span>
        <span>Dashboard: {stats.totalDashboards}</span>
        <span>告警: {stats.unacknowledgedAlerts}</span>
      </div>

      <div className="panel-tabs">
        <button
          className={tab === 'dashboard' ? 'active' : ''}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={tab === 'panels' ? 'active' : ''}
          onClick={() => setTab('panels')}
        >
          面板管理
        </button>
        <button
          className={tab === 'alerts' ? 'active' : ''}
          onClick={() => setTab('alerts')}
        >
          告警
        </button>
        <button
          className={tab === 'health' ? 'active' : ''}
          onClick={() => setTab('health')}
        >
          引擎健康度
        </button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'dashboard' && (
          <DashboardTab
            engine={engine}
            selectedDashboard={selectedDashboard}
            setSelectedDashboard={setSelectedDashboard}
          />
        )}
        {tab === 'panels' && <PanelsTab engine={engine} />}
        {tab === 'alerts' && <AlertsTab engine={engine} />}
        {tab === 'health' && <HealthTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ Dashboard Tab ============

const DashboardTab: React.FC<{
  engine: UnifiedDashboardEngine;
  selectedDashboard: string | null;
  setSelectedDashboard: (id: string | null) => void;
}> = ({ engine, selectedDashboard, setSelectedDashboard }) => {
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const dashboards = engine.listDashboards();
  const dashboard = selectedDashboard
    ? engine.getDashboard(selectedDashboard)
    : dashboards[0];

  const handleExport = () => {
    if (!dashboard) return;
    const content = engine.exportDashboard(dashboard.id, exportFormat);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dashboard.id}.${exportFormat}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dashboard-tab">
      <div className="toolbar">
        <select
          value={dashboard?.id || ''}
          onChange={(e) => setSelectedDashboard(e.target.value)}
        >
          {dashboards.length === 0 && <option value="">暂无 Dashboard</option>}
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)}>
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <button onClick={handleExport} disabled={!dashboard}>
          导出
        </button>
        <button onClick={() => engine.collect()}>采集</button>
      </div>

      {dashboard && (
        <div className="dashboard-content">
          <h3>{dashboard.name}</h3>
          <p>{dashboard.description}</p>
          <div className="panels-grid">
            {dashboard.panels.map((panel) => (
              <PanelCard key={panel.id} engine={engine} panel={panel} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const PanelCard: React.FC<{
  engine: UnifiedDashboardEngine;
  panel: DashboardPanel;
}> = ({ engine, panel }) => {
  const metrics: Metric[] = [];
  for (const id of panel.metricIds) {
    const list = engine.getMetric(id);
    if (list) metrics.push(...list);
  }

  return (
    <div className="panel-card" data-testid={`panel-${panel.id}`}>
      <div className="panel-title">{panel.title}</div>
      <div className="panel-category">{panel.category}</div>
      {metrics.length === 0 && <div className="empty-metric">暂无数据</div>}
      {metrics.map((m) => (
        <div key={m.id} className="metric-item">
          <span className="metric-name">{m.name}</span>
          <span className="metric-value">{formatMetricValue(m)}</span>
        </div>
      ))}
    </div>
  );
};

function formatMetricValue(metric: Metric): string {
  if (metric.type === 'gauge' && metric.category === 'health') {
    return `${(metric.value * 100).toFixed(1)}%`;
  }
  if (metric.type === 'histogram') {
    return `${metric.value}ms`;
  }
  return String(metric.value);
}

// ============ 面板管理 Tab ============

const PanelsTab: React.FC<{ engine: UnifiedDashboardEngine }> = ({ engine }) => {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    title: '',
    category: 'health' as DashboardPanel['category'],
    type: 'metric' as DashboardPanel['type'],
    metricIds: '',
  });

  const panels = engine.listPanels();

  const handleCreate = () => {
    if (!form.title) return;
    const metricIds = form.metricIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    engine.createPanel({
      title: form.title,
      category: form.category,
      type: form.type,
      metricIds,
      position: { x: 0, y: 0, w: 4, h: 2 },
      config: {},
      visible: true,
    });
    setShowNew(false);
    setForm({ title: '', category: 'health', type: 'metric', metricIds: '' });
  };

  return (
    <div className="panels-tab">
      <div className="toolbar">
        <button onClick={() => setShowNew(!showNew)}>+ 新建面板</button>
      </div>

      {showNew && (
        <div className="new-panel-form">
          <input
            placeholder="标题"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as any })}
          >
            <option value="health">健康度</option>
            <option value="cost">成本</option>
            <option value="task">任务</option>
            <option value="audit">审计</option>
            <option value="alert">告警</option>
            <option value="user">用户</option>
            <option value="model">模型</option>
            <option value="worktree">Worktree</option>
            <option value="security">安全</option>
            <option value="compliance">合规</option>
            <option value="skill">技能</option>
            <option value="session">会话</option>
          </select>
          <input
            placeholder="指标 IDs (逗号分隔)"
            value={form.metricIds}
            onChange={(e) => setForm({ ...form, metricIds: e.target.value })}
          />
          <button onClick={handleCreate}>创建</button>
        </div>
      )}

      <div className="panels-list">
        {panels.length === 0 && <p className="empty">暂无面板</p>}
        {panels.map((p) => (
          <div key={p.id} className="panel-list-item">
            <strong>{p.title}</strong>
            <span className="badge">{p.category}</span>
            <span>{p.metricIds.length} 个指标</span>
            <button onClick={() => engine.deletePanel(p.id)}>删除</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ 告警 Tab ============

const AlertsTab: React.FC<{ engine: UnifiedDashboardEngine }> = ({ engine }) => {
  const [severity, setSeverity] = useState<'all' | ThresholdAlert['severity']>('all');
  const alerts = engine.listThresholdAlerts().filter(
    (a) => severity === 'all' || a.severity === severity,
  );

  return (
    <div className="alerts-tab">
      <div className="toolbar">
        <select value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
          <option value="all">所有严重度</option>
          <option value="info">信息</option>
          <option value="warning">警告</option>
          <option value="error">错误</option>
          <option value="critical">严重</option>
        </select>
        <button onClick={() => engine.evaluateThresholds()}>重新评估</button>
      </div>

      <div className="alerts-list">
        {alerts.length === 0 && <p className="empty">暂无告警</p>}
        {alerts.map((a) => (
          <div
            key={a.id}
            className={`alert-item severity-${a.severity} ${a.acknowledged ? 'acknowledged' : ''}`}
            data-testid={`alert-${a.id}`}
          >
            <div>
              <strong>{a.metricName}</strong>
              <span className={`badge badge-${a.severity}`}>{a.severity}</span>
            </div>
            <p>{a.message}</p>
            <p>实际值: {a.actualValue}</p>
            <p>{new Date(a.timestamp).toLocaleString()}</p>
            {!a.acknowledged && (
              <button onClick={() => engine.acknowledgeAlert(a.id, 'current-user')}>确认</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ 引擎健康度 Tab ============

const HealthTab: React.FC<{ engine: UnifiedDashboardEngine }> = ({ engine }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const health = useMemo(
    () => engine.getEngineHealth(),
    [engine, refreshKey],
  );

  useEffect(() => {
    const unsub = engine.on('metric-collected', () => setRefreshKey((k) => k + 1));
    return () => {
      unsub();
    };
  }, [engine]);

  return (
    <div className="health-tab">
      <div className="toolbar">
        <button onClick={() => engine.collect()}>立即采集</button>
      </div>

      <div className="health-list">
        {Object.entries(health).length === 0 && <p className="empty">暂无健康度数据</p>}
        {Object.entries(health).map(([engineId, status]) => (
          <div key={engineId} className={`health-item status-${status.status}`}>
            <strong>{engineId}</strong>
            <span className={`status-badge status-${status.status}`}>{status.status}</span>
            {status.error && <p className="error">错误: {status.error}</p>}
            {status.lastCheck > 0 && (
              <p>最后检查: {new Date(status.lastCheck).toLocaleString()}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
