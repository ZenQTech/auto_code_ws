# Cycle 18 P1-1 Spec: fetch 拦截器统一错误处理

**版本**: v6.41.0 (Cycle 18 P1-1)
**日期**: 2026-07-29
**作者**: AI Architect
**状态**: 进行中

---

## 一、目标

将 `apiFetch` 升级为支持全局错误处理的统一拦截器，所有网络错误自动上报到 GlobalErrorHandler，并提供：
1. **401/403 认证失败**：统一提示 + 跳转登录
2. **500+ 服务器错误**：统一 Toast 提示（仅首次）
3. **网络断开**：offline 检测 + 重连提示
4. **超时**：可配置 timeout + 友好提示
5. **请求重试**：幂等请求（GET/HEAD/OPTIONS）支持指数退避重试
6. **请求去重**：相同 URL+Method+Body 的请求自动合并（防止重复点击）

---

## 二、当前状态

### 2.1 已完成（v6.40.0 Cycle 18 P0-3）
- ✅ `globalErrorHandler.ts` - 全局错误监听
- ✅ `useGlobalError.ts` - React Hook 桥接
- ✅ `GlobalErrorToast.tsx` - 错误提示 UI
- ✅ `apiShared.ts` - apiFetch 基础封装（仅抛 Error，无全局处理）

### 2.2 待完成（Cycle 18 P1-1）
- ❌ apiFetch 抛错无统一分类（401/403/500/timeout/offline 无法区分）
- ❌ 网络错误无全局上报
- ❌ 无超时配置
- ❌ 无重试机制
- ❌ 无请求去重

---

## 三、设计方案

### 3.1 拦截器架构

```
apiFetch(url, options)
  ↓
[前置] offline 检查 + 重复请求去重
  ↓
fetch() + timeout 包装
  ↓
[后置] 响应处理
  ├─ 2xx → 解析 JSON 返回
  ├─ 401/403 → 触发登录 + 报告
  ├─ 500+ → 报告到 GlobalErrorHandler
  └─ 4xx 其他 → 报告
  ↓
[异常] TypeError (network error)
  └─ 报告到 GlobalErrorHandler
  ↓
[可选] 幂等请求重试 (GET/HEAD/OPTIONS)
```

### 3.2 API 设计

```typescript
export interface ApiFetchOptions extends RequestInit {
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 是否允许重试（仅幂等方法），默认 true */
  retry?: boolean;
  /** 最大重试次数，默认 2 */
  maxRetries?: number;
  /** 自定义错误消息 */
  errorMessage?: string;
  /** 静默错误（不触发 GlobalErrorToast） */
  silent?: boolean;
  /** 请求 ID（用于去重） */
  requestId?: string;
}

export async function apiFetch<T>(
  url: string,
  options?: ApiFetchOptions
): Promise<T>;
```

### 3.3 错误分类与处理

| 错误类型 | HTTP 状态 | 行为 | 用户提示 |
|----------|-----------|------|----------|
| 认证失败 | 401 | 跳转登录 + 报告 | "登录已过期，请重新登录" |
| 权限拒绝 | 403 | 报告 | "您没有权限执行此操作" |
| 资源不存在 | 404 | 报告（可静默） | "请求的资源不存在" |
| 请求参数错误 | 400/422 | 报告 | 后端 detail 消息 |
| 服务器错误 | 500-599 | 报告 + 重试 GET | "服务暂时不可用，请稍后重试" |
| 网络断开 | TypeError | 报告 + 提示 offline | "网络连接已断开" |
| 超时 | AbortError | 报告 | "请求超时，请重试" |
| 限流 | 429 | 报告 + 退避重试 | "请求过于频繁" |

### 3.4 文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `utils/apiInterceptor.ts` | 新建 | fetch 拦截器核心 |
| `utils/apiInterceptor.test.ts` | 新建 | 单元测试 |
| `hooks/apiShared.ts` | 修改 | 集成拦截器，导出新 API |

---

## 四、测试策略

### 4.1 单元测试覆盖
- 正常 2xx 响应 → 返回解析数据
- 401 → 抛错 + 触发 GlobalErrorHandler
- 500 → 抛错 + 触发 GlobalErrorHandler
- 网络错误 (TypeError) → 抛错 + 触发 GlobalErrorHandler
- 超时 (AbortError) → 抛错
- 重试：GET 失败后重试 2 次后最终失败
- 重试：POST 不重试
- 去重：相同请求合并

---

## 五、验收标准

- ✅ 所有 401 自动跳登录 + Toast
- ✅ 所有 500+ 自动 Toast 提示
- ✅ 网络断开自动 Toast 提示
- ✅ 超时可配置且默认值合理（30s）
- ✅ GET 请求失败自动重试 1 次
- ✅ 不破坏现有 useApi.ts 调用
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ 既有 1374 个测试不回归
