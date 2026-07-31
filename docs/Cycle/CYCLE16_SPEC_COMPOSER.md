# CYCLE 16 SPEC - Multi-File Composer 模式

> **任务**: P0-1 实现 Cursor Composer 风格的多文件协调编辑
> **版本**: v6.36.0
> **日期**: 2026-07-29
> **状态**: 🚧 实现中

---

## 1. 功能需求

### 1.1 核心能力
- **多文件协调编辑**：单次编辑涉及 N 个文件，Composer 一次性生成所有 diff
- **@ 引用上下文**：@File / @Folder / @Code / @Docs / @Web 引用语法
- **逐文件 Diff 审查**：每文件独立 Accept / Reject
- **跨文件 Undo/Redo**：撤销/重做跨越多文件
- **检查点快照**：编辑前自动保存，失败可一键回滚

### 1.2 用户场景
1. **跨文件重构**：重命名类型字段，Composer 列出所有引用并生成 diff
2. **批量更新模式**：把所有 fetch 换成 apiClient，逐个文件 diff 展示
3. **添加新功能**：跨多文件添加用户角色系统
4. **类型字段传播**：更新接口定义，波及所有调用方

### 1.3 验收标准
- Cmd+I（或 Ctrl+I）快捷键打开 Composer
- @File / @Folder / @Code 引用语法
- 多文件 diff 列表同时展示
- 每文件独立 Accept / Reject / Reject with feedback
- 跨文件 Undo/Redo 集成
- 30 个单元测试 + 10 E2E 全部通过

---

## 2. 技术实现方案

### 2.1 架构

```
┌─────────────────────────────────────────────────┐
│           ComposerPanel (UI)                    │
│  ┌──────────────┐  ┌──────────────────────┐    │
│  │ Context Bar  │  │ @File @Folder @Code │    │
│  └──────────────┘  └──────────────────────┘    │
│  ┌────────────────────────────────────────┐    │
│  │ Input: 描述改动                        │    │
│  └────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────┐    │
│  │ FileDiffList:                          │    │
│  │  [file1.tsx] [Accept] [Reject] [Edit]  │    │
│  │  [file2.tsx] [Accept] [Reject] [Edit]  │    │
│  └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│          ComposerEngine                         │
│  - parseContextRefs (@ refs)                   │
│  - planEdits (file list)                       │
│  - generateDiffs (per file)                    │
│  - applyEdits                                   │
│  - checkpoint / rollback                       │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│          CodebaseIndexer                        │
│  - file index                                  │
│  - symbol search                               │
│  - call graph                                  │
│  - reference finder                            │
└─────────────────────────────────────────────────┘
```

### 2.2 数据模型

```typescript
// Composer 上下文
interface ComposerContext {
  files: FileContext[];
  folders: FolderContext[];
  symbols: SymbolContext[];
  docs: DocContext[];
}

interface FileContext {
  path: string;
  content: string;
  language: string;
}

interface ComposerEdit {
  id: string;
  filePath: string;
  beforeContent: string;
  afterContent: string;
  description: string;
  status: 'pending' | 'accepted' | 'rejected' | 'modified';
  feedback?: string;
}

interface ComposerSession {
  id: string;
  prompt: string;
  context: ComposerContext;
  edits: ComposerEdit[];
  checkpoint: Snapshot;
  createdAt: number;
  updatedAt: number;
}

interface Snapshot {
  id: string;
  files: Map<string, string>;  // path -> content
  timestamp: number;
  description: string;
}
```

### 2.3 核心 API

```typescript
class ComposerEngine {
  // 解析 @ 引用
  parseContext(prompt: string): ComposerContext;

  // 生成编辑计划
  plan(prompt: string, context: ComposerContext): Promise<ComposerEdit[]>;

  // 应用单个编辑
  applyEdit(edit: ComposerEdit): Promise<void>;

  // 拒绝编辑
  rejectEdit(editId: string, feedback?: string): Promise<void>;

  // 创建检查点
  createCheckpoint(description: string): Snapshot;

  // 回滚
  rollback(snapshotId: string): Promise<void>;

  // 获取当前 session
  getSession(): ComposerSession;
}
```

### 2.4 状态管理

使用 Zustand 或 React Context 存储：
- 当前 session
- 选中 edits
- 上下文引用
- 快照栈

### 2.5 UI 设计

#### 2.5.1 快捷键
- `Cmd/Ctrl + I`: 打开/关闭 Composer
- `Cmd/Ctrl + Shift + I`: 全屏模式
- `Cmd/Ctrl + Enter`: 提交
- `Cmd/Ctrl + Backspace`: 拒绝当前文件
- `Cmd/Ctrl + Shift + Enter`: 接受当前文件
- `Esc`: 关闭

#### 2.5.2 视觉设计
- 右侧浮动面板（与 Cursor 一致）
- 深色玻璃态背景
- 文件 diff 行级高亮
- 操作按钮 hover 提示

---

## 3. 接口设计

### 3.1 Hook API

```typescript
const {
  // 状态
  isOpen,
  session,
  currentEdits,
  context,
  snapshots,

  // 操作
  open,
  close,
  addContext,
  removeContext,
  submit,
  acceptEdit,
  rejectEdit,
  acceptAll,
  rejectAll,
  rollback,
  undo,
  redo,
} = useComposer();
```

### 3.2 组件 API

```tsx
<ComposerProvider>
  <ComposerPanel
    open={isOpen}
    onClose={close}
    onSubmit={submit}
  />
</ComposerProvider>
```

---

## 4. 数据结构

### 4.1 上下文条目

```typescript
type ContextEntry =
  | { type: 'file'; path: string; content: string }
  | { type: 'folder'; path: string; recursive: boolean }
  | { type: 'symbol'; name: string; kind: 'function' | 'class' | 'variable' }
  | { type: 'docs'; url: string; content: string }
  | { type: 'web'; query: string; results: WebResult[] };
```

### 4.2 编辑条目

```typescript
interface ComposerEdit {
  id: string;
  filePath: string;
  beforeContent: string;
  afterContent: string;
  diff: DiffSegment[];  // 复用 diff.ts
  description: string;
  status: EditStatus;
  createdAt: number;
  appliedAt?: number;
}

type EditStatus = 'pending' | 'accepted' | 'rejected' | 'modified';
```

---

## 5. 性能与安全要求

### 5.1 性能
- 解析 @ 引用：<10ms
- 加载文件：<100ms / 文件
- 生成 diff：<500ms / 文件
- 接受编辑：<200ms / 文件
- 回滚：<500ms

### 5.2 安全
- 文件路径白名单（仅允许工作区内的文件）
- 编辑大小限制（单文件 < 1MB）
- 检查点大小限制（总 < 50MB）
- 危险路径黑名单（.git, node_modules 等）

---

## 6. 验收测试

### 6.1 单元测试（30 个）
- ComposerEngine 基础 API（10）
- 上下文解析（@ 引用）（5）
- 快照创建与回滚（5）
- 状态管理（5）
- UI 组件（5）

### 6.2 E2E 测试（10 个）
- 打开/关闭 Composer
- 添加 @File 引用
- 提交任务生成多文件 diff
- 逐文件接受/拒绝
- 一键接受全部
- 跨文件 Undo/Redo
- 检查点回滚
- 全屏模式
- 快捷键测试
- 大文件边界测试

### 6.3 性能基准
- 解析 10 个 @ 引用 < 50ms
- 加载 100 个文件 < 5s
- 生成 10 文件 diff < 3s
- 接受 10 个编辑 < 2s

---

**Spec 完成时间**: 2026-07-29 10:40
**实现状态**: P0-1 准备中
