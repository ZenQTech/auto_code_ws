# CYCLE61_TASK.md — 任务清单

> **Cycle**: 61
> **日期**: 2026-08-04
> **关联文档**: CYCLE61_SPEC.md / CYCLE61_CHECKLIST.md

---

## 1. 任务总览

| 任务 ID | 任务名称 | 优先级 | 工作量 | 风险 | 依赖 |
|---------|---------|--------|--------|------|------|
| G61-01 | Claude Code CLI 真实 subprocess | P0 | 5 人天 | 🟠 高 | G61-02, G61-03 |
| G61-02 | Goal mode 完整循环 UI | P0 | 6 人天 | 🟡 中 | G61-01, G61-04 |
| G61-03 | Auto-Follow 联动增强 | P0 | 4 人天 | 🟢 低 | — |
| G61-04 | ComposerPlan 真正可执行 | P0 | 5 人天 | 🟡 中 | G61-01 |

**总工作量**: 20 人天 = 4 周

---

## 2. 详细任务分解

### G61-01: Claude Code CLI 真实 subprocess

#### G61-01-T1: Backend - ClaudeCLIProcess 类
- **路径**: `backend/app/services/claude_cli.py`
- **行数**: ~400 行
- **内容**:
  - `ClaudeCLIProcess` 类管理 subprocess
  - `exec_prompt(prompt, options) -> AsyncIterator[CLIEvent]`
  - sandbox 选择（Docker / gVisor / firejail）
  - 失败降级检测
  - 资源限制（CPU / MEM / TIME）
  - 异常处理 + 清理

#### G61-01-T2: Backend - Claude CLI API
- **路径**: `backend/app/api/claude_cli.py`
- **行数**: ~200 行
- **内容**:
  - `POST /api/claude-cli/exec` 启动 subprocess
  - `GET /api/claude-cli/{id}/events` SSE 流
  - `POST /api/claude-cli/{id}/cancel` 取消
  - 错误码定义

#### G61-01-T3: Backend - Sandbox 管理器
- **路径**: `backend/app/services/sandbox_manager.py`
- **行数**: ~200 行
- **内容**:
  - Docker sandbox 创建 / 销毁
  - gVisor sandbox 支持
  - firejail sandbox 支持
  - sandbox 健康检查
  - 资源限制配置

#### G61-01-T4: Frontend - useClaudeCLI Hook
- **路径**: `frontend/src/hooks/useClaudeCLI.ts`
- **行数**: ~300 行
- **内容**:
  - EventSource 订阅 SSE
  - 流式缓冲（避免频繁 re-render）
  - 错误处理 + 自动重连
  - 状态机（idle / running / completed / error / cancelled）

#### G61-01-T5: Frontend - ClaudeCLIStage 组件
- **路径**: `frontend/src/components/ClaudeCLIStage.tsx`
- **行数**: ~300 行
- **内容**:
  - 流式输出显示
  - 思考过程可视化（单独通道）
  - 工具调用卡片
  - 工具结果展示
  - 取消按钮

#### G61-01-T6: 前端集成
- **路径**: `frontend/src/pages/VibeSoloShell.tsx`
- **行数**: ~50 行修改
- **内容**:
  - 集成 ClaudeCLIStage
  - 替换模拟 LLM 调用
  - 错误降级 UI

#### G61-01-T7: 单元测试
- **路径**: `backend/tests/test_claude_cli.py`
- **行数**: ~200 行
- **覆盖**:
  - subprocess 创建 / 销毁
  - stdin/stdout/stderr 转发
  - sandbox 选择
  - 失败降级
  - 资源限制
  - 异常处理

#### G61-01-T8: 单元测试（前端）
- **路径**: `frontend/src/__tests__/useClaudeCLI.test.tsx`
- **行数**: ~150 行
- **覆盖**:
  - EventSource 订阅
  - 流式缓冲
  - 状态机切换
  - 错误处理
  - 自动重连

#### G61-01-T9: 集成测试
- **路径**: `tests/integration/test_claude_cli_e2e.py`
- **行数**: ~150 行
- **覆盖**:
  - 启动 → 执行 → 完成 全流程
  - 取消流程
  - 超时流程
  - 失败降级

