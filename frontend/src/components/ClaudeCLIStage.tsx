/**
 * # ============================================================
 * ClaudeCLIStage - Claude Code CLI 流式舞台组件 (v1.0.0)
 * Cycle 61 G61-01-T5
 * # ============================================================
 * 核心作用：在 Solo 模式中显示 Claude Code CLI 实时输出
 * 运行流程：
 *   1. 接收 useClaudeCLI hook 返回值
 *   2. 按区域显示：stdout / thinking / tool_call / errors
 *   3. 提供 invoke / cancel / clear 按钮
 *   4. 实时显示沙箱状态 + 进程 ID
 * 设计要点：
 *   - 主题感知（bg-[var(--bg-panel)]）
 *   - 可滚动：所有内容区独立滚动
 *   - 工具调用：卡片式展示
 *   - 思考过程：可折叠
 *   - 错误：错误样式 + 显示堆栈
 * 输入参数：{ claude, prompt, onPromptChange, className?, testId? }
 * 输出结果：React JSX
 * ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-01-T5 初次创建
 * ====================================
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  useClaudeCLI,
  type UseClaudeCLIResult,
  type InvokeParams,
  type ClaudeCLIEvent,
} from '../hooks/useClaudeCLI';

export interface ClaudeCLIStageProps {
  claude: UseClaudeCLIResult;
  initialPrompt?: string;
  onSubmit?: (params: InvokeParams) => void;
  className?: string;
  testId?: string;
  defaultModel?: string;
}

export const ClaudeCLIStage: React.FC<ClaudeCLIStageProps> = ({
  claude,
  initialPrompt = '',
  onSubmit,
  className = '',
  testId = 'claude-cli-stage',
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [showThinking, setShowThinking] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const [model, setModel] = useState(claude.mode === 'fallback' ? 'claude-sonnet-4 (fallback)' : 'claude-sonnet-4');
  const [sandbox, setSandbox] = useState<'auto' | 'docker' | 'gvisor' | 'firejail' | 'none'>('auto');

  const outputRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [claude.output, claude.thinking, claude.toolCalls.length]);

  const handleInvoke = async () => {
    if (!prompt.trim()) return;
    const params: InvokeParams = {
      prompt,
      model,
      sandbox,
      timeout: 300,
    };
    onSubmit?.(params);
    await claude.invoke(params);
  };

  return (
    <div
      data-testid={testId}
      className={`flex flex-col h-full bg-[var(--bg-app)] text-[var(--text-primary)] ${className}`}
    >
      {/* 头部：状态栏 */}
      <div
        data-testid={`${testId}-header`}
        className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)]"
      >
        <div className="flex items-center gap-2 text-sm">
          <span
            data-testid={`${testId}-status-dot`}
            className={`inline-block w-2 h-2 rounded-full ${
              claude.isRunning
                ? 'bg-yellow-400 animate-pulse'
                : claude.isAvailable
                ? 'bg-green-500'
                : 'bg-red-500'
            }`}
            aria-label={claude.isRunning ? 'running' : claude.isAvailable ? 'idle' : 'unavailable'}
          />
          <span className="font-semibold">Claude Code Shell</span>
          <span className="text-xs text-[var(--text-secondary)]">
            mode: {claude.mode}
            {claude.processId && ` · pid: ${claude.processId.slice(0, 12)}`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/* 沙箱指示器 */}
          {Object.entries(claude.sandboxStatus || {}).map(([name, ok]) => (
            <span
              key={name}
              data-testid={`${testId}-sandbox-${name}`}
              className={`px-1.5 py-0.5 rounded ${
                ok ? 'bg-green-900/30 text-green-400' : 'bg-gray-700/30 text-gray-500'
              }`}
              title={`${name}: ${ok ? 'available' : 'unavailable'}`}
            >
              {ok ? '✓' : '✗'} {name}
            </span>
          ))}
        </div>
      </div>

      {/* 输入区 */}
      <div
        data-testid={`${testId}-input`}
        className="p-3 border-b border-[var(--border-color)] bg-[var(--bg-panel)]"
      >
        <div className="flex gap-2 mb-2">
          <select
            data-testid={`${testId}-model`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="px-2 py-1 text-xs bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded border border-[var(--border-color)]"
            disabled={claude.isRunning}
          >
            <option value="claude-sonnet-4">Claude Sonnet 4</option>
            <option value="claude-opus-4">Claude Opus 4</option>
            <option value="gpt-5.6">GPT-5.6</option>
            <option value="claude-sonnet-4 (fallback)">Fallback</option>
          </select>
          <select
            data-testid={`${testId}-sandbox`}
            value={sandbox}
            onChange={(e) => setSandbox(e.target.value as typeof sandbox)}
            className="px-2 py-1 text-xs bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded border border-[var(--border-color)]"
            disabled={claude.isRunning}
          >
            <option value="auto">Auto (优先级)</option>
            <option value="docker">Docker</option>
            <option value="gvisor">gVisor</option>
            <option value="firejail">Firejail</option>
            <option value="none">None (无沙箱)</option>
          </select>
        </div>
        <textarea
          data-testid={`${testId}-prompt`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入 prompt，调用 Claude Code CLI..."
          disabled={claude.isRunning}
          rows={3}
          className="w-full px-2 py-1.5 text-sm bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded border border-[var(--border-color)] resize-none disabled:opacity-50"
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            data-testid={`${testId}-invoke`}
            onClick={handleInvoke}
            disabled={claude.isRunning || !prompt.trim()}
            className="px-4 py-1.5 text-sm rounded bg-hermes-500 text-white hover:bg-hermes-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {claude.isRunning ? '运行中...' : '▶ Invoke'}
          </button>
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            onClick={claude.cancel}
            disabled={!claude.isRunning}
            className="px-4 py-1.5 text-sm rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ⏹ Cancel
          </button>
          <button
            type="button"
            data-testid={`${testId}-clear`}
            onClick={claude.clear}
            className="px-4 py-1.5 text-sm rounded bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--border-color)]"
          >
            🗑 Clear
          </button>
          <button
            type="button"
            data-testid={`${testId}-refresh`}
            onClick={claude.refreshHealth}
            className="px-3 py-1.5 text-xs rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="刷新健康状态"
          >
            ↻
          </button>
        </div>
      </div>

      {/* 思考过程（可折叠） */}
      {claude.thinking && (
        <div
          data-testid={`${testId}-thinking`}
          className="border-b border-[var(--border-color)] bg-purple-900/10"
        >
          <button
            type="button"
            onClick={() => setShowThinking((p) => !p)}
            className="w-full px-3 py-1.5 text-xs text-left text-purple-300 hover:bg-purple-900/20"
          >
            {showThinking ? '▼' : '▶'} 💭 思考过程 ({claude.thinking.length} chars)
          </button>
          {showThinking && (
            <div className="px-3 py-2 text-xs text-purple-200 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
              {claude.thinking}
            </div>
          )}
        </div>
      )}

      {/* 工具调用（可折叠） */}
      {claude.toolCalls.length > 0 && (
        <div
          data-testid={`${testId}-tools`}
          className="border-b border-[var(--border-color)] bg-blue-900/10"
        >
          <button
            type="button"
            onClick={() => setShowTools((p) => !p)}
            className="w-full px-3 py-1.5 text-xs text-left text-blue-300 hover:bg-blue-900/20"
          >
            {showTools ? '▼' : '▶'} 🔧 工具调用 ({claude.toolCalls.length})
          </button>
          {showTools && (
            <div className="px-3 py-2 max-h-40 overflow-y-auto space-y-1">
              {claude.toolCalls.map((tc, i) => (
                <div
                  key={`${tc.timestamp}-${i}`}
                  data-testid={`${testId}-tool-${i}`}
                  className="px-2 py-1 text-xs rounded bg-blue-900/20 border border-blue-700/30"
                >
                  <div className="text-blue-300 font-mono">
                    [{tc.type === 'cli_tool_call' ? '→' : '←'}] {tc.content.slice(0, 200)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 主输出（stdout） */}
      <div
        ref={outputRef}
        data-testid={`${testId}-output`}
        className="flex-1 p-3 overflow-y-auto text-sm font-mono whitespace-pre-wrap"
      >
        {claude.output || (
          <div className="text-[var(--text-tertiary)] italic">
            {claude.isRunning ? '⏳ 等待 Claude Code CLI 输出...' : '无输出'}
          </div>
        )}
      </div>

      {/* 错误列表 */}
      {claude.errors.length > 0 && (
        <div
          data-testid={`${testId}-errors`}
          className="border-t border-red-700/50 bg-red-900/10 max-h-32 overflow-y-auto"
        >
          <div className="px-3 py-1.5 text-xs text-red-300 font-semibold sticky top-0 bg-red-900/20">
            ⚠️ 错误 ({claude.errors.length})
          </div>
          <div className="px-3 py-2 space-y-1">
            {claude.errors.map((err, i) => (
              <div
                key={i}
                data-testid={`${testId}-error-${i}`}
                className="text-xs text-red-300 font-mono"
              >
                {err}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部状态 */}
      <div
        data-testid={`${testId}-footer`}
        className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] border-t border-[var(--border-color)] bg-[var(--bg-panel)] flex justify-between"
      >
        <span>state: {claude.state}</span>
        <span>
          events: {claude.events.length} | tools: {claude.toolCalls.length} | errors: {claude.errors.length}
        </span>
      </div>
    </div>
  );
};

export default ClaudeCLIStage;
