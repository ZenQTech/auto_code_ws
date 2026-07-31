# CYCLE 50 代码修改日志

## 📋 修改总览

| 修改类型 | 数量 |
|----------|------|
| 新增文件 | 16 (5 utils + 5 tests + 1 component + 4 deployment + 1 log) |
| 修改文件 | 6 (App, AppLayout, BrandHeader, useModals×2, mcpRagKnowledgeBase.test) |
| 删除文件 | 0 |
| 总代码行数 (新增) | ~5000 行 (含测试与部署) |
| 测试新增 | 119 (119/119 通过) |
| TypeScript 错误 | 0 |
| Vite 构建 | 成功 (24.29s) |

## 🆕 新增文件

### Utility 工具类 (5 个)

#### 1. `frontend/src/utils/rateLimiter.ts` (447 行)
- **类**: `RateLimiter`
- **核心功能**:
  - 4 种限流策略: token-bucket / sliding-window / fixed-window / leaky-bucket
  - 全局配额控制 (月度 token 配额, 30 天周期)
  - 突发容量控制 (burstCapacity)
  - 释放令牌回滚 (release)
  - 事件订阅 (acquire / reject / release / reset / quota-exceeded)
- **类型**:
  - `RateLimitStrategy` (策略枚举)
  - `RateLimitConfig` (配置)
  - `RateLimitResult` (结果)
  - `RateLimitEvent` (事件)
  - `RateLimitListener` (监听器)
  - `RateLimitStats` (v1.0.0 新增 - 统计类型)
- **API**:
  - `acquire(tokens)`: 申请令牌
  - `release(tokens)`: 释放令牌
  - `reset()`: 重置所有计数器
  - `subscribe(listener)`: 订阅事件
  - `getStats()`: 获取统计
- **工厂**:
  - `createVolcengineRateLimiter()`: 60 RPS / 突发 100 / 每月 1M
  - `createOpenAIRateLimiter()`: 60 RPM / 每月 1M
- **修改记录**:
  - v1.0.0 | 2026-08-01 | Cycle 50 G50-01 初次创建

#### 2. `frontend/src/utils/apiKeyManager.ts` (748 行)
- **类**: `ApiKeyManager`
- **核心功能**:
  - Web Crypto API AES-GCM 加密 (PBKDF2 主密钥派生)
  - 加密存储到 localStorage (含过期时间)
  - 密钥轮换 (rotateApiKey)
  - 过期自动清理
  - 审计日志 (create / get / rotate / delete / expire / error)
  - 单例模式 (getApiKeyManager)
- **类型**:
  - `ApiKeyProvider` (volcengine / openai / anthropic / cohere / huggingface / custom)
  - `ApiKeyEntry` (加密条目)
  - `ApiKeyManagerConfig` (配置)
  - `ApiKeyAuditEvent` (审计事件)
  - `ApiKeyAuditListener` (监听器)
- **API**:
  - `setApiKey(provider, key, options)`: 加密存储
  - `getApiKey(provider)`: 解密取出
  - `hasApiKey(provider)`: 检查存在
  - `rotateApiKey(provider, newKey)`: 轮换
  - `deleteApiKey(provider)`: 删除
  - `listProviders()`: 列出所有
  - `getStats()`: 统计
  - `subscribe(listener)`: 订阅审计事件
- **工厂**: `createApiKeyManager(config?)`, `getApiKeyManager()` (singleton)
- **修改记录**:
  - v1.0.0 | 2026-08-01 | Cycle 50 G50-01 初次创建
  - v1.0.1 | 2026-08-01 | 改用 Web Crypto API 替换 Node.js crypto

#### 3. `frontend/src/utils/realVolcengineClient.ts` (505 行)
- **类**: `RealVolcengineClient`
- **核心功能**:
  - 真实火山方舟 API 调用: `https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal`
  - 默认模型: `doubao-embedding-vision`
  - 集成 ApiKeyManager (加密 Key 管理)
  - 集成 RateLimiter (限流保护)
  - 透明降级: fallbackProvider (默认 Mock CLIP)
  - 自动重试: 指数退避 (maxRetries + retryBackoffMs)
  - 成本统计: inputCostPerMTokens + imageCostPerK
  - 事件订阅: request / success / error / rate-limit / fallback / retry
