/**
 * HookChainTracker 单元测试 (v1.0.0 Cycle 21 G21-02)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HookChainTracker,
  getHookChainTracker,
  resetHookChainTracker,
  isHookChainTrackerInitialized,
  type HookEvent,
} from './hookChainTracker';

function makeEvent(type: HookEvent['type'] = 'before_prompt'): HookEvent {
  return {
    id: `evt-${Date.now()}-${Math.random()}`,
    type,
    hookId: 'hook-1',
    payload: { prompt: 'test' },
    timestamp: Date.now(),
  };
}

describe('HookChainTracker', () => {
  let tracker: HookChainTracker;

  beforeEach(() => {
    resetHookChainTracker();
    tracker = getHookChainTracker();
  });

  describe('单例', () => {
    it('返回相同实例', () => {
      const a = getHookChainTracker();
      const b = getHookChainTracker();
      expect(a).toBe(b);
    });

    it('isHookChainTrackerInitialized', () => {
      expect(isHookChainTrackerInitialized()).toBe(true);
    });
  });

  describe('startChain', () => {
    it('创建新链路', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      expect(chain.chainId).toBeDefined();
      expect(chain.status).toBe('running');
      expect(chain.triggerType).toBe('before_prompt');
      expect(chain.nodes).toEqual([]);
    });

    it('拒绝无效事件', () => {
      expect(() => tracker.startChain(null as unknown as HookEvent)).toThrow();
      expect(() => tracker.startChain({} as HookEvent)).toThrow();
    });

    it('拒绝无效 type', () => {
      expect(() => tracker.startChain({ ...makeEvent(), type: 'invalid' as HookEvent['type'] })).toThrow();
    });
  });

  describe('addNode', () => {
    it('添加节点', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      const node = tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test Hook',
        hookType: 'before_prompt',
      });
      expect(node.nodeId).toBeDefined();
      expect(node.status).toBe('running');
      expect(node.depth).toBe(0);
    });

    it('嵌套节点增加 depth', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      const parent = tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Parent',
        hookType: 'before_prompt',
      });
      const child = tracker.addNode(chain.chainId, {
        hookId: 'h2',
        hookName: 'Child',
        hookType: 'thinking',
        triggeredByNodeId: parent.nodeId,
      });
      expect(child.depth).toBe(1);
    });

    it('缺少必要字段抛错', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      expect(() => tracker.addNode(chain.chainId, { hookId: '', hookName: '', hookType: 'before_prompt' })).toThrow();
    });

    it('不存在的链路抛错', () => {
      expect(() => tracker.addNode('non-existent', { hookId: 'h1', hookName: 'h', hookType: 'before_prompt' })).toThrow();
    });
  });

  describe('updateNode', () => {
    it('更新状态为 success', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      const node = tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      tracker.updateNode(chain.chainId, node.nodeId, { status: 'success' });
      const updated = tracker.getChain(chain.chainId);
      const updatedNode = updated?.nodes.find((n) => n.nodeId === node.nodeId);
      expect(updatedNode?.status).toBe('success');
      expect(updatedNode?.duration).toBeGreaterThanOrEqual(0);
    });

    it('更新为 failed 保留 error', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      const node = tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      tracker.updateNode(chain.chainId, node.nodeId, {
        status: 'failed',
        error: 'Test error',
      });
      const updated = tracker.getChain(chain.chainId);
      const updatedNode = updated?.nodes.find((n) => n.nodeId === node.nodeId);
      expect(updatedNode?.error).toBe('Test error');
    });

    it('不存在的节点抛错', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      expect(() => tracker.updateNode(chain.chainId, 'non-existent', { status: 'success' })).toThrow();
    });
  });

  describe('finishChain', () => {
    it('完成链路', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      const node = tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      tracker.updateNode(chain.chainId, node.nodeId, { status: 'success' });
      tracker.finishChain(chain.chainId, 'success');
      const updated = tracker.getChain(chain.chainId);
      expect(updated?.status).toBe('success');
      expect(updated?.endTime).toBeDefined();
      expect(updated?.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('强制结束未完成节点', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      tracker.finishChain(chain.chainId, 'failed');
      const updated = tracker.getChain(chain.chainId);
      expect(updated?.nodes[0].status).toBe('failed');
    });

    it('拒绝无效状态', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      expect(() => tracker.finishChain(chain.chainId, 'invalid' as unknown as 'success')).toThrow();
    });
  });

  describe('triggerChildHook', () => {
    it('创建子链路', () => {
      const parentEvent = makeEvent('before_prompt');
      const parent = tracker.startChain(parentEvent);
      const childEvent = makeEvent('thinking');
      const child = tracker.triggerChildHook(parent.chainId, childEvent);
      expect(child.chainId).toBeDefined();
      expect(child.chainId).not.toBe(parent.chainId);
      const retrieved = tracker.getParentChain(child.chainId);
      expect(retrieved?.chainId).toBe(parent.chainId);
    });

    it('获取子链路列表', () => {
      const parent = tracker.startChain(makeEvent());
      const child1 = tracker.triggerChildHook(parent.chainId, makeEvent('thinking'));
      const child2 = tracker.triggerChildHook(parent.chainId, makeEvent('subagent_start'));
      const children = tracker.getChildChains(parent.chainId);
      expect(children.length).toBe(2);
      expect(children.map((c) => c.chainId).sort()).toEqual([child1.chainId, child2.chainId].sort());
    });
  });

  describe('getChains', () => {
    it('按状态过滤', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      tracker.finishChain(chain.chainId, 'success');
      const success = tracker.getChains({ status: 'success' });
      expect(success.every((c) => c.status === 'success')).toBe(true);
    });

    it('按触发类型过滤', () => {
      const event = makeEvent('thinking');
      tracker.startChain(event);
      const filtered = tracker.getChains({ triggerType: 'thinking' });
      expect(filtered.every((c) => c.triggerType === 'thinking')).toBe(true);
    });

    it('按时间过滤', () => {
      const before = Date.now();
      tracker.startChain(makeEvent());
      const after = Date.now();
      const filtered = tracker.getChains({ sinceMs: before, untilMs: after });
      expect(filtered.every((c) => c.startTime >= before && c.startTime <= after)).toBe(true);
    });

    it('限制数量', () => {
      for (let i = 0; i < 5; i++) {
        tracker.startChain(makeEvent());
      }
      const limited = tracker.getChains({ limit: 3 });
      expect(limited.length).toBe(3);
    });
  });

  describe('getStats', () => {
    it('返回统计', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      const node = tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      tracker.updateNode(chain.chainId, node.nodeId, { status: 'success' });
      tracker.finishChain(chain.chainId, 'success');
      const stats = tracker.getStats();
      expect(stats.totalChains).toBeGreaterThan(0);
      expect(stats.totalNodes).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('exportChain', () => {
    it('导出 JSON', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      const json = tracker.exportChain(chain.chainId, 'json');
      expect(json).toContain('chainId');
      expect(json).toContain('Test');
    });

    it('导出 Mermaid', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      const parent = tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Parent',
        hookType: 'before_prompt',
      });
      tracker.addNode(chain.chainId, {
        hookId: 'h2',
        hookName: 'Child',
        hookType: 'thinking',
        triggeredByNodeId: parent.nodeId,
      });
      const mermaid = tracker.exportChain(chain.chainId, 'mermaid');
      expect(mermaid).toContain('graph TD');
      expect(mermaid).toContain('Parent');
      expect(mermaid).toContain('Child');
    });

    it('导出 DOT', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      const dot = tracker.exportChain(chain.chainId, 'dot');
      expect(dot).toContain('digraph');
      expect(dot).toContain('Test');
    });

    it('不存在的链路抛错', () => {
      expect(() => tracker.exportChain('non-existent', 'json')).toThrow();
    });
  });

  describe('事件订阅', () => {
    it('订阅 chain-started', () => {
      const events: string[] = [];
      tracker.on('chain-started', () => events.push('started'));
      tracker.startChain(makeEvent());
      expect(events).toContain('started');
    });

    it('订阅 node-added', () => {
      const events: string[] = [];
      tracker.on('node-added', () => events.push('node-added'));
      const chain = tracker.startChain(makeEvent());
      tracker.addNode(chain.chainId, {
        hookId: 'h1',
        hookName: 'Test',
        hookType: 'before_prompt',
      });
      expect(events).toContain('node-added');
    });
  });

  describe('clear', () => {
    it('清空链路', () => {
      const event = makeEvent();
      tracker.startChain(event);
      const count = tracker.clear();
      expect(count).toBeGreaterThan(0);
      expect(tracker.getChains().length).toBe(0);
    });

    it('按状态清空', () => {
      const event = makeEvent();
      const chain = tracker.startChain(event);
      tracker.finishChain(chain.chainId, 'success');
      const count = tracker.clear({ status: 'success' });
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('getActiveChains', () => {
    it('返回活跃链路', () => {
      const event = makeEvent();
      tracker.startChain(event);
      const active = tracker.getActiveChains();
      expect(active.length).toBeGreaterThan(0);
      expect(active.every((c) => c.status === 'running')).toBe(true);
    });
  });
});
