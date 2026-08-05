# Cycle 70 互联网调研报告

**主题**：Codex Skill Registry + AGENTS.md Memory 增强 + MCP 桥接
**日期**：2026-08-05
**作者**：Hermes Agent Dispatch Platform

---

## 一、调研目标

调研 Codex CLI 与 Trae SOLO 模式在以下三个方向的最新实现：
1. **AGENTS.md 指令发现机制** - 多层级、目录感知、字节限制
2. **Skills 系统** - SKILL.md 格式、5 个存储位置、显式/隐式调用
3. **MCP（Model Context Protocol）集成** - 外部工具/数据桥接

---

## 二、Codex CLI Customization Stack

### 2.1 五层架构

Codex CLI 的扩展性由 5 层组成（按构建顺序）：

| Layer | 作用 | 何时使用 | 发现范围 |
|-------|------|---------|---------|
| **AGENTS.md** | 规则、约定、架构上下文 | 每个项目都需要 | 目录层级 |
| **Skills** | 打包可复用多步工作流 | prompt 模式重复 3+ 次 | user → repo → directory |
| **MCP** | 连接外部工具/数据 | 上下文在仓库外 | config.toml scoped |
| **Subagents** | 委派边界任务给专门 worker | 任务需要并行/隔离 | TOML agent definitions |
| **Plugins** | 打包 skills + MCP + agents | 跨团队分发 | marketplace + local |

### 2.2 AGENTS.md 发现机制

**官方发现顺序**（每次运行构建一次，从根到叶拼接）：

1. **全局作用域**（`~/.codex/` 或 `$CODEX_HOME`）：
   - `AGENTS.override.md`（先检查）
   - `AGENTS.md`（fallback）
   - 只使用第一个非空文件

2. **项目作用域**（项目根 → CWD，向下走）：
   - 在每个目录：`AGENTS.override.md` → `AGENTS.md` → fallback names
   - 文件拼接；更近的目录可覆盖早期指导
   - 到达当前目录后停止搜索

3. **字节限制**：`project_doc_max_bytes`（默认 32 KiB）
   - 超出后停止添加
   - 解决方案：调高限制或拆分到嵌套目录

**monorepo + subagents 推荐层级**：
```
~/.codex/AGENTS.md              # 全局：个人约定
project/AGENTS.md               # 始终加载：项目级事实
project/agents/AGENTS.md        # 共享 subagent 规则
project/agents/<name>/AGENTS.md # 范围：job, scope, done criteria
project/.agents/skills/         # 可复用 skills（关键词触发）
```

**配置参数**：
```toml
# Fallback 文件名（AGENTS.md 缺失时使用）
project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]

# 最大字节数（默认 32768）
project_doc_max_bytes = 65536

# 内联指令（注入到 AGENTS.md 之前）
developer_instructions = "Always use TypeScript. Prefer functional patterns."

# 完全替换内置基础指令
model_instructions_file = "/path/to/instructions.md"

# 项目根检测标记（默认 [".git"]）
project_root_markers = [".git", ".hg", ".sl"]
```

**覆盖文件**：
- `AGENTS.override.md` 在任何层级**替换**该层级的 `AGENTS.md`（非累加）
- 用途：临时指令变更、开发者个人覆盖（gitignore）、测试不同指令集

### 2.3 Skills 系统

**SKILL.md 格式**：
- 必需文件 `SKILL.md`（YAML frontmatter + markdown 主体）
- Frontmatter 字段：
  - `name`：唯一标识符
  - `description`：决定 Codex 何时激活该 skill

**目录结构**：
```
my-skill/
├── SKILL.md                # 必需：frontmatter + instructions
├── scripts/                # 可执行脚本
├── references/             # 模板、schemas、配置示例
├── assets/                 # 非代码资源（图表、示例数据）
└── agents/
    └── openai.yaml         # Agent 特定元数据
```

**5 个存储位置**：

| Location | Path | Scope | Use Case |
|----------|------|-------|----------|
| **REPO** | `.agents/skills/` | 项目级 | 团队共享 |
| **USER** | `~/.agents/skills/` | 用户全局 | 个人跨项目 |
| **ADMIN** | `/etc/codex/skills/` | 机器级 | IT 托管 |
| **SYSTEM** | Codex 安装包 | 安装级 | 内置 skill |
| **DEFAULTS** | 内部默认 | 始终可用 | `$skill-creator` 等核心 |

**调用方式**：
- **隐式调用**：Codex 自动激活（基于 description 关键词匹配）
- **显式调用**：`$skill-name`（精确控制）
- **内置 skill**：`$skill-creator`（脚手架）、`$skill-installer`（从社区注册表安装）

**Plugin 系统**：
- 通过 `/plugins install` CLI 命令从注册表获取
- Desktop/Web app 有 plugin 浏览器
- 启用/禁用：config.toml `[skills]` 段

### 2.4 Subagents（GA March 2026）

**内置 subagents**（3 个）：
- `default` - 通用 helper
- `explorer` - 代码库探索/只读任务
- `reviewer` - 代码审查

**配置位置**：
- `.codex/agents/<name>.toml` - 自定义 agent
- `[agents.<name>]` - TOML 角色配置
- `[agents]` - 全局设置

**特性**：
- 并行 subagent 编排
- CSV 批处理
- 隔离的执行上下文

---

## 三、Trae SOLO 模式最新功能

### 3.1 核心架构演进

**v3.3.70**（2026-06-26）：
- 智能体架构优化
- 内置智能体整合后保留 Chat、Agent
- 底层架构轻量化

