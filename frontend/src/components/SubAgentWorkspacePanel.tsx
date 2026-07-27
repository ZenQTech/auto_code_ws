/**
 * # ============================================================
 * SubAgentWorkspacePanel - 子智能体工作区展示面板
 * # ============================================================
 * 核心作用：展示每个 SubAgent 独立工作区状态 (分支名/进度/文件数)
 *           对应 Codex/TRAE 中"多 SubAgent 并行开发"场景下，
 *           用户可一目了然看到每个 CLI 实例对应的工作分支、模块、进度
 * 运行流程：
 *   1. 接收 agents 列表作为 props（来自 useAgents Hook）
 *   2. 为每个 SubAgent 渲染一张 WorkspaceCard：
 *      - 分支徽章（branch_name）
 *      - worktree 路径（截断显示）
 *      - 模块名标签
 *      - 进度条（progress_percent）
 *      - 文件数 / 提交数 统计
 *   3. 整体外层为响应式网格（grid-cols-1/2/3）
 *   4. 当无 SubAgent 时显示空状态提示
 * 输入参数：
 *   - agents: Agent[] - 智能体列表
 *   - loading: boolean - 是否正在加载
 *   - onRefresh: () => void - 刷新回调
 *   - compact?: boolean - 是否紧凑模式（嵌入主页面时使用）
 * 输出结果：可视化 SubAgent 工作区状态网格
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | P2-1 补齐 SubAgent workspace 前端展示
 *     整合后端 branch_name/file_count/commit_count/progress_percent
 * ============================================================
 */

import React from 'react';
import type { Agent } from '../types';

interface SubAgentWorkspacePanelProps {
  /** 智能体列表 */
  agents: Agent[];
  /** 是否正在加载 */
  loading?: boolean;
  /** 刷新回调（用于"刷新"按钮） */
  onRefresh?: () => void;
  /** 紧凑模式（嵌入主聊天区域时使用） */
  compact?: boolean;
}

/** 根据 progress_percent 计算进度条颜色 */
function getProgressColor(percent: number): string {
  if (percent >= 80) return 'bg-gradient-to-r from-emerald-400 to-emerald-500';
  if (percent >= 40) return 'bg-gradient-to-r from-hermes-400 to-hermes-500';
  if (percent > 0) return 'bg-gradient-to-r from-blue-400 to-blue-500';
  return 'bg-gradient-to-r from-surface-300 to-surface-400';
}

/** 截断过长的路径（保留首尾） */
function truncatePath(path: string, max: number = 32): string {
  if (!path) return '（未设置）';
  if (path.length <= max) return path;
  const half = Math.floor((max - 1) / 2);
  return `${path.slice(0, half)}…${path.slice(-half)}`;
}

/** AgentStatus → 中文标签 */
const statusLabels: Record<string, { text: string; color: string }> = {
  online: { text: '在线', color: 'text-emerald-400' },
  busy: { text: '执行中', color: 'text-hermes-400' },
  offline: { text: '离线', color: 'text-surface-500' },
  error: { text: '异常', color: 'text-red-400' },
};

