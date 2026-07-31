# Cycle 13 研究报告 - Hermes Worktree 隔离 + Hermes Python/TypeScript SDK + LLM-as-Judge + Codex Plugin Marketplace

> **周期**: Cycle 13
> **研究时间**: 2026-07-28 15:30
> **对比基准**: Hermes v6.19.0 vs Codex CLI v0.142.0–v0.150.0+ / TRAE v3.5.79+ / v3.5.80+
> **目的**: 调研 Worktree 隔离机制、Codex 双语言 SDK 详细 API、Plugin Marketplace 正式目录、LLM-as-Judge 评分 rubric、auto-compaction 触发与压缩算法、TRAE 多模态/多角色扩展

---

## 一、研究背景

经过 Cycle 1-12 的 12 轮迭代，Hermes 已实现 v6.19.0：

- **Loop Engineering v7 + 6 状态 Goal 状态机**（P1-4 / Cycle 12 P0-2）
- **Verification Loop（P1-10）** 4 维度验证 + 自动修复
- **Memory System（P1-8）** Dual-Track Persistent Memory
- **Plugin 系统（Cycle 12 P0-1）** 8 模块 + 12 端点 + 2 示例 Plugin
- **Three-File Trust 架构（Cycle 12 P0-2）** GOAL/VERIFY/PROGRESS + 独立 Verifier
- **DiffView / Multi-Agent v2 Path Tree / TRACE Correction→Enforcement / 6 大能力域**
- **/import + doctor + Playwright E2E + OAuth 2.1 + Session Rollout JSONL + .trae/{skills,agents,commands,rules,hooks}/**

但与最新 Codex CLI v0.142+ / v0.150+ / TRAE v3.5.79+ / v3.5.80 相比，仍存在以下关键差距：

| 差距编号 | 功能 | 来源 | 状态 |
| --- | --- | --- | --- |
| P0-1 | **Worktree 隔离执行** | TRAE v3.5.79+ / CAID 论文 | ❌ 缺失（Plugin 系统有目录但无隔离执行） |
| P0-2 | **Hermes Python/TypeScript SDK** | Codex SDK v0.131+ | ❌ 缺失（CLI 集成只有 JSON-RPC） |
| P0-3 | **LLM-as-Judge 验证层** | Codex 评测论文 / Verification Horizon | ❌ 缺失（P1-10 仅 4 维度非语义） |
| P1-1 | **Codex Plugin Marketplace 完整集成** | Codex v0.137+ 官方目录 | 部分（自建 dist/.trae/plugins/，无远端市场） |
| P1-2 | **Auto-Compaction 引擎** | Codex v0.142 / MiniCode 7 阶段流水线 | ❌ 缺失（长 session 易撑爆） |
| P1-3 | **TRAE Work 多模态协作** | TRAE v3.5.79 / v0.1.21+ | ❌ 缺失（无 Design Mode / Voice Chat） |
| P1-4 | **Goal auto-turn + 多 Agent 委派策略** | Codex v0.142 多 Agent 委派模式 | ❌ 缺失（Goal 状态机 6 态但无 idle auto-turn） |

本轮研究目的：深入理解 Worktree 隔离、Codex SDK API、Plugin Marketplace、LLM-as-Judge、auto-compaction 的实现细节，为 Cycle 13 实现提供技术基础。

---

## 二、Codex v0.142 / v0.150 关键演进时间线

| 版本 | 时间 | 关键变化 |
| --- | --- | --- |
| Codex v0.131.0 | 2026-05-18 | `codex_app_server` 重命名为 `openai-codex` Python SDK |
| Codex v0.135.0 | 2026-05-28 | `openai-codex==0.1.0b2` + 三种 Sandbox 预设 + `CodexConfig` 替换 `AppServerConfig` |
| Codex v0.136.0 | 2026-06-01 | `codex app-server --stdio` JSON-RPC 2.0 over stdin/stdout + Session Archiving |
| Codex v0.137.0 | 2026-06-04 | `codex plugin list --json` 机器可读插件清单 |
| Codex v0.138.0 | 2026-06-08 | `codex plugin add/remove/marketplace --json` + 默认 prompts + 不可用 app 模板审计 |
| Codex v0.139.0 | 2026-06-09 | MCP 工具 schema `oneOf`/`allOf` 透传修复 |
| Codex v0.140.0 | 2026-06-15 | usage tracking + session deletion |
| Codex v0.142.0 | 2026-06-22 | Plugin Discovery 三层目录 + Rollout Token Budget + 多 Agent 委派模式（disabled/explicit-only/proactive）+ indexed web-search + 时钟提醒 + Parent agents 接收 subagent 终态错误 |
| Codex v0.142.1/2 | 2026-06-25 | 维护修复 |
| Codex v0.150.0 | 2026-07-28 | 多 Agent 自动发现 Plugin 能力 + GA 后续优化 |
| Code Mobile | 2026-07+ | `/goal` 在 Mobile 中支持创建与管理 |

---

## 三、Codex Python SDK v0.1.0b2 完整 API 参考

### 3.1 安装与认证

```bash
# Python 3.10+ 要求
pip install openai-codex==0.1.0b2

# 该包同时拉入 openai-codex-cli-bin（默认 0.132.0）
# 二进制不会嵌入 wheel 中

# 若需在容器/Notebook 中显式控制 CLI 引导：
from openai_codex import Codex
Codex.install(version="rust-v0.132.0")
```

无 Rust 工具链或额外系统依赖；预编译二进制随 wheel 分发。

### 3.2 Sandbox 三种预设

```python
from openai_codex import Sandbox, Codex, CodexConfig

# 1. READ_ONLY — 审计/分析，不允许写入
# 2. WORKSPACE_WRITE — 仅在 CWD 写入（推荐用于编码任务）
# 3. FULL_ACCESS — 无限制文件系统访问（仅限可信环境）
```

关键约束：**线程级 sandbox 是下限**，单次 turn 值不能低于线程级别，只能进一步收紧。

### 3.3 Thread 生命周期

```python
# 同步路径
with Codex() as codex:
    thread = codex.thread_start(sandbox=Sandbox.WORKSPACE_WRITE)
    result = thread.run("用 3 条要点解释这个仓库。")
    print(result.final_response)
    print(result.usage)   # token 消耗
    print(result.collected_items)  # 中间工具调用

# 跨进程恢复
thread_id = result.thread_id  # 持久化此字符串
thread = codex.resume_thread(thread_id)
result = thread.run("继续上次的工作。")

# 异步路径（不要在同一 event loop 混用 Codex + AsyncCodex）
from openai_codex import AsyncCodex
import asyncio

async def main():
    async with AsyncCodex() as codex:
        thread = await codex.thread_start(model="codex-1")
        result = await thread.run("重构此模块以提升清晰度。")
        print(result.final_response)

asyncio.run(main())

# 流式
from openai_codex import StreamingThread
async for chunk in thread.run_streamed("长任务"):
    print(chunk.delta, end="")
```

### 3.4 run() vs turn() 的语义差异

| 方法 | 行为 | 适用 |
| --- | --- | --- |
| `thread.run()` | 单次 prompt → 完整 TurnResult | 普通对话、批处理 |
| `thread.turn()` | 暴露 `TurnHandle` 中途控制 | 取消、中途修改、动态工具注入 |
| `thread.run_streamed()` | async generator 增量事件 | 长任务、UI 流式渲染 |

### 3.5 输入类型（多模态）

```python
# 纯文本
result = thread.run("描述这个 repo")

# 文本 + 图片
result = thread.run([
    {"type": "text", "text": "描述这张截图"},
    {"type": "local_image", "path": "./ui.png"},
    {"type": "local_image", "path": "./diagram.jpg"},
])
```

### 3.6 TurnResult 字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `final_response` | str | Agent 最终文本 |
| `collected_items` | List[Item] | 中间工具调用（按序） |
| `timing` | TimingInfo | 延迟分解 |
| `usage` | UsageInfo | token 计数（prompt/completion/cache） |
| `thread_id` | str | 用于恢复 |

### 3.7 Hermes SDK 设计差距

**Hermes 当前 CLI 集成（cli_integration/）**：通过 JSON-RPC over subprocess 调 Codex CLI，但没有 Pydantic 化的高层 API、没有 Thread 恢复、没有流式 generator、没有 Sandbox 预设抽象。

**建议**：
- P0-2 任务：实现 `hermes_sdk` Python 包 + `@hermes/sdk` TypeScript 包
- API 形态参考 `openai-codex` + `@openai/codex-sdk`
- 提供 `HermesClient` / `HermesThread` / `HermesRun` / `HermesEvent` 四层抽象

---

## 四、Codex TypeScript SDK 完整 API 参考

### 4.1 安装

```bash
npm install @openai/codex-sdk
# Node.js 18+（建议 20.20.0+ 或 22.22.0+）
```

### 4.2 客户端初始化

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: "https://api.openai.com/v1",
  codexPathOverride: "/usr/local/bin/codex",
  env: { PATH: "/usr/local/bin" },
  config: {
    show_raw_agent_reasoning: true,
    sandbox_workspace_write: { network_access: true },
  },
});
```

**配置优先级**：Thread options > Codex options（全局），因为 Thread 后发出。

### 4.3 Thread 管理

```typescript
// 创建 Thread
const thread = codex.startThread();
const turn = await thread.run("诊断测试失败并提出修复");
console.log(turn.finalResponse);
console.log(turn.items);

// 持续对话
const next = await thread.run("实现该修复");

// 恢复
const savedId = process.env.CODEX_THREAD_ID!;
const resumed = codex.resumeThread(savedId);
await resumed.run("继续");

// 工作目录控制（需为 Git 仓库，或 skipGitRepoCheck: true）
const thread2 = codex.startThread({
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,
});
```

### 4.4 流式响应

```typescript
const { events } = await thread.runStreamed("诊断并修复");

for await (const event of events) {
  switch (event.type) {
    case "item.completed":
      console.log("item", event.item);
      break;
    case "turn.completed":
      console.log("usage", event.usage);
      break;
  }
}
```

**Event 类型清单**：`item.started` / `item.completed` / `turn.started` / `turn.completed` / `error` / `thread.started` / `thread.completed`。

### 4.5 Structured Output

```typescript
const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["ok", "action_required"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
} as const;

const turn = await thread.run("汇总仓库状态", { outputSchema: schema });
console.log(turn.finalResponse);

// 配合 zod-to-json-schema
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const zodSchema = z.object({
  summary: z.string(),
  status: z.enum(["ok", "action_required"]),
});
const turn2 = await thread.run("汇总仓库状态", {
  outputSchema: zodToJsonSchema(zodSchema, { target: "openAi" }),
});
```

### 4.6 多模态 + AbortSignal

```typescript
// 取消
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);
try {
  await thread.run("长任务", { signal: controller.signal });
} catch (e) {
  if (e.name === "AbortError") { /* ... */ }
}

