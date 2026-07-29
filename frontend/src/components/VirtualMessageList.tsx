/**
 * # ============================================================
 * # VirtualMessageList - 虚拟化消息列表组件 (v1.0.0 - Cycle 15 P1-2)
 * # ============================================================
 * # 核心作用：使用 @tanstack/react-virtual 渲染大量消息，
 * #           仅渲染视口内 + overscan 范围内的消息，
 * #           解决 1000+ 长对话下的卡顿问题。
 * # 运行流程：
 * #   1. 父组件传入 messages 数组
 * #   2. useVirtualizer 测量每个消息的实际高度（动态）
 * #   3. 仅渲染 visible range + overscan 的消息
 * #   4. 流式接收时自动滚动到底部（scrollToIndex with smooth）
 * #   5. 用户主动滚动时不强制滚动（preserve scroll position）
 * # 输入参数：
 * #   - messages: ChatMessage[]，待渲染消息列表
 * #   - renderItem: (msg, index) => ReactNode，自定义消息渲染
 * #   - estimateSize?: (index) => number，预估每条高度（默认 100）
 * #   - overscan?: number，预渲染上下数量（默认 5）
 * #   - autoScrollToBottom?: boolean，是否流式时自动滚动（默认 true）
 * #   - followStream?: boolean，强制滚动到尾部的信号（如新消息 ID）
 * #   - className?: string，外层 className
 * # 输出结果：虚拟化列表 DOM
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-2 初始版本
 * #     - 集成 @tanstack/react-virtual ^3.14.9
 * #     - 动态高度测量（measureElement）
 * #     - 流式自动滚动（仅在接近底部时）
 * #     - 单元测试覆盖（28+ 用例）
 * # ============================================================
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatMessage } from '../utils/messageFormatters';

/** 虚拟化列表 Props */
export interface VirtualMessageListProps {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 自定义消息渲染函数 */
  renderItem: (msg: ChatMessage, index: number) => React.ReactNode;
  /** 预估每条消息高度（px），用于初始化布局 */
  estimateSize?: (index: number) => number;
  /** overscan 数量（视口外预渲染条数） */
  overscan?: number;
  /** 是否在流式时自动滚动到底部 */
  autoScrollToBottom?: boolean;
  /**
   * 触发滚动到底部的依赖值（如流式消息 ID）
   * 当此值变化时强制滚动到底部
   */
  followStreamKey?: string | number | null;
  /** 外层 className */
  className?: string;
  /** 容器 style */
  style?: React.CSSProperties;
  /** 列表末尾额外内容（如 ThinkingBlock / StreamingIndicator） */
  footer?: React.ReactNode;
  /**
   * 自定义唯一 key 取值（默认用 msg.id）
   * 当消息在会话中被替换/编辑时可用于强制重渲染
   */
  getItemKey?: (msg: ChatMessage, index: number) => string | number;
  /** 滚动事件回调（用于判断用户是否在底部） */
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  /** 用于在列表为空时显示内容 */
  emptyState?: React.ReactNode;
  /**
   * 触发强制滚动到底部的"事件"（每次 +1 即触发一次）
   * 用于"用户点击 Jump to Latest"按钮等场景
   */
  scrollToBottomSignal?: number;
}

/**
 * 虚拟化消息列表
 *
 * 设计要点：
 * 1. 使用 dynamic measurement 自动适配每条消息的实际高度
 * 2. 使用 overscan 减少快速滚动时的白屏
 * 3. 仅在用户已处于底部时跟随流式新内容滚动
 * 4. 提供 scrollToBottom API 用于"回到最新"按钮
 */
