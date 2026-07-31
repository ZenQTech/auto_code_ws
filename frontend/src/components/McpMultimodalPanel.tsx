/**
 * # ============================================================
 * # McpMultimodalPanel - 多模态智能体面板 (v1.0.0 Cycle 44 G44-04)
 * # ============================================================
 * # 核心作用：MCP × Hermes × 多模态深度融合的统一入口
 * #           - 集成 MultimodalAgentLoop 提供多模态对话能力
 * #           - 支持图像/音频/文件多模态输入
 * #           - 智能路由到对应 MCP 工具
 * #           - 多模态结果可视化（图像/音频预览）
 * #           - 实时统计 + 流式事件
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-04 初次创建
 * # ====================================
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  MultimodalAgentLoop,
  createMultimodalAgentLoop,
  type MultimodalAgentResult,
  type MultimodalInput,
  type MultimodalAgentOptions,
  type MultimodalToolExecution,
  type RoutingDecision,
  makeImageInput,
  makeAudioInput,
  makeFileInput,
  makeTextInput,
} from '../utils/multimodalAgentLoop';
import { getDefaultMcpServerRegistry, McpServerRegistry } from '../utils/mcpRegistry';
import { createMcpToolBridge, McpToolBridge } from '../utils/mcpToolBridge';
import { MockProvider } from '../utils/llmProviderAdapter';
import { PLACEHOLDER_PNG_BASE64, type MultimodalContentPart } from '../utils/mcpMultimodalToolBridge';

export interface McpMultimodalPanelProps {
  /** 关闭面板回调 */
  onClose: () => void;
  /** LLM Provider 名称（默认 mock） */
  llmProviderName?: string;
}

type TabKey = 'chat' | 'image' | 'audio' | 'history';

interface HistoryItem {
  id: string;
  userMessage: string;
  result: MultimodalAgentResult;
  inputs: MultimodalInput[];
  timestamp: number;
}

