# G63-01 Spec: PRD 生成器（PRD Generator）

> **Cycle**: 63
> **优先级**: 🔴 P0
> **目标**: 对标 Trae SOLO Builder 的 PRD 工作流，实现自然语言需求到结构化 PRD 的自动生成
> **来源**: cycle63-research-report.md § 2.1 + cycle63-gap-analysis.md § 2.1

---

## 1. 功能需求描述

### 1.1 目标
为 Hermes Solo 模式添加 PRD 自动生成能力，让用户输入自然语言需求后，AI 自动产出结构化的产品需求文档（PRD）。

### 1.2 用户场景
- **场景 1（独立开发者）**: 个人开发者想快速验证产品想法，描述需求后立即获得完整 PRD
- **场景 2（PM 验证）**: 产品经理需要快速生成 PRD 初稿，用于团队讨论
- **场景 3（需求迭代）**: AI 生成的 PRD 不够完整，用户给出反馈，AI 迭代改进
- **场景 4（PRD 协作）**: 多版本 PRD 间的差异对比，便于团队评审

### 1.3 使用流程
```
用户输入需求（自然语言）
       ↓
  [生成 PRD] 按钮
       ↓
  AI 解析 → 结构化 PRD（含目标/场景/验收/任务）
       ↓
  PRD 展示（DocView 标签）
       ↓
  [继续对话 / 迭代 PRD / 接受 PRD / 查看历史]
       ↓
  进入"编码"阶段（Auto-Follow）
```

### 1.4 核心特性
- ✅ PRD 自动生成（基于 LLM）
- ✅ PRD 迭代（基于反馈重新生成）
- ✅ PRD 版本管理（v1, v2, v3...）
- ✅ PRD diff 视图（前后对比）
- ✅ PRD 模板系统（可复用）
- ✅ 集成到 Solo Shell 工具面板

---

## 2. 技术实现方案

### 2.1 架构设计

```
┌──────────────────────────────────────────────┐
│  Frontend                                    │
│  ┌──────────────┐  ┌──────────────┐         │
│  │PRDGenerator  │  │  PRDView     │         │
│  │Dialog        │  │ (DocView Tab)│         │
│  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │
│  ┌──────▼─────────────────▼───────┐         │
│  │   usePRD Hook                  │         │
│  │   (WebSocket + REST)           │         │
│  └──────┬─────────────────────────┘         │
└─────────┼───────────────────────────────────┘
          │ HTTP REST + WebSocket
┌─────────▼───────────────────────────────────┐
│  Backend (FastAPI)                          │
│  ┌──────────────────────────────────────┐  │
│  │  /api/prd/...                        │  │
│  │  - generate, iterate, get, list      │  │
│  └──────┬───────────────────────────────┘  │
│         │                                   │
│  ┌──────▼──────┐  ┌──────────────┐         │
│  │ PRDGenerator│  │  PRDStorage  │         │
│  │ (LLM-based) │  │ (in-mem+JSON)│         │
│  └──────┬──────┘  └──────┬───────┘         │
│         │                │                  │
│  ┌──────▼────────────────▼───────┐         │
│  │   LLM Service (OpenAI/Claude) │         │
│  └────────────────────────────────┘         │
└──────────────────────────────────────────────┘
```

### 2.2 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 后端 | FastAPI + Pydantic | 已有基线，类型安全 |
| LLM 调用 | `llm_service` (已有) | 复用，统一接口 |
| 存储 | 内存 + JSON 文件 | 轻量，无需引入 DB |
| Diff 算法 | `diff-match-patch` | 已有依赖 |
| 前端 | React + TypeScript + Tailwind | 已有基线 |
| 状态管理 | React Hook | 局部状态，无需 Redux |

### 2.3 核心算法

#### 2.3.1 PRD 生成 Prompt
```python
PRD_GENERATION_PROMPT = """你是一位资深产品经理。请基于以下需求生成结构化 PRD。

需求：{requirement}

输出 JSON 格式：
{
  "title": "项目标题（10-30 字）",
  "goals": ["目标 1", "目标 2", ...],
  "user_scenarios": [
    {
      "name": "场景名",
      "description": "场景描述",
      "preconditions": ["前提 1", "前提 2"],
      "steps": ["步骤 1", "步骤 2", "步骤 3"]
    }
  ],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "description": "验收条件描述",
      "metric": "度量（如：响应时间 < 200ms）",
      "target": "目标值"
    }
  ],
  "tasks": [
    {
      "id": "T-1",
      "name": "任务名",
      "description": "任务描述",
      "dependencies": ["T-0"],
      "estimated_hours": 4.0,
      "risk_level": "low"
    }
  ],
  "risks": ["风险 1", "风险 2"]
}

要求：
1. 目标 3-5 条
2. 用户场景 2-4 个
3. 验收标准 5-10 条
4. 任务分解 5-15 个，按依赖排序
5. 风险识别 2-5 条
"""
```

