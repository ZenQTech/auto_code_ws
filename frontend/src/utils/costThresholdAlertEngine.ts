/**
 * # ============================================================
 * # Cost Threshold Alert Engine - 成本阈值告警引擎 (v1.0.0 Cycle 30 G30-01)
 * # ============================================================
 * # 核心作用：实现多级阈值告警 + 提额申请 + 强制阻断
 * # 阈值：warning(75%) / critical(90%) / blocked(100%)
 * # Scope：org / team / user 三层预算隔离
 * # 参考：Claude Enterprise Cost Threshold Alert (2026-07-02) + claude-cost-guard
 * # ============================================================
 * # 运行流程：
 * #   1. 初始化引擎 + 默认配置
 * #   2. recordSpend(scope, amount) 记录花费
 * #   3. checkThresholds(scope) 检测阈值跨越
 * #   4. 跨越时触发 alert-triggered 事件
 * #   5. 订阅者发送通知（in-app / email / webhook）
 * #   6. enforceBlock(scope) 强制阻断超限执行
 * #   7. requestQuotaIncrease() 提额申请
 * #   8. reviewQuotaRequest() 审批申请
 * #   9. applyApprovedRequest() 应用审批
 * # ============================================================
 * # 输入参数：scope/amount/source（监控） + reqId/decision（审批）
 * # 输出结果：SpendAlert / QuotaRequest / BlockRecord / NotificationRecord
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 30 G30-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 告警级别
 * - info: 信息性提示
 * - warning: 警告（达到 warning 阈值，默认 75%）
 * - critical: 严重（达到 critical 阈值，默认 90%）
 * - blocked: 阻断（达到 blocked 阈值，默认 100%）
 */
export type AlertLevel = 'info' | 'warning' | 'critical' | 'blocked';

/**
 * 阈值配置
 * - warning: 警告阈值（0-1）
 * - critical: 严重阈值（0-1）
 * - blocked: 阻断阈值（0-1）
 */
export interface ThresholdConfig {
  warning: number;
  critical: number;
  blocked: number;
}

/**
 * 预算范围引用
 */
export interface ScopeRef {
  scope: 'org' | 'team' | 'user';
  scopeId: string;
}

/**
 * 告警记录
 */
