# Cycle 10 研究报告 - Codex v0.145+ 与 TRAE Solo v3.5.79+ 最新特性

> **周期**: Cycle 10
> **调研时间**: 2026-07-28
> **版本对比**: 当前 Hermes v6.8.0 / Codex v0.145.0 / TRAE v3.5.79
> **关联**: [CYCLE9_RESEARCH_REPORT.md](CYCLE9_RESEARCH_REPORT.md)

---

## 一、Codex v0.145.0 (2026-07-21) 重大更新

### 1.1 /import 命令（跨平台配置迁移）

**功能**：将 Cursor / Claude Code 的设置一键迁移到 Codex，包括：
- MCP 服务器配置
- 插件（plugins）
- 会话历史
- 自定义命令
- 项目级记忆（project-specific memory）

**参考**：
- 来源 1：[Codex CLI научился переносить настройки](https://anonhaven.com/news/codex-cli-nauchilsya-perenosit-nastrojki-iz-cursor-i-claude-code/) - Anonhaven 2026-07-24
- 来源 2：[OpenAI Codex Changelog](https://developers.openai.com/codex/changelog?type=general) - 官方更新日志

**对 Hermes 的启示**：
- P3-1 候选：`/import` 命令支持从 Claude Code / Cursor 导入 MCP / sessions / commands
- 减少用户切换工具的迁移成本

### 1.2 Multi-Agent v2 稳定化

**关键变化**：
- 稳定版本发布（v0.145.0 GA）
- 主 agent 可创建子 agent 并分配任务
- 子 agent 可独立选择模型 + 推理深度
- 用户可限制同时工作的子 agent 数量
- 子 agent 角色分工：架构探索、测试验证、安全检查

**当前 Hermes 状态**：
- ✅ 已实现 Multi-Agent v2 path-based addressing（Cycle 7 P0-10）
- ✅ 已实现 .trae/agents/ 子智能体目录路由（Cycle 9 P0-17）
- 差距：缺少 sub-agent 角色分工 + 并发限制 UI

### 1.3 Goal Mode（v0.133.0 GA，2026-05-21）

**核心机制**：
- 用户发出 `/goal <objective>` 后，agent 持续运行直到完成
- 自动循环：plan → act → test → review → iterate
- Token 预算管理 + 软停止 + 状态持久化
- 生命周期命令：`/goal pause / resume / clear`

**三大支柱**（来源：[The /goal Command and the Verification Problem](https://codex.danielvaughan.com/2026/07/06/codex-cli-goal-mode-long-running-autonomous-agents-verification-trust-architecture/)）：
1. **Three-File Trust Architecture**：spec.md / checklist.md / tasks.md 三件套
2. **Configuring Cost Guardrails**：token 预算 + 单价上限
3. **Separate Verifier Pattern**：独立验证器审查主 agent 输出

**当前 Hermes 状态**：
- ✅ Loop Engineering 工作流（Cycle 8 P1-4）：triage/plan/execute/verify
- ✅ spec.md / task.md / checklist.md 三件套
- 差距：缺少 Goal Mode 长运行模式（自动 token 预算管理 + 状态持久化）

### 1.4 codex doctor 诊断（v0.135.0，2026-05-28）

**功能**：环境诊断命令
- 环境变量检查
- Git 仓库状态
- 终端能力
- app-server 连接
- thread 库存

**当前 Hermes 状态**：
- ❌ 缺失 P2-2 Codex doctor 诊断

### 1.5 GPT-5.3-Codex 模型（2026-01）

**特性**：
- 专为编码优化
- 256K 上下文
- GitHub + Stack Overflow + 文档训练
- 略高于 o4-mini 价格

**当前 Hermes 状态**：
- ✅ Custom Models 系统（Cycle 8 P0-14）支持动态添加 GPT-5.3-Codex

### 1.6 Cloud Agent（异步委托）

**功能**：
- GitHub Issue → AI 异步处理 → PR
- 用户无需在线等待
- 服务器端执行

**当前 Hermes 状态**：
- 已有 Workflow Engine 支持长时间任务
- 差距：缺少 GitHub Issue 集成

### 1.7 Parallel MCP（v0.4+）

**功能**：MCP 工具并行调用
- 读 DB Schema + 查文档：4.5s → 2.2s（51% 提升）
- 多文件读取 + 分析：8.1s → 3.8s（53% 提升）

**当前 Hermes 状态**：
- ✅ Multi-Agent v2 支持子 agent 并行
- 差距：单个 agent 内的 MCP 工具调用未做并行优化

---

## 二、TRAE Solo v3.5.79+ 关键更新

### 2.1 Global Memory（2026-06-24，TRAE Work v0.1.21）

**功能**：跨会话全局记忆
- 保留所有历史交互
- 整合到个人知识库

**当前 Hermes 状态**：
- ❌ 缺失 P1-8 Memory 功能（智能体长期记忆）

### 2.2 Memory System - Dual-Track Persistent Memory

**架构**（来源：[trae-agent-enhancements Memory System](https://github.com/MorningStar0709/trae-agent-enhancements/blob/main/docs/06-memory.md)）：

| 维度 | Core Memory | MCP Memory |
|---|---|---|
| Backend | Trae 原生 | MCP Memory Server |
| 存储 | Trae 管理 | 本地 JSONL |
| 范围 | 当前会话 | 跨会话 |
| 生命周期 | 会话结束即销毁 | 持久化（直到删除） |
| 结构 | Key-value observations | 知识图谱（实体+关系） |
| 写入触发 | 自动（Trae 原生） | 显式通过 memory-kernel skill |
| 容量 | 每 scope 约 20 条 | 无限制 |
| 平台锁 | Trae-only | 任何 MCP 兼容 IDE |

**关键设计**：
- Step 0 Universal Pre-check：所有任务开始前先查询 MCP Memory
- 路由规则：Memory 优先 → 文件扫描降级
- Writing Standard：每条 observation 必须 `[YYYY-MM-DD]` 开头
- Entity 命名：snake_case + 项目前缀

**当前 Hermes 状态**：
- ❌ 完全缺失 Dual-Track Memory
- 仅有 Session 持久化（会话级别，非智能体记忆级别）

### 2.3 Self-Improvement Skill

**功能**：每次遇到新问题，自动存储到长期记忆
- 错误模式学习
- 解决方案复用
- 跨会话经验积累

**当前 Hermes 状态**：
- ❌ 缺失 self-improvement 机制
- 已有 Project Memory（项目级别）但未与智能体记忆打通

### 2.4 .trae/commands/ 多级目录支持（v3.5.55-56，2026-05-08）

**功能**：.trae/commands/ 支持最多 3 级目录嵌套

**当前 Hermes 状态**：
- ✅ 已实现 .trae/commands/ 扫描（Cycle 8 P0-13）
- 差距：未实现 3 级目录嵌套 + 分类自动推断

### 2.5 Worktree 功能（TRAE Work v0.1.8-0.1.9，2026-05-05）

**功能**：任务在隔离的 Git 环境中运行
- 每个任务独立目录
- 独立文件 + 依赖 + 代码变更
- 主工作区保持干净

**当前 Hermes 状态**：
- ✅ Loop Engineering workflow 支持 git 提交到子分支
- 差距：缺少 Worktree 自动创建/管理

### 2.6 错误处理改进

**v3.5.67-71 (2026-06-29)**：
- 可重试错误（-1 / 3003）自动重试
- 重新调用未执行的 tool card

**当前 Hermes 状态**：
- ✅ CLIExecutor 已实现 max_retries + retry_base_delay 机制
- 差距：未集成到前端用户可见的错误恢复 UI

---

## 三、TRAE Agent Enhancements - 关键设计模式

来源：[Trae AI Agent Enhancements](https://github.com/MorningStar0709/trae-agent-enhancements/blob/main/docs/02-overview.md)

### 3.1 T-Shirt Sizing 任务分诊

**功能**：根据 4 维矩阵（file scope × change type × risk level × expected pace）自动判断任务大小
- 简单文本编辑：直接执行
- 复杂功能：进入完整 workflow
- 不过度工程化，也不偷工减料

**当前 Hermes 状态**：
- ✅ Loop Engineering triage 子命令（Cycle 8 P1-4）

### 3.2 闭环质量保证

**5 个 Skill 协作**：
1. `brainstorming` - 需求澄清
2. `writing-plans` - 计划生成
3. `executing-plans` - 任务执行
4. `verification-before-completion` - 验证（测试通过 + 构建成功 + bug 消失）
5. `git-commit` - 提交

**当前 Hermes 状态**：
- ✅ 已有完整 5 阶段工作流
- 差距：缺少 verification-before-completion 强约束（必须运行测试 + 检查构建）

---

## 四、新增候选任务

### 4.1 P1-8 Memory 功能（智能体长期记忆）⭐ 高优先级

**来源**：TRAE Global Memory + Dual-Track Memory + Self-Improvement

**核心需求**：
- Core Memory（会话级 Key-value observations）
- MCP Memory（跨会话知识图谱）
- Step 0 Universal Pre-check
- Memory-kernel skill（读写协议）
- Self-improvement skill（自动学习）

**技术选型**：
- 知识图谱：本地 JSONL（trae-agent 风格）或 SQLite
- MCP Memory Server：参考 `@modelcontextprotocol/server-memory`
- Memory 路由：Step 0 优先 MCP → 降级 Core

**预估工时**：8-12h

### 4.2 P1-10 Verification Loop in AGENTS.md ⭐ 高优先级

**来源**：Codex Goal Mode 的 Three-File Trust Architecture + Separate Verifier Pattern

**核心需求**：
- AGENTS.md 自动生成 verification 章节
- verification-before-completion skill
- 独立 Verifier 角色（与主 agent 分离）
- 强制检查项：测试通过 + 构建成功 + bug 消失
- 失败自动 retry + 上报

**预估工时**：6-8h

### 4.3 P3-1 /import 跨平台配置迁移（中优先级）

**来源**：Codex v0.145.0 /import 命令

**核心需求**：
- 从 Claude Code 导入：MCP servers / sessions / commands
- 从 Cursor 导入：配置 / 插件
- 自动路径检测
- 权限验证 + 失败降级

**预估工时**：4-6h

### 4.4 P2-2 codex doctor 诊断（中优先级）

**来源**：Codex v0.135.0 doctor 命令

**核心需求**：
- 环境检查：Node.js / Python / Git 版本
- 仓库状态：git status / 远程连接
- 终端能力：颜色 / Unicode 支持
- app-server 连接：可访问性测试
- thread 库存：活跃 session / agent

**预估工时**：3-4h

### 4.5 P2-1 Playwright E2E 完整前端自动化（低优先级）

**来源**：TRAE 完整前端 E2E 需求

**核心需求**：
- Playwright 浏览器自动化
- 覆盖所有核心页面：聊天 / 编程 / DiffView / 计划 / 任务 / 设置
- 截图对比
- CI/CD 集成

**预估工时**：8-10h

---

## 五、优先级建议（Cycle 10）

### 5.1 P1 高优先级（必做）
1. **P1-8 Memory 功能** - 智能体长期记忆，与 TRAE Global Memory 对齐
2. **P1-10 Verification Loop in AGENTS.md** - 闭环质量保证

### 5.2 P2 中优先级（建议做）
1. **P3-1 /import 命令** - 跨平台配置迁移
2. **P2-2 codex doctor** - 诊断能力

### 5.3 P2 低优先级（可做）
1. **P2-1 Playwright E2E** - 完整自动化

---

## 六、与现有 Cycle 9 任务的关系

| 现有功能 | 与 Cycle 10 候选关系 |
|---|---|
| Loop Engineering workflow | 已有 triage/plan/execute/verify → 与 P1-10 Verification Loop 互补 |
| .trae/agents/ 子智能体 | 已有 path-based addressing → 与 Multi-Agent v2 子 agent 角色互补 |
| .trae/commands/ 多级目录 | 已有扫描 → 需补 3 级目录支持 + 分类 |
| Slash Commands 系统 | 已有 12+ 内置命令 → 需补 /import /doctor /goal |
| Custom Models | 已有 4 provider → 需补 GPT-5.3-Codex 默认 |

---

## 七、信息源

| 资料 | URL | 检索时间 |
|------|-----|----------|
| Codex CLI /import 跨平台迁移 | https://anonhaven.com/news/codex-cli-nauchilsya-perenosit-nastrojki-iz-cursor-i-claude-code/ | 2026-07-24 |
| OpenAI Codex Changelog | https://developers.openai.com/codex/changelog?type=general | 2026-07-28 |
| /goal Command + Verification Problem | https://codex.danielvaughan.com/2026/07/06/codex-cli-goal-mode-long-running-autonomous-agents-verification-trust-architecture/ | 2026-07-28 |
| Codex CLI Guide 2026 v0.145.0 | https://blakecrosley.com/guides/codex | 2026-07-24 |
| Codex 2026 新特性全面解读 | https://blog.csdn.net/weixin_43571227/article/details/162141386 | 2026-07-24 |
| TRAE 官网 | https://www.trae.com.cn | 2026-07-28 |
| TRAE Changelog | https://www.trae.ai/changelog | 2026-07-28 |
| Trae Memory System Dual-Track | https://github.com/MorningStar0709/trae-agent-enhancements/blob/main/docs/06-memory.md | 2026-07-28 |
| Trae Agent Enhancements Overview | https://github.com/MorningStar0709/trae-agent-enhancements/blob/main/docs/02-overview.md | 2026-07-28 |
| OpenViking TRAE Memory Integration PR #3109 | https://github.com/volcengine/OpenViking/pull/3109/files/29dc88c85137a9101d40718330adf8aa01c7cd0a | 2026-07-10 |

---

## 八、下一步

1. **编写 CYCLE10_GAP_ANALYSIS.md** - 详细差距分析 + 任务规格
2. **规划 P1-8 Memory 功能 spec** - 创建 .trae/specs/cycle10/memory/spec.md
3. **规划 P1-10 Verification Loop spec** - 创建 .trae/specs/cycle10/verification/spec.md
4. **实现 P1-8 Memory 后端 + 前端** - 8-12h 工时
5. **实现 P1-10 Verification Loop** - 6-8h 工时
6. **编写测试 + UI 集成** - 完整维度覆盖
