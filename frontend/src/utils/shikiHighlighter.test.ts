/**
 * # ============================================================
 * # Shiki Highlighter 单元测试 (v1.0.0 - Cycle 15 P1-4)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getHighlighter,
  highlightCode,
  highlightCodeSync,
  isLanguageSupported,
  getSupportedLanguages,
  getSupportedThemes,
  disposeHighlighter,
} from './shikiHighlighter';

describe('shikiHighlighter - 基础', () => {
  beforeEach(async () => {
    disposeHighlighter();
  });
  afterEach(() => {
    disposeHighlighter();
  });

  it('isLanguageSupported 返回 boolean', () => {
    expect(typeof isLanguageSupported('typescript')).toBe('boolean');
    expect(isLanguageSupported('typescript')).toBe(true);
    expect(isLanguageSupported('not-a-language')).toBe(false);
  });

  it('getSupportedLanguages 包含 typescript', () => {
    const langs = getSupportedLanguages();
    expect(langs).toContain('typescript');
    expect(langs).toContain('python');
  });

  it('getSupportedThemes 至少包含一个 dark 主题', () => {
    const themes = getSupportedThemes();
    expect(themes.length).toBeGreaterThan(0);
    expect(themes).toContain('github-dark');
  });

  it('disposeHighlighter 不抛错', () => {
    expect(() => disposeHighlighter()).not.toThrow();
  });
});

describe('shikiHighlighter - 高亮功能', () => {
  beforeEach(async () => {
    disposeHighlighter();
  });
  afterEach(() => {
    disposeHighlighter();
  });

  it('getHighlighter 返回 highlighter 实例', async () => {
    const h = await getHighlighter();
    expect(h).toBeTruthy();
    expect(typeof h.codeToHtml).toBe('function');
  });

  it('getHighlighter 多次调用返回同一实例（单例）', async () => {
    const h1 = await getHighlighter();
    const h2 = await getHighlighter();
    expect(h1).toBe(h2);
  });

  it('highlightCode 异步高亮 typescript 代码', async () => {
    const html = await highlightCode('const x: number = 1;', 'typescript');
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
  });

  it('highlightCode 支持 python', async () => {
    const html = await highlightCode('def hello():\n    print("hi")', 'python');
    expect(html).toContain('<pre');
  });

  it('highlightCode 支持 json', async () => {
    const html = await highlightCode('{"key": "value"}', 'json');
    expect(html).toContain('<pre');
  });

  it('不支持的语言降级为纯文本', async () => {
    const html = await highlightCode('hello world', 'not-a-real-language');
    expect(html).toContain('<pre');
    expect(html).toContain('hello world');
  });

  it('highlightCodeSync 在 highlighter 未初始化时返回纯文本', () => {
    const html = highlightCodeSync('test', 'typescript');
    expect(html).toContain('<pre');
    expect(html).toContain('test');
  });

  it('highlightCodeSync 在 highlighter 已初始化时返回高亮 HTML', async () => {
    await getHighlighter();
    const html = highlightCodeSync('const x = 1;', 'typescript');
    expect(html).toContain('<pre');
  });
});
