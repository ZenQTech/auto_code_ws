/**
 * # ============================================================
 * # API 请求钩子
 * # ============================================================
 * # 核心作用：封装所有后端 API 调用，提供类型安全的请求方法
 * # 运行流程：
 * #   1. 构建请求 URL 和参数
 * #   2. 发送 fetch 请求
 * #   3. 解析 JSON 响应
 * #   4. 错误处理
 * # ============================================================
 * # 修改记录：
 * #   - 2026-06-17 | v1.0.0 | 初始版本，封装智能体 / 任务 / 对话 / 统计 API
 * #   - 2026-06-17 | v1.1.0 | 集成 Hermes 流式对话 / 优化 / 确认执行 API
 * #   - 2026-06-23 | v1.2.0 | 新增 useSessions / useSessionDetail / createSession / updateSession / deleteSession
 * #   - 2026-06-23 | v1.3.0 | chatWithHermesStreaming 的 onDone 回调签名扩展为 (title?: string) => void
 * #   - 2026-06-23 | v1.4.0 | onDone 回调签名回退为 () => void（撤销 auto-session-title-generation）
 * #   - 2026-06-24 | v1.5.0 | 新增 useQuota / useArchitectureStatus / useEvaluationReport / useGitStatus / useMemorySearch / useMemoryStats / useSecurityReview / useArchitectureDesign / useArchitectureCritique / useGitLog / useGitBranches / useConfigSections 等调度平台 V4.1 API hooks
 * #   - 2026-06-24 | v1.6.0 | 新增 batchDeleteSessions / fetchTrashSessions / restoreSessions / emptyTrash（批量删除 + 回收站 API）
 * #   - 2026-06-24 | v1.7.0 | 新增 fetchConfig / updateConfig 全局配置中心 API（Task 3 + Task 7）
 * #   - 2026-06-24 | v1.8.0 | useSessions / createSession 新增 mode 参数（'chat' | 'coding' 双模式支持）
 * #   - 2026-06-24 | v1.9.0 | useSessionDetail 新增 onNotFound 回调（404 静默触发）
 * #   - 2026-06-29 | v2.0.0 | chatWithHermesStreaming 新增 signal 参数，支持 AbortController 中断请求
 * #   - 2026-06-29 | v2.4.0 | chatWithHermesStreaming 新增 sessionMode 参数，请求体
 * #     透传 session_mode 字段，支持 coding 模式下开发需求自动路由
 * #   - 2026-06-30 | v2.5.0 | 新增 fetchWorkflowStatus（GET /api/workflow/{id}/status），
 * #     供 App.tsx 拉取 Loop Engineering 工作流状态以检测 clarifying 阶段
#   - 2026-06-30 | v2.7.0 | clarify_questions 事件解析修复 event.max_rounds → event.maxRounds（匹配后端 camelCase）
# ============================================================
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  Agent, Task, Conversation,
  StatsOverview, WSMessage, UsageOverview,
  Session, SessionDetail, SessionStatus,
  QuotaOverview, ArchitectureStatus, ArchitectureDesign, ArchitectureCritique,
  EvaluationReport, GitStatus, GitCommit, GitBranch,
  MemorySearchResult, MemoryStats, SecurityReview, ConfigSection,
  Project, FileTreeNode, FileContent,
  LoopWorkflowStatus,
  ReviewData, PipelineData, GoalData,
} from '../types';

const API_BASE = '/api';

/** 通用 fetch 封装 */
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 获取智能体列表 */
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Agent[]>('/agents');
      setAgents(data);
    } catch (e) {
      console.error('获取智能体列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  return { agents, loading, refetch: fetchAgents };
}

/** 删除智能体 */
export async function deleteAgent(agentId: string): Promise<void> {
  await apiFetch(`/agents/${agentId}`, { method: 'DELETE' });
}

/** 获取任务列表 */
export function useTasks(agentId?: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = agentId ? `?agent_id=${agentId}` : '';
      const data = await apiFetch<Task[]>(`/tasks${params}`);
      setTasks(data);
    } catch (e) {
      console.error('获取任务列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  return { tasks, loading, refetch: fetchTasks };
}

/** 获取对话记录 */
export function useConversations(taskId?: string, agentId?: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (taskId) params.set('task_id', taskId);
      if (agentId) params.set('agent_id', agentId);
      const data = await apiFetch<Conversation[]>(`/conversations?${params}`);
      setConversations(data);
    } catch (e) {
      console.error('获取对话记录失败:', e);
    } finally {
      setLoading(false);
    }
  }, [taskId, agentId]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  return { conversations, loading, refetch: fetchConversations };
}

