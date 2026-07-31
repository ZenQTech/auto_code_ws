# Cycle 8 调研报告 - Slash Commands + Skills Ecosystem + TRAE Custom Models

> **调研日期**: 2026-07-27
> **调研者**: 自动循环工程任务
> **覆盖版本**: Codex v0.150+ / TRAE v2.0+ / Claude Code (参考)
> **任务**: 整合 codex/trae solo 模式下一阶段核心功能

---

## 一、调研目标

调研 Codex v0.150+ 和 TRAE v2.0+ 在以下方面的最新功能：
1. Slash Commands 系统（40+ commands）
2. Skills 生态（用户自定义技能）
3. Custom Models 管理
4. Custom Agents 编排
5. DiffView 集成
6. Loop Engineering Workflows

---

## 二、Codex v0.150+ Slash Commands 完整目录

### 2.1 导航与会话 (Navigation & Session)
| Command | 功能 |
|---------|------|
| `/browser` | 打开内置浏览器 |
| `/chrome` | 连接到本地 Chrome 浏览器 |
| `/new` | 在对话中开启新聊天 |
| `/resume` | 恢复当前目录的历史会话 |
| `/quit` | 退出 Codex |
| `/logout` | 登出 Codex 账号 |
| `/login` | 管理 Code 登录（选择/添加/断开） |
| `/settings [section]` | 打开设置面板，可指定 `model`/`theme`/`agents`/`limits`/`chrome`/`mcp`/`notifications` |

### 2.2 工作区与 Git (Workspace & Git)
| Command | 功能 |
|---------|------|
| `/init` | 创建 AGENTS.md 项目记忆文件 |
| `/diff` | 显示 git diff（含未跟踪文件） |
| `/undo` | 打开快照选择器，恢复到 Codex 之前的快照 |
| `/branch [task]` | 创建 worktree 分支并切换 |
| `/merge` | 合并 worktree 分支回主分支 |
| `/review [focus]` | 代码审查（无需参数打开审查选择器） |
| `/cloud` | 浏览 Codex Cloud 任务 |
| `/cmd <name>` | 执行项目命令 |

### 2.3 UX 与显示 (UX & Display)
| Command | 功能 |
|---------|------|
| `/theme` | 定制应用主题 |
| `/verbosity (high|medium|low)` | 改变文本详细度 |
| `/model` | 选择默认模型 |
| `/reasoning (minimal|low|medium|high)` | 改变推理强度 |
| `/prompts` | 显示示例提示 |
| `/status` | 显示当前会话配置和 token 使用 |
| `/limits` | 调整会话限制和限速 |
| `/update` | 检查并升级 Codex |
| `/notifications [status|on|off]` | 管理通知 |
| `/mcp [status|on|off <name>|add]` | 管理 MCP 服务器 |
| `/validation [status|on|off|<tool>]` | 检查或切换验证设置 |

### 2.4 搜索与提及 (Search & Mentions)
| Command | 功能 |
|---------|------|
| `/mention` | 提及文件（打开文件搜索） |

### 2.5 性能与智能体 (Performance & Agents)
| Command | 功能 |
|---------|------|
| `/perf (on|off|show|reset)` | 性能追踪控制 |
| `/agents` | 配置智能体和子智能体命令 |
| `/auto [goal]` | 启动维护者风格自动协调器 |

### 2.6 多智能体 Prompt 扩展 (Prompt-Expanding)
| Command | 功能 |
|---------|------|
| `/plan <task>` | 创建综合规划（多智能体） |
| `/solve <problem>` | 解决复杂问题（多智能体） |
| `/code <task>` | 执行编码任务（多智能体） |

### 2.7 实验性 (Experimental)
| Command | 功能 |
|---------|------|
| `/approve` | 一次性重试最近被自动审查拒绝的命令 |
| `/experimental` | 切换可选功能（需重启） |
| `/memories` | 配置记忆使用和生成 |

---

## 三、TRAE Slash Commands 系统

### 3.1 内置命令 (Built-in)
- `/plan` - 调用 Plan 模式
- `/spec` - 调用 Spec 模式

### 3.2 自定义命令 (Custom Commands)
- **Project command**: `.trae/commands/` 目录下存放 `.md` 文件
- **Global command**: `~/.trae/commands/` 目录下存放
- 支持 3 级嵌套目录分类
- 文件格式：
  ```yaml
  Name: summarize-pr-info
  Description: 总结 PR 信息
  ---
  Instructions: |
    Review the code changes in the current pull request, compare the code before and after the changes, and summarize the main changes of this pull request.
  ```

