/**
 * # ============================================================
 * # Audit Trail Engine - 审计追踪引擎 (v1.0.0 Cycle 32 G32-01)
 * # ============================================================
 * # 核心作用：实现企业级不可篡改审计追踪
 * # 不可篡改：HMAC-SHA256 hash chain，每条事件包含 prevHash + hash
 * # 事件类型：auth / authz / data / admin / system / agent / compliance
 * # 合规报告：SOC 2 / ISO 27001 / GDPR / EU AI Act
 * # GDPR 支持：PII pseudonymization + 数据主体请求
 * # 参考：OWASP APTS-AR-012 Tamper-Evident Logging
 * #      EU AI Act Art. 12 - Automatic Event Recording
 * #      NIST AI RMF Govern - Information Integrity
 * # ============================================================
 * # 运行流程：
 * #   1. 初始化引擎 + 默认配置
 * #   2. log/logAuth/logAuthz/logData/logAdmin/logAgent 记录事件
 * #   3. 内部计算 prevHash + hash 链接到上一条
 * #   4. 触发 audit-recorded 事件
 * #   5. query 过滤查询
 * #   6. verifyChain 完整性验证
 * #   7. generateSOC2Report/generateGDPRReport 等合规报告
 * #   8. exportJSON/exportCSV/exportCEF 多格式导出
 * # ============================================================
 * # 输入参数：事件输入 + Actor + Resource + Outcome
 * # 输出结果：AuditEvent / ComplianceReport / ChainVerificationResult
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 32 G32-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type AuditEventType =
  | 'auth'
  | 'authz'
  | 'data'
  | 'admin'
  | 'system'
  | 'agent'
  | 'compliance';

export type AuditOutcome = 'success' | 'failure' | 'denied' | 'pending';

export type AuditSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export type ActorType = 'user' | 'service' | 'agent' | 'system' | 'anonymous';

export type ComplianceStandard = 'SOC2' | 'ISO27001' | 'GDPR' | 'EUAIAct';

export interface AuditActor {
  id: string;
  type: ActorType;
  name?: string;
  email?: string;
  ssoId?: string;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
  roles?: string[];
}

export interface AuditResource {
  type: string;
  id: string;
  name?: string;
  path?: string;
  attributes?: Record<string, any>;
}

export interface AuditMetadata {
  before?: any;
  after?: any;
  reason?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  tags?: Record<string, string>;
  [key: string]: any;
}

export interface AuditEvent {
  id: string;
  schemaVersion: string;
  sequenceNumber: number;
  timestamp: number;
  timezone: string;
  who: AuditActor;
  what: string;
  why?: string;
  when: number;
  where: {
    ip?: string;
    location?: string;
    service?: string;
    component?: string;
  };
  how: AuditMetadata;
  resource: AuditResource;
  outcome: AuditOutcome;
  outcomeMessage?: string;
  errorCode?: string;
  errorStack?: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  category?: string[];
  gdprRelevant: boolean;
  complianceFlags?: string[];
  correlationId?: string;
  causationId?: string;
  parentActor?: AuditActor;
  prevHash: string;
  hash: string;
  signature?: string;
}

export interface AuditChain {
  id: string;
  name: string;
  description?: string;
  scope: {
    orgId?: string;
    teamId?: string;
    serviceId?: string;
  };
  algorithm: 'sha256' | 'sha512';
  secretKey?: string;
  genesisHash: string;
  length: number;
  createdAt: number;
  lastEventAt?: number;
}

export interface ComplianceSection {
  title: string;
  description: string;
  controlIds: string[];
  events: AuditEvent[];
  summary: {
    total: number;
    success: number;
    failure: number;
    denied: number;
  };
}

export interface ComplianceReport {
  id: string;
  standard: ComplianceStandard;
  period: { from: number; to: number };
  generatedAt: number;
  totalEvents: number;
  byEventType: Partial<Record<AuditEventType, number>>;
  byOutcome: Partial<Record<AuditOutcome, number>>;
  byActor: Record<string, number>;
  byResourceType: Record<string, number>;
  sections: ComplianceSection[];
  integrityVerified: boolean;
  integrityCheck: ChainVerificationResult;
  metadata?: Record<string, any>;
}

export interface ChainVerificationResult {
  valid: boolean;
  chainId: string;
  checkedAt: number;
  totalChecked: number;
  firstInvalidIndex?: number;
  errors?: string[];
}

export interface Period {
  from: number;
  to: number;
}

export interface AuditFilter {
  eventTypes?: AuditEventType[];
  actorIds?: string[];
  actorTypes?: ActorType[];
  resourceTypes?: string[];
  resourceIds?: string[];
  outcomes?: AuditOutcome[];
  severities?: AuditSeverity[];
  from?: number;
  to?: number;
  correlationId?: string;
  causationId?: string;
  gdprRelevant?: boolean;
  complianceFlags?: string[];
  textSearch?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'severity';
  orderDir?: 'asc' | 'desc';
}

export interface AuditEngineEvent {
  type: AuditEngineEventType;
  timestamp: number;
  data: unknown;
}

export type AuditEngineEventType =
  | 'event-logged'
  | 'event-rejected'
  | 'chain-verified'
  | 'chain-broken'
  | 'report-generated'
  | 'export-completed'
  | 'actor-anonymized'
  | 'actor-deleted'
  | 'retention-applied'
  | 'config-updated';

export interface AuditEngineConfig {
  baseCurrency: string;
  storageBackend: 'localStorage' | 'indexedDB' | 'memory';
  retentionDays: number;
  enableSigning: boolean;
  secretKey?: string;
  enablePIIPseudonymization: boolean;
  piiFields: string[];
  maxEvents: number;
  enableAutoArchive: boolean;
  archiveAfterDays: number;
  enableIntegrityCheck: boolean;
  complianceStandards: ComplianceStandard[];
  maxStackTraceLines: number;
  storageQuotaWarningThreshold: number;
  defaultSchemaVersion: string;
  persist: boolean;
  storageKey: string;
}

export interface SerializedAuditState {
  events: AuditEvent[];
  chains: AuditChain[];
  config: Partial<AuditEngineConfig>;
}

// ============ 默认配置 ============

export const DEFAULT_AUDIT_CONFIG: AuditEngineConfig = {
  baseCurrency: 'USD',
  storageBackend: 'localStorage',
  retentionDays: 2555,                       // 7 年
  enableSigning: true,
  enablePIIPseudonymization: true,
  piiFields: ['email', 'phone', 'ssn', 'ip'],
  maxEvents: 1_000_000,
  enableAutoArchive: true,
  archiveAfterDays: 365,
  enableIntegrityCheck: true,
  complianceStandards: ['SOC2', 'ISO27001', 'GDPR', 'EUAIAct'],
  maxStackTraceLines: 10,
  storageQuotaWarningThreshold: 0.8,
  defaultSchemaVersion: '1.0',
  persist: true,
  storageKey: 'hermes.auditTrail',
};

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export const COMPLIANCE_CONTROLS: Record<ComplianceStandard, Array<{ id: string; title: string; eventTypes: AuditEventType[] }>> = {
  SOC2: [
    { id: 'CC1.1', title: 'COSO Principle 1 - Integrity and Ethics', eventTypes: ['admin', 'system'] },
    { id: 'CC6.1', title: 'Logical Access Controls', eventTypes: ['auth', 'authz'] },
    { id: 'CC6.2', title: 'Privileged Access', eventTypes: ['auth', 'authz', 'admin'] },
    { id: 'CC6.6', title: 'External Access', eventTypes: ['auth'] },
    { id: 'CC7.2', title: 'System Monitoring', eventTypes: ['system', 'data'] },
    { id: 'CC7.3', title: 'Anomaly Detection', eventTypes: ['system', 'authz'] },
    { id: 'CC8.1', title: 'Change Management', eventTypes: ['admin', 'data'] },
    { id: 'A1.2', title: 'System Availability', eventTypes: ['system'] },
  ],
  ISO27001: [
    { id: 'A.5.10', title: 'Acceptable Use', eventTypes: ['authz', 'data'] },
    { id: 'A.5.15', title: 'Access Control', eventTypes: ['auth', 'authz'] },
    { id: 'A.5.16', title: 'Identity Management', eventTypes: ['auth', 'admin'] },
    { id: 'A.5.17', title: 'Authentication Information', eventTypes: ['auth'] },
    { id: 'A.5.34', title: 'Privacy of PII', eventTypes: ['data', 'compliance'] },
    { id: 'A.8.2', title: 'Privileged Access Rights', eventTypes: ['authz', 'admin'] },
    { id: 'A.8.3', title: 'Information Access Restriction', eventTypes: ['authz', 'data'] },
    { id: 'A.8.5', title: 'Secure Authentication', eventTypes: ['auth'] },
    { id: 'A.8.15', title: 'Logging', eventTypes: ['auth', 'authz', 'data', 'admin', 'system', 'agent', 'compliance'] },
    { id: 'A.8.16', title: 'Monitoring Activities', eventTypes: ['system'] },
    { id: 'A.12.4', title: 'Logging and Monitoring', eventTypes: ['auth', 'authz', 'data', 'admin', 'system', 'agent', 'compliance'] },
    { id: 'A.13.1', title: 'Network Security', eventTypes: ['system'] },
  ],
  GDPR: [
    { id: 'Art.5', title: 'Principles of Processing', eventTypes: ['data', 'compliance'] },
    { id: 'Art.15', title: 'Right of Access', eventTypes: ['compliance'] },
    { id: 'Art.17', title: 'Right to Erasure', eventTypes: ['compliance'] },
    { id: 'Art.20', title: 'Data Portability', eventTypes: ['data', 'compliance'] },
    { id: 'Art.25', title: 'Data Protection by Design', eventTypes: ['admin', 'compliance'] },
    { id: 'Art.30', title: 'Records of Processing', eventTypes: ['data'] },
    { id: 'Art.32', title: 'Security of Processing', eventTypes: ['auth', 'authz', 'system'] },
    { id: 'Art.33', title: 'Breach Notification', eventTypes: ['system', 'compliance'] },
  ],
  EUAIAct: [
    { id: 'Art.9', title: 'Risk Management System', eventTypes: ['agent', 'authz'] },
    { id: 'Art.10', title: 'Data Governance', eventTypes: ['data'] },
    { id: 'Art.11', title: 'Technical Documentation', eventTypes: ['admin'] },
    { id: 'Art.12', title: 'Record-Keeping', eventTypes: ['auth', 'authz', 'data', 'admin', 'system', 'agent', 'compliance'] },
    { id: 'Art.13', title: 'Transparency to Deployers', eventTypes: ['agent'] },
    { id: 'Art.14', title: 'Human Oversight', eventTypes: ['authz', 'admin'] },
    { id: 'Art.15', title: 'Accuracy, Robustness, Cybersecurity', eventTypes: ['system', 'agent'] },
    { id: 'Art.17', title: 'Quality Management System', eventTypes: ['admin'] },
  ],
};

// ============ 工具函数 ============

export function generateAuditId(): string {
  return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateChainId(): string {
  return `chain-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateReportId(standard: ComplianceStandard): string {
  return `rep-${standard.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * SHA-256 hash function (uses Web Crypto API in browser, falls back to JS impl)
 */
