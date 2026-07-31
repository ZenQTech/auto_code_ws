# CYCLE 50 启动文档

## 📋 上周期回顾

**Cycle 49**: 真实 CLIP 多模态模型集成
- ✅ G49-01 真实 CLIP Embedding 引擎
- ✅ G49-02 火山方舟多模态 Provider
- ✅ G49-03 多模态向量质量评估器
- ✅ G49-04 模型缓存与懒加载
- ✅ G49-INTEGRATION 主应用 5-Tab 集成

**Cycle 49 成果**:
- 195 个新测试 (195/195 通过)
- 总测试数 6881/6881 (100% 通过率)
- TypeScript 0 错误
- Vite 生产构建成功 (23.79s)

## 🎯 Cycle 50 候选方向

| 方向 | 优先级 | 描述 | 复杂度 |
|------|--------|------|--------|
| **A. 真实 Volcengine 接入 + 端到端 E2E** | ⭐⭐⭐⭐⭐ | 替换 Mock 为真实 API Key 接入, 添加生产级 E2E | 中 |
| **B. 模型量化与剪枝** | ⭐⭐⭐⭐ | 支持 4-bit/8-bit 量化, 模型体积减少 50%+ | 高 |
| **C. 分布式多模态 Embedding** | ⭐⭐⭐ | 多 Worker 并行 embed, 提升吞吐 3-5x | 高 |
| **D. 多语言扩展 (i18n)** | ⭐⭐⭐ | 多语言 UI, 中英日韩四语 | 中 |
| **E. A/B 测试框架** | ⭐⭐ | 内置实验框架, Provider 流量分配 | 中 |

## 📊 现状盘点

### 已实现的多模态 RAG 引擎
- ✅ **Embedding**: CLIPLocalProvider + VolcengineMultimodalProvider
- ✅ **索引**: MultimodalVectorIndex (FAISS-WASM 之上, 3模态)
- ✅ **缓存**: MultimodalSemanticCache (3级命中 + 跨模态)
- ✅ **质量评估**: MultimodalQualityEvaluator (Recall@K/NDCG/MRR/F1/MAP)
- ✅ **模型缓存**: ModelCache (双层 LRU + 进度回调)
- ✅ **性能基准**: MultimodalRAGBenchmark
- ✅ **主应用集成**: McpMultimodalRagPanel + McpMultimodalProviderPanel (10 Tab 总计)

### Cycle 50 推荐路径: A (真实 Volcengine 接入 + E2E)

**G50-01**: 真实火山方舟 API 接入
- 替换 `MockVolcengineMultimodalProvider` 为真实 HTTP 调用
- API Key 安全存储 (加密 + LocalStorage 隔离)
- 限流保护 (RPS 控制)
- 错误重试 + 监控埋点

**G50-02**: 多模态 RAG 端到端 E2E 测试套件
- 真实文档集 (PDF/图片混合)
- 跨模态问答场景 (图→文 / 文→图 / 图+文→答案)
- 性能基准 (P95 < 100ms)
- 质量指标 (Recall@10 > 0.85)

**G50-03**: 监控与可观测性
- Prometheus metrics 导出
- 错误日志聚合
- 用户操作埋点
- Dashboard 可视化

**G50-04**: 生产部署与文档
- Docker 镜像构建
- 部署文档 + 故障排查指南
- 性能调优 checklist
- 安全加固 (CSP/CORS/SRI)

## 🚀 启动步骤

### 第一步: 确认方向
- 在开始前确认 Cycle 50 方向 (A/B/C/D/E)
- 确认任务节奏 (3/4/5 P0)
- 确认 API 接入策略 (Mock/Volcengine/DeepSeek/Other)

### 第二步: 需求分解
- 将选定方向拆解为 G50-XX 子任务
- 每个子任务定义: 输入/输出/验收标准
- 按依赖关系排序

### 第三步: 实施
- 按 G50-01 → G50-04 顺序实施
- 每完成一个子任务立即编写测试
- 同步更新主应用面板 (如需要)

### 第四步: 测试与验证
- 每个子任务完成运行全量测试
- TypeScript 0 错误 + 100% 测试通过
- Vite 生产构建成功
- 端到端冒烟测试

### 第五步: 文档与提交
- CYCLE50_ACCEPTANCE_REPORT.md
- CYCLE50_CODE_MODIFICATION_LOG.md
- CYCLE51_STARTUP.md
- 原子 Git 提交

## 📁 已有相关文件清单

### 工具类
- `frontend/src/utils/clipLocalProvider.ts` (真实 CLIP)
- `frontend/src/utils/volcengineMultimodalProvider.ts` (火山方舟 + Mock)
- `frontend/src/utils/multimodalEmbedding.ts` (统一多模态 Embedding)
- `frontend/src/utils/multimodalVectorIndex.ts` (图文混合索引)
- `frontend/src/utils/multimodalSemanticCache.ts` (跨模态缓存)
- `frontend/src/utils/multimodalBenchmark.ts` (性能基准)
- `frontend/src/utils/multimodalQualityEvaluator.ts` (质量评估)
- `frontend/src/utils/modelCache.ts` (模型缓存)

### 组件
- `frontend/src/components/McpMultimodalRagPanel.tsx` (5-Tab 多模态 RAG)
- `frontend/src/components/McpMultimodalProviderPanel.tsx` (5-Tab 真实 Provider)

### 集成
- `frontend/src/hooks/useModals.ts` (v3.10.0 33 panel)
- `frontend/src/components/AppLayout.tsx` (v6.123.0)
- `frontend/src/components/BrandHeader.tsx` (v2.29.0)
- `frontend/src/App.tsx` (v6.123.0)

## ⚠️ 注意事项

1. **测试稳定性**: 避免时间戳敏感的断言 (GlobalErrorToast 已修复)
2. **Node 版本**: 必须使用 nvm 切换到 v24.15.0 (TypeScript 5.x 兼容)
3. **useModals 面板数**: 修改时同步 `useModals.test.ts` 断言 (33→35 keys)
4. **集成测试**: 每次新增 panel 需在 App.tsx + AppLayout + BrandHeader 同步更新
5. **Vite 构建**: 关注 chunk size warning, 必要时 manualChunks 拆分

## 🔧 技术栈状态

| 类别 | 版本/状态 |
|------|-----------|
| React | 18.x (latest) |
| TypeScript | 5.x (strict mode) |
| Vite | 5.x |
| Vitest | 2.1.9 |
| Node | v24.15.0 (via nvm) |
| FAISS-WASM | 0.x |
| happy-dom | latest (with `process` 警告) |

## 📞 待用户确认

请确认以下信息后开始 Cycle 50:

1. **调研方向**: A / B / C / D / E?
2. **任务节奏**: 3 / 4 / 5 P0?
3. **API 接入策略**: Mock only / Volcengine / DeepSeek / Other?

收到确认后将立即开始 Cycle 50 实施。
