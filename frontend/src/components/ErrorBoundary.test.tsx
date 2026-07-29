/**
 * # ============================================================
 * ErrorBoundary 单元测试（v1.1.0 P2-4）
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary, { withErrorBoundary } from './ErrorBoundary';

const ThrowingComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error('test error');
  return <div>正常内容</div>;
};

describe('ErrorBoundary', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('正常渲染子组件', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('正常内容')).toBeTruthy();
  });

  it('子组件抛错时显示默认 fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('test error')).toBeTruthy();
    expect(screen.getByText('页面出现错误')).toBeTruthy();
  });

  it('点击重试按钮存在', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('error-boundary-reset')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
  });

  it('ReactNode 形式 fallback', () => {
    render(
      <ErrorBoundary fallback={<div>自定义错误</div>}>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('自定义错误')).toBeTruthy();
  });

  it('render prop 形式 fallback', () => {
    render(
      <ErrorBoundary
        fallback={(err, reset) => (
          <div>
            <span>Render prop 错误: {err.message}</span>
            <button onClick={reset}>重试</button>
          </div>
        )}
      >
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Render prop 错误: test error')).toBeTruthy();
  });

  it('onError 回调被触发', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, errorInfo] = onError.mock.calls[0];
    expect(error.message).toBe('test error');
    expect(errorInfo.componentStack).toBeDefined();
  });

  it('level=top 显示"页面出现错误"', () => {
    const { container } = render(
      <ErrorBoundary level="top">
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(container.querySelector('[data-level="top"]')).toBeTruthy();
  });

  it('level=panel 显示"面板加载失败"', () => {
    render(
      <ErrorBoundary level="panel">
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('面板加载失败')).toBeTruthy();
  });

  it('level=component 显示"组件渲染错误"且无刷新按钮', () => {
    render(
      <ErrorBoundary level="component">
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('组件渲染错误')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-reload')).toBeNull();
  });

  it('错误计数累计', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    // 重新触发
    rerender(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('test error')).toBeTruthy();
  });

  it('name 字段用于日志', () => {
    render(
      <ErrorBoundary name="TestBoundary">
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('withErrorBoundary HOC', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('包装组件正常渲染', () => {
    const Wrapped = withErrorBoundary(ThrowingComponent);
    render(<Wrapped shouldThrow={false} />);
    expect(screen.getByText('正常内容')).toBeTruthy();
  });

  it('包装组件抛错时显示 fallback', () => {
    const Wrapped = withErrorBoundary(ThrowingComponent);
    render(<Wrapped shouldThrow />);
    expect(screen.getByText('test error')).toBeTruthy();
  });

  it('displayName 正确设置', () => {
    const Original = () => <div>test</div>;
    Original.displayName = 'MyComponent';
    const Wrapped = withErrorBoundary(Original);
    expect(Wrapped.displayName).toBe('withErrorBoundary(MyComponent)');
  });

  it('无 displayName 时使用 Component 名称', () => {
    const Original = function AnonymousComp() { return <div>test</div>; };
    const Wrapped = withErrorBoundary(Original);
    expect(Wrapped.displayName).toBe('withErrorBoundary(AnonymousComp)');
  });
});
