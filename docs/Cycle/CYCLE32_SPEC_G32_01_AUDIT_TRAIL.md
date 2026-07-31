# G32-01 SPEC: Audit Trail Engine 审计追踪引擎

**任务编号**：G32-01
**版本**：v6.89.0
**优先级**：P0
**日期**：2026-07-30
**状态**：🟡 设计阶段
**依赖**：无
**被依赖**：G32-02, G32-03, 未来所有引擎

---

## 一、目标

实现企业级**不可篡改审计追踪引擎**，覆盖所有 Hermes 子系统的事件记录与合规报告生成能力，满足 SOC 2 / ISO 27001 / GDPR / EU AI Act 四大合规标准。

---

## 二、设计原则

1. **不可篡改（Tamper-Evident）**：HMAC-SHA256 hash chain，任何修改可检测
2. **结构化（Structured）**：所有事件符合统一 schema，便于 SIEM 接入
3. **完整（Complete）**：覆盖 6 大事件类型（auth / authz / data / admin / system / agent）
4. **隔离（Isolated）**：审计 schema 独立于业务，权限分离
5. **可保留（Retained）**：默认 7 年，符合 EU AI Act 6 个月最低要求
6. **可查询（Queryable）**：多维度过滤、聚合、导出
7. **可验证（Verifiable）**：支持 hash chain 完整性验证

---

## 三、核心类型定义

### 3.1 AuditEvent

```typescript
export type AuditEventType =
  | 'auth'           // 认证事件（登录/登出/MFA）
  | 'authz'          // 授权事件（allow/deny/prompt）
  | 'data'           // 数据访问（读/写/删除/导出）
  | 'admin'          // 管理操作（配置变更/用户管理）
  | 'system'         // 系统事件（启动/停止/错误）
  | 'agent'          // Agent 行为（LLM调用/工具调用/决策）
  | 'compliance';    // 合规事件（GDPR请求/审计访问）

export type AuditOutcome = 'success' | 'failure' | 'denied' | 'pending';

export type ActorType = 'user' | 'service' | 'agent' | 'system' | 'anonymous';

export interface AuditActor {
  id: string;                    // 内部 ID
  type: ActorType;
  name?: string;                 // 伪名化后
  email?: string;                // 伪名化后（hash）
  ssoId?: string;                // SSO 标识
  ip?: string;                   // 最后一段置零
  userAgent?: string;
  sessionId?: string;
  roles?: string[];
}

export interface AuditResource {
  type: string;                  // e.g. "agent", "worktree", "policy"
  id: string;
  name?: string;
  path?: string;
  attributes?: Record<string, any>;  // PII 已 pseudonymize
}

export interface AuditMetadata {
  before?: any;                  // 变更前值
  after?: any;                   // 变更后值
  reason?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  tags?: Record<string, string>;
}

export interface AuditEvent {
  // 标识
  id: string;                    // aud-<timestamp>-<random>
  schemaVersion: string;         // "1.0"
  sequenceNumber: number;        // 序列号（单链内单调递增）

  // 时间
  timestamp: number;             // ms epoch
  timezone: string;              // "UTC"

  // 上下文（5W1H）
  who: AuditActor;               // 谁
  what: string;                  // 做了什么（dot-namespaced action）
  why?: string;                  // 为什么
  when: number;                  // 何时
  where: {                       // 在哪
    ip?: string;
    location?: string;
    service?: string;
    component?: string;
  };
  how: AuditMetadata;            // 怎么做

  // 资源
  resource: AuditResource;

  // 结果
  outcome: AuditOutcome;
  outcomeMessage?: string;
  errorCode?: string;
  errorStack?: string;

  // 分类
  eventType: AuditEventType;
  severity: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  category?: string[];           // e.g. ["llm-call", "cost-attribution"]

  // 合规
  gdprRelevant: boolean;         // 是否涉及 PII
  complianceFlags?: string[];    // ["soc2-cc6.1", "iso-27001-a.12.4"]

  // 关联
  correlationId?: string;        // 跨事件追踪
  causationId?: string;          // 父事件 ID
  parentActor?: AuditActor;      // 委托代理

  // 完整性与不可篡改
  prevHash: string;              // hex SHA-256
  hash: string;                  // hex SHA-256
  signature?: string;            // HMAC-SHA256(secret, hash)
}
```

