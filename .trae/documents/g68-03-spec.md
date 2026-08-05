# G68-03 Spec: 真实 LLM 思考流集成

> **Cycle**: 68
> **Priority**: P0
> **Status**: 待实现
> **基础**: G67-01 ThinkingStreamService (Cycle 67 已完成)
> **目标**: 将 ThinkingStreamService 接入真实的 LLM 流式调用，触发 THINKING_* 事件

---

## 1. 功能需求

### 1.1 功能目标

扩展现有 `agent_runner.py` 和 `claude_cli.py`，在 LLM 流式响应中检测 `reasoning_content` 字段（OpenAI-compatible），并将其作为 THINKING_DELTA 事件推送到 ThinkingStreamService，实现端到端真实 LLM 思考流可视化。

### 1.2 用户场景

- **场景 A**: 用户启动 Agent 任务，LLM 进行多步推理
  - 每个 step 的 reasoning content 实时推送到 ThinkingStreamView
  - 用户看到 LLM 思考过程（"让我先分析需求..."）
- **场景 B**: Agent 调用 tool 时
  - 在 tool 调用前显示 LLM 的思考（"我需要查看 foo.py"）
  - 在 tool 结果返回后显示 LLM 的反思
- **场景 C**: 多 Agent 协作
  - 每个 agent 的思考独立显示
  - 通过 agent_id 区分

### 1.3 数据采集点

```python
# OpenAI-compatible 流式响应
async for chunk in llm.stream(prompt):
    if chunk.choices[0].delta.reasoning_content:
        # 🔥 触发 THINKING_DELTA
        await thinking_service.append_delta(
            step_id=current_step_id,
            delta=chunk.choices[0].delta.reasoning_content
        )
    if chunk.choices[0].delta.content:
        # 正常内容推流
        yield chunk.choices[0].delta.content
```

---

## 2. 技术实现方案

### 2.1 架构设计

```
┌────────────────────────────────────────────────────────────┐
│  AgentRunner (修改)                                         │
│  ┌──────────────────────────────────────────┐              │
│  │ LLM Stream Wrapper                       │              │
│  │ - detect reasoning_content               │              │
│  │ - emit THINKING_START/DELTA/END events   │              │
│  │ - proxy normal content stream            │              │
│  └──────────────────────────────────────────┘              │
│           ↓                       ↓                         │
│  ┌──────────────────┐    ┌──────────────────┐              │
│  │ ThinkingStreamSvc │    │ HermesService    │              │
│  │ (g67-01 已有)     │    │ (ws 推送)         │              │
│  └──────────────────┘    └──────────────────┘              │
└────────────────────────────────────────────────────────────┘
```

### 2.2 关键修改

#### `agent_role_models.py` 新增事件类型

```python
class HookEventType(str, Enum):
    # ... 已有事件
    REASONING_START = "reasoning_start"
    REASONING_DELTA = "reasoning_delta"
    REASONING_END = "reasoning_end"
```

#### `agent_runner.py` 集成流

```python
class AgentRunner:
    def __init__(self, ...):
        self.thinking_service = get_thinking_stream_service()

    async def run_with_thinking(self, prompt: str, agent_id: str, session_id: str):
        # 1. 开始 step
        step = await self.thinking_service.start_step(
            session_id=session_id,
            agent_id=agent_id,
            model=self.model_name
        )

        # 2. 流式 LLM 调用
        full_content = []
        try:
            async for chunk in self.llm.stream(prompt):
                reasoning = chunk.choices[0].delta.reasoning_content
                content = chunk.choices[0].delta.content

                if reasoning:
                    await self.thinking_service.append_delta(
                        step_id=step.step_id,
                        delta=reasoning
                    )

                if content:
                    full_content.append(content)
                    yield content

            # 3. 结束 step
            await self.thinking_service.end_step(
                step_id=step.step_id,
                summary=''.join(full_content)[:200]
            )

        except Exception as e:
            await self.thinking_service.end_step(
                step_id=step.step_id,
                metadata={"error": str(e)}
            )
            raise
```

