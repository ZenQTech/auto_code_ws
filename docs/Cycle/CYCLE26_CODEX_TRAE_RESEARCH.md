# Cycle 26 Codex / TRAE Solo 模式深度调研报告

**调研日期**: 2026-07-30
**调研主题**: codex v0.105+ 与 TRAE SOLO Mobile / MTC 模式最新特性调研
**目标**: 识别本项目（Hermes Agent 平台）尚未覆盖的关键能力，形成 P0/P1/P2 优先级规划

---

## 一、调研背景

Codex CLI 自 2026 年 2 月起进入 v0.10x 快速迭代阶段，TUI 多智能体、Map-Reduce 风格批处理、Smart Approvals、Hook 引擎、Memory System 等关键能力集中落地。
TRAE 同期在 2026 年 3 月推出独立 SOLO 产品，5 月推出 SOLO Mobile，6 月推出 Design Mode + Global Memory + Voice Chat 增强。

本次调研重点提取对 Hermes 平台有借鉴价值的六大新能力，分析落地路径。

---

## 二、Codex CLI 2026 最新特性（v0.105.0 ~ v0.145.0）

### 2.1 `spawn_agents_on_csv` — Map-Reduce 多智能体批处理（PR #10935, 2026-02）

**核心能力**：模型可调用一个工具读取 CSV 文件，按行创建子智能体，并发执行并收集结果到新 CSV。

**参数定义**（来源：codex-rs/core/src/tools/spec.rs）：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `csv_path` | string | 是 | 输入 CSV 路径 |
| `instruction` | string | 是 | 工作器指令模板，支持 `{column}` 占位符 |
| `id_column` | string | 否 | 稳定 ID 列名（缺省 `row-0`/`row-1`...） |
| `output_csv_path` | string | 否 | 输出 CSV 路径（缺省 `<input_stem>.agent-job-<suffix>.csv`） |
| `max_concurrency` | integer | 否 | 最大并发（受 `agents.max_threads` 限制） |
| `max_workers` | integer | 否 | `max_concurrency` 别名，1 表示顺序执行 |
| `max_runtime_seconds` | integer | 否 | 单项超时 |
| `output_schema` | object | 否 | 输出 JSON schema |

**实现要点**（来源：codex-rs/core/src/tools/handlers/agent_jobs.rs 1,227 行）：
- CSV 解析：BOM 处理、灵活列数、空行跳过、Header 唯一性校验
- 模板渲染：`instruction` 中 `{column_name}` 替换为行值
- SQLite 持久化：Job + Item 记录全部入库，进程崩溃后可恢复
- 进度推送：实时 ETA + 完成计数

**Hermes 现状**：我们已有 `MultiTaskOrchestrator` 支持 5-10 个任务并行，但**没有基于 CSV 的批量扇出模式**。可以扩展现有编排器以支持 CSV 入口。

### 2.2 TUI 多智能体工作流（v0.105.0, 2026-02-25）

**PR 矩阵**：
- #12320 子智能体昵称（+1125 行）
- #12327 清洁的子智能体 TUI（+1734 行）
- #12332 改进的 agent picker（+1828 行）
- #12570 保留 dead agents（+189 行）
- #12767 待处理子线程审批展示（+419 行）

**Agent Picker 设计**：
- `open_agent_picker()` 弹出选择浮层
- 遍历所有已知 thread event channel
- 抓取元数据（昵称、角色、open/closed 状态）
- 通过 nicknames 排序展示

**Hermes 现状**：已有 `MultiAgentTreePanel` 路径树视图，但**没有 nickname + 角色 + 状态三联展示的 picker**。

### 2.3 Smart Approvals + 智能命令策略（v0.120 ~ v0.128, 2026-05）

**核心痛点**：`on-request` 模式把 `git log --oneline` 和 `rm -rf /` 同等对待，每次 shell 都要确认。

**三层架构**：
1. **Base approval policy**：`never` / `on-request` / `on-failure` / `untrusted`
2. **Starlark execution policy rules**：基于 Starlark 脚本定义细粒度规则（前缀匹配、参数校验）
3. **Guardian auto-reviewer**：可委托的自动审阅 Agent

**典型规则示例**：
```starlark
# 允许所有 git 只读命令
match prefix("git") and not contains("push") and not contains("reset --hard")
allow()

# 禁止 rm -rf 根目录
match prefix("rm") and contains("-rf /")
block("禁止删除根目录")
```

