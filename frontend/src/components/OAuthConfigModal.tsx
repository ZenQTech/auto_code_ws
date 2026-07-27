/**
 * # ============================================================
 * OAuthConfigModal - OAuth 2.1 + PKCE 配置弹窗
 * # ============================================================
 * 核心作用：可视化管理 OAuth 2.1 + PKCE 授权流程
 * 功能：
 *   - 5 步骤 PKCE 流程可视化（verifier → challenge → authorize → callback → token）
 *   - 客户端注册向导
 *   - Token 状态显示（access_token / refresh_token / 过期时间）
 *   - Token 刷新 + 撤销
 *   - 元数据查看
 * 运行流程：
 *   1. 用户填写 client_name + redirect_uri
 *   2. 点击"注册客户端"调用 POST /oauth/register
 *   3. 自动生成 code_verifier + code_challenge
 *   4. 用户点击"打开授权页"调用 GET /oauth/authorize
 *   5. 用户从 callback URL 复制 code
 *   6. 点击"交换 Token"调用 POST /oauth/token
 *   7. 显示获得的 access_token + refresh_token
 * 输入参数：onClose 回调
 * 输出结果：完整 OAuth 配置弹窗 DOM
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P0-8 新建
 * ============================================================
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  fetchOAuthMetadata,
  registerOAuthClient,
  listOAuthClients,
  deleteOAuthClient,
  getOAuthStats,
  generatePKCE,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
  type OAuthMetadata,
  type OAuthClient,
  type OAuthStats,
  type PKCEPair,
  type TokenResponse,
} from '../hooks/useOAuthApi';

// ============================================================
// 类型定义
// ============================================================

export interface OAuthConfigModalProps {
  onClose: () => void;
}

type StepKey = 'register' | 'verifier' | 'authorize' | 'callback' | 'token';

interface StepDef {
  id: StepKey;
  label: string;
  icon: string;
  description: string;
}

const STEPS: StepDef[] = [
  { id: 'register', label: '注册客户端', icon: '1️⃣', description: '获取 client_id' },
  { id: 'verifier', label: '生成 PKCE', icon: '2️⃣', description: 'code_verifier + challenge' },
  { id: 'authorize', label: '打开授权页', icon: '3️⃣', description: '用户授权' },
  { id: 'callback', label: '接收 Code', icon: '4️⃣', description: '从回调 URL 提取' },
  { id: 'token', label: '交换 Token', icon: '5️⃣', description: '获取 access_token' },
];

// ============================================================
// 工具函数
// ============================================================

function truncateToken(token: string, maxLen: number = 30): string {
  if (!token) return '';
  if (token.length <= maxLen) return token;
  return `${token.slice(0, maxLen)}...`;
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // 降级方案
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  return Promise.resolve();
}

// ============================================================
// 子组件：步骤指示器
// ============================================================

const StepIndicator: React.FC<{ currentStep: StepKey }> = ({ currentStep }) => {
  const currentIndex = STEPS.findIndex(s => s.id === currentStep);
  return (
    <div className="flex items-center justify-between mb-4">
      {STEPS.map((step, idx) => {
        const isActive = idx === currentIndex;
        const isCompleted = idx < currentIndex;
        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all
                  ${isActive ? 'bg-hermes-500 text-white shadow-glow-hermes-sm scale-110' :
                    isCompleted ? 'bg-emerald-500 text-white' :
                    'bg-surface-200 text-surface-500'}`}
              >
                {isCompleted ? '✓' : step.icon.split('')[0]}
              </div>
              <div className="text-[10px] text-surface-600 mt-1 text-center">{step.label}</div>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 -mt-4 transition-all
                ${isCompleted ? 'bg-emerald-500' : 'bg-surface-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ============================================================
// 子组件：元数据展示
// ============================================================

const MetadataCard: React.FC<{ metadata: OAuthMetadata | null; loading: boolean }> = ({ metadata, loading }) => {
  if (loading) {
    return (
      <div className="p-3 bg-surface-50 rounded-lg animate-pulse">
        <div className="h-3 bg-surface-200 rounded w-1/2 mb-2" />
        <div className="h-3 bg-surface-200 rounded w-3/4" />
      </div>
    );
  }
  if (!metadata) {
    return <div className="p-3 bg-rose-50 text-rose-700 text-sm rounded-lg">元数据加载失败</div>;
  }
  return (
    <div className="p-3 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg text-xs space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-surface-500 w-20">Issuer:</span>
        <code className="text-indigo-700 font-mono">{metadata.issuer}</code>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-surface-500 w-20">Authorize:</span>
        <code className="text-indigo-700 font-mono truncate">{metadata.authorization_endpoint}</code>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-surface-500 w-20">Token:</span>
        <code className="text-indigo-700 font-mono truncate">{metadata.token_endpoint}</code>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-surface-500 w-20">S256 支持:</span>
        <span className="text-emerald-700 font-bold">
          {metadata.code_challenge_methods_supported?.includes('S256') ? '✅ 是' : '❌ 否'}
        </span>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：客户端列表
// ============================================================

const ClientList: React.FC<{
  clients: OAuthClient[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (client: OAuthClient) => void;
  onDelete: (clientId: string) => void;
}> = ({ clients, loading, selectedId, onSelect, onDelete }) => {
  if (loading) {
    return <div className="text-sm text-surface-500 p-3">加载中...</div>;
  }
  if (clients.length === 0) {
    return (
      <div className="text-sm text-surface-500 p-3 bg-surface-50 rounded-lg text-center">
        暂无客户端，请先注册
      </div>
    );
  }
  return (
    <div className="space-y-1.5 max-h-48 overflow-y-auto">
      {clients.map(client => (
        <div
          key={client.client_id}
          onClick={() => onSelect(client)}
          className={`p-2.5 rounded-lg border cursor-pointer transition-all
            ${selectedId === client.client_id
              ? 'border-hermes-500 bg-hermes-50'
              : 'border-surface-200 bg-white hover:border-hermes-300 hover:bg-surface-50'}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-surface-900 truncate">{client.client_name}</div>
              <code className="text-[10px] text-surface-500 font-mono">{client.client_id.slice(0, 20)}...</code>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`确认删除客户端 ${client.client_name}？`)) {
                  onDelete(client.client_id);
                }
              }}
              className="ml-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded text-xs"
            >
              🗑️
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const OAuthConfigModal: React.FC<OAuthConfigModalProps> = ({ onClose }) => {
  // ============================================================
  // 状态
  // ============================================================
  const [metadata, setMetadata] = useState<OAuthMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState<boolean>(true);
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [clientsLoading, setClientsLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<OAuthStats | null>(null);
  const [selectedClient, setSelectedClient] = useState<OAuthClient | null>(null);
  const [currentStep, setCurrentStep] = useState<StepKey>('register');

  // 注册表单
  const [regClientName, setRegClientName] = useState<string>('');
  const [regRedirectUri, setRegRedirectUri] = useState<string>('http://localhost:3000/callback');
  const [regLoading, setRegLoading] = useState<boolean>(false);

  // PKCE
  const [pkce, setPkce] = useState<PKCEPair | null>(null);

  // Authorize
  const [authorizeUrl, setAuthorizeUrl] = useState<string>('');

  // Callback
  const [callbackCode, setCallbackCode] = useState<string>('');

  // Token
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [tokenLoading, setTokenLoading] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // ============================================================
  // 副作用
  // ============================================================
  useEffect(() => {
    void loadMetadata();
    void loadClients();
    void loadStats();
  }, []);

  // ============================================================
  // 数据加载
  // ============================================================
  const loadMetadata = useCallback(async () => {
    setMetadataLoading(true);
    try {
      const data = await fetchOAuthMetadata();
      setMetadata(data);
    } catch (e) {
      console.error('加载元数据失败:', e);
    } finally {
      setMetadataLoading(false);
    }
  }, []);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const list = await listOAuthClients();
      setClients(list);
    } catch (e) {
      console.error('加载客户端列表失败:', e);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await getOAuthStats();
      setStats(data);
    } catch (e) {
      console.error('加载统计失败:', e);
    }
  }, []);

  // ============================================================
  // 操作
  // ============================================================
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleRegister = useCallback(async () => {
    if (!regClientName.trim()) {
      showToast('请填写 client_name', 'error');
      return;
    }
    setRegLoading(true);
    try {
      const newClient = await registerOAuthClient({
        client_name: regClientName,
        redirect_uris: [regRedirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      });
      showToast(`客户端已注册: ${newClient.client_id.slice(0, 15)}...`, 'success');
      setRegClientName('');
      await loadClients();
      await loadStats();
      setCurrentStep('verifier');
    } catch (e) {
      showToast(`注册失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setRegLoading(false);
    }
  }, [regClientName, regRedirectUri, loadClients, loadStats, showToast]);

  const handleSelectClient = useCallback((client: OAuthClient) => {
    setSelectedClient(client);
    setCurrentStep('verifier');
  }, []);

  const handleDeleteClient = useCallback(async (clientId: string) => {
    try {
      await deleteOAuthClient(clientId);
      showToast('客户端已删除', 'success');
      await loadClients();
      await loadStats();
      if (selectedClient?.client_id === clientId) {
        setSelectedClient(null);
        setPkce(null);
        setToken(null);
        setCurrentStep('register');
      }
    } catch (e) {
      showToast(`删除失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [loadClients, loadStats, selectedClient, showToast]);

  const handleGeneratePKCE = useCallback(() => {
    const pair = generatePKCE();
    setPkce(pair);
    showToast('PKCE 参数已生成', 'success');
  }, [showToast]);

  const handleBuildAuthorizeUrl = useCallback(() => {
    if (!selectedClient || !pkce) {
      showToast('请先选择客户端并生成 PKCE', 'error');
      return;
    }
    const redirectUri = encodeURIComponent(selectedClient.redirect_uris[0] || '');
    const url = `${metadata?.authorization_endpoint || ''}?response_type=code&client_id=${selectedClient.client_id}&redirect_uri=${redirectUri}&code_challenge=${pkce.code_challenge}&code_challenge_method=S256&state=xyz&scope=read`;
    setAuthorizeUrl(url);
    setCurrentStep('authorize');
  }, [selectedClient, pkce, metadata, showToast]);

  const handleOpenAuthorizeUrl = useCallback(() => {
    if (authorizeUrl) {
      window.open(authorizeUrl, '_blank');
    }
  }, [authorizeUrl]);

  const handleCopyAuthorizeUrl = useCallback(async () => {
    if (authorizeUrl) {
      await copyToClipboard(authorizeUrl);
      showToast('URL 已复制', 'success');
    }
  }, [authorizeUrl, showToast]);

  const handleProceedToCallback = useCallback(() => {
    setCurrentStep('callback');
  }, []);

  const handleExchangeCode = useCallback(async () => {
    if (!selectedClient || !pkce || !callbackCode.trim()) {
      showToast('请填写 code', 'error');
      return;
    }
    setTokenLoading(true);
    setTokenError(null);
    try {
      const result = await exchangeCodeForToken({
        code: callbackCode.trim(),
        client_id: selectedClient.client_id,
        redirect_uri: selectedClient.redirect_uris[0],
        code_verifier: pkce.code_verifier,
      });
      setToken(result);
      setCurrentStep('token');
      showToast('Token 交换成功', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTokenError(msg);
      showToast(`Token 交换失败: ${msg}`, 'error');
    } finally {
      setTokenLoading(false);
    }
  }, [selectedClient, pkce, callbackCode, showToast]);

  const handleRefreshToken = useCallback(async () => {
    if (!selectedClient || !token?.refresh_token) return;
    setTokenLoading(true);
    try {
      const newToken = await refreshAccessToken({
        refresh_token: token.refresh_token,
        client_id: selectedClient.client_id,
      });
      setToken(newToken);
      showToast('Token 已刷新', 'success');
    } catch (e) {
      showToast(`刷新失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setTokenLoading(false);
    }
  }, [selectedClient, token, showToast]);

  const handleRevokeToken = useCallback(async () => {
    if (!token?.access_token) return;
    try {
      await revokeToken({
        token: token.access_token,
        token_type_hint: 'access_token',
      });
      showToast('Token 已撤销', 'success');
      setToken(null);
    } catch (e) {
      showToast(`撤销失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [token, showToast]);

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4
                 bg-black/40 backdrop-blur-md animate-lift-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-level-3 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <span className="text-2xl">🔐</span>
                <span>OAuth 2.1 + PKCE 配置</span>
              </h2>
              <p className="text-sm text-white/80 mt-1">
                符合 MCP Authorization Spec 2026-06-18 · 强制 S256 · Audience Binding · 重放检测
              </p>
            </div>
            <button
              onClick={onClose}
              title="关闭 (Esc)"
              aria-label="关闭"
              className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 flex items-center justify-center text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 统计卡片 */}
          {stats && (
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg text-center">
                <div className="text-xs text-indigo-600">客户端</div>
                <div className="text-lg font-bold text-indigo-900">{stats.total_clients}</div>
              </div>
              <div className="p-2 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg text-center">
                <div className="text-xs text-purple-600">活跃 Auth Code</div>
                <div className="text-lg font-bold text-purple-900">{stats.active_auth_codes}</div>
              </div>
              <div className="p-2 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg text-center">
                <div className="text-xs text-emerald-600">活跃 Access</div>
                <div className="text-lg font-bold text-emerald-900">{stats.active_access_tokens}</div>
              </div>
              <div className="p-2 bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg text-center">
                <div className="text-xs text-amber-600">活跃 Refresh</div>
                <div className="text-lg font-bold text-amber-900">{stats.active_refresh_tokens}</div>
              </div>
            </div>
          )}

          {/* 步骤指示器 */}
          <StepIndicator currentStep={currentStep} />

          {/* 元数据 */}
          <section>
            <h3 className="text-sm font-semibold text-surface-700 mb-2">📋 服务器元数据</h3>
            <MetadataCard metadata={metadata} loading={metadataLoading} />
          </section>

          {/* Step 1: 客户端注册 */}
          <section className="border border-surface-200 rounded-xl p-4 bg-surface-50/30">
            <h3 className="text-sm font-semibold text-surface-700 mb-3">1️⃣ 注册新客户端</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-surface-600 block mb-1">Client Name</label>
                <input
                  type="text"
                  value={regClientName}
                  onChange={(e) => setRegClientName(e.target.value)}
                  placeholder="My MCP Client"
                  className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:border-hermes-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-surface-600 block mb-1">Redirect URI</label>
                <input
                  type="text"
                  value={regRedirectUri}
                  onChange={(e) => setRegRedirectUri(e.target.value)}
                  placeholder="http://localhost:3000/callback"
                  className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:border-hermes-500 focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={handleRegister}
              disabled={regLoading}
              className="mt-3 px-4 py-1.5 text-sm bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-lg disabled:opacity-50 transition-all"
            >
              {regLoading ? '注册中...' : '注册客户端'}
            </button>

            {/* 已有客户端列表 */}
            <div className="mt-4">
              <h4 className="text-xs font-medium text-surface-600 mb-2">📂 已有客户端（点击选择）</h4>
              <ClientList
                clients={clients}
                loading={clientsLoading}
                selectedId={selectedClient?.client_id || null}
                onSelect={handleSelectClient}
                onDelete={handleDeleteClient}
              />
            </div>
          </section>

          {/* Step 2: PKCE 生成 */}
          {selectedClient && (
            <section className="border border-surface-200 rounded-xl p-4 bg-surface-50/30">
              <h3 className="text-sm font-semibold text-surface-700 mb-3">2️⃣ 生成 PKCE 参数</h3>
              <div className="text-xs text-surface-600 mb-2">
                已选择: <strong>{selectedClient.client_name}</strong> ({selectedClient.client_id.slice(0, 20)}...)
              </div>
              <button
                onClick={handleGeneratePKCE}
                className="px-4 py-1.5 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
              >
                🔑 生成 code_verifier + challenge
              </button>
              {pkce && (
                <div className="mt-3 p-3 bg-emerald-50 rounded-lg text-xs space-y-1.5">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-700 font-medium w-24 flex-shrink-0">code_verifier:</span>
                    <code className="text-emerald-900 font-mono break-all flex-1">{pkce.code_verifier}</code>
                    <button
                      onClick={() => copyToClipboard(pkce.code_verifier).then(() => showToast('已复制', 'success'))}
                      className="text-emerald-600 hover:text-emerald-800 text-xs"
                    >📋</button>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-700 font-medium w-24 flex-shrink-0">code_challenge:</span>
                    <code className="text-emerald-900 font-mono break-all flex-1">{pkce.code_challenge}</code>
                    <button
                      onClick={() => copyToClipboard(pkce.code_challenge).then(() => showToast('已复制', 'success'))}
                      className="text-emerald-600 hover:text-emerald-800 text-xs"
                    >📋</button>
                  </div>
                  <div className="text-[10px] text-emerald-600 mt-1">
                    ⚙️ Method: {pkce.code_challenge_method} (强制 S256)
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Step 3: Authorize URL */}
          {selectedClient && pkce && (
            <section className="border border-surface-200 rounded-xl p-4 bg-surface-50/30">
              <h3 className="text-sm font-semibold text-surface-700 mb-3">3️⃣ 打开授权页</h3>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={handleBuildAuthorizeUrl}
                  className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                >
                  🔗 生成授权 URL
                </button>
                {authorizeUrl && (
                  <>
                    <button
                      onClick={handleOpenAuthorizeUrl}
                      className="px-3 py-1.5 text-sm bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors"
                    >
                      🌐 在浏览器打开
                    </button>
                    <button
                      onClick={handleCopyAuthorizeUrl}
                      className="px-3 py-1.5 text-sm bg-surface-200 hover:bg-surface-300 text-surface-700 rounded-lg transition-colors"
                    >
                      📋 复制 URL
                    </button>
                    <button
                      onClick={handleProceedToCallback}
                      className="px-3 py-1.5 text-sm bg-hermes-500 hover:bg-hermes-600 text-white rounded-lg transition-colors"
                    >
                      下一步 →
                    </button>
                  </>
                )}
              </div>
              {authorizeUrl && (
                <div className="p-2 bg-blue-50 rounded-lg text-xs">
                  <code className="text-blue-900 font-mono break-all">{authorizeUrl}</code>
                </div>
              )}
            </section>
          )}

          {/* Step 4: Callback Code */}
          {selectedClient && pkce && (
            <section className="border border-surface-200 rounded-xl p-4 bg-surface-50/30">
              <h3 className="text-sm font-semibold text-surface-700 mb-3">4️⃣ 接收授权码</h3>
              <div className="text-xs text-surface-600 mb-2">
                从浏览器地址栏的回调 URL 中复制 <code className="bg-surface-200 px-1 rounded">code</code> 参数：
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={callbackCode}
                  onChange={(e) => setCallbackCode(e.target.value)}
                  placeholder="ac_xxxxxxxxxxxxx"
                  className="flex-1 px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:border-hermes-500 focus:outline-none font-mono"
                />
                <button
                  onClick={handleExchangeCode}
                  disabled={tokenLoading}
                  className="px-4 py-1.5 text-sm bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-lg disabled:opacity-50 transition-all"
                >
                  {tokenLoading ? '交换中...' : '🔄 交换 Token'}
                </button>
              </div>
              {tokenError && (
                <div className="mt-2 p-2 bg-rose-50 text-rose-700 text-xs rounded-lg">
                  ❌ {tokenError}
                </div>
              )}
            </section>
          )}

          {/* Step 5: Token 显示 */}
          {token && (
            <section className="border-2 border-emerald-300 rounded-xl p-4 bg-emerald-50/30">
              <h3 className="text-sm font-semibold text-emerald-700 mb-3">✅ 5️⃣ Token 交换成功</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-emerald-700 font-medium w-28 flex-shrink-0">access_token:</span>
                  <code className="text-emerald-900 font-mono break-all flex-1 bg-white p-1.5 rounded">
                    {truncateToken(token.access_token, 60)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(token.access_token).then(() => showToast('access_token 已复制', 'success'))}
                    className="text-emerald-600 hover:text-emerald-800"
                  >📋</button>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-700 font-medium w-28 flex-shrink-0">refresh_token:</span>
                  <code className="text-emerald-900 font-mono break-all flex-1 bg-white p-1.5 rounded">
                    {truncateToken(token.refresh_token, 60)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(token.refresh_token).then(() => showToast('refresh_token 已复制', 'success'))}
                    className="text-emerald-600 hover:text-emerald-800"
                  >📋</button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="bg-white p-2 rounded">
                    <div className="text-[10px] text-surface-500">token_type</div>
                    <div className="font-mono text-surface-900">{token.token_type}</div>
                  </div>
                  <div className="bg-white p-2 rounded">
                    <div className="text-[10px] text-surface-500">expires_in</div>
                    <div className="font-mono text-surface-900">{token.expires_in}s</div>
                  </div>
                  <div className="bg-white p-2 rounded">
                    <div className="text-[10px] text-surface-500">scope</div>
                    <div className="font-mono text-surface-900">{token.scope}</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleRefreshToken}
                    disabled={tokenLoading}
                    className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
                  >
                    🔄 刷新 Token
                  </button>
                  <button
                    onClick={handleRevokeToken}
                    className="px-3 py-1.5 text-xs bg-rose-500 hover:bg-rose-600 text-white rounded-lg"
                  >
                    🗑️ 撤销 Token
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Toast 通知 */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-[70] px-4 py-2 rounded-lg shadow-level-2 text-sm font-medium animate-lift-in
              ${toast.type === 'success' ? 'bg-emerald-500 text-white' :
                toast.type === 'error' ? 'bg-rose-500 text-white' :
                'bg-blue-500 text-white'}`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
};

export default OAuthConfigModal;
