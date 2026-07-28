# Cycle 12 研究报告 - Hermes Plugin 系统 + /goal 长时域模式 + Three-File Trust

> **周期**: Cycle 12
> **研究时间**: 2026-07-28 14:30
> **对比基准**: Hermes v6.17.1 vs Codex CLI v0.150.0+ / TRAE v3.5.79
> **目的**: 调研 Plugin 系统、/goal 长时域模式、Three-File Trust 架构、SDK 设计

---

## 一、研究背景

经过 Cycle 1-11 的 11 轮迭代，Hermes 已经实现了：
- **Loop Engineering v7** 完整工作流（triage→plan→execute→verify）
- **Verification Loop（P1-10）** 4 维度验证 + 自动修复
- **Memory System（P1-8）** Dual-Track Persistent Memory
- **DiffView（P1-7）** 多格式 diff + 快照 + ref 对比
- **.trae/skills/, .trae/agents/, .trae/rules/, .trae/hooks/** 等扩展能力
- **/import（P3-1）** 跨平台配置迁移（4 数据源）
- **doctor（P2-2）** 环境诊断系统（6 大类 + 修复建议）
- **Playwright E2E（P2-1）** 前端 E2E 自动化（8 核心场景 + 视觉回归）

但与最新 Codex CLI v0.150+ 和 TRAE v3.5.79 相比，仍存在以下核心差距：

| 差距编号 | 功能 | 来源 | 状态 |
| --- | --- | --- | --- |
| P0-1 | **Plugin 系统** | Codex v0.117.0+ | ❌ 缺失 |
| P0-2 | **/goal 长时域模式** | Codex v0.128.0+ | ❌ 缺失（仅 /loop 不持久） |
| P0-3 | **Three-File Trust 架构** | Codex 0.128+ | ❌ 缺失 |
| P1-1 | **Hermes Python/TypeScript SDK** | Codex 2026.06 | ❌ 缺失 |
| P1-2 | **Plugin Marketplace** | Codex v0.117+ | ❌ 缺失 |
| P1-3 | **多层次验证架构** | Codex 论文 2026.06 | 部分（仅 4 维度） |

本轮研究目的：深入理解这些能力的实现机制，为 Cycle 12 实现提供技术基础。

---

## 二、Codex Plugin 系统深度分析

### 2.1 演进时间线

| 版本 | 时间 | 关键变化 |
| --- | --- | --- |
| Codex v0.117.0 | 2026-03-26 | Plugin 系统升为 first-class primitive |
| Codex v0.130.0 | 2026-05 | Plugin 官方目录上线 |
| Codex v0.145.0 | 2026-07-21 | Plugin workflows + `codex plugin list --json` |
| Codex v0.150.0 | 2026-07-28 | 多 Agent 自动发现 Plugin 能力 |

### 2.2 五层自定义堆栈

Codex CLI 官方推荐的自定义堆栈是五层架构：

```
┌─────────────────────────────────────────────────────────┐
│ AGENTS.md       │ Constitution & Rules  │ 每个项目必备  │
├─────────────────────────────────────────────────────────┤
│ Skills          │ Repeatable Workflows  │ 提示模式重复3+次│
├─────────────────────────────────────────────────────────┤
│ MCP Servers     │ External Tools & Data │ 上下文在仓库外 │
├─────────────────────────────────────────────────────────┤
│ Subagents       │ Specialised Workers   │ 任务需并行/隔离│
├─────────────────────────────────────────────────────────┤
│ Plugins         │ Distributable Bundles │ 跨团队工作流  │
└─────────────────────────────────────────────────────────┘
```

**Plugins 的核心定位**：将前四层打包为可分发的 bundle。

### 2.3 Plugin 解剖（Anatomy）

