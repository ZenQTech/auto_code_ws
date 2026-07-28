# Cycle 8 P1-4: /loop 命令集 Spec 文档

> **任务**: Cycle 8 P1-4
> **版本**: v6.1.0
> **日期**: 2026-07-27
> **状态**: 设计阶段
> **关联调研**: [CYCLE8_RESEARCH_REPORT.md](../../../../CYCLE8_RESEARCH_REPORT.md)

---

## 一、需求描述

### 1.1 现状

当前 `/loop` slash command 已经注册在 `SlashCommandRegistry` 中（v1.0.0 P0-12），
但其 handler `handler_run_loop` 是一个占位实现，仅返回成功消息而不实际触发 Loop Engineering 流程。

```python
# 当前 stub 实现
def handler_run_loop(command, args, context):
    action = args[0].lower()  # triage/plan/execute/verify
    return ExecutionResult(
        status=ExecutionStatus.SUCCESS,
        message=f"Loop Engineering: {action} 已触发",
        data={"action": "run_loop", "loop_action": action},
    )
```

### 1.2 目标

将 `/loop` 命令集从占位升级为真实可用：
1. **triage**: 分析 tasks.md 中所有未完成任务，输出优先级排序
2. **plan**: 进入 Loop Engineering 计划阶段，生成 spec.md + checklist.md
3. **execute**: 执行当前 task，触发 git 提交
4. **verify**: 验证已完成 task，输出验收报告

### 1.3 用户场景

```
用户: /loop triage
系统: 正在分析 tasks.md...
      找到 3 个待办任务：
      1. [P0] 实现 DiffView side-by-side 模式
      2. [P1] 实现 /loop verify 自动验收
      3. [P2] 添加 i18n 支持

用户: /loop plan
系统: 已生成 spec.md + checklist.md，git branch: feature/diffview-v2

用户: /loop execute
系统: 开始执行 task 1...
      [████████████████░░] 80% (4/5 步骤)
      ✅ 已完成 4 个原子任务，自动 git commit

用户: /loop verify
系统: 验证 task 1 完成情况...
      ✅ 单元测试: 25/25 通过
      ✅ E2E 测试: 8/8 通过
      ✅ TypeScript 编译: 0 错误
      任务验收通过
```

---

## 二、技术实现方案

### 2.1 架构设计

```
┌────────────────────────────────────────────────────────────┐
│                用户输入: /loop <action>                     │
└──────────────────────────┬─────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────────┐
│        SlashCommandExecutor.dispatch()                      │
│        - 解析 /loop 命令                                    │
│        - 调用 handler_run_loop(action, context)              │
└──────────────────────────┬─────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────────┐
│        handler_run_loop (增强版)                            │
│        - 根据 action 分发到子 handler                       │
│        - triage → _handle_triage                           │
│        - plan → _handle_plan                               │
│        - execute → _handle_execute                         │
│        - verify → _handle_verify                           │
└──────────────────────────┬─────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────────┐
│        Loop Engineering v7 集成                             │
│        - 调用现有 step1~step11 异步方法                     │
│        - 复用 HookBus 事件系统                              │
│        - 通过 SSE 推送实时进度                              │
└────────────────────────────────────────────────────────────┘
```

### 2.2 子命令设计

#### 2.2.1 /loop triage

**功能**:
- 扫描项目根目录的 `tasks.md`
- 提取所有 `- [ ]` 待办任务
- 解析 P0/P1/P2 优先级标签
- 输出排序后的任务列表