export function McpMultimodalPanel({ onClose, llmProviderName = 'mock' }: McpMultimodalPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [userMessage, setUserMessage] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [currentResult, setCurrentResult] = useState<MultimodalAgentResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stats, setStats] = useState<ReturnType<MultimodalAgentLoop['getStats']> | null>(null);

  // 多模态输入草稿
  const [imageBase64, setImageBase64] = useState<string>('');
  const [imageMime, setImageMime] = useState<string>('image/png');
  const [audioBase64, setAudioBase64] = useState<string>('');
  const [audioMime, setAudioMime] = useState<string>('audio/wav');
  const [routingStrategy, setRoutingStrategy] = useState<'auto' | 'explicit'>('auto');

  // 创建集成引擎（单例）
  const { agentLoop, toolBridge, registry, llm } = useMemo(() => {
    const reg = getDefaultMcpServerRegistry();
    const tb = createMcpToolBridge();
    const provider = new MockProvider();
    const agent = createMultimodalAgentLoop({
      llmProvider: provider,
      mcpRegistry: reg,
      toolBridge: tb,
      autoConnect: false,
    });
    return { agentLoop: agent, toolBridge: tb, registry: reg, llm: provider };
  }, []);

  // 卸载时清理
  useEffect(() => {
    return () => {
      toolBridge.dispose();
      agentLoop.dispose();
    };
  }, [agentLoop, toolBridge]);

  // 提交消息
  const handleSubmit = useCallback(async () => {
    if (!userMessage.trim() || running) return;
    setRunning(true);
    const ts = Date.now();
    const currentMsg = userMessage;
    setUserMessage('');

    // 构造多模态输入
    const inputs: MultimodalInput[] = [];
    if (imageBase64) {
      inputs.push(makeImageInput(imageBase64, imageMime || 'image/png'));
    }
    if (audioBase64) {
      inputs.push(makeAudioInput(audioBase64, audioMime || 'audio/wav'));
    }

    try {
      const options: MultimodalAgentOptions = {
        routingStrategy,
        maxSteps: 3,
      };
      const result = await agentLoop.run(currentMsg, inputs, options);
      setCurrentResult(result);
      setHistory((h) => [
        ...h,
        {
          id: `hist-${ts}`,
          userMessage: currentMsg,
          result,
          inputs,
          timestamp: ts,
        },
      ]);
      setStats(agentLoop.getStats());
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const fakeResult: MultimodalAgentResult = {
        content: `(异常: ${errMsg})`,
        multimodalContent: [],
        toolExecutions: [],
        routingDecisions: [],
        inputSummary: { total: 0, images: 0, audios: 0, files: 0, texts: 0 },
        totalTokens: 0,
        durationMs: 0,
        steps: 0,
        success: false,
        error: errMsg,
        terminationReason: 'error',
        timestamp: ts,
      };
      setCurrentResult(fakeResult);
      setHistory((h) => [
        ...h,
        { id: `hist-${ts}`, userMessage: currentMsg, result: fakeResult, inputs, timestamp: ts },
      ]);
    } finally {
      setRunning(false);
    }
  }, [userMessage, running, agentLoop, imageBase64, imageMime, audioBase64, audioMime, routingStrategy]);

  // 清空历史
  const handleClear = useCallback(() => {
    setHistory([]);
    setCurrentResult(null);
    agentLoop.resetStats();
    setStats(agentLoop.getStats());
  }, [agentLoop]);

  // 加载示例
  const loadExample = useCallback((kind: 'image' | 'audio' | 'mixed') => {
    if (kind === 'image') {
      setImageBase64(PLACEHOLDER_PNG_BASE64);
      setImageMime('image/png');
      setAudioBase64('');
      setUserMessage('请描述这张图像');
    } else if (kind === 'audio') {
      setImageBase64('');
      setAudioBase64(
        'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      );
      setAudioMime('audio/wav');
      setUserMessage('请转写这段音频');
    } else {
      setImageBase64(PLACEHOLDER_PNG_BASE64);
      setImageMime('image/png');
      setAudioBase64(
        'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      );
      setAudioMime('audio/wav');
      setUserMessage('请同时处理图像和音频');
    }
  }, []);

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
            <h2 style={{ margin: 0, fontSize: '18px' }}>🎨 MCP 多模态智能体 (MultimodalAgentLoop)</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
              MCP × Hermes × 多模态深度融合 · 图像/音频/文件 端到端处理
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
          <span>🖼️ 图像: {stats?.totalImageInputs ?? 0}</span>
          <span>🔊 音频: {stats?.totalAudioInputs ?? 0}</span>
          <span>📁 文件: {stats?.totalFileInputs ?? 0}</span>
          <span>📝 文本: {stats?.totalTextInputs ?? 0}</span>
          <span>🔧 工具调用: {stats?.totalMultimodalExecutions ?? 0}</span>
          <span>✅ 成功: {stats?.successRuns ?? 0}</span>
          <span>❌ 失败: {stats?.failedRuns ?? 0}</span>
          <span>🧪 LLM: {llmProviderName}</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          {(['chat', 'image', 'audio', 'history'] as TabKey[]).map((tab) => (
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
              {tab === 'chat' && '💬 多模态对话'}
              {tab === 'image' && '🖼️ 图像工具'}
              {tab === 'audio' && '🔊 音频工具'}
              {tab === 'history' && `📜 历史 (${history.length})`}
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
              imageBase64={imageBase64}
              setImageBase64={setImageBase64}
              imageMime={imageMime}
              setImageMime={setImageMime}
              audioBase64={audioBase64}
              setAudioBase64={setAudioBase64}
              audioMime={audioMime}
              setAudioMime={setAudioMime}
              routingStrategy={routingStrategy}
              setRoutingStrategy={setRoutingStrategy}
              currentResult={currentResult}
              onSubmit={handleSubmit}
              onClear={handleClear}
              onLoadExample={loadExample}
            />
          )}
          {activeTab === 'image' && <ImageToolTab agentLoop={agentLoop} />}
          {activeTab === 'audio' && <AudioToolTab agentLoop={agentLoop} />}
          {activeTab === 'history' && <HistoryTab history={history} />}
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
          <span>🎨 MCP 2024-11-05 × 多模态 (图像/音频/文件)</span>
          <span>
            {running
              ? '⏳ 运行中...'
              : currentResult
              ? `✓ 上次: ${currentResult.steps}步 / ${currentResult.totalTokens} tokens / ${currentResult.terminationReason}`
              : '空闲'}
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
  imageBase64: string;
  setImageBase64: (s: string) => void;
  imageMime: string;
  setImageMime: (s: string) => void;
  audioBase64: string;
  setAudioBase64: (s: string) => void;
  audioMime: string;
  setAudioMime: (s: string) => void;
  routingStrategy: 'auto' | 'explicit';
  setRoutingStrategy: (s: 'auto' | 'explicit') => void;
  currentResult: MultimodalAgentResult | null;
  onSubmit: () => void;
  onClear: () => void;
  onLoadExample: (kind: 'image' | 'audio' | 'mixed') => void;
}

function ChatTab(props: ChatTabProps) {
  const {
    userMessage,
    setUserMessage,
    running,
    imageBase64,
    setImageBase64,
    imageMime,
    setImageMime,
    audioBase64,
    setAudioBase64,
    audioMime,
    setAudioMime,
    routingStrategy,
    setRoutingStrategy,
    currentResult,
    onSubmit,
    onClear,
    onLoadExample,
  } = props;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      {/* 示例按钮 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => onLoadExample('image')}
          style={btnSecondaryStyle}
        >
          📷 加载图像示例
        </button>
        <button
          onClick={() => onLoadExample('audio')}
          style={btnSecondaryStyle}
        >
          🔊 加载音频示例
        </button>
        <button
          onClick={() => onLoadExample('mixed')}
          style={btnSecondaryStyle}
        >
          🎬 加载混合示例
        </button>
        <select
          value={routingStrategy}
          onChange={(e) => setRoutingStrategy(e.target.value as 'auto' | 'explicit')}
          style={{ ...btnSecondaryStyle, cursor: 'pointer' }}
        >
          <option value="auto">🧠 智能路由 (auto)</option>
          <option value="explicit">📍 显式路由 (explicit)</option>
        </select>
      </div>

      {/* 多模态输入区 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={inputBoxStyle}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
            🖼️ 图像 base64 ({imageBase64.length} 字符)
          </div>
          <textarea
            value={imageBase64}
            onChange={(e) => setImageBase64(e.target.value)}
            placeholder="粘贴 base64 图像数据..."
            style={textareaStyle}
            rows={3}
          />
          <input
            type="text"
            value={imageMime}
            onChange={(e) => setImageMime(e.target.value)}
            placeholder="MIME (image/png)"
            style={inputStyle}
          />
        </div>
        <div style={inputBoxStyle}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
            🔊 音频 base64 ({audioBase64.length} 字符)
          </div>
          <textarea
            value={audioBase64}
            onChange={(e) => setAudioBase64(e.target.value)}
            placeholder="粘贴 base64 音频数据..."
            style={textareaStyle}
            rows={3}
          />
          <input
            type="text"
            value={audioMime}
            onChange={(e) => setAudioMime(e.target.value)}
            placeholder="MIME (audio/wav)"
            style={inputStyle}
          />
        </div>
      </div>

      {/* 用户消息输入 */}
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
          placeholder="输入消息 (Ctrl/⌘+Enter 发送)..."
          disabled={running}
          style={{
            flex: 1,
            minHeight: '50px',
            maxHeight: '100px',
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
          <button onClick={onClear} style={btnSmallStyle}>
            清空
          </button>
        </div>
      </div>

      {/* 当前结果 */}
      {currentResult && (
        <div style={{ background: '#2a2a2a', borderRadius: '8px', padding: '12px' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
            📊 结果 ({currentResult.steps} 步, {currentResult.totalTokens} tokens, {currentResult.terminationReason})
            {currentResult.success ? ' ✅' : ' ❌'}
          </div>
          <div
            style={{
              background: '#1e3a5f',
              padding: '10px',
              borderRadius: '6px',
              fontSize: '13px',
              whiteSpace: 'pre-wrap',
              marginBottom: '8px',
            }}
          >
            {currentResult.content || '(空响应)'}
          </div>
          {/* 多模态内容可视化 */}
          {currentResult.multimodalContent.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
                🎨 多模态结果 ({currentResult.multimodalContent.length})
              </div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {currentResult.multimodalContent.map((m, i) => (
                  <MultimodalContentDisplay key={i} content={m} />
                ))}
              </div>
            </div>
          )}
          {/* 工具执行 */}
          {currentResult.toolExecutions.length > 0 && (
            <details style={{ marginTop: '8px', fontSize: '12px' }}>
              <summary style={{ cursor: 'pointer', color: '#4a9eff' }}>
                🔧 工具执行 ({currentResult.toolExecutions.length})
              </summary>
              {currentResult.toolExecutions.map((t: MultimodalToolExecution, i) => (
                <div
                  key={i}
                  style={{ padding: '4px 0', borderBottom: '1px solid #333', fontSize: '11px' }}
                >
                  <code style={{ color: '#7dd87d' }}>{t.toolName}</code> ({t.durationMs}ms)
                  <span style={{ marginLeft: '8px', color: t.success ? '#7dd87d' : '#f77' }}>
                    {t.success ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </details>
          )}
          {/* 路由决策 */}
          {currentResult.routingDecisions.length > 0 && (
            <details style={{ marginTop: '8px', fontSize: '12px' }}>
              <summary style={{ cursor: 'pointer', color: '#4a9eff' }}>
                🧭 路由决策 ({currentResult.routingDecisions.length})
              </summary>
              {currentResult.routingDecisions.map((r: RoutingDecision, i) => (
                <div
                  key={i}
                  style={{ padding: '4px 0', borderBottom: '1px solid #333', fontSize: '11px' }}
                >
                  <code style={{ color: '#d87dff' }}>{r.toolName}</code> ({r.source}) {r.reason}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ============ 子组件：图像工具 Tab ============

function ImageToolTab({ agentLoop }: { agentLoop: MultimodalAgentLoop }) {
  const [imageBase64, setImageBase64] = useState<string>(PLACEHOLDER_PNG_BASE64);
  const [mime, setMime] = useState<string>('image/png');
  const [toolName, setToolName] = useState<string>('image_describe');
  const [result, setResult] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleInvoke = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      const r = await agentLoop.invokeImageTool(toolName, {
        image: imageBase64,
        mimeType: mime,
      });
      setResult(JSON.stringify(r, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [agentLoop, toolName, imageBase64, mime, running]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h3 style={{ margin: 0, fontSize: '16px' }}>🖼️ 图像工具调用</h3>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label style={{ fontSize: '12px' }}>工具:</label>
        <select
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          style={{ ...inputStyle, minWidth: '200px' }}
        >
          <option value="image_ocr">image_ocr (OCR 文字识别)</option>
          <option value="image_describe">image_describe (图像描述)</option>
          <option value="image_resize">image_resize (尺寸调整)</option>
          <option value="image_convert">image_convert (格式转换)</option>
          <option value="image_to_base64">image_to_base64 (转 base64)</option>
        </select>
        <button onClick={handleInvoke} disabled={running} style={btnPrimaryStyle}>
          {running ? '⏳ 运行中' : '▶ 调用'}
        </button>
      </div>
      <div>
        <label style={{ fontSize: '12px' }}>Base64:</label>
        <textarea
          value={imageBase64}
          onChange={(e) => setImageBase64(e.target.value)}
          rows={3}
          style={{ ...textareaStyle, width: '100%' }}
        />
      </div>
      <div>
        <label style={{ fontSize: '12px' }}>MIME:</label>
        <input
          type="text"
          value={mime}
          onChange={(e) => setMime(e.target.value)}
          style={{ ...inputStyle, width: '200px' }}
        />
      </div>
      {error && (
        <div style={{ color: '#f77', padding: '8px', background: '#3a1a1a', borderRadius: '6px' }}>
          ❌ {error}
        </div>
      )}
      {result && (
        <div style={{ background: '#2a2a2a', padding: '12px', borderRadius: '6px' }}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>结果:</div>
          <pre style={{ fontSize: '11px', overflow: 'auto' }}>{result}</pre>
        </div>
      )}
    </div>
  );
}

// ============ 子组件：音频工具 Tab ============

function AudioToolTab({ agentLoop }: { agentLoop: MultimodalAgentLoop }) {
  const [audioBase64, setAudioBase64] = useState<string>(
    'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
  );
  const [mime, setMime] = useState<string>('audio/wav');
  const [toolName, setToolName] = useState<string>('audio_transcribe');
  const [result, setResult] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleInvoke = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      const r = await agentLoop.invokeAudioTool(toolName, {
        audio: audioBase64,
        mimeType: mime,
      });
      setResult(JSON.stringify(r, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [agentLoop, toolName, audioBase64, mime, running]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h3 style={{ margin: 0, fontSize: '16px' }}>🔊 音频工具调用</h3>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label style={{ fontSize: '12px' }}>工具:</label>
        <select
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          style={{ ...inputStyle, minWidth: '200px' }}
        >
          <option value="audio_transcribe">audio_transcribe (语音转文字)</option>
          <option value="audio_synthesize">audio_synthesize (文字转语音)</option>
          <option value="audio_convert">audio_convert (格式转换)</option>
          <option value="audio_metadata">audio_metadata (提取元数据)</option>
          <option value="audio_clip">audio_clip (片段提取)</option>
        </select>
        <button onClick={handleInvoke} disabled={running} style={btnPrimaryStyle}>
          {running ? '⏳ 运行中' : '▶ 调用'}
        </button>
      </div>
      <div>
        <label style={{ fontSize: '12px' }}>Base64:</label>
        <textarea
          value={audioBase64}
          onChange={(e) => setAudioBase64(e.target.value)}
          rows={3}
          style={{ ...textareaStyle, width: '100%' }}
        />
      </div>
      <div>
        <label style={{ fontSize: '12px' }}>MIME:</label>
        <input
          type="text"
          value={mime}
          onChange={(e) => setMime(e.target.value)}
          style={{ ...inputStyle, width: '200px' }}
        />
      </div>
      {error && (
        <div style={{ color: '#f77', padding: '8px', background: '#3a1a1a', borderRadius: '6px' }}>
          ❌ {error}
        </div>
      )}
      {result && (
        <div style={{ background: '#2a2a2a', padding: '12px', borderRadius: '6px' }}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>结果:</div>
          <pre style={{ fontSize: '11px', overflow: 'auto' }}>{result}</pre>
        </div>
      )}
    </div>
  );
}

// ============ 子组件：历史 Tab ============

function HistoryTab({ history }: { history: HistoryItem[] }) {
  if (history.length === 0) {
    return <EmptyState icon="📜" text="暂无历史记录" />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {history
        .slice()
        .reverse()
        .map((h) => (
          <div
            key={h.id}
            style={{
              background: '#2a2a2a',
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #333',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ fontSize: '12px', color: '#888' }}>
                {new Date(h.timestamp).toLocaleTimeString()}
              </div>
              <div style={{ fontSize: '11px', color: h.result.success ? '#7dd87d' : '#f77' }}>
                {h.result.success ? '✅ 成功' : '❌ 失败'} · {h.result.steps}步
              </div>
            </div>
            <div style={{ fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#4a9eff' }}>👤 用户:</span> {h.userMessage}
            </div>
            <div style={{ fontSize: '12px', color: '#aaa' }}>
              <span style={{ color: '#7dd87d' }}>🤖 助手:</span>{' '}
              {h.result.content.slice(0, 200)}
              {h.result.content.length > 200 ? '...' : ''}
            </div>
            {h.result.toolExecutions.length > 0 && (
              <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                🔧 工具: {h.result.toolExecutions.map((t) => t.toolName).join(', ')}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

// ============ 子组件：多模态内容显示 ============

function MultimodalContentDisplay({
  content,
}: {
  content: { type: 'text' | 'image' | 'audio' | 'file'; text?: string; data?: string; mimeType?: string; url?: string };
}) {
  if (content.type === 'text' && content.text) {
    return (
      <div
        style={{
          padding: '6px 8px',
          background: '#1e3a5f',
          borderRadius: '4px',
          fontSize: '12px',
        }}
      >
        📝 {content.text}
      </div>
    );
  }
  if (content.type === 'image' && content.data) {
    return (
      <div style={{ padding: '4px', background: '#2d4a3e', borderRadius: '4px' }}>
        <img
          src={`data:${content.mimeType ?? 'image/png'};base64,${content.data}`}
          alt="多模态结果"
          style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '4px' }}
        />
      </div>
    );
  }
  if (content.type === 'audio' && content.data) {
    return (
      <div style={{ padding: '4px', background: '#4a3a2d', borderRadius: '4px' }}>
        <audio
          controls
          src={`data:${content.mimeType ?? 'audio/wav'};base64,${content.data}`}
          style={{ maxWidth: '100%' }}
        >
          <track kind="captions" />
        </audio>
      </div>
    );
  }
  if (content.type === 'file') {
    return (
      <div
        style={{
          padding: '6px 8px',
          background: '#3d2d4a',
          borderRadius: '4px',
          fontSize: '12px',
        }}
      >
        📄 {content.url ?? '(文件)'} ({content.mimeType ?? 'unknown'})
      </div>
    );
  }
  return null;
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

// ============ 共享样式 ============

const btnPrimaryStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#4a9eff',
  border: 'none',
  borderRadius: '6px',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid #555',
  borderRadius: '6px',
  color: '#aaa',
  cursor: 'pointer',
  fontSize: '12px',
};

const btnSmallStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid #555',
  borderRadius: '6px',
  color: '#aaa',
  cursor: 'pointer',
  fontSize: '11px',
};

const inputBoxStyle: React.CSSProperties = {
  background: '#2a2a2a',
  padding: '8px',
  borderRadius: '6px',
  border: '1px solid #333',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px',
  background: '#1e1e1e',
  border: '1px solid #444',
  borderRadius: '4px',
  color: '#e0e0e0',
  fontSize: '11px',
  fontFamily: 'monospace',
  resize: 'vertical',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: '4px',
  padding: '4px 6px',
  background: '#1e1e1e',
  border: '1px solid #444',
  borderRadius: '4px',
  color: '#e0e0e0',
  fontSize: '11px',
};
