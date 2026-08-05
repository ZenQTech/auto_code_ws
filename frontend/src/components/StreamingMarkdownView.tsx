/**
 * # ============================================================
 * # StreamingMarkdownView 组件 (v1.0.0)
 * # Cycle 67 G67-02
 * # ====================================
 * # 核心作用：渐进式渲染流式 Markdown
 * # 功能：
 * #   1. 已完成 block 立即渲染（带淡入动画）
 * #   2. 未完成 block 显示"光标"动效
 * #   3. 代码块自动高亮（shiki）
 * #   4. 自动滚动 / 手动滚动切换
 * #   5. 进度条：已渲染 block / 总 tokens
 * #   6. 错误恢复提示
 * # 输入参数：
 * #   - sessionId: string
 * #   - wsUrl?: string
 * #   - initialContent?: string（用于测试）
#   - onBlockRender?: (block) => void
 #   - testId?: string
 # 输出结果：纯 UI 组件
 # 对标：Trae SOLO 渐进式渲染
 # ====================================
 # 修改记录：
 #   - 2026-08-05 | v1.0.0 | Cycle 67 G67-02 初次创建
 # ====================================
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  useStreamingMarkdown,
  type MarkdownBlock,
} from '../hooks/useStreamingMarkdown';
import { MarkdownContent } from './MarkdownContent';

// ============================================================
// 类型
// ====================================

export interface StreamingMarkdownViewProps {
  sessionId: string;
  wsUrl?: string;
  /** 初始内容（仅用于测试或预填充） */
  initialContent?: string;
  /** 单个 block 渲染回调 */
  onBlockRender?: (block: MarkdownBlock) => void;
  /** 主题：dark | light */
  theme?: 'dark' | 'light';
  /** 测试 ID */
  testId?: string;
  /** 是否启用自动滚动 */
  autoScroll?: boolean;
  /** 是否显示进度条 */
  showProgress?: boolean;
}

// ============================================================
// 子组件：BlockRenderer
// ====================================

interface BlockRendererProps {
  block: MarkdownBlock;
  theme: 'dark' | 'light';
  onRender?: (block: MarkdownBlock) => void;
}

const BlockRenderer: React.FC<BlockRendererProps> = React.memo(
  ({ block, theme, onRender }) => {
    useEffect(() => {
      onRender?.(block);
    }, [block, onRender]);

    if (block.type === 'code') {
      return (
        <div
          className="my-2 animate-fade-in"
          data-testid="streaming-md-code-block"
          data-language={block.language}
        >
          <MarkdownContent
            content={'```' + (block.language || '') + '\n' + block.content + '\n```'}
            theme={theme}
            streamingBatchSize={0}
          />
        </div>
      );
    }

    if (block.type === 'heading') {
      const level = block.level || 1;
      const headingClass: Record<number, string> = {
        1: 'text-2xl font-bold mt-3 mb-2',
        2: 'text-xl font-bold mt-2.5 mb-1.5',
        3: 'text-lg font-semibold mt-2 mb-1',
        4: 'text-base font-semibold mt-1.5 mb-1',
        5: 'text-sm font-semibold mt-1',
        6: 'text-xs font-semibold mt-1',
      };
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag
          className={`${headingClass[level] || headingClass[1]} text-[var(--text-primary)] animate-fade-in`}
          data-testid="streaming-md-heading"
          data-level={level}
        >
          {block.content}
        </Tag>
      );
    }

    if (block.type === 'list') {
      const items = block.content.split('\n').filter(Boolean);
      const isOrdered = /^\s*\d+\./.test(items[0] || '');
      const ListTag = isOrdered ? 'ol' : 'ul';
      return (
        <ListTag
          className={`my-1.5 pl-6 ${isOrdered ? 'list-decimal' : 'list-disc'} text-sm text-[var(--text-primary)] animate-fade-in`}
          data-testid="streaming-md-list"
        >
          {items.map((item, idx) => {
            const cleaned = item.replace(/^(\s*)([-*+]|\d+\.)\s+/, '');
            return <li key={idx}>{cleaned}</li>;
          })}
        </ListTag>
      );
    }

    if (block.type === 'quote') {
      return (
        <blockquote
          className="border-l-4 border-hermes-500 pl-3 my-1.5
                     text-sm text-[var(--text-secondary)] italic
                     animate-fade-in"
          data-testid="streaming-md-quote"
        >
          {block.content}
        </blockquote>
      );
    }

    // paragraph / text
    return (
      <div
        className="text-sm text-[var(--text-primary)] my-1.5 leading-relaxed animate-fade-in"
        data-testid="streaming-md-paragraph"
      >
        <MarkdownContent
          content={block.content}
          theme={theme}
          streamingBatchSize={0}
        />
      </div>
    );
  },
);
BlockRenderer.displayName = 'BlockRenderer';

// ============================================================
// 主组件
// ====================================

