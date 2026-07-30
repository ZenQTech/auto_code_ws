# Cycle 32 代码修改日志

**周期**：Cycle 32 (v6.89.0+)  
**日期**：2026-07-30  
**方向**：企业级安全 + 合规 + 策略引擎（Audit Trail / SSO / Policy Engine）  
**版本变更**：v6.88.0 → v6.91.0

---

## 一、新增文件

### 1.1 文档（5 个）

| 文件 | 路径 | 大小 | 说明 |
|------|------|------|------|
| CYCLE32_CODEX_TRAE_RESEARCH.md | /home/qizheng/auto_code_ws/ | ~30KB | Cycle 32 互联网调研报告（Codex / TRAE / OPA / OWASP） |
| CYCLE32_GAP_ANALYSIS.md | /home/qizheng/auto_code_ws/ | ~25KB | 差距分析报告（P0/P1 任务清单） |
| CYCLE32_SPEC_G32_01_AUDIT_TRAIL.md | /home/qizheng/auto_code_ws/ | ~35KB | G32-01 Audit Trail 详细 SPEC |
| CYCLE32_SPEC_G32_02_SSO.md | /home/qizheng/auto_code_ws/ | ~40KB | G32-02 SSO 详细 SPEC |
| CYCLE32_SPEC_G32_03_POLICY_ENGINE.md | /home/qizheng/auto_code_ws/ | ~45KB | G32-03 Policy Engine 详细 SPEC |
| CYCLE32_ACCEPTANCE_REPORT.md | /home/qizheng/auto_code_ws/ | ~15KB | Cycle 32 验收报告 |
| CYCLE32_CODE_MODIFICATION_LOG.md | /home/qizheng/auto_code_ws/ | 本文件 | Cycle 32 代码修改日志 |
| CYCLE32_STARTUP.md | /home/qizheng/auto_code_ws/ | ~10KB | Cycle 32 启动文档 |

### 1.2 核心引擎（3 个）

| 文件 | 路径 | 大小 | 说明 |
|------|------|------|------|
| auditTrailEngine.ts | frontend/src/utils/ | 41KB | Audit Trail 引擎（HMAC-SHA256 hash chain + 合规报告） |
| ssoEngine.ts | frontend/src/utils/ | 54KB | SSO 引擎（OIDC/SAML/SCIM） |
| policyEngine.ts | frontend/src/utils/ | 53KB | Policy 引擎（JSON DSL + Rego 子集） |

### 1.3 单元测试（3 个）

| 文件 | 路径 | 测试数 | 说明 |
|------|------|--------|------|
| auditTrailEngine.test.ts | frontend/src/utils/ | 70+ | Audit Trail 引擎单元测试 |
| ssoEngine.test.ts | frontend/src/utils/ | 120+ | SSO 引擎单元测试 |
| policyEngine.test.ts | frontend/src/utils/ | 136+ | Policy 引擎单元测试 |

### 1.4 UI 面板（3 个）

| 文件 | 路径 | 大小 | Tab 数 |
|------|------|------|--------|
| AuditTrailPanel.tsx | frontend/src/components/ | 13KB | 4（事件流/合规报告/完整性验证/GDPR） |
| SSOPanel.tsx | frontend/src/components/ | 15KB | 4（IdP/会话/SCIM/Discovery） |
| PolicyPanel.tsx | frontend/src/components/ | 18KB | 4（策略/决策日志/模板/测试） |

### 1.5 E2E 集成测试（1 个）

| 文件 | 路径 | 测试数 | 说明 |
|------|------|--------|------|
| Cycle32E2E.test.tsx | frontend/src/components/ | 19 | Cycle 32 端到端集成测试 |

---

## 二、修改文件

### 2.1 BrandHeader.tsx

**版本**：v2.13.0 → v2.14.0

**修改内容**：
1. 新增 3 个 prop 类型定义：
   - `onOpenAuditTrail?: () => void` (v6.89.0)
   - `onOpenSSO?: () => void` (v6.90.0)
   - `onOpenPolicy?: () => void` (v6.91.0)
2. 新增 3 个内联 SVG 图标：
   - `audit`（盾牌 + 勾）
   - `sso`（钥匙 + 圆环）
   - `policy`（文档 + 勾）
3. 新增 3 个菜单项（位于"状态同步"之后，"用量监控"之前）：
   - 🛡️ 审计追踪（data-testid="menu-audit-trail"）
   - 🔐 单点登录（data-testid="menu-sso"）
   - 📋 策略规则（data-testid="menu-policy"）
4. 更新 Icon 组件类型 union，添加 3 个新图标名

**修改行数**：~80 行新增

### 2.2 AppLayout.tsx

**版本**：v6.86.0 → v6.89.0

**修改内容**：
1. 新增 3 个 prop 接口定义
2. 新增 3 个 prop 透传解构
3. 新增 3 个 prop 传递给 BrandHeader

**修改行数**：~10 行新增

### 2.3 App.tsx

**修改内容**：
1. 新增 3 个 import（AuditTrailPanel, SSOPanel, PolicyPanel）
2. 新增 3 个 useState：
   - `auditTrailOpen`
   - `ssoOpen`
   - `policyOpen`
3. 新增 3 个 useCallback handler：
   - `handleOpenAuditTrail`
   - `handleOpenSSO`
   - `handleOpenPolicy`
4. 新增 3 个 ErrorBoundary 包裹的 Panel 渲染

**修改行数**：~70 行新增

---

## 三、修改记录

### 3.1 TypeScript 类型修复

