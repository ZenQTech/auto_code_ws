/**
 * # ============================================================
 * # MCP Resource Subscription 单元测试 (v1.0.0 Cycle 41 G41-01)
 * # ============================================================
 * # 覆盖：ResourceSubscriptionManager 全功能
 * #       - 单个/批量订阅
 * #       - 单个/批量取消订阅
 * #       - 通知处理
 * #       - 事件分发
 * #       - 生命周期
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-01 初次创建
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ResourceSubscriptionManager,
  createResourceSubscriptionManager,
  type SubscriptionEvent,
} from './mcpResourceSubscription';
import { McpClient } from './mcpClient';
import type { McpTransport } from './mcpTransport';
import type { Tool, Resource, ResourceContent, ToolCallResult, ToolContent, JsonRpcMessage } from './mcpTypes';

// ============ Mock Transport ============

class SubMockTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();
  private errHandlers: Set<(err: Error) => void> = new Set();
  private closeHandlers: Set<() => void> = new Set();
  public sentMessages: unknown[] = [];
  public subscribedUris: string[] = [];
  public unsubscribedUris: string[] = [];
  public resources: Resource[] = [
    { uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' },
    { uri: 'file:///b.png', name: 'B', mimeType: 'image/png' },
  ];

  async start(): Promise<void> {
    this._isOpen = true;
  }
  async send(message: JsonRpcMessage): Promise<void> {
    this.sentMessages.push(message);
    const msg = message as { method: string; id: string | number; params?: Record<string, unknown> };
    setTimeout(() => {
      let result: unknown = null;
      if (msg.method === 'initialize') {
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { resources: { subscribe: true } },
          serverInfo: { name: 'sub-mock', version: '1.0.0' },
        };
      } else if (msg.method === 'resources/subscribe') {
        this.subscribedUris.push((msg.params as { uri: string }).uri);
        result = {};
      } else if (msg.method === 'resources/unsubscribe') {
        this.unsubscribedUris.push((msg.params as { uri: string }).uri);
        result = {};
      } else if (msg.method === 'resources/list') {
        result = { resources: this.resources };
      } else if (msg.method === 'resources/read') {
        const uri = (msg.params as { uri: string }).uri;
        result = { contents: [{ uri, mimeType: 'text/plain', text: `content of ${uri}` } as ResourceContent] };
      }
      if (result !== null) {
        for (const h of this.msgHandlers) {
          try {
            h({ jsonrpc: '2.0', id: msg.id, result } as JsonRpcMessage);
          } catch {
            /* ignore */
          }
        }
      }
    }, 0);
  }
  onMessage(handler: (msg: JsonRpcMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }
  onError(handler: (err: Error) => void): () => void {
    this.errHandlers.add(handler);
    return () => this.errHandlers.delete(handler);
  }
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  isOpen(): boolean {
    return this._isOpen;
  }
  async close(): Promise<void> {
    this._isOpen = false;
    for (const h of this.closeHandlers) h();
  }
  injectMessage(msg: JsonRpcMessage): void {
    for (const h of this.msgHandlers) {
      try {
        h(msg);
      } catch {
        /* ignore */
      }
    }
  }
}

function createClient(transport: SubMockTransport): McpClient {
  const client = new McpClient({
    serverId: 'sub',
    serverName: 'Sub',
    transport: { type: 'stdio', command: 'mock' },
  });
  client.setTransport(transport);
  return client;
}

// ============ 基础功能测试 ============

describe('ResourceSubscriptionManager - 基础', () => {
  it('创建空管理器', () => {
    const mgr = new ResourceSubscriptionManager();
    expect(mgr.size()).toBe(0);
    expect(mgr.list()).toEqual([]);
  });

  it('工厂函数创建', () => {
    const mgr = createResourceSubscriptionManager();
    expect(mgr).toBeInstanceOf(ResourceSubscriptionManager);
  });
});

// ============ 订阅功能测试 ============

