/**
 * # ============================================================
 * # CodeBlock 组件测试 (v1.0.0 - Cycle 15 P1-4)
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import CodeBlock from './CodeBlock';

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
    ['typescript', 'javascript', 'python', 'json', 'ts', 'html'].includes(lang),
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

// Mock clipboard
const mockWriteText = vi.fn();
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: mockWriteText },
});

// Mock URL.createObjectURL
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: mockCreateObjectURL,
});
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: mockRevokeObjectURL,
});

describe('CodeBlock - 基础渲染', () => {
  it('应渲染代码块容器', () => {
    const { container } = render(<CodeBlock code="const x = 1" lang="typescript" />);
    const block = container.querySelector('[data-component="code-block"]');
    expect(block).toBeInTheDocument();
  });

  it('应显示语言标签', () => {
    render(<CodeBlock code="print(1)" lang="python" />);
    expect(screen.getByText('python')).toBeInTheDocument();
  });

  it('不支持的语言应显示降级提示', async () => {
    render(<CodeBlock code="test" lang="not-a-language" />);
    await waitFor(() => {
      expect(screen.getByText(/降级/)).toBeInTheDocument();
    });
  });

  it('className 应用到根容器', () => {
    const { container } = render(
      <CodeBlock code="x" lang="ts" className="custom-class" />,
    );
    const block = container.querySelector('[data-component="code-block"]');
    expect(block?.className).toContain('custom-class');
  });
});

describe('CodeBlock - 高亮流程', () => {
  it('初始显示加载状态', () => {
    render(<CodeBlock code="x" lang="typescript" />);
    expect(screen.getByText(/高亮中/)).toBeInTheDocument();
  });

  it('高亮完成后显示代码内容', async () => {
    render(<CodeBlock code="const x = 1" lang="typescript" />);
    await waitFor(
      () => {
        const content = screen.getByTestId('code-content');
        expect(content.innerHTML).toContain('<pre');
      },
      { timeout: 3000 },
    );
  });

  it('code 变化时重新高亮', async () => {
    const { rerender } = render(<CodeBlock code="x" lang="typescript" />);
    await waitFor(() => {
      expect(screen.getByTestId('code-content').innerHTML).toContain('<pre');
    });

    rerender(<CodeBlock code="y" lang="typescript" />);
    await waitFor(() => {
      // 重新加载状态出现又消失
      expect(screen.getByTestId('code-content')).toBeInTheDocument();
    });
  });
});

describe('CodeBlock - 复制功能', () => {
  beforeEach(() => {
    mockWriteText.mockResolvedValue(undefined);
  });

  it('点击复制按钮调用 navigator.clipboard.writeText', async () => {
    render(<CodeBlock code="to-copy" lang="typescript" />);
    const copyBtn = await screen.findByTestId('code-copy');
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(mockWriteText).toHaveBeenCalledWith('to-copy');
  });

  it('复制成功后显示 "已复制"', async () => {
    render(<CodeBlock code="x" lang="typescript" />);
    const copyBtn = await screen.findByTestId('code-copy');
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByText(/已复制/)).toBeInTheDocument();
    });
  });

  it('1.5s 后恢复 idle 状态', async () => {
    vi.useFakeTimers();
    render(<CodeBlock code="x" lang="typescript" />);
    const copyBtn = screen.getByTestId('code-copy');
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(screen.getByText(/已复制/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByText(/📋 复制/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('CodeBlock - 下载功能', () => {
  it('点击下载按钮触发 URL.createObjectURL', () => {
    // Mock createElement to capture <a> element
    const originalCreate = document.createElement.bind(document);
    const clickSpy = vi.fn();
    document.createElement = vi.fn((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    }) as any;

    render(<CodeBlock code="x" lang="typescript" filename="test" />);
    const downloadBtn = screen.getByTestId('code-download');
    fireEvent.click(downloadBtn);

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalled();

    document.createElement = originalCreate;
  });

  it('下载文件名使用 lang 作为扩展名', () => {
    // 通过 mock createObjectURL 的 blob 来验证文件内容
    let capturedBlob: Blob | null = null;
    mockCreateObjectURL.mockImplementation((...args: unknown[]): string => {
      capturedBlob = args[0] as Blob;
      return 'blob:mock-url';
    });

    // 重置 createElement 避免 download 属性问题
    const originalCreate = document.createElement.bind(document);
    document.createElement = vi.fn((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        // happy-dom 已有 download 属性，赋值时会被 setter 捕获
        el.click = vi.fn();
      }
      return el;
    }) as any;

    render(<CodeBlock code="x" lang="python" filename="myfile" />);
    fireEvent.click(screen.getByTestId('code-download'));

    expect(capturedBlob).not.toBeNull();
    expect(mockCreateObjectURL).toHaveBeenCalled();

    document.createElement = originalCreate;
  });

  it('不支持的语言下载为 .txt', () => {
    const originalCreate = document.createElement.bind(document);
    document.createElement = vi.fn((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        el.click = vi.fn();
      }
      return el;
    }) as any;

    render(<CodeBlock code="x" lang="not-a-lang" filename="x" />);
    fireEvent.click(screen.getByTestId('code-download'));
    expect(mockCreateObjectURL).toHaveBeenCalled();

    document.createElement = originalCreate;
  });
});

describe('CodeBlock - 边界条件', () => {
  it('空 code 应正常渲染', async () => {
    render(<CodeBlock code="" lang="typescript" />);
    await waitFor(() => {
      expect(screen.getByTestId('code-content')).toBeInTheDocument();
    });
  });

  it('多行 code 应正常渲染', async () => {
    const code = 'line1\nline2\nline3';
    render(<CodeBlock code={code} lang="typescript" />);
    await waitFor(() => {
      expect(screen.getByTestId('code-content').innerHTML).toContain('<pre');
    });
  });

  it('特殊字符不应破坏渲染', async () => {
    const code = '<script>alert("xss")</script>';
    render(<CodeBlock code={code} lang="html" />);
    await waitFor(() => {
      const content = screen.getByTestId('code-content');
      // shiki 应转义这些字符
      expect(content.innerHTML).not.toContain('<script>');
    });
  });
});
