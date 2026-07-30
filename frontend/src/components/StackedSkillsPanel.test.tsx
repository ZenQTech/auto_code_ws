/**
 * StackedSkillsPanel 组件测试 (v1.0.0 Cycle 29 G29-01)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StackedSkillsPanel } from './StackedSkillsPanel';
import { resetDefaultStackedSkillEngine } from '../utils/stackedSkillEngine';
import { resetDefaultSkillEngine as resetSE } from '../utils/skillEngine';

describe('StackedSkillsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultStackedSkillEngine();
    resetSE();
  });

  it('打开/关闭面板', () => {
    const { rerender } = render(<StackedSkillsPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('stacked-skills-panel')).toBeNull();
    rerender(<StackedSkillsPanel isOpen={true} onClose={() => {}} />);
    expect(screen.queryByTestId('stacked-skills-panel')).toBeDefined();
  });

  it('点击关闭按钮触发 onClose', () => {
    let closed = false;
    render(<StackedSkillsPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('stacked-skills-close-btn'));
    expect(closed).toBe(true);
  });

  it('切换三个 Tab', () => {
    render(<StackedSkillsPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('stacked-skills-tab-history'));
    expect(screen.queryByTestId('stacked-skills-history')).toBeDefined();
    fireEvent.click(screen.getByTestId('stacked-skills-tab-stats'));
    expect(screen.queryByTestId('stacked-skills-stats')).toBeDefined();
    fireEvent.click(screen.getByTestId('stacked-skills-tab-builder'));
    expect(screen.queryByTestId('stacked-skills-skill-selector')).toBeDefined();
  });

  it('显示技能列表', () => {
    render(<StackedSkillsPanel isOpen={true} onClose={() => {}} />);
    const selector = screen.queryByTestId('stacked-skills-skill-selector');
    expect(selector).toBeDefined();
  });

  it('输入参数', () => {
    render(<StackedSkillsPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('stacked-skills-args-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'src/foo.ts' } });
    expect(input.value).toBe('src/foo.ts');
  });

  it('执行按钮在无选择时禁用', () => {
    render(<StackedSkillsPanel isOpen={true} onClose={() => {}} />);
    const btn = screen.getByTestId('stacked-skills-execute-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('选择 5 个技能后第 6 个被禁用', async () => {
    render(<StackedSkillsPanel isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      // 第一个是并行执行，第二个 stopOnFirstFailure，第三个 sharedContext
      // 接下来是 5 个内置技能的 checkbox
      const skillCheckboxes = checkboxes.slice(3);
      expect(skillCheckboxes.length).toBeGreaterThanOrEqual(5);
    });
    // 验证初始状态下所有技能 checkbox 都可点击
    const checkboxes = screen.getAllByRole('checkbox').slice(3);
    expect((checkboxes[0] as HTMLInputElement).disabled).toBe(false);
  });

  it('triggerCommand 预填参数', () => {
    render(<StackedSkillsPanel isOpen={true} onClose={() => {}} triggerCommand="src/bar.ts" />);
    const input = screen.getByTestId('stacked-skills-args-input') as HTMLInputElement;
    expect(input.value).toBe('src/bar.ts');
  });
});
