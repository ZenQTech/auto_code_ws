# Cycle 14 P1-1: Orchestrated Multi-Agent 阶段合约

> **Cycle**: 14  
> **优先级**: P1-1  
> **类型**: 后端核心模块 + 前端 UI  
> **状态**: 🚧 开发中  
> **版本**: v6.29.0  
> **开始时间**: 2026-07-28

---

## 一、需求描述

### 1.1 业务背景

参考 **Codex v0.142 Multi-Agent Orchestration** 和 **TRAE Solo 模式 Multi-Agent Pipeline** 设计，本任务为 Hermes 平台引入**正式的阶段合约（Stage Contract）系统**。当前多 Agent 协作依赖隐式消息传递，缺少：

- 阶段输入/输出的强类型契约
- 阶段间数据流验证
- 阶段失败/重试的标准化协议
- 阶段依赖关系的形式化建模
- 阶段执行的 SLA 监控

### 1.2 核心目标

- ✅ **Stage Contract 数据模型**：每阶段定义 inputs / outputs / invariants / sla / retry_policy
- ✅ **Pipeline DAG 引擎**：阶段依赖图（拓扑排序 + 并行优化）
- ✅ **Contract Validator**：执行前后自动校验输入输出契约
- ✅ **SLA Monitor**：超时/错误率/性能指标实时监控
- ✅ **Retry Orchestrator**：标准重试策略（指数退避 + 熔断 + 降级）
- ✅ **Stage Registry**：可插拔的阶段注册中心（支持动态加载）
- ✅ **Pipeline Templates**：预定义模板（code_review/research/writing/devops）

### 1.3 用户场景

| 场景 | 描述 | 涉及功能 |
| --- | --- | --- |
| 复杂代码审查 | pipeline 串联 5 阶段（lint→security→perf→style→summary） | DAG + Contract |
| 多 Agent 协作 | 主 Agent + 3 个 Sub Agent 协同完成 | Stage Registry |
| 长任务中断恢复 | 30 阶段 pipeline 中第 15 阶段失败 | Retry + Resume |
| SLA 告警 | 任一阶段 p99 > 5s 自动通知 | SLA Monitor |
| 模板复用 | 复用 code_review 模板到新项目 | Pipeline Templates |

---

## 二、技术实现方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│      Orchestrated Multi-Agent Stage Contract (v6.29.0)      │
├─────────────────────────────────────────────────────────────┤
│  Stage Contract  │  Pipeline DAG     │  SLA Monitor        │
│  - inputs        │  - topological    │  - p50/p95/p99      │
│  - outputs       │  - parallel exec  │  - error rate       │
│  - invariants    │  - checkpoint     │  - timeout alert    │
│  - retry policy  │                   │                     │
├─────────────────────────────────────────────────────────────┤
│  Retry Orchestrator  │  Stage Registry  │  Templates        │
│  - exp backoff       │  - register      │  - code_review    │
│  - circuit breaker   │  - discover      │  - research       │
│  - fallback          │  - hot reload    │  - writing        │
│  - idempotency       │                  │  - devops         │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据模型

```python
@dataclass
class StageContract:
    stage_id: str
    name: str
    description: str
    inputs: Dict[str, FieldSpec]  # 强类型字段定义
    outputs: Dict[str, FieldSpec]
    invariants: List[Invariant]  # 不变量断言
    sla: SLASpec  # p99_latency_ms / max_error_rate
    retry_policy: RetryPolicy  # max_attempts / backoff / circuit_breaker
    required_capabilities: List[str]
    timeout_seconds: int

@dataclass
class Pipeline:
    pipeline_id: str
    name: str
    stages: List[StageRef]  # (stage_id, depends_on, parallel_group)
    inputs: Dict[str, Any]
    status: PipelineStatus  # pending/running/completed/failed/paused
    started_at: str
    completed_at: Optional[str]
    stage_executions: Dict[str, StageExecution]

@dataclass
class StageExecution:
    stage_id: str
    status: ExecutionStatus  # pending/running/succeeded/failed/skipped
    attempt: int
    inputs_validated: bool
    outputs_validated: bool
    started_at: str
    completed_at: Optional[str]
    latency_ms: int
    error: Optional[str]
    metrics: ExecutionMetrics
```

### 2.3 关键算法

#### 拓扑排序 + 并行分组
```python
def build_execution_plan(pipeline: Pipeline) -> List[List[str]]:
    """返回可并行执行的阶段批次"""
    graph = {s.stage_id: s.depends_on for s in pipeline.stages}
    visited = set()
    batches = []
    while graph:
        ready = [n for n, deps in graph.items() if all(d in visited for d in deps)]
        if not ready:
            raise CycleError("circular dependency")
        batches.append(ready)
        visited.update(ready)
        for n in ready:
            del graph[n]
    return batches
```

#### 指数退避 + 熔断
```python
def should_retry(attempt: int, policy: RetryPolicy) -> bool:
    if attempt >= policy.max_attempts:
        return False
    if circuit_breaker.is_open():
        return False
    delay = min(policy.base_delay * (2 ** attempt), policy.max_delay)
    if jitter:
        delay *= random.uniform(0.5, 1.5)
    schedule_retry(delay)
    return True
```

### 2.4 REST API 端点（20+）

