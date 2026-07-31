# Cycle 17 功能差距分析（Gap Analysis）

> **日期**: 2026-07-29  
> **Cycle**: Cycle 17  
> **基于**: CYCLE17_RESEARCH_REPORT.md  
> **目标**: 识别 Cycle 16 后剩余的功能差距，制定 Cycle 17 任务计划

---

## 一、差距总览

| 编号 | 差距名称 | 优先级 | 影响范围 | 工作量 |
|---|---|---|---|---|
| G17-01 | Composer Plan Mode 缺失 | P0 | 前端 + Composer 引擎 | 4 人天 |
| G17-02 | 统一 Chat/Composer/Agent 入口 | P0 | 前端架构 | 5 人天 |
| G17-03 | 渐进式 UI 预览（v0/Bolt 风格） | P0 | 前端 + 沙箱 | 6 人天 |
| G17-04 | @ 引用类型扩展（@codebase/@git/@diff） | P1 | Composer 引擎 | 2 人天 |
| G17-05 | Background Agents 后台任务 | P1 | 后端 + 前端 | 5 人天 |
| G17-06 | 项目级 AI 规则系统 (.cursorrules) | P1 | 前端 + 后端 | 3 人天 |
| G17-07 | Composer 2.5 风格本地化 hint 机制 | P1 | 后端 | 3 人天 |
| G17-08 | Self-Summarization 长 session 控制 | P2 | Composer 引擎 | 2 人天 |
| G17-09 | 语音输入（本地化） | P2 | 前端 | 4 人天 |
| G17-10 | 跨项目多仓库编排 | P2 | 调度平台 | 6 人天 |

---

## 二、详细差距分析

### G17-01: Composer Plan Mode 缺失（P0）

**现状**:
- Composer 接收 prompt 后直接生成 edits
- 用户在应用前看到 diff 列表，但缺少"计划阶段"
- 大规模重构时用户体验不佳：一次性看到 10+ 个 diff 容易让用户迷失

**期望**:
- 接收 prompt → 输出"执行计划" → 用户确认 → 执行计划
- 计划包含：受影响文件列表、操作类型（修改/创建/删除）、预估影响范围
- 用户可对计划进行"标注"：跳过某些文件 / 修改某些操作
- 类似 Cursor Composer 2.5/3.0 Plan Mode

**技术方案**:
```
1. 新增 PlanStage 状态机：analyzing → planned → approved → executing
2. 在 ComposerEngine 新增 generatePlan() 方法
3. Plan 数据结构：{ steps: PlanStep[], summary: string, estimatedChanges: number }
4. 新增 PlanViewer UI 组件（复用现有 DiffPreviewModal 设计语言）
5. PlanStep 支持三种状态：pending / approved / rejected
6. ComposerPanel 新增 plan 渲染分支
```

**验收标准**:
- 单元测试 ≥ 15 个（PlanStage 状态机 + generatePlan + PlanStep 操作）
- 集成测试 ≥ 5 个（端到端：prompt → plan → confirm → edits）
- E2E 断言 ≥ 10 个

**工作量**: 4 人天

---

### G17-02: 统一 Chat/Composer/Agent 入口（P0）

**现状**:
- 聊天在 App.tsx 主对话区
- Composer 在右侧浮动面板（ComposerPanel）
- Agent 调用通过 Slash Commands 触发（/review / /fix / /review-fix-loop）
- 三个模式分散在不同位置，缺乏统一入口

**期望**:
- 借鉴 Cursor 的 Cmd+L（Chat）+ Cmd+I（Composer）+ Agent 切换
- 在 BrandHeader 添加 ModeToggle（Chat | Composer | Agent）
- 快捷键：
  - `Cmd/Ctrl+L` - 切换 Chat
  - `Cmd/Ctrl+I` - 切换 Composer（已实现）
  - `Cmd/Ctrl+Shift+A` - 切换 Agent
- Mode 状态持久化到 localStorage
- 三种模式在主对话区顶部显示当前模式徽章

**技术方案**:
```
1. 新增 useMode hook（chat | composer | agent）
2. ModeToggle 组件（类似 ModeSelector 风格）
3. App.tsx 整合 useMode，监听全局快捷键
4. BrandHeader 集成 ModeToggle
5. 持久化：localStorage hermes.mode
```

**验收标准**:
- 单元测试 ≥ 12 个（useMode + ModeToggle + 快捷键）
- E2E 断言 ≥ 8 个

**工作量**: 5 人天