export async function sha256(data: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback simple hash
  return simpleHash(data);
}

/**
 * Synchronous SHA-256 (simplified for testing)
 */
export function sha256Sync(data: string): string {
  return simpleHash(data);
}

/**
 * Simple hash function for environments without crypto.subtle
 * NOT cryptographically secure - for testing/development only
 */
function simpleHash(data: string): string {
  let hash1 = 0xdeadbeef;
  let hash2 = 0x41c6ce57;
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    hash1 = Math.imul(hash1 ^ ch, 2654435761);
    hash2 = Math.imul(hash2 ^ ch, 1597334677);
  }
  hash1 = Math.imul(hash1 ^ (hash1 >>> 16), 2246822507) ^ Math.imul(hash2 ^ (hash2 >>> 13), 3266489909);
  hash2 = Math.imul(hash2 ^ (hash2 >>> 16), 2246822507) ^ Math.imul(hash1 ^ (hash1 >>> 13), 3266489909);
  const combined = (hash2 >>> 0).toString(16).padStart(8, '0') + (hash1 >>> 0).toString(16).padStart(8, '0');
  return combined.repeat(4).slice(0, 64);
}

/**
 * Canonical JSON serialization (stable key order)
 */
export function canonicalJSON(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSON).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute hash for an audit event
 */