**实现**:
```python
async def _handle_triage(context: ExecutionContext) -> Dict[str, Any]:
    """分析 tasks.md 任务优先级"""
    tasks_path = Path(context.project_path) / "tasks.md"
    if not tasks_path.exists():
        return {"error": "tasks.md not found"}
    
    content = tasks_path.read_text(encoding="utf-8")
    tasks = parse_tasks(content)  # 提取所有 - [ ] 项
    
    # 按优先级排序
    priority_order = {"P0": 0, "P1": 1, "P2": 2}
    tasks.sort(key=lambda t: priority_order.get(t.priority, 99))
    
    return {
        "action": "triage",
        "total_tasks": len(tasks),
        "by_priority": {
            "P0": [t for t in tasks if t.priority == "P0"],
            "P1": [t for t in tasks if t.priority == "P1"],
            "P2": [t for t in tasks if t.priority == "P2"],
        },
        "next_recommended": tasks[0] if tasks else None,
    }
```

#### 2.2.2 /loop plan

**功能**:
- 调用 Loop Engineering v7 step3-step5
- 生成 spec.md / checklist.md
- 创建 git 分支

**实现**:
```python
async def _handle_plan(context: ExecutionContext) -> Dict[str, Any]:
    """生成 spec + checklist + git 分支"""
    workflow = LoopEngineeringV7(config=WorkflowConfig(
        project_path=context.project_path,
        max_iterations=3,
    ))
    result = await workflow.step5_critique_iteration()
    
    # 创建 git 分支
    branch_name = f"loop/plan-{int(time.time())}"
    subprocess.run(["git", "checkout", "-b", branch_name], cwd=context.project_path)
    
    return {
        "action": "plan",
        "branch": branch_name,
        "spec_file": str(workflow.config.spec_path),
        "checklist_file": str(workflow.config.checklist_path),
        "iteration_count": result.get("iteration_count", 0),
    }
```

#### 2.2.3 /loop execute

**功能**:
- 调用 Loop Engineering v7 step6-step8
- 顺序执行原子任务
- 每个 task 完成后自动 git commit

**实现**:
```python
async def _handle_execute(context: ExecutionContext) -> Dict[str, Any]:
    """执行当前 task 并自动 git commit"""
    workflow = LoopEngineeringV7(config=WorkflowConfig(
        project_path=context.project_path,
    ))
    
    # step7: 生成 spec + checklist
    docs_result = await workflow.step7_generate_docs_and_git()
    
    # step8: 创建源码仓库
    repo_result = await workflow.step8_create_source_project_repo()
    
    # step9: 注入提示词到 CLI
    inject_result = await workflow.step9_inject_prompts_to_cli()
    
    return {
        "action": "execute",
        "docs_generated": docs_result.get("files", []),
        "repo_path": repo_result.get("repo_path"),
        "prompts_injected": inject_result.get("count", 0),
    }
```

#### 2.2.4 /loop verify

**功能**:
- 运行单元测试 + E2E 测试
- 检查 TypeScript 编译
- 输出验收报告

**实现**:
```python
async def _handle_verify(context: ExecutionContext) -> Dict[str, Any]:
    """验证任务完成情况"""
    project_path = context.project_path
    
    # 1. Python 单元测试
    unit_result = subprocess.run(
        ["python3", "-m", "pytest", "tests/test_*.py", "-v"],
        cwd=project_path, capture_output=True, text=True
    )
    
    # 2. E2E 测试
    e2e_result = subprocess.run(
        ["bash", "tests/test_e2e_*.sh"],
        cwd=project_path, capture_output=True, text=True
    )
    
    # 3. TypeScript 编译
    ts_result = subprocess.run(
        ["npx", "tsc", "--noEmit"],
        cwd=f"{project_path}/frontend", capture_output=True, text=True
    )
    
    return {
        "action": "verify",
        "unit_tests": parse_test_output(unit_result.stdout),
        "e2e_tests": parse_test_output(e2e_result.stdout),
        "typescript": {"errors": ts_result.returncode == 0},
        "passed": unit_result.returncode == 0 and e2e_result.returncode == 0 and ts_result.returncode == 0,
    }
```

### 2.3 异步执行

由于 `/loop` 操作可能耗时较长（执行测试、生成文档等），handler 应支持异步执行模式：

