/**
 * # ============================================================
 * # AgentMessagingPanel 组件测试 (v1.0.0 Cycle 27 G27-04)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { AgentMessagingPanel } from './AgentMessagingPanel';
import { AgentMessagingEngine } from '../utils/agentMessagingEngine';

describe('AgentMessagingPanel', () => {
  let engine: AgentMessagingEngine;

  beforeEach(() => {
    engine = new AgentMessagingEngine({ persist: false });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('打开时显示面板', () => {
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    expect(screen.getByTestId('agent-messaging-panel')).toBeTruthy();
    expect(screen.getByText(/代理消息/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<AgentMessagingPanel isOpen={false} onClose={() => {}} engine={engine} />);
    expect(container.firstChild).toBeNull();
  });

  it('显示消息 Tab 和 Followup Tab', () => {
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    expect(screen.getByTestId('tab-messages')).toBeTruthy();
    expect(screen.getByTestId('tab-followups')).toBeTruthy();
  });

  it('点击新消息按钮显示撰写表单', async () => {
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('compose-button'));
    await waitFor(() => {
      expect(screen.getByTestId('compose-form')).toBeTruthy();
    });
  });

  it('发送新消息', async () => {
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('compose-button'));
    fireEvent.change(screen.getByTestId('content-input'), { target: { value: 'Hello from root' } });
    fireEvent.click(screen.getByTestId('send-button'));
    await waitFor(() => {
      expect(engine.listMessages().length).toBe(1);
    });
  });

  it('空内容显示错误', async () => {
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('compose-button'));
    fireEvent.click(screen.getByTestId('send-button'));
    await waitFor(() => {
      expect(screen.getByTestId('compose-error')).toBeTruthy();
    });
  });

  it('相同发送者和接收者显示错误', async () => {
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} knownPaths={['/root']} />);
    fireEvent.click(screen.getByTestId('compose-button'));
    // 手动设置 from 和 to 为相同值
    fireEvent.change(screen.getByTestId('from-select'), { target: { value: '/root' } });
    fireEvent.change(screen.getByTestId('to-select'), { target: { value: '/root' } });
    fireEvent.change(screen.getByTestId('content-input'), { target: { value: 'test' } });
    fireEvent.click(screen.getByTestId('send-button'));
    await waitFor(() => {
      expect(screen.getByTestId('compose-error')).toBeTruthy();
    });
  });

  it('点击消息显示详情', async () => {
    const msg = engine.sendMessage({
      from: '/root',
      to: '/root/worker',
      content: 'Test message',
    });
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    await waitFor(() => {
      expect(screen.getByTestId(`message-item-${msg.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`message-item-${msg.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('message-detail')).toBeTruthy();
      expect(screen.getByTestId('message-content')).toBeTruthy();
    });
  });

  it('回复消息', async () => {
    const msg = engine.sendMessage({
      from: '/root',
      to: '/root/worker',
      content: 'Hello',
    });
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    await waitFor(() => {
      expect(screen.getByTestId(`message-item-${msg.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`message-item-${msg.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('reply-input')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('reply-input'), { target: { value: 'reply content' } });
    fireEvent.click(screen.getByTestId('reply-button'));
    await waitFor(() => {
      expect(engine.getMessage(msg.id)?.status).toBe('replied');
    });
  });

  it('调度 followup 任务', async () => {
    const msg = engine.sendMessage({
      from: '/root',
      to: '/root/worker',
      content: 'Test',
    });
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    await waitFor(() => {
      expect(screen.getByTestId(`message-item-${msg.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`message-item-${msg.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('schedule-followup-button')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('schedule-followup-button'));
    await waitFor(() => {
      expect(screen.getByTestId('followup-form')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('followup-task-input'), { target: { value: 'Do followup' } });
    fireEvent.click(screen.getByTestId('followup-submit'));
    await waitFor(() => {
      expect(engine.listFollowups().length).toBe(1);
    });
  });

  it('切换到 Followup Tab', async () => {
    engine.scheduleFollowup('parent-1', '/root/worker', 'task');
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-followups'));
    await waitFor(() => {
      expect(engine.listFollowups().length).toBe(1);
    });
  });

  it('关闭按钮回调', () => {
    const onClose = vi.fn();
    render(<AgentMessagingPanel isOpen={true} onClose={onClose} engine={engine} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });
});
