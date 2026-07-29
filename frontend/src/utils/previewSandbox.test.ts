/**
 * # ============================================================
 * PreviewSandbox 单元测试 (v6.37.0 Cycle 17 P0-3)
 * # ============================================================
 * 测试覆盖：25 个测试
 *   - 工具函数 (8)
 *   - SandboxManager 基础 (6)
 *   - 更新与防抖 (4)
 *   - 订阅 (3)
 *   - 错误处理 (2)
 *   - 快照工具 (2)
 * ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSandboxManager,
  buildHtmlPreview,
  buildReactPreview,
  buildIframePreview,
  buildSandboxAttr,
  detectFileType,
  validateHtml,
  debounce,
  createSnapshot,
  diffSnapshots,
} from './previewSandbox';

describe('工具函数 - 文件类型检测', () => {
  it('detectFileType - html', () => {
    expect(detectFileType('index.html')).toBe('html');
    expect(detectFileType('main.htm')).toBe('html');
  });

  it('detectFileType - react', () => {
    expect(detectFileType('App.tsx')).toBe('react');
    expect(detectFileType('Component.jsx')).toBe('react');
  });

  it('detectFileType - js/css/json/other', () => {
    expect(detectFileType('utils.ts')).toBe('js');
    expect(detectFileType('styles.css')).toBe('css');
    expect(detectFileType('package.json')).toBe('json');
    expect(detectFileType('README.md')).toBe('other');
  });
});

describe('工具函数 - HTML 构建', () => {
  it('buildHtmlPreview 包装 HTML 内容', () => {
    const html = '<h1>Hello</h1>';
    const config = { mode: 'html' as const, allowScripts: true, allowSameOrigin: true, debounceMs: 500 };
    const result = buildHtmlPreview(html, config);
    expect(result).toContain('<h1>Hello</h1>');
    expect(result).toContain('<!DOCTYPE html>');
  });

  it('buildReactPreview 包含 React CDN', () => {
    const code = 'function App() { return <div>Hi</div>; }';
    const config = { mode: 'react' as const, allowScripts: true, allowSameOrigin: true, debounceMs: 500 };
    const result = buildReactPreview(code, config);
    expect(result).toContain('react@18');
    expect(result).toContain('@babel/standalone');
    expect(result).toContain(code);
  });

  it('buildIframePreview 优先 index.html', () => {
    const files = {
      'index.html': '<div>A</div>',
      'other.html': '<div>B</div>',
    };
    const config = { mode: 'iframe' as const, allowScripts: true, allowSameOrigin: true, debounceMs: 500 };
    const result = buildIframePreview(files, config);
    expect(result).toContain('<div>A</div>');
  });
});

describe('工具函数 - Sandbox 属性', () => {
  it('buildSandboxAttr 包含 allow-scripts 和 allow-same-origin', () => {
    const config = { mode: 'html' as const, allowScripts: true, allowSameOrigin: true, debounceMs: 500 };
    expect(buildSandboxAttr(config)).toContain('allow-scripts');
    expect(buildSandboxAttr(config)).toContain('allow-same-origin');
  });

  it('buildSandboxAttr 不允许脚本时省略', () => {
    const config = { mode: 'html' as const, allowScripts: false, allowSameOrigin: true, debounceMs: 500 };
    expect(buildSandboxAttr(config)).not.toContain('allow-scripts');
  });
});

describe('工具函数 - validateHtml', () => {
  it('空内容视为无效', () => {
    const result = validateHtml('');
    expect(result.valid).toBe(false);
    expect(result.error?.message).toContain('空');
  });

  it('有效 HTML', () => {
    expect(validateHtml('<div>x</div>').valid).toBe(true);
  });
});

describe('工具函数 - debounce', () => {
  it('在 delay 后才执行', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('test');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('test');
    vi.useRealTimers();
  });

  it('cancel 取消未执行的调用', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('test');
    debounced.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('SandboxManager - 基础', () => {
  let sandbox: ReturnType<typeof createSandboxManager>;

  beforeEach(() => {
    sandbox = createSandboxManager();
  });

  it('创建时 lastSnapshot 为 null', () => {
    expect(sandbox.getSnapshot()).toBeNull();
  });

  it('获取默认配置', () => {
    const config = sandbox.getConfig();
    expect(config.mode).toBe('html');
    expect(config.debounceMs).toBe(500);
  });

  it('setConfig 更新配置', () => {
    sandbox.setConfig({ mode: 'react', debounceMs: 200 });
    const config = sandbox.getConfig();
    expect(config.mode).toBe('react');
    expect(config.debounceMs).toBe(200);
  });

  it('destroy 清理资源', () => {
    expect(() => sandbox.destroy()).not.toThrow();
  });

  it('reset 重置快照', () => {
    sandbox.reset();
    const snap = sandbox.getSnapshot();
    expect(snap?.status).toBe('idle');
  });

  it('iframe 未绑定时 update 抛错或返回 error', () => {
    sandbox.updateNow({ 'index.html': '<div>x</div>' });
    const snap = sandbox.getSnapshot();
    expect(snap?.status).toBe('error');
  });
});

describe('SandboxManager - 更新与防抖', () => {
  let sandbox: ReturnType<typeof createSandboxManager>;
  let mockIframe: HTMLIFrameElement;

  beforeEach(() => {
    sandbox = createSandboxManager({ debounceMs: 50 });
    mockIframe = document.createElement('iframe');
    sandbox.attach(mockIframe);
  });

  it('updateNow 立即更新', () => {
    sandbox.updateNow({ 'index.html': '<div>x</div>' });
    expect(mockIframe.srcdoc).toContain('<div>x</div>');
  });

  it('update 触发防抖', () => {
    sandbox.update({ 'index.html': '<div>a</div>' });
    sandbox.update({ 'index.html': '<div>b</div>' });
    // 还没到防抖时间
    expect(mockIframe.srcdoc).toBe('');
  });

  it('防抖后更新使用最新值', async () => {
    sandbox.update({ 'index.html': '<div>a</div>' });
    sandbox.update({ 'index.html': '<div>b</div>' });
    await new Promise((r) => setTimeout(r, 100));
    expect(mockIframe.srcdoc).toContain('<div>b</div>');
  });

  it('更新时生成快照', () => {
    sandbox.updateNow({ 'index.html': '<div>x</div>' });
    const snap = sandbox.getSnapshot();
    expect(snap?.status).toBe('ready');
    expect(snap?.files['index.html']).toBe('<div>x</div>');
  });
});

describe('SandboxManager - 订阅', () => {
  let sandbox: ReturnType<typeof createSandboxManager>;

  beforeEach(() => {
    sandbox = createSandboxManager({ debounceMs: 10 });
  });

  it('subscribe 接收快照', () => {
    const cb = vi.fn();
    sandbox.subscribe(cb);
    const mockIframe = document.createElement('iframe');
    sandbox.attach(mockIframe);
    sandbox.updateNow({ 'index.html': '<div>x</div>' });
    expect(cb).toHaveBeenCalled();
  });

  it('unsubscribe 不再接收', () => {
    const cb = vi.fn();
    const unsub = sandbox.subscribe(cb);
    unsub();
    sandbox.updateNow({ 'index.html': '<div>x</div>' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('多次更新触发多次通知', () => {
    const cb = vi.fn();
    sandbox.subscribe(cb);
    const mockIframe = document.createElement('iframe');
    sandbox.attach(mockIframe);
    sandbox.updateNow({ 'index.html': '<div>a</div>' });
    sandbox.updateNow({ 'index.html': '<div>b</div>' });
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('辅助函数', () => {
  it('createSnapshot 生成快照', () => {
    const snap = createSnapshot({ 'index.html': '<div>x</div>' }, '<div>x</div>');
    expect(snap.id).toBeDefined();
    expect(snap.status).toBe('ready');
  });

  it('diffSnapshots 比较差异', () => {
    const a = createSnapshot({ 'a.ts': '1', 'b.ts': '2' }, '');
    const b = createSnapshot({ 'a.ts': '1', 'b.ts': '3', 'c.ts': 'new' }, '');
    const diff = diffSnapshots(a, b);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual(['c.ts']);
    expect(diff.changed).toEqual(['b.ts']);
  });
});
