# 在线全量运行时测试 Spec

> **来源**: 用户需求 — 启动项目并在线测试所有功能，必须提供可视证据（截图/响应快照/日志文件），不能仅凭"语法通过"或"日志正常"判定通过
> **优先级**: P0
> **范围**: 全项目（FastAPI 后端 + React 前端 + 数据库 + CLI/Hermes 集成层）

## Why

现有的 `system-wide-test-and-bug-fix` spec 仅完成代码级 Bug 修复与导入/编译类语法校验，**未实际启动服务、调用接口、运行 UI** 来端到端验证功能可用性。用户明确要求"在线测试" + "测试成功证据（截图或其他东西）"，即必须：

- 真正把后端服务 `uvicorn` 跑起来
- 真正把前端 `vite`（或构建后的 `dist`）跑起来
- 用 `curl` 真实调用后端 17 个 API 路由
- 用 Chrome headless 真实渲染前端核心页面并截图
- 把所有响应、截图、运行日志落到 `data/runtime_test_evidence/` 作为可核验证据

## What Changes

### 1. 测试环境准备
- **启动后端服务**：在后台 terminal 启动 `python run.py`（监听 8080），等待 `/health` 返回 200
- **启动前端服务**：直接用 `frontend/dist`（已构建产物）由 FastAPI StaticFiles 挂载，**或**启动 `npm run dev`（5173 端口）
- **浏览器驱动**：使用本机已安装的 `google-chrome` 头模式（无 playwright/pyppeteer）
- **证据目录**：创建 `data/runtime_test_evidence/`，按模块分子目录存放证据

### 2. 后端接口在线测试（17 个路由模块）
逐个调用每个模块的健康路由与核心写入路由，校验返回 200 + 业务字段非空：

- `/health` 根健康检查
- `/api/agents` 智能体列表
- `/api/sessions` 会话列表 / 创建
- `/api/conversations` 对话记录
- `/api/tasks` 任务列表
- `/api/stats` 统计概览
- `/api/usage` 用量监控
- `/api/quota` 配额管控
- `/api/hermes` Hermes 智能调度
- `/api/workflow` 工作流
- `/api/dashboard` 工作流监控
- `/api/architecture` 架构设计
- `/api/evaluation` 集成评测
- `/api/security` 安全管理
- `/api/git` Git 版本管理
- `/api/memory` 代码记忆库
- `/api/config` 全局配置中心
- `/api/workspace` 工作空间管理
- `/api/worktree` Git Worktree
- `/docs` Swagger API 文档
- `/` 根路径

### 3. 前端页面在线渲染测试
- 用 `google-chrome --headless --screenshot` 渲染以下 URL 并产出 PNG 截图到 `data/runtime_test_evidence/screenshots/`：
  - `/` 首页（ModeSelector 模式选择）
  - `/index.html` 完整 SPA
- 同时输出浏览器 console 日志到 `data/runtime_test_evidence/screenshots/_console.log`

### 4. 测试证据归档
- 每个 API 调用产出独立 `<模块>_<动作>.json` 响应快照（含 HTTP 状态码、耗时、响应体）
- 每个页面产出 `<页面名>.png` 截图
- 全流程产出 `data/runtime_test_evidence/RUNTIME_TEST_REPORT.md` 总结报告，含：
  - 测试时间、测试人员、测试环境
  - 每个测试用例的"操作 → 期望 → 实际 → 结论"
  - 失败用例的根因分析（如有）
  - 全部证据文件的相对路径索引
- 失败用例必须为每个失败项输出"症状 + 最小复现命令 + 影响范围"

## Impact

- Affected specs: 无（独立测试 spec）
- Affected code: 不修改任何业务代码（仅在 `data/runtime_test_evidence/` 写入证据文件）
- 新增文件：
  - `data/runtime_test_evidence/`（运行时证据根目录）
  - `data/runtime_test_evidence/api_responses/*.json`（接口响应快照）
  - `data/runtime_test_evidence/screenshots/*.png`（页面截图）
  - `data/runtime_test_evidence/RUNTIME_TEST_REPORT.md`（测试报告）

## 约束

- **必须真实启动服务**，不能仅靠 `import` 测试或代码检查断言通过
- **必须产出可视证据**：每条测试用例至少有 1 个 JSON 快照或 1 张 PNG 截图
- **失败必须如实记录**：不允许"全部通过"的虚假结论
- **不能修改业务代码**：本次任务仅测试，不修 Bug；Bug 修复归入独立 spec
- **证据可核验**：所有快照必须包含 HTTP 状态码、调用 URL、响应体三要素
- **测试脚本可重跑**：所有调用命令落到脚本中，下次可一键复现

---

## ADDED Requirements

### Requirement: 后端服务真实启动

系统 SHALL 真实启动 FastAPI 后端服务并验证可访问。

#### Scenario: 后端启动成功
- **WHEN** 执行 `python run.py`
- **THEN** 监听 0.0.0.0:8080
- **AND** `curl http://localhost:8080/health` 返回 `{"status":"ok",...}` 200

### Requirement: 前端页面真实渲染

系统 SHALL 真实渲染前端页面并产出截图。

#### Scenario: 首页渲染
- **WHEN** 使用 `google-chrome --headless --screenshot` 访问 `http://localhost:8080/`
- **THEN** 产出非空 PNG 文件
- **AND** 文件尺寸 > 1KB（排除空白页）

### Requirement: 17 个 API 路由在线调用

系统 SHALL 逐个调用 17 个 API 模块的核心端点并产出响应快照。

#### Scenario: 读取类接口调用
- **WHEN** 调用 GET 类接口（如 `/api/agents`、`/api/sessions` 等）
- **THEN** 返回 200
- **AND** 响应体为合法 JSON 数组或对象

#### Scenario: 健康检查 / 文档类接口
- **WHEN** 调用 `/health`、`/docs`、`/`
- **THEN** 全部返回 200
- **AND** `/docs` 返回 HTML 包含 Swagger UI

### Requirement: 证据归档完整

系统 SHALL 将所有证据归档到 `data/runtime_test_evidence/`。

#### Scenario: 证据文件存在
- **WHEN** 测试执行完毕
- **THEN** `data/runtime_test_evidence/RUNTIME_TEST_REPORT.md` 存在
- **AND** `data/runtime_test_evidence/api_responses/` 至少包含 17 个 JSON 文件
- **AND** `data/runtime_test_evidence/screenshots/` 至少包含 1 张 PNG

### Requirement: 测试报告诚实

系统 SHALL 诚实记录所有测试结果，禁止虚报"全部通过"。

#### Scenario: 失败用例如实记录
- **WHEN** 任何测试用例失败
- **THEN** 在 `RUNTIME_TEST_REPORT.md` 中以表格形式记录：失败端点、HTTP 状态码、错误信息、截图路径
- **AND** 不允许在失败存在时标注"全部通过"

## MODIFIED Requirements

无（本任务不修改任何已有 spec 的需求）

## REMOVED Requirements

无
