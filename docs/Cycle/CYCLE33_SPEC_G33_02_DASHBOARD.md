# G33-02 UnifiedDashboardEngine 详细 SPEC

**周期**：Cycle 33 (v6.93.0)  
**任务**：G33-02 统一 Dashboard 引擎  
**日期**：2026-07-30

---

## 一、目标

实现统一 Dashboard 引擎，聚合 30+ 引擎关键指标，提供 12+ 预置面板，实时推送。

---

## 二、设计原则

1. **单一入口**：所有引擎指标集中展示
2. **实时刷新**：WebSocket / SSE 推送
3. **可自定义**：用户可配置面板布局
4. **下钻分析**：点击查看详情
5. **多格式导出**：JSON/CSV/PDF

---

## 三、核心类型定义

```typescript
// 指标
export interface Metric {
  id: string;                                    // m-<engine>-<name>
  name: string;
  engineId: string;
  category: 'health' | 'cost' | 'task' | 'audit' | 'security' | 'compliance' | 'usage';
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  value: number;
  unit?: string;
  timestamp: number;
  labels?: Record<string, string>;
  metadata?: Record<string, any>;
}

// 指标采集器
export interface MetricCollector {
  id: string;
  engineId: string;
  name: string;
  collect: () => Promise<Metric[]>;
  intervalMs?: number;
}

// 面板
export interface DashboardPanel {
  id: string;                                    // p-<random>
  title: string;
  description?: string;
  category: 'health' | 'cost' | 'task' | 'audit' | 'security' | 'compliance' | 'usage';
  type: 'metric' | 'chart-line' | 'chart-bar' | 'chart-pie' | 'chart-heatmap' | 'list' | 'event-stream';
  metricIds: string[];                           // 引用的指标
  position: { x: number; y: number; w: number; h: number };  // Grid 位置
  config: PanelConfig;
  refreshIntervalMs?: number;
  thresholds?: Threshold[];
  visible: boolean;
}

// 面板配置
export interface PanelConfig {
  timeRange?: { from: number; to: number };
  aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  groupBy?: string[];
  filter?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  showLegend?: boolean;
  showAxes?: boolean;
  colorScheme?: 'default' | 'monochrome' | 'gradient' | 'categorical';
}

// 阈值
export interface Threshold {
  value: number;
  comparison: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  severity: 'info' | 'warning' | 'critical';
  color?: string;
  message?: string;
}

// Dashboard
export interface Dashboard {
  id: string;                                    // dash-<random>
  name: string;
  description?: string;
  panels: DashboardPanel[];
  layout: 'grid-12' | 'grid-16' | 'auto';
  theme: 'light' | 'dark' | 'auto';
  refreshIntervalMs: number;
  isDefault: boolean;
  ownerId?: string;
  shared: boolean;
  createdAt: number;
  updatedAt: number;
}

// 订阅
export interface DashboardSubscription {
  id: string;
  dashboardId: string;
  subscriberId: string;
  callback: (metrics: Metric[]) => void;
  active: boolean;
  createdAt: number;
}

// 事件
export type DashboardEvent =
  | 'metric-collected'
  | 'panel-updated'
  | 'dashboard-created'
  | 'dashboard-updated'
  | 'dashboard-deleted'
  | 'threshold-exceeded'
  | 'subscription-added'
  | 'subscription-removed';
```

---

## 四、核心 API

```typescript
export class UnifiedDashboardEngine {
  // 指标采集
  registerCollector(collector: MetricCollector): void;
  unregisterCollector(collectorId: string): void;
  collect(collectorId?: string): Promise<Metric[]>;
  getMetric(metricId: string, period?: Period): Metric[];
  listMetrics(filter?: { engineId?: string; category?: string }): Metric[];

  // 面板管理
  createPanel(panel: Omit<DashboardPanel, 'id'>): DashboardPanel;
  updatePanel(panelId: string, updates: Partial<DashboardPanel>): DashboardPanel;
  deletePanel(panelId: string): void;
  getPanel(panelId: string): DashboardPanel | undefined;
  listPanels(filter?: { category?: string; visible?: boolean }): DashboardPanel[];

  // Dashboard 管理
  createDashboard(dashboard: Omit<Dashboard, 'id' | 'createdAt' | 'updatedAt'>): Dashboard;
  updateDashboard(dashboardId: string, updates: Partial<Dashboard>): Dashboard;
  deleteDashboard(dashboardId: string): void;
  getDashboard(dashboardId: string): Dashboard | undefined;
  listDashboards(filter?: { ownerId?: string; shared?: boolean }): Dashboard[];
  getDefaultDashboard(): Dashboard;

  // 订阅（实时推送）
  subscribe(dashboardId: string, subscriberId: string, callback: (metrics: Metric[]) => void): DashboardSubscription;
  unsubscribe(subscriptionId: string): void;
  listSubscriptions(dashboardId: string): DashboardSubscription[];

  // 阈值告警
  evaluateThresholds(): ThresholdAlert[];
  listThresholdAlerts(filter?: { severity?: Threshold['severity']; acknowledged?: boolean }): ThresholdAlert[];

  // 导出
  exportDashboard(dashboardId: string, format: 'json' | 'csv' | 'pdf'): string | Promise<Blob>;
  exportMetricData(metricIds: string[], period: Period, format: 'json' | 'csv'): string;

  // 事件订阅
  on(event: DashboardEvent, listener: (e: any) => void): () => void;

  // 统计
  getStats(): { totalMetrics: number; totalPanels: number; totalDashboards: number; totalSubscriptions: number; totalCollectors: number };
  getEngineHealth(): Record<string, { status: 'healthy' | 'degraded' | 'down'; lastCheck: number; error?: string }>;
}
```

