/**
 * GlobalErrorToast 组件测试 (v6.40.0 Cycle 18 P0-3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GlobalErrorToast from './GlobalErrorToast';
import { globalErrorHandler, reportError } from '../utils/globalErrorHandler';

// Mock import.meta.env for isDev
vi.stubEnv('DEV', true);

describe('GlobalErrorToast', () => {
  beforeEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    // 重新安装监听器，确保 window.onerror 可用
    globalErrorHandler.install({ logToConsole: false });
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    vi.useRealTimers();
  });

  it('无错误时不渲染', () => {
    const { container } = render(<GlobalErrorToast />);
    expect(container.querySelector('[data-testid="global-error-toast"]')).toBeNull();
  });

  it('错误出现时渲染 Toast', () => {
    render(<GlobalErrorToast />);
    act(() => {
      reportError('test error message', 'manual_report');
    });
    expect(screen.getByTestId('global-error-toast')).toBeTruthy();
    expect(screen.getByText('test error message')).toBeTruthy();
  });

  it('显示错误类型标签', () => {
    render(<GlobalErrorToast />);
    act(() => {
      reportError('js error', 'js_error');
    });
    expect(screen.getByText('运行错误')).toBeTruthy();
  });

  it('显示 source 和 line 信息', () => {
    render(<GlobalErrorToast />);
    act(() => {
      window.onerror?.('js error', 'test.js', 42, 5, new Error('js error'));
    });
    expect(screen.getByText(/test\.js/)).toBeTruthy();
    expect(screen.getByText(/:42/)).toBeTruthy();
  });

  it('点击"忽略"关闭 Toast', () => {
    render(<GlobalErrorToast />);
    act(() => {
      reportError('test error');
    });
    expect(screen.getByTestId('global-error-toast')).toBeTruthy();
    fireEvent.click(screen.getByTestId('global-error-dismiss'));
    expect(screen.queryByTestId('global-error-toast')).toBeNull();
  });

  it('点击"清空"关闭并清空历史', () => {
    render(<GlobalErrorToast />);
    act(() => {
      reportError('e1');
      reportError('e2');
    });
    expect(globalErrorHandler.getReports().length).toBe(2);
    fireEvent.click(screen.getByTestId('global-error-clear'));
    expect(globalErrorHandler.getReports().length).toBe(0);
    expect(screen.queryByTestId('global-error-toast')).toBeNull();
  });

  it('dev 模式显示"详情"按钮并可展开堆栈', () => {
    render(<GlobalErrorToast />);
    act(() => {
      const err = new Error('e1');
      err.stack = 'Error: e1\n  at test.tsx:10';
      reportError(err, 'js_error');
    });
    const detailBtn = screen.getByTestId('global-error-detail-toggle');
    expect(detailBtn).toBeTruthy();
    expect(screen.queryByTestId('global-error-stack')).toBeNull();
    fireEvent.click(detailBtn);
    expect(screen.getByTestId('global-error-stack')).toBeTruthy();
    expect(screen.getByText(/at test\.tsx:10/)).toBeTruthy();
  });

  it('autoHideMs 过期后自动关闭', () => {
    render(<GlobalErrorToast autoHideMs={5000} />);
    act(() => {
      reportError('auto hide test');
    });
    expect(screen.getByTestId('global-error-toast')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId('global-error-toast')).toBeNull();
  });

  it('autoHideMs=0 不自动关闭', () => {
    render(<GlobalErrorToast autoHideMs={0} />);
    act(() => {
      reportError('manual close only');
    });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByTestId('global-error-toast')).toBeTruthy();
  });

  it('不同类型显示不同图标', () => {
    const { rerender } = render(<GlobalErrorToast />);
    act(() => {
      reportError('e1', 'js_error');
    });
    expect(screen.getByText('⚠️')).toBeTruthy();
    act(() => {
      globalErrorHandler.clearReports();
    });
    rerender(<GlobalErrorToast />);
    act(() => {
      reportError('e2', 'fetch_error');
    });
    expect(screen.getByText('🌐')).toBeTruthy();
  });

  it('错误类型标签映射正确', () => {
    const types: Array<[any, string]> = [
      ['promise_rejection', '未处理异常'],
      ['resource_error', '资源加载失败'],
      ['fetch_error', '网络请求失败'],
      ['manual_report', '操作提示'],
    ];

    types.forEach(([type, label]) => {
      const { unmount } = render(<GlobalErrorToast />);
      act(() => {
        reportError(`err-${type}`, type);
      });
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
      globalErrorHandler.clearReports();
    });
  });

  it('错误切换时重置详情展开状态', () => {
    render(<GlobalErrorToast />);
    // 第一个错误：展开详情
    act(() => {
      const err1 = new Error('e1');
      err1.stack = 'Error: e1';
      reportError(err1, 'js_error');
    });
    fireEvent.click(screen.getByTestId('global-error-detail-toggle'));
    expect(screen.getByTestId('global-error-stack')).toBeTruthy();
    // 切换到第二个错误
    act(() => {
      globalErrorHandler.clearReports();
      const err2 = new Error('e2');
      err2.stack = 'Error: e2';
      reportError(err2, 'js_error');
    });
    // 详情应自动收起
    expect(screen.queryByTestId('global-error-stack')).toBeNull();
  });

  it('role="alert" 和 aria-live="assertive" 用于无障碍', () => {
    render(<GlobalErrorToast />);
    act(() => {
      reportError('a11y test');
    });
    const toast = screen.getByTestId('global-error-toast');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
  });

  it('展示时间戳', () => {
    render(<GlobalErrorToast />);
    act(() => {
      reportError('timestamp test');
    });
    // 时间格式 HH:MM:SS
    const timeText = screen.getByText(/\d{1,2}:\d{2}:\d{2}/);
    expect(timeText).toBeTruthy();
  });
});
