/**
 * # ============================================================
 * # JumpToBottomButton - 跳到最新消息按钮 (v1.0.0 - Cycle 15 P1-2)
 * # ============================================================
 * # 核心作用：当用户向上滚动查看历史消息时，在右下角显示一个
 * #           "↓ 跳到最新"浮动按钮；点击后调用全局事件
 * #           'hermes:virtual-list:scroll-to-bottom' 触发
 * #           VirtualMessageList 平滑滚动到底部。
 * # 输入参数：
 * #   - visible: boolean，是否显示按钮
 * #   - newMessageCount?: number，未读新消息数量（小红点）
 * # 输出结果：浮动按钮 DOM
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-2 初始版本
 * # ============================================================
 */

import { useState, useEffect } from 'react';

export interface JumpToBottomButtonProps {
  /** 是否可见（用户在底部时为 false） */
  visible: boolean;
  /** 新消息数量（用于小红点） */
  newMessageCount?: number;
  /** className */
  className?: string;
}

/**
 * 跳到最新按钮
 * - 监听虚拟列表暴露的全局事件
 * - 触发滚动到底部
 */
export const JumpToBottomButton: React.FC<JumpToBottomButtonProps> = ({
  visible,
  newMessageCount = 0,
  className = '',
}) => {
  const [animKey, setAnimKey] = useState(0);

  // 每次变可见时触发入场动画
  useEffect(() => {
    if (visible) setAnimKey((k) => k + 1);
  }, [visible]);

  if (!visible) return null;

  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('hermes:virtual-list:scroll-to-bottom'));
  };

  return (
    <button
      key={animKey}
      type="button"
      onClick={handleClick}
      data-component="jump-to-bottom"
      aria-label="跳到最新消息"
      title="跳到最新消息"
      className={`
        absolute bottom-3 right-3 z-20
        flex items-center gap-1.5
        px-2.5 py-1.5
        rounded-full
        bg-surface-200/95 hover:bg-surface-300
        border border-surface-400/60 hover:border-hermes-500/50
        text-xs text-surface-700
        shadow-md
        backdrop-blur
        transition-all duration-200
        animate-msg-enter
        ${className}
      `}
    >
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
      <span>跳到最新</span>
      {newMessageCount > 0 && (
        <span
          className="
            inline-flex items-center justify-center
            min-w-[16px] h-4 px-1
            rounded-full
            bg-hermes-500 text-white text-[10px] font-semibold
          "
        >
          {newMessageCount > 99 ? '99+' : newMessageCount}
        </span>
      )}
    </button>
  );
};

export default JumpToBottomButton;
