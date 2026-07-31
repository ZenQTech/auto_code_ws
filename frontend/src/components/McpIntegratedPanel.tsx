/**
 * # ============================================================
 * # McpIntegratedPanel - MCP 集成智能体面板 (v1.0.0 Cycle 42 G42-04)
 * # ============================================================
 * # 核心作用：MCP × Hermes 深度融合的统一入口
 * #           - 集成 McpIntegratedAgentLoop 提供对话能力
 * #           - 展示可用 MCP 工具/资源/提示词
 * #           - 端到端执行：用户输入 → Agent → MCP 工具 → 结果
 * #           - 实时统计：工具调用、资源解析、提示词渲染
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-04 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  McpIntegratedAgentLoop,
  createMcpIntegratedAgentLoop,
  type McpAgentRunResult,
  type McpAgentRunOptions,
  type ToolExecutionDetail,
  type ResourceResolutionDetail,
  type PromptRenderDetail,
} from '../utils/mcpIntegratedAgentLoop';
import { getDefaultMcpServerRegistry, McpServerRegistry } from '../utils/mcpRegistry';
import { createMcpToolBridge, McpToolBridge } from '../utils/mcpToolBridge';
import {
  createMcpResourceBridge,
  McpResourceBridge,
  type ResourceInfo,
} from '../utils/mcpResourceBridge';
import {
  createMcpPromptBridge,
  McpPromptBridge,
  type HermesPromptDefinition,
} from '../utils/mcpPromptBridge';
import { MockProvider } from '../utils/llmProviderAdapter';
import type { ToolDefinition } from '../utils/toolUseEngine';

export interface McpIntegratedPanelProps {
  /** 关闭面板回调 */
  onClose: () => void;
  /** LLM Provider 名称（默认 mock） */
  llmProviderName?: string;
}

type TabKey = 'chat' | 'tools' | 'resources' | 'prompts';

