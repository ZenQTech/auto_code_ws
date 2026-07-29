# Cycle 13 差距分析报告 - Worktree 隔离 + Hermes SDK + LLM-as-Judge + Plugin Marketplace

> **周期**: Cycle 13
> **分析时间**: 2026-07-28 15:50
> **当前版本**: Hermes v6.19.0
> **目标基准**: Codex CLI v0.142.0+ / v0.150.0+ / TRAE v3.5.79+ / v3.5.80+
> **关联报告**: [CYCLE13_RESEARCH_REPORT.md](CYCLE13_RESEARCH_REPORT.md)

---

## 一、总体差距概览

经过 Cycle 1-12 的 12 轮迭代，Hermes 已实现 v6.19.0，具备：
- Loop Engineering v7 + 6 状态 Goal 状态机
- Verification Loop（P1-10）4 维度验证
- Memory System（P1-8）Dual-Track Persistent Memory
- Plugin 系统（Cycle 12 P0-1）8 模块 + 12 端点
- Three-File Trust 架构（Cycle 12 P0-2）GOAL/VERIFY/PROGRESS

但与最新 Codex CLI v0.142+ / TRAE v3.5.79+ 相比，仍存在以下关键差距：

| 差距编号 | 名称 | 优先级 | 复杂度 | 价值 | 状态 |
| --- | --- | --- | --- | --- | --- |
| **P0-1** | **Worktree 隔离执行** | P0 | 中 | 高 | ❌ 缺失 |
| **P0-2** | **Hermes Python/TypeScript SDK** | P0 | 中 | 高 | ❌ 缺失 |
| **P0-3** | **LLM-as-Judge 验证层** | P0 | 中 | 高 | ❌ 缺失 |
| P1-1 | Codex Plugin Marketplace 远端注册 | P1 | 高 | 中 | 部分 |
| P1-2 | Auto-Compaction 引擎 | P1 | 高 | 中 | ❌ 缺失 |
| P1-3 | TRAE Work 多模态协作 | P1 | 高 | 中 | ❌ 缺失 |
| P1-4 | Goal auto-turn + 多 Agent 委派策略 | P1 | 中 | 中 | ❌ 缺失 |

---

## 二、P0-1 Worktree 隔离执行 差距分析

### 2.1 现状

Hermes 当前已实现基础 Worktree API（`backend/app/api/worktree.py`）：

```python
# 已有能力
- POST /worktree/create   # 创建 Worktree
- POST /worktree/merge    # 合并
- POST /worktree/cleanup  # 清理
- GET  /worktree/list     # 列表
```

**问题**：
- ❌ 缺乏完整的任务隔离工作流（CLI 实例 → Worktree → 自动 commit → 合并）
- ❌ 没有 AI 自动合并冲突解决
- ❌ 缺乏磁盘空间管理（无清理策略、过期检测）
- ❌ 没有 .trae/worktree 目录标准规范
- ❌ 与 Loop Engineering 工作流未深度集成
- ❌ 缺乏 Worktree 状态机（pending/active/merged/conflict/expired）

### 2.2 目标架构

#### 2.2.1 完整 Worktree 生命周期

```
工作流引擎（loop_engine）
    ↓ create_worktree_for_task(task_id, module_name)
WorktreeManager
    ↓ git worktree add -b feat/<module>-<instance> ../<project>-<module>
Worktree 目录
    ↓ Claude Code CLI 实例在独立目录执行
工作流引擎
    ↓ 完成 → auto_commit + push_to_remote
WorktreeManager
    ↓ git worktree merge / merge --no-ff
主分支
    ↓ git worktree remove + 清理
Worktree 删除
```

#### 2.2.2 .trae/worktree/ 目录规范

```
.trae/worktree/
├── state.json              # 全局 Worktree 状态
├── index.jsonl             # 事件流（创建/合并/清理）
├── tasks/                  # 每个任务的 Worktree 元数据
│   ├── task-001/
│   │   ├── meta.json       # task_id/module/instance_id/branch/path
│   │   ├── history.log     # 执行历史
│   │   └── diff.patch      # 最终 diff
│   └── task-002/
└── archive/                # 合并后的归档
    └── 2026-07/
        └── task-001.tar.gz
```

#### 2.2.3 Worktree 状态机

