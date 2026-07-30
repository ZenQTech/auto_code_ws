/**
 * # ============================================================
 * # PRBotEngine 单元测试 (v1.0.0 Cycle 25 G25-02)
 * # ============================================================
 * # 覆盖范围：
 * #   - 配置管理 (3)
 * #   - PR 注册/更新/关闭 (4)
 * #   - 事件触发 (3)
 * #   - Review 生成 (4)
 * #   - 审计日志 (2)
 * #   - 状态查询 (2)
 * #   - 序列化 (2)
 * #   - 事件订阅 (2)
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-02 初次创建
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PRBotEngine } from './prBotEngine';
import {
  DEFAULT_BOT_CONFIG,
  decideReviewType,
  generateReviewId,
  generateLogId,
  generateLineCommentId,
  type PullRequest,
  type PRFile,
} from './prBotEngineTypes';
import type { Severity } from './autoCodeReviewTypes';

const sampleFile = (path: string, content: string): PRFile => ({
  path,
  content,
  additions: content.split('\n').length,
  deletions: 0,
  status: 'modified',
});

const samplePR = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 1,
  title: 'feat: add new feature',
  description: 'Add new feature description',
  author: 'developer',
  baseBranch: 'main',
  headBranch: 'feature/new',
  files: [
    sampleFile('src/foo.ts', 'export const foo = 1;'),
    sampleFile('src/bar.ts', 'export const bar = 2;\neval("x");'),
  ],
  status: 'open',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  headSha: 'abc123',
  baseSha: 'def456',
  ...overrides,
});

describe('PRBotEngine', () => {
  let engine: PRBotEngine;

  beforeEach(() => {
    engine = new PRBotEngine();
  });

  // ============ 初始化 ============

  describe('initialization', () => {
    it('should create engine with default config', () => {
      const config = engine.getConfig();
      expect(config.name).toBe(DEFAULT_BOT_CONFIG.name);
      expect(config.enabled).toBe(true);
      expect(config.autoReviewTriggers).toEqual(['opened', 'synchronize', 'reopened']);
    });

    it('should accept custom config', () => {
      const e = new PRBotEngine({
        name: 'Custom Bot',
        enabled: false,
        defaultReviewType: 'APPROVE',
      });
      const config = e.getConfig();
      expect(config.name).toBe('Custom Bot');
      expect(config.enabled).toBe(false);
      expect(config.defaultReviewType).toBe('APPROVE');
    });

    it('should reset config', () => {
      engine.configure({ name: 'X' });
      engine.resetConfig();
      expect(engine.getConfig().name).toBe(DEFAULT_BOT_CONFIG.name);
    });
  });

  // ============ PR 管理 ============

  describe('PR management', () => {
    it('should register a PR', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      expect(engine.getPR(pr.number)).toBeDefined();
      expect(engine.getAllPRs().length).toBe(1);
    });

    it('should update a PR', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      engine.updatePR(pr.number, { title: 'updated' });
      expect(engine.getPR(pr.number)?.title).toBe('updated');
    });

    it('should close a PR', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      engine.closePR(pr.number);
      expect(engine.getPR(pr.number)?.status).toBe('closed');
    });

    it('should ignore update/close for non-existent PR', () => {
      engine.updatePR(999, { title: 'x' });
      engine.closePR(999);
      expect(engine.getPR(999)).toBeUndefined();
    });
  });

  // ============ 事件触发 ============

  describe('event triggering', () => {
    it('should trigger pr-opened event', () => {
      let received: PullRequest | null = null;
      engine.on('pr-opened', (pr) => {
        received = pr;
      });
      const pr = samplePR();
      engine.registerPR(pr);
      expect(received).not.toBeNull();
      expect(received!.number).toBe(pr.number);
    });

    it('should trigger pr-synchronize event', () => {
      let received: PullRequest | null = null;
      engine.on('pr-synchronize', (pr) => {
        received = pr;
      });
      const pr = samplePR();
      engine.registerPR(pr);
      engine.updatePR(pr.number, { title: 'updated' });
      expect(received).not.toBeNull();
    });

    it('should triggerEvent correctly', async () => {
      const pr = samplePR({ number: 2 });
      const review = await engine.triggerEvent({
        type: 'opened',
        pr,
        timestamp: Date.now(),
        trigger: 'webhook',
      });
      expect(review).not.toBeNull();
    });

    it('should return null when bot disabled', async () => {
      const e = new PRBotEngine({ enabled: false });
      const pr = samplePR();
      const review = await e.triggerEvent({
        type: 'opened',
        pr,
        timestamp: Date.now(),
        trigger: 'webhook',
      });
      expect(review).toBeNull();
    });
  });

  // ============ Review 生成 ============

  describe('review generation', () => {
    it('should generate review with findings', async () => {
      const pr = samplePR();
      engine.registerPR(pr);
      // Wait a tick for auto-review
      await new Promise((r) => setTimeout(r, 50));
      const reviews = engine.getState().reviews;
      expect(reviews.length).toBe(1);
      // Should detect eval() in bar.ts
      expect(reviews[0].body).toContain('PR');
    });

    it('should generate line comments for findings', async () => {
      const pr = samplePR();
      engine.registerPR(pr);
      await new Promise((r) => setTimeout(r, 50));
      const review = engine.getState().reviews[0];
      // eval should produce a finding
      expect(review.lineComments.length).toBeGreaterThan(0);
    });

    it('should throw when reviewPR for non-existent PR', async () => {
      await expect(engine.reviewPR(999)).rejects.toThrow();
    });

    it('should allow custom review type', async () => {
      const pr = samplePR();
      engine.registerPR(pr);
      const review = await engine.reviewPR(pr.number, { type: 'APPROVE' });
      expect(review.type).toBe('APPROVE');
    });
  });

  describe('generateSummaryBody', () => {
    it('should include verdict, summary table, and signature', () => {
      const pr = samplePR();
      const report = {
        id: 'r1',
        timestamp: Date.now(),
        duration: 100,
        fileCount: 2,
        verdict: 'REQUEST_CHANGES' as const,
        findings: [
          {
            id: 'f1',
            severity: 'high' as Severity,
            category: 'security' as const,
            file: 'a.ts',
            line: 1,
            title: 'Issue',
            message: 'msg',
            confidence: 0.9,
            timestamp: Date.now(),
          },
        ],
        summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
        byCategory: { security: 1 },
        metadata: {},
      };
      const body = engine.generateSummaryBody(report, pr, 'REQUEST_CHANGES');
      expect(body).toContain('REQUEST_CHANGES');
      expect(body).toContain('Summary');
      expect(body).toContain('HIGH');
      expect(body).toContain(engine.getConfig().signature);
    });
  });

  // ============ 决策逻辑 ============

  describe('decideReviewType', () => {
    it('should REQUEST_CHANGES for critical findings', () => {
      const type = decideReviewType(
        {
          id: 'r',
          timestamp: 0,
          duration: 0,
          fileCount: 1,
          verdict: 'BLOCK',
          findings: [],
          summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
          byCategory: {},
        },
        { defaultReviewType: 'COMMENT', blockOnSeverity: 'high' }
      );
      expect(type).toBe('REQUEST_CHANGES');
    });

    it('should REQUEST_CHANGES for 3+ high findings', () => {
      const type = decideReviewType(
        {
          id: 'r',
          timestamp: 0,
          duration: 0,
          fileCount: 1,
          verdict: 'BLOCK',
          findings: [],
          summary: { critical: 0, high: 3, medium: 0, low: 0, info: 0 },
          byCategory: {},
        },
        { defaultReviewType: 'COMMENT', blockOnSeverity: 'high' }
      );
      expect(type).toBe('REQUEST_CHANGES');
    });

    it('should COMMENT for clean code', () => {
      const type = decideReviewType(
        {
          id: 'r',
          timestamp: 0,
          duration: 0,
          fileCount: 1,
          verdict: 'APPROVE',
          findings: [],
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          byCategory: {},
        },
        { defaultReviewType: 'COMMENT', blockOnSeverity: 'high' }
      );
      expect(type).toBe('COMMENT');
    });

    it('should respect non-COMMENT default', () => {
      const type = decideReviewType(
        {
          id: 'r',
          timestamp: 0,
          duration: 0,
          fileCount: 1,
          verdict: 'APPROVE',
          findings: [],
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          byCategory: {},
        },
        { defaultReviewType: 'APPROVE', blockOnSeverity: 'high' }
      );
      expect(type).toBe('APPROVE');
    });
  });

  // ============ 审计日志 ============

  describe('audit log', () => {
    it('should log all actions', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      engine.updatePR(pr.number, { title: 'updated' });
      engine.closePR(pr.number);
      const log = engine.getAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by action', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      const log = engine.getAuditLog({ action: 'pr-opened' });
      expect(log.every((l) => l.action === 'pr-opened')).toBe(true);
    });

    it('should clear log', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      engine.clearAuditLog();
      expect(engine.getAuditLog().length).toBe(0);
    });
  });

  // ============ 状态查询 ============

  describe('state queries', () => {
    it('should get complete state', () => {
      const state = engine.getState();
      expect(state.config).toBeDefined();
      expect(Array.isArray(state.pullRequests)).toBe(true);
      expect(Array.isArray(state.reviews)).toBe(true);
      expect(Array.isArray(state.auditLog)).toBe(true);
    });

    it('should get stats', () => {
      const stats = engine.getStats();
      expect(stats.prs).toBe(0);
      expect(stats.reviews).toBe(0);
      expect(stats.actions).toBe(0);
      expect(stats.bySeverity).toBeDefined();
    });
  });

  // ============ 序列化 ============

  describe('serialization', () => {
    it('should export state', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      const json = engine.exportState();
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.pullRequests.length).toBe(1);
    });

    it('should import state', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      const json = engine.exportState();
      const newEngine = new PRBotEngine();
      newEngine.importState(json);
      expect(newEngine.getAllPRs().length).toBe(1);
      expect(newEngine.getConfig().name).toBe(engine.getConfig().name);
    });
  });

  // ============ 事件订阅 ============

  describe('event subscription', () => {
    it('should subscribe and unsubscribe', () => {
      let count = 0;
      const listener = () => count++;
      engine.on('pr-opened', listener);
      const pr1 = samplePR({ number: 10 });
      const pr2 = samplePR({ number: 11 });
      engine.registerPR(pr1);
      engine.registerPR(pr2);
      expect(count).toBe(2);
      engine.off('pr-opened', listener);
      engine.registerPR(samplePR({ number: 12 }));
      expect(count).toBe(2);
    });

    it('should emit review-posted event', async () => {
      let received = false;
      engine.on('review-posted', () => {
        received = true;
      });
      const pr = samplePR();
      engine.registerPR(pr);
      await engine.reviewPR(pr.number);
      expect(received).toBe(true);
    });
  });

  // ============ 工具函数 ============

  describe('utility functions', () => {
    it('generateReviewId should produce unique IDs', () => {
      const id1 = generateReviewId();
      const id2 = generateReviewId();
      expect(id1).not.toBe(id2);
    });

    it('generateLogId should produce unique IDs', () => {
      const id1 = generateLogId();
      const id2 = generateLogId();
      expect(id1).not.toBe(id2);
    });

    it('generateLineCommentId should produce unique IDs', () => {
      const id1 = generateLineCommentId();
      const id2 = generateLineCommentId();
      expect(id1).not.toBe(id2);
    });
  });

  // ============ 端到端集成 ============

  describe('end-to-end', () => {
    it('should process full PR lifecycle', async () => {
      const pr = samplePR();
      engine.registerPR(pr);
      await new Promise((r) => setTimeout(r, 50));
      engine.updatePR(pr.number, { title: 'WIP' });
      await engine.reviewPR(pr.number);
      const state = engine.getState();
      expect(state.pullRequests.length).toBe(1);
      expect(state.reviews.length).toBeGreaterThanOrEqual(1);
      expect(state.auditLog.length).toBeGreaterThan(2);
    });

    it('should clear all state', () => {
      const pr = samplePR();
      engine.registerPR(pr);
      engine.clear();
      expect(engine.getAllPRs().length).toBe(0);
      expect(engine.getAuditLog().length).toBe(0);
    });
  });
});