```
GET    /api/orchestrate/health
GET    /api/orchestrate/stats
POST   /api/orchestrate/pipelines            # 创建并执行
GET    /api/orchestrate/pipelines            # 列表
GET    /api/orchestrate/pipelines/{id}       # 详情
POST   /api/orchestrate/pipelines/{id}/cancel
POST   /api/orchestrate/pipelines/{id}/pause
POST   /api/orchestrate/pipelines/{id}/resume
GET    /api/orchestrate/pipelines/{id}/executions
GET    /api/orchestrate/stages               # 阶段列表
GET    /api/orchestrate/stages/{id}          # 阶段详情
POST   /api/orchestrate/stages               # 注册新阶段
DELETE /api/orchestrate/stages/{id}          # 注销阶段
GET    /api/orchestrate/templates            # 模板列表
POST   /api/orchestrate/templates/{name}/instantiate
GET    /api/orchestrate/sla/metrics          # SLA 指标
GET    /api/orchestrate/sla/alerts           # 告警列表
POST   /api/orchestrate/sla/alerts/{id}/ack
GET    /api/orchestrate/retries/queue        # 重试队列
POST   /api/orchestrate/retries/{id}/flush   # 立即重试
```

---

## 三、接口设计

### 3.1 创建 Pipeline

**Request**
```json
POST /api/orchestrate/pipelines
{
  "name": "Code Review Pipeline",
  "template": "code_review",
  "inputs": {
    "repo": "myorg/myrepo",
    "pr_number": 123
  }
}
```

**Response**
```json
{
  "pipeline_id": "pipe_abc123",
  "status": "running",
  "execution_plan": [
    ["lint"],
    ["security", "perf"],
    ["style"],
    ["summary"]
  ],
  "created_at": "2026-07-28T12:00:00Z"
}
```

### 3.2 Pipeline 详情

**Response**
```json
{
  "pipeline_id": "pipe_abc123",
  "name": "Code Review Pipeline",
  "status": "running",
  "stages": [
    {
      "stage_id": "lint",
      "status": "succeeded",
      "attempt": 1,
      "latency_ms": 1250,
      "outputs_validated": true
    },
    {
      "stage_id": "security",
      "status": "running",
      "attempt": 1,
      "started_at": "2026-07-28T12:00:02Z"
    }
  ],
  "sla": {
    "p50_latency_ms": 1100,
    "p95_latency_ms": 2100,
    "error_rate": 0.0
  }
}
```

### 3.3 错误码

| Code | 含义 |
| --- | --- |
| 400 | 阶段参数错误 |
| 404 | Pipeline/Stage 不存在 |
| 409 | Pipeline 状态冲突（已取消/已暂停） |
| 422 | Contract 校验失败（输入/输出不满足） |
| 503 | 熔断器开启 |

---

## 四、性能与安全要求

### 4.1 性能指标

- 阶段调度延迟 < 50ms
- 并行执行 10 阶段不阻塞主线程
- SLA 指标查询 < 100ms
- 状态持久化支持 10000+ Pipeline 历史

### 4.2 安全要求

- **输入验证**：所有 inputs 必须通过 FieldSpec 类型校验
- **不变量保护**：每阶段前后执行 Invariant 断言
- **幂等性**：重试使用 idempotency_key 避免重复执行
- **熔断器**：连续失败 N 次自动开启，避免雪崩
- **超时控制**：每阶段强制 timeout_seconds

---

## 五、验收标准

### 5.1 功能验收

- ✅ 支持 ≥ 6 预定义 Pipeline 模板
- ✅ 支持 20+ REST 端点
- ✅ 阶段 DAG 自动拓扑排序
- ✅ 并行阶段在同一批次执行
- ✅ 重试策略按指数退避生效
- ✅ 熔断器在阈值触发时开启
- ✅ 阶段前后契约校验失败时立即失败
- ✅ Pipeline 中断后可从 checkpoint 恢复
- ✅ SLA 指标实时计算 p50/p95/p99
- ✅ 告警超阈值时记录到 alerts 列表

### 5.2 测试要求

- 单元测试 ≥ 80 个用例，覆盖率 ≥ 90%
- E2E 测试 ≥ 40 个断言
- 集成测试：完整 pipeline 端到端执行
- 性能测试：100 阶段 pipeline < 5s 调度
- 错误恢复测试：阶段失败 + 重试 + 熔断
- 全部测试通过率 100%

### 5.3 文档要求

- Spec.md（本文档）
- CYCLE14_P1_1_SUMMARY.md
- 代码修改日志 v6.29.0

---

## 六、文件清单

### 6.1 后端文件

- `backend/app/core/orchestrate/__init__.py`
- `backend/app/core/orchestrate/models.py`
- `backend/app/core/orchestrate/contracts.py` (Stage Contract 定义)
- `backend/app/core/orchestrate/dag.py` (Pipeline DAG 引擎)
- `backend/app/core/orchestrate/executor.py` (并行执行器)
- `backend/app/core/orchestrate/validator.py` (Contract 验证器)
- `backend/app/core/orchestrate/sla.py` (SLA 监控)
- `backend/app/core/orchestrate/retry.py` (重试编排)
- `backend/app/core/orchestrate/registry.py` (阶段注册中心)
- `backend/app/core/orchestrate/templates.py` (Pipeline 模板)
- `backend/app/core/orchestrate/api.py` (REST API)
- `backend/app/main.py` (路由注册)

### 6.2 前端文件

- `frontend/src/hooks/useOrchestrateApi.ts`
- `frontend/src/components/OrchestratePanel.tsx`
- `frontend/src/pages/OrchestratePage.tsx`
- `frontend/src/router/router.tsx` (路由)
- `frontend/src/components/BrandHeader.tsx` (菜单)

### 6.3 测试文件

- `tests/test_orchestrate_units.py`
- `tests/test_e2e_orchestrate.sh`

### 6.4 文档文件

- `.trae/specs/cycle14/orchestrated/spec.md` (本文档)
- `CYCLE14_P1_1_SUMMARY.md`
- `代码修改日志.md` (v6.29.0)

---

> **下一步**: 按 P1-1 任务清单实现
