# CYCLE19 SPEC: G19-02 Best-of-N Multi-Model 并行执行

> **任务 ID**: G19-02
> **版本**: v6.42.0
> **日期**: 2026-07-29
> **优先级**: P0（极高）
> **基于**: [Cursor 3.0 /best-of-n](https://cursor.com/es/changelog/3-0) + Multi-Model Ensemble 实践

---

## 一、功能需求

### 1.1 用户场景

**主用户场景**：用户希望对比不同 LLM 模型对同一 prompt 的输出，选择最满意的结果。

**典型流程**：
1. 用户在 Composer 输入 prompt
2. 切换到 "Best-of-N" 模式
3. 选择 3 个模型（如 claude-sonnet / gpt-5 / deepseek-coder）
4. 点击发送 → 3 个模型并行执行
5. UI 显示 3 列实时流式输出
6. 完成后显示耗时 / token 成本对比
7. 用户选择 / 合并 / 丢弃候选

### 1.2 功能目标

| 目标 | 描述 | 验证指标 |
|---|---|---|
| 并行执行 | N 个模型同时调用 | N 默认 3，最大 5 |
| 流式展示 | 每个模型独立流式输出 | SSE 推送 < 1s 延迟 |
| 错误降级 | 单模型失败不影响其他 | 错误显示 + 其他继续 |
| 超时控制 | 单模型 60s 超时 | 自动标记 failed |
| 成本对比 | 显示每个模型 token / 成本 | 成本精确到 0.01 元 |
| 候选操作 | 选择 / 合并 / 重新生成 | 完整操作集 |

### 1.3 使用流程

```
[Composer 模式切换]
  - edit / plan / preview / best-of-n
        ↓
[Best-of-N 配置]
  - 模型选择（多选，至少 2 个）
  - 公共 prompt
  - 可选 system prompt
        ↓
[发送]
  - POST /api/llm/best-of-n
  - 引擎并行启动 N 个流
  - 返回 task_id
        ↓
[SSE 流式接收]
  - 引擎订阅 SSE 事件
  - 每个模型独立进度更新
  - UI 实时渲染
        ↓
[完成]
  - 所有模型 done / error
  - 显示对比表
  - 用户操作：选择 / 合并 / 重新生成
```

---

## 二、技术实现方案

### 2.1 架构图

```
┌──────────────────────────────────────────────────────────┐
│                  MultiModelExecutor                       │
├──────────────────────────────────────────────────────────┤
│  - candidates: Map<id, BestOfNCandidate>                  │
│  - timeout: number (default 60s)                          │
│  - onProgress: (id, text) => void                        │
│                                                          │
│  Methods:                                                │
│    + execute(prompt, models, options): Promise<Result>   │
│    + cancel(): void                                      │
│    + retry(id): Promise<void>                            │
└──────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────┐
│                  ModelClient (Abstract)                  │
├──────────────────────────────────────────────────────────┤
│  - AnthropicClient (Claude Sonnet 4.5)                    │
│  - OpenAIClient (GPT-5)                                  │
│  - DeepSeekClient (DeepSeek V3.2)                        │
│  - CustomClient (用户自定义模型)                          │
└──────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────┐
│                   BestOfNPanel (UI)                      │
├──────────────────────────────────────────────────────────┤
│  - Header (status / cancel)                              │
│  - Grid (2-3 columns)                                    │
│  - CandidateCard (per model)                             │
│    - Model name + status badge                           │
│    - Streaming text                                      │
│    - Token count / cost                                  │
│    - Action buttons (select / retry / dismiss)           │
│  - ComparisonTable (after all done)                      │
│  - MergeDialog (合并多个候选)                            │
└──────────────────────────────────────────────────────────┘
```

### 2.2 核心数据模型

```typescript
// 候选模型
export interface BestOfNCandidate {
  id: string;
  model: string;          // 'claude-sonnet-4.5'
  status: CandidateStatus;
  text: string;           // 流式累积
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;           // 元
  error?: string;
}

export type CandidateStatus = 'pending' | 'running' | 'streaming' | 'done' | 'failed' | 'cancelled';

// Best-of-N 请求
export interface BestOfNRequest {
  prompt: string;
  system?: string;
  models: string[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

// Best-of-N 结果
export interface BestOfNResult {
  taskId: string;
  candidates: BestOfNCandidate[];
  totalDuration: number;
  totalCost: number;
  successCount: number;
  failureCount: number;
}

// Best-of-N SSE 事件
export type BestOfNEvent =
  | { type: 'start'; taskId: string; model: string }
  | { type: 'delta'; taskId: string; model: string; text: string }
  | { type: 'done'; taskId: string; candidate: BestOfNCandidate }
  | { type: 'error'; taskId: string; model: string; error: string }
  | { type: 'all-complete'; taskId: string; result: BestOfNResult };
```

### 2.3 执行流程

```typescript
class MultiModelExecutor {
  async execute(req: BestOfNRequest): Promise<BestOfNResult> {
    const taskId = uuid();
    const candidates = req.models.map(model => ({
      id: uuid(),
      model,
      status: 'pending' as CandidateStatus,
      text: '',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    }));

    // 并行执行 + 超时控制
    const promises = candidates.map(async (candidate) => {
      try {
        const client = this.getClient(candidate.model);
        const startTime = Date.now();
        candidate.status = 'streaming';
        candidate.startedAt = startTime;

        const stream = client.stream(req.prompt, req.system, {
          maxTokens: req.maxTokens,
          temperature: req.temperature,
        });

        for await (const chunk of stream) {
          candidate.text += chunk.text;
          candidate.outputTokens += chunk.tokens;
          candidate.cost = calculateCost(candidate.inputTokens, candidate.outputTokens, candidate.model);
          this.emit({ type: 'delta', taskId, model: candidate.model, text: chunk.text });
        }

        candidate.status = 'done';
        candidate.completedAt = Date.now();
        candidate.duration = candidate.completedAt - startTime;
        this.emit({ type: 'done', taskId, candidate });
      } catch (err) {
        candidate.status = 'failed';
        candidate.error = String(err);
        this.emit({ type: 'error', taskId, model: candidate.model, error: candidate.error });
      }
    });

    // 总超时
    await Promise.race([
      Promise.allSettled(promises),
      new Promise(resolve => setTimeout(resolve, req.timeoutMs ?? 60000)),
    ]);

    const result: BestOfNResult = {
      taskId,
      candidates,
      totalDuration: Date.now() - startTime,
      totalCost: candidates.reduce((sum, c) => sum + c.cost, 0),
      successCount: candidates.filter(c => c.status === 'done').length,
      failureCount: candidates.filter(c => c.status === 'failed').length,
    };
    this.emit({ type: 'all-complete', taskId, result });
    return result;
  }
}
```

### 2.4 成本计算

```typescript
const PRICING = {
  'claude-sonnet-4.5': { input: 0.003 / 1000, output: 0.015 / 1000 },
  'gpt-5':            { input: 0.005 / 1000, output: 0.015 / 1000 },
  'gpt-4o':           { input: 0.005 / 1000, output: 0.015 / 1000 },
  'deepseek-v3.2':    { input: 0.00027 / 1000, output: 0.0011 / 1000 },
  'gemini-2.0-flash': { input: 0.0001 / 1000, output: 0.0004 / 1000 },
};

function calculateCost(input: number, output: number, model: string): number {
  const p = PRICING[model];
  if (!p) return 0;
  return input * p.input + output * p.output;
}
```

---

## 三、接口设计规范

### 3.1 前端 API

```typescript
// MultiModelExecutor
export class MultiModelExecutor {
  constructor(config?: Partial<ExecutorConfig>);

  execute(req: BestOfNRequest, options?: ExecuteOptions): Promise<BestOfNResult>;
  cancel(taskId: string): void;
  retry(taskId: string, model: string): Promise<BestOfNCandidate>;

  on(event: BestOfNEventType, handler: BestOfNEventHandler): () => void;

  // 工具方法
  getAvailableModels(): ModelInfo[];
  estimateCost(prompt: string, models: string[]): CostEstimate;
}

// BestOfNPanel
export interface BestOfNPanelProps {
  initialPrompt?: string;
  initialModels?: string[];
  isOpen: boolean;
  onClose: () => void;
  onSelect?: (candidate: BestOfNCandidate) => void;
  onMerge?: (candidates: BestOfNCandidate[]) => void;
  apiBase?: string;
}
```

### 3.2 后端 API

```python
# backend/app/api/best_of_n.py

@router.post("/api/llm/best-of-n")
async def best_of_n(
    request: BestOfNRequest,
    user_id: str = Depends(get_current_user),
) -> BestOfNResponse:
    """启动 Best-of-N 多模型并行执行"""
    ...

@router.get("/api/llm/best-of-n/{task_id}/stream")
async def best_of_n_stream(task_id: str) -> StreamingResponse:
    """SSE 流式推送每个模型的结果"""
    ...

@router.post("/api/llm/best-of-n/{task_id}/cancel")
async def cancel_best_of_n(task_id: str) -> BestOfNResponse:
    """取消执行"""
    ...

@router.post("/api/llm/best-of-n/{task_id}/retry/{model}")
async def retry_model(task_id: str, model: str) -> BestOfNCandidate:
    """重试单个模型"""
    ...

@router.get("/api/llm/models")
async def list_models() -> ModelListResponse:
    """获取可用模型列表及定价"""
    ...
```

### 3.3 错误码

| 错误码 | 含义 |
|---|---|
| BN_INVALID_MODELS | 模型列表无效（< 2 或 > 5） |
| BN_MODEL_UNAVAILABLE | 模型暂不可用 |
| BN_PROMPT_TOO_LONG | prompt 超过模型限制 |
| BN_TIMEOUT | 总执行超时 |
| BN_RATE_LIMIT | 用户速率限制 |

---

## 四、数据结构定义

### 4.1 模型定义

```typescript
export interface ModelInfo {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'google' | 'deepseek' | 'custom';
  maxInputTokens: number;
  maxOutputTokens: number;
  pricing: {
    inputPer1k: number;  // 元 / 1k tokens
    outputPer1k: number;
  };
  capabilities: ('chat' | 'code' | 'vision' | 'function-call')[];
}
```

### 4.2 比较表

```typescript
export interface ComparisonRow {
  model: string;
  status: CandidateStatus;
  duration: number;
  outputTokens: number;
  cost: number;
  textLength: number;
  hasCode: boolean;
  hasMarkdown: boolean;
  score?: number; // 0-100
}
```

---

## 五、性能与安全要求

### 5.1 性能

| 指标 | 要求 |
|---|---|
| 模型启动延迟 | < 500ms |
| 流式 token 延迟 | < 300ms |
| 并发模型数 | ≤ 5 |
| 单模型超时 | 60s |
| 总超时 | 120s |
| Panel 渲染（N=5） | < 200ms |

### 5.2 安全

- **API Key 安全**：后端代理，前端不接触密钥
- **成本控制**：单用户每日 $5 上限
- **速率限制**：单用户 60s 内最多 5 个 Best-of-N 请求
- **审计日志**：所有 Best-of-N 请求记录到 audit log
- **内容过滤**：流式输出经过敏感词过滤

---

## 六、验收标准

### 6.1 功能验收

- [ ] N 个模型并行执行（N=2/3/4/5）
- [ ] 流式输出实时渲染
- [ ] 错误降级（单模型失败不影响其他）
- [ ] 超时控制（单模型 60s）
- [ ] 成本计算准确
- [ ] 模型选择：select / merge / retry / dismiss
- [ ] 取消：中途取消正在执行的请求

### 6.2 UI 验收

- [ ] 2-3 列网格自适应
- [ ] 每个候选独立进度条
- [ ] 比较表清晰展示
- [ ] 操作按钮响应 < 100ms
- [ ] 错误状态友好提示

### 6.3 测试验收

- [ ] 单元测试 ≥ 12 个
- [ ] 集成测试 ≥ 6 个
- [ ] E2E 断言 ≥ 8 个
- [ ] TypeScript 零错误
- [ ] 100% 测试通过

### 6.4 测试用例清单

#### 单元测试
1. MultiModelExecutor.execute 正确并行启动
2. 错误降级：单模型失败不影响其他
3. 超时：60s 后自动标记 failed
4. 取消：中途取消所有模型
5. 重试：仅 failed 状态可重试
6. 成本计算准确
7. 事件总线正确发出 start/delta/done/error
8. 流式 chunk 累积正确
9. 至少 2 个模型才能执行
10. 最多 5 个模型
11. 空 prompt 抛错
12. 不可用模型抛错

#### 集成测试
1. Panel 打开显示候选网格
2. 流式 token 实时渲染
3. 选择候选回调触发
4. 合并候选打开对话框
5. 重试单个候选
6. 取消所有候选

#### E2E 测试
1. 文件存在性
2. API 端点正确
3. SSE 流式推送
4. 状态机完整
5. 错误处理

---

## 七、风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| API 成本 | 高 | 限制每日上限 + 实时成本展示 |
| 网络抖动 | 中 | 重试 + 超时降级 |
| SSE 断连 | 中 | 自动重连（3 次） |
| 模型不一致 | 中 | prompt 标准化 |

---

**完成日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 进入 Phase 3 实现
