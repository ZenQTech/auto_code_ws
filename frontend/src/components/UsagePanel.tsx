/**
 * # ============================================================
 * UsagePanel - 用量监控面板
 * # ============================================================
 * 核心作用：从 App.tsx 抽离右侧用量监控面板
 * 包含：
 *   1. API 调用次数卡片
 *   2. Token 消耗卡片
 *   3. 剩余可用调用次数卡片
 *   4. 任务统计卡片（总任务/已完成/执行中/失败/完成率）
 * 抽取日期：2026-07-27
 * 模块版本：v6.9.0 - P0-2 App.tsx 拆分第三阶段
 * 修改记录：
 *   - 2026-07-27 | v6.9.0 | 从 App.tsx 抽离用量面板（4 个卡片 + 进度条）
 * ============================================================
 */

import React from 'react';
import { formatTokens } from '../utils/messageFormatters';

export interface UsageStats {
  resources: {
    total_api_calls: number;
    total_tokens: number;
  };
  tasks: {
    total: number;
    completed: number;
    running: number;
    failed: number;
    completion_rate: number;
  };
}

export interface UsagePanelProps {
  /** 用量统计数据 */
  stats: UsageStats | null;
  /** 关闭面板回调 */
  onClose: () => void;
}

const QUOTA_LIMIT = 10000;

/**
 * 用量监控面板
 * - 5h 滚动窗口的 API 调用次数
 * - 累计 Token 消耗
 * - 剩余可用调用次数（基于 10000 配额）
 * - 任务完成率统计
 */
export const UsagePanel: React.FC<UsagePanelProps> = ({ stats, onClose }) => {
  const totalCalls = stats?.resources.total_api_calls ?? 0;
  const usedPct = (totalCalls / QUOTA_LIMIT) * 100;
  const remainingPct = Math.max(0, 100 - usedPct);
  const remaining = Math.max(0, QUOTA_LIMIT - totalCalls);

  return (
    <div
      data-component="usage-panel"
      className="w-80 flex-shrink-0 bg-surface-100 border-l border-surface-300 flex flex-col h-full overflow-hidden"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-300 flex-shrink-0">
        <span className="text-sm font-medium text-surface-800">用量监控</span>
        <button
          type="button"
          onClick={onClose}
          className="text-surface-500 hover:text-surface-800 transition-colors"
          aria-label="关闭用量面板"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* API 调用次数 */}
        <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
          <div className="text-xs text-surface-600 mb-1">API 调用次数（近 5 小时）</div>
          <div className="text-2xl font-bold text-hermes-400">
            {stats ? totalCalls.toLocaleString() : '--'}
          </div>
          <div className="mt-2 w-full bg-surface-300 rounded-full h-1.5">
            <div
              className="bg-hermes-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(usedPct, 100)}%` }}
            />
          </div>
          <div className="text-xs text-surface-500 mt-1">
            配额 {QUOTA_LIMIT.toLocaleString()} · 已用 {usedPct.toFixed(1)}%
          </div>
        </div>

        {/* Token 消耗 */}
        <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
          <div className="text-xs text-surface-600 mb-1">累计 Token 消耗</div>
          <div className="text-2xl font-bold text-emerald-400">
            {stats ? formatTokens(stats.resources.total_tokens) : '--'}
          </div>
        </div>

        {/* 剩余可用调用 */}
        <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
          <div className="text-xs text-surface-600 mb-1">剩余可用调用次数</div>
          <div className="text-2xl font-bold text-hermes-400">
            {stats ? remaining.toLocaleString() : '--'}
          </div>
          <div className="mt-2 w-full bg-surface-300 rounded-full h-1.5">
            <div
              className="bg-hermes-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${remainingPct.toFixed(1)}%` }}
            />
          </div>
          <div className="text-xs text-surface-500 mt-1">剩余 {remainingPct.toFixed(1)}%</div>
        </div>

        {/* 任务统计 */}
        {stats && (
          <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
            <div className="text-xs text-surface-600 mb-2">任务统计</div>
            <div className="space-y-2 text-sm">
              <StatRow label="总任务数" value={stats.tasks.total} />
              <StatRow label="已完成" value={stats.tasks.completed} color="text-emerald-400" />
              <StatRow label="执行中" value={stats.tasks.running} color="text-hermes-400" />
              <StatRow label="失败" value={stats.tasks.failed} color="text-red-400" />
              <StatRow
                label="完成率"
                value={`${(stats.tasks.completion_rate * 100).toFixed(1)}%`}
              />
            </div>
            <div className="mt-3">
              <div className="w-full bg-surface-300 rounded-full h-1.5">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${(stats.tasks.completion_rate * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface StatRowProps {
  label: string;
  value: number | string;
  color?: string;
}

const StatRow: React.FC<StatRowProps> = ({ label, value, color = 'text-surface-900' }) => (
  <div className="flex justify-between">
    <span className="text-surface-700">{label}</span>
    <span className={color}>{value}</span>
  </div>
);

export default UsagePanel;
