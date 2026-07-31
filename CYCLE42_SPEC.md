# CYCLE 42 SPEC

> **Cycle**: 42
> **方向**: A. MCP × Hermes 深度融合 (推荐)
> **完成时间**: 2026-07-31
> **API 对接**: 火山方舟 Coding Plan

---

## 一、目标

将 MCP（Model Context Protocol）能力深度集成到 Hermes 核心系统，让 1000+ MCP 生态工具/资源/提示词在 Hermes 中零配置可用。

**核心价值**:
- 打通 LLM ↔ Hermes Agent Loop ↔ MCP 工具/资源 完整链路
- 用户无需编写胶水代码即可使用 MCP 生态
- 复用 Cycle 37-41 全部 MCP 引擎 + Cycle 37 Agent Loop + Tool Registry

## 二、4 大 P0 任务

### G42-01: MCP 工具自动注册到 Hermes ToolRegistry

**目标**: 将 MCP 工具自动发现并注册到 `ToolRegistry`（来自 toolUseEngine.ts）

**核心能力**:
- MCP 工具定义（`MCP Tool`）↔ Hermes `ToolDefinition` 双向转换
- 工具命名空间: `mcp__<serverId>__<toolName>`（避免冲突）
- 自动扫描已连接服务器的 `tools/list`
- 监听 `notifications/tools/list_changed` 实时同步
- 工具调用路由：Hermes 工具调用 → MCP 服务器执行
- 类型安全：JSON Schema 校验参数

**API 概览**:
```typescript
class McpToolBridge {
  registerServer(serverId: string, client: McpClient): Promise<number>;
  unregisterServer(serverId: string): Promise<void>;
  getDefinitions(): ToolDefinition[];
  getDefinition(qualifiedName: string): ToolDefinition | undefined;
  execute(call: ToolCall): Promise<ToolCallResult>;
  on(event: 'registered' | 'unregistered' | 'updated' | 'error'): Listener;
}
```

**文件**:
- `frontend/src/utils/mcpToolBridge.ts` (新)
- `frontend/src/utils/mcpToolBridge.test.ts` (新)

### G42-02: MCP 资源集成到 Hermes 资源系统

**目标**: 将 MCP 资源（`MCP Resource`）集成到 Hermes 资源池

**核心能力**:
- MCP 资源（`Resource`）↔ Hermes `ResourceInfo` 转换
- URI 引用解析：`@mcp://serverId/uri`
- 资源订阅自动同步到 Hermes 资源池
- 资源读取懒加载 + 缓存
- 多类型预览支持（继承 Cycle 40 资源预览器）
- 资源搜索 + 过滤

**API 概览**:
```typescript
class McpResourceBridge {
  registerServer(serverId: string, client: McpClient): Promise<number>;
  unregisterServer(serverId: string): Promise<void>;
  list(): ResourceInfo[];
  resolve(uri: string): Promise<ResourceContent>;
  search(query: string): ResourceInfo[];
  on(event: 'added' | 'removed' | 'updated' | 'subscribed'): Listener;
}
```

**文件**:
- `frontend/src/utils/mcpResourceBridge.ts` (新)
- `frontend/src/utils/mcpResourceBridge.test.ts` (新)

### G42-03: MCP 提示词深度集成 Hermes Prompt 库

**目标**: MCP 提示词 → Hermes 统一提示词格式深度集成

**核心能力**:
- MCP `Prompt` + `PromptMessage` ↔ Hermes `PromptDefinition` 转换
- 跨服务器提示词搜索
- 提示词 marketplace 视图（复用 Cycle 40 mcpPromptIntegration）
- 参数补全集成（G41-02 引擎复用）
- 提示词分类 + 标签
- 统计：调用次数、服务器分布

**API 概览**:
```typescript
class McpPromptBridge {
  registerServer(serverId: string, client: McpClient): Promise<number>;
  unregisterServer(serverId: string): Promise<void>;
  list(): PromptDefinition[];
  get(qualifiedName: string): PromptDefinition | undefined;
  render(qualifiedName: string, args: Record<string, string>): Promise<RenderedPrompt>;
  search(query: string): PromptDefinition[];
  on(event: 'registered' | 'updated' | 'unregistered'): Listener;
}
```

**文件**:
- `frontend/src/utils/mcpPromptBridge.ts` (新)
- `frontend/src/utils/mcpPromptBridge.test.ts` (新)

### G42-04: 端到端 Agent 集成 + 验收

**目标**: Hermes Agent Loop → MCP 工具/资源/提示词 完整链路

**核心能力**:
- 创建 `McpIntegratedAgentLoop` 包装 AgentLoopEngine
- 启动时自动注册所有 MCP 工具到 ToolRegistry
- LLM tool_call → MCP 工具执行
- 提示词渲染时自动注入 MCP 提示词列表
- 端到端场景测试：用户输入 → Agent → MCP 工具 → 结果
- 真实 LLM 集成（DeepSeek 或 火山方舟）
- 性能基准