---

### G17-03: 渐进式 UI 预览（v0/Bolt 风格）（P0）

**现状**:
- Composer 生成代码后，用户需要切到 IDE 才能看效果
- 没有实时预览能力
- 体验脱节

**期望**:
- Composer 生成代码后，在 Preview 面板实时渲染
- 类似 v0/Bolt 的沙箱化预览
- 支持：HTML/CSS/JS 即时渲染 + React 组件预览 + 错误捕获

**技术方案**:
```
1. 新增 PreviewPanel 组件（独立 iframe 沙箱）
2. 使用 srcdoc 注入 HTML
3. 监听 Composer 的 applyEdit 事件，触发预览刷新
4. 支持三种渲染模式：
   a) HTML 直渲染（简单场景）
   b) 沙箱 + 预置 React（中等场景）
   c) iframe + postMessage（复杂场景）
5. 错误捕获：window.onerror + 沙箱内 console 桥接
6. 自动保存预览快照（关联 snapshot 机制）
```

**验收标准**:
- 单元测试 ≥ 10 个
- 集成测试 ≥ 5 个
- E2E 断言 ≥ 8 个

**工作量**: 6 人天

---

### G17-04: @ 引用类型扩展（P1）

**现状**:
- 已实现：@file / @folder / @code / @docs / @web
- 缺少：@codebase / @git / @diff

**期望**:
- @codebase - 语义搜索整个代码库（需要后端支持）
- @git - 引用 git 历史（commits / branches / blame）
- @diff - 引用未提交的 diff

**技术方案**:
```
1. parseReferences 新增 codebase / git / diff 类型
2. 新增 ContextSource 抽象：FileContextSource / GitContextSource / DiffContextSource
3. 后端 API：
   - GET /api/search?query=... （codebase 语义搜索）
   - GET /api/git/history?file=...&limit=20
   - GET /api/git/diff
4. 前端 resolvers：自动调用 API 解析引用
```

**验收标准**:
- 单元测试 ≥ 8 个
- 集成测试 ≥ 4 个

**工作量**: 2 人天

---

### G17-05: Background Agents 后台任务（P1）

**现状**:
- Composer 同步执行，阻塞 UI
- 长时域任务（如全仓库重构）用户体验差

**期望**:
- 借鉴 Cursor 3.0 Background Agents
- Composer 任务可"丢到后台"继续执行
- 前台继续编辑/聊天
- 后台任务完成后通知

**技术方案**:
```
1. 后端：
   - WebSocket /api/agent/background 端点
   - 任务队列（asyncio.Queue + 持久化到 Redis/SQLite）
   - 后台 Worker 进程（multiprocessing）
2. 前端：
   - useBackgroundAgent hook（订阅 WebSocket）
   - BackgroundTasksPanel（任务列表 + 进度 + 取消）
   - Toast 通知"任务完成"
```

**验收标准**:
- 后端单测 ≥ 15 个
- 前端单测 ≥ 10 个
- E2E 断言 ≥ 12 个

**工作量**: 5 人天

---

### G17-06: 项目级 AI 规则系统（P1）

**现状**:
- 仅有 AGENTS.md 静态规则
- 缺少项目级 AI 行为定制

**期望**:
- 借鉴 .cursorrules
- 用户可在项目根目录创建 .hermesrules.yaml
- AI 在处理该项目时自动加载并应用规则
- 规则支持：type_safety / error_handling / framework / import_order / naming

**技术方案**:
```
1. 新增 .hermesrules.yaml schema（zod 定义）
2. 后端：/api/projects/{id}/rules 端点
3. 前端：RulesEditor 模态（可视化编辑 + 实时预览）
4. Composer 集成：发送 prompt 时附加 rules 上下文
5. 规则预置：5 套模板（TypeScript Strict / Python PEP8 / React Best / Vue Best / Generic）
```

**验收标准**:
- 后端单测 ≥ 8 个
- 前端单测 ≥ 10 个
- E2E 断言 ≥ 6 个

**工作量**: 3 人天

---

### G17-07: Composer 2.5 风格本地化 hint 机制（P1）

**现状**:
- LLM 工具调用失败时仅返回 error
- 缺少针对性自然语言提示

**期望**:
- 失败时 LLM 重新分析 + 输出针对性 hint
- 借鉴 Composer 2.5 的 "Localized Natural-Language Hints"

