# CYCLE42_CODE_MODIFICATION_LOG

## 修改概览

| 项目 | 详情 |
|------|------|
| 周期 | Cycle 42 (G42-01/02/03/04) |
| 主题 | MCP × Hermes 深度融合 |
| 新增文件 | 9 个 (4 引擎 + 4 测试 + 1 UI) |
| 修改文件 | 5 个 (useModals/AppLayout/BrandHeader/App/useModals.test) |
| 总修改行数 | ~5500+ 行 |

---

## 1. 新增文件

### G42-01: MCP 工具桥接
- `frontend/src/utils/mcpToolBridge.ts` (~580 行) - 核心实现
- `frontend/src/utils/mcpToolBridge.test.ts` (~450 行) - 30+ 单元测试

### G42-02: MCP 资源桥接
- `frontend/src/utils/mcpResourceBridge.ts` (~530 行) - 核心实现
- `frontend/src/utils/mcpResourceBridge.test.ts` (~400 行) - 35+ 单元测试

### G42-03: MCP 提示词桥接
- `frontend/src/utils/mcpPromptBridge.ts` (~580 行) - 核心实现
- `frontend/src/utils/mcpPromptBridge.test.ts` (~450 行) - 30+ 单元测试

### G42-04: MCP 集成智能体
- `frontend/src/utils/mcpIntegratedAgentLoop.ts` (~790 行) - 核心引擎
- `frontend/src/utils/mcpIntegratedAgentLoop.test.ts` (~400 行) - 30+ 单元测试
- `frontend/src/components/McpIntegratedPanel.tsx` (~610 行) - UI 面板
- `frontend/src/components/McpIntegratedPanel.test.tsx` (~200 行) - 14 UI 集成测试

---

## 2. 修改文件

### useModals.ts (v3.2.0 → v3.3.0)
**修改原因**: 添加 MCP 集成智能体面板的模态框控制

**核心变更**:
```typescript
// 新增 PanelKey 类型成员
| 'mcpIntegrated';

// 新增初始状态
mcpIntegrated: DEFAULT_OPEN.mcpIntegrated ?? false,

// 新增控制器
mcpIntegrated: makeController('mcpIntegrated'),  // v3.3.0 (Cycle 42 G42-04) 新增
```

### AppLayout.tsx (v6.114.0 → v6.115.0)
**修改原因**: 透传 onOpenMcpIntegrated 回调到 BrandHeader

**核心变更**:
```typescript
// 新增 prop
onOpenMcpIntegrated: () => void;  // v6.115.0 (Cycle 42 G42-04) 新增

// 解构
onOpenMcpIntegrated,  // v6.115.0 (Cycle 42 G42-04) 透传 BrandHeader

// 传递
onOpenMcpIntegrated={onOpenMcpIntegrated}
```

### BrandHeader.tsx (v2.21.0 → v2.22.0)
**修改原因**: 添加 MCP 集成智能体菜单项

**核心变更**:
```typescript
// 新增 prop
onOpenMcpIntegrated?: () => void;  // v2.22.0 (Cycle 42 G42-04) 新增

// 解构
onOpenMcpIntegrated,  // v2.22.0 (Cycle 42 G42-04) 新增

// 新增菜单项
{onOpenMcpIntegrated && (
  <button
    role="menuitem"
    onClick={wrapMenuItem(onOpenMcpIntegrated)}
    ...
  >
    <Icon name="workflow" className="w-4 h-4 text-rose-500" />
    <span>🚀 MCP 集成智能体</span>
  </button>
)}
```

### App.tsx (v6.115.0 → v6.116.0)
**修改原因**: 集成 McpIntegratedPanel 到主应用

**核心变更**:
```typescript
// 新增 import
import { McpIntegratedPanel } from './components/McpIntegratedPanel';

// 新增 modal 解构
mcpIntegrated: mcpIntegratedModal,  // v2.5.0 (Cycle 42 G42-04) 新增

// 新增回调
onOpenMcpIntegrated={() => mcpIntegratedModal.onOpen()}

// 新增面板渲染
{mcpIntegratedModal.open && (
  <McpIntegratedPanel onClose={mcpIntegratedModal.onClose} llmProviderName="mock" />
)}
```

### useModals.test.ts (v1.0.0 → v1.1.0)
**修改原因**: 适配 mcpIntegrated 新增的 28th controller

**核心变更**:
```typescript
// 之前
expect(controllers).toHaveLength(26);  // Cycle 41

// 之后
expect(controllers).toHaveLength(28);  // v3.3.0 Cycle 42 G42-04 新增 mcpIntegrated
```

---

## 3. 接口签名

