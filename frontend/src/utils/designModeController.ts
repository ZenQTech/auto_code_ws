/**
 * # ============================================================
 * # DesignModeController - Design Mode 控制器 (v1.0.0 Cycle 19 G19-03)
 * # ============================================================
 * # 核心作用：在 Preview iframe 中接管鼠标事件，识别/高亮/选择 UI 元素
 * # 运行流程：
 * #   1. activate() - 注入鼠标事件监听
 * #   2. mouseover - 元素识别 + 高亮
 * #   3. click - 选中元素 + 收集信息
 * #   4. Shift+drag - 框选区域 + 截图
 * #   5. deactivate() - 移除监听 + 清理
 * # 输入参数：rootElement（Preview iframe 的 document）
 * # 输出结果：ElementInfo[] 选中元素数组
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-03 初次创建
 * # ============================================================
 */

import type {
  ElementInfo,
  DesignModeState,
  DesignEvent,
  DesignEventType,
  DesignEventHandler,
} from './designModeTypes';
import { generateId } from './designModeTypes';

/**
 * Design Mode 控制器
 */
export class DesignModeController {
  private state: DesignModeState = {
    isActive: false,
    hovered: null,
    selected: [],
    selectionBox: null,
    isDragging: false,
  };

  private listeners: Map<DesignEventType, Set<DesignEventHandler>> = new Map();
  private mouseoverHandler: ((e: MouseEvent) => void) | null = null;
  private mouseoutHandler: ((e: MouseEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private mousedownHandler: ((e: MouseEvent) => void) | null = null;
  private mousemoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseupHandler: ((e: MouseEvent) => void) | null = null;
  private rootElement: HTMLElement | Document | null = null;
  private maxSelected: number = 10;

  /**
   * 激活 Design Mode
   */
  activate(root: HTMLElement | Document = document): void {
    if (this.state.isActive) return;
    this.rootElement = root;
    this.state.isActive = true;
    this._attachListeners();
    this._emit({ type: 'activated', timestamp: Date.now() });
  }

  /**
   * 退出 Design Mode
   */
  deactivate(): void {
    if (!this.state.isActive) return;
    this._detachListeners();
    this.state = {
      isActive: false,
      hovered: null,
      selected: [],
      selectionBox: null,
      isDragging: false,
    };
    this._emit({ type: 'deactivated', timestamp: Date.now() });
  }

  /**
   * 切换
   */
  toggle(root?: HTMLElement | Document): void {
    if (this.state.isActive) {
      this.deactivate();
    } else {
      this.activate(root);
    }
  }

  /**
   * 清除选择
   */
  clear(): void {
    this.state.selected = [];
    this.state.hovered = null;
    this.state.selectionBox = null;
    this._emit({ type: 'cleared', timestamp: Date.now() });
  }

  /**
   * 手动选择元素
   */
  select(el: HTMLElement): ElementInfo {
    const info = getElementInfo(el);
    if (this.state.selected.length >= this.maxSelected) {
      this.state.selected.shift();
    }
    this.state.selected.push(info);
    this._emit({ type: 'selected', info, timestamp: Date.now() });
    return info;
  }

  /**
   * 取消选择
   */
  deselect(el: HTMLElement): void {
    const selector = getSelector(el);
    const idx = this.state.selected.findIndex(s => s.selector === selector);
    if (idx >= 0) {
      const removed = this.state.selected.splice(idx, 1)[0];
      this._emit({ type: 'deselected', info: removed, timestamp: Date.now() });
    }
  }

  /**
   * 获取当前状态
   */
  getState(): DesignModeState {
    return { ...this.state };
  }

  /**
   * 获取选中元素
   */
  getSelected(): ElementInfo[] {
    return [...this.state.selected];
  }

  /**
   * 获取悬停元素
   */
  getHovered(): ElementInfo | null {
    return this.state.hovered;
  }

  /**
   * 事件订阅
   */
  on(event: DesignEventType, handler: DesignEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: DesignEventType, handler: DesignEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  // ==================== 私有方法 ====================

  private _attachListeners(): void {
    const root = (this.rootElement ?? document) as Document | HTMLElement;
    const win = (root as Document).defaultView ?? window;

    this.mouseoverHandler = (e) => this._handleMouseOver(e);
    this.mouseoutHandler = (e) => this._handleMouseOut(e);
    this.clickHandler = (e) => this._handleClick(e);
    this.keydownHandler = (e) => this._handleKeyDown(e);
    this.mousedownHandler = (e) => this._handleMouseDown(e);
    this.mousemoveHandler = (e) => this._handleMouseMove(e);
    this.mouseupHandler = (e) => this._handleMouseUp(e);

    (root as Document | HTMLElement).addEventListener('mouseover', this.mouseoverHandler as EventListener, true);
    (root as Document | HTMLElement).addEventListener('mouseout', this.mouseoutHandler as EventListener, true);
    (root as Document | HTMLElement).addEventListener('click', this.clickHandler as EventListener, true);
    (root as Document | HTMLElement).addEventListener('mousedown', this.mousedownHandler as EventListener, true);
    (root as Document | HTMLElement).addEventListener('mousemove', this.mousemoveHandler as EventListener, true);
    (root as Document | HTMLElement).addEventListener('mouseup', this.mouseupHandler as EventListener, true);
    win.addEventListener('keydown', this.keydownHandler as EventListener);
  }

  private _detachListeners(): void {
    if (!this.rootElement) return;
    const root = this.rootElement as Document | HTMLElement;
    const win = (root as Document).defaultView ?? window;

    if (this.mouseoverHandler) root.removeEventListener('mouseover', this.mouseoverHandler as EventListener, true);
    if (this.mouseoutHandler) root.removeEventListener('mouseout', this.mouseoutHandler as EventListener, true);
    if (this.clickHandler) root.removeEventListener('click', this.clickHandler as EventListener, true);
    if (this.mousedownHandler) root.removeEventListener('mousedown', this.mousedownHandler as EventListener, true);
    if (this.mousemoveHandler) root.removeEventListener('mousemove', this.mousemoveHandler as EventListener, true);
    if (this.mouseupHandler) root.removeEventListener('mouseup', this.mouseupHandler as EventListener, true);
    if (this.keydownHandler) win.removeEventListener('keydown', this.keydownHandler as EventListener);

    this.mouseoverHandler = null;
    this.mouseoutHandler = null;
    this.clickHandler = null;
    this.keydownHandler = null;
    this.mousedownHandler = null;
    this.mousemoveHandler = null;
    this.mouseupHandler = null;
    this.rootElement = null;
  }

  private _handleMouseOver(e: MouseEvent): void {
    if (!this.state.isActive) return;
    const target = e.target as HTMLElement;
    if (!target || !isElement(target)) return;
    if (target.dataset.designIgnore === 'true') return;
    e.stopPropagation();
    const info = getElementInfo(target);
    this.state.hovered = info;
    this._emit({ type: 'hover', info, timestamp: Date.now() });
  }

  private _handleMouseOut(e: MouseEvent): void {
    if (!this.state.isActive) return;
    const target = e.target as HTMLElement;
    if (!target || !isElement(target)) return;
    e.stopPropagation();
    if (this.state.hovered && this.state.hovered.selector === getSelector(target)) {
      this.state.hovered = null;
      this._emit({ type: 'unhover', timestamp: Date.now() });
    }
  }

  private _handleClick(e: MouseEvent): void {
    if (!this.state.isActive) return;
    const target = e.target as HTMLElement;
    if (!target || !isElement(target)) return;
    e.preventDefault();
    e.stopPropagation();
    this.select(target);
  }

  private _handleMouseDown(e: MouseEvent): void {
    if (!this.state.isActive) return;
    if (!e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    this.state.isDragging = true;
    this.state.selectionBox = {
      id: generateId('box'),
      startX,
      startY,
      endX: startX,
      endY: startY,
      width: 0,
      height: 0,
    };
  }

  private _handleMouseMove(e: MouseEvent): void {
    if (!this.state.isActive || !this.state.isDragging || !this.state.selectionBox) return;
    e.preventDefault();
    const box = this.state.selectionBox;
    box.endX = e.clientX;
    box.endY = e.clientY;
    box.width = Math.abs(box.endX - box.startX);
    box.height = Math.abs(box.endY - box.startY);
    this._emit({ type: 'drag', box: { ...box }, timestamp: Date.now() });
  }

  private _handleMouseUp(e: MouseEvent): void {
    if (!this.state.isActive || !this.state.isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.state.selectionBox && this.state.selectionBox.width > 5) {
      this._emit({
        type: 'drag-end',
        box: { ...this.state.selectionBox },
        timestamp: Date.now(),
      });
    }
    this.state.isDragging = false;
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (!this.state.isActive) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.deactivate();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // Cmd/Ctrl+Enter 提交选择
      e.preventDefault();
      this._emit({ type: 'submit', selected: this.getSelected(), timestamp: Date.now() });
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // 删除最后一个选择
      if (this.state.selected.length > 0) {
        e.preventDefault();
        const last = this.state.selected.pop();
        if (last) {
          this._emit({ type: 'deselected', info: last, timestamp: Date.now() });
        }
      }
    }
  }

  private _emit(event: DesignEvent): void {
    this.listeners.get(event.type)?.forEach(handler => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[DesignModeController] handler error:', err);
      }
    });
  }
}

// ==================== 工具函数 ====================

/**
 * 是否元素
 */
function isElement(node: EventTarget | null): node is HTMLElement {
  return node instanceof HTMLElement;
}

/**
 * 获取元素的 CSS selector
 */
export function getSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;
  if (el.dataset?.testid) return `[data-testid="${el.dataset.testid}"]`;

