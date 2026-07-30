# CYCLE31 SPEC - G31-01 团队/项目维度成本归因（CostAttributionEngine）

**任务 ID**：G31-01
**版本**：v1.0.0
**日期**：2026-07-30
**优先级**：P0
**来源调研**：[forum.cursor - Per-Repository Cost Attribution](https://forum.cursor.com/t/per-repository-usage-tracking-for-cost-attribution/154687/1)

---

## 一、目标

实现 `CostAttributionEngine`，支持 org / team / project / repo / user 五维成本归因，对接企业级成本治理 + SSO chargeback 流程。

## 二、核心能力

### 2.1 五维归因层级

```
org (公司)
  └── team (团队)
        └── project (项目)
              └── repo (仓库)
                    └── user (开发者)
```

- **org**：最高层级，对应整个公司账户
- **team**：部门/小组（如前端组、后端组）
- **project**：产品项目（如电商后台）
- **repo**：具体代码仓库
- **user**：开发者

### 2.2 实时归因

- 每次 LLM 调用时自动归属到对应维度
- 通过 `AttributionRecord` 记录：调用时间 + 调用方 + token 数 + 成本 + 归因维度
- 实时累加到所有上层维度（一次调用同时累加 user、repo、project、team、org）

### 2.3 报告生成

- 按维度聚合：sum / avg / min / max / trend
- 趋势分析：日 / 周 / 月 / 自定义时段
- 异常告警：单次成本异常 / 累计超预算
- 实时 Dashboard 所需的所有聚合查询

### 2.4 导出格式

- CSV：标准表头 + 行数据
- JSON：嵌套结构（按维度层级）
- Chargeback 报告：SSO 标签 + 部门 + 金额 + 计费周期

## 三、数据模型

### 3.1 引用类型

```typescript
interface OrgRef { orgId: string; name: string }
interface TeamRef { orgId: string; teamId: string; name: string }
interface ProjectRef { orgId: string; teamId: string; projectId: string; name: string }
interface RepoRef { orgId: string; teamId: string; projectId: string; repoId: string; name: string; url?: string }
interface UserRef { orgId: string; userId: string; name: string; email?: string; ssoId?: string }
```

### 3.2 归因记录

```typescript
interface AttributionRecord {
  id: string;
  timestamp: number;
  user: UserRef;
  repo: RepoRef;
  project: ProjectRef;
  team: TeamRef;
  org: OrgRef;
  source: 'llm-call' | 'agent-run' | 'workflow' | 'manual';
  sourceId?: string;  // 关联的 agent/workflow ID
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  currency: 'USD' | 'CNY' | 'EUR';
  metadata?: Record<string, any>;
}
```

### 3.3 聚合报告

```typescript
interface AttributionReport {
  dimension: 'org' | 'team' | 'project' | 'repo' | 'user';
  scopeId: string;
  scopeName: string;
  period: { from: number; to: number };
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  averageCost: number;
  trend: Array<{ timestamp: number; cost: number }>;
  topUsers?: Array<{ userId: string; cost: number }>;
  topRepos?: Array<{ repoId: string; cost: number }>;
  topModels?: Array<{ model: string; cost: number }>;
}
```

## 四、核心 API

```typescript
class CostAttributionEngine {
  // 5 维注册
  registerOrg(org: OrgRef): void
  registerTeam(team: TeamRef): void
  registerProject(project: ProjectRef): void
  registerRepo(repo: RepoRef): void
  registerUser(user: UserRef): void
  
  // 归因记录
  attribute(record: Omit<AttributionRecord, 'id' | 'timestamp'>): AttributionRecord
  
  // 聚合查询
  getByOrg(orgId: string, period: Period): AttributionReport
  getByTeam(teamId: string, period: Period): AttributionReport
  getByProject(projectId: string, period: Period): AttributionReport
  getByRepo(repoId: string, period: Period): AttributionReport
  getByUser(userId: string, period: Period): AttributionReport
  
  // 复合查询（跨维度）
  getCrossDimensional(filter: CrossDimensionalFilter): AttributionReport
  
  // 异常告警
  getAnomalies(period: Period): AnomalyAlert[]
  setAlertThreshold(dimension: string, threshold: number): void
  
  // 导出
  exportCSV(filter: ExportFilter): string
  exportJSON(filter: ExportFilter): string
  exportChargeback(filter: ExportFilter): ChargebackReport
  
  // 事件订阅
  on(event: AttributionEventType, listener: (e: AttributionEvent) => void): () => void
  
  // 持久化（localStorage）
  reset(): void
}
```

## 五、关键实现

### 5.1 实时累加

每次 `attribute()` 调用：
1. 生成唯一 record ID + timestamp
2. 累加到 user 维度
3. 累加到 repo 维度
4. 累加到 project 维度
5. 累加到 team 维度
6. 累加到 org 维度
7. 触发 `attribution-recorded` 事件

### 5.2 聚合优化

- 内部使用 `Map<string, Aggregate>` 按 (dimension, scopeId, period) 预聚合
- 每次 `attribute()` 直接更新预聚合
- 查询时从预聚合读取，避免全表扫描

### 5.3 异常告警

- 单次成本 > 历史平均 3x → `single-call-anomaly`
- 累计成本 > 阈值 → `budget-overrun`
- 与 Cycle 30 G30-01 CostThresholdAlertEngine 集成

## 六、测试策略

| 测试维度 | 测试数 | 说明 |
|---------|--------|------|
| 五维注册 | 10 | 各维度注册/查询 |
| 归因记录 | 15 | 单次记录、累加正确性 |
| 聚合查询 | 20 | 各维度聚合 + 复合 |
| 异常告警 | 10 | 异常检测 + 阈值告警 |
| 导出 | 10 | CSV/JSON/Chargeback 格式 |
| 事件系统 | 5 | 订阅/退订 |
| 持久化 | 5 | localStorage 保存/加载 |
| 边界条件 | 10 | 0 调用、单维度缺失、跨周期 |
| **合计** | **~85** | 单元测试 |

## 七、UI 组件

### 7.1 CostAttributionPanel（3 Tab 页）

1. **概览 Dashboard**：总成本 + 趋势图 + Top 5
2. **多维分析**：维度切换 + 表格 + 图表
3. **异常告警**：异常列表 + 阈值设置
4. **导出报告**：CSV/JSON/Chargeback 下载

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| 大量归因记录影响性能 | 预聚合 + Map 索引 + 定期 compaction |
| 跨团队成本归因涉及隐私 | 字段脱敏 + 部门权限控制 |
| 汇率换算不一致 | 统一基准货币 + 记录换算 timestamp |

## 九、与现有能力的关系

- **CostBudgetEngine（G28-02）**：单点预算 → 多维归因（上游依赖）
- **CostThresholdAlertEngine（G30-01）**：阈值告警 → 归因异常告警（下游通知）
- **UsageAttributionEngine（G28-03）**：用量归属 → 成本归属（扩展）
- **ModelRouter（G20-02）**：模型选择 → 成本归因（数据源）

---

**G31-01 SPEC 完成。下一阶段：G31-02 SPEC。**
