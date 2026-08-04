# G62-01 Spec: 多任务并行 (Multi-Task Parallelism)

> **Task ID**: G62-01
> **优先级**: 🔴 P0
> **创建日期**: 2026-08-04
> **依赖**: G61-02 (Goal mode) + G61-04 (Plan Executor)
> **目标对标**: Codex CLI 8 个并行子智能体 / Trae SOLO 多任务并行

---

## 1. 功能需求

### 1.1 用户场景

**场景 A: 全栈开发并行**
- 用户同时启动 "前端开发" 和 "后端 API" 两个任务
- 两个任务独立运行，互不干扰
- 用户可在两个任务间切换查看进度
- 任一任务失败不影响其他任务

**场景 B: 多项目并行**
- 用户同时维护 3 个项目
- 每个项目运行独立的 SOLO 任务
- 资源使用受配额限制

**场景 C: 任务对比**
- 同一需求用不同 prompt 启动 2 个任务对比效果
- 保留两个任务的完整历史

### 1.2 功能目标

- ✅ 支持 ≥4 个并行任务
- ✅ 任务状态隔离（独立 session / context / state）
- ✅ 资源配额管理（CPU / MEM / TIME）
- ✅ 任务标签页 UI（TaskTabs）
- ✅ 任务间切换无延迟
- ✅ 任务历史持久化

### 1.3 使用流程

```
1. 用户在 VibeSoloShell 点击 "新建任务" 按钮
2. 弹出任务创建对话框，填写 prompt + 选择上下文
3. 任务创建后自动在 TaskTabs 中添加新标签
4. 多个任务并行运行
5. 用户点击 TaskTabs 切换查看不同任务
6. 任务完成后显示完成徽章
7. 用户可手动暂停 / 恢复 / 取消任务
```

---

## 2. 技术实现方案

### 2.1 架构设计

```
┌─────────────────────────────────────────┐
│         VibeSoloShell (UI)              │
│  ┌────────────────────────────────┐     │
│  │         TaskTabs (组件)        │     │
│  └────────────────────────────────┘     │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │Task 1│ │Task 2│ │Task 3│ │Task 4│   │
│  └──────┘ └──────┘ └──────┘ └──────┘  │
└────────────────┬────────────────────────┘
                 │ WebSocket 多路复用
                 ▼
┌─────────────────────────────────────────┐
│   MultiTaskManager (后端核心)           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │TaskSlot1│ │TaskSlot2│ │TaskSlot3│  │
│  │ 独立上下文│ │ 独立上下文│ │ 独立上下文│ │
│  │ 独立执行器│ │ 独立执行器│ │ 独立执行器│ │
│  └─────────┘ └─────────┘ └─────────┘  │
│  ┌──────────────────────────────┐      │
│  │   ResourceQuota (资源配额)   │      │
│  └──────────────────────────────┘      │
└─────────────────────────────────────────┘
```

### 2.2 核心数据模型

```python
@dataclass
class TaskSlot:
    task_id: str                        # 唯一 ID
    title: str                          # 用户指定标题
    prompt: str                         # 原始 prompt
    status: TaskStatus                  # running/paused/completed/failed
    created_at: float                   # 创建时间
    updated_at: float                   # 最后更新时间
    context_ids: List[str]              # 关联的 context IDs
    plan_id: Optional[str]              # 关联的 plan ID
    execution_id: Optional[str]         # 关联的 execution ID
    resource_usage: ResourceUsage       # 资源使用统计
    error: Optional[str]                # 错误信息
    metadata: Dict                      # 扩展元数据

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class ResourceUsage:
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    tokens_used: int = 0
    elapsed_seconds: float = 0.0
```

### 2.3 关键算法

#### 2.3.1 资源配额管理

