# CYCLE38 启动文档

> 周期：Cycle 38  
> 启动日期：2026-07-31  
> 主题：MCP 协议深度集成（推荐方向）  
> 状态：**待用户确认方向**

---

## 一、Cycle 37 回顾

### 1.1 交付成果

| 维度 | 数据 |
|------|------|
| 核心引擎 | 4 大 P0（G37-01/02/03/04） |
| UI 面板 | 4 大 P0（RAG/Tool/Loop/Real LLM） |
| 单元测试 | 212 tests，100% 通过 |
| TypeScript | 0 errors（严格模式） |
| 真实 API 接入 | DeepSeek + 火山方舟 Coding Plan |
| Git Commit | 1 个综合提交 (30e1b10) |

### 1.2 技术亮点

- **RAG 引擎**：混合检索 + RRF 融合 + 引用追踪
- **Tool Use 引擎**：OpenAI/Anthropic 协议双向转换 + 完整 Schema 校验
- **Agent Loop 引擎**：ReAct/Plan-Execute 双模式 + 检查点
- **Real LLM Provider**：DeepSeek reasoning_content + 火山方舟 Coding Plan

### 1.3 遗留事项

1. **MCP 协议**：Tool Use 引擎中 MCPExecutor 仅为占位实现
2. **Embedding 模型**：当前使用 MockEmbedding，未接入真实服务
3. **Reranker 模型**：HeuristicReranker 启发式实现，可升级
4. **E2E 集成测试**：需要真实 API Key 验证

---

## 二、互联网调研方向

### 方向 A：MCP 协议深度集成（推荐）⭐⭐⭐⭐⭐

**背景**：
- Cycle 37 G37-02 Tool Use 引擎已实现 MCPExecutor 占位
- Anthropic 2024-11 推出 MCP（Model Context Protocol）开放标准
- 2026 年 MCP 生态已突破 1000+ 官方/社区 Server
- 主流 IDE（Cursor / Cline / Continue）已支持 MCP

**核心价值**：
- 一次开发，多端复用（任何 MCP Client 都能用）
- 工具生态从"自建"转向"集成"
- 标准化协议降低厂商锁定风险

**P0 任务清单**：

| 任务 | 描述 | 估算 |
|------|------|------|
| G38-01 | MCP Stdio 传输层实现 | 3-4 天 |
| G38-02 | MCP SSE 传输层实现 | 3-4 天 |
| G38-03 | MCP 工具自动发现 + 动态注册 | 2-3 天 |
| G38-04 | MCP Resources / Prompts 模板支持 | 2-3 天 |
| G38-05 | 内置 5+ MCP Server（Filesystem/GitHub/Postgres/Slack/Brave） | 4-5 天 |
| G38-06 | MCP 权限沙箱（per-server 权限管理） | 2-3 天 |

**对标产品**：
- Cursor (MCP 原生支持)
- Cline (MCP 集成)
- Continue (MCP 集成)
- Anthropic Claude Desktop (MCP 协议制定者)

**风险评估**：低（已有占位实现可平滑升级）

---

### 方向 B：RAG 增强 + 多模态检索

**背景**：
- Cycle 37 G37-01 RAG 引擎已实现文本 RAG
- 2026 年多模态 RAG 成为新趋势（GPT-4o Vision + RAG）
- 知识图谱 RAG（GraphRAG / LightRAG）正在崛起

**P0 任务清单**：

| 任务 | 描述 | 估算 |
|------|------|------|
| G38-01 | 图像/音频多模态 Embedding | 4-5 天 |
| G38-02 | ColPali/ColQwen 视觉文档检索 | 3-4 天 |
| G38-03 | Cross-Encoder 重排序模型 | 3-4 天 |
| G38-04 | GraphRAG 知识图谱集成 | 5-6 天 |
| G38-05 | 实时增量索引 | 2-3 天 |

**对标产品**：
- LightRAG (HKUDS)
- GraphRAG (Microsoft)
- RAGFlow (InfiniFlow)
- Vectara (企业级 RAG)

**风险评估**：中高（需要大量基础设施）

---

### 方向 C：Agent Loop 高级能力

**背景**：
- Cycle 37 G37-03 Agent Loop 引擎已实现基础 ReAct/Plan-Execute
- 2026 年 Agent 框架向多 Agent 协作 + 长期记忆演进
- LangGraph / AutoGen / CrewAI 已成为事实标准

**P0 任务清单**：

| 任务 | 描述 | 估算 |
|------|------|------|
| G38-01 | 多 Agent 协作（Manager-Worker） | 4-5 天 |
| G38-02 | 长期记忆（MemGPT 风格分层存储） | 4-5 天 |
| G38-03 | 反思与自我修正（Reflexion 模式） | 3-4 天 |
| G38-04 | 人机协作审批工作流 | 3-4 天 |
| G38-05 | Agent Marketplace（社区共享 Agent 模板） | 3-4 天 |

**对标产品**：
- LangGraph (LangChain)
- AutoGen (Microsoft)
- CrewAI
- MemGPT (Letta)

**风险评估**：中（需要 LLM 推理算力）

---

## 三、推荐方向论证

**为什么推荐方向 A（MCP 协议深度集成）**：

1. **技术契合度最高**
   - Cycle 37 G37-02 已有 MCPExecutor 占位实现
   - 现有 ToolRegistry 架构可平滑升级
   - ProtocolConverter 已支持 OpenAI/Anthropic 双向

2. **生态价值最大**
   - 一次集成 1000+ MCP Server
   - 降低自建工具维护成本
   - 与 Cursor / Cline 等主流工具互通

3. **商业化路径清晰**
   - 企业用户对标准化工具集成需求强烈
   - MCP 协议已被 Anthropic / OpenAI / Google 等采纳
   - 国内大厂（阿里云 / 字节跳动）也在跟进

4. **风险最低**
   - 技术栈成熟（TypeScript SDK 完善）
   - 协议规范清晰（官方文档详尽）
   - 社区活跃（GitHub 10k+ stars）

---

## 四、任务节奏建议

| 选项 | 规模 | 适用场景 |
|------|------|---------|
| A | 维持 3 大 P0 | 资源有限，追求深度 |
| B | 扩展到 4 大 P0 | 资源充足（推荐） |
| C | 缩减到 2 大 P0 | 资源紧张或风险规避 |

**推荐 B（4 大 P0）**：聚焦 MCP 传输层 + 工具发现 + 内置 Server + 权限沙箱

---

## 五、API 接入建议

| Provider | 用途 | 必要性 |
|----------|------|--------|
| DeepSeek | LLM 推理（成本最低） | 已接入 |
| 火山方舟 Coding Plan | LLM 推理（中文优化） | 已接入 |
| MCP 官方 Registry | Server 发现 | 推荐 |
| GitHub API | MCP Server 远程安装 | 推荐 |

---

## 六、用户确认问题

请确认 Cycle 38 的调研方向和任务节奏：

1. **调研方向**：
   - A. MCP 协议深度集成（推荐）⭐⭐⭐⭐⭐
   - B. RAG 增强 + 多模态检索
   - C. Agent Loop 高级能力

2. **任务节奏**：
   - A. 维持 3 大 P0
   - B. 扩展到 4 大 P0（推荐）
   - C. 缩减到 2 大 P0

3. **API 接入**：
   - A. 维持 DeepSeek + 火山方舟（推荐）
   - B. 增加 OpenAI / Anthropic（成本上升）
   - C. 缩减到仅 Mock（无真实 LLM）

---

**Cycle 38 准备就绪，等待用户确认方向** 🚀
