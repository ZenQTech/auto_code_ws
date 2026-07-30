/**
 * # ============================================================
 * # Cost Attribution Engine - 成本归因引擎 (v1.0.0 Cycle 31 G31-01)
 * # ============================================================
 * # 核心作用：实现 org → team → project → repo → user 五维成本归因
 * # 实时聚合：每次 attribute() 调用累加到所有上层维度
 * # 报告生成：按维度聚合 + 趋势分析 + 异常告警 + 多格式导出
 * # 参考：forum.cursor - Per-Repository Cost Attribution (2026-03-13)
 * #      Vibes to Bucks - per-workspace/git/folder 成本归因
 * #      Future AGI - per-developer virtual keys + per-repo span attributes
 * # ============================================================
 * # 运行流程：
 * #   1. 初始化引擎 + 默认配置
 * #   2. registerOrg/registerTeam/registerProject/registerRepo/registerUser 注册维度
 * #   3. attribute(record) 归因单次调用，自动累加到 5 维
 * #   4. 触发 attribution-recorded 事件
 * #   5. getByOrg/getByTeam/getByProject/getByRepo/getByUser 聚合查询
 * #   6. getCrossDimensional 跨维度复合查询
 * #   7. getAnomalies 异常检测（单次异常 + 预算超支）
 * #   8. exportCSV/exportJSON/exportChargeback 多格式导出
 * # ============================================================
 * # 输入参数：record（5 维引用 + 调用信息 + 成本）
 * # 输出结果：AttributionRecord / AttributionReport / ChargebackReport
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 31 G31-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 5 维引用类型
 */
export interface OrgRef { orgId: string; name: string }
export interface TeamRef { orgId: string; teamId: string; name: string }
export interface ProjectRef { orgId: string; teamId: string; projectId: string; name: string }
export interface RepoRef { orgId: string; teamId: string; projectId: string; repoId: string; name: string; url?: string }
export interface UserRef { orgId: string; userId: string; name: string; email?: string; ssoId?: string }

/**
 * 归因记录
 */
export interface AttributionRecord {
  id: string;
  timestamp: number;
  user: UserRef;
  repo: RepoRef;
  project: ProjectRef;
  team: TeamRef;
  org: OrgRef;
  source: 'llm-call' | 'agent-run' | 'workflow' | 'manual';
  sourceId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  currency: 'USD' | 'CNY' | 'EUR';
  metadata?: Record<string, any>;
}

/**
 * 时段
 */
export interface Period {
  from: number;
  to: number;
  granularity?: 'hour' | 'day' | 'week' | 'month';
}

/**
 * 趋势数据点
 */
export interface TrendPoint {
  timestamp: number;
  cost: number;
}

/**
 * 聚合报告
 */
export interface AttributionReport {
  dimension: 'org' | 'team' | 'project' | 'repo' | 'user';
  scopeId: string;
  scopeName: string;
  period: Period;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  averageCost: number;
  trend: TrendPoint[];
  topUsers?: Array<{ userId: string; cost: number }>;
  topRepos?: Array<{ repoId: string; cost: number }>;
  topModels?: Array<{ model: string; cost: number }>;
}

/**
 * 异常告警
 */
export interface AnomalyAlert {
  id: string;
  type: 'single-call-anomaly' | 'budget-overrun';
  scope: { dimension: string; scopeId: string };
  currentValue: number;
  threshold: number;
  baseline?: number;
  timestamp: number;
  message: string;
  recordId?: string;
}

/**
 * 跨维度过滤
 */