/** 单个 SubAgent 工作区卡片 */
const WorkspaceCard: React.FC<{ agent: Agent; compact?: boolean }> = ({ agent, compact }) => {
  const branch = agent.branch_name || '';
  const moduleName = agent.module_name || '未分配';
  const fileCount = agent.file_count ?? 0;
  const commitCount = agent.commit_count ?? 0;
  const progress = Math.max(0, Math.min(100, agent.progress_percent ?? 0));
  const workspacePath = agent.workspace || '';
  const status = statusLabels[agent.status] || statusLabels.offline;
  const isGitWorkspace = !!branch && branch !== 'master' && branch !== 'main';

  return (
    <div
      className={`relative bg-surface-100 border border-surface-400/60 rounded-xl overflow-hidden
        transition-all duration-300 hover:border-hermes-500/60 hover:shadow-level-2 card-hoverable
        ${compact ? 'p-3' : 'p-4'}`}
    >
      {/* 顶部：模块名 + 状态指示 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider
                ${isGitWorkspace ? 'text-hermes-400' : 'text-surface-500'}`}
            >
              {isGitWorkspace ? '🌿' : '📁'}
              {isGitWorkspace ? 'GIT WORKTREE' : 'DEFAULT WORKSPACE'}
            </span>
            <span className={`text-[10px] font-medium ${status.color}`}>
              ● {status.text}
            </span>
          </div>
          <div
            className="text-sm font-semibold text-surface-800 truncate"
            title={moduleName}
          >
            {moduleName}
          </div>
        </div>
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
            text-white font-bold text-sm shadow-level-1"
          style={{
            background: `linear-gradient(135deg, hsl(${(agent.avatar_seed?.charCodeAt(0) || 65) % 360}, 70%, 50%), hsl(${((agent.avatar_seed?.charCodeAt(0) || 65) + 40) % 360}, 70%, 40%))`,
          }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>
      </div>

      {/* 分支名（突出显示） */}
      {branch && (
        <div className="mb-2 flex items-center gap-1.5 bg-hermes-900/10 border border-hermes-500/20 rounded-md px-2 py-1">
          <svg className="w-3 h-3 text-hermes-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M6 3v12m0 0a3 3 0 106 0M6 15a3 3 0 106 0M18 9v6m0 0a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span
            className="text-xs font-mono text-hermes-300 truncate"
            title={branch}
          >
            {branch}
          </span>
          {agent.worktree_id && (
            <span className="ml-auto text-[10px] text-surface-500 flex-shrink-0">
              #{agent.worktree_id.slice(0, 6)}
            </span>
          )}
        </div>
      )}

      {/* worktree 路径 */}
      {workspacePath && (
        <div
          className="text-[10px] font-mono text-surface-500 mb-2 truncate"
          title={workspacePath}
        >
          {truncatePath(workspacePath)}
        </div>
      )}

      {/* 进度条 */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[10px] text-surface-600 mb-0.5">
          <span>进度</span>
          <span className="font-mono font-semibold">{progress.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-surface-300/40 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${getProgressColor(progress)}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 底部统计：文件 / 提交 / 任务 */}
      <div className="flex items-center gap-2 text-[10px] text-surface-600 mt-2 pt-2 border-t border-surface-300/30">
        <div className="flex items-center gap-1" title="workspace 文件数">
          <span>📄</span>
          <span className="font-mono font-semibold text-surface-700">
            {fileCount}
          </span>
          <span>文件</span>
        </div>
        <span className="text-surface-300">·</span>
        <div className="flex items-center gap-1" title="Git 提交数">
          <span>🔖</span>
          <span className="font-mono font-semibold text-surface-700">
            {commitCount}
          </span>
          <span>提交</span>
        </div>
        <span className="text-surface-300">·</span>
        <div className="flex items-center gap-1" title="任务负载">
          <span>📋</span>
          <span className="font-mono font-semibold text-surface-700">
            {agent.current_tasks}/{agent.max_concurrent}
          </span>
          <span>任务</span>
        </div>
        <div className="ml-auto text-[10px] text-surface-500 truncate" title={agent.name}>
          {agent.name.length > 16 ? `${agent.name.slice(0, 16)}…` : agent.name}
        </div>
      </div>
    </div>
  );
};

/** SubAgentWorkspacePanel 主组件 */
export const SubAgentWorkspacePanel: React.FC<SubAgentWorkspacePanelProps> = ({
  agents,
  loading = false,
  onRefresh,
  compact = false,
}) => {
  // 统计：在线 SubAgent / 总 SubAgent
  const onlineCount = agents.filter(a => a.status === 'online' || a.status === 'busy').length;
  const totalCount = agents.length;
  // 统计：Git worktree SubAgent / 默认 workspace SubAgent
  const worktreeCount = agents.filter(a => !!a.branch_name && a.branch_name !== 'master' && a.branch_name !== 'main').length;
  // 统计：平均进度
  const avgProgress = totalCount > 0
    ? agents.reduce((sum, a) => sum + (a.progress_percent ?? 0), 0) / totalCount
    : 0;

  return (
    <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg bg-gradient-to-br from-hermes-400 to-hermes-600
              flex items-center justify-center text-white font-bold text-sm shadow-level-1"
          >
            🌳
          </div>
          <div>
            <div className={`font-semibold text-surface-800 ${compact ? 'text-xs' : 'text-sm'}`}>
              SubAgent 工作区
            </div>
            <div className="text-[10px] text-surface-500">
              {totalCount === 0
                ? '尚无 SubAgent'
                : `${onlineCount}/${totalCount} 在线 · ${worktreeCount} 个 Git 分支 · 平均进度 ${avgProgress.toFixed(0)}%`}
            </div>
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-xs text-hermes-500 hover:text-hermes-400 disabled:opacity-50
              flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-200
              transition-all duration-default"
            title="刷新 SubAgent 列表"
          >
            <svg
              className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            刷新
          </button>
        )}
      </div>

      {/* 内容区域 */}
      {loading && agents.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface-100 border border-surface-400/60 rounded-xl p-4">
              <div className="skeleton h-4 w-3/4 mb-2 rounded" />
              <div className="skeleton h-3 w-1/2 mb-2 rounded" />
              <div className="skeleton h-2 w-full mb-2 rounded-full" />
              <div className="skeleton h-3 w-1/3 rounded" />
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="bg-surface-100/50 border border-dashed border-surface-400/50 rounded-xl p-6 text-center">
          <div className="text-3xl mb-2 opacity-50">🌱</div>
          <div className="text-sm text-surface-600 font-medium">
            暂无 SubAgent
          </div>
          <div className="text-[10px] text-surface-500 mt-1">
            开始新任务时，系统会自动创建 SubAgent 并分配独立工作区
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {agents.map(agent => (
            <WorkspaceCard key={agent.id} agent={agent} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
};

export default SubAgentWorkspacePanel;
