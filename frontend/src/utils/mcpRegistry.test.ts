/**
 * # ============================================================
 * # MCP Server Registry - 单元测试 (v1.0.0 Cycle 39 G39-02)
 * # ============================================================
 * # 覆盖：内置服务器、注册/注销、查询、连接管理、事件订阅、持久化、统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-02 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  McpServerRegistry,
  BUILTIN_MCP_SERVERS,
  BUILTIN_FILESYSTEM,
  BUILTIN_GIT,
  BUILTIN_GITHUB,
  BUILTIN_FETCH,
  BUILTIN_SQLITE,
  getDefaultMcpServerRegistry,
  resetDefaultMcpServerRegistry,
  createMcpServerRegistry,
  computeRegistryStats,
  MCP_CATEGORY_META,
  type McpServerDefinition,
  type McpRegistryListener,
} from './mcpRegistry';
import { MCP_PROTOCOL_VERSION } from './mcpTypes';

describe('内置 MCP 服务器', () => {
  it('包含 5 个内置服务器', () => {
    expect(BUILTIN_MCP_SERVERS.length).toBe(5);
  });

  it('所有内置服务器 ID 唯一', () => {
    const ids = BUILTIN_MCP_SERVERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('所有内置服务器 marked as builtin', () => {
    for (const s of BUILTIN_MCP_SERVERS) {
      expect(s.builtin).toBe(true);
    }
  });

  it('Filesystem 配置正确', () => {
    expect(BUILTIN_FILESYSTEM.id).toBe('builtin.filesystem');
    expect(BUILTIN_FILESYSTEM.category).toBe('filesystem');
    expect(BUILTIN_FILESYSTEM.transport.type).toBe('stdio');
  });

  it('Git 配置正确', () => {
    expect(BUILTIN_GIT.id).toBe('builtin.git');
    expect(BUILTIN_GIT.category).toBe('version-control');
  });

  it('GitHub 配置正确', () => {
    expect(BUILTIN_GITHUB.id).toBe('builtin.github');
  });

  it('Fetch 配置正确', () => {
    expect(BUILTIN_FETCH.id).toBe('builtin.fetch');
    expect(BUILTIN_FETCH.category).toBe('network');
  });

  it('SQLite 配置正确', () => {
    expect(BUILTIN_SQLITE.id).toBe('builtin.sqlite');
    expect(BUILTIN_SQLITE.category).toBe('database');
  });

  it('内置服务器 default enable 配置正确', () => {
    // 只有 Fetch 默认启用
    expect(BUILTIN_FETCH.enabledByDefault).toBe(true);
    expect(BUILTIN_FILESYSTEM.enabledByDefault).toBe(false);
    expect(BUILTIN_GIT.enabledByDefault).toBe(false);
    expect(BUILTIN_GITHUB.enabledByDefault).toBe(false);
    expect(BUILTIN_SQLITE.enabledByDefault).toBe(false);
  });

  it('内置服务器包含必要字段', () => {
    for (const s of BUILTIN_MCP_SERVERS) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.transport.type).toMatch(/stdio|sse/);
      expect(s.icon).toBeTruthy();
      expect(Array.isArray(s.tags)).toBe(true);
      expect(s.version).toBeTruthy();
    }
  });
});

describe('McpServerRegistry 基础', () => {
  let registry: McpServerRegistry;

  beforeEach(() => {
    resetDefaultMcpServerRegistry();
    registry = createMcpServerRegistry({ persistEnabled: false });
  });

  afterEach(() => {
    registry.disconnectAll().catch(() => {
      /* ignore */
    });
  });

  it('自动注册 5 个内置服务器', () => {
    expect(registry.size()).toBe(5);
    expect(registry.has('builtin.filesystem')).toBe(true);
    expect(registry.has('builtin.git')).toBe(true);
    expect(registry.has('builtin.github')).toBe(true);
    expect(registry.has('builtin.fetch')).toBe(true);
    expect(registry.has('builtin.sqlite')).toBe(true);
  });

  it('get 返回服务器定义', () => {
    const def = registry.get('builtin.filesystem');
    expect(def?.id).toBe('builtin.filesystem');
    expect(def?.name).toBe('Filesystem');
  });

  it('get 未知 ID 返回 undefined', () => {
    expect(registry.get('not-exist')).toBeUndefined();
  });

  it('list 返回所有定义', () => {
    const list = registry.list();
    expect(list.length).toBe(5);
  });

  it('list 按 category 过滤', () => {
    const list = registry.list({ category: 'filesystem' });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('builtin.filesystem');
  });

  it('list 按 builtin 过滤', () => {
    const builtins = registry.list({ builtin: true });
    expect(builtins.length).toBe(5);
    const customs = registry.list({ builtin: false });
    expect(customs.length).toBe(0);
  });
});

