/**
 * # ============================================================
 * # Smart Approval Panel - 智能审批引擎 UI 组件 (v1.0.0 Cycle 26 G26-02)
 * # ============================================================
 * # 核心作用：提供智能审批规则管理与请求测试的图形化界面
 * # 主要功能：
 * #   1. 规则列表展示（系统/用户分类，启用/禁用）
 * #   2. 添加 / 编辑 / 删除 / 切换规则
 * #   3. 操作请求沙盒测试（输入命令 -> 查看决策）
 * #   4. 审计日志查看与导出
 * #   5. 快捷键：Esc / Ctrl+N / Ctrl+T / Ctrl+E
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-02 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getDefaultSmartApprovalEngine,
} from '../utils/smartApprovalEngine';
import {
  SmartApprovalRule,
  ApprovalDecision,
  Decision,
  ActionType,
  MatchType,
  ACTION_TYPE_LABELS,
  ACTION_TYPE_ICONS,
  MATCH_TYPE_LABELS,
  DECISION_LABELS,
  DECISION_ICONS,
  DECISION_COLORS,
} from '../utils/smartApprovalTypes';

interface SmartApprovalPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'hermes.smartApprovalPanel';
const SAMPLE_COMMANDS = [
  { label: '🟢 git status', actionType: 'shell' as ActionType, payload: 'git status' },
  { label: '🟢 ls -la', actionType: 'shell' as ActionType, payload: 'ls -la' },
  { label: '🔴 rm -rf /tmp', actionType: 'shell' as ActionType, payload: 'rm -rf /tmp' },
  { label: '🔴 sudo apt install', actionType: 'shell' as ActionType, payload: 'sudo apt install vim' },
  { label: '🟡 npm test', actionType: 'shell' as ActionType, payload: 'npm test' },
  { label: '🟡 curl example.com', actionType: 'network' as ActionType, payload: 'curl https://example.com' },
];

export function SmartApprovalPanel({ isOpen, onClose }: SmartApprovalPanelProps) {
  const engine = useMemo(() => getDefaultSmartApprovalEngine(), []);
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  // 状态
  const [tab, setTab] = useState<'rules' | 'sandbox' | 'audit'>('rules');
  const [filter, setFilter] = useState<'all' | 'system' | 'user'>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  // 编辑规则（未来功能）：保留状态以备后续使用
  // 保留为未来编辑功能状态（变量未使用前缀 _ 以避免 unused 警告）
  const [, setEditingRule] = useState<SmartApprovalRule | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // 沙盒测试
  const [testActionType, setTestActionType] = useState<ActionType>('shell');
  const [testPayload, setTestPayload] = useState<string>('');
  const [testResult, setTestResult] = useState<ApprovalDecision | null>(null);

  // 新规则表单
  const [newRule, setNewRule] = useState({
    name: '',
    description: '',
    actionType: 'shell' as ActionType,
    matchType: 'contains' as MatchType,
    matchValue: '',
    decision: 'block' as Decision,
    reason: '',
    priority: 50,
  });

  // 订阅事件
  useEffect(() => {
    if (!isOpen) return;
    const offs: Array<() => void> = [];
    offs.push(engine.on('rule-added', refresh));
    offs.push(engine.on('rule-updated', refresh));
    offs.push(engine.on('rule-removed', refresh));
    offs.push(engine.on('rule-toggled', refresh));
    offs.push(engine.on('decision-made', refresh));
    offs.push(engine.on('override', refresh));
    return () => offs.forEach((off) => off());
  }, [isOpen, engine, refresh]);

  // 恢复配置
  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.tab) setTab(cfg.tab);
        if (cfg.filter) setFilter(cfg.filter);
      }
    } catch {
      // ignore
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, filter }));
  }, [isOpen, tab, filter]);

  // 快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAddDialog) {
          setShowAddDialog(false);
        } else {
          onClose();
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowAddDialog(true);
      } else if (e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTab('sandbox');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        handleExportAudit();
      } else if (e.key === '?') {
        e.preventDefault();
        setShowHelp((s) => !s);
      } else if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setTab('rules');
      } else if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setTab('sandbox');
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setTab('audit');
      }
    };
    document.body.addEventListener('keydown', handler);
    return () => document.body.removeEventListener('keydown', handler);
  }, [isOpen, showAddDialog, tab]);

  if (!isOpen) return null;

  // ============ 操作 ============

  const handleToggleRule = (ruleId: string, enabled: boolean) => {
    engine.toggleRule(ruleId, enabled);
  };

  const handleRemoveRule = (ruleId: string) => {
    if (window.confirm('确定删除该规则吗？')) {
      engine.removeRule(ruleId);
    }
  };

  const handleAddRule = () => {
    if (!newRule.name || !newRule.matchValue) {
      window.alert('请填写规则名称和匹配值');
      return;
    }
    try {
      engine.addRule({
        name: newRule.name,
        description: newRule.description,
        actionTypes: [newRule.actionType],
        match: { type: newRule.matchType, value: newRule.matchValue } as any,
        decision: newRule.decision,
        reason: newRule.reason || `用户自定义规则: ${newRule.name}`,
        priority: newRule.priority,
        enabled: true,
        tags: ['user'],
        author: 'user',
      });
      setShowAddDialog(false);
      setNewRule({
        name: '',
        description: '',
        actionType: 'shell',
        matchType: 'contains',
        matchValue: '',
        decision: 'block',
        reason: '',
        priority: 50,
      });
    } catch (err) {
      window.alert(`添加失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTest = () => {
    if (!testPayload) return;
    const result = engine.request(testActionType, testPayload, undefined, 'user');
    setTestResult(result);
  };

  const handleTestSample = (actionType: ActionType, payload: string) => {
    setTestActionType(actionType);
    setTestPayload(payload);
    const result = engine.request(actionType, payload, undefined, 'user');
    setTestResult(result);
  };

  const handleClearAudit = () => {
    if (window.confirm('确定清空所有审计日志吗？')) {
      engine.clearAuditLog();
    }
  };

  const handleExportAudit = () => {
    const json = engine.exportAuditLog();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-approval-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetToBuiltins = () => {
    if (window.confirm('确定重置为内置规则吗？所有用户规则将丢失。')) {
      engine.resetToBuiltins();
    }
  };

  // ============ 渲染 ============

  const allRules = engine.getAllRules();
  const filteredRules = allRules.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'system') return r.author === 'system';
    if (filter === 'user') return r.author === 'user';
    return true;
  }).sort((a, b) => b.priority - a.priority);

  const auditLog = engine.getAuditLog();
  const stats = engine.getStats();

  return (
    <div
      data-testid="smart-approval-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        data-testid="smart-approval-content"
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛡️</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              智能审批引擎
            </h2>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">
              v1.0.0
            </span>
            <span className="text-xs text-slate-500">
              规则 {stats.rules} | 审计 {auditLog.length}
            </span>
          </div>
          <button
            data-testid="close-btn"
            onClick={onClose}
            className="px-3 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button
            data-testid="tab-rules"
            onClick={() => setTab('rules')}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'rules'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            📋 规则管理 ({allRules.length})
          </button>
          <button
            data-testid="tab-sandbox"
            onClick={() => setTab('sandbox')}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'sandbox'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            🧪 沙盒测试
          </button>
          <button
            data-testid="tab-audit"
            onClick={() => setTab('audit')}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'audit'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            📜 审计日志 ({auditLog.length})
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {tab === 'rules' && (
            <div className="space-y-4">
              <div className="flex gap-2 items-center">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as 'all' | 'system' | 'user')}
                  className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                  data-testid="rule-filter"
                >
                  <option value="all">全部 ({allRules.length})</option>
                  <option value="system">系统规则 ({allRules.filter((r) => r.author === 'system').length})</option>
                  <option value="user">用户规则 ({allRules.filter((r) => r.author === 'user').length})</option>
                </select>
                <button
                  data-testid="add-rule-btn"
                  onClick={() => setShowAddDialog(true)}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  ➕ 新增规则
                </button>
                <button
                  onClick={handleResetToBuiltins}
                  className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300"
                >
                  🔄 重置为内置
                </button>
              </div>
              <div className="space-y-2">
                {filteredRules.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">无规则</div>
                ) : (
                  filteredRules.map((rule) => (
                    <div
                      key={rule.id}
                      data-testid="rule-card"
                      className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="px-2 py-0.5 rounded text-xs font-mono text-white"
                              style={{ background: DECISION_COLORS[rule.decision] }}
                            >
                              {DECISION_ICONS[rule.decision]} {DECISION_LABELS[rule.decision]}
                            </span>
                            <span className="text-xs text-slate-500">
                              优先级 {rule.priority}
                            </span>
                            {rule.author === 'system' && (
                              <span className="text-xs px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded">
                                系统
                              </span>
                            )}
                            {rule.author === 'user' && (
                              <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                用户
                              </span>
                            )}
                          </div>
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {rule.name}
                          </div>
                          {rule.description && (
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {rule.description}
                            </div>
                          )}
                          <div className="text-xs text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                            <div>
                              作用操作：
                              {rule.actionTypes.map((a) => (
                                <span key={a} className="ml-1 px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs">
                                  {ACTION_TYPE_ICONS[a]} {ACTION_TYPE_LABELS[a]}
                                </span>
                              ))}
                            </div>
                            <div>
                              匹配：<code className="px-1 bg-slate-200 dark:bg-slate-700 rounded text-xs">
                                {JSON.stringify(rule.match)}
                              </code>
                            </div>
                            <div className="text-slate-500">原因：{rule.reason}</div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 ml-2">
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={(e) => handleToggleRule(rule.id, e.target.checked)}
                              data-testid="rule-toggle"
                            />
                            启用
                          </label>
                          <button
                            data-testid="rule-delete"
                            onClick={() => handleRemoveRule(rule.id)}
                            className="px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === 'sandbox' && (
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  🧪 测试操作请求
                </h3>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={testActionType}
                      onChange={(e) => setTestActionType(e.target.value as ActionType)}
                      className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                      data-testid="test-action-type"
                    >
                      {Object.entries(ACTION_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={testPayload}
                      onChange={(e) => setTestPayload(e.target.value)}
                      placeholder="输入要测试的命令或操作..."
                      className="flex-1 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                      data-testid="test-payload"
                    />
                    <button
                      onClick={handleTest}
                      className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                      data-testid="test-btn"
                    >
                      ▶️ 测试
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-slate-500">快速测试:</span>
                    {SAMPLE_COMMANDS.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => handleTestSample(s.actionType, s.payload)}
                        className="px-2 py-0.5 text-xs bg-slate-200 dark:bg-slate-700 rounded hover:bg-slate-300"
                        data-testid="sample-cmd"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                {testResult && (
                  <div
                    data-testid="test-result"
                    className="mt-3 p-3 rounded border-2"
                    style={{ borderColor: DECISION_COLORS[testResult.decision] }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-mono text-white"
                        style={{ background: DECISION_COLORS[testResult.decision] }}
                      >
                        {DECISION_ICONS[testResult.decision]} {DECISION_LABELS[testResult.decision]}
                      </span>
                      <span className="text-xs text-slate-500">
                        耗时 {testResult.duration.toFixed(2)}ms
                      </span>
                      {testResult.ruleId && (
                        <span className="text-xs text-slate-500">
                          规则: {testResult.ruleId}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-300">
                      {testResult.reason}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-4">
              <div className="flex gap-2 items-center">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  共 {auditLog.length} 条审计记录
                </span>
                <button
                  onClick={handleExportAudit}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                  data-testid="export-audit-btn"
                >
                  📥 导出 JSON
                </button>
                <button
                  onClick={handleClearAudit}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                  data-testid="clear-audit-btn"
                >
                  🗑️ 清空
                </button>
              </div>
              <div className="space-y-2">
                {auditLog.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">无审计记录</div>
                ) : (
                  auditLog.slice().reverse().slice(0, 100).map((log) => (
                    <div
                      key={log.id}
                      data-testid="audit-log-item"
                      className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-mono text-white"
                          style={{ background: DECISION_COLORS[log.decision.decision] }}
                        >
                          {DECISION_ICONS[log.decision.decision]} {DECISION_LABELS[log.decision.decision]}
                        </span>
                        <span className="text-xs text-slate-500">
                          {ACTION_TYPE_ICONS[log.request.actionType]} {ACTION_TYPE_LABELS[log.request.actionType]}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                        {log.decision.overridden && (
                          <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
                            已覆盖
                          </span>
                        )}
                      </div>
                      <code className="text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1 rounded block overflow-x-auto">
                        {log.request.payload}
                      </code>
                      <div className="text-xs text-slate-500 mt-1">{log.decision.reason}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Add Rule Dialog */}
        {showAddDialog && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowAddDialog(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl p-6 max-w-2xl w-full"
              onClick={(e) => e.stopPropagation()}
              data-testid="add-rule-dialog"
            >
              <h3 className="text-lg font-bold mb-4">➕ 新增审批规则</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-slate-600 dark:text-slate-400">规则名称</label>
                  <input
                    type="text"
                    value={newRule.name}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    data-testid="new-rule-name"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 dark:text-slate-400">描述</label>
                  <input
                    type="text"
                    value={newRule.description}
                    onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                    className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm text-slate-600 dark:text-slate-400">作用操作</label>
                    <select
                      value={newRule.actionType}
                      onChange={(e) => setNewRule({ ...newRule, actionType: e.target.value as ActionType })}
                      className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    >
                      {Object.entries(ACTION_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-slate-600 dark:text-slate-400">匹配类型</label>
                    <select
                      value={newRule.matchType}
                      onChange={(e) => setNewRule({ ...newRule, matchType: e.target.value as MatchType })}
                      className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    >
                      {Object.entries(MATCH_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-slate-600 dark:text-slate-400">匹配值</label>
                  <input
                    type="text"
                    value={newRule.matchValue}
                    onChange={(e) => setNewRule({ ...newRule, matchValue: e.target.value })}
                    placeholder="如: rm -rf, sudo , https://api.example.com"
                    className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    data-testid="new-rule-match-value"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm text-slate-600 dark:text-slate-400">决策</label>
                    <select
                      value={newRule.decision}
                      onChange={(e) => setNewRule({ ...newRule, decision: e.target.value as Decision })}
                      className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    >
                      {Object.entries(DECISION_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-slate-600 dark:text-slate-400">优先级 (0-100)</label>
                    <input
                      type="number"
                      value={newRule.priority}
                      onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value, 10) || 50 })}
                      className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-slate-600 dark:text-slate-400">原因说明</label>
                  <input
                    type="text"
                    value={newRule.reason}
                    onChange={(e) => setNewRule({ ...newRule, reason: e.target.value })}
                    className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4 justify-end">
                <button
                  onClick={() => setShowAddDialog(false)}
                  className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 rounded hover:bg-slate-300"
                >
                  取消
                </button>
                <button
                  onClick={handleAddRule}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                  data-testid="confirm-add-rule"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Help Modal */}
        {showHelp && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowHelp(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl p-6 max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-2">⌨️ 快捷键</h3>
              <ul className="text-sm space-y-1 text-slate-700 dark:text-slate-300">
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Esc</kbd> - 关闭</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+N</kbd> - 新增规则</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+T</kbd> - 沙盒测试</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+E</kbd> - 导出审计</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+1/2/3</kbd> - 切换 Tab</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">?</kbd> - 显示/隐藏帮助</li>
              </ul>
              <button
                onClick={() => setShowHelp(false)}
                className="mt-4 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-xs text-slate-500 flex justify-between">
          <span>🛡️ 规则 {stats.rules} | 启用 {stats.enabled} | 审计 {stats.totalAuditLogs}</span>
          <span>决策统计: ✅{stats.allow} 🚫{stats.block} ⚠️{stats.prompt}</span>
        </div>
      </div>
    </div>
  );
}
