# G30-01: Cost Threshold Alert Engine (成本阈值告警引擎)

**任务编号**: G30-01
**周期**: Cycle 30
**版本**: v6.83.0
**日期**: 2026-07-30
**重要性**: P0（企业级成本治理核心能力）
**参考**: [Claude Enterprise Cost Threshold Alert](https://claude.com/blog/giving-admins-more-visibility-and-control-over-claude-usage-and-spend) + [claude-cost-guard](https://github.com/oggeh-dev/claude-cost-guard)

---

## 一、需求背景

### 1.1 业务问题

Hermes 当前虽然已有 `CostBudgetEngine`（Cycle 28 G28-02），但缺少：
- 多级阈值告警（仅支持单一阈值检查）
- 告警事件通知（仅显示数字，未触发事件）
- 用户级预算隔离
- 提额申请工作流
- 强制阻断机制

参考 Claude Enterprise 2026-07-02 发布的新特性，我们需要构建一套企业级的成本治理系统，支持多级阈值、智能告警、自动阻断、提额审批全流程。

### 1.2 目标

1. **多级阈值**：warning (75%) / critical (90%) / blocked (100%)，每个级别触发不同响应
2. **告警事件**：阈值跨越时触发 `alert-triggered` 事件，订阅者可推送通知
3. **多渠道通知**：in-app toast + 邮件 mock + webhook
4. **提额申请工作流**：request → pending → approved/denied → apply
5. **强制阻断**：达到 100% 阈值时 `enforceBlock()` 拒绝新执行
6. **多级 scope**：org / team / user 三层预算隔离

---

## 二、数据模型

### 2.1 类型定义

```typescript
// 告警级别
export type AlertLevel = 'info' | 'warning' | 'critical' | 'blocked';

// 阈值配置
export interface ThresholdConfig {
  warning: number;   // 默认 0.75
  critical: number;  // 默认 0.90
  blocked: number;   // 默认 1.00
}

// scope 引用
export interface ScopeRef {
  scope: 'org' | 'team' | 'user';
  scopeId: string;
}

// 告警记录
export interface SpendAlert {
  id: string;
  scope: ScopeRef;
  level: AlertLevel;
  threshold: number;
  currentSpend: number;
  budget: number;
  utilization: number;  // currentSpend / budget
  message: string;
  timestamp: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

// 提额申请
export interface QuotaRequest {
  id: string;
  requester: string;
  scope: ScopeRef;
  currentBudget: number;
  requestedBudget: number;
  incrementAmount: number;  // requestedBudget - currentBudget
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'applied' | 'cancelled';
  reviewer?: string;
  reviewComment?: string;
  reviewedAt?: number;
  appliedAt?: number;
  createdAt: number;
}

// 通知渠道
export type NotificationChannel = 'in-app' | 'email' | 'webhook';

export interface NotificationConfig {
  channels: NotificationChannel[];
  emailRecipients?: string[];  // 仅 email 渠道
  webhookUrl?: string;          // 仅 webhook 渠道
}

export interface NotificationRecord {
  id: string;
  alertId: string;
  channel: NotificationChannel;
  recipient: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: number;
  error?: string;
}

// 阻断记录
export interface BlockRecord {
  id: string;
  scope: ScopeRef;
  blockedAt: number;
  reason: string;
  bypassed: boolean;
  bypassedBy?: string;
  bypassedAt?: number;
}

// 引擎事件
export type AlertEventType =
  | 'alert-triggered'
  | 'alert-acknowledged'
  | 'quota-requested'
  | 'quota-reviewed'
  | 'quota-applied'
  | 'notification-sent'
  | 'block-enforced'
  | 'block-bypassed';

export interface AlertEvent {
  type: AlertEventType;
  timestamp: number;
  data: unknown;
}
```

### 2.2 默认配置

```typescript
export const DEFAULT_THRESHOLD_CONFIG: ThresholdConfig = {
  warning: 0.75,
  critical: 0.90,
  blocked: 1.00,
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
  autoEnforceBlock: true,
  persist: true,
};
```

---

## 三、核心 API

### 3.1 CostThresholdAlertEngine 类

```typescript
export class CostThresholdAlertEngine {
  constructor(config?: Partial<AlertEngineConfig>);
  
  // ========== 阈值配置 ==========
  
  /**
   * 设置指定 scope 的阈值配置
   */
  setThresholds(scope: ScopeRef, config: Partial<ThresholdConfig>): void;
  
  /**
   * 获取指定 scope 的阈值配置
   */
  getThresholds(scope: ScopeRef): ThresholdConfig;
  
  /**
   * 设置指定 scope 的预算
   */
  setBudget(scope: ScopeRef, budget: number): void;
  
  /**
   * 获取指定 scope 的预算
   */
  getBudget(scope: ScopeRef): number;
  
  /**
   * 获取当前已花费
   */
  getCurrentSpend(scope: ScopeRef): number;
  
  // ========== 监控 ==========
  
  /**
   * 记录一次花费
   * @returns 触发的新告警（如果有）
   */
  recordSpend(scope: ScopeRef, amount: number, source: string): SpendAlert[];
  
  /**
   * 检查阈值并触发告警
   * @returns 新触发的告警
   */
  checkThresholds(scope: ScopeRef): SpendAlert[];
  
  /**
   * 获取所有活跃告警
   */
  getActiveAlerts(scope?: ScopeRef): SpendAlert[];
  
  /**
   * 获取告警历史
   */
  getAlertHistory(scope?: ScopeRef, limit?: number): SpendAlert[];
  
  // ========== 告警确认 ==========
  
  /**
   * 确认告警
   */
  acknowledge(alertId: string, userId: string): SpendAlert;
  
  // ========== 提额申请 ==========
  
  /**
   * 提交提额申请
   */
  requestQuotaIncrease(req: {
    requester: string;
    scope: ScopeRef;
    requestedBudget: number;
    reason: string;
  }): QuotaRequest;
  
  /**
   * 审批提额申请
   */
  reviewQuotaRequest(
    reqId: string,
    decision: 'approved' | 'denied',
    reviewer: string,
    comment?: string
  ): QuotaRequest;
  
  /**
   * 应用已批准的提额申请
   */
  applyApprovedRequest(reqId: string): QuotaRequest;
  
  /**
   * 取消提额申请
   */
  cancelQuotaRequest(reqId: string, requester: string): QuotaRequest;
  
  /**
   * 获取提额申请
   */
  getQuotaRequest(reqId: string): QuotaRequest | undefined;
  
  /**
   * 列出提额申请
   */
  listQuotaRequests(filter?: { status?: QuotaRequest['status']; scope?: ScopeRef }): QuotaRequest[];
  
  // ========== 阻断控制 ==========
  
  /**
   * 检查是否被阻断
   */
  isBlocked(scope: ScopeRef): boolean;
  
  /**
   * 强制执行阻断检查
   * @returns allowed: true 表示允许执行，false 表示被阻断
   */
  enforceBlock(scope: ScopeRef): { allowed: boolean; reason?: string; alert?: SpendAlert };
  
  /**
   * 绕过阻断（需高级权限）
   */
  bypassBlock(scope: ScopeRef, userId: string, reason: string): BlockRecord;
  
  /**
   * 获取阻断记录
   */
  getBlockHistory(scope?: ScopeRef): BlockRecord[];
  
  // ========== 通知 ==========
  
  /**
   * 发送通知
   */
  sendNotification(alert: SpendAlert, config: NotificationConfig): NotificationRecord[];
  
  /**
   * 获取通知记录
   */
  getNotificationHistory(alertId?: string): NotificationRecord[];
  
  // ========== 统计 ==========
  
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
    blockEvents: number;
  };
  
  // ========== 事件 ==========
  
  on(event: AlertEventType, listener: (e: AlertEvent) => void): () => void;
  off(event: AlertEventType, listener: (e: AlertEvent) => void): void;
  
  // ========== 持久化 ==========
  
  exportState(): SerializedState;
  importState(state: SerializedState): void;
  clear(): void;
}
```

---

## 四、关键算法

### 4.1 阈值跨越检测

```typescript
private checkThresholds(scope: ScopeRef): SpendAlert[] {
  const budget = this.getBudget(scope);
  if (budget <= 0) return [];
  
  const spend = this.getCurrentSpend(scope);
  const utilization = spend / budget;
  const thresholds = this.getThresholds(scope);
  
  const triggered: SpendAlert[] = [];
  const lastLevel = this.getLastAlertedLevel(scope);
  
  // 检测 warning
  if (utilization >= thresholds.warning && this.shouldTrigger(scope, 'warning', lastLevel)) {
    triggered.push(this.createAlert(scope, 'warning', thresholds.warning, spend, budget));
  }
  
  // 检测 critical
  if (utilization >= thresholds.critical && this.shouldTrigger(scope, 'critical', lastLevel)) {
    triggered.push(this.createAlert(scope, 'critical', thresholds.critical, spend, budget));
  }
  
  // 检测 blocked
  if (utilization >= thresholds.blocked && this.shouldTrigger(scope, 'blocked', lastLevel)) {
    triggered.push(this.createAlert(scope, 'blocked', thresholds.blocked, spend, budget));
  }
  
  return triggered;
}

private shouldTrigger(
  scope: ScopeRef,
  level: AlertLevel,
  lastLevel: AlertLevel | null
): boolean {
  if (!lastLevel) return true;  // 首次触发
  const order: AlertLevel[] = ['info', 'warning', 'critical', 'blocked'];
  return order.indexOf(level) > order.indexOf(lastLevel);  // 只在升级时触发
}
```

### 4.2 提额申请状态机

```
created → pending
pending → approved → applied
pending → denied
pending → cancelled (by requester)
applied → (终态)
```

### 4.3 智能 Root Synthesis（智能合成）

```typescript
synthesize(alerts: SpendAlert[]): string {
  if (alerts.length === 0) return '所有 scope 预算健康。';
  
  const grouped = this.groupByScope(alerts);
  const summaries: string[] = [];
  
  for (const [scope, scopeAlerts] of grouped) {
    const highest = scopeAlerts.reduce((max, a) => 
      this.compareLevel(a.level, max.level) > 0 ? a : max
    );
    summaries.push(
      `${scope.scope}/${scope.scopeId}: ${this.alertLevelLabel(highest.level)} ` +
      `(已用 ${(highest.utilization * 100).toFixed(1)}%)`
    );
  }
  
  return summaries.join('\n');
}
```

---

## 五、UI 组件设计

### 5.1 CostAlertPanel

**功能**：
- 顶部统计卡片：活跃告警数 / 待审批申请数 / 阻断次数
- Tab 1: 告警监控 - 实时阈值条 + 告警列表 + 确认按钮
- Tab 2: 提额审批 - 申请列表 + 审批操作
- Tab 3: 阈值配置 - 各 scope 阈值编辑
- Tab 4: 阻断日志 - 历史阻断记录

**布局**：
```
┌──────────────────────────────────────────┐
│  💰 Cost Threshold Alert                 │
│  ────────────────────────────────────    │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │ 3   │ │ 2   │ │ 0   │ │ 12  │      │
│  │活跃 │ │待审 │ │阻断 │ │告警 │      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
│  ────────────────────────────────────    │
│  [告警] [审批] [配置] [日志]             │
│  ────────────────────────────────────    │
│  ... 主内容 ...                          │
└──────────────────────────────────────────┘
```

---

## 六、测试策略

### 6.1 单元测试（30 个用例）

**基础功能** (10)
- 初始化 + 默认配置
- 设置 / 获取阈值
- 设置 / 获取预算
- 记录花费
- 检查阈值
- 触发 warning 告警
- 触发 critical 告警
- 触发 blocked 告警
- 升级告警（warning → critical）
- 降级不重复触发

**告警管理** (5)
- 列出活跃告警
- 列出告警历史
- 确认告警
- 按 scope 过滤
- 限制历史长度

**提额申请** (8)
- 提交申请
- 批准申请
- 拒绝申请
- 应用已批准申请
- 取消申请
- 列出待审批
- 状态机正确性
- 申请后自动应用

**阻断控制** (4)
- 检查阻断状态
- 执行阻断
- 绕过阻断
- 阻断日志

**通知 & 事件** (3)
- 多渠道通知
- 事件订阅
- 事件解订阅

### 6.2 组件测试（8 个用例）

- 面板开关
- Tab 切换
- 显示告警列表
- 显示申请列表
- 审批操作
- 确认告警
- 显示配置表单
- 显示阻断日志

### 6.3 E2E 集成测试

- 完整闭环：recordSpend → 触发告警 → 提额申请 → 审批 → 应用
- 阻断闭环：recordSpend → enforceBlock → 拒绝 → bypass
- 多 scope 隔离

---

## 七、集成方案

### 7.1 与 CostBudgetEngine 集成

```typescript
// CostBudgetEngine.setBudget 时同步到 alert engine
costBudgetEngine.on('budget-set', (e) => {
  alertEngine.setBudget(e.scope, e.budget);
});

// 每次 CostBudgetEngine.recordSpend 时同步
costBudgetEngine.on('spend-recorded', (e) => {
  alertEngine.recordSpend(e.scope, e.amount, e.source);
});
```

### 7.2 与 AnalyticsChat 集成

AnalyticsChat 查询时调用 `alertEngine.getStats()` 展示告警数。

---

## 八、验收清单

- [ ] 数据模型 + 类型定义完整
- [ ] 核心 API 100% 实现
- [ ] 30 个单元测试通过
- [ ] 8 个组件测试通过
- [ ] UI 面板完整可用
- [ ] 与 CostBudgetEngine 正确集成
- [ ] 事件系统完整
- [ ] 持久化可用
- [ ] 文档完整

---

*G30-01 SPEC · Cycle 30 · 完成*
