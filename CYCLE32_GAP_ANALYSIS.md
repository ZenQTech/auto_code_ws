# Cycle 32 差距分析报告

**周期**：Cycle 32 (v6.89.0+)
**日期**：2026-07-30
**方向**：企业级安全 + 合规 + 策略引擎
**参考文档**：[CYCLE32_CODEX_TRAE_RESEARCH.md](./CYCLE32_CODEX_TRAE_RESEARCH.md)

---

## 一、调研结论

基于 Cycle 32 互联网调研，Hermes 当前在企业级安全 + 合规维度的**核心差距**集中在以下三个能力：

1. **Audit Trail 审计追踪** — 零散、不可篡改、合规报告缺失
2. **SSO / OIDC / SAML** — 仅 localStorage 假登录、无标准 IdP 集成
3. **Policy Engine 策略引擎** — 分散在多个引擎、无统一强制执行

---

## 二、差距维度分析

### 2.1 Audit Trail 维度

| 维度 | Hermes 现状 | 目标状态 | 差距 |
|------|------------|---------|------|
| **统一事件入口** | 各引擎独立记录 | 统一 AuditEvent 接口 | 高 |
| **不可篡改** | 无 | HMAC-SHA256 hash chain | 高 |
| **结构化日志** | 部分（AttributionRecord 等） | 完整 schema | 中 |
| **决策透明度** | 缺失 | 决策上下文 + reasoning | 中 |
| **PII 脱敏** | 缺失 | GDPR pseudonymization | 中 |
| **合规报告** | 缺失 | SOC 2 / GDPR / EU AI Act 模板 | 高 |
| **长期保留** | localStorage（5MB 限制） | IndexedDB + 后端存储 | 中 |
| **审计隔离** | 与业务存储混合 | 独立 audit schema | 中 |
| **多事件类型** | 仅业务事件 | 认证 / 授权 / 数据 / 管理 | 高 |
| **回放与重放** | 无 | 完整链路回放 | 中 |

### 2.2 SSO / OIDC / SAML 维度

| 维度 | Hermes 现状 | 目标状态 | 差距 |
|------|------------|---------|------|
| **OIDC 客户端** | 无 | 完整 Authorization Code + PKCE | 高 |
| **SAML 2.0 SP** | 无 | XML 断言 + 签名验证 | 高 |
| **多 IdP 集成** | 无 | Okta / Auth0 / Azure AD / Google | 高 |
| **SCIM 2.0** | 无 | 完整服务端 + 客户端 | 中 |
| **Discovery** | 无 | `.well-known/openid-configuration` | 中 |
| **PKCE** | 无 | S256 强制 | 中 |
| **Session 管理** | 简单 localStorage | 完整生命周期 | 中 |
| **Token 刷新** | 无 | refresh_token + 离线撤销 | 中 |
| **SLO (注销)** | 无 | Front-channel + Back-channel | 中 |
| **IdP 切换** | 无 | 运行时切换 | 中 |
| **MFA 触发** | 无 | 委托给 IdP | 低 |
| **SSO 事件审计** | 无 | 与 Audit Trail 联动 | 中 |

### 2.3 Policy Engine 维度

| 维度 | Hermes 现状 | 目标状态 | 差距 |
|------|------------|---------|------|
| **统一策略接口** | 分散（smartApproval / costThreshold） | 统一 Policy + Decision | 高 |
| **Rego DSL** | 无 | Rego 子集 + JSON DSL 双语法 | 高 |
| **多维度作用域** | 部分（user / org） | org/team/project/user/resource | 中 |
| **策略版本化** | 无 | 语义化版本 + Git 管理 | 中 |
| **策略测试** | 无 | 单元测试框架 | 中 |
| **决策日志** | 部分 | 完整 + 与 Audit Trail 联动 | 中 |
| **强制执行** | 部分（成本阻断） | 统一拦截器 | 高 |
| **可视化编辑** | 无 | 基础版可视化 | 低（P1） |
| **策略模板** | 无 | 预置安全 / 合规 / 成本模板 | 低 |
| **OPA 集成** | 无 | 可选 OPA 后端 | 低（P2） |

