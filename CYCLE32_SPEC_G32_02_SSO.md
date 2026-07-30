# G32-02 SPEC: SSO / OIDC / SAML Engine 单点登录引擎

**任务编号**：G32-02
**版本**：v6.90.0
**优先级**：P0
**日期**：2026-07-30
**状态**：🟡 设计阶段
**依赖**：G32-01 (Audit Trail)
**被依赖**：所有需要身份认证的功能

---

## 一、目标

实现企业级**单点登录 (SSO) 引擎**，支持 OIDC / OAuth 2.0 / SAML 2.0 / SCIM 2.0 四大协议，覆盖 Okta / Auth0 / Azure AD / Google Workspace 主流 IdP，建立 Hermes 在企业级 SaaS 市场的身份准入能力。

---

## 二、设计原则

1. **多协议支持**：OIDC（主推）+ SAML（兼容）+ SCIM（自动配置）
2. **多 IdP**：运行时切换 + 并行支持
3. **安全第一**：PKCE 强制 + State 防 CSRF + Nonce 防重放
4. **标准优先**：遵循 RFC 6749/6750/7636/8414 + OpenID Connect Core 1.0 + SCIM 2.0 (RFC 7642-7644)
5. **可扩展**：插件化 IdP 配置 + 自定义 Claim 映射
6. **可观测**：所有登录事件写入 Audit Trail (G32-01)
7. **可回放**：Session 状态完整持久化 + SLO 支持

---

## 三、核心类型定义

### 3.1 OIDC

```typescript
export interface OIDCConfig {
  // 基本
  id: string;                    // sso-oidc-<name>
  name: string;                  // "Okta Production"
  enabled: boolean;
  priority: number;              // 多 IdP 优先级

  // OIDC 标准
  issuer: string;                // https://<tenant>.okta.com
  clientId: string;
  clientSecret?: string;         // Confidential Client 必需
  redirectUri: string;
  postLogoutRedirectUri?: string;

  // 端点（可自动发现）
  discoveryUrl?: string;         // ${issuer}/.well-known/openid-configuration
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  endSessionEndpoint?: string;
  introspectionEndpoint?: string;
  revocationEndpoint?: string;

  // Scope & Claims
  scopes: string[];              // ['openid', 'profile', 'email']
  extraScopes?: string[];
  claimMapping: ClaimMapping;

  // 安全
  pkceMethod: 'S256' | 'plain';  // 默认 S256
  responseType: 'code' | 'id_token' | 'code id_token';
  responseMode: 'query' | 'fragment' | 'form_post';
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
  prompt?: 'none' | 'login' | 'consent' | 'select_account';

  // Session
  sessionTimeoutMs: number;      // 默认 3600000 (1 hour)
  refreshTokenRotation: boolean;
  inactivityTimeoutMs?: number;

  // 高级
  allowedAlgorithms?: string[];  // ['RS256', 'ES256']
  clockSkewSeconds?: number;     // 默认 30
  enableUserInfoRefresh: boolean;
}

export interface ClaimMapping {
  // 必需映射
  sub: string;                   // 通常 'sub'
  email: string;                 // 'email' or 'preferred_username'
  emailVerified?: string;
  name?: string;                 // 'name'
  givenName?: string;            // 'given_name'
  familyName?: string;           // 'family_name'
  picture?: string;              // 'picture'
  locale?: string;
  zoneinfo?: string;
  // 自定义映射
  custom?: Record<string, string>;
}
```

### 3.2 SAML 2.0