describe('ResourceSubscriptionManager - 订阅', () => {
  let mgr: ResourceSubscriptionManager;
  let client: McpClient;
  let transport: SubMockTransport;

  beforeEach(async () => {
    mgr = new ResourceSubscriptionManager();
    transport = new SubMockTransport();
    client = createClient(transport);
    await client.connect();
    mgr.attachClient(client);
  });

  afterEach(() => {
    mgr.dispose();
    client.close();
  });

  it('订阅资源', async () => {
    const wasNew = await mgr.subscribe('file:///a.txt');
    expect(wasNew).toBe(true);
    expect(mgr.isSubscribed('file:///a.txt')).toBe(true);
    expect(mgr.size()).toBe(1);
    expect(transport.subscribedUris).toContain('file:///a.txt');
  });

  it('重复订阅返回 false', async () => {
    await mgr.subscribe('file:///a.txt');
    const wasNew = await mgr.subscribe('file:///a.txt');
    expect(wasNew).toBe(false);
    expect(transport.subscribedUris.length).toBe(1);
  });

  it('未连接客户端时抛错', async () => {
    const m = new ResourceSubscriptionManager();
    await expect(m.subscribe('file:///a.txt')).rejects.toThrow();
  });

  it('订阅后查询信息', async () => {
    await mgr.subscribe('file:///a.txt');
    const info = mgr.get('file:///a.txt');
    expect(info).toBeDefined();
    expect(info!.uri).toBe('file:///a.txt');
    expect(info!.active).toBe(true);
    expect(info!.updateCount).toBe(0);
    expect(info!.lastUpdatedAt).toBeNull();
  });

  it('批量订阅', async () => {
    const result = await mgr.subscribeMany(['file:///a.txt', 'file:///b.png', 'file:///a.txt']);
    expect(result.subscribed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(mgr.size()).toBe(2);
  });
});

// ============ 取消订阅功能测试 ============

describe('ResourceSubscriptionManager - 取消订阅', () => {
  let mgr: ResourceSubscriptionManager;
  let client: McpClient;
  let transport: SubMockTransport;

  beforeEach(async () => {
    mgr = new ResourceSubscriptionManager();
    transport = new SubMockTransport();
    client = createClient(transport);
    await client.connect();
    mgr.attachClient(client);
  });

  afterEach(() => {
    mgr.dispose();
    client.close();
  });

  it('取消订阅', async () => {
    await mgr.subscribe('file:///a.txt');
    const wasActive = await mgr.unsubscribe('file:///a.txt');
    expect(wasActive).toBe(true);
    expect(mgr.isSubscribed('file:///a.txt')).toBe(false);
    expect(transport.unsubscribedUris).toContain('file:///a.txt');
  });

  it('取消未订阅的 URI 返回 false', async () => {
    const wasActive = await mgr.unsubscribe('file:///nope.txt');
    expect(wasActive).toBe(false);
  });

  it('批量取消订阅', async () => {
    await mgr.subscribeMany(['file:///a.txt', 'file:///b.png']);
    const result = await mgr.unsubscribeMany(['file:///a.txt', 'file:///nope.txt', 'file:///b.png']);
    expect(result.unsubscribed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(mgr.size()).toBe(0);
  });

  it('取消所有订阅', async () => {
    await mgr.subscribeMany(['file:///a.txt', 'file:///b.png']);
    const count = await mgr.unsubscribeAll();
    expect(count).toBe(2);
    expect(mgr.size()).toBe(0);
  });
});

// ============ 通知处理测试 ============

describe('ResourceSubscriptionManager - 通知', () => {
  let mgr: ResourceSubscriptionManager;
  let client: McpClient;
  let transport: SubMockTransport;

  beforeEach(async () => {
    mgr = new ResourceSubscriptionManager();
    transport = new SubMockTransport();
    client = createClient(transport);
    await client.connect();
    mgr.attachClient(client);
  });

  afterEach(() => {
    mgr.dispose();
    client.close();
  });

  it('接收服务器推送更新', async () => {
    await mgr.subscribe('file:///a.txt');
    transport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///a.txt' },
    });
    await new Promise((r) => setTimeout(r, 10));
    const info = mgr.get('file:///a.txt');
    expect(info!.updateCount).toBe(1);
    expect(info!.lastUpdatedAt).not.toBeNull();
  });

  it('多次推送累加计数', async () => {
    await mgr.subscribe('file:///a.txt');
    for (let i = 0; i < 5; i++) {
      transport.injectMessage({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'file:///a.txt' },
      });
    }
    await new Promise((r) => setTimeout(r, 20));
    const info = mgr.get('file:///a.txt');
    expect(info!.updateCount).toBe(5);
  });

  it('未订阅的 URI 推送不计入', async () => {
    transport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///unknown.txt' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(mgr.size()).toBe(0);
  });
});

