/**
 * # ============================================================
 * # SessionReplayPanel 组件测试 (Cycle 23 G23-02)
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SessionReplayPanel } from './SessionReplayPanel';
import { resetSessionReplayEngine, getSessionReplayEngine } from '../utils/sessionReplay';

describe('SessionReplayPanel', () => {
  beforeEach(() => {
    resetSessionReplayEngine();
  });

  afterEach(() => {
    cleanup();
    resetSessionReplayEngine();
  });

  it('面板未打开时不渲染', () => {
    const { container } = render(<SessionReplayPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('面板打开时显示标题', () => {
    render(<SessionReplayPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('会话回放')).toBeTruthy();
  });

  it('应显示 3 个标签页', () => {
    render(<SessionReplayPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('回放列表')).toBeTruthy();
    expect(screen.getByText('回放控制')).toBeTruthy();
    expect(screen.getAllByText('新建录制').length).toBeGreaterThanOrEqual(1);
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    render(<SessionReplayPanel isOpen={true} onClose={onClose} />);
    const closeButton = screen.getByTestId('replay-close');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('空列表应显示提示信息', () => {
    render(<SessionReplayPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/暂无回放/)).toBeTruthy();
  });

  it('点击新建录制标签页应显示录制表单', () => {
    render(<SessionReplayPanel isOpen={true} onClose={vi.fn()} />);
    const recordTab = screen.getByTestId('replay-tab-record');
    fireEvent.click(recordTab);
    // 应显示标题输入框
    expect(screen.getByPlaceholderText(/回放标题/)).toBeTruthy();
  });

  it('创建回放后应显示在列表中', () => {
    const engine = getSessionReplayEngine();
    engine.createReplay({
      sessionId: 's1',
      title: 'Test Replay',
      frames: [],
    });
    render(<SessionReplayPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Test Replay')).toBeTruthy();
  });

  it('点击回放项应进入回放控制标签', () => {
    const engine = getSessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      title: 'Test Replay',
      frames: [
        {
          frameId: 'f1',
          type: 'message',
          timestamp: 0,
          durationMs: 0,
          data: { role: 'user', content: 'hi' },
        },
      ],
    });
    render(<SessionReplayPanel isOpen={true} onClose={vi.fn()} />);
    const openButton = screen.getByTestId(`replay-open-${replay.replayId}`);
    fireEvent.click(openButton);
    // 应显示帧详情
    expect(screen.getByTestId('replay-current-frame')).toBeTruthy();
  });

  it('Esc 键应关闭面板', () => {
    const onClose = vi.fn();
    render(<SessionReplayPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