#### 2.3.2 PRD Diff 算法
- 使用 `diff-match-patch` 库
- 字段级 diff（goals / user_scenarios / tasks 分别 diff）
- 输出结构化 DiffOp 列表
- 渲染时按字段分组展示

#### 2.3.3 任务复杂度
- 生成: O(1) LLM 调用 + O(n) JSON 解析（n=PRD 字段数）
- 迭代: O(1) LLM 调用 + O(m) diff 计算（m=版本数）
- 列表查询: O(1) 内存索引

---

## 3. 接口设计规范

### 3.1 REST API

#### 3.1.1 生成 PRD
```http
POST /api/prd/generate
Content-Type: application/json

{
  "requirement": "实现一个 Todo List 应用",
  "context": {
    "tech_stack": ["React", "TypeScript"],
    "user_role": "developer"
  },
  "template": "default"
}

Response 200:
{
  "prd_id": "prd-abc123",
  "content": { ... PRDDocument ... },
  "version": 1,
  "created_at": 1691234567.89
}
```

#### 3.1.2 获取 PRD
```http
GET /api/prd/{prd_id}

Response 200:
{
  "prd_id": "prd-abc123",
  "content": { ... PRDDocument ... },
  "version": 1,
  "history": []
}
```

#### 3.1.3 迭代 PRD
```http
POST /api/prd/{prd_id}/iterate
Content-Type: application/json

{
  "feedback": "增加用户登录功能",
  "version": 1
}

Response 200:
{
  "prd_id": "prd-abc123",
  "content": { ... PRDDocument v2 ... },
  "version": 2,
  "diff": [ ... DiffOps ... ]
}
```

#### 3.1.4 PRD Diff
```http
POST /api/prd/{prd_id}/diff
Content-Type: application/json

{
  "from_version": 1,
  "to_version": 2
}

Response 200:
{
  "diff": [
    { "field": "goals", "op": "added", "value": "目标 4" },
    { "field": "tasks", "op": "modified", "from": {...}, "to": {...} }
  ],
  "summary": "新增 1 个目标、3 个任务、1 个风险"
}
```

#### 3.1.5 列出所有 PRD
```http
GET /api/prd/list

Response 200:
{
  "prds": [
    { "prd_id": "prd-abc123", "title": "Todo List", "version": 2, "updated_at": 1691234567.89 }
  ]
}
```

### 3.2 错误码

| 状态码 | 含义 | 处理 |
|--------|------|------|
| 400 | 输入不合法 | 返回 detail 字段 |
| 404 | PRD 不存在 | 返回 detail 字段 |
| 429 | 限流 | 返回 retry_after 字段 |
| 500 | LLM 调用失败 | 返回 error_code 字段 |
| 503 | LLM 服务不可用 | 返回 error_code 字段 |

### 3.3 WebSocket 事件（可选增强）
```python
WS /api/prd/ws/{prd_id}

# 服务端 → 客户端
{
  "type": "generating",
  "prd_id": "prd-abc123",
  "progress": 0.3,
  "stage": "analyzing"
}
```

---

## 4. 数据结构定义

### 4.1 Pydantic Models

