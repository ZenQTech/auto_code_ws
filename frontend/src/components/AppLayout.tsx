/**
 * # ============================================================
 * AppLayout - 主对话舞台布局组件
 * # ============================================================
 * 核心作用：从 App.tsx 抽离主对话舞台布局
 * 包含：
 *   1. BrandHeader（豆包风格极简顶栏）
 *   2. Codex 风格工具栏（ModelSelector + ReasoningIntensitySelector + 斜杠命令提示 + 文件路径）
 *   3. ChatView（消息流 + 浮动输入区 + 流式状态指示器）
 *   4. 编程模式垂直分屏（CodeViewer 上 + 紧凑聊天区下）
 *   5. 子 CLI 实例状态网格（AgentChatCard）
 *   6. Loop Engineering 状态展示（ReviewReport + PipelineProgress + GoalProgress）
 *   7. 模态弹窗（ClarificationModal + ArchitectureDesignModal）
 *   8. 底部固定输入区（玻璃拟态）
 * 抽取日期：2026-07-27
 * 模块版本：v6.12.0 - P0-2 App.tsx 拆分第六阶段
 * 修改记录：
 *   - 2026-07-27 | v6.10.0 | 从 App.tsx 抽离主对话舞台布局（BrandHeader+Toolbar+
 *     ChatMainArea+Modals+CodeViewer+AgentGrid+固定输入区）
 *   - 2026-07-27 | v6.10.1 | Phase 5 UI/UX 优化：工具栏增加渐变背景 + 分割线 +
 *     斜杠命令 kbd 边框 + 文件路径 badge 样式
 *   - 2026-07-27 | v6.11.0 | P2-1 补齐 SubAgent workspace 前端展示：
 *     在 AgentChatCard 网格上方插入 SubAgentWorkspacePanel，
 *     展示各 SubAgent 的分支名/模块名/进度/文件数/提交数
 *   - 2026-07-27 | v6.12.0 | P0-2 拆分第六阶段：内联消息渲染 + MessageRow 抽离到 ChatView 组件
 * ============================================================
 */

import React from 'react';
import BrandHeader from './BrandHeader';
import CodeViewer from './CodeViewer';
import AgentChatCard from './AgentChatCard';
/** v4.3.0 P2-1 新增：SubAgent workspace 前端展示面板 */
import SubAgentWorkspacePanel from './SubAgentWorkspacePanel';
/** v4.4.0 P0-2 新增：聊天视图组件（从本文件抽离） */
import ChatView from './ChatView';
import ModelSelector from './ModelSelector';
import ReasoningIntensitySelector from './ReasoningIntensitySelector';
import type { StreamingStatus } from './ChatMainArea';
import type { ReasoningStage } from './ThinkingBlock';
import type { Agent, ReviewData, PipelineData, GoalData } from '../types';
import type { ChatMessage } from '../utils/messageFormatters';

export type AppMode = 'chat' | 'coding';

export interface ClarificationModalData {
  summary: string;
  questions: Array<{ dimension: string; question: string; importance: string; options?: string[]; allowMultiple?: boolean }>;
  roundNumber: number;
  maxRounds: number;
  isComplete: boolean;
}

export interface DesignModalData {
  requirementV2: string;
  critiqueResult: any;
  iterationCount: number;
  maxIterations: number;
}

export interface AppLayoutProps {
  // 模式与项目
  appMode: AppMode;
  selectedProject: string | null;
  openedFile: string | null;
  setOpenedFile: (file: string | null) => void;
  currentSessionTitle: string;

  // 顶部回调
  onNewChat: () => void;
  newChatLoading: boolean;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
  onOpenFileExplorer: () => void;
  fileExplorerOpen: boolean;
  onOpenLoopV7: () => void;
  /** v6.14.0 Cycle 2 新增：打开 MCP 工具面板 */
  onOpenMCP: () => void;
  /** v6.14.0 Cycle 2 新增：打开会话压缩面板 */
  onOpenCompaction: () => void;
  /** v6.14.0 Cycle 2 新增：打开技能管理面板 */
  onOpenSkills: () => void;
  /** v6.14.0 Cycle 2 新增：打开 AGENTS.md 记忆面板 */
  onOpenAgentsMd: () => void;
  /** Cycle 3 v1.0.0 新增：打开 Cycle 3 MCP 高级功能面板 */
  onOpenCycle3: () => void;
  /** Cycle 3 v1.0.0 新增：打开双触发压缩面板 */
  onOpenDualCompaction: () => void;
  /** Cycle 3 v1.0.0 新增：打开多类型规则扫描面板 */
  onOpenRules: () => void;
  /** v6.13.0 (Cycle 4 P0-3) 新增：打开 Plan 编辑器面板 */
  onOpenPlanEditor: () => void;

