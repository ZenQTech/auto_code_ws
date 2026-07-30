/**
 * # ============================================================
 * # AgentTemplatePanel 组件测试 (v1.0.0 Cycle 27 G27-05)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { AgentTemplatePanel } from './AgentTemplatePanel';
import { AgentTemplateEngine } from '../utils/agentTemplateEngine';

describe('AgentTemplatePanel', () => {
  let engine: AgentTemplateEngine;

  beforeEach(() => {
    engine = new AgentTemplateEngine({ persist: false });
    // 隐藏 alert
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('打开时显示面板', () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    expect(screen.getByTestId('agent-template-panel')).toBeTruthy();
    expect(screen.getByText(/代理模板/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<AgentTemplatePanel isOpen={false} onClose={() => {}} engine={engine} />);
    expect(container.firstChild).toBeNull();
  });

  it('显示 builtin 模板列表', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    await waitFor(() => {
      expect(screen.getByText(/代码审查专家/)).toBeTruthy();
    });
    expect(screen.getByText(/调试专家/)).toBeTruthy();
  });

  it('切换到市场 Tab', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-market'));
    await waitFor(() => {
      expect(screen.getByText(/React 架构师/)).toBeTruthy();
    });
  });

  it('切换到新建 Tab 显示表单', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-create'));
    await waitFor(() => {
      expect(screen.getByTestId('create-form')).toBeTruthy();
      expect(screen.getByTestId('name-input')).toBeTruthy();
    });
  });

  it('点击模板显示详情', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    await waitFor(() => {
      const item = screen.getByTestId('template-item-builtin-code-reviewer');
      fireEvent.click(item);
    });
    await waitFor(() => {
      expect(screen.getByTestId('template-detail')).toBeTruthy();
    });
  });

  it('搜索过滤模板', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    const search = screen.getByTestId('search-input') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'debug' } });
    await waitFor(() => {
      // debugger 应该出现
      expect(screen.getByText(/调试专家/)).toBeTruthy();
    });
  });

  it('分类过滤', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    const filter = screen.getByTestId('category-filter') as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: 'security' } });
    await waitFor(() => {
      expect(filter.value).toBe('security');
    });
  });

  it('创建用户模板', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-create'));
    await waitFor(() => {
      expect(screen.getByTestId('create-form')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'my-test-agent' } });
    fireEvent.change(screen.getByTestId('display-name-input'), { target: { value: '测试智能体' } });
    fireEvent.change(screen.getByTestId('description-input'), { target: { value: '用于测试' } });
    fireEvent.change(screen.getByTestId('system-prompt-input'), { target: { value: '你是测试' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => {
      expect(engine.getTemplate('user-my-test-agent')).toBeDefined();
    });
  });

  it('创建用户模板时显示错误（非法名称）', async () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-create'));
    await waitFor(() => {
      expect(screen.getByTestId('create-form')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Invalid Name!' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeTruthy();
    });
  });

  it('关闭按钮回调', () => {
    const onClose = vi.fn();
    render(<AgentTemplatePanel isOpen={true} onClose={onClose} engine={engine} />);
    const closeBtn = screen.getByLabelText('关闭');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('点遮罩关闭', () => {
    const onClose = vi.fn();
    render(<AgentTemplatePanel isOpen={true} onClose={onClose} engine={engine} />);
    const overlay = screen.getByTestId('agent-template-panel');
    // 直接点击 overlay 自身
    fireEvent.click(overlay, { target: overlay });
    expect(onClose).toHaveBeenCalled();
  });

  it('显示统计信息', () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} engine={engine} />);
    // 统计信息在 header 中
    const header = screen.getByText(/共 \d+ 个模板/);
    expect(header).toBeTruthy();
  });
});