describe('McpServerRegistry 添加/删除/更新', () => {
  let registry: McpServerRegistry;

  beforeEach(() => {
    resetDefaultMcpServerRegistry();
    registry = createMcpServerRegistry({ persistEnabled: false });
  });

  it('add 添加自定义服务器', () => {
    const def: McpServerDefinition = {
      id: 'custom.test',
      name: 'Test Server',
      description: '测试服务器',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'test-cmd' },
      enabledByDefault: false,
      builtin: false,
      tags: ['test'],
      version: '1.0.0',
    };
    expect(registry.add(def)).toBe(true);
    expect(registry.has('custom.test')).toBe(true);
    expect(registry.size()).toBe(6);
  });

  it('add 重复 ID 失败', () => {
    const def: McpServerDefinition = {
      id: 'builtin.filesystem',
      name: 'X',
      description: 'X',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'x' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    };
    expect(registry.add(def)).toBe(false);
  });

  it('remove 删除自定义服务器', () => {
    const def: McpServerDefinition = {
      id: 'custom.removable',
      name: 'R',
      description: 'R',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'r' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    };
    registry.add(def);
    expect(registry.remove('custom.removable')).toBe(true);
    expect(registry.has('custom.removable')).toBe(false);
  });

  it('remove 不能删除内置服务器', () => {
    expect(registry.remove('builtin.filesystem')).toBe(false);
    expect(registry.has('builtin.filesystem')).toBe(true);
  });

  it('remove 不存在的服务器返回 false', () => {
    expect(registry.remove('not-exist')).toBe(false);
  });

  it('update 更新服务器定义', () => {
    const ok = registry.update('builtin.filesystem', { description: 'New desc' });
    expect(ok).toBe(true);
    expect(registry.get('builtin.filesystem')?.description).toBe('New desc');
  });

  it('update 不能改 ID', () => {
    registry.update('builtin.filesystem', { id: 'changed' } as Partial<McpServerDefinition>);
    expect(registry.has('changed')).toBe(false);
    expect(registry.has('builtin.filesystem')).toBe(true);
  });

  it('update 不存在的服务器返回 false', () => {
    expect(registry.update('not-exist', { description: 'x' })).toBe(false);
  });
});