### 3.2 AuditChain

```typescript
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
  secretKey?: string;            // HMAC 密钥（可选）
  genesisHash: string;           // 创世 hash
  length: number;                // 当前长度
  createdAt: number;
  lastEventAt?: number;
}
```

### 3.3 ComplianceReport

```typescript
export interface ComplianceReport {
  id: string;
  standard: 'SOC2' | 'ISO27001' | 'GDPR' | 'EUAIAct';
  period: { from: number; to: number };
  generatedAt: number;
  totalEvents: number;
  byEventType: Record<AuditEventType, number>;
  byOutcome: Record<AuditOutcome, number>;
  byActor: Record<string, number>;
  byResourceType: Record<string, number>;
  sections: ComplianceSection[];
  integrityVerified: boolean;
  integrityCheck: ChainVerificationResult;
  metadata?: Record<string, any>;
}

export interface ComplianceSection {
  title: string;
  description: string;
  controlIds: string[];          // e.g. "CC6.1", "A.12.4.1"
  events: AuditEvent[];
  summary: {
    total: number;
    success: number;
    failure: number;
    denied: number;
  };
}

export interface ChainVerificationResult {
  valid: boolean;
  chainId: string;
  checkedAt: number;
  totalChecked: number;
  firstInvalidIndex?: number;
  errors?: string[];
}
```

---

## 四、核心 API

### 4.1 引擎主类

```typescript
export class AuditTrailEngine {
  // 初始化
  constructor(config: Partial<AuditEngineConfig>);

  // 记录事件
  log(event: Omit<AuditEvent, 'id' | 'sequenceNumber' | 'timestamp' | 'prevHash' | 'hash' | 'schemaVersion'>): AuditEvent;
  logAuth(input: AuthEventInput): AuditEvent;
  logAuthz(input: AuthzEventInput): AuditEvent;
  logData(input: DataEventInput): AuditEvent;
  logAdmin(input: AdminEventInput): AuditEvent;
  logSystem(input: SystemEventInput): AuditEvent;
  logAgent(input: AgentEventInput): AuditEvent;
  logCompliance(input: ComplianceEventInput): AuditEvent;

  // 便捷方法
  login(actor: AuditActor, success: boolean, metadata?: AuditMetadata): AuditEvent;
  logout(actor: AuditActor, metadata?: AuditMetadata): AuditEvent;
  access(actor: AuditActor, resource: AuditResource, action: string, outcome: AuditOutcome): AuditEvent;
  decision(actor: AuditActor, decision: { policy: string; rule: string; effect: string; reason: string }): AuditEvent;

  // 查询
  query(filter: AuditFilter): AuditEvent[];
  getById(id: string): AuditEvent | undefined;
  getByCorrelationId(correlationId: string): AuditEvent[];
  getByActor(actorId: string, period?: Period): AuditEvent[];
  getByResource(resourceType: string, resourceId: string, period?: Period): AuditEvent[];

  // 完整性验证
  verifyChain(chainId?: string): ChainVerificationResult;
  verifyEvent(eventId: string): { valid: boolean; reason?: string };

  // 合规报告
  generateSOC2Report(period: Period, orgId?: string): ComplianceReport;
  generateISO27001Report(period: Period, orgId?: string): ComplianceReport;
  generateGDPRReport(period: Period, orgId?: string): ComplianceReport;
  generateEUAIActReport(period: Period, orgId?: string): ComplianceReport;

  // 导出
  exportJSON(filter: AuditFilter): string;
  exportCSV(filter: AuditFilter): string;
  exportCEF(filter: AuditFilter): string;       // Common Event Format (SIEM)
  exportLEEF(filter: AuditFilter): string;      // Log Event Extended Format

  // 保留管理
  applyRetentionPolicy(): { archived: number; deleted: number };
  archive(olderThan: number): number;
  delete(olderThan: number): number;            // 强删（需 admin 权限）

  // 订阅
  on(event: AuditEngineEventType, listener: (e: AuditEngineEvent) => void): () => void;

  // 配置
  getConfig(): AuditEngineConfig;
  updateConfig(config: Partial<AuditEngineConfig>): void;

  // GDPR
  anonymizeActor(actorId: string): number;
  exportActorData(actorId: string): AuditEvent[];
  deleteActorData(actorId: string): number;
}
```

