/**
 * # ============================================================
 * Diff Preview 模态框（v6.34.0 P1-8 新增）
 * # ============================================================
 * 核心作用：在文件保存/代码生成前展示 diff 预览，
 *           用户可选择"应用"或"取消"
 * 特性：
 *   - 集成 diff.ts 三粒度 diff（line/word/char）
 *   - 行号 + 颜色标记（add/remove/equal）
 *   - 粒度切换
 *   - 文件路径展示 + 变更统计
 *   - Apply/Cancel 操作
 * 依赖：utils/diff.ts
 * ============================================================
 */

import { useMemo, useState, useCallback } from 'react';
import { computeDiff, type DiffSegment, type DiffGranularity } from '../utils/diff';

export interface DiffPreviewModalProps {
  /** 是否打开 */
  open: boolean;
  /** 文件路径 */
  filePath: string;
  /** 修改前内容 */
  oldContent: string;
  /** 修改后内容 */
  newContent: string;
  /** 应用回调 */
  onApply: () => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 关闭回调（点击 X 或 ESC） */
  onClose: () => void;
}

const GRANULARITY_OPTIONS: Array<{ value: DiffGranularity; label: string }> = [
  { value: 'line', label: '行级' },
  { value: 'word', label: '词级' },
  { value: 'char', label: '字符级' },
];

/** 内部统一类型：equal | added | removed */
type SegmentType = 'equal' | 'added' | 'removed';

/** DiffSegment 内部表示（text/value 双字段兼容） */
interface InternalSegment {
  type: SegmentType;
  value: string;
}

/**
 * 归一化：把 diff.ts 的 DiffSegment（equal/insert/delete + text）转换为
 * 内部统一格式（equal/added/removed + value）
 */
function normalizeSegment(seg: DiffSegment): InternalSegment {
  const text = (seg as unknown as { text?: string; value?: string }).text
    ?? (seg as unknown as { value?: string }).value
    ?? '';
  let type: SegmentType = 'equal';
  // 原始 type 可能是 equal/insert/delete 或 equal/added/removed
  const rawType = (seg as { type: string }).type;
  if (rawType === 'insert' || rawType === 'added') type = 'added';
  else if (rawType === 'delete' || rawType === 'removed') type = 'removed';
  return { type, value: text };
}

/**
 * Diff 段渲染（带行号）
 */
function DiffSegmentView({
  segment,
  lineNumber,
  side,
}: {
  segment: InternalSegment;
  lineNumber: number;
  side: 'old' | 'new';
}) {
  const bgClass =
    segment.type === 'added'
      ? 'bg-emerald-500/10 text-emerald-200'
      : segment.type === 'removed'
      ? side === 'old'
        ? 'bg-rose-500/10 text-rose-200'
        : 'bg-surface-300/30 text-surface-50'
      : 'bg-transparent text-surface-200';

  const prefix =
    segment.type === 'added' ? '+' : segment.type === 'removed' ? '-' : ' ';

  return (
    <div className={['flex', 'font-mono', 'text-xs', 'leading-5', bgClass].join(' ')}>
      <span className="flex-shrink-0 w-12 text-right pr-2 text-surface-500 select-none">
        {side === 'old' ? lineNumber : ''}
      </span>
      <span className="flex-shrink-0 w-4 text-center select-none">{prefix}</span>
      <span className="flex-1 whitespace-pre-wrap break-all pl-1">
        {segment.value || '\u00A0'}
      </span>
    </div>
  );
}

/**
 * Diff Preview 模态框
 */
