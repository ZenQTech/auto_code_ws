# Tasks

- [x] Task 1: 统一配色方案为 Hermes 金橙色
  - [x] 1.1 更新 App.tsx 中所有紫色/indigo 配色为 Hermes 金橙色（hermes-* 色系）
  - [x] 1.2 更新 App.tsx 中所有灰色背景为 surface-* 色系
  - [x] 1.3 更新 Toast.tsx 配色为 Hermes 金橙色系，支持成功/错误/警告/信息类型
  - [x] 1.4 更新 PlanViewer.tsx 配色为 Hermes 金橙色系
  - [x] 1.5 更新 index.html body class 为 Hermes 配色

- [x] Task 2: 清理遗留组件
  - [x] 2.1 删除 StatsBar.tsx（未被 App.tsx 引用）
  - [x] 2.2 删除 PromptInput.tsx（未被 App.tsx 引用）
  - [x] 2.3 删除 AgentManager.tsx（未被 App.tsx 引用）
  - [x] 2.4 删除 UsagePanel.tsx（浮动版，未被 App.tsx 引用）
  - [x] 2.5 清理 useApi.ts 中对应遗留组件的 API 函数（optimizePrompt, planTasks, runFullWorkflow）

- [x] Task 3: 增强消息入场动画与打字指示器
  - [x] 3.1 为对话消息添加 fade-in + slide-up 入场动画
  - [x] 3.2 更新打字指示器为金橙色跳动圆点

- [x] Task 4: 按钮交互增强
  - [x] 4.1 优化发送按钮 hover/active/disabled 状态样式
  - [x] 4.2 用量面板切换按钮添加旋转动画和面板滑入/滑出过渡

- [x] Task 5: 用量面板可视化增强
  - [x] 5.1 API 调用次数添加进度条展示（相对于配额 10000）
  - [x] 5.2 Token 消耗添加格式化数字展示（如 12.5K）
  - [x] 5.3 优化面板整体视觉布局

- [x] Task 6: PlanViewer 模态框优化
  - [x] 6.1 优化模态框打开/关闭动画
  - [x] 6.2 增强 Markdown 内容渲染样式（标题层次、代码块、分隔线）

- [x] Task 7: 响应式布局适配
  - [x] 7.1 添加移动端（<640px）布局适配
  - [x] 7.2 添加平板（640-1024px）布局适配
  - [x] 7.3 用量面板在移动端改为底部抽屉式

- [x] Task 8: 构建验证
  - [x] 8.1 运行前端构建确保无编译错误
  - [x] 8.2 检查所有页面元素的视觉一致性

# Task Dependencies
- Task 2 可与 Task 1 并行开发
- Task 3、Task 4 依赖 Task 1（配色统一后调整动画）
- Task 5 依赖 Task 1（配色统一后调整面板）
- Task 6 依赖 Task 1（配色统一后调整模态框）
- Task 7 可与 Task 1-6 并行开发
- Task 8 依赖 Task 1-7 全部完成
