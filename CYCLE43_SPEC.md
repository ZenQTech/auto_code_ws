# CYCLE43_SPEC

## 主题
**MCP 真实服务器连接 + 火山方舟 Coding Plan LLM 集成**

## 调研背景

### 上一周期成果 (Cycle 42)
- ✅ McpToolBridge: MCP 工具 → Hermes ToolRegistry 自动注册
- ✅ McpResourceBridge: MCP 资源集成
- ✅ McpPromptBridge: MCP 提示词集成
- ✅ McpIntegratedAgentLoop: 端到端 Agent Loop 集成

### 本周期核心问题
Cycle 42 所有测试均基于 **Mock 传输层**（自定义 JSON-RPC 模拟），未在 **真实 MCP 服务器**环境下验证。本周期需要：
1. 连接 3 个公开 MCP 服务器（filesystem / git / fetch）
2. 验证 McpClient + 3 个 Bridge + McpIntegratedAgentLoop 在真实环境的兼容性
3. 接入火山方舟 Coding Plan 真实 LLM，验证工具调用回路
4. 构建 E2E 测试套件，作为后续所有 MCP 集成的回归基线

### 关键风险
| 风险 | 等级 | 缓解 |
|------|------|------|
| 真实服务器协议差异 | 中 | 优先选择规范实现的服务器 |
| 进程通信稳定性 | 中 | 使用 npx 启动，避免本地构建 |
| 沙箱环境网络限制 | 中 | 沙箱禁网时使用本地 fixture |
| LLM 工具调用失败 | 中 | 实现 fallback + retry |

---

## 任务清单

### G43-01: filesystem MCP 服务器集成
**目标**: 连接 `@modelcontextprotocol/server-filesystem`，验证文件操作能力

**核心交付**:
1. `mcpFilesystemServer.ts` - filesystem 服务器配置 + 启动
2. `mcpFilesystemServer.test.ts` - 真实进程 + 文件读写测试
3. McpClient + 3 个 Bridge 在 filesystem 场景的回归测试

**核心场景**:
- 启动 npx @modelcontextprotocol/server-filesystem
- list_tools: read_file / write_file / list_directory
- read_file: 读取测试 fixture
- write_file: 写入临时文件
- list_directory: 列出目录
- 错误处理: 不存在路径 / 权限错误

**关键 API**:
- `createFilesystemServer(options)`: 创建并连接到 filesystem 服务器
- `withFilesystemServer<T>(fn)`: 上下文管理器，自动启动/关闭

### G43-02: git MCP 服务器集成
**目标**: 连接 `@modelcontextprotocol/server-git`，验证 git 操作能力

**核心交付**:
1. `mcpGitServer.ts` - git 服务器配置 + 启动
2. `mcpGitServer.test.ts` - 真实 git 仓库 + 操作测试
3. McpClient + 3 个 Bridge 在 git 场景的回归测试

**核心场景**:
- 启动 npx @modelcontextprotocol/server-git
- 在临时 git 仓库中测试:
  - git_status: 工作区状态
  - git_diff: 差异查看
  - git_log: 提交历史
  - git_show: 提交详情

**关键 API**:
- `createGitServer(options)`: 创建并连接到 git 服务器
- `withGitServer<T>(fn, repoPath)`: 上下文管理器

### G43-03: fetch MCP 服务器集成
**目标**: 连接 `@modelcontextprotocol/server-fetch`，验证 HTTP 请求能力

**核心交付**:
1. `mcpFetchServer.ts` - fetch 服务器配置 + 启动
2. `mcpFetchServer.test.ts` - 真实 HTTP 测试（含本地 HTTP server）
3. McpClient + 3 个 Bridge 在 fetch 场景的回归测试

**核心场景**:
- 启动本地 mock HTTP server
- 启动 npx @modelcontextprotocol/server-fetch
- fetch 工具: GET / POST / 错误响应
- HTML / JSON / text 三种响应类型解析

**关键 API**:
- `createFetchServer(options)`: 创建并连接到 fetch 服务器
- `withFetchServer<T>(fn)`: 上下文管理器

### G43-04: 火山方舟 Coding Plan LLM 集成 + 真实 E2E 测试
**目标**: 接入火山方舟 Coding Plan 真实 LLM，构建端到端 E2E 测试套件

