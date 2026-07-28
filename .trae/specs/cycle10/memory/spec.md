# P1-8 Hermes Memory System - Dual-Track Persistent Memory

> **任务 ID**: P1-8
> **关联阶段**: Cycle 10 - 智能体长期记忆
> **版本**: v1.0.0
> **日期**: 2026-07-28
> **来源**: TRAE Global Memory + Dual-Track Persistent Memory + Codex /import

---

## 一、功能需求

### 1.1 目标

实现 Hermes 智能体的长期记忆系统，让智能体能够：
- 跨会话保留学习成果
- 自动从经验中提取模式
- 在新任务开始时自动回忆相关上下文
- 错误解决经验复用

### 1.2 用户场景

**场景 1：跨会话偏好保留**
- 用户在会话 A 中告诉 Hermes "我喜欢用 TypeScript"
- 用户关闭会话
- 第二天用户开启会话 B
- Hermes 自动回忆起用户偏好，主动确认："检测到您偏好 TypeScript，是否继续使用？"

**场景 2：错误模式学习**
- 智能体在会话 A 解决了一个棘手的端口冲突问题
- 解决方案自动写入记忆
- 下次遇到端口冲突时，智能体直接调用记忆找到解决方案，无需重新搜索

**场景 3：项目模式识别**
- 智能体在多个项目中发现 React + Vite 是常用组合
- 自动晋升为 pattern 记录
- 新项目自动推荐类似架构

### 1.3 核心特性

| 特性 | 描述 | 优先级 |
|---|---|---|
| Dual-Track Memory | Core（会话级）+ MCP（跨会话）双轨 | P0 |
| Knowledge Graph | 实体+关系知识图谱 | P0 |
| Step 0 Pre-check | 所有任务开始前自动查询 | P0 |
| memory-kernel skill | R/W/U 协议 | P0 |
| self-improvement skill | 自动学习晋升 | P0 |
| memory-recall skill | 跨会话记忆检索 | P1 |
| Memory Graph 可视化 | 前端 D3.js 图谱 | P1 |
| Memory List Panel | 实体列表+搜索 | P1 |

---

## 二、技术实现方案

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React)                                   │
│  ├── MemoryGraphView (D3.js)                        │
│  ├── MemoryListPanel                                │
│  ├── MemoryEditor                                   │
│  └── MemoryRecallButton (顶部入口)                    │
└─────────────────────────────────────────────────────┘
                       ↓ HTTP
┌─────────────────────────────────────────────────────┐
│  API Layer (FastAPI)                                │
│  ├── /api/memory/entities (CRUD)                    │
│  ├── /api/memory/relations (CRUD)                   │
│  ├── /api/memory/observations (CRUD)                │
│  ├── /api/memory/search (关键词)                     │
│  ├── /api/memory/graph (整图)                        │
│  ├── /api/memory/skill/memory-kernel (R/W/U)        │
│  ├── /api/memory/skill/self-improvement             │
│  └── /api/memory/health                             │
└─────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  Service Layer                                      │
│  ├── MemoryService (统一入口)                         │
│  ├── CoreMemoryStore (SQLite session_memory)        │
│  ├── MCPMemoryStore (JSONL 文件)                     │
│  ├── MemoryRouter (Step 0 Pre-check)                │
│  └── MemorySkills (memory-kernel, self-improvement) │
└─────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  Storage Layer                                      │
│  ├── SQLite: core_memory (会话级)                    │
│  ├── JSONL: mcp_memory/entities.jsonl              │
│  ├── JSONL: mcp_memory/relations.jsonl              │
│  └── JSONL: mcp_memory/observations.jsonl           │
└─────────────────────────────────────────────────────┘
```

### 2.2 数据模型

#### 2.2.1 MemoryEntity（跨会话实体）

```python
class MemoryEntity(BaseModel):
    name: str  # snake_case + 项目前缀，如 "project_hermes_arch"
    entity_type: str  # project / pattern / preference / profile / fact
    project: str  # 所属项目，"_global" 表示跨项目
    observations: List[str]  # [YYYY-MM-DD] xxx 格式
    metadata: Dict[str, Any]  # 额外属性
    created_at: datetime
    updated_at: datetime
```

#### 2.2.2 MemoryRelation（实体关系）

```python
class MemoryRelation(BaseModel):
    source: str  # 源实体 name
    target: str  # 目标实体 name
    relation_type: str  # depends_on / uses / solves / conflicts / extends
    weight: float  # 0.0-1.0，关系强度
    created_at: datetime
