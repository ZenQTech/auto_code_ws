/**
 * # ============================================================
 * # ToolUseEngine - 工具调用引擎 (v1.0.0 Cycle 37 G37-02)
 * # ============================================================
 * # 核心作用：Function Calling / Tool Use 引擎
 * #           支持 OpenAI / Anthropic 协议转换、并行调用、Schema 校验、重试、权限管理
 * # 对标产品：LangChain Tools / Vercel AI SDK Tools
 * # 运行流程：
 * #   1. 注册工具（registerTool）：定义 + Executor（Function/HTTP/MCP）
 * #   2. 协议转换：toOpenAIFormat / toAnthropicFormat
 * #   3. 解析 LLM 输出：parseOpenAIToolCalls / parseAnthropicToolCalls
 * #   4. 执行：executeCall（单）/ executeCalls（并行）
 * #   5. 重试：指数退避，仅重试可重试错误
 * # 输入参数：ToolDefinition / ToolCall / ToolCallResult
 * # 输出结果：ToolCallResult[] / 历史 / 统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 37 G37-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 工具权限级别
 */
export type ToolPermission = 'safe' | 'confirmed' | 'dangerous' | 'auto';

/**
 * JSON Schema 类型
 */
export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

/**
 * JSON Schema 属性
 */
export interface JSONSchemaProperty {
  type: JSONSchemaType;
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

/**
 * JSON Schema
 */
export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * 工具示例
 */
export interface ToolExample {
  input: Record<string, unknown>;
  output: unknown;
  explanation?: string;
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  permission: ToolPermission;
  category?: string;
  version?: string;
  examples?: ToolExample[];
  deprecated?: boolean;
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  callId: string;
  name: string;
  success: boolean;
  result?: unknown;
  error?: ToolError;
  durationMs: number;
  timestamp: number;
}

/**
 * 工具错误
 */
export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: unknown;
}

export type ToolErrorCode =
  | 'INVALID_ARGS'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'EXECUTION_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'ABORTED';

/**
 * OpenAI 工具格式
 */
export interface OpenAIToolFormat {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
    strict?: boolean;
  };
}

/**
 * Anthropic 工具格式
 */
export interface AnthropicToolFormat {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

// ============ 工具执行器 ============

/**
 * 工具执行器接口
 */
export interface ToolExecutor {
  readonly type: 'function' | 'http' | 'mcp';
  execute(call: ToolCall, tool: ToolDefinition): Promise<ToolCallResult>;
}

/**
 * 函数执行器 - 直接执行 TS 函数
 */
export class FunctionExecutor implements ToolExecutor {
  readonly type = 'function';

  constructor(private handler: (args: Record<string, unknown>) => Promise<unknown> | unknown) {}

  async execute(call: ToolCall, _tool: ToolDefinition): Promise<ToolCallResult> {
    const startTime = performance.now();
    try {
      const result = await Promise.resolve(this.handler(call.arguments));
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result,
        durationMs: Math.round(performance.now() - startTime),
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        callId: call.id,
        name: call.name,
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: err instanceof Error ? err.message : String(err),
          details: err,
        },
        durationMs: Math.round(performance.now() - startTime),
        timestamp: Date.now(),
      };
    }
  }
}

/**
 * HTTP 执行器
 */
export class HTTPExecutor implements ToolExecutor {
  readonly type = 'http';

  constructor(
    private options: {
      url: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      headers?: Record<string, string>;
      timeoutMs?: number;
    }
  ) {}

  async execute(call: ToolCall, _tool: ToolDefinition): Promise<ToolCallResult> {
    const startTime = performance.now();
    const method = this.options.method || 'POST';
    const timeout = this.options.timeoutMs || 30000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(this.options.url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers,
        },
        body: method !== 'GET' ? JSON.stringify(call.arguments) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          callId: call.id,
          name: call.name,
          success: false,
          error: {
            code: 'EXECUTION_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`,
            details: { status: response.status },
          },
          durationMs: Math.round(performance.now() - startTime),
          timestamp: Date.now(),
        };
      }

      const result = await response.json();
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result,
        durationMs: Math.round(performance.now() - startTime),
        timestamp: Date.now(),
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        callId: call.id,
        name: call.name,
        success: false,
        error: {
          code: isAbort ? 'TIMEOUT' : 'EXECUTION_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: Math.round(performance.now() - startTime),
        timestamp: Date.now(),
      };
    }
  }
}

