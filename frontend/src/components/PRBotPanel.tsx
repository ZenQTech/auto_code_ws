/**
 * # ============================================================
 * # PRBotPanel - PR 自动机器人 UI (v1.0.0 Cycle 25 G25-02)
 * # ============================================================
 * # 核心作用：PRBotEngine 的可视化控制面板
 * # 主要功能：
 * #   1. Bot 配置（名称/头像/触发器/默认 review 类型）
 * #   2. PR 注册（手动/模拟）
 * #   3. 实时 review 列表
 * #   4. Line comment 详情
 * #   5. 审计日志查看
 * #   6. 状态序列化导入导出
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-02 初次创建
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getDefaultPRBotEngine,
  resetDefaultPRBotEngine,
} from '../utils/prBotEngine';
import {
  DEFAULT_BOT_CONFIG,
  type BotConfig,
  type BotActionLog,
  type PRReviewComment,
  type PREventType,
  type PullRequest,
  type ReviewType,
} from '../utils/prBotEngineTypes';
import { EmptyState } from './EmptyState';

interface PRBotPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'hermes.prBotPanel';

function safeGetItem(key: string): Record<string, unknown> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function safeSetItem(key: string, value: Record<string, unknown>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 忽略
  }
}

const SAMPLE_PR: PullRequest = {
  number: 1,
  title: 'feat: 添加新的业务逻辑',
  description: '实现新功能的核心算法',
  author: 'developer',
  baseBranch: 'main',
  headBranch: 'feature/new-thing',
  files: [
    {
      path: 'src/example.ts',
      content: `export function loadConfig() {
  const code = "alert('xss')";
  eval(code);
  return code;
}
`,
      additions: 5,
      deletions: 0,
      status: 'added',
    },
    {
      path: 'src/utils.ts',
      content: `export const apiKey = "sk-1234567890abcdef1234567890abcdef";
console.log("apiKey:", apiKey);
`,
      additions: 2,
      deletions: 0,
      status: 'added',
    },
  ],
  status: 'open',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  headSha: 'abc123',
  baseSha: 'def456',
};

export function PRBotPanel({ isOpen, onClose }: PRBotPanelProps) {
  const engine = useMemo(() => getDefaultPRBotEngine(), []);
  const [config, setConfig] = useState<BotConfig>(engine.getConfig());
  const [prs, setPrs] = useState<PullRequest[]>(engine.getAllPRs());
  const [reviews, setReviews] = useState<PRReviewComment[]>(engine.getState().reviews);
  const [audit, setAudit] = useState<BotActionLog[]>(engine.getAuditLog());
  const [selectedPR, setSelectedPR] = useState<number | null>(null);
  const [selectedReview, setSelectedReview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载持久化
  useEffect(() => {
    if (!isOpen) return;
    const stored = safeGetItem(STORAGE_KEY);
    if (stored.showConfig) setShowConfig(stored.showConfig as boolean);
  }, [isOpen]);

  const persist = useCallback((patch: Record<string, unknown>) => {
    const cur = safeGetItem(STORAGE_KEY);
    safeSetItem(STORAGE_KEY, { ...cur, ...patch });
  }, []);

  // 事件订阅
  useEffect(() => {
    if (!isOpen) return;
    const onPROpen = (pr: PullRequest) => {
      setPrs(engine.getAllPRs());
      setAudit(engine.getAuditLog());
      setInfo(`PR #${pr.number} opened: ${pr.title}`);
    };
    const onPRSync = () => {
      setPrs(engine.getAllPRs());
      setAudit(engine.getAuditLog());
    };
    const onPRClosed = () => {
      setPrs(engine.getAllPRs());
      setAudit(engine.getAuditLog());
    };
    const onReviewPosted = (r: PRReviewComment) => {
      setReviews(engine.getState().reviews);
      setAudit(engine.getAuditLog());
      setInfo(`Review posted: ${r.type} on PR #${r.prNumber}`);
      setReviewing(false);
    };
    const onError = (err: Error) => {
      setError(err.message);
      setReviewing(false);
    };
    engine.on('pr-opened', onPROpen);
    engine.on('pr-synchronize', onPRSync);
    engine.on('pr-closed', onPRClosed);
    engine.on('review-posted', onReviewPosted);
    engine.on('error', onError);
    return () => {
      engine.off('pr-opened', onPROpen);
      engine.off('pr-synchronize', onPRSync);
      engine.off('pr-closed', onPRClosed);
      engine.off('review-posted', onReviewPosted);
      engine.off('error', onError);
    };
  }, [isOpen, engine]);

  // 注册示例 PR
  const handleRegisterSamplePR = useCallback(() => {
    try {
      const prNum = (engine.getAllPRs().length || 0) + 1;
      const pr = { ...SAMPLE_PR, number: prNum };
      engine.registerPR(pr);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [engine]);

  // 触发事件
  const handleTriggerEvent = useCallback(
    async (type: PREventType, prNumber: number) => {
      const pr = engine.getPR(prNumber);
      if (!pr) return;
      setReviewing(true);
      try {
        await engine.triggerEvent({
          type,
          pr,
          timestamp: Date.now(),
          trigger: 'manual',
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setReviewing(false);
      }
    },
    [engine]
  );

  // 关闭 PR
  const handleClosePR = useCallback(
    (prNumber: number) => {
      engine.closePR(prNumber);
    },
    [engine]
  );

  // 配置更新
  const updateConfig = useCallback(
    (patch: Partial<BotConfig>) => {
      engine.configure(patch);
      setConfig(engine.getConfig());
    },
    [engine]
  );

  // 切换 trigger
  const toggleTrigger = useCallback(
    (trigger: PREventType) => {
      const triggers = config.autoReviewTriggers.includes(trigger)
        ? config.autoReviewTriggers.filter((t) => t !== trigger)
        : [...config.autoReviewTriggers, trigger];
      updateConfig({ autoReviewTriggers: triggers });
    },
    [config.autoReviewTriggers, updateConfig]
  );

  // 切换 Bot 启用
  const toggleEnabled = useCallback(() => {
    updateConfig({ enabled: !config.enabled });
  }, [config.enabled, updateConfig]);

  // 清空审计
  const clearAudit = useCallback(() => {
    engine.clearAuditLog();
    setAudit([]);
  }, [engine]);

  // 导出/导入状态
  const exportState = useCallback(() => {
    const json = engine.exportState();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prbot-state.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [engine]);

  const importState = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = event.target?.result as string;
          engine.importState(json);
          setPrs(engine.getAllPRs());
          setReviews(engine.getState().reviews);
          setAudit(engine.getAuditLog());
          setConfig(engine.getConfig());
          setInfo('状态导入成功');
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      };
      reader.readAsText(file);
    },
    [engine]
  );

  // 重置
  const handleReset = useCallback(() => {
    resetDefaultPRBotEngine();
    setPrs([]);
    setReviews([]);
    setAudit([]);
    setConfig(DEFAULT_BOT_CONFIG);
    setInfo('已重置');
  }, []);

  // 快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleRegisterSamplePR();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleEnabled();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, handleRegisterSamplePR, toggleEnabled]);

  if (!isOpen) return null;

  const selectedReviewObj = reviews.find((r) => r.id === selectedReview);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="pr-bot-panel"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              PR 自动机器人
            </h2>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">
              v1.0.0
            </span>
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                config.enabled
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
              }`}
            >
              {config.enabled ? '● 运行中' : '○ 已停止'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowConfig((s) => !s);
                persist({ showConfig: !showConfig });
              }}
              className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
            >
              ⚙️ 配置
            </button>
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
            >
              ⌨️
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              data-testid="close-btn"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
          {/* 左栏：PR 列表 + 工具 */}
          <div className="col-span-4 flex flex-col gap-3 overflow-y-auto">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                🤖 Bot 操作
              </h3>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={handleRegisterSamplePR}
                  data-testid="register-pr-btn"
                  className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                >
                  + 注册示例 PR
                </button>
                <button
                  type="button"
                  onClick={toggleEnabled}
                  className="w-full px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-xs"
                >
                  {config.enabled ? '⏸ 停止 Bot' : '▶ 启动 Bot'}
                </button>
                <button
                  type="button"
                  onClick={exportState}
                  className="w-full px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-xs"
                >
                  📥 导出状态
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-xs"
                >
                  📤 导入状态
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={importState}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={handleReset}
                  className="w-full px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 rounded text-xs"
                >
                  🗑 重置全部
                </button>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                📋 PR 列表 ({prs.length})
              </h3>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {prs.length === 0 && (
                  <div className="text-xs text-slate-400 italic p-2">无 PR</div>
                )}
                {prs.map((pr) => (
                  <div
                    key={pr.number}
                    className={`p-2 rounded text-xs ${
                      selectedPR === pr.number
                        ? 'bg-blue-100 dark:bg-blue-900/40'
                        : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedPR(pr.number)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            pr.status === 'open' ? 'bg-green-500' : 'bg-slate-400'
                          }`}
                        />
                        <span className="font-mono">#{pr.number}</span>
                        <span className="flex-1 truncate">{pr.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        @{pr.author} · {pr.files.length} files
                      </div>
                    </button>
                    {selectedPR === pr.number && (
                      <div className="mt-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleTriggerEvent('synchronize', pr.number)}
                          disabled={reviewing}
                          className="flex-1 px-1 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded text-[10px]"
                        >
                          🔄 同步
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTriggerEvent('reopened', pr.number)}
                          disabled={reviewing}
                          className="flex-1 px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-[10px]"
                        >
                          🔓 重开
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClosePR(pr.number)}
                          className="flex-1 px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[10px]"
                        >
                          ❌ 关闭
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 中栏：Reviews 列表 */}
          <div className="col-span-4 flex flex-col gap-3 overflow-y-auto">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 flex-1">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                💬 Reviews ({reviews.length})
              </h3>
              <div className="space-y-2">
                {reviews.length === 0 && (
                  <EmptyState
                    icon="📝"
                    title="无 review"
                    description="注册 PR 后会自动触发 review"
                  />
                )}
                {reviews.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedReview(r.id)}
                    data-testid="review-card"
                    className={`w-full text-left p-2 rounded text-xs ${
                      selectedReview === r.id
                        ? 'bg-blue-100 dark:bg-blue-900/40'
                        : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          r.type === 'APPROVE'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : r.type === 'REQUEST_CHANGES'
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        }`}
                      >
                        {r.type}
                      </span>
                      <span className="font-mono">PR #{r.prNumber}</span>
                      <span className="text-slate-500">· {r.lineComments.length} comments</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 右栏：详情 + 审计日志 */}
          <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
            {selectedReviewObj ? (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 flex-1 overflow-y-auto">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  📄 Review 详情
                </h3>
                <pre
                  className="text-[10px] font-mono whitespace-pre-wrap bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700"
                  data-testid="review-body"
                >
                  {selectedReviewObj.body}
                </pre>
                {selectedReviewObj.lineComments.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Line Comments
                    </h4>
                    <div className="space-y-1">
                      {selectedReviewObj.lineComments.map((lc) => (
                        <div
                          key={lc.id}
                          className="text-[10px] bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700"
                        >
                          <div className="font-mono text-blue-600 dark:text-blue-400">
                            {lc.file}:{lc.line}
                          </div>
                          <pre className="whitespace-pre-wrap mt-1">{lc.body}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 flex-1 flex items-center justify-center">
                <EmptyState
                  icon="👀"
                  title="选择 review"
                  description="点击左侧 review 查看详情"
                />
              </div>
            )}

            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  📋 审计日志 ({audit.length})
                </h3>
                <button
                  type="button"
                  onClick={clearAudit}
                  className="px-2 py-0.5 text-[10px] bg-slate-200 dark:bg-slate-700 rounded"
                >
                  清空
                </button>
              </div>
              <div className="space-y-0.5">
                {audit.slice().reverse().slice(0, 20).map((a) => (
                  <div
                    key={a.id}
                    className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-1"
                  >
                    <span>{a.success ? '✓' : '✗'}</span>
                    <span className="font-mono">{a.action}</span>
                    {a.prNumber !== undefined && <span>PR#{a.prNumber}</span>}
                    <span className="flex-1 truncate text-slate-500">{a.details}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 错误/信息提示 */}
        {error && (
          <div className="mx-4 mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-sm">
            ❌ {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}
        {info && (
          <div className="mx-4 mb-4 p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
            💡 {info}
            <button
              type="button"
              onClick={() => setInfo(null)}
              className="ml-2 text-blue-500 hover:text-blue-700"
            >
              ✕
            </button>
          </div>
        )}

        {/* 配置弹窗 */}
        {showConfig && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
            onClick={() => setShowConfig(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg p-4 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-3">Bot 配置</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">名称</label>
                  <input
                    type="text"
                    value={config.name}
                    onChange={(e) => updateConfig({ name: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">头像 (emoji)</label>
                  <input
                    type="text"
                    value={config.avatar}
                    onChange={(e) => updateConfig({ avatar: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                    maxLength={4}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">自动 Review 触发器</label>
                  <div className="space-y-1">
                    {(['opened', 'synchronize', 'reopened', 'closed'] as PREventType[]).map((t) => (
                      <label key={t} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={config.autoReviewTriggers.includes(t)}
                          onChange={() => toggleTrigger(t)}
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">默认 Review 类型</label>
                  <select
                    value={config.defaultReviewType}
                    onChange={(e) =>
                      updateConfig({ defaultReviewType: e.target.value as ReviewType })
                    }
                    className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                  >
                    <option value="COMMENT">COMMENT</option>
                    <option value="REQUEST_CHANGES">REQUEST_CHANGES</option>
                    <option value="APPROVE">APPROVE</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">阻止严重度阈值</label>
                  <select
                    value={config.blockOnSeverity}
                    onChange={(e) =>
                      updateConfig({
                        blockOnSeverity: e.target.value as
                          | 'critical'
                          | 'high'
                          | 'medium'
                          | 'low'
                          | 'info',
                      })
                    }
                    className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">签名</label>
                  <input
                    type="text"
                    value={config.signature}
                    onChange={(e) => updateConfig({ signature: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfig(false)}
                className="mt-3 px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {/* 快捷键 */}
        {showShortcuts && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
            onClick={() => setShowShortcuts(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg p-4 max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-3">快捷键</h3>
              <ul className="space-y-2 text-sm">
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Esc</kbd> 关闭</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">?</kbd> 快捷键</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+N</kbd> 注册示例 PR</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+B</kbd> 启停 Bot</li>
              </ul>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                className="mt-3 px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PRBotPanel;
