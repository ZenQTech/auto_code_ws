/**
 * # ============================================================
 * # DesignModeOverlay - Design Mode 覆盖层 (v1.0.0 Cycle 19 G19-03)
 * # ============================================================
 * # 核心作用：在 Preview iframe 上覆盖一层，识别/高亮/选择 UI 元素
 * # 运行流程：
 * #   1. 激活时显示覆盖层 + 监听 mouseover/click/拖拽
 * #   2. 鼠标悬停时高亮元素 + 浮动标签
 * #   3. 点击选中元素
 * #   4. Shift+drag 框选区域
 * #   5. 工具栏：截图/清空/退出
 * # 输入参数：isActive / onExit / onSelect / rootElement
 * # 输出结果：覆盖层 JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-03 初次创建
 * # ============================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getDesignModeController } from '../utils/designModeController';
import type { ElementInfo, SelectionBox } from '../utils/designModeTypes';

export interface DesignModeOverlayProps {
  isActive: boolean;
  rootElement?: HTMLElement | Document;
  onExit: () => void;
  onSelect?: (info: ElementInfo[]) => void;
  onCapture?: (info: ElementInfo[]) => void;
}

export function DesignModeOverlay({ isActive, rootElement, onExit, onSelect, onCapture }: DesignModeOverlayProps) {
  const controller = useRef(getDesignModeController()).current;
  const [hovered, setHovered] = useState<ElementInfo | null>(null);
  const [selected, setSelected] = useState<ElementInfo[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  useEffect(() => {
    if (!isActive) {
      controller.deactivate();
      return;
    }
    controller.activate(rootElement);
    const offHover = controller.on('hover', (e) => {
      if (e.type === 'hover') setHovered(e.info);
    });
    const offUnhover = controller.on('unhover', () => setHovered(null));
    const offSelected = controller.on('selected', (e) => {
      if (e.type === 'selected') setSelected(controller.getSelected());
    });
    const offDeselected = controller.on('deselected', () => setSelected(controller.getSelected()));
    const offDrag = controller.on('drag', (e) => {
      if (e.type === 'drag') setSelectionBox(e.box);
    });
    const offDragEnd = controller.on('drag-end', () => setSelectionBox(null));
    return () => {
      offHover();
      offUnhover();
      offSelected();
      offDeselected();
      offDrag();
      offDragEnd();
      controller.deactivate();
    };
  }, [controller, isActive, rootElement]);

  const handleClear = useCallback(() => {
    controller.clear();
    setSelected([]);
    setHovered(null);
  }, [controller]);

  const handleSubmit = useCallback(() => {
    onSelect?.(selected);
    onExit();
  }, [selected, onSelect, onExit]);

  const handleCapture = useCallback(() => {
    onCapture?.(selected);
  }, [selected, onCapture]);

  if (!isActive) return null;

  return (
    <div
      data-testid="design-mode-overlay"
      className="fixed inset-0 z-[60] pointer-events-none"
    >
      {/* Hovered Element Outline */}
      {hovered && (
        <div
          data-testid="design-mode-hover-outline"
          className="absolute border-2 border-blue-500 pointer-events-none transition-all"
          style={{
            left: hovered.position.x,
            top: hovered.position.y,
            width: hovered.position.width,
            height: hovered.position.height,
          }}
        >
          <div className="absolute -top-6 left-0 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded">
            {hovered.tagName.toLowerCase()}
            {hovered.className && `.${hovered.className.split(' ')[0]}`}
          </div>
        </div>
      )}

      {/* Selected Elements Outlines */}
      {selected.map((info, idx) => (
        <div
          key={`selected-${idx}`}
          data-testid={`design-mode-selected-outline-${idx}`}
          className="absolute border-2 border-green-500 pointer-events-none"
          style={{
            left: info.position.x,
            top: info.position.y,
            width: info.position.width,
            height: info.position.height,
          }}
        >
          <div className="absolute -top-6 right-0 px-1.5 py-0.5 bg-green-500 text-white text-xs rounded">
            {idx + 1}
          </div>
        </div>
      ))}

      {/* Selection Box (drag) */}
      {selectionBox && (
        <div
          data-testid="design-mode-selection-box"
          className="absolute border-2 border-dashed border-yellow-500 bg-yellow-500/10 pointer-events-none"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
      )}

      {/* Top Banner */}
      <div
        data-testid="design-mode-banner"
        className="absolute top-0 left-0 right-0 bg-blue-500 text-white text-center py-2 text-sm pointer-events-auto"
      >
        Design Mode 已激活 · 点击元素选择 · Shift+Drag 框选 · ESC 退出
      </div>

      {/* Bottom Toolbar */}
      <div
        data-testid="design-mode-toolbar"
        className="absolute bottom-4 right-4 flex gap-2 pointer-events-auto"
      >
        <div className="bg-surface-800 border border-surface-700 rounded px-3 py-1 text-xs text-surface-300">
          已选 {selected.length} 个
        </div>
        <button
          data-testid="design-mode-clear"
          onClick={handleClear}
          className="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded hover:bg-yellow-500/30 text-sm"
        >
          清空
        </button>
        {onCapture && (
          <button
            data-testid="design-mode-capture"
            onClick={handleCapture}
            disabled={selected.length === 0}
            className="px-3 py-1 bg-purple-500/20 text-purple-300 rounded hover:bg-purple-500/30 text-sm disabled:opacity-50"
          >
            📷 截图
          </button>
        )}
        <button
          data-testid="design-mode-submit"
          onClick={handleSubmit}
          disabled={selected.length === 0}
          className="px-3 py-1 bg-hermes-500 text-white rounded hover:bg-hermes-600 text-sm disabled:opacity-50"
        >
          ✓ 应用到 Prompt
        </button>
        <button
          data-testid="design-mode-exit"
          onClick={onExit}
          className="px-3 py-1 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 text-sm"
        >
          ✕ 退出
        </button>
      </div>
    </div>
  );
}

export default DesignModeOverlay;
