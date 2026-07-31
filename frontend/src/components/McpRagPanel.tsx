/**
 * # ============================================================
 * # McpRagPanel - MCP × RAG 智能体面板 (v1.0.0 Cycle 45 G45-04)
 * # ============================================================
 * # 核心作用：MCP × Hermes × RAG 深度融合的统一入口
 * #           - 集成 McpRagAgent 提供 RAG 智能体能力
 * #           - 4 Tab：智能对话 / 资源索引 / 工具检索 / 历史记录
 * #           - 资源 RAG + 工具 RAG + 提示词 RAG 三源融合
 * #           - 完整执行步骤可视化
 * #           - 决策策略实时切换
 * # ====================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 45 G45-04 初次创建
 * # ====================================
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  McpRagAgent,
  createMcpRagAgent,
  type McpRagAgentResult,
  type McpRagAgentStep,
  type AgentPhase,
  type RagDecision,
} from '../utils/mcpRagAgent';
import { createMcpRagEngine, McpRagEngine } from '../utils/mcpRagEngine';
import { createMcpToolRagSource, McpToolRagSource } from '../utils/mcpToolRagSource';
import { getDefaultMcpServerRegistry, McpServerRegistry } from '../utils/mcpRegistry';
import { MockProvider } from '../utils/llmProviderAdapter';

export interface McpRagPanelProps {
  /** 关闭面板回调 */
  onClose: () => void;
  /** LLM Provider 名称（默认 mock） */
  llmProviderName?: string;
}

type TabKey = 'chat' | 'resource' | 'tool' | 'history';

interface HistoryItem {
  id: string;
  query: string;
  result: McpRagAgentResult;
  timestamp: number;
}

const PHASE_LABELS: Record<AgentPhase, string> = {
  analyzing: '分析查询',
  'retrieving-resources': '检索资源',
  'retrieving-tools': '调用工具',
  assembling: '组装上下文',
  generating: '生成回答',
  done: '完成',
  error: '出错',
};

const DECISION_LABELS: Record<RagDecision, string> = {
  'resource-only': '仅资源',
  'tool-only': '仅工具',
  hybrid: '混合模式',
  auto: '自动决策',
};

const DECISION_DESCRIPTIONS: Record<RagDecision, string> = {
  'resource-only': '仅从持久化 RAG 知识库检索',
  'tool-only': '仅调用 MCP 工具获取实时数据',
  hybrid: '同时使用资源 RAG 和工具 RAG',
  auto: '基于查询自动选择最佳策略',
};

