/**
 * useGlobalError Hook 单元测试 (v6.40.0 Cycle 18 P0-3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlobalError } from './useGlobalError';
import { globalErrorHandler, reportError } from '../utils/globalErrorHandler';

describe('useGlobalError', () => {
  beforeEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    globalErrorHandler.unsubscribeAll();
  });

  afterEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    globalErrorHandler.unsubscribeAll();
  });

  describe('初始状态', () => {
    it('currentError 初始为 null', () => {
      const { result } = renderHook(() => useGlobalError());
      expect(result.current.currentError).toBe(null);
    });

    it('errorHistory 初始为空数组', () => {
      const { result } = renderHook(() => useGlobalError());
      expect(result.current.errorHistory).toEqual([]);
    });

    it('totalCount 初始为 0', () => {
      const { result } = renderHook(() => useGlobalError());
      expect(result.current.totalCount).toBe(0);
    });

    it('hasUnread 初始为 false', () => {
      const { result } = renderHook(() => useGlobalError());
      expect(result.current.hasUnread).toBe(false);
    });
  });

  describe('报告更新', () => {
    it('reportError 后 currentError 更新', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('test error', 'manual_report');
      });
      expect(result.current.currentError).not.toBeNull();
      expect(result.current.currentError?.message).toBe('test error');
    });

    it('reportError 后 totalCount 增加', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('e1');
        result.current.reportError('e2');
        result.current.reportError('e3');
      });
      expect(result.current.totalCount).toBe(3);
    });

    it('reportError 后 hasUnread 为 true', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('e1');
      });
      expect(result.current.hasUnread).toBe(true);
    });

    it('currentError 显示最新的未确认错误', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('first');
        result.current.reportError('second');
      });
      expect(result.current.currentError?.message).toBe('second');
    });
  });

  describe('dismissError', () => {
    it('dismissError 标记当前错误为已读', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('e1');
      });
      const errId = result.current.currentError!.id;
      act(() => {
        result.current.dismissError();
      });
      expect(result.current.hasUnread).toBe(false);
      // 历史仍在
      expect(result.current.totalCount).toBe(1);
      expect(result.current.errorHistory[0].id).toBe(errId);
    });

    it('dismissError(id) 标记指定错误为已读', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('e1');
      });
      const errId = result.current.currentError!.id;
      act(() => {
        result.current.dismissError(errId);
      });
      expect(result.current.hasUnread).toBe(false);
    });

    it('无错误时 dismissError 不报错', () => {
      const { result } = renderHook(() => useGlobalError());
      expect(() => act(() => result.current.dismissError())).not.toThrow();
    });
  });

  describe('clearHistory', () => {
    it('清空所有错误历史', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('e1');
        result.current.reportError('e2');
      });
      act(() => {
        result.current.clearHistory();
      });
      expect(result.current.totalCount).toBe(0);
      expect(result.current.errorHistory).toEqual([]);
    });
  });

  describe('外部触发更新', () => {
    it('外部 reportError 触发 Hook 更新', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        reportError('external error');
      });
      expect(result.current.totalCount).toBe(1);
      expect(result.current.currentError?.message).toBe('external error');
    });

    it('外部 reportError 后 dismissError 也生效', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        reportError('external error');
      });
      const id = result.current.currentError!.id;
      act(() => {
        result.current.dismissError(id);
      });
      expect(result.current.hasUnread).toBe(false);
    });
  });

  describe('多个错误管理', () => {
    it('多次 dismiss 后 currentError 仍指向下一个未读', () => {
      const { result } = renderHook(() => useGlobalError());
      act(() => {
        result.current.reportError('e1');
        result.current.reportError('e2');
        result.current.reportError('e3');
      });
      // dismiss 全部
      act(() => {
        result.current.errorHistory.forEach((e) => result.current.dismissError(e.id));
      });
      expect(result.current.hasUnread).toBe(false);
      expect(result.current.currentError).toBe(null);
      // 历史仍保留
      expect(result.current.totalCount).toBe(3);
    });
  });
});