### 4.2 配置

```typescript
export interface AuditEngineConfig {
  baseCurrency: 'USD' | 'CNY' | 'EUR';
  storageBackend: 'localStorage' | 'indexedDB' | 'memory';
  retentionDays: number;             // 默认 2555 = 7 年
  enableSigning: boolean;            // HMAC 签名
  secretKey?: string;                // HMAC 密钥
  enablePIIPseudonymization: boolean;
  piiFields: string[];               // ['email', 'ip', 'phone']
  maxEvents: number;                 // 默认 1,000,000
  enableAutoArchive: boolean;
  archiveAfterDays: number;          // 默认 365
  enableIntegrityCheck: boolean;     // 写入时自动验证
  complianceStandards: ('SOC2' | 'ISO27001' | 'GDPR' | 'EUAIAct')[];
  maxStackTraceLines: number;        // 默认 10
  enableEncryption: boolean;         // AES-256 加密敏感字段
  encryptionKey?: string;
  storageQuotaWarningThreshold: number; // 默认 0.8
}

export const DEFAULT_AUDIT_CONFIG: AuditEngineConfig = {
  baseCurrency: 'USD',
  storageBackend: 'indexedDB',
  retentionDays: 2555,
  enableSigning: true,
  enablePIIPseudonymization: true,
  piiFields: ['email', 'phone', 'ssn', 'ip'],
  maxEvents: 1_000_000,
  enableAutoArchive: true,
  archiveAfterDays: 365,
  enableIntegrityCheck: true,
  complianceStandards: ['SOC2', 'ISO27001', 'GDPR', 'EUAIAct'],
  maxStackTraceLines: 10,
  enableEncryption: false,
  storageQuotaWarningThreshold: 0.8,
};
```

---

## 五、核心算法

### 5.1 Hash Chain 计算

```typescript
function computeHash(event: Omit<AuditEvent, 'hash'>, prevHash: string, secretKey?: string): string {
  // 1. 序列化（稳定排序）
  const canonical = canonicalJSON({
    id: event.id,
    sequenceNumber: event.sequenceNumber,
    timestamp: event.timestamp,
    schemaVersion: event.schemaVersion,
    who: event.who,
    what: event.what,
    resource: event.resource,
    outcome: event.outcome,
    eventType: event.eventType,
    severity: event.severity,
    prevHash,
    correlationId: event.correlationId,
    causationId: event.causationId,
  });

  // 2. HMAC-SHA256（启用签名）或 SHA-256
  if (secretKey) {
    return hmacSHA256(canonical, secretKey);
  } else {
    return sha256(canonical);
  }
}
```

### 5.2 PII Pseudonymization

```typescript
function pseudonymize(value: string, type: 'email' | 'phone' | 'ip' | 'name'): string {
  if (!value) return value;

  switch (type) {
    case 'email':
      // alice@example.com → email_<hash8>@anon.local
      const emailHash = sha256(value).slice(0, 8);
      return `email_${emailHash}@anon.local`;

    case 'phone':
      // +1-555-123-4567 → phone_<hash8>
      const phoneHash = sha256(value).slice(0, 8);
      return `phone_${phoneHash}`;

    case 'ip':
      // 192.168.1.100 → 192.168.1.0
      const parts = value.split('.');
      if (parts.length === 4) {
        parts[3] = '0';
        return parts.join('.');
      }
      // IPv6: 2001:db8::1234 → 2001:db8::
      return value.split(':').slice(0, 3).join(':') + '::';

    case 'name':
      // John Doe → J*** D**
      return value.split(' ').map(p => p[0] + '***').join(' ');

    default:
      return value;
  }
}
```

