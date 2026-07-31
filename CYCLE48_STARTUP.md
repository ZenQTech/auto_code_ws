# CYCLE48 启动文档

> **周期**: Cycle 48 - 待用户确认调研方向
> **建议时间**: 2026-08-01
> **状态**: 🟡 等待用户确认

---

## 1. 周期目标

### 1.1 上周期回顾 (Cycle 47)

✅ **Cycle 47 RAG 性能优化** 已完成:
- 4 大核心引擎 (FAISS-WASM, RAG Semantic Cache, Performance Dashboard, Benchmark Suite)
- 1 个主应用集成面板 (McpRagPerformancePanel 5-Tab)
- 189 个新单元测试 100% 通过
- TypeScript 0 错误
- Vite 生产构建成功

**系统已达到 RAG 生产可用级别**:
- P95 检索延迟 < 50ms (FAISS 加速)
- 缓存命中延迟 < 5ms
- 完整可观测性 (监控 + 调试 + 测试)
- 性能回归检测

### 1.2 调研方向候选

#### A. RAG × 多模态性能优化 ⭐⭐⭐⭐⭐

**理由**:
- Cycle 44 已完成 MCP × 多模态 (图像/音频/视频)
- 但多模态的 RAG 检索性能未优化
- 跨模态 embedding 对齐是新的瓶颈
- 图文混合检索的索引优化空间大
- 直接提升 Hermes 平台的 RAG 多模态能力

**核心任务**:
- G48-01: 多模态 Embedding 对齐 (CLIP / BGE-M3)
- G48-02: 图文混合向量索引
- G48-03: 跨模态语义缓存
- G48-04: 多模态 RAG 性能基准

**对标**: GPT-4V, Claude 3.5 Sonnet, Gemini 1.5

#### B. 真实 FAISS-WASM 集成 ⭐⭐⭐⭐

**理由**:
- 当前为纯 TypeScript 模拟,性能受限
- 真实 FAISS-WASM 可获得 10x+ 性能提升
- 但需处理浏览器兼容性和加载策略
- 工作量大但价值明确

**核心任务**:
- G48-01: FAISS-WASM npm 包集成
- G48-02: WASM 模块动态加载
- G48-03: 索引序列化到 OPFS / IndexedDB
- G48-04: 降级到纯 TS (WASM 加载失败时)

**对标**: Pinecone / Weaviate / Qdrant

#### C. RAG 智能分片与压缩 ⭐⭐⭐

**理由**:
- 大文档的智能分片仍需优化
- Embedding 压缩 (Float32 → Int8) 减少 75% 内存
- 量化检索可大幅降低成本
- 与 FAISS 配合效果最佳

**核心任务**:
- G48-01: 语义感知分片器
- G48-02: Embedding 标量量化 (Int8)
- G48-03: 乘积量化 (PQ)
- G48-04: 压缩索引基准测试

**对标**: Faiss PQ, ScaNN, Annoy

#### D. 分布式 RAG 协同 ⭐⭐

**理由**:
- 企业级多租户隔离
- 跨节点联邦查询
- 价值高但复杂度极高
- 可能需要单独的支撑系统

**核心任务**:
- G48-01: 多节点注册中心
- G48-02: 分片策略 (hash/range)
- G48-03: 联邦查询合并
- G48-04: 跨节点缓存一致性

**对标**: Elasticsearch, SolrCloud

#### E. RAG 评估与 A/B 测试 ⭐⭐⭐⭐

**理由**:
- 现有 RAG 缺乏系统化评估
- A/B 测试框架可对比不同策略
- 用户反馈闭环
- 数据驱动的优化

**核心任务**:
- G48-01: RAG 评估指标体系 (RAGAS / TruLens)
- G48-02: A/B 测试框架
- G48-03: 用户反馈采集
- G48-04: 评估报告 Dashboard

**对标**: LangSmith, Helicone

---

## 2. 推荐方向

### 2.1 综合评估

| 方向 | 业务价值 | 技术深度 | 实施难度 | ROI |
|------|----------|----------|----------|-----|
| A. 多模态 RAG 性能优化 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 高 |
| B. 真实 FAISS-WASM | ⭐⭐⭐⭐ | ⭐⭐⭐ | 中 | 高 |
| C. 分片与压缩 | ⭐⭐⭐ | ⭐⭐⭐ | 中 | 中 |
| D. 分布式 RAG | ⭐⭐ | ⭐⭐⭐⭐⭐ | 高 | 低 |
| E. 评估与 A/B | ⭐⭐⭐⭐ | ⭐⭐⭐ | 低 | 中 |

### 2.2 推荐

**推荐: A. RAG × 多模态性能优化** ⭐⭐⭐⭐⭐

