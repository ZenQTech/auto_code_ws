# G66-01 Spec: Reasoning Effort 切换

> **Cycle**: 66
> **生成日期**: 2026-08-04
> **目标**: 实现 Reasoning Effort 运行时切换（low/medium/high）
> **对标**: Codex CLI v0.121+ `model_reasoning_effort` + Alt+,/Alt+. 快捷键

---

## 一、功能需求描述

### 1.1 用户场景

**场景 1：用户希望快速原型设计**
- 当前会话使用 `high` reasoning（响应慢但质量高）
- 用户开始写样板代码，希望切换到 `low` 提升速度
- 通过 Alt+, 快捷键或 UI 徽章点击切换
- AgentRunner 立即应用新设置，下次 LLM 调用生效

**场景 2：用户需要深度分析**
- 当前使用 `low` 进行简单重构
- 遇到复杂架构设计问题，需要 `high` 提升质量
- 通过 UI 切换或快捷键
- 持久化到 sessionStorage + 后端

**场景 3：批量任务差异化**
- CSV 批处理 spawn_agents（G65-02）
- 每行 task 可指定不同 reasoning effort
- 通过 CSV 的 `model_reasoning_effort` 列覆盖默认

### 1.2 功能目标

| 目标 | 描述 |
|------|------|
| 运行时切换 | 任务进行中可切换 effort 等级 |
| 多等级支持 | low / medium / high（默认 medium） |
| UI 反馈 | 徽章颜色 + 动画过渡 |
| 快捷键 | Alt+, 降低 / Alt+. 提高 |
| 持久化 | sessionStorage + 后端 instance 状态 |
| API 支持 | PUT/GET reasoning 端点 |
| 兼容性 | 与 Mock + Real Runner 兼容 |
| 批量集成 | CSV `model_reasoning_effort` 列覆盖 |

---

## 二、技术实现方案

### 2.1 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                     Frontend Layer                            │
│                                                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────┐│
│  │ ReasoningToggle │  │ ReasoningBadge   │  │ 快捷键监听   ││
│  │   (3-档切换)    │  │  (颜色+动画)     │  │ Alt+,/Alt+.  ││
│  └────────┬────────┘  └──────────┬───────┘  └──────┬───────┘│
│           └──────────┬──────────┘                  │         │
│                      ▼                              │         │
│           ┌────────────────────────┐                │         │
│           │  useReasoningEffort    │◄───────────────┘         │
│           │     (Hook)             │                          │
│           └──────────┬─────────────┘                          │
└──────────────────────┼───────────────────────────────────────┘
                       │ HTTP /api/agent-roles/instances/{id}/reasoning
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Backend Layer                             │
│                                                               │
│  ┌──────────────────────────────────────────────┐            │
│  │     ReasoningEffortController                 │            │
│  │   - set_effort(agent_id, effort)              │            │
│  │   - get_effort(agent_id)                      │            │
│  │   - get_history(agent_id)                     │            │
│  └──────────────────┬───────────────────────────┘            │
│                     │                                         │
│                     ▼                                         │
│  ┌──────────────────────────────────────────────┐            │
│  │     AgentRoleManager                          │            │
│  │   - update_instance_reasoning(agent_id, ...) │            │
│  │   - emit REASONING_CHANGE event              │            │
│  └──────────────────┬───────────────────────────┘            │
│                     │                                         │
│                     ▼                                         │
│  ┌──────────────────────────────────────────────┐            │
│  │     AgentRunner (Mock/Real)                   │            │
│  │   - on_reasoning_change(callback)             │            │
│  │   - next_request_effort = current_effort      │            │
│  └──────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 核心算法

**等级顺序与默认值**：
```python
REASONING_EFFORT_ORDER = ["low", "medium", "high"]
DEFAULT_EFFORT = "medium"
```

**Alt+, 降低算法**（O(1)）：
```python
def decrease(current: str) -> str:
    idx = REASONING_EFFORT_ORDER.index(current)
    return REASONING_EFFORT_ORDER[max(0, idx - 1)]
```