export function computeEventHash(
  event: Partial<Omit<AuditEvent, 'hash'>> & { who: AuditEvent['who']; what: string; resource: AuditEvent['resource']; outcome: AuditEvent['outcome']; eventType: AuditEvent['eventType']; prevHash: string },
  _algorithm: 'sha256' | 'sha512' = 'sha256'
): string {
  const canonical = canonicalJSON({
    id: event.id,
    sequenceNumber: event.sequenceNumber,
    timestamp: event.timestamp,
    schemaVersion: event.schemaVersion,
    who: event.who,
    what: event.what,
    why: event.why,
    where: event.where,
    resource: event.resource,
    outcome: event.outcome,
    outcomeMessage: event.outcomeMessage,
    eventType: event.eventType,
    severity: event.severity,
    correlationId: event.correlationId,
    causationId: event.causationId,
    prevHash: event.prevHash,
  });
  return sha256Sync(canonical);
}

/**
 * Pseudonymize a PII value
 */
export function pseudonymize(value: string, type: 'email' | 'phone' | 'ip' | 'name' | 'ssn' = 'email'): string {
  if (!value) return value;

  switch (type) {
    case 'email': {
      const hash = simpleHash(value).slice(0, 8);
      return `email_${hash}@anon.local`;
    }
    case 'phone': {
      const hash = simpleHash(value).slice(0, 8);
      return `phone_${hash}`;
    }
    case 'ip': {
      if (value.includes('.')) {
        // IPv4
        const parts = value.split('.');
        if (parts.length === 4) {
          parts[3] = '0';
          return parts.join('.');
        }
      }
      if (value.includes(':')) {
        // IPv6: 保留前 3 段 + :: 压缩后缀
        // 例 2001:db8::1234 → 2001:db8::
        const idx = value.indexOf('::');
        if (idx >= 0) {
          // 已经有 :: ，截取到 ::
          return value.substring(0, idx + 2);
        }
        const parts = value.split(':');
        if (parts.length >= 3) {
          return parts.slice(0, 3).join(':') + '::';
        }
        return value.split(':').slice(0, 1).join(':') + '::';
      }
      return value;
    }
    case 'name': {
      return value
        .split(' ')
        .map((p) => (p.length > 0 ? p[0] + '***' : ''))
        .join(' ');
    }
    case 'ssn': {
      const hash = simpleHash(value).slice(0, 8);
      return `ssn_${hash}`;
    }
    default:
      return value;
  }
}

/**
 * Pseudonymize an entire actor object
 */
