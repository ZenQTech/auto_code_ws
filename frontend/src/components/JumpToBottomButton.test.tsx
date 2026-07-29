/**
 * # ============================================================
 * # JumpToBottomButton 组件测试 (v1.0.0 - Cycle 15 P1-2)
 * # ============================================================
 * # 核心作用：覆盖跳到最新消息按钮的全部功能：
 * #   - visible=false 时不渲染
 * #   - visible=true 时渲染按钮
 * #   - 点击触发全局事件 'hermes:virtual-list:scroll-to-bottom'
 * #   - 未读消息数量显示
 * #   - 99+ 边界
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import JumpToBottomButton from './JumpToBottomButton';

describe('JumpToBottomButton - 基础渲染', () => {
  it('visible=false 时不渲染', () => {
    const { container } = render(<JumpToBottomButton visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('visible=true 时渲染按钮', () => {
    render(<JumpToBottomButton visible={true} />);
    const button = screen.getByLabelText('跳到最新消息');
    expect(button).toBeInTheDocument();
  });

  it('应显示 "跳到最新" 文本', () => {
    render(<JumpToBottomButton visible={true} />);
    expect(screen.getByText('跳到最新')).toBeInTheDocument();
  });
});

describe('JumpToBottomButton - 点击行为', () => {
  let dispatchSpy: any;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });
  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  it('点击按钮应派发 hermes:virtual-list:scroll-to-bottom 事件', () => {
    render(<JumpToBottomButton visible={true} />);
    const button = screen.getByLabelText('跳到最新消息');
    fireEvent.click(button);
    expect(dispatchSpy).toHaveBeenCalled();
    const eventArg = dispatchSpy.mock.calls[0][0];
    expect(eventArg.type).toBe('hermes:virtual-list:scroll-to-bottom');
  });

  it('派发的事件是 CustomEvent', () => {
    render(<JumpToBottomButton visible={true} />);
    const button = screen.getByLabelText('跳到最新消息');
    fireEvent.click(button);
    const eventArg = dispatchSpy.mock.calls[0][0];
    expect(eventArg).toBeInstanceOf(CustomEvent);
  });
});

describe('JumpToBottomButton - 未读消息徽章', () => {
  it('newMessageCount=0 时不显示徽章', () => {
    render(<JumpToBottomButton visible={true} newMessageCount={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('newMessageCount=1 时显示 1', () => {
    render(<JumpToBottomButton visible={true} newMessageCount={1} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('newMessageCount=99 时显示 99', () => {
    render(<JumpToBottomButton visible={true} newMessageCount={99} />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('newMessageCount=100 时显示 99+', () => {
    render(<JumpToBottomButton visible={true} newMessageCount={100} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('newMessageCount=1000 时显示 99+', () => {
    render(<JumpToBottomButton visible={true} newMessageCount={1000} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });
});

describe('JumpToBottomButton - className', () => {
  it('自定义 className 应应用到按钮', () => {
    render(<JumpToBottomButton visible={true} className="my-extra-class" />);
    const button = screen.getByLabelText('跳到最新消息');
    expect(button.className).toContain('my-extra-class');
  });
});

describe('JumpToBottomButton - 动画 key 行为', () => {
  it('visible 切换时应更新 animation key', () => {
    const { rerender } = render(<JumpToBottomButton visible={false} />);
    expect(screen.queryByLabelText('跳到最新消息')).not.toBeInTheDocument();

    rerender(<JumpToBottomButton visible={true} />);
    expect(screen.getByLabelText('跳到最新消息')).toBeInTheDocument();

    // 隐藏后再显示应仍正常
    rerender(<JumpToBottomButton visible={false} />);
    expect(screen.queryByLabelText('跳到最新消息')).not.toBeInTheDocument();

    rerender(<JumpToBottomButton visible={true} />);
    expect(screen.getByLabelText('跳到最新消息')).toBeInTheDocument();
  });
});

describe('JumpToBottomButton - 事件监听集成', () => {
  it('集成：派发事件后应能被监听到', async () => {
    const handler = vi.fn();
    const eventName = 'hermes:virtual-list:scroll-to-bottom';
    window.addEventListener(eventName, handler);

    render(<JumpToBottomButton visible={true} />);
    const button = screen.getByLabelText('跳到最新消息');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener(eventName, handler);
  });
});
