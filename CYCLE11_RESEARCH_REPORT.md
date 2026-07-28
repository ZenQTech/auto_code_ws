# Cycle 11 研究报告 - Hermes 持续集成 vs Codex v0.145+ / TRAE v3.5.79+

> **周期**: Cycle 11
> **研究时间**: 2026-07-28
> **对比基准**: Hermes v6.11.0 vs Codex CLI v0.145.0 / TRAE v3.5.79
> **目的**: 调研 /import 跨平台迁移、codex doctor 诊断、Playwright E2E 自动化的最新技术架构

---

## 一、研究背景

经过 Cycle 1-10 的 10 轮迭代，Hermes 已经实现了：
- Loop Engineering v7 完整工作流（triage→plan→execute→verify）
- Verification Loop（P1-10）4 维度验证 + 自动修复
- Memory System（P1-8）Dual-Track Persistent Memory
- .trae/skills/, .trae/agents/, .trae/rules/, .trae/hooks/ 等扩展能力
- DiffView 多格式 + 快照 + ref 对比

但仍存在 3 个核心差距（来自 Cycle 10 GAP_ANALYSIS）：
- **P3-1 /import**：跨平台配置迁移（Codex v0.145.0 新增）
- **P2-2 doctor**：环境诊断系统（Codex v0.131.0 引入）
- **P2-1 Playwright**：前端 E2E 自动化（缺失）

本轮研究目的：深入理解这三个能力的实现机制，为 Cycle 11 实现提供技术基础。

---

## 二、Codex /import 命令深度分析

### 2.1 核心能力

**Codex v0.145.0 /import（2026-07-21 发布）**：

`/import` 是 OpenAI 在 Codex CLI v0.145.0 中推出的**跨平台配置迁移命令**，核心目标是用一个命令把用户在其他 AI 编程工具（Cursor / Claude Code / Continue）中的所有配置、记忆、习惯一次性迁移到 Codex 中。

**关键引用**：
> "The update 'expanded /import to migrate Cursor and Claude Code settings, MCP servers, plugins, sessions, commands, and project-scoped memories' into Codex."
> —— OpenAI Codex Release Notes, 2026-07-21

**支持的数据迁移类型**：
1. **Settings**（设置）：sandbox / approval / model 偏好
2. **MCP servers**（MCP 服务器列表 + 认证信息）
3. **Plugins**（插件 / 扩展）
4. **Sessions**（最近 30 天的聊天历史）
5. **Commands**（自定义 slash commands）
6. **Project memories**（项目级 memory / AGENTS.md / CLAUDE.md）

### 2.2 实现机制

**JSON-RPC API**：
```
externalAgentConfig/detect    # 检测已安装的外部 agent
externalAgentConfig/import    # 异步执行导入
```

**两种迁移路径**：

| 路径 | 适用场景 | 能力 | 限制 |
|------|----------|------|------|
| **路径 A** | Mac 桌面应用 | 一键自动 import（instructions + config + skills + MCP + hooks + subagents） | tool restrictions / MCP custom auth / plugins 需手动复查 |
| **路径 B** | CLI 手动迁移 | 按映射表手工迁移 | 全部手工，无自动转换 |

**CLI 映射表**（路径 B）：

| Claude Code | Codex | 说明 |
|------|------|------|
| `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md` | 全局个人指令 |
| `.claude/CLAUDE.md` | `AGENTS.md`（项目根） | 团队约定 + Git 跟踪 |
| `~/.claude/settings.json` | `~/.codex/config.toml` | 全局设置（sandbox/approval/model） |
| `.mcp.json` | `[mcp_servers.*]` in config.toml | MCP 服务器列表 |
| `hooks` in settings.json | `hooks` in config.toml | 事件钩子 |
| `permission mode: default/acceptEdits/plan/auto` | `sandbox_mode` + `approval_policy` | 权限模式（1:1 不对应） |

**关键技术点**：

1. **格式转换器**（Format Converter）：
   - JSON → TOML（settings.json → config.toml）
   - 平铺结构 → 分层结构（mcpServers 数组 → [mcp_servers.*] 段）
   - 字段重命名（permissionMode → sandbox_mode + approval_policy）

2. **AGENTS.md 标准融合**：
   - AGENTS.md 已被 Linux Foundation Agentic AI Foundation 接受为开放标准（2025-12）
   - 60,000+ 开源项目采用
   - 支持：Codex CLI / Cursor / Copilot / Windsurf / Amp / Gemini CLI

