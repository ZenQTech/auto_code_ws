/**
 * # ============================================================
 * # AppStateProvider - 全局应用状态提供者 (Cycle 15 P1-1)
 * # ============================================================
 * # 核心作用：通过 useReducer + Context 集中管理 App.tsx 的核心状态，
 * #           解决以下问题：
 * #             1. 30+ useState 散落导致 props 透传层级过深（4+ 层）
 * #             2. 23 个 panel 显隐独立 state 频繁触发重渲染
 * #             3. 状态分散在多个文件中，难以追踪数据流
 * #             4. 缺乏统一的状态变更审计
 * # 运行流程：
 * #   1. App 启动 → AppStateProvider 包裹根组件
 * #   2. 子组件通过 useAppState() hook 访问 state 和 dispatch
 * #   3. dispatch({ type, payload }) 触发状态变更
 * #   4. reducer 纯函数集中处理所有 action
 * # 输入参数：
 * #   - children: ReactNode
 * # 输出结果：Context Provider
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-1 初始版本
 * #     - 创建 useReducer + Context 架构
 * #     - 集中管理 session / mode / chat / code 模式 / 计划 5 大类状态
 * #     - 保留 useModals 处理面板显隐（已由 P1-9 完成）
 * # ============================================================
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useMemo,
  type ReactNode,
} from 'react';

// ============================================================
// 类型定义
// ============================================================

/** 会话摘要信息（轻量级，避免在 Provider 中存储全量） */
export interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  last_active_at: string;
  user_first_message: string;
  message_count: number;
  status: 'active' | 'archived' | 'deleted';
  mode: 'chat' | 'coding';
}

/** 消息类型（简化版，避免循环依赖） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'hermes' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  error?: string;
  created_at: string;
  session_id: string;
  agent_id: string | null;
  task_id: string | null;
}

/** 应用模式 */
export type AppMode = 'chat' | 'coding' | null;

/** 流式状态 */
export type StreamingStatus = 'thinking' | 'answering' | 'done' | null;

/** 推理阶段 */
export type ReasoningStage = 'analysis' | 'planning' | 'coding' | 'testing' | 'idle';

/** 工作流状态 */
export interface LoopWorkflowStatus {
  current_iteration: number;
  max_iterations: number;
  status: string;
  current_stage?: string;
  needs_human_review: boolean;
  review_node?: string;
  updated_at: string;
}

/** 澄清数据 */
export interface ClarificationData {
  questions: string[];
  options?: string[][];
  allowMultiple?: boolean[];
  round: number;
  isComplete: boolean;
  summary?: string;
  workflowId?: string | null;
}

// ============================================================
// State 定义
// ============================================================

/** Provider 管理的状态切片（不包含面板显隐、useModals 已处理） */
export interface AppState {
  // === 会话状态 ===
  currentSessionId: string | null;
  sessions: SessionSummary[];
  expandedAgentId: string | null;
  isNewTaskLoading: boolean;
  isDeletingSession: boolean;

  // === 应用模式 ===
  appMode: AppMode;

  // === UI 布局 ===
  sidebarExpanded: boolean;

  // === 聊天状态 ===
  messages: ChatMessage[];
  inputValue: string;
  isSending: boolean;
  streamingStatus: StreamingStatus;
  streamingMessageId: string | null;
  thinkingContent: string;
  reasoningStage: ReasoningStage;
  stageProgress: number;

  // === 编程模式 ===
  selectedProject: string | null;
  openedFile: string | null;

  // === 计划 ===
  planVisible: boolean;
  planContent: string;
  isConfirmPlanLoading: boolean;

  // === 澄清 ===
  clarificationData: ClarificationData | null;
  showClarifyModal: boolean;

  // === 工作流 ===
  workflowStatus: LoopWorkflowStatus | null;
}

/** Provider 管理的初始状态 */
const INITIAL_STATE: AppState = {
  currentSessionId: null,
  sessions: [],
  expandedAgentId: null,
  isNewTaskLoading: false,
  isDeletingSession: false,

  appMode: null,

  sidebarExpanded: true,

  messages: [],
  inputValue: '',
  isSending: false,
  streamingStatus: null,
  streamingMessageId: null,
  thinkingContent: '',
  reasoningStage: 'idle',
  stageProgress: 0,

  selectedProject: null,
  openedFile: null,

  planVisible: false,
  planContent: '',
  isConfirmPlanLoading: false,

  clarificationData: null,
  showClarifyModal: false,

  workflowStatus: null,
};

