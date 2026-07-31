/**
 * # EdgeModelRouterPanel - 端云模型路由面板
 * # Cycle 34 G34-01
 * #
 * # 功能：
 * #   - 模型列表（端侧/云端 Tab 切换）
 * #   - 路由策略管理（3 大预置 + 自定义）
 * #   - Token 预算监控
 * #   - 路由历史与统计
 * #   - 路由测试
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  EdgeModelRouterEngine,
  getDefaultEdgeModelRouterEngine,
  type ModelRegistration,
  type RoutingPolicy,
  type RouteDecision,
} from '../utils/edgeModelRouterEngine';

export interface EdgeModelRouterPanelProps {
  engine?: EdgeModelRouterEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'models' | 'policies' | 'budget' | 'history';

export const EdgeModelRouterPanel: React.FC<EdgeModelRouterPanelProps> = ({
  engine: engineProp,
  isOpen: _isOpen,
  onClose,
}) => {
  const engine = useMemo(() => engineProp || getDefaultEdgeModelRouterEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('models');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const events = ['model-registered', 'model-unregistered', 'route-decided', 'policy-activated', 'fallback-triggered'];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const stats = useMemo(() => engine.getStats(), [engine, refreshKey]);

  return (
    <div className="edge-model-router-panel" data-testid="edge-model-router-panel">
      <div className="panel-header">
        <h2>端云模型路由 (Edge Model Router)</h2>
        {onClose && (
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
      </div>

      <div className="panel-stats">
        <span>总路由: {stats.totalRoutes}</span>
        <span>端侧: {stats.edgeRoutes}</span>
        <span>云端: {stats.cloudRoutes}</span>
        <span>平均成本: ${stats.avgCostPerRoute.toFixed(4)}</span>
        <span>Fallback: {stats.fallbackCount}</span>
      </div>

      <div className="panel-tabs">
        <button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>
          模型
        </button>
        <button className={tab === 'policies' ? 'active' : ''} onClick={() => setTab('policies')}>
          策略
        </button>
        <button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>
          预算
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          历史
        </button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'models' && <ModelsTab engine={engine} />}
        {tab === 'policies' && <PoliciesTab engine={engine} />}
        {tab === 'budget' && <BudgetTab engine={engine} />}
        {tab === 'history' && <HistoryTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ Models Tab ============

const ModelsTab: React.FC<{ engine: EdgeModelRouterEngine }> = ({ engine }) => {
  const [tier, setTier] = useState<'all' | 'edge' | 'cloud'>('all');
  const models = useMemo(() => {
    if (tier === 'all') return engine.listModels();
    return engine.listModels({ tier });
  }, [engine, tier]);

  return (
    <div className="models-tab">
      <div className="toolbar">
        <select value={tier} onChange={(e) => setTier(e.target.value as any)}>
          <option value="all">全部</option>
          <option value="edge">端侧</option>
          <option value="cloud">云端</option>
        </select>
        <span>共 {models.length} 个模型</span>
      </div>

      <div className="models-grid">
        {models.map((m) => (
          <ModelCard key={m.id} model={m} engine={engine} />
        ))}
      </div>
    </div>
  );
};

const ModelCard: React.FC<{ model: ModelRegistration; engine: EdgeModelRouterEngine }> = ({ model, engine }) => {
  return (
    <div className={`model-card ${model.enabled ? '' : 'disabled'}`} data-testid={`model-${model.id}`}>
      <div className="model-header">
        <h3>{model.name}</h3>
        <span className={`provider-badge provider-${model.provider}`}>{model.provider}</span>
      </div>
      <p className="model-endpoint">{model.endpoint}</p>
      <div className="model-stats">
        <span>上下文: {(model.contextWindow / 1000).toFixed(0)}K</span>
        <span>延迟: {model.avgLatencyMs}ms</span>
        <span>优先级: {model.priority}</span>
      </div>
      <div className="model-capabilities">
        <span>代码: {(model.capabilities.codeGeneration * 100).toFixed(0)}%</span>
        <span>推理: {(model.capabilities.reasoning * 100).toFixed(0)}%</span>
        <span>长文: {(model.capabilities.longContext * 100).toFixed(0)}%</span>
      </div>
      <div className="model-cost">
        <span>输入: ${model.costPerMillionTokens.input}/M</span>
        <span>输出: ${model.costPerMillionTokens.output}/M</span>
      </div>
      <button
        onClick={() => engine.enableModel(model.id, !model.enabled)}
        data-testid={`toggle-${model.id}`}
      >
        {model.enabled ? '禁用' : '启用'}
      </button>
    </div>
  );
};

// ============ Policies Tab ============

const PoliciesTab: React.FC<{ engine: EdgeModelRouterEngine }> = ({ engine }) => {
  const policies = engine.listPolicies();
  const activePolicyId = engine.getActivePolicy().id;

  return (
    <div className="policies-tab">
      <h3>路由策略 ({policies.length})</h3>
      <div className="policies-list">
        {policies.map((p) => (
          <PolicyCard
            key={p.id}
            policy={p}
            active={p.id === activePolicyId}
            engine={engine}
          />
        ))}
      </div>
    </div>
  );
};

const PolicyCard: React.FC<{ policy: RoutingPolicy; active: boolean; engine: EdgeModelRouterEngine }> = ({ policy, active, engine }) => {
  return (
    <div className={`policy-card ${active ? 'active' : ''}`} data-testid={`policy-${policy.id}`}>
      <div className="policy-header">
        <h4>{policy.name}</h4>
        <span className={`mode-badge mode-${policy.mode}`}>{policy.mode}</span>
      </div>
      <p>{policy.description}</p>
      <div className="policy-meta">
        <span>隐私阈值: Tier {policy.privacyThreshold}</span>
        {policy.capabilities.minReasoning && <span>推理 ≥ {policy.capabilities.minReasoning}</span>}
      </div>
      {!active && (
        <button onClick={() => engine.setActivePolicy(policy.id)} data-testid={`activate-${policy.id}`}>
          激活
        </button>
      )}
      {active && <span className="active-badge">当前激活</span>}
    </div>
  );
};

// ============ Budget Tab ============

const BudgetTab: React.FC<{ engine: EdgeModelRouterEngine }> = ({ engine }) => {
  const cfg = engine.getBudgetConfig();
  const requestUsage = engine.getBudgetUsage('request');
  const dailyUsage = engine.getBudgetUsage('daily');

  return (
    <div className="budget-tab">
      <h3>Token 预算</h3>
      <div className="budget-section">
        <h4>单次请求</h4>
        <p>最大 Tokens: {cfg.perRequest.maxTokens.toLocaleString()}</p>
        <p>最大成本: ${cfg.perRequest.maxCostUsd}</p>
        <p>当前使用: ${requestUsage.used.toFixed(4)}</p>
        <p>剩余: ${requestUsage.remaining.toFixed(4)}</p>
      </div>
      <div className="budget-section">
        <h4>单日累计</h4>
        <p>最大 Tokens: {cfg.perDay.maxTokens.toLocaleString()}</p>
        <p>最大成本: ${cfg.perDay.maxCostUsd}</p>
        <p>当前使用: ${dailyUsage.used.toFixed(4)}</p>
        <p>剩余: ${dailyUsage.remaining.toFixed(4)}</p>
      </div>
      <div className="budget-section">
        <h4>超限策略</h4>
        <p>当前: {cfg.onExceeded}</p>
        <button onClick={() => engine.resetBudget('daily')} data-testid="reset-daily">
          重置单日预算
        </button>
      </div>
    </div>
  );
};

// ============ History Tab ============

const HistoryTab: React.FC<{ engine: EdgeModelRouterEngine }> = ({ engine }) => {
  const [tier, setTier] = useState<'all' | 'edge' | 'cloud'>('all');
  const history = useMemo(() => {
    return tier === 'all'
      ? engine.getRouteHistory({ limit: 50 })
      : engine.getRouteHistory({ tier: tier === 'edge' ? 'edge' : 'cloud', limit: 50 });
  }, [engine, tier]);

  return (
    <div className="history-tab">
      <div className="toolbar">
        <select value={tier} onChange={(e) => setTier(e.target.value as any)}>
          <option value="all">全部</option>
          <option value="edge">端侧</option>
          <option value="cloud">云端</option>
        </select>
        <span>最近 {history.length} 条</span>
      </div>
      <div className="history-list">
        {history.length === 0 && <p className="empty">暂无历史</p>}
        {history.map((d) => (
          <DecisionRow key={d.id} decision={d} />
        ))}
      </div>
    </div>
  );
};

const DecisionRow: React.FC<{ decision: RouteDecision }> = ({ decision }) => {
  return (
    <div className="decision-row" data-testid={`decision-${decision.id}`}>
      <div>
        <strong>{decision.selectedModel.name}</strong>
        <span className={`tier-badge tier-${decision.selectedTier}`}>{decision.selectedTier}</span>
        {decision.fallbackApplied && <span className="fallback-badge">fallback</span>}
      </div>
      <div className="decision-meta">
        <span>${decision.estimatedCost.toFixed(4)}</span>
        <span>{decision.estimatedLatencyMs}ms</span>
        <span>{new Date(decision.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
};

export default EdgeModelRouterPanel;
