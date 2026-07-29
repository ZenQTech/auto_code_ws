/**
 * RulesEditor 组件测试 (v6.39.0 Cycle 18 G18-02)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RulesEditor } from './RulesEditor';

describe('RulesEditor 组件 (Cycle 18 G18-02)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  it('应该正确渲染', async () => {
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('rules-editor')).toBeInTheDocument();
    });
  });

  it('应该在 isOpen=false 时不渲染', () => {
    const { container } = render(
      <RulesEditor
        projectId="test-project"
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('应该显示 5 个模板', async () => {
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('rules-template-typescript_strict')).toBeInTheDocument();
      expect(screen.getByTestId('rules-template-python_pep8')).toBeInTheDocument();
      expect(screen.getByTestId('rules-template-react_best')).toBeInTheDocument();
      expect(screen.getByTestId('rules-template-vue_best')).toBeInTheDocument();
      expect(screen.getByTestId('rules-template-generic')).toBeInTheDocument();
    });
  });

  it('应该切换到 YAML tab', async () => {
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('rules-tab-yaml')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('rules-tab-yaml'));
    expect(screen.getByTestId('rules-yaml-editor')).toBeInTheDocument();
  });

  it('应该应用模板', async () => {
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('rules-template-typescript_strict')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('rules-template-typescript_strict'));
    await waitFor(() => {
      // 验证 type_safety 改变
      const select = screen.getByTestId('rule-type-safety') as HTMLSelectElement;
      expect(select.value).toBe('strict');
    });
  });

  it('应该添加自定义规则', async () => {
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('custom-rule-input')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('custom-rule-input'), {
      target: { value: '新规则 1' },
    });
    fireEvent.click(screen.getByTestId('custom-rule-add'));
    await waitFor(() => {
      expect(screen.getByText('新规则 1')).toBeInTheDocument();
    });
  });

  it('应该删除自定义规则', async () => {
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={vi.fn() as any}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('custom-rule-input')).toBeInTheDocument();
    });
    // 添加
    fireEvent.change(screen.getByTestId('custom-rule-input'), {
      target: { value: 'to delete' },
    });
    fireEvent.click(screen.getByTestId('custom-rule-add'));
    await waitFor(() => {
      expect(screen.getByText('to delete')).toBeInTheDocument();
    });
    // 删除
    fireEvent.click(screen.getByTestId('custom-rule-remove-0'));
    await waitFor(() => {
      expect(screen.queryByText('to delete')).not.toBeInTheDocument();
    });
  });

  it('应该点击关闭按钮', async () => {
    const onClose = vi.fn();
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={true}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('rules-editor-close')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('rules-editor-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('应该更新 type_safety', async () => {
    render(
      <RulesEditor
        projectId="test-project"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('rule-type-safety')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('rule-type-safety'), {
      target: { value: 'loose' },
    });
    const select = screen.getByTestId('rule-type-safety') as HTMLSelectElement;
    expect(select.value).toBe('loose');
  });
});
