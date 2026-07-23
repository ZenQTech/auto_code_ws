# Tasks

- [x] Task 1: 删除 BrandHeader 模式 pill
  - 1.1 在 `frontend/src/components/BrandHeader.tsx` v1.2.0 → v1.3.0 找到 Session 标题旁模式 pill 容器
  - 1.2 移除 `{appMode && (<div className="hidden md:flex items-center gap-2">...</div>)}` 整个块
  - 1.3 Session 标题恢复到 spec 简化的纯 h2 形式（无外层容器包裹）
  - 1.4 保留 `appMode` 与 `onSwitchMode` props 签名（不删除）
  - 1.5 保留其他 BrandHeader 功能（Logo / 新建按钮 / 下拉菜单 / 移动端响应）
  - 1.6 文件头 v1.3.0 修改记录追加：`# - 2026-06-24 | v1.3.0 | 删除模式切换 pill（信息密度过高；保留 Sidebar/ProjectSelector 入口）`

- [x] Task 2: App.tsx 清理
  - 2.1 在 `frontend/src/App.tsx` v2.10.2 → v2.10.3 BrandHeader 引用**不传** `onSwitchMode`（按需，可保留也可删除）
  - 2.2 **保留** `handleSwitchMode` 回调函数（不删除，可能后续其他组件复用）
  - 2.3 文件头 v2.10.3 修改记录追加：`# - 2026-06-24 | v2.10.3 | BrandHeader 取消 onSwitchMode 透传（pill 删除后无消费者）`

- [x] Task 3: 构建与回归验证
  - 3.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
  - 3.2 前端 `npm run build` 无编译错误
  - 3.3 grep 验证 BrandHeader 已无 "💬" / "⚡" 字符（pill 文本）
  - 3.4 grep 验证 BrandHeader 已无 `onSwitchMode?.()` 调用
  - 3.5 grep 验证 App.tsx 仍保留 `handleSwitchMode` 函数定义
  - 3.6 GUI 端到端：BrandHeader 中间区域仅显示 Session 标题，无模式 pill

# Task Dependencies
- Task 1（BrandHeader）独立
- Task 2（App.tsx）依赖 Task 1
- Task 3（验证）依赖 Task 1-2 完成
