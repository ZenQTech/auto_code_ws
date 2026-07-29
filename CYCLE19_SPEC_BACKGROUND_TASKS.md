# CYCLE19 SPEC: G19-01 Background Tasks Panel

> **任务 ID**: G19-01
> **版本**: v6.41.0
> **日期**: 2026-07-29
> **优先级**: P0（极高）
> **基于**: [Cursor 3.0 Agents Window](https://cursor.com/blog/cursor-3) + [Codex Subagents](https://www.cnblogs.com/vibecodinghuanzhe/p/21026531)

---

## 一、功能需求

### 1.1 用户场景

**主用户场景**：当 AI 需要执行长时域任务（如完整代码重构、批量生成测试、跨多文件修改），用户希望能在等待期间继续做其他事情，并能随时监控任务进度、查看结果。

**典型流程**：
1. 用户在 Composer 中提交一个需要 5 分钟的任务
2. 用户点 "Run in Background" → 任务进入后台执行
3. 用户切换到 Chat 继续提问 → 后台任务继续执行
4. 用户打开 Background Tasks Panel → 看到所有运行中的任务
5. 任务完成后，Panel 出现通知 + Toast 提示
6. 用户点击任务卡片 → 跳转到结果详情

### 1.2 功能目标

| 目标 | 描述 | 验证指标 |
|---|---|---|
| 并行任务 | 至少支持 3 个任务同时运行 | 并发数 ≥ 3 |
| 状态可视 | 实时显示任务状态 + 进度 | 进度更新间隔 < 1s |
| 状态管理 | pause / resume / cancel 操作 | 状态机覆盖所有路径 |
| 持久化 | 任务在刷新后恢复 | localStorage 持久化 |
| 通知 | 任务完成时弹 Toast + 声音 | 100% 触发 |
| 历史 | 查看已完成任务历史 | 历史保留 100 条 |

### 1.3 使用流程

```
[用户触发]
  ├─ Composer "Run in Background" 按钮
  ├─ ChatView 任务调度菜单
  └─ Sidebar "新建后台任务" 入口
        ↓
[BackgroundTaskEngine 创建任务]
  - 分配 task_id
  - 状态：pending
  - 入队
        ↓
[Worker 调度]
  - 状态：queued
  - 分配 Web Worker / 调度
        ↓
[执行中]
  - 状态：running
  - emit progress 事件
  - 更新 token / duration
        ↓
[等待输入（可选）]
  - 状态：waiting
  - 等待用户补充信息
        ↓
[完成]
  - 状态：done / error / cancelled
  - 持久化结果
  - emit completion 事件
  - 通知
```

---

## 二、技术实现方案

### 2.1 架构图

```
┌──────────────────────────────────────────────────────────┐
│                    BackgroundTaskEngine                   │
├──────────────────────────────────────────────────────────┤
│  - tasks: Map<taskId, Task>                              │
│  - eventBus: TaskEventBus                                │
│  - storage: TaskStorage (localStorage)                   │
│  - workers: TaskWorker[]                                 │
│                                                          │
│  Methods:                                                │
│    + createTask(type, payload): Task                     │
│    + startTask(id): void                                 │
│    + pauseTask(id): void                                 │
│    + resumeTask(id): void                                │
│    + cancelTask(id): void                                │
│    + getTask(id): Task | null                            │
│    + listTasks(filter): Task[]                           │
│    + on(event, handler): Subscription                    │
│    + persist(): void                                     │
│    + restore(): void                                     │
└──────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────┐
│                 TaskWorker (Abstract)                    │
├──────────────────────────────────────────────────────────┤
│  - ComposerTaskWorker (Composer 后台执行)                │
│  - AgentTaskWorker (Agent 后台调度)                      │
│  - ReviewTaskWorker (代码审查后台执行)                   │
│  - BestOfNTaskWorker (多模型并行 - G19-02)               │
└──────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────┐
│                 BackgroundTasksPanel (UI)                │
├──────────────────────────────────────────────────────────┤
│  - Header (filter / sort / clear)                        │
│  - Grid (1-4 columns)                                   │
│  - TaskCard (per task)                                   │
│  - EmptyState (no tasks)                                 │
│  - Notification (completion toast)                       │
└──────────────────────────────────────────────────────────┘
```

### 2.2 核心数据模型

```typescript
// 任务类型
export type TaskType = 'composer' | 'agent' | 'review' | 'best-of-n' | 'brainstorm';

// 任务状态
export type TaskStatus =
  | 'pending'    // 等待创建
  | 'queued'     // 已入队
  | 'running'    // 执行中
  | 'waiting'    // 等待用户输入
  | 'paused'     // 已暂停
  | 'done'       // 已完成
  | 'error'      // 错误
  | 'cancelled'; // 已取消

// 任务定义
export interface BackgroundTask {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  progress: number; // 0-100
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number; // ms
  payload: TaskPayload;
  result?: TaskResult;
  error?: TaskError;
  metadata?: Record<string, unknown>;
}

// 任务负载（不同类型不同）
export type TaskPayload =
  | { type: 'composer'; prompt: string; context: ComposerContext }
  | { type: 'agent'; task: string; tools: string[] }
  | { type: 'review'; files: string[] }
  | { type: 'best-of-n'; prompt: string; models: string[] }
  | { type: 'brainstorm'; topic: string };

// 任务结果
export type TaskResult =
  | { type: 'composer'; edits: ComposerEdit[]; summary: string }
  | { type: 'agent'; output: string; artifacts: Artifact[] }
  | { type: 'review'; issues: ReviewIssue[]; score: number }
  | { type: 'best-of-n'; candidates: BestOfNCandidate[] }
  | { type: 'brainstorm'; plan: string; questions: string[] };

// 任务事件
export type TaskEvent =
  | { type: 'created'; task: BackgroundTask }
  | { type: 'started'; taskId: string; timestamp: number }
  | { type: 'progress'; taskId: string; progress: number; message?: string }
  | { type: 'paused'; taskId: string }
  | { type: 'resumed'; taskId: string }
  | { type: 'cancelled'; taskId: string }
  | { type: 'completed'; task: BackgroundTask }
  | { type: 'error'; taskId: string; error: TaskError };
```

### 2.3 状态机

```
   pending
     ↓ (create)
   queued
     ↓ (start)
   running ──────► waiting ──► running (resume)
     ↓                ↓
   paused ◄────────────┘
     ↓ (resume)
   running
     ↓ (success)
   done
     ↓
   (terminal)

   任何状态 ───► cancelled (cancel)
   任何状态 ───► error (failure)
```

### 2.4 持久化策略

```typescript
class TaskStorage {
  private readonly KEY = 'hermes.background_tasks';
  private readonly MAX_HISTORY = 100;
  private readonly MAX_RUNNING = 20;

  save(tasks: BackgroundTask[]): void {
    const running = tasks.filter(t => isActiveStatus(t.status));
    const history = tasks.filter(t => isTerminalStatus(t.status)).slice(0, this.MAX_HISTORY);
    const merged = [...running, ...history];
    localStorage.setItem(this.KEY, JSON.stringify(merged));
  }

  load(): BackgroundTask[] {
    const data = localStorage.getItem(this.KEY);
    if (!data) return [];
    try {
      const tasks = JSON.parse(data) as BackgroundTask[];
      // 恢复时：running → queued（需重启）
      return tasks.map(t => 
        t.status === 'running' ? { ...t, status: 'queued' as TaskStatus } : t
      );
    } catch {
      return [];
    }
  }
}
```

---

## 三、接口设计规范

### 3.1 前端 API

```typescript
// BackgroundTaskEngine
export class BackgroundTaskEngine {
  constructor(config?: Partial<EngineConfig>);

  // 任务管理
  createTask(payload: TaskPayload, options?: CreateOptions): BackgroundTask;
  startTask(id: string): void;
  pauseTask(id: string): void;
  resumeTask(id: string): void;
  cancelTask(id: string): void;
  retryTask(id: string): void;

  // 查询
  getTask(id: string): BackgroundTask | null;
  listTasks(filter?: TaskFilter): BackgroundTask[];
  getActiveTasks(): BackgroundTask[];
  getHistoryTasks(): BackgroundTask[];

  // 事件订阅
  on(event: TaskEventType, handler: TaskEventHandler): () => void;
  once(event: TaskEventType, handler: TaskEventHandler): void;

  // 持久化
  persist(): void;
  restore(): BackgroundTask[];

  // 清理
  clearHistory(): void;
  removeTask(id: string): void;
}

// 过滤器
export interface TaskFilter {
  type?: TaskType | TaskType[];
  status?: TaskStatus | TaskStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}
```

### 3.2 后端 API

```python
# backend/app/api/tasks.py

@router.get("/api/tasks")
async def list_tasks(
    type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
) -> TaskListResponse:
    """列出任务（支持筛选）"""
    ...

@router.get("/api/tasks/{task_id}")
async def get_task(task_id: str) -> TaskResponse:
    """获取单个任务详情"""
    ...

@router.post("/api/tasks")
async def create_task(
    request: CreateTaskRequest,
    user_id: str = Depends(get_current_user),
) -> TaskResponse:
    """创建后台任务"""
    ...

@router.post("/api/tasks/{task_id}/start")
async def start_task(task_id: str) -> TaskResponse:
    """启动任务"""
    ...

@router.post("/api/tasks/{task_id}/pause")
async def pause_task(task_id: str) -> TaskResponse:
    """暂停任务"""
    ...

@router.post("/api/tasks/{task_id}/resume")
async def resume_task(task_id: str) -> TaskResponse:
    """恢复任务"""
    ...

@router.post("/api/tasks/{task_id}/cancel")
async def cancel_task(task_id: str) -> TaskResponse:
    """取消任务"""
    ...

@router.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str) -> DeleteResponse:
    """删除任务（仅 completed 状态）"""
    ...

@router.get("/api/tasks/stats")
async def get_task_stats() -> TaskStatsResponse:
    """任务统计（总数 / 运行中 / 今日完成 / 平均耗时）"""
    ...
```

### 3.3 错误码

| 错误码 | 含义 | HTTP |
|---|---|---|
| TASK_NOT_FOUND | 任务不存在 | 404 |
| TASK_INVALID_STATUS | 状态不允许此操作 | 409 |
| TASK_LIMIT_EXCEEDED | 超过最大并发数 | 429 |
| TASK_TIMEOUT | 任务执行超时 | 504 |
| TASK_INTERNAL_ERROR | 内部错误 | 500 |

---

## 四、数据结构定义

### 4.1 localStorage Schema

```typescript
interface StorageSchema {
  version: string; // "1.0"
  tasks: BackgroundTask[];
  lastSync: number;
}
```

### 4.2 SSE Event Schema

```typescript
interface TaskSSEEvent {
  event: 'progress' | 'log' | 'status' | 'done' | 'error';
  taskId: string;
  data: unknown;
  timestamp: number;
}
```

### 4.3 WebSocket Message Schema（可选）

```typescript
interface WSMessage {
  type: 'subscribe' | 'unsubscribe' | 'event';
  topic: 'task.' + string;
  payload?: unknown;
}
```

---

## 五、性能与安全要求

### 5.1 性能

| 指标 | 要求 |
|---|---|
| 任务创建延迟 | < 50ms |
| 状态更新延迟 | < 200ms |
| Panel 渲染（10 任务） | < 100ms |
| 持久化写入 | < 50ms（异步） |
| 最大并发任务 | 20 个 |
| 历史保留 | 100 条 |

### 5.2 安全

- **任务隔离**：每个任务在独立作用域运行
- **敏感数据过滤**：payload 中的 .env / token 自动 mask
- **权限控制**：用户只能操作自己的任务
- **速率限制**：单用户最多 20 并发，60s 内最多创建 30 个
- **审计日志**：所有任务操作记录到 audit log

---

## 六、验收标准

### 6.1 功能验收

- [ ] 任务可创建 / 启动 / 暂停 / 恢复 / 取消
- [ ] 状态正确流转（状态机覆盖所有路径）
- [ ] 进度实时更新（< 1s 延迟）
- [ ] 持久化：刷新后任务状态恢复
- [ ] 通知：完成时 Toast + 声音
- [ ] 历史：保留最近 100 条
- [ ] 并发：至少 3 个任务并行

### 6.2 UI 验收

- [ ] Panel 打开流畅（< 200ms）
- [ ] 任务卡片显示完整信息（type / title / status / progress / duration）
- [ ] 筛选 / 搜索 / 排序可用
- [ ] 操作按钮响应 < 100ms
- [ ] 空状态友好提示
- [ ] 错误状态明确
- [ ] 移动端响应式

### 6.3 测试验收

- [ ] 单元测试 ≥ 15 个（状态机 + 事件总线 + 持久化）
- [ ] 集成测试 ≥ 8 个（任务生命周期 + UI 操作）
- [ ] E2E 断言 ≥ 10 个
- [ ] TypeScript 零错误
- [ ] 100% 测试通过

### 6.4 测试用例清单

#### 单元测试（vitest）
1. BackgroundTaskEngine.createTask 正确创建任务
2. createTask 自动分配 task_id
3. startTask 状态从 queued → running
4. pauseTask 状态从 running → paused
5. resumeTask 状态从 paused → running
6. cancelTask 状态从任何 → cancelled
7. cancelTask 后无法 start
8. retryTask 仅在 error 状态可用
9. 事件总线正确发出 created/started/progress/completed 事件
10. 持久化保存到 localStorage
11. 持久化恢复时 running → queued
12. clearHistory 清空所有 completed 任务
13. removeTask 删除任务
14. 过滤器按 type/status 正确过滤
15. 搜索按 title 模糊匹配

#### 集成测试（vitest + RTL）
1. 打开 Panel 显示任务列表
2. 点击 task 卡片显示详情
3. 点击 pause 按钮触发暂停
4. 点击 cancel 按钮显示确认对话框
5. 筛选状态切换
6. 搜索框输入过滤
7. 网格列数切换
8. 空状态正确显示

#### E2E 测试（bash）
1. 文件存在性
2. API 接口正确暴露
3. 状态机覆盖所有路径
4. 事件订阅正常
5. 持久化读写正常
6. 通知触发正常
7. 错误处理覆盖

---

## 七、风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| Web Worker 兼容 | 中 | 降级到 setTimeout 分片 |
| localStorage 容量 | 低 | 仅保留元数据，结果存后端 |
| 状态同步 | 中 | 单向数据流 + 事件总线 |
| 任务泄漏 | 低 | 5min 超时自动 cancel |

---

**完成日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 进入 Phase 3 实现
