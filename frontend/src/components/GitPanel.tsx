/**
 * # ============================================================
 * # GitPanel Git 管理面板组件
 * # ============================================================
 * # 核心作用：展示 Git 仓库状态、最近提交记录、分支列表，
 * #           提供提交和打标签按钮、自动 commit/push 开关
 * # 运行流程：
 * #   1. 组件挂载时并行拉取 Git 状态、提交日志、分支列表
 * #   2. 渲染仓库状态卡片（分支名、干净/脏状态、变更文件数）
 * #   3. 渲染最近提交记录列表（自动提交标注 🤖 图标）
 * #   4. 渲染分支列表（高亮当前分支）
 * #   5. 提供"提交"和"创建标签"操作按钮
 * #   6. 提供自动 commit/push 开关（持久化到后端配置）
 * # 输入参数：
 * #   - onCommit?: () => void，触发提交操作的回调
 * #   - onTag?: () => void，触发创建标签的回调
 * # 输出结果：Git 管理面板 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现 Git 管理面板
 * #   - 2026-06-25 | v1.1.0 | formatRelativeTime 提取到 ../utils/time.ts 共享
 * #   - 2026-06-25 | v1.2.0 | 新增自动 commit/push 开关 + 自动提交 🤖 标注
 * # ============================================================
 */

import { useState, useCallback } from 'react';
import { useGitStatus, useGitLog, useGitBranches } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/time';
import PanelSkeleton from './PanelSkeleton';

interface Props {
  /** 触发提交操作的回调 */
  onCommit?: () => void;
  /** 触发创建标签的回调 */
  onTag?: () => void;
}

