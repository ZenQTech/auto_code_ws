/**
 * # ============================================================
 * # 左侧边栏组件（Sidebar）
 * # ============================================================
 * # 核心作用：提供左侧可折叠边栏，展示历史会话列表与切换入口；
 * #           v1.1.0 新增批量删除工具栏与回收站视图
 * # 运行流程：
 * #   1. 接收 expanded 控制形态（折叠 64px / 展开 320px）
 * #   2. 折叠态：仅 Logo 按钮（点击展开）+ 底部"设置"图标（占位）
 * #   3. 展开态：Logo（点击折叠）+ 批量删除按钮 + 搜索框 + 会话列表 + 底部用户区 + 回收站入口
 * #   4. 搜索框：实时按 title / user_first_message 模糊过滤
 * #   5. 会话列表：调用 SessionListItem 渲染每一条
 * #   6. 批量删除模式：显示复选框 + 顶部工具栏（取消/删除所选）
 * #   7. 回收站视图：显示已删除会话，支持恢复与清空
 * #   8. 宽度过渡：根 div 使用 transition-all + ease-expressive，280ms 平滑
 * # 输入参数（Props）：
 * #   - expanded: boolean，是否展开
 * #   - onToggle: () => void，切换展开/折叠回调
 * #   - sessions: Session[]，会话列表
 * #   - currentSessionId: string | null，当前激活会话 ID
 * #   - onSelectSession: (id: string) => void，切换会话回调
 * #   - onDeleteSession: (id: string) => void，删除会话回调
 * #   - onBatchDelete: (ids: string[]) => void（v1.1.0 新增），批量删除回调
 * #   - onOpenSettings: () => void（v2.8.0 新增 - Task 7），打开全局设置面板回调
 * #   - onNewTask: () => void（v1.2.0 新增 - Task 6），新建任务回调（折叠态下暴露入口）
 * #   - loading: boolean，会话列表加载态
 * # 输出结果：纯 UI 组件，无返回值
 * # ============================================================
 * # 修改记录：
#   - 2026-06-23 | v1.0.0 | 初始版本：折叠 / 展开双形态；搜索过滤；Logo 切换；用户区占位
#   - 2026-06-24 | v1.1.0 | 新增批量删除工具栏（batchMode / selectedIds）；新增回收站视图（trashView / trashSessions）；对接回收站 API
#   - 2026-06-24 | v1.2.0 | 折叠态图标渐变背景 + Tooltip 提示（新增新建对话入口 / 回收站入口，应用统一 from-hermes-50 to-hermes-100 渐变 + hover:scale-110 + Tooltip）
#   - 2026-06-24 | v1.3.0 | 新增 appMode / onModeSwitch props；模式切换 pill 按钮（顶部搜索框上方）；sessions 按 session.mode 过滤
#   - 2026-07-24 | v1.4.0 | 搜索框增加 300ms 输入防抖（debouncedQuery + useRef + setTimeout），
#     避免每次按键立即重算 filteredSessions 触发 Sidebar 重渲染
# ============================================================
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Session } from '../types';
import {
  fetchTrashSessions,
  restoreSessions,
  emptyTrash,
} from '../hooks/useApi';
import SessionListItem from './SessionListItem';

interface Props {
  expanded: boolean;
  onToggle: () => void;
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  /** 批量删除回调（v1.1.0 新增） */
  onBatchDelete: (ids: string[]) => void;
  /** 打开全局设置面板回调（v1.2.0 新增 - Task 7） */
  onOpenSettings: () => void;
  /** 新建任务回调（v1.2.0 新增 - Task 6），折叠态下提供入口 */
  onNewTask: () => void;
  loading: boolean;
  /** 当前应用模式（v1.3.0 新增），用于模式切换 pill 按钮 + sessions 过滤 */
  appMode: 'chat' | 'coding';
  /** 模式切换回调（v1.3.0 新增） */
  onModeSwitch: (mode: 'chat' | 'coding') => void;
  /** v1.4.0 新增：回收站操作后通知父组件刷新会话列表 */
  onSessionsChanged?: () => void;
  /** v1.4.0 新增：删除/批量删除进行中标记（true 时禁用相关按钮 + 显示加载） */
  deletingSession?: boolean;
}

