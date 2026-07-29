/**
 * # ============================================================
 * useMode Hook (v6.37.0 Cycle 17 P0-2)
 * # ============================================================
 * 核心作用：管理 Hermes 应用模式（chat / composer / agent）
 * 运行流程：
 *   1. 初始从 localStorage 读取模式（hermes.mode），默认 'chat'
 *   2. 模式变化时持久化到 localStorage
 *   3. 监听全局快捷键：Cmd+L (chat) / Cmd+I (composer) / Cmd+Shift+A (agent)
 *   4. 提供 cycle() 方法在三模式间循环
 * 设计要点：
 *   - 单例模式（localStorage 全局共享）
 *   - 输入框中不触发（避免误触）
 *   - 卸载时清理事件监听
 * 输入参数：无
 * 输出结果：{ mode, setMode, cycle, shortcutHints }
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 17 P0-2 初次创建
 * ============================================================
 */

import { useCallback, useEffect, useState } from 'react';

export type HermesMode = 'chat' | 'composer' | 'agent';

const STORAGE_KEY = 'hermes.mode';
const DEFAULT_MODE: HermesMode = 'chat';

/** 模式快捷键映射 */
const SHORTCUT_HINTS: Record<HermesMode, string> = {
  chat: '⌘L',
  composer: '⌘I',
  agent: '⌘⇧A',
};

/** SSR / 测试安全：检查 window */
const isBrowser = typeof window !== 'undefined';

/** 安全读取 localStorage */
function readStoredMode(): HermesMode {
  if (!isBrowser) return DEFAULT_MODE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'chat' || stored === 'composer' || stored === 'agent') {
      return stored;
    }
  } catch (err) {
    console.warn('useMode: localStorage read failed', err);
  }
  return DEFAULT_MODE;
}

/** 安全写入 localStorage */
function writeStoredMode(mode: HermesMode): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch (err) {
    console.warn('useMode: localStorage write failed', err);
  }
}

export interface UseModeResult {
  /** 当前模式 */
  mode: HermesMode;
  /** 设置模式 */
  setMode: (mode: HermesMode) => void;
  /** 循环切换：chat → composer → agent → chat */
  cycle: () => void;
  /** 快捷键提示 */
  shortcutHints: Record<HermesMode, string>;
}

const MODE_CYCLE: HermesMode[] = ['chat', 'composer', 'agent'];

/**
 * useMode Hook
 */
export function useMode(): UseModeResult {
  const [mode, setModeState] = useState<HermesMode>(DEFAULT_MODE);

  // 初始化：从 localStorage 读取
  useEffect(() => {
    const stored = readStoredMode();
    setModeState(stored);
  }, []);

  // 持久化到 localStorage
  useEffect(() => {
    writeStoredMode(mode);
  }, [mode]);

  // 全局快捷键
  useEffect(() => {
    if (!isBrowser) return;

    const handler = (e: KeyboardEvent) => {
      // 在输入框 / textarea / contentEditable 中不触发
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          // 例外：仍然允许 Cmd+I (产品需求)
          if (!(e.metaKey || e.ctrlKey) || e.key !== 'i' || e.shiftKey || e.altKey) {
            return;
          }
        }
      }

      const cmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!cmdOrCtrl) return;

      // Cmd+L → chat
      if (e.key === 'l' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setModeState('chat');
        return;
      }

      // Cmd+I → composer
      if (e.key === 'i' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setModeState('composer');
        return;
      }

      // Cmd+Shift+A → agent
      if (e.key === 'A' && e.shiftKey && !e.altKey) {
        e.preventDefault();
        setModeState('agent');
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const setMode = useCallback((next: HermesMode) => {
    setModeState(next);
  }, []);

  const cycle = useCallback(() => {
    setModeState((current) => {
      const idx = MODE_CYCLE.indexOf(current);
      return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    });
  }, []);

  return {
    mode,
    setMode,
    cycle,
    shortcutHints: SHORTCUT_HINTS,
  };
}

export default useMode;