**TUI 流程**：每次触发新命令前缀，Codex 提议一条规则 → 接受 / 修改 / 拒绝 → 持久化到 execpolicy 文件。

**Hermes 现状**：已有 `API Interceptor` 和 `GlobalErrorHandler`，但**没有命令级别的细粒度审批系统**。

### 2.4 Hooks 引擎（v0.118+）

**18 种生命周期事件**（与 Claude Code 对齐）：

| 事件 | 触发时机 |
|---|---|
| `pre_tool_use` | 工具调用前 |
| `post_tool_use` | 工具调用后 |
| `user_prompt_submit` | 用户提交 prompt |
| `session_start` / `session_end` | 会话边界 |
| `pre_compact` / `post_compact` | 上下文压缩 |
| `notification` | 系统通知 |
| `stop` | 智能体停止 |
| `subagent_start` / `subagent_end` | 子智能体生命周期 |
| `pre_mcp_tool_use` / `post_mcp_tool_use` | MCP 工具 |
| `error_occurred` | 异常 |
| `permission_request` | 权限请求 |
| `config_change` | 配置变更 |
| `worktree_create` / `worktree_remove` | Worktree 生命周期 |
| `model_switch` | 模型切换 |

**三种处理器**：
- **Command**：执行 shell，stdin JSON in / stdout JSON out
- **Prompt**：提交模型判断，返回 `{"ok": true/false}`
- **Agent**：启动专用验证智能体

**退出码语义**：`0` 放行 / `2` 阻断 / 其他传播错误。

**Hermes 现状**：已有 `HooksEngine` + `HookChainTracker` + `HookPerformanceAnalyzer` + `HookTemplateMarketplace` 完整体系，**对齐度 90%+**。

### 2.5 `/fast` 持久化快速层（v0.131+）

```bash
/fast on    # 启用 1.5× 速度，更高 credit 消耗
/fast off
```

**特性**：状态在用户级别持久化，重启会话后保留偏好。

**Hermes 现状**：无对应能力。可以扩展 `CustomModelsPanel` 加入"快速模式"开关。

### 2.6 TUI 语音输入（Hold Spacebar）

按住空格键录音，松开发送。`features.voice` 启用。

**Hermes 现状**：已有 `VoiceInputAdapter` + `VoiceButton`，但**没有 TUI 风格的快捷键触发**。

### 2.7 主题选择器 + 实时预览（v0.121+）

`/theme` 弹出选择器，主题变更即时在 TUI 中预览。

**Hermes 现状**：前端已有 `SettingsPanel` 主题切换，但**没有 TUI 等价物**（不在本期范围）。

### 2.8 45 个 Slash Commands（v0.131）

| 分类 | 命令数 | 代表 |
|---|---|---|
| Model/Performance | 3 | `/model`, `/fast`, `/personality` |
| Session | 5 | `/resume`, `/archive`, `/fork`, `/rollout`, `/new` |
| Workflow/Mode | 4 | `/plan`, `/agent`, `/review`, `/goal` |
| Permissions | 4 | `/approvals`, `/sandbox`, `/guardian`, `/policy` |
| Context | 3 | `/init`, `/status`, `/context` |
| Agent/Extension | 6 | `/mcp`, `/plugin`, `/skill`, `/agents`, `/subagent`, `/team` |
| TUI | 3 | `/theme`, `/vim`, `/layout` |
| Diagnostics | 4 | `/logs`, `/debug`, `/doctor`, `/feedback` |
| Background | 2 | `/jobs`, `/cancel` |
| Other | 11 | 杂项 |

**Hermes 现状**：已有 `SlashCommandPicker` + `SlashCommandHelp`，**对齐度 80%+**。

### 2.9 Agent Teams（Codex 增强版，2026）

**配置示例**：
```json
{
  "team_id": "my-feature-team",
  "members": [
    { "name": "planner", "task": "制定实现计划", "agent_type": "architect" },
    { "name": "implementer", "task": "实现功能", "agent_type": "develop", "worktree": true },
    { "name": "reviewer", "task": "审查代码", "agent_type": "code-review" }
  ]
}
```

**关键能力**：
- `team_task_list` / `team_task_claim_next` / `team_task_complete` 任务流
- `team_message` 点对点 / `team_broadcast` 广播
- 持久化 Inbox（JSONL 格式）
- 进程崩溃后数据不丢
- `worktree: true` 自动分配独立 Git Worktree 避免冲突

