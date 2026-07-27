/**
 * # ============================================================
 * # HookChainViewer - Hook 触发链路可视化组件
 * # ============================================================
 * # 核心作用：展示最近的 Hook 触发链路（v1.1.0 P0-6 新增）
 * # 运行流程：
 * #   1. 通过 useEffect 拉取 /api/hooks/chain
 * #   2. 展示最近 50 条触发记录
 * #   3. 支持按 event 类型过滤
 * #   4. 支持自动刷新（每 5s）
 * #   5. 展示摘要统计（total / blocking / context_injection / permission_override）
 * # 输入参数：onClose - 关闭回调
 * # 输出结果：面板 DOM
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | P0-6 新建 - Hook 触发链路可视化
 * # ============================================================
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../hooks/apiShared';

// 包装为更易用的方法
const apiGet = <T,>(url: string): Promise<T> => apiFetch<T>(url);
const apiSend = <T,>(method: string, url: string, body: any): Promise<T> =>
  apiFetch<T>(url, { method, body: JSON.stringify(body) });

// ============================================================
// 类型定义
// ============================================================

export interface HookChainEntry {
  id: string;
  event: string;
  session_id: string | null;
  agent_id: string | null;
  hook_name: string;
  exit_code: number;
  duration_ms: number;
  additional_context: string | null;
  permission_decision: string | null;
  timestamp: number;
  is_blocking: boolean;
  error: string | null;
}

export interface HookChainSummary {
  total: number;
  events_count: Record<string, number>;
  blocking_count: number;
  context_injection_count: number;
  permission_override_count: number;
}

// 事件类型图标 + 颜色
const EVENT_META: Record<string, { icon: string; color: string; label: string }> = {
  SessionStart: { icon: '🟢', color: 'emerald', label: '会话开始' },
  UserPromptSubmit: { icon: '📝', color: 'blue', label: '用户消息' },
  PreToolUse: { icon: '⚙️', color: 'amber', label: '工具调用前' },
  PostToolUse: { icon: '✅', color: 'teal', label: '工具调用后' },
  PermissionRequest: { icon: '🛡️', color: 'rose', label: '权限请求' },
  PreCompact: { icon: '📦', color: 'orange', label: '压缩前' },
  PostCompact: { icon: '📤', color: 'cyan', label: '压缩后' },
  SubagentStart: { icon: '🤖', color: 'indigo', label: 'SubAgent 启动' },
  SubagentStop: { icon: '⏹️', color: 'purple', label: 'SubAgent 停止' },
  SessionEnd: { icon: '🔚', color: 'slate', label: '会话结束' },
};

const COLOR_CLASSES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', badge: 'bg-emerald-500/20 text-emerald-300' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-300', badge: 'bg-blue-500/20 text-blue-300' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300', badge: 'bg-amber-500/20 text-amber-300' },
  teal: { bg: 'bg-teal-500/10', border: 'border-teal-500/30', text: 'text-teal-300', badge: 'bg-teal-500/20 text-teal-300' },
  rose: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-300', badge: 'bg-rose-500/20 text-rose-300' },
  orange: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-300', badge: 'bg-orange-500/20 text-orange-300' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-300', badge: 'bg-cyan-500/20 text-cyan-300' },
  indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-300', badge: 'bg-indigo-500/20 text-indigo-300' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-300', badge: 'bg-purple-500/20 text-purple-300' },
  slate: { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-300', badge: 'bg-slate-500/20 text-slate-300' },
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export interface HookChainViewerProps {
  /** 关闭回调 */
  onClose: () => void;
}

// ============================================================
// 主组件
// ============================================================