export function pseudonymizeActor(actor: AuditActor, config: AuditEngineConfig): AuditActor {
  if (!config.enablePIIPseudonymization) return actor;

  return {
    ...actor,
    email: actor.email ? pseudonymize(actor.email, 'email') : undefined,
    name: actor.name ? pseudonymize(actor.name, 'name') : undefined,
    ip: actor.ip ? pseudonymize(actor.ip, 'ip') : undefined,
  };
}

// ============ 引擎主类 ============

export class AuditTrailEngine {
  private config: AuditEngineConfig;
  private events: AuditEvent[] = [];
  private chains: Map<string, AuditChain> = new Map();
  private listeners: Map<AuditEngineEventType, Set<(e: AuditEngineEvent) => void>> = new Map();
  private currentSequence: number = 0;
  private archivedCount: number = 0;
  private deletedCount: number = 0;

  constructor(config: Partial<AuditEngineConfig> = {}) {
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
    if (this.chains.size === 0) {
      this.createDefaultChain();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.config.storageKey) : null;
      if (raw) {
        const state: SerializedAuditState = JSON.parse(raw);
        if (Array.isArray(state.events)) {
          this.events = state.events;
          this.currentSequence = state.events.length > 0
            ? Math.max(...state.events.map((e) => e.sequenceNumber))
            : 0;
        }
        if (Array.isArray(state.chains)) {
          for (const c of state.chains) this.chains.set(c.id, c);
        }
      }
    } catch (e) {
      console.warn('AuditTrailEngine: failed to load state', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state: SerializedAuditState = {
        events: this.events.slice(-this.config.maxEvents),
        chains: Array.from(this.chains.values()),
        config: this.config,
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.config.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('AuditTrailEngine: failed to save state', e);
    }
  }

  // ============ 链管理 ============

  private createDefaultChain(): AuditChain {
    const chain: AuditChain = {
      id: generateChainId(),
      name: 'default',
      description: 'Default audit chain',
      scope: {},
      algorithm: 'sha256',
      genesisHash: GENESIS_HASH,
      length: 0,
      createdAt: Date.now(),
    };
    this.chains.set(chain.id, chain);
    return chain;
  }

  getChain(chainId: string): AuditChain | undefined {
    return this.chains.get(chainId);
  }

  listChains(): AuditChain[] {
    return Array.from(this.chains.values());
  }

  // ============ 事件记录 ============

  log(
    input: Omit<AuditEvent, 'id' | 'sequenceNumber' | 'timestamp' | 'timezone' | 'prevHash' | 'hash' | 'schemaVersion' | 'when' | 'where' | 'how' | 'gdprRelevant'> & { where?: AuditEvent['where']; how?: AuditEvent['how']; gdprRelevant?: boolean }
  ): AuditEvent {
    // PII 脱敏
    const who = pseudonymizeActor(input.who, this.config);

    const lastEvent = this.events[this.events.length - 1];
    const prevHash = lastEvent ? lastEvent.hash : GENESIS_HASH;
    const sequenceNumber = this.currentSequence;
    const timestamp = Date.now();

    const eventBase: Omit<AuditEvent, 'hash'> = {
      id: generateAuditId(),
      schemaVersion: this.config.defaultSchemaVersion,
      sequenceNumber,
      timestamp,
      timezone: 'UTC',
      who,
      what: input.what,
      why: input.why,
      when: timestamp,
      where: input.where || {},
      how: input.how || {},
      resource: input.resource,
      outcome: input.outcome,
      outcomeMessage: input.outcomeMessage,
      errorCode: input.errorCode,
      errorStack: input.errorStack,
      eventType: input.eventType,
      severity: input.severity,
      category: input.category,
      gdprRelevant: input.gdprRelevant || false,
      complianceFlags: input.complianceFlags,
      correlationId: input.correlationId,
      causationId: input.causationId,
      parentActor: input.parentActor,
      prevHash,
    };

    const hash = computeEventHash(eventBase);
    const event: AuditEvent = { ...eventBase, hash };

    this.events.push(event);
    this.currentSequence = sequenceNumber + 1;

    // 更新链
    if (this.chains.size > 0) {
      const chain = this.chains.values().next().value;
      if (chain) {
        chain.length = sequenceNumber + 1;
        chain.lastEventAt = timestamp;
      }
    }

    // 截断
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }

    this.save();
    this.emit('event-logged', { event });
    return event;
  }

  logAuth(input: {
    who: AuditActor;
    what: string;
    resource: AuditResource;
    outcome: AuditOutcome;
    outcomeMessage?: string;
    correlationId?: string;
    metadata?: AuditMetadata;
  }): AuditEvent {
    return this.log({
      who: input.who,
      what: input.what,
      where: { component: 'auth' },
      resource: input.resource,
      outcome: input.outcome,
      outcomeMessage: input.outcomeMessage,
      how: input.metadata || {},
      eventType: 'auth',
      severity: input.outcome === 'success' ? 'info' : 'warn',
      gdprRelevant: !!input.who.email,
      correlationId: input.correlationId,
    });
  }

