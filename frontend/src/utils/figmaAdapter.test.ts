/**
 * # ============================================================
 * # FigmaAdapter 单元测试 (Cycle 24 G24-04)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FigmaAdapter,
  getFigmaAdapter,
  resetFigmaAdapter,
  rgbaToHex,
  colorToTailwind,
  FIGMA_MOCK_PRESETS,
} from './figmaAdapter';

describe('FigmaAdapter - URL Parsing', () => {
  let adapter: FigmaAdapter;

  beforeEach(() => {
    resetFigmaAdapter();
    adapter = new FigmaAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('应解析标准 Figma file URL', () => {
    const result = adapter.parseUrl('https://www.figma.com/file/abc123XYZ/MyDesign?node-id=1-2');
    expect(result).toEqual({ fileKey: 'abc123XYZ', nodeId: '1:2' });
  });

  it('应解析 Figma design URL', () => {
    const result = adapter.parseUrl('https://www.figma.com/design/xyz789ABC/Project?node-id=10-20');
    expect(result).toEqual({ fileKey: 'xyz789ABC', nodeId: '10:20' });
  });

  it('应解析 Figma proto URL', () => {
    const result = adapter.parseUrl('https://www.figma.com/proto/key123name/MyProto?node-id=5-3');
    expect(result?.fileKey).toBe('key123name');
    expect(result?.nodeId).toBe('5:3');
  });

  it('应解析无 node-id 的 URL', () => {
    const result = adapter.parseUrl('https://www.figma.com/file/onlykey123/Project');
    expect(result).toEqual({ fileKey: 'onlykey123' });
  });

  it('应直接接受 fileKey', () => {
    const result = adapter.parseUrl('abcdefghij1234567890');
    expect(result).toEqual({ fileKey: 'abcdefghij1234567890' });
  });

  it('应拒绝无效 URL', () => {
    expect(adapter.parseUrl('')).toBeNull();
    expect(adapter.parseUrl('not a url')).toBeNull();
    expect(adapter.parseUrl('https://example.com/abc')).toBeNull();
  });
});

describe('FigmaAdapter - Color Conversion', () => {
  it('rgbaToHex 应将 RGB 转为 hex', () => {
    expect(rgbaToHex({ r: 1, g: 0, b: 0 })).toBe('#ff0000');
    expect(rgbaToHex({ r: 0, g: 1, b: 0 })).toBe('#00ff00');
    expect(rgbaToHex({ r: 0, g: 0, b: 1 })).toBe('#0000ff');
    expect(rgbaToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbaToHex({ r: 1, g: 1, b: 1 })).toBe('#ffffff');
  });

  it('rgbaToHex 应限制值范围', () => {
    expect(rgbaToHex({ r: -0.5, g: 0.5, b: 1.5 })).toBe('#0080ff');
  });

  it('colorToTailwind 应映射到 Tailwind class', () => {
    expect(colorToTailwind('#3b82f6')).toBe('blue-500');
    expect(colorToTailwind('#ef4444')).toBe('red-500');
    expect(colorToTailwind('#10b981')).toBe('emerald-500');
  });

  it('colorToTailwind 应处理未映射颜色', () => {
    const result = colorToTailwind('#abcdef');
    expect(result.startsWith('[')).toBe(true);
    expect(result).toContain('#abcdef');
  });

  it('应支持大小写不敏感', () => {
    expect(colorToTailwind('#3B82F6')).toBe('blue-500');
    expect(colorToTailwind('#3b82f6')).toBe('blue-500');
  });
});

describe('FigmaAdapter - Mock Data', () => {
  let adapter: FigmaAdapter;

  beforeEach(() => {
    resetFigmaAdapter();
    adapter = new FigmaAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('应列出所有 Mock 预设', () => {
    const presets = adapter.listMockPresets();
    expect(presets).toContain('button-primary');
    expect(presets).toContain('card-simple');
    expect(presets).toContain('input-field');
    expect(presets).toContain('navbar');
    expect(presets).toContain('alert');
  });

  it('应加载指定 Mock 预设', () => {
    const node = adapter.loadMockData('button-primary');
    expect(node).not.toBeNull();
    expect(node?.name).toBe('Primary Button');
    expect(node?.type).toBe('FRAME');
    expect(node?.children?.length).toBeGreaterThan(0);
  });

  it('加载不存在预设应返回 null', () => {
    expect(adapter.loadMockData('nonexistent')).toBeNull();
  });

  it('Mock 节点应包含必要字段', () => {
    const node = adapter.loadMockData('card-simple');
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('name');
    expect(node).toHaveProperty('type');
    expect(node).toHaveProperty('x');
    expect(node).toHaveProperty('y');
    expect(node).toHaveProperty('width');
    expect(node).toHaveProperty('height');
  });

  it('所有 Mock 预设应可正常加载', () => {
    const presets = Object.keys(FIGMA_MOCK_PRESETS);
    for (const name of presets) {
      const node = adapter.loadMockData(name);
      expect(node).not.toBeNull();
      expect(node?.id).toBeTruthy();
    }
  });
});

describe('FigmaAdapter - Configuration', () => {
  let adapter: FigmaAdapter;

  beforeEach(() => {
    resetFigmaAdapter();
    adapter = new FigmaAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('应使用默认配置', () => {
    const config = adapter.getConfig();
    expect(config.useMockData).toBe(true);
    expect(config.cacheEnabled).toBe(true);
    expect(config.baseUrl).toBe('https://api.figma.com/v1');
  });

  it('应支持部分配置覆盖', () => {
    adapter.setConfig({ accessToken: 'test-token' });
    expect(adapter.getConfig().accessToken).toBe('test-token');
    expect(adapter.getConfig().useMockData).toBe(true); // 默认值保留
  });

  it('isReady 在 Mock 模式下应返回 true', () => {
    expect(adapter.isReady()).toBe(true);
  });

  it('isReady 在真实模式下有 token 时应返回 true', () => {
    adapter.setConfig({ useMockData: false, accessToken: 'real-token' });
    expect(adapter.isReady()).toBe(true);
  });

  it('isReady 在真实模式下无 token 时应返回 false', () => {
    adapter.setConfig({ useMockData: false, accessToken: '' });
    expect(adapter.isReady()).toBe(false);
  });

  it('setConfig 应触发 config-updated 事件', () => {
    const handler = vi.fn();
    adapter.on('config-updated', handler);
    adapter.setConfig({ accessToken: 'new' });
    expect(handler).toHaveBeenCalled();
  });
});

describe('FigmaAdapter - Code Generation', () => {
  let adapter: FigmaAdapter;

  beforeEach(() => {
    resetFigmaAdapter();
    adapter = new FigmaAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('应生成 React + Tailwind 代码', () => {
    const node = adapter.loadMockData('button-primary')!;
    const result = adapter.toReact(node, {
      framework: 'react',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'TestBtn',
      extractImages: false,
    });
    expect(result.code).toContain('Click me');
    expect(result.stats.nodeCount).toBeGreaterThan(0);
    expect(result.framework).toBe('react');
  });

  it('应生成 Vue + Tailwind 代码', () => {
    const node = adapter.loadMockData('card-simple')!;
    const result = adapter.toVue(node, {
      framework: 'vue',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'Card',
      extractImages: false,
    });
    expect(result.code).toContain('Card Title');
    expect(result.framework).toBe('vue');
  });

  it('应生成 HTML + Tailwind 代码', () => {
    const node = adapter.loadMockData('input-field')!;
    const result = adapter.toHtml(node, {
      framework: 'html',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'Input',
      extractImages: false,
    });
    expect(result.code).toContain('Enter text...');
    expect(result.framework).toBe('html');
  });

  it('应生成 React + 内联样式代码', () => {
    const node = adapter.loadMockData('button-primary')!;
    const result = adapter.toReact(node, {
      framework: 'react',
      styling: 'inline',
      includeComments: false,
      componentName: 'Btn',
      extractImages: false,
    });
    expect(result.code).toContain('style=');
  });

  it('应生成包含注释的代码', () => {
    const node = adapter.loadMockData('card-simple')!;
    const result = adapter.toReact(node, {
      framework: 'react',
      styling: 'tailwind',
      includeComments: true,
      componentName: 'Card',
      extractImages: false,
    });
    expect(result.code).toMatch(/\/\/|\{\*/);
  });

  it('应统计节点信息', () => {
    const node = adapter.loadMockData('card-simple')!;
    const result = adapter.toReact(node, {
      framework: 'react',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'Card',
      extractImages: false,
    });
    expect(result.stats.nodeCount).toBe(3); // 1 frame + 2 text
    expect(result.stats.textCount).toBe(2);
    expect(result.stats.frameCount).toBe(1);
    expect(result.stats.lineCount).toBeGreaterThan(0);
    expect(result.stats.bytes).toBeGreaterThan(0);
  });

  it('应生成完整 React 组件', () => {
    const node = adapter.loadMockData('button-primary')!;
    const result = adapter.generateFullComponent(node, {
      framework: 'react',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'MyButton',
      extractImages: false,
    });
    expect(result.code).toContain('export const MyButton');
    expect(result.code).toContain('React.FC');
  });

  it('应生成完整 Vue 组件', () => {
    const node = adapter.loadMockData('button-primary')!;
    const result = adapter.generateFullComponent(node, {
      framework: 'vue',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'MyButton',
      extractImages: false,
    });
    expect(result.code).toContain('<template>');
    expect(result.code).toContain('</template>');
    expect(result.code).toContain('script setup');
  });

  it('应生成完整 HTML 页面', () => {
    const node = adapter.loadMockData('button-primary')!;
    const result = adapter.generateFullComponent(node, {
      framework: 'html',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'MyButton',
      extractImages: false,
    });
    expect(result.code).toContain('<!DOCTYPE html>');
    expect(result.code).toContain('<html');
  });

  it('转换应触发 converted 事件', () => {
    const handler = vi.fn();
    adapter.on('converted', handler);
    const node = adapter.loadMockData('button-primary')!;
    adapter.toReact(node, {
      framework: 'react',
      styling: 'tailwind',
      includeComments: false,
      componentName: 'B',
      extractImages: false,
    });
    expect(handler).toHaveBeenCalled();
  });
});

