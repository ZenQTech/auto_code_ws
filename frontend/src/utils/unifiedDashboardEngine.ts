/**
 * # ============================================================
 * # Unified Dashboard Engine - 集成 Dashboard 引擎 (v1.0.1 Cycle 60 G60-FIX-2)
 * # ============================================================
 * # 核心作用：聚合 30+ 引擎关键指标，提供统一 Dashboard 视图
 * # 12+ 预置面板：健康度/成本/任务/审计/告警/用户/模型/Worktree/安全/合规/Skill/会话
 * # 实时采集：定时器 + 订阅推送
 * # 多格式导出：JSON/CSV/PDF
 * # ============================================================
 * # 运行流程：
 * #   1. registerCollector 注册指标采集器
 * #   2. collect / collectAll 采集所有指标
 * #   3. createPanel / createDashboard 管理面板
 * #   4. subscribe 实时订阅指标变化
 * #   5. evaluateThresholds 评估阈值告警
 * #   6. exportDashboard / exportMetricData 导出报告
 * # ============================================================
 * # 输入参数：MetricCollector / DashboardPanel / Dashboard
 * # 输出结果：Metric / Dashboard / ThresholdAlert
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 33 G33-02 初次创建
 * #   - 2026-08-03 | v1.0.1 | Cycle 60 G60-FIX-2 修复：始终使用 DEFAULT_COLLECTORS，
 * #                                    避免 localStorage 反序列化丢失 collect() 函数
 * # ============================================================
 */

// ============ 类型定义 ============

export type MetricCategory = 'health' | 'cost' | 'task' | 'audit' | 'security' | 'compliance' | 'usage';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export type PanelType = 'metric' | 'chart-line' | 'chart-bar' | 'chart-pie' | 'chart-heatmap' | 'list' | 'event-stream';

export type ThresholdSeverity = 'info' | 'warning' | 'critical';

export type DashboardLayout = 'grid-12' | 'grid-16' | 'auto';

export type DashboardTheme = 'light' | 'dark' | 'auto';

export type DashboardEvent =
  | 'metric-collected'
  | 'metric-aggregated'
  | 'panel-updated'
  | 'panel-deleted'
  | 'dashboard-created'
  | 'dashboard-updated'
  | 'dashboard-deleted'
  | 'threshold-exceeded'
  | 'subscription-added'
  | 'subscription-removed'
  | 'collector-added'
  | 'collector-removed';

export interface Metric {
  id: string;
  name: string;
  engineId: string;
  category: MetricCategory;
  type: MetricType;
  value: number;
  unit?: string;
  timestamp: number;
  labels?: Record<string, string>;
  metadata?: Record<string, any>;
}

export interface MetricCollector {
  id: string;
  engineId: string;
  name: string;
  collect: () => Promise<Metric[]> | Metric[];
  intervalMs?: number;
  enabled?: boolean;
}

export interface Threshold {
  value: number;
  comparison: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  severity: ThresholdSeverity;
  color?: string;
  message?: string;
}

