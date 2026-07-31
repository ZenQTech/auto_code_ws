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
 *   - 2026-07-27 | v6.13.0 | Cycle 7 P0-10 新增 onOpenMultiAgentTree 回调 + 透传 BrandHeader
 *   - 2026-07-30 | v6.66.0 | Cycle 26 G26-01/02/03 新增 onOpenCsvBatch/onOpenSmartApproval/onOpenMTC 透传
 *   - 2026-07-30 | v6.71.0 | Cycle 27 G27-01/02/04/05/06 新增 onOpenNestedSubAgent/onOpenAgentCheckpoint/onOpenAgentMessaging/onOpenAgentTemplate/onOpenRemoteControl 透传
 *   - 2026-07-30 | v6.86.0 | Cycle 31 G31-01/02/03 新增 onOpenCostAttribution/onOpenRemoteWorktree/onOpenWorktreeSync 透传
 *   - 2026-07-31 | v6.99.0 | Cycle 36 G36-01/02/03 新增 onOpenLLMProvider/onOpenStreamingChat/onOpenMultiModal 透传
 *#   - 2026-07-31 | v7.00.0 | Cycle 37 G37-01/02/03/04 新增 onOpenRAG/onOpenToolMarketplace/onOpenAgentLoop/onOpenRealLLMProvider 透传
