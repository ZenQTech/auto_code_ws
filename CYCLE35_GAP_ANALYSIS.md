# CYCLE 35 差距分析报告

> **周期**: Cycle 35
> **主题**: Multi-Agent 协作 + 任务编排
> **日期**: 2026-07-31
> **作者**: Hermes AI Engineering
> **基础**: 基于 CYCLE35_CODEX_TRAE_RESEARCH.md 调研报告

---

## 一、现状概述

### 1.1 Hermes 平台现有能力

经过 30+ 个周期的迭代，Hermes 平台已积累 183 个 utils 文件，涵盖大量 Agent / Workflow / Scheduling 相关能力。以下是与 Cycle 35 直接相关的现有引擎：

| 现有引擎 | 行数 | 创建周期 | 核心能力 |
|----------|------|----------|----------|
| `agentCheckpointEngine.ts` | 397 | Cycle 27 G27-02 | 代理树状态保存/恢复 |
| `agentMessagingEngine.ts` | 433 | Cycle 27 G27-04 | 代理消息协议 + Followup 任务 |
| `orchestratedAgentEngine.ts` | 1243 | Cycle 30 G30-03 | 6 阶段 Orchestrated Mode + 角色预设 |
| `dynamicWorkflowEngine.ts` | 1188 | Cycle 30 G30-02 | Phase-based 工作流 + Journal + Resume |
| `workflowStateMachine.ts` | 197 | 早期 | 基础状态机 |
| `backgroundTaskEngine.ts` | - | 早期 | 后台任务执行 |
| `costThresholdAlertEngine.ts` | - | Cycle 30 G30-01 | 成本告警（与调度相关） |
| `multiTaskOrchestrator.ts` | - | Cycle 24 | 多任务并行 |
| `bestOfNCoordinator.ts` | - | 早期 | Best-of-N 协调 |

### 1.2 现有能力的优势

1. **完整的 Phase 编排模型**：`dynamicWorkflowEngine` 已实现 Phase-based 工作流 + Journal 持久化 + Resume/Replay；
2. **多角色协作**：`orchestratedAgentEngine` 实现 5 种角色（orchestrator/worker/explorer/reviewer/synthesizer）；
3. **基础消息系统**：`agentMessagingEngine` 已支持 Agent 消息 + Followup 任务调度；
4. **代理树快照**：`agentCheckpointEngine` 已实现完整代理树序列化/反序列化；
5. **多任务并行**：`multiTaskOrchestrator` + `bestOfNCoordinator` 提供并行执行能力。

### 1.3 现有能力的局限

虽然已有相关引擎，但在 **DAG 编排、A2A 协议、Time Travel、WFQ 调度** 四个方向上仍有显著差距。

---

## 二、详细差距分析

### 2.1 G35-01: WorkflowOrchestratorEngine（工作流编排引擎）

#### 现有能力（dynamicWorkflowEngine）
- ✅ Phase-based 编排（init / data-fetch / llm-call / tool / verify / aggregate / output）
- ✅ 依赖关系 + 并行组（fan-out）
- ✅ Journal 持久化 + Resume/Replay
- ✅ 高阶模板（fan-out / verify / aggregate）

#### 差距识别

| 差距 | 现有实现 | Cycle 35 目标 |
|------|----------|---------------|
| **DAG 抽象** | 仅有 Phase 列表 + 依赖 | 完整 DAG（节点 + 边 + 条件边） |
| **条件分支** | 不支持条件分支（仅有 if-then-else 模板） | 完整条件边（运行时决定下一节点） |
| **并行节点** | 通过 fan-out 模板实现 | 任意节点可声明并行 + 自动汇聚 |
| **嵌套子图** | 不支持 | Subgraph 嵌套（多层组合） |
| **可视化执行** | 无 | 实时 DAG 视图（节点状态着色） |
| **节点类型丰富度** | 7 种 Phase 类型 | 6 大类（LLM / Tool / Code / Condition / Parallel / Subgraph） |
| **动态节点注入** | 静态工作流定义 | 运行时动态添加节点（Hot-reload） |
| **持久化粒度** | Journal 增量 | 双层（State 完整快照 + Event 增量） |

