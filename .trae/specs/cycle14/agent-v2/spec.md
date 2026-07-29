# Hermes Agent v2 自进化智能体 - Spec

> **版本**: v1.0.0
> **创建日期**: 2026-07-28
> **关联阶段**: Cycle 14 P0-1
> **关联调研**: [CYCLE14_RESEARCH_REPORT.md](../../../CYCLE14_RESEARCH_REPORT.md) § 三
> **目标**: 实现 Hermes Agent v2 自进化智能体，包含 Proactive Memory + Thread Automations + Self-Directing 三大核心能力

---

## 一、功能需求描述

### 1.1 功能目标

实现 Hermes Agent v2 自进化智能体，让 Hermes 从"被动响应"升级为"主动智能"：

1. **Proactive Memory（主动记忆）**：基于 Dual-Track Persistent Memory 之上，增加 Proactive Layer + Background Layer
2. **Thread Automations（线程自动化）**：支持定时/事件触发的自动化任务
3. **Self-Directing（自指导）**：空闲时主动检测待办 + 主动建议 + 后台自动唤醒

### 1.2 用户场景

| 场景 | 用户操作 | Hermes Agent v2 行为 |
| --- | --- | --- |
| 日常开发 | 编写代码 | 检测模式 + 自动保存到 Durable Memory |
| 长会话恢复 | 重新打开 Session | 主动召回相关记忆 + 显示建议 |
| 空闲时 | 无操作 30 分钟 | Background Worker 唤醒 + 检测待办 |
| 定时任务 | 设定 cron | Thread Automation 自动执行 |
| 异常恢复 | Session 中断 | 检查 Background Task 进度 + 续传 |
| 模式学习 | 用户重复操作 | 识别模式 + 主动建议模板化 |

### 1.3 使用流程

```
┌─────────────────────────────────────────────────┐
│ 1. 用户输入需求                                  │
│    ↓                                            │
│ 2. Hermes 检测相关 Durable Memory                │
│    ↓                                            │
│ 3. 主动召回 + Proactive Suggestion（可选）       │
│    ↓                                            │
│ 4. 执行任务                                      │
│    ↓                                            │
│ 5. 更新 Durable Memory + 提取模式                │
│    ↓                                            │
│ 6. 检查 Thread Automation 触发器                 │
│    ↓                                            │
│ 7. 调度 Background Task（如果需要）              │
└─────────────────────────────────────────────────┘
```

---

## 二、技术实现方案

### 2.1 三层记忆体系

#### 2.1.1 Durable Layer（持久层，已在 P1-8 实现）

- 长期持久化关键信息
- 跨会话保留
- JSON 文件 + 索引

#### 2.1.2 Proactive Layer（主动层，新增）

- 基于模式检测的主动建议
- 置信度评分
- 触发条件：模式重复 >= 3 次

**数据结构**：
```python
@dataclass
class ProactivePattern:
    pattern_id: str
    description: str
    trigger_conditions: List[str]
    confidence: float  # 0.0 - 1.0
    occurrences: int
    last_triggered: str
    suggested_action: str
    metadata: Dict[str, Any]
```

#### 2.1.3 Background Layer（后台层，新增）

- 后台自动唤醒
- 心跳式循环
- 任务调度

**数据结构**：
```python
@dataclass
class BackgroundTask:
    task_id: str
    name: str
    schedule: str  # cron 表达式或 interval
    action: str
    last_run: str
    next_run: str
    status: str  # pending / running / completed / failed
    result: Optional[str]
```

### 2.2 Proactive Memory 引擎

**核心模块**：
- `app/core/agent_v2/proactive_memory.py`：主动记忆引擎
- `app/core/agent_v2/pattern_detector.py`：模式检测器
- `app/core/agent_v2/suggestion_engine.py`：建议生成引擎

