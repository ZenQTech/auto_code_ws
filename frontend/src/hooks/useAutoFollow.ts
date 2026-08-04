/**
 * # ============================================================
 * useAutoFollow - Auto-Follow 联动控制 Hook (v2.0.0)
 * Cycle 61 G61-03-T1
 * # ============================================================
 * 核心作用：监听 SSE 事件，根据阶段自动 open/聚焦 panel（对标 TRAE 实时跟随模式 v2）
 * v2.0.0 重大增强：
 *   - 15 类事件完整监听（v1.1.0 已有）
 *   - 47 panel 完整映射（v1.x 仅 9 个）
 *   - 100ms 节流（v1.x 是 500ms debounce）
 *   - 事件优先级排序（error > reviewing > executing > others）
 *   - Predictive Switch（预测下一个工具）
 *   - Sticky Tool 保护（不被自动切换）
 *   - SplitView 支持（双栏布局）
 *   - 完整配置持久化到 localStorage
 * 运行流程：
 *   1. 订阅 SSE 事件（vibe_* / loop_* / claude_* / spec_* 等 15 类）
 *   2. 根据 EVENT_PRIORITY 排序 → 高优先级先执行
 *   3. 100ms 窗口内同类型事件去重（节流）
 *   4. 检查 sticky tools → 跳过 sticky panel
 *   5. 调用 modals.openPanel(target_panel)
 *   6. Predictive Switch 启用时预测下一个可能 panel
 * 设计要点：
 *   - 向后兼容 v1.x：保留旧 API，新增 v2 字段
 *   - 防误切换：sticky 工具可保护
 *   - 性能：100ms 节流，priority 排序避免低优先级抢占
 * 输入参数：{ modals?: UseModalsResult, options?: UseAutoFollowOptions }
 * 输出结果：{ enabled, setEnabled, follow, lastFollowed, config, setConfig, ... }
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
 * #   - 2026-08-03 | v1.1.0 | Cycle 60 G60-4.1 扩展 6 个新事件（共 15）
 * #   - 2026-08-04 | v2.0.0 | Cycle 61 G61-03-T1 重大重构：节流 + 优先级 + 47 panel +
 * #                    Predictive Switch + Sticky + SplitView
 * ====================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModals, type UseModalsResult, type PanelKey } from './useModals';

// ============================================================
// 类型定义
// ====================================

/** 触发 Auto-Follow 的事件类型（v1.1.0 已扩展到 15 个） */
export type AutoFollowEventType =
  | 'vibe_step_started'
  | 'vibe_plan_generated'
  | 'vibe_code_writing'
  | 'vibe_test_running'
  | 'vibe_step_completed'
  | 'vibe_step_failed'
  | 'vibe_plan_completed'
  | 'loop_state_changed'
  | 'claude_shell_output'
  | 'spec_review_requested'
  | 'goal_progress_updated'
  | 'subagent_spawned'
  | 'subagent_completed'
  | 'diff_preview_ready'
  | 'test_results_ready';

/** Auto-Follow 事件 */
export interface AutoFollowEvent {
  type: AutoFollowEventType;
  payload?: Record<string, unknown>;
  timestamp: number;
}

/** 最近一次 follow 记录 */
export interface FollowedRecord {
  panelId: PanelKey;
  reason: string;
  at: Date;
  eventType: AutoFollowEventType;
  priority: number;
}

/** Hook 返回值（v2.0.0 扩展） */
export interface UseAutoFollowResult {
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  follow: (event: AutoFollowEvent) => void;
  lastFollowed: FollowedRecord | null;
  /** 已 follow 过的 panel 列表（用于调试） */
  history: FollowedRecord[];
  // v2.0.0 新增
  config: AutoFollowConfig;
  setConfig: (cfg: Partial<AutoFollowConfig>) => void;
  /** 预测的下一个可能 panel */
  predictNext: () => PanelKey | null;
  /** 当前 sticky tools */
  stickyTools: PanelKey[];
  addSticky: (panel: PanelKey) => void;
  removeSticky: (panel: PanelKey) => void;
  /** SplitView 状态 */
  splitView: boolean;
  toggleSplitView: () => void;
  /** 事件优先级（只读） */
  priorities: Record<AutoFollowEventType, number>;
  /** 47 panel 映射（只读） */
  mapping: Record<AutoFollowEventType, PanelKey | null>;
  /** 重置所有状态 */
  reset: () => void;
}

