# CYCLE 15 - UI/UX 优化 Spec #3: 技术实现

> **文档版本**: v1.0.0
> **创建日期**: 2026-07-29
> **适用范围**: Hermes 智能体调度平台全部 3 个 frontend 项目
> **依赖**: [CYCLE15_SPEC_VISUAL.md](./CYCLE15_SPEC_VISUAL.md), [CYCLE15_SPEC_INTERACTION.md](./CYCLE15_SPEC_INTERACTION.md)
> **状态**: ✅ 待 Phase 3 实施

---

## 1. 技术栈与依赖

### 1.1 现有依赖（保留）

| 依赖 | 版本 | 用途 |
|------|------|------|
| react | 18.3.1 | UI 框架 |
| react-dom | 18.3.1 | DOM 渲染 |
| react-router-dom | 6.x | 路由 |
| @monaco-editor/react | 4.7.0 | 代码编辑器 |

### 1.2 新增依赖（Phase 3 实施）

| 依赖 | 版本 | 用途 | 优先级 |
|------|------|------|--------|
| shiki | ^1.0.0 | 代码高亮 | P0 |
| diff-match-patch | ^1.0.5 | 词级 diff | P0 |
| @tanstack/react-virtual | ^3.0.0 | 虚拟列表 | P0 |
| vitest | ^1.0.0 | 单元测试 | P0 |
| @testing-library/react | ^14.0.0 | 组件测试 | P0 |
| @testing-library/user-event | ^14.0.0 | 用户交互测试 | P0 |
| @playwright/test | ^1.40.0 | E2E 测试 | P1 |
| idb-keyval | ^6.2.0 | indexedDB 封装 | P1 |
| cmdk | ^0.2.0 | 命令面板 (Cmd+K) | P1 |
| react-hotkeys-hook | ^4.0.0 | 快捷键管理 | P1 |
| fuse.js | ^7.0.0 | fuzzy 搜索 | P1 |
| framer-motion | ^11.0.0 | 动效（可选） | P2 |

### 1.3 依赖版本统一规范

```json
{
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-router-dom": "^6.26.0",
    "@monaco-editor/react": "^4.7.0",
    "shiki": "^1.22.0",
    "diff-match-patch": "^1.0.5",
    "@tanstack/react-virtual": "^3.10.0",
    "idb-keyval": "^6.2.1",
    "cmdk": "^0.2.1",
    "react-hotkeys-hook": "^4.5.0",
    "fuse.js": "^7.0.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "@testing-library/react": "^14.3.0",
    "@testing-library/user-event": "^14.5.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@playwright/test": "^1.48.0",
    "happy-dom": "^15.0.0",
    "@vitest/coverage-v8": "^1.6.0"
  }
}
```

---

## 2. 组件重构计划

### 2.1 App.tsx 拆分策略（2303 → 800 行）

#### 当前问题
- 30+ useState
- 22+ props 透传（4 层）
- 23 个 panel 显隐逻辑散落
- 4 个工作流进度组件条件渲染

#### 拆分方案

```
src/
├── App.tsx (800)                  # 主路由 + 顶层 Provider
├── providers/
│   ├── AppStateProvider.tsx       # useReducer 集中状态 (300)
│   ├── ThemeProvider.tsx          # 主题切换 (100)
│   ├── ToastProvider.tsx          # Toast 全局 (150)
│   └── ShortcutProvider.tsx       # 快捷键全局 (100)
├── hooks/
│   ├── useAppState.ts             # 全局状态访问 (50)
│   ├── useModals.ts               # 23 panel 合并 useReducer (150)
│   └── useUndoStack.ts            # indexedDB Undo Stack (200)
└── components/
    ├── AppLayout.tsx (400)        # 布局容器
    ├── ChatView.tsx (300)         # 消息流
    └── ...
```

#### useReducer 设计

```typescript
// AppState 类型
type AppState = {
  // 主题
  theme: 'light' | 'dark' | 'highContrast';
  colorBlindMode: boolean;
  reducedMotion: boolean;

  // 模态
  modals: {
    settings: boolean;
    diffView: boolean;
    planEditor: boolean;
    clarification: boolean;
    architecture: boolean;
    // ... 23 个
  };

  // 当前项目
  currentProject: Project | null;

  // 工作流
  workflow: {
    status: 'idle' | 'running' | 'paused' | 'tool-calling' | 'failed' | 'cancelled' | 'completed';
    currentStep: number;
    totalSteps: number;
    startedAt: number | null;
  };

  // 撤销栈
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  // 偏好
  preferences: {
    model: string;
    reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  };
};

// Action 类型
type AppAction =
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'TOGGLE_MODAL'; modal: keyof AppState['modals']; open: boolean }
  | { type: 'SET_WORKFLOW_STATUS'; status: WorkflowStatus }
  | { type: 'PUSH_UNDO'; entry: UndoEntry }
  | { type: 'POP_UNDO' }
  | { type: 'UPDATE_PREFERENCES'; preferences: Partial<Preferences> }
  // ... 其他 action
```

