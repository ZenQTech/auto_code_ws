# G27-01 Nested Sub-Agents Engine 详细 SPEC

**SPEC ID**: G27-01
**Cycle**: 27
**优先级**: P0
**目标版本**: v6.68.0
**编写日期**: 2026-07-30

---

## 一、目标

实现 **3 层嵌套子代理引擎**，参考 Claude Code 2026-06 #1 Nested Sub-Agents 特性。

核心能力：
- 父代理可创建子代理，子代理可再创建子子代理，最多 3 层
- 每层可分配不同 role / model / reasoning_effort / constraint set
- 每层独立 context window
- 父子代理消息传递
- 嵌套深度限制与超时控制

---

## 二、数据模型

### 2.1 类型定义（`utils/nestedSubAgentTypes.ts`）

```typescript
/**
 * 代理角色枚举
 */
export type AgentRole =
  | 'coordinator'      // 顶层协调者
  | 'researcher'       // 研究者
  | 'analyzer'         // 分析者
  | 'builder'          // 构建者
  | 'reviewer'         // 审查者
  | 'tester'           // 测试者
  | 'refactorer'       // 重构者
  | 'documenter'       // 文档者
  | 'custom';          // 自定义

/**
 * 模型选择
 */
export type ModelChoice =
  | 'haiku'
  | 'sonnet'
  | 'opus'
  | 'gpt-5'
  | 'gpt-5-mini'
  | 'inherit';         // 继承父级

/**
 * 推理强度
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * 单个代理配置
 */
export interface SubAgentConfig {
  /** 代理唯一 ID */
  id: string;
  /** 代理角色 */
  role: AgentRole;
  /** 自定义名称 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 使用的模型 */
  model: ModelChoice;
  /** 推理强度 */
  reasoningEffort: ReasoningEffort;
  /** 系统提示词 */
  systemPrompt: string;
  /** 允许使用的工具列表（空数组表示无工具） */
  tools: string[];
  /** 约束条件（不可违反的硬性规则） */
  constraints: string[];
  /** 上下文窗口大小（token 数） */
  contextWindow: number;
  /** 超时时间（毫秒） */
  timeoutMs: number;
  /** 最大递归深度（默认 3） */
  maxDepth: number;
}

/**
 * 代理节点（运行时状态）
 */
export interface SubAgentNode {
  /** 节点唯一 ID（UUID） */
  uuid: string;
  /** 路径地址（如 /root/researcher/analyzer） */
  path: string;
  /** 父节点 UUID（根节点为 undefined） */
  parentUuid?: string;
  /** 节点配置 */
  config: SubAgentConfig;
  /** 嵌套深度（0, 1, 2） */
  depth: number;
  /** 状态 */
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'timeout';
  /** 子节点列表 */
  children: string[];
  /** 当前任务 */
  currentTask?: AgentTask;
  /** 完成的任务数 */
  completedTasks: number;
  /** 失败的任务数 */
  failedTasks: number;
  /** 创建时间 */
  createdAt: number;
  /** 启动时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 已使用 token 数（估算） */
  tokensUsed: number;
  /** 当前 context window 已用占比 */
  contextUsage: number;
  /** 错误信息 */
  error?: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 任务定义
 */
export interface AgentTask {
  id: string;
  description: string;
  input: string;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

/**
 * 引擎配置
 */
export interface NestedSubAgentConfig {
  /** 最大嵌套深度（默认 3） */
  maxDepth: number;
  /** 默认模型 */
  defaultModel: ModelChoice;
  /** 默认超时（毫秒） */
  defaultTimeoutMs: number;
  /** 是否持久化到 localStorage */
  persist: boolean;
  /** 是否启用事件 */
  enableEvents: boolean;
  /** 全局并发上限 */
  maxConcurrency: number;
  /** 上下文压缩阈值（0-1） */
  contextCompactThreshold: number;
}

/**
 * 事件类型
 */
export type NestedSubAgentEventType =
  | 'agent-created'
  | 'agent-started'
  | 'agent-completed'
  | 'agent-failed'
  | 'agent-timed-out'
  | 'agent-paused'
  | 'agent-resumed'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'tree-restored'
  | 'depth-limit-reached'
  | 'cycle-detected';

export interface NestedSubAgentEvent {
  type: NestedSubAgentEventType;
  timestamp: number;
  agentUuid: string;
  agentPath: string;
  data?: Record<string, unknown>;
}

/**
 * 树结构
 */
export interface SubAgentTree {
  rootUuid: string;
  nodes: Map<string, SubAgentNode>;
  totalAgents: number;
  totalCompleted: number;
  totalFailed: number;
  totalTokensUsed: number;
  maxDepthReached: number;
}

/**
 * 默认配置
 */
export const DEFAULT_NESTED_SUB_AGENT_CONFIG: NestedSubAgentConfig = {
  maxDepth: 3,
  defaultModel: 'sonnet',
  defaultTimeoutMs: 300000, // 5 分钟
  persist: true,
  enableEvents: true,
  maxConcurrency: 8,
  contextCompactThreshold: 0.85,
};
```

