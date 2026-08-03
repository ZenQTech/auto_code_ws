# CYCLE58 - 主题 a 调研：Vibe Coding 完整流程

> **调研日期**: 2026-08-03
> **调研者**: 总架构师 + MCP 抓取
> **来源标注**: docs.trae.ai + openai/codex + developers.openai.com

---

## 1. Codex CLI 完整 Vibe Coding 流程

### 1.1 流程图（Codex CLI）

```
[用户输入] -> [Codex CLI 主进程] -> [Codex 核心 LLM (GPT-5.5/5.6)]
                                      ↓
                              [TUI/IDE 流式输出]
                                      ↓
                              [工具调用: shell/edit/apply-patch]
                                      ↓
                              [本地沙箱执行 + 文件系统]
                                      ↓
                              [Commit / Diff 展示]
                                      ↓
                              [结果返回 TUI/IDE]
```

**来源**:
- https://github.com/openai/codex (codex-cli 子目录，Rust 96.6%)
- https://developers.openai.com/codex (官方文档)
- 最新版 0.146.0 (2026-07-29)

### 1.2 触发机制
- CLI 命令：`codex` 或 `codex app`（桌面应用）
- IDE 扩展：VS Code / Cursor / Windsurf 安装 `codex` 扩展
- IDE 快捷键触发对话
- `/vim` 命令切换 Modal Vim 编辑模式
- `/hooks` 浏览器查看 hook 链路
- `/theme` 选择器
- `/init` 命令创建项目 `AGENTS.md` 指令

### 1.3 参数传递
**config.toml** 配置文件：
- 模型选择（GPT-5.5/5.6-Terra/5.6-Luna 等）
- 推理强度（reasoning effort）
- 沙箱模式（workspace-write / read-only / danger-full-access）
- 审批模式（auto / on-request / on-failure / untrusted）
- 工具白名单
- Hook 配置

**CLI 参数**：
- `codex --model gpt-5.6-terra`
- `codex --sandbox workspace-write`
- `codex -p "your prompt"`（非交互）
- `codex exec`（非交互 exec 模式）

### 1.4 上下文管理
- **三层上下文**：
  1. **AGENTS.md**（项目级指令）— 自动发现主项目目录
  2. **Skills**（用户级 + 仓库级）— 可安装插件市场
  3. **Memories**（跨会话）— Preferences / Workflows / Tech Stacks / Repo Conventions
- **多文件夹项目**（Multi-folder local projects）：主文件夹 + 次要文件夹，主文件夹用于 AGENTS.md/skills/config.toml 发现，次要文件夹提供文件搜索
- **Goal mode**（v0.519+）：以目标驱动，可运行数小时到数天

### 1.5 结果返回路径
- **TUI**：主题感知状态栏 + 流式 reasoning 输出 + diff 语法高亮
- **IDE 扩展**：嵌入式对话面板
- **桌面应用**：原生窗口（macOS / Windows）
- **Codex Web**（chatgpt.com/codex）：云端代理
- **Codex Mobile**（iOS/Android）：远程控制连接本地主机

### 1.6 2026 关键能力更新
- **Record & Replay**（2026-06-18，macOS）：将演示工作流转为可复用 skill
- **Appshots**（2026-05-21）：双击 Command 键把前台应用窗口 + 截图发给 Codex
- **Goal mode**（2026-05-21 稳定版）：目标驱动数小时-数天
- **Computer Use**（2026-05-29 Windows + 2026-06-16 EEA）：操作桌面应用
- **Browser Use + Developer Mode**（2026-06-11）：CDP 调试 + 2x 速度优化
- **Inline review comments**（2026-06-09）：在变更文件中加内联评论
- **Multi-folder local projects**（2026-07-23）：一个项目多文件夹

---

## 2. TRAE Solo 模式完整 Vibe Coding 流程

### 2.1 流程图（TRAE Solo）

```
[用户自然语言 / 语音 / 文件] -> [TRAE Solo AI]
                                       ↓
                            [内置 Agent（任务规划）]
                                       ↓
                            [生成可执行 Plan]
                                       ↓
                            [用户确认 Plan]
                                       ↓
                    ┌──── [任务管理：多任务并行] ────┐
                    │                                │
                    ↓                                ↓
            [AI 自主执行任务]              [实时跟随模式切换工具]
                    │                                │
                    ↓                                ↓
            [代码生成 / 终端 / 文档 / 浏览器]  [编辑器 / 文档 / 终端 / 浏览器]
                    │                                │
                    └────────→ [Diff 视图 / 自动接受] ←────────┘
                                       ↓
                              [Vercel 部署 / Supabase 集成]
```

