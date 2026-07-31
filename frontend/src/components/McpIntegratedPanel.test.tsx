/**
 * # ============================================================
 * # McpIntegratedPanel 集成测试 (v1.0.0 Cycle 42 G42-04)
 * # ============================================================
 * # 覆盖：MCP 集成智能体面板渲染和交互
 * #       - 标题/统计/标签页渲染
 * #       - 4 个 Tab 切换（chat/tools/resources/prompts）
 * #       - 输入框和提交按钮
 * #       - 空状态展示
 * #       - 关闭回调
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-04 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { McpIntegratedPanel } from './McpIntegratedPanel';

describe('McpIntegratedPanel', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  describe('基础渲染', () => {
    it('应该渲染标题栏', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      expect(screen.getByText(/MCP 集成智能体/)).toBeDefined();
    });

    it('应该渲染统计栏', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      expect(screen.getByText(/工具:/)).toBeDefined();
      expect(screen.getByText(/资源:/)).toBeDefined();
      expect(screen.getByText(/提示词:/)).toBeDefined();
    });

    it('应该渲染 4 个 Tab 按钮', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      const buttons = screen.getAllByRole('button');
      // 应该至少有 4 个 Tab + 1 个关闭 + 1 个发送 + 1 个清空 + 1 个 server toggle
      expect(buttons.length).toBeGreaterThanOrEqual(4);
    });

    it('应该渲染底部状态栏', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      expect(screen.getByText(/MCP 协议 2024-11-05/)).toBeDefined();
    });
  });

  describe('关闭交互', () => {
    it('点击关闭按钮触发 onClose', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      const closeBtn = screen.getByLabelText('关闭');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Tab 切换', () => {
    it('默认显示对话 Tab 输入区', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      // 默认 chat tab 应该是激活状态
      const inputArea = screen.getByPlaceholderText(/输入消息/);
      expect(inputArea).toBeDefined();
    });

    it('点击工具 Tab 显示空状态', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      // 找到"🛠️ 工具 (0)" tab
      const allButtons = screen.getAllByRole('button');
      const toolsTab = allButtons.find((b) => b.textContent?.includes('🛠️ 工具'));
      expect(toolsTab).toBeDefined();
      fireEvent.click(toolsTab!);
      expect(screen.getByText(/暂无可用工具/)).toBeDefined();
    });

    it('点击资源 Tab 显示空状态', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      const allButtons = screen.getAllByRole('button');
      const resourcesTab = allButtons.find((b) => b.textContent?.includes('📦 资源'));
      expect(resourcesTab).toBeDefined();
      fireEvent.click(resourcesTab!);
      expect(screen.getByText(/暂无可用资源/)).toBeDefined();
    });

    it('点击提示词 Tab 显示空状态', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      const allButtons = screen.getAllByRole('button');
      const promptsTab = allButtons.find((b) => b.textContent?.includes('💬 提示词'));
      expect(promptsTab).toBeDefined();
      fireEvent.click(promptsTab!);
      expect(screen.getByText(/暂无可用提示词/)).toBeDefined();
    });
  });

  describe('对话 Tab 交互', () => {
    it('应该渲染输入框和发送按钮', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      const input = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
      const allButtons = screen.getAllByRole('button');
      const sendBtn = allButtons.find((b) => b.textContent?.includes('▶ 发送'));
      expect(input).toBeDefined();
      expect(sendBtn).toBeDefined();
    });

    it('应该支持清空历史按钮', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      const allButtons = screen.getAllByRole('button');
      const clearBtn = allButtons.find((b) => b.textContent === '清空');
      expect(clearBtn).toBeDefined();
      fireEvent.click(clearBtn!);
      // 触发后没有报错即可
    });

    it('空历史时显示提示', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      expect(screen.getByText(/提示: 在输入框中/)).toBeDefined();
    });
  });

  describe('Props 透传', () => {
    it('支持自定义 llmProviderName', () => {
      render(<McpIntegratedPanel onClose={onClose} llmProviderName="deepseek" />);
      expect(screen.getByText(/🧪 LLM: deepseek/)).toBeDefined();
    });

    it('默认 llmProviderName 为 mock', () => {
      render(<McpIntegratedPanel onClose={onClose} />);
      expect(screen.getByText(/🧪 LLM: mock/)).toBeDefined();
    });
  });
});
