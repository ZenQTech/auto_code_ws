/**
 * # ============================================================
 * PlanViewer 组件测试 (v6.37.0 Cycle 17 P0-1)
 * # ============================================================
 * 核心作用：验证 PlanViewer 组件渲染与交互
 * 测试覆盖：14 个测试
 *   - 空状态 (2)
 *   - 加载/执行/完成/拒绝状态 (4)
 *   - 计划展示 (8)
 * ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanViewer } from './PlanViewer';
import type { Plan } from '../utils/composerEngine.plan';

const samplePlan: Plan = {
  id: 'p1',
  prompt: 'test prompt',
  summary: '修改 2 个文件',
  steps: [
    {
      id: 's1',
      filePath: 'src/a.ts',
      operation: 'modify',
      description: '在 a.ts 中添加新功能',
      estimatedLines: 10,
      riskLevel: 'low',
      status: 'pending',
    },
    {
      id: 's2',
      filePath: 'src/b.ts',
      operation: 'create',
      description: '创建 b.ts',
      estimatedLines: 20,
      riskLevel: 'medium',
      status: 'pending',
    },
  ],
  estimatedDurationMs: 1000,
  totalLines: 30,
  riskAssessment: '整体风险可控',
  createdAt: Date.now(),
};

const baseHandlers = {
  onApproveStep: vi.fn(),
  onRejectStep: vi.fn(),
  onModifyStep: vi.fn(),
  onApproveAll: vi.fn(),
  onRejectAll: vi.fn(),
  onApprovePlan: vi.fn(),
  onRejectPlan: vi.fn(),
  onExecutePlan: vi.fn(),
  onClose: vi.fn(),
};

describe('PlanViewer - 空状态', () => {
  it('plan 为 null 时显示空状态', () => {
    render(<PlanViewer plan={null} stage="idle" {...baseHandlers} />);
    expect(screen.getByTestId('plan-viewer-empty')).toBeInTheDocument();
  });

  it('空状态文案正确', () => {
    render(<PlanViewer plan={null} stage="idle" {...baseHandlers} />);
    expect(screen.getByText('暂无计划')).toBeInTheDocument();
  });
});

describe('PlanViewer - 状态视图', () => {
  it('analyzing 状态显示加载', () => {
    render(<PlanViewer plan={null} stage="analyzing" {...baseHandlers} />);
    expect(screen.getByTestId('plan-viewer-analyzing')).toBeInTheDocument();
  });

  it('executing 状态显示执行中', () => {
    render(<PlanViewer plan={null} stage="executing" {...baseHandlers} />);
    expect(screen.getByTestId('plan-viewer-executing')).toBeInTheDocument();
  });

  it('completed 状态显示完成', () => {
    render(<PlanViewer plan={samplePlan} stage="completed" {...baseHandlers} />);
    expect(screen.getByTestId('plan-viewer-completed')).toBeInTheDocument();
  });

  it('rejected 状态显示已拒绝', () => {
    render(<PlanViewer plan={samplePlan} stage="rejected" {...baseHandlers} />);
    expect(screen.getByTestId('plan-viewer-rejected')).toBeInTheDocument();
  });
});

describe('PlanViewer - 计划展示', () => {
  it('展示文件数 / 总行数 / 风险摘要', () => {
    render(<PlanViewer plan={samplePlan} stage="planned" {...baseHandlers} />);
    expect(screen.getByTestId('plan-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('plan-file-count')).toHaveTextContent('2');
    expect(screen.getByTestId('plan-total-lines')).toHaveTextContent('30');
  });

  it('展示摘要文本', () => {
    render(<PlanViewer plan={samplePlan} stage="planned" {...baseHandlers} />);
    expect(screen.getByTestId('plan-summary')).toHaveTextContent('修改 2 个文件');
  });

  it('展示所有步骤', () => {
    render(<PlanViewer plan={samplePlan} stage="planned" {...baseHandlers} />);
    expect(screen.getByTestId('plan-step-s1')).toBeInTheDocument();
    expect(screen.getByTestId('plan-step-s2')).toBeInTheDocument();
  });

  it('点击步骤批准按钮调用 onApproveStep', () => {
    const onApproveStep = vi.fn();
    render(
      <PlanViewer
        plan={samplePlan}
        stage="planned"
        {...baseHandlers}
        onApproveStep={onApproveStep}
      />
    );
    fireEvent.click(screen.getByTestId('plan-step-approve-s1'));
    expect(onApproveStep).toHaveBeenCalledWith('s1');
  });

  it('点击步骤拒绝按钮调用 onRejectStep', () => {
    const onRejectStep = vi.fn();
    render(
      <PlanViewer
        plan={samplePlan}
        stage="planned"
        {...baseHandlers}
        onRejectStep={onRejectStep}
      />
    );
    fireEvent.click(screen.getByTestId('plan-step-reject-s1'));
    expect(onRejectStep).toHaveBeenCalledWith('s1');
  });

  it('点击全部批准调用 onApproveAll', () => {
    const onApproveAll = vi.fn();
    render(
      <PlanViewer
        plan={samplePlan}
        stage="planned"
        {...baseHandlers}
        onApproveAll={onApproveAll}
      />
    );
    fireEvent.click(screen.getByTestId('plan-approve-all-button'));
    expect(onApproveAll).toHaveBeenCalled();
  });

  it('点击执行按钮调用 onExecutePlan', () => {
    const approvedPlan: Plan = {
      ...samplePlan,
      steps: samplePlan.steps.map((s) => ({ ...s, status: 'approved' })),
    };
    const onExecutePlan = vi.fn();
    render(
      <PlanViewer
        plan={approvedPlan}
        stage="planned"
        {...baseHandlers}
        onExecutePlan={onExecutePlan}
      />
    );
    fireEvent.click(screen.getByTestId('plan-execute-button'));
    expect(onExecutePlan).toHaveBeenCalled();
  });

  it('无已批准步骤时执行按钮禁用', () => {
    const onExecutePlan = vi.fn();
    render(
      <PlanViewer
        plan={samplePlan}
        stage="planned"
        {...baseHandlers}
        onExecutePlan={onExecutePlan}
      />
    );
    const btn = screen.getByTestId('plan-execute-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('高风险步骤显示高风险徽章', () => {
    const highRiskPlan: Plan = {
      ...samplePlan,
      steps: [
        {
          ...samplePlan.steps[0],
          riskLevel: 'high',
        },
      ],
    };
    render(<PlanViewer plan={highRiskPlan} stage="planned" {...baseHandlers} />);
    // 风险徽章可能出现在步骤和整体摘要中（如果 high 触发 overallRisk=high）
    // 使用 getAllByTestId 避免 multiple elements 错误
    const highBadges = screen.getAllByTestId('plan-risk-high');
    expect(highBadges.length).toBeGreaterThan(0);
  });
});
