# CYCLE58 调研报告汇总

> **调研日期**: 2026-08-03
> **调研方法**: MCP 真实抓取 + 已有 CYCLE32 调研基础
> **覆盖范围**: codex CLI 0.146.0 + TRAE Solo + Hermes 现状

---

## 📚 7 主题调研报告

| 主题 | 文件 | 核心发现 |
|------|------|----------|
| a) vibe coding 完整流程 | [CYCLE58_TOPIC_RESEARCH_a_vibe_coding_flow.md](file:///home/qizheng/auto_code_ws/CYCLE58_TOPIC_RESEARCH_a_vibe_coding_flow.md) | Codex 0.146 (Rust 96.6%) + TRAE Solo 三栏 + 触发→Plan→执行→Diff→部署 |
| b) 循环工作流 | [CYCLE58_TOPIC_RESEARCH_b_loop_workflow.md](file:///home/qizheng/auto_code_ws/CYCLE58_TOPIC_RESEARCH_b_loop_workflow.md) | Codex Goal mode (v0.519+) 数小时-数天 + TRAE 任务并行 + Hermes Loop V7 15 步 |
| c) 思考过程实时可视化 | [CYCLE58_TOPIC_RESEARCH_c_thinking_visualization.md](file:///home/qizheng/auto_code_ws/CYCLE58_TOPIC_RESEARCH_c_thinking_visualization.md) | Codex reasoning stream + TRAE 文档实时生成 + Hermes ThinkingBlock 4 阶段 |
| d) 渐进式呈现 | [CYCLE58_TOPIC_RESEARCH_d_streaming_render.md](file:///home/qizheng/auto_code_ws/CYCLE58_TOPIC_RESEARCH_d_streaming_render.md) | Codex Realtime V2 + Hermes StreamingBuffer (33k) + SSE 重连 23.8k |
| e) 代码实时编写渲染 | [CYCLE58_TOPIC_RESEARCH_e_live_code_render.md](file:///home/qizheng/auto_code_ws/CYCLE58_TOPIC_RESEARCH_e_live_code_render.md) | Codex Inline annotations + TRAE 编辑器自动接受 + Hermes ComposerPanel v6.36 |
| f) 代码修改追踪/比对 | [CYCLE58_TOPIC_RESEARCH_f_diff_tracking.md](file:///home/qizheng/auto_code_ws/CYCLE58_TOPIC_RESEARCH_f_diff_tracking.md) | Codex Multi-repo review + TRAE DiffView + Hermes DiffView (56k) |
| g) 代码回退功能 | [CYCLE58_TOPIC_RESEARCH_g_code_rollback.md](file:///home/qizheng/auto_code_ws/CYCLE58_TOPIC_RESEARCH_g_code_rollback.md) | Codex Worktree + Record & Replay + TRAE 编辑器 undo + Hermes git_manager (102k) |

---

## 🎯 关键发现汇总

### 1. Codex 2026 核心能力图谱
基于 OpenAI Codex 0.146.0 (2026-07-29) changelog 与官方文档：

| 能力 | 版本 | 关键能力 |
|------|------|----------|
| **Goal mode** | v0.519+ (2026-05-21) | 目标驱动数小时-数天，pause/resume |
| **Record & Replay** | 26.616 (2026-06-18) | 工作流录制为可复用 skill |
| **Computer Use** | 26.527 + 26.616 (Windows/EEA) | 操作 macOS/Windows 桌面 |
| **Browser Use + Developer Mode** | 26.609 (2026-06-11) | CDP 调试 + 2x 速度 |
| **Appshots** | 26.519 (2026-05-21) | 双击 Command 把前台 app 发给 Codex |
| **PR Chat** | 26.707 (2026-07-09) | GitHub PR 中嵌入 Codex 对话 |
| **Multi-folder local projects** | 26.715 (2026-07-23) | 一个项目多文件夹 |
| **AGENTS.md + Skills + Memories** | 持续 | 三层上下文 |
| **Hook 系统** | 10 类事件 | 仿 v0.150+ 完整 hook |
| **TUI 增强** | v0.129+ | Modal Vim + 主题感知状态栏 + 语音输入 |

### 2. TRAE Solo 核心能力图谱
基于 docs.trae.ai 官方文档：

| 能力 | 描述 |
|------|------|
| **三栏 UI** | 任务管理 + AI 对话 + 工具面板 |
| **工具面板 10 件套** | 编辑器 / 文档 / 终端 / 浏览器 / 代码变更 / Figma / Supabase / 集成 / 智能体 / MCP |
| **实时跟随模式** | AI 阶段自动切换工具 + 只读状态 |
| **Diff 视图** | 完成后通过对话面板"查看变更"打开 |
| **对话流节点自动折叠** | 已完成任务折叠 + 摘要 |
| **内置 Agent** | Plan 生成 + 用户确认 + 自主执行 |
| **任务并行** | 单项目多任务并行 |
| **MCP 编排** | sub-agents 通过 MCP 访问外部资源 |
| **集成** | Figma / Supabase / Vercel / Stripe / AI 服务 |

### 3. Hermes 现状能力图谱
基于 58 个迭代周期 + 7743 测试：

| 能力 | 状态 | 关键文件 |
|------|------|----------|
| 流式对话 | ✅ | StreamingBuffer (33k) + SSE 重连 23.8k |
| 思考可视化 | ✅ | ThinkingBlock v4.0.0 + StageDetector |
| Composer 多文件 | ✅ | ComposerPanel v6.36 + composerEngine |
| 41 panel 工具 | ✅ | useModals (15.7k) + 41 panel |
| 7 类智能体 | ✅ | chief_architect + critic + qa + prompt + clarify + test + plan |
| Hook 体系 | ✅ | hooks_registry (10 事件) + hook_bridge |
| Loop V7 工作流 | ✅ | loop_engineering_v7.py (3087 行, 15 步 SOP) |
| Git 自动化 | ✅ | git_manager (102k) + per-module worktree |
| Claude Code 配置导入 | ⚠️ | import_service + claude_code converter |
| **Vibe Coding 模式入口** | ❌ | 缺 |
| **Claude Code CLI 进程级控制** | ❌ | 缺真实 subprocess |
| **Loop 状态机持续可见 UI** | ❌ | 只有 LoopV7Runner 弹窗 |
| **Auto-Follow 联动** | ❌ | Stream 事件不自动 open panel |
| **ComposerPlan 真正可执行** | ❌ | Plan 是文档 |

---

## 📊 调研对比矩阵

| 维度 | Codex 0.146 | TRAE Solo | Hermes | 差距 |
|------|-------------|-----------|--------|------|
| 触发入口 | `codex` / IDE | 模式切换 | chat/coding | 🔴 缺 vibe-coding 模式 |
| 模型选择 | 5+ 模型 | 自定义 | ModelSelector | ✅ 接近 |
| 推理强度 | 4 档 | ❌ | ReasoningIntensitySelector | ✅ |
| Plan 模式 | ✅ | ✅ | ComposerPanel plan | ✅ |
| 任务并行 | sub-agents | 多任务 | Loop V7 并行 | ✅ |
| 流式输出 | Realtime V2 | ✅ | StreamingBuffer | ✅ |
| 思考可视化 | reasoning | 文档实时 | ThinkingBlock | ✅ |
| 实时跟随 | ❌ | ✅ | ❌ | 🔴 缺 |
| 工具面板 | TUI | 10 件 | 41 panel | ✅ 远超 |
| DiffView | ✅ | ✅ | ✅ | ✅ |
| Multi-repo diff | ✅ | ❌ | ❌ | 🟠 |
| Inline review | ✅ | ❌ | ❌ | 🟠 |
| 自动 commit | ✅ worktree | ⚠️ | ✅ hook | ✅ |
| Worktree | ✅ | ❌ | ✅ | ✅ |
| Undo/Redo | ✅ | ✅ | ✅ Composer | ✅ |
| 一键回退 | ❌ | ❌ | ❌ | 🔴 缺 |
| 对话流折叠 | ❌ | ✅ | ❌ | 🟠 缺 |
| 沙箱 | ✅ 多层 | ⚠️ | ⚠️ 部分 | 🟠 需加固 |
| Goal mode | ✅ | ❌ | ⚠️ Loop V7 | 🟠 需 UI 化 |
| Computer Use | ✅ | ❌ | ❌ | ❌ 缺 |
| 语音输入 | ✅ | ✅ | ❌ | 🟠 缺 |
| AGENTS.md 自动发现 | ✅ | ❌ | ❌ | 🟠 缺 |
| Skills 插件 | ✅ | ✅ | 部分 | ✅ |
| Memories | ✅ | ❌ | ✅ Memory 27k | ✅ |
| Hook 系统 | ✅ 10 事件 | ❌ | ✅ 10 事件 | ✅ |
| Record & Replay | ✅ | ❌ | ❌ | 🟠 缺 |

---

## 🔍 核心洞察

### 洞察 1: Hermes 已有 60% codex/trae 能力
- **后端能力超 60%**：Loop V7 15 步 SOP + Hook 10 事件 + Git 自动化 + 流式缓冲 + 7 类智能体
- **前端工具面板超 100%**：41 panel > TRAE 10 工具
- **核心缺失 4 大块**：Vibe Coding 模式入口 + Claude Code CLI 进程级控制 + Loop 状态机 UI + Auto-Follow 联动

### 洞察 2: Codex 的 "Goal mode" 是新一代循环工作流
- v0.519+ 2026-05-21 稳定版
- 目标驱动数小时-数天
- pause/resume 内置
- Hermes Loop V7 已具备等价能力，缺 UI 化

### 洞察 3: TRAE 的"实时跟随模式"是最大 UX 创新
- AI 阶段自动切换工具
- 工具只读状态
- 双击/滚动退出
- Hermes 缺此能力，是最值得实施的功能

### 洞察 4: Codex 的三层上下文 (AGENTS.md + Skills + Memories) 是核心创新
- Hermes Memory (27k) 已实现 Mem 等价
- 缺 AGENTS.md 自动发现
- Skills 部分实现

### 洞察 5: Hermes vs codex/trae 的核心差异
- **架构差异**：Codex 是 Rust 本地 CLI + 沙箱；Hermes 是 Python 异步 + Web
- **能力差异**：Hermes 后端更强，Codex 客户端体验更佳
- **方向差异**：Codex 偏 IDE/CLI，Hermes 偏 Web/协作

---

## 🎯 Cycle 58 实施重点（基于调研）

### P0 - 必须实施
1. **Vibe Coding 模式入口**（对标 Codex CLI / TRAE Solo 触发）
2. **Claude Code CLI 进程级控制**（对标 Codex 真实 CLI）
3. **Loop 状态机持续可见 UI**（对标 Codex Goal mode 可见性）
4. **Auto-Follow 联动**（对标 TRAE 实时跟随模式）
5. **ComposerPlan 真正可执行**（对标 Codex Plan mode 真正驱动 LLM）

### P1 - 应该实施（Cycle 59）
- Central Agent 状态可视化
- 连续对话驱动循环
- Sub-agent Tree 心智图
- 对话流节点自动折叠
- 桌面控制 mock

### P2 - 锦上添花（Cycle 60）
- AGENTS.md 自动发现
- 语音输入
- TUI 增强
- CUE 行内补全
- 模板市场

---

## 📖 主要资料来源

### Codex 官方
- GitHub: https://github.com/openai/codex (8811 commits, v0.146.0)
- 文档: https://developers.openai.com/codex
- Changelog: https://developers.openai.com/codex/changelog/

### TRAE 官方
- 主页: https://www.trae.ai/
- Solo 文档: https://docs.trae.ai/ide/solo-mode
- 工具面板: https://docs.trae.ai/ide/tool-panels
- 任务管理: https://docs.trae.ai/ide/manage-tasks

### 学术/分析
- Vibe Coding Academy: https://vibe-coding.academy/blog/codex-desktop-control-image-generation-vibe-coding-2026/
- Cursor 3 + Claude Code + Codex 混合栈: https://vibe-coding.academy/blog/cursor-3-claude-code-codex-hybrid-stack-vibe-coding-2026/
- Codex 完整参考: https://blakecrosley.com/es/guides/codex
- Claude Code vs Codex: https://blog.csdn.net/weixin_65793170/article/details/161883616

### Hermes 内部资料
- CODEX_TRAE_RESEARCH.md (CYCLE32, 7888 字节)
- loop_engineering_v7.py (3087 行, 15 步 SOP)
- workflow_engine.py (3495 行, FSM 5 阶段)
- 41 个 panel 组件
- 7 类智能体角色
- 10 类 Hook 事件
- 102k git_manager

---

**调研完成，下一步进入功能差距分析。**
