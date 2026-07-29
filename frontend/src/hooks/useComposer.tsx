/**
 * # ============================================================
 * useComposer Hook (v6.36.0 Cycle 16 P0-1 / v1.1.0 P1-5 升级)
 * # ============================================================
 * 核心作用：React Hook 包装 ComposerEngine
 * 使用场景：ComposerPanel 等 UI 组件订阅 session 变化
 * 设计说明：
 *   - 接受可选的 engine 参数（用于测试或外部共享实例）
 *   - 默认每个组件独立 engine（生产场景下也推荐共享一个）
 *   - UI 状态（isOpen / isFullscreen）已下沉到 engine（v1.1.0）
 *     解决多组件调用 hook 时状态不同步问题
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | Cycle 16 P0-1 初次创建
 *   - 2026-07-29 | v1.1.0 | P1-5 UI 状态下沉到引擎
 *     - isOpen / isFullscreen 改为从 engine 订阅
 *     - open / close / toggle / setFullscreen 直接调用 engine
 *     - Cmd/Ctrl+I 快捷键在输入框也可用
 *     - 解决 Harness 与 ComposerPanel 状态不同步
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
}

export function useComposer(): UseComposerResult {
  const contextEngine = useContext(ComposerContext);
  const localRef = useRef<ComposerEngine | null>(null);
  if (localRef.current === null && !contextEngine) {
    localRef.current = createComposerEngine();
  }
  const engine = contextEngine ?? localRef.current!;

  const [session, setSession] = useState<ComposerSession>(engine.getSession());
  const [ui, setUI] = useState<ComposerUIState>(engine.getUIState());

  useEffect(() => {
    const unsub = engine.subscribe(setSession);
    const unsubUI = engine.subscribeUI(setUI);
    return () => {
      unsub();
      unsubUI();
    };
  }, [engine]);

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
  };
}

export default useComposer;
