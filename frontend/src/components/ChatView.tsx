/**
 * # ============================================================
 * # ChatView - 聊天视图组件
 * # ============================================================
 * # 核心作用：从 AppLayout 抽离聊天消息流渲染逻辑
 * #           集中管理消息渲染 + 工作流状态展示 + 流式状态
 * # 运行流程：
 * #   1. 接收 messages / streamingStatus / workflow 状态
 * #   2. 渲染工作流状态指示（clarification / review / pipeline / goal）
 * #   3. 渲染消息流（WelcomeState + skeleton + messages + modals）
 * #   4. 通过 React.memo 优化重渲染
 * # 输入参数：见 ChatViewProps
 * # 输出结果：完整的聊天视图 DOM
 * # 复用说明：
 * #   - 替换 AppLayout 中的内联消息渲染块（v4.4.0 P0-2 拆分第六阶段）
 * #   - 支持两种模式：normal（max-w-3xl）和 compact（编程模式垂直分屏）
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | P0-2 App.tsx 拆分第六阶段 - 从 AppLayout 抽离 ChatView
 * # ============================================================
 */

import React, { memo } from 'react';
import MessageBubble from './MessageBubble';
import ThinkingBlock from './ThinkingBlock';
import type { ReasoningStage } from './ThinkingBlock';
import ClarificationProgress from './ClarificationProgress';
import ClarificationModal from './ClarificationModal';
import ArchitectureDesignModal from './ArchitectureDesignModal';
import ReviewReport from './ReviewReport';
import PipelineProgress from './PipelineProgress';
import GoalProgress from './GoalProgress';
import WelcomeState from './WelcomeState';
import type { StreamingStatus } from './ChatMainArea';
import type { ReviewData, PipelineData, GoalData } from '../types';
import type { ChatMessage } from '../utils/messageFormatters';

/** Clarification Modal 数据结构 */
export interface ClarificationModalData {
  summary: string;
  questions: Array<{ dimension: string; question: string; importance: string; options?: string[]; allowMultiple?: boolean }>;
  roundNumber: number;
  maxRounds: number;
  isComplete: boolean;
}

/** Architecture Design Modal 数据结构 */
export interface DesignModalData {
  requirementV2: string;
  critiqueResult: any;
  iterationCount: number;
  maxIterations: number;
}

/** ChatView 渲染模式 */
export type ChatViewMode = 'normal' | 'compact';

export interface ChatViewProps {
  // 渲染模式
  mode?: ChatViewMode;

  // 消息数据
  messages: ChatMessage[];
  detailLoading: boolean;
  streamingStatus: StreamingStatus;
  streamingMessageId: string | null;
  thinkingContent: string;
  isSending: boolean;

  // 工作流状态
  workflowStatusCurrentStage: string | null;
  clarificationData: ClarificationModalData | null;
  reviewData: ReviewData | null;
  pipelineData: PipelineData | null;
  goalData: GoalData | null;

  // v4.2.0 新增：分阶段推理 + 用户干预（P1-2 / P1-4 补齐）
  reasoningStage?: ReasoningStage;
  stageProgress?: number;
  onIntervene?: () => void;

  // Modals
  showClarifyModal: boolean;
  showDesignModal: boolean;
  designModalData: DesignModalData | null;
  isDesignLoading: boolean;
  workflowId?: string;

  // Callbacks
  onSubmitClarification: (answersText: string) => void;
  onConfirmClarification: (wfId?: string) => void;
  onContinueAddClarification: () => void;
  onConfirmDesign: () => void;
  onRejectDesign: (reason: string) => void | Promise<void>;
  onSelectWelcomePrompt: (prompt: string) => void;

  // Refs
  messagesEndRef: React.RefObject<HTMLDivElement>;
  lastMessageIdRef: React.MutableRefObject<string | null>;
}

/**
 * ChatView - 聊天视图组件
 * - normal 模式：max-w-3xl 居中，padding 宽松
 * - compact 模式：编程模式垂直分屏下半部分，紧凑布局
 */
