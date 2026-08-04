# G65-01 Spec: 真实 CLI 集成（Mock 升级为真实模式）

> **Cycle**: 65
> **优先级**: 🔴 P1
> **目标**: 将 AgentRunner 从 mock 模式升级为真实调用 claude/hermes CLI
> **来源**: cycle65-gap-analysis.md

---

## 1. 功能需求描述

### 1.1 目标
为 AgentRunner 添加真实 CLI 模式：
- 真实模式调用 `claude` / `hermes` CLI（通过 subprocess）
- 子进程管理：spawn / kill / 状态查询
- 双向通信：CLI → Hook 事件流（JSONL 解析）
- 工具调用映射：Read/Write/Bash/Edit/Grep/Glob
- 取消信号能在 200ms 内传递到子进程
- Mock 模式保留（开发/测试用）

### 1.2 用户场景
- **场景 1（生产模式）**: 部署到生产环境时使用真实 CLI，调用真实的 LLM
- **场景 2（开发模式）**: 单元测试时使用 mock 模式，无需真实 LLM
- **场景 3（混合模式）**: 某些场景需要 mock（如工具调用验证），某些需要真实（如最终输出）
- **场景 4（手动切换）**: 用户可在 spawn 时指定 mode=mock/real/auto

### 1.3 核心特性
- ✅ RunnerMode 枚举：MOCK / REAL / AUTO
- ✅ RealAgentRunner 继承 AgentRunner 接口
- ✅ CLI 子进程管理（subprocess.Popen 异步）
- ✅ JSONL 输出流解析（每行一个事件）
- ✅ 工具调用映射（CLI tool_use → Hook PRE_TOOL_USE）
- ✅ 取消信号：SIGTERM / SIGKILL 渐进式
- ✅ 输出缓冲区：每 100ms flush 到 hook bus
- ✅ 错误恢复：CLI 异常 → Error 事件

---

## 2. 技术实现方案

### 2.1 架构

```
┌────────────────────────────────────────────────┐
│  AgentRunner (抽象)                            │
│  ┌─────────────────┐  ┌──────────────────┐    │
│  │ MockAgentRunner │  │ RealAgentRunner  │    │
│  │ - 内置工具序列  │  │ - subprocess CLI  │    │
│  │ - 立即执行      │  │ - JSONL 解析     │    │
│  └────────┬────────┘  └─────────┬────────┘    │
│           │                      │             │
│  ┌────────▼──────────────────────▼────────┐    │
│  │   RunnerMode 切换 (MOCK/REAL/AUTO)    │    │
│  └────────────────────┬───────────────────┘    │
│                       │                         │
│  ┌────────────────────▼───────────────────┐    │
│  │      Hook Event Bus                    │    │
│  └────────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```

### 2.2 CLI 协议

CLI 输出 JSONL 格式（每行一个事件）：
```json
{"type": "session_start", "session_id": "abc", "role": "worker", "task": "..."}
{"type": "tool_use", "id": "tu-1", "name": "read", "input": {"path": "/tmp/x.py"}}
{"type": "tool_result", "id": "tu-1", "output": "...", "duration_ms": 50}
{"type": "content_delta", "text": "Hello"}
{"type": "progress", "percent": 0.5, "message": "..."}
{"type": "session_end", "status": "success", "result": "..."}
{"type": "error", "error_type": "...", "message": "..."}
```

事件映射到 HookEventType：
| CLI type | HookEventType | 数据 |
|----------|---------------|------|
| session_start | SUBAGENT_START | session_id, role, task |
| tool_use | PRE_TOOL_USE | tool_name, args, tool_call_id |
| tool_result | POST_TOOL_USE | tool_name, result, duration_ms |
| content_delta | OUTPUT | content |
| progress | PROGRESS | percent, message |
| session_end | SUBAGENT_STOP | status, result |
| error | ERROR | error_type, message |

### 2.3 子进程管理

```python
class RealAgentRunner(AgentRunner):
    def __init__(self, cli_path: str = "claude", sandbox: bool = True):
        self._cli_path = cli_path
        self._processes: Dict[str, subprocess.Popen] = {}
        self._sandbox = sandbox

    async def start(self, instance, role):
        cmd = self._build_cli_command(instance, role)
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._processes[instance.agent_id] = process
        # 启动 reader task 解析 JSONL 输出
        asyncio.create_task(self._read_output(instance, process))
        # 发出 SubagentStart 事件
        await self._hook_bus.publish(...)

    async def _read_output(self, instance, process):
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line.decode())
                hook_event = self._map_to_hook_event(instance.agent_id, event)
                await self._hook_bus.publish(...)
            except json.JSONDecodeError:
                logger.warning(f"非 JSONL 行: {line}")
```

