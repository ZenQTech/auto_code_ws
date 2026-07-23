# Checklist: 系统全量测试与 Bug 修复

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/system-wide-test-and-bug-fix/spec.md)

---

## 后端运行时崩溃 Bug

- [x] api/security.py load_persisted_records() 有 return 语句
- [x] api/sessions.py 空会话清理逻辑正确
- [x] api/tasks.py 状态过滤使用 TaskStatus 枚举
- [x] api/git.py 使用 app.state.git_manager 单例

## 后端中等 Bug

- [x] api/stats.py 空值安全处理
- [x] api/evaluation.py 不访问私有属性
- [x] api/worktree.py 和 api/dashboard.py 有 state 属性检查
- [x] services/__init__.py 无重复导出覆盖
- [x] services/commit_hook_handler.py 不访问私有属性
- [x] services/task_planner.py 无重复枚举定义
- [x] services/memory_store.py 使用异步锁
- [x] services/git_manager.py 同步方法不阻塞事件循环

## 后端代码质量

- [x] services/hermes_service.py 无冗余检查
- [x] api/hermes.py 使用 app.state.hermes_service
- [x] api/config_endpoint.py 使用 settings.get_project_root()
- [x] api/agents.py AgentResponse 类已删除或使用
- [x] api/sessions.py 无未使用导入
- [x] api/security.py 使用相对导入

## 弃用 API

- [x] 全局无 datetime.utcnow() 调用
- [x] 全局无 asyncio.iscoroutine() 调用
- [x] 全局无 datetime.now() 无时区参数调用

## 前端高优先级

- [x] App.tsx handleSendMessage 不每次按键重建
- [x] App.tsx 无 formatTokens 死代码
- [x] BrandHeader.tsx 无废弃 props
- [x] Sidebar.tsx 折叠态按 appMode 过滤
- [x] Sidebar.tsx 回收站操作后刷新父组件
- [x] SettingsPanel.tsx useEffect 不依赖 showToast
- [x] CodeViewer.tsx 有保存机制

## 前端中优先级

- [x] App.tsx 无 handleSwitchMode 死代码
- [x] App.tsx displayAgents 无闪烁
- [x] App.tsx useEffect 不覆盖本地 sessions 更新
- [x] FileExplorer.tsx clipboard 有错误处理
- [x] useApi.ts WebSocket 有重连机制
- [x] useApi.ts useSessions 有自动刷新
- [x] index.css @import 改为 link preload

## 前端低优先级

- [x] MessageBubble.tsx copyToClipboard 提取为 utils
- [x] ThinkingBlock.tsx useEffect 包含 content 依赖
- [x] AgentChatCard.tsx onAgentChanged 不导致定时器重建
- [x] 面板组件使用共享 PanelSkeleton
- [x] App.tsx 已拆分（QuotaDisplay 组件）

## 未完成 Spec

- [x] code-structure-optimization 全部完成
- [x] visual-polish-and-motion 构建验证完成
- [x] remove-brandheader-mode-pill 构建验证完成
- [x] simplify-session-title-display 全部完成
- [x] mode-switcher-and-back-to-mode-selector 构建验证完成

## 系统验证

- [x] Python 导入测试通过
- [x] 后端 API 端点测试通过
- [x] 前端 TypeScript 编译通过
- [x] 前端构建通过
- [x] 所有 spec tasks.md 和 checklist.md 标记完成
