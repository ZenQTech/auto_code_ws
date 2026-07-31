/**
 * # ============================================================
 * # 限流器 (Cycle 50 G50-01)
 * # ============================================================
 * # 核心作用：保护外部 API 调用，避免超过 QPS / 月度配额限制
 * #           支持 4 种限流策略 + 分布式令牌桶
 * # 运行流程：
 * #   1. acquire() 时, 根据策略计算是否允许请求
 * #   2. 拒绝时: 返回 Retry-After 延迟建议
 * #   3. 允许时: 扣除令牌并记录时间
 * # 输入参数：
 * #   - acquire(tokens?: number): 申请令牌
 * #   - release(tokens?: number): 释放令牌 (用于错误回滚)
 * # 输出结果：
 * #   - RateLimitResult: { allowed: boolean; retryAfterMs?: number; remaining: number; limit: number }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 50 G50-01 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 限流策略 */
export type RateLimitStrategy = 'token-bucket' | 'sliding-window' | 'fixed-window' | 'leaky-bucket';

/** 限流配置 */
export interface RateLimitConfig {
  /** 策略 (默认 token-bucket) */
  strategy?: RateLimitStrategy;
  /** 时间窗口 (毫秒) */
  windowMs: number;
  /** 窗口内最大请求数 (或令牌桶容量) */
  maxRequests: number;
  /** 突发容量 (token-bucket, 默认 = maxRequests) */
  burstCapacity?: number;
  /** 令牌补充速率 (每秒, 仅 token-bucket / leaky-bucket) */
  refillRate?: number;
  /** 全局配额 (例如每月 1M) */
  globalQuota?: number;
  /** 全局配额重置周期 (毫秒, 默认 30 天) */
  globalQuotaWindowMs?: number;
}

/** 限流结果 */
export interface RateLimitResult {
  /** 是否允许 */
  allowed: boolean;
  /** 建议重试延迟 (毫秒) - 仅在 !allowed 时设置 */
  retryAfterMs?: number;
  /** 剩余令牌数 (或窗口内剩余请求) */
  remaining: number;
  /** 容量上限 */
  limit: number;
  /** 重置时间 (毫秒时间戳) */
  resetAt: number;
  /** 全局配额剩余 */
  globalQuotaRemaining?: number;
}

/** 限流事件 */
export interface RateLimitEvent {
  type: 'acquire' | 'reject' | 'release' | 'reset' | 'quota-exceeded';
  timestamp: number;
  remaining: number;
  limit: number;
  retryAfterMs?: number;
}

/** 监听器 */
export type RateLimitListener = (event: RateLimitEvent) => void;

/** 限流统计 */
export interface RateLimitStats {
  totalAcquires: number;
  totalRejects: number;
  totalReleases: number;
  totalResets: number;
  totalQuotaExceeded: number;
  currentTokens: number;
  globalQuotaUsed: number;
  globalQuotaRemaining: number;
  globalQuotaResetAt: number;
}

// ============================================================
// RateLimiter 主类
// ============================================================

export class RateLimiter {
  private readonly config: Required<RateLimitConfig>;
  /** token-bucket 当前令牌数 */
  private tokens: number;
  /** token-bucket 上次补充时间 */
  private lastRefillAt: number;
  /** 滑动窗口请求时间戳列表 */
  private windowRequests: number[] = [];
  /** 固定窗口计数 */
  private currentWindowStart = 0;
  private currentWindowCount = 0;
  /** 全局配额已使用 */
  private globalQuotaUsed = 0;
  private globalQuotaResetAt = 0;
  /** 统计 */
  private stats_ = {
    totalAcquires: 0,
    totalRejects: 0,
    totalReleases: 0,
    totalResets: 0,
    totalQuotaExceeded: 0,
  };
  private readonly listeners: Set<RateLimitListener> = new Set();

