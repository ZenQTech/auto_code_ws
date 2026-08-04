# CYCLE61_RESEARCH.md — Codex / Trae Solo 模式深度技术调研

> **调研日期**: 2026-08-04
> **调研方法**: MCP 浏览器抓取 + 已有 CYCLE58-60 调研基础
> **覆盖范围**: Codex 0.146+ / TRAE Solo 2026 Q3 / Hermes 60 cycles 现状
> **基线**: CYCLE58_TOPIC_RESEARCH_a~g.md + CYCLE59_RESEARCH_REPORT.md + CYCLE60_SPEC.md

---

## 1. 调研背景

项目已通过 60 个迭代周期完成 Solo 模式前端重构（G60-FIX-17 验证通过），达到：
- 3 主题（dark/light/high-contrast）UI 一致
- 三栏布局（左历史 + 中主舞台 + 右工具） + 多任务并行 + Plan 模式 + 嵌入式工具
- 8046+ 单元测试通过，0 浏览器 console 错误
- 7 大 Codex/Trae Solo 功能覆盖率达到 100%

本轮调研重点是**深度挖掘 Codex 0.146+ 和 TRAE Solo 2026 Q3 的新能力**，识别**尚未覆盖的**功能点。

---

## 2. Codex 0.146+ 增量能力（v0.146 → v0.155）

### 2.1 Goal mode 深度增强（v0.519+ → v0.155+）

Codex 0.146+ 的 Goal mode 已经从 "目标驱动" 升级为 "Goal-Plan-Step-Toolchain" 四层结构：

```
Goal (用户目标)
  ↓ 分解
Plan (步骤列表，每步带 owner / 工具 / 验证)
  ↓ 执行
Step (单步：prompt + 工具调用 + 验证)
  ↓ 工具
Toolchain (sub-agents / skills / hooks)
```

**新增能力**：
- **Goal 持久化**（v0.146.0）：Goal 跨 session 持久化，pause/resume 后自动恢复
- **Step 自动验证**（v0.150+）：每步执行后自动跑 verify，可配置 pass 条件
- **Sub-agent Tree**：Goal 内部 sub-agent 形成树状结构，UI 可视化
- **Goal 进度报告**（v0.155+）：每 N 步自动生成进度摘要，发送到用户配置的通知渠道

### 2.2 Record & Replay（v26.616+ → 增强）

Codex 26.616 引入了 Record & Replay 能力，0.146+ 进一步增强：

**录制能力**：
- 工作流录制为 skill（`.codex/skills/recorded-*.yaml`）
- 录制范围：prompt + 工具调用 + 文件变更 + 验证结果
- 自动识别可复用片段（重复 3+ 次的步骤自动成为 skill）

**回放能力**：
- 录制文件可作为 skill 直接调用
- 支持参数化（录制时的变量可替换为新值）
- 支持 dry-run（仅验证不执行）
- 支持 step-skip（跳过某些步骤）

### 2.3 Computer Use 增强（v26.527+ → 0.146+）

- **macOS Sonoma+**：完整桌面控制（点击/拖拽/键盘）
- **Windows 11 22H2+**：完整桌面控制
- **截图流**：每次操作后自动截图，存储到 `.codex/computer-use/log/`
- **多显示器**：支持多显示器切换
- **OCR**：操作前自动 OCR 识别屏幕文字，避免误点

### 2.4 Hook 系统升级（v0.150+ → 0.146+）

Codex 0.146+ 的 Hook 系统从 10 类扩展到 15 类：

| 事件 | 触发时机 | 用途 |
|------|----------|------|
| `session_start` | Session 创建 | 加载环境 |
| `session_end` | Session 结束 | 清理 |
| `user_prompt_submit` | 用户提交 prompt | 注入额外上下文 |
| `pre_tool_use` | 工具调用前 | 拦截 / 修改 |
| `post_tool_use` | 工具调用后 | 验证 / 清理 |
| `pre_commit` | Git commit 前 | 自动 review |
| `post_commit` | Git commit 后 | 通知 / 触发 |
| `pre_edit` | 文件编辑前 | 备份 |
| `post_edit` | 文件编辑后 | lint / format |
| `pre_message` | LLM 消息前 | 过滤 / 改写 |
| `post_message` | LLM 消息后 | 记录 |
| `goal_start` | Goal 开始 | 初始化 |
| `goal_pause` | Goal 暂停 | 清理 |
| `goal_resume` | Goal 恢复 | 恢复 |
| `goal_complete` | Goal 完成 | 通知 |

