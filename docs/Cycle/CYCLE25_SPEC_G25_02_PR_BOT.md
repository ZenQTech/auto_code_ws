# CYCLE 25 SPEC G25-02 - PRBotEngine PR 自动机器人引擎

> **任务 ID**: G25-02
> **优先级**: P0
> **所属 Cycle**: Cycle 25
> **目标版本**: v6.63.0
> **撰写日期**: 2026-07-30
> **撰写人**: Loop Engineering Workflow
> **关联调研**: [CYCLE25_CODEX_TRAE_RESEARCH.md](./CYCLE25_CODEX_TRAE_RESEARCH.md) §2.1 §2.2
> **依赖**: G25-01 AutoCodeReviewEngine

## 1. 背景与目标

### 1.1 背景

Codex/TRAE 等主流 AI IDE 都已经支持 PR 自动 review bot。Codex 通过 `@codex review` 在 PR 评论中触发，codex-action 在 CI/CD 中自动跑 review，miu-cr 实现了 P0-P4 五级严重度优先级的自动 review。

Hermes 平台目前**没有任何 PR bot 能力**，完全依赖人工 + CI 测试。需要补充：
- 模拟 GitHub PR 事件流（webhook 推送）
- 自动触发 AutoCodeReviewEngine
- 生成结构化 review 评论（inline + summary）
- 审计日志记录所有 bot 行为
- 三种 review 类型：COMMENT / REQUEST_CHANGES / APPROVE

### 1.2 目标

实现一个**纯前端模拟、可演示的 PR 自动机器人引擎**：

1. **模拟 PR 事件流**：mock GitHub webhook，支持 opened/synchronize/reopened
2. **自动 review 触发**：事件触发后自动调用 `AutoCodeReviewEngine.review`
3. **结构化评论生成**：inline comment（按行号锚定）+ summary comment（含 verdict 和统计）
4. **三种 review 类型**：COMMENT（默认）/ REQUEST_CHANGES / APPROVE
5. **审计日志**：所有 bot 行为完整记录
6. **可集成性**：作为循环工程 workflow 中"代码评审"环节的标准实现

### 1.3 范围

**包含**：
- 1 个核心引擎 `PRBotEngine`（`frontend/src/utils/prBotEngine.ts`）
- 1 个 UI 面板 `PRBotPanel`（`frontend/src/components/PRBotPanel.tsx`）
- ≥ 35 个单元测试 + ≥ 12 个组件测试

**不包含**（Cycle 26+）：
- 真实 GitHub API 调用（本 cycle 使用 mock）
- OAuth / Token 管理
- 真实 webhook 接收（用 mock event 替代）

## 2. 核心数据模型

```typescript
// === PR 信息 ===
export interface PullRequest {
  number: number;
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  /** 变更的文件 */
  files: PRFile[];
  /** 状态 */
  status: 'open' | 'closed' | 'merged';
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 关联的 head SHA */
  headSha: string;
  /** 关联的 base SHA */
  baseSha: string;
}

export interface PRFile {
  path: string;
  /** 文件内容（mock 数据） */
  content: string;
  /** 新增行数 */
  additions: number;
  /** 删除行数 */
  deletions: number;
  /** 变更状态 */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

// === Webhook 事件 ===
export type PREventType = 'opened' | 'synchronize' | 'reopened' | 'closed';

export interface PREvent {
  type: PREventType;
  pr: PullRequest;
  /** 事件触发时间 */
  timestamp: number;
  /** 触发器：'webhook' | 'manual' | 'auto-trigger' */
  trigger: 'webhook' | 'manual' | 'auto-trigger';
  /** 事件元数据 */
  metadata?: Record<string, unknown>;
}

// === Bot 配置 ===
export interface BotConfig {
  /** Bot 名称 */
  name: string;
  /** Bot 头像（emoji 或 URL） */
  avatar: string;
  /** 自动 review 触发事件 */
  autoReviewTriggers: PREventType[];
  /** 默认 review 类型 */
  defaultReviewType: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
  /** 严重度门禁：>= 该级别触发 REQUEST_CHANGES */
  blockOnSeverity: Severity;
  /** Bot 签名 */
  signature: string;
  /** 是否启用 */
  enabled: boolean;
}

// === Review Comment ===
export interface PRReviewComment {
  id: string;
  prNumber: number;
  /** 评论类型 */
  type: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
  /** 评论作者（bot 名） */
  author: string;
  /** 评论主体（markdown） */
  body: string;
  /** inline comments */
  lineComments: LineComment[];
  /** 关联的 ReviewReport ID */
  reportId?: string;
  /** 创建时间 */
  createdAt: number;
  /** 是否已发送（mock 状态） */
  delivered: boolean;
}

export interface LineComment {
  id: string;
  file: string;
  line: number;
  /** 评论内容（markdown） */
  body: string;
  /** 关联的 finding ID */
  findingId: string;
  /** 严重度 */
  severity: Severity;
}

// === 审计日志条目 ===
export interface BotActionLog {
  id: string;
  /** 事件类型 */
  action:
    | 'pr-opened'
    | 'pr-synchronize'
    | 'pr-reopened'
    | 'review-posted'
    | 'comment-posted'
    | 'config-updated'
    | 'error';
  /** PR 编号 */
  prNumber?: number;
  /** 详情 */
  details: string;
  /** 时间戳 */
  timestamp: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

// === Bot 状态 ===
export interface BotState {
  config: BotConfig;
  /** 所有 PR 列表 */
  pullRequests: PullRequest[];
  /** 所有 review comments */
  reviews: PRReviewComment[];
  /** 审计日志 */
  auditLog: BotActionLog[];
  /** 最近一次 review 报告 */
  lastReport?: ReviewReport;
}
```

