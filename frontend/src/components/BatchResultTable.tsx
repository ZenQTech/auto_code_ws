/**
 * # ============================================================
 * # BatchResultTable - 批量任务结果表组件 (v1.0.0)
 * # Cycle 65 G65-02
 * # ====================================
 * # 核心作用：可视化 BatchJob 中的每个 instance 的执行结果
 * # 主要功能：
 * #   1. 表格展示 instance 的 row / task / role / status / error
 * #   2. 行级状态过滤（pending/running/completed/failed/cancelled）
 * #   3. 行级状态图标 + 颜色映射
 * #   4. 展开查看错误详情
 * #   5. 失败行高亮
 * # 输入参数：job, onCancel?, showHeader?
 * # 输出结果：表格 UI
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 65 G65-02 初次创建
 * # ====================================
 */

import React, { useMemo, useState } from 'react';
import type { BatchJob, BatchInstance } from '../hooks/useBatchSpawner';

// ============================================================
// 状态映射
// ============================================================

const STATUS_META: Record<
  string,
  { icon: string; label: string; color: string; bg: string }
> = {
  pending: { icon: '⏳', label: '等待中', color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800' },
  spawning: { icon: '🚀', label: '启动中', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  running: { icon: '⚙️', label: '执行中', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  idle: { icon: '⏸', label: '空闲', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  completed: { icon: '✅', label: '已完成', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  failed: { icon: '❌', label: '失败', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
  cancelled: { icon: '⏹', label: '已取消', color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800' },
  dead: { icon: '💀', label: '死亡', color: 'text-slate-400', bg: 'bg-slate-200 dark:bg-slate-700' },
};

function statusOf(s: string): { icon: string; label: string; color: string; bg: string } {
  return STATUS_META[s] || STATUS_META.pending;
}

// ============================================================
// 过滤选项
// ============================================================

type FilterMode = 'all' | 'running' | 'completed' | 'failed' | 'cancelled';

const FILTER_OPTIONS: { value: FilterMode; label: string; icon: string }[] = [
  { value: 'all', label: '全部', icon: '📋' },
  { value: 'running', label: '进行中', icon: '⚙️' },
  { value: 'completed', label: '已完成', icon: '✅' },
  { value: 'failed', label: '失败', icon: '❌' },
  { value: 'cancelled', label: '已取消', icon: '⏹' },
];

// ============================================================
// 子组件：单行
// ============================================================

interface InstanceRowProps {
  instance: BatchInstance;
  expanded: boolean;
  onToggle: () => void;
}

const InstanceRow: React.FC<InstanceRowProps> = ({ instance, expanded, onToggle }) => {
  const meta = statusOf(instance.status);
  const isFailed = instance.status === 'failed' || !!instance.error;
  return (
    <>
      <tr
        className={`text-xs border-b border-[var(--border-color)] hover:bg-[var(--bg-elevated)]/40 ${isFailed ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}
        data-testid={`batch-instance-row-${instance.row_index}`}
      >
        <td className="px-2 py-1.5 font-mono text-[var(--text-secondary)]">
          {instance.row_index}
        </td>
        <td className="px-2 py-1.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}>
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
          </span>
        </td>
        <td className="px-2 py-1.5 font-mono text-[var(--text-secondary)]">
          {instance.role}
        </td>
        <td className="px-2 py-1.5 max-w-xs truncate" title={instance.task}>
          {instance.nickname && (
            <span className="text-[var(--text-tertiary)] mr-1">
              [{instance.nickname}]
            </span>
          )}
          {instance.task}
        </td>
        <td className="px-2 py-1.5 text-[var(--text-tertiary)] font-mono text-[10px]">
          {instance.agent_id.slice(0, 12)}
        </td>
        <td className="px-2 py-1.5">
          {(instance.error || isFailed) && (
            <button
              type="button"
              onClick={onToggle}
              className="text-[10px] text-red-500 hover:text-red-700"
              data-testid={`batch-instance-error-toggle-${instance.row_index}`}
            >
              {expanded ? '🔼 隐藏' : '🔽 查看'}
            </button>
          )}
        </td>
      </tr>
      {expanded && instance.error && (
        <tr
          className="bg-red-50/60 dark:bg-red-900/20"
          data-testid={`batch-instance-error-detail-${instance.row_index}`}
        >
          <td colSpan={6} className="px-3 py-2 text-[10px]">
            <div className="font-semibold text-red-700 dark:text-red-300 mb-1">
              ❌ 错误信息
            </div>
            <pre className="whitespace-pre-wrap break-all text-red-600 dark:text-red-400 font-mono">
              {instance.error}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
};

// ============================================================
// 主组件
// ============================================================

export interface BatchResultTableProps {
  job: BatchJob | null;
  onCancel?: (agentId: string) => void;
  showHeader?: boolean;
  compact?: boolean;
  testId?: string;
}

export const BatchResultTable: React.FC<BatchResultTableProps> = ({
  job,
  onCancel: _onCancel,
  showHeader = true,
  compact = false,
  testId = 'batch-result-table',
}) => {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const instances = useMemo<BatchInstance[]>(() => {
    if (!job) return [];
    return Object.values(job.instances).sort((a, b) => a.row_index - b.row_index);
  }, [job]);

  const filtered = useMemo(() => {
    if (filter === 'all') return instances;
    if (filter === 'running') {
      return instances.filter(
        (i) => i.status === 'running' || i.status === 'spawning' || i.status === 'pending',
      );
    }
    if (filter === 'completed') return instances.filter((i) => i.status === 'completed' || i.status === 'idle');
    if (filter === 'failed') return instances.filter((i) => i.status === 'failed');
    if (filter === 'cancelled') return instances.filter((i) => i.status === 'cancelled');
    return instances;
  }, [instances, filter]);

  const counts = useMemo(() => {
    const c: Record<FilterMode, number> = {
      all: instances.length,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const i of instances) {
      if (i.status === 'running' || i.status === 'spawning' || i.status === 'pending') {
        c.running++;
      } else if (i.status === 'completed' || i.status === 'idle') {
        c.completed++;
      } else if (i.status === 'failed') {
        c.failed++;
      } else if (i.status === 'cancelled') {
        c.cancelled++;
      }
    }
    return c;
  }, [instances]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!job) {
    return (
      <div
        className="p-4 text-center text-xs text-[var(--text-tertiary)]"
        data-testid={testId}
      >
        暂无批量任务
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div
        className="p-4 text-center text-xs text-[var(--text-tertiary)]"
        data-testid={testId}
      >
        <div className="text-2xl mb-1">📦</div>
        <div>批量任务已创建，等待子任务 spawn...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid={testId}>
      {showHeader && (
        <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-app)]/40">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              📊 任务结果（{job.batch_id}）
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] font-mono">
              {job.completed}/{job.total}
            </div>
          </div>
          {/* 过滤栏 */}
          <div className="flex flex-wrap gap-1">
            {FILTER_OPTIONS.map((opt) => {
              const active = filter === opt.value;
              const count = counts[opt.value];
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilter(opt.value)}
                  className={[
                    'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                    'flex items-center gap-1',
                    active
                      ? 'bg-[var(--hermes-500)] text-white'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                  ].join(' ')}
                  data-testid={`batch-result-filter-${opt.value}`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                  <span className="opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-auto ${compact ? 'max-h-64' : ''}`}>
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-[var(--bg-app)]/80 backdrop-blur z-10">
            <tr className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
              <th className="px-2 py-1.5 font-semibold">行</th>
              <th className="px-2 py-1.5 font-semibold">状态</th>
              <th className="px-2 py-1.5 font-semibold">角色</th>
              <th className="px-2 py-1.5 font-semibold">任务</th>
              <th className="px-2 py-1.5 font-semibold">Agent</th>
              <th className="px-2 py-1.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-4 text-center text-xs text-[var(--text-tertiary)]"
                  data-testid="batch-result-empty"
                >
                  当前过滤条件下无数据
                </td>
              </tr>
            ) : (
              filtered.map((inst) => (
                <InstanceRow
                  key={inst.agent_id}
                  instance={inst}
                  expanded={expanded.has(inst.agent_id)}
                  onToggle={() => toggle(inst.agent_id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BatchResultTable;
