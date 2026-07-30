/**
 * SSO Engine - 单元测试 (Cycle 32 G32-02)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SSOEngine,
  SSOLibraryError,
  generateCodeVerifier,
  generateCodeChallenge,
  base64URLEncode,
  base64URLDecode,
  parseJWT,
  verifyJWTClaims,
  generateSessionId,
  generateState,
  generateNonce,
  generateUserId,
  DEFAULT_SSO_CONFIG,
  getDefaultSSOEngine,
  setDefaultSSOEngine,
  type OIDCConfig,
  type SAMLConfig,
  type SCIMConfig,
  type SSOSession,
} from './ssoEngine';

// ============ 辅助函数 ============

function makeOIDCConfig(overrides: Partial<OIDCConfig> = {}): OIDCConfig {
  return {
    id: 'oidc-okta',
    name: 'Okta Test',
    type: 'oidc',
    providerType: 'okta',
    enabled: true,
    priority: 100,
    issuer: 'https://test.okta.com',
    clientId: 'client-123',
    clientSecret: 'secret',
    redirectUri: 'https://app.example.com/callback',
    authorizationEndpoint: 'https://test.okta.com/oauth2/v1/authorize',
    tokenEndpoint: 'https://test.okta.com/oauth2/v1/token',
    userinfoEndpoint: 'https://test.okta.com/oauth2/v1/userinfo',
    jwksUri: 'https://test.okta.com/oauth2/v1/keys',
    endSessionEndpoint: 'https://test.okta.com/oauth2/v1/logout',
    scopes: ['openid', 'profile', 'email'],
    pkceMethod: 'S256',
    responseType: 'code',
    responseMode: 'query',
    tokenEndpointAuthMethod: 'client_secret_basic',
    sessionTimeoutMs: 3600000,
    refreshTokenRotation: true,
    enableUserInfoRefresh: false,
    claimMapping: {
      sub: 'sub',
      email: 'email',
      name: 'name',
    },
    clockSkewSeconds: 30,
    ...overrides,
  };
}

function makeSAMLConfig(overrides: Partial<SAMLConfig> = {}): SAMLConfig {
  return {
    id: 'saml-azure',
    name: 'Azure SAML',
    type: 'saml',
    providerType: 'azure-ad',
    enabled: true,
    priority: 100,
    entityId: 'https://app.example.com/saml',
    assertionConsumerServiceURL: 'https://app.example.com/saml/acs',
    idpEntityId: 'https://sts.windows.net/test',
    idpSsoURL: 'https://login.microsoftonline.com/test/saml2',
    idpSloURL: 'https://login.microsoftonline.com/test/saml2/logout',
    idpX509Cert: '-----BEGIN CERTIFICATE-----\nMIIT...\n-----END CERTIFICATE-----',
    nameIdFormat: 'emailAddress',
    signRequests: true,
    signAssertions: false,
    encryptAssertions: false,
    signingAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    attributeMapping: {
      email: 'email',
      name: 'displayName',
      firstName: 'givenName',
      lastName: 'sn',
    },
    binding: 'HTTP-POST',
    wantAssertionsSigned: true,
    wantResponseSigned: true,
    sessionTimeoutMs: 3600000,
    clockSkewSeconds: 30,
    ...overrides,
  };
}

function makeSCIMConfig(overrides: Partial<SCIMConfig> = {}): SCIMConfig {
  return {
    id: 'scim-okta',
    name: 'SCIM Okta',
    type: 'scim',
    enabled: true,
    direction: 'inbound',
    clientConfig: {
      endpoint: 'https://test.okta.com/api/v1/scim/v2',
      bearerToken: 'token-123',
    },
    userMapping: {
      externalId: 'externalId',
      userName: 'userName',
      email: 'emails[type eq "work"].value',
      emailType: 'work',
      givenName: 'name.givenName',
      familyName: 'name.familyName',
    },
    enableAutoSync: false,
    syncOnUserCreate: true,
    syncOnUserUpdate: true,
    syncOnUserDelete: true,
    ...overrides,
  };
}

describe('SSOEngine - 工具函数', () => {
  it('generateCodeVerifier 长度 43', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('generateCodeChallenge S256', () => {
    const verifier = 'test-verifier-12345678901234567890123456789012';
    const challenge = generateCodeChallenge(verifier, 'S256');
    expect(challenge).toBeDefined();
    expect(challenge.length).toBeGreaterThan(0);
  });

  it('base64URLEncode/Decode', () => {
    const original = 'Hello World!';
    const encoded = base64URLEncode(original);
    const decoded = base64URLDecode(encoded);
    expect(decoded).toBe(original);
  });

  it('parseJWT 有效', () => {
    const payload = { sub: '123', name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = `header.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.signature`;
    const parsed = parseJWT(token);
    expect(parsed).toBeDefined();
    expect(parsed!.sub).toBe('123');
  });

  it('parseJWT 无效格式', () => {
    expect(parseJWT('not-a-jwt')).toBeNull();
    expect(parseJWT('a.b')).toBeNull();
  });

  it('verifyJWTClaims 验证通过', () => {
    const payload = {
      sub: '123',
      iss: 'https://test.com',
      aud: 'client-123',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;
    const result = verifyJWTClaims(token, { issuer: 'https://test.com', audience: 'client-123' });
    expect(result.valid).toBe(true);
  });

  it('verifyJWTClaims 过期', () => {
    const payload = {
      sub: '123',
      iss: 'https://test.com',
      aud: 'client-123',
      exp: Math.floor(Date.now() / 1000) - 100,
    };
    const token = `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;
    const result = verifyJWTClaims(token, { issuer: 'https://test.com', audience: 'client-123' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('verifyJWTClaims issuer 不匹配', () => {
    const payload = {
      sub: '123',
      iss: 'https://wrong.com',
      aud: 'client-123',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;
    const result = verifyJWTClaims(token, { issuer: 'https://test.com', audience: 'client-123' });
    expect(result.valid).toBe(false);
  });

  it('verifyJWTClaims audience 不匹配', () => {
    const payload = {
      sub: '123',
      iss: 'https://test.com',
      aud: 'wrong-aud',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;
    const result = verifyJWTClaims(token, { issuer: 'https://test.com', audience: 'client-123' });
    expect(result.valid).toBe(false);
  });

  it('generateSessionId 格式', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^sess-/);
  });

  it('generateState 格式', () => {
    const state = generateState();
    expect(state).toMatch(/^state-/);
  });

  it('generateNonce 格式', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^nonce-/);
  });

  it('generateUserId 格式', () => {
    const id = generateUserId();
    expect(id).toMatch(/^user-/);
  });
});

describe('SSOEngine - 初始化', () => {
  it('默认实例化', () => {
    const engine = new SSOEngine({ persist: false });
    expect(engine).toBeDefined();
  });

  it('全局单例', () => {
    const e1 = getDefaultSSOEngine();
    const e2 = getDefaultSSOEngine();
    expect(e1).toBe(e2);
  });
});

describe('SSOEngine - IdP 管理', () => {
  let engine: SSOEngine;
  beforeEach(() => {
    engine = new SSOEngine({ persist: false });
  });

  it('registerOIDCProvider', () => {
    const config = makeOIDCConfig();
    const registered = engine.registerOIDCProvider(config);
    expect(registered.id).toBe(config.id);
    expect(engine.listOIDCProviders().length).toBe(1);
  });

  it('registerSAMLProvider', () => {
    const config = makeSAMLConfig();
    const registered = engine.registerSAMLProvider(config);
    expect(registered.id).toBe(config.id);
    expect(engine.listSAMLProviders().length).toBe(1);
  });

  it('registerSCIMConfig', () => {
    const config = makeSCIMConfig();
    const registered = engine.registerSCIMConfig(config);
    expect(registered.id).toBe(config.id);
    expect(engine.listSCIMConfigs().length).toBe(1);
  });

  it('unregisterProvider', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.unregisterProvider('oidc-okta');
    expect(engine.listOIDCProviders().length).toBe(0);
  });

  it('getOIDCProvider', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    expect(engine.getOIDCProvider('oidc-okta')).toBeDefined();
    expect(engine.getOIDCProvider('nonexistent')).toBeUndefined();
  });

  it('getSAMLProvider', () => {
    engine.registerSAMLProvider(makeSAMLConfig());
    expect(engine.getSAMLProvider('saml-azure')).toBeDefined();
  });

  it('getSCIMConfig', () => {
    engine.registerSCIMConfig(makeSCIMConfig());
    expect(engine.getSCIMConfig('scim-okta')).toBeDefined();
  });

  it('updateProvider', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.updateProvider('oidc-okta', { priority: 50 });
    const p = engine.getOIDCProvider('oidc-okta');
    expect(p!.priority).toBe(50);
  });

  it('listOIDCProviders 按 priority 排序', () => {
    engine.registerOIDCProvider(makeOIDCConfig({ id: 'a', name: 'A', priority: 200 }));
    engine.registerOIDCProvider(makeOIDCConfig({ id: 'b', name: 'B', priority: 100 }));
    const list = engine.listOIDCProviders();
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  it('配置变更触发 provider-registered 事件', () => {
    const engine2 = new SSOEngine({ persist: false });
    let received = 0;
    engine2.on('provider-registered', () => received++);
    engine2.registerOIDCProvider(makeOIDCConfig());
    expect(received).toBe(1);
  });
});

describe('SSOEngine - OIDC 流程', () => {
  let engine: SSOEngine;
  beforeEach(() => {
    engine = new SSOEngine({ persist: false });
    engine.registerOIDCProvider(makeOIDCConfig());
  });

  it('buildAuthorizationURL 包含必需参数', () => {
    const req = engine.buildAuthorizationURL('oidc-okta');
    expect(req.url).toContain('https://test.okta.com/oauth2/v1/authorize');
    expect(req.url).toContain('client_id=client-123');
    expect(req.url).toContain('response_type=code');
    expect(req.url).toContain('code_challenge=');
    expect(req.url).toContain('code_challenge_method=S256');
    expect(req.url).toContain('state=');
    expect(req.url).toContain('nonce=');
    expect(req.state).toMatch(/^state-/);
    expect(req.codeVerifier).toBeDefined();
    expect(req.nonce).toMatch(/^nonce-/);
  });

  it('buildAuthorizationURL 不存在的 provider', () => {
    expect(() => engine.buildAuthorizationURL('nonexistent')).toThrow(SSOLibraryError);
  });

  it('buildAuthorizationURL 禁用的 provider', () => {
    engine.registerOIDCProvider(makeOIDCConfig({ id: 'disabled', name: 'Disabled', enabled: false, authorizationEndpoint: 'https://x.com' }));
    expect(() => engine.buildAuthorizationURL('disabled')).toThrow(SSOLibraryError);
  });

  it('buildAuthorizationURL 缺少 authorizationEndpoint', () => {
    engine.registerOIDCProvider(makeOIDCConfig({ id: 'no-endpoint', name: 'No Endpoint', authorizationEndpoint: undefined }));
    expect(() => engine.buildAuthorizationURL('no-endpoint')).toThrow(SSOLibraryError);
  });

  it('buildAuthorizationURL 包含 prompt 和 login_hint', () => {
    const req = engine.buildAuthorizationURL('oidc-okta', { prompt: 'login', loginHint: 'alice@example.com' });
    expect(req.url).toContain('prompt=login');
    expect(req.url).toContain('login_hint=alice%40example.com');
  });

  it('endSession', () => {
    const url = engine.endSession('id-token-here', 'oidc-okta');
    expect(url).toContain('https://test.okta.com/oauth2/v1/logout');
    expect(url).toContain('id_token_hint=id-token-here');
  });

  it('endSession 无 endSessionEndpoint 返回空', () => {
    engine.registerOIDCProvider(makeOIDCConfig({ id: 'no-slo', name: 'No SLO', endSessionEndpoint: undefined }));
    const url = engine.endSession('id', 'no-slo');
    expect(url).toBe('');
  });
});

describe('SSOEngine - Session 管理', () => {
  let engine: SSOEngine;
  beforeEach(() => {
    engine = new SSOEngine({ persist: false });
  });

  it('createSession', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    const session = engine.createSession('oidc-okta', {
      accessToken: 'a1',
      idToken: 'i1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + 3600000,
    }, {
      id: 'u1',
      ssoId: 'sub1',
      email: 'test@example.com',
      emailVerified: true,
      roles: ['user'],
      groups: [],
      attributes: {},
    });
    expect(session.id).toMatch(/^sess-/);
    expect(session.status).toBe('active');
  });

  it('getSession', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    const session = engine.createSession('oidc-okta', {
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    const found = engine.getSession(session.id);
    expect(found).toBeDefined();
    expect(found!.userId).toBe('u1');
  });

  it('getActiveSession', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.createSession('oidc-okta', {
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    const found = engine.getActiveSession('u1');
    expect(found).toBeDefined();
  });

  it('listSessions', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.createSession('oidc-okta', {
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    expect(engine.listSessions().length).toBe(1);
    expect(engine.listSessions('u1').length).toBe(1);
    expect(engine.listSessions('u2').length).toBe(0);
  });

  it('updateActivity', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    const session = engine.createSession('oidc-okta', {
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    const before = session.lastActivityAt;
    engine.updateActivity(session.id);
    expect(session.lastActivityAt).toBeGreaterThanOrEqual(before);
  });

  it('validateSession 有效', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    const session = engine.createSession('oidc-okta', {
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    const result = engine.validateSession(session.id);
    expect(result.valid).toBe(true);
  });

  it('validateSession 过期', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    const session = engine.createSession('oidc-okta', {
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() - 1000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    const result = engine.validateSession(session.id);
    expect(result.valid).toBe(false);
  });

  it('validateSession 不存在', () => {
    const result = engine.validateSession('nonexistent');
    expect(result.valid).toBe(false);
  });

  it('revokeSession', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    const session = engine.createSession('oidc-okta', {
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    engine.revokeSession(session.id, 'user-request');
    expect(session.status).toBe('revoked');
    expect(session.revokedReason).toBe('user-request');
  });

  it('revokeAllSessions', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.createSession('oidc-okta', {
      accessToken: 'a1', tokenType: 'Bearer', expiresIn: 3600, expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    engine.createSession('oidc-okta', {
      accessToken: 'a2', tokenType: 'Bearer', expiresIn: 3600, expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    const count = engine.revokeAllSessions('u1');
    expect(count).toBe(2);
  });

  it('logout 触发 slo-initiated', () => {
    engine.registerOIDCProvider(makeOIDCConfig());
    const session = engine.createSession('oidc-okta', {
      accessToken: 'a1', idToken: 'i1', tokenType: 'Bearer', expiresIn: 3600, expiresAt: Date.now() + 3600000,
    }, { id: 'u1', ssoId: 's', email: 'a@b.c', emailVerified: true, roles: [], groups: [], attributes: {} });
    let sloTriggered = false;
    engine.on('slo-initiated', () => sloTriggered = true);
    return engine.logout(session.id).then(() => {
      expect(sloTriggered).toBe(true);
    });
  });
});

describe('SSOEngine - SAML 流程', () => {
  let engine: SSOEngine;
  beforeEach(() => {
    engine = new SSOEngine({ persist: false });
    engine.registerSAMLProvider(makeSAMLConfig());
  });

  it('buildSAMLRequest 包含必需参数', () => {
    const req = engine.buildSAMLRequest('saml-azure');
    expect(req.samlRequest).toBeDefined();
    expect(req.url).toContain('SAMLRequest=');
    expect(req.url).toContain('RelayState=');
  });

  it('buildSAMLRequest 不存在的 provider', () => {
    expect(() => engine.buildSAMLRequest('nonexistent')).toThrow(SSOLibraryError);
  });

  it('buildSAMLRequest forceAuthn', () => {
    const req = engine.buildSAMLRequest('saml-azure', { forceAuthn: true });
    expect(req.samlRequest).toBeDefined();
  });

  it('processSAMLResponse 成功', async () => {
    const samlResponse = btoa(`<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
      <saml:Assertion>
        <saml:AttributeStatement>
          <saml:Attribute Name="email"><saml:AttributeValue>alice@example.com</saml:AttributeValue></saml:Attribute>
          <saml:Attribute Name="displayName"><saml:AttributeValue>Alice Smith</saml:AttributeValue></saml:Attribute>
          <saml:Attribute Name="givenName"><saml:AttributeValue>Alice</saml:AttributeValue></saml:Attribute>
          <saml:Attribute Name="sn"><saml:AttributeValue>Smith</saml:AttributeValue></saml:Attribute>
        </saml:AttributeStatement>
      </saml:Assertion>
    </samlp:Response>`);
    const result = await engine.processSAMLResponse(samlResponse, 'saml-azure');
    expect(result.user.email).toBe('alice@example.com');
    expect(result.user.name).toBe('Alice Smith');
  });

  it('processSAMLResponse 缺少 email', async () => {
    const samlResponse = btoa(`<samlp:Response><saml:Assertion></saml:Assertion></samlp:Response>`);
    await expect(engine.processSAMLResponse(samlResponse, 'saml-azure')).rejects.toThrow(SSOLibraryError);
  });

  it('buildSAMLLogoutRequest', () => {
    const session: SSOSession = {
      id: 'sess-1',
      userId: 'u1',
      ssoId: 'alice@example.com',
      providerId: 'saml-azure',
      providerType: 'saml',
      tokenType: 'SAML',
      expiresAt: Date.now() + 3600000,
      user: { id: 'u1', ssoId: 'alice@example.com', email: 'alice@example.com', emailVerified: true, roles: [], groups: [], attributes: {} },
      claims: {},
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      mfaAuthenticated: false,
      status: 'active',
    };
    const req = engine.buildSAMLLogoutRequest(session);
    expect(req).toBeDefined();
    expect(req!.url).toContain('SAMLRequest=');
  });

  it('buildSAMLLogoutRequest 无 SLO 返回 null', () => {
    engine.registerSAMLProvider(makeSAMLConfig({ id: 'no-slo', name: 'No SLO', idpSloURL: undefined }));
    const session: any = { providerId: 'no-slo', user: { ssoId: 'a' } };
    const req = engine.buildSAMLLogoutRequest(session as any);
    expect(req).toBeNull();
  });
});

describe('SSOEngine - SCIM 服务端', () => {
  let engine: SSOEngine;
  beforeEach(() => {
    engine = new SSOEngine({ persist: false });
    engine.registerSCIMConfig(makeSCIMConfig());
  });

  it('scimCreateUser', () => {
    const user = engine.scimCreateUser('scim-okta', {
      userName: 'alice@example.com',
      name: { givenName: 'Alice', familyName: 'Smith' },
      emails: [{ value: 'alice@example.com', type: 'work' }],
      active: true,
    });
    expect(user.id).toBeDefined();
    expect(user.userName).toBe('alice@example.com');
  });

  it('scimGetUser', () => {
    const user = engine.scimCreateUser('scim-okta', { userName: 'alice@example.com' });
    expect(engine.scimGetUser('scim-okta', user.id!)).toBeDefined();
    expect(engine.scimGetUser('scim-okta', 'nonexistent')).toBeNull();
  });

  it('scimListUsers', () => {
    engine.scimCreateUser('scim-okta', { userName: 'a@example.com' });
    engine.scimCreateUser('scim-okta', { userName: 'b@example.com' });
    const result = engine.scimListUsers('scim-okta');
    expect(result.totalResults).toBe(2);
    expect(result.Resources.length).toBe(2);
  });

  it('scimListUsers with filter', () => {
    engine.scimCreateUser('scim-okta', { userName: 'alice@example.com' });
    engine.scimCreateUser('scim-okta', { userName: 'bob@example.com' });
    const result = engine.scimListUsers('scim-okta', 'userName eq "alice@example.com"');
    expect(result.totalResults).toBe(1);
  });

  it('scimUpdateUser', () => {
    const user = engine.scimCreateUser('scim-okta', { userName: 'alice@example.com', active: true });
    const updated = engine.scimUpdateUser('scim-okta', user.id!, [
      { op: 'replace', value: { active: false } },
    ]);
    expect(updated.active).toBe(false);
  });

  it('scimDeleteUser', () => {
    const user = engine.scimCreateUser('scim-okta', { userName: 'alice@example.com' });
    engine.scimDeleteUser('scim-okta', user.id!);
    expect(engine.scimGetUser('scim-okta', user.id!)).toBeNull();
  });
});

describe('SSOEngine - 审计集成', () => {
  it('setAuditTrailHook 接收 login 事件', () => {
    const engine = new SSOEngine({ persist: false });
    const events: any[] = [];
    engine.setAuditTrailHook((event, data) => events.push({ event, data }));
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.buildAuthorizationURL('oidc-okta');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe('sso.login-started');
  });
});

describe('SSOEngine - 事件订阅', () => {
  it('订阅与退订', () => {
    const engine = new SSOEngine({ persist: false });
    let count = 0;
    const unsub = engine.on('login-started', () => count++);
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.buildAuthorizationURL('oidc-okta');
    expect(count).toBe(1);
    unsub();
    engine.buildAuthorizationURL('oidc-okta');
    expect(count).toBe(1);
  });
});

describe('SSOEngine - 错误处理', () => {
  it('SSOLibraryError 序列化', () => {
    const err = new SSOLibraryError('INVALID_STATE', 'test', { foo: 'bar' });
    expect(err.code).toBe('INVALID_STATE');
    expect(err.toJSON()).toEqual({ code: 'INVALID_STATE', message: 'test', details: { foo: 'bar' } });
  });

  it('getStats', () => {
    const engine = new SSOEngine({ persist: false });
    const stats = engine.getStats();
    expect(stats.activeSessions).toBe(0);
    expect(stats.oidcProviders).toBe(0);
  });

  it('updateConfig', () => {
    const engine = new SSOEngine({ persist: false });
    engine.updateConfig({ maxSessionsPerUser: 10 });
    expect(engine.getConfig().maxSessionsPerUser).toBe(10);
  });

  it('clear', () => {
    const engine = new SSOEngine({ persist: false });
    engine.registerOIDCProvider(makeOIDCConfig());
    engine.clear();
    expect(engine.getStats().oidcProviders).toBe(0);
  });
});
