/**
 * # ============================================================
 * # MCP Resource Subscription - 资源订阅管理器 (v1.0.0 Cycle 41 G41-01)
 * # ============================================================
 * # 核心作用：管理资源订阅生命周期
 * #           - 跟踪已订阅 URI
 * #           - 自动去重
 * #           - 订阅状态查询
 * #           - 订阅事件分发
 * # 协议参考：MCP 2024-11-05 resources/subscribe
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-01 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';

/**
 * 资源订阅信息
 */
export interface ResourceSubscription {
  /** 资源 URI */
  uri: string;
  /** 订阅时间（毫秒） */
  subscribedAt: number;
  /** 订阅是否仍然活跃 */
  active: boolean;
  /** 收到更新次数 */
  updateCount: number;
  /** 最后更新时间（毫秒） */
  lastUpdatedAt: number | null;
}

/**
 * 订阅状态变化事件
 */
export type SubscriptionEvent =
  | { type: 'subscribed'; uri: string; at: number }
  | { type: 'unsubscribed'; uri: string; at: number }
  | { type: 'updated'; uri: string; at: number; updateCount: number }
  | { type: 'cleared'; at: number };

export type SubscriptionListener = (event: SubscriptionEvent) => void;

/**
 * 资源订阅管理器
 * 负责管理客户端的所有资源订阅，跟踪状态、事件分发
 */
export class ResourceSubscriptionManager {
  private readonly subscriptions: Map<string, ResourceSubscription> = new Map();
  private readonly listeners: Set<SubscriptionListener> = new Set();
  private client: McpClient | null = null;
  private unsubscribeNotification: (() => void) | null = null;
  private clearedAt: number | null = null;

  /**
   * 绑定客户端（替换已有）
   */
  attachClient(client: McpClient | null): void {
    // 解绑旧客户端
    if (this.client && this.unsubscribeNotification) {
      this.unsubscribeNotification();
      this.unsubscribeNotification = null;
    }

    this.client = client;

    if (client) {
      // 订阅资源更新通知
      this.unsubscribeNotification = client.onResourceUpdated((uri) => {
        this.handleResourceUpdate(uri);
      });
    }
  }

  /**
   * 订阅资源
   * @returns 是否真正执行了订阅（false 表示已订阅过，去重）
   */
  async subscribe(uri: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('No client attached to ResourceSubscriptionManager');
    }
    // 已订阅则跳过
    if (this.subscriptions.has(uri)) {
      return false;
    }
    await this.client.subscribeResource(uri);
    const now = Date.now();
    this.subscriptions.set(uri, {
      uri,
      subscribedAt: now,
      active: true,
      updateCount: 0,
      lastUpdatedAt: null,
    });
    this.emit({ type: 'subscribed', uri, at: now });
    return true;
  }

  /**
   * 取消订阅
   * @returns 是否真正执行了取消（false 表示未订阅）
   */
  async unsubscribe(uri: string): Promise<boolean> {
    if (!this.subscriptions.has(uri)) {
      return false;
    }
    if (this.client) {
      try {
        await this.client.unsubscribeResource(uri);
      } catch {
        // 即使服务器失败，仍然移除本地订阅
      }
    }
    const now = Date.now();
    this.subscriptions.delete(uri);
    this.emit({ type: 'unsubscribed', uri, at: now });
    return true;
  }

  /**
   * 批量订阅
   */
  async subscribeMany(uris: string[]): Promise<{ subscribed: number; skipped: number }> {
    let subscribed = 0;
    let skipped = 0;
    for (const uri of uris) {
      const wasNew = await this.subscribe(uri);
      if (wasNew) {
        subscribed += 1;
      } else {
        skipped += 1;
      }
    }
    return { subscribed, skipped };
  }

  /**
   * 批量取消订阅
   */
  async unsubscribeMany(uris: string[]): Promise<{ unsubscribed: number; skipped: number }> {
    let unsubscribed = 0;
    let skipped = 0;
    for (const uri of uris) {
      const wasActive = await this.unsubscribe(uri);
      if (wasActive) {
        unsubscribed += 1;
      } else {
        skipped += 1;
      }
    }
    return { unsubscribed, skipped };
  }

  /**
   * 取消所有订阅
   */
  async unsubscribeAll(): Promise<number> {
    const uris = Array.from(this.subscriptions.keys());
    let count = 0;
    for (const uri of uris) {
      const ok = await this.unsubscribe(uri);
      if (ok) count += 1;
    }
    return count;
  }

  /**
   * 检查 URI 是否已订阅
   */
  isSubscribed(uri: string): boolean {
    return this.subscriptions.has(uri);
  }

  /**
   * 获取订阅信息
   */
  get(uri: string): ResourceSubscription | undefined {
    return this.subscriptions.get(uri);
  }

  /**
   * 获取所有订阅
   */
  list(): ResourceSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * 获取订阅数量
   */
  size(): number {
    return this.subscriptions.size;
  }

  /**
   * 清空所有订阅（仅本地，不向服务器发请求）
   */
  clear(): void {
    if (this.subscriptions.size === 0) return;
    this.subscriptions.clear();
    const now = Date.now();
    this.clearedAt = now;
    this.emit({ type: 'cleared', at: now });
  }

  /**
   * 订阅事件
   */
  on(listener: SubscriptionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 释放资源
   */
  dispose(): void {
    if (this.unsubscribeNotification) {
      this.unsubscribeNotification();
      this.unsubscribeNotification = null;
    }
    this.clear();
    this.listeners.clear();
    this.client = null;
  }

  // ============ 私有方法 ============

  private handleResourceUpdate(uri: string): void {
    const sub = this.subscriptions.get(uri);
    if (!sub) return;
    const now = Date.now();
    sub.updateCount += 1;
    sub.lastUpdatedAt = now;
    this.emit({ type: 'updated', uri, at: now, updateCount: sub.updateCount });
  }

  private emit(event: SubscriptionEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 创建资源订阅管理器
 */
export function createResourceSubscriptionManager(): ResourceSubscriptionManager {
  return new ResourceSubscriptionManager();
}