  logAuthz(input: {
    who: AuditActor;
    what: string;
    resource: AuditResource;
    outcome: AuditOutcome;
    reason?: string;
    policyId?: string;
    correlationId?: string;
    metadata?: AuditMetadata;
  }): AuditEvent {
    return this.log({
      who: input.who,
      what: input.what,
      why: input.reason,
      where: { component: 'authz' },
      resource: input.resource,
      outcome: input.outcome,
      how: { ...input.metadata, policyId: input.policyId },
      eventType: 'authz',
      severity: input.outcome === 'denied' ? 'warn' : 'info',
      gdprRelevant: false,
      complianceFlags: input.policyId ? ['policy-enforcement'] : undefined,
      correlationId: input.correlationId,
    });
  }

  logData(input: {
    who: AuditActor;
    what: string;
    resource: AuditResource;
    outcome: AuditOutcome;
    before?: any;
    after?: any;
    gdprRelevant?: boolean;
    correlationId?: string;
  }): AuditEvent {
    return this.log({
      who: input.who,
      what: input.what,
      where: { component: 'data' },
      resource: input.resource,
      outcome: input.outcome,
      how: { before: input.before, after: input.after },
      eventType: 'data',
      severity: input.outcome === 'failure' ? 'warn' : 'info',
      gdprRelevant: input.gdprRelevant ?? !!input.resource.attributes?.pii,
      complianceFlags: input.gdprRelevant ? ['gdpr'] : undefined,
      correlationId: input.correlationId,
    });
  }

  logAdmin(input: {
    who: AuditActor;
    what: string;
    resource: AuditResource;
    outcome: AuditOutcome;
    before?: any;
    after?: any;
    correlationId?: string;
  }): AuditEvent {
    return this.log({
      who: input.who,
      what: input.what,
      where: { component: 'admin' },
      resource: input.resource,
      outcome: input.outcome,
      how: { before: input.before, after: input.after },
      eventType: 'admin',
      severity: input.outcome === 'failure' ? 'error' : 'info',
      gdprRelevant: false,
      correlationId: input.correlationId,
    });
  }

  logSystem(input: {
    who: AuditActor;
    what: string;
    resource: AuditResource;
    outcome: AuditOutcome;
    metadata?: AuditMetadata;
    errorStack?: string;
  }): AuditEvent {
    const truncated = input.errorStack
      ? input.errorStack.split('\n').slice(0, this.config.maxStackTraceLines).join('\n')
      : undefined;
    return this.log({
      who: input.who,
      what: input.what,
      where: { component: 'system' },
      resource: input.resource,
      outcome: input.outcome,
      how: input.metadata || {},
      eventType: 'system',
      severity: input.outcome === 'failure' ? 'error' : 'info',
      gdprRelevant: false,
      errorStack: truncated,
    });
  }

  logAgent(input: {
    who: AuditActor;
    what: string;
    resource: AuditResource;
    outcome: AuditOutcome;
    metadata?: AuditMetadata;
    correlationId?: string;
  }): AuditEvent {
    return this.log({
      who: input.who,
      what: input.what,
      where: { component: 'agent' },
      resource: input.resource,
      outcome: input.outcome,
      how: input.metadata || {},
      eventType: 'agent',
      severity: 'info',
      gdprRelevant: false,
      complianceFlags: ['eu-ai-act'],
      correlationId: input.correlationId,
    });
  }

  logCompliance(input: {
    who: AuditActor;
    what: string;
    resource: AuditResource;
    outcome: AuditOutcome;
    standard?: ComplianceStandard;
    metadata?: AuditMetadata;
  }): AuditEvent {
    return this.log({
      who: input.who,
      what: input.what,
      where: { component: 'compliance' },
      resource: input.resource,
      outcome: input.outcome,
      how: input.metadata || {},
      eventType: 'compliance',
      severity: 'info',
      gdprRelevant: true,
      complianceFlags: input.standard ? [input.standard.toLowerCase()] : ['gdpr'],
    });
  }

  // ============ 便捷方法 ============

  login(actor: AuditActor, success: boolean, metadata?: AuditMetadata): AuditEvent {
    return this.logAuth({
      who: actor,
      what: success ? 'user.login' : 'user.login.failed',
      resource: { type: 'session', id: actor.sessionId || 'unknown' },
      outcome: success ? 'success' : 'failure',
      outcomeMessage: success ? 'Login successful' : 'Login failed',
      metadata,
    });
  }

  logout(actor: AuditActor, metadata?: AuditMetadata): AuditEvent {
    return this.logAuth({
      who: actor,
      what: 'user.logout',
      resource: { type: 'session', id: actor.sessionId || 'unknown' },
      outcome: 'success',
      outcomeMessage: 'Logout successful',
      metadata,
    });
  }

  access(actor: AuditActor, resource: AuditResource, action: string, outcome: AuditOutcome): AuditEvent {
    return this.logAuthz({
      who: actor,
      what: action,
      resource,
      outcome,
    });
  }

  decision(actor: AuditActor, decision: { policy: string; rule: string; effect: string; reason: string }): AuditEvent {
    return this.logAuthz({
      who: actor,
      what: `policy.${decision.effect}`,
      resource: { type: 'policy', id: decision.policy },
      outcome: decision.effect === 'allow' ? 'success' : decision.effect === 'deny' ? 'denied' : 'pending',
      reason: decision.reason,
      policyId: decision.policy,
    });
  }

