# 系统全量测试与 Bug 修复 Spec

> **来源**: 用户需求 — 系统阅读所有代码、specs、修改日志，全量测试，抓取并修复所有 bug
> **优先级**: P0
> **范围**: 全项目（前端 + 后端 + CLI 集成层 + Hermes 集成层）

## Why

经过对全部 32 个 spec、70+ 个 Python 文件、34 个前端文件的系统审查，发现：
- **后端**：4 个严重 bug（运行时崩溃）、8 个中等 bug、5 类弃用 API、8 个代码质量问题、4 个集成风险
- **前端**：8 个高优先级 bug、7 个中优先级 bug、5 个低优先级问题
- **未完成 spec**：4 个（code-structure-optimization、system-wide-bug-fix、code-snippet-tools-and-aside-mode、project-optimization-roadmap）
- **部分完成 spec**：4 个（visual-polish-and-motion、remove-brandheader-mode-pill、simplify-session-title-display、mode-switcher-and-back-to-mode-selector）

需要系统性地修复所有已知 bug，确保项目可编译、可运行、功能完整。

## What Changes

### 后端修复（高优先级）
- **修复 `api/security.py` `load_persisted_records()` 无返回值导致运行时崩溃**
- **修复 `api/sessions.py` 空会话清理逻辑 bug（scalars 遍历后 first() 永远为 None）**
- **修复 `api/tasks.py` 状态过滤类型不匹配（字符串 vs SAEnum）**
- **修复 `api/git.py` 与 `main.py` 中 GitManager 双实例问题**
- **修复 `api/stats.py` 直接访问 `a.status.value` 可能 None**
- **修复 `api/evaluation.py` 直接访问私有属性**
- **修复 `api/worktree.py` 和 `api/dashboard.py` 未处理 state 属性不存在**
- **修复 `services/__init__.py` 重复导出覆盖问题**
- **修复 `services/commit_hook_handler.py` 访问私有属性**
- **修复 `services/task_planner.py` TaskPriority 枚举重复定义**
- **修复 `services/memory_store.py` 异步上下文使用同步锁**
- **修复 `services/git_manager.py` 同步方法阻塞事件循环**
- **修复 `services/hermes_service.py` 冗余检查**
- **修复 `api/hermes.py` 不使用 `app.state.hermes_service` 而是每次重建**
- **修复 `api/config_endpoint.py` 重复逻辑**
- **修复 `api/agents.py` 空 AgentResponse 类**
- **修复 `api/sessions.py` 未使用的导入**

### 后端修复（弃用 API）
- **全局替换 `datetime.utcnow()` → `datetime.now(datetime.UTC)`**
- **替换 `asyncio.iscoroutine()` → `inspect.iscoroutine()`**
- **替换 `datetime.now()` 无时区参数 → `datetime.now(datetime.UTC)`**

### 前端修复（高优先级）
- **修复 `App.tsx` `handleSendMessage` 每次按键重新创建**
- **修复 `App.tsx` `formatTokens` 死代码**
- **修复 `BrandHeader.tsx` 废弃 props 未清理**
- **修复 `Sidebar.tsx` 折叠态未按 appMode 过滤**
- **修复 `Sidebar.tsx` 回收站操作后未刷新父组件**
- **修复 `SettingsPanel.tsx` useEffect 依赖 showToast 导致重复请求**
- **修复 `CodeViewer.tsx` isDirty 无保存机制**

### 前端修复（中优先级）
- **修复 `App.tsx` `handleSwitchMode` 死代码**
- **修复 `App.tsx` `displayAgents` 切换会话时闪烁**
- **修复 `App.tsx` useEffect 同步 sessions 可能覆盖本地更新**
- **修复 `FileExplorer.tsx` clipboard 操作缺少错误处理**
- **修复 `useApi.ts` WebSocket 无重连机制**
- **修复 `useApi.ts` useSessions 无自动刷新**
- **修复 `index.css` @import 阻塞渲染**