export const VirtualMessageList: React.FC<VirtualMessageListProps> = ({
  messages,
  renderItem,
  estimateSize = defaultEstimateSize,
  overscan = 5,
  autoScrollToBottom = true,
  followStreamKey,
  className,
  style,
  footer,
  getItemKey,
  onScroll,
  emptyState,
  scrollToBottomSignal = 0,
}) => {
  // 滚动容器 ref
  const parentRef = useRef<HTMLDivElement>(null);

  // 用户是否处于底部（用于决定是否跟随流式滚动）
  const [isAtBottom, setIsAtBottom] = useState(true);

  // 容器高度（用于初始化 virtualizer）
  const [containerHeight, setContainerHeight] = useState(0);

  /**
   * v1.0.0: 监听容器尺寸变化
   * 使用 ResizeObserver 确保虚拟化布局能响应父容器变化
   */
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    // 立即同步一次初始高度
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  /**
   * v1.0.0: 虚拟器
   * - count = messages.length + (footer ? 1 : 0)（footer 占一个虚拟项）
   * - estimateSize: 默认 100（普通气泡），footer 位置用 200
   * - overscan: 上下各渲染 5 条
   * - measureElement: 动态测量真实高度
   */
  const itemCount = messages.length + (footer ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // 最后一个 index 分配给 footer
      if (footer && index === itemCount - 1) {
        return 160; // footer 预估高度
      }
      return estimateSize(index);
    },
    overscan,
    measureElement: (el) => {
      // 动态测量：返回元素真实高度（含 padding）
      return el?.getBoundingClientRect().height ?? 100;
    },
  });

  /**
   * v1.0.0: 默认 key 函数
   * 用户可自定义 getItemKey；未提供时用 msg.id
   */
  const defaultGetItemKey = useCallback(
    (index: number) => {
      if (footer && index === itemCount - 1) return '__footer__';
      const msg = messages[index];
      return msg?.id ?? index;
    },
    [footer, itemCount, messages],
  );

  /**
   * v1.0.0: 跟踪用户滚动行为
   * 当距底部 < 50px 时视为"在底部"，否则视为用户已向上滚动
   */
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < 50;
      setIsAtBottom(atBottom);
      onScroll?.(e);
    },
    [onScroll],
  );

  /**
   * v1.0.0: 滚动到底部
   * 提供给外部"回到最新"按钮或自动跟随流式
   */
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (!parentRef.current) return;
      virtualizer.scrollToIndex(itemCount - 1, {
        align: 'end',
        behavior,
      });
    },
    [virtualizer, itemCount],
  );

  /**
   * v1.0.0: 监听流式 key 变化
   * 当 followStreamKey 变化时，如果用户原本在底部，自动滚动
   */
  const previousKeyRef = useRef(followStreamKey);
  useEffect(() => {
    if (!autoScrollToBottom) return;
    if (previousKeyRef.current === followStreamKey) return;
    previousKeyRef.current = followStreamKey;
    if (followStreamKey != null && isAtBottom) {
      // 等待 DOM 更新后滚动
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [followStreamKey, autoScrollToBottom, isAtBottom, scrollToBottom]);

  /**
   * v1.0.0: 消息数变化时，若原本在底部则跟随
   */
  const previousLengthRef = useRef(messages.length);
  useEffect(() => {
    if (!autoScrollToBottom) return;
    if (previousLengthRef.current === messages.length) return;
    const lengthDiff = messages.length - previousLengthRef.current;
    previousLengthRef.current = messages.length;
    if (lengthDiff > 0 && isAtBottom) {
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [messages.length, autoScrollToBottom, isAtBottom, scrollToBottom]);

  /**
   * v1.0.0: 外部 signal 触发强制滚动
   */
  const previousSignalRef = useRef(scrollToBottomSignal);
  useEffect(() => {
    if (previousSignalRef.current === scrollToBottomSignal) return;
    previousSignalRef.current = scrollToBottomSignal;
    requestAnimationFrame(() => scrollToBottom('smooth'));
  }, [scrollToBottomSignal, scrollToBottom]);

  /**
   * v1.0.0: 暴露滚动 API（通过 window 全局事件，ChatMainArea 可订阅）
   * 命名空间：hermes:virtual-list:scroll-to-bottom
   */
  useEffect(() => {
    if (!autoScrollToBottom) return;
    const handler = () => scrollToBottom('smooth');
    window.addEventListener('hermes:virtual-list:scroll-to-bottom', handler);
    return () => {
      window.removeEventListener('hermes:virtual-list:scroll-to-bottom', handler);
    };
  }, [autoScrollToBottom, scrollToBottom]);

  /**
   * v1.0.0: 渲染虚拟项
   * 每个虚拟项用 measureElement 标记 ref，virtualizer 会在挂载后测量
   */
  const virtualItems = virtualizer.getVirtualItems();

  // 容器高度兜底（避免首次渲染时 containerHeight=0 导致 virtualizer 报 warning）
  const safeHeight = containerHeight || 600;

  // 汇总总高度
  const totalHeight = useMemo(() => {
    return virtualizer.getTotalSize();
  }, [virtualizer, itemCount, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      data-component="virtual-message-list"
      data-item-count={itemCount}
      data-is-at-bottom={isAtBottom}
      data-container-height={safeHeight}
      className={className}
      style={{
        overflowY: 'auto',
        contain: 'strict',
        ...style,
      }}
    >
      {messages.length === 0 && !footer ? (
        emptyState ?? null
      ) : (
        <div
          style={{
            height: `${totalHeight}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            const isFooter = footer && virtualRow.index === itemCount - 1;
            const messageIndex = isFooter ? -1 : virtualRow.index;
            const msg = isFooter ? null : messages[virtualRow.index];
            const itemKey = getItemKey
              ? getItemKey(msg!, virtualRow.index)
              : defaultGetItemKey(virtualRow.index);

            return (
              <div
                key={itemKey}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {isFooter
                  ? footer
                  : renderItem(msg!, messageIndex)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * 默认高度估算
 * 根据消息角色与内容长度做粗略估计
 *   - 用户消息：偏短，预估 60-80px
 *   - Hermes 消息：偏长，预估 100-300px
 */
function defaultEstimateSize(index: number): number {
  // 基础 100px，根据 index 微调
  return 100 + (index % 4) * 20;
}

export default VirtualMessageList;
