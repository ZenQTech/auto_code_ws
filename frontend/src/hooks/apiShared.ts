/**
 * # ============================================================
 * 共享 API 工具
 * # ============================================================
 * 核心作用：useApi.ts 拆分时抽离的公共依赖：apiFetch 帮助函数 + API_BASE 常量
 * 拆分日期：2026-07-27
 * 模块版本：
 *   - v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 *   - v6.41.0 - P1-1 集成 fetch 拦截器（统一超时、重试、去重、错误分类）
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 从 useApi.ts 抽离 API_BASE + apiFetch 通用函数
 *   - 2026-07-29 | v6.41.0 | apiFetch 内部切换为 apiFetchWithInterceptor
 *     - 默认 silent=true 保持向后兼容（消费者自行 try/catch + console.error）
 *     - 自动获得：超时控制 / 幂等方法重试 / 请求去重
 *     - 错误自动包装为 ApiError（继承自 Error，原有 catch 块无需修改）
 *     - 如需全局 Toast 上报，调用方传 silent: false 或使用 apiFetchWithToast
 * ============================================================
 */

import { apiFetchWithInterceptor, type ApiFetchOptions } from '../utils/apiInterceptor';

export const API_BASE = '/api';

/**
 * 通用 fetch 封装
 * - 自动设置 Content-Type: application/json
 * - 内部走 apiInterceptor：超时控制、幂等方法自动重试、请求去重（通过 requestId）
 * - 非 2xx 响应抛出 ApiError（继承自 Error，含 status / statusText / isNetworkError / isTimeout / isAuthError）
 * - 默认 silent=true：不上报 GlobalErrorHandler，由调用方自行处理
 *   （绝大多数消费者已 try/catch + console.error）
 * - 如需全局错误 Toast，调用方传 silent: false 或使用 apiFetchWithToast
 *
 * @param url API 路径（自动拼接 API_BASE；若已包含 http(s) 则不拼接）
 * @param options fetch 选项 + 扩展选项（timeoutMs / retry / maxRetries / silent / requestId / errorMessage）
 */
export async function apiFetch<T>(url: string, options?: ApiFetchOptions): Promise<T> {
  return apiFetchWithInterceptor<T>(url, {
    ...options,
    // 默认 silent 保持向后兼容（v6.41.0 之前行为）
    silent: true,
  });
}

/**
 * 通用 fetch 封装（启用全局错误 Toast 上报）
 * - 行为与 apiFetch 一致，但非 2xx 错误会自动上报到 GlobalErrorHandler
 * - 适用于：错误需要被全局感知（如登录过期 401、网络断开）
 *
 * 注意：调用方仍需 try/catch 阻止异常向上冒泡。
 */
export async function apiFetchWithToast<T>(url: string, options?: ApiFetchOptions): Promise<T> {
  return apiFetchWithInterceptor<T>(url, {
    ...options,
    silent: false,
  });
}
