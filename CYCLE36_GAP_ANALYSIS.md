# CYCLE 36 差距分析报告

## 分析时间
- 2026-07-31
- 基础: CYCLE36_CODEX_TRAE_RESEARCH.md

---

## 一、当前能力盘点

### 1.1 Cycle 35 已交付（智能体协作 + 任务编排）
| 引擎 | 能力 | 限制 |
|------|------|------|
| WorkflowOrchestratorEngine | DAG 工作流编排 | Mock 节点执行器 |
| AgentCommunicationEngine | A2A + Pub/Sub | Mock 消息内容 |
| TaskCheckpointEngine | 快照/Time Travel | 仅文本状态 |
| AgentSchedulerEngine | 4 调度策略 | Mock 任务执行 |

### 1.2 前置周期能力
- **Cycle 30**: 编排多代理 + 动态工作流 + 成本阈值
- **Cycle 31**: 成本归因 + 远程 Worktree + 同步
- **Cycle 32**: 审计追踪 + SSO + 策略引擎
- **Cycle 33**: 企业工作流 + 集成 Dashboard + 安全审计
- **Cycle 34**: 端云模型路由 + 离线优先 + 设备集群

### 1.3 共性短板
1. **无真实 LLM 接入**: 所有 LLM 相关功能均为 Mock
2. **无流式响应**: 文本输出非实时
3. **无多模态**: 仅支持纯文本输入
4. **无 Provider 抽象**: 业务代码与具体 SDK 耦合

---

## 二、目标能力差距

### 2.1 差距矩阵

| 能力 | 当前状态 | 目标状态 | 差距 |
|------|----------|----------|------|
| LLM Provider 接入 | ❌ 无 | ✅ 3+ Provider | 需 G36-01 |
| 流式响应 | ❌ 无 | ✅ SSE 流式 | 需 G36-02 |
| 多模态输入 | ❌ 无 | ✅ 图/音/文件 | 需 G36-03 |
| Token 计数 | ❌ 无 | ✅ 实时计数 | 需 G36-01 |
| 成本计算 | ❌ 无 | ✅ 自动计算 | 需 G36-01 |
| 错误重试 | ❌ 无 | ✅ 指数退避 | 需 G36-01 |
| 速率限制 | ⚠️ 部分 | ✅ 自动排队 | 需 G36-01 |

### 2.2 业务影响
1. **无法真实运行**: 所有工作流/智能体演示都是 Mock
2. **用户体验差**: 无流式输出，LLM 体验缺失
3. **应用范围窄**: 仅支持文本，缺少现代 LLM 关键能力
4. **成本不可控**: 真实使用成本无法预估

---

## 三、补充设计

### 3.1 G36-01: LLM Provider Adapter
**目标**: 统一抽象层，支持 Anthropic / OpenAI / Ollama / Mock

**核心交付**:
- LLMProvider 接口
- 4 个 Provider 实现
- 消息格式转换
- Token 计数与成本计算
- 错误重试与速率限制
- Mock Provider（测试用）

**优先级**: P0（关键基础）

### 3.2 G36-02: Streaming Response Engine
**目标**: 流式响应管理 + UI 实时渲染

**核心交付**:
- SSE 流解析
- AsyncIterable 包装
- 流式进度回调
- 错误恢复
- 浏览器侧消费
- 打字机 UI 集成

**优先级**: P0（体验关键）

### 3.3 G36-03: Multi-Modal Processor
**目标**: 图像/语音/文件多模态处理

**核心交付**:
- 图像预处理（缩放/base64）
- Web Speech API 语音转录
- 文件解析（PDF/DOCX/MD）
- 多模态融合
- 上传 UI 集成

**优先级**: P1（增强能力）

---

## 四、与现有引擎的协同

### 4.1 WorkflowOrchestratorEngine
- **改造点**: `llm` 节点执行器使用 LLMProviderAdapter
- **新增能力**: 节点执行流式回调、Token 预算
- **预期收益**: 工作流可真实调用 LLM

### 4.2 AgentCommunicationEngine
- **改造点**: Agent 消息携带 LLM 响应
- **新增能力**: 流式消息推送
- **预期收益**: 智能体可真实协作

### 4.3 TaskCheckpointEngine
- **改造点**: LLM 对话快照、Token 用量记录
- **新增能力**: 对话历史 Time Travel
- **预期收益**: 对话状态可追溯

### 4.4 AgentSchedulerEngine
- **改造点**: LLM 任务按 Token 预算调度
- **新增能力**: 速率限制自动排队
- **预期收益**: 真实任务调度

---

## 五、UI 缺口

### 5.1 当前 UI 现状
- ✅ 4 大引擎有对应 UI 面板
- ✅ 主应用集成完成
- ❌ 无 Provider 配置 UI
- ❌ 无流式响应 UI
- ❌ 无多模态上传 UI

### 5.2 新增 UI 需求
1. **LLM Provider Panel**: Provider 配置、模型选择、连接测试
2. **Streaming Chat Panel**: 流式响应可视化、Token 用量
3. **Multi-Modal Upload Panel**: 图像/语音/文件上传

---

## 六、技术债务清理

### 6.1 新增技术债务
- **API Key 管理**: 需要安全存储方案
- **流式状态**: 大量状态需有效管理
- **错误处理**: 网络错误需用户友好提示

### 6.2 不引入新债务
- ✅ 不破坏现有引擎 API
- ✅ 不修改现有 UI 组件
- ✅ 仅扩展能力，不重构

---

## 七、风险与缓解

### 7.1 风险清单
| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| CORS 限制 | 高 | 高 | Mock Provider + 文档说明 |
| API Key 泄露 | 中 | 高 | localStorage 加密 + 提示 |
| 速率限制 | 中 | 中 | 自动重试 + 队列 |
| 流式中断 | 中 | 中 | AbortController |
| 成本失控 | 低 | 高 | Token 预算 |

### 7.2 缓解策略
- 提供 Mock Provider 模式（开发环境）
- 提供完整的配置文档
- 提供成本监控 UI
- 实施 Token 预算硬限制

---

## 八、验收标准

### 8.1 引擎层面
- ✅ 3 大新引擎实现完成
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ Mock Provider 可用（无网络环境）
- ✅ 至少 2 个真实 Provider

### 8.2 UI 层面
- ✅ 3 大 UI 面板
- ✅ Provider 配置 UI
- ✅ 流式响应 UI
- ✅ 多模态上传 UI

### 8.3 集成层面
- ✅ 与现有 4 引擎协同
- ✅ 主应用菜单新增 3 项
- ✅ AppLayout/App.tsx 集成

### 8.4 质量层面
- ✅ TypeScript 严格模式 0 错误
- ✅ 全量测试 100% 通过
- ✅ 至少 100 个新测试

---

## 九、结论

### 9.1 必要性
- **真实 LLM 集成是项目核心**: Mock 状态无法体现项目价值
- **流式是现代 LLM 标配**: 缺流式等于缺核心体验
- **多模态是趋势**: 文本 only 已落后

### 9.2 可行性
- ✅ 3 大 Provider SDK 均成熟
- ✅ TypeScript 流式生态完善
- ✅ Web Speech API 浏览器内置

### 9.3 推荐
**立即启动 G36-01 + G36-02 + G36-03 三引擎开发**