```typescript
export interface SAMLConfig {
  // 基本
  id: string;
  name: string;
  enabled: boolean;
  priority: number;

  // SP (Service Provider) 信息
  entityId: string;              // SP 唯一标识
  assertionConsumerServiceURL: string;  // ACS 回调
  singleLogoutServiceURL?: string;

  // IdP (Identity Provider) 信息
  idpEntityId: string;
  idpSsoURL: string;             // SSO 端点
  idpSloURL?: string;            // SLO 端点
  idpX509Cert: string;           // PEM 格式证书

  // NameID
  nameIdFormat: 'emailAddress' | 'persistent' | 'transient' | 'unspecified';
  allowCreate?: boolean;

  // 签名 & 加密
  signRequests: boolean;
  signAssertions: boolean;
  encryptAssertions: boolean;
  signingAlgorithm: 'sha1' | 'sha256' | 'sha512';
  digestAlgorithm: 'sha1' | 'sha256' | 'sha512';
  spPrivateKey?: string;         // PEM
  spCertificate?: string;        // PEM

  // 加密（断言加密）
  idpPrivateKey?: string;        // 用于加密
  encryptionAlgorithm?: 'aes128-cbc' | 'aes192-cbc' | 'aes256-cbc';

  // 属性映射
  attributeMapping: SAMLAttributeMapping;

  // 流程
  binding: 'HTTP-Redirect' | 'HTTP-POST';
  wantAssertionsSigned: boolean;
  wantResponseSigned: boolean;
  audienceRestriction?: string;

  // Session
  sessionTimeoutMs: number;
  clockSkewSeconds?: number;
}

export interface SAMLAttributeMapping {
  email: string;                 // 'email' or 'urn:oid:0.9.2342.19200300.100.1.3'
  name?: string;                 // 'displayName' or 'urn:oid:2.16.840.1.113730.3.1.241'
  firstName?: string;            // 'givenName' or 'urn:oid:2.5.4.42'
  lastName?: string;             // 'sn' or 'urn:oid:2.5.4.4'
  groups?: string;               // 'memberOf' or 'urn:oid:1.3.6.1.4.1.5923.1.5.1.1'
  role?: string;
  custom?: Record<string, string>;
}
```

### 3.3 SCIM 2.0

```typescript
export interface SCIMConfig {
  id: string;
  name: string;
  enabled: boolean;
  direction: 'inbound' | 'outbound' | 'bidirectional';

  // 服务端（Hermes 作为 SCIM Server）
  serverConfig?: {
    baseUrl: string;             // https://api.hermes.com/scim/v2
    bearerToken: string;         // IdP 配置时使用
    supportedSchemas: string[];  // ['urn:ietf:params:scim:schemas:core:2.0:User']
  };

  // 客户端（Hermes 作为 SCIM Client）
  clientConfig?: {
    endpoint: string;            // https://idp.example.com/scim/v2
    bearerToken: string;
    filter?: string;             // SCIM filter expression
    attributes?: string[];
    excludedAttributes?: string[];
  };

  // 字段映射
  userMapping: SCIMUserMapping;
  groupMapping?: SCIMGroupMapping;

  // 同步
  syncIntervalMs?: number;       // 周期性同步间隔
  enableAutoSync: boolean;       // 接收 IdP 推送
  syncOnUserCreate: boolean;
  syncOnUserUpdate: boolean;
  syncOnUserDelete: boolean;

  // 事件
  emitEvents: boolean;
}

export interface SCIMUserMapping {
  externalId: string;            // 'externalId'
  userName: string;              // 'userName' (email)
  email: string;                 // 'emails[type eq "work"].value'
  emailType: 'work' | 'home' | 'other';
  givenName: string;             // 'name.givenName'
  familyName: string;            // 'name.familyName'
  displayName?: string;          // 'displayName'
  active?: string;               // 'active'
  groups?: string;               // 'groups'
  custom?: Record<string, string>;
}
```

### 3.4 Session

```typescript
export interface SSOSession {
  id: string;                    // sess-<random>
  userId: string;                // Hermes 内部用户 ID
  ssoId: string;                 // SSO 唯一标识（sub）
  providerId: string;            // 引用的 OIDCConfig / SAMLConfig
  providerType: 'oidc' | 'saml';

  // Token
  idToken?: string;              // JWT (OIDC)
  accessToken?: string;
  refreshToken?: string;
  tokenType: 'Bearer';
  expiresAt: number;             // ms epoch
  refreshExpiresAt?: number;
  scope?: string[];

  // 用户信息
  user: SSOSessionUser;
  claims: Record<string, any>;   // 完整 claims

  // Session
  createdAt: number;
  lastActivityAt: number;
  ipAddress?: string;
  userAgent?: string;
  mfaAuthenticated: boolean;

  // 状态
  status: 'active' | 'expired' | 'revoked' | 'logged_out';
  revokedReason?: string;
}

export interface SSOSessionUser {
  id: string;                    // Hermes 内部 ID
  ssoId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
  locale?: string;
  roles: string[];               // 从 claims / groups 映射
  groups: string[];
  attributes: Record<string, any>;
}
```

