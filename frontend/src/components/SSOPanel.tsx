/**
 * SSOPanel - 单点登录面板
 * Cycle 32 G32-02
 *
 * 4 Tab 页：
 *   1. IdP 管理 (OIDC + SAML)
 *   2. 活动会话 (Active Sessions)
 *   3. SCIM 配置 (SCIM)
 *   4. OIDC Discovery
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  SSOEngine,
  getDefaultSSOEngine,
  type SCIMConfig,
} from '../utils/ssoEngine';

export interface SSOPanelProps {
  engine?: SSOEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'idp' | 'sessions' | 'scim' | 'discovery';

export const SSOPanel: React.FC<SSOPanelProps> = ({ engine: engineProp, isOpen: _isOpen, onClose }) => {
  const engine = useMemo(() => engineProp || getDefaultSSOEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('idp');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const events = ['provider-registered', 'provider-unregistered', 'provider-updated', 'login-success', 'logout', 'session-created', 'session-revoked', 'scim-synced'];
    const unsubs = events.map((evt) => engine.on(evt as any, () => setRefreshKey((k) => k + 1)));
    return () => { unsubs.forEach((u) => u()); };
  }, [engine]);

  return (
    <div className="sso-panel" data-testid="sso-panel">
      <div className="panel-header">
        <h2>单点登录 (SSO)</h2>
        {onClose && <button onClick={onClose} aria-label="关闭">×</button>}
      </div>

      <div className="panel-tabs">
        <button className={tab === 'idp' ? 'active' : ''} onClick={() => setTab('idp')}>IdP 管理</button>
        <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>活动会话</button>
        <button className={tab === 'scim' ? 'active' : ''} onClick={() => setTab('scim')}>SCIM</button>
        <button className={tab === 'discovery' ? 'active' : ''} onClick={() => setTab('discovery')}>Discovery</button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'idp' && <IdpTab engine={engine} />}
        {tab === 'sessions' && <SessionsTab engine={engine} />}
        {tab === 'scim' && <ScimTab engine={engine} />}
        {tab === 'discovery' && <DiscoveryTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ IdP Tab ============

const IdpTab: React.FC<{ engine: SSOEngine }> = ({ engine }) => {
  const [showAddOidc, setShowAddOidc] = useState(false);
  const [showAddSaml, setShowAddSaml] = useState(false);

  const oidcProviders = engine.listOIDCProviders();
  const samlProviders = engine.listSAMLProviders();

  return (
    <div className="tab-idp" data-testid="idp-tab">
      <div className="form-row">
        <h3>OIDC / OAuth 2.0 提供方</h3>
        <button onClick={() => setShowAddOidc(!showAddOidc)} data-testid="add-oidc">
          {showAddOidc ? '取消' : '添加 OIDC'}
        </button>
      </div>

      {showAddOidc && <OidcForm engine={engine} onDone={() => setShowAddOidc(false)} />}

      <div className="provider-list" data-testid="oidc-list">
        {oidcProviders.length === 0 ? (
          <div className="empty">暂无 OIDC 提供方</div>
        ) : (
          oidcProviders.map((p) => (
            <div key={p.id} className="provider-card" data-testid="oidc-provider">
              <div className="provider-name">{p.name}</div>
              <div className="provider-meta">
                <span>Issuer: {p.issuer}</span>
                <span>Client: {p.clientId}</span>
                <span>状态: {p.enabled ? '启用' : '禁用'}</span>
                <span>优先级: {p.priority}</span>
              </div>
              <button onClick={() => engine.unregisterProvider(p.id)} className="danger">删除</button>
            </div>
          ))
        )}
      </div>

      <div className="form-row">
        <h3>SAML 2.0 提供方</h3>
        <button onClick={() => setShowAddSaml(!showAddSaml)} data-testid="add-saml">
          {showAddSaml ? '取消' : '添加 SAML'}
        </button>
      </div>

      {showAddSaml && <SamlForm engine={engine} onDone={() => setShowAddSaml(false)} />}

      <div className="provider-list" data-testid="saml-list">
        {samlProviders.length === 0 ? (
          <div className="empty">暂无 SAML 提供方</div>
        ) : (
          samlProviders.map((p) => (
            <div key={p.id} className="provider-card" data-testid="saml-provider">
              <div className="provider-name">{p.name}</div>
              <div className="provider-meta">
                <span>Entity ID: {p.entityId}</span>
                <span>IdP SSO: {p.idpSsoURL}</span>
                <span>状态: {p.enabled ? '启用' : '禁用'}</span>
              </div>
              <button onClick={() => engine.unregisterProvider(p.id)} className="danger">删除</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const OidcForm: React.FC<{ engine: SSOEngine; onDone: () => void }> = ({ engine, onDone }) => {
  const [name, setName] = useState('Okta Production');
  const [issuer, setIssuer] = useState('https://example.okta.com');
  const [clientId, setClientId] = useState('client-123');
  const [redirectUri, setRedirectUri] = useState('https://app.example.com/callback');

  const handleSubmit = () => {
    try {
      engine.registerOIDCProvider({ name, issuer, clientId, redirectUri });
      onDone();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  return (
    <div className="provider-form" data-testid="oidc-form">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" />
      <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer URL" />
      <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" />
      <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder="Redirect URI" />
      <button onClick={handleSubmit} data-testid="submit-oidc">提交</button>
    </div>
  );
};

const SamlForm: React.FC<{ engine: SSOEngine; onDone: () => void }> = ({ engine, onDone }) => {
  const [name, setName] = useState('Azure AD');
  const [entityId, setEntityId] = useState('https://app.example.com');
  const [idpEntityId, setIdpEntityId] = useState('https://sts.windows.net/tenant');
  const [idpSsoURL, setIdpSsoURL] = useState('https://login.microsoftonline.com/tenant/saml2');
  const [idpX509Cert, setIdpX509Cert] = useState('MIID...');
  const [acsUrl, setAcsUrl] = useState('https://app.example.com/saml/acs');

  const handleSubmit = () => {
    try {
      engine.registerSAMLProvider({
        name,
        entityId,
        idpEntityId,
        idpSsoURL,
        idpX509Cert,
        assertionConsumerServiceURL: acsUrl,
      });
      onDone();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  return (
    <div className="provider-form" data-testid="saml-form">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" />
      <input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="Entity ID" />
      <input value={idpEntityId} onChange={(e) => setIdpEntityId(e.target.value)} placeholder="IdP Entity ID" />
      <input value={idpSsoURL} onChange={(e) => setIdpSsoURL(e.target.value)} placeholder="IdP SSO URL" />
      <input value={idpX509Cert} onChange={(e) => setIdpX509Cert(e.target.value)} placeholder="IdP X509 证书" />
      <input value={acsUrl} onChange={(e) => setAcsUrl(e.target.value)} placeholder="ACS URL" />
      <button onClick={handleSubmit} data-testid="submit-saml">提交</button>
    </div>
  );
};

// ============ Sessions Tab ============

const SessionsTab: React.FC<{ engine: SSOEngine }> = ({ engine }) => {
  const sessions = engine.listSessions();
  const [userId, setUserId] = useState('');

  const handleRevoke = (sessionId: string) => {
    engine.revokeSession(sessionId, 'manual revoke');
  };

  const handleRevokeAll = () => {
    if (!userId) return;
    const count = engine.revokeAllSessions(userId, 'manual revoke all');
    alert(`已撤销 ${count} 个会话`);
  };

  return (
    <div className="tab-sessions" data-testid="sessions-tab">
      <div className="form-row">
        <label>用户 ID：</label>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user-123" />
        <button onClick={handleRevokeAll} data-testid="revoke-all">撤销所有会话</button>
      </div>

      <div className="session-list" data-testid="session-list">
        {sessions.length === 0 ? (
          <div className="empty">暂无活动会话</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Session ID</th>
                <th>用户</th>
                <th>提供方</th>
                <th>类型</th>
                <th>状态</th>
                <th>过期时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} data-testid="session-row">
                  <td>{s.id.substring(0, 12)}...</td>
                  <td>{s.user.email}</td>
                  <td>{s.providerId}</td>
                  <td>{s.providerType}</td>
                  <td>{s.status}</td>
                  <td>{new Date(s.expiresAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => handleRevoke(s.id)} className="danger">撤销</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============ SCIM Tab ============

const ScimTab: React.FC<{ engine: SSOEngine }> = ({ engine }) => {
  const configs = engine.listSCIMConfigs();
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [newUser, setNewUser] = useState({ userName: '', givenName: '', familyName: '', email: '' });

  const users = selectedProvider ? engine.scimListUsers(selectedProvider).Resources : [];

  const handleAddConfig = () => {
    const name = prompt('SCIM 配置名称：');
    if (!name) return;
    const baseUrl = prompt('Base URL (如 https://api.example.com/scim/v2)：');
    if (!baseUrl) return;
    const token = prompt('Bearer Token：');
    if (!token) return;
    const config: SCIMConfig = {
      id: `scim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      type: 'scim',
      enabled: true,
      direction: 'inbound',
      serverConfig: {
        baseUrl,
        bearerToken: token,
        supportedSchemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      },
      userMapping: {
        externalId: 'externalId',
        userName: 'userName',
        email: 'emails[0].value',
        emailType: 'work',
        givenName: 'name.givenName',
        familyName: 'name.familyName',
        displayName: 'displayName',
        active: 'active',
      },
      enableAutoSync: true,
      syncOnUserCreate: true,
      syncOnUserUpdate: true,
      syncOnUserDelete: true,
    };
    engine.registerSCIMConfig(config);
  };

  const handleCreateUser = () => {
    if (!selectedProvider) return;
    try {
      engine.scimCreateUser(selectedProvider, {
        id: '',
        userName: newUser.userName,
        name: { givenName: newUser.givenName, familyName: newUser.familyName },
        emails: [{ value: newUser.email, primary: true }],
        active: true,
      });
      setNewUser({ userName: '', givenName: '', familyName: '', email: '' });
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleSync = async () => {
    if (!selectedProvider) return;
    const result = await engine.scimSyncUsers(selectedProvider);
    alert(`同步完成: 新增 ${result.added}, 更新 ${result.updated}, 删除 ${result.removed}`);
  };

  return (
    <div className="tab-scim" data-testid="scim-tab">
      <div className="form-row">
        <button onClick={handleAddConfig} data-testid="add-scim-config">添加 SCIM 配置</button>
      </div>

      <div className="form-row">
        <label>选择配置：</label>
        <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}>
          <option value="">-- 选择 --</option>
          {configs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={handleSync} disabled={!selectedProvider} data-testid="sync-scim">同步</button>
      </div>

      {selectedProvider && (
        <div className="scim-users" data-testid="scim-users">
          <h3>用户列表 ({users.length})</h3>
          <table>
            <thead>
              <tr>
                <th>UserName</th>
                <th>Email</th>
                <th>姓名</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.userName}</td>
                  <td>{u.emails?.[0]?.value || '-'}</td>
                  <td>{u.name?.givenName || ''} {u.name?.familyName || ''}</td>
                  <td>{u.active ? '激活' : '停用'}</td>
                  <td>
                    <button onClick={() => u.id && engine.scimDeleteUser(selectedProvider, u.id)} className="danger">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>添加用户</h4>
          <div className="user-form">
            <input value={newUser.userName} onChange={(e) => setNewUser({ ...newUser, userName: e.target.value })} placeholder="UserName" />
            <input value={newUser.givenName} onChange={(e) => setNewUser({ ...newUser, givenName: e.target.value })} placeholder="First Name" />
            <input value={newUser.familyName} onChange={(e) => setNewUser({ ...newUser, familyName: e.target.value })} placeholder="Last Name" />
            <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email" />
            <button onClick={handleCreateUser}>添加</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ Discovery Tab ============

const DiscoveryTab: React.FC<{ engine: SSOEngine }> = ({ engine }) => {
  const [issuer, setIssuer] = useState('https://example.okta.com');
  const [discovery, setDiscovery] = useState<any>(null);
  const [error, setError] = useState<string>('');

  const handleDiscover = async () => {
    setError('');
    try {
      const result = await engine.discoverOIDC(issuer);
      setDiscovery(result);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="tab-discovery" data-testid="discovery-tab">
      <div className="form-row">
        <label>Issuer URL：</label>
        <input value={issuer} onChange={(e) => setIssuer(e.target.value)} style={{ width: '400px' }} />
        <button onClick={handleDiscover} data-testid="discover">发现</button>
      </div>

      {error && <div className="error">{error}</div>}

      {discovery && (
        <div className="discovery-result">
          <h3>OIDC Discovery 文档</h3>
          <pre>{JSON.stringify(discovery, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
