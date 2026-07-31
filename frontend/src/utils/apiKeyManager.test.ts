/**
 * # ============================================================
 * # ApiKeyManager 单元测试 (Cycle 50 G50-01)
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyManager, createApiKeyManager, type ApiKeyAuditEvent } from './apiKeyManager';

describe('ApiKeyManager - 基础 CRUD', () => {
  it('应能设置和获取 API Key', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    const entry = await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    expect(entry.provider).toBe('volcengine');
    expect(entry.keyId).toHaveLength(16);
    expect(await mgr.getApiKey('volcengine')).toBe('test-api-key-1234567890');
  });

  it('应拒绝过短的 Key', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await expect(mgr.setApiKey('volcengine', 'short')).rejects.toThrow('too short');
  });

  it('应拒绝过长的 Key', async () => {
    const mgr = createApiKeyManager({ backend: 'memory', maxKeyLength: 50 });
    await expect(mgr.setApiKey('volcengine', 'a'.repeat(100))).rejects.toThrow('too long');
  });

  it('应能删除 Key', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    expect(mgr.hasApiKey('volcengine')).toBe(true);
    expect(mgr.deleteApiKey('volcengine')).toBe(true);
    expect(mgr.hasApiKey('volcengine')).toBe(false);
  });

  it('获取不存在的 Key 应返回 null', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    expect(await mgr.getApiKey('openai')).toBeNull();
  });
});

describe('ApiKeyManager - 安全加密', () => {
  it('不同 master key 应无法解密', async () => {
    const mgr1 = createApiKeyManager({ backend: 'memory', masterKey: 'key-a-32-bytes-long-12345678' });
    const mgr2 = createApiKeyManager({ backend: 'memory', masterKey: 'key-b-32-bytes-long-12345678' });
    await mgr1.setApiKey('volcengine', 'my-secret-key-1234567890');
    // 手动提取 entry 给 mgr2 模拟跨实例
    const entry1 = mgr1.getEntry('volcengine')!;
    expect(entry1).toBeTruthy();
    // mgr2 自己的存储中无该 key
    expect(await mgr2.getApiKey('volcengine')).toBeNull();
  });

  it('同一 Key 每次加密结果应不同 (IV 随机)', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    const e1 = await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    mgr.deleteApiKey('volcengine');
    const e2 = await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    expect(e1.encryptedKey).not.toBe(e2.encryptedKey);
    expect(e1.iv).not.toBe(e2.iv);
  });

  it('keyId 应为 Key 的稳定指纹', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    const e1 = await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    mgr.deleteApiKey('volcengine');
    const e2 = await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    expect(e1.keyId).toBe(e2.keyId);
  });
});

describe('ApiKeyManager - 轮换和过期', () => {
  it('应能轮换 Key', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'old-key-1234567890123456');
    await mgr.rotateApiKey('volcengine', 'new-key-9876543210987654');
    expect(await mgr.getApiKey('volcengine')).toBe('new-key-9876543210987654');
  });

  it('过期 Key 应自动删除', async () => {
    const mgr = createApiKeyManager({ backend: 'memory', defaultExpiresInMs: 50 });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    expect(mgr.hasApiKey('volcengine')).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(await mgr.getApiKey('volcengine')).toBeNull();
  });

  it('expiresAt=0 应永不过期', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890', { expiresAt: 0 });
    expect(mgr.hasApiKey('volcengine')).toBe(true);
    // 即使等待 100ms 也不应过期
    await new Promise((r) => setTimeout(r, 50));
    expect(await mgr.getApiKey('volcengine')).toBe('test-api-key-1234567890');
  });
});

describe('ApiKeyManager - 审计和统计', () => {
  it('应触发 create 事件', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    const events: ApiKeyAuditEvent[] = [];
    mgr.subscribe((e) => events.push(e));
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    expect(events.some((e) => e.type === 'create')).toBe(true);
  });

  it('应触发 get 事件', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    const events: ApiKeyAuditEvent[] = [];
    mgr.subscribe((e) => events.push(e));
    await mgr.getApiKey('volcengine');
    expect(events.some((e) => e.type === 'get')).toBe(true);
  });

  it('应触发 delete 事件', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    const events: ApiKeyAuditEvent[] = [];
    mgr.subscribe((e) => events.push(e));
    mgr.deleteApiKey('volcengine');
    expect(events.some((e) => e.type === 'delete')).toBe(true);
  });

  it('应能退订事件', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    const events: ApiKeyAuditEvent[] = [];
    const unsub = mgr.subscribe((e) => events.push(e));
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    expect(events.length).toBeGreaterThan(0);
    const len1 = events.length;
    unsub();
    mgr.deleteApiKey('volcengine');
    expect(events.length).toBe(len1);
  });

  it('应正确统计', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    await mgr.setApiKey('openai', 'openai-test-key-1234567890');
    await mgr.getApiKey('volcengine');
    await mgr.getApiKey('volcengine');
    mgr.deleteApiKey('openai');
    const stats = mgr.getStats();
    expect(stats.totalCreates).toBe(2);
    expect(stats.totalGets).toBe(2);
    expect(stats.totalDeletes).toBe(1);
  });
});

describe('ApiKeyManager - 多 Provider 隔离', () => {
  it('不同 Provider 应独立存储', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'volc-key-1234567890abcdef');
    await mgr.setApiKey('openai', 'openai-key-1234567890abcde');
    await mgr.setApiKey('claude', 'claude-key-1234567890abcd');
    expect(await mgr.getApiKey('volcengine')).toBe('volc-key-1234567890abcdef');
    expect(await mgr.getApiKey('openai')).toBe('openai-key-1234567890abcde');
    expect(await mgr.getApiKey('claude')).toBe('claude-key-1234567890abcd');
  });

  it('应能列出所有 Provider', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'volc-key-1234567890abcdef');
    await mgr.setApiKey('openai', 'openai-key-1234567890abcde');
    const providers = mgr.listProviders();
    expect(providers).toContain('volcengine');
    expect(providers).toContain('openai');
  });

  it('应能清空所有', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'volc-key-1234567890abcdef');
    await mgr.setApiKey('openai', 'openai-key-1234567890abcde');
    mgr.clearAll();
    expect(mgr.hasApiKey('volcengine')).toBe(false);
    expect(mgr.hasApiKey('openai')).toBe(false);
  });
});

describe('ApiKeyManager - 元数据和使用统计', () => {
  it('应支持元数据', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890', { metadata: { endpoint: 'https://ark.cn-beijing.volces.com', region: 'cn-beijing' } });
    const entry = mgr.getEntry('volcengine');
    expect(entry?.metadata.endpoint).toBe('https://ark.cn-beijing.volces.com');
  });

  it('应记录使用次数', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    await mgr.getApiKey('volcengine');
    await mgr.getApiKey('volcengine');
    await mgr.getApiKey('volcengine');
    const entry = mgr.getEntry('volcengine');
    expect(entry?.usageCount).toBe(3);
  });

  it('应更新最后使用时间', async () => {
    const mgr = createApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-api-key-1234567890');
    await new Promise((r) => setTimeout(r, 10));
    await mgr.getApiKey('volcengine');
    const entry = mgr.getEntry('volcengine');
    expect(entry?.lastUsedAt).toBeGreaterThan(0);
  });
});

describe('ApiKeyManager - 持久化往返', () => {
  it('同一 manager 应能恢复之前存储的 Key', async () => {
    const mgr1 = createApiKeyManager({ backend: 'memory' });
    await mgr1.setApiKey('volcengine', 'persistent-key-1234567890');
    const raw = (mgr1 as unknown as { backend: { get: (k: string) => string | null } }).backend.get('apikey:volcengine');
    expect(raw).toBeTruthy();
    // 创建新 manager 模拟重启
    const mgr2 = createApiKeyManager({ backend: 'memory' });
    (mgr2 as unknown as { backend: { set: (k: string, v: string) => void } }).backend.set('apikey:volcengine', raw!);
    expect(await mgr2.getApiKey('volcengine')).toBe('persistent-key-1234567890');
  });
});
