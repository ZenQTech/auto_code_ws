# Cycle 7 P0-8: OAuth 2.1 + PKCE for MCP Servers

> **版本**: v1.0.0
> **创建日期**: 2026-07-27
> **关联调研**: CYCLE6_RESEARCH_REPORT.md §2.2
> **关联 MCP 规范**: https://modelcontextprotocol.info/specification/draft/basic/authorization/
> **状态**: ✅ 已完成（v5.3.0 2026-07-27）

---

## 1. 背景与目标

### 1.1 业务背景

当前 ExternalMCPServer（Cycle 3 T6 实现）只支持 `command + args`（stdio）和 `url`（HTTP/SSE）两种传输方式，但没有标准化的认证机制。这导致：

1. **企业级 MCP 服务器无法接入**：如 GitHub MCP、Slack MCP、Notion MCP 等都需要 OAuth 2.0
2. **每个 server 需要自定义 auth-model**：增加维护成本和攻击面
3. **缺少行业标准合规**：无法满足企业 SSO 需求

### 1.2 目标

实现符合 **MCP Authorization Spec 2026-06-18（稳定版）** 的 OAuth 2.1 + PKCE 流程：

- **PKCE S256 强制 + 禁用 implicit flow**
- **动态客户端注册（RFC 7591）**
- **Audience-bound tokens**（防 confused-deputy 攻击）
- **刷新 token 单次使用 + 重放检测**
- **OS-native credential 存储**（Keychain/DPAPI/libsecret）

### 1.3 非目标

- 完整实现 OAuth Provider（不充当 IdP，只做 Client/Resource Server）
- 完整的 EMA/ID-JAG 集成（标记为可选项）
- 替换现有 stdio 传输的简单 auth

---

## 2. 技术选型

### 2.1 核心库

| 库 | 用途 | 版本 |
|----|------|------|
| `authlib` | OAuth 2.1 + PKCE S256 客户端 | ≥1.3.0 |
| `cryptography` | PKCE code_verifier/code_challenge | ≥41.0 |
| `secrets` (stdlib) | state/nonce 随机数生成 | 3.10+ |
| `keyring` (可选) | OS-native credential 存储 | ≥24.0 |

### 2.2 架构选型

**选项 A：完整 OAuth Server（实现 4 个端点）**
- 优点：自包含，无需外部 IdP
- 缺点：实现复杂，需管理 client_secret

**选项 B：Authorization Code + PKCE Proxy（推荐）**
- 优点：复用外部 IdP（Google/GitHub/Microsoft），符合 MCP spec
- 缺点：依赖外部 IdP 可用性

**选项 C：Device Code Flow（CLI 场景）**
- 优点：适合 headless 环境
- 缺点：需要用户在另一设备上操作

**最终选择**：**A + B 组合**
- 自托管简单场景：使用内置 OAuth Server
- 企业场景：代理到外部 IdP（GitHub/Google/Microsoft）

---

## 3. 数据模型

### 3.1 OAuthClient（动态注册）

```python
@dataclass
class OAuthClient:
    client_id: str                 # 唯一标识（UUID）
    client_secret: Optional[str]   # 仅 confidential client
    client_name: str               # 显示名
    redirect_uris: List[str]       # 允许的回调 URI
    grant_types: List[str]         # authorization_code, refresh_token
    token_endpoint_auth_method: str  # none（public client, PKCE）
    created_at: float
    metadata: Dict[str, Any]
```

### 3.2 AuthorizationCode

```python
@dataclass
class AuthorizationCode:
    code: str                       # 一次性使用
    client_id: str
    user_id: str                    # 资源所有者
    redirect_uri: str
    scope: str
    code_challenge: str             # PKCE
    code_challenge_method: str      # S256
    expires_at: float               # 10 分钟过期
    used: bool = False
```

### 3.3 AccessToken / RefreshToken

