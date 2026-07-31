/**
 * # ============================================================
 * # HumanApprovalEngine - 人机协作审批引擎 (v1.0.0 Cycle 38 G38-04)
 * # ============================================================
 * # 核心作用：危险操作前人工审批 + 风险分级 + 审计日志
 * #           确保关键决策可追溯、可中断、可审计
 * # 对标产品：Salesforce Flow Approvals / ServiceNow / Power Automate
 * # 运行流程：
 * #   1. RiskClassifier 自动评估操作风险等级
 * #   2. PolicyEngine 应用自定义策略覆盖默认风险
 * #   3. ApprovalQueue 排队 + 同步等待审批结果
 * #   4. Auditor 全量记录审计日志
 * #   5. 超时自动 reject（fail-closed）
 * # 输入参数：操作描述符 + 请求选项
 * # 输出结果：ApprovalRequest（包含状态 + 决策历史）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 38 G38-04 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type RiskLevel = 'safe' | 'moderate' | 'dangerous' | 'critical';
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'auto-approved';
export type ApproverRole = 'user' | 'admin' | 'security_officer' | 'system';
export type OperationType =
  | 'tool_call'
  | 'llm_output'
  | 'agent_action'
  | 'file_access'
  | 'network_request'
  | 'system_command';

export interface RiskLevelConfig {
  level: RiskLevel;
  autoApprove: boolean;
  requiredApprovers: number;
  approverRoles: ApproverRole[];
  timeoutMs: number;
  description: string;
}

export const DEFAULT_RISK_CONFIGS: Record<RiskLevel, RiskLevelConfig> = {
  safe: {
    level: 'safe',
    autoApprove: true,
    requiredApprovers: 0,
    approverRoles: [],
    timeoutMs: 0,
    description: '安全操作，无需审批',
  },
  moderate: {
    level: 'moderate',
    autoApprove: false,
    requiredApprovers: 1,
    approverRoles: ['user'],
    timeoutMs: 5 * 60 * 1000,
    description: '中等风险，用户审批',
  },
  dangerous: {
    level: 'dangerous',
    autoApprove: false,
    requiredApprovers: 1,
    approverRoles: ['admin'],
    timeoutMs: 30 * 60 * 1000,
    description: '高风险，管理员审批',
  },
  critical: {
    level: 'critical',
    autoApprove: false,
    requiredApprovers: 2,
    approverRoles: ['admin', 'security_officer'],
    timeoutMs: 60 * 60 * 1000,
    description: '极高风险，多人审批',
  },
};

export interface OperationDescriptor {
  type: OperationType;
  name: string;
  args: Record<string, unknown>;
  reversible: boolean;
  estimatedImpact: string;
}

export interface ApprovalDecision {
  approver: string;
  approverRole: ApproverRole;
  decision: 'approve' | 'reject';
  reason?: string;
  decidedAt: number;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  description: string;
  operation: OperationDescriptor;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  requiredApprovers: number;
  currentApprovals: ApprovalDecision[];
  requestedBy: string;
  requestedAt: number;
  expiresAt: number;
  resolvedAt?: number;
  result?: 'approved' | 'rejected' | 'expired' | 'cancelled' | 'auto-approved';
  metadata?: Record<string, unknown>;
}

export interface PolicyCondition {
  type: 'operation_type' | 'tool_name' | 'arg_match' | 'user_role' | 'time_window';
  operator: 'equals' | 'contains' | 'matches' | 'in' | 'not_in';
  value: string | string[];
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  description?: string;
  conditions: PolicyCondition[];
  riskLevel: RiskLevel;
  enabled: boolean;
  priority: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  actor: string;
  action: string;
  target?: string;
  result: 'success' | 'failure' | 'denied' | 'expired';
  details: Record<string, unknown>;
  approvalId?: string;
}

export interface RequestOptions {
  requestedBy?: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  onResolved?: (req: ApprovalRequest) => void;
}

export interface ListFilter {
  status?: ApprovalStatus;
  riskLevel?: RiskLevel;
  approverRole?: ApproverRole;
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  startTime?: number;
  endTime?: number;
  result?: string;
}

export interface ApprovalStats {
  totalRequests: number;
  byStatus: Record<ApprovalStatus, number>;
  byRiskLevel: Record<RiskLevel, number>;
  pendingCount: number;
  avgApprovalTimeMs: number;
}

// ============ 工具函数 ============

export function generateId(prefix: string = 'apr'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const CRITICAL_KEYWORDS: string[] = [
  'rm -rf',
  'DROP TABLE',
  'DELETE FROM',
  'format',
  'shutdown',
  'mkfs',
  'rm -fr',
  'TRUNCATE',
  ':(){:|:&};:',
];

export const DANGEROUS_PATTERNS: Array<{ type: OperationType; match: RegExp | string; risk: RiskLevel }> = [
  { type: 'system_command', match: /rm\s+-rf?/i, risk: 'critical' },
  { type: 'system_command', match: /DROP\s+TABLE/i, risk: 'critical' },
  { type: 'system_command', match: /DELETE\s+FROM/i, risk: 'critical' },
  { type: 'system_command', match: /shutdown|reboot|halt/i, risk: 'critical' },
  { type: 'file_access', match: /delete|remove|unlink/i, risk: 'dangerous' },
  { type: 'file_access', match: /write|modify|edit/i, risk: 'dangerous' },
  { type: 'network_request', match: /.*/i, risk: 'dangerous' },
  { type: 'agent_action', match: /deploy|publish|push/i, risk: 'dangerous' },
  { type: 'file_access', match: /read|fetch|get|list/i, risk: 'moderate' },
];

