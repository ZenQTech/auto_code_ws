# Cycle 19 功能差距分析（Gap Analysis）

> **日期**: 2026-07-29
> **Cycle**: Cycle 19
> **基于**: CYCLE18_SUMMARY.md + CYCLE18_GAP_ANALYSIS.md
> **目标**: 识别 Cycle 18 后剩余的 P1 差距，融合最新 Cursor 3.0 / Codex CLI / Trae SOLO Mobile 特性

---

## 一、调研结论

### 1.1 Cursor 3.0（2026-04-02）核心新增

| 特性 | 来源 | 优先级 | 备注 |
|---|---|---|---|
| **Agents Window** | [Cursor 3 官方博客](https://cursor.com/blog/cursor-3) | 极高 | 多 Agent 并行运行 + 统一侧边栏 |
| **Design Mode (⌘+Shift+D)** | [Cursor 3 Changelog](https://cursor.com/es/changelog/3-0) | 极高 | 直接点击 UI 元素反馈给 Agent |
| **/worktree 命令** | 同上 | 高 | git worktree 隔离多任务 |
| **/best-of-n 命令** | 同上 | 高 | 多模型并行同一任务，结果对比 |
| **Agent Tabs** | 同上 | 中 | 多个聊天面板并列/网格 |
| **集成浏览器** | 同上 | 中 | 浏览器内验证 UI 修改 |
| **MCP 结构化内容** | 同上 | 中 | 第三方应用更丰富的工具调用结果 |
| **Await 工具** | 同上 | 中 | Agent 可等待 shell/子 Agent 完成 |

**关键数据**：
- 35% Cursor 自家 PR 由 Cloud Agents 自动生成
- Multi-Agent 协作比单 Agent 性能高 90.2%（Anthropic 研究）
- 57% 组织在生产中部署多步 Agent 工作流

### 1.2 Codex CLI v0.142.5（2026-07）核心特性

| 特性 | 来源 | 优先级 | 备注 |
|---|---|---|---|
| **多 Agent 并行（Subagents）** | [Codex 多 Agent 实战](https://www.cnblogs.com/vibecodinghuanzhe/p/21026531) | 极高 | 主 Agent 拆解 + Subagents 并行 |
| **Auto-review** | 同上 | 中 | 沙箱内自动代码审查 |
| **AGENTS.md 多级配置** | [Codex CLI Research](https://github.com/Jamie-BitFlight/claude_skills/blob/e8d97b5ce2e6b39b3f51d55cb6aeb906f93b9bc0/research/coding-agents/openai-codex-cli.md) | 中 | global → git root → current dir 合并语义 |
| **/compact 自动摘要** | 同上 | 已实现 | 上下文压缩 |
| **Skills（SKILL.md）** | 同上 | 中 | 可扩展非编程任务 |
| **Codex Web 后台并行 PR** | [Codex Guide 2026](https://www.toolhub.co.in/2026/04/openai-codex-autonomous-ai-agent-guide.html) | 高 | 后台生成多个 PR |

### 1.3 Trae SOLO / SOLO Mobile（2026-05-06）核心特性

| 特性 | 来源 | 优先级 | 备注 |
|---|---|---|---|
| **SOLO Mobile 移动调度** | [TRAE SOLO Mobile](https://www.trae.ai/blog/trae_solo_mobile_0506) | 中 | 移动端任务调度 + 多设备同步 |
| **Code Mode + MTC Mode** | 同上 | 中 | 双模式切换（开发 / 业务） |
| **Brainstorm Mode** | 同上 | 中 | 想法捕获 → 任务计划 |
| **Voice Input** | 同上 | 中 | 语音消息转执行指令 |
| **Background Execution** | 同上 | 中 | 后台执行 + push 通知 |
| **多任务并行** | [TRAE SOLO 模式](https://docs.trae.ai/ide/solo-mode) | 极高 | 单项目多任务并行 |
| **Figma 设计还原** | [TRAE Figma to code](https://docs.trae.ai/ide/figma-to-code) | 中 | Figma → 代码 |
| **对话流节点自动折叠** | 同上 | 已实现（C18） | 摘要折叠 |
| **Diff 视图** | 同上 | 已实现 | 多文件 diff 展示 |

---

## 二、差距总览

| 编号 | 差距名称 | 优先级 | 影响范围 | 工作量 |
|---|---|---|---|---|
| **G19-01** | **Background Tasks Panel**（后台任务监控面板） | P0 | Composer + Sidebar | 4 人天 |
| **G19-02** | **Best-of-N Multi-Model 并行执行** | P0 | Composer Engine | 3 人天 |
| **G19-03** | **Design Mode 可视化反馈**（点击 UI 元素注解） | P0 | Composer + Browser | 4 人天 |
| **G19-04** | **Brainstorm Mode**（想法捕获 → 任务计划） | P1 | Chat Engine | 2 人天 |
| **G19-05** | **Worktree 隔离执行**（git worktree 多任务隔离） | P1 | Composer + Git | 3 人天 |

**核心目标**：让 Hermes 平台从「AI 辅助写作」升级为「AI 智能体调度 + 编排」。

---

## 三、详细差距分析

### G19-01: Background Tasks Panel（P0）

**现状**：
- Composer 只支持单任务编辑流
- 缺少后台任务并行能力
- 无法在多个 Agent 同时工作时切换/监控
- 与 Cursor 3.0 Agents Window 差距巨大

**期望**：
- 后台任务面板（类似 Cursor Agents Window）
- 并行运行多个 Composer / Agent 任务
- 每个任务有独立状态指示器（idle / running / waiting / done / error）
- 支持暂停 / 恢复 / 取消 / 切换
- 任务完成后显示 diff / artifact / 输出
- 跨 session 持久化（localStorage / 后端）

**技术方案**：
```
1. 后台任务管理引擎（BackgroundTaskEngine）
   - 任务类型：composer / agent / brainstorm / review
   - 状态机：pending → queued → running → waiting → done / error / cancelled
   - 事件总线：TaskEventBus
   - 持久化：localStorage + 后端 /api/tasks
2. 后台任务面板（BackgroundTasksPanel）
   - 任务卡片（type icon + name + status + progress + duration）
   - 筛选：all / running / done / error
   - 操作：pause / resume / cancel / open
   - 网格布局（2-4 列）
3. Sidebar 集成：BrandHeader 显示当前任务数
4. ComposerPanel 集成：head 按钮 + 全屏后台模式
5. 多任务并行：使用 Web Worker 隔离计算密集型任务
```

**验收标准**：
- 单元测试 ≥ 15 个（状态机 + 事件总线 + 持久化）
- 集成测试 ≥ 8 个（任务创建/暂停/恢复/取消/切换）
- E2E 断言 ≥ 10 个
- 至少支持 3 个并发任务

**工作量**：4 人天

---

### G19-02: Best-of-N Multi-Model 并行执行（P0）

**现状**：
- Composer 单次只能调用一个模型
- 用户无法对比不同模型输出
- 与 Cursor `/best-of-n` 差距大

**期望**：
- 用户输入 prompt 后，并行调用 N 个模型
- 显示 N 个候选结果
- 用户可对比 / 选择 / 合并
- 支持模型组合：claude-sonnet / gpt-5 / deepseek / 自定义
- N 默认 3，最大 5

**技术方案**：
```
1. MultiModelExecutor 引擎
   - 并行调用多个 LLM API
   - 结果流式返回（流式进度展示）
   - 超时控制：单模型最长 60s
   - 错误降级：单模型失败不影响其他
2. BestOfNPanel 组件
   - 候选结果网格（2-3 列）
   - 实时进度（每个模型的流式 token）
   - 完成时间 / token 成本对比
   - 选择 / 合并操作
3. ComposerPanel 集成：
   - 发送按钮旁边新增 "Best-of-N" 模式切换
   - 完成后展示候选网格
4. 后端 API：
   - POST /api/llm/best-of-n { models: [], prompt: "" }
   - 流式返回每个模型的 SSE
```

**验收标准**：
- 单元测试 ≥ 12 个（executor + 错误降级 + 超时）
- 集成测试 ≥ 6 个（多模型并行 + UI 切换）
- E2E 断言 ≥ 8 个

**工作量**：3 人天

---

### G19-03: Design Mode 可视化反馈（P0）

**现状**：
- 无法直接点击 UI 元素反馈给 AI
- 用户需要文字描述视觉修改需求
- 与 Cursor 3.0 Design Mode (⌘+Shift+D) 差距大

**期望**：
- Preview 模式下可启用 Design Mode
- 鼠标悬停 UI 元素高亮（带 outline）
- 点击元素后自动附加到 prompt（@element:btn-primary）
- 选中区域 → 截图 + 附加
- 框选（Shift+drag）支持
- 元素位置 / 大小 / 样式信息自动注入

**技术方案**：
```
1. DesignModeController
   - 鼠标事件监听（mouseover / click / drag）
   - 元素识别（DOM Walker + getBoundingClientRect）
   - 选择状态管理
   - 截图（html2canvas）
2. DesignModeOverlay
   - 覆盖层（absolute, z-50）
   - 高亮边框（被悬停元素）
   - 选择指示器（已选元素 badge）
   - 工具栏（退出 Design Mode / 截图 / 重置）
3. PreviewPanel 集成：
   - 顶部 "Design Mode" 切换按钮
   - 启用后显示 DesignModeOverlay
4. @element:xxx 引用解析
   - 新增 ContextType: 'element'
   - ComposerPanel 集成
```

**验收标准**：
- 单元测试 ≥ 10 个（控制器 + 选择器）
- 集成测试 ≥ 6 个（UI 交互 + 元素选择）
- E2E 断言 ≥ 8 个

**工作量**：4 人天

---

### G19-04: Brainstorm Mode（P1）

**现状**：
- 用户提交需求时缺少引导
- 直接给 AI 一个 prompt 容易遗漏关键细节
- 与 Trae SOLO Mobile Brainstorm Mode 差距

**期望**：
- Brainstorm Mode 引导用户逐步澄清需求
- AI 主动追问关键决策点
- 实时生成结构化 plan
- 一键转换为 Composer 任务
- 支持"已想清楚" / "需要 AI 引导"两种入口

**技术方案**：
```
1. BrainstormSession
   - 会话状态：exploring → clarifying → refining → finalizing
   - 关键问题模板：用户角色 / 目标 / 约束 / 验收标准
   - 决策点记录
2. BrainstormPanel 组件
   - 3 栏布局：AI 提问 / 用户回答 / 当前摘要
   - "完成"按钮 → 生成结构化 spec
   - 转换按钮 → 发送到 Composer
3. ChatView 集成：
   - 输入框旁 Brainstorm 切换按钮
   - 检测模糊需求自动建议进入 Brainstorm
```

**验收标准**：
- 单元测试 ≥ 8 个（会话状态机 + 模板）
- 集成测试 ≥ 4 个（UI 流）
- E2E 断言 ≥ 5 个

**工作量**：2 人天

---

### G19-05: Worktree 隔离执行（P1）

**现状**：
- 多个 Composer 任务可能修改同一文件冲突
- 缺少 Git worktree 隔离
- 与 Cursor /worktree 差距

**期望**：
- 用户可选择 "在 worktree 中执行"
- 每个任务有独立 worktree 路径
- 任务完成后可合并 / 丢弃
- UI 显示当前任务的 worktree 状态

**技术方案**：
```
1. WorktreeManager
   - 创建 worktree（git worktree add）
   - 状态查询（list / status）
   - 合并 / 清理
2. ComposerPanel 集成：
   - 头部 worktree 切换开关
   - 显示当前 worktree 路径
3. 后端 API：
   - POST /api/git/worktree/create
   - GET /api/git/worktree/list
   - POST /api/git/worktree/{id}/merge
   - DELETE /api/git/worktree/{id}
```

**验收标准**：
- 单元测试 ≥ 10 个（worktree 操作）
- 集成测试 ≥ 4 个（UI 集成）
- E2E 断言 ≥ 6 个

**工作量**：3 人天

---

## 四、依赖关系

```
G19-01 Background Tasks Panel (基础)
   ├── G19-02 Best-of-N (依赖任务管理)
   ├── G19-03 Design Mode (独立)
   ├── G19-04 Brainstorm Mode (独立)
   └── G19-05 Worktree (依赖任务管理)

执行顺序：
  Phase 1: G19-01 (1 周)
  Phase 2: G19-03 (并行，0.5 周) + G19-04 (并行，0.25 周)
  Phase 3: G19-02 (0.5 周)
  Phase 4: G19-05 (0.5 周)
```

---

## 五、风险评估

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| Web Worker 兼容性 | 中 | 降级到 setTimeout 分片 |
| 多 LLM API 并发成本 | 中 | Best-of-N 限制 N ≤ 5，提供开关 |
| 浏览器 DOM 性能 | 中 | 覆盖层用 React Portal + transform |
| Git worktree 权限 | 低 | 检测失败时降级到普通执行 |
| 任务状态同步 | 中 | 后端 SSE 推送 + 前端事件总线 |

---

## 六、任务清单

### P0（应做，目标 ≥ 100% 完成）

| 任务 | 关联 Spec | 工作量 |
|---|---|---|
| G19-01 Background Tasks Panel | CYCLE19_SPEC_BACKGROUND_TASKS.md | 4 人天 |
| G19-02 Best-of-N Multi-Model | CYCLE19_SPEC_BEST_OF_N.md | 3 人天 |
| G19-03 Design Mode | CYCLE19_SPEC_DESIGN_MODE.md | 4 人天 |

### P1（可做，目标 ≥ 50% 完成）

| 任务 | 关联 Spec | 工作量 |
|---|---|---|
| G19-04 Brainstorm Mode | CYCLE19_SPEC_BRAINSTORM.md | 2 人天 |
| G19-05 Worktree 隔离 | CYCLE19_SPEC_WORKTREE.md | 3 人天 |

**本轮聚焦 P0 任务**（G19-01/02/03），P1 任务（脑风暴 + Worktree）作为下一轮 Cycle 20 候选。

---

**更新日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 创建 3 份 P0 Spec 文档
