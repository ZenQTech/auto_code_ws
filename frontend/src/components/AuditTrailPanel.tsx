/**
 * AuditTrailPanel - 审计追踪面板
 * Cycle 32 G32-01
 *
 * 4 Tab 页：
 *   1. 事件流 (Event Stream)
 *   2. 合规报告 (Compliance Reports)
 *   3. 完整性验证 (Chain Verification)
 *   4. GDPR 操作 (GDPR Operations)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  AuditTrailEngine,
  getDefaultAuditTrailEngine,
  type AuditEvent,
  type ComplianceReport,
  type Period,
} from '../utils/auditTrailEngine';

export interface AuditTrailPanelProps {
  engine?: AuditTrailEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'stream' | 'compliance' | 'integrity' | 'gdpr';

export const AuditTrailPanel: React.FC<AuditTrailPanelProps> = ({ engine: engineProp, isOpen, onClose }) => {

  // G60-FIX-13: 面板关闭时早返回，避免在 DOM 中堆积所有面板
  if (isOpen === false) return null;
  const engine = useMemo(() => engineProp || getDefaultAuditTrailEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('stream');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const events = ['event-recorded', 'event-verified', 'report-generated', 'actor-anonymized', 'chain-broken'];
    const unsubs = events.map((evt) => engine.on(evt as any, () => setRefreshKey((k) => k + 1)));
    return () => { unsubs.forEach((u) => u()); };
  }, [engine]);

  return (
    <div className="audit-trail-panel" data-testid="audit-trail-panel">
      <div className="panel-header">
        <h2>审计追踪 (Audit Trail)</h2>
        {onClose && <button onClick={onClose} aria-label="关闭">×</button>}
      </div>

      <div className="panel-tabs">
        <button className={tab === 'stream' ? 'active' : ''} onClick={() => setTab('stream')}>事件流</button>
        <button className={tab === 'compliance' ? 'active' : ''} onClick={() => setTab('compliance')}>合规报告</button>
        <button className={tab === 'integrity' ? 'active' : ''} onClick={() => setTab('integrity')}>完整性验证</button>
        <button className={tab === 'gdpr' ? 'active' : ''} onClick={() => setTab('gdpr')}>GDPR 操作</button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'stream' && <StreamTab engine={engine} />}
        {tab === 'compliance' && <ComplianceTab engine={engine} />}
        {tab === 'integrity' && <IntegrityTab engine={engine} />}
        {tab === 'gdpr' && <GdprTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ 事件流 Tab ============

const StreamTab: React.FC<{ engine: AuditTrailEngine }> = ({ engine }) => {
  const [filter, setFilter] = useState<{ type?: string; outcome?: string; actor?: string }>({});
  const [exportFormat, setExportFormat] = useState<'json' | 'csv' | 'cef' | 'leef'>('json');

  const events = useMemo(() => {
    return engine.query({
      eventTypes: filter.type ? [filter.type as any] : undefined,
      outcomes: filter.outcome ? [filter.outcome as any] : undefined,
      actorIds: filter.actor ? [filter.actor] : undefined,
    }).slice(-200).reverse();
  }, [engine, filter]);

  const handleExport = () => {
    let content = '';
    if (exportFormat === 'json') content = engine.exportJSON({});
    else if (exportFormat === 'csv') content = engine.exportCSV({});
    else if (exportFormat === 'cef') content = engine.exportCEF({});
    else if (exportFormat === 'leef') content = engine.exportLEEF({});
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${Date.now()}.${exportFormat}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tab-stream" data-testid="stream-tab">
      <div className="form-row">
        <label>类型：</label>
        <select value={filter.type || ''} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
          <option value="">全部</option>
          <option value="auth">auth</option>
          <option value="authz">authz</option>
          <option value="data">data</option>
          <option value="admin">admin</option>
          <option value="system">system</option>
          <option value="agent">agent</option>
          <option value="compliance">compliance</option>
        </select>
        <label>结果：</label>
        <select value={filter.outcome || ''} onChange={(e) => setFilter({ ...filter, outcome: e.target.value })}>
          <option value="">全部</option>
          <option value="success">success</option>
          <option value="failure">failure</option>
          <option value="denied">denied</option>
          <option value="pending">pending</option>
        </select>
        <label>Actor：</label>
        <input value={filter.actor || ''} onChange={(e) => setFilter({ ...filter, actor: e.target.value })} placeholder="actor id" />
      </div>

      <div className="export-row">
        <label>导出：</label>
        <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)}>
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="cef">CEF</option>
          <option value="leef">LEEF</option>
        </select>
        <button onClick={handleExport} data-testid="export-audit">导出</button>
      </div>

      <div className="event-list" data-testid="event-list">
        {events.length === 0 ? (
          <div className="empty">暂无事件</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>Actor</th>
                <th>Action</th>
                <th>类型</th>
                <th>结果</th>
                <th>严重度</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id} data-testid="event-row">
                  <td>{new Date(evt.timestamp).toLocaleString()}</td>
                  <td>{evt.who.id}</td>
                  <td>{evt.what}</td>
                  <td>{evt.eventType}</td>
                  <td className={`outcome-${evt.outcome}`}>{evt.outcome}</td>
                  <td className={`severity-${evt.severity}`}>{evt.severity}</td>
                  <td className="hash">{evt.hash.substring(0, 12)}...</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============ 合规报告 Tab ============

const ComplianceTab: React.FC<{ engine: AuditTrailEngine }> = ({ engine }) => {
  const [reportType, setReportType] = useState<'soc2' | 'iso27001' | 'gdpr' | 'eu-ai-act'>('soc2');
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<ComplianceReport | null>(null);

  const generateReport = () => {
    const now = Date.now();
    const period: Period = { from: now - days * 86400000, to: now };
    let r: ComplianceReport;
    if (reportType === 'soc2') r = engine.generateSOC2Report(period);
    else if (reportType === 'iso27001') r = engine.generateISO27001Report(period);
    else if (reportType === 'gdpr') r = engine.generateGDPRReport(period);
    else r = engine.generateEUAIActReport(period);
    setReport(r);
  };

  return (
    <div className="tab-compliance" data-testid="compliance-tab">
      <div className="form-row">
        <label>报告类型：</label>
        <select value={reportType} onChange={(e) => setReportType(e.target.value as any)}>
          <option value="soc2">SOC 2</option>
          <option value="iso27001">ISO 27001</option>
          <option value="gdpr">GDPR</option>
          <option value="eu-ai-act">EU AI Act</option>
        </select>
        <label>时间范围：</label>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}>
          <option value="7">最近 7 天</option>
          <option value="30">最近 30 天</option>
          <option value="90">最近 90 天</option>
          <option value="365">最近 365 天</option>
        </select>
        <button onClick={generateReport} data-testid="generate-report">生成报告</button>
      </div>

      {report && (
        <div className="report-content" data-testid="report-content">
          <h3>合规报告 - {report.standard}</h3>
          <div className="report-meta">
            <span>报告 ID：{report.id}</span>
            <span>时间范围：{new Date(report.period.from).toLocaleDateString()} - {new Date(report.period.to).toLocaleDateString()}</span>
            <span>事件数：{report.totalEvents}</span>
            <span>完整性：{report.integrityVerified ? '✓ 通过' : '✗ 失败'}</span>
            <span>验证检查：{report.integrityCheck.totalChecked} 条</span>
          </div>
          <div className="report-sections">
            {report.sections.map((section, i) => (
              <div key={i} className="report-section">
                <h4>{section.title}</h4>
                <p>{section.description}</p>
                <p>控制项：{section.controlIds.join(', ')}</p>
                <p>事件数：{section.summary.total}（成功 {section.summary.success} / 失败 {section.summary.failure} / 拒绝 {section.summary.denied}）</p>
              </div>
            ))}
          </div>
          <pre className="report-json">{JSON.stringify(report, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

// ============ 完整性验证 Tab ============

const IntegrityTab: React.FC<{ engine: AuditTrailEngine }> = ({ engine }) => {
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; totalChecked: number; firstInvalidIndex?: number; errors?: string[] } | null>(null);

  const handleVerify = () => {
    const result = engine.verifyChain();
    setVerifyResult({
      valid: result.valid,
      totalChecked: result.totalChecked,
      firstInvalidIndex: result.firstInvalidIndex,
      errors: result.errors,
    });
  };

  const stats = engine.getStats();

  return (
    <div className="tab-integrity" data-testid="integrity-tab">
      <div className="integrity-stats">
        <div className="stat-card">
          <div className="label">总事件数</div>
          <div className="value">{stats.totalEvents}</div>
        </div>
        <div className="stat-card">
          <div className="label">链数</div>
          <div className="value">{stats.chains}</div>
        </div>
        <div className="stat-card">
          <div className="label">当前序列号</div>
          <div className="value">{stats.currentSequence}</div>
        </div>
        <div className="stat-card">
          <div className="label">已归档</div>
          <div className="value">{stats.archivedCount}</div>
        </div>
      </div>

      <button onClick={handleVerify} data-testid="verify-chain" className="primary">
        验证哈希链完整性
      </button>

      {verifyResult && (
        <div className={`verify-result ${verifyResult.valid ? 'valid' : 'invalid'}`} data-testid="verify-result">
          <h3>{verifyResult.valid ? '✓ 完整性验证通过' : '✗ 完整性验证失败'}</h3>
          <p>检查事件数：{verifyResult.totalChecked}</p>
          {verifyResult.firstInvalidIndex !== undefined && <p>断裂位置：事件 #{verifyResult.firstInvalidIndex}</p>}
          {verifyResult.errors && verifyResult.errors.length > 0 && <p>错误：{verifyResult.errors.join('; ')}</p>}
        </div>
      )}
    </div>
  );
};

// ============ GDPR 操作 Tab ============

const GdprTab: React.FC<{ engine: AuditTrailEngine }> = ({ engine }) => {
  const [actorId, setActorId] = useState('');
  const [exportData, setExportData] = useState<AuditEvent[]>([]);

  const handleAnonymize = () => {
    if (!actorId) return;
    const count = engine.anonymizeActor(actorId);
    alert(`已脱敏 ${count} 个事件`);
    setActorId('');
  };

  const handleExport = () => {
    if (!actorId) return;
    const data = engine.exportActorData(actorId);
    setExportData(data);
  };

  const handleDelete = () => {
    if (!actorId) return;
    if (!confirm(`确认删除 actor "${actorId}" 的所有事件？此操作不可撤销。`)) return;
    const count = engine.deleteActorData(actorId);
    alert(`已删除 ${count} 个事件`);
    setActorId('');
  };

  return (
    <div className="tab-gdpr" data-testid="gdpr-tab">
      <div className="form-row">
        <label>Actor ID：</label>
        <input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="user-123" data-testid="gdpr-actor-input" />
      </div>

      <div className="action-row">
        <button onClick={handleExport} data-testid="gdpr-export">导出个人数据</button>
        <button onClick={handleAnonymize} data-testid="gdpr-anonymize">脱敏</button>
        <button onClick={handleDelete} className="danger" data-testid="gdpr-delete">删除</button>
      </div>

      {exportData.length > 0 && (
        <div className="export-data" data-testid="gdpr-export-data">
          <h3>个人数据 ({exportData.length} 个事件)</h3>
          <pre>{JSON.stringify(exportData, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