### 2.4 取消机制

```python
async def cancel(self, agent_id):
    process = self._processes.get(agent_id)
    if process:
        # 优雅取消：SIGTERM
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            # 强制取消：SIGKILL
            process.kill()
            await process.wait()
        return True
    return False
```

---

## 3. 接口设计

```python
class RunnerMode(str, Enum):
    MOCK = "mock"        # 开发/测试
    REAL = "real"        # 生产
    AUTO = "auto"        # 智能选择（有 CLI 时 REAL，否则 MOCK）

class SpawnAgentRequest(BaseModel):
    task: str
    nickname: Optional[str] = None
    mode: Optional[RunnerMode] = None  # 不指定则使用默认

class AgentRunner(Protocol):
    mode: RunnerMode
    async def start(self, instance, role): ...
    async def cancel(self, agent_id): ...
    async def pause(self, agent_id): ...
    async def resume(self, agent_id): ...
    def is_running(self, agent_id) -> bool: ...

class MockAgentRunner(AgentRunner):
    mode = RunnerMode.MOCK
    # ... 现有实现

class RealAgentRunner(AgentRunner):
    mode = RunnerMode.REAL
    def __init__(self, cli_path="claude", sandbox=True): ...

def get_agent_runner(mode: RunnerMode = RunnerMode.AUTO) -> AgentRunner:
    """根据 mode 返回对应的 runner"""
```

### API 端点

```python
POST /api/agent-roles/instances/{id}/mode
  body: { mode: "mock" | "real" | "auto" }
  resp: { success: bool, mode: str, runner_stats: {} }
```

---

## 4. 数据结构

```python
@dataclass
class CLIEvent:
    type: str
    session_id: str
    timestamp: float
    data: Dict[str, Any]

class RealAgentRunner:
    def __init__(self, cli_path: str = "claude", sandbox: bool = True):
        self._cli_path = cli_path
        self._sandbox = sandbox
        self._processes: Dict[str, asyncio.subprocess.Process] = {}
        self._output_queues: Dict[str, asyncio.Queue] = {}
```

---

## 5. 性能与安全

### 5.1 性能
- CLI 启动延迟：< 200ms
- JSONL 解析：每行 < 5ms
- 输出批量 flush：每 100ms 或每 50 行
- 子进程内存：限制 1GB（防止 OOM）

### 5.2 安全
- CLI 路径白名单：仅 `claude` / `hermes` / 自定义绝对路径
- 工作目录限制：仅在 `/home/qizheng/auto_code_data` 下
- 超时控制：默认 600s，可配置
- 输入校验：禁止 `;`、`|`、`&&` 等 shell 元字符
- Sandbox 模式：通过 docker 或 bwrap 隔离

---

## 6. 验收标准

### 6.1 功能
- [x] RunnerMode 枚举实现
- [x] RealAgentRunner 实现完整接口
- [x] MockAgentRunner 保留作为默认
- [x] AUTO 模式自动选择（有 CLI 用 REAL，否则 MOCK）
- [x] CLI 子进程 spawn / kill
- [x] JSONL 输出解析
- [x] 工具调用映射
- [x] 取消信号 200ms 内传递
- [x] 错误恢复（CLI 异常 → Error 事件）

### 6.2 测试
- [ ] `test_real_agent_runner.py`: 真实模式测试（≥ 20 个）
- [ ] `test_cli_event_parser.py`: JSONL 解析测试（≥ 15 个）
- [ ] `test_runner_factory.py`: Runner 选择逻辑测试（≥ 10 个）
- [ ] Mock CLI 脚本（模拟 JSONL 输出）
- [ ] 覆盖率 ≥ 85%

### 6.3 浏览器 E2E
1. 打开 Solo Shell
2. spawn 一个 worker 任务（mode=auto）
3. 观察状态从 spawning → running
4. 观察工具调用事件流（来自真实 CLI 输出）
5. 取消任务，验证 200ms 内取消
6. 切换 mode=mock，spawn 验证 mock 模式工作
