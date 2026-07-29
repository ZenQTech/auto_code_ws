# Cycle 14 P1-2 — Auto-Compaction 引擎

## 1. 背景

Codex v0.142 引入了**自动上下文压缩（Auto-Compaction）**：当会话上下文超过 token 阈值时，自动通过 7 阶段流水线压缩历史消息，保留关键决策点，丢弃冗余内容。本项目当前的 `compaction.py`（Cycle 2）+ `compaction_dual.py`（Cycle 3）只支持**手动触发**和**双触发**模式，缺乏：

- 自动化检测（需外部轮询调用）
- 智能分块（只能整段压缩）
- 7 阶段流水线（直接摘要，无质量验证）
- 冷热分层（不区分活跃/归档上下文）
- 增量压缩（每次都重新压缩整段）
- 压缩统计（无 metrics 看板）

## 2. 功能目标

构建 Auto-Compaction 引擎，作为 LLM 调度平台的**自动压缩子系统**，提供：

1. **自动检测**：在消息流入时自动评估 token 状态
2. **7 阶段流水线**：Plan → Analyze → Slice → Summarize → Merge → Verify → Compress
3. **冷热分层**：Hot tier（活跃上下文）+ Cold tier（归档摘要）
4. **增量压缩**：仅压缩新增消息，复用已有摘要
5. **多策略**：truncate / summarize / hybrid / semantic
6. **质量验证**：压缩后验证关键信息不丢失
7. **统计与监控**：压缩次数、节省 token、命中率

## 3. 技术实现方案

### 3.1 目录结构
```
backend/app/core/auto_compaction/
├── __init__.py            # 模块导出
├── models.py              # 数据模型：Tier、CompactionPlan、CompressionResult 等
├── detector.py            # 自动检测器（token/消息数/增长率）
├── planner.py             # Plan 阶段：决定哪些消息需要压缩、采用哪种策略
├── analyzer.py            # Analyze 阶段：消息重要性评分、关键信息提取
├── slicer.py              # Slice 阶段：分块（按 token / 时间 / 语义边界）
├── summarizer.py          # Summarize 阶段：调用 LLM 或本地摘要
├── merger.py              # Merge 阶段：合并多块摘要、去重
├── verifier.py            # Verify 阶段：验证关键信息不丢失
├── compressor.py          # Compress 阶段：写入冷热分层存储
├── pipeline.py            # 7 阶段流水线编排器
├── tiers.py               # 冷热分层管理
├── stats.py               # 统计与监控
└── engine.py              # Auto-Compaction 引擎主类

backend/app/api/auto_compaction.py  # REST API
```

### 3.2 7 阶段流水线

| 阶段 | 职责 | 输出 |
|------|------|------|
| **Plan** | 评估是否需要压缩、选择策略、设定目标 token 数 | `CompactionPlan` |
| **Analyze** | 对每条消息打分（重要性、关键性、时近性） | `MessageAnalysis[]` |
| **Slice** | 按重要性阈值把消息分成 keep / compact 两组 | `SliceResult` |
| **Summarize** | 对 compact 组逐块生成摘要 | `Summary[]` |
| **Merge** | 合并多块摘要，去重、整合、保留顺序 | `MergedSummary` |
| **Verify** | 检查摘要是否包含关键决策点 / 代码块 / 用户偏好 | `VerificationResult` |
| **Compress** | 写回会话：保留 keep 组 + 合并摘要（标记 cold tier） | `CompressionResult` |

### 3.3 冷热分层模型

```python
@dataclass
class CompactionTier:
    session_id: str
    hot: List[Message]          # 活跃上下文（最近 N 条）
    cold: List[ArchivedBlock]   # 归档摘要
    cold_index: Dict[str, List[int]]  # 关键词 -> 摘要 ID 索引
    created_at: str
    updated_at: str
```

### 3.4 增量压缩

- 每次压缩时仅处理"上次压缩点之后"的新增消息
- 已有 cold 摘要按需重新合并（lazy merge）
- L1 缓存：最近一次压缩的 plan 缓存

## 4. 接口设计

### 4.1 REST 端点（22 个）

#### 引擎控制
- `POST /api/auto-compaction/check` — 评估是否需要压缩
- `POST /api/auto-compaction/run` — 执行压缩
- `POST /api/auto-compaction/plan` — 仅生成压缩计划（不执行）
- `POST /api/auto-compaction/verify` — 验证压缩结果
- `POST /api/auto-compaction/rollback` — 回滚到压缩前状态

#### 会话分层管理
- `GET  /api/auto-compaction/sessions/{id}/tier` — 查询冷热分层
- `GET  /api/auto-compaction/sessions/{id}/hot` — 查询 hot tier
- `GET  /api/auto-compaction/sessions/{id}/cold` — 查询 cold tier
- `POST /api/auto-compaction/sessions/{id}/incremental` — 增量压缩
- `GET  /api/auto-compaction/sessions/{id}/search` — 关键词检索 cold tier

