# Cycle 28 Codex/TRAE 2026 Q3-Q4 调研报告

**Cycle**: 28 - Solo 模式能力深化（Skills / Cost / Multi-Repo）
**Date**: 2026-07-30
**Author**: Hermes Loop Engineering Workflow
**Version**: v6.72.0 起

---

## 📌 调研范围

聚焦 2026 Q3-Q4 最新发布特性，结合 Claude Code / Codex / TRAE 三方对 Solo 模式的能力补充。

## 1. Codex 2026 H2 演进

### 1.1 Agent Skills（2025-12）
Codex CLI 与 IDE 扩展均支持**技能包**机制：
- 每个 Skill 是一个以 `SKILL.md` 为核心的目录
- 必含 `name` + `description` 字段，description 决定**隐式匹配**
- 渐进式披露（Progressive Disclosure）：启动仅加载 name/description/path，总量上限 2% context window（约 8K 字符），使用时才读取完整内容
- Skills 分类：内置 curated / experimental / GitHub 仓库 / 本地
- Plugins = Skills + App Integrations + MCP servers

### 1.2 Hooks 引擎（2026-06）
会话生命周期事件：
| 事件 | 触发时机 | 典型用途 |
|---|---|---|
| `session:start` | 会话开始 | 加载 env、git 检查 |
| `session:end` | 会话结束 | 清理临时文件 |
| `tool:before` | 工具调用前 | 安全检查、命令拦截 |
| `tool:after` | 工具调用后 | 格式化输出、结果验证 |

### 1.3 Codex Security（2026-07）
开源 CLI + TypeScript SDK，扫描代码安全漏洞，集成 CI/CD。

### 1.4 /goal 持久会话（2026 新特性）
`/goal "长期目标描述"` 启动跨多天运行的持久会话。

### 1.5 Slash Commands 全集
`/init` `/status` `/approvals` `/review` `/plan` `/goal` `/mcp` `/next`

### 1.6 Prompt 增强
- `@filename` 引用文件
- `!command` 内联 shell

### 1.7 AGENTS.md 项目记忆
- 启动时自动加载
- 持续参考、避免"健忘"
- 维护编码风格、架构决策、TODO 列表

## 2. Claude Code 2026-06 新特性（10 项）

| # | 特性 | 状态 | 我们的差距 |
|---|---|---|---|
| 1 | Nested Sub-Agents 3-Level | ✅ Cycle 27 | 已实现 |
| 2 | **fallbackModel 配置** | 🆕 待实现 | Cycle 28 P0 |
| 3 | **Community Tool Marketplace** | 🆕 待实现 | Cycle 28 P1 |
| 4 | **Usage Attribution & Cost Tracking** | 🆕 待实现 | Cycle 28 P0 |
| 5 | **Scoped Permissions for Sub-Agents** | 🆕 待实现 | Cycle 28 P0 |
| 6 | **Streaming Agent Logs** | 🆕 待实现 | Cycle 28 P1 |
| 7 | Agent Checkpointing & Resume | ✅ Cycle 27 | 已实现 |
| 8 | **Inline Cost Budgets per Agent** | 🆕 待实现 | Cycle 28 P0 |
| 9 | Custom Agent Templates | ✅ Cycle 27 | 已实现 |
| 10 | **Multi-Repo Orchestration** | 🆕 待实现 | Cycle 28 P1 |

## 3. Claude Code Desktop 重设计（2026-04）

### 3.1 Side Chat
- 快捷键 ⌘ + ; / Ctrl + ;
- 分支对话，从主线程拉取上下文
- 不写回主线程，避免污染

### 3.2 多面板拖拽布局
terminal / preview / diff viewer / chat 可自由拖拽组合

### 3.3 三种 View 模式
- Verbose（完整工具调用透明）
- Normal（标准）
- Summary（仅结果）

### 3.4 扩展 Preview
- HTML / PDF 在应用内打开
- 本地 app server 集成

### 3.5 Streaming
实时流式响应，UX 提升明显

## 4. Claude Opus 4.6 模型能力（2026-02）

| 能力 | 我们的差距 |
|---|---|
| Adaptive Thinking（自适应推理） | 模型路由增强 |
| 1M Token Context | context window 升级 |
| Agent Teams（多 Agent 团队） | 已在 nested sub-agents 中支持 |
| Context Compaction | ✅ 已在 NestedSubAgentEngine 实现 |
| 128K Max Output | 输出长度限制升级 |

## 5. 跨工具共性新特性 → Cycle 28 P0