### 5.3 Chain Verification

```typescript
function verifyChain(chain: AuditChain, events: AuditEvent[], secretKey?: string): ChainVerificationResult {
  let prevHash = chain.genesisHash;
  let sequence = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // 1. 检查 sequence
    if (event.sequenceNumber !== sequence) {
      return {
        valid: false,
        chainId: chain.id,
        checkedAt: Date.now(),
        totalChecked: i,
        firstInvalidIndex: i,
        errors: [`Sequence number mismatch at index ${i}: expected ${sequence}, got ${event.sequenceNumber}`],
      };
    }

    // 2. 检查 prevHash
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

    // 3. 重新计算 hash 并对比
    const { hash: _hash, ...eventWithoutHash } = event;
    const recomputed = computeHash(eventWithoutHash, prevHash, secretKey);
    if (recomputed !== event.hash) {
      return {
        valid: false,
        chainId: chain.id,
        checkedAt: Date.now(),
        totalChecked: i,
        firstInvalidIndex: i,
        errors: [`Hash mismatch at index ${i}: expected ${event.hash}, got ${recomputed}`],
      };
    }

    prevHash = event.hash;
    sequence++;
  }

  return {
    valid: true,
    chainId: chain.id,
    checkedAt: Date.now(),
    totalChecked: events.length,
  };
}
```

---

## 六、合规报告模板

### 6.1 SOC 2 Type II

```typescript
const SOC2_CONTROLS = [
  { id: 'CC1.1', title: 'COSO Principle 1', events: ['admin', 'system'] },
  { id: 'CC6.1', title: 'Logical Access Controls', events: ['auth', 'authz'] },
  { id: 'CC6.2', title: 'Privileged Access', events: ['auth', 'authz', 'admin'] },
  { id: 'CC6.6', title: 'External Access', events: ['auth'] },
  { id: 'CC7.2', title: 'System Monitoring', events: ['system', 'data'] },
  { id: 'CC7.3', title: 'Anomaly Detection', events: ['system', 'authz'] },
  { id: 'CC8.1', title: 'Change Management', events: ['admin', 'data'] },
  { id: 'A1.2', title: 'System Availability', events: ['system'] },
];
```

### 6.2 GDPR

```typescript
const GDPR_ARTICLES = [
  { id: 'Art.5', title: 'Principles of Processing', events: ['data', 'compliance'] },
  { id: 'Art.15', title: 'Right of Access', events: ['compliance'] },
  { id: 'Art.17', title: 'Right to Erasure', events: ['compliance'] },
  { id: 'Art.20', title: 'Data Portability', events: ['data', 'compliance'] },
  { id: 'Art.25', title: 'Data Protection by Design', events: ['admin', 'compliance'] },
  { id: 'Art.30', title: 'Records of Processing', events: ['data'] },
  { id: 'Art.32', title: 'Security of Processing', events: ['auth', 'authz', 'system'] },
  { id: 'Art.33', title: 'Breach Notification', events: ['system', 'compliance'] },
];
```

### 6.3 ISO 27001

```typescript
const ISO27001_CONTROLS = [
  { id: 'A.5.10', title: 'Acceptable Use', events: ['authz', 'data'] },
  { id: 'A.5.15', title: 'Access Control', events: ['auth', 'authz'] },
  { id: 'A.5.16', title: 'Identity Management', events: ['auth', 'admin'] },
  { id: 'A.5.17', title: 'Authentication Information', events: ['auth'] },
  { id: 'A.5.34', title: 'Privacy of PII', events: ['data', 'compliance'] },
  { id: 'A.8.2', title: 'Privileged Access Rights', events: ['authz', 'admin'] },
  { id: 'A.8.3', title: 'Information Access Restriction', events: ['authz', 'data'] },
  { id: 'A.8.5', title: 'Secure Authentication', events: ['auth'] },
  { id: 'A.8.15', title: 'Logging', events: ['*'] },
  { id: 'A.8.16', title: 'Monitoring Activities', events: ['system'] },
  { id: 'A.12.4', title: 'Logging and Monitoring', events: ['*'] },
  { id: 'A.13.1', title: 'Network Security', events: ['system'] },
];
```

