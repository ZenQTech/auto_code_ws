# T6: 外部 MCP 服务器注册 - 规格说明

## 1. 功能需求描述

### 1.1 功能目标
实现外部 MCP 服务器的注册、管理、生命周期控制，支持 stdio / streamable_http / sse 三种传输方式。

### 1.2 用户场景
- 用户希望连接第三方 MCP server（如 context7、Linear）扩展工具集
- 用户需要在多个项目间复用 MCP server 配置
- 用户需要管理多个 MCP server 的生命周期（启动/停止/重启）

### 1.3 使用流程
1. 用户打开 MCP 面板 → 切换到"外部服务器"标签
2. 点击"注册新服务器" → 填写名称/传输类型/命令或 URL
3. 提交后后端启动子进程（或建立 HTTP 连接）
4. 显示在服务器列表中，状态指示器显示运行中
5. 用户可点击启动/停止/重启/查看日志
6. 工具列表自动合并内置 + 外部

## 2. 技术实现方案

### 2.1 技术选型
- **子进程管理**: `asyncio.create_subprocess_exec`
- **HTTP 客户端**: `httpx`（流式响应）
- **进程监控**: `psutil`（健康检查）
- **配置存储**: JSON 文件（`~/.hermes/mcp_servers.json`）

### 2.2 架构设计
```
MCPClient
  ├── builtin_server: MCPServer（已有）
  ├── external_servers: Dict[str, ExternalMCPServer]  # 新增
  │     ├── stdio: StdioMCPServer
  │     ├── http: StreamableHTTPMCPServer
  │     └── sse: SSEMCPServer
  └── call_log: List[Dict]
```

### 2.3 核心算法
- **stdio 协议**: JSON-RPC over stdin/stdout，每条消息以换行符分隔
- **HTTP 协议**: POST 请求 + SSE 响应
- **健康检查**: 每 30s 发送 `ping`，超时 5s 视为离线
- **自动重启**: 崩溃后等待 3s 自动重启，最多 3 次

## 3. 接口设计规范

### 3.1 数据模型

```python
class MCPServerType(str, Enum):
    STDIO = "stdio"
    STREAMABLE_HTTP = "streamable_http"
    SSE = "sse"

class MCPServerStatus(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    CRASHED = "crashed"
    STARTING = "starting"

class ExternalMCPServerConfig(BaseModel):
    id: str                          # UUID
    name: str                        # 显示名（唯一）
    transport: MCPServerType         # 传输类型
    command: Optional[str]           # stdio: 可执行命令
    args: List[str] = []             # stdio: 命令参数
    url: Optional[str]               # http/sse: URL
    env: Dict[str, str] = {}         # 环境变量
    headers: Dict[str, str] = {}     # HTTP headers
    enabled: bool = True
    startup_timeout_sec: int = 20
    tool_timeout_sec: int = 120
    auto_restart: bool = True
    max_restarts: int = 3
```

### 3.2 REST API 端点

```http
# 注册新 server
POST /api/mcp/servers
{
  "name": "context7",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"],
  "env": {},
  "enabled": true
}

# 列出所有 server（含 builtin + external）
GET /api/mcp/servers
Response: { "servers": [...], "builtin_tools": 4, "external_tools": 12 }

# 注销 server
DELETE /api/mcp/servers/{id}

# 重启 server
POST /api/mcp/servers/{id}/restart
Response: { "success": true, "status": "running" }

# 健康检查
GET /api/mcp/servers/{id}/status
Response: { "status": "running", "uptime_sec": 3600, "restart_count": 0 }

# 查看 server 日志
GET /api/mcp/servers/{id}/logs?limit=100
Response: { "logs": [...] }
```

## 4. 数据结构定义

### 4.1 数据库表

```sql
CREATE TABLE mcp_external_servers (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    transport TEXT NOT NULL,
    command TEXT,
    args_json TEXT,
    url TEXT,
    env_json TEXT,
    headers_json TEXT,
    enabled INTEGER DEFAULT 1,
    startup_timeout_sec INTEGER DEFAULT 20,
    tool_timeout_sec INTEGER DEFAULT 120,
    auto_restart INTEGER DEFAULT 1,
    max_restarts INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 5. 性能与安全要求

### 5.1 性能指标
- stdio server 启动时间 ≤ 5s
- HTTP server 健康检查响应 ≤ 1s
- 工具调用 P95 延迟 ≤ 500ms
- 子进程内存占用 ≤ 200MB

### 5.2 安全要求
- 环境变量不写入日志
- 命令注入防护（白名单命令名）
- OAuth token 加密存储（AES-256）
- 路径访问限制（workspace_root 内）

## 6. 验收标准

### 6.1 功能验收
- 所有 5 个 REST API 端点正常
- stdio/HTTP/SSE 三种传输方式都可用
- 自动重启功能正常
- 配置文件持久化正确

### 6.2 测试用例
- **正常场景**: 注册 → 启动 → 调用工具 → 停止 → 注销
- **异常场景**: 注册失败、启动超时、调用错误
- **边界场景**: 同时注册 10 个 server、空配置、重复注册

### 6.3 通过条件
- 自动化测试通过率 100%
- 浏览器 E2E 测试通过
- TypeScript 编译 0 错误
