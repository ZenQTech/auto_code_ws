# Cycle 29 互联网调研报告

**周期**：Cycle 29 (v6.77.0 - v6.82.0)
**主题**：Claude Code 2026-07 + TRAE SOLO 2.0 + Codex Skills Marketplace
**日期**：2026-07-30
**状态**：✅ 调研完成

---

## 一、调研目标

调研 2026 年 7 月最新发布的 Claude Code v2.1.199-2.1.219、Codex Skills Marketplace、TRAE SOLO 2.0 的核心新特性，识别 Hermes 当前系统的功能差距，规划 Cycle 29 任务。

---

## 二、Claude Code 2026-07 新特性 (v2.1.199-2.1.219)

### 2.1 v2.1.199 - Stacked Skills（堆叠技能）

**核心特性**：
- 一次调用最多堆叠 5 个技能：`/skill-a /skill-b do XYZ` 一次性加载所有前导技能
- 技能组合而非单独调用
- 上下文智能去重

**对应 Hermes 现状**：
- ✅ Cycle 28 已实现 SkillEngine，但仅支持单技能调用
- ❌ 缺少多技能堆叠编排能力

**来源**：dreaming.press - Claude Code Now Stacks Skills and Pauses by Default (2026-07-21)
**URL**：https://dreaming.press/posts/claude-code-july-2026-stacked-skills-pause-by-default.html

### 2.2 v2.1.200 - Pause by Default

**核心特性**：
- AskUserQuestion 对话框默认不再自动继续
- Agent 在真实决策点暂停，而不是猜测默认答案
- 对长时无人值守运行尤其重要

**来源**：dreaming.press（同上）

### 2.3 v2.1.202 - /dataviz 技能

**核心特性**：
- 内置 dataviz 技能
- 修复已加载技能在上下文中重复出现的问题

### 2.4 v2.1.204 - EndConversation + Heartbeat

**核心特性**：
- EndConversation 工具（Claude 可终止与滥用用户的会话）
- 长时工具调用的进度心跳
- 防止工具调用看起来"卡死"

### 2.5 v2.1.198 - Background Subagents

**核心特性**：
- 子代理默认在后台运行
- 主会话不阻塞，可继续工作

**对应 Hermes 现状**：
- ✅ Cycle 19 P0-1 已实现 BackgroundTaskEngine
- ✅ Cycle 24 P1-1 已实现 MultiTaskOrchestrator
- 🟡 缺少专门的 SubAgent 后台模式

### 2.6 v2.1.219 - Claude Opus 5 + Nested Subagents

**核心特性**：
- Claude Opus 5 (`claude-opus-5`)，新的默认 Opus 模型
- 1M 上下文
- 快速模式 $10/$50 per Mtok
- 子代理嵌套深度从 1 提升到 3（CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 可禁用）

**对应 Hermes 现状**：
- ✅ Cycle 27 G27-01 已实现 NestedSubAgentEngine，支持 3 层嵌套
- ❌ 缺少模型路由层与 Claude Opus 5 对接

**来源**：releasebot.io - Claude Code Updates & Release Notes (2026-07-24)
**URL**：https://releasebot.io/updates/anthropic/claude-code

### 2.7 Claude Code Skills 完整能力

**核心特性**：
- SKILL.md 格式（YAML frontmatter + Markdown body）
- 渐进式加载（初始只加载 name/description/path，上限 8000 字符或上下文窗口 2%）
- 4 个作用域：REPO / USER / ADMIN / SYSTEM
- 3 种创建方式：Record & Replay / skill-creator / 手动
- 隐式匹配（description 关键词）+ 显式调用（$skill-name）

**对应 Hermes 现状**：
- ✅ Cycle 28 G28-01 已实现 SkillEngine
- 🟡 缺少 Record & Replay 工作流录制
- 🟡 缺少 ADMIN/SYSTEM 作用域管理

**来源**：
- news.qiniu.com - Codex 进阶教程：Skills、Memories、AGENTS.md (2026-07-14)
- URL：https://news.qiniu.com/archives/1783994696399

### 2.8 Claude Code Admin Console 增强