export interface PanelConfig {
  timeRange?: { from: number; to: number } | '1h' | '24h' | '7d' | '30d';
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

export interface DashboardPanel {
  id: string;
  title: string;
  description?: string;
  category: MetricCategory;
  type: PanelType;
  metricIds: string[];
  position: { x: number; y: number; w: number; h: number };
  config: PanelConfig;
  refreshIntervalMs?: number;
  thresholds?: Threshold[];
  visible: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  panels: DashboardPanel[];
  layout: DashboardLayout;
  theme: DashboardTheme;
  refreshIntervalMs: number;
  isDefault: boolean;
  ownerId?: string;
  shared: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardSubscription {
  id: string;
  dashboardId: string;
  subscriberId: string;
  callback: (metrics: Metric[]) => void;
  active: boolean;
  createdAt: number;
}

export interface ThresholdAlert {
  id: string;
  metricId: string;
  metricName: string;
  panelId?: string;
  dashboardId?: string;
  threshold: Threshold;
  actualValue: number;
  severity: ThresholdSeverity;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

export interface Period {
  from: number;
  to: number;
}

export interface DashboardEngineConfig {
  persist: boolean;
  storageKey: string;
  defaultRefreshIntervalMs: number;
  collectorIntervalMs: number;
  maxMetrics: number;
  enableAutoCollect: boolean;
  enableThresholdAlerts: boolean;
}

export interface SerializedDashboardState {
  metrics: Metric[];
  panels: DashboardPanel[];
  dashboards: Dashboard[];
  collectors: MetricCollector[];
  alerts: ThresholdAlert[];
  subscriptions: DashboardSubscription[];
  config: Partial<DashboardEngineConfig>;
}

// ============ 默认配置 ============

export const DEFAULT_DASHBOARD_CONFIG: DashboardEngineConfig = {
  persist: true,
  storageKey: 'hermes.unifiedDashboard',
  defaultRefreshIntervalMs: 30000,    // 30 秒
  collectorIntervalMs: 60000,         // 1 分钟
  maxMetrics: 100000,
  enableAutoCollect: true,
  enableThresholdAlerts: true,
};

// ============ 工具函数 ============

export function generateMetricId(engineId: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `m-${engineId}-${slug}-${Date.now().toString(36)}`;
}

export function generatePanelId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateDashboardId(): string {
  return `dash-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateSubscriptionId(): string {
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateAlertId(): string {
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 比较阈值
 */
export function compareThreshold(actual: number, threshold: Threshold): boolean {
  switch (threshold.comparison) {
    case 'gt': return actual > threshold.value;
    case 'gte': return actual >= threshold.value;
    case 'lt': return actual < threshold.value;
    case 'lte': return actual <= threshold.value;
    case 'eq': return actual === threshold.value;
    case 'neq': return actual !== threshold.value;
  }
}

// ============ 12+ 预置面板 ============

export const PRESET_PANELS: Omit<DashboardPanel, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    title: '系统健康度',
    description: '各引擎健康状态 + 错误率',
    category: 'health',
    type: 'metric',
    metricIds: ['m-sso-health', 'm-policy-health', 'm-audit-health', 'm-worktree-health', 'm-cost-health'],
    position: { x: 0, y: 0, w: 6, h: 2 },
    config: { showLegend: true, colorScheme: 'gradient' },
    thresholds: [
      { value: 0.99, comparison: 'lt', severity: 'warning' },
      { value: 0.95, comparison: 'lt', severity: 'critical' },
    ],
    visible: true,
  },
  {
    title: '成本总览',
    description: '今日/本周/本月成本趋势',
    category: 'cost',
    type: 'chart-line',
    metricIds: ['m-cost-today', 'm-cost-week', 'm-cost-month'],
    position: { x: 6, y: 0, w: 6, h: 2 },
    config: { timeRange: '24h', aggregation: 'sum', showLegend: true, showAxes: true },
    visible: true,
  },
  {
    title: '任务队列',
    description: '活跃/等待/完成任务数',
    category: 'task',
    type: 'chart-bar',
    metricIds: ['m-task-active', 'm-task-pending', 'm-task-completed', 'm-task-failed'],
    position: { x: 0, y: 2, w: 4, h: 2 },
    config: { aggregation: 'count', colorScheme: 'categorical' },
    visible: true,
  },
  {
    title: '审计事件流',
    description: '实时审计事件流',
    category: 'audit',
    type: 'event-stream',
    metricIds: ['m-audit-auth', 'm-audit-authz', 'm-audit-data', 'm-audit-admin'],
    position: { x: 4, y: 2, w: 4, h: 2 },
    config: { limit: 50, sortBy: 'timestamp', sortDir: 'desc' },
    visible: true,
  },
  {
    title: '告警中心',
    description: '未处理告警 + 历史告警',
    category: 'security',
    type: 'list',
    metricIds: ['m-alerts-cost', 'm-alerts-security', 'm-alerts-compliance'],
    position: { x: 8, y: 2, w: 4, h: 2 },
    config: { limit: 20 },
    visible: true,
  },
  {
    title: '用户活跃度',
    description: 'DAU/WAU/MAU 趋势',
    category: 'usage',
    type: 'chart-line',
    metricIds: ['m-user-dau', 'm-user-wau', 'm-user-mau'],
    position: { x: 0, y: 4, w: 4, h: 2 },
    config: { timeRange: '7d', showAxes: true, showLegend: true },
    visible: true,
  },
  {
    title: '模型使用分布',
    description: '各 LLM 模型使用占比',
    category: 'cost',
    type: 'chart-pie',
    metricIds: ['m-model-claude', 'm-model-gpt', 'm-model-gemini'],
    position: { x: 4, y: 4, w: 4, h: 2 },
    config: { showLegend: true, colorScheme: 'categorical' },
    visible: true,
  },
  {
    title: 'Worktree 状态',
    description: '活跃 worktree + 同步状态',
    category: 'task',
    type: 'metric',
    metricIds: ['m-worktree-active', 'm-worktree-synced', 'm-worktree-conflict'],
    position: { x: 8, y: 4, w: 4, h: 2 },
    config: { colorScheme: 'default' },
    thresholds: [
      { value: 0, comparison: 'gt', severity: 'warning', message: 'Worktree 冲突' },
    ],
    visible: true,
  },
  {
    title: '安全事件',
    description: '暴力破解/越权/数据外泄/会话劫持',
    category: 'security',
    type: 'list',
    metricIds: ['m-security-bruteforce', 'm-security-unauthorized', 'm-security-dataloss', 'm-security-hijack'],
    position: { x: 0, y: 6, w: 6, h: 2 },
    config: { limit: 20 },
    visible: true,
  },
  {
    title: '合规状态',
    description: 'SOC 2/GDPR/ISO 27001 合规指标',
    category: 'compliance',
    type: 'metric',
    metricIds: ['m-compliance-soc2', 'm-compliance-gdpr', 'm-compliance-iso27001'],
    position: { x: 6, y: 6, w: 3, h: 2 },
    config: {},
    thresholds: [
      { value: 0.95, comparison: 'lt', severity: 'critical', message: '合规分数低于阈值' },
    ],
    visible: true,
  },
  {
    title: 'Skill 使用',
    description: '技能安装/调用/市场统计',
    category: 'usage',
    type: 'chart-bar',
    metricIds: ['m-skill-installed', 'm-skill-invoked', 'm-skill-marketplace'],
    position: { x: 9, y: 6, w: 3, h: 2 },
    config: { aggregation: 'count' },
    visible: true,
  },
  {
    title: '活跃会话',
    description: '活跃会话 + 回放',
    category: 'usage',
    type: 'list',
    metricIds: ['m-session-active', 'm-session-replay'],
    position: { x: 0, y: 8, w: 6, h: 2 },
    config: { limit: 15 },
    visible: true,
  },
];

// ============ 预置默认采集器（mock） ============

export const DEFAULT_COLLECTORS: MetricCollector[] = [
  {
    id: 'collector-sso',
    engineId: 'sso',
    name: 'SSO 引擎指标',
    intervalMs: 30000,
    enabled: true,
    collect: () => [
      { id: 'm-sso-health', name: 'SSO 健康度', engineId: 'sso', category: 'health', type: 'gauge', value: 0.999, timestamp: Date.now(), unit: 'ratio' },
    ],
  },
  {
    id: 'collector-policy',
    engineId: 'policy',
    name: '策略引擎指标',
    intervalMs: 30000,
    enabled: true,
    collect: () => [
      { id: 'm-policy-health', name: 'Policy 健康度', engineId: 'policy', category: 'health', type: 'gauge', value: 1.0, timestamp: Date.now(), unit: 'ratio' },
    ],
  },
  {
    id: 'collector-audit',
    engineId: 'audit',
    name: '审计引擎指标',
    intervalMs: 30000,
    enabled: true,
    collect: () => [
      { id: 'm-audit-health', name: 'Audit 健康度', engineId: 'audit', category: 'health', type: 'gauge', value: 1.0, timestamp: Date.now(), unit: 'ratio' },
      { id: 'm-audit-auth', name: '审计 - 认证事件', engineId: 'audit', category: 'audit', type: 'counter', value: Math.floor(Math.random() * 100), timestamp: Date.now() },
      { id: 'm-audit-authz', name: '审计 - 授权事件', engineId: 'audit', category: 'audit', type: 'counter', value: Math.floor(Math.random() * 100), timestamp: Date.now() },
      { id: 'm-audit-data', name: '审计 - 数据事件', engineId: 'audit', category: 'audit', type: 'counter', value: Math.floor(Math.random() * 100), timestamp: Date.now() },
      { id: 'm-audit-admin', name: '审计 - 管理事件', engineId: 'audit', category: 'audit', type: 'counter', value: Math.floor(Math.random() * 100), timestamp: Date.now() },
    ],
  },
  {
    id: 'collector-cost',
    engineId: 'costAttribution',
    name: '成本归因指标',
    intervalMs: 30000,
    enabled: true,
    collect: () => [
      { id: 'm-cost-health', name: 'Cost 健康度', engineId: 'costAttribution', category: 'health', type: 'gauge', value: 1.0, timestamp: Date.now(), unit: 'ratio' },
      { id: 'm-cost-today', name: '今日成本', engineId: 'costAttribution', category: 'cost', type: 'counter', value: Math.random() * 200, timestamp: Date.now(), unit: 'USD' },
      { id: 'm-cost-week', name: '本周成本', engineId: 'costAttribution', category: 'cost', type: 'counter', value: Math.random() * 1500, timestamp: Date.now(), unit: 'USD' },
      { id: 'm-cost-month', name: '本月成本', engineId: 'costAttribution', category: 'cost', type: 'counter', value: Math.random() * 6000, timestamp: Date.now(), unit: 'USD' },
    ],
  },
  {
    id: 'collector-worktree',
    engineId: 'worktree',
    name: 'Worktree 指标',
    intervalMs: 30000,
    enabled: true,
    collect: () => [
      { id: 'm-worktree-health', name: 'Worktree 健康度', engineId: 'worktree', category: 'health', type: 'gauge', value: 1.0, timestamp: Date.now(), unit: 'ratio' },
      { id: 'm-worktree-active', name: '活跃 Worktree', engineId: 'worktree', category: 'task', type: 'gauge', value: Math.floor(Math.random() * 20), timestamp: Date.now() },
      { id: 'm-worktree-synced', name: '已同步 Worktree', engineId: 'worktree', category: 'task', type: 'gauge', value: Math.floor(Math.random() * 15), timestamp: Date.now() },
      { id: 'm-worktree-conflict', name: '冲突 Worktree', engineId: 'worktree', category: 'task', type: 'gauge', value: Math.floor(Math.random() * 3), timestamp: Date.now() },
    ],
  },
];

// ============ 核心引擎类 ============

export class UnifiedDashboardEngine {
  private config: DashboardEngineConfig;
  private metrics: Map<string, Metric> = new Map();
  private panels: Map<string, DashboardPanel> = new Map();
  private dashboards: Map<string, Dashboard> = new Map();
  private collectors: Map<string, MetricCollector> = new Map();
  private alerts: ThresholdAlert[] = [];
  private subscriptions: Map<string, DashboardSubscription> = new Map();
  private listeners: Map<DashboardEvent, Set<(e: any) => void>> = new Map();
  private collectorTimer: any = null;

  constructor(config: Partial<DashboardEngineConfig> = {}) {
    this.config = { ...DEFAULT_DASHBOARD_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
    // v1.0.1 (Cycle 60 G60-FIX-2)：始终加载默认 collectors
    //   localStorage 序列化的 collector 会丢失 collect() 方法（函数不可序列化），
    //   加载后调用 collector.collect() 会报 "is not a function"。
    //   修复策略：忽略持久化的 collectors，始终用 DEFAULT_COLLECTORS 重新填充，
    //   保证 collect 始终是有效函数。
    this.collectors.clear();
    this.loadDefaultCollectors();
    if (this.config.enableAutoCollect) {
      this.startCollectorTimer();
    }
  }

  // ============ 指标采集 ============

  registerCollector(collector: MetricCollector): void {
    this.collectors.set(collector.id, collector);
    this.emit('collector-added', { collectorId: collector.id });
    if (this.config.persist) this.save();
  }

  unregisterCollector(collectorId: string): void {
    this.collectors.delete(collectorId);
    this.emit('collector-removed', { collectorId });
    if (this.config.persist) this.save();
  }

  getCollector(collectorId: string): MetricCollector | undefined {
    return this.collectors.get(collectorId);
  }

  listCollectors(): MetricCollector[] {
    return Array.from(this.collectors.values());
  }

  async collect(collectorId?: string): Promise<Metric[]> {
    const collectors = collectorId
      ? [this.collectors.get(collectorId)].filter(Boolean) as MetricCollector[]
      : Array.from(this.collectors.values()).filter((c) => c.enabled !== false);
    const allMetrics: Metric[] = [];
    for (const collector of collectors) {
      try {
        const metrics = await Promise.resolve(collector.collect());
        for (const metric of metrics) {
          this.metrics.set(metric.id, metric);
          allMetrics.push(metric);
        }
      } catch (err) {
        console.error(`[Dashboard] Collector ${collector.id} failed:`, err);
      }
    }
    // 限制 metric 数量
    if (this.metrics.size > this.config.maxMetrics) {
      const sorted = Array.from(this.metrics.values()).sort((a, b) => b.timestamp - a.timestamp);
      this.metrics = new Map(sorted.slice(0, this.config.maxMetrics).map((m) => [m.id, m]));
    }
    if (allMetrics.length > 0) {
      this.emit('metric-collected', { count: allMetrics.length });
      // 通知订阅者
      for (const sub of this.subscriptions.values()) {
        if (sub.active) {
          try {
            sub.callback(allMetrics);
          } catch (err) {
            console.error(`[Dashboard] Subscription ${sub.id} callback failed:`, err);
          }
        }
      }
    }
    if (this.config.persist) this.save();
    return allMetrics;
  }

  getMetric(metricId: string, period?: Period): Metric[] {
    const metric = this.metrics.get(metricId);
    if (!metric) return [];
    if (!period) return [metric];
    // For period, just return current metric if within period
    if (metric.timestamp >= period.from && metric.timestamp <= period.to) {
      return [metric];
    }
    return [];
  }

  listMetrics(filter?: { engineId?: string; category?: MetricCategory; from?: number; to?: number }): Metric[] {
    let list = Array.from(this.metrics.values());
    if (filter?.engineId) list = list.filter((m) => m.engineId === filter.engineId);
    if (filter?.category) list = list.filter((m) => m.category === filter.category);
    if (filter?.from) list = list.filter((m) => m.timestamp >= filter.from!);
    if (filter?.to) list = list.filter((m) => m.timestamp <= filter.to!);
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ============ 面板管理 ============

  createPanel(panel: Omit<DashboardPanel, 'id' | 'createdAt' | 'updatedAt'>): DashboardPanel {
    const now = Date.now();
    const full: DashboardPanel = {
      ...panel,
      id: generatePanelId(),
      createdAt: now,
      updatedAt: now,
    };
    this.panels.set(full.id, full);
    this.emit('panel-updated', { panelId: full.id });
    if (this.config.persist) this.save();
    return full;
  }

  updatePanel(panelId: string, updates: Partial<DashboardPanel>): DashboardPanel {
    const existing = this.panels.get(panelId);
    if (!existing) throw new Error(`Panel not found: ${panelId}`);
    const updated = { ...existing, ...updates, id: panelId, updatedAt: Date.now() };
    this.panels.set(panelId, updated);
    this.emit('panel-updated', { panelId });
    if (this.config.persist) this.save();
    return updated;
  }

  deletePanel(panelId: string): void {
    this.panels.delete(panelId);
    this.emit('panel-deleted', { panelId });
    if (this.config.persist) this.save();
  }

  getPanel(panelId: string): DashboardPanel | undefined {
    return this.panels.get(panelId);
  }

  listPanels(filter?: { category?: MetricCategory; visible?: boolean }): DashboardPanel[] {
    let list = Array.from(this.panels.values());
    if (filter?.category) list = list.filter((p) => p.category === filter.category);
    if (filter?.visible !== undefined) list = list.filter((p) => p.visible === filter.visible);
    return list;
  }

  // ============ Dashboard 管理 ============

  createDashboard(dashboard: Omit<Dashboard, 'id' | 'createdAt' | 'updatedAt'>): Dashboard {
    const now = Date.now();
    const full: Dashboard = {
      ...dashboard,
      id: generateDashboardId(),
      createdAt: now,
      updatedAt: now,
    };
    this.dashboards.set(full.id, full);
    this.emit('dashboard-created', { dashboardId: full.id });
    if (this.config.persist) this.save();
    return full;
  }

  updateDashboard(dashboardId: string, updates: Partial<Dashboard>): Dashboard {
    const existing = this.dashboards.get(dashboardId);
    if (!existing) throw new Error(`Dashboard not found: ${dashboardId}`);
    const updated = { ...existing, ...updates, id: dashboardId, updatedAt: Date.now() };
    this.dashboards.set(dashboardId, updated);
    this.emit('dashboard-updated', { dashboardId });
    if (this.config.persist) this.save();
    return updated;
  }

  deleteDashboard(dashboardId: string): void {
    this.dashboards.delete(dashboardId);
    this.emit('dashboard-deleted', { dashboardId });
    if (this.config.persist) this.save();
  }

  getDashboard(dashboardId: string): Dashboard | undefined {
    return this.dashboards.get(dashboardId);
  }

  listDashboards(filter?: { ownerId?: string; shared?: boolean }): Dashboard[] {
    let list = Array.from(this.dashboards.values());
    if (filter?.ownerId) list = list.filter((d) => d.ownerId === filter.ownerId);
    if (filter?.shared !== undefined) list = list.filter((d) => d.shared === filter.shared);
    return list;
  }

  getDefaultDashboard(): Dashboard {
    const def = Array.from(this.dashboards.values()).find((d) => d.isDefault);
    if (def) return def;
    // Create default if none exists
    return this.createDashboard({
      name: 'Default Dashboard',
      description: '默认 Dashboard',
      panels: this.listPanels().filter((p) => p.visible),
      layout: 'grid-12',
      theme: 'dark',
      refreshIntervalMs: this.config.defaultRefreshIntervalMs,
      isDefault: true,
      shared: false,
    });
  }

  // ============ 订阅 ============

  subscribe(dashboardId: string, subscriberId: string, callback: (metrics: Metric[]) => void): DashboardSubscription {
    const sub: DashboardSubscription = {
      id: generateSubscriptionId(),
      dashboardId,
      subscriberId,
      callback,
      active: true,
      createdAt: Date.now(),
    };
    this.subscriptions.set(sub.id, sub);
    this.emit('subscription-added', { subscriptionId: sub.id });
    if (this.config.persist) this.save();
    return sub;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
    this.emit('subscription-removed', { subscriptionId });
    if (this.config.persist) this.save();
  }

  listSubscriptions(dashboardId?: string): DashboardSubscription[] {
    let list = Array.from(this.subscriptions.values());
    if (dashboardId) list = list.filter((s) => s.dashboardId === dashboardId);
    return list;
  }

  // ============ 阈值告警 ============

  evaluateThresholds(metricIds?: string[]): ThresholdAlert[] {
    if (!this.config.enableThresholdAlerts) return [];
    const newAlerts: ThresholdAlert[] = [];
    const targetMetrics = metricIds
      ? metricIds.map((id) => this.metrics.get(id)).filter(Boolean) as Metric[]
      : Array.from(this.metrics.values());
    for (const metric of targetMetrics) {
      // 找到引用此 metric 的所有面板
      const panels = this.listPanels().filter((p) => p.metricIds.includes(metric.id));
      for (const panel of panels) {
        if (!panel.thresholds) continue;
        for (const threshold of panel.thresholds) {
          if (compareThreshold(metric.value, threshold)) {
            const alert: ThresholdAlert = {
              id: generateAlertId(),
              metricId: metric.id,
              metricName: metric.name,
              panelId: panel.id,
              threshold,
              actualValue: metric.value,
              severity: threshold.severity,
              message: threshold.message || `${metric.name} 超过阈值 ${threshold.value}`,
              timestamp: Date.now(),
              acknowledged: false,
            };
            this.alerts.push(alert);
            newAlerts.push(alert);
            this.emit('threshold-exceeded', { alert });
          }
        }
      }
    }
    if (newAlerts.length > 0 && this.config.persist) this.save();
    return newAlerts;
  }

  listThresholdAlerts(filter?: { severity?: ThresholdSeverity; acknowledged?: boolean }): ThresholdAlert[] {
    let list = [...this.alerts];
    if (filter?.severity) list = list.filter((a) => a.severity === filter.severity);
    if (filter?.acknowledged !== undefined) list = list.filter((a) => a.acknowledged === filter.acknowledged);
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }

  acknowledgeAlert(alertId: string, userId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedBy = userId;
      alert.acknowledgedAt = Date.now();
      if (this.config.persist) this.save();
    }
  }

  // ============ 引擎健康度 ============

  getEngineHealth(): Record<string, { status: 'healthy' | 'degraded' | 'down'; lastCheck: number; error?: string }> {
    const result: Record<string, { status: 'healthy' | 'degraded' | 'down'; lastCheck: number; error?: string }> = {};
    for (const collector of this.collectors.values()) {
      const lastMetric = this.listMetrics({ engineId: collector.engineId })[0];
      if (!lastMetric) {
        result[collector.engineId] = { status: 'down', lastCheck: 0, error: 'No data' };
      } else if (lastMetric.value < 0.95 && lastMetric.category === 'health') {
        result[collector.engineId] = { status: 'degraded', lastCheck: lastMetric.timestamp };
      } else {
        result[collector.engineId] = { status: 'healthy', lastCheck: lastMetric.timestamp };
      }
    }
    return result;
  }

  // ============ 导出 ============

  exportDashboard(dashboardId: string, format: 'json' | 'csv' | 'pdf'): string {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) throw new Error(`Dashboard not found: ${dashboardId}`);
    if (format === 'json') {
      return JSON.stringify(dashboard, null, 2);
    }
    if (format === 'csv') {
      const lines: string[] = ['Panel Title,Category,Type,Metric Count,Visible'];
      for (const panel of dashboard.panels) {
        lines.push(`"${panel.title}",${panel.category},${panel.type},${panel.metricIds.length},${panel.visible}`);
      }
      return lines.join('\n');
    }
    // PDF - 简化版（实际环境会使用 pdf 库）
    return `Dashboard: ${dashboard.name}\nPanels: ${dashboard.panels.length}\nLayout: ${dashboard.layout}\nTheme: ${dashboard.theme}`;
  }

  exportMetricData(metricIds: string[], period: Period, format: 'json' | 'csv'): string {
    const metrics: Metric[] = [];
    for (const id of metricIds) {
      metrics.push(...this.getMetric(id, period));
    }
    if (format === 'json') {
      return JSON.stringify(metrics, null, 2);
    }
    const lines: string[] = ['id,name,engineId,category,type,value,unit,timestamp'];
    for (const m of metrics) {
      lines.push(`${m.id},${m.name},${m.engineId},${m.category},${m.type},${m.value},${m.unit || ''},${m.timestamp}`);
    }
    return lines.join('\n');
  }

  // ============ 事件订阅 ============

  on(event: DashboardEvent, listener: (e: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: DashboardEvent, data?: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener({ type: event, timestamp: Date.now(), data });
        } catch (err) {
          console.error(`[Dashboard] Listener error for ${event}:`, err);
        }
      }
    }
  }

  // ============ 统计 ============

  getStats(): { totalMetrics: number; totalPanels: number; totalDashboards: number; totalSubscriptions: number; totalCollectors: number; totalAlerts: number; unacknowledgedAlerts: number } {
    return {
      totalMetrics: this.metrics.size,
      totalPanels: this.panels.size,
      totalDashboards: this.dashboards.size,
      totalSubscriptions: this.subscriptions.size,
      totalCollectors: this.collectors.size,
      totalAlerts: this.alerts.length,
      unacknowledgedAlerts: this.alerts.filter((a) => !a.acknowledged).length,
    };
  }

  getConfig(): DashboardEngineConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<DashboardEngineConfig>): void {
    this.config = { ...this.config, ...updates };
    if (this.config.enableAutoCollect) {
      this.startCollectorTimer();
    } else {
      this.stopCollectorTimer();
    }
    if (this.config.persist) this.save();
  }

  clear(): void {
    this.metrics.clear();
    this.panels.clear();
    this.dashboards.clear();
    this.alerts = [];
    this.subscriptions.clear();
    if (this.config.persist) this.save();
  }

  // ============ 内部方法 ============

  private loadDefaultCollectors(): void {
    for (const collector of DEFAULT_COLLECTORS) {
      this.collectors.set(collector.id, collector);
    }
  }

  private startCollectorTimer(): void {
    this.stopCollectorTimer();
    if (typeof setInterval === 'undefined') return;
    this.collectorTimer = setInterval(() => {
      this.collect().catch((err) => {
        console.error('[Dashboard] Auto-collect failed:', err);
      });
    }, this.config.collectorIntervalMs);
  }

  private stopCollectorTimer(): void {
    if (this.collectorTimer) {
      clearInterval(this.collectorTimer);
      this.collectorTimer = null;
    }
  }

  private save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const state: SerializedDashboardState = {
        metrics: Array.from(this.metrics.values()).slice(-1000),
        panels: Array.from(this.panels.values()),
        dashboards: Array.from(this.dashboards.values()),
        collectors: Array.from(this.collectors.values()),
        alerts: this.alerts.slice(-1000),
        subscriptions: Array.from(this.subscriptions.values()),
        config: this.config,
      };
      localStorage.setItem(this.config.storageKey, JSON.stringify(state));
    } catch (err) {
      console.warn('[Dashboard] Failed to save state:', err);
    }
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.config.storageKey);
      if (!raw) return;
      const state: SerializedDashboardState = JSON.parse(raw);
      if (state.metrics) this.metrics = new Map(state.metrics.map((m) => [m.id, m]));
      if (state.panels) this.panels = new Map(state.panels.map((p) => [p.id, p]));
      if (state.dashboards) this.dashboards = new Map(state.dashboards.map((d) => [d.id, d]));
      if (state.collectors) this.collectors = new Map(state.collectors.map((c) => [c.id, c]));
      if (state.alerts) this.alerts = state.alerts;
      if (state.subscriptions) this.subscriptions = new Map(state.subscriptions.map((s) => [s.id, s]));
      if (state.config) this.config = { ...this.config, ...state.config };
    } catch (err) {
      console.warn('[Dashboard] Failed to load state:', err);
    }
  }
}

// ============ 单例 ============

let defaultInstance: UnifiedDashboardEngine | null = null;

export function getDefaultDashboardEngine(): UnifiedDashboardEngine {
  if (!defaultInstance) {
    defaultInstance = new UnifiedDashboardEngine();
  }
  return defaultInstance;
}

export function resetDefaultDashboardEngine(): void {
  if (defaultInstance) {
    defaultInstance.clear();
  }
  defaultInstance = null;
}