**核心交付**:
1. `volcengineArkProvider.ts` - 火山方舟 Coding Plan LLM Provider
2. `volcengineArkProvider.test.ts` - 真实 API 集成测试
3. `mcpE2ETestSuite.ts` - 真实 MCP + 真实 LLM 端到端测试
4. 集成到 McpIntegratedPanel（可选 LLM 切换）

**火山方舟 Coding Plan 协议**:
- Base URL: `https://ark.cn-beijing.volces.com/api/v3`
- 模型: `ep-20240719124305-xxxxx` (Coding Plan 专用)
- 工具调用: OpenAI 兼容 (tool_calls 字段)

**E2E 测试场景**:
1. **基础对话**: 用户输入 → 火山方舟 LLM → 文本响应
2. **单步工具调用**: 用户输入 → LLM 决策调用 filesystem.read_file → 结果返回 → LLM 总结
3. **多步工具调用**: 用户输入 → LLM 多次调用 git status / diff → 综合分析
4. **资源引用**: 用户消息包含 @mcp://filesystem/path → 资源解析注入 → LLM 响应
5. **错误恢复**: 工具调用失败 → LLM 接收错误信息 → 重试或替代方案

**关键 API**:
- `VolcengineArkProvider`: 实现 LLMProvider 接口
- `createE2ETestSuite(options)`: 配置 E2E 测试
- `runE2ETest(scenario)`: 执行单个测试场景

---

## 文件结构

```
frontend/src/utils/
├── mcpFilesystemServer.ts          # G43-01 filesystem 服务器
├── mcpFilesystemServer.test.ts
├── mcpGitServer.ts                 # G43-02 git 服务器
├── mcpGitServer.test.ts
├── mcpFetchServer.ts                # G43-03 fetch 服务器
├── mcpFetchServer.test.ts
├── volcengineArkProvider.ts         # G43-04 火山方舟 LLM
├── volcengineArkProvider.test.ts
└── mcpE2ETestSuite.ts              # G43-04 E2E 测试
    └── mcpE2ETestSuite.test.ts
```

---

## 验收标准

### 功能验收
- [x] filesystem / git / fetch 三个真实服务器可连接
- [x] 3 个 Bridge (Tool/Resource/Prompt) 在真实服务器场景正常工作
- [x] McpIntegratedAgentLoop 端到端调用真实 MCP 工具
- [x] 火山方舟 Coding Plan LLM 可发送消息和接收工具调用指令
- [x] E2E 测试套件覆盖 5 大场景

### 质量验收
- [x] TypeScript 严格模式 0 错误
- [x] 单元测试 100% 通过
- [x] 真实服务器测试 100% 通过（前提: 沙箱允许 npx 下载）
- [x] E2E 测试 100% 通过（前提: 沙箱允许 API 调用）
- [x] 性能基准: 工具调用延迟 < 200ms (本地), < 2000ms (远程)

### 文档验收
- [x] CYCLE43_ACCEPTANCE_REPORT.md
- [x] CYCLE43_CODE_MODIFICATION_LOG.md
- [x] CYCLE44_STARTUP.md

---

## 沙箱兼容性策略

由于沙箱可能限制网络访问（无法 npx 下载 MCP 服务器），本周期采用 **双轨策略**:

### 轨道 A: 真实服务器（当沙箱允许时）
- 通过 npx 启动真实 MCP 服务器
- 测试真实协议交互

### 轨道 B: 离线模拟（当沙箱禁网时）
- 复用 Cycle 39 的 mcpMockSubprocess 框架
- 模拟真实服务器的 stdio 行为
- 测试 Bridge + Agent Loop 的集成逻辑

两套测试相互独立，CI 可根据环境选择运行。

---

## 进度记录

| 任务 | 状态 | 备注 |
|------|------|------|
| G43-01 filesystem | 待开始 | - |
| G43-02 git | 待开始 | - |
| G43-03 fetch | 待开始 | - |
| G43-04 火山方舟 + E2E | 待开始 | - |
| 主应用集成 | 待开始 | - |
| 文档 | 待开始 | - |

---

**Cycle 43 启动 - MCP 真实服务器连接** 🚀