```

#### 2.2.3 MemoryObservation（观察记录）

```python
class MemoryObservation(BaseModel):
    entity_name: str
    content: str  # [YYYY-MM-DD] xxx 格式
    source: str  # user / agent / system
    confidence: float  # 0.0-1.0
    created_at: datetime
```

#### 2.2.4 CoreMemoryEntry（会话级）

```python
class CoreMemoryEntry(BaseModel):
    session_id: str
    key: str
    value: str
    scope: str  # session / agent / workflow
    expires_at: Optional[datetime]  # None = 会话结束失效
    created_at: datetime
```

### 2.3 Memory Router（Step 0 Pre-check）

**算法**：
```python
async def step0_precheck(task_context: TaskContext) -> Optional[MemoryContext]:
    """
    任务开始前的 Memory 优先查询
    返回值：相关 memory 上下文，若无则返回 None
    """
    # 1. 提取任务关键词
    keywords = extract_keywords(task_context)
    
    # 2. 优先查 MCP Memory（跨会话）
    mcp_results = await mcp_memory.search(keywords, limit=5)
    if mcp_results and mcp_results[0].confidence > 0.7:
        return MemoryContext(source="mcp", results=mcp_results)
    
    # 3. 降级到 Core Memory（会话级）
    core_results = await core_memory.search(task_context.session_id, keywords)
    if core_results:
        return MemoryContext(source="core", results=core_results)
    
    # 4. 无相关记忆，返回 None（由调用方决定是否全文件扫描）
    return None
```

### 2.4 memory-kernel Skill

**协议**：
```python
class MemoryKernelSkill:
    """
    R/W/U 协议 + 质量门控
    行为：
      - read: 读取实体/关系/observations
      - write: 创建/更新（必须通过质量门控）
      - update: 修改 observations
      - delete: 谨慎删除（需二次确认）
    """
    
    async def read(self, query: str) -> List[MemoryResult]:
        # 关键词搜索
        pass
    
    async def write(self, entity: MemoryEntity) -> WriteResult:
        # 质量门控：
        # 1. 必须有 [YYYY-MM-DD] 格式
        # 2. 跨会话有用
        # 3. 不包含 secrets
        # 4. 命名规范（snake_case + 前缀）
        if not self._pass_quality_gate(entity):
            return WriteResult(success=False, reason="quality_gate_failed")
        await mcp_memory.upsert_entity(entity)
        return WriteResult(success=True)
    
    async def update(self, name: str, observations: List[str]) -> UpdateResult:
        # 只追加，不覆盖
        pass
    
    async def delete(self, name: str, force: bool = False) -> DeleteResult:
        # public_-prefixed 实体不可删除
        if name.startswith("public_") and not force:
            return DeleteResult(success=False, reason="public_protected")
        await mcp_memory.delete_entity(name)
        return DeleteResult(success=True)
```

**Writing Standard**：
- 每条 observation 必须以 `[YYYY-MM-DD]` 开头
- 单条 observation 一句话，不超过 200 字
- 命名规范：`project_<name>_<sub>` 或 `pattern_<name>` 或 `preference_<name>`

**Quality Gate**：
- ✅ 项目架构、技术栈、关键设计决策
- ✅ 影响多文件的约定（命名、模式、工作流）
- ✅ 跨会话用户偏好
- ✅ 可复用解决方案、错误模式、根本原因
- ❌ 文件树结构（可重新扫描）
- ❌ 当前消息中已提供的信息
- ❌ 机密、token、密码、API 密钥

### 2.5 self-improvement Skill

**触发场景**：
- 主 agent 解决了一个新错误
- 错误模式被识别（≥ 3 次出现）
- 用户提供了新偏好

**算法**：
```python
async def self_improvement_check(error_solution: ErrorSolution):
    """
    检查是否值得晋升到长期记忆
    """
    # 1. 错误频率统计
    occurrences = await count_error_occurrences(error_solution.error_type)
    if occurrences < 3:
        return  # 频率不够
    
    # 2. 解决方案质量检查
    if not await verify_solution_works(error_solution):
        return
    
    # 3. 创建或更新 pattern 实体
    pattern_name = f"pattern_{slugify(error_solution.error_type)}"
    existing = await mcp_memory.get_entity(pattern_name)
    if existing:
        # 追加 observation
        await mcp_memory.add_observation(pattern_name, 
            f"[{today()}] {error_solution.summary}")
    else:
        # 新建实体
        await mcp_memory.create_entity(MemoryEntity(
            name=pattern_name,
            entity_type="pattern",
            project="_global",
            observations=[f"[{today()}] {error_solution.summary}"]
        ))
