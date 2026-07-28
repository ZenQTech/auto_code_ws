# Cycle 12 差距分析报告 - Plugin 系统 + /goal + Three-File Trust

> **周期**: Cycle 12
> **分析时间**: 2026-07-28 14:30
> **当前版本**: Hermes v6.17.1
> **目标基准**: Codex CLI v0.150.0+ / TRAE v3.5.79

---

## 一、总体差距

经过 Cycle 1-11 的迭代，Hermes 已实现大部分核心能力。Cycle 12 聚焦于以下 3 个高价值差距：

| 差距编号 | 名称 | 优先级 | 复杂度 | 价值 |
| --- | --- | --- | --- | --- |
| **P0-1** | Plugin 系统 | P0 | 高 | 高 |
| **P0-2** | /goal 长时域模式 | P0 | 中 | 高 |
| **P0-3** | Three-File Trust 架构 | P0 | 中 | 高 |
| P1-1 | Hermes Python SDK | P1 | 中 | 中 |
| P1-2 | Plugin Marketplace | P1 | 高 | 中 |
| P1-3 | 多层验证 LLM-as-Judge | P1 | 中 | 中 |

---

## 二、P0-1 Plugin 系统差距分析

### 2.1 现状

Hermes 当前扩展能力分散在多个目录：
- `.trae/skills/` - 技能（Codex v0.135+ Progressive Disclosure）
- `.trae/agents/` - 子智能体（P0-17）
- `.trae/rules/` - 规则（P1-6）
- `.trae/hooks/` - 钩子（P0-18）
- `.trae/commands/` - 斜杠命令（P0-12/13）

**问题**：
- ❌ 缺少统一打包机制
- ❌ 无法跨项目分发
- ❌ 没有版本管理
- ❌ 没有依赖管理
- ❌ 没有签名验证

### 2.2 目标架构

#### 2.2.1 Plugin 目录结构

```
.trae/plugins/
├── official/
│   ├── hermes-core/                 # 核心插件
│   │   ├── manifest.json
│   │   ├── skills/
│   │   │   ├── memory-kernel/SKILL.md
│   │   │   ├── self-improvement/SKILL.md
│   │   │   └── verification-loop/SKILL.md
│   │   ├── agents/
│   │   │   ├── architect.md
│   │   │   ├── critic.md
│   │   │   └── qa-manager.md
│   │   ├── hooks/
│   │   │   ├── session-start.json
│   │   │   └── post-tool-use.json
│   │   ├── mcp/
│   │   │   └── config.toml
│   │   ├── rules/
│   │   │   ├── safety/priority-95.md
│   │   │   └── style/priority-50.md
│   │   ├── commands/
│   │   │   ├── clarify.md
│   │   │   └── plan.md
│   │   └── README.md
│   └── hermes-sentry-triage/        # 第三方示例
│       ├── manifest.json
│       ├── skills/
│       ├── agents/
│       └── hooks/
├── community/
│   ├── claude-code-import/          # Claude Code 配置导入
│   └── cursor-config-import/        # Cursor 配置导入
└── personal/
    └── my-custom-plugin/
```

#### 2.2.2 manifest.json 规范

```json
{
  "id": "hermes-plugin-sentry-triage",
  "name": "Sentry Triage",
  "version": "1.0.0",
  "description": "Auto-triage Sentry issues and create PR fixes",
  "author": {
    "name": "Hermes Team",
    "email": "team@hermes.local",
    "url": "https://hermes.local/plugins/sentry-triage"
  },
  "license": "MIT",
  "homepage": "https://hermes.local/plugins/sentry-triage",
  "repository": {
    "type": "git",
    "url": "https://github.com/hermes-ai/sentry-triage-plugin.git"
  },
  "keywords": ["sentry", "triage", "monitoring", "ci-cd"],
  "categories": ["monitoring", "ci-cd"],
  "icon": "icon.png",
  "hermes_version": ">=6.17.0",
  "dependencies": {
    "plugins": ["hermes-core"],
    "python": ">=3.10",
    "node": ">=18"
  },
  "components": {
    "skills": ["skills/triage", "skills/fix"],
    "agents": ["agents/sentry-analyzer.md"],
    "hooks": ["hooks/post-issue.json"],
    "mcp_servers": ["mcp/sentry.toml"],
    "rules": ["rules/sentry-style.md"],
    "commands": ["commands/triage.md"]
  },
  "permissions": {
    "network": ["api.sentry.io"],
    "filesystem": ["/tmp/sentry-cache"],
    "tools": ["read", "write", "execute"]
  },
  "verification": {
    "checksum": "sha256:...",
    "signature": "...",
    "publisher": "Hermes Team"
  }
}
```

