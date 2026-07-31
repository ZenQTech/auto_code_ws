# CYCLE49 启动文档

> **周期**: Cycle 49 - 待用户确认调研方向
> **建议时间**: 2026-08-01
> **状态**: 🟡 等待用户确认

---

## 1. 周期目标

### 1.1 上周期回顾 (Cycle 48)

✅ **Cycle 48 RAG × 多模态性能优化** 已完成:
- 4 大核心引擎 (MultimodalEmbedding, MultimodalVectorIndex, MultimodalSemanticCache, MultimodalRAGBenchmark)
- 1 个主应用集成面板 (McpMultimodalRagPanel 5-Tab)
- 206 个新单元测试 100% 通过
- TypeScript 0 错误
- Vite 生产构建成功 (23.92s)

**系统已达到多模态 RAG 生产可用级别**:
- 文本 + 图像 + 多模态 统一检索
- 跨模态语义对齐（CLIP 风格）
- 三级跨模态缓存（精确/同模态/跨模态）
- 完整多模态性能基准

### 1.2 累计成就（Cycle 36-48）

| 周期 | 主题 | 核心交付 |
|------|------|---------|
| 36 | LLM Provider / 流式 / 多模态基础 | 3 核心引擎 + 3 面板 |
| 37 | RAG / Tool Use / Agent Loop / 真实 LLM | 4 核心引擎 + 4 面板 |
| 38 | MultiAgent / Memory / Reflection / Approval | 4 核心引擎 + 4 面板 |
| 39 | MCP 协议深度集成 | MCP 客户端 + 注册表 + 面板 |
| 40 | MCP 集成测试 + 性能 | 19 集成测试 + 17 性能基准 |
| 41 | MCP 高级能力（subscribe/completion/sampling/roots） | 4 高级能力 + 面板 |
| 42 | MCP × Hermes 深度融合 | 4 核心引擎 + 集成面板 |
| 43 | MCP 真实服务器（filesystem/git/fetch/E2E） | 3 真实 MCP 服务器 + 测试套件 |
| 44 | MCP × 多模态深度融合 | 4 多模态引擎 + 智能体面板 |
| 45 | MCP × RAG 基础引擎 | RAG 基础引擎 + 智能体面板 |
| 46 | MCP × RAG × 真实 LLM 端到端 | 4 端到端引擎 + 真实 LLM 集成 |
| 47 | RAG 性能优化 | FAISS + 缓存 + 监控 + 基准 |
| **48** | **RAG × 多模态性能优化** | **4 多模态引擎 + 5-Tab 面板** |
| **49** | **🔍 待用户确认** | **🟡 启动中** |

---

## 2. 调研方向候选

### 2.1 A. 真实 CLIP 多模态模型集成 ⭐⭐⭐⭐⭐

**理由**:
- Cycle 48 已完成多模态 RAG 引擎，但用 Mock provider
- 真实 CLIP 模型可显著提升跨模态检索质量（Recall@10 > 0.9）
- 火山方舟 / DeepSeek 已支持多模态 Embedding
- 直接补齐多模态 RAG 的关键短板

**核心任务**:
- G49-01: 真实 CLIP Embedding 引擎（via Transformers.js）
- G49-02: 火山方舟多模态 API 集成（DeepSeek / 字节）
- G49-03: 多模态向量质量评估（A/B 测试框架）
- G49-04: 模型缓存与懒加载优化

**对标**: OpenAI CLIP, BGE-M3, Jina CLIP

### 2.2 B. 端到端多模态智能体 ⭐⭐⭐⭐

**理由**:
- Cycle 44 已完成 MCP × 多模态
- 但缺少端到端的多模态智能体（感知→推理→行动）
- 与 AgentLoop 集成可形成完整闭环
- 火山方舟 Doubao-1.5-Vision 已支持多模态推理

**核心任务**:
- G49-01: 多模态智能体主循环
- G49-02: 图像理解 + 工具调用集成
- G49-03: 视频帧提取 + 时间线分析
- G49-04: 多模态任务评估框架