- **类型**:
  - `MultimodalInput` (输入)
  - `RealVolcengineConfig` (配置)
  - `RealVolcengineResponse` (响应)
  - `RealVolcengineStats` (统计)
  - `RealVolcengineEvent` (事件)
  - `RealVolcengineListener` (监听器)
- **API**:
  - `embed(input)`: 单条
  - `embedBatch(inputs)`: 批量
  - `setApiKey(apiKey, options)`: 异步设置 API Key
  - `setFallbackProvider(provider)`: 设置降级
  - `subscribe(listener)`: 订阅事件
  - `getStats()`: 统计
- **工厂**: `createRealVolcengineClient(config?)`
- **修改记录**:
  - v1.0.0 | 2026-08-01 | Cycle 50 G50-01 初次创建
  - v1.0.1 | 2026-08-01 | setApiKey 改为异步,修复 await

#### 4. `frontend/src/utils/multimodalRAGE2ETestSuite.ts` (571 行)
- **类**: `MultimodalRAGE2ETestSuite`
- **核心功能**:
  - 集成 MultimodalEmbedding + MultimodalVectorIndex + MultimodalSemanticCache
  - 4 大 E2E 场景: 电商商品检索 / 知识库问答 / 混合检索 / 缓存压力
  - 指标: Recall@K / Precision@K / P50 / P95 / 缓存命中率
  - 场景配置: documents + queries + expectations
  - 报告生成: Markdown / JSON / HTML
- **类型**:
  - `E2EScenario` (场景配置)
  - `E2EScenarioResult` (场景结果)
  - `E2ETestSuiteReport` (套件报告)
  - `E2ETestEvent` (事件)
  - `E2EListener` (监听器)
- **API**:
  - `addScenario(scenario)`: 添加场景
  - `runScenario(scenario)`: 运行单个场景
  - `runAll()`: 运行所有场景
  - `subscribe(listener)`: 订阅事件
  - `getStats()`: 统计
- **工厂**: `createE2ETestSuite(config?)`, `getE2ETestSuite()` (singleton)
- **修改记录**:
  - v1.0.0 | 2026-08-01 | Cycle 50 G50-02 初次创建
  - v1.0.1 | 2026-08-01 | 修复 CrossModalSearchOptions 和 MultimodalCacheHit 类型

#### 5. `frontend/src/utils/metricsRegistry.ts` (487 行)
- **类**: `MetricsRegistry`
- **核心功能**:
  - 4 种指标类型: Counter / Gauge / Histogram / Summary
  - 标签支持 (labels)
  - Prometheus 文本导出: `exportPrometheus()`
  - JSON 导出: `exportJson()`
  - 事件订阅: observe / create / reset
  - 重置全部指标: `reset()`
- **类型**:
  - `MetricType` (counter / gauge / histogram / summary)
  - `MetricLabels` (标签)
  - `Counter` / `Gauge` / `Histogram` / `Summary` (指标)
  - `MetricsRegistryConfig` (配置)
  - `MetricsEvent` (事件)
  - `MetricsListener` (监听器)
- **API**:
  - `createCounter(name, help, options)`: 创建 Counter
  - `createGauge(name, help, options)`: 创建 Gauge
  - `createHistogram(name, help, options)`: 创建 Histogram
  - `createSummary(name, help, options)`: 创建 Summary
  - `inc(name, labels, value)`: 增加
  - `set(name, value, labels)`: 设置
  - `observe(name, value, labels)`: 观察
  - `observeSummary(name, value, labels, maxSamples)`: Summary 观察
  - `exportPrometheus()`: Prometheus 格式
  - `exportJson()`: JSON 格式
  - `reset()`: 重置全部
  - `subscribe(listener)`: 订阅事件
  - `getStats()`: 统计
- **工厂**: `createMetricsRegistry(config?)`, `getMetricsRegistry()` (singleton)
- **修改记录**:
  - v1.0.0 | 2026-08-01 | Cycle 50 G50-03 初次创建
  - v1.0.1 | 2026-08-01 | reset() 添加 Counter 清空

### Test 测试文件 (5 个)

| 文件 | 测试数 | 行数 |
|------|--------|------|
| `apiKeyManager.test.ts` | 23 | ~300 |
| `metricsRegistry.test.ts` | 25 | ~280 |
| `multimodalRAGE2ETestSuite.test.ts` | 26 | ~300 |
| `rateLimiter.test.ts` | 23 | ~300 |
| `realVolcengineClient.test.ts` | 22 | ~300 |
| **合计** | **119** | **~1480** |

