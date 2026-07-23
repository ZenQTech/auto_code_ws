# Tasks

- [x] Task 1: 字体与排版规范化
  - 1.1 在 `frontend/tailwind.config.js` v1.2.0 设置 `fontFamily.sans = ['Inter', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'system-ui', 'sans-serif']`
  - 1.2 在 `frontend/src/index.css` v1.7.0 引入 Inter 字体（Google Fonts CDN `<link>` 或本地化文件）
  - 1.3 设置全局正文 `body { font-size: 15px; line-height: 1.75; letter-spacing: 0; }`
  - 1.4 新增 CSS 类 `.text-h1` / `.text-h2` / `.text-h3` / `.text-body` / `.text-caption`

- [x] Task 2: WelcomeState 启动欢迎页
  - 2.1 新建 `frontend/src/components/WelcomeState.tsx`
  - 2.2 实现品牌插画（SVG 渐变圆形 + 闪电图标，Hermes 配色）
  - 2.3 实现 4 个快速入口卡片（写代码 / 翻译 / 总结 / 闲聊）
  - 2.4 卡片点击触发 `setInputValue` + `inputRef.current?.focus()`
  - 2.5 渐入动画 + 4 卡片 80ms 阶梯 delay
  - 2.6 文件头 v1.0.0 修改记录

- [x] Task 3: BrandHeader 极简顶部
  - 3.1 新建 `frontend/src/components/BrandHeader.tsx`（从 App.tsx 抽出顶部区域）
  - 3.2 包含：左侧 Logo（圆形渐变背景 + 闪电）+ 中间 Session 标题 + 右侧"新建对话"图标按钮（hover 旋转 90°）
  - 3.3 三个点下拉菜单（设置 / 回收站 / 用量监控）
  - 3.4 半透明背景 + backdrop-blur + 底部 1px 边
  - 3.5 移动端响应（< 768px 隐藏中间标题）
  - 3.6 App.tsx 引用 BrandHeader 替换原顶部区域
  - 3.7 文件头 v1.0.0（BrandHeader） / App.tsx v2.9.0

- [x] Task 4: MessageBubble 消息气泡组件
  - 4.1 新建 `frontend/src/components/MessageBubble.tsx`
  - 4.2 用户消息：暖橙渐变背景 + 浅边框 + rounded-2xl + shadow-level-1 + 右对齐
  - 4.3 AI 消息：白色背景 + 左侧 4px Hermes 竖条 + rounded-2xl + shadow-level-1 + 左对齐
  - 4.4 hover 工具栏：absolute -top-3 right-4 + 5 个图标按钮（复制 / 重新生成 / 点赞 / 点踩 / 朗读）
  - 4.5 工具栏出现动画 `animate-message-toolbar-in`（150ms）
  - 4.6 复制按钮接入 `navigator.clipboard.writeText(content)`
  - 4.7 文件头 v1.0.0 修改记录

- [x] Task 5: 贴底浮动输入区布局
  - 5.1 在 App.tsx 把输入区从主内容流抽出，包成 `fixed bottom-6 left-0 right-0 z-50` 容器
  - 5.2 输入框容器：`max-w-3xl mx-auto bg-white/90 backdrop-blur-md border border-surface-200 rounded-3xl shadow-level-3 px-4 py-3`
  - 5.3 主对话区 `pb-40` 留出空间
  - 5.4 焦点时阴影升级 `shadow-glow-hermes`
  - 5.5 发送中状态：发送按钮变停止图标（Square），点击触发 handleStop
  - 5.6 文件头 v2.9.0（App.tsx 改造输入区布局）

- [x] Task 6: Sidebar 视觉升级
  - 6.1 在 `frontend/src/components/Sidebar.tsx` v1.2.0 折叠态：图标背景 `bg-gradient-to-br from-hermes-50 to-hermes-100 w-10 h-10 rounded-full`
  - 6.2 折叠态图标 hover Tooltip（右侧浮出："新建对话" / "设置" / "回收站"）
  - 6.3 文件头 v1.2.0 修改记录

- [x] Task 7: SessionListItem 行内操作
  - 7.1 在 `frontend/src/components/SessionListItem.tsx` v1.2.0 hover 时右侧浮出 3 个小图标（重命名 / 归档 / 删除）
  - 7.2 图标按钮 hover：`scale 1.1 + color-hermes-500`
  - 7.3 点击图标 stopPropagation
  - 7.4 重命名交互：点击 Edit2 切换为 inline input（autoFocus / Enter 保存 / Esc 取消），调 `updateSession(id, { title: newTitle })`
  - 7.5 文件头 v1.2.0 修改记录

- [x] Task 8: 错误态视觉统一
  - 8.1 在 `frontend/src/index.css` v1.7.0 新增 `.error-card` 类（`border-l-4 border-red-400 bg-red-50 text-red-700 rounded-2xl p-4`）
  - 8.2 在 `MessageBubble` 或 `App.tsx` 流式错误分支渲染错误卡片 + "重新发送"按钮
  - 8.3 文件头 v1.7.0（index.css） / v1.0.0（MessageBubble 错误态）

- [x] Task 9: 微交互统一工具类
  - 9.1 在 `frontend/src/index.css` v1.7.0 完善 `.btn-hover-lift`（150ms translateY(-2px) + shadow-level-2）已部分存在
  - 9.2 完善 `.btn-active-press`（100ms scale(0.97)）已部分存在
  - 9.3 完善 `.focus-ring-hermes`（200ms box-shadow: 0 0 0 3px rgba(240, 160, 48, 0.2)）已部分存在
  - 9.4 在 `tailwind.config.js` v1.2.0 新增 `@keyframes message-toolbar-in`（fade-in 150ms + translateY(4px) → 0）
  - 9.5 文件头 v1.7.0（index.css） / v1.2.0（tailwind.config.js）

- [x] Task 10: 构建与回归验证
  - 10.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错 ✅
  - 10.2 前端 `npm run build` 无编译错误 ✅（38 modules / 798ms / 0 错 0 警，dist 292K）
  - 10.3 GUI 端到端：SKIPPED（sub-agent 无真实浏览器，仅 grep + 构建层验证）
  - 10.4 grep 验证无新增 hex 颜色值 ✅（colors 区块未新增；`hermes-gradient` 未添加，spec 允许跳过）

# Task Dependencies
- Task 1（字体）是全局基础，优先完成
- Task 2（WelcomeState）独立
- Task 3（BrandHeader）独立
- Task 4（MessageBubble）依赖 Task 1 字体规范
- Task 5（输入区贴底）独立
- Task 6（Sidebar）独立
- Task 7（SessionListItem 行内操作）依赖 Task 6
- Task 8（错误态）依赖 Task 4（MessageBubble 渲染错误）
- Task 9（微交互）独立
- Task 10（验证）依赖 Task 1-9 全部完成
