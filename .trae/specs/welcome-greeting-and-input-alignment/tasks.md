# Tasks

- [x] Task 1: WelcomeState 招呼语更新
  - 1.1 在 `frontend/src/components/WelcomeState.tsx` v1.0.0 → v1.1.0 修改招呼语三行
  - 1.2 主标题："你好，我是 Hermes" → "你好，我是智能体调度平台"
  - 1.3 副标题："基于 Claude Code 的智能体调度助手" → "基于 Hermes 内核"
  - 1.4 新增第三行："今天需要我为你做些什么吗？"（`text-body text-surface-600 mb-12`）
  - 1.5 主标题 mb-2 / 副标题 mb-3 / 引导提问 mb-12
  - 1.6 文件头修改记录追加：`# - 2026-06-24 | v1.1.0 | 招呼语文案更新（三行结构 + 引导提问）`

- [x] Task 2: 浮动输入区对齐重构
  - 2.1 在 `frontend/src/App.tsx` v2.9.2 → v2.9.3 移除外层 `fixed bottom-6 left-0 right-0 z-50 px-4 pointer-events-none` 容器
  - 2.2 把内部玻璃拟态面板容器**移到主区 flex 容器内**，紧跟 `{displayAgents.length > 0 && <div>...</div>}` 之后
  - 2.3 新位置容器类：`mt-auto px-4`（`mt-auto` 推到底部）
  - 2.4 内部保留 `max-w-3xl mx-auto` + 玻璃拟态面板 + 焦点光环
  - 2.5 文件头修改记录追加：`# - 2026-06-24 | v2.9.3 | 浮动输入区从 viewport fixed 改为主区内 mt-auto 推底（与对话标题对齐）`
  - 2.6 **保留**所有功能：发送 / 停止 / 焦点光环 / placeholder / Enter 发送 Shift+Enter 换行 / 流式响应

- [x] Task 3: 构建与回归验证
  - 3.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
  - 3.2 前端 `npm run build` 无编译错误
  - 3.3 grep 验证招呼语三行：主标题含"智能体调度平台"、副标题含"Hermes 内核"、引导提问含"今天需要我为你做些什么吗"
  - 3.4 grep 验证输入区**不**再有 `fixed bottom-6 left-0 right-0`（已被替换为 `mt-auto px-4`）
  - 3.5 GUI 端到端：展开 Sidebar 时输入框与 BrandHeader 标题对齐 / 折叠 Sidebar 时输入框仍居中

# Task Dependencies
- Task 1（招呼语）独立
- Task 2（输入区对齐）独立
- Task 3（验证）依赖 Task 1 + 2 完成
