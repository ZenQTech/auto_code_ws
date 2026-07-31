# Cycle 26 G26-03 SPEC: MTC（More Than Coding）适配器

**版本**: v1.0.0
**日期**: 2026-07-30
**Cycle**: 26
**优先级**: P1
**来源**: TRAE SOLO MTC Mode (2026-03-31)

---

## 一、概述

### 1.1 目标

实现 Hermes 平台对非编码任务的支持。用户上传文件（文本/数据/代码）+ 选择任务类型（总结/翻译/重写/分析/转换），系统自动处理并导出结果。

### 1.2 核心场景

- **场景 A：批量文档总结** — 上传多个 `.md` 文件 → AI 总结 → 导出合并 Markdown
- **场景 B：CSV 数据分析** — 上传 `sales.csv` → AI 提取关键洞察 + 建议可视化图表
- **场景 C：批量翻译** — 上传 `i18n.json` → 翻译成目标语言 → 导出 JSON
- **场景 D：JSON 转换** — 上传 `package.json` → 转 YAML/TOML
- **场景 E：代码优化** — 上传 `legacy.ts` → AI 重构 + 现代化建议

### 1.3 价值

- 扩展 Hermes 平台到非编码场景
- 复用 `FigmaAdapter`、`MultiModelExecutor`、`ComposerPanel` 架构
- 触达非开发者用户（PM/运营/分析师）

---

## 二、核心数据模型

### 2.1 类型定义（mtcAdapterTypes.ts）

```typescript
export type MtcFileType =
  | 'text'        // .txt, .md, .markdown
  | 'data-csv'    // .csv
  | 'data-json'   // .json
  | 'code-ts'     // .ts, .tsx
  | 'code-js'     // .js, .jsx
  | 'code-py'     // .py
  | 'code-css'    // .css, .scss
  | 'code-html'   // .html
  | 'code-md'     // .md
  | 'unknown';

export type MtcTaskType =
  | 'summarize'   // 总结
  | 'translate'   // 翻译
  | 'rewrite'     // 重写
  | 'analyze'     // 分析
  | 'convert'     // 转换
  | 'extract'     // 提取
  | 'optimize';   // 优化

export type MtcOutputFormat =
  | 'markdown'
  | 'json'
  | 'csv'
  | 'yaml'
  | 'html'
  | 'text';

export interface MtcFile {
  id: string;
  name: string;
  type: MtcFileType;
  size: number;        // bytes
  content: string;
  /** 解析后的结构化数据（CSV/JSON） */
  parsed?: unknown;
  /** 加载时间 */
  loadedAt: number;
}

export interface MtcTask {
  id: string;
  type: MtcTaskType;
  /** 输入文件 ID 列表 */
  fileIds: string[];
  /** 任务参数 */
  params: MtcTaskParams;
  /** 输出格式 */
  outputFormat: MtcOutputFormat;
  /** 状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 错误信息 */
  error?: string;
  /** 结果 */
  result?: MtcResult;
  /** 使用的模型 */
  model?: string;
  /** Token 消耗 */
  tokens?: { input: number; output: number; total: number };
}

export type MtcTaskParams =
  | { type: 'summarize'; maxLength?: number; language?: string; focusAreas?: string[] }
  | { type: 'translate'; from: string; to: string; preserveFormatting?: boolean }
  | { type: 'rewrite'; style: 'formal' | 'casual' | 'academic' | 'creative' | 'concise'; preserveMeaning?: boolean }
  | { type: 'analyze'; questions?: string[]; generateVisualization?: boolean }
  | { type: 'convert'; targetFormat: 'json' | 'yaml' | 'toml' | 'csv' | 'markdown' | 'html' }
  | { type: 'extract'; fields: string[]; format: 'json' | 'csv' | 'list' }
  | { type: 'optimize'; goals: string[]; preserveApi?: boolean };

export interface MtcResult {
  id: string;
  taskId: string;
  /** 主要结果内容 */
  content: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
  /** 提取的数据（如果是 extract 任务） */
  extracted?: unknown[];
  /** 可视化建议（如果是 analyze 任务） */
  visualization?: MtcVisualization;
  /** 持续时间（ms） */
  duration: number;
}

export interface MtcVisualization {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'table' | 'heatmap';
  title: string;
  data: unknown;
  description: string;
}

export interface MtcConfig {
  /** 默认模型 */
  defaultModel: string;
  /** 最大文件大小（bytes，默认 1MB） */
  maxFileSize: number;
  /** 最大并发任务 */
  maxConcurrency: number;
  /** 持久化 */
  persist: boolean;
}
```

### 2.2 事件类型

```typescript
export type MtcEvent =
  | { type: 'file-loaded'; file: MtcFile }
  | { type: 'file-removed'; fileId: string }
  | { type: 'task-created'; task: MtcTask }
  | { type: 'task-started'; taskId: string }
  | { type: 'task-completed'; taskId: string; result: MtcResult }
  | { type: 'task-failed'; taskId: string; error: string }
  | { type: 'task-cancelled'; taskId: string }
  | { type: 'progress'; taskId: string; progress: number };
```

