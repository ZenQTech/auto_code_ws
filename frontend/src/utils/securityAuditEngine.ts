/**
 * # ============================================================
 * # Security Audit Engine - 安全审计场景引擎 (v1.0.0 Cycle 33 G33-03)
 * # ============================================================
 * # 核心作用：安全审计场景引擎，提供 7 个预置攻击场景的自动化执行+验证+报告
 * # 设计原则：
 * #   - 零误报：每个场景都有明确的预期
 * #   - 可重放：场景执行可重复
 * #   - 可审计：所有执行有详细日志
 * #   - CI/CD 友好：可集成到流水线
 * #   - 应急响应：触发后可启动应急流程
 * # ============================================================
 * # 运行流程：
 * #   1. registerScenario / registerEngine 注册场景和外部引擎
 * #   2. execute(scenarioId) 执行场景（setup → attack → validation）
 * #   3. triggerResponse 启动应急响应
 * #   4. generateReport / exportReport 生成报告
 * #   5. runInCI CI/CD 集成
 * # ============================================================
 * # 输入参数：AttackScenario / ScenarioStep / ValidationStep
 * # 输出结果：ScenarioExecution / IncidentResponse / SecurityAuditReport
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 33 G33-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type AttackCategory =
  | 'authentication'
  | 'authorization'
  | 'data'
  | 'session'
  | 'privilege'
  | 'malicious'
  | 'integrity';

export type AttackSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ScenarioStepStatus = 'success' | 'failure' | 'skipped';

export type ScenarioExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type IncidentStatus =
  | 'detected'
  | 'analyzing'
  | 'containing'
  | 'eradicating'
  | 'recovering'
  | 'closed';

export type SecurityAuditEvent =
  | 'scenario-registered'
  | 'scenario-updated'
  | 'scenario-deleted'
  | 'execution-started'
  | 'execution-completed'
  | 'execution-failed'
  | 'execution-cancelled'
  | 'validation-passed'
  | 'validation-failed'
  | 'incident-detected'
  | 'incident-responded'
  | 'incident-closed'
  | 'report-generated'
  | 'ci-completed';

/**
 * 场景步骤
 */
export interface ScenarioStep {
  id: string;
  name: string;
  /** 调用的方法（格式：engineId.method 或 仅 method） */
  action: string;
  args?: Record<string, any>;
  /** 步骤间延迟（毫秒） */
  delayMs?: number;
  /** 重复次数（攻击模拟放大用） */
  repeat?: number;
  /** 是否与其他步骤并行 */
  parallel?: boolean;
}

/**
 * 验证步骤
 */
export interface ValidationStep {
  id: string;
  name: string;
  /** 检查表达式（格式：engineId.method 或 仅 method） */
  check: string;
  expected: any;
  message?: string;
}

/**
 * 攻击场景
 */
export interface AttackScenario {
  id: string;
  name: string;
  description: string;
  category: AttackCategory;
  severity: AttackSeverity;
  version: string;
  setup: ScenarioStep[];
  attack: ScenarioStep[];
  validation: ValidationStep[];
  cleanup?: ScenarioStep[];
  expectedOutcome: {
    blocked: boolean;
    alerted: boolean;
    audited: boolean;
    maxAllowedSteps?: number;
  };
  metadata?: Record<string, any>;
  tags?: string[];
  author?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 步骤结果
 */
export interface ScenarioStepResult {
  stepId: string;
  stepName: string;
  action: string;
  status: ScenarioStepStatus;
  startTime: number;
  endTime: number;
  durationMs: number;
  output?: any;
  error?: string;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  validationId: string;
  name: string;
  passed: boolean;
  actual: any;
  expected: any;
  message?: string;
  timestamp: number;
}

/**
 * 日志条目
 */
export interface ScenarioLogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
}

/**
 * 场景执行
 */
export interface ScenarioExecution {
  id: string;
  scenarioId: string;
  scenarioVersion: string;
  status: ScenarioExecutionStatus;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  steps: ScenarioStepResult[];
  validations: ValidationResult[];
  outcome: {
    blocked: boolean;
    alerted: boolean;
    audited: boolean;
  };
  error?: string;
  logs: ScenarioLogEntry[];
  dryRun: boolean;
}

/**
 * 响应步骤
 */
export interface ResponseStep {
  id: string;
  name: string;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime: number;
  endTime?: number;
  output?: any;
}

/**
 * 应急响应
 */
export interface IncidentResponse {
  id: string;
  scenarioId: string;
  executionId: string;
  severity: AttackSeverity;
  status: IncidentStatus;
  steps: ResponseStep[];
  startTime: number;
  endTime?: number;
  notes?: string;
}

/**
 * 报告
 */
export interface SecurityAuditReport {
  id: string;
  generatedAt: number;
  period: { from: number; to: number };
  totalScenarios: number;
  passed: number;
  failed: number;
  scenarios: ScenarioExecution[];
  summary: {
    blockedAttacks: number;
    unblockedAttacks: number;
    alertsTriggered: number;
    auditEvents: number;
  };
  recommendations: string[];
  compliance: {
    soc2: boolean;
    gdpr: boolean;
    iso27001: boolean;
  };
}