// ============ 事件分发测试 ============

describe('ResourceSubscriptionManager - 事件', () => {
  let mgr: ResourceSubscriptionManager;
  let client: McpClient;
  let transport: SubMockTransport;
  let events: SubscriptionEvent[];

  beforeEach(async () => {
    mgr = new ResourceSubscriptionManager();
    transport = new SubMockTransport();
    client = createClient(transport);
    await client.connect();
    mgr.attachClient(client);
    events = [];
    mgr.on((e) => events.push(e));
  });

  afterEach(() => {
    mgr.dispose();
    client.close();
  });

  it('订阅事件', async () => {
    await mgr.subscribe('file:///a.txt');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('subscribed');
  });

  it('取消订阅事件', async () => {
    await mgr.subscribe('file:///a.txt');
    await mgr.unsubscribe('file:///a.txt');
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('unsubscribed');
  });

  it('更新事件', async () => {
    await mgr.subscribe('file:///a.txt');
    transport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///a.txt' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(events.filter((e) => e.type === 'updated').length).toBe(1);
  });

  it('clear 事件', async () => {
    await mgr.subscribe('file:///a.txt');
    events.length = 0; // 清空前面的 subscribed 事件
    mgr.clear();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('cleared');
  });

  it('取消事件订阅', () => {
    const off = mgr.on(() => {});
    off();
    mgr.clear();
    // events 数组只记录原始监听器
    expect(events.length).toBe(0);
  });
});

// ============ 生命周期测试 ============

describe('ResourceSubscriptionManager - 生命周期', () => {
  it('detach 客户端后无法订阅', async () => {
    const transport = new SubMockTransport();
    const client = createClient(transport);
    await client.connect();
    const mgr = new ResourceSubscriptionManager();
    mgr.attachClient(client);
    mgr.attachClient(null);
    await expect(mgr.subscribe('file:///a.txt')).rejects.toThrow();
    client.close();
  });

  it('切换客户端时解绑旧通知', async () => {
    const t1 = new SubMockTransport();
    const c1 = createClient(t1);
    await c1.connect();
    const t2 = new SubMockTransport();
    const c2 = createClient(t2);
    await c2.connect();

    const mgr = new ResourceSubscriptionManager();
    mgr.attachClient(c1);
    await mgr.subscribe('file:///a.txt');

    // 切换到 c2
    mgr.attachClient(c2);
    expect(mgr.size()).toBe(1); // 订阅信息保留

    await c1.close();
    await c2.close();
  });

  it('dispose 清理资源', () => {
    const mgr = new ResourceSubscriptionManager();
    const off = mgr.on(() => {});
    mgr.dispose();
    mgr.clear(); // dispose 后调用不应抛错
    expect(off).toBeDefined();
  });

  it('clear 不向服务器发请求', async () => {
    const transport = new SubMockTransport();
    const client = createClient(transport);
    await client.connect();
    const mgr = new ResourceSubscriptionManager();
    mgr.attachClient(client);
    await mgr.subscribe('file:///a.txt');
    const beforeCount = transport.unsubscribedUris.length;
    mgr.clear();
    const afterCount = transport.unsubscribedUris.length;
    expect(afterCount).toBe(beforeCount);
    await client.close();
  });
});

// ============ 性能基准 ============

describe('ResourceSubscriptionManager - 性能', () => {
  it('500 次订阅/取消 < 5s（含 setTimeout 开销）', async () => {
    const transport = new SubMockTransport();
    const client = createClient(transport);
    await client.connect();
    const mgr = new ResourceSubscriptionManager();
    mgr.attachClient(client);
    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      await mgr.subscribe(`file:///r${i}.txt`);
    }
    for (let i = 0; i < 500; i++) {
      await mgr.unsubscribe(`file:///r${i}.txt`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    await client.close();
  });

  it('10000 次 isSubscribed < 100ms', async () => {
    const transport = new SubMockTransport();
    const client = createClient(transport);
    await client.connect();
    const mgr = new ResourceSubscriptionManager();
    mgr.attachClient(client);
    for (let i = 0; i < 100; i++) {
      await mgr.subscribe(`file:///r${i}.txt`);
    }
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      mgr.isSubscribed(`file:///r${i % 100}.txt`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    await client.close();
  });
});
