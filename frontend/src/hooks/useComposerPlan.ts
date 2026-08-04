/**
 * # ============================================================
 * # useComposerPlan Hook (v1.0.0)
 * # Cycle 61 G61-04
 * # ====================================
 * # 核心作用：封装 ComposerPlan + Plan 一键执行 的前端状态管理
 * # 运行流程：
 * #   1. 加载 ComposerPlan 列表
 * #   2. 一键执行：POST /api/plan-execute 触发 LLM 分解 + 执行
 * #   3. 轮询 / SSE 订阅 execution 状态
 * #   4. pause / resume / cancel / retry / skip
 * # 输入参数：baseUrl, autoRefreshMs
 * # 输出结果：useComposerPlanResult
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-04 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export interface PlanStep {
  step_id: string;
  title: string;
  description?: string;
  action: string;
  params?: Record<string, unknown>;
  depends_on?: string[];
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  progress: number;
  error?: string | null;
  attempts: number;
  max_attempts: number;
  output?: Record<string, unknown>;
  started_at?: number | null;
  finished_at?: number | null;
}

export interface ComposerPlan {
  plan_id: string;
  title: string;
  description: string;
  status: 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  steps: PlanStep[];
  progress?: number;
  summary?: Record<string, number>;
  created_at?: number;
  started_at?: number | null;
  finished_at?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ExecutionState {
  execution_id: string;
  plan_id: string;
  status: string;
  current_step?: string | null;
  progress: number;
  step_results: Array<{
    step_id: string;
    title: string;
    status: string;
    progress: number;
    error?: string | null;
    attempts: number;
    output?: Record<string, unknown>;
  }>;
  started_at: number;
  finished_at?: number | null;
  error?: string | null;
  plan?: ComposerPlan;
}

export interface ExecuteRequest {
  prompt: string;
  system?: string;
  max_steps?: number;
  auto_decompose?: boolean;
  pre_steps?: Array<Record<string, unknown>>;
  model?: string;
  timeout?: number;
}

export interface UseComposerPlanOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
}

export interface UseComposerPlanResult {
  // 计划列表
  plans: ComposerPlan[];
  plansLoading: boolean;
  plansError: string | null;
  refreshPlans: () => Promise<void>;
  // 当前计划
  currentPlan: ComposerPlan | null;
  setCurrentPlan: (plan: ComposerPlan | null) => void;
  // 一键执行
  isExecuting: boolean;
  currentExecution: ExecutionState | null;
  execute: (req: ExecuteRequest) => Promise<ExecutionState | null>;
  executeFromJson: (title: string, steps: Array<Record<string, unknown>>, description?: string) => Promise<ExecutionState | null>;
  refreshExecution: (executionId: string) => Promise<ExecutionState | null>;
  // 控制
  pausePlan: (planId: string) => Promise<boolean>;
  resumePlan: (planId: string) => Promise<boolean>;
  cancelPlan: (planId: string) => Promise<boolean>;
  retryStep: (planId: string, stepId: string) => Promise<boolean>;
  skipStep: (planId: string, stepId: string) => Promise<boolean>;
  // LLMCaller 注入（测试/调试用）
  injectLLMCaller: (callerType: 'default' | 'echo' | 'mock', responseText?: string) => Promise<boolean>;
  // 通用
  error: string | null;
  setError: (err: string | null) => void;
}

const DEFAULT_BASE_URL = '/api';
const DEFAULT_AUTO_REFRESH_MS = 2000;

// ============================================================
// Hook 实现
// ============================================================

export function useComposerPlan(options: UseComposerPlanOptions = {}): UseComposerPlanResult {
  const { baseUrl = DEFAULT_BASE_URL, autoRefreshMs = DEFAULT_AUTO_REFRESH_MS } = options;

  // Plan 列表
  const [plans, setPlans] = useState<ComposerPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);

  // 当前 Plan
  const [currentPlan, setCurrentPlan] = useState<ComposerPlan | null>(null);

  // 执行状态
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecution, setCurrentExecution] = useState<ExecutionState | null>(null);

  // 错误
  const [error, setError] = useState<string | null>(null);

  // 自动轮询的 timer ref
  const pollTimerRef = useRef<number | null>(null);

  // ============================================================
  // 计划列表
  // ============================================================

  const refreshPlans = useCallback(async (): Promise<void> => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const res = await fetch(`${baseUrl}/composer-plan`);
      if (!res.ok) throw new Error(`加载 Plan 列表失败: ${res.status}`);
      const data = await res.json();
      setPlans(data.plans || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPlansError(msg);
    } finally {
      setPlansLoading(false);
    }
  }, [baseUrl]);

  // ============================================================
  // 一键执行
  // ============================================================

  const execute = useCallback(async (req: ExecuteRequest): Promise<ExecutionState | null> => {
    setError(null);
    setIsExecuting(true);
    try {
      const res = await fetch(`${baseUrl}/plan-execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `执行失败: ${res.status}`);
      }
      const data: ExecutionState = await res.json();
      setCurrentExecution(data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setIsExecuting(false);
    }
  }, [baseUrl]);

  const executeFromJson = useCallback(async (
    title: string,
    steps: Array<Record<string, unknown>>,
    description = '',
  ): Promise<ExecutionState | null> => {
    setError(null);
    setIsExecuting(true);
    try {
      const res = await fetch(`${baseUrl}/plan-execute/from-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, steps }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `执行失败: ${res.status}`);
      }
      const data: ExecutionState = await res.json();
      setCurrentExecution(data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setIsExecuting(false);
    }
  }, [baseUrl]);

  const refreshExecution = useCallback(async (executionId: string): Promise<ExecutionState | null> => {
    try {
      const res = await fetch(`${baseUrl}/plan-execute/${encodeURIComponent(executionId)}`);
      if (!res.ok) return null;
      const data: ExecutionState = await res.json();
      setCurrentExecution(data);
      // 同步 plan
      if (data.plan) {
        setCurrentPlan(data.plan);
      }
      return data;
    } catch (e) {
      return null;
    }
  }, [baseUrl]);

  // ============================================================
  // 控制操作
  // ============================================================

  const pausePlan = useCallback(async (planId: string): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl}/composer-plan/${encodeURIComponent(planId)}/pause`, {
        method: 'POST',
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [baseUrl]);

  const resumePlan = useCallback(async (planId: string): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl}/composer-plan/${encodeURIComponent(planId)}/resume`, {
        method: 'POST',
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [baseUrl]);

  const cancelPlan = useCallback(async (planId: string): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl}/composer-plan/${encodeURIComponent(planId)}/cancel`, {
        method: 'POST',
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [baseUrl]);

  const retryStep = useCallback(async (planId: string, stepId: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `${baseUrl}/composer-plan/${encodeURIComponent(planId)}/step/${encodeURIComponent(stepId)}/retry`,
        { method: 'POST' },
      );
      return res.ok;
    } catch {
      return false;
    }
  }, [baseUrl]);

  const skipStep = useCallback(async (planId: string, stepId: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `${baseUrl}/composer-plan/${encodeURIComponent(planId)}/step/${encodeURIComponent(stepId)}/skip`,
        { method: 'POST' },
      );
      return res.ok;
    } catch {
      return false;
    }
  }, [baseUrl]);

  // ============================================================
  // LLMCaller 注入
  // ============================================================

  const injectLLMCaller = useCallback(async (
    callerType: 'default' | 'echo' | 'mock',
    responseText = '',
  ): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl}/plan-execute/llm-caller/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caller_type: callerType, response_text: responseText }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [baseUrl]);

  // ============================================================
  // 自动轮询
  // ============================================================

  useEffect(() => {
    if (!currentExecution) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    // 执行中则轮询
    if (currentExecution.status === 'running') {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      pollTimerRef.current = window.setInterval(() => {
        void refreshExecution(currentExecution.execution_id);
      }, autoRefreshMs);
      return () => {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }
    // 非 running 状态停止轮询
    return undefined;
  }, [currentExecution, autoRefreshMs, refreshExecution]);

  // ============================================================
  // 卸载时清理
  // ============================================================

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  return useMemo(() => ({
    plans,
    plansLoading,
    plansError,
    refreshPlans,
    currentPlan,
    setCurrentPlan,
    isExecuting,
    currentExecution,
    execute,
    executeFromJson,
    refreshExecution,
    pausePlan,
    resumePlan,
    cancelPlan,
    retryStep,
    skipStep,
    injectLLMCaller,
    error,
    setError,
  }), [
    plans, plansLoading, plansError, refreshPlans,
    currentPlan,
    isExecuting, currentExecution,
    execute, executeFromJson, refreshExecution,
    pausePlan, resumePlan, cancelPlan, retryStep, skipStep,
    injectLLMCaller,
    error,
  ]);
}