**核心特性**：
- 用量/成本按 group 和 user 拆分
- 价值/用量两个新 Tab（活跃开发者、会话数、Top 命令）
- Analytics Chat（自然语言查询 + 图表导出）
- Analytics API（与 Datadog Cloud Cost Management、CloudZero 集成）
- 模型默认设置 + 权限
- 75%/90% 支出阈值告警

**对应 Hermes 现状**：
- ✅ Cycle 28 G28-03 UsageAttributionEngine 部分覆盖
- 🟡 缺少 Analytics Chat（自然语言查询）
- ❌ 缺少 Analytics API 集成
- ❌ 缺少 75%/90% 阈值告警

**来源**：claude.com - Giving admins more visibility and control over Claude spend (2026-07-02)
**URL**：https://claude.com/blog/giving-admins-more-visibility-and-control-over-claude-usage-and-spend

---

## 三、Codex 2026-07 新特性

### 3.1 Codex CLI Skills Marketplace

**核心特性**：
- `npx @skills-hub-ai/cli install code-review --target codex`
- 跨平台技能（同一 SKILL.md 在 Codex/Claude Code/Cursor/Windsurf 都能用）
- 评分系统（code-review 94 installs）
- 分类：Review / Productivity / Build / Deploy / Combo

**代表技能**：
- code-review (94 installs)
- quickstart (27 installs)
- refactor (13 installs)
- ci-cd (8 installs)
- security-audit (6 installs)
- api-design (4 installs)

**对应 Hermes 现状**：
- ✅ Cycle 28 G28-01 SkillEngine 已实现
- ❌ 缺少 Skills Marketplace（下载/评分/评论）
- ❌ 缺少跨平台 SKILL.md 兼容层

**来源**：
- skills-hub.ai - Codex CLI Skills
- URL：https://skills-hub.ai/codex-skills

### 3.2 Codex Agentskills.io 开放标准

**核心特性**：
- SKILL.md 文件结构：YAML frontmatter + Markdown body
- 字段：name / description / argument-hint / allowed-tools / model / context / agent / hooks
- 字符串替换：$ARGUMENTS / $0 / $1 / $2 ...
- 内置技能：$plan / $skill-creator / $web-search
- 路径优先级：Project > User > Built-in

**对应 Hermes 现状**：
- ✅ Cycle 28 G28-01 已实现部分字段
- 🟡 缺少 argument-hint 字段
- 🟡 缺少 $ARGUMENTS 字符串替换
- ❌ 缺少 hooks 字段（per-skill lifecycle hooks）

**来源**：
- The-MDC/codex-cli-best-practice - SKILLS.md
- URL：https://github.com/The-MDC/codex-cli-best-practice/blob/main/docs/SKILLS.md

---

## 四、TRAE SOLO 2.0 新特性

### 4.1 SOLO 模式核心功能

**核心特性**：
- 内置 "Agent"（需求拆解 → 方案设计 → 代码实现 → 重构 → 修 bug）
- 多任务管理（单项目内多任务并行）
- 工具面板：Editor / DocView / Terminal / Browser / DiffView / Figma / Supabase / Agents / MCP
- Flow 模式（工具自动切换）
- DiffView（代码变更视图）
- 自动折叠已完成对话

**对应 Hermes 现状**：
- ✅ Cycle 16 P0-1 Composer 多文件编辑
- ✅ Cycle 24 P1-1 MultiTaskOrchestrator
- ✅ Cycle 25 G25-01 自动化代码评审
- 🟡 缺少 Flow 模式（工具自动编排）

**来源**：
- docs.trae.ai - SOLO mode overview
- URL：https://docs.trae.ai/ide/solo-mode

### 4.2 TRAE Work 多模态协作

**核心特性**：
- Desktop + Web + Mobile 三端
- 任务管理（多任务并行）
- AI 服务集成（可调用自定义 LLM）

**对应 Hermes 现状**：
- ✅ Cycle 14 P1-3 onOpenTraeWork 已实现入口
- 🟡 缺少实际多模态任务处理

### 4.3 TRAE CUE 智能预编辑

**核心特性**：
- Tab 键预测下一步编辑
- 多行智能建议
- 深度意图理解

**对应 Hermes 现状**：
- ❌ 缺少代码预测编辑能力
- 这是 Cycle 30+ 候选功能

