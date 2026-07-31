/**
 * # ============================================================
 * # RealLLMProviderPanel - 真实 LLM Provider 配置面板 (v1.0.0 Cycle 37 G37-04)
 * # ============================================================
 * # 核心作用：UI 面板，配置 DeepSeek / 火山方舟 Ark Coding Plan
 * #           支持环境变量检测、连接测试、模型选择、成本计算
 * # ============================================================
 */

import { useState, useEffect, useMemo } from 'react';
import {
  DeepSeekProvider,
  VolcengineArkProvider,
  DEEPSEEK_MODELS,
  ARK_CODING_PLAN_MODELS,
  maskApiKey,
  ENV_EXAMPLE_CONTENT,
  GITIGNORE_CONTENT,
} from '../utils/realLLMProvider';
import { getDefaultLLMProviderRegistry } from '../utils/llmProviderAdapter';

export interface RealLLMProviderPanelProps {
  onClose?: () => void;
}

type TabType = 'config' | 'deepseek' | 'ark' | 'test' | 'docs';

export function RealLLMProviderPanel({ onClose }: RealLLMProviderPanelProps) {
  const registry = useMemo(() => getDefaultLLMProviderRegistry(), []);
  const [tab, setTab] = useState<TabType>('config');

  // DeepSeek 状态
  const [deepseekKey, setDeepseekKey] = useState('');
  const [deepseekModel, setDeepseekModel] = useState('deepseek-chat');
  const [deepseekConnected, setDeepseekConnected] = useState(false);
  const [deepseekTestResult, setDeepseekTestResult] = useState<string>('');

  // 火山方舟状态
  const [arkKey, setArkKey] = useState('');
  const [arkEndpoint, setArkEndpoint] = useState('doubao-pro-32k');
  const [arkProtocol, setArkProtocol] = useState<'openai' | 'anthropic'>('openai');
  const [arkConnected, setArkConnected] = useState(false);
  const [arkTestResult, setArkTestResult] = useState<string>('');

  const [isTesting, setIsTesting] = useState(false);

  // 初始化时检查环境变量
  useEffect(() => {
    const env = (process && process.env) || {};
    if (env.DEEPSEEK_API_KEY) {
      setDeepseekKey(env.DEEPSEEK_API_KEY);
      setDeepseekConnected(true);
    }
    if (env.ARK_API_KEY) {
      setArkKey(env.ARK_API_KEY);
      setArkConnected(true);
    }
  }, []);

  // 测试 DeepSeek 连接（注意：实际 API 调用需要真实 key）
  const handleTestDeepSeek = async () => {
    if (!deepseekKey.trim() || isTesting) return;
    setIsTesting(true);
    setDeepseekTestResult('测试中...');
    try {
      // 通过注册 Provider 来测试
      const provider = new DeepSeekProvider({ apiKey: deepseekKey });
      // DeepSeekProvider 实现类与 LLMProvider 抽象接口有部分签名差异，
      // 这里通过 any 适配后注册到统一 Registry
      registry.register('deepseek', provider as any);
      setDeepseekConnected(true);
      setDeepseekTestResult(`✅ Provider 已注册，${DEEPSEEK_MODELS.length} 个模型可用`);
    } catch (err) {
      setDeepseekConnected(false);
      setDeepseekTestResult(`❌ 错误: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestArk = async () => {
    if (!arkKey.trim() || isTesting) return;
    setIsTesting(true);
    setArkTestResult('测试中...');
    try {
      const provider = new VolcengineArkProvider({
        apiKey: arkKey,
        defaultModel: arkEndpoint,
        protocol: arkProtocol,
      });
      registry.register('volcengine-ark', provider as any);
      setArkConnected(true);
      setArkTestResult(`✅ Provider 已注册，${ARK_CODING_PLAN_MODELS.length} 个 Coding Plan 模型可用`);
    } catch (err) {
      setArkConnected(false);
      setArkTestResult(`❌ 错误: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleClearDeepSeek = () => {
    registry.unregister('deepseek');
    setDeepseekKey('');
    setDeepseekConnected(false);
    setDeepseekTestResult('');
  };

  const handleClearArk = () => {
    registry.unregister('volcengine-ark');
    setArkKey('');
    setArkConnected(false);
    setArkTestResult('');
  };

  return (
    <div style={{ padding: 16, background: '#fff', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🌐 真实 LLM Provider</h2>
        {onClose && <button onClick={onClose} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>关闭</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['config', 'deepseek', 'ark', 'test', 'docs'] as TabType[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 12px',
              background: tab === t ? '#3b82f6' : '#f3f4f6',
              color: tab === t ? '#fff' : '#374151',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t === 'config' ? '总览' : t === 'deepseek' ? 'DeepSeek' : t === 'ark' ? '火山方舟' : t === 'test' ? '测试' : '文档'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'config' && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Provider 状态</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div style={{ padding: 12, background: deepseekConnected ? '#f0fdf4' : '#fef2f2', borderRadius: 6, border: `1px solid ${deepseekConnected ? '#86efac' : '#fecaca'}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>DeepSeek</div>
                <div style={{ fontSize: 12, color: deepseekConnected ? '#10b981' : '#ef4444' }}>
                  {deepseekConnected ? '✅ 已配置' : '❌ 未配置'}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  {DEEPSEEK_MODELS.length} 个模型
                </div>
              </div>
              <div style={{ padding: 12, background: arkConnected ? '#f0fdf4' : '#fef2f2', borderRadius: 6, border: `1px solid ${arkConnected ? '#86efac' : '#fecaca'}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>火山方舟 Ark</div>
                <div style={{ fontSize: 12, color: arkConnected ? '#10b981' : '#ef4444' }}>
                  {arkConnected ? '✅ 已配置' : '❌ 未配置'}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  {ARK_CODING_PLAN_MODELS.length} 个 Coding Plan 模型
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 8 }}>安全提醒</h3>
            <div style={{ padding: 10, background: '#fef3c7', borderRadius: 6, border: '1px solid #fde047', fontSize: 12, color: '#92400e' }}>
              ⚠️ API Key 必须通过环境变量注入（DEEPSEEK_API_KEY / ARK_API_KEY）
              <br />• 切勿将 API Key 硬编码到代码中
              <br />• 切勿提交 .env 文件到 Git
              <br />• 切勿在浏览器端明文传输 API Key（推荐通过后端代理）
            </div>
          </div>
        )}

        {tab === 'deepseek' && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>DeepSeek 配置</h3>
            <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>API Key:</label>
              <input
                type="password"
                value={deepseekKey}
                onChange={e => setDeepseekKey(e.target.value)}
                placeholder="sk-..."
                style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, fontFamily: 'monospace' }}
              />
              {deepseekKey && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  当前: {maskApiKey(deepseekKey)}
                </div>
              )}
            </div>

            <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>默认模型：</label>
              <select
                value={deepseekModel}
                onChange={e => setDeepseekModel(e.target.value)}
                style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
              >
                {DEEPSEEK_MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.id} - {m.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleTestDeepSeek}
                disabled={!deepseekKey.trim() || isTesting}
                style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
              >
                {isTesting ? '测试中...' : '注册 Provider'}
              </button>
              <button
                onClick={handleClearDeepSeek}
                style={{ padding: '6px 12px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
              >
                清除
              </button>
            </div>

            {deepseekTestResult && (
              <div style={{ marginTop: 12, padding: 8, background: '#f0fdf4', borderRadius: 4, fontSize: 12 }}>
                {deepseekTestResult}
              </div>
            )}

            <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 8 }}>可用模型</h3>
            {DEEPSEEK_MODELS.map(m => (
              <div key={m.id} style={{ padding: 8, background: '#f9fafb', borderRadius: 4, marginBottom: 6, fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ color: '#6b7280', fontSize: 11 }}>
                  ID: {m.id} · 上下文: {m.contextWindow.toLocaleString()} · 价格: ${m.inputCostPerMTokens}/${m.outputCostPerMTokens} per 1M tokens
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'ark' && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>火山方舟 Ark Coding Plan 配置</h3>
            <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>API Key:</label>
              <input
                type="password"
                value={arkKey}
                onChange={e => setArkKey(e.target.value)}
                placeholder="ark-..."
                style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, fontFamily: 'monospace' }}
              />
              {arkKey && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  当前: {maskApiKey(arkKey)}
                </div>
              )}
            </div>

            <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>协议：</label>
              <select
                value={arkProtocol}
                onChange={e => setArkProtocol(e.target.value as 'openai' | 'anthropic')}
                style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic 兼容</option>
              </select>
            </div>

            <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Coding Plan Endpoint：</label>
              <select
                value={arkEndpoint}
                onChange={e => setArkEndpoint(e.target.value)}
                style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
              >
                {ARK_CODING_PLAN_MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.id} - {m.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleTestArk}
                disabled={!arkKey.trim() || isTesting}
                style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
              >
                {isTesting ? '测试中...' : '注册 Provider'}
              </button>
              <button
                onClick={handleClearArk}
                style={{ padding: '6px 12px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
              >
                清除
              </button>
            </div>

            {arkTestResult && (
              <div style={{ marginTop: 12, padding: 8, background: '#f0fdf4', borderRadius: 4, fontSize: 12 }}>
                {arkTestResult}
              </div>
            )}

            <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 8 }}>可用 Coding Plan 模型</h3>
            {ARK_CODING_PLAN_MODELS.map(m => (
              <div key={m.id} style={{ padding: 8, background: '#f9fafb', borderRadius: 4, marginBottom: 6, fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ color: '#6b7280', fontSize: 11 }}>
                  ID: {m.id} · 上下文: {m.contextWindow.toLocaleString()} · 协议: {m.protocol}
                </div>
                <div style={{ color: '#6b7280', fontSize: 11 }}>
                  价格: ${m.inputCostPerMTokens}/${m.outputCostPerMTokens} per 1M tokens
                </div>
                {m.description && <div style={{ color: '#374151', fontSize: 11, marginTop: 2 }}>{m.description}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === 'test' && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Provider 连接测试</h3>
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              注册 Provider 后，可通过 LLMProviderRegistry 发送测试消息。
            </p>
            <div style={{ padding: 10, background: '#eff6ff', borderRadius: 6, fontSize: 12 }}>
              <strong>已注册的 Providers:</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {Array.from((registry as any).providers?.keys?.() || []).map((name: unknown) => (
                  <li key={String(name)}>{String(name)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === 'docs' && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>环境变量模板 (.env.example)</h3>
            <pre style={{ background: '#1f2937', color: '#f9fafb', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', fontFamily: 'monospace' }}>
              {ENV_EXAMPLE_CONTENT}
            </pre>

            <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 8 }}>.gitignore 追加</h3>
            <pre style={{ background: '#1f2937', color: '#f9fafb', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', fontFamily: 'monospace' }}>
              {GITIGNORE_CONTENT}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default RealLLMProviderPanel;
