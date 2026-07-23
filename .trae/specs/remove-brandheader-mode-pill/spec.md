# 删除 BrandHeader 模式切换 pill Spec

## Why
刚完成的 `mode-switcher-and-back-to-mode-selector` spec（v1.2.0 / v2.10.2）实现了 BrandHeader 模式切换 pill（"💬 闲聊" / "⚡ 编程"），但用户实测认为**该 pill 信息密度过高、与"会话标题"语义重叠**：① 用户已经通过 Sidebar 模式切换 pill 知道当前模式；② BrandHeader 顶部重点应是"当前在哪个对话"而非"当前在哪个模式"；③ pill 占据 Session 标题的左侧，挤压标题显示空间。本 spec **仅删除**模式切换 pill，**保留** ① BrandHeader 其他全部功能 ② Sidebar 模式切换 pill（仍是切换入口）③ 编程模式下 ProjectSelector 的"返回模式选择 / 切换到聊天模式"双入口（仍是卡死状态下的兜底）。

## What Changes
- **删除 BrandHeader 模式 pill 渲染**：移除 Session 标题旁的"💬 闲聊" / "⚡ 编程" pill 按钮
- **保留 Session 标题**：BrandHeader 中间区域继续显示当前 Session 标题（去掉 pill 容器）
- **删除 BrandHeader `onSwitchMode` 回调的渲染绑定**（保留 props 签名以兼容调用方，**不传回调**）
- **App.tsx 不再透传 `onSwitchMode`**（保留 handleSwitchMode 回调函数，**不**删除——可能后续其他组件复用）
- **保留 Sidebar 模式切换 pill**（不删）
- **保留 ProjectSelector 双入口**（不删）
- **零后端变更**

## Impact
- Affected specs: `mode-switcher-and-back-to-mode-selector`（**MODIFIED** — 移除 BrandHeader 模式 pill 渲染部分）
- Affected code:
  - `frontend/src/components/BrandHeader.tsx` — v1.2.0 → v1.3.0：删除模式 pill 渲染；props 中 `onSwitchMode` 保留（可选），`appMode` 保留（可选）
  - `frontend/src/App.tsx` — v2.10.2 → v2.10.3：BrandHeader 引用**不传** `onSwitchMode`（可传可不传，按需）

---

## MODIFIED Requirements

### Requirement: BrandHeader 顶部布局
BrandHeader SHALL 仅在中间区域显示 Session 标题，**不**显示模式切换 pill。

#### Scenario: 顶部布局
- **WHEN** 渲染 BrandHeader
- **THEN** BrandHeader 中间区域**仅**显示 Session 标题（`text-body font-medium text-surface-700 truncate max-w-md`）
- **AND** **不**显示模式切换 pill（"💬 闲聊" / "⚡ 编程"）
- **AND** **不**显示任何与"模式"相关的视觉元素

#### Scenario: 模式感知能力
- **WHEN** 渲染 BrandHeader
- **THEN** `appMode` 与 `onSwitchMode` props 仍**保留**（不破坏调用方兼容性）
- **AND** 但组件内部**不**使用这两个 props（**仅**不渲染，不报错）

#### Scenario: 其他 BrandHeader 功能保持
- **WHEN** 渲染 BrandHeader
- **THEN** 保留：① 左侧 Logo（圆形渐变 + 闪电）② 右侧新建按钮（hover 旋转 90°）③ 三个点下拉菜单（文件浏览器/用量监控/片段库/设置/回收站）④ 移动端响应（< 768px 隐藏中间标题）
- **AND** 保留 props 签名中所有可选字段（不强制删除，仅不渲染）

---

## REMOVED Requirements

### Requirement: BrandHeader 模式切换 pill
**Reason**：信息密度过高、与"会话标题"语义重叠、占据标题左侧空间。用户已通过 Sidebar pill 知道当前模式，ProjectSelector 仍有"返回 / 切换聊天"双入口作为兜底。

**Migration**：
- 移除 BrandHeader.tsx 中模式 pill 的 JSX 渲染块（`<button onClick={onSwitchMode}>...</button>`）
- 移除外层 `{appMode && (<div className="hidden md:flex items-center gap-2">...</div>)}` 容器
- 保留 `appMode` / `onSwitchMode` props 签名（不删除，调用方可继续传但组件不渲染）
- App.tsx 不再需要透传 `onSwitchMode`（**保留** `handleSwitchMode` 回调函数本身，**不**删除——可能后续其他组件复用）