```
CREATE_PENDING
    ↓ git worktree add 成功
ACTIVE
    ├─→ 任务完成 → AUTO_MERGE_PENDING
    │       ├─→ 无冲突 → MERGED
    │       └─→ 有冲突 → CONFLICT → AI_RESOLVE → MERGED/FAILED
    └─→ 任务失败 → FAILED
    ↓ 超时（24h） → EXPIRED
    ↓ 手动清理 → CLEANED
```

### 2.3 实现模块

| 模块 | 路径 | 行数预估 | 职责 |
| --- | --- | --- | --- |
| `worktree_models.py` | `backend/app/core/worktree/models.py` | 200 | 数据模型（WorktreeState/Event/Conflict） |
| `worktree_manager.py` | `backend/app/core/worktree/manager.py` | 400 | 核心服务（CRUD + Git 命令封装） |
| `worktree_lifecycle.py` | `backend/app/core/worktree/lifecycle.py` | 300 | 状态机 + 过期检测 |
| `worktree_merger.py` | `backend/app/core/worktree/merger.py` | 350 | 自动合并 + 冲突解决（启发式 + AI 辅助） |
| `worktree_storage.py` | `backend/app/core/worktree/storage.py` | 200 | 持久化（JSON + JSONL） |
| `worktree_api.py` | `backend/app/api/worktree_v2.py` | 250 | 扩展 REST API（10+ 端点） |
| `__init__.py` | `backend/app/core/worktree/__init__.py` | 50 | 模块入口 |

### 2.4 API 端点设计

| 端点 | 方法 | 描述 |
| --- | --- | --- |
| `/api/worktree/v2/health` | GET | 健康检查 |
| `/api/worktree/v2/list` | GET | 列出所有 Worktree（state 过滤） |
| `/api/worktree/v2/create` | POST | 为任务创建 Worktree |
| `/api/worktree/v2/{id}` | GET | Worktree 详情 |
| `/api/worktree/v2/{id}/state` | GET | 状态查询 |
| `/api/worktree/v2/{id}/state` | PUT | 状态转换 |
| `/api/worktree/v2/{id}/commit` | POST | 提交 Worktree 内的更改 |
| `/api/worktree/v2/{id}/merge` | POST | 合并到主分支 |
| `/api/worktree/v2/{id}/resolve` | POST | 冲突解决（提供 patch） |
| `/api/worktree/v2/{id}/cleanup` | POST | 清理 Worktree |
| `/api/worktree/v2/stats` | GET | 统计信息 |
| `/api/worktree/v2/expired` | GET | 列出过期 Worktree |

### 2.5 验收标准

- [ ] 完整 Worktree 生命周期（CREATE→ACTIVE→MERGE→CLEANUP）
- [ ] 状态机 7 状态 + 转换规则
- [ ] .trae/worktree/ 标准目录
- [ ] 自动 commit + AI 辅助 merge
- [ ] 冲突检测 + 解决接口
- [ ] 过期检测（24h TTL）
- [ ] 12+ REST 端点
- [ ] 60+ 单元测试
- [ ] 25+ E2E 断言
- [ ] 与 loop_engine 集成
- [ ] 前端 Worktree 面板

---

## 三、P0-2 Hermes Python/TypeScript SDK 差距分析

### 3.1 现状

Hermes 当前提供 CLI 集成（`cli_integration/`）和 REST API 端点。

**问题**：
- ❌ 无 Python SDK（外部脚本无法直接调用）
- ❌ 无 TypeScript SDK（前端无法类型化调用）
- ❌ 无统一的 Thread/Run/Event 抽象
- ❌ 无流式输出 SDK 支持
- ❌ 无 Sandbox 安全控制
- ❌ 无结构化输出（outputSchema）

### 3.2 目标架构

#### 3.2.1 双语言 SDK 镜像

| 语言 | 包名 | 安装 |
| --- | --- | --- |
| Python | `hermes-sdk` | `pip install hermes-sdk` |
| TypeScript | `@hermes/sdk` | `npm install @hermes/sdk` |

#### 3.2.2 核心 API（镜像 Codex SDK）

**Python SDK**：

