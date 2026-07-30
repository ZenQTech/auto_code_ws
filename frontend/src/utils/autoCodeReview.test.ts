/**
 * # AutoCodeReviewEngine 单元测试
 * Cycle 25 G25-01
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutoCodeReviewEngine,
  getDefaultReviewEngine,
  resetDefaultReviewEngine,
  TOTAL_BUILTIN_RULES,
} from './autoCodeReview';
import {
  decideVerdict,
  getHighestSeverity,
  sortFindingsBySeverity,
  findingKey,
  generateFindingId,
  generateReportId,
  SEVERITY_ORDER,
} from './autoCodeReviewTypes';
import { ALL_RULES, RULES_BY_CATEGORY } from './autoCodeReviewRules';
import type {
  ReviewFinding,
  ReviewReport,
} from './autoCodeReviewTypes';

describe('autoCodeReviewTypes utilities', () => {
  it('decideVerdict should return BLOCK when critical > 0', () => {
    expect(decideVerdict({ critical: 1, high: 0, medium: 0, low: 0, info: 0 })).toBe('BLOCK');
  });

  it('decideVerdict should return BLOCK when high >= 3', () => {
    expect(decideVerdict({ critical: 0, high: 3, medium: 0, low: 0, info: 0 })).toBe('BLOCK');
  });

  it('decideVerdict should return REQUEST_CHANGES when high > 0', () => {
    expect(decideVerdict({ critical: 0, high: 1, medium: 0, low: 0, info: 0 })).toBe('REQUEST_CHANGES');
  });

  it('decideVerdict should return REQUEST_CHANGES when medium >= 5', () => {
    expect(decideVerdict({ critical: 0, high: 0, medium: 5, low: 0, info: 0 })).toBe('REQUEST_CHANGES');
  });

  it('decideVerdict should return APPROVE for clean code', () => {
    expect(decideVerdict({ critical: 0, high: 0, medium: 2, low: 1, info: 0 })).toBe('APPROVE');
  });

  it('getHighestSeverity should return info for empty array', () => {
    expect(getHighestSeverity([])).toBe('info');
  });

  it('getHighestSeverity should return critical if present', () => {
    const f: ReviewFinding[] = [
      { id: '1', severity: 'low', category: 'bug', file: 'a.ts', title: 't', message: 'm', confidence: 0.5, timestamp: 0 },
      { id: '2', severity: 'critical', category: 'security', file: 'a.ts', title: 't', message: 'm', confidence: 0.5, timestamp: 0 },
    ];
    expect(getHighestSeverity(f)).toBe('critical');
  });

  it('sortFindingsBySeverity should sort by severity desc', () => {
    const f: ReviewFinding[] = [
      { id: '1', severity: 'low', category: 'bug', file: 'a.ts', title: 't', message: 'm', confidence: 0.5, timestamp: 0 },
      { id: '2', severity: 'critical', category: 'bug', file: 'a.ts', title: 't', message: 'm', confidence: 0.5, timestamp: 0 },
      { id: '3', severity: 'medium', category: 'bug', file: 'a.ts', title: 't', message: 'm', confidence: 0.5, timestamp: 0 },
    ];
    const sorted = sortFindingsBySeverity(f);
    expect(sorted[0].severity).toBe('critical');
    expect(sorted[2].severity).toBe('low');
  });

  it('findingKey should produce stable key', () => {
    const key1 = findingKey({ ruleId: 'X', file: 'a.ts', line: 10, title: 't' });
    const key2 = findingKey({ ruleId: 'X', file: 'a.ts', line: 10, title: 't' });
    expect(key1).toBe(key2);
  });

  it('generateFindingId should produce unique IDs', () => {
    const a = generateFindingId();
    const b = generateFindingId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^finding_/);
  });

  it('generateReportId should produce unique IDs', () => {
    const a = generateReportId();
    const b = generateReportId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^report_/);
  });

  it('SEVERITY_ORDER should have 5 levels with correct order', () => {
    expect(Object.keys(SEVERITY_ORDER)).toHaveLength(5);
    expect(SEVERITY_ORDER.critical).toBeGreaterThan(SEVERITY_ORDER.high);
    expect(SEVERITY_ORDER.high).toBeGreaterThan(SEVERITY_ORDER.medium);
    expect(SEVERITY_ORDER.medium).toBeGreaterThan(SEVERITY_ORDER.low);
    expect(SEVERITY_ORDER.low).toBeGreaterThan(SEVERITY_ORDER.info);
  });
});

describe('autoCodeReviewRules', () => {
  it('should have at least 100 built-in rules', () => {
    expect(TOTAL_BUILTIN_RULES).toBeGreaterThanOrEqual(100);
  });

  it('should have rules for all 6 categories', () => {
    expect(ALL_RULES.filter((r) => r.category === 'security').length).toBeGreaterThanOrEqual(15);
    expect(ALL_RULES.filter((r) => r.category === 'performance').length).toBeGreaterThanOrEqual(15);
    expect(ALL_RULES.filter((r) => r.category === 'maintainability').length).toBeGreaterThanOrEqual(15);
    expect(ALL_RULES.filter((r) => r.category === 'testing').length).toBeGreaterThanOrEqual(10);
    expect(ALL_RULES.filter((r) => r.category === 'bug').length).toBeGreaterThanOrEqual(15);
    expect(ALL_RULES.filter((r) => r.category === 'type-safety').length).toBeGreaterThanOrEqual(10);
  });

  it('every rule should have a unique id', () => {
    const ids = ALL_RULES.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every rule should have required fields', () => {
    for (const r of ALL_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.category).toBeTruthy();
      expect(r.severity).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(typeof r.check).toBe('function');
    }
  });

  it('RULES_BY_CATEGORY should be complete', () => {
    expect(RULES_BY_CATEGORY.security).toBeDefined();
    expect(RULES_BY_CATEGORY.performance).toBeDefined();
    expect(RULES_BY_CATEGORY.maintainability).toBeDefined();
    expect(RULES_BY_CATEGORY.testing).toBeDefined();
    expect(RULES_BY_CATEGORY.bug).toBeDefined();
    expect(RULES_BY_CATEGORY['type-safety']).toBeDefined();
  });
});

describe('AutoCodeReviewEngine - basic operations', () => {
  let engine: AutoCodeReviewEngine;

  beforeEach(() => {
    engine = new AutoCodeReviewEngine();
  });

  it('should initialize with all built-in rules', () => {
    expect(engine.getRules().length).toBe(TOTAL_BUILTIN_RULES);
  });

  it('should expose enabled rules', () => {
    const enabled = engine.getEnabledRules();
    expect(enabled.length).toBe(TOTAL_BUILTIN_RULES);
  });

  it('should register a custom rule', () => {
    const initialCount = engine.getRules().length;
    engine.registerRule({
      id: 'CUSTOM001',
      category: 'style',
      severity: 'low',
      description: 'Test rule',
      check: () => [
        {
          line: 1,
          title: 'test',
          message: 'test',
        },
      ],
    });
    expect(engine.getRules().length).toBe(initialCount + 1);
  });

  it('should unregister a rule', () => {
    const initialCount = engine.getRules().length;
    engine.unregisterRule('SEC001');
    expect(engine.getRules().length).toBe(initialCount - 1);
  });

  it('should enable/disable rules', () => {
    engine.disableRule('SEC001');
    expect(engine.getRule('SEC001')?.enabled).toBe(false);
    engine.enableRule('SEC001');
    expect(engine.getRule('SEC001')?.enabled).toBe(true);
  });

  it('should get rule by id', () => {
    const rule = engine.getRule('SEC001');
    expect(rule).toBeDefined();
    expect(rule?.id).toBe('SEC001');
  });

  it('should get rules by category', () => {
    const sec = engine.getRulesByCategory('security');
    expect(sec.length).toBeGreaterThan(0);
    for (const r of sec) {
      expect(r.category).toBe('security');
    }
  });
});

describe('AutoCodeReviewEngine - review flow', () => {
  it('should return empty report for clean code', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'export const x = 1;\n' },
      options: {
        enabledCategories: ['security'],
        includePatches: false,
      },
    });
    expect(report.fileCount).toBe(1);
    expect(report.findings.length).toBe(0);
    expect(report.verdict).toBe('APPROVE');
  });

  it('should detect eval() usage', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'eval("hello");\nconst x = 1;\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    expect(report.findings.some((f) => f.ruleId === 'SEC001')).toBe(true);
    expect(report.summary.critical).toBeGreaterThan(0);
    expect(report.verdict).toBe('BLOCK');
  });

  it('should detect hardcoded API key', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'const API_KEY = "sk-1234567890abcdefghij";\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    expect(report.findings.some((f) => f.ruleId === 'SEC003')).toBe(true);
  });

  it('should detect debugger statement', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'function f() { debugger; return 1; }\n' },
      options: { enabledCategories: ['maintainability'], includePatches: false },
    });
    expect(report.findings.some((f) => f.ruleId === 'MAINT009')).toBe(true);
  });

  it('should detect @ts-ignore', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': '// @ts-ignore\nconst x: any = 1;\n' },
      options: { enabledCategories: ['type-safety'], includePatches: false },
    });
    expect(report.findings.some((f) => f.ruleId === 'TYPE003')).toBe(true);
  });

  it('should detect empty catch block', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'try { f(); } catch (e) {}\n' },
      options: { enabledCategories: ['maintainability'], includePatches: false },
    });
    expect(report.findings.some((f) => f.ruleId === 'MAINT019')).toBe(true);
  });

  it('should respect enabledCategories option', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'eval("x");\ndebugger;\n' },
      options: { enabledCategories: ['maintainability'], includePatches: false },
    });
    // Should not detect eval because security category is disabled
    expect(report.findings.some((f) => f.ruleId === 'SEC001')).toBe(false);
    // Should detect debugger (maintainability)
    expect(report.findings.some((f) => f.ruleId === 'MAINT009')).toBe(true);
  });

  it('should respect maxFindings option', async () => {
    const engine = new AutoCodeReviewEngine();
    const code = 'debugger;\n'.repeat(20);
    const report = await engine.review({
      files: { 'a.ts': code },
      options: { enabledCategories: ['maintainability'], maxFindings: 3 },
    });
    expect(report.findings.length).toBeLessThanOrEqual(3);
  });

  it('should deduplicate findings with same key', async () => {
    const engine = new AutoCodeReviewEngine();
    const code = 'debugger;\ndebugger;\ndebugger;\n';
    const report = await engine.review({
      files: { 'a.ts': code },
      options: { enabledCategories: ['maintainability'], includePatches: false },
    });
    // Same line same rule should only appear once
    const ids = report.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('AutoCodeReviewEngine - severity policy', () => {
  it('should apply severity policy override', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'eval("x");\n' },
      options: {
        enabledCategories: ['security'],
        includePatches: false,
        severityPolicy: { security: 'low' },
      },
    });
    const sec001 = report.findings.find((f) => f.ruleId === 'SEC001');
    expect(sec001?.severity).toBe('low');
  });

  it('should apply engine-level severity policy', async () => {
    const engine = new AutoCodeReviewEngine();
    engine.setSeverityPolicy({ security: 'info' });
    const report = await engine.review({
      files: { 'a.ts': 'eval("x");\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    const sec001 = report.findings.find((f) => f.ruleId === 'SEC001');
    expect(sec001?.severity).toBe('info');
  });
});

describe('AutoCodeReviewEngine - report export', () => {
  it('should export JSON', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'eval("x");\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    const json = engine.exportJSON(report, true);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe(report.id);
    expect(parsed.findings.length).toBe(report.findings.length);
  });

  it('should export JSON compact', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'const x = 1;\n' },
    });
    const json = engine.exportJSON(report, false);
    expect(json).not.toContain('\n  ');
  });

  it('should export Markdown', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'eval("x");\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    const md = engine.exportMarkdown(report);
    expect(md).toContain('# Hermes Auto Code Review Report');
    expect(md).toContain('CRITICAL');
    expect(md).toContain('SEC001');
  });

  it('should export SARIF', async () => {
    const engine = new AutoCodeReviewEngine();
    const report = await engine.review({
      files: { 'a.ts': 'eval("x");\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    const sarif = engine.exportSARIF(report);
    const parsed = JSON.parse(sarif);
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs).toBeDefined();
    expect(parsed.runs[0].results.length).toBeGreaterThan(0);
  });
});

describe('AutoCodeReviewEngine - events', () => {
  it('should emit finding events', async () => {
    const engine = new AutoCodeReviewEngine();
    const findings: ReviewFinding[] = [];
    engine.on('finding', (f) => findings.push(f));
    await engine.review({
      files: { 'a.ts': 'eval("x");\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it('should emit complete event', async () => {
    const engine = new AutoCodeReviewEngine();
    let completeReport: ReviewReport | null = null;
    engine.on('complete', (r) => {
      completeReport = r;
    });
    await engine.review({
      files: { 'a.ts': 'const x = 1;\n' },
    });
    expect(completeReport).not.toBeNull();
  });

  it('should emit file-start and file-complete events', async () => {
    const engine = new AutoCodeReviewEngine();
    const starts: string[] = [];
    const completes: string[] = [];
    engine.on('file-start', (f) => starts.push(f));
    engine.on('file-complete', (f) => completes.push(f));
    await engine.review({
      files: { 'a.ts': 'const x = 1;\n', 'b.ts': 'const y = 2;\n' },
    });
    expect(starts).toEqual(['a.ts', 'b.ts']);
    expect(completes).toEqual(['a.ts', 'b.ts']);
  });

  it('should unsubscribe events with off', async () => {
    const engine = new AutoCodeReviewEngine();
    const findings: ReviewFinding[] = [];
    const listener = (f: ReviewFinding) => findings.push(f);
    engine.on('finding', listener);
    engine.off('finding', listener);
    await engine.review({
      files: { 'a.ts': 'eval("x");\n' },
      options: { enabledCategories: ['security'], includePatches: false },
    });
    expect(findings.length).toBe(0);
  });
});

describe('AutoCodeReviewEngine - state', () => {
  it('should track stats', async () => {
    const engine = new AutoCodeReviewEngine();
    await engine.review({ files: { 'a.ts': 'eval("x");\n' } });
    await engine.review({ files: { 'b.ts': 'debugger;\n' } });
    const stats = engine.getStats();
    expect(stats.reviews).toBe(2);
    expect(stats.findings).toBeGreaterThan(0);
    expect(stats.rules).toBe(TOTAL_BUILTIN_RULES);
  });

  it('should clear state', async () => {
    const engine = new AutoCodeReviewEngine();
    await engine.review({ files: { 'a.ts': 'eval("x");\n' } });
    engine.clear();
    const stats = engine.getStats();
    expect(stats.reviews).toBe(0);
  });
});

describe('AutoCodeReviewEngine - default singleton', () => {
  beforeEach(() => {
    resetDefaultReviewEngine();
  });

  it('should return same engine instance', () => {
    const e1 = getDefaultReviewEngine();
    const e2 = getDefaultReviewEngine();
    expect(e1).toBe(e2);
  });

  it('should reset on resetDefaultReviewEngine', () => {
    const e1 = getDefaultReviewEngine();
    resetDefaultReviewEngine();
    const e2 = getDefaultReviewEngine();
    expect(e1).not.toBe(e2);
  });
});

describe('AutoCodeReviewEngine - real-world review', () => {
  it('should produce meaningful review for complex file', async () => {
    const engine = new AutoCodeReviewEngine();
    const code = `
import { useState } from 'react';

const API_KEY = 'sk-1234567890abcdefghij';

function UserComponent({ userId }: { userId: string }) {
  const [count, setCount] = useState(0);
  // @ts-ignore
  const data: any = fetch(\`/api/users/\${userId}\`);

  useEffect(() => {
    const handler = () => {
      setCount(c => c + 1);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return eval('something');
}
`;

    const report = await engine.review({
      files: { 'src/UserComponent.tsx': code },
    });

    // Should detect multiple issues
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.summary.critical).toBeGreaterThanOrEqual(1); // hardcoded key + eval
    expect(report.verdict).toBe('BLOCK');
  });
});