**核心算法**：
```
输入：用户操作序列 + 时间窗口
步骤：
  1. 滑动窗口聚合最近 N 次操作
  2. 提取操作特征（type/target/context）
  3. 与历史模式匹配（TF-IDF + 语义）
  4. 计算置信度
  5. 过滤 confidence >= 0.7 的模式
  6. 生成 Proactive Suggestion
输出：suggestion list
```

### 2.3 Thread Automations 调度器

**核心模块**：
- `app/core/agent_v2/thread_automation.py`：线程自动化调度器
- `app/core/agent_v2/scheduler.py`：调度引擎（基于 asyncio）

**核心能力**：
- **Cron 调度**：标准 cron 表达式
- **Interval 调度**：固定间隔
- **Event 触发**：事件驱动（Hook 集成）
- **One-shot**：单次执行

**调度循环**：
```python
async def scheduler_loop():
    while True:
        now = datetime.now()
        for task in pending_tasks:
            if task.next_run <= now:
                await execute_task(task)
                update_next_run(task)
        await asyncio.sleep(60)  # 1 分钟检查一次
```

### 2.4 Self-Directing 模式

**核心模块**：
- `app/core/agent_v2/self_directing.py`：自指导引擎
- `app/core/agent_v2/idle_detector.py`：空闲检测器

**Idle Auto-Turn 逻辑**：
```
输入：用户最后操作时间 + 配置阈值
步骤：
  1. 检查空闲时间是否 >= 阈值
  2. 扫描待办任务（来自 Durable Memory）
  3. 检查 Thread Automation 触发器
  4. 评估是否需要主动建议
  5. 生成 Proactive Suggestion
  6. 推送给用户（toast + Session 通知）
输出：proactive_suggestion
```

**Proactive Suggestion 数据结构**：
```python
@dataclass
class ProactiveSuggestion:
    suggestion_id: str
    title: str
    description: str
    confidence: float
    source: str  # memory / pattern / automation / background
    action_url: Optional[str]
    created_at: str
    expires_at: Optional[str]
```

---

## 三、接口设计规范

### 3.1 REST API 端点（共 18 个）

| 端点 | 方法 | 功能 |
| --- | --- | --- |
| `/api/agent-v2/health` | GET | 健康检查 |
| `/api/agent-v2/stats` | GET | 统计概览 |
| `/api/agent-v2/proactive/patterns` | GET | 列出所有主动模式 |
| `/api/agent-v2/proactive/patterns/{id}` | GET | 获取模式详情 |
| `/api/agent-v2/proactive/suggestions` | GET | 获取主动建议 |
| `/api/agent-v2/proactive/suggestions/{id}/accept` | POST | 接受建议 |
| `/api/agent-v2/proactive/suggestions/{id}/reject` | POST | 拒绝建议 |
| `/api/agent-v2/automations` | GET | 列出所有自动化任务 |
| `/api/agent-v2/automations` | POST | 创建自动化任务 |
| `/api/agent-v2/automations/{id}` | GET | 获取自动化任务详情 |
| `/api/agent-v2/automations/{id}` | PUT | 更新自动化任务 |
| `/api/agent-v2/automations/{id}` | DELETE | 删除自动化任务 |
| `/api/agent-v2/automations/{id}/trigger` | POST | 手动触发 |
| `/api/agent-v2/background/tasks` | GET | 列出后台任务 |
| `/api/agent-v2/background/tasks/{id}` | GET | 获取后台任务详情 |
| `/api/agent-v2/self-directing/auto-turn` | POST | 触发 idle auto-turn |
| `/api/agent-v2/self-directing/idle-status` | GET | 获取空闲状态 |
| `/api/agent-v2/dashboard` | GET | Agent v2 仪表盘 |

### 3.2 请求/响应格式

#### 3.2.1 创建自动化任务

**请求**：
```json
{
  "name": "daily_dependency_check",
  "schedule": "0 9 * * *",
  "action": "check_dependencies",
  "enabled": true,
  "metadata": {
    "owner": "user-1",
    "priority": "normal"
  }
}
```