**Hermes 现状**：已有 `MultiTaskOrchestrator` 任务管理 + `Worktree` 隔离 + `SubAgent` 机制，**对齐度 70%**（缺团队配置 JSON 化、JSONL Inbox）。

### 2.10 Web UI + Remote Control（`codex serve`）

```bash
codex serve                    # 启动 Web UI（默认随机端口 + 安全 Token）
codex serve --port 8080        # 指定端口
codex serve --no-open          # 不自动打开浏览器
```

基于 Axum + React + SSE 构建，可通过内网穿透实现跨设备访问。

**Hermes 现状**：本身就是 Web 应用，**对齐度 100%**。

### 2.11 Memory System（v0.140+）

跨会话持久化用户偏好、决策、事实、上下文、反馈。

**Hermes 现状**：已有 `GlobalMemoryEngine` + `AgentsMdPanel`，**对齐度 95%+**。

### 2.12 Plugins 系统

用户可加载第三方 plugin 扩展 CLI 能力。

**Hermes 现状**：已有 `EnterpriseHubPanel` + `PluginMarketplace`，**对齐度 80%+**。

---

## 三、TRAE SOLO 2026 最新特性

### 3.1 SOLO Mobile（2026-05-06）

**核心场景**：移动端分发 + 桌面端执行。

**功能矩阵**：
- **双模式切换**：Code Mode（开发者）+ MTC Mode（非开发者）
- **跨设备同步**：扫码/命令配对，文件夹级授权
- **远程文件夹访问**：手机安全连接桌面，访问授权目录
- **多任务并行调度**：手机调度，云端 + 多桌面并行执行
- **后台执行 + 推送通知**：任务不阻塞 UI，关键节点推送
- **Artifact 预览**：手机端直接预览代码、文档、图表
- **Unified Diff 视图**：手机上查看代码变更
- **Brainstorm Mode**：语音/文字输入，AI 实时澄清 → 总结 → 结构化执行计划

**Hermes 现状**：Web 应用完整，**没有移动端 + 远程桌面控制**（不在本期目标）。

### 3.2 MTC Mode（More Than Coding）

**核心能力**：超出代码的非技术任务。

**支持的文件类型**：
- 文档：`.docx`, `.pdf`, `.txt`
- 数据：`.csv`, `.xlsx`, `.json`
- 演示：`.pptx`
- 代码：`.py`, `.js`, `.ts`, `.html`, `.css`, `.md`
- 图像：截图分析 → UI 重建

**典型场景**：
- 上传 `.docx` → AI 总结/重写/翻译
- 上传 `.csv` → AI 数据分析 + 可视化
- 上传 `.pptx` 模板 → AI 生成幻灯片
- 上传 `.py` 脚本 → AI 优化/调试

**Hermes 现状**：完全没有 MTC 模式支持。**可作为 Cycle 26 的 P1 候选**（受限前端处理能力，主要做 MVP 演示）。

### 3.3 Global Memory（2026-06-24）

跨所有历史交互保留上下文，整合到个性化知识库。

**Hermes 现状**：已有 `GlobalMemoryEngine`，**对齐度 100%**。

### 3.4 Design Mode（2026-06-24）

设计工作流一体化：
- 生成设计稿
- 批量自然语言编辑
- 设计系统管理
- 设计导出代码

**Hermes 现状**：已有 `FigmaAdapter` 节点树 → 代码转换，但**没有批量自然语言编辑 + 设计系统管理**。

### 3.5 Voice Chat 增强（2026-06-24）

- 集成 Web 搜索
- 项目级 context / memory 引用

**Hermes 现状**：已有 `VoiceInputAdapter` + 跨会话 memory 引用，**对齐度 80%**。

### 3.6 Worktree 特性（2026-05-08）

不同任务在独立 Git 环境中运行，每个任务有专属目录/依赖/变更，主工作区不受干扰。

**Hermes 现状**：已有 `WorktreePanel` + Worktree Backend 适配层，**对齐度 95%+**。

### 3.7 Voice Discussion（2026-05-08）

交互式语音对话，适合需求设计、问题分析等需要来回沟通的场景。

**Hermes 现状**：有 `VoiceInputAdapter`，但**没有 Voice Discussion 双向对话模式**。

### 3.8 Hooks 支持（2026-06-12, v3.5.66）

在设置 → Hooks 中配置钩子。

**Hermes 现状**：已有 `HooksEngine`，**对齐度 100%**。

### 3.9 对话流节点自动折叠