**对标**: GPT-4V Agent, Claude 3.5 Sonnet Vision

### 2.3 C. 多模态 RAG 评估框架 ⭐⭐⭐⭐

**理由**:
- 多模态 RAG 缺乏系统化评估
- 集成 RAGAS / TruLens 多模态指标
- A/B 测试框架可对比不同策略
- 用户反馈闭环

**核心任务**:
- G49-01: RAGAS 多模态评估指标
- G49-02: A/B 测试框架
- G49-03: 用户反馈采集
- G49-04: 评估报告 Dashboard

**对标**: LangSmith, Helicone, RAGAS

### 2.4 D. MCP 真实服务器扩展 ⭐⭐⭐

**理由**:
- Cycle 43 已集成 3 个 MCP 真实服务器
- 可继续扩展（如 Playwright, Postgres, Notion, GitHub）
- 提升 Hermes 的工具生态
- 与 MCP Marketplace 集成

**核心任务**:
- G49-01: Playwright MCP 集成（浏览器自动化）
- G49-02: Postgres MCP 集成（数据库访问）
- G49-03: GitHub MCP 集成（代码协作）
- G49-04: MCP 工具链编排

**对标**: Model Context Protocol 生态

### 2.5 E. Agent Loop 性能优化 ⭐⭐⭐

**理由**:
- Cycle 37 已完成 Agent Loop 基础
- 但执行效率和资源消耗未优化
- 可借鉴 RAG 性能优化的经验
- Token 成本控制是核心痛点

**核心任务**:
- G49-01: Agent Loop 性能监控
- G49-02: Token 使用优化（提示压缩、缓存）
- G49-03: 并行工具调用优化
- G49-04: Agent Loop 基准测试

**对标**: LangChain Agents, AutoGPT

---

## 3. 推荐方向

### 3.1 综合评估

| 方向 | 业务价值 | 技术深度 | 实施难度 | ROI |
|------|----------|----------|----------|-----|
| A. 真实 CLIP 多模态 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 高 |
| B. 端到端多模态智能体 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 中 |
| C. 多模态 RAG 评估 | ⭐⭐⭐⭐ | ⭐⭐⭐ | 低 | 中 |
| D. MCP 真实服务器扩展 | ⭐⭐⭐ | ⭐⭐⭐ | 中 | 中 |
| E. Agent Loop 优化 | ⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 中 |

### 3.2 推荐

**推荐: A. 真实 CLIP 多模态模型集成** ⭐⭐⭐⭐⭐

理由:
- 直接补齐 Cycle 48 多模态 RAG 的关键短板（Mock provider）
- 提升跨模态检索质量（Recall@10 > 0.9）
- 火山方舟多模态 API 已成熟，可立即对接
- 与现有 Embedding 引擎无缝集成
- 业务价值最高,投入产出比最大

---

## 4. 任务清单 (以 A 方向为例)

### 4.1 G49-01 真实 CLIP Embedding 引擎

**目标**: 实现真实 CLIP / BGE-M3 多模态 Embedding

**核心能力**:
- Transformers.js 集成（浏览器内运行）
- 真实 CLIP-ViT-B/32 模型加载
- 文本 + 图像共享向量空间
- 模型缓存 + 懒加载
- 离线 / 在线双模式

**关键 API**:
```typescript
class CLIPEmbeddingProvider implements EmbeddingProvider {
  loadModel(modelId?: string): Promise<void>;
  isModelLoaded(): boolean;
  embed(input: MultimodalInput): Promise<number[]>;
  embedBatch(inputs: MultimodalInput[]): Promise<number[][]>;
  getModelInfo(): { modelId: string; dimension: number; loaded: boolean };
}
```

### 4.2 G49-02 火山方舟多模态 API 集成

**目标**: 集成火山方舟 Doubao 多模态 Embedding API

**核心能力**:
- 真实 API 调用（doubao-embedding-vision）
- 文本 + 图像 多模态 Embedding
- 错误处理 + 重试 + 降级
- 成本统计 + Token 用量跟踪

