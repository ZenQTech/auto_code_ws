# Cycle 32 互联网调研报告：企业级安全 + 合规 + 策略引擎

**周期**：Cycle 32 (v6.89.0+)
**日期**：2026-07-30
**方向**：企业级安全 + 合规 + 策略引擎（Audit Trail / SSO / Policy Engine）
**研究对象**：Codex App / TRAE SOLO 3.0 / Cursor 3 Enterprise / Open Policy Agent / OWASP / Microsoft Entra / RFC 7642-7644 (SCIM 2.0)

---

## 一、调研背景

Cycle 30/31 完成了企业级**成本治理**（阈值告警、动态工作流、Orchestrated Agents）和**团队归因**（成本归因、远程 Worktree、Worktree 同步），但企业落地的最后一道门槛是**安全 + 合规**：

1. **审计追踪**（Audit Trail）：SOC 2 / ISO 27001 / GDPR / EU AI Act 都要求 AI 系统保留"自动记录事件"的可信日志。
2. **单点登录**（SSO）：企业客户强制要求 OIDC / SAML 2.0，否则无法进入采购名单。
3. **策略引擎**（Policy Engine）：将业务规则从应用代码解耦，统一管理 org/team/project/user 多维度强制策略。

Cycle 32 主推这三个方向，建立 Hermes 在企业级安全合规维度的核心壁垒。

---

## 二、Audit Trail 审计追踪

### 2.1 行业标准与法规要求

| 法规 / 标准 | 要求 | 关键条款 | 适用场景 |
|------------|------|---------|---------|
| **EU AI Act (Art. 12)** | 高风险 AI 系统"shall technically allow for the automatic recording of events (logs) over the lifetime of the system" | 至少保留 **6 个月**，罚款 €15M / 3% turnover | 欧盟境内部署的所有高风险 AI |
| **NIST AI RMF** | Govern 是横向贯穿功能，强调 **information integrity** | AI 输出的可追溯性 + 来源 | 美国联邦/受监管行业 |
| **OWASP APTS-AR-012** | Hash-chained append-only logs (MUST \| Tier 1) | 每条记录 hash 上一条 + 当前记录 | Agent / 自动系统 |
| **SOC 2 Type II** | 完整操作日志 + 变更追溯 + 不可篡改 | 90 天热存 + 7 年冷存 | SaaS 服务商 |
| **ISO 27001 A.12.4** | 记录用户活动、异常、故障 | 保护审计工具访问 | 信息安全体系认证 |
| **GDPR Art. 30** | 处理活动记录（仅适用于 PII 字段） | 需 pseudonymize PII | 涉及个人数据 |

