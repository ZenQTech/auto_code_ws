/**
 * # ============================================================
 * useComposer Hook (v6.36.0 Cycle 16 P0-1 / v1.1.0 P1-5 升级 / v1.2.0 P0-1 Plan 集成 / v1.3.0 P0-1 集成层 / v1.4.0 P0-2 Summary 集成)
 * # ============================================================
 * 核心作用：React Hook 包装 ComposerEngine
 * 使用场景：ComposerPanel 等 UI 组件订阅 session 变化
 * 设计说明：
 *   - 接受可选的 engine 参数（用于测试或外部共享实例）
 *   - 默认每个组件独立 engine（生产场景下也推荐共享一个）
 *   - UI 状态（isOpen / isFullscreen）已下沉到 engine（v1.1.0）
 *     解决多组件调用 hook 时状态不同步问题
 *   - v1.2.0: 集成 PlanEngine，支持 Plan Mode
 *   - v1.3.0: 集成 composerEngine.integration 层（Cycle 18 P0-1）
 *     - 暴露 resolvedReferences / resolutionErrors / projectRules
 *     - 暴露 resolveAllReferences / loadProjectRules / setProjectRules
 *     - 暴露 injectRules / getRulesMetadata
 *   - v1.4.0: 集成 composerEngine.summary.integration 层（Cycle 18 P0-2）
 *     - 暴露 summaryHistory / summaryConfig / tokensUsed / shouldSummarize
 *     - 暴露 summarize / applySummary / unapplySummary / deleteSummary / clearSummaryHistory
 *     - 暴露 updateSummaryConfig
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | Cycle 16 P0-1 初次创建
 *   - 2026-07-29 | v1.1.0 | P1-5 UI 状态下沉到引擎
 *   - 2026-07-29 | v1.2.0 | Cycle 17 P0-1 Plan Mode 集成
 *   - 2026-07-29 | v1.3.0 | Cycle 18 P0-1 集成层
 *   - 2026-07-29 | v1.4.0 | Cycle 18 P0-2 Summary 集成
 *     - 集成 composerEngine.summary.integration
 *     - 暴露 12 个新 API
 * ============================================================
 */

import React, { useCallback, useContext, useEffect, useRef, useState, createContext } from 'react';
import {
  ComposerEngine,
  createComposerEngine,
  type ComposerSession,
  type ContextEntry,
  type ComposerEdit,
  type Snapshot,
  type ComposerUIState,
} from '../utils/composerEngine';
import {
  createPlanEngine,
  type Plan,
  type PlanStage,
} from '../utils/composerEngine.plan';
import {
  resolveAllReferences,
  loadProjectRules,
  setProjectRules,
  getProjectRules,
  getResolvedReferences,
  getResolutionErrors,
  injectRules,
  subscribeIntegration,
  getRulesMetadata,
  resetIntegration,
  type ResolvedReference,
  type ResolutionError,
  type ComposerIntegrationState,
  type RulesMetadata,
} from '../utils/composerEngine.integration';
import {
  getSummaryHistory,
  getSummaryConfig,
  getCurrentTokens,
  shouldSummarize as shouldSummarizeFn,
  generateSummary,
  applySummary as applySummaryFn,
  unapplySummary,
  deleteSummary,
  clearSummaryHistory,
  updateSummaryConfig,
  subscribeSummary,
  resetSummaryIntegration,
  type ComposerSummaryState,
} from '../utils/composerEngine.summary.integration';
import type { Summary, SummaryConfig } from '../utils/composerEngine.summary';
import type { HermesRules } from '../utils/hermesRules';

/** Composer 引擎 Context（用于跨组件共享同一实例） */
const ComposerContext = createContext<ComposerEngine | null>(null);

/** Provider：跨组件共享同一 ComposerEngine */
export const ComposerProvider: React.FC<{
  engine?: ComposerEngine;
  children: React.ReactNode;
}> = ({ engine: providedEngine, children }) => {
  const ref = useRef<ComposerEngine | null>(null);
  if (!ref.current) {
    ref.current = providedEngine ?? createComposerEngine();
  }
  return (
    <ComposerContext.Provider value={ref.current}>{children}</ComposerContext.Provider>
  );
};

