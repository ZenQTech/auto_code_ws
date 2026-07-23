/**
 * # ============================================================
 * # SecurityReviewPanel 安全审查面板组件
 * # ============================================================
 * # 核心作用：展示安全审查记录，包含检查项清单（通过/失败
 * #           状态）、审查历史、迭代次数
 * # 运行流程：
 * #   1. 组件挂载时通过 useSecurityReview() 拉取审查数据
 * #   2. 渲染审查状态和迭代信息
 * #   3. 渲染检查项清单（按分类分组，显示通过/失败状态）
 * #   4. 显示审查人和审查时间
 * # 输入参数：无（通过 useSecurityReview hook 获取数据）
 * # 输出结果：安全审查面板 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现安全审查面板
 * # ============================================================
 */

import { useSecurityReview } from '../hooks/useApi';
import type { SecurityCheckStatus } from '../types';
import PanelSkeleton from './PanelSkeleton';

/**
 * 检查项状态颜色映射
 * 作用：将安全检查项状态映射为对应的 Tailwind 颜色类名和图标
 * pass=绿色通过，fail=红色失败，pending=灰色等待中
 */
const checkStatusMap: Record<SecurityCheckStatus, { bg: string; text: string; icon: string; label: string }> = {
  pass:    { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '✅', label: '通过' },
  fail:    { bg: 'bg-red-500/20', text: 'text-red-400', icon: '❌', label: '失败' },
  pending: { bg: 'bg-surface-300/50', text: 'text-surface-500', icon: '⏳', label: '等待中' },
};

export default function SecurityReviewPanel() {
  /** 安全审查数据 */
  const { review, loading } = useSecurityReview();

  // ============================================================
  // 加载态（v1.1.0：使用 PanelSkeleton 统一组件）
  // ============================================================
  if (loading && !review) {
    return <PanelSkeleton variant="security" />;
  }

  // ============================================================
  // 空数据态
  // ============================================================
  if (!review) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">🔒</span>
          <span>暂无安全审查数据</span>
        </div>
      </div>
    );
  }

  // ============================================================
  // 按分类对检查项进行分组
  // 作用：将检查项按 category 字段分组，便于按分类展示
  // ============================================================
  const groupedChecklist: Record<string, typeof review.checklist> = {};
  review.checklist.forEach(item => {
    const cat = item.category || '其他';
    if (!groupedChecklist[cat]) {
      groupedChecklist[cat] = [];
    }
    groupedChecklist[cat].push(item);
  });

  // 统计各状态数量
  const passCount = review.checklist.filter(i => i.status === 'pass').length;
  const failCount = review.checklist.filter(i => i.status === 'fail').length;
  const pendingCount = review.checklist.filter(i => i.status === 'pending').length;

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏：图标 + 标题 + 审查状态
       * ============================================================ */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
        <div className="flex items-center gap-3">
          {/* 安全图标 */}
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">安全审查</h3>
        </div>

        {/* 审查状态徽章 */}
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
          review.all_passed
            ? 'bg-emerald-500/20 text-emerald-400'
            : review.status === 'failed'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-yellow-500/20 text-yellow-400'
        }`}>
          {review.all_passed ? '全部通过' : review.status === 'failed' ? '未通过' : '审查中'}
        </span>
      </div>

      {/* ============================================================
       * 审查概览卡片：迭代次数 + 统计 + 审查信息
       * ============================================================ */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {/* 迭代次数 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300 text-center">
          <div className="text-xs text-surface-500 mb-1">迭代次数</div>
          <div className="text-lg font-semibold text-hermes-400">{review.iteration}</div>
        </div>
        {/* 通过数 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300 text-center">
          <div className="text-xs text-surface-500 mb-1">通过</div>
          <div className="text-lg font-semibold text-emerald-400">{passCount}</div>
        </div>
        {/* 失败数 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300 text-center">
          <div className="text-xs text-surface-500 mb-1">失败</div>
          <div className="text-lg font-semibold text-red-400">{failCount}</div>
        </div>
        {/* 等待中 */}
        <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300 text-center">
          <div className="text-xs text-surface-500 mb-1">等待中</div>
          <div className="text-lg font-semibold text-surface-500">{pendingCount}</div>
        </div>
      </div>

      {/* ============================================================
       * 检查项清单（按分类分组）
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto pr-2 min-h-0 space-y-4">
        {Object.entries(groupedChecklist).map(([category, items]) => (
          <div key={category}>
            {/* 分类标题 */}
            <h4 className="text-sm font-semibold text-surface-700 mb-2 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-hermes-400" />
              {category}
              <span className="text-xs font-normal text-surface-500">({items.length} 项)</span>
            </h4>

            {/* 检查项列表 */}
            <div className="space-y-1.5">
              {items.map(item => {
                const statusStyle = checkStatusMap[item.status];
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors ${
                      item.status === 'fail'
                        ? 'border-red-500/20 bg-red-500/5'
                        : item.status === 'pass'
                          ? 'border-emerald-500/10 bg-emerald-500/5'
                          : 'border-surface-300 bg-surface-100/30'
                    }`}
                  >
                    {/* 状态图标 */}
                    <span className="text-sm flex-shrink-0 mt-0.5">{statusStyle.icon}</span>

                    {/* 检查项内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-surface-900">{item.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </div>
                      <p className="text-xs text-surface-600">{item.description}</p>
                      {/* 检查详情（仅失败项显示） */}
                      {item.status === 'fail' && item.detail && (
                        <p className="text-xs text-red-400 mt-1 bg-red-500/5 rounded p-1.5">
                          {item.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ============================================================
       * 底部：审查人 + 审查时间
       * ============================================================ */}
      <div className="mt-4 pt-3 border-t border-surface-300 flex items-center justify-between text-xs text-surface-500">
        <span>审查人：{review.reviewer}</span>
        <span>审查时间：{new Date(review.reviewed_at).toLocaleString('zh-CN')}</span>
      </div>
    </div>
  );
}
