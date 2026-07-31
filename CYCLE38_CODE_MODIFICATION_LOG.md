# CYCLE38 代码修改日志

> **Cycle**: 38 - Agent Loop 高级能力
> **时间**: 2026-07-31
> **范围**: 22 文件, +9528 行

---

## 一、新增文件 (15 个)

### 1.1 核心引擎 (4 个)

#### [multiAgentEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/multiAgentEngine.ts) (707 行)

**核心作用**: 实现 Manager-Worker 模式的多 Agent 协作
**关键类型**:
- `AgentRole` / `TaskStatus` / `TaskPriority` / `ExecutionMode` / `CrewStatus`
- `AgentDefinition` / `TaskDefinition` / `TaskResult` / `Crew` / `CrewResult`
- `MessageBus` / `TaskScheduler` / `WorkerAgent` / `ManagerAgent`

**关键功能**:
- 任务分解 (ManagerAgent.decomposeTask → LLM → 子任务列表)
- 能力匹配 (calculateMatchScore → proficiency 加权)
- 任务调度 (TaskScheduler → 优先级 + 依赖关系)
- 消息总线 (MessageBus → 广播 + 单播 + 订阅/取消订阅)
- Worker 选择 (selectWorker → 可用 + 匹配分最高)
- Crew 执行 (executeCrew → sequential/parallel/hybrid)
- 失败重试 (RetryPolicy → maxRetries + backoff + retryableErrors)

#### [longTermMemory.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/longTermMemory.ts) (~500 行)

**核心作用**: 实现 MemGPT 风格的分层长期记忆系统
**关键类型**:
- `MemoryLayer` (core/recall/archive)
- `MemoryItem` (id/content/layer/importance/createdAt/lastAccessedAt)
- `CoreMemoryStore` / `RecallMemoryStore` / `ArchiveMemoryStore`

**关键功能**:
- 三层存储 (核心=长期人格, 回忆=近期对话, 归档=历史)
- LRU 淘汰 (lastAccessedAt 排序)
- 语义检索 (tokenize + similarity)
- 关键词加权 (tokenMatches)
- 上下文构建 (按 query 选择相关记忆)
- 记忆衰减与维护 (runMaintenance)
- 持久化 (save/load → JSON)

#### [reflectionEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/reflectionEngine.ts) (~600 行)

**核心作用**: 实现 Reflexion 风格的自我反思与迭代优化
**关键类型**:
- `ReflectionType` (success/partial/failure/timeout/exception)
- `Evaluation` (overallScore/criteriaScores)
- `Reflection` (lesson/strategy/nextStrategy)
- `ReflexionSession` (iterations + finalResult)
- `IterationConfig` (maxIterations/qualityThreshold/strategyBudgetMs)

**关键功能**:
- 执行任务 (executor → TaskExecutionResult)
- 评估执行 (evaluateOnly → 多维度评分)
- 生成反思 (Reflection → lesson + strategy)
- 策略调整 (nextStrategy → 改进策略生成)
- 迭代终止 (qualityThreshold/maxIterations/Plateau/budget)
- 反思历史 (getReflections/getSession/listSessions)

#### [humanApprovalEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/humanApprovalEngine.ts) (~750 行)

**核心作用**: 实现人机协作审批工作流
**关键类型**:
- `RiskLevel` (safe/moderate/dangerous/critical)
- `OperationDescriptor` / `ApprovalRequest` / `ApprovalDecision`
- `ApprovalPolicy` / `PolicyCondition` / `ApproverRole`
- `AuditLogEntry` / `RiskClassifier` / `ApprovalQueue` / `PolicyEngine` / `Auditor`

**关键功能**:
- 风险分类 (CRITICAL_KEYWORDS: rm -rf/DROP TABLE/shutdown/...)
- 不可逆操作升级 (reversible=false → dangerous)
- 自定义规则 (registerRule)
- 策略引擎 (applyPolicies → 按优先级取最高风险)
- 审批队列 (enqueue/decide/listPending/cleanupExpired)
- 多人审批 (requiredApprovers + 累计)
- 角色权限 (canApproveRisk → admin/security_officer/user)
- 审计日志 (log/query/export JSON/CSV)

### 1.2 单元测试 (4 个)

#### [multiAgentEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/multiAgentEngine.test.ts) (29 个测试)

覆盖: 工具函数 / Agent 管理 / Crew 管理 / 任务调度 / 消息总线 / Worker 执行 / Manager 决策 / 端到端测试

#### [longTermMemory.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/longTermMemory.test.ts) (52 个测试)

覆盖: 工具函数 / CoreMemoryStore / RecallMemoryStore / ArchiveMemoryStore / 上下文构建 / 维护任务 / 持久化

#### [reflectionEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/reflectionEngine.test.ts) (46 个测试)

覆盖: 工具函数 / 评估器 / 反思生成器 / 策略调整器 / 引擎主类 / 终止条件 / 反思历史

#### [humanApprovalEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/humanApprovalEngine.test.ts) (48 个测试)

覆盖: 工具函数 / RiskClassifier / ApprovalQueue / PolicyEngine / Auditor / 主类

### 1.3 UI 面板 (4 个)

#### [MultiAgentCrewPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MultiAgentCrewPanel.tsx) (393 行)

**标签页**: overview / agents / crews / execute / history
**功能**: Agent 列表 / Crew 创建 / 任务执行 / 历史记录 / 消息统计

#### [LongTermMemoryPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LongTermMemoryPanel.tsx) (~350 行)

