/**
 * Composer Integration UI 组件测试 (v6.38.0 Cycle 18 P0-1)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ResolvedReferencesBar } from './ResolvedReferencesBar';
import { RulesStatusBadge } from './RulesStatusBadge';
import { RulesPanel } from './RulesPanel';
import { ReferenceDetailModal } from './ReferenceDetailModal';
import { DEFAULT_RULES, RULES_TEMPLATES } from '../utils/hermesRules';
import type { ResolvedReference, ResolutionError } from '../utils/composerEngine.integration';
import { countRules } from '../utils/composerEngine.integration';

// ============================================================
// ResolvedReferencesBar
// ============================================================

describe('ResolvedReferencesBar', () => {
  const baseResolvedRef: ResolvedReference = {
    raw: '@codebase:auth',
    type: 'codebase',
    value: 'auth',
    state: 'resolved',
    context: {
      type: 'codebase',
      query: 'auth',
      results: [{ filePath: 'src/auth.ts', snippet: 'export const auth = ...', score: 0.9 }],
      resolvedAt: Date.now(),
      source: 'mock',
    },
    resolvedAt: Date.now(),
  };

  it('空引用列表不渲染', () => {
    const { container } = render(<ResolvedReferencesBar references={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('渲染 resolved 引用卡片', () => {
    render(<ResolvedReferencesBar references={[baseResolvedRef]} />);
    expect(screen.getByTestId('resolved-references-bar')).toBeInTheDocument();
    expect(screen.getByTestId('resolved-ref-codebase-auth')).toBeInTheDocument();
  });

  it('显示引用计数', () => {
    render(<ResolvedReferencesBar references={[baseResolvedRef, { ...baseResolvedRef, raw: '@git:log', type: 'git', value: 'log' }]} />);
    expect(screen.getByText('已注入 2 个引用')).toBeInTheDocument();
  });

  it('resolved 状态显示 ✓', () => {
    render(<ResolvedReferencesBar references={[baseResolvedRef]} />);
    const card = screen.getByTestId('resolved-ref-codebase-auth');
    expect(card.getAttribute('data-state')).toBe('resolved');
    expect(within(card).getByText(/已解析/)).toBeInTheDocument();
  });

  it('failed 状态显示 ✗', () => {
    const failedRef: ResolvedReference = {
      ...baseResolvedRef,
      raw: '@codebase:bad',
      value: 'bad',
      state: 'failed',
      error: { type: 'network', message: 'Network error' },
    };
    render(<ResolvedReferencesBar references={[failedRef]} />);
    const card = screen.getByTestId('resolved-ref-codebase-bad');
    expect(card.getAttribute('data-state')).toBe('failed');
    expect(within(card).getByText(/失败/)).toBeInTheDocument();
  });

  it('resolving 状态显示 ⚙️', () => {
    const resolvingRef: ResolvedReference = {
      ...baseResolvedRef,
      state: 'resolving',
    };
    render(<ResolvedReferencesBar references={[resolvingRef]} />);
    expect(within(screen.getByTestId('resolved-ref-codebase-auth')).getByText(/解析中/)).toBeInTheDocument();
  });

  it('点击触发 onReferenceClick', () => {
    const onClick = vi.fn();
    render(<ResolvedReferencesBar references={[baseResolvedRef]} onReferenceClick={onClick} />);
    fireEvent.click(screen.getByTestId('resolved-ref-codebase-auth'));
    expect(onClick).toHaveBeenCalledWith(baseResolvedRef);
  });

  it('显示 git 类型图标', () => {
    const gitRef: ResolvedReference = {
      raw: '@git:log:src/auth.ts',
      type: 'git',
      value: 'log:src/auth.ts',
      state: 'resolved',
      context: {
        type: 'git',
        ref: 'log',
        query: 'log:src/auth.ts',
        data: [
          {
            sha: 'abc123',
            shortSha: 'abc123',
            message: 'init',
            author: 'alice',
            email: 'alice@example.com',
            date: '2026-01-01',
            files: ['src/auth.ts'],
          },
        ],
        resolvedAt: Date.now(),
        source: 'mock',
      },
      resolvedAt: Date.now(),
    };
    render(<ResolvedReferencesBar references={[gitRef]} />);
    expect(screen.getByTestId('resolved-ref-git-log:src/auth.ts')).toBeInTheDocument();
  });

  it('显示 diff 类型', () => {
    const diffRef: ResolvedReference = {
      raw: '@diff:working',
      type: 'diff',
      value: 'working',
      state: 'resolved',
      context: {
        type: 'diff',
        ref: 'working',
        files: [],
        totalAdditions: 10,
        totalDeletions: 5,
        resolvedAt: Date.now(),
        source: 'mock',
      },
      resolvedAt: Date.now(),
    };
    render(<ResolvedReferencesBar references={[diffRef]} />);
    expect(screen.getByTestId('resolved-ref-diff-working')).toBeInTheDocument();
  });

  it('显示错误列表 + 重试按钮', () => {
    const errors: ResolutionError[] = [
      { raw: '@codebase:bad', type: 'codebase', error: 'Network error', timestamp: Date.now() },
    ];
    const onRetry = vi.fn();
    render(<ResolvedReferencesBar references={[]} errors={errors} onRetry={onRetry} />);
    expect(screen.getByTestId('resolved-error-codebase')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('resolved-error-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('compact 模式隐藏 full text', () => {
    render(<ResolvedReferencesBar references={[baseResolvedRef]} compact />);
    // compact 模式下也应该渲染
    expect(screen.getByTestId('resolved-references-bar')).toBeInTheDocument();
  });

  it('显示更多按钮（多于 3 个引用时）', () => {
    const refs = Array.from({ length: 5 }, (_, i) => ({
      ...baseResolvedRef,
      raw: `@codebase:item${i}`,
      value: `item${i}`,
    }));
    render(<ResolvedReferencesBar references={refs} compact />);
    expect(screen.getByTestId('resolved-references-show-more')).toBeInTheDocument();
  });
});

// ============================================================
// RulesStatusBadge
// ============================================================

describe('RulesStatusBadge', () => {
  const baseMetadata = countRules(DEFAULT_RULES);

  it('显示默认规则', () => {
    render(
      <RulesStatusBadge
        metadata={{ ...baseMetadata, isDefault: true }}
        templateName="默认规则"
      />
    );
    expect(screen.getByTestId('rules-status-badge')).toBeInTheDocument();
    expect(screen.getByTestId('rules-status-badge').getAttribute('data-default')).toBe('true');
  });

  it('显示自定义规则', () => {
    render(
      <RulesStatusBadge
        metadata={{ ...baseMetadata, isDefault: false }}
        templateName="TypeScript Strict"
      />
    );
    expect(screen.getByText('TypeScript Strict')).toBeInTheDocument();
  });

  it('显示规则数', () => {
    render(
      <RulesStatusBadge
        metadata={{ ...baseMetadata, isDefault: false }}
        templateName="TS"
      />
    );
    expect(screen.getByText(`(${baseMetadata.total})`)).toBeInTheDocument();
  });

  it('点击触发 onClick', () => {
    const onClick = vi.fn();
    render(
      <RulesStatusBadge
        metadata={{ ...baseMetadata, isDefault: false }}
        templateName="TS"
        onClick={onClick}
      />
    );
    fireEvent.click(screen.getByTestId('rules-status-badge'));
    expect(onClick).toHaveBeenCalled();
  });

  it('compact 模式不显示数量', () => {
    render(
      <RulesStatusBadge
        metadata={{ ...baseMetadata, isDefault: false }}
        templateName="TS"
        compact
      />
    );
    // compact 模式下不应显示 (N)
    expect(screen.queryByText(`(${baseMetadata.total})`)).not.toBeInTheDocument();
  });

  it('isDefault=true 时为灰色', () => {
    render(
      <RulesStatusBadge
        metadata={{ ...baseMetadata, isDefault: true }}
        templateName="默认"
      />
    );
    const badge = screen.getByTestId('rules-status-badge');
    expect(badge.className).toContain('slate');
  });

  it('无 onClick 时不可点击', () => {
    render(
      <RulesStatusBadge
        metadata={{ ...baseMetadata, isDefault: false }}
        templateName="TS"
      />
    );
    const badge = screen.getByTestId('rules-status-badge');
    expect(badge.className).toContain('cursor-default');
  });
});

// ============================================================
// RulesPanel
// ============================================================

describe('RulesPanel', () => {
  it('open=false 不渲染', () => {
    const { container } = render(
      <RulesPanel open={false} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('打开时显示 5 套模板', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    expect(screen.getByTestId(`rules-template-${RULES_TEMPLATES[0].id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`rules-template-${RULES_TEMPLATES[4].id}`)).toBeInTheDocument();
  });

  it('点击模板选中', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    const tpl = RULES_TEMPLATES[0];
    fireEvent.click(screen.getByTestId(`rules-template-${tpl.id}`));
    expect(screen.getByTestId(`rules-template-${tpl.id}`).getAttribute('data-selected')).toBe('true');
  });

  it('字段编辑 - 类型安全', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    const select = screen.getByTestId('rules-edit-type-safety-select');
    fireEvent.change(select, { target: { value: 'strict' } });
    expect((select as HTMLSelectElement).value).toBe('strict');
  });

  it('字段编辑 - 命名规范', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    const select = screen.getByTestId('rules-edit-naming-select');
    fireEvent.change(select, { target: { value: 'snake_case' } });
    expect((select as HTMLSelectElement).value).toBe('snake_case');
  });

  it('YAML 预览切换', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    expect(screen.queryByTestId('rules-yaml-preview')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rules-yaml-toggle'));
    expect(screen.getByTestId('rules-yaml-preview')).toBeInTheDocument();
  });

  it('保存回调触发', () => {
    const onSave = vi.fn();
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={onSave} />
    );
    fireEvent.click(screen.getByTestId('rules-save'));
    expect(onSave).toHaveBeenCalled();
  });

  it('取消回调触发', () => {
    const onClose = vi.fn();
    render(
      <RulesPanel open={true} onClose={onClose} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    fireEvent.click(screen.getByTestId('rules-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('重置按钮', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    fireEvent.click(screen.getByTestId('rules-reset'));
    // 重置后选择最后一个模板
    const lastTpl = RULES_TEMPLATES[RULES_TEMPLATES.length - 1];
    expect(screen.getByTestId(`rules-template-${lastTpl.id}`).getAttribute('data-selected')).toBe('true');
  });

  it('点击背景关闭', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RulesPanel open={true} onClose={onClose} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('data-test-state=valid 当规则有效', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    expect(screen.getByTestId('rules-panel').getAttribute('data-test-state')).toBe('valid');
  });

  it('保存按钮在有效时启用', () => {
    render(
      <RulesPanel open={true} onClose={() => {}} currentRules={DEFAULT_RULES} onSave={() => {}} />
    );
    const saveBtn = screen.getByTestId('rules-save');
    expect(saveBtn).not.toBeDisabled();
  });
});

// ============================================================
// ReferenceDetailModal
// ============================================================

describe('ReferenceDetailModal', () => {
  const codebaseRef: ResolvedReference = {
    raw: '@codebase:auth',
    type: 'codebase',
    value: 'auth',
    state: 'resolved',
    context: {
      type: 'codebase',
      query: 'auth',
      results: [
        { filePath: 'src/auth.ts', snippet: 'export const auth = ...', score: 0.9 },
        { filePath: 'src/auth.test.ts', snippet: 'test("auth", ...)', score: 0.7 },
      ],
      resolvedAt: Date.now(),
      source: 'mock',
    },
    resolvedAt: Date.now(),
  };

  it('open=false 不渲染', () => {
    const { container } = render(
      <ReferenceDetailModal reference={codebaseRef} open={false} onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('reference=null 不渲染', () => {
    const { container } = render(
      <ReferenceDetailModal reference={null} open={true} onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('codebase 详情渲染', () => {
    render(<ReferenceDetailModal reference={codebaseRef} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('ref-detail-codebase')).toBeInTheDocument();
    expect(screen.getByTestId('ref-detail-codebase-result-0')).toBeInTheDocument();
    expect(screen.getByTestId('ref-detail-codebase-result-1')).toBeInTheDocument();
  });

  it('git 详情渲染', () => {
    const gitRef: ResolvedReference = {
      raw: '@git:log:src/auth.ts',
      type: 'git',
      value: 'log:src/auth.ts',
      state: 'resolved',
      context: {
        type: 'git',
        ref: 'log',
        query: 'log:src/auth.ts',
        data: [
          {
            sha: 'abc1234567890',
            shortSha: 'abc1234',
            message: 'init commit',
            author: 'alice',
            email: 'alice@example.com',
            date: '2026-01-01',
            files: ['src/auth.ts'],
          },
        ],
        resolvedAt: Date.now(),
        source: 'mock',
      },
      resolvedAt: Date.now(),
    };
    render(<ReferenceDetailModal reference={gitRef} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('ref-detail-git')).toBeInTheDocument();
    expect(screen.getByTestId('ref-detail-git-item-0')).toBeInTheDocument();
  });

  it('diff 详情渲染', () => {
    const diffRef: ResolvedReference = {
      raw: '@diff:working',
      type: 'diff',
      value: 'working',
      state: 'resolved',
      context: {
        type: 'diff',
        ref: 'working',
        files: [
          { path: 'src/foo.ts', status: 'modified', additions: 5, deletions: 2, hunks: [] },
          { path: 'src/bar.ts', status: 'added', additions: 10, deletions: 0, hunks: [] },
        ],
        totalAdditions: 15,
        totalDeletions: 2,
        resolvedAt: Date.now(),
        source: 'mock',
      },
      resolvedAt: Date.now(),
    };
    render(<ReferenceDetailModal reference={diffRef} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('ref-detail-diff')).toBeInTheDocument();
    expect(screen.getByTestId('ref-detail-diff-file-0')).toBeInTheDocument();
    expect(screen.getByTestId('ref-detail-diff-file-1')).toBeInTheDocument();
  });

  it('failed 状态显示错误', () => {
    const failedRef: ResolvedReference = {
      ...codebaseRef,
      state: 'failed',
      error: { type: 'network', message: 'Connection refused' },
    };
    render(<ReferenceDetailModal reference={failedRef} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('reference-detail-error')).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('resolving 状态显示 loading', () => {
    const ref: ResolvedReference = { ...codebaseRef, state: 'resolving' };
    render(<ReferenceDetailModal reference={ref} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('reference-detail-loading')).toBeInTheDocument();
  });

  it('pending 状态显示等待', () => {
    const ref: ResolvedReference = { ...codebaseRef, state: 'pending' };
    render(<ReferenceDetailModal reference={ref} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('reference-detail-pending')).toBeInTheDocument();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<ReferenceDetailModal reference={codebaseRef} open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('reference-detail-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('点击背景关闭', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ReferenceDetailModal reference={codebaseRef} open={true} onClose={onClose} />
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('data-ref-type 属性正确', () => {
    render(<ReferenceDetailModal reference={codebaseRef} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('reference-detail-modal').getAttribute('data-ref-type')).toBe('codebase');
  });
});