export const StreamingMarkdownView: React.FC<StreamingMarkdownViewProps> = ({
  sessionId,
  wsUrl,
  initialContent,
  onBlockRender,
  theme = 'dark',
  testId = 'streaming-markdown-view',
  autoScroll = true,
  showProgress = true,
}) => {
  const {
    blocks,
    pendingContent,
    isStreaming,
    totalTokens,
    totalBlocks,
    error,
    connected,
    appendDelta,
    endStream,
    reset,
    reconnect,
  } = useStreamingMarkdown({ sessionId, wsUrl });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const lastBlockCountRef = useRef(0);

  // 初始内容（如有）
  useEffect(() => {
    if (initialContent) {
      // 分块喂入模拟流式
      const chunks = initialContent.match(/.{1,40}/g) || [initialContent];
      let i = 0;
      const interval = setInterval(() => {
        if (i >= chunks.length) {
          clearInterval(interval);
          endStream();
          return;
        }
        appendDelta(chunks[i]);
        i++;
      }, 16);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [initialContent, appendDelta, endStream]);

  // 自动滚动
  useEffect(() => {
    if (!autoScroll || userScrolled) return;
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [blocks, pendingContent, autoScroll, userScrolled]);

  // 检测用户上滑
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setUserScrolled(!atBottom);
  }, []);

  // 跳到底部
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setUserScrolled(false);
    }
  }, []);

  // 重置
  const handleReset = useCallback(() => {
    if (confirm('确定清空已渲染内容？')) {
      reset();
      lastBlockCountRef.current = 0;
    }
  }, [reset]);

  // block 渲染回调
  const handleBlockRender = useCallback(
    (block: MarkdownBlock) => {
      onBlockRender?.(block);
    },
    [onBlockRender],
  );

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg-panel)]
                  text-[var(--text-primary)]"
      data-testid={testId}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)]
                      flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">📝</span>
          <h3 className="text-xs font-semibold">流式渲染</h3>
          {isStreaming && (
            <span
              className="px-1.5 py-0.5 text-[9px] rounded
                         bg-blue-500/20 text-blue-500
                         flex items-center gap-1"
              data-testid="streaming-md-badge"
            >
              <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
              渲染中
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? 'bg-green-500' : 'bg-gray-400'
            }`}
            data-testid="streaming-md-connection"
          />
          <button
            type="button"
            onClick={reconnect}
            className="px-1.5 py-0.5 text-[10px] rounded
                       hover:bg-[var(--bg-elevated)]
                       text-[var(--text-secondary)]"
            title="重连"
            data-testid="streaming-md-reconnect-btn"
          >
            📡
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-1.5 py-0.5 text-[10px] rounded
                       hover:bg-red-500/20 text-red-500"
            title="清空"
            data-testid="streaming-md-reset-btn"
          >
            🗑
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      {showProgress && (
        <div
          className="px-3 py-1.5 border-b border-[var(--border-color)]
                     flex items-center gap-3 text-[10px]
                     text-[var(--text-secondary)]
                     bg-[var(--bg-app)]/40 flex-shrink-0"
          data-testid="streaming-md-progress"
        >
          <span>Blocks: <strong data-testid="streaming-md-block-count">{totalBlocks}</strong></span>
          <span>·</span>
          <span>Tokens: <strong data-testid="streaming-md-token-count">{totalTokens}</strong></span>
          {isStreaming && pendingContent && (
            <>
              <span>·</span>
              <span>Pending: <strong>{pendingContent.length}c</strong></span>
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="px-3 py-1.5 text-[10px]
                     bg-red-500/10 text-red-500
                     border-b border-red-500/30"
          data-testid="streaming-md-error"
        >
          ⚠ {error}
        </div>
      )}

      {/* Body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3"
        data-testid="streaming-md-container"
      >
        {blocks.length === 0 && !pendingContent && (
          <div
            className="text-center py-8 px-4
                       text-[var(--text-tertiary)] text-[11px]"
            data-testid="streaming-md-empty"
          >
            <div className="text-2xl mb-2 opacity-50">📝</div>
            <div>等待流式内容...</div>
            <div className="mt-1 text-[10px]">
              启动 session 后，Markdown 内容会渐进式渲染
            </div>
          </div>
        )}

        {blocks.map((block) => (
          <BlockRenderer
            key={block.id}
            block={block}
            theme={theme}
            onRender={handleBlockRender}
          />
        ))}

        {/* Pending Content（光标位置） */}
        {pendingContent && (
          <div
            className="text-sm text-[var(--text-primary)] my-1.5
                       font-mono whitespace-pre-wrap break-words
                       animate-pulse-subtle"
            data-testid="streaming-md-pending"
          >
            {pendingContent}
            <span className="inline-block w-1.5 h-3 ml-0.5
                           bg-blue-500 animate-blink" />
          </div>
        )}
      </div>

      {/* Jump to bottom button */}
      {userScrolled && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3
                     px-2 py-1 text-[10px] rounded-full
                     bg-blue-500 text-white shadow-lg
                     hover:bg-blue-600 transition-colors"
          data-testid="streaming-md-jump-bottom"
        >
          ↓ 跳到底部
        </button>
      )}
    </div>
  );
};

export default StreamingMarkdownView;
