# 招呼语与浮动输入框对齐 Spec

## Why
刚完成的 `frontend-system-beautification-doubao` spec 实现了豆包风格的美化（启动欢迎页、贴底浮动输入区、BrandHeader 等），但用户实测发现两个细节问题：① 招呼语措辞仍使用"基于 Claude Code 的智能体调度助手"，未突出"智能体调度平台"的核心定位与"基于 Hermes 内核"的技术根基，且缺少引导式提问；② 浮动输入区采用 `position: fixed; left-0; right-0; mx-auto; max-w-3xl` 的 viewport 居中策略，**当左侧 Sidebar 展开 320px 时，主内容区被向右推 320px，但浮动输入区仍以 viewport 为轴心居中，导致输入框与主区对话标题/消息气泡产生 160px 视觉错位**（截图实测）。两项调整均为**纯前端视觉微调**，不改业务逻辑、不改数据流。

## What Changes
- **更新 WelcomeState 招呼语文案**：主标题"你好，我是 Hermes" → "你好，我是智能体调度平台"；副标题"基于 Claude Code 的智能体调度助手" → "基于 Hermes 内核"；**新增第三行引导式提问**"今天需要我为你做些什么吗？"（与原英文品牌名 Hermes 保持产品名一致性但定位为"平台"而非单一个体）
- **重构浮动输入区对齐方式**：从 `position: fixed; left-0; right-0; mx-auto` 改为**主内容区内部**的 `mt-auto` 推到底部 + `max-w-3xl mx-auto`，让输入区宽度跟随主区（与 BrandHeader / 对话流 / 子 CLI 实例卡片**视觉对齐**），同时保留玻璃拟态、阴影、焦点光环等所有已有交互特性
- **零后端变更**

## Impact
- Affected specs: `frontend-system-beautification-doubao`（**MODIFIED** — 招呼语 + 输入区对齐）
- Affected code:
  - `frontend/src/components/WelcomeState.tsx` — v1.0.0 → v1.1.0：招呼语文案 + 新增第三行
  - `frontend/src/App.tsx` — v2.9.2 → v2.9.3：浮动输入区从 `fixed bottom-6 left-0 right-0` 改为**主区 flex 容器内**的 `mt-auto`

---

## MODIFIED Requirements

### Requirement: WelcomeState 招呼语（来自 frontend-system-beautification-doubao）
WelcomeState SHALL 显示三行文案：主标题"你好，我是智能体调度平台"、副标题"基于 Hermes 内核"、引导提问"今天需要我为你做些什么吗？"。

#### Scenario: 三行文案布局
- **WHEN** 渲染 WelcomeState
- **THEN** 显示三行结构化文案（按以下顺序）：
  1. **主标题**："你好，我是智能体调度平台"（`text-h1 text-surface-900`）
  2. **副标题**："基于 Hermes 内核"（`text-caption text-surface-500`）
  3. **引导提问**："今天需要我为你做些什么吗？"（`text-body text-surface-600`，与主标题 `mb-8` 间距）
- **AND** 三行之间保持视觉呼吸：`主标题 mb-2`，`副标题 mb-3`，`引导提问 mb-12`
- **AND** 文案**不**再含"Claude Code"字样（与产品定位"基于 Hermes 内核"统一）

#### Scenario: 移动端响应
- **WHEN** 视口宽度 < 640px
- **THEN** 三行文案均保留（不隐藏），主标题字号降级为 `text-xl`（视情况可用 `text-h1` 的 `md:text-h1` 形式）
- **AND** 行间距保持

---

### Requirement: 浮动输入区对齐方式（来自 frontend-system-beautification-doubao）
浮动输入区 SHALL **跟随主内容区宽度**而非 viewport 居中，确保 Sidebar 展开/折叠时输入框与 BrandHeader 标题/消息气泡**垂直对齐**。

#### Scenario: Sidebar 展开时（320px）
- **WHEN** 侧边栏展开（320px）
- **THEN** 浮动输入区**主区左对齐** + `max-w-3xl mx-auto` 居中
- **AND** 输入框**左右边缘**与 BrandHeader 中间 Session 标题的左右边缘**视觉对齐**
- **AND** 输入框**左右边缘**与消息流中 AI 消息气泡（`max-w-3xl`）的左右边缘**视觉对齐**

#### Scenario: Sidebar 折叠时（64px）
- **WHEN** 侧边栏折叠（64px）
- **THEN** 浮动输入区仍在主区内部（主区占满剩余空间）
- **AND** 主区因 sidebar 缩小 256px 而向右扩展 256px
- **AND** 输入框仍 `max-w-3xl mx-auto` 居中于主区
- **AND** 输入框与 BrandHeader / 消息流**依然对齐**

#### Scenario: 滚动行为
- **WHEN** 用户向下滚动消息流
- **THEN** 浮动输入区**始终贴主区底部**（不滚出主区）
- **AND** 浮动输入区**不**遮挡主区底部 padding 区域（消息流 `pb-32` 仍生效）
- **AND** BrandHeader 仍 `sticky top-0`（已实现，不变）

#### Scenario: 玻璃拟态 / 阴影 / 焦点特性保持
- **WHEN** 重构输入区位置后
- **THEN** 保留所有视觉特性：
  - 玻璃拟态：`bg-white/90 backdrop-blur-md`
  - 圆角：`rounded-3xl`
  - 阴影：`shadow-level-3`
  - 焦点光环：`focus-within:shadow-glow-hermes focus-within:border-hermes-300`
  - 发送/停止按钮：`bg-gradient-to-br from-hermes-500 to-hermes-600`
  - 发送中切换 Square 图标 + 触发 `handleStop`（已实现）

---

## REMOVED Requirements

### Requirement: viewport fixed 居中策略
**Reason**：viewport 居中导致 Sidebar 展开时输入框与主区对话标题/消息气泡产生 160px 视觉错位，破坏视觉一致性。

**Migration**：从 `position: fixed; left-0; right-0; max-w-3xl mx-auto; bottom-6` 改为**主区 flex 容器内部**的 `mt-auto; max-w-3xl mx-auto; relative`。

迁移要点：
- 移除外层 `fixed bottom-6 left-0 right-0 z-50 px-4 pointer-events-none` 容器
- 新位置：紧跟在 `{displayAgents.length > 0 && <div>...</div>}` 之后，作为主区 flex 容器的最后一个子元素
- 容器类：`mt-auto px-4`（`mt-auto` 推到底部；`px-4` 保持左右内边距）
- 内部保留 `max-w-3xl mx-auto pointer-events-auto` + 玻璃拟态面板
