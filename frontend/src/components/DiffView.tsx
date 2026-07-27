/**
 * # ============================================================
 * # DiffView 文件变更查看组件（D5 - Module D TRAE SOLO）
 * # ============================================================
 * # 核心作用：实现 TRAE SOLO "代码变更"工具面板，
 * #           展示工作区所有变更文件，支持单文件 diff 查看、
 * #           保留/回退单文件操作、汇总统计。
 * # 运行流程：
 * #   1. 组件挂载时调用 fetchDiffFiles 拉取工作区文件级 diff 列表
 * #   2. 渲染顶部统计卡片：文件数 / 新增行数 / 删除行数
 * #   3. 渲染文件列表（每项：状态徽标 + 路径 + +/- 行数 + 按钮）
 * #   4. 点击文件项展开/收起该文件的 patch diff 视图
 * #   5. 点击"保留"按钮关闭展开态（仅 UI 反馈）
 * #   6. 点击"回退"按钮调用 checkoutFile API 撤销该文件修改
 * #   7. 操作完成后调用 refetch 刷新列表
 * # 输入参数（Props）：
 * #   - 无（组件自管理数据加载与状态）
 * # 输出结果：纯 UI 组件
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 初始版本（Module D - D5）实现 DiffView 面板
 * # ============================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchDiffFiles,
  checkoutFile,
  type FileDiffResponse,
  type DiffFilesResponse,
} from '../hooks/useApi';
import PanelSkeleton from './PanelSkeleton';

/** 文件状态对应的中文标签与样式 */
const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  modified:  { label: '修改', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30', icon: 'M' },
  added:     { label: '新增', color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30', icon: 'A' },
  deleted:   { label: '删除', color: 'text-red-400 bg-red-500/15 border-red-500/30', icon: 'D' },
  renamed:   { label: '重命名', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30', icon: 'R' },
  untracked: { label: '未跟踪', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30', icon: 'U' },
};

/** 默认元数据（未知状态兜底） */
const DEFAULT_STATUS_META = { label: '未知', color: 'text-surface-400 bg-surface-500/15 border-surface-500/30', icon: '?' };

/**
 * 获取单个文件状态对应的元数据
 * 输入：status 字符串
 * 输出：{ label, color, icon }
 */
function getStatusMeta(status: string) {
  return STATUS_META[status] || DEFAULT_STATUS_META;
}

/**
 * 从完整路径中取文件名（最后一段）
 * 输入：filePath 完整路径
 * 输出：文件名
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * 解析 patch 文本为行级数据（用于彩色 diff 视图）
 * 输入：patch 字符串
 * 输出：行级数组 [{ type, content }]
 *   - type: 'add' | 'del' | 'ctx' | 'meta'
 */
interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'meta';
  content: string;
}

function parsePatchLines(patch: string): DiffLine[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  return lines.map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return { type: 'meta', content: line };
    }
    if (line.startsWith('+')) {
      return { type: 'add', content: line };
    }
    if (line.startsWith('-')) {
      return { type: 'del', content: line };
    }
    return { type: 'ctx', content: line };
  });
}