3. **SKILL.md 同样标准化**：
   - Claude Code `~/.claude/skills/<n>/SKILL.md` ≡ Codex `~/.agents/skills/`
   - 文件格式相同，只有目录路径不同

4. **异步后台执行**：
   - 导入任务通过 background session 异步执行
   - 提供 progress 回调 + 失败重试

### 2.3 安全约束

- **只读不写**：源数据（Claude Code 数据）**绝不修改**
- **dry-run 选项**：导入前预览变更清单
- **路径白名单**：仅允许迁移到 `~/.codex/` 或项目根
- **敏感信息脱敏**：API key / token 不直接迁移，提示用户重新输入

### 2.4 Hermes 实现借鉴

借鉴 Codex /import 的设计，Hermes 应实现：

| 能力 | Codex 实现 | Hermes 应实现 |
|------|-----------|---------------|
| 检测外部工具 | externalAgentConfig/detect | `/api/import/detect` 扫描 `~/.claude/`, `~/.cursor/`, `~/.codex/`, `~/.trae/` |
| 数据预览 | dry-run 模式 | `POST /api/import/preview` 列出待迁移项 |
| 执行迁移 | externalAgentConfig/import | `POST /api/import/run` 异步执行 |
| 状态查询 | 异步 session | `GET /api/import/status/{id}` |
| 4 源平台 | Cursor/Claude Code | Cursor/Claude Code/Codex/TRAE |
| 6 类数据 | settings/mcp/plugins/sessions/commands/memories | 同样 6 类 |

---

## 三、Codex doctor 诊断系统深度分析

### 3.1 核心能力

**Codex doctor（v0.131.0 引入，v0.135.0 强化）**：

`codex doctor` 是一条**单命令环境诊断命令**，目的是帮助用户和客服在不需深挖日志/环境变量/配置目录的情况下，**一键获取运行环境的完整健康报告**。

**关键引用**：
> "Codex CLI v0.131.0 shipped a better answer: `codex doctor` — a single command that runs a comprehensive diagnostic sweep across runtime, authentication, terminal capabilities, network connectivity, MCP server health, and local state."
> —— Codex Doctor: The Diagnostic Command, danielvaughan.com, 2026-05-22

### 3.2 5 大诊断类别（v0.135.0）

| 类别 | 检查项 | 输出 |
|------|--------|------|
| **Environment** | runtime version / platform / PATH | 1 行版本信息 + PATH 列表 |
| **Configuration** | config.toml 解析状态 / auth mode / sandbox / feature flags | 解析成功 / 失败 + 详细字段 |
| **Updates** | 当前版本 / latest version / 更新可用性 | "↑ updates X.Y.Z available" |
| **Connectivity** | API endpoint reachability / ChatGPT WebSocket (HTTP 101) | ✓ / ⚠ / ✗ 状态 |
| **Background Server** | app-server daemon 状态 / SQLite 完整性 / rollout stats | 进程 PID + 端口 + 数据库健康 |

### 3.3 Notes 块

顶部 Notes 块聚合**异常信号**：

```
Notes
 ↑ updates 0.130.0 available (current 0.0.0, dismissed 0.128.0)
 ⚠ rollouts 1,526 active files · 2.53 GB on disk
 ⚠ mcp MCP configuration has optional issues
 ⚠ auth mixed auth signals: ChatGPT login plus API key env var
```

### 3.4 输出模式

| Flag | 用途 |
|------|------|
| `--summary` | 紧凑视图（仅标题 + 状态） |
| `--json` | 结构化 JSON（脱敏），供支持工具消费 |
| `--all` | 展开截断列表（如完整 MCP 工具清单） |
| `--no-color` | 去除 ANSI 颜色（适合管道传输） |

### 3.5 JSON 输出结构

```json
{
  "notes": [...],
  "checks": {
    "env.runtime": { "status": "ok", "details": {...} },
    "config.parse": { "status": "ok" },
    "connectivity.openai": { "status": "ok" },
    ...
  }
}
```

### 3.6 与 Feedback 集成

`codex doctor --json` 输出**自动附加到用户反馈报告**，减少客服来回问问题。

### 3.7 Hermes 实现借鉴

