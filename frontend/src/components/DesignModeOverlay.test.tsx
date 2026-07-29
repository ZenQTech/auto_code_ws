/**
 * DesignModeOverlay 集成测试 (v1.0.0 Cycle 19 G19-03)
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DesignModeOverlay } from './DesignModeOverlay';
import { resetDesignModeController } from '../utils/designModeController';

describe('DesignModeOverlay', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    root.id = 'test-root';
    root.innerHTML = `
      <button class="btn" id="btn1">Click 1</button>
      <button class="btn" id="btn2">Click 2</button>
      <div class="container" id="container">
        <span id="span1">Text</span>
      </div>
    `;
    document.body.appendChild(root);
    resetDesignModeController();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('isActive=false 不渲染', () => {
    const { container } = render(
      <DesignModeOverlay
        isActive={false}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('激活时显示覆盖层', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    expect(screen.getByTestId('design-mode-overlay')).toBeInTheDocument();
  });

  it('显示顶部 banner', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    expect(screen.getByTestId('design-mode-banner')).toBeInTheDocument();
    expect(screen.getByText(/Design Mode 已激活/)).toBeInTheDocument();
  });

  it('显示工具栏', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    expect(screen.getByTestId('design-mode-toolbar')).toBeInTheDocument();
  });

  it('点击退出按钮触发 onExit', () => {
    const onExit = vi.fn();
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={onExit}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('design-mode-exit'));
    expect(onExit).toHaveBeenCalled();
  });

  it('点击清空按钮', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('design-mode-clear'));
    // 清空不应该抛错
    expect(screen.getByTestId('design-mode-clear')).toBeInTheDocument();
  });

  it('初始已选数量为 0', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText('已选 0 个')).toBeInTheDocument();
  });

  it('应用按钮初始禁用（无选中）', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    const submitBtn = screen.getByTestId('design-mode-submit');
    expect(submitBtn).toBeDisabled();
  });

  it('点击元素后更新已选数量', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    const btn1 = document.getElementById('btn1') as HTMLElement;
    fireEvent.click(btn1);
    expect(screen.getByText('已选 1 个')).toBeInTheDocument();
  });

  it('点击元素后应用按钮启用', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
      />
    );
    const btn1 = document.getElementById('btn1') as HTMLElement;
    fireEvent.click(btn1);
    const submitBtn = screen.getByTestId('design-mode-submit');
    expect(submitBtn).not.toBeDisabled();
  });

  it('点击应用触发 onSelect 并退出', () => {
    const onSelect = vi.fn();
    const onExit = vi.fn();
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={onExit}
        onSelect={onSelect}
      />
    );
    const btn1 = document.getElementById('btn1') as HTMLElement;
    fireEvent.click(btn1);
    fireEvent.click(screen.getByTestId('design-mode-submit'));
    expect(onSelect).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalled();
  });

  it('截图按钮在有选中时启用', () => {
    render(
      <DesignModeOverlay
        isActive={true}
        rootElement={root}
        onExit={() => {}}
        onSelect={() => {}}
        onCapture={() => {}}
      />
    );
    const btn1 = document.getElementById('btn1') as HTMLElement;
    fireEvent.click(btn1);
    const captureBtn = screen.getByTestId('design-mode-capture');
    expect(captureBtn).not.toBeDisabled();
  });
});
