# CYCLE 25 SPEC G25-01 - AutoCodeReviewEngine 自动化代码评审引擎

> **任务 ID**: G25-01
> **优先级**: P0
> **所属 Cycle**: Cycle 25
> **目标版本**: v6.62.0
> **撰写日期**: 2026-07-30
> **撰写人**: Loop Engineering Workflow
> **关联调研**: [CYCLE25_CODEX_TRAE_RESEARCH.md](./CYCLE25_CODEX_TRAE_RESEARCH.md) §2.1 §2.4 §2.5 §2.6

## 1. 背景与目标

### 1.1 背景

Hermes 智能体调度平台目前已有 94 个 utils 引擎 + 164 个组件 + 2403 个测试，但完全缺乏结构化的代码评审能力。所有代码质量保障依赖 `pnpm test` + `tsc -b`，无任何自动 review、严重度分级、报告生成能力。

而 codex v0.105+ 已上线 `/review` 命令、`@codex review` PR 触发、`codex-action` GitHub Action 等成熟方案；TRAE SOLO 在 2 天内自动审查 38 个云函数 + 106 个问题（20 高危 / 48 中危 / 38 低危）。

### 1.2 目标

实现一个**纯前端可用、可扩展、自动化的代码评审引擎**，覆盖以下能力：

1. **规则库**：内置 100+ 评审规则（correctness / security / performance / maintainability / testing 五大类）
2. **严重度模型**：CRITICAL / HIGH / MEDIUM / LOW / INFO 五级（可配置）
3. **多输入支持**：本地 diff / staged changes / 单文件 / 文件列表
4. **报告格式**：JSON / Markdown 两种导出
5. **可集成性**：作为 PRBotEngine 的底层依赖，循环工程 workflow 中可独立调用

### 1.3 范围

**包含**：
- 1 个核心引擎 `AutoCodeReviewEngine`（`frontend/src/utils/autoCodeReview.ts`）
- 1 个 UI 面板 `CodeReviewPanel`（`frontend/src/components/CodeReviewPanel.tsx`）
- 1 套规则库（`frontend/src/utils/autoCodeReviewRules.ts`，≥ 100 条规则）
- ≥ 40 个单元测试 + ≥ 15 个组件测试

**不包含**（Cycle 26+）：
- 真实 LLM 调用（本 cycle 使用纯规则匹配 + 启发式分析）
- GitHub 集成（由 G25-02 PRBotEngine 负责）
- Webhook 推送

## 2. 核心数据模型

```typescript
// === 严重度模型 ===
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// === 问题分类 ===
export type ReviewCategory =
  | 'bug'            // 潜在 bug
  | 'security'       // 安全漏洞
  | 'performance'    // 性能问题
  | 'maintainability'// 可维护性
  | 'testing'        // 测试覆盖
  | 'style'          // 代码风格
  | 'accessibility'  // 可访问性
  | 'error-handling' // 错误处理
  | 'resource-leak'  // 资源泄漏
  | 'type-safety';   // 类型安全

// === 单条评审 finding ===
export interface ReviewFinding {
  /** 唯一 ID（auto-generated） */
  id: string;
  /** 严重度 */
  severity: Severity;
  /** 问题分类 */
  category: ReviewCategory;
  /** 文件路径（相对项目根） */
  file: string;
  /** 行号（1-based，可选） */
  line?: number;
  /** 简短标题 */
  title: string;
  /** 详细描述 */
  message: string;
  /** 触发的规则 ID */
  ruleId?: string;
  /** 原始代码（verbatim） */
  existingCode?: string;
  /** 建议修复代码 */
  suggestedPatch?: string;
  /** 为什么这个问题重要 */
  why?: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 创建时间 */
  timestamp: number;
}

// === Review 报告 ===
export interface ReviewReport {
  id: string;
  timestamp: number;
  /** 评审耗时（ms） */
  duration: number;
  /** 评审的文件数 */
  fileCount: number;
  /** 总体结论：APPROVE / REQUEST_CHANGES / BLOCK */
  verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'BLOCK';
  /** 所有 finding */
  findings: ReviewFinding[];
  /** 按严重度分组的统计 */
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  /** 按分类分组的统计 */
  byCategory: Partial<Record<ReviewCategory, number>>;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// === Review 输入 ===
export interface ReviewInput {
  /** 文件路径 → 文件内容 */
  files: Record<string, string>;
  /** 已有 diff 信息（可选） */
  diff?: string;
  /** 配置选项 */
  options?: ReviewOptions;
}

export interface ReviewOptions {
  /** 启用的类别（默认全开） */
  enabledCategories?: ReviewCategory[];
  /** 自定义严重度策略（覆盖默认） */
  severityPolicy?: Partial<Record<ReviewCategory, Severity>>;
  /** 最大 finding 数（防止爆炸） */
  maxFindings?: number;
  /** 是否包含建议 patch */
  includePatches?: boolean;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// === 评审规则 ===
export interface ReviewRule {
  /** 规则唯一 ID（如 SEC001, PERF012） */
  id: string;
  /** 规则分类 */
  category: ReviewCategory;
  /** 默认严重度 */
  severity: Severity;
  /** 规则描述 */
  description: string;
  /** 规则匹配的 check 函数 */
  check: (file: string, content: string, context: RuleContext) => RawFinding[];
  /** 是否默认启用 */
  enabled?: boolean;
}

export interface RuleContext {
  /** 项目根路径（用于规则做相对路径计算） */
  rootDir: string;
  /** 已有 finding（用于规则去重） */
  existingFindings: ReviewFinding[];
  /** 是否包含 patches */
  includePatches: boolean;
}

export interface RawFinding {
  line?: number;
  title: string;
  message: string;
  existingCode?: string;
  suggestedPatch?: string;
  why?: string;
  confidence?: number;
}
```