## 3. 引擎 API

```typescript
export class PRBotEngine {
  constructor(config?: Partial<BotConfig>);

  // === 配置管理 ===
  configure(config: Partial<BotConfig>): void;
  getConfig(): BotConfig;
  resetConfig(): void;

  // === PR 管理（mock） ===
  registerPR(pr: PullRequest): void;
  updatePR(prNumber: number, updates: Partial<PullRequest>): void;
  closePR(prNumber: number): void;
  getPR(prNumber: number): PullRequest | undefined;
  getAllPRs(): PullRequest[];

  // === 事件触发 ===
  triggerEvent(event: PREvent): Promise<PRReviewComment | null>;
  onPROpen(pr: PullRequest): Promise<PRReviewComment | null>;
  onPRSynchronize(pr: PullRequest): Promise<PRReviewComment | null>;
  onPRReopened(pr: PullRequest): Promise<PRReviewComment | null>;

  // === Review 生成 ===
  generateReview(prNumber: number, options?: { type?: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' }): Promise<PRReviewComment>;
  generateLineComments(report: ReviewReport): LineComment[];
  generateSummaryBody(report: ReviewReport, pr: PullRequest): string;

  // === 审计日志 ===
  getAuditLog(filter?: { action?: BotActionLog['action']; prNumber?: number }): BotActionLog[];
  clearAuditLog(): void;

  // === 状态查询 ===
  getState(): BotState;
  getStats(): { prs: number; reviews: number; actions: number; bySeverity: Record<Severity, number> };

  // === 事件 ===
  on(event: 'pr-opened', listener: (pr: PullRequest) => void): void;
  on(event: 'review-posted', listener: (review: PRReviewComment) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  off(event: string, listener: Function): void;

  // === 序列化 ===
  exportState(): string;
  importState(json: string): void;
  clear(): void;
}
```

## 4. Review 类型决策

```typescript
function decideReviewType(
  report: ReviewReport,
  policy: { blockOnSeverity: Severity; defaultReviewType: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' }
): 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' {
  if (policy.defaultReviewType === 'COMMENT') {
    // COMMENT 模式下，根据严重度决定
    const severityRank: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    const policyRank = severityRank[policy.blockOnSeverity];

    if (report.summary.critical > 0 || report.summary.high >= 3) return 'REQUEST_CHANGES';
    if (severityRank[highestSeverity(report)] >= policyRank) return 'REQUEST_CHANGES';
    return 'COMMENT';
  }
  return policy.defaultReviewType;
}
```

## 5. Inline Comment 格式

```markdown
**[P0 · CRITICAL · security]** `src/utils/auth.ts:42`
🔴 Hardcoded API key detected.

**Problem**:
```typescript
const API_KEY = 'sk-1234567890abcdef';
```

**Fix**:
```typescript
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error('API_KEY not configured');
```

**Why**: 硬编码密钥会泄露到 Git 历史，无法完全清除。
```