```python
from hermes_sdk import Hermes, Sandbox, ThreadConfig

# 1. 初始化
with Hermes(api_key="hermes-xxx", base_url="http://localhost:8000") as hermes:
    # 2. 启动 Thread（带 sandbox）
    thread = hermes.thread_start(
        config=ThreadConfig(
            sandbox=Sandbox.WORKSPACE_WRITE,
            model="claude-sonnet-4.5",
            project_id="my-project",
        )
    )

    # 3. 同步 Run
    result = thread.run("Explain this codebase")
    print(result.final_response)
    print(result.usage)

    # 4. 流式 Run
    stream = thread.run_stream("Generate tests")
    for event in stream:
        if event.type == "text_delta":
            print(event.text, end="", flush=True)
        elif event.type == "tool_call":
            print(f"\n[Tool: {event.tool.name}]")

    # 5. 跨进程恢复
    thread = hermes.resume_thread(thread.id)
```

**TypeScript SDK**：

```typescript
import { Hermes, Sandbox } from '@hermes/sdk';

const hermes = new Hermes({ apiKey: 'hermes-xxx' });

// 启动 Thread
const thread = await hermes.threadStart({
  sandbox: Sandbox.WORKSPACE_WRITE,
  model: 'claude-sonnet-4.5',
});

// 流式 Run
const stream = await thread.runStream('Explain this codebase');
for await (const event of stream) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text);
  } else if (event.type === 'tool_call') {
    console.log(`\n[Tool: ${event.tool.name}]`);
  }
}

// 结构化输出
const result = await thread.run('List top 3 features', {
  outputSchema: {
    type: 'object',
    properties: {
      features: { type: 'array', items: { type: 'string' } },
    },
  },
});
console.log(result.structured);
```

#### 3.2.3 SDK 架构

```
hermes_sdk/
├── __init__.py
├── client.py              # Hermes 主客户端
├── thread.py              # Thread 抽象
├── run.py                 # Run/Result
├── stream.py              # Event 流
├── sandbox.py             # Sandbox 枚举
├── config.py              # 配置
├── exceptions.py          # 异常
└── _internal/
    ├── http.py            # HTTP 客户端（httpx）
    ├── sse.py             # SSE 解析
    └── auth.py            # API Key 管理
```

### 3.3 实现模块

| 模块 | 路径 | 行数预估 | 职责 |
| --- | --- | --- | --- |
| Python SDK | `sdks/python/hermes_sdk/` | 1500 | 完整 Python SDK |
| TypeScript SDK | `sdks/typescript/src/` | 1500 | 完整 TypeScript SDK |
| SDK Examples | `sdks/examples/` | 300 | 5+ 端到端示例 |
| SDK Tests | `sdks/python/tests/` | 500 | 单元测试 |
| SDK E2E | `sdks/tests/e2e/` | 300 | E2E 验证 |

### 3.4 API 端点支撑

SDK 需要后端暴露：
- `POST /api/sdk/thread/start` - 启动 Thread
- `POST /api/sdk/thread/{id}/run` - 同步 Run
- `POST /api/sdk/thread/{id}/run/stream` - 流式 Run
- `GET /api/sdk/thread/{id}/resume` - 恢复 Thread
- `GET /api/sdk/thread/{id}/events` - 事件流
- `POST /api/sdk/thread/{id}/structured` - 结构化输出

### 3.5 验收标准

- [ ] Python SDK 完整 API（client/thread/run/stream）
- [ ] TypeScript SDK 完整 API
- [ ] Sandbox 3 预设（READ_ONLY/WORKSPACE_WRITE/FULL_ACCESS）
- [ ] 流式输出（SSE 协议）
- [ ] 结构化输出（outputSchema）
- [ ] 跨进程恢复（thread_id 持久化）
- [ ] 5+ 端到端示例
- [ ] 40+ Python 单元测试
- [ ] 30+ TypeScript 单元测试
- [ ] 20+ E2E 断言
- [ ] PyPI 发布配置（setup.py/pyproject.toml）
- [ ] npm 发布配置（package.json/tsconfig.json）

---

## 四、P0-3 LLM-as-Judge 验证层 差距分析

### 4.1 现状

Hermes P1-10 Verification Loop 已实现 4 维度验证：
- Syntax（语法检查）
- Module（单元测试）
- Integration（集成测试）
- Performance（性能基线对比）

**问题**：
- ❌ 无 LLM-as-Judge（语义正确性验证）
- ❌ 无 Promptfoo / 评分 rubric
- ❌ 无多评分维度（correctness/style/safety）
- ❌ 无 Judge 模型池

### 4.2 目标架构

#### 4.2.1 5 维度验证架构