export function McpRagPanel({ onClose, llmProviderName = 'mock' }: McpRagPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [query, setQuery] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [currentResult, setCurrentResult] = useState<McpRagAgentResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [decision, setDecision] = useState<RagDecision>('auto');

  // 资源索引
  const [resourceServerId, setResourceServerId] = useState<string>('fs');
  const [resourceUri, setResourceUri] = useState<string>('file:///sample.txt');
  const [resourceName, setResourceName] = useState<string>('sample.txt');
  const [resourceText, setResourceText] = useState<string>('Sample content for testing RAG retrieval.');
  const [indexingStatus, setIndexingStatus] = useState<string>('');

  // 工具调用
  const [toolServerId, setToolServerId] = useState<string>('fs');
  const [toolName, setToolName] = useState<string>('read_file');
  const [toolArgs, setToolArgs] = useState<string>('{"path": "/test.txt"}');
  const [toolCallResult, setToolCallResult] = useState<string>('');

  // 服务管理
  const [registry] = useState<McpServerRegistry>(() => getDefaultMcpServerRegistry());
  const [ragEngine] = useState<McpRagEngine>(() => createMcpRagEngine({}));
  const [toolSource] = useState<McpToolRagSource>(() =>
    createMcpToolRagSource({ ragEngine, registry })
  );
  const [agent] = useState<McpRagAgent>(() => createMcpRagAgent(ragEngine, toolSource));

  // 注入 LLM
  useEffect(() => {
    const llm = new MockProvider();
    (ragEngine as any).llmProvider = llm;
  }, [ragEngine]);

  // 统计
  const [agentStats, setAgentStats] = useState<ReturnType<McpRagAgent['getStats']> | null>(null);
  const [toolStats, setToolStats] = useState<ReturnType<McpToolRagSource['getStats']> | null>(null);

  const refreshStats = useCallback(() => {
    setAgentStats(agent.getStats());
    setToolStats(toolSource.getStats());
  }, [agent, toolSource]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats, currentResult]);

  // ============ 智能对话 ============

  const runAgent = useCallback(async () => {
    if (!query.trim() || running) return;
    setRunning(true);
    setCurrentResult(null);

    try {
      const result = await agent.run(query, {
        decision,
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'read_file', args: { path: '/test.txt' } },
          ],
        },
      });
      setCurrentResult(result);
      setHistory((prev) => [
        {
          id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          query,
          result,
          timestamp: Date.now(),
        },
        ...prev,
      ].slice(0, 50));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setCurrentResult({
        answer: `Error: ${errorMsg}`,
        resourceHits: [],
        toolResults: [],
        toolHits: [],
        citations: [],
        metadata: {
          query,
          decision,
          totalTimeMs: 0,
          retrievalTimeMs: 0,
          toolTimeMs: 0,
          generationTimeMs: 0,
          resourceCount: 0,
          toolCount: 0,
          usePrompt: false,
          timestamp: Date.now(),
        },
        steps: [],
      });
    } finally {
      setRunning(false);
      refreshStats();
    }
  }, [query, running, agent, decision, refreshStats]);

  // ============ 资源索引 ============

  const indexResource = useCallback(async () => {
    setIndexingStatus('Indexing...');
    try {
      const entry = await ragEngine.indexResource(resourceServerId, resourceUri, {
        preloadedContent: {
          text: resourceText,
          name: resourceName,
          mimeType: 'text/plain',
        },
      });
      setIndexingStatus(`✓ Indexed: ${entry.id} (${entry.chunkCount} chunks)`);
    } catch (err) {
      setIndexingStatus(`✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    refreshStats();
  }, [ragEngine, resourceServerId, resourceUri, resourceName, resourceText, refreshStats]);

  // ============ 工具调用 ============

  const callTool = useCallback(async () => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolArgs);
    } catch (err) {
      setToolCallResult(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setToolCallResult('Calling...');
    try {
      const result = await toolSource.callTool(toolServerId, toolName, args);
      setToolCallResult(JSON.stringify({
        success: result.success,
        kind: result.kind,
        text: result.text.substring(0, 500),
        durationMs: result.durationMs,
        error: result.error,
      }, null, 2));
    } catch (err) {
      setToolCallResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    refreshStats();
  }, [toolSource, toolServerId, toolName, toolArgs, refreshStats]);

  // ============ UI 渲染辅助 ============

  const formatTime = (ms: number) => {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e1e1e',
          color: '#e0e0e0',
          borderRadius: 8,
          width: '90vw',
          maxWidth: 1100,
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#252525',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>📚 MCP × RAG 智能体面板</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#999' }}>
              资源 RAG + 工具 RAG + 提示词 RAG 三源融合
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #555',
              color: '#e0e0e0',
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #333',
            background: '#1a1a1a',
          }}
        >
          {(['chat', 'resource', 'tool', 'history'] as TabKey[]).map((tab) => {
            const labels: Record<TabKey, string> = {
              chat: '💬 智能对话',
              resource: '📁 资源索引',
              tool: '🔧 工具检索',
              history: '📜 历史记录',
            };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: activeTab === tab ? '#2a2a2a' : 'transparent',
                  color: activeTab === tab ? '#fff' : '#aaa',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #4a9eff' : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: activeTab === tab ? 'bold' : 'normal',
                }}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Stats Bar */}
        {(agentStats || toolStats) && (
          <div
            style={{
              padding: '8px 20px',
              background: '#1a1a1a',
              borderBottom: '1px solid #333',
              fontSize: 11,
              color: '#888',
              display: 'flex',
              gap: 20,
              flexWrap: 'wrap',
            }}
          >
            {agentStats && (
              <>
                <span>🤖 Agent: {agentStats.totalRuns} runs, {agentStats.successRuns} success</span>
                <span>📊 Avg: {formatTime(agentStats.avgTotalTimeMs)}</span>
                <span>📁 Resources: {agentStats.totalResourceHits} hits</span>
                <span>🔧 Tools: {agentStats.totalToolHits} hits</span>
              </>
            )}
            {toolStats && (
              <>
                <span>🔌 Tool calls: {toolStats.totalCalls} (success: {toolStats.successCalls})</span>
                <span>💾 Cache: {toolStats.cacheSize}/{toolStats.cacheHits} hits</span>
              </>
            )}
          </div>
        )}

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 20,
          }}
        >
          {activeTab === 'chat' && (
            <ChatTab
              query={query}
              setQuery={setQuery}
              decision={decision}
              setDecision={setDecision}
              running={running}
              onRun={runAgent}
              result={currentResult}
            />
          )}
          {activeTab === 'resource' && (
            <ResourceTab
              serverId={resourceServerId}
              setServerId={setResourceServerId}
              uri={resourceUri}
              setUri={setResourceUri}
              name={resourceName}
              setName={setResourceName}
              text={resourceText}
              setText={setResourceText}
              status={indexingStatus}
              onIndex={indexResource}
            />
          )}
          {activeTab === 'tool' && (
            <ToolTab
              serverId={toolServerId}
              setServerId={setToolServerId}
              toolName={toolName}
              setToolName={setToolName}
              toolArgs={toolArgs}
              setToolArgs={setToolArgs}
              result={toolCallResult}
              onCall={callTool}
            />
          )}
          {activeTab === 'history' && (
            <HistoryTab history={history} formatTime={formatTime} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 子组件 ============

interface ChatTabProps {
  query: string;
  setQuery: (v: string) => void;
  decision: RagDecision;
  setDecision: (d: RagDecision) => void;
  running: boolean;
  onRun: () => void;
  result: McpRagAgentResult | null;
}

function ChatTab({ query, setQuery, decision, setDecision, running, onRun, result }: ChatTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* 决策选择 */}
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 6 }}>
          决策策略
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['auto', 'resource-only', 'tool-only', 'hybrid'] as RagDecision[]).map((d) => (
            <button
              key={d}
              onClick={() => setDecision(d)}
              title={DECISION_DESCRIPTIONS[d]}
              style={{
                padding: '6px 12px',
                background: decision === d ? '#4a9eff' : '#2a2a2a',
                color: decision === d ? '#fff' : '#ccc',
                border: '1px solid #444',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {DECISION_LABELS[d]}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: '#888', margin: '4px 0 0 0' }}>
          {DECISION_DESCRIPTIONS[decision]}
        </p>
      </div>

      {/* 查询输入 */}
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 6 }}>
          查询
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入查询... 例如：'什么是 TypeScript？' 或 '获取 https://example.com 的内容'"
          style={{
            width: '100%',
            minHeight: 80,
            padding: 10,
            background: '#252525',
            color: '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 4,
            fontSize: 13,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </div>

      <button
        onClick={onRun}
        disabled={running || !query.trim()}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 20px',
          background: running ? '#555' : '#4a9eff',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: running ? 'wait' : 'pointer',
          fontSize: 13,
          fontWeight: 'bold',
        }}
      >
        {running ? '运行中...' : '🚀 执行查询'}
      </button>

      {/* 结果展示 */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ResultDisplay result={result} />
        </div>
      )}
    </div>
  );
}

function ResultDisplay({ result }: { result: McpRagAgentResult }) {
  return (
    <>
      {/* Metadata */}
      <div
        style={{
          padding: 10,
          background: '#252525',
          borderRadius: 4,
          fontSize: 12,
          color: '#ccc',
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>📊 决策: <strong>{DECISION_LABELS[result.metadata.decision]}</strong></span>
          <span>⏱️ 总耗时: {result.metadata.totalTimeMs.toFixed(0)}ms</span>
          <span>📁 资源: {result.metadata.resourceCount} hits</span>
          <span>🔧 工具: {result.metadata.toolCount} calls</span>
          {result.metadata.totalTokens && (
            <span>🎫 Tokens: {result.metadata.totalTokens}</span>
          )}
        </div>
      </div>

      {/* Steps */}
      {result.steps.length > 0 && (
        <div
          style={{
            padding: 10,
            background: '#1f1f1f',
            borderRadius: 4,
            fontSize: 12,
            color: '#aaa',
          }}
        >
          <h4 style={{ margin: '0 0 8px 0', fontSize: 13 }}>执行步骤</h4>
          {result.steps.map((step, idx) => (
            <div
              key={idx}
              style={{
                padding: '4px 0',
                borderBottom: idx < result.steps.length - 1 ? '1px solid #333' : 'none',
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  background: step.phase === 'error' ? '#5a2a2a' : '#2a4a5a',
                  color: '#fff',
                  borderRadius: 3,
                }}
              >
                {PHASE_LABELS[step.phase]}
              </span>
              <span>{step.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Answer */}
      <div
        style={{
          padding: 12,
          background: '#1a2a3a',
          borderRadius: 4,
          fontSize: 13,
          color: '#e0e0e0',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#4a9eff' }}>💡 答案</h4>
        {result.answer}
      </div>

      {/* Resource Hits */}
      {result.resourceHits.length > 0 && (
        <div
          style={{
            padding: 10,
            background: '#1f2a1f',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#4a9eff' }}>
            📁 资源命中 ({result.resourceHits.length})
          </h4>
          {result.resourceHits.map((hit, idx) => (
            <div
              key={idx}
              style={{
                padding: 6,
                background: '#252525',
                borderRadius: 3,
                marginBottom: 4,
                fontSize: 11,
                color: '#ccc',
              }}
            >
              <div style={{ color: '#4a9eff' }}>
                [{idx + 1}] {hit.type} (score: {hit.score.toFixed(3)})
              </div>
              <div>{hit.content.substring(0, 200)}{hit.content.length > 200 ? '...' : ''}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tool Results */}
      {result.toolResults.length > 0 && (
        <div
          style={{
            padding: 10,
            background: '#2a1f2a',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#4a9eff' }}>
            🔧 工具调用 ({result.toolResults.length})
          </h4>
          {result.toolResults.map((tr, idx) => (
            <div
              key={idx}
              style={{
                padding: 6,
                background: '#252525',
                borderRadius: 3,
                marginBottom: 4,
                fontSize: 11,
                color: '#ccc',
              }}
            >
              <div style={{ color: tr.success ? '#4ade80' : '#f87171' }}>
                [{idx + 1}] {tr.toolName}@{tr.serverId} - {tr.success ? '✓' : '✗'} ({tr.durationMs}ms)
              </div>
              <div>{tr.text.substring(0, 200)}{tr.text.length > 200 ? '...' : ''}</div>
            </div>
          ))}
        </div>
      )}

      {/* Citations */}
      {result.citations.length > 0 && (
        <div
          style={{
            padding: 10,
            background: '#1f1f2a',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#4a9eff' }}>
            📑 引用 ({result.citations.length})
          </h4>
          {result.citations.slice(0, 5).map((c, idx) => (
            <div
              key={idx}
              style={{
                padding: 4,
                fontSize: 11,
                color: '#aaa',
              }}
            >
              [{idx + 1}] {c.source} (relevance: {c.relevanceScore.toFixed(3)})
            </div>
          ))}
        </div>
      )}
    </>
  );
}

interface ResourceTabProps {
  serverId: string;
  setServerId: (v: string) => void;
  uri: string;
  setUri: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  status: string;
  onIndex: () => void;
}

function ResourceTab(props: ResourceTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>索引 MCP 资源到 RAG 知识库</h3>
      <FormField label="服务器 ID" value={props.serverId} onChange={props.setServerId} />
      <FormField label="资源 URI" value={props.uri} onChange={props.setUri} />
      <FormField label="资源名称" value={props.name} onChange={props.setName} />
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 6 }}>
          资源内容
        </label>
        <textarea
          value={props.text}
          onChange={(e) => props.setText(e.target.value)}
          style={{
            width: '100%',
            minHeight: 120,
            padding: 10,
            background: '#252525',
            color: '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 4,
            fontSize: 13,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <button
        onClick={props.onIndex}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 20px',
          background: '#4a9eff',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 'bold',
        }}
      >
        📥 索引资源
      </button>
      {props.status && (
        <div
          style={{
            padding: 10,
            background: '#252525',
            borderRadius: 4,
            fontSize: 12,
            color: props.status.startsWith('✓') ? '#4ade80' : props.status.startsWith('✗') ? '#f87171' : '#ccc',
            fontFamily: 'monospace',
          }}
        >
          {props.status}
        </div>
      )}
    </div>
  );
}

interface ToolTabProps {
  serverId: string;
  setServerId: (v: string) => void;
  toolName: string;
  setToolName: (v: string) => void;
  toolArgs: string;
  setToolArgs: (v: string) => void;
  result: string;
  onCall: () => void;
}

function ToolTab(props: ToolTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>调用 MCP 工具并加入 RAG 上下文</h3>
      <FormField label="服务器 ID" value={props.serverId} onChange={props.setServerId} />
      <FormField label="工具名" value={props.toolName} onChange={props.setToolName} />
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 6 }}>
          工具参数 (JSON)
        </label>
        <textarea
          value={props.toolArgs}
          onChange={(e) => props.setToolArgs(e.target.value)}
          style={{
            width: '100%',
            minHeight: 60,
            padding: 10,
            background: '#252525',
            color: '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            resize: 'vertical',
          }}
        />
      </div>
      <button
        onClick={props.onCall}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 20px',
          background: '#4a9eff',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 'bold',
        }}
      >
        🔌 调用工具
      </button>
      {props.result && (
        <div
          style={{
            padding: 10,
            background: '#252525',
            borderRadius: 4,
            fontSize: 11,
            color: '#ccc',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          {props.result}
        </div>
      )}
    </div>
  );
}

function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          background: '#252525',
          color: '#e0e0e0',
          border: '1px solid #444',
          borderRadius: 4,
          fontSize: 13,
        }}
      />
    </div>
  );
}

interface HistoryTabProps {
  history: HistoryItem[];
  formatTime: (ms: number) => string;
}

function HistoryTab({ history, formatTime }: HistoryTabProps) {
  if (history.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>
        暂无历史记录
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {history.map((item) => (
        <div
          key={item.id}
          style={{
            padding: 12,
            background: '#252525',
            borderRadius: 4,
            fontSize: 12,
            color: '#ccc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ color: '#4a9eff' }}>Q: {item.query}</strong>
            <span style={{ fontSize: 10, color: '#888' }}>
              {new Date(item.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
            {DECISION_LABELS[item.result.metadata.decision]} · {formatTime(item.result.metadata.totalTimeMs)} · {item.result.metadata.resourceCount} res · {item.result.metadata.toolCount} tools
          </div>
          <div style={{ fontSize: 12, color: '#ddd', whiteSpace: 'pre-wrap' }}>
            {item.result.answer.substring(0, 200)}{item.result.answer.length > 200 ? '...' : ''}
          </div>
        </div>
      ))}
    </div>
  );
}
