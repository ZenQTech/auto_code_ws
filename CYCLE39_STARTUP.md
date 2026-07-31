# CYCLE39 启动文档 (v6.111.0)

> **Cycle**: 39 - MCP 协议深度集成
> **推荐时间**: 2026-08-01
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

## 二、推荐任务 (3 大 P0)

### G39-01 MCP 客户端核心 (优先级 🔥)

**目标**: 实现 MCP 协议客户端

**关键交付**:
- JSON-RPC 2.0 序列化/反序列化
- Stdio 传输 (子进程 + stdin/stdout)
- SSE 传输 (HTTP + Server-Sent Events)
- WebSocket 传输 (可选)
- MCP 握手 (initialize + capabilities 协商)
- 工具/资源/提示词三类能力调用

**对标**: @modelcontextprotocol/sdk (TypeScript 官方 SDK)

### G39-02 MCP 服务器注册表 + 内置服务器 (优先级 🔥)

**目标**: 实现 MCP 服务器注册与管理

**关键交付**:
- 服务器注册表 (Registry + 启停/重启/健康检查)
- 内置 3-5 个常用服务器:
  - FilesystemMcpServer (本地文件操作)
  - GitHubMcpServer (仓库/PR/Issue)
  - MemoryMcpServer (跨会话记忆)
  - FetchMcpServer (HTTP 抓取)
  - TimeMcpServer (时间/时区)
- 配置文件 (mcp.config.json)

**对标**: Cursor MCP / Claude Desktop MCP

### G39-03 MCP UI 面板 + 主应用集成 (优先级 🔥)

**目标**: 提供 MCP 服务器管理界面

**关键交付**:
- McpServerPanel 面板:
  - 已注册服务器列表
  - 添加/删除/启停操作
  - 工具/资源/提示词浏览
  - 实时调用测试
- 主应用集成 (BrandHeader + AppLayout + App.tsx)
- 3 个新菜单项 + 图标

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

**推荐**:
- A. 维持 DeepSeek + 火山方舟 (与 Cycle 37/38 一致)
- B. 评估 Anthropic Claude (MCP 原生支持)
- C. 双 Provider (DeepSeek + Claude)

---

## 五、任务规模

**推荐**:
- A. 维持 3 大 P0 (与 Cycle 36 一致)
- B. 扩展到 4 大 (新增 MCP Bridge / MCP Marketplace)
- C. 缩减到 2 大 (聚焦客户端 + UI)

**建议**: A 方案 3 大 P0 - 客户端 + 服务器注册表 + UI

---

## 六、质量目标

- TypeScript 严格模式 **0 错误**
- 单元测试 **100% 通过** (目标 200+ 新测试)
- 真实 MCP 服务器对接 **至少 1 个** (Filesystem)
- 主应用集成 **4 个新菜单项**
- Git 原子化提交 **3 个 commit**

---

## 七、风险评估

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| MCP 协议复杂度 | 中 | 参考官方 SDK + 简化实现 |
| 子进程管理跨平台 | 中 | 使用 Node child_process 标准 API |
| 长连接稳定性 | 低 | 实现心跳 + 自动重连 |
| 权限与沙箱 | 高 | 复用 HumanApprovalEngine |

---

## 八、时间线

| 阶段 | 任务 | 预计时间 |
|------|------|---------|
| Phase 1-3 | 调研 + SPEC + 计划 | 1 天 |
| Phase 4 | G39-01 客户端核心 | 2 天 |
| Phase 4 | G39-02 注册表 + 内置服务器 | 2 天 |
| Phase 4 | G39-03 UI + 集成 | 1 天 |
| Phase 5 | 测试 + 修复 | 1 天 |
| Phase 6 | 验收 + 文档 | 1 天 |

**总计**: 7-8 天

---

## 九、待用户确认

1. **方向选择**: A. MCP 协议深度集成 (推荐) / B. 其他
2. **任务规模**: A. 3 大 P0 (推荐) / B. 4 大 / C. 2 大
3. **API 接入**: A. 维持 DeepSeek + 火山方舟 (推荐) / B. 加入 Claude / C. 其他
4. **真实服务器**: 必接 FilesystemMcpServer (本地文件) - 是否需要其他？

请确认后开始 Cycle 39 Phase 1-3 准备。