### McpToolBridge 核心 API
```typescript
class McpToolBridge {
  // 注册/注销
  registerServer(serverId: string, client: McpClient): Promise<number>;
  unregisterServer(serverId: string): Promise<void>;
  unregisterAll(): Promise<void>;
  
  // 执行
  execute(call: HermesToolCall): Promise<HermesToolCallResult>;
  
  // 查询
  list(): McpRegisteredTool[];
  getDefinitions(): ToolDefinition[];
  listByServer(serverId: string): McpRegisteredTool[];
  
  // 集成
  registerToToolRegistry(registry: any): Promise<number>;
  createExecutor(): (call: HermesToolCall) => Promise<HermesToolCallResult>;
  
  // 事件
  on(listener: McpToolBridgeListener): () => void;
  dispose(): void;
}
```

### McpResourceBridge 核心 API
```typescript
class McpResourceBridge {
  // 注册/注销
  registerServer(serverId: string, client: McpClient): Promise<number>;
  unregisterServer(serverId: string): Promise<void>;
  
  // 解析
  resolve(uri: string): Promise<ResolvedResource>;
  
  // 订阅
  subscribe(uri: string): Promise<boolean>;
  unsubscribe(uri: string): Promise<boolean>;
  
  // 查询
  list(): ResourceInfo[];
  listByServer(serverId: string): ResourceInfo[];
  getStats(): ResourceBridgeStats;
  
  // URI 工具
  static buildHermesResourceUri(serverId: string, originalUri: string): string;
  static parseHermesResourceUri(uri: string): ParsedHermesUri | null;
  
  dispose(): void;
}
```

### McpPromptBridge 核心 API
```typescript
class McpPromptBridge {
  // 注册/注销
  registerServer(serverId: string, client: McpClient): Promise<number>;
  unregisterServer(serverId: string): Promise<void>;
  
  // 渲染
  render(qualifiedName: string, context: PromptExecutionContext): Promise<RenderedHermesPrompt>;
  
  // 校验
  validateArgs(qualifiedName: string, args: Record<string, unknown>): ValidationResult;
  
  // 查询
  list(): HermesPromptDefinition[];
  listByServer(serverId: string): HermesPromptDefinition[];
  getStats(): PromptBridgeStats;
  
  dispose(): void;
}
```

### McpIntegratedAgentLoop 核心 API
```typescript
class McpIntegratedAgentLoop {
  // 初始化
  initialize(): Promise<{ connectedServers: number; registeredTools: number }>;
  
  // Agent 运行
  runWithMcp(userMessage: string, options?: McpAgentRunOptions): Promise<McpAgentRunResult>;
  
  // 查询
  listAvailableTools(): ToolDefinition[];
  listAvailableResources(): ResourceInfo[];
  listAvailablePrompts(): HermesPromptDefinition[];
  getStats(): McpAgentStats;
  
  dispose(): void;
}
```

---

## 4. 资源引用协议

### 资源引用 (Resource Reference)
```
@mcp://<serverId>/<originalUri>
```

**示例**:
```
@mcp://filesystem/home/user/document.txt
@mcp://git/repo%2Fpath/file.md
```

### 提示词引用 (Prompt Reference)
```
/prompt mcp:<serverId>::<promptName> [key=value ...]
@prompt:mcp:<serverId>::<promptName>
```

**示例**:
```
/prompt mcp:code-review::review_pr pr_id=123
@prompt:mcp:git::commit_message
```

---

## 5. 工具限定名协议

### 工具限定名 (Tool Qualified Name)
```
mcp__<serverId>__<toolName>
```

**示例**:
```
mcp__filesystem__read_file
mcp__git__commit_changes
```

### 提示词限定名 (Prompt Qualified Name)
```
mcp:<serverId>::<promptName>
```

**示例**:
```
mcp:code-review::review_pr
mcp:git::commit_message
```

### 资源限定 URI (Hermes Resource URI)
```
hermes://mcp/<serverId>/<originalUri>
```

**示例**:
```
hermes://mcp/filesystem/home/user/document.txt
hermes://mcp/git/repo%2Fpath/file.md
```

---

## 6. 工具权限

MCP 工具默认 `permission: 'auto'`，表示无需用户确认即可执行。

可在 mcpToolBridge.ts 中通过 convertMcpToolToHermes 自定义。

---

## 7. 完成度

| 任务 | 完成度 | 备注 |
|------|--------|------|
| G42-01 McpToolBridge | 100% | 30+ 测试通过 |
| G42-02 McpResourceBridge | 100% | 35+ 测试通过 |
| G42-03 McpPromptBridge | 100% | 30+ 测试通过 |
| G42-04 McpIntegratedAgentLoop | 100% | 30+ 测试通过 |
| G42-04 McpIntegratedPanel | 100% | 14 UI 测试通过 |
| 主应用集成 | 100% | App.tsx + AppLayout + BrandHeader + useModals |
| TypeScript 严格模式 | 100% | 0 错误 |
| 自动化测试 | 100% | 5835/5835 |
| Vite 生产构建 | 100% | ✅ 成功 |
| 文档 | 100% | SPEC / ACCEPTANCE / LOG / STARTUP |

**Cycle 42 完成度: 100%** ✅
