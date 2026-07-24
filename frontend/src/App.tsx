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
# ============================================================
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  useAgents, useStats, useSessions, useSessionDetail,
  optimizeWithHermes, confirmPlan, chatWithHermesStreaming,
  createSession, deleteSession, updateSession,
  batchDeleteSessions, fetchWorkflowStatus,
  startDesignPhase, confirmDesignPhase, rejectDesignPhase,
} from './hooks/useApi';
import AgentChatCard from './components/AgentChatCard';
import Toast from './components/Toast';
import PlanViewer from './components/PlanViewer';
import ThinkingBlock from './components/ThinkingBlock';
import Sidebar from './components/Sidebar';
import SettingsPanel from './components/SettingsPanel';
import BrandHeader from './components/BrandHeader';
import WelcomeState from './components/WelcomeState';
import MessageBubble from './components/MessageBubble';
import ModeSelector from './components/ModeSelector';
import ProjectSelector from './components/ProjectSelector';
import FileExplorer from './components/FileExplorer';
import CodeViewer from './components/CodeViewer';
import ClarificationCard from './components/ClarificationCard';
import ClarificationModal from './components/ClarificationModal';
import ClarificationProgress from './components/ClarificationProgress';
import ArchitectureDesignModal from './components/ArchitectureDesignModal';
import ReviewReport from './components/ReviewReport';
import PipelineProgress from './components/PipelineProgress';
import GoalProgress from './components/GoalProgress';
import LoopV7Runner from './components/LoopV7Runner';
import type { Agent, Session, LoopWorkflowStatus, ReviewData, PipelineData, GoalData } from './types';

/** localStorage 中保存当前激活会话 ID 的 key */
const LS_CURRENT_SESSION_ID = 'current_session_id';

/** localStorage 中保存应用模式的 key（v3.0.0 新增） */
const LS_APP_MODE = 'app_mode';

/**
 * 对话消息类型定义
 * 扩展：增加 thinking 字段，便于历史会话打开时还原流式思考过程
 * v2.9.2 扩展：增加 error 字段，用于渲染 MessageBubble 错误卡片
 */
interface ChatMessage {
  /** 消息唯一标识 */
  id: string;
  /** 消息角色：user（用户）或 hermes（Hermes） */
  role: 'user' | 'hermes';
  /** 消息文本内容 */
  content: string;
  /** 消息时间戳（毫秒） */
  timestamp: number;
  /** 思考过程内容（仅 hermes 消息有值） */
  thinking?: string;
  /** 流式错误信息（v2.9.2 新增）；非空时表示该消息处理失败 */
  error?: string;
}

/**
 * 格式化 Token 数量，使用 K/M 后缀
 * @param n - Token 数量
 * @returns 格式化后的字符串
 */
function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

/**
 * v3.1.0：从澄清消息内容中提取 AI 需求总结部分
 * 提取 "### 需要您补充以下信息" 之前的所有内容作为 summary
 * 参数：
 *   - content: 完整的澄清消息 Markdown 文本
 * 返回值：提取的 summary 文本（不含澄清问题部分）
 */
function extractSummary(content: string): string {
  const idx = content.indexOf('### 需要您补充以下信息');
  if (idx > 0) return content.substring(0, idx).trim();
  // 兼容纯文本格式：查找 "需要您补充以下信息"
  const idx2 = content.indexOf('需要您补充以下信息');
  if (idx2 > 0) return content.substring(0, idx2).trim();
  return '';
}

/**
 * v3.1.0：从澄清消息内容中解析结构化问题列表
 * 支持的格式：
 *   - Markdown: "- **【维度名】** 问题描述（重要性：high/medium/low）"
 *   - 纯文本: "- 【维度名】 问题描述（重要性：high/medium/low）"
 * 参数：
 *   - content: 完整的澄清消息文本
 * 返回值：解析后的问题数组，每项含 dimension/question/importance
 */
function extractQuestions(content: string): Array<{ dimension: string; question: string; importance: 'high' | 'medium' | 'low' }> {
  const questions: Array<{ dimension: string; question: string; importance: 'high' | 'medium' | 'low' }> = [];
  // 匹配 Markdown 格式：- **【维度名】** 描述（重要性：xxx）
  const mdRegex = /- \*\*【(.+?)】\*\*\s*(.+?)（重要性：(\w+)）/g;
  let match;
  while ((match = mdRegex.exec(content)) !== null) {
    questions.push({
      dimension: match[1],
      question: match[2].trim(),
      importance: match[3] as 'high' | 'medium' | 'low',
    });
  }
  // 若 Markdown 格式未匹配到，尝试纯文本格式
  if (questions.length === 0) {
    const txtRegex = /- 【(.+?)】\s*(.+?)（重要性：(\w+)）/g;
    while ((match = txtRegex.exec(content)) !== null) {
      questions.push({
        dimension: match[1],
        question: match[2].trim(),
        importance: match[3] as 'high' | 'medium' | 'low',
      });
    }
  }
  return questions;
}