### 2.3 实现模块

| 模块 | 路径 | 行数预估 | 职责 |
| --- | --- | --- | --- |
| `plugin_models.py` | `backend/app/core/plugins/models.py` | 250 | 数据模型（Plugin/Manifest/Component） |
| `plugin_loader.py` | `backend/app/core/plugins/loader.py` | 300 | 从目录加载 + 解析 manifest |
| `plugin_registry.py` | `backend/app/core/plugins/registry.py` | 350 | 线程安全注册表（RLock） |
| `plugin_installer.py` | `backend/app/core/plugins/installer.py` | 400 | 安装/卸载/启用/禁用 |
| `plugin_resolver.py` | `backend/app/core/plugins/resolver.py` | 300 | 依赖解析 + 版本约束 |
| `plugin_validator.py` | `backend/app/core/plugins/validator.py` | 350 | manifest 验证 + 签名检查 |
| `plugin_api.py` | `backend/app/api/plugins.py` | 250 | REST API（9+ 端点） |
| `__init__.py` | `backend/app/core/plugins/__init__.py` | 50 | 模块入口 |

### 2.4 API 端点设计

| 端点 | 方法 | 描述 |
| --- | --- | --- |
| `/api/plugins/health` | GET | 健康检查 + Plugin 数量 |
| `/api/plugins/list` | GET | 列出所有已安装 Plugin |
| `/api/plugins/scan` | POST | 扫描 Plugin 目录 |
| `/api/plugins/install` | POST | 安装 Plugin（从本地路径） |
| `/api/plugins/uninstall` | POST | 卸载 Plugin |
| `/api/plugins/enable` | POST | 启用 Plugin |
| `/api/plugins/disable` | POST | 禁用 Plugin |
| `/api/plugins/{id}` | GET | 获取 Plugin 详情 |
| `/api/plugins/{id}/reload` | POST | 重新加载 Plugin |
| `/api/plugins/marketplace/search` | GET | 搜索 Plugin 市场 |

### 2.5 验收标准

- [ ] 至少 1 个示例 Plugin（hermes-core 自包含）
- [ ] manifest.json 验证（Pydantic + JSON Schema）
- [ ] 依赖解析（hermes 版本约束 + Plugin 间依赖）
- [ ] 签名验证（HMAC-SHA256，最小原型）
- [ ] 9+ REST 端点
- [ ] 线程安全注册表
- [ ] 80+ 单元测试
- [ ] 30+ E2E 断言
- [ ] 前端 Plugin 面板（基础列表 + 详情 + 安装/卸载）

---

## 三、P0-2 /goal 长时域模式差距分析

### 3.1 现状

Hermes 已有 `/loop` 命令（P1-4）：
- triage → plan → execute → verify 流程
- 支持 status 查询
- 隔离沙盒执行

**问题**：
- ❌ 无持久化（重启后状态丢失）
- ❌ 无 Checkpoint 机制
- ❌ 无 Token 预算控制
- ❌ 无暂停/恢复
- ❌ 无目标进度跟踪
- ❌ 无 Three-File Trust 文件

### 3.2 /goal 目标架构

#### 3.2.1 状态机

```
       create
         ↓
   ┌─────↓─────┐
   │ RUNNING   │ ←──┐
   └─────┬─────┘    │
         │          │
    pause│          │resume
         ↓          │
   ┌─────────┐      │
   │ PAUSED  │──────┘
   └─────────┘
         │ clear
         ↓
   ┌─────────┐
   │ CLEARED │
   └─────────┘
         │
         │ all criteria met
         ↓
   ┌─────────┐
   │COMPLETED│
   └─────────┘
         │
         │ token exhausted
         ↓
   ┌──────────┐
   │ STOPPED  │
   └──────────┘
```

#### 3.2.2 Goal 持久化结构

```python
@dataclass
class GoalState:
    """/goal 目标状态"""
    goal_id: str
    objective: str
    status: str  # running / paused / completed / stopped / cleared
    created_at: str
    updated_at: str
    completed_at: Optional[str]
    # 进度
    completed_steps: List[str]
    pending_steps: List[str]
    in_progress_step: Optional[str]
    # Token 预算
    tokens_used: int
    token_soft_limit: int
    token_hard_limit: int
    # Checkpoint
    checkpoint_id: Optional[str]
    checkpoint_data: Dict[str, Any]
    # 文件路径
    goal_md_path: str
    verify_md_path: str
    progress_md_path: str
    # 元数据
    metadata: Dict[str, Any]
```