export const SAFE_PATTERNS: Array<{ type: OperationType; match: RegExp | string }> = [
  { type: 'tool_call', match: /^(calc|compute|sum|parse|format_string|local_)/i },
  { type: 'tool_call', match: /^(echo|greet|hello)/i },
  { type: 'system_command', match: /^(echo|pwd|date|whoami)$/i },
];

/**
 * 风险等级排序
 */
export function riskLevelWeight(level: RiskLevel): number {
  const map: Record<RiskLevel, number> = {
    safe: 0,
    moderate: 1,
    dangerous: 2,
    critical: 3,
  };
  return map[level];
}

/**
 * 取两个风险等级中更高的
 */
export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskLevelWeight(a) >= riskLevelWeight(b) ? a : b;
}

/**
 * 角色是否可以审批指定风险等级
 * - system: 可审批任何等级
 * - security_officer: 可审批任何等级（含 critical）
 * - admin: 可审批 dangerous / critical（critical 需要 1 个 admin + 1 个 security_officer）
 * - user: 仅可审批 moderate
 */
export function canApproveRisk(role: ApproverRole, risk: RiskLevel): boolean {
  if (role === 'system' || role === 'security_officer') return true;
  if (role === 'admin') {
    return risk === 'moderate' || risk === 'dangerous' || risk === 'critical';
  }
  if (role === 'user') {
    return risk === 'moderate';
  }
  return false;
}

// ============ RiskClassifier ============

export interface ClassifierOptions {
  customRules?: Array<{
    type: OperationType;
    match: RegExp | string;
    riskLevel: RiskLevel;
  }>;
}

export class RiskClassifier {
  private customRules: Array<{
    type: OperationType;
    match: RegExp | string;
    riskLevel: RiskLevel;
  }>;

  constructor(options?: ClassifierOptions) {
    this.customRules = options?.customRules ?? [];
  }

  /**
   * 评估操作风险等级
   */
  classify(operation: OperationDescriptor): RiskLevel {
    // 1. 先检测关键词黑名单（升级到 critical）
    const text = `${operation.name} ${operation.estimatedImpact} ${JSON.stringify(operation.args)}`;
    const keywordRisk = this.detectKeywordRisk(text);
    if (keywordRisk === 'critical') return 'critical';

    // 2. 自定义规则优先
    for (const rule of this.customRules) {
      if (rule.type !== operation.type) continue;
      if (this.matchRule(rule.match, operation)) {
        return rule.riskLevel;
      }
    }

    // 3. 安全模式（白名单）
    for (const safe of SAFE_PATTERNS) {
      if (safe.type !== operation.type) continue;
      if (this.matchRule(safe.match, operation) && operation.reversible) {
        return 'safe';
      }
    }

    // 4. 默认规则
    let classifiedLevel: RiskLevel = 'moderate';
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.type !== operation.type) continue;
      if (this.matchRule(pattern.match, operation)) {
        classifiedLevel = pattern.risk;
        break;
      }
    }

    // 5. 不可逆操作升级到 dangerous
    if (!operation.reversible && classifiedLevel !== 'critical') {
      classifiedLevel = 'dangerous';
    }

    return classifiedLevel;
  }

  /**
   * 关键词风险检测
   */
  detectKeywordRisk(text: string): RiskLevel {
    for (const kw of CRITICAL_KEYWORDS) {
      if (text.includes(kw)) return 'critical';
    }
    return 'safe';
  }

  /**
   * 注册自定义规则
   */
  registerRule(
    pattern: { type: OperationType; match: RegExp | string },
    riskLevel: RiskLevel,
  ): void {
    this.customRules.push({ ...pattern, riskLevel });
  }

  private matchRule(match: RegExp | string, operation: OperationDescriptor): boolean {
    const text = `${operation.name} ${JSON.stringify(operation.args)}`;
    if (match instanceof RegExp) {
      return match.test(text);
    }
    return text.toLowerCase().includes(match.toLowerCase());
  }
}