// 多模态
await thread.run([
  { type: "text", text: "描述这些截图" },
  { type: "local_image", path: "./ui.png" },
  { type: "local_image", path: "./diagram.jpg" },
]);
```

### 4.7 Hermes TypeScript SDK 建议

| 类别 | Codex 提供 | Hermes 缺失 |
| --- | --- | --- |
| `startThread` / `resumeThread` | ✅ | ❌（只有 HTTP API） |
| `run` / `runStreamed` | ✅ | ❌ |
| `outputSchema` | ✅ | ❌ |
| `local_image` input | ✅ | ❌ |
| `AbortSignal` | ✅ | ❌ |
| `workingDirectory` | ✅ | ❌ |

---

## 五、Codex Plugin Marketplace 完整解析

### 5.1 演进时间线

| 时间 | 事件 |
| --- | --- |
| 2026-03-25 | OpenAI 启动 Codex plugins（`https://developers.openai.com/codex/changelog`） |
| 2026-03-27 | 启动 20+ 集成（Slack、Figma、Notion、Sentry、Hugging Face 等） |
| 2026-04-11 | 官方目录上线，含 GitHub/SSH/本地 marketplace 添加命令 |
| 2026-06-04 | CLI 0.137：`codex plugin list --json` |
| 2026-06-08 | CLI 0.138：`plugin add/remove/marketplace --json` + 不可用 app 模板审计 |
| 2026-06-09 | CLI 0.139：MCP `oneOf`/`allOf` 透传修复 |
| 2026-06-22 | CLI 0.142：3 层目录（OpenAI Curated / Workspace / Shared with me）+ 任务感知推荐 |
| 2026-07-09 | ChatGPT App Directory 替换为 Plugin Directory |

### 5.2 Plugin 包结构

```
my-plugin/
├── .codex-plugin/
│   └── plugin.json           # 必需 manifest
├── skills/                    # 可选
│   └── review-standards/
│       └── SKILL.md
├── .app.json                  # 可选 app 集成
├── .mcp.json                  # 可选 MCP server 配置
└── assets/                    # 可选 icon/screenshots
    ├── icon.svg
    └── screenshot-01.png
```

### 5.3 plugin.json manifest 规范

```json
{
  "name": "codex-security",
  "version": "1.2.0",
  "description": "Vulnerability scanning and review",
  "skills": "./skills",
  "interface": {
    "displayName": "Codex Security",
    "category": "Developer Tools",
    "icons": ["./assets/icon.svg"],
    "screenshots": ["./assets/screenshot-01.png"],
    "descriptions": {
      "short": "Scan code for vulnerabilities",
      "long": "Bundle of security skills and MCP server..."
    }
  },
  "author": "Publisher Name",
  "homepage": "https://...",
  "repository": "https://github.com/...",
  "license": "MIT",
  "keywords": ["security", "review", "scanning"]
}
```