```python
# app/models/prd.py
from pydantic import BaseModel, Field
from typing import List, Optional

class Scenario(BaseModel):
    """用户场景"""
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=2000)
    preconditions: List[str] = []
    steps: List[str] = []

class Criterion(BaseModel):
    """验收标准"""
    id: str = Field(..., pattern=r"^AC-\d+$")
    description: str = Field(..., min_length=1, max_length=500)
    metric: str = ""
    target: str = ""

class Task(BaseModel):
    """任务分解"""
    id: str = Field(..., pattern=r"^T-\d+$")
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)
    dependencies: List[str] = []
    estimated_hours: float = Field(0.0, ge=0, le=1000)
    risk_level: str = Field("low", pattern=r"^(low|medium|high)$")

class PRDDocument(BaseModel):
    """PRD 文档主体"""
    prd_id: str
    title: str = Field(..., min_length=1, max_length=200)
    goals: List[str] = Field(..., min_length=1, max_length=10)
    user_scenarios: List[Scenario] = Field(default_factory=list, max_length=10)
    acceptance_criteria: List[Criterion] = Field(default_factory=list, max_length=50)
    tasks: List[Task] = Field(default_factory=list, max_length=50)
    risks: List[str] = Field(default_factory=list, max_length=20)
    version: int = Field(1, ge=1)
    created_at: float
    updated_at: float

class PRDVersion(BaseModel):
    """PRD 版本快照"""
    version: int
    content: PRDDocument
    diff_summary: Optional[str] = None
    created_at: float

class PRDGenerateRequest(BaseModel):
    requirement: str = Field(..., min_length=10, max_length=10000)
    context: Optional[dict] = None
    template: Optional[str] = "default"

class PRDIterateRequest(BaseModel):
    feedback: str = Field(..., min_length=5, max_length=5000)
    version: int = Field(..., ge=1)
```

### 4.2 存储结构

```python
# 内存存储
prd_store: Dict[str, List[PRDVersion]] = {}  # prd_id -> versions
prd_meta: Dict[str, dict] = {}  # prd_id -> {title, current_version, updated_at}

# 文件存储（可选）
# prd_data/{prd_id}/v{n}.json
# prd_data/{prd_id}/meta.json
```

---

## 5. 性能与安全要求

### 5.1 性能指标
- **PRD 生成响应时间**: P95 < 10s, P99 < 15s
- **PRD 迭代响应时间**: P95 < 5s, P99 < 8s
- **PRD diff 响应时间**: P95 < 1s
- **列表查询响应时间**: P95 < 100ms
- **并发支持**: ≥ 50 个 PRD 同时生成
- **存储容量**: 内存 ≤ 500MB，文件 ≤ 5GB

### 5.2 安全要求
- **输入校验**:
  - requirement 长度限制 10-10000
  - feedback 长度限制 5-5000
  - 防止 prompt 注入（转义特殊字符）
  - 防止超大输入 DoS
- **输出校验**:
  - LLM 返回必须通过 Pydantic 验证
  - JSON 解析失败时返回结构化错误
- **限流**:
  - 每用户 100 次/小时
  - 全局 1000 次/小时
  - 超限返回 429 + retry_after
- **权限控制**:
  - PRD 仅创建者可访问（session_id 隔离）
  - 管理员可访问所有 PRD
- **审计日志**:
  - 记录 PRD 创建/迭代/删除操作
  - 包含时间戳、用户、prd_id、版本号

### 5.3 可靠性
- LLM 调用失败自动重试（最多 3 次）
- 存储失败回滚机制
- 部分字段缺失时降级（goals 缺失时使用默认标题）
- 异常隔离：单 PRD 失败不影响其他 PRD

---

## 6. 验收标准

### 6.1 功能验收

#### 6.1.1 PRD 生成
- [ ] 输入合法需求，生成完整 PRD（goals/user_scenarios/acceptance_criteria/tasks/risks 全部存在）
- [ ] LLM 调用失败时返回 500 + error_code
- [ ] 输入校验失败时返回 400 + detail
- [ ] 限流时返回 429 + retry_after

#### 6.1.2 PRD 迭代
- [ ] 提交反馈后生成新版本 PRD
- [ ] 新版本 PRD 包含反馈相关变更
- [ ] diff 视图正确显示新旧版本差异
- [ ] 版本号自增

#### 6.1.3 PRD Diff
- [ ] 字段级 diff 正确
- [ ] 任务级 diff 正确（新增/修改/删除）
- [ ] summary 字段准确

#### 6.1.4 前端集成
- [ ] PRDGeneratorDialog 可输入需求 + 提交
- [ ] PRDView 正确展示 PRD 全部字段
- [ ] PRDDiffView 正确显示 diff
- [ ] 集成到 Solo Shell 工具面板（DocView 标签）

### 6.2 测试用例

#### 6.2.1 自动化测试
- [ ] `test_prd_generator.py`：服务层测试（≥ 30 个测试）
  - 基础生成
  - 输入校验
  - 错误处理
  - 限流
  - 并发
  - LLM mock
- [ ] `test_prd_api.py`：API 层测试（≥ 20 个测试）
  - 各端点正常流程
  - 各端点异常流程
  - 权限校验
  - WebSocket（可选）
