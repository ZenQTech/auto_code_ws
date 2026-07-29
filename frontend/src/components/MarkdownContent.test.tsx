/**
 * # ============================================================
 * # MarkdownContent 组件测试 (v1.0.0 - Cycle 15 P1-4)
 * # ============================================================
 * # 覆盖：
 * #   - 基础渲染：纯文本 / 标题 / 列表 / 表格 / 分隔线
 * #   - 代码块：渲染 CodeBlock 组件
 * #   - 内联：粗体 / 斜体 / 行内代码
 * #   - XSS：用户内容转义
 * #   - 流式批渲染：限速生效
 * #   - 边界：空内容 / 多行
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownContent from './MarkdownContent';

// Mock shikiHighlighter 以避免异步加载延迟
vi.mock('../utils/shikiHighlighter', () => ({
  highlightCode: vi.fn(async (code: string) =>
    `<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`,
  ),
  highlightCodeSync: vi.fn((code: string) =>
    `<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`,
  ),
  getHighlighter: vi.fn(async () => ({})),
  isLanguageSupported: vi.fn((lang: string) =>
    ['typescript', 'javascript', 'python', 'json'].includes(lang),
  ),
  getSupportedLanguages: vi.fn(() => [
    'typescript',
    'javascript',
    'python',
    'json',
  ]),
  getSupportedThemes: vi.fn(() => ['github-dark']),
  warmupHighlighter: vi.fn(async () => {}),
  disposeHighlighter: vi.fn(),
  HERMES_DARK_THEME: 'github-dark',
  HERMES_LIGHT_THEME: 'github-light',
}));

describe('MarkdownContent - 基础渲染', () => {
  it('应渲染根容器', () => {
    const { container } = render(<MarkdownContent content="hello" />);
    expect(
      container.querySelector('[data-component="markdown-content"]'),
    ).toBeInTheDocument();
  });

  it('应显示纯文本', () => {
    render(<MarkdownContent content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('空内容不渲染块', () => {
    const { container } = render(<MarkdownContent content="" />);
    const root = container.querySelector('[data-component="markdown-content"]');
    expect(root?.getAttribute('data-block-count')).toBe('0');
  });
});

describe('MarkdownContent - 标题', () => {
  it('应渲染 h1', () => {
    render(<MarkdownContent content="# 一级标题" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('一级标题');
  });

  it('应渲染 h2', () => {
    render(<MarkdownContent content="## 二级标题" />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent('二级标题');
  });

  it('应渲染 h3', () => {
    render(<MarkdownContent content="### 三级标题" />);
    const h3 = screen.getByRole('heading', { level: 3 });
    expect(h3).toHaveTextContent('三级标题');
  });
});

describe('MarkdownContent - 列表', () => {
  it('应渲染无序列表', () => {
    const { container } = render(
      <MarkdownContent content={'- item1\n- item2\n- item3'} />,
    );
    const ul = container.querySelector('ul');
    expect(ul).toBeInTheDocument();
    expect(ul?.querySelectorAll('li').length).toBe(3);
  });

  it('应渲染有序列表', () => {
    const { container } = render(
      <MarkdownContent content={'1. first\n2. second\n3. third'} />,
    );
    const ol = container.querySelector('ol');
    expect(ol).toBeInTheDocument();
    expect(ol?.querySelectorAll('li').length).toBe(3);
  });
});

describe('MarkdownContent - 代码块', () => {
  it('应将 ```lang 块渲染为 CodeBlock 组件', () => {
    const content = '```typescript\nconst x = 1;\n```';
    const { container } = render(<MarkdownContent content={content} />);
    expect(
      container.querySelector('[data-component="code-block"]'),
    ).toBeInTheDocument();
  });

  it('应保留 lang 标识', () => {
    const content = '```python\nprint(1)\n```';
    const { container } = render(<MarkdownContent content={content} />);
    const block = container.querySelector('[data-component="code-block"]');
    expect(block?.getAttribute('data-lang')).toBe('python');
  });

  it('无语言标识时使用 txt', () => {
    const content = '```\nplain text\n```';
    const { container } = render(<MarkdownContent content={content} />);
    const block = container.querySelector('[data-component="code-block"]');
    expect(block?.getAttribute('data-lang')).toBe('txt');
  });

  it('未闭合的代码块也应正常渲染', () => {
    const content = '```typescript\nconst x = 1;';
    const { container } = render(<MarkdownContent content={content} />);
    expect(
      container.querySelector('[data-component="code-block"]'),
    ).toBeInTheDocument();
  });

  it('代码块在 text 之前', () => {
    const content = 'before\n\n```ts\nx=1\n```\n\nafter';
    const { container } = render(<MarkdownContent content={content} />);
    const root = container.querySelector('[data-component="markdown-content"]');
    const blocks = root?.children;
    expect(blocks?.[0]?.tagName.toLowerCase()).toBe('p');
    expect(blocks?.[1]?.getAttribute('data-component')).toBe('code-block');
  });
});

describe('MarkdownContent - 内联', () => {
  it('应渲染粗体', () => {
    render(<MarkdownContent content="**bold**" />);
    const strong = screen.getByText('bold');
    expect(strong.tagName.toLowerCase()).toBe('strong');
  });

  it('应渲染斜体', () => {
    render(<MarkdownContent content="*italic*" />);
    const em = screen.getByText('italic');
    expect(em.tagName.toLowerCase()).toBe('em');
  });

  it('应渲染行内代码', () => {
    const { container } = render(
      <MarkdownContent content="use `const` for constants" />,
    );
    const code = container.querySelector('code');
    expect(code).toBeInTheDocument();
    expect(code?.textContent).toBe('const');
  });
});

describe('MarkdownContent - 表格', () => {
  it('应渲染 markdown 表格', () => {
    const content = '| col1 | col2 |\n|------|------|\n| a    | b    |\n| c    | d    |';
    const { container } = render(<MarkdownContent content={content} />);
    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(table?.querySelectorAll('thead th').length).toBe(2);
    expect(table?.querySelectorAll('tbody tr').length).toBe(2);
  });
});

describe('MarkdownContent - 分隔线', () => {
  it('应渲染 hr', () => {
    const { container } = render(
      <MarkdownContent content={'段落\n\n---\n\n段落2'} />,
    );
    expect(container.querySelector('hr[data-block="hr"]')).toBeInTheDocument();
  });
});

describe('MarkdownContent - XSS 防护', () => {
  it('用户文本应被转义（不执行 <script>）', () => {
    const { container } = render(
      <MarkdownContent content="<script>alert('xss')</script>" />,
    );
    // 渲染后不应包含原始 <script> 标签（应被转义为 &lt;script&gt;）
    const scriptEls = container.querySelectorAll('script');
    expect(scriptEls.length).toBe(0);
    // innerHTML 中是双重转义：& → &amp;，< → &lt;
    expect(container.innerHTML).toContain('&amp;lt;script&amp;gt;');
  });
});

describe('MarkdownContent - 主题', () => {
  it('默认 theme=dark', () => {
    const { container } = render(<MarkdownContent content="hi" />);
    expect(
      container
        .querySelector('[data-component="markdown-content"]')
        ?.getAttribute('data-theme'),
    ).toBe('dark');
  });

  it('theme=light 透传', () => {
    const { container } = render(
      <MarkdownContent content="hi" theme="light" />,
    );
    expect(
      container
        .querySelector('[data-component="markdown-content"]')
        ?.getAttribute('data-theme'),
    ).toBe('light');
  });
});

describe('MarkdownContent - 流式批渲染', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('streamingBatchSize=0 时一次性渲染', () => {
    const { container } = render(
      <MarkdownContent
        content={'# Title\n\nparagraph\n\n- item1'}
        streamingBatchSize={0}
      />,
    );
    const root = container.querySelector('[data-component="markdown-content"]');
    expect(Number(root?.getAttribute('data-block-count'))).toBeGreaterThan(0);
  });

  it('streamingBatchSize>0 时小内容立即渲染', () => {
    const { container } = render(
      <MarkdownContent
        content={'小内容'}
        streamingBatchSize={500}
        streamingBatchIntervalMs={100}
      />,
    );
    const root = container.querySelector('[data-component="markdown-content"]');
    expect(root?.getAttribute('data-block-count')).not.toBe('0');
  });

  it('disableStreaming=true 时一次性渲染', () => {
    const { container } = render(
      <MarkdownContent
        content={'# big\n\nbig content'}
        streamingBatchSize={1}
        disableStreaming
      />,
    );
    const root = container.querySelector('[data-component="markdown-content"]');
    expect(Number(root?.getAttribute('data-block-count'))).toBeGreaterThan(0);
  });
});

describe('MarkdownContent - 边界条件', () => {
  it('多行段落保留换行', () => {
    const { container } = render(
      <MarkdownContent content={'line1\nline2\nline3'} />,
    );
    const p = container.querySelector('p');
    expect(p).toBeInTheDocument();
    expect(p?.querySelectorAll('br').length).toBe(2);
  });

  it('多个连续块（标题 + 代码 + 列表）混合渲染', () => {
    const content = `# Title

Intro paragraph.

\`\`\`typescript
const x = 1;
\`\`\`

- item1
- item2
`;
    const { container } = render(<MarkdownContent content={content} />);
    const root = container.querySelector('[data-component="markdown-content"]');
    expect(root?.querySelector('h1')).toBeInTheDocument();
    expect(root?.querySelector('[data-component="code-block"]')).toBeInTheDocument();
    expect(root?.querySelector('ul')).toBeInTheDocument();
  });
});