---

## 四、核心 API

### 4.1 引擎主类

```typescript
export class SSOEngine {
  // 初始化
  constructor(config?: Partial<SSOEngineConfig>);
  static getInstance(): SSOEngine;

  // IdP 管理
  registerOIDCProvider(config: OIDCConfig): OIDCConfig;
  registerSAMLProvider(config: SAMLConfig): SAMLConfig;
  registerSCIMConfig(config: SCIMConfig): SCIMConfig;
  unregisterProvider(providerId: string): void;
  listProviders(): { oidc: OIDCConfig[]; saml: SAMLConfig[]; scim: SCIMConfig[] };
  getProvider(providerId: string): OIDCConfig | SAMLConfig | SCIMConfig | undefined;
  updateProvider(providerId: string, updates: Partial<OIDCConfig | SAMLConfig | SCIMConfig>): void;

  // OIDC 流程
  buildAuthorizationURL(providerId: string, options?: { state?: string; nonce?: string; acrValues?: string; loginHint?: string; prompt?: string }): { url: string; state: string; codeVerifier: string; nonce: string };
  exchangeCodeForTokens(providerId: string, code: string, codeVerifier: string): Promise<TokenSet>;
  refreshTokens(refreshToken: string, providerId: string): Promise<TokenSet>;
  revokeToken(token: string, providerId: string, tokenType: 'access_token' | 'refresh_token'): Promise<void>;
  getUserInfo(accessToken: string, providerId: string): Promise<Record<string, any>>;
  endSession(idTokenHint: string, providerId: string, postLogoutRedirectUri?: string): string;

  // SAML 流程
  buildSAMLRequest(providerId: string, options?: { relayState?: string; forceAuthn?: boolean }): { url: string; samlRequest: string; relayState: string };
  processSAMLResponse(samlResponse: string, providerId: string): Promise<{ session: SSOSession; relayState?: string }>;
  buildSAMLLogoutRequest(session: SSOSession): { url: string; samlRequest: string };
  processSAMLLogoutResponse(samlResponse: string, providerId: string): Promise<void>;

  // Session 管理
  createSession(providerId: string, tokens: TokenSet, user: SSOSessionUser): SSOSession;
  getSession(sessionId: string): SSOSession | undefined;
  getActiveSession(userId: string): SSOSession | undefined;
  listSessions(userId?: string): SSOSession[];
  refreshSession(sessionId: string): Promise<SSOSession>;
  updateActivity(sessionId: string): void;
  validateSession(sessionId: string): { valid: boolean; reason?: string; session?: SSOSession };
  revokeSession(sessionId: string, reason?: string): void;
  revokeAllSessions(userId: string, reason?: string): number;
  logout(sessionId: string, options?: { singleLogout?: boolean }): Promise<void>;

  // SCIM 服务端
  scimListUsers(providerId: string, filter?: string, startIndex?: number, count?: number): Promise<SCIMListResponse<SCIMUser>>;
  scimGetUser(providerId: string, userId: string): Promise<SCIMUser | null>;
  scimCreateUser(providerId: string, user: SCIMUser): Promise<SCIMUser>;
  scimUpdateUser(providerId: string, userId: string, updates: SCIMPatchOp[]): Promise<SCIMUser>;
  scimDeleteUser(providerId: string, userId: string): Promise<void>;
  scimListGroups(providerId: string, filter?: string): Promise<SCIMListResponse<SCIMGroup>>;

  // SCIM 客户端
  scimSyncUsers(providerId: string): Promise<{ added: number; updated: number; removed: number }>;
  scimPushUser(providerId: string, user: SSOSessionUser): Promise<SCIMUser>;
  scimRemoveUser(providerId: string, ssoId: string): Promise<void>;

  // Discovery
  discoverOIDC(issuer: string): Promise<OIDCDiscovery>;

  // 事件
  on(event: SSOEventType, listener: (e: SSOEvent) => void): () => void;

  // 配置
  getConfig(): SSOEngineConfig;
  updateConfig(config: Partial<SSOEngineConfig>): void;
}
```

### 4.2 事件类型

