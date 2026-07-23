# 系统全量 Bug 修复 Spec

## Why
通过全量代码审查发现项目存在 2 个前端编译阻断性 bug（TypeScript 类型缺失导致 `tsc -b` 失败）和 20+ 个功能/质量问题（重复代码、空桩函数、缺少错误处理等），需要系统性修复以确保项目可编译、可运行、功能完整。

## What Changes
- **前端编译阻断修复**：补充缺失的 `StageDetail` 和 `LoopWorkflowStatus` 类型定义
- **前端功能修复**：SSE 流式 AbortController、归档按钮实现、工具栏按钮实现、React ErrorBoundary、硬编码配额替换、剪贴板反馈、FileExplorer 错误提示改用 Toast
- **前端代码质量**：消除重复代码（renderMarkdown、formatRelativeTime、getFileIcon、severityColorMap、ThinkingBlock 冲突）、修复 CSS 重复 keyframes
- **后端代码质量**：修复 `datetime.utcnow()` 弃用、`asyncio.ensure_future` 弃用、AgentManager 线程安全、同步文件 I/O 改异步、bare except 改为具体异常
- **后端安全**：配置文件中硬编码 API Token 改为环境变量读取

## Impact
- Affected specs: 所有已完成的 spec（本 spec 为全局修复，不新增功能）
- Affected code:
  - `frontend/src/types/index.ts` - 新增类型定义
  - `frontend/src/App.tsx` - SSE AbortController、ErrorBoundary、配额
  - `frontend/src/components/*.tsx` - 多个组件修复
  - `frontend/src/index.css` - 删除重复 keyframes
  - `frontend/src/hooks/useApi.ts` - SSE AbortController
  - `backend/app/services/agent_roles/*.py` - datetime 弃用修复
  - `cli_integration/agent_manager.py` - 线程安全、datetime 弃用
  - `cli_integration/base_executor.py` - asyncio.ensure_future 弃用
  - `hermes_integration/hermes_memory.py` - 同步 I/O 改异步、bare except
  - `config/auto_code_config.yaml` - API Token 环境变量化

## ADDED Requirements

### Requirement: 前端 TypeScript 编译通过
系统 SHALL 确保 `tsc -b` 编译零错误。

#### Scenario: StageDetail 类型缺失
- **WHEN** TypeScript 编译器处理 `StageViewer.tsx`
- **THEN** `StageDetail` 类型在 `types/index.ts` 中已定义，编译通过

#### Scenario: LoopWorkflowStatus 类型缺失
- **WHEN** TypeScript 编译器处理 `WorkflowDashboard.tsx`
- **THEN** `LoopWorkflowStatus` 类型在 `types/index.ts` 中已定义，编译通过

### Requirement: SSE 流式请求可取消
系统 SHALL 支持通过 AbortController 取消正在进行的 SSE 流式请求。

#### Scenario: 用户点击停止按钮
- **WHEN** 用户在流式响应进行中点击停止
- **THEN** SSE 连接被中止，后端不再继续发送数据

### Requirement: React ErrorBoundary 全局异常捕获
系统 SHALL 使用 React ErrorBoundary 包裹根组件，防止未捕获异常导致白屏。

#### Scenario: 组件渲染异常
- **WHEN** 任意子组件抛出未捕获异常
- **THEN** 显示友好的错误回退 UI，而非白屏

### Requirement: 硬编码配额从 API 获取
系统 SHALL 从后端 API 获取配额限制，而非使用前端硬编码值。

#### Scenario: 显示配额使用情况
- **WHEN** 用户查看配额面板
- **THEN** 配额上限来自 API 返回数据，而非硬编码 10000

### Requirement: 归档按钮功能实现
系统 SHALL 实现会话归档功能（调用后端 API 更新会话状态）。

#### Scenario: 用户归档会话
- **WHEN** 用户在侧边栏点击归档按钮
- **THEN** 会话被标记为已归档，从活跃列表中移除

