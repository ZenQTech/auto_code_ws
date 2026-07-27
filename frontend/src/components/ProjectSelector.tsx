/**
 * # ============================================================
 * # 项目选择器组件（ProjectSelector）
 * # ============================================================
 * # 核心作用：编程模式下未选择项目时，展示"新建项目"和"打开已有项目"
 * #           两个大型卡片入口，支持创建新项目或从已有项目列表中选择
 * # 运行流程：
 * #   1. 渲染两个大卡片：「📁 新建项目」和「📂 打开已有项目」
 * #   2. 「新建项目」点击 → 弹出模态框输入项目名称 → 调用 createProject API
 * #      → 成功后调用 onSelect(projectName)
 * #   3. 「打开已有项目」点击 → 调用 fetchProjects API 获取项目列表
 * #      → 以可选择卡片/列表展示 → 点击调用 onSelect(projectName)
 * # 输入参数（Props）：
 * #   - onSelect: (projectName: string) => void，项目选择回调
 * #   - onBack?: () => void，返回模式选择回调（v2.10.1 新增，未传则不渲染返回链接）
 * #   - onSwitchToChat?: () => void，切换到聊天模式回调（v2.10.1 新增，未传则不渲染快捷按钮）
 * # 输出结果：纯 UI 组件，无返回值
 * # ============================================================
 * # 修改记录：
 * #   - 2026-06-24 | v2.10.0 | 初始版本：项目选择器组件
 * #   - 2026-06-24 | v2.10.1 | 新增"返回模式选择"链接 + "切换到聊天模式"按钮（onBack / onSwitchToChat 回调）
 * # ============================================================
 */

import { useState } from 'react';
import { fetchProjects, createProject } from '../hooks/useApi';
import type { Project } from '../types';

interface Props {
  /** 项目选择回调，传入项目名称 */
  onSelect: (projectName: string) => void;
  /** v2.10.1 新增：返回模式选择回调（未传则不渲染顶部"返回模式选择"链接） */
  onBack?: () => void;
  /** v2.10.1 新增：切换到聊天模式回调（未传则不渲染底部"切换到聊天模式"按钮） */
  onSwitchToChat?: () => void;
}

