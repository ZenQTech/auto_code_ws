# Cycle 46 启动文档

## 周期概览

- **周期**：Cycle 46
- **方向（推荐）**：A. MCP × Hermes × 真实 LLM 端到端集成（推荐）
- **任务节奏**：B. 4 大 P0
- **完成时间目标**：2026-08-01

## Cycle 45 总结

### 已完成

✅ **4 大 P0 任务**全部完成
- G45-01: MCP × RAG 融合引擎核心（mcpRagEngine, 41 tests）
- G45-02: MCP 资源作为 RAG 知识库（mcpRagKnowledgeBase, 40 tests）
- G45-03: MCP 工具作为 RAG 检索源（mcpToolRagSource, 49 tests）
- G45-04: Agent RAG 增强循环 + UI 面板（mcpRagAgent + McpRagPanel, 21 tests）

### 关键指标

- 代码新增：~4500 行
- 测试通过：151/151 (100%)
- TypeScript 错误：0
- Vite 构建：成功 (24.17s)
- Git 提交：5 个原子提交

### 核心能力

- **三源融合**：资源 RAG + 工具 RAG + 提示词 RAG
- **智能路由**：基于 query 意图自动选择策略
- **完整流程**：索引 → 检索 → 工具 → 组装 → LLM → 引用
- **生产可用**：缓存、并发、错误处理、统计完备

## Cycle 46 候选方向

### A. MCP × Hermes × 真实 LLM 端到端集成（推荐）⭐⭐⭐⭐⭐

**核心价值**：
- 将 Cycle 45 的 RAG 能力与真实 LLM API 端到端打通
- 完整走通：用户问题 → 决策 → 资源/工具检索 → Prompt 注入 → LLM 生成 → 引用展示
- 覆盖火山方舟 / DeepSeek / Anthropic 等多 Provider

**核心任务**：
- G46-01: 真实 LLM 端到端 RAG 集成（MultiProvider + RAGEngine + McpRagAgent）
- G46-02: RAG 质量评估与监控（hit rate / latency / token cost / 引用准确率）
- G46-03: RAG 调试器（trace + 步骤回放 + 中间结果可视化）
- G46-04: RAG 端到端 E2E 测试套件（20+ 场景）

**业务价值**：让 Cycle 45 的 RAG 从"能跑"变成"能生产用"

### B. MCP × Hermes × 性能优化与缓存策略

**核心价值**：
- 向量检索性能（FAISS / HNSW 集成）
- 多级缓存（query / embedding / search results）
- 大规模知识库支持（10K+ 文档）

**核心任务**：
- G46-01: 嵌入式向量索引（FAISS-WASM）
- G46-02: 多级缓存 + 失效策略
- G46-03: 分布式 RAG（多 worker 协同）
- G46-04: 性能基准 + 压测报告

### C. MCP × Hermes × 多模态 RAG

**核心价值**：
- 图像 / 音频 / 视频内容作为 RAG 源
- 跨模态检索（文本查询 → 图像命中）
- CLIP / ImageBind 集成

**核心任务**：
- G46-01: 图像 Embedding（CLIP）
- G46-02: 多模态向量存储
- G46-03: 跨模态检索 + 融合
- G46-04: 多模态 RAG UI 面板

### D. MCP × Hermes × 智能调度与可观测性

**核心价值**：
- RAG 流程可观测（trace / metrics / logs）
- 智能调度（资源 RAG vs 工具 RAG 自动选择优化）
- 失败重试 + 降级策略

**核心任务**：
- G46-01: RAG 全链路 Trace
- G46-02: 智能调度引擎
- G46-03: 失败重试 + 降级
- G46-04: 可观测性 UI 面板

### E. MCP × Hermes × 知识图谱融合

**核心价值**：
- 实体识别 + 关系抽取
- 知识图谱构建
- GraphRAG 检索（基于关系扩展）

**核心任务**：
- G46-01: 实体 / 关系抽取
- G46-02: 知识图谱构建
- G46-03: GraphRAG 检索
- G46-04: GraphRAG UI 面板

## 推荐理由

### 为什么选 A（真实 LLM 端到端集成）？