```python
@dataclass
class AccessToken:
    token: str                      # JWT
    client_id: str
    user_id: str
    scope: str
    audience: str                   # 防 confused-deputy
    expires_at: float               # 1 小时
    issued_at: float

@dataclass
class RefreshToken:
    token: str                      # 一次性使用
    access_token_jti: str           # 关联的 access_token
    used: bool = False              # 重放检测
    expires_at: float               # 30 天
```

### 3.4 存储

- **内存存储**（默认）：`InMemoryOAuthStore` 单例，参考 `InMemoryChatStorage` 模式
- **可选持久化**：SQLite（未来扩展）
- **Client Secret**：keyring / 加密文件

---

## 4. API 设计

### 4.1 MCP 规范的 4 个核心端点

#### 4.1.1 `GET /.well-known/oauth-authorization-server`

**作用**：返回 OAuth Server 元数据（RFC 8414）

**响应**：
```json
{
  "issuer": "http://127.0.0.1:8000",
  "authorization_endpoint": "http://127.0.0.1:8000/oauth/authorize",
  "token_endpoint": "http://127.0.0.1:8000/oauth/token",
  "registration_endpoint": "http://127.0.0.1:8000/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["read", "write", "admin"]
}
```

#### 4.1.2 `POST /oauth/register`（RFC 7591 动态客户端注册）

**请求**：
```json
{
  "client_name": "My MCP Client",
  "redirect_uris": ["http://localhost:3000/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"]
}
```

**响应**：
```json
{
  "client_id": "client-abc123",
  "client_id_issued_at": 1785142000,
  "redirect_uris": ["http://localhost:3000/callback"],
  "token_endpoint_auth_method": "none"
}
```

#### 4.1.3 `GET /oauth/authorize`

**查询参数**：
- `response_type=code`
- `client_id=xxx`
- `redirect_uri=xxx`
- `code_challenge=xxx`（PKCE）
- `code_challenge_method=S256`
- `state=xxx`
- `scope=read+write`

**行为**：返回 HTML 同意页面（自动授权用于内部测试）

**响应**：302 跳转 `redirect_uri?code=xxx&state=xxx`

#### 4.1.4 `POST /oauth/token`

**请求**（Authorization Code Grant）：
```json
{
  "grant_type": "authorization_code",
  "code": "xxx",
  "client_id": "xxx",
  "redirect_uri": "xxx",
  "code_verifier": "xxx"
}
```

**响应**：
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_xxx",
  "scope": "read write"
}
```

**请求**（Refresh Token Grant）：
```json
{
  "grant_type": "refresh_token",
  "refresh_token": "rt_xxx",
  "client_id": "xxx"
}
```

**错误响应**（RFC 6749 §5.2）：
```json
{
  "error": "invalid_grant",
  "error_description": "Refresh token already used (possible replay)"
}
```

### 4.2 管理 API（用于 UI 展示）

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/mcp/oauth/clients` | GET | 列出所有已注册客户端 |
| `/api/mcp/oauth/tokens` | GET | 列出活跃 tokens（脱敏） |
| `/api/mcp/oauth/clients/{id}` | DELETE | 撤销客户端 |
| `/api/mcp/oauth/revoke` | POST | 撤销 token |

---

## 5. 前端设计

### 5.1 集成位置

在 `Cycle3Panel` 的"外部服务器"标签页中，添加"🔐 OAuth 2.1 配置"按钮，点击后打开新的 OAuthConfigModal。

### 5.2 OAuthConfigModal 组件（预计 ~400 行）

**布局**：
```
┌─────────────────────────────────────────────┐
│  🔐 OAuth 2.1 + PKCE 配置                  │
├─────────────────────────────────────────────┤
│  服务器列表（可绑定 OAuth）                  │
│  ├─ GitHub MCP     [绑定] [已绑定✓]         │
│  ├─ Slack MCP      [绑定]                   │
│  └─ 自定义服务器    [绑定]                   │
├─────────────────────────────────────────────┤
│  客户端注册信息                              │
│  client_id: client-abc123                  │
│  redirect_uri: http://localhost:3000/cb    │
│  scope: [read] [write] [admin]             │
├─────────────────────────────────────────────┤
│  授权流程（PKCE）                            │
│  code_verifier: [生成] [复制]               │
│  code_challenge: auto-computed              │
│  authorize URL: [打开浏览器] [复制]          │
│  callback code: [输入] [交换 token]         │
├─────────────────────────────────────────────┤
│  Token 管理                                  │
│  access_token: 显示 ✓ 过期时间 ✓ scope      │
│  refresh_token: [刷新] [撤销]               │
└─────────────────────────────────────────────┘
```