```

### 2.6 存储路径

**Core Memory（SQLite）**：
```python
# database.py 新增表
class CoreMemory(Base):
    __tablename__ = "core_memory"
    id: int
    session_id: str
    key: str
    value: str
    scope: str
    expires_at: Optional[datetime]
    created_at: datetime
```

**MCP Memory（JSONL）**：
```
~/.hermes/memory/
├── entities.jsonl        # 所有实体
├── relations.jsonl       # 所有关系
└── observations.jsonl    # 所有观察记录
```

---

## 三、接口设计

### 3.1 REST API

#### Entities
```
POST   /api/memory/entities          # 创建实体
GET    /api/memory/entities          # 列出实体（支持过滤）
GET    /api/memory/entities/{name}   # 查询实体
PUT    /api/memory/entities/{name}   # 更新实体
DELETE /api/memory/entities/{name}   # 删除实体
```

#### Relations
```
POST   /api/memory/relations         # 创建关系
GET    /api/memory/relations         # 列出关系
DELETE /api/memory/relations/{id}    # 删除关系
```

#### Observations
```
POST   /api/memory/observations      # 添加观察
DELETE /api/memory/observations/{id} # 删除观察
```

#### Search & Graph
```
GET    /api/memory/search?q=...      # 关键词搜索
GET    /api/memory/graph             # 整个图谱
```

#### Skills
```
POST   /api/memory/skill/memory-kernel      # 协议接口
POST   /api/memory/skill/self-improvement   # 晋升接口
POST   /api/memory/skill/memory-recall      # 检索接口
```

#### Health
```
GET    /api/memory/health            # 健康检查
GET    /api/memory/stats             # 统计信息
```

### 3.2 Pydantic Schema

```python
class CreateEntityRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=128, regex=r"^[a-z][a-z0-9_]+$")
    entity_type: Literal["project", "pattern", "preference", "profile", "fact"]
    project: str = Field(default="_global", max_length=128)
    observations: List[str] = Field(default_factory=list, max_items=20)
    metadata: Dict[str, Any] = Field(default_factory=dict)