| 能力 | Codex 实现 | Hermes 应实现 |
|------|-----------|---------------|
| 5 大类别 | Environment/Configuration/Updates/Connectivity/Background Server | environment/git/llm/database/workspace/dependencies |
| Notes 块 | 顶部异常聚合 | 同 |
| 4 输出模式 | --summary/--json/--all/--no-color | 同 |
| 异步执行 | 同步即可（<5s） | 同 |
| 健康检查 | 当前已有 /health 端点 | 增强：6 大类全量诊断 |
| 反馈集成 | 附加到 feedback | 集成到 /api/support/report |

---

## 四、Playwright E2E 自动化深度分析

### 4.1 核心能力

**Playwright MCP（@playwright/mcp，Microsoft 维护）**：

将真实浏览器（Chromium / Firefox / WebKit）暴露为 MCP 工具，让 AI agent 能直接驱动浏览器：
- `browser_navigate` - 导航
- `browser_click` - 点击
- `browser_snapshot` - 获取可访问性树
- `browser_generate_locator` - 生成选择器
- `browser_screenshot` - 截图
- `browser_evaluate` - 执行 JS

**关键引用**：
> "The agent receives structured snapshot — roles, accessible names, states, hierarchy — rather than pixels. That is why it can generate `getByRole('button', { name: 'Place order' })` instead of a fragile pixel-matched guess."
> —— Generate Playwright Tests, codersera.com, 2026-05-18

### 4.2 两种使用模式

| 模式 | 工具 | 用途 |
|------|------|------|
| **Playwright CLI** | `npx playwright test` | 回归测试套件（CI） |
| **Playwright MCP** | `@playwright/mcp` | Agent 驱动浏览器（QA / 自动测试生成） |

**Hermes 应使用 CLI 模式**：写预定义的 spec 文件做 CI 回归。

### 4.3 关键设计原则

1. **Accessibility tree based**：使用 `getByRole` / `getByTestId` 而非脆弱的 CSS/XPath 选择器
2. **真实等待条件**：避免 `waitForTimeout(3000)` 硬等待，使用 `expect(...).toBeVisible()` 等条件等待
3. **状态隔离**：每个测试前清理数据库 / 重置状态
4. **CI/CD 集成**：GitHub Actions workflow + 截图对比 + 自动重试 + JUnit XML 报告

### 4.4 Token 经济性

> "Microsoft's own benchmark puts a typical browser task at roughly 114,000 tokens via MCP versus roughly 27,000 tokens via the newer Playwright CLI"
> —— codersera.com

**结论**：CI 回归测试用 Playwright CLI（更省钱），agent 驱动用 MCP（更灵活）。

### 4.5 Hermes 覆盖场景

| 场景 | 描述 | 关键交互 |
|------|------|----------|
| 模式选择器 | 切换 Chat / Solo / Code 模式 | 点击 + URL 变化 |
| 聊天流式响应 | 发送消息 → 接收 SSE | 输入 + 等待 streaming |
| DiffView 切换 | unified ↔ side_by_side ↔ json_patch | 点击 tab + 验证内容 |
| 快照管理 | 创建/恢复/删除快照 | 多步操作 + 列表更新 |
| Memory 编辑 | 创建实体 + 添加 observation | 表单 + 列表更新 |
| Loop 命令 | /loop triage/plan/execute/verify | 4 步 + 状态查询 |
| Verification | 创建任务 + 执行 + 查看结果 | 4 步 + 状态徽章 |
| 文件浏览 | 切换项目 + 浏览目录树 | 树操作 + 文件预览 |

### 4.6 性能与可靠性

- **Headless 模式**：CI 默认 headless，无需 GUI
- **浏览器缓存**：Playwright 浏览器二进制 ~700 MB
- **并行测试**：`npx playwright test --workers=4`
- **报告格式**：HTML / JUnit XML / JSON / Trace

### 4.7 Hermes 实现借鉴

| 能力 | 借鉴 | Hermes 实现 |
|------|------|-------------|
| Playwright CLI 集成 | `npx playwright test` | 完整 E2E 套件 + GitHub Actions |
| 8 大核心场景 | 模式选择 / 聊天 / DiffView / 快照 / Memory / Loop / Verification / 文件浏览 | 全部覆盖 |
| 视觉回归 | 截图对比 | baseline screenshot + 像素 diff |
| CI/CD 集成 | GitHub Actions | .github/workflows/e2e.yml |
| 报告生成 | HTML / JUnit | 同 |

---

## 五、TRAE Solo 模式最新动态

