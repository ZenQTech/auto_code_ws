# G35-02: AgentCommunicationEngine SPEC

> **任务 ID**: G35-02
> **任务名称**: 智能体通信引擎（A2A 子集）
> **版本**: v1.0.0
> **日期**: 2026-07-31
> **状态**: 设计阶段

---

## 1. 概述

实现智能体间标准化通信协议，借鉴 Google A2A 规范，提供 Agent Card 能力描述、消息路由、优先级队列、Pub/Sub 主题、请求-响应双模式与通信历史回放。

## 2. 对标产品

- **Google A2A**: Agent Card + JSON-RPC + Task/Artifact
- **Anthropic MCP**: Tool/Resource/Prompt 协议
- **NATS / Kafka**: Pub/Sub + 持久化

## 3. 核心类型

### 3.1 Agent Card（能力描述）

```typescript
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
}
```

### 3.2 智能体能力

```typescript
export interface AgentCapability {
  name: string;
  description: string;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  examples?: Array<{ input: unknown; output: unknown }>;
}
```

### 3.3 消息类型

```typescript
export type MessageType =
  | 'request'      // 同步请求
  | 'response'     // 请求响应
  | 'event'        // 异步事件
  | 'broadcast'    // 广播
  | 'multicast'    // 多播
  | 'ack'          // 确认
  | 'error'        // 错误
  | 'heartbeat';   // 心跳

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';
```

### 3.4 消息定义

```typescript
export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string | string[];  // 支持多目标
  topic?: string;          // Pub/Sub 主题
  priority: MessagePriority;
  payload: unknown;
  correlationId?: string;  // 关联 request/response
  replyTo?: string;        // 响应地址
  ttl?: number;            // 过期时间（ms）
  signature?: string;      // HMAC 签名
  timestamp: number;
  attempts: number;
  status: 'pending' | 'delivered' | 'failed' | 'expired' | 'cancelled';
  error?: string;
}
```

### 3.5 主题订阅

```typescript
export interface TopicSubscription {
  subscriptionId: string;
  topic: string;
  subscriberId: string;
  filter?: string;        // 消息过滤表达式
  active: boolean;
  createdAt: number;
}
```

### 3.6 鉴权配置

```typescript
export interface AuthConfig {
  type: 'none' | 'hmac' | 'oauth' | 'apikey';
  secret?: string;
  token?: string;
  publicKey?: string;
}
```

## 4. 核心 API

### 4.1 Agent Card 管理

```typescript
class AgentCommunicationEngine {
  registerAgent(card: Omit<AgentCard, 'registeredAt'>): AgentCard;
  updateAgent(agentId: string, updates: Partial<AgentCard>): AgentCard;
  unregisterAgent(agentId: string): boolean;
  getAgent(agentId: string): AgentCard | undefined;
  listAgents(): AgentCard[];
}
```

### 4.2 消息发送

```typescript
class AgentCommunicationEngine {
  // 点对点
  send(to: string, payload: unknown, options?: SendOptions): Promise<AgentMessage>;
  
  // 广播
  broadcast(payload: unknown, options?: BroadcastOptions): Promise<AgentMessage[]>;
  
  // 多播
  multicast(to: string[], payload: unknown, options?: SendOptions): Promise<AgentMessage[]>;
  
  // 发布到主题
  publish(topic: string, payload: unknown, options?: PublishOptions): Promise<AgentMessage[]>;
}
```

### 4.3 消息接收

```typescript
class AgentCommunicationEngine {
  // 接收特定 Agent 的消息
  onMessage(agentId: string, handler: MessageHandler): Unsubscribe;
  
  // 订阅主题
  subscribe(topic: string, handler: MessageHandler, filter?: string): Unsubscribe;
  
  // 请求-响应
  request(to: string, payload: unknown, options?: RequestOptions): Promise<AgentMessage>;
}
```

### 4.4 队列与历史

```typescript
class AgentCommunicationEngine {
  // 消息队列
  getQueue(agentId: string, filter?: QueueFilter): AgentMessage[];
  
  // 通信历史
  getHistory(filter?: HistoryFilter): AgentMessage[];
  
  // 死信队列
  getDeadLetter(): AgentMessage[];
  
  // 重试
  retryMessage(messageId: string): Promise<boolean>;
}
```

### 4.5 高级功能

```typescript
class AgentCommunicationEngine {
  // 消息统计
  getStats(): MessagingStats;
  
  // 持久化
  exportState(): SerializedState;
  importState(state: SerializedState): void;
  
  // 健康检查
  heartbeat(agentId: string): Promise<boolean>;
  getActiveAgents(): string[];
}
```

## 5. 预置 Agent Card

### 5.1 Orchestrator Agent
- 能力：workflow.start / workflow.pause / workflow.resume

### 5.2 Worker Agent
- 能力：task.execute / tool.call / code.run

### 5.3 Reviewer Agent
- 能力：plan.review / code.review / quality.assess

### 5.4 Synthesizer Agent
- 能力：result.aggregate / response.compose

## 6. 事件系统

```typescript
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
```

## 7. 默认配置

```typescript
export const DEFAULT_COMMUNICATION_CONFIG = {
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
```

## 8. 单例模式

```typescript
export function getDefaultAgentCommunicationEngine(): AgentCommunicationEngine;
export function resetDefaultAgentCommunicationEngine(): void;
```

## 9. 单元测试覆盖

| 类别 | 测试数 | 覆盖点 |
|------|--------|--------|
| 工具函数 | 3 | generateXxxId |
| 初始化 | 3 | 默认配置 + 预置 Agent |
| Agent Card 管理 | 8 | register/update/unregister/get/list |
| 点对点消息 | 6 | send + onMessage + response |
| 广播/多播 | 5 | broadcast/multicast/ack |
| Pub/Sub | 6 | publish/subscribe/unsubscribe |
| 优先级队列 | 5 | high > normal > low |
| 通信历史 | 4 | query + filter + replay |
| 死信队列 | 3 | dead letter + retry |
| 鉴权 | 4 | HMAC 签名验证 |
| 持久化 | 3 | export/import |
| 事件 | 3 | subscribe/trigger |
| 统计 | 2 | 消息统计 |
| 单例 | 2 | getDefault/resetDefault |
| **合计** | **~57** | |

## 10. 验收标准

- ✅ Agent Card 完整描述（能力 + 端点 + 协议 + 鉴权）
- ✅ 4 种消息类型（request/response/event/broadcast）
- ✅ 4 级优先级（low/normal/high/urgent）
- ✅ Pub/Sub 主题订阅
- ✅ 请求-响应 + 异步事件双模式
- ✅ HMAC 签名验证
- ✅ 死信队列 + 重试
- ✅ 通信历史 + 回放
- ✅ 57+ 单元测试通过
- ✅ TypeScript 0 错误
- ✅ 与 `agentMessagingEngine` 兼容

## 11. 依赖与集成

### 依赖
- 无外部依赖（纯前端实现）

### 集成
- 可被 `workflowOrchestratorEngine` 调用（节点间通信）
- 可被 `orchestratedAgentEngine` 调用（角色间消息）
- UI 面板: `AgentCommunicationPanel.tsx`