### 3.3 使用方式
- 在聊天框输入 `/` 触发命令选择器
- 通过 `#` 快速匹配
- 通过 `@skills/.../SKILL.md` 文件引用

---

## 四、Loop Engineering 模式参考

### 4.1 /loop 体系
```
/loop roadmap <项目>          项目级拆分
/loop council <项目>          多模型项目级拆分
/loop triage | plan | execute | verify-fix   单步执行
/loop watch plan | execute | verify          多终端自动接力
```

### 4.2 三角色分工 (TRAE Kit)
- **策划 Agent** (Planner)
- **执行 Agent** (Coder)
- **校验 Agent** (Reviewer)
- 各绑不同模型 + 渐进阶段 (L1→L2→L3) + 确定性门禁

### 4.3 20 个专家智能体 (TRAE Kit)
- frontend-specialist, backend-specialist
- debugger, devops-engineer
- project-planner, security-auditor
- test-engineer, mobile-developer
- performance-optimizer, documentation-writer
- ...

---

## 五、Codex v0.150+ 其他关键功能

### 5.1 GPT-5.3-Codex-Spark
- 1,000+ tokens/sec 实时编码模型
- 适合 inline edit / quick edits

### 5.2 Windows Sandbox
- OS-level network isolation (proxy-only egress)
- 防止 env var bypass
- 进程树全部继承沙箱限制

### 5.3 ChatGPT Device Code Login
- 6 位数设备码
- 无浏览器环境身份验证
- SSH/Docker/CI 友好

### 5.4 prompt-plus-stdin
- 管道输入 + 单独 prompt 同时使用
- 适合 shell pipeline 工作流

### 5.5 Dynamic Bearer Tokens
- 自定义模型提供商的自动刷新

### 5.6 codex sandbox 子命令
- 独立 sandbox 入口
- macOS Seatbelt / Linux Landlock / Windows restricted-token
- 无需调用模型即可获得沙箱保护

---

## 六、当前项目差距分析

### 6.1 已有功能 (vs 调研)
| 功能 | 当前状态 | 来源 |
|------|----------|------|
| Hook 事件系统 | ✅ 已实现 | Codex v0.150+ |
| SubAgent Memory | ✅ 已实现 | TRAE SubAgent |
| Multi-Agent Path Tree | ✅ 已实现 | Codex v0.121+ |
| OAuth 2.1 + PKCE | ✅ 已实现 | MCP Authorization |
| Session Rollout JSONL | ✅ 已实现 | Codex v0.136+ |
| TRACE Correction-to-Enforcement | ✅ 已实现 | Zhou et al. 论文 |
| LLM 4 层缓存 | ✅ 已实现 | 自研 |
| 流式恢复网关 | ✅ 已实现 | 自研 |
| SSE 重连 | ✅ 已实现 | 自研 |
| React Router SPA | ✅ 已实现 | v6.3 |
| Plan Mode | ✅ 已实现 | TRAE /plan |
| Spec/Task/Checklist | ✅ 已实现 | TRAE /spec |
| Loop Engineering Workflow | ✅ 已实现 | 自研 |
| MCP 服务器面板 | ✅ 已实现 | MCP |
| 4 层规则扫描 | ✅ 已实现 | Cycle 3 |

### 6.2 未实现功能 (Cycle 8 候选)

#### P0 - 核心未实现
1. **Slash Commands 系统** ❌ 缺失
   - 当前项目无 `/init`, `/status`, `/plan`, `/review`, `/mcp` 等命令
   - 用户无法快速触发预设工作流
   - 状态: 核心交互模式未实现

2. **Custom Skills / Commands (.trae/commands/)** ❌ 缺失
   - 当前项目无 .trae/commands 目录
   - 无项目级或全局级自定义命令
   - 用户无法扩展智能体能力

3. **Custom Models 管理** ❌ 缺失
   - 当前项目仅支持单一模型列表
   - 无动态 bearer token 刷新
   - 无自定义模型注册 API

#### P1 - 增强功能
4. **DiffView (代码修改可视化)** ❌ 缺失
   - 当前项目无 DiffView 组件
   - TRAE 的标志性功能
   - 状态: 仅在 CodeViewer 显示代码

