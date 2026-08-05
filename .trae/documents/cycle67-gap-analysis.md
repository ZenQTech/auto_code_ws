# CYCLE 67 功能差距分析报告

> **生成日期**: 2026-08-05
> **基础**: cycle66-gap-analysis.md + Cycle 66 增量分析
> **范围**: Codex CLI 思考流式可视化 + Trae SOLO 渐进式回答渲染 + 流式 Markdown

---

## 一、互联网调研总结

### 1.1 Codex CLI 思考过程流式可视化

**GitHub Issue #5339 核心问题**（来源：[Stream Codex CLI "thinking" process in real time](https://github.com/openai/codex/issues/5339)）：

> "When using the Codex CLI, during a multi-step 'thinking' process (4-5 reasoning passes), it only outputs all intermediate thinking content after the last step, just before taking a tool action. This gives users a sense of slowness, as there's no feedback until all steps are complete."

**PR #6006 解决方案**（来源：[feat(tui): stream agent reasoning live behind config flag](https://github.com/openai/codex/pull/6006)）：

- 在 TUI 中实现流式 reasoning 输出
- 通过 config flag 控制启用
- 每次 reasoning step 立即推送到 UI，不等待完整 reasoning 阶段

**技术架构要点**：
- 数据采集点：`Agent Control Loop` 内部 `submit` 事件流
- 渲染层：`codex-rs/tui/src/` ratatui Immediate Mode
- 流式协议：App Server 的 `EventMsg` JSON-RPC push
- 性能优化：增量 re-render，避免阻塞 tokio 主循环

### 1.2 Trae SOLO 渐进式回答渲染

**官方博客**（来源：[TRAE SOLO GA Release](https://www.trae.ai/blog/product_solo_1112)）：

> "Responsive review. See every decision as your agent makes it. Redirect mid-execution when priorities shift. Approve, modify, or course-correct at any moment. You're not waiting for a final output to discover what went wrong."

**关键设计原则**：
- **Responsive review**：实时看到 agent 决策，可中途干预
- **Responsive context**：上下文动态管理
- **Responsive multi-tasking**：并行任务协调可视化

**多面板工作区**（来源：[你的AI工作台：从TRAE SOLO模式入门](https://blog.csdn.net/aa2528877987/article/details/158128510)）：

> "屏幕左侧是聊天框（即指令输入区），屏幕右侧是 AI 的多面板工作区，会实时显示编辑器、终端、浏览器、文档和集成面板。这些面板中包含一个名为"实时跟随"的特色功能，启用该功能后，各个视图会根据 AI 当前的工作阶段自动切换。"

### 1.3 技术架构对比

| 维度 | Codex CLI (Rust/ratatui) | Trae SOLO (Web/React) | 本项目当前状态 | 改进目标 |
|------|------------------------|----------------------|---------------|---------|
| 思考过程可视化 | 流式（PR #6006） | 流式（多面板） | ❌ 缺失 | ✅ G67-01 |
| 实时回答渲染 | 字符级流式 | Token 级流式 | ⚠️ WebSocket 但未渲染 | ✅ G67-02 |
| Markdown 渲染 | 无 TUI | ✅ react-markdown | ❌ 纯文本 | ✅ G67-02 |
| 代码块高亮 | 基础 | ✅ highlight.js | ❌ 纯文本 | ✅ G67-02 |
| 折叠/展开 | 不适用 | ✅ Accordion | ❌ | ✅ G67-01 |
| 进度指示 | spinner | 步骤时间线 | ❌ | ✅ G67-01 |

### 1.4 关键参考实现

1. **Codex PR #6006** - flag 控制的 reasoning stream（开关 + 节流）
2. **Codex HUD** - terminal overlay 实时数据流（[codex-hud](https://github.com/yuxiaoyang2007-prog/codex-hud)）
3. **Codexian** - Visible timeline 步骤进度（[codexian](https://github.com/reallygood83/codexian)）
4. **Trae Brainstorm Mode** - 复杂问题拆解 + 流式执行

---

## 二、当前项目功能差距

### 2.1 已有能力

| 能力 | 实现位置 | 状态 |
|------|---------|------|
| WebSocket 流式 token 推送 | `g62-03` HermesService + ws | ✅ |
| 多源上下文选择器 | `g62-02` ContextSelector | ✅ |
| Hook 事件总线 | SubagentStart/PreToolUse/PostToolUse | ✅ |
| StageDetector | `g63-03` 自动识别阶段 | ✅ |
| Plan mode | PlanExecutorPanel | ✅ |
| Snapshot 管理 | `g66-02` SnapshotPanel | ✅ |
| Real-time agent execution | `g64-01` AgentExecutionPanel | ✅ |

### 2.2 缺失能力（Cycle 67 目标）

#### G67-01 思考过程实时可视化 ❌

- **数据采集点**：当前 SubagentStart/PostToolUse hook 不含 `reasoning_content` 字段
- **可视化组件**：`<ThinkingStreamView />` 缺失
- **Hook 协议**：未标准化 reasoning/thinking 事件
- **存储**：未持久化 thinking steps

#### G67-02 渐进式回答渲染 ❌

- **流式 Markdown**：ws 推送的是纯文本，未做 token-by-token 解析
- **代码块语法高亮**：未集成 highlighter
- **进度指示**：无 token 计数 / ETA
- **错误恢复**：流中断时无降级显示

### 2.3 风险评估

| 模块 | 风险等级 | 理由 |
|------|---------|------|
| Hook 事件总线扩展 | 中 | 协议变更需同步所有生产/消费方 |
| 思考流持久化 | 低 | 仅新增字段 |
| Markdown 流式渲染 | 中 | tokenizer 状态管理复杂 |
| 性能（>10K tokens 流） | 中 | React 重渲染需优化 |

---

## 三、技术选型

### 3.1 G67-01 思考可视化

- **数据源扩展**：`HookEventType` 新增 `THINKING_START`、`THINKING_DELTA`、`THINKING_END`
- **后端**：`ThinkingStreamService` 内存 buffer（per-session）+ 持久化到 SQLite
- **前端**：`useThinkingStream` Hook 订阅 ws，buffering + 节流（100ms 批量）
- **UI**：`<ThinkingStreamView />` 折叠/展开、步骤标记、累计时间

### 3.2 G67-02 渐进式渲染

- **后端**：ws 协议保持 token-level 推送
- **前端**：`useStreamingMarkdown` Hook + `react-markdown` 增量渲染
- **代码高亮**：`highlight.js` (轻量、10 种语言预设)
- **性能**：`useDeferredValue` 避免高频 re-render 阻塞

---

## 四、本轮 P0 任务

### G67-01 思考过程实时可视化
- **影响**：高 - 用户透明度 + 信任感
- **工时**：约 600 行后端 + 400 行前端 + 150 行测试
- **风险**：中 - 协议扩展

### G67-02 渐进式回答渲染
- **影响**：高 - 核心 UX
- **工时**：约 200 行后端微调 + 500 行前端 + 150 行测试
- **风险**：中 - 渲染性能

---

## 五、对标完成度

| 功能 | Codex | Trae | 本项目 Cycle 67 后 |
|------|-------|------|-------------------|
| 思考流式可视化 | ✅ | ✅ | ✅ G67-01 |
| 渐进式 Markdown | ✅ | ✅ | ✅ G67-02 |
| 代码块高亮 | ⚠️ | ✅ | ✅ G67-02 |
| 折叠/展开 | N/A | ✅ | ✅ G67-01 |
| 多面板联动 | ✅ | ✅ | ⚠️ 部分（已有） |

**完成度估算**：Cycle 67 后从 86% → 92%
