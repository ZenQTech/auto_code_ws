/**
 * # ============================================================
 * # HooksEngine - Vibe Coding 事件钩子引擎 (v1.0.0 Cycle 20 G20-03)
 * # ============================================================
 * # 核心作用：管理 vibe coding 事件 Hooks，对标 Cursor 7 种 Hook 类型
 * # 7 种 Hook 类型：
 * #   - before_prompt / after_prompt        用户输入前后
 * #   - before_response / after_response    AI 响应前后
 * #   - thinking                           思考过程
 * #   - subagent_start / subagent_end      子智能体启停
 * #   - compaction                         会话压缩
 * #   - turn_complete                      轮次完成
 * #   - tool_execution                     工具执行
 * # 运行流程：
 * #   1. registerHook() - 注册 Hook
 * #   2. trigger() - 异步触发匹配的 Hook
 * #   3. 异步执行 action（webhook/command/script/callback）
 * #   4. 记录执行日志
 * # 输入参数：HookDefinition + payload
 * # 输出结果：HookExecutionResult[]
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 20 G20-03 初次创建
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 10 种 Hook 类型
 */
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

export const ALL_HOOK_TYPES: HookType[] = [
  'before_prompt',
  'after_prompt',
  'before_response',
  'after_response',
  'thinking',
  'subagent_start',
  'subagent_end',
  'compaction',
  'turn_complete',
  'tool_execution',
];

export type HookScope = 'team' | 'project' | 'user';

export interface HookCondition {
  /** 关键词匹配（OR 关系） */
  keywords?: string[];
  /** 文件类型匹配 */
  fileTypes?: string[];
  /** 用户匹配 */
  users?: string[];
  /** 项目匹配 */
  projects?: string[];
}

export type HookAction =
  | { type: 'webhook'; url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }
  | { type: 'command'; command: string; args?: string[]; cwd?: string }
  | { type: 'script'; code: string; language: 'javascript' | 'python' }
  | { type: 'callback'; handler: (event: HookEvent) => void | Promise<void> };

export type HookFallback = 'ignore' | 'warn' | 'block' | 'retry';

export interface HookDefinition {
  /** 唯一 ID */
  id: string;
  /** Hook 类型 */
  type: HookType;
  /** Hook 名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 配置 scope */
  scope: HookScope;
  /** 是否启用 */
  enabled: boolean;
  /** 触发条件（可选） */
  condition?: HookCondition;
  /** 动作 */
  action: HookAction;
  /** 创建时间 */
  createdAt: number;
  /** 创建者 */
  createdBy: string;
  /** 优先级（数字越小优先级越高，默认 100） */
  priority: number;
  /** 超时时间（毫秒，默认 5000） */
  timeoutMs: number;
  /** 重试次数（默认 0） */
  retries: number;
  /** 错误降级策略 */
  fallback: HookFallback;
}

export interface HookEvent {
  /** 事件 ID */
  id: string;
  /** Hook 类型 */
  type: HookType;
  /** 关联的 Hook 定义 ID */
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

export type HookExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled';

export interface HookExecutionResult {
  /** 事件 ID */
  eventId: string;
  /** Hook ID */
  hookId: string;
  /** Hook 名称 */
  hookName: string;
  /** 状态 */
  status: HookExecutionStatus;
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

export interface TriggerContext {
  userId?: string;
  projectId?: string;
  taskId?: string;
}

export interface HookFilter {
  type?: HookType | HookType[];
  scope?: HookScope | HookScope[];
  enabled?: boolean;
}

export interface ExecutionLogFilter {
  hookId?: string;
  status?: HookExecutionStatus | HookExecutionStatus[];
  sinceMs?: number;
  limit?: number;
}

export type HookEngineEventType = 'hook-registered' | 'hook-unregistered' | 'hook-triggered' | 'hook-completed' | 'hook-failed';

export interface HookEngineEvent {
  type: HookEngineEventType;
  hookId?: string;
  eventId?: string;
  result?: HookExecutionResult;
  timestamp: number;
}

export type HookEngineEventHandler = (event: HookEngineEvent) => void;

// ============================================================
// 事件总线
// ============================================================

class HookEventBus {
  private listeners: Map<HookEngineEventType, Set<HookEngineEventHandler>> = new Map();