### 5.3 PKCE 流程可视化

使用 5 步骤进度条：
1. 生成 code_verifier（43-128 字符）
2. 计算 code_challenge = BASE64URL(SHA256(code_verifier))
3. 打开 authorize URL（用户授权）
4. 接收 callback 中的 code
5. POST /oauth/token 交换 access_token

---

## 6. 安全设计

### 6.1 必须实现的安全措施

- [x] **PKCE S256 强制**：拒绝 `plain` method
- [x] **state 参数验证**：防 CSRF
- [x] **redirect_uri 严格匹配**：不允许通配符
- [x] **Authorization code 一次性**：使用后立即销毁
- [x] **Refresh token 一次性**：使用后轮换，检测重放
- [x] **Audience binding**：access_token 必须包含 `aud` 声明
- [x] **短期 access_token**：1 小时过期
- [x] **code_verifier 长度验证**：43-128 字符

### 6.2 推荐实现

- [ ] **JWT 签名**：使用 HS256 + 服务端密钥
- [ ] **Rate limiting**：authorize 端点每 IP 每分钟 10 次
- [ ] **Audit log**：所有 token 颁发/撤销记录

---

## 7. 测试策略

### 7.1 单元测试（30+ 用例）

| 模块 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `oauth_store.py` | 8 | CRUD + 过期清理 |
| `pkce.py` | 6 | S256 计算 + 验证 |
| `jwt_helper.py` | 6 | 签发/验证/audience |
| `handlers/register.py` | 4 | 动态注册 + 错误码 |
| `handlers/authorize.py` | 4 | 同意页面 + 跳转 |
| `handlers/token.py` | 6 | code 交换 + refresh + 重放检测 |
| **总计** | **34** | **100% 覆盖** |

### 7.2 E2E 测试（10+ 场景）

```bash
# 完整 OAuth 2.1 + PKCE 流程
1. GET /.well-known/oauth-authorization-server
2. POST /oauth/register
3. GET /oauth/authorize → 302 redirect with code
4. POST /oauth/token (authorization_code) → access_token + refresh_token
5. POST /oauth/token (refresh_token) → new tokens
6. POST /oauth/token (reuse old refresh_token) → invalid_grant
7. POST /oauth/revoke → token destroyed
8. POST /oauth/token (expired code) → invalid_grant
9. POST /oauth/register (invalid redirect_uri) → invalid_redirect_uri
10. POST /oauth/token (wrong code_verifier) → invalid_grant
```

### 7.3 浏览器实测

- 打开 OAuthConfigModal
- 触发完整 PKCE 流程
- 验证 token 显示 + 刷新 + 撤销

---

## 8. 验收标准

### 8.1 后端验收

- [ ] 4 个核心端点全部实现并通过单元测试
- [ ] PKCE S256 强制启用（拒绝 plain）
- [ ] 刷新 token 重放检测工作正常
- [ ] Audience binding 验证生效
- [ ] 元数据端点符合 RFC 8414
- [ ] 动态注册符合 RFC 7591
- [ ] 错误响应符合 RFC 6749 §5.2

### 8.2 前端验收

- [ ] OAuthConfigModal 组件可打开
- [ ] PKCE 5 步骤流程可视化
- [ ] Token 状态实时显示
- [ ] 刷新 + 撤销按钮工作

### 8.3 集成验收

- [ ] ExternalMCPServer 支持 `oauth` 字段
- [ ] 工具调用自动附带 Bearer token
- [ ] 401 响应触发自动 refresh

### 8.4 测试通过率