export interface UseComposerResult {
  // 状态
  isOpen: boolean;
  session: ComposerSession;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  canUndo: boolean;
  canRedo: boolean;

  // 面板控制
  open: () => void;
  close: () => void;
  toggle: () => void;
  setFullscreen: (fullscreen: boolean) => void;
  isFullscreen: boolean;

  // 提示词
  setPrompt: (prompt: string) => void;

  // 上下文
  addContext: (entry: ContextEntry) => void;
  removeContext: (type: ContextEntry['type'], identifier: string) => void;
  clearContext: () => void;

  // 编辑
  addEdit: (edit: Omit<ComposerEdit, 'id' | 'status' | 'createdAt'>) => ComposerEdit;
  acceptEdit: (editId: string) => void;
  rejectEdit: (editId: string, feedback?: string) => void;
  modifyEdit: (editId: string, newContent: string, description?: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  clearEdits: () => void;

  // 快照
  createSnapshot: (description: string, fileStates: Record<string, string>) => Snapshot;
  undo: () => Snapshot | null;
  redo: () => Snapshot | null;
  rollback: (snapshotId: string) => Snapshot | null;
  currentSnapshot: Snapshot | null;

  // 重置
  reset: () => void;

  // v1.2.0 Plan Mode
  plan: Plan | null;
  planStage: PlanStage;
  planModeEnabled: boolean;
  generatePlan: (prompt: string) => Promise<Plan | null>;
  approveStep: (stepId: string) => void;
  rejectStep: (stepId: string, reason?: string) => void;
  modifyStep: (stepId: string, description: string) => void;
  approveAllSteps: () => void;
  rejectAllSteps: () => void;
  approvePlan: () => void;
  rejectPlan: (reason?: string) => void;
  executePlan: () => Promise<ComposerEdit[]>;
  clearPlan: () => void;
  setPlanMode: (enabled: boolean) => void;

  // v1.3.0 Integration Layer (Cycle 18 P0-1)
  resolvedReferences: ResolvedReference[];
  resolutionErrors: ResolutionError[];
  projectRules: HermesRules;
  rulesLoaded: boolean;
  resolveReferences: (
    prompt: string,
    options?: { codebaseTopK?: number; gitLimit?: number; apiBase?: string }
  ) => Promise<ResolvedReference[]>;
  loadRules: (rulesYaml?: string) => Promise<{ success: boolean; error: string | null }>;
  updateProjectRules: (rules: HermesRules) => void;
  injectRulesIntoPrompt: (prompt: string) => string;
  getRulesMeta: () => RulesMetadata;

  // v1.4.0 Summary 集成 (Cycle 18 P0-2)
  summaryHistory: Summary[];
  summaryConfig: SummaryConfig;
  appliedSummaryId: string | null;
  tokensUsed: number;
  shouldSummarize: boolean;
  summarize: (options?: { force?: boolean }) => Summary | null;
  applySummary: (summaryId: string) => boolean;
  unapplySummary: () => boolean;
  deleteSummary: (summaryId: string) => boolean;
  clearSummaryHistory: () => void;
  updateSummaryConfig: (config: Partial<SummaryConfig>) => void;
}

export function useComposer(): UseComposerResult {
  const contextEngine = useContext(ComposerContext);
  const localRef = useRef<ComposerEngine | null>(null);
  const planEngineRef = useRef<ReturnType<typeof createPlanEngine> | null>(null);
  if (localRef.current === null && !contextEngine) {
    localRef.current = createComposerEngine();
  }
  const engine = contextEngine ?? localRef.current!;

  // v1.2.0: 初始化 PlanEngine（每个 hook 实例独立）
  if (planEngineRef.current === null) {
    planEngineRef.current = createPlanEngine();
  }
  const planEngine = planEngineRef.current;

  const [session, setSession] = useState<ComposerSession>(engine.getSession());
  const [ui, setUI] = useState<ComposerUIState>(engine.getUIState());
  const [plan, setPlan] = useState<Plan | null>(planEngine.getCurrentPlan());
  const [planStage, setPlanStage] = useState<PlanStage>(planEngine.getStage());
  const [planModeEnabled, setPlanModeEnabled] = useState<boolean>(false);

  useEffect(() => {
    const unsub = engine.subscribe(setSession);
    const unsubUI = engine.subscribeUI(setUI);
    const unsubPlan = planEngine.subscribe((p, s) => {
      setPlan(p);
      setPlanStage(s);
    });
    return () => {
      unsub();
      unsubUI();
      unsubPlan();
    };
  }, [engine, planEngine]);

  // 卸载时销毁（仅销毁本地 engine）
  useEffect(() => {
    return () => {
      if (!contextEngine) {
        engine.destroy();
      }
    };
  }, [engine, contextEngine]);

  // 快捷键 Cmd/Ctrl+I 切换面板
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 避免在输入框中触发
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        // 输入框中也允许 Cmd+I（这是产品需求）
        // 但需要避免在其他快捷键冲突时误触
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        engine.togglePanel();
      }
      if (e.key === 'Escape' && ui.isOpen) {
        e.preventDefault();
        engine.closePanel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [engine, ui.isOpen]);

