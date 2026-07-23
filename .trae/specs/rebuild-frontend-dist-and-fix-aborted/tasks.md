# Tasks

- [x] Task 1: 修复 cleanup-empty 卸载请求
  - [x] 1.1 修改 `backend/app/api/sessions.py`，为 `/cleanup-empty` 增加 POST 端点，复用现有清理逻辑
  - [x] 1.2 修改 `frontend/src/App.tsx`，beforeunload 优先调用 `navigator.sendBeacon('/api/sessions/cleanup-empty')`
  - [x] 1.3 保留 fetch keepalive DELETE 作为 sendBeacon 不可用时的降级

- [x] Task 2: 重新构建前端 dist
  - [x] 2.1 使用 nvm Node v24.15.0 执行前端构建，生成最新 `frontend/dist`
  - [x] 2.2 验证 `dist/index.html` 不再引用旧的 `index-Bic32m5_.js`，新入口为 `index-BVJP9Rpj.js`
  - [x] 2.3 验证新 bundle 包含 `clarify_questions`、`workflow_started`、`session_mode`、`提交回答`、`请选择或补充以下信息`

- [x] Task 3: 验证
  - [x] 3.1 后端 Python 语法编译通过
  - [x] 3.2 前端诊断/构建通过
  - [x] 3.3 验证后端静态挂载路径仍为 `frontend/dist`
  - [x] 3.4 验证 cleanup-empty POST 路由存在
  - [x] 3.5 清理临时文件（无临时文件产生）

# Task Dependencies
- Task 2 依赖 Task 1（需要先完成源码修改再构建）
- Task 3 依赖 Task 1-2