export const HookChainViewer: React.FC<HookChainViewerProps> = ({ onClose }) => {
  const [items, setItems] = useState<HookChainEntry[]>([]);
  const [summary, setSummary] = useState<HookChainSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = eventFilter
        ? `/chain?limit=50&event=${eventFilter}`
        : '/chain?limit=50';
      const resp: any = await apiGet(url);
      setItems(resp.items || []);
      setSummary(resp.summary || null);
    } catch (e) {
      setError(`加载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [eventFilter]);

  // 清空链路
  const handleClear = useCallback(async () => {
    if (!confirm('确认清空所有 hook 触发链路？')) return;
    try {
      await apiSend('POST', '/chain/clear', {});
      await loadData();
    } catch (e) {
      setError(`清空失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadData]);

  // 初次加载 + 过滤器变化时
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      loadData();
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, loadData]);

  // 按 event 分组
  const eventGroups = useMemo(() => {
    const groups: Record<string, HookChainEntry[]> = {};
    for (const item of items) {
      if (!groups[item.event]) groups[item.event] = [];
      groups[item.event].push(item);
    }
    return groups;
  }, [items]);

  const eventList = Object.keys(EVENT_META);

  return (
    <div className="flex flex-col h-full max-h-[85vh] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-300/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔗</span>
          <div>
            <h2 className="text-base font-bold text-surface-900">Hook 触发链路</h2>
            <p className="text-[10px] text-surface-500 mt-0.5">
              Codex v0.150+ Lifecycle Hooks · v1.0.0
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="text-surface-500 hover:text-surface-800 text-xl"
        >
          ✕
        </button>
      </div>

      {/* 摘要卡片 */}
      {summary && (
        <div className="grid grid-cols-5 gap-2 p-4 border-b border-surface-300/30 flex-shrink-0">
          <StatCard label="总触发" value={summary.total} color="text-hermes-500" />
          <StatCard label="事件类型" value={Object.keys(summary.events_count).length} color="text-blue-500" />
          <StatCard label="阻塞" value={summary.blocking_count} color="text-rose-500" />
          <StatCard label="Context 注入" value={summary.context_injection_count} color="text-amber-500" />
          <StatCard label="权限覆盖" value={summary.permission_override_count} color="text-emerald-500" />
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-3 border-b border-surface-300/30 flex-shrink-0 flex-wrap">
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="px-2 py-1.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
        >
          <option value="">全部事件</option>
          {eventList.map((e) => (
            <option key={e} value={e}>
              {EVENT_META[e].icon} {e}
            </option>
          ))}
        </select>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-3 py-1.5 text-xs bg-hermes-500 hover:bg-hermes-600 text-white rounded font-medium disabled:opacity-50"
        >
          {loading ? '⟳ 加载中' : '🔄 刷新'}
        </button>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-xs bg-rose-500/80 hover:bg-rose-600 text-white rounded font-medium"
        >
          🗑️ 清空
        </button>
        <label className="flex items-center gap-1.5 text-xs text-surface-600 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          <span>自动刷新</span>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            disabled={!autoRefresh}
            className="px-1 py-0.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900 disabled:opacity-50"
          >
            <option value={2}>2s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
          </select>
        </label>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded">
          {error}
        </div>
      )}

      {/* 主体：触发链路列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
        {items.length === 0 && !loading && (
          <div className="text-center py-12 text-surface-500">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-sm">暂无触发记录</p>
            <p className="text-xs mt-1">注册 hook 并触发事件后，记录会显示在这里</p>
          </div>
        )}

        {Object.entries(eventGroups).map(([event, entries]) => {
          const meta = EVENT_META[event] || EVENT_META.SessionStart;
          const colors = COLOR_CLASSES[meta.color];
          return (
            <div
              key={event}
              className={`${colors.bg} border ${colors.border} rounded-lg overflow-hidden`}
            >
              <div className={`px-3 py-1.5 ${colors.badge} flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{meta.icon}</span>
                  <span className="text-xs font-bold">{event}</span>
                  <span className="text-[10px] opacity-70">{meta.label}</span>
                </div>
                <span className="text-[10px] opacity-70">{entries.length} 条</span>
              </div>
              <div className="divide-y divide-surface-300/20">
                {entries.map((entry) => (
                  <ChainEntryRow key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部：事件类型图例 */}
      <div className="flex-shrink-0 px-4 py-2 border-t border-surface-300/30 bg-surface-50/50 text-[10px] text-surface-500 flex flex-wrap gap-2">
        {eventList.map((e) => (
          <span key={e} className="flex items-center gap-1">
            {EVENT_META[e].icon} {e}
          </span>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// 子组件：统计卡片
// ============================================================

const StatCard: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="bg-surface-100/60 border border-surface-300/40 rounded p-2">
    <div className={`text-xl font-bold ${color}`}>{value}</div>
    <div className="text-[10px] text-surface-500 mt-0.5">{label}</div>
  </div>
);

// ============================================================
// 子组件：链路条目
// ============================================================

const ChainEntryRow: React.FC<{ entry: HookChainEntry; colors?: any }> = ({ entry }) => (
  <div className="px-3 py-2 hover:bg-surface-100/30 transition-colors">
    <div className="flex items-center justify-between gap-2 mb-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-mono text-surface-600">{formatTimestamp(entry.timestamp)}</span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] ${
            entry.exit_code === 0
              ? 'bg-emerald-500/20 text-emerald-300'
              : entry.exit_code === 2
              ? 'bg-rose-500/20 text-rose-300'
              : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          exit={entry.exit_code}
        </span>
        {entry.is_blocking && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-bold">
            阻塞
          </span>
        )}
        <span className="text-surface-700 truncate max-w-[200px]" title={entry.hook_name}>
          {entry.hook_name}
        </span>
        {entry.session_id && (
          <span className="text-[10px] text-surface-500 font-mono">
            session: {entry.session_id.slice(0, 12)}
          </span>
        )}
        {entry.agent_id && (
          <span className="text-[10px] text-surface-500 font-mono">
            agent: {entry.agent_id.slice(0, 12)}
          </span>
        )}
      </div>
      <span className="text-[10px] text-surface-500">{entry.duration_ms.toFixed(1)}ms</span>
    </div>
    {(entry.additional_context || entry.permission_decision) && (
      <div className="mt-1 space-y-1">
        {entry.additional_context && (
          <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
            <span className="font-bold">+ Context:</span> {entry.additional_context}
          </div>
        )}
        {entry.permission_decision && (
          <div
            className={`text-[10px] border rounded px-2 py-1 ${
              entry.permission_decision === 'allow'
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                : entry.permission_decision === 'deny'
                ? 'text-rose-300 bg-rose-500/10 border-rose-500/20'
                : 'text-amber-300 bg-amber-500/10 border-amber-500/20'
            }`}
          >
            <span className="font-bold">🛡️ Decision:</span> {entry.permission_decision}
          </div>
        )}
      </div>
    )}
    {entry.error && (
      <div className="mt-1 text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1">
        <span className="font-bold">Error:</span> {entry.error}
      </div>
    )}
  </div>
);

export default HookChainViewer;
