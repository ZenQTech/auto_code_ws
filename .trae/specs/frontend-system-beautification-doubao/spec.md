# 前端系统美化（豆包风格对齐）Spec

## Why
已完成 `frontend-beautification`（v1.0.0，2026-06-17 配色替换为 Hermes 金橙）和 `visual-polish-and-motion`（v1.0.0，2026-06-23 光影 / hover / 过渡动画）两个 spec，但仍存在**与豆包等业界成熟 AI 对话产品的视觉差距**：① 品牌启动缺一个精致的欢迎/空态页；② 顶部 Header 信息密度过高（Logo + 标题 + 多个按钮）；③ 消息气泡缺乏"用户侧"渐变光感与"AI 侧"极简白色卡片对比；④ 缺乏 hover 浮现的工具栏（复制 / 重新生成 / 点赞 / 点踩 / 朗读）；⑤ 输入区未采用**贴底浮动**布局（豆包标志性特征：内容上滚时输入区吸附底栏、消息区被推上去）；⑥ 侧边栏折叠后图标风格与展开态不统一；⑦ 字体字号偏小、字重偏弱，缺中英文双语规范。本 spec **不重做配色体系**（保持 Hermes 金橙主色），专注**视觉细节与交互逻辑**对齐豆包"暖色 + 大圆角 + 柔和阴影 + 极简 + 浮动"的整体风格，全面提升精致度与可读性。

## What Changes
- **新增启动欢迎页**：首次打开显示 Hermes 品牌欢迎插画（基于平台自身调性的 SVG）+ 4 个快速入口卡片（写代码 / 翻译 / 总结 / 闲聊）+ 底部"今天想做什么？"提示
- **顶部 BrandHeader 极简化**：Logo + 居中标题 + 右侧仅一个"新建对话"图标按钮（其他动作移到下拉菜单 / 隐藏到 hover 浮现）
- **侧边栏视觉升级**：折叠态图标背景渐变 + 悬浮提示，展开态 session 项 hover 出现「重命名 / 归档 / 删除」行内小图标
- **消息气泡视觉打磨**：
  - 用户消息：暖橙渐变背景（`from-hermes-50 to-hermes-100`）+ 浅边框 + 圆角 `rounded-2xl`
  - AI 消息：白色 / 浅灰背景卡片 + 左侧 4px Hermes 色竖条 + 内部 Markdown 排版优化
  - hover 消息时**顶部浮出工具栏**：复制 / 重新生成 / 点赞 / 点踩 / 朗读
- **输入区贴底浮动布局**：脱离主内容流，固定在视口底部 24px 处，圆角 `rounded-3xl`，玻璃拟态背景，阴影 `shadow-level-3`，宽度上限 `max-w-3xl` 居中
- **空态 / 加载态 / 错误态统一**：欢迎插画 + 温和提示文案 + 主操作按钮（参考豆包"网络似乎不给力"风格）
- **字体排版规范化**：中文用系统默认（PingFang SC / 思源黑体），英文用 Inter；正文字号 `text-[15px]`、行高 `leading-7`、字间距 `tracking-normal`；标题分级 `text-2xl / text-xl / text-lg / text-base / text-sm / text-xs`
- **微交互统一**：所有按钮/卡片 hover 150ms 浮起 + 阴影增强，active 100ms 按下，focus 200ms 光环（已部分实现，需补齐）
- **构建验证**：后端启动 + 前端 build 0 错 0 警

## Impact
- Affected specs: `frontend-beautification`（**MODIFIED**）、`visual-polish-and-motion`（**MODIFIED**）
- Affected code:
  - **前端**：
    - `frontend/src/App.tsx` — v2.9.0：新增 WelcomeState 组件（空态），BrandHeader 极简化，输入区贴底浮动布局
    - `frontend/src/index.css` — v1.7.0：新增字体规范、消息气泡样式、工具栏浮现动画、贴底浮动布局工具类
    - `frontend/src/components/Sidebar.tsx` — v1.2.0：折叠态图标渐变背景、hover 提示、行内操作图标
    - `frontend/src/components/SessionListItem.tsx` — v1.2.0：行内 hover 操作图标（重命名 / 归档 / 删除）
    - `frontend/src/components/MessageBubble.tsx`（**新建**）— 消息气泡组件（用户 / AI 两种样式 + hover 工具栏）
    - `frontend/src/components/WelcomeState.tsx`（**新建**）— 启动欢迎页
    - `frontend/src/components/BrandHeader.tsx`（**新建**）— 极简顶部品牌栏（从 App.tsx 抽出）
    - `frontend/tailwind.config.js` — v1.2.0：补充 `from-hermes-50 to-hermes-100` 渐变、`tracking-normal` 字间距、动画 `message-toolbar-in`
