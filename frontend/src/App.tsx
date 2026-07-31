/**
 * # ============================================================
 * # 主应用组件 - Hermes 对话主界面
 * # ============================================================
 * # 核心作用：应用根组件，以 Hermes 对话式布局替代原聊天框网格，
 * #           管理全局状态和布局；集成 Session 生命周期
 * # 运行流程：
 * #   1. 启动时读取 localStorage 中的 current_session_id
 * #   2. 若有：直接加载该历史会话的完整上下文
 * #   3. 若无：自动调用 POST /api/sessions 创建一个空 Session
 * #   4. 渲染：左侧 Sidebar + 主对话区 + 右侧用量监控面板
 * #   5. 发送消息时透传 session_id，由后端持久化到 conversations
 * #   6. 切会话时调用 useSessionDetail 一次拉取完整上下文
 * # 输入参数：无（通过 hooks 获取数据）
 * # 输出结果：完整的 Hermes 对话界面（含会话管理）
 * # 修改记录：
 * #   - 2026-06-17 | v2.0.0 | 重构为 Hermes 对话主界面，替代原聊天框网格布局
 * #   - 2026-06-17 | v2.0.1 | 添加响应式布局支持：移动端适配 Header/主区域/消息气泡/输入区/Agent卡片/用量面板
 * #   - 2026-06-17 | v2.2.0 | 添加流式思考与实时输出支持：SSE 流式对话、思考折叠、状态指示器
 * #   - 2026-06-23 | v2.3.0 | 视觉品质深化：应用 .btn-primary/.input-glow/.glow-hermes/.glass 工具类；消息入场动画 + 呼吸高光；骨架屏加载态
 * #   - 2026-06-23 | v2.4.0 | 集成 Sidebar；自动创建 / 切换 / 删除 Session；localStorage 持久化；chatWithHermes* 透传 session_id
 * #   - 2026-06-23 | v2.5.0 | onDone 接收 title 自动写回 Session（侧边栏实时反映新标题）
 * #   - 2026-06-23 | v2.6.0 | 移除 onDone 自动写回 title（撤销 auto-session-title-generation）
 * #   - 2026-06-24 | v2.7.0 | 新建对话按钮禁用逻辑（messages 为空时禁止创建）；新增 handleBatchDelete / handleOpenTrash 回调
 * #   - 2026-06-24 | v2.8.0 | 新增 settingsOpen 状态 + SettingsPanel 条件渲染 + Sidebar onOpenSettings（Task 7）
 * #   - 2026-06-24 | v2.8.1 | Task 4: 新增 toastType state，修复 showToast 完整透传 type 到 Toast 组件；Task 5: 移除 handleOpenTrash 死回调 + Sidebar onOpenTrash 引用
 * #   - 2026-06-24 | v2.9.0 | 集成 BrandHeader + WelcomeState + 贴底浮动输入区（豆包风格）
 * #   - 2026-06-24 | v2.9.1 | Sidebar 新增 onNewTask 透传：折叠态下提供"新建对话"入口（Task 6）
 * #   - 2026-06-24 | v2.9.2 | 流式错误分支改为设置 ChatMessage.error 字段 + 渲染 MessageBubble 错误卡片（Task 4 + Task 8）
 * #   - 2026-06-24 | v2.9.3 | 浮动输入区从 viewport fixed 改为主区内 mt-auto 推底（与对话标题对齐）
 * #   - 2026-06-24 | v3.0.0 | 双模式入口：ModeSelector 首次选择 / localStorage 持久化 / Sidebar 模式切换 pill / BrandHeader 模式指示器 / 聊天模式简化逻辑
 * #   - 2026-06-24 | v2.10.0 | 编程模式新增 ProjectSelector / FileExplorer / CodeViewer 三组件；selectedProject + openedFile 状态；垂直分屏布局 + 紧凑聊天模式
 * #   - 2026-06-24 | v2.10.1 | fileExplorerOpen state + FileExplorer 渐变隐藏 + BrandHeader 切换入口
 * #   - 2026-06-24 | v2.10.2 | handleBackToModeSelect / handleSwitchToChat / handleSwitchMode + ProjectSelector/BrandHeader 透传
 * #   - 2026-06-24 | v2.10.3 | BrandHeader 取消 onSwitchMode 透传（pill 删除后无消费者）
 * #   - 2026-06-24 | v2.10.4 | 修复启动 404 回退：useSessionDetail onNotFound + handleSessionNotFound 自动重建 Session
 * #   - 2026-06-29 | v3.1.0 | 新增需求澄清阶段 UI：ClarificationProgress 进度条 + ClarificationCard 澄清卡片 + clarifying 阶段消息发送分流 + extractSummary/extractQuestions 辅助函数
 * #   - 2026-06-29 | v3.2.0 | 修复 TS 类型错误：删除 BrandHeader 的已废弃 appMode prop（BrandHeaderProps 在 v1.3.0 已移除该属性）
 * #   - 2026-06-29 | v3.3.0 | 新增停止生成功能：abortControllerRef + handleStop 调用 /api/hermes/stop 终止后端子进程 + chatWithHermesStreaming 传入 signal
 * #   - 2026-06-29 | v3.4.0 | handleSendMessage 传入 appMode 作为 sessionMode 参数，
 * #     支持 coding 模式下开发需求自动路由到 WorkflowEngine
 * #   - 2026-06-30 | v3.5.0 | 修复 setWorkflowStatus 从未被调用导致 clarifying 分流失效的问题：
 * #     ① 新增 useEffect 根据 sessionDetail.session.workflow_id 拉取工作流状态并赋值；
 * #     ② handleSendMessage 新增 onWorkflowStarted 回调，捕获 SSE workflow_started 事件并在 onDone 后刷新状态；
 * #     依赖：useApi.fetchWorkflowStatus（v2.5.0）、Session.workflow_id（types v1.8.0）、后端 SessionResponse（v2.1.0）
 * #   - 2026-06-30 | v3.6.0 | 消费结构化 clarify_questions SSE 事件 + 交互式澄清卡片：
 * #     ① clarificationData state 扩展 options/allowMultiple 字段，承载结构化候选选项；
 * #     ② 新增 handleClarifyQuestions 回调，统一映射后端 snake_case（allow_multiple）→ 前端 camelCase；
 * #     ③ chatWithHermesStreaming 调用处接入 onClarifyQuestions 回调；
 * #     ④ 新增 handleSendClarifyAnswer，clarifying 阶段统一改走 chatWithHermesStreaming（替代裸 fetch /clarify/respond）；
 * #     ⑤ ClarificationCard 渲染接入 onSubmit（提交结构化回答触发下一轮）+ key 按轮次重挂载；
 * #     ⑥ 保留 extractSummary/extractQuestions 作为结构化事件缺失时的 Markdown 文本降级解析
 * #   - 2026-06-30 | v3.7.0 | 重构澄清 UI：引入 ClarificationModal 替代内联 ClarificationCard；
 * #     ① 新增 ClarificationModal 导入 + showClarifyModal state 控制弹窗显隐；
 * #     ② handleClarifyQuestions 增加 showClarifyModal 逻辑（非完成→显示，完成→关闭）；
 * #     ③ 编程模式与标准聊天模式双渲染路径中，ClarificationCard → ClarificationModal，新增 showClarifyModal && 条件；
 * #     ④ onSubmit/onConfirm/onContinueAdd 回调中统一调用 setShowClarifyModal(false) 关闭弹窗
#   - 2026-06-30 | v3.8.0 | handleClarifyQuestions 移除 data.complete 时关闭弹窗逻辑，澄清完成时保持弹窗打开
#   - 2026-06-30 | v3.9.0 | 新增 useEffect 监听 clarificationData.isComplete 强制弹窗（防御运行时状态竞争）
#   - 2026-07-23 | v5.6.0 | 修复"跳过不确定项进入架构设计"按钮无防重入 + 设计阶段启动闭包过期：
#     ① 新增 skipConfirmInFlightRef 守卫单次点击只发起一次 /clarify/confirm 请求，
#        防止快速双击/多次点击导致后端 confirming→designing 推进与 designing→prompting 校验失败；
#     ② handleStartDesignPhase / handleConfirmDesign / handleRejectDesign 改用
#        workflowIdRef.current 读取最新 workflow_id，避免 sessionDetail 异步加载时闭包
#        捕获 null 导致 "无 workflow_id" 警告 + 模态弹窗不弹出
#   - 2026-07-24 | v5.7.0 | 集成 Loop v7 端到端工作流：
#     ① 导入 LoopV7Runner 组件 + 新增 showLoopV7Runner state 控制弹窗显隐；
#     ② handleOpenLoopV7 回调调 setShowLoopV7Runner(true) 打开 Runner；
#     ③ BrandHeader 透传 onOpenLoopV7，菜单点击触发 Runner 弹窗；
#     ④ 主内容区域底部条件渲染 LoopV7Runner 组件
#   - 2026-07-24 | v5.8.0 | 修复"确认通过按钮无法选择"问题（handleConfirmDesign）：
#     ① wfId 为 null 时从静默 return 改为 showToast 提示用户；
#     ② 点击后立即 setIsDesignLoading(true) 提供即时视觉反馈；
#     ③ 后端 success=false / API 异常时均通过 showToast 显示具体错误，不再仅 console.error；
#     ④ useCallback 依赖项追加 showToast，避免闭包过期
#   - 2026-07-24 | v5.9.0 | Module A 前端 UI 优化（Task A1）：
#     ① 为所有 localStorage.getItem/setItem/removeItem 调用补充 try-catch 异常防护，
#        防止 Safari 隐私模式 / 配额满 / 第三方 cookie 拦截等异常导致应用崩溃
#     ② handleSendMessage 引入 inFlightRef 300ms 防重入守卫
#     ③ Sidebar 搜索框增加 300ms 输入防抖
#     ④ tsconfig.json 启用 noUnusedLocals/noUnusedParameters 严格模式
#     ⑤ vite.config.ts 增加 manualChunks vendor 切分
#   - 2026-07-24 | v5.10.0 | Module C2 结构桩拆分 - 新增以下 5 个子组件占位：
#     ① components/chat/ChatView.tsx - 对话消息显示区域
#     ② components/chat/InputArea.tsx - 底部输入区
#     ③ components/workflow/ClarificationHandler.tsx - 需求澄清流程
#     ④ components/workflow/WorkflowStageRenderer.tsx - 工作流阶段渲染器
#     ⑤ components/workflow/DesignPhaseHandler.tsx - 架构设计阶段处理器
#     当前为 STRUCTURAL refactor：仅定义 Props 接口与占位组件，JSX 迁移待
#     后续 Module 完成（详见各子组件文件头注释的 TODO 标注）。
#   - 2026-07-24 | v5.11.0 | Module E Codex 核心特性集成：
#     ① 导入 ModelSelector / ReasoningIntensitySelector / reviewCode / fixCode
#        / runReviewFixLoop；
#     ② 新增 handleSlashCommand 分发器，handleSendMessage 调用前检测 /review
#        / /fix / /review-fix-loop 斜杠命令，命中则直接调对应 API 而不走流式对话；
#     ③ /review 默认审查当前打开的文件（openedFile），结果写入 reviewData 触发
#        ReviewReport 渲染 + 追加摘要消息；
#     ④ /fix 必填 file 路径，先 review 再 fix，输出 diff 摘要；
#     ⑤ /review-fix-loop 触发后端 ReviewFixLoop 服务，最长 3 轮自迭代；
#     ⑥ BrandHeader 下方新增常驻工具栏：ModelSelector + ReasoningIntensitySelector
#        + 斜杠命令提示 + 当前文件路径 hint
#   - 2026-07-27 | v5.12.0 | Cycle 3 UI/UX 优化：
#     ① 移除面板外部冗余标题（Cycle3Panel/DualCompactionPanel/RulesPanel
#        内部已有渐变标题），改为纯容器包装；
#     ② 弹窗背景升级为 bg-black/40 + backdrop-blur-md（玻璃拟态）；
#     ③ 弹窗布局改为 flex column + 固定高度（h-[85vh]）+ overflow-hidden，
#        配合面板内部 overflow-y-auto 区域实现独立滚动
#   - 2026-07-27 | v5.13.1 | P0-2 App.tsx 拆分第五阶段：从 App.tsx 抽离 11 个面板/弹窗显隐状态
#     到 hooks/useModals.ts，通过 useModals() 调用 + 本地别名（settingsOpen ↔
#     settings.open 等）保持所有现有引用不变，App.tsx 减少约 33 行重复 useState
#   - 2026-07-27 | v5.13.0 | Cycle 3 UI/UX 进一步优化：
#     ① 新增 Cycle3Modal 统一模态组件（带 Escape 键关闭 + 背景点击关闭）
#     ② 三个面板均接受 onClose prop，在渐变标题栏右侧显示 ✕ 关闭按钮
#     ③ Cycle3Panel/DualCompactionPanel/RulesPanel 升级为 v1.1.1
#        （渐变标题 + 玻璃拟态 + 加载骨架 + toast 提示 + 空状态）
#     ④ BrandHeader 新增 onOpenCycle3/onOpenDualCompaction/onOpenRules 菜单项
#        + shield/cpu 内联 SVG 图标 + "Cycle 3 新功能"分组标题
#   - 2026-07-29 | v5.14.0 | Cycle 18 P0-3 集成全局错误处理：
#     ① 导入 GlobalErrorToast 组件并在根级别渲染（始终显示在最顶层）
#     ② main.tsx 中安装 GlobalErrorHandler（监听 window.onerror /
#        unhandledrejection / 资源加载错误）
#     ③ 关键面板（Sidebar / ComposerPanel / 后续 panel）增加 ErrorBoundary
#        嵌套（level='panel'），任一面板崩溃不影响其他功能
#   - 2026-07-29 | v6.48.0 | Cycle 21 P0-1~P0-4 集成 4 个协同面板：
#     ① BestOfNCoordinatorPanel (v6.48.0) Best-of-N × Worktree 协同
#     ② ModelRouterStatsPanel (v6.49.0) 模型路由成本统计 Dashboard
#     ③ HooksMarketplacePanel (v6.50.0) Hook 模板市场
#     ④ HookChainViewer (v1.4.0/Cycle 5) Hook 链路查看器（已存在）
#     ⑤ 4 个面板均通过 ErrorBoundary 嵌套 + 显隐 state + onClose 回调
#     ⑥ BrandHeader 新增对应菜单项：🎯 Best-of-N 协同 / 💰 模型成本统计 /
#        🛒 Hook 模板市场
#   - 2026-07-29 | v6.54.0 | Cycle 22 G22-01~G22-04 集成 4 个新功能面板：
#     ① SideChatPanel (v1.0.0/Cycle 22 G22-01) Side Chat 多子对话管理
#     ② CostPredictionPanel (v1.0.0/Cycle 22 G22-02) 成本预测 + 预算告警
#     ③ HookPerformancePanel (v1.0.0/Cycle 22 G22-03) Hook 性能分析 + 报告导出
#     ④ ModelRouterAdminPanel (v1.0.0/Cycle 22 G22-04) 模型路由策略管理
#     ⑤ 4 个面板均通过 ErrorBoundary 嵌套 + 显隐 state + onClose 回调
#     ⑥ BrandHeader 新增 4 个菜单项 + 4 个 SVG 图标
#     ⑦ AppLayout 新增 4 个回调 prop 透传
#   - 2026-07-29 | v6.57.0 | Cycle 23 G23-01~G23-04 集成 3 个新功能面板：
#     ① CandidateLearningPanel (v1.0.0/Cycle 23 G23-01) 候选学习
#     ② SessionReplayPanel (v1.0.0/Cycle 23 G23-02) 会话回放
#     ③ ProactiveSuggestionPanel + FloatingSuggestionBubble (v1.0.0/Cycle 23 G23-04) AI 主动建议 + 浮动气泡
#     ④ 3 个面板均通过 ErrorBoundary 嵌套 + 显隐 state + onClose 回调
#     ⑤ BrandHeader 新增 3 个菜单项 + 3 个 SVG 图标
#     ⑥ AppLayout 新增 3 个回调 prop 透传
#     ⑦ 浮动气泡挂在主内容区域右下角，hover 自动展开建议
#   - 2026-07-30 | v6.71.0 | Cycle 27 G27-01/02/04/05/06 新增 5 个面板集成
#     ① NestedSubAgentPanel (嵌套子代理) / AgentCheckpointPanel (代理检查点)
#     ② AgentMessagingPanel (代理消息) / AgentTemplatePanel (代理模板) / RemoteControlPanel (远程控制)
#     ③ 5 个面板均通过 ErrorBoundary 嵌套 + 显隐 state + onClose 回调
#     ④ BrandHeader 新增 5 个菜单项 (🌲/📌/💬/📋/📱) + 5 个 SVG 图标 (nested/checkpoint/messaging/template/remote)
#     ⑤ AppLayout 新增 5 个回调 prop 透传
#     ⑥ 对应 Codex v0.130+ Nested Sub-Agents + Claude Code 2026-06 Agent Checkpointing
#     ⑦ 对应 Codex v0.130+ Structured Messaging + Agent Templates + Remote Control
#   - 2026-07-30 | v6.78.0 | Cycle 29 G29-02/03 新增 2 个面板集成
#     ① MarketplacePanel (技能市场) - 浏览/安装/评分/评论
#     ② AnalyticsChatPanel (分析聊天) - 自然语言查询用量数据
#     ③ 2 个面板均通过 ErrorBoundary 嵌套 + 显隐 state + onClose 回调
#     ④ BrandHeader 新增 2 个菜单项 (🛍️/📊)
#     ⑤ AppLayout 新增 2 个回调 prop 透传
#     ⑥ 对应 Codex Skills Marketplace + Claude Code Analytics Chat
# ============================================================
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  useAgents, useStats, useSessions, useSessionDetail,
  confirmPlan, chatWithHermesStreaming,
  createSession, deleteSession, updateSession,
  batchDeleteSessions, restoreSessions, fetchWorkflowStatus,
  startDesignPhase, confirmDesignPhase, rejectDesignPhase,
  reviewCode, fixCode, runReviewFixLoop,
} from './hooks/useApi';
import PlanViewer from './components/PlanViewer';
import Sidebar from './components/Sidebar';
/** v6.36.0 P2-1：移动端响应式组件 */
import { useIsMobile } from './hooks/useResponsive';
import MobileHeader from './components/MobileHeader';
import MobileSidebar from './components/MobileSidebar';
/** v6.37.0 P2-2：全局快捷键 Hook */
import { useShortcut, COMMON_SHORTCUTS } from './hooks/useShortcut';
import SettingsPanel from './components/SettingsPanel';
import ModeSelector from './components/ModeSelector';
import ProjectSelector from './components/ProjectSelector';
import FileExplorer from './components/FileExplorer';
import LoopV7Runner from './components/LoopV7Runner';
import type { Agent, Session, LoopWorkflowStatus, ReviewData, PipelineData, GoalData } from './types';