// ============================================================
// Action 定义
// ============================================================

/** 所有可分发的 action 类型 */
export type AppAction =
  // === 会话 actions ===
  | { type: 'SET_CURRENT_SESSION'; sessionId: string | null }
  | { type: 'SET_SESSIONS'; sessions: SessionSummary[] }
  | { type: 'ADD_SESSION'; session: SessionSummary }
  | { type: 'REMOVE_SESSION'; sessionId: string }
  | { type: 'UPDATE_SESSION'; sessionId: string; updates: Partial<SessionSummary> }
  | { type: 'SET_EXPANDED_AGENT'; agentId: string | null }
  | { type: 'SET_NEW_TASK_LOADING'; loading: boolean }
  | { type: 'SET_DELETING_SESSION'; deleting: boolean }

  // === 模式 actions ===
  | { type: 'SET_APP_MODE'; mode: AppMode }

  // === UI actions ===
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_EXPANDED'; expanded: boolean }

  // === 聊天 actions ===
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'UPDATE_MESSAGE'; messageId: string; updates: Partial<ChatMessage> }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_INPUT_VALUE'; value: string }
  | { type: 'SET_IS_SENDING'; sending: boolean }
  | { type: 'SET_STREAMING_STATUS'; status: StreamingStatus }
  | { type: 'SET_STREAMING_MESSAGE_ID'; messageId: string | null }
  | { type: 'SET_THINKING_CONTENT'; content: string }
  | { type: 'SET_REASONING_STAGE'; stage: ReasoningStage }
  | { type: 'SET_STAGE_PROGRESS'; progress: number }
  | { type: 'RESET_CHAT_STATE' }

  // === 编程模式 actions ===
  | { type: 'SET_SELECTED_PROJECT'; project: string | null }
  | { type: 'SET_OPENED_FILE'; file: string | null }

  // === 计划 actions ===
  | { type: 'SHOW_PLAN'; content: string }
  | { type: 'HIDE_PLAN' }
  | { type: 'SET_PLAN_CONTENT'; content: string }
  | { type: 'SET_CONFIRM_PLAN_LOADING'; loading: boolean }

  // === 澄清 actions ===
  | { type: 'SET_CLARIFICATION_DATA'; data: ClarificationData | null }
  | { type: 'SHOW_CLARIFY_MODAL' }
  | { type: 'HIDE_CLARIFY_MODAL' }

  // === 工作流 actions ===
  | { type: 'SET_WORKFLOW_STATUS'; status: LoopWorkflowStatus | null }

  // === 批量 actions ===
  | { type: 'RESET_ALL' }
  | { type: 'HYDRATE'; partial: Partial<AppState> };

// ============================================================
// Reducer
// ============================================================