- **向后兼容**：所有已有功能（侧边栏 / 用量面板 / 历史会话 / 自动截取 title 等）保留
- **零后端变更**：纯前端视觉与交互

---

## ADDED Requirements

### Requirement: 启动欢迎页
系统 SHALL 在用户首次打开 / 新建空 Session 时显示欢迎页，提供快速入口与品牌呈现。

#### Scenario: 欢迎页布局
- **WHEN** 当前 Session `message_count === 0`（无消息）
- **THEN** 主对话区显示 WelcomeState 组件，**不**显示空白对话流
- **AND** 包含四要素：① 顶部 Hermes 品牌插画（SVG，自绘或基于渐变圆形 + 闪电）；② 问候语"你好，我是 Hermes"（text-2xl font-semibold）；③ 副标题"基于 Claude Code 的智能体调度助手"（text-sm text-surface-500）；④ 4 个快速入口卡片（写代码 / 翻译 / 总结 / 闲聊），点击自动填入输入框

#### Scenario: 快速入口卡片
- **WHEN** 用户点击快速入口卡片
- **THEN** 该卡片的 prompt 自动填入底部输入框（setInputValue）
- **AND** 输入框获得焦点（inputRef.current?.focus()）
- **AND** 卡片自身应用 `active:scale-95` 反馈动画

#### Scenario: 渐入动画
- **WHEN** WelcomeState 首次挂载
- **THEN** 整体应用 `animate-fade-in-up`（已在 visual-polish-and-motion 中定义）
- **AND** 4 个快速入口卡片按 80ms 间隔依次出现（CSS `animation-delay` 阶梯）

---

### Requirement: 顶部 BrandHeader 极简化
系统 SHALL 提供极简的顶部品牌栏，遵循豆包式信息密度。

#### Scenario: 顶部布局
- **WHEN** 用户打开应用
- **THEN** BrandHeader 包含：左侧 Logo（圆形渐变背景 + 闪电图标）、中间 Session 标题（text-base font-medium）、右侧新建对话图标按钮（圆形 + hover 旋转 90°）
- **AND** 原"用量监控"按钮、"设置"按钮、"回收站"按钮等次要操作**移到 BrandHeader 右侧下拉菜单**（`...` 三个点图标 + 弹出 Popover）
- **AND** BrandHeader 高度固定 56px（`h-14`），背景半透明（`bg-white/80 backdrop-blur`），底部 1px Hermes 浅色边

#### Scenario: 移动端响应
- **WHEN** 视口宽度 < 768px
- **THEN** BrandHeader 隐藏中间标题
- **AND** Logo + 新建按钮 + 下拉菜单保留

---

### Requirement: 消息气泡视觉打磨
系统 SHALL 提供用户消息与 AI 消息两种视觉风格，遵循豆包对比设计。

#### Scenario: 用户消息气泡
- **WHEN** 渲染用户消息
- **THEN** 应用样式：
  - 背景：`bg-gradient-to-br from-hermes-50 to-hermes-100`（暖橙渐变）
  - 边框：`border border-hermes-200/60`
  - 圆角：`rounded-2xl`
  - 阴影：`shadow-level-1`
  - 文字：`text-surface-900`
  - 最大宽度：`max-w-2xl`
  - 对齐：右对齐（`ml-auto`）
- **AND** hover 时阴影升级为 `shadow-level-2`（transition 200ms）

#### Scenario: AI 消息气泡
- **WHEN** 渲染 AI 消息
- **THEN** 应用样式：
  - 背景：`bg-white` 或 `bg-surface-50`
  - 左侧 4px Hermes 色竖条：`border-l-4 border-hermes-400`
  - 圆角：`rounded-2xl`
  - 阴影：`shadow-level-1`
  - 文字：`text-surface-800`
  - 最大宽度：`max-w-3xl`
  - 对齐：左对齐
- **AND** 内部 Markdown 渲染：标题分级清晰、列表有项目符号、代码块有 Hermes 配色背景