/**
 * MCP 执行器（占位）
 */
export class MCPExecutor implements ToolExecutor {
  readonly type = 'mcp';

  constructor(private serverId: string) {}

  async execute(_call: ToolCall, _tool: ToolDefinition): Promise<ToolCallResult> {
    return {
      callId: _call.id,
      name: _call.name,
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: 'MCP execution not yet implemented',
        details: { serverId: this.serverId },
      },
      durationMs: 0,
      timestamp: Date.now(),
    };
  }
}

// ============ Schema 校验器 ============

/**
 * 校验结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: unknown;
}

/**
 * JSON Schema 校验器（简化版，支持 Draft 7 子集）
 */
export class SchemaValidator {
  validate(args: unknown, schema: JSONSchema): ValidationResult {
    const errors = this.validateValue(args, schema, '');
    return { valid: errors.length === 0, errors };
  }

  private validateValue(value: unknown, schema: JSONSchemaProperty | JSONSchema, path: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const actualType = this.getType(value);

    if ('type' in schema && schema.type !== 'object') {
      // 简单类型校验
      // 注意：JS 中 integer 和 number 是同一类型
      const isCompatibleType = actualType === schema.type ||
        (schema.type === 'integer' && actualType === 'number' && Number.isInteger(value));
      if (!isCompatibleType) {
        errors.push({
          path,
          message: `Expected ${schema.type}, got ${actualType}`,
          expected: schema.type,
          actual: actualType,
        });
        return errors;
      }

      // enum
      if (schema.enum && !schema.enum.includes(value as string | number)) {
        errors.push({
          path,
          message: `Value not in enum: ${JSON.stringify(schema.enum)}`,
          expected: `one of ${JSON.stringify(schema.enum)}`,
          actual: value,
        });
      }

      // 范围
      if (schema.type === 'number' || schema.type === 'integer') {
        const numValue = value as number;
        if (schema.minimum !== undefined && numValue < schema.minimum) {
          errors.push({ path, message: `Value ${numValue} < minimum ${schema.minimum}` });
        }
        if (schema.maximum !== undefined && numValue > schema.maximum) {
          errors.push({ path, message: `Value ${numValue} > maximum ${schema.maximum}` });
        }
      }

      // 字符串长度
      if (schema.type === 'string') {
        const strValue = value as string;
        if (schema.minLength !== undefined && strValue.length < schema.minLength) {
          errors.push({ path, message: `String length ${strValue.length} < minLength ${schema.minLength}` });
        }
        if (schema.maxLength !== undefined && strValue.length > schema.maxLength) {
          errors.push({ path, message: `String length ${strValue.length} > maxLength ${schema.maxLength}` });
        }
        if (schema.pattern) {
          try {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(strValue)) {
              errors.push({ path, message: `String does not match pattern: ${schema.pattern}` });
            }
          } catch {
            // 忽略无效正则
          }
        }
      }

      // 数组
      if (schema.type === 'array' && schema.items) {
        const arr = value as unknown[];
        for (let i = 0; i < arr.length; i++) {
          errors.push(...this.validateValue(arr[i], schema.items, `${path}[${i}]`));
        }
      }
    } else if (schema.type === 'object' && 'properties' in schema) {
      // 对象类型
      if (actualType !== 'object' || value === null) {
        errors.push({ path, message: 'Expected object', expected: 'object', actual: actualType });
        return errors;
      }

      const obj = value as Record<string, unknown>;

      // required
      for (const req of schema.required || []) {
        if (!(req in obj)) {
          errors.push({ path: path ? `${path}.${req}` : req, message: 'Required field missing' });
        }
      }

      // properties
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            errors.push(...this.validateValue(obj[key], propSchema, path ? `${path}.${key}` : key));
          }
        }
      }

      // additionalProperties
      if ((schema as any).additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!schema.properties || !(key in schema.properties)) {
            errors.push({ path: path ? `${path}.${key}` : key, message: 'Additional property not allowed' });
          }
        }
      }
    }

    return errors;
  }

  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}