```typescript
export type SSOEventType =
  | 'provider-registered'
  | 'provider-updated'
  | 'provider-unregistered'
  | 'login-started'
  | 'login-success'
  | 'login-failed'
  | 'logout-started'
  | 'logout-success'
  | 'token-refreshed'
  | 'token-expired'
  | 'session-created'
  | 'session-revoked'
  | 'session-expired'
  | 'slo-initiated'
  | 'slo-completed'
  | 'scim-user-created'
  | 'scim-user-updated'
  | 'scim-user-deleted'
  | 'scim-sync-completed';
```

---

## 五、关键流程

### 5.1 OIDC 登录流程（Authorization Code + PKCE）

```
┌──────┐                            ┌──────────┐                ┌────────┐
│ User │                            │  Hermes  │                │  IdP   │
└──┬───┘                            └────┬─────┘                └───┬────┘
   │                                    │                          │
   │ 1. Click "Login with Okta"        │                          │
   │───────────────────────────────────>│                          │
   │                                    │                          │
   │                                    │ 2. Generate PKCE         │
   │                                    │    code_verifier         │
   │                                    │    code_challenge = S256  │
   │                                    │    state = random        │
   │                                    │    nonce = random        │
   │                                    │                          │
   │ 3. Redirect to IdP                 │                          │
   │<───────────────────────────────────│                          │
   │                                                            │
   │ 4. User authenticates at IdP                                │
   │─────────────────────────────────────────────────────────────>│
   │                                                            │
   │ 5. IdP redirects back with code + state                    │
   │<────────────────────────────────────────────────────────────│
   │──>│                                                       │
   │    │ 6. Verify state matches                                │
   │    │ 7. Exchange code + verifier for tokens                 │
   │    │──────────────────────────────────────────────────────>│
   │    │                                                       │
   │    │ 8. Receive id_token + access_token + refresh_token    │
   │    │<──────────────────────────────────────────────────────│
   │    │                                                       │
   │    │ 9. Verify id_token signature + claims (nonce, exp)    │
   │    │ 10. Optionally fetch /userinfo                         │
   │    │ 11. Create SSO Session                                 │
   │    │ 12. Emit login-success event                           │
   │    │ 13. Audit log                                          │
   │    │ 14. Redirect to app                                    │
   │<───│                                                       │
```

### 5.2 SAML 登录流程（SP-Initiated）

```
┌──────┐                  ┌──────────┐                     ┌────────┐
│ User │                  │  Hermes  │                     │  IdP   │
└──┬───┘                  └────┬─────┘                     └───┬────┘
   │                           │                               │
   │ 1. Login                  │                               │
   │──────────────────────────>│                               │
   │                           │ 2. Generate SAML AuthnRequest │
   │                           │    + RelayState               │
   │                           │    + Sign request             │
   │                           │                               │
   │ 3. Redirect (POST/Redirect)│                               │
   │<──────────────────────────│                               │
   │                                                       │
   │ 4. POST SAMLRequest to IdP                                │
   │──────────────────────────────────────────────────────>│
   │                                                       │
   │ 5. User authenticates + MFA                               │
   │                                                       │
   │ 6. IdP returns SAML Response (signed assertion)         │
   │<──────────────────────────────────────────────────────│
   │──>│                                                  │
   │    │ 7. Verify IdP signature on assertion              │
   │    │ 8. Verify audience + NotOnOrAfter + NotBefore     │
   │    │ 9. Extract attributes                              │
   │    │ 10. Map to SSOSessionUser                          │
   │    │ 11. Create SSO Session                             │
   │    │ 12. Emit login-success event                       │
   │    │ 13. Audit log                                      │
   │    │ 14. Redirect to app (RelayState)                   │
   │<───│                                                  │
```

### 5.3 SCIM 2.0 同步流程

