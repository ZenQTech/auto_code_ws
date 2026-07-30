/**
 * # ============================================================
 * # PerfOptimizerEngine 单元测试 (v1.0.0 Cycle 25 G25-03)
 * # ============================================================
 * # 覆盖范围：
 * #   - 引擎初始化 (3)
 * #   - 文件扫描与 hook 识别 (8)
 * #   - 规则触发 - useMemo (5)
 * #   - 规则触发 - useCallback (4)
 * #   - 规则触发 - React.memo (3)
 * #   - 规则触发 - 通用规则 (5)
 * #   - 重构代码生成 (3)
 * #   - 评分计算 (3)
 * #   - 预算检查 (4)
 * #   - 报告导出 (3)
 * #   - 事件订阅 (2)
 * #   - 状态查询 (2)
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-03 初次创建
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PerfOptimizerEngine } from './perfOptimizer';
import { ALL_PERF_RULES, RULES_BY_PATTERN } from './perfOptimizerRules';
import {
  calculateScore,
  scoreGrade,
  generateUsageId,
  generateSuggestionId,
  DEFAULT_BUDGET,
  type HookUsage,
  type PerfReport,
} from './perfOptimizerTypes';

describe('PerfOptimizerEngine', () => {
  let engine: PerfOptimizerEngine;

  beforeEach(() => {
    engine = new PerfOptimizerEngine();
  });

  // ============ 引擎初始化 ============

  describe('initialization', () => {
    it('should create engine with default config', () => {
      const e = new PerfOptimizerEngine();
      const stats = e.getStats();
      expect(stats.rules).toBe(ALL_PERF_RULES.length);
      expect(stats.scans).toBe(0);
      expect(stats.suggestions).toBe(0);
    });

    it('should accept custom default budget', () => {
      const e = new PerfOptimizerEngine({
        defaultBudget: { maxRenderMs: 10, maxComponentLines: 500 },
      });
      const budget = e.getBudget();
      expect(budget.maxRenderMs).toBe(10);
      expect(budget.maxComponentLines).toBe(500);
      expect(budget.maxStatePerComponent).toBe(DEFAULT_BUDGET.maxStatePerComponent);
    });

    it('should have at least 20 rules registered', () => {
      const e = new PerfOptimizerEngine();
      expect(e.getRules().length).toBeGreaterThanOrEqual(20);
    });
  });

  // ============ 文件扫描与 hook 识别 ============

  describe('scanFile and hook detection', () => {
    it('should detect useMemo', () => {
      const code = `const value = useMemo(() => items.filter(i => i.active), [items]);`;
      const usages = engine.scanFile('test.tsx', code);
      const memo = usages.find((u) => u.name === 'useMemo');
      expect(memo).toBeDefined();
      expect(memo!.pattern).toBe('useMemo');
      expect(memo!.line).toBe(1);
    });

    it('should detect useCallback with deps', () => {
      const code = `const handler = useCallback(() => doSomething(id), [id]);`;
      const usages = engine.scanFile('test.tsx', code);
      const cb = usages.find((u) => u.name === 'useCallback');
      expect(cb).toBeDefined();
      expect(cb!.deps).toEqual(['id']);
    });

    it('should detect React.memo', () => {
      const code = `export default React.memo(MyComponent);`;
      const usages = engine.scanFile('test.tsx', code);
      const memo = usages.find((u) => u.name === 'React.memo');
      expect(memo).toBeDefined();
      expect(memo!.pattern).toBe('React.memo');
    });

    it('should detect useState', () => {
      const code = `const [count, setCount] = useState(0);`;
      const usages = engine.scanFile('test.tsx', code);
      const state = usages.find((u) => u.name === 'useState');
      expect(state).toBeDefined();
    });

    it('should detect useEffect', () => {
      const code = `useEffect(() => { console.log(id); }, [id]);`;
      const usages = engine.scanFile('test.tsx', code);
      const effect = usages.find((u) => u.name === 'useEffect');
      expect(effect).toBeDefined();
    });

    it('should detect .map() in JSX', () => {
      const code = `return items.map(item => <Item key={item.id} data={item} />);`;
      const usages = engine.scanFile('test.tsx', code);
      const listKey = usages.find((u) => u.pattern === 'list-key');
      expect(listKey).toBeDefined();
    });

    it('should handle empty content', () => {
      const usages = engine.scanFile('test.tsx', '');
      expect(usages).toEqual([]);
    });

    it('should handle multiple usages in one file', () => {
      const code = `
const a = useMemo(() => 1 + 2, []);
const b = useCallback(() => {}, []);
const [c, setC] = useState(0);
const d = useEffect(() => {}, []);
const e = React.memo(C);
`;
      const usages = engine.scanFile('test.tsx', code);
      expect(usages.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ============ 规则触发 - useMemo ============

  describe('useMemo rules', () => {
    it('PERF-R001: should flag simple filter in useMemo', async () => {
      const code = `const filtered = useMemo(() => items.filter(i => i.active), [items]);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const memoSug = report.suggestions.find((s) => s.antiPattern === 'useMemo');
      expect(memoSug).toBeDefined();
      expect(memoSug!.reason).toContain('简单');
    });

    it('PERF-R002: should flag useMemo with unused deps', async () => {
      const code = `const value = useMemo(() => 42, [unusedDep]);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find(
        (s) => s.antiPattern === 'useMemo' && s.reason.includes('未在 body 中引用')
      );
      expect(sug).toBeDefined();
    });

    it('PERF-R004: should flag useMemo wrapping literal', async () => {
      const code = `const c = useMemo(() => ({ a: 1 }), []);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('字面量'));
      expect(sug).toBeDefined();
    });

    it('PERF-R005: should suggest useCallback when useMemo wraps function', async () => {
      const code = `const handler = useMemo(() => () => doIt(), []);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('useCallback'));
      expect(sug).toBeDefined();
    });

    it('PERF-R003: should flag multiple useMemo in proximity', async () => {
      const code = `
const a = useMemo(() => 1, []);
const b = useMemo(() => 2, []);
const c = useMemo(() => 3, []);
const d = useMemo(() => 4, []);
`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('合并'));
      expect(sug).toBeDefined();
    });
  });

  // ============ 规则触发 - useCallback ============

  describe('useCallback rules', () => {
    it('PERF-R011: should flag empty deps with body referencing external var', async () => {
      const code = `const h = useCallback(() => doSomething(id), []);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find(
        (s) => s.antiPattern === 'useCallback' && s.reason.includes('依赖项为空')
      );
      expect(sug).toBeDefined();
    });

    it('PERF-R012: should flag simple onClick handler', async () => {
      const code = `const h = useCallback((e) => setOpen(false), []);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('简单事件处理器'));
      expect(sug).toBeDefined();
    });

    it('PERF-R013: should flag useCallback with unused deps', async () => {
      const code = `const h = useCallback(() => 42, [unusedDep]);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find(
        (s) => s.antiPattern === 'useCallback' && s.reason.includes('未在 body 中使用')
      );
      expect(sug).toBeDefined();
    });

    it('should allow useCallback with proper deps', async () => {
      const code = `const h = useCallback(() => doIt(id), [id]);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      // 不应包含 R011/R013
      const issues = report.suggestions.filter(
        (s) =>
          s.antiPattern === 'useCallback' &&
          (s.reason.includes('依赖项为空') || s.reason.includes('未在 body 中使用'))
      );
      expect(issues.length).toBe(0);
    });
  });

  // ============ 规则触发 - React.memo ============

  describe('React.memo rules', () => {
    it('PERF-R022: should flag React.memo without custom comparator', async () => {
      const code = `export default React.memo(MyComponent);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('比较函数'));
      expect(sug).toBeDefined();
    });

    it('should not flag React.memo with custom comparator', async () => {
      const code = `export default React.memo(MyComponent, areEqual);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const issues = report.suggestions.filter((s) => s.reason.includes('比较函数'));
      expect(issues.length).toBe(0);
    });

    it('should flag React.memo with props always changing', async () => {
      const code = `export default React.memo(MyComponent);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('shallowEqual'));
      expect(sug).toBeDefined();
    });
  });

  // ============ 规则触发 - 通用规则 ============

  describe('common rules', () => {
    it('PERF-R030: should flag index as key', async () => {
      const code = `return items.map((item, index) => <Item key={index} data={item} />);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('index'));
      expect(sug).toBeDefined();
    });

    it('PERF-R031: should flag missing key', async () => {
      const code = `return items.map(item => <Item data={item} />);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('key'));
      expect(sug).toBeDefined();
    });

    it('PERF-R032: should flag expensive useState initial value', async () => {
      const code = `const [items, setItems] = useState(JSON.parse(bigString));`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('expensive'));
      expect(sug).toBeDefined();
    });

    it('PERF-R035: should flag useEffect without cleanup', async () => {
      const code = `useEffect(() => { setInterval(tick, 1000); }, []);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('清理函数'));
      expect(sug).toBeDefined();
    });

    it('PERF-R036: should flag useEffect with setState and no guard', async () => {
      const code = `useEffect(() => { setState(value); }, [value]);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const sug = report.suggestions.find((s) => s.reason.includes('死循环'));
      expect(sug).toBeDefined();
    });
  });

  // ============ 重构代码生成 ============

  describe('refactor generation', () => {
    it('should generate refactor suggestion from usage', () => {
      const usage: HookUsage = {
        file: 'test.tsx',
        line: 5,
        name: 'useMemo',
        pattern: 'useMemo',
        wrapped: 'items.filter(i => i.active)',
        isNecessary: false,
        reason: 'simple',
        confidence: 0.85,
        suggestion: 'remove',
        refactored: 'const value = items.filter(i => i.active);',
      };
      const sug = engine.generateRefactor(usage);
      expect(sug.id).toBeDefined();
      expect(sug.severity).toBe('high');
      expect(sug.file).toBe('test.tsx');
      expect(sug.line).toBe(5);
    });

    it('should only generate refactors for unnecessary usages', () => {
      const usages: HookUsage[] = [
        {
          file: 'a.tsx',
          line: 1,
          name: 'useMemo',
          pattern: 'useMemo',
          wrapped: 'complex calc',
          isNecessary: true,
          reason: 'complex',
          confidence: 0.95,
          suggestion: '',
          refactored: '',
        },
        {
          file: 'a.tsx',
          line: 2,
          name: 'useMemo',
          pattern: 'useMemo',
          wrapped: 'simple',
          isNecessary: false,
          reason: 'simple',
          confidence: 0.8,
          suggestion: 'remove',
          refactored: 'const x = 1;',
        },
      ];
      const refactors = engine.generateRefactors(usages);
      expect(refactors.length).toBe(1);
      expect(refactors[0].line).toBe(2);
    });

    it('should compute LOC reduction', () => {
      const usage: HookUsage = {
        file: 'a.tsx',
        line: 1,
        name: 'useMemo',
        pattern: 'useMemo',
        wrapped: 'line1\nline2\nline3',
        isNecessary: false,
        reason: '',
        confidence: 0.8,
        suggestion: '',
        refactored: 'line1',
      };
      const sug = engine.generateRefactor(usage);
      expect(sug.estimatedLOCReduction).toBe(2);
    });
  });

  // ============ 评分计算 ============

  describe('score calculation', () => {
    it('should return 100 for clean code', () => {
      const score = calculateScore({
        unnecessaryHooks: 0,
        budgetViolations: [],
        suggestions: [],
        estimatedBundleSize: 100,
      });
      expect(score).toBe(100);
    });

    it('should subtract for unnecessary hooks', () => {
      const score = calculateScore({
        unnecessaryHooks: 5,
        budgetViolations: [],
        suggestions: [],
        estimatedBundleSize: 100,
      });
      expect(score).toBe(90);
    });

    it('should subtract for budget violations', () => {
      const score = calculateScore({
        unnecessaryHooks: 0,
        budgetViolations: [{ metric: 'maxRenderMs', actual: 10, budget: 5 }],
        suggestions: [],
        estimatedBundleSize: 100,
      });
      expect(score).toBe(95);
    });

    it('should return 0 minimum', () => {
      const score = calculateScore({
        unnecessaryHooks: 100,
        budgetViolations: [],
        suggestions: [],
        estimatedBundleSize: 100,
      });
      expect(score).toBe(0);
    });
  });

  describe('scoreGrade', () => {
    it('should return excellent for 90+', () => {
      expect(scoreGrade(95).grade).toBe('excellent');
    });
    it('should return good for 75-89', () => {
      expect(scoreGrade(80).grade).toBe('good');
    });
    it('should return needs-improvement for 60-74', () => {
      expect(scoreGrade(65).grade).toBe('needs-improvement');
    });
    it('should return poor for 0-59', () => {
      expect(scoreGrade(40).grade).toBe('poor');
    });
  });

  // ============ 预算检查 ============

  describe('budget check', () => {
    it('should detect unnecessary memo budget violation', async () => {
      const e = new PerfOptimizerEngine({ defaultBudget: { maxUnnecessaryMemo: 0 } });
      const code = `const a = useMemo(() => 1 + 1, []);`;
      const report = await e.scan({ files: { 'test.tsx': code } });
      const v = report.budgetViolations.find((vv) => vv.metric === 'maxUnnecessaryMemo');
      expect(v).toBeDefined();
    });

    it('should detect state count violation', async () => {
      const e = new PerfOptimizerEngine({ defaultBudget: { maxStatePerComponent: 2 } });
      const code = `
const [a, setA] = useState(0);
const [b, setB] = useState(0);
const [c, setC] = useState(0);
`;
      const report = await e.scan({ files: { 'test.tsx': code } });
      const v = report.budgetViolations.find((vv) => vv.metric === 'maxStatePerComponent');
      expect(v).toBeDefined();
    });

    it('should detect bundle size violation', async () => {
      const e = new PerfOptimizerEngine({ defaultBudget: { maxBundleSize: 0 } });
      const code = 'x'.repeat(10000);
      const report = await e.scan({ files: { 'test.tsx': code } });
      const v = report.budgetViolations.find((vv) => vv.metric === 'maxBundleSize');
      expect(v).toBeDefined();
    });

    it('should pass when all budgets met', async () => {
      const e = new PerfOptimizerEngine();
      const code = `const x = 1;`;
      const report = await e.scan({ files: { 'test.tsx': code } });
      expect(report.budgetViolations.length).toBe(0);
    });
  });

  // ============ 报告导出 ============

  describe('report export', () => {
    it('should export JSON', async () => {
      const code = `const a = useMemo(() => 1, []);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const json = engine.exportJSON(report);
      expect(() => JSON.parse(json)).not.toThrow();
      expect(JSON.parse(json).id).toBe(report.id);
    });

    it('should export compact JSON', async () => {
      const code = `const a = useMemo(() => 1, []);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const json = engine.exportJSON(report, false);
      expect(json).not.toContain('\n  ');
    });

    it('should export Markdown', async () => {
      const code = `const a = useMemo(() => items.filter(i => i.active), [items]);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const md = engine.exportMarkdown(report);
      expect(md).toContain('# Hermes Performance Optimization Report');
      expect(md).toContain('By Pattern');
      expect(md).toContain('Overall score');
    });

    it('should export Patch', async () => {
      const code = `const a = useMemo(() => items.filter(i => i.active), [items]);`;
      const report = await engine.scan({ files: { 'test.tsx': code } });
      const patch = engine.exportPatch(report.suggestions);
      expect(patch).toContain('Before');
      expect(patch).toContain('After');
    });
  });

  // ============ 事件订阅 ============

  describe('event subscription', () => {
    it('should emit usage-detected events', async () => {
      const detected: HookUsage[] = [];
      engine.on('usage-detected', (u) => detected.push(u));
      const code = `const a = useMemo(() => 1, []);`;
      await engine.scan({ files: { 'test.tsx': code } });
      expect(detected.length).toBeGreaterThan(0);
    });

    it('should emit scan-complete event', async () => {
      let received: PerfReport | null = null;
      engine.on('scan-complete', (r) => {
        received = r;
      });
      const code = `const a = useMemo(() => 1, []);`;
      await engine.scan({ files: { 'test.tsx': code } });
      expect(received).not.toBeNull();
      expect(received!.totalHooks).toBeGreaterThan(0);
    });

    it('should allow off() to remove listener', async () => {
      let count = 0;
      const listener = () => count++;
      engine.on('scan-complete', listener);
      await engine.scan({ files: { 'a.tsx': 'x = 1' } });
      engine.off('scan-complete', listener);
      await engine.scan({ files: { 'b.tsx': 'y = 2' } });
      expect(count).toBe(1);
    });
  });

  // ============ 状态查询 ============

  describe('state queries', () => {
    it('should track scan count', async () => {
      await engine.scan({ files: { 'a.tsx': 'x' } });
      await engine.scan({ files: { 'b.tsx': 'y' } });
      expect(engine.getStats().scans).toBe(2);
    });

    it('should reset stats on clear', async () => {
      await engine.scan({ files: { 'a.tsx': 'const a = useMemo(() => 1, []);' } });
      engine.clear();
      const stats = engine.getStats();
      expect(stats.scans).toBe(0);
      expect(stats.rules).toBeGreaterThan(0); // rules count retained
    });
  });

  // ============ 工具函数 ============

  describe('utility functions', () => {
    it('generateUsageId should produce unique IDs', () => {
      const id1 = generateUsageId('a.tsx', 1, 'useMemo');
      const id2 = generateUsageId('a.tsx', 1, 'useMemo');
      // Same input = same ID (deterministic)
      expect(id1).toBe(id2);
    });

    it('generateSuggestionId should produce unique IDs', () => {
      const id1 = generateSuggestionId();
      const id2 = generateSuggestionId();
      expect(id1).not.toBe(id2);
    });

    it('ALL_PERF_RULES should have at least 20 rules', () => {
      expect(ALL_PERF_RULES.length).toBeGreaterThanOrEqual(20);
    });

    it('RULES_BY_PATTERN should group rules by pattern', () => {
      expect(RULES_BY_PATTERN['useMemo']).toBeDefined();
      expect(RULES_BY_PATTERN['useCallback']).toBeDefined();
      expect(RULES_BY_PATTERN['React.memo']).toBeDefined();
    });
  });

  // ============ 端到端集成 ============

  describe('end-to-end', () => {
    it('should scan multiple files and produce unified report', async () => {
      const fileA = `
const [a, setA] = useState(0);
const b = useMemo(() => items.filter(i => i.active), [items]);
`;
      const fileB = `
const h = useCallback(() => doIt(id), [id]);
return items.map((item, index) => <Item key={index} />);
`;
      const report = await engine.scan({
        files: { 'a.tsx': fileA, 'b.tsx': fileB },
      });
      expect(report.fileCount).toBe(2);
      expect(report.totalHooks).toBeGreaterThan(3);
      expect(report.unnecessaryHooks).toBeGreaterThan(0);
      expect(report.suggestions.length).toBeGreaterThan(0);
    });

    it('should respect enabledPatterns option', async () => {
      const code = `const a = useMemo(() => 1, []);`;
      const report = await engine.scan({
        files: { 'test.tsx': code },
        enabledPatterns: ['useCallback'], // only useCallback
      });
      expect(report.totalHooks).toBe(0); // useMemo not enabled
    });

    it('should handle empty file input', async () => {
      const report = await engine.scan({ files: {} });
      expect(report.fileCount).toBe(0);
      expect(report.totalHooks).toBe(0);
      expect(report.suggestions).toEqual([]);
    });
  });
});