```
my-plugin/
├── manifest.json           # 插件元数据 + 依赖
├── SKILL.md                # 主要技能描述
├── skills/                 # 多个子技能
│   ├── analyze/SKILL.md
│   └── report/SKILL.md
├── agents/                 # 专用子智能体
│   └── reviewer.md
├── mcp/                    # MCP 服务器配置
│   └── config.toml
├── hooks/                  # 钩子定义
│   └── hooks.json
├── templates/              # 模板文件
└── README.md
```

### 2.4 manifest.json 规范

```json
{
  "id": "hermes-plugin-sentry-triage",
  "name": "Sentry Triage",
  "version": "1.0.0",
  "description": "Auto-triage Sentry issues and create PR fixes",
  "author": "Hermes Team",
  "license": "MIT",
  "skills": ["skills/analyze", "skills/report"],
  "agents": ["agents/reviewer.md"],
  "mcp_servers": ["mcp/config.toml"],
  "hooks": ["hooks/hooks.json"],
  "dependencies": {
    "hermes": ">=6.17.0",
    "plugins": []
  },
  "categories": ["monitoring", "ci-cd"],
  "tags": ["sentry", "triage", "pr-automation"]
}
```

### 2.5 Plugin 生命周期

```
install → load → register → invoke → unload → uninstall
   ↓        ↓        ↓         ↓        ↓         ↓
 validate  parse   register  trigger  cleanup  remove
 manifest  files  skills/   events   state    files
           hooks  agents    hooks             from
                   MCP      MCP              registry
```

### 2.6 Plugin 分发

| 场景 | 推荐方式 |
| --- | --- |
| 单项目 / 个人 | 本地 `SKILL.md` + config |
| 团队规范 | Repo marketplace |
| 跨项目复用 | 个人 marketplace |
| 跨团队 / OSS | 官方目录 |

---

## 三、Codex /goal 长时域模式深度分析

### 3.1 演进时间线

| 版本 | 时间 | 关键变化 |
| --- | --- | --- |
| v0.122.0 | 2026-04-16 | /goal PR 系列（5 层）开始 review |
| v0.128.0 | 2026-04-30 | /goal 命令首次发布 |
| v0.133.0 | 2026-05-21 | /goal 升级为 GA |
| v0.142.0 | 2026-07-12 | Token budget 引入 |

### 3.2 /goal 工作流架构

```
/goal "Migrate auth module to OAuth2"
    ↓
解析目标 → 提取完成标准
    ↓
规划下一步动作
    ↓
执行动作
    ↓
运行验证检查
    ↓
   ┌──┴──┐
   ↓     ↓     ↓
标准未达  Token  阻塞
调整计划  用尽  暂停
   ↓
回到规划
```

### 3.3 生命周期命令

| 命令 | 效果 |
| --- | --- |
| `/goal <objective>` | 创建或替换活跃目标 |
| `/goal pause` | 暂停当前目标循环 |
| `/goal resume` | 继续暂停的目标 |
| `/goal clear` | 放弃活跃目标 |
| `/goal status` | 查看目标状态 |

### 3.4 五层实现架构

```
1. Persisted Goal State   (#18073 — goals.rs)
2. App-Server API         (#18074 — RPC handlers)
3. Model Tools            (#18075 — get_goal / set_goal)
4. Core Runtime           (#18076 — token accounting)
5. TUI Integration        (#18077 — 显示 + 控制)
```

### 3.5 状态持久化

**Checkpoint 机制**：
- 每完成子任务自动保存上下文到本地磁盘
- 即使 CLI 进程重启，可从最后 Checkpoint 恢复
- 资源调度：动态分配 Token 预算
- 沙箱隔离：每个子任务独立沙箱执行

### 3.6 Token 预算作为成本治理

| 维度 | 配置 | 说明 |
| --- | --- | --- |
| 软停止阈值 | total_budget_pct | 70% 用尽时软停止 |
| 硬停止阈值 | hard_limit | 90% 用尽时硬停止 |
| 检查周期 | check_interval | 每 5 分钟检查 |

### 3.7 自动验证闭环

