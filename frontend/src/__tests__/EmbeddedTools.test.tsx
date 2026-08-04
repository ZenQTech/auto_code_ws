/**
 * EmbeddedTools 单元测试
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import EmbeddedTools, { type EmbeddedTool } from '../components/EmbeddedTools';

describe('EmbeddedTools', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('默认显示概览 tab', () => {
    render(<EmbeddedTools />);
    expect(screen.getByTestId('embedded-tool-overview')).toBeTruthy();
  });

  it('显示所有 11 个 tab', () => {
    render(<EmbeddedTools />);
    expect(screen.getByTestId('embedded-tools-tab-overview')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-editor')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-terminal')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-browser')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-diff')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-memory')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-files')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-metrics')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-context')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-stage')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-batch')).toBeTruthy();
  });

  it('点击 editor tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-editor'));
    expect(screen.getByTestId('embedded-tool-editor')).toBeTruthy();
  });

  it('点击 terminal tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-terminal'));
    expect(screen.getByTestId('embedded-tool-terminal')).toBeTruthy();
  });

  it('点击 browser tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-browser'));
    expect(screen.getByTestId('embedded-tool-browser')).toBeTruthy();
  });

  it('点击 diff tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-diff'));
    expect(screen.getByTestId('embedded-tool-diff')).toBeTruthy();
  });

  it('点击 memory tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-memory'));
    expect(screen.getByTestId('embedded-tool-memory')).toBeTruthy();
  });

  it('点击 files tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-files'));
    expect(screen.getByTestId('embedded-tool-files')).toBeTruthy();
  });

  it('点击 metrics tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-metrics'));
    expect(screen.getByTestId('embedded-tool-metrics')).toBeTruthy();
  });

  it('sessionId 传递给 overview view', () => {
    render(<EmbeddedTools sessionId="sess-12345" />);
    expect(screen.getByText(/sess-12345/)).toBeTruthy();
  });

  it('sessionId 传递给 editor view', () => {
    render(<EmbeddedTools sessionId="sess-abc" defaultTab="editor" />);
    expect(screen.getByText(/sess-abc/)).toBeTruthy();
  });

  it('defaultTab 优先于 localStorage', () => {
    window.localStorage.setItem('hermes.solo.embeddedTool', 'terminal');
    render(<EmbeddedTools defaultTab="editor" />);
    expect(screen.getByTestId('embedded-tool-editor')).toBeTruthy();
  });

  it('切换 tab 持久化到 localStorage', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-terminal'));
    expect(window.localStorage.getItem('hermes.solo.embeddedTool')).toBe('terminal');
  });

  it('role=tablist 标识', () => {
    render(<EmbeddedTools />);
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('每个 tab 都有 role=tab', () => {
    render(<EmbeddedTools />);
    const tabs = screen.getAllByRole('tab');
    // 11 个内嵌工具：overview / editor / terminal / browser / diff / memory / files / metrics / context / stage / batch
    expect(tabs.length).toBe(11);
  });

  it('显示所有 11 个 tab 测试 ID', () => {
    render(<EmbeddedTools />);
    expect(screen.getByTestId('embedded-tools-tab-overview')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-editor')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-terminal')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-browser')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-diff')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-memory')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-files')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-metrics')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-context')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-stage')).toBeTruthy();
    expect(screen.getByTestId('embedded-tools-tab-batch')).toBeTruthy();
  });

  it('点击 stage tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-stage'));
    expect(screen.getByTestId('embedded-tool-stage')).toBeTruthy();
  });

  it('点击 batch tab 切换内容', () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-batch'));
    expect(screen.getByTestId('embedded-tool-batch')).toBeTruthy();
  });

  it('batch tab 默认显示介绍页', () => {
    render(<EmbeddedTools defaultTab="batch" />);
    expect(screen.getByTestId('embedded-batch-open-btn')).toBeTruthy();
  });

  it('点击 batch 介绍按钮打开 BatchSpawnPanel', () => {
    render(<EmbeddedTools defaultTab="batch" />);
    fireEvent.click(screen.getByTestId('embedded-batch-open-btn'));
    expect(screen.getByTestId('batch-spawn-panel')).toBeTruthy();
  });

  it('active tab 有 aria-selected=true', () => {
    render(<EmbeddedTools defaultTab="editor" />);
    const editorTab = screen.getByTestId('embedded-tools-tab-editor');
    expect(editorTab.getAttribute('aria-selected')).toBe('true');
  });

  it('non-active tab aria-selected=false', () => {
    render(<EmbeddedTools defaultTab="editor" />);
    const terminalTab = screen.getByTestId('embedded-tools-tab-terminal');
    expect(terminalTab.getAttribute('aria-selected')).toBe('false');
  });

  it('data-testid 可定制', () => {
    render(<EmbeddedTools data-testid="my-tools" />);
    expect(screen.getByTestId('my-tools')).toBeTruthy();
  });

  it('概览 view 显示 4 个指标卡片', () => {
    const { container } = render(<EmbeddedTools />);
    const cards = container.querySelectorAll('.grid-cols-2 > div');
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });

  it('terminal view 显示 prompt', () => {
    render(<EmbeddedTools sessionId="abc12345" defaultTab="terminal" />);
    expect(screen.getByText(/hermes/)).toBeTruthy();
  });

  it('浏览器 view 有 URL 输入', () => {
    render(<EmbeddedTools defaultTab="browser" />);
    expect(screen.getByPlaceholderText(/输入 URL/)).toBeTruthy();
  });

  it('Diff view 显示 + / - 标记', () => {
    render(<EmbeddedTools defaultTab="diff" />);
    expect(screen.getByText(/\+ const newFeature/)).toBeTruthy();
    expect(screen.getByText(/- const oldFeature/)).toBeTruthy();
  });

  it('localStorage 损坏时回退到 default', () => {
    window.localStorage.setItem('hermes.solo.embeddedTool', 'INVALID_KEY');
    render(<EmbeddedTools />);
    expect(screen.getByTestId('embedded-tool-overview')).toBeTruthy();
  });
});
