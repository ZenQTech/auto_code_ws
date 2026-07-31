# CYCLE 37 启动文档

## 周期信息
- **周期编号**: Cycle 37
- **启动时间**: 2026-07-31
- **前序周期**: Cycle 36（LLM Provider + 流式响应 + 多模态）
- **目标**: RAG 知识库 + Tool Use + Agent Loop + 真实 LLM 集成

---

## 一、Cycle 36 回顾

### 1.1 已完成能力
- ✅ LLMProviderAdapter（4 个 Provider：Mock + Anthropic + OpenAI + Ollama）
- ✅ StreamingResponseEngine（流式响应 + TTFT/ITPS 统计 + 暂停/恢复/取消）
- ✅ MultiModalProcessor（图像/音频/文件/融合）
- ✅ 3 大 UI 面板 + 主应用集成
- ✅ 4822 tests passing / 0 TS errors

### 1.2 已具备基础
- 4 个 LLM Provider 适配（Mock + Anthropic + OpenAI + Ollama）
- SSE 流式响应（暂停/恢复/取消 + TTFT/ITPS 统计）
- 多模态处理（图像压缩/缩略图/EXIF + 音频录制 + 文件解析 + 融合）
- UsageTracker（Token 用量 + 成本统计）

### 1.3 仍可深化
- **RAG 知识库**: 文档向量化 + 检索增强生成
- **Function Calling / Tool Use**: LLM 调用外部工具
- **Agent Loop**: ReAct / Plan-and-Execute
- **真实 LLM 集成**: DeepSeek API + Volcengine Ark Coding Plan

### 1.4 用户确认决策（2026-07-31）
- **调研方向**: A（RAG 知识库 + Tool Use）
- **任务节奏**: 扩展到 **4 大 P0 任务**
- **API 对接**: DeepSeek API + Volcengine Ark Coding Plan（生产可用级别）

---

## 二、4 大 P0 任务

### 2.1 G37-01 RAGEngine（RAG 知识库引擎）
**主题**: Retrieval-Augmented Generation

**核心能力**:
- 文档加载（TXT / Markdown / JSON / PDF / HTML）
- 文本切片（Sliding Window / Semantic）
- Embedding（OpenAI 兼容接口 / DeepSeek / Volcengine / Mock）
- 向量检索（Cosine Similarity / L2 Distance）
- 关键词检索（BM25 / TF-IDF）
- 混合检索（Hybrid Search）
- Re-ranking（Cross-Encoder / 启发式）
- 来源引用（Source Citation）

### 2.2 G37-02 ToolUseEngine（工具调用引擎）
**主题**: Function Calling / Tool Use

**核心能力**:
- 工具注册 / 权限管理
- OpenAI Function Calling 协议（DeepSeek 兼容）
- Anthropic Tool Use 协议
- 工具执行器（本地 / HTTP / MCP）
- 调用历史与回放
- 错误处理与重试
- 工具市场（Tool Marketplace）

### 2.3 G37-03 AgentLoopEngine（智能体循环引擎）
**主题**: ReAct / Plan-and-Execute

**核心能力**:
- ReAct 模式（Reason + Act）
- Plan-and-Execute 模式
- 工具选择策略
- 多步推理状态管理
- 终止条件（最大步数 / 目标达成 / 置信度）
- 决策可解释性（Thought / Action / Observation）
- 人机协作（Human-in-the-Loop）

### 2.4 G37-04 RealLLMProvider（真实 LLM Provider 集成）
**主题**: DeepSeek API + Volcengine Ark Coding Plan

**核心能力**:
- DeepSeekProvider（OpenAI 兼容协议 + SSE 流式）
- VolcengineArkProvider（火山方舟 Coding Plan 协议 + SSE 流式）
- 环境变量配置（API Key 通过 .env 管理）
- Tool Use 支持（DeepSeek Function Calling）
- 使用量统计与成本计算
- 自动重试与错误处理
- 速率限制（Rate Limit）

**安全要求**:
- API Key **仅通过环境变量注入**（process.env.DEEPSEEK_API_KEY / ARK_API_KEY）
- 提供 `.env.example` 模板，**绝不提交 `.env`**
- `.gitignore` 包含 `.env` / `.env.local` / `.env.*.local`
- 代码中所有 API Key 引用必须使用占位符

---

## 三、推荐方案

### 3.1 主推方向：A 扩展版（RAG + Tool Use + Agent Loop + 真实 LLM）