**API 概览**:
```typescript
class McpIntegratedAgentLoop {
  constructor(options: {
    llmProvider: LLMProvider;
    mcpRegistry: McpServerRegistry;
    toolRegistry: ToolRegistry;
    promptBridge: McpPromptBridge;
    toolBridge: McpToolBridge;
  });

  async runWithMcp(userMessage: string, options: RunOptions): Promise<AgentRunResult>;
  async listAvailableTools(): Promise<ToolDefinition[]>;
  async listAvailablePrompts(): Promise<PromptDefinition[]>;
}
```

**文件**:
- `frontend/src/utils/mcpIntegratedAgentLoop.ts` (新)
- `frontend/src/utils/mcpIntegratedAgentLoop.test.ts` (新)
- `frontend/src/utils/mcpIntegrationE2E.test.ts` (新)

## 三、技术架构

### 3.1 命名空间约定

| 类型 | 命名空间 |
|------|---------|
| MCP 工具 | `mcp__<serverId>__<toolName>` |
| MCP 资源 | `mcp://<serverId>/<uri>` |
| MCP 提示词 | `mcp:srv::<promptName>`（复用 Cycle 40） |

### 3.2 桥接层架构

```
┌─────────────────────────────────────┐
│     Hermes Core (Agent/Tools)      │
│  - AgentLoopEngine                  │
│  - ToolRegistry                     │
│  - LLM Provider (火山方舟)          │
└──────────────┬──────────────────────┘
               │
       ┌───────┴───────┐
       │ McpIntegratedAgentLoop │
       └───────┬───────┘
               │
   ┌───────────┼───────────┐
   │           │           │
┌──┴──┐   ┌───┴───┐   ┌───┴───┐
│Mcp  │   │ Mcp   │   │ Mcp   │
│Tool │   │Resource│   │Prompt │
│Bridge│  │Bridge │   │Bridge │
└──┬──┘   └───┬───┘   └───┬───┘
   │           │           │
   └───────────┴───────────┘
               │
   ┌───────────┴───────────┐
   │   MCP Server Registry │
   │   (Cycle 39)          │
   └───────────┬───────────┘
               │
   ┌───────────┴───────────┐
   │   McpClient (Cycle 41)│
   └───────────────────────┘
```

### 3.3 数据流

**工具调用**:
1. LLM 返回 `tool_call: { name: "mcp__filesystem__read_file", args: { path: "/a.txt" }}`
2. McpIntegratedAgentLoop 接收
3. McpToolBridge.execute() 解析命名空间
4. 通过对应 McpClient 调用 MCP 工具
5. 返回结果给 LLM

**资源引用**:
1. 用户输入：`@mcp://filesystem/file:///workspace/data.txt`
2. McpResourceBridge.resolve() 通过 serverId 找到对应 client
3. 调用 `resources/read` 获取内容
4. 注入 LLM 上下文

**提示词调用**:
1. Agent 决定使用提示词 `mcp:srv::summarize`
2. McpPromptBridge.render() 解析参数
3. 通过 McpClient 调用 `prompts/get`
4. 返回的 messages 注入 LLM 上下文

## 四、质量保证

### 4.1 测试覆盖

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| mcpToolBridge.test.ts | 30+ | 工具注册 / 命名空间 / 执行路由 / 监听器 |
| mcpResourceBridge.test.ts | 30+ | 资源池 / URI 解析 / 订阅同步 / 缓存 |
| mcpPromptBridge.test.ts | 30+ | 提示词集成 / 跨服务器搜索 / 渲染 |
| mcpIntegratedAgentLoop.test.ts | 25+ | 端到端流程 / LLM 集成 / 错误处理 |
| mcpIntegrationE2E.test.ts | 15+ | 完整场景 / 真实 LLM 烟雾测试 |
| **合计** | **130+** | |

### 4.2 真实 LLM 集成

- 火山方舟 Coding Plan (`doubao-pro-32k` / `doubao-pro-128k`)
- 真实 LLM 调用（标记为可选，未配置 API key 时降级到 Mock）
- 端到端烟雾测试验证生产可用性

## 五、关键技术决策

1. **命名空间前缀**: `mcp__<serverId>__` 避免与 Hermes 内部工具冲突
2. **桥接层而非直接修改**: 创建独立 Bridge 类，保持 McpClient/Server 原始 API 稳定
3. **懒加载执行**: 工具/资源调用时才连接服务器（按需）
4. **事件订阅**: 复用 G41-01 资源订阅 + G41-02 参数补全
5. **类型安全**: 完整 TypeScript 类型定义，零 any
6. **错误降级**: 真实 LLM 失败时回退到 Mock

## 六、交付清单

**代码**:
- 8 个新文件（4 引擎 + 4 测试）
- 1 个主应用集成面板（可选）

**文档**:
- CYCLE42_SPEC.md (本文件)
- CYCLE42_ACCEPTANCE_REPORT.md
- CYCLE42_CODE_MODIFICATION_LOG.md
- CYCLE43_STARTUP.md

**Git 提交**:
- 4-5 个原子提交

**测试**:
- 5845+ 总测试通过
- TypeScript 严格模式 0 错误
