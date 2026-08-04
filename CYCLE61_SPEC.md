# CYCLE61_SPEC.md — Solo 模式 P0 任务规范

> **Cycle**: 61
> **日期**: 2026-08-04
> **主题**: Claude Code CLI 真实集成 + Goal mode UI + Auto-Follow 增强 + ComposerPlan 可执行
> **版本**: v1.0

---

## 1. 总体目标

完成 4 个 P0 关键任务，将 Hermes Solo 模式与 Codex 0.146+ / TRAE Solo 2026 Q3 能力对齐度从 82% 提升至 90%。

| 任务 ID | 任务名称 | 代码量 | 风险 | 依赖 |
|---------|---------|--------|------|------|
| G61-01 | Claude Code CLI 真实 subprocess | ~1200 行 | 🟠 高 | G61-02, G61-03 |
| G61-02 | Goal mode 完整循环 UI | ~1500 行 | 🟡 中 | G61-01, G61-04 |
| G61-03 | Auto-Follow 联动增强 | ~1000 行 | 🟢 低 | — |
| G61-04 | ComposerPlan 真正可执行 | ~1200 行 | 🟡 中 | G61-01 |
| **合计** | | **~4900 行** | | |

---

## 2. G61-01: Claude Code CLI 真实 subprocess

### 2.1 功能需求

**目标**：实现真实的 Claude Code CLI subprocess 调用，仿 Codex CLI 的 shell-out 能力。

**用户场景**：
1. 用户在 Solo 模式输入 prompt
2. 系统调用 `claude --prompt "..."`（真实 subprocess）
3. Claude CLI 的 stdin/stdout/stderr 流式转发到前端
4. 沙箱隔离保证安全
5. 若 `claude` CLI 不在 PATH，自动降级为 LLM HTTP

### 2.2 技术实现方案

**架构**：
```
[Frontend: VibeCodingStage]
    ↓ POST /api/claude-cli/exec
[Backend: claude_cli_router]
    ↓ subprocess.Popen
[Claude CLI Process (sandbox)]
    ↓ stdout (JSON Lines)
[SSE Stream: /api/claude-cli/{id}/events]
    ↓
[Frontend: useClaudeCLI Hook]
    ↓
[UI: 流式显示 + 思考过程]
```

**核心模块**：

1. **Backend: `backend/app/services/claude_cli.py`**（~400 行）
   - `ClaudeCLIProcess` 类：管理 subprocess 生命周期
   - `exec_prompt(prompt, options)` → `AsyncIterator[CLIEvent]`
   - sandbox 选择：Docker / gVisor / firejail
   - 失败降级：检测 `claude` CLI 不在 PATH 时调用 LLM HTTP

2. **Backend: `backend/app/api/claude_cli.py`**（~200 行）
   - `POST /api/claude-cli/exec` 启动 subprocess
   - `GET /api/claude-cli/{id}/events` SSE 流
   - `POST /api/claude-cli/{id}/cancel` 取消

3. **Frontend: `frontend/src/hooks/useClaudeCLI.ts`**（~300 行）
   - EventSource 订阅 SSE
   - 流式缓冲
   - 错误处理 + 重连

4. **Frontend: `frontend/src/components/ClaudeCLIStage.tsx`**（~300 行）
   - 流式输出显示
   - 思考过程可视化
   - 工具调用展示
   - 取消按钮

### 2.3 接口设计规范

**Request: POST /api/claude-cli/exec**
```json
{
  "prompt": "实现一个 Go 语言 Hello World 函数",
  "model": "claude-sonnet-4-20250514",
  "options": {
    "sandbox": "docker",  // docker / gvisor / firejail / none
    "timeout": 300,        // 秒
    "max_tokens": 8192,
    "tools": ["read", "write", "bash"]
  }
}
```

**Response: 202 Accepted**
```json
{
  "id": "cli-abc123",
  "status": "running",
  "created_at": "2026-08-04T10:00:00Z"
}
```

**SSE Event Types**:
- `cli_started`: CLI 进程启动
- `cli_stdout`: 标准输出片段
- `cli_stderr`: 标准错误片段
- `cli_thinking`: 思考过程片段
- `cli_tool_call`: 工具调用
- `cli_tool_result`: 工具结果
- `cli_exit`: 进程退出（带 exit_code）

**错误码**:
- `CLI_NOT_FOUND`: `claude` CLI 不在 PATH
- `CLI_TIMEOUT`: 超时
- `CLI_OOM`: 内存溢出
- `CLI_SANDBOX_ERROR`: sandbox 启动失败