---

## 三、P0 任务清单

### G32-01: Audit Trail Engine（审计追踪引擎）

**目标**：建立企业级不可篡改审计日志，满足 SOC 2 / GDPR / EU AI Act 合规要求。

**核心交付**：
- `auditTrailEngine.ts` — 核心引擎
- `auditTrailEngine.test.ts` — 35+ 单元测试
- `AuditTrailPanel.tsx` — UI 面板
- 集成到所有现有引擎（自动 emit 事件）

**关键能力**：
- HMAC-SHA256 hash chain 不可篡改
- 统一 AuditEvent 接口
- GDPR PII pseudonymization
- 合规报告生成（4 种标准）
- 长期保留（IndexedDB + 配置化）
- 决策透明度（reasoning 字段）
- 审计事件隔离

**优先级理由**：合规底线，无审计则其他功能无意义。

### G32-02: SSO / OIDC / SAML Engine（单点登录引擎）

**目标**：建立企业级身份认证能力，支持 OIDC + SAML 2.0 + SCIM 2.0。

**核心交付**：
- `ssoEngine.ts` — 核心引擎
- `ssoEngine.test.ts` — 35+ 单元测试
- `SsoPanel.tsx` — UI 面板
- 集成到 App.tsx 主登录流程

**关键能力**：
- OIDC Authorization Code + PKCE
- SAML 2.0 SP-initiated + IdP-initiated
- 多 IdP 切换（Okta / Auth0 / Azure AD / Google）
- SCIM 2.0 服务端（/Users, /Groups）
- Discovery（`.well-known/openid-configuration`）
- Session 生命周期（refresh / revoke / SLO）
- SSO 事件自动写入 Audit Trail

**优先级理由**：企业客户准入硬性要求，无 SSO 则无法进入采购名单。

### G32-03: Policy Engine（策略引擎）

**目标**：建立统一策略规则引擎，将业务规则从应用代码解耦。

**核心交付**：
- `policyEngine.ts` — 核心引擎
- `policyEngine.test.ts` — 40+ 单元测试
- `PolicyPanel.tsx` — UI 面板
- 集成到所有需要强制执行的入口

**关键能力**：
- JSON DSL + Rego 子集双语法
- 多维度作用域（org/team/project/user/resource）
- 决策评估（allow/deny/prompt）
- 策略版本化（语义化版本）
- 策略单元测试
- 决策日志（与 Audit Trail 联动）
- 强制执行（拦截器模式）

**优先级理由**：将分散在多个引擎的策略统一管理，避免规则散落。

---

## 四、P1 任务清单（备选）

| 任务 | 描述 | 优先级 |
|------|------|-------|
| **G32-04 Audit Log UI** | 时间线 + 过滤器 + 详情 + hash chain 验证 | P1 |
| **G32-05 OIDC Configuration UI** | 可视化 IdP 配置 + 测试连接 | P1 |
| **G32-06 Policy Visual Editor** | 拖拽式策略构建 + 即时测试 | P1 |
| **G32-07 Compliance Dashboard** | 合规态势总览（DORA / GDPR / EU AI Act） | P1 |
| **G32-08 GDPR Data Subject Request** | 数据主体请求（访问 / 删除 / 导出） | P1 |

---

## 五、P2 任务清单（远期）

| 任务 | 描述 | 优先级 |
|------|------|-------|
| **OPA Backend Adapter** | 集成完整 OPA 作为外部决策点 | P2 |
| **OPA Bundle 签名分发** | 策略包签名 + 版本化分发 | P2 |
| **第三方安全审计集成** | Datadog / Splunk / Elastic SIEM | P2 |
| **Multi-Region Failover** | 多区域审计日志同步 | P2 |
| **SLA Monitor** | SLO 违约告警 | P2 |
| **Backup/Restore** | 审计数据备份与恢复 | P2 |

---

