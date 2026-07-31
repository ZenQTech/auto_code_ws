# Cycle 24 SPEC: Global Memory 跨会话记忆引擎

## 概述

实现一个**跨会话持久化记忆引擎**，让 Loop Engineering 工作流中的所有 AI 行为（需求澄清、架构决策、用户偏好、工具调用历史、模型评分等）能够跨会话/跨 cycle 保留与检索。

## 设计目标

1. **跨会话**：用户在新建会话时，引擎自动加载历史偏好和上下文
2. **跨 cycle**：在多个 vibe coding cycle 之间保持累积学习效果
3. **可检索**：基于关键词/语义/标签的快速检索
4. **可遗忘**：支持 TTL / 显式删除 / 自动压缩
5. **可分享**：支持记忆导出/导入（便于团队协作和设备迁移）

## 核心功能

### 1. 记忆类型 (Memory Types)

| 类型 | 描述 | 例子 |
|------|------|------|
| `preference` | 用户偏好 | "用户偏好 TypeScript 严格模式" |
| `decision` | 决策记录 | "Cycle 23 选择加权平均算法" |
| `fact` | 事实信息 | "项目使用 FastAPI + SQLAlchemy" |
| `context` | 上下文片段 | "用户正在做 v6.55 版本开发" |
| `feedback` | 反馈记录 | "上次 UI 调整用户给了负面反馈" |
| `rule` | 规则 | "所有新代码必须有单元测试" |

### 2. 数据结构

```typescript
interface GlobalMemoryEntry {
  id: string;                // 唯一 ID
  type: MemoryType;          // 记忆类型
  content: string;           // 记忆内容
  tags: string[];            // 标签
  scope: 'user' | 'project' | 'cycle';  // 作用范围
  projectId?: string;        // 项目 ID（project 范围时）
  cycleId?: string;          // Cycle ID（cycle 范围时）
  metadata: Record<string, unknown>;  // 自定义元数据
  createdAt: number;         // 创建时间
  updatedAt: number;         // 更新时间
  expiresAt?: number;        // 过期时间
  accessCount: number;       // 访问次数（用于重要性评分）
  importance: number;        // 重要性评分 0-1
}

interface GlobalMemoryConfig {
  maxEntries: number;        // 最大记忆条数（默认 1000）
  defaultTtlMs: number;      // 默认 TTL（0 表示永不过期）
  autoCompress: boolean;     // 是否自动压缩
  compressionThreshold: number;  // 触发压缩的条数
  storageBackend: 'localStorage' | 'indexedDB' | 'memory';
}

interface MemoryQuery {
  query?: string;            // 关键词/语义
  types?: MemoryType[];      // 类型过滤
  tags?: string[];           // 标签过滤
  scope?: 'user' | 'project' | 'cycle';
  projectId?: string;
  cycleId?: string;
  minImportance?: number;    // 最小重要性
  limit?: number;            // 最大返回数
  sortBy?: 'relevance' | 'recency' | 'importance' | 'accessCount';
}
```

### 3. 核心 API

```typescript
class GlobalMemoryEngine {
  // 写入
  remember(input: Omit<GlobalMemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>): GlobalMemoryEntry;
  rememberMany(inputs: ...): GlobalMemoryEntry[];

  // 读取
  recall(query: MemoryQuery): GlobalMemoryEntry[];
  recallById(id: string): GlobalMemoryEntry | null;
  recallByType(type: MemoryType, limit?: number): GlobalMemoryEntry[];

  // 更新
  update(id: string, patch: Partial<GlobalMemoryEntry>): GlobalMemoryEntry | null;
  boostImportance(id: string, delta: number): void;  // 访问即增加重要性
  touchAccess(id: string): void;

  // 删除
  forget(id: string): boolean;
  forgetMany(ids: string[]): number;
  forgetByQuery(query: MemoryQuery): number;
  clear(scope?: 'user' | 'project' | 'cycle'): number;

  // 压缩
  compress(): { merged: number; removed: number };
  autoCompressIfNeeded(): boolean;

  // 导入导出
  export(format: 'json' | 'markdown', scope?: string): string;
  import(data: string, format: 'json' | 'markdown'): number;

  // 统计
  getStats(): GlobalMemoryStats;
  getConfig(): GlobalMemoryConfig;
  updateConfig(patch: Partial<GlobalMemoryConfig>): void;

  // 事件
  on(type: GlobalMemoryEventType, handler: Function): () => void;
}
```

### 4. UI 面板（GlobalMemoryPanel）

布局：
- **Header**：标题 + 统计 + 导入/导出/压缩/清空按钮
- **Search Bar**：搜索框 + 类型过滤 + 标签过滤 + 范围过滤
- **Memory List**：按时间/重要性排序的卡片列表
- **Memory Detail**：右侧抽屉显示完整内容和元数据

功能：
- 创建/编辑/删除记忆
- 批量操作
- 标签管理
- 重要性滑块调节
- 快速操作（"提升重要性"、"延长 TTL"、"复制内容"）

## 验收标准

### 功能验收
- [ ] 支持 6 种记忆类型的写入和检索
- [ ] 支持 3 种作用范围（user/project/cycle）的隔离
- [ ] 支持 4 种排序方式（relevance/recency/importance/accessCount）
- [ ] 支持 6 种事件订阅（created/updated/deleted/accessed/expired/compressed）
- [ ] 记忆超过 maxEntries 时自动 FIFO 清理
- [ ] 记忆过期自动清理
- [ ] 压缩时合并相似记忆（基于标签 + 关键词重叠度）
- [ ] 支持 JSON / Markdown 格式导入导出
- [ ] 持久化到 localStorage（默认）/ IndexedDB（可选）

### 性能验收
- 1000 条记忆下，recall 查询 < 50ms
- 压缩操作 < 200ms
- 启动加载 < 100ms

### 兼容性验收
- TypeScript 0 错误
- 全量测试套件 100% 通过
- 与现有 useMemory hook 无冲突

## 实施计划

1. **Phase 1**：核心引擎 `frontend/src/utils/globalMemory.ts` + 类型定义
2. **Phase 2**：单元测试 `frontend/src/utils/globalMemory.test.ts`（~40 测试）
3. **Phase 3**：UI 面板 `frontend/src/components/GlobalMemoryPanel.tsx` + 组件测试
4. **Phase 4**：集成到 App.tsx + BrandHeader 菜单项
5. **Phase 5**：E2E 测试 `tests/test_e2e_cycle24.sh`
6. **Phase 6**：文档 `CYCLE24_SUMMARY.md` + Git 提交

## 与现有功能集成

- **useMemory hook**：扩展为调用 GlobalMemoryEngine
- **AgentContext**：从 GlobalMemory 注入项目级上下文
- **Loop Engineering**：每个 cycle 结束时自动存储关键决策
- **CandidateLearningEngine**：在推荐时考虑用户的记忆偏好

---

**创建日期**: 2026-07-29
**负责 Agent**: Hermes AI Agent
**目标 Cycle**: Cycle 24 P0-1