**v3.5.79 (2026-07-21)**：安全相关 bug 修复
**v3.5.55-56 (2026-05-08)**：`.trae/commands/` 支持 3 级目录嵌套（Hermes 已实现）
**v3.5.65+**：Hooks 集成
**v3.5.67-71**：文件格式 subagent toggle（默认启用）

**TRAE SOLO 关键特性**：
- 任务管理：多任务并行（不同任务在隔离 Git 环境中）
- 工具面板：编辑器 / 终端 / 浏览器 / DocView
- Figma 导入：自动解析 Figma 设计 → 代码
- Supabase / Vercel / Stripe 集成
- Diff 视图：对话面板中查看变更
- 语音交互 + 图像上传

---

## 六、关键技术决策

### 6.1 P3-1 /import 决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 数据源格式 | JSON / TOML / YAML | 支持 4 个 IDE 原生格式 |
| 目标格式 | Hermes 内部统一格式 | 单一数据模型 |
| 异步 vs 同步 | 异步 | 大量数据导入可能耗时 |
| 增量 vs 全量 | 用户选择 | 灵活性 |
| 错误恢复 | 失败回滚 | 数据一致性 |
| 优先级 | 最高 | 用户切换成本最高 |

### 6.2 P2-2 doctor 决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 诊断类别数 | 6 类 | 超过 Codex 5 类（增加 git/workspace） |
| 输出模式 | 4 种 | 复用 Codex flags（--summary/--json/--all/--no-color） |
| 同步 vs 异步 | 同步（< 10s） | 用户期望即时反馈 |
| 与 /health 关系 | 互补 | /health 是健康检查，doctor 是深度诊断 |
| 优先级 | 高 | 用户自助排查核心 |

### 6.3 P2-1 Playwright 决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 测试模式 | Playwright CLI（非 MCP） | CI 回归 + 省钱 |
| 覆盖场景 | 8 大核心场景 | 满足 spec 要求 |
| CI/CD | GitHub Actions | 标准化 |
| 视觉回归 | 基础截图对比 | MVP 阶段 |
| 优先级 | 中 | 测试基础设施完善 |

---

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 4 源平台格式差异大 | 解析失败 | 强健的 try/except + 降级策略 |
| 大量 MCP 配置迁移 | 性能瓶颈 | 异步执行 + 进度回调 |
| doctor 误报 | 用户困扰 | 严格分级（✓/⚠/✗）+ Notes 解释 |
| Playwright CI 资源占用 | 启动慢 | 复用浏览器 + 缓存 + worker 并行 |
| 浏览器版本差异 | 跨平台一致性 | Docker 镜像固定 Chromium 版本 |

---

## 八、参考资料

1. **Codex /import**：
   - https://github.com/openai/codex/releases/tag/rust-v0.145.0
   - https://codex.danielvaughan.com/2026/05/06/codex-cli-external-agent-migration-detect-import-api-cross-agent-portability/
   - https://dreaming.press/posts/openai-codex-import-migrate-cursor-claude-code-lock-in.html
   - https://anonhaven.com/news/codex-cli-nauchilsya-perenosit-nastrojki-iz-cursor-i-claude-code/
   - http://goddaehee.tistory.com/m/602

2. **Codex doctor**：
   - https://github.com/openai/codex/pull/22336
   - https://codex.danielvaughan.com/2026/05/22/codex-doctor-diagnostic-command-troubleshooting-runtime-auth-network-mcp/
   - https://www.webmastertalk.pl/2026/07/16/codex-0-135-0-nowa-era-diagnostyki-i-edycji-vim-w-narzedziu-programistycznym-openai/
   - https://developers.openai.com/codex/changelog

3. **Playwright MCP**：
   - https://gaffer.sh/blog/playwright-mcp-claude-code-setup/
   - https://github.com/karthik3063/AI_PlaywrightMCP_Agents
   - https://qaskills.sh/blog/playwright-mcp-claude-code-setup-2026
   - https://codersera.com/blog/generate-playwright-tests-claude-code-cursor-2026/

4. **TRAE**：
   - https://www.trae.ai/changelog
   - https://docs.trae.ai/ide/solo-mode
   - https://bbs.csdn.net/weixin_42523389/article/details/100178649

---

## 九、Cycle 11 实施计划

基于以上研究，Cycle 11 实施顺序：

1. **P3-1 /import 跨平台迁移**（最高优先级，8-12h）
2. **P2-2 doctor 环境诊断**（高优先级，3-4h）
3. **P2-1 Playwright E2E 自动化**（中优先级，8-10h）

预期总工时：19-26h