### 2.4 数据结构

```python
# backend/app/models/claude_cli.py

class CLIEventType(str, Enum):
    STARTED = "cli_started"
    STDOUT = "cli_stdout"
    STDERR = "cli_stderr"
    THINKING = "cli_thinking"
    TOOL_CALL = "cli_tool_call"
    TOOL_RESULT = "cli_tool_result"
    EXIT = "cli_exit"

class CLIEvent(BaseModel):
    id: str
    type: CLIEventType
    timestamp: float
    content: str  # 文本内容
    metadata: Optional[Dict[str, Any]] = None  # 工具调用信息等
```

### 2.5 性能与安全要求

**性能**：
- 启动延迟 < 500ms
- 流式输出延迟 < 100ms（chunk 间）
- 内存占用 < 512MB / process
- 并发支持：≥ 5 个 CLI 进程

**安全**：
- sandbox 必须：Docker / gVisor / firejail（生产环境）
- 禁止网络访问外部（仅允许 LLM API）
- 资源限制：CPU < 80%, MEM < 512MB, TIME < 300s
- 文件系统隔离：仅访问工作目录
- 进程清理：subprocess 必须有 timeout，结束后强制 kill

### 2.6 验收标准

**功能测试**：
- [ ] T1.1: 启动 Claude CLI subprocess，验证进程创建
- [ ] T1.2: stdin 发送 prompt，stdout 接收响应
- [ ] T1.3: SSE 流式转发到前端，前端实时显示
- [ ] T1.4: 思考过程单独通道（`cli_thinking`）
- [ ] T1.5: 工具调用展示（`cli_tool_call`）
- [ ] T1.6: 取消按钮触发 `POST /cancel`，subprocess 被 kill
- [ ] T1.7: 超时自动 kill
- [ ] T1.8: `claude` 不在 PATH 时降级到 LLM HTTP

**性能测试**：
- [ ] T1.9: 启动延迟 < 500ms（5 次平均）
- [ ] T1.10: 流式输出延迟 < 100ms
- [ ] T1.11: 并发 5 个 CLI 进程，内存 < 2.5GB

**安全测试**：
- [ ] T1.12: subprocess 无法访问工作目录外文件
- [ ] T1.13: subprocess 无法发起任意网络连接
- [ ] T1.14: 资源超限自动 kill
- [ ] T1.15: 异常退出时清理资源

**浏览器端到端测试**（TRAE-browseruse）：
- [ ] T1.16: 打开 Solo 模式，输入 prompt
- [ ] T1.17: 点击启动，验证流式输出显示
- [ ] T1.18: 验证思考过程单独显示
- [ ] T1.19: 验证工具调用卡片显示
- [ ] T1.20: 点击取消，验证进程被 kill
- [ ] T1.21: 验证 `claude` 缺失时降级到 LLM HTTP 正常工作

**通过标准**: 21/21 项全通过

---

## 3. G61-02: Goal mode 完整循环 UI

### 3.1 功能需求

**目标**：实现 Goal-Plan-Step 三层可视化 UI，对标 Codex Goal mode。

**用户场景**：
1. 用户在 Solo 模式输入 Goal（高级别目标，如"开发一个 TODO 应用"）
2. 系统自动分解为 Plan（步骤列表）
3. Plan 分解为 Step（每步带 owner / 工具 / 验证）
4. 三层可视化（树状 / 时间线）
5. pause/resume 后自动恢复
6. 每 N 步自动生成进度报告

### 3.2 技术实现方案

**架构**：
```
[Frontend: GoalModeUI]
    ↓ 
[Hook: useGoalMode]
    ↓
[LocalStorage / IndexedDB 持久化]
    ↓
[Backend: /api/goal/*]
    ↓
[Loop V7 Engine: loop_engineering_v7]
```

**核心模块**：

1. **Frontend: `frontend/src/hooks/useGoalMode.ts`**（~300 行）
   - Goal 状态机
   - 持久化（localStorage + IndexedDB）
   - pause/resume

2. **Frontend: `frontend/src/components/GoalTree.tsx`**（~400 行）
   - 三层树状可视化
   - 实时状态更新
   - 点击节点查看详情

3. **Frontend: `frontend/src/components/GoalTimeline.tsx`**（~200 行）
   - 时间线视图
   - 进度报告
   - 自动摘要

4. **Backend: `backend/app/api/goal.py`**（~300 行）
   - CRUD for Goal / Plan / Step
   - SSE 事件流
   - 持久化到 SQLite / PostgreSQL

