/**
 * # ============================================================
 * # AgentExecutionPanel 组件单元测试
 * # Cycle 64 G64-01
 * # ====================================
 */

/// <reference types="vitest" />

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentExecutionPanel } from '../components/AgentExecutionPanel';
import { useAgentExecution } from '../hooks/useAgentExecution';

import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect as vitestExpect } from 'vitest';
(vitestExpect as any).extend(jestDomMatchers);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  sent: string[] = [];
  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // 异步触发 open
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen({});
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({});
  }

  // 模拟接收消息
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  (global as any).WebSocket = MockWebSocket;
  // Mock fetch
  global.fetch = vi.fn(async (url: string, opts: any) => {
    if (String(url).includes('/pause') || String(url).includes('/resume') || String(url).includes('/cancel')) {
      return new Response(JSON.stringify({ success: true, instance: { status: 'running' } }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
});

describe('AgentExecutionPanel - 基础渲染', () => {
  it('应渲染主面板（折叠状态）', async () => {
    render(<AgentExecutionPanel agentId="agent-test-1" defaultCollapsed={false} />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-execution-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('agent-panel-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('agent-connection-status')).toBeInTheDocument();
  });

  it('应建立 WebSocket 连接', async () => {
    render(<AgentExecutionPanel agentId="agent-test-2" />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain('/api/agent-roles/ws/agent-test-2');
  });

  it('应接收 initial 消息并显示实例', async () => {
    render(<AgentExecutionPanel agentId="agent-test-3" />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      type: 'initial',
      agent_id: 'agent-test-3',
      instance: {
        agent_id: 'agent-test-3',
        role_name: 'worker',
        nickname: 'Builder',
        status: 'running',
        task: 'implement X',
        started_at: Date.now() / 1000,
        finished_at: null,
        result: null,
        error: null,
        progress: 0.5,
        current_tool: 'read',
        tool_calls_count: 2,
        tokens_used: 0,
        paused: false,
        cancel_requested: false,
      },
      history: [],
    });
    await waitFor(() => {
      expect(screen.getByTestId('agent-status').textContent).toBe('running');
    });
    // nickname 包含在 '🤖 Builder' 中
    expect(screen.getByTestId('agent-execution-panel').textContent).toContain('Builder');
  });

  it('应接收 event 消息并显示在事件流中', async () => {
    render(<AgentExecutionPanel agentId="agent-test-4" />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      type: 'event',
      event: {
        event_id: 'evt-1',
        agent_id: 'agent-test-4',
        event_type: 'PreToolUse',
        timestamp: Date.now() / 1000,
        data: { tool_name: 'read', arguments: { path: '/x.py' } },
        parent_event_id: null,
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId('event-badge-PreToolUse')).toBeInTheDocument();
    });
  });
});

describe('AgentExecutionPanel - 折叠', () => {
  it('应能切换折叠状态', async () => {
    render(<AgentExecutionPanel agentId="agent-test-5" defaultCollapsed={false} />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-event-stream')).toBeInTheDocument();
    });
    const toggle = screen.getByTestId('agent-panel-toggle');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.queryByTestId('agent-event-stream')).not.toBeInTheDocument();
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId('agent-event-stream')).toBeInTheDocument();
    });
  });
});

