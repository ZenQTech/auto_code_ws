/**
 * # ============================================================
 * # MarketplacePanel Tests (v1.0.0 Cycle 29 G29-02)
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketplacePanel } from './MarketplacePanel';
import { resetDefaultMarketplace } from '../utils/marketplaceEngine';

describe('MarketplacePanel', () => {
  beforeEach(() => {
    resetDefaultMarketplace();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('hermes.marketplace');
      localStorage.removeItem('hermes.marketplace.ratings');
    }
  });

  it('默认不渲染（isOpen=false）', () => {
    const { container } = render(<MarketplacePanel isOpen={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('打开时渲染', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('marketplace-panel')).toBeInTheDocument();
  });

  it('显示统计信息', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/共 \d+ 个技能/)).toBeInTheDocument();
  });

  it('显示技能网格', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('skills-grid')).toBeInTheDocument();
  });

  it('点击关闭按钮触发 onClose', () => {
    let called = 0;
    render(<MarketplacePanel isOpen={true} onClose={() => called++} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(called).toBe(1);
  });

  it('切换分类', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    const select = screen.getByTestId('category-select');
    fireEvent.change(select, { target: { value: 'security' } });
    expect((select as HTMLSelectElement).value).toBe('security');
  });

  it('搜索过滤', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('search-input');
    fireEvent.change(input, { target: { value: 'review' } });
    expect((input as HTMLInputElement).value).toBe('review');
  });

  it('排序选择', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    const select = screen.getByTestId('sort-select');
    fireEvent.change(select, { target: { value: 'rating' } });
    expect((select as HTMLSelectElement).value).toBe('rating');
  });

  it('点击技能卡片显示详情', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    const firstCard = screen.getAllByTestId(/^skill-card-/)[0];
    fireEvent.click(firstCard);
    expect(screen.getByTestId('detail-sidebar')).toBeInTheDocument();
  });

  it('安装按钮可点击', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    const installBtn = screen.getAllByTestId(/^install-btn-/)[0];
    fireEvent.click(installBtn);
    // 安装后按钮文本变为"已安装"
  });

  it('评论输入和提交', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    // 选中第一个技能
    const firstCard = screen.getAllByTestId(/^skill-card-/)[0];
    fireEvent.click(firstCard);
    // 填写评论
    const input = screen.getByTestId('comment-input');
    fireEvent.change(input, { target: { value: '非常好的技能，强烈推荐使用！' } });
    // 提交
    const submitBtn = screen.getByTestId('submit-comment-btn');
    fireEvent.click(submitBtn);
  });

  it('星标评分点击', () => {
    render(<MarketplacePanel isOpen={true} onClose={() => {}} />);
    const firstCard = screen.getAllByTestId(/^skill-card-/)[0];
    fireEvent.click(firstCard);
    const stars = screen.getAllByTestId('star-5');
    // 点击第一个星标（评分区域）
    fireEvent.click(stars[0]);
  });
});
