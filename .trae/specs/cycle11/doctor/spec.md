# P2-2 Hermes Doctor - 环境诊断系统

> **任务 ID**: P2-2
> **关联阶段**: Cycle 11 - 功能补齐（Phase 7.5-7.6）
> **优先级**: P2（中）
> **版本**: v1.0.0 → v6.15.0
> **日期**: 2026-07-28
> **状态**: 📝 设计阶段
> **参考基准**: Codex v0.135.0 `codex doctor` 命令

---

## 一、目标与背景

### 1.1 问题陈述

当前 Hermes 平台在用户遇到问题（API 调用失败、命令执行异常、文件读取错误）时缺乏自助诊断工具：

- **环境变量缺失**：ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL 未配置时错误信息不直观
- **依赖版本不匹配**：Node.js / Python / Git 版本不满足要求时无提示
- **数据库连接异常**：SQLite / PostgreSQL 失败时仅返回 500 错误
- **MCP 服务器不可用**：mcp.json 中配置的 server 启动失败时无法定位原因
- **磁盘空间 / 内存 / CPU 资源耗尽**：执行大任务时静默失败

用户每次都需要查看日志或联系管理员，自助排查效率低。

### 1.2 目标

实现完整的 Hermes Doctor 环境诊断系统：

1. **6 大类诊断**：
   - Environment（环境变量 / Shell 工具 / OS 信息）
   - Workspace（工作区状态 / Git 仓库 / .trae 配置）
   - LLM（API 可达性 / 模型可用性 / Token 预算）
   - Database（连接 / 迁移 / 表结构）
   - MCP（服务器配置 / 启动状态 / 协议版本）
   - Dependencies（运行时依赖版本 / 第三方包）

2. **4 种输出模式**：
   - `--summary`：人类可读概览（默认）
   - `--json`：机器可读结构化
   - `--all`：完整报告（所有检查项）
   - `--no-color`：禁用 ANSI 颜色

3. **自动修复建议**：每个 ❌ 项提供具体修复命令或操作步骤

4. **反馈报告集成**：诊断结果可一键反馈到后端，辅助远程排查

5. **独立可执行 CLI**：`hermes doctor` 命令无需启动后端服务即可运行

### 1.3 范围

**In Scope**：
- 6 大类诊断项的实现
- 4 种输出模式
- 自动修复建议生成
- REST API 端点
- 前端 DoctorPanel 组件
- 单元测试 + E2E 测试
- 总结报告 + Git 提交

**Out of Scope**：
- 自动修复执行（仅提供建议）
- 跨机器诊断（仅本机）
- 历史诊断对比（仅当前）

---

## 二、技术实现方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Hermes Doctor 系统架构                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CLI Layer                                                  │
│  ┌──────────────────────┐    ┌──────────────────────┐      │
│  │ hermes doctor        │    │ hermes doctor --json │      │
│  │ (人类可读)            │    │ (机器可读)            │      │
│  └──────────┬───────────┘    └──────────┬───────────┘      │
│             │                            │                   │
│  ┌──────────▼────────────────────────────▼────────────┐     │
│  │              DoctorRunner (统一调度)                │     │
│  └──────────┬─────────────────────────────────────────┘     │
│             │                                                │
│  ┌──────────▼──────────────────────────────────────────┐    │
│  │              6 大类诊断器（并行执行）                 │    │
│  │  EnvironmentChecker  WorkspaceChecker               │    │
│  │  LLMChecker         DatabaseChecker                │    │
│  │  MCPChecker         DependenciesChecker             │    │
│  └──────────┬──────────────────────────────────────────┘    │
│             │                                                │
│  ┌──────────▼──────────────────────────────────────────┐    │
│  │              FixAdvisor (修复建议生成)               │    │
│  └──────────┬──────────────────────────────────────────┘    │
│             │                                                │
│  ┌──────────▼──────────────────────────────────────────┐    │
│  │              ReportFormatter (4 种格式)             │    │
│  │  SummaryFormatter  JSONFormatter                   │    │
│  │  FullFormatter    PlainFormatter                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  REST API Layer                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  GET  /api/doctor/run        - 运行完整诊断         │    │
│  │  GET  /api/doctor/{category} - 单项诊断             │    │
│  │  POST /api/doctor/feedback   - 反馈诊断结果         │    │
│  │  GET  /api/doctor/history    - 历史报告             │    │
│  │  GET  /api/doctor/health     - 健康检查             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Frontend Layer                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  DoctorPanel.tsx (诊断面板)                         │    │
│  │  DoctorCategoryCard.tsx (分类卡片)                  │    │
│  │  DoctorFixSuggestion.tsx (修复建议)                 │    │
│  │  DoctorHistoryView.tsx (历史报告)                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据模型