---

## 三、核心 API

### 3.1 `NestedSubAgentEngine` 类

#### 构造器

```typescript
constructor(config?: Partial<NestedSubAgentConfig>)
```

#### 核心方法

```typescript
/**
 * 创建根代理
 * @returns 根节点 UUID
 */
createRootAgent(config: Omit<SubAgentConfig, 'id' | 'maxDepth'>): string;

/**
 * 创建子代理
 * @param parentUuid 父节点 UUID
 * @param config 子代理配置
 * @returns 子节点 UUID
 * @throws DepthLimitError 超出 maxDepth
 * @throws CycleError 形成循环引用
 */
createChildAgent(parentUuid: string, config: Omit<SubAgentConfig, 'id' | 'maxDepth'>): string;

/**
 * 启动代理（递归启动其子树）
 */
startAgent(uuid: string, task: Omit<AgentTask, 'id' | 'status'>): Promise<void>;

/**
 * 暂停代理
 */
pauseAgent(uuid: string): void;

/**
 * 恢复代理
 */
async resumeAgent(uuid: string): Promise<void>;

/**
 * 取消代理及其所有子代理
 */
cancelAgent(uuid: string): void;

/**
 * 通过路径获取节点
 */
getAgentByPath(path: string): SubAgentNode | undefined;

/**
 * 通过 UUID 获取节点
 */
getAgent(uuid: string): SubAgentNode | undefined;

/**
 * 获取子代理列表
 */
getChildren(uuid: string): SubAgentNode[];

/**
 * 获取兄弟代理列表
 */
getSiblings(uuid: string): SubAgentNode[];

/**
 * 获取完整树
 */
getTree(rootUuid?: string): SubAgentTree;

/**
 * 解析路径
 */
resolvePath(path: string): string | undefined;

/**
 * 验证路径（不能是循环引用）
 */
validatePath(parentPath: string, childName: string): boolean;

/**
 * 订阅事件
 */
on(event: NestedSubAgentEventType, listener: (e: NestedSubAgentEvent) => void): () => void;

/**
 * 获取统计信息
 */
getStats(): {
  totalAgents: number;
  totalCompleted: number;
  totalFailed: number;
  totalTokensUsed: number;
  averageDepth: number;
  maxDepthReached: number;
  byRole: Record<AgentRole, number>;
  byStatus: Record<SubAgentNode['status'], number>;
};

/**
 * 导出树（用于 checkpoint）
 */
exportTree(rootUuid?: string): SerializedTree;

/**
 * 导入树（用于恢复）
 */
importTree(data: SerializedTree): string;
```

---

## 四、关键算法

### 4.1 路径解析

```typescript
/**
 * 解析路径 /root/researcher/analyzer
 * - 第一段必须是 'root'
 * - 总段数 <= maxDepth
 * - 每段必须是 kebab-case
 */
function parsePath(path: string): string[] {
  if (!path.startsWith('/')) {
    throw new Error(`Path must start with '/': ${path}`);
  }
  const segments = path.slice(1).split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Path cannot be empty: ${path}`);
  }
  if (segments[0] !== 'root') {
    throw new Error(`Path must start with /root: ${path}`);
  }
  for (const seg of segments) {
    if (!/^[a-z][a-z0-9-]*$/.test(seg)) {
      throw new Error(`Invalid path segment: ${seg}`);
    }
  }
  return segments;
}
```

### 4.2 深度限制

```typescript
function checkDepthLimit(parentDepth: number, maxDepth: number): void {
  if (parentDepth + 1 >= maxDepth) {
    throw new DepthLimitError(
      `Cannot create child: max depth ${maxDepth} reached`
    );
  }
}
```

### 4.3 循环检测

```typescript
function detectCycle(parentUuid: string, childName: string, tree: Map<string, SubAgentNode>): boolean {
  // 通过子代理的 name 查找已存在的节点
  for (const node of tree.values()) {
    if (node.name === childName && node.parentUuid === parentUuid) {
      return true;
    }
  }
  return false;
}
```

### 4.4 Context Window 管理

```typescript
function compactContextIfNeeded(node: SubAgentNode, threshold: number): void {
  if (node.contextUsage >= threshold) {
    // 触发 context 压缩
    // 保留最近 N 条消息，摘要较早的
    const compactedTokens = node.tokensUsed * 0.6;
    node.tokensUsed = compactedTokens;
    node.contextUsage = compactedTokens / node.config.contextWindow;
  }
}
```

### 4.5 超时控制

```typescript
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