```

```python
class EntityResponse(BaseModel):
    name: str
    entity_type: str
    project: str
    observations: List[Dict[str, Any]]  # 包含 created_at
    relations: List[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime
```

```python
class SearchResponse(BaseModel):
    results: List[EntityResponse]
    total: int
    query: str
    source: Literal["mcp", "core", "both"]
```

### 3.3 错误码

| 状态码 | 含义 | 示例 |
|---|---|---|
| 200 | 成功 | - |
| 400 | 请求参数错误 | name 不符合命名规范 |
| 404 | 实体不存在 | DELETE 不存在的实体 |
| 409 | 实体已存在 | POST 重复 name |
| 422 | 质量门控失败 | observations 缺少 [YYYY-MM-DD] |
| 500 | 服务异常 | JSONL 写入失败 |

---

## 四、数据结构定义

### 4.1 文件存储格式（JSONL）

**entities.jsonl**：
```json
{"name": "project_hermes_arch", "entity_type": "project", "project": "hermes", "created_at": "2026-07-28T10:00:00Z", "updated_at": "2026-07-28T10:00:00Z"}
```

**relations.jsonl**：
```json
{"id": "rel_001", "source": "project_hermes_arch", "target": "pattern_fastapi_async", "relation_type": "uses", "weight": 1.0, "created_at": "2026-07-28T10:00:00Z"}
```

**observations.jsonl**：
```json
{"id": "obs_001", "entity_name": "project_hermes_arch", "content": "[2026-07-28] 使用 FastAPI + SQLAlchemy 异步 + SQLite", "source": "agent", "confidence": 0.95, "created_at": "2026-07-28T10:00:00Z"}
```

### 4.2 内存索引

```python
class MemoryIndex:
    _entities: Dict[str, MemoryEntity]  # name -> entity
    _by_type: Dict[str, Set[str]]  # type -> set of names
    _by_project: Dict[str, Set[str]]  # project -> set of names
    _relations: List[MemoryRelation]
    _adjacency: Dict[str, List[MemoryRelation]]  # source -> relations
    _lock: RLock  # 线程安全
```

---

## 五、性能与安全要求

### 5.1 性能指标

| 指标 | 目标 | 验证方法 |
|---|---|---|
| 单实体查询 | < 10ms | 单元测试 |
| 关键词搜索 | < 100ms（1000 实体） | 单元测试 + 压测 |
| 整图序列化 | < 200ms | 单元测试 |
| 文件加载 | < 500ms（启动时） | 单元测试 |
| 并发写入 | 10 并发无丢失 | 单元测试 |
| 实体容量 | 100,000+ | 压测 |

### 5.2 安全要求

- **路径白名单**：JSONL 存储路径固定 `~/.hermes/memory/`
- **命名校验**：正则 `^[a-z][a-z0-9_]+$`，拒绝 `..` 和特殊字符
- **内容过滤**：quality_gate 拒绝 secrets/tokens/密码
- **public_ 保护**：`public_` 前缀实体不可删除
- **跨项目隔离**：修改实体前必须验证 project 匹配
- **线程安全**：所有 mutation 通过 RLock 保护

---

## 六、验收标准

### 6.1 后端功能

- [ ] Dual-Track Memory 完整实现（Core + MCP）
- [ ] memory-kernel skill R/W/U 协议
- [ ] self-improvement 自动触发逻辑
- [ ] memory-recall 跨会话检索
- [ ] 11 个 REST API 端点
- [ ] JSONL 存储 + 内存索引
- [ ] SQLite Core Memory 表
- [ ] 线程安全（RLock）

### 6.2 前端功能

- [ ] MemoryGraphView（D3.js 知识图谱）
- [ ] MemoryListPanel（实体列表 + 搜索）
- [ ] MemoryEditor（创建/编辑表单）
- [ ] MemoryRecallButton（顶部入口）
- [ ] 与 BrandHeader 集成
- [ ] TypeScript 0 errors

### 6.3 测试覆盖

- [ ] 单元测试 80+ 用例，覆盖：
  - 数据模型 CRUD
  - memory-kernel 协议
  - self-improvement 触发
  - 质量门控
  - 并发安全
  - 异常路径
- [ ] E2E 测试 50+ 断言，覆盖：
  - 完整 workflow（创建 → 检索 → 晋升）
  - 跨会话保留
  - 质量门控拒绝
  - public_ 保护
- [ ] 测试通过率 100%

### 6.4 浏览器实测

- [ ] 知识图谱可视化
- [ ] 实体搜索
- [ ] 创建/编辑/删除
- [ ] 跨会话保留验证（localStorage + API）

---

## 七、测试项目

### 7.1 自动化测试（脚本）

1. **单元测试**（`tests/test_memory_units.py`）
   - 测试 MemoryEntity / MemoryRelation / MemoryObservation 数据类
   - 测试 MCPMemoryStore 读写
   - 测试 CoreMemoryStore 读写
   - 测试 MemoryRouter Step 0 逻辑
   - 测试 memory-kernel R/W/U 协议
   - 测试 self-improvement 触发
   - 测试 quality_gate
   - 测试 public_ 保护
   - 测试命名校验
   - 测试并发安全

2. **E2E 测试**（`tests/test_e2e_memory.sh`）
   - 健康检查
   - 创建项目实体
   - 创建 pattern 实体
   - 添加观察
   - 搜索关键词
   - 列出图谱
   - 更新实体
   - 删除实体
   - 跨会话保留（创建 → 模拟重启 → 验证）
   - 质量门控拒绝
   - public_ 保护

### 7.2 前端网页测试（工具调用）

1. **MemoryGraphView**
   - 打开 /memory 路由
   - 验证图谱渲染
   - 点击节点查看详情
   - 拖动节点测试交互

2. **MemoryListPanel**
   - 实体列表显示
   - 搜索功能
   - 类型过滤

3. **MemoryEditor**
   - 创建实体表单
   - 编辑现有实体
   - 删除实体（带确认）

4. **MemoryRecallButton**
   - 顶部按钮点击
   - 弹出 recall 对话框
   - 输入查询词
   - 显示相关实体

### 7.3 验收通过标准

- 所有自动化测试 100% 通过
- 前端网页测试 4 个场景全部通过
- TypeScript 编译 0 errors
- 前端生产构建成功
- 性能指标达标
- 安全要求全部满足
