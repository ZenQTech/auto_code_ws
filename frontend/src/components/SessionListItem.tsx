/**
 * # ============================================================
 * # 会话列表项组件
 * # ============================================================
 * # 核心作用：渲染左侧边栏中的单条历史会话
 * # 运行流程：
 * #   1. 接收 Session 元数据 + isActive / onClick / onDelete
 * #   2. 展示 title（前 30 字）+ 相对时间副标题 + 消息数徽章
 * #   3. 当前激活态：金橙左边框 + 浅色背景
 * #   4. 鼠标悬停时显示删除按钮，点击 e.stopPropagation() 触发 onDelete
 * #   5. v1.2.0 新增：批量删除模式下显示复选框，隐藏删除按钮
 * #   6. v1.2.0 新增：行内 hover 浮出 3 个小图标（重命名 / 归档 / 删除）
 * #   7. v1.2.0 新增：重命名交互（点击 Edit2 切换为 inline input，autoFocus，Enter 保存，Esc 取消）
 * # 输入参数（Props）：
 * #   - session: Session，会话元数据
 * #   - isActive: boolean，是否为当前激活会话
 * #   - onClick: () => void，点击列表项回调（批量模式下切换选中）
 * #   - onDelete: () => void，点击删除按钮回调（批量模式下隐藏）
 * #   - batchMode: boolean（v1.2.0 新增），是否处于批量删除模式
 * #   - checked: boolean（v1.2.0 新增），当前项是否被选中
 * #   - onCheck: () => void（v1.2.0 新增），点击复选框回调
 * # 输出结果：纯 UI 组件，无返回值
 * # ============================================================
 * # 修改记录：
 * #   - 2026-06-23 | v1.0.0 | 初始版本：实现 title 截取 / 相对时间 / 消息数徽章 / 悬停删除按钮
 * #   - 2026-06-23 | v1.1.0 | displayTitle 派生计算（撤销 AI 总结，纯前端截取显示）
 * #   - 2026-06-24 | v1.2.0 | 行内 hover 操作图标（重命名 / 归档 / 删除）+ 重命名 inline input 交互（内部 useState 方案，不破坏 props 签名）
 * #   - 2026-06-25 | v1.3.0 | formatRelativeTime 提取到 ../utils/time.ts 共享
 * #   - 2026-06-25 | v1.3.1 | Task 4b: handleArchive 从 console.log 占位改为调用 updateSession(session.id, { status: 'archived' })
 * # ============================================================
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Session } from '../types';
import { updateSession } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/time';

interface Props {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  /** 是否处于批量删除模式（v1.2.0 新增） */
  batchMode?: boolean;
  /** 当前项是否被选中（v1.2.0 新增） */
  checked?: boolean;
  /** 点击复选框回调（v1.2.0 新增） */
  onCheck?: () => void;
}

// ============================================================
// inline SVG 图标组件（v1.2.0 新增）
// 作用：避免引入 lucide-react 依赖；保持 12×12 viewBox 24×24 描边风格
// ============================================================

/** 重命名图标（铅笔 + 方形） */
const EditIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

/** 归档图标（盒 + 顶盖） */
const ArchiveIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

/** 删除图标（垃圾桶） */
const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

/**
 * 派生计算 displayTitle（v1.1.0 新增）
 * 作用：根据 Session 元数据按优先级实时计算侧边栏会话项的 title 展示，
 *       不依赖 Session.title 字段的自动写回（撤销 auto-session-title-generation）
 * 判定顺序：
 *   1. 手动命名优先：若 session.title 不为空且 !== "新对话" → 用 session.title
 *   2. 历史对话兜底：若 message_count > 0 且 user_first_message 非空 → 用首条用户消息
 *   3. 占位文案：否则用固定 "新对话"
 * 输入参数：session: Session，会话元数据
 * 返回值：string，派生出的展示标题
 */
function deriveDisplayTitle(session: Session): string {
  // 1. 手动命名优先
  if (session.title && session.title !== '新对话') {
    return session.title;
  }
  // 2. 有消息时用首条用户消息
  if (session.message_count > 0 && session.user_first_message) {
    return session.user_first_message;
  }
  // 3. 占位
  return '新对话';
}

