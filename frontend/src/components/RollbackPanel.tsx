/**
 * # ============================================================
 * # RollbackPanel 组件 (v1.0.0)
 * # Cycle 61 G61-07
 * # ====================================
 * # 核心作用：一键回退 UI 面板
 *           - 显示快照列表
 *           - 显示 git log
 *           - 创建快照 / 回退 / 批量回退
 * # 输入参数：onClose, compact
 * # 输出结果：React 组件
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-07 初次创建
 * # ====================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRollback, Snapshot } from '../hooks/useRollback';

export interface RollbackPanelProps {
  onClose?: () => void;
  compact?: boolean;
  testId?: string;
  defaultRepoPath?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  plan: 'bg-hermes-500/20 text-hermes-300',
  step: 'bg-blue-500/20 text-blue-300',
  manual: 'bg-slate-500/20 text-slate-300',
  initial: 'bg-emerald-500/20 text-emerald-300',
};

const SOURCE_ICONS: Record<string, string> = {
  plan: '📋',
  step: '🔧',
  manual: '✋',
  initial: '🎬',
};

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  return d.toLocaleString();
}

function SnapshotCard({
  snap,
  onRollback,
  isRollingBack,
  compact,
}: {
  snap: Snapshot;
  onRollback: (snap: Snapshot) => void;
  isRollingBack: boolean;
  compact: boolean;
}) {
  return (
    <div
      data-testid={`rollback-snapshot-${snap.snapshot_id}`}
      className={`border border-[var(--border-color)] rounded p-2 bg-[var(--bg-panel)] ${compact ? 'text-[10px]' : 'text-xs'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
            {snap.short_hash}
          </span>
          <span className="font-medium truncate" title={snap.message}>
            {snap.message}
          </span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${SOURCE_COLORS[snap.source] || SOURCE_COLORS.manual}`}>
          {SOURCE_ICONS[snap.source] || '•'} {snap.source}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
        <span>{formatTime(snap.created_at)}</span>
        <span>·</span>
        <span>{snap.files_changed} files</span>
        <span>·</span>
        <span className="text-emerald-400">+{snap.insertions}</span>
        <span className="text-red-400">-{snap.deletions}</span>
        {snap.plan_id && (
          <>
            <span>·</span>
            <span className="font-mono">{snap.plan_id}</span>
          </>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          data-testid={`rollback-snapshot-${snap.snapshot_id}-rollback`}
          onClick={() => onRollback(snap)}
          disabled={isRollingBack}
          className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
        >
          ⏪ 回退到此版本
        </button>
      </div>
    </div>
  );
}

function GitLogCard({
  entry,
  onRollback,
  isRollingBack,
  compact,
}: {
  entry: { commit_hash: string; short_hash: string; message: string; author: string; timestamp: number };
  onRollback: (commitHash: string) => void;
  isRollingBack: boolean;
  compact: boolean;
}) {
  return (
    <div
      data-testid={`rollback-git-${entry.short_hash}`}
      className={`border border-[var(--border-color)] rounded p-2 bg-[var(--bg-panel)] ${compact ? 'text-[10px]' : 'text-xs'}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
          {entry.short_hash}
        </span>
        <span className="font-medium truncate flex-1" title={entry.message}>
          {entry.message}
        </span>
        <button
          type="button"
          data-testid={`rollback-git-${entry.short_hash}-rollback`}
          onClick={() => onRollback(entry.commit_hash)}
          disabled={isRollingBack}
          className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
        >
          ⏪ 回退
        </button>
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
        {entry.author} · {formatTime(entry.timestamp)}
      </div>
    </div>
  );
}

export const RollbackPanel: React.FC<RollbackPanelProps> = ({
  onClose,
  compact = false,
  testId = 'rollback-panel',
  defaultRepoPath = '',
}) => {
  const rb = useRollback({ initialRepoPath: defaultRepoPath });
  const [snapshotMessage, setSnapshotMessage] = useState('');
  const [tab, setTab] = useState<'snapshots' | 'gitlog' | 'history'>('snapshots');
  const [confirmRollback, setConfirmRollback] = useState<{
    type: 'snapshot' | 'commit';
    id: string;
    hash: string;
    label: string;
  } | null>(null);

  // 初始加载
  useEffect(() => {
    void rb.refreshSnapshots();
    void rb.refreshHistory();
    if (rb.repoPath) {
      void rb.refreshGitLog();
    }
  }, [rb]);

  const handleCreateSnapshot = useCallback(async () => {
    if (!snapshotMessage.trim()) {
      rb.setError('请输入快照消息');
      return
    }
    if (!rb.repoPath) {
      rb.setError('请先设置 repo 路径')
      return
    }
    await rb.createSnapshot({ message: snapshotMessage.trim() })
    setSnapshotMessage('')
  }, [snapshotMessage, rb])

  const handleRollback = useCallback((snap: Snapshot) => {
    setConfirmRollback({
      type: 'snapshot',
      id: snap.snapshot_id,
      hash: snap.commit_hash,
      label: `${snap.short_hash} - ${snap.message}`,
    });
  }, []);

  const handleRollbackCommit = useCallback((commitHash: string) => {
    setConfirmRollback({
      type: 'commit',
      id: commitHash,
      hash: commitHash,
      label: commitHash.substring(0, 12),
    });
  }, []);

  const confirmRollbackAction = useCallback(async () => {
    if (!confirmRollback) return;
    if (confirmRollback.type === 'snapshot') {
      await rb.rollbackBySnapshot(confirmRollback.id);
    } else {
      await rb.rollback(confirmRollback.hash);
    }
    setConfirmRollback(null);
  }, [confirmRollback, rb]);

  return (
    <div
      data-testid={testId}
      className={`flex flex-col h-full bg-[var(--bg-app)] text-[var(--text-primary)] ${compact ? 'text-xs' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">⏪ Rollback</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {rb.snapshots.length} snapshots
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            data-testid={`${testId}-close`}
            onClick={onClose}
            className="px-2 py-0.5 text-xs rounded hover:bg-[var(--bg-elevated)]"
          >
            ✕
          </button>
        )}
      </div>

      {/* Repo path 设置 */}
      <div className="p-3 border-b border-[var(--border-color)] space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-[var(--text-tertiary)] whitespace-nowrap">
            Repo 路径:
          </label>
          <input
            data-testid={`${testId}-repo-path`}
            value={rb.repoPath}
            onChange={(e) => rb.setRepoPath(e.target.value)}
            placeholder="/path/to/repo"
            className="flex-1 px-2 py-1 text-xs bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded focus:outline-none focus:border-hermes-500"
          />
          <button
            type="button"
            data-testid={`${testId}-refresh`}
            onClick={() => {
              void rb.refreshSnapshots();
              void rb.refreshGitLog();
            }}
            disabled={!rb.repoPath}
            className="px-2 py-1 text-xs rounded bg-hermes-500/20 text-hermes-300 hover:bg-hermes-500/30 disabled:opacity-50"
          >
            🔄
          </button>
        </div>

        {/* 创建快照 */}
        <div className="flex items-center gap-2">
          <input
            data-testid={`${testId}-snapshot-message`}
            value={snapshotMessage}
            onChange={(e) => setSnapshotMessage(e.target.value)}
            placeholder="快照消息…"
            className="flex-1 px-2 py-1 text-xs bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded focus:outline-none focus:border-hermes-500"
          />
          <button
            type="button"
            data-testid={`${testId}-create-snapshot`}
            onClick={() => void handleCreateSnapshot()}
            disabled={!rb.repoPath || !snapshotMessage.trim()}
            className="px-3 py-1 text-xs rounded bg-hermes-500 text-white hover:bg-hermes-600 disabled:opacity-50"
          >
            📸 快照
          </button>
        </div>

        {rb.error && (
          <div
            data-testid={`${testId}-error`}
            className="px-2 py-1 text-[10px] rounded bg-red-500/10 text-red-300 border border-red-500/30"
          >
            ⚠ {rb.error}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-[var(--border-color)] bg-[var(--bg-panel)]">
        {(['snapshots', 'gitlog', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`${testId}-tab-${t}`}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs transition-colors ${
              tab === t
                ? 'border-b-2 border-hermes-500 text-hermes-300'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t === 'snapshots' && '📸 快照'}
            {t === 'gitlog' && '📜 Git Log'}
            {t === 'history' && '📋 回退历史'}
            {t === 'snapshots' && ` (${rb.snapshots.length})`}
            {t === 'history' && ` (${rb.rollbackHistory.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {tab === 'snapshots' && (
          <>
            {rb.snapshotsLoading && (
              <div className="text-center text-xs text-[var(--text-tertiary)] py-4">
                加载中…
              </div>
            )}
            {!rb.snapshotsLoading && rb.snapshots.length === 0 && (
              <div className="text-center text-xs text-[var(--text-tertiary)] py-8">
                暂无快照
              </div>
            )}
            {rb.snapshots.map((snap) => (
              <SnapshotCard
                key={snap.snapshot_id}
                snap={snap}
                onRollback={handleRollback}
                isRollingBack={rb.isRollingBack}
                compact={compact}
              />
            ))}
          </>
        )}
        {tab === 'gitlog' && (
          <>
            {!rb.repoPath && (
              <div className="text-center text-xs text-[var(--text-tertiary)] py-8">
                请先设置 repo 路径
              </div>
            )}
            {rb.repoPath && rb.gitLog.length === 0 && (
              <div className="text-center text-xs text-[var(--text-tertiary)] py-8">
                暂无 git log
              </div>
            )}
            {rb.gitLog.map((entry) => (
              <GitLogCard
                key={entry.commit_hash}
                entry={entry}
                onRollback={handleRollbackCommit}
                isRollingBack={rb.isRollingBack}
                compact={compact}
              />
            ))}
          </>
        )}
        {tab === 'history' && (
          <>
            {rb.rollbackHistory.length === 0 && (
              <div className="text-center text-xs text-[var(--text-tertiary)] py-8">
                暂无回退历史
              </div>
            )}
            {rb.rollbackHistory.map((r, i) => (
              <div
                key={i}
                data-testid={`rollback-history-${i}`}
                className="border border-[var(--border-color)] rounded p-2 bg-[var(--bg-panel)] text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✅ {r.success ? '成功' : '失败'}</span>
                  <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                    {r.original_commit.substring(0, 8)} → {r.revert_commit.substring(0, 8)}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                  {formatTime(r.timestamp)} · {r.files_changed} files · {r.message}
                </div>
                {r.error && (
                  <div className="mt-1 text-[10px] text-red-400">
                    ⚠ {r.error}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Confirm dialog */}
      {confirmRollback && (
        <div
          data-testid={`${testId}-confirm`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setConfirmRollback(null)}
        >
          <div
            className="bg-[var(--bg-panel)] border border-[var(--border-color)] rounded-lg p-4 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-2">⚠ 确认回退</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              将回退到 commit：
              <span className="font-mono text-[var(--text-primary)]">
                {confirmRollback.label}
              </span>
            </p>
            <p className="text-[10px] text-[var(--text-tertiary)] mb-3">
              此操作会创建一个新的 revert commit，保留原 commit 历史。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRollback(null)}
                className="px-3 py-1 text-xs rounded hover:bg-[var(--bg-elevated)]"
              >
                取消
              </button>
              <button
                type="button"
                data-testid={`${testId}-confirm-yes`}
                onClick={() => void confirmRollbackAction()}
                className="px-3 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600"
              >
                确认回退
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RollbackPanel;
