# SPEC: G37-02 ToolUseEngine (工具调用引擎)

## 基本信息
- **任务编号**: G37-02
- **任务名称**: ToolUseEngine - Function Calling / Tool Use 引擎
- **优先级**: P0
- **依赖**: Cycle 36 LLMProviderAdapter
- **可被依赖**: G37-03 AgentLoopEngine
- **周期**: Cycle 37 (2026-07-31)

---

## 一、设计目标

构建一个生产可用的 Function Calling / Tool Use 引擎，支持：
- 工具注册 / 注销 / 权限分级（safe / confirmed / dangerous）
- OpenAI Function Calling 协议（DeepSeek 兼容）
- Anthropic Tool Use 协议
- 工具执行器（本地函数 / HTTP / MCP 占位）
- 并行工具调用
- 调用历史记录与回放
- 错误处理与指数退避重试
- 工具市场（Tool Marketplace）UI
- Schema 严格校验（JSON Schema Draft 7）

## 二、核心组件

### 2.1 ToolDefinition（工具定义）
```typescript
export type ToolPermission = 'safe' | 'confirmed' | 'dangerous';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;        // JSON Schema Draft 7
  permission: ToolPermission;
  category?: string;             // 'search' | 'math' | 'file' | 'http' | 'code' | 'system'
  version?: string;              // '1.0.0'
  examples?: ToolExample[];      // Few-shot
  deprecated?: boolean;
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  items?: JSONSchemaProperty;      // for array
  properties?: Record<string, JSONSchemaProperty>; // for object
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface ToolExample {
  input: Record<string, unknown>;
  output: unknown;
  explanation?: string;
}
```

### 2.2 ToolCall（工具调用）
```typescript
export interface ToolCall {
  id: string;                    // call_xxx
  name: string;                  // 工具名
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  callId: string;
  name: string;
  success: boolean;
  result?: unknown;
  error?: ToolError;
  durationMs: number;
  timestamp: number;
}

export interface ToolError {
  code: 'INVALID_ARGS' | 'PERMISSION_DENIED' | 'TIMEOUT' | 'EXECUTION_ERROR' | 'NOT_FOUND' | 'RATE_LIMIT';
  message: string;
  details?: unknown;
}
```

### 2.3 Executors（执行器）
```typescript
export interface ToolExecutor {
  readonly type: 'function' | 'http' | 'mcp';
  execute(call: ToolCall, tool: ToolDefinition): Promise<ToolCallResult>;
  validate?(args: Record<string, unknown>, tool: ToolDefinition): ValidationResult;
}

export class FunctionExecutor implements ToolExecutor {
  // 直接执行注册的 TS 函数
  // 函数签名: (args: any) => Promise<any> | any
}

export class HTTPExecutor implements ToolExecutor {
  // 调用 HTTP API
  // 配置: { url, method, headers, timeoutMs }
  // 自动将 args 作为请求体
}

export class MCPExecutor implements ToolExecutor {
  // 通过 MCP 协议调用（占位实现）
  // 未来对接 MCP 服务
}
```

### 2.4 Registry（工具注册中心）
```typescript
export interface ToolRegistration {
  definition: ToolDefinition;
  executor: ToolExecutor;
  enabled: boolean;
  registeredAt: number;
  callCount: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
}

export class ToolRegistry {
  // 注册
  register(
    definition: ToolDefinition,
    executor: ToolExecutor
  ): void;
  unregister(name: string): boolean;
  enable(name: string): boolean;
  disable(name: string): boolean;
  
  // 查询
  get(name: string): ToolRegistration | undefined;
  list(filter?: { category?: string; enabled?: boolean; permission?: ToolPermission }): ToolRegistration[];
  exists(name: string): boolean;
  
  // 统计
  getStats(name?: string): ToolStats | Map<string, ToolStats>;
  resetStats(name: string): boolean;
}

export interface ToolStats {
  callCount: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  lastCalledAt?: number;
  successRate: number;
}
```

### 2.5 SchemaValidator（参数校验器）
```typescript
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;                  // 'args.url'
  message: string;
  expected?: string;
  actual?: unknown;
}

export class SchemaValidator {
  // 完整实现 JSON Schema Draft 7 校验
  // 支持: type / required / enum / pattern / range / format
  validate(args: unknown, schema: JSONSchema): ValidationResult;
}
```

### 2.6 ProtocolConverter（协议转换器）
```typescript
export interface OpenAIToolFormat {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
    strict?: boolean;
  };
}

export interface AnthropicToolFormat {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

export class ProtocolConverter {
  // 内部 ToolDefinition ↔ OpenAI / Anthropic 格式
  static toOpenAI(tools: ToolDefinition[]): OpenAIToolFormat[];
  static toAnthropic(tools: ToolDefinition[]): AnthropicToolFormat[];
  static fromOpenAIFormat(format: OpenAIToolFormat): ToolDefinition;
  static fromAnthropicFormat(format: AnthropicToolFormat): ToolDefinition;
}
```

