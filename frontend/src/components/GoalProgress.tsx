/**
 * # ============================================================
 * # Goal 目标进度组件 - GoalProgress
 * # ============================================================
 * # 核心作用：展示 Loop Engineering 工作流中 Goal 导向的任务循环进度，
 * #           包括整体进度条、子目标列表、状态指示器和依赖关系。
 * # 运行流程：
 * #   1. 接收 goalData prop，若无数据渲染空状态占位
 * #   2. 渲染顶部状态栏：目标标题 + 状态徽章
 * #   3. 渲染整体进度条（completed/total）
 * #   4. 渲染子目标列表：每项含名称、状态徽章、依赖、验收标准
 * #   5. 当前子目标高亮，完成项显示对勾，失败项显示警告
 * # 输入参数：
 * #   - goalData: GoalData | null，Goal 数据，为 null 时显示空状态
 * # 输出结果：深色主题兼容的 Goal 进度卡片 DOM
 * # 修改记录：
 * #   - 2026-07-22 | v1.0.0 | 初始版本，创建 Goal 进度展示组件
 * # ============================================================
 */

import type { GoalData } from '../types';

/**
 * GoalProgress 组件 Props
 */
interface GoalProgressProps {
  /** Goal 数据，null 时显示空状态 */
  goalData: GoalData | null;
}