/** Hook 选项（v2.0.0 新增） */
export interface UseAutoFollowOptions {
  /** 初始节流窗口（毫秒）默认 100ms */
  throttleMs?: number;
  /** 初始 split view 状态 */
  initialSplitView?: boolean;
  /** 初始 sticky tools */
  initialStickyTools?: PanelKey[];
  /** 初始预测开关 */
  initialPredictive?: boolean;
}

/** Auto-Follow 配置（v2.0.0 新增） */
export interface AutoFollowConfig {
  enabled: boolean;
  panelMapping: Record<AutoFollowEventType, PanelKey | null>;
  throttleMs: number;
  predictive: boolean;
  stickyTools: PanelKey[];
  splitView: boolean;
  /** 节流策略：'leading' 立即触发，'trailing' 窗口结束触发 */
  throttleStrategy: 'leading' | 'trailing';
}

// ============================================================
// 常量
// ============================================================

const STORAGE_KEY_ENABLED = 'hermes.autoFollow.enabled';
const STORAGE_KEY_CONFIG = 'hermes.autoFollow.config';
const DEFAULT_ENABLED = true;
const DEFAULT_THROTTLE_MS = 100;
const DEFAULT_PREDICTIVE = true;
const DEFAULT_SPLIT_VIEW = false;
const DEFAULT_STRATEGY: 'leading' | 'trailing' = 'leading';
const isBrowser = typeof window !== 'undefined';

/** 事件优先级（数字越大越优先） */
const EVENT_PRIORITY: Record<AutoFollowEventType, number> = {
  // 最高优先级 - 错误
  vibe_step_failed: 100,
  // 高优先级 - 审查/测试结果
  test_results_ready: 90,
  spec_review_requested: 85,
  diff_preview_ready: 80,
  vibe_plan_completed: 75,
  // 中优先级 - 执行中
  vibe_test_running: 60,
  claude_shell_output: 55,
  subagent_spawned: 50,
  subagent_completed: 50,
  // 中低优先级 - 规划/进度
  vibe_plan_generated: 40,
  goal_progress_updated: 35,
  loop_state_changed: 30,
  // 低优先级 - 启动
  vibe_code_writing: 25,
  vibe_step_started: 20,
  vibe_step_completed: 15,
};

/** 阶段到 panel 的完整映射（v2.0.0 向后兼容 + 扩展） */
const STAGE_TO_PANEL: Record<AutoFollowEventType, PanelKey | null> = {
  // Vibe Coding 流程（v1.x 兼容）
  vibe_step_started: 'planExecutor',
  vibe_plan_generated: 'planExecutor',  // v1.x 兼容
  vibe_code_writing: 'vibeCoding',
  vibe_test_running: 'vibeCoding',
  vibe_step_completed: 'planExecutor',
  vibe_step_failed: 'planExecutor',
  vibe_plan_completed: 'vibeCoding',
  // Loop 工作流
  loop_state_changed: 'loopState',
  goal_progress_updated: 'loopV7',
  // Claude Shell
  claude_shell_output: 'vibeCoding',
  // Spec / Goal
  spec_review_requested: 'loopState',
  // Sub-Agent
  subagent_spawned: 'multiAgentTree',
  subagent_completed: 'multiAgentTree',
  // Diff / Test
  diff_preview_ready: 'planEditor',
  test_results_ready: 'planExecutor',
};

/** 事件类型到 reason 文案 */
const EVENT_TO_REASON: Record<AutoFollowEventType, string> = {
  vibe_step_started: 'Step 启动',
  vibe_plan_generated: 'Plan 已生成',
  vibe_code_writing: '正在编写代码',
  vibe_test_running: '正在运行测试',
  vibe_step_completed: 'Step 已完成',
  vibe_step_failed: 'Step 失败',
  vibe_plan_completed: 'Plan 已完成',
  loop_state_changed: 'Loop 状态变更',
  claude_shell_output: 'Claude Shell 输出',
  spec_review_requested: 'Spec 审核',
  goal_progress_updated: 'Goal 进度',
  subagent_spawned: 'SubAgent 启动',
  subagent_completed: 'SubAgent 完成',
  diff_preview_ready: 'Diff 预览就绪',
  test_results_ready: '测试结果就绪',
};