#### CheckItem（单个检查项）

```python
@dataclass
class CheckItem:
    """单个诊断检查项"""
    id: str                    # "env.anthropic_api_key"
    name: str                  # "ANTHROPIC_API_KEY"
    category: str              # "environment" / "workspace" / ...
    description: str           # "Anthropic API 密钥"
    status: str                # "ok" / "warning" / "error" / "skipped"
    value: Optional[str]       # 当前值（脱敏后）
    expected: Optional[str]    # 期望值描述
    message: str               # 人类可读消息
    fix_suggestion: Optional[str]  # 修复建议
    duration_ms: int           # 检查耗时
    details: Dict[str, Any]    # 扩展信息
```

#### CategoryReport（分类报告）

```python
@dataclass
class CategoryReport:
    """单类诊断报告"""
    category: str              # "environment"
    title: str                 # "环境变量"
    total_checks: int          # 总检查项数
    ok_count: int
    warning_count: int
    error_count: int
    skipped_count: int
    duration_ms: int           # 分类总耗时
    items: List[CheckItem]     # 检查项列表
    overall_status: str        # "ok" / "warning" / "error"
```

#### DoctorReport（总报告）

```python
@dataclass
class DoctorReport:
    """完整诊断报告"""
    report_id: str             # "doc_20260728_xxx"
    timestamp: str             # ISO 8601
    hostname: str              # 主机名
    hermes_version: str
    duration_ms: int           # 总耗时
    categories: Dict[str, CategoryReport]
    summary: Dict[str, int]    # {"ok": 25, "warning": 3, "error": 2}
    overall_status: str        # "ok" / "warning" / "error"
```

### 2.3 6 大类诊断器

#### EnvironmentChecker（环境检查）

| 检查项 | 描述 | 修复建议 |
|---|---|---|
| `env.python_version` | Python ≥ 3.10 | 升级 Python: `sudo apt install python3.11` |
| `env.node_version` | Node.js ≥ 18.0 | 升级 Node: `nvm install 18` |
| `env.git_version` | Git ≥ 2.30 | 升级 Git: `sudo apt install git` |
| `env.os` | Linux/macOS/WSL | 不支持 Windows 原生 |
| `env.shell` | bash / zsh | fish / powershell 需配置 |
| `env.encoding` | UTF-8 编码 | 设置 `export LANG=en_US.UTF-8` |
| `env.anthropic_api_key` | ANTHROPIC_API_KEY 已设置 | `export ANTHROPIC_API_KEY=sk-...` |
| `env.anthropic_base_url` | ANTHROPIC_BASE_URL 可达 | 检查网络或代理 |
| `env.home_dir` | $HOME 可写 | 检查权限: `chmod 755 $HOME` |
| `env.hermes_home` | ~/.hermes 已初始化 | 运行 `hermes init` |

#### WorkspaceChecker（工作区检查）

