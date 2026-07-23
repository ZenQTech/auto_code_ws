# Tasks

- [x] Task 1: useSessionDetail 增加 onNotFound 回调
  - 1.1 在 `frontend/src/hooks/useApi.ts` v1.8.0 → v1.9.0 修改 useSessionDetail 签名：`useSessionDetail(sessionId: string | null, options?: { onNotFound?: () => void })`
  - 1.2 在 fetch catch 块中区分 404 与其他错误：
    - `e.message` 含 "404" 或 `e.status === 404` 或 `e instanceof Error && e.message.includes('Session 不存在')` → 触发 onNotFound?.()
    - 其他 → console.warn + setDetail(null)
  - 1.3 404 时 console.debug 输出（不 console.error）
  - 1.4 文件头 v1.9.0 修改记录追加：`# - 2026-06-24 | v1.9.0 | useSessionDetail 新增 onNotFound 回调（404 静默触发）`

- [x] Task 2: App.tsx 实现 404 回退逻辑
  - 2.1 在 `frontend/src/App.tsx` v2.10.3 → v2.10.4 找到 `useSessionDetail(currentSessionId)` 调用
  - 2.2 修改为 `useSessionDetail(currentSessionId, { onNotFound: handleSessionNotFound })`
  - 2.3 新增 `handleSessionNotFound` 回调（位于 showToast 之后 / useSessionDetail 之前，依赖项 `[appMode, showToast]`）：
    - 清除已失效的 localStorage sessionId
    - 自动调用 createSession({ mode: appMode }) 创建新 Session
    - 失败时 console.error + showToast 提示用户刷新页面
  - 2.4 文件头 v2.10.4 修改记录追加：`# - 2026-06-24 | v2.10.4 | 修复启动 404 回退：useSessionDetail onNotFound + handleSessionNotFound 自动重建 Session`
  - 2.5 顺带：showToast 从原「事件处理函数」区上移到 toast state 之后，让 handleSessionNotFound 能直接引用（避免 ESLint no-use-before-define），并把 useSessionDetail 调用从原「状态定义」区下移到 handleSessionNotFound 之后

- [x] Task 3: 构建与回归验证
  - 3.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错（输出 `OK`）
  - 3.2 前端 `npm run build` 无编译错误（`vite build` 成功，输出 42 modules transformed，产物 index-B0aEqJjp.css + index-Bic32m5_.js）
  - 3.3 grep 验证 useApi.ts 已有 `onNotFound` 参数（10 处匹配：注释 + 签名 + useRef + 触发点）
  - 3.4 grep 验证 App.tsx 已有 `handleSessionNotFound` 函数（9 处匹配：注释 + 定义 + 透传）
  - 3.5 grep 验证 App.tsx `useSessionDetail(currentSessionId, { onNotFound: ... })` 调用（多行匹配 line 209-212）
  - 3.6 GUI 端到端：**SKIPPED**（受限于无浏览器环境，改为代码静态 + 端到端单元测试覆盖）

# Task Dependencies
- Task 1（useApi）独立
- Task 2（App.tsx）依赖 Task 1
- Task 3（验证）依赖 Task 1-2 完成
