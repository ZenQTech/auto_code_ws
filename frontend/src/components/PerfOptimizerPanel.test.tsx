/**
 * # ============================================================
 * # PerfOptimizerPanel - 组件测试 (v1.0.0 Cycle 25 G25-03)
 * # ============================================================
 * # 核心作用：覆盖 PerfOptimizerPanel 的核心交互、状态、事件订阅
 * # 测试维度：
 * #   1. 基础渲染：isOpen=false 不渲染 / isOpen=true 渲染
 * #   2. 性能预算配置
 * #   3. 文件加载（示例 / 上传）
 * #   4. 扫描执行 + 报告展示
 * #   5. 严重度筛选
 * #   6. 报告导出（JSON / Markdown / Patch）
 * #   7. 快捷键：Esc / Ctrl+R / Ctrl+L / Ctrl+E / Ctrl+P
 * #   8. 预算面板折叠/展开
 * #   9. localStorage 持久化
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-03 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PerfOptimizerPanel } from './PerfOptimizerPanel';
import { resetDefaultPerfEngine } from '../utils/perfOptimizer';

describe('PerfOptimizerPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    // 重置 PerfOptimizerEngine 单例以避免测试间状态污染
    resetDefaultPerfEngine();
    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('不显示（isOpen=false）', () => {
    render(<PerfOptimizerPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('perf-optimizer-panel')).toBeNull();
  });

  it('显示面板与标题（isOpen=true）', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('perf-optimizer-panel')).toBeTruthy();
    expect(screen.getByText('AI 性能优化器')).toBeTruthy();
    expect(screen.getByText(/规则库: \d+ 条/)).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<PerfOptimizerPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景关闭面板', () => {
    const onClose = vi.fn();
    render(<PerfOptimizerPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('perf-optimizer-panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击面板内容不触发关闭', () => {
    const onClose = vi.fn();
    render(<PerfOptimizerPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('AI 性能优化器'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('加载示例文件', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('示例'));
    // 文件应展示
    const fileSection = screen.getByText(/文件 \(\d+\)/);
    expect(fileSection.textContent).toContain('2');
  });

  it('无文件时扫描按钮被禁用', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const scanBtn = screen.getByTestId('run-scan-btn');
    expect(scanBtn).toHaveProperty('disabled', true);
  });

  it('执行扫描并展示评分卡', async () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('示例'));
    fireEvent.click(screen.getByTestId('run-scan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('score-card')).toBeTruthy();
    });
  });

  it('更新 maxRenderMs 预算', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    expect(input.value).toBe('20');
  });

  it('更新 maxStatePerComponent 预算', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    const input = inputs[1] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    expect(input.value).toBe('3');
  });

  it('更新 minKeyStability 预算', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    const input = inputs[2] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.8' } });
    expect(input.value).toBe('0.8');
  });

  it('更新 maxComponentLines 预算', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    const input = inputs[3] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });
    expect(input.value).toBe('100');
  });

  it('更新 maxUnnecessaryMemo 预算', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    const input = inputs[4] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });
    expect(input.value).toBe('1');
  });

  it('更新 maxBundleSize 预算', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    const input = inputs[5] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '200' } });
    expect(input.value).toBe('200');
  });

  it('折叠/展开预算面板', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const toggleBtn = screen.getByText('▼');
    fireEvent.click(toggleBtn);
    // 展开按钮出现
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('展示统计信息', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/Scans:/)).toBeTruthy();
    expect(screen.getByText(/Suggestions:/)).toBeTruthy();
    expect(screen.getByText(/Rules:/)).toBeTruthy();
  });

  it('扫描后导出 Markdown', async () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('示例'));
    fireEvent.click(screen.getByTestId('run-scan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('score-card')).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/^📋 Markdown$/));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('扫描后导出 Patch', async () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('示例'));
    fireEvent.click(screen.getByTestId('run-scan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('score-card')).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/^🩹 Patch$/));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('扫描后导出 JSON', async () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('示例'));
    fireEvent.click(screen.getByTestId('run-scan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('score-card')).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/^📦 JSON$/));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('严重度筛选 high', async () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('示例'));
    fireEvent.click(screen.getByTestId('run-scan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('score-card')).toBeTruthy();
    });
    // 严重度筛选
    const filterSelect = Array.from(document.querySelectorAll('select')).find(
      (s) => Array.from(s.options).some((o) => o.value === 'high')
    ) as HTMLSelectElement | undefined;
    expect(filterSelect).toBeDefined();
    fireEvent.change(filterSelect!, { target: { value: 'high' } });
    expect(filterSelect!.value).toBe('high');
  });

  it('显示空状态（无报告时）', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('等待扫描')).toBeTruthy();
    expect(screen.getByText('无建议')).toBeTruthy();
  });

  it('扫描后显示模式分布', async () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('示例'));
    fireEvent.click(screen.getByTestId('run-scan-btn'));
    await waitFor(() => {
      expect(screen.getByText(/By Pattern/)).toBeTruthy();
    });
  });

  it('Esc 快捷键关闭面板', () => {
    const onClose = vi.fn();
    render(<PerfOptimizerPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+L 快捷键加载示例', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'l', ctrlKey: true });
    const fileSection = screen.getByText(/文件 \(\d+\)/);
    expect(fileSection.textContent).toContain('2');
  });

  it('? 快捷键打开帮助', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: '?' });
    // 帮助弹窗中包含"快捷键"标题
    const heading = screen.getAllByText('快捷键').find(
      (el) => el.tagName === 'H3' || el.tagName === 'H2'
    );
    expect(heading).toBeTruthy();
  });

  it('localStorage 持久化预算设置', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    const stored = localStorage.getItem('hermes.perfOptimizerPanel');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.budget.maxRenderMs).toBe(20);
  });

  it('从 localStorage 恢复预算', () => {
    localStorage.setItem(
      'hermes.perfOptimizerPanel',
      JSON.stringify({
        budget: { maxRenderMs: 10, maxStatePerComponent: 2 },
        showBudget: true,
      })
    );
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('10');
  });

  it('显示空文件提示', () => {
    render(<PerfOptimizerPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('无文件')).toBeTruthy();
  });
});