## 3. 引擎 API

```typescript
export class AutoCodeReviewEngine {
  constructor(config?: { rootDir?: string; defaultOptions?: ReviewOptions });

  // === 注册/管理规则 ===
  registerRule(rule: ReviewRule): void;
  unregisterRule(ruleId: string): void;
  enableRule(ruleId: string): void;
  disableRule(ruleId: string): void;
  getRule(ruleId: string): ReviewRule | undefined;
  getRules(): ReviewRule[];
  getRulesByCategory(category: ReviewCategory): ReviewRule[];

  // === 执行 review ===
  review(input: ReviewInput): Promise<ReviewReport>;

  // === 报告导出 ===
  exportJSON(report: ReviewReport, pretty?: boolean): string;
  exportMarkdown(report: ReviewReport): string;
  exportSARIF(report: ReviewReport): string;

  // === 配置 ===
  setSeverityPolicy(policy: Partial<Record<ReviewCategory, Severity>>): void;
  getSeverityPolicy(): Partial<Record<ReviewCategory, Severity>>;

  // === 事件 ===
  on(event: 'finding', listener: (finding: ReviewFinding) => void): void;
  on(event: 'complete', listener: (report: ReviewReport) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  off(event: string, listener: Function): void;

  // === 状态查询 ===
  getStats(): { reviews: number; findings: number; rules: number };
  clear(): void;
}
```

## 4. 严重度决策模型

```typescript
function getVerdict(summary: ReviewReport['summary']): 'APPROVE' | 'REQUEST_CHANGES' | 'BLOCK' {
  if (summary.critical > 0) return 'BLOCK';
  if (summary.high >= 3) return 'BLOCK';
  if (summary.high > 0) return 'REQUEST_CHANGES';
  if (summary.medium >= 5) return 'REQUEST_CHANGES';
  return 'APPROVE';
}
```

**严重度颜色映射（UI 渲染用）**：

| 严重度 | 图标 | 颜色 | 行为 |
|--------|------|------|------|
| CRITICAL | 🔴 | `#dc2626` | 阻止合并 |
| HIGH | 🟠 | `#ea580c` | 合并前必修 |
| MEDIUM | 🟡 | `#ca8a04` | 尽快修 |
| LOW | 🟢 | `#16a34a` | 可选 |
| INFO | 💡 | `#0284c7` | 无需修 |

## 5. 规则库（≥ 100 条规则）