---

## 三、核心 API 设计

### 3.1 引擎主类（mtcAdapter.ts）

```typescript
export class MtcAdapter {
  constructor(config?: Partial<MtcConfig>);

  // 文件管理
  loadFile(file: File): Promise<MtcFile>;
  loadFiles(files: File[]): Promise<MtcFile[]>;
  detectType(name: string, content: string): MtcFileType;
  parseFile(file: MtcFile): MtcFile;
  removeFile(fileId: string): boolean;
  getFile(fileId: string): MtcFile | undefined;
  getAllFiles(): MtcFile[];

  // 任务管理
  createTask(input: CreateTaskInput): MtcTask;
  startTask(taskId: string): Promise<void>;
  cancelTask(taskId: string): void;
  getTask(taskId: string): MtcTask | undefined;
  getAllTasks(): MtcTask[];

  // 任务执行
  runTask(task: MtcTask): Promise<MtcResult>;
  runBatch(tasks: MtcTask[]): Promise<MtcResult[]>;

  // 结果导出
  exportResult(resultId: string, format: MtcOutputFormat): string;
  exportBatch(taskIds: string[]): string;

  // 处理器
  handleSummarize(task: MtcTask): Promise<MtcResult>;
  handleTranslate(task: MtcTask): Promise<MtcResult>;
  handleRewrite(task: MtcTask): Promise<MtcResult>;
  handleAnalyze(task: MtcTask): Promise<MtcResult>;
  handleConvert(task: MtcTask): Promise<MtcResult>;
  handleExtract(task: MtcTask): Promise<MtcResult>;
  handleOptimize(task: MtcTask): Promise<MtcResult>;

  // 事件订阅
  on(event: MtcEventType, listener: Function): () => void;

  // 统计
  getStats(): {
    files: number;
    tasks: number;
    completed: number;
    failed: number;
  };
}
```

### 3.2 处理器实现

#### summarize（总结）
```typescript
async handleSummarize(task: MtcTask): Promise<MtcResult> {
  const files = task.fileIds.map(id => this.getFile(id)!);
  const content = files.map(f => f.content).join('\n\n');
  const params = task.params as Extract<MtcTaskParams, { type: 'summarize' }>;

  const prompt = `请用${params.language || '中文'}总结以下内容，要求：
${params.maxLength ? `- 长度不超过 ${params.maxLength} 字` : '- 简洁明了，重点突出'}
${params.focusAreas?.length ? `- 重点关注: ${params.focusAreas.join('、')}` : ''}

内容：
${content}`;

  const summary = await this.callLLM(prompt, task.model);
  return {
    id: generateResultId(),
    taskId: task.id,
    content: summary,
    duration: Date.now() - startTime,
  };
}
```

#### translate（翻译）
```typescript
async handleTranslate(task: MtcTask): Promise<MtcResult> {
  const files = task.fileIds.map(id => this.getFile(id)!);
  const content = files.map(f => f.content).join('\n\n');
  const params = task.params as Extract<MtcTaskParams, { type: 'translate' }>;

  const prompt = `请将以下内容从 ${params.from} 翻译为 ${params.to}：
${params.preserveFormatting ? '（保持原始格式：换行、缩进、标点）' : ''}

内容：
${content}`;

  const translation = await this.callLLM(prompt, task.model);
  return { id, taskId, content: translation, duration };
}
```

#### analyze（分析）
```typescript
async handleAnalyze(task: MtcTask): Promise<MtcResult> {
  const files = task.fileIds.map(id => this.getFile(id)!);
  const content = files.map(f => f.content).join('\n\n');
  const params = task.params as Extract<MtcTaskParams, { type: 'analyze' }>;

  const prompt = `请分析以下数据，${params.questions?.length ? `重点回答：${params.questions.join('; ')}` : '提取关键洞察'}
${params.generateVisualization ? '同时建议合适的可视化方案（柱状图/折线图/饼图等）' : ''}

数据：
${content}

输出格式：
## 关键洞察
- ...
## 趋势分析
- ...
## 建议
- ...
${params.generateVisualization ? '## 可视化建议\n- 图表类型: ...\n- 数据维度: ...' : ''}`;

  const analysis = await this.callLLM(prompt, task.model);
  const visualization = params.generateVisualization
    ? this.extractVisualization(analysis)
    : undefined;

  return { id, taskId, content: analysis, visualization, duration };
}
```

---