/** 获取统计概览 */
export function useStats() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<StatsOverview>('/stats/overview');
      setStats(data);
    } catch (e) {
      console.error('获取统计数据失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}

/** 获取用量监控数据 */
export function useUsage() {
  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<UsageOverview>('/usage/overview');
      setUsage(data);
    } catch (e) {
      console.error('获取用量数据失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    // 每 30 秒自动刷新
    const interval = setInterval(fetchUsage, 30000);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  return { usage, loading, refetch: fetchUsage };
}

/** 执行任务 */
export async function executeTask(taskId: string): Promise<Record<string, unknown>> {
  return apiFetch('/workflow/execute', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
  });
}

/** 验证任务 */
export async function validateTask(taskId: string): Promise<Record<string, unknown>> {
  return apiFetch('/workflow/validate', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
  });
}

/**
 * 获取 Loop Engineering 工作流状态
 * 作用：根据 workflow_id 拉取工作流完整状态（含 current_stage / iteration_count / stages 等），
 *       供 App.tsx 检测 clarifying 等阶段以分流消息发送
 * 调用方：App.tsx workflowStatus 拉取 useEffect / handleSendMessage onDone 刷新逻辑
 * 被调用方：GET /api/workflow/{id}/status
 * 参数：
 *   - workflowId: string，工作流唯一标识
 * 返回值：Promise<LoopWorkflowStatus>，工作流整体状态对象
 */
export async function fetchWorkflowStatus(workflowId: string): Promise<LoopWorkflowStatus> {
  return apiFetch<LoopWorkflowStatus>(`/workflow/${workflowId}/status`);
}

// ============================================================
// 架构设计阶段 API（v2.0.0 新增）
// ============================================================

/** 批判分析缺陷项 */
export interface DesignDefectItem {
  defect_id: string;
  severity: 'critical' | 'major' | 'minor';
  dimension: string;
  location: string;
  description: string;
  impact_scope: string;
  repair_plan: string;
}

/** 批判分析结果 */
export interface DesignCritiqueResult {
  passed: boolean;
  overall_score: number;
  summary: string;
  dimension_scores: Record<string, number>;
  defect_list: DesignDefectItem[];
}

/** 启动架构设计阶段响应 */
export interface StartDesignPhaseResult {
  success: boolean;
  requirement_v2: string;
  critique_result: DesignCritiqueResult | null;
  phase_complete: boolean;
  error_message?: string;
}

/** 确认架构设计响应 */
export interface ConfirmDesignResult {
  success: boolean;
  message: string;
  spec_doc?: string;
  task_doc?: string;
  checklist_doc?: string;
  acceptance_doc?: string;
  git_repo_created?: boolean;
  git_repo_url?: string;
}

/** 驳回架构设计响应 */
export interface RejectDesignResult {
  success: boolean;
  message: string;
  requirement_v2?: string;
  critique_result?: DesignCritiqueResult | null;
}

/**
 * 启动架构设计阶段
 * 作用：调用 POST /api/architecture/start-design-phase
 * 参数：
 *   - workflowId: string，工作流 ID
 * 返回值：StartDesignPhaseResult，含 V2.0 需求文档和批判分析结果
 */
export async function startDesignPhase(workflowId: string): Promise<StartDesignPhaseResult> {
  return apiFetch<StartDesignPhaseResult>('/architecture/start-design-phase', {
    method: 'POST',
    body: JSON.stringify({ workflow_id: workflowId }),
  });
}

/**
 * 确认架构设计（V2.0 需求确认通过）
 * 作用：调用 POST /api/architecture/confirm-design
 * 参数：
 *   - workflowId: string，工作流 ID
 *   - confirmed: boolean，是否确认通过
 * 返回值：ConfirmDesignResult，含四文档和 Git 信息
 */
export async function confirmDesignPhase(
  workflowId: string,
  confirmed: boolean
): Promise<ConfirmDesignResult> {
  return apiFetch<ConfirmDesignResult>('/architecture/confirm-design', {
    method: 'POST',
    body: JSON.stringify({ workflow_id: workflowId, confirmed }),
  });
}

/**
 * 驳回架构设计（V2.0 需求驳回，触发重新迭代）
 * 作用：调用 POST /api/architecture/reject-design
 * 参数：
 *   - workflowId: string，工作流 ID
 *   - rejectReason: string，驳回原因
 * 返回值：RejectDesignResult，含更新后的 V2.0 需求文档和批判结果
 */
export async function rejectDesignPhase(
  workflowId: string,
  rejectReason: string
): Promise<RejectDesignResult> {
  return apiFetch<RejectDesignResult>('/architecture/reject-design', {
    method: 'POST',
    body: JSON.stringify({ workflow_id: workflowId, reject_reason: rejectReason }),
  });
}

// ============================================================
// Hermes 智能调度 API
// ============================================================

/** Hermes 对话响应类型 */
interface HermesChatResponse {
  reply: string;
  optimized?: boolean;
  plan_content?: string;
}

/** Hermes 优化响应类型 */
interface HermesOptimizeResponse {
  original: string;
  optimized: string;
  task_modules: string[];
  constraints: string[];
  plan_content: string;
  agent_created: boolean;
  agent_id: string;
  success: boolean;
  error_message: string;
}

/** Hermes 确认执行响应类型 */
interface HermesConfirmResponse {
  success: boolean;
  tasks_created: number;
  agents_created: number;
  message: string;
}

/**
 * 与 Hermes 对话
 * 作用：发送用户消息给 Hermes，获取回复
 * 调用方：App.tsx 对话界面
 * 被调用方：POST /api/hermes/chat
 * 参数：
 *   - message: string，用户消息文本
 *   - sessionId?: string，可选会话 ID（v1.2.0 新增），传入后后端将自动持久化对话
 * 返回值：HermesChatResponse，包含回复和可选的优化结果
 */
export async function chatWithHermes(
  message: string,
  sessionId?: string | null,
): Promise<HermesChatResponse> {
  return apiFetch<HermesChatResponse>('/hermes/chat', {
    method: 'POST',
    body: JSON.stringify({ message, session_id: sessionId ?? null }),
  });
}

/**
 * 流式对话 Hermes（SSE）
 * 作用：使用 fetch + ReadableStream 读取 SSE 事件流，实时推送对话内容
 * 调用方：App.tsx 对话界面（流式模式）
 * 被调用方：POST /api/hermes/chat/stream
 * 参数：
 *   - message: string，用户消息文本
 *   - sessionId?: string，可选会话 ID（v1.2.0 新增），传入后后端将自动持久化对话
 *   - sessionMode?: string（v2.4.0 新增），会话模式 "chat" | "coding"，coding 模式下触发开发需求自动路由
 *   - callbacks: 回调对象，包含 onThinking/onText/onDone/onError
 *   - signal?: AbortSignal（v2.0.0 新增），用于前端停止按钮中断 fetch 请求
 *   - v1.4.0 回退：onDone 回调签名恢复为 () => void，
 *     撤销 v1.3.0 引入的 title 透传逻辑（auto-session-title-generation 整体回退）
 * 返回值：Promise<void>
 */
export async function chatWithHermesStreaming(
  message: string,
  sessionId: string | null,
  callbacks: {
    onThinking?: (content: string) => void;
    onText?: (content: string) => void;
    onClarifyQuestions?: (data: { questions: any[]; round?: number; maxRounds?: number; complete?: boolean; summary?: string }) => void;
    // v2.5.0 新增：coding 模式下检测到开发需求并启动 SOP 工作流时触发，
    // 携带后端返回的 workflow_id 与初始阶段（如 clarifying），供前端拉取工作流状态
    onWorkflowStarted?: (data: { workflowId: string; stage?: string }) => void;
    // v1.9.0 新增：评审结果 / 流水线步骤 / Goal 更新 SSE 事件回调
    onReviewResult?: (data: ReviewData) => void;
    onPipelineStep?: (data: PipelineData) => void;
    onGoalUpdate?: (data: GoalData) => void;
    onDone?: () => void;
    onError?: (error: string) => void;
  },
  sessionMode?: string,  // v2.4.0 新增: 会话模式 "chat" | "coding"
  signal?: AbortSignal,
): Promise<void> {
  const { onThinking, onText, onClarifyQuestions, onWorkflowStarted, onReviewResult, onPipelineStep, onGoalUpdate, onDone, onError } = callbacks;

  try {
    const response = await fetch('/api/hermes/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId ?? null, session_mode: sessionMode }),
      signal,
    });

    if (!response.ok) {
      onError?.(`HTTP ${response.status}: ${response.statusText}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError?.('无法读取响应流');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 事件（以 \n\n 分隔）
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // 保留未完成的部分

      for (const line of lines) {
        if (!line.trim()) continue;

        // 提取 data: 字段
        const dataMatch = line.match(/^data:\s*(.+)$/m);
        if (!dataMatch) continue;

        try {
          const event = JSON.parse(dataMatch[1]);
          switch (event.type) {
            case 'thinking':
              onThinking?.(event.content);
              break;
            case 'text':
              onText?.(event.content);
              break;
            case 'clarify_questions':
              // 结构化澄清问题事件（含 options），供交互式选择卡片消费
              onClarifyQuestions?.({
                questions: event.questions || [],
                round: event.round,
                maxRounds: event.maxRounds,  // v2.7.0 修复：匹配后端 camelCase 字段名
                complete: event.complete,
                summary: event.summary,
              });
              break;
            case 'workflow_started':
              // v2.5.0：coding 模式开发需求触发 SOP 工作流，回传 workflow_id 与阶段
              onWorkflowStarted?.({ workflowId: event.workflow_id, stage: event.stage });
              break;
            case 'review_result':
              // v1.9.0：评估器返回结构化评审报告
              onReviewResult?.({
                overall_score: event.overall_score,
                dimension_scores: event.dimension_scores || {},
                defects: event.defects || [],
                passed: event.passed,
                summary: event.summary || '',
              });
              break;
            case 'pipeline_step':
              // v1.9.0：全链路流水线测试步骤更新
              onPipelineStep?.({
                workflow_id: event.workflow_id,
                overall_status: event.overall_status,
                steps: event.steps || [],
                all_modules_passed: event.all_modules_passed,
                git_commit_success: event.git_commit_success,
                integration_test_passed: event.integration_test_passed,
                summary: event.summary || '',
              });
              break;
            case 'goal_update':
              // v1.9.0：Goal 导向任务循环进度更新
              onGoalUpdate?.({
                goal_id: event.goal_id,
                objective: event.objective,
                sub_goals: event.sub_goals || [],
                status: event.status,
                workflow_id: event.workflow_id,
                completed_count: event.completed_count,
                total_count: event.total_count,
                current_sub_goal: event.current_sub_goal,
              });
              break;
            case 'done':
              // v3.5.0 修复：不主动 reader.cancel()（其语义为中止流，反而制造 ERR_ABORTED）；
              // 改为 onDone 后 return，由后端关闭连接时 reader.read() 自然返回 done=true
              onDone?.();
              return;
            case 'error':
              onError?.(event.content);
              return;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    // 处理剩余 buffer
    if (buffer.trim()) {
      const dataMatch = buffer.match(/^data:\s*(.+)$/m);
      if (dataMatch) {
        try {
          const event = JSON.parse(dataMatch[1]);
          if (event.type === 'done') {
            // v1.4.0 回退：onDone 回调不再接收 title 参数，撤销 auto-session-title-generation 透传逻辑
            onDone?.();
            return;
          }
        } catch {
          // ignore
        }
      }
    }

    // 流式结束但没有收到 done 事件的兜底分支：不携带 title
    onDone?.();
  } catch (err) {
    // v2.0.0：AbortError 是用户主动停止，不触发 onError，直接调用 onDone
    if (err instanceof DOMException && err.name === 'AbortError') {
      onDone?.();
      return;
    }
    onError?.(err instanceof Error ? err.message : '流式对话失败');
  }
}

/**
 * 调用 Hermes 进行提示词优化和任务规划
 * 作用：将用户原始需求发送给 Hermes 进行优化和规划
 * 调用方：App.tsx 优化流程
 * 被调用方：POST /api/hermes/optimize
 * 参数：
 *   - rawPrompt: string，用户原始需求文本
 *   - sessionId?: string，可选会话 ID（v1.2.0 新增），传入后后端将自动持久化关联数据
 * 返回值：HermesOptimizeResponse，包含优化结果和计划内容
 */
export async function optimizeWithHermes(
  rawPrompt: string,
  sessionId?: string | null,
): Promise<HermesOptimizeResponse> {
  return apiFetch<HermesOptimizeResponse>('/hermes/optimize', {
    method: 'POST',
    body: JSON.stringify({ raw_prompt: rawPrompt, session_id: sessionId ?? null }),
  });
}

/**
 * 确认执行计划
 * 作用：用户确认计划后，按模块拆分任务并创建 CLI 实例执行
 * 调用方：App.tsx PlanViewer 确认按钮
 * 被调用方：POST /api/hermes/confirm
 * 参数：
 *   - planContent: string，计划文档内容
 *   - sessionId?: string，可选会话 ID（v1.2.0 新增），传入后后端将自动持久化关联数据
 * 返回值：HermesConfirmResponse，包含任务创建结果
 */
export async function confirmPlan(
  planContent: string,
  sessionId?: string | null,
): Promise<HermesConfirmResponse> {
  return apiFetch<HermesConfirmResponse>('/hermes/confirm', {
    method: 'POST',
    body: JSON.stringify({ plan_content: planContent, session_id: sessionId ?? null }),
  });
}

/** WebSocket 连接钩子 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        setLastMessage(msg);
      } catch {
        // ignore parse errors
      }
    };

    // 心跳
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, []);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, lastMessage, send };
}

// ============================================================
// Session API（v1.2.0 新增）
// 核心作用：封装"会话（Session）"的 CRUD + 详情聚合操作
// 端点契约：
//   - POST   /api/sessions              创建
//   - GET    /api/sessions?status=...   列表
//   - GET    /api/sessions/{id}         单条
//   - GET    /api/sessions/{id}/detail  聚合详情
//   - PATCH  /api/sessions/{id}         更新
//   - DELETE /api/sessions/{id}         删除
// ============================================================

/**
 * 获取会话列表
 * 作用：拉取所有 Session 列表（按 last_active_at 倒序）
 * 调用方：Sidebar.tsx 边栏会话列表
 * 被调用方：GET /api/sessions
 * 参数：
 *   - status?: SessionStatus，可选状态过滤（active / archived）
 *   - mode?: 'chat' | 'coding'，可选模式过滤（v1.8.0 新增），传入后追加 &mode= 查询参数
 * 返回值：{ sessions, loading, refetch }
 */
export function useSessions(status?: SessionStatus, mode?: 'chat' | 'coding') {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (mode) params.set('mode', mode);
      const qs = params.toString();
      const data = await apiFetch<Session[]>(`/sessions${qs ? '?' + qs : ''}`);
      setSessions(data);
    } catch (e) {
      console.error('获取会话列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, [status, mode]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  return { sessions, loading, refetch: fetchSessions };
}

/**
 * 获取会话详情（聚合）
 * 作用：一次拉取完整上下文（session + messages + agents + tasks + conversations）
 * 调用方：App.tsx 切换 Session 时
 * 被调用方：GET /api/sessions/{id}/detail
 * 参数：
 *   - sessionId: string | null，会话 ID；传入 null 时清空 detail 并跳过请求
 *   - options?: { onNotFound?: () => void }，v1.9.0 新增；可选回调配置：
 *       - onNotFound：当后端返回 404（Session 不存在）时静默触发（不 console.error），
 *         用于父组件实现启动 / 切换时的 404 自动回退逻辑（清除 localStorage + createSession）
 *       - 404 之外的其他错误（500 / 网络 / JSON 解析）**不**触发 onNotFound，
 *         改为 console.warn + setDetail(null)，避免误报
 *       - 使用 useRef 模式保持回调引用最新，避免 useEffect 依赖项变更引发的重渲染
 * 返回值：{ detail, loading }
 */
export function useSessionDetail(
  sessionId: string | null,
  options?: { onNotFound?: () => void },
) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // v1.9.0：用 useRef 保持 onNotFound 引用最新，避免 useEffect 因回调变化而重复触发请求
  const onNotFoundRef = useRef(options?.onNotFound);
  onNotFoundRef.current = options?.onNotFound;

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    apiFetch<SessionDetail>(`/sessions/${sessionId}/detail`)
      .then(setDetail)
      .catch((e) => {
        // v1.9.0：区分 404 与其他错误
        // 404 检测：apiFetch 抛出的 Error.message 包含后端 HTTPException 的 detail 字段
        //          后端 /api/sessions/{id}/detail 在 Session 不存在时返回 detail="Session 不存在"
        //          兼容匹配：消息含 "Session 不存在" 或 "404" 即视为 404
        const isNotFound = e instanceof Error && (
          e.message.includes('Session 不存在') ||
          e.message.includes('404')
        );
        if (isNotFound) {
          // 404 是预期清理场景（localStorage 残留 / Session 被删除 / 归档），
          // 静默触发 onNotFound 回调 + console.debug，**不**console.error
          console.debug(`Session ${sessionId} 不存在，自动回退`);
          onNotFoundRef.current?.();
          setDetail(null);
        } else {
          // 其他错误（500 / 网络中断 / JSON 解析）：console.warn（非 error），
          // 可能是临时网络问题，用户刷新即可恢复
          console.warn('获取会话详情失败:', e);
          setDetail(null);
        }
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  return { detail, loading };
}

/**
 * 创建新会话
 * 作用：调用 POST /api/sessions 创建一个空 Session
 * 调用方：App.tsx 启动初始化 / 新建任务按钮
 * 被调用方：POST /api/sessions
 * 参数：
 *   - payload?: { title?, user_first_message?, mode? }，可选元数据；
 *     mode 为 'chat' | 'coding'（v1.8.0 新增），指定会话所属模式
 * 返回值：Promise<Session>
 */
export async function createSession(payload?: { title?: string; user_first_message?: string; mode?: 'chat' | 'coding' }): Promise<Session> {
  return apiFetch<Session>('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

/**
 * 更新会话
 * 作用：调用 PATCH /api/sessions/{id} 更新 title / status / last_active_at
 * 调用方：App.tsx 切会话后更新活跃时间 / Sidebar 归档 / 重命名
 * 被调用方：PATCH /api/sessions/{id}
 * 参数：
 *   - sessionId: string，会话 ID
 *   - payload: { title?, status?, last_active_at? }
 * 返回值：Promise<Session>
 */
export async function updateSession(
  sessionId: string,
  payload: { title?: string; status?: SessionStatus; last_active_at?: string },
): Promise<Session> {
  return apiFetch<Session>(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * 删除会话
 * 作用：调用 DELETE /api/sessions/{id} 级联删除关联数据
 * 调用方：App.tsx handleDeleteSession
 * 被调用方：DELETE /api/sessions/{id}
 * 参数：
 *   - sessionId: string，会话 ID
 * 返回值：Promise<{ message, session_id, deleted_counts }>
 */
export async function deleteSession(
  sessionId: string,
): Promise<{ message: string; session_id: string; deleted_counts: Record<string, number> }> {
  return apiFetch(`/sessions/${sessionId}`, { method: 'DELETE' });
}

// ============================================================
// 批量删除与回收站 API（v1.6.0 新增）
// 核心作用：封装批量删除、回收站查询、恢复、清空等回收站管理操作
// 端点契约：
//   - POST   /api/sessions/batch-delete     批量删除（迁移至回收站）
//   - GET    /api/sessions/trash            获取回收站会话列表
//   - POST   /api/sessions/trash/restore    恢复回收站会话
//   - DELETE /api/sessions/trash/empty      清空回收站
// ============================================================

/**
 * 批量删除会话（软删除，迁移至回收站）
 * 作用：调用 POST /api/sessions/batch-delete 批量将活跃/归档会话标记为 deleted
 * 调用方：App.tsx handleBatchDelete
 * 被调用方：POST /api/sessions/batch-delete
 * 参数：
 *   - sessionIds: string[]，待批量删除的会话 ID 列表
 * 返回值：Promise<{ message: string; deleted_count: number }>
 */
export async function batchDeleteSessions(
  sessionIds: string[],
): Promise<{ message: string; deleted_count: number }> {
  return apiFetch('/sessions/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ session_ids: sessionIds }),
  });
}

/**
 * 获取回收站会话列表
 * 作用：调用 GET /api/sessions/trash 拉取所有 status='deleted' 的会话
 * 调用方：Sidebar.tsx 回收站视图
 * 被调用方：GET /api/sessions/trash
 * 参数：无
 * 返回值：Promise<Session[]>
 */
export async function fetchTrashSessions(): Promise<Session[]> {
  return apiFetch<Session[]>('/sessions/trash');
}

/**
 * 恢复回收站会话
 * 作用：调用 POST /api/sessions/trash/restore 将 deleted 会话恢复为 active
 * 调用方：Sidebar.tsx 回收站视图
 * 被调用方：POST /api/sessions/trash/restore
 * 参数：
 *   - sessionIds: string[]，待恢复的会话 ID 列表
 * 返回值：Promise<{ message: string; restored_count: number }>
 */
export async function restoreSessions(
  sessionIds: string[],
): Promise<{ message: string; restored_count: number }> {
  return apiFetch('/sessions/trash/restore', {
    method: 'POST',
    body: JSON.stringify({ session_ids: sessionIds }),
  });
}

/**
 * 清空回收站
 * 作用：调用 DELETE /api/sessions/trash/empty 永久删除回收站中所有会话
 * 调用方：Sidebar.tsx 回收站视图
 * 被调用方：DELETE /api/sessions/trash/empty
 * 参数：无
 * 返回值：Promise<{ message: string; deleted_count: number }>
 */
export async function emptyTrash(): Promise<{ message: string; deleted_count: number }> {
  return apiFetch('/sessions/trash/empty', { method: 'DELETE' });
}

// ============================================================
// 调度平台 V4.1 新增 API（v1.5.0 新增）
// 核心作用：封装配额监控 / 架构设计 / 评测报告 / Git 管理 /
//           记忆库 / 安全审查 / 配置中心等新模块 API
// ============================================================

/**
 * 获取配额监控概览
 * 作用：拉取配额用量数据，包含三个时间维度（5h/week/month）、
 *       告警级别、并行任务数、Token 消耗等
 * 调用方：QuotaPanel.tsx 配额监控面板
 * 被调用方：GET /api/quota/overview
 * 参数：无
 * 返回值：{ quota, loading, refetch }
 * 自动刷新：每 30 秒
 */
export function useQuota() {
  const [quota, setQuota] = useState<QuotaOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchQuota = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<QuotaOverview>('/quota/overview');
      setQuota(data);
    } catch (e) {
      console.error('获取配额数据失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuota();
    const interval = setInterval(fetchQuota, 30000);
    return () => clearInterval(interval);
  }, [fetchQuota]);

  return { quota, loading, refetch: fetchQuota };
}

/**
 * 获取架构设计工作流状态
 * 作用：拉取架构设计阶段的迭代状态、审核状态
 * 调用方：ArchitectureViewer.tsx 架构设计查看器
 * 被调用方：GET /api/architecture/status
 * 参数：无
 * 返回值：{ status, loading, refetch }
 */
export function useArchitectureStatus() {
  const [status, setStatus] = useState<ArchitectureStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ArchitectureStatus>('/architecture/status');
      setStatus(data);
    } catch (e) {
      console.error('获取架构状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return { status, loading, refetch: fetchStatus };
}

/**
 * 获取架构设计文档
 * 作用：拉取架构设计文档的 Markdown 内容
 * 调用方：ArchitectureViewer.tsx 架构设计查看器
 * 被调用方：GET /api/architecture/design
 * 参数：无
 * 返回值：{ design, loading, refetch }
 */
export function useArchitectureDesign() {
  const [design, setDesign] = useState<ArchitectureDesign | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDesign = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ArchitectureDesign>('/architecture/design');
      setDesign(data);
    } catch (e) {
      console.error('获取架构设计文档失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDesign(); }, [fetchDesign]);

  return { design, loading, refetch: fetchDesign };
}

/**
 * 获取架构审查结果
 * 作用：拉取架构审查的缺陷列表和审查结论
 * 调用方：ArchitectureViewer.tsx 架构设计查看器
 * 被调用方：GET /api/architecture/critique
 * 参数：无
 * 返回值：{ critique, loading, refetch }
 */
export function useArchitectureCritique() {
  const [critique, setCritique] = useState<ArchitectureCritique | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCritique = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ArchitectureCritique>('/architecture/critique');
      setCritique(data);
    } catch (e) {
      console.error('获取架构审查结果失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCritique(); }, [fetchCritique]);

  return { critique, loading, refetch: fetchCritique };
}

/**
 * 获取评测报告
 * 作用：拉取指定类型的评测报告（architecture / code / integration / security）
 * 调用方：EvaluationReport.tsx 评测报告查看器
 * 被调用方：GET /api/evaluation/report/{type}
 * 参数：
 *   - type: string，报告类型
 * 返回值：{ report, loading, refetch }
 */
export function useEvaluationReport(type: string) {
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<EvaluationReport>(`/evaluation/report/${type}`);
      setReport(data);
    } catch (e) {
      console.error('获取评测报告失败:', e);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  return { report, loading, refetch: fetchReport };
}

/**
 * 获取 Git 仓库状态
 * 作用：拉取当前仓库的分支、干净/脏状态、变更文件数等
 * 调用方：GitPanel.tsx Git 管理面板
 * 被调用方：GET /api/git/status
 * 参数：无
 * 返回值：{ gitStatus, loading, refetch }
 */
export function useGitStatus() {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchGitStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<GitStatus>('/git/status');
      setGitStatus(data);
    } catch (e) {
      console.error('获取 Git 状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGitStatus(); }, [fetchGitStatus]);

  return { gitStatus, loading, refetch: fetchGitStatus };
}

/**
 * 获取 Git 提交日志
 * 作用：拉取最近的 Git 提交记录
 * 调用方：GitPanel.tsx Git 管理面板
 * 被调用方：GET /api/git/log
 * 参数：
 *   - limit?: number，返回条数上限（默认 10）
 * 返回值：{ commits, loading, refetch }
 */
export function useGitLog(limit?: number) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCommits = useCallback(async () => {
    setLoading(true);
    try {
      const params = limit ? `?limit=${limit}` : '';
      const data = await apiFetch<GitCommit[]>(`/git/log${params}`);
      setCommits(data);
    } catch (e) {
      console.error('获取 Git 日志失败:', e);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { fetchCommits(); }, [fetchCommits]);

  return { commits, loading, refetch: fetchCommits };
}

/**
 * 获取 Git 分支列表
 * 作用：拉取所有分支及其最后提交信息
 * 调用方：GitPanel.tsx Git 管理面板
 * 被调用方：GET /api/git/branches
 * 参数：无
 * 返回值：{ branches, loading, refetch }
 */
export function useGitBranches() {
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<GitBranch[]>('/git/branches');
      setBranches(data);
    } catch (e) {
      console.error('获取分支列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  return { branches, loading, refetch: fetchBranches };
}

/**
 * 搜索记忆库
 * 作用：根据查询关键词搜索代码片段记忆库
 * 调用方：MemoryPanel.tsx 记忆库面板
 * 被调用方：GET /api/memory/search
 * 参数：
 *   - query: string，搜索关键词
 * 返回值：{ results, loading, search }
 * 注意：不自动触发搜索，需手动调用 search(query)
 */
export function useMemorySearch() {
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<MemorySearchResult[]>(`/memory/search?q=${encodeURIComponent(query)}`);
      setResults(data);
    } catch (e) {
      console.error('搜索记忆库失败:', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, search };
}

/**
 * 获取记忆库统计信息
 * 作用：拉取记忆库的总体统计数据
 * 调用方：MemoryPanel.tsx 记忆库面板
 * 被调用方：GET /api/memory/stats
 * 参数：无
 * 返回值：{ stats, loading, refetch }
 */
export function useMemoryStats() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<MemoryStats>('/memory/stats');
      setStats(data);
    } catch (e) {
      console.error('获取记忆库统计失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}

/**
 * 获取安全审查记录
 * 作用：拉取安全审查的检查项列表和审查状态
 * 调用方：SecurityReviewPanel.tsx 安全审查面板
 * 被调用方：GET /api/security/review
 * 参数：无
 * 返回值：{ review, loading, refetch }
 */
export function useSecurityReview() {
  const [review, setReview] = useState<SecurityReview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<SecurityReview>('/security/review');
      setReview(data);
    } catch (e) {
      console.error('获取安全审查记录失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReview(); }, [fetchReview]);

  return { review, loading, refetch: fetchReview };
}

/**
 * 获取全局配置分组
 * 作用：拉取所有可配置参数的分组列表
 * 调用方：ConfigPanel.tsx 全局配置中心
 * 被调用方：GET /api/config/sections
 * 参数：无
 * 返回值：{ sections, loading, refetch }
 */
export function useConfigSections() {
  const [sections, setSections] = useState<ConfigSection[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ConfigSection[]>('/config/sections');
      setSections(data);
    } catch (e) {
      console.error('获取配置分组失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSections(); }, [fetchSections]);

  return { sections, loading, refetch: fetchSections };
}

// ============================================================
// 全局配置中心 API（v1.7.0 新增 - Task 3/7）
// 核心作用：提供全局配置的读取和更新 API 函数
// 端点契约：
//   - GET  /api/config  读取完整配置
//   - PUT  /api/config  部分更新配置
// ============================================================

/** 全局配置完整响应类型 */
export interface FullConfig {
  server: Record<string, unknown>;
  database: Record<string, unknown>;
  cli: Record<string, unknown>;
  scheduling: Record<string, unknown>;
  hermes: Record<string, unknown>;
  logging: Record<string, unknown>;
  storage: Record<string, unknown>;
  quota: Record<string, unknown>;
  context: Record<string, unknown>;
  architecture: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  human_review: Record<string, unknown>;
  task_timeout: Record<string, unknown>;
  api_error_handling: Record<string, unknown>;
  git: Record<string, unknown>;
  memory_store: Record<string, unknown>;
  security: Record<string, unknown>;
  notification: Record<string, unknown>;
  local_intercept: Record<string, unknown>;
}

/**
 * 获取完整全局配置
 * 作用：调用 GET /api/config 读取 auto_code_config.yaml 全部内容
 * 调用方：SettingsPanel.tsx 设置面板（组件挂载时）
 * 被调用方：GET /api/config
 * 参数：无
 * 返回值：Promise<FullConfig>，包含所有 section 的完整配置
 */
export async function fetchConfig(): Promise<FullConfig> {
  return apiFetch<FullConfig>('/config');
}

/**
 * 更新全局配置（部分更新）
 * 作用：调用 PUT /api/config，将用户修改的 section 写入配置文件，
 *       后端自动合并到现有 YAML 并调用 settings.reload() 重载
 * 调用方：SettingsPanel.tsx「保存设置」按钮
 * 被调用方：PUT /api/config
 * 参数：
 *   - patch: Partial<FullConfig>，仅包含需要更新的 section 字段
 * 返回值：Promise<FullConfig>，更新后的完整配置
 */
export async function updateConfig(patch: Partial<FullConfig>): Promise<FullConfig> {
  return apiFetch<FullConfig>('/config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// ============================================================
// 文件资源管理器 API（v2.10.0 新增）
// 核心作用：封装项目列表 / 文件树 / 文件内容相关接口
// 端点契约：
//   - GET  /api/workspace/projects            获取项目列表
//   - POST /api/workspace/projects            创建新项目
//   - GET  /api/workspace/tree?project=xxx    获取文件树
//   - GET  /api/workspace/file?project=xxx&path=xxx  获取文件内容
// ============================================================

/**
 * 获取项目列表
 * 作用：调用 GET /api/workspace/projects 拉取所有项目
 * 调用方：ProjectSelector.tsx「打开已有项目」
 * 被调用方：GET /api/workspace/projects
 * 参数：无
 * 返回值：Promise<Project[]>，项目列表
 */
export async function fetchProjects(): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>('/workspace/projects');
  return data.projects || [];
}

/**
 * 创建新项目
 * 作用：调用 POST /api/workspace/projects 创建新项目
 * 调用方：ProjectSelector.tsx「新建项目」
 * 被调用方：POST /api/workspace/projects
 * 参数：
 *   - name: string，项目名称
 * 返回值：Promise<{ name: string }>，创建结果
 */
export async function createProject(name: string): Promise<{ name: string }> {
  return apiFetch<{ name: string }>('/workspace/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/**
 * 获取文件树
 * 作用：调用 GET /api/workspace/tree?project=xxx 拉取项目目录结构
 * 调用方：FileExplorer.tsx 文件浏览器
 * 被调用方：GET /api/workspace/tree
 * 参数：
 *   - project: string，项目名称
 * 返回值：Promise<FileTreeNode[]>，文件树节点列表
 */
export async function fetchFileTree(project: string): Promise<FileTreeNode[]> {
  const data = await apiFetch<{ tree: FileTreeNode[] }>(`/workspace/tree?project=${encodeURIComponent(project)}`);
  return data.tree || [];
}

/**
 * 获取文件内容
 * 作用：调用 GET /api/workspace/file?project=xxx&path=xxx 拉取文件内容
 * 调用方：CodeViewer.tsx 代码查看器
 * 被调用方：GET /api/workspace/file
 * 参数：
 *   - project: string，项目名称
 *   - path: string，文件路径
 * 返回值：Promise<FileContent>，文件内容
 */
export async function fetchFileContent(project: string, path: string): Promise<FileContent> {
  return apiFetch<FileContent>(`/workspace/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`);
}

/**
 * 删除文件
 * 调用 DELETE /api/workspace/file
 */
export async function deleteFile(project: string, path: string): Promise<void> {
  await apiFetch(`/workspace/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

/**
 * 复制文件
 * 调用 POST /api/workspace/file/copy
 */
export async function copyFile(project: string, sourcePath: string, targetPath: string): Promise<void> {
  await apiFetch(`/workspace/file/copy?project=${encodeURIComponent(project)}&path=${encodeURIComponent(sourcePath)}&target=${encodeURIComponent(targetPath)}`, { method: 'POST' });
}

/**
 * 重命名文件
 * 调用 POST /api/workspace/file/rename
 */
export async function renameFile(project: string, path: string, newName: string): Promise<void> {
  await apiFetch(`/workspace/file/rename?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}&new_name=${encodeURIComponent(newName)}`, { method: 'POST' });
}