```
编写代码 → 静态分析（lint）→ 单元测试 → 集成测试 →
  ↓ 失败则自动修复（最多 3 次重试）
  ↓ 成功则进入下一子任务
```

社区实测数据：
- **自动修复成功率**：73%（首次）
- **18 特性完成 14 特性**：78% 完成率
- **平均 Token 消耗**：中等特性 ~50K tokens

---

## 四、Three-File Trust 架构深度分析

### 4.1 核心理念

**任何要求都可以从 GOAL 通过 VERIFY 中对应检查追溯到 PROGRESS 中记录的结果。**

```
GOAL.md    →  VERIFY.md  →  PROGRESS.md
目标定义      验证清单       进度记录
  ↓             ↓             ↓
  验证项         自动验证       历史
  完成标准       独立检查器     决策
```

### 4.2 三个文件详解

#### GOAL.md
```markdown
# Goal: 实现用户认证模块

## Objective
实现完整用户认证：JWT签发、刷新令牌、密码重置

## Acceptance Criteria
- [ ] AC1: 用户可通过邮箱+密码注册
- [ ] AC2: 登录成功返回 JWT（24h 过期）
- [ ] AC3: 刷新令牌机制（7d 过期）
- [ ] AC4: 密码重置邮件流程
- [ ] AC5: 单元测试覆盖率 > 80%

## Constraints
- 使用 bcrypt 哈希
- 刷新令牌存储在 HTTP-only cookie
- 遵循 OWASP 认证最佳实践

## Token Budget
- 软停止：40,000 tokens
- 硬停止：60,000 tokens
```

#### VERIFY.md
```markdown
# Verification Checklist

## AC1: 用户注册
- test: integration/auth/test_register.py::test_valid_email
- command: pytest tests/auth/test_register.py -v
- expected: exit code 0, 3/3 tests pass

## AC2: JWT 签发
- test: unit/auth/test_jwt.py::test_sign
- command: pytest tests/auth/test_jwt.py -v
- expected: exit code 0, 5/5 tests pass

## AC3: 刷新令牌
- test: integration/auth/test_refresh.py
- expected: exit code 0, 4/4 tests pass

## AC4: 密码重置
- test: e2e/auth/test_reset.py
- command: pytest tests/e2e/auth/test_reset.py -v
- expected: exit code 0, 2/2 tests pass

## AC5: 测试覆盖率
- command: pytest --cov=auth --cov-report=term-missing
- expected: coverage >= 80%
```

#### PROGRESS.md
```markdown
# Progress Log

## 2026-07-28 14:30:00
- Status: started
- Action: analyze codebase
- Result: identified 3 files to modify

## 2026-07-28 14:45:00
- Status: AC1 in_progress
- Action: implement user registration
- Result: 3/3 tests pass
- Tokens used: 5,234

## 2026-07-28 15:00:00
- Status: AC1 completed
- Action: run AC1 verification
- Result: ✅ AC1 verified
- Tokens used: 8,120
```

### 4.3 独立验证器模式

```
Goal 主 Agent
    ↓
执行子任务
    ↓
触发 Verifier Agent (独立上下文)
    ↓
Verifier 重新执行 VERIFY.md 中检查
    ↓
   ┌──┴──┐
   ↓     ↓
  通过   失败
   ↓     ↓
 继续  打回主 Agent 修复
```

**核心原则**：Verifier 在独立上下文中运行，不受主 Agent 影响。

---

## 五、Codex SDK 设计分析

### 5.1 双语言 SDK

| 语言 | 包 | 发布时间 |
| --- | --- | --- |
| Python | `codex-sdk` | 2026.06 |
| TypeScript | `@codex/sdk` | 2026.06 |

### 5.2 Python SDK 核心 API

