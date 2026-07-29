/**
 * # ============================================================
 * useToast + ToastContainer 单元测试（Cycle 15 P1-7）
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { useToast } from './useToast';
import { ToastContainer } from '../components/ToastContainer';

describe('useToast v6.34.0 (P1-7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('showToast 返回 id 并推入队列', () => {
    const { result } = renderHook(() => useToast());
    let id = '';
    act(() => {
      id = result.current.showToast('操作成功', 'success');
    });
    expect(id).toMatch(/^toast_/);
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('操作成功');
    expect(result.current.toasts[0].type).toBe('success');
  });

  it('兼容旧 API：visible/message/type 反映最后一条 toast', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('first', 'info');
      result.current.showToast('second', 'error');
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.message).toBe('second');
    expect(result.current.type).toBe('error');
  });

  it('showToastWithAction 携带 actionLabel 和 onAction', () => {
    const { result } = renderHook(() => useToast());
    const onAction = vi.fn();
    act(() => {
      result.current.showToastWithAction('已删除', '撤销', onAction, { type: 'warning' });
    });
    expect(result.current.toasts[0].actionLabel).toBe('撤销');
    expect(result.current.toasts[0].onAction).toBe(onAction);
    expect(result.current.toasts[0].type).toBe('warning');
  });

  it('自动消失：duration 到期后移除', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('hello', 'info');
    });
    expect(result.current.toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('dismissToast 立即移除指定 toast', () => {
    const { result } = renderHook(() => useToast());
    let id = '';
    act(() => {
      id = result.current.showToast('hi');
    });
    act(() => {
      result.current.dismissToast(id);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('hideToast 移除最新一条', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('a');
      result.current.showToast('b');
    });
    expect(result.current.toasts).toHaveLength(2);
    act(() => {
      result.current.hideToast();
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('a');
  });

  it('队列上限：超过 3 个时丢弃最早的', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast('1');
      result.current.showToast('2');
      result.current.showToast('3');
      result.current.showToast('4');
    });
    expect(result.current.toasts).toHaveLength(3);
    expect(result.current.toasts[0].message).toBe('2');
    expect(result.current.toasts[2].message).toBe('4');
  });

  it('showToastWithAction 默认 6 秒', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToastWithAction('x', 'undo', () => {});
    });
    expect(result.current.toasts[0].duration).toBe(6000);
  });

  it('showToastWithAction 支持自定义 duration', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToastWithAction('x', 'undo', () => {}, { duration: 1000 });
    });
    expect(result.current.toasts[0].duration).toBe(1000);
  });
});

describe('ToastContainer v6.34.0 (P1-7)', () => {
  it('空队列不渲染', () => {
    const { container } = render(
      <ToastContainer toasts={[]} onDismiss={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('渲染多条 toast', () => {
    const list = [
      { id: 't1', message: 'a', type: 'info' as const, duration: 1000, createdAt: 1 },
      { id: 't2', message: 'b', type: 'success' as const, duration: 1000, createdAt: 2 },
    ];
    render(<ToastContainer toasts={list} onDismiss={() => {}} />);
    const items = screen.getAllByTestId('toast-item');
    expect(items).toHaveLength(2);
  });

  it('点击撤销按钮触发 onAction 并移除', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const list = [
      {
        id: 't1',
        message: '已删除',
        type: 'warning' as const,
        duration: 1000,
        actionLabel: '撤销',
        onAction,
        createdAt: 1,
      },
    ];
    render(<ToastContainer toasts={list} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('toast-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('关闭按钮触发 onDismiss', () => {
    const onDismiss = vi.fn();
    const list = [
      { id: 't1', message: 'a', type: 'info' as const, duration: 1000, createdAt: 1 },
    ];
    render(<ToastContainer toasts={list} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('toast-close'));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('action handler 抛出不应中断 dismiss', () => {
    const onAction = vi.fn(() => { throw new Error('boom'); });
    const onDismiss = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const list = [
      {
        id: 't1',
        message: 'x',
        type: 'error' as const,
        duration: 1000,
        actionLabel: 'retry',
        onAction,
        createdAt: 1,
      },
    ];
    render(<ToastContainer toasts={list} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('toast-action'));
    expect(onAction).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledWith('t1');
    errSpy.mockRestore();
  });
});
