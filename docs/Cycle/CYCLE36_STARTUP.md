# CYCLE 36 启动文档

## 周期信息
- **周期编号**: Cycle 36
- **启动时间**: 2026-07-31
- **前序周期**: Cycle 35（智能体协作 + 任务编排）
- **目标**: 在 Cycle 35 基础上接入真实 LLM 能力,深化端到端任务执行

---

## 一、Cycle 35 回顾

### 1.1 已完成能力
- ✅ WorkflowOrchestratorEngine（DAG 工作流编排）
- ✅ AgentCommunicationEngine（智能体通信 + Pub/Sub）
- ✅ TaskCheckpointEngine（快照/Time Travel/Diff）
- ✅ AgentSchedulerEngine（多策略任务调度）
- ✅ 4 大 UI 面板 + 主应用集成
- ✅ 4688 tests passing / 0 TS errors
- ✅ Git commit: 96168f2

### 1.2 已具备基础
- DAG 工作流定义 + 6 节点类型 + 4 边类型
- A2A 协议 + Pub/Sub 通信
- 完整/增量快照 + 分支 + 标签
- FIFO/Priority/WFQ/MLFQ 调度

### 1.3 仍可深化
- 真实 LLM Provider 集成（Ollama / Anthropic / OpenAI）
- 工作流引擎的真实 LLM 节点执行
- 智能体通信的实际 LLM 调用
- 真实多模态支持（图像/语音/文件）
- 端到端任务流可视化
- 真实持久化（IndexedDB）
- 模型评测与对比（A/B Testing）

---

## 二、调研方向（三选一）

### 方向 A：真实 LLM 集成（推荐）

**主题**: Real LLM Provider + End-to-End Task Execution

**核心议题**:
1. **LLM Provider 适配**: Anthropic SDK / OpenAI SDK / Ollama 本地
2. **多模态支持**: 图像理解/语音转录/文件解析
3. **流式响应**: SSE / WebSocket 流式输出
4. **工具调用**: Function Calling / Tool Use 协议
5. **Token 预算**: 实时计数 + 超限降级

**候选功能**:
- G36-01: LLM Provider Adapter (Anthropic/OpenAI/Ollama)
- G36-02: Streaming Response Engine (SSE/WebSocket)
- G36-03: Multi-Modal Processor (Image/Audio/File)

### 方向 B：持久化升级

**主题**: IndexedDB + CRDT + Sync

**核心议题**:
1. **IndexedDB 适配**: 替代 localStorage 解决容量限制
2. **CRDT 升级**: Yjs 集成实现真正的实时协同
3. **增量同步**: 差分算法 + 冲突解决
4. **数据迁移**: 从 localStorage 无缝迁移到 IndexedDB

**候选功能**:
- G36-01: IndexedDB Storage Layer
- G36-02: Yjs CRDT Integration
- G36-03: Sync Conflict Resolver

### 方向 C：端到端任务流

**主题**: Workflow + LLM + Real Execution

**核心议题**:
1. **真实 LLM 节点**: 替换 Mock 执行器为真实 LLM
2. **工具链集成**: 调用外部 API / 数据库 / 文件系统
3. **人类反馈**: HITL（Human-in-the-Loop）节点
4. **可视化**: 实时执行状态 + Token 用量

**候选功能**:
- G36-01: Real LLM Executor
- G36-02: Tool Chain Adapter
- G36-03: HITL Feedback Node

---

## 三、推荐：方向 A 详细规划

### G36-01: LLM Provider Adapter
- **核心**: 统一 Anthropic / OpenAI / Ollama 接口
- **能力**: 
  - 消息格式转换
  - Token 计数
  - 错误重试
  - 速率限制
  - 成本计算
- **API**: 
  - `chat(messages, options)` 
  - `stream(messages, options) -> AsyncIterator`
  - `countTokens(text)`
  - `listModels()`

### G36-02: Streaming Response Engine
- **核心**: SSE/WebSocket 流式响应管理
- **能力**:
  - 流解析（SSE chunk / WebSocket frame）
  - 增量 UI 更新
  - 中断控制
  - 速率自适应
  - 错误恢复
- **API**:
  - `createStream(provider, messages)`
  - `cancel(streamId)`
  - `pause(streamId)` / `resume(streamId)`

### G36-03: Multi-Modal Processor
- **核心**: 图像/语音/文件的解析与处理
- **能力**:
  - 图像上传 + 预览 + base64 转换
  - 语音录制 + 转录（Web Speech API）
  - 文件解析（PDF/DOCX/MD/TXT）
  - 多模态融合（图像+文本+语音）
- **API**:
  - `processImage(file)`
  - `transcribeAudio(blob)`
  - `parseDocument(file)`
  - `fuseModalities(items)`

---

## 四、验收标准

### 4.1 引擎层面
- 3 大引擎（Provider/Stream/MultiModal）均实现
- 单元测试覆盖率 ≥ 80%
- 至少 2 个真实 Provider（Anthropic + Ollama）
- 真实流式响应可工作

### 4.2 UI 层面
- 3 大 UI 面板（LLM/Stream/MultiModal）
- Provider 配置 UI（API Key / Endpoint）
- 流式响应可视化（打字机效果）
- 多模态上传 UI

### 4.3 集成层面
- WorkflowOrchestratorEngine 集成 LLM 节点
- AgentCommunicationEngine 集成真实 LLM 调用
- 主应用菜单新增 3 项
- AppLayout/App.tsx 集成 3 面板

### 4.4 质量层面
- TypeScript 严格模式 0 错误
- 全量测试 100% 通过
- 至少 100 个新测试

---

## 五、任务规划

### 5.1 Phase 1: 调研
- 真实 LLM Provider 文档调研
- 流式响应协议对比
- 多模态 API 对比

### 5.2 Phase 2: 差距分析 + SPEC
- 现有引擎对接 LLM 能力差距
- 3 份 SPEC 文档

### 5.3 Phase 3: 核心引擎 + 测试
- G36-01 LLM Provider Adapter
- G36-02 Streaming Response Engine
- G36-03 Multi-Modal Processor

### 5.4 Phase 4: UI 面板 + 集成
- 3 大 UI 面板
- 主应用集成

### 5.5 Phase 5: 测试 + 验证
- TypeScript 严格模式
- 全量测试

### 5.6 Phase 6: 验收 + 提交
- 验收报告
- Git 提交
- CYCLE37 启动

---

## 六、风险评估

### 6.1 技术风险
- **API Key 管理**: 需要安全的本地存储方案
- **速率限制**: Provider 速率限制导致 UI 卡顿
- **CORS**: 浏览器直连 LLM API 的 CORS 限制（需 Proxy）
- **成本**: 真实 API 调用产生成本,需 Token 预算

### 6.2 缓解措施
- 使用环境变量 + 后端代理避免 CORS
- 实施指数退避重试
- 实施 Token 预算实时监控
- 提供 Mock Provider 模式（开发/测试环境）

---

## 七、启动检查清单

- [x] Cycle 35 全部任务完成
- [x] 4 大核心引擎 + UI 集成完成
- [x] 4688 测试通过
- [x] TypeScript 0 错误
- [x] Git commit 完成
- [x] 启动文档编写完成
- [ ] 用户确认方向 A
- [ ] 用户确认主推方向

---

## 八、联系方式

- **Workspace**: /home/qizheng/auto_code_ws
- **Frontend**: /home/qizheng/auto_code_ws/frontend
- **主分支**: loop/plan-1785219053
- **最新 commit**: 96168f2