#### 3.2.3 Checkpoint 机制

```python
def create_checkpoint(goal: GoalState) -> str:
    """创建 Checkpoint"""
    checkpoint_id = f"ckpt_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    checkpoint_data = {
        "goal_id": goal.goal_id,
        "completed_steps": goal.completed_steps,
        "in_progress_step": goal.in_progress_step,
        "tokens_used": goal.tokens_used,
        "context_state": serialize_context(),
    }
    save_to_disk(checkpoint_id, checkpoint_data)
    return checkpoint_id
```

### 3.3 实现模块

| 模块 | 路径 | 行数预估 | 职责 |
| --- | --- | --- | --- |
| `goal_models.py` | `backend/app/core/goals/models.py` | 250 | 状态机 + 数据模型 |
| `goal_state.py` | `backend/app/core/goals/state.py` | 300 | 状态管理 + 持久化 |
| `goal_engine.py` | `backend/app/core/goals/engine.py` | 400 | 核心引擎（循环/Checkpoint/Token 预算） |
| `goal_three_files.py` | `backend/app/core/goals/three_files.py` | 350 | GOAL/VERIFY/PROGRESS 文件管理 |
| `goal_verifier.py` | `backend/app/core/goals/verifier.py` | 350 | 独立 Verifier（独立上下文） |
| `goal_api.py` | `backend/app/api/goals.py` | 250 | REST API（10+ 端点） |
| `__init__.py` | `backend/app/core/goals/__init__.py` | 50 | 模块入口 |

### 3.4 API 端点设计

| 端点 | 方法 | 描述 |
| --- | --- | --- |
| `/api/goals/health` | GET | 健康检查 + Goal 数量 |
| `/api/goals` | POST | 创建目标 |
| `/api/goals` | GET | 列出所有目标 |
| `/api/goals/{id}` | GET | 获取目标详情 |
| `/api/goals/{id}/status` | GET | 获取目标状态 |
| `/api/goals/{id}/pause` | POST | 暂停目标 |
| `/api/goals/{id}/resume` | POST | 恢复目标 |
| `/api/goals/{id}/clear` | POST | 清除目标 |
| `/api/goals/{id}/checkpoint` | GET | 获取 Checkpoint |
| `/api/goals/{id}/checkpoint` | POST | 创建 Checkpoint |
| `/api/goals/{id}/verify` | POST | 触发独立 Verifier |
| `/api/goals/{id}/goal-md` | GET/PUT | 读写 GOAL.md |
| `/api/goals/{id}/verify-md` | GET/PUT | 读写 VERIFY.md |
| `/api/goals/{id}/progress-md` | GET | 读 PROGRESS.md |

### 3.5 验收标准

- [ ] 状态机完整（5 状态 + 转换）
- [ ] 持久化（JSON + JSONL 事件流）
- [ ] Checkpoint 机制（创建/恢复）
- [ ] Token 预算（软停止 70% + 硬停止 90%）
- [ ] Three-File Trust（GOAL/VERIFY/PROGRESS）
- [ ] 独立 Verifier（独立上下文）
- [ ] 14+ REST 端点
- [ ] 60+ 单元测试
- [ ] 25+ E2E 断言
- [ ] 前端 Goal 面板（状态卡片 + 进度条 + Token 仪表）

---

## 四、P0-3 Three-File Trust 架构差距分析

### 4.1 现状

Hermes 已有的 Trust 机制：
- Verification Loop（P1-10）4 维度验证
- 自动修复（3 次重试）
- 性能基线管理

**问题**：
- ❌ 无 GOAL.md 标准文件
- ❌ 无 VERIFY.md 检查清单
- ❌ 无 PROGRESS.md 进度日志
- ❌ 无独立 Verifier 上下文

### 4.2 目标设计

#### 4.2.1 GOAL.md 模板

```markdown
# Goal: {{objective}}

## Objective
{{detailed_objective}}

## Acceptance Criteria
{{#each acceptance_criteria}}
- [ ] AC{{@index}}: {{this.description}}
{{/each}}

## Constraints
{{#each constraints}}
- {{this}}
{{/each}}

## Token Budget
- 软停止: {{soft_limit}} tokens
- 硬停止: {{hard_limit}} tokens

## Schedule
- 估计完成: {{estimated_duration}}
- 启动时间: {{created_at}}
```

#### 4.2.2 VERIFY.md 模板