export interface SpendAlert {
  id: string;
  scope: ScopeRef;
  level: AlertLevel;
  threshold: number;
  currentSpend: number;
  budget: number;
  utilization: number;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

/**
 * 提额申请
 */
export interface QuotaRequest {
  id: string;
  requester: string;
  scope: ScopeRef;
  currentBudget: number;
  requestedBudget: number;
  incrementAmount: number;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'applied' | 'cancelled';
  reviewer?: string;
  reviewComment?: string;
  reviewedAt?: number;
  appliedAt?: number;
  createdAt: number;
}

/**
 * 通知渠道
 */
export type NotificationChannel = 'in-app' | 'email' | 'webhook';

/**
 * 通知配置
 */
export interface NotificationConfig {
  channels: NotificationChannel[];
  emailRecipients?: string[];
  webhookUrl?: string;
}

/**
 * 通知记录
 */
export interface NotificationRecord {
  id: string;
  alertId: string;
  channel: NotificationChannel;
  recipient: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: number;
  error?: string;
  timestamp: number;
}

/**
 * 阻断记录
 */
export interface BlockRecord {
  id: string;
  scope: ScopeRef;
  blockedAt: number;
  reason: string;
  bypassed: boolean;
  bypassedBy?: string;
  bypassedAt?: number;
  bypassReason?: string;
}

/**
 * 引擎配置
 */
export interface AlertEngineConfig {
  thresholds: {
    org: ThresholdConfig;
    team: ThresholdConfig;
    user: ThresholdConfig;
  };
  notifications: {
    inApp: NotificationConfig;
    email: NotificationConfig;
    webhook: NotificationConfig;
  };
  maxAlertsPerScope: number;
  maxQuotaRequests: number;
  autoEnforceBlock: boolean;
  persist: boolean;
}

/**
 * 引擎事件
 */
export type AlertEventType =
  | 'alert-triggered'
  | 'alert-acknowledged'
  | 'quota-requested'
  | 'quota-reviewed'
  | 'quota-applied'
  | 'quota-cancelled'
  | 'notification-sent'
  | 'notification-failed'
  | 'block-enforced'
  | 'block-bypassed'
  | 'spend-recorded'
  | 'budget-set';

export interface AlertEvent {
  type: AlertEventType;
  timestamp: number;
  data: unknown;
}

/**
 * 序列化状态
 */
export interface SerializedAlertState {
  alerts: SpendAlert[];
  quotaRequests: QuotaRequest[];
  notifications: NotificationRecord[];
  blocks: BlockRecord[];
  budgets: Array<{
    key: string;
    budget: number;
    spend: number;
    thresholds: ThresholdConfig;
  }>;
  lastAlertedLevels: Array<{ key: string; level: AlertLevel }>;
}

// ============ 默认配置 ============

export const DEFAULT_THRESHOLD_CONFIG: ThresholdConfig = {
  warning: 0.75,
  critical: 0.9,
  blocked: 1.0,
};

export const DEFAULT_ALERT_CONFIG: AlertEngineConfig = {
  thresholds: {
    org: { ...DEFAULT_THRESHOLD_CONFIG },
    team: { ...DEFAULT_THRESHOLD_CONFIG },
    user: { ...DEFAULT_THRESHOLD_CONFIG },
  },
  notifications: {
    inApp: { channels: ['in-app'] },
    email: { channels: ['email'], emailRecipients: [] },
    webhook: { channels: ['webhook'], webhookUrl: '' },
  },
  maxAlertsPerScope: 50,
  maxQuotaRequests: 100,
  autoEnforceBlock: true,
  persist: true,
};

// ============ 工具函数 ============

/**
 * 生成唯一 ID
 */
export function generateAlertId(prefix: string = 'alert'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Scope 引用转 key
 */
export function scopeKey(ref: ScopeRef): string {
  return `${ref.scope}:${ref.scopeId}`;
}

/**
 * 比较告警级别
 * @returns > 0 if a > b, < 0 if a < b, 0 if equal
 */
export function compareAlertLevel(a: AlertLevel, b: AlertLevel): number {
  const order: AlertLevel[] = ['info', 'warning', 'critical', 'blocked'];
  return order.indexOf(a) - order.indexOf(b);
}

/**
 * 告警级别显示文本
 */
export function alertLevelLabel(level: AlertLevel): string {
  switch (level) {
    case 'info':
      return '信息';
    case 'warning':
      return '警告';
    case 'critical':
      return '严重';
    case 'blocked':
      return '已阻断';
  }
}

// ============ 引擎主类 ============

/**
 * CostThresholdAlertEngine - 成本阈值告警引擎
 *
 * 实现多级阈值告警、提额申请工作流、强制阻断、事件通知等功能。
 * 与 CostBudgetEngine 互补，专注于告警与审批流程。
 */
export class CostThresholdAlertEngine {
  private config: AlertEngineConfig;
  private budgets: Map<string, number> = new Map();
  private spends: Map<string, number> = new Map();
  private thresholds: Map<string, ThresholdConfig> = new Map();
  private lastAlertedLevels: Map<string, AlertLevel> = new Map();
  private alerts: SpendAlert[] = [];
  private quotaRequests: QuotaRequest[] = [];
  private notifications: NotificationRecord[] = [];
  private blocks: BlockRecord[] = [];
  private listeners: Map<AlertEventType, Set<(e: AlertEvent) => void>> = new Map();
  private storageKey = 'hermes.costThresholdAlert';

  constructor(config: Partial<AlertEngineConfig> = {}) {
    this.config = { ...DEFAULT_ALERT_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  /**
   * 从 localStorage 加载状态
   */
  private load(): void {
    try {
      const raw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(this.storageKey)
          : null;
      if (raw) {
        const state: SerializedAlertState = JSON.parse(raw);
        if (state && Array.isArray(state.alerts)) {
          this.alerts = state.alerts;
        }
        if (state && Array.isArray(state.quotaRequests)) {
          this.quotaRequests = state.quotaRequests;
        }
        if (state && Array.isArray(state.notifications)) {
          this.notifications = state.notifications;
        }
        if (state && Array.isArray(state.blocks)) {
          this.blocks = state.blocks;
        }
        if (state && Array.isArray(state.budgets)) {
          for (const item of state.budgets) {
            this.budgets.set(item.key, item.budget);
            this.spends.set(item.key, item.spend);
            this.thresholds.set(item.key, item.thresholds);
          }
        }
        if (state && Array.isArray(state.lastAlertedLevels)) {
          for (const item of state.lastAlertedLevels) {
            this.lastAlertedLevels.set(item.key, item.level);
          }
        }
      }
    } catch (e) {
      console.warn('CostThresholdAlertEngine: failed to load state', e);
    }
  }

  /**
   * 保存状态到 localStorage
   */
  private save(): void {
    if (!this.config.persist) return;
    try {
      const state: SerializedAlertState = {
        alerts: this.alerts,
        quotaRequests: this.quotaRequests,
        notifications: this.notifications,
        blocks: this.blocks,
        budgets: Array.from(this.budgets.entries()).map(([key, budget]) => ({
          key,
          budget,
          spend: this.spends.get(key) ?? 0,
          thresholds:
            this.thresholds.get(key) ?? DEFAULT_THRESHOLD_CONFIG,
        })),
        lastAlertedLevels: Array.from(this.lastAlertedLevels.entries()).map(
          ([key, level]) => ({ key, level })
        ),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('CostThresholdAlertEngine: failed to save state', e);
    }
  }

  // ============ 事件总线 ============

  /**
   * 订阅事件
   * @returns 取消订阅的函数
   */
  on(event: AlertEventType, listener: (e: AlertEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * 取消订阅
   */
  off(event: AlertEventType, listener: (e: AlertEvent) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  /**
   * 触发事件
   */
  private emit(event: AlertEvent): void {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of set) {
        try {
          fn(event);
        } catch (e) {
          console.error('CostThresholdAlertEngine listener error:', e);
        }
      }
    }
  }

  // ============ 阈值配置 ============

  /**
   * 设置指定 scope 的阈值配置
   */
  setThresholds(scope: ScopeRef, config: Partial<ThresholdConfig>): void {
    const key = scopeKey(scope);
    const current =
      this.thresholds.get(key) ??
      (this.config.thresholds[scope.scope] ?? DEFAULT_THRESHOLD_CONFIG);
    const updated: ThresholdConfig = { ...current, ...config };
    this.thresholds.set(key, updated);
    this.save();
  }

  /**
   * 获取指定 scope 的阈值配置
   */
  getThresholds(scope: ScopeRef): ThresholdConfig {
    const key = scopeKey(scope);
    return (
      this.thresholds.get(key) ??
      (this.config.thresholds[scope.scope] ?? DEFAULT_THRESHOLD_CONFIG)
    );
  }

  // ============ 预算管理 ============

  /**
   * 设置指定 scope 的预算
   */
  setBudget(scope: ScopeRef, budget: number): void {
    if (budget < 0) {
      throw new Error('Budget must be non-negative');
    }
    const key = scopeKey(scope);
    this.budgets.set(key, budget);
    if (!this.spends.has(key)) {
      this.spends.set(key, 0);
    }
    this.save();
    this.emit({
      type: 'budget-set',
      timestamp: Date.now(),
      data: { scope, budget },
    });
  }

  /**
   * 获取指定 scope 的预算
   */
  getBudget(scope: ScopeRef): number {
    return this.budgets.get(scopeKey(scope)) ?? 0;
  }

  /**
   * 获取当前已花费
   */
  getCurrentSpend(scope: ScopeRef): number {
    return this.spends.get(scopeKey(scope)) ?? 0;
  }

  /**
   * 获取预算利用率（0-1）
   */
  getUtilization(scope: ScopeRef): number {
    const budget = this.getBudget(scope);
    if (budget === 0) return 0;
    return this.getCurrentSpend(scope) / budget;
  }

  // ============ 监控 ============

  /**
   * 记录一次花费
   * @returns 触发的新告警
   */
  recordSpend(
    scope: ScopeRef,
    amount: number,
    source: string
  ): SpendAlert[] {
    if (amount < 0) {
      throw new Error('Amount must be non-negative');
    }
    const key = scopeKey(scope);
    const current = this.spends.get(key) ?? 0;
    this.spends.set(key, current + amount);
    this.save();

    this.emit({
      type: 'spend-recorded',
      timestamp: Date.now(),
      data: { scope, amount, source, total: current + amount },
    });

    return this.checkThresholds(scope);
  }

  /**
   * 检查阈值并触发告警
   * @returns 新触发的告警
   */
  checkThresholds(scope: ScopeRef): SpendAlert[] {
    const budget = this.getBudget(scope);
    if (budget <= 0) return [];

    const spend = this.getCurrentSpend(scope);
    const utilization = spend / budget;
    const thresholds = this.getThresholds(scope);
    const key = scopeKey(scope);
    const lastLevel = this.lastAlertedLevels.get(key) ?? null;

    const triggered: SpendAlert[] = [];

    // 按级别顺序检查，只在升级时触发
    const levelChecks: Array<{ level: AlertLevel; threshold: number }> = [
      { level: 'warning', threshold: thresholds.warning },
      { level: 'critical', threshold: thresholds.critical },
      { level: 'blocked', threshold: thresholds.blocked },
    ];

    for (const { level, threshold } of levelChecks) {
      if (utilization >= threshold) {
        if (!lastLevel || compareAlertLevel(level, lastLevel) > 0) {
          const alert = this.createAlert(scope, level, threshold, spend, budget, utilization);
          triggered.push(alert);
          this.lastAlertedLevels.set(key, level);
        }
      }
    }

    if (triggered.length > 0) {
      this.save();
    }

    return triggered;
  }

  /**
   * 创建告警
   */
  private createAlert(
    scope: ScopeRef,
    level: AlertLevel,
    threshold: number,
    currentSpend: number,
    budget: number,
    utilization: number
  ): SpendAlert {
    const alert: SpendAlert = {
      id: generateAlertId('alert'),
      scope,
      level,
      threshold,
      currentSpend,
      budget,
      utilization,
      message: this.buildAlertMessage(scope, level, utilization),
      timestamp: Date.now(),
      acknowledged: false,
    };
    this.alerts.push(alert);
    this.trimAlerts(scope);

    this.emit({
      type: 'alert-triggered',
      timestamp: Date.now(),
      data: { alert },
    });

    return alert;
  }

  /**
   * 构造告警消息
   */
  private buildAlertMessage(
    scope: ScopeRef,
    level: AlertLevel,
    utilization: number
  ): string {
    const pct = (utilization * 100).toFixed(1);
    switch (level) {
      case 'warning':
        return `${scope.scope}/${scope.scopeId} 已使用 ${pct}% 预算，达到警告阈值`;
      case 'critical':
        return `${scope.scope}/${scope.scopeId} 已使用 ${pct}% 预算，达到严重阈值，需要立即关注`;
      case 'blocked':
        return `${scope.scope}/${scope.scopeId} 已使用 ${pct}% 预算，超过 100%，新执行将被阻断`;
      case 'info':
        return `${scope.scope}/${scope.scopeId} 提示信息`;
    }
  }

  /**
   * 限制每个 scope 的告警数
   */
  private trimAlerts(scope: ScopeRef): void {
    const scopeAlerts = this.alerts.filter(
      (a) => scopeKey(a.scope) === scopeKey(scope)
    );
    if (scopeAlerts.length > this.config.maxAlertsPerScope) {
      // 移除最旧的告警
      const toRemove = scopeAlerts.length - this.config.maxAlertsPerScope;
      const removeIds = new Set(
        scopeAlerts
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, toRemove)
          .map((a) => a.id)
      );
      this.alerts = this.alerts.filter((a) => !removeIds.has(a.id));
    }
  }

  /**
   * 获取所有活跃告警（未确认）
   */
  getActiveAlerts(scope?: ScopeRef): SpendAlert[] {
    return this.alerts.filter((a) => {
      if (a.acknowledged) return false;
      if (scope && scopeKey(a.scope) !== scopeKey(scope)) return false;
      return true;
    });
  }

  /**
   * 获取告警历史
   */
  getAlertHistory(scope?: ScopeRef, limit?: number): SpendAlert[] {
    let result = this.alerts;
    if (scope) {
      result = result.filter((a) => scopeKey(a.scope) === scopeKey(scope));
    }
    result = [...result].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? result.slice(0, limit) : result;
  }

  /**
   * 获取所有告警（包括已确认）
   */
  getAllAlerts(scope?: ScopeRef): SpendAlert[] {
    if (scope) {
      return this.alerts.filter((a) => scopeKey(a.scope) === scopeKey(scope));
    }
    return [...this.alerts];
  }

  /**
   * 根据 ID 获取告警
   */
  getAlert(alertId: string): SpendAlert | undefined {
    return this.alerts.find((a) => a.id === alertId);
  }

  // ============ 告警确认 ============

  /**
   * 确认告警
   */
  acknowledge(alertId: string, userId: string): SpendAlert {
    const alert = this.getAlert(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }
    alert.acknowledged = true;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = Date.now();
    this.save();

    this.emit({
      type: 'alert-acknowledged',
      timestamp: Date.now(),
      data: { alert, userId },
    });

    return alert;
  }

  // ============ 提额申请 ============

  /**
   * 提交提额申请
   */
  requestQuotaIncrease(req: {
    requester: string;
    scope: ScopeRef;
    requestedBudget: number;
    reason: string;
  }): QuotaRequest {
    if (req.requestedBudget <= this.getBudget(req.scope)) {
      throw new Error('Requested budget must be greater than current budget');
    }
    const request: QuotaRequest = {
      id: generateAlertId('quota'),
      requester: req.requester,
      scope: req.scope,
      currentBudget: this.getBudget(req.scope),
      requestedBudget: req.requestedBudget,
      incrementAmount: req.requestedBudget - this.getBudget(req.scope),
      reason: req.reason,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.quotaRequests.push(request);
    this.trimQuotaRequests();
    this.save();

    this.emit({
      type: 'quota-requested',
      timestamp: Date.now(),
      data: { request },
    });

    return request;
  }

  /**
   * 审批提额申请
   */
  reviewQuotaRequest(
    reqId: string,
    decision: 'approved' | 'denied',
    reviewer: string,
    comment?: string
  ): QuotaRequest {
    const request = this.getQuotaRequest(reqId);
    if (!request) {
      throw new Error(`Quota request ${reqId} not found`);
    }
    if (request.status !== 'pending') {
      throw new Error(`Quota request ${reqId} is in status ${request.status}`);
    }
    request.status = decision;
    request.reviewer = reviewer;
    request.reviewComment = comment;
    request.reviewedAt = Date.now();
    this.save();

    this.emit({
      type: 'quota-reviewed',
      timestamp: Date.now(),
      data: { request, decision, reviewer },
    });

    return request;
  }

  /**
   * 应用已批准的提额申请
   */
  applyApprovedRequest(reqId: string): QuotaRequest {
    const request = this.getQuotaRequest(reqId);
    if (!request) {
      throw new Error(`Quota request ${reqId} not found`);
    }
    if (request.status !== 'approved') {
      throw new Error(
        `Quota request ${reqId} is in status ${request.status}, cannot apply`
      );
    }
    // 更新预算
    this.setBudget(request.scope, request.requestedBudget);
    // 重置该 scope 的 lastAlertedLevel（因为预算变了）
    this.lastAlertedLevels.delete(scopeKey(request.scope));
    // 标记为已应用
    request.status = 'applied';
    request.appliedAt = Date.now();
    this.save();

    this.emit({
      type: 'quota-applied',
      timestamp: Date.now(),
      data: { request },
    });

    return request;
  }

  /**
   * 取消提额申请
   */
  cancelQuotaRequest(reqId: string, requester: string): QuotaRequest {
    const request = this.getQuotaRequest(reqId);
    if (!request) {
      throw new Error(`Quota request ${reqId} not found`);
    }
    if (request.requester !== requester) {
      throw new Error('Only the requester can cancel the request');
    }
    if (request.status !== 'pending') {
      throw new Error(`Cannot cancel request in status ${request.status}`);
    }
    request.status = 'cancelled';
    this.save();

    this.emit({
      type: 'quota-cancelled',
      timestamp: Date.now(),
      data: { request },
    });

    return request;
  }

  /**
   * 获取提额申请
   */
  getQuotaRequest(reqId: string): QuotaRequest | undefined {
    return this.quotaRequests.find((r) => r.id === reqId);
  }

  /**
   * 列出提额申请
   */
  listQuotaRequests(filter?: {
    status?: QuotaRequest['status'];
    scope?: ScopeRef;
  }): QuotaRequest[] {
    let result = this.quotaRequests;
    if (filter?.status) {
      result = result.filter((r) => r.status === filter.status);
    }
    if (filter?.scope) {
      const key = scopeKey(filter.scope);
      result = result.filter((r) => scopeKey(r.scope) === key);
    }
    return [...result].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 限制提额申请数
   */
  private trimQuotaRequests(): void {
    if (this.quotaRequests.length > this.config.maxQuotaRequests) {
      this.quotaRequests = this.quotaRequests
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, this.config.maxQuotaRequests);
    }
  }

  // ============ 阻断控制 ============

  /**
   * 检查是否被阻断
   */
  isBlocked(scope: ScopeRef): boolean {
    const budget = this.getBudget(scope);
    if (budget <= 0) return false;
    const utilization = this.getUtilization(scope);
    const thresholds = this.getThresholds(scope);
    return utilization >= thresholds.blocked;
  }

  /**
   * 强制执行阻断检查
   */
  enforceBlock(scope: ScopeRef): {
    allowed: boolean;
    reason?: string;
    alert?: SpendAlert;
  } {
    if (!this.isBlocked(scope)) {
      return { allowed: true };
    }
    if (!this.config.autoEnforceBlock) {
      return { allowed: true };
    }
    const reason = `Scope ${scope.scope}/${scope.scopeId} is blocked due to budget exceeded`;
    const blockRecord: BlockRecord = {
      id: generateAlertId('block'),
      scope,
      blockedAt: Date.now(),
      reason,
      bypassed: false,
    };
    this.blocks.push(blockRecord);
    this.save();

    this.emit({
      type: 'block-enforced',
      timestamp: Date.now(),
      data: { scope, blockRecord },
    });

    const alert = this.getActiveAlerts(scope).find((a) => a.level === 'blocked');
    return { allowed: false, reason, alert };
  }

  /**
   * 绕过阻断
   */
  bypassBlock(scope: ScopeRef, userId: string, reason: string): BlockRecord {
    const utilization = this.getUtilization(scope);
    const blockRecord: BlockRecord = {
      id: generateAlertId('block'),
      scope,
      blockedAt: Date.now(),
      reason: `Bypassed by ${userId}: ${reason}`,
      bypassed: true,
      bypassedBy: userId,
      bypassedAt: Date.now(),
      bypassReason: reason,
    };
    this.blocks.push(blockRecord);
    this.save();

    this.emit({
      type: 'block-bypassed',
      timestamp: Date.now(),
      data: { scope, blockRecord, utilization },
    });

    return blockRecord;
  }

  /**
   * 获取阻断记录
   */
  getBlockHistory(scope?: ScopeRef): BlockRecord[] {
    let result = this.blocks;
    if (scope) {
      const key = scopeKey(scope);
      result = result.filter((b) => scopeKey(b.scope) === key);
    }
    return [...result].sort((a, b) => b.blockedAt - a.blockedAt);
  }

  // ============ 通知 ============

  /**
   * 发送通知
   */
  sendNotification(alert: SpendAlert, config: NotificationConfig): NotificationRecord[] {
    const records: NotificationRecord[] = [];

    for (const channel of config.channels) {
      const recipients = this.getRecipients(channel, config);
      for (const recipient of recipients) {
        const record: NotificationRecord = {
          id: generateAlertId('notif'),
          alertId: alert.id,
          channel,
          recipient,
          status: 'sent',  // mock 总是成功
          sentAt: Date.now(),
          timestamp: Date.now(),
        };
        records.push(record);
        this.notifications.push(record);

        this.emit({
          type: 'notification-sent',
          timestamp: Date.now(),
          data: { record, alert },
        });
      }
    }

    this.save();
    return records;
  }

  /**
   * 获取通知收件人
   */
  private getRecipients(channel: NotificationChannel, config: NotificationConfig): string[] {
    switch (channel) {
      case 'in-app':
        return ['all-admins'];
      case 'email':
        return config.emailRecipients ?? [];
      case 'webhook':
        return config.webhookUrl ? [config.webhookUrl] : [];
    }
  }

  /**
   * 获取通知记录
   */
  getNotificationHistory(alertId?: string): NotificationRecord[] {
    let result = this.notifications;
    if (alertId) {
      result = result.filter((n) => n.alertId === alertId);
    }
    return [...result].sort((a, b) => b.timestamp - a.timestamp);
  }

  // ============ 统计 ============

  /**
   * 获取告警统计
   */
  getStats(scope?: ScopeRef): {
    totalAlerts: number;
    activeAlerts: number;
    alertsByLevel: Record<AlertLevel, number>;
    pendingRequests: number;
    approvedRequests: number;
    deniedRequests: number;
    appliedRequests: number;
    cancelledRequests: number;
    blockEvents: number;
    bypassedEvents: number;
    notificationsSent: number;
  } {
    const alerts = scope
      ? this.alerts.filter((a) => scopeKey(a.scope) === scopeKey(scope))
      : this.alerts;
    const requests = scope
      ? this.quotaRequests.filter(
          (r) => scopeKey(r.scope) === scopeKey(scope)
        )
      : this.quotaRequests;
    const blocks = scope
      ? this.blocks.filter((b) => scopeKey(b.scope) === scopeKey(scope))
      : this.blocks;

    return {
      totalAlerts: alerts.length,
      activeAlerts: alerts.filter((a) => !a.acknowledged).length,
      alertsByLevel: {
        info: alerts.filter((a) => a.level === 'info').length,
        warning: alerts.filter((a) => a.level === 'warning').length,
        critical: alerts.filter((a) => a.level === 'critical').length,
        blocked: alerts.filter((a) => a.level === 'blocked').length,
      },
      pendingRequests: requests.filter((r) => r.status === 'pending').length,
      approvedRequests: requests.filter((r) => r.status === 'approved').length,
      deniedRequests: requests.filter((r) => r.status === 'denied').length,
      appliedRequests: requests.filter((r) => r.status === 'applied').length,
      cancelledRequests: requests.filter((r) => r.status === 'cancelled').length,
      blockEvents: blocks.filter((b) => !b.bypassed).length,
      bypassedEvents: blocks.filter((b) => b.bypassed).length,
      notificationsSent: this.notifications.length,
    };
  }

  // ============ 持久化 ============

  /**
   * 导出状态
   */
  exportState(): SerializedAlertState {
    return {
      alerts: this.alerts,
      quotaRequests: this.quotaRequests,
      notifications: this.notifications,
      blocks: this.blocks,
      budgets: Array.from(this.budgets.entries()).map(([key, budget]) => ({
        key,
        budget,
        spend: this.spends.get(key) ?? 0,
        thresholds:
          this.thresholds.get(key) ?? DEFAULT_THRESHOLD_CONFIG,
      })),
      lastAlertedLevels: Array.from(this.lastAlertedLevels.entries()).map(
        ([key, level]) => ({ key, level })
      ),
    };
  }

  /**
   * 导入状态
   */
  importState(state: SerializedAlertState): void {
    this.alerts = state.alerts ?? [];
    this.quotaRequests = state.quotaRequests ?? [];
    this.notifications = state.notifications ?? [];
    this.blocks = state.blocks ?? [];
    this.budgets.clear();
    this.spends.clear();
    this.thresholds.clear();
    this.lastAlertedLevels.clear();
    for (const item of state.budgets ?? []) {
      this.budgets.set(item.key, item.budget);
      this.spends.set(item.key, item.spend);
      this.thresholds.set(item.key, item.thresholds);
    }
    for (const item of state.lastAlertedLevels ?? []) {
      this.lastAlertedLevels.set(item.key, item.level);
    }
    this.save();
  }

  /**
   * 清空所有状态
   */
  clear(): void {
    this.alerts = [];
    this.quotaRequests = [];
    this.notifications = [];
    this.blocks = [];
    this.budgets.clear();
    this.spends.clear();
    this.thresholds.clear();
    this.lastAlertedLevels.clear();
    this.save();
  }

  // ============ 状态查询（调试用） ============

  /**
   * 获取引擎完整状态
   */
  getState(): {
    alerts: number;
    quotaRequests: number;
    notifications: number;
    blocks: number;
    budgets: number;
  } {
    return {
      alerts: this.alerts.length,
      quotaRequests: this.quotaRequests.length,
      notifications: this.notifications.length,
      blocks: this.blocks.length,
      budgets: this.budgets.size,
    };
  }
}

// ============ 全局单例 ============

let defaultEngine: CostThresholdAlertEngine | null = null;

/**
 * 获取默认引擎（单例）
 */
export function getDefaultCostThresholdAlertEngine(): CostThresholdAlertEngine {
  if (!defaultEngine) {
    defaultEngine = new CostThresholdAlertEngine();
  }
  return defaultEngine;
}

/**
 * 重置默认引擎
 */
export function resetDefaultCostThresholdAlertEngine(): void {
  defaultEngine = null;
}
