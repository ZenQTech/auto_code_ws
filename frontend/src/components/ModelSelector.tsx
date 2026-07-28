/**
 * # ============================================================
 * # 模型版本选择器组件 - ModelSelector v2.0.0
 * # ============================================================
 * # 核心作用：动态加载内置 + 自定义模型
 * #           v2.0.0 整合 useAllModels() 替换硬编码列表
 * #           保留 Sol/Terra/Luna 作为内置模型
 * #           追加用户自定义 OpenAI-compatible 模型
 * # 运行流程：
 * #   1. 组件挂载时调用 GET /api/custom-models/models 拉取全部模型
 * #   2. 展示当前 selected 的模型（含自定义 Provider 徽章）
 * #   3. 用户选择 → POST /api/models/select
 * #   4. 成功后更新本地 state + 触发 onChange 回调
 * # 输入参数（Props）：
 * #   - onChange?: (modelId: string) => void，模型切换回调
 * #   - compact?: boolean，是否紧凑模式（紧凑模式不显示描述）
 * #   - className?: string，自定义样式类
 * # 输出结果：纯 UI 组件
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | Module E E1 初始版本：3 档模型下拉
 * #   - 2026-07-27 | v2.0.0 | Cycle 8 P0-14 升级：动态加载 + 自定义模型
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchModels, selectModel } from '../hooks/useApi';
import { useAllModels, type ModelInfo as CustomModelInfo } from '../hooks/useCustomModelsApi';

export interface ModelInfo {
  id: string;
  name: string;
  tagline: string;
  description: string;
  selected: boolean;
  is_custom?: boolean;
  provider_name?: string;
}

interface ModelSelectorProps {
  /** 模型切换回调（modelId 为新选中的 id） */
  onChange?: (modelId: string) => void;
  /** 紧凑模式：隐藏描述文字 */
  compact?: boolean;
  /** 自定义样式类 */
  className?: string;
}

/** 模型 ID → 主题色映射（内置模型固定主题） */
const MODEL_THEME: Record<string, { accent: string; ring: string; bg: string }> = {
  sol: {
    accent: 'text-amber-300',
    ring: 'ring-amber-400/40',
    bg: 'bg-amber-500/10',
  },
  terra: {
    accent: 'text-emerald-300',
    ring: 'ring-emerald-400/40',
    bg: 'bg-emerald-500/10',
  },
  luna: {
    accent: 'text-sky-300',
    ring: 'ring-sky-400/40',
    bg: 'bg-sky-500/10',
  },
};

const DEFAULT_THEME = { accent: 'text-surface-300', ring: 'ring-surface-400/30', bg: 'bg-surface-500/10' };
const CUSTOM_THEME = { accent: 'text-violet-300', ring: 'ring-violet-400/40', bg: 'bg-violet-500/10' };

/** 根据模型 ID 推断主题 */
function resolveTheme(model: ModelInfo): { accent: string; ring: string; bg: string } {
  if (model.is_custom) return CUSTOM_THEME;
  return MODEL_THEME[model.id] || DEFAULT_THEME;
}

/**
 * 模型选择器 v2.0.0
 * - 头部展示当前选中模型（带主题色 + tagline pill）
 * - 展开下拉列表（内置 + 自定义模型混合）
 * - 选择时显示 loading + 禁用交互
 */
