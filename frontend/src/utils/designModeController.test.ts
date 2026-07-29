/**
 * DesignModeController 单元测试 (v1.0.0 Cycle 19 G19-03)
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DesignModeController, getSelector, getElementInfo } from './designModeController';
import { injectElementContext } from './designModeTypes';

describe('DesignModeController', () => {
  let controller: DesignModeController;
  let root: HTMLElement;

  beforeEach(() => {
    // 准备 DOM
    document.body.innerHTML = '';
    root = document.createElement('div');
    root.id = 'test-root';
    root.innerHTML = `
      <div class="container" data-testid="container">
        <button class="btn btn-primary" id="submit">Submit</button>
        <input type="text" class="input" />
        <p class="text">Some text content</p>
      </div>
    `;
    document.body.appendChild(root);
    controller = new DesignModeController();
  });

  afterEach(() => {
    controller.deactivate();
    document.body.innerHTML = '';
  });

  describe('activate / deactivate', () => {
    it('activate 后 isActive=true', () => {
      controller.activate(root);
      expect(controller.getState().isActive).toBe(true);
    });

    it('deactivate 后 isActive=false', () => {
      controller.activate(root);
      controller.deactivate();
      expect(controller.getState().isActive).toBe(false);
    });

    it('toggle 切换状态', () => {
      controller.toggle(root);
      expect(controller.getState().isActive).toBe(true);
      controller.toggle(root);
      expect(controller.getState().isActive).toBe(false);
    });
  });

  describe('事件', () => {
    it('emit activated 事件', () => {
      const handler = vi.fn();
      controller.on('activated', handler);
      controller.activate(root);
      expect(handler).toHaveBeenCalled();
    });

    it('emit deactivated 事件', () => {
      const handler = vi.fn();
      controller.activate(root);
      controller.on('deactivated', handler);
      controller.deactivate();
      expect(handler).toHaveBeenCalled();
    });

    it('emit hover 事件', () => {
      const handler = vi.fn();
      controller.activate(root);
      controller.on('hover', handler);
      const button = root.querySelector('#submit') as HTMLElement;
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('select / deselect', () => {
    it('select 添加到 selected', () => {
      controller.activate(root);
      const button = root.querySelector('#submit') as HTMLElement;
      controller.select(button);
      const selected = controller.getSelected();
      expect(selected.length).toBe(1);
      expect(selected[0].tagName).toBe('BUTTON');
    });

    it('deselect 移除指定元素', () => {
      controller.activate(root);
      const button = root.querySelector('#submit') as HTMLElement;
      controller.select(button);
      controller.deselect(button);
      expect(controller.getSelected().length).toBe(0);
    });

    it('超过 maxSelected 限制时移除最早', () => {
      controller.activate(root);
      // maxSelected 默认是 10
      // 添加 11 个不同元素，第 1 个应该被移除
      const elements: HTMLElement[] = [];
      for (let i = 0; i < 11; i++) {
        const el = document.createElement('div');
        el.id = `el${i}`;
        el.className = `item-${i}`;
        root.appendChild(el);
        elements.push(el);
      }
      elements.forEach(el => controller.select(el));
      const selected = controller.getSelected();
      // 应该有 10 个（maxSelected），第 1 个被移除
      expect(selected.length).toBe(10);
      expect(selected[0].id).toBe('el1'); // 第一个 el0 被移除
      expect(selected[9].id).toBe('el10'); // 最后一个是 el10
    });

    it('clear 清空所有', () => {
      controller.activate(root);
      const button = root.querySelector('#submit') as HTMLElement;
      controller.select(button);
      controller.clear();
      expect(controller.getSelected().length).toBe(0);
    });
  });
});

describe('getSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('应该使用 id', () => {
    const el = document.createElement('div');
    el.id = 'unique-id';
    expect(getSelector(el)).toBe('#unique-id');
  });

  it('应该使用 data-testid', () => {
    const el = document.createElement('div');
    el.dataset.testid = 'my-test';
    expect(getSelector(el)).toBe('[data-testid="my-test"]');
  });

  it('应该使用 class', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    expect(getSelector(el)).toContain('.foo');
  });

  it('应该使用 tagName', () => {
    document.body.innerHTML = '<div></div>';
    const el = document.querySelector('div') as HTMLElement;
    const selector = getSelector(el);
    expect(selector).toContain('div');
  });
});

describe('getElementInfo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('应该提取完整信息', () => {
    const el = document.createElement('button');
    el.id = 'test-btn';
    el.className = 'btn primary';
    el.textContent = 'Click me';
    el.setAttribute('data-test', 'value');
    document.body.appendChild(el);

    const info = getElementInfo(el);
    expect(info.selector).toBe('#test-btn');
    expect(info.tagName).toBe('BUTTON');
    expect(info.id).toBe('test-btn');
    expect(info.className).toBe('btn primary');
    expect(info.textContent).toBe('Click me');
    expect(info.attributes['data-test']).toBe('value');
    expect(info.position).toBeDefined();
  });

  it('应该处理空元素', () => {
    const el = document.createElement('div');
    el.id = 'empty';
    document.body.appendChild(el);
    const info = getElementInfo(el);
    expect(info.textContent).toBeUndefined();
  });

  it('应该截断长文本', () => {
    const el = document.createElement('p');
    el.id = 'long';
    el.textContent = 'a'.repeat(500);
    document.body.appendChild(el);
    const info = getElementInfo(el);
    expect(info.textContent?.length).toBeLessThanOrEqual(200);
  });
});

describe('injectElementContext', () => {
  it('应该生成 markdown 格式的注入', () => {
    const ctx = {
      type: 'element' as const,
      elements: [
        {
          selector: '#btn',
          tagName: 'BUTTON',
          id: 'btn',
          className: 'btn primary',
          textContent: 'Submit',
          position: { x: 10, y: 20, width: 80, height: 40 },
          attributes: {},
          computedStyles: { color: 'rgb(255, 255, 255)' },
        },
      ],
      capturedAt: Date.now(),
      source: 'preview' as const,
    };
    const md = injectElementContext(ctx);
    expect(md).toContain('# Selected UI Elements');
    expect(md).toContain('Element 1');
    expect(md).toContain('button');
    expect(md).toContain('Submit');
    expect(md).toContain('80x40');
  });

  it('应该支持多个元素', () => {
    const ctx = {
      type: 'element' as const,
      elements: [
        {
          selector: '#a',
          tagName: 'DIV',
          position: { x: 0, y: 0, width: 100, height: 50 },
          attributes: {},
          computedStyles: {},
        },
        {
          selector: '#b',
          tagName: 'SPAN',
          position: { x: 0, y: 0, width: 50, height: 20 },
          attributes: {},
          computedStyles: {},
        },
      ],
      capturedAt: Date.now(),
      source: 'preview' as const,
    };
    const md = injectElementContext(ctx);
    expect(md).toContain('Element 1');
    expect(md).toContain('Element 2');
  });

  it('应该支持截图附加', () => {
    const ctx = {
      type: 'element' as const,
      elements: [],
      screenshot: 'data:image/png;base64,iVBORw0KG...',
      capturedAt: Date.now(),
      source: 'preview' as const,
    };
    const md = injectElementContext(ctx);
    expect(md).toContain('## Screenshot');
    expect(md).toContain('data:image/png;base64');
  });
});
