# Cycle 18 P0-3 Spec: 错误边界与全局错误处理

**版本**: v6.40.0 (Cycle 18 P0-3)
**日期**: 2026-07-29
**作者**: AI Architect
**状态**: 进行中

---

## 一、目标

构建完整的错误边界 + 全局错误处理体系，覆盖以下五类运行时错误：

1. **React 组件渲染错误**：通过 ErrorBoundary 捕获
2. **全局未捕获错误**：通过 `window.onerror` 捕获同步异常
3. **未处理 Promise 拒绝**：通过 `unhandledrejection` 捕获
4. **资源加载错误**：通过 `error` 事件 + `addEventListener('error', ..., true)` 捕获 script/img/css 失败
5. **网络层错误**：通过 fetch 拦截器统一处理 API 失败

所有错误需统一收集、分类上报、用户友好提示，且不影响主流程运行。

---

## 二、当前状态

### 2.1 已完成（v1.1.0 P2-4）
- ✅ `ErrorBoundary.tsx` (v1.1.0) - 支持自定义 fallback / 重试 / onError / level
- ✅ `ErrorBoundary.test.tsx` - 单元测试
- ✅ `main.tsx` - 在根级别集成 ErrorBoundary

### 2.2 待完成（Cycle 18 P0-3）
- ❌ 无全局未捕获错误监听（window.onerror / unhandledrejection）
- ❌ 无资源加载错误监听
- ❌ 无网络层错误统一处理
- ❌ 错误无统一上报通道
- ❌ 关键面板（ComposerPanel、Sidebar、MessageBubble）无独立 ErrorBoundary
- ❌ 无错误状态管理（无法在 UI 中显示全局错误通知）

---

## 三、设计方案

### 3.1 全局错误处理器 (`utils/globalErrorHandler.ts`)

```typescript
interface GlobalErrorReport {
  /** 错误类型 */
  type: 'js_error' | 'promise_rejection' | 'resource_error' | 'fetch_error';
  /** 错误消息 */
  message: string;
  /** 错误源（文件名 / URL） */
  source?: string;
  /** 行号 / 列号 */
  line?: number;
  /** 错误堆栈 */
  stack?: string;
  /** 时间戳 */
  timestamp: number;
  /** 用户操作上下文（最近一次交互） */
  context?: Record<string, unknown>;
}

interface GlobalErrorHandlerOptions {
  /** 自定义上报回调 */
  onError?: (report: GlobalErrorReport) => void;
  /** 是否输出到 console（默认 true） */
  logToConsole?: boolean;
  /** 静默错误列表（不提示用户） */
  silentPatterns?: RegExp[];
  /** 最多保留错误数（默认 50） */
  maxReports?: number;
}

class GlobalErrorHandler {
  private reports: GlobalErrorReport[] = [];
  private listeners = new Set<(report: GlobalErrorReport) => void>();
  private installed = false;
  
  install(options?: GlobalErrorHandlerOptions): void;
  uninstall(): void;
  getReports(): GlobalErrorReport[];
  clearReports(): void;
  subscribe(listener: (report: GlobalErrorReport) => void): () => void;
}
```

### 3.2 错误状态管理 (`hooks/useGlobalError.ts`)

```typescript
interface GlobalErrorState {
  /** 最近的全局错误 */
  currentError: GlobalErrorReport | null;
  /** 错误历史 */
  history: GlobalErrorReport[];
  /** 错误是否已读（用户已关闭 toast） */
  dismissed: boolean;
}

interface UseGlobalErrorResult {
  currentError: GlobalErrorReport | null;
  errorHistory: GlobalErrorReport[];
  dismissError: () => void;
  clearHistory: () => void;
  reportError: (error: Error | string, type?: GlobalErrorReport['type']) => void;
}
```

### 3.3 全局错误 Toast 组件 (`components/GlobalErrorToast.tsx`)

- 监听 useGlobalError 的 currentError
- 错误出现时显示顶部 Toast（红色 alert 样式）
- 提供"查看详情"+"重试"+"忽略"三个按钮
- 自动 10s 后消失（可配置）

### 3.4 关键面板 ErrorBoundary 嵌套

在以下位置插入 ErrorBoundary（level='panel'）：
- `<Sidebar />` 包裹
- `<ComposerPanel />` 包裹
- `<PlanViewer />` 包裹
- `<PreviewPanel />` 包裹
- `<CodeViewer />` 包裹

任一面板崩溃不影响其他面板使用。

### 3.5 网络层错误拦截

在 `apiShared.ts` 的 fetch 包装中：
- 401/403 → 全局错误 toast + 跳转登录
- 500+ → 全局错误 toast（仅首次）
- 网络断开 → 全局错误 toast + 重连提示
- 超时 → 全局错误 toast

---

## 四、文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `utils/globalErrorHandler.ts` | 新建 | 全局错误处理器类 |
| `utils/globalErrorHandler.test.ts` | 新建 | 单元测试 |
| `hooks/useGlobalError.ts` | 新建 | 全局错误状态 Hook |
| `hooks/useGlobalError.test.ts` | 新建 | 单元测试 |
| `components/GlobalErrorToast.tsx` | 新建 | 全局错误 Toast UI |
| `components/GlobalErrorToast.test.tsx` | 新建 | 组件测试 |
| `main.tsx` | 修改 | 安装全局错误处理器 |
| `App.tsx` | 修改 | 渲染 GlobalErrorToast |
| `components/Sidebar.tsx` | 修改 | 包裹 ErrorBoundary |
| `components/ComposerPanel.tsx` | 修改 | 包裹 ErrorBoundary |
| `components/PlanViewer.tsx` | 修改 | 包裹 ErrorBoundary |
| `components/PreviewPanel.tsx` | 修改 | 包裹 ErrorBoundary |
| `components/CodeViewer.tsx` | 修改 | 包裹 ErrorBoundary |

---

## 五、测试策略

### 5.1 单元测试
- GlobalErrorHandler 类：install/uninstall、reports 收集、订阅通知
- useGlobalError Hook：状态同步、dismissError、clearHistory

### 5.2 组件测试
- GlobalErrorToast：错误显示、按钮交互、自动消失

### 5.3 集成测试
- 模拟全局未捕获错误 → 验证 toast 弹出
- 模拟组件抛错 → 验证 ErrorBoundary 显示
- 模拟网络错误 → 验证统一处理

---

## 六、验收标准

- ✅ window.onerror 抛错 → Toast 出现 + 错误历史记录
- ✅ Promise.reject → Toast 出现 + 错误历史记录
- ✅ 资源加载失败 → 静默记录（不影响用户）
- ✅ 任意面板崩溃 → 仅该面板显示 fallback，其他功能正常
- ✅ 错误 50 条上限 + 自动去重（相同消息 1s 内只记录一次）
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ 既有 1081 个测试不回归
