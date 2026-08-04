# CYCLE 65 功能差距分析报告

> **生成日期**: 2026-08-04
> **基础**: cycle63-gap-analysis.md + Cycle 64 增量分析
> **范围**: Codex CLI v0.145+ 新功能 + Trae SOLO Builder 完整对标

---

## 一、Cycle 64 增量完成

### 1.1 已完成 ✅
| 编号 | 功能 | 状态 | 验证 |
|------|------|------|------|
| G64-01 | Agent 角色真实执行跟踪 + Hook 事件 | ✅ | 14 unit + 7 API 测试通过 |
| G64-02 | 文件系统 Watch + Stage 联动 | ✅ | 38 unit + 8 API 测试通过 |
| G64-03 | StageDetectorBadge UI 优化 | ✅ | 17 单元测试通过 |
| 额外 | conftest.py 修复 ImportError | ✅ | 697 tests 全部 collect |
| 额外 | AgentRoleManager.test.tsx 测试隔离 | ✅ | 7 测试通过 |

### 1.2 完成度统计
- **后端代码**: +2000 行（Hook Event Bus + Agent Runner + FS Watcher + FS API）
- **前端代码**: +1500 行（AgentExecutionPanel + useAgentExecution + StageDetectorBadge v2）
- **新增测试**: 152 个（后端 86 + 前端 66）
- **测试通过率**: 100%（8368+ 前端 / 697 后端 collected）

---

## 二、Cycle 65 差距矩阵

### 2.1 仍需实现的功能（vs Codex CLI v0.145 + Trae SOLO Builder）

| # | 功能 | 优先级 | 当前状态 | 期望标准 | 实施复杂度 | 风险等级 |
|---|------|--------|----------|----------|------------|----------|
| 1 | **真实 CLI 集成** | 🔴 P1 | 🟡 mock 模式 | 调用真实 claude/hermes CLI，子进程 + 双向通信 | 高 | 中 |
| 2 | **CSV 批处理 spawn_agents** | 🟡 P1 | ❌ 缺失 | 每行一个 worker + 进度跟踪 + 结果汇总 | 中 | 中 |
| 3 | **Reasoning 切换** | 🟡 P1 | ❌ 缺失 | Alt+,/Alt+. 快捷键 + reasoning effort 调整 | 低 | 低 |
| 4 | **PTT 语音输入** | 🟡 P1 | ❌ 缺失 | Web Speech API + 按住说话 | 中 | 低 |
| 5 | **PRD diff 视图** | 🟡 P1 | ❌ 缺失 | diff 算法 + 树形展示 + 时间轴 | 中 | 低 |
| 6 | **Operation-level undo 完善** | 🟡 P1 | 🟡 部分 | RollbackManager + /undo 命令 | 中 | 中 |
| 7 | **Stage 历史导出** | 🟢 P2 | ❌ 缺失 | JSON / CSV 格式 + 时间过滤 | 低 | 低 |
| 8 | **多 session stage 对比** | 🟢 P2 | ❌ 缺失 | 时间线可视化 + 差异高亮 | 中 | 低 |
| 9 | **OSC 9 通知** | 🟢 P2 | ❌ 缺失 | 浏览器 Notification API + Toast | 低 | 低 |
| 10 | **Sleep prevention** | 🟢 P2 | ❌ 缺失 | Wake Lock API | 低 | 低 |
| 11 | **Vercel 部署集成** | 🟢 P2 | ❌ 缺失 | 一键部署到 Vercel | 高 | 中 |
| 12 | **Figma 集成** | 🟢 P2 | ❌ 缺失 | Figma 插件 + 设计稿导入 | 高 | 低 |

---

## 三、本轮 (Cycle 65) P1 实施计划

### 3.1 G65-01: 真实 CLI 集成 (P1 🔴)

**目标**: 将 AgentRunner 从 mock 模式升级为真实调用 CLI

**功能需求**:
- 调用真实 `claude` / `hermes` CLI
- 子进程管理（spawn / kill / 状态）
- 双向通信：CLI → Hook 事件流
- 真实工具调用映射：Read/Write/Bash/Edit/Grep/Glob
- 输出流解析：JSONL 格式事件
- 错误处理：超时 / 异常 / 取消

**核心组件**:
- 后端: `RealAgentRunner`（替代 mock）
- 后端: `CLIBridge`（CLI 协议适配）
- 后端: `EventStreamParser`（JSONL → HookEvent）
- 前端: `useRealAgentExecution` Hook（真实模式标识）

