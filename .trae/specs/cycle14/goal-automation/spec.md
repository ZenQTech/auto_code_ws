# Cycle 14 P1-4: Goal 自动轮转 + 多 Agent 委派策略

> **Cycle**: 14
> **优先级**: P1-4
> **类型**: 后端核心模块
> **状态**: 🚧 开发中
> **版本**: v6.32.0
> **开始时间**: 2026-07-28

---

## 一、需求描述

### 1.1 业务背景

参考 **Codex v0.135+** 与 **TRAE v0.1.36+** 的"自动 Goal 推进"和"多 Agent 委派"能力，本任务为 Hermes `/goal` 长时域模式补全两大关键能力：

1. **Goal 自动轮转 (Auto-Turn)**: 当 Goal 处于 `active` 状态时，无需用户手动触发，系统按策略自动推进 AC（验收标准）的执行、验证与状态变更
2. **多 Agent 委派策略 (Multi-Agent Delegation)**: 基于 AC 类型、风险等级、依赖关系，自动选择并委派给合适的 Agent 角色（架构师 / 实施者 / 验证者 / 审查者）

当前 `/goal` 系统（Cycle 12 P0-2）仅支持手动推进，缺少自动化能力。

### 1.2 核心目标

#### Goal 自动轮转 (Auto-Turn)
- ✅ 轮转触发器：时间触发 / AC 完成触发 / Token 预算触发 / 外部信号触发
- ✅ 轮转调度器：单 Goal 串行 + 多 Goal 并行
- ✅ 轮转策略：保守 / 标准 / 激进 三种模式
- ✅ 自动状态机：draft → active → 推进 → completed/failed
- ✅ 自动 AC 选择：按 priority 排序 + 依赖检查
- ✅ 自动验证执行：调用 Verifier 执行 VerifyItem
- ✅ 自动进度记录：写入 ProgressLog
- ✅ 暂停/恢复机制

#### 多 Agent 委派策略
- ✅ Agent 角色注册表（architect / implementer / verifier / reviewer / tester / documenter）
- ✅ AC 类型 → Agent 角色映射
- ✅ 风险等级 → Agent 权限映射
- ✅ 委派负载均衡
- ✅ 委派审计日志
- ✅ Agent 健康检查 + 故障转移
- ✅ 并行委派支持

### 1.3 用户场景

| 场景 | 描述 | 输入 | 输出 |
| --- | --- | --- | --- |
| 自动轮转启动 | 用户启动 Goal 后无需干预 | goal_id + 策略 | 自动推进日志 |
| 手动触发单次轮转 | 用户在 UI 点击"下一步" | goal_id | 1 个 AC 完成 |
| 自动委派实施者 | 系统自动选择 Agent 委派 | ac_id | agent_id + 任务 |
| 查看委派历史 | 用户审计 Agent 选择 | goal_id | 委派日志列表 |
| 暂停自动轮转 | 用户介入手动控制 | goal_id | 轮转器状态变更 |

---

## 二、技术实现方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│              Goal Automation Layer (Cycle 14 P1-4)                │
├─────────────────────────────────────────────────────────────────┤
│   Auto-Turn Engine          │   Multi-Agent Delegation           │
│   - Triggers (4)            │   - Agent Registry                 │
│   - Scheduler               │   - Role Mapper                    │
│   - Strategy (3)            │   - Load Balancer                  │
│   - Loop Runner             │   - Health Monitor                 │
│   - Pause/Resume            │   - Audit Logger                   │
├─────────────────────────────────────────────────────────────────┤
│              Integration Layer                                   │
│   GoalManager  │  Verifier  │  ProgressLog  │  Agent v2         │
├─────────────────────────────────────────────────────────────────┤
│              Storage (JSONL + In-Memory RLock)                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 `auto_turn.py` - 自动轮转引擎