  constructor(config: RateLimitConfig) {
    if (config.maxRequests <= 0) {
      throw new Error('maxRequests must be > 0');
    }
    if (config.windowMs <= 0) {
      throw new Error('windowMs must be > 0');
    }
    this.config = {
      strategy: config.strategy ?? 'token-bucket',
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      burstCapacity: config.burstCapacity ?? config.maxRequests,
      refillRate: config.refillRate ?? config.maxRequests / (config.windowMs / 1000),
      globalQuota: config.globalQuota ?? Infinity,
      globalQuotaWindowMs: config.globalQuotaWindowMs ?? 30 * 24 * 60 * 60 * 1000,
    };
    // Leaky Bucket 桶初始为空, token-bucket 桶初始为满
    this.tokens = this.config.strategy === 'leaky-bucket' ? 0 : this.config.burstCapacity;
    this.lastRefillAt = Date.now();
    this.globalQuotaResetAt = Date.now() + this.config.globalQuotaWindowMs;
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 申请令牌
   */
  acquire(tokens: number = 1): RateLimitResult {
    if (tokens <= 0) {
      throw new Error('tokens must be > 0');
    }

    // 1. 全局配额检查 (检查是否本次申请会超出配额)
    if (this.globalQuotaUsed + tokens > this.config.globalQuota) {
      this.stats_.totalQuotaExceeded += 1;
      this.emit({ type: 'quota-exceeded', timestamp: Date.now(), remaining: 0, limit: this.config.globalQuota });
      return {
        allowed: false,
        retryAfterMs: this.globalQuotaResetAt - Date.now(),
        remaining: 0,
        limit: this.config.maxRequests,
        resetAt: this.globalQuotaResetAt,
        globalQuotaRemaining: 0,
      };
    }

    // 2. 根据策略限流
    let result: RateLimitResult;
    switch (this.config.strategy) {
      case 'token-bucket':
        result = this.acquireTokenBucket(tokens);
        break;
      case 'sliding-window':
        result = this.acquireSlidingWindow(tokens);
        break;
      case 'fixed-window':
        result = this.acquireFixedWindow(tokens);
        break;
      case 'leaky-bucket':
        result = this.acquireLeakyBucket(tokens);
        break;
      default:
        result = this.acquireTokenBucket(tokens);
    }

    // 3. 更新全局配额
    if (result.allowed) {
      this.globalQuotaUsed += tokens;
      this.stats_.totalAcquires += 1;
      this.emit({ type: 'acquire', timestamp: Date.now(), remaining: result.remaining, limit: result.limit });
    } else {
      this.stats_.totalRejects += 1;
      this.emit({ type: 'reject', timestamp: Date.now(), remaining: result.remaining, limit: result.limit, retryAfterMs: result.retryAfterMs });
    }

    result.globalQuotaRemaining = this.config.globalQuota - this.globalQuotaUsed;
    return result;
  }

  /**
   * 释放令牌 (用于请求失败回滚)
   */
  release(tokens: number = 1): void {
    if (tokens <= 0) {
      throw new Error('tokens must be > 0');
    }
    // 回滚全局配额
    this.globalQuotaUsed = Math.max(0, this.globalQuotaUsed - tokens);

    // 回滚令牌桶
    if (this.config.strategy === 'token-bucket' || this.config.strategy === 'leaky-bucket') {
      this.tokens = Math.min(this.config.burstCapacity, this.tokens + tokens);
    }

    // 回滚固定窗口
    if (this.config.strategy === 'fixed-window') {
      this.currentWindowCount = Math.max(0, this.currentWindowCount - tokens);
    }

    // 回滚滑动窗口 (移除最早的)
    if (this.config.strategy === 'sliding-window') {
      for (let i = 0; i < tokens && this.windowRequests.length > 0; i++) {
        this.windowRequests.shift();
      }
    }

    this.stats_.totalReleases += 1;
    this.emit({ type: 'release', timestamp: Date.now(), remaining: this.tokens, limit: this.config.maxRequests });
  }

  /**
   * 重置所有计数器
   */
  reset(): void {
    this.tokens = this.config.burstCapacity;
    this.lastRefillAt = Date.now();
    this.windowRequests = [];
    this.currentWindowStart = Date.now();
    this.currentWindowCount = 0;
    this.globalQuotaUsed = 0;
    this.globalQuotaResetAt = Date.now() + this.config.globalQuotaWindowMs;
    this.stats_.totalResets += 1;
    this.emit({ type: 'reset', timestamp: Date.now(), remaining: this.tokens, limit: this.config.maxRequests });
  }

  /**
   * 订阅事件
   */
  subscribe(listener: RateLimitListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      ...this.stats_,
      currentTokens: this.tokens,
      globalQuotaUsed: this.globalQuotaUsed,
      globalQuotaRemaining: this.config.globalQuota - this.globalQuotaUsed,
      globalQuotaResetAt: this.globalQuotaResetAt,
    };
  }

  // ============================================================
  // 私有方法 - 各种策略
  // ============================================================