#### Context 划分

- **AppStateContext**: 全局应用状态（reducer + dispatch）
- **ThemeContext**: 主题相关（轻量，独立）
- **ToastContext**: Toast 队列（独立）
- **ShortcutContext**: 快捷键注册（独立）

避免一个大 Context 包含所有状态。

### 2.2 组件合并计划

| 重复组件 | 处理方案 | 影响范围 |
|---------|---------|---------|
| 4 处 ✕ 关闭按钮 | 抽 `<CloseButton />` | McpPanel / CompactionPanel / SkillsPanel / AgentsMdPanel |
| 4 处流程面板 | 抽 `<WorkflowStepPanel />` | PlanViewer / ClarificationModal / ArchitectureDesignModal / LoopV7Runner |
| 3 处 Loading | 抽 `<Loading variant="spinner\|skeleton\|progress\|pulse" />` | 全部 |
| 2 处 ErrorBoundary | 抽 `<ErrorBoundary fallback={...} />` | 全部 |

### 2.3 新增组件清单

#### 设计系统组件（P0）
- `<Button variant="primary\|secondary\|ghost\|danger" size="xs\|sm\|md\|lg\|xl" />`
- `<Input state="default\|error\|success" />`
- `<Card />`
- `<Modal type="alert\|confirm\|prompt\|dialog" />`
- `<Drawer position="left\|right\|top\|bottom" />`
- `<Toast type="success\|info\|warning\|error\|loading" />`
- `<Tag color="..." />`
- `<Spinner />` / `<Skeleton />` / `<ProgressBar />` / `<Pulse />`

#### 业务组件（P0-P1）
- `<DiffView mode="line\|word\|char" view="unified\|split" colorBlind={boolean} />`
- `<ThinkingBlock phase="analysis\|design\|coding\|validation" typewriter={boolean} />`
- `<WorkflowIndicator status="..." currentStep={n} totalSteps={n} />`
- `<CodeEditor language="..." value={...} onChange={...} />` (Shiki 包装)
- `<MessageBubble actions={[...]} onAction={...} />` (修复 4 个无功能按钮)
- `<CommandPalette items={[...]} />` (Cmd+K)
- `<Timeline entries={[...]} onSelect={...} />` (回退时间线)
- `<UndoToast action={...} />` (撤销按钮)

---

## 3. 状态管理优化

### 3.1 现状问题

- 30+ useState 在 App.tsx
- 23 个 panel 显隐独立 state（每次切换都触发重渲染）
- 多个 useRef 散落

### 3.2 优化方案

#### 方案 1: useReducer + Context（推荐）

```typescript
// 使用 useReducer 集中管理
const [state, dispatch] = useReducer(appReducer, initialState);

// 通过 Context 暴露
<AppStateContext.Provider value={{ state, dispatch }}>
  ...
</AppStateContext.Provider>

// 子组件使用
const { state, dispatch } = useAppState();
dispatch({ type: 'TOGGLE_MODAL', modal: 'settings', open: true });
```

**优势**:
- 零依赖
- 集中管理
- 易于测试（pure reducer）

#### 方案 2: Zustand（备选）

```typescript
import { create } from 'zustand';

const useAppStore = create<AppState>((set) => ({
  theme: 'light',
  toggleModal: (modal, open) => set((s) => ({ modals: { ...s.modals, [modal]: open } })),
  // ...
}));
```

**优势**:
- API 现代化
- 性能更好（默认 shallow compare）

**决策**: 选择 **方案 1（useReducer + Context）**（零依赖，符合项目「依赖极简」原则）

### 3.3 useModals 重构

#### 旧实现
```typescript
const [showSettings, setShowSettings] = useState(false);
const [showDiff, setShowDiff] = useState(false);
const [showPlan, setShowPlan] = useState(false);
// ... 20+ 个 useState
```