export interface CrossDimensionalFilter {
  orgId?: string;
  teamId?: string;
  projectId?: string;
  repoId?: string;
  userId?: string;
  model?: string;
  source?: AttributionRecord['source'];
  period: Period;
  groupBy?: 'org' | 'team' | 'project' | 'repo' | 'user';
  sortBy?: 'cost' | 'tokens' | 'calls';
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

/**
 * 导出过滤
 */
export interface ExportFilter {
  orgId?: string;
  teamId?: string;
  projectId?: string;
  period: Period;
  format?: 'csv' | 'json' | 'chargeback';
}

/**
 * Chargeback 报告
 */
export interface ChargebackReport {
  period: Period;
  generatedAt: number;
  totalAmount: number;
  currency: string;
  lineItems: Array<{
    ssoId: string;
    userName: string;
    teamId: string;
    teamName: string;
    projectId: string;
    projectName: string;
    cost: number;
    callCount: number;
  }>;
}

/**
 * 引擎事件类型
 */
export type AttributionEventType =
  | 'attribution-recorded'
  | 'org-registered'
  | 'team-registered'
  | 'project-registered'
  | 'repo-registered'
  | 'user-registered'
  | 'anomaly-detected'
  | 'export-completed';

export interface AttributionEvent {
  type: AttributionEventType;
  timestamp: number;
  data: unknown;
}

/**
 * 引擎配置
 */
export interface AttributionEngineConfig {
  baseCurrency: 'USD' | 'CNY' | 'EUR';
  exchangeRates: Record<string, number>;  // baseCurrency -> 1, others -> rate
  anomalyMultiplier: number;             // 单次异常倍数（默认 3）
  maxRecords: number;                    // 最大记录数（默认 100000）
  persist: boolean;
}

export interface SerializedAttributionState {
  records: AttributionRecord[];
  orgs: OrgRef[];
  teams: TeamRef[];
  projects: ProjectRef[];
  repos: RepoRef[];
  users: UserRef[];
  alertThresholds: Record<string, number>;
}

// ============ 默认配置 ============

export const DEFAULT_ATTRIBUTION_CONFIG: AttributionEngineConfig = {
  baseCurrency: 'USD',
  exchangeRates: { USD: 1, CNY: 7.2, EUR: 0.92 },
  anomalyMultiplier: 3,
  maxRecords: 100000,
  persist: true,
};

// ============ 工具函数 ============

export function generateAttributionId(): string {
  return `attr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateAnomalyId(): string {
  return `anom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function convertToBase(amount: number, currency: string, config: AttributionEngineConfig): number {
  if (currency === config.baseCurrency) return amount;
  const rate = config.exchangeRates[currency];
  if (!rate) return amount;
  // 其他货币转 USD（假设 baseCurrency = USD）
  return amount / rate;
}

// ============ 引擎主类 ============

export class CostAttributionEngine {
  private config: AttributionEngineConfig;
  private records: AttributionRecord[] = [];
  private orgs: Map<string, OrgRef> = new Map();
  private teams: Map<string, TeamRef> = new Map();
  private projects: Map<string, ProjectRef> = new Map();
  private repos: Map<string, RepoRef> = new Map();
  private users: Map<string, UserRef> = new Map();
  private alertThresholds: Map<string, number> = new Map();
  private listeners: Map<AttributionEventType, Set<(e: AttributionEvent) => void>> = new Map();
  private storageKey = 'hermes.costAttribution';

  constructor(config: Partial<AttributionEngineConfig> = {}) {
    this.config = { ...DEFAULT_ATTRIBUTION_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const state: SerializedAttributionState = JSON.parse(raw);
        if (Array.isArray(state.records)) this.records = state.records;
        if (Array.isArray(state.orgs)) for (const o of state.orgs) this.orgs.set(o.orgId, o);
        if (Array.isArray(state.teams)) for (const t of state.teams) this.teams.set(t.teamId, t);
        if (Array.isArray(state.projects)) for (const p of state.projects) this.projects.set(p.projectId, p);
        if (Array.isArray(state.repos)) for (const r of state.repos) this.repos.set(r.repoId, r);
        if (Array.isArray(state.users)) for (const u of state.users) this.users.set(u.userId, u);
        if (state.alertThresholds) {
          for (const [k, v] of Object.entries(state.alertThresholds)) {
            this.alertThresholds.set(k, v);
          }
        }
      }
    } catch (e) {
      console.warn('CostAttributionEngine: failed to load state', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state: SerializedAttributionState = {
        records: this.records.slice(-this.config.maxRecords),
        orgs: Array.from(this.orgs.values()),
        teams: Array.from(this.teams.values()),
        projects: Array.from(this.projects.values()),
        repos: Array.from(this.repos.values()),
        users: Array.from(this.users.values()),
        alertThresholds: Object.fromEntries(this.alertThresholds),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('CostAttributionEngine: failed to save state', e);
    }
  }

  // ============ 5 维注册 ============

  registerOrg(org: OrgRef): void {
    this.orgs.set(org.orgId, org);
    this.save();
    this.emit('org-registered', { org });
  }

  registerTeam(team: TeamRef): void {
    this.teams.set(team.teamId, team);
    this.save();
    this.emit('team-registered', { team });
  }

  registerProject(project: ProjectRef): void {
    this.projects.set(project.projectId, project);
    this.save();
    this.emit('project-registered', { project });
  }

  registerRepo(repo: RepoRef): void {
    this.repos.set(repo.repoId, repo);
    this.save();
    this.emit('repo-registered', { repo });
  }

  registerUser(user: UserRef): void {
    this.users.set(user.userId, user);
    this.save();
    this.emit('user-registered', { user });
  }

  getOrg(orgId: string): OrgRef | undefined { return this.orgs.get(orgId); }
  getTeam(teamId: string): TeamRef | undefined { return this.teams.get(teamId); }
  getProject(projectId: string): ProjectRef | undefined { return this.projects.get(projectId); }
  getRepo(repoId: string): RepoRef | undefined { return this.repos.get(repoId); }
  getUser(userId: string): UserRef | undefined { return this.users.get(userId); }

  listOrgs(): OrgRef[] { return Array.from(this.orgs.values()); }
  listTeams(): TeamRef[] { return Array.from(this.teams.values()); }
  listProjects(): ProjectRef[] { return Array.from(this.projects.values()); }
  listRepos(): RepoRef[] { return Array.from(this.repos.values()); }
  listUsers(): UserRef[] { return Array.from(this.users.values()); }

  // ============ 归因记录 ============

  attribute(input: Omit<AttributionRecord, 'id' | 'timestamp'>): AttributionRecord {
    const record: AttributionRecord = {
      id: generateAttributionId(),
      timestamp: Date.now(),
      ...input,
      totalCost: convertToBase(input.totalCost, input.currency, this.config),
      currency: this.config.baseCurrency,
    };
    this.records.push(record);
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }
    this.save();
    this.emit('attribution-recorded', { record });
    this.checkAnomaly(record);
    return record;
  }

  // ============ 聚合查询 ============

  getByOrg(orgId: string, period: Period): AttributionReport {
    const org = this.orgs.get(orgId);
    const filtered = this.records.filter(
      (r) => r.org.orgId === orgId && r.timestamp >= period.from && r.timestamp <= period.to
    );
    return this.buildReport('org', orgId, org?.name || orgId, period, filtered);
  }

  getByTeam(teamId: string, period: Period): AttributionReport {
    const team = this.teams.get(teamId);
    const filtered = this.records.filter(
      (r) => r.team.teamId === teamId && r.timestamp >= period.from && r.timestamp <= period.to
    );
    return this.buildReport('team', teamId, team?.name || teamId, period, filtered);
  }

  getByProject(projectId: string, period: Period): AttributionReport {
    const project = this.projects.get(projectId);
    const filtered = this.records.filter(
      (r) => r.project.projectId === projectId && r.timestamp >= period.from && r.timestamp <= period.to
    );
    return this.buildReport('project', projectId, project?.name || projectId, period, filtered);
  }

  getByRepo(repoId: string, period: Period): AttributionReport {
    const repo = this.repos.get(repoId);
    const filtered = this.records.filter(
      (r) => r.repo.repoId === repoId && r.timestamp >= period.from && r.timestamp <= period.to
    );
    return this.buildReport('repo', repoId, repo?.name || repoId, period, filtered);
  }

  getByUser(userId: string, period: Period): AttributionReport {
    const user = this.users.get(userId);
    const filtered = this.records.filter(
      (r) => r.user.userId === userId && r.timestamp >= period.from && r.timestamp <= period.to
    );
    return this.buildReport('user', userId, user?.name || userId, period, filtered);
  }

  private buildReport(
    dimension: AttributionReport['dimension'],
    scopeId: string,
    scopeName: string,
    period: Period,
    records: AttributionRecord[]
  ): AttributionReport {
    const totalCost = records.reduce((sum, r) => sum + r.totalCost, 0);
    const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
    const callCount = records.length;
    const averageCost = callCount > 0 ? totalCost / callCount : 0;

    const trend: TrendPoint[] = this.buildTrend(records, period);

    const topUsers = this.buildTopN(records, 'user', 5);
    const topRepos = this.buildTopN(records, 'repo', 5);
    const topModels = this.buildTopModels(records, 5);

    return {
      dimension,
      scopeId,
      scopeName,
      period,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      callCount,
      averageCost,
      trend,
      topUsers: topUsers as AttributionReport['topUsers'],
      topRepos: topRepos as AttributionReport['topRepos'],
      topModels,
    };
  }

  private buildTrend(records: AttributionRecord[], period: Period): TrendPoint[] {
    const granularity = period.granularity || 'day';
    const interval = granularity === 'hour' ? 3600000 : granularity === 'day' ? 86400000 : granularity === 'week' ? 604800000 : 2592000000;
    const buckets: Map<number, number> = new Map();
    for (const r of records) {
      const bucket = Math.floor(r.timestamp / interval) * interval;
      buckets.set(bucket, (buckets.get(bucket) || 0) + r.totalCost);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([timestamp, cost]) => ({ timestamp, cost }));
  }

  private buildTopN(records: AttributionRecord[], key: 'user' | 'repo', n: number): Array<{ [k: string]: string | number; cost: number }> {
    const totals: Map<string, number> = new Map();
    for (const r of records) {
      const id = key === 'user' ? r.user.userId : r.repo.repoId;
      totals.set(id, (totals.get(id) || 0) + r.totalCost);
    }
    return Array.from(totals.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([id, cost]) => {
        if (key === 'user') return { userId: id, cost };
        return { repoId: id, cost };
      }) as any;
  }

  private buildTopModels(records: AttributionRecord[], n: number): Array<{ model: string; cost: number }> {
    const totals: Map<string, number> = new Map();
    for (const r of records) {
      totals.set(r.model, (totals.get(r.model) || 0) + r.totalCost);
    }
    return Array.from(totals.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([model, cost]) => ({ model, cost }));
  }

  // ============ 跨维度复合查询 ============

  getCrossDimensional(filter: CrossDimensionalFilter): AttributionReport {
    const filtered = this.records.filter((r) => {
      if (filter.orgId && r.org.orgId !== filter.orgId) return false;
      if (filter.teamId && r.team.teamId !== filter.teamId) return false;
      if (filter.projectId && r.project.projectId !== filter.projectId) return false;
      if (filter.repoId && r.repo.repoId !== filter.repoId) return false;
      if (filter.userId && r.user.userId !== filter.userId) return false;
      if (filter.model && r.model !== filter.model) return false;
      if (filter.source && r.source !== filter.source) return false;
      if (r.timestamp < filter.period.from || r.timestamp > filter.period.to) return false;
      return true;
    });

    if (!filter.groupBy) {
      // 汇总为单一报告
      return this.buildReport('org', filter.orgId || 'all', 'All Scopes', filter.period, filtered);
    }

    const dimension = filter.groupBy;
    const key = dimension === 'user' ? 'userId' : `${dimension}Id`;
    const grouped: Map<string, AttributionRecord[]> = new Map();
    for (const r of filtered) {
      const id = (r as any)[dimension][key];
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id)!.push(r);
    }

    // 取最大一组作为代表报告
    let maxId = '';
    let maxCount = 0;
    for (const [id, recs] of grouped) {
      if (recs.length > maxCount) {
        maxId = id;
        maxCount = recs.length;
      }
    }

    const records = grouped.get(maxId) || [];
    return this.buildReport(dimension, maxId, maxId, filter.period, records);
  }

  // ============ 异常告警 ============

  setAlertThreshold(dimension: string, threshold: number): void {
    this.alertThresholds.set(dimension, threshold);
    this.save();
  }

  getAlertThreshold(dimension: string): number | undefined {
    return this.alertThresholds.get(dimension);
  }

  private checkAnomaly(record: AttributionRecord): void {
    // 单次成本异常：当前 > 历史平均 * multiplier
    const recentRecords = this.records.filter((r) => r.user.userId === record.user.userId).slice(-20);
    if (recentRecords.length >= 5) {
      const avg = recentRecords.slice(0, -1).reduce((s, r) => s + r.totalCost, 0) / (recentRecords.length - 1);
      if (record.totalCost > avg * this.config.anomalyMultiplier && avg > 0) {
        const alert: AnomalyAlert = {
          id: generateAnomalyId(),
          type: 'single-call-anomaly',
          scope: { dimension: 'user', scopeId: record.user.userId },
          currentValue: record.totalCost,
          threshold: avg * this.config.anomalyMultiplier,
          baseline: avg,
          timestamp: Date.now(),
          message: `User ${record.user.name} call cost ${record.totalCost.toFixed(2)} is ${(record.totalCost / avg).toFixed(1)}x average`,
          recordId: record.id,
        };
        this.emit('anomaly-detected', { alert });
      }
    }

    // 预算超支：当前累计 > 阈值
    const threshold = this.alertThresholds.get(`user:${record.user.userId}`) ||
      this.alertThresholds.get(`org:${record.org.orgId}`);
    if (threshold) {
      const userTotal = this.records
        .filter((r) => r.user.userId === record.user.userId)
        .reduce((s, r) => s + r.totalCost, 0);
      if (userTotal > threshold) {
        const alert: AnomalyAlert = {
          id: generateAnomalyId(),
          type: 'budget-overrun',
          scope: { dimension: 'user', scopeId: record.user.userId },
          currentValue: userTotal,
          threshold,
          timestamp: Date.now(),
          message: `User ${record.user.name} total cost ${userTotal.toFixed(2)} exceeded budget ${threshold.toFixed(2)}`,
        };
        this.emit('anomaly-detected', { alert });
      }
    }
  }

  getAnomalies(period: Period): AnomalyAlert[] {
    // 简单实现：返回预算超支告警列表
    const alerts: AnomalyAlert[] = [];
    const userTotals: Map<string, number> = new Map();
    for (const r of this.records) {
      if (r.timestamp < period.from || r.timestamp > period.to) continue;
      userTotals.set(r.user.userId, (userTotals.get(r.user.userId) || 0) + r.totalCost);
    }
    for (const [userId, total] of userTotals) {
      const threshold = this.alertThresholds.get(`user:${userId}`);
      if (threshold && total > threshold) {
        const user = this.users.get(userId);
        alerts.push({
          id: generateAnomalyId(),
          type: 'budget-overrun',
          scope: { dimension: 'user', scopeId: userId },
          currentValue: total,
          threshold,
          timestamp: Date.now(),
          message: `User ${user?.name || userId} total cost ${total.toFixed(2)} exceeded budget ${threshold.toFixed(2)}`,
        });
      }
    }
    return alerts;
  }

  // ============ 导出 ============

  exportCSV(filter: ExportFilter): string {
    const filtered = this.records.filter((r) => {
      if (filter.orgId && r.org.orgId !== filter.orgId) return false;
      if (filter.teamId && r.team.teamId !== filter.teamId) return false;
      if (filter.projectId && r.project.projectId !== filter.projectId) return false;
      if (r.timestamp < filter.period.from || r.timestamp > filter.period.to) return false;
      return true;
    });
    const header = 'id,timestamp,org,team,project,repo,user,model,inputTokens,outputTokens,totalCost,currency\n';
    const rows = filtered.map((r) =>
      [
        r.id,
        new Date(r.timestamp).toISOString(),
        r.org.orgId,
        r.team.teamId,
        r.project.projectId,
        r.repo.repoId,
        r.user.userId,
        r.model,
        r.inputTokens,
        r.outputTokens,
        r.totalCost.toFixed(4),
        r.currency,
      ].join(',')
    );
    return header + rows.join('\n');
  }

  exportJSON(filter: ExportFilter): string {
    const filtered = this.records.filter((r) => {
      if (filter.orgId && r.org.orgId !== filter.orgId) return false;
      if (filter.teamId && r.team.teamId !== filter.teamId) return false;
      if (filter.projectId && r.project.projectId !== filter.projectId) return false;
      if (r.timestamp < filter.period.from || r.timestamp > filter.period.to) return false;
      return true;
    });
    return JSON.stringify({ records: filtered, generatedAt: Date.now() }, null, 2);
  }

  exportChargeback(filter: ExportFilter): ChargebackReport {
    const filtered = this.records.filter((r) => {
      if (filter.orgId && r.org.orgId !== filter.orgId) return false;
      if (r.timestamp < filter.period.from || r.timestamp > filter.period.to) return false;
      return true;
    });

    const lineItemsMap: Map<string, ChargebackReport['lineItems'][0]> = new Map();
    for (const r of filtered) {
      const key = `${r.user.userId}-${r.team.teamId}-${r.project.projectId}`;
      if (!lineItemsMap.has(key)) {
        lineItemsMap.set(key, {
          ssoId: r.user.ssoId || r.user.userId,
          userName: r.user.name,
          teamId: r.team.teamId,
          teamName: r.team.name,
          projectId: r.project.projectId,
          projectName: r.project.name,
          cost: 0,
          callCount: 0,
        });
      }
      const item = lineItemsMap.get(key)!;
      item.cost += r.totalCost;
      item.callCount += 1;
    }

    return {
      period: filter.period,
      generatedAt: Date.now(),
      totalAmount: Array.from(lineItemsMap.values()).reduce((s, i) => s + i.cost, 0),
      currency: this.config.baseCurrency,
      lineItems: Array.from(lineItemsMap.values()),
    };
  }

  // ============ 事件系统 ============

  on(event: AttributionEventType, listener: (e: AttributionEvent) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  private emit(type: AttributionEventType, data: unknown): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener({ type, timestamp: Date.now(), data });
        } catch (e) {
          console.error('CostAttributionEngine listener error', e);
        }
      }
    }
  }

  // ============ 辅助 ============

  getRecordCount(): number { return this.records.length; }
  getRecords(filter?: (r: AttributionRecord) => boolean): AttributionRecord[] {
    return filter ? this.records.filter(filter) : [...this.records];
  }
  clearRecords(): void {
    this.records = [];
    this.save();
  }
  reset(): void {
    this.records = [];
    this.orgs.clear();
    this.teams.clear();
    this.projects.clear();
    this.repos.clear();
    this.users.clear();
    this.alertThresholds.clear();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.storageKey);
    }
  }
}

// ============ 单例 ============

let defaultEngine: CostAttributionEngine | null = null;

export function getDefaultCostAttributionEngine(): CostAttributionEngine {
  if (!defaultEngine) {
    defaultEngine = new CostAttributionEngine();
  }
  return defaultEngine;
}

export function resetDefaultCostAttributionEngine(): void {
  if (defaultEngine) {
    defaultEngine.reset();
  }
  defaultEngine = null;
}
