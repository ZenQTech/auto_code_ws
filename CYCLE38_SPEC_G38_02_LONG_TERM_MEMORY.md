# CYCLE38 规格说明书：G38-02 长期记忆引擎（MemGPT 风格分层存储）

> 周期：Cycle 38  
> 任务 ID：G38-02  
> 模块名称：LongTermMemory  
> 版本：v1.0.0  
> 日期：2026-07-31

---

## 一、模块定位

### 1.1 核心作用

实现 MemGPT 风格的分层记忆系统，支持核心记忆、回忆记忆、归档记忆三层存储，自动衰减、记忆整合、语义检索。

### 1.2 对标产品

- **MemGPT**（Letta）- 分层记忆管理
- **Zep** - 企业级长期记忆
- **LangChain Memory** - 多种记忆策略

### 1.3 与现有模块关系

- **G37-01 RAGEngine**：归档记忆检索复用 RAG 引擎
- **G37-03 AgentLoopEngine**：Agent 可读写记忆
- **G38-03 ReflectionEngine**：反思结果存入归档记忆

---

## 二、核心数据结构

### 2.1 MemoryLayer（记忆分层）

```typescript
export type MemoryLayer = 'core' | 'recall' | 'archive';

export interface MemoryItem {
  id: string;
  layer: MemoryLayer;
  content: string;
  importance: number;          // 0-1 重要性分数
  relevance: number;           // 0-1 相关性（动态）
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  accessCount: number;
  tags: string[];
  embedding?: number[];        // 向量（archive 层）
  source?: string;             // 来源：'user' | 'assistant' | 'tool' | 'reflection'
  metadata?: Record<string, unknown>;
}
```

### 2.2 CoreMemory（核心记忆）

```typescript
export interface CoreMemorySection {
  persona: string;             // Agent 角色定义
  userPreferences: Record<string, string>;  // 用户偏好
  currentGoal: string;         // 当前目标
  constraints: string[];       // 约束条件
  contextSummary: string;      // 当前上下文摘要
}
```

### 2.3 MemoryStats（统计）

```typescript
export interface MemoryStats {
  totalItems: number;
  byLayer: Record<MemoryLayer, number>;
  avgImportance: number;
  totalAccesses: number;
  oldestItemAt: number;
  newestItemAt: number;
  cacheHitRate: number;
}
```

---

## 三、核心组件

### 3.1 CoreMemoryStore（核心记忆）

```typescript
export class CoreMemoryStore {
  constructor(initial?: Partial<CoreMemorySection>);
  
  // 读写
  getSection<K extends keyof CoreMemorySection>(section: K): CoreMemorySection[K];
  setSection<K extends keyof CoreMemorySection>(section: K, value: CoreMemorySection[K]): void;
  
  // 用户偏好管理
  setUserPreference(key: string, value: string): void;
  getUserPreference(key: string): string | undefined;
  
  // 目标管理
  setCurrentGoal(goal: string): void;
  
  // 摘要更新
  updateContextSummary(summary: string, maxLength?: number): void;
  
  // 序列化
  toJSON(): CoreMemorySection;
  fromJSON(data: CoreMemorySection): void;
}
```

**容量限制**：
- 每段内容 ≤ 2000 字符
- 用户偏好 ≤ 50 项
- 约束条件 ≤ 20 项

### 3.2 RecallMemoryStore（回忆记忆）

```typescript
export class RecallMemoryStore {
  constructor(options?: RecallMemoryOptions);
  
  // 添加
  add(content: string, options?: { importance?: number; tags?: string[]; source?: string }): string;
  
  // 检索
  search(query: string, options?: { limit?: number; tags?: string[]; minImportance?: number }): MemoryItem[];
  
  // 列出
  list(options?: { sortBy?: 'createdAt' | 'importance' | 'lastAccessedAt'; limit?: number }): MemoryItem[];
  
  // 更新
  update(id: string, updates: Partial<MemoryItem>): boolean;
  
  // 删除
  delete(id: string): boolean;
  clear(): void;
  
  // 容量管理
  evictOldest(count: number): number;  // LRU 淘汰
}
```

**默认配置**：
- 最大容量：500 条
- 全文检索：基于简单关键词匹配
- 排序：按重要性 × 相关性 × 时间衰减

### 3.3 ArchiveMemoryStore（归档记忆）

```typescript
export class ArchiveMemoryStore {
  constructor(options?: ArchiveMemoryOptions);
  
  // 添加（自动 embedding + 索引）
  add(content: string, options?: { importance?: number; tags?: string[] }): Promise<string>;
  
  // 语义检索
  semanticSearch(query: string, options?: { limit?: number; threshold?: number }): Promise<MemoryItem[]>;
  
  // 列出
  list(options?: ListOptions): MemoryItem[];
  
  // 归档（从 recall 迁移）
  archiveFromRecall(item: MemoryItem): Promise<boolean>;
  
  // 持久化
  save(): Promise<void>;
  load(): Promise<void>;
}
```

**特性**：
- 基于 G37-01 RAG 引擎实现向量化
- 索引按日期分区（便于清理）
- 自动备份到 localStorage

### 3.4 MemoryDecayEngine（衰减引擎）

