/**
 * # ============================================================
 * 规则扫描面板 - 多文件类型 + 4 层加载
 * # ============================================================
 * 核心作用：扫描项目中多类型规则文件（AGENTS.md/CLAUDE.md/GEMINI.md 等）
 * 创建日期：2026-07-27
 * 模块版本：
 *   - v1.0.0 | 初始版本
 *   - v1.1.0 | UI/UX 升级：渐变标题 + 玻璃拟态 + 冲突高亮 + 加载骨架
 *   - v1.1.1 | 优先级可视化 + 复制预览 + 示例路径按钮
 * ============================================================
 */

import React, { useState } from 'react';
import {
  useRules,
  type RuleFileType,
  type RuleConflict,
} from '../hooks/useCycle3Api';

const FILE_TYPES: { value: RuleFileType; label: string; color: string; description: string }[] = [
  { value: 'AGENTS.md', label: 'AGENTS.md', color: 'bg-blue-100 text-blue-700 border-blue-200', description: 'OpenAI 标准' },
  { value: 'CLAUDE.md', label: 'CLAUDE.md', color: 'bg-purple-100 text-purple-700 border-purple-200', description: 'Anthropic 兼容' },
  { value: 'GEMINI.md', label: 'GEMINI.md', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', description: 'Google AI 兼容' },
  { value: '.cursorrules', label: '.cursorrules', color: 'bg-amber-100 text-amber-700 border-amber-200', description: 'Cursor 兼容' },
  { value: 'README.md', label: 'README.md', color: 'bg-surface-100 text-surface-700 border-surface-300', description: '特定章节抽取' },
];

const LAYER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  user: { label: 'User', icon: '👤', color: 'bg-blue-50 text-blue-700' },
  project: { label: 'Project', icon: '📁', color: 'bg-emerald-50 text-emerald-700' },
  sub_directory: { label: 'Sub-dir', icon: '📂', color: 'bg-amber-50 text-amber-700' },
  override: { label: 'Override', icon: '⚡', color: 'bg-rose-50 text-rose-700' },
};

const LAYER_ORDER = ['override', 'sub_directory', 'project', 'user'];

