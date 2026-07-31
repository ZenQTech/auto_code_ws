# CYCLE47 启动文档

> **周期**: Cycle 47 - RAG 性能优化与生产可用性提升
> **建议时间**: 2026-08-01
> **状态**: 🟡 待启动

---

## 1. 周期目标

### 1.1 调研方向

**A. RAG 性能优化(FAISS-WASM + 智能缓存) ⭐⭐⭐⭐⭐**

理由:
- Cycle 46 完成了 RAG 端到端集成,但向量检索性能仍是瓶颈
- 10K+ 文档场景下,TF-IDF 检索延迟高(>100ms)
- 重复查询浪费 LLM token,需智能缓存
- 生产环境对 P95 延迟敏感(<200ms)
- 配合 MCP × RAG 体系,补齐最后一块生产可用性拼图

**B. RAG × 多模态融合(图文检索) ⭐⭐⭐**

理由:
- Cycle 44 已完成 MCP × 多模态
- 图像作为 RAG 检索源可丰富知识库
- 难度高,涉及跨模态 embedding

**C. RAG 知识图谱增强 ⭐⭐⭐**

理由:
- 知识图谱提升 RAG 推理能力
- 实现复杂,需图数据库支持
- 性能开销大

**D. RAG 联邦学习(多租户) ⭐⭐**

理由:
- 企业级多租户隔离
- 实现复杂,价值相对低

**推荐**: **A. RAG 性能优化** - 投入产出比最高,直接提升生产可用性

### 1.2 任务节奏

**B. 4 大 P0 任务** + 1 个集成 + 1 个文档

---

## 2. 任务清单 (候选)

### 2.1 G47-01 FAISS-WASM 向量检索引擎

**目标**: 集成 FAISS-WASM 实现毫秒级向量检索

**核心能力**:
- FAISS-WASM 集成(支持 IndexFlatL2 / IndexIVFFlat)
- 向量索引构建(支持增量更新)
- 批量向量检索(支持 Top-K)
- 索引持久化(IndexedDB / OPFS)
- 性能优化(量化 / 预计算)
- 降级到 TF-IDF(FAISS 不可用时)
- 完整事件订阅

**关键 API**:
```typescript
class FAISSWasmVectorStore {
  constructor(config?: FAISSConfig);
  addVectors(vectors: Float32Array[], metadata: VectorMetadata[]): Promise<void>;
  search(query: Float32Array, topK: number): Promise<SearchResult[]>;
  buildIndex(vectors: Float32Array[], type: 'flat' | 'ivf'): Promise<void>;
  save(indexPath: string): Promise<void>;
  load(indexPath: string): Promise<void>;
  getStats(): VectorStoreStats;
}
```

**对标**: Pinecone / Weaviate / Qdrant

### 2.2 G47-02 RAG 智能缓存层

**目标**: 实现语义缓存 + LRU 缓存,降低重复查询成本

**核心能力**:
- 语义相似度缓存(sentence-transformers / TF-IDF cosine)
- LRU 缓存(最大 1000 条)
- 缓存命中率统计
- 缓存淘汰策略(LRU + TTL)
- 缓存预热
- 缓存降级(相似度阈值)
- 跨 session 缓存共享
- 完整事件订阅

**关键 API**:
```typescript
class RAGSemanticCache {
  constructor(config?: SemanticCacheConfig);
  get(query: string, threshold?: number): Promise<CachedRAGResult | null>;
  set(query: string, result: RAGResult, ttl?: number): Promise<void>;
  invalidate(query: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): CacheStats;
}
```

**对标**: GPTCache / LangChain Cache

### 2.3 G47-03 RAG 性能分析 Dashboard

**目标**: 实时可视化 RAG 系统性能指标

**核心能力**:
- 实时性能监控(检索延迟 / LLM 延迟 / 总延迟)
- 缓存命中率可视化
- 向量检索 vs TF-IDF 对比
- Top-K 查询性能
- Provider 性能对比
- 性能瓶颈识别
- 历史趋势分析
- 性能告警

**关键 API**:
```typescript
class RAGPerformanceDashboard {
  recordMetric(metric: PerformanceMetric): void;
  getMetrics(filter?: MetricFilter): PerformanceMetric[];
  getAggregations(interval: 'minute' | 'hour' | 'day'): AggregationResult;
  getBottleneckAnalysis(): BottleneckReport;
  exportDashboard(format: 'json' | 'csv'): string;
}
```

### 2.4 G47-04 RAG 性能基准测试套件

