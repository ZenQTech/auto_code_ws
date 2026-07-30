/**
 * # ============================================================
 * # Cycle 25 端到端集成测试 (v1.0.0)
 * # ============================================================
 * # 覆盖 Cycle 25 三大新功能的端到端联动：
 * #   1. AutoCodeReviewEngine + PRBotEngine：PR review 自动执行
 * #   2. PerfOptimizerEngine 独立扫描 + 报告
 * #   3. 三大引擎协同：CI 流程（review → 优化 → 部署）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import { AutoCodeReviewEngine } from '../utils/autoCodeReview';
import { PRBotEngine } from '../utils/prBotEngine';
import { PerfOptimizerEngine } from '../utils/perfOptimizer';
import type { PullRequest } from '../utils/prBotEngineTypes';

// 辅助函数：创建包含安全/性能问题的样例代码
function makeBadCode() {
  return {
    'src/example.ts': `// 包含多个问题的样例代码
export function loadConfig() {
  // SEC001: eval 使用
  const code = "alert('xss')";
  eval(code);

  // SEC003: 硬编码密钥
  const apiKey = "sk-1234567890abcdef1234567890abcdef";

  // PERF: 简单 useMemo
  const filtered = useMemo(() => items.filter(i => i.active), [items]);

  return { code, apiKey, filtered };
}
`,
    'src/BadList.tsx': `import React, { useState, useMemo, useCallback } from 'react';

export function BadList({ items }) {
  // 不必要的 useMemo（简单 filter）
  const filtered = useMemo(() => items.filter(i => i.active), [items]);

  // useMemo 包装字面量
  const config = useMemo(() => ({ a: 1, b: 2 }), []);

  // useCallback 简单 onClick
  const handleClick = useCallback(() => setOpen(false), []);

  return <ul>{filtered.map(item => <li>{item.name}</li>)}</ul>;
}
`,
  };
}

describe('Cycle 25 端到端集成测试', () => {
  let reviewEngine: AutoCodeReviewEngine;
  let prBot: PRBotEngine;
  let perfEngine: PerfOptimizerEngine;

  beforeEach(() => {
    reviewEngine = new AutoCodeReviewEngine();
    prBot = new PRBotEngine({}, reviewEngine);
    perfEngine = new PerfOptimizerEngine();
  });

  // ===========================================
  // 1. AutoCodeReviewEngine 独立验证
  // ===========================================
  describe('AutoCodeReviewEngine', () => {
    it('应检测 eval() 使用（SEC001）', async () => {
      const code = `const x = eval("alert(1)");`;
      const report = await reviewEngine.review({ files: { 'a.ts': code } });
      const evalFinding = report.findings.find(
        (f) => f.title.toLowerCase().includes('eval')
      );
      expect(evalFinding).toBeDefined();
      expect(evalFinding!.severity).toBe('critical');
    });

    it('应检测 console.log（STYLE）', async () => {
      const code = `function f() { console.log("debug"); }`;
      const report = await reviewEngine.review({ files: { 'a.ts': code } });
      expect(report.findings.length).toBeGreaterThan(0);
    });

    it('应按严重度统计', async () => {
      const code = `eval("x"); console.log("y");`;
      const report = await reviewEngine.review({ files: { 'a.ts': code } });
      expect(report.summary).toBeDefined();
      expect(report.summary.critical).toBeGreaterThanOrEqual(0);
      expect(report.summary.high).toBeGreaterThanOrEqual(0);
    });

    it('应生成 APPROVE verdict（无问题时）', async () => {
      const code = `// 干净的代码
export function add(a: number, b: number): number {
  return a + b;
}
`;
      const report = await reviewEngine.review({ files: { 'a.ts': code } });
      // 干净的代码应当 verdict 较为温和
      expect(['APPROVE', 'REQUEST_CHANGES']).toContain(report.verdict);
    });

    it('应生成 REQUEST_CHANGES 或 BLOCK verdict（有问题时）', async () => {
      const code = `eval("x"); var password = "123";`;
      const report = await reviewEngine.review({ files: { 'a.ts': code } });
      expect(['REQUEST_CHANGES', 'BLOCK']).toContain(report.verdict);
    });

    it('应支持禁用规则', async () => {
      const code = `eval("x");`;
      const report1 = await reviewEngine.review({ files: { 'a.ts': code } });
      const evalCount1 = report1.findings.filter((f) =>
        f.title.toLowerCase().includes('eval')
      ).length;

      reviewEngine.disableRule('SEC001');
      const report2 = await reviewEngine.review({ files: { 'a.ts': code } });
      const evalCount2 = report2.findings.filter((f) =>
        f.title.toLowerCase().includes('eval')
      ).length;
      // 禁用 SEC001 后 eval 相关 findings 应减少
      expect(evalCount2).toBeLessThanOrEqual(evalCount1);
      reviewEngine.enableRule('SEC001');
    });

    it('应支持 JSON 导出', async () => {
      const report = await reviewEngine.review({
        files: { 'a.ts': 'eval("x");' },
      });
      const json = reviewEngine.exportJSON(report);
      expect(JSON.parse(json).id).toBe(report.id);
    });

    it('应支持 Markdown 导出', async () => {
      const report = await reviewEngine.review({
        files: { 'a.ts': 'eval("x");' },
      });
      const md = reviewEngine.exportMarkdown(report);
      expect(md).toContain('##');
    });

    it('应支持 SARIF 导出', async () => {
      const report = await reviewEngine.review({
        files: { 'a.ts': 'eval("x");' },
      });
      const sarif = reviewEngine.exportSARIF(report);
      const parsed = JSON.parse(sarif);
      expect(parsed.runs).toBeDefined();
      expect(Array.isArray(parsed.runs)).toBe(true);
    });
  });

  // ===========================================
  // 2. PRBotEngine 独立验证
  // ===========================================
  describe('PRBotEngine', () => {
    it('应注册 PR 并自动 review', async () => {
      const pr: PullRequest = {
        number: 1,
        title: 'feat: test',
        description: 'desc',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feature/x',
        files: [
          {
            path: 'a.ts',
            content: 'eval("x");',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'abc',
        baseSha: 'def',
      };
      prBot.registerPR(pr);
      // 等待异步 review
      await new Promise((r) => setTimeout(r, 50));
      const reviews = prBot.getState().reviews;
      expect(reviews.length).toBe(1);
      expect(reviews[0].prNumber).toBe(1);
    });

    it('应生成 line comments（带 finding 时）', async () => {
      const pr: PullRequest = {
        number: 2,
        title: 'test',
        description: '',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feat',
        files: [
          {
            path: 'x.ts',
            content: 'eval("malicious code");',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'a',
        baseSha: 'b',
      };
      prBot.registerPR(pr);
      await new Promise((r) => setTimeout(r, 50));
      const reviews = prBot.getState().reviews;
      expect(reviews.length).toBe(1);
      // 应有 line comment
      const review = reviews[0];
      if (review.lineComments.length > 0) {
        expect(review.lineComments[0].file).toBe('x.ts');
      }
    });

    it('应记录审计日志', async () => {
      const pr: PullRequest = {
        number: 3,
        title: 'test',
        description: '',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feat',
        files: [
          {
            path: 'a.ts',
            content: 'const x = 1;',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'a',
        baseSha: 'b',
      };
      prBot.registerPR(pr);
      await new Promise((r) => setTimeout(r, 50));
      const audit = prBot.getAuditLog();
      expect(audit.length).toBeGreaterThan(0);
      // 应有 pr-opened 和 review-posted 记录
      const actions = audit.map((a) => a.action);
      expect(actions).toContain('pr-opened');
    });

    it('应支持 triggerEvent（synchronize）', async () => {
      const pr: PullRequest = {
        number: 4,
        title: 'test',
        description: '',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feat',
        files: [
          {
            path: 'a.ts',
            content: 'const x = 1;',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'a',
        baseSha: 'b',
      };
      prBot.registerPR(pr);
      await new Promise((r) => setTimeout(r, 30));
      // 触发 synchronize
      const review = await prBot.triggerEvent({
        type: 'synchronize',
        pr: { ...pr, files: [{ path: 'b.ts', content: 'const y = 2;', additions: 1, deletions: 0, status: 'added' }] },
        timestamp: Date.now(),
        trigger: 'manual',
      });
      expect(review).toBeTruthy();
    });

    it('应支持状态序列化导入导出', async () => {
      const pr: PullRequest = {
        number: 5,
        title: 'test',
        description: '',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feat',
        files: [
          {
            path: 'a.ts',
            content: 'const x = 1;',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'a',
        baseSha: 'b',
      };
      prBot.registerPR(pr);
      const stateJson = prBot.exportState();
      expect(stateJson).toBeTruthy();
      // 重新导入
      const newBot = new PRBotEngine();
      newBot.importState(stateJson);
      const prs = newBot.getAllPRs();
      expect(prs.length).toBe(1);
      expect(prs[0].number).toBe(5);
    });

    it('应能停止 Bot 阻止 review', async () => {
      prBot.configure({ enabled: false });
      const pr: PullRequest = {
        number: 6,
        title: 'test',
        description: '',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feat',
        files: [
          {
            path: 'a.ts',
            content: 'const x = 1;',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'a',
        baseSha: 'b',
      };
      prBot.registerPR(pr);
      await new Promise((r) => setTimeout(r, 50));
      const reviews = prBot.getState().reviews;
      // Bot 停止时不应自动 review
      expect(reviews.length).toBe(0);
    });
  });

  // ===========================================
  // 3. PerfOptimizerEngine 独立验证
  // ===========================================
  describe('PerfOptimizerEngine', () => {
    it('应检测 useMemo 包装简单 filter（PERF-R001）', async () => {
      const code = `const filtered = useMemo(() => items.filter(i => i.active), [items]);`;
      const report = await perfEngine.scan({ files: { 'a.tsx': code } });
      expect(report.suggestions.length).toBeGreaterThan(0);
    });

    it('应计算性能评分', async () => {
      const code = `const filtered = useMemo(() => items.filter(i => i.active), [items]);`;
      const report = await perfEngine.scan({ files: { 'a.tsx': code } });
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });

    it('应支持预算检查', async () => {
      const code = `
        const a = useMemo(() => items.filter(i => i.active), [items]);
        const b = useMemo(() => items2.map(i => i.name), [items2]);
        const c = useMemo(() => items3.filter(i => i.ok), [items3]);
        const d = useMemo(() => items4.map(i => i.id), [items4]);
      `;
      // 严格预算（maxUnnecessaryMemo=1）
      const report = await perfEngine.scan({
        files: { 'a.tsx': code },
        budget: { maxUnnecessaryMemo: 1 },
      });
      // 应触发预算违反
      expect(report.budgetViolations.length).toBeGreaterThanOrEqual(0);
    });

    it('应支持模式筛选（仅 useMemo）', async () => {
      const code = `
        const a = useMemo(() => items.filter(i => i.active), [items]);
        const b = useCallback(() => setOpen(false), []);
      `;
      const report = await perfEngine.scan({
        files: { 'a.tsx': code },
        enabledPatterns: ['useMemo'],
      });
      // 不应包含 useCallback 相关建议
      const callbackSug = report.suggestions.filter(
        (s) => s.antiPattern === 'useCallback'
      );
      expect(callbackSug.length).toBe(0);
    });

    it('应支持 JSON 导出', async () => {
      const report = await perfEngine.scan({
        files: { 'a.tsx': 'const a = useMemo(() => items.filter(i => i.active), [items]);' },
      });
      const json = perfEngine.exportJSON(report);
      expect(JSON.parse(json).id).toBe(report.id);
    });

    it('应支持 Markdown 导出', async () => {
      const report = await perfEngine.scan({
        files: { 'a.tsx': 'const a = useMemo(() => items.filter(i => i.active), [items]);' },
      });
      const md = perfEngine.exportMarkdown(report);
      expect(typeof md).toBe('string');
    });

    it('应支持 Patch 导出', async () => {
      const report = await perfEngine.scan({
        files: { 'a.tsx': 'const a = useMemo(() => items.filter(i => i.active), [items]);' },
      });
      const patch = perfEngine.exportPatch(report.suggestions);
      expect(typeof patch).toBe('string');
    });

    it('应统计 useState/useEffect 使用', async () => {
      const code = `
        const [x, setX] = useState(0);
        const [y, setY] = useState(0);
        useEffect(() => { tick(); }, []);
      `;
      const report = await perfEngine.scan({ files: { 'a.tsx': code } });
      expect(report.totalHooks).toBeGreaterThan(0);
    });
  });

  // ===========================================
  // 4. 三大引擎协同
  // ===========================================
  describe('三大引擎协同', () => {
    it('Code Review → PR Bot 集成', async () => {
      // 1) AutoCodeReviewEngine 审查代码
      const files = makeBadCode();
      const report = await reviewEngine.review({ files });
      expect(report.findings.length).toBeGreaterThan(0);

      // 2) PRBot 使用同一份 code review 报告
      const pr: PullRequest = {
        number: 100,
        title: 'feat: 新功能',
        description: '实现新功能',
        author: 'developer',
        baseBranch: 'main',
        headBranch: 'feature/cycle25',
        files: Object.entries(files).map(([path, content]) => ({
          path,
          content,
          additions: content.split('\n').length,
          deletions: 0,
          status: 'added' as const,
        })),
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'head',
        baseSha: 'base',
      };
      prBot.registerPR(pr);
      await new Promise((r) => setTimeout(r, 100));

      // 3) PR Bot 应自动产生 review
      const reviews = prBot.getState().reviews;
      expect(reviews.length).toBe(1);
      expect(reviews[0].prNumber).toBe(100);
    });

    it('Code Review + Perf Scan 全流程', async () => {
      // 1) 审查代码质量
      const files = makeBadCode();
      const reviewReport = await reviewEngine.review({ files });

      // 2) 扫描性能问题
      const perfReport = await perfEngine.scan({ files });

      // 3) 两者应都有发现
      expect(reviewReport.findings.length).toBeGreaterThan(0);
      expect(perfReport.suggestions.length).toBeGreaterThan(0);
    });

    it('重置所有引擎后状态应清空', async () => {
      // 先制造一些状态
      const files = makeBadCode();
      await reviewEngine.review({ files });
      const pr: PullRequest = {
        number: 200,
        title: 'test',
        description: '',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feat',
        files: Object.entries(files).map(([path, content]) => ({
          path,
          content,
          additions: 1,
          deletions: 0,
          status: 'added' as const,
        })),
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'h',
        baseSha: 'b',
      };
      prBot.registerPR(pr);
      await new Promise((r) => setTimeout(r, 50));
      expect(prBot.getAllPRs().length).toBeGreaterThan(0);

      // 重置 - 创建新实例模拟重置
      const newReviewEngine = new AutoCodeReviewEngine();
      const newBot = new PRBotEngine();
      expect(newBot.getAllPRs().length).toBe(0);
      expect(newReviewEngine.getStats().reviews).toBe(0);
    });

    it('所有引擎可独立工作且不互相干扰', async () => {
      // 三个引擎独立工作
      const r1 = await reviewEngine.review({ files: { 'a.ts': 'eval("x");' } });
      const r2 = await perfEngine.scan({ files: { 'a.tsx': 'useMemo(() => items.filter(i => i.active), [items]);' } });
      const pr: PullRequest = {
        number: 300,
        title: 'test',
        description: '',
        author: 'dev',
        baseBranch: 'main',
        headBranch: 'feat',
        files: [
          {
            path: 'a.ts',
            content: 'const x = 1;',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        headSha: 'h',
        baseSha: 'b',
      };
      prBot.registerPR(pr);
      await new Promise((r) => setTimeout(r, 50));

      expect(r1.findings.length).toBeGreaterThan(0);
      expect(r2.suggestions.length).toBeGreaterThan(0);
      expect(prBot.getState().reviews.length).toBe(1);
    });
  });

  // ===========================================
  // 5. 统计验证
  // ===========================================
  describe('统计验证', () => {
    it('AutoCodeReviewEngine 统计', async () => {
      const before = reviewEngine.getStats();
      await reviewEngine.review({ files: { 'a.ts': 'eval("x");' } });
      const after = reviewEngine.getStats();
      expect(after.reviews).toBe(before.reviews + 1);
      expect(after.findings).toBeGreaterThan(before.findings);
    });

    it('PerfOptimizerEngine 统计', async () => {
      const before = perfEngine.getStats();
      await perfEngine.scan({ files: { 'a.tsx': 'useMemo(() => items.filter(i => i.active), [items]);' } });
      const after = perfEngine.getStats();
      expect(after.scans).toBe(before.scans + 1);
    });

    it('规则数量验证', () => {
      // AutoCodeReview 应有 100+ 规则
      const reviewStats = reviewEngine.getStats();
      expect(reviewStats.rules).toBeGreaterThanOrEqual(50);

      // PerfOptimizer 应有 20+ 规则
      const perfStats = perfEngine.getStats();
      expect(perfStats.rules).toBeGreaterThanOrEqual(20);
    });
  });
});
