# Cycle 18 Spec: @ 引用类型扩展（G18-01）

> **任务编号**: G18-01
> **优先级**: P1
> **工作量**: 3 人天
> **负责人**: Hermes AI Agent
> **日期**: 2026-07-29

---

## 一、功能需求

### 1.1 用户场景

用户在 Composer 输入 prompt 时，可使用以下三种新引用：
- `@codebase` - 语义搜索整个代码库（隐式 + 显式）
- `@git` - 引用 git 历史（commits / blame / current changes）
- `@diff` - 引用当前未提交或指定 commit 的 diff

### 1.2 核心需求

1. **@codebase**：
   - 语法：`@codebase:<query>` 或仅 `@codebase`（全量）
   - 解析：调用后端 `/api/search/semantic` 获取 top-K 匹配
   - 注入：将匹配的代码片段（file + snippet）注入 context

2. **@git**：
   - 语法：`@git:log[?file=...]`、`@git:blame?file=...&line=N`、`@git:branch`
   - 解析：调用后端 git API
   - 注入：commit 列表、blame 信息、分支信息

3. **@diff**：
   - 语法：`@diff`（当前未提交）、`@diff:HEAD`、`@diff:<sha>`
   - 解析：解析 unified diff
   - 注入：diff 文本 + 受影响文件列表

---

## 二、技术实现方案

### 2.1 前端：parseReferences 扩展

```typescript
// 现有正则
const REF_PATTERN = /@(file|folder|code|docs|web|File|Folder|Code|Docs|Web):?([^\s,;.]+)/g;

// 扩展为
const REF_PATTERN = /@(file|folder|code|codebase|docs|web|git|diff|File|Folder|Code|Codebase|Docs|Web|Git|Diff):?([^\s,;.]+)?/g;
```

### 2.2 新增 Context 类型

```typescript
// CodebaseContext
export interface CodebaseContext {
  type: 'codebase';
  query: string;
  results: Array<{
    filePath: string;
    snippet: string;
    score: number;
    lineRange?: { start: number; end: number };
  }>;
}

// GitContext
export interface GitContext {
  type: 'git';
  ref: 'log' | 'blame' | 'branch' | 'status';
  filePath?: string;
  line?: number;
  data: any; // 取决于具体 ref
}

// DiffContext
export interface DiffContext {
  type: 'diff';
  ref: 'working' | 'staged' | 'HEAD' | string; // commit SHA
  files: Array<{
    path: string;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      content: string;
    }>;
  }>;
}
```

### 2.3 新增 Resolver

```typescript
// CodebaseResolver
export async function resolveCodebase(
  query: string,
  options: { topK?: number; threshold?: number }
): Promise<CodebaseContext> {
  // 1. 检查 LRU 缓存
  // 2. 调用 /api/search/semantic
  // 3. 解析响应
  // 4. 缓存 + 返回
}

// GitResolver
export async function resolveGit(
  ref: string,
  options: { file?: string; line?: number; limit?: number }
): Promise<GitContext> {
  // 根据 ref 类型调用对应 git API
}

// DiffResolver
export async function resolveDiff(ref: string): Promise<DiffContext> {
  // 调用 /api/git/diff
}
```

### 2.4 后端 API（mock 实现）

由于本项目侧重前端能力，后端 API 暂用 mock：
- `/api/search/semantic` - 返回固定结构（基于 query hash 决定结果）
- `/api/git/history` - 返回模拟 commit 列表
- `/api/git/diff` - 返回模拟 diff

后续可接入真实的向量索引（Qdrant/pgvector）和 Git 服务。

---

## 三、接口设计

### 3.1 parseReferences 扩展接口

```typescript
export interface ParseReferencesOptions {
  resolveCodebase?: (query: string) => Promise<CodebaseContext>;
  resolveGit?: (ref: string, file?: string) => Promise<GitContext>;
  resolveDiff?: (ref: string) => Promise<DiffContext>;
}

export interface ParsedReference {
  type: 'file' | 'folder' | 'symbol' | 'docs' | 'web' | 'codebase' | 'git' | 'diff';
  value: string;
  range: { start: number; end: number };
}

export async function parseReferences(
  prompt: string,
  options?: ParseReferencesOptions
): Promise<{
  references: ParsedReference[];
  resolved: Partial<ComposerContext>;
}>;
```

### 3.2 后端 API（mock）

```
GET /api/search/semantic?query=...&top_k=10
→ { results: [{ file_path, snippet, score, line_range }] }

GET /api/git/history?file=...&limit=20
→ { commits: [{ sha, message, author, date, files }] }

GET /api/git/diff?ref=working|HEAD|<sha>
→ { files: [{ path, hunks: [...] }] }
```

---

## 四、数据结构

### 4.1 ComposerContext 扩展

```typescript
export interface ComposerContext {
  files: FileContext[];
  folders: FolderContext[];
  symbols: SymbolContext[];
  docs: DocContext[];
  web: WebContext[];
  codebase: CodebaseContext[];  // 新增
  git: GitContext[];            // 新增
  diff: DiffContext[];          // 新增
}
```

### 4.2 Prompt 注入格式

```
[codebase results for "user authentication"]
- src/auth/UserService.ts:42-58 (score: 0.92)
  ```ts
  async function authenticate(user) { ... }
  ```
- src/middleware/auth.ts:15-30 (score: 0.85)
  ```ts
  export const authMiddleware = ... 
  ```

[git log for src/auth/UserService.ts (last 5)]
- abc1234 (2026-07-15) Fix null check in authenticate
- def5678 (2026-07-10) Add JWT support

[working diff]
- src/auth/UserService.ts
  @@ -42,6 +42,10 @@
  + const token = generateToken(user);
```

---

## 五、性能与安全要求

### 5.1 性能
- 单个 @ 引用解析 ≤ 200ms（含网络）
- 总解析时间 ≤ 1s（所有引用并发）
- LRU 缓存命中率 ≥ 60%

### 5.2 安全
- @codebase 注入时过滤敏感路径（.env / .ssh / 凭据）
- @git 不暴露敏感信息（邮箱/密钥/内部地址）
- @diff 限制最大行数（防止 prompt 注入爆炸）

### 5.3 错误处理
- 网络失败时降级为"无结果"+ UI 提示
- 解析失败时跳过该引用，不影响其他引用
- 缓存失败时降级为直连

---

## 六、验收标准

### 6.1 功能测试

- [ ] 单元测试 ≥ 12 个
  - parseReferences 正则扩展（4 个）
  - CodebaseResolver（3 个）
  - GitResolver（3 个）
  - DiffResolver（2 个）
- [ ] 集成测试 ≥ 4 个（端到端引用解析 + 注入）
- [ ] E2E 断言 ≥ 8 个

### 6.2 UI 测试

- [ ] 引用提示显示正确（包含类型图标）
- [ ] 解析失败有降级 UI
- [ ] 加载状态可视化

### 6.3 性能测试

- [ ] 100 个引用解析 ≤ 5s
- [ ] LRU 缓存命中后 ≤ 10ms

### 6.4 验收条件

- 所有测试通过率 100%
- TypeScript 编译 0 错误
- Composer 集成测试 100% 通过

---

**Spec 完成日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 实现 frontend/src/utils/referenceResolvers.ts + 更新 composerEngine.ts