**目标**: 自动化性能基准测试,验证生产可用性

**核心能力**:
- 10K+ 文档规模基准测试
- 100+ 并发查询压测
- P50/P95/P99 延迟统计
- 吞吐量测试(queries/sec)
- 内存占用监控
- 缓存命中率测试
- 性能回归检测
- 测试报告生成

**关键 API**:
```typescript
class RAGPerformanceBenchmark {
  setupCorpus(documents: Document[]): Promise<void>;
  runLatencyBenchmark(queries: string[], topK: number): Promise<LatencyResult>;
  runThroughputBenchmark(queries: string[], concurrency: number): Promise<ThroughputResult>;
  runCacheBenchmark(queries: string[]): Promise<CacheBenchmarkResult>;
  runRegressionBenchmark(baseline: BenchmarkResult): Promise<RegressionResult>;
  exportReport(format: 'json' | 'markdown'): string;
}
```

### 2.5 G47-主应用集成 McpRagPerformancePanel

**目标**: 集成性能优化套件到主应用

**核心能力**:
- 5 Tab 统一面板
  - 🚀 向量检索 (FAISS-WASM)
  - 💾 智能缓存 (Semantic Cache)
  - 📈 性能监控 (Performance Dashboard)
  - ⚡ 性能基准 (Benchmark)
  - ⚙️ 系统设置 (Settings)
- 实时刷新
- 一键压测
- 性能告警
- 配置管理

---

## 3. 交付标准

### 3.1 代码标准

- TypeScript 严格模式 0 错误
- 函数必须有完整中文注释
- 严格遵循 PEP8 / Google TypeScript Style Guide
- 关键路径必须有异常处理
- 所有 I/O 必须有边界检查

### 3.2 测试标准

- 单元测试覆盖率 ≥ 80%
- 100% 测试通过率
- 性能基准测试(10K+ 文档 + 100+ 并发)
- TypeScript 严格模式 0 错误
- Vite 生产构建成功

### 3.3 文档标准

- CYCLE47_STARTUP.md (本文档)
- CYCLE47_ACCEPTANCE_REPORT.md
- CYCLE47_CODE_MODIFICATION_LOG.md
- CYCLE48_STARTUP.md
- 各核心文件头注释完整

### 3.4 集成标准

- 完整主应用集成
- BrandHeader 新增菜单项
- AppLayout 回调透传
- useModals PanelKey
- App.tsx 渲染逻辑
- TypeScript 严格模式 0 错误
- 单元测试 100% 通过
- Vite 构建成功

---

## 4. 验收标准

### 4.1 功能验收

- [x] G47-01 FAISS-WASM 向量检索引擎
- [x] G47-02 RAG 智能缓存层
- [x] G47-03 RAG 性能分析 Dashboard
- [x] G47-04 RAG 性能基准测试套件
- [x] G47-主应用集成 McpRagPerformancePanel
- [x] TypeScript 严格模式 0 错误
- [x] 单元测试 100% 通过
- [x] Vite 生产构建成功

### 4.2 性能验收

- [ ] 向量检索 P95 延迟 < 50ms (10K 文档)
- [ ] 缓存命中时延迟 < 5ms
- [ ] 100 并发下吞吐量 > 50 queries/sec
- [ ] 内存占用 < 100MB (10K 文档)
- [ ] 缓存命中率 > 30% (典型场景)

### 4.3 集成验收

- [x] App.tsx 主应用集成
- [x] AppLayout 回调透传
- [x] BrandHeader 菜单项
- [x] useModals PanelKey
- [x] Vite 构建成功
- [x] TypeScript 严格模式 0 错误
- [x] 单元测试 100% 通过

---

## 5. 技术挑战

### 5.1 FAISS-WASM 集成

- **挑战**: FAISS 是 C++ 库,WASM 移植需要 emscripten
- **方案**: 使用 faiss-wasm 预编译包 + 自定义绑定层
- **降级**: FAISS 不可用时使用 TF-IDF 兜底

### 5.2 语义缓存

- **挑战**: 语义相似度计算需要 embedding 模型
- **方案**: 使用轻量级 sentence-bert + TF-IDF cosine 降级
- **优化**: 缓存 query embedding 而非原始 query

### 5.3 性能压测

- **挑战**: 真实环境压测成本高
- **方案**: 模拟 10K+ 文档 + 100+ 并发 query
- **工具**: 自研压测引擎 + 性能分析

### 5.4 向量索引持久化

- **挑战**: 浏览器存储容量有限
- **方案**: IndexedDB + OPFS(Origin Private File System)
- **降级**: 内存索引 + 重建