  const open = useCallback(() => engine.openPanel(), [engine]);
  const close = useCallback(() => engine.closePanel(), [engine]);
  const toggle = useCallback(() => engine.togglePanel(), [engine]);
  const setFullscreen = useCallback(
    (fullscreen: boolean) => engine.setFullscreen(fullscreen),
    [engine],
  );

  const setPrompt = useCallback((p: string) => engine.setPrompt(p), [engine]);

  const addContext = useCallback((entry: ContextEntry) => engine.addContext(entry), [engine]);
  const removeContext = useCallback(
    (type: ContextEntry['type'], identifier: string) =>
      engine.removeContext(type, identifier),
    [engine]
  );
  const clearContext = useCallback(() => engine.clearContext(), [engine]);

  const addEdit = useCallback(
    (edit: Omit<ComposerEdit, 'id' | 'status' | 'createdAt'>) => engine.addEdit(edit),
    [engine]
  );
  const acceptEdit = useCallback((id: string) => engine.acceptEdit(id), [engine]);
  const rejectEdit = useCallback(
    (editId: string, feedback?: string) => engine.rejectEdit(editId, feedback),
    [engine]
  );
  const modifyEdit = useCallback(
    (editId: string, c: string, d?: string) => engine.modifyEdit(editId, c, d),
    [engine]
  );
  const acceptAll = useCallback(() => engine.acceptAll(), [engine]);
  const rejectAll = useCallback(() => engine.rejectAll(), [engine]);
  const clearEdits = useCallback(() => engine.clearEdits(), [engine]);

  const createSnapshot = useCallback(
    (d: string, f: Record<string, string>) => engine.createSnapshot(d, f),
    [engine]
  );
  const undo = useCallback(() => engine.undo(), [engine]);
  const redo = useCallback(() => engine.redo(), [engine]);
  const rollback = useCallback((id: string) => engine.rollback(id), [engine]);

  const reset = useCallback(() => engine.reset(), [engine]);

  // v1.2.0 Plan Mode 相关
  const generatePlan = useCallback(
    async (prompt: string): Promise<Plan | null> => {
      try {
        const context = engine.getSession().context.files.map((f) => ({
          path: f.path,
          content: f.content,
          language: f.language,
        }));
        const result = await planEngine.generatePlan(prompt, context);
        return result;
      } catch (err) {
        console.error('generatePlan error:', err);
        return null;
      }
    },
    [engine, planEngine]
  );

  const approveStep = useCallback(
    (stepId: string) => planEngine.approveStep(stepId),
    [planEngine]
  );

  const rejectStep = useCallback(
    (stepId: string, reason?: string) => planEngine.rejectStep(stepId, reason),
    [planEngine]
  );

