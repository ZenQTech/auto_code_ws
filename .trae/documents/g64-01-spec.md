# G64-01 Spec: Agent 角色真实执行跟踪 + Hook 事件机制

> **Cycle**: 64
> **优先级**: 🔴 P1
> **目标**: 对标 Codex v0.133 SubagentStart/PreToolUse/PostToolUse Hook 机制，将 AgentRoleManager 从 mock sync 升级为真实异步任务执行 + 完整生命周期事件
> **来源**: cycle64-research-report.md + cycle63 gap analysis

---

## 1. 功能需求描述

### 1.1 目标
为 AgentRoleManager 添加真实异步执行能力，支持：
- 任务提交后立即返回 agent_id（不阻塞）
- 任务在 asyncio 任务中真实执行
- 通过 Hook 事件流（start/progress/output/tool_call/complete/failed）跟踪执行进度
- 客户端可通过 WebSocket / SSE 订阅事件
- 取消、暂停、恢复任务

### 1.2 用户场景
- **场景 1（异步执行）**: 用户 spawn 一个 worker 角色执行编码任务，立即看到 agent_id，前端进入轮询或 WebSocket 订阅模式
- **场景 2（工具调用可视化）**: Agent 执行中调用工具（Read/Write/Bash），前端实时显示工具调用
- **场景 3（取消任务）**: 长任务运行中用户点击取消，后端立即停止
- **场景 4（多任务并行）**: 同时 spawn 多个 worker，每个独立跟踪，互不干扰

### 1.3 核心特性
- ✅ 异步任务执行（asyncio）
- ✅ Hook 事件流（start/progress/output/tool_call/complete/failed）
- ✅ 任务状态机：spawning → running → tool_calling → output_streaming → idle/failed/cancelled
- ✅ WebSocket 实时推送
- ✅ 取消/暂停/恢复
- ✅ 执行历史回放
- ✅ 工具调用追踪（Read/Write/Bash/Edit）

---

## 2. 技术实现方案

### 2.1 架构

```
┌────────────────────────────────────────────────┐
│  AgentRoleManager                              │
│  ┌─────────────────┐  ┌──────────────────┐    │
│  │ Instance       │  │ Task Runner      │    │
│  │ Registry       │  │ (asyncio.Task)  │    │
│  └────────┬────────┘  └─────────┬────────┘    │
│           │                      │             │
│  ┌────────▼──────────────────────▼────────┐    │
│  │      Hook Event Bus                    │    │
│  │  - PreToolUse  - PostToolUse           │    │
│  │  - SubagentStart                       │    │
│  │  - SubagentStop                        │    │
│  │  - Progress  - Output  - Error         │    │
│  └────────────────────┬───────────────────┘    │
│                       │                         │
│  ┌────────────────────▼───────────────────┐    │
│  │   WebSocket / SSE Broadcaster          │    │
│  └────────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```

### 2.2 任务状态机

```
spawning → running → tool_calling → output_streaming → idle
                  ↓                ↓                    ↓
                  failed         cancelled            failed
```

### 2.3 Hook 事件类型

| 事件 | 触发时机 | 数据 |
|------|----------|------|
| `SubagentStart` | 任务启动 | agent_id, role, task, started_at |
| `PreToolUse` | 工具调用前 | agent_id, tool_name, args |
| `PostToolUse` | 工具调用后 | agent_id, tool_name, result, duration_ms |
| `Progress` | 进度更新 | agent_id, percent, message |
| `Output` | 输出 token | agent_id, content (delta) |
| `SubagentStop` | 任务完成 | agent_id, status, result, duration_ms |
| `Error` | 错误 | agent_id, error_type, message |

### 2.4 执行模式

**Mock 模式**（默认）:
- 不调用真实 CLI，使用 mock LLM 模拟输出
- 模拟工具调用序列
- 适用于开发/测试

**真实模式**（可选）:
- 调用真实 CLI（claude / hermes）
- 真实工具调用
- 适用于生产

---

## 3. 接口设计

```python
POST /api/agent-roles/{role_name}/spawn     # 异步 spawn
GET  /api/agent-roles/instances             # 列出实例
GET  /api/agent-roles/instances/{agent_id}  # 实例详情
POST /api/agent-roles/instances/{agent_id}/cancel   # 取消
POST /api/agent-roles/instances/{agent_id}/pause    # 暂停
POST /api/agent-roles/instances/{agent_id}/resume   # 恢复
GET  /api/agent-roles/instances/{agent_id}/events  # 事件历史
WS   /api/agent-roles/ws/{agent_id}         # 实时事件订阅
```

### Hook 事件 Schema

```python
class HookEvent(BaseModel):
    event_id: str
    agent_id: str
    event_type: str  # SubagentStart / PreToolUse / PostToolUse / Progress / Output / SubagentStop / Error
    timestamp: float
    data: Dict[str, Any]
    parent_event_id: Optional[str] = None
```

---

## 4. 数据结构

```python
class AgentInstance:
    agent_id: str
    role_name: str
    nickname: str
    status: str  # spawning/running/tool_calling/output_streaming/idle/failed/cancelled/dead
    task: str
    started_at: float
    finished_at: Optional[float]
    result: Optional[str]
    error: Optional[str]
    progress: float  # 0.0 - 1.0
    current_tool: Optional[str]
    tool_calls_count: int
    tokens_used: int

class AgentInstanceDetail(AgentInstance):
    events: List[HookEvent]  # 事件历史
    tool_calls: List[ToolCall]  # 工具调用记录
    output_chunks: List[OutputChunk]  # 输出分片
```

---

## 5. 性能与安全

### 5.1 性能
- 异步执行，无阻塞
- Hook 事件持久化（最近 1000 条）
- WebSocket 推送延迟 < 100ms

### 5.2 安全
- agent_id 校验
- 取消幂等（多次取消安全）
- 真实模式下沙箱隔离（sandbox_mode）
- Tool 调用白名单

---

## 6. 验收标准

### 6.1 功能
- [x] spawn 立即返回 agent_id（< 100ms）
- [x] 任务在后台异步执行
- [x] Hook 事件正确触发
- [x] WebSocket 实时推送
- [x] 取消生效
- [x] 状态机正确转移

### 6.2 测试
- [ ] `test_agent_runner.py`: asyncio 任务执行测试（≥ 20 个）
- [ ] `test_hook_bus.py`: Hook 事件总线测试（≥ 15 个）
- [ ] `test_agent_execution_api.py`: 真实 API 测试（≥ 15 个）
- [ ] 覆盖 spawn → running → tool_calling → idle 全流程
- [ ] 测试覆盖率 ≥ 90%

### 6.3 浏览器 E2E
1. 打开 Solo Shell
2. 切换到角色管理 tab
3. spawn 一个 worker 任务
4. 观察状态从 spawning → running
5. 观察工具调用事件流
6. 任务完成，状态变 idle
7. 查看事件历史回放
8. spawn 新任务，立即取消，验证 cancelled 状态