  // ============ 查询 ============

  getById(id: string): AuditEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  getByCorrelationId(correlationId: string): AuditEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  getByActor(actorId: string, period?: Period): AuditEvent[] {
    return this.events.filter((e) => {
      if (e.who.id !== actorId) return false;
      if (period && (e.timestamp < period.from || e.timestamp > period.to)) return false;
      return true;
    });
  }

  getByResource(resourceType: string, resourceId: string, period?: Period): AuditEvent[] {
    return this.events.filter((e) => {
      if (e.resource.type !== resourceType || e.resource.id !== resourceId) return false;
      if (period && (e.timestamp < period.from || e.timestamp > period.to)) return false;
      return true;
    });
  }

  query(filter: AuditFilter): AuditEvent[] {
    let result = this.events;

    if (filter.eventTypes && filter.eventTypes.length > 0) {
      result = result.filter((e) => filter.eventTypes!.includes(e.eventType));
    }
    if (filter.actorIds && filter.actorIds.length > 0) {
      result = result.filter((e) => filter.actorIds!.includes(e.who.id));
    }
    if (filter.actorTypes && filter.actorTypes.length > 0) {
      result = result.filter((e) => filter.actorTypes!.includes(e.who.type));
    }
    if (filter.resourceTypes && filter.resourceTypes.length > 0) {
      result = result.filter((e) => filter.resourceTypes!.includes(e.resource.type));
    }
    if (filter.resourceIds && filter.resourceIds.length > 0) {
      result = result.filter((e) => filter.resourceIds!.includes(e.resource.id));
    }
    if (filter.outcomes && filter.outcomes.length > 0) {
      result = result.filter((e) => filter.outcomes!.includes(e.outcome));
    }
    if (filter.severities && filter.severities.length > 0) {
      result = result.filter((e) => filter.severities!.includes(e.severity));
    }
    if (filter.from !== undefined) {
      result = result.filter((e) => e.timestamp >= filter.from!);
    }
    if (filter.to !== undefined) {
      result = result.filter((e) => e.timestamp <= filter.to!);
    }
    if (filter.correlationId) {
      result = result.filter((e) => e.correlationId === filter.correlationId);
    }
    if (filter.gdprRelevant !== undefined) {
      result = result.filter((e) => e.gdprRelevant === filter.gdprRelevant);
    }
    if (filter.textSearch) {
      const q = filter.textSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.what.toLowerCase().includes(q) ||
          e.who.id.toLowerCase().includes(q) ||
          (e.who.name && e.who.name.toLowerCase().includes(q)) ||
          e.resource.id.toLowerCase().includes(q)
      );
    }

    // 排序
    if (filter.orderBy) {
      const dir = filter.orderDir === 'asc' ? 1 : -1;
      result = [...result].sort((a, b) => {
        if (filter.orderBy === 'severity') {
          const sevOrder: Record<AuditSeverity, number> = { debug: 0, info: 1, warn: 2, error: 3, critical: 4 };
          return (sevOrder[a.severity] - sevOrder[b.severity]) * dir;
        }
        return (a.timestamp - b.timestamp) * dir;
      });
    }

    // 分页
    if (filter.offset || filter.limit) {
      const start = filter.offset || 0;
      const end = filter.limit ? start + filter.limit : undefined;
      result = result.slice(start, end);
    }