#### G61-01-T10: 浏览器端到端测试
- **路径**: `tests/e2e/g61-01-cli.e2e.test.ts`
- **行数**: ~100 行
- **覆盖**:
  - 打开 Solo 模式
  - 输入 prompt
  - 启动 CLI
  - 验证流式输出
  - 验证思考过程
  - 取消

---

### G61-02: Goal mode 完整循环 UI

#### G61-02-T1: Backend - Goal 数据模型
- **路径**: `backend/app/models/goal.py`
- **行数**: ~150 行
- **内容**:
  - `Goal` / `Plan` / `Step` Pydantic 模型
  - 状态机定义
  - 数据库表 schema

#### G61-02-T2: Backend - Goal 持久化
- **路径**: `backend/app/services/goal_storage.py`
- **行数**: ~200 行
- **内容**:
  - SQLite / PostgreSQL 存储
  - CRUD 操作
  - 索引优化

#### G61-02-T3: Backend - Goal Engine
- **路径**: `backend/app/services/goal_engine.py`
- **行数**: ~300 行
- **内容**:
  - Goal 分解为 Plan（LLM 调用）
  - Plan 分解为 Step（LLM 调用）
  - Step 自动验证（可配置）
  - 进度报告生成

#### G61-02-T4: Backend - Goal API
- **路径**: `backend/app/api/goal.py`
- **行数**: ~300 行
- **内容**:
  - POST /api/goal
  - GET /api/goal/{id}
  - PATCH /api/goal/{id} (pause/resume)
  - GET /api/goal/{id}/events (SSE)

#### G61-02-T5: Frontend - useGoalMode Hook
- **路径**: `frontend/src/hooks/useGoalMode.ts`
- **行数**: ~300 行
- **内容**:
  - Goal 状态机
  - IndexedDB 持久化
  - pause/resume
  - 进度报告订阅

#### G61-02-T6: Frontend - GoalTree 组件
- **路径**: `frontend/src/components/GoalTree.tsx`
- **行数**: ~400 行
- **内容**:
  - 三层树状可视化
  - 实时状态更新（每 100ms 节流）
  - 点击节点查看详情
  - 操作按钮（pause/resume/cancel）

#### G61-02-T7: Frontend - GoalTimeline 组件
- **路径**: `frontend/src/components/GoalTimeline.tsx`
- **行数**: ~200 行
- **内容**:
  - 时间线视图
  - 进度报告
  - 自动摘要
  - 手动展开/折叠

#### G61-02-T8: Frontend - GoalCreationDialog
- **路径**: `frontend/src/components/GoalCreationDialog.tsx`
- **行数**: ~150 行
- **内容**:
  - Goal 创建表单
  - 优先级选择
  - 估算时间
  - 提交 + 验证

#### G61-02-T9: 前端集成
- **路径**: `frontend/src/pages/VibeSoloShell.tsx`
- **行数**: ~80 行修改
- **内容**:
  - 集成 GoalTree
  - 集成 GoalTimeline
  - 集成 GoalCreationDialog

#### G61-02-T10: 单元测试
- **路径**: `backend/tests/test_goal.py`
- **行数**: ~250 行
- **覆盖**:
  - Goal 创建 / 分解
  - Plan / Step 状态机
  - 持久化
  - SSE 事件
  - pause/resume

#### G61-02-T11: 单元测试（前端）
- **路径**: `frontend/src/__tests__/useGoalMode.test.tsx`
- **行数**: ~200 行
- **覆盖**:
  - Goal 状态机
  - IndexedDB 持久化
  - pause/resume
  - 进度报告

#### G61-02-T12: 集成测试
- **路径**: `tests/integration/test_goal_e2e.py`
- **行数**: ~150 行
- **覆盖**:
  - Goal 创建 → 分解 → 执行 → 完成
  - pause → resume
  - 持久化恢复
  - 进度报告生成

