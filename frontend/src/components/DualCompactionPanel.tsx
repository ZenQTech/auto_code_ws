/**
 * # ============================================================
 * 双触发压缩面板 - Pre-turn + Mid-turn
 * # ============================================================
 * 核心作用：展示双触发压缩配置和历史
 * 创建日期：2026-07-27
 * 模块版本：
 *   - v1.0.0 | 初始版本
 *   - v1.1.0 | UI/UX 升级：渐变标题 + 玻璃拟态 + 加载骨架 + 状态徽章 + toast 提示
 *   - v1.1.1 | 路径对比卡片 + 历史时间轴 + 配置实时反馈
 * ============================================================
 */

import React, { useState } from 'react';
import {
  useDualCompactionConfig,
  useCompactionHistory,
  type DualTriggerConfig,
  type CompactionHistoryItem,
} from '../hooks/useCycle3Api';

interface DualCompactionPanelProps {
  sessionId?: string;
  onClose?: () => void;
}

export const DualCompactionPanel: React.FC<DualCompactionPanelProps> = ({ sessionId, onClose }) => {
  const { config, loading, updateConfig } = useDualCompactionConfig();
  const { history, loading: historyLoading } = useCompactionHistory(sessionId, 50);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  if (loading || !config) {
    return (
      <div className="dual-compaction-panel p-4 bg-white rounded-lg shadow">
        <div className="h-6 w-32 bg-surface-100 rounded mb-4 animate-pulse" />
        <div className="space-y-2">
          <div className="h-12 bg-surface-100 rounded animate-pulse" />
          <div className="h-12 bg-surface-100 rounded animate-pulse" />
          <div className="h-24 bg-surface-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  const handleToggle = async (key: keyof DualTriggerConfig, value: any) => {
    try {
      await updateConfig({ [key]: value });
      setToast({ kind: 'success', text: '✓ 配置已更新' });
      setTimeout(() => setToast(null), 1500);
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '更新失败' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="dual-compaction-panel relative w-full h-full overflow-hidden bg-white rounded-2xl shadow-level-3 border border-surface-200 flex flex-col">
      {/* 渐变标题 */}
      <div className="flex-shrink-0 relative px-6 py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">🗜️</span>
              <span>双触发压缩</span>
            </h2>
            <p className="text-sm text-white/80 mt-1">
              Pre-turn · Mid-turn · Local · Remote
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-white/20 backdrop-blur-sm">
              Codex v0.139+
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
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* toast */}
        {toast && (
          <div className={`px-3 py-2 rounded text-sm animate-lift-in ${
            toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}>
            {toast.text}
          </div>
        )}

        {/* 触发配置 */}
        <div>
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-surface-700">
            <span>⚡</span>
            <span>触发配置</span>
          </div>
          <div className="space-y-2">
            <ConfigItem
              label="Pre-turn 触发"
              description="用户消息前自动检测 + 压缩"
              color="blue"
              checked={config.pre_turn_enabled}
              onChange={v => handleToggle('pre_turn_enabled', v)}
            />
            <ConfigItem
              label="Mid-turn 触发"
              description="长工具链循环边界压缩 + replay"
              color="yellow"
              checked={config.mid_turn_enabled}
              onChange={v => handleToggle('mid_turn_enabled', v)}
            />
            <div className="flex items-center justify-between p-3 bg-surface-50 rounded-lg">
              <div>
                <div className="text-sm font-medium text-surface-800">Mid-turn 阈值</div>
                <div className="text-xs text-surface-500">token 使用率超过此比例触发</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.5"
                  max="0.95"
                  step="0.05"
                  value={config.mid_turn_threshold_ratio}
                  onChange={e => handleToggle('mid_turn_threshold_ratio', parseFloat(e.target.value))}
                  className="w-28 h-1.5 bg-surface-200 rounded-full appearance-none cursor-pointer accent-amber-500"
                />
                <span className="text-sm font-mono w-12 text-right font-semibold text-amber-600">
                  {Math.round(config.mid_turn_threshold_ratio * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 路径对比 */}
        <div>
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-surface-700">
            <span>🔀</span>
            <span>压缩路径对比</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative p-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-base">💻</span>
                <span className="text-sm font-semibold text-blue-700">Local 路径</span>
              </div>
              <div className="text-xs text-surface-600 mb-1">客户端 LLM 调用</div>
              <div className="text-[10px] text-surface-500">延迟 5-15s</div>
              <div className="text-[10px] text-surface-500">目标 {config.local_target_tokens} tokens</div>
            </div>
            <div className="relative p-3 bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-lg">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-base">☁️</span>
                <span className="text-sm font-semibold text-purple-700">Remote 路径</span>
              </div>
              <div className="text-xs text-surface-600 mb-1">OpenAI compact API</div>
              <div className="text-[10px] text-surface-500">延迟 2-5s</div>
              <div className="text-[10px] text-surface-500 truncate">{config.remote_timeout_sec}s 超时</div>
            </div>
          </div>
        </div>

        {/* 历史 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-surface-700">
              <span>📜</span>
              <span>压缩历史</span>
              <span className="text-xs text-surface-400 font-normal">({history.length})</span>
            </div>
            <div className="text-xs text-surface-400">最近 50 条</div>
          </div>
          {historyLoading ? (
            <div className="space-y-2">
              <div className="h-14 bg-surface-100 rounded animate-pulse" />
              <div className="h-14 bg-surface-100 rounded animate-pulse" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-surface-400">
              <div className="text-4xl mb-2 opacity-50">📜</div>
              <div className="text-sm">暂无压缩记录</div>
              <div className="text-xs mt-1">触发压缩后会自动显示在这里</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {history.map(item => (
                <HistoryItem key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ConfigItem: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  color: 'blue' | 'yellow';
  onChange: (v: boolean) => void;
}> = ({ label, description, checked, color, onChange }) => {
  const accent = color === 'blue' ? 'peer-checked:bg-blue-500' : 'peer-checked:bg-amber-500';
  return (
    <div className="flex items-center justify-between p-3 bg-surface-50 rounded-lg hover:bg-surface-100 transition-colors">
      <div>
        <div className="text-sm font-medium text-surface-800">{label}</div>
        <div className="text-xs text-surface-500 mt-0.5">{description}</div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className={`w-10 h-5 bg-surface-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-offset-1 ${
          color === 'blue' ? 'peer-focus:ring-blue-300' : 'peer-focus:ring-amber-300'
        } rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all ${accent}`}></div>
      </label>
    </div>
  );
};

const HistoryItem: React.FC<{ item: CompactionHistoryItem }> = ({ item }) => {
  const triggerStyle =
    item.trigger === 'pre_turn' ? 'bg-blue-50 text-blue-700 border-blue-200' :
    item.trigger === 'mid_turn' ? 'bg-amber-50 text-amber-700 border-amber-200' :
    'bg-surface-100 text-surface-600 border-surface-200';
  const pathStyle = item.path === 'remote'
    ? 'bg-purple-50 text-purple-700 border-purple-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  const ratio = item.before_tokens > 0
    ? Math.round((1 - item.after_tokens / item.before_tokens) * 100)
    : 0;
  const isLargeRatio = ratio >= 30;

  return (
    <div className="p-2.5 bg-white border border-surface-200 rounded-lg hover:border-amber-300 hover:shadow-sm transition-all">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${triggerStyle}`}>
            {item.trigger}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${pathStyle}`}>
            {item.path}
          </span>
          <span className="text-[10px] text-surface-500 font-mono">{item.strategy}</span>
        </div>
        <span className="text-[10px] text-surface-400 font-mono">
          {new Date(item.created_at).toLocaleTimeString()}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-surface-600">
          <span className="font-mono">
            {item.before_tokens.toLocaleString()} → {item.after_tokens.toLocaleString()} tokens
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
            isLargeRatio ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-600'
          }`}>
            ↓ {ratio}%
          </span>
        </div>
        <span className="text-[10px] text-surface-400 font-mono">{item.duration_ms}ms</span>
      </div>
      {item.pending_request && (
        <div className="mt-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-700">
          ↻ Replayed pending request: <span className="font-mono">{item.pending_request.role || 'user'}</span>
        </div>
      )}
    </div>
  );
};

export default DualCompactionPanel;
