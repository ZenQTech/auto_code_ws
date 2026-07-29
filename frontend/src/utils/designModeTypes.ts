/**
 * # ============================================================
 * # Design Mode Types (v1.0.0 Cycle 19 G19-03)
 * # ============================================================
 * # 共享类型定义：ElementInfo / DesignModeState / 事件
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-03 初次创建
 * # ============================================================
 */

/**
 * 元素位置
 */
export interface ElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 元素信息
 */
export interface ElementInfo {
  selector: string;
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  position: ElementPosition;
  attributes: Record<string, string>;
  computedStyles: {
    color?: string;
    backgroundColor?: string;
    fontSize?: string;
    fontWeight?: string;
    padding?: string;
    margin?: string;
    borderRadius?: string;
    border?: string;
    display?: string;
  };
}

/**
 * 框选区域
 */
export interface SelectionBox {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
  screenshot?: string; // base64
}

/**
 * Design Mode 状态
 */
export interface DesignModeState {
  isActive: boolean;
  hovered: ElementInfo | null;
  selected: ElementInfo[];
  selectionBox: SelectionBox | null;
  isDragging: boolean;
}

/**
 * Design Mode 事件
 */
export type DesignEvent =
  | { type: 'activated'; timestamp: number }
  | { type: 'deactivated'; timestamp: number }
  | { type: 'cleared'; timestamp: number }
  | { type: 'hover'; info: ElementInfo; timestamp: number }
  | { type: 'unhover'; timestamp: number }
  | { type: 'selected'; info: ElementInfo; timestamp: number }
  | { type: 'deselected'; info: ElementInfo; timestamp: number }
  | { type: 'drag'; box: SelectionBox; timestamp: number }
  | { type: 'drag-end'; box: SelectionBox; timestamp: number }
  | { type: 'submit'; selected: ElementInfo[]; timestamp: number };

/**
 * 事件类型
 */
export type DesignEventType = DesignEvent['type'];

/**
 * 事件处理器
 */
export type DesignEventHandler = (event: DesignEvent) => void;

/**
 * Element Context（注入到 prompt）
 */
export interface ElementContext {
  type: 'element';
  elements: ElementInfo[];
  screenshot?: string;
  capturedAt: number;
  source: 'preview' | 'page';
}

/**
 * 注入到 system prompt 的格式
 */
export function injectElementContext(ctx: ElementContext): string {
  const lines: string[] = ['# Selected UI Elements', ''];
  ctx.elements.forEach((el, i) => {
    lines.push(`## Element ${i + 1}: <${el.tagName.toLowerCase()}>`);
    lines.push(`- Selector: \`${el.selector}\``);
    if (el.id) lines.push(`- ID: \`${el.id}\``);
    if (el.className) lines.push(`- Class: \`${el.className}\``);
    if (el.textContent) lines.push(`- Text: "${el.textContent}"`);
    lines.push(`- Position: ${el.position.width}x${el.position.height} at (${el.position.x}, ${el.position.y})`);
    const styleEntries = Object.entries(el.computedStyles).filter(([_, v]) => v).slice(0, 5);
    if (styleEntries.length > 0) {
      lines.push('- Key Styles:');
      styleEntries.forEach(([k, v]) => {
        lines.push(`  - ${k}: ${v}`);
      });
    }
    lines.push('');
  });
  if (ctx.screenshot) {
    lines.push('## Screenshot');
    lines.push(`![Selected area](${ctx.screenshot})`);
  }
  return lines.join('\n');
}

/**
 * 生成 ID
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
