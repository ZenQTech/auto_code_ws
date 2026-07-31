/**
 * # ============================================================
 * # RateLimiter 单元测试 (Cycle 50 G50-01)
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter, createVolcengineRateLimiter, createOpenAIRateLimiter, type RateLimitEvent } from './rateLimiter';

describe('RateLimiter - Token Bucket', () => {
  it('应有初始 burst 容量', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 10, burstCapacity: 10, refillRate: 10 });
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).remaining).toBeGreaterThanOrEqual(8);
  });

  it('超出 burst 应拒绝', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 5, burstCapacity: 5, refillRate: 5 });
    for (let i = 0; i < 5; i++) {
      expect(rl.acquire(1).allowed).toBe(true);
    }
    const result = rl.acquire(1);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('批量申请应正确扣减', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 10, burstCapacity: 10, refillRate: 10 });
    const r = rl.acquire(5);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeLessThanOrEqual(5);
  });

  it('应自动补充令牌', async () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 2, burstCapacity: 2, refillRate: 100 });
    rl.acquire(2);
    expect(rl.acquire(1).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(rl.acquire(1).allowed).toBe(true);
  });
});

describe('RateLimiter - Sliding Window', () => {
  it('窗口内请求应计数', () => {
    const rl = new RateLimiter({ strategy: 'sliding-window', windowMs: 1000, maxRequests: 3 });
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(false);
  });

  it('窗口过期后应允许', async () => {
    const rl = new RateLimiter({ strategy: 'sliding-window', windowMs: 100, maxRequests: 1 });
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(rl.acquire(1).allowed).toBe(true);
  });

  it('拒绝时应返回 retryAfterMs', () => {
    const rl = new RateLimiter({ strategy: 'sliding-window', windowMs: 1000, maxRequests: 1 });
    rl.acquire(1);
    const r = rl.acquire(1);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(1000);
  });
});

describe('RateLimiter - Fixed Window', () => {
  it('窗口内计数', () => {
    const rl = new RateLimiter({ strategy: 'fixed-window', windowMs: 1000, maxRequests: 2 });
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(false);
  });

  it('新窗口应重置', async () => {
    const rl = new RateLimiter({ strategy: 'fixed-window', windowMs: 100, maxRequests: 1 });
    expect(rl.acquire(1).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(rl.acquire(1).allowed).toBe(true);
  });
});

describe('RateLimiter - Leaky Bucket', () => {
  it('桶满应拒绝', () => {
    const rl = new RateLimiter({ strategy: 'leaky-bucket', windowMs: 1000, maxRequests: 3, burstCapacity: 3, refillRate: 3 });
    expect(rl.acquire(3).allowed).toBe(true);
    expect(rl.acquire(1).allowed).toBe(false);
  });
});

describe('RateLimiter - 释放和重置', () => {
  it('release 应回滚令牌', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 5, burstCapacity: 5, refillRate: 5 });
    rl.acquire(3);
    rl.release(2);
    const r = rl.acquire(2);
    expect(r.allowed).toBe(true);
  });

  it('reset 应清空所有状态', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 2, burstCapacity: 2, refillRate: 2 });
    rl.acquire(2);
    expect(rl.acquire(1).allowed).toBe(false);
    rl.reset();
    expect(rl.acquire(2).allowed).toBe(true);
  });
});

describe('RateLimiter - 全局配额', () => {
  it('达到全局配额应拒绝', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 100, burstCapacity: 100, refillRate: 100, globalQuota: 3, globalQuotaWindowMs: 60000 });
    expect(rl.acquire(2).allowed).toBe(true);
    expect(rl.acquire(2).allowed).toBe(false); // 4 > 3 配额
  });

  it('release 应回滚全局配额', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 100, burstCapacity: 100, refillRate: 100, globalQuota: 3 });
    rl.acquire(2);
    expect(rl.acquire(2).allowed).toBe(false);
    rl.release(1);
    expect(rl.acquire(1).allowed).toBe(true);
  });
});

describe('RateLimiter - 事件订阅', () => {
  it('应触发 acquire 事件', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 5, burstCapacity: 5, refillRate: 5 });
    const events: RateLimitEvent[] = [];
    rl.subscribe((e) => events.push(e));
    rl.acquire(1);
    expect(events.some((e) => e.type === 'acquire')).toBe(true);
  });

  it('应触发 reject 事件', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 1, burstCapacity: 1, refillRate: 1 });
    rl.acquire(1);
    const events: RateLimitEvent[] = [];
    rl.subscribe((e) => events.push(e));
    rl.acquire(1);
    expect(events.some((e) => e.type === 'reject')).toBe(true);
  });

  it('应能退订', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 5, burstCapacity: 5, refillRate: 5 });
    const events: RateLimitEvent[] = [];
    const unsub = rl.subscribe((e) => events.push(e));
    rl.acquire(1);
    expect(events.length).toBeGreaterThan(0);
    const len = events.length;
    unsub();
    rl.acquire(1);
    expect(events.length).toBe(len);
  });
});

describe('RateLimiter - 统计', () => {
  it('应正确统计 acquires/rejects', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 2, burstCapacity: 2, refillRate: 2 });
    rl.acquire(2);
    rl.acquire(1); // 拒绝
    rl.acquire(1); // 拒绝
    const stats = rl.getStats();
    expect(stats.totalAcquires).toBe(1);
    expect(stats.totalRejects).toBeGreaterThanOrEqual(2);
  });
});

describe('RateLimiter - 工厂函数', () => {
  it('createVolcengineRateLimiter 应返回正确配置', () => {
    const rl = createVolcengineRateLimiter();
    const stats = rl.getStats();
    expect(stats.globalQuotaRemaining).toBe(1_000_000);
  });

  it('createOpenAIRateLimiter 应使用 sliding-window', () => {
    const rl = createOpenAIRateLimiter();
    const result = rl.acquire(60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });
});

describe('RateLimiter - 边界条件', () => {
  it('应拒绝 maxRequests <= 0', () => {
    expect(() => new RateLimiter({ windowMs: 1000, maxRequests: 0 })).toThrow('> 0');
  });

  it('应拒绝 windowMs <= 0', () => {
    expect(() => new RateLimiter({ windowMs: 0, maxRequests: 5 })).toThrow('> 0');
  });

  it('应拒绝 tokens <= 0', () => {
    const rl = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 5, burstCapacity: 5, refillRate: 5 });
    expect(() => rl.acquire(0)).toThrow('> 0');
  });
});
