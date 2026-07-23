# 双模式入口 + 独立历史记录 Spec

> **✅ 全部完成（与代码 v3.0.0 同步）** — 2026-06-24 同步

## Why
当前用户打开网页后直接进入 Hermes 对话界面，无法区分"闲聊模式"和"编程模式"。在编程模式下平台会自动生成多个 Claude Code CLI 实例进行编码，配额消耗巨大；而在普通聊天场景下用户只需要与 Hermes 对话。需要增加模式选择入口，且两种模式的历史记录完全独立。

## What Changes
- 新增模式选择页面（首次进入时展示，后续可通过侧边栏切换）
- Session 模型新增 `mode` 字段（`chat` / `coding`）
- 前端侧边栏按模式分组显示历史会话
- 新建会话时自动继承当前模式
- 编程模式保留全部现有功能（Hermes 对话 → 提示词优化 → 任务规划 → CLI 实例分发）
- 闲聊模式仅保留 Hermes 对话功能，不创建任何 Claude Code CLI 实例
- **BREAKING**: 无

## Impact
- Affected specs: chat-experience-optimization（侧边栏改造）、hermes-scheduling-upgrade（交互流程分支）
- Affected code: `backend/app/models.py`（+mode 字段）、`backend/app/database.py`（迁移）、`backend/app/api/sessions.py`（mode 过滤）、`frontend/src/App.tsx`（模式选择 + 状态栏）、`frontend/src/components/Sidebar.tsx`（分组显示）、`frontend/src/hooks/useApi.ts`（mode 参数）

---

## ADDED Requirements

### Requirement: 双模式入口选择
用户打开网页后 SHALL 先看到模式选择页面，可选择"日常办公闲聊模式"或"编程模式"进入。

#### Scenario: 首次进入选择模式
- **WHEN** 用户首次打开网页（无已保存的模式偏好）
- **THEN** 展示两个大卡片：「💬 日常办公闲聊」和「⚡ 编程模式」
- **AND** 用户点击任一卡片后进入对应模式

#### Scenario: 再次进入记住模式
- **WHEN** 用户之前已选择过模式（localStorage 有记录）
- **THEN** 直接进入上次使用的模式，不展示选择页面
- **AND** 侧边栏顶部提供模式切换按钮

---

### Requirement: 聊天模式（Chat Mode）
进入聊天模式后，系统 SHALL 仅使用 Hermes 对话，不创建任何 Claude Code CLI 实例。

#### Scenario: 聊天模式对话
- **WHEN** 用户在聊天模式下发送消息
- **THEN** 仅调用 Hermes 对话 API（chatWithHermesStreaming），不进行提示词优化和任务分发
- **AND** 不创建任何 Claude Code CLI 子实例

#### Scenario: 聊天模式界面
- **WHEN** 用户处于聊天模式
- **THEN** 不显示"优化提示词"按钮和"任务计划"面板
- **AND** 顶部导航栏显示"💬 日常办公闲聊"模式标识

---

### Requirement: 编程模式（Coding Mode）
编程模式 SHALL 保留全部现有功能：Hermes 对话 → 提示词优化 → 任务规划 → CLI 实例分发。

#### Scenario: 编程模式完整流程
- **WHEN** 用户切换到编程模式
- **THEN** 界面显示"优化提示词"按钮和完整的任务规划/执行功能
- **AND** 顶部导航栏显示"⚡ 编程模式"标识

---

### Requirement: 独立历史记录
两种模式的历史会话 SHALL 相互独立，切换模式时只展示对应模式的历史记录。

#### Scenario: 按模式过滤会话列表
- **WHEN** 用户在聊天模式下查看侧边栏
- **THEN** 仅显示 `mode=chat` 的历史会话
- **WHEN** 用户切换到编程模式
- **THEN** 侧边栏切换显示 `mode=coding` 的历史会话

#### Scenario: 新建会话继承模式
- **WHEN** 用户在聊天模式下点击"新建对话"
- **THEN** 新会话的 mode 自动设为 `chat`
- **WHEN** 用户在编程模式下点击"新建对话"
- **THEN** 新会话的 mode 自动设为 `coding`

---

### Requirement: 模式切换
用户 SHALL 可通过侧边栏顶部的模式切换控件在两种模式间切换，切换时不丢失当前会话。

#### Scenario: 模式切换保留会话
- **WHEN** 用户从聊天模式切换到编程模式
- **THEN** 当前聊天会话保留在历史中，侧边栏刷新为编程模式的历史会话列表
- **AND** 自动定位到编程模式下最近一个活跃会话

#### Scenario: 模式切换无活跃会话
- **WHEN** 用户切换到目标模式但该模式下无历史会话
- **THEN** 自动创建一个新的空会话（mode 设为目标模式）
