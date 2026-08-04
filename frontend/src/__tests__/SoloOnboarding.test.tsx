/**
 * SoloOnboarding 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SoloOnboarding, { resetSoloOnboarding } from '../components/SoloOnboarding';

describe('SoloOnboarding', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('首次访问时显示引导', () => {
    render(<SoloOnboarding />);
    expect(screen.getByTestId('solo-onboarding')).toBeInTheDocument();
  });

  it('已 dismiss 后不再显示', () => {
    window.localStorage.setItem('hermes.solo.onboarding.dismissed', '1');
    render(<SoloOnboarding />);
    expect(screen.queryByTestId('solo-onboarding')).not.toBeInTheDocument();
  });

  it('显示欢迎标题', () => {
    render(<SoloOnboarding />);
    expect(screen.getByText('欢迎使用 Solo 模式')).toBeInTheDocument();
  });

  it('显示当前步骤内容', () => {
    render(<SoloOnboarding />);
    expect(screen.getByText('输入提示词')).toBeInTheDocument();
  });

  it('显示所有 5 个步骤指示器', () => {
    render(<SoloOnboarding />);
    expect(screen.getByTestId('solo-onboarding-step-0')).toBeInTheDocument();
    expect(screen.getByTestId('solo-onboarding-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('solo-onboarding-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('solo-onboarding-step-3')).toBeInTheDocument();
    expect(screen.getByTestId('solo-onboarding-step-4')).toBeInTheDocument();
  });

  it('点击下一步切换步骤', () => {
    render(<SoloOnboarding />);
    fireEvent.click(screen.getByTestId('solo-onboarding-next'));
    expect(screen.getByText('打开命令面板')).toBeInTheDocument();
  });

  it('点击上一步回退', () => {
    render(<SoloOnboarding />);
    // 先下一步两次
    fireEvent.click(screen.getByTestId('solo-onboarding-next'));
    fireEvent.click(screen.getByTestId('solo-onboarding-next'));
    // 再上一步
    fireEvent.click(screen.getByTestId('solo-onboarding-prev'));
    expect(screen.getByText('打开命令面板')).toBeInTheDocument();
  });

  it('在第一步时上一步按钮隐藏', () => {
    render(<SoloOnboarding />);
    expect(screen.queryByTestId('solo-onboarding-prev')).not.toBeInTheDocument();
  });

  it('在最后一步时显示"开始使用"按钮', () => {
    render(<SoloOnboarding />);
    // 跳到最后一步
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByTestId('solo-onboarding-next'));
    }
    expect(screen.getByTestId('solo-onboarding-start')).toBeInTheDocument();
  });

  it('点击步骤指示器跳转', () => {
    render(<SoloOnboarding />);
    fireEvent.click(screen.getByTestId('solo-onboarding-step-3'));
    expect(screen.getByText('实时跟随执行')).toBeInTheDocument();
  });

  it('关闭按钮触发持久化', () => {
    render(<SoloOnboarding onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByTestId('solo-onboarding-skip'));
    expect(window.localStorage.getItem('hermes.solo.onboarding.dismissed')).toBe('1');
  });

  it('重置后可重新显示', () => {
    window.localStorage.setItem('hermes.solo.onboarding.dismissed', '1');
    resetSoloOnboarding();
    render(<SoloOnboarding />);
    expect(screen.getByTestId('solo-onboarding')).toBeInTheDocument();
  });

  it('onDismiss 回调', () => {
    const onDismiss = vi.fn();
    render(<SoloOnboarding onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('solo-onboarding-skip'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('onStartChat 回调', () => {
    const onStartChat = vi.fn();
    render(<SoloOnboarding onStartChat={onStartChat} />);
    // 跳到最后一步
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByTestId('solo-onboarding-next'));
    }
    fireEvent.click(screen.getByTestId('solo-onboarding-start'));
    expect(onStartChat).toHaveBeenCalled();
  });

  it('"先试试 ⌘K" 链接存在', () => {
    render(<SoloOnboarding />);
    expect(screen.getByTestId('solo-onboarding-try-palette')).toBeInTheDocument();
  });

  it('点击 ⌘K 链接触发 onOpenPalette', () => {
    const onOpenPalette = vi.fn();
    render(<SoloOnboarding onOpenPalette={onOpenPalette} />);
    fireEvent.click(screen.getByTestId('solo-onboarding-try-palette'));
    expect(onOpenPalette).toHaveBeenCalled();
  });

  it('步骤内容动态更新', () => {
    render(<SoloOnboarding />);
    // 第 1 步
    expect(screen.getByText('输入提示词')).toBeInTheDocument();
    // 跳到第 5 步
    fireEvent.click(screen.getByTestId('solo-onboarding-step-4'));
    expect(screen.getByText('使用右栏工具')).toBeInTheDocument();
  });
});
