# CYCLE 37 启动文档

## 周期信息
- **周期编号**: Cycle 37
- **启动时间**: 2026-07-31
- **前序周期**: Cycle 36（LLM Provider + 流式响应 + 多模态）
- **目标**: 在 Cycle 36 基础上深化 LLM 能力，扩展智能体能力与端侧集成

---

## 一、Cycle 36 回顾

### 1.1 已完成能力
- ✅ LLMProviderAdapter（4 个 Provider）
- ✅ StreamingResponseEngine（流式响应 + 统计）
- ✅ MultiModalProcessor（图像/音频/文件/融合）
- ✅ 3 大 UI 面板 + 主应用集成
- ✅ 4822 tests passing / 0 TS errors

### 1.2 已具备基础
- 4 个 LLM Provider 适配（Mock + Anthropic + OpenAI + Ollama）
- SSE 流式响应（暂停/恢复/取消 + TTFT/ITPS 统计）
- 多模态处理（图像压缩/缩略图/EXIF + 音频录制 + 文件解析 + 融合）

### 1.3 仍可深化
- **真实 LLM SDK 接入**: Anthropic SDK / OpenAI SDK / Ollama HTTP
- **RAG 知识库**: 文档向量化 + 检索增强生成
- **Function Calling / Tool Use**: LLM 调用外部工具
- **Agent Loop**: ReAct / Plan-and-Execute
- **Prompt Engineering**: 模板管理 + 版本控制 + A/B 测试
- **模型评测**: 自动化 Benchmark + 性能对比
- **Token 成本优化**: 缓存 + 压缩 + 路由策略
- **多模态增强**: 视频处理 / 实时摄像头

---

## 二、调研方向（三选一）

### 方向 A：RAG 知识库 + Tool Use（推荐）

**主题**: Retrieval-Augmented Generation + Function Calling

**核心议题**:
1. **RAG 架构**: Embedding / Vector Store / Retrieval / Re-ranking
2. **Tool Use 协议**: OpenAI Function Calling / Anthropic Tool Use
3. **Agent Loop**: ReAct / Plan-and-Execute / Reflexion
4. **多模态 RAG**: 图像/音频检索
5. **Prompt Engineering**: 模板 + 版本控制

**候选功能**:
- G37-01: RAGEngine（RAG 知识库引擎）
  - 文档加载 / 切片 / Embedding
  - 向量检索 + 关键词混合
  - Re-ranking + 来源引用
- G37-02: ToolUseEngine（工具调用引擎）
  - Function Calling 协议适配
  - 工具注册 / 权限 / 执行
  - 调用历史与回放
- G37-03: AgentLoopEngine（智能体循环引擎）
  - ReAct / Plan-and-Execute
  - 工具选择 + 结果解析
  - 多步推理状态管理

**预期工作量**: 中等（需要 Embedding + 向量检索）

---

### 方向 B：模型评测 + 成本优化

**主题**: Model Evaluation + Cost Optimization

**核心议题**:
1. **自动化 Benchmark**: GSM8K / MMLU / HumanEval
2. **性能对比**: Latency / Throughput / Quality
3. **成本分析**: Token 用量 / 单价 / 总成本
4. **路由策略**: 按场景选模型（Haiku vs Sonnet）
5. **缓存机制**: 语义缓存 / 精确缓存

**候选功能**:
- G37-01: ModelBenchmarkEngine（模型评测引擎）
  - 多模型对比测试
  - 自动化 Benchmark 套件
  - 报告生成
- G37-02: CostOptimizerEngine（成本优化引擎）
  - 智能路由（成本/质量权衡）
  - 语义缓存
  - 成本预测
- G37-03: PromptOptimizerEngine（Prompt 优化引擎）
  - A/B 测试框架
  - 模板版本管理
  - 自动 Prompt Tuning

**预期工作量**: 中等偏高（需要评测集 + 自动化）

---

### 方向 C：多模态增强 + 实时处理

**主题**: Video / Real-time Camera / Live Streaming

**核心议题**:
1. **视频处理**: 抽帧 / 关键帧 / 转码
2. **实时摄像头**: WebRTC / MediaStream
3. **Live Streaming**: 视频流 + LLM 实时分析
4. **多模态融合**: 视频 + 音频 + 文本
5. **边缘部署**: WASM / WebGPU

**候选功能**:
- G37-01: VideoProcessorEngine（视频处理引擎）
  - 抽帧 / 关键帧检测 / 转码
  - 视频摘要生成
  - 多模态融合
