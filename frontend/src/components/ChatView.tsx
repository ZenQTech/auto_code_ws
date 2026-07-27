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
 * #   - 2026-07-27 | v1.1.0 | P0-5 MessageRow 抽离 - 移至 ./chat/MessageRow.tsx
 * # ============================================================
 */

import React, { memo } from 'react';
import MessageRow from './chat/MessageRow';
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
import type { ReasoningStage } from './ThinkingBlock';

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

// MessageRow 已抽离到独立文件 ./chat/MessageRow.tsx（P0-5 v1.0.0）
// 这里保留 export 方便向后兼容
export { default as MessageRow } from './chat/MessageRow';

export default ChatView;
