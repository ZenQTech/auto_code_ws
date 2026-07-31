# Cycle 26 G26-01 SPEC: CSV 批处理智能体引擎

**版本**: v1.0.0
**日期**: 2026-07-30
**Cycle**: 26
**优先级**: P0
**来源**: Codex CLI `spawn_agents_on_csv` (v0.105.0, 2026-02-25)

---

## 一、概述

### 1.1 目标

实现 Hermes 平台对 CSV 驱动的批量智能体任务扇出能力。用户上传一个 CSV 文件 + 一条模板指令，系统按行创建子智能体，并发执行并收集结果到新 CSV。

### 1.2 核心场景

- **场景 A：批量文档分析** — 上传 `documents.csv`（id, title, content），模板指令 `Summarize {content} into 3 bullet points`，输出 `summary` 列
- **场景 B：批量代码审查** — 上传 `prs.csv`（id, repo, diff_url），模板指令 `Review the diff at {diff_url} in repo {repo}`，输出 `verdict` 列
- **场景 C：批量翻译** — 上传 `phrases.csv`（id, lang, text），模板指令 `Translate '{text}' to {lang}`，输出 `translation` 列
- **场景 D：批量数据提取** — 上传 `articles.csv`（id, url, body），模板指令 `Extract product names from {body}`，输出 `products` 列

### 1.3 价值

- 补齐 Hermes 在批量扇出场景的能力
- 复用现有 `MultiTaskOrchestrator`、`SubAgent`、`Worktree` 体系
- 与 `BestOfN` 协同：每个工作项可选不同模型

---

## 二、核心数据模型

### 2.1 类型定义（csvBatchEngineTypes.ts）

```typescript
export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type ItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface CsvBatchConfig {
  /** 最大并发数（1-10） */
  maxConcurrency: number;
  /** 单项超时（秒） */
  maxRuntimeSeconds: number;
  /** 失败时是否自动重试 */
  autoRetry: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 失败策略：fail-fast | continue */
  failureStrategy: 'fail-fast' | 'continue';
  /** 输出 CSV 路径（可选） */
  outputCsvPath?: string;
  /** 是否持久化到 localStorage */
  persist: boolean;
}

export interface CsvBatchItem {
  /** 稳定 ID（来自 id_column 或自动生成） */
  id: string;
  /** 行号（0-based） */
  rowIndex: number;
  /** 渲染后的指令 */
  renderedInstruction: string;
  /** 原始行数据 */
  rawRow: Record<string, string>;
  /** 状态 */
  status: ItemStatus;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 重试次数 */
  retries: number;
  /** 错误信息 */
  error?: string;
  /** 任务结果 */
  result?: CsvBatchResult;
}

export interface CsvBatchResult {
  /** 输出字段名 */
  outputField: string;
  /** 输出值 */
  value: unknown;
  /** 原始 JSON（如果适用） */
  rawJson?: string;
  /** 持续时间（ms） */
  duration: number;
  /** 使用的模型 */
  model?: string;
  /** Token 消耗 */
  tokens?: { input: number; output: number; total: number };
}

export interface CsvBatchJob {
  id: string;
  status: JobStatus;
  /** 输入 CSV 文件名 */
  inputFile: string;
  /** CSV 解析后的列名 */
  columns: string[];
  /** 指令模板 */
  instruction: string;
  /** ID 列名（缺省自动生成 row-N） */
  idColumn?: string;
  /** 输出字段名 */
  outputField: string;
  /** 所有工作项 */
  items: CsvBatchItem[];
  /** 配置 */
  config: CsvBatchConfig;
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 错误信息（整体失败时） */
  error?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface CsvBatchProgress {
  jobId: string;
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  /** 估算剩余时间（秒） */
  etaSeconds: number;
  /** 已用时间（秒） */
  elapsedSeconds: number;
  /** 完成率 0-1 */
  rate: number;
}
```

### 2.2 事件类型

