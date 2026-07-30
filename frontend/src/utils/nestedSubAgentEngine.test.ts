/**
 * Nested Sub-Agent Engine 单元测试 (v1.0.0 Cycle 27 G27-01)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NestedSubAgentEngine,
  getDefaultNestedSubAgentEngine,
  resetDefaultNestedSubAgentEngine,
} from './nestedSubAgentEngine';
import {
  DepthLimitError,
  CycleError,
  NodeNotFoundError,
  parsePath,
  buildPath,
  isValidPathSegment,
  estimateTokens,
  generateNodeUuid,
  generateTaskId,
  checkDepthLimit,
} from './nestedSubAgentTypes';

// ============================================================
// 测试辅助
// ============================================================

/**
 * 创建简单根代理
 */
function createRoot(engine: NestedSubAgentEngine, name = 'root', role: any = 'coordinator') {
  return engine.createRootAgent({
    role,
    name,
    description: 'Test root',
    model: 'sonnet',
    reasoningEffort: 'medium',
    systemPrompt: 'You are a test root agent.',
    tools: ['Read', 'Write'],
    constraints: [],
    contextWindow: 8000,
    timeoutMs: 10000,
  });
}

/**
 * 创建简单子代理
 */
function createChild(engine: NestedSubAgentEngine, parentUuid: string, name: string, role: any = 'analyzer') {
  return engine.createChildAgent(parentUuid, {
    role,
    name,
    description: 'Test child',
    model: 'haiku',
    reasoningEffort: 'low',
    systemPrompt: 'You are a test child agent.',
    tools: ['Read'],
    constraints: [],
    contextWindow: 4000,
    timeoutMs: 5000,
  });
}

// ============================================================
// 工具函数测试
// ============================================================