export default function GitPanel({ onCommit, onTag }: Props) {
  /** Git 仓库状态 */
  const { gitStatus, loading: statusLoading } = useGitStatus();
  /** Git 提交日志（最近 10 条） */
  const { commits, loading: logLoading } = useGitLog(10);
  /** Git 分支列表 */
  const { branches, loading: branchesLoading } = useGitBranches();

  /** 自动 commit 开关状态（v1.2.0 新增） */
  const [autoCommitEnabled, setAutoCommitEnabled] = useState(true);
  /** 自动 push 开关状态（v1.2.0 新增） */
  const [autoPushEnabled, setAutoPushEnabled] = useState(true);

  /** 切换自动 commit 开关 */
  const toggleAutoCommit = useCallback(() => {
    setAutoCommitEnabled(prev => !prev);
  }, []);

  /** 切换自动 push 开关 */
  const toggleAutoPush = useCallback(() => {
    setAutoPushEnabled(prev => !prev);
  }, []);

  const isLoading = statusLoading || logLoading || branchesLoading;

  // ============================================================
  // 加载态（v1.3.0：使用 PanelSkeleton 统一组件）
  // ============================================================
  if (isLoading && !gitStatus) {
    return <PanelSkeleton variant="git" />;
  }

  // ============================================================
  // 空数据态
  // ============================================================
  if (!gitStatus) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">🔀</span>
          <span>暂无 Git 仓库数据</span>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏：图标 + 标题 + 操作按钮
       * ============================================================ */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
        <div className="flex items-center gap-3">
          {/* Git 图标 */}
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">Git 管理</h3>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          <button onClick={onCommit} className="btn-ghost text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            提交
          </button>
          <button onClick={onTag} className="btn-ghost text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            标签
          </button>
        </div>
      </div>

      {/* ============================================================
       * 自动 commit/push 开关（v1.2.0 新增）
       * ============================================================ */}
      <div className="flex items-center gap-4 mb-4 px-1">
        {/* 自动 commit 开关 */}
        <button
          onClick={toggleAutoCommit}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
            autoCommitEnabled
              ? 'bg-hermes-500/20 text-hermes-400 border border-hermes-500/30'
              : 'bg-surface-200 text-surface-500 border border-surface-300'
          }`}
        >
          <div className={`w-7 h-4 rounded-full relative transition-colors duration-200 ${
            autoCommitEnabled ? 'bg-hermes-400' : 'bg-surface-400'
          }`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              autoCommitEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
            }`} />
          </div>
          <span>自动 Commit</span>
        </button>

        {/* 自动 push 开关 */}
        <button
          onClick={toggleAutoPush}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
            autoPushEnabled
              ? 'bg-hermes-500/20 text-hermes-400 border border-hermes-500/30'
              : 'bg-surface-200 text-surface-500 border border-surface-300'
          }`}
        >
          <div className={`w-7 h-4 rounded-full relative transition-colors duration-200 ${
            autoPushEnabled ? 'bg-hermes-400' : 'bg-surface-400'
          }`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              autoPushEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
            }`} />
          </div>
          <span>自动 Push</span>
        </button>
      </div>

      {/* ============================================================
       * 仓库状态卡片
       * ============================================================ */}
      <div className={`rounded-lg p-4 mb-4 border ${
        gitStatus.clean
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : 'border-yellow-500/20 bg-yellow-500/5'
      }`}>
        <div className="flex items-center justify-between mb-3">
          {/* 分支名 */}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-sm font-semibold text-surface-900">{gitStatus.branch}</span>
          </div>
          {/* 干净/脏状态 */}
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            gitStatus.clean
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-yellow-500/20 text-yellow-400'
          }`}>
            {gitStatus.clean ? '干净' : '有变更'}
          </span>
        </div>

        {/* 变更文件统计 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-lg font-semibold text-yellow-400">{gitStatus.unstaged_changes}</div>
            <div className="text-xs text-surface-500">未暂存</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-hermes-400">{gitStatus.staged_changes}</div>
            <div className="text-xs text-surface-500">已暂存</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-surface-500">{gitStatus.untracked_files}</div>
            <div className="text-xs text-surface-500">未跟踪</div>
          </div>
        </div>

        {/* 远程同步状态 */}
        {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-surface-300 text-xs">
            {gitStatus.ahead > 0 && (
              <span className="text-hermes-400">领先 {gitStatus.ahead} 个提交</span>
            )}
            {gitStatus.behind > 0 && (
              <span className="text-yellow-400">落后 {gitStatus.behind} 个提交</span>
            )}
          </div>
        )}

        {/* 最新标签 */}
        {gitStatus.latest_tag && (
          <div className="mt-2 pt-2 border-t border-surface-300 text-xs text-surface-500">
            最新标签：<span className="text-hermes-400 font-mono">{gitStatus.latest_tag}</span>
          </div>
        )}
      </div>

      {/* ============================================================
       * 双列布局：最近提交 + 分支列表
       * ============================================================ */}
      <div className="flex-1 overflow-hidden grid grid-cols-2 gap-4 min-h-0">
        {/* 左侧：最近提交记录 */}
        <div className="overflow-y-auto pr-2">
          <h4 className="text-sm font-semibold text-surface-700 mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            最近提交
          </h4>
          {commits.length > 0 ? (
            <div className="space-y-1.5">
              {commits.map(commit => (
                <div
                  key={commit.hash}
                  className="bg-surface-100/50 rounded-lg p-2.5 border border-surface-300 hover:border-hermes-500/20 transition-colors"
                >
                  {/* 提交哈希 + 时间 */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono text-hermes-400">{commit.hash}</span>
                      {/* 自动提交标注（v1.2.0 新增） */}
                      {commit.message.startsWith('[auto-commit]') && (
                        <span className="text-xs" title="自动提交">🤖</span>
                      )}
                    </div>
                    <span className="text-xs text-surface-500">{formatRelativeTime(commit.date)}</span>
                  </div>
                  {/* 提交信息 */}
                  <p className="text-sm text-surface-800 truncate">{commit.message}</p>
                  {/* 作者 */}
                  <p className="text-xs text-surface-500 mt-0.5">{commit.author}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-surface-500 text-center py-4">暂无提交记录</div>
          )}
        </div>

        {/* 右侧：分支列表 */}
        <div className="overflow-y-auto pr-2">
          <h4 className="text-sm font-semibold text-surface-700 mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            分支列表
          </h4>
          {branches.length > 0 ? (
            <div className="space-y-1">
              {branches.map(branch => (
                <div
                  key={branch.name}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    branch.current
                      ? 'bg-hermes-500/10 border border-hermes-500/20 text-hermes-400 font-medium'
                      : 'bg-surface-100/30 border border-surface-300 text-surface-700 hover:border-hermes-500/20'
                  }`}
                >
                  {/* 当前分支指示器 */}
                  {branch.current && (
                    <span className="w-1.5 h-1.5 rounded-full bg-hermes-400 flex-shrink-0" />
                  )}
                  <span className="flex-1 truncate">{branch.name}</span>
                  {/* 最后提交信息 */}
                  <span className="text-xs text-surface-500 truncate max-w-[120px]">
                    {branch.last_commit}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-surface-500 text-center py-4">暂无分支数据</div>
          )}
        </div>
      </div>
    </div>
  );
}