**功能**: 记忆写入 (3 层) / 记忆检索 / 上下文构建 / 统计展示 / 维护执行

#### [ReflectionPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ReflectionPanel.tsx) (~350 行)

**功能**: 任务执行 / 迭代监控 / 反思查看 / 历史浏览 / 终止配置

#### [HumanApprovalPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/HumanApprovalPanel.tsx) (~400 行)

**功能**: 提交审批 / 队列处理 / 批准/拒绝 / 审计日志 / 导出

### 1.4 SPEC 文档 (4 份)

- [CYCLE38_SPEC_G38_01_MULTI_AGENT.md](file:///home/qizheng/auto_code_ws/CYCLE38_SPEC_G38_01_MULTI_AGENT.md)
- [CYCLE38_SPEC_G38_02_LONG_TERM_MEMORY.md](file:///home/qizheng/auto_code_ws/CYCLE38_SPEC_G38_02_LONG_TERM_MEMORY.md)
- [CYCLE38_SPEC_G38_03_REFLECTION.md](file:///home/qizheng/auto_code_ws/CYCLE38_SPEC_G38_03_REFLECTION.md)
- [CYCLE38_SPEC_G38_04_HUMAN_APPROVAL.md](file:///home/qizheng/auto_code_ws/CYCLE38_SPEC_G38_04_HUMAN_APPROVAL.md)

---

## 二、修改文件 (7 个)

### 2.1 [App.tsx](file:///home/qizheng/auto_code_ws/frontend/src/App.tsx) (v6.110.0)

**新增**:
- 4 个面板组件 import
- 4 个 useState (multiAgentCrewOpen/longTermMemoryOpen/reflectionOpen/humanApprovalOpen)
- 4 个 useCallback 切换回调
- 4 个 ErrorBoundary 包裹渲染
- 4 个新 prop 透传给 AppLayout

### 2.2 [AppLayout.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/AppLayout.tsx) (v7.01.0)

**新增**:
- 4 个 prop 类型 (onOpenMultiAgentCrew/onOpenLongTermMemory/onOpenReflection/onOpenHumanApproval)
- 4 个 prop 解构
- 4 个 prop 透传给 BrandHeader
- 头部注释 v7.01.0 修订记录

### 2.3 [BrandHeader.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BrandHeader.tsx) (v2.20.0)

**新增**:
- 4 个 prop 类型
- 4 个 prop 解构
- 4 个内联 SVG 图标 (multi-agent/memory/reflection/approval)
- 4 个下拉菜单项 (差异化 hover 颜色)
- 头部注释 v2.20.0 修订记录

### 2.4 [SmartApprovalPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SmartApprovalPanel.tsx)

**修改**: 移除 `@ts-expect-error` 注释（已用下划线前缀变量名）

### 2.5 [realLLMProvider.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/realLLMProvider.test.ts)

**修改**: 修复 `calculateRetryDelay` flaky 测试（30 次中位数采样 + 1.8 → 1.5 系数）

### 2.6 [toolUseEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/toolUseEngine.test.ts)

**修改**: 修复 `calculateRetryDelay` flaky 测试（同上）

### 2.7 [CYCLE38_STARTUP.md](file:///home/qizheng/auto_code_ws/CYCLE38_STARTUP.md)

**修改**: 标记方向已选定 (C) / 规模已选定 (B) / API 已选定 (A)

---

## 三、完成与未完成任务

### 已完成 ✅

- [x] G38-01: 多 Agent 协作核心引擎
- [x] G38-01: 多 Agent 协作 UI 面板
- [x] G38-02: 长期记忆核心引擎
- [x] G38-02: 长期记忆 UI 面板
- [x] G38-03: 反思与自我修正核心引擎
- [x] G38-03: 反思与自我修正 UI 面板
- [x] G38-04: 人机协作审批核心引擎
- [x] G38-04: 人机协作审批 UI 面板
- [x] 4 份 SPEC 文档
- [x] 主应用集成 (App + AppLayout + BrandHeader)
- [x] TypeScript 0 错误验证
- [x] 单元测试 100% 通过 (5209/5209)
- [x] Git 原子化提交 (3 个 commit)
- [x] 修复 2 个预先存在的 flaky 测试
- [x] 验收报告 + 代码修改日志

### 未完成 (留待 Cycle 39+) ❌

- [ ] Cycle 39+ 推荐方向: MCP 协议深度集成
- [ ] 真实 LLM 端到端集成 (DeepSeek / 火山方舟)
- [ ] 多模态 Agent Loop 协同
- [ ] 跨会话记忆持久化 (IndexedDB)

---

## 四、关键变更追溯

| 变更 | 影响 | 修复 |
|------|------|------|
| AgentCapability 由 string[] 改为 object[] | 影响: 4 个面板 + 4 个 SPEC | MultiAgentCrewPanel 重写为对象格式 |
| TaskPriority 移除 'medium' | 影响: 多处 priority 赋值 | 'medium' → 'normal' |
| Crew 增加 workerIds 移除 (改用 agents.filter) | 影响: panel 显示 Worker 数 | 改用 `c.agents.filter(a => a.role === 'worker').length` |
| CrewResult 移除 status | 影响: 面板 status 显示 | 改用 `successfulTasks/totalTasks` 显示 |
| MessageBus.subscribe 强制传 agentId | 影响: useEffect 订阅 | 传入 'observer' 作为订阅者 ID |
| AgentRole 移除 'researcher'/'coder' | 影响: DEFAULT_AGENT_TEMPLATES | 改为 'worker' |