**重要约束**：
- 所有路径必须以 `./` 前缀并保持相对
- 整个 bundle 必须 self-contained
- `name` 用 kebab-case 标识符
- 单 plugin 限制约 5-20 skills（Codex 2% 上下文窗口 = 8000 字符的 skill 发现预算）

### 5.4 Marketplace 文件格式

仓库根目录 `.agents/plugins/marketplace.json`：

```json
{
  "name": "magnus-agent-skills",
  "interface": { "displayName": "Magnus Agent Skills" },
  "plugins": [
    {
      "name": "agent-skills-engineering",
      "source": { "source": "local", "path": "./dist/codex-plugins/agent-skills-engineering" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

### 5.5 CLI 命令集

```bash
# 注册 marketplace 源
codex plugin marketplace add openai/codex-plugin-cc       # GitHub shorthand
codex plugin marketplace add https://github.com/owner/repo # HTTPS Git URL
codex plugin marketplace add git@github.com:owner/repo.git # SSH URL
codex plugin marketplace add /path/to/marketplace         # 本地目录

# 安装特定 plugin
codex plugin install codex@openai-codex

# 列表（CI 用）
codex plugin list --json

# 移除
codex plugin remove codex@openai-codex
```

### 5.6 公开 Plugin Directory 提交要求

通过 [OpenAI Portal](https://learn.chatgpt.com/codex/submit-plugins) 提交公开目录：
- 生产就绪的 listing metadata
- 验证后的发布者身份
- 每个 skill 5 个 positive + 3 个 negative 测试用例
- 策略/安全扫描
- Enterprise：RBAC 控制 + 治理策略（preinstalled / on-request / blocked）

### 5.7 Enterprise 三层目录

v0.142 引入：
- **OpenAI Curated**：官方合作伙伴集成
- **Workspace**：企业工作区共享
- **Shared with me**：个人/团队分享

**Mid-conversation 推荐**：eligible turns 会在检测到任务与 plugin 能力匹配时，**主动推荐并安装相关 plugin**。

### 5.8 Hermes Plugin 现状

| 维度 | Hermes v6.19.0 | Codex v0.150 | 差距 |
| --- | --- | --- | --- |
| 本地 plugin 安装 | ✅（dist/.trae/plugins/） | ✅ | 对齐 |
| 远端 marketplace 注册 | ❌ | ✅（GitHub/SSH/HTTPS/本地） | **P1-1 缺失** |
| mid-conversation plugin 推荐 | ❌ | ✅（v0.142） | **P1-1 缺失** |
| 公开 Plugin Directory 提交流程 | ❌ | ✅（5+/3- 测试 + 扫描） | **未来里程碑** |
| MCP server 嵌入 plugin | ❌ | ✅ | **P1-1 缺失** |
| 3 层目录 UI | ❌ | ✅（Curated/Workspace/Shared） | **P1-1 缺失** |

---

## 六、Codex Multi-Agent 委派架构（v0.142）

### 6.1 三种委派模式

`v0.142.0` 引入 `multi_agent_delegation` 配置项：

```toml
# ~/.codex/config.toml
[features]
multi_agent_delegation = "disabled"          # 完全禁用
multi_agent_delegation = "explicit-request-only"  # 仅显式请求时
multi_agent_delegation = "proactive"         # 主动分析并委派
```

可在 thread 级别或 turn 级别覆盖。

### 6.2 内置 Agent 角色

| 角色 | 用途 | 特点 |
| --- | --- | --- |
| `default` | 通用兜底 | 完整读写、默认模型 |
| `worker` | 实现/修复 | 写访问、标准配置 |
| `explorer` | 代码库探索 | 只读、搜索模式 |
| `monitor` | 长时任务监控 | 1 小时 poll 窗口 |

### 6.3 全局配置项

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `agents.max_threads` | number | 6 | 并发线程上限 |
| `agents.max_depth` | number | 1 | 嵌套深度（根从 0 算） |
| `agents.job_max_runtime_seconds` | number | - | CSV 批量任务每个 work 上限 |

### 6.4 CAID 论文关键洞察（arXiv:2603.21489）

**CAID** = Centralized Asynchronous Isolated Delegation（CMU，2026-03）：

> *"四个并行 subagent 之后回报下降明显——并行不是越多越好"*

四大原语：
1. **Centralised manager** — 构建依赖图、分解任务、分发结构化 JSON
2. **Isolated worktrees** — 每个 engineer 在独立 git worktree 防止冲突
3. **Asynchronous execution** — 多 agent 并行到配置上限
4. **Self-verification** — 提交前运行测试，merge 仅在可执行验证后

**关键结论**：4 个 subagent 已是大多数工作负载的天花板；超过则协调成本 > 并行收益。

### 6.5 Hermes Multi-Agent v2 Path Tree 对比

| 维度 | Hermes v6.19.0 | Codex v0.142 |
| --- | --- | --- |
| Path Tree 决策 | ✅（P0-10） | ❌（依靠模型判断） |
| 静态角色定义 | ❌（按需生成） | ✅（default/worker/explorer/monitor） |
| max_threads 上限 | ❌ | ✅（默认 6） |
| max_depth 嵌套 | ❌ | ✅（默认 1） |
| Worktree 隔离 | ❌ | ✅（配合 multi-agent） |
| structured JSON 委派 | 部分 | ✅ |
| CAID 自验证 | ❌ | ✅（merge 前执行测试） |

---

## 七、Codex Auto-Compaction 引擎深度分析

### 7.1 双触发点

**Pre-turn trigger**（在用户 turn 之前）：
```
Token count > threshold
    ↓
Compaction 跑（生成压缩上下文）
    ↓
原始 user message 注入到新窗口
    ↓
用户无感（下次 <Enter> 自动发生）
```

**Mid-turn trigger**（在长工具链中间）：
```
工具链完成一轮（所有 tool result 收到）
    ↓
但上下文已超阈值
    ↓
在 loop boundary 触发 compaction
    ↓
pending user request 被保留并重放到压缩后的上下文
```

**设计哲学**：compaction 是**编织在 agent loop 中**，而非后处理步骤。

### 7.2 双压缩路径

```
Token 超过阈值
    ↓
{OpenAI Codex model?}
   ├── 是 → 远端路径：POST /responses/compact
   │        → 返回 AES 加密的 opaque blob
   │        → 客户端不解析
   │        → 直接传回下一次 responses.create()
   │
   └── 否 → 本地路径：compact.rs
            → LLM 生成明文 handoff summary
            → 4 个组件：进度+决策 / 上下文 / 计划 / 用户偏好
            → 附带回话历史
            ↓
         {Token 释放够吗？}
            ├── 是 → 继续
            └── 否 → 头部裁剪兜底