export const RulesPanel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [projectPath, setProjectPath] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<RuleFileType[]>([
    'AGENTS.md',
    'CLAUDE.md',
  ]);
  const [maxDepth, setMaxDepth] = useState(3);
  const [scanning, setScanning] = useState(false);
  const [conflicts, setConflicts] = useState<RuleConflict[]>([]);
  const [mergedPreview, setMergedPreview] = useState<{
    content: string;
    layers: { layer: string; count: number }[];
    total_size: number;
    truncated: boolean;
  } | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { rules, loading, scanRules, previewMerged, getConflicts } = useRules();

  const handleScan = async () => {
    if (!projectPath) {
      setToast({ kind: 'error', text: '请填写项目路径' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setScanning(true);
    try {
      const result = await scanRules(projectPath, selectedTypes, maxDepth);
      const conflictResult = await getConflicts(projectPath);
      setConflicts(conflictResult.conflicts || []);
      setToast({ kind: 'success', text: `✓ 扫描完成：${result.count} 个规则文件` });
      setTimeout(() => setToast(null), 2500);
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '扫描失败' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setScanning(false);
    }
  };

  const handlePreview = async () => {
    if (!projectPath) {
      setToast({ kind: 'error', text: '请填写项目路径' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    try {
      const result = await previewMerged(projectPath);
      setMergedPreview({
        content: result.merged_content,
        layers: result.layers,
        total_size: result.total_size,
        truncated: result.truncated,
      });
      setToast({ kind: 'info', text: '✓ 合并预览已生成' });
      setTimeout(() => setToast(null), 1500);
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '预览失败' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleCopy = async () => {
    if (!mergedPreview) return;
    try {
      await navigator.clipboard.writeText(mergedPreview.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setToast({ kind: 'error', text: '复制失败' });
      setTimeout(() => setToast(null), 2000);
    }
  };

  const handleQuickPath = (path: string) => {
    setProjectPath(path);
  };

  const toggleType = (t: RuleFileType) => {
    setSelectedTypes(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  };

  // 按优先级排序的规则
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  return (
    <div className="rules-panel relative w-full h-full overflow-hidden bg-white rounded-2xl shadow-level-3 border border-surface-200 flex flex-col">
      {/* 渐变标题 */}
      <div className="flex-shrink-0 relative px-6 py-4 bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">📜</span>
              <span>多类型规则扫描</span>
            </h2>
            <p className="text-sm text-white/80 mt-1">
              4 层加载架构 · 多文件类型 · 智能冲突检测
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-white/20 backdrop-blur-sm">
              4-Layer
            </span>
            {onClose && (
              <button
                onClick={onClose}
                title="关闭 (Esc)"
                aria-label="关闭"
                className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 flex items-center justify-center text-white transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="absolute -bottom-4 left-0 right-0 h-4 bg-gradient-to-b from-black/5 to-transparent" />
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* toast */}
        {toast && (
          <div className={`px-3 py-2 rounded text-sm animate-lift-in ${
            toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700' :
            toast.kind === 'error' ? 'bg-rose-50 text-rose-700' :
            'bg-blue-50 text-blue-700'
          }`}>
            {toast.text}
          </div>
        )}

        {/* 路径输入 */}
        <div>
          <label className="text-xs text-surface-600 mb-1 block font-medium">项目路径</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="/path/to/your/project"
              value={projectPath}
              onChange={e => setProjectPath(e.target.value)}
              className="flex-1 px-3 py-2 text-sm font-mono border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              onClick={() => handleQuickPath('/home/qizheng/auto_code_ws')}
              title="使用本项目作为测试"
              className="px-3 py-2 text-xs text-surface-600 hover:text-teal-600 hover:bg-teal-50 border border-surface-300 rounded-lg transition-colors"
            >
              示例
            </button>
          </div>
        </div>

        {/* 文件类型 */}
        <div>
          <label className="text-xs text-surface-600 mb-2 block font-medium">文件类型（多选）</label>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {FILE_TYPES.map(t => {
              const isSelected = selectedTypes.includes(t.value);
              return (
                <button
                  key={t.value}
                  onClick={() => toggleType(t.value)}
                  title={t.description}
                  className={`p-2 rounded-lg text-xs transition-all border ${
                    isSelected
                      ? `${t.color} shadow-sm`
                      : 'bg-white text-surface-500 border-surface-200 hover:border-surface-300'
                  }`}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-[10px] mt-0.5 opacity-70">{t.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 深度 */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-surface-600 font-medium">最大深度</label>
          <input
            type="number"
            min="1"
            max="10"
            value={maxDepth}
            onChange={e => setMaxDepth(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
            className="w-20 px-2 py-1 text-sm border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <span className="text-xs text-surface-400">1-10 层</span>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex-1 px-4 py-2.5 text-sm bg-gradient-to-r from-teal-500 to-emerald-500 text-white rounded-lg hover:from-teal-600 hover:to-emerald-600 disabled:opacity-50 transition-all shadow-sm flex items-center justify-center gap-1.5"
          >
            {scanning ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>扫描中...</span>
              </>
            ) : (
              <>
                <span>🔍</span>
                <span>扫描项目</span>
              </>
            )}
          </button>
          <button
            onClick={handlePreview}
            disabled={!projectPath || rules.length === 0}
            className="flex-1 px-4 py-2.5 text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-1.5"
          >
            <span>👁</span>
            <span>预览合并</span>
          </button>
        </div>

        {/* 冲突高亮 */}
        {conflicts.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg animate-lift-in">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">⚠️</span>
              <span className="text-sm font-semibold text-amber-800">
                检测到 {conflicts.length} 个冲突
              </span>
            </div>
            <div className="space-y-1.5">
              {conflicts.map((c, i) => (
                <div key={i} className="text-xs text-amber-700 flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 font-mono">{c.file_type}</span>
                  <span>{c.files.length} 个文件</span>
                  <span className="text-amber-400">·</span>
                  <span>生效层：<span className="font-semibold">{c.winning_layer}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 规则列表 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-surface-700">规则列表</div>
            {rules.length > 0 && (
              <div className="text-xs text-surface-400">
                共 {rules.length} 个 · 按优先级排序
              </div>
            )}
          </div>
          {loading ? (
            <div className="space-y-2">
              <div className="h-12 bg-surface-100 rounded animate-pulse" />
              <div className="h-12 bg-surface-100 rounded animate-pulse" />
              <div className="h-12 bg-surface-100 rounded animate-pulse" />
            </div>
          ) : sortedRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-surface-400">
              <div className="text-4xl mb-2 opacity-50">📜</div>
              <div className="text-sm">暂无规则文件</div>
              <div className="text-xs mt-1">填写项目路径并点击"扫描项目"开始</div>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {sortedRules.map(rule => {
                const typeConfig = FILE_TYPES.find(t => t.value === rule.file_type);
                const layerConfig = LAYER_LABELS[rule.layer];
                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-2.5 bg-white border border-surface-200 rounded-lg hover:border-teal-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-base flex-shrink-0">{layerConfig?.icon}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        typeConfig?.color || 'bg-surface-100'
                      }`}>
                        {rule.file_type}
                      </span>
                      <span className="text-xs text-surface-600 truncate font-mono">
                        {rule.relative_path}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-surface-500 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded ${layerConfig?.color || 'bg-surface-100'}`}>
                        {layerConfig?.label}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-100 font-mono">
                        P{rule.priority}
                      </span>
                      <span className="font-mono">{rule.size}B</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 合并预览 */}
        {mergedPreview && (
          <div className="p-3 bg-gradient-to-br from-surface-50 to-blue-50 border border-surface-200 rounded-lg animate-lift-in">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-surface-700 flex items-center gap-1.5">
                <span>📋</span>
                <span>合并预览</span>
              </div>
              <button
                onClick={handleCopy}
                className="px-2 py-1 text-xs text-surface-600 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
              >
                {copied ? '✓ 已复制' : '📋 复制'}
              </button>
            </div>
            <div className="flex items-center gap-2 mb-2 text-xs">
              <span className="text-surface-500">
                {mergedPreview.total_size.toLocaleString()} chars
              </span>
              {mergedPreview.truncated && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">
                  已截断
                </span>
              )}
              <span className="text-surface-300">·</span>
              {mergedPreview.layers
                .sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer))
                .map(l => (
                  <span key={l.layer} className="px-1.5 py-0.5 rounded bg-white border border-surface-200">
                    {l.layer}: {l.count}
                  </span>
                ))}
            </div>
            <pre className="text-xs bg-white p-3 rounded border border-surface-200 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-surface-700">
              {mergedPreview.content}
            </pre>
          </div>
        )}

        {/* 4 层加载架构说明 */}
        <details className="text-xs text-surface-600 bg-surface-50 border border-surface-200 rounded-lg p-3">
          <summary className="cursor-pointer font-medium text-surface-700 hover:text-surface-900">
            💡 4 层加载架构说明
          </summary>
          <div className="mt-2 space-y-1 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-mono">override</span>
              <span>最高优先级，覆盖其他所有层</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-mono">sub_directory</span>
              <span>子目录级规则，最近文件优先</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono">project</span>
              <span>项目根目录规则</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono">user</span>
              <span>用户全局规则（~/.claude/CLAUDE.md 等）</span>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default RulesPanel;