| 检查项 | 描述 | 修复建议 |
|---|---|---|
| `workspace.current_path` | 当前在 git 仓库内 | `cd <project>` |
| `workspace.git_status` | git status 干净 | `git stash` 或 `git commit` |
| `workspace.remote` | origin 远程已配置 | `git remote add origin <url>` |
| `workspace.trae_dir` | .trae/ 目录存在 | 运行 `hermes init` |
| `workspace.agents_md` | AGENTS.md 存在 | 创建 AGENTS.md |
| `workspace.specs_dir` | .trae/specs/ 存在 | 创建 specs 目录 |
| `workspace.disk_space` | 剩余空间 ≥ 1GB | 清理: `docker system prune` |
| `workspace.file_count` | 文件数 < 100k | 排除 node_modules/ |

#### LLMChecker（LLM API 检查）

| 检查项 | 描述 | 修复建议 |
|---|---|---|
| `llm.api_reachable` | API base URL 可达 | 检查 ANTHROPIC_BASE_URL |
| `llm.api_latency` | 响应时间 < 3s | 切换更近的 region |
| `llm.models_available` | claude-3-5-sonnet 可用 | 升级 API 套餐 |
| `llm.token_quota` | 配额 > 20% | 等待配额重置或升级 |
| `llm.streaming` | SSE 流式支持 | 切换支持 SSE 的网关 |
| `llm.tool_use` | function calling 支持 | 升级到支持 tool use 的模型 |

#### DatabaseChecker（数据库检查）

| 检查项 | 描述 | 修复建议 |
|---|---|---|
| `db.connection` | DB 可连接 | 检查 DATABASE_URL |
| `db.migration` | alembic 迁移最新 | `alembic upgrade head` |
| `db.tables` | 核心表存在 | `alembic upgrade head` |
| `db.indexes` | 索引已创建 | `alembic upgrade head` |
| `db.size` | DB 大小 < 1GB | 归档历史数据 |
| `db.wal_mode` | SQLite WAL 启用 | 迁移到 PostgreSQL |

#### MCPChecker（MCP 服务器检查）

| 检查项 | 描述 | 修复建议 |
|---|---|---|
| `mcp.config_exists` | mcp.json 存在 | 创建 ~/.hermes/mcp.json |
| `mcp.config_valid` | JSON 格式正确 | 用 `jq` 验证 |
| `mcp.servers_declared` | 服务器列表非空 | 添加 MCP server |
| `mcp.servers_reachable` | 服务器进程可启动 | 检查 command 路径 |
| `mcp.protocol_version` | 协议版本兼容 | 升级 mcp 库 |
| `mcp.tools_listed` | tools/list 可用 | 检查服务器日志 |

#### DependenciesChecker（依赖检查）

| 检查项 | 描述 | 修复建议 |
|---|---|---|
| `deps.fastapi` | fastapi ≥ 0.100 | `pip install fastapi --upgrade` |
| `deps.sqlalchemy` | sqlalchemy ≥ 2.0 | `pip install sqlalchemy --upgrade` |
| `deps.httpx` | httpx ≥ 0.24 | `pip install httpx --upgrade` |
| `deps.pydantic` | pydantic ≥ 2.0 | `pip install pydantic --upgrade` |
| `deps.uvicorn` | uvicorn ≥ 0.23 | `pip install uvicorn --upgrade` |
| `deps.frontend_node_modules` | node_modules 已安装 | `npm install` |
| `deps.dist_exists` | frontend/dist/ 存在 | `npm run build` |

### 2.4 并行执行

使用 `concurrent.futures.ThreadPoolExecutor` 并行执行 6 大类检查，缩短诊断时间：

```python
def run_all(self) -> DoctorReport:
    """并行执行所有诊断"""
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(self.checkers['environment'].run): 'environment',
            executor.submit(self.checkers['workspace'].run): 'workspace',
            executor.submit(self.checkers['llm'].run): 'llm',
            executor.submit(self.checkers['database'].run): 'database',
            executor.submit(self.checkers['mcp'].run): 'mcp',
            executor.submit(self.checkers['dependencies'].run): 'dependencies',
        }
        categories = {}
        for future in as_completed(futures):
            category = futures[future]
            try:
                categories[category] = future.result()
            except Exception as e:
                categories[category] = self._error_category(category, e)
    return self._build_report(categories)
```