export function DiffPreviewModal({
  open,
  filePath,
  oldContent,
  newContent,
  onApply,
  onCancel,
  onClose,
}: DiffPreviewModalProps) {
  const [granularity, setGranularity] = useState<DiffGranularity>('line');

  // 计算 diff（raw 形态）
  const rawSegments: DiffSegment[] = useMemo(
    () => (open ? computeDiff(oldContent, newContent, granularity) : []),
    [open, oldContent, newContent, granularity]
  );

  // 归一化为内部格式
  const segments: InternalSegment[] = useMemo(
    () => rawSegments.map(normalizeSegment),
    [rawSegments]
  );

  // 统计
  const stats = useMemo(() => {
    let added = 0, removed = 0, equal = 0;
    for (const seg of segments) {
      if (seg.type === 'added') added++;
      else if (seg.type === 'removed') removed++;
      else equal++;
    }
    return { added, removed, equal, total: segments.length };
  }, [segments]);

  // 将 segments 拆分为 old 视角和 new 视角（按行聚合）
  const splitLines = useMemo(() => {
    const aggregateByLine = (
      typeFilter: (s: InternalSegment) => boolean
    ): Array<{ segment: InternalSegment; line: number; side: 'old' | 'new' }> => {
      const result: Array<{ segment: InternalSegment; line: number; side: 'old' | 'new' }> = [];
      let oldLn = 1;
      let newLn = 1;
      for (const seg of segments) {
        if (!typeFilter(seg)) continue;
        const text = seg.value || '';
        const lines = text.split('\n');
        // 去掉最后一个空行（split 的副作用）
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        for (const line of lines) {
          if (seg.type === 'removed') {
            result.push({ segment: { type: seg.type, value: line }, line: oldLn, side: 'old' });
            oldLn++;
          } else if (seg.type === 'added') {
            result.push({ segment: { type: seg.type, value: line }, line: newLn, side: 'new' });
            newLn++;
          } else {
            result.push({ segment: { type: seg.type, value: line }, line: oldLn, side: 'old' });
            result.push({ segment: { type: seg.type, value: line }, line: newLn, side: 'new' });
            oldLn++;
            newLn++;
          }
        }
      }
      return result;
    };
    return {
      oldLines: aggregateByLine((s) => s.type === 'equal' || s.type === 'removed'),
      newLines: aggregateByLine((s) => s.type === 'equal' || s.type === 'added'),
    };
  }, [segments]);
  const { oldLines, newLines } = splitLines;

  const handleApply = useCallback(() => {
    onApply();
  }, [onApply]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="代码变更预览"
      data-testid="diff-preview-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
        data-testid="diff-backdrop"
      />

      {/* 模态内容 */}
      <div className="relative z-10 flex flex-col w-full max-w-6xl h-full max-h-[85vh] bg-surface-100 border border-surface-300 rounded-lg shadow-level-4 overflow-hidden">
        {/* 头部 */}
        <header className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-surface-300 bg-surface-200">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-surface-50 truncate">
              Diff Preview
            </h2>
            <p className="text-xs text-surface-400 truncate mt-0.5" title={filePath}>
              {filePath}
            </p>
          </div>

          {/* 粒度切换 */}
          <div className="flex-shrink-0 flex items-center gap-1 px-2" role="tablist">
            {GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={granularity === opt.value}
                onClick={() => setGranularity(opt.value)}
                className={[
                  'px-3 py-1 text-xs rounded-sm transition-colors',
                  granularity === opt.value
                    ? 'bg-hermes-500/20 text-hermes-300 border border-hermes-500/40'
                    : 'bg-surface-300/50 text-surface-300 border border-transparent hover:bg-surface-300',
                ].join(' ')}
                data-testid={`granularity-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-sm text-surface-300 hover:text-surface-50 hover:bg-surface-300/50 transition-colors"
            data-testid="diff-close"
          >
            ×
          </button>
        </header>

        {/* 统计条 */}
        <div className="flex-shrink-0 flex items-center gap-4 px-5 py-2 border-b border-surface-300 bg-surface-200/50 text-xs">
          <span className="text-emerald-300" data-testid="stat-added">
            +{stats.added}
          </span>
          <span className="text-rose-300" data-testid="stat-removed">
            −{stats.removed}
          </span>
          <span className="text-surface-400" data-testid="stat-equal">
            ={stats.equal}
          </span>
          <span className="text-surface-500 ml-auto">粒度: {granularity}</span>
        </div>

        {/* Diff 主体（双栏） */}
        <div className="flex-1 overflow-auto bg-surface-50">
          <div className="grid grid-cols-2 gap-px bg-surface-300 min-h-full">
            {/* 旧内容栏 */}
            <div className="bg-surface-50" data-testid="diff-old">
              <div className="sticky top-0 z-10 px-3 py-1.5 text-xs font-medium text-surface-400 bg-surface-200 border-b border-surface-300">
                原始
              </div>
              <div className="py-1">
                {oldLines.map((item, idx) => (
                  <DiffSegmentView
                    key={`old-${idx}`}
                    segment={item.segment}
                    lineNumber={item.line}
                    side="old"
                  />
                ))}
              </div>
            </div>

            {/* 新内容栏 */}
            <div className="bg-surface-50" data-testid="diff-new">
              <div className="sticky top-0 z-10 px-3 py-1.5 text-xs font-medium text-surface-400 bg-surface-200 border-b border-surface-300">
                修改后
              </div>
              <div className="py-1">
                {newLines.map((item, idx) => (
                  <DiffSegmentView
                    key={`new-${idx}`}
                    segment={item.segment}
                    lineNumber={item.line}
                    side="new"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <footer className="flex-shrink-0 flex items-center justify-end gap-3 px-5 py-3 border-t border-surface-300 bg-surface-200">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-1.5 text-sm text-surface-300 bg-surface-300/50 rounded-sm hover:bg-surface-300 transition-colors"
            data-testid="diff-cancel"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-1.5 text-sm font-medium text-white bg-hermes-500 rounded-sm hover:bg-hermes-400 transition-colors"
            data-testid="diff-apply"
          >
            应用更改
          </button>
        </footer>
      </div>
    </div>
  );
}

export default DiffPreviewModal;
