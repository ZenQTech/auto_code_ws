# CYCLE 25 SPEC G25-03 - PerfOptimizerEngine AI 主动性能优化引擎

> **任务 ID**: G25-03
> **优先级**: P1
> **所属 Cycle**: Cycle 25
> **目标版本**: v6.64.0
> **撰写日期**: 2026-07-30
> **撰写人**: Loop Engineering Workflow
> **关联调研**: [CYCLE25_CODEX_TRAE_RESEARCH.md](./CYCLE25_CODEX_TRAE_RESEARCH.md) §2.3
> **依赖**: 无（独立引擎）

## 1. 背景与目标

### 1.1 背景

React 19 + React Compiler 已在 2026 年正式落地。统计数据：60-70% 的 `useMemo`/`useCallback` 调用是不必要或有害的。juejin 2026-07-20 文章列出 5 个已成为反模式的"性能优化"。

Hermes 平台当前 React 18.3 + 大量手写 `useMemo`/`useCallback`/`React.memo`。需要：
- 自动扫描不必要 memoization
- 提供声明式性能预算
- 生成重构建议
- 不依赖真实运行时（纯静态分析 + 启发式规则）

### 1.2 目标

实现一个**纯静态分析 + 启发式规则的 React 性能优化引擎**：

1. **AST 扫描**：识别所有 useMemo / useCallback / React.memo 的使用
2. **规则库**：≥ 20 条性能反模式规则
3. **重构建议**：自动生成去除不必要 memoization 的 diff
4. **性能预算**：声明式配置（"单组件重渲染 < 5ms"等阈值）
5. **报告输出**：JSON / Markdown 导出
6. **Bundle 分析**：估算代码体积，提示 tree-shaking / code splitting

### 1.3 范围

**包含**：
- 1 个核心引擎 `PerfOptimizerEngine`（`frontend/src/utils/perfOptimizer.ts`）
- 1 个 UI 面板 `PerfOptimizerPanel`（`frontend/src/components/PerfOptimizerPanel.tsx`）
- ≥ 45 个单元测试 + ≥ 15 个组件测试

**不包含**（Cycle 28+）：
- 真实运行时 Profiler 集成
- React 19 Compiler 升级
- 真实 bundle 体积测量

## 2. 核心数据模型

```typescript
// === Hook 使用模式 ===
export type HookPattern = 'useMemo' | 'useCallback' | 'useMemo-multiple' | 'useMemo-deps' | 'React.memo' | 'inline-arrow' | 'inline-object';

export interface HookUsage {
  /** 文件路径 */
  file: string;
  /** 行号 */
  line: number;
  /** Hook 名 */
  name: string;
  /** 模式 */
  pattern: HookPattern;
  /** 依赖项数组内容（字符串） */
  deps?: string[];
  /** 包裹的表达式（截断 100 字符） */
  wrapped: string;
  /** 是否必要（基于规则） */
  isNecessary: boolean;
  /** 理由 */
  reason: string;
  /** 置信度 */
  confidence: number;
  /** 建议 */
  suggestion: string;
  /** 重构后的代码 */
  refactored: string;
}

// === 重构建议 ===
export interface RefactorSuggestion {
  id: string;
  file: string;
  line: number;
  /** 反模式类型 */
  antiPattern: HookPattern;
  /** 原始代码（verbatim） */
  originalCode: string;
  /** 重构后代码 */
  refactoredCode: string;
  /** 严重度 */
  severity: 'high' | 'medium' | 'low';
  /** 原因描述 */
  reason: string;
  /** 估计的运行时影响（ms） */
  estimatedImpact: number;
  /** 估计的代码量减少（行） */
  estimatedLOCReduction: number;
}

// === 性能预算 ===
export interface PerfBudget {
  /** 单次 render 最大耗时（ms） */
  maxRenderMs: number;
  /** 单个组件最多订阅的 state 数 */
  maxStatePerComponent: number;
  /** 列表项 key 的稳定率（0-1） */
  minKeyStability: number;
  /** 组件最大行数 */
  maxComponentLines: number;
  /** 不必要 memo 数量上限 */
  maxUnnecessaryMemo: number;
  /** bundle 体积上限（KB） */
  maxBundleSize: number;
}

// === 性能报告 ===
export interface PerfReport {
  id: string;
  timestamp: number;
  duration: number;
  /** 扫描的文件数 */
  fileCount: number;
  /** 总 hook 使用数 */
  totalHooks: number;
  /** 不必要的 hook 使用数 */
  unnecessaryHooks: number;
  /** 重构建议列表 */
  suggestions: RefactorSuggestion[];
  /** 按 pattern 分组 */
  byPattern: Partial<Record<HookPattern, number>>;
  /** 预算违反情况 */
  budgetViolations: Array<{
    metric: keyof PerfBudget;
    actual: number;
    budget: number;
  }>;
  /** 总体评分（0-100） */
  score: number;
  /** Bundle 估算（KB） */
  estimatedBundleSize: number;
}

// === 扫描输入 ===
export interface ScanInput {
  files: Record<string, string>;
  budget?: PerfBudget;
  /** 包含的 pattern 列表 */
  enabledPatterns?: HookPattern[];
}

export const DEFAULT_BUDGET: PerfBudget = {
  maxRenderMs: 5,
  maxStatePerComponent: 5,
  minKeyStability: 0.8,
  maxComponentLines: 200,
  maxUnnecessaryMemo: 0,
  maxBundleSize: 1024,
};
```

