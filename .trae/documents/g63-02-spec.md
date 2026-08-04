# G63-02 Spec: 自定义 Agent 角色定义（Custom Agent Roles）

> **Cycle**: 63
> **优先级**: 🔴 P0
> **目标**: 对标 Codex CLI v0.105+ subagent 角色系统，实现可配置的多智能体角色
> **来源**: cycle63-research-report.md § 1.1 + cycle63-gap-analysis.md § 2.2

---

## 1. 功能需求描述

### 1.1 目标
为 Hermes 多智能体系统添加可配置角色能力，让管理员定义不同类型 Agent（reviewer/worker/explorer 等），每个角色有独立的模型、沙箱、MCP 绑定。

### 1.2 用户场景
- **场景 1（PR Reviewer）**: 定义只读 reviewer 角色，绑定 github-mcp，强制 gpt-5.5 模型
- **场景 2（Test Writer）**: 定义测试生成角色，绑定 pytest 技能，低成本模型
- **场景 3（Migration Worker）**: 定义迁移执行角色，限制只访问特定目录
- **场景 4（Monitor）**: 定义长任务监控角色，支持 1 小时 polling

### 1.3 使用流程
```
管理员定义 Agent 角色（TOML）
       ↓
  AgentRoleManager 加载并注册
       ↓
  任务发起者选择角色 spawn
       ↓
  Agent 实例化（带 nickname）
       ↓
  独立执行（带角色级沙箱/MCP）
       ↓
  结果返回 / 失败重试
```

### 1.4 核心特性
- ✅ 4 个内置角色（default/worker/explorer/monitor）
- ✅ TOML 配置自定义角色
- ✅ 角色级模型/沙箱/MCP 覆盖
- ✅ 实例 spawn / 状态查询 / 取消
- ✅ 角色徽章 + nickname 显示

---

## 2. 技术实现方案

### 2.1 架构

```
┌─────────────────────────────────────────────┐
│  AgentRoleManager (Singleton)               │
│  ┌─────────────┐  ┌─────────────┐           │
│  │  Registry   │  │  Instances  │           │
│  │  (4 built-in│  │  (running   │           │
│  │  + N custom)│  │   agents)   │           │
│  └──────┬──────┘  └──────┬──────┘           │
│         │                │                  │
│  ┌──────▼────────────────▼───────┐          │
│  │   TOML Parser                 │          │
│  │   (config file or REST API)   │          │
│  └───────────────────────────────┘          │
└─────────────────────────────────────────────┘
```

### 2.2 核心组件

**后端**:
- `app/services/agent_role_manager.py`: 角色管理核心
- `app/api/agent_roles.py`: REST API
- `app/models/agent_role.py`: Pydantic 模型

**前端**:
- `AgentRoleManager.tsx`: 角色管理 UI
- `AgentRoleBadge.tsx`: 角色徽章
- `useAgentRole.ts`: 角色操作 Hook

### 2.3 TOML 配置

```toml
# ~/.hermes/agents/reviewer.toml
[role]
name = "reviewer"
description = "PR reviewer focused on correctness, security, and missing tests."
developer_instructions = """
Review code like an owner. Prioritize:
- Correctness (logic errors, edge cases)
- Security (injection, auth, validation)
- Behavior regressions
- Missing test coverage
"""
nickname_candidates = ["Atlas", "Delta", "Echo"]
model = "gpt-5.5"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
mcp_servers = ["github-mcp"]
skills = ["code-review"]
```

---

## 3. 接口设计

```python
GET    /api/agents/roles                  # 列出所有角色
GET    /api/agents/roles/{name}           # 获取角色详情
POST   /api/agents/roles                  # 注册自定义角色
PUT    /api/agents/roles/{name}           # 更新角色
DELETE /api/agents/roles/{name}           # 删除自定义角色
POST   /api/agents/spawn                  # spawn 实例
GET    /api/agents/instances              # 列出所有实例
GET    /api/agents/instances/{id}         # 实例详情
POST   /api/agents/instances/{id}/cancel  # 取消实例
```

---

## 4. 数据结构

```python
class AgentRole(BaseModel):
    name: str
    description: str
    developer_instructions: str
    nickname_candidates: List[str] = []
    model: Optional[str] = None
    model_reasoning_effort: Optional[str] = None
    sandbox_mode: Optional[str] = None
    mcp_servers: List[str] = []
    skills: List[str] = []
    builtin: bool = False
    created_at: float
    updated_at: float

class AgentInstance(BaseModel):
    agent_id: str
    role_name: str
    nickname: str
    status: str  # spawning/running/idle/failed/dead
    task: str
    started_at: float
    finished_at: Optional[float] = None
    result: Optional[str] = None
    error: Optional[str] = None
```

---

## 5. 性能与安全

### 5.1 性能
- 角色注册: < 100ms
- 实例 spawn: < 500ms
- 角色列表查询: < 50ms
- 每角色并发上限: 10 个

### 5.2 安全
- 角色名正则: `^[a-z][a-z0-9_-]{0,63}$`
- developer_instructions 长度限制 10KB
- TOML 解析异常隔离
- 角色级沙箱强制应用

---

## 6. 验收标准

### 6.1 功能
- [ ] 4 个内置角色全部可用
- [ ] 至少 3 个自定义角色可注册
- [ ] 角色级模型/沙箱覆盖生效
- [ ] 实例 spawn / 状态 / 取消完整工作

### 6.2 测试
- [ ] `test_agent_role_manager.py`: 服务测试（≥ 25 个）
- [ ] `test_agent_role_api.py`: API 测试（≥ 15 个）
- [ ] `AgentRoleManager.test.tsx`: 前端测试（≥ 10 个）
- [ ] 测试覆盖 ≥ 90%

### 6.3 浏览器 E2E
1. 打开 Solo Shell
2. 进入"智能体"标签
3. 查看 4 个内置角色
4. 点击"新建角色"
5. 填写 reviewer 角色信息
6. 提交
7. 验证角色出现在列表
8. 点击"启动实例"
9. 验证实例生成（带 nickname）
10. 验证实例状态变化
11. 点击"取消"
12. 验证实例进入 dead 状态

### 6.4 文档
- [ ] `g63-02-usage.md` 使用指南
- [ ] 角色 TOML 配置示例集合