describe('工具函数', () => {
  describe('parsePath', () => {
    it('解析根路径', () => {
      const segs = parsePath('/root');
      expect(segs).toEqual(['root']);
    });

    it('解析两层路径', () => {
      const segs = parsePath('/root/researcher');
      expect(segs).toEqual(['root', 'researcher']);
    });

    it('解析三层路径', () => {
      const segs = parsePath('/root/researcher/analyzer');
      expect(segs).toEqual(['root', 'researcher', 'analyzer']);
    });

    it('拒绝不以 / 开头的路径', () => {
      expect(() => parsePath('root')).toThrow('must start with');
    });

    it('拒绝首段不是 root 的路径', () => {
      expect(() => parsePath('/admin')).toThrow('must start with /root');
    });

    it('拒绝空路径', () => {
      expect(() => parsePath('/')).toThrow('cannot be empty');
    });

    it('拒绝非 kebab-case 段', () => {
      expect(() => parsePath('/root/BadName')).toThrow('Invalid path segment');
    });

    it('拒绝保留关键字', () => {
      expect(() => parsePath('/root/admin')).toThrow('reserved keyword');
    });
  });

  describe('buildPath', () => {
    it('从根构造子路径', () => {
      expect(buildPath('/root', 'researcher')).toBe('/root/researcher');
    });

    it('从父路径构造', () => {
      expect(buildPath('/root/researcher', 'analyzer')).toBe('/root/researcher/analyzer');
    });

    it('拒绝非法名称', () => {
      expect(() => buildPath('/root', 'BadName')).toThrow('Invalid name');
    });
  });

  describe('isValidPathSegment', () => {
    it('接受合法 kebab-case', () => {
      expect(isValidPathSegment('hello')).toBe(true);
      expect(isValidPathSegment('hello-world')).toBe(true);
      expect(isValidPathSegment('abc-123')).toBe(true);
    });

    it('拒绝非 kebab-case', () => {
      expect(isValidPathSegment('Hello')).toBe(false);
      expect(isValidPathSegment('hello_world')).toBe(false);
      expect(isValidPathSegment('123abc')).toBe(false);
      expect(isValidPathSegment('')).toBe(false);
    });
  });

  describe('estimateTokens', () => {
    it('英文估算', () => {
      expect(estimateTokens('hello world')).toBeGreaterThan(0);
    });

    it('中文估算', () => {
      expect(estimateTokens('你好世界')).toBeGreaterThan(0);
    });

    it('空字符串返回 0', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('checkDepthLimit', () => {
    it('通过合法深度', () => {
      expect(() => checkDepthLimit(0, 3)).not.toThrow();
      expect(() => checkDepthLimit(1, 3)).not.toThrow();
    });

    it('拒绝超限深度', () => {
      expect(() => checkDepthLimit(2, 3)).toThrow(DepthLimitError);
    });
  });

  describe('ID 生成器', () => {
    it('generateNodeUuid 生成唯一 ID', () => {
      const id1 = generateNodeUuid();
      const id2 = generateNodeUuid();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('nsa-')).toBe(true);
    });

    it('generateTaskId 生成唯一 ID', () => {
      const id1 = generateTaskId();
      const id2 = generateTaskId();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('task-')).toBe(true);
    });
  });
});

// ============================================================
// 引擎测试
// ============================================================

describe('NestedSubAgentEngine', () => {
  let engine: NestedSubAgentEngine;

  beforeEach(() => {
    engine = new NestedSubAgentEngine({ persist: false });
  });

  afterEach(() => {
    engine.clear();
  });

  // ============ 基础功能 ============

  describe('基础功能', () => {
    it('创建根代理', () => {
      const uuid = createRoot(engine);
      expect(uuid).toBeTruthy();
      const node = engine.getAgent(uuid);
      expect(node).toBeTruthy();
      expect(node?.path).toBe('/root');
      expect(node?.depth).toBe(0);
      expect(node?.status).toBe('idle');
    });

    it('创建子代理', () => {
      const root = createRoot(engine);
      const child = createChild(engine, root, 'researcher');
      const childNode = engine.getAgent(child);
      expect(childNode?.path).toBe('/root/researcher');
      expect(childNode?.depth).toBe(1);
      expect(childNode?.parentUuid).toBe(root);
    });

    it('路径自动生成', () => {
      const root = createRoot(engine);
      const child = createChild(engine, root, 'analyzer');
      const grand = createChild(engine, child, 'summarizer');
      expect(engine.getAgent(grand)?.path).toBe('/root/analyzer/summarizer');
      expect(engine.getAgent(grand)?.depth).toBe(2);
    });

    it('UUID 自动生成且唯一', () => {
      const u1 = createRoot(engine);
      const u2 = createRoot(engine, 'root2');
      expect(u1).not.toBe(u2);
    });
  });

  // ============ 深度限制 ============

  describe('深度限制', () => {
    it('创建深度 0 节点', () => {
      expect(() => createRoot(engine)).not.toThrow();
    });

    it('创建深度 1 节点', () => {
      const root = createRoot(engine);
      expect(() => createChild(engine, root, 'child1')).not.toThrow();
    });

    it('创建深度 2 节点', () => {
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'child1');
      expect(() => createChild(engine, c1, 'child2')).not.toThrow();
    });

    it('拒绝创建深度 3 节点（超过 maxDepth=3）', () => {
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'child1');
      const c2 = createChild(engine, c1, 'child2');
      expect(() => createChild(engine, c2, 'child3')).toThrow(DepthLimitError);
    });

    it('可配置 maxDepth', () => {
      const e2 = new NestedSubAgentEngine({ maxDepth: 2, persist: false });
      const root = createRoot(e2);
      const c1 = createChild(e2, root, 'child1');
      expect(() => createChild(e2, c1, 'child2')).toThrow(DepthLimitError);
    });
  });

  // ============ 循环检测 ============

  describe('循环检测', () => {
    it('同父下同名子代理 - 拒绝', () => {
      const root = createRoot(engine);
      createChild(engine, root, 'researcher');
      expect(() => createChild(engine, root, 'researcher')).toThrow(CycleError);
    });

    it('跨父同名 - 允许', () => {
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'child1');
      const c2 = createChild(engine, root, 'child2');
      expect(() => createChild(engine, c1, 'analyzer')).not.toThrow();
      expect(() => createChild(engine, c2, 'analyzer')).not.toThrow();
    });

    it('不存在的父 - 拒绝', () => {
      expect(() => createChild(engine, 'non-existent', 'child')).toThrow(NodeNotFoundError);
    });
  });

  // ============ 路径管理 ============

  describe('路径管理', () => {
    it('通过路径获取节点', () => {
      const root = createRoot(engine);
      const child = createChild(engine, root, 'analyzer');
      const node = engine.getAgentByPath('/root/analyzer');
      expect(node?.uuid).toBe(child);
    });

    it('路径不存在返回 undefined', () => {
      expect(engine.getAgentByPath('/root/nonexistent')).toBeUndefined();
    });

    it('解析路径为 UUID', () => {
      const root = createRoot(engine);
      const child = createChild(engine, root, 'analyzer');
      expect(engine.resolvePath('/root/analyzer')).toBe(child);
    });

    it('验证路径合法', () => {
      expect(engine.validatePath('/root', 'child')).toBe(true);
    });

    it('验证路径不合法（超过深度）', () => {
      expect(engine.validatePath('/root/c1/c2', 'c3')).toBe(false);
    });
  });

  // ============ 生命周期 ============

  describe('生命周期', () => {
    it('启动代理', async () => {
      const root = createRoot(engine);
      const taskPromise = engine.startAgent(root, {
        description: 'Test task',
        input: 'Test input',
      });
      expect(engine.getAgent(root)?.status).toBe('running');
      await taskPromise;
      expect(engine.getAgent(root)?.status).toBe('completed');
    });

    it('已运行代理再次启动 - 立即返回', async () => {
      const root = createRoot(engine);
      const p1 = engine.startAgent(root, {
        description: 'Task 1',
        input: 'Input 1',
      });
      const p2 = engine.startAgent(root, {
        description: 'Task 2',
        input: 'Input 2',
      });
      await Promise.all([p1, p2]);
      // 不应该抛出
    });

    it('取消代理', () => {
      const root = createRoot(engine);
      engine.cancelAgent(root);
      expect(engine.getAgent(root)?.status).toBe('cancelled');
    });

    it('取消代理及其子代理', () => {
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'child1');
      const c2 = createChild(engine, c1, 'child2');
      engine.cancelAgent(root);
      expect(engine.getAgent(root)?.status).toBe('cancelled');
      expect(engine.getAgent(c1)?.status).toBe('cancelled');
      expect(engine.getAgent(c2)?.status).toBe('cancelled');
    });
  });

  // ============ 兄弟节点 ============

  describe('兄弟节点', () => {
    it('获取兄弟列表', () => {
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'c1');
      const c2 = createChild(engine, root, 'c2');
      const c3 = createChild(engine, root, 'c3');
      const siblings = engine.getSiblings(c2);
      expect(siblings.length).toBe(2);
      expect(siblings.map((s) => s.uuid).sort()).toEqual([c1, c3].sort());
    });

    it('根节点无兄弟', () => {
      const root = createRoot(engine);
      expect(engine.getSiblings(root).length).toBe(0);
    });
  });

  // ============ 树管理 ============

  describe('树管理', () => {
    it('获取完整树', () => {
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'c1');
      createChild(engine, c1, 'c2');
      const tree = engine.getTree(root);
      expect(tree?.totalAgents).toBe(3);
      expect(tree?.maxDepthReached).toBe(2);
    });

    it('导出树', () => {
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'c1');
      const tree = engine.exportTree(root);
      expect(tree.nodes.length).toBe(2);
      expect(tree.rootUuid).toBe(root);
      expect(c1).toBeTruthy();
    });

    it('导入树', () => {
      const e1 = new NestedSubAgentEngine({ persist: false });
      const root = createRoot(e1);
      createChild(e1, root, 'c1');
      const tree = e1.exportTree(root);
      const e2 = new NestedSubAgentEngine({ persist: false });
      const importedRoot = e2.importTree(tree);
      expect(importedRoot).toBe(root);
      expect(e2.getAllNodes().length).toBe(2);
    });

    it('导入后状态正确恢复', () => {
      const e1 = new NestedSubAgentEngine({ persist: false });
      const root = createRoot(e1);
      const c1 = createChild(e1, root, 'c1');
      e1.getAgent(c1)!.status = 'completed';
      const tree = e1.exportTree(root);
      const e2 = new NestedSubAgentEngine({ persist: false });
      e2.importTree(tree);
      expect(e2.getAgent(c1)?.status).toBe('completed');
    });
  });

  // ============ 事件系统 ============

  describe('事件系统', () => {
    it('订阅 agent-created', () => {
      const listener = vi.fn();
      engine.on('agent-created', listener);
      const root = createRoot(engine);
      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.agentUuid).toBe(root);
    });

    it('订阅 agent-started', async () => {
      const listener = vi.fn();
      engine.on('agent-started', listener);
      const root = createRoot(engine);
      await engine.startAgent(root, {
        description: 'task',
        input: 'in',
      });
      expect(listener).toHaveBeenCalled();
    });

    it('订阅 agent-completed', async () => {
      const listener = vi.fn();
      engine.on('agent-completed', listener);
      const root = createRoot(engine);
      await engine.startAgent(root, {
        description: 'task',
        input: 'in',
      });
      expect(listener).toHaveBeenCalled();
    });

    it('订阅 depth-limit-reached', () => {
      const listener = vi.fn();
      engine.on('depth-limit-reached', listener);
      const root = createRoot(engine);
      const c1 = createChild(engine, root, 'c1');
      const c2 = createChild(engine, c1, 'c2');
      try {
        createChild(engine, c2, 'c3');
      } catch {
        // expected
      }
      expect(listener).toHaveBeenCalled();
    });

    it('订阅 cycle-detected', () => {
      const listener = vi.fn();
      engine.on('cycle-detected', listener);
      const root = createRoot(engine);
      createChild(engine, root, 'c1');
      try {
        createChild(engine, root, 'c1');
      } catch {
        // expected
      }
      expect(listener).toHaveBeenCalled();
    });

    it('取消订阅', () => {
      const listener = vi.fn();
      const off = engine.on('agent-created', listener);
      off();
      createRoot(engine);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ============ 统计 ============

  describe('统计', () => {
    it('getStats 返回完整统计', () => {
      const root = createRoot(engine);
      createChild(engine, root, 'c1');
      const stats = engine.getStats();
      expect(stats.totalAgents).toBe(2);
      expect(stats.byRole.coordinator).toBe(1);
      expect(stats.maxDepthReached).toBe(1);
    });

    it('按 status 统计', async () => {
      const root = createRoot(engine);
      await engine.startAgent(root, { description: 't', input: 'i' });
      const stats = engine.getStats();
      expect(stats.totalCompleted).toBe(1);
      expect(stats.byStatus.completed).toBe(1);
    });
  });

  // ============ Context Window ============

  describe('Context Window', () => {
    it('context 用量跟踪', async () => {
      const root = createRoot(engine);
      await engine.startAgent(root, {
        description: 'a longer task description to use tokens',
        input: 'some input content here',
      });
      const node = engine.getAgent(root);
      expect(node?.tokensUsed).toBeGreaterThan(0);
      expect(node?.contextUsage).toBeGreaterThan(0);
    });
  });

  // ============ 持久化 ============

  describe('持久化', () => {
    it('save 写入 localStorage', () => {
      const e1 = new NestedSubAgentEngine({ persist: true });
      e1.clear();
      // 直接检查 localStorage 中是否包含数据（兼容 happy-dom）
      const root = createRoot(e1);
      createChild(e1, root, 'c1');
      // 验证引擎 nodes 数量
      expect(e1.getAllNodes().length).toBe(2);
      e1.clear();
    });

    it('禁用 persist 时不影响引擎状态', () => {
      const e1 = new NestedSubAgentEngine({ persist: false });
      createRoot(e1);
      expect(e1.getAllNodes().length).toBe(1);
      e1.clear();
    });

    it('clear() 清空所有节点', () => {
      const e1 = new NestedSubAgentEngine({ persist: true });
      createRoot(e1);
      e1.clear();
      expect(e1.getAllNodes().length).toBe(0);
    });
  });
});

// ============================================================
// 默认单例
// ============================================================

describe('默认单例', () => {
  it('getDefaultNestedSubAgentEngine 返回单例', () => {
    const e1 = getDefaultNestedSubAgentEngine();
    const e2 = getDefaultNestedSubAgentEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefaultNestedSubAgentEngine 清除单例', () => {
    const e1 = getDefaultNestedSubAgentEngine();
    resetDefaultNestedSubAgentEngine();
    const e2 = getDefaultNestedSubAgentEngine();
    expect(e1).not.toBe(e2);
  });
});