describe('AgentExecutionPanel - 操作按钮', () => {
  it('应渲染 close 按钮（当 onClose 提供时）', async () => {
    const onClose = vi.fn();
    render(<AgentExecutionPanel agentId="agent-test-6" onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-panel-close')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('agent-panel-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('活动状态时应显示 pause/cancel 按钮', async () => {
    render(<AgentExecutionPanel agentId="agent-test-7" />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      type: 'initial',
      agent_id: 'agent-test-7',
      instance: {
        agent_id: 'agent-test-7',
        role_name: 'worker',
        nickname: 'Forge',
        status: 'running',
        task: 't',
        started_at: Date.now() / 1000,
        finished_at: null,
        result: null,
        error: null,
        progress: 0.3,
        current_tool: 'bash',
        tool_calls_count: 1,
        tokens_used: 0,
        paused: false,
        cancel_requested: false,
      },
      history: [],
    });
    await waitFor(() => {
      expect(screen.getByTestId('agent-pause-resume')).toBeInTheDocument();
    });
    expect(screen.getByTestId('agent-cancel')).toBeInTheDocument();
  });

  it('idle 状态不应显示 pause/cancel 按钮', async () => {
    render(<AgentExecutionPanel agentId="agent-test-8" />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      type: 'initial',
      agent_id: 'agent-test-8',
      instance: {
        agent_id: 'agent-test-8',
        role_name: 'worker',
        nickname: 'Done',
        status: 'idle',
        task: 't',
        started_at: Date.now() / 1000,
        finished_at: Date.now() / 1000,
        result: '完成',
        error: null,
        progress: 1.0,
        current_tool: null,
        tool_calls_count: 3,
        tokens_used: 0,
        paused: false,
        cancel_requested: false,
      },
      history: [],
    });
    await waitFor(() => {
      expect(screen.getByTestId('agent-status').textContent).toBe('idle');
    });
    expect(screen.queryByTestId('agent-pause-resume')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-cancel')).not.toBeInTheDocument();
  });
});

describe('useAgentExecution - Hook 单元测试', () => {
  function TestComponent({ agentId, onResult }: { agentId: string; onResult: (r: ReturnType<typeof useAgentExecution>) => void }) {
    const result = useAgentExecution({ agentId, autoConnect: true });
    onResult(result);
    return <div data-testid="hook-test">{result.events.length}</div>;
  }

  it('应在没有 agentId 时不连接', () => {
    let lastResult: any = null;
    render(<TestComponent agentId={''} onResult={(r) => (lastResult = r)} />);
    // WebSocket 不应被建立
    expect(MockWebSocket.instances.length).toBe(0);
    expect(lastResult).toBeTruthy();
    expect(lastResult.connected).toBe(false);
  });

  it('应通过 WebSocket 接收事件并更新 instance', async () => {
    let lastResult: any = null;
    render(<TestComponent agentId="agent-hook-1" onResult={(r) => (lastResult = r)} />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      type: 'initial',
      agent_id: 'agent-hook-1',
      instance: {
        agent_id: 'agent-hook-1',
        role_name: 'worker',
        nickname: 'N1',
        status: 'running',
        task: 't1',
        started_at: Date.now() / 1000,
        finished_at: null,
        result: null,
        error: null,
        progress: 0.1,
        current_tool: null,
        tool_calls_count: 0,
        tokens_used: 0,
        paused: false,
        cancel_requested: false,
      },
      history: [],
    });
    await waitFor(() => {
      expect(lastResult.instance).toBeTruthy();
    });
    expect(lastResult.instance.nickname).toBe('N1');

    // 发出 PreToolUse 事件
    ws.simulateMessage({
      type: 'event',
      event: {
        event_id: 'e1',
        agent_id: 'agent-hook-1',
        event_type: 'PreToolUse',
        timestamp: Date.now() / 1000,
        data: { tool_name: 'write' },
        parent_event_id: null,
      },
    });
    await waitFor(() => {
      expect(lastResult.events.length).toBe(1);
    });
    expect(lastResult.instance.current_tool).toBe('write');
    expect(lastResult.instance.tool_calls_count).toBe(1);
    expect(lastResult.instance.status).toBe('tool_calling');

    // 发出 SubagentStop 事件
    ws.simulateMessage({
      type: 'event',
      event: {
        event_id: 'e2',
        agent_id: 'agent-hook-1',
        event_type: 'SubagentStop',
        timestamp: Date.now() / 1000,
        data: { status: 'idle', result: 'Done', duration_s: 1.5 },
        parent_event_id: null,
      },
    });
    await waitFor(() => {
      expect(lastResult.instance.status).toBe('idle');
    });
    expect(lastResult.instance.progress).toBe(1.0);
    expect(lastResult.instance.result).toBe('Done');
  });

  it('应处理 Error 事件', async () => {
    let lastResult: any = null;
    render(<TestComponent agentId="agent-hook-err" onResult={(r) => (lastResult = r)} />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = MockWebSocket.instances[0];
    // 先发送 initial 以创建 instance
    ws.simulateMessage({
      type: 'initial',
      agent_id: 'agent-hook-err',
      instance: {
        agent_id: 'agent-hook-err',
        role_name: 'worker',
        nickname: 'E',
        status: 'running',
        task: 't',
        started_at: Date.now() / 1000,
        finished_at: null,
        result: null,
        error: null,
        progress: 0.0,
        current_tool: null,
        tool_calls_count: 0,
        tokens_used: 0,
        paused: false,
        cancel_requested: false,
      },
      history: [],
    });
    await waitFor(() => {
      expect(lastResult.instance).toBeTruthy();
    });
    // 然后发出 Error 事件
    ws.simulateMessage({
      type: 'event',
      event: {
        event_id: 'e-err',
        agent_id: 'agent-hook-err',
        event_type: 'Error',
        timestamp: Date.now() / 1000,
        data: { error: 'something went wrong' },
        parent_event_id: null,
      },
    });
    await waitFor(() => {
      expect(lastResult.instance?.status).toBe('failed');
    });
    expect(lastResult.instance.error).toBe('something went wrong');
  });

  it('应能通过 HTTP API 暂停', async () => {
    let lastResult: any = null;
    render(<TestComponent agentId="agent-hook-pause" onResult={(r) => (lastResult = r)} />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ok = await lastResult.pause();
    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/pause'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('应能通过 HTTP API 恢复', async () => {
    let lastResult: any = null;
    render(<TestComponent agentId="agent-hook-resume" onResult={(r) => (lastResult = r)} />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ok = await lastResult.resume();
    expect(ok).toBe(true);
  });

  it('应能取消（WS + HTTP）', async () => {
    let lastResult: any = null;
    render(<TestComponent agentId="agent-hook-cancel" onResult={(r) => (lastResult = r)} />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    // 等待 WS 打开
    await waitFor(() => {
      expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.OPEN);
    });
    const ws = MockWebSocket.instances[0];
    const ok = await lastResult.cancel();
    expect(ok).toBe(true);
    // WS 应收到 'cancel'
    expect(ws.sent).toContain('cancel');
    // HTTP 应被调用
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cancel'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('disconnect 后不应再接收事件', async () => {
    let lastResult: any = null;
    render(<TestComponent agentId="agent-hook-disconnect" onResult={(r) => (lastResult = r)} />);
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    lastResult.disconnect();
    await waitFor(() => {
      expect(lastResult.connected).toBe(false);
    });
  });
});
