# CYCLE38 规格说明书：G38-04 人机协作审批引擎

> 周期：Cycle 38  
> 任务 ID：G38-04  
> 模块名称：HumanApprovalEngine  
> 版本：v1.0.0  
> 日期：2026-07-31

---

## 一、模块定位

### 1.1 核心作用

实现危险操作前的人工审批机制，确保关键决策可追溯、可中断、可审计。

### 1.2 对标产品

- **Salesforce Flow Approvals** - 企业级审批流
- **ServiceNow Approval Engine** - ITSM 审批
- **Microsoft Power Automate Approvals** - 自动化审批

### 1.3 与现有模块关系

- **G37-02 ToolUseEngine**：工具执行前可触发审批
- **G37-04 RealLLMProvider**：LLM 输出危险操作可触发审批
- **G38-01 MultiAgentEngine**：Worker 操作可触发审批
- **G38-03 ReflectionEngine**：反思后危险改进可触发审批

---

## 二、核心数据结构

### 2.1 RiskLevel（风险等级）

```typescript
export type RiskLevel = 'safe' | 'moderate' | 'dangerous' | 'critical';

export interface RiskLevelConfig {
  level: RiskLevel;
  autoApprove: boolean;       // 是否自动通过
  requiredApprovers: number;  // 所需审批人数
  approverRoles: ApproverRole[];
  timeoutMs: number;          // 审批超时时间
  description: string;
}

export const DEFAULT_RISK_CONFIGS: Record<RiskLevel, RiskLevelConfig> = {
  safe: { level: 'safe', autoApprove: true, requiredApprovers: 0, approverRoles: [], timeoutMs: 0, description: '安全操作，无需审批' },
  moderate: { level: 'moderate', autoApprove: false, requiredApprovers: 1, approverRoles: ['user'], timeoutMs: 5 * 60 * 1000, description: '中等风险，用户审批' },
  dangerous: { level: 'dangerous', autoApprove: false, requiredApprovers: 1, approverRoles: ['admin'], timeoutMs: 30 * 60 * 1000, description: '高风险，管理员审批' },
  critical: { level: 'critical', autoApprove: false, requiredApprovers: 2, approverRoles: ['admin', 'security_officer'], timeoutMs: 60 * 60 * 1000, description: '极高风险，多人审批' },
};
```

### 2.2 ApprovalRequest（审批请求）

```typescript
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'auto-approved';

export interface ApprovalRequest {
  id: string;
  title: string;
  description: string;
  operation: OperationDescriptor;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  requiredApprovers: number;
  currentApprovals: ApprovalDecision[];
  requestedBy: string;          // 请求人（Agent ID）
  requestedAt: number;
  expiresAt: number;
  resolvedAt?: number;
  result?: 'approved' | 'rejected' | 'expired' | 'cancelled' | 'auto-approved';
  metadata?: Record<string, unknown>;
}

export interface OperationDescriptor {
  type: 'tool_call' | 'llm_output' | 'agent_action' | 'file_access' | 'network_request' | 'system_command';
  name: string;
  args: Record<string, unknown>;
  reversible: boolean;          // 是否可逆
  estimatedImpact: string;      // 预计影响
}

export interface ApprovalDecision {
  approver: string;             // 审批人 ID
  approverRole: ApproverRole;
  decision: 'approve' | 'reject';
  reason?: string;
  decidedAt: number;
}

export type ApproverRole = 'user' | 'admin' | 'security_officer' | 'system';
```

### 2.3 AuditLog（审计日志）

```typescript
export interface AuditLogEntry {
  id: string;
  timestamp: number;
  actor: string;                // 操作者
  action: string;               // 操作类型
  target?: string;              // 操作目标
  result: 'success' | 'failure' | 'denied' | 'expired';
  details: Record<string, unknown>;
  approvalId?: string;
}
```

### 2.4 ApprovalPolicy（审批策略）