5. **Backend: `backend/app/services/goal_engine.py`**（~300 行）
   - Goal 分解为 Plan
   - Plan 分解为 Step
   - Step 自动验证
   - 进度报告生成

### 3.3 接口设计规范

**Request: POST /api/goal**
```json
{
  "title": "开发一个 TODO 应用",
  "description": "使用 React + TypeScript + TailwindCSS",
  "priority": "high",
  "estimated_hours": 4
}
```

**Response: 201 Created**
```json
{
  "id": "goal-abc123",
  "title": "开发一个 TODO 应用",
  "state": "planning",
  "plan": null,
  "created_at": "2026-08-04T10:00:00Z"
}
```

**State Machine**:
```
planning → ready → executing → paused
                            ↓
                         reviewing → done
                            ↓
                          error → cancelled
```

**SSE Event Types**:
- `goal_created`: Goal 创建
- `goal_planned`: Plan 生成完成
- `step_started`: Step 开始
- `step_completed`: Step 完成
- `step_failed`: Step 失败
- `goal_paused`: Goal 暂停
- `goal_resumed`: Goal 恢复
- `goal_completed`: Goal 完成
- `goal_progress`: 进度报告

### 3.4 数据结构

```python
class GoalState(str, Enum):
    PLANNING = "planning"
    READY = "ready"
    EXECUTING = "executing"
    PAUSED = "paused"
    REVIEWING = "reviewing"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"

class Step(BaseModel):
    id: str
    title: str
    description: str
    owner: str  # "human" | "agent" | "subagent:xxx"
    tools: List[str]
    verify: Optional[str]  # 验证条件
    state: StepState
    started_at: Optional[float]
    completed_at: Optional[float]
    result: Optional[Any]

class Plan(BaseModel):
    id: str
    goal_id: str
    steps: List[Step]
    estimated_minutes: int
    created_at: float

class Goal(BaseModel):
    id: str
    title: str
    description: str
    state: GoalState
    plan_id: Optional[str]
    priority: str
    created_at: float
    updated_at: float
```

### 3.5 性能与安全要求

**性能**：
- Goal 创建到 Plan 生成 < 5s
- 进度报告生成 < 2s
- 三层树状渲染 100 节点 < 100ms

**安全**：
- Goal 仅本人可访问（基于 user_id）
- pause/resume 操作需二次确认
- Step 执行需明确 owner

### 3.6 验收标准

**功能测试**：
- [ ] T2.1: 创建 Goal，验证自动分解为 Plan
- [ ] T2.2: Plan 分解为 Step
- [ ] T2.3: 三层树状可视化（Goal-Plan-Step）
- [ ] T2.4: pause 后状态保存到 IndexedDB
- [ ] T2.5: 刷新页面后自动恢复
- [ ] T2.6: resume 后继续执行
- [ ] T2.7: 每 5 步自动生成进度报告
- [ ] T2.8: Step 失败时进入 error 状态，可重试

**性能测试**：
- [ ] T2.9: Goal 创建到 Plan 生成 < 5s
- [ ] T2.10: 100 节点三层树渲染 < 100ms

**安全测试**：
- [ ] T2.11: pause 操作需二次确认
- [ ] T2.12: Step owner 严格匹配

**浏览器端到端测试**（TRAE-browseruse）：
- [ ] T2.13: 打开 Goal mode UI
- [ ] T2.14: 创建 Goal "开发 TODO 应用"
- [ ] T2.15: 验证自动生成 Plan + Step
- [ ] T2.16: 点击 Step 节点查看详情
- [ ] T2.17: 点击 pause，验证状态保存
- [ ] T2.18: 刷新页面，验证状态恢复
- [ ] T2.19: 点击 resume，验证继续执行
- [ ] T2.20: 验证进度报告每 5 步自动生成

**通过标准**: 20/20 项全通过

---

## 4. G61-03: Auto-Follow 联动增强

### 4.1 功能需求

**目标**：增强 Auto-Follow 联动，完整 15 类事件 → 47 panel 映射，新增 Predictive Switch / Split View / Sticky Tool。

### 4.2 技术实现方案

**核心模块**：

1. **Frontend: `frontend/src/hooks/useAutoFollow.ts`**（v1.1.0 → v2.0.0 重构，~400 行）
   - 15 类事件监听
   - 47 panel 完整映射
   - 事件去重 / 节流
   - 优先级排序
   - Predictive Switch（预测下一个工具）

