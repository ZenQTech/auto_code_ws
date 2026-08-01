/**
 * # ============================================================
 * # HTTP Client - 跨环境 HTTP 客户端 (Cycle 54 G54-01)
 * # ============================================================
 * # 核心作用：抽象浏览器/Node.js 双环境的 HTTP 客户端
 * # 支持：fetch (浏览器) + 原生 XHR 回退 + Mock 模式
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 54 G54-01 初次创建
 * # ====================================
 */

import type { HttpMethod, PlatformCredentials } from './platformTypes';

export interface HttpRequestOptions {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array | null;
  timeoutMs?: number;
  credentials?: PlatformCredentials;
  verifyTls?: boolean;
  /** 模拟模式：返回 mock 响应而不是真实请求 */
  mockResponse?: { status: number; body: string; headers?: Record<string, string> };
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * 将认证凭证转换为请求头
 */
export function buildAuthHeaders(credentials?: PlatformCredentials): Record<string, string> {
  if (!credentials) return {};
  switch (credentials.scheme) {
    case 'basic': {
      if (!credentials.username) return {};
      const raw = `${credentials.username}:${credentials.password ?? ''}`;
      // 浏览器和 Node.js 都支持 btoa
      const encoded = typeof btoa !== 'undefined' ? btoa(raw) : Buffer.from(raw).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }
    case 'bearer':
      return credentials.token ? { Authorization: `Bearer ${credentials.token}` } : {};
    case 'api-key':
      return credentials.apiKeyHeader && credentials.apiKeyValue
        ? { [credentials.apiKeyHeader]: credentials.apiKeyValue }
        : {};
    case 'x-api-key':
      return credentials.apiKeyValue ? { 'X-API-Key': credentials.apiKeyValue } : {};
    case 'none':
    default:
      return credentials.customHeaders ?? {};
  }
}

/**
 * 通用 HTTP 请求函数
 * 自动适配 fetch / XHR / Mock 模式
 */
export async function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  const start = Date.now();

  // Mock 模式直接返回
  if (options.mockResponse) {
    return {
      status: options.mockResponse.status,
      statusText: options.mockResponse.status === 200 ? 'OK' : 'Mock',
      headers: options.mockResponse.headers ?? {},
      body: options.mockResponse.body,
      durationMs: Date.now() - start,
    };
  }

  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  // 注入认证头
  Object.assign(headers, buildAuthHeaders(options.credentials));

  // 优先使用 fetch
  if (typeof fetch !== 'undefined') {
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? 10000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(options.url, {
        method: options.method,
        headers,
        body: options.body ?? undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const body = await res.text();
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        respHeaders[key] = value;
      });
      return {
        status: res.status,
        statusText: res.statusText,
        headers: respHeaders,
        body,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpError(`Fetch failed: ${msg}`, 0, '');
    }
  }

  // XHR 回退
  if (typeof XMLHttpRequest !== 'undefined') {
    return new Promise<HttpResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method, options.url, true);
      const timeout = options.timeoutMs ?? 10000;
      xhr.timeout = timeout;
      for (const [k, v] of Object.entries(headers)) {
        xhr.setRequestHeader(k, v);
      }
      xhr.onload = () => {
        resolve({
          status: xhr.status,
          statusText: xhr.statusText,
          headers: {},
          body: xhr.responseText ?? '',
          durationMs: Date.now() - start,
        });
      };
      xhr.onerror = () => reject(new HttpError('XHR error', xhr.status ?? 0, ''));
      xhr.ontimeout = () => reject(new HttpError('XHR timeout', 0, ''));
      xhr.send(options.body as XMLHttpRequestBodyInit);
    });
  }

  throw new Error('No HTTP client available (no fetch, no XHR)');
}

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算指数退避延迟
 */
export function calculateBackoff(
  attempt: number,
  policy: { initialDelayMs: number; maxDelayMs: number; backoffMultiplier: number; jitterFactor: number }
): number {
  const base = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt), policy.maxDelayMs);
  const jitter = base * policy.jitterFactor * Math.random();
  return Math.floor(base + jitter);
}

/**
 * 带重试的 HTTP 请求
 */
export async function httpRequestWithRetry(
  options: HttpRequestOptions,
  retryPolicy: { maxRetries: number; initialDelayMs: number; maxDelayMs: number; backoffMultiplier: number; jitterFactor: number },
  onRetry?: (attempt: number, err: Error) => void
): Promise<HttpResponse> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
    try {
      return await httpRequest(options);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < retryPolicy.maxRetries) {
        if (onRetry) onRetry(attempt + 1, lastErr);
        const backoff = calculateBackoff(attempt, retryPolicy);
        await delay(backoff);
      }
    }
  }
  throw lastErr ?? new Error('Unknown HTTP error');
}

/**
 * URL 拼接辅助
 */
export function buildUrl(baseUrl: string, path: string, pathPrefix?: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const prefix = pathPrefix ? `/${pathPrefix.replace(/^\/+|\/+$/g, '')}` : '';
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}${prefix}/${trimmedPath}`;
}
