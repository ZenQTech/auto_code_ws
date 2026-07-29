# Cycle 14 P1-5: Goal Templates 模板库

> **版本**: v6.33.0  
> **日期**: 2026-07-29  
> **类型**: 新功能（spec 实现 + 前端 UI 集成）  
> **状态**: ✅ 已完成，测试通过率 100%（304 个测试 100% 通过）

---

## 1. 目标

为 Hermes 智能体调度平台添加 **Goal 模板库** 子系统，让用户可以：
- 浏览预定义的 6 类内置 Goal 模板
- Fork 内置模板到自己的项目
- 一键实例化模板为可执行 Goal（含 AC 列表 + 委派策略）
- 自定义/导入/导出模板
- 在 Auto-Turn 中复用模板驱动长时域任务

---

## 2. 实现概览

### 2.1 文件清单

| 文件 | 行数 | 作用 |
|---|---|---|
| `backend/app/core/goal_templates/models.py` | ~180 | 核心数据模型（GoalTemplate / AcceptanceCriterionTemplate / TemplateInstantiation） |
| `backend/app/core/goal_templates/manager.py` | ~830 | TemplateManager 管理器（CRUD / Fork / 实例化 / 导入导出 / 统计） |
| `backend/app/core/goal_templates/__init__.py` | ~30 | 模块入口 |
| `backend/app/api/goal_templates.py` | ~335 | 14 个 REST API 端点 |
| `frontend/src/hooks/useGoalTemplatesApi.ts` | ~270 | 前端 API 客户端（14 端点 + 类型） |
| `frontend/src/components/GoalTemplatesPanel.tsx` | ~640 | 前端 UI 面板（3 Tab + 详情弹窗 + 创建表单） |
| `frontend/src/pages/GoalTemplatesPage.tsx` | ~40 | 独立路由页面 |
| `tests/test_goal_templates_units.py` | ~770 | 60 个单元测试 |
| `tests/test_e2e_goal_templates.sh` | ~280 | 40 个后端 E2E 测试 |
| `tests/test_e2e_goal_templates_frontend.sh` | ~180 | 32 个前端 E2E 测试 |

**总计**: 10 个文件，~3,275 行（含测试）。

### 2.2 后端注册

`backend/app/main.py` 第 974-975 行：
```python
from .api.goal_templates import router as goal_templates_router
app.include_router(goal_templates_router, prefix="/api", tags=["goal-templates"])
```

API 前缀：`/api/goal-templates/*`

---

## 3. 核心功能

### 3.1 数据模型

```python
class TemplateCategory(str, Enum):
    DEVELOPMENT = "development"    # 软件开发
    RESEARCH = "research"          # 研究探索
    DOCUMENTATION = "documentation"  # 文档
    TESTING = "testing"            # 测试
    DEVOPS = "devops"              # 部署运维
    OTHER = "other"                # 其它

class TemplateSource(str, Enum):
    BUILTIN = "builtin"   # 系统内置（不可修改/删除）
    CUSTOM = "custom"     # 用户自定义

@dataclass
class GoalTemplate:
    template_id: str
    name: str
    description: str
    category: str
    source: str
    version: int              # 每次更新 +1
    tags: List[str]
    acceptance_criteria: List[AcceptanceCriterionTemplate]
    default_strategy: str     # conservative / standard / aggressive
    default_max_turns: int
    default_triggers: List[str]
    recommended_agents: List[str]
    estimated_duration_min: int
    instantiations: int       # 使用统计
    last_used_at: Optional[str]
    created_at / updated_at: str
    created_by: str
    metadata: Dict[str, Any]
```

### 3.2 内置模板（6 个）

| template_id | 类别 | 默认策略 | 默认 Agents | AC 数 |
|---|---|---|---|---|
| `tpl_builtin_feature_dev` | development | standard | architect, implementer, verifier | 5 |
| `tpl_builtin_bug_fix` | development | conservative | investigator, implementer, tester | 4 |
| `tpl_builtin_refactor` | development | standard | analyzer, refactorer, verifier | 4 |
| `tpl_builtin_research` | research | conservative | researcher, synthesizer, reviewer | 4 |
| `tpl_builtin_test_dev` | testing | standard | test-designer, implementer, verifier | 4 |
| `tpl_builtin_deployment` | devops | conservative | planner, executor, verifier | 5 |

每个内置模板都包含：
- 完整的 `acceptance_criteria`（AC 模板列表）
- `default_strategy`（推荐轮转策略）
- `recommended_agents`（推荐委派的 Agent 角色）
- `verify_items`（验证项示例）
- `estimated_duration_min`（预估时长）

