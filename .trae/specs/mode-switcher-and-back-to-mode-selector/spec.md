# 模式切换与返回入口 Spec

## Why
刚验证的 `dual-mode-entry` spec（v3.0.0）实现了双模式入口与 ProjectSelector，但**用户实测发现**：
1. **首进模式选择后无返回路径**：用户首次选择"编程模式"后进入 ProjectSelector（新建/打开项目），但若用户**临时想改用聊天模式**，只能在 ProjectSelector 页面卡住——没有"返回模式选择"或"切换到聊天模式"按钮，只能手动 `localStorage.removeItem('app_mode')` 强行清除。
2. **BrandHeader 已接收 `appMode` prop 但未渲染模式切换 pill**：spec 5.1 明确要求"顶部导航栏显示当前模式标识 + 可切换"，但 `BrandHeader.tsx` 当前仅在 Sidebar 模式切换 pill 中体现，顶部栏无任何视觉指示与切换入口。
3. **同会话切换混乱**：用户从 ProjectSelector 切到聊天模式后，`selectedProject` 状态需要被清空（否则下次切回编程模式时仍显示 ProjectSelector 旧状态）。

## What Changes
- **ProjectSelector 新增"返回模式选择"链接**：组件顶部加"← 返回"按钮，调用新 `onBack` 回调通知父组件清除 appMode
- **ProjectSelector 新增"切换到聊天模式"快捷按钮**：组件底部加次要按钮"💬 切换到聊天模式"，一步直达聊天主界面
- **App.tsx 新增 `handleBackToModeSelect` 回调**：清除 `appMode` + `selectedProject` + `openedFile` + 清理 `localStorage` 中的 `app_mode`，渲染 ModeSelector
- **App.tsx 新增 `handleSwitchToChat` 回调**：从编程模式切到聊天模式，保留当前 session（仍可继续聊天）
- **BrandHeader 新增模式切换 pill**：顶部 Session 标题旁显示当前模式 pill（`💬 闲聊` / `⚡ 编程`），单击切换到另一模式
- **App.tsx 集成**：将 BrandHeader 已有 `appMode` prop 配合新的 `onSwitchMode` 回调，实现顶部一键切换
- **零后端变更**

## Impact
- Affected specs: `dual-mode-entry`（**MODIFIED** — 补充返回入口）、`frontend-system-beautification-doubao`（**MODIFIED** — BrandHeader 增加模式 pill 渲染）
- Affected code:
  - `frontend/src/components/ProjectSelector.tsx` — v2.10.0 → v2.10.1：Props 新增 onBack / onSwitchToChat + 顶部"返回"链接 + 底部"切换到聊天模式"按钮
  - `frontend/src/components/BrandHeader.tsx` — v1.1.0 → v1.2.0：新增模式切换 pill 渲染（已在 props 接收 appMode）
  - `frontend/src/App.tsx` — v2.10.1 → v2.10.2：新增 handleBackToModeSelect / handleSwitchToChat + 透传给 ProjectSelector 与 BrandHeader

---

## ADDED Requirements

### Requirement: ProjectSelector 返回入口
ProjectSelector SHALL 提供"返回模式选择"与"切换到聊天模式"两个返回入口，避免用户在编程模式无项目时陷入死循环。

#### Scenario: 返回模式选择链接
- **WHEN** 渲染 ProjectSelector
- **THEN** 组件顶部（标题上方）显示"← 返回模式选择"链接（左上角，text-caption text-surface-500 hover:text-hermes-500）
- **AND** 点击触发 `props.onBack()` 回调
- **AND** 父组件 App.tsx 清除 `appMode = null` + `selectedProject = null` + `openedFile = null` + 清理 `localStorage['app_mode']`
- **AND** 渲染 ModeSelector 重新选择

#### Scenario: 切换到聊天模式按钮
- **WHEN** 渲染 ProjectSelector
- **THEN** 组件底部（两个大卡片下方）显示"💬 切换到聊天模式"次要按钮
- **AND** 按钮样式：`text-sm text-surface-600 hover:text-hermes-500 underline`
- **AND** 点击触发 `props.onSwitchToChat()` 回调
- **AND** 父组件 App.tsx 设置 `appMode = 'chat'` + 写入 `localStorage['app_mode'] = 'chat'` + 渲染聊天主界面

#### Scenario: ProjectSelector Props 扩展
- **WHEN** 父组件调用 ProjectSelector
- **THEN** props 签名：`{onSelect, onBack?, onSwitchToChat?}`（onBack 与 onSwitchToChat 均为可选，未传时不渲染对应入口）
- **AND** 保留原 onSelect 行为

