/**
 * # ============================================================
 * # QuotaPanel 配额监控面板组件
 * # ============================================================
 * # 核心作用：展示 API 配额用量监控数据，包含三个时间维度
 * #           （5h/week/month）的进度条、告警级别、并行任务
 * #           限制、每分钟调用次数、Token 消耗统计
 * # 运行流程：
 * #   1. 组件挂载时通过 useQuota() 拉取配额概览数据
 * #   2. 每 30 秒自动刷新数据（由 useQuota hook 内置实现）
 * #   3. 渲染三个时间维度的进度条，颜色根据使用率变化
 * #   4. 渲染告警级别指示器（绿/黄/橙/红）
 * #   5. 渲染并行任务数、调用频率、Token 消耗统计卡片
 * # 输入参数：无（通过 useQuota hook 获取数据）
 * # 输出结果：配额监控面板 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现配额监控面板
 * # ============================================================
 */

import { useQuota } from '../hooks/useApi';
import type { AlertLevel } from '../types';
import PanelSkeleton from './PanelSkeleton';

/**
 * 告警级别颜色映射
 * 作用：将告警级别映射为对应的 Tailwind 颜色类名
 * green=绿色安全，yellow=黄色注意，orange=橙色警告，red=红色危险
 */
const alertColorMap: Record<AlertLevel, { bg: string; text: string; border: string; glow: string }> = {
  green:  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20' },
  yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', glow: 'shadow-yellow-500/20' },
  orange: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', glow: 'shadow-orange-500/20' },
  red:    { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-red-500/20' },
};

/**
 * 告警级别中文标签
 * 作用：将告警级别枚举值映射为中文显示文本
 */
const alertLabelMap: Record<AlertLevel, string> = {
  green:  '正常',
  yellow: '注意',
  orange: '警告',
  red:    '危险',
};

/**
 * 根据使用百分比返回进度条颜色
 * 作用：根据配额使用百分比动态确定进度条颜色
 * 规则：<60% 绿色，60-80% 黄色，80-95% 橙色，>=95% 红色
 * @param percentage - 使用百分比（0-100）
 * @returns Tailwind 背景色类名
 */
function getProgressColor(percentage: number): string {
  if (percentage >= 95) return 'bg-red-500';
  if (percentage >= 80) return 'bg-orange-500';
  if (percentage >= 60) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

/**
 * 格式化大数字，使用 K/M 后缀
 * 作用：将大数字格式化为易读的 K/M 后缀形式
 * @param n - 原始数字
 * @returns 格式化后的字符串
 */
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export default function QuotaPanel() {
  /** 配额概览数据，通过 useQuota hook 获取，每 30 秒自动刷新 */
  const { quota, loading } = useQuota();

  // ============================================================
  // 加载态：显示骨架屏（v1.1.0：使用 PanelSkeleton 统一组件）
  // ============================================================
  if (loading && !quota) {
    return <PanelSkeleton variant="quota" />;
  }

  // ============================================================
  // 空数据态
  // ============================================================
  if (!quota) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">📊</span>
          <span>暂无配额数据</span>
        </div>
      </div>
    );
  }

  const alertStyle = alertColorMap[quota.alert_level];

  return (
    <div className={`glass rounded-xl p-5 animate-fade-in border ${alertStyle.border}`}>
      {/* ============================================================
       * 标题栏：图标 + 标题 + 告警级别徽章
       * ============================================================ */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          {/* 配额图标 */}
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">配额监控</h3>
        </div>
        {/* 告警级别徽章 */}
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${alertStyle.bg} ${alertStyle.text}`}>
          {alertLabelMap[quota.alert_level]}
        </span>
      </div>

      {/* ============================================================
       * 三个时间维度的配额进度条
       * ============================================================ */}
      <div className="space-y-4 mb-5">
        {quota.dimensions.map((dim) => (
          <div key={dim.label} className="space-y-1.5">
            {/* 维度标签 + 用量数字 */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-surface-700">
                {dim.label === '5h' ? '近 5 小时' : dim.label === 'week' ? '本周' : '本月'}
              </span>
              <span className="text-xs text-surface-600">
                {formatNumber(dim.used)} / {formatNumber(dim.total)}
                <span className="ml-1 text-surface-500">({dim.percentage.toFixed(1)}%)</span>
              </span>
            </div>
            {/* 进度条容器 */}
            <div className="w-full h-2 bg-surface-200 rounded-full overflow-hidden">
              {/* 进度条填充，宽度根据百分比动态变化，颜色根据使用率变化 */}
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${getProgressColor(dim.percentage)}`}
                style={{ width: `${Math.min(dim.percentage, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ============================================================
       * 统计卡片网格：并行任务 / 调用频率 / Token 消耗
       * ============================================================ */}
      <div className="grid grid-cols-2 gap-3">
        {/* 并行任务数 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300">
          <div className="text-xs text-surface-600 mb-1">并行任务</div>
          <div className="text-lg font-semibold text-surface-900">
            {quota.current_parallel_tasks}
            <span className="text-sm font-normal text-surface-500"> / {quota.max_parallel_tasks}</span>
          </div>
          {/* 并行任务使用率小进度条 */}
          <div className="w-full h-1 bg-surface-200 rounded-full mt-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getProgressColor(
                quota.max_parallel_tasks > 0
                  ? (quota.current_parallel_tasks / quota.max_parallel_tasks) * 100
                  : 0
              )}`}
              style={{
                width: `${quota.max_parallel_tasks > 0
                  ? Math.min((quota.current_parallel_tasks / quota.max_parallel_tasks) * 100, 100)
                  : 0}%`
              }}
            />
          </div>
        </div>

        {/* 每分钟调用次数 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300">
          <div className="text-xs text-surface-600 mb-1">调用频率/分钟</div>
          <div className="text-lg font-semibold text-surface-900">
            {quota.current_calls_per_minute}
            <span className="text-sm font-normal text-surface-500"> / {quota.max_calls_per_minute}</span>
          </div>
          {/* 调用频率使用率小进度条 */}
          <div className="w-full h-1 bg-surface-200 rounded-full mt-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getProgressColor(
                quota.max_calls_per_minute > 0
                  ? (quota.current_calls_per_minute / quota.max_calls_per_minute) * 100
                  : 0
              )}`}
              style={{
                width: `${quota.max_calls_per_minute > 0
                  ? Math.min((quota.current_calls_per_minute / quota.max_calls_per_minute) * 100, 100)
                  : 0}%`
              }}
            />
          </div>
        </div>

        {/* 输入 Token 消耗 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300">
          <div className="text-xs text-surface-600 mb-1">输入 Token</div>
          <div className="text-lg font-semibold text-hermes-400">
            {formatNumber(quota.total_input_tokens)}
          </div>
        </div>

        {/* 输出 Token 消耗 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300">
          <div className="text-xs text-surface-600 mb-1">输出 Token</div>
          <div className="text-lg font-semibold text-emerald-400">
            {formatNumber(quota.total_output_tokens)}
          </div>
        </div>
      </div>

      {/* ============================================================
       * 底部更新时间
       * ============================================================ */}
      <div className="mt-4 pt-3 border-t border-surface-300 flex items-center justify-between">
        <span className="text-xs text-surface-500">
          更新于 {new Date(quota.updated_at).toLocaleTimeString('zh-CN')}
        </span>
        {/* 自动刷新指示器 */}
        <span className="flex items-center gap-1.5 text-xs text-surface-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          自动刷新
        </span>
      </div>
    </div>
  );
}
