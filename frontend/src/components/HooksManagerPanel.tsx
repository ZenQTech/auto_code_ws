/**
 * # ============================================================
 * # HooksManagerPanel - 事件钩子管理面板 (v1.0.0 Cycle 20 G20-03)
 * # ============================================================
 * # 核心作用：注册 / 启停 / 触发 / 监控事件钩子（vibe coding 事件流）
 * # 运行流程：
 * #   1. 通过 getHooksEngine() 单例订阅
 * #   2. 展示所有 hooks（type / scope / action / priority / enabled）
 * #   3. 支持注册 callback / webhook / command / script 四种 action
 * #   4. 手动触发各类事件，查看执行结果
 * #   5. 显示执行历史 + 日志
 * # 输入参数：isOpen / onClose
 * # 输出结果：JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 20 G20-03 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getHooksEngine,
  triggerHook,
  ALL_HOOK_TYPES,
  type HookType,
  type HookDefinition,
  type HookAction,
  type HookExecutionResult,
  type HookEngineEvent,
} from '../utils/hooksEngine';

export interface HooksManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const HOOK_TYPE_LABEL: Record<HookType, string> = {
  before_prompt: '请求前',
  after_prompt: '请求后',
  before_response: '响应前',
  after_response: '响应后',
  thinking: '思考中',
  subagent_start: '子智能体启动',
  subagent_end: '子智能体结束',
  compaction: '会话压缩',
  turn_complete: '轮次完成',
  tool_execution: '工具执行',
};

const HOOK_TYPE_ICON: Record<HookType, string> = {
  before_prompt: '📥',
  after_prompt: '📤',
  before_response: '🔜',
  after_response: '✓',
  thinking: '🧠',
  subagent_start: '🤖',
  subagent_end: '🏁',
  compaction: '🗜️',
  turn_complete: '🔄',
  tool_execution: '🛠️',
};

const ACTION_ICON: Record<HookAction['type'], string> = {
  callback: '⚡',
  webhook: '🌐',
  command: '💻',
  script: '📜',
};

const SCOPE_COLOR: Record<HookDefinition['scope'], string> = {
  user: 'bg-blue-500/20 text-blue-300',
  project: 'bg-purple-500/20 text-purple-300',
  team: 'bg-green-500/20 text-green-300',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function HooksManagerPanel({ isOpen, onClose }: HooksManagerPanelProps) {
  const engine = useMemo(() => getHooksEngine(), []);
  const [hooks, setHooks] = useState<HookDefinition[]>([]);
  const [executionLog, setExecutionLog] = useState<HookExecutionResult[]>([]);
  const [selectedType, setSelectedType] = useState<HookType>('before_prompt');
  const [showRegister, setShowRegister] = useState(false);

  // 注册表单状态
  const [formName, setFormName] = useState('');
  const [formActionType, setFormActionType] = useState<HookAction['type']>('callback');
  const [formCommand, setFormCommand] = useState('');
  const [formUrl, setFormUrl] = useState('');

  // 订阅
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      setHooks(engine.list());
      setExecutionLog(engine.getExecutionLog());
    };
    refresh();
    const unsub = (_event: HookEngineEvent) => {
      refresh();
    };
    const off = engine.on('hook-registered', unsub);
    return () => {
      off();
    };
  }, [engine, isOpen]);

  const handleTrigger = useCallback(async () => {
    try {
      const results = await triggerHook(selectedType, { manual: true, source: 'HooksManagerPanel' });
      // eslint-disable-next-line no-console
      console.log(`[${selectedType}] 触发 ${results.length} 个 hook`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }
  }, [selectedType]);

  const handleToggle = useCallback(
    (id: string) => {
      const h = engine.get(id);
      if (h) engine.setEnabled(id, !h.enabled);
    },
    [engine],
  );

  const handleRemove = useCallback(
    (id: string) => {
      engine.unregisterHook(id);
    },
    [engine],
  );

  const handleClearLog = useCallback(() => {
    engine.clearExecutionLog();
    setExecutionLog([]);
  }, [engine]);

  const handleRegister = useCallback((): void => {
    if (!formName.trim()) return;
    let action: HookAction;
    if (formActionType === 'callback') {
      action = { type: 'callback', handler: () => undefined };
    } else if (formActionType === 'command') {
      action = { type: 'command', command: formCommand || 'echo hello' };
    } else if (formActionType === 'webhook') {
      action = { type: 'webhook', url: formUrl || 'https://example.com/hook', method: 'POST' };
    } else {
      action = { type: 'script', code: formCommand || 'return 1', language: 'javascript' };
    }
    engine.registerHook({
      id: `hook-${Date.now()}`,
      type: selectedType,
      name: formName,
      scope: 'user',
      enabled: true,
      action,
      createdAt: Date.now(),
      createdBy: 'HooksManagerPanel',
      priority: 100,
      timeoutMs: 5000,
      retries: 0,
      fallback: 'ignore',
    });
    setFormName('');
    setFormCommand('');
    setFormUrl('');
    setShowRegister(false);
  }, [engine, formName, formActionType, formCommand, formUrl, selectedType]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredHooks = hooks.filter((h) => h.type === selectedType);

  return (
    <div
      data-testid="hooks-manager-panel"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-in fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700">
          <div>
            <h2 className="text-lg font-semibold text-surface-50">事件钩子</h2>
            <p className="text-xs text-surface-400 mt-1">
              {hooks.length} 个 hooks · {executionLog.length} 次执行
            </p>
          </div>
          <button
            data-testid="hooks-manager-close"
            onClick={onClose}
            className="text-surface-400 hover:text-surface-100 px-2"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Hook Type Selector */}
        <div className="flex flex-wrap items-center gap-1 p-3 border-b border-surface-700">
          {ALL_HOOK_TYPES.map((t) => (
            <button
              key={t}
              data-testid={`hook-manager-type-${t}`}
              onClick={() => setSelectedType(t)}
              className={[
                'px-2 py-1 text-xs rounded',
                selectedType === t
                  ? 'bg-hermes-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700',
              ].join(' ')}
            >
              {HOOK_TYPE_ICON[t]} {HOOK_TYPE_LABEL[t] || t}
            </button>
          ))}
          <button
            data-testid="hooks-manager-trigger"
            onClick={handleTrigger}
            className="ml-auto px-3 py-1 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600"
          >
            ⚡ 触发
          </button>
          <button
            data-testid="hooks-manager-register"
            onClick={() => setShowRegister((s) => !s)}
            className="px-3 py-1 text-xs bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30"
          >
            {showRegister ? '取消' : '+ 注册'}
          </button>
        </div>

        {/* Register Form */}
        {showRegister && (
          <div className="p-3 border-b border-surface-700 bg-surface-800/30">
            <div className="grid grid-cols-2 gap-2">
              <input
                data-testid="hooks-manager-form-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Hook 名称"
                className="px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-surface-200"
              />
              <select
                data-testid="hooks-manager-form-action-type"
                value={formActionType}
                onChange={(e) => setFormActionType(e.target.value as HookAction['type'])}
                className="px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-surface-200"
              >
                <option value="callback">Callback</option>
                <option value="command">Command</option>
                <option value="webhook">Webhook</option>
                <option value="script">Script</option>
              </select>
              {formActionType === 'command' && (
                <input
                  data-testid="hooks-manager-form-command"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  placeholder="Shell 命令"
                  className="col-span-2 px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-surface-200"
                />
              )}
              {formActionType === 'webhook' && (
                <input
                  data-testid="hooks-manager-form-url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="Webhook URL"
                  className="col-span-2 px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-surface-200"
                />
              )}
              {formActionType === 'script' && (
                <input
                  data-testid="hooks-manager-form-script"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  placeholder="脚本代码"
                  className="col-span-2 px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-surface-200"
                />
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-surface-400">类型: {HOOK_TYPE_LABEL[selectedType]}</span>
              <button
                data-testid="hooks-manager-form-submit"
                onClick={handleRegister}
                disabled={!formName.trim()}
                className="ml-auto px-3 py-1 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50"
              >
                确认注册
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Hooks List */}
          <div>
            <h3 className="text-sm font-semibold text-surface-50 mb-2">
              {HOOK_TYPE_LABEL[selectedType]} ({filteredHooks.length})
            </h3>
            {filteredHooks.length === 0 ? (
              <div className="text-center py-8 text-surface-500 text-sm">
                该事件类型尚未注册 hook
              </div>
            ) : (
              <div data-testid="hooks-manager-list" className="space-y-2">
                {filteredHooks.map((h) => (
                  <div
                    key={h.id}
                    data-testid={`hook-manager-${h.id}`}
                    className="flex items-center gap-2 p-2 bg-surface-800/50 border border-surface-700 rounded"
                  >
                    <span className="text-base">{ACTION_ICON[h.action.type]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-surface-100 truncate">{h.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${SCOPE_COLOR[h.scope]}`}>
                          {h.scope}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300">
                          优先级 {h.priority}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300">
                          {h.action.type}
                        </span>
                      </div>
                      <div className="text-[10px] text-surface-500 mt-0.5">
                        超时 {h.timeoutMs}ms · 重试 {h.retries} · fallback {h.fallback} · 创建 {formatTime(h.createdAt)}
                      </div>
                    </div>
                    <button
                      data-testid={`hook-manager-toggle-${h.id}`}
                      onClick={() => handleToggle(h.id)}
                      className={[
                        'px-2 py-0.5 text-[10px] rounded',
                        h.enabled
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-slate-500/20 text-slate-400',
                      ].join(' ')}
                    >
                      {h.enabled ? '已启用' : '已停用'}
                    </button>
                    <button
                      data-testid={`hook-manager-remove-${h.id}`}
                      onClick={() => handleRemove(h.id)}
                      className="px-2 py-0.5 text-[10px] rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Execution Log */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-surface-50">执行历史（最近 {executionLog.length}）</h3>
              <button
                data-testid="hooks-manager-clear-log"
                onClick={handleClearLog}
                className="ml-auto px-2 py-0.5 text-[10px] bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
              >
                清空
              </button>
            </div>
            {executionLog.length === 0 ? (
              <div className="text-center py-6 text-surface-500 text-xs">暂无执行记录</div>
            ) : (
              <div data-testid="hooks-manager-execution-log" className="space-y-1 max-h-48 overflow-auto">
                {executionLog.slice(-20).reverse().map((r, idx) => {
                  const statusClass: Record<string, string> = {
                    success: 'bg-green-500/20 text-green-300',
                    failed: 'bg-red-500/20 text-red-300',
                    timeout: 'bg-yellow-500/20 text-yellow-300',
                    pending: 'bg-blue-500/20 text-blue-300',
                    running: 'bg-blue-500/20 text-blue-300',
                    cancelled: 'bg-slate-500/20 text-slate-400',
                    skipped: 'bg-slate-500/20 text-slate-400',
                  };
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-2 text-[10px] px-2 py-1 bg-surface-800/30 rounded"
                    >
                      <span className={`px-1.5 py-0.5 rounded ${statusClass[r.status]}`}>{r.status}</span>
                      <span className="text-surface-200 font-medium">{r.hookName}</span>
                      <span className="text-surface-500">耗时 {formatDuration((r.endTime ?? Date.now()) - r.startTime)}</span>
                      {r.error && <span className="text-red-300 truncate">{r.error}</span>}
                      <span className="text-surface-500 ml-auto">{formatTime(r.startTime)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HooksManagerPanel;