启用后，已完成任务折叠并生成摘要，可展开查看细节。

**Hermes 现状**：已有 `UnifiedTimeline` + `AgentChatCard` 折叠能力，**对齐度 90%+**。

### 3.10 多端点实时同步（v0.0.10+）

Web + Desktop + Mobile 任务状态、上下文、进度同步。

**Hermes 现状**：单 Web 端，**无端点同步**（不在本期目标）。

### 3.11 视频生成（v0.1.39, 2026-07-21）

TRAE Work Desktop & Web 支持视频生成。

**Hermes 现状**：无视频生成能力（不在本期目标）。

### 3.12 TRAE Agent + Skills 工具调用

内置 4 类 Skill 模型：
- 图片内容识别（豆包/Gemini/GLMV）
- 文生图/图生图（NanoBanana/Seedream/Kling/Vidu/wanx）
- 图生视频（Deedance/Kling/Vidu/wanx）
- 编剧/分镜（Opus 4.6/GPT-5/GLM/豆包）

**Hermes 现状**：前端纯文本/工具类，**无多媒体生成链路**（不在本期目标）。

---

## 四、差距分析与优先级排序

### 4.1 已对齐能力（≥90%）

| 能力 | Codex | TRAE | Hermes 对齐度 |
|---|---|---|---|
| Web UI | ✅ | ✅ | 100% |
| 主题系统 | ✅ | ✅ | 95% |
| 语音输入 | ✅ | ✅ | 80% |
| Hooks 引擎 | ✅ | ✅ | 95% |
| 跨会话 Memory | ✅ | ✅ | 100% |
| Worktree 隔离 | ✅ | ✅ | 95% |
| 多任务并行 | ✅ | ✅ | 90% |
| 设计 → 代码 | ✅ | ✅ | 85% |
| 对话流折叠 | ✅ | ✅ | 90% |
| 插件市场 | ✅ | ✅ | 80% |
| Slash Commands | ✅ | ✅ | 80% |
| SubAgent 体系 | ✅ | ✅ | 85% |
| Auto Code Review | ❌ | ✅ | 100%（Cycle 25 已实现） |
| PR Bot | ✅ | ✅ | 100%（Cycle 25 已实现） |
| AI 性能优化 | ❌ | ✅ | 100%（Cycle 25 已实现） |

### 4.2 尚未实现的关键能力

| 能力 | 来源 | 优先级 | 建议 Cycle |
|---|---|---|---|
| **CSV 批处理智能体**（Map-Reduce） | Codex v0.105 | P0 | Cycle 26 G26-01 |
| **Smart Approvals（Starlark 策略）** | Codex v0.120+ | P0 | Cycle 26 G26-02 |
| **MTC Mode（More Than Coding）** | TRAE 2026 | P1 | Cycle 26 G26-03 |
| **Voice Discussion（双向语音对话）** | TRAE 2026 | P1 | Cycle 27 |
| **CSV/XLSX/PPTX 上传与处理** | TRAE MTC | P1 | Cycle 27 |
| **Agent Teams JSON 配置 + JSONL Inbox** | Codex 增强版 | P2 | Cycle 27 |
| **多端点同步（Web + Mobile）** | TRAE Mobile | P2 | 不在目标范围 |
| **Brainstorm Mode** | TRAE Mobile | P2 | Cycle 27 |
| **视频生成链路** | TRAE Work | P3 | 不在目标范围 |
| **/fast 快速层切换** | Codex v0.131 | P3 | Cycle 28 |

---

## 五、关键技术细节摘录

### 5.1 spawn_agents_on_csv 内部实现

```rust
// codex-rs/core/src/tools/handlers/agent_jobs.rs (1,227 lines)
async fn handle_spawn_agents_on_csv(
    &self,
    params: SpawnAgentsOnCsvParams,
) -> Result<ToolOutput, ToolError> {
    // 1. CSV 解析 + Header 校验
    let csv = parse_csv(&params.csv_path)?;
    validate_unique_headers(&csv.headers)?;

    // 2. 模板渲染
    let rendered_instructions: Vec<String> = csv.rows.iter()
        .map(|row| render_template(&params.instruction, &csv.headers, row))
        .collect();

    // 3. 创建 Job + Items
    let job_id = self.db.create_job(...)?;
    let items: Vec<Item> = csv.rows.iter().enumerate()
        .map(|(i, row)| Item {
            id: csv.id_column.as_ref()
                .and_then(|c| row.get(c).cloned())
                .unwrap_or_else(|| format!("row-{}", i)),
            // 去重：相同 ID 追加 -2, -3...
            dedup_suffix: deduplicate_id(...),
        })
        .collect();

    // 4. 持久化到 SQLite
    self.db.create_items(&items)?;

    // 5. 启动并发执行（受 max_threads 限制）
    self.executor.spawn_batch(items, |item| async move {
        self.run_subagent(item, rendered_instructions[item.index]).await
    }).await
}
```