```

### 7.3 远端压缩加密反转研究

Kangwook Lee 2026-03 通过 35 行 Python + 提示注入撬开 Codex 黑盒：

> *“blob 里没有潜空间，没有向量数据，就是一段普普通通的明文 LLM 摘要，用 Fernet 加密了一下”*

核心 prompt 开头是 `"You are performing a CONTEXT CHECKPOINT COMPACTION"`，要求模型给下一个接手的 LLM 写交接总结。

**Alexis Gallagher benchmark（pi-openai-server-compaction）**：
- 900 题测试，原生压缩 900/900 正确（与不压缩打平）
- 同预算的文本摘要 745/900 = **82.8%**
- Codex 强并非因为加密黑盒，而是因为模型 + 提示工程本身强

### 7.4 远端压缩 v2（2026 最新）

```
remote v1 → 独立 compact endpoint
remote v2 → 普通请求末尾追加 compaction_trigger（在响应流中就地压缩）
```

后者更适合 SDK 集成，无需额外调用。

### 7.5 MiniCode 7 阶段压缩流水线

参考开源实现 MiniCode（CSDN 2026-07-27）：

```python
class CompactTrigger(str, Enum):
    MANUAL = "manual"                # 手动
    AUTO = "auto"                    # 自动高水位
    REACTIVE = "reactive"            # API 报错后
    MICROCOMPACT_TIME = "microcompact_time"
    MICROCOMPACT_CACHED = "microcompact_cached"

class CompactStrategy(str, Enum):
    TOOL_BUDGET = "tool_budget"       # 大工具结果写盘
    READ_DEDUP = "read_dedup"         # 重复读取去重
    MICROCOMPACT = "microcompact"     # 时间清理
    SESSION_MEMORY = "session_memory" # 用记忆做摘要
    FULL = "full"                     # 完整压缩
    REACTIVE = "reactive"             # 错误恢复激进截断
    PARTIAL = "partial"               # 部分压缩
```

**触发条件**：token 用量 > 85% 窗口上限 → 优先 SessionMemoryCompact（轻），失败则 FullCompact（重）。

**CompactBoundary 标记**：每次压缩插入 `_compact_boundary: True` system 消息；下次只处理 boundary 之后的消息。

### 7.6 Hermes 现状差距

| 维度 | Hermes v6.19.0 | Codex / MiniCode |
| --- | --- | --- |
| Token 计数 | ❌ | ✅ |
| 触发阈值（85%） | ❌ | ✅ |
| Pre-turn 压缩 | ❌ | ✅ |
| Mid-turn 压缩 | ❌ | ✅ |
| 远端 opaque blob | ❌ | ✅ |
| 本地 LLM 摘要 | ❌ | ✅ |
| CompactBoundary 标记 | ❌ | ✅ |
| Tool result 写盘 | ❌ | ✅ |
| Reactive 错误恢复 | ❌ | ✅ |
| Resume 后 hydrate | ❌ | ✅（v0.142 token-budget reset） |

**Hermes 长 session 风险**：Cycle 9+ 之后 loop / goal / verification 全部叠加，单 goal 可能跑 1-7 小时，**当前无任何 compaction 机制**，必然撞上 token 上限。

---

## 八、TRAE Worktree 隔离机制深度分析

### 8.1 核心机制

TRAE SOLO（2026-05-05 v0.1.8-0.1.9）引入 **Worktree 功能**：

> *“为每个任务创建一个独立的目录，其中包含专属的文件、依赖项和代码变更，从而确保你的主工作目录保持整洁且不受干扰”*

### 8.2 工作树名词

| 名词 | 描述 |
| --- | --- |
| 工作树 | Git 原生机制：单个代码仓库可同时拥有多个独立工作目录，每个目录可检出不同分支 |
| 工作树分支 | 某个工作树检出的 Git 分支（如 `feat-pet-shop-1sfbnt`） |
| 工作树目录 | 与工作树关联的本地文件夹路径（TRAE 中与分支同名，格式 `/<worktree_branch_name>`） |

### 8.3 创建工作树

任务启动前，在对话输入框左下角将模式设置为 Worktree 模式：

1. 任务启动 → 自动创建专属工作树分支和目录
2. 用户在对话流顶部看到带工作树标记的新分支
3. Agent 在独立目录中读写、跑测试
4. 主工作目录完全不受影响

### 8.4 合并代码

**AI 自动合并**：工作树分支栏点击 "AI 合并"，AI 分析代码变更、解决冲突、完成 merge。

**手动合并**：
- 工作树分支栏 `···` → 手动合并
- 若冲突：点击 "AI 解决冲突" → 继续
- 合并后对话流底部出现 "代码已合并" 分割线
- 分割线上方对话产生的内容**无法回退**

### 8.5 磁盘占用管理

**设置 → 工作树**：
- 查看所有工作树磁盘占用
- 工作树磁盘空间占用提醒（可设阈值）
- 清理工作树：3 种方式（任务列表/设置中心/分支栏）

清理选项：保留工作树分支 vs 彻底删除。

### 8.6 Git Worktree 原理

```
my-project/                  # main worktree (main branch)
├── .git/                    # 实际 git 数据
my-project/agent-1/          # linked worktree (agent-1/task-42)
├── .git → ../.git           # .git 文件，指向 main 的 .git
my-project/agent-2/          # linked worktree (agent-2/task-43)
├── .git → ../.git
```

**关键优势**：
- **共享 object store**：无需 clone，无重复磁盘
- **独立 HEAD/staging/file**：每个 worktree 完全独立
- **快速**：仅 checkout 不同分支
- **mergeable**：标准 git merge/rebase

**约束**：
- 同一分支不能同时被两个 worktree checkout
- 依赖目录（`node_modules`、`.venv`）每个 worktree 独立管理
- 大量 worktree 并存会显著增加磁盘占用

### 8.7 Worktree 生命周期

```bash
# 创建
git worktree add .codeframe/worktrees/task-1 -b cf/task-1

# Agent 在 worktree 目录中运行（cwd 设置为 worktree 路径）

# 验证门在 worktree 内运行

# 成功后：merge worktree branch 回主分支
git -C main merge cf/task-1