#### Scenario: hover 工具栏浮现
- **WHEN** 鼠标 hover 消息气泡
- **THEN** 消息气泡**顶部上方**浮出工具栏（absolute -top-3 right-4），背景 `bg-white` 圆角 `rounded-full` 阴影 `shadow-level-2`
- **AND** 工具栏包含 5 个图标按钮：复制（Copy） / 重新生成（RefreshCw） / 点赞（ThumbsUp） / 点踩（ThumbsDown） / 朗读（Volume2）
- **AND** 工具栏出现动画：`animate-fade-in`（150ms），消失延迟 300ms
- **AND** **未实现完整功能时**：复制按钮接入 navigator.clipboard.writeMessage；其他按钮 console.log 占位即可（后续 Task 扩展）

---

### Requirement: 输入区贴底浮动布局
系统 SHALL 提供豆包式贴底浮动输入区，区别于固定在主区底部的传统布局。

#### Scenario: 浮动输入区布局
- **WHEN** 用户打开应用
- **THEN** 输入区**脱离主内容流**，固定在视口底部 24px 处（`fixed bottom-6 left-0 right-0`）
- **AND** 输入框容器宽度 `max-w-3xl mx-auto`，左右内边距对称
- **AND** 输入框容器样式：
  - 圆角：`rounded-3xl`
  - 背景：`bg-white/90 backdrop-blur-md`（玻璃拟态）
  - 边框：`border border-surface-200`
  - 阴影：`shadow-level-3`
  - 内边距：`px-4 py-3`
- **AND** 输入框为 textarea auto-resize，焦点时阴影升级为 `shadow-glow-hermes`

#### Scenario: 内容上推
- **WHEN** 主对话区内容超过视口
- **THEN** 对话流底部 padding-bottom 至少 160px（`pb-40`），确保最后一条消息不被输入区遮挡
- **AND** 浮动输入区在所有内容之上（`z-50`）

#### Scenario: 发送中状态
- **WHEN** 消息正在发送 / 流式接收
- **THEN** 发送按钮变为"停止"图标（Square），点击触发 `handleStop`（已存在的占位即可）
- **AND** 输入框禁用，`opacity-60`

---

### Requirement: 侧边栏视觉升级
系统 SHALL 提供与豆包折叠风格一致的侧边栏体验。

#### Scenario: 折叠态图标
- **WHEN** 侧边栏折叠（64px 宽）
- **THEN** Logo 与功能图标背景应用 `bg-gradient-to-br from-hermes-50 to-hermes-100` 圆形（w-10 h-10 rounded-full）
- **AND** 每个图标 hover 时显示 Tooltip（在右侧浮出，"新建对话" / "设置" / "回收站"）
- **AND** 激活的 Session 图标（金橙边框高亮）

#### Scenario: 展开态行内操作
- **WHEN** 侧边栏展开（320px）且用户 hover 某个 SessionListItem
- **THEN** 该项右侧浮出 3 个小图标按钮：重命名（Edit2） / 归档（Archive） / 删除（Trash2）
- **AND** 图标按钮 hover 反馈：scale 1.1 + 颜色变 Hermes 主色
- **AND** 点击图标不触发项的 onClick（stopPropagation）

#### Scenario: 重命名交互
- **WHEN** 用户点击重命名图标
- **THEN** SessionListItem 内的 title 切换为 inline input 框（autoFocus，Enter 保存，Esc 取消）
- **AND** 保存时调 `updateSession(id, { title: newTitle })`
- **AND** 失败时 console.warn 并恢复原 title

---

### Requirement: 空态 / 加载态 / 错误态统一
系统 SHALL 在三种状态下显示统一的视觉提示组件。

#### Scenario: 空态（已通过 WelcomeState 覆盖）
- **WHEN** 无消息时
- **THEN** 显示 WelcomeState（见 Requirement 1）

#### Scenario: 加载态
- **WHEN** 后端流式响应未到首个字符
- **THEN** AI 消息占位符显示呼吸圆点动画（已在 visual-polish-and-motion 中实现 `breathing-highlight`）
- **AND** 占位符骨架：`bg-surface-100 rounded-2xl h-20 animate-pulse`

#### Scenario: 错误态
- **WHEN** 流式响应失败（如 429 限流 / 网络错误）
- **THEN** 显示 Toast（已实现）+ 对话流中显示错误卡片：左侧红色竖条 + 错误文案 + "重新发送"按钮
- **AND** 错误卡片样式：`border-l-4 border-red-400 bg-red-50 text-red-700 rounded-2xl p-4`