  // 工具栏
  onModelChange: (id: string) => void;
  onReasoningIntensityChange: (intensity: string) => void;

  // 工作流状态
  workflowStatusCurrentStage: string | null;
  clarificationData: ClarificationModalData | null;
  showClarifyModal: boolean;
  reviewData: ReviewData | null;
  pipelineData: PipelineData | null;
  goalData: GoalData | null;

  // 消息 + 流式
  messages: ChatMessage[];
  detailLoading: boolean;
  streamingStatus: StreamingStatus;
  streamingMessageId: string | null;
  thinkingContent: string;
  isSending: boolean;
  // v4.2.0 新增：分阶段推理状态（P1-4 补齐）
  reasoningStage?: ReasoningStage;
  stageProgress?: number;
  // v4.2.0 新增：用户干预回调（P1-2 补齐）
  onIntervene?: () => void;

  // 输入区
  inputValue: string;
  setInputValue: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  lastMessageIdRef: React.MutableRefObject<string | null>;

  // Clarification Modal 回调
  onSubmitClarification: (answersText: string) => void;
  onConfirmClarification: (wfId?: string) => void;
  onContinueAddClarification: () => void;
  workflowIdRef: React.MutableRefObject<string | null | undefined>;
  sessionDetailWorkflowId: string | null | undefined;
  workflowStatusWorkflowId: string | null | undefined;

  // Architecture Design Modal
  showDesignModal: boolean;
  designModalData: DesignModalData | null;
  isDesignLoading: boolean;
  onConfirmDesign: () => void;
  onRejectDesign: (reason: string) => void | Promise<void>;

  // Agents
  displayAgents: Agent[];
  agentsLoading: boolean;
  expandedAgentId: string | null;
  onToggleAgentExpand: (id: string) => void;
  onAgentChanged: () => void;

  // onWelcomePrompt 选择（启动欢迎页）
  onSelectWelcomePrompt: (prompt: string) => void;
}

/**
 * AppLayout - 主对话舞台布局
 * - 聊天模式：BrandHeader + 工具栏 + ChatMainArea + 弹窗 + Agent网格 + 固定输入区
 * - 编程模式（带打开文件）：CodeViewer 上半 + 紧凑聊天下半
 * - 编程模式（无打开文件）：ProjectSelector 在外层处理
 */
