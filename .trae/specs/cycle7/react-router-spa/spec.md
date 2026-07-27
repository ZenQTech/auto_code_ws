# Cycle 7 P1-2: React Router v6/v7 SPA Mode 深度集成

> **版本**: v5.7.0
> **任务**: Cycle 7 P1-2
> **日期**: 2026-07-27
> **状态**: 设计阶段

---

## 一、任务背景

### 1.1 现状

项目已安装 `react-router-dom@^6.3.0`,但仅在 `AppRouter.tsx` 中定义了占位组件,未实际启用。`App.tsx` (2048 行) 通过内部 `useState` 管理所有路由逻辑:

| 当前状态 | useState 位置 | 路由映射 |
|----------|---------------|----------|
| `appMode` (chat/coding/null) | App.tsx:200 | URL 应为 `/` 或 `/chat` 或 `/coding` |
| `selectedProject` | App.tsx:196 | URL 应为 `/coding/project/{id}` |
| `currentSessionId` | App.tsx:196 | URL 应为 `/chat/session/{id}` |
| 模态/弹窗状态 | useModals.ts | 保留内部 state,无需 URL 化 |

### 1.2 问题

- **不可分享 URL**: 用户无法复制 URL 分享特定视图
- **不可深链**: 刷新页面丢失状态
- **不可前进/后退**: 浏览器历史按钮失效
- **SEO 不友好**: 单一 URL 处理所有视图
- **调试困难**: 状态不透明,无法通过 URL 定位

### 1.3 目标

实现 **React Router v6 SPA 模式**,在保留现有功能的同时:
1. URL 反映当前视图(可分享、可深链)
2. 浏览器前进/后退正常工作
3. 路由懒加载(按需加载页面组件,减小首屏)
4. 嵌套路由(子视图继承父布局)
5. 类型安全路由参数

---

## 二、技术调研

### 2.1 React Router v6 vs v7 选型

| 特性 | v6 | v7 |
|------|----|----|
| 数据路由 (loaders) | ✗ | ✓ |
| 类型生成器 | ✗ | ✓ (`@react-router/dev`) |
| 文件路由 | ✗ | ✓ (约定式) |
| 兼容性 | ✓ 稳定 | ⚠ 需 framework 模式 |
| 当前项目使用 | v6.3.0 | (未使用) |

**决策**: 采用 v6 深度集成(不升级到 v7,避免破坏性变更),通过 `react-router-dom` v6 的 `createBrowserRouter` API 实现 SPA Mode。

### 2.2 路由架构

```
/                          → ModeSelector (模式选择)
/chat                      → ChatLayout (聊天布局)
  /chat/new                → 新建会话
  /chat/session/:id        → 已有会话
/coding                    → CodingLayout (编程布局)
  /coding/new              → 新建项目
  /coding/project/:id      → 已有项目
    /coding/project/:id/file/:path → 打开文件
/settings                  → SettingsPage
/workflow/:id              → WorkflowDetailPage
```

### 2.3 关键技术点

1. **嵌套路由**: 父布局 (ChatLayout/CodingLayout) 包含 Sidebar + 头部
2. **Outlet**: 子路由在父布局的指定位置渲染
3. **懒加载**: `React.lazy()` + `Suspense`
4. **错误边界**: `errorElement` 处理 404/500
5. **类型安全**: 自定义 `useParams<T>()` 泛型

---

## 三、技术实现

### 3.1 路由结构

```typescript
// router.tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <ModeSelector /> },
      
      // Chat routes
      {
        path: 'chat',
        element: <ChatLayout />,
        children: [
          { index: true, element: <ChatHome /> },
          { path: 'new', element: <NewChat /> },
          { path: 'session/:sessionId', element: <ChatView /> },
        ],
      },
      
      // Coding routes
      {
        path: 'coding',
        element: <CodingLayout />,
        children: [
          { index: true, element: <CodingHome /> },
          { path: 'new', element: <NewProject /> },
          { path: 'project/:projectId', element: <ProjectWorkspace />,
            children: [
              { path: 'file/*', element: <FileViewer /> },
            ],
          },
        ],
      },
      
      // Settings & workflow
      { path: 'settings', element: <SettingsPage /> },
      { path: 'workflow/:workflowId', element: <WorkflowDetailPage /> },
    ],
  },
]);
```

### 3.2 渐进式迁移策略

**第 1 步**: 路由化 `appMode` 状态
- `/` 显示 ModeSelector
- `/chat` 自动设置 appMode='chat'
- `/coding` 自动设置 appMode='coding'

**第 2 步**: 路由化 session/project
- `/chat/session/:id` 加载特定 session
- `/coding/project/:id` 加载特定 project

**第 3 步**: 嵌套布局
- ChatLayout 包含 Sidebar + 头部
- CodingLayout 包含 FileExplorer + 头部

**第 4 步**: 懒加载 + 错误边界

### 3.3 类型安全路由

```typescript
// types/routes.ts
export interface ChatParams {
  sessionId: string;
}
export interface CodingParams {
  projectId: string;
}
export interface FileParams extends CodingParams {
  '*': string;  // 路径通配符
}

// 使用
const { sessionId } = useParams<ChatParams>();
```

