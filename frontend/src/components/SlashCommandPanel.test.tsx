/**
 * SlashCommandPanel 组件测试 (v1.0.0 Cycle 28 G28-05)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SlashCommandPanel } from './SlashCommandPanel';

describe('SlashCommandPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('打开时显示标题', () => {
    render(<SlashCommandPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/斜杠命令/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<SlashCommandPanel isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="slash-command-panel"]')).toBeNull();
  });

  it('点击关闭触发 onClose', () => {
    let closed = false;
    render(<SlashCommandPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('slash-command-close'));
    expect(closed).toBe(true);
  });

  it('列出内置命令', () => {
    render(<SlashCommandPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('slash-command-item-init')).toBeTruthy();
    expect(screen.getByTestId('slash-command-item-status')).toBeTruthy();
    expect(screen.getByTestId('slash-command-item-review')).toBeTruthy();
    expect(screen.getByTestId('slash-command-item-plan')).toBeTruthy();
    expect(screen.getByTestId('slash-command-item-goal')).toBeTruthy();
  });

  it('点击命令填入输入框', () => {
    render(<SlashCommandPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('slash-command-item-init'));
    const input = screen.getByTestId('slash-command-input') as HTMLInputElement;
    expect(input.value).toBe('/init');
  });

  it('执行 /status 命令', async () => {
    render(<SlashCommandPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('slash-command-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/status' } });
    fireEvent.click(screen.getByTestId('slash-command-execute'));
    await waitFor(() => {
      expect(screen.getByText(/会话状态/)).toBeTruthy();
    });
  });

  it('搜索过滤命令', () => {
    render(<SlashCommandPanel isOpen={true} onClose={() => {}} />);
    const filter = screen.getByTestId('slash-command-filter') as HTMLInputElement;
    fireEvent.change(filter, { target: { value: 'init' } });
    expect(screen.getByTestId('slash-command-item-init')).toBeTruthy();
    expect(screen.queryByTestId('slash-command-item-status')).toBeNull();
  });

  it('执行失败显示错误', async () => {
    render(<SlashCommandPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('slash-command-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/unknown' } });
    fireEvent.click(screen.getByTestId('slash-command-execute'));
    await waitFor(() => {
      expect(screen.getByText(/Unknown command/)).toBeTruthy();
    });
  });

  it('空历史显示占位', () => {
    render(<SlashCommandPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/执行历史为空/)).toBeTruthy();
  });
});
