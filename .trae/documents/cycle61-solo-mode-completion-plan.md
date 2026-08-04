# CYCLE 61+ 循环工程任务：Solo 模式功能完整化 + 一键回退 + 端到端测试

> **创建日期**: 2026-08-04
> **Cycle**: 61 → 62
> **目标**: 完成 Solo 模式与 Codex 0.146+ / TRAE Solo 2026 Q3 完整功能集对齐
> **当前覆盖率**: 82% → **目标**: 90%

---

## Context（背景与原因）

用户需求是启动一个**系统性的循环工程任务**，要求：
1. 互联网调研 Codex/Trae Solo 模式的 7 个核心功能
2. 完成功能差距分析 + spec 任务创建
3. 功能开发与完善
4. 测试验证
5. UI/UX 优化
6. 维护完整的 loop engineering 工作流
7. 循环执行机制

**当前现状**（来自 CYCLE60/C61 工作）：

| 任务 | 状态 | 备注 |
|------|------|------|
| Solo 模式前端重写 | ✅ v2.1.0 | VibeSoloShell + 11 个配套组件（603+ 行） |
| Claude CLI 真实 subprocess | ✅ v2.0.0 | G61-01 Phase 1+2 完成（后端 + 前端 + 67 测试） |
| Auto-Follow v2 联动 | ✅ v2.0.0 | G61-03 完成（15 事件 + 47 panel + 100ms 节流） |
| Goal mode 完整循环 UI | 🟡 **未完成** | 仅有 useLoopState + LoopStatusBar，缺三层可视化 + 持久化 |
| ComposerPlan 真正可执行 | 🟡 **未完成** | 仅有 ComposerPanel v1.2.0，缺 step 状态机 + LLM 循环 |
| 一键回退（git revert） | 🟢 **未完成** | 完全缺失（G61-07 P1） |
| 对话流折叠 | 🟢 **未完成** | 完全缺失（G61-08 P1） |
| 端到端测试（Phase 5） | 🟡 **部分** | 已通过单元测试，缺 TRAE-browseruse 真实浏览器验证 |

**核心问题**：
- G61-01+G61-03 Phase 2 共有 **18 个新文件 + 4 个修改** 未提交
- G61-02 / G61-04 / G61-07 / G61-08 是用户使用 Solo 模式核心流程的**关键缺失**
- 缺乏 100% 端到端浏览器验证
- 用户的"启动新一轮循环"指令要求持续迭代

---

## 总体目标

完成 CYCLE 61+ 阶段的所有 P0 + P1 任务，将 Solo 模式覆盖率从 82% 提升至 **≥ 90%**：
- 完成 G61-02 Goal mode 完整循环 UI
- 完成 G61-04 ComposerPlan 真正可执行
- 完成 G61-07 一键回退
- 完成 G61-08 对话流折叠
- Phase 5 端到端浏览器验证
- 提交所有未提交工作
- 生成最终验收报告

---

## 实施计划（6 阶段）

### Phase A：提交当前 G61-01+G61-03 Phase 2 工作

**原因**：避免未提交工作丢失，清理 git 状态。

**步骤**：
1. 验证所有测试通过（`/home/qizheng/auto_code_ws/frontend` 67 个 Claude CLI + Auto-Follow 测试）
2. 提交 18 个新文件 + 4 个修改：
   - 新增：`ClaudeCLIWorkbench.tsx`、`ClaudeCLIStage.tsx`、`AutoFollowConfig.tsx`、`StickyTool.tsx`、`SplitView.tsx`、`ClaudeCLIWorkbenchPage.tsx`、`PlanModeToggle.tsx`、`TaskTabs.tsx`、`EmbeddedTools.tsx`、`ShortcutHelpPanel.tsx`、`SoloOnboarding.tsx` + 11 个对应测试
   - 修改：`VibeSoloShell.tsx`（集成 Solo 完整组件）、`LoopStatusBar.tsx`（h-9 紧凑 + 暗色主题）、`useShortcut.ts`（v7.0.0 Solo 快捷键）、`router.tsx`（v1.4.0 26 路由）
3. 生成 commit: `feat(cycle61 G61-01+G61-03 Phase 2+UI 整合): Solo 完整重构 + Claude CLI Workbench + Auto-Follow v2`