  const modifyStep = useCallback(
    (stepId: string, description: string) => planEngine.modifyStep(stepId, description),
    [planEngine]
  );

  const approveAllSteps = useCallback(() => planEngine.approveAll(), [planEngine]);
  const rejectAllSteps = useCallback(() => planEngine.rejectAll(), [planEngine]);

  const approvePlan = useCallback(() => planEngine.approvePlan(), [planEngine]);
  const rejectPlan = useCallback(
    (reason?: string) => planEngine.rejectPlan(reason),
    [planEngine]
  );

  const executePlan = useCallback(async (): Promise<ComposerEdit[]> => {
    const currentPlan = planEngine.getCurrentPlan();
    if (!currentPlan) return [];
    // 默认 editGenerator: 从 engine 当前 session 中读取 beforeContent，
    // afterContent 用占位符（由后续 LLM 流程替换）
    const results = await planEngine.executePlan(async (step) => ({
      beforeContent: '',
      afterContent: `// TODO: ${step.modifiedDescription ?? step.description}`,
    }));
    // 将结果转换为 ComposerEdit 草稿
    const edits: ComposerEdit[] = [];
    for (const { stepId } of results) {
      const step = currentPlan.steps.find((s) => s.id === stepId);
      if (step) {
        const edit = engine.addEdit({
          filePath: step.filePath,
          beforeContent: step.beforeContent ?? '',
          afterContent: step.afterContent ?? '',
          description: step.modifiedDescription ?? step.description,
        });
        edits.push(edit);
        // 更新 plan step 的 editId 关联
        step.editId = edit.id;
      }
    }
    return edits;
  }, [planEngine, engine]);

  const clearPlan = useCallback(() => planEngine.clearPlan(), [planEngine]);
  const setPlanMode = useCallback((enabled: boolean) => setPlanModeEnabled(enabled), []);

  // v1.3.0: 集成层状态 - resolvedReferences / resolutionErrors / projectRules
  const [integrationState, setIntegrationState] = useState<ComposerIntegrationState>(() => ({
    resolvedReferences: getResolvedReferences(engine),
    resolutionErrors: getResolutionErrors(engine),
    projectRules: getProjectRules(engine),
    rulesLoaded: false,
    lastResolvedAt: 0,
  }));

  useEffect(() => {
    // 初始重置，避免上一个测试/组件的状态污染
    resetIntegration(engine);
    setIntegrationState({
      resolvedReferences: [],
      resolutionErrors: [],
      projectRules: getProjectRules(engine),
      rulesLoaded: false,
      lastResolvedAt: 0,
    });
    const unsub = subscribeIntegration(engine, (state) => {
      setIntegrationState({
        resolvedReferences: [...state.resolvedReferences],
        resolutionErrors: [...state.resolutionErrors],
        projectRules: state.projectRules,
        rulesLoaded: state.rulesLoaded,
        lastResolvedAt: state.lastResolvedAt,
      });
    });
    return () => {
      unsub();
    };
  }, [engine]);

  // 解析所有 @codebase / @git / @diff 引用
  const resolveReferences = useCallback(
    async (
      prompt: string,
      options?: { codebaseTopK?: number; gitLimit?: number; apiBase?: string }
    ): Promise<ResolvedReference[]> => {
      return await resolveAllReferences(engine, prompt, options);
    },
    [engine]
  );

  // 加载项目级 AI 规则
  const loadRules = useCallback(
    async (rulesYaml?: string): Promise<{ success: boolean; error: string | null }> => {
      return await loadProjectRules(engine, rulesYaml);
    },
    [engine]
  );

  // 直接设置项目级 AI 规则
  const updateProjectRules = useCallback(
    (rules: HermesRules) => {
      setProjectRules(engine, rules);
    },
    [engine]
  );

  // 注入规则到 prompt
  const injectRulesIntoPrompt = useCallback(
    (prompt: string) => injectRules(engine, prompt),
    [engine]
  );