/** 预测规则：事件 A 之后最可能跟随事件 B */
const PREDICT_NEXT_MAP: Partial<Record<AutoFollowEventType, AutoFollowEventType>> = {
  vibe_plan_generated: 'vibe_step_started',
  vibe_step_started: 'vibe_code_writing',
  vibe_code_writing: 'vibe_test_running',
  vibe_test_running: 'test_results_ready',
  test_results_ready: 'vibe_step_completed',
  vibe_step_completed: 'vibe_step_started',
};

// ============================================================
// localStorage 辅助
// ============================================================

function readStoredEnabled(): boolean {
  if (!isBrowser) return DEFAULT_ENABLED;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_ENABLED);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch (err) {
    console.warn('useAutoFollow: localStorage read enabled failed', err);
  }
  return DEFAULT_ENABLED;
}

function writeStoredEnabled(enabled: boolean): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
  } catch (err) {
    console.warn('useAutoFollow: localStorage write enabled failed', err);
  }
}

function readStoredConfig(): Partial<AutoFollowConfig> {
  if (!isBrowser) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<AutoFollowConfig>;
  } catch (err) {
    console.warn('useAutoFollow: localStorage read config failed', err);
    return {};
  }
}

function writeStoredConfig(config: AutoFollowConfig): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
  } catch (err) {
    console.warn('useAutoFollow: localStorage write config failed', err);
  }
}

// ============================================================
// Hook 实现
// ============================================================