## 3. 引擎 API

```typescript
export class PerfOptimizerEngine {
  constructor(config?: { defaultBudget?: PerfBudget });

  // === 扫描 ===
  scan(input: ScanInput): Promise<PerfReport>;
  scanFile(file: string, content: string): HookUsage[];
  scanDirectory(files: Record<string, string>): Promise<HookUsage[]>;

  // === 规则 ===
  registerRule(rule: PerfRule): void;
  enableRule(ruleId: string): void;
  disableRule(ruleId: string): void;
  getRules(): PerfRule[];

  // === 重构建议 ===
  generateRefactor(usage: HookUsage): RefactorSuggestion;
  generateRefactors(usages: HookUsage[]): RefactorSuggestion[];

  // === 预算管理 ===
  setBudget(budget: Partial<PerfBudget>): void;
  getBudget(): PerfBudget;
  checkBudget(report: PerfReport): Array<{ metric: keyof PerfBudget; actual: number; budget: number }>;

  // === 报告导出 ===
  exportJSON(report: PerfReport, pretty?: boolean): string;
  exportMarkdown(report: PerfReport): string;
  exportPatch(suggestions: RefactorSuggestion[]): string;

  // === 评分 ===
  calculateScore(report: PerfReport): number;

  // === 事件 ===
  on(event: 'usage-detected', listener: (usage: HookUsage) => void): void;
  on(event: 'scan-complete', listener: (report: PerfReport) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  off(event: string, listener: Function): void;

  // === 状态 ===
  getStats(): { scans: number; suggestions: number; rules: number };
  clear(): void;
}

export interface PerfRule {
  id: string;
  pattern: HookPattern;
  description: string;
  /** check 函数：返回 { isNecessary, reason, confidence, suggestion, refactored } */
  check: (usage: HookUsage, context: RuleContext) => RuleResult;
  enabled?: boolean;
}

export interface RuleResult {
  isNecessary: boolean;
  reason: string;
  confidence: number;
  suggestion: string;
  refactored: string;
}
```

## 4. 反模式规则库（≥ 20 条）

### 4.1 useMemo 反模式
- PERF-R001: useMemo 包裹简单计算（过滤 / 排序 < 100 项）
- PERF-R002: useMemo 依赖项中包含未使用的变量
- PERF-R003: 多个串联的 useMemo 应合并
- PERF-R004: useMemo 包装非 hook 依赖的常量
- PERF-R005: useMemo 包裹纯字面量（{ a: 1 }）

### 4.2 useCallback 反模式
- PERF-R010: useCallback 包裹传给非 memo 子组件的函数
- PERF-R011: useCallback 依赖项与函数体不一致
- PERF-R012: useCallback 包裹的函数没有作为 prop
- PERF-R013: useCallback 仅用于一个 onClick

### 4.3 React.memo 反模式
- PERF-R020: React.memo 包裹的组件 props 总在变
- PERF-R021: React.memo 包裹叶子组件（无子组件）
- PERF-R022: React.memo 包裹的组件 props 是对象字面量

### 4.4 通用规则
- PERF-R030: 列表渲染缺 key
- PERF-R031: 列表项 key 用 index
- PERF-R032: useState 初始值用函数（应使用 lazy init）
- PERF-R033: 大量 inline arrow function
- PERF-R034: 大量 inline object/array
- PERF-R035: 缺 useEffect 清理函数
- PERF-R036: useEffect 内 setState 未检查条件
- PERF-R037: 同步 setState 链
- PERF-R038: 大型组件未拆分
- PERF-R039: 未使用 lazy / Suspense 做代码分割
- PERF-R040: 未使用 React.lazy 加载大型依赖

## 5. 评分模型

```typescript
function calculateScore(report: PerfReport): number {
  let score = 100;

  // 不必要 hook 数量扣分
  score -= report.unnecessaryHooks * 2;

  // 预算违反扣分
  score -= report.budgetViolations.length * 5;

  // 严重建议扣分
  const highSeverity = report.suggestions.filter(s => s.severity === 'high').length;
  score -= highSeverity * 5;

  // Bundle 体积超出扣分
  if (report.estimatedBundleSize > 1024) {
    score -= Math.floor((report.estimatedBundleSize - 1024) / 100);
  }

  return Math.max(0, Math.min(100, score));
}
```

**评分等级**：
- 90-100: 🟢 优秀
- 75-89: 🟡 良好
- 60-74: 🟠 需改进
- 0-59: 🔴 差

## 6. UI 面板设计

