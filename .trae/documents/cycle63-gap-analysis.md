# CYCLE 63 功能差距分析报告

> **生成日期**: 2026-08-04
> **基础**: cycle63-research-report.md
> **范围**: Codex CLI v0.105+ 新功能 + Trae SOLO 模式核心能力

---

## 一、差距矩阵（vs Codex CLI v0.145 + Trae SOLO Builder）

| # | 功能 | 优先级 | 当前状态 | 期望标准 | 实施复杂度 | 风险等级 |
|---|------|--------|----------|----------|------------|----------|
| 1 | **PRD 生成器** | 🔴 P0 | ❌ 缺失 | 自然语言 → 结构化 PRD（含目标/场景/验收/任务分解） | 中 | 低 |
| 2 | **自定义 Agent 角色** | 🔴 P0 | ❌ 缺失 | TOML 配置 + 4 内置角色 + 角色注册 | 中 | 中 |
| 3 | **StageDetector（阶段检测）** | 🔴 P0 | ❌ 缺失 | 4 阶段自动识别 + WebSocket 推送 | 中 | 低 |
| 4 | **CSV 批处理 spawn_agents** | 🟡 P1 | ❌ 缺失 | 每行一个 worker + 进度跟踪 + 结果汇总 | 中 | 中 |
| 5 | **/theme 命令** | 🟡 P1 | 🟡 部分 | 实时预览 + 主题元信息 + diff 颜色适配 | 低 | 低 |
| 6 | **Reasoning 切换** | 🟡 P1 | ❌ 缺失 | Alt+,/Alt+. 快捷键 + reasoning effort 调整 | 低 | 低 |
| 7 | **PTT 语音输入** | 🟡 P1 | ❌ 缺失 | Web Speech API + 按住说话 | 中 | 低 |
| 8 | **PRD diff 视图** | 🟡 P1 | ❌ 缺失 | diff 算法 + 树形展示 + 时间轴 | 中 | 低 |
| 9 | **Operation-level undo** | 🟡 P1 | 🟡 部分 | RollbackManager + /undo 命令 | 中 | 中 |
| 10 | **OSC 9 通知** | 🟢 P2 | ❌ 缺失 | 浏览器 Notification API + Toast | 低 | 低 |
| 11 | **Sleep prevention** | 🟢 P2 | ❌ 缺失 | Wake Lock API | 低 | 低 |
| 12 | **Vercel 部署集成** | 🟢 P2 | ❌ 缺失 | 一键部署到 Vercel | 高 | 中 |

---

## 二、本轮 P0 实施计划

### 2.1 G63-01: PRD 生成器

**目标**: 实现 Trae SOLO Builder 的核心 PRD 工作流

**功能需求**:
- 输入: 自然语言需求描述
- 输出: 结构化 PRD（含目标、用户场景、验收标准、任务分解）
- 支持 PRD 迭代（基于反馈重新生成）
- 支持 PRD diff 视图（前后对比）
- 集成到 Solo Shell 的工具面板（DocView 标签）

**核心组件**:
- 后端: `PRDGenerator` 服务（基于 LLM）
- 后端: `PRDIterator` 服务（基于反馈迭代）
- 前端: `PRDGeneratorDialog`（输入 + 生成）
- 前端: `PRDView`（PRD 展示）
- 前端: `PRDDiffView`（diff 视图）

**接口设计**:
```python
POST /api/prd/generate
  body: { requirement: str, context?: dict, template?: str }
  resp: { prd_id: str, content: PRDDocument, created_at: ts }

GET  /api/prd/{prd_id}
  resp: { prd_id, content, version, history: [PRDDocument] }

POST /api/prd/{prd_id}/iterate
  body: { feedback: str, version: int }
  resp: { prd_id, content, new_version, diff: PRDDocument[] }

POST /api/prd/{prd_id}/diff
  body: { from_version: int, to_version: int }
  resp: { diff: DiffOp[], summary: str }

GET  /api/prd/list
  resp: { prds: [{ prd_id, title, version, updated_at }] }
```

