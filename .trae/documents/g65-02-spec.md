# G65-02 Spec: CSV 批处理 spawn_agents

> **Cycle**: 65
> **优先级**: 🟡 P1
> **目标**: 支持从 CSV 批量创建 Agent 实例
> **来源**: cycle65-gap-analysis.md

---

## 1. 功能需求描述

### 1.1 目标
为 Agent Role 系统添加 CSV 批处理能力：
- 上传 CSV 文件，每行一个任务配置
- 批量 spawn Agent 实例（最多 100 个/批）
- 实时进度跟踪（N/M 已完成）
- 失败隔离（单行失败不影响其他）
- 结果汇总导出（JSON / CSV）

### 1.2 用户场景
- **场景 1（数据分析）**: 上传 100 行任务，批量处理数据集
- **场景 2（CI/CD 集成）**: 从 CI 流水线下发任务，CSV 作为任务清单
- **场景 3（科研实验）**: 批量跑多组实验参数（CSV 列作为参数）
- **场景 4（结果回传）**: 下载批处理结果 CSV，集成到下游流程

### 1.3 核心特性
- ✅ CSV 解析（标准 RFC 4180）
- ✅ 字段校验（必填/可选/正则）
- ✅ 批量 spawn（异步并发，默认并发度 5）
- ✅ 进度跟踪（WebSocket + 轮询）
- ✅ 失败隔离（try/except per row）
- ✅ 结果导出（JSON / CSV / Markdown）

---

## 2. 技术实现方案

### 2.1 架构

```
┌────────────────────────────────────────────────┐
│  前端 BatchSpawnPanel                          │
│  - CSV 上传 / 拖拽                              │
│  - 角色选择                                     │
│  - 并发度配置                                   │
│  - 实时进度条                                   │
└────────────────────┬───────────────────────────┘
                     │ POST /api/agent-roles/batch/spawn
                     ↓
┌────────────────────────────────────────────────┐
│  FastAPI 路由 (agent_roles API)                │
│  - spawn_batch()    提交批量任务                │
│  - get_batch()      查询批量状态                │
│  - export_batch()   导出结果                    │
└────────────────────┬───────────────────────────┘
                     │
                     ↓
┌────────────────────────────────────────────────┐
│  BatchSpawner 服务                              │
│  - 解析 CSV                                     │
│  - 创建 BatchJob                                │
│  - 调度 spawn（asyncio.Semaphore）             │
│  - 跟踪进度                                     │
│  - 汇总结果                                     │
└────────────────────┬───────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ↓                         ↓
┌──────────────┐         ┌──────────────────┐
│ CSVTaskParser│         │ AgentRoleManager │
│ - 解析       │         │ - spawn_instance │
│ - 校验       │         │ - 状态机         │
│ - 错误报告   │         │                  │
└──────────────┘         └──────────────────┘
```

### 2.2 CSV 格式

```csv
task,nickname,role,model,context
"分析销售数据","Atlas","worker","gpt-5.5","{"data_file":"sales.csv"}"
"生成报告","Builder","default","",""
"代码审查","Reviewer","reviewer","",""
```

列定义：
| 列名 | 必填 | 类型 | 说明 |
|------|------|------|------|
| task | ✅ | string | 任务描述（1-4096 字符） |
| nickname | ❌ | string | 实例昵称（1-64 字符） |
| role | ❌ | string | 角色名（默认 default） |
| model | ❌ | string | 模型覆盖（可选） |
| context | ❌ | json | 上下文 JSON（可选） |

### 2.3 并发调度

```python
class BatchSpawner:
    async def spawn_batch(self, tasks, role=None, max_concurrency=5):
        # 创建 BatchJob
        # asyncio.Semaphore 控制并发
        # 逐行 spawn + track
        # 失败捕获不影响其他
        # 返回 batch_id
```

### 2.4 进度跟踪

```python
class BatchJob:
    batch_id: str
    total: int
    accepted: int
    rejected: int
    in_progress: int
    completed: int
    failed: int
    started_at: float
    finished_at: Optional[float]
    status: str  # running/completed/cancelled
    instances: List[BatchInstance]
    errors: List[BatchError]
```

---

## 3. 接口设计