**Alt+. 提高算法**（O(1)）：
```python
def increase(current: str) -> str:
    idx = REASONING_EFFORT_ORDER.index(current)
    return REASONING_EFFORT_ORDER[min(2, idx + 1)]
```

**循环算法**（O(1)）：
```python
def cycle(current: str) -> str:
    idx = REASONING_EFFORT_ORDER.index(current)
    return REASONING_EFFORT_ORDER[(idx + 1) % 3]
```

### 2.3 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| ReasoningEffortController | backend/app/services/reasoning_effort.py | 状态管理 + 事件分发 |
| API endpoint | backend/app/api/agent_roles.py | PUT/GET 端点 |
| Mock 集成 | backend/app/services/agent_runner.py | mock 模式响应 effort |
| Real 集成 | backend/app/services/real_agent_runner.py | 真实 CLI 透传 |
| useReasoningEffort | frontend/src/hooks/useReasoningEffort.ts | 状态 Hook |
| ReasoningEffortToggle | frontend/src/components/ReasoningEffortToggle.tsx | UI 切换组件 |
| ReasoningEffortBadge | frontend/src/components/ReasoningEffortBadge.tsx | 状态徽章 |
| 快捷键 | frontend/src/hooks/useShortcut.ts | Alt+,/Alt+. 绑定 |

---

## 三、接口设计规范

### 3.1 后端 API

#### 3.1.1 设置 Reasoning Effort

```http
PUT /api/agent-roles/instances/{agent_id}/reasoning
Content-Type: application/json
Authorization: Bearer <token>

Request Body:
{
  "effort": "low" | "medium" | "high"
}

Response 200:
{
  "success": true,
  "agent_id": "agent-abc123",
  "effort": "high",
  "previous_effort": "medium",
  "updated_at": 1785836700.123,
  "applied_immediately": true
}

Response 400:
{
  "detail": "Invalid effort: 'xhigh'. Must be one of: low, medium, high"
}

Response 404:
{
  "detail": "Agent not found: agent-abc123"
}
```

#### 3.1.2 获取当前 Effort

```http
GET /api/agent-roles/instances/{agent_id}/reasoning

Response 200:
{
  "success": true,
  "agent_id": "agent-abc123",
  "effort": "high",
  "updated_at": 1785836700.123,
  "default_effort": "medium"
}
```

#### 3.1.3 获取历史记录

```http
GET /api/agent-roles/instances/{agent_id}/reasoning/history?limit=20

Response 200:
{
  "success": true,
  "agent_id": "agent-abc123",
  "history": [
    {
      "effort": "high",
      "previous_effort": "medium",
      "timestamp": 1785836700.123,
      "source": "user" | "keyboard" | "api" | "csv"
    }
  ]
}
```

### 3.2 前端 Hook API

```typescript
interface UseReasoningEffortOptions {
  agentId: string;
  defaultEffort?: ReasoningEffort;
  autoRefresh?: boolean;
}

interface UseReasoningEffortResult {
  effort: ReasoningEffort;
  isUpdating: boolean;
  error: string | null;
  history: ReasoningChange[];
  
  setEffort: (effort: ReasoningEffort, source?: ChangeSource) => Promise<boolean>;
  increase: (source?: ChangeSource) => Promise<void>;
  decrease: (source?: ChangeSource) => Promise<void>;
  cycle: (source?: ChangeSource) => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

type ReasoningEffort = 'low' | 'medium' | 'high';
type ChangeSource = 'user' | 'keyboard' | 'api' | 'csv';
```

### 3.3 错误码

| 错误码 | HTTP | 含义 |
|--------|------|------|
| INVALID_EFFORT | 400 | effort 值非法 |
| AGENT_NOT_FOUND | 404 | agent_id 不存在 |
| UPDATE_FAILED | 500 | 后端更新失败 |

---

## 四、数据结构定义

### 4.1 ReasoningEffort 枚举