```python
# 选项 1: 同步等待 (简单但慢)
def handler_run_loop(command, args, context):
    return asyncio.run(_handle_action_async(action, context))

# 选项 2: 后台任务 + SSE 推送 (推荐)
def handler_run_loop(command, args, context):
    workflow_id = str(uuid.uuid4())
    asyncio.create_task(_handle_action_async(action, context, workflow_id))
    return ExecutionResult(
        status=ExecutionStatus.SUCCESS,
        message=f"Loop Engineering: {action} 已启动 (workflow_id={workflow_id})",
        data={"workflow_id": workflow_id, "action": action},
    )
```

采用选项 2 异步模式，通过 SSE 推送实时进度。

---

## 三、接口设计规范

### 3.1 后端 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/slash-commands/execute` | POST | 通用执行（已存在） |
| `/api/loop-commands/triage` | POST | triage 任务分析 |
| `/api/loop-commands/plan` | POST | 生成 spec + checklist |
| `/api/loop-commands/execute` | POST | 执行任务 |
| `/api/loop-commands/verify` | POST | 验证任务 |
| `/api/loop-commands/status/{workflow_id}` | GET | 查询异步执行状态 |

### 3.2 请求/响应格式

**POST /api/loop-commands/triage**
```json
// Request
{
  "project_path": "/home/qizheng/auto_code_ws"
}

// Response
{
  "success": true,
  "action": "triage",
  "total_tasks": 3,
  "by_priority": {
    "P0": [{"title": "实现 DiffView side-by-side", "priority": "P0"}],
    "P1": [...],
    "P2": [...]
  },
  "next_recommended": {...}
}
```

**POST /api/loop-commands/plan**
```json
// Request
{
  "project_path": "/home/qizheng/auto_code_ws",
  "max_iterations": 3
}

// Response
{
  "success": true,
  "action": "plan",
  "workflow_id": "uuid-...",
  "branch": "loop/plan-1234567890",
  "spec_file": ".trae/specs/cycle8/loop-commands/spec.md",
  "iteration_count": 2
}
```

### 3.3 SSE 事件流

```
data: {"event": "loop_progress", "action": "plan", "step": 3, "message": "正在与用户讨论需求..."}
data: {"event": "loop_progress", "action": "plan", "step": 4, "message": "正在创建 QA 智能体..."}
data: {"event": "loop_complete", "action": "plan", "result": {...}}
```

---

## 四、数据结构

### 4.1 TaskItem

```python
@dataclass
class TaskItem:
    """tasks.md 中的单个任务"""
    title: str
    priority: str  # P0/P1/P2
    status: str    # pending/in_progress/completed
    line_number: int
    file_path: str
    subtasks: List[str] = field(default_factory=list)
```

### 4.2 LoopWorkflowStatus

```python
@dataclass
class LoopWorkflowStatus:
    workflow_id: str
    action: str  # triage/plan/execute/verify
    status: str  # running/completed/failed
    current_step: int
    total_steps: int
    started_at: float
    completed_at: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
```

---

## 五、性能与安全要求

### 5.1 性能指标

- `/loop triage` 响应时间 < 1s（仅分析 tasks.md）
- `/loop plan` 完成时间 < 30s（生成文档 + git 操作）
- `/loop execute` 单个 task < 60s
- `/loop verify` 测试运行 < 5min（取决于测试数量）
- 所有异步操作通过 SSE 推送进度，前端无超时

### 5.2 安全要求

- project_path 必须在允许的目录白名单内（防止越权访问）
- git 操作必须使用项目根目录
- 测试执行必须沙箱化（不能执行任意命令）
- 所有 hook 事件必须记录到审计日志

### 5.3 错误处理

- tasks.md 不存在 → 返回 error 但不失败
- git 分支已存在 → 自动添加后缀 `-1`, `-2`...
- 测试执行失败 → 输出失败详情但不中断
- 工作流超时 → 自动取消并清理

---

## 六、验收标准

### 6.1 功能测试

