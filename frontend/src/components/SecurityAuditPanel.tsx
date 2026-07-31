/**
 * SecurityAuditPanel - 安全审计场景面板
 * Cycle 33 G33-03
 *
 * 功能：
 *   - 7 个预置攻击场景
 *   - 场景执行 + 验证结果可视化
 *   - 执行历史
 *   - 应急响应启动
 *   - 报告生成与导出
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  SecurityAuditEngine,
  getDefaultSecurityAuditEngine,
  type AttackScenario,
  type ScenarioExecution,
  type IncidentResponse,
  type SecurityAuditReport,
} from '../utils/securityAuditEngine';

export interface SecurityAuditPanelProps {
  engine?: SecurityAuditEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'scenarios' | 'executions' | 'incidents' | 'reports';

export const SecurityAuditPanel: React.FC<SecurityAuditPanelProps> = ({
  engine: engineProp,
  isOpen: _isOpen,
  onClose,
}) => {
  const engine = useMemo(
    () => engineProp || getDefaultSecurityAuditEngine(),
    [engineProp],
  );
  const [tab, setTab] = useState<TabKey>('scenarios');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);

  useEffect(() => {
    const events = [
      'scenario-registered',
      'execution-started',
      'execution-completed',
      'execution-failed',
      'incident-detected',
      'report-generated',
    ];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const stats = useMemo(() => engine.getStats(), [engine, refreshKey]);

  return (
    <div className="security-audit-panel" data-testid="security-audit-panel">
      <div className="panel-header">
        <h2>安全审计 (Security Audit)</h2>
        {onClose && (
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
      </div>

      <div className="panel-stats">
        <span>场景: {stats.totalScenarios}</span>
        <span>执行: {stats.totalExecutions}</span>
        <span>通过: {stats.passed}</span>
        <span>失败: {stats.failed}</span>
        <span>事件: {stats.activeIncidents}</span>
      </div>

      <div className="panel-tabs">
        <button
          className={tab === 'scenarios' ? 'active' : ''}
          onClick={() => setTab('scenarios')}
        >
          攻击场景
        </button>
        <button
          className={tab === 'executions' ? 'active' : ''}
          onClick={() => setTab('executions')}
        >
          执行历史
        </button>
        <button
          className={tab === 'incidents' ? 'active' : ''}
          onClick={() => setTab('incidents')}
        >
          应急响应
        </button>
        <button
          className={tab === 'reports' ? 'active' : ''}
          onClick={() => setTab('reports')}
        >
          报告
        </button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'scenarios' && <ScenariosTab engine={engine} />}
        {tab === 'executions' && (
          <ExecutionsTab
            engine={engine}
            selectedExecution={selectedExecution}
            setSelectedExecution={setSelectedExecution}
          />
        )}
        {tab === 'incidents' && <IncidentsTab engine={engine} />}
        {tab === 'reports' && <ReportsTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ 场景 Tab ============

const ScenariosTab: React.FC<{ engine: SecurityAuditEngine }> = ({ engine }) => {
  const [filter, setFilter] = useState<{ category?: string; severity?: import('../utils/securityAuditEngine').AttackSeverity }>({});
  const [executing, setExecuting] = useState<string | null>(null);
  const scenarios = engine.listScenarios(filter);

  const handleExecute = async (scenarioId: string) => {
    setExecuting(scenarioId);
    try {
      await engine.execute(scenarioId);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div className="scenarios-tab">
      <div className="toolbar">
        <select
          value={filter.category || ''}
          onChange={(e) => setFilter({ ...filter, category: e.target.value || undefined })}
        >
          <option value="">所有分类</option>
          <option value="authentication">认证</option>
          <option value="authorization">授权</option>
          <option value="data">数据</option>
          <option value="session">会话</option>
          <option value="privilege">权限</option>
          <option value="malicious">恶意</option>
          <option value="integrity">完整性</option>
        </select>
        <select
          value={filter.severity || ''}
          onChange={(e) => setFilter({ ...filter, severity: (e.target.value || undefined) as import('../utils/securityAuditEngine').AttackSeverity | undefined })}
        >
          <option value="">所有严重度</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
          <option value="critical">严重</option>
        </select>
        <button onClick={() => engine.loadPresetScenarios()}>加载预置</button>
        <button onClick={() => engine.executeAll()}>执行全部</button>
      </div>

      <div className="scenarios-grid">
        {scenarios.length === 0 && <p className="empty">暂无场景</p>}
        {scenarios.map((sc) => (
          <ScenarioCard
            key={sc.id}
            scenario={sc}
            onExecute={handleExecute}
            executing={executing === sc.id}
          />
        ))}
      </div>
    </div>
  );
};

const ScenarioCard: React.FC<{
  scenario: AttackScenario;
  onExecute: (id: string) => void;
  executing: boolean;
}> = ({ scenario, onExecute, executing }) => {
  return (
    <div className="scenario-card" data-testid={`scenario-${scenario.id}`}>
      <div className="scenario-header">
        <h3>{scenario.name}</h3>
        <span className={`severity-badge severity-${scenario.severity}`}>
          {scenario.severity}
        </span>
      </div>
      <p className="scenario-description">{scenario.description}</p>
      <div className="scenario-meta">
        <span className="badge">{scenario.category}</span>
        <span>v{scenario.version}</span>
      </div>
      <div className="scenario-expectations">
        <span>阻断: {scenario.expectedOutcome.blocked ? '✓' : '✗'}</span>
        <span>告警: {scenario.expectedOutcome.alerted ? '✓' : '✗'}</span>
        <span>审计: {scenario.expectedOutcome.audited ? '✓' : '✗'}</span>
      </div>
      <div className="scenario-stats">
        <span>{scenario.setup.length} setup</span>
        <span>{scenario.attack.length} attack</span>
        <span>{scenario.validation.length} validation</span>
      </div>
      <button
        onClick={() => onExecute(scenario.id)}
        disabled={executing}
        data-testid={`execute-${scenario.id}`}
      >
        {executing ? '执行中...' : '执行'}
      </button>
    </div>
  );
};

// ============ 执行历史 Tab ============

const ExecutionsTab: React.FC<{
  engine: SecurityAuditEngine;
  selectedExecution: string | null;
  setSelectedExecution: (id: string | null) => void;
}> = ({ engine, selectedExecution, setSelectedExecution }) => {
  const [statusFilter, setStatusFilter] = useState<ScenarioExecution['status'] | ''>('');
  const executions = engine.listExecutions(
    statusFilter ? { status: statusFilter as any } : {},
  );
  const detail = selectedExecution ? engine.getExecution(selectedExecution) : null;

  return (
    <div className="executions-tab">
      <div className="toolbar">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
        >
          <option value="">所有状态</option>
          <option value="running">运行中</option>
          <option value="completed">完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">取消</option>
        </select>
      </div>

      <div className="executions-list">
        {executions.length === 0 && <p className="empty">暂无执行</p>}
        {executions.map((e) => (
          <ExecutionRow
            key={e.id}
            execution={e}
            scenario={engine.getScenario(e.scenarioId)}
            selected={selectedExecution === e.id}
            onClick={() => setSelectedExecution(e.id)}
          />
        ))}
      </div>

      {detail && <ExecutionDetail execution={detail} engine={engine} />}
    </div>
  );
};

const ExecutionRow: React.FC<{
  execution: ScenarioExecution;
  scenario?: AttackScenario;
  selected: boolean;
  onClick: () => void;
}> = ({ execution, scenario, selected, onClick }) => {
  return (
    <div
      className={`execution-row ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div>
        <strong>{scenario?.name || execution.scenarioId}</strong>
        <span className={`status status-${execution.status}`}>{execution.status}</span>
      </div>
      <div className="outcome">
        <span title="blocked">🛡 {execution.outcome.blocked ? '✓' : '✗'}</span>
        <span title="alerted">🔔 {execution.outcome.alerted ? '✓' : '✗'}</span>
        <span title="audited">📋 {execution.outcome.audited ? '✓' : '✗'}</span>
      </div>
      <div className="timing">
        <span>{execution.durationMs}ms</span>
        <span>{new Date(execution.startTime).toLocaleString()}</span>
      </div>
    </div>
  );
};

const ExecutionDetail: React.FC<{
  execution: ScenarioExecution;
  engine: SecurityAuditEngine;
}> = ({ execution, engine }) => {
  const [responding, setResponding] = useState(false);
  const [incident, setIncident] = useState<IncidentResponse | null>(null);

  const handleTrigger = async () => {
    setResponding(true);
    try {
      const inc = await engine.triggerResponse(execution.scenarioId, execution.id);
      setIncident(inc);
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="execution-detail">
      <h3>执行详情: {execution.id}</h3>
      <p>状态: <span className={`status status-${execution.status}`}>{execution.status}</span></p>
      <p>耗时: {execution.durationMs}ms</p>
      <p>干运行: {execution.dryRun ? '是' : '否'}</p>

      <h4>步骤执行</h4>
      <ol className="step-list">
        {execution.steps.map((s) => (
          <li key={s.stepId} className={`step-item step-${s.status}`}>
            <span>{s.stepName}</span>
            <span>{s.action}</span>
            <span className="step-status">{s.status}</span>
            <span>{s.durationMs}ms</span>
          </li>
        ))}
      </ol>

      <h4>验证结果</h4>
      <ul className="validation-list">
        {execution.validations.map((v) => (
          <li
            key={v.validationId}
            className={`validation-item ${v.passed ? 'passed' : 'failed'}`}
            data-testid={`validation-${v.validationId}`}
          >
            <span>{v.passed ? '✓' : '✗'}</span>
            <span>{v.name}</span>
            <span>expected: {JSON.stringify(v.expected)}</span>
            <span>actual: {JSON.stringify(v.actual)}</span>
          </li>
        ))}
      </ul>

      {execution.status === 'failed' && !incident && (
        <button
          onClick={handleTrigger}
          disabled={responding}
          data-testid={`trigger-response-${execution.id}`}
        >
          {responding ? '启动中...' : '启动应急响应'}
        </button>
      )}

      {incident && (
        <div className="incident-result">
          <h4>应急响应 #{incident.id}</h4>
          <p>状态: {incident.status}</p>
          <p>严重度: {incident.severity}</p>
          <p>响应步骤数: {incident.steps.length}</p>
        </div>
      )}
    </div>
  );
};

// ============ 应急响应 Tab ============

const IncidentsTab: React.FC<{ engine: SecurityAuditEngine }> = ({ engine }) => {
  const [showClosed, setShowClosed] = useState(false);
  const incidents = showClosed
    ? engine.listIncidents()
    : engine.listActiveIncidents();

  return (
    <div className="incidents-tab">
      <div className="toolbar">
        <label>
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          显示已关闭
        </label>
      </div>

      <div className="incidents-list">
        {incidents.length === 0 && <p className="empty">暂无事件</p>}
        {incidents.map((inc) => (
          <div key={inc.id} className={`incident-item severity-${inc.severity}`}>
            <div className="incident-header">
              <strong>{inc.id}</strong>
              <span className={`status status-${inc.status}`}>{inc.status}</span>
              <span className={`severity-badge severity-${inc.severity}`}>
                {inc.severity}
              </span>
            </div>
            <p>场景: {inc.scenarioId}</p>
            <p>执行: {inc.executionId}</p>
            <p>步骤数: {inc.steps.length}</p>
            <p>开始: {new Date(inc.startTime).toLocaleString()}</p>
            {inc.endTime && <p>结束: {new Date(inc.endTime).toLocaleString()}</p>}
            {inc.status !== 'closed' && (
              <button onClick={() => engine.closeIncident(inc.id)}>关闭</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ 报告 Tab ============

const ReportsTab: React.FC<{ engine: SecurityAuditEngine }> = ({ engine }) => {
  const [period, setPeriod] = useState<{ from: string; to: string }>(() => {
    const now = Date.now();
    return {
      from: new Date(now - 24 * 3600 * 1000).toISOString().slice(0, 16),
      to: new Date(now).toISOString().slice(0, 16),
    };
  });
  const [format, setFormat] = useState<'json' | 'markdown' | 'html'>('markdown');
  const [report, setReport] = useState<SecurityAuditReport | null>(null);

  const handleGenerate = () => {
    const fromMs = new Date(period.from).getTime();
    const toMs = new Date(period.to).getTime();
    const r = engine.generateReport({ from: fromMs, to: toMs });
    setReport(r);
  };

  const handleExport = () => {
    const fromMs = new Date(period.from).getTime();
    const toMs = new Date(period.to).getTime();
    const content = engine.exportReport({ from: fromMs, to: toMs }, format);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security-audit.${format === 'markdown' ? 'md' : format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="reports-tab">
      <div className="toolbar">
        <input
          type="datetime-local"
          value={period.from}
          onChange={(e) => setPeriod({ ...period, from: e.target.value })}
        />
        <span>~</span>
        <input
          type="datetime-local"
          value={period.to}
          onChange={(e) => setPeriod({ ...period, to: e.target.value })}
        />
        <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
          <option value="json">JSON</option>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>
        <button onClick={handleGenerate}>生成</button>
        <button onClick={handleExport}>导出</button>
      </div>

      {report && (
        <div className="report-content">
          <h3>报告 #{report.id}</h3>
          <div className="report-stats">
            <span>总场景: {report.totalScenarios}</span>
            <span>通过: {report.passed}</span>
            <span>失败: {report.failed}</span>
            <span>阻断: {report.summary.blockedAttacks}</span>
            <span>未阻断: {report.summary.unblockedAttacks}</span>
          </div>
          <div className="report-compliance">
            <span>SOC 2: {report.compliance.soc2 ? '✓' : '✗'}</span>
            <span>GDPR: {report.compliance.gdpr ? '✓' : '✗'}</span>
            <span>ISO 27001: {report.compliance.iso27001 ? '✓' : '✗'}</span>
          </div>
          <h4>建议</h4>
          <ul>
            {report.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
