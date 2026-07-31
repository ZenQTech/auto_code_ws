# MCP × Multimodal RAG 部署指南 (Cycle 50 G50-04)

> 📦 生产级部署文档，覆盖 Docker Compose / Kubernetes / 裸机部署

## 目录

1. [前置条件](#前置条件)
2. [快速开始 (Docker Compose)](#快速开始)
3. [环境变量配置](#环境变量配置)
4. [构建镜像](#构建镜像)
5. [Kubernetes 部署](#kubernetes-部署)
6. [性能调优](#性能调优)
7. [故障排查](#故障排查)
8. [升级与回滚](#升级与回滚)

---

## 前置条件

### 硬件最低配置

| 组件 | 最低 | 推荐 | 说明 |
|------|------|------|------|
| CPU  | 4 核 | 8 核+ | 向量计算密集 |
| 内存 | 8 GB | 16 GB+ | FAISS 索引驻留 |
| 存储 | 50 GB | 200 GB+ | SSD 推荐 |
| GPU  | -    | NVIDIA T4+ | CLIP 推理加速 (可选) |

### 软件依赖

- Docker 24.0+
- Docker Compose 2.20+
- Node.js 24.15.0 (仅构建时需要)
- Python 3.10+ (仅后端开发时)
- PostgreSQL 15+ (生产环境推荐外部托管)

### 网络要求

- **入站**: 80/443 (HTTP/HTTPS), 8080 (前端, 可选), 9090 (Prometheus, 内部)
- **出站**: HTTPS 访问火山方舟 API (`ark.cn-beijing.volces.com`)
- **内部**: postgres 5432, backend 8000, frontend 8080

---

## 快速开始

### 1. 克隆代码

```bash
git clone <repository-url> mcp-multimodal-rag
cd mcp-multimodal-rag
```

### 2. 创建环境变量文件

```bash
cp .env.example .env.production
# 编辑 .env.production 填入真实值
vim .env.production
```

最小配置 (`.env.production`):

```bash
# 数据库
POSTGRES_PASSWORD=your-secure-password-here

# Claude / Volcengine LLM
ANTHROPIC_AUTH_TOKEN=your-volcengine-coding-plan-token
ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding
ANTHROPIC_MODEL=deepseek-v4-flash

# Volcengine 多模态 (可选, 用于真实接入)
VOLCENGINE_API_KEY=your-volcengine-multimodal-key
VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3

# 前端构建参数
VITE_API_BASE_URL=https://your-domain.com
VITE_VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VITE_VOLCENGINE_MODEL=doubao-embedding-vision
VITE_ENABLE_METRICS=true
VITE_ENABLE_E2E_TESTS=false

# 可选: Grafana
GRAFANA_PASSWORD=your-grafana-password
```

### 3. 启动服务

```bash
# 仅核心服务 (frontend + backend + postgres)
docker compose -f docker-compose.production.yml up -d

# 包含 Prometheus + Grafana 监控
docker compose -f docker-compose.production.yml --profile monitoring up -d
```

### 4. 验证部署

```bash
# 检查服务状态
docker compose -f docker-compose.production.yml ps

# 检查健康端点
curl http://localhost:8080/healthz      # 前端
curl http://localhost:8000/health        # 后端

# 查看日志
docker compose -f docker-compose.production.yml logs -f frontend
```

### 5. 访问 UI

打开浏览器访问 `http://localhost:8080`，进入 **MCP × 多模态 RAG 平台**。

---

## 环境变量配置

### 后端必需

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 异步连接串 | `postgresql+asyncpg://postgres:postgres@postgres:5432/claude_code` |
| `ANTHROPIC_AUTH_TOKEN` | Claude/Volcengine 认证 Token | (空) |
| `ANTHROPIC_BASE_URL` | LLM API 基础 URL | `https://ark.cn-beijing.volces.com/api/coding` |

### 前端构建参数 (Docker build args)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_API_BASE_URL` | 后端 API 地址 | `http://localhost:8000` |
| `VITE_VOLCENGINE_BASE_URL` | 火山方舟多模态 API | `https://ark.cn-beijing.volces.com/api/v3` |
| `VITE_VOLCENGINE_MODEL` | 默认多模态模型 | `doubao-embedding-vision` |
| `VITE_ENABLE_METRICS` | 启用 Prometheus 指标 | `true` |
| `VITE_ENABLE_E2E_TESTS` | 启用 E2E 测试 UI | `false` (生产关闭) |

### 可选配置

| 变量 | 说明 |
|------|------|
| `ENABLE_METRICS` | 后端暴露 `/metrics` 端点 |
| `ENABLE_E2E_TESTS` | 后端暴露 `/api/e2e/*` 端点 |
| `API_TIMEOUT_MS` | API 请求超时 (毫秒) |
| `GRAFANA_PASSWORD` | Grafana 管理员密码 |

---

## 构建镜像

### 单独构建前端

```bash
cd frontend
docker build \
  --build-arg VITE_API_BASE_URL=https://api.your-domain.com \
  --build-arg VITE_VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 \
  --build-arg VITE_VOLCENGINE_MODEL=doubao-embedding-vision \
  -t mcp-frontend:1.0.0 .
```

### 单独构建后端

```bash
docker build -f Dockerfile -t mcp-backend:1.0.0 .
```

### 推送到镜像仓库

```bash
# 打标签
docker tag mcp-frontend:1.0.0 your-registry.com/mcp/frontend:1.0.0
docker tag mcp-backend:1.0.0 your-registry.com/mcp/backend:1.0.0

# 推送
docker push your-registry.com/mcp/frontend:1.0.0
docker push your-registry.com/mcp/backend:1.0.0
```

---

## Kubernetes 部署

### 1. 创建命名空间

```bash
kubectl create namespace mcp-rag
```

### 2. 创建 Secret

```bash
kubectl create secret generic mcp-secrets \
  --from-literal=postgres-password='your-password' \
  --from-literal=anthropic-auth-token='your-token' \
  --from-literal=volcengine-api-key='your-key' \
  -n mcp-rag
```

### 3. 部署 Postgres

```yaml
# k8s/postgres.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: mcp-rag
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 50Gi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: mcp-rag
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mcp-secrets
                  key: postgres-password
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: postgres-pvc
```

### 4. 部署后端 + 前端 (使用 Deployment + Service + Ingress)

参考 `k8s/` 目录下的完整 YAML。

### 5. 水平扩展

```bash
# 后端扩容到 3 副本
kubectl scale deployment mcp-backend --replicas=3 -n mcp-rag
```

---

## 性能调优

### 1. 前端优化

#### Vite 构建优化

```bash
# 在 frontend/vite.config.ts 中配置 manualChunks
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'rag-vendor': [
            './src/utils/faissWasmVectorStore',
            './src/utils/multimodalEmbedding',
            './src/utils/multimodalVectorIndex',
          ],
          'volcengine-vendor': [
            './src/utils/realVolcengineClient',
            './src/utils/apiKeyManager',
            './src/utils/rateLimiter',
          ],
        },
      },
    },
  },
});
```

#### Nginx 调优

```nginx
# 在 deployment/nginx.conf 中调整
worker_processes auto;          # 自动检测 CPU 核数
worker_rlimit_nofile 65535;     # 增加文件描述符限制

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;
}
```

### 2. 后端优化

#### FastAPI 性能

```python
# 使用 uvicorn workers
uvicorn backend.app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 4 \
  --loop uvloop \
  --http httptools
```

#### 数据库连接池

```python
# SQLAlchemy 异步引擎
engine = create_async_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
)
```

### 3. FAISS 索引调优

| 数据规模 | 推荐索引类型 | 内存占用 |
|----------|-------------|----------|
| < 10K   | `Flat`     | 低 |
| 10K-1M  | `IVF`      | 中 |
| > 1M    | `HNSW`     | 高 |

### 4. 火山方舟限流建议

```typescript
// 前端 RateLimiter 推荐配置
const rateLimiter = new RateLimiter({
  strategy: 'token-bucket',
  windowMs: 60_000,        // 1 分钟
  maxRequests: 60,         // 60 次/分钟
  burstCapacity: 10,       // 突发 10 次
  refillRate: 1,           // 每秒补充 1 个令牌
});
```

---

## 故障排查

### 常见问题

#### 1. 前端无法访问后端 API

**症状**: 浏览器报 CORS 错误

**排查**:
```bash
# 检查后端日志
docker logs mcp_backend 2>&1 | grep -i cors

# 检查 Nginx 反代配置
docker exec mcp_frontend cat /etc/nginx/conf.d/default.conf | grep -A 5 "/api/"
```

**解决**:
- 确认后端 CORS 允许的 origin 包含前端域名
- 检查 VITE_API_BASE_URL 是否正确

#### 2. 火山方舟 API 401 Unauthorized

**症状**: 多模态 RAG 查询返回 fallback

**排查**:
```bash
# 检查 API Key 是否设置
docker exec mcp_backend env | grep VOLCENGINE

# 手动测试 API
curl -X POST https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal \
  -H "Authorization: Bearer $VOLCENGINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-embedding-vision","input":[{"type":"text","text":"test"}]}'
```

**解决**:
- 重新生成 API Key
- 检查账户余额

#### 3. 数据库连接失败

**症状**: 后端启动失败，日志 `connection refused`

**排查**:
```bash
# 检查 postgres 状态
docker exec mcp_postgres pg_isready

# 检查 DATABASE_URL
docker exec mcp_backend env | grep DATABASE_URL
```

**解决**:
- 确认 postgres 容器健康
- 检查网络 `mcp_net` 是否正常

#### 4. E2E 测试超时

**症状**: 运行 E2E 套件超时

**解决**:
- 减小测试数据集
- 增加 `timeout` 字段
- 检查 volcing API 限流

#### 5. 内存溢出 (OOM)

**症状**: 容器被 OOM Killer 杀死

**解决**:
```yaml
# 限制前端内存
deploy:
  resources:
    limits:
      memory: 1G

# 限制后端内存
deploy:
  resources:
    limits:
      memory: 8G
```

### 日志位置

| 容器 | 日志路径 |
|------|----------|
| frontend | `/var/log/nginx/*.log` |
| backend | `/app/logs/*.log` |
| postgres | `/var/lib/postgresql/data/log/*.log` |

```bash
# 实时查看
docker compose -f docker-compose.production.yml logs -f

# 最近 100 行
docker logs --tail 100 mcp_backend
```

### 监控告警

#### Prometheus 告警规则示例

```yaml
# deployment/prometheus-alerts.yml
groups:
  - name: mcp_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "错误率 > 10%"

      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 延迟 > 1s"
```

---

## 升级与回滚

### 升级流程

```bash
# 1. 拉取新镜像
docker compose -f docker-compose.production.yml pull

# 2. 滚动重启 (零停机)
docker compose -f docker-compose.production.yml up -d --no-deps --build frontend
docker compose -f docker-compose.production.yml up -d --no-deps --build backend

# 3. 验证健康
curl http://localhost:8080/healthz
curl http://localhost:8000/health
```

### 回滚到上一版本

```bash
# 查看镜像历史
docker images mcp-frontend

# 回滚到 v0.9.0
docker tag mcp-frontend:0.9.0 mcp-frontend:latest
docker compose -f docker-compose.production.yml up -d frontend

# 或恢复数据库
docker exec -i mcp_postgres psql -U postgres -d claude_code < backup-2026-08-01.sql
```

### 数据库备份

```bash
# 备份
docker exec mcp_postgres pg_dump -U postgres -d claude_code > backup-$(date +%Y%m%d).sql

# 恢复
cat backup-20260801.sql | docker exec -i mcp_postgres psql -U postgres -d claude_code
```

---

## 参考资料

- [Vite 生产构建文档](https://vitejs.dev/guide/build.html)
- [FastAPI 部署指南](https://fastapi.tiangolo.com/deployment/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [火山方舟 API 文档](https://www.volcengine.com/docs/82379)
- [Prometheus 最佳实践](https://prometheus.io/docs/practices/)
- [Grafana 数据源配置](https://grafana.com/docs/grafana/latest/datasources/)

---

**Cycle 50 G50-04 部署文档 v1.0.0 | 2026-08-01**
