/**
 * # ============================================================
 * useMode Hook 单元测试 (v6.37.0 Cycle 17 P0-2)
 * # ============================================================
 * 测试覆盖：12 个测试
 *   - 基础状态管理 (3)
 *   - setMode / cycle (3)
 *   - 持久化 (2)
 *   - 快捷键 (4)
 * ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMode, type HermesMode } from './useMode';

describe('useMode - 基础状态管理', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初始默认值为 chat', () => {
    const { result } = renderHook(() => useMode());
    expect(result.current.mode).toBe('chat');
  });

  it('暴露 shortcutHints 包含三种模式', () => {
    const { result } = renderHook(() => useMode());
    expect(result.current.shortcutHints.chat).toBe('⌘L');
    expect(result.current.shortcutHints.composer).toBe('⌘I');
    expect(result.current.shortcutHints.agent).toBe('⌘⇧A');
  });

  it('从 localStorage 读取初始值', () => {
    localStorage.setItem('hermes.mode', 'composer');
    const { result } = renderHook(() => useMode());
    expect(result.current.mode).toBe('composer');
  });
});

describe('useMode - setMode / cycle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('setMode 更新模式', () => {
    const { result } = renderHook(() => useMode());
    act(() => {
      result.current.setMode('composer');
    });
    expect(result.current.mode).toBe('composer');
  });

  it('cycle 切换：chat → composer → agent → chat', () => {
    const { result } = renderHook(() => useMode());
    expect(result.current.mode).toBe('chat');

    act(() => {
      result.current.cycle();
    });
    expect(result.current.mode).toBe('composer');

    act(() => {
      result.current.cycle();
    });
    expect(result.current.mode).toBe('agent');

    act(() => {
      result.current.cycle();
    });
    expect(result.current.mode).toBe('chat');
  });

  it('setMode 接受所有三种模式', () => {
    const { result } = renderHook(() => useMode());
    const modes: HermesMode[] = ['chat', 'composer', 'agent'];
    modes.forEach((m) => {
      act(() => {
        result.current.setMode(m);
      });
      expect(result.current.mode).toBe(m);
    });
  });
});

describe('useMode - 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('模式变化写入 localStorage', () => {
    const { result } = renderHook(() => useMode());
    act(() => {
      result.current.setMode('agent');
    });
    expect(localStorage.getItem('hermes.mode')).toBe('agent');
  });

  it('异常 localStorage 不影响 mode', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { result } = renderHook(() => useMode());
    act(() => {
      result.current.setMode('composer');
    });
    expect(result.current.mode).toBe('composer');

    setItemSpy.mockRestore();
  });
});

describe('useMode - 快捷键', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Cmd+L 切换到 chat', () => {
    const { result } = renderHook(() => useMode());
    act(() => {
      result.current.setMode('composer');
    });

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'l',
        metaKey: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.mode).toBe('chat');
  });

  it('Cmd+I 切换到 composer', () => {
    const { result } = renderHook(() => useMode());

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'i',
        metaKey: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.mode).toBe('composer');
  });

  it('Cmd+Shift+A 切换到 agent', () => {
    const { result } = renderHook(() => useMode());

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'A',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.mode).toBe('agent');
  });

  it('输入框中除 Cmd+I 外其他快捷键不触发', () => {
    const { result } = renderHook(() => useMode());
    act(() => {
      result.current.setMode('agent');
    });

    // 创建 input 元素
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'l',
        metaKey: true,
        bubbles: true,
      });
      // 模拟在 input 中触发
      Object.defineProperty(event, 'target', { value: input });
      window.dispatchEvent(event);
    });

    // mode 应该保持 'agent'，没被切换
    expect(result.current.mode).toBe('agent');

    document.body.removeChild(input);
  });
});
