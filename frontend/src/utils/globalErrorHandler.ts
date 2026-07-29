/**
 * # ============================================================
 * # 全局错误处理器 (v6.40.0 Cycle 18 P0-3)
 * # ============================================================
 * 核心作用：捕获并统一管理应用中所有未处理的运行时错误
 * 覆盖范围：
 *   1. window.onerror - 全局 JS 同步错误
 *   2. unhandledrejection - 未处理 Promise 拒绝
 *   3. resource error - script/img/css 资源加载失败
 *   4. 手动 reportError - 业务层显式上报
 * 设计决策：
 *   - 单例模式，避免重复安装监听器
 *   - 错误去重：相同消息在 1s 内只记录一次
 *   - 历史上限：默认保留最近 50 条
 *   - 静默模式：silentPatterns 匹配的错误不触发 UI 通知
 *   - 订阅模式：UI 层通过 subscribe 监听新错误
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | 初始创建
 * # ============================================================
 */

/** 错误类型枚举 */
export type GlobalErrorType =
  | 'js_error'         // 全局 JS 同步错误
  | 'promise_rejection' // 未处理 Promise 拒绝
  | 'resource_error'   // 资源加载失败
  | 'fetch_error'      // 网络请求失败
  | 'manual_report';   // 手动上报

/** 全局错误报告结构 */
export interface GlobalErrorReport {
  /** 唯一 ID（用于去重） */
  id: string;
  /** 错误类型 */
  type: GlobalErrorType;
  /** 错误消息 */
  message: string;
  /** 错误源（文件名 / URL） */
  source?: string;
  /** 行号 / 列号 */
  line?: number;
  /** 列号 */
  col?: number;
  /** 错误堆栈 */
  stack?: string;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 用户操作上下文 */
  context?: Record<string, unknown>;
  /** 是否已被 UI 确认（用户关闭 toast） */
  dismissed?: boolean;
}

/** 全局错误处理器配置 */
export interface GlobalErrorHandlerOptions {
  /** 自定义上报回调（接入外部监控系统） */
  onError?: (report: GlobalErrorReport) => void;
  /** 是否输出到 console（默认 true） */
  logToConsole?: boolean;
  /** 静默错误列表（不触发 UI 通知，仅记录到历史） */
  silentPatterns?: RegExp[];
  /** 最多保留错误数（默认 50） */
  maxReports?: number;
  /** 去重时间窗口（毫秒，默认 1000） */
  dedupeWindowMs?: number;
}

/** 内部存储结构 */
interface InternalOptions {
  onError?: (report: GlobalErrorReport) => void;
  logToConsole: boolean;
  silentPatterns: RegExp[];
  maxReports: number;
  dedupeWindowMs: number;
}

/** 简单的 ID 生成器（不依赖 crypto.randomUUID 以兼容旧浏览器） */
function generateId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * GlobalErrorHandler 单例类
 * 调用方：在 main.tsx 中调用 install(options?) 一次即可
 * 卸载：uninstall() 移除所有监听器
 */
class GlobalErrorHandlerClass {
  private reports: GlobalErrorReport[] = [];
  private listeners = new Set<(report: GlobalErrorReport) => void>();
  private installed = false;
  private options: InternalOptions = {
    logToConsole: true,
    silentPatterns: [],
    maxReports: 50,
    dedupeWindowMs: 1000,
  };
  private recentMessages = new Map<string, number>(); // message -> timestamp
  /** 原始 handler 引用，用于 uninstall 时还原 */
  private originalWindowError: typeof window.onerror = null;
  private originalUnhandledRejection: typeof window.onunhandledrejection = null;
  private originalErrorCapture: ((e: ErrorEvent) => void) | null = null;

  /**
   * 安装全局错误监听器
   * @param options 配置选项
   */
  install(options: GlobalErrorHandlerOptions = {}): void {
    if (this.installed) {
      // 已安装则合并 options（不重复添加监听器）
      this.options = { ...this.options, ...options };
      return;
    }

    this.options = {
      logToConsole: options.logToConsole ?? true,
      silentPatterns: options.silentPatterns ?? [],
      maxReports: options.maxReports ?? 50,
      dedupeWindowMs: options.dedupeWindowMs ?? 1000,
      onError: options.onError,
    };

    // 1. window.onerror - JS 同步错误
    this.originalWindowError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      this.handleError({
        type: 'js_error',
        message: String(message),
        source,
        line: lineno,
        col: colno,
        stack: error?.stack,
      });
      // 返回 true 表示已处理，避免浏览器默认报错
      return true;
    };

    // 2. unhandledrejection - Promise 拒绝
    this.originalUnhandledRejection = window.onunhandledrejection;
    window.onunhandledrejection = (event) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
          ? reason
          : JSON.stringify(reason);
      this.handleError({
        type: 'promise_rejection',
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };

    // 3. 资源加载错误 - 通过捕获阶段监听 error 事件
    const errorCapture = (e: ErrorEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 仅处理资源型元素的加载错误
      if (
        target instanceof HTMLScriptElement ||
        target instanceof HTMLImageElement ||
        target instanceof HTMLLinkElement
      ) {
        const src =
          (target as HTMLScriptElement).src ||
          (target as HTMLImageElement).src ||
          (target as HTMLLinkElement).href ||
          'unknown';
        this.handleError({
          type: 'resource_error',
          message: `资源加载失败: ${target.tagName}`,
          source: src,
        });
      }
    };
    window.addEventListener('error', errorCapture, true);
    this.originalErrorCapture = errorCapture;

    this.installed = true;
  }