```
┌──────┐              ┌──────────┐              ┌────────┐
│ IdP  │              │  Hermes  │              │ Users  │
└──┬───┘              └────┬─────┘              └───┬────┘
   │                       │                       │
   │ 1. Create user in IdP │                       │
   │                       │                       │
   │ 2. POST /scim/v2/Users (Bearer token)         │
   │──────────────────────────────────────────────>│
   │                       │                       │
   │                       │ 3. Validate token     │
   │                       │ 4. Map attributes     │
   │                       │ 5. Create local user  │
   │                       │──────────────────────>│
   │                       │                       │
   │                       │ 6. 201 Created         │
   │<──────────────────────────────────────────────│
   │                                                  │
   │ 7. Update user in IdP (e.g. role change)         │
   │                                                  │
   │ 8. PUT /scim/v2/Users/{id}                       │
   │─────────────────────────────────────────────────>│
   │                       │                          │
   │                       │ 9. Update local user     │
   │                                                  │
   │ 10. Delete user in IdP                            │
   │                                                  │
   │ 11. DELETE /scim/v2/Users/{id}                   │
   │─────────────────────────────────────────────────>│
   │                       │                          │
   │                       │ 12. Deactivate + revoke  │
   │                       │     all sessions         │
   │                       │     (keep audit logs)    │
```

### 5.4 SLO (Single Logout) 流程

```
┌──────┐                  ┌──────────┐                  ┌────────┐
│ User │                  │  Hermes  │                  │  IdP   │
└──┬───┘                  └────┬─────┘                  └───┬────┘
   │                           │                             │
   │ 1. Logout                 │                             │
   │──────────────────────────>│                             │
   │                           │ 2. Generate SAML LogoutRequest│
   │                           │    + SessionIndex           │
   │                           │ 3. Redirect to IdP SLO URL  │
   │<──────────────────────────│                             │
   │                                                       │
   │ 4. IdP terminates SSO session                           │
   │                                                       │
   │ 5. IdP returns LogoutResponse                           │
   │<──────────────────────────────────────────────────────│
   │──>│                                                  │
   │    │ 6. Verify response                                 │
   │    │ 7. Revoke local session                            │
   │    │ 8. Audit log                                       │
```

---

## 六、安全特性

### 6.1 Token 处理

- **id_token 验证**：使用 IdP 的 JWKS 验签
- **access_token 缓存**：内存（不持久化到 localStorage）
- **refresh_token 加密存储**：使用 Web Crypto AES-GCM
- **自动刷新**：access_token 过期前 5 分钟自动 refresh
- **PKCE**：强制 S256（防授权码拦截）

### 6.2 CSRF / Replay 防护

- **State 参数**：CSRF token，登录回调时验证
- **Nonce**：防止 ID Token 重放
- **Replay 窗口**：JWT `exp - iat < 86400` (24h)
- **Clock skew**：默认 30 秒容差

### 6.3 SAML 安全

- **XML 签名验证**：使用 `crypto.subtle.verify`
- **XML 加密**：AES-CBC（断言加密）
- **RelayState 验证**：URL 白名单
- **Assertion replay window**：默认 60 秒
- **InResponseTo 验证**：防止请求伪造

### 6.4 速率限制

```typescript
export interface RateLimitConfig {
  loginAttemptsPerWindow: number;   // 默认 5
  loginWindowMs: number;            // 默认 60000 (1 min)
  lockoutDurationMs: number;        // 默认 300000 (5 min)
  tokenRefreshPerMinute: number;    // 默认 10
  enableIPBlock: boolean;
  blockedIPs?: string[];
}
```

---

## 七、错误处理

```typescript
export type SSOErrorCode =
  | 'INVALID_CONFIG'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_DISABLED'
  | 'DISCOVERY_FAILED'
  | 'INVALID_STATE'
  | 'INVALID_NONCE'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'TOKEN_REFRESH_FAILED'
  | 'TOKEN_VERIFICATION_FAILED'
  | 'USERINFO_FAILED'
  | 'SAML_RESPONSE_INVALID'
  | 'SAML_SIGNATURE_INVALID'
  | 'SAML_ASSERTION_EXPIRED'
  | 'SAML_AUDIENCE_MISMATCH'
  | 'RATE_LIMIT_EXCEEDED'
  | 'NETWORK_ERROR'
  | 'STORAGE_ERROR'
  | 'PERMISSION_DENIED';

export class SSOError extends Error {
  constructor(
    public code: SSOErrorCode,
    message: string,
    public details?: Record<string, any>
  );
  toJSON(): { code: SSOErrorCode; message: string; details?: Record<string, any> };
}
```

---

## 八、测试策略

### 8.1 单元测试（35+ 个）