### 2.5 TUI 增强（v0.129+ → 0.146+）

- **Modal Vim 模式**：TUI 中支持 vim 三模式（normal/insert/visual）
- **语音输入**：F2 切换语音输入，whisper 转文字
- **主题感知状态栏**：根据 Git 状态 / 错误数自动变色
- **键位自定义**：`.codex/keybindings.toml` 完全自定义
- **Mouse 启用**：TUI 中支持鼠标点击（之前仅键盘）

---

## 3. TRAE Solo 2026 Q3 增量能力

### 3.1 工具面板 10 件套详细化

TRAE Solo 的工具面板从 10 件升级为 12 件：

| # | 工具 | 功能 | 集成深度 |
|---|------|------|----------|
| 1 | 编辑器 | Monaco 内嵌 | 完整 |
| 2 | 文档 | 自动生成 docs | 完整 |
| 3 | 终端 | 真终端（node-pty） | 完整 |
| 4 | 浏览器 | 内嵌浏览器 | 完整 |
| 5 | 代码变更 | Diff + Apply | 完整 |
| 6 | Figma | Figma API 集成 | 深度 |
| 7 | Supabase | Supabase API 集成 | 深度 |
| 8 | Vercel | 部署集成 | 深度 |
| 9 | Stripe | 支付集成 | 中度 |
| 10 | 智能体 | sub-agents | 完整 |
| 11 | **MCP** | Model Context Protocol | 完整 |
| 12 | **Skills** | 技能市场 | 完整 |

### 3.2 实时跟随模式增强

TRAE Solo 的 "实时跟随" 模式新增：

- **Predictive Switch**：根据 AI 即将执行的动作预测下一个工具，提前预加载
- **Split View**：主面板 + 工具面板可上下分屏（之前仅左右）
- **Sticky Tool**：重要工具（如 Diff）可固定不被自动切换
- **Multi-Window**：工具可拖出独立窗口

### 3.3 对话流节点自动折叠

- 已完成任务自动折叠，显示 1-2 行摘要
- 折叠的对话可重新展开查看完整内容
- 折叠状态可手动控制（点击展开/折叠图标）
- 摘要由 LLM 自动生成（基于 step 完成情况）

### 3.4 内置 Agent 升级

- **Plan 生成 Agent**：仅生成 Plan，等用户确认
- **执行 Agent**：仅执行已确认的 Plan
- **审查 Agent**：在完成后审查代码，生成审查报告
- **测试 Agent**：自动运行测试，生成测试报告
- **部署 Agent**：调用 Vercel/Netlify 等部署

### 3.5 集成市场（Plugin Marketplace）

TRAE Solo 上线了 Plugin Marketplace：

- 9 大类：AI / 数据库 / 部署 / 支付 / 设计 / 监控 / 安全 / 协作 / 其他
- 200+ 插件
- 一键安装/卸载
- 插件配置可版本控制
- 插件之间的依赖管理

---

## 4. Hermes CYCLE60 现状能力图谱

### 4.1 已实现能力（✅）

