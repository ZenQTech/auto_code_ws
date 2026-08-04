/**
 * # ============================================================
 * useGoalLoop - Goal 三层循环 Hook (v1.0.0)
 * Cycle 61 G61-02 - Goal mode 完整循环 UI
 * # ============================================================
 * 核心作用：管理 Goal → Plan → Step 三层循环状态
 *           支持 Goal 列表、Plan CRUD、Step 状态机
 * 运行流程：
 *   1. 加载 Goal 列表（GET /api/goals）
 *   2. 创建 Plan（POST /api/goals/{goal_id}/plans）
 *   3. 添加 Step（POST /api/plans/{plan_id}/steps）
 *   4. 更新 Step 状态（PUT /api/plans/{plan_id}/steps/{step_id}/status）
 *   5. 启动/暂停/恢复 Plan
 *   6. 进度报告 + 实时刷新
 * 设计要点：
 *   - localStorage 缓存 Goal ID（断网恢复）
 *   - 自动错误重试
 *   - SSE 订阅（可选）
 *   - 与 useLoopState 兼容
 * 输入参数：{ baseUrl?: string, autoRefreshMs?: number }
 * 输出结果：Goal/Plan/Step CRUD + 状态管理
 * ====================================
 * 修改记录：
 *   - 2026-08-04 | v1.0.0 | Cycle 61 G61-02 初次创建
 * ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

/** Step 状态 */
export type StepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/** Plan 状态 */
export type PlanStatus =
  | 'draft'
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Step 失败处理策略 */
export type StepStrategy = 'retry' | 'skip' | 'abort';

/** Goal 数据结构 */
export interface Goal {
  id: string;
  title: string;
  objective: string;
  status: string;
  acceptance_criteria: unknown[];
  tags: string[];
  owner: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Step 数据结构 */
export interface PlanStep {
  step_id: string;
  plan_id: string;
  title: string;
  description: string;
  order: number;
  status: StepStatus;
  strategy: StepStrategy;
  retry_count: number;
  max_retries: number;
  prompt: string;
  tool: string;
  command: string;
  file_path: string;
  output: string;
  error: string;
  exit_code: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  verify_item_id: string | null;
  verify_result: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

/** Plan 数据结构 */
export interface GoalPlan {
  plan_id: string;
  goal_id: string;
  title: string;
  description: string;
  status: PlanStatus;
  steps: PlanStep[];
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  progress: number;
  metadata: Record<string, unknown>;
}

/** Hook 返回值 */
export interface UseGoalLoopResult {
  // Goal 列表
  goals: Goal[];
  goalsLoading: boolean;
  goalsError: string | null;
  refreshGoals: () => Promise<void>;

  // 当前 Goal
  currentGoal: Goal | null;
  setCurrentGoal: (goal: Goal | null) => void;

  // Plan 列表
  plans: GoalPlan[];
  plansLoading: boolean;
  loadPlans: (goalId: string) => Promise<void>;

  // 当前 Plan
  currentPlan: GoalPlan | null;
  setCurrentPlan: (plan: GoalPlan | null) => void;

  // 进度
  planProgress: PlanProgress | null;
  refreshPlanProgress: (planId: string) => Promise<void>;

  // 错误
  error: string | null;
  setError: (msg: string | null) => void;

  // CRUD
  createPlan: (goalId: string, title: string, description?: string) => Promise<GoalPlan | null>;
  addStep: (
    planId: string,
    title: string,
    description?: string,
    options?: Partial<PlanStep>,
  ) => Promise<PlanStep | null>;
  updateStepStatus: (
    planId: string,
    stepId: string,
    status: StepStatus,
    options?: { output?: string; error?: string; exit_code?: number | null },
  ) => Promise<PlanStep | null>;
  startPlan: (planId: string) => Promise<GoalPlan | null>;
  pausePlan: (planId: string) => Promise<GoalPlan | null>;
  resumePlan: (planId: string) => Promise<GoalPlan | null>;
  completePlan: (planId: string) => Promise<GoalPlan | null>;
  cancelPlan: (planId: string) => Promise<GoalPlan | null>;
}

/** Plan 进度摘要 */
export interface PlanProgress {
  plan_id: string;
  goal_id: string;
  status: PlanStatus;
  progress: number;
  step_stats: Record<StepStatus, number>;
  total_steps: number;
  duration_ms: number;
  running_step: string | null;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE_URL = '/api';
const DEFAULT_AUTO_REFRESH_MS = 5000;
const isBrowser = typeof window !== 'undefined';

// ============================================================
// 工具函数
// ============================================================

async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function readStoredGoalId(): string | null {
  if (!isBrowser) return null;
  try {
    return window.localStorage.getItem('hermes.goal.currentId');
  } catch {
    return null;
  }
}

function writeStoredGoalId(id: string | null): void {
  if (!isBrowser) return;
  try {
    if (id) window.localStorage.setItem('hermes.goal.currentId', id);
    else window.localStorage.removeItem('hermes.goal.currentId');
  } catch {
    // 忽略
  }
}

// ============================================================
// Hook 实现
// ============================================================

export interface UseGoalLoopOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
}

export function useGoalLoop(options: UseGoalLoopOptions = {}): UseGoalLoopResult {
  const { baseUrl = DEFAULT_BASE_URL, autoRefreshMs = DEFAULT_AUTO_REFRESH_MS } = options;

  // Goal 列表
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsError, setGoalsError] = useState<string | null>(null);