#### G61-02-T13: 浏览器端到端测试
- **路径**: `tests/e2e/g61-02-goal.e2e.test.ts`
- **行数**: ~120 行
- **覆盖**:
  - 打开 Goal mode
  - 创建 Goal
  - 验证 Plan / Step 自动生成
  - 三层树状展示
  - pause / resume
  - 刷新后状态恢复
  - 进度报告自动生成

---

### G61-03: Auto-Follow 联动增强

#### G61-03-T1: useAutoFollow Hook 重构
- **路径**: `frontend/src/hooks/useAutoFollow.ts` (v1.1.0 → v2.0.0)
- **行数**: ~400 行（重构 + 增强）
- **内容**:
  - 15 类事件完整监听
  - 47 panel 完整映射
  - 事件去重 / 节流（100ms）
  - 优先级排序
  - Predictive Switch（预测下一个工具）

#### G61-03-T2: SplitView 组件
- **路径**: `frontend/src/components/SplitView.tsx`
- **行数**: ~200 行
- **内容**:
  - 主面板 + 工具面板上下分屏
  - 拖拽调整比例
  - 响应式

#### G61-03-T3: StickyTool 组件
- **路径**: `frontend/src/components/StickyTool.tsx`
- **行数**: ~150 行
- **内容**:
  - 固定重要工具
  - 防止 Auto-Follow 切换
  - 视觉指示（📌）

#### G61-03-T4: AutoFollowConfig 组件
- **路径**: `frontend/src/components/AutoFollowConfig.tsx`
- **行数**: ~200 行
- **内容**:
  - 配置 UI
  - 事件 → panel 映射可视化
  - Sticky tools 列表管理
  - 持久化到 localStorage

#### G61-03-T5: 前端集成
- **路径**: `frontend/src/pages/VibeSoloShell.tsx`
- **行数**: ~50 行修改
- **内容**:
  - 集成 SplitView
  - 集成 StickyTool
  - 集成 AutoFollowConfig

#### G61-03-T6: 单元测试
- **路径**: `frontend/src/__tests__/useAutoFollowV2.test.tsx`
- **行数**: ~200 行
- **覆盖**:
  - 15 类事件监听
  - 47 panel 映射
  - 节流
  - 优先级
  - Predictive Switch

#### G61-03-T7: 单元测试（SplitView / StickyTool）
- **路径**: `frontend/src/__tests__/SplitView.test.tsx` / `StickyTool.test.tsx`
- **行数**: ~150 行
- **覆盖**:
  - SplitView 分屏
  - 比例调整
  - StickyTool 固定

#### G61-03-T8: 集成测试
- **路径**: `tests/integration/test_auto_follow_v2.py`
- **行数**: ~100 行
- **覆盖**:
  - 事件 → panel 完整流程
  - 性能（< 50ms）

#### G61-03-T9: 浏览器端到端测试
- **路径**: `tests/e2e/g61-03-auto-follow.e2e.test.ts`
- **行数**: ~100 行
- **覆盖**:
  - 启动 Vibe Coding
  - 验证事件 → panel 切换
  - 启用 Split View
  - 固定 Sticky Tool

---

### G61-04: ComposerPlan 真正可执行

#### G61-04-T1: Backend - Plan 数据模型
- **路径**: `backend/app/models/plan.py`
- **行数**: ~150 行
- **内容**:
  - `Plan` / `Step` / `PlanExecution` 模型
  - 状态机定义
  - 数据库表 schema

#### G61-04-T2: Backend - Plan Executor
- **路径**: `backend/app/services/plan_executor.py`
- **行数**: ~400 行
- **内容**:
  - Plan 解析为 step 列表
  - 每步自动调用 LLM
  - 步骤间可暂停/恢复
  - 步骤自动验证
  - 失败重试 / 跳过 / 中止
  - 死循环防护（max_steps + timeout）

#### G61-04-T3: Backend - Plan API
- **路径**: `backend/app/api/plan.py`
- **行数**: ~200 行
- **内容**:
  - POST /api/plan/execute
  - POST /api/plan/{id}/pause
  - POST /api/plan/{id}/resume
  - POST /api/plan/{id}/step/{sid}/skip
  - POST /api/plan/{id}/step/{sid}/retry
  - GET /api/plan/execution/{id} (SSE)

