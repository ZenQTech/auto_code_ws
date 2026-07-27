/**
 * # ============================================================
 * # HooksPanel - Hooks 事件系统管理面板
 * # ============================================================
 * # 核心作用：可视化管理和测试 10 种 Hook 事件
 * # 运行流程：
 * #   1. 加载所有 hook 配置 + 事件列表
 * #   2. 支持添加 / 删除 hook 配置
 * #   3. 支持手动触发事件测试
 * #   4. 展示触发历史
 * #   5. 从 ~/.hermes/hooks.json 加载配置
 * # 输入参数：无（自动通过 useCycle2Api 风格获取数据）
 * # 输出结果：面板 DOM
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | P0-4 新建 - Hooks 事件系统 UI
 * # ============================================================
 */

import React, { useEffect, useState, useCallback } from 'react';

// ============================================================
// 类型定义
// ============================================================

export interface HookEventInfo {
  name: string;
  description: string;
}

export interface HookDefinition {
  type: string;
  command: string;
  timeout: number;
  env: Record<string, string>;
  cwd: string | null;
  name: string | null;
}

export interface HookConfig {
  event: string;
  matcher: string;
  hooks: HookDefinition[];
}

export interface HookAction {
  exit_code: number;
  stdout: string;
  stderr: string;
  json_output: any;
  duration_ms: number;
  error: string | null;
  is_blocking: boolean;
  is_success: boolean;
}

export interface HookHistoryEntry {
  event: string;
  payload_keys: string[];
  hook_name: string;
  exit_code: number;
  duration_ms: number;
  error: string | null;
}

export interface HooksPanelProps {
  onClose: () => void;
}

// 事件 → 颜色映射
const EVENT_COLORS: Record<string, string> = {
  SessionStart: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  UserPromptSubmit: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  PreToolUse: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  PostToolUse: 'bg-purple-500/20 text-purple-400 border-purple-500/40',
  PermissionRequest: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  PreCompact: 'bg-pink-500/20 text-pink-400 border-pink-500/40',
  PostCompact: 'bg-pink-500/20 text-pink-400 border-pink-500/40',
  SubagentStart: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
  SubagentStop: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
  SessionEnd: 'bg-red-500/20 text-red-400 border-red-500/40',
};

const EVENT_ICONS: Record<string, string> = {
  SessionStart: '▶️',
  UserPromptSubmit: '📝',
  PreToolUse: '🛡️',
  PostToolUse: '✅',
  PermissionRequest: '🔐',
  PreCompact: '📦',
  PostCompact: '📂',
  SubagentStart: '🚀',
  SubagentStop: '🛬',
  SessionEnd: '⏹️',
};

// API 基础 URL
const API_BASE = '/api/hooks';

// ============================================================
// API 客户端函数
// ============================================================

async function apiGet(path: string): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function apiPost(path: string, body: any): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function apiDelete(path: string): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ============================================================
// 组件
// ============================================================

/**
 * HooksPanel - 事件系统管理面板
 */
