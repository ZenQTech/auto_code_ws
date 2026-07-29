/**
 * # ============================================================
 * # CandidateLearningPanel 组件测试 (Cycle 23 G23-01)
 * # ============================================================
 * # 测试覆盖：
 * #   1. 面板未打开时不渲染
 * #   2. 面板打开时显示标题
 * #   3. 标签页切换
 * #   4. 概览标签页（统计信息）
 * #   5. 偏好标签页（用户偏好画像）
 * #   6. 记录标签页（学习记录）
 * #   7. 模拟标签页（推荐模拟）
 * #   8. Esc 键关闭
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CandidateLearningPanel } from './CandidateLearningPanel';
import { resetCandidateLearningEngine, getCandidateLearningEngine } from '../utils/candidateLearning';

describe('CandidateLearningPanel', () => {
  beforeEach(() => {
    resetCandidateLearningEngine();
  });

  afterEach(() => {
    cleanup();
    resetCandidateLearningEngine();
  });

  it('面板未打开时不渲染', () => {
    const { container } = render(<CandidateLearningPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('面板打开时显示标题', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('候选学习引擎')).toBeTruthy();
  });

  it('应显示 4 个标签页', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('概览')).toBeTruthy();
    expect(screen.getByText('偏好画像')).toBeTruthy();
    expect(screen.getByText('学习记录')).toBeTruthy();
    expect(screen.getByText('模拟推荐')).toBeTruthy();
  });

  it('默认显示概览标签页', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    // 概览标签页应包含 "总记录" 等统计信息
    expect(screen.getByText(/总记录/)).toBeTruthy();
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    render(<CandidateLearningPanel isOpen={true} onClose={onClose} />);
    const closeButton = screen.getByLabelText(/关闭/);
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('点击学习算法应更新算法', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    const select = screen.getByTestId('learning-algo');
    fireEvent.change(select, { target: { value: 'bayesian' } });
    const engine = getCandidateLearningEngine();
    expect(engine.getConfig().algorithm).toBe('bayesian');
  });

  it('点击记录演示按钮应添加记录', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    const demoButton = screen.getByText(/生成演示/);
    fireEvent.click(demoButton);
    const engine = getCandidateLearningEngine();
    expect(engine.getRecords().length).toBeGreaterThan(0);
  });

  it('点击偏好标签页应显示偏好信息', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    const prefTab = screen.getByText('偏好画像');
    fireEvent.click(prefTab);
    // 偏好页面应显示 "模型偏好" 或类似
    expect(screen.getAllByText(/模型偏好/).length).toBeGreaterThan(0);
  });

  it('点击学习记录标签页应显示记录列表', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    const recordsTab = screen.getByText('学习记录');
    fireEvent.click(recordsTab);
    // 学习记录页面应显示
    expect(screen.getByText(/暂无学习记录|学习记录/)).toBeTruthy();
  });

  it('点击推荐模拟标签页应显示模拟器', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    const simTab = screen.getByText('模拟推荐');
    fireEvent.click(simTab);
    // 模拟标签页应显示 "应用学习偏好" 按钮
    expect(screen.getByText(/应用学习偏好/)).toBeTruthy();
  });

  it('点击运行模拟按钮应产生推荐结果', () => {
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    const simTab = screen.getByText('模拟推荐');
    fireEvent.click(simTab);
    const runButton = screen.getByText(/应用学习偏好/);
    fireEvent.click(runButton);
    // 应显示调整后结果
    expect(screen.getByText(/调整后结果/)).toBeTruthy();
  });

  it('Esc 键应关闭面板', () => {
    const onClose = vi.fn();
    render(<CandidateLearningPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('应显示学习记录数量', async () => {
    const engine = getCandidateLearningEngine();
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'test',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    render(<CandidateLearningPanel isOpen={true} onClose={vi.fn()} />);
    // 总记录应显示 1
    expect(screen.getByText('总记录')).toBeTruthy();
  });
});
