/**
 * # ============================================================
 * # LLM Provider Panel - LLM Provider 配置与测试面板 (v1.0.0 Cycle 36 G36-01)
 * # ============================================================
 * # 核心作用：LLM Provider 可视化管理（注册/配置/测试/统计）
 * # 运行流程：
 * #   1. 选择 Provider 类型（Mock / Anthropic / OpenAI / Ollama）
 * #   2. 配置 API Key / Base URL / 默认模型
 * #   3. 测试连接（chat 调用）
 * #   4. 查看使用统计（Token / 成本）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 36 G36-01 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LLMProvider,
  ProviderName,
  Message,
  ChatResponse,
  ModelInfo,
  PROVIDER_MODELS,
  getDefaultLLMProviderRegistry,
  getDefaultUsageTracker,
  AggregateUsage,
  createProvider,
  UsageTracker,
} from '../utils/llmProviderAdapter';

export interface LLMProviderPanelProps {
  isOpen: boolean;
  onClose: () => void;
  registry?: ReturnType<typeof getDefaultLLMProviderRegistry>;
  tracker?: UsageTracker;
}

type TabKey = 'providers' | 'chat' | 'usage';

const PROVIDER_DISPLAY: Record<ProviderName, { name: string; icon: string; color: string; description: string }> = {
  mock: { name: 'Mock Provider', icon: '🧪', color: 'gray', description: '测试用 Provider，无网络调用' },
  anthropic: { name: 'Anthropic Claude', icon: '🤖', color: 'orange', description: 'Claude 系列模型（Opus/Sonnet/Haiku）' },
  openai: { name: 'OpenAI', icon: '🧠', color: 'green', description: 'GPT 系列模型（GPT-4o/o1）' },
  ollama: { name: 'Ollama (Local)', icon: '💻', color: 'blue', description: '本地 LLM 运行时' },
};

const LLMProviderPanel: React.FC<LLMProviderPanelProps> = ({
  isOpen,
  onClose,
  registry: registryProp,
  tracker: trackerProp,
}) => {
  const registry = useMemo(() => registryProp || getDefaultLLMProviderRegistry(), [registryProp]);
  const tracker = useMemo(() => trackerProp || getDefaultUsageTracker(), [trackerProp]);

  const [tab, setTab] = useState<TabKey>('providers');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('mock');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [testPrompt, setTestPrompt] = useState('Hello, please introduce yourself in one sentence.');
  const [testResponse, setTestResponse] = useState<ChatResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // 订阅事件
  useEffect(() => {
    const events = ['provider-registered', 'provider-unregistered', 'default-changed'];
    const unsubs = events.map((evt) =>
      registry.on(evt, () => setRefreshKey((k) => k + 1))
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [registry]);

  // 初始化默认值
  useEffect(() => {
    const provider = registry.get(selectedProvider);
    if (provider) {
      setDefaultModel(provider.defaultModel);
    } else {
      const models = PROVIDER_MODELS[selectedProvider];
      if (models && models.length > 0) {
        setDefaultModel(models[0].id);
      }
    }
  }, [selectedProvider, registry]);

  const handleRegister = useCallback(() => {
    try {
      const provider = createProvider(selectedProvider, {
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        defaultModel,
      });
      registry.register(selectedProvider, provider);
      setApiKey('');
      setBaseUrl('');
    } catch (e) {
      setTestError((e as Error).message);
    }
  }, [selectedProvider, apiKey, baseUrl, defaultModel, registry]);

  const handleSetDefault = useCallback(() => {
    try {
      registry.setDefault(selectedProvider);
    } catch (e) {
      setTestError((e as Error).message);
    }
  }, [selectedProvider, registry]);

  const handleUnregister = useCallback(() => {
    registry.unregister(selectedProvider);
  }, [selectedProvider, registry]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestError(null);
    setTestResponse(null);
    try {
      const provider = registry.get(selectedProvider);
      if (!provider) {
        setTestError(`Provider ${selectedProvider} 未注册`);
        return;
      }
      const messages: Message[] = [{ role: 'user', content: testPrompt }];
      const response = await provider.chat(messages, {
        model: defaultModel,
        maxTokens: 256,
      });
      setTestResponse(response);
      tracker.record(selectedProvider, defaultModel, response.usage, provider.calculateCost(response.usage));
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }, [registry, selectedProvider, testPrompt, defaultModel, tracker]);

  const handleQuickRegister = useCallback((name: ProviderName) => {
    const provider = createProvider(name, {});
    registry.register(name, provider);
    if (!registry.getDefaultName()) {
      registry.setDefault(name);
    }
    setSelectedProvider(name);
  }, [registry]);

  if (!isOpen) return null;

  // 依赖 refreshKey 触发组件重渲染（订阅事件触发 setRefreshKey）
  const providers = useMemo(() => registry.list(), [registry, refreshKey]);
  const totalUsage = useMemo(() => tracker.getTotal(), [tracker, refreshKey]);
  const byProvider = useMemo(() => tracker.getByProvider(), [tracker, refreshKey]);
  const byModel = useMemo(() => tracker.getByModel(), [tracker, refreshKey]);
  const isRegistered = registry.has(selectedProvider);
  const models = PROVIDER_MODELS[selectedProvider] || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      data-testid="llm-provider-panel"
      role="dialog"
      aria-label="LLM Provider 面板"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-w-[95vw] h-[700px] max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">LLM Provider 面板</h2>
              <p className="text-xs text-gray-600">v1.0.0 (Cycle 36 G36-01) · 统一 LLM Provider 抽象层</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
            data-testid="llm-provider-close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 border-b border-gray-200 bg-white flex gap-1">
          {(['providers', 'chat', 'usage'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`llm-tab-${t}`}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                tab === t
                  ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'providers' && '⚙️ Provider 管理'}
              {t === 'chat' && '💬 测试 Chat'}
              {t === 'usage' && '📊 使用统计'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {tab === 'providers' && (
            <ProvidersTab
              providers={providers}
              selectedProvider={selectedProvider}
              setSelectedProvider={setSelectedProvider}
              apiKey={apiKey}
              setApiKey={setApiKey}
              baseUrl={baseUrl}
              setBaseUrl={setBaseUrl}
              defaultModel={defaultModel}
              setDefaultModel={setDefaultModel}
              models={models}
              isRegistered={isRegistered}
              defaultProviderName={registry.getDefaultName()}
              onRegister={handleRegister}
              onSetDefault={handleSetDefault}
              onUnregister={handleUnregister}
              onQuickRegister={handleQuickRegister}
            />
          )}
          {tab === 'chat' && (
            <ChatTab
              testPrompt={testPrompt}
              setTestPrompt={setTestPrompt}
              testResponse={testResponse}
              testError={testError}
              testing={testing}
              onTest={handleTest}
              selectedProvider={selectedProvider}
              isRegistered={isRegistered}
            />
          )}
          {tab === 'usage' && (
            <UsageTab
              totalUsage={totalUsage}
              byProvider={byProvider}
              byModel={byModel}
              onReset={() => {
                tracker.reset();
                setRefreshKey((k) => k + 1);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

interface ProvidersTabProps {
  providers: LLMProvider[];
  selectedProvider: ProviderName;
  setSelectedProvider: (n: ProviderName) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  defaultModel: string;
  setDefaultModel: (v: string) => void;
  models: ModelInfo[];
  isRegistered: boolean;
  defaultProviderName: ProviderName | null;
  onRegister: () => void;
  onSetDefault: () => void;
  onUnregister: () => void;
  onQuickRegister: (n: ProviderName) => void;
}

const ProvidersTab: React.FC<ProvidersTabProps> = ({
  providers,
  selectedProvider,
  setSelectedProvider,
  apiKey,
  setApiKey,
  baseUrl,
  setBaseUrl,
  defaultModel,
  setDefaultModel,
  models,
  isRegistered,
  defaultProviderName,
  onRegister,
  onSetDefault,
  onUnregister,
  onQuickRegister,
}) => {
  return (
    <div className="space-y-4">
      {/* Provider 列表 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">已注册 Provider</h3>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(PROVIDER_DISPLAY) as ProviderName[]).map((name) => {
            const display = PROVIDER_DISPLAY[name];
            const isReg = providers.some((p) => p.name === name);
            const isDefault = defaultProviderName === name;
            return (
              <button
                key={name}
                onClick={() => setSelectedProvider(name)}
                data-testid={`provider-card-${name}`}
                className={`p-3 border-2 rounded-lg text-left transition-all ${
                  selectedProvider === name
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{display.icon}</span>
                    <span className="font-medium text-sm text-gray-900">{display.name}</span>
                  </div>
                  <div className="flex gap-1">
                    {isReg && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                        已注册
                      </span>
                    )}
                    {isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                        默认
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-600">{display.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 配置表单 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          配置 {PROVIDER_DISPLAY[selectedProvider].name}
        </h3>
        <div className="space-y-3">
          {selectedProvider !== 'mock' && selectedProvider !== 'ollama' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                data-testid="api-key-input"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {selectedProvider === 'ollama' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434"
                data-testid="base-url-input"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">默认模型</label>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              data-testid="model-select"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id})
                </option>
              ))}
            </select>
            {models.length > 0 && (
              <div className="mt-2 text-xs text-gray-500">
                上下文窗口: {models.find((m) => m.id === defaultModel)?.contextWindow.toLocaleString() || '-'} tokens ·
                输入 ${models.find((m) => m.id === defaultModel)?.inputCostPerMTokens || 0} / 输出 ${models.find((m) => m.id === defaultModel)?.outputCostPerMTokens || 0} per 1M
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            {!isRegistered ? (
              <>
                <button
                  onClick={onRegister}
                  data-testid="register-button"
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
                >
                  注册
                </button>
                <button
                  onClick={() => onQuickRegister(selectedProvider)}
                  data-testid="quick-register-button"
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                >
                  快速注册（默认配置）
                </button>
              </>
            ) : (
              <>
                {defaultProviderName !== selectedProvider && (
                  <button
                    onClick={onSetDefault}
                    data-testid="set-default-button"
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                  >
                    设为默认
                  </button>
                )}
                <button
                  onClick={onUnregister}
                  data-testid="unregister-button"
                  className="px-4 py-2 text-sm bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors"
                >
                  注销
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface ChatTabProps {
  testPrompt: string;
  setTestPrompt: (v: string) => void;
  testResponse: ChatResponse | null;
  testError: string | null;
  testing: boolean;
  onTest: () => void;
  selectedProvider: ProviderName;
  isRegistered: boolean;
}

const ChatTab: React.FC<ChatTabProps> = ({
  testPrompt,
  setTestPrompt,
  testResponse,
  testError,
  testing,
  onTest,
  selectedProvider,
  isRegistered,
}) => {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">测试 Chat 调用</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">提示词</label>
            <textarea
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              rows={3}
              data-testid="test-prompt"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <button
            onClick={onTest}
            disabled={testing || !isRegistered}
            data-testid="test-button"
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? '测试中...' : '🚀 发送测试'}
          </button>
          {!isRegistered && (
            <p className="text-xs text-amber-600">
              ⚠️ 请先在 Provider 管理中注册 "{PROVIDER_DISPLAY[selectedProvider].name}"
            </p>
          )}
        </div>
      </div>

      {testError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4" data-testid="test-error">
          <h4 className="text-sm font-semibold text-red-700 mb-1">❌ 错误</h4>
          <p className="text-sm text-red-600 font-mono">{testError}</p>
        </div>
      )}

      {testResponse && (
        <div className="bg-white border border-gray-200 rounded-lg p-4" data-testid="test-response">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">✅ 响应</h4>
          <div className="bg-gray-50 rounded p-3 text-sm text-gray-800 whitespace-pre-wrap mb-3">
            {testResponse.content}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-600">Provider</div>
              <div className="font-mono">{testResponse.provider}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-600">Model</div>
              <div className="font-mono">{testResponse.model}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-600">Input Tokens</div>
              <div className="font-mono">{testResponse.usage.inputTokens}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-600">Output Tokens</div>
              <div className="font-mono">{testResponse.usage.outputTokens}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-600">Total Tokens</div>
              <div className="font-mono">{testResponse.usage.totalTokens}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-600">Duration</div>
              <div className="font-mono">{testResponse.durationMs}ms</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface UsageTabProps {
  totalUsage: AggregateUsage;
  byProvider: Record<ProviderName, AggregateUsage>;
  byModel: Record<string, AggregateUsage>;
  onReset: () => void;
}

const UsageTab: React.FC<UsageTabProps> = ({ totalUsage, byProvider, byModel, onReset }) => {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">总体统计</h3>
          <button
            onClick={onReset}
            data-testid="reset-usage-button"
            className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            重置
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatBox label="调用次数" value={totalUsage.callCount} />
          <StatBox label="Input Tokens" value={totalUsage.totalInputTokens.toLocaleString()} />
          <StatBox label="Output Tokens" value={totalUsage.totalOutputTokens.toLocaleString()} />
          <StatBox label="Total Tokens" value={totalUsage.totalTokens.toLocaleString()} />
          <StatBox label="总成本" value={`$${totalUsage.totalCost.toFixed(4)}`} />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">按 Provider</h3>
        {Object.keys(byProvider).length === 0 ? (
          <p className="text-xs text-gray-500">暂无数据</p>
        ) : (
          <div className="space-y-2">
            {(Object.entries(byProvider) as [ProviderName, AggregateUsage][]).map(([name, usage]) => (
              <div
                key={name}
                className="flex items-center justify-between p-2 bg-gray-50 rounded"
                data-testid={`usage-by-provider-${name}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{PROVIDER_DISPLAY[name]?.icon || '❓'}</span>
                  <span className="text-sm font-medium">{PROVIDER_DISPLAY[name]?.name || name}</span>
                </div>
                <div className="text-xs text-gray-600">
                  {usage.callCount} 次 · {usage.totalTokens.toLocaleString()} tokens · ${usage.totalCost.toFixed(4)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">按模型</h3>
        {Object.keys(byModel).length === 0 ? (
          <p className="text-xs text-gray-500">暂无数据</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(byModel).map(([model, usage]) => (
              <div
                key={model}
                className="flex items-center justify-between p-2 bg-gray-50 rounded"
                data-testid={`usage-by-model-${model}`}
              >
                <div className="font-mono text-sm">{model}</div>
                <div className="text-xs text-gray-600">
                  {usage.callCount} 次 · {usage.totalTokens.toLocaleString()} tokens
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const StatBox: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded p-3">
    <div className="text-xs text-gray-600">{label}</div>
    <div className="text-lg font-semibold text-gray-900 font-mono">{value}</div>
  </div>
);

export default LLMProviderPanel;