2. **Frontend: `frontend/src/components/SplitView.tsx`**（~200 行）
   - 主面板 + 工具面板上下分屏
   - 拖拽调整比例

3. **Frontend: `frontend/src/components/StickyTool.tsx`**（~150 行）
   - 固定重要工具
   - 防止 Auto-Follow 自动切换

### 4.3 接口设计规范

**Event Types（15 类）**:
| Event | 阶段 | 默认 panel |
|-------|------|-----------|
| `vibe_step_started` | executing | planExecutor |
| `vibe_plan_generated` | planning | planEditor |
| `vibe_code_writing` | executing | editor |
| `vibe_test_running` | testing | terminal |
| `vibe_step_completed` | executing | planExecutor |
| `vibe_step_failed` | error | error |
| `vibe_plan_completed` | reviewing | review |
| `loop_state_changed` | looping | loopState |
| `claude_shell_output` | executing | terminal |
| `spec_review_requested` | reviewing | loopState |
| `goal_progress_updated` | looping | loopV7 |
| `subagent_spawned` | executing | multiAgentTree |
| `subagent_completed` | executing | multiAgentTree |
| `diff_preview_ready` | reviewing | planEditor |
| `test_results_ready` | testing | planExecutor |

### 4.4 数据结构

```typescript
export type AutoFollowEventType = 
  | 'vibe_step_started' | 'vibe_plan_generated' | 'vibe_code_writing'
  | 'vibe_test_running' | 'vibe_step_completed' | 'vibe_step_failed'
  | 'vibe_plan_completed' | 'loop_state_changed' | 'claude_shell_output'
  | 'spec_review_requested' | 'goal_progress_updated' | 'subagent_spawned'
  | 'subagent_completed' | 'diff_preview_ready' | 'test_results_ready';

export interface AutoFollowConfig {
  enabled: boolean;
  panelMapping: Record<AutoFollowEventType, PanelKey | null>;
  throttleMs: number;
  predictive: boolean;
  stickyTools: PanelKey[];
  splitView: boolean;
}
```

### 4.5 性能与安全要求

**性能**：
- 事件 → panel 切换 < 50ms
- 节流：100ms 窗口内同类型事件去重
- 优先级：error > reviewing > executing > others

### 4.6 验收标准

**功能测试**：
- [ ] T3.1: 15 类事件完整监听
- [ ] T3.2: 47 panel 完整映射
- [ ] T3.3: Predictive Switch 正确预测下一个工具
- [ ] T3.4: Split View 上下分屏工作
- [ ] T3.5: Sticky Tool 固定不被切换
- [ ] T3.6: 100ms 节流生效
- [ ] T3.7: 事件优先级排序正确

**性能测试**：
- [ ] T3.8: 事件 → panel 切换 < 50ms

**浏览器端到端测试**：
- [ ] T3.9: 启动 Vibe Coding，验证 step_started → planExecutor
- [ ] T3.10: 验证 code_writing → editor
- [ ] T3.11: 验证 test_running → terminal
- [ ] T3.12: 验证 step_failed → error
- [ ] T3.13: 启用 Split View，验证上下分屏
- [ ] T3.14: 固定 Sticky Tool，验证不被切换

**通过标准**: 14/14 项全通过

---

## 5. G61-04: ComposerPlan 真正可执行

### 5.1 功能需求

**目标**：将 ComposerPlan 从"文档"升级为"真正可执行"，Plan → step 编排 → LLM 循环驱动。

### 5.2 技术实现方案

**核心模块**：

1. **Frontend: `frontend/src/hooks/useComposerPlan.ts`**（~300 行）
   - Plan 解析
   - Step 编排
   - 暂停/恢复/跳过
   - 失败处理

2. **Frontend: `frontend/src/components/PlanExecutor.tsx`**（~300 行）
   - Plan 列表
   - Step 状态展示
   - 操作按钮（暂停/恢复/跳过/重试）

3. **Backend: `backend/app/services/plan_executor.py`**（~400 行）
   - Plan 解析为 step 列表
   - 每步自动调用 LLM
   - 步骤间可暂停/恢复
   - 失败重试策略

4. **Backend: `backend/app/api/plan.py`**（~200 行）
   - POST /api/plan/execute
   - POST /api/plan/{id}/pause
   - POST /api/plan/{id}/resume
   - POST /api/plan/{id}/step/{sid}/skip

### 5.3 接口设计规范