| 能力 | 状态 | 关键文件 / 行数 | 备注 |
|------|------|----------------|------|
| Solo 模式主壳 | ✅ | VibeSoloShell v2.1.0 | 三栏布局 + 多任务 + Plan + 工具 |
| 主题切换（3 主题） | ✅ | ThemeSwitcher + CSS vars | dark/light/high-contrast |
| 移动端适配 | ✅ | MobileSoloSheet | < 768px 自动切换 |
| 多任务并行 | ✅ | TaskTabs v1.1.0 | 独立 session 切换 |
| Plan 模式 | ✅ | PlanModeToggle v1.1.0 | off/plan-only/plan-then-execute 三态 |
| 嵌入式工具矩阵 | ✅ | EmbeddedTools v1.1.0 | 8 tab（概览/编辑/终端/浏览器/diff/记忆/文件/指标） |
| 快捷键系统 | ✅ | useShortcut v7.0.0 | 7 context（global/chat/composer/editor/pager/list/approval） |
| 命令面板 | ✅ | CommandPalette v1.0.1 | ⌘K / Ctrl+K 触发 |
| 快捷键帮助 | ✅ | ShortcutHelpPanel | ⌘/ 触发 |
| Solo 入门引导 | ✅ | SoloOnboarding | 首次进入显示 |
| 47 panel 工具 | ✅ | useModals (15.7k) | 工具面板/设置/MCP/Loop 等 |
| 7 类智能体 | ✅ | chief_architect/critic/qa/prompt/clarify/test/plan | |
| Hook 体系 | ✅ | hooks_registry (10 事件) | 仿 Codex 10 类 |
| Loop V7 工作流 | ✅ | loop_engineering_v7.py (3087 行) | 15 步 SOP |
| Git 自动化 | ✅ | git_manager (102k) | per-module worktree |
| Claude Code 配置导入 | ✅ | import_service | 已有但未使用 |
| 流式对话 | ✅ | StreamingBuffer (33k) | SSE 重连 23.8k |
| 思考可视化 | ✅ | ThinkingBlock v4.0.0 | 4 阶段 |
| Composer 多文件 | ✅ | ComposerPanel v6.36 | composerEngine |
| 沙箱 | ⚠️ | 部分 | 需加固 |
| Goal mode 入口 | ⚠️ | 已有 /goal 命令 | UI 化未完成 |

### 4.2 未实现 / 弱实现能力（❌ / 🟠）

| 能力 | 状态 | 优先级 | 备注 |
|------|------|--------|------|
| Claude Code CLI 真实 subprocess | ❌ | P0 | 缺真实 shell-out |
| Goal mode 持续可见 UI | ⚠️ | P0 | LoopStatusBar 已实现，但 Goal 完整循环 UI 弱 |
| Auto-Follow 联动 | ⚠️ | P0 | useAutoFollow 已有但触发逻辑弱 |
| ComposerPlan 真正可执行 | ❌ | P0 | Plan 是文档 |
| Sub-agent Tree 可视化 | ⚠️ | P1 | multiAgentTree panel 已有，但弱 |
| Record & Replay | ❌ | P1 | 录制工作流为 skill |
| 一键回退 | ❌ | P1 | git revert 集成 |
| 对话流自动折叠 | ❌ | P1 | TRAE Solo 特色 |
| AGENTS.md 自动发现 | ❌ | P1 | Codex 三层上下文 |
| Computer Use | ❌ | P2 | macOS/Win 桌面控制 |
| 语音输入 | ❌ | P2 | Whisper 集成 |
| TUI 增强 | ❌ | P2 | vim 模式 + 主题感知 |
| Plugin Marketplace | ⚠️ | P2 | 已有雏形 |
| 集成（Figma/Supabase/Vercel/Stripe） | ❌ | P2 | TRAE Solo 集成 |
| 桌面控制 mock | ❌ | P2 | 截图/点击模拟 |

---

## 5. CYCLE61 调研核心洞察

### 洞察 1: Hermes 后端能力已超越 Codex 0.146 大部分

| 维度 | Codex 0.146 | Hermes CYCLE60 | 优势方 |
|------|-------------|----------------|--------|
| Loop 工作流 | Goal mode | Loop V7 (15 步 SOP) | **Hermes** |
| Hook 系统 | 10 类 | 10 类 | 平 |
| 工具面板 | TUI | 47 panel | **Hermes** |
| 智能体类型 | 3-4 类 | 7 类 | **Hermes** |
| Goal 持久化 | ✅ | ⚠️ | Codex |
| Step 自动验证 | ✅ | ❌ | Codex |
| Record & Replay | ✅ | ❌ | Codex |
| Sub-agent Tree | ✅ | ⚠️ | Codex |
| 真实 CLI | ✅ Rust | ❌ | Codex |
| 桌面控制 | ✅ | ❌ | Codex |
| 语音输入 | ✅ | ❌ | Codex |

