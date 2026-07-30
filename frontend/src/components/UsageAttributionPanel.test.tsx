/**
 * UsageAttributionPanel 组件测试 (v1.0.0 Cycle 28 G28-03)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UsageAttributionPanel } from './UsageAttributionPanel';

describe('UsageAttributionPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('打开时显示标题', () => {
    render(<UsageAttributionPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/用量归因/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<UsageAttributionPanel isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="usage-attribution-panel"]')).toBeNull();
  });

  it('点击关闭触发 onClose', () => {
    let closed = false;
    render(<UsageAttributionPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('usage-attribution-close'));
    expect(closed).toBe(true);
  });

  it('添加测试记录', async () => {
    render(<UsageAttributionPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('usage-attribution-add-mock'));
    fireEvent.click(screen.getByTestId('usage-attribution-add-mock'));
    fireEvent.click(screen.getByTestId('usage-attribution-add-mock'));
    await waitFor(() => {
      expect(screen.getByTestId('usage-attribution-content')).toBeTruthy();
    });
  });

  it('导出 JSON 报告', async () => {
    render(<UsageAttributionPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('usage-attribution-add-mock'));
    fireEvent.click(screen.getByTestId('usage-attribution-export'));
    await waitFor(() => {
      expect(screen.getByText(/JSON 报告/)).toBeTruthy();
    });
  });

  it('显示按 Agent 拆分', async () => {
    render(<UsageAttributionPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('usage-attribution-add-mock'));
    await waitFor(() => {
      expect(screen.getByText(/按 Agent 拆分/)).toBeTruthy();
    });
  });
});