/** 子目标状态配置 */
const SUB_GOAL_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  pending: { label: '待执行', bg: 'bg-surface-200', text: 'text-surface-500', border: 'border-surface-400/50' },
  in_progress: { label: '执行中', bg: 'bg-hermes-500/10', text: 'text-hermes-400', border: 'border-hermes-500/30' },
  completed: { label: '已完成', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  failed: { label: '失败', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
};

/** Goal 状态配置 */
const GOAL_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  active: { label: '进行中', bg: 'bg-hermes-500/10', text: 'text-hermes-400', border: 'border-hermes-500/30' },
  completed: { label: '已完成', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  blocked: { label: '阻塞', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
};

/**
 * Goal 目标进度组件
 * 核心逻辑：
 *   - 空数据时渲染空状态提示
 *   - 整体进度条 = completed_count / total_count，颜色编码
 *   - 子目标列表按状态排序：in_progress > completed > failed > pending
 *   - 当前子目标高亮（hermes 边框 + 背景）
 *   - 已完成子目标显示绿色对勾图标
 *   - 失败子目标显示红色警告图标
 *   - 依赖关系以标签形式展示
 */
export default function GoalProgress({ goalData }: GoalProgressProps) {
  // ============================================================
  // 空状态：无 Goal 数据
  // ============================================================
  if (!goalData) {
    return (
      <div className="rounded-2xl border border-surface-400/50 bg-surface-100 p-6">
        <div className="empty-state">
          <div className="empty-icon">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-sm text-surface-600">暂无 Goal 数据</p>
          <p className="text-xs text-surface-500">等待 Goal 任务启动...</p>
        </div>
      </div>
    );
  }

  const goalStatus = GOAL_STATUS_CONFIG[goalData.status] || GOAL_STATUS_CONFIG.active;
  const progressPct = goalData.total_count > 0
    ? Math.round((goalData.completed_count / goalData.total_count) * 100)
    : 0;

  // 排序子目标：in_progress > failed > pending > completed
  const statusOrder: Record<string, number> = { in_progress: 0, failed: 1, pending: 2, completed: 3 };
  const sortedSubGoals = [...goalData.sub_goals].sort(
    (a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4)
  );

  return (
    <div className="rounded-2xl border border-surface-400/50 bg-surface-100 overflow-hidden animate-scale-in">
      {/* ============================================================ */}
      {/* 顶部：Goal 标题 + 状态徽章 */}
      {/* ============================================================ */}
      <div className="px-5 py-4 border-b border-surface-300/50">
        <div className="flex items-start justify-between gap-3 mb-3">
          {/* 左侧：目标图标 + 描述 */}
          <div className="flex items-start gap-2 min-w-0">
            <svg className="w-5 h-5 text-hermes-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <div className="min-w-0">
              <div className="text-sm font-medium text-surface-800 truncate">
                {goalData.objective}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                ID: {goalData.goal_id}
              </div>
            </div>
          </div>
          {/* 右侧：Goal 状态徽章 */}
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${goalStatus.bg} ${goalStatus.text} ${goalStatus.border}`}>
            {goalData.status === 'active' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: 'currentColor' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: 'currentColor' }} />
              </span>
            )}
            {goalData.status === 'blocked' && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            )}
            {goalStatus.label}
          </span>
        </div>

        {/* 整体进度条 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-surface-500">
              进度：{goalData.completed_count} / {goalData.total_count}
            </span>
            <span className="text-xs font-medium text-hermes-400">{progressPct}%</span>
          </div>
          <div className="w-full h-2 bg-surface-300 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-expressive"
              style={{
                width: `${progressPct}%`,
                background: progressPct >= 100
                  ? 'linear-gradient(90deg, #10b981, #34d399)'
                  : 'linear-gradient(90deg, #f0a030, #fbbf66)',
              }}
            />
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 子目标列表 */}
      {/* ============================================================ */}
      <div className="px-5 py-4">
        <h3 className="text-xs font-medium text-surface-600 uppercase tracking-wider mb-3">
          子目标列表
        </h3>
        <div className="space-y-2">
          {sortedSubGoals.map((subGoal) => {
            const statusCfg = SUB_GOAL_STATUS_CONFIG[subGoal.status] || SUB_GOAL_STATUS_CONFIG.pending;
            const isCurrent = subGoal.id === goalData.current_sub_goal;

            return (
              <div
                key={subGoal.id}
                className={`rounded-xl border px-4 py-3 transition-all duration-200
                  ${isCurrent
                    ? 'border-hermes-500/40 bg-hermes-500/5 shadow-glow-hermes-sm'
                    : `${statusCfg.border} ${statusCfg.bg}`
                  }
                `}
              >
                {/* 子目标标题行 */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* 状态图标 */}
                    {subGoal.status === 'completed' && (
                      <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {subGoal.status === 'failed' && (
                      <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    )}
                    {subGoal.status === 'in_progress' && (
                      <svg className="animate-spin w-4 h-4 text-hermes-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {subGoal.status === 'pending' && (
                      <div className="w-4 h-4 rounded-full border-2 border-surface-500 flex-shrink-0" />
                    )}
                    {/* 子目标名称 */}
                    <span className={`text-sm font-medium truncate
                      ${isCurrent ? 'text-hermes-400' : subGoal.status === 'completed' ? 'text-surface-600' : 'text-surface-700'}
                    `}>
                      {subGoal.name}
                    </span>
                  </div>
                  {/* 状态徽章 */}
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${statusCfg.text} ${statusCfg.bg}`}>
                    {statusCfg.label}
                  </span>
                </div>

                {/* 描述 */}
                {subGoal.description && (
                  <p className="text-xs text-surface-500 mb-1.5 leading-relaxed">
                    {subGoal.description}
                  </p>
                )}

                {/* 模块名称 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-surface-500 bg-surface-200 px-1.5 py-0.5 rounded">
                    {subGoal.module_name}
                  </span>
                  {/* 依赖标签 */}
                  {subGoal.dependencies.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-surface-500">依赖:</span>
                      {subGoal.dependencies.map((depId) => (
                        <span
                          key={depId}
                          className="text-surface-500 bg-surface-200 px-1 py-0.5 rounded font-mono"
                        >
                          {depId}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 验收标准 */}
                {subGoal.acceptance_criteria && (
                  <div className="mt-1.5 flex items-start gap-1">
                    <span className="text-[10px] text-surface-500 flex-shrink-0 mt-0.5">📋</span>
                    <span className="text-[10px] text-surface-500 leading-relaxed">
                      {subGoal.acceptance_criteria}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 底部：阻塞状态提示 */}
      {/* ============================================================ */}
      {goalData.status === 'blocked' && (
        <div className="px-5 py-3 border-t border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-2 text-xs text-red-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="font-medium">Goal 已被阻塞</span>
            <span className="text-surface-500">请检查失败的子目标并重新执行</span>
          </div>
        </div>
      )}
    </div>
  );
}