#### 价值评估
- **重要性**: ⭐⭐⭐⭐⭐（高）
- **紧迫性**: ⭐⭐⭐⭐（高）
- **依赖性**: G35-02 / G35-03 / G35-04 都依赖 Workflow 实例管理

---

### 2.2 G35-02: AgentCommunicationEngine（智能体通信引擎）

#### 现有能力（agentMessagingEngine）
- ✅ Agent-to-Agent 消息发送
- ✅ Followup 任务调度
- ✅ 路径解析 + 任务执行
- ✅ 消息状态管理

#### 差距识别

| 差距 | 现有实现 | Cycle 35 目标 |
|------|----------|---------------|
| **A2A 协议** | 简化消息格式 | 完整 A2A 子集（Agent Card + JSON-RPC） |
| **消息路由** | 直接消息 | 路由表（点对点 / 广播 / 多播 / 订阅） |
| **优先级队列** | 简单 FIFO | 优先级队列（高优先级插队） |
| **通信历史** | 简单历史 | 可查询 / 可回放（Time-series） |
| **鉴权加密** | 无 | 简化 OAuth / 签名验证 |
| **消息主题** | 无 | Pub/Sub 主题订阅 |
| **请求-响应** | 异步消息 | 同步 RPC + 异步事件双模式 |
| **消息重试** | 无 | 指数退避 + 死信队列 |

#### 价值评估
- **重要性**: ⭐⭐⭐⭐（中高）
- **紧迫性**: ⭐⭐⭐（中）
- **依赖性**: 独立引擎，可被其他引擎调用

---

### 2.3 G35-03: TaskCheckpointEngine（任务检查点引擎）

#### 现有能力（agentCheckpointEngine）
- ✅ 代理树完整快照（save / restore）
- ✅ 检查点管理（list / delete / 自动清理）
- ✅ 序列化 + 反序列化
- ✅ 元数据 + 大小计算

#### 差距识别

| 差距 | 现有实现 | Cycle 35 目标 |
|------|----------|---------------|
| **Time Travel** | 仅恢复 latest | 跳转到任意历史版本 |
| **版本管理** | 无 | Version / Branch / Tag |
| **Diff 对比** | 无 | 两版本差异可视化 |
| **增量快照** | 完整快照 | 混合（完整 + 增量） |
| **多线程隔离** | 单根节点 | Thread-based isolation（thread_id） |
| **自动检查点策略** | 手动保存 | 触发式（时间 / 步骤数 / 状态变更） |
| **压缩存储** | 无 | lz-string 压缩 + IndexedDB |
| **跨引擎统一** | 单一引擎 | 统一接口（任何引擎都可注册检查点） |

#### 价值评估
- **重要性**: ⭐⭐⭐⭐（中高）
- **紧迫性**: ⭐⭐⭐（中）
- **依赖性**: 被 G35-01 / G35-04 依赖

---

### 2.4 G35-04: AgentSchedulerEngine（智能体调度引擎）

#### 现有能力（分散在多个引擎中）
- ✅ `costThresholdAlertEngine`：成本感知（与调度相关）
- ✅ `multiTaskOrchestrator`：多任务并行
- ✅ `bestOfNCoordinator`：Best-of-N 调度
- ✅ `backgroundTaskEngine`：后台任务

#### 差距识别

| 差距 | 现有实现 | Cycle 35 目标 |
|------|----------|---------------|
| **统一调度器** | 各引擎自带调度 | 统一调度器（被其他引擎调用） |
| **WFQ 公平队列** | 无 | 加权公平队列（多 Agent 公平分享） |
| **MLFQ 多级反馈** | 无 | 多级反馈队列（防止 starvation） |
| **资源感知** | 仅成本感知 | GPU / 内存 / Token / 优先级 综合 |
| **抢占策略** | 无 | Preemptive / Cooperative 可配置 |
| **调度性能分析** | 无 | p50 / p95 / p99 延迟统计 |
| **可视化调度** | 无 | 甘特图 + 队列长度实时 |
| **弹性策略** | 部分（降级） | 超时降级 + 失败重试 + 配额管理 |

#### 价值评估
- **重要性**: ⭐⭐⭐⭐⭐（高）
- **紧迫性**: ⭐⭐⭐⭐（高）
- **依赖性**: 核心引擎，所有 Workflow / Agent 都可受益

---

## 三、用户场景差距