```python
class TurnTrigger(str, Enum):
    TIME_BASED = "time_based"         # 定时轮转
    AC_COMPLETED = "ac_completed"     # AC 完成触发
    TOKEN_BUDGET = "token_budget"     # 预算触发
    MANUAL = "manual"                 # 手动
    EXTERNAL = "external"             # 外部信号

class TurnStrategy(str, Enum):
    CONSERVATIVE = "conservative"     # 保守：每个 AC 验证后再下一步
    STANDARD = "standard"             # 标准：批量推进
    AGGRESSIVE = "aggressive"         # 激进：最大化并行

class TurnState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class TurnConfig:
    goal_id: str
    strategy: TurnStrategy = TurnStrategy.STANDARD
    interval_seconds: int = 30        # 轮转间隔
    max_turns: int = 1000             # 最大轮转次数
    auto_verify: bool = True          # 自动验证
    auto_progress: bool = True        # 自动记录进度
    triggers: List[TurnTrigger] = field(default_factory=list)

@dataclass
class TurnRecord:
    turn_id: str
    goal_id: str
    turn_number: int
    strategy: str
    state: str
    ac_processed: List[str]
    agents_used: List[str]
    started_at: str
    finished_at: Optional[str]
    duration_ms: int
    error: Optional[str]

class AutoTurnEngine:
    def __init__(self, manager: GoalManager, verifier: Verifier)
    def register_goal(config: TurnConfig)
    def unregister_goal(goal_id: str)
    def trigger_turn(goal_id: str, trigger: TurnTrigger) -> TurnRecord
    def pause_goal(goal_id: str) -> bool
    def resume_goal(goal_id: str) -> bool
    def get_turn_history(goal_id: str, limit: int) -> List[TurnRecord]
    def get_active_goals() -> List[str]
```

#### 2.2.2 `delegation.py` - 多 Agent 委派

```python
class AgentRole(str, Enum):
    ARCHITECT = "architect"           # 架构师
    IMPLEMENTER = "implementer"       # 实施者
    VERIFIER = "verifier"             # 验证者
    REVIEWER = "reviewer"             # 审查者
    TESTER = "tester"                 # 测试者
    DOCUMENTER = "documenter"         # 文档者
    ORCHESTRATOR = "orchestrator"     # 编排者

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

@dataclass
class AgentSpec:
    agent_id: str
    role: AgentRole
    name: str
    capabilities: List[str]
    risk_levels: List[RiskLevel]
    current_load: int = 0
    total_tasks: int = 0
    success_count: int = 0
    failure_count: int = 0
    status: str = "available"          # available / busy / offline
    last_heartbeat: Optional[str] = None

@dataclass
class DelegationRequest:
    delegation_id: str
    goal_id: str
    ac_id: str
    ac_title: str
    ac_type: str                      # implementation / verification / review / testing
    risk_level: RiskLevel
    required_capabilities: List[str]
    priority: int
    context: Dict[str, Any]
    created_at: str

@dataclass
class DelegationResult:
    delegation_id: str
    agent_id: str
    agent_role: AgentRole
    decision: str                     # delegated / failed / queued
    reason: str
    created_at: str
    completed_at: Optional[str]
    output: Dict[str, Any]

class MultiAgentDelegator:
    def __init__(self)
    def register_agent(spec: AgentSpec)
    def unregister_agent(agent_id: str)
    def list_agents(role: Optional[AgentRole]) -> List[AgentSpec]
    def delegate(request: DelegationRequest) -> DelegationResult
    def get_delegation_history(goal_id: str) -> List[DelegationResult]
    def get_load_distribution() -> Dict[str, int]
    def health_check() -> Dict[str, str]
```

### 2.3 委派策略算法

#### AC 类型 → Agent 角色映射
| AC 类型 | 首选角色 | 备选角色 |
| --- | --- | --- |
| implementation | IMPLEMENTER | ARCHITECT |
| verification | VERIFIER | TESTER |
| review | REVIEWER | ARCHITECT |
| testing | TESTER | VERIFIER |
| documentation | DOCUMENTER | REVIEWER |
| architecture | ARCHITECT | IMPLEMENTER |
| integration | IMPLEMENTER | TESTER |

#### 风险等级 → Agent 限制
| 风险等级 | 允许角色 | 二次审查 |
| --- | --- | --- |
| LOW | 所有 | 否 |
| MEDIUM | 实施/验证/测试 | 否 |
| HIGH | 资深角色 | 是 |
| CRITICAL | 仅架构师 | 强制二次审查 |

#### 委派算法
1. 根据 AC 类型确定首选 Agent 角色
2. 过滤出可用 Agent（status=available, load < 阈值）
3. 风险等级检查：CRITICAL 必须架构师；HIGH 需资深
4. 能力匹配：required_capabilities ⊆ agent.capabilities
5. 负载均衡：选择 current_load 最小的 Agent
6. 失败转移：首选失败时尝试备选角色

### 2.4 安全设计