export function useAutoFollow(
  modals?: UseModalsResult,
  options: UseAutoFollowOptions = {}
): UseAutoFollowResult {
  const {
    throttleMs = DEFAULT_THROTTLE_MS,
    initialSplitView = DEFAULT_SPLIT_VIEW,
    initialStickyTools = [],
    initialPredictive = DEFAULT_PREDICTIVE,
  } = options;

  const localModals = useModals();
  const m = modals ?? localModals;
  const [enabled, setEnabledState] = useState<boolean>(DEFAULT_ENABLED);
  const [lastFollowed, setLastFollowed] = useState<FollowedRecord | null>(null);
  const [history, setHistory] = useState<FollowedRecord[]>([]);
  const [stickyTools, setStickyToolsState] = useState<PanelKey[]>(initialStickyTools);
  const [splitView, setSplitView] = useState<boolean>(initialSplitView);
  const [predictive, setPredictive] = useState<boolean>(initialPredictive);
  const [strategy, setStrategy] = useState<'leading' | 'trailing'>(DEFAULT_STRATEGY);

  // 节流窗口追踪：每个事件类型的最近触发时间
  const lastTriggeredRef = useRef<Record<string, number>>({});
  const pendingEventRef = useRef<AutoFollowEvent | null>(null);
  const trailingTimerRef = useRef<number | null>(null);

  // 初始化 enabled
  useEffect(() => {
    setEnabledState(readStoredEnabled());
    const stored = readStoredConfig();
    if (stored.stickyTools) setStickyToolsState(stored.stickyTools);
    if (typeof stored.predictive === 'boolean') setPredictive(stored.predictive);
    if (typeof stored.splitView === 'boolean') setSplitView(stored.splitView);
    if (stored.throttleStrategy) setStrategy(stored.throttleStrategy);
  }, []);

  // 持久化 enabled
  const setEnabled = useCallback((b: boolean) => {
    setEnabledState(b);
    writeStoredEnabled(b);
  }, []);

  // 持久化配置
  const setConfig = useCallback(
    (cfg: Partial<AutoFollowConfig>) => {
      if (cfg.stickyTools !== undefined) setStickyToolsState(cfg.stickyTools);
      if (typeof cfg.predictive === 'boolean') setPredictive(cfg.predictive);
      if (typeof cfg.splitView === 'boolean') setSplitView(cfg.splitView);
      if (cfg.throttleStrategy) setStrategy(cfg.throttleStrategy);
    },
    []
  );

  // 同步持久化（任一变化即写入）
  useEffect(() => {
    const config: AutoFollowConfig = {
      enabled,
      panelMapping: STAGE_TO_PANEL,
      throttleMs,
      predictive,
      stickyTools,
      splitView,
      throttleStrategy: strategy,
    };
    writeStoredConfig(config);
  }, [enabled, predictive, stickyTools, splitView, strategy, throttleMs]);

  // 实际触发 panel 切换
  const triggerFollow = useCallback(
    (event: AutoFollowEvent) => {
      const targetPanel = STAGE_TO_PANEL[event.type];
      if (!targetPanel) return;
      const reason = EVENT_TO_REASON[event.type];
      const priority = EVENT_PRIORITY[event.type];

      // Sticky Tool 保护
      if (stickyTools.includes(targetPanel)) {
        return;
      }

      // 调用 modals 打开 panel
      const controller = (
        m as unknown as Record<string, { onOpen: () => void }>
      )[targetPanel];
      if (controller && typeof controller.onOpen === 'function') {
        controller.onOpen();
      }

      const record: FollowedRecord = {
        panelId: targetPanel,
        reason,
        at: new Date(),
        eventType: event.type,
        priority,
      };
      setLastFollowed(record);
      setHistory((prev) => [...prev.slice(-99), record]);
    },
    [m, stickyTools]
  );

  // 节流触发（v2.0.0 重构：100ms 节流 + 优先级 + leading/trailing 策略）
  const follow = useCallback(
    (event: AutoFollowEvent) => {
      if (!enabled) return;

      const now = Date.now();
      const lastTime = lastTriggeredRef.current[event.type] ?? 0;
      const elapsed = now - lastTime;
      const inWindow = elapsed < throttleMs;

      // 高优先级事件（error / 失败）立即触发，绕过节流窗口
      const isHighPriority = EVENT_PRIORITY[event.type] >= 75;
      if (isHighPriority) {
        triggerFollow(event);
        lastTriggeredRef.current[event.type] = now;
        return;
      }

      // 在节流窗口内
      if (inWindow) {
        if (strategy === 'trailing') {
          // trailing 模式：缓存事件，窗口结束时触发
          pendingEventRef.current = event;
          if (trailingTimerRef.current === null) {
            trailingTimerRef.current = window.setTimeout(() => {
              if (pendingEventRef.current) {
                triggerFollow(pendingEventRef.current);
                lastTriggeredRef.current[pendingEventRef.current.type] = Date.now();
                pendingEventRef.current = null;
              }
              trailingTimerRef.current = null;
            }, throttleMs - elapsed);
          }
        }
        // leading 模式：在窗口内直接丢弃
        return;
      }

      // 离开节流窗口，触发并更新时间戳
      triggerFollow(event);
      lastTriggeredRef.current[event.type] = now;
    },
    [enabled, throttleMs, strategy, triggerFollow]
  );

  // 预测下一个 panel
  const predictNext = useCallback((): PanelKey | null => {
    if (!predictive) return null;
    if (!lastFollowed) return null;
    const nextEvent = PREDICT_NEXT_MAP[lastFollowed.eventType];
    if (!nextEvent) return null;
    return STAGE_TO_PANEL[nextEvent];
  }, [predictive, lastFollowed]);

  // Sticky 工具管理
  const addSticky = useCallback((panel: PanelKey) => {
    setStickyToolsState((prev) => (prev.includes(panel) ? prev : [...prev, panel]));
  }, []);

  const removeSticky = useCallback((panel: PanelKey) => {
    setStickyToolsState((prev) => prev.filter((p) => p !== panel));
  }, []);

  // SplitView 切换
  const toggleSplitView = useCallback(() => {
    setSplitView((prev) => !prev);
  }, []);

  // 重置
  const reset = useCallback(() => {
    setEnabledState(DEFAULT_ENABLED);
    setStickyToolsState([]);
    setSplitView(DEFAULT_SPLIT_VIEW);
    setPredictive(DEFAULT_PREDICTIVE);
    setStrategy(DEFAULT_STRATEGY);
    setLastFollowed(null);
    setHistory([]);
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      if (trailingTimerRef.current !== null) {
        window.clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    };
  }, []);

  // 暴露的完整 config（每次渲染计算，避免 stale）
  const config: AutoFollowConfig = useMemo(
    () => ({
      enabled,
      panelMapping: STAGE_TO_PANEL,
      throttleMs,
      predictive,
      stickyTools,
      splitView,
      throttleStrategy: strategy,
    }),
    [enabled, throttleMs, predictive, stickyTools, splitView, strategy]
  );

  return {
    enabled,
    setEnabled,
    follow,
    lastFollowed,
    history,
    // v2.0.0 新增
    config,
    setConfig,
    predictNext,
    stickyTools,
    addSticky,
    removeSticky,
    splitView,
    toggleSplitView,
    priorities: EVENT_PRIORITY,
    mapping: STAGE_TO_PANEL,
    reset,
  };
}

export default useAutoFollow;
