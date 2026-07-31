# Cycle 14 研究报告 - Codex 26.415/0.145+ 自进化 + Orchestrated Multi-Agent + TRAE Enterprise/Work 2.0

> **周期**: Cycle 14
> **研究时间**: 2026-07-28
> **对比基准**: Hermes v6.25.0 vs OpenAI Codex 26.415 (rust-v0.145.0/0.150.0+) / Orchestrated Multi-Agent PoC #32100 / TRAE v3.5.79+/v0.1.39/TRAE Enterprise
> **目的**: 深入研究 Codex 自进化机制 (Proactive Memory + Thread Automations + Computer Use)、Orchestrated Multi-Agent 阶段合约、Enterprise Plugin Hub 90+ 插件、TRAE Worktree/Video/Voice/Design Mode，识别 Hermes 在自进化智能体、多模态、企业级 Plugin Hub 方面的关键差距

---

## 一、研究背景

经过 Cycle 1-13 的 13 轮迭代，Hermes 已实现 v6.25.0：

- **Loop Engineering v7 + 6 状态 Goal 状态机**（P1-4 / Cycle 12 P0-2）
- **Verification Loop + LLM-as-Judge 验证层**（5 维度评分 + 多 Judge 共识 + Safety 一票否决）
- **Memory System (P1-8)** Dual-Track Persistent Memory
- **Plugin 系统 + Marketplace**（8 模块 + 12 端点 + 2 示例 Plugin + 远端仓库）
- **Worktree v2 隔离执行**（6 模块 + 18 端点 + 7 状态机 + 4 冲突解决策略）
- **Hermes Python/TypeScript SDK**（Python 7 模块 + TS 完整 SDK + 后端 7 端点）
- **Three-File Trust 架构**（GOAL.md / VERIFY.md / PROGRESS.md）
- **DiffView / Multi-Agent v2 Path Tree / TRACE Correction→Enforcement / 6 大能力域**
- **.trae/{skills, agents, commands, rules, hooks}/ + 9 知识域管理**

但与 OpenAI 最新 Codex 26.415（rust-v0.145.0/0.150.0+）+ Orchestrated Multi-Agent PoC #32100 + TRAE Enterprise/Work 2.0 相比，仍存在以下关键差距：

| 差距编号 | 功能 | 来源 | 状态 |
| --- | --- | --- | --- |
| **P0-1** | **Hermes Agent v2 自进化智能体**（Proactive Memory + Thread Automations + Self-Directing） | Codex 26.415 / v0.121.0+ | ❌ 缺失（Memory 仅 Dual-Track，无主动唤醒） |
| **P0-2** | **多模态支持**（Vision/Audio/Video 输入输出 + 实时 V3 对话） | Codex v0.145.0 + TRAE v0.1.39 | ❌ 缺失（仅文本消息） |
| **P0-3** | **企业级 Plugin Hub**（90+ 插件 + Productivity Dashboard + Cost Control + SOC2） | OpenAI Codex for (almost) everything 2026-04 + TRAE Enterprise | ❌ 缺失（仅自建 Marketplace） |
| **P1-1** | **Orchestrated Multi-Agent 阶段合约**（Phase Contract + Role Attribution + Revision Budget） | Codex PoC #32100 | ❌ 缺失（无阶段化合约 + 角色归属） |
| **P1-2** | **Auto-Compaction 引擎**（Codex v0.142 / MiniCode 7 阶段流水线） | Codex v0.142 / TRAE 上下文压缩 | ❌ 缺失（无自动压缩） |
| **P1-3** | **TRAE Work 多模态协作**（Design Mode + Voice Chat + Global Memory + Video Generation） | TRAE v0.1.21-v0.1.39 | ❌ 缺失（无 Voice/Video/Design） |
| **P1-4** | **Goal auto-turn + 多 Agent 委派策略**（per-turn delegation selection + bounded mode context） | Codex v0.142.0 / Orchestrated PoC | ❌ 缺失（无 auto-turn） |

本轮研究目的：深入研究 Codex 26.415 自进化机制、Orchestrated Multi-Agent 阶段合约、企业级 Plugin Hub 生态、TRAE Worktree + Voice + Video + Design Mode 详细实现细节，为 Cycle 14 实现提供技术基础。