- G37-02: CameraStreamEngine（摄像头流引擎）
  - WebRTC / MediaStream
  - 实时帧捕获
  - 实时 OCR / 物体检测
- G37-03: MultimodalFusionEngine（多模态融合引擎）
  - 跨模态检索
  - 视频 + 音频 + 文本联合分析
  - 时序对齐

**预期工作量**: 高（视频处理 + 实时性能）

---

## 三、推荐方案

### 3.1 主推方向：A（RAG 知识库 + Tool Use）

**理由**:
1. **架构契合**: 与 Cycle 36 LLM Provider 完美衔接
2. **价值明确**: RAG + Tool Use 是 LLM 应用的核心能力
3. **生态完整**: Function Calling 协议已标准化（OpenAI/Anthropic）
4. **可演示**: 知识库检索 + 工具调用效果直观
5. **生产可用**: 是企业级 LLM 应用的必备能力

### 3.2 备选方向：B（成本优化）

**适用场景**: 如果产品对成本敏感 + 需要多模型管理
**优势**: Cycle 36 已有 UsageTracker 基础

### 3.3 备选方向：C（多模态增强）

**适用场景**: 如果产品需要视频/实时摄像头能力
**优势**: Cycle 36 MultiModalProcessor 已有基础

---

## 四、任务规划（基于方向 A）

### 4.1 Phase 1: 调研（1-2 天）
- 阅读现有 LLM Provider + Streaming + MultiModal
- 互联网调研：RAG 架构（LangChain / LlamaIndex / Haystack）
- 调研：Function Calling 协议规范
- 编写调研报告 CYCLE37_CODEX_TRAE_RESEARCH.md

### 4.2 Phase 2: 差距分析（0.5 天）
- 现状梳理
- 差距识别
- 编写 CYCLE37_GAP_ANALYSIS.md

### 4.3 Phase 3: SPEC 编写（1.5 天）
- G37-01 RAGEngine SPEC
- G37-02 ToolUseEngine SPEC
- G37-03 AgentLoopEngine SPEC

### 4.4 Phase 4: 核心引擎开发（3-4 天）
- 3 大引擎 + 单元测试
- 估计新增 200+ 单元测试

### 4.5 Phase 5: UI 组件 + 集成（1-2 天）
- 3 大 UI 面板
- 知识库管理界面
- 工具配置界面
- 主应用集成

### 4.6 Phase 6: 测试验证（0.5-1 天）
- E2E 集成测试
- 全量测试 100% 通过
- TypeScript 0 错误

### 4.7 Phase 7: 验收 + Git 提交（0.5 天）
- CYCLE37_ACCEPTANCE_REPORT.md
- CYCLE37_CODE_MODIFICATION_LOG.md
- CYCLE38_STARTUP.md
- 5-6 个 Git commits

**总工作量估计**: 8-11 天

---

## 五、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| Embedding 模型选择 | 中 | 默认支持 OpenAI Embeddings，可扩展 |
| 向量数据库 | 低 | 纯前端实现，使用 IndexedDB 持久化 |
| Tool Use 协议兼容 | 中 | 参考 OpenAI Function Calling 规范 |
| 性能瓶颈 | 低 | 单例 + 缓存 + 限制历史 |
| 测试覆盖 | 中 | E2E 完整覆盖 RAG + Tool 关键路径 |

---

## 六、决策点

请用户确认：

1. **调研方向**: A / B / C
   - 默认推荐：A（RAG 知识库 + Tool Use）

2. **任务节奏**: 维持 3 大 P0 任务 / 缩减到 2 大 / 扩展到 4 大
   - 默认推荐：3 大 P0

3. **优先级**: 是否纳入生产可用级别（Phase 1-7 全部执行）
   - 默认推荐：是

4. **特殊要求**: 是否需要真实 Embedding API / 真实向量数据库
   - 默认推荐：暂不，使用纯前端 + Mock Embedding

---

## 七、Loop Engineering 工作流

继续遵循既有工作流：
- 需求分析 → 架构设计 → 关键迭代 → 验收标准 → 任务分配 → CLI 代码生成 → 全链路评审 → 智能迭代 → Git 提交

---

## 八、启动准备

✅ Cycle 36 全部完成并提交
✅ 4822 tests passing / 0 TS errors
✅ 主应用集成完成
✅ 文档完整
⏳ 等待用户确认 Cycle 37 调研方向：A（RAG 知识库 + Tool Use）

**Cycle 37 启动条件**：用户确认方向后进入 Phase 1 调研阶段
