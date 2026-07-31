/**
 * # ============================================================
 * # MCP Resource Viewer/Panel 测试 (v1.0.0 Cycle 40 G40-02)
 * # ============================================================
 * # 覆盖：内容分类、文本/JSON/图片预览、过滤、搜索
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-02 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { McpResourceViewer, classifyContent, formatBytes, base64ByteSize, decodeBase64, tryFormatJson } from './McpResourceViewer';
import { McpResourcePanel, type McpResourceClient } from './McpResourcePanel';
import type { Resource, ResourceContent } from '../utils/mcpTypes';

// 显式清理 DOM（happy-dom 全局 cleanup 不可靠）
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ============ 单元测试：内容分类 ============

describe('classifyContent', () => {
  it('image/png', () => {
    const info = classifyContent('image/png');
    expect(info.kind).toBe('image');
    expect(info.previewable).toBe(true);
    expect(info.extension).toBe('png');
  });

  it('image/jpeg', () => {
    const info = classifyContent('image/jpeg');
    expect(info.kind).toBe('image');
    expect(info.extension).toBe('jpg');
  });

  it('image/svg+xml', () => {
    const info = classifyContent('image/svg+xml');
    expect(info.kind).toBe('image');
    expect(info.previewable).toBe(true);
  });

  it('image/bmp 不可内联预览', () => {
    const info = classifyContent('image/bmp');
    expect(info.kind).toBe('image');
    expect(info.previewable).toBe(false);
  });

  it('application/json', () => {
    const info = classifyContent('application/json');
    expect(info.kind).toBe('json');
    expect(info.previewable).toBe(true);
  });

  it('text/markdown', () => {
    const info = classifyContent('text/markdown');
    expect(info.kind).toBe('markdown');
  });

  it('text/html', () => {
    const info = classifyContent('text/html');
    expect(info.kind).toBe('code');
  });

  it('text/plain', () => {
    const info = classifyContent('text/plain');
    expect(info.kind).toBe('text');
  });

  it('application/pdf', () => {
    const info = classifyContent('application/pdf');
    expect(info.kind).toBe('pdf');
    expect(info.extension).toBe('pdf');
  });

  it('audio/mpeg', () => {
    const info = classifyContent('audio/mpeg');
    expect(info.kind).toBe('audio');
    expect(info.extension).toBe('mp3');
  });

  it('video/mp4', () => {
    const info = classifyContent('video/mp4');
    expect(info.kind).toBe('video');
  });

  it('application/octet-stream -> binary', () => {
    const info = classifyContent('application/octet-stream');
    expect(info.kind).toBe('binary');
  });

  it('undefined mime', () => {
    const info = classifyContent(undefined);
    expect(info.kind).toBe('unknown');
  });

  it('空字符串 mime', () => {
    const info = classifyContent('');
    expect(info.kind).toBe('unknown');
  });

  it('大小写不敏感', () => {
    const info = classifyContent('IMAGE/PNG');
    expect(info.kind).toBe('image');
  });
});

// ============ 单元测试：工具函数 ============

describe('formatBytes', () => {
  it('B', () => expect(formatBytes(100)).toBe('100 B'));
  it('KB', () => expect(formatBytes(2048)).toBe('2.0 KB'));
  it('MB', () => expect(formatBytes(1024 * 1024 * 2)).toBe('2.00 MB'));
  it('GB', () => expect(formatBytes(1024 * 1024 * 1024 * 3)).toBe('3.00 GB'));
});

describe('base64ByteSize', () => {
  it('空字符串', () => expect(base64ByteSize('')).toBe(0));
  it('标准 base64', () => {
    // "AAA" = 2 bytes
    expect(base64ByteSize('AAA')).toBe(2);
  });
  it('带换行和空格', () => {
    expect(base64ByteSize('AAA\nBBB')).toBe(4);
  });
});

describe('decodeBase64', () => {
  it('解码 "A" -> [0]', () => {
    const bytes = decodeBase64('AA==');
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(0);
  });

  it('解码 "Hello" -> 5 bytes', () => {
    // "Hello" base64 = "SGVsbG8="
    const bytes = decodeBase64('SGVsbG8=');
    expect(bytes.length).toBe(5);
    expect(String.fromCharCode(...bytes)).toBe('Hello');
  });
});

describe('tryFormatJson', () => {
  it('有效 JSON', () => {
    const r = tryFormatJson('{"a":1}');
    expect(r.ok).toBe(true);
    expect(r.formatted).toContain('"a": 1');
  });

  it('无效 JSON', () => {
    const r = tryFormatJson('not json');
    expect(r.ok).toBe(false);
    expect(r.formatted).toBe('not json');
  });

  it('数组 JSON', () => {
    const r = tryFormatJson('[1,2,3]');
    expect(r.ok).toBe(true);
  });
});

// ============ 组件测试：McpResourceViewer ============

describe('McpResourceViewer', () => {
  it('加载状态', () => {
    const { container } = render(
      <McpResourceViewer
        resource={{ uri: 'file:///a.txt', name: 'A' }}
        loading={true}
      />,
    );
    expect(container.querySelector('[data-testid="mcp-resource-viewer-loading"]')).toBeTruthy();
  });

  it('错误状态', () => {
    const { container } = render(
      <McpResourceViewer
        resource={{ uri: 'file:///a.txt', name: 'A' }}
        error="加载失败"
      />,
    );
    expect(container.querySelector('[data-testid="mcp-resource-viewer-error"]')).toBeTruthy();
  });

  it('空内容', () => {
    const { container } = render(
      <McpResourceViewer resource={{ uri: 'file:///a.txt', name: 'A' }} content={null} />,
    );
    expect(container.querySelector('[data-testid="mcp-resource-viewer-empty"]')).toBeTruthy();
  });

  it('文本预览', () => {
    const resource: Resource = { uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' };
    const content: ResourceContent = { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'Hello world' };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-text-preview"]')).toBeTruthy();
    expect(container.querySelector('[data-mime="text/plain"]')).toBeTruthy();
  });

  it('JSON 预览', () => {
    const resource: Resource = { uri: 'file:///a.json', name: 'A', mimeType: 'application/json' };
    const content: ResourceContent = {
      uri: 'file:///a.json',
      mimeType: 'application/json',
      text: '{"x":1}',
    };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-json-preview"]')).toBeTruthy();
  });

  it('图片预览', () => {
    const resource: Resource = { uri: 'file:///a.png', name: 'A', mimeType: 'image/png' };
    const content: ResourceContent = {
      uri: 'file:///a.png',
      mimeType: 'image/png',
      blob: 'iVBORw0KGgo=',
    };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-image-preview"]')).toBeTruthy();
  });

  it('音频预览', () => {
    const resource: Resource = { uri: 'file:///a.mp3', name: 'A', mimeType: 'audio/mpeg' };
    const content: ResourceContent = {
      uri: 'file:///a.mp3',
      mimeType: 'audio/mpeg',
      blob: 'AAA=',
    };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-audio-preview"]')).toBeTruthy();
  });

  it('视频预览', () => {
    const resource: Resource = { uri: 'file:///a.mp4', name: 'A', mimeType: 'video/mp4' };
    const content: ResourceContent = {
      uri: 'file:///a.mp4',
      mimeType: 'video/mp4',
      blob: 'AAA=',
    };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-video-preview"]')).toBeTruthy();
  });

  it('PDF 预览', () => {
    const resource: Resource = { uri: 'file:///a.pdf', name: 'A', mimeType: 'application/pdf' };
    const content: ResourceContent = {
      uri: 'file:///a.pdf',
      mimeType: 'application/pdf',
      blob: 'AAA=',
    };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-pdf-preview"]')).toBeTruthy();
  });

  it('二进制预览', () => {
    const resource: Resource = { uri: 'file:///a.bin', name: 'A', mimeType: 'application/octet-stream' };
    const content: ResourceContent = {
      uri: 'file:///a.bin',
      mimeType: 'application/octet-stream',
      blob: 'AAAA',
    };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-binary-preview"]')).toBeTruthy();
  });

  it('截断长文本', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const resource: Resource = { uri: 'file:///a.log', name: 'log', mimeType: 'text/plain' };
    const content: ResourceContent = { uri: 'file:///a.log', mimeType: 'text/plain', text: lines };
    const { container } = render(
      <McpResourceViewer resource={resource} content={content} maxLines={10} />,
    );
    const preview = container.querySelector('[data-testid="mcp-text-preview"]');
    expect(preview?.textContent).toContain('显示前 10 行');
  });

  it('无 mime 时使用 fallback', () => {
    const resource: Resource = { uri: 'file:///a', name: 'A' };
    const content: ResourceContent = { uri: 'file:///a', text: 'hi' };
    const { container } = render(<McpResourceViewer resource={resource} content={content} />);
    expect(container.querySelector('[data-testid="mcp-text-preview"]')).toBeTruthy();
  });
});

// ============ 组件测试：McpResourcePanel ============

const createMockClient = (
  resources: Resource[],
  contents: Record<string, ResourceContent[]> = {},
): McpResourceClient => ({
  listResources: vi.fn().mockResolvedValue(resources),
  readResource: vi.fn().mockImplementation(async (uri: string) => contents[uri] ?? []),
});

describe('McpResourcePanel', () => {
  it('渲染面板标题', async () => {
    const client = createMockClient([]);
    await act(async () => {
      render(<McpResourcePanel client={client} />);
    });
    // 等待列表加载完成
    await waitFor(() => {
      expect(screen.getByTestId('mcp-resource-panel')).toBeTruthy();
    });
    expect(screen.getByText('MCP 资源浏览')).toBeTruthy();
  });

  it('空状态', async () => {
    const client = createMockClient([]);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-resource-list-empty')).toBeTruthy();
    });
  });

  it('加载并显示资源列表', async () => {
    const resources: Resource[] = [
      { uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' },
      { uri: 'file:///b.png', name: 'B', mimeType: 'image/png' },
    ];
    const client = createMockClient(resources);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
      expect(screen.getByText('B')).toBeTruthy();
    });
  });

  it('client=null 报错', async () => {
    render(<McpResourcePanel client={null} />);
    await waitFor(() => {
      expect(screen.getByText('客户端未连接')).toBeTruthy();
    });
  });

  it('listResources 错误', async () => {
    const client: McpResourceClient = {
      listResources: vi.fn().mockRejectedValue(new Error('list failed')),
      readResource: vi.fn(),
    };
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-resource-panel-error')?.textContent).toContain('list failed');
    });
  });

  it('点击资源进入详情', async () => {
    const resources: Resource[] = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    const contents: Record<string, ResourceContent[]> = {
      'file:///a.txt': [{ uri: 'file:///a.txt', mimeType: 'text/plain', text: 'content' }],
    };
    const client = createMockClient(resources, contents);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('A'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-resource-detail')).toBeTruthy();
    });
  });

  it('搜索过滤', async () => {
    const resources: Resource[] = [
      { uri: 'file:///a.txt', name: 'apple', mimeType: 'text/plain' },
      { uri: 'file:///b.txt', name: 'banana', mimeType: 'text/plain' },
    ];
    const client = createMockClient(resources);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('apple')).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('搜索 URI / 名称 / 描述') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ban' } });
    await waitFor(() => {
      expect(screen.queryByText('apple')).toBeNull();
      expect(screen.getByText('banana')).toBeTruthy();
    });
  });

  it('类型过滤', async () => {
    const resources: Resource[] = [
      { uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' },
      { uri: 'file:///b.png', name: 'B', mimeType: 'image/png' },
    ];
    const client = createMockClient(resources);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });

    // 点击"图片"过滤
    const imageButton = screen.getByText(/图片 \(\d+\)/);
    fireEvent.click(imageButton);
    await waitFor(() => {
      expect(screen.queryByText('A')).toBeNull();
      expect(screen.getByText('B')).toBeTruthy();
    });
  });

  it('统计信息', async () => {
    const resources: Resource[] = [
      { uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' },
      { uri: 'file:///b.png', name: 'B', mimeType: 'image/png' },
      { uri: 'file:///c.png', name: 'C', mimeType: 'image/png' },
    ];
    const client = createMockClient(resources);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('共 3 个资源')).toBeTruthy();
      expect(screen.getByText(/图片 \(2\)/)).toBeTruthy();
      expect(screen.getByText(/文本 \(1\)/)).toBeTruthy();
    });
  });

  it('返回列表', async () => {
    const resources: Resource[] = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    const contents: Record<string, ResourceContent[]> = {
      'file:///a.txt': [{ uri: 'file:///a.txt', mimeType: 'text/plain', text: 'x' }],
    };
    const client = createMockClient(resources, contents);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('A'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-resource-detail')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('返回列表'));
    await waitFor(() => {
      expect(screen.getByText('MCP 资源浏览')).toBeTruthy();
    });
  });

  it('onResourceSelect 回调', async () => {
    const onSelect = vi.fn();
    const resources: Resource[] = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    const client = createMockClient(resources);
    render(<McpResourcePanel client={client} onResourceSelect={onSelect} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('A'));
    expect(onSelect).toHaveBeenCalledWith(resources[0]);

    fireEvent.click(screen.getByLabelText('返回列表'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('autoLoad=false 不自动加载', async () => {
    const client = createMockClient([]);
    render(<McpResourcePanel client={client} autoLoad={false} />);
    // 不应自动调用 listResources
    expect(client.listResources).not.toHaveBeenCalled();
  });

  it('刷新按钮', async () => {
    const client = createMockClient([]);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(client.listResources).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByText('刷新'));
    await waitFor(() => {
      expect(client.listResources).toHaveBeenCalledTimes(2);
    });
  });

  it('readResource 错误显示', async () => {
    const resources: Resource[] = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    const client: McpResourceClient = {
      listResources: vi.fn().mockResolvedValue(resources),
      readResource: vi.fn().mockRejectedValue(new Error('read fail')),
    };
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('A'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-resource-viewer-error')?.textContent).toContain('read fail');
    });
  });

  it('空内容显示提示', async () => {
    const resources: Resource[] = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    const client: McpResourceClient = {
      listResources: vi.fn().mockResolvedValue(resources),
      readResource: vi.fn().mockResolvedValue([]),
    };
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('A'));
    await waitFor(() => {
      expect(screen.getByText('资源内容为空')).toBeTruthy();
    });
  });

  it('复制 URI', async () => {
    const resources: Resource[] = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    const client = createMockClient(resources);
    render(<McpResourcePanel client={client} />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });

    const copyBtn = screen.getByLabelText('复制 URI');
    // 复制到 navigator.clipboard
    const writeText = vi.fn().mockResolvedValue(undefined);
    // happy-dom 中 clipboard 是只读的，需要用 defineProperty
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith('file:///a.txt');
  });
});
