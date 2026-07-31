# CYCLE39 启动文档 (v6.111.0)

> **Cycle**: 39 - MCP 协议深度集成
> **方向选定**: A. MCP 协议深度集成 (推荐)
> **任务规模**: B. 4 大 P0 (推荐)
> **开始时间**: 2026-07-31
> **目标**: 接入 1000+ 第三方 MCP 服务器，扩展 Agent Loop 工具生态

---

## 一、调研结论

### 1.1 MCP 协议价值

**Model Context Protocol (MCP)** 是 Anthropic 提出的开放协议，用于标准化 LLM 与外部工具/数据源的连接。

**核心价值**:
- 🌐 **生态**: 已发布 1000+ MCP 服务器 (Filesystem / GitHub / Slack / Postgres / ...)
- 🔌 **互操作**: JSON-RPC 2.0 标准化协议
- 🛠️ **三类能力**: 工具 (Tools) / 资源 (Resources) / 提示词 (Prompts)
- 🔒 **安全**: 显式权限声明 + 沙箱隔离

### 1.2 与 Cycle 38 集成点

- **MCP Tools** → ToolUseEngine (Cycle 37 G37-02)
- **MCP Resources** → RAGEngine (Cycle 37 G37-01)
- **MCP Prompts** → AgentLoopEngine (Cycle 37 G37-03)
- **MCP Servers** → MultiAgentEngine (Cycle 38 G38-01)
- **MCP Permissions** → HumanApprovalEngine (Cycle 38 G38-04)

---

## 二、4 大 P0 任务

### G39-01 MCP 客户端核心引擎

**目标**: 实现 MCP 协议客户端核心
**关键交付**:
- JSON-RPC 2.0 序列化/反序列化
- Stdio 传输 (子进程 + stdin/stdout)
- SSE 传输 (HTTP + Server-Sent Events)
- MCP 握手 (initialize + capabilities 协商)
- 工具/资源/提示词三类能力调用
- 错误处理 + 心跳 + 自动重连

**对标**: @modelcontextprotocol/sdk (TypeScript 官方 SDK)

### G39-02 MCP 服务器注册表 + 5 个内置服务器

**目标**: 实现 MCP 服务器注册与管理
**关键交付**:
- McpServerRegistry (注册/启停/重启/健康检查)
- 5 个内置常用服务器:
  - FilesystemMcpServer (本地文件操作)
  - GitHubMcpServer (仓库/PR/Issue)
  - MemoryMcpServer (跨会话记忆)
  - FetchMcpServer (HTTP 抓取)
  - TimeMcpServer (时间/时区)
- 配置文件 (mcp.config.json)

**对标**: Cursor MCP / Claude Desktop MCP

### G39-03 MCP UI 面板 + 主应用集成

**目标**: 提供 MCP 服务器管理界面
**关键交付**:
- McpServerPanel (5 个标签页: Servers/Tools/Resources/Prompts/Logs)
- 主应用集成 (BrandHeader + AppLayout + App.tsx)
- 1 个新菜单项 + 图标

### G39-04 MCP Marketplace + Bridge 高级

**目标**: 扩展 MCP 生态与跨协议桥接
**关键交付**:
- McpMarketplace 面板 (浏览 + 安装 + 推荐)
- McpBridge (MCP ↔ OpenAI Function Calling ↔ Anthropic Tool Use)
- 跨协议转换 (协议无关的中间表示 IR)
- 推荐策略 (按使用频率/相关性)

**对标**: OpenAI Function Calling 互操作 / MCP Registry

---

## 三、技术栈选择

### 3.1 协议实现

| 选项 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| @modelcontextprotocol/sdk | 官方维护 + 跨语言 | 包大小 ~200KB | ⭐⭐⭐⭐⭐ |
| 自研轻量实现 | 完全可控 | 需自测互操作性 | ⭐⭐⭐ |
| 复用 FastMCP (Python) | 简单 | 需桥接 | ⭐⭐ |

**推荐**: 优先尝试自研轻量实现（参考 SDK API），不依赖外部包以保持 bundle 体积可控。

