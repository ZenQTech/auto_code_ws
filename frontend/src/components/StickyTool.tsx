/**
 * # ============================================================
 * StickyTool - 固定工具组件 (v1.0.0)
 * Cycle 61 G61-03-T3
 * # ============================================================
 * 核心作用：将重要工具固定在视图中，防止 Auto-Follow 自动切换
 * 运行流程：
 *   1. 接收 panel 名称和 children
 *   2. 渲染时显示 📌 标记
 *   3. 鼠标悬停时显示 unpin 按钮
 *   4. 点击 unpin 触发 onUnstick 回调
 * 设计要点：
 *   - 视觉指示：右上角 📌 emoji
 *   - 主题感知：使用 bg-[var(--bg-panel)]
 *   - 可嵌套在任何布局中
 * 输入参数：{ panel, children, onUnstick?, testId? }
 * 输出结果：React JSX
 * ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-03-T3 初次创建
 * ====================================
 */

import React, { useState } from 'react';
import type { PanelKey } from '../hooks/useModals';

export interface StickyToolProps {
  panel: PanelKey;
  children: React.ReactNode;
  onUnstick?: (panel: PanelKey) => void;
  className?: string;
  testId?: string;
}

export const StickyTool: React.FC<StickyToolProps> = ({
  panel,
  children,
  onUnstick,
  className = '',
  testId,
}) => {
  const [hovered, setHovered] = useState(false);
  const testIdValue = testId ?? `sticky-tool-${panel}`;

  const handleUnstick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUnstick?.(panel);
  };

  return (
    <div
      data-testid={testIdValue}
      data-sticky-panel={panel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative ${className}`}
    >
      {/* Sticky 标记 */}
      <div
        data-testid={`${testIdValue}-pin`}
        className="absolute top-1 right-1 z-10 text-xs select-none pointer-events-none"
        aria-label="sticky"
        title="此工具已固定，不受 Auto-Follow 影响"
      >
        📌
      </div>

      {/* Unpin 按钮（hover 时显示） */}
      {hovered && onUnstick && (
        <button
          type="button"
          data-testid={`${testIdValue}-unpin`}
          onClick={handleUnstick}
          className="absolute top-1 right-7 z-20 px-2 py-0.5 text-xs rounded
            bg-[var(--bg-elevated)] hover:bg-red-500 hover:text-white
            text-[var(--text-secondary)] transition-colors"
          title="解除固定"
          aria-label="解除固定"
        >
          ✕
        </button>
      )}

      {children}
    </div>
  );
};

export default StickyTool;
