# Cycle 14 P0-3: 企业级 Plugin Hub 设计与实现

> **Cycle**: 14  
> **优先级**: P0-3  
> **类型**: 后端核心模块 + 前端 UI  
> **状态**: 🚧 开发中  
> **版本**: v6.28.0  
> **开始时间**: 2026-07-28

---

## 一、需求描述

### 1.1 业务背景

参考 **OpenAI Codex for (almost) everything 2026-04** 和 **TRAE Enterprise** 的企业级 Plugin Hub 能力，本任务为 Hermes 平台引入完整的企业级 Plugin 管理体系。当前已有基础 Marketplace（13 个插件），但缺少：

- 90+ 插件的企业级目录
- 团队/组织的多租户管理
- Cost Control（按团队/项目计费）
- Productivity Dashboard（生产力分析）
- SOC2 合规（审计日志、安全策略）
- RBAC 权限模型
- 审批工作流

### 1.2 核心目标

- ✅ **企业目录**：90+ 插件，按 12 个分类组织
- ✅ **三层架构**：官方仓库 / 社区仓库 / 本地私有
- ✅ **团队管理**：组织/团队/成员三级模型
- ✅ **Cost Control**：配额/计费/告警
- ✅ **Productivity Dashboard**：使用统计/活跃度/ROI 分析
- ✅ **SOC2 合规**：审计日志/数据驻留/加密
- ✅ **RBAC 权限**：Admin/Manager/Developer/Viewer
- ✅ **审批流**：企业插件安装审批
- ✅ **REST API**：≥ 30 个端点

### 1.3 用户场景

| 场景 | 描述 | 涉及功能 |
| --- | --- | --- |
| 企业管理员配置 | 设置团队/成员/权限 | 团队管理 + RBAC |
| 开发者浏览市场 | 浏览/搜索/安装 90+ 插件 | 目录 + 搜索 + 安装 |
| 团队 Lead 审批 | 审查安装请求 | 审批工作流 |
| 财务 Cost 控制 | 设置预算/查看花费 | Cost Control |
| 安全审计 | 查看所有操作 | 审计日志 + SOC2 |
| 决策 Productivity | 分析团队效率 | Dashboard |

---

## 二、技术实现方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│              Enterprise Plugin Hub (v6.28.0)                 │
├─────────────────────────────────────────────────────────────┤
│  Plugin Catalog (90+)   │  Team Management   │  RBAC        │
│  - Official             │  - Organizations    │  - Admin     │
│  - Community            │  - Teams            │  - Manager   │
│  - Local Private        │  - Members          │  - Developer │
│                         │                     │  - Viewer    │
├─────────────────────────────────────────────────────────────┤
│  Cost Control            │  Productivity        │  SOC2       │
│  - Quotas               │  - Usage Stats       │  - Audit    │
│  - Billing              │  - Activity          │  - Security │
│  - Alerts               │  - ROI               │  - Compliance│
├─────────────────────────────────────────────────────────────┤
│              Existing Plugin System (v6.18)                   │
│  - Plugin Base / Loader / Registry / Validator / Installer  │
│  - Marketplace (13 plugins baseline)                          │
├─────────────────────────────────────────────────────────────┤
│              Storage Layer (File System + JSON Index)         │
│  /tmp/hermes_enterprise_hub/                                 │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 数据模型 (models.py)