#### 配置
- `GET  /api/auto-compaction/config` — 全局配置
- `PUT  /api/auto-compaction/config` — 更新全局配置
- `GET  /api/auto-compaction/sessions/{id}/config` — 会话级配置
- `PUT  /api/auto-compaction/sessions/{id}/config` — 更新会话级配置

#### 流水线（高级）
- `POST /api/auto-compaction/pipeline/analyze` — 单阶段：Analyze
- `POST /api/auto-compaction/pipeline/summarize` — 单阶段：Summarize
- `POST /api/auto-compaction/pipeline/verify` — 单阶段：Verify

#### 统计
- `GET  /api/auto-compaction/stats` — 全局统计
- `GET  /api/auto-compaction/sessions/{id}/history` — 压缩历史
- `GET  /api/auto-compaction/sessions/{id}/savings` — 节省 token 统计
- `GET  /api/auto-compaction/health` — 健康检查

### 4.2 错误码
- `400` — 参数错误
- `404` — 会话不存在
- `409` — 状态冲突（如正在压缩）
- `422` — 验证失败（压缩质量不达标）
- `500` — 内部错误
- `503` — 服务未初始化

## 5. 数据结构

```python
# 配置
@dataclass
class AutoCompactionConfig:
    enabled: bool
    max_tokens: int             # 触发压缩的 token 阈值
    max_messages: int           # 触发压缩的消息数阈值
    target_tokens: int          # 压缩后目标 token 数
    keep_recent: int            # hot tier 保留消息数
    strategy: str               # truncate | summarize | hybrid | semantic
    importance_threshold: float # 重要性阈值（0-1）
    verification_required: bool # 是否必须通过验证
    auto_trigger: bool         # 是否自动触发

# Plan
@dataclass
class CompactionPlan:
    session_id: str
    strategy: str
    blocks_to_compact: List[List[int]]  # 消息索引分组
    messages_to_keep: List[int]
    estimated_before_tokens: int
    estimated_after_tokens: int
    confidence: float

# 重要性
@dataclass
class MessageImportance:
    index: int
    role: str
    score: float          # 0-1
    factors: Dict[str, float]  # recency, keywords, length, decisions
    decision_keywords: List[str]

# 分块
@dataclass
class CompactionBlock:
    block_id: str
    message_indices: List[int]
    tokens: int
    summary: str
    key_points: List[str]
    created_at: str

# 分层
@dataclass
class CompactionTier:
    session_id: str
    hot: List[Dict[str, Any]]
    cold: List[CompactionBlock]
    cold_index: Dict[str, List[str]]  # keyword -> block_ids
    total_hot_tokens: int
    total_cold_tokens: int
    last_compaction_at: str

# 结果
@dataclass
class CompressionResult:
    session_id: str
    success: bool
    plan: CompactionPlan
    before_tokens: int
    after_tokens: int
    saved_tokens: int
    saved_ratio: float
    blocks: List[CompactionBlock]
    verification: Optional[Dict[str, Any]]
    duration_ms: int
    error: Optional[str]
```

## 6. 性能与安全

### 性能
- 单次压缩 P95 < 500ms（10k tokens 输入）
- 增量压缩 P95 < 200ms
- 检索 cold tier P95 < 50ms
- 流水线阶段并发执行（Analyze/Summarize/Verify 可并行）

### 安全
- 路径白名单（HERMES_STORAGE_DIR 限制）
- 线程安全（RLock）
- 状态机互斥（同一会话不能并发压缩）
- 压缩失败自动回滚
- 关键信息强制保留（如 "## 关键决策"、"### 用户偏好"）

## 7. 验收标准

### 功能验收
- [x] 7 阶段流水线全部实现
- [x] 自动检测 token / 消息数触发
- [x] 冷热分层存储 + 关键词索引
- [x] 增量压缩（仅处理新增消息）
- [x] 4 种策略（truncate/summarize/hybrid/semantic）
- [x] 关键信息保留验证
- [x] 22 REST 端点全部可调用
- [x] 压缩历史与节省统计

### 测试验收
- [x] 单元测试 ≥ 90 个，覆盖所有模块
- [x] E2E 测试 ≥ 50 个，覆盖所有端点
- [x] 测试通过率 100%
- [x] 边界条件：空会话、巨型会话（1000+ 消息）、纯系统消息、含代码块会话

### 质量验收
- [x] 完整中文注释
- [x] 文件头注释
- [x] 函数注释
- [x] 关键算法复杂度分析
- [x] 异常处理 + 边界处理
- [x] 路径白名单
- [x] 线程安全
