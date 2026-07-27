import { apiFetch } from './apiShared';
import type { GoalData, PipelineData, ReviewData } from '../types';

/**
 * # ============================================================
 * 工作流 API 模块
 * # ============================================================
 * 核心作用：封装架构设计 / Hermes 对话 / 优化 / 确认执行 API
 * 拆分日期：2026-07-27
 * 来源文件：hooks/useApi.ts (v3.0.0, 1872 行单文件)
 * 模块版本：v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 从 useApi.ts 抽离 startDesignPhase + confirmDesignPhase + rejectDesignPhase + chatWithHermes* + optimizeWithHermes + confirmPlan 共 8 个函数
 * ============================================================
 */

/**
 * 共享类型导入
 */
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
    // v4.2.0 新增：分阶段推理 SSE 事件回调（P1-4 补齐）
    // 阶段：analysis / planning / coding / testing
    onReasoningStage?: (data: { stage: string; stageLabel: string; progress: number; workflowId?: string }) => void;
    onDone?: () => void;
    onError?: (error: string) => void;
  },
  sessionMode?: string,  // v2.4.0 新增: 会话模式 "chat" | "coding"
  signal?: AbortSignal,
): Promise<void> {
  const { onThinking, onText, onClarifyQuestions, onWorkflowStarted, onReviewResult, onPipelineStep, onGoalUpdate, onReasoningStage, onDone, onError } = callbacks;

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
            // v4.2.0 新增：分阶段推理事件（P1-4 补齐）
            // 阶段：analysis / planning / coding / testing
            case 'reasoning_stage':
              onReasoningStage?.({
                stage: event.stage,
                stageLabel: event.stage_label || event.stage,
                progress: typeof event.progress === 'number' ? event.progress : 0,
                workflowId: event.workflow_id,
              });
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

// ============================================================
// v6.14.0 (Cycle 4 P0-3) 新增：Plan Mode 模式 API
// 完整链路：Plan → Execute → Rollback
// ============================================================

/** Plan 风险点 */
export interface PlanRisk {
  risk_id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  mitigation: string;
}

/** Plan 单个任务 */
export interface PlanTask {
  task_id: string;
  title: string;
  description: string;
  stage: string;
  estimated_minutes: number;
  risk_level: 'low' | 'medium' | 'high' | 'extreme';
  files_involved: string[];
  dependencies: string[];
  acceptance_criteria: string;
}

/** Plan 单个阶段 */
export interface PlanStage {
  stage: string;
  tasks: PlanTask[];
  risks: PlanRisk[];
  alternatives: string[];
}

/** 完整 Plan 文档 */
export interface PlanDocument {
  plan_id: string;
  workflow_id: string;
  objective: string;
  stages: PlanStage[];
  generated_at: string;
  status: 'pending' | 'confirmed' | 'modified' | 'rejected';
  user_modifications: string;
  total_estimated_minutes: number;
}

/** Plan 生成请求参数 */
export interface PlanGenerateParams {
  workflowId: string;
  objective?: string;
  specDoc?: string;
  architectureDoc?: string;
}

/** Plan 操作通用响应 */
export interface PlanOperationResponse {
  success: boolean;
  plan: PlanDocument | null;
  message: string;
}

/**
 * 生成 Plan
 * 作用：调用 POST /api/workflow/{workflow_id}/plan/generate
 *      让 LLM 根据 spec/architecture 生成结构化 Plan
 * 参数：
 *   - params: { workflowId, objective?, specDoc?, architectureDoc? }
 * 返回值：PlanOperationResponse，含 PlanDocument
 */
export async function generatePlan(
  params: PlanGenerateParams
): Promise<PlanOperationResponse> {
  return apiFetch<PlanOperationResponse>(
    `/workflow/${params.workflowId}/plan/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        objective: params.objective || '',
        spec_doc: params.specDoc || '',
        architecture_doc: params.architectureDoc || '',
      }),
    }
  );
}

/**
 * 获取当前工作流的 Plan
 * 作用：调用 GET /api/workflow/{workflow_id}/plan
 *      从数据库恢复 Plan（用于 reload workflow 后展示）
 * 参数：
 *   - workflowId: string
 * 返回值：PlanOperationResponse，plan 可能为 null（未生成时）
 */
export async function getPlan(workflowId: string): Promise<PlanOperationResponse> {
  return apiFetch<PlanOperationResponse>(`/workflow/${workflowId}/plan`, {
    method: 'GET',
  });
}

/**
 * 确认 Plan
 * 作用：调用 POST /api/workflow/{workflow_id}/plan/confirm
 *      用户确认后，plan_confirmed=True 推进到执行阶段
 * 参数：
 *   - workflowId: string
 *   - planId: string
 *   - userModifications?: string
 * 返回值：PlanOperationResponse
 */
export async function confirmPlanApi(
  workflowId: string,
  planId: string,
  userModifications: string = ''
): Promise<PlanOperationResponse> {
  return apiFetch<PlanOperationResponse>(
    `/workflow/${workflowId}/plan/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
        user_modifications: userModifications,
      }),
    }
  );
}

/**
 * 修改 Plan
 * 作用：调用 POST /api/workflow/{workflow_id}/plan/modify
 *      用户可增删任务/阶段、调整顺序、修改内容
 * 参数：
 *   - workflowId: string
 *   - plan: PlanDocument（修改后的）
 *   - userModifications?: string
 * 返回值：PlanOperationResponse
 */
export async function modifyPlanApi(
  workflowId: string,
  plan: PlanDocument,
  userModifications: string = ''
): Promise<PlanOperationResponse> {
  return apiFetch<PlanOperationResponse>(
    `/workflow/${workflowId}/plan/modify`,
    {
      method: 'POST',
      body: JSON.stringify({
        plan: plan,
        user_modifications: userModifications,
      }),
    }
  );
}

/**
 * 拒绝 Plan（触发重新生成）
 * 作用：调用 POST /api/workflow/{workflow_id}/plan/reject
 * 参数：
 *   - workflowId: string
 *   - reason: string
 * 返回值：PlanOperationResponse
 */
export async function rejectPlanApi(
  workflowId: string,
  reason: string = ''
): Promise<PlanOperationResponse> {
  return apiFetch<PlanOperationResponse>(
    `/workflow/${workflowId}/plan/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

