/**
 * SkillsPanel 组件测试 (v1.0.0 Cycle 28 G28-01)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillsPanel } from './SkillsPanel';
import { resetDefaultSkillEngine } from '../utils/skillEngine';

describe('SkillsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultSkillEngine();
  });

  it('打开时显示标题', () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/技能系统/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<SkillsPanel isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="skills-panel"]')).toBeNull();
  });

  it('默认显示 5 个内置 Skill', async () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('skills-detail-code-review')).toBeTruthy();
      expect(screen.getByTestId('skills-detail-test-generator')).toBeTruthy();
      expect(screen.getByTestId('skills-detail-refactor-assistant')).toBeTruthy();
    });
  });

  it('点击关闭按钮触发 onClose', () => {
    let closed = false;
    render(<SkillsPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('skills-close'));
    expect(closed).toBe(true);
  });

  it('切换到匹配 Tab', async () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('skills-tab-match'));
    expect(screen.getByTestId('skills-match-section')).toBeTruthy();
  });

  it('匹配输入并显示结果', async () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('skills-tab-match'));
    const input = screen.getByTestId('skills-match-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'review 这个 PR' } });
    fireEvent.click(screen.getByTestId('skills-match-btn'));
    await waitFor(() => {
      expect(screen.getByText(/code-review/)).toBeTruthy();
    });
  });

  it('切换到统计 Tab', async () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('skills-tab-stats'));
    expect(screen.getByTestId('skills-stats')).toBeTruthy();
  });

  it('调用 Skill 显示结果', async () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('skills-invoke-code-review'));
    await waitFor(() => {
      expect(screen.getByText(/最近调用结果/)).toBeTruthy();
    });
  });

  it('禁用/启用 Skill', async () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    const btn = screen.getByTestId('skills-toggle-code-review');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId('skills-toggle-code-review').textContent).toContain('启用');
    });
  });

  it('点击详情显示模态框', async () => {
    render(<SkillsPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('skills-detail-code-review'));
    expect(screen.getByTestId('skills-detail-modal')).toBeTruthy();
  });
});
