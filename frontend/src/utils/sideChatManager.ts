/**
 * # ============================================================
 * # SideChatManager - 侧边对话管理器 (v1.0.0 Cycle 22 G22-01)
 * # ============================================================
 * # 核心作用：在主对话之外提供轻量级子对话能力
 * #           不打断主对话流程，可关联到主 Session
 * # 业务价值：
 * #   1. 探索性对话不污染主上下文窗口
 * #   2. 子对话可"晋升"到主对话
 * #   3. 关闭/重新打开不丢失
 * #   4. 支持多 Side-Chat 并行（最多 5 个）
 * # 运行流程：
 * #   1. createSideChat(parentSessionId, topic) - 创建 Side-Chat
 * #   2. addMessage(sideChatId, message) - 添加消息
 * #   3. attachToMain / detachFromMain - 关联/分离
 * #   4. promoteToMain(sideChatId) - 晋升为新 Session
 * #   5. archiveSideChat(sideChatId) - 归档
 * # 输入参数：
 * #   - parentSessionId: 父 Session ID
 * #   - topic: 侧边对话主题
 * #   - message: 消息内容
 * # 输出结果：
 * #   - SideChat: 侧边对话对象
 * #   - SideChatStats: 统计信息
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-01 初次创建
 * #     - SideChatManager 核心引擎
 * #     - 5 种状态：active/archived/promoted/merged/discarded
 * #     - 最多 5 个并行 Side-Chat
 * #     - 单例工厂 + 事件订阅 + 持久化
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

export type SideChatStatus =
  | 'active'
  | 'archived'
  | 'promoted'
  | 'merged'
  | 'discarded';

export interface SideChatMessage {
  messageId: string;
  sideChatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attached?: boolean; // 是否附加到主对话
  metadata?: Record<string, unknown>;
}

export interface SideChat {
  sideChatId: string;
  parentSessionId: string;
  topic: string;
  status: SideChatStatus;
  messages: SideChatMessage[];
  createdAt: number;
  updatedAt: number;
  promotedSessionId?: string;
  mergedMessageCount?: number;
  metadata?: Record<string, unknown>;
}

export interface SideChatConfig {
  maxConcurrent: number; // 最大并行数（默认 5）
  autoArchiveDays: number; // 自动归档天数（默认 7）
  maxMessagesPerChat: number; // 单个 Side-Chat 最大消息数
  persistKey: string; // 持久化 key
}

export interface SideChatFilter {
  status?: SideChatStatus | SideChatStatus[];
  parentSessionId?: string;
  sinceMs?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'messageCount';
  sortOrder?: 'asc' | 'desc';
}

export interface SideChatStats {
  totalChats: number;
  activeChats: number;
  archivedChats: number;
  promotedChats: number;
  mergedChats: number;
  discardedChats: number;
  totalMessages: number;
  byParentSession: Record<string, number>;
}

export type SideChatEventType =
  | 'side-chat-created'
  | 'side-chat-updated'
  | 'side-chat-message-added'
  | 'side-chat-status-changed'
  | 'side-chat-archived'
  | 'side-chat-promoted'
  | 'side-chat-merged'
  | 'side-chat-discarded';

export interface SideChatEvent {
  type: SideChatEventType;
  sideChatId: string;
  parentSessionId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type SideChatEventHandler = (event: SideChatEvent) => void;

// ============================================================================
// 事件总线
// ============================================================================

class SideChatEventBus {
  private listeners: Map<SideChatEventType, Set<SideChatEventHandler>> = new Map();

  on(type: SideChatEventType, handler: SideChatEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: SideChatEvent): void {
    this.listeners.get(event.type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('SideChat event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function _genId(prefix: string = 'sidechat'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// 持久化
// ============================================================================

const DEFAULT_PERSIST_KEY = 'hermes.sideChats.v1';

interface SideChatStorage {
  load(): SideChat[];
  save(chats: SideChat[]): void;
  clear(): void;
}

class LocalStorageSideChatStorage implements SideChatStorage {
  private readonly key: string;

  constructor(key: string = DEFAULT_PERSIST_KEY) {
    this.key = key;
  }

  load(): SideChat[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  save(chats: SideChat[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this.key, JSON.stringify(chats));
    } catch {
      // 静默失败
    }
  }

  clear(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(this.key);
    } catch {
      // 静默
    }
  }
}

// 内存存储实现（用于测试场景 / SSR 环境）
// 注意：未直接引用，仅供子类化使用，故用 @ts-expect-error 抑制 unused 警告
// @ts-expect-error 备用存储实现，仅供测试继承使用
class MemorySideChatStorage implements SideChatStorage {
  private chats: SideChat[] = [];

  load(): SideChat[] {
    return [...this.chats];
  }

  save(chats: SideChat[]): void {
    this.chats = [...chats];
  }

  clear(): void {
    this.chats = [];
  }
}

// ============================================================================
// 核心类
// ============================================================================

const DEFAULT_CONFIG: SideChatConfig = {
  maxConcurrent: 5,
  autoArchiveDays: 7,
  maxMessagesPerChat: 100,
  persistKey: DEFAULT_PERSIST_KEY,
};

export class SideChatManager {
  private chats: Map<string, SideChat> = new Map();
  private readonly eventBus: SideChatEventBus = new SideChatEventBus();
  private readonly storage: SideChatStorage;
  private config: SideChatConfig;

  constructor(storage?: SideChatStorage, config: Partial<SideChatConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = storage ?? new LocalStorageSideChatStorage(this.config.persistKey);
  }

  // --------------------------------------------------------------------------
  // 生命周期
  // --------------------------------------------------------------------------

  /**
   * 初始化（从持久化恢复）
   */
  initialize(): void {
    const chats = this.storage.load();
    this.chats.clear();
    for (const chat of chats) {
      this.chats.set(chat.sideChatId, chat);
    }
  }

  /**
   * 持久化当前状态
   */
  private persist(): void {
    this.storage.save(Array.from(this.chats.values()));
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  /**
   * 创建 Side-Chat
   */
  createSideChat(parentSessionId: string, topic: string, metadata?: Record<string, unknown>): SideChat {
    // 检查并行数量限制
    const activeCount = Array.from(this.chats.values()).filter(
      (c) => c.parentSessionId === parentSessionId && c.status === 'active'
    ).length;

    if (activeCount >= this.config.maxConcurrent) {
      throw new Error(
        `SideChatManager: 已达到最大并行数 (${this.config.maxConcurrent})，请先归档或合并现有 Side-Chat`
      );
    }

    const now = Date.now();
    const sideChat: SideChat = {
      sideChatId: _genId(),
      parentSessionId,
      topic,
      status: 'active',
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata,
    };

    this.chats.set(sideChat.sideChatId, sideChat);
    this.persist();

    this.eventBus.emit({
      type: 'side-chat-created',
      sideChatId: sideChat.sideChatId,
      parentSessionId,
      timestamp: now,
      data: { topic },
    });

    return sideChat;
  }

  /**
   * 获取 Side-Chat
   */
  getSideChat(sideChatId: string): SideChat | null {
    return this.chats.get(sideChatId) ?? null;
  }

  /**
   * 列出 Side-Chat
   */
  listSideChats(filter: SideChatFilter = {}): SideChat[] {
    let result = Array.from(this.chats.values());

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((c) => statuses.includes(c.status));
    }

    if (filter.parentSessionId) {
      result = result.filter((c) => c.parentSessionId === filter.parentSessionId);
    }

    if (filter.sinceMs) {
      result = result.filter((c) => c.createdAt >= filter.sinceMs!);
    }

    // 排序
    if (filter.sortBy) {
      const sortOrder = filter.sortOrder === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        let av: number;
        let bv: number;
        if (filter.sortBy === 'messageCount') {
          av = a.messages.length;
          bv = b.messages.length;
        } else {
          av = a[filter.sortBy!];
          bv = b[filter.sortBy!];
        }
        return (av - bv) * sortOrder;
      });
    }

    if (filter.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * 添加消息
   */
  addMessage(sideChatId: string, message: Omit<SideChatMessage, 'messageId' | 'sideChatId' | 'timestamp'>): SideChatMessage {
    const chat = this.chats.get(sideChatId);
    if (!chat) {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 不存在`);
    }
    if (chat.status !== 'active') {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 状态为 ${chat.status}，不能添加消息`);
    }
    if (chat.messages.length >= this.config.maxMessagesPerChat) {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 已达到最大消息数 (${this.config.maxMessagesPerChat})`);
    }

    const now = Date.now();
    const fullMessage: SideChatMessage = {
      ...message,
      messageId: _genId('msg'),
      sideChatId,
      timestamp: now,
    };

    chat.messages.push(fullMessage);
    chat.updatedAt = now;
    this.persist();

    this.eventBus.emit({
      type: 'side-chat-message-added',
      sideChatId,
      parentSessionId: chat.parentSessionId,
      timestamp: now,
      data: { messageId: fullMessage.messageId, role: fullMessage.role },
    });

    return fullMessage;
  }

  /**
   * 更新 Side-Chat 主题
   */
  updateTopic(sideChatId: string, topic: string): SideChat {
    const chat = this.chats.get(sideChatId);
    if (!chat) {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 不存在`);
    }
    chat.topic = topic;
    chat.updatedAt = Date.now();
    this.persist();

    this.eventBus.emit({
      type: 'side-chat-updated',
      sideChatId,
      parentSessionId: chat.parentSessionId,
      timestamp: chat.updatedAt,
      data: { topic },
    });

    return chat;
  }

  /**
   * 删除 Side-Chat
   */
  removeSideChat(sideChatId: string): boolean {
    const chat = this.chats.get(sideChatId);
    if (!chat) return false;

    this.chats.delete(sideChatId);
    this.persist();

    this.eventBus.emit({
      type: 'side-chat-discarded',
      sideChatId,
      parentSessionId: chat.parentSessionId,
      timestamp: Date.now(),
    });

    return true;
  }

  // --------------------------------------------------------------------------
  // 状态转换
  // --------------------------------------------------------------------------

  /**
   * 归档 Side-Chat
   */
  archiveSideChat(sideChatId: string): SideChat {
    return this._changeStatus(sideChatId, 'archived', 'side-chat-archived');
  }

  /**
   * 晋升为新 Session（独立主对话）
   */
  promoteToMain(sideChatId: string, newSessionId: string): SideChat {
    const chat = this.chats.get(sideChatId);
    if (!chat) {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 不存在`);
    }
    if (chat.status !== 'active') {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 状态为 ${chat.status}，不能晋升`);
    }

    chat.status = 'promoted';
    chat.promotedSessionId = newSessionId;
    chat.updatedAt = Date.now();
    this.persist();

    this.eventBus.emit({
      type: 'side-chat-promoted',
      sideChatId,
      parentSessionId: chat.parentSessionId,
      timestamp: chat.updatedAt,
      data: { newSessionId },
    });

    return chat;
  }

  /**
   * 合并到主对话（标记消息为附加）
   */
  mergeToMain(sideChatId: string, mergeAll: boolean = true): { attachedCount: number; chat: SideChat } {
    const chat = this.chats.get(sideChatId);
    if (!chat) {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 不存在`);
    }
    if (chat.status !== 'active') {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 状态为 ${chat.status}，不能合并`);
    }

    let attachedCount = 0;
    if (mergeAll) {
      for (const msg of chat.messages) {
        if (!msg.attached) {
          msg.attached = true;
          attachedCount++;
        }
      }
    } else {
      // 仅附加最后一条
      const lastMsg = chat.messages[chat.messages.length - 1];
      if (lastMsg && !lastMsg.attached) {
        lastMsg.attached = true;
        attachedCount = 1;
      }
    }

    chat.status = 'merged';
    chat.mergedMessageCount = attachedCount;
    chat.updatedAt = Date.now();
    this.persist();

    this.eventBus.emit({
      type: 'side-chat-merged',
      sideChatId,
      parentSessionId: chat.parentSessionId,
      timestamp: chat.updatedAt,
      data: { attachedCount },
    });

    return { attachedCount, chat };
  }

  /**
   * 丢弃 Side-Chat
   */
  discardSideChat(sideChatId: string): SideChat {
    return this._changeStatus(sideChatId, 'discarded', 'side-chat-discarded');
  }

  /**
   * 内部：改变状态
   */
  private _changeStatus(
    sideChatId: string,
    newStatus: SideChatStatus,
    eventType: SideChatEventType
  ): SideChat {
    const chat = this.chats.get(sideChatId);
    if (!chat) {
      throw new Error(`SideChatManager: Side-Chat ${sideChatId} 不存在`);
    }

    const oldStatus = chat.status;
    chat.status = newStatus;
    chat.updatedAt = Date.now();
    this.persist();

    this.eventBus.emit({
      type: 'side-chat-status-changed',
      sideChatId,
      parentSessionId: chat.parentSessionId,
      timestamp: chat.updatedAt,
      data: { oldStatus, newStatus, eventType },
    });

    return chat;
  }

  // --------------------------------------------------------------------------
  // 查询与统计
  // --------------------------------------------------------------------------

  /**
   * 统计信息
   */
  getStats(): SideChatStats {
    const all = Array.from(this.chats.values());
    const stats: SideChatStats = {
      totalChats: all.length,
      activeChats: 0,
      archivedChats: 0,
      promotedChats: 0,
      mergedChats: 0,
      discardedChats: 0,
      totalMessages: 0,
      byParentSession: {},
    };

    for (const chat of all) {
      switch (chat.status) {
        case 'active': stats.activeChats++; break;
        case 'archived': stats.archivedChats++; break;
        case 'promoted': stats.promotedChats++; break;
        case 'merged': stats.mergedChats++; break;
        case 'discarded': stats.discardedChats++; break;
      }
      stats.totalMessages += chat.messages.length;
      stats.byParentSession[chat.parentSessionId] = (stats.byParentSession[chat.parentSessionId] ?? 0) + 1;
    }

    return stats;
  }

  /**
   * 自动归档过期
   */
  autoArchive(): number {
    const cutoff = Date.now() - this.config.autoArchiveDays * 24 * 60 * 60 * 1000;
    let count = 0;

    for (const chat of this.chats.values()) {
      if (chat.status === 'active' && chat.updatedAt < cutoff) {
        this.archiveSideChat(chat.sideChatId);
        count++;
      }
    }

    return count;
  }

  /**
   * 清空所有
   */
  clear(status?: SideChatStatus | SideChatStatus[]): number {
    if (!status) {
      const count = this.chats.size;
      this.chats.clear();
      this.persist();
      return count;
    }
    const statuses = Array.isArray(status) ? status : [status];
    let count = 0;
    for (const [id, chat] of this.chats.entries()) {
      if (statuses.includes(chat.status)) {
        this.chats.delete(id);
        count++;
      }
    }
    this.persist();
    return count;
  }

  /**
   * 获取配置
   */
  getConfig(): SideChatConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<SideChatConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // --------------------------------------------------------------------------
  // 事件订阅
  // --------------------------------------------------------------------------

  on(type: SideChatEventType, handler: SideChatEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.eventBus.clear();
    this.chats.clear();
    this.storage.clear();
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: SideChatManager | null = null;

export function getSideChatManager(): SideChatManager {
  if (!_instance) {
    _instance = new SideChatManager();
    _instance.initialize();
  }
  return _instance;
}

export function setSideChatManager(instance: SideChatManager): void {
  _instance = instance;
}

export function resetSideChatManager(): void {
  if (_instance) {
    _instance.dispose();
  }
  _instance = null;
}

export function isSideChatManagerInitialized(): boolean {
  return _instance !== null;
}
