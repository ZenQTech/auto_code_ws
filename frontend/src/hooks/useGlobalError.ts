/**
 * # ============================================================
 * # useGlobalError Hook (v6.40.0 Cycle 18 P0-3)
 * # ============================================================
 * 核心作用：React Hook 封装，桥接 GlobalErrorHandler 单例与组件
 * 提供能力：
 *   - 当前错误状态（最近一条未确认错误）
 *   - 错误历史
 *   - dismissError / clearHistory 操作
 *   - reportError 主动上报
 * 设计决策：
 *   - 使用 useSyncExternalStore 订阅外部 store，避免 useEffect 异步问题
 *   - 缓存 reports 引用避免无限循环（仅在内容变化时返回新引用）
 *   - 自动 markDismissed 关联错误
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | 初始创建
 *   - 2026-07-29 | v1.0.1 | 修复 useSyncExternalStore 无限循环（缓存 reports 引用）
 * # ============================================================
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import globalErrorHandler, {
  type GlobalErrorReport,
  type GlobalErrorType,
} from '../utils/globalErrorHandler';

export interface UseGlobalErrorResult {
  /** 当前未确认的错误（用于显示 Toast） */
  currentError: GlobalErrorReport | null;
  /** 全部错误历史 */
  errorHistory: GlobalErrorReport[];
  /** 错误总数 */
  totalCount: number;
  /** 关闭当前错误 Toast（标记为已读） */
  dismissError: (id?: string) => void;
  /** 清空错误历史 */
  clearHistory: () => void;
  /** 主动上报错误 */
  reportError: (error: Error | string, type?: GlobalErrorType) => void;
  /** 是否有未确认错误 */
  hasUnread: boolean;
}

/**
 * 全局错误订阅 Hook
 * 调用方：任意需要监听 / 显示全局错误的组件
 */
export function useGlobalError(): UseGlobalErrorResult {
  // 用 ref 缓存 reports 引用避免无限循环
  const cachedReportsRef = useRef<GlobalErrorReport[]>(globalErrorHandler.getReports());
  const versionRef = useRef<number>(0);

  // 使用 useSyncExternalStore 订阅
  const subscribe = useCallback((listener: () => void) => {
    return globalErrorHandler.subscribe(() => {
      // 每次新错误触发时增加版本号
      versionRef.current += 1;
      // 重新读取 reports
      cachedReportsRef.current = globalErrorHandler.getReports();
      listener();
    });
  }, []);

  // getSnapshot 返回稳定的引用（仅在内容变化时更新）
  const getSnapshot = useCallback(() => {
    return cachedReportsRef.current;
  }, []);

  // 订阅获取最新 reports
  const reports = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // 派生状态
  const { currentError, totalCount, hasUnread } = useMemo(() => {
    const list = reports || [];
    const unread = list.filter((r) => !r.dismissed);
    return {
      currentError: unread.length > 0 ? unread[unread.length - 1] : null,
      totalCount: list.length,
      hasUnread: unread.length > 0,
    };
  }, [reports]);

  // 关闭错误 Toast
  const dismissError = useCallback((id?: string) => {
    if (id) {
      globalErrorHandler.markDismissed(id);
    } else if (currentError) {
      globalErrorHandler.markDismissed(currentError.id);
    }
  }, [currentError]);

  // 清空历史
  const clearHistory = useCallback(() => {
    globalErrorHandler.clearReports();
  }, []);

  // 主动上报
  const reportErrorFn = useCallback(
    (error: Error | string, type?: GlobalErrorType) => {
      globalErrorHandler.reportError(error, type);
    },
    [],
  );

  return {
    currentError,
    errorHistory: reports || [],
    totalCount,
    dismissError,
    clearHistory,
    reportError: reportErrorFn,
    hasUnread,
  };
}

export default useGlobalError;
