# CYCLE38 启动文档

> 周期：Cycle 38  
> 启动日期：2026-07-31  
> 主题：**Agent Loop 高级能力（方向 C）**  
> 任务规模：**4 大 P0**  
> API 策略：**维持 DeepSeek + 火山方舟**  
> 状态：**已确认 ✅**

---

## 一、方向确认

✅ **调研方向**：C. Agent Loop 高级能力  
✅ **任务节奏**：B. 扩展到 4 大 P0（推荐）  
✅ **API 接入**：A. 维持 DeepSeek + 火山方舟（推荐）  

---

## 二、4 大 P0 任务清单

### G38-01：多 Agent 协作（Manager-Worker 模式）

**目标**：实现 Manager Agent 协调多个 Worker Agent 并行/串行协作完成复杂任务

**核心能力**：
- **Manager Agent**：负责任务分解、Worker 调度、结果汇总
- **Worker Pool**：多个 Worker Agent 并行执行子任务
- **任务路由**：基于任务类型 / 能力匹配路由到合适的 Worker
- **结果融合**：多 Worker 输出结果融合为最终结果
- **失败重试**：单 Worker 失败不影响整体，可单独重试
- **消息总线**：Manager 与 Worker 之间基于消息传递

**对标产品**：
- AutoGen (Microsoft) - GroupChat 模式
- LangGraph - Supervisor 模式
- CrewAI - Crew 协作模式

**关键文件**：
- `frontend/src/utils/multiAgentEngine.ts`
- `frontend/src/utils/multiAgentEngine.test.ts`

### G38-02：长期记忆（MemGPT 风格分层存储）

**目标**：实现 MemGPT 风格的分层记忆系统（核心记忆 + 回忆记忆 + 归档记忆）

**核心能力**：
- **核心记忆（Core Memory）**：当前会话关键信息（用户偏好、当前目标）
- **回忆记忆（Recall Memory）**：近期对话历史（可全文检索）
- **归档记忆（Archive Memory）**：长期历史（向量化后语义检索）
- **记忆衰减**：基于时间/相关性自动衰减重要性分数
- **记忆整合**：定期将分散记忆合并为高级抽象
- **记忆索引**：基于 RAG 的语义检索（复用 Cycle 37 RAG 引擎）

**对标产品**：
- MemGPT (Letta)
- LangChain Memory
- Zep (企业级长期记忆)

**关键文件**：
- `frontend/src/utils/longTermMemory.ts`
- `frontend/src/utils/longTermMemory.test.ts`

### G38-03：反思与自我修正（Reflexion 模式）

**目标**：实现 Reflexion 风格的 Agent 自我反思与迭代修正能力

**核心能力**：
- **执行评估**：执行完成后自动评估结果质量
- **反思生成**：基于执行轨迹生成反思（成功经验 + 失败教训）
- **策略调整**：基于反思调整下一步策略
- **记忆更新**：将反思存入长期记忆
- **迭代终止**：基于质量阈值 / 最大迭代次数自动终止
- **决策可解释**：每轮迭代记录决策依据

**对标产品**：
- Reflexion (Stanford NLP)
- Self-Refine (MIT)
- CRITIC (大型语言模型自我批评)

**关键文件**：
- `frontend/src/utils/reflectionEngine.ts`
- `frontend/src/utils/reflectionEngine.test.ts`

### G38-04：人机协作审批工作流

**目标**：实现危险操作前的人工审批机制，确保关键决策可追溯、可中断

**核心能力**：
- **风险分级**：自动评估操作风险等级（safe / moderate / dangerous / critical）
- **审批策略**：基于风险等级自动路由审批人（用户 / 管理员 / 安全官）
- **审批队列**：待审批操作排队展示，支持批量审批
- **审批日志**：完整记录审批决策（who/when/why）
- **审批超时**：超过 N 分钟自动降级或拒绝
- **审批回调**：审批结果异步通知 Agent 继续执行

**对标产品**：
- Salesforce Flow Approvals
- ServiceNow Approval Engine
- Microsoft Power Automate Approvals

**关键文件**：
- `frontend/src/utils/humanApprovalEngine.ts`
- `frontend/src/utils/humanApprovalEngine.test.ts`

---