**接口设计**:
```python
class AgentRunner(Protocol):
    async def start(self, instance: AgentInstance, role: AgentRole): ...
    async def cancel(self, agent_id: str): ...
    async def pause(self, agent_id: str): ...
    async def resume(self, agent_id: str): ...

class RealAgentRunner:
    """真实 CLI 模式（生产）"""
    def __init__(self, cli_path: str = "claude", sandbox: bool = True): ...

class MockAgentRunner:
    """Mock 模式（开发/测试）"""
    ...
```

**事件映射**:
| CLI 事件 | Hook 事件类型 | 数据 |
|----------|---------------|------|
| session_start | SUBAGENT_START | session_id, role, task |
| tool_use | PRE_TOOL_USE | tool_name, args |
| tool_result | POST_TOOL_USE | tool_name, result, duration |
| content_block_delta | OUTPUT | delta text |
| progress | PROGRESS | percent, message |
| session_end | SUBAGENT_STOP | status, result |
| error | ERROR | error_type, message |

**验收标准**:
- ✅ spawn 后 100ms 内启动 CLI 子进程
- ✅ CLI 输出实时解析为 Hook 事件
- ✅ 工具调用正确映射（Read/Write/Bash/Edit）
- ✅ 取消信号能在 200ms 内传递到子进程
- ✅ 单元测试覆盖 ≥ 85%（含 mock CLI 输出）

### 3.2 G65-02: CSV 批处理 spawn_agents (P1 🟡)

**目标**: 支持从 CSV 批量创建 agent 实例

**功能需求**:
- 输入: CSV 文件（每行一个 task 配置）
- 输出: 批量 spawn 实例 + 进度跟踪
- 列定义: `task` / `role` / `nickname` / `context` / `model`
- 进度: 实时显示 N/M 已完成
- 失败隔离: 1 行失败不影响其他行
- 结果汇总: JSON 下载 / CSV 导出

**核心组件**:
- 后端: `BatchSpawner` 服务
- 后端: `CSVTaskParser`（CSV 解析 + 校验）
- 前端: `BatchSpawnPanel`（CSV 上传 + 进度展示）
- 前端: `BatchResultTable`（结果可视化）

**接口设计**:
```python
POST /api/agent-roles/batch/spawn
  body: { csv_content: str, role: str, default_model?: str }
  resp: { batch_id: str, total: int, accepted: int, rejected: int }

GET /api/agent-roles/batch/{batch_id}
  resp: { batch_id, total, completed, failed, in_progress, instances: [...] }

GET /api/agent-roles/batch/{batch_id}/export?format=json|csv
  resp: file download
```

**验收标准**:
- ✅ 解析 1000 行 CSV < 5s
- ✅ 批量 spawn 失败率 < 5%（隔离）
- ✅ 实时进度推送
- ✅ 结果导出格式正确

### 3.3 G65-03: Reasoning Effort 切换 (P1 🟡)

**目标**: 允许用户在运行中调整 reasoning effort

**功能需求**:
- 快捷键: Alt+, / Alt+. (降低/提高)
- 等级: low / medium / high
- 实时切换：发送 update_request 到 CLI
- 视觉反馈：徽章颜色变化
- 持久化：保存到 session storage

**核心组件**:
- 前端: `ReasoningEffortToggle` 组件
- 前端: `useReasoningEffort` Hook
- 后端: `PUT /api/agent-roles/instances/{id}/reasoning` 端点

**接口设计**:
```python
PUT /api/agent-roles/instances/{id}/reasoning
  body: { effort: "low" | "medium" | "high" }
  resp: { success: bool, instance: AgentInstance }
```

**验收标准**:
- ✅ 快捷键触发切换
- ✅ 后端持久化状态
- ✅ 视觉反馈即时
- ✅ 单元测试覆盖 ≥ 90%

---

## 四、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 真实 CLI 集成失败 | 高 | Mock 模式 fallback + 详细错误日志 |
| CSV 解析安全 | 中 | 输入校验 + 大小限制 + 字段白名单 |
| 快捷键冲突 | 低 | 优先级排序 + 用户可配置 |
| 真实 CLI 性能开销 | 中 | 资源池 + 连接复用 |

---

## 五、实施顺序

1. **G65-01 真实 CLI 集成**（最复杂，最高价值）
2. **G65-02 CSV 批处理**（复用 AgentRunner）
3. **G65-03 Reasoning Effort 切换**（最小改动，最大体验提升）

---

## 六、下一阶段 (Cycle 66) 规划

按以下顺序实施：
1. PRD diff 视图（PRD 迭代体验提升）
2. Operation-level undo 完善（Rollback 增强）
3. Stage 历史导出
4. 多 session stage 对比
5. Figma 集成（设计协作）