```python
from codex_sdk import CodexClient

# 初始化
client = CodexClient(api_key="sk-...")

# 单次对话
thread = client.start_thread()
run = thread.run("Explain this function")
print(run.text)

# 流式响应
stream = thread.run_stream("Generate tests")
for chunk in stream:
    print(chunk.text, end="")

# 多 Agent 编排
async def parallel_review(code):
    agents = [
        client.start_thread(model="gpt-5.3-codex"),
        client.start_thread(model="o3"),
    ]
    results = await asyncio.gather(*[
        a.run(f"Review this code:\n{code}") for a in agents
    ])
    return results
```

### 5.3 SDK 设计原则

| 原则 | 说明 |
| --- | --- |
| Stateless Threads | Thread 不保留历史，新调用基于快照 |
| Async First | 原生 async API，适合高并发 |
| Multi-Model | 支持多模型并行执行 |
| Token 透明 | 每次调用返回 token 消耗 |

---

## 六、Codex 多层验证架构

### 6.1 Qwen 论文核心观点

> **验证的可扩展性、忠实性、鲁棒性无法同时满足**

### 6.2 四种验证方法权衡

| 方法 | Scalability | Faithfulness | Robustness |
| --- | --- | --- | --- |
| 单元测试 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| 集成测试 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| LLM-as-Judge | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ |
| Hooks + PostToolUse | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

### 6.3 五层验证架构

```
Layer 1: 单元测试        → 验证函数行为
Layer 2: 集成测试        → 验证模块交互
Layer 3: E2E 测试         → 验证用户流程
Layer 4: LLM-as-Judge    → 验证语义正确
Layer 5: Hooks PostToolUse → 实时验证副作用
```

每层独立运行，独立失败可重试。**没有任何单一信号能保证正确性**。

### 6.4 与 Hermes 现状对比

Hermes P1-10 Verification Loop 已实现：
- 4 维度验证：Syntax / Module / Integration / Performance
- 自动修复编排（3 次重试）
- 性能基线管理
- Webhook 触发

**缺失**：
- ❌ LLM-as-Judge 层（语义验证）
- ❌ Hooks PostToolUse 实时验证（已有 Hooks 但未用于验证）
- ❌ 独立 Verifier 上下文隔离

---

## 七、TRAE v3.5.79 新特性分析

### 7.1 2026-07-23 发布（v3.5.79-3.5.80）

| 特性 | 状态 | 备注 |
| --- | --- | --- |
| Windows 智能体 Browser Use | 个人版 | 调用外部浏览器 |
| Spec 模式（SOLO Coder） | 个人版 | 结构化规范模式 |
| Hooks 引擎 | ✅ | Hermes P0-18 已实现 |
| Subagents 目录加载 | ✅ | Hermes P0-17 已实现 |
| /commands/ 目录嵌套（3层） | ✅ | Hermes P0-13 已实现 |
| Browser Use 部分卡片截图 | 个人版 | 视觉增强 |

### 7.2 TRAE Work 平台

| 组件 | 功能 | 备注 |
| --- | --- | --- |
| **Design Mode** | 设计师工作流 | 自然语言批量编辑 |
| **Voice Chat** | 语音对话 + 上下文 | Web 搜索 + 记忆引用 |
| **Global Memory** | 全局记忆 | 跨会话知识库 |
| **Worktree 特性** | 隔离 Git 环境 | 多任务并行 |
| **Voice Discussion** | 交互式语音 | 协作场景 |

### 7.3 TRAE 缺失但 Hermes 已实现

- ✅ Loop Engineering（HERMES 独有，P1-4）
- ✅ Verification Loop（HERMES 独有，P1-10）
- ✅ Multi-Agent v2 Path Tree（HERMES 独有，P0-10）
- ✅ Memory Dual-Track（HERMES 独有，P1-8）
- ✅ DiffView 多格式（HERMES 独有，P1-7）

### 7.4 TRAE 独有而 Hermes 缺失

- ❌ Worktree 隔离环境（多任务并行 + 文件隔离）
- ❌ Design Mode（设计工作流）
- ❌ Spec 模式（结构化规范对话）
- ❌ Voice Chat 优化
- ❌ 移动 App（v0.0.x）

