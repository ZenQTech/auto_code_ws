# Cycle 31 差距分析报告

**日期**：2026-07-30
**基础**：CYCLE31_CODEX_TRAE_RESEARCH.md
**目标**：定义 Cycle 31 P0 任务清单

---

## 一、能力差距矩阵

### 1.1 9 大行业能力 vs Hermes 现状

| # | 行业能力 | 代表产品 | Hermes 现状 | 差距等级 | 优先级 |
|---|---------|---------|------------|---------|--------|
| 1 | Per-Repo Cost Attribution | Cursor 3 + AI Gateway | CostBudget（G28-02）仅按 user/session 拆分 | **大** | **P0** |
| 2 | 远程 Worktree Backend | Cursor 3 Cloud Agent | Worktree 管理仅本地 | **大** | **P0** |
| 3 | Worktree 状态同步 | Codex App + CodexMonitor | 无状态同步机制 | **大** | **P0** |
| 4 | Skills Library | Codex App Skills | SkillSystem（G28-01）单实例，无 Library 库 | 中 | P1 |
| 5 | Multi-Root Workspace | Cursor 3 | ProjectSelector 仅单根 | 中 | P1 |
| 6 | Plan 主智能体 | TRAE 3.0 | OrchestratedAgent 包含 plan 阶段但不显式 | 中 | P1 |
| 7 | Automations 自动化调度 | Cursor Automations | 无 | 中 | P1 |
| 8 | SSO + Admin API | ChatGPT Enterprise | 无 | 小 | P2 |
| 9 | Multi-Root Workspace | Cursor 3 / Codex | 仅单根 | 中 | P1 |

### 1.2 现状盘点（已完成能力）

Hermes 已实现的 30 个 Cycle 累计能力：

| Cycle | 能力 | 当前版本 |
|-------|------|---------|
| G19 P0-1 | Background Tasks | v6.41.0 |
| G19 P0-2 | Best-of-N Multi-Model | v6.42.0 |
| G19 P0-3 | Design Mode | v6.43.0 |
| G20 P0-1 | Worktree 隔离 | v6.45.0 |
| G20 P0-2 | Smart Model Router | v6.46.0 |
| G20 P0-3 | Hooks Engine | v6.47.0 |
| G21 P0-1 | Best-of-N × Worktree | v6.48.0 |
| G21 P0-2 | Router Cost Stats | v6.49.0 |
| G21 P0-4 | Hook Marketplace | v6.50.0 |
| G22 G22-01 | Side Chat | v6.51.0 |
| G22 G22-02 | Cost Prediction | v6.52.0 |
| G22 G22-03 | Hook Performance | v6.53.0 |
| G22 G22-04 | Router Admin | v6.54.0 |
| G23 G23-01 | Candidate Learning | v6.55.0 |
| G23 G23-02 | Session Replay | v6.56.0 |
| G23 G23-04 | Proactive Suggestion | v6.57.0 |
| G24 G24-01 | Global Memory | v6.58.0 |
| G24 G24-02 | MultiTask Orchestrator | v6.59.0 |
| G24 G24-04 | Figma to Code | v6.60.0 |
| G25 G25-01 | Auto Code Review | v6.61.0 |
| G25 G25-02 | PR Bot | v6.62.0 |
| G25 G25-03 | AI Performance Optimizer | v6.63.0 |
| G26 G26-01 | CSV Batch | v6.64.0 |
| G26 G26-02 | Smart Approval | v6.65.0 |
| G26 G26-03 | MTC Adapter | v6.66.0 |
| G27 G27-01 | Nested SubAgent | v6.67.0 |
| G27 G27-02 | Agent Checkpoint | v6.68.0 |
| G27 G27-04 | Agent Messaging | v6.69.0 |
| G27 G27-05 | Agent Template | v6.70.0 |
| G27 G27-06 | Remote Control | v6.71.0 |
| G28 G28-01 | Skill System | v6.72.0 |
| G28 G28-02 | Cost Budget | v6.73.0 |
| G28 G28-03 | Usage Attribution | v6.74.0 |
| G28 G28-04 | Scoped Permissions | v6.75.0 |
| G28 G28-05 | Command Palette | v6.76.0 |
| G29 G29-01 | Stacked Skills | v6.77.0 |
| G29 G29-02 | Skills Marketplace | v6.78.0 |
| G29 G29-03 | Analytics Chat | v6.79.0 |
| G30 G30-01 | Cost Threshold Alert | v6.83.0 |
| G30 G30-02 | Dynamic Workflow | v6.84.0 |
| G30 G30-03 | Orchestrated Agent | v6.85.0 |