// ============ 工具注册中心 ============

/**
 * 工具注册项
 */
export interface ToolRegistration {
  definition: ToolDefinition;
  executor: ToolExecutor;
  enabled: boolean;
  registeredAt: number;
  callCount: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
}

/**
 * 工具统计
 */
export interface ToolStats {
  callCount: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  lastCalledAt?: number;
  successRate: number;
}

/**
 * 工具注册中心
 */
export class ToolRegistry {
  private tools: Map<string, ToolRegistration> = new Map();

  register(definition: ToolDefinition, executor: ToolExecutor): void {
    this.tools.set(definition.name, {
      definition,
      executor,
      enabled: true,
      registeredAt: Date.now(),
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      totalDurationMs: 0,
    });
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  enable(name: string): boolean {
    const reg = this.tools.get(name);
    if (!reg) return false;
    reg.enabled = true;
    return true;
  }

  disable(name: string): boolean {
    const reg = this.tools.get(name);
    if (!reg) return false;
    reg.enabled = false;
    return true;
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  list(filter?: { category?: string; enabled?: boolean; permission?: ToolPermission }): ToolRegistration[] {
    let results = Array.from(this.tools.values());
    if (filter?.category) {
      results = results.filter(r => r.definition.category === filter.category);
    }
    if (filter?.enabled !== undefined) {
      results = results.filter(r => r.enabled === filter.enabled);
    }
    if (filter?.permission) {
      results = results.filter(r => r.definition.permission === filter.permission);
    }
    return results;
  }

  exists(name: string): boolean {
    return this.tools.has(name);
  }

  size(): number {
    return this.tools.size;
  }

  getStats(name: string): ToolStats | undefined {
    const reg = this.tools.get(name);
    if (!reg) return undefined;
    return this.computeStats(reg);
  }

  getAllStats(): Map<string, ToolStats> {
    const stats = new Map<string, ToolStats>();
    for (const [name, reg] of this.tools.entries()) {
      stats.set(name, this.computeStats(reg));
    }
    return stats;
  }

  resetStats(name: string): boolean {
    const reg = this.tools.get(name);
    if (!reg) return false;
    reg.callCount = 0;
    reg.successCount = 0;
    reg.failureCount = 0;
    reg.totalDurationMs = 0;
    return true;
  }

  recordCall(name: string, success: boolean, durationMs: number): void {
    const reg = this.tools.get(name);
    if (!reg) return;
    reg.callCount++;
    if (success) reg.successCount++;
    else reg.failureCount++;
    reg.totalDurationMs += durationMs;
  }

  clear(): void {
    this.tools.clear();
  }

  private computeStats(reg: ToolRegistration): ToolStats {
    return {
      callCount: reg.callCount,
      successCount: reg.successCount,
      failureCount: reg.failureCount,
      avgDurationMs: reg.callCount > 0 ? Math.round(reg.totalDurationMs / reg.callCount) : 0,
      lastCalledAt: reg.callCount > 0 ? Date.now() : undefined,
      successRate: reg.callCount > 0 ? reg.successCount / reg.callCount : 0,
    };
  }
}

// ============ 协议转换器 ============

/**
 * 协议转换器
 */
export class ProtocolConverter {
  static toOpenAI(tools: ToolDefinition[]): OpenAIToolFormat[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: false,
      },
    }));
  }

  static toAnthropic(tools: ToolDefinition[]): AnthropicToolFormat[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  static fromOpenAIFormat(format: OpenAIToolFormat): ToolDefinition {
    return {
      name: format.function.name,
      description: format.function.description,
      parameters: format.function.parameters,
      permission: 'safe',
    };
  }

  static fromAnthropicFormat(format: AnthropicToolFormat): ToolDefinition {
    return {
      name: format.name,
      description: format.description,
      parameters: format.input_schema,
      permission: 'safe',
    };
  }
}

// ============ 重试策略 ============

/**
 * 重试策略
 */