## 四、UI 设计（MTCPanel.tsx）

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────────────────┐
│  📄 MTC 适配器（More Than Coding）                  [Esc] 关闭  │
├─────────────────────────────────────────────────────────────────┤
│  步骤 1: 上传文件                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  拖拽文件到此处或 [浏览]                                  │  │
│  │  支持: .txt .md .json .csv .ts .tsx .js .py .html .css  │  │
│  │  单文件 ≤ 1MB, 最多 20 个文件                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  已加载文件 (3):                                                  │
│  📄 readme.md (12 KB)        [预览] [移除]                       │
│  📊 sales.csv (45 KB)        [预览] [移除]                       │
│  📝 legacy.ts (8 KB)         [预览] [移除]                       │
│                                                                  │
│  步骤 2: 选择任务                                                │
│  [📝 总结]  [🌐 翻译]  [✏️ 重写]  [🔍 分析]  [🔄 转换]  [...]    │
│                                                                  │
│  任务参数:                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 语言: [中文▼]  最大长度: [500字]  重点: [关键功能, 性能] │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  输出格式: [Markdown▼]  模型: [gpt-4o-mini▼]                     │
│                                                                  │
│  [▶ 执行]  [📥 加载示例]  [🔄 重置]                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  结果:                                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  # Sales Q1 2026 总结                                    │  │
│  │                                                          │  │
│  │  ## 关键洞察                                              │  │
│  │  - 销售额同比增长 23%...                                 │  │
│  │  ...                                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│  [📋 复制]  [📥 下载 .md]  [📥 下载 .json]                       │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 核心交互

1. **拖拽上传** / 点击浏览 / 加载示例
2. **文件预览**：双击文件查看内容
3. **任务选择**：7 种任务类型卡片
4. **参数配置**：根据任务类型动态展示参数
5. **结果展示**：Markdown 渲染 + 复制 + 下载
6. **历史任务**：查看过去 10 个任务
7. **快捷键**：
   - `Esc` 关闭面板
   - `Ctrl+Enter` 执行当前任务
   - `Ctrl+L` 加载示例
   - `Ctrl+R` 重置
   - `Ctrl+1-7` 切换任务类型
   - `?` 显示帮助

---

## 五、与现有能力集成

| 现有能力 | 集成方式 |
|---|---|
| `FigmaAdapter` | 复用多模态文件处理架构 |
| `MultiModelExecutor` | 调用 LLM 生成结果 |
| `ComposerPanel` | 复用 Markdown 渲染与导出 |
| `FileExplorer` | 文件操作复用 |
| `ModelRouter` | 智能选择模型 |
| `CostPrediction` | 预测任务成本 |
| `SmartApproval` (Cycle 26 规划) | 文件处理前审批 |

---

## 六、测试策略

### 6.1 单元测试（mtcAdapter.test.ts，目标 25+ 用例）

- ✅ 文件类型检测：10 种类型
- ✅ CSV/JSON 解析
- ✅ summarize：中文/英文
- ✅ translate：中英互译
- ✅ rewrite：5 种风格
- ✅ analyze：包含 visualization 提取
- ✅ convert：6 种格式互转
- ✅ extract：字段提取
- ✅ optimize：保留 API
- ✅ 错误处理：超大文件/不支持格式
- ✅ 事件订阅
- ✅ 统计信息
- ✅ 持久化与恢复

### 6.2 组件测试（MTCPanel.test.tsx，目标 15+ 用例）

- ✅ 基础渲染
- ✅ 文件上传与预览
- ✅ 任务类型切换
- ✅ 参数动态展示
- ✅ 执行与结果展示
- ✅ Markdown 渲染
- ✅ 复制/下载
- ✅ 快捷键
- ✅ localStorage 持久化
- ✅ 空状态

### 6.3 集成测试（cycle26-integration.test.ts，目标 3+ 用例）

- ✅ MTC + MultiModelExecutor 协同
- ✅ MTC + Smart Approval 联动
- ✅ MTC + CSV Batch 联动（结果导出后批量处理）

---

## 七、验收标准

| 维度 | 标准 |
|---|---|
| 功能完整度 | 7 种任务类型 + 10 种文件类型 |
| 测试通过率 | 100%（43+ 用例） |
| TypeScript | 0 错误 |
| 性能 | 10KB 文件处理 < 5s |
| 用户体验 | 拖拽/预览/快捷键/持久化完整 |
| 文档 | 任务类型 + 处理器 + 示例完整 |

---

## 八、交付物清单

1. ✅ `frontend/src/utils/mtcAdapterTypes.ts` — 类型定义
2. ✅ `frontend/src/utils/mtcAdapter.ts` — 核心引擎
3. ✅ `frontend/src/utils/mtcAdapterHandlers.ts` — 7 种处理器
4. ✅ `frontend/src/utils/mtcAdapter.test.ts` — 单元测试
5. ✅ `frontend/src/components/MTCPanel.tsx` — UI 组件
6. ✅ `frontend/src/components/MTCPanel.test.tsx` — 组件测试
7. ✅ 集成到 `App.tsx`、`AppLayout.tsx`、`BrandHeader.tsx`
8. ✅ 菜单项 `📄 MTC 适配器` + 图标

---

**G26-03 SPEC 状态**: ✅ 已完成
**预计代码量**: ~1300 行（含测试）
**预计交付日期**: Cycle 26 Phase 4