### 3.1 场景 1：长任务断点续传

**用户故事**:
> 用户在 iPad 上启动一个 2 小时的代码生成任务，执行到 1.5 小时时切换到 Macbook，要求从断点继续。

**现有能力**:
- ✅ `agentCheckpointEngine` 可保存/恢复代理树
- ❌ 切换设备时需手动复制检查点
- ❌ 无 Time Travel 跳转到任意历史
- ❌ 无增量同步

**Cycle 35 目标**:
- ✅ 统一检查点（不依赖具体引擎）
- ✅ 跨设备同步（基于已有的 `offlineFirstEngine`）
- ✅ Time Travel 到任意历史版本
- ✅ 增量快照（节省带宽）

### 3.2 场景 2：多 Agent 并行协作

**用户故事**:
> 用户启动一个"代码审查"工作流，需要 3 个 Agent 并行（安全性、性能、风格），审查完成后自动聚合报告。

**现有能力**:
- ✅ `dynamicWorkflowEngine` 有 fan-out / aggregate 模板
- ❌ 仅有模板，不支持动态 DAG
- ❌ 无可视化 DAG 编辑/查看
- ❌ 条件分支不完善

**Cycle 35 目标**:
- ✅ 完整 DAG（任意节点并行）
- ✅ 实时可视化（节点状态着色）
- ✅ 条件边（运行时决定）
- ✅ 嵌套子图（模块化复用）

### 3.3 场景 3：Agent 间标准化通信

**用户故事**:
> 用户希望不同供应商的 Agent（Claude / GPT / Gemini）能通过统一协议通信，无需关心具体实现。

**现有能力**:
- ✅ `agentMessagingEngine` 支持消息
- ❌ 无 Agent Card 描述（能力发现）
- ❌ 无优先级 / 主题
- ❌ 无 Pub/Sub

**Cycle 35 目标**:
- ✅ Agent Card（标准化能力描述）
- ✅ 优先级队列 + 主题订阅
- ✅ 简化 A2A 协议子集

### 3.4 场景 4：资源感知的智能调度

**用户故事**:
> 用户同时提交 100 个任务，要求按优先级 + 资源约束 + 公平性智能调度，避免某 Agent 独占。

**现有能力**:
- ✅ `costThresholdAlertEngine` 提供成本告警
- ❌ 无统一调度器
- ❌ 无 WFQ 公平队列
- ❌ 无调度性能分析

**Cycle 35 目标**:
- ✅ 统一 AgentScheduler
- ✅ WFQ + 优先级混合
- ✅ 资源感知 + 抢占策略
- ✅ 调度可视化 + 性能分析

---

## 四、目标架构图

```
                    ┌────────────────────────────┐
                    │      User Interface         │
                    │  (4 大 UI 面板 + 入口菜单)  │
                    └──────────┬─────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│  Workflow      │    │  Agent         │    │  Agent         │
│  Orchestrator  │◄──►│  Communication │◄──►│  Scheduler     │
│  (DAG-based)   │    │  (A2A subset)  │    │  (WFQ+MLFQ)    │
└────────┬───────┘    └────────┬───────┘    └────────┬───────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Task Checkpoint     │
                    │  (Time Travel)       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Storage Layer       │
                    │  (IndexedDB + LZ)    │
                    └─────────────────────┘
```

**4 大引擎协同**:
- **WorkflowOrchestrator**: 负责 DAG 定义与执行，向 Scheduler 申请资源
- **AgentCommunication**: 负责 Agent 间消息传递，被 Workflow 调用
- **TaskCheckpoint**: 负责状态持久化，被所有引擎调用
- **AgentScheduler**: 负责资源分配与任务调度，被所有引擎调用

---

## 五、技术选型建议

### 5.1 G35-01 WorkflowOrchestratorEngine
- **DAG 库**: 不引入外部库（DAG 节点 + 边结构简单，自行实现）
- **状态机**: 复用现有 `workflowStateMachine`
- **持久化**: 复用 `dynamicWorkflowEngine` 的 Journal 模式
- **可视化**: 使用 SVG（轻量，无需引入 React Flow）

### 5.2 G35-02 AgentCommunicationEngine
- **协议**: 简化 A2A（Agent Card + JSON-RPC 2.0）
- **Pub/Sub**: 自实现（基于 EventEmitter）
- **优先级队列**: 自实现 Binary Heap
- **鉴权**: 简化 HMAC 签名

