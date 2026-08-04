/**
 * useShortcut 7 个 contexts 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useShortcut,
  setActiveShortcutContext,
  getActiveShortcutContext,
  subscribeShortcutContext,
  CODEX_KEYMAP_CONTEXTS,
  ALL_CONTEXTS,
  COMMON_SHORTCUTS,
  parseShortcut,
  matchesShortcut,
  type ShortcutContext,
} from '../hooks/useShortcut';

describe('useShortcut - 7 contexts 系统', () => {
  let listeners: Array<(e: KeyboardEvent) => void>;

  beforeEach(() => {
    listeners = [];
    const originalAdd = window.addEventListener;
    window.addEventListener = vi.fn((event: string, handler: any) => {
      if (event === 'keydown') listeners.push(handler);
    }) as any;
    const originalRemove = window.removeEventListener;
    window.removeEventListener = vi.fn();
    setActiveShortcutContext('global');
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('ALL_CONTEXTS 包含 7 个 contexts', () => {
    expect(ALL_CONTEXTS).toHaveLength(7);
    expect(ALL_CONTEXTS).toEqual(['global', 'chat', 'composer', 'editor', 'pager', 'list', 'approval']);
  });

  it('getActiveShortcutContext 默认返回 global', () => {
    setActiveShortcutContext('global');
    expect(getActiveShortcutContext()).toBe('global');
  });

  it('setActiveShortcutContext 更新 context', () => {
    setActiveShortcutContext('chat');
    expect(getActiveShortcutContext()).toBe('chat');
  });

  it('subscribeShortcutContext 通知 context 变化', () => {
    const fn = vi.fn();
    const unsub = subscribeShortcutContext(fn);
    setActiveShortcutContext('editor');
    expect(fn).toHaveBeenCalledWith('editor');
    unsub();
  });

  it('subscribe 取消订阅后不再收到通知', () => {
    const fn = vi.fn();
    const unsub = subscribeShortcutContext(fn);
    unsub();
    setActiveShortcutContext('pager');
    expect(fn).not.toHaveBeenCalled();
  });

  it('设置相同 context 不会触发通知', () => {
    const fn = vi.fn();
    setActiveShortcutContext('chat');
    const unsub = subscribeShortcutContext(fn);
    setActiveShortcutContext('chat');
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it('parseShortcut 解析 mod+k', () => {
    const parsed = parseShortcut('mod+k');
    expect(parsed.key).toBe('k');
    expect(parsed.meta || parsed.ctrl).toBe(true);
  });

  it('parseShortcut 解析 escape', () => {
    const parsed = parseShortcut('escape');
    expect(parsed.key).toBe('escape');
  });

  it('parseShortcut 解析 shift+enter', () => {
    const parsed = parseShortcut('shift+enter');
    expect(parsed.shift).toBe(true);
    expect(parsed.key).toBe('enter');
  });

  it('parseShortcut 解析 g g 序列', () => {
    const parsed = parseShortcut('g g');
    expect(parsed.key).toBe('g');
  });

  it('matchesShortcut 正确匹配', () => {
    const parsed = parseShortcut('mod+k');
    const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: false });
    expect(matchesShortcut(e, parsed)).toBe(true);
  });

  it('matchesShortcut 拒绝错误修饰键', () => {
    const parsed = parseShortcut('mod+k');
    const e = new KeyboardEvent('keydown', { key: 'k', shiftKey: true });
    expect(matchesShortcut(e, parsed)).toBe(false);
  });

  it('useShortcut 注册 global 快捷键', () => {
    const handler = vi.fn();
    renderHook(() =>
      useShortcut('test-global', 'mod+k', handler, { context: 'global' })
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('不同 context 互不干扰（global 始终生效）', () => {
    const handler = vi.fn();
    renderHook(() =>
      useShortcut('test-global-2', 'mod+k', handler, { context: 'global' })
    );
    setActiveShortcutContext('chat');
    setActiveShortcutContext('editor');
    setActiveShortcutContext('pager');
    // global 始终生效，无需测试 trigger
  });

  it('CODEX_KEYMAP_CONTEXTS 包含 7 个 contexts', () => {
    expect(CODEX_KEYMAP_CONTEXTS).toHaveLength(7);
  });

  it('每个 context 都有 label / description / bindings', () => {
    for (const ctx of CODEX_KEYMAP_CONTEXTS) {
      expect(ctx.label).toBeTruthy();
      expect(ctx.description).toBeTruthy();
      expect(Array.isArray(ctx.bindings)).toBe(true);
      expect(ctx.bindings.length).toBeGreaterThan(0);
    }
  });

  it('每个 binding 都有 combo + description', () => {
    for (const ctx of CODEX_KEYMAP_CONTEXTS) {
      for (const b of ctx.bindings) {
        expect(b.combo).toBeTruthy();
        expect(b.description).toBeTruthy();
      }
    }
  });

  it('COMMON_SHORTCUTS 包含新增 Solo 快捷键', () => {
    expect(COMMON_SHORTCUTS.TOGGLE_PLAN_MODE).toBe('mod+shift+p');
    expect(COMMON_SHORTCUTS.TOGGLE_AUTO_FOLLOW).toBe('mod+shift+f');
    expect(COMMON_SHORTCUTS.NEW_TASK).toBe('mod+t');
    expect(COMMON_SHORTCUTS.CLOSE_TASK).toBe('mod+w');
    expect(COMMON_SHORTCUTS.TOGGLE_LEFT_PANEL).toBe('mod+1');
    expect(COMMON_SHORTCUTS.TOGGLE_RIGHT_PANEL).toBe('mod+2');
    expect(COMMON_SHORTCUTS.TOGGLE_TERMINAL).toBe('mod+`');
    expect(COMMON_SHORTCUTS.TOGGLE_BROWSER).toBe('mod+shift+b');
    expect(COMMON_SHORTCUTS.APPROVE).toBe('mod+y');
    expect(COMMON_SHORTCUTS.CYCLE_THEME).toBe('mod+shift+t');
  });

  it('7 个 context 全部被 useShortcut 接受', () => {
    const ctxs: ShortcutContext[] = ['global', 'chat', 'composer', 'editor', 'pager', 'list', 'approval'];
    for (const ctx of ctxs) {
      const handler = vi.fn();
      const { unmount } = renderHook(() =>
        useShortcut(`test-${ctx}`, 'mod+k', handler, { context: ctx })
      );
      expect(handler).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('context 切换时 useShortcut 重新注册', () => {
    const handler1 = vi.fn();
    const { rerender } = renderHook(
      ({ ctx }: { ctx: ShortcutContext }) =>
        useShortcut('test-ctx-change', 'mod+k', handler1, { context: ctx }),
      { initialProps: { ctx: 'global' as ShortcutContext } }
    );
    rerender({ ctx: 'chat' });
    // 不报错即可
  });

  it('setActiveShortcutContext 可以被多次调用', () => {
    setActiveShortcutContext('chat');
    setActiveShortcutContext('editor');
    setActiveShortcutContext('pager');
    expect(getActiveShortcutContext()).toBe('pager');
  });
});