### 5.1 G28-01 Skills System（Codex 2025-12）
- SKILL.md 结构化定义（name / description / scripts / references / assets）
- 渐进式披露（仅加载 name/description/path）
- 隐式匹配（description 关键词触发）
- 显式调用（`$skill_name` 引用）
- 模板到 Skill 的扩展（Cycle 27 模板 → Cycle 28 可执行 Skill）

### 5.2 G28-02 fallbackModel + Cost Budget（Claude 2026-06 #2 + #8）
- 路由失败时自动 fallback 到下一模型
- 单次/单代理/单日 三层成本预算
- 预算超限自动暂停 + 告警
- 与现有 ModelRouter 集成

### 5.3 G28-03 Usage Attribution & Cost Tracking（Claude 2026-06 #4）
- 按 sub-agent / task / timestamp 拆分 token / cost
- JSON 报告导出（schema_version, session_id）
- 用于计费 chargeback

### 5.4 G28-04 Scoped Permissions for Sub-Agents（Claude 2026-06 #5）
- 嵌套代理的细粒度权限控制
- 工具级 allowlist/blocklist
- 文件路径白名单
- 网络主机白名单

### 5.5 G28-05 Slash Commands Engine
- 实现 /init /status /review /plan /goal /next /mcp
- 可注册自定义命令
- /init 自动扫描项目生成 AGENTS.md

### 5.6 G28-06 Multi-Repo Orchestration（Claude 2026-06 #10）
- 跨多个 Git 仓库的任务分发
- 仓库级 worktree 隔离
- 集中式 session 视图

### 5.7 G28-07 Hooks Engine（Codex 2026-06）
- 10 种事件类型
- 工具调用前/后拦截
- 异步执行 + 错误隔离
- 钩子链可视化

### 5.8 G28-08 Side Chat / Multi-Conversation（Claude Desktop 2026-04）
- 分支对话
- 不污染主线程
- 上下文继承

## 6. P0 vs P1 划分

### P0（必须完成 5 项）
- [x] G28-01 Skills System（Codex SKILL.md 规范）
- [x] G28-02 fallbackModel + Cost Budget
- [x] G28-03 Usage Attribution & Cost Tracking
- [x] G28-04 Scoped Permissions for Sub-Agents
- [x] G28-05 Slash Commands Engine（含 /init 生成 AGENTS.md）

### P1（可选 3 项）
- [ ] G28-06 Multi-Repo Orchestration
- [ ] G28-07 Hooks Engine
- [ ] G28-08 Side Chat / Multi-Conversation

## 7. 与已有架构的对接

| 已有引擎 | 复用方式 |
|---|---|
| ModelRouter | 增强 fallback 链 + 成本统计 |
| NestedSubAgentEngine | 扩展 scoped permissions |
| AgentTemplateEngine | 扩展为 Skills（含可执行代码） |
| CostPrediction | 增强为多维度计费 |
| ComposerEngine | 添加 /init 自动分析 |

## 8. 风险与权衡

| 风险 | 缓解策略 |
|---|---|
| Skills 隐式匹配可能误触发 | description 必须精确、设置匹配阈值 |
| 成本预算过严影响效率 | 提供宽松/平衡/严格 三档 |
| 跨 repo 操作的复杂性 | 保持单 repo 默认、跨 repo 需显式确认 |
| Hooks 性能影响 | 异步执行 + 超时控制 + 失败隔离 |

## 9. Cycle 28 交付物清单

| 类型 | 文件 | 说明 |
|---|---|---|
| 调研报告 | CYCLE28_CODEX_TRAE_RESEARCH.md | 本文档 |
| 差距分析 | CYCLE28_GAP_ANALYSIS.md | P0/P1 详细差距 |
| SPEC | CYCLE28_SPEC_G28_01_SKILLS.md | Skills 系统详细设计 |
| 引擎 (5) | skillEngine / costBudget / usageAttribution / scopedPermissions / slashCommand | 5 个核心引擎 |
| 组件 (5) | SkillsPanel / CostBudgetPanel / UsageAttributionPanel / ScopedPermissionsPanel / SlashCommandPanel | 5 个 UI 组件 |
| E2E | Cycle28E2E.test.tsx | 端到端测试 |
| 集成 | App.tsx / AppLayout.tsx / BrandHeader.tsx | 主菜单集成 |
| 日志 | CYCLE28_CODE_MODIFICATION_LOG.md | 修改日志 |

## 10. 下一循环（Cycle 29）规划

- P1 任务（Multi-Repo / Hooks / Side Chat）
- Codex Security 集成
- Skills Marketplace 跨项目分享

---

**Cycle 28 调研完成度**: 100%
**P0 任务**: 5 个
**P1 任务**: 3 个
**总工作量估算**: ~280 新增测试
**目标版本**: v6.72.0 → v6.76.0