#### 新实现
```typescript
type ModalKey = 'settings' | 'diffView' | 'planEditor' | /* ... */;

const useModals = () => {
  const [modals, setModals] = useState<Record<ModalKey, boolean>>({} as any);
  const open = useCallback((key: ModalKey) => setModals(m => ({ ...m, [key]: true })), []);
  const close = useCallback((key: ModalKey) => setModals(m => ({ ...m, [key]: false })), []);
  const toggle = useCallback((key: ModalKey) => setModals(m => ({ ...m, [key]: !m[key] })), []);
  return { modals, open, close, toggle };
};
```

**性能优化**:
- 用单个 state 对象替代 23 个独立 state
- 减少 90% 重渲染
- 子组件通过 `useModal('settings')` 单独订阅

### 3.4 派生状态计算

#### useMemo 替代重复计算

```typescript
// 旧：每次渲染都计算
const totalTokens = messages.reduce((sum, m) => sum + m.tokens, 0);

// 新：useMemo 缓存
const totalTokens = useMemo(
  () => messages.reduce((sum, m) => sum + m.tokens, 0),
  [messages]
);
```

#### 选择器模式

```typescript
// 自定义 hook 封装常用选择器
export const useCurrentProject = () => {
  const { state } = useAppState();
  return useMemo(() => state.currentProject, [state.currentProject]);
};

export const useWorkflowStatus = () => {
  const { state } = useAppState();
  return state.workflow.status;
};
```

---

## 4. 渲染性能优化

### 4.1 虚拟列表（10K+ 消息性能提升 10x）

#### 引入
```bash
npm install @tanstack/react-virtual
```

#### 应用场景
- **消息列表** (`<ChatView />`)
- **会话列表** (`<Sidebar />`)
- **文件树** (`<FileExplorer />`)
- **历史时间线** (`<Timeline />`)

#### 实现示例

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

const MessageList = ({ messages }: { messages: Message[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,  // 估算行高
    overscan: 10,            // 预渲染数量
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MessageBubble message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
};
```

**性能指标**:
- 1K 消息：首屏 < 100ms，滚动 60fps
- 10K 消息：首屏 < 200ms，滚动 60fps
- 100K 消息：首屏 < 500ms，滚动 60fps

### 4.2 React.memo 与 useCallback

#### MessageBubble memo

```typescript
export const MessageBubble = React.memo<MessageBubbleProps>(({ message, onAction }) => {
  // ...
}, (prevProps, nextProps) => {
  return prevProps.message.id === nextProps.message.id
    && prevProps.message.content === nextProps.message.content
    && prevProps.message.status === nextProps.message.status;
});
```

#### 回调 useCallback

```typescript
const handleAction = useCallback((action: string) => {
  // ...
}, [/* deps */]);

// 传递给子组件
<MessageBubble onAction={handleAction} />
```

### 4.3 Monaco Editor 优化

#### 主包预加载 + Workers Lazy

```typescript
// main.tsx
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

// 配置 workers 路径
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker', import.meta.url));
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker', import.meta.url));
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker', import.meta.url));
    }
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker', import.meta.url));
    }
    return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url));
  },
};

loader.config({ monaco });
```

#### 路由级懒加载

```typescript
// CodeViewer.tsx
import { lazy, Suspense } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

export const CodeViewer = (props) => (
  <Suspense fallback={<Skeleton />}>
    <MonacoEditor {...props} />
  </Suspense>
);
```

**性能效果**:
- 首屏 bundle: 10MB → 3MB (-70%)
- 首屏加载: 5s → 1.5s (-70%)
- 编辑器打开: 0ms → 200ms (可接受)

### 4.4 Web Worker 化重计算

#### 应用场景
- **大文件 diff 计算**: diff-match-patch 移到 Worker
- **Shiki 高亮**: 服务端预编译，运行时零负担
- **AST 解析**: 影响函数分析

#### 实现示例

```typescript
// diffWorker.ts
self.onmessage = (e) => {
  const { oldText, newText } = e.data;
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);
  self.postMessage(diffs);
};