### 前端修复（低优先级）
- **修复 `MessageBubble.tsx` copyToClipboard 可提取为 utils**
- **修复 `ThinkingBlock.tsx` useEffect 缺少 content 依赖**
- **修复 `AgentChatCard.tsx` onAgentChanged 导致定时器重建**
- **修复多个面板组件重复加载态骨架屏模式**

### 未完成 Spec 修复
- **完成 `code-structure-optimization` 剩余任务**
- **完成 `visual-polish-and-motion` 构建验证**
- **完成 `remove-brandheader-mode-pill` 构建验证**
- **完成 `simplify-session-title-display` 剩余任务**
- **完成 `mode-switcher-and-back-to-mode-selector` 构建验证**

## Impact

- Affected specs: system-wide-bug-fix（扩展）、code-structure-optimization（完成）、visual-polish-and-motion（完成）、remove-brandheader-mode-pill（完成）、simplify-session-title-display（完成）、mode-switcher-and-back-to-mode-selector（完成）
- Affected code: 全项目范围

---

## ADDED Requirements

### Requirement: 后端运行时 Bug 修复

系统 SHALL 修复所有可能导致运行时崩溃的 bug。

#### Scenario: api/security.py load_persisted_records 修复
- **WHEN** `load_persisted_records()` 被调用
- **THEN** SHALL 返回 `List[ReviewRecord]`（空列表或记录列表），而非隐式 None

#### Scenario: api/sessions.py 空会话清理修复
- **WHEN** `create_session` 检测到空会话
- **THEN** SHALL 正确删除空会话并在插入新 Session 前 flush

#### Scenario: api/tasks.py 状态过滤修复
- **WHEN** 按状态过滤任务
- **THEN** SHALL 将字符串状态转换为 `TaskStatus` 枚举后再比较

#### Scenario: api/git.py GitManager 单例化
- **WHEN** Git API 端点需要 GitManager
- **THEN** SHALL 使用 `request.app.state.git_manager` 而非创建新实例

#### Scenario: api/stats.py 空值安全
- **WHEN** 智能体状态为 None
- **THEN** SHALL 安全处理而非抛出 AttributeError

### Requirement: 弃用 API 全局替换

系统 SHALL 将所有弃用 API 替换为推荐替代方案。

#### Scenario: datetime.utcnow 替换
- **WHEN** 任何代码需要 UTC 时间
- **THEN** SHALL 使用 `datetime.now(datetime.UTC)` 而非 `datetime.utcnow()`

#### Scenario: asyncio.iscoroutine 替换
- **WHEN** 需要检查对象是否为协程
- **THEN** SHALL 使用 `inspect.iscoroutine()` 而非 `asyncio.iscoroutine()`

### Requirement: 前端高优先级 Bug 修复

系统 SHALL 修复所有前端高优先级 bug。

#### Scenario: handleSendMessage 性能优化
- **WHEN** 用户在输入框中输入
- **THEN** `handleSendMessage` 不应在每次按键时重新创建

#### Scenario: Sidebar 折叠态过滤
- **WHEN** Sidebar 处于折叠态
- **THEN** SHALL 仅显示当前 appMode 对应的会话圆点

#### Scenario: CodeViewer 保存机制
- **WHEN** 用户在 Monaco Editor 中编辑代码
- **THEN** SHALL 提供保存按钮或自动保存逻辑

### Requirement: 未完成 Spec 收尾

系统 SHALL 完成所有未完成的 spec 任务。

#### Scenario: code-structure-optimization 完成
- **WHEN** 所有优化任务完成
- **THEN** SHALL 补全安全审核路由、合并配置文件、抽取公共基类、统一导入风格等

#### Scenario: 部分完成 spec 构建验证
- **WHEN** visual-polish-and-motion、remove-brandheader-mode-pill、mode-switcher-and-back-to-mode-selector 的构建验证完成
- **THEN** SHALL 所有 tasks.md 和 checklist.md 标记为 [x]
