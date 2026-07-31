# CYCLE39 SPEC - G39-01 MCP 客户端核心 (v1.0.0)

> **任务**: G39-01 - MCP 协议客户端核心引擎
> **目标**: 实现符合 MCP 规范的 JSON-RPC 2.0 客户端，支持 Stdio + SSE 双传输
> **对标**: @modelcontextprotocol/sdk (TypeScript 官方 SDK)

---

## 一、核心职责

实现 MCP (Model Context Protocol) 协议客户端，使 Hermes 平台能够：
1. 连接到任意 MCP 兼容服务器
2. 发现 (Tools/Resources/Prompts) 三大能力
3. 通过标准化的 JSON-RPC 2.0 调用这些能力
4. 支持本地 (Stdio) 和远程 (SSE) 两种传输

---

## 二、协议层设计

### 2.1 JSON-RPC 2.0 消息结构

```typescript
// 请求
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

// 响应 (成功)
interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

// 响应 (错误)
interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// 通知 (无 id)
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}
```

### 2.2 标准 JSON-RPC 错误码

| Code | 含义 | 用途 |
|------|------|------|
| -32700 | Parse error | JSON 解析失败 |
| -32600 | Invalid Request | 非法请求 |
| -32601 | Method not found | 方法不存在 |
| -32602 | Invalid params | 参数错误 |
| -32603 | Internal error | 内部错误 |
| -32000 ~ -32099 | Server error | 服务器自定义错误 |

### 2.3 MCP 协议方法集

| 方法 | 方向 | 说明 |
|------|------|------|
| `initialize` | C→S | 握手 (协商协议版本 + 能力) |
| `initialized` | C→S | 通知握手完成 |
| `ping` | C↔S | 心跳保活 |
| `tools/list` | C→S | 列出可用工具 |
| `tools/call` | C→S | 调用工具 |
| `resources/list` | C→S | 列出可用资源 |
| `resources/read` | C→S | 读取资源 |
| `resources/subscribe` | C→S | 订阅资源变更 |
| `prompts/list` | C→S | 列出提示词模板 |
| `prompts/get` | C→S | 获取提示词内容 |
| `notifications/*` | S→C | 服务器主动通知 |

---

## 三、传输层设计

### 3.1 Transport 抽象接口

```typescript
interface McpTransport {
  /** 启动传输 (打开连接) */
  start(): Promise<void>;
  /** 发送 JSON-RPC 消息 */
  send(message: JsonRpcMessage): Promise<void>;
  /** 接收消息回调注册 */
  onMessage(handler: (msg: JsonRpcMessage) => void): void;
  /** 错误回调注册 */
  onError(handler: (err: Error) => void): void;
  /** 关闭事件回调注册 */
  onClose(handler: () => void): void;
  /** 关闭传输 */
  close(): Promise<void>;
}
```

### 3.2 Stdio 传输 (本地子进程)

**适用**: 本地命令行工具 (如 `mcp-server-filesystem`)

```typescript
class StdioTransport implements McpTransport {
  private process: ChildProcess;
  
  constructor(options: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  });
  
  // 通过 child_process.spawn 启动子进程
  // stdin 写入 JSON-RPC 消息 (每行一条 JSON)
  // stdout 逐行读取并解析
  // stderr 单独捕获 (用于错误日志)
}
```

### 3.3 SSE 传输 (远程 HTTP)

**适用**: 远程 MCP 服务 (HTTP + Server-Sent Events)

```typescript
class SseTransport implements McpTransport {
  private eventSource: EventSource;
  private httpEndpoint: string;  // 用于 POST 请求
  
  constructor(options: {
    url: string;          // SSE 端点 URL
    headers?: Record<string, string>;
  });
  
  // 1. GET 请求打开 SSE 连接 → 接收 server 端点
  // 2. POST 请求发送 JSON-RPC 到 server 端点
  // 3. 通过 SSE 接收服务器响应和通知
}
```

### 3.4 传输选择策略

```
if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
  return new SseTransport(...);
} else {
  return new StdioTransport(...);
}
```

---

## 四、能力发现 (Capability Negotiation)

### 4.1 握手流程

```
Client                                  Server
  |                                       |
  |--- initialize (req) ---------------->|
  |    {                                  |
  |      protocolVersion: "2024-11-05",   |
  |      capabilities: {                  |
  |        roots: { listChanged: false }, |
  |        sampling: {}                   |
  |      },                               |
  |      clientInfo: {                    |
  |        name: "hermes",                |
  |        version: "6.111.0"             |
  |      }                                |
  |    }                                  |
  |                                       |
  |<-- initialize (resp) -----------------|
  |    {                                  |
  |      protocolVersion: "2024-11-05",   |
  |      capabilities: {                  |
  |        tools: { listChanged: true },  |
  |        resources: { subscribe: true } |
  |      },                               |
  |      serverInfo: { ... }              |
  |    }                                  |
  |                                       |
  |--- initialized (notification) ------->|
  |                                       |
```

