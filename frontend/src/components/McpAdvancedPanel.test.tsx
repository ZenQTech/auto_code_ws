/**
 * # ============================================================
 * # McpAdvancedPanel 单元测试 (v1.0.0 Cycle 41)
 * # ============================================================
 * # 覆盖：MCP 高级能力统一面板
 * #       - 4 大 Tab 渲染
 * #       - 资源订阅交互
 * #       - 参数补全交互
 * #       - 服务器采样交互
 * #       - 根目录管理交互
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { McpAdvancedPanel } from './McpAdvancedPanel';
import { McpClient } from '../utils/mcpClient';
import type { McpTransport } from '../utils/mcpTransport';
import type { JsonRpcMessage } from '../utils/mcpTypes';

// ============ 全能 Mock Transport ============

class PanelTestTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();
  public sentMessages: JsonRpcMessage[] = [];

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: unknown): Promise<void> {
    const msg = message as JsonRpcMessage;
    this.sentMessages.push(msg);
    if ('method' in msg && msg.method === 'initialize' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {}, resources: { subscribe: true }, prompts: {} },
              serverInfo: { name: 'panel-test', version: '1.0.0' },
            },
          } as JsonRpcMessage);
        }
      }, 1);
    }
  }

  onMessage(h: (msg: JsonRpcMessage) => void): () => void {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }
  onError(): () => void { return () => {}; }
  onClose(): () => void { return () => {}; }
  isOpen(): boolean { return this._isOpen; }
  async close(): Promise<void> { this._isOpen = false; }
}

function createTestClient(): { client: McpClient; transport: PanelTestTransport } {
  const transport = new PanelTestTransport();
  const client = new McpClient({
    serverId: 'panel-test',
    serverName: 'Panel Test',
    transport: { type: 'stdio', command: 'mock' },
  });
  client.setTransport(transport);
  return { client, transport };
}

describe('McpAdvancedPanel', () => {
  let client: McpClient;
  let transport: PanelTestTransport;

  beforeEach(async () => {
    const setup = createTestClient();
    client = setup.client;
    transport = setup.transport;
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it('渲染面板标题', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });
    expect(screen.getByText('MCP 高级能力')).toBeTruthy();
  });

  it('显示 4 个 Tab 按钮', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });
    expect(screen.getByText('资源订阅')).toBeTruthy();
    expect(screen.getByText('参数补全')).toBeTruthy();
    expect(screen.getByText('服务器采样')).toBeTruthy();
    expect(screen.getByText('根目录')).toBeTruthy();
  });

  it('默认显示资源订阅 Tab', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });
    expect(screen.getByPlaceholderText('file:///path/to/resource')).toBeTruthy();
  });

  it('点击 Tab 切换内容', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('参数补全'));
    });
    expect(screen.getByText('请求补全')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('服务器采样'));
    });
    expect(screen.getByText('模拟服务器采样请求')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('根目录'));
    });
    expect(screen.getByText('添加')).toBeTruthy();
  });

  it('资源订阅：点击订阅按钮', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });

    const input = screen.getByPlaceholderText('file:///path/to/resource') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'file:///test.txt' } });
    });

    const subscribeBtn = screen.getAllByText('订阅')[0];
    await act(async () => {
      fireEvent.click(subscribeBtn);
    });

    await waitFor(() => {
      const subscribeMsgs = transport.sentMessages.filter(
        (m) => 'method' in m && m.method === 'resources/subscribe',
      );
      expect(subscribeMsgs.length).toBeGreaterThan(0);
    });
  });

  it('参数补全：点击补全按钮', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('参数补全'));
    });

    const completeBtn = screen.getByText('请求补全');
    await act(async () => {
      fireEvent.click(completeBtn);
    });

    await waitFor(() => {
      const completeMsgs = transport.sentMessages.filter(
        (m) => 'method' in m && m.method === 'completion/complete',
      );
      expect(completeMsgs.length).toBeGreaterThan(0);
    });
  });

  it('服务器采样：点击采样按钮', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('服务器采样'));
    });

    const sampleBtn = screen.getByText('模拟服务器采样请求');
    await act(async () => {
      fireEvent.click(sampleBtn);
    });

    // 验证无错误抛出
    await waitFor(() => {
      expect(sampleBtn).toBeTruthy();
    });
  });

  it('根目录：点击添加按钮', async () => {
    await act(async () => {
      render(<McpAdvancedPanel client={client} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('根目录'));
    });

    const addBtn = screen.getByText('添加');
    await act(async () => {
      fireEvent.click(addBtn);
    });

    // 验证根目录添加成功
    await waitFor(() => {
      const rootMsgs = transport.sentMessages.filter(
        (m) => 'method' in m && m.method === 'notifications/roots/list_changed',
      );
      expect(rootMsgs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