---

## 五、事件系统

### 5.1 事件类型与触发时机

| 事件 | 触发时机 | 携带数据 |
|------|---------|---------|
| `agent-created` | createRootAgent / createChildAgent | config |
| `agent-started` | startAgent | task |
| `agent-completed` | 任务完成 | output |
| `agent-failed` | 任务失败 | error |
| `agent-timed-out` | 任务超时 | timeoutMs |
| `agent-paused` | pauseAgent | - |
| `agent-resumed` | resumeAgent | - |
| `task-started` | 子任务开始 | task |
| `task-completed` | 子任务完成 | task, output |
| `task-failed` | 子任务失败 | task, error |
| `tree-restored` | importTree | tree |
| `depth-limit-reached` | 尝试超过 maxDepth | attemptedPath |
| `cycle-detected` | 检测到循环引用 | parentPath, childName |

### 5.2 事件订阅示例

```typescript
const engine = new NestedSubAgentEngine();

const unsubscribe = engine.on('agent-completed', (event) => {
  console.log(`[${event.agentPath}] completed`);
});

const unsubscribe2 = engine.on('depth-limit-reached', (event) => {
  console.warn(`Depth limit reached: ${event.data.attemptedPath}`);
});

// 清理
unsubscribe();
unsubscribe2();
```

---

## 六、UI 设计

### 6.1 NestedSubAgentPanel 主要元素

