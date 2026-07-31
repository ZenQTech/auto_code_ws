/**
 * # ============================================================
 * # McpMultimodalPanel - 单元测试 (v1.0.0 Cycle 44 G44-04)
 * # ============================================================
 * # 覆盖：组件渲染 / 关闭回调 / Tab 切换 / 多模态输入 / 示例加载
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-04 初次创建
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McpMultimodalPanel } from './McpMultimodalPanel';

// Mock hooks/utils
vi.mock('../utils/mcpRegistry', () => ({
  McpServerRegistry: vi.fn(),
  getDefaultMcpServerRegistry: vi.fn().mockReturnValue({
    list: vi.fn().mockReturnValue([]),
    getStatus: vi.fn(),
  }),
}));

vi.mock('../utils/mcpToolBridge', () => ({
  McpToolBridge: vi.fn(),
  createMcpToolBridge: vi.fn().mockReturnValue({
    getDefinitions: vi.fn().mockReturnValue([]),
    createExecutor: vi.fn().mockReturnValue({ execute: vi.fn(), type: 'mcp' as const }),
    execute: vi.fn(),
    dispose: vi.fn(),
  }),
}));

describe('McpMultimodalPanel', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  it('应该渲染组件', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    expect(screen.getByText(/MCP 多模态智能体/)).toBeTruthy();
  });

  it('应该渲染关闭按钮', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    const closeBtn = screen.getByLabelText('关闭');
    expect(closeBtn).toBeTruthy();
  });

  it('点击关闭按钮应调用 onClose', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    const closeBtn = screen.getByLabelText('关闭');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('应该渲染 4 个 Tab', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    expect(screen.getByText('💬 多模态对话')).toBeTruthy();
    expect(screen.getByText('🖼️ 图像工具')).toBeTruthy();
    expect(screen.getByText('🔊 音频工具')).toBeTruthy();
    expect(screen.getByText(/📜 历史/)).toBeTruthy();
  });

  it('应该显示 LLM Provider 名称', () => {
    render(<McpMultimodalPanel onClose={onClose} llmProviderName="mock" />);
    expect(screen.getByText(/🧪 LLM: mock/)).toBeTruthy();
  });

  it('默认应显示多模态对话 Tab', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    // 应该有示例加载按钮
    expect(screen.getByText('📷 加载图像示例')).toBeTruthy();
    expect(screen.getByText('🔊 加载音频示例')).toBeTruthy();
    expect(screen.getByText('🎬 加载混合示例')).toBeTruthy();
  });

  it('点击图像工具 Tab 应切换', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    const tab = screen.getByText('🖼️ 图像工具');
    fireEvent.click(tab);
    expect(screen.getByText('🖼️ 图像工具调用')).toBeTruthy();
  });

  it('点击音频工具 Tab 应切换', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    const tab = screen.getByText('🔊 音频工具');
    fireEvent.click(tab);
    expect(screen.getByText('🔊 音频工具调用')).toBeTruthy();
  });

  it('点击历史 Tab 应显示空状态', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    const tabs = screen.getAllByRole('button');
    const historyTab = tabs.find((b) => b.textContent?.includes('历史'));
    if (historyTab) {
      fireEvent.click(historyTab);
      expect(screen.getByText('暂无历史记录')).toBeTruthy();
    }
  });

  it('应包含智能路由下拉框', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    const select = screen.getByDisplayValue(/智能路由/);
    expect(select).toBeTruthy();
  });

  it('应显示统计栏', () => {
    render(<McpMultimodalPanel onClose={onClose} />);
    expect(screen.getByText(/🖼️ 图像:/)).toBeTruthy();
    expect(screen.getByText(/🔊 音频:/)).toBeTruthy();
    expect(screen.getByText(/📁 文件:/)).toBeTruthy();
    expect(screen.getByText(/📝 文本:/)).toBeTruthy();
  });
});