---

## 二、Codex 26.415 / rust-v0.145.0+ 关键演进时间线

| 版本 | 时间 | 关键变化 |
| --- | --- | --- |
| Codex v0.121.0 | 2026-02 | Proactive Memory 预览 + Thread Automations 引入 |
| Codex 26.415 (v0.121.0) | 2026-04-16 | Background computer use + In-app browser + GPT-image-1.5 + 90+ plugins + Memory preview + Thread automations + Proactive suggestions |
| Codex rust-v0.142.0 | 2026-06-22 | Plugin Discovery 三层目录 + Rollout Token Budget + 多 Agent 委派模式（disabled/explicit-only/proactive）+ indexed web-search |
| Codex rust-v0.145.0 | 2026-07-21 | 实验性分页对话历史 + /import 扩展（Cursor + Claude Code）+ Amazon Bedrock + 音频输入输出 + 流式实时 V3 对话 + Multi-agent V2 稳定化 |
| Codex rust-v0.150.0+ | 2026-07-28 | Multi-agent v2 keeps runtime choice with each thread + cleaner follow-up and metadata defaults for spawned agents |
| Orchestrated PoC #32100 | 2026-07-10 | True native orchestrated mode + phase contracts + tool boundaries + bounded packets + proportional routing + approval gates + revision limits + inherited mode behavior + role attribution |

---

## 三、Codex 26.415 核心特性深度研究

### 3.1 Proactive Memory 自进化机制

#### 3.1.1 三层记忆体系

