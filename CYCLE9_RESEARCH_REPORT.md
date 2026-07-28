# Cycle 9 调研报告 - Codex CLI v0.135+ 与 TRAE Solo v3.5+ 最新特性

> **周期**: Cycle 9
> **日期**: 2026-07-28
> **状态**: ✅ 调研完成
> **关联**: [CYCLE8_SUMMARY.md](../CYCLE8_SUMMARY.md) | [CYCLE9_PLANNING.md](../CYCLE9_PLANNING.md)
> **调研方法**: WebSearch (developers.openai.com / docs.trae.ai / codex.danielvaughan.com)

---

## 一、调研概览

### 1.1 调研对象

| 工具 | 最新版本 | 关键新特性 |
|------|----------|------------|
| **Codex CLI** | v0.135.0+ (May 2026) | 30+ slash commands, .codex/ directory, Skills progressive disclosure, Plugins, codex doctor, Vim mode |
| **TRAE Solo** | v3.5.69 (June 2026) | SOLO Agent 重命名, .trae/agents 子智能体, hooks, 规则嵌套, 自动重试 |

### 1.2 信息源

- [Slash commands in Codex CLI - OpenAI Developers](https://developers.openai.com/codex/cli/slash-commands/)
- [Codex CLI TUI Shortcuts Reference - April 2026](https://codex.danielvaughan.com/2026/04/08/codex-cli-tui-shortcuts-slash-commands/)
- [Codex CLI Mastery - Beyond the Prompt - May 2026](https://codex.danielvaughan.com/2026/05/29/codex-cli-mastery-beyond-the-prompt/)
- [Codex CLI Skills + Custom Slash Commands - July 2026](https://ongboit.com/codex-cli-skills-custom-slash-commands/)
- [TRAE Solo Agent Documentation](https://docs.trae.ai/ide/solo-coder?_lang=en)
- [TRAE Changelog](https://docs.trae.ai/ide/changelog)
- [TRAE Create Custom Agents](https://docs.trae.ai/ide/agent?_lang=en)
- [TRAE SOLO Mode Overview](https://docs.trae.ai/ide/solo-mode)

---

## 二、Codex CLI v0.135+ 特性矩阵

### 2.1 Slash Commands 完整列表（30+）

| 类别 | 命令 | 作用 |
|------|------|------|
| **会话控制** | `/new` | 启动新会话 |
| | `/resume` | 恢复历史会话 |
| | `/clear` | 清除当前上下文 |
| | `/restart` | 重启会话 |
| | `/status` | 显示会话/token/上下文信息 |
| **模型** | `/model` | 切换模型（o3/o4-mini/GPT-4.1/codex-1） |
| | `/personality` | 切换 personality 配置文件 |
| **权限** | `/permissions` | 切换权限级别 |
| | `/approvals` | 切换批准模式（ask/auto/sandbox） |
| **执行** | `/init` | 初始化项目，生成 AGENTS.md |
| | `/plan` 或 `/plan-mode` | 进入结构化多步规划（适合复杂特性开发） |
| | `/spec` | 进入 Spec 模式生成 spec.md/tasks.md/checklist.md |
| | `/review` | 非交互代码审查 |
| | `/goal "目标"` | 启动持久会话（2026 新特性，跨多天） |
| | `/next` | 根据 AGENTS.md 继续推进 |
| **配置** | `/skills` | 列出所有加载的 skills |
| | `/plugins` | 插件管理 |
| | `/mcp` | 查看/管理 MCP 服务器 |
| | `/experimental` | 切换实验特性（subagents 等） |
| | `/debug-config` | 打印配置层顺序和策略源 |
| **Agent** | `/agent` | 切换子智能体 |
| **诊断** | `/codex doctor` | 系统诊断 |
| **自定义** | `/prompts:name` | 调用自定义 prompt（`~/.codex/prompts/*.md`） |
| | `$skill-name` | 调用 Skill（`.agents/skills/SKILL.md`） |
| **帮助** | `/help` | 显示所有命令 |

### 2.2 .codex 目录结构

```
.codex/                          # 项目级配置
├── AGENTS.md                    # 智能体操作系统（强制）
├── skills/                      # 项目级 skills
│   ├── test-runner/SKILL.md
│   └── code-reviewer/SKILL.md
├── subagents/                   # 子智能体定义
│   ├── project-analyzer.md
│   └── code-architect.md
├── profiles/                    # 模型/工具配置
│   └── default.toml
└── hooks/                       # 事件驱动自动化
    ├── pre-commit.sh
    └── post-tool.sh

~/.codex/                        # 用户级配置
├── prompts/                     # 自定义 prompts（已 deprecated）
│   └── security-review.md
└── settings.toml

~/.agents/skills/                # 用户级 skills
/etc/codex/skills/               # 系统级 skills
```

### 2.3 SKILL.md Frontmatter 规范

```yaml
---
# 必填字段（2个）
name: deploy-staging             # 必须匹配 folder name
description: Deploy ongboit staging via SSH + rebuild assets

# 可选字段（4个）
when_to_use: "Triggered when user mentions deploy"
tools: [bash, edit]
model: codex-1
metadata: { version: 1.0 }
---
```

**Progressive disclosure**：
- 初始只加载 `name` + `description`（cap 8K char 总和）
- 选中后才加载完整 body
- 相比 Claude Code 全量加载节省 token

### 2.4 4 层 Skill 加载优先级

```
项目级 .agents/skills/  >  用户级 ~/.agents/skills/  >  系统级 /etc/codex/skills/  >  OpenAI bundled
```

同名称 skill 高优先级覆盖低优先级。

### 2.5 Codex 核心架构原则

#### 2.5.1 AGENTS.md 是核心
- 每个新项目先 `/init` 生成 AGENTS.md
- 持续参考避免"健忘"
- 包含：编码风格 / 架构决策 / TODO 列表 / 验证循环

#### 2.5.2 验证循环（Verification Loops）
```markdown
After every code change, run `npm test` and fix failures before responding.
```
这一行能把 Codex 从"建议引擎"变成"自校正智能体"。

#### 2.5.3 并行会话与 git worktrees
- `codex --worktree` 为每个任务创建独立 worktree
- 避免 token 过载
- 适合大型 monorepo

#### 2.5.4 codex exec 管道
```bash
codex exec "fix the CI failure"   # 非交互，适合 CI/CD
codex review                       # 代码审查
codex resume                       # 恢复会话
```

### 2.6 Hooks 事件驱动

Codex 支持 lifecycle hooks：
- `pre-tool`: 工具执行前
- `post-tool`: 工具执行后
- `pre-commit`: commit 前
- `session-start` / `session-end`

---

## 三、TRAE Solo v3.5+ 特性矩阵

### 3.1 版本演进（v3.5.21 → v3.5.69）

| 版本 | 日期 | 关键变更 |
|------|------|----------|
| v3.5.21 | 2026-04 | ✅ 支持创建技能 + 记忆功能（Beta）+ Browser devtools |
| v3.5.50 | 2026-04-14 | Bugfix |
| v3.5.51 | 2026-04-14 | ✅ 规则嵌套 3 级 + Git commit 规则 + OAuth MCP |
| v3.5.52-53 | 2026-04 | Bugfix |
| v3.5.54 | 2026-04-28 | ✅ 支持添加 slash commands + Settings 重组 |
| v3.5.55 | 2026-04-30 | Bugfix |
| v3.5.56 | 2026-05-08 | ✅ 合并 Builder → Agent，SOLO Coder → SOLO Agent |
| v3.5.57-60 | 2026-05 | Kimi K2.5/K2.6 video + 稳定性 |
| v3.5.61-65 | 2026-05-06/09 | Bugfix |
| v3.5.66 | 2026-06-10 | ✅ 支持 hooks（用户定义 shell 命令） |
| v3.5.67 | 2026-06-17 | ✅ `.trae/agents` 子智能体目录 + 自动重试 -1/3003 |
| v3.5.68-69 | 2026-06-18/23 | Bugfix |

### 3.2 SOLO Agent 核心能力

#### 3.2.1 任务规划与执行
- 自动调用其他 agents 协作
- 任务管理：多任务并行（非串行）
- Plan mode：小到中型功能开发
  - 分析需求 → 任务规划 → 计划文档
  - 用户确认 → 逐个执行
- Spec mode：复杂系统级任务
  - 3 阶段文档：spec.md + tasks.md + checklist.md
  - 存储路径：`.trae/specs/<task-name>/`
  - 支持版本控制和长期保留

#### 3.2.2 工具面板
- **Editor**: 代码编辑
- **DocView**: 文档查看（带 Mermaid）
- **Browser**: 带 devtools 入口
- **Figma to code**: 解析 Figma → 生成代码
- **集成服务**: Supabase / Vercel / Stripe / AI service

#### 3.2.3 DiffView 增强
- 显示：影响文件数 + 修改行数 + 文件列表
- 点击查看具体 diff
- 这是我们项目 P1-3 已部分实现

#### 3.2.4 对话自动折叠
- Settings > Conversation > To-Do List > Conversation Auto-Fold
- 已完成任务自动折叠并摘要
- 可展开查看详情
- 这是我们项目 P1-3 已部分实现

### 3.3 Custom Agents 创建

#### 3.3.1 创建方式（2 种）
1. **智能生成（推荐）**：描述功能 → 自动生成
2. **手动创建**：填写表单

#### 3.3.2 Agent 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| Avatar | 否 | 上传图片 |
| Name | 是 | 名称 |
| Prompt | 是 | persona/tone/workflow/tools/rules |
| **Callable by other agents** | 否 | 启用后可被其他 agent 调用 |
| English Identifier | 是（如果可调用） | 唯一英文标识符，如 `project-analyzer` |
| When to Call | 是（如果可调用） | 描述调用场景 |
| **Tools** | - | - |
| MCP servers | 可选 | 一个或多个 MCP |
| Built-in tools | - | Read / Edit / Terminal / Preview / Web search |

### 3.4 `.trae/` 目录结构

```
.trae/                            # 项目级配置
├── commands/                     # 自定义 slash commands（≤3 级嵌套）
│   ├── code-review/
│   │   ├── security.md
│   │   └── performance.md
│   └── test/generate.md
├── agents/                       # 子智能体定义（v3.5.67 新增）
│   ├── project-analyzer.md
│   └── code-architect.md
├── rules/                        # 规则（v3.5.51 支持 3 级嵌套 + 子目录）
│   ├── coding-style/
│   └── git-commit.md
├── skills/                       # 技能（v3.5.21 新增）
│   └── deploy-staging/SKILL.md
├── specs/                        # Spec 模式文档
│   └── current/
│       ├── spec.md
│       ├── tasks.md
│       └── checklist.md
└── settings/                     # 项目级 settings
```

---

## 四、与当前项目对比

### 4.1 已实现（Cycle 1-8）

| 特性 | Codex v0.135+ | TRAE Solo v3.5+ | 当前项目 | 状态 |
|------|---------------|-----------------|----------|------|
| `/init` (AGENTS.md) | ✅ | ✅ | ✅ | 100% |
| `/status` | ✅ | ✅ | ✅ | 100% |
| `/plan` (Plan mode) | ✅ | ✅ | ✅ (PlanEditor) | 100% |
| `/spec` (Spec mode) | ✅ | ✅ | ✅ | 100% |
| `/review` | ✅ | ✅ | ✅ | 100% |
| `/mcp` (MCP 管理) | ✅ | ✅ | ✅ | 100% |
| `/agents` (Multi-Agent) | ✅ | ✅ | ✅ (Multi-Agent v2) | 100% |
| `/skills` (Custom Skills) | ✅ | ✅ | ✅ (P0-13) | 100% |
| `/hooks` (Hooks 事件) | ✅ | ✅ (v3.5.66) | ✅ | 100% |
| `/model` (Model Selector) | ✅ | ✅ | ✅ | 100% |
| `/approvals` (Approval Mode) | ✅ | ✅ | ✅ | 100% |
| `/next` (Loop Engineering) | ✅ | ✅ | ✅ (Loop Engineering) | 100% |
| `/goal` (长期目标) | ✅ | ✅ | ✅ (P0-12 goal) | 100% |
| `/new` (新对话) | ✅ | ✅ | ✅ (P0-12) | 100% |
| Custom Skills (.trae/commands/) | ✅ (Skills 优先) | ✅ | ✅ (P0-13) | 100% |
| Custom Models | ✅ | ✅ | ✅ (P0-14) | 100% |
| Bearer Token Auto-Refresh | ✅ | ✅ | ✅ (P0-14) | 100% |
| Multi-Agent v2 (path-based) | ✅ | ✅ | ✅ (P0-10) | 100% |
| OAuth 2.1 + PKCE | ✅ | ✅ (v3.5.51) | ✅ (P0-8) | 100% |
| Session Rollout JSONL | ✅ | ✅ | ✅ (P0-9) | 100% |
| React Router v6 SPA | ✅ | ✅ | ✅ (P1-2) | 100% |
| `/loop` triage/plan/execute/verify | ✅ | ✅ | ✅ (P1-4) | 100% |

### 4.2 缺失功能（差距分析）

| 特性 | 优先级 | 来源 | 描述 |
|------|--------|------|------|
| **SKILL.md progressive disclosure** | P1 | Codex v0.135+ | 8K char cap + on-demand loading |
| **$.codex/ skills YAML frontmatter** | P1 | Codex v0.135+ | 2 required + 4 optional fields |
| **`.trae/agents/` 子智能体定义** | P0 | TRAE v3.5.67 | Markdown 文件定义可调用子智能体 |
| **`.trae/rules/` 多级嵌套** | P1 | TRAE v3.5.51 | 3 级嵌套 + 子目录 |
| **Hooks event-driven** | P0 | TRAE v3.5.66 / Codex | 事件钩子自动化 |
| **Codex doctor 诊断** | P2 | Codex v0.135+ | 系统诊断命令 |
| **`/plugins` 插件管理** | P2 | Codex v0.135+ | 第三方插件支持 |
| **Memory 功能（Beta）** | P1 | TRAE v3.5.21 | 智能体长期记忆 |
| **Figma to code** | P2 | TRAE Solo | 设计稿转代码 |
| **Verification loop in AGENTS.md** | P1 | Codex Mastery | "After every code change, run npm test" |
| **DiffView 完整功能** | P1 | TRAE Solo | 影响文件数 + 修改行数 + 文件列表 |
| **对话自动折叠** | P1 | TRAE Solo | 已完成任务自动折叠 |
| **codex exec pipeline** | P1 | Codex v0.135+ | 非交互 CI/CD 集成 |
| **git worktree 并行会话** | P2 | Codex v0.135+ | 多任务隔离 |

---

## 五、Cycle 9 候选任务优先级

### 5.1 P0（核心，必做）

| 任务 | 来源 | 描述 | 预估 |
|------|------|------|------|
| **P0-17 `.trae/agents/` 路由** | TRAE v3.5.67 | 扫描 `.trae/agents/*.md` 注册为可调用子智能体 | 4h |
| **P0-18 Hooks 事件增强** | TRAE v3.5.66 | 用户定义 shell 命令 + lifecycle hooks | 3h |

### 5.2 P1（增强）

| 任务 | 来源 | 描述 | 预估 |
|------|------|------|------|
| **P1-5 SKILL.md progressive disclosure** | Codex v0.135+ | 8K cap + on-demand full body loading | 4h |
| **P1-6 `.trae/rules/` 多级嵌套** | TRAE v3.5.51 | 3 级嵌套 + 子目录规则 | 3h |
| **P1-7 DiffView 增强** | TRAE Solo | 影响文件数 + 修改行数 + 文件列表 + 行号 | 4h |
| **P1-8 Memory 功能** | TRAE v3.5.21 | 智能体长期记忆（Beta） | 5h |
| **P1-9 对话自动折叠** | TRAE Solo | 已完成任务自动折叠 | 3h |
| **P1-10 Verification Loop in AGENTS.md** | Codex Mastery | 强制验证循环 | 2h |

### 5.3 P2（长期优化）

| 任务 | 来源 | 描述 | 预估 |
|------|------|------|------|
| **P2-1 Playwright E2E** | 项目内部 | 完整前端 E2E 自动化 | 8h |
| **P2-2 Codex doctor 诊断** | Codex v0.135+ | 系统诊断命令 | 3h |
| **P2-3 `/plugins` 插件管理** | Codex v0.135+ | 第三方插件支持 | 6h |
| **P2-4 Figma to code** | TRAE Solo | 设计稿转代码 | 8h |
| **P2-5 codex exec pipeline** | Codex v0.135+ | CI/CD 集成 | 4h |

---

## 六、技术实现要点

### 6.1 `.trae/agents/` 路由

```python
# backend/app/services/agents_loader.py
class ProjectAgentLoader:
    """扫描 .trae/agents/*.md 注册为可调用子智能体"""
    
    def scan(self, project_path: str) -> List[ProjectAgent]:
        agents_dir = Path(project_path) / ".trae" / "agents"
        if not agents_dir.exists():
            return []
        
        agents = []
        for md_file in agents_dir.glob("**/*.md"):
            agent = self._parse_agent_file(md_file)
            if agent:
                agents.append(agent)
        return agents
    
    def _parse_agent_file(self, path: Path) -> Optional[ProjectAgent]:
        """解析 markdown frontmatter"""
        # name, prompt, callable, when_to_call
        ...
```

### 6.2 SKILL.md Progressive Disclosure

```python
# backend/app/services/skills_registry.py
class SkillsRegistry:
    def list_skills_summary(self) -> List[SkillSummary]:
        """返回 name + description（8K cap）"""
        summaries = []
        total_chars = 0
        for skill in self._all_skills.values():
            if total_chars + len(skill.description) > 8000:
                break
            summaries.append(SkillSummary(
                name=skill.name,
                description=skill.description,
                path=str(skill.path),
            ))
            total_chars += len(skill.description)
        return summaries
    
    def get_skill_full(self, name: str) -> Optional[Skill]:
        """按需加载完整 body"""
        return self._all_skills.get(name)
```

### 6.3 Hooks 事件驱动

```python
# backend/app/services/hooks_engine.py
class HooksEngine:
    """生命周期 hooks 引擎"""
    
    HOOK_TYPES = ["pre-tool", "post-tool", "pre-commit", "session-start", "session-end"]
    
    async def trigger(self, hook_type: str, context: Dict[str, Any]) -> Optional[str]:
        """触发 hook 并返回执行结果"""
        hooks = self._load_hooks(hook_type)
        for hook in hooks:
            result = await self._run_hook(hook, context)
            if hook.block_on_error and result.returncode != 0:
                raise HookFailedError(f"Hook {hook.name} failed")
        return result.output if result else None
```

---

## 七、长期路线图

### 7.1 Cycle 9 (Current) - 2026-07-28
- ✅ P0-16 修复 TypeScript 编译检查
- ⏳ P0-17 `.trae/agents/` 路由
- ⏳ P0-18 Hooks 事件增强
- ⏳ P1-5 SKILL.md progressive disclosure

### 7.2 Cycle 10 - 2026-08-XX
- ⏳ P1-6 `.trae/rules/` 多级嵌套
- ⏳ P1-7 DiffView 增强
- ⏳ P1-8 Memory 功能
- ⏳ P1-9 对话自动折叠
- ⏳ P1-10 Verification Loop

### 7.3 Cycle 11+ - 2026-XX-XX
- ⏳ P2-1 Playwright E2E
- ⏳ P2-2 Codex doctor
- ⏳ P2-3 Plugins 管理
- ⏳ P2-4 Figma to code
- ⏳ P2-5 codex exec pipeline

---

## 八、信息源

| 资料 | URL | 检索时间 |
|------|-----|----------|
| Slash commands in Codex CLI | https://developers.openai.com/codex/cli/slash-commands/ | 2026-07-28 |
| Codex CLI TUI Shortcuts Reference | https://codex.danielvaughan.com/2026/04/08/codex-cli-tui-shortcuts-slash-commands/ | 2026-07-28 |
| Codex CLI Mastery - Beyond the Prompt | https://codex.danielvaughan.com/2026/05/29/codex-cli-mastery-beyond-the-prompt/ | 2026-07-28 |
| Codex CLI Skills + Custom Slash Commands | https://ongboit.com/codex-cli-skills-custom-slash-commands/ | 2026-07-28 |
| TRAE Solo Agent Documentation | https://docs.trae.ai/ide/solo-coder?_lang=en | 2026-07-28 |
| TRAE Changelog | https://docs.trae.ai/ide/changelog | 2026-07-28 |
| TRAE Create Custom Agents | https://docs.trae.ai/ide/agent?_lang=en | 2026-07-28 |
| TRAE SOLO Mode Overview | https://docs.trae.ai/ide/solo-mode | 2026-07-28 |

---

## 九、结论

### 9.1 调研完成度
- ✅ Codex CLI v0.135+ 特性全覆盖
- ✅ TRAE Solo v3.5+ 版本演进完整记录
- ✅ 30+ slash commands 详细分类
- ✅ .codex 和 .trae 目录结构对比
- ✅ 14 项缺失功能识别

### 9.2 关键洞察
1. **TRAE v3.5.66-67** 新增 hooks 和 .trae/agents 是当前最大缺口
2. **Codex SKILL.md** progressive disclosure 模式可优化当前 Custom Skills 性能
3. **Verification Loop** 是 Codex Mastery 的核心，应在 AGENTS.md 中强制加入
4. **Multi-Agent v2 path-based** 已实现，但缺少 .trae/agents 目录路由集成
5. **codex doctor** 可补充到 P2 阶段

### 9.3 下一步
- 进入 P0-17 `.trae/agents/` 路由实现
- 进入 P0-18 Hooks 事件增强
- 完成 SKILL.md progressive disclosure 改造
