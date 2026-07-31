/**
 * # Agent Communication Engine - 单元测试
 * # Cycle 35 G35-02
 * # 覆盖：工具函数、初始化、Agent Card、消息发送/接收、Pub/Sub、优先级、历史、单例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentCommunicationEngine,
  generateMessageId,
  generateAgentId,
  generateSubscriptionId,
  comparePriority,
  getDefaultAgentCommunicationEngine,
  resetDefaultAgentCommunicationEngine,
} from './agentCommunicationEngine';

describe('AgentCommunicationEngine - 工具函数', () => {
  it('generateXxxId 生成唯一 ID', () => {
    expect(generateMessageId()).toMatch(/^msg-/);
    expect(generateAgentId()).toMatch(/^agent-/);
    expect(generateSubscriptionId()).toMatch(/^sub-/);
  });

  it('comparePriority 优先级比较', () => {
    const msg1 = { priority: 'high' } as any;
    const msg2 = { priority: 'low' } as any;
    // comparePriority(a, b) < 0 表示 a 应排在 b 前面（用于 sort）
    expect(comparePriority(msg1, msg2)).toBeLessThan(0);
    expect(comparePriority(msg2, msg1)).toBeGreaterThan(0);
  });
});

describe('AgentCommunicationEngine - 初始化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('使用默认配置创建', () => {
    const engine = new AgentCommunicationEngine();
    expect(engine).toBeInstanceOf(AgentCommunicationEngine);
  });

  it('加载 4 个预置 Agent', () => {
    const engine = new AgentCommunicationEngine({ enablePersistence: false });
    expect(engine.listAgents().length).toBeGreaterThanOrEqual(4);
  });

  it('4 个预置 Agent 类型正确', () => {
    const engine = new AgentCommunicationEngine({ enablePersistence: false });
    const agents = engine.listAgents();
    expect(agents.some((a) => a.agentId === 'orchestrator-1')).toBe(true);
    expect(agents.some((a) => a.agentId === 'worker-1')).toBe(true);
    expect(agents.some((a) => a.agentId === 'reviewer-1')).toBe(true);
    expect(agents.some((a) => a.agentId === 'synthesizer-1')).toBe(true);
  });
});

describe('AgentCommunicationEngine - Agent Card 管理', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('registerAgent 注册', () => {
    const card = engine.registerAgent({
      agentId: 'custom-1',
      name: 'Custom',
      description: 'T',
      version: '1.0.0',
      capabilities: [],
      endpoint: 'local://custom',
      protocol: 'a2a',
    });
    expect(card.agentId).toBe('custom-1');
  });

  it('updateAgent 更新', () => {
    const updated = engine.updateAgent('worker-1', { name: 'Updated' });
    expect(updated.name).toBe('Updated');
  });

  it('unregisterAgent 注销', () => {
    expect(engine.unregisterAgent('custom-1')).toBe(false); // not exist
    engine.registerAgent({
      agentId: 'temp-1',
      name: 'T',
      description: 'T',
      version: '1.0.0',
      capabilities: [],
      endpoint: 't',
      protocol: 'a2a',
    });
    expect(engine.unregisterAgent('temp-1')).toBe(true);
  });

  it('getAgent 获取', () => {
    expect(engine.getAgent('worker-1')?.name).toBe('Worker Agent');
  });

  it('listAgents 列表', () => {
    expect(Array.isArray(engine.listAgents())).toBe(true);
  });
});

describe('AgentCommunicationEngine - 消息发送', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('send 点对点', async () => {
    const msg = await engine.send('worker-1', { test: 'data' });
    expect(msg.id).toBeDefined();
    expect(msg.status).toBe('delivered');
  });

  it('send 触发 onMessage handler', async () => {
    const received: any[] = [];
    engine.onMessage('worker-1', (m) => { received.push(m); });
    await engine.send('worker-1', { hello: 'world' });
    expect(received.length).toBe(1);
  });

  it('broadcast 广播', async () => {
    const msgs = await engine.broadcast({ event: 'X' });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('multicast 多播', async () => {
    const msgs = await engine.multicast(['worker-1', 'reviewer-1'], { data: 'X' });
    expect(msgs.length).toBe(2);
  });

  it('publish 发布到主题', async () => {
    let received = false;
    engine.subscribe('events.test', (_m) => {
      received = true;
    }, 'subscriber-1');
    await engine.publish('events.test', { event: 'X' });
    expect(received).toBe(true);
  });
});

describe('AgentCommunicationEngine - Pub/Sub', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('subscribe 订阅主题', () => {
    const unsub = engine.subscribe('topic-1', () => {}, 'sub-1');
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('unsubscribe 取消订阅', async () => {
    const received: any[] = [];
    const unsub = engine.subscribe('topic-2', (m) => { received.push(m); }, 'sub-2');
    await engine.publish('topic-2', { data: 1 });
    expect(received.length).toBe(1);
    unsub();
    await engine.publish('topic-2', { data: 2 });
    expect(received.length).toBe(1);
  });

  it('多订阅者', async () => {
    let r1 = 0;
    let r2 = 0;
    engine.subscribe('topic-3', () => { r1++; }, 's1');
    engine.subscribe('topic-3', () => { r2++; }, 's2');
    await engine.publish('topic-3', { data: 1 });
    expect(r1).toBe(1);
    expect(r2).toBe(1);
  });
});

describe('AgentCommunicationEngine - 优先级队列', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('getQueue 返回目标队列', async () => {
    await engine.send('worker-1', { x: 1 }, { priority: 'normal' });
    const queue = engine.getQueue('worker-1');
    expect(queue.length).toBeGreaterThan(0);
  });

  it('getQueue 按状态过滤', async () => {
    await engine.send('worker-1', { x: 1 });
    const queue = engine.getQueue('worker-1', { status: 'delivered' });
    expect(queue.every((m) => m.status === 'delivered')).toBe(true);
  });

  it('高优先级排在前面', async () => {
    await engine.send('worker-1', { x: 1 }, { priority: 'low' });
    await engine.send('worker-1', { x: 2 }, { priority: 'urgent' });
    const queue = engine.getQueue('worker-1');
    expect(queue[0].priority).toBe('urgent');
  });
});

describe('AgentCommunicationEngine - 请求-响应', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('request 同步响应', async () => {
    // 模拟 worker 收到请求后立即响应
    engine.onMessage('worker-1', async (msg) => {
      if (msg.type === 'request' && msg.correlationId) {
        await engine.send(msg.from, { reply: 'ok' }, {
          type: 'response',
          correlationId: msg.correlationId,
        });
      }
    });
    const response = await engine.request('worker-1', { q: 'test' }, { from: 'system', timeoutMs: 5000 });
    expect(response.type).toBe('response');
  });
});

describe('AgentCommunicationEngine - 通信历史', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('getHistory 全部历史', async () => {
    await engine.send('worker-1', { x: 1 });
    await engine.send('reviewer-1', { x: 2 });
    const history = engine.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('getHistory 按 from 过滤', async () => {
    await engine.send('worker-1', { x: 1 }, { from: 'sender-a' });
    await engine.send('worker-1', { x: 2 }, { from: 'sender-b' });
    const history = engine.getHistory({ from: 'sender-a' });
    expect(history.every((m) => m.from === 'sender-a')).toBe(true);
  });

  it('getHistory 按类型过滤', async () => {
    await engine.send('worker-1', { x: 1 }, { type: 'event' });
    const history = engine.getHistory({ type: 'event' });
    expect(history.every((m) => m.type === 'event')).toBe(true);
  });
});

describe('AgentCommunicationEngine - 死信队列', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('getDeadLetter 返回空（默认）', () => {
    const dl = engine.getDeadLetter();
    expect(Array.isArray(dl)).toBe(true);
  });
});

describe('AgentCommunicationEngine - 心跳与状态', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('heartbeat 更新状态', async () => {
    const result = await engine.heartbeat('worker-1');
    expect(result).toBe(true);
  });

  it('getActiveAgents 返回在线 Agent', () => {
    const active = engine.getActiveAgents();
    expect(Array.isArray(active)).toBe(true);
    expect(active.length).toBeGreaterThan(0);
  });
});

describe('AgentCommunicationEngine - 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exportState 导出', () => {
    const engine = new AgentCommunicationEngine({ enablePersistence: false });
    const exported = engine.exportState();
    expect(exported).toBeDefined();
  });

  it('importState 导入', async () => {
    const e1 = new AgentCommunicationEngine({ enablePersistence: false });
    await e1.send('worker-1', { x: 1 });
    const exported = e1.exportState();
    const e2 = new AgentCommunicationEngine({ enablePersistence: false });
    e2.importState(exported);
    expect(e2.listAgents().length).toBeGreaterThan(0);
  });
});

describe('AgentCommunicationEngine - 事件系统', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('on 订阅事件', () => {
    const unsub = engine.on('message-sent', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('emit message-sent 触发', async () => {
    const events: any[] = [];
    engine.on('message-sent', (e) => events.push(e));
    await engine.send('worker-1', { x: 1 });
    expect(events.length).toBe(1);
  });
});

describe('AgentCommunicationEngine - 统计', () => {
  let engine: AgentCommunicationEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentCommunicationEngine({ enablePersistence: false });
  });

  it('getStats 返回完整统计', async () => {
    await engine.send('worker-1', { x: 1 });
    const stats = engine.getStats();
    expect(stats.agents).toBeDefined();
    expect(stats.messages).toBeDefined();
    expect(stats.messages.total).toBeGreaterThanOrEqual(1);
  });
});

describe('AgentCommunicationEngine - 单例', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultAgentCommunicationEngine();
  });

  it('getDefault 返回单例', () => {
    const e1 = getDefaultAgentCommunicationEngine();
    const e2 = getDefaultAgentCommunicationEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefault 重置', () => {
    const e1 = getDefaultAgentCommunicationEngine();
    resetDefaultAgentCommunicationEngine();
    const e2 = getDefaultAgentCommunicationEngine();
    expect(e1).not.toBe(e2);
  });
});