### 3.2 传输层

| 传输 | 适用场景 | 优先级 |
|------|---------|--------|
| Stdio | 本地进程调用 | P0 |
| SSE | 远程 HTTP 服务 | P0 |
| WebSocket | 实时双向 | P2 |

---

## 四、API 接入策略

**维持**: DeepSeek + 火山方舟 Coding Plan (与 Cycle 37/38 一致)

---

## 五、任务规模

**4 大 P0** (用户确认):
- G39-01: MCP 客户端核心
- G39-02: 服务器注册表 + 5 个内置服务器
- G39-03: MCP UI 面板 + 主应用集成
- G39-04: MCP Marketplace + Bridge 高级

---

## 六、质量目标

- TypeScript 严格模式 **0 错误**
- 单元测试 **100% 通过** (目标 200+ 新测试)
- 真实 MCP 服务器对接 **至少 1 个** (Filesystem)
- 主应用集成 **1 个新菜单项**
- Git 原子化提交 **4 个 commit**

---

## 七、风险评估

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| MCP 协议复杂度 | 中 | 参考官方 SDK + 简化实现 |
| 子进程管理跨平台 | 中 | 使用 Node child_process 标准 API |
| 长连接稳定性 | 低 | 实现心跳 + 自动重连 |
| 权限与沙箱 | 高 | 复用 HumanApprovalEngine |
| 协议互操作 | 中 | 实现 IR 中间表示 |

---

## 八、时间线

| 阶段 | 任务 | 预计时间 |
|------|------|---------|
| Phase 1-3 | 调研 + SPEC + 计划 | 1 天 |
| Phase 4a | G39-01 MCP 客户端核心 | 2 天 |
| Phase 4b | G39-02 注册表 + 内置服务器 | 2 天 |
| Phase 4c | G39-03 UI + 集成 | 1 天 |
| Phase 4d | G39-04 Marketplace + Bridge | 2 天 |
| Phase 5 | 测试 + 修复 | 1 天 |
| Phase 6 | 验收 + 文档 | 1 天 |

**总计**: 10 天

---

## 九、4 大 P0 任务规格

| 任务 | 文件 | 测试 | 复杂度 |
|------|------|------|--------|
| G39-01 | mcpClient.ts (1 个) | 30+ | 高 (协议层) |
| G39-02 | mcpServerRegistry.ts + 5 server 文件 | 50+ | 中 |
| G39-03 | McpServerPanel.tsx | 0 (UI 集成) | 中 |
| G39-04 | mcpMarketplace.ts + mcpBridge.ts | 40+ | 高 (互操作) |
| **合计** | **8+ 文件** | **120+ 测试** | - |

---

## 十、用户已确认

- ✅ 方向: A. MCP 协议深度集成
- ✅ 任务规模: B. 4 大 P0
- ✅ API 接入: 维持 DeepSeek + 火山方舟

---

## 十一、开始 Phase 1-3

### 1. 关键文件

- [CYCLE39_STARTUP.md](file:///home/qizheng/auto_code_ws/CYCLE39_STARTUP.md) (本文档)
- [CYCLE39_SPEC_G39_01_MCP_CLIENT.md](file:///home/qizheng/auto_code_ws/CYCLE39_SPEC_G39_01_MCP_CLIENT.md) (待创建)
- [CYCLE39_SPEC_G39_02_SERVER_REGISTRY.md](file:///home/qizheng/auto_code_ws/CYCLE39_SPEC_G39_02_SERVER_REGISTRY.md) (待创建)
- [CYCLE39_SPEC_G39_03_MCP_PANEL.md](file:///home/qizheng/auto_code_ws/CYCLE39_SPEC_G39_03_MCP_PANEL.md) (待创建)
- [CYCLE39_SPEC_G39_04_MARKETPLACE_BRIDGE.md](file:///home/qizheng/auto_code_ws/CYCLE39_SPEC_G39_04_MARKETPLACE_BRIDGE.md) (待创建)