### 5.1 Security（≥ 20 条）
- SEC001: eval() / new Function() 使用
- SEC002: dangerouslySetInnerHTML 使用
- SEC003: 硬编码 API key / password / token
- SEC004: HTTP 链接（应使用 HTTPS）
- SEC005: console.log 打印敏感数据
- SEC006: 缺失 input 验证
- SEC007: 路径拼接构造路径（path traversal）
- SEC008: innerHTML 写入用户输入（XSS）
- SEC009: 不安全的随机数 Math.random() 用于安全场景
- SEC010: 弱加密算法 MD5/SHA1
- SEC011: 缺失 CORS 配置
- SEC012: JWT 缺少过期时间
- SEC013: 信任 client 传来的 user id（无鉴权）
- SEC014: SQL 字符串拼接（SQL 注入）
- SEC015: localStorage 存储敏感信息
- SEC016: 暴露的 .env 文件
- SEC017: missing CSRF protection
- SEC018: 文件上传无 MIME 校验
- SEC019: 不安全的正则（ReDoS）
- SEC020: 第三方依赖未锁版本（^ 范围）

### 5.2 Performance（≥ 20 条）
- PERF001: 列表渲染缺 key prop
- PERF002: N+1 模式（循环内 fetch）
- PERF003: 不必要的 useMemo（依赖项未变化）
- PERF004: 不必要的 useCallback
- PERF005: 不必要的 React.memo
- PERF006: 大对象直接作为依赖
- PERF007: 同步阻塞 I/O
- PERF008: 缺少 debounce/throttle
- PERF009: 大列表未做虚拟化
- PERF010: 不必要的 re-render（缺少 memo）
- PERF011: 数组 spread 在 render 中
- PERF012: 每次 render 创建新函数
- PERF013: 每次 render 创建新对象字面量
- PERF014: 大型依赖未懒加载
- PERF015: 大量 reflow（强制同步布局）
- PERF016: 缺失图片懒加载
- PERF017: 大 bundle 无 code splitting
- PERF018: 多次 setState 调用
- PERF019: 同步 setState 链
- PERF020: useEffect 内 setState 未检查条件

### 5.3 Maintainability（≥ 20 条）
- MAINT001: 函数超过 50 行
- MAINT002: 嵌套深度超过 4 层
- MAINT003: 文件超过 500 行
- MAINT004: 圈复杂度超过 10
- MAINT005: 重复代码块（> 5 行）
- MAINT006: 魔数（magic number）未命名
- MAINT007: 注释掉的代码块
- MAINT008: console.log 残留
- MAINT009: debugger 残留
- MAINT010: TODO 标记未关联 issue
- MAINT011: 命名不清晰（单字母变量名，循环 i/j 除外）
- MAINT012: 函数参数超过 5 个
- MAINT013: 重复的 type definition
- MAINT014: dead code（导出但未使用）
- MAINT015: hardcoded color 值
- MAINT016: hardcoded URL
- MAINT017: hardcoded date/time
- MAINT018: missing default case in switch
- MAINT019: 缺少空 catch 处理
- MAINT020: 重命名后未更新所有引用

### 5.4 Testing（≥ 15 条）
- TEST001: 公共函数缺少单元测试
- TEST002: 异步函数缺少测试
- TEST003: 错误处理路径未测试
- TEST004: 边界条件未测试
- TEST005: 改动文件对应测试文件未更新
- TEST006: 测试断言过于宽松
- TEST007: 测试包含真实网络请求
- TEST008: 测试间共享可变状态
- TEST009: 测试依赖执行顺序
- TEST010: 测试覆盖率为 0 的新文件
- TEST011: mock 数据未清理
- TEST012: 测试中的 sleep
- TEST013: 缺少 critical path 测试
- TEST014: 缺少 happy path 测试
- TEST015: snapshot test 未更新

### 5.5 Bug（≥ 20 条）
- BUG001: 可空变量未做空检查
- BUG002: 数组访问未做 length 检查
- BUG003: 异步函数未 await
- BUG004: Promise 未处理 rejection
- BUG005: 事件监听器未清理
- BUG006: 定时器未清理
- BUG007: 资源未释放（stream / connection）
- BUG008: 闭包捕获过期变量
- BUG009: setState 在已卸载组件
- BUG010: 条件分支永远为 true/false
- BUG011: 死循环（无 break）
- BUG012: 浮点数比较使用 ===
- BUG013: 整数溢出
- BUG014: 字符串转 number 缺少校验
- BUG015: Date 时区问题
- BUG016: 深拷贝与浅拷贝混淆
- BUG017: 重复的 useState 调用
- BUG018: key 重复
- BUG019: 错误使用 Array.from
- BUG020: JSON.parse 缺少 try/catch

