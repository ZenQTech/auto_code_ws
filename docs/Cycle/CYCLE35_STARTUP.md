# CYCLE 35 启动文档

## 周期信息
- **周期编号**: Cycle 35
- **启动时间**: 2026-07-31
- **前序周期**: Cycle 34（端云协同+边缘计算+离线优先）
- **目标**: 在 Cycle 34 基础上深化端云协同能力，扩展数据洞察与生态集成

---

## 一、Cycle 34 回顾

### 1.1 已完成能力
- ✅ EdgeModelRouterEngine（端云模型路由）
- ✅ OfflineFirstEngine（离线优先工作流）
- ✅ DeviceClusterEngine（设备集群）
- ✅ 3 大 UI 面板 + E2E 集成测试
- ✅ 主应用集成（App/AppLayout/BrandHeader）
- ✅ 4534 tests passing / 0 TS errors

### 1.2 已具备基础
- 端云模型注册 + 路由决策 + Token 预算
- 离线 CRDT + 队列同步 + 降级链
- 设备发现 + 任务分配 + 故障转移

### 1.3 仍可深化
- 真实 LLM provider 集成（Ollama/Anthropic SDK）
- CRDT 持久化（IndexedDB 真正离线优先）
- 真实设备发现（mDNS/Bonjour/Bluetooth）
- 跨区域同步（region-aware CRDT）
- 端云协同可视化（路由决策流程图）
- 模型评测与对比（A/B Testing）
- 任务编排 + 工作流引擎集成

---

## 二、调研方向（三选一）

### 方向 A：智能体协作 + 任务编排（推荐）

**主题**: Agentic Workflow + Task Orchestration

**核心议题**:
1. **Multi-Agent 协作模式**: Supervisor / Peer-to-Peer / Hierarchical
2. **任务编排**: DAG / Sequential / Parallel / Conditional
3. **Agent 通信协议**: A2A (Agent-to-Agent) / MCP (Model Context Protocol)
4. **状态管理**: Checkpoint / Resume / Rollback
5. **可视化**: 任务流图 / Agent 通信图

**候选功能**:
- G35-01: WorkflowOrchestratorEngine（工作流编排引擎）
  - DAG 定义与执行
  - 条件分支 / 并行执行 / 错误重试
  - 可视化执行图
- G35-02: AgentCommunicationEngine（智能体通信引擎）
  - A2A 协议实现
  - 消息路由 / 优先级队列
  - 通信历史与回放
- G35-03: TaskCheckpointEngine（任务检查点引擎）
  - 状态快照 / 恢复
  - 版本管理
  - 断点续传

**预期工作量**: 中等偏高（需要复杂状态机）

---

### 方向 B：数据洞察 + 智能分析

**主题**: Observability + Analytics + Insights

**核心议题**:
1. **遥测数据采集**: Metrics / Logs / Traces
2. **可视化分析**: Dashboard / Chart / Heatmap
3. **异常检测**: Anomaly Detection / Alerting
4. **用户行为分析**: Funnel / Cohort / Retention
5. **AI 增强洞察**: LLM-driven insights

**候选功能**:
- G35-01: TelemetryCollectorEngine（遥测数据采集引擎）
  - 多源数据采集
  - 数据压缩与采样
  - 隐私脱敏
- G35-02: AnalyticsDashboardEngine（分析仪表盘引擎）
  - 12+ 预置图表（折线/柱状/饼图/热力图/桑基图）
  - 实时数据流
  - 自定义查询
- G35-03: AnomalyDetectionEngine（异常检测引擎）
  - 统计异常检测（Z-Score / IQR）
  - ML 异常检测（Isolation Forest）
  - 实时告警

**预期工作量**: 中等（数据处理逻辑复杂）

---

### 方向 C：生态集成 + 开放平台

**主题**: Open Platform + Ecosystem Integration

**核心议题**:
1. **API 网关**: 统一入口 / 限流 / 鉴权
2. **插件系统**: 扩展点 / 沙箱 / 版本管理
3. **第三方集成**: Slack / GitHub / Notion / Linear
4. **Webhook 双向同步**
5. **开放 SDK**

**候选功能**:
- G35-01: ApiGatewayEngine（API 网关引擎）
  - 路由 / 限流 / 鉴权
  - 监控 / 统计
  - 插件式中间件