#### `claude_cli.py` 集成（如果使用 CLI）

```python
class ClaudeCLI:
    async def stream_with_thinking(self, prompt, session_id, agent_id):
        step = await self.thinking_service.start_step(
            session_id=session_id,
            agent_id=agent_id
        )

        # 使用 streaming 模式调用 CLI
        async for line in self.cli.stream(prompt):
            if line.startswith("[reasoning]"):
                await self.thinking_service.append_delta(
                    step_id=step.step_id,
                    delta=line[len("[reasoning]"):]
                )
            else:
                yield line

        await self.thinking_service.end_step(step_id=step.step_id)
```

### 2.3 端到端测试

使用 mock LLM（带 reasoning_content）+ 真实 ThinkingStreamService 验证全链路：

```python
async def test_e2e_thinking_stream():
    mock_llm = MockLLM(reasoning_tokens=[
        "Let me analyze the requirements first.",
        "I need to check the user's intent...",
        "Based on the context, I'll use a HashMap."
    ])

    runner = AgentRunner(llm=mock_llm)
    thinking = get_thinking_stream_service()

    step = await thinking.start_step("sess-1", "agent-1")
    content = []
    async for chunk in runner.run_with_thinking("test", "agent-1", "sess-1"):
        content.append(chunk)

    final_step = await thinking.get_step(step.step_id)

    assert final_step.content == "".join(mock_llm.reasoning_tokens)
    assert final_step.status == "completed"
    assert final_step.tokens > 0
```

---

## 3. 接口设计

### 3.1 现有 API 扩展

#### `GET /api/thinking/{session_id}` （已有）

扩展：返回完整 step 链路（不仅是列表）

**Response 200**:
```json
{
  "session_id": "sess-1",
  "total": 5,
  "steps": [
    {
      "step_id": "think-abc",
      "agent_id": "agent-1",
      "step_index": 0,
      "status": "completed",
      "content": "Let me analyze...",
      "tokens": 234,
      "duration_ms": 1523,
      "started_at": 1728123400.0,
      "ended_at": 1728123401.523
    }
  ]
}
```

#### `GET /api/thinking/{session_id}/by-agent/{agent_id}` （新增）

按 agent 过滤思考步骤

**Response 200**:
```json
{
  "session_id": "sess-1",
  "agent_id": "agent-1",
  "total": 3,
  "steps": [...]
}
```

### 3.2 WebSocket 事件

#### `REASONING_START`

```json
{
  "type": "reasoning_start",
  "payload": {
    "step_id": "think-abc",
    "session_id": "sess-1",
    "agent_id": "agent-1",
    "model": "claude-3.5-sonnet",
    "timestamp": 1728123400.0
  }
}
```

#### `REASONING_DELTA`

```json
{
  "type": "reasoning_delta",
  "payload": {
    "step_id": "think-abc",
    "delta": "Let me analyze the requirements first. ",
    "timestamp": 1728123400.234
  }
}
```

#### `REASONING_END`

```json
{
  "type": "reasoning_end",
  "payload": {
    "step_id": "think-abc",
    "summary": "I'll use a HashMap to solve this problem.",
    "tokens": 234,
    "duration_ms": 1523
  }
}
```

### 3.3 Hook 事件扩展

在 `agent_role_models.py` 中新增：

```python
class HookEventType(str, Enum):
    # ... 已有
    REASONING_START = "reasoning_start"
    REASONING_DELTA = "reasoning_delta"
    REASONING_END = "reasoning_end"
```

---

## 4. 数据结构

### 4.1 ThinkingStep 扩展