export const ChatView: React.FC<ChatViewProps> = memo(({
  mode = 'normal',
  messages,
  detailLoading,
  streamingStatus,
  streamingMessageId,
  thinkingContent,
  isSending: _isSending,
  workflowStatusCurrentStage,
  clarificationData,
  reviewData,
  pipelineData,
  goalData,
  reasoningStage = 'idle',
  stageProgress = 0,
  onIntervene,
  showClarifyModal,
  showDesignModal,
  designModalData,
  isDesignLoading,
  workflowId,
  onSubmitClarification,
  onConfirmClarification,
  onContinueAddClarification,
  onConfirmDesign,
  onRejectDesign,
  onSelectWelcomePrompt,
  messagesEndRef,
  lastMessageIdRef,
}) => {
  const isCompact = mode === 'compact';
  const containerClass = isCompact
    ? 'flex-1 overflow-y-auto px-3 py-2'
    : 'flex-1 overflow-y-auto px-3 md:px-4 py-6';
  const innerClass = isCompact ? 'space-y-3' : 'max-w-3xl mx-auto space-y-4';
  const emptyClass = isCompact
    ? 'text-xs text-surface-500 text-center py-4'
    : 'text-sm text-surface-500 text-center py-4';
  const skeletonHeight = isCompact ? 'h-10' : 'h-16';
  const skeletonWidths = isCompact
    ? ['w-3/4', 'w-2/3', 'w-3/4']
    : ['w-3/4', 'w-2/3 ml-auto', 'w-4/5'];

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        {/* 工作流进度（clarification / review / pipeline / goal） */}
        {workflowStatusCurrentStage === 'clarifying' && (
          <ClarificationProgress
            roundNumber={clarificationData?.roundNumber || 1}
            maxRounds={clarificationData?.maxRounds || 5}
            isComplete={clarificationData?.isComplete || false}
          />
        )}
        {reviewData && <ReviewReport reviewData={reviewData} />}
        {pipelineData && <PipelineProgress pipelineData={pipelineData} />}
        {goalData && <GoalProgress goalData={goalData} />}

        {/* 空状态 - 欢迎页 */}
        {messages.length === 0 && !detailLoading && !isCompact && (
          <WelcomeState onSelectPrompt={onSelectWelcomePrompt} />
        )}

        {/* compact 模式下的空状态 */}
        {messages.length === 0 && !detailLoading && isCompact && (
          <div className={emptyClass}>输入消息开始对话</div>
        )}

        {/* Loading 骨架屏 */}
        {detailLoading && messages.length === 0 && (
          <div className="space-y-2">
            {skeletonWidths.map((w, i) => (
              <div key={i} className={`skeleton ${skeletonHeight} ${w} rounded-lg`} />
            ))}
          </div>
        )}

        {/* 消息流 */}
        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            lastMessageIdRef={lastMessageIdRef}
            streamingMessageId={streamingMessageId}
            streamingStatus={streamingStatus}
            thinkingContent={thinkingContent}
            reasoningStage={reasoningStage}
            stageProgress={stageProgress}
            onIntervene={onIntervene}
            compact={isCompact}
          />
        ))}

        {/* Clarification Modal */}
        {showClarifyModal && clarificationData && (
          <ClarificationModal
            key={clarificationData.roundNumber}
            summary={clarificationData.summary}
            questions={clarificationData.questions}
            roundNumber={clarificationData.roundNumber}
            maxRounds={clarificationData.maxRounds}
            isComplete={clarificationData.isComplete}
            workflowId={workflowId}
            onSubmit={onSubmitClarification}
            onConfirm={onConfirmClarification}
            onContinueAdd={onContinueAddClarification}
          />
        )}

        {/* Architecture Design Modal */}
        {showDesignModal && (
          <ArchitectureDesignModal
            requirementV2={designModalData?.requirementV2 || ''}
            critiqueResult={designModalData?.critiqueResult || null}
            isLoading={isDesignLoading}
            iterationCount={designModalData?.iterationCount || 1}
            maxIterations={designModalData?.maxIterations || 3}
            onConfirm={onConfirmDesign}
            onReject={onRejectDesign}
          />
        )}

        {/* 滚动锚点 */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
});

ChatView.displayName = 'ChatView';

// ============================================================
// MessageRow - 单条消息行（含 Hermes 头像 + 气泡 + 状态指示器）
// 抽离自 AppLayout，便于 ChatView 独立使用
// ============================================================

interface MessageRowProps {
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
          <div className="whitespace-pre-wrap break-words">
            {msg.content}
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

export default ChatView;