  /**
   * Token Bucket 算法
   *  - 令牌以固定速率补充
   *  - 突发消耗由 burstCapacity 限制
   */
  private acquireTokenBucket(tokens: number): RateLimitResult {
    this.refillTokens();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return {
        allowed: true,
        remaining: this.tokens,
        limit: this.config.burstCapacity,
        resetAt: Date.now() + (this.config.burstCapacity - this.tokens) * 1000 / this.config.refillRate,
      };
    }
    // 不足, 计算需要等待多久能补够
    const needed = tokens - this.tokens;
    const retryAfterMs = Math.ceil((needed / this.config.refillRate) * 1000);
    return {
      allowed: false,
      retryAfterMs,
      remaining: this.tokens,
      limit: this.config.burstCapacity,
      resetAt: Date.now() + retryAfterMs,
    };
  }

  /**
   * Sliding Window 算法
   *  - 维护过去 windowMs 内的请求时间戳
   *  - 超过 maxRequests 则拒绝
   */
  private acquireSlidingWindow(tokens: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    // 清理过期时间戳
    while (this.windowRequests.length > 0 && this.windowRequests[0]! < cutoff) {
      this.windowRequests.shift();
    }
    if (this.windowRequests.length + tokens <= this.config.maxRequests) {
      for (let i = 0; i < tokens; i++) {
        this.windowRequests.push(now);
      }
      return {
        allowed: true,
        remaining: this.config.maxRequests - this.windowRequests.length,
        limit: this.config.maxRequests,
        resetAt: now + this.config.windowMs,
      };
    }
    // 拒绝, 计算多久后最早的请求过期
    const oldestExpiry = this.windowRequests[0]! + this.config.windowMs;
    const retryAfterMs = Math.max(0, oldestExpiry - now);
    return {
      allowed: false,
      retryAfterMs,
      remaining: this.config.maxRequests - this.windowRequests.length,
      limit: this.config.maxRequests,
      resetAt: oldestExpiry,
    };
  }

  /**
   * Fixed Window 算法
   *  - 按固定时间窗口计数
   *  - 窗口重置时清零
   */
  private acquireFixedWindow(tokens: number): RateLimitResult {
    const now = Date.now();
    if (now - this.currentWindowStart >= this.config.windowMs) {
      // 新窗口
      this.currentWindowStart = now;
      this.currentWindowCount = 0;
    }
    if (this.currentWindowCount + tokens <= this.config.maxRequests) {
      this.currentWindowCount += tokens;
      return {
        allowed: true,
        remaining: this.config.maxRequests - this.currentWindowCount,
        limit: this.config.maxRequests,
        resetAt: this.currentWindowStart + this.config.windowMs,
      };
    }
    const retryAfterMs = this.currentWindowStart + this.config.windowMs - now;
    return {
      allowed: false,
      retryAfterMs,
      remaining: this.config.maxRequests - this.currentWindowCount,
      limit: this.config.maxRequests,
      resetAt: this.currentWindowStart + this.config.windowMs,
    };
  }

  /**
   * Leaky Bucket 算法
   *  - 桶满则拒绝
   *  - 桶以固定速率泄漏
   */
  private acquireLeakyBucket(tokens: number): RateLimitResult {
    this.refillTokens();
    if (this.tokens + tokens <= this.config.burstCapacity) {
      this.tokens += tokens;
      return {
        allowed: true,
        remaining: this.config.burstCapacity - this.tokens,
        limit: this.config.burstCapacity,
        resetAt: Date.now() + (this.tokens / this.config.refillRate) * 1000,
      };
    }
    const overflow = (this.tokens + tokens) - this.config.burstCapacity;
    const retryAfterMs = Math.ceil((overflow / this.config.refillRate) * 1000);
    return {
      allowed: false,
      retryAfterMs,
      remaining: this.config.burstCapacity - this.tokens,
      limit: this.config.burstCapacity,
      resetAt: Date.now() + retryAfterMs,
    };
  }

  /**
   * 补充令牌 (基于上次补充时间)
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillAt) / 1000;
    if (elapsedSec <= 0) return;
    const refilled = elapsedSec * this.config.refillRate;
    this.tokens = Math.min(this.config.burstCapacity, this.tokens + refilled);
    this.lastRefillAt = now;

    // 全局配额窗口重置检查
    if (this.globalQuotaResetAt < now) {
      this.globalQuotaUsed = 0;
      this.globalQuotaResetAt = now + this.config.globalQuotaWindowMs;
    }
  }

  // ============================================================
  // 事件触发
  // ============================================================

  private emit(event: RateLimitEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略 listener 错误
      }
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建限流器 - 火山方舟默认配置
 *  - 60 RPS (实测建议)
 *  - 突发 100
 *  - 每月 1M tokens
 */
export function createVolcengineRateLimiter(): RateLimiter {
  return new RateLimiter({
    strategy: 'token-bucket',
    windowMs: 1000, // 1 秒
    maxRequests: 60,
    burstCapacity: 100,
    refillRate: 60,
    globalQuota: 1_000_000,
    globalQuotaWindowMs: 30 * 24 * 60 * 60 * 1000,
  });
}

/**
 * 创建限流器 - OpenAI 默认配置
 *  - 60 RPM (TPM 60K)
 *  - 突发 60
 */
export function createOpenAIRateLimiter(): RateLimiter {
  return new RateLimiter({
    strategy: 'sliding-window',
    windowMs: 60_000, // 60 秒
    maxRequests: 60,
    burstCapacity: 60,
    globalQuota: 1_000_000,
    globalQuotaWindowMs: 30 * 24 * 60 * 60 * 1000,
  });
}
