/**
 * # ============================================================
 * # API 拦截器 (v6.41.0 Cycle 18 P1-1)
 * # ============================================================
 * 核心作用：统一拦截所有 API 请求，统一处理错误、重试、去重、超时
 * 设计决策：
 *   - 基于 fetch 包装，不改变调用方 API
 *   - 错误自动上报到 GlobalErrorHandler（可静默）
 *   - 401/403 统一处理（跳转登录）
 *   - 500+ 触发 Toast 提示
 *   - GET/HEAD/OPTIONS 自动重试（指数退避）
 *   - 超时可配置
 *   - 支持请求去重（通过 requestId）
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | 初始创建
 * # ============================================================
 */

import { reportError } from './globalErrorHandler';
import { API_BASE } from '../hooks/apiShared';

// ============================================================
// 类型定义
// ============================================================

/** 扩展的 RequestInit 选项 */
export interface ApiFetchOptions extends RequestInit {
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 是否允许重试（仅幂等方法），默认 true */
  retry?: boolean;
  /** 最大重试次数（不含首次），默认 2 */
  maxRetries?: number;
  /** 自定义错误消息前缀（覆盖后端 detail） */
  errorMessage?: string;
  /** 静默错误（不触发 GlobalErrorToast），仅抛 Error */
  silent?: boolean;
  /** 请求 ID（用于去重，相同 ID 的请求自动合并） */
  requestId?: string;
  /** 401 时是否自动跳转登录（默认 true） */
  autoRedirectToLogin?: boolean;
}

/** 错误响应 */
export interface ApiErrorResponse {
  detail?: string;
  message?: string;
  [key: string]: unknown;
}

/** 自定义 API 错误 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly response?: ApiErrorResponse;
  public readonly isNetworkError: boolean;
  public readonly isTimeout: boolean;
  public readonly isAuthError: boolean;
  public readonly retryCount: number;

  constructor(
    message: string,
    status: number,
    statusText: string,
    url: string,
    options: {
      response?: ApiErrorResponse;
      isNetworkError?: boolean;
      isTimeout?: boolean;
      isAuthError?: boolean;
      retryCount?: number;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.response = options.response;
    this.isNetworkError = options.isNetworkError ?? false;
    this.isTimeout = options.isTimeout ?? false;
    this.isAuthError = options.isAuthError ?? false;
    this.retryCount = options.retryCount ?? 0;
  }
}

// ============================================================
// 内部状态
// ============================================================

/** 当前进行中的请求（用于去重） */
const pendingRequests = new Map<string, Promise<unknown>>();

/** 全局配置 */
let globalTimeoutMs = 30000;
let globalMaxRetries = 2;
let globalAutoRedirectToLogin = true;

/** 设置全局默认超时 */
export function setGlobalTimeout(ms: number): void {
  globalTimeoutMs = Math.max(1000, ms);
}

/** 设置全局默认最大重试次数 */
export function setGlobalMaxRetries(count: number): void {
  globalMaxRetries = Math.max(0, count);
}

/** 设置是否自动跳转登录 */
export function setAutoRedirectToLogin(enabled: boolean): void {
  globalAutoRedirectToLogin = enabled;
}

// ============================================================
// 内部工具函数
// ============================================================

/** 幂等方法（GET/HEAD/OPTIONS） */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 休眠 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 触发登录跳转 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  // 简单跳转登录页（实际项目可改为 modal）
  try {
    const currentPath = window.location.pathname + window.location.search;
    if (currentPath !== '/login') {
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
    }
  } catch {
    // ignore
  }
}

// ============================================================
// 核心 fetch 函数
// ============================================================

/**
 * 带超时的 fetch
 * @param url 请求 URL
 * @param options fetch 选项 + 扩展选项
 * @returns Promise<Response>
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? globalTimeoutMs;
  const externalSignal = options.signal;
  // 合并超时 signal 与外部 signal
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 监听外部 abort
  let externalAbortListener: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      externalAbortListener = () => controller.abort();
      externalSignal.addEventListener('abort', externalAbortListener);
    }
  }

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener('abort', externalAbortListener);
    }
  }
}

/**
 * 处理 HTTP 错误响应
 * @param res Response
 * @param url 请求 URL
 * @param options 选项
 * @returns 抛出的 ApiError
 */