**响应**：
```json
{
  "success": true,
  "automation": {
    "automation_id": "auto-uuid-1",
    "name": "daily_dependency_check",
    "schedule": "0 9 * * *",
    "action": "check_dependencies",
    "enabled": true,
    "status": "active",
    "last_run": null,
    "next_run": "2026-07-29T09:00:00Z",
    "created_at": "2026-07-28T18:00:00Z"
  }
}
```

#### 3.2.2 获取主动建议

**响应**：
```json
{
  "success": true,
  "suggestions": [
    {
      "suggestion_id": "sug-uuid-1",
      "title": "继续之前的工作",
      "description": "检测到您之前在 /home/user/project 中编辑了 5 个文件",
      "confidence": 0.85,
      "source": "memory",
      "action_url": "/projects/proj-1",
      "created_at": "2026-07-28T18:00:00Z",
      "expires_at": "2026-07-29T18:00:00Z"
    }
  ]
}
```

### 3.3 错误码

| 错误码 | 含义 |
| --- | --- |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 500 | 内部错误 |

---

## 四、数据结构定义

### 4.1 ProactivePattern

```python
{
  "pattern_id": "string (UUID)",
  "description": "string",
  "trigger_conditions": "List[string]",
  "confidence": "float (0.0-1.0)",
  "occurrences": "int",
  "last_triggered": "ISO 8601 timestamp",
  "suggested_action": "string",
  "metadata": "Dict[str, Any]"
}
```

### 4.2 ProactiveSuggestion

```python
{
  "suggestion_id": "string (UUID)",
  "title": "string",
  "description": "string",
  "confidence": "float (0.0-1.0)",
  "source": "enum: memory | pattern | automation | background",
  "action_url": "string | null",
  "created_at": "ISO 8601 timestamp",
  "expires_at": "ISO 8601 timestamp | null"
}
```

### 4.3 ThreadAutomation

```python
{
  "automation_id": "string (UUID)",
  "name": "string",
  "schedule": "string (cron or interval)",
  "action": "string",
  "enabled": "bool",
  "status": "enum: active | paused | disabled",
  "last_run": "ISO 8601 timestamp | null",
  "next_run": "ISO 8601 timestamp",
  "created_at": "ISO 8601 timestamp",
  "metadata": "Dict[str, Any]"
}
```

### 4.4 BackgroundTask

```python
{
  "task_id": "string (UUID)",
  "name": "string",
  "automation_id": "string | null",
  "status": "enum: pending | running | completed | failed | cancelled",
  "started_at": "ISO 8601 timestamp | null",
  "completed_at": "ISO 8601 timestamp | null",
  "result": "string | null",
  "error": "string | null"
}
```

---

## 五、性能与安全要求

### 5.1 性能指标

- **Proactive Suggestion 响应时间**：< 200ms
- **Thread Automation 调度精度**：±60s
- **Pattern Detection 扫描时间**：< 1s（10K 操作）
- **Background Task 启动时间**：< 5s
- **Dashboard 加载时间**：< 500ms

### 5.2 资源占用

- **内存**：< 200MB（含模式索引）
- **磁盘**：< 100MB（含历史数据）
- **CPU**：空闲时 < 1%

### 5.3 安全防护

- **路径白名单**：所有 action 必须经过路径白名单
- **命令白名单**：所有 shell 命令必须经过白名单
- **权限控制**：用户只能管理自己的 automation
- **审计日志**：所有创建/更新/删除操作记录日志
- **数据加密**：敏感 metadata 加密存储

---

## 六、验收标准

### 6.1 核心功能（必须通过）

- [ ] 三层记忆体系（Durable + Proactive + Background）
- [ ] Proactive Pattern 检测（重复 >= 3 次触发）
- [ ] Proactive Suggestion 生成（confidence >= 0.7）
- [ ] Thread Automation 调度（Cron + Interval + Event）
- [ ] Self-Directing Idle Auto-Turn
- [ ] Background Task 异步执行
- [ ] 18 个 REST API 端点全部可用