### 3.3 14 个 REST API 端点

| Method | Path | 功能 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/stats` | 统计信息（模板数/实例化数/类别分布） |
| GET | `/templates` | 列出模板（支持 category/source/tag/keyword 过滤） |
| GET | `/templates/{template_id}` | 模板详情 |
| POST | `/templates` | 创建自定义模板 |
| PUT | `/templates/{template_id}` | 更新自定义模板 |
| DELETE | `/templates/{template_id}` | 注销自定义模板 |
| POST | `/templates/{template_id}/fork` | Fork 模板（生成可编辑副本） |
| POST | `/templates/{template_id}/instantiate` | 实例化模板为 Goal 配置 |
| GET | `/templates/{template_id}/export` | 导出模板 JSON |
| POST | `/templates/import` | 导入模板 JSON |
| GET | `/instantiations` | 实例化历史 |
| GET | `/meta/categories` | 类别枚举 |
| GET | `/meta/sources` | 来源枚举 |

### 3.4 实例化流程

```
用户选择模板
   ↓
POST /templates/{id}/instantiate {goal_id}
   ↓
TemplateManager.instantiate()
   ↓
生成 goal_config = {
   goal_id, title, description, category, tags,
   acceptance_criteria: [...AC 列表（含 ac_id, verify_items）],
   turn_config: {strategy, max_turns, triggers},
   recommended_agents: [...],
   template_id, template_version
}
   ↓
返回 {success, instantiation, goal_config}
   ↓
goal_config 可直接喂给 GoalManager.create_goal() 启动执行
```

---

## 4. 关键设计决策

### 4.1 内置模板保护

- **不可删除**：`unregister_template()` 检查 `is_builtin()` 后返回 False
- **不可修改**：`register_template()` 检测到已有 builtin 时，要求 `source` 也必须是 builtin，否则抛 ValueError
- **可 Fork**：调用 `fork_template()` 生成新 ID + 改 source 为 custom

### 4.2 版本管理

每次 `register_template()` 更新已存在模板时，`version` 自增 1，`created_at` 保持不变，`instantiations` 和 `last_used_at` 累积保留。

### 4.3 持久化

模板数据持久化到 JSONL（`templates.jsonl`），每行一个 JSON 对象。实例化历史持久化到 `instantiations.jsonl`。

### 4.4 线程安全

`TemplateManager` 使用 `threading.RLock()` 保护所有读写操作，支持并发访问。

### 4.5 名称验证

`_NAME_PATTERN = ^[\w\s\-./()（）[\]【】]{1,128}$` (Unicode)  
允许中英文/数字/常见符号/空格，最长 128 字符。

`_TAG_PATTERN = ^[\w\-./]{1,32}$` (Unicode)  
标签只允许字母数字/中划线/下划线/点/斜杠。

---

## 5. 测试覆盖

### 5.1 单元测试（60 个）

| 测试类 | 测试数 | 覆盖内容 |
|---|---|---|
| `TestDataModels` | 6 | GoalTemplate / AcceptanceCriterionTemplate / Instantiation 序列化 |
| `TestValidation` | 5 | 名称/标签/类别验证 |
| `TestBuiltinTemplates` | 3 | 内置模板自动加载 |
| `TestTemplateCRUD` | 11 | 注册/更新/注销/边界 |
| `TestTemplateFork` | 5 | Fork 内置/自定义/带参数 |
| `TestTemplateInstantiate` | 6 | 实例化 + 历史 + 过滤 |
| `TestTemplateListFilter` | 6 | category/source/tag/keyword/排序 |
| `TestTemplateImportExport` | 4 | 导出/导入 |
| `TestTemplateStats` | 4 | 统计/健康检查 |
| `TestGlobalSingleton` | 2 | 全局单例 |
| `TestAPIRoutes` | 3 | 路由注册 |
| `TestIntegration` | 2 | 端到端工作流 + 并发 |

**结果**: `60 passed in 1.08s` ✅

### 5.2 E2E 测试（40 个）

| 分组 | 测试数 | 覆盖 |
|---|---|---|
| 健康检查/统计 | 4 | 端点可达性 |
| 列表/过滤 | 6 | 4 种过滤维度 |
| 详情/404 | 3 | 错误路径 |
| CRUD | 7 | 创建/更新/删除 + 校验 |
| Fork | 3 | Fork 内置模板 |
| 实例化 | 4 | 实例化 + Goal config |
| 导入/导出 | 3 | 模板迁移 |
| 实例化历史 | 2 | 历史 + 过滤 |
| Meta | 4 | 枚举端点 |
| 清理 | 2 | 资源回收 |

**结果**: `Total: 40 | Pass: 40 | Fail: 0` ✅

### 5.3 前端 E2E 测试（32 个）

| 分组 | 测试数 | 覆盖 |
|---|---|---|
| 服务可用性 | 2 | 前端 + 后端 |
| 模板列表 | 2 | Browse Tab 数据源 |
| 类别过滤 | 6 | 6 个类别 |
| 来源过滤 | 2 | builtin + custom |
| Meta 端点 | 4 | 类别 + 来源枚举 |
| 详情 | 2 | 详情 API |
| 统计 | 3 | StatsBar 数据 |
| 历史 | 2 | History Tab |
| Fork | 2 | Fork 流程 |
| 实例化 | 2 | 实例化流程 |
| 创建 | 2 | Create Tab |
| 清理 | 2 | 资源回收 |

**结果**: `Total: 32 | Pass: 32 | Fail: 0` ✅

### 5.4 TypeScript 编译

`tsc --noEmit`：**0 错误** ✅

---

## 6. 关键代码片段

### 6.1 自动生成 template_id

```python
def register_template(self, tpl: GoalTemplate) -> GoalTemplate:
    with self._lock:
        # ... 验证 ...
        if not tpl.acceptance_criteria:
            raise ValueError("acceptance_criteria must not be empty")
        
        # 新增模板时自动生成 ID
        if not tpl.template_id:
            tpl.template_id = f"tpl_{uuid.uuid4().hex[:8]}"
        
        existing = self._templates.get(tpl.template_id)
        if existing and existing.is_builtin():
            if tpl.source != TemplateSource.BUILTIN.value:
                raise ValueError(
                    f"Cannot modify builtin template {tpl.template_id}; please fork first"
                )
            return existing
        # ...