## 三、ToolUseEngine 主类

```typescript
export interface ToolUseEngineOptions {
  registry?: ToolRegistry;
  validator?: SchemaValidator;
  requireConfirmation?: (tool: ToolDefinition) => boolean; // 'dangerous' 触发
  maxRetries?: number;           // 默认 3
  retryBackoffMs?: number;       // 默认 1000
  timeoutMs?: number;            // 默认 30000
  onToolCall?: (call: ToolCall, tool: ToolDefinition) => void;
  onToolResult?: (result: ToolCallResult) => void;
  onError?: (error: ToolError, call: ToolCall) => void;
}

export class ToolUseEngine {
  // 工具管理
  registerTool(definition: ToolDefinition, executor: ToolExecutor): void;
  unregisterTool(name: string): boolean;
  enableTool(name: string): boolean;
  disableTool(name: string): boolean;
  listTools(filter?: { category?: string; enabled?: boolean; permission?: ToolPermission }): ToolDefinition[];
  getTool(name: string): ToolDefinition | undefined;
  
  // 协议转换
  toOpenAIFormat(tools?: ToolDefinition[]): OpenAIToolFormat[];
  toAnthropicFormat(tools?: ToolDefinition[]): AnthropicToolFormat[];
  
  // 解析 LLM 输出
  parseOpenAIToolCalls(llmResponse: any): ToolCall[];
  parseAnthropicToolCalls(llmResponse: any): ToolCall[];
  
  // 执行
  executeCall(call: ToolCall): Promise<ToolCallResult>;
  executeCalls(calls: ToolCall[]): Promise<ToolCallResult[]>;
  
  // 历史
  getHistory(filter?: HistoryFilter): ToolCallResult[];
  replay(callId: string): Promise<ToolCallResult>;
  clearHistory(): void;
  
  // 统计
  getStats(): EngineStats;
}

export interface EngineStats {
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  avgDurationMs: number;
  byTool: Map<string, ToolStats>;
  historySize: number;
}
```

## 四、错误处理与重试

```typescript
export interface RetryPolicy {
  maxRetries: number;            // 默认 3
  initialDelayMs: number;        // 默认 1000
  maxDelayMs: number;            // 默认 30000
  backoffMultiplier: number;     // 默认 2 (exponential)
  retryableErrors: string[];     // ['TIMEOUT', 'RATE_LIMIT', 'EXECUTION_ERROR']
}

export class RetryHandler {
  // 指数退避: delay = min(initialDelay * multiplier^attempt, maxDelay)
  // + 抖动: delay *= (1 + random(-0.1, 0.1))
  // 不可重试错误: INVALID_ARGS / PERMISSION_DENIED / NOT_FOUND
}
```

## 五、配置化

```typescript
export const DEFAULT_TOOL_USE_CONFIG: ToolUseEngineOptions = {
  maxRetries: 3,
  retryBackoffMs: 1000,
  timeoutMs: 30000,
  requireConfirmation: (tool) => tool.permission === 'dangerous',
};

export function createToolUseEngine(options?: ToolUseEngineOptions): ToolUseEngine {
  return new ToolUseEngine({ ...DEFAULT_TOOL_USE_CONFIG, ...options });
}

// 内置工具集
export const BUILTIN_TOOLS: Array<{ definition: ToolDefinition; handler: Function }> = [
  // search_web: 模拟网页搜索（safe）
  // calculator: 数学计算（safe）
  // get_current_time: 当前时间（safe）
  // read_file: 读取文件（confirmed）
  // write_file: 写入文件（dangerous）
  // http_request: HTTP 请求（confirmed）
  // shell_command: Shell 命令（dangerous）
  // code_executor: 代码执行（dangerous）
];
```

## 六、工具市场（Tool Marketplace）

```typescript
export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  rating: number;                // 0-5
  downloadCount: number;
  tags: string[];
  definition: ToolDefinition;
  installHandler: () => Promise<{ executor: ToolExecutor }>;
  iconUrl?: string;
  documentation?: string;
}

export class ToolMarketplace {
  search(query: string, filters?: { category?: string; tag?: string }): MarketplaceEntry[];
  getEntry(id: string): MarketplaceEntry | undefined;
  install(id: string, engine: ToolUseEngine): Promise<boolean>;
  uninstall(name: string, engine: ToolUseEngine): boolean;
  publish(entry: MarketplaceEntry): void;
  rate(id: string, rating: number): void;
}
```