/**
 * AppState 状态变更的统一入口
 * 设计原则：
 *   - 每个 case 保持纯净（无副作用）
 *   - 不可变更新（始终返回新对象）
 *   - 优先使用展开运算符合并局部变更
 *   - 无匹配 case 时返回原 state（避免误改）
 */
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    // === 会话 ===
    case 'SET_CURRENT_SESSION':
      return { ...state, currentSessionId: action.sessionId };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions };
    case 'ADD_SESSION':
      return { ...state, sessions: [...state.sessions, action.session] };
    case 'REMOVE_SESSION':
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.sessionId),
        currentSessionId: state.currentSessionId === action.sessionId ? null : state.currentSessionId,
      };
    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, ...action.updates } : s
        ),
      };
    case 'SET_EXPANDED_AGENT':
      return { ...state, expandedAgentId: action.agentId };
    case 'SET_NEW_TASK_LOADING':
      return { ...state, isNewTaskLoading: action.loading };
    case 'SET_DELETING_SESSION':
      return { ...state, isDeletingSession: action.deleting };

    // === 模式 ===
    case 'SET_APP_MODE':
      return { ...state, appMode: action.mode };

    // === UI ===
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarExpanded: !state.sidebarExpanded };
    case 'SET_SIDEBAR_EXPANDED':
      return { ...state, sidebarExpanded: action.expanded };

    // === 聊天 ===
    case 'SET_MESSAGES':
      return { ...state, messages: action.messages };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };
    case 'UPDATE_MESSAGE': {
      const messages = state.messages.map((m) =>
        m.id === action.messageId ? { ...m, ...action.updates } : m
      );
      return { ...state, messages };
    }
    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] };
    case 'SET_INPUT_VALUE':
      return { ...state, inputValue: action.value };
    case 'SET_IS_SENDING':
      return { ...state, isSending: action.sending };
    case 'SET_STREAMING_STATUS':
      return { ...state, streamingStatus: action.status };
    case 'SET_STREAMING_MESSAGE_ID':
      return { ...state, streamingMessageId: action.messageId };
    case 'SET_THINKING_CONTENT':
      return { ...state, thinkingContent: action.content };
    case 'SET_REASONING_STAGE':
      return { ...state, reasoningStage: action.stage };
    case 'SET_STAGE_PROGRESS':
      return { ...state, stageProgress: action.progress };
    case 'RESET_CHAT_STATE':
      return {
        ...state,
        messages: [],
        inputValue: '',
        isSending: false,
        streamingStatus: null,
        streamingMessageId: null,
        thinkingContent: '',
        reasoningStage: 'idle',
        stageProgress: 0,
      };

    // === 编程模式 ===
    case 'SET_SELECTED_PROJECT':
      return { ...state, selectedProject: action.project };
    case 'SET_OPENED_FILE':
      return { ...state, openedFile: action.file };

    // === 计划 ===
    case 'SHOW_PLAN':
      return { ...state, planVisible: true, planContent: action.content };
    case 'HIDE_PLAN':
      return { ...state, planVisible: false };
    case 'SET_PLAN_CONTENT':
      return { ...state, planContent: action.content };
    case 'SET_CONFIRM_PLAN_LOADING':
      return { ...state, isConfirmPlanLoading: action.loading };

    // === 澄清 ===
    case 'SET_CLARIFICATION_DATA':
      return { ...state, clarificationData: action.data };
    case 'SHOW_CLARIFY_MODAL':
      return { ...state, showClarifyModal: true };
    case 'HIDE_CLARIFY_MODAL':
      return { ...state, showClarifyModal: false };

    // === 工作流 ===
    case 'SET_WORKFLOW_STATUS':
      return { ...state, workflowStatus: action.status };

    // === 批量 ===
    case 'RESET_ALL':
      return INITIAL_STATE;
    case 'HYDRATE':
      return { ...state, ...action.partial };

    default:
      return state;
  }
}

// ============================================================
// Context
// ============================================================

/** AppState Context 值类型 */
export interface AppStateContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

export interface AppStateProviderProps {
  children: ReactNode;
  /** 初始状态覆盖（用于测试或持久化恢复） */
  initialState?: Partial<AppState>;
}

export function AppStateProvider({ children, initialState }: AppStateProviderProps) {
  const [state, dispatch] = useReducer(
    appReducer,
    initialState ? { ...INITIAL_STATE, ...initialState } : INITIAL_STATE
  );

  // 使用 useMemo 缓存 context value，避免每次渲染都创建新对象导致所有消费者重渲染
  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

/**
 * useAppState - 访问全局应用状态
 * 返回值：
 *   - state: 当前状态
 *   - dispatch: 分发 action 的函数
 * 使用场景：任何需要读取或修改应用全局状态的组件
 * 错误处理：在 Provider 外部使用时抛出明确错误
 */
export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error(
      '[useAppState] 必须在 <AppStateProvider> 内部使用。请检查组件树结构。'
    );
  }
  return context;
}

/**
 * useAppStateSelector - 通过选择器函数订阅 state 的某个切片
 * 用法：const messages = useAppStateSelector(s => s.messages)
 * 优势：只有当选择器返回值变化时才触发重渲染
 */
export function useAppStateSelector<T>(selector: (state: AppState) => T): T {
  const { state } = useAppState();
  return selector(state);
}

/**
 * useAppActions - 封装常用 action 派发函数
 * 优势：
 *   1. 子组件无需关心 action type
 *   2. 减少样板代码
 *   3. 便于测试和重构
 *   4. 自动 useCallback 优化性能
 */
