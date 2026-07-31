# Cycle 34 差距分析报告 (Gap Analysis)

> **分析主题**：端云协同 + 边缘计算 + 离线优先 在 Hermes 平台中的功能差距
> **分析时间**：2026-07-31
> **输入文档**：[CYCLE34_CODEX_TRAE_RESEARCH.md](./CYCLE34_CODEX_TRAE_RESEARCH.md)
> **关联周期**：Cycle 33 (企业级安全/合规) → Cycle 34 (端云协同/边缘计算)
> **目标**：识别 Hermes 平台在「端云协同 + 边缘计算 + 离线优先」领域的功能差距，形成 3 个 P0 任务规格

---

## 目录

1. [当前状态盘点 (As-Is)](#1-当前状态盘点-as-is)
2. [目标状态架构 (To-Be)](#2-目标状态架构-to-be)
3. [功能差距分析 (Gap)](#3-功能差距分析-gap)
4. [优先级矩阵](#4-优先级矩阵)
5. [Cycle 34 三大 P0 任务定义](#5-cycle-34-三大-p0-任务定义)
6. [与其他模块的协同关系](#6-与其他模块的协同关系)
7. [复用声明](#7-复用声明)

---

## 1. 当前状态盘点 (As-Is)

### 1.1 已有的端云/边缘相关能力

经过对前 33 个 cycle 的产出盘点，Hermes 平台已具备部分端云协同能力：

| 现有能力 | 引擎/模块 | Cycle | 端云相关度 |
|---|---|---|---|
| 模型路由 | `ModelRouter` (Cycle 11) | C11 | 🟡 仅云端路由，无端侧 |
| 成本预测 | `CostPredictor` (Cycle 12) | C12 | 🟢 通用 |
| 成本预算 | `CostBudgetEngine` (Cycle 29) | C29 | 🟢 通用 |
| 成本归因 | `CostAttributionEngine` (Cycle 31) | C31 | 🟢 通用 |
| 远程 Worktree | `RemoteWorktreeEngine` (Cycle 31) | C31 | 🟢 通用 |
| Worktree 同步 | `WorktreeSyncEngine` (Cycle 31) | C31 | 🟡 仅云端 |
| Side Chat / Multi-Conversation | `SideChatEngine` (Cycle 18) | C18 | 🟡 内存态，无离线队列 |
| 后台任务管理 | `BackgroundTaskEngine` (Cycle 4) | C4 | 🟡 内存态，无跨设备 |
| 智能体消息 | `AgentMessagingEngine` (Cycle 22) | C22 | 🟡 进程内 |
| 全局记忆 | `GlobalMemoryEngine` (Cycle 24) | C24 | 🟡 localStorage，无 CRDT |
| 设备发现 | ❌ 无 | - | 🔴 缺失 |
| 端侧模型 | ❌ 无 | - | 🔴 缺失 |
| 离线队列 | ❌ 无 | - | 🔴 缺失 |
| 模型缓存 | ❌ 无 | - | 🔴 缺失 |

### 1.2 核心能力空白

通过对照 CYCLE34 调研报告，识别出 4 大核心能力空白：

1. **端云模型路由**：当前 `ModelRouter` 仅支持云端模型（如 Claude / GPT / Gemini），无端侧模型（Ollama / llama.cpp / Apple Foundation Models）支持
2. **离线优先架构**：现有 SideChat / GlobalMemory / BackgroundTask 均为内存态或 localStorage，无 CRDT 同步、无离线队列、无断网检测
3. **设备集群管理**：完全缺失，RemoteWorktree 是「云端账户绑定」模式，不是「局域网 mDNS 发现」模式
4. **模型预加载与缓存**：完全缺失，无 vLLM PagedAttention 适配、无 KV 缓存层、无 Model Pool 概念

---

## 2. 目标状态架构 (To-Be)

### 2.1 端云协同四层架构

```
┌────────────────────────────────────────────────────────────┐
│                Hermes 端云协同调度平台                        │
├────────────────────────────────────────────────────────────┤
│  Layer 1: 端云模型路由 (EdgeModelRouterEngine)                │
│   • 端侧：Ollama / llama.cpp / Apple Foundation Models       │
│   • 云端：Claude / GPT-5 / Gemini                            │
│   • 决策维度：成本 / 延迟 / 质量 / 隐私 / 能力 / 可用性       │
│   • Token Budget Manager：防止云端成本失控                    │
│   • 隐私 Tier 分类：健康/金融强制本地                          │
├────────────────────────────────────────────────────────────┤
│  Layer 2: 离线优先层 (OfflineFirstEngine)                     │
│   • 断网检测：navigator.onLine + 主动 ping                    │
│   • 本地队列：操作日志 + 状态机                                │
│   • CRDT 同步：Yjs (任务) + Automerge (配置)                  │
│   • 联网后自动同步：增量 delta + 冲突解决                      │
│   • 引擎降级：基础能力本地化（语法高亮/格式化/片段执行）       │
├────────────────────────────────────────────────────────────┤
│  Layer 3: 设备集群层 (DeviceClusterEngine)                    │
│   • mDNS / DNS-SD 设备发现（局域网）                          │
│   • 任务分发：能力 / 负载 / 电量三维路由                       │
│   • 心跳 + 故障转移                                           │
│   • 跨子网：Discovery Proxy (RFC 8766) + SRP                 │
├────────────────────────────────────────────────────────────┤
│  Layer 4: 模型缓存层 (ModelCacheEngine - 本轮暂不实现)        │
│   • vLLM PagedAttention 适配                                  │
│   • KV Offloading：CPU / Storage 层次化                       │
│   • Model Pool + Keep-alive                                   │
│   • OOM 防护：LRU 淘汰 + 自动 swap                            │
└────────────────────────────────────────────────────────────┘
```

### 2.2 三大核心引擎的责任边界

| 引擎 | 核心职责 | 不负责 |
|---|---|---|
| **EdgeModelRouter** | 端云模型选择 + 路由决策 + 隐私分类 + 成本控制 | 不负责实际推理（由 LLM Provider 实现） |
| **OfflineFirst** | 网络状态 + 本地队列 + CRDT 同步 + 引擎降级 | 不负责 LLM 路由（由 EdgeModelRouter 实现） |
| **DeviceCluster** | 设备发现 + 任务分发 + 心跳 + 故障转移 | 不负责 LLM 调用（由具体任务引擎实现） |

### 2.3 端云协同决策矩阵

| 任务类型 | 端侧优先 | 云端优先 | 路由策略 |
|---|---|---|---|
| 语法高亮 / 格式化 / 简单分类 | ✅ | | 强制本地 |
| 单元测试生成 | ✅ | | 强制本地（高频低成本） |
| 代码片段补全 | ✅ | | 强制本地（< 200ms 延迟要求） |
| 长上下文分析（> 32K） | | ✅ | 强制云端 |
| 复杂架构设计 | | ✅ | 强制云端 |
| 医疗/金融敏感数据 | ✅ | | 强制本地（隐私 Tier 1） |
| PR 自动评审 | | ✅ | 强制云端（需前沿推理） |
| 大规模批量处理 | ✅ | | 强制本地（成本敏感） |

---

## 3. 功能差距分析 (Gap)

### 3.1 G34-01: EdgeModelRouterEngine（端云模型路由）

| 维度 | 当前状态 | 目标状态 | 差距 |
|---|---|---|---|
| 端侧模型支持 | ❌ 无 | Ollama / llama.cpp / Apple Foundation Models 注册 | **100% 缺失** |
| 云端模型路由 | ✅ ModelRouter (Cycle 11) | 增强：分类器 + 优化模式 | **已具备，需扩展** |
| 智能决策 | 🟡 简单路由 | 多维度（成本/延迟/质量/隐私/能力） | **70% 缺失** |
| Token Budget | ❌ 无 | 单次/单代理/单日三层预算 | **100% 缺失** |
| 隐私 Tier 分类 | ❌ 无 | Tier 1/2/3 自动分类 | **100% 缺失** |
| 优化模式 | ❌ 无 | Intelligence / Balance / Cost | **100% 缺失** |
| 端云成本对比 | 🟡 CostPredictor | 实时端云成本对比 | **50% 缺失** |
| 模型 Profile 管理 | 🟡 简单 | LiteLLM-style 多 profile | **60% 缺失** |

**预计测试覆盖**：约 75-85 个单元测试
**预计代码量**：约 1000-1200 行 TS

### 3.2 G34-02: OfflineFirstEngine（离线优先工作流）

| 维度 | 当前状态 | 目标状态 | 差距 |
|---|---|---|---|
| 断网检测 | ❌ 无 | navigator.onLine + 主动 ping + 事件订阅 | **100% 缺失** |
| 本地队列 | ❌ 无 | 操作日志 + 状态机 + 持久化 | **100% 缺失** |
| CRDT 同步 | ❌ 无 | Yjs (任务状态) + Automerge (配置) | **100% 缺失** |
| 联网自动同步 | ❌ 无 | 增量 delta + 冲突解决 + 重试 | **100% 缺失** |
| 引擎降级 | ❌ 无 | 基础能力本地化 + Fallback 链 | **100% 缺失** |
| 离线统计 | ❌ 无 | 离线时长 / 队列长度 / 同步延迟 | **100% 缺失** |
| Change Feed | 🟡 GlobalMemory 局部支持 | 统一 Change Feed + 事件订阅 | **60% 缺失** |
| SideChat 离线 | 🟡 仅内存 | 持久化 + 跨会话 | **80% 缺失** |

**预计测试覆盖**：约 70-80 个单元测试
**预计代码量**：约 900-1100 行 TS

### 3.3 G34-03: DeviceClusterEngine（设备集群管理）

| 维度 | 当前状态 | 目标状态 | 差距 |
|---|---|---|---|
| 设备发现 | ❌ 无 | mDNS / DNS-SD + 跨子网 Proxy | **100% 缺失** |
| 设备能力画像 | 🟡 RemoteWorktree 局部 | 完整能力/负载/电量三维模型 | **70% 缺失** |
| 任务分发 | 🟡 手动 | 能力路由 + 负载均衡 + 电量感知 | **80% 缺失** |
| 心跳机制 | 🟡 HealthCheck 简单 | 标准心跳（10-30s）+ 超时剔除 | **60% 缺失** |
| 故障转移 | 🟡 部分支持 | 自动转移 + 任务重排队 + Saga 模式 | **70% 缺失** |
| 设备分组 | ❌ 无 | Label / Tag / 区域分组 | **100% 缺失** |
| 远程命令 | 🟡 Remote Control 部分 | 增强：设备间消息 + 任务迁移 | **60% 缺失** |
| 设备统计 | 🟡 基础 | 注册 / 在线 / 离线 / 故障统计 | **40% 缺失** |

**预计测试覆盖**：约 65-75 个单元测试
**预计代码量**：约 850-1050 行 TS

### 3.4 G34-04: ModelCacheEngine（暂缓 - P1 任务）

| 维度 | 状态 |
|---|---|
| 当前状态 | ❌ 缺失 |
| 优先级 | 🟡 P1 (本轮暂不实现) |
| 理由 | 依赖 vLLM / LMCache 等后端，与 Web 端场景适配度低；可作 Cycle 35 候选 |

---

## 4. 优先级矩阵

| 任务 | 价值 | 紧迫性 | 可行性 | 工作量 | 总分 | 优先级 |
|---|---|---|---|---|---|---|
| G34-01 EdgeModelRouter | 5 | 5 | 5 | 3 | 18 | 🔴 P0 |
| G34-02 OfflineFirst | 5 | 4 | 4 | 3 | 16 | 🔴 P0 |
| G34-03 DeviceCluster | 4 | 4 | 4 | 3 | 15 | 🔴 P0 |
| G34-04 ModelCache | 3 | 2 | 2 | 5 | 12 | 🟡 P1 |

**评分标准**：1-5 分，价值（对生产可用性影响）+ 紧迫性（市场需求）+ 可行性（实现难度）+ 工作量反向（5=工作量小）

---

## 5. Cycle 34 三大 P0 任务定义

### 5.1 G34-01: EdgeModelRouterEngine（端云模型路由）

**任务编号**：G34-01
**任务名称**：EdgeModelRouterEngine - 端云模型智能路由引擎
**核心目标**：实现端云模型智能路由，覆盖 Cursor Router 三大优化模式 + 隐私 Tier 分类 + Token Budget 控制

**关键功能**：
1. **端侧模型注册**：Ollama / llama.cpp / Apple Foundation Models Provider
2. **云端模型注册**：Claude / GPT-5 / Gemini Provider
3. **请求级分类器**：任务难度 / 任务类型 / 隐私等级
4. **三大优化模式**：Intelligence / Balance / Cost
5. **Token Budget Manager**：单次/单代理/单日三层预算
6. **隐私 Tier 分类**：Tier 1 健康/金融 → 强制本地，Tier 2/3 → 可上云
7. **端云成本对比**：实时 token 价格 + 延迟 + 质量对比
8. **路由事件系统**：路由决策事件 + 成本统计事件

**对应 SPEC**：[CYCLE34_SPEC_G34_01_EDGE_MODEL_ROUTER.md](./CYCLE34_SPEC_G34_01_EDGE_MODEL_ROUTER.md)

### 5.2 G34-02: OfflineFirstEngine（离线优先工作流）

**任务编号**：G34-02
**任务名称**：OfflineFirstEngine - 离线优先工作流引擎
**核心目标**：实现完整的离线优先工作流，覆盖断网检测 + 本地队列 + CRDT 同步 + 引擎降级

**关键功能**：
1. **网络状态检测**：navigator.onLine + 主动 ping + 事件订阅
2. **本地操作队列**：操作日志 + 状态机 + 持久化（IndexedDB / localStorage）
3. **CRDT 同步引擎**：Yjs (任务状态) + Automerge (配置)
4. **自动同步策略**：联网后增量 delta + 冲突解决 + 重试退避
5. **引擎降级机制**：基础能力本地化 + Fallback 链
6. **离线统计**：离线时长 / 队列长度 / 同步延迟 / 失败重试
7. **Change Feed 集成**：与 GlobalMemory / SideChat 协同
8. **事件系统**：状态变化 + 同步进度 + 降级事件

**对应 SPEC**：[CYCLE34_SPEC_G34_02_OFFLINE_FIRST.md](./CYCLE34_SPEC_G34_02_OFFLINE_FIRST.md)

### 5.3 G34-03: DeviceClusterEngine（设备集群管理）

**任务编号**：G34-03
**任务名称**：DeviceClusterEngine - 设备集群管理引擎
**核心目标**：实现多设备发现、任务分发、心跳监控、故障转移，覆盖 mDNS / DNS-SD 局域网 + 跨子网 Discovery Proxy

**关键功能**：
1. **设备发现**：mDNS / DNS-SD (PTR/SRV/TXT 三种记录)
2. **设备注册**：能力画像 (CPU/GPU/NPU/Memory) + 标签 + 区域
3. **任务分发**：能力路由 + 负载均衡 + 电量感知
4. **心跳机制**：标准心跳（10-30s）+ 超时剔除
5. **故障转移**：自动转移 + 任务重排队 + Saga 模式
6. **设备分组**：Label / Tag / 区域分组
7. **远程命令**：设备间消息 + 任务迁移 + 状态广播
8. **设备统计**：注册 / 在线 / 离线 / 故障统计
9. **跨子网扩展**：Discovery Proxy (RFC 8766) + SRP 注册

**对应 SPEC**：[CYCLE34_SPEC_G34_03_DEVICE_CLUSTER.md](./CYCLE34_SPEC_G34_03_DEVICE_CLUSTER.md)

---

## 6. 与其他模块的协同关系

### 6.1 上游依赖

```
EdgeModelRouter  ←  ModelRouter (C11) | CostPredictor (C12) | CostBudget (C29)
OfflineFirst     ←  GlobalMemory (C24) | SideChat (C18) | BackgroundTask (C4)
DeviceCluster    ←  RemoteWorktree (C31) | AgentMessaging (C22) | WorktreeSync (C31)
```

### 6.2 下游消费者

```
EnterpriseWorkflow (C33)  → EdgeModelRouter：工作流步骤路由
                            → DeviceCluster：分布式执行
                            → OfflineFirst：断网降级

UnifiedDashboard (C33)    → EdgeModelRouter：路由统计采集
                            → DeviceCluster：设备健康度

BackgroundTask (C4)        → OfflineFirst：离线队列持久化
                            → DeviceCluster：分布式任务

GlobalMemory (C24)         → OfflineFirst：CRDT 同步
                            → DeviceCluster：跨设备记忆同步

CostAttribution (C31)      → EdgeModelRouter：端云成本拆分
```

### 6.3 协同工作流示例

**场景**：用户在飞机上离线工作时
1. `OfflineFirst` 检测到断网
2. `BackgroundTask` 将任务加入本地队列
3. `EdgeModelRouter` 自动降级到端侧模型
4. `DeviceCluster` 发现可用的移动端设备协助
5. `GlobalMemory` 缓存上下文到本地
6. 联网后 `OfflineFirst` 自动同步
7. `EdgeModelRouter` 重新评估路由
8. `CostAttribution` 记录端云成本

---

## 7. 复用声明

| 项目 | 复用状态 | 说明 |
|---|---|---|
| 项目现有代码片段 | **部分复用** | EventBus / 状态机 / 持久化模式 沿用 Cycle 22/24/29/31 设计 |
| 外部学术 / 官方资料 | **完全合规** | 已按 CYCLE34_RESEARCH 第 7 章标注来源 |
| 跨轮次报告（CYCLE10-33） | **结构沿用** | 沿用 6 大章节结构 + 表格化输出 |
| TypeScript 设计模式 | **统一** | 沿用单一引擎类 + Map 存储 + EventEmitter 模式 |

---

## 差距分析报告结束

> **下一阶段**：基于本报告 5.1-5.3 节输出 3 份详细 SPEC 文档
> **预期交付**：CYCLE34_SPEC_G34_01/02/03_*.md
> **预计总测试数**：210-240 个新单元测试 + 12-15 个 E2E 测试