**关键 API**:
```typescript
class VolcengineMultimodalProvider implements EmbeddingProvider {
  constructor(config: { apiKey: string; endpoint?: string; model?: string });
  embed(input: MultimodalInput): Promise<number[]>;
  getCost(input: MultimodalInput): { tokens: number; costUsd: number };
}
```

### 4.3 G49-03 多模态向量质量评估

**目标**: 实现 Recall@K / NDCG / MRR 等多模态质量指标

**核心能力**:
- 召回率（Recall@1/5/10/20）
- 归一化折损累积增益（NDCG）
- 平均倒数排名（MRR）
- 多 Provider 对比（A/B）
- 报告导出

**关键 API**:
```typescript
class MultimodalQualityEvaluator {
  evaluate(queries: Query[], groundTruth: Map<string, string[]>): QualityReport;
  compareProviders(providers: EmbeddingProvider[], corpus: Document[]): ComparisonReport;
  exportReport(report: QualityReport, format: 'json' | 'markdown' | 'html'): string;
}
```

### 4.4 G49-04 模型缓存与懒加载优化

**目标**: 优化大型模型的加载性能和资源占用

**核心能力**:
- IndexedDB 模型缓存
- 懒加载 + 预加载策略
- 加载进度回调
- 内存 + 显存监控
- 离线模式（缓存命中时无需网络）

**关键 API**:
```typescript
class ModelCache {
  loadModel(modelId: string, options?: { preload?: boolean; onProgress?: (p: number) => void }): Promise<ArrayBuffer>;
  isCached(modelId: string): Promise<boolean>;
  clearCache(modelId?: string): Promise<void>;
  getCacheStats(): { size: number; entries: string[] };
}
```

### 4.5 G49-主应用集成 McpMultimodalProviderPanel

**目标**: 多模态 Provider 统一管理面板

**核心能力**:
- 5 Tab: Mock / 火山方舟 / DeepSeek / CLIP 本地 / 设置
- 真实 API Key 配置 + 加密存储
- 加载进度可视化
- 成本统计 Dashboard

---

## 5. 交付标准

### 5.1 代码标准

- TypeScript 严格模式 0 错误
- 函数必须有完整中文注释
- 严格遵循 PEP8 / Google TypeScript Style Guide
- 关键路径必须有异常处理
- API Key 必须加密存储（不得明文落盘）

### 5.2 测试标准

- 单元测试覆盖率 ≥ 80%
- 100% 测试通过率
- 性能基准测试（嵌入延迟 / 检索质量 / 缓存命中率）
- 真实 API 集成测试（带 fallback）
- TypeScript 严格模式 0 错误
- Vite 生产构建成功

### 5.3 文档标准

- CYCLE49_STARTUP.md (本文档)
- CYCLE49_ACCEPTANCE_REPORT.md
- CYCLE49_CODE_MODIFICATION_LOG.md
- CYCLE50_STARTUP.md
- 各核心文件头注释完整

### 5.4 集成标准

- 完整主应用集成
- BrandHeader 新增菜单项
- AppLayout 回调透传
- useModals PanelKey
- App.tsx 渲染逻辑

---

## 6. 验收标准

### 6.1 功能验收

- [ ] G49-01 真实 CLIP Embedding 引擎
- [ ] G49-02 火山方舟多模态 API 集成
- [ ] G49-03 多模态向量质量评估
- [ ] G49-04 模型缓存与懒加载优化
- [ ] G49-主应用集成 McpMultimodalProviderPanel
- [ ] TypeScript 严格模式 0 错误
- [ ] 单元测试 100% 通过
- [ ] Vite 生产构建成功

### 6.2 性能验收

- [ ] 真实 CLIP 嵌入 P95 延迟 < 200ms
- [ ] Recall@10 > 0.9（真实多模态数据）
- [ ] 模型加载时间 < 30s（首字节）
- [ ] 缓存命中时 < 1ms 加载
- [ ] 100 并发下吞吐量 > 20 queries/sec