# 清理
git worktree remove .codeframe/worktrees/task-1
```

### 8.8 合并冲突处理策略（行业实践）

**Strategy 1: Upfront Conflict Detection（前置检测）**
- 执行前分析每个 agent 将修改的文件
- `check-conflicts.sh` 脚本遍历所有 `agent/*` 分支检测潜在冲突
- 高冲突率则重新分配任务

**Strategy 2: Task Partitioning to Avoid Overlap（任务分区）**
- 按目录/模块分配不同 worktree
- 避免跨文件 API 修改
- 单元测试覆盖率引导

**Strategy 3: Supervised Merge with Escalation（监督式升级）**
- 自动尝试 ours/theirs 解决非重叠冲突
- 失败时创建 blocker + 人类介入

**Strategy 4: Semantic Conflict Resolution（高级）**
- 对 git 冲突做语义理解
- 提取双方变更意图
- LLM 调解

### 8.9 Performance Trick

**naive（慢）**：每个任务 fresh worktree，结束时 destroy。
**优化**：固定 worktree 池，每个 task 用 worktree 暂存 patch，结束时 squash merge 或 rebase merge。

```
my-project/
├── src/                              # main
├── .agents/
│   ├── eng-1/                        # eng-1/task-ready branch
│   ├── eng-2/                        # eng-2/task-ready branch
│   └── eng-3/                        # eng-3/task-ready branch
└── .git/                             # shared
```

### 8.10 Hermes 现状差距

| 维度 | TRAE v3.5.79+ | Hermes v6.19.0 |
| --- | --- | --- |
| Worktree 模式开关 | ✅ | ❌ |
| 自动创建 worktree 分支 | ✅（`<task_id>` 命名） | ❌ |
| AI 自动合并 | ✅ | ❌ |
| AI 解决冲突 | ✅ | ❌ |
| 磁盘占用管理 | ✅（设置 → 工作树） | ❌ |
| 清理策略 | ✅（3 种方式 + 保留分支） | ❌ |
| 任务感知推荐分支命名 | ✅ | ❌ |
| 与 Goal/Plugin 集成 | ✅（任务级隔离） | ❌ |

**Cycle 13 P0-1 任务**：实现 `app/core/worktree/` 目录，含 `worktree_models.py` / `worktree_manager.py` / `worktree_merger.py` / `worktree_api.py` / `WorktreeMode` 前端组件。

---

## 九、TRAE Work 平台其他特性

### 9.1 Design Mode（v0.1.21-23，2026-06-24）

> *"为设计需求的场景提供一站式专业能力，涵盖设计稿生成、自然语言批量修改、设计系统管理、设计稿转代码等核心工作流"*

**核心能力**：
- 设计稿生成（自然语言描述 → Figma 风格）
- 自然语言批量修改（如"把所有按钮改成圆角 8px"）
- 设计系统管理（Token、组件库）
- 设计稿转代码（自动切图 + 提取 CSS variables）

### 9.2 Global Memory（v0.1.21-23，2026-06-24）

> *"开启全局记忆后，TRAE 可以更好记住所有历史对话的上下文，沉淀为你的专属记忆"*

**特性**：
- 跨项目/跨会话知识库
- 自动提取对话中的稳定偏好（命名风格、库选择、模式）
- 引用时自动注入上下文
- 与项目级 memory 分层（project + global）

**Hermes 对应**：
- P1-8 Hermes Memory System（Dual-Track Persistent Memory）已实现
- 差距：缺少 Global ↔ Project 双向引用、缺少自动偏好提取

### 9.3 Voice Chat 优化（v0.1.21-23）

> *"语音讨论功能优化：支持联网搜索、读取调用项目级记忆等"*

**新增**：
- Web 搜索（语音过程中）
- 引用项目级 memory
- 拍照上传附件
- 最小化语音对话页
- TRAE APP 抖音账号登录

### 9.4 多模态扩展（v0.0.12-13，2026-07-14）

- 对话流中图片缩略图预览 + 大图查看
- 左右滑翻阅
- HTML 格式产物分享
- 任务搜索 + Pin 置顶
- 站内信消息通知

### 9.5 Mobile App（v0.0.x，2026-05+）

- iOS/Android TRAE APP
- 语音输入
- 移动端仓库/分支检索
- 远程桌面控制
- 实时任务进度监控

### 9.6 SOLO 桌面端（v0.1.13-15，2026-06-01）

内置浏览器选中元素 → 添加到对话/评论。

### 9.7 TRAE v3.5.79+ IDE 端（2026-07-21）

- Windows 智能体 Browser Use 调用外部浏览器
- Spec 模式（SOLO Coder）结构化规范模式
- Subagents 目录加载
- `/commands/` 目录嵌套 3 层
- Browser Use 部分卡片截图

### 9.8 Hermes 差距

| 维度 | TRAE | Hermes |
| --- | --- | --- |
| Design Mode | ✅ | ❌ |
| Global Memory | ✅（项目级 + 全局） | ⚠️（仅项目级 Dual-Track） |
| Voice Chat | ✅（带 web 搜索 + 引用） | ❌ |
| Mobile App | ✅ | ❌ |
| Spec 模式（SOLO Coder） | ✅ | 部分（仅 SPEC 文档） |
| 站内信 | ✅ | ❌ |
| 多模态图片预览 | ✅ | ❌ |

---

## 十、LLM-as-Judge 验证层深度分析

### 10.1 核心方法

LLM-as-Judge = 用一个（通常更强）大语言模型评估另一个语言模型的输出。

**三种主流模式**：
1. **Single-Point Scoring**：1-10 分打分
2. **Reference-Based**：相对参考答案打分
3. **Pairwise Comparison**：成对比较（MT-Bench、Chatbot Arena 核心方法）

### 10.2 工作 prompt 结构（Galtea 4 部分框架）

```
1. Criterion definition    （领域词汇定义评判标准）
2. Reasoning structure     （强制 step-by-step 推理）
3. Scoring rule            （确定性映射到 verdict）
4. Edge cases clause       （处理实际流水线边界情况）
```

### 10.3 Codex 评测 cookbook（OpenAI 官方）

```python
JUDGE_PROMPT = """You are a senior code reviewer. Evaluate the following patch:

DIFF:
{diff}

REVIEW INSTRUCTIONS:
1. List SEVERE issues (security, correctness, performance) — only these block correctness.
2. List minor issues (style, naming) — non-blocking.
3. Avoid nit-level comments unless they block diff understanding.
4. After listing findings, produce an overall correctness verdict:
   - "patch is correct" or "patch is incorrect"
5. Provide concise justification.
6. Provide a confidence score between 0 and 1.

OUTPUT FORMAT (JSON):
{
  "findings": [{"severity": "severe|minor", "file": "...", "line": ..., "description": "..."}],
  "verdict": "correct|incorrect",
  "justification": "...",
  "confidence": 0.95
}

IMPORTANT: file citations and line numbers must be EXACTLY correct.
If they are incorrect your comments will be rejected.
"""
```

### 10.4 Promptfoo Codex SDK Provider（2026-04 集成）

```yaml
providers:
  - id: openai:codex-sdk
    config:
      model: codex-1
      codex_path_override: /usr/local/bin/codex

tests:
  - vars:
      task: "Refactor the authentication module to use bcrypt"
    assert:
      # 1. 模式匹配
      - type: is-json
      - type: contains
        value: "bcrypt"
      
      # 2. LLM-as-Judge rubric
      - type: llm-rubric
        value: |
          Evaluate the refactoring quality:
          - Is bcrypt used correctly with cost >= 12?
          - Are passwords properly hashed before storage?
          - Is plaintext logging avoided?
          Score 0-1. Pass if >= 0.7.
      
      # 3. 成本守卫
      - type: cost
        threshold: 0.50    # $0.50 上限
      
      # 4. 步数守卫
      - type: trajectory-step-count
        max: 20
      
      # 5. 技能使用检测
      - type: skill-used
        value: "code-review"
```

### 10.5 评分 rubric 设计原则

**反模式（vague）**：
> "评估代码质量"  ← Judge 会用先验填入

**好模式（concrete）**：
> "每条事实声明是否被检索上下文直接、显式支持"
> "每个工具调用的参数是否符合任务意图"

**权重分配示例**（CodeRabbit / Sentry 风格）：
| 维度 | 权重 | 评判单元 |
| --- | --- | --- |
| 正确性 | 40% | 算法边界、边界条件、错误处理 |
| 性能 | 20% | 时间/空间复杂度、明显低效 |
| 可读性/风格 | 20% | 命名、结构、注释 |
| 安全性 | 15% | 注入、敏感信息泄露 |
| 可测试性 | 5% | 单测覆盖、可 mock 性 |

### 10.6 Hermes Verification Loop 现状

| 维度 | Hermes v6.19.0 | LLM-as-Judge 需要 |
| --- | --- | --- |
| 单元测试 | ✅ | ✅（可补充 LLM 评估测试意图） |
| 集成测试 | ✅ | ✅ |
| E2E 测试 | ✅ | ✅ |
| 性能基线 | ✅ | ❌（仅数字，不评估语义） |
| 自动修复（3 次重试） | ✅ | ✅（可与 Judge 反馈结合） |
| **LLM-as-Judge 语义验证** | ❌ | **核心缺失** |

**Cycle 13 P0-3 任务**：实现 `app/core/llm_judge/` 目录，含：
- `judge_models.py`（Verdict / Finding / Score / Confidence）
- `judge_prompts.py`（4 部分模板库 + 6 维度 rubric）
- `judge_engine.py`（多 model 并行 + 一致性投票）
- `judge_integration.py`（与 Verification Loop 衔接）

---

## 十一、Codex Goal Mode 完整机制（v0.142+）

### 11.1 5 层架构

| 层 | 组件 | 职责 |
| --- | --- | --- |
| 1 | Persisted Goal State | SQLite 存储 objective/status/budget/usage |
| 2 | App-Server API | `thread/goal/set` `get` `clear` JSON-RPC |
| 3 | Model Tools | `create_goal` / `update_goal` / `get_goal` |
| 4 | Core Runtime | token wall-clock 监控 + 自动暂停/续期 |
| 5 | TUI Integration | `/goal` 斜杠命令 + 状态栏 |

### 11.2 Status 状态机

```
active ←→ paused → budget_limited → complete
   ↓        ↓           ↓
   └── clear/放弃 ────┘
```

模型**不能** pause 或 resume — 这些是系统控制的（防止模型陷入死循环或过早停止）。

### 11.3 Token Budget 治理

`v0.142.0` 引入 **Rollout Token Budgets**：

```toml
[goal]
token_budget_soft = 40000     # 软停止阈值
token_budget_hard = 60000     # 硬停止阈值
```

- **软停止**：注入 steering 提醒
- **硬停止**：abort turn
- **多目标共享**：rollout 级别累计

### 11.4 Goal Workflow 可靠性改进

v0.142 → v0.150 多个 PR：
- `#26047`：多行 paste 在 `/goal edit` 不再早提交
- `#26147`：idle auto-turns 在 Plan mode 中不触发
- `#26690`：goals 在终态 turn 失败后停止 auto-continuing
- `#28808`：Goal-first threads 被 `thread/list` 和 `thread/search` 持久化返回

### 11.5 Mobile Support

`/goal` 在 Codex Mobile 中支持创建与管理（2026-07+）。

### 11.6 Hermes Goal 状态机对比

| 状态 | Hermes v6.19.0 | Codex v0.142+ |
| --- | --- | --- |
| draft → active | ✅ | 类似 |
| active ↔ paused | ✅ | ✅ |
| completed | ✅ | ✅ |
| failed / abandoned | ✅ | ✅ |
| budget_limited | ❌ | ✅（专用状态） |
| idle auto-turn 抑制 | ❌ | ✅（Plan mode 兼容） |
| 终态失败后停止 auto-continue | ❌ | ✅ |
| Goal-first thread list 持久化 | ❌ | ✅ |

**Cycle 13 P1-4 任务**：增强 Goal 引擎：
- 增加 `budget_limited` 状态
- 集成 idle auto-turn 检测
- 修复 goal-first thread 列表过滤

---

## 十二、CAID 论文 + Worktree + Multi-Agent 整合

### 12.1 CAID 关键数据

CMU 论文 *Effective Strategies for Asynchronous Software Engineering Agents*（Geng & Neubig，2026-03）：

| 并行度 | 收益曲线 | 备注 |
| --- | --- | --- |
| 1-2 | 线性增长 | 显著加速 |
| 3-4 | 边际收益开始 | 仍推荐 |
| 5-6 | 收益持平 | Codex 默认上限 |
| >6 | 协调成本 > 并行收益 | 明确反模式 |

### 12.2 Worktree + Multi-Agent 整合模式

```
Manager Agent
    ↓ 解析任务为依赖图
Tasks: A, B, C (独立), D (依赖 A)
    ↓ 为每个独立任务创建 worktree
Worktree A (branch: cf/agent-A)
Worktree B (branch: cf/agent-B)
Worktree C (branch: cf/agent-C)
    ↓ 多个 engineer agents 并行（max 4）
Engineer 1 (在 Worktree A 写)
Engineer 2 (在 Worktree B 写)
Engineer 3 (在 Worktree C 写)
    ↓ 每个 engineer 自验证
test + commit (in worktree)
    ↓ 整合回 main
Integration Branch
    ↓ 冲突解决（auto or human）
Merge complete
```

### 12.3 Hermes 实施建议

**Cycle 13 P0-1 Worktree 隔离 + P0-3 LLM-as-Judge 组合**：
1. Worktree Manager 接收 Goal 任务
2. Path Tree Decomposer 拆分为 2-4 个独立子任务
3. 每个子任务创建独立 worktree
4. Subagent 在 worktree 内执行 + 自验证
5. 完成后 worktree 提交 + LLM-as-Judge 评审
6. Manager 整合 → 主分支 merge
7. 失败时回滚 worktree

---

## 十三、Hermes Cycle 13 优先级建议

### 13.1 优先级矩阵

| 优先级 | 任务 | 复杂度 | 价值 | 来源 |
| --- | --- | --- | --- | --- |
| **P0-1** | Worktree 隔离执行 | 高 | 高 | TRAE v3.5.79 / CAID 论文 |
| **P0-2** | Hermes Python/TypeScript SDK | 中 | 高 | Codex SDK v0.131+ |
| **P0-3** | LLM-as-Judge 验证层 | 中 | 高 | Codex 评测 / Verification Horizon |
| P1-1 | Plugin Marketplace 完整集成 | 高 | 中 | Codex v0.137-0.142 |
| P1-2 | Auto-Compaction 引擎 | 高 | 高 | Codex v0.142 / MiniCode 7 阶段 |
| P1-3 | TRAE Work 多模态协作 | 高 | 中 | TRAE v3.5.79 / v0.1.21+ |
| P1-4 | Goal auto-turn + 委派模式 | 中 | 中 | Codex v0.142 |

### 13.2 Cycle 13 推荐目标

**核心实现**：
- **P0-1 Worktree 隔离**（dist/.trae/worktrees/ + git worktree lifecycle + AI 合并 + 冲突解决）
- **P0-2 Hermes Python SDK**（`hermes-sdk` PyPI 包 + Thread/Turn/Run/Event streaming + Sandbox 预设）
- **P0-3 LLM-as-Judge**（4 部分 prompt 模板 + 6 维度 rubric + 多 model 投票 + 与 P1-10 集成）

**增强实现**：
- **P1-1 Plugin Marketplace 远端注册**（GitHub/SSH/HTTPS/本地 + 3 层目录 UI）
- **P1-2 Auto-Compaction 引擎**（双触发点 + CompactBoundary + 5 阶段策略 + Reactive 兜底）
- **P1-4 Goal 增强**（budget_limited 状态 + idle auto-turn 抑制 + Goal-first thread 过滤）

### 13.3 不在本轮范围

- TRAE Worktree 移动端集成（依赖 TRAE APP）
- Design Mode 完整实现（独立产品方向）
- Voice Chat（硬件 + 模型依赖）
- Plugin 公开目录提交（需 OpenAI 门户）

---

## 十四、详细实施规范

### 14.1 P0-1 Worktree 隔离

**后端模块**（`backend/app/core/worktree/`）：
- `worktree_models.py`（TaskWorktree / MergeResult / ConflictInfo / DiskUsage）
- `worktree_manager.py`（create / remove / list / cleanup）
- `worktree_merger.py`（auto_merge / manual_merge / ai_resolve_conflict）
- `worktree_storage.py`（磁盘占用监控 + 清理策略）
- `worktree_api.py`（12 端点）
- `__init__.py`

**前端**：`WorktreeMode.tsx`（开关 + 列表 + 合并按钮 + 磁盘仪表）

### 14.2 P0-2 Hermes SDK

**Python**（`hermes-sdk/`）：
```python
from hermes_sdk import HermesClient, Sandbox, HermesThread

with HermesClient() as client:
    thread = client.start_thread(sandbox=Sandbox.WORKSPACE_WRITE)
    result = thread.run("解释这个 repo")
    print(result.final_response)
```

**TypeScript**（`packages/hermes-sdk/`）：
```typescript
import { Hermes } from "@hermes/sdk";

const hermes = new Hermes();
const thread = hermes.startThread();
const { events } = await thread.runStreamed("诊断问题");
for await (const event of events) { ... }
```

### 14.3 P0-3 LLM-as-Judge

**后端**（`backend/app/core/llm_judge/`）：
- `judge_models.py`（Verdict / Finding / Score / Confidence）
- `judge_prompts.py`（4 部分模板 + 6 维度 rubric：correctness/security/performance/readability/testability/style）
- `judge_engine.py`（多 model 并行 + 一致性投票 + confidence 阈值）
- `judge_integration.py`（与 P1-10 Verification Loop 集成，作为第 5 维度）
- `judge_api.py`（8 端点）

**典型 rubric 模板**：
```python
CORRECTNESS_RUBRIC = """
You are a senior software engineer evaluating code correctness.
Review the following diff:

{diff}

Check each of these dimensions IN ORDER:
1. Algorithm correctness (does the logic match the stated intent?)
2. Boundary conditions (null/empty/overflow handled?)
3. Error handling (exceptions caught and propagated appropriately?)
4. Thread safety (race conditions, deadlocks, mutable state?)

For each dimension, list SPECIFIC findings with file/line.
After all findings, produce:
- verdict: "correct" or "incorrect"
- confidence: 0.0-1.0
- justification: 1-3 sentences

Output strict JSON.
"""
```

---

## 十五、参考资料

### 15.1 Codex 官方与 SDK

1. **Codex Python SDK v0.1.0b2 API Reference**: <https://codex.danielvaughan.com/2026/06/03/openai-codex-python-sdk-v01-complete-api-reference-practical-patterns/>
2. **Codex TypeScript SDK README**: <https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/README.md>
3. **Codex TypeScript SDK Streaming**: <https://codex.danielvaughan.com/2026/04/08/codex-typescript-sdk-streaming-multimodal/>
4. **App-Server stdio JSON-RPC 2.0**: <https://codex.danielvaughan.com/2026/06/03/codex-app-server-stdio-subprocess-embedding-custom-clients-json-rpc-protocol/>
5. **Codex SDK Python (nogataka fork)**: <https://github.com/nogataka/codex-sdk-py>
6. **OpenAI Codex SDK Reference**: <https://developers.openai.com/codex/sdk>
7. **Codex Python SDK v0.1.0b2 Walkthrough**: <https://news.creeta.com/en/openai-codex-python-sdk-v0-1-0b2-install-2026/>

### 15.2 Codex 演进与新特性

8. **Codex 2026 新特性全面解读**: <https://blog.csdn.net/weixin_43571227/article/details/162141386>
9. **Codex v0.142 Stable Release Guide**: <https://codex.danielvaughan.com/2026/06/26/codex-cli-v0142-stable-release-guide-plugin-discovery-token-budgets-delegation-enterprise-proxy/>
10. **Codex v0.142.0 Release Notes**: <https://www.havoptic.com/r/openai-codex-rust-v0.142.0>
11. **Codex Goal Mode Long-Horizon**: <https://codex.danielvaughan.com/2026/05/01/codex-cli-goal-workflows-persistent-long-horizon-task-execution/>
12. **Codex Goal Mode Hacker News Article**: <https://techfordev.netlify.app/articles/3762587>
13. **goal 命令技术解析**: <https://blog.csdn.net/weixin_44262492/article/details/162395449>

### 15.3 Codex Plugin Marketplace

14. **Codex Marketplace Plugin Distribution**: <https://codex.danielvaughan.com/2026/04/11/codex-marketplace-plugin-distribution/>
15. **Codex Plugins Now Bundle MCP Servers**: <https://chatforest.com/builders-log/openai-codex-plugins-mcp-server-bundles-enterprise-sharing-builder-guide/>
16. **Codex Plugins Marketplace Guide**: <https://zenvanriel.com/ai-engineer-blog/openai-codex-plugins-marketplace-guide>
17. **Codex Plugin Marketplace Security Checklist**: <https://techtaek.com/codex-plugins-and-remote-marketplaces-in-2026-what-to-check-before-installing-agent-tooling-from-github/>
18. **Codex/ChatGPT Plugin Marketplace Packaging**: <https://github.com/magnus919/agent-skills/issues/79>

### 15.4 Codex Multi-Agent

19. **Codex Subagent Multi-Agent 协作**: <https://blog.csdn.net/alex_yangchuansheng/article/details/159181329>
20. **Codex CLI Multi-Agent 2026 Guide**: <https://www.morphllm.com/codex-multi-agent>
21. **CAID: Optimal Parallelism Research**: <https://codex.danielvaughan.com/2026/06/19/caid-optimal-parallelism-async-software-engineering-agents-codex-cli-subagent-delegation/>
22. **Parallel-first subagents (issue 22099)**: <https://github.com/openai/codex/issues/22099>
23. **Magic Codex Worker Plugin**: <https://github.com/wenqingyu/magic-cc-codex-worker>

### 15.5 Codex Auto-Compaction

24. **Codex CLI Context Compaction Architecture**: <https://codex.danielvaughan.com/2026/03/31/codex-cli-context-compaction-architecture/>
25. **Mastering Context Compaction Tuning**: <https://codex.danielvaughan.com/2026/04/16/codex-cli-context-compaction-tuning-long-sessions/>
26. **Codex 与 Claude Code 上下文压缩对比**: <https://m.toutiao.com/group/7665633952808206875/>
27. **MiniCode 上下文压缩 7 阶段**: <https://blog.csdn.net/Kevincxt/article/details/163252406>
28. **Token Budget Compaction Reset PR 29521**: <https://github.com/openai/codex/pull/29521>

### 15.6 TRAE 文档与更新日志

29. **TRAE 更新日志（中文）**: <https://www.trae.cn/changelog>
30. **TRAE What's NEW (English)**: <https://www.trae.ai/changelog>
31. **TRAE Worktree 工作树文档**: <https://www.w3cschool.cn/traesolodocs/trae-solo-worktree.html>
32. **TRAE 安装 MCP + Skill 教程**: <https://blog.csdn.net/qq_37027335/article/details/161949102>
33. **TRAE IDE 介绍 (韩文)**: <https://traeide.com/ko/docs/what-is-trae-ide>
34. **TRAE AI Settings**: <https://traeide.com/ja/docs/trae-ide-ai-setting>
35. **TRAE Trae-Agent MCP Integration (DeepWiki)**: <https://deepwiki.com/bytedance/trae-agent/4.5-mcp-integration>
36. **OpenViking Cursor/TRAE Memory Integration**: <https://github.com/volcengine/OpenViking/pull/3109/files>

### 15.7 Worktree + Parallel AI Agents

37. **Git Worktree for Parallel AI Agents (韩文)**: <https://sonim1.com/ko/blog/git-worktree-for-parallel-ai-agents>
38. **Git Worktrees Changed How I Run Parallel AI Agents**: <https://www.scien.cx/2026/03/24/git-worktrees-changed-how-i-run-parallel-ai-agents/>
39. **Worktree-Per-Task Isolation (codeframe)**: <https://github.com/frankbria/codeframe/issues/418>
40. **Git Worktree Merge Conflicts in AI Agent Systems**: <https://docs.bswen.com/blog/2026-03-12-git-worktree-merge-conflicts-agents/>

### 15.8 LLM-as-Judge

41. **LLM as Judge 完全指南**: <https://blog.csdn.net/m0_51574586/article/details/161136460>
42. **LLM-as-Judge Prompt 模板 + Rubric**: <https://www.galtea.ai/blog/llm-as-a-judge-prompts-templates-rubrics-and-best-practices>
43. **Build Code Review with Codex SDK**: <https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk>
44. **Promptfoo Codex SDK 评测**: <https://codex.danielvaughan.com/2026/04/11/evaluating-codex-agents-promptfoo-trajectory-assertions/>
45. **LLM-as-a-judge Prompt 编写**: <https://blog.csdn.net/weixin_41455464/article/details/156490273>

---

## 十六、Cycle 13 差距与建议总结

### 16.1 必须解决的 5 大差距

| # | 差距 | 实施复杂度 | 用户价值 |
| --- | --- | --- | --- |
| 1 | **Worktree 隔离**（TRAE v3.5.79+） | 高 | 高（多任务并行 + 文件隔离 + AI 合并） |
| 2 | **Hermes Python/TypeScript SDK**（Codex v0.131+） | 中 | 高（外部生态集成） |
| 3 | **LLM-as-Judge 语义验证**（Codex 评测论文） | 中 | 高（P1-10 扩展为 5 维度） |
| 4 | **Auto-Compaction 引擎**（Codex v0.142 / MiniCode） | 高 | 高（长 session 稳定性） |
| 5 | **Plugin Marketplace 远端注册**（Codex v0.142） | 中 | 中（生态扩展） |

### 16.2 推荐的 Cycle 13 目标

**必选 P0（核心）**：
- P0-1 Worktree 隔离（任务并行 + AI 合并 + 磁盘管理）
- P0-2 Hermes Python SDK（外部集成入口）
- P0-3 LLM-as-Judge 验证层（语义验证）

**推荐 P1（增强）**：
- P1-1 Plugin Marketplace 远端注册
- P1-2 Auto-Compaction 引擎（双触发点 + Reactive 兜底）
- P1-4 Goal auto-turn + budget_limited 状态

**可选 P2（探索）**：
- TRAE Worktree 冲突解决 AI（LLM 调解）
- Hermes TS SDK + Browser/Node 适配
- 多 model 投票一致性机制

### 16.3 范围之外（待未来周期）

- Design Mode / Voice Chat（依赖硬件与多模态）
- 移动端 App（独立产品方向）
- Plugin 公开目录提交（需 OpenAI Portal 流程）

### 16.4 累计测试目标

| 类别 | 数量 | 通过率 |
| --- | --- | --- |
| 单元测试 | 220+ | 100% |
| E2E 断言 | 90+ | 100% |
| 集成测试 | 50+ | 100% |
| **合计** | **360+** | **100%** |

### 16.5 风险评估

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| Worktree 磁盘占用爆炸 | 中 | 阈值告警 + 自动清理 + 池化 |
| LLM-as-Judge 模型偏差 | 中 | 多 model 投票 + confidence 阈值 + 人工 review 标记 |
| SDK API 稳定性 | 低 | 独立版本路径 + 锁定依赖 |
| Auto-Compaction 误触发 | 中 | CompactBoundary 标记 + resume hydrate 测试 |
| Plugin 供应链安全 | 中 | 签名 + 清单来源验证 + 沙箱执行 |

---

**报告完结。本报告为 Cycle 13 实施提供完整技术基础，覆盖 16 大主题、45+ 引用源、5 大必选差距、3 个 P0 + 3 个 P1 建议任务。**