### 5.6 Type Safety（≥ 10 条）
- TYPE001: any 类型
- TYPE002: as 强制类型转换
- TYPE003: @ts-ignore 注释
- TYPE004: @ts-expect-error 注释
- TYPE005: function 不带返回类型
- TYPE006: 变量不显式标注类型（inferred any）
- TYPE007: null vs undefined 混用
- TYPE008: 强制非空断言 !.
- TYPE009: unsafe 类型断言
- TYPE010: 缺少数组元素类型

## 6. UI 面板设计

### 6.1 CodeReviewPanel 核心功能
- **左栏**：文件树（可多选/全选）
- **中栏**：选中文件预览（带行号 + finding 高亮）
- **右栏**：findings 列表（按严重度排序，可筛选）

### 6.2 交互流程
1. 用户上传文件 / 选择仓库内文件
2. 点击"开始 Review"按钮
3. 显示进度条（逐文件扫描）
4. 完成后展示报告：
   - 顶部统计卡片（5 个严重度计数 + verdict 徽章）
   - 按类别分组的 finding 列表
   - 点击 finding 跳转到对应行
5. 导出按钮：JSON / Markdown / SARIF

### 6.3 快捷键
- `Esc` — 关闭面板
- `?` — 显示快捷键帮助
- `Cmd/Ctrl + R` — 重新跑 review
- `Cmd/Ctrl + E` — 导出 Markdown
- `Cmd/Ctrl + F` — 聚焦搜索
- `Cmd/Ctrl + 1/2/3/4/5` — 筛选严重度

### 6.4 UI 组件
```tsx
<CodeReviewPanel
  isOpen={isOpen}
  onClose={onClose}
  initialFiles={['src/utils/foo.ts']}
  onReviewComplete={(report) => console.log(report)}
/>
```

## 7. 测试策略

### 7.1 单元测试（≥ 40 个）
- 严重度决策模型（5 条）
- 报告导出 JSON / Markdown / SARIF（3 条）
- 规则注册 / 注销 / 启用 / 禁用（5 条）
- Review 流程 — 各种输入组合（10 条）
- 单一规则触发（10 条：每个严重度至少 2 个）
- 严重度策略覆盖（3 条）
- maxFindings 截断（2 条）
- 事件触发（2 条）

### 7.2 组件测试（≥ 15 个）
- 渲染与关闭（3 条）
- 文件选择（3 条）
- Review 触发与进度（3 条）
- Finding 列表显示与筛选（3 条）
- 导出功能（3 条）

### 7.3 集成测试（Cycle 25 收尾时）
- 与 PRBotEngine 联动（PR review 自动调用）
- 与 PerfOptimizerEngine 联动（性能 finding 交叉验证）
- 跨 cycle 持久化（review 历史）

## 8. 实施步骤

1. **Step 1**: 实现 `autoCodeReviewTypes.ts`（所有类型定义）
2. **Step 2**: 实现 `autoCodeReviewRules.ts`（100+ 规则定义）
3. **Step 3**: 实现 `autoCodeReview.ts`（核心引擎）
4. **Step 4**: 实现 `autoCodeReview.test.ts`（≥ 40 单元测试）
5. **Step 5**: 实现 `CodeReviewPanel.tsx`（UI 面板）
6. **Step 6**: 实现 `CodeReviewPanel.test.tsx`（≥ 15 组件测试）
7. **Step 7**: App.tsx 集成 + BrandHeader 菜单
8. **Step 8**: 跨模块集成测试

## 9. 验收标准

- ✅ 规则库 ≥ 100 条规则（每类 ≥ 10 条）
- ✅ 单元测试 ≥ 40 个，100% 通过
- ✅ 组件测试 ≥ 15 个，100% 通过
- ✅ TypeScript 0 错误
- ✅ 报告导出 JSON + Markdown + SARIF 三个格式
- ✅ 严重度 5 级 + verdict 自动判定
- ✅ 可作为 PRBotEngine 底层依赖

## 10. 风险与回退

- **风险 1**: 规则数量过多导致维护成本 → 设计为可禁用、可分类查询
- **风险 2**: 误报率高 → 提供 confidence 字段 + 用户可标记
- **风险 3**: 大仓库扫描慢 → maxFindings 截断 + 异步执行