// 调用
const worker = new Worker(new URL('./diffWorker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ oldText, newText });
worker.onmessage = (e) => setDiff(e.data);
```

### 4.5 防抖与节流

#### 输入防抖（200ms）

```typescript
import { useDebouncedValue } from './hooks/useDebouncedValue';

const [query, setQuery] = useState('');
const debouncedQuery = useDebouncedValue(query, 200);

useEffect(() => {
  // 搜索
  search(debouncedQuery);
}, [debouncedQuery]);
```

#### 滚动节流（rAF）

```typescript
const handleScroll = useCallback(() => {
  requestAnimationFrame(() => {
    // 滚动逻辑
  });
}, []);
```

---

## 5. 状态机扩展（7 态）

### 5.1 状态定义

```typescript
type WorkflowStatus =
  | 'idle'           // 空闲
  | 'running'        // 运行中
  | 'paused'         // 暂停
  | 'tool-calling'   // 工具调用
  | 'failed'         // 失败
  | 'cancelled'      // 取消
  | 'completed';     // 完成

type WorkflowState = {
  status: WorkflowStatus;
  currentStep: number;
  totalSteps: number;
  startedAt: number | null;
  pausedAt: number | null;
  error: string | null;
  toolName: string | null;  // 当前工具调用
};
```

### 5.2 状态机图

```
              ┌──────────────────────────────────┐
              │                                  │
              ▼                                  │
[idle] ──启动──> [running] ──完成──> [completed] │
                  │  │  │                        │
                  │  │  └─失败──> [failed]       │
                  │  │                           │
                  │  └─取消──> [cancelled]       │
                  │                              │
                  ├──暂停──> [paused] ──恢复──┐   │
                  │                          │   │
                  └─工具调用──> [tool-calling]──┘
                                       │
                                       └─失败──> [failed]
```

### 5.3 状态转换实现

```typescript
class WorkflowMachine {
  private state: WorkflowState = { status: 'idle', /* ... */ };

  transition(action: WorkflowAction): WorkflowState {
    const next = this.nextState(this.state, action);
    if (!this.isValidTransition(this.state.status, next.status)) {
      throw new Error(`Invalid transition: ${this.state.status} -> ${next.status}`);
    }
    this.state = next;
    return this.state;
  }

  private isValidTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
    const validTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
      idle: ['running'],
      running: ['paused', 'tool-calling', 'completed', 'failed', 'cancelled'],
      paused: ['running', 'cancelled'],
      'tool-calling': ['running', 'failed'],
      failed: ['idle'],
      cancelled: ['idle'],
      completed: ['idle'],
    };
    return validTransitions[from].includes(to);
  }
}
```

### 5.4 UI 同步

```typescript
const WorkflowIndicator = () => {
  const status = useWorkflowStatus();
  const config = {
    idle: { color: 'gray', icon: '○', label: '空闲' },
    running: { color: 'blue', icon: '●', label: '运行中' },
    paused: { color: 'orange', icon: '⏸', label: '已暂停' },
    'tool-calling': { color: 'purple', icon: '🔧', label: '工具调用' },
    failed: { color: 'red', icon: '✕', label: '失败' },
    cancelled: { color: 'gray', icon: '⊘', label: '已取消' },
    completed: { color: 'green', icon: '✓', label: '已完成' },
  }[status];

  return (
    <div className={`flex items-center gap-2 text-${config.color}-500`}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </div>
  );
};
```

---

## 6. 撤销栈（Undo Stack）实现

### 6.1 数据结构

```typescript
type UndoEntry = {
  id: string;                    // UUID
  timestamp: number;             // 时间戳
  type: 'create' | 'update' | 'delete' | 'rollback';
  description: string;           // "创建项目 test" / "回退到 v3"
  undo: () => Promise<void>;     // 撤销函数
  redo: () => Promise<void>;     // 重做函数
  metadata?: Record<string, any>;
};
```

### 6.2 indexedDB 存储

```typescript
import { get, set, del } from 'idb-keyval';

const STORAGE_KEY = 'undo-stack';
const MAX_SIZE = 100;

class UndoStack {
  private stack: UndoEntry[] = [];

  async init() {
    this.stack = (await get(STORAGE_KEY)) || [];
  }

  async push(entry: UndoEntry) {
    this.stack.push(entry);
    if (this.stack.length > MAX_SIZE) {
      this.stack.shift();  // 移除最早的
    }
    await this.save();
  }

  async pop(): Promise<UndoEntry | undefined> {
    const entry = this.stack.pop();
    await this.save();
    return entry;
  }

  async clear() {
    this.stack = [];
    await del(STORAGE_KEY);
  }

