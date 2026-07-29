# Cycle 15 调研报告

> **版本**: v1.0.0  
> **日期**: 2026-07-29  
> **目标**: Goal Manager 双向同步 + 多 Goal 并发隔离 + LLM 成本精细化 + Judge 共识

---

## 1. 多 Agent 状态同步模式

### 1.1 核心模式（基于 2026-03 调研）

**引用**: [Optimizing Distributed State Management for High Performance Multi-Agent Orchestration Systems (2026-03-27)](https://martinuke0.github.io/posts/2026-03-27-optimizing-distributed-state-management-for-high-performance-multi-agent-orchestration-systems/)

| 模式 | 描述 | 优势 | 适用场景 |
|---|---|---|---|
| **Event Sourcing** | 存储不可变事件，状态由事件重放重建 | 审计历史、回放调试、冲突解决 | 关键决策审计、状态可重建 |
| **Versioned Immutable State** | 每次写入产生新版本 | 简化并发、乐观读 | 高并发读多写少 |
| **Hybrid Consistency** | 强一致（关键数据）+ 最终一致（缓存） | 平衡一致性与可用性 | Goal Manager + Agent 状态 |

### 1.2 8 大协调模式（2026 实战）

**引用**: [Multi-Agent Architecture: 8 Coordination Patterns That Actually Work (2026-01-28)](https://tacnode.io/post/multi-agent-architecture)

1. **Shared Context, Not Shared State** - 单一权威上下文层
2. **Event-Driven Handoffs** - 事件驱动交接
3. **Semantic Contracts** - 语义契约
4. **Single-Writer Principle** - 单写者原则
5. **Real-Time Feature Serving** - 实时特征服务
6. **Conflict Detection** - 冲突检测
7. **Network Observability** - 网络可观测性
8. **Checkpoint Management** - 检查点管理

### 1.3 Hermes 平台应用

**Goal Manager 双向同步设计**:
- **采用模式**: Event Sourcing + Single-Writer
- **核心机制**:
  - AutoTurnEngine 是单写者（只能写 AC 状态）
  - GoalManager 是源数据所有者
  - 通过事件总线同步：AutoTurn → 事件 → GoalManager
  - 冲突解决：最后写入获胜（带时间戳）
  - 状态版本号：每次状态变更增加版本号

---

## 2. LLM 成本精细化追踪

### 2.1 Per-Run Attribution Ledger（2026 行业标准）

**引用**: [LLM Cost Tracking: The Real Cost of an LLM API Call, Per Run (2026-06-20)](https://balacode.io/blog/llm-cost-tracking-per-run-attribution-model)

**关键模式**:
- 每次 LLM 调用 = 1 条 ledger 记录
- 字段：tenant × project × model × user × feature × agent_run
- 7 个计费组件：input cache miss、cache read、cache write、output tokens、reasoning tokens、tool tokens、image inputs

### 2.2 多维归因模型

**引用**: [LLM Cost Attribution: Track AI Spend Per User, Feature, and Tenant (2026-06-15)](https://www.metacto.com/blogs/llm-cost-attribution-per-user-feature)

**6 大归因维度**:
1. **Per user** - 终端用户级
2. **Per feature** - 产品功能级
3. **Per tenant / customer** - 多租户
4. **Per model and per route** - 模型/路由
5. **Per agent run / workflow** - Agent 任务级
6. **Per layer** - prompt / tool / response 分层

### 2.3 Hermes 平台应用

**LLM Cost Tracker 设计**:
- **数据模型**: LLMCallRecord（含 7 计费组件字段）
- **存储**: JSONL 持久化 + 内存索引
- **维度**: user_id / project_id / agent_id / model / route / feature
- **API**: 12 个端点（CRUD + 统计 + 告警 + 预算）
- **前端**: 4 Tab 面板（总览 / 用户 / 项目 / 告警）

---

## 3. LLM-as-Judge 共识机制

### 3.1 多 Judge 共识（已有基础）

**当前实现**: [Cycle 13 P0-3 LLM-as-Judge 验证层 (v6.22.0)](CYCLE14_SUMMARY.md)
- 5 维度评分
- 多 Judge 共识
- Safety 一票否决
- Mock/Claude/GPT/Gemini Adapter

### 3.2 改进方向

**共识策略升级**:
1. **加权投票** - 每个 Judge 权重可配置
2. **一致性检验** - 跨 Judge 一致性指标
3. **置信度分数** - 输出每个维度的置信区间
4. **分批评估** - 大任务分片并行评估
5. **回退策略** - Judge 失败时降级到单 Judge

### 3.3 Hermes 平台应用

**Judge Consensus v2 设计**:
- 新增 ConsensusStrategy 枚举（unanimous / majority / weighted / first_valid）
- 新增 Judge 权重配置
- 新增一致性指标（stddev / min_max_diff）
- 12 单元测试覆盖

---

## 4. 多 Goal 并发隔离

### 4.1 资源隔离模式

**核心设计**:
- **资源配额**: CPU/Memory/Token Rate per Goal
- **优先级队列**: 高优先级 Goal 优先
- **公平调度**: 防止单一 Goal 占用全部资源
- **优雅降级**: 资源不足时降级到低优先级

### 4.2 Hermes 平台应用

**Goal Resource Quota 设计**:
- 新增 `ResourceQuota` 数据类（max_tokens / max_turns / max_concurrent）
- 新增 `GoalScheduler` 调度器（FIFO + 优先级）
- 集成到 AutoTurnEngine
- 12 单元测试 + 8 E2E 测试

---

## 5. 总结

| 主题 | 关键技术 | Hermes 实现优先级 |
|---|---|---|
| 状态同步 | Event Sourcing + Single-Writer | P0-1 极高 |
| 资源隔离 | 配额 + 优先级队列 | P0-2 高 |
| 成本追踪 | Per-Run Attribution Ledger | P1-2 中 |
| Judge 共识 | 加权投票 + 一致性 | P1-3 中 |

**Cycle 15 计划交付**:
- 4 个新功能模块
- ~50 个新 REST 端点
- ~100 个新单元测试 + 50 E2E 测试
- 文档更新 + 总结报告

---

**参考来源**:
- [Optimizing Distributed State Management for High Performance Multi-Agent Orchestration Systems](https://martinuke0.github.io/posts/2026-03-27-optimizing-distributed-state-management-for-high-performance-multi-agent-orchestration-systems/)
- [Multi-Agent Architecture: 8 Coordination Patterns That Actually Work [2026]](https://tacnode.io/post/multi-agent-architecture)
- [Distributed Memory for Multi-Agent Systems: Sharing State Across Agent Instances](https://www.callsphere.ai/blog/distributed-memory-multi-agent-systems-sharing-state-across-instances)
- [Designing scalable state management for long-running multi-agent workflows in distributed computing environments](https://eonsr.com/en/designing-scalable-state-management-for-long-running-multi-agent-workflows-in-distributed-computing-environments/)
- [LLM Cost Tracking: The Real Cost of an LLM API Call, Per Run](https://balacode.io/blog/llm-cost-tracking-per-run-attribution-model)
- [LLM Cost Attribution: Track AI Spend Per User, Feature, and Tenant](https://www.metacto.com/blogs/llm-cost-attribution-per-user-feature)
- [Advanced Orchestration Patterns for Production AI Agent Systems](https://github.com/enuno/claude-command-and-control/blob/main/docs/best-practices/17-Advanced-Orchestration-Patterns.md)