**技术方案**:
```
1. 后端：
   - ToolExecutionError 数据结构扩展 { error, hint, context }
   - 失败时调用 LLM 重生成 hint（针对具体错误）
   - 反馈到 LLM 下一次重试
2. 前端：
   - UI 显示 hint（在错误卡片）
   - 用户可手动 override hint
```

**验收标准**:
- 后端单测 ≥ 12 个
- E2E 断言 ≥ 6 个

**工作量**: 3 人天

---

### G17-08: Self-Summarization（P2）

**现状**:
- Composer 长 session context 持续累积
- 超过窗口后需要丢弃

**期望**:
- 类似 Composer 1.5 自动摘要
- context 超过阈值时自动生成摘要
- 保留关键信息（edit 历史、context、决策）

**技术方案**:
```
1. ComposerEngine 新增 summarize() 方法
2. 触发条件：context tokens > 8000
3. 摘要内容：edits 概要 + context 概要 + 决策点
4. 摘要插入到 prompt 头部
```

**验收标准**:
- 单元测试 ≥ 6 个

**工作量**: 2 人天

---

### G17-09: 语音输入（本地化）（P2）

**现状**:
- 纯文本输入

**期望**:
- 借鉴 Voibe + SuperWhisper
- 浏览器 Web Speech API + 本地模型
- 长按快捷键说话

**技术方案**:
```
1. useVoiceInput hook
2. 浏览器原生 Web Speech API
3. 可选：Whisper.cpp WASM 本地推理（更大模型）
4. 快捷键：Cmd+Shift+V
```

**验收标准**:
- 单元测试 ≥ 8 个
- E2E 断言 ≥ 4 个

**工作量**: 4 人天

---

### G17-10: 跨项目多仓库编排（P2）

**现状**:
- 调度平台仅处理单项目

**期望**:
- 借鉴 Cursor 3.0 "Agents Window"
- 一个 workflow 跨多个项目
- 项目间依赖管理

**技术方案**:
```
1. 后端：ProjectGroup 概念
2. 多仓库 git worktree 支持
3. 跨项目 Agent 调度
4. 依赖关系 DAG
```

**验收标准**:
- 后端单测 ≥ 15 个
- E2E 断言 ≥ 10 个

**工作量**: 6 人天

---

## 三、Cycle 17 任务清单

### P0（必做，目标 100% 完成）

| 任务 | 关联 Spec |
|---|---|
| G17-01: Composer Plan Mode | CYCLE17_SPEC_PLAN_MODE.md |
| G17-02: 统一 Chat/Composer/Agent 入口 | CYCLE17_SPEC_MODE_TOGGLE.md |
| G17-03: 渐进式 UI 预览 | CYCLE17_SPEC_PREVIEW.md |

### P1（应做，目标 ≥ 80% 完成）

| 任务 | 关联 Spec |
|---|---|
| G17-04: @ 引用类型扩展 | CYCLE17_SPEC_REFERENCES.md |
| G17-05: Background Agents | CYCLE17_SPEC_BACKGROUND_AGENTS.md |
| G17-06: 项目级 AI 规则 | CYCLE17_SPEC_PROJECT_RULES.md |
| G17-07: 本地化 hint 机制 | CYCLE17_SPEC_HINTS.md |

### P2（视时间）

| 任务 | 关联 Spec |
|---|---|
| G17-08: Self-Summarization | CYCLE17_SPEC_SUMMARIZATION.md |
| G17-09: 语音输入 | CYCLE17_SPEC_VOICE.md |
| G17-10: 跨项目编排 | CYCLE17_SPEC_MULTI_REPO.md |

---

## 四、风险评估

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| Plan Mode LLM 输出不稳定 | 中 | 多 prompt 优化 + fallback 到直接执行 |
| 沙箱渲染 React 体积大 | 中 | 按需懒加载 + CDN 预加载 |
| Background Agents 资源消耗 | 中 | 任务优先级队列 + 自动降级 |
| Web Speech API 兼容性 | 低 | 提供手动输入降级路径 |

---

## 五、依赖关系

```
G17-01 Plan Mode (基础)
   ↓
G17-02 统一入口（依赖 Plan Mode 的 UI 集成）
   ↓
G17-03 预览（依赖 G17-01 的快照机制）

G17-04 引用扩展（独立）
G17-05 Background Agents（独立）
G17-06 项目规则（独立）
G17-07 hint 机制（独立）
```

---

**更新日期**: 2026-07-29  
**负责人**: Hermes AI Agent  
**下一步**: 创建 3 个 P0 Spec 文档
