/**
 * # ============================================================
 * # AgentExecutionPanel 组件 (v1.0.0)
 * # Cycle 64 G64-01
 * # ====================================
 * # 核心作用：实时展示 Agent 实例的执行状态和事件流
 * # 设计要点：
 * #   - 三段式布局：状态栏 / 进度条 / 事件流
 * #   - 事件流按类型着色（Start=蓝/Stop=绿/Error=红/Tool=紫/Output=青）
 * #   - 自动滚动到最新事件
 * #   - 支持暂停/恢复/取消操作
 * #   - 支持折叠/展开
 * #   - 主题感知（dark/light/high-contrast）
 * # 输入参数：agentId, onClose
 * # 输出结果：JSX
 * # 对标：Codex CLI agent 执行可视化面板
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 64 G64-01 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentExecution, HookEvent } from '../hooks/useAgentExecution';

export interface AgentExecutionPanelProps {
  agentId: string;
  onClose?: () => void;
  defaultCollapsed?: boolean;
  className?: string;
}

const STATUS_COLOR: Record<string, string> = {
  spawning: 'text-slate-500',
  running: 'text-blue-500',
  tool_calling: 'text-purple-500',
  output_streaming: 'text-cyan-500',
  idle: 'text-emerald-500',
  failed: 'text-rose-500',
  cancelled: 'text-amber-500',
  dead: 'text-slate-400',
};

const STATUS_BG: Record<string, string> = {
  spawning: 'bg-slate-100 dark:bg-slate-800',
  running: 'bg-blue-100 dark:bg-blue-900/30',
  tool_calling: 'bg-purple-100 dark:bg-purple-900/30',
  output_streaming: 'bg-cyan-100 dark:bg-cyan-900/30',
  idle: 'bg-emerald-100 dark:bg-emerald-900/30',
  failed: 'bg-rose-100 dark:bg-rose-900/30',
  cancelled: 'bg-amber-100 dark:bg-amber-900/30',
  dead: 'bg-slate-200 dark:bg-slate-700',
};

const EVENT_COLOR: Record<string, string> = {
  SubagentStart: 'text-blue-600 dark:text-blue-400',
  SubagentStop: 'text-emerald-600 dark:text-emerald-400',
  PreToolUse: 'text-purple-600 dark:text-purple-400',
  PostToolUse: 'text-purple-600 dark:text-purple-400',
  Progress: 'text-slate-500 dark:text-slate-400',
  Output: 'text-cyan-600 dark:text-cyan-400',
  Error: 'text-rose-600 dark:text-rose-400',
  Cancelled: 'text-amber-600 dark:text-amber-400',
};

const EVENT_BADGE: Record<string, string> = {
  SubagentStart: 'START',
  SubagentStop: 'STOP',
  PreToolUse: 'TOOL▶',
  PostToolUse: '◀TOOL',
  Progress: 'PROG',
  Output: 'OUT',
  Error: 'ERR',
  Cancelled: 'CXL',
};

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDuration(start: number, end: number | null): string {
  const ms = ((end ?? Date.now() / 1000) - start) * 1000;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function EventItem({ event }: { event: HookEvent }): React.ReactElement {
  const badge = EVENT_BADGE[event.event_type] || event.event_type;
  const color = EVENT_COLOR[event.event_type] || 'text-slate-500';
  const dataStr = useMemo(() => {
    const data = event.data || {};
    if (event.event_type === 'PreToolUse' || event.event_type === 'PostToolUse') {
      const tool = data.tool_name || '?';
      const dur = data.duration_ms ? ` (${data.duration_ms}ms)` : '';
      return `${tool}${dur}`;
    }
    if (event.event_type === 'Output') {
      const content = data.content as string;
      const preview = content
        ? content.length > 80
          ? content.slice(0, 80) + '...'
          : content
        : '';
      return preview;
    }
    if (event.event_type === 'Progress') {
      return `progress=${(data.progress as number)?.toFixed(2) ?? '?'}`;
    }
    if (event.event_type === 'Error') {
      return String(data.error || '');
    }
    if (event.event_type === 'Cancelled') {
      return String(data.reason || '');
    }
    return JSON.stringify(data).slice(0, 80);
  }, [event]);

  return (
    <div className="flex items-start gap-2 py-1 text-xs font-mono border-b border-[var(--border-color)]/30">
      <span className="text-slate-400 dark:text-slate-500 w-20 shrink-0">
        {formatTime(event.timestamp)}
      </span>
      <span
        className={`${color} font-semibold w-16 shrink-0 text-center`}
        data-testid={`event-badge-${event.event_type}`}
      >
        {badge}
      </span>
      <span className="text-[var(--text-secondary)] flex-1 truncate">{dataStr}</span>
    </div>
  );
}

export const AgentExecutionPanel: React.FC<AgentExecutionPanelProps> = ({
  agentId,
  onClose,
  defaultCollapsed = false,
  className = '',
}) => {
  const {
    instance,
    events,
    connected,
    error,
    reconnectCount,
    pause,
    resume,
    cancel,
    clearEvents,
  } = useAgentExecution({ agentId, autoConnect: true });

  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动
  useEffect(() => {
    if (!collapsed && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events, collapsed]);

  const isActive = instance && ['running', 'tool_calling', 'output_streaming', 'spawning'].includes(instance.status);
  const isCompleted = instance && ['idle', 'failed', 'cancelled', 'dead'].includes(instance.status);

  return (
    <div
      className={`flex flex-col bg-[var(--bg-panel)] border border-[var(--border-color)] rounded-lg overflow-hidden ${className}`}
      data-testid="agent-execution-panel"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-elevated)]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-5 h-5 flex items-center justify-center"
            data-testid="agent-panel-toggle"
            aria-label={collapsed ? '展开' : '折叠'}
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
            🤖 {instance?.nickname || 'Agent'}
          </span>
          {instance && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BG[instance.status]} ${STATUS_COLOR[instance.status]}`}
              data-testid="agent-status"
            >
              {instance.status}
            </span>
          )}
          <span
            className={`text-xs ${connected ? 'text-emerald-500' : 'text-slate-400'}`}
            data-testid="agent-connection-status"
            title={error || (connected ? '已连接' : '未连接')}
          >
            {connected ? '● 实时' : '○ 离线'}
          </span>
          {reconnectCount > 0 && (
            <span className="text-xs text-amber-500">重连 x{reconnectCount}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <button
              onClick={() => (instance?.paused ? resume() : pause())}
              className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50"
              data-testid="agent-pause-resume"
            >
              {instance?.paused ? '▶ 恢复' : '⏸ 暂停'}
            </button>
          )}
          {isActive && (
            <button
              onClick={cancel}
              className="text-xs px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/50"
              data-testid="agent-cancel"
            >
              ✕ 取消
            </button>
          )}
          {events.length > 0 && (
            <button
              onClick={clearEvents}
              className="text-xs px-2 py-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
              data-testid="agent-clear-events"
            >
              清空
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-xs px-2 py-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
              data-testid="agent-panel-close"
              aria-label="关闭"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 状态栏 + 进度条 */}
      {!collapsed && instance && (
        <div className="px-3 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-1">
            <span>
              任务: <span className="text-[var(--text-primary)] font-mono">{instance.task.slice(0, 50)}{instance.task.length > 50 ? '...' : ''}</span>
            </span>
            <span>
              {formatDuration(instance.started_at, instance.finished_at)} · 🔧 {instance.tool_calls_count} 次调用
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all ${
                instance.status === 'failed'
                  ? 'bg-rose-500'
                  : instance.status === 'cancelled'
                  ? 'bg-amber-500'
                  : 'bg-blue-500'
              }`}
              style={{ width: `${Math.round((instance.progress || 0) * 100)}%` }}
              data-testid="agent-progress-bar"
            />
          </div>
          {instance.current_tool && (
            <div className="text-xs text-[var(--text-secondary)] mt-1">
              当前工具: <span className="text-purple-500 font-mono">{instance.current_tool}</span>
            </div>
          )}
          {instance.result && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
              ✓ {instance.result}
            </div>
          )}
          {instance.error && (
            <div className="text-xs text-rose-600 dark:text-rose-400 mt-1">
              ✕ {instance.error}
            </div>
          )}
        </div>
      )}

      {/* 事件流 */}
      {!collapsed && (
        <div
          className="flex-1 overflow-y-auto p-2 max-h-96"
          data-testid="agent-event-stream"
        >
          {events.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-4">
              {connected ? '等待事件...' : '未连接'}
            </div>
          ) : (
            events.map((e) => <EventItem key={e.event_id} event={e} />)
          )}
          <div ref={eventsEndRef} />
        </div>
      )}

      {/* 折叠时的简短状态 */}
      {collapsed && instance && (
        <div className="px-3 py-1 text-xs text-[var(--text-secondary)]">
          {events.length} 个事件 · 进度 {Math.round((instance.progress || 0) * 100)}%
        </div>
      )}
    </div>
  );
};

export default AgentExecutionPanel;