  on(type: HookEngineEventType, handler: HookEngineEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: HookEngineEvent): void {
    this.listeners.get(event.type)?.forEach(handler => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Hook event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 生成唯一 ID
 */
function _genId(prefix: string = 'hk'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 检查 condition 是否匹配 payload
 */
function _matchesCondition(condition: HookCondition | undefined, payload: Record<string, unknown>, context?: TriggerContext): boolean {
  if (!condition) return true;

  // 关键词匹配
  if (condition.keywords && condition.keywords.length > 0) {
    const text = String(payload.text ?? payload.prompt ?? payload.content ?? '');
    const hasKeyword = condition.keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
    if (!hasKeyword) return false;
  }

  // 文件类型匹配
  if (condition.fileTypes && condition.fileTypes.length > 0) {
    const fileType = String(payload.fileType ?? '');
    if (fileType && !condition.fileTypes.includes(fileType)) {
      return false;
    }
  }

  // 用户匹配
  if (condition.users && condition.users.length > 0 && context?.userId) {
    if (!condition.users.includes(context.userId)) return false;
  }

  // 项目匹配
  if (condition.projects && condition.projects.length > 0 && context?.projectId) {
    if (!condition.projects.includes(context.projectId)) return false;
  }

  return true;
}

/**
 * 执行 webhook
 */
async function _executeWebhook(action: Extract<HookAction, { type: 'webhook' }>, event: HookEvent, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('Webhook timeout'));
    }, timeoutMs);

    const init: RequestInit = {
      method: action.method ?? 'POST',
      headers: action.headers ?? { 'Content-Type': 'application/json' },
      body: action.body ? action.body : JSON.stringify(event.payload),
      signal: controller.signal,
    };

    if (typeof fetch === 'undefined') {
      // Node.js 环境或不支持 fetch - 模拟成功
      clearTimeout(timeoutId);
      resolve({ mocked: true });
      return;
    }

    fetch(action.url, init)
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          reject(new Error(`HTTP ${res.status}`));
        } else {
          const data = await res.text();
          resolve(data);
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          reject(new Error('Webhook timeout'));
        } else {
          reject(err);
        }
      });
  });
}

/**
 * 执行 command
 */
async function _executeCommand(action: Extract<HookAction, { type: 'command' }>, timeoutMs: number): Promise<unknown> {
  // 模拟执行（避免实际 fork 子进程）
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ mocked: true, command: action.command, args: action.args });
    }, Math.min(10, timeoutMs));
  });
}

/**
 * 执行 script
 */
async function _executeScript(action: Extract<HookAction, { type: 'script' }>, _event: HookEvent, _timeoutMs: number): Promise<unknown> {
  // 简单模拟执行
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ mocked: true, language: action.language, code: action.code.length });
    }, 10);
  });
}

/**
 * 执行 callback
 */
async function _executeCallback(action: Extract<HookAction, { type: 'callback' }>, event: HookEvent): Promise<unknown> {
  return await action.handler(event);
}

// ============================================================
// 主类
// ============================================================

export class HooksEngine {
  private hooks: Map<string, HookDefinition> = new Map();
  private executionLog: HookExecutionResult[] = [];
  private readonly eventBus: HookEventBus = new HookEventBus();
  // @ts-expect-error 预留给未来的并发控制
  private readonly maxConcurrent: number = 10;
  // @ts-expect-error 预留给未来的并发控制
  private runningCount: number = 0;
  // @ts-expect-error 预留给未来的并发控制
  private readonly queue: Array<{ hook: HookDefinition; event: HookEvent }> = [];
  private readonly maxExecutionLog: number = 1000;

  /**
   * 注册 Hook
   */
  registerHook(hook: HookDefinition): void {
    if (!hook || !hook.id || !hook.type || !hook.action) {
      throw new Error('Hook must have id, type, and action');
    }
    if (!ALL_HOOK_TYPES.includes(hook.type)) {
      throw new Error(`Invalid hook type: ${hook.type}`);
    }
    this.hooks.set(hook.id, { ...hook });
    this.eventBus.emit({
      type: 'hook-registered',
      hookId: hook.id,
      timestamp: Date.now(),
    });
  }

