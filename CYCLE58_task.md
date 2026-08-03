# CYCLE58 任务分解清单

> **日期**: 2026-08-03
> **执行原则**: 每个任务经 Hook 通知 + Git 原子提交才能进入下一任务

---

## G58-01: VibeCoding 模式入口

### 后端任务
- [ ] **BE-01-01**: useMode 扩展 vibe-coding 模式
- [ ] **BE-01-02**: useModals 注册 4 新 panel（vibeCoding / planExecutor / loopState / autoFollow）
- [ ] **BE-01-03**: 单元测试 useMode.test.ts 扩展

### 前端任务
- [ ] **FE-01-01**: 创建 VibeCodingPage.tsx 主页面
- [ ] **FE-01-02**: 修改 ModeSelectorPage.tsx 为 3 模式卡片
- [ ] **FE-01-03**: 修改 router.tsx 添加 /vibe-coding 路由
- [ ] **FE-01-04**: 修改 App.tsx 接入 VibeCodingPage
- [ ] **FE-01-05**: 创建 useVibeCoding Hook
- [ ] **FE-01-06**: 单元测试 VibeCodingPage.test.tsx
- [ ] **FE-01-07**: 集成测试 VibeCodingFlow.test.tsx

### 验收检查
- [ ] 模式切换正常
- [ ] 路由可达
- [ ] panel 注册成功
- [ ] 单元测试 ≥ 90%
- [ ] Git 提交: `feat(cycle58 G58-01): VibeCoding 模式入口`

---

## G58-02: ClaudeCodeShell 进程化（高风险）

### 后端任务
- [ ] **BE-02-01**: 创建 cli_integration/claude_code_shell.py
- [ ] **BE-02-02**: 实现 subprocess 流式调用
- [ ] **BE-02-03**: 实现 is_available 探测
- [ ] **BE-02-04**: 实现降级为 LLM HTTP
- [ ] **BE-02-05**: 实现路径净化
- [ ] **BE-02-06**: 实现超时熔断
- [ ] **BE-02-07**: 创建 backend/app/api/claude_shell.py
- [ ] **BE-02-08**: 注册路由到 main.py
- [ ] **BE-02-09**: 实现 SSE 事件推送
- [ ] **BE-02-10**: 单元测试 claude_code_shell.test.py（覆盖 subprocess / 降级 / 超时 / 路径净化）
- [ ] **BE-02-11**: 集成测试 claude_shell_api.test.py

### 前端任务
- [ ] **FE-02-01**: 创建 useClaudeCodeShell Hook
- [ ] **FE-02-02**: 单元测试 useClaudeCodeShell.test.ts

### 验收检查
- [ ] claude CLI 不在 PATH 时降级
- [ ] 真实调用时流式输出
- [ ] 超时熔断
- [ ] 路径净化
- [ ] 单元测试 ≥ 90%
- [ ] Git 提交: `feat(cycle58 G58-02): ClaudeCodeShell 进程化（高风险）`

---

## G58-03: LoopStateMachine 持续可见 UI

### 后端任务
- [ ] **BE-03-01**: 创建 backend/app/services/loop_state_machine.py
- [ ] **BE-03-02**: 集成到 loop_engineering_v7.py
- [ ] **BE-03-03**: 创建 backend/app/api/loop_state.py
- [ ] **BE-03-04**: 实现 SSE 推送 loop_state_changed
- [ ] **BE-03-05**: 注册路由
- [ ] **BE-03-06**: 单元测试 loop_state_machine.test.py

### 前端任务
- [ ] **FE-03-01**: 创建 LoopStatusBar.tsx
- [ ] **FE-03-02**: 创建 LoopStateMachineView.tsx
- [ ] **FE-03-03**: 修改 AppLayout.tsx 插入 LoopStatusBar
- [ ] **FE-03-04**: 创建 useLoopState Hook
- [ ] **FE-03-05**: 单元测试 LoopStatusBar.test.tsx
- [ ] **FE-03-06**: 单元测试 useLoopState.test.ts

### 验收检查
- [ ] 状态机服务可工作
- [ ] LoopStatusBar 持续显示
- [ ] SSE 推送 loop_state_changed
- [ ] 单元测试 ≥ 90%
- [ ] Git 提交: `feat(cycle58 G58-03): LoopStateMachine 持续可见 UI`

---

## G58-04: Auto-Follow 联动