```
Layer 1: SyntaxVerifier        → 验证代码语法
Layer 2: ModuleVerifier        → 验证函数行为
Layer 3: IntegrationVerifier   → 验证模块交互
Layer 4: PerformanceVerifier   → 验证性能基线
Layer 5: LLMJudgeVerifier      → 验证语义正确性（新增）
```

#### 4.2.2 LLM-as-Judge Prompt 模板

```python
JUDGE_PROMPT_TEMPLATE = """
You are an expert code reviewer evaluating the following code change.

## Task
{task_description}

## Code Diff
```
{code_diff}
```

## Test Results
{test_results}

## Evaluation Criteria
1. Correctness (0-10): Does the code correctly implement the task?
2. Style (0-10): Does the code follow project style guidelines?
3. Safety (0-10): Are there any safety issues (injection, overflow, etc.)?
4. Performance (0-10): Is the code performant (no obvious O(n^3) etc.)?
5. Maintainability (0-10): Is the code readable and maintainable?

## Output Format
Return a JSON object:
```json
{{
  "scores": {{
    "correctness": <int>,
    "style": <int>,
    "safety": <int>,
    "performance": <int>,
    "maintainability": <int>
  }},
  "overall_pass": <bool>,
  "issues": ["<issue1>", "<issue2>"],
  "suggestions": ["<suggestion1>", "<suggestion2>"]
}}
```

## Important
- Be strict but fair
- Consider edge cases
- Check for security vulnerabilities
- Verify the code matches the task description
"""
```

#### 4.2.3 Judge 模型池

| 模型 | 用途 | 权重 |
| --- | --- | --- |
| Claude Sonnet 4.5 | 主要 Judge（综合） | 1.0 |
| GPT-5 Codex | 代码特定（Correctness） | 0.8 |
| Gemini 2.5 Pro | 多视角（Style） | 0.6 |

**多 Judge 共识机制**：
- 2+ Judge 一致 → 采纳
- 分数差异 > 3 → 触发重审
- Safety 评分 < 6 → 一票否决

### 4.3 实现模块

| 模块 | 路径 | 行数预估 | 职责 |
| --- | --- | --- | --- |
| `llm_judge_models.py` | `backend/app/core/llm_judge/models.py` | 200 | Judge 评分模型 |
| `llm_judge_prompts.py` | `backend/app/core/llm_judge/prompts.py` | 300 | Prompt 模板（5 维度） |
| `llm_judge_pool.py` | `backend/app/core/llm_judge/pool.py` | 350 | Judge 模型池（多模型） |
| `llm_judge_consensus.py` | `backend/app/core/llm_judge/consensus.py` | 300 | 多 Judge 共识 |
| `llm_judge_verifier.py` | `backend/app/core/llm_judge/verifier.py` | 350 | 验证执行器 |
| `llm_judge_api.py` | `backend/app/api/llm_judge.py` | 250 | REST API |
| `__init__.py` | `backend/app/core/llm_judge/__init__.py` | 50 | 模块入口 |

### 4.4 API 端点设计

| 端点 | 方法 | 描述 |
| --- | --- | --- |
| `/api/llm-judge/health` | GET | 健康检查 |
| `/api/llm-judge/judge` | POST | 提交评分任务 |
| `/api/llm-judge/judge/{id}` | GET | 获取评分结果 |
| `/api/llm-judge/judge/{id}/report` | GET | 评分报告 |
| `/api/llm-judge/pool` | GET | Judge 模型池 |
| `/api/llm-judge/pool` | POST | 添加 Judge 模型 |
| `/api/llm-judge/stats` | GET | 统计信息 |

### 4.5 验收标准

- [ ] 5 维度评分（correctness/style/safety/performance/maintainability）
- [ ] Judge Prompt 模板（Handlebars 风格）
- [ ] Judge 模型池（3+ 模型）
- [ ] 多 Judge 共识机制
- [ ] Safety 一票否决
- [ ] 与 P1-10 Verification Loop 集成
- [ ] 7+ REST 端点
- [ ] 50+ 单元测试（含 mock LLM）
- [ ] 20+ E2E 断言
- [ ] 前端 Judge 报告组件

---

## 五、P1-1 Codex Plugin Marketplace 远端注册 差距分析

### 5.1 现状

Cycle 12 P0-1 Plugin 系统已实现本地 Plugin 注册（dist/.trae/plugins/）。

