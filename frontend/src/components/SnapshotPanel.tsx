/**
 * # ============================================================
 * # SnapshotPanel 组件 (v1.0.0)
 * # Cycle 66 G66-02
 * # ====================================
 * # 核心作用：快照列表 + 创建/恢复/删除 UI
 * # 功能：
 * #   1. 显示会话快照列表（时间倒序）
 * #   2. 创建快照（手动）
 * #   3. 预览 diff
 * #   4. 恢复（含冲突处理）
 * #   5. 删除快照
 * #   6. 状态徽章（manual/auto/pre_edit）
 * # 设计要点：
 * #   - 紧凑列表 + 详情展开
 * #   - 主题感知（CSS variables）
 * #   - 键盘快捷键（Enter 恢复，Del 删除）
 * #   - 与 UndoConfirmDialog 集成
 * # 对标：Codex /undo + agent-rollback checkpoint UI
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
 * # ====================================
 */

import { useCallback, useState } from 'react';
import type { DiffPreview, Snapshot } from '../hooks/useSnapshots';
import { useSnapshots } from '../hooks/useSnapshots';
import { UndoConfirmDialog } from './UndoConfirmDialog';
import { DiffPreviewView } from './DiffPreview';

// ============================================================
// 类型
// ============================================================

export interface SnapshotPanelProps {
  sessionId: string;
  agentId?: string;
  onRestore?: (snapshotId: string, fileCount: number) => void;
}

