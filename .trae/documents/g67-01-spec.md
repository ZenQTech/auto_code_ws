# G67-01 Spec: 思考过程实时可视化

> **Cycle**: 67
> **优先级**: P0
> **对标**: Codex CLI PR #6006 (stream reasoning) + Trae SOLO 多面板可视化
> **关联 issue**: [Codex #5339](https://github.com/openai/codex/issues/5339)

---

## 一、功能需求描述

### 1.1 功能目标

将 LLM 推理（thinking/reasoning）过程从前端的"黑盒"中解耦，实时可视化每一步思考、决策和推理链，使用户能够：
- 实时观察 AI 正在思考什么
- 中途识别错误推理并干预
- 理解 agent 决策的上下文

### 1.2 用户场景

| 场景 | 描述 |
|------|------|
| **场景1: 调试任务** | 用户看到 AI 正在"考虑 X 的实现方案"，立即知道当前进度 |
| **场景2: 中途纠错** | AI 推理方向错误时，用户可看到"我决定先尝试 Y..."，并提前干预 |
| **场景3: 性能分析** | 折叠的 thinking blocks 帮助用户回顾长推理链 |

### 1.3 使用流程

```
1. 用户输入需求 → Agent 启动
2. LLM 返回 reasoning_content（token 流式）
3. 后端 Hook 事件总线：THINKING_START / THINKING_DELTA / THINKING_END
4. 前端 useThinkingStream 订阅 ws
5. ThinkingStreamView 实时显示当前 step + 历史折叠
6. 完成后写入 session 历史，可折叠查看
```

---

## 二、技术实现方案

### 2.1 后端架构

#### Hook 事件扩展

```python
# backend/app/services/hook_event_types.py
class HookEventType(str, Enum):
    # 已有
    SUBAGENT_START = "subagent_start"
    PRE_TOOL_USE = "pre_tool_use"
    POST_TOOL_USE = "post_tool_use"
    # 新增 G67-01
    THINKING_START = "thinking_start"     # 开始新 step
    THINKING_DELTA = "thinking_delta"     # token 增量
    THINKING_END = "thinking_end"         # step 完成
    THINKING_SUMMARY = "thinking_summary" # 步骤摘要
```

#### ThinkingStreamService

```python
class ThinkingStep:
    step_id: str                  # UUID
    session_id: str
    agent_id: str
    step_index: int               # 全局递增
    content: str                  # 累计内容
    started_at: float
    ended_at: float | None
    status: Literal["running", "completed", "truncated"]
    metadata: dict                # model, tokens, etc.

class ThinkingStreamService:
    def start_step(self, session_id, agent_id) -> ThinkingStep
    def append_delta(self, step_id, delta: str) -> None
    def end_step(self, step_id, summary: str = "") -> ThinkingStep
    def get_session_steps(self, session_id, limit=100) -> List[ThinkingStep]
    def subscribe(self, session_id, callback) -> str  # subscriber_id
    def unsubscribe(self, subscriber_id) -> None
```

**复杂度**：
- `start_step` O(1)
- `append_delta` O(1) amortized (字符串拼接)
- `get_session_steps` O(N)，N=session 内 step 数
- 内存：每 step 上限 50KB（截断）

#### 持久化

- 立即写 SQLite（`thinking_steps` 表）
- 索引：`(session_id, step_index)`
- LRU：每 session 最多保留 200 step

#### 集成到 HermesService

```python
# 修改 HermesService._handle_streaming_response
async def _handle_streaming_response(self, response, session_id, agent_id):
    current_step = None
    async for chunk in response:
        if chunk.type == "reasoning_start":
            current_step = thinking_service.start_step(session_id, agent_id)
            await hook_bus.emit(HookEvent(
                type=HookEventType.THINKING_START,
                session_id=session_id,
                payload={"step_id": current_step.step_id}
            ))
        elif chunk.type == "reasoning_delta":
            await thinking_service.append_delta(current_step.step_id, chunk.text)
            await hook_bus.emit(HookEvent(
                type=HookEventType.THINKING_DELTA,
                payload={"step_id": current_step.step_id, "delta": chunk.text}
            ))
        elif chunk.type == "reasoning_end":
            await thinking_service.end_step(current_step.step_id, chunk.summary)
            await hook_bus.emit(HookEvent(
                type=HookEventType.THINKING_END,
                payload={"step_id": current_step.step_id, "summary": chunk.summary}
            ))
```

### 2.2 前端架构

#### useThinkingStream Hook

```typescript
export interface ThinkingStep {
  step_id: string;
  session_id: string;
  agent_id: string;
  step_index: number;
  content: string;
  started_at: number;
  ended_at: number | null;
  status: 'running' | 'completed' | 'truncated';
  metadata: Record<string, any>;
}

export function useThinkingStream(options: {
  sessionId: string;
  wsUrl?: string;
  autoConnect?: boolean;
}): {
  steps: ThinkingStep[];
  currentStep: ThinkingStep | null;
  isStreaming: boolean;
  totalSteps: number;
  totalContent: string;
  clear: () => void;
};
```

**核心逻辑**：
- WebSocket 订阅 `thinking_*` 事件
- 增量更新 `currentStep.content`（throttle 100ms）
- step 结束后 push 到 `steps` 数组

#### ThinkingStreamView 组件

```tsx
<ThinkingStreamView
  sessionId={sessionId}
  maxVisible={5}                // 最多同时显示 5 个 step
  collapsible={true}            // 允许折叠历史
  showMetadata={true}           // 显示 token 数 / 耗时
  onStepClick={(step) => {}}    // 点击查看完整内容
/>
```

**UI 设计**：
- 当前 step 展开（脉冲动效）
- 历史 step 折叠（一行摘要 + 折叠图标）
- 右上角统计：总 step 数 / 累计 tokens / 累计耗时
- 底部"清空历史"按钮

### 2.3 WebSocket 协议

```json
// server → client
{
  "type": "thinking_start",
  "session_id": "...",
  "agent_id": "...",
  "payload": {
    "step_id": "...",
    "step_index": 5
  }
}

{
  "type": "thinking_delta",
  "session_id": "...",
  "payload": {
    "step_id": "...",
    "delta": "Let me consider..."
  }
}

{
  "type": "thinking_end",
  "session_id": "...",
  "payload": {
    "step_id": "...",
    "summary": "Decided to use approach A",
    "tokens": 245,
    "duration_ms": 3200
  }
}
```

---

## 三、接口设计规范

### 3.1 REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/thinking/{session_id}` | 获取 session 全部 step |
| GET | `/api/thinking/{session_id}/current` | 获取当前 running step |
| DELETE | `/api/thinking/{session_id}` | 清空 session step 历史 |
| GET | `/api/thinking/{session_id}/export` | 导出为 JSON / Markdown |

### 3.2 错误码

| Code | HTTP | 含义 |
|------|------|------|
| `SESSION_NOT_FOUND` | 404 | session 不存在 |
| `STEP_NOT_FOUND` | 404 | step_id 不存在 |
| `STEP_LOCKED` | 409 | step 正在写入，无法操作 |
| `STORAGE_FULL` | 507 | 单 session step > 200 |

### 3.3 数据结构

```typescript
// ThinkingStep API 响应
interface ThinkingStepResponse {
  step_id: string;
  session_id: string;
  agent_id: string;
  step_index: number;
  content: string;             // ≤50KB, 超长截断 + 标记
  started_at: number;          // unix timestamp
  ended_at: number | null;
  status: 'running' | 'completed' | 'truncated';
  metadata: {
    model?: string;
    tokens?: number;
    duration_ms?: number;
    truncated?: boolean;
  };
  summary?: string;
}
```

---

## 四、性能与安全要求

| 指标 | 目标 | 实测 |
|------|------|------|
| 端到端 delta 延迟 | < 200ms | < 100ms |
| 单 step 最大内容 | 50KB | 50KB |
| session 最大 step 数 | 200 | 200 |
| 内存占用（per session） | < 20MB | < 10MB |
| 重渲染节流 | 100ms | 100ms |

**安全**：
- 内容不做转义，直接 markdown 渲染
- 不持久化敏感字段（如 API key）
- step_id 使用 UUID v4

---

## 五、验收标准

### 5.1 单元测试

- [ ] ThinkingStreamService.start_step 创建并返回 step
- [ ] append_delta 正确累加 content
- [ ] end_step 标记 status=completed + 设置 ended_at
- [ ] get_session_steps 返回倒序
- [ ] subscribe/unsubscribe 正确管理订阅者
- [ ] LRU 淘汰（200 step 上限）
- [ ] 内容截断（>50KB）
- [ ] 并发安全（多 ws 客户端同时订阅）

### 5.2 集成测试

- [ ] HermesService 流式响应中正确触发 hook
- [ ] ws 客户端收到完整 thinking_* 事件序列
- [ ] REST API 200/404/409 正确返回
- [ ] SQLite 持久化与读取一致

### 5.3 前端测试

- [ ] useThinkingStream 状态管理正确
- [ ] WebSocket 断线重连不丢消息
- [ ] ThinkingStreamView 折叠/展开交互
- [ ] 性能测试：100 个 step 渲染 < 1s

### 5.4 E2E 测试（通过 TRAE-browseruse）

- [ ] 启动 session → 输入需求 → 观察到 thinking 流式显示
- [ ] thinking 完成后自动折叠
- [ ] 点击历史 step 可查看完整内容
- [ ] 清空按钮可清除所有历史

### 5.5 通过条件

- 全部单元测试 100% 通过
- 全部集成测试 100% 通过
- 全部前端测试 100% 通过
- E2E 测试 4/4 通过
- 无关键 bug
