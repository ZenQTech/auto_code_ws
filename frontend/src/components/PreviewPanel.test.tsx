/**
 * # ============================================================
 * PreviewPanel 组件测试 (v6.37.0 Cycle 17 P0-3)
 * # ============================================================
 * 核心作用：验证 PreviewPanel UI 组件
 * 测试覆盖：20+ 个测试
 * 设计说明：
 *   - 通过 ComposerProvider 注入共享 engine
 *   - 通过 props（externalMode）直接控制预览模式
 *   - 覆盖渲染、模式切换、错误展示、快照管理、生命周期
 * ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { PreviewPanel } from './PreviewPanel';
import { ComposerProvider, useComposer } from '../hooks/useComposer';
import { createComposerEngine } from '../utils/composerEngine';

// ============================================================
// 测试辅助
// ============================================================

type PreviewMode = 'html' | 'react' | 'iframe';

interface HarnessApi {
  addContext: ReturnType<typeof useComposer>['addContext'];
  addEdit: ReturnType<typeof useComposer>['addEdit'];
  acceptEdit: ReturnType<typeof useComposer>['acceptEdit'];
  getMode: () => PreviewMode;
}

function makeHarness(props: {
  initialMode?: PreviewMode;
  initialFiles?: Record<string, string>;
  onClose?: () => void;
} = {}) {
  const engine = createComposerEngine();
  let apiRef: HarnessApi | null = null;
  let modeRef: PreviewMode = props.initialMode ?? 'react';
  const setModeRef = (v: PreviewMode) => {
    modeRef = v;
  };

  function Harness() {
    const composer = useComposer();
    if (!apiRef) {
      apiRef = {
        addContext: composer.addContext,
        addEdit: composer.addEdit,
        acceptEdit: composer.acceptEdit,
        getMode: () => modeRef,
      };
    }
    return (
      <PreviewPanel
        externalMode={modeRef}
        initialFiles={props.initialFiles}
        onClose={props.onClose}
      />
    );
  }

  return {
    engine,
    get api() {
      if (!apiRef) throw new Error('API not initialized');
      return apiRef;
    },
    setMode: setModeRef,
    Harness,
  };
}

// ============================================================
// 测试用例
// ============================================================

describe('PreviewPanel - 基础渲染', () => {
  it('无文件时显示空状态', () => {
    const { Harness } = makeHarness();
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.getByTestId('preview-empty')).toBeInTheDocument();
    expect(screen.getByText('暂无预览内容')).toBeInTheDocument();
  });

  it('有文件时渲染 iframe', () => {
    const { Harness } = makeHarness({
      initialFiles: { 'index.html': '<div>Hi</div>' },
    });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    const iframe = screen.getByTestId('preview-iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe.tagName).toBe('IFRAME');
  });

  it('显示文件数量', () => {
    const { Harness } = makeHarness({
      initialFiles: { 'index.html': '<div>a</div>', 'App.tsx': '<div>b</div>' },
    });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.getByText('2 文件')).toBeInTheDocument();
  });

  it('外部控制模式正确显示', () => {
    const { Harness } = makeHarness({ initialMode: 'html' });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    const panel = screen.getByTestId('preview-panel');
    expect(panel.getAttribute('data-mode')).toBe('html');
  });
});

describe('PreviewPanel - 模式切换', () => {
  it('点击模式按钮切换模式', () => {
    const { Harness } = makeHarness();
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    const htmlBtn = screen.getByTestId('preview-mode-html');
    fireEvent.click(htmlBtn);
    expect(htmlBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('外部模式变化时更新显示', () => {
    let setModeExt: ((m: PreviewMode) => void) | null = null;
    function Wrapper() {
      const [mode, setMode] = useState<PreviewMode>('react');
      setModeExt = setMode;
      return (
        <ComposerProvider engine={createComposerEngine()}>
          <PreviewPanel externalMode={mode} initialFiles={{ 'index.html': '<x/>' }} />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);
    expect(screen.getByTestId('preview-panel').getAttribute('data-mode')).toBe('react');
    act(() => {
      setModeExt?.('html');
    });
    expect(screen.getByTestId('preview-panel').getAttribute('data-mode')).toBe('html');
  });

  it('三个模式按钮全部渲染', () => {
    const { Harness } = makeHarness();
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.getByTestId('preview-mode-html')).toBeInTheDocument();
    expect(screen.getByTestId('preview-mode-react')).toBeInTheDocument();
    expect(screen.getByTestId('preview-mode-iframe')).toBeInTheDocument();
  });
});

describe('PreviewPanel - 操作按钮', () => {
  it('刷新按钮存在', () => {
    const { Harness } = makeHarness({
      initialFiles: { 'index.html': '<x/>' },
    });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.getByTestId('preview-refresh')).toBeInTheDocument();
  });

  it('重置按钮存在', () => {
    const { Harness } = makeHarness();
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.getByTestId('preview-reset')).toBeInTheDocument();
  });

  it('快照按钮存在', () => {
    const { Harness } = makeHarness({
      initialFiles: { 'index.html': '<x/>' },
    });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.getByTestId('preview-snapshot')).toBeInTheDocument();
  });

  it('点击刷新不报错', () => {
    const { Harness } = makeHarness({
      initialFiles: { 'index.html': '<x/>' },
    });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(() => fireEvent.click(screen.getByTestId('preview-refresh'))).not.toThrow();
  });

  it('点击重置不报错', () => {
    const { Harness } = makeHarness({
      initialFiles: { 'index.html': '<x/>' },
    });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(() => fireEvent.click(screen.getByTestId('preview-reset'))).not.toThrow();
  });
});

describe('PreviewPanel - 全屏切换', () => {
  it('点击全屏按钮切换状态', () => {
    const onFullscreenChange = vi.fn();
    function Wrapper() {
      return (
        <ComposerProvider engine={createComposerEngine()}>
          <PreviewPanel
            initialFiles={{ 'index.html': '<x/>' }}
            onFullscreenChange={onFullscreenChange}
          />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);
    const btn = screen.getByTestId('preview-fullscreen');
    fireEvent.click(btn);
    expect(onFullscreenChange).toHaveBeenCalledWith(true);
  });

  it('全屏时面板 z-index 提升', () => {
    const onFullscreenChange = vi.fn();
    function Wrapper() {
      return (
        <ComposerProvider engine={createComposerEngine()}>
          <PreviewPanel
            initialFiles={{ 'index.html': '<x/>' }}
            onFullscreenChange={onFullscreenChange}
          />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);
    const panel = screen.getByTestId('preview-panel');
    expect(panel.className).not.toContain('inset-0');
    fireEvent.click(screen.getByTestId('preview-fullscreen'));
    expect(panel.className).toContain('inset-0');
  });
});

describe('PreviewPanel - 关闭按钮', () => {
  it('提供 onClose 时显示关闭按钮', () => {
    const onClose = vi.fn();
    const { Harness } = makeHarness({ onClose });
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    const closeBtn = screen.getByTestId('preview-close');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('不提供 onClose 时不渲染关闭按钮', () => {
    const { Harness } = makeHarness();
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.queryByTestId('preview-close')).not.toBeInTheDocument();
  });
});

describe('PreviewPanel - 错误展示', () => {
  it('iframe 错误时显示错误卡片', async () => {
    function Wrapper() {
      return (
        <ComposerProvider engine={createComposerEngine()}>
          <PreviewPanel initialFiles={{ 'index.html': '<x/>' }} />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);

    // 模拟来自 iframe 的错误消息
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'preview-error',
            error: {
              type: 'runtime',
              message: 'ReferenceError: x is not defined',
              stack: 'at App (App.tsx:5:1)',
            },
          },
        })
      );
      // 等待 sandbox 处理
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('preview-error-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('preview-error-message').textContent).toContain('ReferenceError');
  });

  it('错误卡片显示错误类型', async () => {
    function Wrapper() {
      return (
        <ComposerProvider engine={createComposerEngine()}>
          <PreviewPanel initialFiles={{ 'index.html': '<x/>' }} />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'preview-error',
            error: { type: 'syntax', message: 'Unexpected token' },
          },
        })
      );
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      const card = screen.queryByTestId('preview-error-card');
      expect(card).toBeInTheDocument();
    });
    expect(screen.getByTestId('preview-error-card').getAttribute('data-error-type')).toBe('syntax');
  });

  it('错误卡片显示重试按钮', async () => {
    function Wrapper() {
      return (
        <ComposerProvider engine={createComposerEngine()}>
          <PreviewPanel initialFiles={{ 'index.html': '<x/>' }} />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'preview-error',
            error: { type: 'runtime', message: 'err' },
          },
        })
      );
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('preview-error-retry')).toBeInTheDocument();
    });
  });
});

describe('PreviewPanel - 状态徽章', () => {
  it('默认显示空闲状态', () => {
    const { Harness } = makeHarness();
    render(
      <ComposerProvider engine={createComposerEngine()}>
        <Harness />
      </ComposerProvider>
    );
    expect(screen.getByTestId('preview-status-idle')).toBeInTheDocument();
  });

  it('更新文件后变为就绪状态', async () => {
    function Wrapper() {
      return (
        <ComposerProvider engine={createComposerEngine()}>
          <PreviewPanel initialFiles={{ 'index.html': '<x/>' }} />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('preview-status-ready')).toBeInTheDocument();
    });
  });
});

describe('PreviewPanel - 集成 useComposer', () => {
  it('添加 context file 后自动更新预览', async () => {
    const engine = createComposerEngine();
    function Wrapper() {
      return (
        <ComposerProvider engine={engine}>
          <PreviewPanel />
        </ComposerProvider>
      );
    }
    render(<Wrapper />);

    // 初始无文件
    expect(screen.getByTestId('preview-empty')).toBeInTheDocument();

    // 通过 engine 添加 file context
    act(() => {
      engine.addContext({
        type: 'file',
        path: 'test.tsx',
        content: 'const App = () => <div>Hi</div>;',
        language: 'tsx',
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('preview-area')).toBeInTheDocument();
    });
  });
});

describe('PreviewPanel - 清理', () => {
  it('卸载时清理 SandboxManager', () => {
    const { unmount } = render(
      <ComposerProvider engine={createComposerEngine()}>
        <PreviewPanel initialFiles={{ 'index.html': '<x/>' }} />
      </ComposerProvider>
    );
    expect(() => unmount()).not.toThrow();
  });
});
