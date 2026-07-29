/**
 * # ============================================================
 * MessageRow - 单条消息行（v1.0.0 独立提取）
 * # ============================================================
 * 核心作用：渲染单条聊天消息（Hermes 头像 + 气泡 + 状态指示器 +
 *           思考过程块 + 时间戳），从 ChatView 拆出，便于测试和复用
 * 运行流程：
 *   1. 接收消息数据 + 流式状态 + 推理阶段
 *   2. 根据 msg.role（user / hermes）渲染不同气泡
 *   3. 流式消息展示状态指示器（thinking / answering / done）
 *   4. 展示 ThinkingBlock 思考过程（可折叠）
 *   5. 错误消息渲染错误气泡
 * 输入参数：见 MessageRowProps
 * 输出结果：单条消息 DOM
 * 复用说明：
 *   - 从 ChatView.tsx v1.0.0 抽离（2026-07-27 P0-5）
 *   - 行为完全保持不变，纯组件化拆分
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | P0-5 ChatView 组件独立 - MessageRow 抽离到独立文件
 * #   - 2026-07-29 | v1.0.1 | P1-4 接入 MarkdownContent
 * #     - 消息正文由纯文本替换为 MarkdownContent
 * #     - 代码块自动 shiki 高亮
 * # ============================================================
 */

import React, { memo } from 'react';
import MessageBubble from '../MessageBubble';
import ThinkingBlock from '../ThinkingBlock';
import MarkdownContent from '../MarkdownContent';
import type { ReasoningStage } from '../ThinkingBlock';
import type { StreamingStatus } from '../ChatMainArea';
import type { ChatMessage } from '../../utils/messageFormatters';

export interface MessageRowProps {
  msg: ChatMessage;
  lastMessageIdRef: React.MutableRefObject<string | null>;
  streamingMessageId: string | null;
  streamingStatus: StreamingStatus;
  thinkingContent: string;
  /** v4.2.0 新增：分阶段推理状态 + 用户干预（P1-2 / P1-4 补齐） */
  reasoningStage?: ReasoningStage;
  stageProgress?: number;
  onIntervene?: () => void;
  /** compact 模式：紧凑气泡宽度 */
  compact?: boolean;
}

const MessageRow: React.FC<MessageRowProps> = memo(({
  msg,
  lastMessageIdRef,
  streamingMessageId,
  streamingStatus,
  thinkingContent,
  reasoningStage = 'idle',
  stageProgress = 0,
  onIntervene,
  compact = false,
}) => {
  if (msg.error) {
    return (
      <div className="animate-msg-enter">
        <MessageBubble role="assistant" content="" error={msg.error} />
      </div>
    );
  }

  // compact 模式：更紧凑的内边距
  const bubbleMaxWidth = compact ? 'max-w-[95%]' : 'max-w-[85%] md:max-w-[75%]';
  const bubblePadding = compact ? 'px-3 py-2' : 'px-4 py-3';
  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div
      className={`flex animate-msg-enter ${
        msg.id === lastMessageIdRef.current ? 'msg-breath' : ''
      } ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      {msg.role === 'hermes' && (
        <div className={`${compact ? 'w-6 h-6 mr-2' : 'w-8 h-8 mr-3'} rounded-lg bg-gradient-to-br from-hermes-500 to-hermes-600 flex items-center justify-center flex-shrink-0 mt-1 shadow-md shadow-hermes-900/20`}>
          <svg
            className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-white`}
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
      )}
      <div
        className={`${bubbleMaxWidth} ${bubblePadding} ${textSize} leading-relaxed rounded-2xl ${
          msg.role === 'user'
            ? 'bg-hermes-500 text-white rounded-br-md'
            : 'bg-surface-200 text-surface-900 rounded-bl-md border border-surface-400/50'
        }`}
      >
        {/* 状态指示器（仅流式消息） */}
        {msg.role === 'hermes' && msg.id === streamingMessageId && streamingStatus && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-surface-400/30">
            {streamingStatus === 'thinking' && (
              <>
                <svg
                  className="animate-spin w-3.5 h-3.5 text-hermes-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-xs text-hermes-400 font-medium">思考中...</span>
              </>
            )}
            {streamingStatus === 'answering' && (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-hermes-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-hermes-500" />
                </span>
                <span className="text-xs text-hermes-400 font-medium">回答中...</span>
              </>
            )}
            {streamingStatus === 'done' && (
              <>
                <svg
                  className="w-3.5 h-3.5 text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-xs text-emerald-400 font-medium">回答完成</span>
              </>
            )}
          </div>
        )}

        {/* 思考过程折叠块 */}
        {(msg.id === streamingMessageId || msg.thinking) && (
          <ThinkingBlock
            content={msg.id === streamingMessageId ? thinkingContent : msg.thinking || ''}
            isStreaming={
              msg.id === streamingMessageId && streamingStatus === 'thinking'
            }
            stage={reasoningStage}
            stageProgress={stageProgress}
            onIntervene={onIntervene}
          />
        )}

        {/* 消息正文 */}
        {msg.content && (
          <div className="break-words">
            <MarkdownContent
              content={msg.content}
              theme="dark"
              streamingBatchSize={
                msg.id === streamingMessageId && streamingStatus === 'answering' ? 30 : 0
              }
              streamingBatchIntervalMs={
                msg.id === streamingMessageId && streamingStatus === 'answering' ? 80 : 0
              }
            />
            {msg.role === 'hermes' &&
              msg.id === streamingMessageId &&
              streamingStatus === 'answering' && (
                <span className="inline-block w-0.5 h-4 bg-hermes-400 ml-0.5 align-text-bottom animate-pulse" />
              )}
          </div>
        )}

        {/* 空内容占位 */}
        {!msg.content &&
          msg.role === 'hermes' &&
          msg.id === streamingMessageId &&
          streamingStatus === 'thinking' && (
            <div className="text-surface-500 italic text-xs">等待回复中...</div>
          )}

        <div
          className={`text-xs mt-1.5 ${
            msg.role === 'user' ? 'text-hermes-200' : 'text-surface-600'
          }`}
        >
          {new Date(msg.timestamp).toLocaleTimeString()}
        </div>
      </div>
      {msg.role === 'user' && (
        <div className={`${compact ? 'w-6 h-6 ml-2' : 'w-8 h-8 ml-3'} rounded-full bg-surface-400 flex items-center justify-center flex-shrink-0 mt-1`}>
          <svg
            className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-surface-800`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </div>
  );
});

MessageRow.displayName = 'MessageRow';

export default MessageRow;