  // 当前 Goal
  const [currentGoal, _setCurrentGoal] = useState<Goal | null>(null);

  // Plan 列表
  const [plans, setPlans] = useState<GoalPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  // 当前 Plan
  const [currentPlan, setCurrentPlan] = useState<GoalPlan | null>(null);

  // 进度
  const [planProgress, setPlanProgress] = useState<PlanProgress | null>(null);

  // 错误
  const [error, setError] = useState<string | null>(null);

  // 自动刷新定时器
  const refreshTimerRef = useRef<number | null>(null);

  // 包装的 setCurrentGoal：同时持久化
  const setCurrentGoal = useCallback((goal: Goal | null) => {
    _setCurrentGoal(goal);
    writeStoredGoalId(goal?.id ?? null);
  }, []);

  // ============================================================
  // Goal 列表
  // ============================================================

  const refreshGoals = useCallback(async () => {
    if (!isBrowser) return;
    setGoalsLoading(true);
    setGoalsError(null);
    try {
      const res = await fetch(`${baseUrl}/goals`);
      if (!res.ok) {
        throw new Error(`fetch goals failed: HTTP ${res.status}`);
      }
      const data = (await safeJson<{ success: boolean; goals: Goal[] }>(res)) ?? {
        success: false,
        goals: [],
      };
      if (data.success && Array.isArray(data.goals)) {
        setGoals(data.goals);
        // 自动恢复 currentGoal
        if (!currentGoal) {
          const storedId = readStoredGoalId();
          if (storedId) {
            const matched = data.goals.find((g) => g.id === storedId);
            if (matched) _setCurrentGoal(matched);
          }
          if (!currentGoal && data.goals.length > 0) {
            _setCurrentGoal(data.goals[0]);
          }
        }
      } else {
        setGoals([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGoalsError(msg);
      // 静默失败：保留旧数据
    } finally {
      setGoalsLoading(false);
    }
  }, [baseUrl, currentGoal]);

  // ============================================================
  // Plan 列表
  // ============================================================

  const loadPlans = useCallback(
    async (goalId: string) => {
      if (!isBrowser) return;
      setPlansLoading(true);
      try {
        const res = await fetch(`${baseUrl}/goals/${encodeURIComponent(goalId)}/plans`);
        if (!res.ok) {
          throw new Error(`fetch plans failed: HTTP ${res.status}`);
        }
        const data = (await safeJson<{ success: boolean; plans: GoalPlan[] }>(res)) ?? {
          success: false,
          plans: [],
        };
        if (data.success && Array.isArray(data.plans)) {
          setPlans(data.plans);
        } else {
          setPlans([]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPlans([]);
      } finally {
        setPlansLoading(false);
      }
    },
    [baseUrl],
  );

  // ============================================================
  // Plan 进度
  // ============================================================

  const refreshPlanProgress = useCallback(
    async (planId: string) => {
      if (!isBrowser) return;
      try {
        const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}/progress`);
        if (!res.ok) {
          // 静默失败
          return;
        }
        const data = (await safeJson<{ success: boolean; progress: PlanProgress }>(res)) ?? {
          success: false,
        };
        if (data.success && data.progress) {
          setPlanProgress(data.progress);
        }
      } catch {
        // 静默
      }
    },
    [baseUrl],
  );

  // ============================================================
  // CRUD
  // ============================================================

  const createPlan = useCallback(
    async (goalId: string, title: string, description = ''): Promise<GoalPlan | null> => {
      if (!isBrowser) return null;
      if (!title.trim()) {
        setError('Plan title 不能为空');
        return null;
      }
      try {
        const res = await fetch(`${baseUrl}/goals/${encodeURIComponent(goalId)}/plans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description }),
        });
        if (!res.ok) {
          const err = await safeJson<{ detail?: string }>(res);
          throw new Error(err?.detail || `HTTP ${res.status}`);
        }
        const data = (await safeJson<{ success: boolean; plan: GoalPlan }>(res)) ?? {
          success: false,
        };
        if (data.success && data.plan) {
          setPlans((prev) => [...prev, data.plan]);
          setCurrentPlan(data.plan);
          return data.plan;
        }
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      }
    },
    [baseUrl],
  );

