# Tasks

- [x] Task 1: ProjectSelector 返回入口
  - 1.1 在 `frontend/src/components/ProjectSelector.tsx` v2.10.0 → v2.10.1 的 Props 接口新增 `onBack?: () => void;` 和 `onSwitchToChat?: () => void;`
  - 1.2 组件顶部（标题"选择项目"上方）增加"← 返回模式选择"链接
  - 1.3 链接样式：`text-caption text-surface-500 hover:text-hermes-500 cursor-pointer`
  - 1.4 组件底部（两个大卡片下方）增加"💬 切换到聊天模式"次要按钮
  - 1.5 按钮样式：`text-sm text-surface-600 hover:text-hermes-500 underline`
  - 1.6 链接与按钮的 onClick 触发对应回调
  - 1.7 保留原有 onSelect 行为
  - 1.8 文件头 v2.10.1 修改记录：`# - 2026-06-24 | v2.10.1 | 新增"返回模式选择"链接 + "切换到聊天模式"按钮（onBack / onSwitchToChat 回调）`

- [x] Task 2: BrandHeader 模式切换 pill
  - 2.1 在 `frontend/src/components/BrandHeader.tsx` v1.1.0 → v1.2.0 的 Props 接口新增 `onSwitchMode?: () => void;`
  - 2.2 在 Session 标题旁渲染模式 pill：`appMode === 'chat' ? '💬 闲聊' : '⚡ 编程'`
  - 2.3 pill 样式：`text-xs px-2 py-0.5 rounded-full`，`bg-surface-100 text-surface-600`（chat）或 `bg-hermes-100 text-hermes-700`（coding）
  - 2.4 pill 鼠标 hover：`hover:scale-105 transition-transform` + cursor-pointer
  - 2.5 pill onClick → `props.onSwitchMode?.()`
  - 2.6 文件头 v1.2.0 修改记录：`# - 2026-06-24 | v1.2.0 | 渲染模式切换 pill（解决 BrandHeader appMode prop 未渲染问题）`

- [x] Task 3: App.tsx 模式切换回调
  - 3.1 在 `frontend/src/App.tsx` v2.10.1 → v2.10.2 新增 `handleBackToModeSelect` 回调：`setAppMode(null) + setSelectedProject(null) + setOpenedFile(null) + localStorage.removeItem('app_mode')`
  - 3.2 新增 `handleSwitchToChat` 回调：`setAppMode('chat') + localStorage.setItem('app_mode', 'chat')`，保留 selectedProject / openedFile / currentSessionId
  - 3.3 现有 `handleModeSelect` 与 `handleModeSwitch` 保留（**不修改**）
  - 3.4 新增 `handleSwitchMode` 切换 pill 回调：交替设置 chat / coding + 同步 localStorage
  - 3.5 ProjectSelector 接收 `onBack={handleBackToModeSelect}` + `onSwitchToChat={handleSwitchToChat}`
  - 3.6 BrandHeader 接收 `onSwitchMode={handleSwitchMode}`（已有 `appMode` prop 直接传）
  - 3.7 文件头 v2.10.2 修改记录：`# - 2026-06-24 | v2.10.2 | handleBackToModeSelect / handleSwitchToChat / handleSwitchMode + ProjectSelector/BrandHeader 透传`

- [x] Task 4: 构建与回归验证
  - [x] 4.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
  - [x] 4.2 前端 `npm run build` 无编译错误
  - [x] 4.3 grep 验证 ProjectSelector 已有 `onBack` + `onSwitchToChat` + "返回模式选择" + "切换到聊天模式"
  - [x] 4.4 grep 验证 BrandHeader 已有 `onSwitchMode` + 模式 pill 渲染
  - [x] 4.5 grep 验证 App.tsx 已有 `handleBackToModeSelect` / `handleSwitchToChat` / `handleSwitchMode`
  - [x] 4.6 GUI 端到端：编程模式无项目时 ProjectSelector 显示返回入口 / BrandHeader 顶部 pill 可见可切换 — **SKIPPED**（按 spec 跳过）

# Task Dependencies
- Task 1（ProjectSelector）独立
- Task 2（BrandHeader）独立
- Task 3（App.tsx 集成）依赖 Task 1 + 2
- Task 4（验证）依赖 Task 1-3 完成