| 文件 | 修复内容 |
|------|---------|
| auditTrailEngine.ts | `log()` 方法接受可选的 `where`/`how`/`gdprRelevant` 字段 |
| auditTrailEngine.ts | `computeEventHash()` 接受部分事件 + 必填核心字段 |
| policyEngine.ts | `createPolicy()` 接受可选 `id` 字段（方便测试） |
| policyEngine.ts | `guard()` 方法正确解构 `action` 避免覆盖 |
| ssoEngine.ts | `processSAMLResponse()` 标记 `_relayState` 未使用 |

### 3.2 UI 组件修复

| 文件 | 修复内容 |
|------|---------|
| AuditTrailPanel.tsx | 修复 `verifyResult` 状态字段名（`firstInvalidIndex` / `errors`） |
| AuditTrailPanel.tsx | 修复 `StreamTab` 的 query 字段（`eventTypes`/`outcomes`/`actorIds`） |
| AuditTrailPanel.tsx | 修复 `ComplianceTab` 报告渲染（使用实际 ComplianceReport / ComplianceSection 字段） |
| SSOPanel.tsx | 移除未使用的 imports（OIDCConfig/SAMLConfig/SSOSession） |
| SSOPanel.tsx | 修复 SCIMConfig 创建（使用 `serverConfig` 嵌套结构） |
| SSOPanel.tsx | 修复 SCIMUser 创建（移除 `schemas` 字段，使用 `id` 替代） |
| SSOPanel.tsx | 修复 `u.id` 可选字段的删除按钮 |

### 3.3 测试文件修复

| 文件 | 修复内容 |
|------|---------|
| auditTrailEngine.test.ts | 移除未使用的 `AuditEvent` import |
| ssoEngine.test.ts | 移除未使用的 `vi` / `DEFAULT_SSO_CONFIG` / `setDefaultSSOEngine` imports |
| policyEngine.test.ts | 移除未使用的 `POLICY_TEMPLATES` import |
| policyEngine.test.ts | 修复 `p2` 未使用变量警告 |
| policyEngine.test.ts | 修复 `guard.check` 调用缺少 `action` 字段 |

### 3.4 E2E 测试修复

| 修复内容 | 说明 |
|---------|------|
| 使用 `new Engine()` 而非 `getDefault*()` | 避免单例状态泄漏 |
| 添加 `expiresIn: 3600` 到 TokenSet | 满足 TokenSet 类型必填字段 |
| 添加 `ssoId`/`emailVerified`/`groups`/`attributes` 到 SSOSessionUser | 满足类型必填字段 |
| 修复 `decision.reasoning` → `decision.reason` | 实际字段名为 reason |
| 修复 GDPR 删除测试期望 | Soft delete 保留事件，仅擦除 PII |

---

## 四、任务完成状态

### 4.1 已完成任务

- ✅ Cycle 32 互联网调研（Codex / TRAE / OPA / OWASP / Microsoft Entra / SCIM）
- ✅ 差距分析报告
- ✅ G32-01 Audit Trail Engine 完整实现
- ✅ G32-02 SSO Engine 完整实现
- ✅ G32-03 Policy Engine 完整实现
- ✅ 三套 UI 面板（AuditTrailPanel / SSOPanel / PolicyPanel）
- ✅ 主应用集成（BrandHeader 菜单 + AppLayout 透传 + App 渲染）
- ✅ E2E 集成测试（19 个测试用例）
- ✅ 全量测试通过（4147/4147）
- ✅ TypeScript 0 错误
- ✅ 验收报告

### 4.2 未完成任务

- ⏳ Git 提交（待执行）
- ⏳ Cycle 33 启动文档（待生成）

---

## 五、版本信息

- Cycle 32 引擎：v1.0.0
- AuditTrailEngine：v1.0.0 (v6.89.0)
- SSOEngine：v1.0.0 (v6.90.0)
- PolicyEngine：v1.0.0 (v6.91.0)
- AuditTrailPanel：v1.0.0
- SSOPanel：v1.0.0
- PolicyPanel：v1.0.0
- BrandHeader：v2.14.0
- AppLayout：v6.89.0
- App.tsx：v6.91.0+

---

## 六、测试覆盖统计

| 类型 | 数量 | 通过率 |
|------|------|--------|
| 单元测试（新增） | 326+ | 100% |
| E2E 集成测试（新增） | 19 | 100% |
| 全量测试 | 4147 | 100% |
| TypeScript 检查 | 0 错误 | - |

---

## 七、关键代码片段

### 7.1 Audit Trail Hash Chain 核心

```typescript
// 计算 hash
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
  // ...
  prevHash,
};

const hash = computeEventHash(eventBase);
```

### 7.2 SSO OIDC + PKCE 授权 URL

```typescript
const codeVerifier = generateCodeVerifier();
const codeChallenge = await generateCodeChallenge(codeVerifier);

const params = new URLSearchParams({
  response_type: 'code',
  client_id: config.clientId,
  redirect_uri: config.redirectUri,
  scope: config.scopes.join(' '),
  state,
  nonce,
  code_challenge: codeChallenge,
  code_challenge_method: config.pkceMethod,
});
```

### 7.3 Policy 决策评估

```typescript
const applicablePolicies = Array.from(this.policies.values())
  .filter((p) => p.status === 'active')
  .filter((p) => this.matchesScope(p, context))
  .filter((p) => this.matchesAppliesTo(p, context))
  .sort((a, b) => b.priority - a.priority);

for (const policy of applicablePolicies) {
  const decision = this.evaluatePolicy(policy, context);
  if (decision.effect === 'deny') return decision; // deny-overrides
}
```

---

## 八、下一步

1. Git 提交所有变更
2. 生成 Cycle 33 启动文档
3. 等待用户确认 Cycle 33 调研方向
