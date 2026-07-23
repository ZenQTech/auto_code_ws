# Checklist

## Task 1 — 删除 BrandHeader 模式 pill
- [x] `BrandHeader.tsx` v1.2.0 → v1.3.0
- [x] 模式 pill 容器 `{appMode && (<div className="hidden md:flex items-center gap-2">...</div>)}` 已移除
- [x] Session 标题恢复为纯 h2 形式
- [x] 保留 `appMode` 与 `onSwitchMode` props 签名
- [x] 保留其他 BrandHeader 功能（Logo / 新建按钮 / 下拉菜单 / 移动端响应）
- [x] 文件头 v1.3.0 修改记录已写入

## Task 2 — App.tsx 清理
- [x] `App.tsx` v2.10.2 → v2.10.3
- [x] BrandHeader 引用不传 `onSwitchMode`
- [x] 保留 `handleSwitchMode` 函数定义
- [x] 文件头 v2.10.3 修改记录已写入

## Task 3 — 构建与回归
- [x] 后端启动无报错
- [x] 前端构建无编译错误
- [x] grep 验证 BrandHeader 已无 "💬" / "⚡" pill 文本
- [x] grep 验证 BrandHeader 已无 `onSwitchMode?.()` 调用
- [x] grep 验证 App.tsx 保留 `handleSwitchMode` 函数定义
- [x] GUI 端到端：BrandHeader 仅显示 Session 标题（SKIPPED — 需 GUI 环境）