- [ ] 单元测试 100% 通过
- [ ] E2E 测试 100% 通过
- [ ] 浏览器实测 100% 通过
- [ ] TypeScript 0 errors
- [ ] Vite build 成功

---

## 9. 实施时序

### Phase 1: 后端核心（3-4 小时）
1. ✅ 创建 `backend/app/services/mcp/oauth/` 目录
2. ✅ 实现 `pkce.py` - PKCE S256 工具
3. ✅ 实现 `jwt_helper.py` - JWT 签发/验证
4. ✅ 实现 `oauth_store.py` - InMemoryOAuthStore
5. ✅ 实现 `oauth_service.py` - 主服务
6. ✅ 实现 `api/oauth.py` - 4 个核心端点
7. ✅ 实现 `api/mcp_oauth_admin.py` - 管理端点
8. ✅ 注册到 main.py

### Phase 2: 单元测试（1-2 小时）
9. ✅ 创建 `tests/test_oauth_units.py` - 34 个测试用例
10. ✅ 运行测试，修复直到 100% 通过

### Phase 3: E2E 测试（1 小时）
11. ✅ 创建 `tests/test_e2e_oauth_21_pkce.sh` - 10+ 场景
12. ✅ 运行 E2E，修复直到 100% 通过

### Phase 4: 前端集成（2-3 小时）
13. ✅ 创建 `frontend/src/components/OAuthConfigModal.tsx`
14. ✅ 在 `Cycle3Panel` 添加按钮 + 调用
15. ✅ 集成到 `useModals` Hook

### Phase 5: 浏览器验证（1 小时）
16. ✅ TypeScript 编译 + Vite build
17. ✅ 浏览器实测 OAuthConfigModal
18. ✅ 完整 PKCE 流程演练

### Phase 6: 提交（30 分钟）
19. ✅ 更新代码修改日志 v5.3.0
20. ✅ Git commit v5.3.0
21. ✅ 生成 CYCLE7_P0_8_SUMMARY.md

---

## 10. 风险评估

### 10.1 中等风险

- **JWT 密钥管理**：使用固定开发密钥，生产需替换
- **InMemory 存储限制**：单进程，水平扩展需替换为 Redis
- **MCP 客户端兼容性**：MCP spec 仍在演进，client 实现可能不完整

### 10.2 低风险

- **UI 复杂度**：5 步骤 PKCE 流程用户教育成本
- **测试覆盖**：标准 OAuth 流程覆盖完整即可

### 10.3 缓解措施

- 提供默认开发密钥 + .env 配置说明
- 提供抽象 Store 接口，支持未来 Redis 扩展
- 实现完整 RFC 6749/7591/8414 错误码，最大限度兼容

---

## 11. 文件清单（预计）

### 新建（10 个）

```
backend/app/services/mcp/oauth/__init__.py
backend/app/services/mcp/oauth/pkce.py
backend/app/services/mcp/oauth/jwt_helper.py
backend/app/services/mcp/oauth/oauth_store.py
backend/app/services/mcp/oauth/oauth_service.py
backend/app/api/oauth.py
backend/app/api/mcp_oauth_admin.py
frontend/src/components/OAuthConfigModal.tsx
tests/test_oauth_units.py
tests/test_e2e_oauth_21_pkce.sh
```

### 修改（5 个）

```
backend/app/main.py                                  (+注册路由)
backend/app/api/mcp.py                               (+oauth 字段支持)
frontend/src/hooks/useModals.ts                      (+oauthConfig 面板)
frontend/src/components/Cycle3Panel.tsx              (+按钮 + 调用)
代码修改日志.md                                       (v5.2.0 → v5.3.0)
```

---

## 12. 关联交付物

| 文档 | 路径 |
|------|------|
| 代码修改日志 | `代码修改日志.md` v5.3.0 |
| 实施总结 | `CYCLE7_P0_8_SUMMARY.md` |
| 单元测试 | `tests/test_oauth_units.py` |
| E2E 测试 | `tests/test_e2e_oauth_21_pkce.sh` |
| 调研报告 | `CYCLE6_RESEARCH_REPORT.md` §2.2 |

