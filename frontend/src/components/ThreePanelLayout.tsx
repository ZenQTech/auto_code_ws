/**
 * # ============================================================
 * # ThreePanelLayout 三栏式布局组件（D3 - Module D TRAE SOLO）
 * # ============================================================
 * # 核心作用：实现 TRAE SOLO "三栏式 UI 布局"，
 * #           左侧任务管理 + 中间对话 + 右侧工具面板，
 * #           支持面板折叠、宽度可调、拖拽 resize。
 * # 运行流程：
 * #   1. 组件挂载时初始化左/中/右三个面板的宽度
 * #   2. 渲染顶部折叠按钮组 + 主体三栏
 * #   3. 拖拽中部分隔条：实时调整左右宽度（受最小/最大限制）
 * #   4. 点击折叠按钮：切换面板显隐，自动让其他面板占据空间
 * #   5. 拖拽时使用临时 state，松手时提交到正式 state
 * # 输入参数（Props）：
 * #   - left: ReactNode，左侧任务管理内容
 * #   - center: ReactNode，中间对话内容
 * #   - right: ReactNode，右侧工具面板内容
 * #   - defaultLeftWidth?: number，左侧默认宽度（px，默认 250）
 * #   - defaultRightWidth?: number，右侧默认宽度（px，默认 400）
 * #   - minPanelWidth?: number，面板最小宽度（px，默认 200）
 * #   - maxLeftWidth?: number，左侧最大宽度（px，默认 500）
 * #   - maxRightWidth?: number，右侧最大宽度（px，默认 700）
 * #   - storageKey?: string，宽度持久化 localStorage key
 * # 输出结果：纯 UI 布局组件
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 初始版本（Module D - D3）实现三栏式布局
 * # ============================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 安全读取 localStorage */
function safeGetItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // 忽略（Safari 隐私模式 / 配额满）
  }
  return null;
}

/** 安全写入 localStorage */
function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // 忽略
  }
}

interface Props {
  /** 左侧任务管理内容 */
  left: React.ReactNode;
  /** 中间对话内容 */
  center: React.ReactNode;
  /** 右侧工具面板内容 */
  right: React.ReactNode;
  /** 左侧默认宽度（px，默认 250） */
  defaultLeftWidth?: number;
  /** 右侧默认宽度（px，默认 400） */
  defaultRightWidth?: number;
  /** 面板最小宽度（px，默认 200） */
  minPanelWidth?: number;
  /** 左侧最大宽度（px，默认 500） */
  maxLeftWidth?: number;
  /** 右侧最大宽度（px，默认 700） */
  maxRightWidth?: number;
  /** 宽度持久化 localStorage key（可选） */
  storageKey?: string;
}

/** 面板折叠状态枚举 */
type PanelState = 'expanded' | 'collapsed';