### 6.3 集成验收

- [ ] App.tsx 主应用集成
- [ ] AppLayout 回调透传
- [ ] BrandHeader 菜单项
- [ ] useModals PanelKey
- [ ] Vite 构建成功
- [ ] TypeScript 严格模式 0 错误
- [ ] 单元测试 100% 通过

---

## 7. 风险评估

| 风险 | 等级 | 影响 | 缓解策略 |
|------|------|------|----------|
| 模型加载失败 | 中 | 功能不可用 | Mock 兜底 + 错误提示 |
| 真实 API 限流 | 中 | 性能下降 | 重试 + 退避 + 缓存 |
| API Key 安全 | 高 | 安全事故 | 加密存储 + 不打印 |
| 模型大小 | 中 | 首屏加载慢 | 懒加载 + 预加载 |
| 浏览器兼容性 | 低 | 部分用户受影响 | 降级到 Mock |

---

## 8. 任务依赖

```
G49-01 (真实 CLIP)
  ↓
G49-02 (火山方舟 API) 依赖 G49-01
  ↓
G49-03 (质量评估) 依赖 G49-01 + G49-02
  ↓
G49-04 (模型缓存) 依赖 G49-01
  ↓
G49-主应用集成 (UI 集成所有)
```

---

## 9. 周期节奏

| 阶段 | 内容 | 预计时间 |
|------|------|----------|
| Phase 1 | G49-01 真实 CLIP Embedding | 2-2.5h |
| Phase 2 | G49-02 火山方舟多模态 API | 1.5h |
| Phase 3 | G49-03 多模态质量评估 | 1.5h |
| Phase 4 | G49-04 模型缓存 | 1h |
| Phase 5 | 主应用集成 + 测试 | 1-2h |
| Phase 6 | 文档 + Git 提交 | 0.5h |
| **合计** | | **7.5-9h** |

---

## 10. 预期收益

### 10.1 能力提升

- ✅ 真实多模态 Embedding（替换 Mock）
- ✅ 火山方舟生产级 API 集成
- ✅ 跨模态检索质量可量化
- ✅ 模型加载性能优化

### 10.2 业务价值

- 跨模态检索精度提升（Recall@10: 0.7 → 0.9+）
- 生产可用级别（真实 API + 缓存 + 监控）
- 成本可控（API Key 加密 + Token 统计）
- 用户可选择性启用（Mock / 真实 / 本地）

### 10.3 与现有体系融合

- 与 Cycle 48 多模态 RAG 引擎无缝集成
- 与 Cycle 46 真实 LLM 端到端集成
- 与 Cycle 47 RAG 性能优化兼容
- 与 Cycle 37-44 MCP 生态协同

---

## 11. 启动确认

**请用户确认**:

1. 调研方向选择:
   - [ ] A. 真实 CLIP 多模态模型集成 (推荐)
   - [ ] B. 端到端多模态智能体
   - [ ] C. 多模态 RAG 评估框架
   - [ ] D. MCP 真实服务器扩展
   - [ ] E. Agent Loop 性能优化

2. 任务节奏选择:
   - [ ] A. 3 大 P0 + 1 集成
   - [ ] B. 4 大 P0 + 1 集成 (推荐)
   - [ ] C. 5 大 P0 + 1 集成

3. 真实多模态 API 接入:
   - [ ] A. 仅 Mock (推荐,避免外部依赖)
   - [ ] B. 火山方舟多模态 Embedding
   - [ ] C. 火山方舟 + DeepSeek 双 Provider
   - [ ] D. 本地 CLIP 模型（Transformers.js）

4. 真实模型部署方式 (如选 D):
   - [ ] A. CDN 动态加载
   - [ ] B. IndexedDB 缓存 + 懒加载
   - [ ] C. Service Worker 预缓存

---

**启动文档生成时间**: 2026-08-01
**周期状态**: 🟡 等待用户确认
**等待**: 用户确认调研方向、任务节奏、API 接入策略