- **Agent 注册白名单**：仅允许注册预定义角色
- **委派审计日志**：所有委派结果记录到 JSONL
- **风险等级校验**：CRITICAL AC 必须人工二次确认
- **故障转移**：Agent offline 时自动选择备选
- **资源隔离**：每个 Goal 的轮转器独立线程池

---

## 三、接口设计规范

### 3.1 启动自动轮转

**请求**：
```json
POST /api/goal-automation/goals/{goal_id}/auto-turn/start
{
  "strategy": "standard",
  "interval_seconds": 30,
  "max_turns": 1000,
  "auto_verify": true,
  "auto_progress": true
}
```

**响应**：
```json
{
  "success": true,
  "goal_id": "goal_abc",
  "config": {...},
  "status": "running"
}
```

### 3.2 触发单次轮转

**请求**：
```json
POST /api/goal-automation/goals/{goal_id}/auto-turn/trigger
{
  "trigger": "manual"
}
```

**响应**：
```json
{
  "success": true,
  "turn_record": {
    "turn_id": "turn_001",
    "turn_number": 5,
    "ac_processed": ["ac_1", "ac_2"],
    "agents_used": ["agent_arch_1", "agent_impl_2"],
    "duration_ms": 1234
  }
}
```

### 3.3 委派任务

**请求**：
```json
POST /api/goal-automation/delegations
{
  "goal_id": "goal_abc",
  "ac_id": "ac_1",
  "ac_title": "Implement login flow",
  "ac_type": "implementation",
  "risk_level": "medium",
  "required_capabilities": ["python", "fastapi"],
  "priority": 3
}
```

**响应**：
```json
{
  "success": true,
  "delegation": {
    "delegation_id": "del_001",
    "agent_id": "agent_impl_2",
    "agent_role": "implementer",
    "decision": "delegated",
    "reason": "Role match + load balanced"
  }
}
```

### 3.4 注册 Agent

**请求**：
```json
POST /api/goal-automation/agents
{
  "agent_id": "agent_impl_2",
  "role": "implementer",
  "name": "FastAPI Implementer",
  "capabilities": ["python", "fastapi", "sqlalchemy"],
  "risk_levels": ["low", "medium"]
}
```

---

## 四、性能与安全要求

### 4.1 性能要求
- 轮转触发延迟 < 100ms
- 委派决策 < 50ms
- Agent 负载均衡 < 10ms
- 并发支持 100+ Goals

### 4.2 安全要求
- Agent 注册需白名单校验
- CRITICAL AC 强制人工确认
- 委派审计日志不可篡改
- 资源隔离防止单 Goal 拖垮全局

### 4.3 可靠性要求
- Agent offline 时自动转移
- 轮转器异常不影响其他 Goal
- 持久化所有状态
- 崩溃后可恢复

---

## 五、验收标准

### 5.1 功能验收

**Auto-Turn Engine**:
- ✅ 4 种触发器（time/ac/token/manual）
- ✅ 3 种策略（conservative/standard/aggressive）
- ✅ 暂停/恢复
- ✅ 轮转历史
- ✅ 并发支持
- ✅ 自动验证 + 自动进度

**Multi-Agent Delegation**:
- ✅ 6 种 Agent 角色
- ✅ 7 种 AC 类型映射
- ✅ 4 种风险等级
- ✅ 负载均衡
- ✅ 故障转移
- ✅ 审计日志

### 5.2 测试覆盖
- 单元测试 ≥ 80 个用例
- E2E 测试 ≥ 50 个断言
- 测试通过率 100%

---

## 六、任务清单

### 后端实现
1. ✅ 创建 spec 文档
2. ⏳ `auto_turn.py` - 自动轮转引擎 (~500 行)
3. ⏳ `delegation.py` - 多 Agent 委派 (~450 行)
4. ⏳ `manager.py` - GoalAutomationManager 统一入口 (~300 行)
5. ⏳ `api.py` - REST API (~400 行)
6. ⏳ 注册路由到 main.py

### 测试
7. ⏳ 单元测试 `test_goal_automation_units.py`（≥ 80 用例）
8. ⏳ E2E 测试 `test_e2e_goal_automation.sh`（≥ 50 断言）
9. ⏳ 运行测试，确保 100% 通过

### 文档
10. ⏳ 更新代码修改日志
11. ⏳ 编写 CYCLE14_P1_4_SUMMARY.md

---

**文档版本**: v1.0.0
**最后更新**: 2026-07-28
**负责人**: 全栈开发
