# Checklist: 重新全量在线运行时测试

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/rerun-online-runtime-testing/spec.md)
> **对比基线**: `data/runtime_test_evidence/api_responses/*.meta.json`（上一轮）

---

## 环境就绪

- [ ] 旧后端进程已 kill（PID 1938512 已停）
- [ ] 8080 端口空闲
- [ ] 新后端 `python3 run.py` 已启动，日志落 `backend_rerun.log`

## 后端重启

- [ ] 旧 PID 与新 PID 均记录在 `backend_rerun.log`
- [ ] `curl /health` 已记录（预期 404，验证 Bug 1 仍存在）
- [ ] 启动日志含 `CLI 可执行文件已解析: claude -> /home/qizheng/.nvm/...`（验证修复未丢失）

## 22 端点重测

- [ ] `00_health` 重测结果（预期 404，FAIL→FAIL = Bug 1 仍存在）
- [ ] `01_agents` 200（PASS→PASS）
- [ ] `02_sessions_list` 200（PASS→PASS）
- [ ] `03_sessions_create` POST 201（PASS→PASS）
- [ ] `04_conversations` 200（PASS→PASS）
- [ ] `05_tasks` 200（PASS→PASS）
- [ ] `06_stats` 200（PASS→PASS）
- [ ] `07_usage` 200（PASS→PASS）
- [ ] `08_quota` 200（PASS→PASS）
- [ ] `09_hermes_optimize` POST **不再含 "claude: not found"**（FAIL→PASS = Bug 3 修复）
- [ ] `10_workflow_start` POST 500（FAIL→FAIL = Bug 2 仍存在）
- [ ] `11_dashboard` 404 workflow 不存在（FAIL→FAIL 符合预期）
- [ ] `12_architecture` 200（PASS→PASS）
- [ ] `13_evaluation` 200（PASS→PASS）
- [ ] `14_security` 200（PASS→PASS）
- [ ] `15_git` 200（PASS→PASS）
- [ ] `16_memory` 200（PASS→PASS）
- [ ] `17_config` 200（PASS→PASS）
- [ ] `18_workspace` 200（PASS→PASS）
- [ ] `19_worktree` 200（PASS→PASS）
- [ ] `20_swagger` 200（PASS→PASS）
- [ ] `21_root` 200（PASS→PASS）

## Bug 3 修复验证（关键）

- [ ] `backend_rerun.log` 含 `claude.exe 命令执行成功，耗时 Ns`（N > 0）
- [ ] `09_hermes_optimize.json` 响应不含 "claude: not found"
- [ ] `online-runtime-testing/checklist.md` 中 Bug 3 闭环标记保留

## 前端重渲染

- [ ] `01_home_rerun.png` 已生成（> 1KB）
- [ ] 与上一轮 `04_home_with_js.png` 对比结果已记录
- [ ] DOM dump 仍含 `<h1>欢迎使用 Hermes 智能调度平台</h1>` 与双模式按钮

## 对比报告

- [ ] `RUNTIME_TEST_REPORT_AFTER_FIX.md` 已生成
- [ ] 22 端点 diff 表格完整
- [ ] Bug 1/2/3 状态对比表完整
- [ ] 证据文件索引完整

## 关闭

- [ ] 后端进程已停止
- [ ] 最终总结已输出

## 验收刚性标准

> **判定本次重测任务完成必须同时满足**：
> 1. 22 端点全部重新 curl 调用并产出 `.meta.json`
> 2. Bug 3 修复得到日志级证据（`claude.exe 命令执行成功，耗时 > 0`）
> 3. Bug 1 / Bug 2 **仍存在**（如未额外修复），并在报告中明确说明
> 4. 前端截图已重新生成
> 5. 对比报告 RUNTIME_TEST_REPORT_AFTER_FIX.md 已生成