### 6.2 性能指标（必须通过）

- [ ] Suggestion 响应时间 < 200ms（100 条数据下）
- [ ] Automation 调度精度 ±60s
- [ ] Pattern Detection 扫描 < 1s（10K 操作）
- [ ] 并发支持 100+ Background Task

### 6.3 测试覆盖

- [ ] **单元测试**：40+ 用例（数据模型/引擎/调度/检测）
- [ ] **E2E 测试**：25+ 断言（CRUD/调度/触发/建议）
- [ ] **集成测试**：15+ 场景（与 Memory/Hook 集成）
- [ ] **通过率**：100%

### 6.4 测试项目详细列举

#### 6.4.1 脚本自动测试

**单元测试（test_agent_v2_units.py）**：
- [ ] ProactivePattern 数据模型（创建/序列化/反序列化）
- [ ] ProactiveSuggestion 数据模型
- [ ] ThreadAutomation 数据模型
- [ ] BackgroundTask 数据模型
- [ ] PatternDetector 重复检测（1/2/3/N 次）
- [ ] PatternDetector 置信度计算
- [ ] SuggestionEngine 生成建议
- [ ] SuggestionEngine 过滤低置信度
- [ ] Scheduler Cron 表达式解析
- [ ] Scheduler Interval 解析
- [ ] Scheduler Event 触发
- [ ] Scheduler 调度循环
- [ ] IdleDetector 空闲检测
- [ ] SelfDirecting Auto-Turn
- [ ] SelfDirecting 主动建议推送
- [ ] ProactiveMemoryEngine 模式持久化
- [ ] ProactiveMemoryEngine 主动召回
- [ ] BackgroundWorker 任务执行
- [ ] BackgroundWorker 错误重试
- [ ] BackgroundWorker 超时控制
- [ ] 路径白名单
- [ ] 命令白名单
- [ ] 权限控制

**E2E 测试（test_e2e_agent_v2.sh）**：
- [ ] /health 端点
- [ ] /stats 端点
- [ ] 创建 Pattern
- [ ] 列出 Patterns
- [ ] 获取 Pattern 详情
- [ ] 生成 Suggestion
- [ ] 列出 Suggestions
- [ ] 接受 Suggestion
- [ ] 拒绝 Suggestion
- [ ] 创建 Automation
- [ ] 列出 Automations
- [ ] 更新 Automation
- [ ] 删除 Automation
- [ ] 手动触发 Automation
- [ ] 列出 Background Tasks
- [ ] 获取 Background Task 详情
- [ ] 触发 Idle Auto-Turn
- [ ] 获取 Idle Status
- [ ] Dashboard 端点
- [ ] 错误处理（400/404）
- [ ] 并发执行
- [ ] 调度精度
- [ ] 路径白名单拒绝
- [ ] 命令白名单拒绝
- [ ] 权限拒绝

#### 6.4.2 前端网页测试

**前端组件（AgentV2Panel.tsx）**：
- [ ] 页面加载（< 1s）
- [ ] 主动建议卡片渲染
- [ ] 接受/拒绝建议按钮
- [ ] Automation 列表
- [ ] Automation 创建表单
- [ ] Automation 编辑表单
- [ ] Automation 启用/禁用
- [ ] 手动触发按钮
- [ ] Background Tasks 列表
- [ ] Background Task 状态展示
- [ ] Dashboard 图表
- [ ] 空闲状态指示
- [ ] 主动建议推送（toast）
- [ ] 路由 /agent-v2 可访问
- [ ] 菜单入口可见
- [ ] 错误处理（toast 提示）
- [ ] 加载状态（skeleton）
- [ ] 空状态（empty state）

### 6.5 通过标准

- [ ] 所有脚本自动测试 100% 通过
- [ ] 所有前端网页测试 100% 通过
- [ ] TypeScript 编译零错误
- [ ] 文档完整（API 文档 + 用户手册 + 架构图）