### Component 组件 (1 个)

#### `frontend/src/components/McpE2EProductionPanel.tsx` (932 行)
- **组件**: `McpE2EProductionPanel`
- **核心功能**:
  - 6 个 Tab: 真实火山方舟 / E2E 端到端 / 监控指标 / API Key / 限流配额 / 部署文档
  - 集成: RealVolcengineClient + ApiKeyManager + RateLimiter + MetricsRegistry + MultimodalRAGE2ETestSuite
  - 实时事件流 (volcengine / e2e / metrics / key / rate-limit)
  - 统计实时刷新
  - 重置状态 / 关闭
- **Props**: `{ onClose: () => void }`
- **修改记录**:
  - v1.0.0 | 2026-08-01 | Cycle 50 G50-INTEGRATION 初次创建
  - v1.0.1 | 2026-08-01 | 修复 RateLimitStats 导入 + exportJson JSON 序列化

### Deployment 部署文件 (4 个)

#### 1. `frontend/Dockerfile`
- **多阶段构建**:
  - Stage 1 (builder): `node:24.15.0-alpine` + `npm ci` + Vite build
  - Stage 2 (runner): `nginx:1.27-alpine` + 静态资源 + 健康检查
- **构建参数**: `VITE_API_BASE_URL` / `VITE_VOLCENGINE_BASE_URL` / `VITE_VOLCENGINE_MODEL` / `VITE_ENABLE_METRICS` / `VITE_ENABLE_E2E_TESTS`
- **健康检查**: `curl /healthz` 30s 间隔

#### 2. `deployment/nginx.conf`
- **安全头**: X-Frame-Options / X-Content-Type-Options / X-XSS-Protection / HSTS / CSP
- **Gzip 压缩**: text/plain / text/css / text/xml / text/javascript / application/json 等
- **静态缓存**: `expires 1y` + `Cache-Control immutable`
- **SPA fallback**: `try_files $uri $uri/ /index.html`
- **API 反向代理**: `/api/` → `backend:8000`
- **健康检查**: `/healthz` (无 access_log)

#### 3. `docker-compose.production.yml`
- **服务**:
  - `frontend`: Nginx + 静态 (端口 8080)
  - `backend`: FastAPI + Python 3.10
  - `postgres`: postgres:15-alpine
  - `prometheus` (profile: monitoring): prom/prometheus:v2.50.0
  - `grafana` (profile: monitoring): grafana/grafana:10.4.0
- **网络**: `mcp_net` bridge
- **卷**: postgres_data / prometheus_data / grafana_data

#### 4. `DEPLOYMENT.md` + `SECURITY.md`
- 完整部署指南 (环境要求/构建/启动/监控/故障排查)
- 安全加固清单 (API Key 加密/限流保护/HTTPS/CSP/审计)

## ✏️ 修改文件 (6)

### 1. `frontend/src/hooks/useModals.ts`
- **修改内容**:
  - `UseModalsResult` interface 添加 `mcpE2EProduction: PanelController` 字段 (v3.11.0)
- **行数变化**: +1
- **Commit**: feat(cycle50)

### 2. `frontend/src/hooks/useModals.test.ts`
- **修改内容**:
  - 测试面板数量 33 → 34
  - 注释更新: v3.11.0 (Cycle 50) 新增 mcpE2EProduction
- **行数变化**: +2
- **Commit**: test(cycle50)

### 3. `frontend/src/App.tsx`
- **修改内容**:
  - 导入 `McpE2EProductionPanel` (v6.124.0 Cycle 50)
  - 解构 `mcpE2EProductionModal`
  - 添加 `onOpenMcpE2EProduction` 回调
  - 渲染 `<McpE2EProductionPanel>` 条件块
- **行数变化**: +5
- **Commit**: feat(cycle50)

### 4. `frontend/src/components/AppLayout.tsx`
- **修改内容**:
  - `AppLayoutProps` interface 添加 `onOpenMcpE2EProduction: () => void` (v6.124.0)
  - 解构 `onOpenMcpE2EProduction`
  - 透传到 `BrandHeader`
- **行数变化**: +3
- **Commit**: feat(cycle50)

### 5. `frontend/src/components/BrandHeader.tsx`
- **修改内容**:
  - `BrandHeaderProps` interface 添加 `onOpenMcpE2EProduction?: () => void`
  - 解构 `onOpenMcpE2EProduction`
  - 添加菜单项: "🚀 MCP × 真实 E2E 生产"