// ============ ApprovalQueue ============

export interface QueueOptions {
  maxSize?: number;
}

export class ApprovalQueue {
  private items: Map<string, ApprovalRequest> = new Map();
  private order: string[] = [];
  private maxSize: number;
  private requestHandlers: Array<(req: ApprovalRequest) => void> = [];
  private resolvedHandlers: Array<(req: ApprovalRequest) => void> = [];

  constructor(options?: QueueOptions) {
    this.maxSize = options?.maxSize ?? 1000;
  }

  enqueue(request: ApprovalRequest): void {
    if (this.items.size >= this.maxSize) {
      throw new Error(`Approval queue full (max=${this.maxSize})`);
    }
    this.items.set(request.id, request);
    this.order.push(request.id);
    this.requestHandlers.forEach((h) => {
      try {
        h(request);
      } catch {
        // ignore
      }
    });
  }

  get(id: string): ApprovalRequest | undefined {
    return this.items.get(id);
  }

  dequeue(): ApprovalRequest | undefined {
    const id = this.order.shift();
    if (!id) return undefined;
    const req = this.items.get(id);
    if (req) this.items.delete(id);
    return req;
  }

  list(filter?: ListFilter): ApprovalRequest[] {
    const all = Array.from(this.items.values());
    return all.filter((r) => {
      if (filter?.status && r.status !== filter.status) return false;
      if (filter?.riskLevel && r.riskLevel !== filter.riskLevel) return false;
      if (filter?.approverRole) {
        if (!canApproveRisk(filter.approverRole, r.riskLevel)) return false;
      }
      return true;
    });
  }

  listPending(approverRole?: ApproverRole): ApprovalRequest[] {
    const pending = this.list({ status: 'pending' });
    if (!approverRole) return pending;
    return pending.filter((r) => canApproveRisk(approverRole, r.riskLevel));
  }

  decide(id: string, decision: ApprovalDecision): ApprovalRequest {
    const req = this.items.get(id);
    if (!req) throw new Error(`Approval request not found: ${id}`);
    if (req.status !== 'pending') {
      throw new Error(`Approval already resolved: ${req.status}`);
    }

    req.currentApprovals.push(decision);

    if (decision.decision === 'reject') {
      // 任一拒绝立即生效
      req.status = 'rejected';
      req.result = 'rejected';
      req.resolvedAt = Date.now();
      this.emitResolved(req);
    } else {
      // 累计批准
      const approveCount = req.currentApprovals.filter(
        (d) => d.decision === 'approve',
      ).length;
      if (approveCount >= req.requiredApprovers) {
        req.status = 'approved';
        req.result = 'approved';
        req.resolvedAt = Date.now();
        this.emitResolved(req);
      }
    }
    return req;
  }

  cancel(id: string, reason?: string): boolean {
    const req = this.items.get(id);
    if (!req) return false;
    if (req.status !== 'pending') return false;
    req.status = 'cancelled';
    req.result = 'cancelled';
    req.resolvedAt = Date.now();
    if (reason) {
      req.metadata = { ...(req.metadata ?? {}), cancelReason: reason };
    }
    this.emitResolved(req);
    return true;
  }

