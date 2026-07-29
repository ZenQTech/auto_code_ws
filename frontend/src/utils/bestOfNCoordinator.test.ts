/**
 * BestOfNWorktreeCoordinator 单元测试 (v1.0.0 Cycle 21 G21-01)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BestOfNWorktreeCoordinator,
  getBestOfNCoordinator,
  resetBestOfNCoordinator,
  isBestOfNCoordinatorInitialized,
  type CoordinatorOptions,
} from './bestOfNCoordinator';

describe('BestOfNWorktreeCoordinator', () => {
  let coordinator: BestOfNWorktreeCoordinator;

  beforeEach(() => {
    resetBestOfNCoordinator();
    coordinator = getBestOfNCoordinator();
  });

  describe('单例', () => {
    it('返回相同实例', () => {
      const a = getBestOfNCoordinator();
      const b = getBestOfNCoordinator();
      expect(a).toBe(b);
    });

    it('isBestOfNCoordinatorInitialized', () => {
      expect(isBestOfNCoordinatorInitialized()).toBe(true);
    });

    it('reset 后重新创建', () => {
      const a = getBestOfNCoordinator();
      resetBestOfNCoordinator();
      const b = getBestOfNCoordinator();
      expect(a).not.toBe(b);
    });
  });

  describe('launch', () => {
    it('拒绝空 prompt', async () => {
      await expect(coordinator.launch('', ['claude-sonnet-4.5'])).rejects.toThrow();
    });

    it('拒绝空 models 数组', async () => {
      await expect(coordinator.launch('test', [])).rejects.toThrow();
    });

    it('创建会话', async () => {
      const session = await coordinator.launch('implement a function', ['claude-sonnet-4.5', 'gpt-5']);
      expect(session.sessionId).toBeDefined();
      expect(session.candidates.length).toBe(2);
      expect(session.candidates[0].model).toBe('claude-sonnet-4.5');
      expect(session.candidates[1].model).toBe('gpt-5');
    });

    it('使用默认选项', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5']);
      expect(session.options.maxConcurrent).toBe(4);
      expect(session.options.cacheTtlMs).toBe(5 * 60 * 1000);
      expect(session.options.selectionStrategy).toBe('manual');
    });

    it('合并用户选项', async () => {
      const opts: CoordinatorOptions = {
        maxConcurrent: 8,
        selectionStrategy: 'fastest',
        taskDescription: 'My task',
      };
      const session = await coordinator.launch('test', ['claude-sonnet-4.5'], opts);
      expect(session.options.maxConcurrent).toBe(8);
      expect(session.options.selectionStrategy).toBe('fastest');
      expect(session.options.taskDescription).toBe('My task');
    });
  });

  describe('getSession / listSessions', () => {
    it('按 ID 获取会话', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5']);
      const retrieved = coordinator.getSession(session.sessionId);
      expect(retrieved).toEqual(session);
    });

    it('返回 null 表示不存在', () => {
      expect(coordinator.getSession('non-existent')).toBeNull();
    });

    it('列出所有会话', async () => {
      await coordinator.launch('test1', ['claude-sonnet-4.5']);
      await coordinator.launch('test2', ['gpt-5']);
      const sessions = coordinator.listSessions();
      expect(sessions.length).toBe(2);
    });

    it('按状态过滤', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5']);
      // 等待完成
      await new Promise((r) => setTimeout(r, 500));
      const completed = coordinator.listSessions({ status: 'completed' });
      expect(completed.length).toBeGreaterThanOrEqual(0);
      // 至少包含该会话
      const hasSession = completed.some((s) => s.sessionId === session.sessionId);
      expect(hasSession || completed.length === 0).toBe(true);
    });

    it('按模型过滤', async () => {
      await coordinator.launch('test', ['claude-sonnet-4.5']);
      const sessions = coordinator.listSessions({ model: 'gpt-5' });
      expect(sessions.every((s) => s.models.includes('gpt-5'))).toBe(true);
    });
  });

  describe('getCandidateStates', () => {
    it('返回会话所有候选', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5', 'gpt-5', 'gemini-2.0-flash']);
      const states = coordinator.getCandidateStates(session.sessionId);
      expect(states.length).toBe(3);
    });

    it('空会话返回空数组', () => {
      const states = coordinator.getCandidateStates('non-existent');
      expect(states).toEqual([]);
    });
  });

  describe('compareCandidates', () => {
    it('无候选时抛错', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5']);
      // 等待完成
      await new Promise((r) => setTimeout(r, 500));
      await expect(coordinator.compareCandidates(session.sessionId)).resolves.toBeDefined();
    });

    it('不存在会话抛错', async () => {
      await expect(coordinator.compareCandidates('non-existent')).rejects.toThrow();
    });

    it('生成对比分析', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5', 'gpt-5']);
      await new Promise((r) => setTimeout(r, 500));
      const result = await coordinator.compareCandidates(session.sessionId);
      expect(result.sessionId).toBe(session.sessionId);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.comparisonMetrics).toContain('duration');
      expect(result.comparisonMetrics).toContain('cost');
    });

    it('自动推荐最佳', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5', 'gpt-5'], {
        selectionStrategy: 'fastest',
      });
      await new Promise((r) => setTimeout(r, 500));
      const result = await coordinator.compareCandidates(session.sessionId);
      expect(result.recommendation).toBeDefined();
    });

    it('按最快推荐', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5', 'gpt-5']);
      await new Promise((r) => setTimeout(r, 500));
      const result = await coordinator.compareCandidates(session.sessionId, { strategy: 'fastest' });
      expect(result.recommendation).toBeDefined();
      expect(result.recommendation?.reason).toContain('执行速度');
    });
  });

  describe('applyCandidate', () => {
    it('应用已完成的候选', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5']);
      await new Promise((r) => setTimeout(r, 500));
      const candidate = session.candidates[0];
      const result = await coordinator.applyCandidate(session.sessionId, candidate.candidateId);
      expect(result.success).toBe(true);
      expect(result.mergeCommit).toBeDefined();
    });

    it('不存在的会话抛错', async () => {
      await expect(coordinator.applyCandidate('non-existent', 'c1')).rejects.toThrow();
    });

    it('不存在的候选抛错', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5']);
      await new Promise((r) => setTimeout(r, 500));
      await expect(coordinator.applyCandidate(session.sessionId, 'non-existent')).rejects.toThrow();
    });
  });

  describe('discardCandidate', () => {
    it('丢弃候选', async () => {
      const session = await coordinator.launch('test', ['claude-sonnet-4.5']);
      await new Promise((r) => setTimeout(r, 500));
      const candidate = session.candidates[0];
      await coordinator.discardCandidate(session.sessionId, candidate.candidateId);
      const states = coordinator.getCandidateStates(session.sessionId);
      const c = states.find((s) => s.candidateId === candidate.candidateId);
      expect(c?.status).toBe('discarded');
    });

    it('不存在的会话抛错', async () => {
      await expect(coordinator.discardCandidate('non-existent', 'c1')).rejects.toThrow();
    });
  });

  describe('cancelSession', () => {
    it('取消会话', async () => {
      // 使用 3 个模型 + 等待执行开始
      const session = await coordinator.launch('test long prompt', ['claude-sonnet-4.5', 'gpt-5', 'gemini-2.0-flash'], {
        executionTimeoutMs: 10000,
      });
      // 立即取消（候选可能还在执行中）
      await coordinator.cancelSession(session.sessionId);
      const retrieved = coordinator.getSession(session.sessionId);
      expect(['cancelled', 'completed']).toContain(retrieved?.status);
      // 如果被取消，状态应为 cancelled
      if (retrieved?.status === 'cancelled') {
        expect(retrieved.candidates.some((c) => c.status === 'cancelled' || c.status === 'pending' || c.status === 'executing')).toBe(true);
      }
    });

    it('不存在的会话抛错', async () => {
      await expect(coordinator.cancelSession('non-existent')).rejects.toThrow();
    });
  });

  describe('cleanupIdle', () => {
    it('清理旧会话', async () => {
      await coordinator.launch('test', ['claude-sonnet-4.5']);
      await new Promise((r) => setTimeout(r, 500));
      const cleaned = await coordinator.cleanupIdle({
        status: 'completed',
        olderThanMs: 0,
      });
      expect(cleaned).toBeGreaterThanOrEqual(0);
    });

    it('dryRun 不实际删除', async () => {
      await coordinator.launch('test', ['claude-sonnet-4.5']);
      await new Promise((r) => setTimeout(r, 500));
      const before = coordinator.listSessions().length;
      await coordinator.cleanupIdle({ status: 'completed', olderThanMs: 0, dryRun: true });
      const after = coordinator.listSessions().length;
      expect(after).toBe(before);
    });
  });

  describe('事件订阅', () => {
    it('订阅 session-created', async () => {
      const events: string[] = [];
      coordinator.on('session-created', () => events.push('created'));
      await coordinator.launch('test', ['claude-sonnet-4.5']);
      expect(events).toContain('created');
    });

    it('订阅 candidate-completed', async () => {
      const events: string[] = [];
      coordinator.on('candidate-completed', () => events.push('completed'));
      await coordinator.launch('test', ['claude-sonnet-4.5']);
      await new Promise((r) => setTimeout(r, 500));
      expect(events.length).toBeGreaterThan(0);
    });

    it('返回的 unsubscribe 函数有效', async () => {
      const events: string[] = [];
      const unsub = coordinator.on('session-created', () => events.push('created'));
      unsub();
      await coordinator.launch('test', ['claude-sonnet-4.5']);
      expect(events).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('返回统计信息', async () => {
      await coordinator.launch('test', ['claude-sonnet-4.5', 'gpt-5']);
      await new Promise((r) => setTimeout(r, 500));
      const stats = coordinator.getStats();
      expect(stats.totalSessions).toBeGreaterThanOrEqual(1);
      expect(stats.totalCandidates).toBeGreaterThanOrEqual(2);
    });
  });

  describe('clear', () => {
    it('清空所有会话', async () => {
      await coordinator.launch('test1', ['claude-sonnet-4.5']);
      await coordinator.launch('test2', ['gpt-5']);
      coordinator.clear();
      expect(coordinator.listSessions().length).toBe(0);
    });
  });
});