```

### 6.2 实例化生成 goal_config

```python
goal_config = {
    "goal_id": actual_goal_id,
    "title": tpl.name,
    "description": tpl.description,
    "category": tpl.category,
    "tags": list(tpl.tags),
    "acceptance_criteria": [ac.to_dict() for ac in tpl.acceptance_criteria],
    "turn_config": {
        "strategy": tpl.default_strategy,
        "max_turns": tpl.default_max_turns,
        "triggers": list(tpl.default_triggers),
    },
    "recommended_agents": list(tpl.recommended_agents),
    "template_id": template_id,
    "template_version": tpl.version,
}
```

### 6.3 Fork 模板

```python
def fork_template(self, template_id, new_name=None, new_tags=None):
    with self._lock:
        original = self._templates.get(template_id)
        if not original:
            return None
        
        # 深度复制 AC 列表（每个 ac_id 重新生成）
        forked_acs = [
            AcceptanceCriterionTemplate(
                ac_id=f"ac_{uuid.uuid4().hex[:8]}",
                title=ac.title,
                description=ac.description,
                priority=ac.priority,
                ac_type=ac.ac_type,
                risk_level=ac.risk_level,
                verify_items=list(ac.verify_items),
            )
            for ac in original.acceptance_criteria
        ]
        
        forked = GoalTemplate(
            template_id=f"tpl_{uuid.uuid4().hex[:8]}",
            name=new_name or f"{original.name} (Copy)",
            description=original.description,
            category=original.category,
            source=TemplateSource.CUSTOM.value,  # Fork 后变 custom
            tags=list(new_tags or original.tags) + ["forked"],
            acceptance_criteria=forked_acs,
            # ... 继承其它配置 ...
        )
        return forked
```

---

## 7. 集成路径

### 7.1 与 GoalManager 集成

`goal_config` 中的 `acceptance_criteria` 字段直接喂给 `GoalManager.create_goal()` 即可创建 Goal：

```python
# 用户调用流程
template = api.get_template("tpl_builtin_feature_dev")
result = api.instantiate_template("tpl_builtin_feature_dev", goal_id="goal_001")
goal_config = result["goal_config"]
goal = goal_manager.create_goal(goal_config)  # 已有方法
```

### 7.2 与 AutoTurnEngine 集成

```python
# 注册 Goal 到自动轮转
turn_config = TurnConfig(
    goal_id=goal_config["goal_id"],
    strategy=goal_config["turn_config"]["strategy"],
    max_turns=goal_config["turn_config"]["max_turns"],
    triggers=goal_config["turn_config"]["triggers"],
)
auto_turn_engine.register_goal(turn_config)
```

### 7.3 与 MultiAgentDelegator 集成

```python
# 委派 Agent 执行 AC
for ac in goal_config["acceptance_criteria"]:
    decision = delegator.delegate(
        goal_id=goal_config["goal_id"],
        ac_id=ac["ac_id"],
        ac_type=ac["ac_type"],
        risk_level=ac["risk_level"],
        preferred_role=ac.get("recommended_role", "implementer"),
    )