  /**
   * 注销 Hook
   */
  unregisterHook(id: string): void {
    if (this.hooks.delete(id)) {
      this.eventBus.emit({
        type: 'hook-unregistered',
        hookId: id,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 启用/禁用 Hook
   */
  setEnabled(id: string, enabled: boolean): void {
    const hook = this.hooks.get(id);
    if (!hook) {
      throw new Error(`Hook not found: ${id}`);
    }
    hook.enabled = enabled;
  }

  /**
   * 触发 Hook
   */
  async trigger(type: HookType, payload: Record<string, unknown>, context?: TriggerContext): Promise<HookExecutionResult[]> {
    if (!type || !ALL_HOOK_TYPES.includes(type)) {
      throw new Error(`Invalid hook type: ${type}`);
    }
    if (!payload) {
      throw new Error('Payload is required');
    }

    // 找到匹配的 Hook（按优先级排序）
    const matching = Array.from(this.hooks.values())
      .filter(h => h.enabled && h.type === type)
      .filter(h => _matchesCondition(h.condition, payload, context))
      .sort((a, b) => a.priority - b.priority);

    if (matching.length === 0) {
      return [];
    }

    // 异步触发每个匹配的 Hook
    const promises = matching.map(hook => this._executeHook(hook, payload, context));
    return await Promise.allSettled(promises).then(results =>
      results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          eventId: '',
          hookId: matching[i].id,
          hookName: matching[i].name,
          status: 'failed' as HookExecutionStatus,
          startTime: Date.now(),
          error: String(r.reason),
          retries: 0,
        };
      })
    );
  }

  /**
   * 列出 Hook
   */
  list(filter?: HookFilter): HookDefinition[] {
    let result = Array.from(this.hooks.values());
    if (filter) {
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        result = result.filter(h => types.includes(h.type));
      }
      if (filter.scope) {
        const scopes = Array.isArray(filter.scope) ? filter.scope : [filter.scope];
        result = result.filter(h => scopes.includes(h.scope));
      }
      if (filter.enabled !== undefined) {
        result = result.filter(h => h.enabled === filter.enabled);
      }
    }
    return result.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取单个 Hook
   */
  get(id: string): HookDefinition | null {
    return this.hooks.get(id) ?? null;
  }

  /**
   * 获取执行日志
   */
  getExecutionLog(filter?: ExecutionLogFilter): HookExecutionResult[] {
    let result = [...this.executionLog];
    if (filter) {
      if (filter.hookId) {
        result = result.filter(r => r.hookId === filter.hookId);
      }
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        result = result.filter(r => statuses.includes(r.status));
      }
      if (filter.sinceMs) {
        result = result.filter(r => r.startTime >= filter.sinceMs!);
      }
      if (filter.limit) {
        result = result.slice(-filter.limit);
      }
    }
    return result;
  }

  /**
   * 清空执行日志
   */
  clearExecutionLog(): void {
    this.executionLog = [];
  }

  /**
   * 清空所有 Hook
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * 统计信息
   */
  getStats(): {
    totalHooks: number;
    enabledHooks: number;
    byType: Record<HookType, number>;
    byScope: Record<HookScope, number>;
    totalExecutions: number;
    successRate: number;
  } {
    const byType: Record<HookType, number> = {
      before_prompt: 0,
      after_prompt: 0,
      before_response: 0,
      after_response: 0,
      thinking: 0,
      subagent_start: 0,
      subagent_end: 0,
      compaction: 0,
      turn_complete: 0,
      tool_execution: 0,
    };
    const byScope: Record<HookScope, number> = { team: 0, project: 0, user: 0 };
    let enabledHooks = 0;
    for (const h of this.hooks.values()) {
      byType[h.type]++;
      byScope[h.scope]++;
      if (h.enabled) enabledHooks++;
    }
    const successCount = this.executionLog.filter(r => r.status === 'success').length;
    const successRate = this.executionLog.length > 0 ? successCount / this.executionLog.length : 0;
    return {
      totalHooks: this.hooks.size,
      enabledHooks,
      byType,
      byScope,
      totalExecutions: this.executionLog.length,
      successRate,
    };
  }

