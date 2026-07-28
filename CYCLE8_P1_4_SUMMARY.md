# Cycle 8 P1-4: /loop 命令集 (Loop Engineering triage/plan/execute/verify)

> **任务**: Cycle 8 P1-4
> **版本**: v6.1.0
> **日期**: 2026-07-27
> **状态**: ✅ 100% 完成
> **关联调研**: [CYCLE8_RESEARCH_REPORT.md](../../CYCLE8_RESEARCH_REPORT.md)
> **关联 Spec**: [spec.md](../../.trae/specs/cycle8/loop-commands/spec.md)

---

## 一、任务背景

### 1.1 现状

`/loop` slash command 已在 P0-12 注册到 `SlashCommandRegistry`，但其 handler `handler_run_loop` 是占位实现，仅返回成功消息而不实际触发 Loop Engineering 流程。

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
      找到 11 个任务：
      - P0: 5 个
      - P1: 3 个
      - P2: 3 个
      下一个推荐: 集成 Loop Engineering v7 异步执行器

用户: /loop plan
系统: ✓ 已创建分支 loop/plan-1785197760
      ✓ spec.md + checklist.md 已生成
      等待执行 /loop execute

用户: /loop execute
系统: ✓ 自动 git commit: da15d4c6

用户: /loop verify
系统: ✓ TypeScript 编译: passed
      任务验收通过
```

---

## 二、交付清单

### 2.1 后端实现

| 文件 | 行数 | 描述 |
|------|------|------|
| `backend/app/services/loop_commands/__init__.py` | 35 | 模块导出 |
| `backend/app/services/loop_commands/triage.py` | 191 | TriageService + parse_tasks + TaskItem |
| `backend/app/services/loop_commands/plan.py` | 251 | PlanService + spec/checklist 生成 + git 分支 |
| `backend/app/services/loop_commands/execute.py` | 180 | ExecuteService + Loop Engineering v7 + git commit |
| `backend/app/services/loop_commands/verify.py` | 286 | VerifyService + pytest + e2e + tsc |
| `backend/app/services/loop_commands/async_runner.py` | 214 | AsyncRunner 单例 + LoopWorkflowStatus |
| `backend/app/api/loop_commands.py` | 331 | 8 REST API 端点 |

**总计**: 1488 行后端代码

### 2.2 API 端点（8 个）

- `GET /api/loop-commands/health` - 健康检查
- `POST /api/loop-commands/triage` - 任务优先级分析
- `POST /api/loop-commands/plan` - 生成 spec + branch
- `POST /api/loop-commands/execute` - 执行 task + git commit
- `POST /api/loop-commands/verify` - 验证任务
- `GET /api/loop-commands/status/{workflow_id}` - 查询异步状态
- `GET /api/loop-commands/list` - 列出所有工作流
- `DELETE /api/loop-commands/{workflow_id}` - 取消工作流

### 2.3 集成修改

- `backend/app/main.py` (v6.1.0): 注册 `/api/loop-commands` 路由
- `backend/app/services/slash_command_executor.py` (v1.1.0): 增强 `handler_run_loop` 集成 4 个子命令

### 2.4 测试文件

| 文件 | 行数 | 测试数 |
|------|------|--------|
| `tests/test_loop_commands_units.py` | 320 | 25 单元测试 |
| `tests/test_e2e_loop_commands.sh` | 200 | 11 E2E 测试 |

### 2.5 测试样本

- `tasks.md` (24 行): P0/P1/P2 任务示例，5 个 P0 + 3 个 P1 + 3 个 P2

---

## 三、技术亮点

### 3.1 TriageService

- ✅ 正则表达式解析 tasks.md 任务行 + 子任务
- ✅ 智能识别 P0/P1/P2 优先级标签
- ✅ 智能识别 pending/completed 状态
- ✅ 按优先级 + 行号排序
- ✅ 返回 next_recommended（最高优先级 + pending 任务）

### 3.2 PlanService

- ✅ 集成 Loop Engineering v7 step5_critique_iteration
- ✅ 自动创建 spec.md / checklist.md（不存在时）
- ✅ 智能 git 分支名（避免冲突，自动添加 -1, -2 后缀）
- ✅ 非 git 仓库优雅降级

### 3.3 ExecuteService

- ✅ 集成 Loop Engineering v7 step6-step9
- ✅ 自动 git add + commit
- ✅ 智能检测是否有变更（无变更不 commit）
- ✅ 自动 commit message 格式

### 3.4 VerifyService

- ✅ 单元测试解析（pytest 输出）
- ✅ E2E 测试解析（"通过: X / 失败: Y" 格式）
- ✅ TypeScript 编译检查（tsc --noEmit）
- ✅ 可选 Vite 构建（较慢，默认关闭）
- ✅ 智能降级（tests dir 不存在、tsconfig.json 不存在等）

### 3.5 AsyncRunner

- ✅ 单例模式（全局共享 workflow 状态）
- ✅ 异步后台任务（asyncio.Task）
- ✅ 实时状态跟踪（pending/running/completed/failed/cancelled）
- ✅ 工作流取消（task.cancel()）

### 3.6 路径白名单安全

- ✅ 仅允许 3 个白名单路径
- ✅ 防止越权访问（HTTP 403）

---

## 四、测试结果

| 测试维度 | 数量 | 通过率 |
|----------|------|--------|
| 单元测试 (test_loop_commands_units.py) | 25/25 | 100% |
| E2E 测试 (test_e2e_loop_commands.sh) | 11/11 | 100% |
| 后端 API 端点 | 8 | 100% 可用 |
| **总计** | **36/36** | **100%** |

### 4.1 单元测试覆盖

- T1: TriageService 解析 (7 测试) - parse_tasks, sort_tasks_by_priority, analyze
- T2: PlanService (5 测试) - ensure_spec_file, ensure_checklist_file, create_branch
- T3: ExecuteService (5 测试) - execute, auto_commit, commit_message
- T4: VerifyService (5 测试) - parse_pytest, parse_e2e, verify, passed flag
- T5: AsyncRunner (3 测试) - singleton, submit, list

### 4.2 E2E 测试覆盖

- E1: 健康检查
- E2: triage 总任务数 + P0 分组
- E3: plan 创建分支 + spec 文件
- E4: execute 自动 git commit
- E5: verify TypeScript 编译
- E6: 列出工作流
- E7: 路径白名单 403 错误

---

## 五、使用示例

### 5.1 直接通过 API 调用

```bash
# triage
curl -X POST http://localhost:8000/api/loop-commands/triage \
  -H "Content-Type: application/json" \
  -d '{"project_path": "/home/qizheng/auto_code_ws"}'