### 6.4 EU AI Act

```typescript
const EU_AI_ACT_ARTICLES = [
  { id: 'Art.9', title: 'Risk Management System', events: ['agent', 'authz'] },
  { id: 'Art.10', title: 'Data Governance', events: ['data'] },
  { id: 'Art.11', title: 'Technical Documentation', events: ['admin'] },
  { id: 'Art.12', title: 'Record-Keeping', events: ['*'] },         // 核心
  { id: 'Art.13', title: 'Transparency to Deployers', events: ['agent'] },
  { id: 'Art.14', title: 'Human Oversight', events: ['authz', 'admin'] },
  { id: 'Art.15', title: 'Accuracy, Robustness, Cybersecurity', events: ['system', 'agent'] },
  { id: 'Art.17', title: 'Quality Management System', events: ['admin'] },
];
```

---

## 七、存储后端

### 7.1 存储适配器

```typescript
export interface AuditStorageAdapter {
  init(): Promise<void>;
  save(event: AuditEvent): Promise<void>;
  saveBatch(events: AuditEvent[]): Promise<void>;
  load(filter: AuditFilter): Promise<AuditEvent[]>;
  loadById(id: string): Promise<AuditEvent | null>;
  loadByHash(hash: string): Promise<AuditEvent | null>;
  count(filter: AuditFilter): Promise<number>;
  deleteOlderThan(timestamp: number): Promise<number>;
  archiveOlderThan(timestamp: number): Promise<number>;
  getStorageSize(): Promise<number>;
  clear(): Promise<void>;
}

export class LocalStorageAuditAdapter implements AuditStorageAdapter { ... }
export class IndexedDBAuditAdapter implements AuditStorageAdapter { ... }
export class InMemoryAuditAdapter implements AuditStorageAdapter { ... }
```

### 7.2 配额管理

- 默认 IndexedDB 配额：50MB - 1GB（浏览器）
- 达到 80% 触发警告事件
- 达到 95% 触发自动归档（> 365 天的归档）
- 达到 100% 拒绝写入（需先归档或清理）

---

## 八、测试策略

### 8.1 单元测试（35+ 个）

| 测试类别 | 数量 | 覆盖点 |
|---------|------|-------|
| **基础记录** | 6 | log / logAuth / logAuthz / logData / logAdmin / logAgent |
| **便捷方法** | 4 | login / logout / access / decision |
| **Hash Chain** | 5 | 正常 hash / 修改检测 / 插入检测 / 删除检测 / 重排检测 |
| **PII 脱敏** | 4 | email / phone / IP / name |
| **查询过滤** | 4 | byId / byCorrelationId / byActor / byResource |
| **合规报告** | 4 | SOC 2 / ISO 27001 / GDPR / EU AI Act |
| **导出格式** | 3 | JSON / CSV / CEF |
| **保留策略** | 2 | 归档 / 删除 |
| **GDPR 操作** | 3 | anonymize / export / delete |
| **存储后端** | 2 | IndexedDB / InMemory |
| **并发** | 1 | 多个 log 并发 |
| **错误处理** | 2 | 存储满 / 配置错误 |

### 8.2 E2E 测试

- **主流程**：login → access resource → decision → logout → 验证 audit log
- **合规报告生成**：触发 100+ 事件 → 生成 SOC 2 报告 → 验证完整性
- **GDPR 流程**：用户请求数据访问 → 导出 → 验证

---

## 九、集成方案

### 9.1 与现有引擎集成