### 6.1 PerfOptimizerPanel 核心功能
- **左栏**：预算配置（max render ms / max state / max lines 等）
- **中栏**：扫描结果（hook 使用列表 + 必要/不必要标识）
- **右栏**：重构建议（可一键复制 diff / 应用 patch）

### 6.2 交互流程
1. 用户配置性能预算
2. 选择文件 / 上传源码
3. 点击"开始扫描"按钮
4. 显示扫描进度
5. 完成后展示：
   - 总体评分（圆形进度条 + 等级）
   - 不必要 memo 列表
   - 重构建议
   - 预算违反情况
6. 导出报告 / 应用 patch

### 6.3 快捷键
- `Esc` — 关闭面板
- `?` — 显示快捷键帮助
- `Cmd/Ctrl + R` — 重新扫描
- `Cmd/Ctrl + E` — 导出 Markdown
- `Cmd/Ctrl + P` — 应用所有 patch（dry-run）
- `Cmd/Ctrl + F` — 聚焦搜索

## 7. 报告格式

```markdown
# Hermes Performance Optimization Report

**Generated**: 2026-07-30 12:00:00
**Files scanned**: 23
**Duration**: 0.8s
**Overall score**: 🟡 78/100

## Summary

- Total hooks detected: 145
- Unnecessary hooks: 28 (19.3%)
- Suggestions: 28 (🔴 5 / 🟠 12 / 🟡 11)

## By Pattern

| Pattern | Count | Unnecessary |
|---------|-------|-------------|
| useMemo | 45 | 12 |
| useCallback | 38 | 9 |
| React.memo | 22 | 5 |
| inline-arrow | 40 | 2 |

## Top Suggestions

### 1. [HIGH] src/components/List.tsx:18
**Pattern**: useMemo
**Reason**: Wraps a simple filter on a 5-item array

**Before**:
```tsx
const filtered = useMemo(() => items.filter(i => i.active), [items]);
```

**After**:
```tsx
const filtered = items.filter(i => i.active);
```

**Impact**: ~0.1ms render time saved, 2 lines removed

### 2. [HIGH] src/components/Form.tsx:42
**Pattern**: useCallback
**Reason**: Passed to non-memoized Button component

**Before**:
```tsx
const handleSubmit = useCallback(() => { ... }, []);
```

**After**:
```tsx
const handleSubmit = () => { ... };
```

**Impact**: ~0.05ms render time saved, 1 line removed

## Budget Violations

- ❌ `unnecessaryMemo`: actual=28, budget=0
- ✅ `maxRenderMs`: not measured (static analysis only)
- ✅ `maxStatePerComponent`: 4 ≤ 5

---
Generated by Hermes PerfOptimizer v1.0.0
```

## 8. 测试策略

### 8.1 单元测试（≥ 45 个）
- 引擎初始化（3 条）
- 文件扫描（5 条）
- Hook 识别（5 条）
- 规则触发 — useMemo 系列（5 条）
- 规则触发 — useCallback 系列（5 条）
- 规则触发 — React.memo 系列（3 条）
- 规则触发 — 通用规则（4 条）
- 重构代码生成（5 条）
- 评分计算（3 条）
- 预算检查（3 条）
- 报告导出 JSON/Markdown/Patch（3 条）

### 8.2 组件测试（≥ 15 个）
- 渲染与关闭（2 条）
- 预算配置（2 条）
- 文件选择（2 条）
- 扫描触发与进度（3 条）
- 结果展示（3 条）
- 报告导出（3 条）

## 9. 验收标准

- ✅ 规则库 ≥ 20 条规则
- ✅ 单元测试 ≥ 45 个，100% 通过
- ✅ 组件测试 ≥ 15 个，100% 通过
- ✅ TypeScript 0 错误
- ✅ 准确识别常见反模式（基于模式匹配）
- ✅ 生成可读的重构建议
- ✅ 报告导出 JSON + Markdown + Patch
- ✅ 与 React 18 兼容（不依赖 React 19）

## 10. 实施步骤

1. **Step 1**: 实现 `perfOptimizerTypes.ts`（所有类型）
2. **Step 2**: 实现 `perfOptimizerRules.ts`（≥ 20 规则）
3. **Step 3**: 实现 `perfOptimizer.ts`（核心引擎）
4. **Step 4**: 实现 `perfOptimizer.test.ts`（≥ 45 单元测试）
5. **Step 5**: 实现 `PerfOptimizerPanel.tsx`（UI 面板）
6. **Step 6**: 实现 `PerfOptimizerPanel.test.tsx`（≥ 15 组件测试）
7. **Step 7**: App.tsx 集成 + BrandHeader 菜单
8. **Step 8**: 跨模块集成测试

## 11. 风险与回退

- **风险 1**: AST 解析准确性 → 使用 regex + heuristic 模式匹配（不引入重依赖）
- **风险 2**: 重构后破坏代码语义 → refactored 字段附 + 强制需要用户确认
- **风险 3**: 误报率高 → 提供 confidence 字段 + dry-run 模式