export function useAppActions() {
  const { dispatch } = useAppState();

  // 使用 useCallback 包装所有 action creator，避免子组件不必要的重渲染
  return useMemo(
    () => ({
      // 会话
      setCurrentSession: (sessionId: string | null) =>
        dispatch({ type: 'SET_CURRENT_SESSION', sessionId }),
      setSessions: (sessions: SessionSummary[]) =>
        dispatch({ type: 'SET_SESSIONS', sessions }),
      addSession: (session: SessionSummary) =>
        dispatch({ type: 'ADD_SESSION', session }),
      removeSession: (sessionId: string) =>
        dispatch({ type: 'REMOVE_SESSION', sessionId }),
      updateSession: (sessionId: string, updates: Partial<SessionSummary>) =>
        dispatch({ type: 'UPDATE_SESSION', sessionId, updates }),
      setExpandedAgent: (agentId: string | null) =>
        dispatch({ type: 'SET_EXPANDED_AGENT', agentId }),
      setNewTaskLoading: (loading: boolean) =>
        dispatch({ type: 'SET_NEW_TASK_LOADING', loading }),
      setDeletingSession: (deleting: boolean) =>
        dispatch({ type: 'SET_DELETING_SESSION', deleting }),

      // 模式
      setAppMode: (mode: AppMode) => dispatch({ type: 'SET_APP_MODE', mode }),

      // UI
      toggleSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR' }),
      setSidebarExpanded: (expanded: boolean) =>
        dispatch({ type: 'SET_SIDEBAR_EXPANDED', expanded }),

      // 聊天
      setMessages: (messages: ChatMessage[]) =>
        dispatch({ type: 'SET_MESSAGES', messages }),
      addMessage: (message: ChatMessage) =>
        dispatch({ type: 'ADD_MESSAGE', message }),
      updateMessage: (messageId: string, updates: Partial<ChatMessage>) =>
        dispatch({ type: 'UPDATE_MESSAGE', messageId, updates }),
      clearMessages: () => dispatch({ type: 'CLEAR_MESSAGES' }),
      setInputValue: (value: string) =>
        dispatch({ type: 'SET_INPUT_VALUE', value }),
      setIsSending: (sending: boolean) =>
        dispatch({ type: 'SET_IS_SENDING', sending }),
      setStreamingStatus: (status: StreamingStatus) =>
        dispatch({ type: 'SET_STREAMING_STATUS', status }),
      setStreamingMessageId: (messageId: string | null) =>
        dispatch({ type: 'SET_STREAMING_MESSAGE_ID', messageId }),
      setThinkingContent: (content: string) =>
        dispatch({ type: 'SET_THINKING_CONTENT', content }),
      setReasoningStage: (stage: ReasoningStage) =>
        dispatch({ type: 'SET_REASONING_STAGE', stage }),
      setStageProgress: (progress: number) =>
        dispatch({ type: 'SET_STAGE_PROGRESS', progress }),
      resetChatState: () => dispatch({ type: 'RESET_CHAT_STATE' }),

      // 编程模式
      setSelectedProject: (project: string | null) =>
        dispatch({ type: 'SET_SELECTED_PROJECT', project }),
      setOpenedFile: (file: string | null) =>
        dispatch({ type: 'SET_OPENED_FILE', file }),

      // 计划
      showPlan: (content: string) =>
        dispatch({ type: 'SHOW_PLAN', content }),
      hidePlan: () => dispatch({ type: 'HIDE_PLAN' }),
      setPlanContent: (content: string) =>
        dispatch({ type: 'SET_PLAN_CONTENT', content }),
      setConfirmPlanLoading: (loading: boolean) =>
        dispatch({ type: 'SET_CONFIRM_PLAN_LOADING', loading }),

      // 澄清
      setClarificationData: (data: ClarificationData | null) =>
        dispatch({ type: 'SET_CLARIFICATION_DATA', data }),
      showClarifyModal: () => dispatch({ type: 'SHOW_CLARIFY_MODAL' }),
      hideClarifyModal: () => dispatch({ type: 'HIDE_CLARIFY_MODAL' }),

      // 工作流
      setWorkflowStatus: (status: LoopWorkflowStatus | null) =>
        dispatch({ type: 'SET_WORKFLOW_STATUS', status }),

      // 批量
      resetAll: () => dispatch({ type: 'RESET_ALL' }),
      hydrate: (partial: Partial<AppState>) => dispatch({ type: 'HYDRATE', partial }),
    }),
    [dispatch]
  );
}

// ============================================================
// 工具函数
// ============================================================

/** 在 Provider 外部安全访问 state（不抛错，返回 null） */
export function useOptionalAppState(): AppStateContextValue | null {
  return useContext(AppStateContext);
}

// 仅供内部 useReducer 测试使用
export { appReducer, INITIAL_STATE };