## 六、风险评估

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| OPA Rego 完整支持复杂度高 | 高 | 实现 JSON DSL + Rego 子集，完整 Rego 可作 P2 |
| SSO 集成测试需要真实 IdP | 中 | Mock IdP + 离线测试用例 |
| 审计日志存储成本 | 中 | 配置化保留期 + 自动归档 |
| SAML XML 签名解析复杂 | 中 | 优先支持 OIDC，SAML 作可选 |
| 合规标准多变 | 中 | 可配置规则模板 + 自定义报告 |
| 现有引擎需适配 | 中 | 提供 emitter 适配器，渐进式接入 |

---

## 七、实施顺序

1. **G32-01 Audit Trail**（优先）— 为后续功能提供审计基础
2. **G32-02 SSO**（高优先级）— 解决企业准入问题
3. **G32-03 Policy Engine**（高优先级）— 统一策略管理

每个引擎配套：
- 1 个核心引擎（.ts）
- 1 个单元测试套件（.test.ts，30+ 测试）
- 1 个 UI 组件（.tsx）
- 1 份 SPEC 文档（.md）
- 集成到主应用（App.tsx + AppLayout.tsx + BrandHeader.tsx）

---

## 八、与现有功能集成

### 8.1 Audit Trail 集成点

| 现有引擎 | 集成方式 |
|---------|---------|
| `costAttributionEngine` | 监听 `attribution-recorded` → 写审计 |
| `costThresholdAlertEngine` | 监听 `alert-triggered` → 写审计 |
| `worktreeSyncEngine` | 监听 `change-published` → 写审计 |
| `smartApprovalEngine` | 监听所有决策事件 → 写审计 |
| `usageAttributionEngine` | 监听 `usage-attributed` → 写审计 |
| `orchestratedAgentEngine` | 监听 `phase-transition` → 写审计 |

### 8.2 SSO 集成点

| 现有功能 | 集成方式 |
|---------|---------|
| `App.tsx` 登录入口 | 替换为 SSO 登录按钮 |
| `BrandHeader` 用户菜单 | 显示 SSO 用户信息 + Logout 触发 SLO |
| `costAttributionEngine` | 用户标识使用 SSO ID |
| `policyEngine` | 用户身份来源 SSO claims |

### 8.3 Policy Engine 集成点

| 现有引擎 | 集成方式 |
|---------|---------|
| `smartApprovalEngine` | 替换为 Policy Engine 统一评估 |
| `costThresholdAlertEngine` | 成本策略作为内置策略 |
| `usageAttributionEngine` | 用量策略作为内置策略 |
| `orchestratedAgentEngine` | 角色策略作为前置检查 |
| `remoteWorktreeAdapter` | 创建 Worktree 前策略检查 |

---

## 九、验收标准

### 9.1 功能完整性
- ✅ 3 大引擎全部实现
- ✅ 3 大 UI 组件可用
- ✅ 主应用集成完成
- ✅ E2E 测试覆盖核心流程

### 9.2 测试通过率
- ✅ 单元测试 100% 通过
- ✅ E2E 测试 100% 通过
- ✅ TypeScript 严格模式 0 错误

### 9.3 合规性
- ✅ 审计日志不可篡改（hash chain 验证）
- ✅ PII 自动 pseudonymization
- ✅ 4 种合规报告模板（SOC 2 / GDPR / ISO 27001 / EU AI Act）
- ✅ 策略强制执行（拦截器模式）

### 9.4 性能
- ✅ 审计事件写入 < 10ms
- ✅ 策略评估 < 5ms
- ✅ OIDC 登录流程 < 2s（典型）

---

## 十、节奏与节奏

保持 Cycle 30/31 的 3 P0 任务节奏：
- 每个引擎 30+ 单元测试
- 3 UI 组件 + 20+ E2E 测试
- 主应用集成 + 验收报告
- 6 个 Git commit（调研 / 引擎 / UI / 集成 / 验收 / 循环重启）

---

**Cycle 32 准备状态**：✅ 调研完成，差距分析完成，下一步编写 3 份 SPEC 文档。