**数据结构**:
```python
class PRDDocument(BaseModel):
    prd_id: str
    title: str
    goals: List[str]            # 项目目标
    user_scenarios: List[Scenario]  # 用户场景
    acceptance_criteria: List[Criterion]  # 验收标准
    tasks: List<Task]           # 任务分解
    risks: List[str]            # 风险点
    version: int = 1
    created_at: float
    updated_at: float

class Scenario(BaseModel):
    name: str
    description: str
    preconditions: List[str]
    steps: List[str]

class Criterion(BaseModel):
    id: str
    description: str
    metric: str
    target: str

class Task(BaseModel):
    id: str
    name: str
    description: str
    dependencies: List[str]
    estimated_hours: float
    risk_level: str  # low/medium/high
```

**性能要求**:
- PRD 生成 < 10s（P95）
- PRD 迭代 < 5s（P95）
- 支持并发 50 个 PRD 生成

**安全要求**:
- 输入校验：防止 prompt 注入
- 输出校验：JSON 结构验证
- 限流：每用户 100 次/小时

**验收标准**:
- ✅ PRD 生成成功率 ≥ 95%
- ✅ PRD 结构化字段完整率 ≥ 98%
- ✅ PRD diff 视图无视觉错位
- ✅ 单元测试覆盖 ≥ 90%
- ✅ E2E 测试：完整 PRD 工作流可演示

---

### 2.2 G63-02: 自定义 Agent 角色定义

**目标**: 实现 Codex subagent 的角色系统，支持自定义 Agent 类型

**功能需求**:
- 4 个内置角色: `default` / `worker` / `explorer` / `monitor`
- 支持 TOML 配置自定义角色
- 角色注册与管理
- 角色级模型/沙箱/MCP 覆盖
- 角色展示（nickname、状态、任务数）

**核心组件**:
- 后端: `AgentRoleManager` 服务
- 后端: `AgentRoleRegistry`（TOML 解析）
- 前端: `AgentRoleManager.tsx`（角色管理 UI）
- 前端: `AgentRoleBadge.tsx`（角色徽章）

**接口设计**:
```python
GET  /api/agents/roles
  resp: { roles: [{ name, description, builtin, model, sandbox_mode, mcp_servers }] }

GET  /api/agents/roles/{name}
  resp: { role: AgentRole, instances: [AgentInstance] }

POST /api/agents/roles
  body: { name, description, developer_instructions, model?, sandbox_mode?, mcp_servers?, nickname_candidates? }
  resp: { role: AgentRole }

PUT  /api/agents/roles/{name}
  body: { ...role fields }
  resp: { role: AgentRole }

DELETE /api/agents/roles/{name}
  resp: { success: bool }

POST /api/agents/spawn
  body: { role_name, task, context? }
  resp: { agent_id, nickname, status }

GET  /api/agents/instances
  resp: { instances: [{ agent_id, role, nickname, status, task, started_at }] }

POST /api/agents/instances/{id}/cancel
  resp: { success: bool }
```

**数据结构**:
```python
class AgentRole(BaseModel):
    name: str                       # 角色名（如 "reviewer"）
    description: str                 # 何时使用此角色
    developer_instructions: str     # 核心行为指令
    nickname_candidates: List[str]   # 可读别名池
    model: Optional[str] = None      # 模型覆盖
    model_reasoning_effort: Optional[str] = None  # 推理力度
    sandbox_mode: Optional[str] = None  # 沙箱模式
    mcp_servers: List[str] = []     # MCP 服务器列表
    skills: List[str] = []          # 技能列表
    builtin: bool = False            # 是否内置
    created_at: float
    updated_at: float

class AgentInstance(BaseModel):
    agent_id: str
    role_name: str
    nickname: str
    status: str                     # spawning/running/idle/failed/dead
    task: str
    started_at: float
    finished_at: Optional[float] = None
    result: Optional[str] = None
    error: Optional[str] = None
```

**TOML 配置示例**:
```toml
[role]
name = "reviewer"
description = "PR review focused on correctness, security, and missing tests."
developer_instructions = """
Review code like an owner. Prioritize:
- Correctness (logic errors, edge cases)
- Security (injection, auth, validation)
- Behavior regressions
- Missing test coverage
"""
nickname_candidates = ["Atlas", "Delta", "Echo"]
model = "gpt-5.5"
sandbox_mode = "read-only"
mcp_servers = ["github-mcp"]
```

