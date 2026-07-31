# MCP × Multimodal RAG 安全加固指南 (Cycle 50 G50-04)

> 🔒 生产级安全配置，覆盖 CSP / CORS / API Key / 容器安全

## 目录

1. [安全模型](#安全模型)
2. [前端安全](#前端安全)
3. [后端安全](#后端安全)
4. [API Key 管理](#api-key-管理)
5. [容器安全](#容器安全)
6. [网络安全](#网络安全)
7. [审计与监控](#审计与监控)
8. [合规清单](#合规清单)

---

## 安全模型

### 信任边界

```
┌─────────────────────────────────────────────────────────────┐
│  不可信区域 (Internet)                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ WAF / CDN / 反向代理 (CloudFlare / Aliyun SLB)       │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (TLS 1.3)
┌──────────────────────────┴──────────────────────────────────┐
│  DMZ (Frontend)                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Nginx 1.27 + 静态资源 + CSP / HSTS / SRI             │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │ 内部网络 (mcp_net)
┌──────────────────────────┴──────────────────────────────────┐
│  应用层 (Backend)                                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ FastAPI + 速率限制 + 输入验证 + 审计日志              │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │ SQL over TLS
┌──────────────────────────┴──────────────────────────────────┐
│  数据层 (PostgreSQL)                                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ PostgreSQL 15 + 加密存储 + 行级权限                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 零信任原则

1. **永不信任**: 所有外部输入必须验证
2. **最小权限**: 容器以非 root 用户运行
3. **深度防御**: 多层安全控制
4. **审计完整**: 所有操作可追溯

---

## 前端安全

### 1. Content Security Policy (CSP)

**当前配置** (`deployment/nginx.conf`):

```nginx
add_header Content-Security-Policy "
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self' data:;
  connect-src 'self'
    https://ark.cn-beijing.volces.com
    https://*.volces.com
    http://localhost:8000
    ws: wss:;
  frame-ancestors 'self';
  form-action 'self';
  base-uri 'self';
" always;
```

**生产建议** (移除 unsafe-inline):

```nginx
# 使用 nonce 替代 unsafe-inline
add_header Content-Security-Policy "
  default-src 'self';
  script-src 'self' 'nonce-{NONCE}';
  style-src 'self' 'nonce-{NONCE}';
  ...
" always;
```

### 2. HTTP 安全头

| 头 | 值 | 作用 |
|------|------|------|
| `X-Frame-Options` | `SAMEORIGIN` | 防点击劫持 |
| `X-Content-Type-Options` | `nosniff` | 防 MIME 嗅探 |
| `X-XSS-Protection` | `1; mode=block` | 启用浏览器 XSS 过滤 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 限制 Referer 泄露 |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | 禁用危险 API |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 强制 HTTPS |

### 3. Subresource Integrity (SRI)

在 `index.html` 中为关键脚本添加 SRI 哈希:

```html
<script
  src="/assets/index-abc123.js"
  integrity="sha384-..."
  crossorigin="anonymous"
></script>
```

**自动生成 SRI 工具**:
```bash
# 安装
npm install -g sri-cli

# 生成
sri --algo sha384 /path/to/file.js
```

### 4. 防止 XSS

- React 默认转义所有文本
- **禁止** 使用 `dangerouslySetInnerHTML` (除非必要)
- 用户输入做白名单校验
- URL 验证 (仅允许 http/https/mailto)

---

## 后端安全

### 1. 输入验证

所有 API 端点使用 Pydantic 严格校验:

```python
from pydantic import BaseModel, Field, validator

class EmbeddingRequest(BaseModel):
    input: List[Dict[str, str]] = Field(..., min_length=1, max_length=100)
    model: str = Field(..., regex=r"^[a-zA-Z0-9_-]+$")
    
    @validator('input')
    def validate_input_size(cls, v):
        total = sum(len(str(item.get('text', ''))) for item in v)
        if total > 100_000:  # 100KB 上限
            raise ValueError("Total input size exceeds 100KB")
        return v
```

### 2. SQL 注入防护

**强制使用参数化查询** (SQLAlchemy):

```python
# ✅ 正确 (参数化)
stmt = select(Document).where(Document.id == doc_id)
result = await session.execute(stmt)

# ❌ 错误 (字符串拼接)
# query = f"SELECT * FROM documents WHERE id = '{doc_id}'"  # 禁止!
```

### 3. 速率限制

```python
from slowapi import Limiter

limiter = Limiter(key_func=get_remote_address)

@app.post("/api/embed")
@limiter.limit("60/minute")
async def embed(request: Request, body: EmbeddingRequest):
    ...
```

### 4. CORS 配置

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-domain.com",  # 生产域名
        "https://www.your-domain.com",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=600,
)
```

### 5. 错误处理

**禁止暴露堆栈给客户端**:

```python
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error: {exc}")  # 服务端记录
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},  # 客户端通用消息
    )
```

---

## API Key 管理

### 1. 加密存储 (前端)

使用 `apiKeyManager.ts` 的安全特性:

```typescript
import { getApiKeyManager } from './utils/apiKeyManager';

// 设置 API Key (加密存储到 localStorage)
const mgr = getApiKeyManager();
await mgr.setApiKey('volcengine', apiKey, {
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,  // 30 天后过期
  metadata: { source: 'ui', endpoint: 'ark.cn-beijing.volces.com' }
});

// 获取 (自动解密)
const key = await mgr.getApiKey('volcengine');
```

### 2. 加密算法

- **AES-256-CBC** (Web Crypto API)
- 每次加密使用**随机 IV**
- Master Key 通过 SHA-256 派生
- Salt 16 字节 (随机)

### 3. 轮换策略

```typescript
// 定期轮换 (推荐 90 天)
await mgr.rotateApiKey('volcengine', newKey);

// 旧 Key 自动删除
// 新 Key 立即生效
```

### 4. 审计日志

```typescript
mgr.subscribe((event) => {
  // 上报到后端
  fetch('/api/audit', {
    method: 'POST',
    body: JSON.stringify({
      type: event.type,
      provider: event.provider,
      timestamp: event.timestamp,
      // 注意: 不上报 keyId 明文
    }),
  });
});
```

### 5. 永不明文记录

**禁止**:
- ❌ `console.log(apiKey)`
- ❌ `localStorage.setItem('apiKey', plainKey)`
- ❌ 错误信息中包含 Key 片段
- ❌ URL 参数中包含 Key

**应该**:
- ✅ 始终使用 `mgr.getApiKey(provider)`
- ✅ 审计日志仅包含 `keyId` (指纹)
- ✅ 错误信息仅包含 provider 名称

---

## 容器安全

### 1. 非 root 用户

```dockerfile
# 在 frontend/Dockerfile 和 Dockerfile 中添加
RUN addgroup -g 1000 mcp && adduser -u 1000 -G mcp -D mcp
USER mcp
```

### 2. 最小化基础镜像

```dockerfile
FROM nginx:1.27-alpine  # ~ 40MB
# 而不是
FROM nginx:latest        # ~ 180MB
```

### 3. 镜像扫描

```bash
# 使用 Trivy 扫描
trivy image mcp-frontend:1.0.0

# 使用 Snyk
snyk container test mcp-frontend:1.0.0
```

### 4. 只读文件系统

```yaml
# docker-compose.production.yml
services:
  frontend:
    read_only: true
    tmpfs:
      - /var/cache/nginx
      - /var/run
      - /tmp
```

### 5. 资源限制

```yaml
deploy:
  resources:
    limits:
      cpus: "0.5"
      memory: 512M
    reservations:
      cpus: "0.1"
      memory: 64M
```

### 6. seccomp / AppArmor

```yaml
security_opt:
  - seccomp:default
  - apparmor:docker-default
```

---

## 网络安全

### 1. TLS 配置

```nginx
# /etc/nginx/conf.d/ssl.conf
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_stapling on;
ssl_stapling_verify on;
```

### 2. 内部网络隔离

```yaml
# docker-compose.production.yml
networks:
  mcp_net:
    driver: bridge
    internal: false  # 允许外网 (前端需要)
  backend_net:
    driver: bridge
    internal: true   # 禁止外网 (后端和数据库)
```

### 3. PostgreSQL 仅本地访问

```yaml
ports:
  - "127.0.0.1:5432:5432"  # 仅本地访问
```

### 4. 防火墙规则 (UFW 示例)

```bash
# 仅开放必要端口
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP
sudo ufw allow 443/tcp       # HTTPS
sudo ufw allow 8080/tcp      # 前端 (内部访问)
sudo ufw enable
```

---

## 审计与监控

### 1. 关键事件

| 事件 | 级别 | 来源 |
|------|------|------|
| API Key 创建/删除/轮换 | INFO | `apiKeyManager` |
| 登录/登出 | INFO | 后端 |
| 限流触发 | WARNING | `rateLimiter` |
| 401/403 错误 | WARNING | 后端 |
| 5xx 错误 | ERROR | 后端 |
| 配置变更 | WARNING | 后端 |

### 2. Prometheus 指标

```yaml
# 关键 SLI/SLO 指标
- http_requests_total{method, status, endpoint}
- http_request_duration_seconds_bucket{le}
- volcengine_api_requests_total{status}
- multimodal_embeddings_total{modality, provider}
- multimodal_searches_total{modality, cache_hit}
- rate_limit_rejected_total{endpoint}
- api_key_rotations_total{provider}
```

### 3. 日志格式

```json
{
  "timestamp": "2026-08-01T10:00:00.000Z",
  "level": "INFO",
  "service": "mcp-backend",
  "trace_id": "abc123",
  "user_id": "u_12345",
  "event": "embedding_request",
  "modality": "text",
  "provider": "volcengine",
  "latency_ms": 234,
  "cost_usd": 0.0008
}
```

### 4. 告警规则

```yaml
# 异常登录
- alert: UnusualLoginLocation
  expr: count by (user_id) (login_event{status="success"}) > 5
  for: 1h

# API 错误激增
- alert: APIErrorSpike
  expr: rate(api_errors_total[5m]) > rate(api_errors_total[1h] offset 1h)
  for: 10m

# API Key 频繁轮换
- alert: APIKeyRotationAnomaly
  expr: rate(api_key_rotations_total[1h]) > 3
  for: 5m
```

---

## 合规清单

### OWASP Top 10 (2026) 防护

| 风险 | 防护措施 | 状态 |
|------|----------|------|
| A01: 访问控制失效 | JWT + RBAC + 速率限制 | ✅ |
| A02: 加密失效 | TLS 1.3 + AES-256 + 加密存储 | ✅ |
| A03: 注入 | 参数化查询 + 输入验证 | ✅ |
| A04: 不安全设计 | 威胁建模 + 安全评审 | ✅ |
| A05: 安全配置错误 | 加固配置 + 镜像扫描 | ✅ |
| A06: 易受攻击组件 | 依赖扫描 + 及时更新 | ⚠️ |
| A07: 身份认证失效 | MFA + 强密码策略 | ⚠️ |
| A08: 软件和数据完整性 | SRI + 签名验证 | ✅ |
| A09: 安全日志监控 | Prometheus + 审计日志 | ✅ |
| A10: SSRF | URL 白名单 + DNS 验证 | ✅ |

### 部署前检查清单

- [ ] 所有环境变量已设置 (`.env.production`)
- [ ] 默认密码已修改
- [ ] TLS 证书已配置
- [ ] CSP 头已启用
- [ ] 容器以非 root 运行
- [ ] 资源限制已设置
- [ ] 镜像扫描通过
- [ ] 数据库备份策略已就绪
- [ ] 监控告警已配置
- [ ] API Key 加密存储
- [ ] 审计日志已启用
- [ ] 速率限制已启用
- [ ] 日志不包含敏感信息
- [ ] CORS 白名单已配置
- [ ] 错误信息已脱敏

### 应急响应

#### 凭据泄露

1. **立即** 轮换所有 API Key
2. 撤销 JWT token
3. 检查审计日志定位影响范围
4. 通知用户
5. 提交事件报告

#### 容器被入侵

1. 隔离容器 (`docker network disconnect`)
2. 保留证据 (`docker commit`)
3. 重新部署干净镜像
4. 分析根本原因
5. 更新 WAF / IPS 规则

---

## 参考资料

- [OWASP Top 10](https://owasp.org/Top10/)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [NIST SP 800-190](https://csrc.nist.gov/publications/detail/sp/800-190/final)
- [Mozilla Web Security Guidelines](https://infosec.mozilla.org/guidelines/web_security)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [火山方舟 API 安全](https://www.volcengine.com/docs/82379)

---

**Cycle 50 G50-04 安全加固文档 v1.0.0 | 2026-08-01**
