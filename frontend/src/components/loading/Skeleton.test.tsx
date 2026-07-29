/**
 * # ============================================================
 * Skeleton 单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonGroup } from './Skeleton';

describe('Skeleton', () => {
  it('默认渲染 text 形态骨架', () => {
    render(<Skeleton />);
    const skel = screen.getByTestId('skeleton');
    expect(skel).toBeTruthy();
    expect(skel.getAttribute('data-variant')).toBe('text');
  });

  it('circle 形态使用 9999px borderRadius', () => {
    render(<Skeleton variant="circle" />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.getAttribute('data-variant')).toBe('circle');
    expect(skel.style.borderRadius).toBe('9999px');
  });

  it('rect 形态应用矩形', () => {
    render(<Skeleton variant="rect" />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.getAttribute('data-variant')).toBe('rect');
  });

  it('rounded 形态', () => {
    render(<Skeleton variant="rounded" />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.getAttribute('data-variant')).toBe('rounded');
  });

  it('自定义 width/height 生效', () => {
    render(<Skeleton width="200px" height="40px" />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.style.width).toBe('200px');
    expect(skel.style.height).toBe('40px');
  });

  it('size=lg 预设尺寸生效', () => {
    render(<Skeleton size="lg" />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.style.width).toBe('300px');
  });

  it('animated=false 时使用静态背景', () => {
    render(<Skeleton animated={false} />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.getAttribute('data-animated')).toBe('false');
    expect(skel.className).toContain('bg-surface-200/60');
    expect(skel.className).not.toContain('skeleton');
  });

  it('animated=true 时使用 .skeleton class', () => {
    render(<Skeleton animated />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.className).toContain('skeleton');
  });

  it('aria-hidden=true 用于辅助技术', () => {
    render(<Skeleton />);
    const skel = screen.getByTestId('skeleton');
    expect(skel.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SkeletonGroup', () => {
  it('count=3 渲染 3 条', () => {
    render(<SkeletonGroup count={3} />);
    const group = screen.getByTestId('skeleton-group');
    expect(group).toBeTruthy();
    expect(screen.getByTestId('skeleton-group-item-0')).toBeTruthy();
    expect(screen.getByTestId('skeleton-group-item-1')).toBeTruthy();
    expect(screen.getByTestId('skeleton-group-item-2')).toBeTruthy();
  });

  it('items 自定义参数生效', () => {
    render(
      <SkeletonGroup
        items={[
          { variant: 'circle', width: '40px' },
          { variant: 'text' },
        ]}
        testIdPrefix="custom-group"
      />
    );
    expect(screen.getByTestId('custom-group-item-0')).toBeTruthy();
    expect(screen.getByTestId('custom-group-item-1')).toBeTruthy();
  });

  it('默认 count=3', () => {
    render(<SkeletonGroup />);
    expect(screen.getByTestId('skeleton-group-item-0')).toBeTruthy();
    expect(screen.getByTestId('skeleton-group-item-2')).toBeTruthy();
  });

  it('应用自定义 className', () => {
    render(<SkeletonGroup className="custom-class" />);
    const group = screen.getByTestId('skeleton-group');
    expect(group.className).toContain('custom-class');
  });
});