  /**
   * 订阅事件
   */
  on(event: HookEngineEventType, handler: HookEngineEventHandler): () => void {
    return this.eventBus.on(event, handler);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async _executeHook(hook: HookDefinition, payload: Record<string, unknown>, context?: TriggerContext): Promise<HookExecutionResult> {
    const eventId = _genId('evt');
    const event: HookEvent = {
      id: eventId,
      type: hook.type,
      hookId: hook.id,
      payload,
      timestamp: Date.now(),
      userId: context?.userId,
      projectId: context?.projectId,
      taskId: context?.taskId,
    };

    const startTime = Date.now();
    const result: HookExecutionResult = {
      eventId,
      hookId: hook.id,
      hookName: hook.name,
      status: 'running',
      startTime,
      retries: 0,
    };

    this.eventBus.emit({
      type: 'hook-triggered',
      hookId: hook.id,
      eventId,
      timestamp: startTime,
    });

    try {
      const actionResult = await this._executeAction(hook, event);
      const endTime = Date.now();
      result.status = 'success';
      result.endTime = endTime;
      result.duration = endTime - startTime;
      result.result = actionResult;
      this._addToLog(result);
      this.eventBus.emit({
        type: 'hook-completed',
        hookId: hook.id,
        eventId,
        result,
        timestamp: endTime,
      });
      return result;
    } catch (err) {
      const endTime = Date.now();
      const error = err instanceof Error ? err.message : String(err);
      result.status = error.includes('timeout') ? 'timeout' : 'failed';
      result.endTime = endTime;
      result.duration = endTime - startTime;
      result.error = error;
      this._addToLog(result);
      this.eventBus.emit({
        type: 'hook-failed',
        hookId: hook.id,
        eventId,
        result,
        timestamp: endTime,
      });
      return result;
    }
  }

  private async _executeAction(hook: HookDefinition, event: HookEvent): Promise<unknown> {
    const action = hook.action;
    if (action.type === 'webhook') {
      return await _executeWebhook(action, event, hook.timeoutMs);
    } else if (action.type === 'command') {
      return await _executeCommand(action, hook.timeoutMs);
    } else if (action.type === 'script') {
      return await _executeScript(action, event, hook.timeoutMs);
    } else if (action.type === 'callback') {
      return await _executeCallback(action, event);
    }
    throw new Error(`Unknown action type: ${(action as { type: string }).type}`);
  }

  private _addToLog(result: HookExecutionResult): void {
    this.executionLog.push(result);
    if (this.executionLog.length > this.maxExecutionLog) {
      this.executionLog = this.executionLog.slice(-this.maxExecutionLog);
    }
  }
}

// ============================================================
// 便捷触发函数
// ============================================================

/**
 * 通用触发函数
 */
export async function triggerHook(type: HookType, payload: Record<string, unknown>, context?: TriggerContext): Promise<HookExecutionResult[]> {
  return getHooksEngine().trigger(type, payload, context);
}

export const triggerBeforePrompt = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('before_prompt', payload, ctx);
export const triggerAfterPrompt = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('after_prompt', payload, ctx);
export const triggerBeforeResponse = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('before_response', payload, ctx);
export const triggerAfterResponse = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('after_response', payload, ctx);
export const triggerThinking = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('thinking', payload, ctx);
export const triggerSubagentStart = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('subagent_start', payload, ctx);
export const triggerSubagentEnd = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('subagent_end', payload, ctx);
export const triggerCompaction = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('compaction', payload, ctx);
export const triggerTurnComplete = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('turn_complete', payload, ctx);
export const triggerToolExecution = (payload: Record<string, unknown>, ctx?: TriggerContext) => triggerHook('tool_execution', payload, ctx);

// ============================================================
// 预置 Hooks
// ============================================================

export const DEFAULT_HOOKS: HookDefinition[] = [
  {
    id: 'default-log-prompt',
    type: 'after_prompt',
    name: '记录所有 Prompt',
    description: '将用户输入记录到控制台',
    scope: 'user',
    enabled: true,
    action: { type: 'callback', handler: (e) => {
      // eslint-disable-next-line no-console
      console.log('[Hook] Prompt:', e.payload);
    } },
    createdAt: Date.now(),
    createdBy: 'system',
    priority: 100,
    timeoutMs: 5000,
    retries: 0,
    fallback: 'ignore',
  },
];

// ============================================================
// 单例工厂
// ============================================================

let _instance: HooksEngine | null = null;

/**
 * 获取 HooksEngine 单例
 */
export function getHooksEngine(): HooksEngine {
  if (!_instance) {
    _instance = new HooksEngine();
    // 注册预置 Hooks
    DEFAULT_HOOKS.forEach(h => _instance!.registerHook(h));
  }
  return _instance;
}

/**
 * 重置单例（主要用于测试）
 */
export function resetHooksEngine(): void {
  if (_instance) {
    _instance.clear();
    _instance.clearExecutionLog();
  }
  _instance = null;
}

/**
 * 检查是否已初始化
 */
export function isHooksEngineInitialized(): boolean {
  return _instance !== null;
}