/** 从 utils/messageFormatters 抽离的 helper 函数 + 常量 + 类型 */
import { LS_CURRENT_SESSION_ID, LS_APP_MODE, extractSummary, extractQuestions } from './utils/messageFormatters';
import type { ChatMessage } from './utils/messageFormatters';
/** 从 hooks/useToast 抽离的 toast 状态管理 */
import { useToast } from './hooks/useToast';
/** v6.35.0 P1-7：多 Toast 堆叠容器 */
import ToastContainer from './components/ToastContainer';
/** v4.2.0 P0-2：从 App.tsx 抽离 11 个面板/弹窗显隐状态 */
import { useModals } from './hooks/useModals';
/** v6.9.0 P0-2：从 App.tsx 抽离的用量监控面板 */
import { UsagePanel, type UsageStats } from './components/UsagePanel';
/** v6.10.0 P0-2：从 App.tsx 抽离的主对话舞台布局 */
import { AppLayout } from './components/AppLayout';
/** v6.14.0 Cycle 2 新增：MCP 工具调用面板 */
import McpPanel from './components/McpPanel';
/** v6.14.0 Cycle 2 新增：会话压缩指示器 */
import CompactionIndicator from './components/CompactionIndicator';
/** v6.14.0 Cycle 2 新增：Skills 面板内容（弹窗辅助组件） */
import SkillsPanelContent from './components/SkillsPanelContent';
/** v6.14.0 Cycle 2 新增：AGENTS.md 面板内容（弹窗辅助组件） */
import AgentsMdPanelContent from './components/AgentsMdPanelContent';
/** Cycle 3 v1.0.0 新增：MCP 高级功能面板（权限/外部服务器/审批/审计） */
import Cycle3Panel from './components/Cycle3Panel';
/** Cycle 3 v1.0.0 新增：双触发压缩面板 */
import DualCompactionPanel from './components/DualCompactionPanel';
/** Cycle 3 v1.0.0 新增：多类型规则扫描面板 */
import RulesPanel from './components/RulesPanel';
/** v6.13.0 (Cycle 4 P0-3) 新增：Plan 编辑器模态弹窗 */
import PlanEditorModal from './components/PlanEditorModal';
/** v6.14.0 (Cycle 4 P0-4) 新增：Hooks 事件系统面板 */
import HooksPanel from './components/HooksPanel';
/** v6.15.0 (Cycle 4 P0-4) 新增：SubAgent 记忆查看器 */
import SubAgentMemoryViewer from './components/SubAgentMemoryViewer';
/** v1.4.0 (Cycle 5 P0-6) 新增：Hook 触发链路查看器 */
import HookChainViewer from './components/HookChainViewer';
/** v1.5.0 (Cycle 6 P0-7-A) 新增：LLM 缓存统计面板 */
import CacheStatsPanel from './components/CacheStatsPanel';
/** v1.6.0 (Cycle 6 P0-7-B) 新增：流式恢复网关管理面板 */
import StreamListPanel from './components/StreamListPanel';
/** v1.7.0 (Cycle 7 P0-8) 新增：OAuth 2.1 + PKCE 配置弹窗 */
import OAuthConfigModal from './components/OAuthConfigModal';
import SessionRolloutPanel from './components/SessionRolloutPanel';
/** v5.14.0 (Cycle 7 P0-10) 新增：Multi-Agent v2 Path Tree 面板 */
import MultiAgentTreePanel from './components/MultiAgentTreePanel';
/** v5.7.0 (Cycle 7 P0-11) 新增：TRACE 规则管理面板 */
import RulePanel from './components/RulePanel';
/** v5.7.0 (Cycle 8 P0-12) 新增：Slash Commands 帮助面板 */
import SlashCommandHelp from './components/SlashCommandHelp';
import CustomModelsPanel from './components/CustomModelsPanel';
/** v6.36.0 (Cycle 16 P0-1) 新增：Composer 多文件编辑面板 */
import { ComposerLauncher } from './components/ComposerLauncher';
/** v6.40.0 (Cycle 18 P0-3) 新增：全局错误 Toast */
import { GlobalErrorToast } from './components/GlobalErrorToast';
/** v6.40.0 (Cycle 18 P0-3) 新增：错误边界（用于嵌套关键面板） */
import ErrorBoundary from './components/ErrorBoundary';
/** v6.41.0 (Cycle 19 P0-1) 新增：后台任务面板 */
import { BackgroundTasksPanel } from './components/BackgroundTasksPanel';
/** v6.42.0 (Cycle 19 P0-2) 新增：Best-of-N 多模型对比面板 */
import { BestOfNPanel } from './components/BestOfNPanel';
/** v6.43.0 (Cycle 19 P0-3) 新增：Design Mode 设计模式覆盖层 */
import { DesignModeOverlay } from './components/DesignModeOverlay';
/** v6.45.0 (Cycle 20 P0-1) 新增：Git Worktree 隔离管理面板 */
import { WorktreePanel } from './components/WorktreePanel';
/** v6.46.0 (Cycle 20 P0-2) 新增：智能模型路由面板 */
import { ModelRouterPanel } from './components/ModelRouterPanel';
/** v6.47.0 (Cycle 20 P0-3) 新增：事件钩子管理面板（新 v2 版本） */
import { HooksManagerPanel } from './components/HooksManagerPanel';
/** v6.48.0 (Cycle 21 P0-1) 新增：Best-of-N × Worktree 协同面板 */
import { BestOfNCoordinatorPanel } from './components/BestOfNCoordinatorPanel';
/** v6.49.0 (Cycle 21 P0-2) 新增：模型路由成本统计 Dashboard */
import { ModelRouterStatsPanel } from './components/ModelRouterStatsPanel';
/** v6.50.0 (Cycle 21 P0-4) 新增：Hook 模板市场面板 */
import { HooksMarketplacePanel } from './components/HooksMarketplacePanel';
/** v6.51.0 (Cycle 22 G22-01) 新增：Side Chat 多子对话面板 */
import { SideChatPanel } from './components/SideChatPanel';
/** v6.52.0 (Cycle 22 G22-02) 新增：成本预测面板 */
import { CostPredictionPanel } from './components/CostPredictionPanel';
/** v6.53.0 (Cycle 22 G22-03) 新增：Hook 性能分析面板 */
import { HookPerformancePanel } from './components/HookPerformancePanel';
/** v6.54.0 (Cycle 22 G22-04) 新增：模型路由管理面板 */
import { ModelRouterAdminPanel } from './components/ModelRouterAdminPanel';
/** v6.55.0 (Cycle 23 G23-01) 新增：候选学习面板 */
import { CandidateLearningPanel } from './components/CandidateLearningPanel';
/** v6.56.0 (Cycle 23 G23-02) 新增：会话回放面板 */
import { SessionReplayPanel } from './components/SessionReplayPanel';
/** v6.57.0 (Cycle 23 G23-04) 新增：AI 主动建议面板（含浮动气泡） */
import { ProactiveSuggestionPanel, FloatingSuggestionBubble } from './components/ProactiveSuggestionPanel';
/** v6.58.0 (Cycle 24 G24-01) 新增：跨会话记忆面板 */
import { GlobalMemoryPanel } from './components/GlobalMemoryPanel';
/** v6.59.0 (Cycle 24 G24-02) 新增：多任务并行编排面板 */
import { MultiTaskOrchestrationPanel } from './components/MultiTaskOrchestrationPanel';
/** v6.60.0 (Cycle 24 G24-04) 新增：Figma 设计稿转代码面板 */
import { FigmaImportPanel } from './components/FigmaImportPanel';
/** v6.61.0 (Cycle 25 G25-01) 新增：自动化代码评审面板 */
import { AutoCodeReviewPanel } from './components/AutoCodeReviewPanel';
/** v6.62.0 (Cycle 25 G25-02) 新增：PR 自动机器人面板 */
import { PRBotPanel } from './components/PRBotPanel';
/** v6.63.0 (Cycle 25 G25-03) 新增：AI 性能优化器面板 */
import { PerfOptimizerPanel } from './components/PerfOptimizerPanel';
/** v6.64.0 (Cycle 26 G26-01) 新增：CSV 批处理智能体面板 */
import { CsvBatchPanel } from './components/CsvBatchPanel';
/** v6.65.0 (Cycle 26 G26-02) 新增：智能审批引擎面板 */
import { SmartApprovalPanel } from './components/SmartApprovalPanel';
/** v6.66.0 (Cycle 26 G26-03) 新增：MTC 多模任务协作面板 */
import { MTCPanel } from './components/MTCPanel';
/** v6.67.0 (Cycle 27 G27-01) 新增：嵌套子代理面板 */
import { NestedSubAgentPanel } from './components/NestedSubAgentPanel';
/** v6.68.0 (Cycle 27 G27-02) 新增：代理检查点面板 */
import { AgentCheckpointPanel } from './components/AgentCheckpointPanel';
/** v6.69.0 (Cycle 27 G27-04) 新增：代理消息面板 */
import { AgentMessagingPanel } from './components/AgentMessagingPanel';
/** v6.70.0 (Cycle 27 G27-05) 新增：代理模板面板 */
import { AgentTemplatePanel } from './components/AgentTemplatePanel';
/** v6.71.0 (Cycle 27 G27-06) 新增：远程控制面板 */
import { RemoteControlPanel } from './components/RemoteControlPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { CostBudgetPanel } from './components/CostBudgetPanel';
import { UsageAttributionPanel } from './components/UsageAttributionPanel';
import { ScopedPermissionsPanel } from './components/ScopedPermissionsPanel';
import { SlashCommandPanel } from './components/SlashCommandPanel';
/** v6.77.0 (Cycle 29 G29-01) 新增：堆叠技能面板 */
import { StackedSkillsPanel } from './components/StackedSkillsPanel';
/** v6.78.0 (Cycle 29 G29-02) 新增：技能市场面板 */
import { MarketplacePanel } from './components/MarketplacePanel';
/** v6.79.0 (Cycle 29 G29-03) 新增：分析聊天面板 */
import { AnalyticsChatPanel } from './components/AnalyticsChatPanel';
/** v6.83.0 (Cycle 30 G30-01) 新增：成本阈值告警面板 */
import { CostThresholdAlertPanel } from './components/CostThresholdAlertPanel';
/** v6.84.0 (Cycle 30 G30-02) 新增：动态工作流面板 */
import { DynamicWorkflowPanel } from './components/DynamicWorkflowPanel';
/** v6.85.0 (Cycle 30 G30-03) 新增：编排多代理面板 */
import { OrchestratedAgentPanel } from './components/OrchestratedAgentPanel';
/** v6.86.0 (Cycle 31 G31-01) 新增：成本归因面板 */
import { CostAttributionPanel } from './components/CostAttributionPanel';
/** v6.87.0 (Cycle 31 G31-02) 新增：远程 Worktree 面板 */
import { RemoteWorktreePanel } from './components/RemoteWorktreePanel';
/** v6.88.0 (Cycle 31 G31-03) 新增：Worktree 状态同步面板 */
import { WorktreeSyncPanel } from './components/WorktreeSyncPanel';
/** v6.89.0 (Cycle 32 G32-01) 新增：审计追踪面板 */
import { AuditTrailPanel } from './components/AuditTrailPanel';
/** v6.90.0 (Cycle 32 G32-02) 新增：单点登录面板 */
import { SSOPanel } from './components/SSOPanel';
/** v6.91.0 (Cycle 32 G32-03) 新增：策略规则面板 */
import { PolicyPanel } from './components/PolicyPanel';
/** v6.94.0 (Cycle 33 G33-01) 新增：企业全场景工作流面板 */
import { EnterpriseWorkflowPanel } from './components/EnterpriseWorkflowPanel';
/** v6.94.0 (Cycle 33 G33-02) 新增：集成 Dashboard 面板 */
import { UnifiedDashboardPanel } from './components/UnifiedDashboardPanel';
/** v6.94.0 (Cycle 33 G33-03) 新增：安全审计面板 */
import { SecurityAuditPanel } from './components/SecurityAuditPanel';
/** v6.97.0 (Cycle 34 G34-01) 新增：端云模型路由面板 */
import { EdgeModelRouterPanel } from './components/EdgeModelRouterPanel';
/** v6.97.0 (Cycle 34 G34-02) 新增：离线优先面板 */
import { OfflineFirstPanel } from './components/OfflineFirstPanel';
/** v6.97.0 (Cycle 34 G34-03) 新增：设备集群面板 */
import { DeviceClusterPanel } from './components/DeviceClusterPanel';
/** v6.98.0 (Cycle 35 G35-01) 新增：工作流编排面板 */
import { WorkflowOrchestratorPanel } from './components/WorkflowOrchestratorPanel';
/** v6.98.0 (Cycle 35 G35-02) 新增：智能体通信面板 */
import { AgentCommunicationPanel } from './components/AgentCommunicationPanel';
/** v6.98.0 (Cycle 35 G35-03) 新增：任务检查点面板 */
import { TaskCheckpointPanel } from './components/TaskCheckpointPanel';
/** v6.98.0 (Cycle 35 G35-04) 新增：智能体调度面板 */
import { AgentSchedulerPanel } from './components/AgentSchedulerPanel';
/** v6.107.0 (Cycle 36 G36-01) 新增：LLM Provider 面板 */
import LLMProviderPanel from './components/LLMProviderPanel';
/** v6.107.0 (Cycle 36 G36-02) 新增：Streaming Chat 面板 */
import StreamingChatPanel from './components/StreamingChatPanel';
/** v6.107.0 (Cycle 36 G36-03) 新增：Multi-Modal 面板 */
import MultiModalPanel from './components/MultiModalPanel';
/** v6.108.0 (Cycle 37 G37-01) 新增：RAG 知识库面板 */
import RAGPanel from './components/RAGPanel';
/** v6.108.0 (Cycle 37 G37-02) 新增：Tool Use 工具市场面板 */
import ToolMarketplacePanel from './components/ToolMarketplacePanel';
/** v6.108.0 (Cycle 37 G37-03) 新增：Agent Loop 面板 */
import AgentLoopPanel from './components/AgentLoopPanel';
/** v6.108.0 (Cycle 37 G37-04) 新增：真实 LLM Provider 面板 */
import RealLLMProviderPanel from './components/RealLLMProviderPanel';

/**
 * 对话消息类型定义（v6.4.0 起从 utils/messageFormatters 引入）
 * 类型 + helper 函数 + 常量已抽离到 ./utils/messageFormatters 和 ./hooks/useToast
 */

