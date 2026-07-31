/**
 * # ============================================================
 * # McpE2EPanel - 单元测试 (v1.0.0 Cycle 43 G43-04)
 * # ============================================================
 * # 覆盖：渲染 / 关闭按钮 / Provider 选择 / 场景列表
 * # ====================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-04 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { McpE2EPanel } from './McpE2EPanel';

describe('McpE2EPanel', () => {
  beforeEach(() => {
    cleanup();
  });

  it('渲染标题和场景列表', () => {
    const onClose = vi.fn();
    render(<McpE2EPanel onClose={onClose} />);
    expect(screen.getByText(/MCP E2E 测试套件/i)).toBeTruthy();
    const allText = document.body.textContent || '';
    expect(allText).toContain('基础对话');
    expect(allText).toContain('单步工具调用');
    expect(allText).toContain('多步工具调用');
    expect(allText).toContain('资源引用');
    expect(allText).toContain('错误恢复');
  });

  it('渲染关闭按钮', () => {
    const onClose = vi.fn();
    render(<McpE2EPanel onClose={onClose} />);
    const closeBtn = screen.getByLabelText('关闭');
    expect(closeBtn).toBeTruthy();
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<McpE2EPanel onClose={onClose} />);
    const closeBtn = screen.getByLabelText('关闭');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('渲染 LLM Provider 选择器', () => {
    const onClose = vi.fn();
    render(<McpE2EPanel onClose={onClose} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('mock');
  });

  it('可以切换 LLM Provider', () => {
    const onClose = vi.fn();
    render(<McpE2EPanel onClose={onClose} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'volcengine' } });
    expect(select.value).toBe('volcengine');
  });

  it('渲染运行按钮', () => {
    const onClose = vi.fn();
    render(<McpE2EPanel onClose={onClose} />);
    expect(screen.getByText(/运行全部场景/)).toBeTruthy();
  });
});
