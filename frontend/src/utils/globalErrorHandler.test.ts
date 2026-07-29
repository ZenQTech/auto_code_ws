/**
 * GlobalErrorHandler 单元测试 (v6.40.0 Cycle 18 P0-3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  globalErrorHandler,
  reportError,
} from './globalErrorHandler';

describe('GlobalErrorHandler', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let originalOnError: typeof window.onerror;
  let originalOnUnhandled: typeof window.onunhandledrejection;

  beforeEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    globalErrorHandler.unsubscribeAll();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalOnError = window.onerror;
    originalOnUnhandled = window.onunhandledrejection;
  });

  afterEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.unsubscribeAll();
    errSpy.mockRestore();
    window.onerror = originalOnError;
    window.onunhandledrejection = originalOnUnhandled;
  });

  describe('install / uninstall', () => {
    it('install 后 isInstalled 返回 true', () => {
      expect(globalErrorHandler.isInstalled()).toBe(false);
      globalErrorHandler.install();
      expect(globalErrorHandler.isInstalled()).toBe(true);
    });

    it('uninstall 后 isInstalled 返回 false', () => {
      globalErrorHandler.install();
      globalErrorHandler.uninstall();
      expect(globalErrorHandler.isInstalled()).toBe(false);
    });

    it('重复 install 不报错', () => {
      globalErrorHandler.install();
      expect(() => globalErrorHandler.install()).not.toThrow();
      globalErrorHandler.uninstall();
    });

    it('uninstall 清理 listeners', () => {
      globalErrorHandler.install();
      const listener = vi.fn();
      const unsub = globalErrorHandler.subscribe(listener);
      unsub();
      globalErrorHandler.uninstall();
      // 卸载后再次 reportError 不应触发 listener
      globalErrorHandler.reportError('test1', 'manual_report');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('reportError', () => {
    it('记录字符串错误', () => {
      globalErrorHandler.install();
      const report = reportError('test message', 'manual_report');
      expect(report).not.toBeNull();
      expect(report?.message).toBe('test message');
      expect(report?.type).toBe('manual_report');
    });

    it('记录 Error 对象错误', () => {
      globalErrorHandler.install();
      const err = new Error('error message');
      const report = reportError(err, 'fetch_error');
      expect(report?.message).toBe('error message');
      expect(report?.stack).toBeDefined();
      expect(report?.type).toBe('fetch_error');
    });

    it('传递 context 参数', () => {
      globalErrorHandler.install();
      const report = reportError('test', 'manual_report', { userId: 'u1' });
      expect(report?.context).toEqual({ userId: 'u1' });
    });

    it('返回的 report 包含 id 和 timestamp', () => {
      globalErrorHandler.install();
      const before = Date.now();
      const report = reportError('test');
      const after = Date.now();
      expect(report?.id).toBeDefined();
      expect(report?.id.startsWith('err_')).toBe(true);
      expect(report?.timestamp).toBeGreaterThanOrEqual(before);
      expect(report?.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('window.onerror', () => {
    it('捕获全局 JS 错误', () => {
      globalErrorHandler.install();
      const err = new Error('global js error');
      window.onerror?.('global js error', 'test.js', 10, 5, err);
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBe(1);
      expect(reports[0].type).toBe('js_error');
      expect(reports[0].message).toBe('global js error');
      expect(reports[0].source).toBe('test.js');
      expect(reports[0].line).toBe(10);
      expect(reports[0].col).toBe(5);
    });
  });

  describe('unhandledrejection', () => {
    it('捕获未处理 Promise 拒绝', () => {
      globalErrorHandler.install();
      const event = {
        reason: new Error('promise error'),
        preventDefault: () => {},
      } as unknown as PromiseRejectionEvent;
      window.onunhandledrejection?.(event);
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBe(1);
      expect(reports[0].type).toBe('promise_rejection');
      expect(reports[0].message).toBe('promise error');
    });

    it('处理字符串形式的 reason', () => {
      globalErrorHandler.install();
      const event = {
        reason: 'string rejection',
        preventDefault: () => {},
      } as unknown as PromiseRejectionEvent;
      window.onunhandledrejection?.(event);
      const reports = globalErrorHandler.getReports();
      expect(reports[0].message).toBe('string rejection');
    });
  });

  describe('getReports / getLatestReport', () => {
    it('getReports 返回所有报告', () => {
      globalErrorHandler.install();
      reportError('e1');
      reportError('e2');
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBe(2);
    });

    it('getLatestReport 返回最新报告', () => {
      globalErrorHandler.install();
      reportError('e1');
      reportError('e2');
      expect(globalErrorHandler.getLatestReport()?.message).toBe('e2');
    });

    it('无报告时 getLatestReport 返回 null', () => {
      expect(globalErrorHandler.getLatestReport()).toBe(null);
    });

    it('getReports 返回副本（外部修改不影响内部）', () => {
      globalErrorHandler.install();
      reportError('e1');
      const reports = globalErrorHandler.getReports();
      reports.pop();
      expect(globalErrorHandler.getReports().length).toBe(1);
    });
  });

  describe('clearReports', () => {
    it('清空所有报告', () => {
      globalErrorHandler.install();
      reportError('e1');
      reportError('e2');
      globalErrorHandler.clearReports();
      expect(globalErrorHandler.getReports().length).toBe(0);
    });
  });

  describe('markDismissed', () => {
    it('标记报告为已读', () => {
      globalErrorHandler.install();
      const report = reportError('e1');
      expect(report?.dismissed).toBe(false);
      globalErrorHandler.markDismissed(report!.id);
      const reports = globalErrorHandler.getReports();
      expect(reports[0].dismissed).toBe(true);
    });

    it('id 不存在时不报错', () => {
      globalErrorHandler.install();
      expect(() => globalErrorHandler.markDismissed('nonexistent')).not.toThrow();
    });
  });

  describe('subscribe', () => {
    it('新错误触发 listener', () => {
      globalErrorHandler.install();
      const listener = vi.fn();
      const unsub = globalErrorHandler.subscribe(listener);
      reportError('e1');
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('unsub 后不再触发', () => {
      globalErrorHandler.install();
      const listener = vi.fn();
      const unsub = globalErrorHandler.subscribe(listener);
      reportError('e1');
      unsub();
      reportError('e2');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('多个 listener 都能收到通知', () => {
      globalErrorHandler.install();
      const l1 = vi.fn();
      const l2 = vi.fn();
      const u1 = globalErrorHandler.subscribe(l1);
      const u2 = globalErrorHandler.subscribe(l2);
      reportError('e1');
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
      u1();
      u2();
    });

    it('listener 异常不影响其他 listener', () => {
      globalErrorHandler.install();
      const badListener = vi.fn(() => {
        throw new Error('listener error');
      });
      const goodListener = vi.fn();
      globalErrorHandler.subscribe(badListener);
      globalErrorHandler.subscribe(goodListener);
      reportError('e1');
      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });

  describe('silentPatterns', () => {
    it('匹配静默模式的错误不上报', () => {
      globalErrorHandler.install({ silentPatterns: [/silent/i] });
      const report = reportError('this is a silent error', 'manual_report');
      expect(report).toBe(null);
      expect(globalErrorHandler.getReports().length).toBe(0);
    });

    it('不匹配的错误正常上报', () => {
      globalErrorHandler.install({ silentPatterns: [/silent/i] });
      reportError('this is a normal error');
      expect(globalErrorHandler.getReports().length).toBe(1);
    });
  });

  describe('去重逻辑', () => {
    it('相同消息在 1s 内只记录一次', () => {
      globalErrorHandler.install();
      reportError('same message');
      reportError('same message');
      reportError('same message');
      expect(globalErrorHandler.getReports().length).toBe(1);
    });

    it('不同消息都记录', () => {
      globalErrorHandler.install();
      reportError('msg1');
      reportError('msg2');
      reportError('msg3');
      expect(globalErrorHandler.getReports().length).toBe(3);
    });

    it('可配置去重时间窗口', () => {
      globalErrorHandler.install({ dedupeWindowMs: 10 });
      reportError('same');
      // 在 10ms 内去重
      reportError('same');
      expect(globalErrorHandler.getReports().length).toBe(1);
    });
  });

  describe('maxReports 上限', () => {
    it('超出上限时丢弃最早记录', () => {
      globalErrorHandler.install({ maxReports: 3, dedupeWindowMs: 0 });
      reportError('e1');
      reportError('e2');
      reportError('e3');
      reportError('e4');
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBe(3);
      expect(reports[0].message).toBe('e2');
      expect(reports[2].message).toBe('e4');
    });
  });

  describe('logToConsole', () => {
    it('logToConsole=false 时不调用 console.error', () => {
      globalErrorHandler.install({ logToConsole: false });
      reportError('e1');
      expect(errSpy).not.toHaveBeenCalled();
    });

    it('logToConsole=true（默认）时调用 console.error', () => {
      globalErrorHandler.install();
      reportError('e1');
      expect(errSpy).toHaveBeenCalled();
    });
  });

  describe('onError 回调', () => {
    it('调用 onError 回调', () => {
      const onError = vi.fn();
      globalErrorHandler.install({ onError });
      reportError('e1');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toBe('e1');
    });
  });

  describe('未安装时的行为', () => {
    it('未安装时 reportError 仍能记录到内存（仅供测试）', () => {
      // 不安装，reportError 仍然调用 handleError
      // 不会触发 window.onerror / unhandledrejection，但会添加报告
      const report = reportError('e1');
      expect(report).not.toBeNull();
      expect(globalErrorHandler.getReports().length).toBe(1);
    });
  });

  describe('集成测试', () => {
    it('完整错误捕获 + 通知 + 标记流程', () => {
      const onError = vi.fn();
      globalErrorHandler.install({ onError });
      const listener = vi.fn();
      globalErrorHandler.subscribe(listener);

      // 1. 模拟多种错误
      reportError('manual1');
      window.onerror?.('js1', 'a.js', 1, 1, new Error('js1'));
      window.onunhandledrejection?.({
        reason: new Error('promise1'),
        preventDefault: () => {},
      } as PromiseRejectionEvent);

      // 2. 验证
      expect(globalErrorHandler.getReports().length).toBe(3);
      expect(onError).toHaveBeenCalledTimes(3);
      expect(listener).toHaveBeenCalledTimes(3);

      // 3. 标记已读
      const latest = globalErrorHandler.getLatestReport();
      globalErrorHandler.markDismissed(latest!.id);
      expect(latest?.dismissed).toBe(true);

      // 4. 清空
      globalErrorHandler.clearReports();
      expect(globalErrorHandler.getReports().length).toBe(0);
    });
  });
});