**Request: POST /api/plan/execute**
```json
{
  "plan_id": "plan-abc123",
  "options": {
    "auto_verify": true,
    "max_retries": 3,
    "on_failure": "skip"  // "skip" | "retry" | "abort"
  }
}
```

**Response: 202 Accepted**
```json
{
  "execution_id": "exec-abc123",
  "plan_id": "plan-abc123",
  "status": "running"
}
```

**Step State Machine**:
```
pending → running → verifying → completed
                       ↓
                     failed → (retry / skip / abort)
```

### 5.4 数据结构

```python
class StepState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

class StepExecution(BaseModel):
    step_id: str
    state: StepState
    started_at: Optional[float]
    completed_at: Optional[float]
    output: Optional[str]
    error: Optional[str]
    retry_count: int
    verification_result: Optional[bool]

class PlanExecution(BaseModel):
    id: str
    plan_id: str
    state: str
    current_step: int
    steps: List[StepExecution]
    created_at: float
    updated_at: float
```

### 5.5 性能与安全要求

**性能**：
- Plan 解析 < 100ms
- 步骤执行超时：默认 5min，可配置
- 最大步骤数：100

**安全**：
- 死循环防护：超过 max_steps 自动终止
- LLM 调用频率限制
- Step 执行结果沙箱验证

### 5.6 验收标准

**功能测试**：
- [ ] T4.1: Composer Plan 解析为 step 列表
- [ ] T4.2: 每步自动调用 LLM
- [ ] T4.3: pause/resume 完整状态恢复
- [ ] T4.4: 跳过 step
- [ ] T4.5: 重试 step
- [ ] T4.6: 失败时按策略处理
- [ ] T4.7: 步骤自动验证
- [ ] T4.8: 死循环防护（max_steps）

**性能测试**：
- [ ] T4.9: Plan 解析 < 100ms
- [ ] T4.10: 死循环防护生效

**浏览器端到端测试**：
- [ ] T4.11: 在 Composer 中创建 Plan（3 步）
- [ ] T4.12: 点击执行，验证 step 依次执行
- [ ] T4.13: 点击 pause，验证状态保存
- [ ] T4.14: 点击 resume，验证继续
- [ ] T4.15: 验证失败的 step 可重试
- [ ] T4.16: 验证死循环防护

**通过标准**: 16/16 项全通过

---

## 6. 通用验收标准

### 6.1 代码质量
- TypeScript / Python 类型完整
- 注释覆盖率 ≥ 80%
- 单元测试覆盖率 ≥ 80%
- ESLint / Prettier 通过

### 6.2 性能
- 启动延迟 < 500ms
- API 响应 < 200ms
- 流式输出延迟 < 100ms

### 6.3 兼容性
- Chrome / Edge / Firefox / Safari 最新版
- 暗色 / 浅色 / 高对比度 3 主题
- 桌面 / 平板 / 移动端 3 设备

### 6.4 安全性
- Sandbox 隔离
- Rate limiting
- 资源限制（CPU / MEM / TIME）
- 输入验证
- 错误兜底

---

## 7. 实施计划

### Phase 1: G61-01 + G61-03 (Week 1)
- 真实 CLI subprocess 集成
- Auto-Follow 联动增强
- 目标: 4 P0 任务中 2 个完成

### Phase 2: G61-04 (Week 2)
- ComposerPlan 真正可执行
- 目标: 3/4 P0 任务完成

### Phase 3: G61-02 (Week 3)
- Goal mode 完整循环 UI
- 目标: 4/4 P0 任务完成

### Phase 4: 集成测试 + 浏览器验证 (Week 4)
- 端到端测试
- TRAE-browseruse 验证
- 性能 / 安全 / 兼容性测试
- 目标: 100% 验收标准通过

---

## 8. 风险与回退

| 风险 | 概率 | 影响 | 回退策略 |
|------|------|------|----------|
| Claude CLI 不在 PATH | 🟠 高 | 🟠 中 | 降级到 LLM HTTP |
| subprocess 性能 | 🟡 中 | 🟠 中 | 异步 + 流式缓冲 |
| Goal 持久化失败 | 🟢 低 | 🟠 中 | 双写 localStorage + IndexedDB |
| Auto-Follow 误切换 | 🟡 中 | 🟢 低 | 关闭开关 |
| Plan 死循环 | 🟡 中 | 🔴 高 | max_steps + timeout |

---

**Cycle 61 SPEC 完成。下一步创建 CYCLE61_TASK.md（任务清单）和 CYCLE61_CHECKLIST.md（验收清单）→ 开始实施。**
