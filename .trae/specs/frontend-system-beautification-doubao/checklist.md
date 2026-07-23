# Checklist

## Task 1 — 字体与排版规范化
- [x] `tailwind.config.js` `fontFamily.sans` 已设置包含 Inter / PingFang SC / Microsoft YaHei / system-ui
- [x] `index.css` 已引入 Inter 字体（CDN `<link>` 或本地化）
- [x] `body` 全局 `font-size: 15px; line-height: 1.75; letter-spacing: 0`
- [x] 新增 `.text-h1` / `.text-h2` / `.text-h3` / `.text-body` / `.text-caption` 工具类

## Task 2 — WelcomeState 启动欢迎页
- [x] `frontend/src/components/WelcomeState.tsx` 已新建
- [x] 品牌插画（SVG 渐变圆形 + 闪电图标，Hermes 配色）
- [x] 4 个快速入口卡片（写代码 / 翻译 / 总结 / 闲聊）
- [x] 卡片点击触发 `setInputValue` + `inputRef.current?.focus()`
- [x] 渐入动画 + 4 卡片 80ms 阶梯 delay
- [x] 文件头 v1.0.0 修改记录已写入

## Task 3 — BrandHeader 极简顶部
- [x] `frontend/src/components/BrandHeader.tsx` 已新建
- [x] 左侧 Logo（圆形渐变背景 + 闪电）+ 中间 Session 标题 + 右侧"新建对话"图标按钮
- [x] 三个点下拉菜单（设置 / 回收站 / 用量监控）
- [x] 半透明背景 + backdrop-blur + 底部 1px 边
- [x] 移动端响应（< 768px 隐藏中间标题）
- [x] App.tsx 引用 BrandHeader 替换原顶部区域
- [x] 文件头 v1.0.0（BrandHeader） / App.tsx v2.9.0

## Task 4 — MessageBubble 消息气泡组件
- [x] `frontend/src/components/MessageBubble.tsx` 已新建
- [x] 用户消息：暖橙渐变 + 浅边框 + rounded-2xl + shadow-level-1 + 右对齐
- [x] AI 消息：白色 + 左侧 4px Hermes 竖条 + rounded-2xl + shadow-level-1 + 左对齐
- [x] hover 工具栏：absolute -top-3 right-4 + 5 个图标按钮
- [x] 工具栏出现动画 `animate-message-toolbar-in`（150ms）
- [x] 复制按钮接入 `navigator.clipboard.writeText(content)`
- [x] 文件头 v1.0.0 修改记录已写入

## Task 5 — 贴底浮动输入区布局
- [x] App.tsx 输入区已抽成 `fixed bottom-6 left-0 right-0 z-50` 容器
- [x] 输入框容器：`max-w-3xl mx-auto bg-white/90 backdrop-blur-md border border-surface-200 rounded-3xl shadow-level-3 px-4 py-3`
- [x] 主对话区 `pb-40` 留出空间
- [x] 焦点时阴影升级 `shadow-glow-hermes`
- [x] 发送中状态：发送按钮变停止图标（Square）
- [x] 文件头 v2.9.0（App.tsx 改造）

## Task 6 — Sidebar 视觉升级
- [x] `Sidebar.tsx` v1.2.0 折叠态：图标背景 `bg-gradient-to-br from-hermes-50 to-hermes-100 w-10 h-10 rounded-full`
- [x] 折叠态图标 hover Tooltip（右侧浮出）
- [x] 文件头 v1.2.0 修改记录已写入

## Task 7 — SessionListItem 行内操作
- [x] `SessionListItem.tsx` v1.2.0 hover 时右侧浮出 3 个小图标（重命名 / 归档 / 删除）
- [x] 图标按钮 hover：`scale 1.1 + color-hermes-500`
- [x] 点击图标 stopPropagation
- [x] 重命名交互：点击 Edit2 切换为 inline input + 调 `updateSession`
- [x] 文件头 v1.2.0 修改记录已写入

## Task 8 — 错误态视觉统一
- [x] `index.css` v1.7.0 新增 `.error-card` 类
- [x] 流式错误分支渲染错误卡片 + "重新发送"按钮（MessageBubble + App.tsx 流式错误分支）
- [x] 文件头 v1.7.0（index.css） / v1.0.0（MessageBubble 错误态）

## Task 9 — 微交互统一工具类
- [x] `index.css` v1.7.0 完善 `.btn-hover-lift` / `.btn-active-press` / `.focus-ring-hermes`
- [x] `tailwind.config.js` v1.2.0 新增 `@keyframes message-toolbar-in`
- [x] 文件头 v1.7.0（index.css） / v1.2.0（tailwind.config.js）

## Task 10 — 构建与回归
- [x] 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
- [x] 前端 `npm run build` 无编译错误
- [ ] GUI 端到端：启动页 / 消息气泡 hover 工具栏 / 输入区贴底 / 错误态卡片（SKIPPED — sub-agent 无真实浏览器）
- [x] grep 验证无新增 hex 颜色值（仅 `hermes-gradient` 渐变值未添加，spec 允许跳过）
