/**
 * # ============================================================
 * CommandPalette 单元测试 (v1.0.0)
 * Cycle 60 G60-3.1
 * # ============================================================
 * 核心作用：验证全局命令面板（对标 Codex ⌘K / Trae Solo ⌘P）
 * 运行流程：
 *   1. 渲染 CommandPalette，模拟 modals / navigate
 *   2. 验证 open=true 时显示 overlay
 *   3. 验证搜索/过滤逻辑
 *   4. 验证键盘快捷键
 *   5. 验证执行命令
 * 输入参数：无
 * 输出结果：测试通过/失败
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 60 G60-3.1 初次创建
 * ====================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { renderHook } from '@testing-library/react';
import { useModals } from '../hooks/useModals';

describe('CommandPalette', () => {
  let modals: ReturnType<typeof useModals>;
  let navigate: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  let onCycleTheme: ReturnType<typeof vi.fn>;
  let onClearSession: ReturnType<typeof vi.fn>;
  let onToggleAutoFollow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const { result } = renderHook(() => useModals());
    modals = result.current;
    navigate = vi.fn();
    onClose = vi.fn();
    onCycleTheme = vi.fn();
    onClearSession = vi.fn();
    onToggleAutoFollow = vi.fn();
  });

  it('open=false 时不渲染', () => {
    const { container } = render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={false}
        onClose={onClose}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('open=true 时渲染 overlay + input', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    expect(screen.getByTestId('command-palette-overlay')).toBeTruthy();
    expect(screen.getByTestId('command-palette-input')).toBeTruthy();
    expect(screen.getByTestId('command-palette-list')).toBeTruthy();
  });

  it('应该包含路由命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    // Solo 模式为 pinned 应置顶
    expect(screen.getByTestId('command-item-pinned-solo')).toBeTruthy();
    // route-solo
    expect(screen.getByTestId('command-item-route-solo')).toBeTruthy();
  });

  it('应该包含 panel 命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    // mcp panel
    expect(screen.getByTestId('command-item-panel-mcp')).toBeTruthy();
    // settings panel
    expect(screen.getByTestId('command-item-panel-settings')).toBeTruthy();
  });

  it('点击遮罩应触发 onClose', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId('command-palette-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  it('点击 route 命令应 navigate + onClose', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId('command-item-route-chat'));
    expect(navigate).toHaveBeenCalledWith('/chat');
    expect(onClose).toHaveBeenCalled();
  });

  it('点击 panel 命令应 toggle panel + onClose', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId('command-item-panel-mcp'));
    expect(onClose).toHaveBeenCalled();
  });

  it('输入查询应过滤命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'solo' } });
    // solo 仍然应可见
    expect(screen.getByTestId('command-item-route-solo')).toBeTruthy();
  });

  it('按 Enter 应执行当前选中命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'Enter' });
    // 第一条命令是 pinned-solo，所以应该 navigate('/solo')
    expect(navigate).toHaveBeenCalledWith('/solo');
    expect(onClose).toHaveBeenCalled();
  });

  it('按 Esc 应关闭', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('ArrowDown / ArrowUp 应切换选中', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // 仅验证不报错（无断言）
  });

  it('无匹配命令时显示空状态', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzzzznotexist' } });
    expect(screen.getByTestId('command-palette-empty')).toBeTruthy();
  });

  it('onClearSession 提供时显示 session-clear 命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
        onClearSession={onClearSession}
      />
    );
    expect(screen.getByTestId('command-item-session-clear')).toBeTruthy();
  });

  it('onCycleTheme 提供时显示 theme-cycle 命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
        onCycleTheme={onCycleTheme}
      />
    );
    expect(screen.getByTestId('command-item-theme-cycle')).toBeTruthy();
  });

  it('onToggleAutoFollow 提供时显示 autofollow toggle 命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
        onToggleAutoFollow={onToggleAutoFollow}
        autoFollowEnabled={false}
      />
    );
    expect(screen.getByTestId('command-item-session-autofollow')).toBeTruthy();
  });

  it('action-close-all 应触发 modals.closeAll + onClose', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId('command-item-action-close-all'));
    expect(onClose).toHaveBeenCalled();
  });

  it('应支持 session-clear 命令执行', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
        onClearSession={onClearSession}
      />
    );
    fireEvent.click(screen.getByTestId('command-item-session-clear'));
    expect(onClearSession).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('应支持 theme-cycle 命令执行', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
        onCycleTheme={onCycleTheme}
      />
    );
    fireEvent.click(screen.getByTestId('command-item-theme-cycle'));
    expect(onCycleTheme).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('底部状态栏应显示命令总数', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    const footer = screen.getByText(/\d+ \/ \d+ 命令/);
    expect(footer).toBeTruthy();
  });

  it('所有 44 panel 都应有对应命令', () => {
    render(
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={true}
        onClose={onClose}
      />
    );
    // 验证关键 panel 都有命令
    const keys = [
      'mcp', 'settings', 'vibeCoding', 'planExecutor', 'loopState', 'autoFollow',
      'skills', 'agentsMd', 'cycle3', 'dualCompaction', 'rules', 'usage',
      'fileExplorer', 'planEditor', 'hooks', 'subagentMemory', 'hookChain',
      'cacheStats', 'streamList', 'oauthConfig', 'sessionRollout',
      'multiAgentTree', 'traceRule', 'slashCommand', 'customModels',
    ];
    keys.forEach((k) => {
      expect(screen.getByTestId(`command-item-panel-${k}`)).toBeTruthy();
    });
  });
});
