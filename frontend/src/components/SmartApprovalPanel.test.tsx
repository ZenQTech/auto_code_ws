/**
 * # ============================================================
 * # SmartApprovalPanel - 组件测试 (v1.0.0 Cycle 26 G26-02)
 * # ============================================================
 * # 核心作用：覆盖 SmartApprovalPanel 的核心交互、状态、事件订阅
 * # 测试维度：
 * #   1. 基础渲染：isOpen=false 不渲染 / isOpen=true 渲染
 * #   2. Tab 切换：rules/sandbox/audit
 * #   3. 规则管理：新增/删除/切换/过滤
 * #   4. 沙盒测试：输入命令 -> 查看决策
 * #   5. 审计日志：查看/导出/清空
 * #   6. 快捷键：Esc / Ctrl+N / Ctrl+T / Ctrl+E / Ctrl+1/2/3
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-02 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SmartApprovalPanel } from './SmartApprovalPanel';
import { resetDefaultSmartApprovalEngine } from '../utils/smartApprovalEngine';

describe('SmartApprovalPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultSmartApprovalEngine();
    if (!URL.createObjectURL) {
      (URL as any).createObjectURL = vi.fn().mockReturnValue('blob:test');
    }
    if (!URL.revokeObjectURL) {
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('不显示（isOpen=false）', () => {
    render(<SmartApprovalPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('smart-approval-panel')).toBeNull();
  });

  it('显示面板与标题（isOpen=true）', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('smart-approval-panel')).toBeTruthy();
    expect(screen.getByText('智能审批引擎')).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<SmartApprovalPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景关闭面板', () => {
    const onClose = vi.fn();
    render(<SmartApprovalPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('smart-approval-panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击面板内容不触发关闭', () => {
    const onClose = vi.fn();
    render(<SmartApprovalPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('智能审批引擎'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('默认显示规则 Tab', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/规则管理 \(/)).toBeTruthy();
  });

  it('显示内置规则', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    // 内置规则包括 "禁止 rm -rf"
    expect(screen.getByText('禁止 rm -rf')).toBeTruthy();
    expect(screen.getByText('禁止 sudo')).toBeTruthy();
  });

  it('切换到沙盒 Tab', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-sandbox'));
    await waitFor(() => {
      expect(screen.getByText(/测试操作请求/)).toBeTruthy();
    });
  });

  it('切换到审计 Tab', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-audit'));
    await waitFor(() => {
      expect(screen.getByText(/共 \d+ 条审计记录/)).toBeTruthy();
    });
  });

  it('添加新规则', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('add-rule-btn'));
    expect(screen.getByTestId('add-rule-dialog')).toBeTruthy();

    fireEvent.change(screen.getByTestId('new-rule-name'), { target: { value: '测试规则' } });
    fireEvent.change(screen.getByTestId('new-rule-match-value'), { target: { value: 'dangerous-cmd' } });
    fireEvent.click(screen.getByTestId('confirm-add-rule'));
    // 规则应出现在列表中
    expect(screen.getByText('测试规则')).toBeTruthy();
  });

  it('过滤系统/用户规则', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    const filter = screen.getByTestId('rule-filter') as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: 'system' } });
    expect(filter.value).toBe('system');
  });

  it('切换规则启用状态', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    const toggles = screen.getAllByTestId('rule-toggle') as HTMLInputElement[];
    const first = toggles[0];
    const initial = first.checked;
    fireEvent.click(first);
    expect(first.checked).toBe(!initial);
  });

  it('点击删除按钮弹出确认', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    const deletes = screen.getAllByTestId('rule-delete');
    fireEvent.click(deletes[0]);
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('沙盒测试 - rm -rf 应被阻断', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-sandbox'));
    await waitFor(() => {
      expect(screen.getByTestId('test-payload')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('test-payload'), { target: { value: 'rm -rf /tmp' } });
    fireEvent.click(screen.getByTestId('test-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeTruthy();
      expect(screen.getByText(/阻断/)).toBeTruthy();
    });
  });

  it('沙盒测试 - git status 应被放行', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-sandbox'));
    await waitFor(() => {
      expect(screen.getByTestId('test-payload')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('test-payload'), { target: { value: 'git status' } });
    fireEvent.click(screen.getByTestId('test-btn'));
    await waitFor(() => {
      expect(screen.getByText(/放行/)).toBeTruthy();
    });
  });

  it('点击样本命令自动测试', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-sandbox'));
    await waitFor(() => {
      expect(screen.getAllByTestId('sample-cmd').length).toBeGreaterThan(0);
    });
    const samples = screen.getAllByTestId('sample-cmd');
    fireEvent.click(samples[0]);
    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeTruthy();
    });
  });

  it('审计日志显示请求记录', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    // 先在沙盒测试触发
    fireEvent.click(screen.getByTestId('tab-sandbox'));
    await waitFor(() => {
      expect(screen.getByTestId('test-payload')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('test-payload'), { target: { value: 'rm -rf /tmp' } });
    fireEvent.click(screen.getByTestId('test-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeTruthy();
    });
    // 然后查看审计
    fireEvent.click(screen.getByTestId('tab-audit'));
    await waitFor(() => {
      expect(screen.getByText(/共 \d+ 条审计记录/)).toBeTruthy();
      expect(screen.getAllByTestId('audit-log-item').length).toBeGreaterThan(0);
    });
  });

  it('导出审计日志', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-audit'));
    fireEvent.click(screen.getByTestId('export-audit-btn'));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('Esc 关闭面板', () => {
    const onClose = vi.fn();
    render(<SmartApprovalPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+N 打开新增规则', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(screen.getByTestId('add-rule-dialog')).toBeTruthy();
  });

  it('Ctrl+T 切换到沙盒', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText(/测试操作请求/)).toBeTruthy();
    });
  });

  it('Ctrl+1/2/3 切换 Tab', async () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText(/测试操作请求/)).toBeTruthy();
    });
    fireEvent.keyDown(document.body, { key: '3', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText(/共 \d+ 条审计记录/)).toBeTruthy();
    });
    fireEvent.keyDown(document.body, { key: '1', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText(/规则管理 \(/)).toBeTruthy();
    });
  });

  it('? 显示帮助', () => {
    render(<SmartApprovalPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByText('⌨️ 快捷键')).toBeTruthy();
  });
});