## 6. Summary Comment 格式

```markdown
## 🤖 Hermes Auto Code Review

**Verdict**: 🟠 REQUEST_CHANGES
**Total findings**: 12 (🔴 1 / 🟠 3 / 🟡 5 / 🟢 2 / 💡 1)
**Files reviewed**: 5
**Duration**: 1.2s

### Top 3 Priority Issues

1. **[CRITICAL · security]** `src/utils/auth.ts:42` — Hardcoded API key
2. **[HIGH · performance]** `src/components/List.tsx:18` — Missing key prop
3. **[HIGH · bug]** `src/utils/parser.ts:99` — Unhandled promise rejection

<details>
<summary>View all 12 findings</summary>

| Severity | Category | File:Line | Title |
|----------|----------|-----------|-------|
| 🔴 CRITICAL | security | src/utils/auth.ts:42 | Hardcoded API key |
| 🟠 HIGH | performance | src/components/List.tsx:18 | Missing key prop |
| ...

</details>

---
🤖 Generated by [Hermes Code Review Bot v1.0.0](https://example.com/bot)
```

## 7. UI 面板设计

### 7.1 PRBotPanel 核心功能
- **顶部配置区**：Bot 名称、签名、auto trigger 事件、block 级别
- **左栏**：PR 列表（含状态、文件数、最后 review 时间）
- **中栏**：选中 PR 的详情（文件列表 + review 状态）
- **右栏**：最近 review 的 finding 列表

### 7.2 交互流程
1. 用户配置 Bot（启用 auto review、严重度门禁）
2. 创建或选择 PR（mock 数据）
3. 手动触发 review 或等待 auto trigger
4. 查看生成的 review（summary + inline comments）
5. 查看审计日志

### 7.3 快捷键
- `Esc` — 关闭面板
- `?` — 显示快捷键帮助
- `Cmd/Ctrl + N` — 创建 mock PR
- `Cmd/Ctrl + R` — 重新触发 review
- `Cmd/Ctrl + L` — 查看审计日志
- `Cmd/Ctrl + F` — 聚焦搜索

## 8. 测试策略

### 8.1 单元测试（≥ 35 个）
- 配置管理（5 条）
- PR 注册 / 更新 / 关闭（3 条）
- 事件触发（3 条）
- Review 生成（5 条）
- 严重度决策（3 条）
- Inline comment 生成（3 条）
- Summary body 生成（3 条）
- 审计日志（3 条）
- 事件订阅（3 条）
- 序列化 / 反序列化（2 条）
- 状态查询（2 条）

### 8.2 组件测试（≥ 12 个）
- 渲染与关闭（2 条）
- Bot 配置（2 条）
- PR 列表显示（2 条）
- Review 触发与展示（3 条）
- 审计日志查看（2 条）
- 快捷键（1 条）

## 9. 验收标准

- ✅ 单元测试 ≥ 35 个，100% 通过
- ✅ 组件测试 ≥ 12 个，100% 通过
- ✅ TypeScript 0 错误
- ✅ 完整 mock PR 生命周期（open → review → close）
- ✅ 3 种 review 类型都能生成
- ✅ 严重度门禁正确触发 REQUEST_CHANGES
- ✅ 与 G25-01 AutoCodeReviewEngine 集成
- ✅ 审计日志完整可查询

## 10. 实施步骤

1. **Step 1**: 实现 `prBotEngineTypes.ts`（所有类型）
2. **Step 2**: 实现 `prBotEngine.ts`（核心引擎）
3. **Step 3**: 实现 `prBotEngine.test.ts`（≥ 35 单元测试）
4. **Step 4**: 实现 `PRBotPanel.tsx`（UI 面板）
5. **Step 5**: 实现 `PRBotPanel.test.tsx`（≥ 12 组件测试）
6. **Step 6**: App.tsx 集成 + BrandHeader 菜单
7. **Step 7**: 跨模块集成测试

## 11. 风险与回退

- **风险 1**: mock 数据不真实 → 提供预设 PR 模板 + 自定义上传
- **风险 2**: 审计日志过多 → 支持筛选 + 导出
- **风险 3**: review 类型决策错误 → 提供手动 override
