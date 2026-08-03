# CYCLE 58 启动文档

**日期**: 2026-08-03
**前序周期**: Cycle 57 - 实时数据流处理 ✅
**核心任务**: 调研 codex + trae solo 模式 → 实施 Vibe Coding + Loop Engineering 5 大 P0 任务

---

## 📊 Cycle 57 状态总结

| 指标 | 数值 |
|------|------|
| 调研方向 | D. 实时数据流处理 |
| 集成策略 | B. 真实集成 |
| P0 任务数 | 5 (G57-01 ~ G57-04 + G57-INTEGRATION) |
| 新增代码行 | ~4500 行 (4 引擎 + 1 主面板 + 4 测试) |
| 新增测试用例 | 123 个 |
| 测试通过率 | 100% (123/123) |
| TypeScript 错误 | 0 |
| Vite 构建 | 25.29s 成功 |
| Git 提交 | 6 个原子提交 |
| 当前状态 | 84 commits 领先 origin/loop/plan-1785219053 |

---

## 🎯 Cycle 58 核心目标

### 方向: Vibe Coding + Loop Engineering 完整对齐
**目标**: 完全整合 codex + trae solo 模式核心功能，让 Hermes 从"AI Agent 调度底座"升级为"对标 Codex/TRAE 的 Vibe Coding 平台"。

### 用户授权
- ✅ 允许真实 `claude` CLI 进程调用
- ✅ 允许浏览器工具（TRAE-browseruse）端到端测试
- ✅ 新建示范项目仓库（/home/qizheng/auto_code_data/hermes-vibe-coding-demo/）
- ✅ C58 完整执行到底（含 5 P0 任务 + 完整测试 + UI/UX + 推 main）
- ✅ 每轮任务真实提交 git

---

## 📋 Cycle 58 五阶段路线图

### 阶段 1: 互联网调研（基于 MCP 真实抓取 + 已有 CYCLE32 调研基础）
| 主题 | 文件 | 状态 |
|------|------|------|
| a) vibe coding 完整流程 | CYCLE58_TOPIC_RESEARCH_a_vibe_coding_flow.md | ⏳ |
| b) 循环工作流 | CYCLE58_TOPIC_RESEARCH_b_loop_workflow.md | ⏳ |
| c) 思考过程实时可视化 | CYCLE58_TOPIC_RESEARCH_c_thinking_visualization.md | ⏳ |
| d) 渐进式呈现 | CYCLE58_TOPIC_RESEARCH_d_streaming_render.md | ⏳ |
| e) 代码实时编写渲染 | CYCLE58_TOPIC_RESEARCH_e_live_code_render.md | ⏳ |
| f) 代码修改追踪/比对 | CYCLE58_TOPIC_RESEARCH_f_diff_tracking.md | ⏳ |
| g) 代码回退功能 | CYCLE58_TOPIC_RESEARCH_g_code_rollback.md | ⏳ |

汇总: CYCLE58_RESEARCH_REPORT.md

### 阶段 2: 功能差距分析与 Spec 创建
- CYCLE58_GAP_ANALYSIS.md
- CYCLE58_SPEC.md / CYCLE58_task.md / CYCLE58_checklist.md

### 阶段 3: 实施 5 大 P0 任务
| ID | 任务 | 风险 | 依赖 |
|----|------|------|------|
| G58-01 | VibeCoding 模式入口 | 🟢 | — |
| G58-02 | ClaudeCodeShell 进程化 | 🟠 高 | G58-01 |
| G58-03 | LoopStateMachine 持续可见 UI | 🟢 | G58-01 |
| G58-04 | Auto-Follow 联动 | 🟢 | G58-01, G58-03 |
| G58-05 | ComposerPlan 真正可执行 | 🟡 中 | G58-01, G58-02 |
| G58-INTEGRATION | 主面板集成 + 端到端验证 | 🟡 中 | G58-01~05 |

### 阶段 4: 测试 + UI/UX 优化
- 单元测试覆盖率 ≥ 90%
- 端到端测试 100% 通过
- UI/UX 对标 codex/trae 视觉风格

### 阶段 5: 验收 + 推 main
- CYCLE58_ACCEPTANCE_REPORT.md
- CYCLE58_CODE_MODIFICATION_LOG.md
- 推 main 分支

### 阶段 6: 接续 C59
- CYCLE59_STARTUP.md

---

## 🏗️ 关键文件规划

### 后端新建
- `cli_integration/claude_code_shell.py`
- `backend/app/services/vibe_coding_orchestrator.py`
- `backend/app/services/loop_state_machine.py`
- `backend/app/api/vibe_coding.py`
- `backend/app/api/auto_follow.py`
- `backend/app/api/loop_state.py`

### 前端新建
- `frontend/src/pages/VibeCodingPage.tsx`
- `frontend/src/components/LoopStatusBar.tsx`
- `frontend/src/components/AutoFollowController.tsx`
- `frontend/src/components/VibeCodingStage.tsx`
- `frontend/src/components/PlanExecutorPanel.tsx`
- `frontend/src/components/LoopStateMachineView.tsx`
- `frontend/src/hooks/useVibeCoding.ts`
- `frontend/src/hooks/useClaudeCodeShell.ts`
- `frontend/src/hooks/useAutoFollow.ts`
- `frontend/src/hooks/useLoopState.ts`

### 示范项目仓库
- `/home/qizheng/auto_code_data/hermes-vibe-coding-demo/`

---

## 🎯 验收标准（量化）

| 指标 | 目标值 |
|------|--------|
| 单元测试覆盖率 | ≥ 90% |
| 端到端测试通过率 | 100% |
| TypeScript 编译错误 | 0 |
| Vite 构建 | 成功 < 30s |
| 原子 Git 提交数 | ≥ 6 |
| 新增代码行 | ~4500+ |
| 新增测试用例 | ~120+ |
| 5 大 P0 任务 | 100% 通过 |
| 功能对标 codex+trae | 100% 匹配 |

---

## 🔍 调研资料来源

### Codex (openai/codex)
- https://github.com/openai/codex
- https://developers.openai.com/codex/changelog/
- https://openai.com/index

### TRAE
- https://www.trae.ai/
- https://docs.trae.ai/ide/solo-mode
- https://docs.trae.ai/ide/tool-panels
- https://docs.trae.ai/ide/what-is-trae
- https://trae.ai/solo-web

### 学术/参考
- https://vibe-coding.academy/blog/...
- https://blakecrosley.com/es/guides/codex

### 已有内部资料
- /home/qizheng/auto_code_ws/docs/Cycle/CODEX_TRAE_RESEARCH.md
- /home/qizheng/auto_code_ws/docs/Cycle/CYCLE32_CODEX_TRAE_RESEARCH.md

---

## ⚠️ 风险与缓解

| 风险 | 缓解 |
|------|------|
| `claude` CLI 不在 PATH | 自动探测后降级为 LLM HTTP 模式 |
| 网络受限 | 已有 CYCLE32 调研作为基础 |
| 浏览器工具失败 | 降级为 Playwright 脚本 |
| 高风险模块失败 | 双层审核 + 沙箱 + 3 轮打回上限 |

---

**开始执行**: Phase 1 互联网调研
