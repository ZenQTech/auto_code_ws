/**
 * PolicyPanel - 策略规则面板
 * Cycle 32 G32-03
 *
 * 4 Tab 页：
 *   1. 策略列表 (Policies)
 *   2. 决策日志 (Decision Log)
 *   3. 模板 (Templates)
 *   4. 测试 (Test Cases)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  PolicyEngine,
  getDefaultPolicyEngine,
  type Policy,
  type PolicyDecision,
  type PolicyContext,
  type PolicyTemplate,
} from '../utils/policyEngine';

export interface PolicyPanelProps {
  engine?: PolicyEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'policies' | 'logs' | 'templates' | 'tests';

export const PolicyPanel: React.FC<PolicyPanelProps> = ({ engine: engineProp, isOpen, onClose }) => {

  // G60-FIX-13: 面板关闭时早返回，避免在 DOM 中堆积所有面板
  if (isOpen === false) return null;
  const engine = useMemo(() => engineProp || getDefaultPolicyEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('policies');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const events = ['policy-created', 'policy-updated', 'policy-deleted', 'policy-activated', 'policy-deactivated', 'policy-evaluated', 'test-completed', 'version-published'];
    const unsubs = events.map((evt) => engine.on(evt as any, () => setRefreshKey((k) => k + 1)));
    return () => { unsubs.forEach((u) => u()); };
  }, [engine]);

  return (
    <div className="policy-panel" data-testid="policy-panel">
      <div className="panel-header">
        <h2>策略规则 (Policy Engine)</h2>
        {onClose && <button onClick={onClose} aria-label="关闭">×</button>}
      </div>

      <div className="panel-tabs">
        <button className={tab === 'policies' ? 'active' : ''} onClick={() => setTab('policies')}>策略列表</button>
        <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>决策日志</button>
        <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>模板</button>
        <button className={tab === 'tests' ? 'active' : ''} onClick={() => setTab('tests')}>测试</button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'policies' && <PoliciesTab engine={engine} />}
        {tab === 'logs' && <LogsTab engine={engine} />}
        {tab === 'templates' && <TemplatesTab engine={engine} />}
        {tab === 'tests' && <TestsTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ 策略列表 Tab ============

const PoliciesTab: React.FC<{ engine: PolicyEngine }> = ({ engine }) => {
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [showEvaluate, setShowEvaluate] = useState(false);

  const policies = useMemo(() => {
    return engine.listPolicies(filterStatus ? { status: filterStatus as any } : undefined);
  }, [engine, filterStatus]);

  const metrics = engine.getMetrics();

  return (
    <div className="tab-policies" data-testid="policies-tab">
      <div className="metrics-row">
        <div className="metric-card">
          <div className="label">总策略</div>
          <div className="value">{metrics.totalPolicies}</div>
        </div>
        <div className="metric-card">
          <div className="label">激活中</div>
          <div className="value">{metrics.activePolicies}</div>
        </div>
        <div className="metric-card">
          <div className="label">总评估</div>
          <div className="value">{metrics.totalEvaluations}</div>
        </div>
        <div className="metric-card">
          <div className="label">允许</div>
          <div className="value success">{metrics.allowedCount}</div>
        </div>
        <div className="metric-card">
          <div className="label">拒绝</div>
          <div className="value danger">{metrics.deniedCount}</div>
        </div>
        <div className="metric-card">
          <div className="label">平均耗时</div>
          <div className="value">{metrics.averageEvaluationMs.toFixed(2)}ms</div>
        </div>
      </div>

      <div className="form-row">
        <label>状态过滤：</label>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">全部</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="deprecated">Deprecated</option>
          <option value="archived">Archived</option>
        </select>
        <button onClick={() => setShowEvaluate(true)} data-testid="show-evaluate">快速评估</button>
      </div>

      <div className="policy-list" data-testid="policy-list">
        {policies.length === 0 ? (
          <div className="empty">暂无策略</div>
        ) : (
          policies.map((p) => (
            <div key={p.id} className="policy-card" data-testid="policy-card" onClick={() => setSelectedPolicy(p)}>
              <div className="policy-header">
                <span className="policy-name">{p.name}</span>
                <span className={`policy-status status-${p.status}`}>{p.status}</span>
                <span className="policy-priority">P{p.priority}</span>
              </div>
              <div className="policy-meta">
                <span>v{p.version}</span>
                <span>{p.rules.length} 规则</span>
                <span>默认: {p.defaultEffect}</span>
                {p.tags && p.tags.length > 0 && <span>tags: {p.tags.join(', ')}</span>}
              </div>
              <div className="policy-actions">
                {p.status === 'draft' && <button onClick={(e) => { e.stopPropagation(); engine.activatePolicy(p.id); }}>激活</button>}
                {p.status === 'active' && <button onClick={(e) => { e.stopPropagation(); engine.deactivatePolicy(p.id); }}>停用</button>}
                {p.status !== 'archived' && <button onClick={(e) => { e.stopPropagation(); engine.archivePolicy(p.id); }}>归档</button>}
                <button onClick={(e) => { e.stopPropagation(); engine.deletePolicy(p.id); }} className="danger">删除</button>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedPolicy && <PolicyDetail policy={selectedPolicy} engine={engine} onClose={() => setSelectedPolicy(null)} />}
      {showEvaluate && <EvaluateModal engine={engine} onClose={() => setShowEvaluate(false)} />}
    </div>
  );
};

const PolicyDetail: React.FC<{ policy: Policy; engine: PolicyEngine; onClose: () => void }> = ({ policy, engine, onClose }) => {
  const versions = engine.listVersions(policy.id);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" data-testid="policy-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{policy.name}</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="detail-row"><strong>ID:</strong> {policy.id}</div>
          <div className="detail-row"><strong>Version:</strong> {policy.version}</div>
          <div className="detail-row"><strong>Priority:</strong> {policy.priority}</div>
          <div className="detail-row"><strong>Status:</strong> {policy.status}</div>
          <div className="detail-row"><strong>Default Effect:</strong> {policy.defaultEffect}</div>
          <div className="detail-row"><strong>Conflict Resolution:</strong> {policy.conflictResolution}</div>
          <div className="detail-row"><strong>Applies To:</strong> {policy.appliesTo.actions.join(', ')}</div>
          <h4>规则 ({policy.rules.length})</h4>
          {policy.rules.map((r) => (
            <div key={r.id} className="rule-detail">
              <div><strong>{r.name}</strong> ({r.effect})</div>
              <pre>{JSON.stringify(r.conditions, null, 2)}</pre>
            </div>
          ))}
          <h4>版本历史 ({versions.length})</h4>
          {versions.map((v) => (
            <div key={v.version} className="version-row">
              <span>v{v.version}</span>
              <span>{v.changelog || '(no changelog)'}</span>
              <span>{new Date(v.publishedAt).toLocaleString()}</span>
              <button onClick={() => engine.rollbackToVersion(policy.id, v.version)}>回滚</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const EvaluateModal: React.FC<{ engine: PolicyEngine; onClose: () => void }> = ({ engine, onClose }) => {
  const [action, setAction] = useState('agent.execute');
  const [userId, setUserId] = useState('user-1');
  const [decision, setDecision] = useState<PolicyDecision | null>(null);

  const handleEvaluate = () => {
    const context: PolicyContext = {
      user: {
        id: userId,
        email: `${userId}@example.com`,
        roles: ['developer'],
        groups: [],
      },
      action,
      resource: { type: 'agent', id: 'agent-1' },
      environment: { timestamp: Date.now() },
    };
    const result = engine.evaluate(context);
    setDecision(result);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" data-testid="evaluate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>快速评估</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>Action：</label>
            <input value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="form-row">
            <label>User ID：</label>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <button onClick={handleEvaluate} data-testid="run-evaluate">评估</button>
          {decision && (
            <div className="decision-result">
              <h4>结果</h4>
              <div className={`effect-badge effect-${decision.effect}`}>{decision.effect.toUpperCase()}</div>
              <pre>{JSON.stringify(decision, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============ 决策日志 Tab ============

const LogsTab: React.FC<{ engine: PolicyEngine }> = ({ engine }) => {
  const [effectFilter, setEffectFilter] = useState<string>('');
  const logs = engine.getDecisionLog(effectFilter ? { effect: effectFilter as any, limit: 200 } : { limit: 200 });

  return (
    <div className="tab-logs" data-testid="logs-tab">
      <div className="form-row">
        <label>Effect 过滤：</label>
        <select value={effectFilter} onChange={(e) => setEffectFilter(e.target.value)}>
          <option value="">全部</option>
          <option value="allow">allow</option>
          <option value="deny">deny</option>
          <option value="prompt">prompt</option>
        </select>
      </div>

      <div className="log-list">
        {logs.length === 0 ? (
          <div className="empty">暂无决策日志</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Effect</th>
                <th>策略数</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} data-testid="log-row">
                  <td>{new Date(l.timestamp).toLocaleString()}</td>
                  <td>{l.context.user.id}</td>
                  <td>{l.context.action}</td>
                  <td>{l.context.resource.type}/{l.context.resource.id}</td>
                  <td className={`effect-${l.decision.effect}`}>{l.decision.effect}</td>
                  <td>{l.decision.evaluatedPolicies}</td>
                  <td>{l.decision.evaluationDurationMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============ 模板 Tab ============

const TemplatesTab: React.FC<{ engine: PolicyEngine }> = ({ engine }) => {
  const templates = engine.listTemplates();
  const [selectedTemplate, setSelectedTemplate] = useState<PolicyTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, any>>({});

  const handleApply = () => {
    if (!selectedTemplate) return;
    try {
      const p = engine.applyTemplateAndActivate(selectedTemplate.id, variables);
      alert(`已应用模板: ${p.name}`);
      setSelectedTemplate(null);
      setVariables({});
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  return (
    <div className="tab-templates" data-testid="templates-tab">
      <div className="template-grid">
        {templates.map((t) => (
          <div key={t.id} className="template-card" data-testid="template-card" onClick={() => setSelectedTemplate(t)}>
            <div className="template-name">{t.name}</div>
            <div className="template-category">{t.category}</div>
            <div className="template-description">{t.description}</div>
            <div className="template-vars">
              {t.variables.length} 个变量
            </div>
          </div>
        ))}
      </div>

      {selectedTemplate && (
        <div className="modal-overlay" onClick={() => setSelectedTemplate(null)}>
          <div className="modal" data-testid="template-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>应用模板: {selectedTemplate.name}</h3>
              <button onClick={() => setSelectedTemplate(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>{selectedTemplate.description}</p>
              {selectedTemplate.variables.map((v) => (
                <div key={v.name} className="form-row">
                  <label>{v.name}{v.required && ' *'}：</label>
                  <input
                    type={v.type === 'number' ? 'number' : 'text'}
                    value={variables[v.name] ?? v.default ?? ''}
                    onChange={(e) => setVariables({ ...variables, [v.name]: v.type === 'number' ? parseFloat(e.target.value) : e.target.value })}
                    placeholder={String(v.default ?? '')}
                  />
                </div>
              ))}
              <button onClick={handleApply} data-testid="apply-template">应用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ 测试 Tab ============

const TestsTab: React.FC<{ engine: PolicyEngine }> = ({ engine }) => {
  const policies = engine.listPolicies();
  const [selectedPolicy, setSelectedPolicy] = useState<string>('');
  const [testResults, setTestResults] = useState<any>(null);

  const handleRun = () => {
    if (!selectedPolicy) return;
    const tcs = engine.listTestCases(selectedPolicy);
    if (tcs.length === 0) {
      alert('该策略无测试用例');
      return;
    }
    const result = engine.testPolicy(selectedPolicy, tcs);
    setTestResults(result);
  };

  const handleAddTest = () => {
    if (!selectedPolicy) return;
    const policy = engine.getPolicy(selectedPolicy);
    if (!policy) return;
    engine.createTestCase(selectedPolicy, {
      name: `Test ${policy.name}`,
      context: {
        user: { id: 'user-1', email: 'u@x.com', roles: ['developer'], groups: [] },
        action: 'agent.execute',
        resource: { type: 'agent', id: 'a1' },
        environment: { timestamp: Date.now() },
      },
      expectedEffect: 'allow',
    });
  };

  const tcs = selectedPolicy ? engine.listTestCases(selectedPolicy) : [];

  return (
    <div className="tab-tests" data-testid="tests-tab">
      <div className="form-row">
        <label>选择策略：</label>
        <select value={selectedPolicy} onChange={(e) => { setSelectedPolicy(e.target.value); setTestResults(null); }}>
          <option value="">-- 选择 --</option>
          {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={handleAddTest} disabled={!selectedPolicy}>添加用例</button>
        <button onClick={handleRun} disabled={!selectedPolicy} data-testid="run-tests">运行测试</button>
      </div>

      {tcs.length > 0 && (
        <div className="test-cases">
          <h3>测试用例 ({tcs.length})</h3>
          <ul>
            {tcs.map((tc) => (
              <li key={tc.id}>
                <span>{tc.name}</span>
                <span>期望: {tc.expectedEffect}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {testResults && (
        <div className="test-results" data-testid="test-results">
          <h3>测试结果</h3>
          <div className="result-summary">
            <span>总计: {testResults.total}</span>
            <span className="success">通过: {testResults.passed}</span>
            <span className="danger">失败: {testResults.failed}</span>
            <span>耗时: {testResults.durationMs}ms</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>测试名</th>
                <th>期望</th>
                <th>实际</th>
                <th>结果</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {testResults.results.map((r: any) => (
                <tr key={r.testCaseId}>
                  <td>{r.testName}</td>
                  <td>{r.expected}</td>
                  <td>{r.actual}</td>
                  <td className={r.passed ? 'success' : 'danger'}>{r.passed ? '✓' : '✗'}</td>
                  <td>{r.reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
