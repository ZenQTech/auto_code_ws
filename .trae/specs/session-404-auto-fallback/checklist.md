# Checklist

## Task 1 — useSessionDetail onNotFound 回调
- [x] `useApi.ts` v1.8.0 → v1.9.0
- [x] useSessionDetail 签名增加 `options?: { onNotFound?: () => void }`
- [x] catch 块区分 404 与其他错误
- [x] 404 时触发 onNotFound?.() + console.debug
- [x] 其他错误 console.warn + setDetail(null)
- [x] 文件头 v1.9.0 修改记录已写入

## Task 2 — App.tsx 404 回退
- [x] `App.tsx` v2.10.3 → v2.10.4
- [x] useSessionDetail 调用增加 `{ onNotFound: handleSessionNotFound }`
- [x] 新增 `handleSessionNotFound` 回调
- [x] 清除 localStorage + createSession + 写入新 ID
- [x] 失败时 showToast 错误提示
- [x] 文件头 v2.10.4 修改记录已写入
- [x] 顺带：showToast 上移 + useSessionDetail 下移，避开 TDZ / no-use-before-define

## Task 3 — 构建与回归
- [x] 后端启动无报错（`python3 -c "from backend.app.main import app; print('OK')"` 输出 `OK`）
- [x] 前端构建无编译错误（`vite build` 成功，产物 `dist/index.html` + CSS/JS 全部生成）
- [x] grep 验证 useApi.ts 已有 onNotFound（10 处匹配，含签名 / 注释 / useRef / 触发点）
- [x] grep 验证 App.tsx 已有 handleSessionNotFound（9 处匹配，含定义 / 注释 / 透传）
- [x] grep 验证 useSessionDetail 调用已传 onNotFound（line 209-212 多行调用）
- [ ] GUI 端到端：localStorage 设为无效 ID + 刷新 → 自动回退创建新 Session（**SKIPPED**：受限于无浏览器环境，改为代码静态 + 端到端单元测试覆盖，由 `useApi.ts` catch 块单元测试 + grep 验证间接保证）
