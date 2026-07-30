/**
 * CostAttributionPanel - 团队/项目维度成本归因面板
 * Cycle 31 G31-01
 *
 * 3 Tab 页：
 *   1. 概览 Dashboard
 *   2. 多维分析
 *   3. 异常告警
 *   4. 导出报告
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  CostAttributionEngine,
  getDefaultCostAttributionEngine,
  type AttributionRecord,
  type AttributionReport,
  type AnomalyAlert,
  type Period,
} from '../utils/costAttributionEngine';

export interface CostAttributionPanelProps {
  engine?: CostAttributionEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'overview' | 'analysis' | 'anomalies' | 'export';

export const CostAttributionPanel: React.FC<CostAttributionPanelProps> = ({ engine: engineProp, isOpen: _isOpen, onClose }) => {
  const engine = useMemo(() => engineProp || getDefaultCostAttributionEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('overview');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const unsub = engine.on('attribution-recorded', () => setRefreshKey((k) => k + 1));
    return () => { unsub(); };
  }, [engine]);

  return (
    <div className="cost-attribution-panel" data-testid="cost-attribution-panel">
      <div className="panel-header">
        <h2>团队/项目成本归因</h2>
        {onClose && <button onClick={onClose} aria-label="关闭">×</button>}
      </div>

      <div className="panel-tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>概览</button>
        <button className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}>多维分析</button>
        <button className={tab === 'anomalies' ? 'active' : ''} onClick={() => setTab('anomalies')}>异常告警</button>
        <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>导出报告</button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'overview' && <OverviewTab engine={engine} />}
        {tab === 'analysis' && <AnalysisTab engine={engine} />}
        {tab === 'anomalies' && <AnomaliesTab engine={engine} />}
        {tab === 'export' && <ExportTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ 概览 Tab ============

const OverviewTab: React.FC<{ engine: CostAttributionEngine }> = ({ engine }) => {
  const [orgId, setOrgId] = useState('');
  const orgs = engine.listOrgs();
  const period: Period = { from: Date.now() - 30 * 86400000, to: Date.now() };
  const report = orgId ? engine.getByOrg(orgId, period) : null;

  return (
    <div className="tab-overview" data-testid="overview-tab">
      <div className="form-row">
        <label>选择组织：</label>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">-- 选择 --</option>
          {orgs.map((o) => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
        </select>
      </div>

      {report && (
        <div className="report-summary">
          <div className="metric">
            <div className="label">总成本</div>
            <div className="value">${report.totalCost.toFixed(2)}</div>
          </div>
          <div className="metric">
            <div className="label">调用次数</div>
            <div className="value">{report.callCount}</div>
          </div>
          <div className="metric">
            <div className="label">平均成本</div>
            <div className="value">${report.averageCost.toFixed(4)}</div>
          </div>
          <div className="metric">
            <div className="label">Token 数</div>
            <div className="value">{(report.totalInputTokens + report.totalOutputTokens).toLocaleString()}</div>
          </div>
        </div>
      )}

      {report && report.topModels && report.topModels.length > 0 && (
        <div className="top-models">
          <h3>Top 模型</h3>
          <ul>
            {report.topModels.map((m) => (
              <li key={m.model}>
                <span>{m.model}</span>
                <span>${m.cost.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ============ 多维分析 Tab ============

const AnalysisTab: React.FC<{ engine: CostAttributionEngine }> = ({ engine }) => {
  const [dimension, setDimension] = useState<'org' | 'team' | 'project' | 'repo' | 'user'>('org');
  const [scopeId, setScopeId] = useState('');
  const [records, setRecords] = useState<AttributionRecord[]>([]);
  const [report, setReport] = useState<AttributionReport | null>(null);

  useEffect(() => {
    if (scopeId) {
      const period: Period = { from: Date.now() - 30 * 86400000, to: Date.now() };
      const r = engine.getCrossDimensional({ ...{ [dimension + 'Id']: scopeId }, period });
      setReport(r);
      setRecords(engine.getRecords((rec) => {
        if (dimension === 'org') return rec.org.orgId === scopeId;
        if (dimension === 'team') return rec.team.teamId === scopeId;
        if (dimension === 'project') return rec.project.projectId === scopeId;
        if (dimension === 'repo') return rec.repo.repoId === scopeId;
        return rec.user.userId === scopeId;
      }));
    }
  }, [scopeId, dimension, engine]);

  return (
    <div className="tab-analysis" data-testid="analysis-tab">
      <div className="form-row">
        <label>维度：</label>
        <select value={dimension} onChange={(e) => { setDimension(e.target.value as any); setScopeId(''); }}>
          <option value="org">组织</option>
          <option value="team">团队</option>
          <option value="project">项目</option>
          <option value="repo">仓库</option>
          <option value="user">用户</option>
        </select>
        <label>ID：</label>
        <input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder="输入 scope ID" />
      </div>

      {report && (
        <div className="analysis-result">
          <p>总成本: ${report.totalCost.toFixed(2)} | 调用: {report.callCount}</p>
        </div>
      )}

      {records.length > 0 && (
        <table className="records-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>仓库</th>
              <th>模型</th>
              <th>Tokens</th>
              <th>成本</th>
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 50).map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.timestamp).toLocaleString()}</td>
                <td>{r.user.name}</td>
                <td>{r.repo.name}</td>
                <td>{r.model}</td>
                <td>{r.inputTokens + r.outputTokens}</td>
                <td>${r.totalCost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ============ 异常告警 Tab ============

const AnomaliesTab: React.FC<{ engine: CostAttributionEngine }> = ({ engine }) => {
  const [threshold, setThreshold] = useState('100');
  const [scope, setScope] = useState('user:');
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);

  const refresh = () => {
    const period: Period = { from: Date.now() - 30 * 86400000, to: Date.now() };
    setAnomalies(engine.getAnomalies(period));
  };

  useEffect(() => { refresh(); }, [engine]);

  return (
    <div className="tab-anomalies" data-testid="anomalies-tab">
      <div className="form-row">
        <label>设置告警阈值：</label>
        <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="user:userId 或 org:orgId" />
        <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        <button onClick={() => { engine.setAlertThreshold(scope, Number(threshold)); refresh(); }}>设置</button>
      </div>

      <h3>当前告警</h3>
      {anomalies.length === 0 ? (
        <p>无告警</p>
      ) : (
        <ul className="anomaly-list">
          {anomalies.map((a) => (
            <li key={a.id} className={`anomaly-${a.type}`}>
              <strong>{a.type}</strong>: {a.message}
              <span> ({a.currentValue.toFixed(2)} / 阈值 {a.threshold.toFixed(2)})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ============ 导出 Tab ============

const ExportTab: React.FC<{ engine: CostAttributionEngine }> = ({ engine }) => {
  const [format, setFormat] = useState<'csv' | 'json' | 'chargeback'>('csv');
  const [output, setOutput] = useState('');

  const handleExport = () => {
    const period: Period = { from: Date.now() - 30 * 86400000, to: Date.now() };
    if (format === 'csv') setOutput(engine.exportCSV({ period }));
    else if (format === 'json') setOutput(engine.exportJSON({ period }));
    else {
      const cb = engine.exportChargeback({ period });
      setOutput(JSON.stringify(cb, null, 2));
    }
  };

  return (
    <div className="tab-export" data-testid="export-tab">
      <div className="form-row">
        <label>格式：</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
          <option value="chargeback">Chargeback</option>
        </select>
        <button onClick={handleExport}>生成</button>
      </div>

      {output && (
        <pre className="export-output" data-testid="export-output">
          {output.length > 5000 ? output.slice(0, 5000) + '\n... (truncated)' : output}
        </pre>
      )}
    </div>
  );
};

export default CostAttributionPanel;
