/**
 * # ============================================================
 * # UndoConfirmDialog 组件 (v1.0.0)
 * # Cycle 66 G66-02
 * # ====================================
 * # 核心作用：冲突确认对话框，要求用户显式确认强制恢复
 * # 功能：
 * #   1. 显示冲突文件列表
 * #   2. 显示 expected/actual hash 对比
 * #   3. 用户确认后触发 force restore
 * #   4. 取消则放弃恢复
 * # 设计要点：
 * #   - 危险操作二次确认
 * #   - 冲突类型图标（modified/deleted/added）
 * #   - 显示预览内容（前 200 字符）
 * # 对标：Codex /undo 冲突 UI
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
 * # ====================================
 */

import type { Conflict, Snapshot } from '../hooks/useSnapshots';

// ============================================================
// 类型
// ============================================================

export interface UndoConfirmDialogProps {
  snapshot: Snapshot;
  conflicts: Conflict[];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  file_modified: { label: '已修改', color: 'text-orange-700', icon: '✏️' },
  file_deleted: { label: '已删除', color: 'text-red-700', icon: '🗑' },
  file_added: { label: '已新增', color: 'text-blue-700', icon: '➕' },
};

// ============================================================
// 主组件
// ============================================================

export function UndoConfirmDialog({
  snapshot,
  conflicts,
  onConfirm,
  onCancel,
}: UndoConfirmDialogProps) {
  return (
    <div
      data-testid="undo-confirm-dialog"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-[var(--bg-panel)] rounded-lg p-4 w-[500px] max-w-[90vw] max-h-[80vh] flex flex-col border border-[var(--border-color)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            ⚠️ 检测到 {conflicts.length} 个冲突
          </h3>
          <button
            onClick={onCancel}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* Description */}
        <p className="text-xs text-[var(--text-secondary)] mb-3">
          恢复快照 <span className="font-mono">{snapshot.snapshot_id.slice(0, 12)}</span> 将覆盖以下文件。
          强制恢复会丢弃当前的本地修改。
        </p>

        {/* Conflicts List */}
        <div
          data-testid="conflicts-list"
          className="flex-1 overflow-y-auto space-y-1 mb-3"
        >
          {conflicts.map((c, i) => {
            const t = TYPE_LABELS[c.type] || TYPE_LABELS.file_modified;
            return (
              <div
                key={i}
                data-testid="conflict-item"
                className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]"
              >
                <div className="flex items-center gap-2">
                  <span>{t.icon}</span>
                  <span className={`text-xs font-medium ${t.color}`}>
                    {t.label}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-primary)] flex-1 truncate">
                    {c.path}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-[var(--text-secondary)]">
                  <div>
                    <div>快照 hash:</div>
                    <code className="font-mono">
                      {c.expected_hash || '(空)'}
                    </code>
                  </div>
                  <div>
                    <div>当前 hash:</div>
                    <code className="font-mono">{c.actual_hash || '(空)'}</code>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
          <button
            data-testid="undo-cancel"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)] hover:bg-[var(--bg-panel)]"
          >
            取消
          </button>
          <button
            data-testid="undo-confirm"
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white font-medium"
          >
            强制恢复
          </button>
        </div>
      </div>
    </div>
  );
}

export default UndoConfirmDialog;