```typescript
export class MemoryDecayEngine {
  constructor(options?: DecayOptions);
  
  // 计算新重要性
  calculateImportance(content: string, options?: ImportanceFactors): number;
  
  // 应用时间衰减
  applyTimeDecay(item: MemoryItem, now?: number): MemoryItem;
  
  // 批量衰减
  decayBatch(items: MemoryItem[]): MemoryItem[];
  
  // 归档阈值判断
  shouldArchive(item: MemoryItem): boolean;
}
```

**重要性算法**（0-1）：
- 基础分：0.3
- 含明确数字/日期：+0.1
- 含强情感词（重要/紧急/必须）：+0.2
- 包含人名/项目名：+0.1
- 长度 > 100 字符：+0.1
- 包含问号：+0.05
- 上限 1.0

**时间衰减公式**：
```
decayed = importance * exp(-lambda * daysSinceLastAccess)
```
- lambda 默认 0.01（即 100 天后衰减到 1/e ≈ 0.37）
- 最近访问会重置时间

**归档阈值**：
- 衰减后重要性 < 0.1 且已存在 7 天
- recall 容量满时按分数淘汰

### 3.5 MemoryConsolidator（记忆整合器）

```typescript
export class MemoryConsolidator {
  constructor(options?: ConsolidatorOptions);
  
  // 整合相似记忆
  async consolidate(items: MemoryItem[]): Promise<MemoryItem[]>;
  
  // 抽象生成（基于 LLM）
  abstract(items: MemoryItem[]): Promise<string>;
  
  // 冲突检测
  detectConflicts(items: MemoryItem[]): Array<{ itemA: MemoryItem; itemB: MemoryItem; conflict: string }>;
}
```

**整合流程**：
1. 基于 embedding 相似度聚类
2. 相似记忆合并为摘要
3. 冲突记忆标记供用户裁决

### 3.6 LongTermMemoryEngine（主类）

```typescript
export class LongTermMemoryEngine {
  constructor(options?: LongTermMemoryOptions);
  
  // 记忆写入
  async remember(content: string, options?: RememberOptions): Promise<string>;
  
  // 记忆检索（跨层）
  async recall(query: string, options?: RecallOptions): Promise<MemoryItem[]>;
  
  // 上下文组装（返回 LLM 可用的上下文）
  async buildContext(query: string, options?: BuildContextOptions): Promise<string>;
  
  // 维护
  async runMaintenance(): Promise<MaintenanceReport>;
  
  // 统计
  getStats(): MemoryStats;
  
  // 持久化
  save(): Promise<void>;
  load(): Promise<void>;
  
  // 事件
  on(event: 'item-added' | 'item-archived' | 'item-evicted' | 'consolidation-done', handler: (data: any) => void): () => void;
}
```

---

## 四、记忆流转

```
新记忆 → Core Memory（关键信息） + Recall Memory（最近 500 条）
              ↓ 时间衰减
        Recall → Archive（重要且 > 7 天）
              ↓ 整合
        Archive 摘要合并 → Core 更新
```

---

## 五、检索策略

### 5.1 三层联合检索

```typescript
async recall(query: string, options?: { layers?: MemoryLayer[]; topK?: number }) {
  const results: MemoryItem[] = [];
  if (options?.layers?.includes('core')) results.push(...searchCore(query));
  if (options?.layers?.includes('recall')) results.push(...searchRecall(query, topK));
  if (options?.layers?.includes('archive')) results.push(...await searchArchive(query, topK));
  return reRank(results, query);  // 跨层重排序
}
```

### 5.2 上下文构建

```typescript
async buildContext(query: string) {
  const core = getCoreContext();           // 总是包含
  const recent = recallRecent(5);          // 最近 5 条
  const relevant = await recall(query, 10); // 语义相关 10 条
  return formatContext(core, recent, relevant);
}
```

---

## 六、性能指标

| 指标 | 目标值 |
|------|--------|
| 写入延迟 | < 50ms |
| 核心检索 | < 5ms |
| 回忆检索 | < 100ms |
| 归档检索 | < 500ms |
| 容量 | Core 2K / Recall 500 / Archive 10K+ |

---

## 七、测试覆盖

| 测试维度 | 覆盖项 |
|---------|--------|
| CoreMemoryStore | 各 section 读写、序列化 |
| RecallMemoryStore | 增删改查、LRU 淘汰、关键词检索 |
| ArchiveMemoryStore | 语义检索、归档迁移、持久化 |
| MemoryDecayEngine | 重要性计算、时间衰减、归档判断 |
| MemoryConsolidator | 相似合并、冲突检测、LLM 抽象 |
| LongTermMemoryEngine | 跨层检索、上下文构建、维护流程 |

**目标测试数**：35+ 单元测试

---

## 八、UI 面板设计

### LongTermMemoryPanel

- **左侧**：核心记忆（可编辑表单：人格/偏好/目标/约束）
- **中部**：回忆记忆列表（按重要性排序）
- **右侧**：归档检索（搜索框 + 结果卡片）
- **底部**：统计图表（容量/命中率/衰减曲线）

---

## 九、修改记录

- 2026-07-31 | v1.0.0 | Cycle 38 G38-02 初次创建
