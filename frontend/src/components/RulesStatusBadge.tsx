/**
 * # ============================================================
 * # RulesStatusBadge - 规则状态徽章 (v1.0.0 Cycle 18 P0-1)
 * # ============================================================
 * # 核心作用：在 Composer 底部状态栏显示当前项目规则
 * #           点击打开 RulesPanel 进行编辑
 * # 运行流程：
 * #   1. 接收 projectRules + metadata
 * #   2. 渲染状态徽章（规则数 + 模板名）
 * #   3. 点击触发 onClick 回调
 * # 输入参数：
 * #   - templateName?: 当前规则模板名
 * #   - total: 规则总数
 * #   - isDefault: 是否使用默认规则
 * #   - onClick?: 点击回调
 * #   - compact?: 紧凑模式
 * # 输出结果：状态徽章 JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 P0-1 初次创建
 * # ============================================================
 */

import type { RulesMetadata } from '../utils/composerEngine.integration';

export interface RulesStatusBadgeProps {
  templateName?: string;
  metadata: RulesMetadata;
  onClick?: () => void;
  compact?: boolean;
}

/** 状态颜色 */
function getBadgeClass(isDefault: boolean, total: number): string {
  if (isDefault) {
    return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
  if (total > 20) {
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  }
  return 'bg-green-500/20 text-green-300 border-green-500/30';
}

export const RulesStatusBadge: React.FC<RulesStatusBadgeProps> = ({
  templateName,
  metadata,
  onClick,
  compact = false,
}) => {
  const label = templateName ?? (metadata.isDefault ? '默认规则' : '自定义规则');
  const badgeClass = getBadgeClass(metadata.isDefault, metadata.total);

  return (
    <button
      data-testid="rules-status-badge"
      data-default={metadata.isDefault}
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors',
        compact ? 'text-xs' : 'text-sm',
        badgeClass,
        onClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default',
      ].join(' ')}
      title={onClick ? '点击编辑规则' : '当前项目规则'}
    >
      <span className="leading-none">📐</span>
      <span className="font-mono">{label}</span>
      {!compact && (
        <span className="text-slate-400 text-xs">({metadata.total})</span>
      )}
    </button>
  );
};

export default RulesStatusBadge;