## 七、测试覆盖

| 模块 | 测试数 | 重点 |
|------|--------|------|
| ToolDefinition | 6 | 结构 / permission 枚举 |
| FunctionExecutor | 8 | 同步 / 异步 / 异常 |
| HTTPExecutor | 6 | GET / POST / 错误 / 超时 |
| ToolRegistry | 10 | 注册 / 注销 / 启用 / 统计 |
| SchemaValidator | 14 | type / required / enum / range / pattern / 嵌套 |
| ProtocolConverter | 8 | OpenAI ↔ Internal / Anthropic ↔ Internal |
| RetryHandler | 6 | 指数退避 / 抖动 / 不可重试 |
| ToolUseEngine | 16 | 完整流程 / 历史 / 回放 / 并行 |
| ToolMarketplace | 6 | 搜索 / 安装 / 评分 |
| 内置工具 | 8 | 8 个工具各 1+ |
| **合计** | **88** | - |

## 八、关键算法

### 8.1 JSON Schema 校验（简化版）
```typescript
function validate(args: any, schema: JSONSchema, path = ''): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (schema.type === 'object' && typeof args !== 'object') {
    errors.push({ path, message: 'Expected object', expected: 'object', actual: typeof args });
    return errors;
  }
  
  // 检查 required
  for (const req of schema.required || []) {
    if (!(req in args)) {
      errors.push({ path: `${path}.${req}`, message: 'Required field missing' });
    }
  }
  
  // 检查每个属性
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (key in args) {
      const valueErrors = validate(args[key], propSchema, `${path}.${key}`);
      errors.push(...valueErrors);
    }
  }
  
  return errors;
}
```

### 8.2 指数退避
```typescript
function getDelay(attempt: number, policy: RetryPolicy): number {
  const base = Math.min(
    policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt),
    policy.maxDelayMs
  );
  // 抖动 ±10%
  const jitter = base * (1 + (Math.random() * 0.2 - 0.1));
  return Math.floor(jitter);
}
```

### 8.3 并行执行
```typescript
async function executeCalls(calls: ToolCall[]): Promise<ToolCallResult[]> {
  // 按工具名分组，但保持调用顺序
  // 同名工具串行（避免竞态）
  // 不同名工具并行
  const groups = groupBy(calls, c => c.name);
  const results: ToolCallResult[] = [];
  
  for (const [name, group] of groups) {
    const groupResults = await Promise.all(
      group.map(call => executeCall(call))
    );
    results.push(...groupResults);
  }
  
  return results;
}
```

## 九、安全与限制

- **危险工具**: 必须用户确认（permission: 'dangerous'）
- **超时**: 默认 30s，最大 5min
- **重试**: 默认 3 次，仅可重试错误
- **Schema 校验**: 所有参数必须通过校验
- **错误隔离**: 单个工具失败不影响其他工具
- **历史限制**: 默认保留 1000 条，可配置
- **敏感数据**: 危险操作前显示参数预览
- **审计**: 危险工具调用必须记录到 audit log

## 十、性能目标

- 工具注册: < 10ms
- 参数校验: < 5ms
- 工具执行: 取决于具体工具
- 历史查询: < 10ms（1000 条内）
- 协议转换: < 5ms
- 整体并行: 单工具耗时 / 数量

## 十一、API 示例

```typescript
import { createToolUseEngine, BUILTIN_TOOLS, FunctionExecutor } from './toolUseEngine';

// 1. 创建引擎
const engine = createToolUseEngine();

// 2. 注册工具
engine.registerTool(
  {
    name: 'get_weather',
    description: '获取指定城市的天气',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'celsius' },
      },
      required: ['city'],
    },
    permission: 'safe',
    category: 'http',
  },
  new FunctionExecutor(async (args: { city: string; unit?: string }) => {
    // 调用天气 API
    return { city: args.city, temperature: 25, unit: args.unit || 'celsius' };
  })
);

// 3. 解析 LLM 输出
const llmResponse = {
  tool_calls: [
    { id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"北京"}' } },
  ],
};
const calls = engine.parseOpenAIToolCalls(llmResponse);

// 4. 执行
const results = await engine.executeCalls(calls);
console.log(results[0].result); // { city: '北京', temperature: 25, ... }

// 5. 注册内置工具
BUILTIN_TOOLS.forEach(({ definition, handler }) => {
  engine.registerTool(definition, new FunctionExecutor(handler));
});
```

## 十二、未来扩展

- P1: MCP 协议完整实现
- P1: 流式工具执行（边执行边返回）
- P1: 工具依赖图（DAG 执行）
- P2: 工具市场后端 API
- P2: 工具调用可视化追踪
- P2: 工具沙箱执行（Web Worker / iframe 隔离）
