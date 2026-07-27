/**
 * # ============================================================
 * RulePanel - TRACE 规则管理面板（Cycle 7 P0-11）
 * # ============================================================
 * 核心作用：可视化展示和管理 TRACE 编译后的可执行规则
 * 设计要点：
 *   1. 顶部统计卡片：总规则/活跃/命中/违规
 *   2. 规则列表：tier 颜色 + scope 徽章 + hit/violation 计数
 *   3. 添加规则：自然语言 → 自动编译
 *   4. 操作：停用 / 删除 / 清空
 * 输入参数：onClose 回调
 * 输出结果：完整的 TRACE 规则管理 UI
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P0-11 初始化
 * ============================================================
 */

import React, { useState, useCallback } from 'react';
import { useRuleStore, type CompiledRule, type RuleScope } from '../hooks/useRuleStore';

export interface RulePanelProps {
  sessionId?: string;
  onClose?: () => void;
}

// ============================================================
// 辅助组件
// ============================================================
const TierBadge: React.FC<{ tier: 1 | 2 | 3 }> = ({ tier }) => {
  const config = {
    1: { color: 'bg-rose-100 text-rose-700 border-rose-300', label: 'T1 确定性' },
    2: { color: 'bg-amber-100 text-amber-700 border-amber-300', label: 'T2 语义' },
    3: { color: 'bg-blue-100 text-blue-700 border-blue-300', label: 'T3 意图' },
  }[tier];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${config.color} font-medium`}>
      {config.label}
    </span>
  );
};

const ScopeBadge: React.FC<{ scope: RuleScope }> = ({ scope }) => {
  const config = {
    session: { color: 'bg-purple-100 text-purple-700', label: 'Session' },
    user: { color: 'bg-emerald-100 text-emerald-700', label: 'User' },
    global: { color: 'bg-slate-200 text-slate-700', label: 'Global' },
  }[scope];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.color} font-medium`}>
      {config.label}
    </span>
  );
};