export default function DiffView() {
  /** diff 列表响应 */
  const [data, setData] = useState<DiffFilesResponse | null>(null);
  /** 加载态 */
  const [loading, setLoading] = useState(true);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);
  /** 当前展开的文件路径（单文件展开模式） */
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  /** 正在回退的文件路径（按钮 loading 态） */
  const [rollingBackPath, setRollingBackPath] = useState<string | null>(null);
  /** 最近一次操作提示（保留/回退） */
  const [toast, setToast] = useState<{ path: string; type: 'keep' | 'rollback' } | null>(null);

  /**
   * 加载 diff 列表
   * 运行步骤：
   *   1. 设置 loading = true
   *   2. 调用 fetchDiffFiles(false) 拉取未暂存变更
   *   3. 成功时 setData；失败时 setError
   *   4. 兜底 finally 重置 loading
   */
  const loadDiffs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDiffFiles(false);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载 diff 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 组件挂载时加载 diff 列表
  useEffect(() => {
    loadDiffs();
  }, [loadDiffs]);

  /**
   * 切换文件展开态
   * 输入：filePath 文件路径
   * 行为：相同路径收起，不同路径展开新文件
   */
  const toggleExpand = useCallback((filePath: string) => {
    setExpandedPath((prev) => (prev === filePath ? null : filePath));
  }, []);

  /**
   * 处理"保留"按钮（v1.0.0 仅 UI 反馈，实际写入由用户手动处理）
   * 输入：filePath 文件路径
   * 行为：显示 toast 提示"已保留"，2s 后自动消失
   */
  const handleKeep = useCallback((filePath: string) => {
    setToast({ path: filePath, type: 'keep' });
    // 2s 后清除 toast
    window.setTimeout(() => {
      setToast((current) => (current?.path === filePath ? null : current));
    }, 2000);
  }, []);

  /**
   * 处理"回退"按钮
   * 输入：filePath 文件路径
   * 运行步骤：
   *   1. 设置 rollingBackPath（按钮 loading 态）
   *   2. 调用 checkoutFile API 撤销修改
   *   3. 成功时刷新 diff 列表；失败时显示错误 toast
   *   4. 兜底 finally 重置 loading
   */
  const handleRollback = useCallback(async (filePath: string) => {
    // 简单确认：避免误操作
    const confirmed = window.confirm(`确认回退文件 "${getFileName(filePath)}" ？该操作将丢失该文件的未提交修改。`);
    if (!confirmed) return;

    setRollingBackPath(filePath);
    try {
      const result = await checkoutFile(filePath);
      if (result.success) {
        setToast({ path: filePath, type: 'rollback' });
        // 收起展开态
        if (expandedPath === filePath) {
          setExpandedPath(null);
        }
        // 重新拉取列表
        await loadDiffs();
        // 3s 后清除 toast
        window.setTimeout(() => {
          setToast((current) => (current?.path === filePath ? null : current));
        }, 3000);
      } else {
        setError(result.message || '回退失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '回退失败');
    } finally {
      setRollingBackPath(null);
    }
  }, [expandedPath, loadDiffs]);

  // 汇总统计（来自 data，避免每次 reduce）
  const totalFiles = data?.total_files ?? 0;
  const totalAdditions = data?.total_additions ?? 0;
  const totalDeletions = data?.total_deletions ?? 0;

  // 解析后的 diff 行（仅当前展开的文件）
  const expandedDiffLines = useMemo(() => {
    if (!expandedPath || !data) return null;
    const file = data.files.find((f: FileDiffResponse) => f.path === expandedPath);
    if (!file) return null;
    return {
      file,
      lines: parsePatchLines(file.patch),
    };
  }, [expandedPath, data]);

  // ============================================================
  // 加载态：使用 PanelSkeleton 统一组件
  // ============================================================
  if (loading && !data) {
    return <PanelSkeleton variant="git" />;
  }

  // ============================================================
  // 错误态
  // ============================================================
  if (error && !data) {
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

  // ============================================================
  // 空数据态：工作区干净
  // ============================================================
  if (totalFiles === 0) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-surface-950">代码变更</h3>
          </div>
          <button
            onClick={loadDiffs}
            className="btn-ghost text-sm"
            title="刷新"
          >
            刷新
          </button>
        </div>

        {/* 空态主体 */}
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <div className="text-center">
            <div className="text-5xl mb-3">✨</div>
            <p className="text-sm text-surface-500">工作区干净，无文件变更</p>
            <p className="text-xs text-surface-400 mt-1">所有修改均已提交或回退</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏：图标 + 标题 + 刷新按钮
       * ============================================================ */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">代码变更</h3>
        </div>
        <button
          onClick={loadDiffs}
          disabled={loading}
          className="btn-ghost text-sm disabled:opacity-50"
          title="刷新"
        >
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {/* ============================================================
       * 汇总统计卡片
       * ============================================================ */}
      <div className="rounded-lg p-4 mb-4 border border-hermes-500/20 bg-hermes-500/5">
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-900">{totalFiles}</div>
            <div className="text-xs text-surface-500 mt-1">变更文件</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-emerald-400">+{totalAdditions}</div>
            <div className="text-xs text-surface-500 mt-1">新增行</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-red-400">-{totalDeletions}</div>
            <div className="text-xs text-surface-500 mt-1">删除行</div>
          </div>
        </div>
      </div>

      {/* ============================================================
       * Toast 提示条
       * ============================================================ */}
      {toast && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs animate-fade-in
                        bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
          {toast.type === 'keep'
            ? `已保留 ${getFileName(toast.path)}（未执行实际操作）`
            : `已回退 ${getFileName(toast.path)}`}
        </div>
      )}

      {/* ============================================================
       * 文件列表
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0">
        {data?.files.map((file) => {
          const meta = getStatusMeta(file.status);
          const isExpanded = expandedPath === file.path;
          const isRolling = rollingBackPath === file.path;

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
              <div className="flex items-center gap-2 p-3">
                {/* 状态徽标 */}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${meta.color}`}>
                  {meta.icon}
                </span>

                {/* 文件路径（可点击展开） */}
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
                  </div>
                </button>

                {/* +/- 行数 */}
                <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
                  <span className="text-emerald-400">+{file.additions}</span>
                  <span className="text-red-400">-{file.deletions}</span>
                </div>

                {/* 展开箭头 */}
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
                <div className="border-t border-surface-300 px-3 py-3 animate-fade-in">
                  {/* 操作按钮组 */}
                  <div className="flex items-center justify-end gap-2 mb-3">
                    <button
                      onClick={() => handleKeep(file.path)}
                      className="px-3 py-1 text-xs font-medium rounded-md
                                 bg-emerald-500/15 hover:bg-emerald-500/25
                                 text-emerald-300 border border-emerald-500/30
                                 transition-colors"
                    >
                      保留
                    </button>
                    <button
                      onClick={() => handleRollback(file.path)}
                      disabled={isRolling}
                      className="px-3 py-1 text-xs font-medium rounded-md
                                 bg-red-500/15 hover:bg-red-500/25
                                 text-red-300 border border-red-500/30
                                 transition-colors disabled:opacity-50
                                 disabled:cursor-not-allowed"
                    >
                      {isRolling ? '回退中…' : '回退'}
                    </button>
                  </div>

                  {/* diff 文本 */}
                  {expandedDiffLines && expandedDiffLines.lines.length > 0 ? (
                    <div className="bg-surface-950 rounded-md border border-surface-300 overflow-x-auto max-h-80 overflow-y-auto">
                      <pre className="text-xs font-mono leading-relaxed">
                        {expandedDiffLines.lines.map((line, idx) => {
                          const bgClass =
                            line.type === 'add' ? 'bg-emerald-500/10 text-emerald-300'
                            : line.type === 'del' ? 'bg-red-500/10 text-red-300'
                            : line.type === 'meta' ? 'text-blue-400 bg-blue-500/5'
                            : 'text-surface-300';
                          return (
                            <div key={idx} className={`px-3 py-0.5 ${bgClass} whitespace-pre`}>
                              {line.content || ' '}
                            </div>
                          );
                        })}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-xs text-surface-500 text-center py-4">
                      无 diff 内容（二进制文件或空文件）
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