### 5.2 Smart Approval Policy 规则示例

```starlark
# ~/.codex/policy/default.star

def is_git_safe(cmd):
    """git 只读命令自动放行"""
    return cmd.startswith("git") and not any(
        dangerous in cmd for dangerous in [
            "push --force", "reset --hard", "clean -fdx", "branch -D"
        ]
    )

def is_npm_dev(cmd):
    """npm 开发命令放行"""
    return cmd.startswith("npm") and any(
        safe in cmd for safe in ["install", "test", "run", "run-script"]
    )

# 主规则
match_all = [
    (is_git_safe, allow("git readonly")),
    (is_npm_dev, allow("npm dev")),
    (lambda c: c.startswith("rm -rf /"), block("forbidden")),
    (lambda c: True, prompt("review required")),
]
```

### 5.3 Agent Teams JSONL Inbox 格式

```jsonl
{"ts":1719765432,"from":"planner","to":"implementer","type":"task_assignment","payload":{"task_id":"t-42"}}
{"ts":1719765532,"from":"implementer","to":"reviewer","type":"task_complete","payload":{"task_id":"t-42","diff_sha":"abc123"}}
{"ts":1719765632,"from":"reviewer","to":"broadcast","type":"feedback","payload":{"verdict":"REQUEST_CHANGES"}}
```

### 5.4 /theme 实时预览实现

TUI 主题切换不重启进程：维护 theme tokens Map → 通过 React context provider 注入 → 全局样式变量即时更新。

### 5.5 语音 TUI 集成

```rust
// 监听键盘事件
match event {
    KeyEvent { code: KeyCode::Char(' '), state: Pressed } => {
        if !recording {
            start_voice_capture();
            recording = true;
        }
    }
    KeyEvent { code: KeyCode::Char(' '), state: Released } => {
        if recording {
            let audio = stop_voice_capture();
            let text = transcribe(audio)?;
            send_to_composer(text);
            recording = false;
        }
    }
}
```

---

## 六、对 Cycle 26 的建议

### 6.1 三大 P0 候选功能

#### G26-01: CSV Batch Agent Engine（CSV 批处理智能体）
- **来源**：Codex `spawn_agents_on_csv` v0.105
- **价值**：补齐 Hermes 在批量扇出场景的能力，扩展 MultiTaskOrchestrator
- **核心组件**：
  - `csvBatchEngine.ts`：CSV 解析 + 模板渲染 + 子智能体调度
  - `csvBatchEngineTypes.ts`：Job/Item/Result 数据模型
  - `csvBatchEngine.test.ts`：单元测试（30+ 用例）
  - `CsvBatchPanel.tsx`：上传 CSV + 指令模板 + 进度监控 UI
  - `CsvBatchPanel.test.tsx`：组件测试（20+ 用例）
- **验收指标**：支持 1-50 个工作项、并发可配置、ETA 准确率 ≥80%、结果可导出

#### G26-02: Smart Approval Engine（智能审批系统）
- **来源**：Codex Smart Approvals v0.120+
- **价值**：解决 Hermes 平台命令/工具执行的安全审批问题
- **核心组件**：
  - `smartApprovalEngine.ts`：Starlark-lite 规则解析 + 决策
  - `smartApprovalTypes.ts`：Rule/Decision/Audit 数据模型
  - `smartApprovalRules.ts`：内置 30+ 安全规则
  - `smartApprovalEngine.test.ts`：单元测试（40+ 用例）
  - `SmartApprovalPanel.tsx`：规则管理 + 审计日志 UI
  - `SmartApprovalPanel.test.tsx`：组件测试（20+ 用例）
- **验收指标**：支持 prefix/contains/regex 匹配、支持 allow/block/prompt 三种决策、规则可持久化、审计完整

