# Cycle 13 P0-3 LLM-as-Judge 验证层 - Spec

## 一、功能需求描述

### 1.1 目标
为 Hermes 增加 LLM-as-Judge 语义验证层，作为 P1-10 Verification Loop 的第 5 维度，在语法/单元测试/集成测试/性能基线之上，对代码修改进行语义正确性评估。

### 1.2 用户场景
- **场景 1**：代码修改完成后，自动调用 Judge 模型对 diff 进行多维度评分
- **场景 2**：与 Verification Loop 集成，作为新的 LLMJudgeVerifier
- **场景 3**：手动提交任务进行 LLM 评分（如代码审查、设计评审）
- **场景 4**：多 Judge 模型共识评分
- **场景 5**：Safety 一票否决（任意 Judge 给出 safety < 6 则整体失败）

### 1.3 使用流程
1. 用户提交 Judge 任务（包含 task_description、code_diff、test_results、context）
2. Judge Pool 选择 1-3 个 Judge 模型
3. 每个 Judge 模型根据 Prompt 模板生成评分（5 维度 + 总体判定）
4. Consensus 模块聚合多 Judge 结果
5. 触发 Safety 一票否决检查
6. 生成 Judge Report（包含 issues / suggestions / scores）
7. 持久化到 JudgeStore，可通过 /api/llm-judge/judge/{id} 查询

## 二、技术实现方案

### 2.1 技术选型
- **后端**：Python 3.10 + FastAPI + Pydantic
- **存储**：内存存储（线程安全 RLock），预留 JSONL 持久化接口
- **LLM 抽象**：JudgeAdapter 接口，支持 Mock/Claude/GPT/Gemini 等适配器
- **并发**：单 Judge 串行，多 Judge 并行（线程池）
- **集成**：与 P1-10 VerificationLoop 解耦，通过 Verifier 接口集成

### 2.2 架构设计

```
LLM-as-Judge 验证层
├── models.py          # 数据模型（JudgeTask, JudgeScore, JudgeReport, JudgePool, JudgeConsensus）
├── prompts.py         # 5 维度 Prompt 模板（Handlebars 风格变量替换）
├── adapters.py        # Judge Adapter 抽象基类 + Mock/Claude/GPT/Gemini 实现
├── pool.py            # Judge 模型池（注册、选择、权重管理）
├── consensus.py       # 多 Judge 共识（投票/平均/分歧检测）
├── verifier.py        # LLMJudgeVerifier（与 P1-10 集成）
├── store.py           # Judge 任务存储（内存+JSONL 持久化）
├── engine.py          # Judge 引擎（编排整个评分流程）
└── api.py             # REST API 端点
```

### 2.3 核心算法

#### 2.3.1 多 Judge 共识算法
```python
def consensus(scores: List[JudgeScore], threshold: float = 3.0) -> JudgeConsensus:
    # 1. 每个维度计算加权平均（score * weight）
    # 2. 计算维度间分歧（max - min）
    # 3. 如果任一维度分歧 > threshold，标记需要重审
    # 4. Safety < 6 → 一票否决
    # 5. overall_pass = (weighted_avg >= 6) AND (safety >= 6) AND (consensus)
    # 6. 合并所有 issues 和 suggestions（去重）
    return JudgeConsensus(...)
```

#### 2.3.2 Judge 模型选择
```python
def select_judges(task: JudgeTask, pool: JudgePool) -> List[Judge]:
    # 1. 根据 task.difficulty 选简单/复杂 Judge
    # 2. 根据 task.domain 选对应领域 Judge
    # 3. 至少选择 1 个，最多 3 个
    # 4. 主 Judge 权重 1.0，备 Judge 权重 0.6-0.8
    return selected_judges
```

## 三、接口设计规范

### 3.1 REST API