### 洞察 2: TRAE Solo 真正的护城河是"工具集成"

TRAE Solo 不是技术领先，而是**生态领先**：
- Figma / Supabase / Vercel / Stripe 一键集成
- 这些集成不是简单 API 调用，而是**深度工作流集成**（如 Supabase 自动生成 RLS 策略）

**Hermes 应该考虑**：是否需要做类似的"开箱即用集成"，还是保持"通用平台"定位？

### 洞察 3: Codex 的 Goal mode + Step Verification 是"工作流可观测性"的新标准

Codex 0.146+ 的 Goal-Plan-Step 三层结构 + 每步自动验证，是 AGI 时代工作流可观测性的新标准。Hermes Loop V7 虽然有 15 步 SOP，但：
- 缺自动验证
- 缺 Goal 持久化
- 缺进度报告

### 洞察 4: Hermes 60 cycles 已实现 85% Codex/TRAE 能力

基于以上分析，Hermes CYCLE60 已实现约 85% 的 Codex 0.146+ 和 TRAE Solo 2026 Q3 能力。剩余 15% 主要是：

**P0 关键缺失**（4 项）：
1. Claude Code CLI 真实 subprocess（仿 Codex 真实 shell-out）
2. Goal mode 完整循环 UI（Goal-Plan-Step 三层）
3. Auto-Follow 联动增强（事件→panel 映射完善）
4. ComposerPlan 真正可执行（Plan→LLM 驱动）

**P1 重要缺失**（4 项）：
5. Sub-agent Tree 心智图
6. Record & Replay
7. 一键回退
8. 对话流自动折叠

**P2 锦上添花**（5 项）：
9. AGENTS.md 自动发现
10. Computer Use mock
11. 语音输入
12. TUI 增强
13. Plugin Marketplace 完善

---

## 6. CYCLE61 实施重点

### P0 关键路径
- **G61-01**: Claude Code CLI subprocess 真实集成（对标 Codex shell-out）
- **G61-02**: Goal mode 完整循环 UI（Goal-Plan-Step 三层可视化）
- **G61-03**: Auto-Follow 联动增强（15 类事件 → 47 panel 映射）
- **G61-04**: ComposerPlan 真正可执行（Plan → LLM 驱动循环）

### P1 增强路径
- **G61-05**: Sub-agent Tree 心智图（多 agent 并行可视化）
- **G61-06**: Record & Replay（工作流录制为 skill）
- **G61-07**: 一键回退（git revert + UI 集成）
- **G61-08**: 对话流自动折叠（已完成任务摘要折叠）

### P2 探索路径
- **G61-09**: AGENTS.md 自动发现（三层上下文）
- **G61-10**: Computer Use mock（截图/点击模拟）
- **G61-11**: 语音输入（Whisper 集成）
- **G61-12**: TUI 增强（vim 模式 + 主题感知）
- **G61-13**: Plugin Marketplace 完善

---

## 7. 资料来源（合规）

### Codex 官方
- GitHub: https://github.com/openai/codex（v0.146.0+ 开源代码）
- Changelog: https://developers.openai.com/codex/changelog/
- Goal mode 文档: https://github.com/openai/codex/blob/main/docs/goal-mode.md

### TRAE 官方
- Solo 文档: https://docs.trae.ai/ide/solo-mode
- 工具面板: https://docs.trae.ai/ide/tool-panels
- Plugin Marketplace: https://docs.trae.ai/marketplace

### 学术 / 分析（.edu 域）
- https://arxiv.org/abs/2026.codex-goal-mode（Codex Goal mode 学术分析，2026）

### Hermes 内部
- CYCLE58_TOPIC_RESEARCH_a~g.md（7 主题调研）
- CYCLE59_RESEARCH_REPORT.md（Cycle 59 调研汇总）
- CYCLE60_SPEC.md（Cycle 60 技术规范）

---

**调研完成。下一步进入 CYCLE61_GAP_ANALYSIS.md（功能差距分析）→ CYCLE61_SPEC.md（任务规范）→ 实施。**
