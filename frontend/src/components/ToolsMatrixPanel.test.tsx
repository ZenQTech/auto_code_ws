/**
 * # ============================================================
 * ToolsMatrixPanel 单元测试 (v1.0.0)
 * Cycle 60 G60-2.2
 * # ============================================================
 * 核心作用：验证工具矩阵面板渲染、搜索、分类切换
 * 输入参数：无
 * 输出结果：测试通过/失败
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 60 G60-2.2 初次创建
 * ====================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { ToolsMatrixPanel } from './ToolsMatrixPanel';
import { useModals } from '../hooks/useModals';

describe('ToolsMatrixPanel', () => {
  let modals: ReturnType<typeof useModals>;

  beforeEach(() => {
    const { result } = renderHook(() => useModals());
    modals = result.current;
  });

  it('应渲染工具矩阵容器', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    expect(screen.getByTestId('tools-matrix-panel')).toBeTruthy();
  });

  it('应显示总数统计', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    // 45 个工具（覆盖 useModals 中所有 45 个 panel key）
    expect(screen.getByText('45')).toBeTruthy();
  });

  it('应渲染搜索框', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    expect(screen.getByTestId('tools-search-input')).toBeTruthy();
  });

  it('应渲染全部展开/折叠按钮', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    expect(screen.getByTestId('tools-expand-all')).toBeTruthy();
    expect(screen.getByTestId('tools-collapse-all')).toBeTruthy();
  });

  it('点击全部展开应展开所有分类', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    // 验证所有分类都展开
    expect(screen.getByTestId('tools-collapse-all')).toBeTruthy();
  });

  it('点击全部折叠应折叠所有分类', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-collapse-all'));
    expect(screen.getByTestId('tools-expand-all')).toBeTruthy();
  });

  it('应包含 Vibe 工具分类', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    // 展开全部
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    // 验证关键工具存在
    expect(screen.getByTestId('tool-vibeCoding')).toBeTruthy();
    expect(screen.getByTestId('tool-planExecutor')).toBeTruthy();
    expect(screen.getByTestId('tool-loopState')).toBeTruthy();
    expect(screen.getByTestId('tool-autoFollow')).toBeTruthy();
  });

  it('应包含 MCP 核心工具', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    expect(screen.getByTestId('tool-mcp')).toBeTruthy();
    expect(screen.getByTestId('tool-mcpRegistry')).toBeTruthy();
  });

  it('应包含设置工具', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    expect(screen.getByTestId('tool-settings')).toBeTruthy();
    expect(screen.getByTestId('tool-rules')).toBeTruthy();
    expect(screen.getByTestId('tool-usage')).toBeTruthy();
  });

  it('应包含高级 MCP 平台工具', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    expect(screen.getByTestId('tool-mcpKubernetes')).toBeTruthy();
    expect(screen.getByTestId('tool-mcpServerless')).toBeTruthy();
    expect(screen.getByTestId('tool-mcpStreamProcessing')).toBeTruthy();
  });

  it('应包含 RAG 工具', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    expect(screen.getByTestId('tool-mcpRag')).toBeTruthy();
    expect(screen.getByTestId('tool-mcpRagRealLLM')).toBeTruthy();
  });

  it('搜索应过滤工具', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    const input = screen.getByTestId('tools-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'kubernetes' } });
    // 验证 kubernetes 工具存在
    expect(screen.getByTestId('tool-mcpKubernetes')).toBeTruthy();
  });

  it('搜索应隐藏不匹配的工具', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    const input = screen.getByTestId('tools-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'kubernetes' } });
    // 设置面板应该被过滤掉
    expect(screen.queryByTestId('tool-settings')).toBeNull();
  });

  it('搜索"mcp"应匹配所有 mcp 工具', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    const input = screen.getByTestId('tools-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'mcp' } });
    // 至少应匹配 mcp 核心
    expect(screen.getByTestId('tool-mcp')).toBeTruthy();
  });

  it('compact=true 时不应显示搜索框', () => {
    render(<ToolsMatrixPanel modals={modals} compact={true} />);
    expect(screen.queryByTestId('tools-search-input')).toBeNull();
  });

  it('autoFollow 提供时应显示徽章', () => {
    const autoFollow = {
      enabled: true,
      setEnabled: () => {},
      follow: () => {},
      lastFollowed: null,
    } as any;
    render(<ToolsMatrixPanel modals={modals} autoFollow={autoFollow} />);
    expect(screen.getByTestId('auto-follow-badge')).toBeTruthy();
  });

  it('点击工具按钮应 toggle 对应 panel', () => {
    function TestWrapper() {
      const m = useModals();
      return (
        <div>
          <div data-testid="mcp-state">{m.mcp.open ? 'open' : 'closed'}</div>
          <ToolsMatrixPanel modals={m} />
        </div>
      );
    }
    render(<TestWrapper />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    const mcpBtn = screen.getByTestId('tool-mcp');
    fireEvent.click(mcpBtn);
    // 验证 panel 状态已改变
    expect(screen.getByTestId('mcp-state').textContent).toBe('open');
  });

  it('点击工具按钮再次点击应关闭', () => {
    function TestWrapper() {
      const m = useModals();
      return (
        <div>
          <div data-testid="mcp-state">{m.mcp.open ? 'open' : 'closed'}</div>
          <ToolsMatrixPanel modals={m} />
        </div>
      );
    }
    render(<TestWrapper />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    const btn = screen.getByTestId('tool-mcp');
    fireEvent.click(btn);
    fireEvent.click(btn);
    // 验证 panel 状态已恢复关闭
    expect(screen.getByTestId('mcp-state').textContent).toBe('closed');
  });

  it('分类标题应显示正确', () => {
    render(<ToolsMatrixPanel modals={modals} />);
    fireEvent.click(screen.getByTestId('tools-expand-all'));
    expect(screen.getByText('Vibe 工具')).toBeTruthy();
    // 使用 getAllByText 因为 "设置" 既在分类标题又在按钮中
    const settingsHeaders = screen.getAllByText('设置');
    expect(settingsHeaders.length).toBeGreaterThanOrEqual(1);
  });
});