**性能要求**:
- 角色注册 < 100ms
- 实例 spawn < 500ms
- 角色列表查询 < 50ms

**安全要求**:
- 角色名正则校验: `^[a-z][a-z0-9_-]{0,63}$`
- developer_instructions 长度限制 10KB
- TOML 解析异常隔离
- 实例数量限制：每角色 ≤ 10 个并发

**验收标准**:
- ✅ 4 个内置角色全部可用
- ✅ 至少 3 个自定义角色可注册
- ✅ 角色级模型/沙箱覆盖生效
- ✅ 单元测试覆盖 ≥ 90%
- ✅ E2E 测试：spawn + 任务执行 + 取消

---

### 2.3 G63-03: StageDetector + Auto-Follow

**目标**: 实现 Trae SOLO 的 Auto-Follow 能力，自动识别 AI 工作阶段

**功能需求**:
- 4 个阶段: `prd` / `coding` / `preview` / `deploy`
- 阶段检测基于：AI 输出关键词 + 任务状态机 + 文件系统变化
- 阶段变更时 WebSocket 推送
- Auto-Follow：阶段变化时自动切换工具面板

**核心组件**:
- 后端: `StageDetector` 服务
- 后端: `StageEventBus`（WebSocket 推送）
- 前端: `useStage` Hook
- 前端: `StageIndicator.tsx`（阶段指示器）
- 前端: Auto-Follow 联动到 EmbeddedTools

**接口设计**:
```python
GET  /api/stage/current?session_id={id}
  resp: { session_id, stage, substage, confidence, detected_at }

POST /api/stage/force
  body: { session_id, stage }
  resp: { success: bool }

WS   /api/stage/ws/{session_id}
  events: { type: "stage_change", stage, substage, confidence, reason }
          { type: "substage_change", substage, progress }
          { type: "follow_action", tool_panel, action }

GET  /api/stage/history?session_id={id}
  resp: { events: [StageEvent] }
```

**阶段定义**:
```python
STAGES = {
    "prd": {
        "label": "需求分析",
        "emoji": "📋",
        "triggers": ["PRD", "需求", "user story", "acceptance criteria"],
        "tools": ["prd_view", "diff_view"],
    },
    "coding": {
        "label": "编码",
        "emoji": "💻",
        "triggers": ["```", "function", "class", "import", "def "],
        "tools": ["editor", "terminal", "diff_view"],
    },
    "preview": {
        "label": "预览",
        "emoji": "👀",
        "triggers": ["preview", "http://localhost", "screenshot"],
        "tools": ["browser", "screenshot"],
    },
    "deploy": {
        "label": "部署",
        "emoji": "🚀",
        "triggers": ["deploy", "vercel", "netlify", "npm run build"],
        "tools": ["terminal", "deploy_panel"],
    },
}
```

**性能要求**:
- 阶段检测延迟 < 200ms
- WebSocket 推送 < 100ms
- 状态机切换原子性保证

**验收标准**:
- ✅ 4 个阶段正确识别（准确率 ≥ 85%）
- ✅ WebSocket 推送稳定（断线自动重连）
- ✅ Auto-Follow 联动到工具面板
- ✅ 单元测试覆盖 ≥ 90%
- ✅ E2E 测试：完整阶段流转

---

## 三、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| PRD 生成 LLM 调用失败 | 中 | 重试机制 + 缓存 + 降级到模板 |
| 自定义角色配置错误 | 中 | TOML 校验 + 默认值填充 |
| 阶段检测误判 | 中 | 手动 override 接口 + 置信度显示 |
| WebSocket 断线 | 低 | 心跳 + 自动重连 |
| 实例资源耗尽 | 高 | 资源配额 + 任务队列 |

---

## 四、下一阶段

按以下顺序实施：
1. G63-01 PRD 生成器（基础 + 文档驱动）
2. G63-02 自定义 Agent 角色（多智能体基础）
3. G63-03 StageDetector（Auto-Follow 联动）
4. UI/UX 优化：DocView 面板 + AgentRoleManager 面板
5. E2E 测试：完整 PRD → 编码 → 预览 → 部署工作流
