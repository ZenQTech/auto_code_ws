# Checklist

## Task 1 — WelcomeState 招呼语更新
- [x] `WelcomeState.tsx` v1.0.0 → v1.1.0
- [x] 主标题文案："你好，我是智能体调度平台"
- [x] 副标题文案："基于 Hermes 内核"
- [x] 新增第三行引导提问："今天需要我为你做些什么吗？"
- [x] 三行间距正确：主标题 mb-2 / 副标题 mb-3 / 引导提问 mb-12
- [x] 文案不含 "Claude Code" 字样
- [x] 文件头 v1.1.0 修改记录已写入

## Task 2 — 浮动输入区对齐重构
- [x] `App.tsx` v2.9.2 → v2.9.3
- [x] 移除 `fixed bottom-6 left-0 right-0 z-50 px-4 pointer-events-none` 容器
- [x] 输入区移到主区 flex 容器内（紧跟 displayAgents 之后）
- [x] 新容器类：`mt-auto px-4`（`mt-auto` 推到底部）
- [x] 内部保留 `max-w-3xl mx-auto` + 玻璃拟态 + 焦点光环
- [x] 发送 / 停止 / 流式响应功能保持
- [x] 文件头 v2.9.3 修改记录已写入

## Task 3 — 构建与回归
- [x] 后端启动无报错
- [x] 前端构建无编译错误
- [x] grep 验证招呼语三行文案
- [x] grep 验证输入区已无 `fixed bottom-6`
- [x] GUI 端到端：展开 Sidebar 时输入框与 BrandHeader 标题对齐
