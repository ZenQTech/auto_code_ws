/**
 * Agent Checkpoint Engine 单元测试 (v1.0.0 Cycle 27 G27-02)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AgentCheckpointEngine,
  IAgentEngine,
  getDefaultAgentCheckpointEngine,
  resetDefaultAgentCheckpointEngine,
} from './agentCheckpointEngine';

class MockAgentEngine implements IAgentEngine {
  nodes: any[] = [];
  private uuidCounter = 0;

  exportTree(rootUuid?: string): any {
    return {
      version: '1.0.0',
      rootUuid: rootUuid || 'root',
      nodes: [...this.nodes],
      exportedAt: Date.now(),
    };
  }

  importTree(data: any): string {
    this.nodes = [...data.nodes];
    return data.rootUuid;
  }

  getAllNodes() {
    return this.nodes;
  }

  clear() {
    this.nodes = [];
  }

  addNode(name: string, role = 'test', tokensUsed = 100) {
    const uuid = 'node-' + (++this.uuidCounter);
    this.nodes.push({
      uuid,
      path: '/' + name,
      config: { name, role },
      depth: 0,
      status: 'completed',
      children: [],
      completedTasks: 1,
      failedTasks: 0,
      createdAt: Date.now(),
      tokensUsed,
      contextUsage: 0.1,
      metadata: {},
    });
    return uuid;
  }
}

describe('AgentCheckpointEngine', () => {
  let engine: AgentCheckpointEngine;
  let mockAgent: MockAgentEngine;

  beforeEach(() => {
    engine = new AgentCheckpointEngine();
    engine.clear();
    mockAgent = new MockAgentEngine();
  });

  afterEach(() => {
    engine.destroy();
    engine.clear();
  });

  describe('基本功能', () => {
    it('保存检查点', () => {
      const uuid = mockAgent.addNode('root');
      const cp = engine.saveCheckpoint(mockAgent, uuid, { name: 'test-cp' });
      expect(cp.id).toBeTruthy();
      expect(cp.name).toBe('test-cp');
      expect(cp.rootUuid).toBe(uuid);
    });

    it('保存时使用默认名称', () => {
      const uuid = mockAgent.addNode('root');
      const cp = engine.saveCheckpoint(mockAgent, uuid);
      expect(cp.name).toMatch(/^checkpoint-/);
    });

    it('保存时计算节点数', () => {
      mockAgent.addNode('a');
      mockAgent.addNode('b');
      mockAgent.addNode('c');
      const cp = engine.saveCheckpoint(mockAgent, 'root');
      expect(cp.nodeCount).toBe(3);
    });

    it('保存时计算 token 总数', () => {
      mockAgent.addNode('a', 'test', 100);
      mockAgent.addNode('b', 'test', 200);
      const cp = engine.saveCheckpoint(mockAgent, 'root');
      expect(cp.totalTokens).toBe(300);
    });

    it('保存时序列化树数据', () => {
      mockAgent.addNode('a');
      const cp = engine.saveCheckpoint(mockAgent, 'root');
      expect(cp.treeData).toBeTruthy();
      expect((cp.treeData as any).nodes.length).toBe(1);
    });
  });

  describe('恢复', () => {
    it('恢复检查点', () => {
      mockAgent.addNode('a');
      mockAgent.addNode('b');
      const cp = engine.saveCheckpoint(mockAgent, 'root');
      mockAgent.clear();
      expect(mockAgent.getAllNodes().length).toBe(0);
      const ok = engine.restoreCheckpoint(mockAgent, cp.id);
      expect(ok).toBe(true);
      expect(mockAgent.getAllNodes().length).toBe(2);
    });

    it('恢复不存在的检查点返回 false', () => {
      const ok = engine.restoreCheckpoint(mockAgent, 'non-existent');
      expect(ok).toBe(false);
    });
  });

  describe('列表与管理', () => {
    it('列出所有检查点', () => {
      mockAgent.addNode('a');
      engine.saveCheckpoint(mockAgent, 'root', { name: 'cp1' });
      engine.saveCheckpoint(mockAgent, 'root', { name: 'cp2' });
      const list = engine.listCheckpoints();
      expect(list.length).toBe(2);
    });

    it('按时间倒序', async () => {
      mockAgent.addNode('a');
      const cp1 = engine.saveCheckpoint(mockAgent, 'root', { name: 'cp1' });
      // 等待至少 1ms
      await new Promise((r) => setTimeout(r, 5));
      const cp2 = engine.saveCheckpoint(mockAgent, 'root', { name: 'cp2' });
      const list = engine.listCheckpoints();
      expect(list[0].id).toBe(cp2.id);
      expect(list[1].id).toBe(cp1.id);
    });

    it('获取指定检查点', () => {
      mockAgent.addNode('a');
      const cp = engine.saveCheckpoint(mockAgent, 'root', { name: 'test' });
      const found = engine.getCheckpoint(cp.id);
      expect(found?.id).toBe(cp.id);
    });

    it('删除检查点', () => {
      mockAgent.addNode('a');
      const cp = engine.saveCheckpoint(mockAgent, 'root', { name: 'test' });
      const ok = engine.deleteCheckpoint(cp.id);
      expect(ok).toBe(true);
      expect(engine.getCheckpoint(cp.id)).toBeUndefined();
    });

    it('重命名检查点', () => {
      mockAgent.addNode('a');
      const cp = engine.saveCheckpoint(mockAgent, 'root', { name: 'old' });
      const ok = engine.renameCheckpoint(cp.id, 'new');
      expect(ok).toBe(true);
      expect(engine.getCheckpoint(cp.id)?.name).toBe('new');
    });

    it('添加标签', () => {
      mockAgent.addNode('a');
      const cp = engine.saveCheckpoint(mockAgent, 'root');
      const ok = engine.addTag(cp.id, 'important');
      expect(ok).toBe(true);
      expect(engine.getCheckpoint(cp.id)?.tags).toContain('important');
    });
  });

  describe('限额管理', () => {
    it('超出 maxCheckpoints 时自动清理最旧', () => {
      const e2 = new AgentCheckpointEngine({ maxCheckpoints: 3 });
      mockAgent.addNode('a');
      for (let i = 0; i < 5; i++) {
        e2.saveCheckpoint(mockAgent, 'root', { name: `cp-${i}` });
      }
      expect(e2.listCheckpoints().length).toBe(3);
      e2.destroy();
    });
  });

  describe('清理过期', () => {
    it('清理过期检查点', () => {
      const e2 = new AgentCheckpointEngine({ cleanupDays: 30 });
      e2.clear();
      // 创建一个已过期的检查点
      const oldCp = e2.saveCheckpoint(mockAgent, 'root', { name: 'old' });
      e2.getCheckpoint(oldCp.id)!.createdAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
      // 创建新的
      mockAgent.addNode('new');
      e2.saveCheckpoint(mockAgent, 'root', { name: 'new' });
      // 清理
      const removed = e2.cleanupExpired();
      expect(removed).toBe(1);
      expect(e2.listCheckpoints().length).toBe(1);
      e2.destroy();
    });
  });

  describe('事件系统', () => {
    it('checkpoint-saved 事件', () => {
      const listener = vi.fn();
      engine.on('checkpoint-saved', listener);
      mockAgent.addNode('a');
      engine.saveCheckpoint(mockAgent, 'root');
      expect(listener).toHaveBeenCalled();
    });

    it('checkpoint-restored 事件', () => {
      const listener = vi.fn();
      engine.on('checkpoint-restored', listener);
      mockAgent.addNode('a');
      const cp = engine.saveCheckpoint(mockAgent, 'root');
      engine.restoreCheckpoint(mockAgent, cp.id);
      expect(listener).toHaveBeenCalled();
    });

    it('checkpoint-deleted 事件', () => {
      const listener = vi.fn();
      engine.on('checkpoint-deleted', listener);
      mockAgent.addNode('a');
      const cp = engine.saveCheckpoint(mockAgent, 'root');
      engine.deleteCheckpoint(cp.id);
      expect(listener).toHaveBeenCalled();
    });

    it('取消订阅', () => {
      const listener = vi.fn();
      const off = engine.on('checkpoint-saved', listener);
      off();
      mockAgent.addNode('a');
      engine.saveCheckpoint(mockAgent, 'root');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('统计', () => {
    it('空引擎统计', () => {
      const stats = engine.getStats();
      expect(stats.total).toBe(0);
    });

    it('非空统计', () => {
      mockAgent.addNode('a');
      mockAgent.addNode('b');
      engine.saveCheckpoint(mockAgent, 'root');
      engine.saveCheckpoint(mockAgent, 'root');
      const stats = engine.getStats();
      expect(stats.total).toBe(2);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
      expect(stats.newestAt).toBeTruthy();
    });
  });

  describe('清空', () => {
    it('clear 删除所有', () => {
      mockAgent.addNode('a');
      engine.saveCheckpoint(mockAgent, 'root');
      engine.saveCheckpoint(mockAgent, 'root');
      engine.clear();
      expect(engine.listCheckpoints().length).toBe(0);
    });
  });
});

describe('单例', () => {
  it('getDefaultAgentCheckpointEngine 返回单例', () => {
    const e1 = getDefaultAgentCheckpointEngine();
    const e2 = getDefaultAgentCheckpointEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefaultAgentCheckpointEngine 清除', () => {
    const e1 = getDefaultAgentCheckpointEngine();
    resetDefaultAgentCheckpointEngine();
    const e2 = getDefaultAgentCheckpointEngine();
    expect(e1).not.toBe(e2);
  });
});
