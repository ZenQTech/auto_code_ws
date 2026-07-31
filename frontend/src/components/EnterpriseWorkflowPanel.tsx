/**
 * EnterpriseWorkflowPanel - 企业全场景工作流面板
 * Cycle 33 G33-01
 *
 * 功能：
 *   - 场景列表
 *   - 场景注册/编辑/删除
 *   - 工作流执行/暂停/恢复/取消
 *   - 执行历史
 *   - 审批流
 *   - 引擎注册
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  EnterpriseWorkflowEngine,
  getDefaultEnterpriseWorkflowEngine,
  type WorkflowScenario,
  type WorkflowExecution,
  type WorkflowStep,
} from '../utils/enterpriseWorkflowEngine';

export interface EnterpriseWorkflowPanelProps {
  engine?: EnterpriseWorkflowEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'scenarios' | 'executions' | 'engines' | 'approvals';

export const EnterpriseWorkflowPanel: React.FC<EnterpriseWorkflowPanelProps> = ({
  engine: engineProp,
  isOpen: _isOpen,
  onClose,
}) => {
  const engine = useMemo(() => engineProp || getDefaultEnterpriseWorkflowEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('scenarios');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);

  useEffect(() => {
    const events = [
      'scenario-registered',
      'scenario-updated',
      'execution-started',
      'execution-completed',
      'execution-failed',
      'step-awaiting-approval',
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
    <div className="enterprise-workflow-panel" data-testid="enterprise-workflow-panel">
      <div className="panel-header">
        <h2>企业全场景工作流 (Enterprise Workflow)</h2>
        {onClose && (
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
      </div>

      <div className="panel-stats">
        <span>场景: {stats.totalScenarios}</span>
        <span>执行: {stats.totalExecutions}</span>
        <span>成功率: {(stats.successRate * 100).toFixed(0)}%</span>
        <span>平均耗时: {Math.round(stats.averageDurationMs)}ms</span>
        <span>引擎: {stats.registeredEngines}</span>
      </div>

      <div className="panel-tabs">
        <button
          className={tab === 'scenarios' ? 'active' : ''}
          onClick={() => setTab('scenarios')}
        >
          场景
        </button>
        <button
          className={tab === 'executions' ? 'active' : ''}
          onClick={() => setTab('executions')}
        >
          执行历史
        </button>
        <button
          className={tab === 'engines' ? 'active' : ''}
          onClick={() => setTab('engines')}
        >
          引擎
        </button>
        <button
          className={tab === 'approvals' ? 'active' : ''}
          onClick={() => setTab('approvals')}
        >
          待审批
        </button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'scenarios' && (
          <ScenariosTab
            engine={engine}
            selectedScenario={selectedScenario}
            setSelectedScenario={setSelectedScenario}
            onExecute={(id) => engine.execute(id)}
          />
        )}
        {tab === 'executions' && (
          <ExecutionsTab
            engine={engine}
            selectedExecution={selectedExecution}
            setSelectedExecution={setSelectedExecution}
          />
        )}
        {tab === 'engines' && <EnginesTab engine={engine} />}
        {tab === 'approvals' && <ApprovalsTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ 场景 Tab ============

const ScenariosTab: React.FC<{
  engine: EnterpriseWorkflowEngine;
  selectedScenario: string | null;
  setSelectedScenario: (id: string | null) => void;
  onExecute: (id: string) => Promise<WorkflowExecution>;
}> = ({ engine, selectedScenario, setSelectedScenario, onExecute }) => {
  const [filter, setFilter] = useState<{ category?: WorkflowScenario['category'] }>({});
  const [showNew, setShowNew] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'custom' as WorkflowScenario['category'],
    steps: '',
  });

  const scenarios = useMemo(
    () => engine.listScenarios(filter),
    [engine, filter],
  );

  const handleCreate = () => {
    if (!formData.name) return;
    try {
      const steps: WorkflowStep[] = JSON.parse(formData.steps);
      const sc = engine.registerScenario({
        name: formData.name,
        description: formData.description,
        category: formData.category as WorkflowScenario['category'],
        version: '1.0.0',
        steps,
      });
      setSelectedScenario(sc.id);
      setShowNew(false);
      setFormData({ name: '', description: '', category: 'custom', steps: '' });
    } catch (e) {
      console.error('Create scenario failed:', e);
    }
  };

  return (
    <div className="scenarios-tab">
      <div className="toolbar">
        <select
          value={filter.category || ''}
          onChange={(e) => setFilter({ category: (e.target.value || undefined) as WorkflowScenario['category'] })}
        >
          <option value="">所有分类</option>
          <option value="onboarding">入职</option>
          <option value="review">审查</option>
          <option value="compliance">合规</option>
          <option value="security">安全</option>
          <option value="task">任务</option>
          <option value="custom">自定义</option>
        </select>
        <button onClick={() => setShowNew(!showNew)}>+ 新建场景</button>
        <button onClick={() => engine.loadPresetScenarios()}>加载预置</button>
      </div>

      {showNew && (
        <div className="new-scenario-form">
          <input
            placeholder="场景名称"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <input
            placeholder="描述"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <select
            value={formData.category}
            onChange={(e) =>
              setFormData({ ...formData, category: e.target.value as any })
            }
          >
            <option value="custom">自定义</option>
            <option value="onboarding">入职</option>
            <option value="review">审查</option>
            <option value="compliance">合规</option>
            <option value="security">安全</option>
            <option value="task">任务</option>
          </select>
          <textarea
            placeholder='步骤 JSON, e.g. [{"id":"s1","name":"S1","type":"engine","engineId":"audit","method":"log"}]'
            value={formData.steps}
            onChange={(e) => setFormData({ ...formData, steps: e.target.value })}
            rows={4}
          />
          <button onClick={handleCreate}>创建</button>
        </div>
      )}

      <div className="scenario-list">
        {scenarios.length === 0 && <p className="empty">暂无场景</p>}
        {scenarios.map((sc) => (
          <div
            key={sc.id}
            className={`scenario-item ${selectedScenario === sc.id ? 'selected' : ''}`}
            onClick={() => setSelectedScenario(sc.id)}
          >
            <div className="scenario-info">
              <strong>{sc.name}</strong>
              <span className="badge">{sc.category}</span>
              <span className="version">v{sc.version}</span>
            </div>
            <p className="scenario-desc">{sc.description}</p>
            <div className="scenario-actions">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExecute(sc.id);
                }}
                data-testid={`execute-scenario-${sc.id}`}
              >
                执行
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  engine.deleteScenario(sc.id);
                  if (selectedScenario === sc.id) setSelectedScenario(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ 执行历史 Tab ============

const ExecutionsTab: React.FC<{
  engine: EnterpriseWorkflowEngine;
  selectedExecution: string | null;
  setSelectedExecution: (id: string | null) => void;
}> = ({ engine, selectedExecution, setSelectedExecution }) => {
  const [filter, setFilter] = useState<{ status?: WorkflowExecution['status'] }>({});
  const executions = useMemo(() => engine.listExecutions(filter), [engine, filter]);

  const detail = selectedExecution ? engine.getExecution(selectedExecution) : null;

  return (
    <div className="executions-tab">
      <div className="toolbar">
        <select
          value={filter.status || ''}
          onChange={(e) => setFilter({ status: (e.target.value || undefined) as any })}
        >
          <option value="">所有状态</option>
          <option value="running">运行中</option>
          <option value="completed">完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">取消</option>
        </select>
      </div>

      <div className="executions-list">
        {executions.length === 0 && <p className="empty">暂无执行记录</p>}
        {executions.map((e) => (
          <div
            key={e.id}
            className={`execution-item ${selectedExecution === e.id ? 'selected' : ''}`}
            onClick={() => setSelectedExecution(e.id)}
          >
            <div>
              <strong>{e.scenarioId}</strong>
              <span className={`status status-${e.status}`}>{e.status}</span>
            </div>
            <span className="duration">{e.durationMs}ms</span>
            <span className="start-time">
              {new Date(e.startTime).toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {detail && (
        <div className="execution-detail">
          <h3>执行详情: {detail.id}</h3>
          <p>状态: {detail.status}</p>
          <p>耗时: {detail.durationMs}ms</p>
          <p>变量: {JSON.stringify(detail.variables)}</p>
          <h4>步骤执行</h4>
          <ol>
            {detail.stepExecutions.map((s) => (
              <li key={s.id}>
                {s.stepName} - {s.status} - {s.durationMs}ms
              </li>
            ))}
          </ol>
          <h4>日志</h4>
          <pre>{engine.getExecutionLog(detail.id).map((l) => `[${l.level}] ${l.message}`).join('\n')}</pre>
        </div>
      )}
    </div>
  );
};

// ============ 引擎 Tab ============

const EnginesTab: React.FC<{ engine: EnterpriseWorkflowEngine }> = ({ engine }) => {
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ id: '', method: 'log', returnValue: '{ logged: true }' });
  const engines = engine.listEngines();

  const handleRegister = () => {
    if (!form.id) return;
    try {
      const methods: Record<string, () => any> = {};
      const fn = new Function('return ' + form.returnValue);
      methods[form.method] = () => fn();
      engine.registerEngine(form.id, methods as any);
      setShowRegister(false);
      setForm({ id: '', method: 'log', returnValue: '{ logged: true }' });
    } catch (e) {
      console.error('Register engine failed:', e);
    }
  };

  return (
    <div className="engines-tab">
      <div className="toolbar">
        <button onClick={() => setShowRegister(!showRegister)}>+ 注册引擎</button>
      </div>

      {showRegister && (
        <div className="register-form">
          <input
            placeholder="引擎 ID"
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
          />
          <input
            placeholder="方法名"
            value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value })}
          />
          <input
            placeholder="返回值 (JS 表达式)"
            value={form.returnValue}
            onChange={(e) => setForm({ ...form, returnValue: e.target.value })}
          />
          <button onClick={handleRegister}>注册</button>
        </div>
      )}

      <div className="engines-list">
        {engines.length === 0 && <p className="empty">暂无已注册引擎</p>}
        {engines.map((id) => (
          <div key={id} className="engine-item">
            <strong>{id}</strong>
            <button
              onClick={() => engine.unregisterEngine(id)}
              disabled={['sso', 'audit', 'policy'].includes(id)}
            >
              注销
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ 待审批 Tab ============

const ApprovalsTab: React.FC<{ engine: EnterpriseWorkflowEngine }> = ({ engine }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [userId, setUserId] = useState('default-user');
  const pending = useMemo(
    () => engine.listPendingApprovals(userId),
    [engine, userId, refreshKey],
  );

  useEffect(() => {
    const unsub = engine.on('step-awaiting-approval', () => setRefreshKey((k) => k + 1));
    return () => {
      unsub();
    };
  }, [engine]);

  return (
    <div className="approvals-tab">
      <div className="toolbar">
        <input
          placeholder="用户 ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
      </div>
      <h3>待审批步骤 ({pending.length})</h3>
      {pending.length === 0 && <p className="empty">暂无待审批</p>}
      {pending.map((p) => {
        const executionId = engine.listExecutions().find((e) =>
          e.stepExecutions.some((s) => s.id === p.id),
        )?.id;
        if (!executionId) return null;
        return (
          <div key={p.id} className="approval-item">
            <div>
              <strong>{p.stepName}</strong>
              <span>执行: {executionId}</span>
            </div>
            <div className="approval-actions">
              <button
                onClick={() => engine.approveStep(executionId, p.stepId, userId, '')}
                data-testid={`approve-${executionId}-${p.stepId}`}
              >
                批准
              </button>
              <button onClick={() => engine.rejectStep(executionId, p.stepId, userId, '管理员拒绝')}>
                拒绝
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
