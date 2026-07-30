/**
 * # ============================================================
 * # Agent Messaging Engine - 代理消息引擎 (v1.0.0 Cycle 27 G27-04)
 * # ============================================================
 * # 核心作用：实现结构化代理消息协议
 * # 参考：Codex v0.145 V2 send_message / followup_task
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-04 初次创建
 * # ============================================================
 */

import {
  AgentMessage,
  AgentMessageType,
  AgentMessageStatus,
  AgentMessagePriority,
  AgentMessagingConfig,
  AgentMessagingEvent,
  AgentMessagingEventType,
  DEFAULT_AGENT_MESSAGING_CONFIG,
  generateMessageId,
} from './agentMessagingTypes';

/**
 * Follow-up 任务定义
 */
export interface FollowupTask {
  id: string;
  parentMessageId: string;
  targetPath: string;
  task: string;
  scheduledAt: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  completedAt?: number;
  result?: string;
}

/**
 * 路径解析器接口
 */
export interface IPathResolver {
  resolvePath(path: string): string | undefined;
}

/**
 * 任务执行器接口
 */
export interface ITaskExecutor {
  executeTask(targetUuid: string, task: string, parentMessageId: string): Promise<string>;
}

/**
 * 代理消息引擎
 */
export class AgentMessagingEngine {
  private config: AgentMessagingConfig;
  private messages: Map<string, AgentMessage> = new Map();
  private followups: Map<string, FollowupTask> = new Map();
  private listeners: Map<AgentMessagingEventType, Set<(e: AgentMessagingEvent) => void>> = new Map();
  private retryCounters: Map<string, number> = new Map();
  private storageKey = 'hermes.agentMessaging';