```typescript
export interface ApprovalPolicy {
  id: string;
  name: string;
  description?: string;
  conditions: PolicyCondition[];   // 触发条件
  riskLevel: RiskLevel;            // 风险等级
  enabled: boolean;
  priority: number;                // 优先级（高优先级先生效）
}

export interface PolicyCondition {
  type: 'operation_type' | 'tool_name' | 'arg_match' | 'user_role' | 'time_window';
  operator: 'equals' | 'contains' | 'matches' | 'in' | 'not_in';
  value: string | string[];
}
```

---

## 三、核心组件

### 3.1 RiskClassifier（风险分类器）

```typescript
export class RiskClassifier {
  constructor(options?: ClassifierOptions);
  
  // 自动评估风险等级
  classify(operation: OperationDescriptor): RiskLevel;
  
  // 注册自定义规则
  registerRule(pattern: { type: string; match: RegExp | string }, riskLevel: RiskLevel): void;
  
  // 关键词风险检测
  detectKeywordRisk(text: string): RiskLevel;
}
```

**风险评估规则**：
- 文件删除 / 系统命令 / 数据库 DROP → `critical`
- 文件修改 / 网络请求 / 邮件发送 → `dangerous`
- 文件读取 / API 查询 → `moderate`
- 本地计算 / 内部工具 → `safe`

**关键词黑名单**（任何匹配升级到 `critical`）：
- `rm -rf`, `DROP TABLE`, `DELETE FROM`, `format`, `shutdown`, `mkfs`

### 3.2 ApprovalQueue（审批队列）

```typescript
export class ApprovalQueue {
  constructor(options?: QueueOptions);
  
  // 提交
  enqueue(request: ApprovalRequest): void;
  
  // 获取
  get(id: string): ApprovalRequest | undefined;
  dequeue(): ApprovalRequest | undefined;
  
  // 列表
  list(filter?: { status?: ApprovalStatus; riskLevel?: RiskLevel; approverRole?: ApproverRole }): ApprovalRequest[];
  listPending(approverRole?: ApproverRole): ApprovalRequest[];
  
  // 决策
  decide(id: string, decision: ApprovalDecision): ApprovalRequest;
  
  // 取消
  cancel(id: string, reason?: string): boolean;
  
  // 超时清理
  cleanupExpired(now?: number): number;
  
  // 订阅
  onRequest(handler: (req: ApprovalRequest) => void): () => void;
  onResolved(handler: (req: ApprovalRequest) => void): () => void;
}
```

### 3.3 PolicyEngine（策略引擎）

```typescript
export class PolicyEngine {
  constructor(options?: PolicyEngineOptions);
  
  // 添加策略
  addPolicy(policy: ApprovalPolicy): void;
  removePolicy(id: string): boolean;
  listPolicies(): ApprovalPolicy[];
  
  // 匹配策略
  matchPolicies(operation: OperationDescriptor): ApprovalPolicy[];
  
  // 应用策略（返回最终风险等级）
  applyPolicies(operation: OperationDescriptor): RiskLevel;
}
```

**策略匹配优先级**：
1. 按 priority 降序
2. 第一个 enabled 且所有 conditions 满足的策略生效
3. 无匹配策略使用 RiskClassifier.classify

### 3.4 Auditor（审计器）

```typescript
export class Auditor {
  constructor(options?: AuditorOptions);
  
  // 记录
  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry;
  
  // 查询
  query(filter?: { actor?: string; action?: string; startTime?: number; endTime?: number; result?: string }): AuditLogEntry[];
  
  // 导出
  export(format: 'json' | 'csv'): string;
  
  // 统计
  getStats(timeRange?: { start: number; end: number }): {
    totalRequests: number;
    approvedCount: number;
    rejectedCount: number;
    expiredCount: number;
    avgApprovalTimeMs: number;
  };
}
```

### 3.5 HumanApprovalEngine（主类）