- [ ] `PRDGeneratorDialog.test.tsx`：前端组件测试（≥ 10 个）
- [ ] `PRDView.test.tsx`：前端展示测试（≥ 10 个）
- [ ] `PRDDiffView.test.tsx`：diff 视图测试（≥ 8 个）
- [ ] `usePRD.test.ts`：Hook 测试（≥ 8 个）

**测试覆盖目标**: ≥ 90%

#### 6.2.2 浏览器 E2E 测试（手动 + 自动）
1. 打开 http://localhost:5173
2. 切换到 Solo 模式
3. 在 EmbeddedTools 中选择 "PRD" 标签
4. 点击 "新建 PRD"
5. 输入需求："实现一个 Todo List 应用"
6. 点击 "生成"
7. 验证 PRD 展示完整（目标/场景/验收/任务）
8. 输入反馈："增加用户登录"
9. 点击 "迭代"
10. 验证 diff 视图正确显示
11. 验证 PRD 版本号从 1 变为 2
12. 切换主题（dark/light/contrast），验证 PRD 视图正常
13. 刷新页面，验证 PRD 历史保留

**E2E 通过条件**: 所有 13 步全部通过

#### 6.2.3 性能测试
- [ ] PRD 生成 P95 < 10s
- [ ] PRD 迭代 P95 < 5s
- [ ] 并发 50 个生成任务无超时

### 6.3 文档验收
- [ ] API 文档（OpenAPI 自动生成）
- [ ] 组件文档（README + 注释）
- [ ] 使用指南（.trae/documents/g63-01-usage.md）

### 6.4 安全验收
- [ ] prompt 注入测试通过
- [ ] 限流测试通过
- [ ] 权限隔离测试通过

---

## 7. 依赖关系

### 7.1 已有依赖（无需新增）
- ✅ FastAPI（后端框架）
- ✅ Pydantic（数据验证）
- ✅ LLMService（LLM 调用封装）
- ✅ diff-match-patch（diff 算法）
- ✅ React + TypeScript（前端）
- ✅ Tailwind CSS（样式）

### 7.2 内部模块依赖
- `app/services/llm_service.py`：LLM 调用
- `app/models/`：Pydantic 模型
- `frontend/src/hooks/`：前端 Hook 模式
- `frontend/src/components/EmbeddedTools.tsx`：工具面板集成点

### 7.3 新增文件
**后端**:
- `backend/app/services/prd_generator.py`（核心服务）
- `backend/app/api/prd.py`（REST API）
- `backend/app/models/prd.py`（数据模型）
- `backend/tests/test_prd_generator.py`（服务测试）
- `backend/tests/test_prd_api.py`（API 测试）

**前端**:
- `frontend/src/components/PRDGeneratorDialog.tsx`
- `frontend/src/components/PRDView.tsx`
- `frontend/src/components/PRDDiffView.tsx`
- `frontend/src/hooks/usePRD.ts`
- `frontend/src/__tests__/PRDGeneratorDialog.test.tsx`
- `frontend/src/__tests__/PRDView.test.tsx`
- `frontend/src/__tests__/PRDDiffView.test.tsx`
- `frontend/src/__tests__/usePRD.test.ts`

**文档**:
- `g63-01-spec.md`（本文件）
- `g63-01-usage.md`（使用指南）
- `g63-01-impl.md`（实施记录）

---

## 8. 实施时间线

| 阶段 | 内容 | 预计时间 |
|------|------|----------|
| Phase 1 | 数据模型 + 基础服务 | 2h |
| Phase 2 | REST API + WebSocket | 1.5h |
| Phase 3 | 单元测试（后端） | 1.5h |
| Phase 4 | 前端组件 + Hook | 2h |
| Phase 5 | 前端单元测试 | 1.5h |
| Phase 6 | 集成到 EmbeddedTools | 0.5h |
| Phase 7 | E2E 测试 + 浏览器验证 | 1h |
| Phase 8 | 文档 + 验收报告 | 0.5h |
| **总计** | | **10.5h** |

---

## 9. 下一步

1. 创建 G63-02 spec 文档（自定义 Agent 角色）
2. 创建 G63-03 spec 文档（StageDetector）
3. 按 P0 顺序启动实施：G63-01 → G63-02 → G63-03
4. 每个 spec 完成后立即进行 3 维度测试