export const AppLayout: React.FC<AppLayoutProps> = ({
  appMode,
  selectedProject,
  openedFile,
  setOpenedFile,
  currentSessionTitle,
  onNewChat,
  newChatLoading,
  onOpenSettings,
  onOpenUsage,
  onOpenFileExplorer,
  fileExplorerOpen,
  onOpenLoopV7,
  onOpenMCP,
  onOpenCompaction,
  onOpenSkills,
  onOpenAgentsMd,
  onOpenCycle3,
  onOpenDualCompaction,
  onOpenRules,
  onOpenPlanEditor,
  onModelChange,
  onReasoningIntensityChange,
  workflowStatusCurrentStage,
  clarificationData,
  showClarifyModal,
  reviewData,
  pipelineData,
  goalData,
  messages,
  detailLoading,
  streamingStatus,
  streamingMessageId,
  thinkingContent,
  isSending,
  // v4.2.0 新增：分阶段推理 + 用户干预（P1-2 / P1-4 补齐）
  reasoningStage = 'idle',
  stageProgress = 0,
  onIntervene,
  inputValue,
  setInputValue,
  onSend,
  onStop,
  onKeyDown,
  inputRef,
  messagesEndRef,
  lastMessageIdRef,
  onSubmitClarification,
  onConfirmClarification,
  onContinueAddClarification,
  workflowIdRef,
  sessionDetailWorkflowId,
  workflowStatusWorkflowId,
  showDesignModal,
  designModalData,
  isDesignLoading,
  onConfirmDesign,
  onRejectDesign,
  displayAgents,
  agentsLoading,
  expandedAgentId,
  onToggleAgentExpand,
  onAgentChanged,
  onSelectWelcomePrompt,
}) => {
  // 编程模式 + 文件打开 → 垂直分屏布局
  if (appMode === 'coding' && selectedProject && openedFile) {
    return (
      <div className="flex-1 flex flex-col min-w-0">
        {/* CodeViewer 上半部分 */}
        <div
          className="flex-1 min-h-0 border-b border-surface-300 overflow-hidden"
          style={{ flexBasis: '50%' }}
        >
          <CodeViewer
            project={selectedProject}
            filePath={openedFile}
            onClose={() => setOpenedFile(null)}
          />
        </div>
        {/* 紧凑聊天区 下半部分 */}
        <div
          className="flex flex-col bg-surface-100"
          style={{ flexBasis: '50%', minHeight: 0 }}
        >
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-surface-300/30">
            <span className="text-xs font-medium text-surface-600">💬 对话</span>
            <span className="text-xs text-surface-500 truncate ml-2">
              项目：{selectedProject}
            </span>
          </div>
          {/* 紧凑消息区 - v6.12.0 P0-2: 抽离到 ChatView 组件 */}
          <ChatView
            mode="compact"
            messages={messages}
            detailLoading={detailLoading}
            streamingStatus={streamingStatus}
            streamingMessageId={streamingMessageId}
            thinkingContent={thinkingContent}
            isSending={isSending}
            workflowStatusCurrentStage={workflowStatusCurrentStage}
            clarificationData={clarificationData}
            reviewData={reviewData}
            pipelineData={pipelineData}
            goalData={goalData}
            reasoningStage={reasoningStage}
            stageProgress={stageProgress}
            onIntervene={onIntervene}
            showClarifyModal={showClarifyModal}
            showDesignModal={showDesignModal}
            designModalData={designModalData}
            isDesignLoading={isDesignLoading}
            workflowId={workflowIdRef.current || sessionDetailWorkflowId || workflowStatusWorkflowId || undefined}
            onSubmitClarification={onSubmitClarification}
            onConfirmClarification={onConfirmClarification}
            onContinueAddClarification={onContinueAddClarification}
            onConfirmDesign={onConfirmDesign}
            onRejectDesign={onRejectDesign}
            onSelectWelcomePrompt={onSelectWelcomePrompt}
            messagesEndRef={messagesEndRef}
            lastMessageIdRef={lastMessageIdRef}
          />
          {/* 紧凑输入区 */}
          <div className="flex-shrink-0 px-3 pb-2 pt-1 border-t border-surface-300/30">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="输入消息..."
                disabled={isSending}
                rows={1}
                className="flex-1 resize-none bg-surface-200 border border-surface-400/50 rounded-xl px-3 py-1.5 text-sm text-surface-800 placeholder:text-surface-500 outline-none focus:border-hermes-500 focus:shadow-glow-hermes-sm max-h-24 min-h-[28px] disabled:opacity-60 leading-5 transition-all duration-default ease-material"
              />
              <button
                onClick={isSending ? onStop : onSend}
                disabled={!inputValue.trim() && !isSending}
                className="w-8 h-8 rounded-full bg-gradient-to-br from-hermes-500 to-hermes-600 hover:from-hermes-600 hover:to-hermes-700 disabled:from-surface-300 disabled:to-surface-300 text-white flex items-center justify-center flex-shrink-0 shadow-level-1 transition-all duration-default ease-material active:scale-[0.97]"
                aria-label={isSending ? '停止' : '发送'}
              >
                {isSending ? (
                  <svg className="w-3 h-3" fill="white" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  >
                    <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 默认布局：聊天模式 / 编程模式无打开文件
  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* BrandHeader（豆包风格） */}
      <BrandHeader
        sessionTitle={currentSessionTitle}
        onNewChat={onNewChat}
        newChatLoading={newChatLoading}
        onOpenSettings={onOpenSettings}
        onOpenUsage={onOpenUsage}
        onOpenFileExplorer={onOpenFileExplorer}
        fileExplorerOpen={fileExplorerOpen}
        onOpenLoopV7={onOpenLoopV7}
        onOpenMCP={onOpenMCP}
        onOpenCompaction={onOpenCompaction}
        onOpenSkills={onOpenSkills}
        onOpenAgentsMd={onOpenAgentsMd}
        onOpenCycle3={onOpenCycle3}
        onOpenDualCompaction={onOpenDualCompaction}
        onOpenRules={onOpenRules}
        onOpenPlanEditor={onOpenPlanEditor}
      />

      {/* Codex 风格工具栏（v6.10.1 P5 视觉优化：增加分割线 + 渐变背景） */}
      <div className="relative px-3 md:px-4 py-2.5 bg-gradient-to-b from-surface-50/60 to-surface-50/20 border-b border-surface-200/60 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 flex-wrap">
            <ModelSelector onChange={onModelChange} />
            <span className="hidden sm:inline-block w-px h-4 bg-surface-300/60" />
            <ReasoningIntensitySelector onChange={onReasoningIntensityChange} />
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-surface-500 hidden sm:flex">
            <span className="text-surface-400">斜杠命令：</span>
            <kbd className="px-1.5 py-0.5 rounded bg-surface-200/70 text-surface-700 font-mono border border-surface-300/40">/review</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-surface-200/70 text-surface-700 font-mono border border-surface-300/40">/fix</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-surface-200/70 text-surface-700 font-mono border border-surface-300/40">/review-fix-loop</kbd>
            {openedFile && (
              <span
                className="ml-2 px-2 py-0.5 rounded-md bg-hermes-500/10 text-hermes-400 border border-hermes-400/20 truncate max-w-[200px]"
                title={openedFile}
              >
                📄 {openedFile}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 主消息区 - v6.12.0 P0-2: 抽离到 ChatView 组件 */}
      <ChatView
        mode="normal"
        messages={messages}
        detailLoading={detailLoading}
        streamingStatus={streamingStatus}
        streamingMessageId={streamingMessageId}
        thinkingContent={thinkingContent}
        isSending={isSending}
        workflowStatusCurrentStage={workflowStatusCurrentStage}
        clarificationData={clarificationData}
        reviewData={reviewData}
        pipelineData={pipelineData}
        goalData={goalData}
        reasoningStage={reasoningStage}
        stageProgress={stageProgress}
        onIntervene={onIntervene}
        showClarifyModal={showClarifyModal}
        showDesignModal={showDesignModal}
        designModalData={designModalData}
        isDesignLoading={isDesignLoading}
        workflowId={workflowIdRef.current || sessionDetailWorkflowId || workflowStatusWorkflowId || undefined}
        onSubmitClarification={onSubmitClarification}
        onConfirmClarification={onConfirmClarification}
        onContinueAddClarification={onContinueAddClarification}
        onConfirmDesign={onConfirmDesign}
        onRejectDesign={onRejectDesign}
        onSelectWelcomePrompt={onSelectWelcomePrompt}
        messagesEndRef={messagesEndRef}
        lastMessageIdRef={lastMessageIdRef}
      />

      {/* v4.3.0 P2-1 新增：SubAgent workspace 状态面板（AgentChatCard 网格上方） */}
      {displayAgents.length > 0 && (
        <div className="border-t border-surface-300 bg-surface-50/40 px-3 md:px-4 py-3 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            <SubAgentWorkspacePanel
              agents={displayAgents}
              loading={agentsLoading}
              onRefresh={onAgentChanged}
            />
          </div>
        </div>
      )}

      {/* AgentChatCard 网格 */}
      {displayAgents.length > 0 && (
        <div className="border-t border-surface-300 bg-surface-100/50 px-3 md:px-4 py-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            <h3 className="text-xs font-medium text-surface-600 uppercase tracking-wider mb-3">
              子 CLI 实例状态 ({displayAgents.length})
            </h3>
            {agentsLoading ? (
              <div className="py-2">
                <div className="skeleton h-4 w-32" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {displayAgents.map((agent) => (
                  <AgentChatCard
                    key={agent.id}
                    agent={agent}
                    isExpanded={expandedAgentId === agent.id}
                    onToggleExpand={() => onToggleAgentExpand(agent.id)}
                    onAgentChanged={onAgentChanged}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 固定底部输入区（玻璃拟态） */}
      <div className="flex-shrink-0 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white/90 backdrop-blur-md border border-surface-200 rounded-3xl shadow-level-3 px-4 py-3 focus-within:shadow-glow-hermes focus-within:border-hermes-300 transition-all duration-default ease-material">
            <div className="flex items-end gap-3">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
                disabled={isSending}
                rows={1}
                className="flex-1 resize-none bg-transparent border-none outline-none text-base text-surface-900 placeholder:text-surface-400 max-h-32 min-h-[24px] disabled:opacity-60 leading-7"
              />
              <button
                onClick={isSending ? onStop : onSend}
                disabled={!inputValue.trim() && !isSending}
                className="w-10 h-10 rounded-full bg-gradient-to-br from-hermes-500 to-hermes-600 hover:from-hermes-600 hover:to-hermes-700 disabled:from-surface-300 disabled:to-surface-300 text-white flex items-center justify-center shadow-level-1 hover:shadow-level-2 transition-all duration-default ease-material active:scale-[0.97]"
                aria-label={isSending ? '停止生成' : '发送消息'}
                title={isSending ? '停止生成' : '发送消息'}
              >
                {isSending ? (
                  <svg className="w-4 h-4" fill="white" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  >
                    <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// MessageRow 已抽离到 ChatView 组件（v6.12.0 P0-2 拆分第六阶段）
// 如需修改消息渲染，请编辑 ./ChatView.tsx
// ============================================================

export default AppLayout;
