/**
 * # ============================================================
 * # CacheStatsPanel - LLM 缓存统计面板
 * # ============================================================
 * # 核心作用：可视化 LLM 4 层缓存的命中率、节省 token/成本、容量使用
 * #           支持查看配置、清空缓存、手动写入测试数据
 * # 运行流程：
 * #   1. 加载 GET /api/cache/stats 获取统计
 * #   2. 加载 GET /api/cache/config 获取配置
 * #   3. 展示 5 维统计卡片 + 4 层容量条 + 配置信息
 * #   4. 支持清空 / 重置 / 自动刷新
 * # 输入参数：onClose 回调
 * # 输出结果：完整缓存统计面板 DOM
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | Cycle 6 P0-7-A 新建
 * #     - 5 维统计卡片: 总请求/命中率/节省 token/节省成本/L4 in-flight
 * #     - 4 层容量条: L1/L2/L3 + 实时使用率
 * #     - 配置展示 + 清空/重置按钮
 * # ============================================================
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';

// ============================================================
// 类型定义
// ============================================================

export interface CacheStats {
  total_requests: number;
  l1_hits: number;
  l2_hits: number;
  l3_hits: number;
  l4_dedup_hits: number;
  misses: number;
  hit_rate: number;
  saved_tokens: number;
  saved_cost_usd: number;
  evictions: number;
  l1_size: number;
  l2_size: number;
  l3_size: number;
  l4_active: number;
}

export interface CacheConfig {
  l1_max_size: number;
  l1_ttl_seconds: number;
  l2_max_size: number;
  l2_threshold: number;
  l3_max_size: number;
  l3_ttl_seconds: number;
  cost_per_1k_input_usd: number;
  cost_per_1k_output_usd: number;
}

export interface CacheStatsPanelProps {
  onClose: () => void;
}

// API 客户端函数
async function apiGet(path: string): Promise<any> {
  const resp = await fetch(`/api/cache${path}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function apiPost(path: string, body?: any): Promise<any> {
  const resp = await fetch(`/api/cache${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ============================================================
// 子组件：统计卡片
// ============================================================

const StatCard: React.FC<{ label: string; value: string | number; icon: string; color: string; suffix?: string }> = ({
  label,
  value,
  icon,
  color,
  suffix,
}) => (
  <div className="bg-gradient-to-br from-surface-50 to-surface-100 border border-surface-300/40 rounded-lg p-3 flex items-center gap-2">
    <div className={`text-2xl ${color}`}>{icon}</div>
    <div className="flex-1 min-w-0">
      <div className="text-xs text-surface-600">{label}</div>
      <div className="text-lg font-bold text-surface-900 truncate">
        {value}
        {suffix && <span className="text-xs text-surface-500 ml-1">{suffix}</span>}
      </div>
    </div>
  </div>
);

// 容量条组件
const CapacityBar: React.FC<{ label: string; current: number; max: number; color: string }> = ({
  label,
  current,
  max,
  color,
}) => {
  const percent = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-surface-700 font-medium">{label}</span>
        <span className="text-surface-500">
          {current} / {max} ({percent.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 bg-surface-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-300`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const CacheStatsPanel: React.FC<CacheStatsPanelProps> = ({ onClose }) => {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [config, setConfig] = useState<CacheConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [actionMessage, setActionMessage] = useState<string>('');

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsResp, configResp] = await Promise.all([
        apiGet('/stats'),
        apiGet('/config'),
      ]);
      setStats(statsResp.stats);
      setConfig(configResp.config);
    } catch (e) {
      setError(`加载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      loadData();
    }, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, loadData]);

  // 清空缓存
  const handleClear = useCallback(async () => {
    if (!confirm('确定清空所有 4 层缓存吗？')) return;
    try {
      const result = await apiPost('/clear');
      setActionMessage(`✅ 已清空 ${result.total_cleared} 条缓存`);
      await loadData();
      setTimeout(() => setActionMessage(''), 3000);
    } catch (e) {
      setActionMessage(`❌ 清空失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadData]);

  // 重置缓存管理器
  const handleReset = useCallback(async () => {
    if (!confirm('确定重置缓存管理器（创建新实例）吗？')) return;
    try {
      await apiPost('/reset');
      setActionMessage('✅ 缓存管理器已重置');
      await loadData();
      setTimeout(() => setActionMessage(''), 3000);
    } catch (e) {
      setActionMessage(`❌ 重置失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadData]);

  // 测试缓存写入
  const handleTestPut = useCallback(async () => {
    try {
      const randomId = Math.random().toString(36).slice(2, 10);
      await apiPost('/put', {
        system: '你是一个测试用的 system prompt',
        user: `测试查询 ${randomId}`,
        model: 'claude-sonnet-4',
        max_tokens: 1024,
        response: `这是一个测试响应 ${randomId}，时间戳 ${new Date().toISOString()}`,
      });
      setActionMessage(`✅ 已写入测试条目 (${randomId})`);
      await loadData();
      setTimeout(() => setActionMessage(''), 3000);
    } catch (e) {
      setActionMessage(`❌ 写入失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadData]);

  // 命中率颜色
  const hitRateColor = useMemo(() => {
    if (!stats) return 'text-surface-500';
    if (stats.hit_rate >= 0.7) return 'text-emerald-600';
    if (stats.hit_rate >= 0.4) return 'text-amber-600';
    return 'text-rose-600';
  }, [stats]);

  return (
    <div className="flex flex-col h-full max-h-[85vh] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-300/30 flex-shrink-0 bg-gradient-to-r from-emerald-50 to-cyan-50">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          <div>
            <h2 className="text-base font-bold text-surface-900">LLM 缓存统计</h2>
            <p className="text-[10px] text-surface-500 mt-0.5">
              4 层缓存架构 (L1 精确 + L2 语义 + L3 前缀 + L4 去重) · v1.0.0
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full hover:bg-surface-200 flex items-center justify-center text-surface-500"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* 操作消息 */}
      {actionMessage && (
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-700">
          {actionMessage}
        </div>
      )}

      {/* 主体 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {loading && !stats && (
          <div className="text-center py-12 text-surface-500 text-sm">加载中...</div>
        )}

        {stats && (
          <>
            {/* 5 维统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <StatCard
                label="总请求"
                value={stats.total_requests}
                icon="📊"
                color="text-blue-500"
              />
              <StatCard
                label="命中率"
                value={`${(stats.hit_rate * 100).toFixed(1)}%`}
                icon="🎯"
                color={hitRateColor}
              />
              <StatCard
                label="节省 Token"
                value={stats.saved_tokens}
                icon="💰"
                color="text-amber-500"
              />
              <StatCard
                label="节省成本"
                value={`$${stats.saved_cost_usd.toFixed(4)}`}
                icon="💵"
                color="text-emerald-500"
              />
              <StatCard
                label="L4 In-Flight"
                value={stats.l4_active}
                icon="🚀"
                color="text-purple-500"
              />
            </div>

            {/* 各层命中数 */}
            <div className="bg-white border border-surface-300/40 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-surface-900 mb-2">各层命中数</h3>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="flex items-center gap-1.5 p-2 bg-emerald-50 rounded">
                  <span className="text-emerald-500">🟢</span>
                  <span className="text-surface-700">L1 精确</span>
                  <span className="ml-auto font-bold text-emerald-700">{stats.l1_hits}</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 bg-cyan-50 rounded">
                  <span className="text-cyan-500">🔵</span>
                  <span className="text-surface-700">L2 语义</span>
                  <span className="ml-auto font-bold text-cyan-700">{stats.l2_hits}</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 bg-amber-50 rounded">
                  <span className="text-amber-500">🟡</span>
                  <span className="text-surface-700">L3 前缀</span>
                  <span className="ml-auto font-bold text-amber-700">{stats.l3_hits}</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 bg-purple-50 rounded">
                  <span className="text-purple-500">🟣</span>
                  <span className="text-surface-700">L4 去重</span>
                  <span className="ml-auto font-bold text-purple-700">{stats.l4_dedup_hits}</span>
                </div>
              </div>
            </div>

            {/* 4 层容量 */}
            <div className="bg-white border border-surface-300/40 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-bold text-surface-900">4 层容量使用</h3>
              {config && (
                <>
                  <CapacityBar
                    label="L1 精确匹配缓存 (SHA-256)"
                    current={stats.l1_size}
                    max={config.l1_max_size}
                    color="bg-gradient-to-r from-emerald-400 to-emerald-500"
                  />
                  <CapacityBar
                    label="L2 语义匹配缓存 (TF-IDF)"
                    current={stats.l2_size}
                    max={config.l2_max_size}
                    color="bg-gradient-to-r from-cyan-400 to-cyan-500"
                  />
                  <CapacityBar
                    label="L3 前缀缓存 (Provider KV-Cache)"
                    current={stats.l3_size}
                    max={config.l3_max_size}
                    color="bg-gradient-to-r from-amber-400 to-amber-500"
                  />
                </>
              )}
            </div>

            {/* 配置信息 */}
            {config && (
              <div className="bg-white border border-surface-300/40 rounded-lg p-4 space-y-1 text-xs">
                <h3 className="text-sm font-bold text-surface-900 mb-2">配置信息</h3>
                <div className="grid grid-cols-2 gap-2 text-surface-600">
                  <div>L1 TTL: <span className="font-mono">{config.l1_ttl_seconds}s</span></div>
                  <div>L2 阈值: <span className="font-mono">{config.l2_threshold}</span></div>
                  <div>L3 TTL: <span className="font-mono">{config.l3_ttl_seconds}s</span></div>
                  <div>
                    输入 $/1K: <span className="font-mono">${config.cost_per_1k_input_usd}</span>
                  </div>
                  <div>
                    输出 $/1K: <span className="font-mono">${config.cost_per_1k_output_usd}</span>
                  </div>
                  <div>驱逐次数: <span className="font-mono">{stats.evictions}</span></div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-3 border-t border-surface-300/30 flex-shrink-0 flex-wrap bg-surface-50">
        <button
          onClick={loadData}
          disabled={loading}
          className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        >
          {loading ? '⟳ 加载中' : '🔄 刷新'}
        </button>
        <button
          onClick={handleTestPut}
          className="px-3 py-1.5 text-xs bg-emerald-500 hover:bg-emerald-600 text-white rounded font-medium"
        >
          ✏️ 测试写入
        </button>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-xs bg-rose-500 hover:bg-rose-600 text-white rounded font-medium"
        >
          🗑️ 清空
        </button>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded font-medium"
        >
          🔄 重置
        </button>
        <label className="flex items-center gap-1.5 text-xs text-surface-600 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          <span>自动刷新</span>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            disabled={!autoRefresh}
            className="px-1 py-0.5 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900 disabled:opacity-50"
          >
            <option value={2}>2s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
          </select>
        </label>
      </div>
    </div>
  );
};

export default CacheStatsPanel;