```python
from enum import Enum

class ReasoningEffort(str, Enum):
    """Reasoning effort 等级（对标 Codex CLI model_reasoning_effort）"""
    LOW = "low"          # 最快，样板代码/格式化
    MEDIUM = "medium"    # 默认，交互式编码
    HIGH = "high"        # 最慢，复杂架构/深度分析

    @classmethod
    def order(cls) -> list[str]:
        return [e.value for e in cls]

    @classmethod
    def next(cls, current: str) -> str:
        """循环到下一档（low → medium → high → low）"""
        order = cls.order()
        idx = order.index(current)
        return order[(idx + 1) % len(order)]

    @classmethod
    def previous(cls, current: str) -> str:
        """循环到上一档"""
        order = cls.order()
        idx = order.index(current)
        return order[(idx - 1) % len(order)]
```

### 4.2 AgentInstance 扩展

```python
@dataclass
class AgentInstance:
    # ... 现有字段 ...
    reasoning_effort: str = "medium"          # 当前 effort
    reasoning_history: List[Dict] = field(default_factory=list)  # 变更历史
    reasoning_updated_at: float = 0.0
```

### 4.3 ReasoningChange 记录

```python
@dataclass
class ReasoningChange:
    effort: str
    previous_effort: str
    timestamp: float
    source: str  # "user" | "keyboard" | "api" | "csv"

    def to_dict(self) -> dict:
        return {
            "effort": self.effort,
            "previous_effort": self.previous_effort,
            "timestamp": self.timestamp,
            "source": self.source,
        }
```

---

## 五、性能与安全要求

### 5.1 性能指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| PUT API 响应时间 | < 100ms | 单元测试 |
| UI 切换响应时间 | < 200ms | 单元测试 + 浏览器测试 |
| 快捷键响应 | < 50ms | 单元测试 |
| 历史记录查询 | < 50ms | 单元测试 |
| 并发切换安全 | 100 req/s 无丢失 | 压力测试 |

### 5.2 资源限制

| 资源 | 限制 |
|------|------|
| 历史记录条数 | 50 条/agent（LRU） |
| 并发请求 | 10 req/s/agent |
| 内存占用 | < 1MB/agent |
| 持久化 | sessionStorage（前端）+ 内存（后端） |

### 5.3 安全要求

| 项目 | 措施 |
|------|------|
| 输入校验 | effort 必须在枚举范围内 |
| CSRF | Bearer token + SameSite cookie |
| 速率限制 | 10 req/s/agent（防滥用） |
| 日志脱敏 | 不记录 effort 内容 |
| 错误隔离 | 切换失败不影响原任务 |

---

## 六、验收标准

### 6.1 单元测试（自动）

| 测试文件 | 测试数 | 目标 |
|----------|--------|------|
| `test_reasoning_effort.py` | 30+ | 枚举、算法、Controller |
| `test_reasoning_effort_api.py` | 15+ | REST 端点 |
| `useReasoningEffort.test.ts` | 12+ | Hook 逻辑 |
| `ReasoningEffortToggle.test.tsx` | 15+ | 切换 UI |
| `ReasoningEffortBadge.test.tsx` | 10+ | 徽章渲染 |
| `useShortcut.test.ts` | +5 | Alt+,/Alt+. 快捷键 |
| **总计** | **≥ 87** | **100% 通过** |

### 6.2 E2E 浏览器测试（TRAE-browseruse）

| 场景 | 操作 | 期望 |
|------|------|------|
| 1. 切换 UI | 点击徽章 → 选 high | 徽章变红 + 实例 effort 更新 |
| 2. 快捷键降低 | 按 Alt+, | low → medium → low（已是最小，循环） |
| 3. 快捷键提高 | 按 Alt+. | medium → high（已是最大，循环） |
| 4. 持久化 | 切换后刷新页面 | 状态保留 |
| 5. 历史记录 | 切换 3 次后查看 | 看到 3 条记录 |
| 6. 无效输入 | 发送 effort="xhigh" | 400 错误 + 友好提示 |
| 7. 集成 batch | CSV 含 `model_reasoning_effort=high` 列 | 该行 agent 使用 high |
| 8. 错误恢复 | 后端 500 → 重试 | 自动重试 3 次 + 错误提示 |