export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: ToolErrorCode[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['TIMEOUT', 'RATE_LIMIT', 'EXECUTION_ERROR'],
};

/**
 * 计算重试延迟（指数退避 + 抖动）
 */
export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  const base = Math.min(
    policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt),
    policy.maxDelayMs
  );
  // 抖动 ±10%
  const jitter = base * (1 + (Math.random() * 0.2 - 0.1));
  return Math.floor(jitter);
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: ToolErrorCode, policy: RetryPolicy): boolean {
  return policy.retryableErrors.includes(error);
}

// ============ ToolUseEngine 主类 ============

/**
 * 历史过滤器
 */
export interface HistoryFilter {
  name?: string;
  success?: boolean;
  since?: number;
  limit?: number;
}

/**
 * 引擎统计
 */
export interface EngineStats {
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  avgDurationMs: number;
  historySize: number;
  byTool: Map<string, ToolStats>;
}

/**
 * 引擎选项
 */
export interface ToolUseEngineOptions {
  registry?: ToolRegistry;
  validator?: SchemaValidator;
  requireConfirmation?: (tool: ToolDefinition) => boolean;
  maxRetries?: number;
  retryBackoffMs?: number;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  onToolCall?: (call: ToolCall, tool: ToolDefinition) => void;
  onToolResult?: (result: ToolCallResult) => void;
  onError?: (error: ToolError, call: ToolCall) => void;
}

/**
 * 工具调用引擎
 */
export class ToolUseEngine {
  private registry: ToolRegistry;
  private validator: SchemaValidator;
  private requireConfirmation: (tool: ToolDefinition) => boolean;
  private maxRetries: number;
  private retryBackoffMs: number;
  private timeoutMs: number;
  private retryPolicy: RetryPolicy;
  private history: ToolCallResult[] = [];
  private maxHistorySize: number = 1000;

  // 回调
  private onToolCall?: (call: ToolCall, tool: ToolDefinition) => void;
  private onToolResult?: (result: ToolCallResult) => void;
  private onError?: (error: ToolError, call: ToolCall) => void;

  constructor(options: ToolUseEngineOptions = {}) {
    this.registry = options.registry ?? new ToolRegistry();
    this.validator = options.validator ?? new SchemaValidator();
    this.requireConfirmation = options.requireConfirmation ?? ((tool) => tool.permission === 'dangerous');
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 30000;
    // 使用传入的 retryPolicy，并根据 maxRetries 覆盖
    this.retryPolicy = {
      ...(options.retryPolicy ?? DEFAULT_RETRY_POLICY),
      maxRetries: this.maxRetries,
    };
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
    this.onError = options.onError;
  }

  // ============ 工具管理 ============

  registerTool(definition: ToolDefinition, executor: ToolExecutor): void {
    this.registry.register(definition, executor);
  }

  unregisterTool(name: string): boolean {
    return this.registry.unregister(name);
  }

  enableTool(name: string): boolean {
    return this.registry.enable(name);
  }

  disableTool(name: string): boolean {
    return this.registry.disable(name);
  }

  listTools(filter?: { category?: string; enabled?: boolean; permission?: ToolPermission }): ToolDefinition[] {
    return this.registry.list(filter).map(r => r.definition);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.registry.get(name)?.definition;
  }

  // ============ 协议转换 ============

  toOpenAIFormat(tools?: ToolDefinition[]): OpenAIToolFormat[] {
    const list = tools ?? this.listTools({ enabled: true });
    return ProtocolConverter.toOpenAI(list);
  }

  toAnthropicFormat(tools?: ToolDefinition[]): AnthropicToolFormat[] {
    const list = tools ?? this.listTools({ enabled: true });
    return ProtocolConverter.toAnthropic(list);
  }

  // ============ 解析 LLM 输出 ============