---

## 四、API 设计

### 4.1 新增文件

| 文件 | 用途 | 行数估算 |
|------|------|----------|
| `frontend/src/router/router.tsx` | 路由配置 | ~80 |
| `frontend/src/router/types.ts` | 类型定义 | ~30 |
| `frontend/src/pages/RootLayout.tsx` | 根布局 | ~50 |
| `frontend/src/pages/ModeSelectorPage.tsx` | 模式选择 | ~80 |
| `frontend/src/pages/ChatPage.tsx` | 聊天页 | ~100 |
| `frontend/src/pages/ChatHomePage.tsx` | 聊天首页 | ~50 |
| `frontend/src/pages/NewChatPage.tsx` | 新建聊天 | ~60 |
| `frontend/src/pages/CodingPage.tsx` | 编程页 | ~100 |
| `frontend/src/pages/CodingHomePage.tsx` | 编程首页 | ~50 |
| `frontend/src/pages/NewProjectPage.tsx` | 新建项目 | ~60 |
| `frontend/src/pages/ProjectWorkspacePage.tsx` | 项目工作区 | ~150 |
| `frontend/src/pages/SettingsPage.tsx` | 设置页 | ~50 |
| `frontend/src/pages/WorkflowDetailPage.tsx` | 工作流详情 | ~50 |
| `frontend/src/pages/ErrorPage.tsx` | 错误页 | ~30 |

### 4.2 修改文件

| 文件 | 修改 |
|------|------|
| `frontend/src/main.tsx` | 改用 `RouterProvider` |
| `frontend/src/App.tsx` | 移除 appMode state,改为只渲染 RootLayout |
| `frontend/src/AppRouter.tsx` | 重新定义为路由配置导出 |
| `frontend/src/components/AppLayout.tsx` | 适配嵌套布局 (增加 Outlet) |
| `frontend/src/components/BrandHeader.tsx` | 增加基于 location 的导航高亮 |

---

## 五、测试验证

### 5.1 单元测试 (目标 30+)

- 路由配置正确性 (5)
- 嵌套布局 Outlet 渲染 (5)
- 类型安全 useParams (5)
- 错误边界 (3)
- 懒加载 (3)
- 浏览器前进/后退 (4)
- 深链接 (3)
- URL 参数同步 (2)

### 5.2 E2E 测试 (目标 20+)

- 访问 `/` 显示模式选择
- 访问 `/chat` 进入聊天模式
- 访问 `/coding/project/123` 加载项目 123
- 浏览器后退 → `/chat` 切换
- 浏览器前进 → 回到 `/coding`
- 直接刷新 `/chat/session/abc` 保持状态
- 复制 URL 分享给同事 → 同事打开相同视图
- 错误路径 `/xyz` 显示 404

### 5.3 集成测试

- 路由切换时 useModals 状态保持
- WebSocket 连接不因路由切换断开
- 文件浏览器状态不丢失

---

## 六、验收标准

- [ ] 所有 8 个测试维度通过
- [ ] TypeScript 编译 0 错误
- [ ] Vite 构建成功
- [ ] 浏览器前进/后退正常
- [ ] URL 可分享 (复制粘贴打开相同视图)
- [ ] 刷新页面不丢失状态
- [ ] 嵌套布局正确继承父级 UI
- [ ] 懒加载生效 (首屏 bundle 减小)
- [ ] 错误边界捕获路由错误

---

## 七、风险评估

### 7.1 高风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 破坏现有功能 | 全部 16 个面板失效 | 渐进式迁移,保留 useModals |
| 路由冲突 | 浏览器 URL 不匹配 | 添加 backward compat 路由 |
| 状态丢失 | 刷新导致数据丢失 | URL 持久化关键状态 |

### 7.2 中风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 性能下降 | 首屏变慢 | 懒加载非首屏页面 |
| 类型推导 | TypeScript 错误 | 显式声明 Param 类型 |

### 7.3 低风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 文档不全 | 上手困难 | 完整 README + JSDoc |

---

## 八、实施时间表

| 阶段 | 任务 | 时间估算 |
|------|------|----------|
| 阶段 1 | 创建 13 个页面骨架 | 30 min |
| 阶段 2 | 配置 router.tsx + 嵌套布局 | 30 min |
| 阶段 3 | main.tsx 切换到 RouterProvider | 15 min |
| 阶段 4 | App.tsx 移除 appMode state | 30 min |
| 阶段 5 | 单元测试 (30 个) | 45 min |
| 阶段 6 | E2E 测试 (20 个) | 45 min |
| 阶段 7 | 浏览器验证 + 集成测试 | 30 min |
| 阶段 8 | 总结报告 + Git 提交 | 20 min |

**总计**: ~4 小时

---

## 九、参考资源

- React Router v6 官方文档: https://reactrouter.com/
- createBrowserRouter API: https://reactrouter.com/api/data/createBrowserRouter
- Code Splitting 最佳实践: https://reactrouter.com/en/main/route/lazy
- 类型化 useParams: https://github.com/remix-run/react-router/issues/8202