```python
@dataclass
class Organization:
    org_id: str
    name: str
    plan: str  # free/pro/enterprise
    owner: str
    created_at: str
    settings: Dict[str, Any]
    quotas: Dict[str, Any]

@dataclass
class Team:
    team_id: str
    org_id: str
    name: str
    description: str
    members: List[str]
    budget_usd: float
    created_at: str

@dataclass
class Member:
    member_id: str
    org_id: str
    email: str
    role: str  # admin/manager/developer/viewer
    teams: List[str]
    joined_at: str
    last_active: Optional[str]

@dataclass
class PluginCatalogItem:
    """扩展 Marketplace 插件：增加企业级元数据"""
    plugin_id: str
    name: str
    version: str
    source: str  # official/community/local
    category: str
    vendor: str
    license: str
    description: str
    long_description: str
    icon_url: str
    screenshots: List[str]
    tags: List[str]
    pricing_model: str  # free/paid/usage_based
    price_usd: float
    enterprise_ready: bool
    soc2_compliant: bool
    data_residency: List[str]  # ["us", "eu", "asia"]
    permissions_required: List[str]
    downloads: int
    rating: float
    rating_count: int
    install_commands: int
    last_updated: str
    verified: bool
    signature: str

@dataclass
class ApprovalRequest:
    request_id: str
    plugin_id: str
    requested_by: str
    team_id: str
    reason: str
    status: str  # pending/approved/rejected
    reviewed_by: Optional[str]
    reviewed_at: Optional[str]
    review_comment: Optional[str]
    created_at: str

@dataclass
class CostRecord:
    record_id: str
    org_id: str
    team_id: Optional[str]
    plugin_id: str
    member_id: str
    usage_count: int
    cost_usd: float
    period: str  # YYYY-MM
    created_at: str

@dataclass
class AuditLog:
    log_id: str
    org_id: str
    actor: str
    action: str  # install/uninstall/approve/role_change/config_update
    target: str  # plugin_id, team_id, etc.
    metadata: Dict[str, Any]
    ip_address: Optional[str]
    user_agent: Optional[str]
    created_at: str

@dataclass
class DashboardSnapshot:
    snapshot_id: str
    org_id: str
    period: str
    total_plugins: int
    active_plugins: int
    total_installs: int
    active_users: int
    top_plugins: List[Dict[str, Any]]
    usage_by_category: Dict[str, int]
    cost_summary: Dict[str, float]
    productivity_score: float
    generated_at: str
```

#### 2.2.2 核心模块

```
backend/app/core/enterprise_hub/
├── __init__.py
├── models.py           # 数据模型
├── catalog.py          # 90+ 插件目录
├── teams.py            # 团队管理
├── rbac.py             # 角色权限
├── cost_control.py     # 成本控制
├── approvals.py        # 审批工作流
├── audit.py            # 审计日志 + SOC2
├── dashboard.py        # 生产力分析
├── manager.py          # 统一管理入口
└── api.py              # REST API (≥ 30 端点)
```

#### 2.2.3 90+ 插件目录

按 12 个分类组织：
1. **AI/ML**: 25+ 插件（Code Generation, Code Review, Testing AI, etc.）
2. **DevOps/CI-CD**: 15+ 插件（Jenkins, GitHub Actions, GitLab CI, etc.）
3. **Code Quality**: 10+ 插件（SonarQube, ESLint, Prettier, etc.）
4. **Testing**: 10+ 插件（Selenium, Cypress, Jest, etc.）
5. **Security**: 10+ 插件（Snyk, OWASP, Trivy, etc.）
6. **Monitoring**: 8+ 插件（Prometheus, Grafana, Datadog, etc.）
7. **Database**: 5+ 插件（Postgres Tools, Redis CLI, etc.）
8. **Documentation**: 5+ 插件（Swagger, JSDoc, etc.）
9. **Communication**: 3+ 插件（Slack, Teams, Discord, etc.）
10. **Version Control**: 5+ 插件（Git, GitHub, GitLab, etc.）
11. **Project Management**: 3+ 插件（Jira, Trello, Asana, etc.）
12. **Productivity**: 5+ 插件（Calendar, Notes, Todo, etc.）

总计 ≥ 90 个插件

### 2.3 端点设计（≥ 30 个）

#### 健康与统计
- GET  /api/enterprise-hub/health
- GET  /api/enterprise-hub/stats

#### 插件目录（扩展现有 Marketplace）
- GET  /api/enterprise-hub/catalog - 列出所有插件
- GET  /api/enterprise-hub/catalog/featured - 推荐插件
- GET  /api/enterprise-hub/categories - 分类列表
- GET  /api/enterprise-hub/catalog/{id} - 插件详情

