/**
 * # ============================================================
 * # FigmaImportPanel 组件测试 (Cycle 24 G24-04)
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { FigmaImportPanel } from './FigmaImportPanel';
import { resetFigmaAdapter } from '../utils/figmaAdapter';

describe('FigmaImportPanel', () => {
  beforeEach(() => {
    resetFigmaAdapter();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    resetFigmaAdapter();
    localStorage.clear();
  });

  it('应渲染面板', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-import-panel')).toBeTruthy();
  });

  it('isOpen=false 时不应渲染', () => {
    const { container } = render(<FigmaImportPanel isOpen={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('应显示面板标题', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/Figma 设计稿转代码/)).toBeTruthy();
  });

  it('应包含关闭按钮', () => {
    const onClose = vi.fn();
    render(<FigmaImportPanel isOpen={true} onClose={onClose} />);
    const closeBtn = screen.getByTestId('figma-close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('应包含 URL 输入框', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-url-input')).toBeTruthy();
  });

  it('应包含 Token 输入框', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-token-input')).toBeTruthy();
  });

  it('应包含框架选择器', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-framework-select')).toBeTruthy();
  });

  it('应包含样式选择器', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-styling-select')).toBeTruthy();
  });

  it('应包含组件名输入框', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-component-name')).toBeTruthy();
  });

  it('应包含生成按钮', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-generate')).toBeTruthy();
  });

  it('应包含 Mock 模式开关', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-mock-toggle')).toBeTruthy();
  });

  it('应包含 5 个 Mock 预设按钮', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-mock-button-primary')).toBeTruthy();
    expect(screen.getByTestId('figma-mock-card-simple')).toBeTruthy();
    expect(screen.getByTestId('figma-mock-input-field')).toBeTruthy();
    expect(screen.getByTestId('figma-mock-navbar')).toBeTruthy();
    expect(screen.getByTestId('figma-mock-alert')).toBeTruthy();
  });

  it('点击 Mock 预设应加载节点', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-mock-button-primary'));
    // 节点树应显示
    expect(screen.getByTestId('figma-node-tree')).toBeTruthy();
    expect(screen.getByTestId('figma-node-mock-1')).toBeTruthy();
  });

  it('点击生成按钮应生成代码', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-mock-button-primary'));
    fireEvent.click(screen.getByTestId('figma-generate'));
    expect(screen.getByTestId('figma-code-block')).toBeTruthy();
  });

  it('应显示统计信息', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-mock-button-primary'));
    fireEvent.click(screen.getByTestId('figma-generate'));
    expect(screen.getByTestId('figma-stats')).toBeTruthy();
    expect(screen.getByTestId('stat-nodes')).toBeTruthy();
    expect(screen.getByTestId('stat-text')).toBeTruthy();
    expect(screen.getByTestId('stat-frames')).toBeTruthy();
    expect(screen.getByTestId('stat-lines')).toBeTruthy();
    expect(screen.getByTestId('stat-bytes')).toBeTruthy();
  });

  it('应显示复制和下载按钮', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-mock-button-primary'));
    fireEvent.click(screen.getByTestId('figma-generate'));
    expect(screen.getByTestId('figma-copy')).toBeTruthy();
    expect(screen.getByTestId('figma-download')).toBeTruthy();
  });

  it('点击复制按钮应调用 clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-mock-button-primary'));
    fireEvent.click(screen.getByTestId('figma-generate'));
    fireEvent.click(screen.getByTestId('figma-copy'));
    expect(writeText).toHaveBeenCalled();
  });

  it('切换框架应重新生成代码', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-mock-button-primary'));
    fireEvent.click(screen.getByTestId('figma-generate'));
    const code1 = screen.getByTestId('figma-code-block').textContent;
    fireEvent.change(screen.getByTestId('figma-framework-select'), { target: { value: 'vue' } });
    const code2 = screen.getByTestId('figma-code-block').textContent;
    expect(code1).not.toBe(code2);
  });

  it('应能从 URL 解析 fileKey', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    const urlInput = screen.getByTestId('figma-url-input');
    fireEvent.change(urlInput, { target: { value: 'https://www.figma.com/file/abc123/Test?node-id=1-2' } });
    fireEvent.blur(urlInput);
    expect(screen.getByTestId('figma-parsed-info')).toBeTruthy();
    expect(screen.getByTestId('figma-parsed-info').textContent).toContain('abc123');
  });

  it('无效 URL 应显示错误', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    const urlInput = screen.getByTestId('figma-url-input');
    fireEvent.change(urlInput, { target: { value: 'not-a-valid-url' } });
    fireEvent.click(screen.getByTestId('figma-parse'));
    expect(screen.getByTestId('figma-status').textContent).toContain('无效');
  });

  it('无 URL 时点击解析应显示错误', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-parse'));
    expect(screen.getByTestId('figma-status').textContent).toContain('请输入');
  });

  it('应支持选择节点', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-mock-card-simple'));
    fireEvent.click(screen.getByTestId('figma-node-mock-2-title'));
    // 应触发选择状态
  });

  it('应包含评论开关', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-comments-toggle')).toBeTruthy();
  });

  it('应包含图片提取开关', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-images-toggle')).toBeTruthy();
  });

  it('应包含清缓存按钮', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-clear-cache')).toBeTruthy();
  });

  it('应包含重置按钮', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('figma-reset')).toBeTruthy();
  });

  it('应支持设置组件名', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    const nameInput = screen.getByTestId('figma-component-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'MyCard' } });
    expect(nameInput.value).toBe('MyCard');
  });

  it('应支持设置样式', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    const styleSelect = screen.getByTestId('figma-styling-select');
    fireEvent.change(styleSelect, { target: { value: 'inline' } });
    expect((styleSelect as HTMLSelectElement).value).toBe('inline');
  });

  it('应支持设置框架', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    const fwSelect = screen.getByTestId('figma-framework-select');
    fireEvent.change(fwSelect, { target: { value: 'html' } });
    expect((fwSelect as HTMLSelectElement).value).toBe('html');
  });

  it('应支持切换 Mock 模式', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    const mockToggle = screen.getByTestId('figma-mock-toggle');
    fireEvent.click(mockToggle);
    // 状态变更
  });

  it('localStorage 持久化应在打开时恢复', () => {
    localStorage.setItem('hermes.figimaImportPanel', JSON.stringify({
      url: 'https://www.figma.com/file/saved123/Test',
      componentName: 'SavedComponent',
      framework: 'vue',
    }));
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    const urlInput = screen.getByTestId('figma-url-input') as HTMLInputElement;
    expect(urlInput.value).toContain('saved123');
  });

  it('应支持清空缓存', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('figma-clear-cache'));
    expect(screen.getByTestId('figma-status')).toBeTruthy();
  });

  it('点击背景应关闭面板', () => {
    const onClose = vi.fn();
    render(<FigmaImportPanel isOpen={true} onClose={onClose} />);
    const panel = screen.getByTestId('figma-import-panel');
    fireEvent.click(panel);
    expect(onClose).toHaveBeenCalled();
  });

  it('点击面板内容不应关闭', () => {
    const onClose = vi.fn();
    render(<FigmaImportPanel isOpen={true} onClose={onClose} />);
    // 找到内部 div
    const inner = screen.getByTestId('figma-import-panel').firstElementChild!;
    fireEvent.click(inner);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('无节点时点击生成应显示错误', () => {
    render(<FigmaImportPanel isOpen={true} onClose={() => {}} />);
    act(() => {
      fireEvent.click(screen.getByTestId('figma-generate'));
    });
    const status = screen.queryByTestId('figma-status');
    expect(status?.textContent).toContain('加载节点');
  });
});