  const parts: string[] = [];
  let current: HTMLElement | null = el;
  let depth = 0;

  while (current && current !== document.body && depth < 6) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`#${current.id}`);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/)
        .filter(c => !c.startsWith('_') && c.length > 0 && !/^(ng-|_|is-)/.test(c))
        .slice(0, 2);
      if (classes.length > 0) {
        part += '.' + classes.join('.');
      }
    }
    parts.unshift(part);
    current = current.parentElement;
    depth++;
  }

  return parts.length > 0 ? parts.join(' > ') : el.tagName.toLowerCase();
}

/**
 * 提取关键 computed styles
 */
export function getComputedStylesInfo(el: HTMLElement): ElementInfo['computedStyles'] {
  if (typeof window === 'undefined') return {};
  const cs = window.getComputedStyle(el);
  return {
    color: cs.color || undefined,
    backgroundColor: cs.backgroundColor || undefined,
    fontSize: cs.fontSize || undefined,
    fontWeight: cs.fontWeight || undefined,
    padding: cs.padding || undefined,
    margin: cs.margin || undefined,
    borderRadius: cs.borderRadius || undefined,
    border: cs.border || undefined,
    display: cs.display || undefined,
  };
}

/**
 * 提取元素信息
 */
export function getElementInfo(el: HTMLElement): ElementInfo {
  const rect = el.getBoundingClientRect();
  const text = (el.textContent || '').trim();
  return {
    selector: getSelector(el),
    tagName: el.tagName,
    id: el.id || undefined,
    className: typeof el.className === 'string' ? el.className : undefined,
    textContent: text ? text.slice(0, 200) : undefined,
    position: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    attributes: getAttributes(el),
    computedStyles: getComputedStylesInfo(el),
  };
}

/**
 * 获取元素属性
 */
function getAttributes(el: HTMLElement): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr.name.startsWith('on') || attr.name === 'style') continue;
    result[attr.name] = attr.value;
  }
  return result;
}

/**
 * 全局单例
 */
let globalController: DesignModeController | null = null;

export function getDesignModeController(): DesignModeController {
  if (!globalController) {
    globalController = new DesignModeController();
  }
  return globalController;
}

export function resetDesignModeController(): void {
  globalController = null;
}