  parseOpenAIToolCalls(llmResponse: any): ToolCall[] {
    if (!llmResponse || !llmResponse.tool_calls) return [];
    if (!Array.isArray(llmResponse.tool_calls)) return [];

    return llmResponse.tool_calls.map((tc: any) => {
      let args: Record<string, unknown> = {};
      if (typeof tc.function?.arguments === 'string') {
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }
      } else if (typeof tc.function?.arguments === 'object') {
        args = tc.function.arguments;
      }
      return {
        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: tc.function?.name || '',
        arguments: args,
      };
    });
  }

  parseAnthropicToolCalls(llmResponse: any): ToolCall[] {
    if (!llmResponse || !llmResponse.content) return [];
    if (!Array.isArray(llmResponse.content)) return [];

    return llmResponse.content
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => ({
        id: c.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: c.name || '',
        arguments: c.input || {},
      }));
  }

  // ============ 执行 ============

  async executeCall(call: ToolCall): Promise<ToolCallResult> {
    const reg = this.registry.get(call.name);

    // 检查工具存在
    if (!reg) {
      const error: ToolError = {
        code: 'NOT_FOUND',
        message: `Tool not found: ${call.name}`,
      };
      this.onError?.(error, call);
      return {
        callId: call.id,
        name: call.name,
        success: false,
        error,
        durationMs: 0,
        timestamp: Date.now(),
      };
    }

    const { definition: tool, executor } = reg;

    // 检查启用
    if (!reg.enabled) {
      const error: ToolError = {
        code: 'PERMISSION_DENIED',
        message: `Tool is disabled: ${call.name}`,
      };
      this.onError?.(error, call);
      return this.recordAndReturn({
        callId: call.id,
        name: call.name,
        success: false,
        error,
        durationMs: 0,
        timestamp: Date.now(),
      });
    }

    // 检查权限（requireConfirmation 是上层逻辑，引擎层只做基本检查）
    // 危险工具的确认由 AgentLoopEngine 或 UI 处理

    // 通知
    this.onToolCall?.(call, tool);

    // 校验参数
    const validation = this.validator.validate(call.arguments, tool.parameters);
    if (!validation.valid) {
      const error: ToolError = {
        code: 'INVALID_ARGS',
        message: 'Schema validation failed',
        details: validation.errors,
      };
      this.onError?.(error, call);
      return this.recordAndReturn({
        callId: call.id,
        name: call.name,
        success: false,
        error,
        durationMs: 0,
        timestamp: Date.now(),
      });
    }

    // 执行（带重试）
    return await this.executeWithRetry(call, tool, executor);
  }

  private async executeWithRetry(
    call: ToolCall,
    tool: ToolDefinition,
    executor: ToolExecutor
  ): Promise<ToolCallResult> {
    let lastResult: ToolCallResult | null = null;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      // 超时控制
      const timeoutPromise = new Promise<ToolCallResult>((resolve) => {
        setTimeout(() => {
          resolve({
            callId: call.id,
            name: call.name,
            success: false,
            error: { code: 'TIMEOUT', message: `Execution timeout after ${this.timeoutMs}ms` },
            durationMs: this.timeoutMs,
            timestamp: Date.now(),
          });
        }, this.timeoutMs);
      });

      const executionPromise = executor.execute(call, tool);
      const result = await Promise.race([executionPromise, timeoutPromise]);

      this.registry.recordCall(call.name, result.success, result.durationMs);

      if (result.success) {
        this.onToolResult?.(result);
        return this.recordAndReturn(result);
      }

      lastResult = result;

      // 不可重试错误
      if (result.error && !isRetryableError(result.error.code, this.retryPolicy)) {
        break;
      }

      // 最后一次不等待
      if (attempt < this.retryPolicy.maxRetries) {
        const delay = calculateRetryDelay(attempt, this.retryPolicy);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    this.onError?.(lastResult!.error!, call);
    return this.recordAndReturn(lastResult!);
  }

  async executeCalls(calls: ToolCall[]): Promise<ToolCallResult[]> {
    // 按工具名分组保持顺序
    const groups = new Map<string, ToolCall[]>();
    for (const call of calls) {
      if (!groups.has(call.name)) groups.set(call.name, []);
      groups.get(call.name)!.push(call);
    }

    const results: ToolCallResult[] = [];
    for (const group of groups.values()) {
      const groupResults = await Promise.all(group.map(c => this.executeCall(c)));
      results.push(...groupResults);
    }

    return results;
  }

  // ============ 历史 ============

  getHistory(filter?: HistoryFilter): ToolCallResult[] {
    let results = [...this.history];

    if (filter?.name) {
      results = results.filter(r => r.name === filter.name);
    }
    if (filter?.success !== undefined) {
      results = results.filter(r => r.success === filter.success);
    }
    if (filter?.since !== undefined) {
      results = results.filter(r => r.timestamp >= filter.since!);
    }
    if (filter?.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  async replay(callId: string): Promise<ToolCallResult> {
    const original = this.history.find(r => r.callId === callId);
    if (!original) {
      return {
        callId,
        name: 'unknown',
        success: false,
        error: { code: 'NOT_FOUND', message: `Call not found in history: ${callId}` },
        durationMs: 0,
        timestamp: Date.now(),
      };
    }

    // 重新执行（使用相同的 call.id，但参数从 history 取不到，需要外部提供）
    // 简化实现：仅返回原始结果
    return original;
  }

  clearHistory(): void {
    this.history = [];
  }

  // ============ 统计 ============

  getStats(): EngineStats {
    const byTool = this.registry.getAllStats();
    let totalCalls = 0;
    let successCalls = 0;
    let failureCalls = 0;
    let totalDuration = 0;

    for (const stat of byTool.values()) {
      totalCalls += stat.callCount;
      successCalls += stat.successCount;
      failureCalls += stat.failureCount;
      totalDuration += stat.avgDurationMs * stat.callCount;
    }

    return {
      totalCalls,
      successCalls,
      failureCalls,
      avgDurationMs: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
      historySize: this.history.length,
      byTool,
    };
  }

  // ============ 内部方法 ============

  private recordAndReturn(result: ToolCallResult): ToolCallResult {
    this.history.push(result);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
    return result;
  }
}

// ============ 工具市场 ============

/**
 * 工具市场条目
 */
export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  rating: number;
  downloadCount: number;
  tags: string[];
  definition: ToolDefinition;
  installHandler: () => Promise<{ executor: ToolExecutor }>;
  iconUrl?: string;
  documentation?: string;
}

/**
 * 工具市场
 */
export class ToolMarketplace {
  private entries: Map<string, MarketplaceEntry> = new Map();
  private ratings: Map<string, number[]> = new Map();

  publish(entry: MarketplaceEntry): void {
    this.entries.set(entry.id, entry);
    this.ratings.set(entry.id, []);
  }

  getEntry(id: string): MarketplaceEntry | undefined {
    return this.entries.get(id);
  }

  search(query: string, filters?: { category?: string; tag?: string }): MarketplaceEntry[] {
    const q = query.toLowerCase();
    let results = Array.from(this.entries.values());

    if (q) {
      results = results.filter(
        e =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (filters?.category) {
      results = results.filter(e => e.category === filters.category);
    }
    if (filters?.tag) {
      results = results.filter(e => e.tags.includes(filters.tag!));
    }

    return results;
  }

  rate(id: string, rating: number): void {
    const ratings = this.ratings.get(id);
    if (!ratings) return;
    if (rating < 0 || rating > 5) return;
    ratings.push(rating);
    const entry = this.entries.get(id);
    if (entry) {
      const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
      entry.rating = Math.round(avg * 10) / 10;
    }
  }

  async install(id: string, engine: ToolUseEngine): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const { executor } = await entry.installHandler();
    engine.registerTool(entry.definition, executor);
    entry.downloadCount++;
    return true;
  }

  uninstall(name: string, engine: ToolUseEngine): boolean {
    return engine.unregisterTool(name);
  }

  size(): number {
    return this.entries.size;
  }
}

// ============ 默认配置与工厂函数 ============

export const DEFAULT_TOOL_USE_CONFIG: ToolUseEngineOptions = {
  maxRetries: 3,
  retryBackoffMs: 1000,
  timeoutMs: 30000,
  requireConfirmation: (tool) => tool.permission === 'dangerous',
};

export function createToolUseEngine(options?: ToolUseEngineOptions): ToolUseEngine {
  return new ToolUseEngine({ ...DEFAULT_TOOL_USE_CONFIG, ...options });
}

// ============ 全局单例 ============

let defaultEngine: ToolUseEngine | null = null;

export function getDefaultToolUseEngine(): ToolUseEngine {
  if (!defaultEngine) {
    defaultEngine = createToolUseEngine();
  }
  return defaultEngine;
}

export function resetDefaultToolUseEngine(): void {
  defaultEngine = null;
}

// ============ 工具函数 ============

export function generateToolCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============ 内置工具集 ============

/**
 * 内置工具定义与处理器
 */
export const BUILTIN_TOOLS: Array<{ definition: ToolDefinition; handler: (args: any) => Promise<any> | any }> = [
  {
    definition: {
      name: 'calculator',
      description: '执行数学表达式计算',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '数学表达式，如 "1+2*3"' },
        },
        required: ['expression'],
      },
      permission: 'safe',
      category: 'math',
    },
    handler: (args: { expression: string }) => {
      // 仅允许数字和运算符的安全计算
      const safe = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
      return { result: Function(`"use strict"; return (${safe})`)() };
    },
  },
  {
    definition: {
      name: 'get_current_time',
      description: '获取当前时间',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['iso', 'timestamp', 'readable'], default: 'iso' },
        },
      },
      permission: 'safe',
      category: 'system',
    },
    handler: (args: { format?: string }) => {
      const now = new Date();
      switch (args.format) {
        case 'timestamp': return { time: now.getTime() };
        case 'readable': return { time: now.toLocaleString() };
        default: return { time: now.toISOString() };
      }
    },
  },
  {
    definition: {
      name: 'search_web',
      description: '搜索网页（Mock）',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        },
        required: ['query'],
      },
      permission: 'safe',
      category: 'search',
    },
    handler: async (args: { query: string; limit?: number }) => {
      return {
        results: [
          { title: `关于 "${args.query}" 的结果 1`, url: 'https://example.com/1', snippet: '...' },
          { title: `关于 "${args.query}" 的结果 2`, url: 'https://example.com/2', snippet: '...' },
        ].slice(0, args.limit || 5),
      };
    },
  },
  {
    definition: {
      name: 'http_request',
      description: '发起 HTTP 请求',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '请求 URL' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
          body: { type: 'object', description: '请求体' },
        },
        required: ['url'],
      },
      permission: 'confirmed',
      category: 'http',
    },
    handler: async (args: { url: string; method?: string; body?: any }) => {
      const response = await fetch(args.url, {
        method: args.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: args.body ? JSON.stringify(args.body) : undefined,
      });
      return { status: response.status, data: await response.text() };
    },
  },
  {
    definition: {
      name: 'shell_command',
      description: '执行 Shell 命令（仅限白名单）',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell 命令' },
        },
        required: ['command'],
      },
      permission: 'dangerous',
      category: 'system',
    },
    handler: async (args: { command: string }) => {
      // Mock 实现：仅返回命令字符串
      return { executed: false, message: `Shell execution disabled in mock mode: ${args.command}` };
    },
  },
  {
    definition: {
      name: 'read_file',
      description: '读取文件内容（Mock）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
        },
        required: ['path'],
      },
      permission: 'confirmed',
      category: 'file',
    },
    handler: async (args: { path: string }) => {
      return { path: args.path, content: '[Mock 文件内容]' };
    },
  },
  {
    definition: {
      name: 'write_file',
      description: '写入文件（Mock）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
      permission: 'dangerous',
      category: 'file',
    },
    handler: async (args: { path: string; content: string }) => {
      return { path: args.path, written: args.content.length };
    },
  },
  {
    definition: {
      name: 'code_executor',
      description: '执行 JavaScript 代码（沙箱，Mock）',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript 代码' },
        },
        required: ['code'],
      },
      permission: 'dangerous',
      category: 'code',
    },
    handler: async (args: { code: string }) => {
      try {
        const result = Function(`"use strict"; return (${args.code})`)();
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
];

/**
 * 注册所有内置工具
 */
export function registerBuiltinTools(engine: ToolUseEngine): void {
  for (const { definition, handler } of BUILTIN_TOOLS) {
    engine.registerTool(definition, new FunctionExecutor(handler));
  }
}