```
┌─────────────────────────────────────────────────────────────────┐
│ 🪆 嵌套子代理引擎 v1.0.0    [根:3个][活跃:1个][完成:0个][失败:0个] │
├─────────────────────────────────────────────────────────────────┤
│ [创建根代理] [创建子代理] [启动] [暂停] [恢复] [取消] [导入] [导出] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 树形视图:                                                         │
│ ▼ /root (coordinator, sonnet)                                   │
│   ▶ /root/researcher (researcher, sonnet)                       │
│     ▼ /root/researcher/analyzer (analyzer, haiku)               │
│       - [运行中] 任务: 分析API... (用时: 12s, tokens: 1.2k)      │
│   ▶ /root/builder (builder, sonnet)                              │
│     - [空闲] 任务: 无                                            │
│                                                                  │
│ 时间线视图:                                                       │
│ 12:00:00 [root] started                                          │
│ 12:00:01 [root] spawned /root/researcher                        │
│ 12:00:02 [root] spawned /root/builder                           │
│ 12:00:03 [researcher] spawned /root/researcher/analyzer         │
│ 12:00:04 [analyzer] task started                                 │
│ 12:00:16 [analyzer] task running (12s)                          │
│                                                                  │
│ 详情:                                                            │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ 路径: /root/researcher/analyzer                            │    │
│ │ 角色: analyzer                                              │    │
│ │ 模型: haiku (继承)                                          │    │
│ │ 状态: 运行中                                                │    │
│ │ 深度: 2 / 3                                                 │    │
│ │ 任务: 分析API的依赖关系                                     │    │
│ │ 上下文: 1.2k / 8k (15%)                                     │    │
│ │ 用时: 12s                                                   │    │
│ │ 工具: [Read] [Grep] [Glob]                                  │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│ 统计:                                                            │
│ 总代理数: 3 | 活跃: 1 | 完成: 0 | 失败: 0                       │
│ 总 tokens: 1,250 | 平均深度: 1.3 | 最大深度: 2                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 操作流程

1. **创建根代理** → 配置 role/name/model/systemPrompt/tools → 确认 → 显示在树根
2. **创建子代理** → 选中父节点 → "创建子代理" → 配置 → 确认 → 显示在父节点下
3. **启动代理** → 选中节点 → "启动" → 输入任务描述 → 启动后状态变 running
4. **查看详情** → 选中节点 → 详情面板更新
5. **暂停/恢复** → 选中节点 → 按钮切换
6. **取消** → 选中节点 → "取消" → 递归取消所有子代理
7. **导出/导入** → "导出" → 下载 JSON → "导入" → 上传 JSON → 树恢复

---

## 七、测试策略

### 7.1 单元测试（`utils/nestedSubAgentEngine.test.ts`，35+ 用例）

```typescript
describe('NestedSubAgentEngine', () => {
  describe('基础功能', () => {
    it('创建根代理');
    it('创建子代理');
    it('路径自动生成');
    it('UUID 自动生成且唯一');
  });

  describe('深度限制', () => {
    it('创建深度 0 节点');
    it('创建深度 1 节点');
    it('创建深度 2 节点');
    it('拒绝创建深度 3 节点（超过 maxDepth=3）');
    it('可配置 maxDepth');
  });

  describe('循环检测', () => {
    it('同父下同名子代理 - 拒绝');
    it('跨层同名 - 允许');
    it('不存在的父 - 拒绝');
  });

  describe('路径管理', () => {
    it('路径解析 /root');
    it('路径解析 /root/researcher');
    it('路径解析 /root/researcher/analyzer');
    it('无效路径 - 不以 / 开头');
    it('无效路径 - 首段不是 root');
    it('无效路径 - 空段');
    it('无效路径 - 含非法字符');
  });

  describe('生命周期', () => {
    it('启动代理');
    it('暂停代理');
    it('恢复代理');
    it('取消代理及其子代理');
    it('超时处理');
    it('完成状态转换');
    it('失败状态转换');
  });

  describe('兄弟节点', () => {
    it('获取兄弟列表');
    it('根节点无兄弟');
  });

  describe('树管理', () => {
    it('获取完整树');
    it('导出树');
    it('导入树');
    it('导入后状态正确恢复');
  });

  describe('持久化', () => {
    it('localStorage 保存');
    it('localStorage 恢复');
    it('关闭引擎后数据保留');
  });

  describe('事件系统', () => {
    it('订阅 agent-created');
    it('订阅 agent-started');
    it('订阅 agent-completed');
    it('订阅 agent-failed');
    it('订阅 depth-limit-reached');
    it('订阅 cycle-detected');
    it('取消订阅');
  });

  describe('统计', () => {
    it('getStats 返回完整统计');
    it('按 role 统计');
    it('按 status 统计');
  });

  describe('Context Window', () => {
    it('context 用量跟踪');
    it('阈值触发压缩');
    it('压缩后 token 减少');
  });
});
```

### 7.2 组件测试（`components/NestedSubAgentPanel.test.tsx`，12+ 用例）

```typescript
describe('NestedSubAgentPanel', () => {
  it('打开/关闭');
  it('显示树形视图');
  it('显示时间线视图');
  it('显示详情面板');
  it('点击节点显示详情');
  it('创建根代理对话框');
  it('创建子代理对话框');
  it('启动代理');
  it('暂停/恢复按钮');
  it('取消按钮');
  it('导出按钮');
  it('导入按钮');
});
```

---

## 八、文件清单

### 8.1 新增文件

| 文件路径 | 说明 | 行数（预估） |
|---------|------|------------|
| `frontend/src/utils/nestedSubAgentTypes.ts` | 类型定义 | 250 |
| `frontend/src/utils/nestedSubAgentEngine.ts` | 核心引擎 | 800 |
| `frontend/src/utils/nestedSubAgentEngine.test.ts` | 单元测试 | 600 |
| `frontend/src/components/NestedSubAgentPanel.tsx` | UI 组件 | 700 |
| `frontend/src/components/NestedSubAgentPanel.test.tsx` | 组件测试 | 400 |

### 8.2 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `frontend/src/App.tsx` | 集成 NestedSubAgentPanel |
| `frontend/src/components/BrandHeader.tsx` | 添加菜单项 |

---

## 九、性能预算

- 创建代理：< 10ms
- 启动代理：< 50ms
- 获取树（100 节点）：< 5ms
- 导出树：< 100ms
- 导入树：< 200ms
- 事件触发：< 1ms

---

## 十、验收清单

- [ ] 引擎实现完成
- [ ] 35+ 单元测试全部通过
- [ ] 12+ 组件测试全部通过
- [ ] UI 组件实现并集成
- [ ] 文档完整（函数注释、行内注释、文件头注释）
- [ ] TypeScript 零错误
- [ ] 性能预算达标
- [ ] 持久化正常工作
- [ ] 事件系统正常
- [ ] 与现有 MultiTaskOrchestrator 协同

---

## 十一、参考

- [Claude Code 2026-06 - Nested Sub-Agents](https://www.sitepoint.com/claude-code-june-2026-10-new-features-devs-need-to-know/)
- [Codex v0.145 Multi-Agent V2](https://codex.danielvaughan.com/2026/04/11/codex-cli-multi-agent-orchestration-v2-complete-guide/)
- [Claude Code Sub-Agents Docs](https://code.claude.com/docs/en/sub-agents)

---

**SPEC 版本**: v1.0.0
**编写时间**: 2026-07-30
