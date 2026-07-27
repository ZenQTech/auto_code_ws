/**
 * # ============================================================
 * 共享 API 工具
 * # ============================================================
 * 核心作用：useApi.ts 拆分时抽离的公共依赖：apiFetch 帮助函数 + API_BASE 常量
 * 拆分日期：2026-07-27
 * 模块版本：v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 从 useApi.ts 抽离 API_BASE + apiFetch 通用函数
 * ============================================================
 */

export const API_BASE = '/api';

/**
 * 通用 fetch 封装
 * - 自动设置 Content-Type: application/json
 * - 非 2xx 响应抛出 Error，detail 取响应 JSON 中的 detail 字段
 * - 解析失败的错误响应使用 statusText 兜底
 */
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