export default function Sidebar({
  expanded,
  onToggle,
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onBatchDelete,
  onOpenSettings,
  onNewTask,
  loading,
  appMode,
  onModeSwitch,
  onSessionsChanged,
  deletingSession = false,
}: Props) {
  /** 搜索关键词（输入框原始值，每次按键立即更新） */
  const [searchQuery, setSearchQuery] = useState('');
  /**
   * v1.4.0 新增：搜索关键词防抖值（debouncedQuery）
   * 作用：searchQuery 变化后 300ms 内没有新输入时，才更新 debouncedQuery；
   *       filteredSessions 依赖 debouncedQuery 计算，避免频繁重渲染
   */
  const [debouncedQuery, setDebouncedQuery] = useState('');
  /**
   * v1.4.0 新增：防抖定时器 ref
   * 作用：保存 setTimeout 返回值，组件卸载或新输入时清理，避免状态污染
   */
  const debounceTimerRef = useRef<number | null>(null);

  /**
   * v1.4.0 新增：搜索框 onChange 处理函数
   * 行为：立即更新 searchQuery（保证输入框响应即时），同时启动/重置 300ms 防抖定时器；
   *       定时器触发后更新 debouncedQuery，触发 filteredSessions 重算。
   */
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      setDebouncedQuery(value);
      debounceTimerRef.current = null;
    }, 300);
  }, []);

  /**
   * v1.4.0 新增：组件卸载时清理未触发的防抖定时器，避免内存泄漏 / 状态污染
   */
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);
  /** 批量删除模式标志（v1.1.0 新增） */
  const [batchMode, setBatchMode] = useState(false);
  /** 批量删除选中 ID 集合（v1.1.0 新增） */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 回收站视图标志（v1.1.0 新增） */
  const [trashView, setTrashView] = useState(false);
  /** 回收站会话列表（v1.1.0 新增） */
  const [trashSessions, setTrashSessions] = useState<Session[]>([]);
  /** 回收站加载态（v1.1.0 新增） */
  const [trashLoading, setTrashLoading] = useState(false);

  /**
   * 根据搜索词和当前 appMode 过滤后的会话列表
   * 匹配规则：
   *   1. session.mode === appMode（仅显示当前模式下的会话）
   *   2. title 或 user_first_message 包含关键词（不区分大小写）
   * v1.4.0：依赖 debouncedQuery（防抖后）而非 searchQuery（输入即变），
   *         避免每次按键立即重算 + 触发会话列表重渲染
   */
  const filteredSessions = useMemo(() => {
    // 第一步：按 appMode 过滤
    const modeFiltered = sessions.filter(s => s.mode === appMode);
    // 第二步：按防抖后的搜索关键词过滤
    if (!debouncedQuery.trim()) return modeFiltered;
    const q = debouncedQuery.trim().toLowerCase();
    return modeFiltered.filter(s =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.user_first_message || '').toLowerCase().includes(q)
    );
  }, [sessions, debouncedQuery, appMode]);

  // ============================================================
  // 批量删除相关操作（v1.1.0 新增）
  // ============================================================

  /** 进入批量删除模式 */
  const enterBatchMode = useCallback(() => {
    setBatchMode(true);
    setSelectedIds(new Set());
  }, []);

  /** 退出批量删除模式（取消） */
  const cancelBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
  }, []);

  /** 切换单个会话的选中状态 */
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** 执行批量删除 */
  const handleBatchDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    onBatchDelete(ids);
    // 重置批量模式
    setBatchMode(false);
    setSelectedIds(new Set());
  }, [selectedIds, onBatchDelete]);

  // ============================================================
  // 回收站相关操作（v1.1.0 新增）
  // ============================================================

  /** 打开回收站视图：拉取已删除会话列表 */
  const openTrashView = useCallback(async () => {
    setTrashLoading(true);
    try {
      const sessions = await fetchTrashSessions();
      setTrashSessions(sessions);
      setTrashView(true);
    } catch (e) {
      console.error('获取回收站会话失败:', e);
    } finally {
      setTrashLoading(false);
    }
  }, []);

  /** 关闭回收站视图，返回活跃会话列表 */
  const closeTrashView = useCallback(() => {
    setTrashView(false);
    setTrashSessions([]);
  }, []);

  /** 恢复回收站中的单个会话 */
  const handleRestoreSession = useCallback(async (id: string) => {
    try {
      await restoreSessions([id]);
      // 刷新回收站列表
      const sessions = await fetchTrashSessions();
      setTrashSessions(sessions);
      // v1.4.0：通知父组件刷新活跃会话列表
      onSessionsChanged?.();
    } catch (e) {
      console.error('恢复会话失败:', e);
    }
  }, [onSessionsChanged]);

  /** 清空回收站 */
  const handleEmptyTrash = useCallback(async () => {
    if (!confirm('确定清空回收站？所有已删除的会话将被永久删除，此操作不可撤销。')) return;
    try {
      await emptyTrash();
      // 清空后刷新
      setTrashSessions([]);
      // v1.4.0：通知父组件刷新活跃会话列表
      onSessionsChanged?.();
    } catch (e) {
      console.error('清空回收站失败:', e);
    }
  }, [onSessionsChanged]);

  /**
   * 计算回收站会话的剩余天数
   * 参数：
   *   - deletedAt: string，删除时间（ISO 字符串）
   * 返回值：string，如 "剩余 5 天"
   * 默认保留 7 天
   */
  const computeRemainingDays = useCallback((deletedAt?: string): string => {
    if (!deletedAt) return '未知';
    const deleted = new Date(deletedAt);
    const now = new Date();
    const diffMs = now.getTime() - deleted.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    const remaining = Math.max(0, 7 - diffDays);
    return `剩余 ${remaining} 天`;
  }, []);

  /**
   * 格式化回收站中的删除时间
   * 参数：
   *   - deletedAt: string，删除时间（ISO 字符串）
   * 返回值：string，格式如 "2026-06-24 15:30"
   */
  const formatDeletedTime = useCallback((deletedAt?: string): string => {
    if (!deletedAt) return '未知';
    const d = new Date(deletedAt);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }, []);

  return (
    <aside
      className={`flex-shrink-0 flex flex-col h-screen sticky top-0
                  ${expanded ? 'glass' : 'bg-surface-100/80 border-r border-surface-300'}
                  transition-all duration-slow ease-expressive
                  ${expanded ? 'w-80' : 'w-16'}`}
      style={{ transitionDuration: '280ms' }}
    >
      {/* ============================================================ */}
      {/* 顶部：Logo 按钮（点击切换展开/折叠） */}
      {/* ============================================================ */}
      <div
        className={`flex items-center h-16 border-b border-surface-300/50 flex-shrink-0
                    ${expanded ? 'justify-between px-4' : 'justify-center'}`}
      >
        {expanded ? (
          <>
            <button
              onClick={onToggle}
              aria-label="收起边栏"
              className="flex items-center gap-2 group"
            >
              {/* Hermes Logo */}
              <div
                className="w-9 h-9 rounded-xl bg-gradient-to-br from-hermes-500 to-hermes-600
                            flex items-center justify-center shadow-lg shadow-hermes-900/30
                            glow-hermes glow-hermes-hover"
              >
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-white tracking-tight">Hermes</div>
                <div className="text-[10px] text-surface-600">智能调度平台</div>
              </div>
            </button>
            {/* 收起按钮 */}
            <button
              onClick={onToggle}
              aria-label="收起边栏"
              className="icon-btn !w-7 !h-7"
              title="收起边栏"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </>
        ) : (
          /* v1.2.0 折叠态：Logo 按钮（点击展开）- 圆形渐变 + Tooltip */
          <div title="展开边栏" className="inline-block">
            <button
              onClick={onToggle}
              aria-label="展开边栏"
              className="w-10 h-10 rounded-full
                         bg-gradient-to-br from-hermes-50 to-hermes-100
                         flex items-center justify-center
                         hover:scale-110 hover:shadow-glow-hermes
                         transition-all duration-200
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400"
            >
              <svg
                className="w-5 h-5 text-hermes-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* v1.2.0 折叠态：顶部"新建对话"入口（仅在折叠态下显示） */}
      {/* ============================================================ */}
      {!expanded && (
        <div className="flex-shrink-0 border-b border-surface-300/50 flex justify-center py-3">
          {/* Tooltip 包裹层 + 圆形渐变按钮 */}
          <div title="新建对话" className="inline-block">
            <button
              onClick={onNewTask}
              aria-label="新建对话"
              className="w-10 h-10 rounded-full
                         bg-gradient-to-br from-hermes-50 to-hermes-100
                         flex items-center justify-center
                         hover:scale-110 hover:shadow-glow-hermes
                         transition-all duration-200
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400"
            >
              {/* Plus 加号图标 */}
              <svg
                className="w-4 h-4 text-hermes-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* v1.3.0：模式切换 pill 按钮（顶部搜索框上方） */}
      {/* 仅在非回收站视图下显示 */}
      {/* ============================================================ */}
      {!trashView && (
        <div className={`flex-shrink-0 border-b border-surface-300/50
                        ${expanded ? 'px-3 py-2 flex justify-center gap-2' : 'py-2 flex flex-col items-center gap-1.5'}`}>
          {/* 聊天模式 pill */}
          <button
            onClick={() => onModeSwitch('chat')}
            aria-label="切换到日常办公闲聊模式"
            title="💬 聊天"
            className={`transition-all duration-default ease-material
                        ${expanded
                          ? 'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium'
                          : 'w-8 h-8 rounded-full flex items-center justify-center text-[10px]'
                        }
                        ${appMode === 'chat'
                          ? 'bg-hermes-500 text-white shadow-glow-hermes-sm'
                          : 'text-surface-600 hover:text-surface-800 hover:bg-surface-200/60'
                        }`}
          >
            {expanded ? (
              <>
                <span>💬</span>
                <span>聊天</span>
              </>
            ) : (
              <span>💬</span>
            )}
          </button>

          {/* 编程模式 pill */}
          <button
            onClick={() => onModeSwitch('coding')}
            aria-label="切换到编程模式"
            title="⚡ 编程"
            className={`transition-all duration-default ease-material
                        ${expanded
                          ? 'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium'
                          : 'w-8 h-8 rounded-full flex items-center justify-center text-[10px]'
                        }
                        ${appMode === 'coding'
                          ? 'bg-hermes-500 text-white shadow-glow-hermes-sm'
                          : 'text-surface-600 hover:text-surface-800 hover:bg-surface-200/60'
                        }`}
          >
            {expanded ? (
              <>
                <span>⚡</span>
                <span>编程</span>
              </>
            ) : (
              <span>⚡</span>
            )}
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* v1.1.0：批量删除模式工具栏（仅在展开 + 批量模式下显示） */}
      {/* ============================================================ */}
      {expanded && batchMode && (
        <div className="px-3 py-2 border-b border-surface-300/50 flex-shrink-0
                        flex items-center justify-between gap-2
                        bg-hermes-500/10">
          {/* 取消按钮 */}
          <button
            onClick={cancelBatchMode}
            className="text-xs font-medium text-surface-700 hover:text-surface-900
                       px-2 py-1 rounded transition-colors
                       hover:bg-surface-200/60"
          >
            取消
          </button>
          {/* 删除所选按钮 */}
          {/* v1.4.0：deletingSession=true 时禁用按钮 + 灰化样式 + 显示加载文案 */}
          <button
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0 || deletingSession}
            className={`text-xs font-medium px-3 py-1 rounded transition-colors
                        ${selectedIds.size > 0 && !deletingSession
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-surface-300 text-surface-500 cursor-not-allowed opacity-50'
                        }`}
          >
            {deletingSession ? '删除中...' : `删除所选(${selectedIds.size})`}
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* 展开态：搜索框 + 批量删除入口（非批量模式才显示） */}
      {/* ============================================================ */}
      {expanded && !trashView && !batchMode && (
        <div className="px-3 py-3 border-b border-surface-300/50 flex-shrink-0 space-y-2">
          {/* 批量删除按钮（v1.1.0 新增） */}
          <button
            onClick={enterBatchMode}
            disabled={sessions.length === 0}
            className={`w-full flex items-center justify-center gap-1.5
                        text-xs font-medium py-1.5 rounded-md
                        border border-surface-400/50
                        transition-colors
                        ${sessions.length > 0
                          ? 'text-surface-700 hover:text-red-400 hover:border-red-400/30 hover:bg-red-500/5'
                          : 'text-surface-500 cursor-not-allowed opacity-50'
                        }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
            批量删除
          </button>
          {/* 搜索框 */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜索会话..."
              className="input-glow w-full pl-9 pr-3 py-2 text-sm rounded-md"
            />
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 会话列表区域（flex-1 占满剩余空间） */}
      {/* ============================================================ */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {expanded ? (
          /* ============================================================ */
          /* v1.1.0：回收站视图分支 */
          /* ============================================================ */
          trashView ? (
            <>
              {/* 回收站标题栏 */}
              <div className="px-3 py-2 border-b border-surface-300/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-surface-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                  <span className="text-sm font-medium text-surface-800">回收站</span>
                </div>
                <div className="flex items-center gap-1">
                  {/* 清空回收站按钮 */}
                  <button
                    onClick={handleEmptyTrash}
                    disabled={trashSessions.length === 0}
                    className={`text-xs px-2 py-1 rounded transition-colors
                                ${trashSessions.length > 0
                                  ? 'text-red-400 hover:bg-red-500/10'
                                  : 'text-surface-500 cursor-not-allowed opacity-50'
                                }`}
                  >
                    清空回收站
                  </button>
                  {/* 返回按钮 */}
                  <button
                    onClick={closeTrashView}
                    className="text-xs font-medium text-hermes-400 hover:text-hermes-300
                               px-2 py-1 rounded transition-colors hover:bg-hermes-500/10"
                  >
                    返回
                  </button>
                </div>
              </div>

              {/* 回收站会话列表 */}
              {trashLoading ? (
                <div className="p-3 space-y-2">
                  <div className="skeleton h-12 w-full" />
                  <div className="skeleton h-12 w-full" />
                </div>
              ) : trashSessions.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
                    </svg>
                  </span>
                  <span className="text-xs">回收站为空</span>
                </div>
              ) : (
                <div className="py-1">
                  {trashSessions.map(session => (
                    <div
                      key={session.id}
                      className="flex items-center gap-2 px-3 py-2.5
                                 border-l-2 border-transparent
                                 hover:bg-surface-200/60
                                 transition-all duration-default ease-material"
                    >
                      {/* 会话信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-surface-700 truncate"
                             title={session.title}>
                          {session.title || '新对话'}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-surface-500">
                            删除于 {formatDeletedTime(session.deleted_at)}
                          </span>
                          <span className="text-[10px] text-hermes-400 font-medium">
                            {computeRemainingDays(session.deleted_at)}
                          </span>
                        </div>
                      </div>
                      {/* 恢复按钮 */}
                      <button
                        onClick={() => handleRestoreSession(session.id)}
                        className="flex-shrink-0 text-xs text-hermes-400 hover:text-hermes-300
                                   px-2 py-1 rounded transition-colors
                                   hover:bg-hermes-500/10"
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
          /* ============================================================ */
          /* 正常模式：活跃会话列表 */
          /* ============================================================ */
          loading ? (
            <div className="p-3 space-y-2">
              <div className="skeleton h-12 w-full" />
              <div className="skeleton h-12 w-full" />
              <div className="skeleton h-12 w-full" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </span>
              <span className="text-xs">
                {searchQuery.trim() ? '无匹配会话' : '暂无历史会话'}
              </span>
            </div>
          ) : (
            <div className="py-1">
              {filteredSessions.map(session => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  onClick={() => onSelectSession(session.id)}
                  onDelete={() => onDeleteSession(session.id)}
                  disabled={deletingSession}
                  batchMode={batchMode}
                  checked={selectedIds.has(session.id)}
                  onCheck={() => toggleSelect(session.id)}
                />
              ))}
            </div>
          )
          )
        ) : (
          /* 折叠态：v1.2.0 视觉升级 - 仅显示激活会话的小圆点指示器（激活态金色 ring）
           * v1.4.0 修复：按 appMode 过滤后再切片，避免跨模式会话显示 */
          (() => {
            const modeSessions = sessions.filter(s => s.mode === appMode);
            return (
          <div className="flex flex-col items-center py-3 gap-2">
            {modeSessions.slice(0, 8).map(session => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                aria-label={session.title}
                title={session.title}
                className={`rounded-full transition-all duration-default ease-material
                            ${session.id === currentSessionId
                              ? 'w-3 h-3 bg-hermes-500 ring-2 ring-hermes-400 ring-offset-2 ring-offset-surface-100'
                              : 'w-2 h-2 bg-surface-500/60 hover:bg-hermes-400 hover:scale-125'
                            }`}
              />
            ))}
            {modeSessions.length > 8 && (
              <div className="text-[10px] text-surface-600 mt-1">
                +{modeSessions.length - 8}
              </div>
            )}
          </div>
            );
          })()
        )}
      </div>

      {/* ============================================================ */}
      {/* 底部：用户区 / 设置 + 回收站入口（v1.1.0 新增回收站按钮） */}
      {/* ============================================================ */}
      <div
        className={`flex-shrink-0 border-t border-surface-300/50
                    ${expanded ? 'p-3' : 'p-2 flex flex-col items-center gap-2'}`}
      >
        {expanded ? (
          <>
            {/* 回收站按钮（v1.1.0 新增） */}
            <button
              onClick={openTrashView}
              className="w-full flex items-center gap-2 px-2 py-2 mb-2 rounded-md
                         text-surface-600 hover:text-surface-800 hover:bg-surface-200/60
                         transition-all duration-default ease-material"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
              <span className="text-xs font-medium">回收站</span>
            </button>
            {/* 用户信息区 */}
            <div className="flex items-center gap-2 p-2 rounded-md hover:bg-surface-200/60 transition-all duration-default ease-material">
              {/* 用户头像 */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-hermes-500 to-hermes-600 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-surface-900 truncate">用户</div>
                <div className="text-[10px] text-surface-600 truncate">Hermes Workspace</div>
              </div>
              {/* 设置图标 */}
              <button
                aria-label="设置"
                title="全局设置"
                className="icon-btn !w-7 !h-7"
                onClick={onOpenSettings}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          /* v1.2.0 折叠态：底部"回收站"+"设置"图标 */
          <>
            {/* 回收站图标（v1.2.0 新增，激活态金色 ring） */}
            <div title="回收站" className="inline-block">
              <button
                aria-label="回收站"
                onClick={openTrashView}
                className={`w-10 h-10 rounded-full
                           bg-gradient-to-br from-hermes-50 to-hermes-100
                           flex items-center justify-center
                           hover:scale-110 hover:shadow-glow-hermes
                           transition-all duration-200
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400
                           ${trashView ? 'ring-2 ring-hermes-400' : ''}`}
              >
                <svg className="w-4 h-4 text-hermes-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                </svg>
              </button>
            </div>
            {/* 设置图标（v1.2.0 视觉升级：圆形渐变 + Tooltip） */}
            <div title="全局设置" className="inline-block">
              <button
                aria-label="设置"
                onClick={onOpenSettings}
                className="w-10 h-10 rounded-full
                           bg-gradient-to-br from-hermes-50 to-hermes-100
                           flex items-center justify-center
                           hover:scale-110 hover:shadow-glow-hermes
                           transition-all duration-200
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400"
              >
                <svg className="w-4 h-4 text-hermes-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