```markdown
# Verification Checklist for {{goal_id}}

{{#each acceptance_criteria}}
## AC{{@index}}: {{this.description}}

### Test
- type: {{this.test.type}}  # unit / integration / e2e / llm-judge
- command: `{{this.test.command}}`
- expected: {{this.test.expected}}

### Independent Verifier
- agent: verifier-{{this.id}}
- context: isolated
- max_retries: 3
{{/each}}

## Multi-Layer Verification

### Layer 1: Unit Tests
{{unit_tests}}

### Layer 2: Integration Tests
{{integration_tests}}

### Layer 3: E2E Tests
{{e2e_tests}}

### Layer 4: LLM-as-Judge
{{llm_judge_criteria}}

### Layer 5: Hooks PostToolUse
{{hooks_validation}}
```

#### 4.2.3 PROGRESS.md 自动生成

```markdown
# Progress Log for {{goal_id}}

## {{timestamp}}
- Status: {{status}}
- Action: {{action}}
- Result: {{result}}
- Tokens used: {{tokens_used}}
{{#if error}}
- Error: {{error}}
- Stack: {{stack}}
{{/if}}

## Statistics
- Total steps: {{total_steps}}
- Completed: {{completed_steps}}
- Failed: {{failed_steps}}
- Token efficiency: {{efficiency}}
```

### 4.3 实现模块

| 模块 | 路径 | 行数预估 | 职责 |
| --- | --- | --- | --- |
| `goal_template.py` | `backend/app/core/goals/template.py` | 250 | 模板渲染（Handlebars 风格） |
| `goal_parser.py` | `backend/app/core/goals/parser.py` | 300 | 解析 GOAL.md/VERIFY.md |
| `goal_progress.py` | `backend/app/core/goals/progress.py` | 250 | PROGRESS.md 写入器 |
| `goal_trust.py` | `backend/app/core/goals/trust.py` | 350 | Three-File Trust 协调器 |
| `goal_verifier.py` | `backend/app/core/goals/verifier.py` | 400 | 独立 Verifier（独立上下文） |

### 4.4 验收标准

- [ ] 3 个模板（GOAL/VERIFY/PROGRESS）
- [ ] Markdown 解析（标准库）
- [ ] 模板渲染（变量替换 + 条件 + 循环）
- [ ] 独立 Verifier 隔离（独立 asyncio 任务）
- [ ] 与 P0-2 /goal 引擎集成
- [ ] 30+ 单元测试
- [ ] 10+ E2E 断言

---

## 五、范围与目标

### 5.1 Cycle 12 实施范围

**P0-1 Plugin 系统**（核心）：
- 7 个后端模块（plugin_models/loader/registry/installer/resolver/validator + api）
- 1 个前端组件（PluginPanel）
- 90+ 单元测试
- 30+ E2E 断言

**P0-2 /goal 长时域模式**（核心）：
- 6 个后端模块（goal_models/state/engine/three_files/verifier + api）
- 1 个前端组件（GoalPanel）
- 60+ 单元测试
- 25+ E2E 断言

**P0-3 Three-File Trust 架构**（集成到 P0-2）：
- 5 个后端模块（template/parser/progress/trust/verifier）
- 与 P0-2 引擎集成
- 30+ 单元测试
- 10+ E2E 断言

### 5.2 累计测试目标

| 类别 | 数量 | 通过率 |
| --- | --- | --- |
| 单元测试 | 180+ | 100% |
| E2E 断言 | 65+ | 100% |
| 集成测试 | 40+ | 100% |
| **合计** | **285+** | **100%** |

### 5.3 不在本轮范围

- Plugin Marketplace（依赖 P0-1，下一轮实现）
- Hermes SDK（独立产品方向，下一轮）
- LLM-as-Judge 完整实现（仅基础接口）
- TRAE Worktree 隔离环境（独立产品方向）

---

## 六、风险评估

| 风险 | 等级 | 缓解措施 |
| --- | --- | --- |
| Plugin 签名验证复杂度 | 中 | 使用最小 HMAC-SHA256 原型 |
| /goal 状态机边界条件 | 中 | 完整的单元测试覆盖所有转换 |
| Three-File Trust 模板解析错误 | 低 | 使用成熟 Markdown 解析 |
| 持久化数据丢失 | 低 | JSONL 事件流 + 定期 Checkpoint |
| 性能问题（多 Plugin 加载） | 低 | 懒加载 + 缓存机制 |

---

## 七、参考

详见 [CYCLE12_RESEARCH_REPORT.md](CYCLE12_RESEARCH_REPORT.md) 第八节总结。
