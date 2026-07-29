# Cycle 20 G20-06: Multi-repo Environment - 技术规范

> **任务编号**: G20-06
> **优先级**: P1 (应做)
> **日期**: 2026-07-29
> **基于**: [CYCLE20_GAP_ANALYSIS.md](./CYCLE20_GAP_ANALYSIS.md)
> **负责人**: Hermes AI Agent

---

## 一、需求背景

### 1.1 问题

- 缺少多仓库协同工作能力
- Cursor 3.0 支持多 Repo 环境
- Trae Work 也支持

### 1.2 目标

- 多仓库切换 UI
- 跨仓库搜索
- 统一上下文管理
- 仓库组配置

---

## 二、核心数据结构

### 2.1 RepoInfo

```typescript
export interface RepoInfo {
  id: string;
  name: string;
  path: string;
  url?: string;
  branch: string;
  type: 'git' | 'local' | 'remote';
  lastUsedAt: number;
  /** 关联的标签 */
  tags: string[];
  /** 仓库组 ID */
  groupId?: string;
}

export interface RepoGroup {
  id: string;
  name: string;
  description?: string;
  repos: string[]; // repo IDs
  createdAt: number;
}
```

---

## 三、核心 API

### 3.1 MultiRepoManager

```typescript
export class MultiRepoManager {
  private repos: Map<string, RepoInfo> = new Map();
  private groups: Map<string, RepoGroup> = new Map();
  private activeRepoIds: Set<string> = new Set();
  private readonly eventBus: RepoEventBus = new RepoEventBus();

  addRepo(repo: RepoInfo): void;
  removeRepo(id: string): void;
  listRepos(filter?: RepoFilter): RepoInfo[];
  getRepo(id: string): RepoInfo | null;

  createGroup(group: Omit<RepoGroup, 'id' | 'createdAt'>): RepoGroup;
  addToGroup(groupId: string, repoId: string): void;
  removeFromGroup(groupId: string, repoId: string): void;
  listGroups(): RepoGroup[];

  activateRepo(id: string): void;
  deactivateRepo(id: string): void;
  getActiveRepos(): RepoInfo[];

  /** 跨仓库搜索 */
  search(query: string, options?: SearchOptions): SearchResult[];

  /** 统一上下文 */
  getUnifiedContext(options?: ContextOptions): UnifiedContext;

  on(event: RepoEventType, handler: RepoEventHandler): () => void;
}
```

---

## 四、UI 组件

### 4.1 RepoSwitcher

- 仓库下拉选择
- 多选激活
- 仓库组快速切换
- 添加新仓库

### 4.2 MultiRepoPanel

- 已激活仓库列表
- 仓库组管理
- 跨仓库搜索框
- 搜索结果展示

### 4.3 RepoCard

- 仓库名称 + 分支
- 标签
- 最后使用时间
- 快速操作：切换/移除

### 4.4 CrossRepoSearch

- 跨仓库全文搜索
- 按文件类型过滤
- 按仓库过滤
- 实时结果

---

## 五、测试要求

### 5.1 单元测试 (35+)

- addRepo / removeRepo / listRepos
- createGroup / addToGroup
- activateRepo / deactivateRepo
- search 跨仓库搜索
- getUnifiedContext
- 持久化

### 5.2 集成测试 (25+)

- RepoSwitcher 渲染
- MultiRepoPanel 交互
- CrossRepoSearch 结果展示
- 与 Composer 集成

### 5.3 E2E 测试 (20+ 断言)

- 多仓库添加/删除
- 仓库组创建
- 跨仓库搜索
- 统一上下文

---

## 六、文件清单

- `frontend/src/utils/multiRepoManager.ts` (500 行)
- `frontend/src/utils/multiRepoManager.test.ts` (300 行)
- `frontend/src/components/RepoSwitcher.tsx` (250 行)
- `frontend/src/components/RepoSwitcher.test.tsx` (150 行)
- `frontend/src/components/MultiRepoPanel.tsx` (350 行)
- `frontend/src/components/MultiRepoPanel.test.tsx` (200 行)
- `frontend/src/components/CrossRepoSearch.tsx` (250 行)
- `frontend/src/components/CrossRepoSearch.test.tsx` (150 行)

---

## 七、验收标准

- ✅ 多仓库管理
- ✅ 跨仓库搜索
- ✅ 统一上下文
- ✅ 仓库组配置
- ✅ 单元测试 35+ 100% 通过
- ✅ 集成测试 25+ 100% 通过
- ✅ E2E 断言 20+ 100% 通过
- ✅ TypeScript 编译 0 错误
- ✅ Loop Engineering 工作流无回归

---

**SPEC 完成**: 2026-07-29 15:05