const ActionBadge: React.FC<{ action?: string }> = ({ action }) => {
  if (!action) return null;
  const config = {
    deny: { color: 'bg-red-100 text-red-700', icon: '🚫', label: '禁止' },
    require: { color: 'bg-emerald-100 text-emerald-700', icon: '✅', label: '要求' },
    prefer: { color: 'bg-blue-100 text-blue-700', icon: '💡', label: '建议' },
    style_check: { color: 'bg-amber-100 text-amber-700', icon: '🎨', label: '风格' },
  }[action] || { color: 'bg-slate-100 text-slate-700', icon: '•', label: action };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.color} font-medium`}>
      {config.icon} {config.label}
    </span>
  );
};

// ============================================================
// 主组件
// ============================================================
export const RulePanel: React.FC<RulePanelProps> = ({ sessionId = 'default', onClose }) => {
  const { rules, stats, loading, error, refetch, compileRule, deactivateRule, deleteRule, clearSession } =
    useRuleStore(sessionId);

  const [newRuleMessage, setNewRuleMessage] = useState('');
  const [newRuleScope, setNewRuleScope] = useState<RuleScope>('session');
  const [compileResult, setCompileResult] = useState<{ success: boolean; message: string; subject: string; confidence: number } | null>(null);
  const [filter, setFilter] = useState<'all' | RuleScope>('all');

  const handleAddRule = useCallback(async () => {
    if (!newRuleMessage.trim()) return;
    const result = await compileRule(newRuleMessage, { scope: newRuleScope, autoAdd: true });
    setCompileResult({
      success: result.success,
      message: result.message,
      subject: result.intent.subject,
      confidence: result.intent.confidence,
    });
    if (result.success && result.intent.is_correction) {
      setNewRuleMessage('');
    }
    setTimeout(() => setCompileResult(null), 4000);
  }, [newRuleMessage, newRuleScope, compileRule]);

  const handleClear = useCallback(async () => {
    if (confirm(`确定清空 session "${sessionId}" 的所有 session-scope 规则?`)) {
      const n = await clearSession();
      alert(`已清空 ${n} 条规则`);
    }
  }, [sessionId, clearSession]);

  const filteredRules = filter === 'all' ? rules : rules.filter(r => r.scope === filter);

  return (
    <div className="flex flex-col h-full max-h-[85vh] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b bg-gradient-to-r from-rose-50/50 to-amber-50/50">
        <div>
          <h2 className="text-base font-bold text-surface-800 flex items-center gap-2">
            <span className="text-lg">🛡️</span> TRACE 规则管理
          </h2>
          <p className="text-xs text-surface-500 mt-0.5">
            编译用户纠正为运行时强制规则 (Zhou et al. June 2026)
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-700 text-lg"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="px-5 py-3 border-b bg-surface-50/40">
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div className="bg-white/70 rounded-md p-2 border">
              <div className="text-surface-500">总规则</div>
              <div className="text-lg font-bold text-surface-800">{stats.total_rules}</div>
            </div>
            <div className="bg-white/70 rounded-md p-2 border">
              <div className="text-surface-500">活跃</div>
              <div className="text-lg font-bold text-emerald-600">{stats.active_rules}</div>
            </div>
            <div className="bg-white/70 rounded-md p-2 border">
              <div className="text-surface-500">命中</div>
              <div className="text-lg font-bold text-blue-600">{stats.total_hits}</div>
            </div>
            <div className="bg-white/70 rounded-md p-2 border">
              <div className="text-surface-500">违规</div>
              <div className="text-lg font-bold text-rose-600">{stats.total_violations}</div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-surface-600">
            <span>违规率: <span className="font-mono font-bold">{(stats.violation_rate * 100).toFixed(1)}%</span></span>
            <span>·</span>
            <span>T1: <span className="font-mono">{stats.by_tier[1] || 0}</span></span>
            <span>T2: <span className="font-mono">{stats.by_tier[2] || 0}</span></span>
            <span>T3: <span className="font-mono">{stats.by_tier[3] || 0}</span></span>
          </div>
        </div>
      )}

      {/* 添加规则 */}
      <div className="px-5 py-3 border-b bg-surface-50/30">
        <div className="text-xs font-semibold text-surface-700 mb-2">➕ 编译新规则</div>
        <div className="flex items-center gap-2">
          <select
            value={newRuleScope}
            onChange={(e) => setNewRuleScope(e.target.value as RuleScope)}
            className="text-xs px-2 py-1.5 border rounded-md bg-white"
          >
            <option value="session">Session</option>
            <option value="user">User</option>
            <option value="global">Global</option>
          </select>
          <input
            type="text"
            value={newRuleMessage}
            onChange={(e) => setNewRuleMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
            placeholder='例如: "不要使用全局变量"'
            className="flex-1 text-sm px-3 py-1.5 border rounded-md bg-white focus:border-rose-500 focus:outline-none"
          />
          <button
            onClick={handleAddRule}
            disabled={!newRuleMessage.trim() || loading}
            className="px-3 py-1.5 text-xs font-medium bg-rose-500 text-white rounded-md hover:bg-rose-600 disabled:bg-surface-300 disabled:cursor-not-allowed"
          >
            编译
          </button>
        </div>
        {compileResult && (
          <div
            className={`mt-2 text-xs px-3 py-1.5 rounded ${
              compileResult.success
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
          >
            {compileResult.success ? '✅' : '⚠️'} {compileResult.message}
            {compileResult.subject && ` (subject: ${compileResult.subject}, confidence: ${compileResult.confidence})`}
          </div>
        )}
      </div>

      {/* 工具栏 */}
      <div className="px-5 py-2 border-b flex items-center gap-2 text-xs">
        <button
          onClick={refetch}
          disabled={loading}
          className="px-2 py-1 text-surface-600 hover:text-surface-900 hover:bg-surface-100 rounded"
        >
          🔄 刷新
        </button>
        <div className="flex-1" />
        <span className="text-surface-500">过滤:</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | RuleScope)}
          className="text-xs px-2 py-1 border rounded bg-white"
        >
          <option value="all">全部</option>
          <option value="session">Session</option>
          <option value="user">User</option>
          <option value="global">Global</option>
        </select>
        <button
          onClick={handleClear}
          className="px-2 py-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded"
        >
          🗑️ 清空
        </button>
      </div>

      {/* 规则列表 */}
      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="text-center text-rose-600 text-sm py-4">⚠️ {error}</div>
        )}
        {loading && rules.length === 0 ? (
          <div className="text-center text-surface-500 text-sm py-8">加载中...</div>
        ) : filteredRules.length === 0 ? (
          <div className="text-center text-surface-500 text-sm py-8">
            <div className="text-3xl mb-2">📭</div>
            <div>暂无规则</div>
            <div className="text-xs mt-1">在上方输入框中添加用户纠正规则</div>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRules.map(rule => (
              <RuleCard
                key={rule.rule_id}
                rule={rule}
                onDeactivate={() => deactivateRule(rule.rule_id)}
                onDelete={() => deleteRule(rule.rule_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// RuleCard 子组件
// ============================================================
const RuleCard: React.FC<{
  rule: CompiledRule;
  onDeactivate: () => void;
  onDelete: () => void;
}> = ({ rule, onDeactivate, onDelete }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        rule.is_active
          ? 'bg-white/80 border-surface-300 hover:border-rose-300'
          : 'bg-surface-100/50 border-surface-200 opacity-60'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-surface-500 hover:text-surface-800 mt-0.5"
          aria-label={expanded ? '折叠' : '展开'}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <div className="flex-1 min-w-0">
          {/* 头部: 原始消息 + 徽章 */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <TierBadge tier={rule.tier} />
            <ScopeBadge scope={rule.scope} />
            <ActionBadge action={rule.rule_data.action} />
            <span className="text-[10px] text-surface-500 font-mono">{rule.rule_id.substring(0, 12)}</span>
            {!rule.is_active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-300 text-slate-700">
                已停用
              </span>
            )}
          </div>
          {/* 原始消息 */}
          <div className="text-sm text-surface-800 font-medium">
            "{rule.original_message}"
          </div>
          {/* 元数据 */}
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-surface-500">
            <span>📊 命中 <span className="font-mono font-bold text-blue-600">{rule.hit_count}</span></span>
            <span>❌ 违规 <span className="font-mono font-bold text-rose-600">{rule.violation_count}</span></span>
            <span>🎯 优先级 <span className="font-mono">{rule.priority}</span></span>
            <span>📅 {new Date(rule.created_at * 1000).toLocaleString()}</span>
          </div>
          {/* 展开详情 */}
          {expanded && (
            <div className="mt-2 pt-2 border-t border-surface-200 space-y-1 text-[11px] text-surface-600">
              <div><span className="text-surface-500">Subject:</span> <span className="font-mono">{rule.rule_data.subject}</span></div>
              <div><span className="text-surface-500">Check:</span> <span className="font-mono">{rule.rule_data.check}</span></div>
              <div><span className="text-surface-500">Tier Rationale:</span> {rule.rule_data.tier_rationale}</div>
              <div><span className="text-surface-500">Target:</span> {rule.rule_data.target}</div>
              <div><span className="text-surface-500">Category:</span> {rule.rule_data.category}</div>
            </div>
          )}
        </div>
        {/* 操作 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {rule.is_active ? (
            <button
              onClick={onDeactivate}
              className="text-[10px] px-2 py-1 text-amber-700 hover:bg-amber-50 rounded"
              title="停用规则"
            >
              停用
            </button>
          ) : null}
          <button
            onClick={onDelete}
            className="text-[10px] px-2 py-1 text-rose-600 hover:bg-rose-50 rounded"
            title="永久删除"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
};

export default RulePanel;