> 来源：
> - [EU AI Act Art. 12](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52021PC0206)
> - [OWASP APTS Auditability and Reproducibility](https://owasp.org/APTS/standard/5_Auditability/)
> - [Tamper-Evident AI Audit (flow8.ai)](https://flow8.ai/insights/tamper-evident-ai-audit)

### 2.2 Hash-Chain 不可篡改日志设计

**核心算法**（HMAC-SHA256 chain）：

```
Entry 1: data + prevHash (none) → hash(data + timestamp)
Entry 2: data + prevHash (hash1) → hash(data + prevHash + timestamp)
Entry 3: data + prevHash (hash2) → hash(data + prevHash + timestamp)
...
```

**关键设计原则**：

1. **Append-only**：只能 INSERT，永远不 UPDATE/DELETE。修正用 `status: "superseded"` + 指针。
2. **不可篡改**：任何修改会破坏后续所有 hash，O(n) 时间可检测。
3. **分离存储**：审计 schema 与业务 schema 分离，应用角色只能 `INSERT + SELECT`，不能 `UPDATE/DELETE`。
4. **数据库触发器**：在数据库层触发，绕过应用层防止被旁路。
5. **GDPR 合规**：PII 字段 hash + 查表分离；IP 地址最后一段置零（如 `198.51.100.0`）。

**OWASP 标准事件分类**：
- Authentication events（成功/失败/退出/MFA/密码重置）
- Access control failures（401/403）
- Input validation failures（注入尝试）
- Admin actions（特权操作）
- High-value transactions（财务/法律事件）

> 来源：
> - [JSON Audit Logging: Schema, Immutability, SIEM (jsonic.io)](https://jsonic.io/guides/json-audit-logging)
> - [Hash Chains Explained (hyrelog.com)](https://www.hyrelog.com/blog/hash-chains-explained)
> - [Tamper-Evident Audit Trails in PostgreSQL (appmaster.io)](https://appmaster.io/blog/tamper-evident-audit-trails-postgresql)

### 2.3 Hermes 现有审计能力盘点

**已有**（分散在多个引擎中）：
- `costAttributionEngine`：按维度记录 `AttributionRecord`，但无 hash chain
- `worktreeSyncEngine`：记录 `StateChange`，无完整操作上下文
- `usageAttributionEngine`：记录 `UsageRecord`，无不可篡改保证
- `smartApprovalEngine`：记录决策，但只存最近 N 条

**缺失**：
- ❌ 统一 Audit Trail Engine（所有事件类型统一入口）
- ❌ Hash Chain 不可篡改验证
- ❌ 合规报告生成（SOC 2 / GDPR / ISO 27001）
- ❌ 长期保留策略（默认 7 年）
- ❌ 审计日志隔离（不可被 agent runtime 改写）
- ❌ GDPR PII 自动 pseudonymization
- ❌ 审计事件与 Policy / SSO 联动

### 2.4 借鉴的最佳实践

| 来源 | 借鉴点 |
|------|-------|
| **OWASP APTS-AR** | 20 项 MUST 要求覆盖结构化日志、决策透明度、证据完整性、篡改证据、平台完整性、审计隔离 |
| **PostgreSQL append-only** | 专用 audit schema + 触发器 + 角色权限分离 |
| **HMAC chain** | O(n) 验证，简单可靠，无需 Merkle Tree 复杂度 |
| **flow8.ai tamper-evident** | "audit log the agent can edit" 的反思，审计日志必须独立于被审计系统 |
| **Splunk HEC / Elastic** | JSON over HTTP 推送，标准化 SIEM 接口 |

---

## 三、SSO / OIDC / SAML 单点登录

### 3.1 协议对比矩阵

| 维度 | SAML 2.0 | OpenID Connect (OIDC) | OAuth 2.0 |
|------|---------|----------------------|-----------|
| **目的** | 企业级 SSO 联邦 | 用户身份认证 | 委托授权 |
| **标准化年份** | 2005 (OASIS) | 2014 (OpenID Foundation) | 2012 (IETF RFC 6749) |
| **Token 格式** | XML 断言 | JWT (ID Token) | Opaque / JWT |
| **消息格式** | XML | JSON | JSON |
| **传输** | 浏览器重定向 (HTTP-POST/Redirect/Artifact) | REST + JSON over HTTPS | REST + JSON over HTTPS |
| **发现机制** | 静态 XML metadata | `/.well-known/openid-configuration` | 手动 |
| **移动端支持** | 差 | 极佳 | 极佳 |
| **企业采纳度** | 主流（10+ 年） | 快速增长 | 不直接做认证 |
| **典型购买方** | 企业 IT / CISO | 开发者 / 产品团队 | API / 平台团队 |
| **会话注销** | SLO（实现复杂） | Front-channel + Back-channel | 未定义 |
| **配对** | SCIM | SCIM | N/A |
| **推荐流程 (2026)** | Web Browser SSO Profile | Authorization Code + PKCE | Auth Code + PKCE / Client Credentials |

> 来源：
> - [SAML vs OpenID Connect (Microsoft Learn)](https://learn.microsoft.com/fil-ph/entra/identity/enterprise-apps/saml-vs-oidc-decision-guide)
> - [SSO Fundamentals (youngju.dev)](https://www.youngju.dev/blog/devops/2026-06-12-sso-fundamentals-saml-oauth2-oidc-comparison.en)
> - [SAML vs OIDC vs OAuth (ssojet.com)](https://ssojet.com/blog/saml-vs-oidc-vs-oauth-the-60-second-b2b-playbook)

### 3.2 协议选型决策树

```
Q1: 客户是否要求 SAML 2.0?
   ├── 是 → 必须支持 SAML（不能跳过）
   └── 否 ↓
Q2: 目标用户群是开发者 / SaaS / 移动端?
   ├── 是 → 主推 OIDC（更现代、更易集成）
   └── 否 ↓
Q3: 客户已有 SCIM 集成需求?
   ├── 是 → OIDC + SCIM 组合（标准企业套餐）
   └── 否 → 仅 OIDC 即可
```

**B2B SaaS 最佳实践**：**同时支持 OIDC + SAML + SCIM**，覆盖：
- 现代 SaaS 客户（OIDC）
- 传统企业 IT（SAML）
- 自动用户配置（SCIM）

### 3.3 OIDC 授权码流程（Authorization Code + PKCE）

```
[User] → [RP (Hermes)] ──(1) AuthnRequest+PKCE──→ [IdP]
                                                    ↓
[User] ←──(2) Login + Consent── [IdP]
[User] → [RP] ──(3) Auth Code──→ [IdP]
[RP] ──(4) Code+Verifier──→ [IdP] (back-channel)
[IdP] ──(5) ID Token + Access Token + Refresh Token──→ [RP]
[RP] ──(6) UserInfo──→ [IdP]
[RP] → [User] (Session established)
```

**关键安全特性**：
- **PKCE** (Proof Key for Code Exchange)：防止授权码拦截攻击
- **State** 参数：CSRF 防护
- **Nonce**：防止 ID Token 重放
- **Discovery (`.well-known/openid-configuration`)**：自动发现 IdP 端点

### 3.4 SCIM 2.0 自动化用户配置

**核心规范**（IETF RFC 7642-7644）：
- `/Users` 端点：创建/读取/更新/删除用户
- `/Groups` 端点：管理组与成员
- 标准化 JSON schema：`userName`、`emails`、`name`、`active`
- 协议操作：POST（创建）、GET（读取）、PUT（替换）、PATCH（部分）、DELETE（删除）

**生命周期管理**：

```
Hire/Create ──→ Sync Access ──→ Audit ──→ Retire
(POST User)    (PUT/PATCH)    (GET)    (DELETE)
```

**关键应用场景**（在 Hermes 中的价值）：
- 新员工入职 → 自动创建 Hermes 账号 + 分配 team/project 权限
- 角色变更 → 自动调整 cost budget + policy scope
- 离职 → 自动停用账号 + 撤销所有 token + 保留审计日志

> 来源：
> - [SCIM Definitive Guide (ssojet.com)](https://ssojet.com/blog/scim-identity-management-guide/)
> - [SCIM for AI Agents (ssojet.com)](https://ssojet.com/blog/how-scim-helps-automate-user-provisioning-for-ai-agents)
> - [SCIM provisioning in Grafana (grafana.com)](https://grafana.com/blog/introducing-scim-provisioning-in-grafana-enterprise-grade-user-management-made-simple/)

### 3.5 Hermes 现有身份能力盘点

**已有**：
- 简单的 localStorage 用户 session（无真实 IdP 集成）
- 角色 / 权限（UserRef / OrgRef / TeamRef / ProjectRef / RepoRef）

**缺失**：
- ❌ OIDC / OAuth 2.0 客户端实现
- ❌ SAML 2.0 SP 实现
- ❌ IdP 集成（Okta / Auth0 / Azure AD / Google Workspace）
- ❌ SCIM 2.0 服务端 / 客户端
- ❌ 多 IdP 切换与负载均衡
- ❌ IdP-initiated / SP-initiated 两种模式
- ❌ Session 生命周期管理（refresh / revoke / SLO）
- ❌ Audit Trail 与 SSO 联动（登录事件自动审计）

### 3.6 借鉴的最佳实践

| 来源 | 借鉴点 |
|------|-------|
| **Microsoft Entra SAML vs OIDC** | 双协议支持 + 标准化 decision tree |
| **SSOJet 60 秒决策** | AuthN(SAML/OIDC) + AuthZ(OAuth) 明确分工 |
| **Grafana SCIM** | 团队自动创建 + 实时同步 + 即时权限撤销 |
| **SAML metadata 静态交换** | 信任建立通过预共享 metadata |
| **PKCE** | 现代 OAuth 2.1 强制要求 |

---

## 四、Policy Engine 策略引擎

### 4.1 OPA (Open Policy Agent) 核心架构

**项目状态**：
- CNCF **Graduated** 项目（2021-02 起，与 Linkerd 同级）
- 原始作者：Styra（2016 年创立）
- 许可证：Apache 2.0
- 部署模式：Sidecar / Daemon / Library / WASM
- 性能：典型 < 1ms / 决策

**核心价值主张**：
> OPA 回答唯一问题："Is this action allowed?" —— 你的应用发 JSON 描述请求，OPA 返回 allow/deny 决策。

**关键能力**：
- **Rego 语言**：声明式、灵感来自 Datalog，表达力强
- **统一执行**：K8s + Terraform + API Gateway + CI/CD + Microservices 同一引擎
- **解耦**：策略版本化、可测试、可独立部署
- **审计**：每个决策可记录 + 回放

> 来源：
> - [Open Policy Agent Official](https://www.openpolicyagent.org/)
> - [Top 12 Policy as Code Tools 2026 (spacelift.io)](https://spacelift.io/blog/policy-as-code-tools)
> - [OPA: Policy as Code 2026 (zerodaycyberacademy.com)](https://www.zerodaycyberacademy.com/ressources/devsecops/opa-open-policy-agent)

### 4.2 Rego 语言核心概念

```rego
# 1. 规则 (Rules)
package application.authz

default allow := false

allow if {
    input.method == "PUT"
    some petid
    input.path = ["pets", petid]
    input.user == input.owner
}

# 2. 默认值 (Default)
# 3. 表达式 (Expressions)
# 4. 导入 (import)
# 5. 包 (Package)
# 6. 数据 (Data)
# 7. 输入 (Input)
# 8. 决策 (Decision)
```

**核心概念**：
- **Rule**：基本构建块，产生一个值（最经典是 `allow`）
- **Default**：未匹配规则时的默认值（`default allow := false`）
- **Some**：引入变量绑定
- **Set/List/Object**：原生数据结构
- **Reference**：`.` 路径访问

### 4.3 OPA 应用模式分层

| 应用层 | 工具 | 触发时机 |
|--------|------|---------|
| **Misconfig scanning** | Checkov | Pre-commit / PR |
| **IaC enforcement** | Spacelift / Sentinel | Plan / Apply |
| **K8s admission** | Gatekeeper / Kyverno / VAP | 集群 admission |
| **Cloud guardrails** | AWS SCPs / Azure Policy / GCP Org Policy | Cloud org |
| **App authz** | AWS Cedar | Runtime authz |
| **通用策略引擎** | OPA | 跨层决策 |

**最佳实践组合**：Checkov (CI) + Spacelift (apply) + Gatekeeper (admission) + SCPs (cloud) + OPA (通用)

### 4.4 Hermes 中的策略需求

**业务场景**：
- **成本策略**：单用户/单日成本上限、模型白名单
- **权限策略**：谁能调什么 agent / 读什么 repo
- **合规策略**：PII 数据脱敏、跨境数据限制
- **运营策略**：Worktree 创建上限、并发任务数限制
- **安全策略**：危险命令拦截、敏感文件访问控制

**多维度强制**：
- org 全局策略
- team 部门策略
- project 项目策略
- user 个人策略
- resource 资源级策略

### 4.5 Hermes 现有策略能力盘点

**已有**（分散在多个引擎中）：
- `smartApprovalEngine`：基于 JSON DSL 的 allow/block/prompt 决策
- `costThresholdAlertEngine`：成本阈值告警与强制阻断
- `usageAttributionEngine`：用量归因（可作为策略输入）
- `orchestratedAgentEngine`：角色预设与 Phase Contract

**缺失**：
- ❌ 统一 Policy Engine（统一策略定义语言）
- ❌ Rego 子集 DSL（避免引入完整 OPA 运行时）
- ❌ 多维度策略作用域（org/team/project/user/resource）
- ❌ 策略版本化 + Git 管理
- ❌ 策略单元测试
- ❌ 策略强制执行（拦截决策）
- ❌ 策略与 Audit Trail 联动
- ❌ 策略可视化编辑器

### 4.6 借鉴的最佳实践

| 来源 | 借鉴点 |
|------|-------|
| **OPA Rego** | 声明式规则 + 默认 deny + 表达力强 |
| **OPA 跨层执行** | 策略一处定义，多处强制 |
| **OPA Decision Logging** | 每个决策可记录 + 回放 |
| **OPA Bundles + Sign** | 策略可签名分发 + 版本化 |
| **Kyverno** | K8s-native 风格，更易上手 |
| **AWS Cedar** | 资源级 RBAC + ABAC 混合 |

---

## 五、Codex / TRAE / Cursor 新特性分析

### 5.1 Cursor 3 Enterprise

**企业级特性**（2026 趋势）：
- **Audit Trail**：所有 Enterprise 客户的 LLM 调用、文件访问、命令执行全量记录
- **SSO + SCIM**：原生支持 Okta / Azure AD，SCIM 自动用户配置
- **Policy Engine**：管理员可定义 org/team 级策略（如禁用某模型、限制命令、强制审批）
- **Data Residency**：数据可选择区域（US / EU / APAC）
- **Cost Dashboard**：归因到 team / repo / developer
- **Compliance**：SOC 2 Type II + ISO 27001 认证

### 5.2 Codex App

**最新特性**：
- **Cloud Agent Handoff**：任务可从本地 worktree 迁移到云端 GPU
- **Subagent System**：嵌套子代理 + checkpointing
- **MCP Service**：外部工具/MCP 协议集成
- **Workspace Memory**：跨会话持久化记忆
- **Audit + Trace**：所有决策可追溯

### 5.3 TRAE SOLO 3.0

**新特性**：
- **Loop Engineering Workflow**：完整的循环工程工作流
- **Vibe Coding 增强**：自然语言驱动 + 实时预览
- **Multi-Agent Orchestration**：6 阶段编排 + 角色
- **Thinking Process Visualization**：模型思考过程实时展示
- **Cost + Permission Governance**：成本治理 + 作用域权限
- **Skills + Stacks**：技能组合 + 堆叠执行

### 5.4 调研结论与 Hermes 差距

| 维度 | Cursor 3 / Codex / TRAE | Hermes 现状 | 差距 |
|------|------------------------|------------|------|
| **Audit Trail** | 完整 + 不可篡改 + 合规报告 | 分散 + 可篡改 | 严重 |
| **SSO / OIDC** | 原生多 IdP | localStorage 假登录 | 严重 |
| **SAML 2.0** | 多数支持 | 无 | 中 |
| **SCIM** | 自动配置 | 无 | 中 |
| **Policy Engine** | 可视化 + 强制 | 分散多引擎 | 中 |
| **GDPR 合规** | 完整 | 部分（PII 未 pseudonymize） | 中 |
| **SOC 2 认证** | 多数认证 | 无 | 长期 |

---

## 六、Cycle 32 任务规划

### 6.1 三大 P0 任务

#### G32-01: Audit Trail Engine（审计追踪引擎）

**核心功能**：
- 统一审计事件入口（覆盖所有引擎）
- HMAC-SHA256 hash chain 不可篡改
- GDPR PII pseudonymization
- 合规报告（SOC 2 / ISO 27001 / GDPR / EU AI Act）
- 长期保留策略（默认 7 年）
- 审计事件隔离（独立存储 + 权限分离）
- 与所有引擎联动（自动记录）

**关键类型**：
```typescript
interface AuditEvent {
  id: string;
  schemaVersion: string;
  timestamp: number;            // ms epoch
  actor: { id: string; type: 'user' | 'service' | 'agent' };
  action: string;               // dot-namespaced, e.g. "agent.execute"
  resource: { type: string; id: string; name?: string };
  outcome: 'success' | 'failure' | 'denied';
  correlationId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
  prevHash: string;             // hex
  hash: string;                 // hex
  signature?: string;           // optional HMAC
}
```

**预期规模**：35+ 单元测试 + 1 UI Panel

#### G32-02: SSO / OIDC Engine（单点登录引擎）

**核心功能**：
- OIDC 客户端（Authorization Code + PKCE）
- SAML 2.0 SP（SP-initiated / IdP-initiated）
- 多 IdP 切换（Okta / Auth0 / Azure AD / Google Workspace）
- SCIM 2.0 服务端 + 客户端
- Discovery（`.well-known/openid-configuration`）
- Session 管理（refresh / revoke / SLO）
- 与 Audit Trail 联动（登录事件自动审计）

**关键类型**：
```typescript
interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  discoveryUrl?: string;
  pkceMethod: 'S256' | 'plain';
}

interface SAMLConfig {
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  x509cert: string;
  nameIdFormat: string;
  signRequests: boolean;
}

interface SCIMConfig {
  endpoint: string;             // /scim/v2
  bearerToken: string;
  schemas: string[];
}
```

**预期规模**：35+ 单元测试 + 1 UI Panel

#### G32-03: Policy Engine（策略引擎）

**核心功能**：
- JSON DSL + Rego 子集双语法支持
- 多维度作用域（org / team / project / user / resource）
- 决策评估（allow / deny / prompt）
- 策略版本化 + Git 管理
- 策略单元测试
- 决策日志（与 Audit Trail 联动）
- 可视化策略编辑器（基础版）

**关键类型**：
```typescript
interface Policy {
  id: string;
  name: string;
  version: string;
  scope: {
    orgId?: string;
    teamId?: string;
    projectId?: string;
    userId?: string;
    resourceType?: string;
  };
  rules: PolicyRule[];
  effect: 'allow' | 'deny' | 'prompt';
  priority: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface PolicyRule {
  id: string;
  description: string;
  conditions: PolicyCondition[];  // 全部 AND
  effect: 'allow' | 'deny' | 'prompt';
}

interface PolicyContext {
  user: { id: string; roles: string[]; ssoId?: string };
  action: string;
  resource: { type: string; id: string; attributes?: Record<string, any> };
  environment?: {
    time: number;
    ip?: string;
    location?: string;
    cost?: number;
  };
}

interface PolicyDecision {
  allowed: boolean;
  reason: string;
  matchedPolicy?: string;
  matchedRule?: string;
  effect: 'allow' | 'deny' | 'prompt';
  promptMessage?: string;
  evaluatedAt: number;
}
```

**预期规模**：40+ 单元测试 + 1 UI Panel

### 6.2 三大 P1 任务（备选）

| 任务 | 描述 |
|------|------|
| **G32-04 Audit Log UI** | 时间线 + 过滤器 + 详情 + 验证 |
| **G32-05 OIDC Configuration UI** | 可视化 IdP 配置 + 测试连接 |
| **G32-06 Policy Visual Editor** | 拖拽式策略构建 + 即时测试 |

### 6.3 风险评估

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| OPA Rego 完整支持复杂度高 | 高 | 仅实现 Rego 子集 + JSON DSL 双语法 |
| SSO 集成测试需要真实 IdP | 中 | Mock IdP + 离线测试 |
| 审计日志存储成本 | 中 | 配置化保留期 + 自动归档 |
| SAML XML 签名解析复杂 | 中 | 使用成熟 XML-DSig 库 |
| 合规标准多变 | 中 | 可配置规则模板 + 自定义报告 |

---

## 七、调研参考与来源

### 7.1 学术与标准组织

1. [OWASP APTS Auditability and Reproducibility](https://owasp.org/APTS/standard/5_Auditability/)
2. [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
3. [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
4. [EU AI Act Article 12](https://artificialintelligenceact.eu/article/12/)
5. [IETF RFC 6749 - OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749)
6. [IETF RFC 7642-7644 - SCIM 2.0](https://datatracker.ietf.org/doc/html/rfc7642)
7. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
8. [OASIS SAML 2.0](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html)

### 7.2 官方文档

1. [Open Policy Agent Official](https://www.openpolicyagent.org/)
2. [OPA Documentation](https://www.openpolicyagent.org/docs)
3. [Microsoft Entra ID - SAML vs OIDC](https://learn.microsoft.com/fil-ph/entra/identity/enterprise-apps/saml-vs-oidc-decision-guide)
4. [Microsoft Entra ID - SCIM Tutorial](https://learn.microsoft.com/nb-no/Entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)
5. [Grafana SCIM provisioning](https://grafana.com/blog/introducing-scim-provisioning-in-grafana-enterprise-grade-user-management-made-simple/)

### 7.3 技术博客与深度分析

1. [Spacelift - Top 12 Policy as Code Tools 2026](https://spacelift.io/blog/policy-as-code-tools)
2. [Cloudification - Policy as Code with OPA](https://cloudification.io/cloud-blog/policy-as-code-enforcing-security-and-compliance-with-open-policy-agent-opa/)
3. [ZeroDayCyberAcademy - OPA Definition 2026](https://www.zerodaycyberacademy.com/ressources/devsecops/opa-open-policy-agent)
4. [flow8.ai - Tamper-Evident AI Audit](https://flow8.ai/insights/tamper-evident-ai-audit)
5. [jsonic.io - JSON Audit Logging](https://jsonic.io/guides/json-audit-logging)
6. [hyrelog.com - Hash Chains Explained](https://www.hyrelog.com/blog/hash-chains-explained)
7. [appmaster.io - Tamper-Evident Audit Trails PostgreSQL](https://appmaster.io/blog/tamper-evident-audit-trails-postgresql)
8. [ssojet.com - SAML vs OIDC vs OAuth](https://ssojet.com/blog/saml-vs-oidc-vs-oauth-the-60-second-b2b-playbook)
9. [ssojet.com - SCIM Definitive Guide](https://ssojet.com/blog/scim-identity-management-guide/)
10. [ssojet.com - SCIM for AI Agents](https://ssojet.com/blog/how-scim-helps-automate-user-provisioning-for-ai-agents)
11. [youngju.dev - SSO Fundamentals](https://www.youngju.dev/blog/devops/2026-06-12-sso-fundamentals-saml-oauth2-oidc-comparison.en)
12. [digitalidentitybook.com - SAML vs OIDC](https://digitalidentitybook.com/blog/saml-vs-oidc-choosing-right-protocol)

---

## 八、调研结论

Cycle 32 围绕**企业级安全 + 合规**三个核心能力展开，三者之间存在强协同：

```
              ┌──────────────┐
              │ SSO/OIDC     │ ──→ 用户身份 + SSO 登录事件
              │ (G32-02)     │
              └──────┬───────┘
                     ↓
              ┌──────────────┐
              │ Policy Engine│ ──→ 强制执行多维度策略
              │ (G32-03)     │
              └──────┬───────┘
                     ↓
              ┌──────────────┐
              │ Audit Trail  │ ──→ 记录所有决策与操作
              │ (G32-01)     │
              └──────────────┘
```

- **SSO 提供身份**（Who are you?）
- **Policy 强制规则**（What can you do?）
- **Audit 记录一切**（What did you do?）

三者形成"身份-执行-审计"的完整闭环，建立 Hermes 在企业级 SaaS 市场的核心竞争壁垒。

完成本调研后，下一步进入 **Phase 2: 差距分析** + **3 份 SPEC 文档**。