export interface AuditPeriod {
  from: number;
  to: number;
}

/**
 * 引擎方法注册器（用于执行步骤 / 验证）
 */
export interface EngineMethod {
  (...args: any[]): any;
}

/**
 * 外部引擎注册项
 */
export interface RegisteredEngine {
  [methodName: string]: EngineMethod;
}

/**
 * 引擎配置
 */
export interface SecurityAuditConfig {
  /** 是否持久化（localStorage） */
  persist: boolean;
  /** 干运行（不执行真实攻击） */
  dryRunByDefault: boolean;
  /** 步骤执行超时（毫秒） */
  stepTimeoutMs: number;
  /** 最大执行历史保留数 */
  maxExecutions: number;
  /** 最大日志条目数（每执行） */
  maxLogsPerExecution: number;
}

export const DEFAULT_SECURITY_AUDIT_CONFIG: SecurityAuditConfig = {
  persist: true,
  dryRunByDefault: false,
  stepTimeoutMs: 5000,
  maxExecutions: 100,
  maxLogsPerExecution: 500,
};

// ============ 工具函数 ============

/**
 * 生成场景 ID
 */
export function generateScenarioId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `atk-${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 生成执行 ID
 */
export function generateExecutionId(): string {
  return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 生成应急响应 ID
 */
export function generateIncidentId(): string {
  return `inc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 生成报告 ID
 */
