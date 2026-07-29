/**
 * # ============================================================
 * # ChatMainArea - 对话主区域组件 (v6.10.0 - Cycle 15 P1-2)
 * # ============================================================
 * # 核心作用：从 App.tsx 抽离对话主区域
 * # 包含：
 * #   1. 流式状态指示器（thinking/answering/done）
 * #   2. 消息列表（user/hermes 角色气泡）— P1-2 升级为虚拟列表
 * #   3. 思考过程折叠区
 * #   4. 浮动输入区（豆包风格）
 * #   5. 消息入场动画
 * #   6. P1-2 新增：JumpToBottom 浮动按钮
 * # 抽取日期：2026-07-27
 * # 模块版本：
 * #   - v6.9.0 - P0-2 App.tsx 拆分第三阶段
 * #   - v6.10.0 - Cycle 15 P1-2 消息列表虚拟化
 * # 修改记录：
 * #   - 2026-07-27 | v6.9.0 | 从 App.tsx 抽离对话主区域
 * #   - 2026-07-29 | v6.10.0 | P1-2 引入 @tanstack/react-virtual 虚拟化
 * #     - 替换 messages.map 为 VirtualMessageList
 * #     - 保留自动滚动 + 新增 JumpToBottom 按钮
 * #     - 性能：1000+ 长消息流畅渲染
 * #   - 2026-07-29 | v6.10.1 | P1-4 MarkdownContent 接入
 * #     - 助手消息正文由纯文本替换为 MarkdownContent
 * #     - 代码块自动 shiki 高亮
 * #     - 流式场景下批渲染（30 行 / 80ms）
 * # ============================================================
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ThinkingBlock from './ThinkingBlock';
import VirtualMessageList from './VirtualMessageList';
import JumpToBottomButton from './JumpToBottomButton';
import MarkdownContent from './MarkdownContent';
import type { ChatMessage } from '../utils/messageFormatters';

export type StreamingStatus = 'thinking' | 'answering' | 'done' | null;

export interface ChatMainAreaProps {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 是否正在发送 */
  isSending: boolean;
  /** 流式状态 */
  streamingStatus: StreamingStatus;
  /** 当前流式消息 ID */
  streamingMessageId: string | null;
  /** 思考过程内容（实时更新） */
  thinkingContent: string;
  /** 上一条消息 ID（用于触发呼吸高光动画） */
  lastMessageId: string | null;
  /** 输入框当前值 */
  inputValue: string;
  /** 输入框变化回调 */
  onInputChange: (value: string) => void;
  /** 发送消息回调 */
  onSend: () => void;
  /** 中断流式请求回调 */
  onStop: () => void;
  /** Enter 键处理回调 */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** 输入框 ref 引用 */
  inputRef: React.RefObject<HTMLTextAreaElement>;
  /** 消息容器 ref（用于自动滚动，向后兼容保留） */
  messagesEndRef: React.RefObject<HTMLDivElement>;
  /**
   * v6.10.0: 是否启用虚拟列表（默认 true）
   * 关闭时回退到简单 map 渲染，便于在不支持的浏览器调试
   */
  useVirtualList?: boolean;
}

/**
 * 对话主区域
 * - 顶部为消息流（user 在右、hermes 在左、含思考过程折叠）
 * - 底部为浮动输入区
 * - 支持流式状态指示和入场动画
 * - v6.10.0 起：长消息使用虚拟列表渲染
 */