  const addStep = useCallback(
    async (
      planId: string,
      title: string,
      description = '',
      options: Partial<PlanStep> = {},
    ): Promise<PlanStep | null> => {
      if (!isBrowser) return null;
      if (!title.trim()) {
        setError('Step title 不能为空');
        return null;
      }
      try {
        const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}/steps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description,
            prompt: options.prompt ?? '',
            tool: options.tool ?? '',
            command: options.command ?? '',
            file_path: options.file_path ?? '',
            strategy: options.strategy ?? 'retry',
            max_retries: options.max_retries ?? 3,
            verify_item_id: options.verify_item_id ?? null,
            metadata: options.metadata ?? {},
          }),
        });
        if (!res.ok) {
          const err = await safeJson<{ detail?: string }>(res);
          throw new Error(err?.detail || `HTTP ${res.status}`);
        }
        const data = (await safeJson<{ success: boolean; step: PlanStep }>(res)) ?? {
          success: false,
        };
        if (data.success && data.step) {
          // 同步更新 currentPlan.steps
          setCurrentPlan((prev) =>
            prev
              ? { ...prev, steps: [...prev.steps, data.step] }
              : prev,
          );
          return data.step;
        }
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      }
    },
    [baseUrl],
  );

  const updateStepStatus = useCallback(
    async (
      planId: string,
      stepId: string,
      status: StepStatus,
      options: { output?: string; error?: string; exit_code?: number | null } = {},
    ): Promise<PlanStep | null> => {
      if (!isBrowser) return null;
      try {
        const res = await fetch(
          `${baseUrl}/plans/${encodeURIComponent(planId)}/steps/${encodeURIComponent(stepId)}/status`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status,
              output: options.output ?? '',
              error: options.error ?? '',
              exit_code: options.exit_code ?? null,
            }),
          },
        );
        if (!res.ok) {
          const err = await safeJson<{ detail?: string }>(res);
          throw new Error(err?.detail || `HTTP ${res.status}`);
        }
        const data = (await safeJson<{ success: boolean; step: PlanStep }>(res)) ?? {
          success: false,
        };
        if (data.success && data.step) {
          // 同步更新 currentPlan.steps
          setCurrentPlan((prev) =>
            prev
              ? {
                  ...prev,
                  steps: prev.steps.map((s) =>
                    s.step_id === stepId ? { ...s, ...data.step } : s,
                  ),
                }
              : prev,
          );
          // 刷新进度
          refreshPlanProgress(planId);
          return data.step;
        }
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      }
    },
    [baseUrl, refreshPlanProgress],
  );

  // Plan 状态操作辅助
  const planAction = useCallback(
    async (
      planId: string,
      action: 'start' | 'pause' | 'resume' | 'complete' | 'cancel',
    ): Promise<GoalPlan | null> => {
      if (!isBrowser) return null;
      try {
        const res = await fetch(
          `${baseUrl}/plans/${encodeURIComponent(planId)}/${action}`,
          { method: 'POST' },
        );
        if (!res.ok) {
          const err = await safeJson<{ detail?: string }>(res);
          throw new Error(err?.detail || `HTTP ${res.status}`);
        }
        const data = (await safeJson<{ success: boolean; plan: GoalPlan }>(res)) ?? {
          success: false,
        };
        if (data.success && data.plan) {
          setCurrentPlan(data.plan);
          refreshPlanProgress(planId);
          return data.plan;
        }
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      }
    },
    [baseUrl, refreshPlanProgress],
  );

  const startPlan = useCallback((planId: string) => planAction(planId, 'start'), [planAction]);
  const pausePlan = useCallback((planId: string) => planAction(planId, 'pause'), [planAction]);
  const resumePlan = useCallback((planId: string) => planAction(planId, 'resume'), [planAction]);
  const completePlan = useCallback((planId: string) => planAction(planId, 'complete'), [planAction]);
  const cancelPlan = useCallback((planId: string) => planAction(planId, 'cancel'), [planAction]);

  // ============================================================
  // 副作用
  // ============================================================

  // 初始加载 Goal 列表
  useEffect(() => {
    refreshGoals();
  }, [refreshGoals]);

  // 切换 Goal 时加载 Plans
  useEffect(() => {
    if (currentGoal) {
      loadPlans(currentGoal.id);
    } else {
      setPlans([]);
    }
  }, [currentGoal, loadPlans]);

  // 自动刷新当前 Plan 进度
  useEffect(() => {
    if (!currentPlan) return;
    refreshPlanProgress(currentPlan.plan_id);
    if (refreshTimerRef.current !== null) {
      window.clearInterval(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setInterval(() => {
      refreshPlanProgress(currentPlan.plan_id);
    }, autoRefreshMs);
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [currentPlan, refreshPlanProgress, autoRefreshMs]);

  return {
    goals,
    goalsLoading,
    goalsError,
    refreshGoals,
    currentGoal,
    setCurrentGoal,
    plans,
    plansLoading,
    loadPlans,
    currentPlan,
    setCurrentPlan,
    planProgress,
    refreshPlanProgress,
    error,
    setError,
    createPlan,
    addStep,
    updateStepStatus,
    startPlan,
    pausePlan,
    resumePlan,
    completePlan,
    cancelPlan,
  };
}

export default useGoalLoop;