export default function App() {
  // ============================================================
  // 状态定义
  // ============================================================

  /** 当前激活的 Session ID（用于后端对话关联） */
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  /** 左侧边栏是否展开（默认展开） */
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
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
  /** Toast 通知：是否可见 */
  const [toastVisible, setToastVisible] = useState(false);
  /** Toast 通知：消息文本 */
  const [toastMessage, setToastMessage] = useState('');
  /** Toast 通知：弹窗类型（success / error / warning / info），默认 success */
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  /**
   * 显示 Toast 通知（v2.8.1 修复：完整透传 type 到 Toast 组件）
   * 位置说明（v2.10.4）：从原「事件处理函数」区上移到此处，
   *   是为了让 handleSessionNotFound（位于 useSessionDetail 调用之前）能直接引用 showToast，
   *   避免 ESLint no-use-before-define 错误。showToast 内部仅依赖稳定的 useState setter，
   *   移位不影响其他调用方。
   * 运行步骤：
   *   1. 设置通知文本 message
   *   2. 设置通知类型 toastType（决定图标与边框颜色）
   *   3. 设置 visible=true 触发 Toast 显示
   * 参数：
   *   - msg: 通知文本
   *   - type: 弹窗类型（success / error / warning / info），默认 success
   */
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setToastVisible(true);
  }, []);

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
  /** PlanViewer：是否可见 */
  const [planVisible, setPlanVisible] = useState(false);
  /** PlanViewer：计划内容 */
  const [planContent, setPlanContent] = useState('');
  /** 是否显示用量监控面板 */
  const [showUsagePanel, setShowUsagePanel] = useState(false);
  /** 是否显示全局设置面板（v2.8.0 新增 - Task 7） */
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  /** 最新一条消息的 ID（用于触发呼吸高光动画） */
  const lastMessageIdRef = useRef<string | null>(null);
  /** v2.10.0：当前选中的项目名称（编程模式下使用） */
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  /** v2.10.0：当前打开的文件路径（编程模式下使用） */
  const [openedFile, setOpenedFile] = useState<string | null>(null);
  /** v2.10.1：文件浏览器显示/隐藏状态（默认 true，编程模式下生效） */
  const [fileExplorerOpen, setFileExplorerOpen] = useState(true);

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

  /** v3.6.0：控制 ClarificationModal 显示/隐藏 */
  const [showClarifyModal, setShowClarifyModal] = useState(false);

  /** v5.7.0：控制 LoopV7Runner 弹窗显示/隐藏 */
  const [showLoopV7Runner, setShowLoopV7Runner] = useState(false);

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
    const storedMode = localStorage.getItem(LS_APP_MODE);
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
    const stored = localStorage.getItem(LS_CURRENT_SESSION_ID);
    if (stored) {
      setCurrentSessionId(stored);
    } else {
      // 自动创建新会话，传递当前 appMode
      createSession({ mode: appMode })
        .then((s) => {
          setCurrentSessionId(s.id);
          localStorage.setItem(LS_CURRENT_SESSION_ID, s.id);
        })
        .catch((e) => {
          console.error('自动创建 Session 失败：', e);
          showToast('会话初始化失败，请刷新页面重试', 'error');
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
   * 关闭 Toast 通知
   */
  const handleToastClose = useCallback(() => {
    setToastVisible(false);
  }, []);

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
    localStorage.setItem(LS_APP_MODE, mode);
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
    localStorage.setItem(LS_APP_MODE, mode);
    setAppMode(mode);
    // 加载新模式下最近一条会话
    // useSessions 的 mode 参数变化后会自动 refetch，
    // 在 sessions 更新后从列表中取最近一条切换
    // 此处先清空当前会话，避免旧模式残留
    setCurrentSessionId(null);
    localStorage.removeItem(LS_CURRENT_SESSION_ID);
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
   * v2.10.2 新增：BrandHeader 模式切换 pill 点击回调
   * 行为：chat ↔ coding 交替切换
   *   - 当前 chat  → 切到 coding（用户切回编程模式时，若 selectedProject 仍存在则恢复项目视图，否则进入 ProjectSelector）
   *   - 当前 coding → 切到 chat（保留 selectedProject / openedFile / currentSessionId）
   *   - 其他（null） → 保持 null
   * 运行步骤：
   *   1. 读取当前 appMode
   *   2. 计算新 mode
   *   3. 同步 localStorage
   *   4. setAppMode 触发重渲染
   * 注意：与 handleModeSwitch 不同，本回调**不**清空 currentSessionId 与
   *       selectedProject / openedFile，确保切换无缝衔接
   */
  const handleSwitchMode = useCallback(() => {
    setAppMode(prev => {
      if (prev === 'chat') {
        try { localStorage.setItem(LS_APP_MODE, 'coding'); } catch { /* ignore */ }
        return 'coding';
      } else if (prev === 'coding') {
        try { localStorage.setItem(LS_APP_MODE, 'chat'); } catch { /* ignore */ }
        return 'chat';
      }
      return prev;
    });
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
    localStorage.setItem(LS_CURRENT_SESSION_ID, id);
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
    try {
      const newSession = await createSession({ mode: appMode });
      setCurrentSessionId(newSession.id);
      localStorage.setItem(LS_CURRENT_SESSION_ID, newSession.id);
      setMessages([]);
      setPlanVisible(false);
      setPlanContent('');
      setExpandedAgentId(null);
      // 刷新边栏列表
      refetchSessions();
    } catch (e) {
      showToast(`新建任务失败：${(e as Error).message}`, 'error');
    }
  }, [appMode, refetchSessions, showToast]);

  /**
   * v5.7.0：打开 Loop v7 端到端工作流弹窗
   * 调用方：BrandHeader 三个点下拉菜单中的"🚀 Loop v7 工作流"项
   * 行为：setShowLoopV7Runner(true) 弹出 LoopV7Runner 端到端运行器
   */
  const handleOpenLoopV7 = useCallback(() => {
    setShowLoopV7Runner(true);
  }, []);

  /**
   * 删除会话
   * 运行步骤：
   *   1. 二次确认
   *   2. 调用 deleteSession API
   *   3. 若删除的是当前激活会话：自动创建新 Session
   *   4. 刷新边栏列表
   */
  const handleDeleteSession = useCallback(async (id: string) => {
    if (!confirm('确定删除此会话？所有对话记录将被清除')) return;
    try {
      await deleteSession(id);
      showToast('会话已删除', 'success');
      // 刷新边栏
      refetchSessions();
      // 若删除的是当前会话，自动创建新会话
      if (id === currentSessionId) {
        const newSess = await createSession({ mode: appMode! });
        setCurrentSessionId(newSess.id);
        localStorage.setItem(LS_CURRENT_SESSION_ID, newSess.id);
        setMessages([]);
        setPlanVisible(false);
        setPlanContent('');
        setExpandedAgentId(null);
        refetchSessions();
      }
    } catch (e) {
      showToast(`删除失败：${(e as Error).message}`, 'error');
    }
  }, [currentSessionId, refetchSessions, showToast]);

  /**
   * 批量删除会话（v2.7.0 新增）
   * 运行步骤：
   *   1. 调用 batchDeleteSessions API 软删除所选会话
   *   2. 显示成功 Toast
   *   3. 刷新边栏会话列表
   *   4. 若删除的会话包含当前激活会话，自动创建新 Session
   */
  const handleBatchDelete = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const result = await batchDeleteSessions(ids);
      showToast(result.message || `已批量删除 ${result.deleted_count} 个会话`, 'success');
      // 刷新边栏列表
      refetchSessions();
      // 若删除的会话中包含当前激活会话，自动创建新会话
      if (ids.includes(currentSessionId!)) {
        const newSess = await createSession({ mode: appMode! });
        setCurrentSessionId(newSess.id);
        localStorage.setItem(LS_CURRENT_SESSION_ID, newSess.id);
        setMessages([]);
        setPlanVisible(false);
        setPlanContent('');
        setExpandedAgentId(null);
        refetchSessions();
      }
    } catch (e) {
      showToast(`批量删除失败：${(e as Error).message}`, 'error');
    }
  }, [currentSessionId, refetchSessions, showToast]);

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
   * 运行步骤：
   *   1. 校验输入内容非空
   *   2. 清空输入框，设置发送状态
   *   3. 调用 sendStreamingMessage 执行流式对话
   */
  const handleSendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;

    setInputValue('');
    setIsSending(true);
    await sendStreamingMessage(trimmed);
  }, [inputValue, isSending, sendStreamingMessage]);

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
   * 处理优化请求（通过对话触发）
   * 运行步骤：
   *   - 聊天模式下跳过优化逻辑（仅编程模式可用）
   *   1. 调用 optimizeWithHermes API，透传 session_id
   *   2. 显示 Toast 通知
   *   3. 如果返回计划内容，展示 PlanViewer
   */
  const handleOptimize = useCallback(async (rawPrompt: string) => {
    // v3.0.0：聊天模式下跳过优化逻辑
    if (appMode === 'chat') {
      showToast('优化提示词功能仅在编程模式下可用', 'warning');
      return;
    }
    try {
      const result = await optimizeWithHermes(rawPrompt, currentSessionId);
      showToast('提示词优化完成', 'success');

      // 如果返回了计划内容，展示 PlanViewer
      if (result.plan_content) {
        setPlanContent(result.plan_content);
        setPlanVisible(true);
      }

      // 刷新智能体列表（可能有新创建的 CLI 实例）
      refetchAgents();
      refetchStats();
      // 刷新边栏会话列表
      refetchSessions();
    } catch (e) {
      showToast(`优化失败：${(e as Error).message}`, 'error');
    }
  }, [appMode, currentSessionId, refetchAgents, refetchStats, refetchSessions, showToast]);

  /**
   * 确认执行计划
   * 运行步骤：
   *   1. 调用 confirmPlan API，透传 session_id
   *   2. 关闭 PlanViewer
   *   3. 显示执行开始通知
   *   4. 刷新智能体列表
   */
  const handleConfirmPlan = useCallback(async () => {
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
    }
  }, [planContent, currentSessionId, refetchAgents, refetchStats, refetchSessions, showToast]);

  /**
   * 切换智能体卡片展开/收起
   */
  const handleToggleExpand = useCallback((agentId: string) => {
    setExpandedAgentId(prev => prev === agentId ? null : agentId);
  }, []);

  /**
   * 智能体变更后刷新
   */
  const handleAgentChanged = useCallback(() => {
    refetchAgents();
    refetchStats();
  }, [refetchAgents, refetchStats]);

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
      {/* Toast 通知弹窗 */}
      <Toast message={toastMessage} visible={toastVisible} type={toastType} onClose={handleToastClose} />

      {/* PlanViewer 计划展示弹窗 - 仅在编程模式下显示 */}
      {appMode === 'coding' && !selectedProject && (
        <PlanViewer
          content={planContent}
          visible={planVisible}
          onConfirm={handleConfirmPlan}
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
      {/* 左侧边栏：会话历史 */}
      {/* ============================================================ */}
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={handleToggleSidebar}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onBatchDelete={handleBatchDelete}
        loading={sessionsLoading}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewTask={handleNewTask}
        appMode={appMode!}
        onModeSwitch={handleModeSwitch}
      />

      {/* ============================================================ */}
      {/* 主内容区域：settingsOpen 时显示设置面板，否则显示对话界面 */}
      {/* ============================================================ */}
      {settingsOpen ? (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          showToast={showToast}
        />
      ) : (
        <div className="flex-1 flex flex-col min-w-0">
        {/* v2.10.0：编程模式 + 文件打开 → 垂直分屏布局 */}
        {appMode === 'coding' && selectedProject && openedFile ? (
          <>
            {/* CodeViewer 上半部分 */}
            <div className="flex-1 min-h-0 border-b border-surface-300 overflow-hidden" style={{ flexBasis: '50%' }}>
              <CodeViewer
                project={selectedProject}
                filePath={openedFile}
                onClose={() => setOpenedFile(null)}
              />
            </div>
            {/* 紧凑聊天区 下半部分 */}
            <div className="flex flex-col bg-surface-100" style={{ flexBasis: '50%', minHeight: 0 }}>
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5
                              border-b border-surface-300/30">
                <span className="text-xs font-medium text-surface-600">💬 对话</span>
                {appMode === 'coding' && selectedProject && (
                  <span className="text-xs text-surface-500 truncate ml-2">项目：{selectedProject}</span>
                )}
              </div>
              {/* 紧凑消息区 */}
              <div className="flex-1 overflow-y-auto px-3 py-2">
                {/* v3.1.0：需求澄清进度条（仅在 clarifying 阶段显示） */}
                {workflowStatus?.current_stage === 'clarifying' && (
                  <ClarificationProgress
                    roundNumber={clarificationData?.roundNumber || 1}
                    maxRounds={clarificationData?.maxRounds || 5}
                    isComplete={clarificationData?.isComplete || false}
                  />
                )}
                {/* v1.9.0：Loop Engineering 工作流展示组件 */}
                {reviewData && <ReviewReport reviewData={reviewData} />}
                {pipelineData && <PipelineProgress pipelineData={pipelineData} />}
                {goalData && <GoalProgress goalData={goalData} />}
                <div className="space-y-3">
                  {messages.length === 0 && !detailLoading && (
                    <div className="text-xs text-surface-500 text-center py-4">
                      输入消息开始对话
                    </div>
                  )}
                  {detailLoading && messages.length === 0 && (
                    <div className="space-y-2">
                      <div className="skeleton h-10 w-3/4 rounded-lg" />
                      <div className="skeleton h-10 w-2/3 rounded-lg ml-auto" />
                    </div>
                  )}
                  {messages.map(msg => {
                    if (msg.error) {
                      return (
                        <div key={msg.id} className="animate-msg-enter">
                          <MessageBubble role="assistant" content="" error={msg.error} />
                        </div>
                      );
                    }
                    return (
                      <div key={msg.id} className={`flex animate-msg-enter ${msg.id === lastMessageIdRef.current ? 'msg-breath' : ''}`}>
                        {msg.role === 'hermes' && (
                          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-hermes-500 to-hermes-600 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5 shadow-sm">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          </div>
                        )}
                        <div className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed ${msg.role === 'user' ? 'bg-hermes-500 text-white rounded-br-sm ml-auto' : 'bg-surface-200 text-surface-800 rounded-bl-sm border border-surface-400/50'}`}>
                          {(msg.id === streamingMessageId || msg.thinking) && (
                            <ThinkingBlock content={msg.id === streamingMessageId ? thinkingContent : (msg.thinking || '')} isStreaming={msg.id === streamingMessageId && streamingStatus === 'thinking'} />
                          )}
                          {msg.content && (
                            <div className="whitespace-pre-wrap break-words">{msg.content}
                              {msg.role === 'hermes' && msg.id === streamingMessageId && streamingStatus === 'answering' && (
                                <span className="inline-block w-0.5 h-3 bg-hermes-400 ml-0.5 align-text-bottom animate-pulse" />
                              )}
                            </div>
                          )}
                          {!msg.content && msg.role === 'hermes' && msg.id === streamingMessageId && streamingStatus === 'thinking' && (
                            <div className="text-surface-500 italic text-xs">等待回复中...</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* v3.6.0：基于 clarificationData 结构化数据渲染交互式澄清卡片（每轮渲染一次） */}
                  {showClarifyModal && clarificationData && (clarificationData.questions.length > 0 || clarificationData.isComplete) && (
                    <ClarificationModal
                      key={clarificationData.roundNumber}
                      summary={clarificationData.summary}
                      questions={clarificationData.questions}
                      roundNumber={clarificationData.roundNumber}
                      maxRounds={clarificationData.maxRounds}
                      isComplete={clarificationData.isComplete}
                      workflowId={workflowIdRef.current || sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id}
                      onSubmit={(answersText) => {
                        // 将汇总的结构化回答作为一条用户消息发送，触发下一轮澄清
                        handleSendClarifyAnswer(answersText);
                        setShowClarifyModal(false);
                      }}
                      onConfirm={async (wfId?: string) => {
                        // v2.0.4 修复：直接使用 ClarificationCard 传入的 workflowId，消除闭包问题
                        // v5.6.0 修复（Bug：跳过按钮无防重入，导致重复请求 designing→prompting 校验失败）：
                        //   添加 inFlightRef 守卫，单次点击只发起一次请求
                        if (skipConfirmInFlightRef.current) {
                          return;
                        }
                        const id = wfId || workflowIdRef.current || workflowStatus?.workflow_id;
                        if (id) {
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
                              return; // 保持弹窗打开
                            }
                            // 刷新工作流状态
                            setShowClarifyModal(false);
                            refetchSessions();
                            // v2.0.0 新增：启动架构设计阶段
                            setTimeout(() => handleStartDesignPhase(), 500);
                          } finally {
                            skipConfirmInFlightRef.current = false;
                          }
                        }
                      }}
                      onContinueAdd={() => {
                        setShowClarifyModal(false);
                        inputRef.current?.focus();
                      }}
                    />
                  )}
                  {/* v2.0.0 新增：架构设计批判迭代模态弹窗 */}
                  {showDesignModal && (
                    <ArchitectureDesignModal
                      requirementV2={designModalData?.requirementV2 || ''}
                      critiqueResult={designModalData?.critiqueResult || null}
                      isLoading={isDesignLoading}
                      iterationCount={designModalData?.iterationCount || 1}
                      maxIterations={designModalData?.maxIterations || 3}
                      onConfirm={handleConfirmDesign}
                      onReject={handleRejectDesign}
                    />
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>
              {/* 紧凑输入区 */}
          <div className="flex-shrink-0 px-3 pb-2 pt-1 border-t border-surface-300/30">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                disabled={isSending}
                rows={1}
                className="flex-1 resize-none bg-surface-200 border border-surface-400/50 rounded-xl px-3 py-1.5
                           text-sm text-surface-800 placeholder:text-surface-500
                           outline-none focus:border-hermes-500 focus:shadow-glow-hermes-sm
                           max-h-24 min-h-[28px] disabled:opacity-60 leading-5
                           transition-all duration-default ease-material"
              />
              <button
                onClick={isSending ? handleStop : handleSendMessage}
                disabled={!inputValue.trim() && !isSending}
                className="w-8 h-8 rounded-full bg-gradient-to-br from-hermes-500 to-hermes-600
                           hover:from-hermes-600 hover:to-hermes-700
                           disabled:from-surface-300 disabled:to-surface-300
                           text-white flex items-center justify-center flex-shrink-0
                           shadow-level-1 transition-all duration-default ease-material active:scale-[0.97]"
                aria-label={isSending ? '停止' : '发送'}
              >
                {isSending ? (
                  <svg className="w-3 h-3" fill="white" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                    <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
          </div>
            </div>
          </>
        ) : (
        <>
        {/* ============================================================ */}
        {/* 顶部：v2.9.0 替换为极简 BrandHeader（豆包风格） */}
        {/* v2.10.1：新增 onOpenFileExplorer + fileExplorerOpen 透传 */}
        {/* v2.10.2：appMode 改为可空安全传递 + 新增 onSwitchMode 透传 */}
        {/* v2.10.3：取消 onSwitchMode 透传（pill 已删除，handleSwitchMode 函数仍保留以备复用） */}
        {/* ============================================================ */}
        <BrandHeader
          sessionTitle={currentSession?.title || '新对话'}
          onNewChat={handleNewTask}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenUsage={() => setShowUsagePanel(prev => !prev)}
          onOpenFileExplorer={() => setFileExplorerOpen(prev => !prev)}
          fileExplorerOpen={fileExplorerOpen}
          onOpenLoopV7={handleOpenLoopV7}
        />

        {/* ============================================================ */}
        {/* 中间：对话消息区域（v2.9.0 - 贴底浮动输入区，主区 pb-40 留出空间） */}
        {/* ============================================================ */}
        <main className="flex-1 overflow-y-auto px-3 md:px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {/* v3.1.0：需求澄清进度条（仅在 clarifying 阶段显示） */}
            {workflowStatus?.current_stage === 'clarifying' && (
              <ClarificationProgress
                roundNumber={clarificationData?.roundNumber || 1}
                maxRounds={clarificationData?.maxRounds || 5}
                isComplete={clarificationData?.isComplete || false}
              />
            )}
            {/* v1.9.0：Loop Engineering 工作流展示组件 */}
            {reviewData && <ReviewReport reviewData={reviewData} />}
            {pipelineData && <PipelineProgress pipelineData={pipelineData} />}
            {goalData && <GoalProgress goalData={goalData} />}
            {/* 启动欢迎页（v2.9.0 - Task 2：替换原 inline 欢迎块） */}
            {messages.length === 0 && !detailLoading && (
              <WelcomeState
                onSelectPrompt={(p) => {
                  setInputValue(p);
                  inputRef.current?.focus();
                }}
              />
            )}

            {/* 加载详情中的骨架占位 */}
            {detailLoading && messages.length === 0 && (
              <div className="space-y-3">
                <div className="skeleton h-16 w-3/4" />
                <div className="skeleton h-16 w-2/3 ml-auto" />
                <div className="skeleton h-16 w-4/5" />
              </div>
            )}

            {/* 对话消息列表 */}
            {messages.map(msg => {
              // v2.9.2：error 字段非空时直接渲染 MessageBubble 错误卡片
              if (msg.error) {
                return (
                  <div
                    key={msg.id}
                    className="animate-msg-enter"
                  >
                    <MessageBubble
                      role="assistant"
                      content=""
                      error={msg.error}
                    />
                  </div>
                );
              }
              return (
              <div
                key={msg.id}
                className={`flex animate-msg-enter ${msg.id === lastMessageIdRef.current ? 'msg-breath' : ''} ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {/* Hermes 头像（左对齐消息） */}
                {msg.role === 'hermes' && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-hermes-500 to-hermes-600 flex items-center justify-center flex-shrink-0 mr-3 mt-1 shadow-md shadow-hermes-900/20">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                )}

                {/* 消息气泡 */}
                <div
                  className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                    ${msg.role === 'user'
                      ? 'bg-hermes-500 text-white rounded-br-md'
                      : 'bg-surface-200 text-surface-900 rounded-bl-md border border-surface-400/50'
                    }`}
                >
                  {/* Hermes 消息状态指示器（仅流式消息显示） */}
                  {msg.role === 'hermes' && msg.id === streamingMessageId && streamingStatus && (
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-surface-400/30">
                      {streamingStatus === 'thinking' && (
                        <>
                          <svg className="animate-spin w-3.5 h-3.5 text-hermes-400" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
                          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-xs text-emerald-400 font-medium">回答完成</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* 思考过程折叠块（流式消息 或 历史消息含 thinking 都显示） */}
                  {(msg.id === streamingMessageId || msg.thinking) && (
                    <ThinkingBlock
                      content={msg.id === streamingMessageId ? thinkingContent : (msg.thinking || '')}
                      isStreaming={msg.id === streamingMessageId && streamingStatus === 'thinking'}
                    />
                  )}

                  {/* 消息正文 */}
                  {msg.content && (
                    <div className="whitespace-pre-wrap break-words">
                      {msg.content}
                      {/* 回答中闪烁光标 */}
                      {msg.role === 'hermes' && msg.id === streamingMessageId && streamingStatus === 'answering' && (
                        <span className="inline-block w-0.5 h-4 bg-hermes-400 ml-0.5 align-text-bottom animate-pulse" />
                      )}
                    </div>
                  )}

                  {/* 空内容占位（流式等待中） */}
                  {!msg.content && msg.role === 'hermes' && msg.id === streamingMessageId && streamingStatus === 'thinking' && (
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

                {/* 用户头像（右对齐消息） */}
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-surface-400 flex items-center justify-center flex-shrink-0 ml-3 mt-1">
                    <svg className="w-4 h-4 text-surface-800" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
              );
            })}

            {/* v3.6.0：基于 clarificationData 结构化数据渲染交互式澄清卡片（每轮渲染一次） */}
            {showClarifyModal && clarificationData && (clarificationData.questions.length > 0 || clarificationData.isComplete || clarificationData.roundNumber >= 3) && (
              <ClarificationModal
                key={clarificationData.roundNumber}
                summary={clarificationData.summary}
                questions={clarificationData.questions}
                roundNumber={clarificationData.roundNumber}
                maxRounds={clarificationData.maxRounds}
                isComplete={clarificationData.isComplete}
                workflowId={workflowIdRef.current || sessionDetail?.session?.workflow_id || workflowStatus?.workflow_id}
                onSubmit={(answersText) => {
                  // 将汇总的结构化回答作为一条用户消息发送，触发下一轮澄清
                  handleSendClarifyAnswer(answersText);
                  setShowClarifyModal(false);
                }}
                onConfirm={async (wfId?: string) => {
                  // v2.0.4 修复：直接使用 ClarificationCard 传入的 workflowId，消除闭包问题
                  // v5.6.0 修复（Bug：跳过按钮无防重入）：与编程模式同源守卫，避免双击触发
                  //   后端 designing→prompting 阶段边界校验失败
                  if (skipConfirmInFlightRef.current) {
                    return;
                  }
                  const id = wfId || workflowIdRef.current || workflowStatus?.workflow_id;
                  if (id) {
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
                        return; // 保持弹窗打开
                      }
                      setShowClarifyModal(false);
                      refetchSessions();
                      // v2.0.0 新增：启动架构设计阶段
                      setTimeout(() => handleStartDesignPhase(), 500);
                    } finally {
                      skipConfirmInFlightRef.current = false;
                    }
                  }
                }}
                onContinueAdd={() => {
                  setShowClarifyModal(false);
                  inputRef.current?.focus();
                }}
              />
            )}
            {/* v2.0.0 新增：架构设计批判迭代模态弹窗 */}
            {showDesignModal && (
              <ArchitectureDesignModal
                requirementV2={designModalData?.requirementV2 || ''}
                critiqueResult={designModalData?.critiqueResult || null}
                isLoading={isDesignLoading}
                iterationCount={designModalData?.iterationCount || 1}
                maxIterations={designModalData?.maxIterations || 3}
                onConfirm={handleConfirmDesign}
                onReject={handleRejectDesign}
              />
            )}

            {/* 自动滚动锚点 */}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* ============================================================ */}
        {/* 子 CLI 实例状态展示区域（AgentChatCard 网格） */}
        {/* 优先使用 sessionDetail.agents（按 session 隔离），fallback 到全局 agents */}
        {/* ============================================================ */}
        {displayAgents.length > 0 && (
          <div className="border-t border-surface-300 bg-surface-100/50 px-3 md:px-4 py-4 flex-shrink-0">
            <div className="max-w-3xl mx-auto">
              <h3 className="text-xs font-medium text-surface-600 uppercase tracking-wider mb-3">
                子 CLI 实例状态 ({displayAgents.length})
              </h3>
              {loading ? (
                <div className="py-2">
                  <div className="skeleton h-4 w-32" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {displayAgents.map(agent => (
                    <AgentChatCard
                      key={agent.id}
                      agent={agent}
                      isExpanded={expandedAgentId === agent.id}
                      onToggleExpand={() => handleToggleExpand(agent.id)}
                      onAgentChanged={handleAgentChanged}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* v4.5.2 - 输入区固定底部：flex-shrink-0 确保输入框始终可见 */}
        {/* 关键点：脱离 mt-auto 定位，作为 flex 容器末尾元素；           */}
        {/*   flex-shrink-0 保证不被消息区压缩，始终固定在可视区底部。    */}
        {/* 玻璃拟态、圆角、阴影、焦点光环、发送/停止按钮全部保留。        */}
        {/* ============================================================ */}
        <div className="flex-shrink-0 px-4">
          <div className="max-w-3xl mx-auto">
            <div
              className="bg-white/90 backdrop-blur-md border border-surface-200
                         rounded-3xl shadow-level-3 px-4 py-3
                         focus-within:shadow-glow-hermes focus-within:border-hermes-300
                         transition-all duration-default ease-material"
            >
              <div className="flex items-end gap-3">
                {/* 消息输入框：textarea auto-resize（max-h-32） */}
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
                  disabled={isSending}
                  rows={1}
                  className="flex-1 resize-none bg-transparent border-none outline-none
                             text-base text-surface-900 placeholder:text-surface-400
                             max-h-32 min-h-[24px] disabled:opacity-60 leading-7"
                />
                {/* 发送 / 停止按钮：发送中切换为 Square 图标并触发 handleStop */}
                <button
                  onClick={isSending ? handleStop : handleSendMessage}
                  disabled={!inputValue.trim() && !isSending}
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-hermes-500 to-hermes-600
                             hover:from-hermes-600 hover:to-hermes-700
                             disabled:from-surface-300 disabled:to-surface-300
                             text-white flex items-center justify-center
                             shadow-level-1 hover:shadow-level-2
                             transition-all duration-default ease-material
                             active:scale-[0.97]"
                  aria-label={isSending ? '停止生成' : '发送消息'}
                  title={isSending ? '停止生成' : '发送消息'}
                >
                  {isSending ? (
                    // Square 停止图标
                    <svg className="w-4 h-4" fill="white" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  ) : (
                    // Send 发送图标（飞机）
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                         strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                      <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
          </>
          )}
      </div>
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
              onClose={() => setFileExplorerOpen(false)}
            />
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 右侧面板：用量监控面板（预留位置） */}
      {/* ============================================================ */}
      {showUsagePanel && (
        <aside className="w-full md:w-80 bg-surface-100 border-t md:border-l border-surface-300 flex-shrink-0 overflow-y-auto
                          fixed bottom-0 left-0 right-0 md:static z-30 max-h-[60vh] md:max-h-none
                          rounded-t-2xl md:rounded-none shadow-2xl md:shadow-none">
          {/* 移动端拖拽手柄 */}
          <div className="flex justify-center pt-2 pb-1 md:hidden">
            <div className="w-10 h-1 rounded-full bg-surface-500/60" />
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-surface-900">用量监控</h2>
              <button
                onClick={() => setShowUsagePanel(false)}
                className="w-6 h-6 rounded flex items-center justify-center text-surface-600 hover:text-surface-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 用量数据卡片 */}
            <div className="space-y-3">
              {/* API 调用次数 */}
              <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
                <div className="text-xs text-surface-600 mb-1">API 调用次数（近 5 小时）</div>
                <div className="text-2xl font-bold text-hermes-400">
                  {stats ? stats.resources.total_api_calls.toLocaleString() : '--'}
                </div>
                <div className="mt-2 w-full bg-surface-300 rounded-full h-1.5">
                  <div className="bg-hermes-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((stats ? stats.resources.total_api_calls / 10000 * 100 : 0), 100)}%` }} />
                </div>
                <div className="text-xs text-surface-500 mt-1">
                  配额 10,000 · 已用 {stats ? ((stats.resources.total_api_calls / 10000 * 100).toFixed(1)) : '0'}%
                </div>
              </div>

              {/* Token 消耗 */}
              <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
                <div className="text-xs text-surface-600 mb-1">累计 Token 消耗</div>
                <div className="text-2xl font-bold text-emerald-400">
                  {stats ? formatTokens(stats.resources.total_tokens) : '--'}
                </div>
              </div>

              {/* 剩余可用调用 */}
              <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
                <div className="text-xs text-surface-600 mb-1">剩余可用调用次数</div>
                <div className="text-2xl font-bold text-hermes-400">
                  {stats ? (10000 - stats.resources.total_api_calls).toLocaleString() : '--'}
                </div>
                <div className="mt-2 w-full bg-surface-300 rounded-full h-1.5">
                  <div className="bg-hermes-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${stats ? Math.max(0, (10000 - stats.resources.total_api_calls) / 10000 * 100).toFixed(1) : 0}%` }} />
                </div>
                <div className="text-xs text-surface-500 mt-1">
                  剩余 {stats ? ((10000 - stats.resources.total_api_calls) / 10000 * 100).toFixed(1) : '0'}%
                </div>
              </div>

              {/* 任务统计 */}
              {stats && (
                <div className="bg-surface-200 rounded-xl p-4 border border-surface-400/50">
                  <div className="text-xs text-surface-600 mb-2">任务统计</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-surface-700">总任务数</span>
                      <span className="text-surface-900">{stats.tasks.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700">已完成</span>
                      <span className="text-emerald-400">{stats.tasks.completed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700">执行中</span>
                      <span className="text-hermes-400">{stats.tasks.running}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700">失败</span>
                      <span className="text-red-400">{stats.tasks.failed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700">完成率</span>
                      <span className="text-surface-900">{(stats.tasks.completion_rate * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="w-full bg-surface-300 rounded-full h-1.5">
                      <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${(stats.tasks.completion_rate * 100).toFixed(1)}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
        </>
        )}

      {/* v5.7.0：Loop v7 端到端工作流弹窗
       * 触发：BrandHeader 菜单"🚀 Loop v7 工作流"项 → handleOpenLoopV7
       * 关闭：LoopV7Runner 内部 onClose 回调 setShowLoopV7Runner(false)
       * 位置：根 fragment 末尾，z-index 由 LoopV7Runner 自身管理（z-50） */}
      {showLoopV7Runner && (
        <LoopV7Runner onClose={() => setShowLoopV7Runner(false)} />
      )}
    </div>
      )}
    </>
  );
}