| 端点 | 方法 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
| `/api/llm-judge/health` | GET | 健康检查 | - | `{success, service, version, stats, features}` |
| `/api/llm-judge/judge` | POST | 提交评分任务 | `JudgeRequest` | `{success, task_id, status, message}` |
| `/api/llm-judge/judge/{id}` | GET | 获取评分结果 | - | `{success, task, report}` |
| `/api/llm-judge/judge/{id}/report` | GET | 详细评分报告 | - | `{success, report, markdown}` |
| `/api/llm-judge/tasks` | GET | 列出所有任务 | - | `{success, total, tasks}` |
| `/api/llm-judge/pool` | GET | Judge 模型池 | - | `{success, pool, judges}` |
| `/api/llm-judge/pool` | POST | 注册 Judge | `RegisterJudgeRequest` | `{success, judge, message}` |
| `/api/llm-judge/pool/{id}` | DELETE | 注销 Judge | - | `{success, message}` |
| `/api/llm-judge/consensus` | POST | 多 Judge 共识评分 | `ConsensusRequest` | `{success, consensus}` |
| `/api/llm-judge/stats` | GET | 统计信息 | - | `{success, stats}` |
| `/api/llm-judge/verify` | POST | 与 P1-10 集成 | `IntegrationRequest` | `{success, verified, score}` |

### 3.2 Pydantic 模型

```python
class JudgeRequest(BaseModel):
    task_description: str = Field(..., description="任务描述")
    code_diff: str = Field("", description="代码差异")
    test_results: str = Field("", description="测试结果")
    context: Dict[str, Any] = Field(default_factory=dict)
    rubric: List[str] = Field(default_factory=list, description="评分维度")
    difficulty: str = Field("medium", description="难度: easy/medium/hard")
    domain: str = Field("general", description="领域")
    use_consensus: bool = Field(True, description="是否多 Judge 共识")
    metadata: Dict[str, Any] = Field(default_factory=dict)


class JudgeScore(BaseModel):
    correctness: int = Field(0, ge=0, le=10)
    style: int = Field(0, ge=0, le=10)
    safety: int = Field(0, ge=0, le=10)
    performance: int = Field(0, ge=0, le=10)
    maintainability: int = Field(0, ge=0, le=10)


class JudgeReport(BaseModel):
    task_id: str
    scores: JudgeScore
    overall_pass: bool
    overall_score: float
    issues: List[str]
    suggestions: List[str]
    judge_id: str
    judge_name: str
    model: str
    latency_ms: int
    created_at: str
    raw_response: str = ""
```

### 3.3 错误码

| 错误码 | HTTP | 描述 |
|--------|------|------|
| `JUDGE_TASK_NOT_FOUND` | 404 | 任务不存在 |
| `JUDGE_POOL_EMPTY` | 400 | Judge 池为空 |
| `JUDGE_INVALID_RUBRIC` | 400 | 无效评分维度 |
| `JUDGE_ADAPTER_ERROR` | 500 | 适配器执行错误 |
| `JUDGE_CONSENSUS_FAILED` | 400 | 共识失败 |
| `JUDGE_SAFETY_VETO` | 400 | Safety 一票否决 |

## 四、数据结构定义

### 4.1 核心数据模型

```python
@dataclass
class JudgeTask:
    task_id: str
    task_description: str
    code_diff: str
    test_results: str
    context: Dict[str, Any]
    rubric: List[str]
    difficulty: str
    domain: str
    use_consensus: bool
    metadata: Dict[str, Any]
    status: JudgeTaskStatus  # PENDING / RUNNING / COMPLETED / FAILED / VETOED
    created_at: str
    completed_at: str
    error: str
    reports: List[JudgeReport]
    consensus: Optional[JudgeConsensus]


@dataclass
class Judge:
    judge_id: str
    name: str
    model: str
    weight: float
    adapter: str  # "mock" / "claude" / "gpt" / "gemini"
    enabled: bool
    specialties: List[str]  # ["code", "security", "style"]
    metadata: Dict[str, Any]


@dataclass
class JudgeConsensus:
    consensus_id: str
    task_id: str
    aggregated_scores: JudgeScore
    overall_pass: bool
    overall_score: float
    divergence: Dict[str, float]  # 维度分歧度
    needs_review: bool
    safety_veto: bool
    judge_count: int
    reports: List[JudgeReport]
    consensus_strategy: str  # "weighted_average"
    created_at: str
```

