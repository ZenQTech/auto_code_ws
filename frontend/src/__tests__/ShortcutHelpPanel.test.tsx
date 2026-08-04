/**
 * ShortcutHelpPanel 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ShortcutHelpPanel from '../components/ShortcutHelpPanel';
import { setActiveShortcutContext } from '../hooks/useShortcut';

describe('ShortcutHelpPanel', () => {
  beforeEach(() => {
    setActiveShortcutContext('global');
  });

  afterEach(() => {
    setActiveShortcutContext('global');
  });

  it('open=false 时不渲染', () => {
    render(<ShortcutHelpPanel open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('shortcut-help-panel')).not.toBeInTheDocument();
  });

  it('open=true 时渲染', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('shortcut-help-panel')).toBeInTheDocument();
  });

  it('显示 7 个 context 分组', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('shortcut-help-panel-ctx-global')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-help-panel-ctx-chat')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-help-panel-ctx-composer')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-help-panel-ctx-editor')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-help-panel-ctx-pager')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-help-panel-ctx-list')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-help-panel-ctx-approval')).toBeInTheDocument();
  });

  it('点击背景关闭', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpPanel open={true} onClose={onClose} />);
    // 背景 click
    const bg = screen.getByTestId('shortcut-help-panel');
    fireEvent.click(bg);
    expect(onClose).toHaveBeenCalled();
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpPanel open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('shortcut-help-panel-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc 键关闭', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpPanel open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('搜索框存在', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('shortcut-help-panel-search')).toBeInTheDocument();
  });

  it('搜索时过滤结果', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    const search = screen.getByTestId('shortcut-help-panel-search');
    fireEvent.change(search, { target: { value: '命令面板' } });
    // 仅 global context 含"命令面板"
    expect(screen.getByTestId('shortcut-help-panel-ctx-global')).toBeInTheDocument();
  });

  it('无匹配时显示提示', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    const search = screen.getByTestId('shortcut-help-panel-search');
    fireEvent.change(search, { target: { value: 'xxxxxNOMATCHxxxxx' } });
    expect(screen.getByText('未找到匹配的快捷键')).toBeInTheDocument();
  });

  it('高亮当前活跃 context', () => {
    setActiveShortcutContext('chat');
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    // 当前活跃 context 显示"当前活跃"标签
    expect(screen.getByText('当前活跃')).toBeInTheDocument();
  });

  it('底部显示当前活跃 context', () => {
    setActiveShortcutContext('editor');
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByText(/editor/)).toBeInTheDocument();
  });

  it('点击内容区域不关闭（stopPropagation）', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpPanel open={true} onClose={onClose} />);
    const search = screen.getByTestId('shortcut-help-panel-search');
    fireEvent.click(search);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('显示所有 global 快捷键', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByText('打开命令面板')).toBeInTheDocument();
    expect(screen.getByText('显示快捷键帮助')).toBeInTheDocument();
    expect(screen.getByText('循环切换主题')).toBeInTheDocument();
  });

  it('显示 chat context 快捷键', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByText('发送消息')).toBeInTheDocument();
    expect(screen.getByText('切换 Plan 模式')).toBeInTheDocument();
    expect(screen.getByText('切换 Auto-Follow')).toBeInTheDocument();
  });

  it('显示 approval context 快捷键', () => {
    render(<ShortcutHelpPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByText('批准')).toBeInTheDocument();
    expect(screen.getByText('拒绝')).toBeInTheDocument();
  });
});