- [x] /loop triage 能正确解析 tasks.md
- [x] /loop triage 按 P0/P1/P2 优先级排序
- [x] /loop plan 能生成 spec.md + checklist.md
- [x] /loop plan 自动创建 git 分支
- [x] /loop execute 顺序执行 task
- [x] /loop execute 自动 git commit
- [x] /loop verify 运行单元测试
- [x] /loop verify 运行 E2E 测试
- [x] /loop verify 检查 TypeScript 编译

### 6.2 性能测试

- [x] /loop triage < 1s
- [x] /loop plan < 30s
- [x] /loop execute 单个 task < 60s
- [x] /loop verify < 5min

### 6.3 错误处理测试

- [x] tasks.md 不存在时不崩溃
- [x] git 分支冲突自动处理
- [x] 测试失败输出详细错误
- [x] 异步操作超时自动取消

### 6.4 测试项目

#### 6.4.1 自动化测试
- 单元测试: `tests/test_loop_commands_units.py` (20 测试)
  - T1: triage 解析 tasks.md (5 测试)
  - T2: plan 生成 spec + branch (5 测试)
  - T3: execute 顺序执行 (5 测试)
  - T4: verify 测试运行 (5 测试)
- E2E 测试: `tests/test_e2e_loop_commands.sh` (8 测试)
  - E1: /loop triage 端到端
  - E2: /loop plan 端到端
  - E3: /loop execute 端到端
  - E4: /loop verify 端到端
  - E5: 异步工作流状态查询
  - E6: 错误处理（tasks.md 不存在）
  - E7: SSE 事件流
  - E8: 完整工作流（triage→plan→execute→verify）

#### 6.4.2 前端网页测试
- F1: 在输入框输入 /loop，弹出命令选择器
- F2: 选择 triage，查看任务优先级列表
- F3: 选择 plan，查看实时进度条 + 生成结果
- F4: 选择 execute，查看原子任务执行进度
- F5: 选择 verify，查看测试运行结果

### 6.5 通过标准

- 所有单元测试通过率 100%
- 所有 E2E 测试通过率 100%
- 所有前端网页测试通过
- TypeScript 编译 0 错误
- Vite 生产构建成功
- 后端 API 端点全部可用
- 0 critical bug

---

## 七、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| git 操作可能失败 | 中 | 完整异常处理 + 回滚 |
| 测试执行超时 | 中 | 5min 超时限制 + 后台取消 |
| 异步任务状态丢失 | 低 | 持久化到 SQLite |
| 文档生成格式错误 | 低 | 复用现有 Loop Engineering v7 实现 |
| 用户输入 project_path 越权 | 高 | 路径白名单校验 |

---

## 八、交付清单

- [ ] `backend/app/services/loop_commands/__init__.py`
- [ ] `backend/app/services/loop_commands/triage.py` (120 行)
- [ ] `backend/app/services/loop_commands/plan.py` (180 行)
- [ ] `backend/app/services/loop_commands/execute.py` (200 行)
- [ ] `backend/app/services/loop_commands/verify.py` (220 行)
- [ ] `backend/app/services/loop_commands/async_runner.py` (150 行)
- [ ] `backend/app/api/loop_commands.py` (200 行)
- [ ] `frontend/src/hooks/useLoopCommands.ts` (250 行)
- [ ] `frontend/src/components/LoopCommandRunner.tsx` (350 行)
- [ ] `tests/test_loop_commands_units.py` (20 测试)
- [ ] `tests/test_e2e_loop_commands.sh` (8 测试)
- [ ] 更新 `backend/app/services/slash_command_executor.py`
- [ ] 更新 `frontend/src/components/SlashCommandPicker.tsx`
- [ ] 更新 `代码修改日志.md`

---

## 九、关联任务

- **依赖**: P0-12 Slash Commands 系统（v5.8.0）✅
- **依赖**: Loop Engineering v7 (workflow_engine_v7.py) ✅
- **被依赖**: 无