#*#   - 2026-07-31 | v7.01.0 | Cycle 38 G38-01/02/03/04 新增 onOpenMultiAgentCrew/onOpenLongTermMemory/onOpenReflection/onOpenHumanApproval 透传
 *   - 2026-07-31 | v6.115.0 | Cycle 42 G42-04 新增 onOpenMcpIntegrated 透传（MCP 集成智能体面板）
 *   - 2026-08-01 | v6.118.0 | Cycle 44 G44-04 新增 onOpenMcpMultimodal 透传（MCP 多模态智能体面板）
 *   - 2026-08-01 | v6.122.0 | Cycle 48 G48-主应用集成 新增 onOpenMcpMultimodalRag 透传（MCP × 多模态 RAG 面板）
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
/** v6.23.0 (Cycle 8 P0-12) 新增：Slash Commands 选择器 */
import SlashCommandPicker from './SlashCommandPicker';
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
  /** v6.17.0 (Cycle 9 P1-7) 新增：跳转 DiffView 增强页（独立路由 /diff-view） */
  onOpenDiffView: () => void;
  /** v6.18.0 (Cycle 10 P1-8) 新增：跳转 Memory System 页面（独立路由 /memory） */
  onOpenMemory: () => void;
  /** v1.0.0 (Cycle 10 P1-10) 新增：跳转 Verification Loop 页面（独立路由 /verification） */
  onOpenVerification: () => void;
  /** v1.0.0 (Cycle 11 P2-2) 新增：跳转 Doctor 环境诊断页面（独立路由 /doctor） */
  onOpenDoctor: () => void;
  /** v1.0.0 (Cycle 13 P1-2) 新增：跳转 LLM-as-Judge 页面（独立路由 /llm-judge） */
  onOpenLlmJudge: () => void;
  /** v1.0.0 (Cycle 13 P1-3) 新增：跳转 Plugin Marketplace 页面（独立路由 /marketplace） */
  onOpenMarketplace: () => void;
  /** v1.0.0 (Cycle 14 P0-2) 新增：跳转多模态支持页面（独立路由 /multimodal） */
  onOpenMultimodal: () => void;
  /** v1.0.0 (Cycle 14 P0-3) 新增：跳转企业级 Plugin Hub 页面（独立路由 /enterprise-hub） */
  onOpenEnterpriseHub: () => void;
  /** v1.0.0 (Cycle 14 P1-3) 新增：跳转 TRAE Work 多模态协作页面（独立路由 /work） */
  onOpenTraeWork: () => void;
  /** v1.0.0 (Cycle 14 P1-4) 新增：跳转 Goal Automation 页面（独立路由 /goal-automation） */
  onOpenGoalAutomation: () => void;
  /** v1.0.0 (Cycle 14 P1-5) 新增：跳转 Goal Templates 模板库页面（独立路由 /goal-templates） */
  onOpenGoalTemplates: () => void;
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
  /** v6.14.0 (Cycle 4 P0-4) 新增：打开 Hooks 事件系统面板 */
  onOpenHooks: () => void;
  /** v6.15.0 (Cycle 4 P0-4) 新增：打开 SubAgent 记忆查看器面板 */
  onOpenSubagentMemory: () => void;
  /** v6.16.0 (Cycle 5 P0-6) 新增：打开 Hook 触发链路查看器面板 */
  onOpenHookChain: () => void;
  /** v6.17.0 (Cycle 6 P0-7-A) 新增：打开 LLM 缓存统计面板 */
  onOpenCacheStats: () => void;
  /** v6.18.0 (Cycle 6 P0-7-B) 新增：打开流式恢复网关面板 */
  onOpenStreamList: () => void;
  /** v6.19.0 (Cycle 7 P0-8) 新增：打开 OAuth 2.1 + PKCE 配置面板 */
  onOpenOAuthConfig: () => void;
  /** v6.20.0 (Cycle 7 P0-9) 新增：打开 Session Rollout JSONL 持久化面板 */
  onOpenSessionRollout: () => void;
  /** v6.21.0 (Cycle 7 P0-10) 新增：打开 Multi-Agent v2 Path Tree 面板 */
  onOpenMultiAgentTree: () => void;
  /** v6.22.0 (Cycle 7 P0-11) 新增：打开 TRACE 规则管理面板 */
  onOpenTraceRule: () => void;
  /** v6.23.0 (Cycle 8 P0-12) 新增：打开 Slash Commands 帮助面板 */
  onOpenSlashCommand: () => void;
  /** v6.24.0 (Cycle 8 P0-14) 新增：Custom Models 管理面板回调 */
  onOpenCustomModels: () => void;
  /** v6.111.0 (Cycle 39 G39-03) 新增：MCP 服务器注册表面板回调 */
  onOpenMcpRegistry: () => void;
  /** v6.114.0 (Cycle 41) 新增：MCP 高级能力面板回调 */
  onOpenMcpAdvanced: () => void;
  /** v6.115.0 (Cycle 42 G42-04) 新增：MCP 集成智能体面板回调（端到端 LLM+Agent+MCP 融合） */
  onOpenMcpIntegrated: () => void;
  /** v6.117.0 (Cycle 43 G43-04) 新增：MCP E2E 测试面板回调（端到端测试套件） */
  onOpenMcpE2E: () => void;
  /** v6.118.0 (Cycle 44 G44-04) 新增：MCP 多模态智能体面板回调 */
  onOpenMcpMultimodal: () => void;
  /** v6.119.0 (Cycle 45 G45-04) 新增：MCP × RAG 智能体面板回调 */
  onOpenMcpRag: () => void;
  /** v6.120.0 (Cycle 46) 新增：MCP × RAG × 真实 LLM 端到端面板回调 */
  onOpenMcpRagRealLLM: () => void;
  /** v6.121.0 (Cycle 47 G47-主应用集成) 新增：MCP × RAG 性能优化面板回调 */
  onOpenMcpRagPerformance: () => void;
  /** v6.122.0 (Cycle 48 G48-主应用集成) 新增：MCP × 多模态 RAG 面板回调 */
  onOpenMcpMultimodalRag: () => void;
  /** v6.123.0 (Cycle 49 G49-主应用集成) 新增：MCP × 真实多模态 Provider 面板回调 */
  onOpenMcpMultimodalProvider: () => void;
  /** v6.124.0 (Cycle 50 G50-主应用集成) 新增：MCP × 真实 E2E 生产面板回调 */
  onOpenMcpE2EProduction: () => void;
  /** v6.36.0 (Cycle 16 P0-1) 新增：Composer 多文件编辑面板回调 */
  onOpenComposer: () => void;
  /** v6.41.0 (Cycle 19 P0-1) 新增：后台任务面板回调 */
  onOpenBackgroundTasks: () => void;
  /** v6.42.0 (Cycle 19 P0-2) 新增：Best-of-N 多模型对比面板回调 */
  onOpenBestOfN: () => void;
  /** v6.43.0 (Cycle 19 P0-3) 新增：Design Mode 设计模式覆盖层回调 */
  onOpenDesignMode: () => void;
  /** v6.45.0 (Cycle 20 P0-1) 新增：Worktree 隔离管理面板回调 */
  onOpenWorktree: () => void;
  /** v6.46.0 (Cycle 20 P0-2) 新增：模型路由面板回调 */
  onOpenModelRouter: () => void;
  /** v6.47.0 (Cycle 20 P0-3) 新增：事件钩子面板回调 */
  onOpenHooks20: () => void;
  /** v6.48.0 (Cycle 21 P0-1) 新增：Best-of-N × Worktree 协同面板回调 */
  onOpenBestOfNCoordinator: () => void;
  /** v6.49.0 (Cycle 21 P0-2) 新增：模型路由成本统计 Dashboard 回调 */
  onOpenModelRouterStats: () => void;
  /** v6.50.0 (Cycle 21 P0-4) 新增：Hook 模板市场面板回调 */
  onOpenHooksMarketplace: () => void;
  /** v6.51.0 (Cycle 22 G22-01) 新增：Side Chat 多子对话面板回调 */
  onOpenSideChat: () => void;
  /** v6.52.0 (Cycle 22 G22-02) 新增：成本预测面板回调 */
  onOpenCostPrediction: () => void;
  /** v6.53.0 (Cycle 22 G22-03) 新增：Hook 性能分析面板回调 */
  onOpenHookPerformance: () => void;
  /** v6.54.0 (Cycle 22 G22-04) 新增：模型路由管理面板回调 */
  onOpenModelRouterAdmin: () => void;
  /** v6.55.0 (Cycle 23 G23-01) 新增：候选学习面板回调 */
  onOpenCandidateLearning: () => void;
  /** v6.56.0 (Cycle 23 G23-02) 新增：会话回放面板回调 */
  onOpenSessionReplay: () => void;
  /** v6.57.0 (Cycle 23 G23-04) 新增：AI 主动建议面板回调 */
  onOpenProactiveSuggestion: () => void;
  onOpenGlobalMemory?: () => void;
  onOpenMultiTask?: () => void;
  /** v6.60.0 (Cycle 24 G24-04) 新增：Figma 设计稿转代码面板回调 */
  onOpenFigmaImport?: () => void;
  /** v6.61.0 (Cycle 25 G25-01) 新增：自动化代码评审面板回调 */
  onOpenAutoCodeReview?: () => void;
  /** v6.62.0 (Cycle 25 G25-02) 新增：PR 自动机器人面板回调 */
  onOpenPRBot?: () => void;
  /** v6.63.0 (Cycle 25 G25-03) 新增：AI 性能优化器面板回调 */
  onOpenPerfOptimizer?: () => void;
  /** v6.64.0 (Cycle 26 G26-01) 新增：CSV 批处理面板回调 */
  onOpenCsvBatch?: () => void;
  /** v6.65.0 (Cycle 26 G26-02) 新增：智能审批面板回调 */
  onOpenSmartApproval?: () => void;
  /** v6.66.0 (Cycle 26 G26-03) 新增：MTC 多模任务面板回调 */
  onOpenMTC?: () => void;
  /** v6.67.0 (Cycle 27 G27-01) 新增：嵌套子代理面板回调 */
  onOpenNestedSubAgent?: () => void;
  /** v6.68.0 (Cycle 27 G27-02) 新增：代理检查点面板回调 */
  onOpenAgentCheckpoint?: () => void;
  /** v6.69.0 (Cycle 27 G27-04) 新增：代理消息面板回调 */
  onOpenAgentMessaging?: () => void;
  /** v6.70.0 (Cycle 27 G27-05) 新增：代理模板面板回调 */
  onOpenAgentTemplate?: () => void;
  /** v6.71.0 (Cycle 27 G27-06) 新增：远程控制面板回调 */
  onOpenRemoteControl?: () => void;
  /** v6.72.0 (Cycle 28 G28-01) 新增：技能系统 */
  onOpenSkillSystem?: () => void;
  /** v6.73.0 (Cycle 28 G28-02) 新增：成本预算 */
  onOpenCostBudget?: () => void;
  /** v6.74.0 (Cycle 28 G28-03) 新增：用量归因 */
  onOpenUsageAttribution?: () => void;
  /** v6.75.0 (Cycle 28 G28-04) 新增：作用域权限 */
  onOpenScopedPermissions?: () => void;
  /** v6.76.0 (Cycle 28 G28-05) 新增：斜杠命令面板 */
  onOpenCommandPalette?: () => void;
  /** v6.77.0 (Cycle 29 G29-01) 新增：堆叠技能 */
  onOpenStackedSkills?: () => void;
  /** v6.78.0 (Cycle 29 G29-02) 新增：技能市场面板（区别于 Cycle 13 onOpenMarketplace 路由） */
  onOpenSkillsMarket?: () => void;
  /** v6.79.0 (Cycle 29 G29-03) 新增：分析聊天 */
  onOpenAnalyticsChat?: () => void;
  /** v6.83.0 (Cycle 30 G30-01) 新增：成本阈值告警 */
  onOpenCostThreshold?: () => void;
  /** v6.84.0 (Cycle 30 G30-02) 新增：动态工作流 */
  onOpenDynamicWorkflow?: () => void;
  /** v6.85.0 (Cycle 30 G30-03) 新增：编排多代理 */
  onOpenOrchestratedAgent?: () => void;
  /** v6.86.0 (Cycle 31 G31-01) 新增：成本归因 */
  onOpenCostAttribution?: () => void;
  /** v6.87.0 (Cycle 31 G31-02) 新增：远程 Worktree */
  onOpenRemoteWorktree?: () => void;
  /** v6.88.0 (Cycle 31 G31-03) 新增：Worktree 状态同步 */
  onOpenWorktreeSync?: () => void;
  /** v6.89.0 (Cycle 32 G32-01) 新增：审计追踪 */
  onOpenAuditTrail?: () => void;
  /** v6.90.0 (Cycle 32 G32-02) 新增：单点登录 */
  onOpenSSO?: () => void;
  /** v6.91.0 (Cycle 32 G32-03) 新增：策略规则 */
  onOpenPolicy?: () => void;
  /** v6.94.0 (Cycle 33 G33-01) 新增：企业全场景工作流 */
  onOpenEnterpriseWorkflow?: () => void;
  /** v6.94.0 (Cycle 33 G33-02) 新增：集成 Dashboard */
  onOpenUnifiedDashboard?: () => void;
  /** v6.94.0 (Cycle 33 G33-03) 新增：安全审计 */
  onOpenSecurityAudit?: () => void;
  /** v6.97.0 (Cycle 34 G34-01) 新增：端云模型路由 */
  onOpenEdgeModelRouter?: () => void;
  /** v6.97.0 (Cycle 34 G34-02) 新增：离线优先工作流 */
  onOpenOfflineFirst?: () => void;
  /** v6.97.0 (Cycle 34 G34-03) 新增：设备集群管理 */
  onOpenDeviceCluster?: () => void;
  /** v6.98.0 (Cycle 35 G35-01) 新增：工作流编排 */
  onOpenWorkflowOrchestrator?: () => void;
  /** v6.98.0 (Cycle 35 G35-02) 新增：智能体通信 */
  onOpenAgentCommunication?: () => void;
  /** v6.98.0 (Cycle 35 G35-03) 新增：任务检查点 */
  onOpenTaskCheckpoint?: () => void;
  /** v6.98.0 (Cycle 35 G35-04) 新增：智能体调度 */
  onOpenAgentScheduler?: () => void;
  /** v6.99.0 (Cycle 36 G36-01) 新增：LLM Provider 管理 */
  onOpenLLMProvider?: () => void;
  /** v6.99.0 (Cycle 36 G36-02) 新增：流式对话演示 */
  onOpenStreamingChat?: () => void;
  /** v6.99.0 (Cycle 36 G36-03) 新增：多模态处理 */
  onOpenMultiModal?: () => void;
  /** v7.00.0 (Cycle 37 G37-01) 新增：RAG 知识库 */
  onOpenRAG?: () => void;
  /** v7.00.0 (Cycle 37 G37-02) 新增：Tool Use 工具市场 */
  onOpenToolMarketplace?: () => void;
  /** v7.00.0 (Cycle 37 G37-03) 新增：Agent Loop 智能体循环 */
  onOpenAgentLoop?: () => void;
  /** v7.00.0 (Cycle 37 G37-04) 新增：真实 LLM Provider 配置 */
  onOpenRealLLMProvider?: () => void;
  /** v7.01.0 (Cycle 38 G38-01) 新增：多 Agent 协作 */
  onOpenMultiAgentCrew?: () => void;
  /** v7.01.0 (Cycle 38 G38-02) 新增：长期记忆管理 */
  onOpenLongTermMemory?: () => void;
  /** v7.01.0 (Cycle 38 G38-03) 新增：反思与自我修正 */
  onOpenReflection?: () => void;
  /** v7.01.0 (Cycle 38 G38-04) 新增：人机协作审批 */
  onOpenHumanApproval?: () => void;
  /** v6.23.0 (Cycle 8 P0-12) 新增：执行 Slash Command 回调 */
  onSlashCommandExecute: (command: string, args: string[]) => void;
  /** v6.23.0 (Cycle 8 P0-12) 新增：关闭 Slash Command 选择器回调 */
  onSlashCommandClose: () => void;

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
  onOpenDiffView,
  onOpenMemory,
  onOpenVerification,
  onOpenDoctor,
  onOpenLlmJudge,
  onOpenMarketplace,
  onOpenMultimodal,
  onOpenEnterpriseHub,
  onOpenTraeWork,
  onOpenGoalAutomation,
  onOpenGoalTemplates,
  onOpenMCP,
  onOpenCompaction,
  onOpenSkills,
  onOpenAgentsMd,
  onOpenCycle3,
  onOpenDualCompaction,
  onOpenRules,
  onOpenPlanEditor,
  onOpenHooks,
  onOpenSubagentMemory,
  onOpenHookChain,
  onOpenCacheStats,
  onOpenStreamList,  // v6.18.0 (Cycle 6 P0-7-B) 透传 BrandHeader
  onOpenOAuthConfig,  // v6.19.0 (Cycle 7 P0-8) 透传 BrandHeader
  onOpenSessionRollout,  // v6.20.0 (Cycle 7 P0-9) 透传 BrandHeader
  onOpenMultiAgentTree,  // v6.21.0 (Cycle 7 P0-10) 透传 BrandHeader
  onOpenTraceRule,  // v6.22.0 (Cycle 7 P0-11) 透传 BrandHeader
  onOpenSlashCommand,  // v6.23.0 (Cycle 8 P0-12) 透传 BrandHeader
  onOpenCustomModels,  // v6.24.0 (Cycle 8 P0-14) 透传 BrandHeader
  onOpenMcpRegistry,  // v6.111.0 (Cycle 39 G39-03) 透传 BrandHeader
  onOpenMcpAdvanced,  // v6.114.0 (Cycle 41) 透传 BrandHeader
  onOpenMcpIntegrated,  // v6.115.0 (Cycle 42 G42-04) 透传 BrandHeader
  onOpenMcpE2E,  // v6.117.0 (Cycle 43 G43-04) 透传 BrandHeader
  onOpenMcpMultimodal,  // v6.118.0 (Cycle 44 G44-04) 透传 BrandHeader
  onOpenMcpRag,  // v6.119.0 (Cycle 45 G45-04) 透传 BrandHeader
  onOpenMcpRagRealLLM,  // v6.120.0 (Cycle 46) 透传 BrandHeader
  onOpenMcpRagPerformance,  // v6.121.0 (Cycle 47) 透传 BrandHeader
  onOpenMcpMultimodalRag,  // v6.122.0 (Cycle 48) 透传 BrandHeader
  onOpenMcpMultimodalProvider,  // v6.123.0 (Cycle 49) 透传 BrandHeader
  onOpenMcpE2EProduction,  // v6.124.0 (Cycle 50) 透传 BrandHeader
  onOpenComposer,  // v6.36.0 (Cycle 16 P0-1) 透传 BrandHeader
  onOpenBackgroundTasks,  // v6.41.0 (Cycle 19 P0-1) 透传 BrandHeader
  onOpenBestOfN,  // v6.42.0 (Cycle 19 P0-2) 透传 BrandHeader
  onOpenDesignMode,  // v6.43.0 (Cycle 19 P0-3) 透传 BrandHeader
  onOpenWorktree,  // v6.45.0 (Cycle 20 P0-1) 透传 BrandHeader
  onOpenModelRouter,  // v6.46.0 (Cycle 20 P0-2) 透传 BrandHeader
  onOpenHooks20,  // v6.47.0 (Cycle 20 P0-3) 透传 BrandHeader
  onOpenBestOfNCoordinator,  // v6.48.0 (Cycle 21 P0-1) 透传 BrandHeader
  onOpenModelRouterStats,  // v6.49.0 (Cycle 21 P0-2) 透传 BrandHeader
  onOpenHooksMarketplace,  // v6.50.0 (Cycle 21 P0-4) 透传 BrandHeader
  onOpenSideChat,  // v6.51.0 (Cycle 22 G22-01) 透传 BrandHeader
  onOpenCostPrediction,  // v6.52.0 (Cycle 22 G22-02) 透传 BrandHeader
  onOpenHookPerformance,  // v6.53.0 (Cycle 22 G22-03) 透传 BrandHeader
  onOpenModelRouterAdmin,  // v6.54.0 (Cycle 22 G22-04) 透传 BrandHeader
  onOpenCandidateLearning,  // v6.55.0 (Cycle 23 G23-01) 透传 BrandHeader
  onOpenSessionReplay,  // v6.56.0 (Cycle 23 G23-02) 透传 BrandHeader
  onOpenProactiveSuggestion,  // v6.57.0 (Cycle 23 G23-04) 透传 BrandHeader
  onOpenGlobalMemory,  // v6.58.0 (Cycle 24 G24-01) 透传 BrandHeader
  onOpenMultiTask,  // v6.59.0 (Cycle 24 G24-02) 透传 BrandHeader
  onOpenFigmaImport,  // v6.60.0 (Cycle 24 G24-04) 透传 BrandHeader
  onOpenAutoCodeReview,  // v6.61.0 (Cycle 25 G25-01) 透传 BrandHeader
  onOpenPRBot,  // v6.62.0 (Cycle 25 G25-02) 透传 BrandHeader
  onOpenPerfOptimizer,  // v6.63.0 (Cycle 25 G25-03) 透传 BrandHeader
  onOpenCsvBatch,  // v6.64.0 (Cycle 26 G26-01) 透传 BrandHeader
  onOpenSmartApproval,  // v6.65.0 (Cycle 26 G26-02) 透传 BrandHeader
  onOpenMTC,  // v6.66.0 (Cycle 26 G26-03) 透传 BrandHeader
  onOpenNestedSubAgent,  // v6.67.0 (Cycle 27 G27-01) 透传 BrandHeader
  onOpenAgentCheckpoint,  // v6.68.0 (Cycle 27 G27-02) 透传 BrandHeader
  onOpenAgentMessaging,  // v6.69.0 (Cycle 27 G27-04) 透传 BrandHeader
  onOpenAgentTemplate,  // v6.70.0 (Cycle 27 G27-05) 透传 BrandHeader
  onOpenRemoteControl,  // v6.71.0 (Cycle 27 G27-06) 透传 BrandHeader
  onOpenSkillSystem,  // v6.72.0 (Cycle 28 G28-01) 透传 BrandHeader
  onOpenCostBudget,  // v6.73.0 (Cycle 28 G28-02) 透传 BrandHeader
  onOpenUsageAttribution,  // v6.74.0 (Cycle 28 G28-03) 透传 BrandHeader
  onOpenScopedPermissions,  // v6.75.0 (Cycle 28 G28-04) 透传 BrandHeader
  onOpenCommandPalette,  // v6.76.0 (Cycle 28 G28-05) 透传 BrandHeader
  onOpenStackedSkills,  // v6.77.0 (Cycle 29 G29-01) 透传 BrandHeader
  onOpenSkillsMarket,  // v6.78.0 (Cycle 29 G29-02) 透传 BrandHeader
  onOpenAnalyticsChat,  // v6.79.0 (Cycle 29 G29-03) 透传 BrandHeader
  onOpenCostThreshold,  // v6.83.0 (Cycle 30 G30-01) 透传 BrandHeader
  onOpenDynamicWorkflow,  // v6.84.0 (Cycle 30 G30-02) 透传 BrandHeader
  onOpenOrchestratedAgent,  // v6.85.0 (Cycle 30 G30-03) 透传 BrandHeader
  onOpenCostAttribution,  // v6.86.0 (Cycle 31 G31-01) 透传 BrandHeader
  onOpenRemoteWorktree,  // v6.87.0 (Cycle 31 G31-02) 透传 BrandHeader
  onOpenWorktreeSync,  // v6.88.0 (Cycle 31 G31-03) 透传 BrandHeader
  onOpenAuditTrail,  // v6.89.0 (Cycle 32 G32-01) 透传 BrandHeader
  onOpenSSO,  // v6.90.0 (Cycle 32 G32-02) 透传 BrandHeader
  onOpenPolicy,  // v6.91.0 (Cycle 32 G32-03) 透传 BrandHeader
  onOpenEnterpriseWorkflow,  // v6.94.0 (Cycle 33 G33-01) 透传 BrandHeader
  onOpenUnifiedDashboard,  // v6.94.0 (Cycle 33 G33-02) 透传 BrandHeader
  onOpenSecurityAudit,  // v6.94.0 (Cycle 33 G33-03) 透传 BrandHeader
  onOpenEdgeModelRouter,  // v6.97.0 (Cycle 34 G34-01) 透传 BrandHeader
  onOpenOfflineFirst,  // v6.97.0 (Cycle 34 G34-02) 透传 BrandHeader
  onOpenDeviceCluster,  // v6.97.0 (Cycle 34 G34-03) 透传 BrandHeader
  onOpenWorkflowOrchestrator,  // v6.98.0 (Cycle 35 G35-01) 透传 BrandHeader
  onOpenAgentCommunication,  // v6.98.0 (Cycle 35 G35-02) 透传 BrandHeader
  onOpenTaskCheckpoint,  // v6.98.0 (Cycle 35 G35-03) 透传 BrandHeader
  onOpenAgentScheduler,  // v6.98.0 (Cycle 35 G35-04) 透传 BrandHeader
  onOpenLLMProvider,  // v6.99.0 (Cycle 36 G36-01) 透传 BrandHeader
  onOpenStreamingChat,  // v6.99.0 (Cycle 36 G36-02) 透传 BrandHeader
  onOpenMultiModal,  // v6.99.0 (Cycle 36 G36-03) 透传 BrandHeader
  onOpenRAG,  // v7.00.0 (Cycle 37 G37-01) 透传 BrandHeader
  onOpenToolMarketplace,  // v7.00.0 (Cycle 37 G37-02) 透传 BrandHeader
  onOpenAgentLoop,  // v7.00.0 (Cycle 37 G37-03) 透传 BrandHeader
  onOpenRealLLMProvider,  // v7.00.0 (Cycle 37 G37-04) 透传 BrandHeader
  onOpenMultiAgentCrew,  // v7.01.0 (Cycle 38 G38-01) 透传 BrandHeader
  onOpenLongTermMemory,  // v7.01.0 (Cycle 38 G38-02) 透传 BrandHeader
  onOpenReflection,  // v7.01.0 (Cycle 38 G38-03) 透传 BrandHeader
  onOpenHumanApproval,  // v7.01.0 (Cycle 38 G38-04) 透传 BrandHeader
  onSlashCommandExecute,  // v6.23.0 (Cycle 8 P0-12) 透传 SlashCommandPicker
  onSlashCommandClose,  // v6.23.0 (Cycle 8 P0-12) 透传 SlashCommandPicker
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
        onOpenDiffView={onOpenDiffView}
        onOpenMemory={onOpenMemory}
        onOpenVerification={onOpenVerification}
        onOpenDoctor={onOpenDoctor}
        onOpenLlmJudge={onOpenLlmJudge}
        onOpenMarketplace={onOpenMarketplace}
        onOpenMultimodal={onOpenMultimodal}
        onOpenEnterpriseHub={onOpenEnterpriseHub}
        onOpenTraeWork={onOpenTraeWork}
        onOpenGoalAutomation={onOpenGoalAutomation}
        onOpenGoalTemplates={onOpenGoalTemplates}
        onOpenMCP={onOpenMCP}
        onOpenCompaction={onOpenCompaction}
        onOpenSkills={onOpenSkills}
        onOpenAgentsMd={onOpenAgentsMd}
        onOpenCycle3={onOpenCycle3}
        onOpenDualCompaction={onOpenDualCompaction}
        onOpenRules={onOpenRules}
        onOpenPlanEditor={onOpenPlanEditor}
        onOpenHooks={onOpenHooks}
        onOpenSubagentMemory={onOpenSubagentMemory}
        onOpenHookChain={onOpenHookChain}
        onOpenCacheStats={onOpenCacheStats}
        onOpenStreamList={onOpenStreamList}
        onOpenOAuthConfig={onOpenOAuthConfig}
        onOpenSessionRollout={onOpenSessionRollout}
        onOpenMultiAgentTree={onOpenMultiAgentTree}
        onOpenTraceRule={onOpenTraceRule}
        onOpenSlashCommand={onOpenSlashCommand}
        onOpenCustomModels={onOpenCustomModels}
        onOpenMcpRegistry={onOpenMcpRegistry}
        onOpenMcpAdvanced={onOpenMcpAdvanced}
        onOpenMcpIntegrated={onOpenMcpIntegrated}
        onOpenMcpE2E={onOpenMcpE2E}
        onOpenMcpMultimodal={onOpenMcpMultimodal}
        onOpenMcpRag={onOpenMcpRag}
        onOpenMcpRagRealLLM={onOpenMcpRagRealLLM}
        onOpenMcpRagPerformance={onOpenMcpRagPerformance}
        onOpenMcpMultimodalRag={onOpenMcpMultimodalRag}
        onOpenMcpMultimodalProvider={onOpenMcpMultimodalProvider}
        onOpenComposer={onOpenComposer}
        onOpenBackgroundTasks={onOpenBackgroundTasks}
        onOpenBestOfN={onOpenBestOfN}
        onOpenDesignMode={onOpenDesignMode}
        onOpenWorktree={onOpenWorktree}
        onOpenModelRouter={onOpenModelRouter}
        onOpenHooks20={onOpenHooks20}
        onOpenBestOfNCoordinator={onOpenBestOfNCoordinator}
        onOpenModelRouterStats={onOpenModelRouterStats}
        onOpenHooksMarketplace={onOpenHooksMarketplace}
        onOpenSideChat={onOpenSideChat}
        onOpenCostPrediction={onOpenCostPrediction}
        onOpenHookPerformance={onOpenHookPerformance}
        onOpenModelRouterAdmin={onOpenModelRouterAdmin}
        onOpenCandidateLearning={onOpenCandidateLearning}
        onOpenSessionReplay={onOpenSessionReplay}
        onOpenProactiveSuggestion={onOpenProactiveSuggestion}
        onOpenGlobalMemory={onOpenGlobalMemory}
        onOpenMultiTask={onOpenMultiTask}
        onOpenFigmaImport={onOpenFigmaImport}
        onOpenAutoCodeReview={onOpenAutoCodeReview}
        onOpenPRBot={onOpenPRBot}
        onOpenPerfOptimizer={onOpenPerfOptimizer}
        onOpenCsvBatch={onOpenCsvBatch}
        onOpenSmartApproval={onOpenSmartApproval}
        onOpenMTC={onOpenMTC}
        onOpenNestedSubAgent={onOpenNestedSubAgent}
        onOpenAgentCheckpoint={onOpenAgentCheckpoint}
        onOpenAgentMessaging={onOpenAgentMessaging}
        onOpenAgentTemplate={onOpenAgentTemplate}
        onOpenRemoteControl={onOpenRemoteControl}
        onOpenSkillSystem={onOpenSkillSystem}
        onOpenCostBudget={onOpenCostBudget}
        onOpenUsageAttribution={onOpenUsageAttribution}
        onOpenScopedPermissions={onOpenScopedPermissions}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenStackedSkills={onOpenStackedSkills}
        onOpenSkillsMarket={onOpenSkillsMarket}
        onOpenAnalyticsChat={onOpenAnalyticsChat}
        onOpenCostThreshold={onOpenCostThreshold}
        onOpenDynamicWorkflow={onOpenDynamicWorkflow}
        onOpenOrchestratedAgent={onOpenOrchestratedAgent}
        onOpenCostAttribution={onOpenCostAttribution}
        onOpenRemoteWorktree={onOpenRemoteWorktree}
        onOpenWorktreeSync={onOpenWorktreeSync}
        onOpenAuditTrail={onOpenAuditTrail}
        onOpenSSO={onOpenSSO}
        onOpenPolicy={onOpenPolicy}
        onOpenEnterpriseWorkflow={onOpenEnterpriseWorkflow}
        onOpenUnifiedDashboard={onOpenUnifiedDashboard}
        onOpenSecurityAudit={onOpenSecurityAudit}
        onOpenEdgeModelRouter={onOpenEdgeModelRouter}
        onOpenOfflineFirst={onOpenOfflineFirst}
        onOpenDeviceCluster={onOpenDeviceCluster}
        onOpenWorkflowOrchestrator={onOpenWorkflowOrchestrator}
        onOpenAgentCommunication={onOpenAgentCommunication}
        onOpenTaskCheckpoint={onOpenTaskCheckpoint}
        onOpenAgentScheduler={onOpenAgentScheduler}
        onOpenLLMProvider={onOpenLLMProvider}
        onOpenStreamingChat={onOpenStreamingChat}
        onOpenMultiModal={onOpenMultiModal}
        onOpenRAG={onOpenRAG}
        onOpenToolMarketplace={onOpenToolMarketplace}
        onOpenAgentLoop={onOpenAgentLoop}
        onOpenRealLLMProvider={onOpenRealLLMProvider}
        onOpenMultiAgentCrew={onOpenMultiAgentCrew}
        onOpenLongTermMemory={onOpenLongTermMemory}
        onOpenReflection={onOpenReflection}
        onOpenHumanApproval={onOpenHumanApproval}
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
      <div className="flex-shrink-0 px-4 relative">
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
        {/* v6.23.0 (Cycle 8 P0-12) 新增：Slash Commands 选择器
         *  当 inputValue 以 / 开头时自动弹出，集成 18 个内置命令
         *  提供键盘导航（↑↓ Enter Esc）和分类显示 */}
        <SlashCommandPicker
          inputValue={inputValue}
          onExecute={onSlashCommandExecute}
          onClose={onSlashCommandClose}
        />
      </div>
    </div>
  );
};

// ============================================================
// MessageRow 已抽离到 ChatView 组件（v6.12.0 P0-2 拆分第六阶段）
// 如需修改消息渲染，请编辑 ./ChatView.tsx
// ============================================================

export default AppLayout;
