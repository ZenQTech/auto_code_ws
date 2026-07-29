/**
 * # ============================================================
 * # Shiki Code Highlighter (v1.0.0 - Cycle 15 P1-4)
 * # ============================================================
 * # 核心作用：基于 shiki 的代码高亮器
 * #           用于在聊天消息中渲染 Markdown 代码块
 * # 运行流程：
 * #   1. 单例模式：getHighlighter() 返回全局共享的 highlighter
 * #   2. 懒加载：首次调用时才创建 highlighter 实例
 * #   3. 支持主题：hermes-dark / hermes-light / github-dark / github-light
 * #   4. 支持语言：常见编程语言（typescript, javascript, python, json, bash...）
 * # 输入参数：
 * #   - code: string，要高亮的代码
 * #   - lang: string，语言标识
 * #   - theme?: string，主题（默认 'hermes-dark'）
 * # 输出结果：HTML 字符串（带 <pre><code> 标签）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-4 初始版本
 * #     - 集成 shiki ^4.3.1
 * #     - 单例 highlighter
 * #     - 主题/语言预设
 * # ============================================================
 */

import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type BundledTheme,
} from 'shiki';

/** 支持的语言（按需加载） */
const SUPPORTED_LANGS: BundledLanguage[] = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'json',
  'bash',
  'shell',
  'html',
  'css',
  'markdown',
  'yaml',
  'rust',
  'go',
  'java',
  'cpp',
  'c',
  'sql',
  'diff',
  'dockerfile',
];

/** 支持的主题 */
const SUPPORTED_THEMES: BundledTheme[] = [
  'github-dark',
  'github-light',
  'one-dark-pro',
  'one-light',
  'vitesse-dark',
  'vitesse-light',
];

/** Hermes 自定义主题：基于 github-dark 调色 */
const HERMES_DARK_THEME: BundledTheme = 'github-dark';
const HERMES_LIGHT_THEME: BundledTheme = 'github-light';

/**
 * 单例 highlighter
 * 避免每个组件都创建实例，提升性能
 */
let _highlighter: Highlighter | null = null;
let _highlighterPromise: Promise<Highlighter> | null = null;

/**
 * 获取 highlighter（懒加载）
 * 首次调用会异步创建实例；后续调用直接返回缓存
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (_highlighter) return _highlighter;
  if (_highlighterPromise) return _highlighterPromise;

  _highlighterPromise = createHighlighter({
    themes: SUPPORTED_THEMES,
    langs: SUPPORTED_LANGS,
  }).then((h) => {
    _highlighter = h;
    return h;
  });
  return _highlighterPromise;
}

/**
 * 同步高亮代码（需先调用 ensureHighlighter）
 * @param code 源代码
 * @param lang 语言（不支持则降级为 plaintext）
 * @param theme 主题（默认 hermes-dark）
 * @returns HTML 字符串
 */
export function highlightCodeSync(
  code: string,
  lang: string,
  theme: BundledTheme = HERMES_DARK_THEME,
): string {
  if (!_highlighter) {
    // 还未初始化高亮器，返回纯文本
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
  const safeLang = SUPPORTED_LANGS.includes(lang as BundledLanguage)
    ? (lang as BundledLanguage)
    : 'txt';
  try {
    return _highlighter.codeToHtml(code, {
      lang: safeLang,
      theme,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[shiki] highlight failed:', err);
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

/**
 * 异步高亮代码（自动确保 highlighter 已初始化）
 */
export async function highlightCode(
  code: string,
  lang: string,
  theme: BundledTheme = HERMES_DARK_THEME,
): Promise<string> {
  await getHighlighter();
  return highlightCodeSync(code, lang, theme);
}

/**
 * 预热 highlighter（在应用启动时调用）
 */
export async function warmupHighlighter(): Promise<void> {
  await getHighlighter();
}

/**
 * 销毁 highlighter（用于测试或重置）
 */
export function disposeHighlighter(): void {
  if (_highlighter) {
    _highlighter.dispose();
    _highlighter = null;
  }
  _highlighterPromise = null;
}

/**
 * HTML 转义
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 检查语言是否支持
 */
export function isLanguageSupported(lang: string): boolean {
  return SUPPORTED_LANGS.includes(lang as BundledLanguage);
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): readonly string[] {
  return SUPPORTED_LANGS;
}

/**
 * 获取支持的主题列表
 */
export function getSupportedThemes(): readonly string[] {
  return SUPPORTED_THEMES;
}

export { HERMES_DARK_THEME, HERMES_LIGHT_THEME };