### 2.5 4 种输出模式

#### SummaryFormatter（人类可读概览，默认）

```
🏥 Hermes Doctor v1.0.0 - 2026-07-28 12:50:00

✅ Environment       (10/10 ok, 850ms)
⚠️  Workspace        (7/8 ok, 1 warning, 420ms)
✅ LLM               (6/6 ok, 1.2s)
❌ Database          (3/6 ok, 3 errors, 230ms)
⚠️  MCP              (4/5 ok, 1 warning, 890ms)
✅ Dependencies      (7/7 ok, 150ms)

总体状态: ❌ ERROR (3 errors, 2 warnings)
总耗时: 3.74s

❌ 关键问题:
  1. [db.connection] 数据库连接失败
     修复: 检查 DATABASE_URL 环境变量
  2. [db.migration] alembic 未应用最新迁移
     修复: alembic upgrade head
  3. [db.tables] 缺失表: agents, projects
     修复: alembic upgrade head

⚠️  警告:
  1. [workspace.git_status] 有未提交的修改
  2. [mcp.servers_reachable] 1 个 MCP 服务器无法启动
```

#### JSONFormatter（机器可读）

```json
{
  "report_id": "doc_20260728_xxxxx",
  "timestamp": "2026-07-28T12:50:00Z",
  "hostname": "hermes-dev-01",
  "hermes_version": "6.15.0",
  "duration_ms": 3740,
  "overall_status": "error",
  "summary": {
    "ok": 37,
    "warning": 2,
    "error": 3,
    "skipped": 0,
    "total": 42
  },
  "categories": {
    "environment": {
      "category": "environment",
      "title": "环境变量",
      "total_checks": 10,
      "ok_count": 10,
      "warning_count": 0,
      "error_count": 0,
      "skipped_count": 0,
      "duration_ms": 850,
      "overall_status": "ok",
      "items": [...]
    },
    ...
  }
}
```

#### FullFormatter（完整报告，含全部细节）

类似 JSON，但额外包含：
- 每个 CheckItem 的完整 details 字典
- 系统调用原始输出
- 修复建议的完整文本
- 报告存储路径

#### PlainFormatter（禁用颜色）

与 Summary 相同但去除 ANSI 颜色码，适用于：
- 日志文件输出
- 邮件发送
- CI/CD 捕获

### 2.6 修复建议生成器

每类问题对应一个 FixAdvisor：

```python
class FixAdvisor:
    """修复建议生成器"""

    FIX_TEMPLATES = {
        "env.anthropic_api_key": (
            "设置 ANTHROPIC_API_KEY 环境变量",
            [
                "export ANTHROPIC_API_KEY=sk-ant-...",
                "# 或添加到 ~/.bashrc:",
                "echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc",
            ],
        ),
        "db.migration": (
            "应用最新 alembic 迁移",
            [
                "cd /home/qizheng/auto_code_ws/backend",
                "alembic upgrade head",
            ],
        ),
        ...
    }

    def get_fix(self, check_id: str) -> Optional[FixSuggestion]:
        if check_id in self.FIX_TEMPLATES:
            title, steps = self.FIX_TEMPLATES[check_id]
            return FixSuggestion(
                title=title,
                steps=steps,
                automated=False,  # 当前仅建议，不自动执行
                risk_level="low",  # low / medium / high
            )
        return None
```

### 2.7 历史报告存储

```python
class ReportHistoryStore:
    """历史报告存储（JSONL + 内存索引）"""

    def __init__(self, hermes_home: Path):
        self.history_dir = hermes_home / "doctor" / "history"
        self.history_dir.mkdir(parents=True, exist_ok=True)
        self.index: Dict[str, DoctorReport] = {}
        self._lock = threading.RLock()
        self._load_index()

    def save(self, report: DoctorReport):
        with self._lock:
            path = self.history_dir / f"{report.report_id}.json"
            path.write_text(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
            self.index[report.report_id] = report
            # 保留最近 50 个报告
            self._cleanup_old_reports(keep=50)

    def list_reports(self, limit: int = 20) -> List[Dict[str, Any]]:
        """列出最近报告（仅元信息）"""
        ...
```