  cleanupExpired(now: number = Date.now()): number {
    let count = 0;
    for (const [id, req] of this.items.entries()) {
      if (req.status === 'pending' && req.expiresAt < now) {
        req.status = 'expired';
        req.result = 'expired';
        req.resolvedAt = now;
        this.emitResolved(req);
        this.items.delete(id);
        count++;
      }
    }
    // 清理 order
    this.order = this.order.filter((id) => this.items.has(id));
    return count;
  }

  onRequest(handler: (req: ApprovalRequest) => void): () => void {
    this.requestHandlers.push(handler);
    return () => {
      const idx = this.requestHandlers.indexOf(handler);
      if (idx >= 0) this.requestHandlers.splice(idx, 1);
    };
  }

  onResolved(handler: (req: ApprovalRequest) => void): () => void {
    this.resolvedHandlers.push(handler);
    return () => {
      const idx = this.resolvedHandlers.indexOf(handler);
      if (idx >= 0) this.resolvedHandlers.splice(idx, 1);
    };
  }

  private emitResolved(req: ApprovalRequest): void {
    this.resolvedHandlers.forEach((h) => {
      try {
        h(req);
      } catch {
        // ignore
      }
    });
  }

  size(): number {
    return this.items.size;
  }
}

// ============ PolicyEngine ============

export interface PolicyEngineOptions {
  initialPolicies?: ApprovalPolicy[];
}

export class PolicyEngine {
  private policies: Map<string, ApprovalPolicy> = new Map();

  constructor(options?: PolicyEngineOptions) {
    if (options?.initialPolicies) {
      for (const p of options.initialPolicies) {
        this.policies.set(p.id, p);
      }
    }
  }

  addPolicy(policy: ApprovalPolicy): void {
    this.policies.set(policy.id, policy);
  }

  removePolicy(id: string): boolean {
    return this.policies.delete(id);
  }

  listPolicies(): ApprovalPolicy[] {
    return Array.from(this.policies.values()).sort(
      (a, b) => b.priority - a.priority,
    );
  }

  /**
   * 匹配所有满足条件的策略
   */
  matchPolicies(operation: OperationDescriptor): ApprovalPolicy[] {
    const sorted = this.listPolicies();
    return sorted.filter(
      (p) => p.enabled && this.policyMatches(p, operation),
    );
  }

  /**
   * 应用策略：返回最终风险等级
   * 优先级最高 + 风险等级最高
   */
  applyPolicies(operation: OperationDescriptor): RiskLevel {
    const matches = this.matchPolicies(operation);
    if (matches.length === 0) return 'moderate';

    // 取所有匹配策略中风险等级最高的
    let result: RiskLevel = 'safe';
    for (const m of matches) {
      result = maxRiskLevel(result, m.riskLevel);
    }
    return result;
  }

  private policyMatches(policy: ApprovalPolicy, operation: OperationDescriptor): boolean {
    return policy.conditions.every((c) => this.conditionMatches(c, operation));
  }

  private conditionMatches(
    condition: PolicyCondition,
    operation: OperationDescriptor,
  ): boolean {
    let actual: string | string[] = '';
    if (condition.type === 'operation_type') {
      actual = operation.type;
    } else if (condition.type === 'tool_name') {
      actual = operation.name;
    } else if (condition.type === 'arg_match') {
      actual = JSON.stringify(operation.args);
    } else {
      return false; // time_window / user_role 暂不实现
    }

    const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
    switch (condition.operator) {
      case 'equals':
        return expected.length === 1 && actual === expected[0];
      case 'contains':
        return expected.some((e) => String(actual).includes(e));
      case 'matches':
        try {
          return expected.some((e) => new RegExp(e).test(String(actual)));
        } catch {
          return false;
        }
      case 'in':
        return Array.isArray(actual)
          ? actual.some((a) => expected.includes(a))
          : expected.includes(String(actual));
      case 'not_in':
        return Array.isArray(actual)
          ? !actual.some((a) => expected.includes(a))
          : !expected.includes(String(actual));
      default:
        return false;
    }
  }
}

// ============ Auditor ============

export interface AuditorOptions {
  maxEntries?: number;
  persistKey?: string;
}

export class Auditor {
  private entries: AuditLogEntry[] = [];
  private maxEntries: number;
  private persistKey: string;