```python
class ResourceQuota:
    """全局资源配额"""
    MAX_PARALLEL_TASKS = 8
    MAX_TOTAL_MEMORY_MB = 4096
    MAX_TOTAL_CPU_PERCENT = 80.0
    PER_TASK_MEMORY_MB = 512
    PER_TASK_TIMEOUT_S = 1800  # 30min
    
    def can_create_task(self) -> bool:
        return (
            self.active_task_count < self.MAX_PARALLEL_TASKS
            and self.total_memory_used + self.PER_TASK_MEMORY_MB <= self.MAX_TOTAL_MEMORY_MB
        )
    
    def allocate(self, task_id: str) -> bool:
        if not self.can_create_task():
            return False
        self._allocations[task_id] = {
            "memory_mb": self.PER_TASK_MEMORY_MB,
            "started_at": time.time(),
        }
        return True
```

#### 2.3.2 任务状态隔离

每个 TaskSlot 持有独立的:
- PlanExecutor 实例
- ConversationFoldingManager 实例
- LLM caller 实例
- 内存上下文

**复杂度分析**: O(1) 任务创建 / O(N) 任务查询 (N = 当前任务数)

---

## 3. 接口设计

### 3.1 REST API

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/api/multi-task/create` | 创建任务 | `{prompt, title?, context_ids?}` | `{task_id, status}` |
| GET | `/api/multi-task/list` | 列出任务 | - | `{tasks: [...], total: N}` |
| GET | `/api/multi-task/{id}` | 任务详情 | - | `{task: TaskSlot}` |
| GET | `/api/multi-task/{id}/status` | 任务状态 | - | `{status, progress, ...}` |
| POST | `/api/multi-task/{id}/pause` | 暂停 | - | `{success}` |
| POST | `/api/multi-task/{id}/resume` | 恢复 | - | `{success}` |
| POST | `/api/multi-task/{id}/cancel` | 取消 | - | `{success}` |
| DELETE | `/api/multi-task/{id}` | 删除任务 | - | `{success}` |

### 3.2 WebSocket

**连接**: `WS /api/multi-task/ws/{task_id}`

**客户端消息**:
```json
{"type": "subscribe", "events": ["status", "log", "progress"]}
{"type": "unsubscribe", "events": ["log"]}
{"type": "ping"}
```

**服务端消息**:
```json
{"type": "status", "status": "running", "progress": 0.5}
{"type": "log", "level": "info", "message": "..."}
{"type": "progress", "step": "s1", "percent": 0.3}
{"type": "error", "error": "..."}
{"type": "done", "result": {...}}
{"type": "pong"}
```

### 3.3 错误码

| 码 | 含义 |
|----|------|
| 400 | 请求参数错误 |
| 404 | 任务不存在 |
| 409 | 资源配额耗尽 |
| 500 | 内部错误 |

---

## 4. 数据结构

### 4.1 存储

- **内存**: 活跃任务存储于 `_slots: Dict[str, TaskSlot]`
- **磁盘**: 任务历史持久化到 `~/.trae/multi_task/{task_id}.json`
- **索引**: 按状态分桶（pending / running / paused / completed）

### 4.2 持久化格式

```json
{
  "task_id": "task-abc123",
  "title": "前端开发",
  "prompt": "构建 React 仪表板",
  "status": "running",
  "created_at": 1722800000.0,
  "updated_at": 1722800123.0,
  "context_ids": ["ctx-1", "ctx-2"],
  "plan_id": "plan-xyz",
  "execution_id": "exec-789",
  "resource_usage": {
    "cpu_percent": 12.5,
    "memory_mb": 256.0,
    "tokens_used": 1500,
    "elapsed_seconds": 123.0
  },
  "error": null,
  "metadata": {}
}
```

---

## 5. 性能与安全要求

### 5.1 性能指标

| 指标 | 目标 |
|------|------|
| 任务创建延迟 | < 100ms |
| 状态查询延迟 | < 50ms |
| WebSocket 消息延迟 | < 100ms (P95) |
| 任务切换响应 | < 200ms |
| 最大并行任务 | 8 |
| 单任务内存上限 | 512 MB |
| 单任务超时 | 30 min |

### 5.2 安全要求

- ✅ 任务隔离：每个 TaskSlot 独立内存空间，禁止跨任务访问
- ✅ 资源限制：超时 / 内存超限自动 kill
- ✅ 权限校验：API 调用需要认证（与项目现有 auth 一致）
- ✅ 输入校验：prompt 长度限制（≤ 100K chars）
- ✅ 错误隔离：单任务 panic 不影响其他任务

---

## 6. 验收标准

### 6.1 功能验证

| # | 测试项 | 通过条件 |
|---|--------|----------|
| 1 | 创建 4 个并行任务 | 全部成功，状态 running |
| 2 | 任务间状态隔离 | 任务 1 失败不影响任务 2-4 |
| 3 | 暂停/恢复 | 任务可暂停 30s 后恢复继续 |
| 4 | 取消任务 | 任务状态变为 cancelled，资源释放 |
| 5 | 删除任务 | 任务从列表中移除，磁盘文件删除 |
| 6 | WebSocket 订阅 | 客户端可订阅 status/log/progress 事件 |
| 7 | 资源配额 | 超过 8 个任务返回 409 |
| 8 | 持久化 | 服务重启后任务历史保留 |

### 6.2 性能验证

| # | 指标 | 目标 | 实测 |
|---|------|------|------|
| 1 | 任务创建 P95 | < 100ms | TBD |
| 2 | WebSocket 消息 P95 | < 100ms | TBD |
| 3 | 4 任务并行内存 | < 2GB | TBD |
| 4 | 任务切换响应 | < 200ms | TBD |

### 6.3 自动化测试

**单元测试 (≥ 30 个)**:
- MultiTaskManager 基础 CRUD: 6
- TaskSlot 状态机: 5
- 资源配额: 4
- 持久化: 3
- 并发安全性: 4
- WebSocket 协议: 5
- API 端点: 3

**集成测试 (≥ 5 个)**:
- 4 任务并行运行 5 分钟
- 任务间资源隔离
- 服务重启后任务恢复
- WebSocket 多客户端订阅
- 压力测试：创建 50 个任务验证配额限制

**端到端测试 (TRAE-browseruse)**:
- 访问 http://localhost:5173/solo
- 创建 3 个任务
- 验证 TaskTabs 显示 3 个标签
- 切换任务验证内容正确
- 暂停其中一个任务
- 截图保存

### 6.4 通过条件

- [x] 单元测试通过率 100%
- [x] 集成测试通过率 100%
- [x] 端到端测试通过率 100%
- [x] 性能指标全部达标
- [x] 文档完整
- [x] 代码覆盖率 ≥ 90%

---

## 7. 实施步骤

### Step 1: 数据模型 + MultiTaskManager 核心
- 创建 `backend/app/services/multi_task.py`
- 实现 TaskSlot / TaskStatus / ResourceQuota
- 单元测试

### Step 2: REST API
- 创建 `backend/app/api/multi_task.py`
- 实现 8 个端点
- API 单元测试

### Step 3: WebSocket
- 创建 `backend/app/ws/multi_task.py`
- 实现多客户端订阅
- WebSocket 单元测试

### Step 4: 前端 TaskTabs 组件
- 创建 `frontend/src/components/TaskTabs.tsx`
- 实现标签页 + 状态徽章
- 单元测试

### Step 5: 集成 + 端到端
- 集成测试
- TRAE-browseruse 端到端验证

### Step 6: 文档
- 修改日志
- API 文档

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 多任务内存爆炸 | 高 | 资源配额 + 主动 GC |
| WebSocket 断连 | 中 | 心跳 + 自动重连 |
| 任务间状态污染 | 高 | 完全隔离 + 严格测试 |
| 持久化性能 | 中 | 异步写入 + 批量落盘 |
| 任务取消不彻底 | 中 | 强制 kill + cleanup hook |

---

## 9. 复用声明

- **可复用**: 现有 PlanExecutor / GoalManager / ConversationFoldingManager 实例
- **可复用**: WebSocket 连接管理（`backend/app/ws/`）
- **可复用**: 持久化工具（`backend/app/services/persistence.py`）
- **新增**: MultiTaskManager / TaskSlot / ResourceQuota

---

## 10. 状态

- [x] 调研完成
- [x] 差距分析完成
- [x] Spec 文档完成
- [ ] 实施（待启动）
- [ ] 测试
- [ ] 验收