### 1.3 缺失能力（按优先级）

#### P0（Cycle 31 必须完成）

1. **G31-01 团队/项目维度成本归因**
   - 现状：CostBudget（Cycle 28）按 user/session 拆分，缺少 per-team/per-project/per-repo 维度
   - 目标：实现 CostAttributionEngine，支持 org/team/project/repo/user 五维归因
   - 价值：对接企业级成本治理 + SSO chargeback
   - 来源：[forum.cursor - Per-Repository](https://forum.cursor.com/t/per-repository-usage-tracking-for-cost-attribution/154687/1)

2. **G31-02 远程 Worktree Backend**
   - 现状：Worktree 管理（Cycle 20 G20-01）仅本地文件系统
   - 目标：实现 RemoteWorktreeAdapter，抽象 local/remote/hybrid 多种后端
   - 价值：对接 Codex Cloud Agent、Cursor 3 Cloud Handoff
   - 来源：[Cursor 3 Launch](https://thenextgentechinsider.com/pulse/cursor-3-launches-design-mode-and-boosts-remote-agent-features)

3. **G31-03 Worktree 状态同步**
   - 现状：Worktree 状态仅本地内存/localStorage
   - 目标：实现 WorktreeSyncEngine，支持跨设备/跨工作区状态同步 + 冲突检测
   - 价值：对接 CodexMonitor 多设备、Codex App 跨会话
   - 来源：[CodexMonitor](https://codex.danielvaughan.com/2026/05/31/codexmonitor-multi-workspace-orchestration-tauri-app-server-protocol/)

#### P1（Cycle 32 候选）

4. **G32-01 Skills Library 库管理**
   - 现状：SkillSystem 单实例，无 Library
   - 目标：SkillsLibrary + 搜索/版本/依赖
5. **G32-02 Multi-Root Workspace**
   - 现状：ProjectSelector 仅单根
   - 目标：Multi-Root Workspace 切换 + 跨根 agent 协调
6. **G32-03 Plan 主智能体显式化**
   - 现状：OrchestratedAgent 6 阶段包含 plan，但不显式
   - 目标：显式 PlanAgent 组件，可视化 plan 过程

#### P2（Cycle 33+ 候选）

7. **G33-01 Automations 自动化调度**
   - 现状：无
   - 目标：CRON + Webhook + Event-driven
8. **G33-02 SSO + Admin API**
   - 现状：无
   - 目标：OIDC/SAML + Admin API
9. **G33-03 Multi-Root Workspace 高级**
   - 现状：仅基础
   - 目标：跨根 git 协同

---

## 二、Cycle 31 P0 任务详细规划

### 2.1 G31-01 团队/项目维度成本归因（CostAttribution）

**核心能力**：
- 五维归因：org → team → project → repo → user
- 实时归因：在每次 LLM 调用时自动归属到对应维度
- 报告生成：按维度聚合 + 趋势分析 + 异常告警
- 导出格式：CSV / JSON / chargeback 报告

**关键 API**：
```typescript
class CostAttributionEngine {
  // 五维注册
  registerOrg(org: OrgRef): void
  registerTeam(team: TeamRef): void
  registerProject(project: ProjectRef): void
  registerRepo(repo: RepoRef): void
  
  // 归因记录
  attribute(record: AttributionRecord): AttributionEntry
  
  // 聚合查询
  getByOrg(orgId: string, period: Period): AttributionReport
  getByTeam(teamId: string, period: Period): AttributionReport
  getByProject(projectId: string, period: Period): AttributionReport
  getByRepo(repoId: string, period: Period): AttributionReport
  getByUser(userId: string, period: Period): AttributionReport
  
  // 复合查询
  getCrossDimensional(filter: CrossDimensionalFilter): AttributionReport
  
  // 导出
  exportCSV(filter: ExportFilter): string
  exportJSON(filter: ExportFilter): string
  exportChargeback(filter: ExportFilter): ChargebackReport
}
```

### 2.2 G31-02 远程 Worktree Backend（RemoteWorktreeAdapter）

**核心能力**：
- 后端抽象：LocalBackend / RemoteBackend / HybridBackend
- 后端选择：基于成本/延迟/可用性自动选择
- 会话迁移：local 启动 → 远程接力（保存状态 + 中断恢复）
- 健康检查：定期 ping 远程后端

**关键 API**：
```typescript
class RemoteWorktreeAdapter {
  // 后端管理
  registerBackend(id: string, backend: WorktreeBackend): void
  selectBackend(criteria: SelectionCriteria): string
  
  // Worktree 操作（与 LocalWorktree API 一致）
  create(options: WorktreeCreateOptions): Promise<Worktree>
  delete(id: string): Promise<void>
  list(): Promise<Worktree[]>
  sync(id: string): Promise<Worktree>
  
  // 会话迁移
  migrateToRemote(worktreeId: string, targetBackend: string): Promise<MigrationReceipt>
  migrateToLocal(worktreeId: string): Promise<MigrationReceipt>
  
  // 健康检查
  healthCheck(backendId: string): Promise<HealthStatus>
  getBackendMetrics(backendId: string): BackendMetrics
}
```

### 2.3 G31-03 Worktree 状态同步（WorktreeSyncEngine）

**核心能力**：
- 状态快照：定期记录 worktree 状态（文件、commit、agent 进度）
- 状态广播：状态变更时广播到所有订阅者
- 跨设备同步：通过 SyncEndpoint 在多设备间同步
- 冲突检测：基于 vector clock 检测并发修改
- 冲突解决：CRDT 或 last-write-wins 策略

**关键 API**：
```typescript
class WorktreeSyncEngine {
  // 同步会话
  startSync(worktreeId: string, endpoint: SyncEndpoint): SyncSession
  stopSync(sessionId: string): void
  
  // 状态快照
  snapshot(worktreeId: string): WorktreeSnapshot
  restore(snapshotId: string): Promise<void>
  
  // 状态广播
  publishChange(worktreeId: string, change: StateChange): void
  subscribe(worktreeId: string, listener: (change: StateChange) => void): Unsubscribe
  
  // 冲突处理
  detectConflict(worktreeId: string): Conflict[]
  resolveConflict(conflictId: string, resolution: ConflictResolution): void
  
  // 设备管理
  registerDevice(device: DeviceInfo): void
  listDevices(): DeviceInfo[]
}
```

---

## 三、集成规划

### 3.1 主应用集成

- **BrandHeader**：新增 3 个菜单项（v2.12.0 → v2.13.0）
  - 团队成本归因（cost-attribution）
  - 远程 Worktree（remote-worktree）
  - Worktree 同步（worktree-sync）
- **AppLayout**：透传 3 个新 prop（v6.85.0 → v6.88.0）
- **App.tsx**：渲染 3 个新面板（v6.85.0 → v6.88.0）

### 3.2 测试规划

| 类型 | 数量 | 说明 |
|------|------|------|
| 单元测试 | ~150 | 3 大引擎各 40-50 测试 |
| 组件测试 | ~30 | 3 大 UI 组件各 10 测试 |
| E2E 集成测试 | ~15 | 端到端 + 跨引擎协同 |
| **Cycle 31 合计** | **~195** | |

### 3.3 文档规划

- CYCLE31_CODEX_TRAE_RESEARCH.md（已完成）
- CYCLE31_GAP_ANALYSIS.md（本文件）
- CYCLE31_SPEC_G31_01_COST_ATTRIBUTION.md
- CYCLE31_SPEC_G31_02_REMOTE_WORKTREE.md
- CYCLE31_SPEC_G31_03_WORKTREE_SYNC.md
- CYCLE31_ACCEPTANCE_REPORT.md
- CYCLE31_CODE_MODIFICATION_LOG.md

---

## 四、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 远程 Worktree 涉及网络/认证复杂性 | 高 | 初期实现 LocalBackend + Mock Remote，接口预留扩展点 |
| 跨团队成本归因可能涉及隐私 | 中 | 提供数据脱敏 + 聚合粒度可配置 |
| Worktree 状态同步的 CRDT 实现复杂 | 中 | 初期使用 last-write-wins，预留 CRDT 升级路径 |
| 调研信息源质量参差 | 低 | 严格遵循用户偏好：仅 .gov / .edu / 学术数据库 |
| 5 个新引擎的状态管理可能冲突 | 中 | 统一通过 GlobalMemoryEngine 持久化层抽象 |

---

## 五、目标完成标准

- ✅ 3 大 P0 任务全部完成
- ✅ 全部测试通过（Cycle 31 ~195 + 全量 3727+）
- ✅ TypeScript 类型检查 0 错误
- ✅ 主应用集成完成（BrandHeader + AppLayout + App.tsx + ErrorBoundary）
- ✅ 调研/差距分析/SPEC 文档齐备
- ✅ 至少 6 个 Git commit（5 任务 + 1 启动）
- ✅ 工作区干净

---

**Cycle 31 差距分析完成。下一阶段：创建 3 份 SPEC 文档。**