```typescript
export type CsvBatchEvent =
  | { type: 'job-created'; job: CsvBatchJob }
  | { type: 'job-started'; jobId: string }
  | { type: 'job-completed'; jobId: string }
  | { type: 'job-failed'; jobId: string; error: string }
  | { type: 'job-cancelled'; jobId: string }
  | { type: 'item-started'; jobId: string; itemId: string }
  | { type: 'item-completed'; jobId: string; itemId: string; result: CsvBatchResult }
  | { type: 'item-failed'; jobId: string; itemId: string; error: string }
  | { type: 'progress'; progress: CsvBatchProgress };
```

---

## 三、核心 API 设计

### 3.1 引擎主类（csvBatchEngine.ts）

```typescript
export class CsvBatchEngine {
  constructor(config?: Partial<CsvBatchConfig>);

  // 解析 CSV
  parseCsv(content: string, idColumn?: string): Promise<{
    columns: string[];
    rows: Record<string, string>[];
  }>;

  // 渲染模板
  renderTemplate(template: string, row: Record<string, string>): string;

  // 创建 Job
  createJob(input: CreateJobInput): Promise<CsvBatchJob>;

  // 启动 Job
  startJob(jobId: string): Promise<void>;

  // 暂停 Job
  pauseJob(jobId: string): Promise<void>;

  // 恢复 Job
  resumeJob(jobId: string): Promise<void>;

  // 取消 Job
  cancelJob(jobId: string): Promise<void>;

  // 重试失败项
  retryFailed(jobId: string): Promise<void>;

  // 获取 Job
  getJob(jobId: string): CsvBatchJob | undefined;

  // 获取所有 Jobs
  getAllJobs(): CsvBatchJob[];

  // 获取进度
  getProgress(jobId: string): CsvBatchProgress | undefined;

  // 导出结果为 CSV
  exportResults(jobId: string): string;

  // 事件订阅
  on(event: CsvBatchEventType, listener: Function): () => void;

  // 统计
  getStats(): {
    jobs: number;
    items: number;
    completed: number;
    failed: number;
  };
}
```

### 3.2 DSL 模板语法

**支持的占位符**：
- `{column_name}` — 简单替换
- `{column_name | upper}` — 大写转换
- `{column_name | lower}` — 小写转换
- `{column_name | trim}` — 去空格
- `{column_name | default:FALLBACK}` — 缺省值
- `{column_name | json}` — JSON 编码
- `{column_name | slice:0:10}` — 字符串切片

**示例**：
```
Review the code at {repo_url} (branch: {branch | default:main})
with priority: {priority | upper}
```

---

## 四、UI 设计（CsvBatchPanel.tsx）

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 CSV 批处理智能体                              [Esc] 关闭    │
├─────────────────────────────────────────────────────────────────┤
│  步骤 1: 上传 CSV                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  拖拽 CSV 到此处或 [浏览]                                 │  │
│  │  支持: .csv (UTF-8, BOM, 灵活列数)                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  步骤 2: 配置                                                    │
│  ID 列: [id ▼]  输出字段: [summary ▼]                            │
│  指令模板:                                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Summarize the following: {content}                        │  │
│  │ into 3 bullet points.                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  步骤 3: 执行选项                                                │
│  并发: [3▼]  超时: [60s]  失败重试: [✓]  策略: [continue▼]       │
│                                                                  │
│  [▶ 开始执行] [💾 保存模板] [🔄 重置] [📥 加载示例]              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  📈 Job 进度: My Job (5/10)                                      │
│  ████████░░░░░░░ 50%  ETA: 12s                                   │
│  [item-1] ✅ 完成 (1.2s)   [item-2] ✅ 完成 (0.8s)              │
│  [item-3] ⏳ 运行中          [item-4] ⏸ 等待                    │
│  [item-5] ❌ 失败 (重试 1/3)                                      │
│                                                                  │
│  [📥 导出 CSV] [⏸ 暂停] [⏹ 停止] [🔄 重试失败]                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 核心交互

1. **拖拽上传** / 点击浏览 / 加载示例
2. **解析预览**：列名 + 前 3 行数据
3. **指令模板输入**：支持占位符自动补全（按 Ctrl+Space）
4. **执行监控**：实时进度 + ETA + 失败项高亮
5. **结果导出**：CSV / JSON 双格式
6. **快捷键**：
   - `Esc` 关闭面板
   - `Ctrl+Enter` 开始执行
   - `Ctrl+R` 重试失败
   - `Ctrl+E` 导出结果
   - `Ctrl+L` 加载示例
   - `Ctrl+P` 暂停/恢复
   - `?` 显示帮助