---

## 八、总结与建议

### 8.1 Cycle 12 优先级

| 优先级 | 任务 | 复杂度 | 价值 |
| --- | --- | --- | --- |
| P0-1 | **Plugin 系统** | 高 | 高（可分发 bundle） |
| P0-2 | **/goal 长时域模式** | 中 | 高（持久目标） |
| P0-3 | **Three-File Trust 架构** | 中 | 高（可追溯性） |
| P1-1 | **Hermes Python SDK** | 中 | 中（外部集成） |
| P1-2 | **Plugin Marketplace** | 高 | 中（生态建设） |
| P1-3 | **多层次验证架构** | 中 | 中（增强验证） |
| P1-4 | **Worktree 隔离环境** | 高 | 中（多任务并行） |

### 8.2 Cycle 12 目标

**核心实现（必须完成）**：
- P0-1 Plugin 系统（dist/.trae/plugins/ + manifest.json + 加载器）
- P0-2 /goal 长时域模式（持久目标 + Checkpoint + Token 预算）
- P0-3 Three-File Trust 架构（GOAL/VERIFY/PROGRESS）

**增强实现（视情况）**：
- P1-1 Hermes Python SDK（基础 API + 异步支持）
- P1-3 多层验证架构 LLM-as-Judge 层

### 8.3 不在本轮范围

- Plugin Marketplace（依赖 P0-1，先实现基础）
- Worktree 隔离（TRAE Work 特性，复杂）
- Design Mode（设计工作流，独立产品方向）

---

## 九、参考资料

1. **Codex Plugin System**: [codex.danielvaughan.com/2026/03/30/codex-cli-plugin-system/](https://codex.danielvaughan.com/2026/03/30/codex-cli-cli-plugin-system/)
2. **Codex Customisation Stack**: [codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system/](https://codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system/)
3. **Codex /goal Long-Horizon**: [codex.danielvaughan.com/2026/05/01/codex-cli-goal-workflows-persistent-long-horizon-task-execution/](https://codex.danielvaughan.com/2026/05/01/codex-cli-goal-workflows-persistent-long-horizon-task-execution/)
4. **Three-File Trust Architecture**: [codex.danielvaughan.com/2026/07/06/codex-cli-goal-mode-long-running-autonomous-agents-verification-trust-architecture/](https://codex.danielvaughan.com/2026/07/06/codex-cli-goal-mode-long-running-autonomous-agents-verification-trust-architecture/)
5. **Verification Horizon Paper**: [codex.danielvaughan.com/2026/06/27/verification-horizon-no-silver-bullet-coding-agent-rewards-codex-cli-multi-layer-verification-strategy/](https://codex.danielvaughan.com/2026/06/27/verification-horizon-no-silver-bullet-coding-agent-rewards-codex-cli-multi-layer-verification-strategy/)
6. **Autonomous Execution Convergence**: [codex.danielvaughan.com/2026/06/26/autonomous-execution-convergence-codex-goal-mode-claude-code-grok-build-goal-architectural-comparison/](https://codex.danielvaughan.com/2026/06/26/autonomous-execution-convergence-codex-goal-mode-claude-code-grok-build-goal-architectural-comparison/)
7. **TRAE 更新日志**: [docs.trae.cn/ide_changelog](https://docs.trae.cn/ide_changelog)
8. **TRAE 英文文档**: [docs.trae.ai/ide/solo-mode](https://docs.trae.ai/ide/solo-mode)
9. **Codex 2026 新特性**: [blog.csdn.net/weixin_43571227/article/details/162141386](https://blog.csdn.net/weixin_43571227/article/details/162141386)
10. **Codex Plugins Guide**: [ses-base.com/articles/openai-codex-cli-plugin-workflow-guide/](https://ses-base.com/articles/openai-codex-cli-plugin-workflow-guide/)