  /**
   * 卸载全局错误监听器
   */
  uninstall(): void {
    if (!this.installed) return;
    window.onerror = this.originalWindowError;
    window.onunhandledrejection = this.originalUnhandledRejection;
    if (this.originalErrorCapture) {
      window.removeEventListener('error', this.originalErrorCapture, true);
    }
    this.originalErrorCapture = null;
    this.recentMessages.clear();
    this.installed = false;
  }

  /**
   * 内部错误处理
   * @param partial 部分错误字段
   */
  private handleError(partial: Omit<GlobalErrorReport, 'id' | 'timestamp'>): void {
    const now = Date.now();
    const report: GlobalErrorReport = {
      id: generateId(),
      timestamp: now,
      dismissed: false,
      ...partial,
    };

    // 去重检查
    const lastTime = this.recentMessages.get(report.message);
    if (lastTime && now - lastTime < this.options.dedupeWindowMs) {
      return; // 静默丢弃重复错误
    }
    this.recentMessages.set(report.message, now);

    // 清理过期的去重记录
    if (this.recentMessages.size > 100) {
      for (const [msg, t] of this.recentMessages.entries()) {
        if (now - t > this.options.dedupeWindowMs * 10) {
          this.recentMessages.delete(msg);
        }
      }
    }

    // 添加到历史
    this.reports.push(report);
    if (this.reports.length > this.options.maxReports) {
      this.reports.shift();
    }

    // 输出到 console
    if (this.options.logToConsole) {
      // eslint-disable-next-line no-console
      console.error(
        `[GlobalErrorHandler] [${report.type}] ${report.message}`,
        report.source ? `(${report.source}:${report.line}:${report.col})` : '',
        report.stack || '',
      );
    }

    // 触发自定义回调
    this.options.onError?.(report);

    // 通知订阅者
    this.listeners.forEach((listener) => {
      try {
        listener(report);
      } catch (err) {
        // 订阅者出错不影响主流程
        // eslint-disable-next-line no-console
        console.error('[GlobalErrorHandler] listener error:', err);
      }
    });
  }

  /**
   * 检查错误是否为静默模式（不触发 UI 提示）
   * @param message 错误消息
   * @returns 是否静默
   */
  private isSilent(message: string): boolean {
    return this.options.silentPatterns.some((pattern) => pattern.test(message));
  }

  /**
   * 手动上报错误（业务层调用）
   * @param error Error 对象或错误消息字符串
   * @param type 错误类型（默认 manual_report）
   * @param context 附加上下文
   */
  reportError(
    error: Error | string,
    type: GlobalErrorType = 'manual_report',
    context?: Record<string, unknown>,
  ): GlobalErrorReport | null {
    const message = error instanceof Error ? error.message : String(error);
    if (this.isSilent(message)) {
      return null;
    }
    this.handleError({
      type,
      message,
      stack: error instanceof Error ? error.stack : undefined,
      context,
    });
    return this.reports[this.reports.length - 1];
  }

  /**
   * 获取所有错误历史
   * @returns 错误历史数组（副本）
   */
  getReports(): GlobalErrorReport[] {
    return [...this.reports];
  }

  /**
   * 获取最近的错误
   * @returns 最近的错误报告
   */
  getLatestReport(): GlobalErrorReport | null {
    return this.reports.length > 0 ? this.reports[this.reports.length - 1] : null;
  }

  /**
   * 清空错误历史
   */
  clearReports(): void {
    this.reports = [];
    this.recentMessages.clear();
    this.notifyChange();
  }

  /**
   * 标记错误为已读（UI 层用户关闭 toast 时调用）
   * @param id 错误 ID
   */
  markDismissed(id: string): void {
    const report = this.reports.find((r) => r.id === id);
    if (report) {
      report.dismissed = true;
      this.notifyChange();
    }
  }

  /** 通知订阅者状态变化（不传具体 report，仅触发 listener） */
  private notifyChange(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.reports[this.reports.length - 1] || this.reports[0] || null as unknown as GlobalErrorReport);
      } catch (err) {
        // 订阅者出错不影响主流程
        // eslint-disable-next-line no-console
        console.error('[GlobalErrorHandler] listener error:', err);
      }
    });
  }

  /**
   * 订阅新错误事件
   * @param listener 监听器函数
   * @returns 取消订阅函数
   */
  subscribe(listener: (report: GlobalErrorReport) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 清空所有订阅者
   * 主要用于测试清理，避免上一个测试的 listener 影响后续测试
   */
  unsubscribeAll(): void {
    this.listeners.clear();
  }

  /**
   * 是否已安装
   */
  isInstalled(): boolean {
    return this.installed;
  }
}

/** 全局单例 */
export const globalErrorHandler = new GlobalErrorHandlerClass();

/** 便捷方法：手动上报错误 */
export function reportError(
  error: Error | string,
  type?: GlobalErrorType,
  context?: Record<string, unknown>,
): GlobalErrorReport | null {
  return globalErrorHandler.reportError(error, type, context);
}

export default globalErrorHandler;