5. **Custom Agents 路由层** ⚠️ 部分
   - 已有 MultiAgentRegistry，但缺少 Specialist Agents 路由
   - TRAE Kit 的核心架构

6. **Loop Engineering /loop 命令** ❌ 缺失
   - 当前 Loop Engineering 通过 UI 触发
   - 缺少 /loop triage/plan/execute/verify 命令

#### P2 - 长期
7. **Codex Sandbox 子命令** ❌ (后端独立 sandbox)
8. **Device Code Login** ❌
9. **prompt-plus-stdin** ❌
10. **Cloud-managed Config Bundles** ❌
11. **Figma to Code** ❌
12. **Supabase/Vercel/Stripe 集成** ❌
13. **Multitasking UI** ⚠️ 部分（MultiAgentTreePanel）

---

## 七、Cycle 8 实施任务规划

### 7.1 P0 任务 (高优先级)
1. **P0-12: Slash Commands 系统** - 整合 12+ 核心命令
   - 后端: slash command registry + executor
   - 前端: / 触发命令选择器 UI
   - 整合 Plan/Spec/Review/MCP/Skills/Hooks 已有功能
   - 实现: /init /status /plan /spec /review /mcp /agents /next /goal /model /approvals /help

2. **P0-13: Custom Skills / Commands (.trae/commands/)**
   - 后端: .trae/commands 目录扫描 + 解析
   - 前端: Skills & Commands 管理面板
   - 支持项目级/全局级命令
   - 支持 3 级嵌套目录分类

3. **P0-14: Custom Models + Bearer Token Auto-Refresh**
   - 后端: 自定义模型注册 API + 令牌刷新
   - 前端: Custom Models 管理 UI
   - 支持 DeepSeek/GLM/MiniMax/Kimi 等 OpenAI-compatible 提供商

### 7.2 P1 任务
4. **P1-3: DiffView 组件** - 代码修改可视化
5. **P1-4: Loop Engineering /loop 命令集** - /loop triage/plan/execute/verify
6. **P1-5: Custom Agents 路由层** - 借鉴 TRAE Kit 20 specialist agents

### 7.3 优先级评估
- **P0-12 Slash Commands**: 5/5（核心交互模式，缺失影响所有用户操作）
- **P0-13 Custom Skills**: 4/5（扩展性关键）
- **P0-14 Custom Models**: 4/5（多模型支持）
- **P1-3 DiffView**: 3/5（增强体验）
- **P1-4 /loop 命令**: 3/5（与已有 Loop 引擎互补）
- **P1-5 Custom Agents 路由**: 3/5（与 MultiAgentRegistry 整合）

---

## 八、Cycle 8 目标

完成 P0 三个任务，达到：
- 12+ slash commands 全部可用
- Custom skills/commands 完整支持
- Custom models 完整管理
- 100% 自动化测试通过
- 0 个 critical bug

---

## 九、参考来源

1. [Codex CLI changelog](https://developers.openai.com/codex/changelog?type=codex-cli) - 官方更新日志
2. [Codex CLI slash-commands](https://developers.openai.com/codex/cli/slash-commands) - 官方 slash commands 文档
3. [Codex Slash Commands Complete Reference 2026](https://explainx.ai/blog/codex-slash-commands-complete-reference-guide-2026) - 综合参考
4. [Codex sandbox subcommand](https://codex.danielvaughan.com/2026/06/04/codex-cli-sandbox-subcommand-standalone-command-isolation-platform-native-security/) - Sandbox 详细分析
5. [TRAE Commands 文档](https://docs.trae.ai/ide/slash-commands) - TRAE 官方 commands 文档
6. [TRAE SOLO Mode](https://docs.trae.ai/ide/solo-mode?_lang=en) - SOLO 模式总览
7. [TRAE Kit Multi-Agents](https://github.com/PedroIves/TRAE_Kit-Multi-Agents) - 20 specialist agents 架构
8. [Loop System](https://github.com/Yamin2222/loop-system) - /loop 体系参考
9. [OpenAI Codex CLI 2026 Update](https://daily1bite.com/en/blog/ai-tools/openai-codex-cli-april-2026-update) - 最新功能总结
10. [ARIS Trae Adaptation Guide](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep/blob/main/docs/TRAE_ARIS_RUNBOOK_EN.md) - Skills/Commands 适配
