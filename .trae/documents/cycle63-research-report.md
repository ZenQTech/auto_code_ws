# CYCLE 63 互联网调研报告：Codex CLI + Trae SOLO 新功能深度分析

> **调研日期**: 2026-08-04
> **Cycle**: 63 (启动新一轮循环)
> **调研目标**: Codex CLI v0.105+ ~ v0.145+ 与 Trae SOLO 模式新功能，发现 P1/P2 阶段实现机会
> **调研方法**: WebSearch + 官方文档 + 学术论文 + 实战工程实践
> **调研范围**: 2026-02 ~ 2026-07 期间发布的功能

---

## 一、Codex CLI 重大更新（2026 Q1-Q2）

### 1.1 Codex v0.105.0（2026-02-26）

**来源**:
- [Awesome Agents: Codex 0.105.0 Ships Voice Input, Sleep Prevention, and a Complete Subagent Overhaul](https://awesomeagents.ai/news/codex-0-105-voice-subagents-overhaul/) (2026-02-26)
- [Morph LLM: Codex CLI Multi-Agent](https://www.morphllm.com/codex-multi-agent) (2026-03-05)
- [Codex CLI Best Practice: Subagents](https://github.com/The-MDC/codex-cli-best-practice/blob/main/best-practice/codex-subagents.md)

**核心新功能**:

| 功能 | 描述 | 用户价值 |
|------|------|----------|
| **语音输入** | 按住空格键，松开后通过 Wispr 引擎将语音转文字填入 TUI 输入框 | 解放双手，简化移动场景编程 |
| **/theme 命令** | 实时预览主题选择器，自动适配 light/dark 终端的 diff 颜色 | 个性化体验，提升可读性 |
| **睡眠阻止** | Codex 运行时阻止系统进入 idle sleep (Linux/macOS/Windows) | 避免长任务被中断 |
| **Plan Mode 升级** | 自定义推理策略（reasoning selection） | 任务规划更精准 |
| **子智能体重构** | nicknames + 可视化清理 + max_depth + custom role + CSV 批处理 | 大幅提升多智能体编排能力 |

**Subagent 架构关键设计**:

```
[agents]                    # 全局子智能体配置
max_threads = 6             # 并发线程上限
max_depth = 1               # 嵌套深度（root=0）
job_max_runtime_seconds = 1800  # CSV 任务超时

[agents.reviewer]           # 自定义角色
name = "reviewer"
description = "PR review focused on correctness/security"
developer_instructions = "..."
nickname_candidates = ["Atlas", "Delta", "Echo"]
model = "gpt-5.5"
sandbox_mode = "read-only"  # 角色级沙箱覆盖
mcp_servers = ["github-mcp"]
```

**内置角色** (4 类):
- `default`: 通用 fallback
- `worker`: 执行导向，写权限
- `explorer`: 只读探索
- `monitor`: 长任务监控（支持 1 小时 polling）

**CSV 批处理**: `spawn_agents_on_csv` 工具，每行一个 worker，支持 `{column_name}` 模板注入。

### 1.2 Codex v0.124.0（2026-04-23）

**来源**:
- [DevelopersIO: Codex 0.124.0 Alt+,/Alt+. 切换 reasoning](https://dev.classmethod.jp/articles/codex-cli-0-124-alt-reasoning-shortcuts/) (2026-04-24)

**核心新功能**:
- `Alt+,` / `Alt+.` TUI 快捷键：实时调整 reasoning effort（low/medium/high）
- 推理策略调整仅在当前 session 生效，不持久化
- Plan 模式下 Alt+,/Alt+. 调整仅作用于 Plan 模式

**关键技术细节**:
- macOS 终端需配置 `Option as Meta key`（Warp/iTerm2/Terminal.app 等各终端配置方式不同）
- 模型升级后自动重置 reasoning 为模型默认值
- 仅切换模型"支持的"推理档位（不会出错）

### 1.3 Codex Realtime V2 WebRTC（2026-04）

**来源**:
- [Daniel Vaughan: Voice-Driven Development in Codex CLI: From Push-to-Talk to Realtime V2 WebRTC](https://codex.danielvaughan.com/2026/04/17/codex-cli-voice-realtime-webrtc-push-to-talk/) (2026-04-17)
- [Spokenly: Codex Voice Mode](https://spokenly.app/blog/voice-dictation-for-developers/codex) (2026-07)

**两层语音架构**:
```
Layer 1 - 语音转写（v0.105.0+）:
  按住空格 → Wispr 引擎 STT → 文本填入 TUI
  纯 STT，agent 仍以文本响应

Layer 2 - Realtime 语音会话（v0.119.0+）:
  WebRTC v2 transport ↔ OpenAI Realtime API
  双向音频 + 后台进度流式传输 + 工具调用
  支持 GPT-5.5 / GPT-Realtime 多模态
```

**WebRTC V2 特性**:
- 双向音频对话
- 后台 agent 进度流式推送
- 可配置语音选择
- 工具调用中保持对话上下文

### 1.4 Codex CLI Feature Flags（2026-03）

**来源**:
- [Daniel Vaughan: Codex CLI Feature Flags and TUI Tuning](https://codex.danielvaughan.com/2026/03/28/codex-cli-feature-flags-tui-tuning/) (2026-03-28)

**关键 features 字段**:
```toml
[features]
unified_exec     = true   # PTY 模式（macOS/Linux 默认开启）
shell_snapshot   = true   # shell 环境缓存
multi_agent      = true   # 多智能体功能开关
undo             = false  # operation-level undo（操作级撤销）
personality      = true   # 性格定制
apps             = false  # experimental
```

**TUI 配置**:
- `notification_method`: `osc9`（WezTerm/Win Terminal/ConEmu） / `bel` / `auto`
- `/undo` 命令：操作级 undo 撤销
- Profile 作用域的 feature flags

### 1.5 Codex 关键能力对照表

| 能力 | 实现状态 | 我们的现状（v0.x） | 差距 |
|------|----------|-------------------|------|
| 语音输入 (PTT) | Wispr 集成 | ❌ 无 | P1 |
| Theme picker | /theme 命令 + 实时预览 | 🟡 仅 dark/light/contrast | P1 |
| Subagent nicknames | 人类可读别名 | ❌ UUID | P1 |
| Custom agent role TOML | per-role model+sandbox+MCP | ❌ 无 | P1 |
| CSV batch spawning | spawn_agents_on_csv | ❌ 无 | P1 |
| Reasoning 切换快捷键 | Alt+,/Alt+. | ❌ 无 | P1 |
| Operation-level undo | /undo command | 🟡 RollbackManager | P1 |
| Sleep prevention | wake lock | ❌ 无 | P2 |
| Realtime V2 WebRTC | 双向音频 | ❌ 无 | P2 |
| OSC 9 通知 | 终端通知 | ❌ 无 | P2 |

---

## 二、Trae SOLO 模式新功能（2026 Q1-Q2）

### 2.1 SOLO Builder 完整工作流

**来源**:
- [CSDN: 揭秘 TRAE SOLO 模式](https://blog.csdn.net/u012094427/article/details/149698451) (2026-07-31)
- [YKZM: SOLO Builder 日本語](https://ykzm.cn/ja/ide/solo-builder.html)

**SOLO Builder 五步工作流**:
```
1. 需求分析  → 2. PRD 创建  → 3. 编码  → 4. 预览  → 5. 部署（Vercel）
```

**关键特性**:
- **PRD 自动生成**: AI 自主生成产品需求文档，显示在 DocView 面板
- **PRD diff 视图**: 右上角切换 diff 模式，AI 修改 PRD 时实时显示变更
- **代码自动接受**: 每个聊天轮次开始前自动应用代码变更
- **错误自愈**: 命令执行失败时自动分析原因，尝试修复
- **元素选择器**: 浏览器中点击元素 → 发送到 AI 聊天 → 修改
- **静态文本直编**: 页面上静态文字点击即可编辑（WYSIWYG）
- **错误提示集成**: 浏览器控制台错误自动显示在底部，一键发 AI

### 2.2 Trae 工具面板（Auto-Follow）

**SOLO 工具面板完整列表**:
| 工具 | 图标 | 功能 | 我们的状态 |
|------|------|------|------------|
| AI 面板 | 🤖 | 主对话界面 | ✅ VibeSoloShell |
| 编辑器 | 📝 | 代码编辑 | ✅ DiffViewer（基础）|
| 文档 | 📄 | DocView（PRD/需求）| ❌ 缺失 |
| 终端 | ⌨️ | 命令执行 | ✅ EmbeddedTools |
| 浏览器 | 🌐 | 实时预览 | ✅ EmbeddedTools |
| 代码变更 | 🔀 | Git diff | ✅ DiffViewer |
| Figma | 🎨 | 设计稿导入 | ❌ P2 |
| Supabase | 🗄️ | 后端服务 | ❌ P2 |
| 集成 | 🔌 | 外部服务 | ❌ P2 |
| 智能体 | 🤖 | Agent 管理 | ❌ P1 |
| MCP | 🔗 | MCP 服务器 | ✅ 后端 |
| 设置 | ⚙️ | 偏好设置 | ✅ |

### 2.3 Trae 阶段检测（Auto-Follow）

**核心机制**:
- SOLO 模式实时检测 AI 当前工作阶段（PRD 编写 / 编码 / 预览 / 部署）
- 自动切换右侧工具面板
- 用户无需手动操作

**实现原理推断**:
- 监听 AI 输出的关键词（"PRD"、"代码"、"部署"）
- 分析 task 状态机
- 跟踪文件系统变化（文件类型 → 阶段推断）

### 2.4 多模态需求输入

**支持的输入方式**:
- 文本描述（自然语言）
- 语音输入（Web Speech API）
- 截图上传（图片理解）
- Figma 设计稿链接
- 文件拖拽

**我们的现状**:
- 文本输入 ✅
- 语音输入 ❌
- 截图上传 🟡 基础文件上传
- Figma ❌
- 拖拽 🟡

---

## 三、跨产品共同趋势

### 3.1 共同方向

| 趋势 | Codex | Trae | 我们的策略 |
|------|-------|------|-----------|
| 多模态输入 | Voice (Wispr) + 图像 | Voice + 图像 + Figma | 实现 PTT 语音 + 图像扩展点 |
| 多智能体编排 | max_depth + custom roles | SOLO Builder | 已实现 MultiTaskManager，强化角色定义 |
| 阶段自动跟随 | 隐式 | Auto-Follow | 实现 StageDetector |
| 部署集成 | GitHub Actions | Vercel | 实现 Vercel 适配器（P2）|
| 主题/个性化 | /theme picker | 主题切换 | 实现 /theme picker 命令 |
| 错误自愈 | /undo | 自动重试 | 已实现 Retry，扩展错误自愈 |

### 3.2 我们已有的优势

- ✅ Plan-Step 状态机（PlanExecutor + Goal mode）
- ✅ 完整 RollbackManager（一键回退）
- ✅ LLMStreamManager（WebSocket 流式输出）
- ✅ MultiTaskManager（多任务并行）
- ✅ ContextSelector（6 种上下文源）
- ✅ AGENTS.md 自动加载
- ✅ MCP 集成
- ✅ 主题系统（dark/light/high-contrast）
- ✅ Solo Shell 三栏布局

---

## 四、关键差距（vs 新版 Codex + Trae SOLO）

| # | 功能 | 优先级 | 来源 | 实施难度 |
|---|------|--------|------|----------|
| 1 | **PRD 生成器** | 🔴 P0 | Trae SOLO Builder | 中 |
| 2 | **自定义 Agent 角色** | 🔴 P0 | Codex Subagent TOML | 中 |
| 3 | **CSV 批处理 spawn_agents** | 🟡 P1 | Codex multi-agent | 中 |
| 4 | **StageDetector（阶段检测）** | 🟡 P1 | Trae Auto-Follow | 中 |
| 5 | **/theme 命令 + 实时预览** | 🟡 P1 | Codex /theme | 低 |
| 6 | **Reasoning effort 切换** | 🟡 P1 | Codex Alt+,/Alt+. | 低 |
| 7 | **PTT 语音输入** | 🟡 P1 | Codex Wispr | 中 |
| 8 | **Sleep prevention** | 🟢 P2 | Codex feature | 低 |
| 9 | **PRD diff 视图** | 🟡 P1 | Trae SOLO Builder | 中 |
| 10 | **元素选择器** | 🟢 P2 | Trae | 高 |
| 11 | **OSC 9 通知** | 🟢 P2 | Codex | 低 |
| 12 | **Operation-level undo** | 🟡 P1 | Codex /undo | 中 |

---

## 五、本轮 P0 实施方向

**G63-01: PRD 生成器（SOLO Builder 核心）**
- 输入: 自然语言需求
- 输出: 结构化 PRD（目标 + 用户场景 + 验收标准 + 任务分解）
- 接口: `POST /api/prd/generate`
- 前端: `PRDGenerator.tsx` + `PRDView.tsx` + `PRDDiffView.tsx`

**G63-02: 自定义 Agent 角色定义**
- 输入: TOML/YAML 角色配置
- 输出: 可注册、可调度的 Agent 角色
- 接口: `POST /api/agents/register` + `GET /api/agents/list`
- 前端: `AgentRoleManager.tsx` + 内嵌到工具面板

**G63-03: StageDetector + Auto-Follow**
- 输入: AI 工作流事件流
- 输出: 当前阶段（PRD/编码/预览/部署）
- 接口: `WS /api/stage/events`
- 前端: `StageIndicator.tsx` + Auto-Follow 联动

**G63-04: CSV 批处理 spawn_agents**
- 输入: CSV 文件 + 任务模板
- 输出: 每行一个 worker，结果汇总
- 接口: `POST /api/agents/spawn-csv`
- 前端: `CSVBatchDialog.tsx`

---

## 六、参考资料汇总

### 官方文档
1. [OpenAI Codex CLI 官方](https://developers.openai.com/codex/cli)
2. [Codex Subagents](https://developers.openai.com/codex/subagents)
3. [Trae IDE 官方](https://www.trae.ai/)
4. [Trae Docs - 工具面板](https://docs.trae.ai/ide/tool-panels)
5. [Trae Docs - SOLO Builder](https://ykzm.cn/ja/ide/solo-builder.html)

### 技术博客
6. [Awesome Agents: Codex 0.105.0 Subagents](https://awesomeagents.ai/news/codex-0-105-voice-subagents-overhaul/)
7. [Morph LLM: Multi-Agent](https://www.morphllm.com/codex-multi-agent)
8. [Daniel Vaughan: Voice + WebRTC](https://codex.danielvaughan.com/2026/04/17/codex-cli-voice-realtime-webrtc-push-to-talk/)
9. [Daniel Vaughan: Custom Agent TOML](https://codex.danielvaughan.com/2026/04/27/codex-cli-custom-agent-definitions-toml-specialised-subagents/)
10. [Daniel Vaughan: Feature Flags](https://codex.danielvaughan.com/2026/03/28/codex-cli-feature-flags-tui-tuning/)
11. [Daniel Vaughan: Alt+,/Alt+. Reasoning](https://dev.classmethod.jp/articles/codex-cli-0-124-alt-reasoning-shortcuts/)
12. [Spokenly: Codex Voice](https://spokenly.app/blog/voice-dictation-for-developers/codex)
13. [CSDN: TRAE SOLO 模式](https://blog.csdn.net/u012094427/article/details/149698451)
14. [Codex CLI Best Practice](https://github.com/The-MDC/codex-cli-best-practice/blob/main/best-practice/codex-subagents.md)

### 学术与实践
15. [OpenAI: Unrolling the Codex Agent Loop](https://openai.com/es-419/index/unrolling-the-codex-agent-loop/)
16. [GitHub: openai/codex](https://github.com/openai/codex)
17. [Trae MultiAgent Skill (GitHub)](https://github.com/weiransoft/TraeMultiAgentSkill)
18. [SecondLife: TRAE 使用법](https://secondlife.lol/zh/trae-ai-ide-solo-guide/)

---

## 七、调研结论

**P0 必做**（影响产品定位）:
1. PRD 生成器（SOLO 模式核心差异化能力）
2. 自定义 Agent 角色（多智能体编排基础）
3. StageDetector（Auto-Follow 联动）

**P1 应做**（提升竞争力）:
4. CSV 批处理（批量任务场景）
5. /theme picker（个性化体验）
6. Reasoning effort 切换（控制推理深度）
7. PTT 语音输入（多模态基础）
8. PRD diff 视图（产品文档协作）

**P2 可做**（长期演进）:
9. 元素选择器
10. OSC 9 通知
11. Vercel 部署
12. Figma 集成

本轮 Cycle 63 重点实现 P0 三大核心功能（PRD + 角色 + 阶段），奠定 SOLO 模式的产品差异化和多智能体编排能力。