理由:
- 与 Cycle 44 多模态工作紧密衔接
- 直接补齐 RAG 性能优化的多模态维度
- 让 RAG 支持图像/视频内容检索
- 业务价值最高,投入产出比最大
- 可与现有真实 LLM API 集成 (火山方舟/DeepSeek)

---

## 3. 任务清单 (以 A 方向为例)

### 3.1 G48-01 多模态 Embedding 对齐

**目标**: 实现文本-图像跨模态 Embedding 对齐

**核心能力**:
- CLIP 风格多模态 Embedding
- 文本/图像共享向量空间
- 跨模态检索 (文 → 图, 图 → 文)
- 支持 BGE-M3 / 火山方舟多模态

**关键 API**:
```typescript
class MultimodalEmbedding {
  embedText(text: string): Promise<number[]>;
  embedImage(imageUrl: string | Blob): Promise<number[]>;
  embedMultimodal(text: string, imageUrl: string): Promise<number[]>;
  similarity(a: number[], b: number[]): number;
}
```

### 3.2 G48-02 图文混合向量索引

**目标**: 扩展 FAISS-WASM 支持图文混合检索

**核心能力**:
- 统一向量空间索引
- 跨模态 Top-K 检索
- 模态过滤 (仅文本 / 仅图像)
- 跨模态重排序

**关键 API**:
```typescript
class MultimodalVectorIndex {
  addText(id: string, text: string, metadata?: Record<string, unknown>): Promise<void>;
  addImage(id: string, imageUrl: string, metadata?: Record<string, unknown>): Promise<void>;
  searchByText(query: string, topK: number, options?: { imageOnly?: boolean }): Promise<SearchResult[]>;
  searchByImage(imageUrl: string, topK: number): Promise<SearchResult[]>;
}
```

### 3.3 G48-03 跨模态语义缓存

**目标**: 扩展 RAG 语义缓存支持多模态

**核心能力**:
- 文本 query → 文本/图像结果缓存
- 图像 query → 文本/图像结果缓存
- 跨模态相似度计算
- 多模态缓存预热

### 3.4 G48-04 多模态 RAG 性能基准

**目标**: 跨模态 RAG 系统的性能基准

**核心能力**:
- 图文混合语料生成
- 跨模态检索压测
- 多模态缓存命中率
- 性能可视化 Dashboard

### 3.5 G48-主应用集成 McpMultimodalRagPanel

**目标**: 多模态 RAG 统一面板

**核心能力**:
- 5 Tab: 文本检索 / 图像检索 / 跨模态 / 性能监控 / 基准
- 真实 LLM API 集成 (可选)
- 性能可视化

---

## 4. 交付标准

### 4.1 代码标准

- TypeScript 严格模式 0 错误
- 函数必须有完整中文注释
- 严格遵循 PEP8 / Google TypeScript Style Guide
- 关键路径必须有异常处理

### 4.2 测试标准

- 单元测试覆盖率 ≥ 80%
- 100% 测试通过率
- 性能基准测试 (跨模态)
- TypeScript 严格模式 0 错误
- Vite 生产构建成功

### 4.3 文档标准

- CYCLE48_STARTUP.md (本文档)
- CYCLE48_ACCEPTANCE_REPORT.md
- CYCLE48_CODE_MODIFICATION_LOG.md
- CYCLE49_STARTUP.md
- 各核心文件头注释完整

### 4.4 集成标准

- 完整主应用集成
- BrandHeader 新增菜单项
- AppLayout 回调透传
- useModals PanelKey
- App.tsx 渲染逻辑

---

## 5. 验收标准

### 5.1 功能验收

- [ ] G48-01 多模态 Embedding 对齐
- [ ] G48-02 图文混合向量索引
- [ ] G48-03 跨模态语义缓存
- [ ] G48-04 多模态 RAG 性能基准
- [ ] G48-主应用集成 McpMultimodalRagPanel
- [ ] TypeScript 严格模式 0 错误
- [ ] 单元测试 100% 通过
- [ ] Vite 生产构建成功

### 5.2 性能验收

- [ ] 跨模态检索 P95 延迟 < 100ms
- [ ] 多模态缓存命中率 > 25%
- [ ] 100 并发下吞吐量 > 30 queries/sec
- [ ] 图文混合检索精度 (Recall@10) > 0.85

### 5.3 集成验收

- [ ] App.tsx 主应用集成
- [ ] AppLayout 回调透传
- [ ] BrandHeader 菜单项
- [ ] useModals PanelKey
- [ ] Vite 构建成功
- [ ] TypeScript 严格模式 0 错误
- [ ] 单元测试 100% 通过

---

## 6. 风险评估