```typescript
// 1. 成本归因
costAttributionEngine.on('attribution-recorded', (e) => {
  auditTrail.logAgent({
    who: { id: e.record.user.userId, type: 'user' },
    what: 'cost.attribute',
    resource: { type: 'attribution', id: e.record.id },
    outcome: 'success',
    metadata: { cost: e.record.totalCost, model: e.record.model },
    eventType: 'agent',
    severity: 'info',
  });
});

// 2. 智能审批
smartApprovalEngine.on('decision-made', (e) => {
  auditTrail.logAuthz({
    who: e.actor,
    what: e.action,
    resource: e.resource,
    outcome: e.allowed ? 'success' : 'denied',
    metadata: { policy: e.policy, reason: e.reason },
    eventType: 'authz',
    severity: e.allowed ? 'info' : 'warn',
  });
});

// 3. SSO 登录（Cycle 32 G32-02 集成）
ssoEngine.on('login-success', (e) => {
  auditTrail.login(e.actor, true, { provider: e.provider });
});
```

### 9.2 全局错误处理

```typescript
// 全局错误兜底审计
window.addEventListener('error', (e) => {
  auditTrail.logSystem({
    who: { id: 'system', type: 'system' },
    what: 'system.error',
    resource: { type: 'error', id: 'global' },
    outcome: 'failure',
    metadata: { message: e.message, stack: e.error?.stack },
    eventType: 'system',
    severity: 'error',
  });
});
```

---

## 十、UI 组件（AuditTrailPanel）

### 10.1 布局

```
┌─────────────────────────────────────────────────┐
│ Audit Trail              [Search] [Export] [⚙]  │
├─────────────────────────────────────────────────┤
│ Filters: [Event Type ▼] [Actor] [Date Range]   │
├─────────────────────────────────────────────────┤
│ ┌──┐ ┌────────────────────────────────────┐  │
│ │📋│ │ #1234 user.login (alice) - success  │  │
│ │✓ │ │ 2026-07-30 14:32:01 UTC            │  │
│ │  │ │ IP: 192.168.1.0 | SSO: okta         │  │
│ │  │ │ [View Details] [Verify Hash]        │  │
│ └──┘ └────────────────────────────────────┘  │
│ ┌──┐ ┌────────────────────────────────────┐  │
│ │📋│ │ #1235 policy.evaluate - denied      │  │
│ │⚠ │ │ 2026-07-30 14:32:05 UTC            │  │
│ │  │ │ Actor: bob | Policy: cost-limit     │  │
│ │  │ │ Reason: Exceeded 90% threshold      │  │
│ └──┘ └────────────────────────────────────┘  │
│                                                  │
│ [Load More] [Verify All] [Generate Report ▼]   │
└─────────────────────────────────────────────────┘
```

### 10.2 功能

1. **时间线视图** - 按时间倒序展示
2. **过滤器** - 事件类型 / Actor / 资源 / 时间范围
3. **详情面板** - 完整事件详情 + JSON 视图
4. **Hash 验证** - 单条事件 + 整链验证
5. **导出** - JSON / CSV / CEF / LEEF
6. **报告生成** - 4 种合规标准
7. **实时刷新** - WebSocket 或轮询
8. **GDPR 工具** - 用户数据访问 / 删除

---

## 十一、依赖与依赖

### 11.1 外部依赖

- 无新增 npm 依赖
- 复用：`crypto.subtle` (Web Crypto API) 用于 SHA-256 + HMAC

### 11.2 内部依赖

- 无前置依赖
- 被依赖：G32-02 (SSO)、G32-03 (Policy Engine) 及未来所有引擎

---

## 十二、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| IndexedDB 配额限制 | 中 | 自动归档 + 配置化保留期 |
| HMAC 密钥丢失 | 中 | 多链 + 可恢复设计 |
| GDPR 误删数据 | 高 | 二次确认 + soft delete + 审计本身保留 |
| 性能（高频写入） | 中 | 批量写入 + 异步处理 |
| 时区一致性 | 低 | 全部 UTC 存储 |

---

## 十三、验收标准

1. ✅ Hash chain 不可篡改验证 100% 通过
2. ✅ 4 种合规报告生成正确
3. ✅ GDPR PII 100% pseudonymize
4. ✅ 单元测试 35+ 全通过
5. ✅ E2E 测试 10+ 全通过
6. ✅ TypeScript 严格模式 0 错误
7. ✅ 与现有引擎集成完成

---

**G32-01 SPEC 状态**：✅ 设计完成，下一步进入实现阶段。