- G35-02: PluginSystemEngine（插件系统引擎）
  - 沙箱执行（QuickJS / iframe）
  - 权限管理
  - 版本管理 + 热更新
- G35-03: WebhookIntegrationEngine（Webhook 集成引擎）
  - 双向同步
  - 事件路由
  - 重试与死信队列

**预期工作量**: 中等（API 设计 + 安全考虑）

---

## 三、推荐方案

### 3.1 主推方向：A（智能体协作 + 任务编排）

**理由**:
1. **架构契合**: 与 Cycle 33（OrchestratedAgent）、Cycle 30（DynamicWorkflow）形成完整链路
2. **价值明确**: Multi-Agent 是 AI Agent 平台的核心能力
3. **技术深度**: 涉及状态机、DAG、消息协议、checkpoint 等高级主题
4. **可演示**: 可视化任务流图是强演示效果

### 3.2 备选方向：B（数据洞察）

**适用场景**: 如果产品需要数据驱动决策
**优势**: 现有 3 个 UI 组件（UnifiedDashboard / SecurityAudit）已建立基础

### 3.3 备选方向：C（生态集成）

**适用场景**: 如果产品需要开放 API 与第三方扩展
**优势**: 可对接现有真实业务系统

---

## 四、任务规划（基于方向 A）

### 4.1 Phase 1: 调研（1-2 天）
- 阅读现有 3 大引擎 + OrchestratedAgent + DynamicWorkflow
- 互联网调研：Multi-Agent 框架（DAG / LangGraph / Temporal）
- 调研：A2A 协议 / MCP 协议最新规范
- 编写调研报告 CYCLE35_CODEX_TRAE_RESEARCH.md

### 4.2 Phase 2: 差距分析（0.5 天）
- 现状梳理
- 差距识别
- 编写 CYCLE35_GAP_ANALYSIS.md

### 4.3 Phase 3: SPEC 编写（1.5 天）
- G35-01 WorkflowOrchestratorEngine SPEC
- G35-02 AgentCommunicationEngine SPEC
- G35-03 TaskCheckpointEngine SPEC
- G35-04 AgentSchedulerEngine SPEC

### 4.4 Phase 4: 核心引擎开发（3-4 天）
- 4 大引擎 + 单元测试
- 估计新增 280+ 单元测试

### 4.5 Phase 5: UI 组件 + 集成（1-2 天）
- 4 大 UI 面板
- 任务流图可视化
- 主应用集成

### 4.6 Phase 6: 测试验证（0.5-1 天）
- E2E 集成测试
- 全量测试 100% 通过
- TypeScript 0 错误

### 4.7 Phase 7: 验收 + Git 提交（0.5 天）
- CYCLE35_ACCEPTANCE_REPORT.md
- CYCLE35_CODE_MODIFICATION_LOG.md
- CYCLE36_STARTUP.md
- 5-6 个 Git commits

**总工作量估计**: 8-11 天

---

## 五、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 状态机复杂 | 中 | 参考 DynamicWorkflow 已有实现 |
| A2A 协议规范 | 低 | 采用简化子集 |
| 可视化复杂度 | 中 | 使用 SVG + React Flow |
| 性能瓶颈 | 低 | 单例 + 限制历史 + 索引 |
| 测试覆盖 | 中 | E2E 完整覆盖关键路径 |

---

## 六、决策点

请用户确认：

1. **调研方向**: A / B / C
   - 默认推荐：A（智能体协作 + 任务编排）

2. **任务节奏**: 维持 3 大 P0 任务 / 缩减到 2 大 / 扩展到 4 大
   - 默认推荐：3 大 P0

3. **优先级**: 是否纳入生产可用级别（Phase 1-7 全部执行）
   - 默认推荐：是

4. **特殊要求**: 是否需要对接真实 LLM API / 真实业务系统
   - 默认推荐：暂不，保持纯前端实现

---

## 七、Loop Engineering 工作流

继续遵循既有工作流：
- 需求分析 → 架构设计 → 关键迭代 → 验收标准 → 任务分配 → CLI 代码生成 → 全链路评审 → 智能迭代 → Git 提交

---

## 八、启动准备

✅ Cycle 34 全部完成并提交
✅ 4534 tests passing / 0 TS errors
✅ 主应用集成完成
✅ 文档完整
✅ 用户确认 Cycle 35 调研方向：A（智能体协作+任务编排）
✅ 用户确认任务节奏：4 大 P0 任务

**Cycle 35 启动！**