---

## 五、12+ 预置面板

### 5.1 系统健康度（health-overview）
```typescript
{
  title: '系统健康度',
  category: 'health',
  type: 'metric',
  metricIds: ['health-sso', 'health-policy', 'health-audit', 'health-worktree', 'health-cost'],
  thresholds: [
    { value: 0.99, comparison: 'lt', severity: 'warning' },
    { value: 0.95, comparison: 'lt', severity: 'critical' },
  ]
}
```

### 5.2 成本总览（cost-overview）
```typescript
{
  title: '成本总览',
  category: 'cost',
  type: 'chart-line',
  metricIds: ['cost-today', 'cost-week', 'cost-month'],
  config: { timeRange: '24h', aggregation: 'sum' }
}
```

### 5.3 任务队列（task-queue）
```typescript
{
  title: '任务队列',
  category: 'task',
  type: 'chart-bar',
  metricIds: ['task-active', 'task-pending', 'task-completed', 'task-failed'],
}
```

### 5.4 审计事件流（audit-stream）
```typescript
{
  title: '审计事件流',
  category: 'audit',
  type: 'event-stream',
  metricIds: ['audit-events-auth', 'audit-events-authz', 'audit-events-data', 'audit-events-admin'],
  config: { limit: 50, sortBy: 'timestamp', sortDir: 'desc' }
}
```

### 5.5 告警中心（alert-center）
```typescript
{
  title: '告警中心',
  category: 'security',
  type: 'list',
  metricIds: ['alerts-cost', 'alerts-security', 'alerts-compliance'],
}
```

### 5.6 用户活跃度（user-activity）
```typescript
{
  title: '用户活跃度',
  category: 'usage',
  type: 'chart-line',
  metricIds: ['user-dau', 'user-wau', 'user-mau'],
}
```

### 5.7 模型使用分布（model-usage）
```typescript
{
  title: '模型使用分布',
  category: 'cost',
  type: 'chart-pie',
  metricIds: ['model-claude', 'model-gpt', 'model-gemini'],
}
```

### 5.8 Worktree 状态（worktree-status）
```typescript
{
  title: 'Worktree 状态',
  category: 'task',
  type: 'metric',
  metricIds: ['worktree-active', 'worktree-synced', 'worktree-conflict'],
}
```

### 5.9 安全事件（security-events）
```typescript
{
  title: '安全事件',
  category: 'security',
  type: 'list',
  metricIds: ['security-bruteforce', 'security-unauthorized', 'security-dataloss', 'security-hijack'],
}
```

### 5.10 合规状态（compliance-status）
```typescript
{
  title: '合规状态',
  category: 'compliance',
  type: 'metric',
  metricIds: ['compliance-soc2', 'compliance-gdpr', 'compliance-iso27001'],
}
```

### 5.11 Skill 使用（skill-usage）
```typescript
{
  title: 'Skill 使用统计',
  category: 'usage',
  type: 'chart-bar',
  metricIds: ['skill-installed', 'skill-invoked', 'skill-marketplace'],
}
```

### 5.12 会话回放（session-replay）
```typescript
{
  title: '活跃会话',
  category: 'usage',
  type: 'list',
  metricIds: ['session-active', 'session-replay'],
}
```

---

## 六、预置指标采集器

```typescript
const DEFAULT_COLLECTORS: MetricCollector[] = [
  {
    id: 'collector-sso',
    engineId: 'sso',
    name: 'SSO 引擎指标',
    collect: async () => [
      { id: 'health-sso', name: 'SSO 健康度', engineId: 'sso', category: 'health', type: 'gauge', value: 0.999, timestamp: Date.now() },
      { id: 'sso-sessions-active', name: '活跃会话', engineId: 'sso', category: 'usage', type: 'gauge', value: 142, timestamp: Date.now() },
    ],
  },
  {
    id: 'collector-cost',
    engineId: 'costAttribution',
    name: '成本归因指标',
    collect: async () => [
      { id: 'cost-today', name: '今日成本', engineId: 'costAttribution', category: 'cost', type: 'counter', value: 124.50, unit: 'USD', timestamp: Date.now() },
    ],
  },
  // ... 30+ 采集器
];
```

---

## 七、UI 组件设计

`UnifiedDashboardPanel`：
- 12+ 预置面板 Grid 布局
- 实时数据刷新（WebSocket）
- 阈值告警高亮
- 暗色主题切换
- 自定义面板配置对话框
- 导出报告

---

## 八、测试策略

### 8.1 单元测试（≥ 80 覆盖）
- 指标采集
- 面板 CRUD
- Dashboard CRUD
- 订阅管理
- 阈值评估
- 导出多格式
- 引擎健康度
- 事件订阅

### 8.2 集成测试
- 12+ 预置面板渲染
- 30+ 引擎指标采集
- 实时推送（mock WebSocket）

---

## 九、依赖

- 所有 Cycle 22-32 引擎
- localStorage / IndexedDB 持久化

---

## 十、验收标准

- [ ] 12+ 预置面板可渲染
- [ ] 30+ 引擎指标采集
- [ ] 实时数据刷新
- [ ] 阈值告警正常
- [ ] 暗色主题支持
- [ ] 单元测试 ≥ 80 覆盖
- [ ] E2E 集成测试通过