**来源**: https://docs.trae.ai/ide/solo-mode, https://docs.trae.ai/ide/tool-panels

### 2.2 触发机制
- 模式切换按钮：左上角切换至 SOLO 模式
- 工具面板快捷键：macOS `option + command + /`；Windows `Ctrl + Alt + /`
- 实时跟随按钮：工具面板左上角

### 2.3 参数传递
- 自定义模型配置（在 AI 服务中配置）
- 任务管理：单项目多任务并行
- Plan 确认：用户手动确认 AI 生成的 Plan

### 2.4 上下文管理
- 自然语言 / 语音输入
- 本地文件上传
- 项目代码库读取
- 任务上下文（已折叠的对话节点自动摘要）

### 2.5 结果返回路径
- 任务管理面板（左侧）
- AI 对话面板（中间）
- 工具面板（右侧）：编辑器 / 文档 / 终端 / 浏览器 / 代码变更 / Figma / Supabase / 集成 / 智能体 / MCP / 设置

### 2.6 关键能力
- **实时跟随模式**：AI 工作时工具只读，AI 阶段变更自动切换工具
- **Diff 视图**：完成变更后通过对话面板"查看变更"打开
- **对话流节点自动折叠**：设置 > 对话流 > 待办清单开关
- **Figma 导入**：选 Frame/组件 → 发送至 AI → 自动转代码
- **集成**：Vercel 部署、Stripe 支付、AI 服务、Supabase

---

## 3. Hermes 现状 vs codex/trae Solo 对标

| 维度 | codex CLI | TRAE Solo | Hermes 现状 | 差距 |
|------|-----------|-----------|-------------|------|
| 触发入口 | `codex` / IDE 扩展 | 模式切换 | chat/coding 二元 | ❌ 缺 vibe-coding 模式 |
| 参数配置 | config.toml 完整 | UI 配置 | 部分实现 | ⚠️ |
| 上下文 | AGENTS.md + Skills + Memories | 项目+任务 | Loop + Memory (27k) | ✅ 接近 |
| Plan 生成 | 自动 + 用户确认 | 自动 + 用户确认 | ComposerPanel plan mode | ✅ 接近 |
| 任务并行 | 多 Agent | 多任务 | Loop V7 并行 CLI | ✅ |
| 工具面板 | TUI 主题 | 10 工具 | 41 panel | ✅ 远超 |
| 实时跟随 | ❌ | ✅ | ❌ | ❌ 缺 |
| DiffView | 语法高亮 | 完整 | DiffView (56k) | ✅ 接近 |
| 桌面控制 | ✅ | ❌ | ❌ | ❌ 缺 |
| 语音输入 | ✅ 按住空格 | ✅ | ❌ | ❌ 缺 |
| Goal mode | ✅ | ❌ | ❌ | ❌ 缺 |

---

## 4. 关键洞察

1. **Codex 的 96.6% Rust 实现**表明其核心是本地 CLI + 沙箱执行，Hermes 的 Python 异步实现有架构差异但能力可对齐
2. **AGENTS.md + Skills + Memories 三层上下文**是 codex 的核心创新，Hermes 已有 Memory (27k) 但缺 AGENTS.md 自动发现
3. **TRAE 的"实时跟随模式"是最大 UX 创新**，但目前 Hermes 未实现
4. **Goal mode**（v0.519+）是 codex 的最新能力，Hermes Loop V7 已具备等价能力但缺用户可控开关
5. **Multi-folder local projects**（2026-07）说明 codex 已支持多工作区

---

## 5. 实施建议

### P0 - 必须实现
- **Vibe Coding 模式入口**（3 模式选择页）
- **Plan 真正可执行**（plan → LLM 驱动持续生成）
- **实时跟随 Auto-Follow**（Stream 事件 → 自动 open panel）

### P1 - 应该实现
- **Goal mode**（用户可控的长时间目标循环）
- **Multi-folder local projects**（多工作区管理）

### P2 - 锦上添花
- **AGENTS.md 自动发现**（读取项目级指令）
- **语音输入**（Web Speech API）
- **桌面控制 mock**（用于演示）