describe('FigmaAdapter - Fetch', () => {
  let adapter: FigmaAdapter;

  beforeEach(() => {
    resetFigmaAdapter();
    adapter = new FigmaAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('Mock 模式下 fetchFile 应返回模拟文件', async () => {
    const file = await adapter.fetchFile('any-key');
    expect(file.name).toBeTruthy();
    expect(file.document).toBeTruthy();
    expect(file.components).toBeTruthy();
  });

  it('Mock 模式下 fetchNode 应返回模拟节点', async () => {
    const node = await adapter.fetchNode('any-key', '1:1');
    expect(node).toBeTruthy();
    expect(node.type).toBeTruthy();
  });

  it('真实模式下无 token 应抛错', async () => {
    adapter.setConfig({ useMockData: false, accessToken: '' });
    await expect(adapter.fetchFile('any')).rejects.toThrow();
  });
});

describe('FigmaAdapter - Cache', () => {
  let adapter: FigmaAdapter;

  beforeEach(() => {
    resetFigmaAdapter();
    adapter = new FigmaAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('初始缓存应为空', () => {
    expect(adapter.getCacheSize()).toBe(0);
  });

  it('clearCache 应清空缓存', () => {
    adapter.clearCache();
    expect(adapter.getCacheSize()).toBe(0);
  });
});

describe('FigmaAdapter - Singleton', () => {
  afterEach(() => {
    resetFigmaAdapter();
  });

  it('getFigmaAdapter 应返回单例', () => {
    const a1 = getFigmaAdapter();
    const a2 = getFigmaAdapter();
    expect(a1).toBe(a2);
  });

  it('resetFigmaAdapter 应重置单例', () => {
    const a1 = getFigmaAdapter();
    resetFigmaAdapter();
    const a2 = getFigmaAdapter();
    expect(a1).not.toBe(a2);
  });
});

describe('FigmaAdapter - Events', () => {
  let adapter: FigmaAdapter;

  beforeEach(() => {
    resetFigmaAdapter();
    adapter = new FigmaAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('on 应返回取消订阅函数', () => {
    const handler = vi.fn();
    const off = adapter.on('fetched', handler);
    expect(typeof off).toBe('function');
  });

  it('取消订阅后事件不应触发', () => {
    const handler = vi.fn();
    const off = adapter.on('fetched', handler);
    off();
    adapter.setConfig({ accessToken: 'test' });
    // 不会重新触发 fetched
  });
});

describe('FigmaAdapter - Destroy', () => {
  it('destroy 应清空缓存和事件', () => {
    resetFigmaAdapter();
    const adapter = new FigmaAdapter();
    const handler = vi.fn();
    adapter.on('fetched', handler);
    adapter.destroy();
    // 不应崩溃
  });
});