export default function ThreePanelLayout({
  left,
  center,
  right,
  defaultLeftWidth = 250,
  defaultRightWidth = 400,
  minPanelWidth = 200,
  maxLeftWidth = 500,
  maxRightWidth = 700,
  storageKey,
}: Props) {
  // ============================================================
  // 持久化宽度读取
  // ============================================================
  const readPersisted = useCallback((): { left: number; right: number } => {
    if (!storageKey) return { left: defaultLeftWidth, right: defaultRightWidth };
    try {
      const raw = safeGetItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          left: typeof parsed.left === 'number' ? parsed.left : defaultLeftWidth,
          right: typeof parsed.right === 'number' ? parsed.right : defaultRightWidth,
        };
      }
    } catch {
      // 解析失败回退默认值
    }
    return { left: defaultLeftWidth, right: defaultRightWidth };
  }, [storageKey, defaultLeftWidth, defaultRightWidth]);

  const initial = readPersisted();

  /** 左侧面板宽度（px） */
  const [leftWidth, setLeftWidth] = useState<number>(initial.left);
  /** 右侧面板宽度（px） */
  const [rightWidth, setRightWidth] = useState<number>(initial.right);
  /** 左面板折叠态 */
  const [leftCollapsed, setLeftCollapsed] = useState<PanelState>('expanded');
  /** 右面板折叠态 */
  const [rightCollapsed, setRightCollapsed] = useState<PanelState>('expanded');
  /** 正在拖拽的分隔条（'left' | 'right' | null） */
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  /** 容器引用（用于尺寸约束） */
  const containerRef = useRef<HTMLDivElement>(null);

  // ============================================================
  // 持久化宽度到 localStorage
  // ============================================================
  useEffect(() => {
    if (!storageKey) return;
    safeSetItem(
      storageKey,
      JSON.stringify({ left: leftWidth, right: rightWidth })
    );
  }, [storageKey, leftWidth, rightWidth]);

  // ============================================================
  // 拖拽处理
  // ============================================================
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (dragging === 'left') {
        // 拖拽左分隔条：基于容器左侧距离计算新左宽
        const newLeft = Math.max(
          minPanelWidth,
          Math.min(maxLeftWidth, e.clientX - rect.left)
        );
        setLeftWidth(newLeft);
      } else if (dragging === 'right') {
        // 拖拽右分隔条：基于容器右侧距离计算新右宽
        const newRight = Math.max(
          minPanelWidth,
          Math.min(maxRightWidth, rect.right - e.clientX)
        );
        setRightWidth(newRight);
      }
    };

    const handleUp = () => {
      setDragging(null);
      // 恢复默认 cursor
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, minPanelWidth, maxLeftWidth, maxRightWidth]);

  /**
   * 开始拖拽
   * 输入：side 'left' | 'right'
   * 行为：设置 dragging 状态、修改 cursor、阻止文本选中
   */
  const startDrag = useCallback((side: 'left' | 'right') => {
    setDragging(side);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  /**
   * 切换左面板折叠态
   * 行为：expanded <-> collapsed
   */
  const toggleLeft = useCallback(() => {
    setLeftCollapsed((prev) => (prev === 'expanded' ? 'collapsed' : 'expanded'));
  }, []);

  /**
   * 切换右面板折叠态
   * 行为：expanded <-> collapsed
   */
  const toggleRight = useCallback(() => {
    setRightCollapsed((prev) => (prev === 'expanded' ? 'collapsed' : 'expanded'));
  }, []);

  // 计算实际宽度（折叠态时使用 0 宽度，由折叠条替代）
  const actualLeftWidth = leftCollapsed === 'collapsed' ? 0 : leftWidth;
  const actualRightWidth = rightCollapsed === 'collapsed' ? 0 : rightWidth;

  return (
    <div className="flex flex-col h-full">
      {/* ============================================================
       * 顶部折叠按钮组
       * ============================================================ */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-300 bg-surface-100/30">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleLeft}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              leftCollapsed === 'expanded'
                ? 'bg-hermes-500/15 text-hermes-300'
                : 'bg-surface-200 text-surface-500'
            }`}
            title={leftCollapsed === 'expanded' ? '折叠左栏' : '展开左栏'}
          >
            <svg
              className={`w-3 h-3 transition-transform ${leftCollapsed === 'expanded' ? '' : 'rotate-180'}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            <span>任务</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleRight}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              rightCollapsed === 'expanded'
                ? 'bg-hermes-500/15 text-hermes-300'
                : 'bg-surface-200 text-surface-500'
            }`}
            title={rightCollapsed === 'expanded' ? '折叠右栏' : '展开右栏'}
          >
            <span>工具</span>
            <svg
              className={`w-3 h-3 transition-transform ${rightCollapsed === 'expanded' ? '' : 'rotate-180'}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ============================================================
       * 主体三栏
       * ============================================================ */}
      <div
        ref={containerRef}
        className="flex-1 flex overflow-hidden min-h-0"
      >
        {/* 左侧：任务管理 */}
        {actualLeftWidth > 0 && (
          <div
            className="flex flex-col h-full overflow-hidden border-r border-surface-300"
            style={{ width: `${actualLeftWidth}px`, flexShrink: 0 }}
          >
            {left}
          </div>
        )}

        {/* 左分隔条（拖拽手柄） */}
        {actualLeftWidth > 0 && (
          <ResizeHandle
            side="left"
            isDragging={dragging === 'left'}
            onMouseDown={() => startDrag('left')}
          />
        )}

        {/* 中间：对话 */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {center}
        </div>

        {/* 右分隔条（拖拽手柄） */}
        {actualRightWidth > 0 && (
          <ResizeHandle
            side="right"
            isDragging={dragging === 'right'}
            onMouseDown={() => startDrag('right')}
          />
        )}

        {/* 右侧：工具面板 */}
        {actualRightWidth > 0 && (
          <div
            className="flex flex-col h-full overflow-hidden border-l border-surface-300"
            style={{ width: `${actualRightWidth}px`, flexShrink: 0 }}
          >
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ResizeHandle 分隔条组件
 * 输入：side 'left' | 'right'、isDragging、onMouseDown
 * 输出：可视化分隔条 + 拖拽手柄
 */
function ResizeHandle({
  side,
  isDragging,
  onMouseDown,
}: {
  side: 'left' | 'right';
  isDragging: boolean;
  onMouseDown: () => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`relative w-1 h-full cursor-col-resize transition-colors flex-shrink-0 ${
        isDragging
          ? 'bg-hermes-500/60'
          : 'bg-surface-300 hover:bg-hermes-500/40'
      }`}
      title="拖拽调整宽度"
      role="separator"
      aria-orientation="vertical"
    >
      {/* 拖拽手柄指示点 */}
      <div className={`absolute top-1/2 -translate-y-1/2 ${
        side === 'left' ? 'right-0.5' : 'left-0.5'
      } w-1 h-8 rounded-full ${
        isDragging ? 'bg-hermes-400' : 'bg-surface-500/30'
      }`} />
    </div>
  );
}