**v3.5.55-56**（2026-05-08）：
- 合并 Builder & Builder With MCP → Agent
- 合并 SOLO Builder & SOLO Coder → SOLO Agent
- `.trae/commands/` 目录支持 3 级嵌套

### 3.2 关键能力矩阵

| 能力 | 描述 | 时间 |
|------|------|------|
| **Skills 技能** | SOLO 模式支持 Skills 技能 | 2026-01-14 |
| **Agent Skills** | 上传/添加 Skills 扩展 agent 能力 | 2026-Q2 |
| **Conversation Skills** | 在对话流中直接创建 Skills | 2026-Q2 |
| **Memory 功能** | Memory 功能 beta 测试 | 2026-Q2 |
| **Global/Project Memory** | 全局/项目级记忆类型 | 2026-Q2 |
| **Memory 手动管理** | 添加/移除记忆条目 | 2026-Q2 |
| **Hooks** | 设置 → Hooks 中配置 | 2026-06-12 |
| **Plugin Marketplace** | 插件市场上线 | 2026-07-21 |
| **Video Generation** | TRAE Work 支持视频生成 | 2026-07-21 |
| **Browser Use** | 内置浏览器配置页（个人版） | 2026-07-18 |
| **Voice Discussion** | 语音讨论 + 拍照 + 附件 | 2026-07-07 |
| **HTML Output Default** | 产物默认格式为 HTML | 2026-06-24 |
| **Global Memory** | 全局记忆沉淀专属知识库 | 2026-06-24 |
| **Hooks 配置** | 可视化 Hooks 配置 | 2026-06-12 |

### 3.3 SOLO 模式核心能力

> "SOLO is our most advanced coding agent. It is truly responsive to your ideas, your context, and your workflow."

- 任务委派 + 完整解决方案输出
- 实时视觉控制 + AI 处理复杂性
- IDE 模式与 SOLO 模式无缝切换
- 多 agent 协作
- 内置 agent + 自定义 agent
- 开放 agent 生态系统（社区分享）

### 3.4 智能体路由设计（TRAE Kit Multi-Agents）

```
You type → dev agent reads context → right specialist activated → expert-level response
```

**中央 dev 路由器职责**：
1. 分类请求（question / survey / simple code / complex / design / command）
2. 选择领域专业 agent
3. 宣布：`🤖 @[agent-name] activated`
4. 读取 agent 文件 + 相关 skills
5. 执行完整专业深度

**路由表**：
- UI / layout / design → @frontend-specialist
- API / backend / DB → @backend-specialist
- bug / error / crash → @debugger
- deploy / CI-CD → @devops-engineer
- plan / roadmap → @project-planner
- security / auth → @security-auditor
- test / TDD / coverage → @test-engineer
- mobile / RN / Flutter → @mobile-developer
- optimize / perf → @performance-optimizer
- docs / README → @documentation-writer

---

## 四、与本项目当前实现的差距

### 4.1 已有能力

| 能力 | 当前实现 | 位置 |
|------|---------|------|
| Skills 后端 | SkillService（3 个内置 skill） | backend/app/services/skills.py |
| Hooks 处理器 | Commit Hook + Task Hook | backend/app/main.py |
| Subagent 调度 | ArchitectureDesigner + Critic | backend/app/services/ |
| AGENTS.md Memory | AgentsMdMemoryService | backend/app/services/agents_md_memory.py |
| Memory | AGENTS.md + Memory | backend/app/services/ |
| Workflow Engine | Loop Engineering | backend/app/services/ |

### 4.2 缺失能力

1. **Codex 风格 AGENTS.md 字节限制 + override 机制**
   - 当前：未实现字节限制
   - 需要：`project_doc_max_bytes` 配置 + override 文件支持

2. **SKILL.md 格式 + 5 个存储位置**
   - 当前：自定义 skill 格式
   - 需要：YAML frontmatter + 标准化目录结构 + 5 个位置

3. **Plugin Marketplace**
   - 当前：无
   - 需要：plugin 注册表 + install/uninstall 流程

4. **Subagent TOML 配置**
   - 当前：Python dataclass
   - 需要：TOML/YAML 配置文件

5. **Hooks 配置可视化**
   - 当前：仅后端
   - 需要：前端 Hooks 配置 UI

6. **隐式/显式 skill 调用**
   - 当前：仅显式（手动选择）
   - 需要：关键词触发的隐式调用

7. **Browser Use 工具**
   - 当前：无
   - 需要：内嵌浏览器 + DOM 元素选择

---

## 五、参考资料

- [Codex CLI Customisation Stack - 官方架构解析](https://codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system/)
- [Codex CLI Agents & Skills Reference (CodeAlive-AI)](https://github.com/CodeAlive-AI/ai-driven-development/blob/main/skills/subagents-management/references/codex-agents.md)
- [Codex Skills & Plugins 完整指南](https://opentools.ai/resources/codex-skills-and-plugins)
- [深入解析 Codex 智能体循环 - OpenAI 工程博客](https://openai.com/zh-Hans-CN/index/unrolling-the-codex-agent-loop/)
- [TRAE 官网 - SOLO 模式介绍](https://www.trae.ai/)
- [TRAE 更新日志](https://www.trae.ai/changelog)
- [TRAE CN 更新日志](https://www.trae.cn/changelog)
- [TRAE Kit Multi-Agents - 路由器设计](https://github.com/PedroIves/TRAE_Kit-Multi-Agents)
- [TRAE Skills from Claude Code Plugins](https://github.com/yihui504/TRAE-skills-from-CC-plugins)
- [Codex CLI Best Practices](https://github.com/shanraisshan/codex-cli-best-practice)

---

**调研完成时间**：2026-08-05
**调研输出**：本报告 + 后续 spec 任务文档
