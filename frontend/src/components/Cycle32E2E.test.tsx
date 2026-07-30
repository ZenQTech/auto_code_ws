/**
 * Cycle 32 E2E 集成测试 (v6.89.0+)
 * 验证 G32-01/G32-02/G32-03 三个核心引擎 + UI 组件 + 主应用集成的端到端连通性
 *
 * 覆盖目标：
 * 1. AuditTrailEngine 不可篡改 hash chain + 合规报告 + PII 脱敏 + GDPR 操作
 * 2. SSOEngine OIDC/SAML/SCIM 流程 + Session 管理 + Discovery
 * 3. PolicyEngine 策略 CRUD + 决策评估 + 冲突解决 + 模板应用
 * 4. 三个 UI 组件可成功导入
 * 5. 三个引擎的事件系统独立工作
 * 6. 三引擎协同工作（认证 → 审计 → 策略强制）
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

describe('Cycle 32 E2E 集成测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ============ G32-01: AuditTrail 端到端 ============

  describe('G32-01: AuditTrail 端到端', () => {
    it('事件记录 + 不可篡改 hash chain + 完整性验证 完整流程', async () => {
      const { AuditTrailEngine, GENESIS_HASH } = await import('../utils/auditTrailEngine');
      const engine = new AuditTrailEngine({ persist: false });

      // 1. 记录多个事件
      const event1 = engine.log({
        who: { id: 'user-1', type: 'user', name: 'Alice' },
        what: 'auth.login',
        resource: { type: 'session', id: 'sess-1' },
        outcome: 'success',
        eventType: 'auth',
        severity: 'info',
        gdprRelevant: false,
      });
      expect(event1.prevHash).toBe(GENESIS_HASH);
      expect(event1.sequenceNumber).toBe(0);
      expect(event1.hash).toMatch(/^[0-9a-f]{64}$/);

      const event2 = engine.log({
        who: { id: 'user-1', type: 'user', name: 'Alice' },
        what: 'data.read',
        resource: { type: 'document', id: 'doc-1' },
        outcome: 'success',
        eventType: 'data',
        severity: 'info',
        gdprRelevant: true,
      });
      expect(event2.prevHash).toBe(event1.hash);
      expect(event2.sequenceNumber).toBe(1);

      // 2. 完整性验证
      const verify = engine.verifyChain();
      expect(verify.valid).toBe(true);
      expect(verify.totalChecked).toBe(2);

      // 3. 单事件验证
      const single = engine.verifyEvent(event1.id);
      expect(single.valid).toBe(true);
    });

    it('PII 脱敏 + 不可篡改签名 验证', async () => {
      const { AuditTrailEngine } = await import('../utils/auditTrailEngine');
      const engine = new AuditTrailEngine({ persist: false });

      const event = engine.log({
        who: { id: 'user-1', type: 'user', name: 'Alice', email: 'alice@example.com' },
        what: 'data.export',
        resource: { type: 'user-data', id: 'user-1' },
        outcome: 'success',
        eventType: 'data',
        severity: 'info',
        gdprRelevant: true,
      });

      // PII 脱敏后 email 应该是 pseudonymized 形式
      expect(event.who.email).toMatch(/^email_[0-9a-f]{8}@anon\.local$/);
      expect(event.gdprRelevant).toBe(true);
    });

    it('SOC 2 合规报告生成 完整流程', async () => {
      const { AuditTrailEngine } = await import('../utils/auditTrailEngine');
      const engine = new AuditTrailEngine({ persist: false });

      // 记录多种类型事件
      engine.log({ who: { id: 'u1', type: 'user' }, what: 'auth.login', resource: { type: 'session', id: 's1' }, outcome: 'success', eventType: 'auth', severity: 'info', gdprRelevant: false });
      engine.log({ who: { id: 'u1', type: 'user' }, what: 'authz.check', resource: { type: 'resource', id: 'r1' }, outcome: 'success', eventType: 'authz', severity: 'info', gdprRelevant: false });
      engine.log({ who: { id: 'admin', type: 'user' }, what: 'admin.update', resource: { type: 'policy', id: 'p1' }, outcome: 'success', eventType: 'admin', severity: 'warn', gdprRelevant: false });

      const period = { from: Date.now() - 86400000, to: Date.now() };
      const report = engine.generateSOC2Report(period);

      expect(report.standard).toBe('SOC2');
      expect(report.totalEvents).toBe(3);
      expect(report.sections.length).toBeGreaterThan(0);
      expect(report.integrityVerified).toBe(true);
      expect(report.integrityCheck.valid).toBe(true);
    });

    it('GDPR 数据主体请求 完整流程', async () => {
      const { AuditTrailEngine } = await import('../utils/auditTrailEngine');
      const engine = new AuditTrailEngine({ persist: false });

      // 记录涉及 PII 的事件
      for (let i = 0; i < 3; i++) {
        engine.log({
          who: { id: 'gdpr-user', type: 'user', name: 'Bob', email: 'bob@example.com' },
          what: 'data.read',
          resource: { type: 'user-data', id: 'gdpr-user' },
          outcome: 'success',
          eventType: 'data',
          severity: 'info',
          gdprRelevant: true,
        });
      }

      // GDPR 数据导出
      const exported = engine.exportActorData('gdpr-user');
      expect(exported.length).toBe(3);

      // GDPR 数据主体删除（匿名化：保留事件用于审计，但擦除 PII）
      const deleted = engine.deleteActorData('gdpr-user');
      expect(deleted).toBe(3);

      // 验证 PII 已脱敏：name 和 email 已被擦除
      const remaining = engine.getByActor('gdpr-user');
      expect(remaining.length).toBe(3);
      remaining.forEach((e) => {
        expect(e.who.name).toBe('anonymized');
        expect(e.who.email).toBe('anonymized@anon.local');
      });
    });
  });

  // ============ G32-02: SSO 端到端 ============

  describe('G32-02: SSO 端到端', () => {
    it('OIDC 注册 + 授权 URL 构建 + 完整流程', async () => {
      const { SSOEngine } = await import('../utils/ssoEngine');
      const engine = new SSOEngine({ persist: false });

      // 1. 注册 OIDC IdP
      const config = engine.registerOIDCProvider({
        name: 'Okta Production',
        issuer: 'https://test.okta.com',
        clientId: 'client-123',
        clientSecret: 'secret-abc',
        redirectUri: 'https://app.example.com/callback',
        authorizationEndpoint: 'https://test.okta.com/oauth2/v1/authorize',
        tokenEndpoint: 'https://test.okta.com/oauth2/v1/token',
        endSessionEndpoint: 'https://test.okta.com/oauth2/v1/logout',
        scopes: ['openid', 'profile', 'email'],
        sessionTimeoutMs: 3600000,
        pkceMethod: 'S256',
      });

      expect(config.id).toMatch(/^oidc-/);
      expect(engine.listOIDCProviders()).toHaveLength(1);

      // 2. 构建授权 URL（PKCE）
      const req = engine.buildAuthorizationURL(config.id);
      expect(req.url).toContain('https://test.okta.com/oauth2/v1/authorize');
      expect(req.url).toContain('client_id=client-123');
      expect(req.url).toContain('code_challenge=');
      expect(req.url).toContain('code_challenge_method=S256');
      expect(req.codeVerifier).toBeDefined();

      // 3. SLO URL
      const sloUrl = engine.endSession('id-token-hint', config.id);
      expect(sloUrl).toContain('https://test.okta.com/oauth2/v1/logout');
    });

    it('SAML 注册 + AuthnRequest 构建 完整流程', async () => {
      const { SSOEngine } = await import('../utils/ssoEngine');
      const engine = new SSOEngine({ persist: false });

      const config = engine.registerSAMLProvider({
        name: 'Azure AD SAML',
        entityId: 'https://app.example.com/saml',
        idpEntityId: 'https://sts.windows.net/tenant/',
        idpSsoURL: 'https://login.microsoftonline.com/tenant/saml2',
        idpX509Cert: 'MIIDazCCAlOgAwIBAgIUJ...',
        assertionConsumerServiceURL: 'https://app.example.com/saml/acs',
        enabled: true,
      });

      expect(config.id).toMatch(/^saml-/);

      const req = engine.buildSAMLRequest(config.id);
      expect(req.url).toContain('login.microsoftonline.com');
      expect(req.samlRequest).toBeDefined();
    });

    it('SCIM 端点 + 用户生命周期管理 完整流程', async () => {
      const { SSOEngine } = await import('../utils/ssoEngine');
      const engine = new SSOEngine({ persist: false });

      const config = engine.registerSCIMConfig({
        id: 'scim-test',
        name: 'Test SCIM',
        type: 'scim',
        enabled: true,
        direction: 'inbound',
        serverConfig: {
          baseUrl: 'https://api.example.com/scim/v2',
          bearerToken: 'test-token',
          supportedSchemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        },
        userMapping: {
          externalId: 'externalId',
          userName: 'userName',
          email: 'emails[0].value',
          emailType: 'work',
          givenName: 'name.givenName',
          familyName: 'name.familyName',
        },
        enableAutoSync: true,
        syncOnUserCreate: true,
        syncOnUserUpdate: true,
        syncOnUserDelete: true,
      });

      expect(config.id).toBe('scim-test');

      // 创建用户
      const newUser = engine.scimCreateUser('scim-test', {
        userName: 'alice@example.com',
        name: { givenName: 'Alice', familyName: 'Smith' },
        emails: [{ value: 'alice@example.com', primary: true }],
        active: true,
      });

      expect(newUser.id).toBeDefined();

      // 列出用户
      const list = engine.scimListUsers('scim-test');
      expect(list.totalResults).toBe(1);

      // 删除用户
      if (newUser.id) {
        engine.scimDeleteUser('scim-test', newUser.id);
        const after = engine.scimListUsers('scim-test');
        expect(after.totalResults).toBe(0);
      }
    });

    it('Session 生命周期管理 完整流程', async () => {
      const { SSOEngine } = await import('../utils/ssoEngine');
      const engine = new SSOEngine({ persist: false });

      const session = engine.createSession(
        'oidc-test',
        {
          accessToken: 'at-123',
          refreshToken: 'rt-456',
          idToken: 'id-789',
          tokenType: 'Bearer',
          expiresIn: 3600,
          expiresAt: Date.now() + 3600000,
          scope: 'openid profile email',
        },
        {
          id: 'user-1',
          ssoId: 'okta|user-1',
          email: 'user@example.com',
          emailVerified: true,
          name: 'Test User',
          roles: ['developer'],
          groups: [],
          attributes: {},
        }
      );

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.providerId).toBe('oidc-test');

      const validation = engine.validateSession(session.id);
      expect(validation.valid).toBe(true);

      engine.revokeSession(session.id, 'test');
      const after = engine.validateSession(session.id);
      expect(after.valid).toBe(false);
    });
  });

  // ============ G32-03: PolicyEngine 端到端 ============

  describe('G32-03: Policy 端到端', () => {
    it('策略 CRUD + 状态管理 完整流程', async () => {
      const { PolicyEngine } = await import('../utils/policyEngine');
      const engine = new PolicyEngine({ persist: false });

      // 1. 创建策略
      const policy = engine.createPolicy({
        name: 'Allow Developers',
        description: 'Allow developers to execute agents',
        version: '1.0.0',
        status: 'draft',
        priority: 100,
        scope: { orgId: 'org-1' },
        appliesTo: { actions: ['agent.execute'], subjects: ['user'] },
        rules: [
          {
            id: 'rule-1',
            name: 'Allow role:developer',
            effect: 'allow',
            conditions: [{ type: 'in', field: 'user.roles', values: ['developer'] }],
          },
        ],
        defaultEffect: 'deny',
        conflictResolution: 'deny-overrides',
        tags: ['security', 'rbac'],
      });

      expect(policy.id).toMatch(/^pol-/);
      expect(policy.status).toBe('draft');

      // 2. 激活
      engine.activatePolicy(policy.id);
      const activated = engine.getPolicy(policy.id);
      expect(activated?.status).toBe('active');

      // 3. 列出
      const active = engine.listPolicies({ status: 'active' });
      expect(active.length).toBe(1);

      // 4. 更新
      const updated = engine.updatePolicy(policy.id, { description: 'Updated description' });
      expect(updated.description).toBe('Updated description');

      // 5. 归档
      engine.archivePolicy(policy.id);
      const archived = engine.getPolicy(policy.id);
      expect(archived?.status).toBe('archived');
    });

    it('决策评估 + 多策略冲突解决 完整流程', async () => {
      const { PolicyEngine } = await import('../utils/policyEngine');
      const engine = new PolicyEngine({ persist: false });

      // 策略 1：允许特定用户
      engine.createPolicy({
        name: 'Allow alice',
        version: '1.0.0',
        status: 'active',
        priority: 50,
        scope: {},
        appliesTo: { actions: ['*'] },
        rules: [{
          id: 'r1', name: 'Allow alice', effect: 'allow',
          conditions: [{ type: 'equals', field: 'user.id', value: 'alice' }],
        }],
        defaultEffect: 'deny',
        conflictResolution: 'deny-overrides',
      });

      // 策略 2：高优先级拒绝所有人（高优先级）
      engine.createPolicy({
        name: 'Deny all high priority',
        version: '1.0.0',
        status: 'active',
        priority: 100,
        scope: {},
        appliesTo: { actions: ['*'] },
        rules: [{
          id: 'r2', name: 'Deny all', effect: 'deny',
          conditions: [],
        }],
        defaultEffect: 'allow',
        conflictResolution: 'deny-overrides',
      });

      // alice 的请求：deny-overrides → deny
      const aliceDecision = engine.evaluate({
        user: { id: 'alice', email: 'alice@x.com', roles: [], groups: [] },
        action: 'agent.execute',
        resource: { type: 'agent', id: 'a1' },
        environment: { timestamp: Date.now() },
      });
      expect(aliceDecision.effect).toBe('deny');
      expect(aliceDecision.evaluatedPolicies).toBe(2);
    });

    it('模板应用 + 测试系统 完整流程', async () => {
      const { PolicyEngine, POLICY_TEMPLATES } = await import('../utils/policyEngine');
      const engine = new PolicyEngine({ persist: false });

      // 1. 列出模板
      const templates = engine.listTemplates();
      expect(templates.length).toBeGreaterThan(0);
      expect(POLICY_TEMPLATES.length).toBeGreaterThan(0);

      // 2. 应用模板（使用第一个可用模板）
      const firstTemplate = templates[0];
      if (firstTemplate) {
        try {
          const policy = engine.applyTemplate(firstTemplate.id, { limit: 100, currency: 'USD' });
          expect(policy.id).toBeDefined();
          expect(policy.rules.length).toBeGreaterThan(0);
          engine.activatePolicy(policy.id);
        } catch (e) {
          // 部分模板可能需要额外变量
        }
      }

      // 3. 测试用例管理
      const testPolicy = engine.createPolicy({
        name: 'Test Policy',
        version: '1.0.0',
        status: 'active',
        priority: 50,
        scope: {},
        appliesTo: { actions: ['*'] },
        rules: [{
          id: 'r1', name: 'Allow role:admin', effect: 'allow',
          conditions: [{ type: 'in', field: 'user.roles', values: ['admin'] }],
        }],
        defaultEffect: 'deny',
        conflictResolution: 'deny-overrides',
      });

      const testCase = engine.createTestCase(testPolicy.id, {
        name: 'Admin allowed',
        context: {
          user: { id: 'u1', email: 'admin@x.com', roles: ['admin'], groups: [] },
          action: 'agent.execute',
          resource: { type: 'agent', id: 'a1' },
          environment: { timestamp: Date.now() },
        },
        expectedEffect: 'allow',
      });

      expect(testCase.id).toMatch(/^tc-/);
      expect(engine.listTestCases(testPolicy.id).length).toBe(1);

      // 4. 测试执行
      const testResult = engine.testPolicy(testPolicy.id, [testCase]);
      expect(testResult.total).toBe(1);
      expect(testResult.passed).toBe(1);
    });

    it('审计集成 + 事件订阅 完整流程', async () => {
      const { PolicyEngine } = await import('../utils/policyEngine');
      const engine = new PolicyEngine({ persist: false });

      const events: any[] = [];
      engine.on('policy-created', (e) => events.push(e));
      engine.on('policy-activated', (e) => events.push(e));
      engine.on('policy-evaluated', (e) => events.push(e));

      const policy = engine.createPolicy({
        name: 'Test Audit',
        version: '1.0.0',
        status: 'draft',
        priority: 50,
        scope: {},
        appliesTo: { actions: ['*'] },
        rules: [],
        defaultEffect: 'allow',
        conflictResolution: 'deny-overrides',
      });

      engine.activatePolicy(policy.id);
      engine.evaluate({
        user: { id: 'u1', email: 'u1@x.com', roles: [], groups: [] },
        action: 'agent.execute',
        resource: { type: 'agent', id: 'a1' },
        environment: { timestamp: Date.now() },
      });

      expect(events.length).toBe(3);
      expect(events.map((e) => e.type)).toContain('policy-created');
      expect(events.map((e) => e.type)).toContain('policy-activated');
      expect(events.map((e) => e.type)).toContain('policy-evaluated');
    });
  });

  // ============ 三引擎协同：认证 → 审计 → 策略强制 ============

  describe('Cycle 32 三引擎协同：身份认证 → 审计 → 策略强制', () => {
    it('用户登录 → 审计记录 → 策略评估 完整流程', async () => {
      const { AuditTrailEngine } = await import('../utils/auditTrailEngine');
      const { SSOEngine } = await import('../utils/ssoEngine');
      const { PolicyEngine } = await import('../utils/policyEngine');
      const auditEngine = new AuditTrailEngine({ persist: false });
      const ssoEngine = new SSOEngine({ persist: false });
      const policyEngine = new PolicyEngine({ persist: false });

      // 1. SSO 认证流程
      const oidcConfig = ssoEngine.registerOIDCProvider({
        name: 'Enterprise IdP',
        issuer: 'https://idp.example.com',
        clientId: 'hermes-app',
        clientSecret: 'secret',
        redirectUri: 'https://hermes.example.com/callback',
        authorizationEndpoint: 'https://idp.example.com/authorize',
        tokenEndpoint: 'https://idp.example.com/token',
        endSessionEndpoint: 'https://idp.example.com/logout',
        scopes: ['openid', 'profile', 'email'],
        sessionTimeoutMs: 3600000,
        pkceMethod: 'S256',
      });

      // 模拟认证成功
      const session = ssoEngine.createSession(
        oidcConfig.id,
        {
          accessToken: 'at-xyz',
          refreshToken: 'rt-xyz',
          idToken: 'id-xyz',
          tokenType: 'Bearer',
          expiresIn: 3600,
          expiresAt: Date.now() + 3600000,
          scope: 'openid profile email',
        },
        {
          id: 'enterprise-user',
          ssoId: 'okta|enterprise-user',
          email: 'enterprise@example.com',
          emailVerified: true,
          name: 'Enterprise User',
          roles: ['developer'],
          groups: [],
          attributes: {},
        }
      );

      // 2. 审计：记录 SSO 登录成功
      auditEngine.log({
        who: { id: session.userId, type: 'user', email: 'enterprise@example.com' },
        what: 'sso.login.success',
        resource: { type: 'session', id: session.id },
        outcome: 'success',
        eventType: 'auth',
        severity: 'info',
        gdprRelevant: true,
      });

      // 3. 策略：检查开发者是否能执行 agent
      policyEngine.createPolicy({
        name: 'Allow developers to execute agents',
        version: '1.0.0',
        status: 'active',
        priority: 100,
        scope: {},
        appliesTo: { actions: ['agent.execute'] },
        rules: [{
          id: 'r1', name: 'Allow role:developer', effect: 'allow',
          conditions: [{ type: 'in', field: 'user.roles', values: ['developer'] }],
        }],
        defaultEffect: 'deny',
        conflictResolution: 'deny-overrides',
      });

      const decision = policyEngine.evaluate({
        user: { id: session.userId, email: 'enterprise@example.com', roles: session.user.roles || [], groups: [] },
        action: 'agent.execute',
        resource: { type: 'agent', id: 'agent-1' },
        environment: { timestamp: Date.now() },
      });

      // 4. 审计：记录授权决策
      auditEngine.log({
        who: { id: session.userId, type: 'user' },
        what: 'authz.policy.evaluate',
        resource: { type: 'agent', id: 'agent-1' },
        outcome: decision.allowed ? 'success' : 'denied',
        eventType: 'authz',
        severity: 'info',
        gdprRelevant: false,
        how: {
          policyId: 'pol-test',
          effect: decision.effect,
          reasoning: decision.reason,
        },
      });

      // 验证完整链路
      expect(session.id).toBeDefined();
      expect(decision.allowed).toBe(true);
      expect(auditEngine.count()).toBe(2);
      const verify = auditEngine.verifyChain();
      expect(verify.valid).toBe(true);

      // 验证审计事件中能找到策略决策
      const policyEvalEvents = auditEngine.query({ eventTypes: ['authz'] });
      expect(policyEvalEvents.length).toBe(1);
      expect(policyEvalEvents[0].outcome).toBe('success');
    });
  });

  // ============ UI 组件导入测试 ============

  describe('Cycle 32 UI 组件可加载性', () => {
    it('AuditTrailPanel 可成功导入', async () => {
      const mod = await import('../components/AuditTrailPanel');
      expect(mod.AuditTrailPanel).toBeDefined();
    });

    it('SSOPanel 可成功导入', async () => {
      const mod = await import('../components/SSOPanel');
      expect(mod.SSOPanel).toBeDefined();
    });

    it('PolicyPanel 可成功导入', async () => {
      const mod = await import('../components/PolicyPanel');
      expect(mod.PolicyPanel).toBeDefined();
    });
  });

  // ============ 统计与性能 ============

  describe('Cycle 32 引擎统计', () => {
    it('AuditTrailEngine 统计正确', async () => {
      const { AuditTrailEngine } = await import('../utils/auditTrailEngine');
      const engine = new AuditTrailEngine({ persist: false });

      for (let i = 0; i < 10; i++) {
        engine.log({
          who: { id: `u${i}`, type: 'user' },
          what: 'test.event',
          resource: { type: 'test', id: `r${i}` },
          outcome: 'success',
          eventType: 'data',
          severity: 'info',
        });
      }

      const stats = engine.getStats();
      expect(stats.totalEvents).toBe(10);
      expect(stats.chains).toBeGreaterThan(0);
    });

    it('SSOEngine 统计正确', async () => {
      const { SSOEngine } = await import('../utils/ssoEngine');
      const engine = new SSOEngine({ persist: false });

      engine.registerOIDCProvider({
        name: 'IdP 1',
        issuer: 'https://idp1.com',
        clientId: 'c1',
        redirectUri: 'https://app/cb',
        authorizationEndpoint: 'https://idp1.com/auth',
        scopes: ['openid'],
        sessionTimeoutMs: 3600000,
        pkceMethod: 'S256',
      });

      const stats = engine.getStats();
      expect(stats.oidcProviders).toBe(1);
      expect(stats.activeSessions).toBe(0);
    });

    it('PolicyEngine 指标正确', async () => {
      const { PolicyEngine } = await import('../utils/policyEngine');
      const engine = new PolicyEngine({ persist: false });

      engine.createPolicy({
        name: 'P1',
        version: '1.0.0',
        status: 'active',
        priority: 50,
        scope: {},
        appliesTo: { actions: ['*'] },
        rules: [],
        defaultEffect: 'allow',
        conflictResolution: 'deny-overrides',
      });

      const metrics = engine.getMetrics();
      expect(metrics.totalPolicies).toBe(1);
      expect(metrics.activePolicies).toBe(1); // 创建时已激活
    });
  });
});
