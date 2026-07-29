# Cycle 18 P1-1 任务总结：fetch 拦截器统一错误处理

## 任务目标

实现一个统一的 fetch 拦截器，作为所有 API 请求的入口，集中处理：
- 超时控制
- 自动重试（仅幂等方法 + 5xx）
- 请求去重
- 错误分类（网络错误 / 超时 / 认证错误 / 业务错误）
- 401 自动跳转登录
- 全局错误上报（与 GlobalErrorHandler 集成）

## 完成情况

✅ **100% 完成**

## 交付物清单

### 核心代码文件

| 文件 | 版本 | 行数 | 说明 |
|------|------|------|------|
| [apiInterceptor.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/apiInterceptor.ts) | v1.0.0 | ~430 | 拦截器核心实现 |
| [apiShared.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/apiShared.ts) | v6.41.0 | ~56 | 集成拦截器 + 新增 apiFetchWithToast |

### 测试文件

| 文件 | 测试数 | 覆盖范围 |
|------|--------|---------|
| [apiInterceptor.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/apiInterceptor.test.ts) | 28 | 正常响应 / 错误响应 / 网络错误 / 重试机制 / 请求去重 / 错误分类 / ApiError 类 / 全局配置 |
| [apiShared.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/apiShared.test.ts) | 11 | 集成行为 / 向后兼容 / silent 行为 / 新增能力 |
| [test_e2e_cycle18_p1_1.sh](file:///home/qizheng/auto_code_ws/tests/test_e2e_cycle18_p1_1.sh) | 20 断言 | 文件存在性 / 功能完整性 / 单元测试 / TypeScript / 全部测试 |

**总计**：39 单元测试 + 20 E2E 断言 = **59 个验证点**

## 关键设计决策

### 1. ApiError 扩展 Error（向后兼容）
```ts
export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly isNetworkError: boolean;
  public readonly isTimeout: boolean;
  public readonly isAuthError: boolean;
}
```
- 旧代码 `catch (e) { e.message }` 依然有效（ApiError 继承自 Error）
- 新代码可访问 `e.status / e.isAuthError` 等增强字段
- 无需修改 19 个使用 apiFetch 的 hook 文件

### 2. 默认 silent=true（向后兼容）
```ts
export async function apiFetch<T>(url: string, options?: ApiFetchOptions): Promise<T> {
  return apiFetchWithInterceptor<T>(url, {
    ...options,
    silent: true, // 保持 v6.40.x 行为：不上报 GlobalErrorHandler
  });
}
```
- 19 个使用 apiFetch 的 hook 已有 try/catch + console.error
- 默认 silent 避免双重错误提示（消费者 + GlobalErrorHandler）
- 需要全局提示的调用方使用新的 `apiFetchWithToast`

### 3. 幂等方法自动重试
```ts
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowRetry = options.retry ?? isIdempotent; // 默认 GET/HEAD/OPTIONS 重试
```
- POST/PUT/DELETE 等非幂等方法默认不重试
- 5xx 错误也触发重试
- 指数退避：500ms → 1000ms → 2000ms（上限 5000ms）

### 4. 请求去重
```ts
if (options.requestId) {
  const key = `${options.requestId}::${fullUrl}`;
  const existing = pendingRequests.get(key);
  if (existing) return existing; // 复用 in-flight Promise
}
```
- 同 `requestId` 同 URL 的请求自动合并
- 完成后自动清理 pending
- 避免按钮重复点击触发的并发请求

## 拦截器能力矩阵

| 能力 | 实现状态 | 配置项 |
|------|---------|--------|
| 超时控制 | ✅ | `timeoutMs` (默认 30s) |
| 幂等方法重试 | ✅ | `retry: true` 默认 / `maxRetries` (默认 2) |
| 5xx 重试 | ✅ | 同上 |
| 401/403 不重试 | ✅ | 自动判断 |
| 请求去重 | ✅ | `requestId` |
| 401 自动跳转登录 | ✅ | `autoRedirectToLogin: true` |
| 错误分类 | ✅ | `isNetworkError / isTimeout / isAuthError` |
| 全局错误上报 | ✅ | `silent: false` 启用 |
| 自定义错误消息 | ✅ | `errorMessage` |
| AbortController | ✅ | 透传外部 signal |

## 验证结果

### 单元测试
- ✅ apiInterceptor 单元测试：**28/28 通过**
- ✅ apiShared 集成测试：**11/11 通过**
- ✅ 全部 utils/hooks 测试：**772/772 通过**
- ✅ 全部前端测试：**1353/1353 通过**（71 个测试文件）

### TypeScript 编译
- ✅ **0 错误**

### E2E 验证
- ✅ **20/20 断言通过**

### 兼容性验证
- ✅ 19 个使用 `apiFetch` 的 hook 文件无需修改
- ✅ 旧错误处理代码 `catch (e) { ... }` 继续工作
- ✅ 新代码可访问 ApiError 增强字段

## 修改的影响面

### 自动获得新能力的现有代码（19 个 hook）
所有 `import { apiFetch } from './apiShared'` 的代码自动获得：
- 30 秒超时
- GET 请求自动重试 2 次
- 指数退避（500ms / 1000ms / 2000ms）
- 友好错误消息（401/403/404/429/5xx）

### 0 个文件需要修改
所有现有消费者无需任何代码改动即可获得新能力。

## 下一步计划

### Cycle 18 P1-2: SSE 拦截器（下一步）
- 流式响应专用拦截器
- 自动重连 + 断点续传
- 心跳检测

### Cycle 18 P1-3: 乐观更新模式
- 集成拦截器与 React Query / SWR 风格的乐观更新
- 失败时自动回滚

## 相关文档

- [CYCLE18_P1_1_SPEC.md](file:///home/qizheng/auto_code_ws/CYCLE18_P1_1_SPEC.md) - 详细规范
- [apiInterceptor.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/apiInterceptor.ts) - 核心实现
- [apiShared.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/apiShared.ts) - 集成入口
- [test_e2e_cycle18_p1_1.sh](file:///home/qizheng/auto_code_ws/tests/test_e2e_cycle18_p1_1.sh) - E2E 测试
