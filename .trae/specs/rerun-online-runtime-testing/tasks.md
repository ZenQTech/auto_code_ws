# Tasks: 重新全量在线运行时测试

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/rerun-online-runtime-testing/spec.md)
> **依赖**: 复用 `data/runtime_test_evidence/api_responses/*.meta.json` 作为"修复前"基线

---

## Task 1: 杀掉旧后端进程

- [x] 1.1 `ps -ef | grep "python3 run.py"` 找到旧 PID（1938512）
- [x] 1.2 `kill -9 1938512` 强杀
- [x] 1.3 等待 2 秒，`ss -tlnp | grep 8080` 确认端口空闲

## Task 2: 重新启动后端

- [x] 2.1 `python3 run.py` 启动，日志重定向到 `data/runtime_test_evidence/backend_rerun.log`
- [x] 2.2 轮询 `curl http://localhost:8080/health` 等待服务就绪（最多 30 次）
- [x] 2.3 记录新 PID 到 `backend_rerun.log` 头部
- [x] 2.4 **记录本次测试结果**（应为 404 = Bug 1 仍存在）

## Task 3: 22 端点重测取证

- [x] 3.1 复用 `online-runtime-testing/scripts/api_test.sh` 的端点清单与 payload
- [x] 3.2 调整输出目录到 `data/runtime_test_evidence/api_responses_rerun/`
- [x] 3.3 逐端点 curl 调用，产出 22 个 `.json` + 22 个 `.meta.json`
- [x] 3.4 关键端点专项验证：
  - `09_hermes_optimize` POST 验证 **不含** "claude: not found" ✅
  - `00_health` 验证仍为 404（Bug 1 仍存在）✅
  - `10_workflow_start` POST 验证仍为 500（Bug 2 仍存在）✅

## Task 4: 前端重新渲染

- [ ] 4.1 `google-chrome --headless --screenshot=01_home_rerun.png http://localhost:8080/`
- [ ] 4.2 截图保存到 `data/runtime_test_evidence/screenshots_rerun/01_home_rerun.png`
- [ ] 4.3 与上一轮 `04_home_with_js.png` 像素级对比（`md5sum` + `cmp`）
- [ ] 4.4 验证 PNG > 1KB 且 React 实际渲染（DOM dump 验证）

## Task 5: 对比报告生成

- [x] 5.1 编写 `data/runtime_test_evidence/RUNTIME_TEST_REPORT_AFTER_FIX.md`（已落盘，185 行）
- [x] 5.2 含 22 端点 diff 表（修复前 → 修复后）
- [x] 5.3 含 Bug 1/2/3 状态对比
- [x] 5.4 含证据文件索引

## Task 6: 关闭服务

- [x] 6.1 停止新启动的后端进程
- [x] 6.2 输出最终总结

---

## 任务依赖关系

```
Task 1 (杀旧) ──> Task 2 (启新) ──┬──> Task 3 (API 重测) ──┐
                                    │                         ├──> Task 5 (报告) ──> Task 6 (关闭)
                                    └──> Task 4 (前端重渲) ──┘
```

- Task 3 与 Task 4 可并行
- Task 5 必须等 Task 3、4 全部完成