### 4.2 客户端能力声明

```typescript
interface ClientCapabilities {
  roots?: { listChanged?: boolean };
  sampling?: Record<string, never>;
  experimental?: Record<string, unknown>;
}

interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, never>;
}
```

---

## 五、核心 API 设计

### 5.1 McpClient 主类

```typescript
class McpClient {
  constructor(options: {
    serverId: string;
    serverName: string;
    transport: McpTransport;
    clientInfo?: { name: string; version: string };
    protocolVersion?: string;
  });
  
  // ============ 生命周期 ============
  async connect(): Promise<InitializeResult>;  // 握手
  async close(): Promise<void>;                // 关闭
  async ping(): Promise<void>;                // 心跳
  
  // ============ 能力发现 ============
  async listTools(): Promise<Tool[]>;
  async listResources(): Promise<Resource[]>;
  async listPrompts(): Promise<Prompt[]>;
  
  // ============ 能力调用 ============
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  async readResource(uri: string): Promise<ResourceContent>;
  async getPrompt(name: string, args?: Record<string, string>): Promise<PromptMessage[]>;
  
  // ============ 通知订阅 ============
  onToolsListChanged(handler: () => void): () => void;
  onResourcesListChanged(handler: () => void): () => void;
  onPromptsListChanged(handler: () => void): () => void;
  onResourceUpdated(handler: (uri: string) => void): () => void;
  onLogMessage(handler: (level: string, data?: unknown) => void): () => void;
  
  // ============ 状态查询 ============
  getState(): 'idle' | 'connecting' | 'ready' | 'closed' | 'error';
  getServerInfo(): ServerInfo | undefined;
  getCapabilities(): ServerCapabilities | undefined;
  getLastError(): Error | undefined;
}
```

### 5.2 工具/资源/提示词模型

```typescript
// 工具 (Tool)
interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// 资源 (Resource)
interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// 资源内容
type ResourceContent =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string };

// 提示词 (Prompt)
interface Prompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  };
}
```

### 5.3 调用结果

```typescript
// 工具调用结果
interface ToolCallResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; resource: ResourceContent }
  >;
  isError?: boolean;
}
```

---

## 六、请求管理 (Pending Request Manager)

### 6.1 核心数据结构

```typescript
interface PendingRequest {
  id: string | number;
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: NodeJS.Timeout;
  sentAt: number;
}
```

### 6.2 关键逻辑

```typescript
class PendingRequestManager {
  private requests: Map<string | number, PendingRequest> = new Map();
  private defaultTimeoutMs: number;
  
  // 1. request(method, params) → 生成 id + 存入 map + 设置 timeout
  // 2. handleResponse(message) → 查找 id + resolve + 清理
  // 3. handleError(message) → 查找 id + reject
  // 4. handleTimeout(id) → reject with timeout error
  // 5. close() → reject all pending + 清空
}
```

### 6.3 超时与重试

- **默认超时**: 30s
- **可配置**: per-request 覆盖
- **超时处理**: reject with `McpTimeoutError`
- **不自动重试**: 由上层决定

---

## 七、错误处理

### 7.1 错误类型层次

```typescript
class McpError extends Error {
  constructor(message: string, public code: number, public data?: unknown) {
    super(message);
  }
}

class McpConnectionError extends McpError {
  constructor(message: string) {
    super(message, -32000);
  }
}

class McpTimeoutError extends McpError {
  constructor(method: string, timeoutMs: number) {
    super(`Request '${method}' timed out after ${timeoutMs}ms`, -32001);
  }
}

class McpParseError extends McpError {
  constructor(message: string) {
    super(message, -32700);
  }
}
```

### 7.2 错误码映射

| JSON-RPC 错误码 | McpError 子类 |
|----------------|---------------|
| -32700 | McpParseError |
| -32600 | McpError (Invalid Request) |
| -32601 | McpError (Method Not Found) |
| -32602 | McpError (Invalid Params) |
| -32603 | McpError (Internal) |
| -32000 | McpConnectionError |
| -32001 | McpTimeoutError |
| 其他 | McpError (generic) |

---

## 八、关键实现细节

### 8.1 JSON 消息边界