  constructor(config: Partial<AgentMessagingConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_MESSAGING_CONFIG, ...config };
    this.load();
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.messages)) {
        for (const m of data.messages) {
          this.messages.set(m.id, m);
        }
      }
      if (data && Array.isArray(data.followups)) {
        for (const f of data.followups) {
          this.followups.set(f.id, f);
        }
      }
    } catch (e) {
      console.warn('AgentMessagingEngine: failed to load', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        messages: Array.from(this.messages.values()),
        followups: Array.from(this.followups.values()),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('AgentMessagingEngine: failed to save', e);
    }
  }

  // ============ 事件系统 ============

  on(event: AgentMessagingEventType, listener: (e: AgentMessagingEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: AgentMessagingEventType, listener: (e: AgentMessagingEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: AgentMessagingEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('AgentMessagingEngine: error in event handler', err);
        }
      }
    }
  }

  // ============ 消息发送 ============

  /**
   * 发送消息
   */
  sendMessage(options: {
    from: string;
    to: string;
    content: string;
    type?: AgentMessageType;
    priority?: AgentMessagePriority;
    ttlMs?: number;
    parentId?: string;
    relatedTaskId?: string;
  }): AgentMessage {
    const msg: AgentMessage = {
      id: generateMessageId(),
      type: options.type || 'send_message',
      from: options.from,
      to: options.to,
      content: options.content,
      status: 'pending',
      priority: options.priority || 'normal',
      createdAt: Date.now(),
      ttlMs: options.ttlMs,
      parentId: options.parentId,
      relatedTaskId: options.relatedTaskId,
      metadata: {},
    };
    this.messages.set(msg.id, msg);
    this.enforceMax();
    // 立即尝试发送
    this.deliverMessage(msg);
    this.save();
    return msg;
  }

  /**
   * 投递消息
   */
  private deliverMessage(msg: AgentMessage): void {
    msg.status = 'sent';
    msg.sentAt = Date.now();
    // 模拟投递
    setTimeout(() => {
      msg.status = 'delivered';
      this.save();
      this.emit({
        type: 'message-delivered',
        timestamp: Date.now(),
        messageId: msg.id,
        data: { to: msg.to },
      });
      // 自动标记为已读
      setTimeout(() => {
        if (msg.status === 'delivered') {
          msg.status = 'read';
          msg.readAt = Date.now();
          this.save();
          this.emit({
            type: 'message-read',
            timestamp: Date.now(),
            messageId: msg.id,
          });
        }
      }, 100);
    }, 50);
    this.emit({
      type: 'message-sent',
      timestamp: Date.now(),
      messageId: msg.id,
      data: { from: msg.from, to: msg.to },
    });
  }

  /**
   * 标记已回复
   */
  markReplied(messageId: string, replyContent?: string): boolean {
    const msg = this.messages.get(messageId);
    if (!msg) return false;
    msg.status = 'replied';
    msg.repliedAt = Date.now();
    if (replyContent) {
      msg.metadata.reply = replyContent;
    }
    this.save();
    this.emit({
      type: 'message-replied',
      timestamp: Date.now(),
      messageId,
      data: { replyContent },
    });
    return true;
  }

  // ============ Followup Task ============

  /**
   * 调度 followup 任务
   */
  scheduleFollowup(parentMessageId: string, targetPath: string, task: string): FollowupTask {
    const id = generateMessageId();
    const followup: FollowupTask = {
      id,
      parentMessageId,
      targetPath,
      task,
      scheduledAt: Date.now(),
      status: 'pending',
    };
    this.followups.set(id, followup);
    this.save();
    this.emit({
      type: 'followup-scheduled',
      timestamp: Date.now(),
      messageId: parentMessageId,
      data: { followupId: id, targetPath, task },
    });
    return followup;
  }

  /**
   * 执行 followup 任务
   */
  async executeFollowup(
    followupId: string,
    executor: ITaskExecutor,
    resolver: IPathResolver
  ): Promise<boolean> {
    const followup = this.followups.get(followupId);
    if (!followup) return false;
    if (followup.status !== 'pending') return false;
    followup.status = 'running';
    this.save();
    try {
      const targetUuid = resolver.resolvePath(followup.targetPath);
      if (!targetUuid) {
        followup.status = 'failed';
        this.save();
        return false;
      }
      const result = await executor.executeTask(targetUuid, followup.task, followup.parentMessageId);
      followup.status = 'completed';
      followup.completedAt = Date.now();
      followup.result = result;
      this.save();
      this.emit({
        type: 'followup-completed',
        timestamp: Date.now(),
        messageId: followup.parentMessageId,
        data: { followupId, result },
      });
      return true;
    } catch (err) {
      followup.status = 'failed';
      this.save();
      this.emit({
        type: 'message-failed',
        timestamp: Date.now(),
        messageId: followup.parentMessageId,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      return false;
    }
  }

  /**
   * 获取待执行的 followup
   */
  getPendingFollowups(): FollowupTask[] {
    return Array.from(this.followups.values()).filter((f) => f.status === 'pending');
  }

  // ============ 查询 ============

  /**
   * 获取消息
   */
  getMessage(id: string): AgentMessage | undefined {
    return this.messages.get(id);
  }

  /**
   * 列出消息
   */
  listMessages(filter?: {
    from?: string;
    to?: string;
    status?: AgentMessageStatus;
    type?: AgentMessageType;
  }): AgentMessage[] {
    let result = Array.from(this.messages.values());
    if (filter) {
      if (filter.from) result = result.filter((m) => m.from === filter.from);
      if (filter.to) result = result.filter((m) => m.to === filter.to);
      if (filter.status) result = result.filter((m) => m.status === filter.status);
      if (filter.type) result = result.filter((m) => m.type === filter.type);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取两个代理间的消息
   */
  getConversation(path1: string, path2: string): AgentMessage[] {
    return this.listMessages().filter(
      (m) => (m.from === path1 && m.to === path2) || (m.from === path2 && m.to === path1)
    );
  }

  /**
   * 获取 followup
   */
  getFollowup(id: string): FollowupTask | undefined {
    return this.followups.get(id);
  }

  /**
   * 列出所有 followup
   */
  listFollowups(): FollowupTask[] {
    return Array.from(this.followups.values()).sort((a, b) => b.scheduledAt - a.scheduledAt);
  }

  // ============ 重试 ============

  /**
   * 重试失败消息
   */
  retryMessage(id: string): boolean {
    const msg = this.messages.get(id);
    if (!msg) return false;
    if (msg.status !== 'failed') return false;
    const retries = this.retryCounters.get(id) || 0;
    if (retries >= this.config.maxRetries) return false;
    this.retryCounters.set(id, retries + 1);
    this.deliverMessage(msg);
    return true;
  }

  /**
   * 强制执行最大消息限制
   */
  private enforceMax(): void {
    const all = this.listMessages();
    if (all.length > this.config.maxMessages) {
      const toDelete = all.slice(this.config.maxMessages);
      for (const m of toDelete) {
        this.messages.delete(m.id);
      }
    }
  }

  /**
   * 清空
   */
  clear(): void {
    this.messages.clear();
    this.followups.clear();
    this.save();
  }

  /**
   * 获取统计
   */
  getStats(): {
    totalMessages: number;
    totalFollowups: number;
    byStatus: Record<AgentMessageStatus, number>;
    byType: Record<AgentMessageType, number>;
  } {
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const m of this.messages.values()) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
      byType[m.type] = (byType[m.type] || 0) + 1;
    }
    return {
      totalMessages: this.messages.size,
      totalFollowups: this.followups.size,
      byStatus: byStatus as Record<AgentMessageStatus, number>,
      byType: byType as Record<AgentMessageType, number>,
    };
  }
}

// ============ 单例 ============

let defaultInstance: AgentMessagingEngine | null = null;

export function getDefaultAgentMessagingEngine(): AgentMessagingEngine {
  if (!defaultInstance) {
    defaultInstance = new AgentMessagingEngine();
  }
  return defaultInstance;
}

export function resetDefaultAgentMessagingEngine(): void {
  defaultInstance = null;
}
