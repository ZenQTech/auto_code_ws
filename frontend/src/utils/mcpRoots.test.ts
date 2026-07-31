/**
 * # ============================================================
 * # MCP Roots 单元测试 (v1.0.0 Cycle 41 G41-04)
 * # ============================================================
 * # 覆盖：RootsManager 全功能
 * #       - URI 解析 / 校验 / 规范化
 * #       - 根目录增删改查
 * #       - 路径包含关系
 * #       - 事件分发
 * #       - 客户端通知
 * #       - 集成测试（与 McpClient 联动）
 * #       - 性能基准
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-04 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RootsManager,
  createRootsManager,
  parseRootUri,
  validateRootUri,
  normalizeRootUri,
  type Root,
  type RootEvent,
} from './mcpRoots';
import { McpClient } from './mcpClient';
import type { McpTransport } from './mcpTransport';
import type { JsonRpcMessage } from './mcpTypes';

// ============ Mock Client for Notify ============

class MockRootsClient {
  public notifyCalls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  public state: 'idle' | 'connecting' | 'ready' | 'closed' | 'error' = 'ready';

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    this.notifyCalls.push({ method, params });
  }

  getState(): 'idle' | 'connecting' | 'ready' | 'closed' | 'error' {
    return this.state;
  }
}

// ============ URI 解析测试 ============

describe('RootsManager - URI 解析', () => {
  it('parseRootUri 解析 file:// 协议', () => {
    const result = parseRootUri('file:///home/user');
    expect(result.valid).toBe(true);
    expect(result.protocol).toBe('file');
    expect(result.path).toBe('/home/user');
  });

  it('parseRootUri 解析其他协议', () => {
    const result = parseRootUri('https://example.com/api');
    expect(result.valid).toBe(true);
    expect(result.protocol).toBe('https');
    expect(result.path).toBe('example.com/api');
  });

  it('parseRootUri 拒绝非法 URI', () => {
    expect(parseRootUri('not-a-uri').valid).toBe(false);
    expect(parseRootUri('://missing-protocol').valid).toBe(false);
    expect(parseRootUri('').valid).toBe(false);
  });

  it('parseRootUri 拒绝非字符串', () => {
    expect(parseRootUri(null as unknown as string).valid).toBe(false);
    expect(parseRootUri(undefined as unknown as string).valid).toBe(false);
  });

  it('validateRootUri 校验成功', () => {
    expect(validateRootUri('file:///home')).toBe(true);
    expect(validateRootUri('https://api.com')).toBe(true);
  });

  it('validateRootUri 校验失败', () => {
    expect(validateRootUri('bad')).toBe(false);
  });

  it('normalizeRootUri 去除末尾斜杠', () => {
    expect(normalizeRootUri('file:///home/user/')).toBe('file:///home/user');
    expect(normalizeRootUri('file:///home/user///')).toBe('file:///home/user');
  });

  it('normalizeRootUri 保留合法路径', () => {
    expect(normalizeRootUri('file:///home/user')).toBe('file:///home/user');
  });

  it('normalizeRootUri 非法输入原样返回', () => {
    expect(normalizeRootUri('not-a-uri')).toBe('not-a-uri');
  });
});

// ============ 增删改查测试 ============

describe('RootsManager - 增删改查', () => {
  let manager: RootsManager;

  beforeEach(() => {
    manager = new RootsManager({ autoNotify: false });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('添加根目录', () => {
    const result = manager.add({ uri: 'file:///home/user', name: 'Home' });
    expect(result).toBe(true);
    expect(manager.size()).toBe(1);
  });

  it('添加重复根目录返回 false', () => {
    manager.add({ uri: 'file:///home/user' });
    const result = manager.add({ uri: 'file:///home/user' });
    expect(result).toBe(false);
    expect(manager.size()).toBe(1);
  });

  it('添加不同形式但等价的根目录被规范化去重', () => {
    manager.add({ uri: 'file:///home/user/' });
    const result = manager.add({ uri: 'file:///home/user' });
    expect(result).toBe(false);
    expect(manager.size()).toBe(1);
  });

  it('添加非法 URI 抛出错误', () => {
    expect(() => manager.add({ uri: 'bad-uri' })).toThrow();
  });

  it('移除根目录', () => {
    manager.add({ uri: 'file:///home/user' });
    const result = manager.remove('file:///home/user');
    expect(result).toBe(true);
    expect(manager.size()).toBe(0);
  });

  it('移除不存在的根目录返回 false', () => {
    expect(manager.remove('file:///not-exist')).toBe(false);
  });

  it('更新根目录名称', () => {
    manager.add({ uri: 'file:///home/user', name: 'Old' });
    const result = manager.update('file:///home/user', { name: 'New' });
    expect(result).toBe(true);
    expect(manager.get('file:///home/user')?.name).toBe('New');
  });

  it('更新不存在的根目录返回 false', () => {
    expect(manager.update('file:///nope', { name: 'X' })).toBe(false);
  });

  it('更新保留原始 URI', () => {
    manager.add({ uri: 'file:///home/user' });
    manager.update('file:///home/user', { uri: 'file:///different' });
    expect(manager.get('file:///home/user')?.uri).toBe('file:///home/user');
  });

  it('清空所有根目录', () => {
    manager.add({ uri: 'file:///a' });
    manager.add({ uri: 'file:///b' });
    manager.clear();
    expect(manager.size()).toBe(0);
  });

  it('清空空集合不触发事件', () => {
    const listener = vi.fn();
    manager.on(listener);
    manager.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it('get 获取根目录', () => {
    manager.add({ uri: 'file:///home', name: 'Home' });
    const root = manager.get('file:///home');
    expect(root?.name).toBe('Home');
  });

  it('get 不存在的根目录返回 undefined', () => {
    expect(manager.get('file:///nope')).toBeUndefined();
  });

  it('list 列出所有根目录', () => {
    manager.add({ uri: 'file:///a' });
    manager.add({ uri: 'file:///b' });
    const list = manager.list();
    expect(list.length).toBe(2);
  });
});

// ============ 路径包含关系 ============

describe('RootsManager - 路径包含关系', () => {
  let manager: RootsManager;

  beforeEach(() => {
    manager = new RootsManager({ autoNotify: false });
  });

  it('contains 匹配完全相等', () => {
    manager.add({ uri: 'file:///home/user' });
    expect(manager.contains('file:///home/user')).toBe(true);
  });

  it('contains 匹配子路径', () => {
    manager.add({ uri: 'file:///home/user' });
    expect(manager.contains('file:///home/user/documents')).toBe(true);
  });

  it('contains 拒绝前缀相似的非子路径', () => {
    manager.add({ uri: 'file:///home/user' });
    expect(manager.contains('file:///home/user-other')).toBe(false);
  });

  it('contains 拒绝非根目录下的路径', () => {
    manager.add({ uri: 'file:///home/user' });
    expect(manager.contains('file:///etc/config')).toBe(false);
  });

  it('findRoot 找到最长匹配的根目录', () => {
    manager.add({ uri: 'file:///home' });
    manager.add({ uri: 'file:///home/user' });
    const root = manager.findRoot('file:///home/user/docs');
    expect(root?.uri).toBe('file:///home/user');
  });

  it('findRoot 找不到时返回 undefined', () => {
    manager.add({ uri: 'file:///home' });
    expect(manager.findRoot('file:///etc')).toBeUndefined();
  });
});

// ============ 事件分发 ============

describe('RootsManager - 事件分发', () => {
  let manager: RootsManager;
  let events: RootEvent[];

  beforeEach(() => {
    manager = new RootsManager({ autoNotify: false });
    events = [];
    manager.on((e) => events.push(e));
  });

  it('添加触发 added 事件', () => {
    manager.add({ uri: 'file:///a', name: 'A' });
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('added');
    if (events[0].type === 'added') {
      expect(events[0].root.uri).toBe('file:///a');
    }
  });

  it('移除触发 removed 事件', () => {
    manager.add({ uri: 'file:///a' });
    events.length = 0;
    manager.remove('file:///a');
    expect(events[0].type).toBe('removed');
  });

  it('更新触发 updated 事件', () => {
    manager.add({ uri: 'file:///a', name: 'Old' });
    events.length = 0;
    manager.update('file:///a', { name: 'New' });
    expect(events[0].type).toBe('updated');
    if (events[0].type === 'updated') {
      expect(events[0].root.name).toBe('New');
      expect(events[0].previous.name).toBe('Old');
    }
  });

  it('清空触发 cleared 事件', () => {
    manager.add({ uri: 'file:///a' });
    events.length = 0;
    manager.clear();
    expect(events[0].type).toBe('cleared');
  });

  it('on 返回取消订阅函数', () => {
    const listener = vi.fn();
    const off = manager.on(listener);
    off();
    manager.add({ uri: 'file:///a' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('监听器异常不影响其他监听器', () => {
    const safe = vi.fn();
    manager.on(() => {
      throw new Error('listener error');
    });
    manager.on(safe);
    manager.add({ uri: 'file:///a' });
    expect(safe).toHaveBeenCalled();
  });
});

// ============ 客户端通知 ============

describe('RootsManager - 客户端通知', () => {
  it('autoNotify=true 时通知客户端', () => {
    const manager = new RootsManager({ autoNotify: true });
    const mockClient = new MockRootsClient();
    // 模拟 cast 兼容 McpClient 接口
    manager.attachClient(mockClient as unknown as McpClient);

    manager.add({ uri: 'file:///a' });
    expect(mockClient.notifyCalls.length).toBe(1);
    expect(mockClient.notifyCalls[0].method).toBe('notifications/roots/list_changed');
    manager.dispose();
  });

  it('autoNotify=false 时不通知', () => {
    const manager = new RootsManager({ autoNotify: false });
    const mockClient = new MockRootsClient();
    manager.attachClient(mockClient as unknown as McpClient);

    manager.add({ uri: 'file:///a' });
    expect(mockClient.notifyCalls.length).toBe(0);
    manager.dispose();
  });

  it('未绑定客户端时静默', () => {
    const manager = new RootsManager({ autoNotify: true });
    // 不 attachClient
    expect(() => manager.add({ uri: 'file:///a' })).not.toThrow();
    manager.dispose();
  });

  it('客户端非 ready 状态不通知', () => {
    const manager = new RootsManager({ autoNotify: true });
    const mockClient = new MockRootsClient();
    mockClient.state = 'connecting';
    manager.attachClient(mockClient as unknown as McpClient);

    manager.add({ uri: 'file:///a' });
    expect(mockClient.notifyCalls.length).toBe(0);
    manager.dispose();
  });

  it('attachClient 替换客户端', () => {
    const manager = new RootsManager({ autoNotify: true });
    const c1 = new MockRootsClient();
    const c2 = new MockRootsClient();
    manager.attachClient(c1 as unknown as McpClient);
    manager.attachClient(c2 as unknown as McpClient);

    manager.add({ uri: 'file:///a' });
    expect(c1.notifyCalls.length).toBe(0);
    expect(c2.notifyCalls.length).toBe(1);
    manager.dispose();
  });

  it('dispose 清理资源', () => {
    const manager = new RootsManager({ autoNotify: true });
    const c = new MockRootsClient();
    manager.attachClient(c as unknown as McpClient);
    manager.add({ uri: 'file:///a' });
    manager.dispose();

    // 清理后再 add 不触发通知（client 已被清空）
    c.notifyCalls.length = 0;
    manager.add({ uri: 'file:///b' });
    expect(c.notifyCalls.length).toBe(0);
  });

  it('createRootsManager 工厂函数', () => {
    const m = createRootsManager({ autoNotify: false });
    expect(m).toBeInstanceOf(RootsManager);
    m.add({ uri: 'file:///a' });
    expect(m.size()).toBe(1);
  });
});

// ============ 集成测试：与 McpClient 联动 ============

class RootsIntegrationTransport implements McpTransport {
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
              capabilities: { tools: {}, resources: {}, prompts: {} },
              serverInfo: { name: 'roots-test', version: '1.0.0' },
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
  onError(): () => void {
    return () => {};
  }
  onClose(): () => void {
    return () => {};
  }
  isOpen(): boolean {
    return this._isOpen;
  }
  async close(): Promise<void> {
    this._isOpen = false;
  }
}

describe('RootsManager - 与 McpClient 集成', () => {
  it('通过 McpClient 通知服务器', async () => {
    const transport = new RootsIntegrationTransport();
    const client = new McpClient({
      serverId: 'test',
      serverName: 'Test',
      transport: { type: 'stdio', command: 'mock' },
    });
    client.setTransport(transport);
    await client.connect();

    const manager = new RootsManager({ autoNotify: true });
    manager.attachClient(client);

    manager.add({ uri: 'file:///home/user' });

    // 等待异步通知
    await new Promise((r) => setTimeout(r, 10));

    // 验证 send 方法被调用
    const notifyMessages = transport.sentMessages.filter(
      (m) => 'method' in m && m.method === 'notifications/roots/list_changed',
    );
    expect(notifyMessages.length).toBeGreaterThanOrEqual(1);

    manager.dispose();
    await client.disconnect();
  });
});

// ============ 性能基准 ============

describe('RootsManager - 性能基准', () => {
  it('添加 1000 个根目录 < 50ms', () => {
    const manager = new RootsManager({ autoNotify: false });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      manager.add({ uri: `file:///dir${i}` });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    manager.dispose();
  });

  it('contains 10000 次查询 < 50ms', () => {
    const manager = new RootsManager({ autoNotify: false });
    manager.add({ uri: 'file:///home/user' });
    manager.add({ uri: 'file:///var/log' });
    manager.add({ uri: 'file:///etc' });

    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      manager.contains('file:///home/user/docs');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    manager.dispose();
  });

  it('list 1000 个根目录 < 10ms', () => {
    const manager = new RootsManager({ autoNotify: false });
    for (let i = 0; i < 1000; i++) {
      manager.add({ uri: `file:///dir${i}` });
    }
    const start = performance.now();
    const list = manager.list();
    const elapsed = performance.now() - start;
    expect(list.length).toBe(1000);
    expect(elapsed).toBeLessThan(10);
    manager.dispose();
  });
});