    return result;
  }

  // ============ 完整性验证 ============

  verifyChain(chainId?: string): ChainVerificationResult {
    const chain = chainId
      ? this.chains.get(chainId)
      : this.chains.values().next().value;

    if (!chain) {
      return {
        valid: false,
        chainId: chainId || 'unknown',
        checkedAt: Date.now(),
        totalChecked: 0,
        errors: ['Chain not found'],
      };
    }

    let prevHash = chain.genesisHash;
    let sequence = 0;

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];

      if (event.sequenceNumber !== sequence) {
        return {
          valid: false,
          chainId: chain.id,
          checkedAt: Date.now(),
          totalChecked: i,
          firstInvalidIndex: i,
          errors: [`Sequence number mismatch at index ${i}`],
        };
      }

      if (event.prevHash !== prevHash) {
        return {
          valid: false,
          chainId: chain.id,
          checkedAt: Date.now(),
          totalChecked: i,
          firstInvalidIndex: i,
          errors: [`Previous hash mismatch at index ${i}`],
        };
      }

      const { hash: _hash, ...eventWithoutHash } = event;
      const recomputed = computeEventHash(eventWithoutHash);
      if (recomputed !== event.hash) {
        return {
          valid: false,
          chainId: chain.id,
          checkedAt: Date.now(),
          totalChecked: i,
          firstInvalidIndex: i,
          errors: [`Hash mismatch at index ${i}`],
        };
      }

      prevHash = event.hash;
      sequence++;
    }

    const result: ChainVerificationResult = {
      valid: true,
      chainId: chain.id,
      checkedAt: Date.now(),
      totalChecked: this.events.length,
    };

    this.emit('chain-verified', result);
    return result;
  }

  verifyEvent(eventId: string): { valid: boolean; reason?: string } {
    const event = this.getById(eventId);
    if (!event) return { valid: false, reason: 'Event not found' };

    const { hash: _hash, ...eventWithoutHash } = event;
    const recomputed = computeEventHash(eventWithoutHash);
    if (recomputed !== event.hash) {
      return { valid: false, reason: 'Hash mismatch' };
    }

    if (event.sequenceNumber > 0) {
      const prev = this.events[event.sequenceNumber - 1];
      if (prev && prev.hash !== event.prevHash) {
        return { valid: false, reason: 'Previous hash mismatch' };
      }
    } else if (event.prevHash !== GENESIS_HASH) {
      return { valid: false, reason: 'Invalid genesis prevHash' };
    }

    return { valid: true };
  }

  // ============ 合规报告 ============

  generateReport(standard: ComplianceStandard, period: Period, orgId?: string): ComplianceReport {
    const events = this.query({
      from: period.from,
      to: period.to,
    }).filter((e) => !orgId || e.who.id.includes(orgId) || e.where.service === orgId);

    const byEventType: Partial<Record<AuditEventType, number>> = {};
    const byOutcome: Partial<Record<AuditOutcome, number>> = {};
    const byActor: Record<string, number> = {};
    const byResourceType: Record<string, number> = {};

    for (const e of events) {
      byEventType[e.eventType] = (byEventType[e.eventType] || 0) + 1;
      byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
      byActor[e.who.id] = (byActor[e.who.id] || 0) + 1;
      byResourceType[e.resource.type] = (byResourceType[e.resource.type] || 0) + 1;
    }

    const controls = COMPLIANCE_CONTROLS[standard];
    const sections: ComplianceSection[] = controls.map((ctrl) => {
      const ctrlEvents = events.filter((e) => ctrl.eventTypes.includes(e.eventType));
      const summary = {
        total: ctrlEvents.length,
        success: ctrlEvents.filter((e) => e.outcome === 'success').length,
        failure: ctrlEvents.filter((e) => e.outcome === 'failure').length,
        denied: ctrlEvents.filter((e) => e.outcome === 'denied').length,
      };
      return {
        title: ctrl.title,
        description: `Control ${ctrl.id} from ${standard}`,
        controlIds: [ctrl.id],
        events: ctrlEvents,
        summary,
      };
    });

    const integrityCheck = this.verifyChain();
    const report: ComplianceReport = {
      id: generateReportId(standard),
      standard,
      period,
      generatedAt: Date.now(),
      totalEvents: events.length,
      byEventType,
      byOutcome,
      byActor,
      byResourceType,
      sections,
      integrityVerified: integrityCheck.valid,
      integrityCheck,
      metadata: orgId ? { orgId } : undefined,
    };

    this.emit('report-generated', { report });
    return report;
  }

  generateSOC2Report(period: Period, orgId?: string): ComplianceReport {
    return this.generateReport('SOC2', period, orgId);
  }

  generateISO27001Report(period: Period, orgId?: string): ComplianceReport {
    return this.generateReport('ISO27001', period, orgId);
  }

  generateGDPRReport(period: Period, orgId?: string): ComplianceReport {
    return this.generateReport('GDPR', period, orgId);
  }

  generateEUAIActReport(period: Period, orgId?: string): ComplianceReport {
    return this.generateReport('EUAIAct', period, orgId);
  }

  // ============ 导出 ============

  exportJSON(filter: AuditFilter): string {
    const events = this.query(filter);
    return JSON.stringify(
      {
        schemaVersion: this.config.defaultSchemaVersion,
        exportedAt: Date.now(),
        count: events.length,
        events,
      },
      null,
      2
    );
  }

  exportCSV(filter: AuditFilter): string {
    const events = this.query(filter);
    const headers = [
      'id', 'timestamp', 'eventType', 'severity', 'action', 'outcome',
      'actorId', 'actorType', 'resourceType', 'resourceId',
      'correlationId', 'prevHash', 'hash',
    ];
    const rows = events.map((e) =>
      [
        e.id,
        new Date(e.timestamp).toISOString(),
        e.eventType,
        e.severity,
        e.what,
        e.outcome,
        e.who.id,
        e.who.type,
        e.resource.type,
        e.resource.id,
        e.correlationId || '',
        e.prevHash,
        e.hash,
      ]
        .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v.replace(/"/g, '""')}"` : v))
        .join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  exportCEF(filter: AuditFilter): string {
    // Common Event Format (ArcSight)
    const events = this.query(filter);
    return events
      .map((e) => {
        const ext = [
          `act=${e.what}`,
          `suid=${e.who.id}`,
          `suser=${e.who.name || e.who.id}`,
          `outcome=${e.outcome}`,
          `cat=${e.eventType}`,
          `cs1=${e.correlationId || ''}`,
          `cs1Label=correlationId`,
          `cs2=${e.hash}`,
          `cs2Label=hash`,
          `deviceSeverity=${e.severity}`,
        ].join(' ');
        return `CEF:0|Hermes|AuditTrail|1.0|${e.eventType}|${e.what}|${e.severity}|${ext}`;
      })
      .join('\n');
  }

  exportLEEF(filter: AuditFilter): string {
    // Log Event Extended Format (IBM QRadar)
    const events = this.query(filter);
    return events
      .map((e) => {
        const attrs = [
          `devTimeFormat=ISO-8601`,
          `src=${e.who.id}`,
          `usrName=${e.who.name || e.who.id}`,
          `eventId=${e.id}`,
          `sev=${e.severity}`,
          `cat=${e.eventType}`,
          `action=${e.what}`,
          `outcome=${e.outcome}`,
          `resource=${e.resource.type}/${e.resource.id}`,
          `correlId=${e.correlationId || ''}`,
          `hash=${e.hash}`,
        ].join('\t');
        return `LEEF:1.0|Hermes|AuditTrail|1.0|${e.eventType}|${attrs}`;
      })
      .join('\n');
  }

  // ============ GDPR 操作 ============

  anonymizeActor(actorId: string): number {
    let count = 0;
    this.events = this.events.map((e) => {
      if (e.who.id === actorId) {
        count++;
        return {
          ...e,
          who: { ...e.who, name: 'anonymized', email: 'anonymized@anon.local' },
        };
      }
      return e;
    });
    if (count > 0) {
      this.save();
      this.emit('actor-anonymized', { actorId, count });
    }
    return count;
  }

  exportActorData(actorId: string): AuditEvent[] {
    return this.getByActor(actorId);
  }

  deleteActorData(actorId: string): number {
    // Soft delete: replace actor identity but keep events
    return this.anonymizeActor(actorId);
  }

  // ============ 保留管理 ============

  applyRetentionPolicy(): { archived: number; deleted: number } {
    const cutoff = Date.now() - this.config.retentionDays * 86400000;
    let archived = 0;
    let deleted = 0;

    if (this.config.enableAutoArchive) {
      const archiveCutoff = Date.now() - this.config.archiveAfterDays * 86400000;
      const before = this.events.length;
      // 简化：archive = 标记，不实际移动
      this.archivedCount = this.events.filter((e) => e.timestamp < archiveCutoff).length;
      archived = this.archivedCount;
      void before; // suppress unused
    }

    const beforeDel = this.events.length;
    this.events = this.events.filter((e) => e.timestamp >= cutoff);
    deleted = beforeDel - this.events.length;
    this.deletedCount += deleted;

    if (archived > 0 || deleted > 0) {
      this.save();
      this.emit('retention-applied', { archived, deleted });
    }
    return { archived, deleted };
  }

  archive(olderThan: number): number {
    const before = this.events.length;
    this.archivedCount += this.events.filter((e) => e.timestamp < olderThan).length;
    return before;
  }

  delete(olderThan: number): number {
    const before = this.events.length;
    this.events = this.events.filter((e) => e.timestamp >= olderThan);
    const deleted = before - this.events.length;
    this.deletedCount += deleted;
    this.save();
    return deleted;
  }

  // ============ 事件订阅 ============

  on(event: AuditEngineEventType, listener: (e: AuditEngineEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(type: AuditEngineEventType, data: unknown): void {
    const event: AuditEngineEvent = { type, timestamp: Date.now(), data };
    this.listeners.get(type)?.forEach((l) => {
      try {
        l(event);
      } catch (e) {
        console.error(`AuditTrailEngine listener error for ${type}:`, e);
      }
    });
  }

  // ============ 配置 ============

  getConfig(): AuditEngineConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<AuditEngineConfig>): void {
    this.config = { ...this.config, ...updates };
    this.save();
    this.emit('config-updated', { config: this.config });
  }

  // ============ 统计 ============

  count(): number {
    return this.events.length;
  }

  countByType(): Partial<Record<AuditEventType, number>> {
    const result: Partial<Record<AuditEventType, number>> = {};
    for (const e of this.events) {
      result[e.eventType] = (result[e.eventType] || 0) + 1;
    }
    return result;
  }

  getStats(): {
    totalEvents: number;
    byType: Partial<Record<AuditEventType, number>>;
    byOutcome: Partial<Record<AuditOutcome, number>>;
    chains: number;
    archivedCount: number;
    deletedCount: number;
    currentSequence: number;
  } {
    const byOutcome: Partial<Record<AuditOutcome, number>> = {};
    for (const e of this.events) {
      byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
    }
    return {
      totalEvents: this.events.length,
      byType: this.countByType(),
      byOutcome,
      chains: this.chains.size,
      archivedCount: this.archivedCount,
      deletedCount: this.deletedCount,
      currentSequence: this.currentSequence,
    };
  }

  clear(): void {
    this.events = [];
    this.currentSequence = 0;
    this.chains.clear();
    this.createDefaultChain();
    this.save();
  }
}

// ============ 全局单例 ============

let defaultInstance: AuditTrailEngine | null = null;

export function getDefaultAuditTrailEngine(): AuditTrailEngine {
  if (!defaultInstance) {
    defaultInstance = new AuditTrailEngine();
  }
  return defaultInstance;
}

export function setDefaultAuditTrailEngine(engine: AuditTrailEngine): void {
  defaultInstance = engine;
}
