/**
 * # ============================================================
 * # PRBotPanel - 组件测试 (v1.0.0 Cycle 25 G25-02)
 * # ============================================================
 * # 核心作用：覆盖 PRBotPanel 的核心交互、状态、事件订阅
 * # 测试维度：
 * #   1. 基础渲染：isOpen=false 不渲染 / isOpen=true 渲染
 * #   2. Bot 启停 + 配置管理
 * #   3. PR 注册 + 列表展示
 * #   4. PR 事件触发：synchronize / reopened / closed
 * #   5. Review 列表与详情
 * #   6. 审计日志 + 清空
 * #   7. 状态导入导出
 * #   8. 快捷键：Esc / Ctrl+N / Ctrl+B
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-02 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PRBotPanel } from './PRBotPanel';
import { resetDefaultPRBotEngine } from '../utils/prBotEngine';

describe('PRBotPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    // 重置 PRBotEngine 单例以避免测试间状态污染
    resetDefaultPRBotEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('不显示（isOpen=false）', () => {
    render(<PRBotPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('pr-bot-panel')).toBeNull();
  });

  it('显示面板与标题（isOpen=true）', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('pr-bot-panel')).toBeTruthy();
    expect(screen.getByText('PR 自动机器人')).toBeTruthy();
    // 默认 bot 启用
    expect(screen.getByText('● 运行中')).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<PRBotPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景关闭面板', () => {
    const onClose = vi.fn();
    render(<PRBotPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('pr-bot-panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击面板内容不触发关闭', () => {
    const onClose = vi.fn();
    render(<PRBotPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('PR 自动机器人'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('注册示例 PR 并自动触发 review', async () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('register-pr-btn'));
    // 等待 review 创建完成
    await waitFor(() => {
      const reviewCards = screen.queryAllByTestId('review-card');
      expect(reviewCards.length).toBeGreaterThan(0);
    });
    // PR 列表应包含 PR #1
    const prList = screen.getByText(/PR 列表 \(/);
    expect(prList.textContent).toContain('1');
  });

  it('点击 PR 展开操作按钮（同步/重开/关闭）', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('register-pr-btn'));
    // 找到 PR 按钮（PR 列表中）
    const prButtons = screen.getAllByRole('button', { name: /#1/ });
    fireEvent.click(prButtons[0]);
    // 应当出现同步/重开/关闭按钮
    expect(screen.getByText(/同步/)).toBeTruthy();
    expect(screen.getByText(/重开/)).toBeTruthy();
    expect(screen.getByText(/关闭/)).toBeTruthy();
  });

  it('停止 Bot', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    const stopBtn = screen.getByText(/停止 Bot/);
    fireEvent.click(stopBtn);
    // 状态应变为"已停止"
    expect(screen.getByText('○ 已停止')).toBeTruthy();
  });

  it('启动 Bot', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    const stopBtn = screen.getByText(/停止 Bot/);
    fireEvent.click(stopBtn);
    const startBtn = screen.getByText(/启动 Bot/);
    fireEvent.click(startBtn);
    expect(screen.getByText('● 运行中')).toBeTruthy();
  });

  it('打开配置弹窗', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    const configBtn = screen.getByText(/^⚙️ 配置$/);
    fireEvent.click(configBtn);
    // 弹窗标题
    expect(screen.getByText('Bot 配置')).toBeTruthy();
    // 配置项
    expect(screen.getByText('自动 Review 触发器')).toBeTruthy();
  });

  it('配置中切换 trigger', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/^⚙️ 配置$/));
    // 找到 closed trigger 的 checkbox
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // 简单测试：找到 trigger 复选框并切换
    const triggerCheckbox = checkboxes.find((cb) => {
      const parent = cb.closest('label');
      return parent?.textContent?.includes('closed');
    });
    expect(triggerCheckbox).toBeDefined();
    const initialChecked = triggerCheckbox!.checked;
    fireEvent.click(triggerCheckbox!);
    expect(triggerCheckbox!.checked).toBe(!initialChecked);
  });

  it('配置中更新 Bot 名称', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/^⚙️ 配置$/));
    const nameInput = screen.getByDisplayValue('Hermes Code Review Bot') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'My Bot' } });
    expect(nameInput.value).toBe('My Bot');
  });

  it('点击 review 显示详情', async () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('register-pr-btn'));
    await waitFor(() => {
      const reviewCards = screen.queryAllByTestId('review-card');
      expect(reviewCards.length).toBeGreaterThan(0);
    });
    const reviewCard = screen.getAllByTestId('review-card')[0];
    fireEvent.click(reviewCard);
    // 详情应展示
    expect(screen.getByTestId('review-body')).toBeTruthy();
  });

  it('清空审计日志', async () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('register-pr-btn'));
    // 等待 audit 增长
    await waitFor(() => {
      expect(screen.getByText(/审计日志 \(\d+\)/)).toBeTruthy();
    });
    // 点击清空
    const clearBtn = screen.getByText('清空');
    fireEvent.click(clearBtn);
    // 审计数变为 0
    expect(screen.getByText(/审计日志 \(0\)/)).toBeTruthy();
  });

  it('重置全部清空 PR 与 reviews', async () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('register-pr-btn'));
    await waitFor(() => {
      expect(screen.getAllByTestId('review-card').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByText(/重置全部/));
    // PR 列表应变为空
    expect(screen.getByText(/PR 列表 \(0\)/)).toBeTruthy();
  });

  it('Esc 快捷键关闭面板', () => {
    const onClose = vi.fn();
    render(<PRBotPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+N 快捷键注册示例 PR', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    // 应出现 PR #1（通过 PR 列表计数判断）
    const prList = screen.getByText(/PR 列表 \(/);
    expect(prList.textContent).toContain('1');
  });

  it('Ctrl+B 快捷键切换 Bot 启停', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    expect(screen.getByText('○ 已停止')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    expect(screen.getByText('● 运行中')).toBeTruthy();
  });

  it('? 快捷键打开帮助', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: '?' });
    // 帮助弹窗中包含"快捷键"标题（H3/H2）
    const heading = screen.getAllByText('快捷键').find(
      (el) => el.tagName === 'H3' || el.tagName === 'H2'
    );
    expect(heading).toBeTruthy();
  });

  it('导入/导出状态（点击导出）', () => {
    // 模拟 URL.createObjectURL
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    const exportBtn = screen.getByText(/^📥 导出状态$/);
    fireEvent.click(exportBtn);
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('Bot 关闭时 PR 事件不触发 review', async () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    // 先停用 bot
    fireEvent.click(screen.getByText(/停止 Bot/));
    // 注册 PR（不会触发 review）
    fireEvent.click(screen.getByTestId('register-pr-btn'));
    // 等待一会儿
    await new Promise((r) => setTimeout(r, 100));
    // reviews 应仍为空
    const reviewCards = screen.queryAllByTestId('review-card');
    expect(reviewCards.length).toBe(0);
  });

  it('显示空 PR 列表提示', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/PR 列表 \(0\)/)).toBeTruthy();
    expect(screen.getByText('无 PR')).toBeTruthy();
  });

  it('显示无 review 提示', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('无 review')).toBeTruthy();
  });

  it('显示审计日志初始为空', () => {
    render(<PRBotPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/审计日志 \(0\)/)).toBeTruthy();
  });
});