**问题**：
- ❌ 无远端 Plugin 仓库
- ❌ 无 Plugin Marketplace UI
- ❌ 无 Plugin 评分/评论
- ❌ 无 Plugin 版本管理（远程升级）
- ❌ 无 Plugin 签名验证（远端）

### 5.2 目标设计

#### 5.2.1 三层 Plugin 目录

```
官方市场（官方维护）
    ↓
社区市场（GitHub 仓库）
    ↓
本地目录（dist/.trae/plugins/）
```

#### 5.2.2 Marketplace API

| 端点 | 方法 | 描述 |
| --- | --- | --- |
| `/api/marketplace/list` | GET | 列出所有 Plugin |
| `/api/marketplace/search` | GET | 搜索 |
| `/api/marketplace/{id}` | GET | 详情 |
| `/api/marketplace/{id}/install` | POST | 一键安装 |
| `/api/marketplace/{id}/versions` | GET | 版本列表 |
| `/api/marketplace/{id}/rate` | POST | 评分 |

### 5.3 验收标准

- [ ] 远端 Plugin 仓库（mock + 真实）
- [ ] 5+ 示例 Plugin
- [ ] 一键安装/卸载
- [ ] 评分系统
- [ ] 8+ REST 端点
- [ ] 30+ 单元测试

---

## 六、P1-2 Auto-Compaction 引擎 差距分析

### 6.1 现状

Hermes 长 session 易撑爆 context（无自动压缩）。

**问题**：
- ❌ 无自动压缩触发条件
- ❌ 无压缩算法
- ❌ 无压缩后验证

### 6.2 目标设计

#### 6.2.1 双触发条件

| 触发 | 阈值 | 策略 |
| --- | --- | --- |
| Token 阈值 | 85% context | 全量压缩 |
| 时间阈值 | 30 分钟无活动 | 增量压缩 |

#### 6.2.2 MiniCode 7 阶段压缩流水线

1. **Memory 提取**：从消息中提取关键事实
2. **Token 估算**：评估压缩收益
3. **摘要生成**：LLM 摘要
4. **一致性检查**：摘要与原文对齐
5. **冲突解决**：保留多版本
6. **持久化**：Fernet 加密存储
7. **回滚测试**：恢复并验证

### 6.3 验收标准

- [ ] 双触发条件
- [ ] 7 阶段流水线
- [ ] Fernet 加密
- [ ] 20+ 单元测试

---

## 七、范围与目标

### 7.1 Cycle 13 实施范围

**P0-1 Worktree 隔离执行**（核心）：
- 7 个后端模块（models/manager/lifecycle/merger/storage + api）
- 1 个前端组件（WorktreePanel）
- 60+ 单元测试
- 25+ E2E 断言

**P0-2 Hermes Python/TypeScript SDK**（核心）：
- Python SDK 完整包
- TypeScript SDK 完整包
- 5+ 端到端示例
- 40+ Python 单元 + 30+ TS 单元 + 20+ E2E

**P0-3 LLM-as-Judge 验证层**（核心）：
- 7 个后端模块（models/prompts/pool/consensus/verifier + api）
- 与 P1-10 Verification Loop 集成
- 50+ 单元测试
- 20+ E2E 断言

### 7.2 累计测试目标

| 类别 | 数量 | 通过率 |
| --- | --- | --- |
| 单元测试 | 180+ | 100% |
| E2E 断言 | 70+ | 100% |
| 集成测试 | 40+ | 100% |
| **合计** | **290+** | **100%** |

### 7.3 不在本轮范围

- P1-1 Plugin Marketplace 远端（P1 优先级）
- P1-2 Auto-Compaction（P1 优先级）
- P1-3 TRAE Work 多模态（高复杂度，依赖外部资源）
- P1-4 Goal auto-turn（需要 LLM 集成）

---

## 八、风险评估

| 风险 | 等级 | 缓解措施 |
| --- | --- | --- |
| Worktree 并发冲突 | 中 | 锁 + 队列 |
| Python SDK 类型注解兼容性 | 低 | typing 模块 + Python 3.10+ |
| TypeScript SDK 浏览器兼容 | 低 | ES2020 target |
| LLM Judge 成本 | 中 | 模型池分级 + 缓存 |
| Judge Prompt 注入 | 中 | 输入净化 + 白名单 |

---

## 九、参考

详见 [CYCLE13_RESEARCH_REPORT.md](CYCLE13_RESEARCH_REPORT.md) 各章节。