describe('McpServerRegistry 事件订阅', () => {
  let registry: McpServerRegistry;
  let listener: McpRegistryListener;

  beforeEach(() => {
    resetDefaultMcpServerRegistry();
    registry = createMcpServerRegistry({ persistEnabled: false });
    listener = vi.fn();
  });

  it('subscribe 接收 add 事件', () => {
    registry.subscribe(listener);
    registry.add({
      id: 'evt.add',
      name: 'X',
      description: 'X',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'x' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    });
    expect(listener).toHaveBeenCalledWith('server-added', 'evt.add');
  });

  it('subscribe 接收 remove 事件', () => {
    registry.subscribe(listener);
    registry.add({
      id: 'evt.rm',
      name: 'X',
      description: 'X',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'x' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    });
    (listener as ReturnType<typeof vi.fn>).mockClear();
    registry.remove('evt.rm');
    expect(listener).toHaveBeenCalledWith('server-removed', 'evt.rm');
  });

  it('subscribe 接收 update 事件', () => {
    registry.subscribe(listener);
    registry.update('builtin.filesystem', { description: 'changed' });
    expect(listener).toHaveBeenCalledWith('server-updated', 'builtin.filesystem');
  });

  it('unsubscribe 取消订阅', () => {
    const unsub = registry.subscribe(listener);
    unsub();
    registry.update('builtin.filesystem', { description: 'x' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('listener 异常不影响其他 listener', () => {
    const l1 = vi.fn(() => {
      throw new Error('boom');
    });
    const l2 = vi.fn();
    registry.subscribe(l1);
    registry.subscribe(l2);
    registry.update('builtin.filesystem', { description: 'x' });
    expect(l2).toHaveBeenCalled();
  });
});

describe('McpServerRegistry 状态管理', () => {
  let registry: McpServerRegistry;

  beforeEach(() => {
    resetDefaultMcpServerRegistry();
    registry = createMcpServerRegistry({ persistEnabled: false });
  });

  it('初始状态为未连接', () => {
    const status = registry.getStatus('builtin.filesystem');
    expect(status?.connected).toBe(false);
    expect(status?.client).toBeNull();
    expect(status?.toolCount).toBe(0);
  });

  it('getAllStatus 返回所有状态', () => {
    const all = registry.getAllStatus();
    expect(all.length).toBe(5);
  });

  it('getClient 未连接返回 undefined', () => {
    expect(registry.getClient('builtin.filesystem')).toBeUndefined();
  });

  it('listAllTools 空状态返回空数组', () => {
    expect(registry.listAllTools()).toEqual([]);
  });

  it('listAllResources 空状态返回空数组', () => {
    expect(registry.listAllResources()).toEqual([]);
  });

  it('listAllPrompts 空状态返回空数组', () => {
    expect(registry.listAllPrompts()).toEqual([]);
  });
});

describe('computeRegistryStats', () => {
  it('统计内置服务器', () => {
    resetDefaultMcpServerRegistry();
    const registry = createMcpServerRegistry({ persistEnabled: false });
    const stats = computeRegistryStats(registry);
    expect(stats.total).toBe(5);
    expect(stats.builtin).toBe(5);
    expect(stats.custom).toBe(0);
    expect(stats.connected).toBe(0);
    expect(stats.totalTools).toBe(0);
    expect(stats.byCategory['filesystem']).toBe(1);
    expect(stats.byCategory['version-control']).toBe(2);
    expect(stats.byCategory['network']).toBe(1);
    expect(stats.byCategory['database']).toBe(1);
  });

  it('统计混合内置+自定义', () => {
    resetDefaultMcpServerRegistry();
    const registry = createMcpServerRegistry({ persistEnabled: false });
    registry.add({
      id: 'custom.1',
      name: 'X',
      description: 'X',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'x' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    });
    const stats = computeRegistryStats(registry);
    expect(stats.total).toBe(6);
    expect(stats.builtin).toBe(5);
    expect(stats.custom).toBe(1);
  });
});

describe('MCP_CATEGORY_META', () => {
  it('包含所有分类', () => {
    const categories: Array<keyof typeof MCP_CATEGORY_META> = [
      'filesystem',
      'version-control',
      'network',
      'database',
      'search',
      'productivity',
      'ai',
      'custom',
    ];
    for (const c of categories) {
      expect(MCP_CATEGORY_META[c]).toBeDefined();
      expect(MCP_CATEGORY_META[c].label).toBeTruthy();
      expect(MCP_CATEGORY_META[c].icon).toBeTruthy();
      expect(MCP_CATEGORY_META[c].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('全局注册表', () => {
  beforeEach(() => {
    resetDefaultMcpServerRegistry();
  });

  it('getDefaultMcpServerRegistry 懒加载', () => {
    const r1 = getDefaultMcpServerRegistry();
    const r2 = getDefaultMcpServerRegistry();
    expect(r1).toBe(r2);
  });

  it('resetDefaultMcpServerRegistry 创建新实例', () => {
    const r1 = getDefaultMcpServerRegistry();
    resetDefaultMcpServerRegistry();
    const r2 = getDefaultMcpServerRegistry();
    expect(r1).not.toBe(r2);
  });
});

describe('持久化', () => {
  beforeEach(() => {
    resetDefaultMcpServerRegistry();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('add 后写入 localStorage', () => {
    const registry = createMcpServerRegistry({
      storageKey: 'test.mcp.registry',
      persistEnabled: true,
    });
    registry.add({
      id: 'persist.test',
      name: 'P',
      description: 'P',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'p' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    });
    const raw = localStorage.getItem('test.mcp.registry');
    expect(raw).toBeTruthy();
    const data = JSON.parse(raw!);
    expect(data.customServers).toBeDefined();
    expect(data.customServers.length).toBe(1);
    expect(data.customServers[0].id).toBe('persist.test');
  });

  it('从 localStorage 恢复自定义服务器', () => {
    localStorage.setItem(
      'restore.mcp.registry',
      JSON.stringify({
        version: 1,
        customServers: [
          {
            id: 'restored.test',
            name: 'R',
            description: 'R',
            category: 'custom',
            icon: 'puzzle',
            transport: { type: 'stdio', command: 'r' },
            enabledByDefault: false,
            builtin: false,
            tags: [],
            version: '1.0.0',
          },
        ],
      }),
    );
    const registry = createMcpServerRegistry({
      storageKey: 'restore.mcp.registry',
      persistEnabled: true,
    });
    expect(registry.has('restored.test')).toBe(true);
  });

  it('persistEnabled=false 不写入 localStorage', () => {
    const registry = createMcpServerRegistry({
      storageKey: 'no.persist',
      persistEnabled: false,
    });
    registry.add({
      id: 'no.persist.test',
      name: 'NP',
      description: 'NP',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'np' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    });
    const raw = localStorage.getItem('no.persist');
    expect(raw).toBeNull();
  });

  it('clearStorage 清除数据', () => {
    const registry = createMcpServerRegistry({
      storageKey: 'clear.test',
      persistEnabled: true,
    });
    registry.add({
      id: 'clear.test.x',
      name: 'X',
      description: 'X',
      category: 'custom',
      icon: 'puzzle',
      transport: { type: 'stdio', command: 'x' },
      enabledByDefault: false,
      builtin: false,
      tags: [],
      version: '1.0.0',
    });
    registry.clearStorage();
    const raw = localStorage.getItem('clear.test');
    expect(raw).toBeNull();
  });

  it('损坏的 localStorage 数据容错', () => {
    localStorage.setItem('corrupt.test', '{not valid json');
    expect(() =>
      createMcpServerRegistry({
        storageKey: 'corrupt.test',
        persistEnabled: true,
      }),
    ).not.toThrow();
  });
});

describe('连接管理 - connect/disconnect 错误处理', () => {
  it('connect 未知服务器抛错', async () => {
    resetDefaultMcpServerRegistry();
    const registry = createMcpServerRegistry({ persistEnabled: false });
    await expect(registry.connect('not-exist')).rejects.toThrow(/not found/i);
  });

  it('disconnect 不存在的服务器静默成功', async () => {
    resetDefaultMcpServerRegistry();
    const registry = createMcpServerRegistry({ persistEnabled: false });
    await expect(registry.disconnect('not-exist')).resolves.toBeUndefined();
  });

  it('disconnectAll 静默成功', async () => {
    resetDefaultMcpServerRegistry();
    const registry = createMcpServerRegistry({ persistEnabled: false });
    await expect(registry.disconnectAll()).resolves.toBeUndefined();
  });
});

describe('MCP_PROTOCOL_VERSION reference', () => {
  it('协议版本正确', () => {
    expect(MCP_PROTOCOL_VERSION).toBe('2024-11-05');
  });
});