**关键文件**：
- [VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx)
- [router.tsx](file:///home/qizheng/auto_code_ws/frontend/src/router/router.tsx)
- [useAutoFollow.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useAutoFollow.ts)
- [useClaudeCLI.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useClaudeCLI.ts)

---

### Phase B：G61-02 Goal mode 完整循环 UI

**目标**：将现有 LoopStatusBar + useLoopState 升级为**完整三层可视化循环 UI**（Goal-Plan-Step）。

**功能要求**：
1. **三层可视化**：
   - Goal 卡片（标题、状态、创建时间）
   - Plan 步骤（拆解的子任务列表）
   - Step 实时进度（执行中/成功/失败/跳过）
2. **持久化**：localStorage + 后端 /api/goals 持久化
3. **pause/resume 完整恢复**：恢复时自动订阅 SSE 重新同步
4. **Step 自动验证**：可配置 pass 条件（命令输出、文件存在、LLM Judge）
5. **进度报告**：每 5 步自动生成摘要（LLM 调用）

**新增文件**：
- `frontend/src/components/GoalLoopView.tsx`（~400 行，三层可视化）
- `frontend/src/components/GoalStep.tsx`（~150 行，单步展示）
- `frontend/src/hooks/useGoalLoop.ts`（~300 行，三层状态机 + 持久化）
- `frontend/src/hooks/useGoalStep.ts`（~200 行，单步执行 + 验证）
- `backend/app/api/goals.py`（~200 行，Goal CRUD API）
- `backend/app/services/goal_service.py`（~400 行，Goal 编排 + 持久化 + 验证）
- `backend/app/services/step_verifier.py`（~300 行，Step 验证器）
- 单元测试：~6 个文件，~40 测试

**关键复用**：
- [useLoopState.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useLoopState.ts) (v1.0.0)
- [LoopStatusBar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LoopStatusBar.tsx)
- [LoopStateMachineView.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LoopStateMachineView.tsx)
- [GoalAutomationPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/GoalAutomationPanel.tsx) (1180 行)

**风险等级**：🟡 中（LLM 调用防死循环 + 状态恢复一致性）

---

### Phase C：G61-04 ComposerPlan 真正可执行

**目标**：现有 ComposerPanel + PlanExecutorPanel 升级为**真正可执行的 Plan → Step → LLM 循环**。

**功能要求**：
1. **Plan 解析**：从 ComposerPanel 解析为 step 列表（按文件 / 按函数 / 按子任务）
2. **Step 自动执行**：每步调用 Claude CLI（复用 G61-01）自动实现
3. **Step 状态机**：pending / running / success / failed / skipped
4. **暂停/恢复/跳过/重试**：UI 控制每步状态流转
5. **失败处理**：自动重试（最多 3 次）→ 跳过 → 中止策略
6. **进度可视化**：Plan 进度条 + Step 时间线

**新增文件**：
- `frontend/src/components/ComposerPlanExecutor.tsx`（~400 行，Plan 执行 + 状态机）
- `frontend/src/components/ComposerStepRow.tsx`（~200 行，单步展示）
- `frontend/src/hooks/useComposerPlan.ts`（~350 行，Plan 状态机 + LLM 循环驱动）
- `frontend/src/hooks/useStepExecutor.ts`（~250 行，Step 执行 + 重试）
- `backend/app/api/composer_plan.py`（~200 行，Plan 执行 API）
- `backend/app/services/composer_plan_service.py`（~500 行，Plan 引擎 + 死循环防护）
- 单元测试：~6 个文件，~35 测试

**关键复用**：
- [ComposerPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ComposerPanel.tsx) (v1.2.0, 966 行)
- [PlanExecutorPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/PlanExecutorPanel.tsx) (v1.1.0, 477 行)
- [composerEngine.plan.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/composerEngine.plan.ts)
- [useClaudeCLI.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useClaudeCLI.ts) (G61-01)

**风险等级**：🟡 中（LLM 死循环防护 + 步骤结果验证）

---

### Phase D：G61-07 一键回退（git revert + UI 集成）

**目标**：将 git revert 能力集成到对话流，用户可一键回退特定对话产生的所有变更。

**功能要求**：
1. **对话流关联**：每个对话项记录其产生的 commit hash
2. **回退按钮**：对话项右侧显示"↶ 回退"按钮
3. **回退确认**：弹出 dialog 显示 diff 预览
4. **回退执行**：调用 `git revert --no-edit`
5. **回退后自动重新构建**：触发 Vite HMR / 后端 reload
6. **历史记录**：保留回退历史，可再次回退

**新增文件**：
- `frontend/src/components/RevertButton.tsx`（~150 行，回退按钮 + dialog）
- `frontend/src/components/RevertPreviewDialog.tsx`（~250 行，diff 预览）
- `frontend/src/hooks/useRevert.ts`（~200 行，回退 API 调用）
- `backend/app/api/revert.py`（~200 行，revert API）
- `backend/app/services/revert_service.py`（~300 行，revert 引擎 + 关联 commit 追踪）
- 单元测试：~3 个文件，~20 测试

**关键复用**：
- [DiffViewPage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/DiffViewPage.tsx) (diff 预览)
- [SessionHistorySidebar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.tsx) (对话列表)
- 现有 `git_manager` 服务

**风险等级**：🟢 低（强制确认 + diff 预览）

---

### Phase E：G61-08 对话流自动折叠

**目标**：长时间 Solo 会话中，已完成对话项自动折叠为 1-2 行摘要。

**功能要求**：
1. **折叠规则**：超过 N 步（默认 10）或长度 > 5000 字符 → 自动折叠
2. **摘要自动生成**：调用 LLM 生成 1-2 行摘要
3. **手动控制**：用户可强制展开/折叠
4. **状态持久化**：折叠状态保存到 localStorage
5. **性能优化**：虚拟滚动（> 50 项时）

**新增文件**：
- `frontend/src/components/CollapsibleSessionItem.tsx`（~200 行，可折叠对话项）
- `frontend/src/hooks/useSessionCollapse.ts`（~150 行，折叠状态管理）
- `frontend/src/hooks/useSessionSummary.ts`（~150 行，LLM 摘要生成）
- `backend/app/api/session_summary.py`（~150 行，摘要 API）
- 单元测试：~2 个文件，~15 测试

**关键复用**：
- [SessionHistorySidebar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.tsx)
- [useVibeCoding.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useVibeCoding.ts)
- [Claude CLI useClaudeCLI.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useClaudeCLI.ts) (复用 LLM 调用)

**风险等级**：🟢 低

---

### Phase F：端到端验证 + 验收报告

**目标**：使用 TRAE-browseruse 真实浏览器自动化验证所有新功能。

**验证清单**：

1. **Solo 模式主流程**：
   - 访问 `http://localhost:5173/` 直接进入 Solo
   - 输入任务 → 启动 → 步骤进度显示
   - 9 状态徽章正确切换

2. **G61-01 Claude CLI Workbench**：
   - 访问 `/claude-workbench`
   - 输入 prompt → Invoke → 流式输出
   - 思考过程显示
   - 工具调用列表
   - 沙箱状态正确

3. **G61-02 Goal Loop**：
   - 创建 Goal → 显示三层可视化
   - pause/resume 后状态恢复
   - Step 自动验证
   - 进度报告

4. **G61-04 ComposerPlan**：
   - 创建 Plan → Step 列表
   - 逐步执行 → 状态正确切换
   - 失败重试机制

5. **G61-07 一键回退**：
   - 对话项显示回退按钮
   - 点击后弹出 diff 预览
   - 确认后执行 git revert

6. **G61-08 对话流折叠**：
   - 超过 10 步的对话自动折叠
   - 显示 LLM 摘要
   - 手动展开/折叠正常

7. **回归测试**：
   - 所有 67 个 G61-01+G61-03 测试通过
   - 所有新增 G61-02/G61-04/G61-07/G61-08 测试通过
   - 全项目 ≥ 8200 个测试通过（之前 8214 baseline）

**新增文件**：
- `CYCLE61_FINAL_REPORT.md`（最终验收报告）
- `CODE_MODIFICATION_LOG_CYCLE61.md`（代码修改日志）
- `e2e/claude_workbench_e2e.test.ts`（TRAE-browseruse 端到端测试）
- `e2e/goal_loop_e2e.test.ts`
- `e2e/composer_plan_e2e.test.ts`
- `e2e/revert_e2e.test.ts`
- `e2e/collapse_e2e.test.ts`

---

## 关键文件清单

### 新增文件（~25 个）

| 类别 | 路径 | 行数 | 用途 |
|------|------|------|------|
| Phase A 提交 | （已存在 18 个新文件） | - | Claude CLI Workbench + Solo 配套 |
| Phase B Goal | `frontend/src/components/GoalLoopView.tsx` | 400 | 三层可视化 |
| Phase B Goal | `frontend/src/hooks/useGoalLoop.ts` | 300 | 状态机 |
| Phase B Goal | `backend/app/api/goals.py` | 200 | CRUD API |
| Phase B Goal | `backend/app/services/goal_service.py` | 400 | 引擎 |
| Phase C Composer | `frontend/src/components/ComposerPlanExecutor.tsx` | 400 | Plan 执行 |
| Phase C Composer | `frontend/src/hooks/useComposerPlan.ts` | 350 | 状态机 |
| Phase C Composer | `backend/app/services/composer_plan_service.py` | 500 | 引擎 |
| Phase D Revert | `frontend/src/components/RevertButton.tsx` | 150 | 回退按钮 |
| Phase D Revert | `backend/app/services/revert_service.py` | 300 | 引擎 |
| Phase E Collapse | `frontend/src/components/CollapsibleSessionItem.tsx` | 200 | 折叠 |
| Phase F E2E | 5 个 `e2e/*.test.ts` | 200×5 | 端到端测试 |
| Phase F 文档 | `CYCLE61_FINAL_REPORT.md` | - | 验收报告 |

**总代码量估算**：~5500 行（前端 3000 + 后端 2500）

### 修改文件（~5 个）

| 路径 | 修改点 |
|------|--------|
| `frontend/src/pages/VibeSoloShell.tsx` | 集成 GoalLoopView + ComposerPlanExecutor + RevertButton + CollapsibleSessionItem |
| `frontend/src/components/SessionHistorySidebar.tsx` | 集成 RevertButton + CollapsibleSessionItem |
| `frontend/src/components/LoopStatusBar.tsx` | 集成 GoalLoopView 入口 |
| `backend/app/main.py` | 注册 goals + composer_plan + revert 路由 |
| `frontend/src/router/router.tsx` | （可选）添加 /goal-loop 路由 |

---

## 风险与回退矩阵

| 风险 | 概率 | 影响 | 回退策略 |
|------|------|------|----------|
| Goal 持久化数据丢失 | 🟡 中 | 🟠 中 | 双写 localStorage + 后端 |
| ComposerPlan 死循环 | 🟡 中 | 🔴 高 | max_step=50 + 强制中断 |
| git revert 冲突 | 🟡 中 | 🟠 中 | 提示用户手动解决 |
| LLM 摘要生成失败 | 🟢 低 | 🟢 低 | 显示原文本 + 占位符 |
| 大量对话项性能 | 🟡 中 | 🟠 中 | 虚拟滚动 + 分页 |
| 与 Auto-Follow v2 冲突 | 🟢 低 | 🟢 低 | 关闭 Auto-Follow 时启用 |

---

## 验证策略

### 单元测试（每 Phase 必须完成）

```bash
# Phase B/C/D/E 每个新文件必须有对应测试
# 测试覆盖率目标：≥ 80%
# Phase A 已通过 67/67
# Phase B 目标：40/40
# Phase C 目标：35/35
# Phase D 目标：20/20
# Phase E 目标：15/15
# 合计：177 个新测试，目标全部通过
```

### 端到端测试（Phase F 使用 TRAE-browseruse）

```typescript
// 访问 http://localhost:5173/ → Solo 模式
// 访问 /claude-workbench → Claude CLI
// 验证 G61-02/04/07/08 完整功能
// 验证 67+110 个回归测试通过
```

### 验收清单（参考 [CYCLE61_CHECKLIST.md](file:///home/qizheng/auto_code_ws/CYCLE61_CHECKLIST.md)）

- [x] Phase A: G61-01+G61-03 Phase 2 提交
- [ ] Phase B: G61-02 GoalLoopView + 40 测试通过
- [ ] Phase C: G61-04 ComposerPlanExecutor + 35 测试通过
- [ ] Phase D: G61-07 RevertButton + 20 测试通过
- [ ] Phase E: G61-08 CollapsibleSessionItem + 15 测试通过
- [ ] Phase F: 5 个 E2E 测试 + 全项目 100% 测试通过
- [ ] 全项目覆盖率 ≥ 80%
- [ ] 关键路径零 console error

---

## 下一步

1. **用户确认**本计划
2. **退出 Plan 模式**开始执行
3. **按 Phase A → F 顺序执行**，每完成一 Phase 立即测试 + commit
4. **每 Phase 完成后更新 memory**（项目状态、关键决策）
5. **最终生成** CYCLE61_FINAL_REPORT.md + CODE_MODIFICATION_LOG_CYCLE61.md

---

**预计总代码量**: ~5500 行
**预计新测试数**: 177 个
**预计总耗时**: 6 Phases × 平均 30 分钟 = 约 3 小时
**目标覆盖率**: Solo 模式 82% → 90%+
**目标验收**: 所有 P0+P1 任务 100% 完成