const TRIGGER_LABELS: Record<string, { label: string; color: string }> = {
  manual: { label: '手动', color: 'bg-blue-100 text-blue-800' },
  auto: { label: '自动', color: 'bg-green-100 text-green-800' },
  pre_edit: { label: '预编辑', color: 'bg-yellow-100 text-yellow-800' },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function formatRelative(ts: number): string {
  const diff = (Date.now() / 1000) - ts;
  if (diff < 60) return `${Math.floor(diff)} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

// ============================================================
// 子组件
// ============================================================

interface SnapshotItemProps {
  snapshot: Snapshot;
  onPreview: (s: Snapshot) => void;
  onRestore: (s: Snapshot) => void;
  onDelete: (s: Snapshot) => void;
  isActive: boolean;
  onSelect: () => void;
}

function SnapshotItem({
  snapshot,
  onPreview,
  onRestore,
  onDelete,
  isActive,
  onSelect,
}: SnapshotItemProps) {
  const trigger = TRIGGER_LABELS[snapshot.trigger] || TRIGGER_LABELS.manual;
  return (
    <div
      data-testid="snapshot-item"
      onClick={onSelect}
      className={`p-2 rounded border cursor-pointer transition-colors ${
        isActive
          ? 'border-blue-500 bg-[var(--bg-elevated)]'
          : 'border-[var(--border-color)] hover:bg-[var(--bg-elevated)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${trigger.color}`}>
              {trigger.label}
            </span>
            <span className="text-xs font-mono text-[var(--text-primary)]">
              {snapshot.snapshot_id.slice(0, 8)}
            </span>
          </div>
          {snapshot.description && (
            <div className="text-xs text-[var(--text-secondary)] truncate mt-1">
              {snapshot.description}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--text-secondary)]">
            <span>📁 {snapshot.file_count} 文件</span>
            <span>💾 {formatBytes(snapshot.total_size)}</span>
            <span title={formatTime(snapshot.created_at)}>
              🕐 {formatRelative(snapshot.created_at)}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            data-testid="snapshot-preview-btn"
            onClick={() => onPreview(snapshot)}
            className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]"
            title="预览差异"
          >
            👁 预览
          </button>
          <button
            data-testid="snapshot-restore-btn"
            onClick={() => onRestore(snapshot)}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-500 hover:bg-blue-600 text-white"
            title="恢复快照"
          >
            ↶ 恢复
          </button>
          <button
            data-testid="snapshot-delete-btn"
            onClick={() => onDelete(snapshot)}
            className="text-[10px] px-2 py-0.5 rounded bg-red-500 hover:bg-red-600 text-white"
            title="删除快照"
          >
            🗑 删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export function SnapshotPanel({
  sessionId,
  agentId = 'default',
  onRestore,
}: SnapshotPanelProps) {
  const {
    snapshots,
    total,
    loading,
    error,
    create,
    remove,
    restore,
    preview,
    refresh,
  } = useSnapshots({ sessionId });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    snapshot: Snapshot;
    conflicts: any[];
  } | null>(null);
  const [showPreview, setShowPreview] = useState<{
    snapshot: Snapshot;
    preview: DiffPreview;
  } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createPaths, setCreatePaths] = useState('');
  const [createDesc, setCreateDesc] = useState('');

  // ============================================================
  // 恢复处理
  // ============================================================

  const handleRestore = useCallback(
    async (snapshot: Snapshot, force = false) => {
      const result = await restore(snapshot.snapshot_id, {
        force,
        actor: 'user',
      });
      if (!result) return;
      if (result.status === 'pending_confirm') {
        setPendingRestore({ snapshot, conflicts: result.conflicts });
      } else {
        onRestore?.(snapshot.snapshot_id, result.applied.length);
      }
    },
    [restore, onRestore]
  );

  // ============================================================
  // 预览
  // ============================================================

  const handlePreview = useCallback(
    async (snapshot: Snapshot) => {
      const p = await preview(snapshot.snapshot_id);
      if (p) {
        setShowPreview({ snapshot, preview: p });
      }
    },
    [preview]
  );

  // ============================================================
  // 删除
  // ============================================================

  const handleDelete = useCallback(
    async (snapshot: Snapshot) => {
      if (window.confirm(`确定删除快照 ${snapshot.snapshot_id.slice(0, 8)} 吗？`)) {
        await remove(snapshot.snapshot_id);
      }
    },
    [remove]
  );

  // ============================================================
  // 创建
  // ============================================================

  const handleCreate = useCallback(async () => {
    const paths = createPaths
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p);
    if (paths.length === 0) {
      window.alert('请输入至少一个文件路径');
      return;
    }
    const snap = await create({
      paths,
      agentId,
      trigger: 'manual',
      description: createDesc,
    });
    if (snap) {
      setShowCreate(false);
      setCreatePaths('');
      setCreateDesc('');
    }
  }, [create, createPaths, createDesc, agentId]);

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <div data-testid="snapshot-panel" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            📸 快照管理
          </h3>
          <p className="text-[10px] text-[var(--text-secondary)]">
            共 {total} 个快照
          </p>
        </div>
        <div className="flex gap-1">
          <button
            data-testid="snapshot-refresh-btn"
            onClick={() => refresh()}
            disabled={loading}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)] hover:bg-[var(--bg-panel)]"
            title="刷新列表"
          >
            🔄
          </button>
          <button
            data-testid="snapshot-create-btn"
            onClick={() => setShowCreate(true)}
            className="text-xs px-2 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white"
            title="创建快照"
          >
            + 新建
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="m-2 p-2 rounded bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && snapshots.length === 0 ? (
          <div className="text-center text-xs text-[var(--text-secondary)] py-4">
            加载中...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center text-xs text-[var(--text-secondary)] py-4">
            暂无快照
            <br />
            点击"+ 新建"创建第一个快照
          </div>
        ) : (
          snapshots.map((snap) => (
            <SnapshotItem
              key={snap.snapshot_id}
              snapshot={snap}
              isActive={activeId === snap.snapshot_id}
              onSelect={() =>
                setActiveId(activeId === snap.snapshot_id ? null : snap.snapshot_id)
              }
              onPreview={handlePreview}
              onRestore={(s) => handleRestore(s, false)}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowCreate(false)}
        >
          <div
            data-testid="snapshot-create-dialog"
            className="bg-[var(--bg-panel)] rounded-lg p-4 w-96 border border-[var(--border-color)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              创建快照
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">
                  文件路径（每行一个）
                </label>
                <textarea
                  data-testid="create-paths"
                  value={createPaths}
                  onChange={(e) => setCreatePaths(e.target.value)}
                  rows={5}
                  className="w-full p-2 text-xs font-mono bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-primary)]"
                  placeholder="/path/to/file1.py&#10;/path/to/file2.py"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">
                  描述（可选）
                </label>
                <input
                  data-testid="create-desc"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  className="w-full p-2 text-xs bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-primary)]"
                  placeholder="例如：重构前快照"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs px-3 py-1 rounded bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]"
              >
                取消
              </button>
              <button
                data-testid="create-submit"
                onClick={handleCreate}
                className="text-xs px-3 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Conflict Dialog */}
      {pendingRestore && (
        <UndoConfirmDialog
          snapshot={pendingRestore.snapshot}
          conflicts={pendingRestore.conflicts}
          onCancel={() => setPendingRestore(null)}
          onConfirm={async () => {
            const snap = pendingRestore.snapshot;
            setPendingRestore(null);
            await handleRestore(snap, true);
          }}
        />
      )}

      {/* Preview Dialog */}
      {showPreview && (
        <DiffPreviewView
          preview={showPreview.preview}
          snapshot={showPreview.snapshot}
          onClose={() => setShowPreview(null)}
        />
      )}
    </div>
  );
}

export default SnapshotPanel;
