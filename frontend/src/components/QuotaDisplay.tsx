/**
 * # ============================================================
 * # 用量监控显示组件 - QuotaDisplay
 * # ============================================================
 * # 核心作用：从 App.tsx 提取的用量监控面板，展示 API 调用次数、
 * #           Token 消耗、剩余配额、任务统计等数据
 * # 运行流程：
 * #   1. 接收 stats / quotaLimit / showToast 等 props
 * #   2. 渲染 API 调用次数进度条卡片
 * #   3. 渲染 Token 消耗统计卡片
 * #   4. 渲染剩余可用调用次数卡片
 * #   5. 渲染任务统计卡片（总数/已完成/执行中/失败/完成率）
 * # 输入参数：
 * #   - stats: StatsOverview | null，统计数据
 * #   - quotaLimit: number，配额上限
 * #   - onClose: () => void，关闭面板回调
 * # 输出结果：用量监控面板 JSX
 * # 修改记录：
 * #   - 2026-06-26 | v1.0.0 | 从 App.tsx 提取，作为独立组件
 * # ============================================================
 */

import type { StatsOverview } from '../types';

interface Props {
  /** 统计数据 */
  stats: StatsOverview | null;
  /** 配额上限 */
  quotaLimit: number;
  /** 关闭面板回调 */
  onClose: () => void;
}

/**
 * 格式化 Token 数量，使用 K/M 后缀
 * @param n - Token 数量
 * @returns 格式化后的字符串
 */
function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

export default function QuotaDisplay({ stats, quotaLimit, onClose }: Props) {
  return (
    <aside className="w-full md:w-80 bg-surface-100 border-t md:border-l border-surface-300 flex-shrink-0 overflow-y-auto
                      fixed bottom-0 left-0 right-0 md:static z-30 max-h-[60vh] md:max-h-none
                      rounded-t-2xl md:rounded-none shadow-2xl md:shadow-none">
      {/* 移动端拖拽手柄 */}
      <div className="flex justify-center pt-2 pb-1 md:hidden">
        <div className="w-10 h-1 rounded-full bg-surface-500/60" />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-surface-900">用量监控</h2>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-surface-600 hover:text-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 用量数据卡片 */}
        <div className="space-y-3">
          {/* API 调用次数 */}
          <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
            <div className="text-xs text-surface-600 mb-1">API 调用次数（近 5 小时）</div>
            <div className="text-2xl font-bold text-hermes-400">
              {stats ? stats.resources.total_api_calls.toLocaleString() : '--'}
            </div>
            <div className="mt-2 w-full bg-surface-300 rounded-full h-1.5">
              <div className="bg-hermes-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min((stats ? stats.resources.total_api_calls / quotaLimit * 100 : 0), 100)}%` }} />
            </div>
            <div className="text-xs text-surface-500 mt-1">
              配额 {quotaLimit.toLocaleString()} · 已用 {stats ? ((stats.resources.total_api_calls / quotaLimit * 100).toFixed(1)) : '0'}%
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
              {stats ? (quotaLimit - stats.resources.total_api_calls).toLocaleString() : '--'}
            </div>
            <div className="mt-2 w-full bg-surface-300 rounded-full h-1.5">
              <div className="bg-hermes-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${stats ? Math.max(0, (quotaLimit - stats.resources.total_api_calls) / quotaLimit * 100).toFixed(1) : 0}%` }} />
            </div>
            <div className="text-xs text-surface-500 mt-1">
              剩余 {stats ? ((quotaLimit - stats.resources.total_api_calls) / quotaLimit * 100).toFixed(1) : '0'}%
            </div>
          </div>

          {/* 任务统计 */}
          {stats && (
            <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
              <div className="text-xs text-surface-600 mb-2">任务统计</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-surface-700">总任务数</span>
                  <span className="text-surface-900">{stats.tasks.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-700">已完成</span>
                  <span className="text-emerald-400">{stats.tasks.completed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-700">执行中</span>
                  <span className="text-hermes-400">{stats.tasks.running}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-700">失败</span>
                  <span className="text-red-400">{stats.tasks.failed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-700">完成率</span>
                  <span className="text-surface-900">{(stats.tasks.completion_rate * 100).toFixed(1)}%</span>
                </div>
              </div>
              <div className="mt-3">
                <div className="w-full bg-surface-300 rounded-full h-1.5">
                  <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${(stats.tasks.completion_rate * 100).toFixed(1)}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