# plan
curl -X POST http://localhost:8000/api/loop-commands/plan \
  -H "Content-Type: application/json" \
  -d '{"project_path": "/home/qizheng/auto_code_ws", "max_iterations": 3}'

# execute
curl -X POST http://localhost:8000/api/loop-commands/execute \
  -H "Content-Type: application/json" \
  -d '{"project_path": "/home/qizheng/auto_code_ws"}'

# verify
curl -X POST http://localhost:8000/api/loop-commands/verify \
  -H "Content-Type: application/json" \
  -d '{"project_path": "/home/qizheng/auto_code_ws", "run_unit": true, "run_typescript": true}'
```

### 5.2 通过 slash command 调用

```bash
# 在输入框输入:
/loop triage
/loop plan
/loop execute
/loop verify
```

后端 handler_run_loop 自动路由到对应的 Service。

---

## 六、关键设计决策

### 6.1 异步执行 vs 同步执行

**采用异步模式**（AsyncRunner）：
- 优点：UI 不阻塞、SSE 推送进度、状态可查询
- 缺点：实现稍复杂

### 6.2 路径白名单

仅允许 3 个项目路径：
- `/home/qizheng/auto_code_ws` - 当前工作项目
- `/home/qizheng/auto_code_data` - 数据存储
- `/tmp/test-projects` - 临时测试

### 6.3 Loop Engineering v7 集成策略

- 优雅降级：Loop Engineering v7 不可用时，使用简化版本
- 异常处理：任何 step 失败不影响其他 step
- 进度推送：通过 LoopWorkflowStatus 跟踪 current_step

### 6.4 git 操作安全

- 检查是否在 git 仓库
- 检查分支名冲突（自动加 -1, -2 后缀）
- 检查是否有变更（无变更不 commit）
- 默认 commit message 格式：`loop: execute <task_title>`

---

## 七、修改关键文件

```
backend/app/services/loop_commands/__init__.py           (新建: 35 行)
backend/app/services/loop_commands/triage.py             (新建: 191 行)
backend/app/services/loop_commands/plan.py               (新建: 251 行)
backend/app/services/loop_commands/execute.py            (新建: 180 行)
backend/app/services/loop_commands/verify.py             (新建: 286 行)
backend/app/services/loop_commands/async_runner.py       (新建: 214 行)
backend/app/api/loop_commands.py                         (新建: 331 行)
backend/app/main.py                                      (修改: +4 行 路由注册)
backend/app/services/slash_command_executor.py           (修改: +57 行 集成 loop_commands)
tasks.md                                                 (新建: 24 行 测试样本)
tests/test_loop_commands_units.py                        (新建: 320 行 25 单元)
tests/test_e2e_loop_commands.sh                          (新建: 200 行 11 E2E)
.trae/specs/cycle8/loop-commands/spec.md                 (新建: 485 行 完整设计)
CYCLE8_P1_4_SUMMARY.md                                   (新建: 本文档)
```

---

## 八、后续规划

### 8.1 P1-5 候选

- DiffView 组件增强（side-by-side 模式 + 行号 + 折叠）
- Custom Agents 路由层（TRAE Kit 20 specialist agents）
- Loop Engineering v7 SSE 实时进度推送增强
- /loop 子命令前端 UI 集成（SlashCommandPicker 增强）

### 8.2 P2 候选

- 端到端 Playwright 自动化测试套件
- 性能基准测试（1000 并发 LLM 请求）
- 国际化（i18n）中英双语切换

---

## 九、结论

- ✅ P1-4 100% 完成
- ✅ 25/25 单元测试通过（100%）
- ✅ 11/11 E2E 测试通过（100%）
- ✅ 8 API 端点全部可用
- ✅ 1,488 行后端代码
- ✅ 0 critical bug
- ✅ /loop 命令集从占位升级为真实可用