| 风险 | 等级 | 影响 | 缓解策略 |
|------|------|------|----------|
| 多模态 Embedding 模型加载 | 中 | 性能/兼容性 | 降级到 TF-IDF + Mock 图像特征 |
| 跨模态对齐精度 | 中 | 检索质量 | 调优 CLIP / BGE-M3 超参数 |
| 真实 API 依赖 | 中 | 外部依赖 | Mock provider 兜底 |
| 大规模图文索引 | 中 | 内存占用 | 量化压缩 + 分片 |
| WASM 兼容性 | 低 | 浏览器支持 | 纯 TS 降级 |

---

## 7. 任务依赖

```
G48-01 (多模态 Embedding)
  ↓
G48-02 (图文混合索引) 依赖 G48-01
  ↓
G48-03 (跨模态缓存) 依赖 G48-01 + G48-02
  ↓
G48-04 (多模态基准) 依赖 G48-01 + G48-02 + G48-03
  ↓
G48-主应用集成 (UI 集成所有)
```

---

## 8. 周期节奏

| 阶段 | 内容 | 预计时间 |
|------|------|----------|
| Phase 1 | G48-01 多模态 Embedding | 1.5-2h |
| Phase 2 | G48-02 图文混合索引 | 1.5h |
| Phase 3 | G48-03 跨模态缓存 | 1h |
| Phase 4 | G48-04 多模态基准 | 1h |
| Phase 5 | 主应用集成 + 测试 | 1-2h |
| Phase 6 | 文档 + Git 提交 | 0.5h |
| **合计** | | **6.5-8h** |

---

## 9. 预期收益

### 9.1 能力提升

- ✅ 支持图像 RAG 检索 (以文搜图, 以图搜文)
- ✅ 多模态混合知识库
- ✅ 跨模态语义理解
- ✅ 完整多模态可观测性

### 9.2 业务价值

- 知识库从纯文本扩展到图文
- 用户可上传图片检索相关文档
- 文档中的图片可被检索和引用
- 视频内容可提取关键帧检索

### 9.3 与现有体系融合

- 与 Cycle 44 MCP × 多模态 协同
- 与 Cycle 45-47 RAG 性能优化集成
- 与 Cycle 46 真实 LLM 端到端集成

---

## 10. 与 Cycle 36-47 的衔接

| 周期 | 主题 | 状态 |
|------|------|------|
| Cycle 36 | LLM Provider / 流式 / 多模态 | ✅ |
| Cycle 37 | RAG / Tool Use / Agent Loop / 真实 LLM | ✅ |
| Cycle 38 | MultiAgent / Memory / Reflection / Approval | ✅ |
| Cycle 39-43 | MCP 协议深度集成 + 真实服务器 | ✅ |
| Cycle 44 | MCP × 多模态深度融合 | ✅ |
| Cycle 45 | MCP × RAG 基础引擎 | ✅ |
| Cycle 46 | MCP × RAG × 真实 LLM 端到端 | ✅ |
| Cycle 47 | RAG 性能优化 (FAISS + 缓存 + 监控 + 基准) | ✅ |
| **Cycle 48** | **多模态 RAG 性能优化 (推荐)** | 🟡 |

**Cycle 48 完成后,系统将达到多模态 RAG 生产可用级别**:
- 文本 + 图像 + 视频统一检索
- 跨模态语义对齐
- 端到端多模态 LLM 集成
- 完整性能监控

---

## 11. 启动确认

**请用户确认**:

1. 调研方向选择:
   - [ ] A. 多模态 RAG 性能优化 (推荐)
   - [ ] B. 真实 FAISS-WASM 集成
   - [ ] C. RAG 智能分片与压缩
   - [ ] D. 分布式 RAG 协同
   - [ ] E. RAG 评估与 A/B 测试

2. 任务节奏选择:
   - [ ] A. 3 大 P0 + 1 集成
   - [ ] B. 4 大 P0 + 1 集成 (推荐)
   - [ ] C. 5 大 P0 + 1 集成

3. 真实 LLM API 接入:
   - [ ] A. 仅 Mock (推荐,避免外部依赖)
   - [ ] B. 火山方舟 Coding Plan
   - [ ] C. DeepSeek API
   - [ ] D. 火山方舟 + DeepSeek 双 Provider

4. 真实多模态 API 接入 (如选 A 方向):
   - [ ] A. 仅 Mock Embedding (推荐)
   - [ ] B. 火山方舟多模态 Embedding
   - [ ] C. CLIP 本地模型

---

**启动文档生成时间**: 2026-08-01
**周期状态**: 🟡 等待用户确认
**等待**: 用户确认调研方向、任务节奏、API 接入策略