| 类别 | 数量 | 覆盖点 |
|------|------|-------|
| **IdP 管理** | 4 | 注册 OIDC/SAML/SCIM / 注销 / 列表 / 更新 |
| **OIDC 流程** | 6 | URL 构建 / Code 交换 / Token 刷新 / UserInfo / EndSession / PKCE |
| **SAML 流程** | 5 | AuthnRequest / Response 处理 / 签名验证 / SLO / RelayState |
| **Session 管理** | 6 | 创建 / 获取 / 验证 / 刷新 / 撤销 / 列出 |
| **SCIM 服务端** | 4 | List / Get / Create / Update / Delete |
| **SCIM 客户端** | 3 | 同步 / 推送 / 移除 |
| **Discovery** | 2 | OIDC 自动发现 / JWKS 缓存 |
| **安全** | 3 | State 验证 / Nonce 验证 / 速率限制 |
| **错误处理** | 4 | 各种 SSOError 场景 |
| **事件** | 2 | emit 事件 / 多订阅者 |
| **集成** | 2 | 与 Audit Trail 联动 |

### 8.2 E2E 测试

- **完整登录流程**：PKCE 登录 → Token 验证 → Session 创建 → 受保护资源访问
- **SAML 登录流程**：SP-initiated → IdP 模拟 → 断言验证
- **SLO 流程**：注销 → IdP 通知 → Session 清理
- **SCIM 同步**：用户创建 → 推送 → 本地映射 → 验证

### 8.3 Mock IdP

```typescript
class MockOIDCServer {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  setUser(user: OIDCMockUser): void;
  setFailureMode(mode: 'none' | 'token-error' | 'expired'): void;
}
```

---

## 九、UI 组件（SsoPanel）

### 9.1 布局

```
┌──────────────────────────────────────────────────┐
│ SSO / Identity                       [+ Add IdP] │
├──────────────────────────────────────────────────┤
│ Tabs: [Providers] [Sessions] [SCIM] [Audit]      │
├──────────────────────────────────────────────────┤
│ Providers:                                         │
│ ┌──────────────────────────────────────────┐     │
│ │ 🟢 Okta Production (OIDC) [Priority 1]  │     │
│ │    Issuer: https://acme.okta.com        │     │
│ │    Users: 156 | Last login: 2h ago      │     │
│ │    [Test] [Edit] [Disable] [Delete]     │     │
│ └──────────────────────────────────────────┘     │
│ ┌──────────────────────────────────────────┐     │
│ │ 🟢 Azure AD (SAML) [Priority 2]          │     │
│ │    EntityId: https://azure...           │     │
│ │    [Test] [Edit] [Disable] [Delete]     │     │
│ └──────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

### 9.2 功能

1. **IdP 管理** - 注册 OIDC / SAML / SCIM
2. **测试连接** - 验证 IdP 配置
3. **优先级调整** - 多 IdP 排序
4. **Session 监控** - 活跃会话列表
5. **强制登出** - 撤销用户所有会话
6. **SCIM 同步** - 手动触发 + 状态查看
7. **登录审计** - 与 G32-01 联动

---

## 十、依赖

### 10.1 外部依赖

- 无新增 npm 依赖
- 复用：`crypto.subtle` (Web Crypto API) 用于 JWT 验签 + SAML XML-DSig

### 10.2 内部依赖

- **G32-01 Audit Trail** — 登录事件自动审计
- 被依赖：所有需要身份认证的引擎

---

## 十一、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| SAML XML 处理复杂 | 高 | 优先 OIDC，SAML 作 P1 |
| 真实 IdP 测试困难 | 中 | Mock IdP 完整实现 |
| Token 刷新竞争条件 | 中 | mutex + 队列 |
| 跨域 Cookie 问题 | 中 | SameSite=Lax + secure |
| SCIM 同步冲突 | 中 | lastModified 时间戳 + 冲突解决策略 |

---

## 十二、验收标准

1. ✅ OIDC 完整流程（PKCE + 自动发现）100% 通过
2. ✅ SAML 2.0 完整流程（签名验证 + SLO）通过
3. ✅ SCIM 2.0 双向同步通过
4. ✅ 4 种合规标准审计事件自动记录
5. ✅ 单元测试 35+ 全通过
6. ✅ E2E 测试 10+ 全通过
7. ✅ TypeScript 严格模式 0 错误

---

**G32-02 SPEC 状态**：✅ 设计完成，下一步进入实现阶段。
