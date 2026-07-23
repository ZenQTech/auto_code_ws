# 删除 4 建议框 + 文件浏览器开关 Spec

## Why
刚完成的 `welcome-greeting-and-input-alignment` spec 实现了三行招呼语 + 4 个快速入口卡片（写代码/翻译/总结/闲聊），用户实测认为**进入编程模式后 4 建议框已无价值**：① 编程模式用户已有明确任务（让 AI 写代码），"写代码"建议框是冗余；② 翻译/总结/闲聊建议与编程场景无关，干扰信息密度；③ 4 张卡片占据主区大量纵向空间，挤压 BrandHeader 与消息流视觉权重。**第二项**：FileExplorer 已存在但**无关闭入口**，用户需要"暂时隐藏"文件树（聚焦对话/代码区）时只能滚动或切换项目，需要**显式关闭按钮**与**重新展开入口**。两项均为纯前端视觉微调。

## What Changes
- **删除 WelcomeState 4 个快速入口卡片**：移除 `items` 数组（4 项数据）+ 移除 2x2 grid 渲染 + 移除 Icon 组件中 code/translate/summarize/chat 4 个 inline SVG
- **FileExplorer 新增关闭按钮**：标题栏右侧在"刷新"按钮旁增加一个"关闭"按钮（X 图标），点击触发 `onClose` 回调
- **App.tsx 新增 fileExplorerOpen state**：默认 `true`，FileExplorer 容器宽度根据该 state 动态切换（`w-[280px]` 渐变到 `w-0`）
- **BrandHeader 下拉菜单新增"文件浏览器"切换项**：单击切换 fileExplorerOpen state，显示/隐藏右侧边栏
- **零后端变更**

## Impact
- Affected specs: `frontend-system-beautification-doubao`（**MODIFIED** — WelcomeState 简化）/ `welcome-greeting-and-input-alignment`（**MODIFIED** — 删除 4 建议框）
- Affected code:
  - `frontend/src/components/WelcomeState.tsx` — v1.1.0 → v1.2.0：删除 items / grid / 4 SVG
  - `frontend/src/components/FileExplorer.tsx` — v2.10.1 → v2.10.2：增加 `onClose` prop + 关闭按钮
  - `frontend/src/components/BrandHeader.tsx` — v1.0.0 → v1.1.0：下拉菜单新增"文件浏览器"切换项
  - `frontend/src/App.tsx` — v2.10.0 → v2.10.1：新增 fileExplorerOpen state + FileExplorer 容器宽度渐变 + 透传 onClose

---

## MODIFIED Requirements

### Requirement: WelcomeState 简化（来自 frontend-system-beautification-doubao / welcome-greeting-and-input-alignment）
WelcomeState SHALL 仅显示三行招呼语，**不**显示 4 个快速入口卡片。

#### Scenario: 三行招呼语
- **WHEN** 渲染 WelcomeState
- **THEN** 显示：① 品牌插画（圆形渐变 + 闪电）；② 主标题"你好，我是智能体调度平台"；③ 副标题"基于 Hermes 内核"；④ 引导提问"今天需要我为你做些什么吗？"
- **AND** 引导提问后的 `mb-12` 改为 `mb-0`（不再为 4 卡片留出空间）
- **AND** **不**渲染任何快速入口卡片
- **AND** **不**需要 `items` 数组、Icon 组件、grid 容器、QuickItem 接口

#### Scenario: props 简化
- **WHEN** 父组件调用 WelcomeState
- **THEN** props 签名：`onSelectPrompt: (prompt: string) => void` 保留（即使暂不触发，预留接口）
- **AND** 移除所有内部 QuickItem 映射逻辑

---

### Requirement: FileExplorer 关闭按钮
FileExplorer SHALL 在标题栏右侧"刷新"按钮旁增加一个"关闭"按钮（X 图标），点击触发 `onClose` 回调。

#### Scenario: 关闭按钮位置
- **WHEN** 渲染 FileExplorer 标题栏
- **THEN** 标题栏右侧依次显示"刷新"按钮 + "关闭"按钮
- **AND** 两按钮均使用 `icon-btn !w-6 !h-6` 样式（与刷新按钮风格一致）
- **AND** 关闭按钮 SVG：X 图标（path 折线）

#### Scenario: 关闭按钮交互
- **WHEN** 用户点击关闭按钮
- **THEN** 调 `props.onClose()` 回调
- **AND** **不**销毁 FileExplorer 内部 state（保留文件树缓存），仅通知父组件隐藏
- **AND** 按钮 hover 时 `text-red-400`（红色提示危险/关闭）

#### Scenario: 刷新按钮保持
- **WHEN** 用户点击刷新按钮
- **THEN** 调 `loadTree()` 重新拉取文件树（已有逻辑不变）
- **AND** 位置调整：刷新按钮在左、关闭按钮在右（避免误触关闭）

---

### Requirement: 文件浏览器开关
App.tsx SHALL 通过 `fileExplorerOpen` state 控制 FileExplorer 显示/隐藏，BrandHeader 下拉菜单提供切换入口。

#### Scenario: fileExplorerOpen state
- **WHEN** App.tsx 初始化
- **THEN** `const [fileExplorerOpen, setFileExplorerOpen] = useState(true);`
- **AND** 仅在 `appMode === 'coding' && selectedProject` 时该 state 生效

#### Scenario: 关闭渐变动画
- **WHEN** `fileExplorerOpen === false`
- **THEN** FileExplorer 容器宽度 `w-0 overflow-hidden`（从 280px 渐变到 0）
- **AND** 应用 `transition-all duration-300 ease-expressive`
- **AND** 内部内容不再渲染（display 不可见，避免占空间）
- **WHEN** `fileExplorerOpen === true`
- **THEN** FileExplorer 容器宽度 `w-[280px]` 渐变显示

#### Scenario: BrandHeader 菜单入口
- **WHEN** 渲染 BrandHeader 下拉菜单
- **THEN** 菜单项顺序：**文件浏览器**（新增，图标 FolderTree）→ 用量监控 → 片段库 → 设置 → 回收站
- **AND** "文件浏览器"项右侧显示当前状态（已展开/已折叠）的对勾或图标提示
- **WHEN** 用户点击该项
- **THEN** `setFileExplorerOpen(!fileExplorerOpen)` 切换
- **AND** 仅在 `appMode === 'coding' && selectedProject` 时显示该项（其他模式下隐藏）

---

## REMOVED Requirements

### Requirement: 4 个快速入口卡片（来自 frontend-system-beautification-doubao）
**Reason**：进入编程模式后用户已有明确任务，4 张建议框（写代码/翻译/总结/闲聊）成为信息噪音；占据主区大量纵向空间；翻译/总结/闲聊与编程场景无关。

**Migration**：
- 移除 `items` 数组（含 iconKey / label / prompt 4 项）
- 移除 2x2 grid 容器
- 移除 Icon 组件中 code / translate / summarize / chat 4 个 inline SVG（zap 保留用于品牌插画）
- 移除 QuickItem 接口
- 引导提问的 `mb-12` 改为 `mb-0`（不再为 4 卡片预留空间）
- props `onSelectPrompt` 保留接口（即使暂不触发，预留扩展）
