/**
 * # ============================================================
 * # Agent Messaging Types - 代理消息类型 (v1.0.0 Cycle 27 G27-04)
 * # ============================================================
 * # 核心作用：定义结构化代理消息协议
 * # 参考：Codex v0.145 V2 send_message / followup_task
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-04 初次创建
 * # ============================================================
 */

/**
 * 消息类型
 */
export type AgentMessageType =
  | 'send_message' // 主动发送消息
  | 'followup_task' // 后续任务（等待响应后继续）
  | 'broadcast' // 广播
  | 'request_reply' // 请求回复
  | 'ack'; // 确认

/**
 * 消息状态
 */
export type AgentMessageStatus =
  | 'pending' // 待发送
  | 'sent' // 已发送
  | 'delivered' // 已送达
  | 'read' // 已读
  | 'replied' // 已回复
  | 'failed' // 失败
  | 'expired'; // 过期

/**
 * 消息优先级
 */
export type AgentMessagePriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * 代理消息
 */
export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  /** 发送者路径 */
  from: string;
  /** 接收者路径 */
  to: string;
  /** 消息内容 */
  content: string;
  /** 状态 */
  status: AgentMessageStatus;
  /** 优先级 */
  priority: AgentMessagePriority;
  /** 创建时间 */
  createdAt: number;
  /** 发送时间 */
  sentAt?: number;
  /** 读取时间 */
  readAt?: number;
  /** 回复时间 */
  repliedAt?: number;
  /** 过期时间（毫秒） */
  ttlMs?: number;
  /** 父消息 ID（用于线程） */
  parentId?: string;
  /** 关联任务 ID（followup_task 使用） */
  relatedTaskId?: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 消息引擎配置
 */
export interface AgentMessagingConfig {
  /** 最大保留消息数 */
  maxMessages: number;
  /** 默认 TTL（毫秒） */
  defaultTtlMs: number;
  /** 持久化 */
  persist: boolean;
  /** 自动重试 */
  enableRetry: boolean;
  /** 最大重试次数 */
  maxRetries: number;
}

/**
 * 事件类型
 */
export type AgentMessagingEventType =
  | 'message-sent'
  | 'message-delivered'
  | 'message-read'
  | 'message-replied'
  | 'message-failed'
  | 'message-expired'
  | 'followup-scheduled'
  | 'followup-completed';

/**
 * 事件
 */
export interface AgentMessagingEvent {
  type: AgentMessagingEventType;
  timestamp: number;
  messageId: string;
  data?: Record<string, unknown>;
}

/**
 * 默认配置
 */
export const DEFAULT_AGENT_MESSAGING_CONFIG: AgentMessagingConfig = {
  maxMessages: 1000,
  defaultTtlMs: 24 * 60 * 60 * 1000, // 24h
  persist: true,
  enableRetry: true,
  maxRetries: 3,
};

/**
 * 生成消息 ID
 */
export function generateMessageId(): string {
  return 'msg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 消息类型元数据
 */
export const MESSAGE_TYPE_METADATA: Record<AgentMessageType, { label: string; icon: string }> = {
  send_message: { label: '发送消息', icon: '💬' },
  followup_task: { label: '后续任务', icon: '➡️' },
  broadcast: { label: '广播', icon: '📡' },
  request_reply: { label: '请求回复', icon: '❓' },
  ack: { label: '确认', icon: '✅' },
};

export const MESSAGE_STATUS_METADATA: Record<AgentMessageStatus, { label: string; color: string; icon: string }> = {
  pending: { label: '待发送', color: 'text-slate-500', icon: '⏳' },
  sent: { label: '已发送', color: 'text-blue-500', icon: '📤' },
  delivered: { label: '已送达', color: 'text-cyan-500', icon: '📬' },
  read: { label: '已读', color: 'text-green-500', icon: '👀' },
  replied: { label: '已回复', color: 'text-purple-500', icon: '💬' },
  failed: { label: '失败', color: 'text-red-500', icon: '❌' },
  expired: { label: '已过期', color: 'text-orange-500', icon: '⏰' },
};
