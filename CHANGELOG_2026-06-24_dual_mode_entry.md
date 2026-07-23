# 调度平台前端 - 双模式入口实现日志

## 版本
v3.0.0 - 双模式入口（chat / coding）

## 变更概述
为调度平台前端新增「日常办公闲聊」/「编程模式」双模式入口机制：
- 首次访问显示 ModeSelector 模式选择页
- 模式通过 localStorage 持久化，刷新后直接进入
- Sidebar 顶部新增模式切换 pill 按钮
- BrandHeader 显示当前模式指示器
- 聊天模式简化：隐藏 PlanViewer，跳过优化逻辑

## 修改文件清单

### 1. 新建文件

| 文件 | 说明 |
|------|------|
| `frontend/src/components/ModeSelector.tsx` | 模式选择器组件：双卡片（聊天/编程），暗色主题，hover 光晕效果 |

### 2. 修改文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/types/index.ts` | 新增字段 | Session 接口新增 `mode: 'chat' \| 'coding'` |
| `frontend/src/hooks/useApi.ts` | 参数扩展 | useSessions 新增 mode 参数追加 &mode= 查询；createSession 新增 mode 入参 |
| `frontend/src/components/Sidebar.tsx` | 新增功能 | 新增 appMode/onModeSwitch props；顶部模式切换 pill 按钮；sessions 按 mode 过滤 |
| `frontend/src/components/BrandHeader.tsx` | 新增功能 | 新增 appMode prop；标题旁显示模式指示器 pill |
| `frontend/src/App.tsx` | 架构重构 | 新增 appMode 状态管理 + localStorage 持久化；ModeSelector 条件渲染；handleModeSelect/handleModeSwitch 回调；聊天模式禁用优化流程 |

## 核心变更详情

### types/index.ts
- Session 新增 `mode: 'chat' | 'coding'` 字段（v1.6.0）

### useApi.ts (v1.8.0)
- `useSessions(status?, mode?)`: 新增 mode 参数，传入后追加 `&mode=` 查询参数
- `createSession(payload?)`: payload 新增 `mode?: 'chat' | 'coding'` 可选字段

### ModeSelector.tsx
- 全屏居中布局，暗色表面背景
- 两张卡片：💬 日常办公闲聊（蓝紫色调） / ⚡ 编程模式（Hermes 金橙色）
- hover 上浮 + 光晕效果 + 描述文案
- 点击触发 `onSelect(mode)` 回调

### Sidebar.tsx (v1.3.0)
- Props 新增 `appMode: 'chat' | 'coding'` 和 `onModeSwitch: (mode) => void`
- 顶部（搜索框上方/折叠态导航区）新增两个 mode pill 按钮
- 激活态使用 `bg-hermes-500 text-white shadow-glow-hermes-sm`
- 展开态显示「💬 聊天」「⚡ 编程」文字 + emoji
- 折叠态仅显示 emoji（圆形按钮）
- filteredSessions 按 `session.mode === appMode` 过滤

### BrandHeader.tsx (v1.1.0)
- Props 新增可选 `appMode?: 'chat' | 'coding'`
- 标题右侧显示模式指示器 pill：
  - 聊天模式：蓝紫色调 + 💬 日常办公闲聊
  - 编程模式：Hermes 金橙色 + ⚡ 编程模式
- 仅 md+ 屏幕显示，移动端隐藏

### App.tsx (v3.0.0)
- 新增状态：`const [appMode, setAppMode] = useState<'chat' | 'coding' | null>(null)`
- 启动时检查 `localStorage.getItem('app_mode')`
  - 有值 → 设置 appMode → 加载对应模式会话列表
  - 无值 → appMode=null → 渲染 ModeSelector
- `useSessions('active', appMode ?? undefined)`：模式变更自动 refetch 过滤列表
- `handleModeSelect(mode)`: ModeSelector 选择后写入 localStorage + setAppMode
- `handleModeSwitch(mode)`: Sidebar 切换后写入 localStorage + setAppMode + 清空当前会话
- `handleNewTask`: 创建时传入 `{ mode: appMode }`
- `handleOptimize`: 聊天模式下显示 warning toast 并跳过
- PlanViewer 仅在 `appMode === 'coding'` 时渲染
- Sidebar 透传 `appMode` + `onModeSwitch`
- BrandHeader 透传 `appMode`

## 测试结果

```
npm run build → tsc -b && vite build
vite v6.4.3 building for production...
✓ 39 modules transformed.
✓ built in 804ms
```

编译通过，无 TypeScript 类型错误，无 JSX 语法错误。

## 注意事项
- 构建需使用 Node.js >= 18（当前系统默认 v12，需通过 nvm use 24 切换）
- 后端需同步支持 Session mode 字段和 `?mode=` 查询参数过滤
- 首次访问无 localStorage 记录时显示 ModeSelector 选择页