- **行数变化**: +30
- **Commit**: feat(cycle50)

### 6. `frontend/src/utils/mcpRagKnowledgeBase.test.ts` (修复)
- **问题**: 时间漂移 flaky - `Date.now()` 在 beforeEach 与 test 体不同,导致 `b.txt` 错误分类为 `updated` 而非 `unchanged`
- **修复**:
  - 共享 `beforeEachT` 变量
  - 三个测试用例 (新增/已修改/已删除) 全部使用 `beforeEachT` 作为基准时间戳
- **行数变化**: +5 (注释增强)
- **Commit**: fix(cycle50)

## 🔄 关键修复点

### 修复 #1: mcpRagKnowledgeBase 时间漂移
- **根因**: `beforeEach` 中 `const t = Date.now()` 是局部变量,test 体中重新 `const t = Date.now()` 是新时间,导致 `existing.modifiedAt < f.modifiedAt` 误判
- **修复**: 提升 `t` 到 describe 作用域,命名为 `beforeEachT`,在 beforeEach 中赋值,在 test 中复用
- **影响**: 修复 1 个 flaky test,从 CI 100% 失败到 100% 通过

### 修复 #2: TypeScript 接口补全
- **问题**:
  - `useModals.ts`: `UseModalsResult` 缺少 `mcpE2EProduction` 字段
  - `AppLayout.tsx`: `AppLayoutProps` 缺少 `onOpenMcpE2EProduction`
- **修复**: 同步添加 v3.11.0 / v6.124.0 字段

### 修复 #3: RateLimitStats 类型显式化
- **问题**: `McpE2EProductionPanel.tsx` 引用 `RateLimitStats` 但 `rateLimiter.ts` 未导出
- **修复**: 在 `rateLimiter.ts` 中新增 `RateLimitStats` interface

### 修复 #4: Web Crypto API 替代 Node.js crypto
- **问题**: `apiKeyManager.ts` 使用 Node.js `crypto` 模块,浏览器环境不可用
- **修复**: 改用 Web Crypto API (AES-GCM + PBKDF2),纯浏览器环境

### 修复 #5: setApiKey 异步化
- **问题**: `realVolcengineClient.ts` 中 `setApiKey` 未 `await` 导致 API Key 设置不生效
- **修复**: 改为 `async setApiKey()`,调用方必须 `await`

### 修复 #6: MultimodalRAG E2E 类型修正
- **问题**:
  - `CrossModalSearchOptions` 应使用 `topK` 而非 `k`
  - `MultimodalCacheHit` 应使用 `entry.value` 而非 `result`
- **修复**: 调整调用方参数与字段

### 修复 #7: MetricsRegistry.reset() 完整
- **问题**: `reset()` 未清空 Counter 值
- **修复**: 添加 `m.values.clear()` 清空 Counter

### 修复 #8: McpE2EProductionPanel 导入与导出
- **问题**:
  - `App.tsx` 缺少 `McpE2EProductionPanel` 导入
  - `McpE2EProductionPanel.tsx` 缺少 `RateLimitStats` 导入
  - `exportJson()` 返回 `Record<string, unknown>` 不能直接给 `setState<string>`
- **修复**:
  - 添加 `import McpE2EProductionPanel` (default)
  - 添加 `import type { RateLimitStats }`
  - 用 `JSON.stringify(metrics.exportJson(), null, 2)` 序列化为字符串

## 📊 验收结果

| 项目 | 结果 |
|------|------|
| TypeScript 类型检查 | ✅ 0 错误 |
| 单元测试 | ✅ 7000 / 7000 通过 (241 个文件) |
| Vite 生产构建 | ✅ 成功 (24.29s) |
| 新增测试 | +119 |
| 修复测试 | 1 (mcpRagKnowledgeBase 时间漂移) |
| 修改文件 | 6 (含 1 修复) |
| 新增文件 | 16 (含 1 文档) |

## 🔄 后续 Cycle 51 候选

- **A. 真实生产部署验证** (5⭐)
- **B. 多模态 A/B 测试框架** (4⭐)
- **C. 分布式 RAG 联邦** (4⭐)
- **D. 移动端/桌面端 PWA** (3⭐)
- **E. i18n 国际化** (3⭐)