export default function ProjectSelector({ onSelect, onBack, onSwitchToChat }: Props) {
  /** 新建项目模态框是否可见 */
  const [showNewModal, setShowNewModal] = useState(false);
  /** 新建项目输入框内容 */
  const [newProjectName, setNewProjectName] = useState('');
  /** 新建项目是否正在提交 */
  const [isCreating, setIsCreating] = useState(false);
  /** 新建项目错误信息 */
  const [createError, setCreateError] = useState('');
  /** 是否显示项目列表视图 */
  const [showProjectList, setShowProjectList] = useState(false);
  /** 已有项目列表 */
  const [projects, setProjects] = useState<Project[]>([]);
  /** 项目列表加载态 */
  const [isLoading, setIsLoading] = useState(false);
  /** 项目列表错误信息 */
  const [loadError, setLoadError] = useState('');

  /**
   * 加载已有项目列表
   * 运行步骤：
   *   1. 设置加载态
   *   2. 调用 fetchProjects API
   *   3. 设置项目列表
   *   4. 错误时设置错误信息
   */
  const handleLoadProjects = async () => {
    setShowProjectList(true);
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 提交新建项目
   * 运行步骤：
   *   1. 校验项目名非空
   *   2. 调用 createProject API
   *   3. 成功后调用 onSelect
   *   4. 错误时显示错误信息
   */
  const handleCreateProject = async () => {
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    setIsCreating(true);
    setCreateError('');
    try {
      await createProject(trimmed);
      onSelect(trimmed);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  /** 关闭新建项目模态框时重置状态 */
  const handleCloseModal = () => {
    setShowNewModal(false);
    setNewProjectName('');
    setCreateError('');
  };

  /** 返回主入口视图 */
  const handleBackToList = () => {
    setShowProjectList(false);
    setProjects([]);
    setLoadError('');
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-surface-50 min-h-screen">
      <div className="max-w-lg w-full mx-auto px-4">
        {/* v2.10.1 新增：顶部"← 返回模式选择"链接（仅在 onBack 存在时渲染） */}
        {onBack && (
          <button
            onClick={onBack}
            className="text-caption text-surface-500 hover:text-hermes-500 transition-colors mb-6 inline-flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回模式选择
          </button>
        )}

        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-h1 text-surface-800 mb-2">选择项目</h1>
          <p className="text-body text-surface-600">新建一个编程项目，或打开已有项目开始工作</p>
        </div>

        {!showProjectList ? (
          /* ============================================================ */
          /* 主入口：两个大卡片 + 底部"切换到聊天模式"快捷按钮 */
          /* ============================================================ */
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 新建项目卡片 */}
            <button
              onClick={() => setShowNewModal(true)}
              className="card-hoverable flex flex-col items-center justify-center gap-3 p-8
                         bg-surface-100 border border-surface-300 rounded-2xl
                         hover:border-hermes-500/40 hover:bg-surface-200/80
                         transition-all duration-default ease-material
                         group"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-hermes-500/20 to-hermes-600/20
                              flex items-center justify-center
                              group-hover:from-hermes-500/30 group-hover:to-hermes-600/30
                              transition-all duration-default">
                <span className="text-3xl">📁</span>
              </div>
              <span className="text-base font-semibold text-surface-800 group-hover:text-hermes-400
                               transition-colors duration-default">
                新建项目
              </span>
              <span className="text-xs text-surface-600">创建一个空白编程项目</span>
            </button>

            {/* 打开已有项目卡片 */}
            <button
              onClick={handleLoadProjects}
              className="card-hoverable flex flex-col items-center justify-center gap-3 p-8
                         bg-surface-100 border border-surface-300 rounded-2xl
                         hover:border-hermes-500/40 hover:bg-surface-200/80
                         transition-all duration-default ease-material
                         group"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-hermes-500/20 to-hermes-600/20
                              flex items-center justify-center
                              group-hover:from-hermes-500/30 group-hover:to-hermes-600/30
                              transition-all duration-default">
                <span className="text-3xl">📂</span>
              </div>
              <span className="text-base font-semibold text-surface-800 group-hover:text-hermes-400
                               transition-colors duration-default">
                打开已有项目
              </span>
              <span className="text-xs text-surface-600">从工作空间中选择项目</span>
            </button>
          </div>

          {/* v2.10.1 新增：底部"💬 切换到聊天模式"快捷按钮（仅在 onSwitchToChat 存在时渲染） */}
          {onSwitchToChat && (
            <div className="mt-8 text-center">
              <button
                onClick={onSwitchToChat}
                className="text-sm text-surface-600 hover:text-hermes-500 underline transition-colors"
              >
                💬 切换到聊天模式
              </button>
            </div>
          )}
          </>
        ) : (
          /* ============================================================ */
          /* 项目列表视图 */
          /* ============================================================ */
          <div className="animate-fade-in">
            {/* 返回按钮 */}
            <button
              onClick={handleBackToList}
              className="flex items-center gap-1.5 text-surface-600 hover:text-hermes-400
                         transition-colors duration-default mb-4 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </button>

            {/* 加载态 */}
            {isLoading && (
              <div className="space-y-2">
                <div className="skeleton h-16 w-full rounded-xl" />
                <div className="skeleton h-16 w-full rounded-xl" />
                <div className="skeleton h-16 w-full rounded-xl" />
              </div>
            )}

            {/* 错误态 */}
            {loadError && (
              <div className="error-card">
                加载项目列表失败：{loadError}
              </div>
            )}

            {/* 空态 */}
            {!isLoading && !loadError && projects.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </span>
                <span className="text-xs">暂无可用的项目</span>
              </div>
            )}

            {/* 项目列表 */}
            {!isLoading && !loadError && projects.length > 0 && (
              <div className="space-y-2">
                {projects.map(project => (
                  <button
                    key={project.name}
                    onClick={() => onSelect(project.name)}
                    className="card-hoverable w-full flex items-center gap-4 p-4
                               bg-surface-100 border border-surface-300 rounded-xl
                               text-left group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-hermes-500/15 to-hermes-600/15
                                    flex items-center justify-center flex-shrink-0
                                    group-hover:from-hermes-500/25 group-hover:to-hermes-600/25
                                    transition-all duration-default">
                      <span className="text-lg">📂</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-surface-800 group-hover:text-hermes-400
                                      transition-colors duration-default truncate">
                        {project.name}
                      </div>
                      <div className="text-xs text-surface-600 mt-0.5">
                        {project.file_count} 个文件
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-surface-600 flex-shrink-0 opacity-0 group-hover:opacity-100
                                    transition-all duration-default"
                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* 新建项目模态框 */}
      {/* ============================================================ */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <div
            className="glass-strong rounded-2xl p-6 w-full max-w-md mx-4 animate-modal-in
                       border border-surface-300/50"
          >
            <h2 className="text-h2 text-surface-800 mb-1">新建项目</h2>
            <p className="text-sm text-surface-600 mb-4">输入项目名称，创建一个新的编程项目</p>

            {/* 输入框 */}
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateProject();
                if (e.key === 'Escape') handleCloseModal();
              }}
              placeholder="输入项目名称..."
              autoFocus
              className="input-glow w-full px-4 py-3 text-sm rounded-xl mb-3"
            />

            {/* 错误提示 */}
            {createError && (
              <div className="text-xs text-red-400 mb-3">{createError}</div>
            )}

            {/* 按钮组 */}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={handleCloseModal}
                disabled={isCreating}
                className="btn-ghost px-4 py-2 text-sm"
              >
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || isCreating}
                className="btn-primary px-6 py-2 text-sm"
              >
                {isCreating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
