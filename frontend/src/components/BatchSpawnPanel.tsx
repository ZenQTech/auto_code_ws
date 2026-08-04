/**
 * # ============================================================
 * # BatchSpawnPanel - 批量任务 SPAWN 面板 (v1.0.0)
 * # Cycle 65 G65-02
 * # ====================================
 * # 核心作用：提供 CSV 驱动的批量 Agent 任务提交 UI（对标 Codex batch_spawn_agents）
 * # 主要功能：
 * #   1. CSV 文本输入 / 文件上传 / 示例加载
 * #   2. 默认角色 / 模型 / 并发度配置
 * #   3. 提交后实时显示 batch_id + 进度条
 * #   4. 内嵌 BatchResultTable 展示子任务
 * #   5. 取消 / 导出 JSON/CSV/MD
 * #   6. 任务历史列表
 * #   7. 快捷键：Esc 关闭 / Ctrl+Enter 提交 / Ctrl+L 加载示例
 * # 输入参数：isOpen, onClose
 * # 输出结果：UI 组件
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 65 G65-02 初次创建
 * # ====================================
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBatchSpawner } from '../hooks/useBatchSpawner';
import { useAgentRoles, type AgentRole } from '../hooks/useAgentRoles';
import { BatchResultTable } from './BatchResultTable';
import { EmptyState } from './EmptyState';

// ============================================================
// 常量
// ============================================================

const SAMPLE_CSV = `task,nickname,role
"分析 data.csv 中的销售趋势并生成可视化建议",Atlas,worker
"为新功能编写单元测试覆盖率≥90%",Builder,worker
"审查 PR #42 的代码质量并提出改进建议",Reviewer,explorer
"监控生产环境 1 小时并报告异常",Sentry,monitor
"生成 API 文档（OpenAPI 3.1）并保存到 docs/","Doc",default`;

const STORAGE_KEY = 'hermes.batchSpawnPanel.cfg';

// ============================================================
// 状态元信息
// ============================================================

const JOB_STATUS_META: Record<string, { icon: string; label: string; color: string }> = {
  pending: { icon: '⏳', label: '等待中', color: 'text-slate-500' },
  running: { icon: '⚙️', label: '执行中', color: 'text-blue-500' },
  completed: { icon: '✅', label: '已完成', color: 'text-green-600' },
  cancelled: { icon: '⏹', label: '已取消', color: 'text-slate-400' },
  failed: { icon: '❌', label: '失败', color: 'text-red-600' },
};

// ============================================================
// 类型
// ============================================================

export interface BatchSpawnPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================================
// 持久化配置
// ============================================================

interface PersistedConfig {
  defaultRole: string;
  defaultModel: string;
  maxConcurrency: number;
  csv: string;
}

function readPersisted(): Partial<PersistedConfig> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistedConfig;
  } catch {
    // ignore
  }
  return {};
}

// ============================================================
// 主组件
// ============================================================

export const BatchSpawnPanel: React.FC<BatchSpawnPanelProps> = ({ isOpen, onClose }) => {
  // 配置
  const [csv, setCsv] = useState<string>(SAMPLE_CSV);
  const [defaultRole, setDefaultRole] = useState<string>('');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [maxConcurrency, setMaxConcurrency] = useState<number>(5);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hooks
  const batch = useBatchSpawner({ autoRefreshMs: 1500 });
  const agentRoles = useAgentRoles({ autoRefreshMs: 0 });

  // 角色列表
  const roles: AgentRole[] = agentRoles.roles;

  // 加载持久化配置
  useEffect(() => {
    if (!isOpen) return;
    const cfg = readPersisted();
    if (cfg.csv) setCsv(cfg.csv);
    if (cfg.defaultRole !== undefined) setDefaultRole(cfg.defaultRole);
    if (cfg.defaultModel !== undefined) setDefaultModel(cfg.defaultModel);
    if (cfg.maxConcurrency) setMaxConcurrency(cfg.maxConcurrency);
    agentRoles.loadRoles();
    batch.refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 持久化
  useEffect(() => {
    if (!isOpen) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ defaultRole, defaultModel, maxConcurrency, csv } satisfies PersistedConfig),
      );
    } catch {
      // ignore
    }
  }, [isOpen, csv, defaultRole, defaultModel, maxConcurrency]);

  // 快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (!batch.submitting && csv.trim().length > 0) {
          void handleSubmit();
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleLoadSample();
      } else if (e.key === '?') {
        e.preventDefault();
        setShowHelp((s) => !s);
      }
    };
    document.body.addEventListener('keydown', handler);
    return () => document.body.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, csv, batch.submitting]);

  if (!isOpen) return null;

  // ============================================================
  // 操作
  // ============================================================

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) setCsv(content);
    };
    reader.readAsText(file);
  };

  const handleLoadSample = () => {
    setCsv(SAMPLE_CSV);
  };

  const handleSubmit = async () => {
    setExportStatus(null);
    await batch.submit({
      csv_content: csv,
      role: defaultRole || null,
      default_model: defaultModel || null,
      max_concurrency: maxConcurrency,
    });
  };

  const handleCancel = async () => {
    if (!batch.currentJob) return;
    await batch.cancel(batch.currentJob.batch_id);
  };

  const handleExport = async (format: 'json' | 'csv' | 'md') => {
    if (!batch.currentJob) return;
    setExportStatus(`正在导出 ${format.toUpperCase()}...`);
    const res = await batch.exportBatch(batch.currentJob.batch_id, format);
    if (!res) {
      setExportStatus('导出失败');
      return;
    }
    // 触发下载
    try {
      const blob = new Blob([res.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${batch.currentJob.batch_id}_results.${res.format}`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus(`已导出 ${format.toUpperCase()} (${res.content.length} chars)`);
    } catch (e) {
      setExportStatus(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSelectJob = (jobId: string) => {
    const job = batch.jobs[jobId];
    if (job) batch.setCurrent(job);
  };

  // ============================================================
  // 衍生数据
  // ============================================================

  const csvStats = useMemo(() => {
    if (!csv.trim()) return { lines: 0, rows: 0, columns: 0 };
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { lines: lines.length, rows: 0, columns: 0 };
    const header = lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    return {
      lines: lines.length,
      rows: lines.length - 1,
      columns: header.length,
    };
  }, [csv]);

  const currentJob = batch.currentJob;
  const currentMeta = currentJob ? JOB_STATUS_META[currentJob.status] || JOB_STATUS_META.pending : null;

  return (
    <div
      data-testid="batch-spawn-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-panel)] rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col border border-[var(--border-color)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚀</span>
            <h2 className="text-base font-bold text-[var(--text-primary)]">
              批量任务 SPAWN
            </h2>
            <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-[10px] font-mono">
              v1.0.0
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              对标 Codex batch_spawn_agents
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              data-testid="batch-spawn-help-btn"
            >
              ?
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              data-testid="batch-spawn-close-btn"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 主体：左右两栏 */}
        <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 min-h-0">
          {/* 左栏：CSV + 配置 */}
          <div className="space-y-3 flex flex-col min-h-0">
            {/* CSV 步骤 */}
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)]/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  📁 步骤 1：CSV 输入
                </h3>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  {csvStats.rows} 行 × {csvStats.columns} 列
                </div>
              </div>
              <div className="flex gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="px-2 py-0.5 text-[11px] bg-blue-500 text-white rounded hover:bg-blue-600"
                  data-testid="batch-spawn-load-sample"
                >
                  📥 示例
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-0.5 text-[11px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)] border border-[var(--border-color)]"
                >
                  📂 上传
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  onClick={() => setCsv('')}
                  className="px-2 py-0.5 text-[11px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)] border border-[var(--border-color)]"
                >
                  🗑 清空
                </button>
              </div>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={10}
                placeholder="粘贴 CSV 内容（或点击「示例」加载）..."
                className="w-full px-2 py-1.5 text-[11px] font-mono rounded
                           bg-[var(--bg-app)] border border-[var(--border-color)]
                           text-[var(--text-primary)]
                           focus:outline-none focus:border-hermes-500"
                data-testid="batch-spawn-csv-input"
              />
              <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
                列：task (必填) / nickname / role / model / context
              </div>
            </div>

            {/* 配置步骤 */}
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)]/50 p-3">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-2">
                ⚙️ 步骤 2：执行配置
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-[var(--text-tertiary)] mb-0.5">
                    默认角色
                  </label>
                  <select
                    value={defaultRole}
                    onChange={(e) => setDefaultRole(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] rounded bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-primary)]"
                    data-testid="batch-spawn-role-select"
                  >
                    <option value="">(使用 CSV 中的 role)</option>
                    {roles.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-tertiary)] mb-0.5">
                    默认模型
                  </label>
                  <input
                    type="text"
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    placeholder="(可选)"
                    className="w-full px-2 py-1 text-[11px] rounded bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-primary)]"
                    data-testid="batch-spawn-model-input"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-tertiary)] mb-0.5">
                    并发度 (1-50)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxConcurrency}
                    onChange={(e) => setMaxConcurrency(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-2 py-1 text-[11px] rounded bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-primary)]"
                    data-testid="batch-spawn-concurrency"
                  />
                </div>
              </div>
            </div>

            {/* 提交步骤 */}
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)]/50 p-3">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-2">
                🚀 步骤 3：提交
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={batch.submitting || csv.trim().length === 0}
                  className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  data-testid="batch-spawn-submit-btn"
                >
                  {batch.submitting ? '⏳ 提交中...' : '▶ 提交批量任务'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={!currentJob || currentJob.status !== 'running'}
                  className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  data-testid="batch-spawn-cancel-btn"
                >
                  ⏹ 取消
                </button>
              </div>
            </div>

            {/* 错误 */}
            {batch.error && (
              <div
                className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-2 text-[11px] text-red-700 dark:text-red-300"
                data-testid="batch-spawn-error"
              >
                ⚠️ {batch.error}
              </div>
            )}

            {/* 历史任务列表 */}
            {batch.batchList.length > 0 && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)]/50 p-3 flex-1 min-h-0 flex flex-col">
                <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-2">
                  📋 历史任务 ({batch.batchList.length})
                </h3>
                <div className="space-y-1 overflow-auto flex-1 max-h-32">
                  {batch.batchList.map((j) => {
                    const m = JOB_STATUS_META[j.status] || JOB_STATUS_META.pending;
                    const isCurrent = currentJob && currentJob.batch_id === j.batch_id;
                    return (
                      <button
                        key={j.batch_id}
                        type="button"
                        onClick={() => handleSelectJob(j.batch_id)}
                        className={[
                          'w-full text-left text-[10px] p-1.5 rounded font-mono',
                          'flex items-center justify-between',
                          isCurrent
                            ? 'bg-hermes-500/10 border border-hermes-500/40'
                            : 'bg-[var(--bg-app)] hover:bg-[var(--bg-elevated)] border border-transparent',
                        ].join(' ')}
                        data-testid={`batch-spawn-history-${j.batch_id}`}
                      >
                        <span className="truncate">{j.batch_id}</span>
                        <span className={m.color}>
                          {m.icon} {m.label} {j.completed}/{j.total}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 右栏：进度 + 结果 */}
          <div className="flex flex-col min-h-0">
            {currentJob ? (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)]/50 flex-1 flex flex-col overflow-hidden">
                {/* 进度条 */}
                <div className="px-3 py-2 border-b border-[var(--border-color)]">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      {currentMeta && <span className={currentMeta.color}>{currentMeta.icon}</span>}
                      <span>Job: {currentJob.batch_id}</span>
                      <span className={`text-[10px] ${currentMeta?.color || ''}`}>
                        ({currentMeta?.label || currentJob.status})
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                        {currentJob.completed}/{currentJob.total}
                      </span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        失败 {currentJob.failed}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-app)] rounded overflow-hidden border border-[var(--border-color)]">
                    <div
                      className="h-full bg-hermes-500 transition-all"
                      style={{ width: `${Math.round((currentJob.progress || 0) * 100)}%` }}
                      data-testid="batch-spawn-progress-bar"
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                    <span>
                      ✅ {currentJob.completed} | ❌ {currentJob.failed} | ⚙️ {currentJob.in_progress} | 📋 {currentJob.total}
                    </span>
                    <span>{(currentJob.progress * 100).toFixed(0)}%</span>
                  </div>
                </div>

                {/* 结果表 */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <BatchResultTable job={currentJob} showHeader={false} compact testId="batch-spawn-result-table" />
                </div>

                {/* 导出操作 */}
                {(currentJob.status === 'completed' ||
                  currentJob.status === 'failed' ||
                  currentJob.status === 'cancelled') && (
                  <div className="px-3 py-2 border-t border-[var(--border-color)] flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--text-tertiary)] mr-1">导出：</span>
                    <button
                      type="button"
                      onClick={() => handleExport('json')}
                      className="px-2 py-0.5 text-[10px] bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)]"
                      data-testid="batch-spawn-export-json"
                    >
                      📄 JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport('csv')}
                      className="px-2 py-0.5 text-[10px] bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)]"
                      data-testid="batch-spawn-export-csv"
                    >
                      📊 CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport('md')}
                      className="px-2 py-0.5 text-[10px] bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)]"
                      data-testid="batch-spawn-export-md"
                    >
                      📝 MD
                    </button>
                    {exportStatus && (
                      <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
                        {exportStatus}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon="🚀"
                title="提交第一个批量任务"
                description="在左侧粘贴或加载 CSV，点击「提交批量任务」开始"
              />
            )}
          </div>
        </div>

        {/* 底部状态栏 */}
        <div className="border-t border-[var(--border-color)] px-4 py-1.5 text-[10px] text-[var(--text-tertiary)] flex justify-between">
          <span>
            总任务：{batch.batchList.length} | 当前并发：{maxConcurrency}
          </span>
          <span>Esc 关闭 | Ctrl+Enter 提交 | Ctrl+L 示例 | ? 帮助</span>
        </div>
      </div>

      {/* 帮助弹窗 */}
      {showHelp && (
        <div
          className="absolute inset-0 bg-black/60 flex items-center justify-center z-10"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-[var(--bg-panel)] rounded-lg p-5 max-w-md w-full border border-[var(--border-color)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-3 text-[var(--text-primary)]">
              ⌨️ 快捷键
            </h3>
            <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
              <li>
                <kbd className="px-1 bg-[var(--bg-elevated)] rounded">Esc</kbd> 关闭面板
              </li>
              <li>
                <kbd className="px-1 bg-[var(--bg-elevated)] rounded">Ctrl+Enter</kbd> 提交批量任务
              </li>
              <li>
                <kbd className="px-1 bg-[var(--bg-elevated)] rounded">Ctrl+L</kbd> 加载示例 CSV
              </li>
              <li>
                <kbd className="px-1 bg-[var(--bg-elevated)] rounded">?</kbd> 显示/隐藏帮助
              </li>
            </ul>
            <h3 className="text-base font-bold mt-4 mb-2 text-[var(--text-primary)]">
              📝 CSV 格式
            </h3>
            <ul className="text-[10px] space-y-0.5 text-[var(--text-secondary)] font-mono">
              <li>task (必填) - 任务描述</li>
              <li>nickname (可选) - 实例昵称</li>
              <li>role (可选) - Agent 角色</li>
              <li>model (可选) - 使用的模型</li>
              <li>context (可选) - JSON 上下文</li>
            </ul>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-4 w-full py-1 text-xs bg-[var(--bg-elevated)] rounded hover:bg-[var(--bg-app)]"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchSpawnPanel;
