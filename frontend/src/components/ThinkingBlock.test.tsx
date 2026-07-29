/**
 * # ============================================================
 * # ThinkingBlock 组件测试 (Cycle 15 P1-10)
 * # ============================================================
 * # 核心作用：覆盖 v4.0.0 阶段标签增强的全部功能：
 * #           - 常驻阶段徽章渲染
 * #           - 阶段切换动画
 * #           - 自动阶段检测
 * #           - 阶段历史时间线
 * #           - 干预按钮
 * #           - 折叠/展开
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThinkingBlock from './ThinkingBlock';

describe('ThinkingBlock - 基础渲染', () => {
  it('空内容且非流式时不应渲染', () => {
    const { container } = render(
      <ThinkingBlock content="" isStreaming={false} stage="idle" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('有内容时应渲染组件', () => {
    render(<ThinkingBlock content="思考一下" isStreaming={false} stage="idle" />);
    expect(screen.getByText('思考过程')).toBeInTheDocument();
  });

  it('流式时应显示"思考中"', () => {
    render(
      <ThinkingBlock content="thinking content here" isStreaming={true} stage="analysis" />
    );
    expect(screen.getAllByText('思考中').length).toBeGreaterThan(0);
  });
});

describe('ThinkingBlock - v4.0.0 阶段徽章', () => {
  it('应显示当前阶段徽章（analysis）', () => {
    render(
      <ThinkingBlock content="测试" isStreaming={true} stage="analysis" />
    );
    expect(screen.getByLabelText('当前阶段: 需求分析')).toBeInTheDocument();
  });

  it('应显示当前阶段徽章（planning）', () => {
    render(
      <ThinkingBlock content="测试" isStreaming={true} stage="planning" />
    );
    expect(screen.getByLabelText('当前阶段: 方案规划')).toBeInTheDocument();
  });

  it('应显示当前阶段徽章（coding）', () => {
    render(
      <ThinkingBlock content="测试" isStreaming={true} stage="coding" />
    );
    expect(screen.getByLabelText('当前阶段: 代码生成')).toBeInTheDocument();
  });

  it('应显示当前阶段徽章（testing）', () => {
    render(
      <ThinkingBlock content="checking the code now" isStreaming={true} stage="testing" />
    );
    expect(screen.getByLabelText('当前阶段: 测试验证')).toBeInTheDocument();
  });

  it('stage=idle 时不应显示阶段徽章', () => {
    render(
      <ThinkingBlock content="测试" isStreaming={false} stage="idle" />
    );
    expect(screen.queryByText('需求分析')).not.toBeInTheDocument();
    expect(screen.queryByText('方案规划')).not.toBeInTheDocument();
  });
});

describe('ThinkingBlock - 自动阶段检测', () => {
  it('autoDetectStage=true + stage=idle + 包含 "分析" 应检测为 analysis', () => {
    render(
      <ThinkingBlock
        content="让我先分析一下需求"
        isStreaming={true}
        stage="idle"
        autoDetectStage={true}
      />
    );
    expect(screen.getByLabelText('当前阶段: 需求分析')).toBeInTheDocument();
  });

  it('autoDetectStage=true + stage=idle + 包含 "测试" 应检测为 testing', () => {
    render(
      <ThinkingBlock
        content="现在测试一下结果"
        isStreaming={true}
        stage="idle"
        autoDetectStage={true}
      />
    );
    expect(screen.getByLabelText('当前阶段: 测试验证')).toBeInTheDocument();
  });

  it('autoDetectStage=false 时不应使用内容检测', () => {
    render(
      <ThinkingBlock
        content="让我先分析一下需求"
        isStreaming={true}
        stage="idle"
        autoDetectStage={false}
      />
    );
    // 不应有任何阶段徽章
    expect(screen.queryByLabelText(/当前阶段/)).not.toBeInTheDocument();
  });

  it('显式 stage 应优先于自动检测', () => {
    render(
      <ThinkingBlock
        content="让我先分析一下需求"
        isStreaming={true}
        stage="coding"
        autoDetectStage={true}
      />
    );
    expect(screen.getByLabelText('当前阶段: 代码生成')).toBeInTheDocument();
  });
});

describe('ThinkingBlock - 折叠/展开', () => {
  it('非流式时默认折叠', () => {
    const { container } = render(
      <ThinkingBlock content="测试内容" isStreaming={false} stage="idle" />
    );
    // 标题应可见
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    // 内容应不可见（max-h-0 class）
    const contentArea = container.querySelector('.max-h-0');
    expect(contentArea).toBeInTheDocument();
  });

  it('点击标题应切换展开状态', () => {
    const { container } = render(
      <ThinkingBlock content="测试内容" isStreaming={false} stage="idle" />
    );
    const toggleButton = screen.getByRole('button', { name: /展开思考过程|收起思考过程/ });
    fireEvent.click(toggleButton);
    // 展开后 max-h-0 应消失
    expect(container.querySelector('.max-h-0')).not.toBeInTheDocument();
    expect(container.querySelector('.max-h-\\[40rem\\]')).toBeInTheDocument();
  });

  it('流式时应自动展开', () => {
    const { container } = render(
      <ThinkingBlock content="测试内容" isStreaming={true} stage="analysis" />
    );
    expect(container.querySelector('.max-h-0')).not.toBeInTheDocument();
  });
});

describe('ThinkingBlock - 干预按钮', () => {
  it('流式 + 提供 onIntervene 时应显示干预按钮', () => {
    const onIntervene = vi.fn();
    render(
      <ThinkingBlock
        content="测试"
        isStreaming={true}
        stage="analysis"
        onIntervene={onIntervene}
      />
    );
    const interveneButton = screen.getByTitle('干预：暂停 AI 思考');
    expect(interveneButton).toBeInTheDocument();
  });

  it('点击干预按钮应触发回调', () => {
    const onIntervene = vi.fn();
    render(
      <ThinkingBlock
        content="测试"
        isStreaming={true}
        stage="analysis"
        onIntervene={onIntervene}
      />
    );
    const interveneButton = screen.getByTitle('干预：暂停 AI 思考');
    fireEvent.click(interveneButton);
    expect(onIntervene).toHaveBeenCalledTimes(1);
  });

  it('非流式时不应显示干预按钮', () => {
    const onIntervene = vi.fn();
    render(
      <ThinkingBlock
        content="测试"
        isStreaming={false}
        stage="analysis"
        onIntervene={onIntervene}
      />
    );
    expect(screen.queryByTitle('干预：暂停 AI 思考')).not.toBeInTheDocument();
  });

  it('未提供 onIntervene 时不应显示干预按钮', () => {
    render(
      <ThinkingBlock content="测试" isStreaming={true} stage="analysis" />
    );
    expect(screen.queryByTitle('干预：暂停 AI 思考')).not.toBeInTheDocument();
  });
});

describe('ThinkingBlock - 阶段进度', () => {
  it('流式 + 有 stageProgress 时应显示进度条', () => {
    render(
      <ThinkingBlock
        content="测试"
        isStreaming={true}
        stage="coding"
        stageProgress={0.5}
      />
    );
    // 应显示 50%
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('stageProgress=0 时进度条最小宽度 5%', () => {
    const { container } = render(
      <ThinkingBlock
        content="测试"
        isStreaming={true}
        stage="coding"
        stageProgress={0}
      />
    );
    const progressBar = container.querySelector('[style*="width: 5%"]');
    expect(progressBar).toBeInTheDocument();
  });

  it('stageProgress=1 时进度条满 100%', () => {
    render(
      <ThinkingBlock
        content="测试"
        isStreaming={true}
        stage="testing"
        stageProgress={1}
      />
    );
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});

describe('ThinkingBlock - 阶段历史时间线', () => {
  it('包含 "## 分析:" 边界时应显示阶段历史', () => {
    const content = `## 分析:
理解需求

## 实现:
开始写代码`;
    render(
      <ThinkingBlock
        content={content}
        isStreaming={false}
        stage="coding"
        showStageTimeline={true}
      />
    );
    // 展开后应能看到 "阶段历史" 标签
    const toggleButton = screen.getByRole('button', { name: /展开|收起/ });
    fireEvent.click(toggleButton);
    expect(screen.getByText('阶段历史')).toBeInTheDocument();
  });

  it('showStageTimeline=false 时不应显示阶段历史', () => {
    const content = `## 分析:
理解需求

## 实现:
开始写代码`;
    render(
      <ThinkingBlock
        content={content}
        isStreaming={false}
        stage="coding"
        showStageTimeline={false}
      />
    );
    const toggleButton = screen.getByRole('button', { name: /展开|收起/ });
    fireEvent.click(toggleButton);
    expect(screen.queryByText('阶段历史')).not.toBeInTheDocument();
  });
});

describe('ThinkingBlock - 阶段切换', () => {
  it('从 analysis 切换到 coding 应触发动画', () => {
    const { rerender } = render(
      <ThinkingBlock
        content="分析中"
        isStreaming={true}
        stage="analysis"
      />
    );
    expect(screen.getByLabelText('当前阶段: 需求分析')).toBeInTheDocument();

    rerender(
      <ThinkingBlock
        content="开始写代码"
        isStreaming={true}
        stage="coding"
      />
    );
    expect(screen.getByLabelText('当前阶段: 代码生成')).toBeInTheDocument();
    // 阶段徽章应该有 animate-msg-enter class
    const badge = screen.getByLabelText('当前阶段: 代码生成');
    expect(badge.className).toContain('animate-msg-enter');
  });
});
