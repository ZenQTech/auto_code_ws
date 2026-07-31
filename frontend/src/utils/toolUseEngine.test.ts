/**
 * # ToolUseEngine - 单元测试
 * # Cycle 37 G37-02
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ToolUseEngine,
  createToolUseEngine,
  getDefaultToolUseEngine,
  resetDefaultToolUseEngine,
  generateToolCallId,
  ToolRegistry,
  SchemaValidator,
  ProtocolConverter,
  FunctionExecutor,
  HTTPExecutor,
  MCPExecutor,
  ToolMarketplace,
  registerBuiltinTools,
  BUILTIN_TOOLS,
  calculateRetryDelay,
  isRetryableError,
  DEFAULT_RETRY_POLICY,
  ToolDefinition,
  ToolCall,
  ToolCallResult,
  JSONSchema,
} from './toolUseEngine';

describe('工具函数', () => {
  it('generateToolCallId 格式正确', () => {
    const id = generateToolCallId();
    expect(id).toMatch(/^call_/);
  });

  it('isRetryableError', () => {
    expect(isRetryableError('TIMEOUT', DEFAULT_RETRY_POLICY)).toBe(true);
    expect(isRetryableError('RATE_LIMIT', DEFAULT_RETRY_POLICY)).toBe(true);
    expect(isRetryableError('INVALID_ARGS', DEFAULT_RETRY_POLICY)).toBe(false);
    expect(isRetryableError('PERMISSION_DENIED', DEFAULT_RETRY_POLICY)).toBe(false);
  });

  it('calculateRetryDelay 指数退避', () => {
    const d0 = calculateRetryDelay(0, DEFAULT_RETRY_POLICY);
    const d1 = calculateRetryDelay(1, DEFAULT_RETRY_POLICY);
    const d2 = calculateRetryDelay(2, DEFAULT_RETRY_POLICY);
    expect(d0).toBeGreaterThanOrEqual(900);
    expect(d0).toBeLessThanOrEqual(1100);
    expect(d1).toBeGreaterThanOrEqual(d0 * 1.8);
    expect(d2).toBeGreaterThanOrEqual(d1 * 1.8);
  });

  it('calculateRetryDelay 上限', () => {
    const d = calculateRetryDelay(100, DEFAULT_RETRY_POLICY);
    expect(d).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxDelayMs * 1.1);
  });
});

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  it('校验必需字段', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name'],
    };
    const result = validator.validate({ age: 10 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('校验类型', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        count: { type: 'integer' },
      },
    };
    const result = validator.validate({ count: 'not_number' }, schema);
    expect(result.valid).toBe(false);
  });

  it('校验 enum', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        color: { type: 'string', enum: ['red', 'green', 'blue'] },
      },
    };
    const r1 = validator.validate({ color: 'red' }, schema);
    expect(r1.valid).toBe(true);
    const r2 = validator.validate({ color: 'yellow' }, schema);
    expect(r2.valid).toBe(false);
  });

  it('校验范围', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
    };
    expect(validator.validate({ score: 50 }, schema).valid).toBe(true);
    expect(validator.validate({ score: 150 }, schema).valid).toBe(false);
    expect(validator.validate({ score: -1 }, schema).valid).toBe(false);
  });

  it('校验字符串长度', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 10 },
      },
    };
    expect(validator.validate({ name: 'abc' }, schema).valid).toBe(true);
    expect(validator.validate({ name: 'ab' }, schema).valid).toBe(false);
    expect(validator.validate({ name: 'abcdefghijklm' }, schema).valid).toBe(false);
  });

  it('校验字符串 pattern', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
      },
    };
    expect(validator.validate({ email: 'a@b' }, schema).valid).toBe(true);
    expect(validator.validate({ email: 'invalid' }, schema).valid).toBe(false);
  });

  it('校验数组', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    };
    expect(validator.validate({ tags: ['a', 'b'] }, schema).valid).toBe(true);
    expect(validator.validate({ tags: [1, 2] }, schema).valid).toBe(false);
  });

  it('校验嵌套对象', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
      },
    };
    expect(validator.validate({ user: { name: 'Alice' } }, schema).valid).toBe(true);
    expect(validator.validate({ user: {} }, schema).valid).toBe(false);
  });

  it('additionalProperties false', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    };
    expect(validator.validate({ a: 'x' }, schema).valid).toBe(true);
    expect(validator.validate({ a: 'x', b: 'y' }, schema).valid).toBe(false);
  });
});

describe('FunctionExecutor', () => {
  it('同步函数执行', async () => {
    const executor = new FunctionExecutor((args: any) => args.x * 2);
    const result = await executor.execute(
      { id: 'c1', name: 'test', arguments: { x: 5 } },
      { name: 'test', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' }
    );
    expect(result.success).toBe(true);
    expect(result.result).toBe(10);
  });

  it('异步函数执行', async () => {
    const executor = new FunctionExecutor(async (args: any) => {
      await new Promise(r => setTimeout(r, 5));
      return args.x + 1;
    });
    const result = await executor.execute(
      { id: 'c1', name: 'test', arguments: { x: 5 } },
      { name: 'test', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' }
    );
    expect(result.success).toBe(true);
    expect(result.result).toBe(6);
  });

  it('异常处理', async () => {
    const executor = new FunctionExecutor(() => {
      throw new Error('boom');
    });
    const result = await executor.execute(
      { id: 'c1', name: 'test', arguments: {} },
      { name: 'test', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' }
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });
});

describe('MCPExecutor', () => {
  it('MCP 占位返回错误', async () => {
    const executor = new MCPExecutor('server-1');
    const result = await executor.execute(
      { id: 'c1', name: 'test', arguments: {} },
      { name: 'test', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' }
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });
});

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('register 和 exists', () => {
    registry.register(
      { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => null)
    );
    expect(registry.exists('t1')).toBe(true);
  });

  it('unregister', () => {
    registry.register(
      { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => null)
    );
    expect(registry.unregister('t1')).toBe(true);
    expect(registry.exists('t1')).toBe(false);
  });

  it('enable/disable', () => {
    registry.register(
      { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => null)
    );
    expect(registry.disable('t1')).toBe(true);
    expect(registry.get('t1')?.enabled).toBe(false);
    expect(registry.enable('t1')).toBe(true);
    expect(registry.get('t1')?.enabled).toBe(true);
  });

  it('list 按 category 过滤', () => {
    registry.register(
      { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe', category: 'math' },
      new FunctionExecutor(() => null)
    );
    registry.register(
      { name: 't2', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe', category: 'http' },
      new FunctionExecutor(() => null)
    );
    const list = registry.list({ category: 'math' });
    expect(list.length).toBe(1);
    expect(list[0].definition.name).toBe('t1');
  });

  it('list 按 permission 过滤', () => {
    registry.register(
      { name: 'safe1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => null)
    );
    registry.register(
      { name: 'danger1', description: '', parameters: { type: 'object', properties: {} }, permission: 'dangerous' },
      new FunctionExecutor(() => null)
    );
    const dangerous = registry.list({ permission: 'dangerous' });
    expect(dangerous.length).toBe(1);
    expect(dangerous[0].definition.name).toBe('danger1');
  });

  it('recordCall 和 getStats', () => {
    registry.register(
      { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => null)
    );
    registry.recordCall('t1', true, 100);
    registry.recordCall('t1', true, 200);
    registry.recordCall('t1', false, 50);
    const stats = registry.getStats('t1');
    expect(stats?.callCount).toBe(3);
    expect(stats?.successCount).toBe(2);
    expect(stats?.failureCount).toBe(1);
    expect(stats?.successRate).toBeCloseTo(0.666, 2);
  });

  it('resetStats', () => {
    registry.register(
      { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => null)
    );
    registry.recordCall('t1', true, 100);
    expect(registry.resetStats('t1')).toBe(true);
    expect(registry.getStats('t1')?.callCount).toBe(0);
  });

  it('clear', () => {
    registry.register(
      { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => null)
    );
    registry.clear();
    expect(registry.size()).toBe(0);
  });
});

describe('ProtocolConverter', () => {
  it('toOpenAI', () => {
    const tools: ToolDefinition[] = [
      {
        name: 't1',
        description: 'desc',
        parameters: { type: 'object', properties: { x: { type: 'string' } } },
        permission: 'safe',
      },
    ];
    const openai = ProtocolConverter.toOpenAI(tools);
    expect(openai.length).toBe(1);
    expect(openai[0].type).toBe('function');
    expect(openai[0].function.name).toBe('t1');
    expect(openai[0].function.parameters.properties.x).toBeDefined();
  });

  it('toAnthropic', () => {
    const tools: ToolDefinition[] = [
      {
        name: 't1',
        description: 'desc',
        parameters: { type: 'object', properties: { x: { type: 'string' } } },
        permission: 'safe',
      },
    ];
    const anthropic = ProtocolConverter.toAnthropic(tools);
    expect(anthropic.length).toBe(1);
    expect(anthropic[0].name).toBe('t1');
    expect(anthropic[0].input_schema).toBeDefined();
  });

  it('fromOpenAIFormat', () => {
    const openai = {
      type: 'function' as const,
      function: {
        name: 't1',
        description: 'desc',
        parameters: { type: 'object' as const, properties: { x: { type: 'string' as const } } },
      },
    };
    const def = ProtocolConverter.fromOpenAIFormat(openai);
    expect(def.name).toBe('t1');
    expect(def.permission).toBe('safe');
  });

  it('fromAnthropicFormat', () => {
    const anthropic = {
      name: 't1',
      description: 'desc',
      input_schema: { type: 'object' as const, properties: { x: { type: 'string' as const } } },
    };
    const def = ProtocolConverter.fromAnthropicFormat(anthropic);
    expect(def.name).toBe('t1');
  });
});

describe('ToolUseEngine 主类', () => {
  let engine: ToolUseEngine;

  beforeEach(() => {
    resetDefaultToolUseEngine();
    engine = createToolUseEngine();
  });

  it('创建实例', () => {
    expect(engine).toBeInstanceOf(ToolUseEngine);
  });

  it('registerTool 和 listTools', () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    const tools = engine.listTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('t1');
  });

  it('getTool', () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    expect(engine.getTool('t1')?.name).toBe('t1');
    expect(engine.getTool('not_exist')).toBeUndefined();
  });

  it('enableTool / disableTool', () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    expect(engine.disableTool('t1')).toBe(true);
    expect(engine.listTools({ enabled: true }).length).toBe(0);
    expect(engine.enableTool('t1')).toBe(true);
    expect(engine.listTools({ enabled: true }).length).toBe(1);
  });

  it('unregisterTool', () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    expect(engine.unregisterTool('t1')).toBe(true);
  });

  it('toOpenAIFormat', () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    const formats = engine.toOpenAIFormat();
    expect(formats.length).toBe(1);
    expect(formats[0].function.name).toBe('t1');
  });

  it('toAnthropicFormat', () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    const formats = engine.toAnthropicFormat();
    expect(formats.length).toBe(1);
    expect(formats[0].name).toBe('t1');
  });

  it('parseOpenAIToolCalls', () => {
    const llmResponse = {
      tool_calls: [
        { id: 'call_1', function: { name: 't1', arguments: '{"x": 1}' } },
      ],
    };
    const calls = engine.parseOpenAIToolCalls(llmResponse);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('t1');
    expect(calls[0].arguments.x).toBe(1);
  });

  it('parseOpenAIToolCalls object args', () => {
    const llmResponse = {
      tool_calls: [
        { id: 'call_1', function: { name: 't1', arguments: { x: 1 } } },
      ],
    };
    const calls = engine.parseOpenAIToolCalls(llmResponse);
    expect(calls[0].arguments.x).toBe(1);
  });

  it('parseOpenAIToolCalls 无效 JSON', () => {
    const llmResponse = {
      tool_calls: [
        { id: 'call_1', function: { name: 't1', arguments: '{invalid' } },
      ],
    };
    const calls = engine.parseOpenAIToolCalls(llmResponse);
    expect(calls[0].arguments).toEqual({});
  });

  it('parseAnthropicToolCalls', () => {
    const llmResponse = {
      content: [
        { type: 'text', text: '让我调用工具' },
        { type: 'tool_use', id: 'tu_1', name: 't1', input: { x: 5 } },
      ],
    };
    const calls = engine.parseAnthropicToolCalls(llmResponse);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('t1');
    expect(calls[0].arguments.x).toBe(5);
  });

  it('executeCall 成功', async () => {
    engine.registerTool(
      {
        name: 't1',
        description: 'd',
        parameters: {
          type: 'object',
          properties: { x: { type: 'integer' } },
          required: ['x'],
        },
        permission: 'safe',
      },
      new FunctionExecutor((args: any) => args.x * 2)
    );
    const result = await engine.executeCall({ id: 'c1', name: 't1', arguments: { x: 5 } });
    expect(result.success).toBe(true);
    expect(result.result).toBe(10);
  });

  it('executeCall 工具不存在', async () => {
    const result = await engine.executeCall({ id: 'c1', name: 'not_exist', arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('executeCall 工具禁用', async () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    engine.disableTool('t1');
    const result = await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PERMISSION_DENIED');
  });

  it('executeCall Schema 校验失败', async () => {
    engine.registerTool(
      {
        name: 't1',
        description: 'd',
        parameters: {
          type: 'object',
          properties: { x: { type: 'integer' } },
          required: ['x'],
        },
        permission: 'safe',
      },
      new FunctionExecutor(() => 'ok')
    );
    const result = await engine.executeCall({ id: 'c1', name: 't1', arguments: { x: 'not_int' } });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGS');
  });

  it('executeCall 缺少必需字段', async () => {
    engine.registerTool(
      {
        name: 't1',
        description: 'd',
        parameters: {
          type: 'object',
          properties: { x: { type: 'integer' } },
          required: ['x'],
        },
        permission: 'safe',
      },
      new FunctionExecutor(() => 'ok')
    );
    const result = await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGS');
  });

  it('executeCall 异常', async () => {
    const engine = createToolUseEngine({ maxRetries: 0 });
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => {
        throw new Error('boom');
      })
    );
    const result = await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });

  it('executeCalls 并行', async () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(async (args: any) => {
        await new Promise(r => setTimeout(r, 10));
        return args.x;
      })
    );
    engine.registerTool(
      { name: 't2', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(async (args: any) => {
        await new Promise(r => setTimeout(r, 10));
        return args.y;
      })
    );
    const results = await engine.executeCalls([
      { id: 'c1', name: 't1', arguments: { x: 1 } },
      { id: 'c2', name: 't2', arguments: { y: 2 } },
    ]);
    expect(results.length).toBe(2);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('getHistory', async () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    await engine.executeCall({ id: 'c2', name: 't1', arguments: {} });
    const history = engine.getHistory();
    expect(history.length).toBe(2);
  });

  it('getHistory 过滤器', async () => {
    const localEngine = createToolUseEngine({ maxRetries: 0, timeoutMs: 1000 });
    localEngine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    localEngine.registerTool(
      { name: 't2', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => {
        throw new Error('fail');
      })
    );
    await localEngine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    await localEngine.executeCall({ id: 'c2', name: 't2', arguments: {} });

    const byName = localEngine.getHistory({ name: 't1' });
    expect(byName.length).toBe(1);

    const bySuccess = localEngine.getHistory({ success: false });
    expect(bySuccess.length).toBe(1);
  });

  it('replay 不存在', async () => {
    const result = await engine.replay('not_exist');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('clearHistory', async () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    engine.clearHistory();
    expect(engine.getHistory().length).toBe(0);
  });

  it('getStats', async () => {
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    const stats = engine.getStats();
    expect(stats.totalCalls).toBe(1);
    expect(stats.successCalls).toBe(1);
  });
});

describe('ToolUseEngine 回调', () => {
  it('onToolCall 回调', async () => {
    const engine = createToolUseEngine();
    const calls: any[] = [];
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    (engine as any).onToolCall = (call: any, tool: any) => calls.push({ call, tool });
    await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    expect(calls.length).toBe(1);
    expect(calls[0].call.id).toBe('c1');
  });

  it('onToolResult 回调', async () => {
    const engine = createToolUseEngine();
    const results: any[] = [];
    engine.registerTool(
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      new FunctionExecutor(() => 'ok')
    );
    (engine as any).onToolResult = (r: any) => results.push(r);
    await engine.executeCall({ id: 'c1', name: 't1', arguments: {} });
    expect(results.length).toBe(1);
  });
});

describe('ToolMarketplace', () => {
  let marketplace: ToolMarketplace;

  beforeEach(() => {
    marketplace = new ToolMarketplace();
  });

  it('publish 和 getEntry', () => {
    marketplace.publish({
      id: 't1',
      name: 'Test Tool',
      description: 'desc',
      category: 'math',
      version: '1.0.0',
      author: 'author',
      rating: 4.5,
      downloadCount: 0,
      tags: ['math'],
      definition: { name: 't1', description: 'd', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
    });
    expect(marketplace.getEntry('t1')?.name).toBe('Test Tool');
  });

  it('search', () => {
    marketplace.publish({
      id: 't1',
      name: 'Calculator',
      description: 'math calc',
      category: 'math',
      version: '1.0.0',
      author: 'a',
      rating: 4.5,
      downloadCount: 0,
      tags: ['math'],
      definition: { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
    });
    marketplace.publish({
      id: 't2',
      name: 'Search',
      description: 'web search',
      category: 'search',
      version: '1.0.0',
      author: 'b',
      rating: 4.0,
      downloadCount: 0,
      tags: ['web'],
      definition: { name: 't2', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
    });
    const results = marketplace.search('calc');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Calculator');
  });

  it('search 按 category', () => {
    marketplace.publish({
      id: 't1',
      name: 'a',
      description: '',
      category: 'math',
      version: '1.0.0',
      author: '',
      rating: 0,
      downloadCount: 0,
      tags: [],
      definition: { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
    });
    marketplace.publish({
      id: 't2',
      name: 'b',
      description: '',
      category: 'http',
      version: '1.0.0',
      author: '',
      rating: 0,
      downloadCount: 0,
      tags: [],
      definition: { name: 't2', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
    });
    const results = marketplace.search('', { category: 'math' });
    expect(results.length).toBe(1);
  });

  it('rate', () => {
    marketplace.publish({
      id: 't1',
      name: 'a',
      description: '',
      category: 'math',
      version: '1.0.0',
      author: '',
      rating: 0,
      downloadCount: 0,
      tags: [],
      definition: { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
    });
    marketplace.rate('t1', 5);
    marketplace.rate('t1', 3);
    expect(marketplace.getEntry('t1')?.rating).toBe(4);
  });

  it('install', async () => {
    marketplace.publish({
      id: 't1',
      name: 'a',
      description: '',
      category: 'math',
      version: '1.0.0',
      author: '',
      rating: 0,
      downloadCount: 0,
      tags: [],
      definition: { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => 'ok') }),
    });
    const engine = createToolUseEngine();
    const installed = await marketplace.install('t1', engine);
    expect(installed).toBe(true);
    expect(engine.getTool('t1')).toBeDefined();
  });

  it('uninstall', () => {
    marketplace.publish({
      id: 't1',
      name: 'a',
      description: '',
      category: 'math',
      version: '1.0.0',
      author: '',
      rating: 0,
      downloadCount: 0,
      tags: [],
      definition: { name: 't1', description: '', parameters: { type: 'object', properties: {} }, permission: 'safe' },
      installHandler: async () => ({ executor: new FunctionExecutor(() => null) }),
    });
    const engine = createToolUseEngine();
    expect(marketplace.uninstall('t1', engine)).toBe(false); // 还没安装
  });
});

describe('内置工具', () => {
  it('BUILTIN_TOOLS 列表非空', () => {
    expect(BUILTIN_TOOLS.length).toBeGreaterThan(0);
  });

  it('registerBuiltinTools', () => {
    const engine = createToolUseEngine();
    registerBuiltinTools(engine);
    expect(engine.getTool('calculator')).toBeDefined();
    expect(engine.getTool('get_current_time')).toBeDefined();
    expect(engine.getTool('search_web')).toBeDefined();
  });

  it('calculator 执行', async () => {
    const engine = createToolUseEngine();
    registerBuiltinTools(engine);
    const result = await engine.executeCall({ id: 'c1', name: 'calculator', arguments: { expression: '1+2*3' } });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ result: 7 });
  });

  it('get_current_time 执行', async () => {
    const engine = createToolUseEngine();
    registerBuiltinTools(engine);
    const result = await engine.executeCall({ id: 'c1', name: 'get_current_time', arguments: { format: 'timestamp' } });
    expect(result.success).toBe(true);
  });
});

describe('全局单例', () => {
  beforeEach(() => {
    resetDefaultToolUseEngine();
  });

  it('getDefaultToolUseEngine 单例', () => {
    const e1 = getDefaultToolUseEngine();
    const e2 = getDefaultToolUseEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefaultToolUseEngine', () => {
    const e1 = getDefaultToolUseEngine();
    resetDefaultToolUseEngine();
    const e2 = getDefaultToolUseEngine();
    expect(e1).not.toBe(e2);
  });
});
