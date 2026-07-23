# Tasks

- [x] Task 1: 服务启动配置调整
  - [x] 1.1 移除 main.py 中启动时自动创建默认 Claude Code CLI 实例的逻辑
  - [x] 1.2 确保启动后智能体列表为空

- [x] Task 2: Hermes 内核集成
  - [x] 2.1 创建 Hermes 集成模块（hermes_integration/），封装 Hermes CLI 调用
  - [x] 2.2 实现 Hermes 对话接口（接收用户消息，返回 Hermes 回复）
  - [x] 2.3 实现 Hermes 提示词优化接口
  - [x] 2.4 实现 Hermes 按需创建/销毁 Claude Code CLI 实例的能力
  - [x] 2.5 更新 config/settings.yaml 添加 Hermes 配置项

- [x] Task 3: Hermes 风格 UI 重构
  - [x] 3.1 设计 Hermes 风格配色方案（深色主题 + Hermes 品牌色）
  - [x] 3.2 重构全局 CSS/Tailwind 配置，应用 Hermes 设计语言
  - [x] 3.3 为所有交互元素添加过渡动画（hover、展开/收起、弹窗）
  - [x] 3.4 添加微交互效果（按钮涟漪、卡片悬浮、加载动画）

- [x] Task 4: 智能交互流程重构
  - [x] 4.1 重构前端为 Hermes 对话主界面（替代原聊天框网格布局）
  - [x] 4.2 实现提示词优化完成模态弹窗（"提示词优化完成"）
  - [x] 4.3 实现自动创建 CLI 实例进行任务规划的后端逻辑
  - [x] 4.4 实现任务规划完成模态弹窗（"任务规划完成"）
  - [x] 4.5 实现计划.md 内容的前端 Markdown 渲染展示
  - [x] 4.6 实现用户确认机制（确认按钮 → 按模块分发任务）
  - [x] 4.7 实现按模块创建子 CLI 实例并分发执行的后端逻辑
  - [x] 4.8 更新后端 API 和工作流接口适配新流程

- [x] Task 5: 用量监控模块开发
  - [x] 5.1 实现火山引擎 Coding Plan 用量 API 调用模块
  - [x] 5.2 实现用量数据缓存与定时刷新机制
  - [x] 5.3 创建用量监控后端 API 接口
  - [x] 5.4 设计并实现前端用量数据展示面板（API 调用次数、剩余次数、Token 消耗）
  - [x] 5.5 确保用量数据实时更新

- [x] Task 6: 集成测试与验证
  - [x] 6.1 测试 Hermes 对话和提示词优化流程
  - [x] 6.2 测试自动创建 CLI 实例和任务规划流程
  - [x] 6.3 测试用户确认后按模块分发执行流程
  - [x] 6.4 测试用量监控数据准确性
  - [x] 6.5 测试 UI 动画和交互效果

# Task Dependencies
- Task 2 依赖 Task 1（Hermes 集成前先调整启动配置）
- Task 3 可与 Task 2 并行开发
- Task 4 依赖 Task 2、Task 3（交互流程需要 Hermes 内核和新 UI）
- Task 5 可与 Task 2-4 并行开发
- Task 6 依赖 Task 1-5 全部完成