### Requirement: 消息工具栏按钮功能实现
系统 SHALL 实现消息气泡工具栏的重新生成、点赞、踩、朗读按钮。

#### Scenario: 用户点击重新生成
- **WHEN** 用户点击消息气泡的重新生成按钮
- **THEN** 触发重新生成请求

### Requirement: 剪贴板复制用户反馈
系统 SHALL 在复制到剪贴板成功后显示 Toast 提示。

#### Scenario: 用户复制消息内容
- **WHEN** 用户点击复制按钮且复制成功
- **THEN** 显示"已复制到剪贴板"Toast

### Requirement: FileExplorer 错误提示改用 Toast
系统 SHALL 使用 Toast 组件替代 `alert()` 显示文件操作错误。

#### Scenario: 文件删除失败
- **WHEN** 文件删除 API 返回错误
- **THEN** 显示 Toast 错误提示，而非浏览器 alert 弹窗

### Requirement: 前端重复代码消除
系统 SHALL 将重复的工具函数提取为共享模块。

#### Scenario: renderMarkdown 复用
- **WHEN** PlanViewer 和 ArchitectureViewer 需要渲染 Markdown
- **THEN** 两者使用同一个共享 `renderMarkdown` 函数

### Requirement: CSS 重复 keyframes 清理
系统 SHALL 删除 `index.css` 中重复定义的 `@keyframes`。

#### Scenario: 动画正常播放
- **WHEN** toast/modal 动画触发
- **THEN** 动画效果与修复前一致，无重复定义

### Requirement: Python datetime.utcnow() 弃用修复

系统 SHALL 将所有 `datetime.utcnow()` 替换为 `datetime.now(timezone.utc)`。

#### Scenario: 时间戳生成
- **WHEN** 系统生成 UTC 时间戳
- **THEN** 使用 `datetime.now(timezone.utc)` 而非已弃用的 `datetime.utcnow()`
- **AND** 必须 `from datetime import timezone` 导入 `timezone`
- **AND** **严禁**使用 `datetime.UTC` —— 该属性仅在 Python 3.11+ 可用，当前环境是 Python 3.10.12

> **修正说明**: 上一版本规范建议 `datetime.now(datetime.UTC)` 是**错误的**（`datetime.UTC` 在 Python 3.10 不存在，会抛 `AttributeError`）。正确做法是 `datetime.now(timezone.utc)`（跨版本兼容）。

### Requirement: Python asyncio.ensure_future 弃用修复
系统 SHALL 将所有 `asyncio.ensure_future()` 替换为 `asyncio.create_task()`。

#### Scenario: 异步任务创建
- **WHEN** 系统创建后台异步任务
- **THEN** 使用 `asyncio.create_task()` 而非已弃用的 `asyncio.ensure_future()`

### Requirement: AgentManager 线程安全
系统 SHALL 使用 `asyncio.Lock` 保护 `AgentManager._agents` 字典的并发访问。

#### Scenario: 并发注册/注销 Agent
- **WHEN** 多个协程同时注册或注销 Agent
- **THEN** 不会发生竞态条件导致数据不一致

### Requirement: HermesMemoryManager 异步文件 I/O
系统 SHALL 将 `HermesMemoryManager` 中的同步文件 I/O 替换为异步操作。

#### Scenario: 保存会话摘要
- **WHEN** `summarize_session` 写入 JSON 文件
- **THEN** 使用 `aiofiles` 异步写入，不阻塞事件循环

### Requirement: bare except 替换为具体异常
系统 SHALL 将所有 `except Exception: pass` 替换为具体异常类型并记录日志。

#### Scenario: JSON 解析失败
- **WHEN** `list_skills` 解析 JSON 文件失败
- **THEN** 捕获 `json.JSONDecodeError` 并记录警告日志

### Requirement: API Token 环境变量化
系统 SHALL 从环境变量读取 API Token，配置文件中仅保留占位符或引用。

#### Scenario: 生产环境部署
- **WHEN** 平台在生产环境启动
- **THEN** API Token 从环境变量读取，不暴露在配置文件中
