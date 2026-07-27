# T10: MCP 细粒度权限控制 - 规格说明

## 1. 功能需求描述

### 1.1 功能目标
实现工具级细粒度权限控制，支持 auto / manual / blocked 三种模式，配合 WebSocket 实时审批流。

### 1.2 用户场景
- 用户希望危险操作（write_file、run_command）需要确认
- 用户希望白名单工具（read_file）自动执行
- 用户希望永久阻止某些工具
- 用户希望审计所有工具调用

### 1.3 使用流程
1. **配置阶段**: 用户打开权限面板，配置每个工具的权限模式
2. **执行阶段**: LLM 调用工具 → 检查权限模式
   - auto: 直接执行
   - manual: WebSocket 推送审批请求 → 用户决策
   - blocked: 拒绝并返回错误
3. **审计阶段**: 所有调用记录到审计日志

## 2. 技术实现方案

### 2.1 技术选型
- **权限策略**: `Enum` + `dataclass` 配置
- **审批流**: WebSocket 实时通知
- **审计日志**: SQLite + 索引优化

### 2.2 权限模式

```
┌──────────────────────────────────────────┐
│ LLM 调用工具                              │
└────────────┬─────────────────────────────┘
             ↓
      检查权限模式
             ↓
     ┌───────┼───────┐
     ↓       ↓       ↓
   AUTO   MANUAL  BLOCKED
     ↓       ↓       ↓
   执行    等待    拒绝
           用户决策
```

### 2.3 核心算法
- **权限检查**: 工具名 → 策略表查找 → 返回模式
- **审批流**: `permission_request` WebSocket 消息 → 用户响应 → 恢复执行
- **审计**: 调用前/后写入审计表，包含工具名、参数、结果、时间戳

## 3. 接口设计规范

### 3.1 数据模型

```python
class PermissionMode(str, Enum):
    AUTO = "auto"           # 自动放行
    MANUAL = "manual"       # 每次确认
    BLOCKED = "blocked"     # 永久阻止

class ToolPermission(BaseModel):
    tool_name: str          # 工具名
    server_id: str          # server ID
    mode: PermissionMode
    one_time_approve: bool = False   # 单次放行
    updated_at: str
    updated_by: str

class ApprovalRequest(BaseModel):
    id: str
    tool_name: str
    arguments: Dict[str, Any]
    session_id: str
    requested_at: str
    expires_at: str         # 30s 后自动拒绝
    status: str             # pending/approved/rejected/expired

class AuditLog(BaseModel):
    id: str
    tool_name: str
    server_id: str
    arguments: Dict[str, Any]
    result: Dict[str, Any]
    success: bool
    duration_ms: int
    session_id: str
    timestamp: str
```

### 3.2 REST API 端点

```http
# 获取所有工具权限
GET /api/mcp/permissions
Response: { "permissions": [{ "tool_name": "read_file", "mode": "auto" }, ...] }

# 更新权限
PUT /api/mcp/permissions
Body: { "tool_name": "write_file", "mode": "manual" }

# 单次放行
POST /api/mcp/tools/{name}/approve
Body: { "request_id": "uuid" }

# 永久阻止
POST /api/mcp/tools/{name}/block

# 审计日志
GET /api/mcp/audit-log?tool_name=write_file&limit=100&offset=0
Response: { "logs": [...], "total": 1234 }

# 待审批请求
GET /api/mcp/approvals/pending
Response: { "pending": [...] }
```

### 3.3 WebSocket 消息

```json
// 服务端推送审批请求
{
  "type": "permission_request",
  "request_id": "uuid",
  "tool_name": "write_file",
  "arguments": {"path": "/tmp/foo.txt", "content": "..."},
  "session_id": "uuid",
  "expires_at": "2026-07-27T12:00:00Z"
}

// 客户端响应
{
  "type": "permission_response",
  "request_id": "uuid",
  "decision": "approved" | "rejected"
}
```

## 4. 数据结构定义

### 4.1 数据库表

```sql
CREATE TABLE tool_permissions (
    tool_name TEXT NOT NULL,
    server_id TEXT NOT NULL,
    mode TEXT NOT NULL,         -- auto/manual/blocked
    updated_at TIMESTAMP,
    updated_by TEXT,
    PRIMARY KEY (tool_name, server_id)
);

CREATE TABLE approval_requests (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    server_id TEXT NOT NULL,
    arguments_json TEXT,
    session_id TEXT,
    requested_at TIMESTAMP,
    expires_at TIMESTAMP,
    status TEXT DEFAULT 'pending'  -- pending/approved/rejected/expired
);

CREATE TABLE tool_audit_log (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    server_id TEXT NOT NULL,
    arguments_json TEXT,
    result_json TEXT,
    success INTEGER,
    error_message TEXT,
    duration_ms INTEGER,
    session_id TEXT,
    user_id TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_tool_time ON tool_audit_log(tool_name, timestamp);
```

## 5. 性能与安全要求

### 5.1 性能指标
- 权限检查延迟 < 10ms
- 审批请求 WebSocket 延迟 < 100ms
- 审计日志查询 < 200ms

### 5.2 安全要求
- 默认危险工具（write_file、run_command）manual 模式
- 阻止的工具不可临时放行
- 审计日志不可篡改（追加写）
- 审批请求 30s 超时自动拒绝

## 6. 验收标准

### 6.1 功能验收
- 3 种权限模式切换正常
- 工具级白名单/黑名单生效
- WebSocket 审批流正常工作
- 审计日志完整记录所有调用

### 6.2 测试用例
- **正常场景**: auto 放行、manual 审批、blocked 拒绝
- **异常场景**: 审批超时、并发审批、用户离线
- **边界场景**: 1000 个工具、10000 条审计日志

### 6.3 通过条件
- 自动化测试通过率 100%
- 浏览器 E2E 测试通过
- WebSocket 连接稳定
- 审计日志准确率 100%