export default function App() {
  // ============================================================
  // 状态定义
  // ============================================================

  /** 当前激活的 Session ID（用于后端对话关联） */
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  /** 左侧边栏是否展开（默认展开） */
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  /** v6.36.0 P2-1：移动端响应式检测 */
  const isMobile = useIsMobile();
  /** v6.36.0 P2-1：移动端 Sidebar 抽屉开关状态 */
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  /** v3.0.0：应用模式（null=未选择，chat=日常办公闲聊，coding=编程模式） */
  const [appMode, setAppMode] = useState<'chat' | 'coding' | null>(null);
  /** 智能体列表（子 CLI 实例） */
  const { agents, loading, refetch: refetchAgents } = useAgents();
  /** 统计概览 */
  const { stats, refetch: refetchStats } = useStats();
  /** 会话列表（边栏用，serverSessions 来自 useSessions，本地 sessions 用于响应 title 覆盖） */
  const { sessions: serverSessions, loading: sessionsLoading, refetch: refetchSessions } = useSessions('active', appMode ?? undefined);
  /**
   * 本地会话列表（v2.5.0 新增）
   * 作用：作为侧边栏的 source of truth，初始值与 serverSessions 同步；
   *       自动命名 / 手动重命名等本地 title 变更通过该 state 立即反映到 Sidebar，
   *       避免依赖 refetchSessions 的网络往返造成 UI 闪烁
   */
  const [sessions, setSessions] = useState<Session[]>([]);
  /**
   * 同步 serverSessions → 本地 sessions（v2.5.0）
   * 触发时机：初次加载 / refetchSessions() 后 / 切会话列表过滤
   * 注意：此 useEffect 仅在 serverSessions 引用变化时执行，不会覆盖本地 title 写回期间的瞬时更新
   *       （因为 updateSession 完成后 refetchSessions 会再次拉取最新数据，本地 setSessions 仍以最新为准）
   */
  useEffect(() => {
    setSessions(serverSessions);
  }, [serverSessions]);
  /** 展开的智能体卡片 ID */
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  /** 对话消息列表 */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** 消息输入框内容 */
  const [inputValue, setInputValue] = useState('');
  /** 是否正在等待 Hermes 回复 */
  const [isSending, setIsSending] = useState(false);
  /**
   * Toast 通知：v6.4.0 起从 useToast hook 统一管理
   * - toastVisible: 是否可见
   * - toastMessage: 消息文本
   * - toastType: 弹窗类型
   * - showToast(msg, type): 触发显示，2.4s 自动消失
   * - handleToastClose: 手动关闭回调
   */
  /**
   * v6.35.0 P1-7：Toast 通知（升级到多 Toast 队列 + 撤销按钮）
   * 返回字段：
   *   - visible: 是否可见（兼容旧 API，反映最新一条）
   *   - message: 提示文本（兼容旧 API，反映最新一条）
   *   - type: 提示类型（兼容旧 API，反映最新一条）
   *   - showToast(msg, type): 触发普通提示，2.4s 自动消失
   *   - showToastWithAction(msg, label, onAction): 触发带操作按钮的提示（撤销/重试/查看等）
   *   - hideToast: 手动关闭最新一条
   *   - dismissToast(id): 关闭指定 ID 的 Toast
   *   - toasts: 当前所有 Toast 队列（用于 ToastContainer 渲染）
   */
  const { showToast, showToastWithAction, dismissToast, toasts } = useToast();

  /**
   * v6.37.0 P2-2：全局快捷键注册
   * - Cmd/Ctrl+N: 新建对话
   * - Cmd/Ctrl+B: 切换 Sidebar 展开
   * - Cmd/Ctrl+/: 显示快捷键帮助
   * - Esc: 关闭移动端 Sidebar 抽屉
   */
  useShortcut(
    'new-chat',
    COMMON_SHORTCUTS.NEW_CHAT,
    () => {
      handleNewTask();
    },
    { description: '新建对话', priority: 5 }
  );

  useShortcut(
    'toggle-sidebar',
    COMMON_SHORTCUTS.TOGGLE_SIDEBAR,
    () => {
      setSidebarExpanded((prev) => !prev);
    },
    { description: '切换侧边栏', priority: 5 }
  );

  useShortcut(
    'show-shortcuts',
    COMMON_SHORTCUTS.SHOW_SHORTCUTS,
    () => {
      showToastWithAction(
        '快捷键：Cmd+N 新建 / Cmd+B 切换侧栏 / Cmd+I 切换 Composer / Cmd+Enter 提交',
        '查看全部',
        () => {
          // TODO: 打开快捷键帮助面板
          showToast('快捷键帮助面板开发中', 'info');
        },
        { type: 'info', duration: 5000 }
      );
    },
    { description: '显示快捷键帮助', priority: 1 }
  );

  useShortcut(
    'close-mobile-sidebar',
    COMMON_SHORTCUTS.ESCAPE,
    () => {
      if (isMobile && mobileSidebarOpen) {
        setMobileSidebarOpen(false);
      }
    },
    { description: '关闭移动端侧栏抽屉', priority: 10 } // 高优先级
  );

  /**
   * v2.10.4 新增：会话详情 404 回退回调
   * 触发时机：useSessionDetail 检测到后端返回 404（Session 不存在）时
   * 运行步骤：
   *   1. 清除当前激活的 sessionId state（避免后续组件继续引用已失效 ID）
   *   2. 清除 localStorage.current_session_id（永久清理，避免下次启动再次触发 404）
   *   3. 若 appMode 已确定：自动调用 createSession({ mode }) 创建新 Session
   *      成功后：setCurrentSessionId + 写回 localStorage
   *      失败时：console.error + showToast 提示用户刷新页面
   *   4. 整个回退过程对用户**透明**（无 Toast 提示，因 404 是正常的清理场景）
   *   5. 定义位置：必须在 useSessionDetail 调用**之前**（避免 TDZ ReferenceError），
   *      且必须在 showToast **之后**（handleSessionNotFound 内部调用 showToast）
   *   6. 依赖项 [appMode, showToast]：依赖变化时重新创建回调以保证拿到最新值
   */
  const handleSessionNotFound = useCallback(() => {
    // 清除已失效的 localStorage sessionId
    setCurrentSessionId(null);
    try { localStorage.removeItem(LS_CURRENT_SESSION_ID); } catch { /* ignore */ }
    console.debug('Session 404 回退：已清除失效 sessionId');
    // 自动创建新 Session（仅当 appMode 已选择）
    if (appMode) {
      createSession({ mode: appMode })
        .then((s) => {
          setCurrentSessionId(s.id);
          try { localStorage.setItem(LS_CURRENT_SESSION_ID, s.id); } catch { /* ignore */ }
          console.debug('Session 404 回退：已创建新 Session', s.id);
        })
        .catch((e) => {
          console.error('Session 404 回退创建失败：', e);
          showToast('会话初始化失败，请刷新页面重试', 'error');
        });
    }
  }, [appMode, showToast]);
  /**
   * 当前 Session 详情（包含 messages / agents / tasks / conversations）
   * 位置说明（v2.10.4）：从原「状态定义」区下移到此处，原因是 handleSessionNotFound（位于本行上方）
   *   内部引用了 showToast（位于更上方），而 useSessionDetail 又引用 handleSessionNotFound。
   *   必须在 handleSessionNotFound 之后调用，避免 ESLint no-use-before-define。
   *   必须在 sessionDetail 引用（useEffect @ line 310+）之前调用，避免 TDZ ReferenceError。
   * v2.10.4：传入 onNotFound 回调，404 时由 handleSessionNotFound 接管
   *          （清除 localStorage + createSession 自动重建），避免用户卡在空状态
   */
  const { detail: sessionDetail, loading: detailLoading } = useSessionDetail(
    currentSessionId,
    { onNotFound: handleSessionNotFound },
  );
  /** PlanViewer：是否可见 - v6.37.0 P0-1: 新版 Composer Plan Mode 替代旧 PlanViewer */
  const [planVisible, setPlanVisible] = useState(false);
  // 注：planVisible 旧版用于驱动 PlanViewer 弹窗，新版 Composer Plan Mode 集成在
  // ComposerPanel 中（plan/planStage 状态由 useComposer 管理），保留 setPlanVisible
  // 调用以维持旧事件链兼容
  void planVisible;
  /** PlanViewer：计划内容 */
  const [planContent, setPlanContent] = useState('');
  /**
   * v4.3.0 P0-2：从 App.tsx 抽离 11 个面板/弹窗显隐状态到 useModals Hook
   * - 通过本地别名（settingsOpen ↔ settings.open 等）保持所有现有引用不变
   * - 每个面板提供 { open, onOpen, onClose, onToggle } 统一 API
   * - 11 个面板：settings / mcp / compaction / skills / agentsMd / cycle3 /
   *             dualCompaction / rules / usage / fileExplorer / loopV7
   */
  const {
    settings: settingsModal,
    mcp: mcpModal,
    compaction: compactionModal,
    skills: skillsModal,
    agentsMd: agentsMdModal,
    cycle3: cycle3Modal,
    dualCompaction: dualCompactionModal,
    rules: rulesModal,
    usage: usageModal,
    fileExplorer: fileExplorerModal,
    loopV7: loopV7Modal,
    planEditor: planEditorModal,
    hooks: hooksModal,
    subagentMemory: subagentMemoryModal,
    hookChain: hookChainModal,  // v1.4.0 (Cycle 5 P0-6) 新增
    cacheStats: cacheStatsModal,  // v1.5.0 (Cycle 6 P0-7-A) 新增
    streamList: streamListModal,  // v1.6.0 (Cycle 6 P0-7-B) 新增
    oauthConfig: oauthConfigModal,  // v1.7.0 (Cycle 7 P0-8) 新增
    sessionRollout: sessionRolloutModal,  // v1.8.0 (Cycle 7 P0-9) 新增
    multiAgentTree: multiAgentTreeModal,  // v1.9.0 (Cycle 7 P0-10) 新增
    traceRule: traceRuleModal,  // v2.0.0 (Cycle 7 P0-11) 新增
    slashCommand: slashCommandModal,  // v2.1.0 (Cycle 8 P0-12) 新增
    customModels: customModelsModal,  // v2.2.0 (Cycle 8 P0-14) 新增
  } = useModals();

  /** v4.3.0 别名：全局设置面板开关（保持原 settingsOpen 引用不变） */
  const settingsOpen = settingsModal.open;
  const setSettingsOpen = settingsModal.onOpen;
  const closeSettings = settingsModal.onClose;
  /** v4.3.0 别名：MCP 工具面板 */
  const mcpPanelOpen = mcpModal.open;
  const setMcpPanelOpen = mcpModal.onOpen;
  const closeMcpPanel = mcpModal.onClose;
  /** v4.3.0 别名：会话压缩面板 */
  const compactionPanelOpen = compactionModal.open;
  const setCompactionPanelOpen = compactionModal.onOpen;
  const closeCompactionPanel = compactionModal.onClose;
  /** v4.3.0 别名：技能管理面板 */
  const skillsPanelOpen = skillsModal.open;
  const setSkillsPanelOpen = skillsModal.onOpen;
  const closeSkillsPanel = skillsModal.onClose;
  /** v4.3.0 别名：AGENTS.md 记忆面板 */
  const agentsMdPanelOpen = agentsMdModal.open;
  const setAgentsMdPanelOpen = agentsMdModal.onOpen;
  const closeAgentsMdPanel = agentsMdModal.onClose;
  /** v4.3.0 别名：Cycle 3 MCP 高级功能面板 */
  const cycle3PanelOpen = cycle3Modal.open;
  const setCycle3PanelOpen = cycle3Modal.onOpen;
  const closeCycle3Panel = cycle3Modal.onClose;
  /** v4.3.0 别名：双触发压缩面板 */
  const dualCompactionOpen = dualCompactionModal.open;
  const setDualCompactionOpen = dualCompactionModal.onOpen;
  const closeDualCompactionPanel = dualCompactionModal.onClose;
  /** v4.3.0 别名：多类型规则扫描面板 */
  const rulesPanelOpen = rulesModal.open;
  const setRulesPanelOpen = rulesModal.onOpen;
  const closeRulesPanel = rulesModal.onClose;
  /** v4.3.0 别名：用量监控面板（保持 setShowUsagePanel 切换语义） */
  const showUsagePanel = usageModal.open;
  const setShowUsagePanel = usageModal.onToggle;
  /** v4.3.0 别名：文件浏览器面板（默认 true，由 useModals 初始化） */
  const fileExplorerOpen = fileExplorerModal.open;
  const setFileExplorerOpen = fileExplorerModal.onToggle;
  /** v4.3.0 别名：Loop V7 Runner 弹窗 */
  const showLoopV7Runner = loopV7Modal.open;
  const setShowLoopV7Runner = loopV7Modal.onOpen;
  const closeLoopV7Runner = loopV7Modal.onClose;
  /** v6.13.0 (Cycle 4 P0-3) 别名：Plan 编辑器弹窗 */
  const planEditorOpen = planEditorModal.open;
  const setPlanEditorOpen = planEditorModal.onOpen;
  const closePlanEditor = planEditorModal.onClose;
  /** v6.14.0 (Cycle 4 P0-4) 别名：Hooks 事件系统面板 */
  const hooksPanelOpen = hooksModal.open;
  const setHooksPanelOpen = hooksModal.onOpen;
  const closeHooksPanel = hooksModal.onClose;
  /** v6.15.0 (Cycle 4 P0-4) 别名：SubAgent 记忆查看器面板 */
  const subagentMemoryPanelOpen = subagentMemoryModal.open;
  const setSubagentMemoryPanelOpen = subagentMemoryModal.onOpen;
  const closeSubagentMemoryPanel = subagentMemoryModal.onClose;

  /** 消息列表容器引用，用于自动滚动到底部 */
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** 输入框 ref（v2.9.0 新增 - Task 5：贴底浮动输入区，需要 focus 控制） */
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** AbortController 引用（v3.3.0 新增），用于停止按钮中断 fetch 请求 */
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 流式消息状态 */
  const [streamingStatus, setStreamingStatus] = useState<'thinking' | 'answering' | 'done' | null>(null);
  /** 当前流式消息的 ID */
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  /** 思考内容（实时累积） */
  const [thinkingContent, setThinkingContent] = useState('');
  // v4.2.0 新增：分阶段推理状态（P1-4 补齐）
  // 阶段：'analysis' | 'planning' | 'coding' | 'testing' | 'idle'
  type ReasoningStage = 'analysis' | 'planning' | 'coding' | 'testing' | 'idle';
  const [reasoningStage, setReasoningStage] = useState<ReasoningStage>('idle');
  const [stageProgress, setStageProgress] = useState(0);
  /** 最新一条消息的 ID（用于触发呼吸高光动画） */
  const lastMessageIdRef = useRef<string | null>(null);
  /** v2.10.0：当前选中的项目名称（编程模式下使用） */
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  /** v2.10.0：当前打开的文件路径（编程模式下使用） */
  const [openedFile, setOpenedFile] = useState<string | null>(null);
  // v4.3.0：fileExplorerOpen 已迁移至 useModals.fileExplorer
  // const [fileExplorerOpen, setFileExplorerOpen] = useState(true); // 由 useModals 默认 true

  /**
   * v3.1.0：需求澄清数据（由 clarify_questions SSE 事件返回并解析）
   * v3.6.0：扩展 options（候选选项）/ allowMultiple（是否多选）字段，承载结构化交互数据
   */
  const [clarificationData, setClarificationData] = useState<{
    questions: Array<{ dimension: string; question: string; importance: string; options?: string[]; allowMultiple?: boolean }>;
    roundNumber: number;
    maxRounds: number;
    isComplete: boolean;
    summary: string;
  } | null>(null);

  // v4.3.0：showClarifyModal 保留为 useState（不属于 useModals 管理的 11 个标准面板，
  //   是业务专属的澄清阶段弹窗控制）
  /** v3.6.0：控制 ClarificationModal 显示/隐藏 */
  const [showClarifyModal, setShowClarifyModal] = useState(false);

  // v4.3.0：showLoopV7Runner 已迁移至 useModals.loopV7
  // const [showLoopV7Runner, setShowLoopV7Runner] = useState(false); // 由 useModals 管理

  /**
   * v5.9.0 新增（Task A2 - 按钮反馈）：API 触发按钮加载态
   * 作用：API 调用进行时禁用对应按钮 + 展示加载指示，避免重复点击
   */
  /** 新建任务按钮加载态（handleNewTask 进行中） */
  const [isNewTaskLoading, setIsNewTaskLoading] = useState(false);
  /** 删除/批量删除按钮加载态（handleDeleteSession / handleBatchDelete 进行中） */
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  /** 确认计划按钮加载态（handleConfirmPlan 进行中） */
  const [isConfirmPlanLoading, setIsConfirmPlanLoading] = useState(false);

  // ============================================================
  // v1.9.0：Loop Engineering 工作流展示数据状态
  // ============================================================

  /** 评审报告数据 */
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  /** 流水线进度数据 */
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  /** Goal 进度数据 */
  const [goalData, setGoalData] = useState<GoalData | null>(null);

  // ============================================================
  // 架构设计批判迭代阶段状态（v2.0.0 新增）
  // ============================================================

  /** 架构设计模态弹窗数据 */
  const [designModalData, setDesignModalData] = useState<{
    requirementV2: string;
    critiqueResult: import('./components/ArchitectureDesignModal').CritiqueResultData | null;
    iterationCount: number;
    maxIterations: number;
  } | null>(null);

  /** 控制 ArchitectureDesignModal 显示/隐藏 */
  const [showDesignModal, setShowDesignModal] = useState(false);

  /** 架构设计阶段是否正在加载 */
  const [isDesignLoading, setIsDesignLoading] = useState(false);

  /** v3.1.0：Loop Engineering 工作流状态（用于检测 clarifying 等阶段） */
  const [workflowStatus, setWorkflowStatus] = useState<LoopWorkflowStatus | null>(null);

  /**
   * v2.0.3 修复：用 useRef 存储 workflow_id，避免 JSX 内联 onConfirm 闭包捕获 null
   * sessionDetail 和 workflowStatus 均为异步加载，闭包可能捕获到 null 导致 API 静默失败
   */
  const workflowIdRef = useRef<string | null | undefined>();
  useEffect(() => {
    workflowIdRef.current = sessionDetail?.session?.workflow_id;
  }, [sessionDetail?.session?.workflow_id]);

  // v5.6.0 修复（Bug：跳过不确定项按钮无防重入）：单次点击只发起一次请求，
  //   防止快速双击/多次点击导致后端 confirming→designing 推进与 designing→prompting
  //   校验失败的问题
  const skipConfirmInFlightRef = useRef<boolean>(false);

  /**
   * v6.10.0 P0-2：从 ClarificationModal / onConfirm 解包到此处统一管理
   * 单次点击只发起一次 /clarify/confirm 请求，防止快速双击/多次点击导致后端
   *   confirming→designing 推进与 designing→prompting 校验失败的问题
   * 失败时保持弹窗打开（让用户继续编辑或重试）
   */
  const handleConfirmClarificationFromModal = useCallback(async (wfId?: string) => {
    if (skipConfirmInFlightRef.current) return;
    const id = wfId || workflowIdRef.current || workflowStatus?.workflow_id;
    if (!id) {
      showToast('工作流 ID 缺失，请稍后重试', 'error');
      return;
    }
    skipConfirmInFlightRef.current = true;
    try {
      const baseUrl = window.location.origin;
      const res = await fetch(`${baseUrl}/api/workflow/${id}/clarify/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (!data.success) {
        console.warn('确认需求文档失败:', data.message);
        showToast(data.message || '确认失败，请重试', 'error');
        return; // 保持弹窗打开
      }
      setShowClarifyModal(false);
      refetchSessions();
      // 启动架构设计阶段
      setTimeout(() => handleStartDesignPhase(), 500);
    } catch (e) {
      console.error('确认需求文档异常:', e);
      showToast('网络异常，请重试', 'error');
    } finally {
      skipConfirmInFlightRef.current = false;
    }
  }, [workflowStatus?.workflow_id, showToast, refetchSessions]);

  // v5.9.0 新增（Task A2 - 请求防抖）：handleSendMessage 300ms 防重入守卫，
  //   防止快速双击 Enter / 双击发送按钮导致重复发起流式请求
  const sendInFlightRef = useRef<boolean>(false);

  // v3.9.0 修复：澄清完成时强制弹窗（防御运行时状态竞争）
  // v3.10.0 修复：仅当工作流仍在 clarifying 阶段时才弹窗
  useEffect(() => {
    if (clarificationData?.isComplete && (workflowStatus?.current_stage === 'clarifying' || !workflowStatus)) {
      setShowClarifyModal(true);
    }
  }, [clarificationData?.isComplete, workflowStatus?.current_stage]);

  // ============================================================
  // 副作用：会话生命周期
  // ============================================================

  /**
   * v3.0.0：启动时检查 localStorage
   * 运行步骤：
   *   1. 读取 localStorage.app_mode
   *   2. 若有有效值（'chat' 或 'coding'），直接设为 appMode
   *   3. 若没有，appMode 保持 null → 渲染 ModeSelector 等待用户选择
   */
  useEffect(() => {
    let storedMode: string | null = null;
    try { storedMode = localStorage.getItem(LS_APP_MODE); } catch { /* Safari 隐私模式等异常场景静默降级 */ }
    if (storedMode === 'chat' || storedMode === 'coding') {
      setAppMode(storedMode);
    }
  }, []);

  // V4.4.1: 页面关闭 / 刷新时自动清理空会话（message_count=0），防止累积未使用的新对话
  // v3.7.0: 优先使用 navigator.sendBeacon(POST)，避免 beforeunload fetch keepalive 被浏览器标记为 ERR_ABORTED
  useEffect(() => {
    const cleanup = () => {
      const url = `${window.location.origin}/api/sessions/cleanup-empty`;
      if (navigator.sendBeacon) {
        try {
          const ok = navigator.sendBeacon(url, new Blob([], { type: 'application/json' }));
          if (ok) return;
        } catch {
          // sendBeacon 失败时降级到 fetch keepalive
        }
      }
      fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
    };
    window.addEventListener('beforeunload', cleanup);
    return () => window.removeEventListener('beforeunload', cleanup);
  }, []);

  /**
   * 启动时检查 localStorage 中的 current_session_id
   * 运行步骤：
   *   1. 仅当 appMode 已确定后才初始化会话（避免在模式选择前创建会话）
   *   2. 读取 localStorage.current_session_id
   *   3. 若有值：直接设为 currentSessionId，触发详情加载
   *   4. 若无：自动调用 createSession() 创建空会话，写入 localStorage
   *   5. 若已有值但接口返回 404（Session 已删除）：回退创建新 Session
   */
  useEffect(() => {
    if (!appMode) return; // 等待用户选择模式后再初始化会话
    let stored: string | null = null;
    try { stored = localStorage.getItem(LS_CURRENT_SESSION_ID); } catch { /* 静默降级 */ }
    if (stored) {
      setCurrentSessionId(stored);
    } else {
      // 自动创建新会话，传递当前 appMode
      createSession({ mode: appMode })
        .then((s) => {
          setCurrentSessionId(s.id);
          try { localStorage.setItem(LS_CURRENT_SESSION_ID, s.id); } catch { /* 静默降级 */ }
        })
        .catch((e) => {
          console.error('自动创建 Session 失败：', e);
          showToast('会话初始化失败，请刷新页面重试', 'error');
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode]);

  /**
   * v5.7.0 (Cycle 7 P1-2)：URL 状态同步 - 从 URL 推断 appMode / currentSessionId / selectedProject
   * 运行步骤：
   *   1. 读取 useLocation() 路径 + useParams() 参数
   *   2. 根据路径前缀 /chat/* 或 /coding/* 推断 appMode
   *   3. 根据 :sessionId 或 :projectId 参数同步 currentSessionId / selectedProject
   *   4. 仅当 state 实际需要变化时才 setState，避免不必要的重渲染
   * 触发时机：URL 变化时（包括浏览器前进/后退）
   * 设计目的：让路由系统与 App.tsx 状态完全双向同步，支持深链与分享
   */
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    const path = location.pathname;
    // 推断 appMode
    let urlMode: 'chat' | 'coding' | null = null;
    if (path.startsWith('/chat')) urlMode = 'chat';
    else if (path.startsWith('/coding')) urlMode = 'coding';

    // 同步 appMode（仅当 URL 明确指示模式时）
    if (urlMode && urlMode !== appMode) {
      setAppMode(urlMode);
      try { localStorage.setItem(LS_APP_MODE, urlMode); } catch { /* ignore */ }
    }

    // 同步 currentSessionId
    const urlSessionId = (params as { sessionId?: string }).sessionId;
    if (urlSessionId && urlSessionId !== currentSessionId) {
      setCurrentSessionId(urlSessionId);
      try { localStorage.setItem(LS_CURRENT_SESSION_ID, urlSessionId); } catch { /* ignore */ }
    }

    // 同步 selectedProject
    const urlProjectId = (params as { projectId?: string }).projectId;
    if (urlProjectId && urlProjectId !== selectedProject) {
      setSelectedProject(urlProjectId);
    }
  }, [location.pathname, params]);

  /**
   * v5.7.0 (Cycle 7 P1-2)：State → URL 同步（仅首次启动 + mode 切换时）
   * 运行步骤：
   *   1. 当 appMode 从 null → 'chat'/'coding' 时，自动 navigate 到对应路径
   *   2. 当 URL 是 / 时，根据 appMode 重定向到 /chat 或 /coding
   *   3. 不在每次 currentSessionId 变化时都同步（避免覆盖 /chat/new 路径）
   * 触发时机：appMode 变化
   * 设计目的：让首次选择模式后 URL 自动反映当前视图
   */
  useEffect(() => {
    // 跳过路径不以 / 开头的场景（如 Modal 渲染等）
    if (!location.pathname.startsWith('/')) return;

    // 当前在根路径或 /select-mode，根据 appMode 跳转
    if ((location.pathname === '/' || location.pathname === '/select-mode') && appMode) {
      if (appMode === 'chat') {
        navigate('/chat/new', { replace: true });
      } else if (appMode === 'coding') {
        navigate('/coding/new', { replace: true });
      }
    }
  }, [appMode]);

  /**
   * 切换 Session 时把 last_active_at 推到当前时间
   * 仅在切到历史会话时触发，避免重复刷新 currentSession
   */
  useEffect(() => {
    if (!currentSessionId) return;
    // 静默更新 last_active_at（失败不影响 UI）
    updateSession(currentSessionId, { last_active_at: new Date().toISOString() })
      .catch(() => { /* ignore */ });
  }, [currentSessionId]);

  /**
   * sessionDetail 变化时，将 messages 同步为详情中的对话历史
   * 映射规则：
   *   - Message.role='user' / 'assistant' / 'system' 全部并入
   *   - 仅渲染 role='user' / 'assistant' 到主对话区（system 忽略）
   *   - 思考内容从 Message.thinking 读取（后端暂存于 metadata.thinking）
   */
  useEffect(() => {
    if (!sessionDetail) return;
    const mapped: ChatMessage[] = sessionDetail.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        id: m.id,
        role: m.role === 'user' ? 'user' : 'hermes',
        content: m.content || '',
        // 后端可能将 thinking 存到 metadata.thinking（兼容旧数据）
        thinking: m.thinking || (m as unknown as { metadata?: { thinking?: string } }).metadata?.thinking,
        timestamp: new Date(m.created_at).getTime(),
      }));
    setMessages(mapped);
    // 切到历史会话时收起 PlanViewer
    setPlanVisible(false);
    setPlanContent('');
    // v1.9.0：切会话时清空工作流展示数据，避免残留旧数据
    setReviewData(null);
    setPipelineData(null);
    setGoalData(null);
    setClarificationData(null);
  }, [sessionDetail]);

  /**
   * v3.5.0：根据当前会话关联的 workflow_id 拉取工作流状态
   * 运行步骤：
   *   1. 当 currentSessionId 或 sessionDetail 变化时触发
   *   2. 从 sessionDetail.session.workflow_id 读取工作流 ID
   *   3. 若存在有效 workflow_id：调用 fetchWorkflowStatus 拉取状态并 setWorkflowStatus
   *      - 用 cancelled 标记防止异步竞态（快速切换会话时丢弃过期响应）
   *      - 请求失败时回退 setWorkflowStatus(null)，不阻塞 UI
   *   4. 若无 workflow_id：直接 setWorkflowStatus(null)，关闭 clarifying 分流
   * 设计目的：使 workflowStatus 不再恒为 null，让 clarifying 阶段消息分流逻辑生效
   */
  useEffect(() => {
    // 取出当前会话关联的工作流 ID（后端 SessionResponse v2.1.0 起透传该字段）
    const wfId = sessionDetail?.session?.workflow_id;
    if (!wfId) {
      // 无关联工作流：清空状态，后续消息走通用聊天逻辑
      setWorkflowStatus(null);
      return;
    }
    // 竞态保护标记：effect 清理时置 true，丢弃过期的异步结果
    let cancelled = false;
    fetchWorkflowStatus(wfId)
      .then((status) => {
        if (!cancelled) setWorkflowStatus(status);
      })
      .catch((e) => {
        // 拉取失败（404 / 网络异常等）：回退为 null，不阻塞会话使用
        if (!cancelled) {
          console.warn('拉取工作流状态失败：', e);
          setWorkflowStatus(null);
        }
      });
    return () => { cancelled = true; };
  }, [currentSessionId, sessionDetail]);

  // ============================================================
  // 副作用：消息流与滚动
  // ============================================================

  /** 新消息到达时自动滚动到底部 */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * 监听消息列表变化，记录最新一条消息的 ID
   * 运行步骤：
   *   1. 当 messages 数组长度变化时，获取最后一条消息的 id
   *   2. 将 id 写入 lastMessageIdRef
   *   3. 渲染时如 message.id === lastMessageIdRef.current 则附加 msg-breath 类
   * 注意：仅在新消息出现时触发（历史消息不会带呼吸高光）
   */
  useEffect(() => {
    if (messages.length > 0) {
      lastMessageIdRef.current = messages[messages.length - 1].id;
    }
  }, [messages]);

  // ============================================================
  // 事件处理函数
  // ============================================================

  /**
   * 关闭 Toast 通知（v6.4.0 起改用 useToast hook 提供的 hideToast）
   * 此处保留变量引用一致性：handleToastClose 由 useToast() 的 hideToast 提供。
   */

  /**
   * 切换侧边栏展开/折叠
   */
  const handleToggleSidebar = useCallback(() => {
    setSidebarExpanded(prev => !prev);
  }, []);

  /**
   * v3.0.0：ModeSelector 模式选择回调
   * 运行步骤：
   *   1. 将选中的 mode 写入 localStorage
   *   2. 设置 appMode → 触发会话初始化
   */
  const handleModeSelect = useCallback((mode: 'chat' | 'coding') => {
    try { localStorage.setItem(LS_APP_MODE, mode); } catch { /* 静默降级 */ }
    setAppMode(mode);
  }, []);

  /**
   * v3.0.0：Sidebar 模式切换回调
   * 运行步骤：
   *   1. 新 mode 写入 localStorage
   *   2. 设置 appMode → useSessions 自动 refetch 带新 mode 过滤
   *   3. 加载新模式下最近一条 Session（若存在）
   */
  const handleModeSwitch = useCallback((mode: 'chat' | 'coding') => {
    if (mode === appMode) return; // 同一模式不重复切换
    try { localStorage.setItem(LS_APP_MODE, mode); } catch { /* 静默降级 */ }
    setAppMode(mode);
    // 加载新模式下最近一条会话
    // useSessions 的 mode 参数变化后会自动 refetch，
    // 在 sessions 更新后从列表中取最近一条切换
    // 此处先清空当前会话，避免旧模式残留
    setCurrentSessionId(null);
    try { localStorage.removeItem(LS_CURRENT_SESSION_ID); } catch { /* 静默降级 */ }
    setMessages([]);
    setPlanVisible(false);
    setPlanContent('');
    setExpandedAgentId(null);
  }, [appMode]);

  /**
   * v2.10.2 新增：ProjectSelector "← 返回模式选择" 回调
   * 运行步骤：
   *   1. 清空 appMode（触发 ModeSelector 重新渲染）
   *   2. 清空 selectedProject + openedFile（避免下次进入编程模式时残留旧项目）
   *   3. 清理 localStorage['app_mode']，下次启动仍需重新选择模式
   *   4. Toast 提示用户已返回
   * 注意：与 handleModeSwitch 不同，本回调**清空** selectedProject/openedFile
   *       （用户明确选择返回模式选择 → 旧项目状态不应保留）
   */
  const handleBackToModeSelect = useCallback(() => {
    setAppMode(null);
    setSelectedProject(null);
    setOpenedFile(null);
    try { localStorage.removeItem(LS_APP_MODE); } catch { /* ignore */ }
    showToast('已返回模式选择', 'info');
  }, []);

  /**
   * v2.10.2 新增：ProjectSelector "💬 切换到聊天模式" 回调
   * 运行步骤：
   *   1. 设置 appMode='chat'（触发主界面渲染）
   *   2. 写入 localStorage['app_mode']='chat'
   *   3. **保留** selectedProject / openedFile / currentSessionId
   *      （用户切回编程模式时，可恢复原项目）
   * 注意：与 handleModeSwitch 不同，本回调**不**清空 selectedProject/openedFile
   *       与 currentSessionId，便于用户快速在两模式间切换
   */
  const handleSwitchToChat = useCallback(() => {
    setAppMode('chat');
    try { localStorage.setItem(LS_APP_MODE, 'chat'); } catch { /* ignore */ }
  }, []);

  /**
   * 选择历史会话
   * 运行步骤：
   *   1. 更新 currentSessionId
   *   2. 写入 localStorage
   *   3. useSessionDetail 自动根据 id 变化拉取新详情
   */
  const handleSelectSession = useCallback((id: string) => {
    if (id === currentSessionId) return;
    setCurrentSessionId(id);
    try { localStorage.setItem(LS_CURRENT_SESSION_ID, id); } catch { /* 静默降级 */ }
  }, [currentSessionId]);

  /**
   * 新建任务（强制创建新 Session）
   * 运行步骤：
   *   0. v2.7.0 新增：当 messages 为空时直接返回，禁止重复创建空会话
   *   1. 调用 createSession() 创建空 Session
   *   2. 切换 currentSessionId
   *   3. 写入 localStorage
   *   4. 清空当前消息与 PlanViewer
   *   5. 刷新边栏会话列表
   */
  const handleNewTask = useCallback(async () => {
    if (!appMode) return;
    // v5.9.0：防重入 + 按钮加载态
    if (isNewTaskLoading) return;
    setIsNewTaskLoading(true);
    try {
      const newSession = await createSession({ mode: appMode });
      setCurrentSessionId(newSession.id);
      try { localStorage.setItem(LS_CURRENT_SESSION_ID, newSession.id); } catch { /* 静默降级 */ }
      setMessages([]);
      setPlanVisible(false);
      setPlanContent('');
      setExpandedAgentId(null);
      // 刷新边栏列表
      refetchSessions();
    } catch (e) {
      showToast(`新建任务失败：${(e as Error).message}`, 'error');
    } finally {
      setIsNewTaskLoading(false);
    }
  }, [appMode, refetchSessions, showToast, isNewTaskLoading]);

  /**
   * v5.7.0：打开 Loop v7 端到端工作流弹窗
   * 调用方：BrandHeader 三个点下拉菜单中的"🚀 Loop v7 工作流"项
   * 行为：通过 useModals.loopV7.onOpen() 弹出 LoopV7Runner 端到端运行器
   */
  const handleOpenLoopV7 = useCallback(() => {
    setShowLoopV7Runner();
  }, [setShowLoopV7Runner]);

  /**
   * v5.15.0 (Cycle 9 P1-7) 新增：跳转 DiffView 增强页
   * 调用方：BrandHeader 菜单中的"📋 DiffView 增强"项
   * 行为：调用 useNavigate 跳转到 /diff-view 路由
   *       URL 携带 ?project= 参数（如有选中项目则透传）
   */
  const handleOpenDiffView = useCallback(() => {
    try {
      const projectPath = (() => {
        try {
          return localStorage.getItem('diffview.projectPath') || undefined;
        } catch {
          return undefined;
        }
      })();
      const url = projectPath
        ? `/diff-view?project=${encodeURIComponent(projectPath)}`
        : '/diff-view';
      navigate(url);
    } catch (e) {
      // 兜底：使用 location.href 跳转
      window.location.href = '/diff-view';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 10 P1-8) 新增：跳转 Memory System 长期记忆管理页
   * 调用方：BrandHeader 菜单中的"🧠 Memory System"项
   * 行为：调用 useNavigate 跳转到 /memory 路由
   */
  const handleOpenMemory = useCallback(() => {
    try {
      navigate('/memory');
    } catch (e) {
      window.location.href = '/memory';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 10 P1-10) 新增：打开 Verification Loop 验证闭环页面
   * 调用方：BrandHeader 菜单中的"🔁 Verification Loop"项
   * 行为：调用 useNavigate 跳转到 /verification 路由
   */
  const handleOpenVerification = useCallback(() => {
    try {
      navigate('/verification');
    } catch (e) {
      window.location.href = '/verification';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 11 P2-2) 新增：Doctor 环境诊断入口
   */
  const handleOpenDoctor = useCallback(() => {
    try {
      navigate('/doctor');
    } catch (e) {
      window.location.href = '/doctor';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 13 P1-2) 新增：LLM-as-Judge 验证层入口
   */
  const handleOpenLlmJudge = useCallback(() => {
    try {
      navigate('/llm-judge');
    } catch (e) {
      window.location.href = '/llm-judge';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 13 P1-3) 新增：Plugin Marketplace 入口
   */
  const handleOpenMarketplace = useCallback(() => {
    try {
      navigate('/marketplace');
    } catch (e) {
      window.location.href = '/marketplace';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 14 P0-2) 新增：多模态支持入口
   */
  const handleOpenMultimodal = useCallback(() => {
    try {
      navigate('/multimodal');
    } catch (e) {
      window.location.href = '/multimodal';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 14 P0-3) 新增：企业级 Plugin Hub 入口
   */
  const handleOpenEnterpriseHub = useCallback(() => {
    try {
      navigate('/enterprise-hub');
    } catch (e) {
      window.location.href = '/enterprise-hub';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 14 P1-3) 新增：TRAE Work 多模态协作入口
   */
  const handleOpenTraeWork = useCallback(() => {
    try {
      navigate('/work');
    } catch (e) {
      window.location.href = '/work';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 14 P1-4) 新增：Goal Automation 入口
   * 功能：自动轮转 + Agent 注册表 + 委派任务三合一
   */
  const handleOpenGoalAutomation = useCallback(() => {
    try {
      navigate('/goal-automation');
    } catch (e) {
      window.location.href = '/goal-automation';
    }
  }, [navigate]);

  /**
   * v1.0.0 (Cycle 14 P1-5) 新增：Goal Templates 模板库入口
   * 功能：6 类内置模板 + Fork + 一键实例化为 Goal
   */
  const handleOpenGoalTemplates = useCallback(() => {
    try {
      navigate('/goal-templates');
    } catch (e) {
      window.location.href = '/goal-templates';
    }
  }, [navigate]);

  /**
   * v6.36.0 (Cycle 16 P0-1) 新增：Composer 多文件编辑面板开关状态
   * 作用：控制右侧浮动面板显隐，Cmd/Ctrl+I 也可切换
   */
  const [composerOpen, setComposerOpen] = useState(false);
  const handleOpenComposer = useCallback(() => {
    setComposerOpen((prev) => !prev);
  }, []);

  // v6.36.0：监听全局 Cmd/Ctrl+I 快捷键切换 Composer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'i' && !e.shiftKey) {
        // 避免在输入框/textarea 中误触（用户输入 i）
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        setComposerOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /**
   * v6.41.0 (Cycle 19 P0-1) 新增：后台任务面板开关状态
   * 作用：控制 BackgroundTasksPanel 弹窗显隐
   *       任务通过 BackgroundTaskEngine 单例管理，无需传递 props
   */
  const [backgroundTasksOpen, setBackgroundTasksOpen] = useState(false);
  const handleOpenBackgroundTasks = useCallback(() => {
    setBackgroundTasksOpen((prev) => !prev);
  }, []);

  /**
   * v6.42.0 (Cycle 19 P0-2) 新增：Best-of-N 多模型对比面板开关状态
   * 作用：控制 BestOfNPanel 弹窗显隐
   *       候选通过 MultiModelExecutor 单例管理
   */
  const [bestOfNOpen, setBestOfNOpen] = useState(false);
  const handleOpenBestOfN = useCallback(() => {
    setBestOfNOpen((prev) => !prev);
  }, []);

  /**
   * v6.43.0 (Cycle 19 P0-3) 新增：Design Mode 设计模式覆盖层开关状态
   * 作用：控制 DesignModeOverlay 覆盖层显隐
   *       设计模式通过 DesignModeController 单例管理
   */
  const [designModeOpen, setDesignModeOpen] = useState(false);
  const handleOpenDesignMode = useCallback(() => {
    setDesignModeOpen((prev) => !prev);
  }, []);

  /**
   * v6.45.0 (Cycle 20 P0-1) 新增：Git Worktree 隔离管理面板开关状态
   * 作用：控制 WorktreePanel 弹窗显隐
   *       worktree 通过 WorktreeManager 单例管理
   */
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const handleOpenWorktree = useCallback(() => {
    setWorktreeOpen((prev) => !prev);
  }, []);

  /**
   * v6.46.0 (Cycle 20 P0-2) 新增：智能模型路由面板开关状态
   * 作用：控制 ModelRouterPanel 弹窗显隐
   *       路由决策通过 ModelRouter 单例管理
   */
  const [modelRouterOpen, setModelRouterOpen] = useState(false);
  const handleOpenModelRouter = useCallback(() => {
    setModelRouterOpen((prev) => !prev);
  }, []);

  /**
   * v6.47.0 (Cycle 20 P0-3) 新增：事件钩子管理面板开关状态
   * 作用：控制 HooksPanel 弹窗显隐
   *       钩子通过 HooksEngine 单例管理
   */
  const [hooks20Open, setHooks20Open] = useState(false);
  const handleOpenHooks20 = useCallback(() => {
    setHooks20Open((prev) => !prev);
  }, []);

  /**
   * v6.48.0 (Cycle 21 P0-1) 新增：Best-of-N × Worktree 协同面板开关状态
   * 作用：控制 BestOfNCoordinatorPanel 弹窗显隐
   *       协同会话由 BestOfNWorktreeCoordinator 单例管理
   */
  const [bestOfNCoordinatorOpen, setBestOfNCoordinatorOpen] = useState(false);
  const handleOpenBestOfNCoordinator = useCallback(() => {
    setBestOfNCoordinatorOpen((prev) => !prev);
  }, []);

  /**
   * v6.49.0 (Cycle 21 P0-2) 新增：模型路由成本统计 Dashboard 开关状态
   * 作用：控制 ModelRouterStatsPanel 弹窗显隐
   *       统计数据由 ModelCostStatsCollector 单例管理
   */
  const [modelRouterStatsOpen, setModelRouterStatsOpen] = useState(false);
  const handleOpenModelRouterStats = useCallback(() => {
    setModelRouterStatsOpen((prev) => !prev);
  }, []);

  /**
   * v6.50.0 (Cycle 21 P0-4) 新增：Hook 模板市场面板开关状态
   * 作用：控制 HooksMarketplacePanel 弹窗显隐
   *       模板通过 HookTemplateMarketplace 单例管理
   */
  const [hooksMarketplaceOpen, setHooksMarketplaceOpen] = useState(false);
  const handleOpenHooksMarketplace = useCallback(() => {
    setHooksMarketplaceOpen((prev) => !prev);
  }, []);

  /**
   * v6.51.0 (Cycle 22 G22-01) 新增：Side Chat 多子对话面板开关状态
   * 作用：控制 SideChatPanel 弹窗显隐
   *       子对话由 SideChatManager 单例管理
   */
  const [sideChatOpen, setSideChatOpen] = useState(false);
  const handleOpenSideChat = useCallback(() => {
    setSideChatOpen((prev) => !prev);
  }, []);

  /**
   * v6.52.0 (Cycle 22 G22-02) 新增：成本预测面板开关状态
   * 作用：控制 CostPredictionPanel 弹窗显隐
   *       成本预测由 CostPredictor 单例管理
   */
  const [costPredictionOpen, setCostPredictionOpen] = useState(false);
  const handleOpenCostPrediction = useCallback(() => {
    setCostPredictionOpen((prev) => !prev);
  }, []);

  /**
   * v6.53.0 (Cycle 22 G22-03) 新增：Hook 性能分析面板开关状态
   * 作用：控制 HookPerformancePanel 弹窗显隐
   *       性能分析由 HookPerformanceAnalyzer 单例管理
   */
  const [hookPerformanceOpen, setHookPerformanceOpen] = useState(false);
  const handleOpenHookPerformance = useCallback(() => {
    setHookPerformanceOpen((prev) => !prev);
  }, []);

  /**
   * v6.54.0 (Cycle 22 G22-04) 新增：模型路由管理面板开关状态
   * 作用：控制 ModelRouterAdminPanel 弹窗显隐
   *       路由策略由 ModelRouterEnhance 单例管理
   */
  const [modelRouterAdminOpen, setModelRouterAdminOpen] = useState(false);
  const handleOpenModelRouterAdmin = useCallback(() => {
    setModelRouterAdminOpen((prev) => !prev);
  }, []);

  /**
   * v6.55.0 (Cycle 23 G23-01) 新增：候选学习面板开关状态
   * 作用：控制 CandidateLearningPanel 弹窗显隐
   *       学习引擎由 CandidateLearningEngine 单例管理
   */
  const [candidateLearningOpen, setCandidateLearningOpen] = useState(false);
  const handleOpenCandidateLearning = useCallback(() => {
    setCandidateLearningOpen((prev) => !prev);
  }, []);

  /**
   * v6.56.0 (Cycle 23 G23-02) 新增：会话回放面板开关状态
   * 作用：控制 SessionReplayPanel 弹窗显隐
   *       回放引擎由 SessionReplayEngine 单例管理
   */
  const [sessionReplayOpen, setSessionReplayOpen] = useState(false);
  const handleOpenSessionReplay = useCallback(() => {
    setSessionReplayOpen((prev) => !prev);
  }, []);

  /**
   * v6.57.0 (Cycle 23 G23-04) 新增：AI 主动建议面板开关状态
   * 作用：控制 ProactiveSuggestionPanel 弹窗显隐
   *       建议引擎由 ProactiveSuggestionEngine 单例管理
   */
  const [proactiveSuggestionOpen, setProactiveSuggestionOpen] = useState(false);
  const handleOpenProactiveSuggestion = useCallback(() => {
    setProactiveSuggestionOpen((prev) => !prev);
  }, []);

  /**
   * v6.58.0 (Cycle 24 G24-01) 全局记忆面板开关
   * 作用：控制 GlobalMemoryPanel 弹窗显隐
   *       记忆引擎由 GlobalMemoryEngine 单例管理
   */
  const [globalMemoryOpen, setGlobalMemoryOpen] = useState(false);
  const handleOpenGlobalMemory = useCallback(() => {
    setGlobalMemoryOpen((prev) => !prev);
  }, []);

  /**
   * v6.59.0 (Cycle 24 G24-02) 多任务并行编排面板开关
   * 作用：控制 MultiTaskOrchestrationPanel 弹窗显隐
   *       编排器由 MultiTaskOrchestrator 单例管理
   */
  const [multiTaskOpen, setMultiTaskOpen] = useState(false);
  const handleOpenMultiTask = useCallback(() => {
    setMultiTaskOpen((prev) => !prev);
  }, []);

  /**
   * v6.60.0 (Cycle 24 G24-04) Figma 设计稿转代码面板开关
   * 作用：控制 FigmaImportPanel 弹窗显隐
   *       适配器由 FigmaAdapter 单例管理
   */
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  const handleOpenFigmaImport = useCallback(() => {
    setFigmaImportOpen((prev) => !prev);
  }, []);

  /**
   * v6.61.0 (Cycle 25 G25-01) 自动化代码评审面板开关
   * 作用：控制 AutoCodeReviewPanel 弹窗显隐
   *       评审引擎由 AutoCodeReviewEngine 单例管理
   */
  const [autoCodeReviewOpen, setAutoCodeReviewOpen] = useState(false);
  const handleOpenAutoCodeReview = useCallback(() => {
    setAutoCodeReviewOpen((prev) => !prev);
  }, []);

  /**
   * v6.62.0 (Cycle 25 G25-02) PR 自动机器人面板开关
   * 作用：控制 PRBotPanel 弹窗显隐
   *       评审机器人由 PRBotEngine 单例管理
   */
  const [prBotOpen, setPRBotOpen] = useState(false);
  const handleOpenPRBot = useCallback(() => {
    setPRBotOpen((prev) => !prev);
  }, []);

  /**
   * v6.63.0 (Cycle 25 G25-03) AI 性能优化器面板开关
   * 作用：控制 PerfOptimizerPanel 弹窗显隐
   *       优化器由 PerfOptimizerEngine 单例管理
   */
  const [perfOptimizerOpen, setPerfOptimizerOpen] = useState(false);
  const handleOpenPerfOptimizer = useCallback(() => {
    setPerfOptimizerOpen((prev) => !prev);
  }, []);

  /**
   * v6.64.0 (Cycle 26 G26-01) CSV 批处理智能体面板开关
   * 作用：控制 CsvBatchPanel 弹窗显隐
   *       引擎由 CsvBatchEngine 单例管理
   */
  const [csvBatchOpen, setCsvBatchOpen] = useState(false);
  const handleOpenCsvBatch = useCallback(() => {
    setCsvBatchOpen((prev) => !prev);
  }, []);

  /**
   * v6.65.0 (Cycle 26 G26-02) 智能审批引擎面板开关
   * 作用：控制 SmartApprovalPanel 弹窗显隐
   *       引擎由 SmartApprovalEngine 单例管理
   */
  const [smartApprovalOpen, setSmartApprovalOpen] = useState(false);
  const handleOpenSmartApproval = useCallback(() => {
    setSmartApprovalOpen((prev) => !prev);
  }, []);

  /**
   * v6.66.0 (Cycle 26 G26-03) MTC 多模任务协作面板开关
   * 作用：控制 MTCPanel 弹窗显隐
   *       适配器由 MtcAdapter 单例管理
   */
  const [mtcOpen, setMtcOpen] = useState(false);
  const handleOpenMTC = useCallback(() => {
    setMtcOpen((prev) => !prev);
  }, []);

  /**
   * v6.67.0 (Cycle 27 G27-01) 嵌套子代理面板开关
   * 作用：控制 NestedSubAgentPanel 弹窗显隐
   *       引擎由 NestedSubAgentEngine 单例管理，支持 3 层嵌套子代理
   */
  const [nestedSubAgentOpen, setNestedSubAgentOpen] = useState(false);
  const handleOpenNestedSubAgent = useCallback(() => {
    setNestedSubAgentOpen((prev) => !prev);
  }, []);

  /**
   * v6.68.0 (Cycle 27 G27-02) 代理检查点面板开关
   * 作用：控制 AgentCheckpointPanel 弹窗显隐
   *       引擎由 AgentCheckpointEngine 单例管理，支持检查点保存/恢复
   */
  const [agentCheckpointOpen, setAgentCheckpointOpen] = useState(false);
  const handleOpenAgentCheckpoint = useCallback(() => {
    setAgentCheckpointOpen((prev) => !prev);
  }, []);

  /**
   * v6.69.0 (Cycle 27 G27-04) 代理消息面板开关
   * 作用：控制 AgentMessagingPanel 弹窗显隐
   *       引擎由 AgentMessagingEngine 单例管理，支持 send_message/followup_task
   */
  const [agentMessagingOpen, setAgentMessagingOpen] = useState(false);
  const handleOpenAgentMessaging = useCallback(() => {
    setAgentMessagingOpen((prev) => !prev);
  }, []);

  /**
   * v6.70.0 (Cycle 27 G27-05) 代理模板面板开关
   * 作用：控制 AgentTemplatePanel 弹窗显隐
   *       引擎由 AgentTemplateEngine 单例管理，支持 10 个内置模板 + 用户模板
   */
  const [agentTemplateOpen, setAgentTemplateOpen] = useState(false);
  const handleOpenAgentTemplate = useCallback(() => {
    setAgentTemplateOpen((prev) => !prev);
  }, []);

  /**
   * v6.71.0 (Cycle 27 G27-06) 远程控制面板开关
   * 作用：控制 RemoteControlPanel 弹窗显隐
   *       引擎由 RemoteControlEngine 单例管理，支持 QR 配对 + Thread 迁移
   */
  const [remoteControlOpen, setRemoteControlOpen] = useState(false);
  const handleOpenRemoteControl = useCallback(() => {
    setRemoteControlOpen((prev) => !prev);
  }, []);

  /**
   * v6.72.0 (Cycle 28 G28-01) 技能系统面板开关
   * 作用：控制 SkillsPanel 弹窗显隐
   *       引擎由 SkillEngine 单例管理，支持 SKILL.md + 渐进式披露 + 隐式匹配
   */
  const [skillsOpen, setSkillsOpen] = useState(false);
  const handleOpenSkills = useCallback(() => {
    setSkillsOpen((prev) => !prev);
  }, []);

  /**
   * v6.73.0 (Cycle 28 G28-02) 成本预算面板开关
   * 作用：控制 CostBudgetPanel 弹窗显隐
   *       引擎由 CostBudgetEngine 单例管理，支持 fallbackModel + 3层预算
   */
  const [costBudgetOpen, setCostBudgetOpen] = useState(false);
  const handleOpenCostBudget = useCallback(() => {
    setCostBudgetOpen((prev) => !prev);
  }, []);

  /**
   * v6.74.0 (Cycle 28 G28-03) 用量归因面板开关
   * 作用：控制 UsageAttributionPanel 弹窗显隐
   *       引擎由 UsageAttributionEngine 单例管理，支持按 agent/task/model 拆分
   */
  const [usageAttributionOpen, setUsageAttributionOpen] = useState(false);
  const handleOpenUsageAttribution = useCallback(() => {
    setUsageAttributionOpen((prev) => !prev);
  }, []);

  /**
   * v6.75.0 (Cycle 28 G28-04) 作用域权限面板开关
   * 作用：控制 ScopedPermissionsPanel 弹窗显隐
   *       引擎由 ScopedPermissionsEngine 单例管理，支持工具/路径/网络 细粒度控制
   */
  const [scopedPermissionsOpen, setScopedPermissionsOpen] = useState(false);
  const handleOpenScopedPermissions = useCallback(() => {
    setScopedPermissionsOpen((prev) => !prev);
  }, []);

  /**
   * v6.76.0 (Cycle 28 G28-05) 斜杠命令面板开关
   * 作用：控制 SlashCommandPanel 弹窗显隐
   *       引擎由 SlashCommandEngine 单例管理，支持 /init /status /review /plan /goal
   */
  const [slashCommandOpen, setSlashCommandOpen] = useState(false);
  const handleOpenSlashCommand = useCallback(() => {
    setSlashCommandOpen((prev) => !prev);
  }, []);

  /**
   * v6.77.0 (Cycle 29 G29-01) 堆叠技能面板开关
   * 作用：控制 StackedSkillsPanel 弹窗显隐
   *       引擎由 StackedSkillEngine 单例管理，支持一次最多 5 个技能堆叠
   */
  const [stackedSkillsOpen, setStackedSkillsOpen] = useState(false);
  const handleOpenStackedSkills = useCallback(() => {
    setStackedSkillsOpen((prev) => !prev);
  }, []);

  /**
   * v6.78.0 (Cycle 29 G29-02) 技能市场面板开关
   * 作用：控制 MarketplacePanel 弹窗显隐
   *       引擎由 SkillsMarketplace 单例管理，支持浏览/安装/评分/评论
   */
  const [skillsMarketOpen, setSkillsMarketOpen] = useState(false);
  const handleOpenSkillsMarket = useCallback(() => {
    setSkillsMarketOpen((prev) => !prev);
  }, []);

  /**
   * v6.79.0 (Cycle 29 G29-03) 分析聊天面板开关
   * 作用：控制 AnalyticsChatPanel 弹窗显隐
   *       引擎由 AnalyticsChat 单例管理，支持自然语言查询用量数据
   */
  const [analyticsChatOpen, setAnalyticsChatOpen] = useState(false);
  const handleOpenAnalyticsChat = useCallback(() => {
    setAnalyticsChatOpen((prev) => !prev);
  }, []);

  /**
   * v6.83.0 (Cycle 30 G30-01) 成本阈值告警面板开关
   * 作用：控制 CostThresholdAlertPanel 弹窗显隐
   *       引擎由 CostThresholdAlertEngine 单例管理，支持多级阈值、提额申请、强制阻断
   */
  const [costThresholdOpen, setCostThresholdOpen] = useState(false);
  const handleOpenCostThreshold = useCallback(() => {
    setCostThresholdOpen((prev) => !prev);
  }, []);

  /**
   * v6.84.0 (Cycle 30 G30-02) 动态工作流面板开关
   * 作用：控制 DynamicWorkflowPanel 弹窗显隐
   *       引擎由 DynamicWorkflowEngine 单例管理，支持 Phase-based 编排、Journal、Resume/Replay
   */
  const [dynamicWorkflowOpen, setDynamicWorkflowOpen] = useState(false);
  const handleOpenDynamicWorkflow = useCallback(() => {
    setDynamicWorkflowOpen((prev) => !prev);
  }, []);

  /**
   * v6.85.0 (Cycle 30 G30-03) 编排多代理面板开关
   * 作用：控制 OrchestratedAgentPanel 弹窗显隐
   *       引擎由 OrchestratedAgentEngine 单例管理，支持 6 阶段 Orchestrated Mode、角色预设
   */
  const [orchestratedAgentOpen, setOrchestratedAgentOpen] = useState(false);
  const handleOpenOrchestratedAgent = useCallback(() => {
    setOrchestratedAgentOpen((prev) => !prev);
  }, []);

  /**
   * v6.86.0 (Cycle 31 G31-01) 成本归因面板开关
   * 作用：控制 CostAttributionPanel 弹窗显隐
   *       引擎由 CostAttributionEngine 单例管理，支持 org/team/project/repo/user 五维归因
   */
  const [costAttributionOpen, setCostAttributionOpen] = useState(false);
  const handleOpenCostAttribution = useCallback(() => {
    setCostAttributionOpen((prev) => !prev);
  }, []);

  /**
   * v6.87.0 (Cycle 31 G31-02) 远程 Worktree 面板开关
   * 作用：控制 RemoteWorktreePanel 弹窗显隐
   *       引擎由 RemoteWorktreeAdapter 单例管理，支持 local/remote/hybrid 后端抽象
   */
  const [remoteWorktreeOpen, setRemoteWorktreeOpen] = useState(false);
  const handleOpenRemoteWorktree = useCallback(() => {
    setRemoteWorktreeOpen((prev) => !prev);
  }, []);

  /**
   * v6.88.0 (Cycle 31 G31-03) Worktree 状态同步面板开关
   * 作用：控制 WorktreeSyncPanel 弹窗显隐
   *       引擎由 WorktreeSyncEngine 单例管理，支持快照/状态广播/冲突检测/跨设备同步
   */
  const [worktreeSyncOpen, setWorktreeSyncOpen] = useState(false);
  const handleOpenWorktreeSync = useCallback(() => {
    setWorktreeSyncOpen((prev) => !prev);
  }, []);

  /**
   * v6.89.0 (Cycle 32 G32-01) 新增：审计追踪面板
   * 作用：控制 AuditTrailPanel 弹窗显隐
   *       引擎由 AuditTrailEngine 单例管理，支持不可篡改 hash chain + 合规报告（SOC2/ISO27001/GDPR/EU AI Act）
   *       对应 SOC 2 / GDPR / EU AI Act 自动事件记录
   */
  const [auditTrailOpen, setAuditTrailOpen] = useState(false);
  const handleOpenAuditTrail = useCallback(() => {
    setAuditTrailOpen((prev) => !prev);
  }, []);

  /**
   * v6.90.0 (Cycle 32 G32-02) 新增：单点登录面板
   * 作用：控制 SSOPanel 弹窗显隐
   *       引擎由 SSOEngine 单例管理，支持 OIDC/OAuth 2.0/SAML 2.0/SCIM 2.0
   *       对应 Okta/Azure AD/Auth0 企业级身份认证
   */
  const [ssoOpen, setSSOOpen] = useState(false);
  const handleOpenSSO = useCallback(() => {
    setSSOOpen((prev) => !prev);
  }, []);

  /**
   * v6.91.0 (Cycle 32 G32-03) 新增：策略规则面板
   * 作用：控制 PolicyPanel 弹窗显隐
   *       引擎由 PolicyEngine 单例管理，支持 JSON DSL + Rego 子集双语法 + 多维度作用域
   *       对应 OPA / Cerbos / Casbin 企业级统一策略执行
   */
  const [policyOpen, setPolicyOpen] = useState(false);
  const handleOpenPolicy = useCallback(() => {
    setPolicyOpen((prev) => !prev);
  }, []);

  /**
   * v6.94.0 (Cycle 33 G33-01) 新增：企业全场景工作流面板
   * 作用：控制 EnterpriseWorkflowPanel 弹窗显隐
   *       引擎集成 30+ 引擎作为工作流步骤，支持 5 个预置场景（用户入职/代码审查/合规审计/安全应急/日常任务）
   *       声明式 JSON DSL 工作流定义，支持步骤重试/超时/条件分支/并行执行/审批流/子工作流
   *       对应 GitHub Actions / Temporal / Argo Workflows 企业级工作流编排
   */
  const [enterpriseWorkflowOpen, setEnterpriseWorkflowOpen] = useState(false);
  const handleOpenEnterpriseWorkflow = useCallback(() => {
    setEnterpriseWorkflowOpen((prev) => !prev);
  }, []);

  /**
   * v6.94.0 (Cycle 33 G33-02) 新增：集成 Dashboard 面板
   * 作用：控制 UnifiedDashboardPanel 弹窗显隐
   *       聚合 30+ 引擎关键指标，提供 12+ 预置面板（健康度/成本/任务/审计/告警/用户/模型/Worktree/安全/合规/Skill/会话）
   *       实时采集 + 阈值告警 + 多格式导出
   *       对应 Grafana / Datadog / New Relic 企业级统一监控仪表盘
   */
  const [unifiedDashboardOpen, setUnifiedDashboardOpen] = useState(false);
  const handleOpenUnifiedDashboard = useCallback(() => {
    setUnifiedDashboardOpen((prev) => !prev);
  }, []);

  /**
   * v6.94.0 (Cycle 33 G33-03) 新增：安全审计面板
   * 作用：控制 SecurityAuditPanel 弹窗显隐
   *       实现 7 个预置攻击场景（暴力破解/越权访问/数据外泄/会话劫持/权限提升/恶意上传/审计篡改）
   *       自动化执行 + 验证 + 报告 + 应急响应
   *       对应 OWASP ZAP / Burp Suite / Nessus 企业级安全审计与渗透测试
   */
  const [securityAuditOpen, setSecurityAuditOpen] = useState(false);
  const handleOpenSecurityAudit = useCallback(() => {
    setSecurityAuditOpen((prev) => !prev);
  }, []);

  /**
   * v6.97.0 (Cycle 34 G34-01) 新增：端云模型路由面板
   * 作用：控制 EdgeModelRouterPanel 弹窗显隐
   *       端云模型智能路由（Cursor Router 三大优化模式 + Claude Mobile 隐私 Tier + Token Budget）
   *       覆盖 Codex Desktop / Cursor Router / Claude Mobile / Trae Solo 端云协同
   */
  const [edgeModelRouterOpen, setEdgeModelRouterOpen] = useState(false);
  const handleOpenEdgeModelRouter = useCallback(() => {
    setEdgeModelRouterOpen((prev) => !prev);
  }, []);

  /**
   * v6.97.0 (Cycle 34 G34-02) 新增：离线优先工作流面板
   * 作用：控制 OfflineFirstPanel 弹窗显隐
   *       断网检测 + 本地队列 + CRDT 冲突解决 + 引擎降级
   *       对标 Local-First 七大原则 + Trae Solo 离线模式
   */
  const [offlineFirstOpen, setOfflineFirstOpen] = useState(false);
  const handleOpenOfflineFirst = useCallback(() => {
    setOfflineFirstOpen((prev) => !prev);
  }, []);

  /**
   * v6.97.0 (Cycle 34 G34-03) 新增：设备集群管理面板
   * 作用：控制 DeviceClusterPanel 弹窗显隐
   *       多设备发现（mDNS/DNS-SD）+ 任务路由（能力/负载/电量）+ 故障转移
   *       对标 mDNS（IETF RFC 6762/6763）+ Trae Solo 三端协同
   */
  const [deviceClusterOpen, setDeviceClusterOpen] = useState(false);
  const handleOpenDeviceCluster = useCallback(() => {
    setDeviceClusterOpen((prev) => !prev);
  }, []);

  /**
   * v6.98.0 (Cycle 35 G35-01) 新增：工作流编排面板
   * 作用：控制 WorkflowOrchestratorPanel 弹窗显隐
   *       DAG 工作流定义 + 节点执行 + 实例管理 + 执行图可视化
   */
  const [workflowOrchestratorOpen, setWorkflowOrchestratorOpen] = useState(false);
  const handleOpenWorkflowOrchestrator = useCallback(() => {
    setWorkflowOrchestratorOpen((prev) => !prev);
  }, []);

  /**
   * v6.98.0 (Cycle 35 G35-02) 新增：智能体通信面板
   * 作用：控制 AgentCommunicationPanel 弹窗显隐
   *       A2A 协议 + P2P/Pub-Sub/Request-Response 消息 + 订阅管理
   */
  const [agentCommunicationOpen, setAgentCommunicationOpen] = useState(false);
  const handleOpenAgentCommunication = useCallback(() => {
    setAgentCommunicationOpen((prev) => !prev);
  }, []);

  /**
   * v6.98.0 (Cycle 35 G35-03) 新增：任务检查点面板
   * 作用：控制 TaskCheckpointPanel 弹窗显隐
   *       线程管理 + 完整/增量快照 + Time Travel + 分支标签
   */
  const [taskCheckpointOpen, setTaskCheckpointOpen] = useState(false);
  const handleOpenTaskCheckpoint = useCallback(() => {
    setTaskCheckpointOpen((prev) => !prev);
  }, []);

  /**
   * v6.98.0 (Cycle 35 G35-04) 新增：智能体调度面板
   * 作用：控制 AgentSchedulerPanel 弹窗显隐
   *       WFQ/MLFQ/Priority 调度 + 资源池管理 + 抢占控制
   */
  const [agentSchedulerOpen, setAgentSchedulerOpen] = useState(false);
  const handleOpenAgentScheduler = useCallback(() => {
    setAgentSchedulerOpen((prev) => !prev);
  }, []);

  /**
   * v6.107.0 (Cycle 36 G36-01) 新增：LLM Provider 面板
   * 作用：控制 LLMProviderPanel 弹窗显隐
   *       4 大 Provider (Mock/Anthropic/OpenAI/Ollama) + 统一抽象层
   */
  const [llmProviderOpen, setLlmProviderOpen] = useState(false);
  const handleOpenLLMProvider = useCallback(() => {
    setLlmProviderOpen((prev) => !prev);
  }, []);

  /**
   * v6.107.0 (Cycle 36 G36-02) 新增：Streaming Chat 面板
   * 作用：控制 StreamingChatPanel 弹窗显隐
   *       流式响应 + 实时统计 (TTFT/ITPS) + 暂停/恢复
   */
  const [streamingChatOpen, setStreamingChatOpen] = useState(false);
  const handleOpenStreamingChat = useCallback(() => {
    setStreamingChatOpen((prev) => !prev);
  }, []);

  /**
   * v6.107.0 (Cycle 36 G36-03) 新增：Multi-Modal 面板
   * 作用：控制 MultiModalPanel 弹窗显隐
   *       图像/语音/文件处理 + 多模态融合
   */
  const [multiModalOpen, setMultiModalOpen] = useState(false);
  const handleOpenMultiModal = useCallback(() => {
    setMultiModalOpen((prev) => !prev);
  }, []);

  /**
   * v6.108.0 (Cycle 37 G37-01) 新增：RAG 知识库面板
   * 作用：控制 RAGPanel 弹窗显隐
   *       文档管理 + 混合检索 (Vector + BM25) + RRF 融合 + 引用
   */
  const [ragPanelOpen, setRagPanelOpen] = useState(false);
  const handleOpenRAG = useCallback(() => {
    setRagPanelOpen((prev) => !prev);
  }, []);

  /**
   * v6.108.0 (Cycle 37 G37-02) 新增：Tool Use 工具市场面板
   * 作用：控制 ToolMarketplacePanel 弹窗显隐
   *       工具注册/执行/统计 + OpenAI/Anthropic 协议转换
   */
  const [toolMarketplaceOpen, setToolMarketplaceOpen] = useState(false);
  const handleOpenToolMarketplace = useCallback(() => {
    setToolMarketplaceOpen((prev) => !prev);
  }, []);

  /**
   * v6.108.0 (Cycle 37 G37-03) 新增：Agent Loop 面板
   * 作用：控制 AgentLoopPanel 弹窗显隐
   *       ReAct / Plan-Execute 双模式 + 中断恢复 + 检查点
   */
  const [agentLoopOpen, setAgentLoopOpen] = useState(false);
  const handleOpenAgentLoop = useCallback(() => {
    setAgentLoopOpen((prev) => !prev);
  }, []);

  /**
   * v6.108.0 (Cycle 37 G37-04) 新增：真实 LLM Provider 面板
   * 作用：控制 RealLLMProviderPanel 弹窗显隐
   *       DeepSeek + 火山方舟 Coding Plan 真实 API 集成
   */
  const [realLLMProviderOpen, setRealLLMProviderOpen] = useState(false);
  const handleOpenRealLLMProvider = useCallback(() => {
    setRealLLMProviderOpen((prev) => !prev);
  }, []);

  /**
   * 删除会话（v6.35.0 P1-7：升级撤销按钮）
   * 运行步骤：
   *   1. 二次确认
   *   2. 调用 deleteSession API（软删除，迁移到回收站）
   *   3. 若删除的是当前激活会话：自动创建新 Session
   *   4. 刷新边栏列表
   *   5. 显示带"撤销"按钮的 Toast（6 秒反应时间）
   *      用户点击"撤销" → 调用 restoreSessions API 恢复会话
   */
  const handleDeleteSession = useCallback(async (id: string) => {
    if (!confirm('确定删除此会话？所有对话记录将被清除')) return;
    // v5.9.0：按钮加载态
    setIsDeletingSession(true);
    try {
      await deleteSession(id);
      // 刷新边栏
      refetchSessions();
      // 若删除的是当前会话，自动创建新会话
      if (id === currentSessionId) {
        const newSess = await createSession({ mode: appMode! });
        setCurrentSessionId(newSess.id);
        try { localStorage.setItem(LS_CURRENT_SESSION_ID, newSess.id); } catch { /* 静默降级 */ }
        setMessages([]);
        setPlanVisible(false);
        setPlanContent('');
        setExpandedAgentId(null);
        refetchSessions();
      }
      // v6.35.0 P1-7：带撤销按钮的 Toast
      showToastWithAction(
        '会话已删除',
        '撤销',
        async () => {
          try {
            await restoreSessions([id]);
            showToast('已恢复会话', 'success');
            refetchSessions();
          } catch (e) {
            showToast(`恢复失败：${(e as Error).message}`, 'error');
          }
        },
        { type: 'warning' }
      );
    } catch (e) {
      showToast(`删除失败：${(e as Error).message}`, 'error');
    } finally {
      setIsDeletingSession(false);
    }
  }, [currentSessionId, refetchSessions, showToast, showToastWithAction, appMode]);

  /**
   * 批量删除会话（v2.7.0 新增 / v6.35.0 P1-7：升级撤销按钮）
   * 运行步骤：
   *   1. 调用 batchDeleteSessions API 软删除所选会话
   *   2. 刷新边栏会话列表
   *   3. 若删除的会话包含当前激活会话，自动创建新 Session
   *   4. 显示带"撤销"按钮的 Toast
   *      用户点击"撤销" → 调用 restoreSessions API 批量恢复
   */
  const handleBatchDelete = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    // v5.9.0：按钮加载态
    setIsDeletingSession(true);
    try {
      const result = await batchDeleteSessions(ids);
      // 刷新边栏列表
      refetchSessions();
      // 若删除的会话中包含当前激活会话，自动创建新会话
      if (ids.includes(currentSessionId!)) {
        const newSess = await createSession({ mode: appMode! });
        setCurrentSessionId(newSess.id);
        try { localStorage.setItem(LS_CURRENT_SESSION_ID, newSess.id); } catch { /* 静默降级 */ }
        setMessages([]);
        setPlanVisible(false);
        setPlanContent('');
        setExpandedAgentId(null);
        refetchSessions();
      }
      // v6.35.0 P1-7：带撤销按钮的 Toast
      const count = result.deleted_count ?? ids.length;
      showToastWithAction(
        result.message || `已批量删除 ${count} 个会话`,
        '撤销',
        async () => {
          try {
            await restoreSessions(ids);
            showToast(`已恢复 ${ids.length} 个会话`, 'success');
            refetchSessions();
          } catch (e) {
            showToast(`恢复失败：${(e as Error).message}`, 'error');
          }
        },
        { type: 'warning' }
      );
    } catch (e) {
      showToast(`批量删除失败：${(e as Error).message}`, 'error');
    } finally {
      setIsDeletingSession(false);
    }
  }, [currentSessionId, refetchSessions, showToast, showToastWithAction, appMode]);

  /**
   * 在流式回调中实时访问最新的 thinkingContent
   * 闭包陷阱解决：在 onDone 时若直接读 thinkingContent 变量，闭包可能拿到旧值
   * 因此用 ref 在 onThinking 中持续同步
   */
  const thinkingContentRef = useRef('');
  useEffect(() => {
    thinkingContentRef.current = thinkingContent;
  }, [thinkingContent]);

  /**
   * v3.6.0：处理结构化 clarify_questions SSE 事件
   * 作用：将后端推送的结构化澄清问题（含候选选项 options、是否多选 allow_multiple）
   *       统一映射为前端 camelCase 结构，写入 clarificationData，驱动交互式 ClarificationCard 渲染。
   * 调用方：chatWithHermesStreaming 的 onClarifyQuestions 回调（通用聊天 / clarifying 阶段共用）。
   * 输入参数：
   *   - data: { questions, round?, maxRounds?, complete?, summary? }
   *     · questions: 后端问题数组，每项含 dimension/question/importance/options/allow_multiple
   *     · round: 当前澄清轮次（缺省时沿用上一轮或 1）
   *     · maxRounds: 最大澄清轮次（缺省 5）
   *     · complete: 澄清是否完成
   *     · summary: AI 对需求的理解总结
   * 输出返回值：无（副作用：更新 clarificationData state）
   */
  const handleClarifyQuestions = useCallback((data: { questions: any[]; round?: number; maxRounds?: number; complete?: boolean; summary?: string }) => {
    setClarificationData(prev => ({
      // 映射后端 snake_case（allow_multiple）→ 前端 camelCase（allowMultiple）
      questions: (data.questions || []).map((q: any) => ({
        dimension: q.dimension,
        question: q.question,
        importance: q.importance,
        options: q.options || [],
        // 兼容后端 snake_case 与可能的 camelCase；默认 false（单选）
        allowMultiple: q.allow_multiple ?? q.allowMultiple ?? false,
      })),
      // round 缺省时沿用上一轮轮次，再兜底为 1
      roundNumber: data.round ?? prev?.roundNumber ?? 1,
      maxRounds: data.maxRounds ?? 5,
      isComplete: data.complete ?? false,
      summary: data.summary ?? '',
    }));
    // v3.8.0 修复：澄清完成时也保持弹窗打开，让用户看到"确认需求文档"按钮
    // v3.10.0 修复：仅当工作流仍在 clarifying 阶段时才显示弹窗，
    // 防止已进入架构设计后又被新一轮澄清事件拉回弹窗
    if (!workflowStatus || workflowStatus.current_stage === 'clarifying') {
      setShowClarifyModal(true);
    }
  }, [workflowStatus]);

  // ============================================================
  // 架构设计批判迭代阶段处理函数（v2.0.0 新增）
  // ============================================================

  /**
   * 启动架构设计批判迭代阶段
   * 作用：当用户点击"跳过不确定项，进入架构设计"时，
   *       调用 POST /api/architecture/start-design-phase
   *       获取 V2.0 需求文档和批判分析结果，显示模态弹窗
   * 调用方：ClarificationCard 的 onConfirm 回调（澄清完成后用户确认进入架构设计）
   * 被调用方：startDesignPhase API
   * 运行步骤：
   *   1. 获取当前 workflowId
   *   2. 设置加载状态
   *   3. 调用 startDesignPhase API
   *   4. 将返回结果写入 designModalData
   *   5. 显示 ArchitectureDesignModal
   * 输入参数：无
   * 输出返回值：Promise<void>
   */
  const handleStartDesignPhase = useCallback(async () => {
    // v5.6.0 修复（Bug：跳过不确定项后设计阶段无法启动）：使用 workflowIdRef.current
    //   读取最新 workflow_id 而非依赖闭包内的 sessionDetail。sessionDetail 为异步加载，
    //   闭包可能在点击瞬间捕获 null 值导致 "无 workflow_id" 警告 + 模态弹窗不弹出。
    const wfId = workflowIdRef.current || sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id;
    if (!wfId) {
      console.warn('无 workflow_id，无法启动架构设计阶段');
      return;
    }

    setIsDesignLoading(true);
    setShowDesignModal(true);

    try {
      const result = await startDesignPhase(wfId);
      if (result.success) {
        setDesignModalData({
          requirementV2: result.requirement_v2,
          critiqueResult: result.critique_result,
          iterationCount: 1,
          maxIterations: 3,
        });
      } else {
        console.error('启动架构设计阶段失败:', result.error_message);
      }
    } catch (e) {
      console.error('启动架构设计阶段异常:', e);
    } finally {
      setIsDesignLoading(false);
    }
  }, [sessionDetail?.session?.workflow_id, workflowStatus?.workflow_id]);

  /**
   * 确认架构设计（用户确认 V2.0 需求通过）
   * 作用：调用 POST /api/architecture/confirm-design
   *       生成最终架构文档、创建 Git 仓库、推进工作流
   * 调用方：ArchitectureDesignModal 的 onConfirm 回调
   * 被调用方：confirmDesignPhase API
   * 运行步骤：
   *   1. 调用 confirmDesignPhase API（confirmed=true）
   *   2. 关闭模态弹窗
   *   3. 刷新工作流状态
   * 输入参数：无
   * 输出返回值：Promise<void>
   */
  const handleConfirmDesign = useCallback(async () => {
    // v5.6.0 修复：使用 workflowIdRef.current 避免闭包过期问题
    const wfId = workflowIdRef.current || sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id;
    if (!wfId) {
      // v5.8.0 修复：wfId 为 null 时显示错误提示，避免静默 return 造成"按钮无反应"错觉
      console.warn('handleConfirmDesign: 无 workflow_id，无法确认架构设计');
      showToast('未找到工作流 ID，请刷新页面后重试', 'error');
      return;
    }

    // v5.8.0 修复：点击后立即显示加载态 + 禁用按钮（防重入 + 即时视觉反馈）
    setIsDesignLoading(true);
    try {
      const result = await confirmDesignPhase(wfId, true);
      if (result.success) {
        setShowDesignModal(false);
        setDesignModalData(null);
        showToast('架构设计已确认，正在生成 spec/task/checklist 文档...', 'success');
        // 刷新工作流状态
        if (wfId) {
          fetchWorkflowStatus(wfId).then(setWorkflowStatus).catch(() => {});
        }
      } else {
        // v5.8.0 修复：后端返回 success=false 时显示具体错误
        console.error('确认架构设计失败:', result);
        showToast(`确认失败：${result.message || '未知错误'}`, 'error');
      }
    } catch (e) {
      // v5.8.0 修复：API 异常时显示错误提示，不再仅 console.error
      console.error('确认架构设计异常:', e);
      showToast(`确认失败：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setIsDesignLoading(false);
    }
  }, [sessionDetail?.session?.workflow_id, workflowStatus?.workflow_id, showToast]);

  /**
   * 驳回架构设计（用户驳回 V2.0 需求，触发重新迭代）
   * 作用：调用 POST /api/architecture/reject-design
   *       重新执行批判分析 + 需求迭代，更新模态弹窗内容
   * 调用方：ArchitectureDesignModal 的 onReject 回调
   * 被调用方：rejectDesignPhase API
   * 运行步骤：
   *   1. 调用 rejectDesignPhase API（传入驳回原因）
   *   2. 更新 designModalData 为新的迭代结果
   * 输入参数：
   *   - reason: string，驳回原因
   * 输出返回值：Promise<void>
   */
  const handleRejectDesign = useCallback(async (reason: string) => {
    // v5.6.0 修复：使用 workflowIdRef.current 避免闭包过期问题
    const wfId = workflowIdRef.current || sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id;
    if (!wfId) return;

    setIsDesignLoading(true);
    try {
      const result = await rejectDesignPhase(wfId, reason);
      if (result.success) {
        setDesignModalData(prev => ({
          requirementV2: result.requirement_v2 || prev?.requirementV2 || '',
          critiqueResult: result.critique_result || prev?.critiqueResult || null,
          iterationCount: (prev?.iterationCount || 1) + 1,
          maxIterations: prev?.maxIterations || 3,
        }));
      }
    } catch (e) {
      console.error('驳回架构设计失败:', e);
    } finally {
      setIsDesignLoading(false);
    }
  }, [sessionDetail?.session?.workflow_id, workflowStatus?.workflow_id]);

  /**
   * v3.6.0：流式发送核心（被 handleSendMessage 与 handleSendClarifyAnswer 共用）
   * 作用：以统一的 chatWithHermesStreaming 流程发送一条用户消息，
   *       并接入 onClarifyQuestions 回调消费结构化澄清问题事件。
   *       后端 /api/hermes/chat/stream 已能识别 clarifying 阶段并返回 clarify_questions 事件，
   *       因此 clarifying 阶段无需再走裸 fetch /clarify/respond，统一走此流程。
   * 调用方：handleSendMessage（输入框发送）、handleSendClarifyAnswer（澄清卡片提交）。
   * 输入参数：
   *   - trimmed: 已去除首尾空白的用户消息文本（非空由调用方保证）
   * 输出返回值：Promise<void>（副作用：更新 messages / clarificationData / workflowStatus 等 state）
   */
  const sendStreamingMessage = useCallback(async (trimmed: string) => {
    setThinkingContent('');
    setStreamingStatus('thinking');

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    // 创建空的 Hermes 消息占位
    const hermesMsgId = `hermes-${Date.now()}`;
    const hermesMsg: ChatMessage = {
      id: hermesMsgId,
      role: 'hermes',
      content: '',
      thinking: '',
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg, hermesMsg]);
    setStreamingMessageId(hermesMsgId);

    // 创建 AbortController 用于停止按钮中断请求（v3.3.0 新增）
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // v3.5.0：记录本轮流式中后端是否启动了 SOP 工作流（workflow_started 事件）
    // 闭包内无法直接持有最新 state，用局部变量在 onWorkflowStarted 中赋值，onDone 时消费
    let startedWorkflowId: string | null = null;
    // v3.6.0：降级解析所需局部变量
    //   - receivedClarifyEvent: 是否收到结构化 clarify_questions 事件（收到则不做文本降级）
    //   - accumulatedText: 累积的回复正文（供 Markdown 降级解析使用）
    let receivedClarifyEvent = false;
    let accumulatedText = '';

    try {
      await chatWithHermesStreaming(trimmed, currentSessionId, {
        onThinking: (content) => {
          setThinkingContent(prev => prev + content);
        },
        onText: (content) => {
          setStreamingStatus('answering');
          accumulatedText += content;  // v3.6.0：累积正文供降级解析
          setMessages(prev => prev.map(msg =>
            msg.id === hermesMsgId
              ? { ...msg, content: msg.content + content }
              : msg
          ));
        },
        // v3.6.0：消费结构化澄清问题事件，驱动交互式 ClarificationCard
        onClarifyQuestions: (data) => {
          receivedClarifyEvent = true;
          handleClarifyQuestions(data);
        },
        // v3.5.0：coding 模式开发需求触发 SOP 工作流，记录 workflow_id 供 onDone 刷新状态
        onWorkflowStarted: ({ workflowId }) => {
          startedWorkflowId = workflowId || null;
        },
        // v1.9.0：评审结果回调
        onReviewResult: (data: ReviewData) => {
          setReviewData(data);
        },
        // v1.9.0：流水线步骤更新回调
        onPipelineStep: (data: PipelineData) => {
          setPipelineData(data);
        },
        // v1.9.0：Goal 更新回调
        onGoalUpdate: (data: GoalData) => {
          setGoalData(data);
        },
        // v4.2.0 新增：分阶段推理回调（P1-4 补齐）
        // 后端在 workflow 阶段切换时发送 reasoning_stage 事件，
        // 前端更新阶段状态供 ThinkingBlock 渲染进度条
        onReasoningStage: (data) => {
          setReasoningStage(data.stage as ReasoningStage);
          setStageProgress(data.progress);
        },
        onDone: () => {
          setStreamingStatus('done');
          setIsSending(false);
          setStreamingMessageId(null);
          abortControllerRef.current = null;
          // 将本次累积的 thinking 写入 Hermes 消息
          setMessages(prev => prev.map(msg =>
            msg.id === hermesMsgId
              ? { ...msg, thinking: thinkingContentRef.current }
              : msg
          ));
          // 3 秒后清除完成状态
          setTimeout(() => setStreamingStatus(null), 3000);
          // v3.6.0：降级解析 —— 若本轮未收到结构化 clarify_questions 事件，
          //   但正文包含澄清标记（"需要您补充以下信息"），则从 Markdown 文本解析问题列表，
          //   保证旧版后端 / 事件丢失场景下澄清卡片仍可渲染。
          if (!receivedClarifyEvent && accumulatedText.includes('需要您补充以下信息')) {
            const parsedQuestions = extractQuestions(accumulatedText);
            if (parsedQuestions.length > 0) {
              setClarificationData(prev => ({
                questions: parsedQuestions,  // Markdown 解析无 options，卡片自动回退为纯自由输入
                roundNumber: prev?.roundNumber ?? 1,
                maxRounds: prev?.maxRounds ?? 5,
                isComplete: prev?.isComplete ?? false,
                summary: extractSummary(accumulatedText),
              }));
            }
          }
          // 刷新边栏会话列表（last_active_at / message_count 已被后端更新；
          // title 由 SessionListItem 派生计算展示，前端不再写回）
          refetchSessions();
          // v3.5.0：若本轮启动了 SOP 工作流，立即拉取工作流状态，
          // 使后续消息进入 clarifying 分流（无需等待会话切换/刷新）
          if (startedWorkflowId) {
            fetchWorkflowStatus(startedWorkflowId)
              .then(setWorkflowStatus)
              .catch((e) => {
                console.warn('启动工作流后拉取状态失败：', e);
                setWorkflowStatus(null);
              });
          } else if (workflowStatus?.workflow_id) {
            // v3.6.0：clarifying 阶段回答完成后，刷新工作流状态（轮次/阶段可能已推进）
            fetchWorkflowStatus(workflowStatus.workflow_id)
              .then(setWorkflowStatus)
              .catch(() => {});
          }
        },
        onError: (error) => {
          // v2.9.2：流式错误改为设置 error 字段，渲染 MessageBubble 错误卡片
          // 不再写入 content；保留原 Toast 提示（此处与原实现一致，无 Toast 提示）
          setMessages(prev => prev.map(msg =>
            msg.id === hermesMsgId
              ? { ...msg, error: `处理失败：${error}` }
              : msg
          ));
          setStreamingStatus(null);
          setIsSending(false);
          setStreamingMessageId(null);
          abortControllerRef.current = null;
        },
      }, appMode ?? undefined, abortController.signal);
    } catch (e) {
      // v2.9.2：异常分支同样设置 error 字段
      setMessages(prev => prev.map(msg =>
        msg.id === hermesMsgId
          ? { ...msg, error: `处理失败：${(e as Error).message}` }
          : msg
      ));
      setStreamingStatus(null);
      setIsSending(false);
      setStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  }, [currentSessionId, refetchSessions, workflowStatus, appMode, handleClarifyQuestions]);

  /**
   * 发送消息给 Hermes（流式版本）
   * v3.6.0：clarifying 阶段不再走裸 fetch /clarify/respond，统一走 sendStreamingMessage，
   *         由后端 chat/stream 识别 clarifying 阶段并返回 clarify_questions 事件。
   * v5.9.0：增加 300ms 防重入守卫（sendInFlightRef），防止快速双击 Enter / 发送按钮
   *         导致重复发起流式请求，避免后端会话状态污染。
   * 运行步骤：
   *   1. 校验输入内容非空
   *   2. 300ms 防重入检查（sendInFlightRef 守卫）
   *   3. 清空输入框，设置发送状态
   *   4. 调用 sendStreamingMessage 执行流式对话
   *   5. 300ms 后释放守卫，允许下一次发送
   */
  const handleSendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;

    // v5.9.0：300ms 防重入守卫，避免快速双击导致重复请求
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    // 300ms 后自动释放守卫，覆盖快速双击场景
    window.setTimeout(() => { sendInFlightRef.current = false; }, 300);

    setInputValue('');
    setIsSending(true);
    // v5.11.0 Module E：检测 Codex 风格斜杠命令
    // 支持：/review [file] / /fix <file> / /review-fix-loop <file>
    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed);
      if (handled) {
        setIsSending(false);
        return;
      }
      // 未识别的命令：回退到普通对话
    }
    await sendStreamingMessage(trimmed);
  }, [inputValue, isSending, sendStreamingMessage]);

  /**
   * v5.11.0 Module E：Codex 风格斜杠命令分发器
   * 作用：解析以「/」开头的输入，路由到对应的本地 API 调用
   * 支持命令：
   *   - /review [file]              对当前打开文件或指定文件做代码审查
   *   - /fix <file>                 对指定文件做自动修复
   *   - /review-fix-loop <file>     review-fix 自迭代循环
   * 参数：
   *   - raw: 已 trim 的原始用户输入
   * 返回值：true 已处理（含错误）；false 非命令或未识别（回退到普通对话）
   */
  const handleSlashCommand = useCallback(
    async (raw: string): Promise<boolean> => {
      // 解析命令名 + 剩余参数
      const match = raw.match(/^\/([a-zA-Z-]+)\s*(.*)$/);
      if (!match) return false;
      const cmd = match[1].toLowerCase();
      const arg = match[2].trim();

      if (cmd === 'review') {
        // /review [file] — file 可选，默认审查当前打开的文件或当前会话
        const target = arg || openedFile || '';
        // 添加用户消息
        const userMsg: ChatMessage = {
          id: `user-cmd-${Date.now()}`,
          role: 'user',
          content: raw,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsSending(true);
        try {
          const res = await reviewCode({
            files: target ? [target] : undefined,
            session_id: currentSessionId || undefined,
          });
          // 用 reviewData state 触发 ReviewReport 渲染
          setReviewData({
            overall_score: res.score,
            dimension_scores: {},
            defects: res.issues.map(i => ({
              defect_id: i.id,
              severity: i.severity,
              dimension: 'code-review',
              location: i.file ? `${i.file}:${i.line}` : `L${i.line}`,
              description: i.description,
              impact_scope: i.fix_suggestion,
              repair_plan: i.fix_suggestion,
            })),
            passed: res.score >= 80,
            summary: res.summary,
          });
          // 同时追加一条文本摘要
          const reviewMsg: ChatMessage = {
            id: `hermes-review-${Date.now()}`,
            role: 'hermes',
            content: res.summary,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, reviewMsg]);
          showToast(`/review 完成：发现 ${res.issue_count} 个问题，评分 ${res.score}/100`, 'success');
        } catch (e) {
          showToast(`/review 失败：${(e as Error).message}`, 'error');
          const errMsg: ChatMessage = {
            id: `hermes-review-err-${Date.now()}`,
            role: 'hermes',
            content: `审查失败：${(e as Error).message}`,
            timestamp: Date.now(),
            error: (e as Error).message,
          };
          setMessages(prev => [...prev, errMsg]);
        } finally {
          setIsSending(false);
        }
        return true;
      }

      if (cmd === 'fix') {
        // /fix <file> — file 必填
        if (!arg) {
          showToast('用法：/fix <文件路径>', 'warning');
          return true;
        }
        const userMsg: ChatMessage = {
          id: `user-cmd-${Date.now()}`,
          role: 'user',
          content: raw,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsSending(true);
        try {
          // 先对目标文件做一次 review 取 issues，再调用 fix
          const review = await reviewCode({
            files: [arg],
            session_id: currentSessionId || undefined,
          });
          const fixRes = await fixCode({
            review: review as unknown as Record<string, unknown>,
            file_paths: [arg],
            session_id: currentSessionId || undefined,
          });
          const fixMsg: ChatMessage = {
            id: `hermes-fix-${Date.now()}`,
            role: 'hermes',
            content: `${fixRes.summary}\n\n${fixRes.fixed_files
              .map(f => `**${f.path}**：应用 ${f.applied_fixes.length} 处修复`)
              .join('\n')}`,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, fixMsg]);
          showToast(`/fix 完成：${fixRes.summary}`, 'success');
        } catch (e) {
          showToast(`/fix 失败：${(e as Error).message}`, 'error');
        } finally {
          setIsSending(false);
        }
        return true;
      }

      if (cmd === 'review-fix-loop') {
        // /review-fix-loop <file> — 自迭代循环
        if (!arg) {
          showToast('用法：/review-fix-loop <文件路径>', 'warning');
          return true;
        }
        const userMsg: ChatMessage = {
          id: `user-cmd-${Date.now()}`,
          role: 'user',
          content: raw,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsSending(true);
        try {
          const res = await runReviewFixLoop({
            file_path: arg,
            max_iterations: 3,
            session_id: currentSessionId || undefined,
          });
          const loopMsg: ChatMessage = {
            id: `hermes-loop-${Date.now()}`,
            role: 'hermes',
            content: res.summary,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, loopMsg]);
          showToast(
            res.converged ? 'review-fix 循环已收敛' : 'review-fix 循环已达上限',
            res.converged ? 'success' : 'warning',
          );
        } catch (e) {
          showToast(`/review-fix-loop 失败：${(e as Error).message}`, 'error');
        } finally {
          setIsSending(false);
        }
        return true;
      }

      // 未识别命令：让上层走普通对话
      return false;
    },
    [openedFile, currentSessionId, showToast, setReviewData, setIsSending]
  );

  /**
   * v5.15.0 (Cycle 8 P0-12) 新增：Slash Command Picker 选中命令回调
   * 作用：用户在 SlashCommandPicker 中选中命令后调用，将命令插入输入框
   *      并立即执行（清空 input 触发 onSend）
   * 参数：
   *   - command: 命令名（不含 /）
   *   - args: 参数列表
   * 返回值：void
   */
  const handleSlashCommandExecute = useCallback(
    (command: string, args: string[]) => {
      // 构造完整命令字符串
      const cmdStr = args.length > 0 ? `/${command} ${args.join(' ')}` : `/${command}`;
      // 触发 handleSendMessage 的逻辑（通过设置 inputValue 然后模拟回车）
      setInputValue(cmdStr);
      // 立即异步发送
      window.setTimeout(() => {
        handleSendMessage();
      }, 0);
    },
    [setInputValue]
  );

  /**
   * v5.15.0 (Cycle 8 P0-12) 新增：关闭 Slash Command Picker
   * 作用：清空 input 中以 / 开头的部分（不影响非命令输入）
   * 返回值：void
   */
  const handleSlashCommandClose = useCallback(() => {
    setInputValue((prev) => {
      if (prev.startsWith('/')) return '';
      return prev;
    });
  }, [setInputValue]);

  /**
   * v3.6.0：提交澄清卡片的结构化回答，触发下一轮澄清
   * 作用：ClarificationCard 的 onSubmit 回调入口。将卡片汇总的结构化回答文本
   *       作为一条用户消息，通过 sendStreamingMessage 发送（带 sessionMode），
   *       后端识别 clarifying 阶段并返回下一轮 clarify_questions 事件。
   * 调用方：ClarificationCard onSubmit。
   * 输入参数：
   *   - answersText: 卡片汇总后的结构化回答文本（非空时才发送）
   * 输出返回值：Promise<void>（副作用：发送消息并更新对话/澄清状态）
   */
  const handleSendClarifyAnswer = useCallback(async (answersText: string) => {
    const trimmed = (answersText || '').trim();
    if (!trimmed || isSending) return;

    // 同步清空输入框，避免与卡片提交内容冲突
    setInputValue('');
    setIsSending(true);
    await sendStreamingMessage(trimmed);
  }, [isSending, sendStreamingMessage]);

  /**
   * 停止当前流式对话（v2.9.0 新增 - Task 5：贴底浮动输入区的停止按钮）
   * v3.3.0 重构：实现真正的停止机制
   * 运行步骤：
   *   1. 中断前端 fetch 请求（AbortController.abort()）
   *   2. 调用后端 /api/hermes/stop 端点终止后端子进程
   *   3. 清除流式状态、发送状态
   * 注意：fetch('/api/hermes/stop') 使用 catch 静默失败，不影响 UI 状态恢复
   */
  const handleStop = useCallback(() => {
    // 1. 中断前端 fetch 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 2. 调用后端停止端点终止子进程（静默失败）
    fetch('/api/hermes/stop', { method: 'POST' }).catch(() => {});
    // 3. 更新 UI 状态
    setIsSending(false);
    setStreamingStatus(null);
    setStreamingMessageId(null);
    showToast('已停止当前生成', 'info');
  }, [showToast]);

  /**
   * v4.2.0 新增：用户干预回调（P1-2 补齐）
   * 触发时机：ThinkingBlock 渲染 ⏸ 干预按钮，用户点击后调用
   * 行为：复用 handleStop 逻辑暂停流式生成 + 重置分阶段推理状态
   * 用途：用户可在任意推理阶段中断 AI，输入修改建议
   */
  const handleIntervene = useCallback(() => {
    handleStop();
    setReasoningStage('idle');
    setStageProgress(0);
    showToast('已暂停 AI 思考，请输入修改建议', 'info');
  }, [handleStop, showToast]);

  /**
   * 确认执行计划 - v6.37.0 P0-1: 新版 Composer Plan Mode 替代了旧版 confirmPlan 流程
   * 保留此函数体仅为兼容历史调用链；新流程下 PlanViewer 在 App.tsx 中不再渲染，
   * Composer 内的 plan.executePlan 替代了此入口
   *
   * 注：handleConfirmPlan 引用 void 化以避免 TS6133，
   *     在新版 Composer Plan Mode 流程下不再被实际调用
   */
  // 保留历史调用链，新版 Composer Plan Mode 替代
  const handleConfirmPlan = useCallback(async () => {
    // 注：此函数在新版 Composer Plan Mode 中不再被引用，保留仅为兼容历史调用链
    // v5.9.0：按钮加载态
    if (isConfirmPlanLoading) return;
    setIsConfirmPlanLoading(true);
    try {
      await confirmPlan(planContent, currentSessionId);
      setPlanVisible(false);
      showToast('任务已按模块分发执行', 'success');

      // 添加 Hermes 确认消息
      const confirmMsg: ChatMessage = {
        id: `hermes-confirm-${Date.now()}`,
        role: 'hermes',
        content: '已确认执行计划，正在按模块创建子 CLI 实例并分发任务。您可以在下方监控各实例的执行状态。',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, confirmMsg]);

      refetchAgents();
      refetchStats();
      refetchSessions();
    } catch (e) {
      showToast(`执行失败：${(e as Error).message}`, 'error');
    } finally {
      setIsConfirmPlanLoading(false);
    }
  }, [planContent, currentSessionId, refetchAgents, refetchStats, refetchSessions, showToast, isConfirmPlanLoading]);

  /**
   * 切换智能体卡片展开/收起
   */
  const handleToggleExpand = useCallback((agentId: string) => {
    setExpandedAgentId(prev => prev === agentId ? null : agentId);
  }, []);

  /**
   * 智能体变更后刷新
   * v6.10.0 P0-2：handleAgentChanged 已迁移到 <AppLayout onAgentChanged /> 处内联实现
   *   （refetchAgents 仍在 useAgents 内部使用，refetchStats 在此调用）
   */
  // const handleAgentChanged = useCallback(() => {
  //   refetchAgents();
  //   refetchStats();
  // }, [refetchAgents, refetchStats]);

  /**
   * 处理键盘事件：Enter 发送消息，Shift+Enter 换行
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // ============================================================
  // 渲染
  // ============================================================

  /**
   * Cycle 3 v1.1.1 新增：统一的模态弹窗组件
   * - 背景点击关闭（onClick + stopPropagation）
   * - Escape 键关闭（useEffect 监听 keydown）
   * - 玻璃拟态背景（bg-black/40 + backdrop-blur-md）
   * - 入场动画（animate-lift-in）
   */
  const Cycle3Modal: React.FC<{
    onClose: () => void;
    maxWidth?: string;
    height?: string;
    children: React.ReactNode;
  }> = ({ onClose, maxWidth = 'max-w-4xl', height = 'h-[85vh]', children }) => {
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [onClose]);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-lift-in"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={`w-full ${maxWidth} ${height} bg-transparent rounded-2xl shadow-2xl m-4 flex flex-col overflow-hidden`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  };

  // 优先使用 sessionDetail 提供的 agents（按 session 隔离），否则用全局拉取的结果兜底
  const displayAgents: Agent[] = sessionDetail?.agents ?? agents;

  // 当前激活的 Session 对象（v2.9.0 新增 - Task 3：供 BrandHeader 展示 Session 标题）
  // 步骤：从本地 sessions 列表中查找 id 等于 currentSessionId 的项
  const currentSession = currentSessionId
    ? sessions.find(s => s.id === currentSessionId) || null
    : null;

  return (
    <>
      {/* ============================================================ */}
      {/* v6.40.0 Cycle 18 P0-3：全局错误 Toast（始终在最顶层显示） */}
      {/* ============================================================ */}
      <GlobalErrorToast />

      {/* ============================================================ */}
      {/* v3.0.0：模式未选择 → 渲染 ModeSelector */}
      {/* ============================================================ */}
      {!appMode && (
        <ModeSelector onSelect={handleModeSelect} />
      )}

      {/* ============================================================ */}
      {/* 模式已选择 → 渲染主界面 */}
      {/* ============================================================ */}
      {appMode && (
    <div className="min-h-screen bg-surface-50 flex">
      {/* Toast 通知容器（v6.35.0 P1-7：替换旧 Toast 组件，支持多 Toast 堆叠 + 撤销按钮） */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* PlanViewer 计划展示弹窗 - v6.37.0 Cycle 17 P0-1: 
          旧的 PlanViewer API（content/visible/onConfirm）已被 Composer Plan Mode 取代，
          新的 PlanViewer 集成在 ComposerPanel 中。旧的 plan 确认流由 CodingPanel 处理。
          此处保留 import 仅为兼容，新版 App 中已不再使用。 */}
      {false && appMode === 'coding' && !selectedProject && (
        <PlanViewer
          plan={null}
          stage="idle"
          onApproveStep={() => undefined}
          onRejectStep={() => undefined}
          onModifyStep={() => undefined}
          onApproveAll={() => undefined}
          onRejectAll={() => undefined}
          onApprovePlan={() => undefined}
          onRejectPlan={() => undefined}
          onExecutePlan={() => undefined}
          onClose={() => setPlanVisible(false)}
        />
      )}

      {/* ============================================================ */}
      {/* v2.10.0：编程模式 + 未选项目 → 显示 ProjectSelector */}
      {/* v2.10.2：透传 onBack（返回模式选择） + onSwitchToChat（切换到聊天） */}
      {/* ============================================================ */}
      {appMode === 'coding' && !selectedProject ? (
        <ProjectSelector
          onSelect={(name) => setSelectedProject(name)}
          onBack={handleBackToModeSelect}
          onSwitchToChat={handleSwitchToChat}
        />
      ) : (
      <>

      {/* ============================================================ */}
      {/* 左侧边栏：会话历史 (v6.40.0 Cycle 18 P0-3: ErrorBoundary 嵌套) */}
      {/* ============================================================ */}
      <ErrorBoundary level="panel" name="Sidebar">
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={handleToggleSidebar}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onBatchDelete={handleBatchDelete}
        loading={sessionsLoading}
        onOpenSettings={setSettingsOpen}
        onNewTask={handleNewTask}
        appMode={appMode!}
        onModeSwitch={handleModeSwitch}
        deletingSession={isDeletingSession}
      />
      </ErrorBoundary>

      {/* v6.36.0 P2-1：移动端 Sidebar 抽屉包装（移动端有效，桌面端不渲染）
          (v6.40.0 Cycle 18 P0-3: ErrorBoundary 嵌套) */}
      <ErrorBoundary level="panel" name="MobileSidebar">
      <MobileSidebar
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        expanded={sidebarExpanded}
        onToggle={handleToggleSidebar}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={(id) => {
          handleSelectSession(id);
          setMobileSidebarOpen(false);
        }}
        onDeleteSession={handleDeleteSession}
        onBatchDelete={handleBatchDelete}
        loading={sessionsLoading}
        onOpenSettings={setSettingsOpen}
        onNewTask={handleNewTask}
        appMode={appMode!}
        onModeSwitch={handleModeSwitch}
        deletingSession={isDeletingSession}
      />
      </ErrorBoundary>

      {/* ============================================================ */}
      {/* 主内容区域：settingsOpen 时显示设置面板，否则显示对话界面 */}
      {/* ============================================================ */}
      {settingsOpen ? (
        <SettingsPanel
          onClose={closeSettings}
          showToast={showToast}
        />
      ) : (
        <>
          {/* v6.36.0 P2-1：移动端顶栏（仅移动端显示） */}
          {isMobile && (
            <MobileHeader
              title={currentSession?.title || 'Hermes'}
              onMenuClick={() => setMobileSidebarOpen(true)}
              onPrimaryAction={handleNewTask}
              primaryActionIcon="+"
              primaryActionLabel="新建对话"
            />
          )}
          <AppLayout
            appMode={appMode!}
          selectedProject={selectedProject}
          openedFile={openedFile}
          setOpenedFile={setOpenedFile}
          currentSessionTitle={currentSession?.title || '新对话'}
          onNewChat={handleNewTask}
          newChatLoading={isNewTaskLoading}
          onOpenSettings={setSettingsOpen}
          onOpenUsage={setShowUsagePanel}
          onOpenFileExplorer={setFileExplorerOpen}
          fileExplorerOpen={fileExplorerOpen}
          onOpenLoopV7={handleOpenLoopV7}
          onOpenMCP={setMcpPanelOpen}
          onOpenCompaction={setCompactionPanelOpen}
          onOpenSkills={setSkillsPanelOpen}
          onOpenAgentsMd={setAgentsMdPanelOpen}
          onOpenDiffView={handleOpenDiffView}
          onOpenMemory={handleOpenMemory}
          onOpenVerification={handleOpenVerification}
          onOpenDoctor={handleOpenDoctor}
          onOpenLlmJudge={handleOpenLlmJudge}
          onOpenMarketplace={handleOpenMarketplace}
          onOpenMultimodal={handleOpenMultimodal}
          onOpenEnterpriseHub={handleOpenEnterpriseHub}
          onOpenTraeWork={handleOpenTraeWork}
          onOpenGoalAutomation={handleOpenGoalAutomation}
          onOpenGoalTemplates={handleOpenGoalTemplates}
          onOpenComposer={handleOpenComposer}
          onOpenBackgroundTasks={handleOpenBackgroundTasks}
          onOpenBestOfN={handleOpenBestOfN}
          onOpenDesignMode={handleOpenDesignMode}
          onOpenWorktree={handleOpenWorktree}
          onOpenModelRouter={handleOpenModelRouter}
          onOpenHooks20={handleOpenHooks20}
          onOpenBestOfNCoordinator={handleOpenBestOfNCoordinator}
          onOpenModelRouterStats={handleOpenModelRouterStats}
          onOpenHooksMarketplace={handleOpenHooksMarketplace}
          onOpenSideChat={handleOpenSideChat}
          onOpenCostPrediction={handleOpenCostPrediction}
          onOpenHookPerformance={handleOpenHookPerformance}
          onOpenModelRouterAdmin={handleOpenModelRouterAdmin}
          onOpenCandidateLearning={handleOpenCandidateLearning}
          onOpenSessionReplay={handleOpenSessionReplay}
          onOpenProactiveSuggestion={handleOpenProactiveSuggestion}
          onOpenGlobalMemory={handleOpenGlobalMemory}
          onOpenMultiTask={handleOpenMultiTask}
          onOpenFigmaImport={handleOpenFigmaImport}
          onOpenAutoCodeReview={handleOpenAutoCodeReview}
          onOpenPRBot={handleOpenPRBot}
          onOpenPerfOptimizer={handleOpenPerfOptimizer}
          onOpenCsvBatch={handleOpenCsvBatch}
          onOpenSmartApproval={handleOpenSmartApproval}
          onOpenMTC={handleOpenMTC}
          onOpenNestedSubAgent={handleOpenNestedSubAgent}
          onOpenAgentCheckpoint={handleOpenAgentCheckpoint}
          onOpenAgentMessaging={handleOpenAgentMessaging}
          onOpenAgentTemplate={handleOpenAgentTemplate}
          onOpenRemoteControl={handleOpenRemoteControl}
          onOpenSkillSystem={handleOpenSkills}
          onOpenCostBudget={handleOpenCostBudget}
          onOpenUsageAttribution={handleOpenUsageAttribution}
          onOpenScopedPermissions={handleOpenScopedPermissions}
          onOpenCommandPalette={handleOpenSlashCommand}
          onOpenStackedSkills={handleOpenStackedSkills}
          onOpenSkillsMarket={handleOpenSkillsMarket}
          onOpenAnalyticsChat={handleOpenAnalyticsChat}
          onOpenCostThreshold={handleOpenCostThreshold}
          onOpenDynamicWorkflow={handleOpenDynamicWorkflow}
          onOpenOrchestratedAgent={handleOpenOrchestratedAgent}
          onOpenCostAttribution={handleOpenCostAttribution}
          onOpenRemoteWorktree={handleOpenRemoteWorktree}
          onOpenWorktreeSync={handleOpenWorktreeSync}
          onOpenAuditTrail={handleOpenAuditTrail}
          onOpenSSO={handleOpenSSO}
          onOpenPolicy={handleOpenPolicy}
          onOpenEnterpriseWorkflow={handleOpenEnterpriseWorkflow}
          onOpenUnifiedDashboard={handleOpenUnifiedDashboard}
          onOpenSecurityAudit={handleOpenSecurityAudit}
          onOpenEdgeModelRouter={handleOpenEdgeModelRouter}
          onOpenOfflineFirst={handleOpenOfflineFirst}
          onOpenDeviceCluster={handleOpenDeviceCluster}
          onOpenWorkflowOrchestrator={handleOpenWorkflowOrchestrator}
          onOpenAgentCommunication={handleOpenAgentCommunication}
          onOpenTaskCheckpoint={handleOpenTaskCheckpoint}
          onOpenAgentScheduler={handleOpenAgentScheduler}
          onOpenLLMProvider={handleOpenLLMProvider}
          onOpenStreamingChat={handleOpenStreamingChat}
          onOpenMultiModal={handleOpenMultiModal}
          onOpenRAG={handleOpenRAG}
          onOpenToolMarketplace={handleOpenToolMarketplace}
          onOpenAgentLoop={handleOpenAgentLoop}
          onOpenRealLLMProvider={handleOpenRealLLMProvider}
          onOpenCycle3={setCycle3PanelOpen}
          onOpenDualCompaction={setDualCompactionOpen}
          onOpenRules={setRulesPanelOpen}
          onOpenPlanEditor={setPlanEditorOpen}
          onOpenHooks={setHooksPanelOpen}
          onOpenSubagentMemory={setSubagentMemoryPanelOpen}
          onOpenHookChain={() => hookChainModal.onOpen()}
          onOpenCacheStats={() => cacheStatsModal.onOpen()}
          onOpenStreamList={() => streamListModal.onOpen()}
          onOpenOAuthConfig={() => oauthConfigModal.onOpen()}
          onOpenSessionRollout={() => sessionRolloutModal.onOpen()}
          onOpenMultiAgentTree={() => multiAgentTreeModal.onOpen()}
          onOpenTraceRule={() => traceRuleModal.onOpen()}
          onOpenSlashCommand={() => slashCommandModal.onOpen()}
          onOpenCustomModels={() => customModelsModal.onOpen()}
          onSlashCommandExecute={handleSlashCommandExecute}
          onSlashCommandClose={handleSlashCommandClose}
          onModelChange={(id) => showToast(`已切换到模型 ${id}`, 'success')}
          onReasoningIntensityChange={(i) => showToast(`推理强度已设为 ${i}`, 'info')}
          workflowStatusCurrentStage={workflowStatus?.current_stage ?? null}
          clarificationData={clarificationData}
          showClarifyModal={showClarifyModal}
          reviewData={reviewData}
          pipelineData={pipelineData}
          goalData={goalData}
          messages={messages}
          detailLoading={detailLoading}
          streamingStatus={streamingStatus}
          streamingMessageId={streamingMessageId}
          thinkingContent={thinkingContent}
          // v4.2.0 新增：分阶段推理状态（P1-4 补齐）
          reasoningStage={reasoningStage}
          stageProgress={stageProgress}
          // v4.2.0 新增：用户干预回调（P1-2 补齐）—— 暂停当前流式对话
          onIntervene={handleIntervene}
          isSending={isSending}
          inputValue={inputValue}
          setInputValue={setInputValue}
          onSend={handleSendMessage}
          onStop={handleStop}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          messagesEndRef={messagesEndRef}
          lastMessageIdRef={lastMessageIdRef}
          onSubmitClarification={handleSendClarifyAnswer}
          onConfirmClarification={handleConfirmClarificationFromModal}
          onContinueAddClarification={() => {
            setShowClarifyModal(false);
            inputRef.current?.focus();
          }}
          workflowIdRef={workflowIdRef}
          sessionDetailWorkflowId={sessionDetail?.session?.workflow_id}
          workflowStatusWorkflowId={workflowStatus?.workflow_id}
          showDesignModal={showDesignModal}
          designModalData={designModalData}
          isDesignLoading={isDesignLoading}
          onConfirmDesign={handleConfirmDesign}
          onRejectDesign={handleRejectDesign}
          displayAgents={displayAgents}
          agentsLoading={loading}
          expandedAgentId={expandedAgentId}
          onToggleAgentExpand={handleToggleExpand}
          onAgentChanged={() => {
            // 智能体变更后刷新 stats
            refetchStats();
          }}
          onSelectWelcomePrompt={(p) => {
            setInputValue(p);
            inputRef.current?.focus();
          }}
        />
        </>
      )}

      {/* ============================================================ */}
      {/* v2.10.0：编程模式 + 已选项目 → 右侧 FileExplorer */}
      {/* v2.10.1：容器宽度根据 fileExplorerOpen state 动态切换（w-[280px] ↔ w-0）
       *   transition-all duration-300 ease-expressive 实现 280px 渐变隐藏/展开
       *   当 fileExplorerOpen=false 时容器收起，FileExplorer 内部不渲染（避免占空间） */}
      {/* ============================================================ */}
      {appMode === 'coding' && selectedProject && (
        <div
          className={`flex-shrink-0 h-screen sticky top-0
                      transition-all duration-300 ease-expressive
                      ${fileExplorerOpen ? 'w-[280px]' : 'w-0 overflow-hidden'}`}
        >
          {fileExplorerOpen && (
            <FileExplorer
              project={selectedProject}
              onFileSelect={(path) => setOpenedFile(path)}
              selectedFile={openedFile}
              onClose={() => fileExplorerModal.onClose()}
            />
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 右侧面板：用量监控面板（v6.9.0 P0-2 拆分为 UsagePanel 组件） */}
      {/* ============================================================ */}
      {showUsagePanel && (
        <div
          className={`flex-shrink-0 h-screen sticky top-0
                      transition-all duration-300 ease-expressive
                      ${showUsagePanel ? 'w-full md:w-80' : 'w-0 overflow-hidden'}`}
        >
          <UsagePanel
            stats={stats as UsageStats | null}
            onClose={usageModal.onClose}
          />
        </div>
      )}
        </>
        )}

      {/* v5.7.0：Loop v7 端到端工作流弹窗
       * 触发：BrandHeader 菜单"🚀 Loop v7 工作流"项 → handleOpenLoopV7
       * 关闭：LoopV7Runner 内部 onClose 回调
       * 位置：根 fragment 末尾，z-index 由 LoopV7Runner 自身管理（z-50） */}
      {showLoopV7Runner && (
        <LoopV7Runner onClose={closeLoopV7Runner} />
      )}

      {/* v6.14.0 Cycle 2 新增：MCP 工具调用面板弹窗
       * 触发：BrandHeader 菜单"🔌 MCP 工具"项
       * 关闭：McpPanel 内部 onClose 回调
       * 功能：查看 MCP 服务器/工具列表、调用工具（list_directory、read_file 等） */}
      {mcpPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeMcpPanel}>
          <div className="w-full max-w-4xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <McpPanel />
            <button
              onClick={closeMcpPanel}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-lg flex items-center justify-center text-surface-700"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* v6.14.0 Cycle 2 新增：会话压缩面板弹窗
       * 触发：BrandHeader 菜单"🗜️ 会话压缩"项
       * 关闭：按钮回调
       * 功能：显示当前会话 token 使用情况，触发手动压缩
       * 注意：需要 currentSessionId 才显示，否则提示选择会话 */}
      {compactionPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeCompactionPanel}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span>🗜️</span>
                <span>会话压缩</span>
              </h2>
              <button
                onClick={closeCompactionPanel}
                className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center text-surface-700"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            {currentSessionId ? (
              <CompactionIndicator
                sessionId={currentSessionId}
                onCompacted={() => {
                  showToast('会话已成功压缩', 'success');
                }}
              />
            ) : (
              <div className="text-sm text-surface-500 text-center py-8">
                请先选择一个会话以查看压缩状态
              </div>
            )}
          </div>
        </div>
      )}

      {/* v6.14.0 Cycle 2 新增：技能管理面板弹窗
       * 触发：BrandHeader 菜单"✨ 技能管理"项
       * 关闭：按钮回调
       * 功能：查看/启用/禁用 Skills 插件（内置 3 个 + 用户自定义） */}
      {skillsPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeSkillsPanel}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-white rounded-2xl shadow-2xl p-6 m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span>✨</span>
                <span>技能管理 (Skills)</span>
              </h2>
              <button
                onClick={closeSkillsPanel}
                className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center text-surface-700"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="text-sm text-surface-500 mb-4">
              Skills 是可复用的提示词工具集。启用后会自动注入到 LLM 系统提示中。
            </div>
            <div id="skills-panel-content">
              {/* 动态加载 Skills 列表 */}
              <SkillsPanelContent />
            </div>
          </div>
        </div>
      )}

      {/* v6.14.0 Cycle 2 新增：AGENTS.md 记忆管理面板弹窗
       * 触发：BrandHeader 菜单"📚 AGENTS.md 记忆"项
       * 关闭：按钮回调
       * 功能：扫描项目中的 AGENTS.md 文件，注入项目级规则到 LLM */}
      {agentsMdPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeAgentsMdPanel}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-white rounded-2xl shadow-2xl p-6 m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span>📚</span>
                <span>AGENTS.md 记忆</span>
              </h2>
              <button
                onClick={closeAgentsMdPanel}
                className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center text-surface-700"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="text-sm text-surface-500 mb-4">
              自动扫描项目中的 AGENTS.md 文件，加载项目级规则并注入 LLM 提示。
            </div>
            <AgentsMdPanelContent />
          </div>
        </div>
      )}

      {/* Cycle 3 v1.1.1 UI/UX 升级：MCP 高级功能面板（权限/外部服务器/审批/审计） */}
      {cycle3PanelOpen && (
        <Cycle3Modal
          onClose={closeCycle3Panel}
        >
          <Cycle3Panel onClose={closeCycle3Panel} />
        </Cycle3Modal>
      )}

      {/* Cycle 3 v1.1.1 UI/UX 升级：双触发压缩面板 */}
      {dualCompactionOpen && (
        <Cycle3Modal
          onClose={closeDualCompactionPanel}
          maxWidth="max-w-3xl"
          height="h-[80vh]"
        >
          <DualCompactionPanel onClose={closeDualCompactionPanel} />
        </Cycle3Modal>
      )}

      {/* Cycle 3 v1.1.1 UI/UX 升级：多类型规则扫描面板 */}
      {rulesPanelOpen && (
        <Cycle3Modal
          onClose={closeRulesPanel}
          maxWidth="max-w-3xl"
        >
          <RulesPanel
            open={rulesPanelOpen}
            onClose={closeRulesPanel}
            currentRules={{
              version: '1.0',
              project_type: 'generic',
              rules: {
                type_safety: 'strict',
                error_handling: 'try_catch',
                framework_best_practices: true,
                import_order: 'alphabetical',
                naming_convention: 'camelCase',
                testing: { required: true, framework: 'vitest', coverage_threshold: 80 },
                documentation: { required: true, language: 'chinese' },
                security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
              },
              custom_rules: [],
            }}
            onSave={() => closeRulesPanel()}
          />
        </Cycle3Modal>
      )}

      {/* v6.13.0 (Cycle 4 P0-3) 新增：Plan 编辑器 - Plan→Execute→Rollback 完整链路 */}
      {planEditorOpen && workflowIdRef.current && (
        <PlanEditorModal
          workflowId={workflowIdRef.current}
          visible={planEditorOpen}
          onConfirm={async () => {
            showToast('✓ Plan 已确认，推进到执行阶段', 'success');
            closePlanEditor();
          }}
          onClose={closePlanEditor}
        />
      )}

      {/* v6.14.0 (Cycle 4 P0-4) 新增：Hooks 事件系统面板 */}
      {hooksPanelOpen && (
        <Cycle3Modal onClose={closeHooksPanel} maxWidth="max-w-4xl">
          <HooksPanel onClose={closeHooksPanel} />
        </Cycle3Modal>
      )}

      {/* v6.15.0 (Cycle 4 P0-4) 新增：SubAgent 记忆查看器 */}
      {subagentMemoryPanelOpen && (
        <Cycle3Modal onClose={closeSubagentMemoryPanel} maxWidth="max-w-5xl">
          <SubAgentMemoryViewer onClose={closeSubagentMemoryPanel} />
        </Cycle3Modal>
      )}

      {/* v1.4.0 (Cycle 5 P0-6) 新增：Hook 触发链路查看器 */}
      {hookChainModal.open && (
        <Cycle3Modal onClose={hookChainModal.onClose} maxWidth="max-w-5xl">
          <HookChainViewer onClose={hookChainModal.onClose} />
        </Cycle3Modal>
      )}

      {cacheStatsModal.open && (
        <Cycle3Modal onClose={cacheStatsModal.onClose} maxWidth="max-w-4xl">
          <CacheStatsPanel onClose={cacheStatsModal.onClose} />
        </Cycle3Modal>
      )}

      {streamListModal.open && (
        <Cycle3Modal onClose={streamListModal.onClose} maxWidth="max-w-6xl">
          <StreamListPanel onClose={streamListModal.onClose} />
        </Cycle3Modal>
      )}

      {oauthConfigModal.open && (
        <OAuthConfigModal onClose={oauthConfigModal.onClose} />
      )}

      {sessionRolloutModal.open && (
        <SessionRolloutPanel onClose={sessionRolloutModal.onClose} />
      )}

      {multiAgentTreeModal.open && (
        <Cycle3Modal onClose={multiAgentTreeModal.onClose} maxWidth="max-w-5xl">
          <MultiAgentTreePanel onClose={multiAgentTreeModal.onClose} />
        </Cycle3Modal>
      )}

      {traceRuleModal.open && (
        <Cycle3Modal onClose={traceRuleModal.onClose} maxWidth="max-w-5xl">
          <RulePanel onClose={traceRuleModal.onClose} />
        </Cycle3Modal>
      )}

      {slashCommandModal.open && (
        <SlashCommandHelp onClose={slashCommandModal.onClose} />
      )}

      {customModelsModal.open && (
        <CustomModelsPanel onClose={customModelsModal.onClose} />
      )}

      {/* v6.36.0 (Cycle 16 P0-1) 新增：Composer 多文件编辑面板
       *  触发：BrandHeader 菜单"⚡ Composer 多文件编辑"项 / Cmd/Ctrl+I 快捷键
       *  关闭：面板内关闭按钮 / Esc 键
       *  位置：根 fragment 末尾，z-index 由 ComposerPanel 自身管理（z-50）
       *  v6.40.0 Cycle 18 P0-3: ErrorBoundary 嵌套，Composer 崩溃不影响主界面 */}
      <ErrorBoundary level="panel" name="ComposerLauncher">
      <ComposerLauncher externalIsOpen={composerOpen} />
      </ErrorBoundary>

      {/* v6.41.0 (Cycle 19 P0-1) 新增：后台任务面板
       *  触发：BrandHeader 菜单"📋 后台任务"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  任务状态由 BackgroundTaskEngine 单例管理（带持久化）
       *  v6.41.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="BackgroundTasks">
        <BackgroundTasksPanel
          isOpen={backgroundTasksOpen}
          onClose={() => setBackgroundTasksOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.42.0 (Cycle 19 P0-2) 新增：Best-of-N 多模型对比面板
       *  触发：BrandHeader 菜单"⚖️ Best-of-N 多模型"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击（运行中禁用关闭）
       *  多模型并行执行由 MultiModelExecutor 单例管理
       *  v6.42.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="BestOfN">
        <BestOfNPanel
          isOpen={bestOfNOpen}
          onClose={() => setBestOfNOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.43.0 (Cycle 19 P0-3) 新增：Design Mode 设计模式覆盖层
       *  触发：BrandHeader 菜单"🎨 Design Mode 设计模式"项
       *  关闭：覆盖层内退出按钮 / Esc 键
       *  元素选择状态由 DesignModeController 单例管理
       *  v6.43.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="DesignMode">
        <DesignModeOverlay
          isActive={designModeOpen}
          onExit={() => setDesignModeOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.45.0 (Cycle 20 P0-1) 新增：Git Worktree 隔离管理面板
       *  触发：BrandHeader 菜单"🌳 Worktree 隔离"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  worktree 状态由 WorktreeManager 单例管理（带持久化）
       *  v6.45.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="Worktree">
        <WorktreePanel
          isOpen={worktreeOpen}
          onClose={() => setWorktreeOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.46.0 (Cycle 20 P0-2) 新增：智能模型路由面板
       *  触发：BrandHeader 菜单"🧠 模型路由"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  路由决策由 ModelRouter 单例管理
       *  v6.46.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="ModelRouter">
        <ModelRouterPanel
          isOpen={modelRouterOpen}
          onClose={() => setModelRouterOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.47.0 (Cycle 20 P0-3) 新增：事件钩子管理面板
       *  触发：BrandHeader 菜单"🪝 事件钩子"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  钩子状态由 HooksEngine 单例管理
       *  v6.47.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="Hooks20">
        <HooksManagerPanel
          isOpen={hooks20Open}
          onClose={() => setHooks20Open(false)}
        />
      </ErrorBoundary>

      {/* v6.48.0 (Cycle 21 P0-1) 新增：Best-of-N × Worktree 协同面板
       *  触发：BrandHeader 菜单"🎯 Best-of-N 协同"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  协同会话由 BestOfNWorktreeCoordinator 单例管理
       *  v6.48.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="BestOfNCoordinator">
        <BestOfNCoordinatorPanel
          isOpen={bestOfNCoordinatorOpen}
          onClose={() => setBestOfNCoordinatorOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.49.0 (Cycle 21 P0-2) 新增：模型路由成本统计 Dashboard
       *  触发：BrandHeader 菜单"💰 模型成本统计"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  统计数据由 ModelCostStatsCollector 单例管理
       *  v6.49.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="ModelRouterStats">
        <ModelRouterStatsPanel
          isOpen={modelRouterStatsOpen}
          onClose={() => setModelRouterStatsOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.50.0 (Cycle 21 P0-4) 新增：Hook 模板市场面板
       *  触发：BrandHeader 菜单"🛒 Hook 模板市场"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  模板通过 HookTemplateMarketplace 单例管理
       *  v6.50.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="HooksMarketplace">
        <HooksMarketplacePanel
          isOpen={hooksMarketplaceOpen}
          onClose={() => setHooksMarketplaceOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.51.0 (Cycle 22 G22-01) 新增：Side Chat 多子对话面板
       *  触发：BrandHeader 菜单"💬 Side Chat 多子对话"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  子对话由 SideChatManager 单例管理
       *  v6.51.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="SideChat">
        <SideChatPanel
          isOpen={sideChatOpen}
          onClose={() => setSideChatOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.52.0 (Cycle 22 G22-02) 新增：成本预测面板
       *  触发：BrandHeader 菜单"📈 成本预测"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  成本预测由 CostPredictor 单例管理
       *  v6.52.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="CostPrediction">
        <CostPredictionPanel
          isOpen={costPredictionOpen}
          onClose={() => setCostPredictionOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.53.0 (Cycle 22 G22-03) 新增：Hook 性能分析面板
       *  触发：BrandHeader 菜单"⚡ Hook 性能分析"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  性能分析由 HookPerformanceAnalyzer 单例管理
       *  v6.53.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="HookPerformance">
        <HookPerformancePanel
          isOpen={hookPerformanceOpen}
          onClose={() => setHookPerformanceOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.54.0 (Cycle 22 G22-04) 新增：模型路由管理面板
       *  触发：BrandHeader 菜单"🛡️ 模型路由管理"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  路由策略由 ModelRouterEnhance 单例管理
       *  v6.54.0: ErrorBoundary 嵌套 */}
      <ErrorBoundary level="panel" name="ModelRouterAdmin">
        <ModelRouterAdminPanel
          isOpen={modelRouterAdminOpen}
          onClose={() => setModelRouterAdminOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.55.0 (Cycle 23 G23-01) 新增：候选学习面板
       *  触发：BrandHeader 菜单"🧠 候选学习"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  学习引擎由 CandidateLearningEngine 单例管理 */}
      <ErrorBoundary level="panel" name="CandidateLearning">
        <CandidateLearningPanel
          isOpen={candidateLearningOpen}
          onClose={() => setCandidateLearningOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.56.0 (Cycle 23 G23-02) 新增：会话回放面板
       *  触发：BrandHeader 菜单"⏮️ 会话回放"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  回放引擎由 SessionReplayEngine 单例管理 */}
      <ErrorBoundary level="panel" name="SessionReplay">
        <SessionReplayPanel
          isOpen={sessionReplayOpen}
          onClose={() => setSessionReplayOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.57.0 (Cycle 23 G23-04) 新增：AI 主动建议面板
       *  触发：BrandHeader 菜单"💡 AI 主动建议"项 / 浮动气泡
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  建议引擎由 ProactiveSuggestionEngine 单例管理 */}
      <ErrorBoundary level="panel" name="ProactiveSuggestion">
        <ProactiveSuggestionPanel
          isOpen={proactiveSuggestionOpen}
          onClose={() => setProactiveSuggestionOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.58.0 (Cycle 24 G24-01) 新增：跨会话记忆面板
       *  触发：BrandHeader 菜单"🧠 全局记忆"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  记忆引擎由 GlobalMemoryEngine 单例管理 */}
      <ErrorBoundary level="panel" name="GlobalMemory">
        <GlobalMemoryPanel
          isOpen={globalMemoryOpen}
          onClose={() => setGlobalMemoryOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.59.0 (Cycle 24 G24-02) 新增：多任务并行编排面板
       *  触发：BrandHeader 菜单"🧠 多任务编排"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  编排器由 MultiTaskOrchestrator 单例管理 */}
      <ErrorBoundary level="panel" name="MultiTaskOrchestration">
        <MultiTaskOrchestrationPanel
          isOpen={multiTaskOpen}
          onClose={() => setMultiTaskOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.60.0 (Cycle 24 G24-04) 新增：Figma 设计稿转代码面板
       *  触发：BrandHeader 菜单"🎨 Figma 转代码"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  适配器由 FigmaAdapter 单例管理，支持 URL 解析 + 节点拉取 + React/Vue/HTML 自动生成 */}
      <ErrorBoundary level="panel" name="FigmaImport">
        <FigmaImportPanel
          isOpen={figmaImportOpen}
          onClose={() => setFigmaImportOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.61.0 (Cycle 25 G25-01) 新增：自动化代码评审面板
       *  触发：BrandHeader 菜单"🔍 代码评审"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  评审引擎由 AutoCodeReviewEngine 单例管理，支持 100+ 内置规则 + JSON/Markdown/SARIF 导出 */}
      <ErrorBoundary level="panel" name="AutoCodeReview">
        <AutoCodeReviewPanel
          isOpen={autoCodeReviewOpen}
          onClose={() => setAutoCodeReviewOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.62.0 (Cycle 25 G25-02) 新增：PR 自动机器人面板
       *  触发：BrandHeader 菜单"🤖 PR Bot"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  PR Bot 引擎由 PRBotEngine 单例管理，支持 PR 事件触发 + 自动 review + 审计日志 */}
      <ErrorBoundary level="panel" name="PRBot">
        <PRBotPanel
          isOpen={prBotOpen}
          onClose={() => setPRBotOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.63.0 (Cycle 25 G25-03) 新增：AI 性能优化器面板
       *  触发：BrandHeader 菜单"⚡ 性能优化"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  优化器由 PerfOptimizerEngine 单例管理，支持 20+ 反模式规则 + 重构 diff + 性能预算 */}
      <ErrorBoundary level="panel" name="PerfOptimizer">
        <PerfOptimizerPanel
          isOpen={perfOptimizerOpen}
          onClose={() => setPerfOptimizerOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.64.0 (Cycle 26 G26-01) 新增：CSV 批处理智能体面板
       *  触发：BrandHeader 菜单"📊 CSV 批处理"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  引擎由 CsvBatchEngine 单例管理，支持 CSV 解析 + 模板渲染 + 并发任务调度 + 进度监控 + 结果导出 */}
      <ErrorBoundary level="panel" name="CsvBatch">
        <CsvBatchPanel
          isOpen={csvBatchOpen}
          onClose={() => setCsvBatchOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.65.0 (Cycle 26 G26-02) 新增：智能审批引擎面板
       *  触发：BrandHeader 菜单"🛡️ 智能审批"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  引擎由 SmartApprovalEngine 单例管理，支持 40+ 内置规则 + JSON DSL + 决策流 + 审计日志 + 人工覆盖 */}
      <ErrorBoundary level="panel" name="SmartApproval">
        <SmartApprovalPanel
          isOpen={smartApprovalOpen}
          onClose={() => setSmartApprovalOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.66.0 (Cycle 26 G26-03) 新增：MTC 多模任务协作面板
       *  触发：BrandHeader 菜单"🎨 MTC 多模任务"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  适配器由 MtcAdapter 单例管理，支持 7 种任务类型 + 10 种文件类型 + 多格式输出 */}
      <ErrorBoundary level="panel" name="MTC">
        <MTCPanel
          isOpen={mtcOpen}
          onClose={() => setMtcOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.67.0 (Cycle 27 G27-01) 新增：嵌套子代理面板
       *  触发：BrandHeader 菜单"🌲 嵌套子代理"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  引擎由 NestedSubAgentEngine 单例管理，支持 3 层嵌套 + 树形/时间线/统计视图 */}
      <ErrorBoundary level="panel" name="NestedSubAgent">
        <NestedSubAgentPanel
          isOpen={nestedSubAgentOpen}
          onClose={() => setNestedSubAgentOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.68.0 (Cycle 27 G27-02) 新增：代理检查点面板
       *  触发：BrandHeader 菜单"📌 代理检查点"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  引擎由 AgentCheckpointEngine 单例管理，支持保存/恢复/重命名/标签/自动清理 */}
      <ErrorBoundary level="panel" name="AgentCheckpoint">
        <AgentCheckpointPanel
          isOpen={agentCheckpointOpen}
          onClose={() => setAgentCheckpointOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.69.0 (Cycle 27 G27-04) 新增：代理消息面板
       *  触发：BrandHeader 菜单"💬 代理消息"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  引擎由 AgentMessagingEngine 单例管理，支持 send_message/followup_task/路径寻址 */}
      <ErrorBoundary level="panel" name="AgentMessaging">
        <AgentMessagingPanel
          isOpen={agentMessagingOpen}
          onClose={() => setAgentMessagingOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.70.0 (Cycle 27 G27-05) 新增：代理模板面板
       *  触发：BrandHeader 菜单"📋 代理模板"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  引擎由 AgentTemplateEngine 单例管理，支持 10 个内置模板 + 5 个社区模板 + 评分 */}
      <ErrorBoundary level="panel" name="AgentTemplate">
        <AgentTemplatePanel
          isOpen={agentTemplateOpen}
          onClose={() => setAgentTemplateOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.71.0 (Cycle 27 G27-06) 新增：远程控制面板
       *  触发：BrandHeader 菜单"📱 远程控制"项
       *  关闭：面板内关闭按钮 / Esc 键 / 背景点击
       *  引擎由 RemoteControlEngine 单例管理，支持 QR 配对 + Thread 迁移 + 远程命令 */}
      <ErrorBoundary level="panel" name="RemoteControl">
        <RemoteControlPanel
          isOpen={remoteControlOpen}
          onClose={() => setRemoteControlOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.72.0 (Cycle 28 G28-01) 新增：技能系统面板
       *  引擎由 SkillEngine 单例管理，支持 SKILL.md + 渐进式披露 + 隐式匹配 + 5 个内置 Skills */}
      <ErrorBoundary level="panel" name="Skills">
        <SkillsPanel
          isOpen={skillsOpen}
          onClose={() => setSkillsOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.73.0 (Cycle 28 G28-02) 新增：成本预算面板
       *  引擎由 CostBudgetEngine 单例管理，支持 fallbackModel + 3层预算 */}
      <ErrorBoundary level="panel" name="CostBudget">
        <CostBudgetPanel
          isOpen={costBudgetOpen}
          onClose={() => setCostBudgetOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.74.0 (Cycle 28 G28-03) 新增：用量归因面板
       *  引擎由 UsageAttributionEngine 单例管理，支持按 agent/task/model 拆分 */}
      <ErrorBoundary level="panel" name="UsageAttribution">
        <UsageAttributionPanel
          isOpen={usageAttributionOpen}
          onClose={() => setUsageAttributionOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.75.0 (Cycle 28 G28-04) 新增：作用域权限面板
       *  引擎由 ScopedPermissionsEngine 单例管理，支持工具/路径/网络 细粒度控制 */}
      <ErrorBoundary level="panel" name="ScopedPermissions">
        <ScopedPermissionsPanel
          isOpen={scopedPermissionsOpen}
          onClose={() => setScopedPermissionsOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.76.0 (Cycle 28 G28-05) 新增：斜杠命令面板
       *  引擎由 SlashCommandEngine 单例管理，支持 /init /status /review /plan /goal */}
      <ErrorBoundary level="panel" name="SlashCommand">
        <SlashCommandPanel
          isOpen={slashCommandOpen}
          onClose={() => setSlashCommandOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.77.0 (Cycle 29 G29-01) 新增：堆叠技能面板
       *  引擎由 StackedSkillEngine 单例管理，支持一次最多 5 个技能堆叠
       *  对应 Claude Code v2.1.199+ Stacked Skills 特性 */}
      <ErrorBoundary level="panel" name="StackedSkills">
        <StackedSkillsPanel
          isOpen={stackedSkillsOpen}
          onClose={() => setStackedSkillsOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.78.0 (Cycle 29 G29-02) 新增：技能市场面板
       *  引擎由 SkillsMarketplace 单例管理，支持浏览/安装/评分/评论
       *  对应 Codex Skills Marketplace + skills-hub.ai */}
      <ErrorBoundary level="panel" name="Marketplace">
        <MarketplacePanel
          isOpen={skillsMarketOpen}
          onClose={() => setSkillsMarketOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.79.0 (Cycle 29 G29-03) 新增：分析聊天面板
       *  引擎由 AnalyticsChat 单例管理，支持自然语言查询用量数据
       *  对应 Claude Code Analytics Chat 特性 */}
      <ErrorBoundary level="panel" name="AnalyticsChat">
        <AnalyticsChatPanel
          isOpen={analyticsChatOpen}
          onClose={() => setAnalyticsChatOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.83.0 (Cycle 30 G30-01) 新增：成本阈值告警面板
       *  引擎由 CostThresholdAlertEngine 单例管理，支持多级阈值、提额申请、强制阻断
       *  对应 Claude Code Admin Console 75%/90%/100% 阈值告警 */}
      <ErrorBoundary level="panel" name="CostThreshold">
        <CostThresholdAlertPanel
          isOpen={costThresholdOpen}
          onClose={() => setCostThresholdOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.84.0 (Cycle 30 G30-02) 新增：动态工作流面板
       *  引擎由 DynamicWorkflowEngine 单例管理，支持 Phase-based 编排、Journal、Resume/Replay
       *  对应 Codex Dynamic Workflows + Phase-based 确定性编排 */}
      <ErrorBoundary level="panel" name="DynamicWorkflow">
        <DynamicWorkflowPanel
          isOpen={dynamicWorkflowOpen}
          onClose={() => setDynamicWorkflowOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.85.0 (Cycle 30 G30-03) 新增：编排多代理面板
       *  引擎由 OrchestratedAgentEngine 单例管理，支持 6 阶段 Orchestrated Mode、角色预设
       *  对应 Codex Orchestrated Mode + Worker/Explorer/Reviewer/Synthesizer 角色 */}
      <ErrorBoundary level="panel" name="OrchestratedAgent">
        <OrchestratedAgentPanel
          isOpen={orchestratedAgentOpen}
          onClose={() => setOrchestratedAgentOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.86.0 (Cycle 31 G31-01) 新增：成本归因面板
       *  引擎由 CostAttributionEngine 单例管理，支持 org/team/project/repo/user 五维归因
       *  对应 Cursor Per-Repository Cost Attribution + Future AGI per-developer virtual keys */}
      <ErrorBoundary level="panel" name="CostAttribution">
        <CostAttributionPanel
          isOpen={costAttributionOpen}
          onClose={() => setCostAttributionOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.87.0 (Cycle 31 G31-02) 新增：远程 Worktree 面板
       *  引擎由 RemoteWorktreeAdapter 单例管理，支持 local/remote/hybrid 后端抽象
       *  对应 Cursor 3 Cloud Agent Handoff + Codex App 跨会话迁移 */}
      <ErrorBoundary level="panel" name="RemoteWorktree">
        <RemoteWorktreePanel
          isOpen={remoteWorktreeOpen}
          onClose={() => setRemoteWorktreeOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.88.0 (Cycle 31 G31-03) 新增：Worktree 状态同步面板
       *  引擎由 WorktreeSyncEngine 单例管理，支持快照/状态广播/冲突检测/跨设备同步
       *  对应 CodexMonitor 多设备同步 + Codex App 跨设备状态广播 */}
      <ErrorBoundary level="panel" name="WorktreeSync">
        <WorktreeSyncPanel
          isOpen={worktreeSyncOpen}
          onClose={() => setWorktreeSyncOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.89.0 (Cycle 32 G32-01) 新增：审计追踪面板
       *  引擎由 AuditTrailEngine 单例管理，支持 HMAC-SHA256 hash chain + SOC 2/ISO 27001/GDPR/EU AI Act 合规报告
       *  对应 SOC 2 CC6.1/CC7.2 + GDPR Art.30 + EU AI Act Art.12 自动事件记录 */}
      <ErrorBoundary level="panel" name="AuditTrail">
        <AuditTrailPanel
          isOpen={auditTrailOpen}
          onClose={() => setAuditTrailOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.90.0 (Cycle 32 G32-02) 新增：单点登录面板
       *  引擎由 SSOEngine 单例管理，支持 OIDC/OAuth 2.0/SAML 2.0/SCIM 2.0
       *  对应 Okta/Azure AD/Auth0 企业级身份认证 + 跨 IdP Federation */}
      <ErrorBoundary level="panel" name="SSO">
        <SSOPanel
          isOpen={ssoOpen}
          onClose={() => setSSOOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.91.0 (Cycle 32 G32-03) 新增：策略规则面板
       *  引擎由 PolicyEngine 单例管理，支持 JSON DSL + Rego 子集双语法 + 5 维作用域
       *  对应 OPA/Cerbos/Casbin 企业级统一策略执行 + Audit Trail 联动 */}
      <ErrorBoundary level="panel" name="Policy">
        <PolicyPanel
          isOpen={policyOpen}
          onClose={() => setPolicyOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.94.0 (Cycle 33 G33-01) 新增：企业全场景工作流面板
       *  引擎由 EnterpriseWorkflowEngine 单例管理，集成 30+ 引擎作为工作流步骤
       *  对应 GitHub Actions / Temporal / Argo Workflows 企业级工作流编排 */}
      <ErrorBoundary level="panel" name="EnterpriseWorkflow">
        <EnterpriseWorkflowPanel
          isOpen={enterpriseWorkflowOpen}
          onClose={() => setEnterpriseWorkflowOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.94.0 (Cycle 33 G33-02) 新增：集成 Dashboard 面板
       *  引擎由 UnifiedDashboardEngine 单例管理，聚合 30+ 引擎关键指标
       *  对应 Grafana / Datadog / New Relic 企业级统一监控仪表盘 */}
      <ErrorBoundary level="panel" name="UnifiedDashboard">
        <UnifiedDashboardPanel
          isOpen={unifiedDashboardOpen}
          onClose={() => setUnifiedDashboardOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.94.0 (Cycle 33 G33-03) 新增：安全审计面板
       *  引擎由 SecurityAuditEngine 单例管理，7 个预置攻击场景 + 应急响应
       *  对应 OWASP ZAP / Burp Suite / Nessus 企业级安全审计与渗透测试 */}
      <ErrorBoundary level="panel" name="SecurityAudit">
        <SecurityAuditPanel
          isOpen={securityAuditOpen}
          onClose={() => setSecurityAuditOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.97.0 (Cycle 34 G34-01) 新增：端云模型路由面板
       *  引擎由 EdgeModelRouterEngine 单例管理，端云智能路由 + Token 预算
       *  对应 Cursor Router 三大优化模式 + Claude Mobile 隐私 Tier */}
      <ErrorBoundary level="panel" name="EdgeModelRouter">
        <EdgeModelRouterPanel
          isOpen={edgeModelRouterOpen}
          onClose={() => setEdgeModelRouterOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.97.0 (Cycle 34 G34-02) 新增：离线优先工作流面板
       *  引擎由 OfflineFirstEngine 单例管理，断网检测 + 本地队列 + CRDT + 引擎降级
       *  对标 Local-First 七大原则 + Trae Solo 离线模式 */}
      <ErrorBoundary level="panel" name="OfflineFirst">
        <OfflineFirstPanel
          isOpen={offlineFirstOpen}
          onClose={() => setOfflineFirstOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.97.0 (Cycle 34 G34-03) 新增：设备集群管理面板
       *  引擎由 DeviceClusterEngine 单例管理，多设备发现 + 任务路由 + 故障转移
       *  对标 mDNS（IETF RFC 6762/6763）+ Trae Solo 三端协同 */}
      <ErrorBoundary level="panel" name="DeviceCluster">
        <DeviceClusterPanel
          isOpen={deviceClusterOpen}
          onClose={() => setDeviceClusterOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.98.0 (Cycle 35 G35-01) 新增：工作流编排面板
       *  引擎由 WorkflowOrchestratorEngine 单例管理，DAG 工作流 + 节点执行 + 实例管理
       *  对标 AutoGen / CrewAI / LangGraph 多智能体工作流 */}
      <ErrorBoundary level="panel" name="WorkflowOrchestrator">
        <WorkflowOrchestratorPanel
          isOpen={workflowOrchestratorOpen}
          onClose={() => setWorkflowOrchestratorOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.98.0 (Cycle 35 G35-02) 新增：智能体通信面板
       *  引擎由 AgentCommunicationEngine 单例管理，A2A 协议 + Pub-Sub + Request-Response
       *  对标 A2A Protocol / MCP Model Context Protocol */}
      <ErrorBoundary level="panel" name="AgentCommunication">
        <AgentCommunicationPanel
          isOpen={agentCommunicationOpen}
          onClose={() => setAgentCommunicationOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.98.0 (Cycle 35 G35-03) 新增：任务检查点面板
       *  引擎由 TaskCheckpointEngine 单例管理，完整/增量快照 + Time Travel + 分支
       *  对标 Temporal / Event Sourcing / Git 风格版本管理 */}
      <ErrorBoundary level="panel" name="TaskCheckpoint">
        <TaskCheckpointPanel
          isOpen={taskCheckpointOpen}
          onClose={() => setTaskCheckpointOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.98.0 (Cycle 35 G35-04) 新增：智能体调度面板
       *  引擎由 AgentSchedulerEngine 单例管理，WFQ/MLFQ/Priority 调度 + 资源池 + 抢占
       *  对标 Kubernetes Scheduler / Airflow DAG 调度器 */}
      <ErrorBoundary level="panel" name="AgentScheduler">
        <AgentSchedulerPanel
          isOpen={agentSchedulerOpen}
          onClose={() => setAgentSchedulerOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.107.0 (Cycle 36 G36-01) 新增：LLM Provider 面板
       *  4 大 Provider (Mock/Anthropic/OpenAI/Ollama) + 统一抽象层
       *  对标 LiteLLM / Vercel AI SDK */}
      <ErrorBoundary level="panel" name="LLMProvider">
        <LLMProviderPanel
          isOpen={llmProviderOpen}
          onClose={() => setLlmProviderOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.107.0 (Cycle 36 G36-02) 新增：Streaming Chat 面板
       *  流式响应 + 实时统计 (TTFT/ITPS) + 暂停/恢复
       *  对标 Vercel AI SDK / OpenAI ChatKit */}
      <ErrorBoundary level="panel" name="StreamingChat">
        <StreamingChatPanel
          isOpen={streamingChatOpen}
          onClose={() => setStreamingChatOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.107.0 (Cycle 36 G36-03) 新增：Multi-Modal 面板
       *  图像/语音/文件处理 + 多模态融合
       *  对标 GPT-4o Vision / Claude Vision */}
      <ErrorBoundary level="panel" name="MultiModal">
        <MultiModalPanel
          isOpen={multiModalOpen}
          onClose={() => setMultiModalOpen(false)}
        />
      </ErrorBoundary>

      {/* v6.108.0 (Cycle 37 G37-01) 新增：RAG 知识库面板
       *  文档管理 + 混合检索 (Vector + BM25) + RRF 融合 + 引用追踪
       *  对标 LangChain RAG / LlamaIndex */}
      {ragPanelOpen && (
        <ErrorBoundary level="panel" name="RAGPanel">
          <RAGPanel onClose={() => setRagPanelOpen(false)} />
        </ErrorBoundary>
      )}

      {/* v6.108.0 (Cycle 37 G37-02) 新增：Tool Use 工具市场面板
       *  工具注册/执行/统计 + OpenAI/Anthropic 协议转换 + 权限管理
       *  对标 OpenAI Function Calling / Anthropic Tool Use */}
      {toolMarketplaceOpen && (
        <ErrorBoundary level="panel" name="ToolMarketplace">
          <ToolMarketplacePanel onClose={() => setToolMarketplaceOpen(false)} />
        </ErrorBoundary>
      )}

      {/* v6.108.0 (Cycle 37 G37-03) 新增：Agent Loop 面板
       *  ReAct / Plan-Execute 双模式 + 中断/恢复 + 检查点管理
       *  对标 LangGraph / AutoGPT / BabyAGI */}
      {agentLoopOpen && (
        <ErrorBoundary level="panel" name="AgentLoop">
          <AgentLoopPanel onClose={() => setAgentLoopOpen(false)} />
        </ErrorBoundary>
      )}

      {/* v6.108.0 (Cycle 37 G37-04) 新增：真实 LLM Provider 面板
       *  DeepSeek + 火山方舟 Coding Plan 真实 API 集成 + 思考模式
       *  对标 LiteLLM / Portkey */}
      {realLLMProviderOpen && (
        <ErrorBoundary level="panel" name="RealLLMProvider">
          <RealLLMProviderPanel onClose={() => setRealLLMProviderOpen(false)} />
        </ErrorBoundary>
      )}

      {/* v6.57.0 (Cycle 23 G24-04) 新增：浮动建议气泡
       *  位置：右下角，仅在有活跃建议时显示
       *  点击展开 AI 主动建议面板 */}
      <FloatingSuggestionBubble onOpenPanel={handleOpenProactiveSuggestion} />
    </div>
      )}
    </>
  );
}
