/**
 * # ============================================================
 * # 推理强度选择器组件 - ReasoningIntensitySelector (Codex 风格)
 * # ============================================================
 * # 核心作用：提供三档推理强度选择（low / medium / high），
 * #           模拟 Codex CLI 的 reasoning effort 调节体验。
 * #           可作为独立组件使用，也可嵌入 ModelSelector。
 * # 运行流程：
 * #   1. 组件挂载时调用 GET /api/reasoning 拉取强度清单
 * #   2. 展示当前 selected 强度
 * #   3. 用户选择 → POST /api/reasoning/set
 * #   4. 成功后更新本地 state + 触发 onChange 回调
 * # 输入参数（Props）：
 * #   - onChange?: (intensity: 'low'|'medium'|'high', config?: object) => void
 * #   - variant?: 'segmented' | 'dropdown'，渲染风格（默认 segmented）
 * #   - className?: string，自定义样式类
 * # 输出结果：纯 UI 组件
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | Module E E2 初始版本：3 档强度选择器
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchIntensities, setReasoningIntensity, getCurrentIntensityApi } from '../hooks/useApi';

export type ReasoningIntensity = 'low' | 'medium' | 'high';

export interface IntensityInfo {
  id: ReasoningIntensity;
  label: string;
  description: string;
  selected: boolean;
}

export interface IntensityConfig {
  temperature: number;
  max_tokens: number;
  top_p: number;
}

interface ReasoningIntensitySelectorProps {
  /** 强度切换回调（intensity + 可选 config） */
  onChange?: (intensity: ReasoningIntensity, config?: IntensityConfig) => void;
  /** 渲染风格：segmented=三段式按钮组，dropdown=下拉 */
  variant?: 'segmented' | 'dropdown';
  /** 自定义样式类 */
  className?: string;
}

/** 强度 → 主题色 */
const INTENSITY_THEME: Record<ReasoningIntensity, string> = {
  low: 'text-sky-300',
  medium: 'text-emerald-300',
  high: 'text-fuchsia-300',
};

/**
 * 推理强度选择器
 * - 默认使用三段式 segmented 控件（更直观）
 * - 可选 dropdown 模式（与 ModelSelector 一致）
 */
export default function ReasoningIntensitySelector({
  onChange,
  variant = 'segmented',
  className = '',
}: ReasoningIntensitySelectorProps) {
  const [intensities, setIntensities] = useState<IntensityInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * 拉取强度列表
   */
  const loadIntensities = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const list = await fetchIntensities();
      setIntensities(list);
    } catch (e) {
      setError((e as Error).message || '加载强度失败');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    loadIntensities();
  }, [loadIntensities]);

  /**
   * dropdown 模式外部点击关闭
   */
  useEffect(() => {
    if (variant !== 'dropdown' || !open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, variant]);

  /**
   * 切换强度
   */
  const handleSelect = useCallback(
    async (intensity: ReasoningIntensity) => {
      if (loading) return;
      setLoading(true);
      setError(null);
      try {
        // 并行：更新后端 + 拉取最新清单
        const [, list] = await Promise.all([
          setReasoningIntensity(intensity),
          getCurrentIntensityApi(),
        ]);
        // 重新拉取清单以保持 selected 标志
        const refreshed = await fetchIntensities();
        setIntensities(refreshed);
        setOpen(false);
        onChange?.(intensity, list.config);
      } catch (e) {
        setError((e as Error).message || '切换强度失败');
      } finally {
        setLoading(false);
      }
    },
    [loading, onChange]
  );

  if (fetching && intensities.length === 0) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-100/60 ${className}`}>
        <div className="w-3 h-3 border-2 border-surface-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-surface-500">加载强度...</span>
      </div>
    );
  }

  if (error && intensities.length === 0) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-300 text-xs ${className}`}>
        <span>强度加载失败</span>
        <button onClick={loadIntensities} className="underline hover:text-red-200">
          重试
        </button>
      </div>
    );
  }

  const current = intensities.find((i) => i.selected) || intensities[0];

  // ============================================================
  // 渲染：segmented 三段式按钮
  // ============================================================
  if (variant === 'segmented') {
    return (
      <div className={`inline-flex flex-col gap-1.5 ${className}`}>
        <div
          ref={containerRef}
          role="radiogroup"
          aria-label="推理强度"
          className="inline-flex p-0.5 rounded-lg
                     bg-surface-100/60 border border-surface-300/40
                     relative"
        >
          {intensities.map((it) => {
            const active = it.selected;
            return (
              <button
                key={it.id}
                role="radio"
                aria-checked={active}
                onClick={() => !active && handleSelect(it.id)}
                disabled={loading}
                className={`relative px-3 py-1 rounded-md text-xs font-medium
                            transition-colors duration-fast
                            ${active
                              ? `${INTENSITY_THEME[it.id]} bg-surface-200/70`
                              : 'text-surface-500 hover:text-surface-300'
                            }
                            disabled:opacity-50`}
                title={it.description}
              >
                {loading && active ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                  </span>
                ) : (
                  it.label
                )}
              </button>
            );
          })}
        </div>
        {current && (
          <span className="text-[10px] text-surface-500 px-1 leading-snug line-clamp-1">
            {current.description}
          </span>
        )}
      </div>
    );
  }

  // ============================================================
  // 渲染：dropdown 下拉式
  // ============================================================
  const theme = current ? INTENSITY_THEME[current.id] : 'text-surface-300';
  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                    bg-surface-100/60 border border-surface-300/40
                    hover:border-surface-300/80 transition-colors duration-fast
                    disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {loading ? (
          <div className="w-3 h-3 border-2 border-surface-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="text-xs text-surface-500">强度</span>
        )}
        <span className={`text-sm font-medium ${theme}`}>
          {current?.label || '—'}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-surface-500 transition-transform duration-fast ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
          strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-2 w-64 right-0 rounded-xl
                     bg-surface-100/95 backdrop-blur-md
                     border border-surface-300/50 shadow-level-3
                     p-1 animate-lift-in"
        >
          {intensities.map((it) => (
            <button
              key={it.id}
              role="option"
              aria-selected={it.selected}
              onClick={() => !it.selected && handleSelect(it.id)}
              disabled={loading}
              className={`w-full text-left px-3 py-2 rounded-lg
                          flex items-start gap-3 transition-colors duration-fast
                          ${it.selected
                            ? 'bg-surface-200/60 cursor-default'
                            : 'hover:bg-surface-200/50'
                          }
                          disabled:opacity-50`}
            >
              <span className={`mt-1 text-xs font-medium ${INTENSITY_THEME[it.id]}`}>
                {it.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-surface-500 leading-relaxed">
                  {it.description}
                </p>
                {it.selected && (
                  <span className="text-[10px] text-emerald-300">✓ 当前</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
