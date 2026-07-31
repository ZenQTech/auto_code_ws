/**
 * # ============================================================
 * # Agent Communication Engine - 智能体通信引擎 (v1.0.0 Cycle 35 G35-02)
 * # ============================================================
 * # 核心作用：实现 A2A 子集，提供 Agent Card / 消息路由 / 优先级队列 / Pub/Sub / 请求-响应
 * # 对标产品：Google A2A / Anthropic MCP / NATS / Kafka
 * # 运行流程：
 * #   1. registerAgent(card) 注册 Agent 能力
 * #   2. send/broadcast/multicast/publish 发送消息
 * #   3. onMessage/subscribe 接收消息
 * #   4. request/response 同步请求-响应
 * #   5. 死信队列 + 重试 + 历史回放
 * # 输入参数：AgentCard / AgentMessage
 * # 输出结果：MessageHandler 回调 / AgentMessage 历史
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * Agent Card（能力描述）
 */
export interface AgentCard {
  agentId: string;
  name: string;
  description: string;
  version: string;
  capabilities: AgentCapability[];
  endpoint: string;
  protocol: 'a2a' | 'mcp' | 'http' | 'websocket';
  authentication?: AuthConfig;
  metadata?: Record<string, unknown>;
  registeredAt: number;
  status: 'online' | 'offline' | 'degraded';
  lastHeartbeat: number;
}

/**
 * 智能体能力
 */
export interface AgentCapability {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: Array<{ input: unknown; output: unknown }>;
}

/**
 * 鉴权配置
 */
export interface AuthConfig {
  type: 'none' | 'hmac' | 'oauth' | 'apikey';
  secret?: string;
  token?: string;
  publicKey?: string;
}

/**
 * 消息类型
 */
export type MessageType =
  | 'request'
  | 'response'
  | 'event'
  | 'broadcast'
  | 'multicast'
  | 'ack'
  | 'error'
  | 'heartbeat';

/**
 * 消息优先级
 */
export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * 消息状态
 */
export type MessageStatus = 'pending' | 'delivered' | 'failed' | 'expired' | 'cancelled';

/**
 * 消息定义
 */
export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string | string[];
  topic?: string;
  priority: MessagePriority;
  payload: unknown;
  correlationId?: string;
  replyTo?: string;
  ttl?: number;
  signature?: string;
  timestamp: number;
  attempts: number;
  status: MessageStatus;
  error?: string;
  deliveredAt?: number;
}

/**
 * 主题订阅
 */
export interface TopicSubscription {
  subscriptionId: string;
  topic: string;
  subscriberId: string;
  filter?: string;
  active: boolean;
  createdAt: number;
}

/**
 * 消息处理回调
 */
export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

/**
 * 引擎事件
 */
export type CommunicationEvent =
  | 'agent-registered'
  | 'agent-updated'
  | 'agent-unregistered'
  | 'message-sent'
  | 'message-delivered'
  | 'message-failed'
  | 'message-expired'
  | 'topic-subscribed'
  | 'topic-unsubscribed'
  | 'agent-offline'
  | 'agent-online';

/**
 * 引擎配置
 */
export interface CommunicationConfig {
  maxQueueSize: number;
  maxHistorySize: number;
  defaultTtlMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  enablePriority: boolean;
  enablePubSub: boolean;
  enablePersistence: boolean;
  enableAuth: boolean;
}

// ============ 默认配置 ============

export const DEFAULT_COMMUNICATION_CONFIG: CommunicationConfig = {
  maxQueueSize: 1000,
  maxHistorySize: 10000,
  defaultTtlMs: 60000,
  maxRetries: 3,
  retryBackoffMs: 1000,
  enablePriority: true,
  enablePubSub: true,
  enablePersistence: true,
  enableAuth: false,
};

// ============ 工具函数 ============

