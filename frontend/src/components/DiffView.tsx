/**
 * # ============================================================
 * DiffView 高级代码变更查看组件 (v2.0.0 - Cycle 9 P1-7)
 * # ============================================================
 * 核心作用：TRAE SOLO "代码变更"工具面板 v2 版，支持：
 *   1. 4 种 diff 输出格式（unified / side_by_side / json_patch / stats）
 *   2. 工作区暂存切换（staged / unstaged）
 *   3. 工作区快照管理（create / list / restore / delete）
 *   4. 任意 git ref 对比对话框
 *   5. 暂存 / 取消暂存 / 全部暂存控制
 *   6. 路径 / 状态过滤
 *   7. 快照 vs 工作区对比
 * 运行流程：
 *   1. 组件挂载 → 加载 localStorage 中的 projectPath（如有）
 *   2. 拉取 formats + workspace diff (unified)
 *   3. 用户切换格式 → 重新拉取对应格式的 diff
 *   4. 用户切换 staged → 重新拉取暂存区 diff
 *   5. 用户点击快照 → 拉取快照列表，支持创建/恢复/删除
 *   6. 用户点击"对比 ref" → 弹出对话框输入两个 ref
 *   7. 用户点击文件行 → 展开显示对应格式的 diff 内容
 * 输入参数（Props）：
 *   - projectPath?: string  当前项目路径（可选，未传则从 localStorage 读取或要求用户输入）
 * 输出结果：纯 UI 组件
 * 修改记录：
 *   - 2026-07-24 | v1.0.0 | 初始版本（Module D - D5）实现基础 DiffView
 *   - 2026-07-28 | v2.0.0 | Cycle 9 P1-7 重构：多格式 + 快照 + ref 对比 + 暂存
 * ============================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSnapshot,
  deleteSnapshot,
  fetchWorkspaceDiff,
  listSnapshots,
  restoreSnapshot,
  stageAllFiles,
  stageFile,
  unstageFile,
  formatBytes,
  formatTimestamp,
  type CompareDiffResponse,
  type CreateSnapshotParams,
  type DiffFormatName,
  type DiffLine,
  type FileDiffData,
  type SnapshotData,
  type WorkspaceDiffResponse,
} from '../hooks/useDiffViewApi';
// fetchFormats / fetchSnapshotVsWorktree 已由 useDiffViewApi 暴露但 v2.0.0 UI 主流程暂未直接调用，
// 故不在此处导入以避免 TypeScript strict 模式下的 TS6133 错误。后续 Phase 5 优化阶段
// 若需要"快照 vs 工作区对比"等 UI 入口时再按需引入。
import PanelSkeleton from './PanelSkeleton';

// localStorage key
const LS_PROJECT_PATH = 'diffview.projectPath';

// ============================================================
// 常量
// ============================================================

/** 文件状态对应的中文标签与样式 */
const STATUS_META: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  modified:  { label: '修改', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30', icon: 'M' },
  added:     { label: '新增', color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30', icon: 'A' },
  deleted:   { label: '删除', color: 'text-red-400 bg-red-500/15 border-red-500/30', icon: 'D' },
  renamed:   { label: '重命名', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30', icon: 'R' },
  untracked: { label: '未跟踪', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30', icon: 'U' },
};

const DEFAULT_STATUS_META = {
  label: '未知',
  color: 'text-surface-400 bg-surface-500/15 border-surface-500/30',
  icon: '?',
};

/** 格式元数据 */
const FORMAT_META: Record<
  DiffFormatName,
  { label: string; shortLabel: string; description: string; icon: string }
> = {
  unified: {
    label: '统一',
    shortLabel: 'U',
    description: '标准 unified diff 文本',
    icon: '≡',
  },
  side_by_side: {
    label: '并排',
    shortLabel: 'S',
    description: '左右双列对比视图',
    icon: '⫴',
  },
  json_patch: {
    label: 'JSON',
    shortLabel: 'J',
    description: '结构化 JSON Patch 输出',
    icon: '{ }',
  },
  stats: {
    label: '统计',
    shortLabel: '#',
    description: '仅文件数 / 新增 / 删除统计',
    icon: 'Σ',
  },
};

/** 单次请求超时（ms） */
const REQUEST_TIMEOUT_MS = 30_000;

// ============================================================
// 工具函数
// ============================================================

function getStatusMeta(status: string) {
  return STATUS_META[status] || DEFAULT_STATUS_META;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * 将 patch 文本解析为行级数据（unified 格式）
 * 注意：JSON Patch / side_by_side 已有结构化数据，无需此步骤
 */
function parsePatchLines(patch: string): DiffLine[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
        inHunk = true;
      }
      out.push({ line_type: 'meta', content: line, old_line_no: null, new_line_no: null });
      continue;
    }
    if (!inHunk) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        out.push({ line_type: 'meta', content: line, old_line_no: null, new_line_no: null });
      }
      continue;
    }
    if (line.startsWith('+')) {
      out.push({ line_type: 'add', content: line.slice(1), old_line_no: null, new_line_no: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      out.push({ line_type: 'del', content: line.slice(1), old_line_no: oldLine, new_line_no: null });
      oldLine++;
    } else if (line.startsWith('\\')) {
      out.push({ line_type: 'meta', content: line, old_line_no: null, new_line_no: null });
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      out.push({ line_type: 'ctx', content, old_line_no: oldLine, new_line_no: newLine });
      oldLine++;
      newLine++;
    }
  }
  return out;
}

/**
 * 带超时的 fetch 包装
 * 解决慢响应/挂起请求问题
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ============================================================
// 子组件：单文件 diff 渲染
// ============================================================

interface FileDiffRenderProps {
  file: FileDiffData;
  format: DiffFormatName;
}

/** 单文件 diff 渲染（按格式分派） */
function FileDiffRender({ file, format }: FileDiffRenderProps) {
  if (format === 'side_by_side') {
    return <SideBySideView file={file} />;
  }
  if (format === 'json_patch') {
    return <JsonPatchView file={file} />;
  }
  if (format === 'stats') {
    return <StatsView file={file} />;
  }
  // unified
  return <UnifiedView file={file} />;
}

/** Unified 视图 */
function UnifiedView({ file }: { file: FileDiffData }) {
  const lines = useMemo(
    () => (file.lines.length > 0 ? file.lines : parsePatchLines(file.patch_unified)),
    [file.lines, file.patch_unified],
  );
  if (lines.length === 0) {
    return <EmptyDiff message="无 diff 内容（二进制文件或空文件）" />;
  }
  return (
    <div className="bg-surface-950 rounded-md border border-surface-300 overflow-x-auto max-h-80 overflow-y-auto">
      <pre className="text-xs font-mono leading-relaxed">
        {lines.map((line, idx) => {
          const bgClass =
            line.line_type === 'add'
              ? 'bg-emerald-500/10 text-emerald-300'
              : line.line_type === 'del'
              ? 'bg-red-500/10 text-red-300'
              : line.line_type === 'meta'
              ? 'text-blue-400 bg-blue-500/5'
              : 'text-surface-300';
          const lineNo =
            line.line_type === 'add'
              ? `     +${line.new_line_no ?? ''}`
              : line.line_type === 'del'
              ? `${(line.old_line_no ?? '').toString().padStart(5)}      `
              : line.line_type === 'ctx'
              ? `${(line.old_line_no ?? '').toString().padStart(5)} ${(line.new_line_no ?? '').toString().padStart(5)}`
              : '       ';
          return (
            <div
              key={idx}
              className={`px-3 py-0.5 ${bgClass} whitespace-pre flex gap-2`}
            >
              <span className="text-surface-500 select-none flex-shrink-0">{lineNo}</span>
              <span className="flex-1">{line.content || ' '}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** Side-by-Side 视图 */
function SideBySideView({ file }: { file: FileDiffData }) {
  const rows = file.side_by_side?.rows ?? [];
  if (rows.length === 0) {
    return <EmptyDiff message="无并排 diff 数据" />;
  }
  return (
    <div className="bg-surface-950 rounded-md border border-surface-300 overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-xs font-mono">
        <thead className="text-surface-400 border-b border-surface-300 sticky top-0 bg-surface-900">
          <tr>
            <th className="px-2 py-1 text-left w-1/2">原文件</th>
            <th className="px-2 py-1 text-left w-1/2">新文件</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, idx: number) => {
            const leftType = row.left?.type ?? 'empty';
            const rightType = row.right?.type ?? 'empty';
            const leftBg =
              leftType === 'del'
                ? 'bg-red-500/10 text-red-300'
                : leftType === 'meta'
                ? 'text-blue-400 bg-blue-500/5'
                : leftType === 'empty'
                ? 'bg-surface-900/40 text-surface-600'
                : 'text-surface-300';
            const rightBg =
              rightType === 'add'
                ? 'bg-emerald-500/10 text-emerald-300'
                : rightType === 'meta'
                ? 'text-blue-400 bg-blue-500/5'
                : rightType === 'empty'
                ? 'bg-surface-900/40 text-surface-600'
                : 'text-surface-300';
            return (
              <tr key={idx} className="border-b border-surface-300/30">
                <td className={`px-2 py-0.5 whitespace-pre ${leftBg}`}>
                  <span className="text-surface-500 select-none mr-2">
                    {row.left?.line_no != null ? String(row.left.line_no).padStart(4) : '   -'}
                  </span>
                  {row.left?.content || ' '}
                </td>
                <td className={`px-2 py-0.5 whitespace-pre ${rightBg}`}>
                  <span className="text-surface-500 select-none mr-2">
                    {row.right?.line_no != null ? String(row.right.line_no).padStart(4) : '   -'}
                  </span>
                  {row.right?.content || ' '}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** JSON Patch 视图 */
function JsonPatchView({ file }: { file: FileDiffData }) {
  const ops = file.json_patch ?? [];
  if (ops.length === 0) {
    return <EmptyDiff message="无 JSON Patch 数据" />;
  }
  const json = JSON.stringify(ops, null, 2);
  return (
    <div className="bg-surface-950 rounded-md border border-surface-300 overflow-x-auto max-h-80 overflow-y-auto">
      <pre className="text-xs font-mono leading-relaxed p-3">
        <code>
          {json.split('\n').map((line, idx) => {
            // 简单语法高亮
            let highlighted = line;
            if (line.includes('"op"')) {
              highlighted = line.replace(
                /"(op|line|content)"/g,
                '<span class="text-blue-400">"$1"</span>',
              );
            }
            return (
              <div
                key={idx}
                className="text-surface-300"
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            );
          })}
        </code>
      </pre>
    </div>
  );
}

/** Stats 视图 */
function StatsView({ file }: { file: FileDiffData }) {
  return (
    <div className="bg-surface-950 rounded-md border border-surface-300 p-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-lg font-semibold text-surface-900">
            {file.additions}
          </div>
          <div className="text-xs text-emerald-400 mt-1">新增行</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-surface-900">
            {file.deletions}
          </div>
          <div className="text-xs text-red-400 mt-1">删除行</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-surface-900">
            {file.additions + file.deletions}
          </div>
          <div className="text-xs text-surface-500 mt-1">总变更</div>
        </div>
      </div>
      {file.error && (
        <div className="mt-3 text-xs text-red-300 bg-red-500/10 rounded p-2">
          错误: {file.error}
        </div>
      )}
    </div>
  );
}

function EmptyDiff({ message }: { message: string }) {
  return (
    <div className="text-xs text-surface-500 text-center py-4 bg-surface-950 rounded-md border border-surface-300">
      {message}
    </div>
  );
}

// ============================================================
// 子组件：快照面板
// ============================================================

interface SnapshotPanelProps {
  projectPath: string;
  onClose: () => void;
  onSnapshotRestored: () => void;
  onShowToast: (msg: string, type: 'success' | 'error') => void;
}

function SnapshotPanel({
  projectPath,
  onClose,
  onSnapshotRestored,
  onShowToast,
}: SnapshotPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await withTimeout(
        listSnapshots(projectPath),
        REQUEST_TIMEOUT_MS,
        '加载快照列表',
      );
      setSnapshots(resp.snapshots);
    } catch (e) {
      onShowToast(
        e instanceof Error ? e.message : '加载快照失败',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [projectPath, onShowToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const params: CreateSnapshotParams = {
        project_path: projectPath,
        label: newLabel.trim(),
        description: newDesc.trim(),
      };
      const resp = await withTimeout(
        createSnapshot(params),
        REQUEST_TIMEOUT_MS,
        '创建快照',
      );
      onShowToast(`已创建快照: ${resp.snapshot.label}`, 'success');
      setNewLabel('');
      setNewDesc('');
      setShowCreate(false);
      await load();
    } catch (e) {
      onShowToast(
        e instanceof Error ? e.message : '创建快照失败',
        'error',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (snap: SnapshotData) => {
    if (!window.confirm(`确认恢复快照 "${snap.label}" ？\n将覆盖工作区现有文件！`)) {
      return;
    }
    setRestoringId(snap.id);
    try {
      const resp = await withTimeout(
        restoreSnapshot(projectPath, snap.id),
        REQUEST_TIMEOUT_MS,
        '恢复快照',
      );
      onShowToast(resp.message || `已恢复快照: ${snap.label}`, 'success');
      onSnapshotRestored();
    } catch (e) {
      onShowToast(
        e instanceof Error ? e.message : '恢复快照失败',
        'error',
      );
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (snap: SnapshotData) => {
    if (!window.confirm(`确认删除快照 "${snap.label}" ？此操作不可撤销！`)) {
      return;
    }
    setDeletingId(snap.id);
    try {
      const resp = await withTimeout(
        deleteSnapshot(projectPath, snap.id),
        REQUEST_TIMEOUT_MS,
        '删除快照',
      );
      onShowToast(resp.message || `已删除快照: ${snap.label}`, 'success');
      await load();
    } catch (e) {
      onShowToast(
        e instanceof Error ? e.message : '删除快照失败',
        'error',
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="glass rounded-xl p-5 w-full max-w-2xl max-h-[80vh] flex flex-col animate-fade-in">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
              <span className="text-hermes-400 text-lg">📸</span>
            </div>
            <h3 className="text-base font-semibold text-surface-950">快照管理</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium rounded-md
                         bg-hermes-500/20 hover:bg-hermes-500/30
                         text-hermes-300 border border-hermes-500/30"
            >
              {showCreate ? '取消' : '+ 新建'}
            </button>
            <button
              onClick={onClose}
              className="text-surface-500 hover:text-surface-300 text-lg"
              title="关闭"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 创建表单 */}
        {showCreate && (
          <div className="mb-4 p-3 rounded-lg border border-hermes-500/30 bg-hermes-500/5">
            <input
              type="text"
              placeholder="标签（可选）"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full mb-2 px-3 py-1.5 text-sm rounded
                         bg-surface-100 border border-surface-300
                         text-surface-900 placeholder-surface-400
                         focus:outline-none focus:border-hermes-500/50"
            />
            <textarea
              placeholder="描述（可选）"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              className="w-full mb-2 px-3 py-1.5 text-sm rounded
                         bg-surface-100 border border-surface-300
                         text-surface-900 placeholder-surface-400
                         focus:outline-none focus:border-hermes-500/50
                         resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-3 py-1 text-xs font-medium rounded
                           bg-hermes-500 hover:bg-hermes-600
                           text-white transition-colors disabled:opacity-50"
              >
                {creating ? '创建中…' : '创建快照'}
              </button>
            </div>
          </div>
        )}

        {/* 快照列表 */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0">
          {loading ? (
            <div className="text-center text-surface-500 py-8">加载中…</div>
          ) : snapshots.length === 0 ? (
            <div className="text-center text-surface-500 py-8">
              <div className="text-3xl mb-2">📦</div>
              <div className="text-sm">暂无快照</div>
              <div className="text-xs mt-1">点击右上角"+ 新建"创建第一个快照</div>
            </div>
          ) : (
            snapshots.map((snap) => (
              <div
                key={snap.id}
                className="rounded-lg border border-surface-300 bg-surface-100/50 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-surface-900 truncate">
                        {snap.label}
                      </span>
                      <span className="text-xs text-surface-500">
                        ({snap.id.slice(-8)})
                      </span>
                    </div>
                    {snap.description && (
                      <div className="text-xs text-surface-500 mt-1 line-clamp-2">
                        {snap.description}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-surface-500">
                      <span>📅 {formatTimestamp(snap.created_at)}</span>
                      <span>📄 {snap.file_count} 文件</span>
                      <span>💾 {formatBytes(snap.total_size)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleRestore(snap)}
                      disabled={restoringId === snap.id}
                      className="px-2 py-1 text-xs rounded
                                 bg-emerald-500/15 hover:bg-emerald-500/25
                                 text-emerald-300 border border-emerald-500/30
                                 disabled:opacity-50"
                      title="恢复此快照"
                    >
                      {restoringId === snap.id ? '…' : '恢复'}
                    </button>
                    <button
                      onClick={() => handleDelete(snap)}
                      disabled={deletingId === snap.id}
                      className="px-2 py-1 text-xs rounded
                                 bg-red-500/15 hover:bg-red-500/25
                                 text-red-300 border border-red-500/30
                                 disabled:opacity-50"
                      title="删除此快照"
                    >
                      {deletingId === snap.id ? '…' : '删除'}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 子组件：Ref 对比对话框
// ============================================================

interface RefCompareDialogProps {
  projectPath: string;
  onClose: () => void;
  onCompare: (result: CompareDiffResponse) => void;
  onShowToast: (msg: string, type: 'success' | 'error') => void;
}

function RefCompareDialog({
  projectPath,
  onClose,
  onCompare,
  onShowToast,
}: RefCompareDialogProps) {
  const [baseRef, setBaseRef] = useState('HEAD~1');
  const [targetRef, setTargetRef] = useState('HEAD');
  const [comparing, setComparing] = useState(false);
  const [format, setFormat] = useState<DiffFormatName>('unified');

  const handleCompare = async () => {
    if (!baseRef.trim() || !targetRef.trim()) {
      onShowToast('请填写 base ref 和 target ref', 'error');
      return;
    }
    if (comparing) return;
    setComparing(true);
    try {
      const { fetchCompareDiff } = await import('../hooks/useDiffViewApi');
      const resp = await withTimeout(
        fetchCompareDiff({
          project_path: projectPath,
          base_ref: baseRef.trim(),
          target_ref: targetRef.trim(),
          format,
        }),
        REQUEST_TIMEOUT_MS,
        'ref 对比',
      );
      onCompare(resp);
      onClose();
    } catch (e) {
      onShowToast(
        e instanceof Error ? e.message : 'ref 对比失败',
        'error',
      );
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="glass rounded-xl p-5 w-full max-w-md animate-fade-in">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <span className="text-blue-400 text-lg">⇄</span>
            </div>
            <h3 className="text-base font-semibold text-surface-950">对比 Git Ref</h3>
          </div>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-300 text-lg"
          >
            ✕
          </button>
        </div>

        {/* 表单 */}
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-surface-500 mb-1">Base Ref</label>
            <input
              type="text"
              value={baseRef}
              onChange={(e) => setBaseRef(e.target.value)}
              placeholder="HEAD~1 / commit hash / branch / tag"
              className="w-full px-3 py-1.5 text-sm rounded
                         bg-surface-100 border border-surface-300
                         text-surface-900 placeholder-surface-400
                         focus:outline-none focus:border-blue-500/50
                         font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">Target Ref</label>
            <input
              type="text"
              value={targetRef}
              onChange={(e) => setTargetRef(e.target.value)}
              placeholder="HEAD / commit hash / branch / tag"
              className="w-full px-3 py-1.5 text-sm rounded
                         bg-surface-100 border border-surface-300
                         text-surface-900 placeholder-surface-400
                         focus:outline-none focus:border-blue-500/50
                         font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">输出格式</label>
            <div className="flex gap-1.5">
              {(Object.keys(FORMAT_META) as DiffFormatName[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 px-2 py-1 text-xs rounded border transition-colors
                              ${format === f
                                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                                : 'bg-surface-100 border-surface-300 text-surface-500 hover:border-blue-500/30'}`}
                >
                  {FORMAT_META[f].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded
                       bg-surface-200 hover:bg-surface-300
                       text-surface-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCompare}
            disabled={comparing}
            className="px-3 py-1.5 text-xs font-medium rounded
                       bg-blue-500 hover:bg-blue-600
                       text-white transition-colors disabled:opacity-50"
          >
            {comparing ? '对比中…' : '开始对比'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

interface DiffViewProps {
  /** 可选：当前项目绝对路径；未提供时从 localStorage 读取或用户输入 */
  projectPath?: string;
}

/**
 * 加载 projectPath：优先 props → localStorage → 空字符串
 */
function loadInitialProjectPath(propPath?: string): string {
  if (propPath && propPath.trim()) return propPath.trim();
  try {
    const stored = localStorage.getItem(LS_PROJECT_PATH);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // localStorage 不可用（如隐私模式）
  }
  return '';
}

/**
 * DiffView 主组件（v2.0.0）
 */
export default function DiffView({ projectPath: propProjectPath }: DiffViewProps) {
  // 数据状态
  const [data, setData] = useState<WorkspaceDiffResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 项目路径（prop > localStorage > 用户输入）
  const [projectPath, setProjectPath] = useState<string>(() => loadInitialProjectPath(propProjectPath));
  const [showProjectInput, setShowProjectInput] = useState(false);
  const [projectInputValue, setProjectInputValue] = useState('');
  // 视图状态
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [format, setFormat] = useState<DiffFormatName>('unified');
  const [staged, setStaged] = useState(false);
  const [pathFilter, setPathFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  // 操作状态
  const [rollingBackPath, setRollingBackPath] = useState<string | null>(null);
  const [stagingPath, setStagingPath] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  // 弹窗状态
  const [showSnapshotPanel, setShowSnapshotPanel] = useState(false);
  const [showRefDialog, setShowRefDialog] = useState(false);
  // ref 对比结果（覆盖工作区 diff 视图）
  const [refCompareResult, setRefCompareResult] = useState<CompareDiffResponse['data'] | null>(null);
  const [isRefCompare, setIsRefCompare] = useState(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 显示 toast
   */
  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  /**
   * 加载工作区 diff
   */
  const loadDiffs = useCallback(async () => {
    if (!projectPath) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    setIsRefCompare(false);
    setRefCompareResult(null);
    try {
      const result = await withTimeout(
        fetchWorkspaceDiff({
          project_path: projectPath,
          staged,
          format,
          path_filter: pathFilter || undefined,
          status_filter: statusFilter.length > 0 ? statusFilter : undefined,
        }),
        REQUEST_TIMEOUT_MS,
        '加载工作区 diff',
      );
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载 diff 失败');
    } finally {
      setLoading(false);
    }
  }, [projectPath, staged, format, pathFilter, statusFilter]);

  // 组件挂载 + 依赖变化时加载
  useEffect(() => {
    loadDiffs();
  }, [loadDiffs]);

  // propProjectPath 变化时同步
  useEffect(() => {
    if (propProjectPath && propProjectPath.trim() && propProjectPath !== projectPath) {
      setProjectPath(propProjectPath.trim());
    }
  }, [propProjectPath, projectPath]);

  /**
   * 保存项目路径到 localStorage
   */
  const handleSaveProjectPath = useCallback(() => {
    const v = projectInputValue.trim();
    if (!v) {
      showToast('项目路径不能为空', 'error');
      return;
    }
    try {
      localStorage.setItem(LS_PROJECT_PATH, v);
    } catch {
      // ignore
    }
    setProjectPath(v);
    setShowProjectInput(false);
    setProjectInputValue('');
    showToast(`项目路径已设置: ${v}`, 'success');
  }, [projectInputValue, showToast]);

  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // 切换格式时自动收起当前展开
  useEffect(() => {
    setExpandedPath(null);
  }, [format]);

  /**
   * 切换文件展开
   */
  const toggleExpand = useCallback((filePath: string) => {
    setExpandedPath((prev) => (prev === filePath ? null : filePath));
  }, []);

  /**
   * 回退单个文件（v2.0.0 仍调用旧的 checkout_file）
   */
  const handleRollback = useCallback(async (filePath: string) => {
    if (!window.confirm(`确认回退文件 "${getFileName(filePath)}" ？该操作将丢失该文件的未提交修改。`)) {
      return;
    }
    setRollingBackPath(filePath);
    try {
      const { checkoutFile } = await import('../hooks/useApi');
      const result = await checkoutFile(filePath);
      if (result.success) {
        showToast(`已回退 ${getFileName(filePath)}`, 'success');
        if (expandedPath === filePath) setExpandedPath(null);
        await loadDiffs();
      } else {
        showToast(result.message || '回退失败', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '回退失败', 'error');
    } finally {
      setRollingBackPath(null);
    }
  }, [expandedPath, loadDiffs, showToast]);

  /**
   * 暂存文件
   */
  const handleStage = useCallback(async (filePath: string) => {
    setStagingPath(filePath);
    try {
      const resp = await withTimeout(
        stageFile(projectPath, filePath),
        REQUEST_TIMEOUT_MS,
        '暂存文件',
      );
      if (resp.success) {
        showToast(`已暂存 ${getFileName(filePath)}`, 'success');
        await loadDiffs();
      } else {
        showToast(resp.message || '暂存失败', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '暂存失败', 'error');
    } finally {
      setStagingPath(null);
    }
  }, [projectPath, loadDiffs, showToast]);

  /**
   * 取消暂存
   */
  const handleUnstage = useCallback(async (filePath: string) => {
    setStagingPath(filePath);
    try {
      const resp = await withTimeout(
        unstageFile(projectPath, filePath),
        REQUEST_TIMEOUT_MS,
        '取消暂存',
      );
      if (resp.success) {
        showToast(`已取消暂存 ${getFileName(filePath)}`, 'success');
        await loadDiffs();
      } else {
        showToast(resp.message || '取消暂存失败', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '取消暂存失败', 'error');
    } finally {
      setStagingPath(null);
    }
  }, [projectPath, loadDiffs, showToast]);

  /**
   * 全部暂存
   */
  const handleStageAll = useCallback(async () => {
    if (!window.confirm('确认暂存所有变更？')) return;
    try {
      const resp = await withTimeout(
        stageAllFiles(projectPath),
        REQUEST_TIMEOUT_MS,
        '全部暂存',
      );
      if (resp.success) {
        showToast(resp.message || '已全部暂存', 'success');
        await loadDiffs();
      } else {
        showToast(resp.message || '全部暂存失败', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '全部暂存失败', 'error');
    }
  }, [projectPath, loadDiffs, showToast]);

  // ============================================================
  // 派生数据
  // ============================================================

  const displayData = isRefCompare && refCompareResult ? refCompareResult : data;
  const totalFiles = displayData?.stats.total_files ?? 0;
  const totalAdditions = displayData?.stats.total_additions ?? 0;
  const totalDeletions = displayData?.stats.total_deletions ?? 0;
  const files = displayData?.files ?? [];

  // ============================================================
  // 渲染
  // ============================================================

  // 加载态
  if (loading && !displayData) {
    return <PanelSkeleton variant="git" />;
  }

  // 错误态
  if (error && !displayData) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">⚠️</span>
          <span>{error}</span>
          <button
            onClick={loadDiffs}
            className="btn-ghost text-sm mt-3"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[80vh]">
      {/* ============================================================
       * 项目路径配置条（v2.0.0 新增）
       * ============================================================ */}
      <div className="flex items-center gap-2 mb-3 px-3 py-1.5 rounded-md
                      bg-surface-100/50 border border-surface-300 text-xs">
        <span className="text-surface-500">📁 项目:</span>
        <span className="font-mono text-surface-900 truncate flex-1" title={projectPath || '未设置'}>
          {projectPath || '(未设置)'}
        </span>
        <button
          onClick={() => {
            setProjectInputValue(projectPath);
            setShowProjectInput((v) => !v);
          }}
          className="px-2 py-0.5 text-[10px] rounded
                     bg-surface-200 hover:bg-surface-300
                     text-surface-700 transition-colors"
          title="修改项目路径"
        >
          {showProjectInput ? '取消' : '修改'}
        </button>
      </div>

      {/* 项目路径输入 */}
      {showProjectInput && (
        <div className="mb-3 p-2.5 rounded-md border border-hermes-500/30 bg-hermes-500/5">
          <div className="text-[10px] text-surface-500 mb-1">
            输入项目根目录绝对路径（必须为已初始化的 Git 仓库）
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={projectInputValue}
              onChange={(e) => setProjectInputValue(e.target.value)}
              placeholder="/path/to/project"
              className="flex-1 px-2 py-1 text-xs rounded
                         bg-surface-100 border border-surface-300
                         text-surface-900 placeholder-surface-400
                         focus:outline-none focus:border-hermes-500/50
                         font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveProjectPath();
                if (e.key === 'Escape') setShowProjectInput(false);
              }}
              autoFocus
            />
            <button
              onClick={handleSaveProjectPath}
              className="px-3 py-1 text-xs font-medium rounded
                         bg-hermes-500 hover:bg-hermes-600
                         text-white transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
       * 标题栏
       * ============================================================ */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-surface-300">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">
            代码变更
            {isRefCompare && refCompareResult && (
              <span className="ml-2 text-xs font-normal text-blue-400">
                (ref 对比: {refCompareResult.base_ref} → {refCompareResult.target_ref})
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          {isRefCompare && (
            <button
              onClick={() => {
                setIsRefCompare(false);
                setRefCompareResult(null);
                loadDiffs();
              }}
              className="px-2 py-1 text-xs rounded
                         bg-surface-200 hover:bg-surface-300
                         text-surface-700 transition-colors"
              title="返回工作区视图"
            >
              ← 返回
            </button>
          )}
          <button
            onClick={loadDiffs}
            disabled={loading}
            className="btn-ghost text-xs disabled:opacity-50"
            title="刷新"
          >
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </div>

      {/* ============================================================
       * 工具栏：格式切换 / 暂存切换 / 快照 / ref 对比
       * ============================================================ */}
      {!isRefCompare && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* 格式切换 */}
          <div className="flex items-center gap-1 p-0.5 rounded-md border border-surface-300 bg-surface-100/50">
            {(Object.keys(FORMAT_META) as DiffFormatName[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                disabled={loading}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors
                            ${format === f
                              ? 'bg-hermes-500/20 text-hermes-300'
                              : 'text-surface-500 hover:text-surface-300'}
                            disabled:opacity-50`}
                title={FORMAT_META[f].description}
              >
                <span className="mr-1 font-mono">{FORMAT_META[f].icon}</span>
                {FORMAT_META[f].label}
              </button>
            ))}
          </div>

          {/* 暂存切换 */}
          <div className="flex items-center gap-1 p-0.5 rounded-md border border-surface-300 bg-surface-100/50">
            <button
              onClick={() => setStaged(false)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors
                          ${!staged
                            ? 'bg-hermes-500/20 text-hermes-300'
                            : 'text-surface-500 hover:text-surface-300'}`}
            >
              未暂存
            </button>
            <button
              onClick={() => setStaged(true)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors
                          ${staged
                            ? 'bg-hermes-500/20 text-hermes-300'
                            : 'text-surface-500 hover:text-surface-300'}`}
            >
              已暂存
            </button>
          </div>

          {/* 全部暂存按钮 */}
          <button
            onClick={handleStageAll}
            disabled={loading || staged}
            className="px-2.5 py-1 text-xs font-medium rounded
                       bg-emerald-500/15 hover:bg-emerald-500/25
                       text-emerald-300 border border-emerald-500/30
                       disabled:opacity-50 transition-colors"
            title="暂存所有变更"
          >
            ⬆ 全部暂存
          </button>

          {/* 分隔 */}
          <div className="w-px h-5 bg-surface-300 mx-0.5" />

          {/* 快照管理 */}
          <button
            onClick={() => setShowSnapshotPanel(true)}
            className="px-2.5 py-1 text-xs font-medium rounded
                       bg-blue-500/15 hover:bg-blue-500/25
                       text-blue-300 border border-blue-500/30 transition-colors"
            title="快照管理"
          >
            📸 快照
          </button>

          {/* ref 对比 */}
          <button
            onClick={() => setShowRefDialog(true)}
            className="px-2.5 py-1 text-xs font-medium rounded
                       bg-purple-500/15 hover:bg-purple-500/25
                       text-purple-300 border border-purple-500/30 transition-colors"
            title="对比任意 git ref"
          >
            ⇄ Ref 对比
          </button>

          {/* 路径过滤 */}
          <input
            type="text"
            placeholder="路径过滤…"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
            className="ml-auto px-2 py-1 text-xs rounded
                       bg-surface-100 border border-surface-300
                       text-surface-900 placeholder-surface-400
                       focus:outline-none focus:border-hermes-500/50
                       w-32"
          />
        </div>
      )}

      {/* 状态过滤标签 */}
      {!isRefCompare && displayData && Object.keys(displayData.stats.by_status).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-xs text-surface-500">状态:</span>
          {Object.entries(displayData.stats.by_status).map(([status, count]) => {
            const meta = getStatusMeta(status);
            const isActive = statusFilter.includes(status);
            return (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter((prev) =>
                    prev.includes(status)
                      ? prev.filter((s) => s !== status)
                      : [...prev, status]
                  );
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all
                            ${isActive
                              ? meta.color + ' ring-1 ring-hermes-500/30'
                              : 'text-surface-500 bg-surface-200/50 border-surface-300 hover:border-surface-400'}`}
                title={`${meta.label} (${count}) - 点击${isActive ? '取消' : '添加'}过滤`}
              >
                {meta.icon} {meta.label} ({count})
              </button>
            );
          })}
          {statusFilter.length > 0 && (
            <button
              onClick={() => setStatusFilter([])}
              className="text-[10px] text-hermes-400 hover:text-hermes-300 underline ml-1"
            >
              清除
            </button>
          )}
        </div>
      )}

      {/* ============================================================
       * 汇总统计
       * ============================================================ */}
      <div className="rounded-lg p-3 mb-3 border border-hermes-500/20 bg-hermes-500/5">
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-xl font-semibold text-surface-900">{totalFiles}</div>
            <div className="text-[10px] text-surface-500 mt-0.5">变更文件</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-semibold text-emerald-400">+{totalAdditions}</div>
            <div className="text-[10px] text-surface-500 mt-0.5">新增行</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-semibold text-red-400">-{totalDeletions}</div>
            <div className="text-[10px] text-surface-500 mt-0.5">删除行</div>
          </div>
        </div>
      </div>

      {/* ============================================================
       * Toast 提示
       * ============================================================ */}
      {toast && (
        <div
          className={`mb-2 px-3 py-1.5 rounded text-xs animate-fade-in border
                      ${toast.type === 'success'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-red-500/15 border-red-500/30 text-red-300'}`}
        >
          {toast.msg}
        </div>
      )}

      {/* ============================================================
       * 文件列表 / 空态
       * ============================================================ */}
      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <div className="text-center">
            <div className="text-4xl mb-2">
              {isRefCompare ? '🔄' : staged ? '✅' : '✨'}
            </div>
            <p className="text-sm text-surface-500">
              {isRefCompare
                ? '两个 ref 之间无差异'
                : staged
                ? '暂存区无文件'
                : '工作区干净，无文件变更'}
            </p>
            <p className="text-xs text-surface-400 mt-1">
              {isRefCompare
                ? '请尝试其他 ref'
                : '所有修改均已提交或暂存'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 min-h-0">
          {files.map((file) => {
            const meta = getStatusMeta(file.status);
            const isExpanded = expandedPath === file.path;
            const isRolling = rollingBackPath === file.path;
            const isStaging = stagingPath === file.path;
            return (
              <div
                key={file.path}
                className={`rounded-lg border transition-colors ${
                  isExpanded
                    ? 'border-hermes-500/40 bg-hermes-500/5'
                    : 'border-surface-300 bg-surface-100/50 hover:border-hermes-500/20'
                }`}
              >
                {/* 文件行（点击切换展开） */}
                <div className="flex items-center gap-2 p-2.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${meta.color}`}>
                    {meta.icon}
                  </span>
                  <button
                    onClick={() => toggleExpand(file.path)}
                    className="flex-1 min-w-0 text-left"
                    title={file.path}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-surface-900 truncate">
                        {getFileName(file.path)}
                      </span>
                      <span className="text-xs text-surface-400 truncate">
                        {file.path}
                      </span>
                      {file.is_staged && (
                        <span className="px-1 py-0.5 text-[9px] rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex-shrink-0">
                          STAGED
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 text-xs font-mono flex-shrink-0">
                    <span className="text-emerald-400">+{file.additions}</span>
                    <span className="text-red-400">-{file.deletions}</span>
                  </div>
                  <button
                    onClick={() => toggleExpand(file.path)}
                    className="text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
                    title={isExpanded ? '收起' : '展开 diff'}
                  >
                    <svg
                      className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* 展开后：操作按钮 + diff 视图 */}
                {isExpanded && (
                  <div className="border-t border-surface-300 px-2.5 py-2.5 animate-fade-in">
                    {/* 操作按钮组 */}
                    <div className="flex items-center justify-end gap-1.5 mb-2">
                      {!isRefCompare && (
                        <>
                          {file.is_staged ? (
                            <button
                              onClick={() => handleUnstage(file.path)}
                              disabled={isStaging}
                              className="px-2 py-0.5 text-xs rounded
                                         bg-yellow-500/15 hover:bg-yellow-500/25
                                         text-yellow-300 border border-yellow-500/30
                                         disabled:opacity-50 transition-colors"
                              title="取消暂存"
                            >
                              {isStaging ? '…' : '⬇ Unstage'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStage(file.path)}
                              disabled={isStaging}
                              className="px-2 py-0.5 text-xs rounded
                                         bg-emerald-500/15 hover:bg-emerald-500/25
                                         text-emerald-300 border border-emerald-500/30
                                         disabled:opacity-50 transition-colors"
                              title="暂存"
                            >
                              {isStaging ? '…' : '⬆ Stage'}
                            </button>
                          )}
                          <button
                            onClick={() => handleRollback(file.path)}
                            disabled={isRolling}
                            className="px-2 py-0.5 text-xs rounded
                                       bg-red-500/15 hover:bg-red-500/25
                                       text-red-300 border border-red-500/30
                                       disabled:opacity-50 transition-colors"
                            title="回退该文件"
                          >
                            {isRolling ? '…' : '↶ 回退'}
                          </button>
                        </>
                      )}
                    </div>

                    {/* diff 内容（按格式分派） */}
                    <FileDiffRender file={file} format={format} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 快照管理弹窗 */}
      {showSnapshotPanel && (
        <SnapshotPanel
          projectPath={projectPath}
          onClose={() => setShowSnapshotPanel(false)}
          onSnapshotRestored={loadDiffs}
          onShowToast={showToast}
        />
      )}

      {/* ref 对比弹窗 */}
      {showRefDialog && (
        <RefCompareDialog
          projectPath={projectPath}
          onClose={() => setShowRefDialog(false)}
          onCompare={(result) => {
            setIsRefCompare(true);
            setRefCompareResult(result.data);
            showToast(
              `已对比 ${result.data.base_ref} → ${result.data.target_ref}（${result.data.stats.total_files} 文件）`,
              'success',
            );
          }}
          onShowToast={showToast}
        />
      )}
    </div>
  );
}
