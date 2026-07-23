# Hermes 调度平台架构升级 Spec

## Why
当前平台以 Claude Code CLI 为直接内核，缺乏 Hermes 作为中央调度大脑的架构设计。需要将 Hermes 作为核心调度引擎，Claude Code CLI 降级为执行子节点，同时优化交互流程、升级 UI 风格、增加用量监控能力。

## What Changes
- 服务启动不再自动创建 Claude Code CLI 实例
- 平台内核从 Claude Code CLI 迁移至 Hermes，Hermes 负责用户对话、提示词优化、任务规划调度
- Claude Code CLI 降级为纯执行节点，由 Hermes 按需动态创建
- 前端 UI 全面重构为 Hermes 风格设计语言，增加过渡动画和微交互
- 交互流程重构：Hermes 对话 → 提示词优化 → 自动创建 CLI 实例规划 → 展示计划.md → 用户确认 → 分发执行
- 新增火山引擎 Coding Plan 用量监控模块
- **BREAKING**: 平台内核从 Claude Code CLI 变更为 Hermes

## Impact
- Affected specs: claude-code-scheduling-platform（原 spec 全部功能）
- Affected code: backend/app/main.py, backend/app/services/*, cli_integration/*, frontend/src/*, config/settings.yaml

---

## ADDED Requirements

### Requirement: 服务启动不自动创建实例
系统启动时 SHALL NOT 自动创建任何 Claude Code CLI 子实例，所有实例由 Hermes 按需动态创建。

#### Scenario: 系统启动
- **WHEN** 系统启动完成
- **THEN** 智能体列表中无任何预创建的 Claude Code CLI 实例

---

### Requirement: Hermes 内核集成
系统 SHALL 以 Hermes 为核心调度内核，Hermes 负责接收用户输入、进行提示词优化、制定任务规划、按需创建和管理 Claude Code CLI 子实例。

#### Scenario: Hermes 作为中央调度大脑
- **WHEN** 用户通过前端输入需求
- **THEN** 需求直接发送给 Hermes 处理，Hermes 负责后续所有调度决策

#### Scenario: Claude Code CLI 降级为执行节点
- **WHEN** Hermes 完成任务规划后需要执行编码任务
- **THEN** Hermes 按模块动态创建 Claude Code CLI 子实例，每个子实例负责一个独立任务模块

---

### Requirement: Hermes 风格 UI 重构
前端界面 SHALL 全面采用 Hermes 风格设计语言，包括配色方案、字体、圆角、阴影、图标体系。

#### Scenario: Hermes 风格配色
- **WHEN** 用户打开平台
- **THEN** 界面呈现 Hermes 品牌配色（深色主题为主，点缀色使用 Hermes 标志性色彩）

#### Scenario: 过渡动画与微交互
- **WHEN** 用户进行点击、展开/收起、鼠标悬停等操作
- **THEN** 界面以平滑的过渡动画响应，包括按钮 hover 效果、卡片展开/收起动画、模态弹窗淡入淡出

---

### Requirement: Hermes 直接对话
用户 SHALL 能够直接与 Hermes 进行对话交互，Hermes 对话界面作为平台的核心交互入口。

#### Scenario: 用户与 Hermes 对话
- **WHEN** 用户在对话输入框中输入消息并发送
- **THEN** 消息发送给 Hermes，Hermes 的回复实时显示在对话区域

---

### Requirement: Hermes 提示词优化与模态通知
Hermes 完成提示词优化后，前端 SHALL 在页面顶部显示模态弹窗，内容为"提示词优化完成"。

#### Scenario: 提示词优化完成通知
- **WHEN** Hermes 完成提示词优化
- **THEN** 前端顶部弹出模态窗口，显示"提示词优化完成"，用户可关闭弹窗

---

### Requirement: 自动创建 CLI 实例进行任务规划
提示词优化完成后，系统 SHALL 自动创建一个 Claude Code CLI 实例，专门负责执行任务规划。

#### Scenario: 自动创建规划实例
- **WHEN** 提示词优化完成
- **THEN** 系统自动创建一个 Claude Code CLI 子实例，将优化后的提示词发送给该实例进行任务规划

---

### Requirement: 任务规划完成通知与计划展示
任务规划完成后，前端 SHALL 在页面顶部显示模态弹窗"任务规划完成"，并自动展示"计划.md"文档的完整内容。

#### Scenario: 规划完成通知
- **WHEN** Claude Code CLI 实例完成"计划.md"的生成
- **THEN** 前端顶部弹出模态窗口显示"任务规划完成"，同时主内容区展示计划.md 的完整 Markdown 渲染内容

---

### Requirement: 用户确认后分发执行
用户确认任务计划后，系统 SHALL 自动按模块分发编码任务，为每个任务模块生成独立的 Claude Code CLI 子实例执行。

#### Scenario: 用户确认计划
- **WHEN** 用户查看计划.md 内容后点击确认
- **THEN** 系统按计划中的模块拆分，为每个模块创建独立的 Claude Code CLI 子实例，分发对应任务执行

#### Scenario: 任务执行监控
- **WHEN** 子实例开始执行任务
- **THEN** 前端实时显示各子实例的任务执行状态

---

### Requirement: Coding Plan 用量监控
系统 SHALL 集成火山引擎 Coding Plan 用量监控 API，在前端展示用量数据面板。

#### Scenario: 用量数据展示
- **WHEN** 用户查看用量监控面板
- **THEN** 面板显示最近 5 小时内总 API 调用次数、剩余可用调用次数、所有任务累计 Token 消耗总量

#### Scenario: 用量数据实时更新
- **WHEN** 用量数据发生变化
- **THEN** 前端面板自动刷新，确保数据实时准确

---

## MODIFIED Requirements

### Requirement: 智能体管理接口（修改）
智能体管理接口 SHALL 不再支持手动添加 Claude Code CLI 实例，所有实例由 Hermes 按需自动创建和销毁。

#### Scenario: 实例生命周期由 Hermes 管理
- **WHEN** 需要执行编码任务
- **THEN** Hermes 自动创建 Claude Code CLI 实例
- **WHEN** 任务完成
- **THEN** Hermes 自动销毁该实例