1. **业务闭环**：Cycle 37-45 已建立完整的 RAG 基础设施
   - 资源 RAG ✅
   - 工具 RAG ✅
   - 提示词 RAG ✅
   - 智能体编排 ✅
   - **缺：真实 LLM 端到端验证**

2. **生产可用性**：当前 RAG 仅在 MockProvider 下工作
   - 真实场景下：火山方舟 / DeepSeek / Anthropic API 兼容性
   - 真实场景下：token 成本 / 延迟 / 限流处理
   - 真实场景下：引用质量 / 幻觉检测

3. **质量保障**：当前缺乏系统化的 RAG 质量评估
   - Hit rate（命中率）
   - Citation accuracy（引用准确率）
   - End-to-end latency
   - Token cost

4. **调试能力**：当前 RAG 流程对用户不透明
   - 不知道 RAG 走了哪条路径
   - 不知道 LLM 看到了什么上下文
   - 不知道为什么会得到某个答案
   - 缺乏可调试性 = 难以生产化

5. **E2E 验证**：当前缺乏端到端测试套件
   - 单元测试覆盖各模块
   - 缺：用户场景级别的 E2E
   - 缺：性能 / 稳定性 / 兼容性验证

### 预期交付

- **5 大组件**：
  - 真实 LLM RAG 引擎
  - RAG 质量监控面板
  - RAG 调试器
  - E2E 测试套件（20+ 场景）
  - 主应用集成

- **8 大特性**：
  - 多 Provider LLM 集成
  - 端到端 trace
  - 引用验证
  - Token 成本统计
  - 延迟监控
  - 失败降级
  - 调试回放
  - E2E 报告

## 任务详细规划

### G46-01: 真实 LLM 端到端 RAG 集成

**目标**：将 McpRagAgent 与真实 LLM API 端到端打通

**实现要点**：
- 接入火山方舟 Coding Plan（已有）
- 接入 DeepSeek（已有）
- 端到端测试：query → decision → resource/tool → LLM → response
- 错误处理：API 限流 / 超时 / 余额不足
- 流式响应支持

**交付物**：
- `realLlmRagEngine.ts` 真实 LLM RAG 引擎
- `realLlmRagEngine.test.ts` (10+ tests)
- 端到端 demo 脚本

### G46-02: RAG 质量评估与监控

**目标**：建立 RAG 质量评估体系

**实现要点**：
- Hit rate 统计
- Citation accuracy 验证
- Token cost 追踪
- Latency P50/P95/P99
- 失败率 / 降级率
- 历史趋势分析

**交付物**：
- `ragQualityMonitor.ts` 质量监控
- `ragMetricsCollector.ts` 指标收集
- 测试 (8+ tests)

### G46-03: RAG 调试器

**目标**：RAG 流程可追溯、可调试

**实现要点**：
- 全链路 trace 记录
- 步骤回放
- 中间结果可视化（资源 hits / 工具结果 / prompts / LLM input）
- 失败原因分析

**交付物**：
- `ragTracer.ts` Trace 引擎
- `RagDebugPanel.tsx` 调试面板
- 测试 (10+ tests)

### G46-04: RAG 端到端 E2E 测试套件

**目标**：覆盖 20+ 用户场景的端到端测试

**实现要点**：
- 真实 LLM 集成测试
- 资源 RAG / 工具 RAG / 混合 RAG 场景
- 错误恢复测试
- 性能基准
- 兼容性测试

**交付物**：
- `ragE2ETestSuite.ts` 端到端测试
- 20+ 场景覆盖
- 报告生成

## 风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 真实 LLM API 不稳定 | 中 | 多 Provider 降级 + 缓存兜底 |
| 真实 LLM 成本不可控 | 中 | Token 计数 + 预算控制 |
| 端到端测试运行时间长 | 低 | 并行执行 + 智能 skip |
| 调试面板性能开销 | 低 | 采样 + 异步日志 |

## 待确认事项

请用户确认：

1. **调研方向**：A / B / C / D / E（推荐 A）
2. **任务节奏**：3 / 4 / 2 P0（推荐 4）
3. **API 集成**：火山方舟 / DeepSeek / Anthropic / Mock Only（推荐火山方舟 + DeepSeek）
4. **测试覆盖**：完整 20+ 场景 / 核心 10 场景 / 仅冒烟
5. **文档详细度**：完整报告 / 标准 / 简洁