### 后端任务
- [ ] **BE-04-01**: 创建 backend/app/api/auto_follow.py
- [ ] **BE-04-02**: 实现 STAGE_TO_PANEL 映射配置
- [ ] **BE-04-03**: 实现 enable / disable 端点
- [ ] **BE-04-04**: 注册路由
- [ ] **BE-04-05**: 单元测试 auto_follow_api.test.py

### 前端任务
- [ ] **FE-04-01**: 创建 AutoFollowController.tsx
- [ ] **FE-04-02**: 创建 useAutoFollow Hook
- [ ] **FE-04-03**: STAGE_TO_PANEL 映射
- [ ] **FE-04-04**: 集成到 VibeCodingPage
- [ ] **FE-04-05**: 单元测试 AutoFollowController.test.tsx
- [ ] **FE-04-06**: 单元测试 useAutoFollow.test.ts

### 验收检查
- [ ] 阶段变更自动 open panel
- [ ] 关闭开关后不再 follow
- [ ] 单元测试 ≥ 90%
- [ ] Git 提交: `feat(cycle58 G58-04): Auto-Follow 联动`

---

## G58-05: ComposerPlan 真正可执行

### 后端任务
- [ ] **BE-05-01**: 创建 backend/app/services/vibe_coding_orchestrator.py
- [ ] **BE-05-02**: 实现 execute_plan 流式执行
- [ ] **BE-05-03**: 实现 pause / resume / cancel
- [ ] **BE-05-04**: 实现失败重试
- [ ] **BE-05-05**: 实现超时熔断
- [ ] **BE-05-06**: 创建 backend/app/api/vibe_coding.py
- [ ] **BE-05-07**: 实现 plan execute 端点
- [ ] **BE-05-08**: 实现 SSE 推送 vibe_step_* 事件
- [ ] **BE-05-09**: 注册路由
- [ ] **BE-05-10**: 单元测试 vibe_coding_orchestrator.test.py
- [ ] **BE-05-11**: 集成测试 vibe_coding_api.test.py

### 前端任务
- [ ] **FE-05-01**: 创建 PlanExecutorPanel.tsx
- [ ] **FE-05-02**: 创建 usePlanExecutor Hook
- [ ] **FE-05-03**: 集成到 VibeCodingPage
- [ ] **FE-05-04**: 与 ComposerPanel plan mode 集成
- [ ] **FE-05-05**: 单元测试 PlanExecutorPanel.test.tsx
- [ ] **FE-05-06**: 单元测试 usePlanExecutor.test.ts

### 验收检查
- [ ] Plan 执行流式工作
- [ ] pause / resume / cancel 工作
- [ ] 失败重试
- [ ] 单元测试 ≥ 90%
- [ ] Git 提交: `feat(cycle58 G58-05): ComposerPlan 真正可执行`

---

## G58-INTEGRATION: 主面板集成 + 端到端验证

### 任务
- [ ] **INT-01**: VibeCodingPage 集成 5 大组件
- [ ] **INT-02**: 完整 Vibe Coding 流程端到端测试
- [ ] **INT-03**: TRAE-browseruse 实测
- [ ] **INT-04**: TypeScript 编译检查
- [ ] **INT-05**: Vite 构建验证
- [ ] **INT-06**: pytest + vitest 全部通过
- [ ] **INT-07**: 实际运行项目（npm run dev + 端口探测）
- [ ] **INT-08**: UI/UX 对标 codex/trae 优化
- [ ] **INT-09**: 创建示范项目仓库 /home/qizheng/auto_code_data/hermes-vibe-coding-demo
- [ ] **INT-10**: 推 main 分支
- [ ] **INT-11**: 撰写 CYCLE58_ACCEPTANCE_REPORT.md
- [ ] **INT-12**: 撰写 CYCLE58_CODE_MODIFICATION_LOG.md
- [ ] **INT-13**: 生成 CYCLE59_STARTUP.md

### 验收检查
- [ ] 端到端 100% 通过
- [ ] 单元测试 ≥ 90%
- [ ] Git 提交: `feat(cycle58 G58-INTEGRATION): 主面板集成 + 端到端验证 + 推 main`

---

## 实施时序

```
串行:
G58-01 (1-2天)
  ↓
G58-02 + G58-03 + G58-04 + G58-05 (并行 2-3天)
  ↓
G58-INTEGRATION (1天)
```

**总预计**: 5-6 天
**原子提交**: 6 个（G58-01~05 + INTEGRATION）