### 6.3 通过标准

- ✅ 所有单元测试通过（≥ 87 个）
- ✅ 所有 E2E 场景通过（8/8）
- ✅ PUT API < 100ms
- ✅ UI 切换 < 200ms
- ✅ 测试覆盖率 ≥ 90%（reasoning_effort.py + 相关文件）
- ✅ 0 个 critical bug，< 3 个 minor bug
- ✅ 与 Mock + Real Runner 均兼容
- ✅ CSV 批处理集成测试通过

---

## 七、向后兼容

| 模块 | 兼容性 | 说明 |
|------|--------|------|
| AgentInstance | ✅ 扩展 | 新增 3 个可选字段，默认值兼容 |
| AgentRunner | ✅ 兼容 | 现有实例 effort=medium（默认） |
| CSV 批处理 | ✅ 增强 | 新增可选列 model_reasoning_effort |
| API | ✅ 扩展 | 新增 /reasoning 端点 |
| 现有测试 | ✅ 无回归 | 现有 208 个测试 100% 通过 |

---

## 八、文件清单

### 8.1 新建

| 文件 | 行数（预估） | 用途 |
|------|--------------|------|
| `backend/app/services/reasoning_effort.py` | 250 | Controller + 算法 |
| `backend/tests/test_reasoning_effort.py` | 350 | Controller 单元测试 |
| `backend/tests/test_reasoning_effort_api.py` | 200 | API 端点测试 |
| `frontend/src/hooks/useReasoningEffort.ts` | 220 | Hook |
| `frontend/src/hooks/useReasoningEffort.test.ts` | 180 | Hook 测试 |
| `frontend/src/components/ReasoningEffortToggle.tsx` | 200 | 切换 UI |
| `frontend/src/components/ReasoningEffortToggle.test.tsx` | 200 | UI 测试 |
| `frontend/src/components/ReasoningEffortBadge.tsx` | 120 | 徽章 |
| `frontend/src/components/ReasoningEffortBadge.test.tsx` | 120 | 徽章测试 |

### 8.2 修改

| 文件 | 修改行数（预估） | 修改内容 |
|------|------------------|----------|
| `backend/app/services/agent_role_manager.py` | +30 | AgentInstance 扩展 |
| `backend/app/services/agent_runner.py` | +20 | Mock Runner 响应 effort |
| `backend/app/services/real_agent_runner.py` | +30 | Real Runner 透传 |
| `backend/app/services/batch_spawner.py` | +20 | CSV 解析 effort 列 |
| `backend/app/api/agent_roles.py` | +80 | 3 个新端点 |
| `frontend/src/components/AgentExecutionPanel.tsx` | +50 | 集成 Toggle |
| `frontend/src/components/VibeSoloShell.tsx` | +30 | 集成 Badge + 快捷键 |
| `frontend/src/hooks/useShortcut.ts` | +20 | Alt+,/Alt+. 监听 |

---

## 九、实施时间表

| 阶段 | 时长 | 任务 |
|------|------|------|
| 1. 后端核心 | 30min | ReasoningEffortController + AgentRoleManager 扩展 |
| 2. 后端 API | 20min | PUT/GET 端点 + 错误处理 |
| 3. 后端 Mock 集成 | 15min | AgentRunner 响应 effort |
| 4. 后端 Real 集成 | 15min | RealAgentRunner 透传 |
| 5. 后端测试 | 30min | ≥ 45 个测试用例 |
| 6. 前端 Hook | 20min | useReasoningEffort |
| 7. 前端组件 | 30min | Toggle + Badge |
| 8. 前端集成 | 20min | 嵌入 VibeSoloShell + 快捷键 |
| 9. 前端测试 | 30min | ≥ 42 个测试用例 |
| 10. E2E 验证 | 15min | 浏览器端到端测试 |
| **总计** | **~4h** | **完整实施 + 测试** |