```typescript
export class HumanApprovalEngine {
  constructor(options?: HumanApprovalEngineOptions);
  
  // 请求审批（同步等待）
  requestApproval(operation: OperationDescriptor, options?: RequestOptions): Promise<ApprovalRequest>;
  
  // 请求审批（异步，立即返回 request ID）
  submitForApproval(operation: OperationDescriptor, options?: RequestOptions): Promise<string>;
  
  // 审批
  approve(requestId: string, approver: string, role: ApproverRole, reason?: string): ApprovalRequest;
  reject(requestId: string, approver: string, role: ApproverRole, reason: string): ApprovalRequest;
  
  // 取消
  cancel(requestId: string, reason?: string): boolean;
  
  // 查询
  getRequest(id: string): ApprovalRequest | undefined;
  listRequests(filter?: ListFilter): ApprovalRequest[];
  getAuditLog(filter?: AuditFilter): AuditLogEntry[];
  
  // 统计
  getStats(): ApprovalStats;
  
  // 事件订阅
  onRequest(handler: (req: ApprovalRequest) => void): () => void;
  onResolved(handler: (req: ApprovalRequest) => void): () => void;
  onExpired(handler: (req: ApprovalRequest) => void): () => void;
}
```

---

## 四、审批流程

### 4.1 同步审批

```typescript
const result = await engine.requestApproval({
  type: 'file_access',
  name: 'delete_file',
  args: { path: '/etc/passwd' },
  reversible: false,
  estimatedImpact: '高：删除系统关键文件',
}, {
  requestedBy: 'agent-001',
  context: { reason: '清理临时文件' },
});

// result.status === 'approved' → 继续执行
// result.status === 'rejected' → 抛出 ApprovalDeniedError
// result.status === 'expired' → 抛出 ApprovalExpiredError
```

### 4.2 异步审批

```typescript
const requestId = await engine.submitForApproval(operation);
// ...其他业务逻辑...
// 等待用户审批
engine.onResolved((req) => {
  if (req.id === requestId) {
    if (req.result === 'approved') doSomething();
    else logDenial();
  }
});
```

### 4.3 批量审批

```typescript
const approved = await engine.approveBatch(['req-1', 'req-2', 'req-3'], 'admin-001', 'admin', '批量通过');
```

---

## 五、UI 面板设计

### HumanApprovalPanel

- **顶部**：风险等级统计（4 个数字：safe/moderate/dangerous/critical）
- **中部**：待审批列表（按风险等级排序，每条卡片含操作详情/审批按钮）
- **右侧**：策略管理（添加/删除/启用/禁用策略）
- **底部**：审计日志（时间倒序，支持筛选）

---

## 六、性能指标

| 指标 | 目标值 |
|------|--------|
| 风险评估 | < 5ms |
| 策略匹配 | < 10ms |
| 审批响应 | 依赖人工（秒级） |
| 审计写入 | < 10ms |
| 审计查询 | < 100ms |

---

## 七、测试覆盖

| 测试维度 | 覆盖项 |
|---------|--------|
| RiskClassifier | 关键词检测、规则匹配、风险评估 |
| ApprovalQueue | 排队/取消/超时清理/订阅 |
| PolicyEngine | 策略优先级/匹配/应用 |
| Auditor | 记录/查询/导出/统计 |
| HumanApprovalEngine | 同步/异步审批/批量/取消 |

**目标测试数**：40+ 单元测试

---

## 八、安全设计

1. **操作可逆性**：每个操作必须声明 reversible
2. **审计完整性**：所有操作必须留下审计日志
3. **超时降级**：超时未审批默认拒绝（fail-closed）
4. **角色权限**：审批人角色与操作风险等级匹配
5. **不可篡改**：审计日志支持 hash 链（可选）

---

## 九、修改记录

- 2026-07-31 | v1.0.0 | Cycle 38 G38-04 初次创建