export default function ModelSelector({
  onChange,
  compact = false,
  className = '',
}: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // v2.0.0: 通过 useAllModels 加载动态模型
  const { models: allCustomModels, refetch: refetchCustomModels } = useAllModels();

  /**
   * 加载模型列表：合并内置 /api/models 与 /api/custom-models/models
   * - 内置模型（Sol/Terra/Luna）从 useApi.fetchModels 拉取
   * - 自定义模型从 useCustomModelsApi.useAllModels 拉取
   * - 合并时使用 provider_id + model_id 区分
   */
  const loadModels = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      // 1) 拉取内置 Sol/Terra/Luna
      const builtinList = await fetchModels();

      // 2) 等待/触发自定义模型加载
      await refetchCustomModels();

      // 3) 合并为统一的 ModelInfo 列表
      const merged: ModelInfo[] = builtinList.map((m) => ({
        id: m.id,
        name: m.name,
        tagline: m.tagline,
        description: m.description,
        selected: m.selected,
        is_custom: false,
      }));

      // 4) 追加自定义模型（去重：按 id 排除已存在的内置模型）
      allCustomModels.forEach((cm: CustomModelInfo) => {
        // 排除内置模型（id 一致时跳过）
        if (builtinList.some((b) => b.id === cm.model_id)) return;
        merged.push({
          id: cm.id,
          name: cm.display_name,
          tagline: cm.provider_name || 'Custom',
          description: `Context: ${cm.context_window} · max_tokens: ${cm.max_tokens}`,
          selected: cm.selected,
          is_custom: true,
          provider_name: cm.provider_name,
        });
      });

      setModels(merged);
    } catch (e) {
      setError((e as Error).message || '加载模型失败');
    } finally {
      setFetching(false);
    }
  }, [allCustomModels, refetchCustomModels]);

  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 外部点击关闭下拉
   */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /**
   * 选择模型
   * - 内置模型走 /api/models/select
   * - 自定义模型：仅本地高亮（实际选择由后端 LLM 调用方处理）
   */
  const handleSelect = useCallback(
    async (modelId: string) => {
      if (loading) return;
      const target = models.find((m) => m.id === modelId);
      if (!target || target.selected) return;

      setLoading(true);
      setError(null);
      try {
        if (!target.is_custom) {
          // 内置模型：调用后端 select API
          const list = await selectModel(modelId);
          setModels((prev) =>
            prev.map((m) => ({ ...m, selected: m.id === modelId || (list.find((x) => x.id === m.id && x.selected) ? true : m.id === modelId) }))
          );
          // 简化更新：以 list 为准
          setModels(
            models.map((m) => ({
              ...m,
              selected: list.find((x) => x.id === m.id)?.selected ?? m.id === modelId,
            }))
          );
        } else {
          // 自定义模型：仅本地高亮
          setModels((prev) => prev.map((m) => ({ ...m, selected: m.id === modelId })));
        }
        setOpen(false);
        onChange?.(modelId);
      } catch (e) {
        setError((e as Error).message || '切换模型失败');
      } finally {
        setLoading(false);
      }
    },
    [loading, models, onChange]
  );

  const current = models.find((m) => m.selected) || models[0];
  const theme = current ? resolveTheme(current) : DEFAULT_THEME;

  if (fetching && models.length === 0) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-100/60 ${className}`}>
        <div className="w-3 h-3 border-2 border-surface-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-surface-500">加载模型...</span>
      </div>
    );
  }

  if (error && models.length === 0) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-300 text-xs ${className}`}>
        <span>模型加载失败</span>
        <button onClick={loadModels} className="underline hover:text-red-200">
          重试
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* 触发按钮：当前模型 */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                    bg-surface-100/60 border border-surface-300/40
                    hover:border-surface-300/80 transition-colors duration-fast
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${theme.ring} ring-1`}
      >
        {loading ? (
          <div className="w-3 h-3 border-2 border-surface-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full ${theme.bg} ${theme.accent}`} />
        )}
        <span className={`text-sm font-medium ${theme.accent}`}>
          {current?.name || '—'}
        </span>
        {!compact && current && (
          <span className="text-xs text-surface-500">· {current.tagline}</span>
        )}
        <svg
          className={`w-3.5 h-3.5 text-surface-500 transition-transform duration-fast ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
          strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* 下拉列表 */}
      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-2 w-80 rounded-xl
                     bg-surface-100/95 backdrop-blur-md
                     border border-surface-300/50 shadow-level-3
                     p-1 animate-lift-in"
        >
          {error && (
            <div className="px-3 py-2 text-xs text-red-300 bg-red-500/10 rounded-md mb-1">
              {error}
            </div>
          )}
          {models.map((m) => {
            const t = resolveTheme(m);
            return (
              <button
                key={m.id}
                role="option"
                aria-selected={m.selected}
                onClick={() => !m.selected && handleSelect(m.id)}
                disabled={loading}
                className={`w-full text-left px-3 py-2.5 rounded-lg
                            flex items-start gap-3 transition-colors duration-fast
                            ${m.selected
                              ? `${t.bg} cursor-default`
                              : 'hover:bg-surface-200/50 cursor-pointer'
                            }
                            disabled:opacity-50`}
              >
                <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.bg} ${t.accent}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${t.accent}`}>{m.name}</span>
                    <span className="text-[10px] text-surface-500 px-1.5 py-0.5 rounded bg-surface-200/60">
                      {m.tagline}
                    </span>
                    {m.is_custom && (
                      <span className="text-[10px] text-violet-300 px-1.5 py-0.5 rounded bg-violet-500/15">
                        Custom
                      </span>
                    )}
                    {m.selected && (
                      <span className="text-[10px] text-emerald-300 ml-auto">✓ 当前</span>
                    )}
                  </div>
                  {!compact && (
                    <p className="text-xs text-surface-500 mt-1 leading-relaxed line-clamp-2">
                      {m.description}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