---

### Requirement: 字体排版规范化
系统 SHALL 提供全局字体规范，覆盖中英文与多级字号。

#### Scenario: 字体栈
- **WHEN** 渲染任意文本
- **THEN** 应用字体栈：`font-sans` = `Inter, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif`
- **AND** 标题/正文/小字使用 `text-base / text-sm / text-xs` 阶梯
- **AND** 正文字号 `text-[15px]`（豆包式），行高 `leading-7`，字间距 `tracking-normal`

#### Scenario: 标题分级
- **WHEN** 渲染标题
- **THEN** 应用：
  - 一级标题（h1）：`text-2xl font-semibold`
  - 二级标题（h2）：`text-xl font-semibold`
  - 三级标题（h3）：`text-lg font-medium`
  - 正文（p）：`text-[15px] font-normal leading-7`
  - 辅助文字（caption）：`text-xs text-surface-500`

---

### Requirement: 微交互统一
系统 SHALL 统一所有按钮/卡片的 hover / active / focus 反馈时序。

#### Scenario: hover 反馈
- **WHEN** 鼠标 hover 按钮 / 卡片
- **THEN** 150ms 内：`transform: translateY(-2px)` + `shadow: shadow-level-2`（已部分实现，需补齐到所有交互元素）

#### Scenario: active 反馈
- **WHEN** 鼠标按下按钮
- **THEN** 100ms 内：`transform: scale(0.97)`

#### Scenario: focus 反馈
- **WHEN** 输入框 / 按钮获得焦点
- **THEN** 200ms 内显示光环：`box-shadow: 0 0 0 3px rgba(240, 160, 48, 0.2)`（已部分实现）

---

## MODIFIED Requirements

### Requirement: 配色与令牌体系（来自 frontend-beautification）
平台 SHALL 继续使用 Hermes 金橙主色 + surface 灰阶，**不**重新调色。本 spec 仅在已有令牌基础上**应用**新样式类（如 `from-hermes-50 to-hermes-100` 渐变），不引入新色值。

#### Scenario: 已有令牌保持
- **WHEN** 本 spec 完成
- **THEN** `tailwind.config.js` 的 colors 区块**不**新增任何 hex 颜色
- **AND** 仅在 `backgroundImage` 区块追加 `hermes-gradient: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%)` 一个值（如尚未存在）

---

### Requirement: 视觉品质与动效体系（来自 visual-polish-and-motion）
平台 SHALL 在已有动效体系上**补齐**新动画（`message-toolbar-in` 工具栏浮现），**不**重做现有动效。

#### Scenario: 动效补齐
- **WHEN** 本 spec 完成
- **THEN** `index.css` / `tailwind.config.js` 新增 `@keyframes message-toolbar-in`（fade-in 150ms + translateY 4px → 0）
- **AND** 现有 `lift-in` / `collapse-y` / `modal-in/out` / `toast-in` / `breathing-highlight` / `msg-enter` 保持不变

---

## REMOVED Requirements

无。本 spec 为增量改动，**不**删除已有功能或样式。

---

# 附录：豆包视觉风格参考要点（实现指引）

| 维度 | 豆包特征 | 本 spec 对应实现 |
|---|---|---|
| 顶部 | Logo + 居中标题 + 右侧下拉 | BrandHeader 极简化（64px 高，半透明背景）|
| 消息气泡 | 用户暖橙渐变 / AI 极简白卡 | MessageBubble 组件 + 渐变背景 + 左侧 4px 竖条 |
| 工具栏 | hover 浮出操作图标 | message-toolbar-in 动画 + 5 个图标按钮 |
| 输入区 | 贴底浮动 + 大圆角 + 玻璃 | fixed bottom-6 + rounded-3xl + backdrop-blur |
| 侧边栏 | 折叠后纯图标 + Tooltip | Sidebar 折叠态 64px + 圆形渐变背景 |
| 字体 | 中等字号（15px）+ 舒适行高 | text-[15px] leading-7 tracking-normal |
| 配色 | 暖橙 + 浅米白 | Hermes 金橙（保持）+ surface-50/100 灰阶 |
| 圆角 | 大圆角（20-24px）| rounded-2xl / rounded-3xl |
| 阴影 | 极淡（接近无）| shadow-level-1（已定义）|
