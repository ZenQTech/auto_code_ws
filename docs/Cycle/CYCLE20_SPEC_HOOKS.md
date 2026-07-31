# Cycle 20 G20-03: Hooks Engine - 技术规范

> **任务编号**: G20-03
> **优先级**: P0 (必做)
> **日期**: 2026-07-29
> **基于**: [CYCLE20_GAP_ANALYSIS.md](./CYCLE20_GAP_ANALYSIS.md)
> **负责人**: Hermes AI Agent

---

## 一、需求背景

### 1.1 问题

- 缺少 vibe coding 事件 Hooks
- Cursor 7 种 Hook：Prompts/Responses/Thinking/Subagents/Compaction/Turn Completion/Tool Execution
- 团队级配置缺失
- 监控/审计/统计能力弱

### 1.2 目标

- 7 种 Hook 类型完整实现
- 团队级/项目级/用户级三层配置
- 异步执行 + 错误降级
- Hook 触发历史记录

---

## 二、核心数据结构

### 2.1 HookType

```typescript
export type HookType =
  | 'before_prompt'      // 用户输入前
  | 'after_prompt'       // 用户输入后
  | 'before_response'     // AI 响应前
  | 'after_response'     // AI 响应后
  | 'thinking'           // 思考过程
  | 'subagent_start'     // 子智能体启动
  | 'subagent_end'       // 子智能体结束
  | 'compaction'         // 会话压缩
  | 'turn_complete'      // 轮次完成
  | 'tool_execution';    // 工具执行
```

### 2.2 HookDefinition

```typescript
export interface HookDefinition {
  /** 唯一 ID */
  id: string;
  /** Hook 类型 */
  type: HookType;
  /** Hook 名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 配置（团队级/项目级/用户级） */
  scope: HookScope;
  /** 是否启用 */
  enabled: boolean;
  /** 触发条件（可选） */
  condition?: HookCondition;
  /** 动作（脚本/命令/回调） */
  action: HookAction;
  /** 创建时间 */
  createdAt: number;
  /** 创建者 */
  createdBy: string;
  /** 优先级（数字越小优先级越高） */
  priority: number;
  /** 超时时间（毫秒，默认 5000） */
  timeoutMs?: number;
  /** 重试次数（默认 0） */
  retries?: number;
  /** 错误降级策略 */
  fallback?: 'ignore' | 'warn' | 'block' | 'retry';
}

export type HookScope = 'team' | 'project' | 'user';

export interface HookCondition {
  /** 关键词匹配 */
  keywords?: string[];
  /** 文件类型匹配 */
  fileTypes?: string[];
  /** 用户匹配 */
  users?: string[];
  /** 项目匹配 */
  projects?: string[];
  /** 自定义表达式（可选） */
  expression?: string;
}

export type HookAction =
  | { type: 'webhook'; url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }
  | { type: 'command'; command: string; args?: string[]; cwd?: string }
  | { type: 'script'; code: string; language: 'javascript' | 'python' }
  | { type: 'callback'; handler: (event: HookEvent) => void | Promise<void> };
```

### 2.3 HookEvent

```typescript
export interface HookEvent {
  /** 事件 ID */
  id: string;
  /** Hook 类型 */
  type: HookType;
  /** 关联的 Hook 定义 */
  hookId: string;
  /** 事件 payload */
  payload: Record<string, unknown>;
  /** 触发时间 */
  timestamp: number;
  /** 触发用户 */
  userId?: string;
  /** 关联项目 */
  projectId?: string;
  /** 关联任务 ID */
  taskId?: string;
}
```

### 2.4 HookExecutionResult

```typescript
export interface HookExecutionResult {
  /** 事件 ID */
  eventId: string;
  /** Hook ID */
  hookId: string;
  /** 状态 */
  status: 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled';
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
  /** 耗时（毫秒） */
  duration?: number;
  /** 错误信息（如果失败） */
  error?: string;
  /** 返回值 */
  result?: unknown;
  /** 重试次数 */
  retries: number;
}
```

