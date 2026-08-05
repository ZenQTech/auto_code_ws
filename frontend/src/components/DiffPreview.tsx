/**
 * # ============================================================
 * # DiffPreview 组件 (v1.0.0)
 * # Cycle 66 G66-02
 * # ====================================
 * # 核心作用：差异预览视图
 * # 功能：
 * #   1. 显示每个文件的变更类型（modify/create/delete/unchanged）
 * #   2. unified diff 渲染
 * #   3. 增删行统计
 * #   4. 按文件折叠/展开
 * # 设计要点：
 * #   - 简洁的 diff 渲染（行号 + - 号）
 * #   - 大文件支持折叠
 * #   - 主题感知
 * # 对标：Codex checkpoint diff viewer
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
 * # ====================================
 */

import { useState } from 'react';
import type { DiffPreview, FileChange, Snapshot } from '../hooks/useSnapshots';

// ============================================================
// 类型
// ============================================================

export interface DiffPreviewViewProps {
  preview: DiffPreview;
  snapshot: Snapshot;
  onClose?: () => void;
}

const CHANGE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  modify: { label: '修改', color: 'bg-orange-100 text-orange-800', icon: '✏️' },
  create: { label: '新增', color: 'bg-green-100 text-green-800', icon: '➕' },
  delete: { label: '删除', color: 'bg-red-100 text-red-800', icon: '🗑' },
  unchanged: { label: '无变化', color: 'bg-gray-100 text-gray-600', icon: '✓' },
};

function DiffLine({ line }: { line: string }) {
  let cls = 'text-[var(--text-primary)]';
  if (line.startsWith('+') && !line.startsWith('+++')) {
    cls = 'text-green-700 bg-green-50';
  } else if (line.startsWith('-') && !line.startsWith('---')) {
    cls = 'text-red-700 bg-red-50';
  } else if (line.startsWith('@@')) {
    cls = 'text-blue-600 bg-blue-50';
  }
  return (
    <div className={`px-2 font-mono text-[10px] whitespace-pre ${cls}`}>
      {line}
    </div>
  );
}

function FileChangeView({ change }: { change: FileChange }) {
  const [expanded, setExpanded] = useState(change.change_type !== 'unchanged');
  const label = CHANGE_LABELS[change.change_type] || CHANGE_LABELS.unchanged;

  return (
    <div
      data-testid="file-change"
      className="border border-[var(--border-color)] rounded overflow-hidden"
    >
      <div
        className="flex items-center justify-between p-2 bg-[var(--bg-elevated)] cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span>{label.icon}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${label.color}`}>
            {label.label}
          </span>
          <span className="text-xs font-mono text-[var(--text-primary)] truncate">
            {change.path}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
          {change.additions > 0 && (
            <span className="text-green-600">+{change.additions}</span>
          )}
          {change.deletions > 0 && (
            <span className="text-red-600">-{change.deletions}</span>
          )}
          <span>{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {expanded && change.diff && (
        <div
          data-testid="diff-content"
          className="max-h-80 overflow-y-auto bg-[var(--bg-panel)]"
        >
          {change.diff.split('\n').map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export function DiffPreviewView({ preview, snapshot, onClose }: DiffPreviewViewProps) {
  return (
    <div
      data-testid="diff-preview"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-panel)] rounded-lg p-4 w-[800px] max-w-[90vw] h-[80vh] flex flex-col border border-[var(--border-color)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              📋 差异预览
            </h3>
            <p className="text-[10px] text-[var(--text-secondary)]">
              快照 <span className="font-mono">{snapshot.snapshot_id.slice(0, 12)}</span> · {preview.files.length} 文件
            </p>
          </div>
          <button
            data-testid="diff-close"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {preview.files.length === 0 ? (
            <div className="text-center text-xs text-[var(--text-secondary)] py-4">
              快照无文件
            </div>
          ) : (
            preview.files.map((change, i) => (
              <FileChangeView key={i} change={change} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default DiffPreviewView;
