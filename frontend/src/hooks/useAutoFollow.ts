/**
 * # ============================================================
 * useAutoFollow - Auto-Follow 联动控制 Hook (v1.0.0)
 * Cycle 58 G58-04
 * # ============================================================
 * 核心作用：监听 SSE 事件，根据阶段自动 open/聚焦 panel（对标 TRAE 实时跟随模式）
 * 运行流程：
 *   1. 订阅 SSE 事件（vibe_step_started / plan_generated / code_writing / test_running）
 *   2. 根据 STAGE_TO_PANEL 映射找到目标 panel
 *   3. 调用 modals.openPanel(target_panel)
 *   4. 调用对应 panel 内部 scrollToBottom()
 *   5. AI 处理时 panel 只读（readOnly 属性）
 *   6. 用户可关闭 Auto-Follow
 * 设计要点：
 *   - 防抖 500ms 避免频繁切换
 *   - 可关闭开关
 *   - 不影响 chat/coding 模式
 * 输入参数：{ modals: UseModalsResult }
 * 输出结果：{ enabled, setEnabled, follow, lastFollowed }
 * ============================================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
 * ============================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useModals, type UseModalsResult, type PanelKey } from './useModals';

// ============================================================
// 类型定义
// ====================================

/** 触发 Auto-Follow 的事件类型 */
/** v1.1.0 G60-4.1 扩展：从 9 个扩展到 15 个事件类型 */
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
  // v1.1.0 G60-4.1 新增
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
}

/** Hook 返回值 */
export interface UseAutoFollowResult {
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  follow: (event: AutoFollowEvent) => void;
  lastFollowed: FollowedRecord | null;
  /** 已 follow 过的 panel 列表（用于调试） */
  history: FollowedRecord[];
}

// ============================================================
// 常量
// ====================================

const STORAGE_KEY = 'hermes.autoFollow.enabled';
const DEFAULT_ENABLED = true;
const DEBOUNCE_MS = 500;
const isBrowser = typeof window !== 'undefined';

/** 阶段到 panel 的映射（v1.1.0 扩展 6 个新事件） */
const STAGE_TO_PANEL: Record<AutoFollowEventType, PanelKey | null> = {
  // v1.0.0 既有
  vibe_step_started: 'planExecutor',
  vibe_plan_generated: 'planExecutor',
  vibe_code_writing: 'vibeCoding',
  vibe_test_running: 'vibeCoding',
  vibe_step_completed: 'planExecutor',
  vibe_step_failed: 'planExecutor',
  vibe_plan_completed: 'vibeCoding',
  loop_state_changed: 'loopState',
  claude_shell_output: 'vibeCoding',
  // v1.1.0 G60-4.1 新增（使用现有 PanelKey）
  spec_review_requested: 'loopState',
  goal_progress_updated: 'loopV7',
  subagent_spawned: 'multiAgentTree',
  subagent_completed: 'multiAgentTree',
  diff_preview_ready: 'planEditor',
  test_results_ready: 'planExecutor',
};

/** 事件类型到 reason 文案（v1.1.0 扩展） */
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
  // v1.1.0 G60-4.1 新增
  spec_review_requested: 'Spec 审核',
  goal_progress_updated: 'Goal 进度',
  subagent_spawned: 'SubAgent 启动',
  subagent_completed: 'SubAgent 完成',
  diff_preview_ready: 'Diff 预览就绪',
  test_results_ready: '测试结果就绪',
};

// ============================================================
// localStorage 辅助
// ====================================

function readStoredEnabled(): boolean {
  if (!isBrowser) return DEFAULT_ENABLED;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch (err) {
    console.warn('useAutoFollow: localStorage read failed', err);
  }
  return DEFAULT_ENABLED;
}

function writeStoredEnabled(enabled: boolean): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch (err) {
    console.warn('useAutoFollow: localStorage write failed', err);
  }
}

// ============================================================
// Hook 实现
// ====================================

export function useAutoFollow(modals?: UseModalsResult): UseAutoFollowResult {
  const localModals = useModals();
  const m = modals ?? localModals;
  const [enabled, setEnabledState] = useState<boolean>(DEFAULT_ENABLED);
  const [lastFollowed, setLastFollowed] = useState<FollowedRecord | null>(null);
  const [history, setHistory] = useState<FollowedRecord[]>([]);
  const debounceTimerRef = useRef<number | null>(null);
  const pendingEventRef = useRef<AutoFollowEvent | null>(null);

  // 初始化 enabled 状态
  useEffect(() => {
    setEnabledState(readStoredEnabled());
  }, []);

  // 持久化
  const setEnabled = useCallback((b: boolean) => {
    setEnabledState(b);
    writeStoredEnabled(b);
  }, []);

  // 实际触发 panel 切换
  const triggerFollow = useCallback(
    (event: AutoFollowEvent) => {
      const targetPanel = STAGE_TO_PANEL[event.type];
      if (!targetPanel) return;
      const reason = EVENT_TO_REASON[event.type];

      // 调用 modals 打开 panel
      const controller = (m as unknown as Record<string, { onOpen: () => void }>)[targetPanel];
      if (controller && typeof controller.onOpen === 'function') {
        controller.onOpen();
      }

      const record: FollowedRecord = {
        panelId: targetPanel,
        reason,
        at: new Date(),
      };
      setLastFollowed(record);
      setHistory((prev) => [...prev.slice(-49), record]);
    },
    [m]
  );

  // 暴露给用户的 follow 方法（带防抖）
  const follow = useCallback(
    (event: AutoFollowEvent) => {
      if (!enabled) return;
      pendingEventRef.current = event;
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        if (pendingEventRef.current) {
          triggerFollow(pendingEventRef.current);
          pendingEventRef.current = null;
        }
        debounceTimerRef.current = null;
      }, DEBOUNCE_MS);
    },
    [enabled, triggerFollow]
  );

  // 清理
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  return {
    enabled,
    setEnabled,
    follow,
    lastFollowed,
    history,
  };
}

export default useAutoFollow;