---

## 五、与现有能力集成

| 现有能力 | 集成方式 |
|---|---|
| `MultiTaskOrchestrator` | 每个工作项作为子任务加入编排器 |
| `SubAgent` | 工作项通过 SubAgent 派发 |
| `Worktree` | 可选为每个 Job 分配独立 worktree |
| `BestOfN` | 每个工作项可选 1-N 个模型 |
| `ModelRouter` | 路由到合适的 LLM |
| `CostPrediction` | 预测 Job 总成本 |
| `GlobalMemory` | 跨 Job 共享上下文 |
| `HooksEngine` | 触发 job-start/item-start/item-complete 等事件 |

---

## 六、测试策略

### 6.1 单元测试（csvBatchEngine.test.ts，目标 30+ 用例）

- ✅ CSV 解析：BOM、换行、引号转义、空行、灵活列数
- ✅ 模板渲染：简单/转换/缺省/JSON/切片
- ✅ ID 去重：相同 ID 追加 -2, -3
- ✅ 并发控制：1/3/10 并发
- ✅ 超时处理：单项工作超时
- ✅ 重试机制：失败后自动重试
- ✅ 失败策略：fail-fast / continue
- ✅ 暂停/恢复：保留状态
- ✅ 取消：清理进行中任务
- ✅ 进度计算：ETA 准确
- ✅ 结果导出：CSV 格式正确
- ✅ 事件订阅：所有事件正确触发
- ✅ 统计信息：jobs/items/completed/failed

### 6.2 组件测试（CsvBatchPanel.test.tsx，目标 20+ 用例）

- ✅ 基础渲染：isOpen=false 不渲染
- ✅ CSV 上传与解析
- ✅ 列选择器联动
- ✅ 指令模板输入
- ✅ 执行按钮启用/禁用
- ✅ 进度展示
- ✅ 失败项高亮
- ✅ 重试/取消/暂停交互
- ✅ 导出对话框
- ✅ 快捷键
- ✅ localStorage 持久化
- ✅ 空状态展示

### 6.3 集成测试（cycle26-integration.test.ts，目标 5+ 用例）

- ✅ 三大引擎独立工作
- ✅ CSV Batch + Smart Approval 协同（每条命令审批）
- ✅ CSV Batch + MTC Adapter 协同（结果传给 MTC 处理）
- ✅ 与 MultiTaskOrchestrator 联动
- ✅ 与 BestOfN 联动（多模型对比）

---

## 七、验收标准

| 维度 | 标准 |
|---|---|
| 功能完整度 | 所有 SPEC API 实现，支持 5+ DSL 转换 |
| 测试通过率 | 100%（55+ 用例） |
| TypeScript | 0 错误 |
| UI/UX | 支持拖拽、快捷键、持久化、帮助系统 |
| 性能 | 100 个工作项 < 60s 完成（串行），< 10s 完成（10 并发） |
| 可观测性 | 完整事件订阅 + 进度监控 + ETA 准确率 ≥80% |
| 文档 | 引擎 + UI + DSL + 示例 完整说明 |

---

## 八、交付物清单

1. ✅ `frontend/src/utils/csvBatchEngineTypes.ts` — 类型定义
2. ✅ `frontend/src/utils/csvBatchEngine.ts` — 核心引擎
3. ✅ `frontend/src/utils/csvBatchEngineRules.ts` — DSL 转换器
4. ✅ `frontend/src/utils/csvBatchEngine.test.ts` — 单元测试
5. ✅ `frontend/src/components/CsvBatchPanel.tsx` — UI 组件
6. ✅ `frontend/src/components/CsvBatchPanel.test.tsx` — 组件测试
7. ✅ `frontend/src/utils/cycle26-integration.test.ts` — 集成测试
8. ✅ 集成到 `App.tsx`、`AppLayout.tsx`、`BrandHeader.tsx`
9. ✅ 菜单项 `📊 CSV 批处理` + 图标

---

**G26-01 SPEC 状态**: ✅ 已完成
**预计代码量**: ~1500 行（含测试）
**预计交付日期**: Cycle 26 Phase 4
