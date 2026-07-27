/**
 * # ============================================================
 * ChatMainArea - 对话主区域组件
 * # ============================================================
 * 核心作用：从 App.tsx 抽离对话主区域
 * 包含：
 *   1. 流式状态指示器（thinking/answering/done）
 *   2. 消息列表（user/hermes 角色气泡）
 *   3. 思考过程折叠区
 *   4. 浮动输入区（豆包风格）
 *   5. 消息入场动画
 * 抽取日期：2026-07-27
 * 模块版本：v6.9.0 - P0-2 App.tsx 拆分第三阶段
 * 修改记录：
 *   - 2026-07-27 | v6.9.0 | 从 App.tsx 抽离对话主区域
 * ============================================================
 */

import React, { useEffect } from 'react';
import MessageBubble from './MessageBubble';
import ThinkingBlock from './ThinkingBlock';
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
  /** 消息容器 ref（用于自动滚动） */
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

/**
 * 对话主区域
 * - 顶部为消息流（user 在右、hermes 在左、含思考过程折叠）
 * - 底部为浮动输入区
 * - 支持流式状态指示和入场动画
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
}) => {
  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingStatus, thinkingContent, messagesEndRef]);

  return (
    <div
      data-component="chat-main-area"
      className="flex-1 flex flex-col min-w-0 h-full overflow-hidden"
    >
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
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
              />
            ))}

            {/* 实时思考过程（流式中） */}
            {isSending && thinkingContent && (
              <ThinkingBlock
                content={thinkingContent}
                isStreaming={streamingStatus === 'thinking'}
              />
            )}

            {/* 流式状态指示器 */}
            {isSending && (
              <StreamingIndicator
                status={streamingStatus}
                onStop={onStop}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
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
}

const MessageItem: React.FC<MessageItemProps> = ({ msg, isStreaming, isLast }) => {
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
            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
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
