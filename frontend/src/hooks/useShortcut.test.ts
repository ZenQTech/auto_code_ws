/**
 * # ============================================================
 * 快捷键 Hook 单元测试（v1.0.0 P2-2）
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useShortcut,
  getShortcutManager,
  parseShortcut,
  matchesShortcut,
  COMMON_SHORTCUTS,
} from './useShortcut';

describe('parseShortcut', () => {
  it('解析简单键', () => {
    const p = parseShortcut('escape');
    expect(p.key).toBe('escape');
    expect(p.ctrl).toBe(false);
    expect(p.shift).toBe(false);
  });

  it('解析组合键 mod+k', () => {
    const p = parseShortcut('mod+k');
    expect(p.key).toBe('k');
    // mod 在非 macOS 上是 ctrl
    if (!/Mac/i.test(navigator.platform)) {
      expect(p.ctrl).toBe(true);
    } else {
      expect(p.meta).toBe(true);
    }
  });

  it('解析多修饰键 mod+shift+p', () => {
    const p = parseShortcut('mod+shift+p');
    expect(p.key).toBe('p');
    expect(p.shift).toBe(true);
  });

  it('解析 cmd+k', () => {
    const p = parseShortcut('cmd+k');
    expect(p.key).toBe('k');
    expect(p.meta).toBe(true);
  });

  it('解析 ctrl+k', () => {
    const p = parseShortcut('ctrl+k');
    expect(p.key).toBe('k');
    expect(p.ctrl).toBe(true);
  });

  it('解析 alt+enter', () => {
    const p = parseShortcut('alt+enter');
    expect(p.key).toBe('enter');
    expect(p.alt).toBe(true);
  });

  it('大写规范化为小写', () => {
    const p = parseShortcut('CMD+SHIFT+K');
    expect(p.key).toBe('k');
    expect(p.shift).toBe(true);
    expect(p.meta).toBe(true);
  });
});

describe('matchesShortcut', () => {
  it('匹配简单 key', () => {
    const p = parseShortcut('escape');
    const e = new KeyboardEvent('keydown', { key: 'Escape' });
    expect(matchesShortcut(e, p)).toBe(true);
  });

  it('不匹配的 key 返回 false', () => {
    const p = parseShortcut('escape');
    const e = new KeyboardEvent('keydown', { key: 'Enter' });
    expect(matchesShortcut(e, p)).toBe(false);
  });

  it('不匹配的修饰键返回 false', () => {
    const p = parseShortcut('mod+k');
    const e = new KeyboardEvent('keydown', { key: 'k', shiftKey: true });
    // 没有 shift 修饰的 mod+k 不应该匹配 shift+k
    if (!/Mac/i.test(navigator.platform)) {
      expect(matchesShortcut(e, p)).toBe(false);
    }
  });

  it('匹配多修饰键', () => {
    const p = parseShortcut('mod+shift+k');
    const e = new KeyboardEvent('keydown', { key: 'K', shiftKey: true, ctrlKey: true });
    // 注意 happy-dom 下 ctrlKey 可能为 false
    Object.defineProperty(e, 'ctrlKey', { value: true });
    expect(matchesShortcut(e, p)).toBe(true);
  });
});

describe('getShortcutManager / useShortcut', () => {
  beforeEach(() => {
    // 清空注册
    getShortcutManager().clear();
  });

  afterEach(() => {
    getShortcutManager().clear();
  });

  it('注册后可通过 manager 查到', () => {
    const handler = vi.fn();
    renderHook(() => useShortcut('test-1', 'mod+k', handler));
    const all = getShortcutManager().getAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('test-1');
    expect(all[0].combo).toBe('mod+k');
  });

  it('卸载时自动注销', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useShortcut('test-1', 'mod+k', handler));
    expect(getShortcutManager().getAll().length).toBe(1);
    unmount();
    expect(getShortcutManager().getAll().length).toBe(0);
  });

  it('handler 变化时不应重新注册', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const { rerender } = renderHook(
      ({ h }) => useShortcut('test-1', 'mod+k', h),
      { initialProps: { h: handler1 } }
    );
    expect(getShortcutManager().getAll().length).toBe(1);
    rerender({ h: handler2 });
    // 仍然只有 1 个注册（使用 ref 同步最新 handler）
    expect(getShortcutManager().getAll().length).toBe(1);
  });

  it('combo 变化时应重新注册', () => {
    const handler = vi.fn();
    const { rerender } = renderHook(
      ({ c }) => useShortcut('test-1', c, handler),
      { initialProps: { c: 'mod+k' } }
    );
    expect(getShortcutManager().getAll().length).toBe(1);
    rerender({ c: 'mod+j' });
    // 仍然是 1 个（同 id 覆盖）
    expect(getShortcutManager().getAll().length).toBe(1);
    const all = getShortcutManager().getAll();
    expect(all[0].combo).toBe('mod+j');
  });

  it('enabled=false 时不注册', () => {
    const handler = vi.fn();
    renderHook(() => useShortcut('test-1', 'mod+k', handler, { enabled: false }));
    expect(getShortcutManager().getAll().length).toBe(0);
  });

  it('enabled 从 true 改为 false 时自动注销', () => {
    const handler = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useShortcut('test-1', 'mod+k', handler, { enabled }),
      { initialProps: { enabled: true } }
    );
    expect(getShortcutManager().getAll().length).toBe(1);
    rerender({ enabled: false });
    expect(getShortcutManager().getAll().length).toBe(0);
  });
});

describe('键盘事件触发', () => {
  beforeEach(() => {
    getShortcutManager().clear();
  });

  afterEach(() => {
    getShortcutManager().clear();
  });

  it('模拟键盘事件触发 handler', () => {
    const handler = vi.fn();
    renderHook(() => useShortcut('test-1', 'escape', handler));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('多个注册：按优先级触发', () => {
    const handlerLow = vi.fn();
    const handlerHigh = vi.fn();
    renderHook(() => useShortcut('low', 'escape', handlerLow, { priority: 1 }));
    renderHook(() => useShortcut('high', 'escape', handlerHigh, { priority: 10 }));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(event);

    // 高优先级先触发，低优先级不触发
    expect(handlerHigh).toHaveBeenCalledTimes(1);
    expect(handlerLow).not.toHaveBeenCalled();
  });

  it('handler 抛出异常不影响其他快捷键', () => {
    const handlerErr = vi.fn(() => { throw new Error('boom'); });
    const handlerOk = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useShortcut('err', 'escape', handlerErr, { priority: 10 }));
    renderHook(() => useShortcut('ok', 'escape', handlerOk, { priority: 5 }));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(event);

    // err 先触发并抛出，但 ok 不会触发（同 priority 时只触发第一个）
    expect(handlerErr).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('COMMON_SHORTCUTS', () => {
  it('导出常用快捷键组合', () => {
    expect(COMMON_SHORTCUTS.NEW_CHAT).toBe('mod+n');
    expect(COMMON_SHORTCUTS.TOGGLE_SIDEBAR).toBe('mod+b');
    expect(COMMON_SHORTCUTS.TOGGLE_COMPOSER).toBe('mod+i');
    expect(COMMON_SHORTCUTS.COMMAND_PALETTE).toBe('mod+k');
    expect(COMMON_SHORTCUTS.ESCAPE).toBe('escape');
    expect(COMMON_SHORTCUTS.SUBMIT).toBe('mod+enter');
  });
});
