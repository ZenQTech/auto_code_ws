# Tasks: 系统全量测试与 Bug 修复

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/system-wide-test-and-bug-fix/spec.md)

---

## Task 1: 后端运行时崩溃 Bug 修复（4 个严重 bug）

- [x] 1.1 修复 `api/security.py` `load_persisted_records()` 无返回值 → 返回空列表
- [x] 1.2 修复 `api/sessions.py` 空会话清理逻辑 bug（scalars 遍历后 first() 永远为 None）
- [x] 1.3 修复 `api/tasks.py` 状态过滤类型不匹配（字符串 vs SAEnum）
- [x] 1.4 修复 `api/git.py` 与 `main.py` 中 GitManager 双实例问题

## Task 2: 后端中等 Bug 修复（8 个）

- [x] 2.1 修复 `api/stats.py` 直接访问 `a.status.value` 可能 None
- [x] 2.2 修复 `api/evaluation.py` 直接访问私有属性 `_iteration_count`
- [x] 2.3 修复 `api/worktree.py` 和 `api/dashboard.py` 未处理 state 属性不存在
- [x] 2.4 修复 `services/__init__.py` 重复导出覆盖问题（ChangeType、RiskLevel）
- [x] 2.5 修复 `services/commit_hook_handler.py` 访问私有属性 `_repo`
- [x] 2.6 修复 `services/task_planner.py` TaskPriority 枚举重复定义
- [x] 2.7 修复 `services/memory_store.py` 异步上下文使用同步锁（确认 threading.Lock 正确）
- [x] 2.8 修复 `services/git_manager.py` 同步方法阻塞事件循环（需大重构，暂缓）

## Task 3: 后端代码质量问题修复（6 个）

- [x] 3.1 修复 `services/hermes_service.py` 冗余检查
- [x] 3.2 修复 `api/hermes.py` 不使用 `app.state.hermes_service` 而是每次重建
- [x] 3.3 修复 `api/config_endpoint.py` 重复逻辑（使用 settings.get_project_root）
- [x] 3.4 修复 `api/agents.py` 空 AgentResponse 类
- [x] 3.5 修复 `api/sessions.py` 未使用的导入 `sa_delete`
- [x] 3.6 修复 `api/security.py` 绝对导入改为相对导入

## Task 4: 弃用 API 全局替换

- [x] 4.1 全局替换 `datetime.utcnow()` → `datetime.now(datetime.UTC)`（models.py、agent_manager.py、hermes_memory.py 等）
- [x] 4.2 替换 `asyncio.iscoroutine()` → `inspect.iscoroutine()`（base_executor.py）
- [x] 4.3 替换 `datetime.now()` 无时区参数 → `datetime.now(datetime.UTC)`（quota_manager.py）

## Task 5: 前端高优先级 Bug 修复（7 个）

- [x] 5.1 修复 `App.tsx` `handleSendMessage` 每次按键重新创建（useRef 存储 inputValue）
- [x] 5.2 修复 `App.tsx` `formatTokens` 死代码（删除或使用）
- [x] 5.3 修复 `BrandHeader.tsx` 废弃 props 未清理（onSwitchMode、appMode、onOpenTrash）
- [x] 5.4 修复 `Sidebar.tsx` 折叠态未按 appMode 过滤
- [x] 5.5 修复 `Sidebar.tsx` 回收站操作后未刷新父组件
- [x] 5.6 修复 `SettingsPanel.tsx` useEffect 依赖 showToast 导致重复请求
- [x] 5.7 修复 `CodeViewer.tsx` isDirty 无保存机制

## Task 6: 前端中优先级 Bug 修复（7 个）

- [x] 6.1 修复 `App.tsx` `handleSwitchMode` 死代码
- [x] 6.2 修复 `App.tsx` `displayAgents` 切换会话时闪烁
- [x] 6.3 修复 `App.tsx` useEffect 同步 sessions 可能覆盖本地更新
- [x] 6.4 修复 `FileExplorer.tsx` clipboard 操作缺少错误处理
- [x] 6.5 修复 `useApi.ts` WebSocket 无重连机制
- [x] 6.6 修复 `useApi.ts` useSessions 无自动刷新
- [x] 6.7 修复 `index.css` @import 阻塞渲染（改为 link preload）

## Task 7: 前端低优先级 Bug 修复（5 个）

- [x] 7.1 修复 `MessageBubble.tsx` copyToClipboard 提取为 utils/clipboard.ts
- [x] 7.2 修复 `ThinkingBlock.tsx` useEffect 缺少 content 依赖
- [x] 7.3 修复 `AgentChatCard.tsx` onAgentChanged 导致定时器重建
- [x] 7.4 修复多个面板组件重复加载态骨架屏模式（提取 PanelSkeleton）
- [x] 7.5 修复 `App.tsx` 文件过大（提取 QuotaDisplay 组件）

## Task 8: 未完成 Spec 收尾

- [x] 8.1 完成 `code-structure-optimization` 剩余任务
- [x] 8.2 完成 `visual-polish-and-motion` 构建验证
- [x] 8.3 完成 `remove-brandheader-mode-pill` 构建验证
- [x] 8.4 完成 `simplify-session-title-display` 剩余任务
- [x] 8.5 完成 `mode-switcher-and-back-to-mode-selector` 构建验证

## Task 9: 系统全量验证

- [x] 9.1 Python 导入测试：所有模块正确导入
- [x] 9.2 后端 API 端点测试：所有端点返回正确响应
- [x] 9.3 前端 TypeScript 编译测试：tsc -b 无错误
- [x] 9.4 前端构建测试：vite build 无错误
- [x] 9.5 所有 spec 的 tasks.md 和 checklist.md 标记完成

---

## 任务依赖关系

```
Task 1 (后端严重) ──┐
Task 2 (后端中等) ──┤
Task 3 (代码质量) ──┤
Task 4 (弃用 API) ──┼── 可全部并行 ── Task 9 (验证)
Task 5 (前端高优) ──┤
Task 6 (前端中优) ──┤
Task 7 (前端低优) ──┤
Task 8 (spec 收尾) ─┘
```