export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateAgentId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSubscriptionId(): string {
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PRIORITY_WEIGHT: Record<MessagePriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export function comparePriority(a: AgentMessage, b: AgentMessage): number {
  return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
}

// ============ 预置 Agent Card ============

export const PRESET_AGENT_CARDS: Omit<AgentCard, 'registeredAt' | 'lastHeartbeat' | 'status'>[] = [
  {
    agentId: 'orchestrator-1',
    name: 'Orchestrator Agent',
    description: '工作流编排器',
    version: '1.0.0',
    capabilities: [
      { name: 'workflow.start', description: '启动工作流' },
      { name: 'workflow.pause', description: '暂停工作流' },
      { name: 'workflow.resume', description: '恢复工作流' },
    ],
    endpoint: 'local://orchestrator',
    protocol: 'a2a',
  },
  {
    agentId: 'worker-1',
    name: 'Worker Agent',
    description: '任务执行器',
    version: '1.0.0',
    capabilities: [
      { name: 'task.execute', description: '执行任务' },
      { name: 'tool.call', description: '工具调用' },
      { name: 'code.run', description: '运行代码' },
    ],
    endpoint: 'local://worker',
    protocol: 'a2a',
  },
  {
    agentId: 'reviewer-1',
    name: 'Reviewer Agent',
    description: '审查器',
    version: '1.0.0',
    capabilities: [
      { name: 'plan.review', description: '审查计划' },
      { name: 'code.review', description: '代码审查' },
      { name: 'quality.assess', description: '质量评估' },
    ],
    endpoint: 'local://reviewer',
    protocol: 'a2a',
  },
  {
    agentId: 'synthesizer-1',
    name: 'Synthesizer Agent',
    description: '综合器',
    version: '1.0.0',
    capabilities: [
      { name: 'result.aggregate', description: '结果聚合' },
      { name: 'response.compose', description: '响应合成' },
    ],
    endpoint: 'local://synthesizer',
    protocol: 'a2a',
  },
];

// ============ 引擎实现 ============

export class AgentCommunicationEngine {
  private agents: Map<string, AgentCard> = new Map();
  private messages: Map<string, AgentMessage> = new Map();
  private queues: Map<string, AgentMessage[]> = new Map(); // agentId -> queue
  private subscriptions: Map<string, TopicSubscription> = new Map();
  private topicSubscribers: Map<string, Set<string>> = new Map(); // topic -> subscriptionIds
  private handlers: Map<string, Set<MessageHandler>> = new Map(); // agentId or topic -> handlers
  private config: CommunicationConfig;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private storageKey: string;
  private deadLetter: AgentMessage[] = [];

  constructor(config: Partial<CommunicationConfig> = {}) {
    this.config = { ...DEFAULT_COMMUNICATION_CONFIG, ...config };
    this.storageKey = 'agent-communication';
    this.loadFromStorage();
    if (this.agents.size === 0) {
      this.loadPresetAgents();
    }
  }

  // ============ 存储 ============

  private loadFromStorage(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') return;
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.agents) for (const a of parsed.agents) this.agents.set(a.agentId, a);
        if (parsed.messages) for (const m of parsed.messages) this.messages.set(m.id, m);
        if (parsed.deadLetter) this.deadLetter = parsed.deadLetter;
      }
    } catch (e) {
      // ignore
    }
  }

  private saveToStorage(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') return;
    try {
      const data = {
        agents: Array.from(this.agents.values()),
        messages: Array.from(this.messages.values()).slice(-this.config.maxHistorySize),
        deadLetter: this.deadLetter.slice(-100),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  private loadPresetAgents(): void {
    const now = Date.now();
    for (const preset of PRESET_AGENT_CARDS) {
      this.agents.set(preset.agentId, {
        ...preset,
        registeredAt: now,
        lastHeartbeat: now,
        status: 'online',
      });
    }
    this.saveToStorage();
  }

  // ============ Agent Card 管理 ============

  registerAgent(card: Omit<AgentCard, 'registeredAt' | 'lastHeartbeat' | 'status'>): AgentCard {
    const now = Date.now();
    const full: AgentCard = {
      ...card,
      status: 'online',
      registeredAt: now,
      lastHeartbeat: now,
    };
    this.agents.set(full.agentId, full);
    this.saveToStorage();
    this.emit('agent-registered', full);
    return full;
  }

  updateAgent(agentId: string, updates: Partial<AgentCard>): AgentCard {
    const existing = this.agents.get(agentId);
    if (!existing) throw new Error(`Agent ${agentId} not found`);
    const updated = { ...existing, ...updates, agentId, lastHeartbeat: Date.now() };
    this.agents.set(agentId, updated);
    this.saveToStorage();
    this.emit('agent-updated', updated);
    return updated;
  }

  unregisterAgent(agentId: string): boolean {
    const result = this.agents.delete(agentId);
    if (result) {
      this.saveToStorage();
      this.emit('agent-unregistered', { agentId });
    }
    return result;
  }

  getAgent(agentId: string): AgentCard | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): AgentCard[] {
    return Array.from(this.agents.values());
  }

  // ============ 消息发送 ============

  async send(
    to: string,
    payload: unknown,
    options: {
      from?: string;
      priority?: MessagePriority;
      ttl?: number;
      type?: MessageType;
      correlationId?: string;
    } = {},
  ): Promise<AgentMessage> {
    const msg = this.createMessage({
      to,
      payload,
      from: options.from || 'system',
      priority: options.priority || 'normal',
      ttl: options.ttl,
      type: options.type || 'request',
      correlationId: options.correlationId,
    });
    return await this.deliverMessage(msg);
  }

  async broadcast(
    payload: unknown,
    options: { from?: string; priority?: MessagePriority; topic?: string } = {},
  ): Promise<AgentMessage[]> {
    const allAgents = this.listAgents().filter((a) => a.status === 'online');
    const messages: AgentMessage[] = [];
    for (const agent of allAgents) {
      const msg = await this.send(agent.agentId, payload, {
        from: options.from || 'system',
        priority: options.priority,
        type: 'broadcast',
      });
      messages.push(msg);
    }
    return messages;
  }

  async multicast(
    to: string[],
    payload: unknown,
    options: { from?: string; priority?: MessagePriority } = {},
  ): Promise<AgentMessage[]> {
    const messages: AgentMessage[] = [];
    for (const target of to) {
      const msg = await this.send(target, payload, {
        from: options.from || 'system',
        priority: options.priority,
        type: 'multicast',
      });
      messages.push(msg);
    }
    return messages;
  }

  async publish(
    topic: string,
    payload: unknown,
    options: { from?: string; priority?: MessagePriority } = {},
  ): Promise<AgentMessage[]> {
    const subscriberIds = this.topicSubscribers.get(topic) || new Set();
    const messages: AgentMessage[] = [];
    for (const subId of subscriberIds) {
      const sub = this.subscriptions.get(subId);
      if (sub && sub.active) {
        // 创建消息（不通过 send，直接构造以避免覆盖 handler key）
        const msg = this.createMessage({
          to: sub.subscriberId,
          payload,
          from: options.from || 'system',
          priority: options.priority || 'normal',
          type: 'event',
        });
        msg.topic = topic;
        // 触发 topic:subscriberId 的 handler
        const topicKey = `${topic}:${sub.subscriberId}`;
        const handlers = this.handlers.get(topicKey);
        if (handlers) {
          msg.attempts += 1;
          this.messages.set(msg.id, msg);
          this.emit('message-sent', msg);
          for (const h of handlers) {
            try {
              await Promise.resolve(h(msg));
            } catch (e) {
              // ignore
            }
          }
          msg.status = 'delivered';
          msg.deliveredAt = Date.now();
          this.emit('message-delivered', msg);
        }
        messages.push(msg);
      }
    }
    this.saveToStorage();
    return messages;
  }

  // ============ 消息接收 ============

  onMessage(agentId: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(agentId)) this.handlers.set(agentId, new Set());
    this.handlers.get(agentId)!.add(handler);
    return () => {
      this.handlers.get(agentId)?.delete(handler);
    };
  }

  subscribe(topic: string, handler: MessageHandler, subscriberId: string = 'default', filter?: string): () => void {
    const subId = generateSubscriptionId();
    const sub: TopicSubscription = {
      subscriptionId: subId,
      topic,
      subscriberId,
      filter,
      active: true,
      createdAt: Date.now(),
    };
    this.subscriptions.set(subId, sub);
    if (!this.topicSubscribers.has(topic)) this.topicSubscribers.set(topic, new Set());
    this.topicSubscribers.get(topic)!.add(subId);

    const topicHandlers = `${topic}:${subscriberId}`;
    if (!this.handlers.has(topicHandlers)) this.handlers.set(topicHandlers, new Set());
    this.handlers.get(topicHandlers)!.add(handler);

    this.emit('topic-subscribed', sub);

    return () => {
      sub.active = false;
      this.topicSubscribers.get(topic)?.delete(subId);
      this.handlers.get(topicHandlers)?.delete(handler);
      this.emit('topic-unsubscribed', { subscriptionId: subId });
    };
  }

  // ============ 请求-响应 ============

  async request(
    to: string,
    payload: unknown,
    options: { from?: string; timeoutMs?: number; priority?: MessagePriority } = {},
  ): Promise<AgentMessage> {
    const correlationId = generateMessageId();
    return new Promise((resolve, reject) => {
      const timeout = options.timeoutMs || 30000;
      const timer = setTimeout(() => {
        unsub();
        reject(new Error('Request timeout'));
      }, timeout);

      const unsub = this.onMessage(options.from || 'system', (msg) => {
        if (msg.correlationId === correlationId && msg.type === 'response') {
          clearTimeout(timer);
          unsub();
          resolve(msg);
        }
      });

      this.send(to, payload, {
        from: options.from || 'system',
        priority: options.priority,
        type: 'request',
        correlationId,
      }).catch((e) => {
        clearTimeout(timer);
        unsub();
        reject(e);
      });
    });
  }

  // ============ 内部：消息处理 ============

  private createMessage(opts: {
    to: string | string[];
    from: string;
    payload: unknown;
    priority: MessagePriority;
    ttl?: number;
    type: MessageType;
    correlationId?: string;
  }): AgentMessage {
    return {
      id: generateMessageId(),
      type: opts.type,
      from: opts.from,
      to: opts.to,
      priority: opts.priority,
      payload: opts.payload,
      correlationId: opts.correlationId,
      ttl: opts.ttl,
      timestamp: Date.now(),
      attempts: 0,
      status: 'pending',
    };
  }

  private async deliverMessage(msg: AgentMessage): Promise<AgentMessage> {
    msg.attempts += 1;
    this.messages.set(msg.id, msg);
    this.emit('message-sent', msg);

    // 推入目标队列
    const targets = Array.isArray(msg.to) ? msg.to : [msg.to];
    for (const target of targets) {
      if (!this.queues.has(target)) this.queues.set(target, []);
      this.queues.get(target)!.push(msg);
      // 排序（按优先级）
      if (this.config.enablePriority) {
        this.queues.get(target)!.sort(comparePriority);
      }
    }

    // 触发 handler
    try {
      const handlers = this.handlers.get(msg.to as string);
      if (handlers) {
        for (const h of handlers) {
          await Promise.resolve(h(msg));
        }
      }
      msg.status = 'delivered';
      msg.deliveredAt = Date.now();
      this.emit('message-delivered', msg);
    } catch (e: any) {
      msg.status = 'failed';
      msg.error = e.message;
      this.emit('message-failed', msg);
      // 重试
      if (msg.attempts < this.config.maxRetries) {
        await new Promise((r) => setTimeout(r, this.config.retryBackoffMs));
        return await this.deliverMessage(msg);
      } else {
        this.deadLetter.push(msg);
      }
    }

    this.saveToStorage();
    return msg;
  }

  // ============ 队列与历史 ============

  getQueue(agentId: string, filter?: { status?: MessageStatus; type?: MessageType }): AgentMessage[] {
    const queue = this.queues.get(agentId) || [];
    if (!filter) return queue;
    return queue.filter((m) => {
      if (filter.status && m.status !== filter.status) return false;
      if (filter.type && m.type !== filter.type) return false;
      return true;
    });
  }

  getHistory(filter?: { from?: string; to?: string; type?: MessageType; limit?: number }): AgentMessage[] {
    let list = Array.from(this.messages.values());
    if (filter?.from) list = list.filter((m) => m.from === filter.from);
    if (filter?.to) list = list.filter((m) => Array.isArray(m.to) ? m.to.includes(filter.to!) : m.to === filter.to);
    if (filter?.type) list = list.filter((m) => m.type === filter.type);
    list.sort((a, b) => b.timestamp - a.timestamp);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list;
  }

  getDeadLetter(): AgentMessage[] {
    return this.deadLetter;
  }

  async retryMessage(messageId: string): Promise<boolean> {
    const msg = this.messages.get(messageId);
    if (!msg) return false;
    msg.attempts = 0;
    msg.status = 'pending';
    msg.error = undefined;
    await this.deliverMessage(msg);
    return true;
  }

  // ============ 高级功能 ============

  async heartbeat(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.lastHeartbeat = Date.now();
    if (agent.status === 'offline') {
      agent.status = 'online';
      this.emit('agent-online', { agentId });
    }
    return true;
  }

  getActiveAgents(): string[] {
    return this.listAgents().filter((a) => a.status === 'online').map((a) => a.agentId);
  }

  /**
   * 列出所有订阅
   */
  listSubscriptions(): TopicSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * 列出所有消息（按时间倒序）
   */
  listMessages(filter?: { limit?: number }): AgentMessage[] {
    let list = Array.from(this.messages.values());
    list.sort((a, b) => b.timestamp - a.timestamp);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list;
  }

  getStats() {
    const messages = Array.from(this.messages.values());
    return {
      agents: {
        total: this.agents.size,
        online: this.agents.size - this.agents.size, // simplified
        byStatus: {
          online: this.listAgents().filter((a) => a.status === 'online').length,
          offline: this.listAgents().filter((a) => a.status === 'offline').length,
          degraded: this.listAgents().filter((a) => a.status === 'degraded').length,
        },
      },
      messages: {
        total: messages.length,
        byStatus: {
          pending: messages.filter((m) => m.status === 'pending').length,
          delivered: messages.filter((m) => m.status === 'delivered').length,
          failed: messages.filter((m) => m.status === 'failed').length,
          expired: messages.filter((m) => m.status === 'expired').length,
          cancelled: messages.filter((m) => m.status === 'cancelled').length,
        },
        byPriority: {
          urgent: messages.filter((m) => m.priority === 'urgent').length,
          high: messages.filter((m) => m.priority === 'high').length,
          normal: messages.filter((m) => m.priority === 'normal').length,
          low: messages.filter((m) => m.priority === 'low').length,
        },
      },
      subscriptions: this.subscriptions.size,
      deadLetter: this.deadLetter.length,
    };
  }

  // ============ 持久化 ============

  exportState(): string {
    return JSON.stringify({
      agents: Array.from(this.agents.values()),
      messages: Array.from(this.messages.values()).slice(-this.config.maxHistorySize),
      subscriptions: Array.from(this.subscriptions.values()),
      deadLetter: this.deadLetter.slice(-100),
    });
  }

  importState(serialized: string): void {
    const data = JSON.parse(serialized);
    if (data.agents) for (const a of data.agents) this.agents.set(a.agentId, a);
    if (data.messages) for (const m of data.messages) this.messages.set(m.id, m);
    if (data.subscriptions) for (const s of data.subscriptions) this.subscriptions.set(s.subscriptionId, s);
    if (data.deadLetter) this.deadLetter = data.deadLetter;
    this.saveToStorage();
  }

  // ============ 事件系统 ============

  on(event: CommunicationEvent, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
    return () => {
      const list = this.listeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  private emit(event: CommunicationEvent, data: any): void {
    const list = this.listeners.get(event);
    if (list) {
      for (const h of list) {
        try {
          h(data);
        } catch (e) {
          // ignore
        }
      }
    }
  }
}

// ============ 单例 ============

let defaultEngine: AgentCommunicationEngine | null = null;

export function getDefaultAgentCommunicationEngine(): AgentCommunicationEngine {
  if (!defaultEngine) {
    defaultEngine = new AgentCommunicationEngine();
  }
  return defaultEngine;
}

export function resetDefaultAgentCommunicationEngine(): void {
  defaultEngine = null;
}
