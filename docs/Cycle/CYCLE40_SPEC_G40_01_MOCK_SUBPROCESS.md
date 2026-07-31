# CYCLE 40 SPEC G40-01: Mock Subprocess + Stdio 端到端测试

> **Cycle**: 40  
> **方向**: A. 真实 MCP 集成测试 (推荐)  
> **任务**: G40-01  
> **版本**: v1.0.0  

---

## 一、目标

实现 Mock Subprocess 框架，模拟真实的 MCP stdio 服务器进程，使 StdioMcpTransport 在测试环境能端到端验证：
- 进程启动 / 关闭生命周期
- JSON-RPC 消息双向通信
- 大消息分片 / Buffer 处理
- 错误处理（崩溃、退出码、超时）
- 性能基准（消息吞吐量、延迟）

## 二、核心组件

### 2.1 MockSubprocess（核心抽象）

**职责**：模拟真实子进程行为
- 提供 stdin/stdout/stderr 流（Web ReadableStream + WritableStream）
- 支持脚本化响应：收到某请求 → 发送某响应
- 支持场景模拟：正常响应、错误、超时、崩溃
- 收集所有发送/接收消息用于断言

**API**：
```typescript
class MockSubprocess {
  // 启动 mock 进程
  static spawn(script: MockSubprocessScript): MockSubprocess;
  
  // 接收消息（来自客户端）
  receive(message: JsonRpcMessage | string): void;
  
  // 主动发送消息（模拟服务器响应）
  send(message: JsonRpcMessage): void;
  
  // 模拟进程关闭
  kill(exitCode?: number): void;
  
  // 模拟错误
  emitError(err: Error): void;
  
  // 状态查询
  getStdoutMessages(): JsonRpcMessage[];
  getStderrOutput(): string[];
  isRunning(): boolean;
  
  // 控制行为
  setResponseDelay(ms: number): void;
  setResponseScript(script: ResponseScript): void;
}
```

### 2.2 ResponseScript 模式

**三种脚本模式**：

1. **简单回显**（echo）：收到的请求原样返回
2. **预设响应**（fixture）：按请求 ID 返回预设响应
3. **函数式**（functional）：用户自定义响应函数

```typescript
type ResponseScript = 
  | { type: 'echo' }
  | { type: 'fixture'; responses: Map<string, JsonRpcMessage> }
  | { type: 'functional'; handler: (req: JsonRpcRequest) => JsonRpcMessage | Promise<JsonRpcMessage> };
```

### 2.3 Stdio 集成测试套件

**测试场景**：
- 基本握手：initialize → initialized
- 工具调用：tools/list + tools/call
- 通知处理：notifications/message
- 错误响应：method not found (-32601)
- 大消息：>1MB 内容分片
- 进程崩溃：spawn 失败、运行中崩溃
- 超时：服务器不响应
- 并发：多个请求同时发出

### 2.4 性能基准

**测量指标**：
- 握手延迟（spawn → ready）
- 单消息往返延迟（RTT）
- 批量消息吞吐量（msg/s）
- 内存占用（heap delta）
- 缓冲区处理（1MB+ 消息）

## 三、交付物

| 文件 | 行数估计 | 用途 |
|------|----------|------|
| `frontend/src/utils/mcpMockSubprocess.ts` | ~400 | Mock 进程框架 |
| `frontend/src/utils/mcpMockSubprocess.test.ts` | ~50 测试 | 单元测试 |
| `frontend/src/utils/mcpStdioE2E.test.ts` | ~30 测试 | 端到端测试 |
| `frontend/src/utils/mcpPerformance.bench.ts` | ~200 | 性能基准脚本 |

## 四、成功标准

- 80+ 新单元测试 100% 通过
- 涵盖真实 stdio 通信的所有 edge case
- 性能基准建立，提供后续 regression 对比基线
- TypeScript 0 错误
