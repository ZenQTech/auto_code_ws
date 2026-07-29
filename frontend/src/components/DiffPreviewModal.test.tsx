/**
 * # ============================================================
 * DiffPreviewModal 单元测试（Cycle 15 P1-8）
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffPreviewModal } from './DiffPreviewModal';

describe('DiffPreviewModal v6.34.0 (P1-8)', () => {
  const OLD = `function hello() {\n  console.log("hi");\n}`;
  const NEW = `function hello() {\n  console.log("hi there");\n  return true;\n}`;

  it('open=false 时不渲染', () => {
    const { container } = render(
      <DiffPreviewModal
        open={false}
        filePath="src/x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('open=true 时渲染模态 + 文件路径', () => {
    render(
      <DiffPreviewModal
        open
        filePath="src/example.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('diff-preview-modal')).toBeInTheDocument();
    expect(screen.getByText('src/example.ts')).toBeInTheDocument();
  });

  it('显示统计：added/removed/equal', () => {
    render(
      <DiffPreviewModal
        open
        filePath="x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('stat-added').textContent).toMatch(/^\+\d+$/);
    expect(screen.getByTestId('stat-removed').textContent).toMatch(/^−\d+$/);
    expect(screen.getByTestId('stat-equal').textContent).toMatch(/^=\d+$/);
  });

  it('默认行级粒度', () => {
    render(
      <DiffPreviewModal
        open
        filePath="x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('granularity-line').getAttribute('aria-selected')).toBe('true');
  });

  it('点击粒度切换', () => {
    render(
      <DiffPreviewModal
        open
        filePath="x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('granularity-word'));
    expect(screen.getByTestId('granularity-word').getAttribute('aria-selected')).toBe('true');
  });

  it('点击 Apply 触发 onApply', () => {
    const onApply = vi.fn();
    render(
      <DiffPreviewModal
        open
        filePath="x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={onApply}
        onCancel={() => {}}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('diff-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('点击 Cancel 触发 onCancel', () => {
    const onCancel = vi.fn();
    render(
      <DiffPreviewModal
        open
        filePath="x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={onCancel}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('diff-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点击 X 触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <DiffPreviewModal
        open
        filePath="x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId('diff-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩触发 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <DiffPreviewModal
        open
        filePath="x.ts"
        oldContent={OLD}
        newContent={NEW}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={onClose}
      />
    );
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('空内容渲染不崩', () => {
    render(
      <DiffPreviewModal
        open
        filePath="empty.ts"
        oldContent=""
        newContent=""
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('diff-preview-modal')).toBeInTheDocument();
  });
});