**理由**:
1. **架构契合**: 与 Cycle 36 LLM Provider 完美衔接
2. **价值明确**: RAG + Tool Use + Agent Loop 是 LLM 应用的核心能力
3. **生产可用**: 接入真实 DeepSeek + Volcengine Ark，从 Demo 走向生产
4. **可演示**: 知识库检索 + 工具调用 + 真实 LLM 效果直观
5. **安全可控**: 环境变量管理 API Key，符合企业级安全标准

### 3.2 备选方向：B（成本优化）/ C（多模态增强）
已确认不采用，存档备查。

---

## 四、任务规划（4 大 P0 任务）

### 4.1 Phase 1: 调研（1-2 天）
- 阅读现有 LLM Provider + Streaming + MultiModal
- 互联网调研：
  - RAG 架构（LangChain / LlamaIndex / Haystack）
  - Function Calling 协议（OpenAI / Anthropic 官方文档）
  - DeepSeek API 文档
  - Volcengine Ark Coding Plan 文档
- 编写调研报告 CYCLE37_CODEX_TRAE_RESEARCH.md

### 4.2 Phase 2: 差距分析（0.5 天）
- 现状梳理
- 差距识别
- 编写 CYCLE37_GAP_ANALYSIS.md

### 4.3 Phase 3: SPEC 编写（2 天）
- G37-01 RAGEngine SPEC
- G37-02 ToolUseEngine SPEC
- G37-03 AgentLoopEngine SPEC
- G37-04 RealLLMProvider SPEC（DeepSeek + Volcengine Ark）

### 4.4 Phase 4: 核心引擎开发（4-5 天）
- 4 大引擎 + 单元测试
- 估计新增 250+ 单元测试
- E2E 集成测试

### 4.5 Phase 5: UI 组件 + 集成（2 天）
- 4 大 UI 面板（RAG 管理 / Tool 市场 / Agent Loop / Real Provider）
- 主应用集成

### 4.6 Phase 6: 测试验证（1 天）
- E2E 集成测试
- 全量测试 100% 通过
- TypeScript 0 错误
- 真实 API 联调（可选，配置环境变量后）

### 4.7 Phase 7: 验收 + Git 提交（0.5 天）
- CYCLE37_ACCEPTANCE_REPORT.md
- CYCLE37_CODE_MODIFICATION_LOG.md
- CYCLE38_STARTUP.md
- 5-6 个 Git commits

**总工作量估计**: 11-14 天

---

## 五、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| Embedding 模型选择 | 中 | 默认支持 OpenAI 兼容接口，可切换 DeepSeek/Volcengine |
| 向量数据库 | 低 | 纯前端实现，使用 IndexedDB 持久化 |
| Tool Use 协议兼容 | 中 | 参考 OpenAI Function Calling 规范（DeepSeek 兼容） |
| 真实 API 联调 | 中 | 环境变量管理，提供 Mock fallback |
| API Key 安全 | **高** | **仅环境变量，.gitignore 严格控制，.env.example 模板** |
| Agent Loop 终止 | 中 | 最大步数 + 超时 + 目标达成检测 |
| 性能瓶颈 | 低 | 单例 + 缓存 + 限制历史 |
| 测试覆盖 | 中 | E2E 完整覆盖 RAG + Tool + Agent + Real API 关键路径 |

---

## 六、决策点（已确认）

1. **调研方向**: A（RAG 知识库 + Tool Use）✅
2. **任务节奏**: 扩展到 **4 大 P0 任务** ✅
3. **真实 API 对接**: DeepSeek + Volcengine Ark Coding Plan ✅

---

## 七、Loop Engineering 工作流

继续遵循既有工作流：
- 需求分析 → 架构设计 → 关键迭代 → 验收标准 → 任务分配 → CLI 代码生成 → 全链路评审 → 智能迭代 → Git 提交

---

## 八、启动准备

✅ Cycle 36 全部完成并提交（5 个 Git commits）
✅ 4822 tests passing / 0 TS errors
✅ 主应用集成完成
✅ 文档完整
✅ 用户确认 Cycle 37 调研方向：A（RAG 知识库 + Tool Use）
✅ 用户确认任务节奏：4 大 P0 任务
✅ 用户确认 API 对接：DeepSeek + Volcengine Ark

**Cycle 37 启动！进入 Phase 1 调研阶段。**
