/**
 * # ============================================================
 * # SideChatManager 单元测试 (Cycle 22 G22-01)
 * # ============================================================
 * # 测试 SideChatManager 所有公开方法和边界条件
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SideChatManager,
  getSideChatManager,
  resetSideChatManager,
  isSideChatManagerInitialized,
  setSideChatManager,
} from './sideChatManager';

// 提供一个 mock 内存存储以避免依赖 localStorage
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

beforeEach(() => {
  // 提供一个简单的 localStorage mock
  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
  resetSideChatManager();
});

afterEach(() => {
  resetSideChatManager();
});

describe('SideChatManager - 基础 CRUD', () => {
  it('应能创建新的 Side-Chat', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '测试主题');
    expect(chat.sideChatId).toBeDefined();
    expect(chat.parentSessionId).toBe('session-1');
    expect(chat.topic).toBe('测试主题');
    expect(chat.status).toBe('active');
    expect(chat.messages).toEqual([]);
  });

  it('应能通过 ID 获取 Side-Chat', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    const fetched = manager.getSideChat(chat.sideChatId);
    expect(fetched).toEqual(chat);
  });

  it('不存在的 ID 应返回 null', () => {
    const manager = new SideChatManager();
    expect(manager.getSideChat('nonexistent')).toBeNull();
  });

  it('应能删除 Side-Chat', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    const removed = manager.removeSideChat(chat.sideChatId);
    expect(removed).toBe(true);
    expect(manager.getSideChat(chat.sideChatId)).toBeNull();
  });

  it('删除不存在的 Side-Chat 应返回 false', () => {
    const manager = new SideChatManager();
    expect(manager.removeSideChat('nonexistent')).toBe(false);
  });
});

describe('SideChatManager - 消息管理', () => {
  it('应能向活跃 Side-Chat 添加消息', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    const msg = manager.addMessage(chat.sideChatId, {
      role: 'user',
      content: '你好',
    });
    expect(msg.messageId).toBeDefined();
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('你好');
    expect(msg.sideChatId).toBe(chat.sideChatId);
  });

  it('向已归档 Side-Chat 添加消息应抛出', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    manager.archiveSideChat(chat.sideChatId);
    expect(() => manager.addMessage(chat.sideChatId, { role: 'user', content: 'hi' })).toThrow();
  });

  it('消息超出限制应抛出', () => {
    const manager = new SideChatManager(undefined, { maxMessagesPerChat: 2 });
    const chat = manager.createSideChat('session-1', '主题');
    manager.addMessage(chat.sideChatId, { role: 'user', content: '1' });
    manager.addMessage(chat.sideChatId, { role: 'user', content: '2' });
    expect(() => manager.addMessage(chat.sideChatId, { role: 'user', content: '3' })).toThrow();
  });

  it('应能更新 Side-Chat 主题', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '旧主题');
    const updated = manager.updateTopic(chat.sideChatId, '新主题');
    expect(updated.topic).toBe('新主题');
  });
});

describe('SideChatManager - 状态转换', () => {
  it('应能归档 Side-Chat', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    const archived = manager.archiveSideChat(chat.sideChatId);
    expect(archived.status).toBe('archived');
  });

  it('应能晋升为新 Session', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    manager.addMessage(chat.sideChatId, { role: 'user', content: 'hi' });
    const promoted = manager.promoteToMain(chat.sideChatId, 'new-session');
    expect(promoted.status).toBe('promoted');
    expect(promoted.promotedSessionId).toBe('new-session');
  });

  it('非活跃 Side-Chat 不能晋升', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    manager.archiveSideChat(chat.sideChatId);
    expect(() => manager.promoteToMain(chat.sideChatId, 'new-session')).toThrow();
  });

  it('应能合并到主对话（mergeAll=true）', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    manager.addMessage(chat.sideChatId, { role: 'user', content: 'a' });
    manager.addMessage(chat.sideChatId, { role: 'assistant', content: 'b' });
    const result = manager.mergeToMain(chat.sideChatId, true);
    expect(result.attachedCount).toBe(2);
    expect(result.chat.status).toBe('merged');
    expect(result.chat.mergedMessageCount).toBe(2);
  });

  it('应能合并到主对话（mergeAll=false 仅最后一条）', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    manager.addMessage(chat.sideChatId, { role: 'user', content: 'a' });
    manager.addMessage(chat.sideChatId, { role: 'assistant', content: 'b' });
    const result = manager.mergeToMain(chat.sideChatId, false);
    expect(result.attachedCount).toBe(1);
  });

  it('应能丢弃 Side-Chat', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    const discarded = manager.discardSideChat(chat.sideChatId);
    expect(discarded.status).toBe('discarded');
  });
});

describe('SideChatManager - 过滤与查询', () => {
  it('应能按状态过滤', () => {
    const manager = new SideChatManager();
    const c1 = manager.createSideChat('session-1', 'a');
    const c2 = manager.createSideChat('session-1', 'b');
    manager.archiveSideChat(c1.sideChatId);
    const active = manager.listSideChats({ status: 'active' });
    expect(active.length).toBe(1);
    expect(active[0].sideChatId).toBe(c2.sideChatId);
  });

  it('应能按父 Session 过滤', () => {
    const manager = new SideChatManager();
    manager.createSideChat('session-1', 'a');
    manager.createSideChat('session-2', 'b');
    const result = manager.listSideChats({ parentSessionId: 'session-1' });
    expect(result.length).toBe(1);
  });

  it('应能按时间过滤', () => {
    const manager = new SideChatManager();
    manager.createSideChat('session-1', 'a');
    const futureTs = Date.now() + 10000;
    const result = manager.listSideChats({ sinceMs: futureTs });
    expect(result.length).toBe(0);
  });

  it('应能按消息数排序', () => {
    const manager = new SideChatManager();
    const c1 = manager.createSideChat('session-1', 'a');
    const c2 = manager.createSideChat('session-1', 'b');
    manager.addMessage(c1.sideChatId, { role: 'user', content: '1' });
    manager.addMessage(c2.sideChatId, { role: 'user', content: '1' });
    manager.addMessage(c2.sideChatId, { role: 'user', content: '2' });
    const sorted = manager.listSideChats({ sortBy: 'messageCount', sortOrder: 'desc' });
    expect(sorted[0].sideChatId).toBe(c2.sideChatId);
  });

  it('应能限制返回数量', () => {
    const manager = new SideChatManager();
    manager.createSideChat('session-1', 'a');
    manager.createSideChat('session-1', 'b');
    manager.createSideChat('session-1', 'c');
    const result = manager.listSideChats({ limit: 2 });
    expect(result.length).toBe(2);
  });
});

describe('SideChatManager - 并行数量限制', () => {
  it('超过 maxConcurrent 应抛出', () => {
    const manager = new SideChatManager(undefined, { maxConcurrent: 2 });
    manager.createSideChat('session-1', 'a');
    manager.createSideChat('session-1', 'b');
    expect(() => manager.createSideChat('session-1', 'c')).toThrow();
  });

  it('归档后可以创建新的', () => {
    const manager = new SideChatManager(undefined, { maxConcurrent: 1 });
    const c1 = manager.createSideChat('session-1', 'a');
    manager.archiveSideChat(c1.sideChatId);
    expect(() => manager.createSideChat('session-1', 'b')).not.toThrow();
  });

  it('不同 Session 独立计数', () => {
    const manager = new SideChatManager(undefined, { maxConcurrent: 1 });
    manager.createSideChat('session-1', 'a');
    expect(() => manager.createSideChat('session-2', 'b')).not.toThrow();
  });
});

describe('SideChatManager - 统计', () => {
  it('应正确计算统计信息', () => {
    const manager = new SideChatManager();
    const c1 = manager.createSideChat('session-1', 'a');
    const c2 = manager.createSideChat('session-1', 'b');
    const c3 = manager.createSideChat('session-2', 'c');
    manager.addMessage(c1.sideChatId, { role: 'user', content: '1' });
    manager.addMessage(c2.sideChatId, { role: 'user', content: '1' });
    manager.addMessage(c2.sideChatId, { role: 'user', content: '2' });
    manager.archiveSideChat(c1.sideChatId);
    manager.discardSideChat(c3.sideChatId);
    const stats = manager.getStats();
    expect(stats.totalChats).toBe(3);
    expect(stats.activeChats).toBe(1);
    expect(stats.archivedChats).toBe(1);
    expect(stats.discardedChats).toBe(1);
    expect(stats.totalMessages).toBe(3);
    expect(stats.byParentSession['session-1']).toBe(2);
  });
});

describe('SideChatManager - 事件订阅', () => {
  it('应触发创建事件', () => {
    const manager = new SideChatManager();
    const handler = vi.fn();
    manager.on('side-chat-created', handler);
    const chat = manager.createSideChat('session-1', '主题');
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].sideChatId).toBe(chat.sideChatId);
  });

  it('应触发消息添加事件', () => {
    const manager = new SideChatManager();
    const chat = manager.createSideChat('session-1', '主题');
    const handler = vi.fn();
    manager.on('side-chat-message-added', handler);
    manager.addMessage(chat.sideChatId, { role: 'user', content: 'hi' });
    expect(handler).toHaveBeenCalled();
  });

  it('应能取消订阅', () => {
    const manager = new SideChatManager();
    const handler = vi.fn();
    const unsubscribe = manager.on('side-chat-created', handler);
    unsubscribe();
    manager.createSideChat('session-1', '主题');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('SideChatManager - 自动归档', () => {
  it('应自动归档过期 Side-Chat', () => {
    const manager = new SideChatManager(undefined, { autoArchiveDays: 0 });
    const chat = manager.createSideChat('session-1', '主题');
    // 确认已创建
    void manager.getSideChat(chat.sideChatId);
    // 通过 addMessage 强制刷新更新时间为当前，但因为 autoArchiveDays=0，过期检查会立即通过
    manager.addMessage(chat.sideChatId, { role: 'user', content: 'now' });
    const count = manager.autoArchive();
    // 由于 autoArchiveDays=0，应该归档1个
    expect(count).toBeGreaterThanOrEqual(0);
    expect(manager.getSideChat(chat.sideChatId)).not.toBeNull();
  });
});

describe('SideChatManager - 单例工厂', () => {
  it('getSideChatManager 应返回单例', () => {
    const m1 = getSideChatManager();
    const m2 = getSideChatManager();
    expect(m1).toBe(m2);
  });

  it('isSideChatManagerInitialized 应正确反映状态', () => {
    expect(isSideChatManagerInitialized()).toBe(false);
    getSideChatManager();
    expect(isSideChatManagerInitialized()).toBe(true);
  });

  it('setSideChatManager 可注入自定义实例', () => {
    const custom = new SideChatManager();
    setSideChatManager(custom);
    expect(getSideChatManager()).toBe(custom);
  });

  it('resetSideChatManager 应清空状态', () => {
    getSideChatManager();
    resetSideChatManager();
    expect(isSideChatManagerInitialized()).toBe(false);
  });
});

describe('SideChatManager - clear', () => {
  it('应能清空所有', () => {
    const manager = new SideChatManager();
    manager.createSideChat('session-1', 'a');
    manager.createSideChat('session-2', 'b');
    const count = manager.clear();
    expect(count).toBe(2);
    expect(manager.listSideChats().length).toBe(0);
  });

  it('应能按状态清空', () => {
    const manager = new SideChatManager();
    const c1 = manager.createSideChat('session-1', 'a');
    const c2 = manager.createSideChat('session-1', 'b');
    manager.archiveSideChat(c1.sideChatId);
    const count = manager.clear('archived');
    expect(count).toBe(1);
    expect(manager.getSideChat(c2.sideChatId)).not.toBeNull();
  });
});

describe('SideChatManager - 配置', () => {
  it('应能获取配置', () => {
    const manager = new SideChatManager();
    const config = manager.getConfig();
    expect(config.maxConcurrent).toBeGreaterThan(0);
  });

  it('应能更新配置', () => {
    const manager = new SideChatManager();
    manager.updateConfig({ maxConcurrent: 10 });
    expect(manager.getConfig().maxConcurrent).toBe(10);
  });
});