  constructor(options?: AuditorOptions) {
    this.maxEntries = options?.maxEntries ?? 10000;
    this.persistKey = options?.persistKey ?? 'approval_audit';
  }

  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const full: AuditLogEntry = {
      id: generateId('aud'),
      timestamp: Date.now(),
      ...entry,
    };
    this.entries.push(full);
    // 容量管理
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
    return full;
  }

  query(filter?: AuditFilter): AuditLogEntry[] {
    return this.entries.filter((e) => {
      if (filter?.actor && e.actor !== filter.actor) return false;
      if (filter?.action && e.action !== filter.action) return false;
      if (filter?.startTime && e.timestamp < filter.startTime) return false;
      if (filter?.endTime && e.timestamp > filter.endTime) return false;
      if (filter?.result && e.result !== filter.result) return false;
      return true;
    });
  }

  export(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.entries, null, 2);
    }
    // CSV
    const headers = [
      'id',
      'timestamp',
      'actor',
      'action',
      'target',
      'result',
      'approvalId',
    ];
    const lines = [headers.join(',')];
    for (const e of this.entries) {
      lines.push(
        [
          e.id,
          new Date(e.timestamp).toISOString(),
          this.escapeCsv(e.actor),
          this.escapeCsv(e.action),
          this.escapeCsv(e.target ?? ''),
          e.result,
          e.approvalId ?? '',
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  getStats(timeRange?: { start: number; end: number }): {
    totalRequests: number;
    approvedCount: number;
    rejectedCount: number;
    expiredCount: number;
    avgApprovalTimeMs: number;
  } {
    const filtered = this.entries.filter((e) => {
      if (e.action !== 'approval_resolved') return false;
      if (timeRange) {
        if (e.timestamp < timeRange.start) return false;
        if (e.timestamp > timeRange.end) return false;
      }
      return true;
    });
    const approved = filtered.filter((e) => e.result === 'success').length;
    const rejected = filtered.filter((e) => e.result === 'denied').length;
    const expired = filtered.filter((e) => e.result === 'expired').length;
    // 平均审批时间 = (resolvedAt - requestedAt) 求平均
    const durations = filtered
      .map((e) => {
        const start = (e.details as { requestedAt?: number })?.requestedAt;
        const end = (e.details as { resolvedAt?: number })?.resolvedAt;
        if (typeof start === 'number' && typeof end === 'number') {
          return end - start;
        }
        return null;
      })
      .filter((d): d is number => d !== null);
    const avgApprovalTimeMs =
      durations.length === 0
        ? 0
        : durations.reduce((s, d) => s + d, 0) / durations.length;
    return {
      totalRequests: filtered.length,
      approvedCount: approved,
      rejectedCount: rejected,
      expiredCount: expired,
      avgApprovalTimeMs,
    };
  }

  async save(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.persistKey, JSON.stringify(this.entries));
    } catch (err) {
      void err;
    }
  }

  async load(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.persistKey);
      if (!raw) return;
      this.entries = JSON.parse(raw) as AuditLogEntry[];
    } catch (err) {
      void err;
    }
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

// ============ HumanApprovalEngine（主类）==========

export interface HumanApprovalEngineOptions {
  classifierOptions?: ClassifierOptions;
  queueOptions?: QueueOptions;
  policyOptions?: PolicyEngineOptions;
  auditorOptions?: AuditorOptions;
  defaultRequestedBy?: string;
  enableAutoExpiry?: boolean;
}

export class ApprovalDeniedError extends Error {
  constructor(public request: ApprovalRequest) {
    super(`Approval denied: ${request.title}`);
    this.name = 'ApprovalDeniedError';
  }
}

export class ApprovalExpiredError extends Error {
  constructor(public request: ApprovalRequest) {
    super(`Approval expired: ${request.title}`);
    this.name = 'ApprovalExpiredError';
  }
}