**Stdio 传输**: 使用 `readline` 按行读取 (每行一条 JSON)
**SSE 传输**: 解析 `event:` 和 `data:` 字段 (event=message → data 是 JSON)

### 8.2 并发安全

- PendingRequestManager 使用 Map 存储 → O(1) 查找
- onMessage 回调按顺序处理 → 避免竞态
- transport.send 是异步 → 不阻塞其他请求

### 8.3 资源清理

- `close()` 时必须:
  1. 取消所有 pending request (reject)
  2. 关闭 transport
  3. 清除所有 timeout
  4. 解除所有监听器

### 8.4 重连策略

- **自动重连**: 关闭事件触发后, 延迟重试 (指数退避)
- **最大重试**: 默认 3 次
- **手动重连**: `client.reconnect()` 方法

---

## 九、单元测试覆盖 (30+ 测试)

### 9.1 JsonRpc 序列化 (5 测试)
- 请求序列化正确
- 响应序列化正确
- 错误响应序列化正确
- 通知无 id 字段
- 非法 JSON 抛 ParseError

### 9.2 PendingRequestManager (8 测试)
- request 存入 map
- handleResponse 解析正确
- handleError reject
- 超时 reject
- 同一 id 不重复
- close 清空所有
- timeout 清理
- 并发请求独立

### 9.3 StdioTransport (6 测试)
- 启动子进程
- 发送消息到 stdin
- 解析 stdout JSON
- 错误从 stderr 捕获
- 子进程退出触发 close
- 手动 close 清理

### 9.4 SseTransport (5 测试)
- 打开 EventSource
- 接收 SSE 消息
- 解析 event: message + data
- POST 请求发送
- 连接错误触发 onError

### 9.5 McpClient 生命周期 (6 测试)
- connect 成功握手
- connect 失败抛 ConnectionError
- ping 成功
- close 清理资源
- reconnect 重新建立
- 状态机转换正确

---

## 十、API 签名汇总

```typescript
// 导出函数
export function createMcpClient(options: McpClientOptions): McpClient;
export function createStdioTransport(options: StdioTransportOptions): McpTransport;
export function createSseTransport(options: SseTransportOptions): McpTransport;
export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest;
export function isJsonRpcResponse(msg: unknown): msg is JsonRpcSuccess | JsonRpcError;
export function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification;
export function generateRequestId(): string;
```

---

## 十一、文件结构

```
frontend/src/utils/
├── mcpClient.ts              # 主客户端类
├── mcpClient.test.ts         # 单元测试
├── mcpTransport.ts           # 传输抽象接口
├── mcpTransportStdio.ts      # Stdio 实现
├── mcpTransportSse.ts        # SSE 实现
├── mcpTransport.test.ts      # 传输层测试
├── mcpTypes.ts               # 协议类型定义
└── mcpErrors.ts              # 错误类
```

**总计**: 8 个文件，约 1500 行代码 + 30+ 测试

---

## 十二、与现有系统集成

### 12.1 与 ToolUseEngine 集成

```typescript
// 在 ToolUseEngine 中注册 MCP 工具
toolEngine.registerTool({
  name: `mcp_${serverId}_${toolName}`,
  description: tool.description,
  parameters: tool.inputSchema,
  handler: async (args) => {
    return await mcpClient.callTool(toolName, args);
  },
});
```

### 12.2 与 AgentLoopEngine 集成

```typescript
// AgentLoopEngine 调用 MCP 资源作为上下文
const resources = await mcpClient.listResources();
for (const res of resources) {
  if (res.uri.includes(query)) {
    const content = await mcpClient.readResource(res.uri);
    // 注入到 agent context
  }
}
```

### 12.3 与 HumanApprovalEngine 集成

```typescript
// 敏感 MCP 工具调用需审批
if (isSensitiveTool(toolName)) {
  await approvalEngine.requestApproval({
    type: 'tool_call',
    name: `mcp_${serverId}_${toolName}`,
    args,
    reversible: false,
    estimatedImpact: '执行外部 MCP 工具调用',
  });
}
```

---

## 十三、版本与依赖

- **TypeScript**: 5.6.2 (现有)
- **Node.js**: 24.x (使用 child_process 标准 API)
- **外部依赖**: 无（自研实现，保持 bundle 体积可控）
- **浏览器兼容**: 100% (Stdio 仅 Node, SSE 浏览器 + Node)

---

## 十四、关键参考

- MCP 官方规范: https://spec.modelcontextprotocol.io/
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- JSON-RPC 2.0 规范: https://www.jsonrpc.org/specification
