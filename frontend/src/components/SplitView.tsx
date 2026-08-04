/**
 * # ============================================================
 * SplitView - 双栏布局组件 (v1.0.0)
 * Cycle 61 G61-03-T2
 * # ============================================================
 * 核心作用：主面板 + 工具面板上下分屏，拖拽调整比例
 * 运行流程：
 *   1. 接收 primary / secondary 两个 React 节点
 *   2. 用户可拖拽中间分割条调整比例（默认 60/40）
 *   3. 比例持久化到 localStorage
 *   4. 响应式：移动端自动切换为堆叠布局
 * 设计要点：
 *   - 拖拽节流：使用 requestAnimationFrame
 *   - 边界保护：最小 20% / 最大 80%
 *   - 主题感知：使用 Tailwind bg-[var(--bg-panel)]
 * 输入参数：{ primary, secondary, initialRatio?, onRatioChange? }
 * 输出结果：React JSX
 * ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-03-T2 初次创建
 * ====================================
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
// useResponsive 可能在测试环境无响应式检测，做兜底处理
import { useResponsive as useResponsiveImpl } from '../hooks/useResponsive';
const useResponsive = useResponsiveImpl || (() => ({ isMobile: false, isTablet: false, isDesktop: true }));

const STORAGE_KEY_RATIO = 'hermes.splitView.ratio';
const DEFAULT_RATIO = 0.6;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const isBrowser = typeof window !== 'undefined';

export interface SplitViewProps {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  initialRatio?: number;
  onRatioChange?: (ratio: number) => void;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
  testId?: string;
  'data-testid'?: string;
}

function readStoredRatio(): number {
  if (!isBrowser) return DEFAULT_RATIO;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY_RATIO);
    if (!v) return DEFAULT_RATIO;
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= MIN_RATIO && n <= MAX_RATIO) {
      return n;
    }
  } catch (err) {
    console.warn('SplitView: localStorage read failed', err);
  }
  return DEFAULT_RATIO;
}

function writeStoredRatio(ratio: number): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_RATIO, String(ratio));
  } catch (err) {
    console.warn('SplitView: localStorage write failed', err);
  }
}

export const SplitView: React.FC<SplitViewProps> = ({
  primary,
  secondary,
  initialRatio = DEFAULT_RATIO,
  onRatioChange,
  className = '',
  primaryClassName = '',
  secondaryClassName = '',
  testId = 'split-view',
}) => {
  const { isMobile } = useResponsive();
  // 初始化：initialRatio 优先，缺失时回退到 localStorage
  const [ratio, setRatio] = useState<number>(() => {
    if (initialRatio !== undefined) {
      return Math.max(MIN_RATIO, Math.min(MAX_RATIO, initialRatio));
    }
    return readStoredRatio();
  });
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // 持久化
  useEffect(() => {
    writeStoredRatio(ratio);
    onRatioChange?.(ratio);
  }, [ratio, onRatioChange]);

  // 拖拽开始
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  // 拖拽中
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      // 节流：使用 rAF
      if (rafRef.current !== null) return;

      rafRef.current = requestAnimationFrame(() => {
        const rect = containerRef.current!.getBoundingClientRect();
        const newRatio = (e.clientY - rect.top) / rect.height;
        const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, newRatio));
        setRatio(clamped);
        rafRef.current = null;
      });
    };

    const handleUp = () => {
      setDragging(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  // 移动端：堆叠布局
  if (isMobile) {
    return (
      <div
        ref={containerRef}
        data-testid={testId}
        className={`flex flex-col h-full ${className}`}
      >
        <div
          data-testid={`${testId}-primary`}
          className={`flex-1 overflow-auto ${primaryClassName}`}
        >
          {primary}
        </div>
        <div
          data-testid={`${testId}-secondary`}
          className={`flex-1 overflow-auto border-t border-[var(--border-color)] ${secondaryClassName}`}
        >
          {secondary}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`flex flex-col h-full ${className}`}
    >
      <div
        data-testid={`${testId}-primary`}
        style={{ flex: ratio }}
        className={`overflow-auto ${primaryClassName}`}
      >
        {primary}
      </div>
      <div
        data-testid={`${testId}-divider`}
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={MIN_RATIO * 100}
        aria-valuemax={MAX_RATIO * 100}
        onMouseDown={handleDragStart}
        className={`h-1 cursor-row-resize bg-[var(--border-color)] hover:bg-hermes-500 transition-colors ${
          dragging ? 'bg-hermes-500' : ''
        }`}
      />
      <div
        data-testid={`${testId}-secondary`}
        style={{ flex: 1 - ratio }}
        className={`overflow-auto ${secondaryClassName}`}
      >
        {secondary}
      </div>
    </div>
  );
};

export default SplitView;
