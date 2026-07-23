# Checklist

## cleanup-empty ABORTED 修复
- [x] 后端 `/api/sessions/cleanup-empty` 同时支持 DELETE 和 POST
- [x] POST 端点复用现有空会话清理逻辑
- [x] App.tsx beforeunload 优先使用 `navigator.sendBeacon`
- [x] sendBeacon 不可用时降级 fetch keepalive

## 前端 dist 刷新
- [x] `frontend/dist/index.html` 引用新 hashed JS 文件
- [x] 新 bundle 不再是 `index-Bic32m5_.js`（新 bundle 为 `index-BVJP9Rpj.js`）
- [x] 新 bundle 包含 `clarify_questions`
- [x] 新 bundle 包含 `workflow_started`
- [x] 新 bundle 包含 `session_mode`
- [x] 新 bundle 包含 `提交回答` 或交互式澄清卡片逻辑

## 验证
- [x] 后端 Python 语法编译通过
- [x] 前端构建通过
- [x] 后端仍挂载 `frontend/dist`
- [x] 无临时文件
