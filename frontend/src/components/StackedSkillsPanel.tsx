/**
 * StackedSkillsPanel - 堆叠技能管理面板 (v1.0.0 Cycle 29 G29-01)
 *
 * 核心作用：实现 Claude Code v2.1.199+ 风格的 Stacked Skills UI
 * 三个 Tab：组合 (Builder) / 历史 (History) / 统计 (Stats)
 *
 * 运行流程：
 *   1. Builder Tab: 技能多选 + 参数输入 + 实时组合验证 + 执行
 *   2. History Tab: 历史执行记录列表
 *   3. Stats Tab: 最常用组合 + 平均耗时 + 成功率
 */

import React, { useState, useMemo, useEffect } from 'react';
import { getDefaultStackedSkillEngine, StackedExecutionResult, CompositionCheckResult } from '../utils/stackedSkillEngine';
import type { Skill } from '../utils/skillTypes';

interface StackedSkillsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerCommand?: string;
}

type Tab = 'builder' | 'history' | 'stats';

export const StackedSkillsPanel: React.FC<StackedSkillsPanelProps> = ({ isOpen, onClose, triggerCommand }) => {
  const engine = useMemo(() => getDefaultStackedSkillEngine(), []);
  const [activeTab, setActiveTab] = useState<Tab>('builder');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [args, setArgs] = useState<string>('');
  const [parallelExecution, setParallelExecution] = useState<boolean>(true);
  const [stopOnFirstFailure, setStopOnFirstFailure] = useState<boolean>(false);
  const [sharedContext, setSharedContext] = useState<boolean>(false);
  const [validation, setValidation] = useState<CompositionCheckResult | null>(null);
  const [lastResult, setLastResult] = useState<StackedExecutionResult | null>(null);
  const [history, setHistory] = useState<Array<{ timestamp: number; result: StackedExecutionResult }>>([]);
  const [stats, setStats] = useState<{ totalExecutions: number; successRate: number; avgDurationMs: number; topCombinations: Array<{ names: string; count: number }> } | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!isOpen) return;
    // 从 SkillEngine 加载技能列表
    const skillEngine = (engine as any).skillEngine;
    if (skillEngine) {
      setSkills(skillEngine.listSkills({ enabled: true }));
    }
    setHistory(engine.getHistory(20).map((h) => ({ timestamp: h.timestamp, result: h.result })));
    setStats(engine.getStats());
  }, [isOpen, refreshKey, engine]);

  useEffect(() => {
    if (triggerCommand) {
      setArgs(triggerCommand);
    }
  }, [triggerCommand]);

  // 实时验证组合
  useEffect(() => {
    if (selectedSkills.length > 0) {
      const v = engine.validateComposition(selectedSkills);
      setValidation(v);
    } else {
      setValidation(null);
    }
  }, [selectedSkills, engine]);

  const handleToggleSkill = (name: string) => {
    setSelectedSkills((prev) => {
      if (prev.includes(name)) {
        return prev.filter((n) => n !== name);
      } else {
        if (prev.length >= 5) return prev; // 限制 5 个
        return [...prev, name];
      }
    });
  };

  const handleExecute = async () => {
    if (selectedSkills.length === 0) return;
    if (!validation?.valid) return;
    setIsExecuting(true);
    try {
      const commandStr = selectedSkills.map((n) => `/${n}`).join(' ') + (args ? ' ' + args : '');
      const result = await engine.executeStack(commandStr, {
        parallelExecution,
        stopOnFirstFailure,
        sharedContext,
      });
      setLastResult(result);
      refresh();
    } catch (e) {
      console.error('StackedSkill execute failed', e);
    } finally {
      setIsExecuting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="stacked-skills-panel">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-w-[95vw] h-[700px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
          <h2 className="text-lg font-semibold text-surface-900">📚 堆叠技能</h2>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-900 text-2xl leading-none"
            data-testid="stacked-skills-close-btn"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-200">
          {(['builder', 'history', 'stats'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-rose-600 border-b-2 border-rose-500'
                  : 'text-surface-600 hover:text-surface-900'
              }`}
              data-testid={`stacked-skills-tab-${tab}`}
            >
              {tab === 'builder' ? '组合' : tab === 'history' ? '历史' : '统计'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'builder' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-2">
                  选择技能（最多 5 个，已选 {selectedSkills.length}）
                </label>
                <div className="grid grid-cols-2 gap-2" data-testid="stacked-skills-skill-selector">
                  {skills.map((s) => (
                    <label
                      key={s.id}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer transition-colors ${
                        selectedSkills.includes(s.name)
                          ? 'border-rose-400 bg-rose-50'
                          : 'border-surface-200 hover:border-surface-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSkills.includes(s.name)}
                        onChange={() => handleToggleSkill(s.name)}
                        disabled={!selectedSkills.includes(s.name) && selectedSkills.length >= 5}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-surface-900 truncate">{s.name}</div>
                        <div className="text-xs text-surface-500 truncate">{s.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-2">命令参数</label>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="例如: src/foo.ts --strict"
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
                  data-testid="stacked-skills-args-input"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={parallelExecution}
                    onChange={(e) => setParallelExecution(e.target.checked)}
                    className="rounded"
                  />
                  <span>并行执行</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={stopOnFirstFailure}
                    onChange={(e) => setStopOnFirstFailure(e.target.checked)}
                    className="rounded"
                  />
                  <span>首个失败时停止</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sharedContext}
                    onChange={(e) => setSharedContext(e.target.checked)}
                    className="rounded"
                  />
                  <span>共享上下文</span>
                </label>
              </div>

              {validation && (
                <div
                  className={`p-3 rounded-lg ${
                    validation.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                  }`}
                  data-testid="stacked-skills-validation"
                >
                  {validation.conflicts.length > 0 && (
                    <div className="text-sm">
                      <div className="font-medium text-red-700 mb-1">冲突 ({validation.conflicts.length})</div>
                      {validation.conflicts.map((c, i) => (
                        <div key={i} className="text-red-600 text-xs">
                          [{c.type}] {c.details}
                        </div>
                      ))}
                    </div>
                  )}
                  {validation.warnings.length > 0 && (
                    <div className="text-sm mt-2">
                      <div className="font-medium text-amber-700 mb-1">警告 ({validation.warnings.length})</div>
                      {validation.warnings.map((w, i) => (
                        <div key={i} className="text-amber-600 text-xs">
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                  {validation.valid && validation.conflicts.length === 0 && (
                    <div className="text-sm text-green-700">✓ 组合有效（{validation.effectiveTools.length} 个工具）</div>
                  )}
                </div>
              )}

              <button
                onClick={handleExecute}
                disabled={selectedSkills.length === 0 || !validation?.valid || isExecuting}
                className="w-full px-4 py-2.5 bg-rose-500 text-white rounded-lg hover:bg-rose-600 disabled:bg-surface-300 disabled:cursor-not-allowed font-medium"
                data-testid="stacked-skills-execute-btn"
              >
                {isExecuting ? '执行中...' : '执行堆叠技能'}
              </button>

              {lastResult && (
                <div className="space-y-2 mt-4" data-testid="stacked-skills-result">
                  <div className="text-sm font-medium text-surface-700">
                    执行结果（{lastResult.successCount} 成功 / {lastResult.failureCount} 失败，耗时 {lastResult.totalDurationMs}ms）
                  </div>
                  <div className="bg-surface-50 p-3 rounded-lg max-h-60 overflow-y-auto">
                    <pre className="text-xs text-surface-700 whitespace-pre-wrap">{lastResult.aggregatedOutput}</pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-2" data-testid="stacked-skills-history">
              {history.length === 0 ? (
                <div className="text-center text-surface-500 py-8">暂无执行历史</div>
              ) : (
                history.map((h, i) => (
                  <div
                    key={i}
                    className="border border-surface-200 rounded-lg p-3 hover:bg-surface-50"
                    data-testid={`stacked-skills-history-item-${i}`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-medium text-surface-900">
                        {h.result.command.skillNames.map((n) => `/${n}`).join(' ')}
                      </div>
                      <div className="text-xs text-surface-500">
                        {new Date(h.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-xs text-surface-500 mt-1">
                      成功 {h.result.successCount} / 失败 {h.result.failureCount} · 耗时 {h.result.totalDurationMs}ms
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'stats' && stats && (
            <div className="space-y-4" data-testid="stacked-skills-stats">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-rose-50 p-4 rounded-lg">
                  <div className="text-xs text-surface-600">总执行数</div>
                  <div className="text-2xl font-semibold text-rose-700">{stats.totalExecutions}</div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-xs text-surface-600">成功率</div>
                  <div className="text-2xl font-semibold text-green-700">
                    {(stats.successRate * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-xs text-surface-600">平均耗时</div>
                  <div className="text-2xl font-semibold text-blue-700">
                    {stats.avgDurationMs.toFixed(0)}ms
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-surface-700 mb-2">最常用组合 Top 10</h3>
                {stats.topCombinations.length === 0 ? (
                  <div className="text-center text-surface-500 py-4">暂无数据</div>
                ) : (
                  <div className="space-y-1">
                    {stats.topCombinations.map((c, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center px-3 py-2 bg-surface-50 rounded"
                      >
                        <div className="text-sm text-surface-700">{c.names.replace(/\+/g, ' + ')}</div>
                        <div className="text-sm font-medium text-rose-600">{c.count} 次</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
