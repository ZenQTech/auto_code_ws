# Session 404 自动回退 Spec

## Why
用户实测报告浏览器控制台错误：**`获取会话详情失败: Error: Session 不存在`**，定位根因为：
1. 用户 localStorage 中存有 `current_session_id` 指向某个已不存在的 Session（被删除 / 归档 / 数据库重置 / 开发期清理 db 文件）
2. App.tsx 启动 useEffect（行 212-230）读取该 ID → `setCurrentSessionId(stored)`
3. `useSessionDetail` hook 发起 `GET /api/sessions/{id}/detail` → 后端 404 → `console.error('获取会话详情失败:', e)`（useApi.ts:508）
4. `setDetail(null)` → 渲染空状态

**关键 bug**：`App.tsx` 启动 useEffect 的**注释明确承诺**"若已有值但接口返回 404（Session 已删除）：回退创建新 Session"（行 210），但**实际未实现该回退逻辑**——只是 `setCurrentSessionId(stored)` 后等 hook 报错，UI 卡在空状态，用户看到 console error 但功能不工作（无消息可发，因为 useSessionDetail 持续拉不到数据）。

## What Changes
- **修复启动 useEffect 的 404 回退逻辑**：在 useEffect 中先校验 stored sessionId 是否仍存在
- **方案 A（推荐）**：让 `useSessionDetail` 接受 `onNotFound` 回调，404 时触发；App.tsx 传 onNotFound → 清除 localStorage + 调 createSession
- **方案 B**：useEffect 主动先 fetch `/api/sessions/{stored}` 校验存在性，404 则回退
- **采用方案 A**：改动最小，复用现有 hook
- **App.tsx 启动 useEffect 实际回退逻辑**：当 onNotFound 触发 → `setCurrentSessionId(null)` + `localStorage.removeItem('current_session_id')` + `createSession({mode: appMode})` 自动创建
- **`useSessionDetail` 错误降级**：将 `console.error('获取会话详情失败:', e)` 改为静默的 `console.warn`（404 是预期情况，非真正的"失败"）
- **零后端变更**

## Impact
- Affected specs: `conversation-history-sidebar`（**MODIFIED** — 启动 404 回退逻辑补全）
- Affected code:
  - `frontend/src/hooks/useApi.ts` — v1.8.0 → v1.9.0：useSessionDetail 新增 `onNotFound?: () => void` 可选参数 + 404 时静默触发回调
  - `frontend/src/App.tsx` — v2.10.3 → v2.10.4：useSessionDetail 传 onNotFound + 内部实现回退逻辑（清除 localStorage + createSession）
- **零后端变更**

---

## MODIFIED Requirements

### Requirement: 启动 404 回退（来自 conversation-history-sidebar）
App.tsx 启动 useEffect SHALL 在检测到 localStorage 中的 sessionId 已不存在（404）时，自动回退到 createSession 创建新会话，避免用户卡在空状态。

#### Scenario: 404 回退
- **WHEN** App.tsx 启动读取 localStorage 得到 stored sessionId
- **AND** 后端 `/api/sessions/{stored}/detail` 返回 404（Session 不存在）
- **THEN** 触发 `onNotFound` 回调
- **AND** App.tsx 内部：`setCurrentSessionId(null)` + `localStorage.removeItem('current_session_id')` + `createSession({mode: appMode})` 自动创建新 Session
- **AND** 新 Session 创建成功后：`setCurrentSessionId(newSession.id)` + `localStorage.setItem('current_session_id', newSession.id)`
- **AND** 整个回退过程对用户**透明**（无 toast 提示，因 404 是正常的清理场景）

#### Scenario: 正常 200
- **WHEN** 后端返回 200（Session 存在）
- **THEN** useSessionDetail 正常 setDetail(response) + 渲染详情
- **AND** **不**触发 onNotFound
- **AND** 用户正常使用历史 Session

#### Scenario: 其他错误（500 / 网络）
- **WHEN** 后端返回 500 或网络错误
- **THEN** useSessionDetail **不**触发 onNotFound（仅 404 触发）
- **AND** console.warn 输出警告（不报错，因可能是临时网络问题）
- **AND** setDetail(null) + UI 渲染空状态
- **WHEN** 用户刷新页面或重试
- **THEN** useSessionDetail 重新发起请求（可能恢复 200）

---

### Requirement: useSessionDetail hook 错误降级
useSessionDetail SHALL 仅在 404 时触发 onNotFound，其他错误静默降级，避免误报。

#### Scenario: 404 静默处理
- **WHEN** 后端返回 404
- **THEN** 触发 `onNotFound?.()` 回调
- **AND** console.debug 输出（不 console.error）"Session {id} 不存在，自动回退"

#### Scenario: 其他错误静默处理
- **WHEN** 后端返回 500 / 网络中断 / JSON 解析错误
- **THEN** **不**触发 onNotFound
- **AND** console.warn 输出 "获取会话详情失败: {error}"
- **AND** setDetail(null)
- **AND** 渲染空状态（用户可手动点击"新建对话"按钮）

#### Scenario: API 签名扩展
- **WHEN** 父组件调用 useSessionDetail
- **THEN** 签名：`useSessionDetail(sessionId: string | null, options?: { onNotFound?: () => void })`
- **AND** `options` 整体可选（兼容旧用法）
- **AND** 旧用法 `useSessionDetail(sessionId)` 仍正常工作

---

## REMOVED Requirements

无。本 spec 为增量修复，**不**删除任何已有功能。