#### 团队管理
- POST   /api/enterprise-hub/orgs - 创建组织
- GET    /api/enterprise-hub/orgs - 列出组织
- GET    /api/enterprise-hub/orgs/{id} - 组织详情
- POST   /api/enterprise-hub/orgs/{id}/teams - 创建团队
- GET    /api/enterprise-hub/orgs/{id}/teams - 列出团队
- POST   /api/enterprise-hub/orgs/{id}/members - 邀请成员
- GET    /api/enterprise-hub/orgs/{id}/members - 列出成员

#### RBAC
- PUT    /api/enterprise-hub/orgs/{org_id}/members/{member_id}/role - 更新角色
- GET    /api/enterprise-hub/orgs/{org_id}/permissions - 权限查询

#### 成本控制
- POST   /api/enterprise-hub/orgs/{id}/quotas - 设置配额
- GET    /api/enterprise-hub/orgs/{id}/quotas - 查看配额
- POST   /api/enterprise-hub/cost/records - 记录使用
- GET    /api/enterprise-hub/orgs/{id}/cost/summary - 成本摘要
- GET    /api/enterprise-hub/orgs/{id}/cost/breakdown - 成本明细

#### 审批流
- POST   /api/enterprise-hub/approvals - 创建审批
- GET    /api/enterprise-hub/approvals - 列出审批
- POST   /api/enterprise-hub/approvals/{id}/approve - 批准
- POST   /api/enterprise-hub/approvals/{id}/reject - 拒绝

#### 审计日志 (SOC2)
- GET    /api/enterprise-hub/audit/logs - 查询审计日志
- GET    /api/enterprise-hub/audit/export - 导出审计报告
- POST   /api/enterprise-hub/audit/security-event - 记录安全事件

#### Dashboard
- GET    /api/enterprise-hub/dashboard/{org_id} - 生产力仪表盘
- GET    /api/enterprise-hub/dashboard/{org_id}/top-plugins
- GET    /api/enterprise-hub/dashboard/{org_id}/productivity

### 2.4 安全设计

- **路径白名单**：仅允许 `HERMES_HUB_DIR` 指定目录
- **RBAC 检查**：所有管理操作需要角色校验
- **审计日志**：所有写操作记录
- **SOC2 合规**：数据驻留 + 加密 + 访问控制
- **审批工作流**：高风险操作需要审批

---

## 三、验收标准

### 3.1 功能验收

- ✅ 90+ 插件目录（按 12 分类）
- ✅ 团队管理（组织/团队/成员）
- ✅ RBAC 权限（4 种角色）
- ✅ 成本控制（配额/记录/摘要）
- ✅ 审批工作流（创建/批准/拒绝）
- ✅ 审计日志（所有操作）
- ✅ Dashboard（统计/排行/ROI）
- ✅ SOC2 合规（数据驻留 + 加密）
- ✅ ≥ 30 个 REST API 端点

### 3.2 测试覆盖
- 单元测试 ≥ 80 个
- E2E 测试 ≥ 50 个断言
- 测试通过率 100%

---

## 四、任务清单

### 后端
1. ✅ Spec 文档
2. ⏳ 数据模型
3. ⏳ 插件目录（90+ 插件）
4. ⏳ 团队管理
5. ⏳ RBAC
6. ⏳ 成本控制
7. ⏳ 审批工作流
8. ⏳ 审计日志
9. ⏳ Dashboard
10. ⏳ REST API
11. ⏳ 注册路由

### 测试
12. ⏳ 单元测试
13. ⏳ E2E 测试
14. ⏳ 运行测试

### 前端
15. ⏳ API 客户端
16. ⏳ Hub 面板
17. ⏳ Dashboard
18. ⏳ 菜单集成

### 文档
19. ⏳ 更新代码修改日志
20. ⏳ 编写 CYCLE14_P0_3_SUMMARY.md

---

**文档版本**: v1.0.0  
**最后更新**: 2026-07-28
