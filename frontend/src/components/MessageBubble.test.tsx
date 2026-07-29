/**
 * # ============================================================
 * # MessageBubble 组件测试
 * # ============================================================
 * # 核心作用：验证 MessageBubble 4 个 hover 工具栏按钮 (v6.33.0 P0 修复)
 * # 运行流程：
 * #   1. 渲染 MessageBubble（AI 角色 + 有内容）
 * #   2. hover 显示工具栏
 * #   3. 点击 4 个按钮验证回调触发
 * #   4. 验证点赞/点踩 visual state
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P0-3 初次创建
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageBubble from './MessageBubble';

describe('MessageBubble - v6.33.0 P0 修复验证', () => {
  const baseProps = {
    role: 'assistant' as const,
    content: 'Hello, this is a test message',
    messageId: 'msg-123',
  };

  describe('渲染', () => {
    it('应该正确渲染消息内容', () => {
      render(<MessageBubble {...baseProps} />);
      expect(screen.getByText('Hello, this is a test message')).toBeInTheDocument();
    });

    it('应该不显示 hover 工具栏当 content 为空', () => {
      render(<MessageBubble {...baseProps} content="" />);
      expect(screen.queryByLabelText('复制')).not.toBeInTheDocument();
    });

    it('应该渲染用户消息右对齐', () => {
      const { container } = render(<MessageBubble {...baseProps} role="user" />);
      const wrapper = container.querySelector('.flex.justify-end');
      expect(wrapper).toBeInTheDocument();
    });

    it('应该渲染错误卡片当 error 字段非空', () => {
      render(<MessageBubble {...baseProps} error="Something went wrong" />);
      expect(screen.getByText('处理失败')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  describe('4 个 hover 工具栏按钮 (P0 修复)', () => {
    it('点击"重新生成"按钮应该触发 onRegenerate 回调', async () => {
      const user = userEvent.setup();
      const onRegenerate = vi.fn();
      render(<MessageBubble {...baseProps} onRegenerate={onRegenerate} />);

      const button = screen.getByLabelText('重新生成');
      await user.click(button);

      expect(onRegenerate).toHaveBeenCalledTimes(1);
      expect(onRegenerate).toHaveBeenCalledWith('msg-123');
    });

    it('点击"点赞"按钮应该触发 onLike 回调', async () => {
      const user = userEvent.setup();
      const onLike = vi.fn();
      render(<MessageBubble {...baseProps} onLike={onLike} />);

      const button = screen.getByLabelText('点赞');
      await user.click(button);

      expect(onLike).toHaveBeenCalledTimes(1);
      expect(onLike).toHaveBeenCalledWith('msg-123');
    });

    it('点击"点踩"按钮应该触发 onDislike 回调', async () => {
      const user = userEvent.setup();
      const onDislike = vi.fn();
      render(<MessageBubble {...baseProps} onDislike={onDislike} />);

      const button = screen.getByLabelText('点踩');
      await user.click(button);

      expect(onDislike).toHaveBeenCalledTimes(1);
      expect(onDislike).toHaveBeenCalledWith('msg-123');
    });

    it('点击"朗读"按钮应该触发 onReadAloud 回调', async () => {
      const user = userEvent.setup();
      const onReadAloud = vi.fn();
      render(<MessageBubble {...baseProps} onReadAloud={onReadAloud} />);

      const button = screen.getByLabelText('朗读');
      await user.click(button);

      expect(onReadAloud).toHaveBeenCalledTimes(1);
      expect(onReadAloud).toHaveBeenCalledWith('msg-123', 'Hello, this is a test message');
    });
  });

  describe('Visual state (P0 修复)', () => {
    it('点赞按钮应显示激活态当 feedback="like"', () => {
      render(<MessageBubble {...baseProps} feedback="like" onLike={vi.fn()} />);
      const button = screen.getByLabelText('点赞');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('点踩按钮应显示激活态当 feedback="dislike"', () => {
      render(<MessageBubble {...baseProps} feedback="dislike" onDislike={vi.fn()} />);
      const button = screen.getByLabelText('点踩');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('未传回调时按钮应被禁用', () => {
      render(<MessageBubble {...baseProps} />);
      expect(screen.getByLabelText('重新生成')).toBeDisabled();
      expect(screen.getByLabelText('点赞')).toBeDisabled();
      expect(screen.getByLabelText('点踩')).toBeDisabled();
    });
  });

  describe('向后兼容', () => {
    it('未传 messageId 时不应触发回调', async () => {
      const user = userEvent.setup();
      const onRegenerate = vi.fn();
      // 不传 messageId
      render(<MessageBubble role="assistant" content="test" onRegenerate={onRegenerate} />);

      const button = screen.getByLabelText('重新生成');
      await user.click(button);

      expect(onRegenerate).not.toHaveBeenCalled();
    });
  });
});
