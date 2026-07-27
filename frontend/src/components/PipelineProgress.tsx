/**
 * # ============================================================
 * # 全链路流水线测试进度组件 - PipelineProgress
 * # ============================================================
 * # 核心作用：展示 Loop Engineering 工作流中全链路流水线测试的进度，
 * #           以垂直时间线形式展示 6 个步骤的状态和结果。
 * # 运行流程：
 * #   1. 接收 pipelineData prop，若无数据渲染空状态占位
 * #   2. 渲染顶部状态徽章：运行中/已完成/失败
 * #   3. 渲染垂直时间线：每步含步骤名称、状态图标、时间戳
 * #   4. 当前步骤高亮，失败步骤显示错误信息
 * #   5. 底部渲染关键指标：模块通过率、Git 提交、集成测试
 * # 输入参数：
 * #   - pipelineData: PipelineData | null，流水线数据，为 null 时显示空状态
 * # 输出结果：深色主题兼容的流水线进度卡片 DOM
 * # 修改记录：
 * #   - 2026-07-22 | v1.0.0 | 初始版本，创建流水线进度展示组件
 * # ============================================================
 */

import type { PipelineData } from '../types';

/** 步骤名称中文映射 */
const STEP_LABELS: Record<string, string> = {
  'prompt_injection': '提示词注入',
  'requirement_refinement': '需求细化',
  'code_generation': '代码生成',
  'task_evaluation': '任务评判',
  'git_commit': 'Git提交',
  'integration_test': '集成测试',
};

/**
 * PipelineProgress 组件 Props
 */
interface PipelineProgressProps {
  /** 流水线数据，null 时显示空状态 */
  pipelineData: PipelineData | null;
}

/**
 * 根据步骤状态返回对应的图标组件
 * 参数：
 *   - status: 步骤状态
 *   - isCurrent: 是否为当前步骤
 * 返回值：SVG 图标 JSX
 */
function StepIcon({ status, isCurrent }: { status: string; isCurrent: boolean }) {
  switch (status) {
    case 'running':
      return (
        <div className="relative">
          <svg className="animate-spin w-4 h-4 text-hermes-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {isCurrent && (
            <span className="absolute -inset-1 rounded-full border-2 border-hermes-400/30 animate-ping" />
          )}
        </div>
      );
    case 'completed':
      return (
        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'failed':
      return (
        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    default:
      return (
        <div className="w-4 h-4 rounded-full border-2 border-surface-500" />
      );
  }
}

/**
 * 格式化 ISO 时间字符串为可读格式
 * 参数：isoStr - ISO 时间字符串
 * 返回值：格式化后的时间字符串（HH:mm:ss），无效时返回 '--'
 */