  // 获取规则元数据
  const getRulesMeta = useCallback((): RulesMetadata => {
    return getRulesMetadata(engine);
  }, [engine]);

  // v1.4.0: Summary 集成层状态
  const [summaryState, setSummaryState] = useState<ComposerSummaryState>(() => ({
    history: getSummaryHistory(engine),
    config: getSummaryConfig(engine),
    appliedSummaryId: null,
    originalPrompt: null,
    lastSummarizedAt: 0,
    applyCount: 0,
  }));

  useEffect(() => {
    // 初始重置
    resetSummaryIntegration(engine);
    setSummaryState({
      history: [],
      config: getSummaryConfig(engine),
      appliedSummaryId: null,
      originalPrompt: null,
      lastSummarizedAt: 0,
      applyCount: 0,
    });
    const unsub = subscribeSummary(engine, (state) => {
      setSummaryState({
        history: [...state.history],
        config: state.config,
        appliedSummaryId: state.appliedSummaryId,
        originalPrompt: state.originalPrompt,
        lastSummarizedAt: state.lastSummarizedAt,
        applyCount: state.applyCount,
      });
    });
    return () => {
      unsub();
    };
  }, [engine]);

  // 生成摘要
  const summarize = useCallback(
    (options?: { force?: boolean }): Summary | null => {
      return generateSummary(engine, options);
    },
    [engine]
  );

  // 应用摘要
  const applySummary = useCallback(
    (summaryId: string): boolean => {
      return applySummaryFn(engine, summaryId);
    },
    [engine]
  );

  // 删除摘要
  const deleteSummaryFn = useCallback(
    (summaryId: string): boolean => {
      return deleteSummary(engine, summaryId);
    },
    [engine]
  );

  // 清空摘要历史
  const clearSummary = useCallback(() => {
    clearSummaryHistory(engine);
  }, [engine]);

  // 更新配置
  const updateSummaryConfigFn = useCallback(
    (config: Partial<SummaryConfig>) => {
      updateSummaryConfig(engine, config);
    },
    [engine]
  );

  return {
    isOpen: ui.isOpen,
    session,
    pendingCount: engine.getPendingCount(),
    acceptedCount: engine.getAcceptedCount(),
    rejectedCount: engine.getRejectedCount(),
    canUndo: engine.canUndo(),
    canRedo: engine.canRedo(),

    open,
    close,
    toggle,
    setFullscreen,
    isFullscreen: ui.isFullscreen,

    setPrompt,
    addContext,
    removeContext,
    clearContext,

    addEdit,
    acceptEdit,
    rejectEdit,
    modifyEdit,
    acceptAll,
    rejectAll,
    clearEdits,

    createSnapshot,
    undo,
    redo,
    rollback,
    currentSnapshot: engine.getCurrentSnapshot(),

    reset,

    // v1.2.0 Plan Mode
    plan,
    planStage,
    planModeEnabled,
    generatePlan,
    approveStep,
    rejectStep,
    modifyStep,
    approveAllSteps,
    rejectAllSteps,
    approvePlan,
    rejectPlan,
    executePlan,
    clearPlan,
    setPlanMode,

    // v1.3.0 Integration Layer
    resolvedReferences: integrationState.resolvedReferences,
    resolutionErrors: integrationState.resolutionErrors,
    projectRules: integrationState.projectRules,
    rulesLoaded: integrationState.rulesLoaded,
    resolveReferences,
    loadRules,
    updateProjectRules,
    injectRulesIntoPrompt,
    getRulesMeta,

    // v1.4.0 Summary 集成
    summaryHistory: summaryState.history,
    summaryConfig: summaryState.config,
    appliedSummaryId: summaryState.appliedSummaryId,
    tokensUsed: getCurrentTokens(engine),
    shouldSummarize: shouldSummarizeFn(engine),
    summarize,
    applySummary,
    unapplySummary: () => unapplySummary(engine),
    deleteSummary: deleteSummaryFn,
    clearSummaryHistory: clearSummary,
    updateSummaryConfig: updateSummaryConfigFn,
  };
}

export default useComposer;