---

## 三、核心 API

### 3.1 HooksEngine

```typescript
export class HooksEngine {
  private hooks: Map<string, HookDefinition> = new Map();
  private executionLog: HookExecutionResult[] = [];
  private readonly eventBus: HookEventBus = new HookEventBus();
  private readonly maxConcurrent = 10;
  private runningCount = 0;
  private readonly queue: HookEvent[] = [];

  /**
   * 注册 Hook
   */
  registerHook(hook: HookDefinition): void;

  /**
   * 注销 Hook
   */
  unregisterHook(id: string): void;

  /**
   * 启用/禁用 Hook
   */
  setEnabled(id: string, enabled: boolean): void;

  /**
   * 触发 Hook
   */
  async trigger(type: HookType, payload: Record<string, unknown>, context?: TriggerContext): Promise<HookExecutionResult[]>;

  /**
   * 列出 Hook
   */
  list(filter?: HookFilter): HookDefinition[];

  /**
   * 获取执行日志
   */
  getExecutionLog(filter?: ExecutionLogFilter): HookExecutionResult[];

  /**
   * 清空执行日志
   */
  clearExecutionLog(): void;

  /**
   * 订阅事件
   */
  on(event: HookEngineEventType, handler: HookEngineEventHandler): () => void;
}
```

### 3.2 单例工厂

```typescript
export function getHooksEngine(): HooksEngine;
export function resetHooksEngine(): void;
```

### 3.3 便捷触发函数

```typescript
// 7 种 Hook 类型的便捷触发
export async function triggerBeforePrompt(payload: PromptPayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerAfterPrompt(payload: PromptPayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerBeforeResponse(payload: ResponsePayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerAfterResponse(payload: ResponsePayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerThinking(payload: ThinkingPayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerSubagentStart(payload: SubagentPayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerSubagentEnd(payload: SubagentPayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerCompaction(payload: CompactionPayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerTurnComplete(payload: TurnCompletePayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
export async function triggerToolExecution(payload: ToolExecutionPayload, context?: TriggerContext): Promise<HookExecutionResult[]>;
```

---

## 四、与现有模块集成

### 4.1 Composer 集成

```typescript
// useComposer.tsx - 在每个关键节点触发 Hook
const handleSubmit = async (prompt: string) => {
  // 触发 before_prompt
  await triggerBeforePrompt({ prompt, context: composerContext });

  // 正常执行
  const response = await callLLM(prompt, context);

  // 触发 after_response
  await triggerAfterResponse({ prompt, response, model: currentModel });

  // 触发 turn_complete
  await triggerTurnComplete({ turnId, duration, tokenCount });
};
```

### 4.2 BackgroundTaskEngine 集成

```typescript
// 任务启动时触发 subagent_start
engine.startTask(id) {
  await triggerSubagentStart({ taskId: id, taskType: task.type });
  // ...
  // 任务完成时触发 subagent_end
  await triggerSubagentEnd({ taskId: id, result: task.result });
}
```

### 4.3 MultiModelExecutor 集成

```typescript
// 模型调用时触发 thinking
const response = await callModel(model, prompt);
await triggerThinking({ model, prompt, thinking: response.thinking });
```

### 4.4 Summary 集成

```typescript
// 会话压缩时触发 compaction
await triggerCompaction({ sessionId, originalTokens, summaryTokens });
```

---

## 五、UI 组件

### 5.1 HooksPanel

- 列出所有注册的 Hook
- 按类型分组
- 按 scope 过滤
- 启用/禁用切换
- 编辑/删除/新建

### 5.2 HookCard

- Hook 名称 + 描述
- 类型徽章
- 状态徽章（启用/禁用）
- 触发统计（调用次数/成功率/平均耗时）
- 快捷操作：测试 / 编辑 / 启用切换

### 5.3 HookEditor

