/**
 * # ============================================================
 * StreamingLoading 单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StreamingLoading from './StreamingLoading';

describe('StreamingLoading', () => {
  it('visible=false 不渲染', () => {
    const { container } = render(<StreamingLoading visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('默认 visible=true 渲染', () => {
    render(<StreamingLoading />);
    const loading = screen.getByTestId('streaming-loading');
    expect(loading).toBeTruthy();
  });

  it('phase=thinking 使用 AI 正在思考文案', () => {
    render(<StreamingLoading phase="thinking" />);
    expect(screen.getByText('AI 正在思考…')).toBeTruthy();
  });

  it('phase=typing 使用 正在输入文案', () => {
    render(<StreamingLoading phase="typing" />);
    expect(screen.getByText('正在输入…')).toBeTruthy();
  });

  it('phase=searching 使用 正在搜索文案', () => {
    render(<StreamingLoading phase="searching" />);
    expect(screen.getByText('正在搜索…')).toBeTruthy();
  });

  it('phase=tool-calling 使用 正在调用工具文案', () => {
    render(<StreamingLoading phase="tool-calling" />);
    expect(screen.getByText('正在调用工具…')).toBeTruthy();
  });

  it('phase=generating 使用 正在生成文案', () => {
    render(<StreamingLoading phase="generating" />);
    expect(screen.getByText('正在生成…')).toBeTruthy();
  });

  it('phase=analyzing 使用 正在分析文案', () => {
    render(<StreamingLoading phase="analyzing" />);
    expect(screen.getByText('正在分析…')).toBeTruthy();
  });

  it('phase=default 使用 处理中文案', () => {
    render(<StreamingLoading phase="default" />);
    expect(screen.getByText('处理中…')).toBeTruthy();
  });

  it('自定义 label 覆盖 phase 默认文案', () => {
    render(<StreamingLoading phase="thinking" label="AI 在推理" />);
    expect(screen.getByText('AI 在推理')).toBeTruthy();
  });

  it('showIcon=true 时显示图标', () => {
    render(<StreamingLoading phase="thinking" showIcon />);
    const icon = screen.getByTestId('streaming-loading-icon');
    expect(icon).toBeTruthy();
    expect(icon.textContent).toBe('💭');
  });

  it('showIcon=false 时不显示图标', () => {
    render(<StreamingLoading phase="thinking" showIcon={false} />);
    expect(screen.queryByTestId('streaming-loading-icon')).toBeNull();
  });

  it('progress=50 显示百分比', () => {
    render(<StreamingLoading progress={50} />);
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('progress=0 不显示百分比', () => {
    render(<StreamingLoading progress={0} />);
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('progress=100 不显示百分比（已完成）', () => {
    render(<StreamingLoading progress={100} />);
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('data-phase 属性生效', () => {
    render(<StreamingLoading phase="thinking" />);
    expect(screen.getByTestId('streaming-loading').getAttribute('data-phase')).toBe('thinking');
  });

  it('aria-live=polite 用于无障碍', () => {
    render(<StreamingLoading />);
    expect(screen.getByTestId('streaming-loading').getAttribute('aria-live')).toBe('polite');
  });
});
