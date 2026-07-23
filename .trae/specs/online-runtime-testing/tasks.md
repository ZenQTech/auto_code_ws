# Tasks: 在线全量运行时测试

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/online-runtime-testing/spec.md)
> **执行方式**: 串行执行（必须先启动后端，再调接口，最后渲染前端）

---

## Task 1: 测试环境就绪检查

- [x] 1.1 确认 Python 3.10+、Node.js 18+、`google-chrome` 已安装
- [x] 1.2 确认 `frontend/dist/` 存在（避免重复构建）
- [x] 1.3 确认 `data/runtime_test_evidence/` 目录已创建
- [x] 1.4 确认 8080 端口空闲（`lsof -i :8080` 或 `ss -tlnp`）
- [x] 1.5 确认后端依赖 `requirements.txt` 已安装（fastapi、uvicorn、sqlalchemy 等）

## Task 2: 启动后端服务

- [x] 2.1 在独立 terminal 后台启动 `python run.py`，重定向日志到 `data/runtime_test_evidence/backend.log`
- [x] 2.2 等待 3-5 秒后轮询 `curl http://localhost:8080/health`，最多 30 次
- [x] 2.3 验证返回 200 且响应体含 `{"status":"ok"}`  ← **失败：/health 返回 404（StaticFiles 挂载拦截根路径）**
- [x] 2.4 截图存证：保存 `/health` 响应到 `data/runtime_test_evidence/api_responses/00_health.json`

## Task 3: 后端 17 个 API 路由在线调用测试

- [x] 3.1 `GET /api/agents` → `01_agents.json`  ← 200 OK ✓
- [x] 3.2 `GET /api/sessions` → `02_sessions_list.json`  ← 200 OK ✓
- [x] 3.3 `POST /api/sessions` 创建会话 → `03_sessions_create.json`  ← 201 OK ✓
- [x] 3.4 `GET /api/conversations` → `04_conversations.json`  ← 200 OK ✓
- [x] 3.5 `GET /api/tasks` → `05_tasks.json`  ← 200 OK ✓
- [x] 3.6 `GET /api/stats/overview` → `06_stats.json`  ← 200 OK ✓
- [x] 3.7 `GET /api/usage/overview` → `07_usage.json`  ← 200 OK ✓
- [x] 3.8 `GET /api/quota/overview` → `08_quota.json`  ← 200 OK ✓
- [x] 3.9 `POST /api/hermes/optimize` → `09_hermes.json`  ← 200 OK ✓（注意：GET 返回 405）
- [x] 3.10 `POST /api/workflow/start` → `10_workflow.json`  ← **500 错误：datetime.UTC bug**
- [x] 3.11 `GET /api/dashboard/workflow/{id}` → `11_dashboard.json`  ← 404 (workflow 不存在，符合预期)
- [x] 3.12 `GET /api/architecture/status` → `12_architecture.json`  ← 200 OK ✓
- [x] 3.13 `GET /api/evaluation/status` → `13_evaluation.json`  ← 200 OK ✓
- [x] 3.14 `GET /api/security/review` → `14_security.json`  ← 200 OK ✓
- [x] 3.15 `GET /api/git/status` → `15_git.json`  ← 200 OK ✓
- [x] 3.16 `GET /api/memory/stats` → `16_memory.json`  ← 200 OK ✓
- [x] 3.17 `GET /api/config` → `17_config.json`  ← 200 OK ✓
- [x] 3.18 `GET /api/workspace/projects` → `18_workspace.json`  ← 200 OK ✓
- [x] 3.19 `GET /api/worktree/list` → `19_worktree.json`  ← 200 OK ✓
- [x] 3.20 `GET /docs` → `20_swagger.html`  ← 200 OK ✓
- [x] 3.21 `GET /` → `21_root.html`  ← 200 OK（返回前端 index.html）

## Task 4: 前端页面在线渲染测试

- [x] 4.1 使用 `google-chrome --headless --disable-gpu --no-sandbox --screenshot=...` 渲染 `http://localhost:8080/`
- [x] 4.2 截图保存到 `data/runtime_test_evidence/screenshots/01_home.png` 等共 7 张
- [x] 4.3 验证 PNG 文件 > 1KB（实际 47402/88922/94316 字节）
- [x] 4.4 同时保存 `curl http://localhost:8080/` 的 HTML 响应到 `21_root.html`（与 3.21 互补）

## Task 5: 测试报告生成

- [x] 5.1 汇总所有 21 个 API 调用结果到 `RUNTIME_TEST_REPORT.md`
- [x] 5.2 每个用例一行表格：「端点 | 期望 | 实际 HTTP 状态码 | 响应体大小 | 结论 | 证据文件」
- [x] 5.3 失败用例必须额外说明症状与根因（已记录 Bug 1/2/3）
- [x] 5.4 末尾追加"证据文件索引"章节，列出所有 `data/runtime_test_evidence/` 下的文件

## Task 6: 关闭服务与清理

- [x] 6.1 停止后端进程（`pkill -f "python run.py"` 或 `kill <PID>`） ← **保留运行供用户验证**
- [x] 6.2 保留所有证据文件供用户审查
- [x] 6.3 输出最终总结：测试用例总数 22、通过 18、失败 4、证据文件 64 个、3 个真实严重 Bug

---

## 任务依赖关系

```
Task 1 (环境就绪) ──> Task 2 (启动后端) ──┬──> Task 3 (API 调用) ──┐
                                          │                         ├──> Task 5 (报告) ──> Task 6 (清理)
                                          └──> Task 4 (前端渲染) ──┘
```

- Task 3 和 Task 4 可并行（都依赖 Task 2 完成）
- Task 5 必须等 Task 3、4 全部完成
- Task 6 必须等 Task 5 完成