```python
# 请求
POST /api/agent-roles/batch/spawn
  body: {
    csv_content: str,        # CSV 文本内容
    role: Optional[str],     # 全局默认角色
    max_concurrency: int = 5,# 最大并发度
    default_model: Optional[str] = None,
  }
  resp: {
    batch_id: str,
    total: int,              # 总行数
    accepted: int,           # 接受行数
    rejected: int,           # 拒绝行数（解析/校验失败）
    errors: [{row, field, message}],
  }

# 查询
GET /api/agent-roles/batch/{batch_id}
  resp: {
    batch_id,
    total, accepted, rejected,
    in_progress, completed, failed,
    progress: float,         # 0.0 - 1.0
    status, started_at, finished_at,
    instances: [{
      agent_id, row_index, task, nickname, role,
      status, error,
    }],
  }

# 取消
POST /api/agent-roles/batch/{batch_id}/cancel
  resp: {success: bool, cancelled_count: int}

# 导出
GET /api/agent-roles/batch/{batch_id}/export?format=json|csv|md
  resp: file download

# 列表
GET /api/agent-roles/batch/list
  resp: {batches: [{batch_id, total, status, started_at}]}
```

### WebSocket

```
WS /api/agent-roles/batch/ws/{batch_id}
  events: {
    type: "batch_progress",
    batch_id,
    total, completed, failed, in_progress,
    progress: float,
  }
  events: {
    type: "instance_status",
    batch_id, agent_id, status, error,
  }
  events: {
    type: "batch_complete",
    batch_id, total, completed, failed,
  }
```

---

## 4. 数据结构

```python
@dataclass
class BatchError:
    row_index: int           # CSV 行号（从 1 开始，跳过表头）
    field: str               # 错误字段名
    message: str             # 错误信息
    raw: str                 # 原始行内容

@dataclass
class BatchInstance:
    agent_id: str
    row_index: int
    task: str
    nickname: Optional[str]
    role: str
    model: Optional[str]
    context: Dict[str, Any]
    status: str              # spawning/running/idle/failed/cancelled
    error: Optional[str]
    started_at: float
    finished_at: Optional[float]

@dataclass
class BatchJob:
    batch_id: str            # batch-{uuid}
    total: int               # 总行数
    accepted: int
    rejected: int
    in_progress: int
    completed: int
    failed: int
    progress: float          # (completed + failed) / total
    status: str              # pending/running/completed/cancelled
    max_concurrency: int
    default_role: Optional[str]
    default_model: Optional[str]
    started_at: float
    finished_at: Optional[float]
    instances: Dict[str, BatchInstance]  # agent_id -> BatchInstance
    errors: List[BatchError]
```

---

## 5. 性能与安全

### 5.1 性能
- CSV 解析 1000 行 < 5s
- 批量 spawn 100 行 < 10s（mock 模式）
- 并发度默认 5，可配置 1-50
- 进度查询 < 50ms
- 导出 JSON < 200ms
- 导出 CSV < 500ms

### 5.2 安全
- CSV 大小限制：1MB（约 10000 行）
- 字段长度校验：task ≤ 4096, nickname ≤ 64
- 任务白名单：role 必须在 AgentRoleManager 中存在
- JSON 注入防护：context 必须可被 json.loads 解析
- 并发隔离：每角色并发度限制（10）
- 错误隔离：单行失败不影响其他行

---

## 6. 验收标准

### 6.1 后端
- [x] BatchSpawner 服务实现
- [x] CSVTaskParser 解析 RFC 4180 标准
- [x] BatchJob 状态机（pending/running/completed/cancelled）
- [x] REST API 6 个端点
- [x] WebSocket 进度推送
- [x] 并发控制（asyncio.Semaphore）
- [x] 失败隔离
- [x] 结果导出（JSON/CSV/MD）

### 6.2 测试
- [ ] `test_batch_spawner.py`：核心服务（≥ 20 个）
- [ ] `test_csv_parser.py`：CSV 解析（≥ 15 个）
- [ ] `test_batch_api.py`：REST API（≥ 15 个）
- [ ] 边界条件：空 CSV、错误格式、超大文件
- [ ] 并发场景：100 行 × 5 并发
- [ ] 覆盖率 ≥ 90%

### 6.3 前端
- [ ] `BatchSpawnPanel.tsx`：CSV 上传 + 实时进度
- [ ] `BatchResultTable.tsx`：结果表格 + 状态筛选
- [ ] 集成到 VibeSoloShell 的工具面板
- [ ] 拖拽上传支持
- [ ] 进度条 + 实时日志

### 6.4 浏览器 E2E
1. 打开 Solo Shell
2. 切到 BatchSpawn 工具 tab
3. 上传测试 CSV
4. 观察进度从 0% → 100%
5. 验证结果表格显示所有实例
6. 导出 CSV 验证格式
7. 取消一个进行中的批次