---

## 三、接口设计规范

### 3.1 REST API 端点

| 端点 | 方法 | 描述 | 返回 |
|---|---|---|---|
| `/api/doctor/health` | GET | 健康检查 | `{success, service, version}` |
| `/api/doctor/run` | GET | 运行完整诊断 | DoctorReport JSON |
| `/api/doctor/run?category=environment` | GET | 单类诊断 | CategoryReport JSON |
| `/api/doctor/{category}` | GET | 类别诊断 | CategoryReport JSON |
| `/api/doctor/feedback` | POST | 反馈诊断结果 | `{success, feedback_id}` |
| `/api/doctor/history` | GET | 历史报告列表 | `{count, reports: [...]}` |
| `/api/doctor/history/{id}` | GET | 单个历史报告 | DoctorReport JSON |
| `/api/doctor/fix/{check_id}` | GET | 获取修复建议 | `{title, steps, risk_level}` |

### 3.2 请求/响应模型

```python
class FeedbackRequest(BaseModel):
    report_id: str
    user_comment: Optional[str] = None
    contact_email: Optional[str] = None


class FeedbackResponse(BaseModel):
    success: bool
    feedback_id: str
    message: str


class DoctorReportSummary(BaseModel):
    report_id: str
    timestamp: str
    overall_status: str
    summary: Dict[str, int]
    duration_ms: int
```

### 3.3 错误码

| 错误码 | HTTP | 描述 |
|---|---|---|
| `doctor.check_failed` | 500 | 检查执行异常 |
| `doctor.report_not_found` | 404 | 报告不存在 |
| `doctor.invalid_category` | 400 | 类别非法 |
| `doctor.history_full` | 507 | 历史已满 |

---

## 四、性能与安全要求

### 4.1 性能

- **完整诊断耗时**: < 10s（6 大类并行）
- **单类诊断耗时**: < 5s
- **历史查询**: < 100ms（内存索引）
- **报告保存**: < 200ms
- **JSON 序列化**: < 500ms

### 4.2 安全

- **API 密钥脱敏**：环境变量值仅显示前 4 字符 + `***`
- **路径白名单**：仅读取 ~/.hermes/ 和项目工作区
- **无副作用**：诊断仅读取，不修改任何文件（除历史报告）
- **CLI 沙箱**：修复建议中的命令仅展示，不自动执行
- **超时控制**：每个检查项 5s 超时，避免阻塞

---

## 五、验收标准

### 5.1 功能验收

- [ ] 6 大类诊断器全部实现
- [ ] 42+ 检查项全部实现（每类 7+ 项）
- [ ] 4 种输出模式（summary / json / all / no-color）正确
- [ ] CLI 命令 `hermes doctor` 可独立运行（无需后端）
- [ ] 8 个 REST API 端点全部实现
- [ ] 修复建议覆盖所有 error / warning 项
- [ ] 历史报告保留最近 50 份
- [ ] 并行执行（6 类 < 10s 完成）

### 5.2 测试验收

- [ ] 单元测试 50+ 用例，覆盖所有 checker
- [ ] E2E 测试 30+ 断言，验证所有 API 端点
- [ ] 测试通过率 100%
- [ ] TypeScript 编译 0 错误
- [ ] 前端构建成功

### 5.3 UI 验收

- [ ] DoctorPanel 6 类卡片式展示
- [ ] 每类卡片显示 ok/warning/error 计数
- [ ] 点击展开查看检查项详情
- [ ] 修复建议按钮（一键复制命令）
- [ ] 历史报告时间线
- [ ] 一键反馈按钮
- [ ] 响应式布局

---

## 六、文件结构

