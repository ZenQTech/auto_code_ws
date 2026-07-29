/**
 * # ============================================================
 * # StreamingLoading 流式加载组件（v6.40.0 P2-5 加载状态规范）
 * # ============================================================
 * # 核心作用：用于流式输出场景的 loading 展示，支持 AI 思考动画
 * #           通常嵌入在消息流中作为 "AI 正在思考..." 的占位
 * # 运行流程：
 * #   1. 接收 streaming 状态控制显隐
 * #   2. 接收 label/phase 显示当前阶段
 * #   3. 渲染跳动点 + 文字 + 可选进度条
 * # 输入参数：
 * #   - visible: 是否显示
 * #   - label: 描述文字（默认 "AI 正在思考..."）
 * #   - phase: 'thinking' | 'typing' | 'searching' | 'tool-calling' | 'generating'
 * #   - progress: 进度值 0-100（可选）
 * # 输出结果：流式 loading JSX
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建
 * # ============================================================
 */

import { memo } from 'react';
import { Loading } from './Loading';

export type StreamingPhase =
  | 'thinking'
  | 'typing'
  | 'searching'
  | 'tool-calling'
  | 'generating'
  | 'analyzing'
  | 'default';

/** 阶段默认文案 */
const PHASE_LABEL: Record<StreamingPhase, string> = {
  thinking: 'AI 正在思考…',
  typing: '正在输入…',
  searching: '正在搜索…',
  'tool-calling': '正在调用工具…',
  generating: '正在生成…',
  analyzing: '正在分析…',
  default: '处理中…',
};

/** 阶段图标（emoji 或字符） */
const PHASE_ICON: Record<StreamingPhase, string> = {
  thinking: '💭',
  typing: '✍️',
  searching: '🔍',
  'tool-calling': '🔧',
  generating: '✨',
  analyzing: '📊',
  default: '⏳',
};

export interface StreamingLoadingProps {
  /** 是否可见 */
  visible?: boolean;
  /** 阶段 */
  phase?: StreamingPhase;
  /** 自定义文字（覆盖 phase 默认） */
  label?: string;
  /** 进度值 0-100（可选） */
  progress?: number;
  /** 是否显示图标 */
  showIcon?: boolean;
  /** 变体 */
  variant?: 'dots' | 'spinner' | 'streaming';
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  'data-testid'?: string;
}

/**
 * StreamingLoading 流式加载组件
 * 专门用于 AI 流式输出场景的 loading 状态
 */
export const StreamingLoading = memo(function StreamingLoading({
  visible = true,
  phase = 'default',
  label,
  progress,
  showIcon = true,
  variant = 'dots',
  className = '',
  'data-testid': dataTestId = 'streaming-loading',
}: StreamingLoadingProps) {
  if (!visible) return null;

  const text = label || PHASE_LABEL[phase];
  const icon = showIcon ? PHASE_ICON[phase] : null;

  return (
    <div
      data-testid={dataTestId}
      data-component="streaming-loading"
      data-phase={phase}
      data-progress={progress}
      className={[
        'inline-flex items-center gap-2 px-3 py-1.5',
        'rounded-full',
        'bg-surface-100/80 border border-surface-200/60',
        'animate-fade-in',
        className,
      ].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
    >
      {icon && (
        <span
          data-testid={`${dataTestId}-icon`}
          className="text-base"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}

      <Loading
        variant={variant === 'streaming' ? 'dots' : variant}
        size="sm"
        color="hermes"
        data-testid={`${dataTestId}-indicator`}
      />

      <span
        data-testid={`${dataTestId}-text`}
        className="text-sm text-surface-700"
      >
        {text}
      </span>

      {typeof progress === 'number' && progress > 0 && progress < 100 && (
        <span
          data-testid={`${dataTestId}-progress`}
          className="text-xs text-surface-500 tabular-nums ml-1"
        >
          {Math.round(progress)}%
        </span>
      )}
    </div>
  );
});

export default StreamingLoading;