```

---

## 8. 修复记录

### 8.1 名称验证支持中文

**问题**: `_NAME_PATTERN` 最初只允许 `A-Za-z0-9_.-`，拒绝中文。  
**修复**: 改为 `^[\w\s\-./()（）[\]【】]{1,128}$` (Unicode)。  
**验证**: 60 单元测试 + 40 E2E 测试中包含中文名称用例。

### 8.2 自动生成 template_id

**问题**: API 端点创建模板时 `template_id=""` 不会自动生成，导致返回 `template_id=""`。  
**修复**: `register_template()` 中添加 `if not tpl.template_id: tpl.template_id = f"tpl_{uuid.uuid4().hex[:8]}"`。  
**验证**: E2E 9.2 测试现在能正确获取新 ID。

### 8.3 单元测试 test_modify_builtin_fails

**问题**: 测试直接修改了 `get_template()` 返回的引用，导致原模板被污染。  
**修复**: 测试改为先 `copy.deepcopy()` 再修改，保证原模板不变。

---

## 9. 下一步

- ✅ **Cycle 14 Phase 5 UI/UX 优化**: 已完成 `GoalTemplatesPanel.tsx` 前端组件 + 独立路由 + 菜单入口
- **Cycle 14 Phase 6 Loop Engineering 工作流验证**: 端到端测试模板驱动 Goal 流程
- **Cycle 14 Phase 7 循环重启准备**: 维护迭代日志

---

## 11. 前端 UI 集成

### 11.1 组件层级

```
router.tsx (lazy load)
   ↓ /goal-templates
GoalTemplatesPage (pages/GoalTemplatesPage.tsx)
   ↓
GoalTemplatesPanel (components/GoalTemplatesPanel.tsx)
   ├─ StatsBar (4 个统计)
   ├─ 3 Tab
   │   ├─ Browse: TemplateCard 网格 + 过滤栏
   │   ├─ Create: 完整表单（名称/描述/类别/标签/AC 列表）
   │   └─ History: 实例化历史表格
   └─ TemplateDetailModal (详情弹窗)
       ├─ Meta 概览
       ├─ AC 列表
       ├─ Fork 操作
       ├─ Instantiate 操作
       └─ Delete 操作 (仅 custom)
```

### 11.2 菜单入口

`BrandHeader.tsx` 添加"📚 Goal 模板库"按钮，与"🎯 Goal Automation"并列。

### 11.3 关键设计决策

- **3 Tab 平铺**：Browse（浏览）+ Create（创建）+ History（历史），与 GoalAutomationPanel 保持一致
- **颜色编码**：类别有专属颜色（development=蓝，research=紫，documentation=琥珀，testing=翠绿，devops=玫瑰，other=灰）
- **详情弹窗统一操作入口**：Fork / Instantiate / Delete 都在弹窗内，避免页面跳转
- **AC 列表动态编辑**：Create Tab 中可增删 AC 列表，实时调整 priority/risk_level
- **TypeScript 零错误**：所有 9 个数据模型明确定义，编译通过

---

## 10. 相关文件

- Spec: `.trae/specs/cycle14/goal-automation/spec.md`
- 后端核心: `backend/app/core/goal_templates/`
- 后端 API: `backend/app/api/goal_templates.py`
- 前端 Hook: `frontend/src/hooks/useGoalTemplatesApi.ts`
- 前端组件: `frontend/src/components/GoalTemplatesPanel.tsx`
- 前端页面: `frontend/src/pages/GoalTemplatesPage.tsx`
- 路由注册: `frontend/src/router/router.tsx`
- 菜单入口: `frontend/src/components/BrandHeader.tsx`
- 单元测试: `tests/test_goal_templates_units.py`
- 后端 E2E: `tests/test_e2e_goal_templates.sh`
- 前端 E2E: `tests/test_e2e_goal_templates_frontend.sh`
- 代码修改日志: `代码修改日志.md`