**来源**：[OpenAI Codex for (almost) everything](https://openai.com/index/codex-for-almost-everything/) 2026-04-16 / [Daniel Vaughan: From Reactive to Proactive](https://codex.danielvaughan.com/2026/04/16/codex-proactive-memory-thread-automations-self-directing-agents/) 2026-04-16

**存储位置**：`~/.codex/memories/`（可通过 `CODEX_HOME` 配置）

**记忆类型**：
1. **Summaries**：会话结束时的摘要
2. **Durable entries**：长期持久化的关键信息
3. **Recent inputs**：最近输入的临时记忆
4. **Supporting evidence**：来自之前 thread 的支持证据

**生成机制**：
- 用户偏好（personal preferences）
- 重复模式（recurring patterns）
- 之前的纠错（previous corrections）
- 累积的上下文（accumulated context）

**生命周期**：
```
创建 → 验证 → 持久化 → 主动召回 → 跨会话复用
 ↓       ↓        ↓         ↓           ↓
用户   LLM 评估  JSON 文件  语义检索   新会话注入
输入    质量      + 索引
```

#### 3.1.2 Thread Automations 心跳式循环

**来源**：[OpenAI: Thread-based automations](https://codex.danielvaughan.com/2026/04/17/thread-automation-recipes-scheduled-agent-patterns/) 2026-04-17

**核心能力**：
- **Schedule future work**：调度未来的工作
- **Wake up automatically**：自动唤醒继续任务
- **Across days or weeks**：跨天/跨周的长时任务
- **Preserving context**：保留之前 thread 的上下文

**应用场景**：
- 自动跟踪 PR（Open Pull Requests）
- 跟进 Slack 通知
- 监控 Notion 任务
- 定时运行测试套件

#### 3.1.3 Proactive Suggestions 主动建议

**核心能力**：
- **Context-aware suggestions**：基于上下文的建议
- **Project context** + **connected plugins** + **accumulated memory** 综合决策
- **Propose useful follow-ups**：建议有用的后续任务
- **Carry work forward**：把工作继续推进

### 3.2 Background Computer Use 计算机自主操作

**来源**：[OpenAI Codex for (almost) everything](https://openai.com/index/codex-for-almost-everything/) 2026-04-16

**核心能力**：
- **Operating system-level autonomy**：操作系统级自主性
- **Background autonomous cursor**：后台自主光标
- **Multiple agents in parallel**：多 Agent 并行执行
- **macOS 首发**：macOS 优先（Seatbelt 沙箱）
- **No interference with user work**：不干扰用户工作

**技术实现**：
- **In-app browser**：内置浏览器，可截图 + 注释
- **Click & type via cursor**：通过光标点击和输入
- **Multiple parallel agents**：多 Agent 并行
- **Background tasks**：后台任务（不抢占主线程）

**应用场景**：
- **Iterating on frontend changes**：迭代前端变更
- **Testing apps**：测试应用
- **Apps without API**：无 API 的应用（GUI 自动化）
- **Managing JIRA tickets**：JIRA 工单管理
- **Frontend design review**：前端设计审查

### 3.3 Plugin Ecosystem 90+ 插件

**来源**：[OpenAI: Extended plugin ecosystem](https://openai.com/index/codex-for-almost-everything/) 2026-04-16

**插件类型**：
- **Skills**：技能（提示词增强）
- **App integrations**：应用集成
- **MCP servers**：MCP 服务器

**90+ 官方插件示例**：
- **Atlassian Rovo**：JIRA 管理
- **CircleCI**：CI/CD
- **CodeRabbit**：代码审查
- **GitLab Issues**：GitLab Issue 管理
- **Microsoft Suite**：Office 集成
- **Neon by Databricks**：数据库
- **Remotion**：视频生成
- **Render**：部署
- **Superpowers**：增强能力

**插件市场结构**：
```
┌─────────────────────────────────────┐
│ Official Layer (90+ 官方)            │
├─────────────────────────────────────┤
│ Community Layer (社区贡献)           │
├─────────────────────────────────────┤
│ Local Layer (本地自定义)             │
└─────────────────────────────────────┘
```

### 3.4 GPT-image-1.5 多模态图像生成

**核心能力**：
- **Generate & iterate on images**：生成和迭代图像
- **Screenshots + code combined**：截图 + 代码结合
- **Product concepts**：产品概念图
- **Frontend designs**：前端设计图
- **Mockups**：模型
- **Game assets**：游戏资产

### 3.5 SDLC 全流程支持

**新增能力**：
- **GitHub review comments**：处理 GitHub 审查评论
- **Multiple terminal tabs**：多终端 Tab
- **Remote devboxes over SSH**：SSH 连接远程开发机（alpha）
- **PDF/spreadsheet/slides/docs preview**：侧边栏预览
- **Summary pane**：摘要面板（计划 + 来源 + 工件）

---

## 四、Orchestrated Multi-Agent 阶段合约（PoC #32100）

**来源**：[GitHub: Orchestrated multi-agent mode PoC #32100](https://github.com/openai/codex/issues/32100) 2026-07-10

### 4.1 设计动机

**现有 Multi-Agent 不足**：
- ❌ 仅决定是否委派，不定义完整工作流
- ❌ 缺少"实施前需要哪些证据"的定义
- ❌ 缺少角色所有权（mutate vs verify）
- ❌ 缺少"重要计划如何批准"机制
- ❌ 缺少"如何处理不完整/畸形/未验证的 Worker 结果"
- ❌ 缺少"小范围后续操作如何避免冗余模型调用"
- ❌ 缺少"递归编排防护"机制

### 4.2 编排流程图

```
User turn
   ↓
Task Contract ← 决定 Direct 还是 Reviewed
   ↓
[Direct: 范围窄且已有证据]
   ↓
Worker execution
   ├─ Packet 完整且 worker: complete → Short root completion
   └─ Packet 畸形/截断/incomplete → Worker revision (有预算时)
        ↓ Retry budget 耗尽
        Short root failure: report remaining corrections
   ↓
[Reviewed: 重要、不确定、或 Direct 被截断]
   ↓
Read-only Explorer (Bounded evidence packet)
   ├─ 有未回答的关键问题 → Targeted Plan Evidence
   └─ 无未回答问题 → Worker Plan
   ↓
Plan Review
   ├─ Plan 需修正 → Plan revision (有预算时)
   ├─ Plan 被拒绝且 budget 耗尽 → Short root failure: plan not approved
   └─ Plan 批准 → Worker execution
        ↓
   Result Review
   ├─ 修订/invalid review/截断/worker incomplete → Worker revision
   └─ Approved and worker complete → Short root synthesis
        ↓
   Final response
```

### 4.3 阶段合约（Phase Contracts）

**Direct 合约（窄范围 + 已有证据）**：
- **适用场景**：小范围修正（如已识别的文档错误）
- **流程**：Task Contract → Worker execution → Short root completion
- **避免**：冗余的探索、规划、结果审查

**Reviewed 合约（重要 + 不确定 + 范围大）**：
- **适用场景**：新功能、复杂修改、未知问题
- **流程**：Explorer → Plan → Plan Review → Worker → Result Review → Synthesis
- **保证**：完整的安全工作流 + 显式的批准关卡

### 4.4 角色归属（Role Attribution）

**核心角色**：
| 角色 | 权限 | 职责 |
| --- | --- | --- |
| **Root Orchestrator** | 全部 | 协调决策 + 短最终综合 |
| **Explorer** | Read-only | 代码探索 + 收集证据 |
| **Worker** | Mutation + Verification | 实施 + 验证 |
| **Plan Reviewer** | Read-only | 计划审查 + 批准 |
| **Result Reviewer** | Read-only | 结果审查 + 验证 |

**强制约束**：
- **Explorer 始终 read-only**：即使父 turn 有完整文件系统权限
- **Worker 拥有 mutation**：实施和验证
- **Worker 拥有的工具历史上限**：避免递归编排

### 4.5 Bounded Packets（边界数据包）

**目标**：限制内部工具历史进入 model-visible 上下文的大小

**实现**：
- **Direct contract**：最新 packet 非截断
- **Reviewed contract**：Bounded evidence packet
- **Malformed/truncated handling**：直接返回 Worker 而不消耗 Result Review 预算

### 4.6 Revision Budget（修订预算）

**目标**：防止无限循环

**实现**：
- **Plan revision budget**：N 次
- **Worker revision budget**：M 次
- **Budget exhausted**：Short root failure: report remaining corrections

### 4.7 Approval Gates（批准关卡）

**Reviewed contract 必须的批准**：
- **Plan approval**：实施前的计划批准
- **Result approval**：完成后的结果批准

**Direct contract 隐式批准**：
- 严格边界 + 已有证据 = 隐式批准
- 无需用户介入

### 4.8 Inherited Mode Behavior（继承模式行为）

**核心约束**：
- **Worker 继承父模式**：Worker 不会运行子编排
- **Recursive guard**：防止内嵌 Orchestrated mode
- **Single orchestration per turn**：每个 turn 只有一个编排

---

## 五、TRAE Enterprise + TRAE Work 2.0 深度研究

### 5.1 TRAE Enterprise 企业级能力

**来源**：[TRAE Enterprise](https://www.trae.ai/enterprise) 2026-07 / [TRAE Enterprise Overview (BytePlus)](https://docs.byteplus.com/ko/docs/trae/trae-enterprise-overview)

#### 5.1.1 Enterprise-Grade Performance

- **Massive Repo Indexing**：索引 100K 文件 + 150M 行代码
- **Real-time incremental updates**：实时增量更新
- **Dedicated enterprise GPU clusters**：专用企业 GPU 集群
- **Low-latency response**：低延迟响应
- **High concurrency**：高并发
- **Long-Running Task Support**：长时任务支持
- **Multi-round tool calling**：多轮工具调用

#### 5.1.2 End-to-End Flexibility

- **Multi-Channel Access**：IDE + Plugin + CLI（即将推出）
- **Flexible Deployment**：SaaS + VPC（即将推出）
- **Multi-Model Support**：内置模型 + 自定义企业模型
- **Deep Customization**：企业规则 + 知识库 + Agent 配置
- **TRAE Plugin**：VS Code + JetBrains 集成
- **TRAE CLI**：自动化 + 批处理 + CI/CD 集成

#### 5.1.3 Full Visibility（无黑盒）

- **Productivity Dashboard**：生产力仪表盘
  - AI 代码生成率
  - AI 编写行数
  - 关键指标实时追踪
- **Cost Controls**：成本控制
  - 组织范围支出上限
  - 实时消费监控
- **Usage Transparency**：使用透明
  - 成员激活
  - 活动水平
  - 工具使用

#### 5.1.4 Security & Compliance

- **Zero Retention**：零留存
  - 加密传输
  - 不在服务器存储
- **No Model Training**：不训练模型
  - 代码不用于训练
  - 无日志留存
- **Access Controls**：访问控制
  - 基于角色
  - 防止未授权
- **Third-Party Certified**：第三方认证
  - **SOC 2 Type 2 认证**

### 5.2 TRAE Enterprise Management Console

**来源**：[BytePlus: TRAE Enterprise overview](https://docs.byteplus.com/ko/docs/trae/trae-enterprise-overview) 2026-06-17

**核心模块**：

| 模块 | 能力 |
| --- | --- |
| **Member & Seat Management** | 邀请成员、批量添加、移除、购买/取消席位 |
| **Usage Management** | 详细使用（基本/超出/资源包/按需付费） |
| **Data Analysis** | 用户数 + 活动趋势 + AI 代码率 + LLM 调用分布 + 编程语言分布 + MCP/Enterprise Agent 排行 |
| **Audit & Logs** | 管理员操作日志 + 内部审计 + 问题追踪 |

**企业专属配置**：
- **Enterprise Document Sets**：内部知识库
- **Enterprise Agents**：企业专属 AI 智能体（可重用资产）
- **Model Settings**：统一管理 TRAE 内置 + 企业内置模型
- **Security Policies**：保护代码资产（禁止 AI 访问敏感代码库）

### 5.3 TRAE Work 2.0 详细功能

**来源**：[TRAE Changelog](https://www.trae.ai/changelog) 2026-07-21

#### 5.3.1 SOLO → Work 重命名

- **2026-06-09 v0.1.18**：TRAE SOLO 重命名为 TRAE Work
- **2026-05-08 v3.5.55-56**：合并 Builder & Builder With MCP → Agent；合并 SOLO Builder & SOLO Coder → SOLO Agent
- **2026-05-08 v3.5.55-56**：`.trae/commands/` 支持 3 级目录嵌套

#### 5.3.2 Worktree 功能（2026-05-05 v0.1.8-0.1.9）

**核心能力**：
- **Isolated Git environments**：隔离的 Git 环境
- **Per-task dedicated directory**：每个任务专属目录
- **Exclusive files, dependencies, code changes**：独占文件/依赖/代码变更
- **Main workspace undisturbed**：主工作区不受干扰

#### 5.3.3 Voice Discussion 语音讨论（2026-05-05 v0.1.8-0.1.9）

**核心能力**：
- **Interactive voice conversations**：交互式语音对话
- **Collaborative scenarios**：协作场景
  - 需求设计
  - 问题分析
  - 想法头脑风暴
- **Voice input** + **Multi-device connectivity** + **Remote desktop control**

#### 5.3.4 Design Mode 设计模式（2026-06-24 v0.1.21-0.1.23）

**核心能力**：
- **All-in-one professional toolkit**：一站式专业工具包
- **Design workflows**：设计工作流
- **Generate design drafts**：生成设计草图
- **Batch edits via natural language**：自然语言批量编辑
- **Manage design systems**：管理设计系统
- **Export design to code**：设计导出代码

#### 5.3.5 Voice Chat Optimizations（2026-06-24 v0.1.21-0.1.23）

- **Enhanced web search**：增强 Web 搜索
- **Reference project-level context/memory**：引用项目级上下文/记忆

#### 5.3.6 Global Memory（2026-06-24 v0.1.21-0.1.23）

- **Retain context throughout all past interactions**：保留所有历史交互的上下文
- **Personalized knowledge base**：个性化知识库

#### 5.3.7 Video Generation（2026-07-21 v0.1.39）

- **TRAE Work Desktop & Web supports video generation**：支持视频生成
- **Security bug fixes**：安全修复

#### 5.3.8 移动端能力（2026-05-05 v0.1.8-0.1.9）

- **Voice input support**：语音输入
- **Multi-device connectivity**：多设备连接
- **Remote desktop control**：远程桌面控制
- **Real-time task progress monitoring**：实时任务进度监控

### 5.4 TRAE IDE Hooks 支持（2026-06-12 v3.5.66）

- **Hooks 配置入口**：Settings → Hooks
- **Agent Delete Tool 弃用警告**：删除文件进入回收站
- **File format subagent toggle**：文件格式子智能体切换

---

## 六、Codex rust-v0.145.0 / v0.150.0 关键特性

### 6.1 rust-v0.145.0（2026-07-21）

**来源**：[Linux Codex v0.145.0 安装](https://blog.csdn.net/qq_36462452/article/details/163221108) / [Codex Changelog](https://developers.openai.com/codex/changelog)

**实验性分页对话历史**：
- 高效恢复
- 搜索
- 持久化命名
- **子智能体支持**
- **记忆功能（memories）**

**跨工具导入迁移（/import 扩展）**：
- 从 Cursor 迁移
- 从 Claude Code 迁移
- 迁移内容：设置、MCP 服务器、插件、会话、命令、项目级记忆

**Amazon Bedrock 集成**：
- 实验性 Bedrock 登录
- 自定义端点
- 认证支持
- **默认模型：GPT-5.6 Sol**

**音频输入输出**：
- 常见本地音频格式作为输入
- 工具输出可包含音频
- **流式实时 V3 对话（streaming realtime V3 conversations）**

**多智能体 V2 稳定化**：
- 标记为 stable
- 可配置的子智能体模型
- 推理级别
- 并发数

**性能优化**：
- 增量 Markdown 渲染
- 减少 TUI 重绘
- 缓存历史记录
- 限制命令输出

**安全与稳定性**：
- 强制 `rm` 命令检测
- 一致的全量访问确认
- MCP 启动超时
- Windows 执行 + 沙箱可靠性
- 内置 ripgrep 15.2.0

### 6.2 rust-v0.150.0+（2026-07-28）

**来源**：[Codex Changelog](https://developers.openai.com/codex/changelog)

- **Multi-agent v2 keeps runtime choice with each thread**：运行时选择保留在每个 thread
- **Cleaner follow-up and metadata defaults for spawned agents**：清理 spawned agents 的 follow-up 和 metadata 默认值
- **Cancelling submitted prompt before visible output**：取消提交但无可见输出时恢复 draft + attachments + collaboration mode

---

## 七、差距分析与目标设计

### 7.1 P0-1 Hermes Agent v2 自进化智能体

#### 7.1.1 现状

Hermes Memory System (P1-8) 已实现 Dual-Track Persistent Memory，但缺少主动能力：
- ❌ 无 Thread Automations（无法自动唤醒）
- ❌ 无 Proactive Suggestions（无主动建议）
- ❌ 无 Background Tasks（无后台运行）
- ❌ 无 Computer Use（无 GUI 自动化）

#### 7.1.2 目标设计

**三层记忆增强**：
1. **Durable Layer**（已实现）：持久化关键信息
2. **Proactive Layer**（新增）：基于模式检测的主动建议
3. **Background Layer**（新增）：后台自动唤醒 + 心跳式循环

**Self-Directing 模式**：
- **Idle Auto-Turn**：空闲时自动检测待办
- **Proactive Suggestions**：基于上下文 + 插件 + 记忆的主动建议
- **Thread Automations**：定时/事件触发的自动化任务
- **Background Tasks**：不抢占主线程的后台任务

#### 7.1.3 验收标准

- [ ] 三层记忆体系（Durable + Proactive + Background）
- [ ] Proactive Suggestions 引擎
- [ ] Thread Automations 调度器
- [ ] 主动召回 API（语义检索）
- [ ] 40+ 单元测试

### 7.2 P0-2 多模态支持

#### 7.2.1 现状

Hermes 当前仅支持文本消息，无视觉/音频/视频能力。

#### 7.2.2 目标设计

**多模态输入**：
- **图像输入**（Vision）：截图 + 设计稿 + OCR
- **音频输入**（Audio）：语音消息 + 音频文件
- **视频输入**（Video）：视频帧提取

**多模态输出**：
- **图像生成**：通过 GPT-image-1.5 或类似 API
- **音频输出**：TTS 合成
- **视频生成**：通过 Remotion 或类似 API

**实时 V3 对话**：
- 流式实时音视频对话
- Voice Chat with Voice Activity Detection (VAD)
- 双向语音流

#### 7.2.3 验收标准

- [ ] 图像上传 + Vision 分析
- [ ] 音频上传 + ASR 转写
- [ ] 视频帧提取 + 摘要
- [ ] 图像生成 API
- [ ] TTS 合成 API
- [ ] 流式 V3 对话 WebSocket
- [ ] 30+ 单元测试

### 7.3 P0-3 企业级 Plugin Hub

#### 7.3.1 现状

Hermes 已实现 Plugin 系统 + Marketplace，但缺少：
- ❌ 无企业级管理控制台
- ❌ 无 Productivity Dashboard
- ❌ 无 Cost Controls
- ❌ 无 SOC 2 认证级别安全
- ❌ 无 Enterprise Agents

#### 7.3.2 目标设计

**企业级 Plugin Hub**：
- **三层架构**：Official (90+) + Community + Local
- **Enterprise Management Console**：
  - Member & Seat Management
  - Usage Management
  - Data Analysis Dashboard
  - Audit & Logs
- **Productivity Dashboard**：
  - AI 代码生成率
  - AI 编写行数
  - 关键指标实时
- **Cost Controls**：
  - 组织范围支出上限
  - 实时消费监控
- **Security Policies**：
  - 禁止 AI 访问敏感代码库
  - 角色访问控制
  - 审计日志

#### 7.3.3 验收标准

- [ ] 三层 Plugin Hub（Official 90+ + Community + Local）
- [ ] Enterprise Management Console（4 模块）
- [ ] Productivity Dashboard
- [ ] Cost Controls
- [ ] Security Policies
- [ ] Audit Logs
- [ ] 50+ 单元测试

### 7.4 P1-1 Orchestrated Multi-Agent 阶段合约

#### 7.4.1 现状

Hermes Multi-Agent v2 Path Tree 已实现，但缺少：
- ❌ 无 Phase Contracts（阶段合约）
- ❌ 无 Role Attribution（角色归属）
- ❌ 无 Revision Budget（修订预算）
- ❌ 无 Approval Gates（批准关卡）
- ❌ 无 Inherited Mode Behavior（继承模式行为）

#### 7.4.2 目标设计

**5 角色定义**：
| 角色 | 权限 | 职责 |
| --- | --- | --- |
| **Root Orchestrator** | All | 协调决策 + 短综合 |
| **Explorer** | Read-only | 代码探索 + 证据收集 |
| **Worker** | Mutation + Verify | 实施 + 验证 |
| **Plan Reviewer** | Read-only | 计划审查 |
| **Result Reviewer** | Read-only | 结果审查 |

**两类合约**：
- **Direct Contract**：窄范围 + 已有证据 → 无审查
- **Reviewed Contract**：重要/不确定/范围大 → 完整审批

**强制约束**：
- **Explorer 永远 read-only**
- **Worker 拥有 mutation**
- **Recursive guard**：每个 turn 只有一个编排

**Bounded Packets**：
- Direct：最新 packet 非截断
- Reviewed：Bounded evidence packet

**Revision Budgets**：
- Plan revision: N 次
- Worker revision: M 次
- Budget exhausted → Short root failure

#### 7.4.3 验收标准

- [ ] 5 角色定义 + 权限隔离
- [ ] Direct + Reviewed 双合约
- [ ] Phase Contracts 实施
- [ ] Bounded Packets
- [ ] Revision Budgets
- [ ] Approval Gates
- [ ] Recursive Guard
- [ ] 40+ 单元测试

---

## 八、范围与目标

### 8.1 Cycle 14 实施范围

**P0-1 Hermes Agent v2 自进化智能体**（核心）：
- 4 个后端模块（proactive_memory / thread_automation / background_tasks / agent_v2）
- 1 个前端组件（AgentV2Panel）
- 40+ 单元测试
- 25+ E2E 断言

**P0-2 多模态支持**（核心）：
- 5 个后端模块（vision / audio / video / multimodal_input / multimodal_output）
- 1 个前端组件（MultimodalPanel）
- 30+ 单元测试
- 20+ E2E 断言

**P0-3 企业级 Plugin Hub**（核心）：
- 6 个后端模块（plugin_hub / enterprise_console / productivity_dashboard / cost_controls / security_policies / audit_logs）
- 1 个前端组件（PluginHubPanel）
- 50+ 单元测试
- 30+ E2E 断言

**P1-1 Orchestrated Multi-Agent**（重要）：
- 5 个后端模块（phase_contracts / role_attribution / bounded_packets / revision_budgets / approval_gates）
- 1 个前端组件（OrchestratedPanel）
- 40+ 单元测试
- 25+ E2E 断言

### 8.2 累计测试目标

| 类别 | 数量 | 通过率 |
| --- | --- | --- |
| 单元测试 | 160+ | 100% |
| E2E 断言 | 100+ | 100% |
| 集成测试 | 60+ | 100% |
| **合计** | **320+** | **100%** |

### 8.3 不在本轮范围

- P1-2 Auto-Compaction 引擎（Cycle 15）
- P1-3 TRAE Work 多模态协作（Cycle 15）
- P1-4 Goal auto-turn（Cycle 15）
- Codex Computer Use GUI 自动化（macOS-only，依赖外部资源）
- GPT-image-1.5 实际调用（依赖 API 配额）
- TRAE Voice Chat 实时对话（依赖 WebRTC 基础设施）

---

## 九、风险评估

| 风险 | 等级 | 缓解措施 |
| --- | --- | --- |
| 主动唤醒误触发 | 高 | 严格白名单 + 用户确认 |
| 多模态 API 成本 | 高 | 配额限制 + 缓存 + Mock fallback |
| 企业级安全审计 | 中 | 角色权限 + 审计日志 + 路径白名单 |
| Orchestrated 状态机死锁 | 中 | 修订预算 + 超时保护 |
| 三层 Plugin Hub 同步 | 中 | 异步加载 + 缓存 + 离线 fallback |
| 实时 V3 对话延迟 | 中 | WebSocket + 流式 + 重连机制 |
| 主动建议误判 | 中 | 置信度阈值 + 用户反馈学习 |

---

## 十、参考

1. [OpenAI: Codex for (almost) everything](https://openai.com/index/codex-for-almost-everything/) 2026-04-16
2. [TheNextGenTechInsider: OpenAI Updates Codex](https://thenextgentechinsider.com/pulse/openai-updates-codex-with-autonomous-computer-use-and-agentic-workflows) 2026-04-26
3. [Daniel Vaughan: From Reactive to Proactive](https://codex.danielvaughan.com/2026/04/16/codex-proactive-memory-thread-automations-self-directing-agents/) 2026-04-16
4. [Daniel Vaughan: Thread Automation Recipes](https://codex.danielvaughan.com/2026/04/17/thread-automation-recipes-scheduled-agent-patterns/) 2026-04-17
5. [GitHub: Orchestrated multi-agent mode PoC #32100](https://github.com/openai/codex/issues/32100) 2026-07-10
6. [Linux Codex v0.145.0 安装](https://blog.csdn.net/qq_36462452/article/details/163221108) 2026-07-26
7. [Codex CLI 迁移设置](https://anonhaven.com/news/codex-cli-nauchilsya-perenosit-nastrojki-iz-cursor-i-claude-code/) 2026-07-24
8. [Codex Changelog](https://developers.openai.com/codex/changelog)
9. [TRAE Enterprise](https://www.trae.ai/enterprise) 2026-07
10. [BytePlus: TRAE Enterprise overview](https://docs.byteplus.com/ko/docs/trae/trae-enterprise-overview) 2026-06-17
11. [TRAE Changelog](https://www.trae.ai/changelog) 2026-07-21
12. [Hokai: Trae Review](https://hokai.io/hub/tools/trae) 2026-07-01
13. [Aries-Serpent: _codex_ Roadmap](https://github.com/Aries-Serpent/_codex_/blob/main/docs/ROADMAP.md) 2026-07-11
14. [XenoSpectrum: OpenAI Codex 自律操作](https://xenospectrum.com/openai-codex-update-superapp-agent/) 2026-04-17
15. [AIMarketCap: Trae Plugin Review](https://aimarketcap.io/ai-tools/trae-plugin/)
16. [CSDN: Codex AI 编程智能体](https://blog.csdn.net/bryant_meng/article/details/163070918) 2026-07-22