export const HooksPanel: React.FC<HooksPanelProps> = ({ onClose }) => {
  // 数据状态
  const [events, setEvents] = useState<HookEventInfo[]>([]);
  const [configs, setConfigs] = useState<HookConfig[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<HookHistoryEntry[]>([]);
  const [lastDispatch, setLastDispatch] = useState<any>(null);

  // UI 状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedEventForDispatch, setSelectedEventForDispatch] = useState<string>('PreToolUse');
  const [dispatchPayload, setDispatchPayload] = useState<string>(
    JSON.stringify({ tool_name: 'Bash', arguments: { cmd: 'ls -la' } }, null, 2)
  );

  // 添加表单状态
  const [newEvent, setNewEvent] = useState<string>('PreToolUse');
  const [newMatcher, setNewMatcher] = useState<string>('');
  const [newCommand, setNewCommand] = useState<string>('echo "hook triggered"');
  const [newTimeout, setNewTimeout] = useState<number>(30);
  const [newName, setNewName] = useState<string>('');

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsResp, configsResp, summaryResp, historyResp] = await Promise.all([
        apiGet('/events'),
        apiGet(''),
        apiGet('/summary'),
        apiGet('/history?limit=20'),
      ]);
      setEvents(eventsResp.events || []);
      setConfigs(configsResp.configs || []);
      setSummary(summaryResp);
      setHistory(historyResp.history || []);
    } catch (e) {
      setError(`加载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 添加 hook
  const handleAddHook = useCallback(async () => {
    if (!newCommand.trim()) {
      setError('命令不能为空');
      return;
    }
    setError(null);
    setActionMessage('正在添加 hook...');
    try {
      await apiPost('/configs', {
        event: newEvent,
        matcher: newMatcher,
        hooks: [
          {
            type: 'command',
            command: newCommand,
            timeout: newTimeout,
            name: newName || newCommand.slice(0, 30),
          },
        ],
      });
      setActionMessage(`✓ Hook 已添加: ${newEvent}`);
      setShowAddForm(false);
      // 重置表单
      setNewCommand('echo "hook triggered"');
      setNewName('');
      setNewMatcher('');
      await loadData();
    } catch (e) {
      setError(`添加失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [newEvent, newMatcher, newCommand, newTimeout, newName, loadData]);

  // 删除 hook
  const handleDeleteHook = useCallback(async (idx: number) => {
    setError(null);
    setActionMessage('正在删除...');
    try {
      await apiDelete(`/configs/${idx}`);
      setActionMessage('✓ Hook 已删除');
      await loadData();
    } catch (e) {
      setError(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadData]);

  // 触发事件
  const handleDispatch = useCallback(async () => {
    setError(null);
    setActionMessage('正在触发事件...');
    try {
      let payload: any;
      try {
        payload = JSON.parse(dispatchPayload);
      } catch (e) {
        setError('Payload 不是合法 JSON');
        return;
      }
      const result = await apiPost('/dispatch', {
        event: selectedEventForDispatch,
        payload,
      });
      setLastDispatch(result);
      setActionMessage(
        `✓ 事件 ${selectedEventForDispatch} 触发完成，` +
        `执行 ${result.executed} 个 hook${result.blocking ? '（有阻塞）' : ''}`
      );
      await loadData();
    } catch (e) {
      setError(`触发失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedEventForDispatch, dispatchPayload, loadData]);

  // 清空所有
  const handleClearAll = useCallback(async () => {
    if (!confirm('确认清空所有 hook 配置？')) return;
    setError(null);
    setActionMessage('正在清空...');
    try {
      await apiPost('/clear', {});
      setActionMessage('✓ 已清空所有配置');
      await loadData();
    } catch (e) {
      setError(`清空失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadData]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="flex flex-col h-full max-h-[85vh] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-300/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🪝</span>
          <div>
            <h2 className="text-base font-bold text-surface-900">Hooks 事件系统</h2>
            <p className="text-[10px] text-surface-500 mt-0.5">
              仿照 Codex v0.150+ Hooks · 支持 10 类事件
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-surface-500 hover:text-surface-900 transition-colors text-xl leading-none"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 摘要卡片 */}
      {summary && (
        <div className="grid grid-cols-4 gap-2 p-4 border-b border-surface-300/30 flex-shrink-0">
          <div className="bg-surface-100/70 rounded p-2 text-center">
            <div className="text-lg font-bold text-hermes-500">{summary.total_configs}</div>
            <div className="text-[10px] text-surface-600">总配置数</div>
          </div>
          <div className="bg-surface-100/70 rounded p-2 text-center">
            <div className="text-lg font-bold text-emerald-500">{summary.events.length}</div>
            <div className="text-[10px] text-surface-600">事件类型</div>
          </div>
          <div className="bg-surface-100/70 rounded p-2 text-center">
            <div className="text-lg font-bold text-blue-500">
              {(Object.values(summary.hooks_per_event) as number[]).reduce(
                (a, b) => a + b,
                0
              )}
            </div>
            <div className="text-[10px] text-surface-600">已注册 Hook</div>
          </div>
          <div className="bg-surface-100/70 rounded p-2 text-center">
            <div className="text-lg font-bold text-purple-500">{summary.history_count}</div>
            <div className="text-[10px] text-surface-600">触发历史</div>
          </div>
        </div>
      )}

      {/* 消息条 */}
      {(actionMessage || error) && (
        <div
          className={`mx-4 mt-3 px-3 py-1.5 text-xs rounded ${
            error
              ? 'bg-red-500/10 text-red-400 border border-red-500/30'
              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
          }`}
        >
          {error || actionMessage}
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {/* 操作栏 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-1.5 text-xs bg-gradient-to-br from-hermes-500 to-hermes-600 hover:from-hermes-600 hover:to-hermes-700 text-white rounded font-medium transition-all"
          >
            {showAddForm ? '✕ 取消' : '➕ 添加 Hook'}
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-surface-200 hover:bg-surface-300 text-surface-700 rounded transition-colors disabled:opacity-50"
          >
            {loading ? '⟳ 加载中...' : '🔄 刷新'}
          </button>
          <button
            onClick={handleClearAll}
            disabled={configs.length === 0}
            className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded transition-colors disabled:opacity-30"
          >
            🗑️ 清空所有
          </button>
        </div>

        {/* 添加表单 */}
        {showAddForm && (
          <div className="bg-surface-100/50 border border-surface-300/50 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-surface-900">添加新 Hook</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-surface-600 block mb-1">事件类型</label>
                <select
                  value={newEvent}
                  onChange={(e) => setNewEvent(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
                >
                  {events.map((ev) => (
                    <option key={ev.name} value={ev.name}>
                      {EVENT_ICONS[ev.name] || '⚡'} {ev.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-surface-600 block mb-1">
                  匹配模式（正则）
                </label>
                <input
                  type="text"
                  value={newMatcher}
                  onChange={(e) => setNewMatcher(e.target.value)}
                  placeholder="例：Bash|Write 或 ^/review"
                  className="w-full px-2 py-1.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-surface-600 block mb-1">
                Shell 命令
              </label>
              <textarea
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                rows={2}
                className="w-full px-2 py-1.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-surface-600 block mb-1">
                  超时（秒）
                </label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={newTimeout}
                  onChange={(e) => setNewTimeout(parseInt(e.target.value) || 60)}
                  className="w-full px-2 py-1.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
                />
              </div>
              <div>
                <label className="text-[10px] text-surface-600 block mb-1">名称（可选）</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="my-hook"
                  className="w-full px-2 py-1.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
                />
              </div>
            </div>

            <button
              onClick={handleAddHook}
              className="w-full px-3 py-1.5 text-xs bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded font-medium transition-all"
            >
              ✓ 确认添加
            </button>
          </div>
        )}

        {/* 已注册 Hook 列表 */}
        <div>
          <h3 className="text-sm font-semibold text-surface-900 mb-2 flex items-center gap-2">
            📋 已注册 Hook
            <span className="text-[10px] text-surface-500 font-normal">
              ({configs.length} 项配置)
            </span>
          </h3>
          {configs.length === 0 ? (
            <div className="text-xs text-surface-500 text-center py-6 bg-surface-100/30 rounded-lg">
              暂无 hook 配置。点击「➕ 添加 Hook」开始。
            </div>
          ) : (
            <div className="space-y-2">
              {configs.map((cfg, idx) => (
                <div
                  key={idx}
                  className="bg-surface-100/50 border border-surface-300/50 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${EVENT_COLORS[cfg.event] || 'bg-surface-200 text-surface-700'}`}
                      >
                        {EVENT_ICONS[cfg.event] || '⚡'} {cfg.event}
                      </span>
                      {cfg.matcher && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono">
                          /{cfg.matcher}/
                        </span>
                      )}
                      <span className="text-[10px] text-surface-600">
                        {cfg.hooks.length} hook{cfg.hooks.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteHook(idx)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      ✕ 删除
                    </button>
                  </div>
                  {cfg.hooks.map((h, hIdx) => (
                    <div
                      key={hIdx}
                      className="mt-1 px-2 py-1.5 bg-surface-200/50 rounded text-[11px] font-mono text-surface-700 break-all"
                    >
                      {h.name && <span className="text-purple-400">[{h.name}] </span>}
                      <span className="text-emerald-600">$</span> {h.command}
                      {h.timeout !== 60 && (
                        <span className="text-surface-500"> (timeout={h.timeout}s)</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 事件触发测试 */}
        <div>
          <h3 className="text-sm font-semibold text-surface-900 mb-2">🧪 手动触发测试</h3>
          <div className="bg-surface-100/50 border border-surface-300/50 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-surface-600 block mb-1">事件</label>
                <select
                  value={selectedEventForDispatch}
                  onChange={(e) => setSelectedEventForDispatch(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
                >
                  {events.map((ev) => (
                    <option key={ev.name} value={ev.name}>
                      {EVENT_ICONS[ev.name] || '⚡'} {ev.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleDispatch}
                  className="w-full px-3 py-1.5 text-xs bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded font-medium transition-all"
                >
                  ▶ 触发
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-surface-600 block mb-1">
                Payload (JSON)
              </label>
              <textarea
                value={dispatchPayload}
                onChange={(e) => setDispatchPayload(e.target.value)}
                rows={3}
                className="w-full px-2 py-1.5 text-[11px] bg-surface-200 border border-surface-300/50 rounded text-surface-900 font-mono"
              />
            </div>
            {lastDispatch && (
              <div className="mt-2 px-2 py-1.5 bg-surface-200/70 rounded text-[11px] space-y-1">
                <div className="text-surface-700">
                  执行: <span className="font-medium">{lastDispatch.executed}</span> 个 hook
                  {lastDispatch.blocking && (
                    <span className="ml-2 px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px]">
                      阻塞
                    </span>
                  )}
                </div>
                {lastDispatch.actions && lastDispatch.actions.length > 0 && (
                  <div className="space-y-1">
                    {lastDispatch.actions.map((a: HookAction, i: number) => (
                      <div key={i} className="font-mono text-[10px]">
                        <span
                          className={
                            a.is_blocking
                              ? 'text-red-400'
                              : a.is_success
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                          }
                        >
                          [{a.exit_code}]
                        </span>{' '}
                        <span className="text-surface-500">({a.duration_ms.toFixed(1)}ms)</span>{' '}
                        {a.stdout && <span className="text-surface-700">{a.stdout.slice(0, 100)}</span>}
                        {a.error && <span className="text-red-400">{a.error.slice(0, 100)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 事件类型说明 */}
        <div>
          <h3 className="text-sm font-semibold text-surface-900 mb-2">📚 事件说明</h3>
          <div className="grid grid-cols-1 gap-1.5">
            {events.map((ev) => (
              <div
                key={ev.name}
                className="px-3 py-2 bg-surface-100/30 border border-surface-300/30 rounded text-[11px]"
              >
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${EVENT_COLORS[ev.name] || 'bg-surface-200 text-surface-700'}`}
                >
                  {EVENT_ICONS[ev.name] || '⚡'} {ev.name}
                </span>
                <span className="text-surface-600 ml-2">{ev.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 触发历史 */}
        {history.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-surface-900 mb-2">📜 最近触发历史</h3>
            <div className="space-y-1">
              {history.slice(0, 10).map((h, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-2 py-1.5 bg-surface-100/40 rounded text-[11px]"
                >
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${EVENT_COLORS[h.event] || 'bg-surface-200 text-surface-700'}`}
                  >
                    {h.event}
                  </span>
                  <span className="text-surface-600 font-mono flex-1 truncate">
                    {h.hook_name}
                  </span>
                  <span
                    className={
                      h.exit_code === 0
                        ? 'text-emerald-400'
                        : h.exit_code === 2
                          ? 'text-red-400'
                          : 'text-amber-400'
                    }
                  >
                    [{h.exit_code}]
                  </span>
                  <span className="text-surface-500 text-[10px]">
                    {h.duration_ms.toFixed(0)}ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HooksPanel;
