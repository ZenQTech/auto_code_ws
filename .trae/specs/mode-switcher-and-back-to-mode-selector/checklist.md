# Checklist

## Task 1 — ProjectSelector 返回入口
- [x] `ProjectSelector.tsx` v2.10.0 → v2.10.1
- [x] Props 新增 `onBack?: () => void;` 和 `onSwitchToChat?: () => void;`
- [x] 组件顶部"← 返回模式选择"链接
- [x] 链接样式正确
- [x] 组件底部"💬 切换到聊天模式"次要按钮
- [x] 按钮样式正确
- [x] onClick 触发对应回调
- [x] 保留 onSelect 行为
- [x] 文件头 v2.10.1 修改记录已写入

## Task 2 — BrandHeader 模式切换 pill
- [x] `BrandHeader.tsx` v1.1.0 → v1.2.0
- [x] Props 新增 `onSwitchMode?: () => void;`
- [x] Session 标题旁渲染模式 pill（chat="💬 闲聊" / coding="⚡ 编程"）
- [x] pill 样式正确
- [x] pill hover 效果
- [x] pill onClick 触发回调
- [x] 文件头 v1.2.0 修改记录已写入

## Task 3 — App.tsx 模式切换回调
- [x] `App.tsx` v2.10.1 → v2.10.2
- [x] `handleBackToModeSelect` 回调已新增
- [x] `handleSwitchToChat` 回调已新增
- [x] `handleSwitchMode` 切换 pill 回调已新增
- [x] handleBackToModeSelect 清除 appMode + selectedProject + openedFile + localStorage
- [x] handleSwitchToChat 保留 selectedProject / openedFile / currentSessionId
- [x] handleSwitchMode 同步 localStorage
- [x] ProjectSelector 接收 onBack / onSwitchToChat
- [x] BrandHeader 接收 onSwitchMode + appMode
- [x] 文件头 v2.10.2 修改记录已写入

## Task 4 — 构建与回归
- [x] 后端启动无报错（exit 0 / OK）
- [x] 前端构建无编译错误（tsc -b && vite build / exit 0 / 0 错 0 警）
- [x] grep 验证 ProjectSelector 已有 onBack / onSwitchToChat / 4 处关键词
- [x] grep 验证 BrandHeader 已有 onSwitchMode + 模式 pill 渲染
- [x] grep 验证 App.tsx 已有 3 个 handle 函数
- [x] GUI 端到端：ProjectSelector 返回入口可见 / BrandHeader pill 可切换 — **SKIPPED**（按 spec 跳过）