#### G26-03: MTC Adapter（非编码任务适配器）
- **来源**：TRAE MTC Mode 2026
- **价值**：扩展 Hermes 平台能力到非编码场景（文档/数据/演示）
- **核心组件**：
  - `mtcAdapter.ts`：文件类型检测 + 任务路由 + 结果整合
  - `mtcAdapterTypes.ts`：FileType/Task/Result 模型
  - `mtcAdapterHandlers.ts`：CSV/JSON/TXT/MD 处理策略
  - `mtcAdapter.test.ts`：单元测试（25+ 用例）
  - `MTCPanel.tsx`：文件上传 + 任务选择 + 结果预览 UI
  - `MTCPanel.test.tsx`：组件测试（15+ 用例）
- **验收指标**：支持 5+ 文件类型、3+ 任务类型（总结/分析/翻译/重写/可视化）、结果可导出

### 6.2 集成与验收

- **BrandHeader 集成**：新增 3 个菜单项（CSV 批处理 / 智能审批 / MTC 适配器）
- **AppLayout 透传**：3 个回调
- **App.tsx 状态管理**：3 个 panel state
- **端到端集成测试**：3 大引擎协同 + UI 联动
- **目标测试通过率**：100%

### 6.3 风险与对策

| 风险 | 对策 |
|---|---|
| CSV 解析兼容性（BOM/换行/引号转义） | 使用 PapaParse 成熟库；提供 10+ 边缘用例测试 |
| Starlark-lite DSL 复杂度 | 简化为 JSON Schema + 表达式（regex/length/contains）三件套 |
| MTC 文件类型处理能力 | 限制为纯文本/JSON/CSV；文档类（PDF/DOCX）转为提示用户提供文本 |
| 智能审批误判 | 缺省全部 prompt，仅允许显式 allow 列表；提供 dry-run 模式 |
| 测试执行时间增长 | 单元测试限制 < 100ms/例；集成测试按 engine 拆分 |

---

## 七、参考资料

1. **Codex v0.105.0 Multi-Agent Workflows** (2026-02-25, coygeek) — <https://github.com/openai/codex/issues/12832>
2. **Codex Changelog** (OpenAI Official) — <https://developers.openai.com/codex/changelog/>
3. **Codex CLI 权威技术参考指南** (Blake Crosley, 2026-07-26) — <https://blakecrosley.com/zh-Hans/guides/codex>
4. **Codex Smart Approvals 深度解析** (Daniel Vaughan, 2026-05-04) — <https://codex.danielvaughan.com/2026/05/04/codex-cli-smart-approvals-adaptive-command-policies-prefix-rules/>
5. **Codex 45 Slash Commands v0.131** (Daniel Vaughan, 2026-05-19) — <https://codex.danielvaughan.com/2026/05/19/codex-cli-slash-commands-complete-reference-v0131-45-commands/>
6. **OpenAI Codex 详细介绍** (CSDN, 2026-06-28) — <https://blog.csdn.net/IOIO_/article/details/162399568>
7. **Codex 高效技巧 2026** (CSDN, 2026-05-04) — <https://blog.csdn.net/weixin_44058951/article/details/160691119>
8. **Codex 增强版 Agent Teams + Hooks** (xiayx, 2026-07-30) — <https://m.xiayx.com/article/992054/>
9. **TRAE 官方文档** — <https://docs.trae.ai/ide/what-is-trae?_lang=zh>
10. **TRAE SOLO 模式概览** — <https://docs.trae.ai/ide/solo-mode>
11. **TRAE 工具面板** — <https://docs.trae.ai/ide/tool-panels>
12. **TRAE 新 SOLO 介绍** (2026-03-31) — <https://www.trae.ai/blog/new_solo_beta_0331>
13. **TRAE SOLO Mobile 介绍** (2026-05-06) — <https://www.trae.ai/blog/trae_solo_mobile_0506>
14. **TRAE SOLO 深入评测** (FreeAITool, 2026-05-18) — <https://freeaitool.com/en/ai-assistants/trae-solo-review-2026/>
15. **TRAE Changelog** — <https://www.trae.ai/changelog>
16. **TRAE SOLO MTC 做短剧** (TRAE 论坛, 2026-04-11) — <https://forum.trae.cn/t/topic/7910>
17. **TRAE SOLO iOS App** — <https://apps.apple.com/ky/app/trae-solo-ai-work-assistant/id6761401019>

---

**调研结论**：Cycle 26 建议聚焦 **CSV 批处理智能体 + 智能审批系统 + MTC 适配器** 三大 P0 能力，与现有 20+ 引擎形成完整闭环。完成后再评估 Cycle 27 候选（Voice Discussion / Brainstorm / 端点同步等）。
