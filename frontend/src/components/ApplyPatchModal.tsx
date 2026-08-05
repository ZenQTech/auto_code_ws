/**
 * # ============================================================
 * # ApplyPatchModal 组件 (v1.0.0)
 * # Cycle 68 G68-02
 * # ====================================
 * # 核心作用：apply_patch V4A 弹窗组件
 * # 功能：
 * #   1. 输入 V4A patch 文本
 * #   2. 选择项目根目录
 * #   3. 点击 Preview 显示 diff
 * #   4. 点击 Apply 事务性应用
 * #   5. 失败时显示冲突列表（force 选项）
 * # 输入参数：baseUrl, isOpen, onClose, onApplied
 * # 输出结果：UI 弹窗
 * # 对标：Codex codex-rs/apply_patch
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 68 G68-02 初次创建
 * # ====================================
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useApplyPatch, FileDiff, Conflict } from '../hooks/useApplyPatch';

interface ApplyPatchModalProps {
  baseUrl?: string;
  isOpen: boolean;
  onClose: () => void;
  defaultRoot?: string;
  defaultPatch?: string;
  onApplied?: (result: { snapshot_id: string | null; applied_ops: number }) => void;
}

const SAMPLE_PATCH = `*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Hello, World!")
+    return 42
*** Add File: src/new.py
+def new_func():
+    return 1
*** End Patch`;

export function ApplyPatchModal({
  baseUrl = '',
  isOpen,
  onClose,
  defaultRoot = '',
  defaultPatch = '',
  onApplied,
}: ApplyPatchModalProps) {
  const {
    preview,
    lastPreview,
    previewing,
    apply,
    lastApply,
    applying,
    error,
  } = useApplyPatch(baseUrl);

  const [patchText, setPatchText] = useState<string>(defaultPatch);
  const [root, setRoot] = useState<string>(defaultRoot);
  const [force, setForce] = useState<boolean>(false);
  const [createSnapshot, setCreateSnapshot] = useState<boolean>(true);

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setPatchText(defaultPatch || SAMPLE_PATCH);
      setRoot(defaultRoot);
      setForce(false);
      setCreateSnapshot(true);
    }
  }, [isOpen, defaultPatch, defaultRoot]);

  // ============================================================
  // Actions
  // ============================================================

  const handlePreview = useCallback(async () => {
    if (!patchText.trim() || !root.trim()) {
      return;
    }
    try {
      await preview(patchText, root);
    } catch {
      // error in hook state
    }
  }, [preview, patchText, root]);

  const handleApply = useCallback(async () => {
    if (!patchText.trim() || !root.trim()) {
      return;
    }
    try {
      const result = await apply(patchText, root, { force, createSnapshot });
      if (result.success && onApplied) {
        onApplied({
          snapshot_id: result.snapshot_id,
          applied_ops: result.applied_ops,
        });
      }
    } catch {
      // error in hook state
    }
  }, [apply, patchText, root, force, createSnapshot, onApplied]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      data-testid="apply-patch-modal"
    >
      <div
        className="w-[90vw] max-w-4xl h-[80vh] flex flex-col bg-[var(--bg-panel)] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-semibold">🔧 Apply Patch (V4A)</h3>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 hover:bg-[var(--bg-elevated)] rounded"
            aria-label="关闭"
            data-testid="apply-patch-close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Input */}
          <div className="w-1/2 p-3 border-r border-[var(--border-color)] flex flex-col gap-2">
            <label className="text-xs text-[var(--text-secondary)]">项目根目录</label>
            <input
              type="text"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="/path/to/project"
              className="px-2 py-1 text-sm bg-[var(--bg-app)] border border-[var(--border-color)] rounded"
              data-testid="apply-patch-root"
            />

            <label className="text-xs text-[var(--text-secondary)] mt-2">V4A Patch 文本</label>
            <textarea
              value={patchText}
              onChange={(e) => setPatchText(e.target.value)}
              placeholder="*** Begin Patch..."
              className="flex-1 px-2 py-1 text-xs font-mono bg-[var(--bg-app)] border border-[var(--border-color)] rounded resize-none"
              data-testid="apply-patch-text"
            />

            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  data-testid="apply-patch-force"
                />
                <span>强制（跳过 hash 校验）</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createSnapshot}
                  onChange={(e) => setCreateSnapshot(e.target.checked)}
                />
                <span>创建快照</span>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handlePreview}
                disabled={previewing || !patchText.trim() || !root.trim()}
                className="flex-1 px-3 py-1.5 text-sm bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded disabled:opacity-50 hover:bg-blue-500/20"
                data-testid="apply-patch-preview"
              >
                {previewing ? '解析中...' : '预览 Diff'}
              </button>
              <button
                onClick={handleApply}
                disabled={applying || !patchText.trim() || !root.trim()}
                className="flex-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded disabled:opacity-50"
                data-testid="apply-patch-apply"
              >
                {applying ? '应用中...' : force ? '强制应用' : '应用'}
              </button>
            </div>

            {error && (
              <div className="text-xs text-red-400" data-testid="apply-patch-error">
                {error}
              </div>
            )}
          </div>

          {/* Right: Preview / Result */}
          <div className="w-1/2 p-3 overflow-y-auto">
            {lastPreview && (
              <div data-testid="apply-patch-preview-result">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-secondary)]">预览结果</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      lastPreview.safe
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-red-500/20 text-red-300'
                    }`}
                    data-testid="apply-patch-safe-badge"
                  >
                    {lastPreview.safe ? '安全' : '有冲突'}
                  </span>
                </div>

                {lastPreview.error && (
                  <div className="text-xs text-red-400 mb-2">
                    解析错误: {lastPreview.error}
                  </div>
                )}

                {lastPreview.conflicts.length > 0 && (
                  <div className="mb-3" data-testid="apply-patch-conflicts">
                    <div className="text-xs font-semibold mb-1 text-red-300">
                      冲突 ({lastPreview.conflicts.length})
                    </div>
                    {lastPreview.conflicts.map((c, i) => (
                      <div key={i} className="text-xs p-2 mb-1 bg-red-500/10 rounded">
                        <div className="font-mono">{c.file}</div>
                        <div className="text-[10px] text-[var(--text-secondary)] mt-1">
                          期望: {c.expected_hash} → 实际: {c.actual_hash}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)]">
                          原因: {c.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-[var(--text-secondary)] mb-2">
                  {lastPreview.ops_count} 个操作 · {lastPreview.diffs.length} 个文件
                </div>

                {lastPreview.diffs.map((d, i) => (
                  <div
                    key={i}
                    className="mb-3 border border-[var(--border-color)] rounded overflow-hidden"
                    data-testid="apply-patch-diff"
                  >
                    <div className="px-2 py-1 bg-[var(--bg-elevated)] text-xs flex items-center justify-between">
                      <span className="font-mono">{d.file}</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        {d.type} · {d.before_hash} → {d.after_hash}
                      </span>
                    </div>
                    <pre className="p-2 text-[10px] font-mono overflow-x-auto whitespace-pre">
                      {d.diff || '(empty diff)'}
                    </pre>
                  </div>
                ))}
              </div>
            )}

            {lastApply && (
              <div
                className={`p-3 rounded mt-2 ${
                  lastApply.success
                    ? 'bg-green-500/10 border border-green-500/30'
                    : 'bg-red-500/10 border border-red-500/30'
                }`}
                data-testid="apply-patch-result"
              >
                <div className="text-sm font-semibold mb-1">
                  {lastApply.success ? '✓ 应用成功' : '✗ 应用失败'}
                </div>
                {lastApply.success ? (
                  <div className="text-xs space-y-1">
                    <div>应用操作数: {lastApply.applied_ops}</div>
                    <div>耗时: {lastApply.duration_ms}ms</div>
                    {lastApply.snapshot_id && (
                      <div>快照 ID: {lastApply.snapshot_id}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs space-y-1">
                    <div>错误: {lastApply.error}</div>
                    {lastApply.rolled_back && <div>已自动回滚</div>}
                    {lastApply.failed_op?.conflicts && (
                      <div className="mt-1">
                        {lastApply.failed_op.conflicts.map((c: Conflict, i: number) => (
                          <div key={i} className="text-[10px] font-mono">
                            冲突: {c.file} ({c.reason})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!lastPreview && !lastApply && (
              <div className="flex items-center justify-center h-full text-sm text-[var(--text-secondary)]">
                点击"预览 Diff"查看 patch 效果
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ApplyPatchModal;