---

### Requirement: BrandHeader 模式切换 pill
BrandHeader SHALL 在顶部 Session 标题旁渲染模式切换 pill，让用户随时切换模式（无需手动改 localStorage）。

#### Scenario: 模式 pill 渲染
- **WHEN** 渲染 BrandHeader
- **THEN** Session 标题旁显示模式 pill：
  - `appMode === 'chat'`：显示"💬 闲聊"（pill 颜色 `bg-surface-100 text-surface-600`）
  - `appMode === 'coding'`：显示"⚡ 编程"（pill 颜色 `bg-hermes-100 text-hermes-700`）
- **AND** pill 样式：`text-xs px-2 py-0.5 rounded-full`
- **AND** 仅在 `appMode` 已选择时显示

#### Scenario: 模式 pill 点击
- **WHEN** 用户点击模式 pill
- **THEN** 触发 `props.onSwitchMode()` 回调
- **AND** 父组件切换到另一模式：
  - `appMode === 'chat'` → `setAppMode('coding')`（进入编程模式，无项目时显示 ProjectSelector）
  - `appMode === 'coding'` → `setAppMode('chat')`（进入聊天模式，保留当前 session）
- **AND** 切换时**不**清空 `selectedProject`（用户可能切回编程模式继续原项目）

#### Scenario: BrandHeader Props 扩展
- **WHEN** 父组件调用 BrandHeader
- **THEN** props 签名新增 `onSwitchMode?: () => void;`（可选，未传时不显示 pill hover 效果）
- **AND** 已有 `appMode?: 'chat' | 'coding'` prop 已存在，仅需补渲染逻辑

---

### Requirement: App.tsx 模式切换回调
App.tsx SHALL 实现 `handleBackToModeSelect` 与 `handleSwitchToChat` 两个新回调，配合 ProjectSelector 与 BrandHeader 完成模式切换闭环。

#### Scenario: handleBackToModeSelect
- **WHEN** 用户点击 ProjectSelector 的"返回模式选择"
- **THEN** 调 `setAppMode(null)` + `setSelectedProject(null)` + `setOpenedFile(null)` + `localStorage.removeItem('app_mode')`
- **AND** 渲染 ModeSelector 等待用户重新选择

#### Scenario: handleSwitchToChat
- **WHEN** 用户点击 ProjectSelector 的"切换到聊天模式"或 BrandHeader 模式 pill
- **THEN** 调 `setAppMode('chat')` + `localStorage.setItem('app_mode', 'chat')`
- **AND** **保留** `selectedProject` 与 `openedFile`（再次切回编程模式时可恢复）
- **AND** **保留** `currentSessionId`（聊天模式继续使用当前 session）
- **WHEN** 用户切回编程模式（再次点击 BrandHeader pill）
- **THEN** 调 `setAppMode('coding')` + `localStorage.setItem('app_mode', 'coding')`
- **AND** 若 `selectedProject` 仍存在 → 渲染 FileExplorer + CodeViewer
- **AND** 若 `selectedProject` 已清空 → 渲染 ProjectSelector

#### Scenario: 现有 useEffect 适配
- **WHEN** appMode 在 chat / coding 之间切换
- **THEN** 现有会话初始化 useEffect 感知变化并自动适配（**不**创建新 session）
- **AND** 切换不触发 createSession（仅首次进入模式时创建）

---

## MODIFIED Requirements

### Requirement: 模式选择流程（来自 dual-mode-entry）
完整模式选择流程 SHALL 支持**双向**——既可从 ModeSelector 进入编程模式，也可在编程模式无项目时返回 ModeSelector。

#### Scenario: 完整切换路径
- **WHEN** 用户在任何界面（ModeSelector / ProjectSelector / 聊天主界面 / 编程主界面）
- **THEN** 始终可通过以下入口切换模式：
  1. **ModeSelector → 编程模式 → ProjectSelector**（首次进入编程模式）
  2. **ProjectSelector → "返回模式选择"**（返回 ModeSelector）
  3. **ProjectSelector → "切换到聊天模式"**（直接进入聊天）
  4. **聊天主界面 → BrandHeader pill**（切到编程模式）
  5. **编程主界面 → BrandHeader pill**（切到聊天模式）
  6. **任何界面 → Sidebar 模式切换 pill**（已有）

---

## REMOVED Requirements

无。本 spec 为增量改动，**不**删除任何已有功能或样式。
