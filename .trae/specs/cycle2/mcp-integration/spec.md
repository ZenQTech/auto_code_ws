# MCP (Model Context Protocol) 集成 - Spec

## 1. 功能需求

### 1.1 目标
集成 MCP（Model Context Protocol）到智能体调度平台，使 LLM 能够通过标准化协议调用外部工具。这是 Codex CLI v0.145.0 的核心特性之一。

### 1.2 用户场景
1. **场景 A：内置工具调用**
   - 用户请求 LLM 读取文件 / 写入文件 / 执行命令
   - LLM 通过 MCP 协议调用相应工具
   - 工具执行结果回传 LLM 用于生成最终回答

2. **场景 B：第三方 MCP Server 集成**
   - 平台支持通过配置文件加载外部 MCP server（如 GitHub MCP、PostgreSQL MCP）
   - 用户的 LLM 会话可发现并调用这些工具

### 1.3 使用流程
```
用户输入 → LLM 推理 → 检测到工具调用 → 平台解析 → 
MCP client 调用工具 → 工具执行结果回传 LLM → LLM 生成最终回复
```

## 2. 技术实现方案

### 2.1 MCP 协议概述
- 基于 JSON-RPC 2.0
- 传输：stdio（本地子进程）/ SSE/HTTP（远程）
- 核心方法：
  - `initialize`：建立连接
  - `tools/list`：列出可用工具
  - `tools/call`：调用工具
  - `prompts/list`：列出提示词模板
  - `resources/list`：列出资源

### 2.2 架构设计

```
┌─────────────────────────────────────────────────────┐
│                Hermes Backend                        │
│  ┌──────────────┐    ┌────────────────────────┐   │
│  │ HermesService│───→│  MCPClient (FastAPI)   │   │
│  └──────────────┘    └────────────────────────┘   │
│                            │ stdio/SSE            │
└────────────────────────────┼──────────────────────┘
                             ▼
                  ┌──────────────────────┐
                  │  Built-in MCP Server │
                  │  - read_file         │
                  │  - write_file        │
                  │  - run_command       │
                  │  - list_directory    │
                  └──────────────────────┘
```

### 2.3 技术选型
- **后端**：Python `mcp` 官方 SDK（v1.0+）
- **传输**：stdio（内置 server）+ SSE（远程 server）
- **数据模型**：Pydantic
- **前端**：TypeScript MCP 客户端

### 2.4 核心算法
**工具调用解析**（LLM 输出 → MCP 工具调用）：
1. 解析 LLM 响应中的工具调用块
2. 提取工具名 + 参数
3. 路由到对应 MCP server
4. 收集结果注入到下一轮 LLM 上下文

## 3. 接口设计规范

### 3.1 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/mcp/servers` | GET | 列出已注册的 MCP server |
| `/api/mcp/servers` | POST | 注册新 MCP server |
| `/api/mcp/tools` | GET | 列出所有可用工具（合并所有 server） |
| `/api/mcp/tools/call` | POST | 调用工具 |
| `/api/mcp/servers/{id}` | DELETE | 注销 server |

### 3.2 请求/响应格式

```json
// POST /api/mcp/tools/call
{
  "tool_name": "read_file",
  "arguments": {
    "path": "/home/user/example.py"
  }
}

// 响应
{
  "success": true,
  "content": "def hello():\n    print('Hello')\n",
  "is_error": false
}
```

### 3.3 错误码
- 400：参数错误
- 404：工具不存在
- 500：工具执行失败
- 503：MCP server 不可用

## 4. 数据结构定义

### 4.1 MCPServer
```python
class MCPServer(Base):
    id: str  # UUID
    name: str  # 显示名
    transport: str  # "stdio" | "sse"
    command: Optional[str]  # stdio 模式：可执行命令
    args: Optional[List[str]]  # 命令参数
    url: Optional[str]  # sse 模式：URL
    env: Optional[Dict[str, str]]  # 环境变量
    enabled: bool  # 是否启用
    created_at: datetime
```

### 4.2 MCPTool
```python
class MCPTool(BaseModel):
    name: str  # 工具名
    description: str  # 工具描述
    input_schema: Dict[str, Any]  # JSON Schema
    server_id: str  # 所属 server
```

### 4.3 MCPToolCall
```python
class MCPToolCall(BaseModel):
    tool_name: str
    arguments: Dict[str, Any]
    call_id: str  # UUID，本地唯一
```

### 4.4 MCPToolResult
```python
class MCPToolResult(BaseModel):
    call_id: str
    success: bool
    content: str
    is_error: bool
    error_message: Optional[str]
```

## 5. 性能与安全要求

### 5.1 性能指标
- 工具调用延迟：< 200ms（本地工具）
- 工具列表查询：< 50ms
- 并发支持：≥ 10 个同时调用

### 5.2 安全要求
- 工具执行必须在工作空间目录白名单内
- 危险命令（rm -rf、sudo 等）需用户确认
- 工具调用日志：完整记录所有调用
- 错误隔离：单个工具失败不影响其他工具

### 5.3 资源限制
- 单个工具调用超时：30 秒
- 工具输出最大长度：1MB
- 同时活跃 server 数：≤ 10

## 6. 验收标准

### 6.1 功能验证
- [ ] MCP server 启动后 `/api/mcp/tools` 列出内置工具
- [ ] 至少实现 4 个内置工具：read_file / write_file / run_command / list_directory
- [ ] LLM 能够通过 MCP 工具调用读取文件
- [ ] 工具调用结果显示在前端
- [ ] 工具调用错误正确处理

### 6.2 测试项目

#### 6.2.1 脚本自动测试
```python
# tests/test_mcp.py
def test_initialize_builtin_server():
    """验证内置 MCP server 启动正常"""

def test_list_tools():
    """验证工具列表查询"""

def test_call_read_file():
    """验证 read_file 工具调用"""

def test_call_write_file():
    """验证 write_file 工具调用"""

def test_call_run_command():
    """验证 run_command 工具调用（含安全白名单）"""

def test_error_handling():
    """验证工具调用错误处理"""
```

#### 6.2.2 前端 E2E 测试
- [ ] 打开前端设置 → MCP 面板
- [ ] 查看内置 server 列表
- [ ] 列出工具
- [ ] 在聊天中触发文件读取：发送"读取 /tmp/test.txt"
- [ ] 验证 LLM 调用 read_file 工具并返回文件内容

### 6.3 通过条件
- 脚本自动测试通过率 100%
- 前端 E2E 测试全部通过
- 工具调用日志完整
- 性能指标达标

## 7. 实施步骤

1. **M1: 后端 MCP 服务骨架**（2h）
   - 创建 mcp_server.py 启动逻辑
   - 创建 mcp_client.py 调用逻辑
   - 实现 initialize / tools/list / tools/call 核心方法

2. **M2: 内置工具实现**（2h）
   - 实现 read_file / write_file / run_command / list_directory
   - 工作空间白名单安全检查
   - 超时和资源限制

3. **M3: API 端点**（1h）
   - 实现 5 个 REST 端点
   - Pydantic 模型定义
   - 错误处理

4. **M4: 前端集成**（2h）
   - McpPanel 组件（设置页面）
   - 工具列表 UI
   - 工具调用结果显示

5. **M5: 端到端测试**（1h）
   - 自动化测试用例
   - 前端 E2E 测试