async function handleErrorResponse(
  res: Response,
  url: string,
  options: ApiFetchOptions,
): Promise<ApiError> {
  let responseBody: ApiErrorResponse | null = null;
  let detailMessage = res.statusText;

  try {
    responseBody = (await res.json()) as ApiErrorResponse;
    detailMessage =
      responseBody.detail || responseBody.message || res.statusText;
  } catch {
    // 响应不是 JSON，使用 statusText
  }

  // 构造错误消息
  let message = options.errorMessage || detailMessage || `HTTP ${res.status}`;

  // 特定状态码的友好消息
  if (res.status === 401) {
    message = '登录已过期，请重新登录';
  } else if (res.status === 403) {
    message = '您没有权限执行此操作';
  } else if (res.status === 404) {
    message = '请求的资源不存在';
  } else if (res.status === 429) {
    message = '请求过于频繁，请稍后重试';
  } else if (res.status >= 500) {
    message = '服务暂时不可用，请稍后重试';
  }

  const isAuthError = res.status === 401 || res.status === 403;

  const error = new ApiError(message, res.status, res.statusText, url, {
    response: responseBody ?? undefined,
    isAuthError,
  });

  // 上报到 GlobalErrorHandler（非静默时）
  if (!options.silent) {
    reportError(error, 'fetch_error', {
      url,
      status: res.status,
      method: options.method || 'GET',
    });
  }

  // 401 自动跳转登录
  if (res.status === 401 && (options.autoRedirectToLogin ?? globalAutoRedirectToLogin)) {
    redirectToLogin();
  }

  return error;
}

/**
 * 带重试的 fetch 包装
 * - 网络错误 / 超时：自动重试
 * - 5xx 错误：自动重试
 * - 4xx 错误：不重试（客户端错误，重试无意义）
 * @param url 请求 URL
 * @param options 选项
 * @returns Promise<Response>
 */
async function fetchWithRetry(
  url: string,
  options: ApiFetchOptions,
): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const isIdempotent = IDEMPOTENT_METHODS.has(method);
  const allowRetry = options.retry ?? isIdempotent;
  const maxRetries = Math.max(
    0,
    options.maxRetries ?? (allowRetry ? globalMaxRetries : 0),
  );

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        credentials: options.credentials,
        mode: options.mode,
        cache: options.cache,
        redirect: options.redirect,
        referrer: options.referrer,
        referrerPolicy: options.referrerPolicy,
        integrity: options.integrity,
        keepalive: options.keepalive,
        signal: options.signal ?? undefined,
        timeoutMs: options.timeoutMs,
      });

      // 5xx 错误视为可重试
      if (res.status >= 500 && attempt < maxRetries) {
        lastResponse = res;
        // 释放 body 防止泄漏
        try { await res.text(); } catch { /* ignore */ }
        const delay = Math.min(500 * Math.pow(2, attempt), 5000);
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        // 指数退避：500ms, 1000ms, 2000ms
        const delay = Math.min(500 * Math.pow(2, attempt), 5000);
        await sleep(delay);
      }
    }
  }

  // 重试耗尽：如果有 lastResponse 则返回（让上层处理 5xx），否则抛错
  if (lastResponse) {
    return lastResponse;
  }
  throw lastError || new Error('Request failed after retries');
}

/**
 * 统一 fetch API
 * - 自动超时
 * - 自动重试（幂等方法）
 * - 错误分类 + 全局上报
 * - 401 自动跳转登录
 * - 请求去重（通过 requestId）
 * @param url API 路径（自动拼接 API_BASE）
 * @param options 扩展选项
 * @returns Promise<T>
 */
export async function apiFetchWithInterceptor<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const method = (options.method || 'GET').toUpperCase();

  // 请求去重
  if (options.requestId) {
    const key = `${options.requestId}::${fullUrl}`;
    const existing = pendingRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
  }

  // 创建请求 Promise
  const requestPromise = (async (): Promise<T> => {
    try {
      const res = await fetchWithRetry(fullUrl, options);

      if (!res.ok) {
        throw await handleErrorResponse(res, fullUrl, options);
      }

      // 解析 JSON 响应
      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      // 非 JSON 响应返回 text
      return (await res.text()) as unknown as T;
    } catch (err) {
      // 处理已构造的 ApiError
      if (err instanceof ApiError) {
        throw err;
      }

      // 网络错误 / 超时
      const isTimeout =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted'));
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && err.message.includes('Failed to fetch'));

      const message = isTimeout
        ? '请求超时，请重试'
        : isNetworkError
        ? '网络连接失败，请检查网络'
        : err instanceof Error
        ? err.message
        : '未知错误';

      const apiError = new ApiError(
        message,
        0,
        isTimeout ? 'TIMEOUT' : isNetworkError ? 'NETWORK_ERROR' : 'UNKNOWN',
        fullUrl,
        {
          isTimeout,
          isNetworkError: !isTimeout && isNetworkError,
        },
      );

      if (!options.silent) {
        reportError(apiError, 'fetch_error', {
          url: fullUrl,
          method,
          isTimeout,
          isNetworkError,
        });
      }

      throw apiError;
    } finally {
      // 清理 pending
      if (options.requestId) {
        const key = `${options.requestId}::${fullUrl}`;
        pendingRequests.delete(key);
      }
    }
  })();

  // 注册到 pending
  if (options.requestId) {
    const key = `${options.requestId}::${fullUrl}`;
    pendingRequests.set(key, requestPromise);
  }

  return requestPromise;
}

export default apiFetchWithInterceptor;