export function McpIntegratedPanel({ onClose, llmProviderName = 'mock' }: McpIntegratedPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [userMessage, setUserMessage] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<McpAgentRunResult | null>(null);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string; ts: number }>>([]);
  const [stats, setStats] = useState<ReturnType<McpIntegratedAgentLoop['getStats']> | null>(null);

  // 创建集成引擎（单例）
  const { agentLoop, toolBridge, resourceBridge, promptBridge, registry, llm } = useMemo(() => {
    const reg = getDefaultMcpServerRegistry();
    const tb = createMcpToolBridge();
    const rb = createMcpResourceBridge();
    const pb = createMcpPromptBridge();
    const provider = new MockProvider();
    const agent = createMcpIntegratedAgentLoop({
      llmProvider: provider,
      mcpRegistry: reg,
      toolBridge: tb,
      resourceBridge: rb,
      promptBridge: pb,
      autoConnect: false,
    });
    return { agentLoop: agent, toolBridge: tb, resourceBridge: rb, promptBridge: pb, registry: reg, llm: provider };
  }, []);

  // 卸载时清理
  useEffect(() => {
    return () => {
      toolBridge.dispose();
      resourceBridge.dispose();
      promptBridge.dispose();
      agentLoop.dispose();
    };
  }, [agentLoop, toolBridge, resourceBridge, promptBridge]);

  // 当前可用工具/资源/提示词
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [resources, setResources] = useState<ResourceInfo[]>([]);
  const [prompts, setPrompts] = useState<HermesPromptDefinition[]>([]);

  const refreshLists = useCallback(() => {
    setTools(agentLoop.listAvailableTools());
    setResources(agentLoop.listAvailableResources());
    setPrompts(agentLoop.listAvailablePrompts());
  }, [agentLoop]);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  // 提交消息
  const handleSubmit = useCallback(async () => {
    if (!userMessage.trim() || running) return;
    setRunning(true);
    const ts = Date.now();
    setHistory((h) => [...h, { role: 'user', content: userMessage, ts }]);
    const currentMsg = userMessage;
    setUserMessage('');

    try {
      const options: McpAgentRunOptions = {
        mode: 'multi-step',
        maxSteps: 5,
      };
      const result = await agentLoop.runWithMcp(currentMsg, options);
      setLastResult(result);
      setHistory((h) => [
        ...h,
        { role: 'assistant', content: result.content || `(执行失败: ${result.error ?? '未知错误'})`, ts: Date.now() },
      ]);
      setStats(agentLoop.getStats());
      refreshLists();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setHistory((h) => [
        ...h,
        { role: 'assistant', content: `(异常: ${errMsg})`, ts: Date.now() },
      ]);
    } finally {
      setRunning(false);
    }
  }, [userMessage, running, agentLoop, refreshLists]);

  // 清空历史
  const handleClear = useCallback(() => {
    setHistory([]);
    setLastResult(null);
  }, []);

  // 切换服务器连接
  const handleToggleServer = useCallback(
    async (serverId: string) => {
      const status = registry.getStatus(serverId);
      try {
        if (status?.connected) {
          await registry.disconnect(serverId);
        } else {
          await registry.connect(serverId);
          const client = registry.getClient(serverId);
          if (client) {
            await toolBridge.registerServer(serverId, client);
            if (resourceBridge) await resourceBridge.registerServer(serverId, client).catch(() => {});
            if (promptBridge) await promptBridge.registerServer(serverId, client).catch(() => {});
          }
        }
        refreshLists();
      } catch (err) {
        // 静默
      }
    },
    [registry, toolBridge, resourceBridge, promptBridge, refreshLists],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e1e1e',
          color: '#e0e0e0',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '1200px',
          height: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '18px' }}>🚀 MCP 集成智能体 (McpIntegratedAgentLoop)</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
              MCP × Hermes 深度融合 · LLM ↔ Agent ↔ MCP 工具/资源/提示词 端到端链路
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: '24px',
              cursor: 'pointer',
            }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* 统计栏 */}
        <div
          style={{
            padding: '8px 20px',
            borderBottom: '1px solid #333',
            display: 'flex',
            gap: '20px',
            fontSize: '12px',
            color: '#aaa',
          }}
        >
          <span>🛠️ 工具: {tools.length}</span>
          <span>📦 资源: {resources.length}</span>
          <span>💬 提示词: {prompts.length}</span>
          <span>🔄 运行: {stats?.totalRuns ?? 0}</span>
          <span>✅ 成功: {stats?.successRuns ?? 0}</span>
          <span>🧪 LLM: {llmProviderName}</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          {(['chat', 'tools', 'resources', 'prompts'] as TabKey[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? '#2a2a2a' : 'transparent',
                border: 'none',
                color: activeTab === tab ? '#fff' : '#aaa',
                padding: '12px 20px',
                cursor: 'pointer',
                fontSize: '14px',
                borderBottom: activeTab === tab ? '2px solid #4a9eff' : '2px solid transparent',
              }}
            >
              {tab === 'chat' && '💬 对话'}
              {tab === 'tools' && `🛠️ 工具 (${tools.length})`}
              {tab === 'resources' && `📦 资源 (${resources.length})`}
              {tab === 'prompts' && `💬 提示词 (${prompts.length})`}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
          {activeTab === 'chat' && (
            <ChatTab
              userMessage={userMessage}
              setUserMessage={setUserMessage}
              running={running}
              history={history}
              lastResult={lastResult}
              onSubmit={handleSubmit}
              onClear={handleClear}
            />
          )}
          {activeTab === 'tools' && <ToolsTab tools={tools} />}
          {activeTab === 'resources' && <ResourcesTab resources={resources} />}
          {activeTab === 'prompts' && <PromptsTab prompts={prompts} />}
        </div>

        {/* 底部状态栏 */}
        <div
          style={{
            padding: '8px 20px',
            borderTop: '1px solid #333',
            fontSize: '11px',
            color: '#666',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>📡 MCP 协议 2024-11-05</span>
          <span>
            {running ? '⏳ 运行中...' : lastResult ? `✓ 上次: ${lastResult.steps}步 / ${lastResult.totalTokens} tokens` : '空闲'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============ 子组件：对话 Tab ============

interface ChatTabProps {
  userMessage: string;
  setUserMessage: (s: string) => void;
  running: boolean;
  history: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
  lastResult: McpAgentRunResult | null;
  onSubmit: () => void;
  onClear: () => void;
}

function ChatTab({ userMessage, setUserMessage, running, history, lastResult, onSubmit, onClear }: ChatTabProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      {/* 历史 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: '#2a2a2a',
          borderRadius: '8px',
          padding: '12px',
          minHeight: '300px',
        }}
      >
        {history.length === 0 ? (
          <div style={{ color: '#666', textAlign: 'center', padding: '40px 0' }}>
            <p>💡 提示: 在输入框中:</p>
            <p style={{ fontSize: '12px' }}>
              • 使用 <code style={{ background: '#333', padding: '2px 4px' }}>@mcp://serverId/uri</code> 引用资源
            </p>
            <p style={{ fontSize: '12px' }}>
              • 使用 <code style={{ background: '#333', padding: '2px 4px' }}>/prompt mcp:server::name key=val</code> 注入提示词
            </p>
            <p style={{ fontSize: '12px' }}>
              • 工具调用由 LLM 自动决策
            </p>
          </div>
        ) : (
          history.map((h, i) => (
            <div
              key={i}
              style={{
                marginBottom: '12px',
                padding: '8px 12px',
                background: h.role === 'user' ? '#1e3a5f' : '#2d4a3e',
                borderRadius: '6px',
              }}
            >
              <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>
                {h.role === 'user' ? '👤 用户' : '🤖 助手'} · {new Date(h.ts).toLocaleTimeString()}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px' }}>{h.content}</div>
            </div>
          ))
        )}
      </div>

      {/* 输入框 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <textarea
          ref={inputRef}
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              onSubmit();
            }
          }}
          placeholder="输入消息，使用 @mcp:// 引用资源，Ctrl/⌘+Enter 发送..."
          disabled={running}
          style={{
            flex: 1,
            minHeight: '60px',
            maxHeight: '120px',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: '6px',
            color: '#e0e0e0',
            fontSize: '13px',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button
            onClick={onSubmit}
            disabled={running || !userMessage.trim()}
            style={{
              padding: '8px 16px',
              background: running || !userMessage.trim() ? '#444' : '#4a9eff',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: running || !userMessage.trim() ? 'not-allowed' : 'pointer',
              fontSize: '13px',
            }}
          >
            {running ? '⏳ 运行中' : '▶ 发送'}
          </button>
          <button
            onClick={onClear}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid #555',
              borderRadius: '6px',
              color: '#aaa',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            清空
          </button>
        </div>
      </div>

      {/* 详细执行结果 */}
      {lastResult && (
        <details
          style={{
            background: '#2a2a2a',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '12px',
          }}
        >
          <summary style={{ cursor: 'pointer', color: '#4a9eff' }}>
            🔍 执行详情 ({lastResult.steps} 步, {lastResult.toolExecutions.length} 工具调用, {lastResult.resourceResolutions.length} 资源解析, {lastResult.promptRenders.length} 提示词)
          </summary>
          <div style={{ marginTop: '8px' }}>
            {lastResult.toolExecutions.map((t: ToolExecutionDetail, i: number) => (
              <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #333' }}>
                <code style={{ color: '#7dd87d' }}>{t.toolName}</code> ({t.durationMs}ms)
                <span style={{ marginLeft: '8px', color: t.result.success ? '#7dd87d' : '#f77' }}>
                  {t.result.success ? '✓' : '✗'}
                </span>
              </div>
            ))}
            {lastResult.resourceResolutions.map((r: ResourceResolutionDetail, i: number) => (
              <div key={`r${i}`} style={{ padding: '4px 0', borderBottom: '1px solid #333' }}>
                📦 <code style={{ color: '#ffd87d' }}>{r.uri}</code> ({r.durationMs}ms)
                {r.error && <span style={{ color: '#f77' }}> 错误: {r.error}</span>}
              </div>
            ))}
            {lastResult.promptRenders.map((p: PromptRenderDetail, i: number) => (
              <div key={`p${i}`} style={{ padding: '4px 0', borderBottom: '1px solid #333' }}>
                💬 <code style={{ color: '#d87dff' }}>{p.qualifiedName}</code> ({p.durationMs}ms)
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ============ 子组件：工具 Tab ============

function ToolsTab({ tools }: { tools: ToolDefinition[] }) {
  if (tools.length === 0) {
    return <EmptyState icon="🛠️" text="暂无可用工具，连接 MCP 服务器后会自动发现工具" />;
  }
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {tools.map((t) => (
        <div
          key={t.name}
          style={{
            background: '#2a2a2a',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #333',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: t.name.startsWith('mcp__') ? '#7dd87d' : '#ffd87d' }}>
              {t.name.startsWith('mcp__') ? '🟢' : '🟡'}
            </span>
            <code style={{ fontSize: '13px', color: '#fff' }}>{t.name}</code>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                background: '#333',
                borderRadius: '4px',
                color: '#aaa',
              }}
            >
              {t.permission ?? 'unknown'}
            </span>
          </div>
          {t.description && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#aaa' }}>{t.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ============ 子组件：资源 Tab ============

function ResourcesTab({ resources }: { resources: ResourceInfo[] }) {
  if (resources.length === 0) {
    return <EmptyState icon="📦" text="暂无可用资源，连接 MCP 服务器后会自动发现资源" />;
  }
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {resources.map((r) => (
        <div
          key={r.uri}
          style={{
            background: '#2a2a2a',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #333',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📄</span>
            <code style={{ fontSize: '12px', color: '#fff' }}>{r.uri}</code>
            {r.mimeType && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  background: '#333',
                  borderRadius: '4px',
                  color: '#aaa',
                }}
              >
                {r.mimeType}
              </span>
            )}
          </div>
          {r.description && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#aaa' }}>{r.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ============ 子组件：提示词 Tab ============

function PromptsTab({ prompts }: { prompts: HermesPromptDefinition[] }) {
  if (prompts.length === 0) {
    return <EmptyState icon="💬" text="暂无可用提示词，连接 MCP 服务器后会自动发现提示词" />;
  }
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {prompts.map((p) => (
        <div
          key={p.qualifiedName}
          style={{
            background: '#2a2a2a',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #333',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>💬</span>
            <code style={{ fontSize: '12px', color: '#fff' }}>{p.qualifiedName}</code>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                background: '#333',
                borderRadius: '4px',
                color: '#aaa',
              }}
            >
              {p.serverName}
            </span>
          </div>
          {p.description && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#aaa' }}>{p.description}</p>
          )}
          {p.arguments.length > 0 && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
              参数: {p.arguments.map((a) => `${a.name}${a.required ? '*' : ''}`).join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============ 子组件：空状态 ============

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: '#666' }}>
      <div style={{ fontSize: '48px', marginBottom: '12px' }}>{icon}</div>
      <p>{text}</p>
    </div>
  );
}
