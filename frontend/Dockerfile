# ============================================================
# MCP × Multimodal RAG 前端 Docker 镜像 (Cycle 50 G50-04)
# ============================================================
# 核心作用：构建可运行的 React + Vite 前端生产镜像
# 运行流程：
#   1. 多阶段构建: Node 24 构建 → Nginx 1.27 托管静态资源
#   2. 通过 Vite 构建生产 bundle (含 multimodal RAG + volcengine 接入)
#   3. Nginx 配置: SPA 路由 + Gzip + 静态资源缓存 + 安全头
#   4. 健康检查: 探测 /healthz 端点
# 输入参数：
#   - 构建时: 可选 VITE_API_BASE_URL / VITE_VOLCENGINE_BASE_URL 等
#   - 运行时: 监听 8080 端口
# 输出结果：可访问的 SPA 静态站点
# 修改记录：
#   - 2026-08-01 | v1.0.0 | Cycle 50 G50-04 初次创建
# ============================================================

# ============================================================
# 阶段 1: 构建 (Node 24 + Vite)
# ============================================================
FROM node:24.15.0-alpine AS builder
LABEL stage=builder

WORKDIR /app

# 1. 优先安装依赖 (利用 Docker layer cache)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund --prefer-offline

# 2. 拷贝前端源码并构建
COPY frontend/ ./
COPY shared/ /tmp/shared/

# 构建参数 (可在 docker build --build-arg 注入)
ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARG VITE_VOLCENGINE_MODEL=doubao-embedding-vision
ARG VITE_ENABLE_METRICS=true
ARG VITE_ENABLE_E2E_TESTS=false
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_VOLCENGINE_BASE_URL=${VITE_VOLCENGINE_BASE_URL} \
    VITE_VOLCENGINE_MODEL=${VITE_VOLCENGINE_MODEL} \
    VITE_ENABLE_METRICS=${VITE_ENABLE_METRICS} \
    VITE_ENABLE_E2E_TESTS=${VITE_ENABLE_E2E_TESTS}

RUN npm run build

# ============================================================
# 阶段 2: 运行 (Nginx 1.27 Alpine)
# ============================================================
FROM nginx:1.27-alpine AS runner
LABEL maintainer="MCP × Multimodal RAG Team"
LABEL version="1.0.0"
LABEL description="Production frontend for MCP × Multimodal RAG Platform"

# 安装 curl 用于健康检查
RUN apk add --no-cache curl

# 1. 拷贝构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 2. 拷贝 Nginx 配置 (SPA 路由 + 安全头 + 缓存策略)
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf

# 3. 暴露端口
EXPOSE 8080

# 4. 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8080/healthz || exit 1

# 5. 启动 Nginx (前台)
CMD ["nginx", "-g", "daemon off;"]