/**
 * SessionListItem 组件
 * v1.2.0 改造：
 *   - 行内 hover 浮出 3 个小图标（重命名 / 归档 / 删除）
 *   - 重命名交互：使用内部 useState 模式，不引入新 props（保持 props 签名兼容）
 *   - 点击图标 stopPropagation，避免触发外层 onClick
 *   - 重命名保存：调 updateSession(id, { title: newTitle })，失败 console.warn
 */
export default function SessionListItem({ session, isActive, onClick, onDelete, batchMode, checked, onCheck }: Props) {
  const relTime = formatRelativeTime(session.last_active_at);
  // v1.1.0：派生计算 displayTitle，渲染时使用 displayTitle（单行省略号由 CSS truncate 处理）
  const displayTitle = deriveDisplayTitle(session);
  const msgCount = session.message_count ?? 0;

  // ============================================================
  // v1.2.0：行内操作 - 内部 useState 模式（不破坏 props 签名）
  // ============================================================
  /** 是否处于重命名编辑态 */
  const [isEditing, setIsEditing] = useState(false);
  /** 重命名输入框的当前值 */
  const [editValue, setEditValue] = useState('');
  /** inline input 引用（用于 autoFocus） */
  const editInputRef = useRef<HTMLInputElement>(null);

  /**
   * 进入重命名编辑态
   * 运行步骤：
   *   1. 设置 isEditing=true
   *   2. 用当前 displayTitle 初始化 editValue
   *   3. 等待 DOM 渲染后 focus input
   */
  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    // 阻止冒泡，避免触发外层 onClick
    e.stopPropagation();
    setEditValue(deriveDisplayTitle(session));
    setIsEditing(true);
  }, [session]);

  /**
   * 保存重命名
   * 运行步骤：
   *   1. 取 editValue.trim() 作为新 title
   *   2. 调 updateSession(id, { title: newTitle })
   *   3. 成功：setIsEditing(false)
   *   4. 失败：console.warn + setIsEditing(false)
   * 参数：
   *   - e?: React.FormEvent 或 React.KeyboardEvent
   */
  const handleSaveEdit = useCallback(async (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    const newTitle = editValue.trim();
    // 标题为空时直接退出编辑（不允许空标题）
    if (!newTitle) {
      setIsEditing(false);
      return;
    }
    // 标题未变化，直接退出
    if (newTitle === deriveDisplayTitle(session)) {
      setIsEditing(false);
      return;
    }
    try {
      await updateSession(session.id, { title: newTitle });
      setIsEditing(false);
    } catch (err) {
      console.warn('重命名失败：', err);
      setIsEditing(false);
    }
  }, [editValue, session]);

  /**
   * 取消重命名
   * 运行步骤：
   *   1. 清空 editValue
   *   2. 退出编辑态
   */
  const handleCancelEdit = useCallback((e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.stopPropagation();
    setEditValue('');
    setIsEditing(false);
  }, []);

  /**
   * inline input 的键盘事件处理
   * Enter → handleSaveEdit
   * Esc → handleCancelEdit
   */
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSaveEdit(e);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancelEdit(e);
    }
  }, [handleSaveEdit, handleCancelEdit]);

  // 副作用：进入编辑态后自动 focus 并全选
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  /**
   * 归档按钮处理（v1.2.0 新增，v1.3.0 实现）
   * 运行步骤：
   *   1. 阻止事件冒泡（避免触发外层 onClick）
   *   2. 调用 updateSession 将 status 设为 'archived'
   *   3. 失败时 console.warn（静默处理，不阻断 UI）
   */
  const handleArchive = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateSession(session.id, { status: 'archived' });
    } catch (err) {
      console.warn('归档失败：', err);
    }
  }, [session.id]);

  return (
    <div
      onClick={batchMode ? onCheck : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (batchMode ? onCheck : onClick)?.();
        }
      }}
      className={`group relative flex flex-col gap-1 px-3 py-2.5 cursor-pointer
                  transition-all duration-default ease-material
                  border-l-2
                  ${isActive
                    ? 'border-l-2 border-hermes-500 bg-hermes-500/10'
                    : 'border-l-2 border-transparent hover:bg-surface-200/60'
                  }`}
    >
      {/* 顶部行：批量模式复选框 + 标题（或 inline input）+ 行内 hover 操作 */}
      <div className="flex items-start justify-between gap-2">
        {/* v1.2.0：批量删除模式下的复选框 */}
        {batchMode && (
          <input
            type="checkbox"
            checked={checked ?? false}
            onChange={onCheck}
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0 w-4 h-4 mt-0.5
                       accent-hermes-500
                       rounded border-surface-500
                       cursor-pointer
                       focus:ring-1 focus:ring-hermes-500"
          />
        )}

        {/* 标题区：根据 isEditing 切换展示模式 */}
        {isEditing ? (
          // v1.2.0：inline input 重命名态
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0"
          >
            <input
              ref={editInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              onBlur={handleSaveEdit}
              // 阻止 input 的 click 冒泡到外层（避免触发外层 onClick）
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-white border border-hermes-300 rounded px-2 py-1
                         text-body text-surface-900
                         focus:outline-none focus:ring-2 focus:ring-hermes-300
                         transition-shadow duration-fast ease-material"
              maxLength={120}
            />
          </form>
        ) : (
          // 展示态：title + 行内 hover 操作图标
          <>
            <span
              className={`flex-1 min-w-0 text-sm font-medium truncate
                          ${isActive ? 'text-hermes-100' : 'text-surface-800'}`}
              title={displayTitle}
            >
              {displayTitle}
            </span>

            {/* 消息数徽章 */}
            {msgCount > 0 && (
              <span
                className="flex-shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded
                           bg-hermes-500/20 text-hermes-300 font-medium"
              >
                {msgCount}
              </span>
            )}

            {/* v1.2.0：行内 hover 操作（重命名 / 归档 / 删除）- 仅在非批量模式下展示 */}
            {!batchMode && (
              <div className="flex-shrink-0 flex items-center gap-1
                              opacity-0 group-hover:opacity-100
                              transition-opacity duration-150">
                {/* 重命名按钮 */}
                <button
                  onClick={handleStartEdit}
                  title="重命名"
                  aria-label="重命名"
                  className="w-6 h-6 rounded hover:bg-surface-100
                             flex items-center justify-center
                             text-surface-500 hover:text-hermes-500 hover:scale-110
                             transition-all duration-fast ease-material
                             focus:outline-none focus-visible:ring-1 focus-visible:ring-hermes-400"
                >
                  <EditIcon />
                </button>
                {/* 归档按钮 */}
                <button
                  onClick={handleArchive}
                  title="归档"
                  aria-label="归档"
                  className="w-6 h-6 rounded hover:bg-surface-100
                             flex items-center justify-center
                             text-surface-500 hover:text-hermes-500 hover:scale-110
                             transition-all duration-fast ease-material
                             focus:outline-none focus-visible:ring-1 focus-visible:ring-hermes-400"
                >
                  <ArchiveIcon />
                </button>
                {/* 删除按钮（保留原有逻辑） */}
                <button
                  onClick={(e) => {
                    // 阻止冒泡，避免触发外层 onClick
                    e.stopPropagation();
                    onDelete();
                  }}
                  aria-label="删除会话"
                  title="删除"
                  className="w-6 h-6 rounded hover:bg-surface-100
                             flex items-center justify-center
                             text-surface-500 hover:text-red-400 hover:scale-110
                             transition-all duration-fast ease-material
                             focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
                >
                  <TrashIcon />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 副标题：相对时间（编辑态隐藏，避免视觉冗余） */}
      {!isEditing && (
        <div className="flex items-center justify-between text-[11px] text-surface-600">
          <span>{relTime}</span>
          {isActive && (
            <span className="text-hermes-400 font-medium">● 当前</span>
          )}
        </div>
      )}
    </div>
  );
}

// 提示：useState / useRef / useEffect / useCallback 均已从 react 顶部导入