function formatTime(isoStr?: string): string {
  if (!isoStr) return '--';
  try {
    return new Date(isoStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '--';
  }
}

/**
 * 全链路流水线测试进度组件
 * 核心逻辑：
 *   - 空数据时渲染空状态提示
 *   - 顶部状态徽章根据 overall_status 切换颜色
 *   - 垂直时间线：已完成步骤浅色连线，当前步骤高亮 + 脉冲动画，失败步骤红色
 *   - 当前步骤位于 running 状态，运行中步骤显示旋转动画
 *   - 失败步骤展开显示错误信息
 */
export default function PipelineProgress({ pipelineData }: PipelineProgressProps) {
  // ============================================================
  // 空状态：无流水线数据
  // ============================================================
  if (!pipelineData) {
    return (
      <div className="rounded-2xl border border-surface-400/50 bg-surface-100 p-6">
        <div className="empty-state">
          <div className="empty-icon">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-sm text-surface-600">暂无流水线数据</p>
          <p className="text-xs text-surface-500">等待流水线启动...</p>
        </div>
      </div>
    );
  }

  // 确定当前步骤：第一个 running 状态的步骤，若无则取最后一个 completed 后的 pending
  const currentStepIndex = pipelineData.steps.findIndex(s => s.status === 'running');

  const statusConfig = {
    running: { label: '运行中', bg: 'bg-hermes-500/10', text: 'text-hermes-400', border: 'border-hermes-500/30' },
    completed: { label: '已完成', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    failed: { label: '失败', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  };

  const overall = statusConfig[pipelineData.overall_status] || statusConfig.running;

  return (
    <div className="rounded-2xl border border-surface-400/50 bg-surface-100 overflow-hidden animate-scale-in">
      {/* ============================================================ */}
      {/* 顶部：整体状态 + 关键指标 */}
      {/* ============================================================ */}
      <div className="px-5 py-4 border-b border-surface-300/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-sm font-medium text-surface-700">全链路流水线测试</span>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${overall.bg} ${overall.text} ${overall.border}`}>
            {pipelineData.overall_status === 'running' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: 'currentColor' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: 'currentColor' }} />
              </span>
            )}
            {overall.label}
          </span>
        </div>

        {/* 关键指标横条 */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-lg px-3 py-2 text-center ${pipelineData.all_modules_passed ? 'bg-emerald-500/10' : 'bg-surface-200'}`}>
            <div className="text-[10px] text-surface-500 mb-0.5">模块通过</div>
            <span className={`text-sm font-medium ${pipelineData.all_modules_passed ? 'text-emerald-400' : 'text-surface-600'}`}>
              {pipelineData.all_modules_passed ? (
                <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : '--'}
            </span>
          </div>
          <div className={`rounded-lg px-3 py-2 text-center ${pipelineData.git_commit_success ? 'bg-emerald-500/10' : 'bg-surface-200'}`}>
            <div className="text-[10px] text-surface-500 mb-0.5">Git提交</div>
            <span className={`text-sm font-medium ${pipelineData.git_commit_success ? 'text-emerald-400' : 'text-surface-600'}`}>
              {pipelineData.git_commit_success ? (
                <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : '--'}
            </span>
          </div>
          <div className={`rounded-lg px-3 py-2 text-center ${pipelineData.integration_test_passed ? 'bg-emerald-500/10' : 'bg-surface-200'}`}>
            <div className="text-[10px] text-surface-500 mb-0.5">集成测试</div>
            <span className={`text-sm font-medium ${pipelineData.integration_test_passed ? 'text-emerald-400' : 'text-surface-600'}`}>
              {pipelineData.integration_test_passed ? (
                <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 垂直时间线 */}
      {/* ============================================================ */}
      <div className="px-5 py-4">
        <div className="relative">
          {pipelineData.steps.map((step, index) => {
            const isCurrent = index === currentStepIndex;
            const isLast = index === pipelineData.steps.length - 1;
            const label = STEP_LABELS[step.step_name] || step.step_name;

            return (
              <div key={step.step_name} className="relative flex gap-3">
                {/* 左侧时间线 */}
                <div className="flex flex-col items-center">
                  {/* 状态图标容器 */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center
                    ${isCurrent ? 'bg-hermes-500/15 border border-hermes-500/30' : ''}
                    ${step.status === 'completed' ? 'bg-emerald-500/10' : ''}
                    ${step.status === 'failed' ? 'bg-red-500/10' : ''}
                    ${step.status === 'pending' ? 'bg-surface-200' : ''}
                  `}>
                    <StepIcon status={step.status} isCurrent={isCurrent} />
                  </div>
                  {/* 连线 */}
                  {!isLast && (
                    <div className={`w-0.5 flex-1 min-h-[24px] my-0.5 rounded-full
                      ${step.status === 'completed'
                        ? 'bg-emerald-500/30'
                        : step.status === 'failed'
                          ? 'bg-red-500/20'
                          : 'bg-surface-300'
                      }`}
                    />
                  )}
                </div>

                {/* 右侧步骤内容 */}
                <div className={`flex-1 pb-4 ${!isLast ? '' : 'pb-0'}`}>
                  {/* 步骤标题行 */}
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium
                      ${isCurrent ? 'text-hermes-400' : step.status === 'completed' ? 'text-surface-700' : 'text-surface-500'}
                    `}>
                      {label}
                    </span>
                    <span className="text-[10px] text-surface-500">
                      {isCurrent && step.started_at
                        ? formatTime(step.started_at)
                        : step.status === 'completed' && step.completed_at
                          ? formatTime(step.completed_at)
                          : ''}
                    </span>
                  </div>

                  {/* 运行中动画指示 */}
                  {isCurrent && step.status === 'running' && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-block h-1.5 w-16 bg-surface-300 rounded-full overflow-hidden">
                        <span className="block h-full bg-hermes-500 rounded-full animate-shimmer"
                          style={{ width: '60%', backgroundSize: '200% 100%' }} />
                      </span>
                      <span className="text-[10px] text-hermes-400">执行中...</span>
                    </div>
                  )}

                  {/* 失败错误信息 */}
                  {step.status === 'failed' && step.error && (
                    <div className="mt-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                      <div className="flex items-start gap-1.5">
                        <svg className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <span className="text-xs text-red-300 leading-relaxed">{step.error}</span>
                      </div>
                    </div>
                  )}

                  {/* 已完成步骤输出 */}
                  {step.status === 'completed' && step.output && (
                    <div className="mt-1 text-xs text-surface-600">
                      <span className="text-emerald-400">✓</span> {step.output}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 底部：流水线总结 */}
      {/* ============================================================ */}
      {pipelineData.summary && (
        <div className="px-5 py-4 border-t border-surface-300/50">
          <div className="text-xs text-surface-500 leading-relaxed whitespace-pre-wrap">
            {pipelineData.summary}
          </div>
        </div>
      )}
    </div>
  );
}