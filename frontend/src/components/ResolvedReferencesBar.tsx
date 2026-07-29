/**
 * # ============================================================
 * # ResolvedReferencesBar - 已解析引用条 (v1.0.0 Cycle 18 P0-1)
 * # ============================================================
 * # 核心作用：在 Composer 输入框上方展示已解析的 @codebase / @git / @diff 引用
 * #           支持状态徽章 + 点击查看详情
 * # 运行流程：
 * #   1. 接收 ResolvedReference[] 列表
 * #   2. 渲染横排小卡片（type icon + name + state badge）
 * #   3. 悬停显示解析摘要
 * #   4. 点击触发 onReferenceClick 回调（打开详情模态）
 * # 输入参数：
 * #   - references: 已解析引用列表
 * #   - errors: 解析错误列表（可选）
 * #   - onReferenceClick?: 点击引用回调
 * #   - onRetry?: 重试解析回调
 * #   - compact?: 紧凑模式
 * # 输出结果：引用条 JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 P0-1 初次创建
 * # ============================================================
 */

import type { ResolvedReference, ResolutionError } from '../utils/composerEngine.integration';
import { useState, useMemo } from 'react';

export interface ResolvedReferencesBarProps {
  references: ResolvedReference[];
  errors?: ResolutionError[];
  onReferenceClick?: (ref: ResolvedReference) => void;
  onRetry?: () => void;
  compact?: boolean;
}

/** 类型图标 */
const TYPE_ICON: Record<'codebase' | 'git' | 'diff', string> = {
  codebase: '🔍',
  git: '🔀',
  diff: '📊',
};

/** 类型中文名 */
const TYPE_NAME: Record<'codebase' | 'git' | 'diff', string> = {
  codebase: '代码库',
  git: 'Git',
  diff: '差异',
};

/** 状态徽章配置 */
const STATE_BADGE: Record<
  ResolvedReference['state'],
  { label: string; className: string; icon: string }
> = {
  pending: { label: '等待', className: 'bg-slate-500/20 text-slate-300', icon: '⏳' },
  resolving: { label: '解析中', className: 'bg-blue-500/20 text-blue-300', icon: '⚙️' },
  resolved: { label: '已解析', className: 'bg-green-500/20 text-green-300', icon: '✓' },
  failed: { label: '失败', className: 'bg-red-500/20 text-red-300', icon: '✗' },
};

/** 单个引用卡片 */
const ReferenceCard: React.FC<{
  reference: ResolvedReference;
  compact: boolean;
  onClick: () => void;
}> = ({ reference, compact, onClick }) => {
  const badge = STATE_BADGE[reference.state];
  const icon = TYPE_ICON[reference.type];
  const typeName = TYPE_NAME[reference.type];

  // 提取展示名（去掉 @ 前缀）
  const displayName = reference.raw.startsWith('@') ? reference.raw : `@${reference.type}:${reference.value}`;

  // 提取上下文摘要
  const contextSummary = useMemo(() => {
    if (reference.state !== 'resolved' || !reference.context) return null;
    const ctx = reference.context;
    if (ctx.type === 'codebase') {
      return `${ctx.results.length} 个结果`;
    } else if (ctx.type === 'git') {
      if (Array.isArray(ctx.data)) {
        return `${ctx.data.length} 项`;
      }
      return '已加载';
    } else if (ctx.type === 'diff') {
      return `+${ctx.totalAdditions} -${ctx.totalDeletions}`;
    }
    return null;
  }, [reference]);

  return (
    <button
      data-testid={`resolved-ref-${reference.type}-${reference.value}`}
      data-state={reference.state}
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-2 py-1 rounded border transition-colors',
        compact ? 'text-xs' : 'text-sm',
        reference.state === 'resolved'
          ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10'
          : reference.state === 'failed'
            ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
            : 'border-surface-700 bg-surface-900/50 hover:bg-surface-800',
      ].join(' ')}
      title={`${typeName} 引用：${reference.raw}${contextSummary ? ' | ' + contextSummary : ''}`}
    >
      <span className="text-base leading-none">{icon}</span>
      {!compact && <span className="text-slate-200 font-mono">{displayName}</span>}
      {compact && <span className="text-slate-200 font-mono truncate max-w-[120px]">{displayName}</span>}
      <span className={['px-1.5 rounded text-xs', badge.className].join(' ')}>
        {badge.icon} {badge.label}
      </span>
    </button>
  );
};

/** 错误卡片 */
const ErrorCard: React.FC<{
  error: ResolutionError;
  onRetry?: () => void;
}> = ({ error, onRetry }) => (
  <div
    data-testid={`resolved-error-${error.type}`}
    className="flex items-center gap-1.5 px-2 py-1 rounded border border-red-500/30 bg-red-500/5 text-xs"
    title={error.error}
  >
    <span>⚠️</span>
    <span className="text-red-300 truncate max-w-[200px]">{error.raw}</span>
    {onRetry && (
      <button
        data-testid="resolved-error-retry"
        onClick={onRetry}
        className="ml-1 text-red-200 hover:text-white underline"
      >
        重试
      </button>
    )}
  </div>
);

/** 主组件 */
export const ResolvedReferencesBar: React.FC<ResolvedReferencesBarProps> = ({
  references,
  errors = [],
  onReferenceClick,
  onRetry,
  compact = false,
}) => {
  const [showAll, setShowAll] = useState(false);
  const visibleRefs = compact && !showAll ? references.slice(0, 3) : references;
  const hiddenCount = references.length - visibleRefs.length;

  if (references.length === 0 && errors.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="resolved-references-bar"
      data-count={references.length}
      className={[
        'flex flex-wrap items-center gap-1.5 p-2 rounded border',
        compact ? 'text-xs' : 'text-sm',
        'bg-surface-900/50 border-surface-700',
      ].join(' ')}
    >
      <span className="text-slate-400 text-xs font-semibold">
        已注入 {references.length} 个引用
      </span>
      {visibleRefs.map((ref, idx) => (
        <ReferenceCard
          key={`${ref.raw}-${idx}`}
          reference={ref}
          compact={compact}
          onClick={() => onReferenceClick?.(ref)}
        />
      ))}
      {hiddenCount > 0 && (
        <button
          data-testid="resolved-references-show-more"
          onClick={() => setShowAll(true)}
          className="px-2 py-1 text-xs text-blue-300 hover:text-blue-200"
        >
          +{hiddenCount} 更多
        </button>
      )}
      {errors.map((err, idx) => (
        <ErrorCard key={`err-${idx}`} error={err} onRetry={onRetry} />
      ))}
    </div>
  );
};

export default ResolvedReferencesBar;