```python
class ThinkingStep(BaseModel):
    # 已有字段
    step_id: str
    session_id: str
    agent_id: str
    step_index: int
    model: str
    content: str
    status: str  # "running" | "completed" | "failed"
    started_at: float
    ended_at: Optional[float]
    tokens: int
    summary: str
    metadata: Dict[str, Any]

    # 新增字段
    source: str  # "real_llm" | "mock" | "manual"
    reasoning_tokens: int  # 推理专用 token 数
    final_content: str  # 最终输出（非推理）
```

### 4.2 HookEvent 扩展

```python
class HookEvent(BaseModel):
    type: HookEventType
    session_id: str
    agent_id: str
    timestamp: float
    payload: Dict[str, Any]
    metadata: Dict[str, Any]
```

新增事件类型的 payload 规范：
- `REASONING_START`: `{ step_id, model, metadata }`
- `REASONING_DELTA`: `{ step_id, delta, content_length }`
- `REASONING_END`: `{ step_id, tokens, summary, duration_ms }`

---

## 5. 性能与安全

### 5.1 性能指标

| 指标 | 目标 | 测量 |
|------|------|------|
| 端到端延迟增加 | <10ms | 对比无 thinking 集成 |
| 并发 step 数 | <10/session | 实测 |
| 内存占用 | 不超过 G67-01 基线 +20% | psutil |
| Step 写入吞吐 | >100 deltas/sec | 压测 |

### 5.2 安全要求

- **路径校验**：无新增（无文件系统访问）
- **输入校验**：
  - delta 长度限制 1MB
  - 防止 LLM 输出 HTML 注入（XSS）
- **资源限制**：单 step max 1MB content

### 5.3 错误处理

- LLM 调用失败：end_step with `metadata.error`
- WebSocket 断开：本地缓存，最后批量推送
- 服务重启：thinking 步骤持久化到 SQLite（可选）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] agent_runner.py 检测 reasoning_content 字段
- [ ] 触发 THINKING_START/DELTA/END 事件
- [ ] 推送到 ThinkingStreamService
- [ ] WebSocket 实时推送给前端
- [ ] ThinkingStreamView 显示真实 LLM 思考
- [ ] 多 agent 隔离（by agent_id）
- [ ] 错误处理（end_step with error metadata）

### 6.2 测试项目

#### 单元测试（≥20 用例）
- MockLLM 生成 reasoning tokens
- AgentRunner.run_with_thinking
- Reasoning → thinking_service 链路
- Step 状态机（start → delta → end）
- 错误场景（LLM fail、network error）
- Step 持久化

#### 集成测试（≥10 用例）
- 端到端：mock LLM → thinking_service → ws
- 多 agent 并发
- 长对话（100+ steps）
- 与现有 thinking API 兼容

#### 前端验证（手动）
- 启动真实/模拟 LLM 任务
- ThinkingStreamView 实时显示
- 历史步骤正确累积

### 6.3 通过标准

- 所有测试 100% 通过
- 端到端验证：模拟 LLM → 前端显示思考
- 性能：端到端延迟增加 <10ms
- 无 XSS 漏洞（reasoning content HTML 转义）

---

## 7. 风险与回退

| 风险 | 缓解 | 回退方案 |
|------|------|---------|
| LLM 不返回 reasoning | 检测 + 跳过 | 无思考显示（保持运行） |
| WebSocket 抖动 | 客户端重连 + 重发 | localStorage 缓存 |
| Mock 不准 | 单元测试覆盖 | 手动 E2E |

---

## 8. 交付清单

- `backend/app/services/agent_runner.py` 修改（+50 行）
- `backend/app/services/claude_cli.py` 修改（+30 行）
- `backend/app/services/agent_role_models.py` 修改（+10 行）
- `backend/app/api/thinking.py` 修改（+30 行，新增 by-agent 端点）
- `backend/tests/test_thinking_e2e.py` (≈300 行)
- `backend/tests/test_agent_runner_thinking.py` (≈250 行)

**总计**：~670 行（最小改动集成）