### 4.2 存储结构

```python
# 内存存储（线程安全）
class JudgeStore:
    _tasks: Dict[str, JudgeTask]
    _judges: Dict[str, Judge]
    _lock: threading.RLock
    
    # 持久化
    store_dir: Path  # ~/.hermes/judge/
    index_file: Path  # index.jsonl
```

## 五、性能与安全要求

### 5.1 性能指标
- 单 Judge 评分延迟：< 200ms (Mock) / < 30s (真实 LLM)
- 多 Judge 并行：3 个 Judge 总耗时 ≤ max(单 Judge) + 100ms
- 任务存储：支持 10,000+ 任务
- 健康检查：< 50ms

### 5.2 安全要求
- **路径白名单**：仅允许 /home/qizheng/auto_code_data, /home/qizheng/auto_code_ws, /tmp/judge_test_*
- **API Key 校验**：Bearer Token 格式
- **输入长度限制**：task_description ≤ 50KB, code_diff ≤ 1MB
- **Safety 一票否决**：任意 Judge 给出 safety < 6 则整体 VETOED
- **超时控制**：单 Judge 超时 30s（可配置）
- **错误隔离**：单个 Judge 失败不影响其他 Judge
- **敏感信息过滤**：避免在日志中输出 prompt 完整内容

## 六、验收标准

### 6.1 功能验收
- [ ] 5 维度评分（correctness/style/safety/performance/maintainability）
- [ ] 3+ Judge 模型（mock/claude/gpt）
- [ ] Judge 模型池注册/注销
- [ ] 多 Judge 共识机制
- [ ] Safety 一票否决
- [ ] 分歧度检测（> threshold 触发重审）
- [ ] 与 P1-10 VerificationLoop 集成接口
- [ ] Handlebars 风格 Prompt 模板
- [ ] 11+ REST 端点
- [ ] 任务生命周期（PENDING/RUNNING/COMPLETED/FAILED/VETOED）

### 6.2 性能验收
- [ ] 单元测试 50+ 个，100% 通过
- [ ] E2E 测试 20+ 断言，100% 通过
- [ ] Mock Judge 评分 < 100ms
- [ ] 并发安全（多线程 RLock 保护）

### 6.3 集成验收
- [ ] 与 P1-10 VerificationLoop 集成（提供 LLMJudgeVerifier 适配）
- [ ] 可被 VerificationLoop 调用作为第 5 维度
- [ ] 评分结果可被 quality_assurance_agent 消费

### 6.4 测试项目

#### 6.4.1 脚本自动测试
| 测试文件 | 范围 | 用例数 |
|---------|------|--------|
| `tests/test_llm_judge_units.py` | 数据模型/Prompt/Adapter/Pool/Consensus/Verifier/Store/Engine 单元测试 | 50+ |
| `tests/test_e2e_llm_judge.sh` | REST API E2E 端到端测试 | 20+ 断言 |

#### 6.4.2 前端网页测试（手动）
- [ ] Judge 报告页面（5 维度评分雷达图）
- [ ] Judge 任务提交表单
- [ ] Judge 模型池管理页面
- [ ] 共识结果展示页面
- [ ] 集成到 VerificationLoop 报告页

#### 6.4.3 测试通过标准
- 单元测试：100% 通过
- E2E 测试：100% 通过
- 边界条件：覆盖 None/空字符串/超长/并发/异常
- 错误恢复：Judge 失败不影响整体流程