```
backend/app/
├── core/
│   └── doctor/
│       ├── __init__.py
│       ├── base.py                  # 基类 + 数据模型
│       ├── runner.py                # DoctorRunner 主调度
│       ├── fix_advisor.py           # 修复建议生成器
│       ├── history.py               # 历史报告存储
│       └── formatters.py            # 4 种输出格式化
│       └── checkers/
│           ├── __init__.py
│           ├── environment.py       # 环境检查
│           ├── workspace.py         # 工作区检查
│           ├── llm.py               # LLM API 检查
│           ├── database.py          # 数据库检查
│           ├── mcp.py               # MCP 服务器检查
│           └── dependencies.py      # 依赖检查
├── api/
│   └── doctor.py                    # REST API 8 个端点
└── cli/
    └── doctor_cli.py                # hermes doctor CLI

frontend/src/
├── hooks/
│   └── useDoctorApi.ts              # API 客户端
├── components/
│   ├── DoctorPanel.tsx              # 主面板
│   ├── DoctorCategoryCard.tsx       # 分类卡片
│   ├── DoctorFixSuggestion.tsx      # 修复建议组件
│   └── DoctorHistoryView.tsx        # 历史视图
└── pages/
    └── DoctorPage.tsx               # 独立页面

tests/
├── test_doctor_units.py             # 单元测试 50+ 用例
└── test_e2e_doctor.sh               # E2E 测试 30+ 断言

.trae/specs/cycle11/doctor/
├── spec.md                          # 本文档
├── task.md                          # 任务清单
└── checklist.md                     # 验收清单
```

---

## 七、依赖与配置

### 7.1 Python 依赖

- `concurrent.futures`（标准库）
- `pathlib`（标准库）
- `httpx`（已依赖，用于 LLM/MCP 检查）
- 无新增外部依赖

### 7.2 前端依赖

- 复用现有 UI 组件库
- 无新增 npm 依赖

### 7.3 配置

```python
# backend/app/config.py 新增
DOCTOR_CONFIG = {
    "check_timeout_seconds": 5,
    "history_keep_count": 50,
    "enable_auto_fix": False,  # 安全：仅建议
    "log_level": "INFO",
}
```

---

## 八、风险评估

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| LLM API 检查本身可能失败 | 中 | 5s 超时控制 + 降级为 warning |
| 数据库检查时锁竞争 | 低 | 短事务 + 读快照 |
| MCP 服务器启动慢 | 中 | 异步 + 短超时 |
| 修复建议命令对用户不安全 | 中 | 默认不自动执行 + 风险评级 |
| 6 类并行执行资源占用 | 低 | 限制 6 个 worker |

---

## 九、时间线

| 阶段 | 任务 | 工时 |
|---|---|---|
| 1. 基类 + 数据模型 | `base.py` | 1h |
| 2. 6 个 Checker | checkers/*.py | 3h |
| 3. Runner + Formatter | runner.py, formatters.py | 1.5h |
| 4. FixAdvisor | fix_advisor.py | 1h |
| 5. History Store | history.py | 0.5h |
| 6. REST API | api/doctor.py | 1.5h |
| 7. CLI 命令 | cli/doctor_cli.py | 0.5h |
| 8. 前端组件 | DoctorPanel + 子组件 | 2h |
| 9. 单元测试 | test_doctor_units.py | 1.5h |
| 10. E2E 测试 | test_e2e_doctor.sh | 1h |
| 11. 集成 + UI 优化 | - | 1h |
| **总计** | - | **14.5h** |

---

## 十、参考资源

- [Codex v0.135.0 doctor 命令源码](https://github.com/openai/codex)
- [Hermes AGENTS.md 规范](file:///home/qizheng/auto_code_ws/AGENTS.md)
- [FastAPI 异步后台任务](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [Python concurrent.futures](https://docs.python.org/3/library/concurrent.futures.html)

---

**状态**: 📝 设计完成，待实现
**下一步**: 创建 task.md 任务清单 + checklist.md 验收清单
