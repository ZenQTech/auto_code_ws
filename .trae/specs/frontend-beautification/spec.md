# 前端美化与交互优化 Spec

## Why
当前前端存在配色方案不一致（Tailwind 配置定义了 Hermes 金橙色但实际使用紫色/灰色）、存在未使用的遗留组件、交互反馈薄弱、缺少响应式适配等问题，需要系统性美化前端显示并优化交互逻辑。

## What Changes
- 统一配色方案为 Hermes 金橙色设计语言（替换当前紫色/灰色混用）
- 清理未使用的遗留组件（StatsBar、PromptInput、AgentManager、UsagePanel 浮动版）
- 增强交互动效（消息入场动画、按钮涟漪效果、面板过渡、加载状态）
- 优化对话界面布局与视觉层次
- 改进用量面板展示（图表化、进度条）
- 添加响应式适配（移动端/平板）
- 优化 Toast 通知样式
- 改进 PlanViewer 模态框体验

## Impact
- Affected specs: hermes-scheduling-upgrade（UI 重构部分）
- Affected code: frontend/src/App.tsx, frontend/src/index.css, frontend/src/tailwind.config.js, frontend/src/components/*, frontend/src/index.html

---

## ADDED Requirements

### Requirement: 统一 Hermes 金橙色配色方案
系统前端 SHALL 统一使用 Hermes 品牌金橙色（#f0a030）作为主色调，深色表面色（#0a0a0f 系列）作为背景色，替换当前紫色/灰色混用。

#### Scenario: 页面主色调
- **WHEN** 用户打开平台
- **THEN** 所有交互元素（按钮、链接、高亮、图标）使用金橙色系，背景使用深色表面色系

#### Scenario: 消息气泡配色
- **WHEN** 用户发送消息
- **THEN** 用户消息气泡使用金橙色背景，Hermes 回复气泡使用深色表面色背景

---

### Requirement: 清理遗留组件
系统 SHALL 移除未使用的遗留组件文件，保持代码库整洁。

#### Scenario: 组件清理
- **WHEN** 检查组件目录
- **THEN** StatsBar.tsx、PromptInput.tsx、AgentManager.tsx、UsagePanel.tsx（浮动版）中未被 App.tsx 引用的组件应被移除

---

### Requirement: 消息入场动画
对话消息 SHALL 在出现时带有平滑的入场动画效果。

#### Scenario: 新消息出现
- **WHEN** 用户发送消息或收到 Hermes 回复
- **THEN** 消息气泡以淡入 + 上滑动画出现，动画时长不超过 300ms

#### Scenario: 打字指示器
- **WHEN** Hermes 正在处理请求
- **THEN** 显示金橙色跳动圆点动画，替代当前紫色圆点

---

### Requirement: 按钮交互增强
所有可点击按钮 SHALL 具有悬停、按下、加载等状态的视觉反馈。

#### Scenario: 发送按钮
- **WHEN** 用户悬停在发送按钮上
- **THEN** 按钮颜色变亮并轻微放大
- **WHEN** 用户按下发送按钮
- **THEN** 按钮缩小至 95% 并恢复

#### Scenario: 面板切换按钮
- **WHEN** 用户点击用量监控切换按钮
- **THEN** 按钮图标平滑旋转 180 度，面板从右侧滑入/滑出

---

### Requirement: 用量面板可视化增强
用量监控面板 SHALL 使用进度条和可视化元素展示数据。

#### Scenario: API 调用次数展示
- **WHEN** 用户打开用量面板
- **THEN** API 调用次数以数字 + 进度条形式展示（相对于配额）

#### Scenario: Token 消耗展示
- **WHEN** 用户打开用量面板
- **THEN** Token 消耗以格式化数字（如 12.5K）展示，并配有趋势指示

---

### Requirement: Toast 通知优化
Toast 通知 SHALL 使用 Hermes 配色并支持不同类型（成功/错误/警告/信息）。

#### Scenario: 成功通知
- **WHEN** 操作成功（如计划确认）
- **THEN** 显示金橙色边框的 Toast，带绿色勾选图标

#### Scenario: 错误通知
- **WHEN** 操作失败
- **THEN** 显示红色边框的 Toast，带错误图标

---

### Requirement: PlanViewer 模态框优化
计划查看器模态框 SHALL 具有更好的视觉层次和操作体验。

#### Scenario: 模态框打开
- **WHEN** 任务规划完成
- **THEN** 模态框以缩放 + 淡入动画出现，背景模糊加深

#### Scenario: 计划内容展示
- **WHEN** 模态框显示计划内容
- **THEN** Markdown 内容具有清晰的标题层次、代码高亮、分隔线

---

### Requirement: 响应式布局适配
前端界面 SHALL 在移动端和平板设备上正常显示和操作。

#### Scenario: 移动端布局
- **WHEN** 用户在手机浏览器打开平台
- **THEN** 对话界面占满屏幕宽度，用量面板变为底部抽屉式，头部信息精简

#### Scenario: 平板布局
- **WHEN** 用户在平板浏览器打开平台
- **THEN** 对话界面居中显示，用量面板可切换显示

---

## MODIFIED Requirements

### Requirement: Hermes 风格 UI 重构（来自 hermes-scheduling-upgrade）
前端界面 SHALL 全面采用 Hermes 风格设计语言，包括：
- 配色方案统一为金橙色主色调 + 深色表面色背景
- 所有交互元素使用 Hermes 品牌色
- 过渡动画和微交互覆盖所有可交互元素
- 移除未使用的遗留组件