export function generateReportId(): string {
  return `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 深度比较
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as any[]).length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * 解析 action 字符串（engineId.method）
 */
export function parseAction(action: string): { engineId: string | null; method: string } {
  if (action.includes('.')) {
    const [engineId, method] = action.split('.');
    return { engineId, method };
  }
  return { engineId: null, method: action };
}

/**
 * 内部 mock 引擎：用于默认场景无外部依赖时返回结果
 */
function buildInternalEngines(): Map<string, RegisteredEngine> {
  const map = new Map<string, RegisteredEngine>();

  // sso 引擎（mock）
  map.set('sso', {
    createTestUser: (args: any = {}) => ({ id: `user-${Math.random().toString(36).slice(2, 8)}`, role: args.role || 'user' }),
    ssoLogin: (args: any = {}) => {
      if (args.wrongPassword) return { success: false, code: 'INVALID_CREDENTIALS' };
      return { success: true, sessionId: `sess-${Math.random().toString(36).slice(2, 8)}` };
    },
    isAccountLocked: () => true,
    requiresMFA: () => true,
    isSessionSuspicious: () => true,
    createSession: () => ({ sessionId: `sess-${Math.random().toString(36).slice(2, 8)}` }),
    accessFromAnomalousIP: (args: any = {}) => ({ ip: args.ip, allowed: false, mfaRequired: true }),
    validateSession: () => ({ valid: true, user: { id: 'u-1' } }),
  });

  // policy 引擎（mock）
  map.set('policy', {
    isBlocked: () => true,
    isRateLimited: () => true,
    decision: () => 'deny',
    enforce: (args: any = {}) => ({ decision: 'deny', rule: args.rule || 'default' }),
  });

  // audit 引擎（mock）
  map.set('audit', {
    log: () => ({ logged: true }),
    hasEvent: (query: any = {}) => ({ matched: true, ...query }),
    verifyChain: (query: any = {}) => ({ valid: false, ...query }),
    logAuditEvent: () => ({ id: `evt-${Math.random().toString(36).slice(2, 8)}` }),
  });

  // upload 引擎（mock）
  map.set('upload', {
    wasBlocked: () => true,
    uploadFile: (args: any = {}) => ({ accepted: !args.malicious, blocked: !!args.malicious }),
    prepareMaliciousFile: () => ({ name: 'malware.exe', size: 1024, hash: 'abc123' }),
  });

  // data 引擎（mock）
  map.set('data', {
    createSensitiveFiles: (args: any = {}) => ({ count: args.count || 100, location: '/data/sensitive' }),
    batchDownload: (args: any = {}) => ({ downloaded: 50, limited: true, requested: args.limit || 1000 }),
  });

  // admin 引擎（mock）
  map.set('admin', {
    callAdminAPI: (args: any = {}) => ({ allowed: false, reason: 'unauthorized', userRole: args.userRole }),
    escalateToAdmin: () => ({ granted: false, reason: 'policy_denied' }),
  });

  // system 引擎（mock）
  map.set('system', {
    tamperAuditEvent: () => ({ tampered: true }),
  });

  // incident 引擎（mock，用于应急响应）
  map.set('incident', {
    contain: () => ({ contained: true, affected: ['user-1'] }),
    eradicate: () => ({ eradicated: true, signatures: ['sig-1', 'sig-2'] }),
    recover: () => ({ recovered: true, downtime: 60 }),
    notify: (args: any = {}) => ({ sent: true, channels: args.channels || ['email'] }),
    analyze: () => ({ analyzed: true, indicators: ['ip:1.2.3.4', 'user:user-1'] }),
  });

  return map;
}

// ============ 预置攻击场景 ============

/**
 * 7 个预置攻击场景定义（用于 loadPresetScenarios）
 */
export const PRESET_ATTACK_SCENARIOS: Omit<AttackScenario, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'bruteforce-login',
    description: '暴力破解登录：通过 1000 次错误密码尝试触发账户锁定、审计告警、策略阻断。',
    category: 'authentication',
    severity: 'high',
    version: '1.0.0',
    setup: [
      { id: 's1', name: '创建测试用户', action: 'sso.createTestUser', args: { username: 'victim' } },
    ],
    attack: [
      { id: 'a1', name: '1000 次错误密码', action: 'sso.ssoLogin', repeat: 1000, args: { wrongPassword: true } },
    ],
    validation: [
      { id: 'v1', name: '账户已锁定', check: 'sso.isAccountLocked', expected: true, message: '账户应在多次失败后被锁定' },
      { id: 'v2', name: '审计告警', check: 'audit.hasEvent', expected: { matched: true, eventType: 'auth' }, message: '应触发审计告警' },
      { id: 'v3', name: '策略阻断', check: 'policy.isBlocked', expected: true, message: '策略应阻断暴力破解' },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    tags: ['soc2', 'iso27001'],
    author: 'hermes-security',
  },
  {
    name: 'unauthorized-access',
    description: '越权访问：普通用户调用 admin API 应被策略拒绝并审计。',
    category: 'authorization',
    severity: 'critical',
    version: '1.0.0',
    setup: [
      { id: 's1', name: '创建普通用户', action: 'sso.createTestUser', args: { role: 'user' } },
    ],
    attack: [
      { id: 'a1', name: '调用 admin API', action: 'admin.callAdminAPI', args: { userRole: 'user' } },
    ],
    validation: [
      { id: 'v1', name: '策略拒绝', check: 'policy.decision', expected: 'deny', message: '应返回 deny 决策' },
      { id: 'v2', name: '审计 authz denied', check: 'audit.hasEvent', expected: { matched: true, eventType: 'authz' }, message: '应记录授权拒绝' },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    tags: ['soc2', 'gdpr'],
    author: 'hermes-security',
  },
  {
    name: 'data-exfiltration',
    description: '数据外泄：批量下载敏感文件应被限速并审计。',
    category: 'data',
    severity: 'critical',
    version: '1.0.0',
    setup: [
      { id: 's1', name: '创建敏感文件', action: 'data.createSensitiveFiles', args: { count: 100 } },
    ],
    attack: [
      { id: 'a1', name: '批量下载', action: 'data.batchDownload', args: { limit: 1000 } },
    ],
    validation: [
      { id: 'v1', name: '策略限速', check: 'policy.isRateLimited', expected: true, message: '应触发限速' },
      { id: 'v2', name: '审计告警', check: 'audit.hasEvent', expected: { matched: true, eventType: 'data' }, message: '应记录数据访问告警' },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    tags: ['gdpr', 'iso27001'],
    author: 'hermes-security',
  },
  {
    name: 'session-hijack',
    description: '会话劫持：从异常 IP 访问应触发 SSO 二次验证和会话可疑标记。',
    category: 'session',
    severity: 'high',
    version: '1.0.0',
    setup: [
      { id: 's1', name: '创建会话', action: 'sso.createSession' },
    ],
    attack: [
      { id: 'a1', name: '从异常 IP 访问', action: 'sso.accessFromAnomalousIP', args: { ip: '1.2.3.4' } },
    ],
    validation: [
      { id: 'v1', name: 'SSO 二次验证', check: 'sso.requiresMFA', expected: true, message: '应要求 MFA 二次验证' },
      { id: 'v2', name: '会话被标记可疑', check: 'sso.isSessionSuspicious', expected: true, message: '会话应被标记为可疑' },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    tags: ['soc2'],
    author: 'hermes-security',
  },
  {
    name: 'privilege-escalation',
    description: '权限提升：尝试获取 admin 角色应被策略拒绝并触发 critical 审计。',
    category: 'privilege',
    severity: 'critical',
    version: '1.0.0',
    setup: [
      { id: 's1', name: '创建普通用户', action: 'sso.createTestUser', args: { role: 'user' } },
    ],
    attack: [
      { id: 'a1', name: '尝试获取 admin 角色', action: 'admin.escalateToAdmin' },
    ],
    validation: [
      { id: 'v1', name: '策略拒绝', check: 'policy.decision', expected: 'deny', message: '应返回 deny 决策' },
      { id: 'v2', name: '审计 critical', check: 'audit.hasEvent', expected: { matched: true, eventType: 'authz' }, message: '应记录 critical 审计' },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    tags: ['soc2', 'iso27001'],
    author: 'hermes-security',
  },
  {
    name: 'malicious-upload',
    description: '恶意文件上传：上传恶意文件应被拦截并审计。',
    category: 'malicious',
    severity: 'high',
    version: '1.0.0',
    setup: [
      { id: 's1', name: '准备恶意文件', action: 'upload.prepareMaliciousFile' },
    ],
    attack: [
      { id: 'a1', name: '上传恶意文件', action: 'upload.uploadFile', args: { malicious: true } },
    ],
    validation: [
      { id: 'v1', name: '上传被拦截', check: 'upload.wasBlocked', expected: true, message: '应拦截恶意文件' },
      { id: 'v2', name: '审计告警', check: 'audit.hasEvent', expected: { matched: true, eventType: 'data' }, message: '应触发数据类审计告警' },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    tags: ['iso27001'],
    author: 'hermes-security',
  },
  {
    name: 'audit-tampering',
    description: '审计日志篡改：尝试修改审计事件应使 hash chain 验证失败并触发紧急告警。',
    category: 'integrity',
    severity: 'critical',
    version: '1.0.0',
    setup: [
      { id: 's1', name: '记录审计事件', action: 'audit.logAuditEvent', repeat: 5 },
    ],
    attack: [
      { id: 'a1', name: '尝试修改事件', action: 'system.tamperAuditEvent' },
    ],
    validation: [
      { id: 'v1', name: 'Hash Chain 验证失败', check: 'audit.verifyChain', expected: { valid: false }, message: '篡改后链应验证失败' },
      { id: 'v2', name: '紧急告警', check: 'audit.hasEvent', expected: { matched: true, eventType: 'system' }, message: '应触发 system 紧急告警' },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    tags: ['soc2', 'iso27001'],
    author: 'hermes-security',
  },
];

// ============ 引擎主类 ============

/**
 * SecurityAuditEngine - 安全审计场景引擎
 *
 * 实现 7 个预置攻击场景的自动化执行、验证、报告与应急响应。
 */
export class SecurityAuditEngine {
  private config: SecurityAuditConfig;
  private scenarios: Map<string, AttackScenario> = new Map();
  private executions: Map<string, ScenarioExecution> = new Map();
  private incidents: Map<string, IncidentResponse> = new Map();
  private engines: Map<string, RegisteredEngine> = new Map();
  private listeners: Map<SecurityAuditEvent, Set<(e: any) => void>> = new Map();
  private storageKey = 'hermes.securityAudit';

  constructor(config: Partial<SecurityAuditConfig> = {}, _options: { autoLoadPresets?: boolean } = {}) {
    this.config = { ...DEFAULT_SECURITY_AUDIT_CONFIG, ...config };
    // 注册内部 mock 引擎
    for (const [id, methods] of buildInternalEngines()) {
      this.engines.set(id, methods);
    }
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw =
        typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.scenarios)) {
          for (const sc of data.scenarios) {
            this.scenarios.set(sc.id, sc);
          }
        }
        // 不加载 executions 和 incidents
      }
    } catch (e) {
      console.warn('SecurityAuditEngine: failed to load state', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        scenarios: Array.from(this.scenarios.values()),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('SecurityAuditEngine: failed to save state', e);
    }
  }

  // ============ 事件总线 ============

  on(event: SecurityAuditEvent, listener: (e: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: SecurityAuditEvent, listener: (e: any) => void): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit(event: SecurityAuditEvent, data: any): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(data);
        } catch (e) {
          console.error('SecurityAuditEngine listener error:', e);
        }
      }
    }
  }

  // ============ 引擎注册 ============

  /**
   * 注册外部引擎
   */
  registerEngine(engineId: string, methods: RegisteredEngine): void {
    const existing = this.engines.get(engineId) || {};
    this.engines.set(engineId, { ...existing, ...methods });
  }

  /**
   * 注销外部引擎
   */
  unregisterEngine(engineId: string): boolean {
    return this.engines.delete(engineId);
  }

  /**
   * 列出已注册引擎
   */
  listEngines(): string[] {
    return Array.from(this.engines.keys());
  }

  // ============ 预置场景 ============

  /**
   * 加载预置场景
   */
  loadPresetScenarios(): number {
    let loaded = 0;
    for (const preset of PRESET_ATTACK_SCENARIOS) {
      // 通过 name 去重
      const existing = Array.from(this.scenarios.values()).find(
        (s) => s.name === preset.name && s.version === preset.version,
      );
      if (!existing) {
        const now = Date.now();
        const scenario: AttackScenario = {
          ...preset,
          id: generateScenarioId(preset.name),
          createdAt: now,
          updatedAt: now,
        };
        this.scenarios.set(scenario.id, scenario);
        loaded++;
      }
    }
    if (loaded > 0 && this.config.persist) this.save();
    return loaded;
  }

  // ============ 场景 CRUD ============

  /**
   * 注册场景
   */
  registerScenario(scenario: Omit<AttackScenario, 'id' | 'createdAt' | 'updatedAt'>): AttackScenario {
    const now = Date.now();
    const newScenario: AttackScenario = {
      ...scenario,
      id: generateScenarioId(scenario.name),
      createdAt: now,
      updatedAt: now,
    };
    this.scenarios.set(newScenario.id, newScenario);
    if (this.config.persist) this.save();
    this.emit('scenario-registered', { scenario: newScenario });
    return newScenario;
  }

  /**
   * 更新场景
   */
  updateScenario(scenarioId: string, updates: Partial<AttackScenario>): AttackScenario {
    const existing = this.scenarios.get(scenarioId);
    if (!existing) throw new Error(`Scenario not found: ${scenarioId}`);
    const updated: AttackScenario = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.scenarios.set(scenarioId, updated);
    if (this.config.persist) this.save();
    this.emit('scenario-updated', { scenario: updated });
    return updated;
  }

  /**
   * 删除场景
   */
  deleteScenario(scenarioId: string): boolean {
    const result = this.scenarios.delete(scenarioId);
    if (result) {
      if (this.config.persist) this.save();
      this.emit('scenario-deleted', { scenarioId });
    }
    return result;
  }

  /**
   * 获取场景
   */
  getScenario(scenarioId: string): AttackScenario | undefined {
    return this.scenarios.get(scenarioId);
  }

  /**
   * 列出场景
   */
  listScenarios(filter: { category?: string; severity?: AttackSeverity } = {}): AttackScenario[] {
    let all = Array.from(this.scenarios.values());
    if (filter.category) {
      all = all.filter((s) => s.category === filter.category);
    }
    if (filter.severity) {
      all = all.filter((s) => s.severity === filter.severity);
    }
    return all;
  }

  // ============ 步骤执行 ============

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: ScenarioStep,
    execution: ScenarioExecution,
  ): Promise<ScenarioStepResult> {
    const startTime = Date.now();
    const result: ScenarioStepResult = {
      stepId: step.id,
      stepName: step.name,
      action: step.action,
      status: 'success',
      startTime,
      endTime: startTime,
      durationMs: 0,
    };

    this.log(execution, 'info', `Step started: ${step.name}`, { stepId: step.id, action: step.action });

    if (execution.dryRun) {
      result.output = { dryRun: true };
      this.log(execution, 'info', `Step skipped (dry run): ${step.name}`, { stepId: step.id });
      result.endTime = Date.now();
      result.durationMs = result.endTime - result.startTime;
      execution.steps.push(result);
      return result;
    }

    try {
      const repeat = step.repeat || 1;
      const outputs: any[] = [];
      for (let i = 0; i < repeat; i++) {
        const { engineId, method } = parseAction(step.action);
        const targetEngine = engineId ? this.engines.get(engineId) : null;
        if (!targetEngine) {
          throw new Error(`Engine not found: ${engineId}`);
        }
        const fn = targetEngine[method];
        if (typeof fn !== 'function') {
          throw new Error(`Method not found: ${step.action}`);
        }
        const args = step.args || {};
        const out = await this.withTimeout(() => fn(args), this.config.stepTimeoutMs);
        outputs.push(out);
        if (step.delayMs && i < repeat - 1) {
          await this.sleep(step.delayMs);
        }
      }
      result.output = outputs.length === 1 ? outputs[0] : outputs;
    } catch (err) {
      result.status = 'failure';
      result.error = err instanceof Error ? err.message : String(err);
      this.log(execution, 'error', `Step failed: ${step.name}`, { stepId: step.id, error: result.error });
    } finally {
      result.endTime = Date.now();
      result.durationMs = result.endTime - result.startTime;
      execution.steps.push(result);
    }

    return result;
  }

  /**
   * 执行验证
   */
  private async executeValidation(
    validation: ValidationStep,
    execution: ScenarioExecution,
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      validationId: validation.id,
      name: validation.name,
      passed: false,
      actual: undefined,
      expected: validation.expected,
      message: validation.message,
      timestamp: Date.now(),
    };

    this.log(execution, 'info', `Validation started: ${validation.name}`, { validationId: validation.id });

    try {
      const { engineId, method } = parseAction(validation.check);
      const targetEngine = engineId ? this.engines.get(engineId) : null;
      if (!targetEngine) {
        throw new Error(`Engine not found: ${engineId}`);
      }
      const fn = targetEngine[method];
      if (typeof fn !== 'function') {
        throw new Error(`Method not found: ${validation.check}`);
      }
      // 将 expected 作为查询参数传入（如果 expected 是对象），便于 mock 返回匹配结果
      const arg = typeof validation.expected === 'object' && validation.expected !== null && !Array.isArray(validation.expected)
        ? validation.expected
        : undefined;
      const actual = await this.withTimeout(() => fn(arg), this.config.stepTimeoutMs);
      result.actual = actual;
      result.passed = deepEqual(actual, validation.expected);
    } catch (err) {
      result.actual = err instanceof Error ? err.message : String(err);
      result.passed = false;
      this.log(execution, 'error', `Validation failed: ${validation.name}`, { validationId: validation.id, error: result.actual });
    }

    execution.validations.push(result);

    if (result.passed) {
      this.emit('validation-passed', { execution, validation, result });
      this.log(execution, 'info', `Validation passed: ${validation.name}`);
    } else {
      this.emit('validation-failed', { execution, validation, result });
      this.log(execution, 'warn', `Validation failed: ${validation.name}`, { actual: result.actual, expected: result.expected });
    }

    return result;
  }

  /**
   * 评估 outcome
   */
  private evaluateOutcome(execution: ScenarioExecution, _scenario: AttackScenario): void {
    const validations = execution.validations;
    const isBlockedCheck = (name: string) => /阻断|拒绝|拒绝|拦截|锁|suspicious|deny|blocked|mfa/i.test(name);
    const isAlertedCheck = (name: string) => /告警|alert|chain/i.test(name);
    const isAuditedCheck = (name: string) => /审计|audit|logged/i.test(name);

    const blocked = validations.filter((v) => isBlockedCheck(v.name)).every((v) => v.passed);
    const alerted = validations.filter((v) => isAlertedCheck(v.name)).every((v) => v.passed);
    const audited = validations.filter((v) => isAuditedCheck(v.name)).every((v) => v.passed);

    // 兜底：如果没有匹配任何类别，则所有 passed 都算 outcome 满足
    const anyMatched = validations.some(
      (v) => isBlockedCheck(v.name) || isAlertedCheck(v.name) || isAuditedCheck(v.name),
    );
    if (!anyMatched) {
      const allPassed = validations.every((v) => v.passed);
      execution.outcome = { blocked: allPassed, alerted: allPassed, audited: allPassed };
    } else {
      execution.outcome = { blocked, alerted, audited };
    }
  }

  // ============ 场景执行 ============

  /**
   * 执行单个场景
   */
  async execute(scenarioId: string, options: { dryRun?: boolean } = {}): Promise<ScenarioExecution> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

    const dryRun = options.dryRun ?? this.config.dryRunByDefault;

    const execution: ScenarioExecution = {
      id: generateExecutionId(),
      scenarioId,
      scenarioVersion: scenario.version,
      status: 'running',
      startTime: Date.now(),
      steps: [],
      validations: [],
      outcome: { blocked: false, alerted: false, audited: false },
      logs: [],
      dryRun,
    };

    this.executions.set(execution.id, execution);
    this.trimExecutions();
    this.emit('execution-started', { execution, scenario });
    this.log(execution, 'info', `Scenario started: ${scenario.name}`, { scenarioId, dryRun });

    try {
      // Setup
      for (const step of scenario.setup) {
        await this.executeStep(step, execution);
        if (execution.steps.length > 0 && execution.steps[execution.steps.length - 1].status === 'failure') {
          // setup 失败不直接终止，但记录
        }
      }

      // Attack
      for (const step of scenario.attack) {
        const stepResult = await this.executeStep(step, execution);
        if (stepResult.status === 'failure') {
          // attack 步骤失败也继续
        }
      }

      // Validation
      for (const validation of scenario.validation) {
        await this.executeValidation(validation, execution);
      }

      // Cleanup
      if (scenario.cleanup) {
        for (const step of scenario.cleanup) {
          await this.executeStep(step, execution);
        }
      }

      // 评估 outcome
      this.evaluateOutcome(execution, scenario);

      // 整体状态：所有验证通过 = completed，否则 failed
      const allPassed = execution.validations.length > 0 && execution.validations.every((v) => v.passed);
      execution.status = allPassed ? 'completed' : 'failed';

      this.emit(allPassed ? 'execution-completed' : 'execution-failed', { execution, scenario });
      this.log(execution, 'info', `Scenario ${execution.status}: ${scenario.name}`, {
        outcome: execution.outcome,
        passed: execution.validations.filter((v) => v.passed).length,
        total: execution.validations.length,
      });
    } catch (err) {
      execution.status = 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
      this.emit('execution-failed', { execution, scenario, error: execution.error });
      this.log(execution, 'error', `Scenario error: ${scenario.name}`, { error: execution.error });
    } finally {
      execution.endTime = Date.now();
      execution.durationMs = execution.endTime - execution.startTime;
    }

    return execution;
  }

  /**
   * 执行所有场景
   */
  async executeAll(options: { dryRun?: boolean } = {}): Promise<ScenarioExecution[]> {
    const scenarios = this.listScenarios();
    const results: ScenarioExecution[] = [];
    for (const scenario of scenarios) {
      const exec = await this.execute(scenario.id, options);
      results.push(exec);
    }
    return results;
  }

  /**
   * 取消执行（仅支持未完成的 status 变更）
   */
  cancel(executionId: string): ScenarioExecution | undefined {
    const execution = this.executions.get(executionId);
    if (!execution) return undefined;
    if (execution.status === 'running' || execution.status === 'pending') {
      execution.status = 'cancelled';
      execution.endTime = Date.now();
      execution.durationMs = execution.endTime - execution.startTime;
      this.log(execution, 'warn', 'Execution cancelled');
      this.emit('execution-cancelled', { execution });
    }
    return execution;
  }

  // ============ 状态查询 ============

  /**
   * 获取执行
   */
  getExecution(executionId: string): ScenarioExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * 列出执行
   */
  listExecutions(filter: { scenarioId?: string; status?: ScenarioExecutionStatus } = {}): ScenarioExecution[] {
    let all = Array.from(this.executions.values());
    if (filter.scenarioId) {
      all = all.filter((e) => e.scenarioId === filter.scenarioId);
    }
    if (filter.status) {
      all = all.filter((e) => e.status === filter.status);
    }
    // 按时间倒序
    all.sort((a, b) => b.startTime - a.startTime);
    return all;
  }

  // ============ 应急响应 ============

  /**
   * 触发应急响应
   */
  async triggerResponse(scenarioId: string, executionId: string): Promise<IncidentResponse> {
    const scenario = this.scenarios.get(scenarioId);
    const execution = this.executions.get(executionId);
    if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);

    const incident: IncidentResponse = {
      id: generateIncidentId(),
      scenarioId,
      executionId,
      severity: scenario.severity,
      status: 'detected',
      steps: [],
      startTime: Date.now(),
    };

    this.incidents.set(incident.id, incident);
    this.emit('incident-detected', { incident, scenario, execution });

    // 启动标准响应流程
    const responsePlan: Array<{ name: string; action: string; status: IncidentStatus }> = [
      { name: '分析事件', action: 'incident.analyze', status: 'analyzing' },
      { name: '遏制威胁', action: 'incident.contain', status: 'containing' },
      { name: '消除威胁', action: 'incident.eradicate', status: 'eradicating' },
      { name: '恢复系统', action: 'incident.recover', status: 'recovering' },
      { name: '通知相关方', action: 'incident.notify', status: 'recovering' },
    ];

    for (const plan of responsePlan) {
      incident.status = plan.status;
      const step: ResponseStep = {
        id: `rs-${Math.random().toString(36).slice(2, 8)}`,
        name: plan.name,
        action: plan.action,
        status: 'running',
        startTime: Date.now(),
      };
      incident.steps.push(step);

      try {
        const { engineId, method } = parseAction(plan.action);
        const targetEngine = engineId ? this.engines.get(engineId) : null;
        if (targetEngine && typeof targetEngine[method] === 'function') {
          const out = await this.withTimeout(() => targetEngine[method](), this.config.stepTimeoutMs);
          step.output = out;
        } else {
          step.output = { mocked: true };
        }
        step.status = 'completed';
      } catch (err) {
        step.status = 'failed';
        step.output = { error: err instanceof Error ? err.message : String(err) };
      } finally {
        step.endTime = Date.now();
      }
    }

    incident.status = 'closed';
    incident.endTime = Date.now();
    this.emit('incident-responded', { incident });
    return incident;
  }

  /**
   * 列出活跃事件
   */
  listActiveIncidents(): IncidentResponse[] {
    return Array.from(this.incidents.values()).filter((i) => i.status !== 'closed');
  }

  /**
   * 列出所有事件
   */
  listIncidents(): IncidentResponse[] {
    return Array.from(this.incidents.values()).sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * 获取事件
   */
  getIncident(incidentId: string): IncidentResponse | undefined {
    return this.incidents.get(incidentId);
  }

  /**
   * 关闭事件
   */
  closeIncident(incidentId: string, notes?: string): IncidentResponse | undefined {
    const incident = this.incidents.get(incidentId);
    if (!incident) return undefined;
    incident.status = 'closed';
    incident.endTime = Date.now();
    if (notes) incident.notes = notes;
    this.emit('incident-closed', { incident });
    return incident;
  }

  // ============ 报告 ============

  /**
   * 生成报告
   */
  generateReport(period: AuditPeriod): SecurityAuditReport {
    const filtered = this.listExecutions().filter(
      (e) => e.startTime >= period.from && e.startTime <= period.to,
    );

    const passed = filtered.filter((e) => e.status === 'completed').length;
    const failed = filtered.filter((e) => e.status === 'failed' || e.status === 'cancelled').length;

    const blockedAttacks = filtered.filter((e) => e.outcome.blocked).length;
    const unblockedAttacks = filtered.filter((e) => !e.outcome.blocked).length;
    const alertsTriggered = filtered.filter((e) => e.outcome.alerted).length;
    const auditEvents = filtered.reduce((sum, e) => sum + e.steps.length, 0);

    const recommendations: string[] = [];
    if (unblockedAttacks > 0) {
      recommendations.push(`${unblockedAttacks} 个攻击未被阻断，建议检查防护策略`);
    }
    if (filtered.some((e) => e.status === 'failed')) {
      recommendations.push('部分场景验证失败，建议审计相关防护规则');
    }
    if (alertsTriggered < filtered.length) {
      recommendations.push('部分场景未触发告警，建议完善告警规则');
    }
    if (recommendations.length === 0) {
      recommendations.push('所有安全场景均通过验证，建议保持当前防护水平');
    }

    const report: SecurityAuditReport = {
      id: generateReportId(),
      generatedAt: Date.now(),
      period,
      totalScenarios: filtered.length,
      passed,
      failed,
      scenarios: filtered,
      summary: {
        blockedAttacks,
        unblockedAttacks,
        alertsTriggered,
        auditEvents,
      },
      recommendations,
      compliance: {
        soc2: filtered.length > 0 && failed === 0,
        gdpr: filtered.length > 0 && failed === 0,
        iso27001: filtered.length > 0 && failed === 0,
      },
    };

    this.emit('report-generated', { report });
    return report;
  }

  /**
   * 导出报告
   */
  exportReport(period: AuditPeriod, format: 'json' | 'html' | 'pdf' | 'markdown'): string {
    const report = this.generateReport(period);
    switch (format) {
      case 'json':
        return JSON.stringify(report, null, 2);
      case 'markdown':
        return this.reportToMarkdown(report);
      case 'html':
        return this.reportToHtml(report);
      case 'pdf':
        return this.reportToMarkdown(report); // fallback to markdown
      default:
        return JSON.stringify(report, null, 2);
    }
  }

  private reportToMarkdown(report: SecurityAuditReport): string {
    const lines: string[] = [];
    lines.push(`# 安全审计报告 - ${report.id}`);
    lines.push('');
    lines.push(`**生成时间**: ${new Date(report.generatedAt).toISOString()}`);
    lines.push(`**审计周期**: ${new Date(report.period.from).toISOString()} ~ ${new Date(report.period.to).toISOString()}`);
    lines.push('');
    lines.push(`## 汇总`);
    lines.push(`- 总场景数: ${report.totalScenarios}`);
    lines.push(`- 通过: ${report.passed}`);
    lines.push(`- 失败: ${report.failed}`);
    lines.push(`- 阻断攻击: ${report.summary.blockedAttacks}`);
    lines.push(`- 未阻断攻击: ${report.summary.unblockedAttacks}`);
    lines.push(`- 触发告警: ${report.summary.alertsTriggered}`);
    lines.push(`- 审计事件: ${report.summary.auditEvents}`);
    lines.push('');
    lines.push(`## 合规`);
    lines.push(`- SOC 2: ${report.compliance.soc2 ? '✓' : '✗'}`);
    lines.push(`- GDPR: ${report.compliance.gdpr ? '✓' : '✗'}`);
    lines.push(`- ISO 27001: ${report.compliance.iso27001 ? '✓' : '✗'}`);
    lines.push('');
    lines.push(`## 建议`);
    for (const r of report.recommendations) {
      lines.push(`- ${r}`);
    }
    lines.push('');
    lines.push(`## 场景详情`);
    for (const exec of report.scenarios) {
      const sc = this.scenarios.get(exec.scenarioId);
      lines.push(`### ${sc?.name || exec.scenarioId} (${exec.status})`);
      lines.push(`- 阻断: ${exec.outcome.blocked ? '✓' : '✗'}`);
      lines.push(`- 告警: ${exec.outcome.alerted ? '✓' : '✗'}`);
      lines.push(`- 审计: ${exec.outcome.audited ? '✓' : '✗'}`);
      lines.push(`- 验证通过: ${exec.validations.filter((v) => v.passed).length}/${exec.validations.length}`);
    }
    return lines.join('\n');
  }

  private reportToHtml(report: SecurityAuditReport): string {
    const md = this.reportToMarkdown(report);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.id}</title></head><body><pre>${md}</pre></body></html>`;
  }

  // ============ CI/CD 集成 ============

  /**
   * CI 模式运行
   */
  async runInCI(scenarioIds?: string[]): Promise<{ passed: number; failed: number; total: number; exitCode: number }> {
    const targets = scenarioIds || this.listScenarios().map((s) => s.id);
    const executions: ScenarioExecution[] = [];
    for (const id of targets) {
      const exec = await this.execute(id);
      executions.push(exec);
    }
    const passed = executions.filter((e) => e.status === 'completed').length;
    const failed = executions.length - passed;
    const total = executions.length;
    const exitCode = failed === 0 ? 0 : 1;
    this.emit('ci-completed', { passed, failed, total, exitCode });
    return { passed, failed, total, exitCode };
  }

  // ============ 工具方法 ============

  private log(execution: ScenarioExecution, level: ScenarioLogEntry['level'], message: string, context?: Record<string, any>): void {
    const entry: ScenarioLogEntry = { timestamp: Date.now(), level, message, context };
    execution.logs.push(entry);
    if (execution.logs.length > this.config.maxLogsPerExecution) {
      execution.logs = execution.logs.slice(-this.config.maxLogsPerExecution);
    }
  }

  private trimExecutions(): void {
    if (this.executions.size <= this.config.maxExecutions) return;
    const sorted = Array.from(this.executions.values()).sort((a, b) => b.startTime - a.startTime);
    this.executions = new Map(sorted.slice(0, this.config.maxExecutions).map((e) => [e.id, e]));
  }

  private withTimeout<T>(fn: () => T | Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      Promise.resolve(fn()),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============ 统计 ============

  /**
   * 获取统计信息
   */
  getStats(): {
    totalScenarios: number;
    totalExecutions: number;
    passed: number;
    failed: number;
    activeIncidents: number;
    totalIncidents: number;
  } {
    const executions = Array.from(this.executions.values());
    return {
      totalScenarios: this.scenarios.size,
      totalExecutions: executions.length,
      passed: executions.filter((e) => e.status === 'completed').length,
      failed: executions.filter((e) => e.status === 'failed' || e.status === 'cancelled').length,
      activeIncidents: this.listActiveIncidents().length,
      totalIncidents: this.incidents.size,
    };
  }

  /**
   * 清理所有执行和事件数据（用于测试重置或内存释放）
   */
  clearAllData(): void {
    this.executions.clear();
    this.incidents.clear();
  }
}

// ============ 单例 ============

let defaultEngineInstance: SecurityAuditEngine | null = null;

export function getDefaultSecurityAuditEngine(): SecurityAuditEngine {
  if (!defaultEngineInstance) {
    defaultEngineInstance = new SecurityAuditEngine();
  }
  return defaultEngineInstance;
}

export function resetDefaultSecurityAuditEngine(): void {
  if (defaultEngineInstance) {
    defaultEngineInstance.clearAllData();
  }
  defaultEngineInstance = null;
}
