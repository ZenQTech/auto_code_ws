# 前端构建产物刷新与 ABORTED 日志修复 Spec

## Why
当前浏览器加载的仍是旧构建产物 `/assets/index-Bic32m5_.js`，该 bundle 不包含最新源码中的 `session_mode`、`workflow_started`、`clarify_questions`、`ClarificationCard` 与 `onClarifyQuestions` 逻辑，因此网页仍不会显示需求澄清选项卡片。同时控制台中的 `net::ERR_ABORTED /api/hermes/chat/stream` 大概率来自旧 bundle 或用户主动停止；`net::ERR_ABORTED /api/sessions/cleanup-empty` 来自 beforeunload 阶段的 fetch keepalive 请求被浏览器卸载中止。

## What Changes
- 重新构建 `frontend/dist`，确保后端挂载的静态资源使用最新前端代码
- 验证新 dist bundle 包含 `clarify_questions`、`workflow_started`、`session_mode`、`提交回答` 等关键逻辑
- 将 beforeunload 的空会话清理从 `fetch(..., { keepalive: true, method: 'DELETE' })` 改为 `navigator.sendBeacon()` 优先发送
- 后端为 `/api/sessions/cleanup-empty` 增加 POST 兼容端点，供 `sendBeacon` 调用
- 保留 fetch keepalive 作为 sendBeacon 不可用时的降级方案

## Impact
- Affected specs: clarify-interactive-options, fix-first-round-clarify-push, fix-streaming-no-output
- Affected code:
  - `frontend/dist/*` - 重新生成生产构建产物
  - `frontend/src/App.tsx` - beforeunload 清理改用 sendBeacon 优先
  - `backend/app/api/sessions.py` - 增加 POST cleanup-empty 兼容端点

---

## ADDED Requirements

### Requirement: 前端 dist 使用最新源码构建
系统 SHALL 确保后端静态挂载目录 `frontend/dist` 中的 bundle 是最新源码构建结果，而不是旧的 `index-Bic32m5_.js`。

#### Scenario: 构建产物包含澄清交互逻辑
- **WHEN** 执行前端生产构建
- **THEN** `frontend/dist/index.html` 引用新的 hashed JS 文件
- **AND** 新 JS bundle 包含 `clarify_questions`、`workflow_started`、`session_mode`、`提交回答`、`请选择或补充以下信息` 等关键字符串
- **AND** 浏览器加载新 bundle 后，coding 模式请求体包含 `session_mode: "coding"`

#### Scenario: 需求澄清选项卡片显示
- **WHEN** 用户在 coding 模式发送开发需求
- **THEN** 后端返回 `workflow_started` 与 `clarify_questions` SSE 事件
- **AND** 前端消费 `clarify_questions` 并渲染交互式 ClarificationCard
- **AND** 每个问题包含候选选项和"其他（自由输入）"项

### Requirement: cleanup-empty 卸载请求不再产生 fetch ABORTED
系统 SHALL 在页面卸载时优先使用 `navigator.sendBeacon()` 发送空会话清理请求，避免 fetch keepalive 被浏览器标记为 ABORTED。

#### Scenario: 浏览器支持 sendBeacon
- **WHEN** 页面触发 beforeunload
- **THEN** 前端调用 `navigator.sendBeacon('/api/sessions/cleanup-empty')`
- **AND** 后端 POST `/api/sessions/cleanup-empty` 执行清理
- **AND** 控制台不再产生 cleanup-empty 的 `net::ERR_ABORTED`

#### Scenario: 浏览器不支持 sendBeacon
- **WHEN** `navigator.sendBeacon` 不可用
- **THEN** 前端降级使用原有 fetch keepalive 清理逻辑
- **AND** 不影响页面关闭流程

## MODIFIED Requirements

### Requirement: sessions cleanup-empty 支持 POST
**原行为**: 仅支持 DELETE `/api/sessions/cleanup-empty`。
**新行为**: 同一路径同时支持 DELETE 与 POST；DELETE 保持兼容，POST 供 `sendBeacon` 调用。

### Requirement: chat/stream ABORTED 判定
**说明**: 用户主动点击停止按钮时 `AbortController.abort()` 导致的 `net::ERR_ABORTED /api/hermes/chat/stream` 是预期行为；正常完成时不得由旧 bundle 或 reader.cancel 造成 ABORTED。通过刷新 dist 与移除 reader.cancel 的最新 bundle 生效来解决正常完成场景。