### 5.3 G35-03 TaskCheckpointEngine
- **持久化**: IndexedDB + lz-string 压缩
- **序列化**: 复用现有 `agentCheckpointEngine` 序列化逻辑
- **版本管理**: 自实现 Version / Branch / Tag
- **Diff 算法**: 自实现（基于 JSON diff 简化版）

### 5.4 G35-04 AgentSchedulerEngine
- **调度算法**: 自实现 WFQ + MLFQ + Priority Queue
- **资源模型**: 抽象 ResourceDeclaration（GPU / Memory / Token）
- **可视化**: 甘特图自实现（SVG）
- **性能分析**: 自实现 p50/p95/p99 统计

---

## 六、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| DAG 复杂度 | 中 | 仅实现核心功能（不实现循环依赖检测等高级特性） |
| A2A 协议兼容性 | 低 | 仅实现子集，标注非完整实现 |
| IndexedDB 容量 | 中 | 限制检查点数量 + 自动清理 |
| 调度器性能 | 中 | 限制并发数 + 队列大小 |
| 跨引擎协同 | 中 | 严格定义接口 + 单元测试 |
| 时间预估偏差 | 高 | 8-11 天可能延期 1-2 天 |

---

## 七、度量标准

### 7.1 代码量目标
- 4 大引擎: ~3000 行（每个 ~750 行）
- 4 份 SPEC: ~800 行
- 单元测试: ~280 个（每个引擎 ~70）
- E2E 测试: ~20 个
- 4 大 UI 面板: ~1100 行
- 文档: ~1000 行

### 7.2 质量目标
- TypeScript 编译: 0 errors
- 单元测试通过率: 100%
- E2E 测试通过率: 100%
- 测试覆盖率: > 80%

### 7.3 集成目标
- 与现有 `dynamicWorkflowEngine` / `orchestratedAgentEngine` / `agentMessagingEngine` 协同
- 与 `costThresholdAlertEngine` 资源感知
- 与 `offlineFirstEngine` 检查点同步
- 主应用集成（App / AppLayout / BrandHeader）

---

## 八、行动建议

### 8.1 推荐方案
- **不替换现有引擎**，而是补充 + 增强
- **新引擎作为统一抽象层**，被现有引擎调用
- **避免破坏性变更**，保持向后兼容

### 8.2 优先级排序
1. **G35-01 WorkflowOrchestratorEngine** (P0, 最高价值)
2. **G35-04 AgentSchedulerEngine** (P0, 资源调度基础)
3. **G35-02 AgentCommunicationEngine** (P0, 通信标准化)
4. **G35-03 TaskCheckpointEngine** (P0, 持久化增强)

### 8.3 增量交付
- Phase 4: 4 大引擎 + 单元测试（可独立测试）
- Phase 5: 4 大 UI 面板 + 集成
- Phase 6: E2E 测试（验证协同）
- Phase 7: 验收 + Git 提交

---

## 九、结论

Cycle 35 通过 4 大新引擎（WorkflowOrchestrator / AgentCommunication / TaskCheckpoint / AgentScheduler）补充 Hermes 平台在 **DAG 编排 / A2A 通信 / Time Travel / WFQ 调度** 四个方向的能力。

**预期成果**:
- ✅ 完整 DAG 工作流（条件分支 / 并行节点 / 嵌套子图 / 可视化）
- ✅ A2A 协议子集（Agent Card / 优先级 / Pub/Sub）
- ✅ Time Travel 检查点（版本管理 / Diff / 增量）
- ✅ 智能调度器（WFQ / 优先级 / 资源感知 / 性能分析）

**与现有能力互补**:
- `dynamicWorkflowEngine` 提供 Phase 模板 + Journal → G35-01 升级为完整 DAG
- `agentMessagingEngine` 提供基础消息 → G35-02 升级为 A2A 协议
- `agentCheckpointEngine` 提供代理树快照 → G35-03 升级为 Time Travel
- 各引擎自带调度 → G35-04 抽取为统一调度器

---

**报告完成时间**: 2026-07-31
**下一步**: 进入 Phase 3（4 份 SPEC 编写）