  private async save() {
    // 序列化：移除函数
    const serializable = this.stack.map(({ undo, redo, ...rest }) => rest);
    await set(STORAGE_KEY, serializable);
  }
}
```

### 6.3 React Hook 封装

```typescript
export const useUndoStack = () => {
  const stack = useRef(new UndoStack());
  const [size, setSize] = useState(0);

  useEffect(() => {
    stack.current.init().then(() => setSize(stack.current.size));
  }, []);

  const push = useCallback(async (entry: Omit<UndoEntry, 'id' | 'timestamp'>) => {
    const fullEntry: UndoEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    await stack.current.push(fullEntry);
    setSize(stack.current.size);
  }, []);

  const pop = useCallback(async () => {
    const entry = await stack.current.pop();
    setSize(stack.current.size);
    return entry;
  }, []);

  return { push, pop, size };
};
```

---

## 7. 测试体系建立

### 7.1 Vitest 配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.config.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
```

### 7.2 单元测试示例

```typescript
// useModals.test.ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useModals } from './useModals';

describe('useModals', () => {
  it('should open modal', () => {
    const { result } = renderHook(() => useModals());
    act(() => result.current.open('settings'));
    expect(result.current.modals.settings).toBe(true);
  });

  it('should close modal', () => {
    const { result } = renderHook(() => useModals());
    act(() => result.current.open('settings'));
    act(() => result.current.close('settings'));
    expect(result.current.modals.settings).toBe(false);
  });

  it('should toggle modal', () => {
    const { result } = renderHook(() => useModals());
    act(() => result.current.toggle('settings'));
    expect(result.current.modals.settings).toBe(true);
    act(() => result.current.toggle('settings'));
    expect(result.current.modals.settings).toBe(false);
  });
});
```

### 7.3 组件测试示例

```typescript
// MessageBubble.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { MessageBubble } from './MessageBubble';

describe('MessageBubble', () => {
  const message = {
    id: '1',
    role: 'user' as const,
    content: 'Hello',
    timestamp: Date.now(),
  };

  it('renders message content', () => {
    render(<MessageBubble message={message} onAction={() => {}} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('calls onAction when action button clicked', async () => {
    const onAction = vi.fn();
    render(<MessageBubble message={message} onAction={onAction} />);

    // hover 显示工具栏
    const bubble = screen.getByTestId('message-bubble');
    await userEvent.hover(bubble);

    // 点击重新生成按钮
    const regenButton = screen.getByLabelText('重新生成');
    await userEvent.click(regenButton);

    expect(onAction).toHaveBeenCalledWith('regenerate', message);
  });
});
```

### 7.4 E2E 测试（Playwright）

```typescript
// e2e/chat-flow.spec.ts
import { test, expect } from '@playwright/test';

test('user can create project and chat with AI', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // 新建项目
  await page.keyboard.press('Meta+N');
  await page.fill('[data-testid="project-name"]', 'Test Project');
  await page.click('[data-testid="submit"]');

  // 等待跳转
  await expect(page).toHaveURL(/.*\/project\/.+/);

  // 发送消息
  await page.keyboard.press('Meta+I');
  await page.fill('[data-testid="chat-input"]', 'Hello AI');
  await page.keyboard.press('Enter');

  // 等待响应
  await expect(page.locator('[data-testid="ai-message"]')).toBeVisible({ timeout: 30000 });
});
```

---

## 8. 性能预算（Performance Budget）

### 8.1 Bundle 大小预算

| 资源 | 预算 | 当前 | 优化后 |
|------|------|------|--------|
| Initial JS (gzip) | < 500KB | 800KB | 300KB |
| Monaco 主包 (gzip) | < 200KB | 250KB | 200KB (保留) |
| Monaco workers (lazy) | < 2MB | 7MB | 2MB |
| Shiki (async) | < 500KB | 0 | 500KB (首次访问) |
| Total initial | < 1MB | 1.5MB | **500KB** |

### 8.2 运行时性能指标

| 指标 | 目标 | 当前 |
|------|------|------|
| First Contentful Paint (FCP) | < 1s | 2.5s |
| Largest Contentful Paint (LCP) | < 2s | 5s |
| Time to Interactive (TTI) | < 2.5s | 6s |
| First Input Delay (FID) | < 100ms | 200ms |
| Cumulative Layout Shift (CLS) | < 0.1 | 0.15 |
| Lighthouse Performance | ≥ 90 | 65 |

### 8.3 性能监控

```typescript
// 性能埋点
export const reportWebVitals = (metric: NextWebVitalsMetric) => {
  console.log(metric);
  // 发送到分析服务
  if (metric.label === 'web-vital') {
    fetch('/api/analytics', {
      method: 'POST',
      body: JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        route: window.location.pathname,
      }),
    });
  }
};
```

---

## 9. 代码组织规范