export const ChatMainArea: React.FC<ChatMainAreaProps> = ({
  messages,
  isSending,
  streamingStatus,
  streamingMessageId,
  thinkingContent,
  lastMessageId,
  inputValue,
  onInputChange,
  onSend,
  onStop,
  onKeyDown,
  inputRef,
  messagesEndRef,
  useVirtualList = true,
}) => {
  // v6.10.0：用于 JumpToBottom 按钮可见性
  const [isAtBottom, setIsAtBottom] = useState(true);

  // v6.10.0：未读消息计数（用户在底部时归零）
  const unreadCountRef = useRef(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousLengthRef = useRef(messages.length);

  // v6.10.0：检测非流式时的新消息，若用户已离开底部则累加 unread
  useEffect(() => {
    if (messages.length <= previousLengthRef.current) {
      previousLengthRef.current = messages.length;
      return;
    }
    const added = messages.length - previousLengthRef.current;
    previousLengthRef.current = messages.length;
    if (!isSending && !isAtBottom) {
      unreadCountRef.current += added;
      setUnreadCount(unreadCountRef.current);
    }
  }, [messages.length, isSending, isAtBottom]);

  // v6.10.0：回到底部时清空未读
  useEffect(() => {
    if (isAtBottom) {
      unreadCountRef.current = 0;
      setUnreadCount(0);
    }
  }, [isAtBottom]);

  // v6.10.0：滚动状态变化回调
  const handleListScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsAtBottom(distanceFromBottom < 50);
    },
    [],
  );

  // 兼容旧版 messagesEndRef 的回退（仅在未启用虚拟列表时使用）
  useEffect(() => {
    if (useVirtualList) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingStatus, thinkingContent, messagesEndRef, useVirtualList]);

  /**
   * v6.10.0：消息渲染函数
   * - 每条消息根据 role 渲染对应气泡
   * - 流式消息附 thinkingContent（动态）
   */
  const renderItem = useCallback(
    (msg: ChatMessage, _index: number) => (
      <MessageItem
        msg={msg}
        isStreaming={msg.id === streamingMessageId}
        isLast={msg.id === lastMessageId}
        liveThinking={msg.id === streamingMessageId ? thinkingContent : ''}
        liveStage={msg.id === streamingMessageId ? 'analysis' : 'idle'}
      />
    ),
    [streamingMessageId, lastMessageId, thinkingContent],
  );

  /**
   * v6.10.0：虚拟列表 footer
   * - 实时思考块（流式中）
   * - 流式状态指示器
   * - 兼容旧 messagesEndRef 锚点
   */
  const listFooter = isSending ? (
    <div className="pt-2">
      {thinkingContent && streamingStatus === 'thinking' && (
        <ThinkingBlock content={thinkingContent} isStreaming={true} />
      )}
      <StreamingIndicator status={streamingStatus} onStop={onStop} />
    </div>
  ) : (
    <div ref={messagesEndRef} className="h-1" />
  );

  return (
    <div
      data-component="chat-main-area"
      className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative"
    >
      {/* 消息列表（v6.10.0：虚拟化 / 兼容回退） */}
      <div className="flex-1 relative overflow-hidden">
        {useVirtualList ? (
          <VirtualMessageList
            messages={messages}
            renderItem={renderItem}
            estimateSize={(idx) => {
              const m = messages[idx];
              if (!m) return 100;
              // 简单估算：根据内容长度
              if (m.content.length < 80) return 80;
              if (m.content.length < 300) return 140;
              return 200;
            }}
            overscan={5}
            autoScrollToBottom={true}
            followStreamKey={streamingMessageId ?? (isSending ? 'thinking' : null)}
            onScroll={handleListScroll}
            className="absolute inset-0 px-4 py-3"
            footer={listFooter}
            emptyState={
              <div className="h-full flex items-center justify-center text-surface-500 text-sm">
                暂无消息，开始与 Hermes 对话吧
              </div>
            }
          />
        ) : (
          <div className="absolute inset-0 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-surface-500 text-sm">
                暂无消息，开始与 Hermes 对话吧
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <MessageItem
                    key={msg.id}
                    msg={msg}
                    isStreaming={msg.id === streamingMessageId}
                    isLast={msg.id === lastMessageId}
                    liveThinking={msg.id === streamingMessageId ? thinkingContent : ''}
                    liveStage={msg.id === streamingMessageId ? 'analysis' : 'idle'}
                  />
                ))}
                {isSending && thinkingContent && (
                  <ThinkingBlock
                    content={thinkingContent}
                    isStreaming={streamingStatus === 'thinking'}
                  />
                )}
                {isSending && <StreamingIndicator status={streamingStatus} onStop={onStop} />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        )}

        {/* v6.10.0：跳到最新浮动按钮 */}
        <JumpToBottomButton
          visible={!isAtBottom && messages.length > 0}
          newMessageCount={unreadCount}
        />
      </div>

      {/* 浮动输入区 */}
      <div className="flex-shrink-0 px-4 pb-3">
        <div className="flex items-end gap-2 bg-surface-200 rounded-2xl border border-surface-400/50 px-3 py-2 shadow-sm focus-within:border-hermes-500 transition-colors">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
            className="flex-1 bg-transparent text-sm text-surface-900 placeholder-surface-500 outline-none resize-none min-h-[36px] max-h-[120px] py-1.5"
            rows={1}
            disabled={isSending}
          />
          {isSending ? (
            <button
              type="button"
              onClick={onStop}
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors"
              aria-label="停止生成"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!inputValue.trim()}
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-hermes-500 hover:bg-hermes-600 disabled:bg-surface-400 text-white flex items-center justify-center transition-colors"
              aria-label="发送消息"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface MessageItemProps {
  msg: ChatMessage;
  isStreaming: boolean;
  isLast: boolean;
  /** 当前流式思考内容（仅流式消息需要） */
  liveThinking?: string;
  liveStage?: 'idle' | 'analysis' | 'planning' | 'coding' | 'testing';
}

const MessageItem: React.FC<MessageItemProps> = ({
  msg,
  isStreaming,
  isLast,
  liveThinking = '',
  liveStage = 'idle',
}) => {
  // 流式中且尚无内容时显示思考块
  if (isStreaming && !msg.content && (liveThinking || msg.thinking)) {
    return (
      <div className="animate-msg-enter">
        <ThinkingBlock
          content={liveThinking || msg.thinking || ''}
          isStreaming={true}
          stage={liveStage}
        />
      </div>
    );
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end animate-msg-enter">
        <div className="max-w-[80%] bg-hermes-500 text-white rounded-xl rounded-br-sm px-3 py-2 text-sm leading-relaxed shadow-sm">
          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex animate-msg-enter ${isLast && !isStreaming ? 'msg-breath' : ''}`}>
      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-hermes-500 to-hermes-600 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5 shadow-sm">
        <span className="text-white text-[10px] font-bold">H</span>
      </div>
      <div className="max-w-[90%] flex-1">
        {msg.error ? (
          <MessageBubble role="assistant" content="" error={msg.error} />
        ) : (
          <div className="bg-surface-200 text-surface-800 rounded-xl rounded-bl-sm border border-surface-400/50 px-3 py-2 text-sm leading-relaxed">
            {msg.thinking && !isStreaming && (
              <ThinkingBlock content={msg.thinking} isStreaming={false} stage="idle" />
            )}
            {/* v6.10.0+ P1-4: 使用 MarkdownContent 渲染（代码块接入 shiki） */}
            <MarkdownContent
              content={msg.content}
              theme="dark"
              streamingBatchSize={isStreaming ? 30 : 0}
              streamingBatchIntervalMs={isStreaming ? 80 : 0}
            />
            {isStreaming && (
              <span className="inline-block w-1.5 h-3 bg-hermes-400 ml-0.5 align-text-bottom animate-pulse" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface StreamingIndicatorProps {
  status: StreamingStatus;
  onStop: () => void;
}

const StreamingIndicator: React.FC<StreamingIndicatorProps> = ({ status }) => {
  if (status === 'thinking') {
    return (
      <div className="flex items-center gap-2 text-xs text-surface-600 pl-8">
        <span className="inline-flex gap-1">
          <span className="w-1.5 h-1.5 bg-hermes-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 bg-hermes-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 bg-hermes-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
        <span>Hermes 正在思考...</span>
      </div>
    );
  }

  if (status === 'answering') {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-600 pl-8">
        <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        <span>正在生成回答...</span>
      </div>
    );
  }

  return null;
};

export default ChatMainArea;