export class HumanApprovalEngine {
  private classifier: RiskClassifier;
  private queue: ApprovalQueue;
  private policyEngine: PolicyEngine;
  private auditor: Auditor;
  private defaultRequestedBy: string;
  private enableAutoExpiry: boolean;
  private expiredHandlers: Array<(req: ApprovalRequest) => void> = [];
  private expiryCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options?: HumanApprovalEngineOptions) {
    this.classifier = new RiskClassifier(options?.classifierOptions);
    this.queue = new ApprovalQueue(options?.queueOptions);
    this.policyEngine = new PolicyEngine(options?.policyOptions);
    this.auditor = new Auditor(options?.auditorOptions);
    this.defaultRequestedBy = options?.defaultRequestedBy ?? 'system';
    this.enableAutoExpiry = options?.enableAutoExpiry ?? true;
    if (this.enableAutoExpiry && typeof setInterval !== 'undefined') {
      this.expiryCheckInterval = setInterval(() => {
        this.queue.cleanupExpired();
      }, 30_000);
    }
  }

  // ============ 提交审批 ============

  /**
   * 同步等待审批
   */
  async requestApproval(
    operation: OperationDescriptor,
    options?: RequestOptions,
  ): Promise<ApprovalRequest> {
    const requestId = await this.submitForApproval(operation, options);
    return new Promise<ApprovalRequest>((resolve, reject) => {
      const off = this.queue.onResolved((req) => {
        if (req.id !== requestId) return;
        off();
        if (req.status === 'approved' || req.status === 'auto-approved') {
          resolve(req);
        } else if (req.status === 'rejected') {
          reject(new ApprovalDeniedError(req));
        } else if (req.status === 'expired') {
          reject(new ApprovalExpiredError(req));
        } else {
          reject(new Error(`Unexpected status: ${req.status}`));
        }
      });
    });
  }

  /**
   * 提交审批（异步，立即返回 request ID）
   */
  async submitForApproval(
    operation: OperationDescriptor,
    options?: RequestOptions,
  ): Promise<string> {
    const requestedBy = options?.requestedBy ?? this.defaultRequestedBy;

    // 1. 评估风险等级
    const policyRisk = this.policyEngine.applyPolicies(operation);
    const classifierRisk = this.classifier.classify(operation);
    // 策略结果作为底限，分类器结果作为上限
    // 如果分类器识别为 safe，则信任分类器（避免无策略时被默认 moderate 拉高）
    // 否则取 max（更严格）
    let riskLevel: RiskLevel;
    if (classifierRisk === 'safe' && policyRisk === 'moderate') {
      // 无策略 + 分类器认为 safe → safe
      riskLevel = 'safe';
    } else {
      riskLevel = maxRiskLevel(policyRisk, classifierRisk);
    }
    const cfg = DEFAULT_RISK_CONFIGS[riskLevel];

    const now = Date.now();
    const request: ApprovalRequest = {
      id: generateId('apr'),
      title: options?.title ?? `${operation.type}: ${operation.name}`,
      description: options?.description ?? operation.estimatedImpact,
      operation,
      riskLevel,
      status: 'pending',
      requiredApprovers: cfg.requiredApprovers,
      currentApprovals: [],
      requestedBy,
      requestedAt: now,
      expiresAt: cfg.timeoutMs > 0 ? now + cfg.timeoutMs : now + 24 * 60 * 60 * 1000,
      metadata: options?.metadata,
    };

    // 2. 自动审批
    if (cfg.autoApprove) {
      request.status = 'auto-approved';
      request.result = 'auto-approved';
      request.resolvedAt = Date.now();
      // 即便自动审批，也入队保留审计
      this.queue.enqueue(request);
      this.auditor.log({
        actor: requestedBy,
        action: 'auto_approved',
        target: operation.name,
        result: 'success',
        details: { riskLevel, autoApprove: true },
        approvalId: request.id,
      });
      return request.id;
    }

    // 3. 入队
    this.queue.enqueue(request);
    this.auditor.log({
      actor: requestedBy,
      action: 'request_submitted',
      target: operation.name,
      result: 'success',
      details: {
        riskLevel,
        requiredApprovers: cfg.requiredApprovers,
        operation: { type: operation.type, name: operation.name },
      },
      approvalId: request.id,
    });

    return request.id;
  }

  // ============ 决策 ============

  approve(
    requestId: string,
    approver: string,
    role: ApproverRole,
    reason?: string,
  ): ApprovalRequest {
    const req = this.queue.get(requestId);
    if (!req) throw new Error(`Request not found: ${requestId}`);

    // 角色权限校验：approver 必须有权审批该风险等级
    if (!canApproveRisk(role, req.riskLevel)) {
      throw new Error(
        `Role ${role} not authorized for risk level ${req.riskLevel}`,
      );
    }

    const decision: ApprovalDecision = {
      approver,
      approverRole: role,
      decision: 'approve',
      reason,
      decidedAt: Date.now(),
    };
    const updated = this.queue.decide(requestId, decision);

    this.auditor.log({
      actor: approver,
      action: 'approval_decided',
      target: req.operation.name,
      result: updated.status === 'approved' ? 'success' : 'denied',
      details: {
        decision: 'approve',
        reason,
        currentApprovals: updated.currentApprovals.length,
        requestedAt: req.requestedAt,
        resolvedAt: updated.resolvedAt,
      },
      approvalId: requestId,
    });

    return updated;
  }

  reject(
    requestId: string,
    approver: string,
    role: ApproverRole,
    reason: string,
  ): ApprovalRequest {
    const req = this.queue.get(requestId);
    if (!req) throw new Error(`Request not found: ${requestId}`);

    if (!canApproveRisk(role, req.riskLevel)) {
      throw new Error(
        `Role ${role} not authorized for risk level ${req.riskLevel}`,
      );
    }

    const decision: ApprovalDecision = {
      approver,
      approverRole: role,
      decision: 'reject',
      reason,
      decidedAt: Date.now(),
    };
    const updated = this.queue.decide(requestId, decision);

    this.auditor.log({
      actor: approver,
      action: 'approval_decided',
      target: req.operation.name,
      result: 'denied',
      details: {
        decision: 'reject',
        reason,
        requestedAt: req.requestedAt,
        resolvedAt: updated.resolvedAt,
      },
      approvalId: requestId,
    });

    return updated;
  }

  /**
   * 批量审批
   */
  approveBatch(
    requestIds: string[],
    approver: string,
    role: ApproverRole,
    reason?: string,
  ): ApprovalRequest[] {
    return requestIds.map((id) => this.approve(id, approver, role, reason));
  }

  // ============ 取消 ============

  cancel(requestId: string, reason?: string): boolean {
    const req = this.queue.get(requestId);
    if (!req) return false;
    const ok = this.queue.cancel(requestId, reason);
    if (ok) {
      this.auditor.log({
        actor: this.defaultRequestedBy,
        action: 'request_cancelled',
        target: req.operation.name,
        result: 'success',
        details: { reason },
        approvalId: requestId,
      });
    }
    return ok;
  }

  // ============ 查询 ============

  getRequest(id: string): ApprovalRequest | undefined {
    return this.queue.get(id);
  }

  listRequests(filter?: ListFilter): ApprovalRequest[] {
    return this.queue.list(filter);
  }

  getAuditLog(filter?: AuditFilter): AuditLogEntry[] {
    return this.auditor.query(filter);
  }

  // ============ 内部组件访问 ============

  getClassifier(): RiskClassifier {
    return this.classifier;
  }

  getQueue(): ApprovalQueue {
    return this.queue;
  }

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  getAuditor(): Auditor {
    return this.auditor;
  }

  // ============ 统计 ============

  getStats(): ApprovalStats {
    const all = this.queue.list();
    const byStatus: Record<ApprovalStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      cancelled: 0,
      'auto-approved': 0,
    };
    const byRiskLevel: Record<RiskLevel, number> = {
      safe: 0,
      moderate: 0,
      dangerous: 0,
      critical: 0,
    };
    for (const r of all) {
      byStatus[r.status]++;
      byRiskLevel[r.riskLevel]++;
    }
    const auditorStats = this.auditor.getStats();
    return {
      totalRequests: all.length,
      byStatus,
      byRiskLevel,
      pendingCount: byStatus.pending,
      avgApprovalTimeMs: auditorStats.avgApprovalTimeMs,
    };
  }

  // ============ 事件 ============

  onRequest(handler: (req: ApprovalRequest) => void): () => void {
    return this.queue.onRequest(handler);
  }

  onResolved(handler: (req: ApprovalRequest) => void): () => void {
    return this.queue.onResolved(handler);
  }

  onExpired(handler: (req: ApprovalRequest) => void): () => void {
    this.expiredHandlers.push(handler);
    return () => {
      const idx = this.expiredHandlers.indexOf(handler);
      if (idx >= 0) this.expiredHandlers.splice(idx, 1);
    };
  }

  // ============ 清理 ============

  dispose(): void {
    if (this.expiryCheckInterval) {
      clearInterval(this.expiryCheckInterval);
      this.expiryCheckInterval = null;
    }
  }
}