### 9.1 文件命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件 | PascalCase | `MessageBubble.tsx` |
| Hook | camelCase + use 前缀 | `useModals.ts` |
| 工具 | camelCase | `messageFormatters.ts` |
| 类型 | PascalCase | `types/index.ts` |
| 常量 | UPPER_SNAKE | `WORKFLOW_STATUSES.ts` |
| 测试 | *.test.ts(x) | `MessageBubble.test.tsx` |

### 9.2 目录结构

```
src/
├── components/
│   ├── ui/                    # 设计系统组件
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   ├── Button.test.tsx
│   │   │   ├── Button.stories.tsx
│   │   │   └── index.ts
│   │   ├── Input/
│   │   ├── Modal/
│   │   └── ...
│   ├── chat/                  # 业务组件
│   │   ├── MessageBubble/
│   │   ├── ChatInput/
│   │   └── ...
│   └── workflow/
├── hooks/
│   ├── useAppState.ts
│   ├── useModals.ts
│   ├── useUndoStack.ts
│   └── ...
├── providers/
│   ├── AppStateProvider.tsx
│   ├── ThemeProvider.tsx
│   └── ...
├── design-system/
│   ├── tokens/
│   ├── themes/
│   └── globals.css
├── types/
├── utils/
├── constants/
└── test/
    └── setup.ts
```

### 9.3 导入顺序

```typescript
// 1. 第三方依赖
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// 2. 项目内部（绝对路径）
import { Button } from '@/components/ui/Button';
import { useAppState } from '@/hooks/useAppState';

// 3. 相对路径
import './styles.css';
```

---

## 10. 迁移策略

### 10.1 渐进式迁移原则

1. **新增 vs 替换**: 优先新增新组件，旧组件逐步替换
2. **向后兼容**: 保持旧组件 API 不变，新组件通过 alias 引入
3. **特性开关**: 通过 feature flag 控制新功能启用
4. **灰度发布**: 内部用户先使用，稳定后全员推广

### 10.2 迁移顺序

#### Round 1 (P0)
1. ✅ 建立 Design Token（无破坏性）
2. ✅ 引入 Vitest（新增，不影响现有）
3. ✅ MessageBubble 4 按钮修复（直接修改）
4. ✅ test_loop_v7 死代码清理（删除）
5. ✅ Monaco lazy 改造（路由级）
6. ✅ 状态机扩展（新增 4 态）

#### Round 2 (P1)
1. ⚠️ App.tsx 拆分（灰度：useReducer → 双轨运行 1 周 → 切流）
2. ⚠️ useModals 合并（直接修改）
3. ⚠️ Shiki 替换（双运行切换）
4. ⚠️ 虚拟列表（逐个组件迁移）
5. ⚠️ 撤销栈（新增）
6. ⚠️ Undo Toast（新增）
7. ⚠️ Diff Preview（新增）
8. ⚠️ ThinkingBlock 阶段（直接修改）

#### Round 3 (P2)
1. ⚠️ 移动端响应式（按页面迁移）
2. ⚠️ 快捷键体系（增量添加）
3. ⚠️ 批量操作（按场景迁移）
4. ⚠️ 自动 commit（新增）

### 10.3 回滚预案

每个 P1+ 改动需配套：
- **Feature Flag**: 快速禁用
- **Git 分支**: 独立分支，main 合并前可回滚
- **备份**: 大改动前打 tag
- **监控**: 关键指标异常自动告警

---

## 11. 验收技术指标

### 11.1 编译质量

- ✅ TypeScript 严格模式零错误
- ✅ ESLint 零 warning
- ✅ Prettier 格式统一
- ✅ 单元测试覆盖率 ≥ 80%

### 11.2 运行时性能

- ✅ Lighthouse Performance ≥ 90
- ✅ 首屏加载 < 2s
- ✅ 交互响应 < 100ms
- ✅ 60fps 流畅度（10K 消息列表）

### 11.3 兼容性

- ✅ Chrome 100+ / Firefox 100+ / Safari 15+ / Edge 100+
- ✅ 移动端 iOS Safari 15+ / Android Chrome 100+
- ✅ 1024px / 768px / 375px 三档断点

### 11.4 可维护性

- ✅ 单文件最大 500 行（除 App.tsx / provider）
- ✅ 组件最大 3 层嵌套
- ✅ Hook 单一职责
- ✅ TypeScript any 零容忍

---

**文档完成时间**: 2026-07-29
**文档字数**: 6,800 字
**下一步**: 创建 Spec #4: 验收标准