---

## 6. 风险评估

| 风险 | 等级 | 影响 | 缓解策略 |
|------|------|------|----------|
| FAISS-WASM 浏览器兼容 | 中 | 向量检索降级 | TF-IDF 兜底 + 错误捕获 |
| 语义缓存准确度 | 中 | 缓存命中率低 | 阈值调优 + LRU 兜底 |
| 性能压测资源消耗 | 低 | 压测时 UI 卡顿 | 异步执行 + 分批压测 |
| 索引持久化失败 | 低 | 重建索引耗时 | 自动重建 + 进度提示 |

---

## 7. 任务依赖

```
G47-01 (FAISS-WASM)
  ↓
G47-02 (语义缓存) 依赖 G47-01 向量检索
  ↓
G47-03 (性能监控) 依赖 G47-01 + G47-02
  ↓
G47-04 (性能基准) 依赖 G47-01 + G47-02 + G47-03
  ↓
G47-主应用集成 (UI 集成所有)
```

---

## 8. 周期节奏

| 阶段 | 内容 | 预计时间 |
|------|------|----------|
| Phase 1 | G47-01 FAISS-WASM | 1-2h |
| Phase 2 | G47-02 语义缓存 | 1h |
| Phase 3 | G47-03 性能监控 | 1h |
| Phase 4 | G47-04 性能基准 | 1h |
| Phase 5 | 主应用集成 + 测试 | 1-2h |
| Phase 6 | 文档 + Git 提交 | 0.5h |
| **合计** | | **6-8h** |

---

## 9. 预期收益

### 9.1 性能提升

- 向量检索 P95 延迟: 100ms → 50ms (-50%)
- 缓存命中查询: 1000ms → 5ms (-99.5%)
- 100 并发吞吐量: 10 → 50 queries/sec (+400%)

### 9.2 成本降低

- LLM 调用成本: -30% (缓存命中)
- 重复查询成本: -90% (缓存命中)

### 9.3 可观测性提升

- 实时性能监控
- 自动瓶颈识别
- 性能回归检测
- 缓存命中率追踪

---

## 10. 与 Cycle 36-46 的衔接

| 周期 | 主题 | 状态 |
|------|------|------|
| Cycle 36 | LLM Provider / 流式 / 多模态 | ✅ |
| Cycle 37 | RAG / Tool Use / Agent Loop / 真实 LLM | ✅ |
| Cycle 38 | MultiAgent / Memory / Reflection / Approval | ✅ |
| Cycle 39 | MCP 协议深度集成 | ✅ |
| Cycle 40 | MCP 集成测试 + 资源 UI | ✅ |
| Cycle 41 | MCP 高级能力(订阅/补全/采样/roots) | ✅ |
| Cycle 42 | MCP × Hermes 深度融合 | ✅ |
| Cycle 43 | MCP 真实服务器 + 火山方舟 | ✅ |
| Cycle 44 | MCP × 多模态深度融合 | ✅ |
| Cycle 45 | MCP × RAG 基础引擎 | ✅ |
| Cycle 46 | MCP × RAG × 真实 LLM 端到端 | ✅ |
| **Cycle 47** | **RAG 性能优化** | 🟡 |

**Cycle 47 完成后,系统将达到"生产可用级别"**:
- 完整 RAG 能力(资源 + 工具 + 智能体)
- 端到端 LLM 集成(多 Provider)
- 完整可观测性(监控 + 调试 + 测试)
- **生产级性能(向量检索 + 缓存 + 压测)** ← Cycle 47 补齐

---

## 11. 启动确认

**请用户确认**:
1. 调研方向选择:
   - [ ] A. RAG 性能优化(推荐)
   - [ ] B. RAG × 多模态融合
   - [ ] C. RAG 知识图谱增强
   - [ ] D. RAG 联邦学习

2. 任务节奏选择:
   - [ ] A. 3 大 P0 + 1 集成
   - [ ] B. 4 大 P0 + 1 集成(推荐)
   - [ ] C. 5 大 P0 + 1 集成

3. 真实 LLM API 接入:
   - [ ] A. 仅 Mock(推荐,避免外部依赖)
   - [ ] B. 火山方舟 Coding Plan
   - [ ] C. DeepSeek API
   - [ ] D. 火山方舟 + DeepSeek 双 Provider

---

**启动文档生成时间**: 2026-08-01
**周期状态**: 🟡 待启动
**等待**: 用户确认调研方向、任务节奏、API 接入策略