#### G61-04-T4: Frontend - useComposerPlan Hook
- **路径**: `frontend/src/hooks/useComposerPlan.ts`
- **行数**: ~300 行
- **内容**:
  - Plan 解析
  - Step 编排
  - 暂停/恢复/跳过/重试
  - 失败处理

#### G61-04-T5: Frontend - PlanExecutor 组件
- **路径**: `frontend/src/components/PlanExecutor.tsx`
- **行数**: ~300 行
- **内容**:
  - Plan 列表展示
  - Step 状态卡片
  - 操作按钮（暂停/恢复/跳过/重试）
  - 进度可视化

#### G61-04-T6: 前端集成
- **路径**: `frontend/src/components/ComposerPanel.tsx`
- **行数**: ~80 行修改
- **内容**:
  - 集成 PlanExecutor
  - 替换旧 Composer 流程

#### G61-04-T7: 单元测试
- **路径**: `backend/tests/test_plan_executor.py`
- **行数**: ~200 行
- **覆盖**:
  - Plan 解析
  - Step 执行
  - 暂停/恢复
  - 跳过/重试
  - 死循环防护

#### G61-04-T8: 单元测试（前端）
- **路径**: `frontend/src/__tests__/useComposerPlan.test.tsx`
- **行数**: ~150 行
- **覆盖**:
  - Plan 解析
  - 步骤状态切换
  - 操作按钮事件

#### G61-04-T9: 集成测试
- **路径**: `tests/integration/test_plan_executor_e2e.py`
- **行数**: ~100 行
- **覆盖**:
  - Plan 执行全流程
  - 暂停 / 恢复
  - 跳过 / 重试
  - 死循环防护

#### G61-04-T10: 浏览器端到端测试
- **路径**: `tests/e2e/g61-04-composer-plan.e2e.test.ts`
- **行数**: ~100 行
- **覆盖**:
  - 创建 Plan（3 步）
  - 点击执行
  - 验证 step 依次执行
  - pause / resume
  - 失败的 step 重试
  - 死循环防护

---

## 3. 任务执行顺序

### Phase 1: 基础设施（Week 1）
- G61-01-T1 ~ T3 (Backend CLI 基础)
- G61-03-T1 (useAutoFollow 重构)

### Phase 2: 前端组件（Week 2）
- G61-01-T4 ~ T6 (Frontend CLI 集成)
- G61-03-T2 ~ T5 (SplitView / StickyTool / Config)

### Phase 3: Composer Plan（Week 2-3）
- G61-04-T1 ~ T6 (Plan Executor)
- G61-04-T7 ~ T10 (测试)

### Phase 4: Goal Mode（Week 3-4）
- G61-02-T1 ~ T9 (Goal Engine + UI)
- G61-02-T10 ~ T13 (测试)

### Phase 5: 集成 + 验证（Week 4）
- 端到端集成测试
- TRAE-browseruse 验证
- 性能 / 安全 / 兼容性测试
- 修复 + 优化

---

## 4. Git 分支策略

每个 P0 任务一个独立分支：

```bash
# 主分支
main (稳定)

# 功能分支
feature/g61-01-claude-cli-subprocess
feature/g61-02-goal-mode-ui
feature/g61-03-auto-follow-v2
feature/g61-04-composer-plan-executable

# 集成分支
integration/g61-cycle-61

# 完成后合并到 main
```

每个任务完成后通过 hook 自动 git commit。

---

## 5. 工时统计

| 任务 | 工作量 | 风险 | 周期 |
|------|--------|------|------|
| G61-01 | 5 人天 | 🟠 高 | Week 1-2 |
| G61-02 | 6 人天 | 🟡 中 | Week 3-4 |
| G61-03 | 4 人天 | 🟢 低 | Week 1-2 |
| G61-04 | 5 人天 | 🟡 中 | Week 2-3 |
| **合计** | **20 人天** | | **4 周** |

---

**任务清单完成。下一步进入 CYCLE61_CHECKLIST.md（验收清单）→ 实施。**