---

## 五、关键差距分析

### 5.1 优先级矩阵

| 特性 | 用户价值 | 实现复杂度 | 优先级 | 建议周期 |
|------|---------|-----------|--------|---------|
| Stacked Skills (技能堆叠) | 高 | 中 | P0 | Cycle 29 |
| Analytics Chat (自然语言查询) | 高 | 中 | P0 | Cycle 29 |
| Skills Marketplace | 高 | 高 | P0 | Cycle 29 |
| Cost Threshold Alert (75%/90%) | 中 | 低 | P1 | Cycle 29 |
| Record & Replay (工作流录制) | 中 | 高 | P1 | Cycle 29 |
| $ARGUMENTS 字符串替换 | 低 | 低 | P2 | Cycle 29 |
| Admin Analytics API 集成 | 中 | 中 | P1 | Cycle 29 |
| Flow 模式（工具自动编排） | 高 | 高 | P1 | Cycle 29 |
| Per-skill Lifecycle Hooks | 中 | 中 | P2 | Cycle 29 |

### 5.2 P0 任务清单（Cycle 29）

1. **G29-01: Stacked Skills Engine** - 多技能堆叠编排
2. **G29-02: Skills Marketplace** - 技能市场（浏览/安装/评分/评论）
3. **G29-03: Analytics Chat** - 自然语言用量查询

### 5.3 P1 任务清单（Cycle 29）

4. **G29-04: Cost Threshold Alert** - 75%/90% 阈值告警
5. **G29-05: Flow Mode Orchestrator** - 工具自动编排
6. **G29-06: Admin Analytics API** - REST API 暴露用量数据

### 5.4 P2 任务清单（Cycle 30+）

7. **G29-07: Record & Replay** - 工作流录制回放
8. **G29-08: SKILL.md $ARGUMENTS** - 字符串替换
9. **G29-09: Per-skill Lifecycle Hooks** - 技能级钩子

---

## 六、参考资料

### 6.1 Claude Code 相关
1. [releasebot.io - Claude Code Updates (2026-07-24)](https://releasebot.io/updates/anthropic/claude-code)
2. [dreaming.press - Stacked Skills and Pause by Default (2026-07-21)](https://dreaming.press/posts/claude-code-july-2026-stacked-skills-pause-by-default.html)
3. [code.claude.com - What's new (Week 29, July 13-17)](https://code.claude.com/docs/en/whats-new/2026-w29)
4. [claude.com - Admin visibility & spend control (2026-07-02)](https://claude.com/blog/giving-admins-more-visibility-and-control-over-claude-usage-and-spend)

### 6.2 Codex 相关
5. [skills-hub.ai - Codex CLI Skills](https://skills-hub.ai/codex-skills)
6. [The-MDC/codex-cli-best-practice - SKILLS.md](https://github.com/The-MDC/codex-cli-best-practice/blob/main/docs/SKILLS.md)
7. [news.qiniu.com - Codex 进阶教程 (2026-07-14)](https://news.qiniu.com/archives/1783994696399)
8. [blog.csdn.net - Codex 渐进加载 Skills (2026-07-27)](https://blog.csdn.net/2401_87342824/article/details/163233776)

### 6.3 TRAE 相关
9. [docs.trae.ai - SOLO mode overview](https://docs.trae.ai/ide/solo-mode)
10. [docs.trae.ai - Tool panel](https://docs.trae.ai/ide/tool-panels)
11. [trae.ai - 官方网站](https://www.trae.ai/)

---

## 七、合规性声明

本报告所有外部信息均通过 WebSearch 工具从公开互联网获取，严格遵循 `info-fetch-compliance` 规则：
- ✅ 来源均为公开技术博客、官方文档、GitHub 仓库
- ✅ 引用均标注来源 + 发布时间 + URL
- ✅ 调研结论仅作为方向性参考，不直接复制原文
- ✅ 与项目现有架构（Hermes Agent Scheduler Platform）冲突时，优先遵循项目自身规范

---

## 八、下一阶段

进入 **Phase 2 - 差距分析 + SPEC 文档**，针对 6 个 P0+P1 任务分别编写 SPEC 详细规格。