- 表单：名称/类型/scope/condition/action
- Webhook URL / Command / Script 编辑器
- 实时预览
- 测试按钮

### 5.4 ExecutionLogViewer

- 实时日志流
- 按 Hook / 类型 / 状态过滤
- 详情查看（payload/result/error）

### 5.5 HooksManager

- 集成到 BrandHeader 菜单
- HooksPanel + HookEditor + ExecutionLogViewer

---

## 六、预置 Hooks

```typescript
export const DEFAULT_HOOKS: HookDefinition[] = [
  {
    id: 'log-prompts',
    type: 'after_prompt',
    name: '记录所有 Prompt',
    description: '将用户输入记录到控制台',
    scope: 'user',
    enabled: true,
    action: { type: 'callback', handler: (e) => console.log('[Prompt]', e.payload) },
    createdAt: Date.now(),
    createdBy: 'system',
    priority: 100,
  },
  {
    id: 'log-thinking',
    type: 'thinking',
    name: '记录思考过程',
    description: '将 AI 思考过程记录到控制台',
    scope: 'user',
    enabled: true,
    action: { type: 'callback', handler: (e) => console.log('[Thinking]', e.payload) },
    createdAt: Date.now(),
    createdBy: 'system',
    priority: 100,
  },
];
```

---

## 七、测试要求

### 7.1 单元测试 (60+)

- registerHook / unregisterHook
- trigger 7 种 Hook 类型
- 异步执行 + 错误降级
- 超时处理
- 重试机制
- 条件匹配（keywords/fileTypes/users）
- 优先级排序
- 队列管理（max concurrent）
- 持久化（localStorage）
- 事件总线

### 7.2 集成测试 (40+)

- HooksPanel 渲染 + 交互
- HookCard 状态切换
- HookEditor 表单提交
- ExecutionLogViewer 日志流
- 与 Composer 集成
- 与 BackgroundTask 集成
- 与 MultiModelExecutor 集成

### 7.3 E2E 测试 (40+ 断言)

- Section 1: HooksEngine 引擎 (20 项)
- Section 2: HooksPanel UI (10 项)
- Section 3: HookEditor (5 项)
- Section 4: 集成验证 (5 项)

---

## 八、依赖与配置

### 8.1 依赖

无需新增 npm 依赖，使用：
- fetch API (webhook)
- localStorage (持久化)

### 8.2 文件清单

- `frontend/src/utils/hooksEngine.ts` (700 行)
- `frontend/src/utils/hooksEngine.test.ts` (400 行)
- `frontend/src/components/HooksPanel.tsx` (400 行)
- `frontend/src/components/HooksPanel.test.tsx` (250 行)
- `frontend/src/components/HookEditor.tsx` (350 行)
- `frontend/src/components/HookEditor.test.tsx` (200 行)
- 修改：
  - `frontend/src/components/BrandHeader.tsx` (+30 行)
  - `frontend/src/App.tsx` (+20 行)
  - `frontend/src/hooks/useComposer.tsx` (+30 行)
  - `frontend/src/utils/backgroundTaskEngine.ts` (+20 行)
  - `frontend/src/utils/multiModelExecutor.ts` (+15 行)

---

## 九、验收标准

- ✅ 7 种 Hook 类型完整实现
- ✅ 三层配置可切换（team/project/user）
- ✅ 异步执行不影响主流程
- ✅ 错误降级机制（ignore/warn/block/retry）
- ✅ 单元测试 60+ 100% 通过
- ✅ 集成测试 40+ 100% 通过
- ✅ E2E 断言 40+ 100% 通过
- ✅ TypeScript 编译 0 错误
- ✅ UI 组件完整（HooksPanel + HookEditor + ExecutionLogViewer）
- ✅ Loop Engineering 工作流无回归

---

**SPEC 完成**: 2026-07-29 14:50
**下一步**: 创建其他 3 份 SPEC + 开始 G20-03 实施
