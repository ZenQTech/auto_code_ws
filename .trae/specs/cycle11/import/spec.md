# P3-1 /import 跨平台配置迁移 - 详细规格

> **任务 ID**: P3-1
> **关联阶段**: Cycle 11 - 用户生态扩展
> **版本**: v1.0.0 → v6.12.0
> **日期**: 2026-07-28
> **状态**: 📝 规格定义
> **关联文档**:
> - 调研报告: [CYCLE11_RESEARCH_REPORT.md](../../../CYCLE11_RESEARCH_REPORT.md)
> - 差距分析: [CYCLE11_GAP_ANALYSIS.md](../../../CYCLE11_GAP_ANALYSIS.md)
> - 任务清单: [task.md](task.md)
> - 验收清单: [checklist.md](checklist.md)

---

## 一、目标与背景

### 1.1 问题陈述

当前 Hermes 用户从其他 AI 编程工具（Cursor / Claude Code / Codex / TRAE）切换过来时：
- 必须**手动重新配置**所有 MCP 服务器、slash commands、项目 memory
- 切换成本高（一个下午的重配置工作量）
- 难以吸引已有 Claude Code / Cursor 习惯的用户
- 用户配置经验（settings、preferences、skills）无法跨平台迁移

### 1.2 目标

实现完整的 `/import` 跨平台配置迁移能力：
1. **检测 4 类数据源**：Cursor / Claude Code / Codex / TRAE
2. **迁移 6 类数据**：settings / MCP servers / plugins / sessions / commands / project memories
3. **dry-run 预览**：导入前查看待迁移项
4. **异步执行**：大文件导入后台处理
5. **进度回调**：实时反馈导入进度
6. **失败回滚**：导入失败自动恢复源数据
7. **前端 UI 向导**：可视化导入流程

---

## 二、范围与功能

### 2.1 支持的数据源

| 数据源 | 路径 | 格式 | 优先级 |
|--------|------|------|--------|
| **Claude Code** | `~/.claude/` | JSON | P0 |
| **Cursor** | `~/.cursor/` | JSON | P0 |
| **Codex** | `~/.codex/` | TOML | P0 |
| **TRAE** | `~/.trae/` | JSON + YAML | P0 |

### 2.2 迁移的数据类型

| 数据类型 | 源位置 | 目标位置 | 转换复杂度 |
|----------|--------|----------|------------|
| **Settings** | `~/.claude/settings.json` 等 | `~/.hermes/config.toml` | 中（JSON→TOML） |
| **MCP Servers** | `~/.claude/.mcp.json` 等 | `~/.hermes/mcp_servers.json` | 中（结构转换） |
| **Plugins** | `~/.claude/plugins/` | `~/.hermes/plugins/` | 低（直接复制） |
| **Sessions** | `~/.claude/sessions/` | `~/.hermes/sessions/` | 中（格式转换） |
| **Commands** | `~/.claude/commands/*.md` | `~/.hermes/commands/*.md` | 低（直接复制） |
| **Project Memories** | `~/.claude/CLAUDE.md` | `~/.hermes/memory/project/` | 中（语义转换） |

### 2.3 API 端点

| Method | Path | 描述 |
|--------|------|------|
| `GET`  | `/api/import/health` | 健康检查 |
| `POST` | `/api/import/detect` | 检测已安装的 IDE |
| `POST` | `/api/import/preview` | 预览待迁移项（dry-run） |
| `POST` | `/api/import/run` | 异步执行导入 |
| `GET`  | `/api/import/status/{id}` | 查询导入状态 |
| `GET`  | `/api/import/list` | 列出所有导入任务 |
| `DELETE` | `/api/import/{id}` | 取消导入任务 |
| `GET`  | `/api/import/formats` | 列出支持的格式 |

### 2.4 数据模型

```python
class ImportSource(str, Enum):
    """数据源平台"""
    CLAUDE_CODE = "claude_code"
    CURSOR = "cursor"
    CODEX = "codex"
    TRAE = "trae"


class DataType(str, Enum):
    """数据类型"""
    SETTINGS = "settings"
    MCP_SERVERS = "mcp_servers"
    PLUGINS = "plugins"
    SESSIONS = "sessions"
    COMMANDS = "commands"
    MEMORIES = "memories"


class ImportStatus(str, Enum):
    """导入状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ROLLED_BACK = "rolled_back"


class DetectedSource(BaseModel):
    """检测到的数据源"""
    source: ImportSource
    install_path: str
    available: bool
    version: Optional[str]
    data_types: List[DataType]  # 该源可提供的数据类型
    size_bytes: int
    last_modified: Optional[datetime]


class ImportPreviewItem(BaseModel):
    """预览项"""
    source: ImportSource
    data_type: DataType
    source_path: str
    target_path: str
    size_bytes: int
    item_count: int
    conflicts: List[str]  # 与现有数据的冲突项
    transform_notes: List[str]  # 格式转换说明


class ImportTask(BaseModel):
    """导入任务"""
    task_id: str
    source: ImportSource
    data_types: List[DataType]
    status: ImportStatus
    progress: float  # 0.0-1.0
    started_at: datetime
    completed_at: Optional[datetime]
    items_total: int
    items_completed: int
    items_failed: int
    error: Optional[str]
    rollback_available: bool
    log: List[str]
```

---

## 三、技术实现

### 3.1 后端架构

#### 3.1.1 目录结构

```
backend/app/services/
  import_service.py           # 核心服务（~800 行）
backend/app/api/
  import.py                   # REST API（~250 行）
backend/app/core/
  import_converters/          # 格式转换器
    base.py                   # 基础抽象（~80 行）
    claude_code.py            # Claude Code → Hermes（~200 行）
    cursor.py                 # Cursor → Hermes（~200 行）
    codex.py                  # Codex → Hermes（~150 行）
    trae.py                   # TRAE → Hermes（~150 行）
```

#### 3.1.2 核心类

```python
class ImportService:
    """导入服务主类"""
    
    def __init__(self, hermes_home: Path = None):
        self.hermes_home = hermes_home or Path.home() / ".hermes"
        self.import_dir = self.hermes_home / "import"
        self.import_dir.mkdir(parents=True, exist_ok=True)
        self.tasks_file = self.import_dir / "tasks.jsonl"
        self.converters: Dict[ImportSource, BaseConverter] = {
            ImportSource.CLAUDE_CODE: ClaudeCodeConverter(),
            ImportSource.CURSOR: CursorConverter(),
            ImportSource.CODEX: CodexConverter(),
            ImportSource.TRAE: TraeConverter(),
        }
        self.tasks: Dict[str, ImportTask] = {}
        self._lock = threading.RLock()
        self._load_all()
    
    def detect_sources(self) -> List[DetectedSource]:
        """检测已安装的 4 个 IDE"""
        ...
    
    def preview_import(
        self, source: ImportSource, data_types: List[DataType]
    ) -> List[ImportPreviewItem]:
        """预览待迁移项（dry-run）"""
        ...
    
    def run_import(
        self, source: ImportSource, data_types: List[DataType]
    ) -> ImportTask:
        """异步执行导入"""
        ...
    
    def get_task(self, task_id: str) -> Optional[ImportTask]:
        """查询任务状态"""
        ...
    
    def cancel_task(self, task_id: str) -> bool:
        """取消任务"""
        ...
    
    def rollback_task(self, task_id: str) -> bool:
        """回滚任务（恢复源数据）"""
        ...
```

#### 3.1.3 转换器接口

```python
class BaseConverter(ABC):
    """格式转换器基类"""
    
    @abstractmethod
    def detect(self) -> Optional[DetectedSource]:
        """检测该源是否安装"""
        ...
    
    @abstractmethod
    def list_data(self, data_type: DataType) -> List[ImportPreviewItem]:
        """列出该数据类型下的所有项"""
        ...
    
    @abstractmethod
    def convert(self, data_type: DataType, source_path: Path) -> Tuple[Path, bytes]:
        """转换为 Hermes 格式并返回目标路径 + 内容"""
        ...
    
    @abstractmethod
    def get_version(self) -> Optional[str]:
        """获取源 IDE 版本"""
        ...
```

### 3.2 关键设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 异步执行 | threading + 进度回调 | 大文件导入可能耗时 10s+ |
| 失败回滚 | 自动备份源 + 目标 → 失败时恢复 | 数据安全 |
| 路径白名单 | 4 个白名单目录 | 安全 |
| 格式转换 | 专用转换器（不通用解析器） | 扩展性 + 健壮性 |
| dry-run | 默认开启 preview | 用户确认 |
| 进度报告 | JSONL 持久化 | 重启可恢复 |
| 并发控制 | 单任务串行 + 任务间并行 | 简单可靠 |

### 3.3 安全约束

1. **路径白名单**：
   - `~/.claude/`, `~/.cursor/`, `~/.codex/`, `~/.trae/`（只读）
   - `~/.hermes/`（读写）
   - 拒绝其他路径（防越权）
2. **只读不写源**：导入过程中**绝不修改源数据**
3. **敏感信息脱敏**：API key / token 检测到时**标记并提示用户重新输入**
4. **大文件限制**：单文件最大 50 MB（防 DoS）
5. **超时控制**：单任务最多 10 分钟（防卡死）

---

## 四、前端 UI

### 4.1 ImportPanel 组件

```
┌────────────────────────────────────────────────────┐
│ 📥 跨平台配置导入                  v1.0.0   [关闭]  │
├────────────────────────────────────────────────────┤
│ [检测] [预览] [执行] [完成]                        │
├────────────────────────────────────────────────────┤
│                                                    │
│ 步骤 1: 选择数据源                                  │
│   ☑ Claude Code (v1.0.5) - ~/.claude/              │
│   ☑ Cursor (v0.42.0) - ~/.cursor/                  │
│   ☐ Codex (v0.145.0) - ~/.codex/                   │
│   ☐ TRAE (v3.5.79) - ~/.trae/                      │
│                                                    │
│ 步骤 2: 选择数据类型                                │
│   ☑ Settings                                       │
│   ☑ MCP Servers                                    │
│   ☐ Plugins                                        │
│   ☑ Sessions                                       │
│   ☑ Commands                                       │
│   ☑ Project Memories                               │
│                                                    │
│ [预览 →]                                           │
└────────────────────────────────────────────────────┘
```

### 4.2 状态机

```
idle → detecting → previewing → confirming → importing → completed
                     ↓                          ↓
                   failed                    failed → rollback
```

### 4.3 关键交互

1. **检测**：自动扫描 4 个常见安装路径
2. **预览**：表格展示每个待迁移项（源/目标/大小/冲突/转换说明）
3. **确认**：用户勾选/取消单项
4. **执行**：进度条 + 实时日志
5. **完成**：统计 + 错误列表 + 回滚按钮
6. **失败回滚**：一键恢复源数据

---

## 五、性能指标

| 操作 | 目标耗时 |
|------|----------|
| 检测 4 个源 | < 1s |
| 预览生成 | < 2s |
| 单数据迁移（< 1MB） | < 5s |
| 单数据迁移（1-10MB） | < 30s |
| 单数据迁移（10-50MB） | < 2min |
| 任务列表查询（1000 条） | < 50ms |
| 状态查询 | < 10ms |

---

## 六、测试策略

### 6.1 单元测试（≥ 60 用例）

| 测试类 | 用例数 | 覆盖点 |
|--------|--------|--------|
| `TestImportService` | 15 | 服务初始化、CRUD、状态转换 |
| `TestClaudeCodeConverter` | 10 | settings/MCP/commands 转换 |
| `TestCursorConverter` | 10 | settings/MCP/commands 转换 |
| `TestCodexConverter` | 8 | TOML→JSON 转换、AGENTS.md 合并 |
| `TestTraeConverter` | 8 | YAML 解析、嵌套结构 |
| `TestPathWhitelist` | 5 | 越权访问拒绝 |
| `TestRollback` | 4 | 失败回滚逻辑 |

### 6.2 E2E 测试（≥ 40 断言）

| 测试模块 | 断言数 |
|----------|--------|
| 健康检查 | 2 |
| 4 源检测 | 8 |
| dry-run 预览 | 10 |
| 异步执行 | 8 |
| 状态查询 | 4 |
| 取消任务 | 3 |
| 失败回滚 | 3 |
| 并发任务 | 2 |

### 6.3 浏览器端测试

- 场景 1：完整导入向导（检测 → 预览 → 确认 → 执行 → 完成）
- 场景 2：单数据源导入（仅 Claude Code settings）
- 场景 3：冲突处理（已存在同名文件）
- 场景 4：失败回滚

---

## 七、API 路径白名单

```python
ALLOWED_IMPORT_SOURCES = [
    Path.home() / ".claude",
    Path.home() / ".cursor",
    Path.home() / ".codex",
    Path.home() / ".trae",
]

ALLOWED_TARGET_DIRS = [
    Path.home() / ".hermes",
    Path("/home/qizheng/auto_code_ws/.hermes"),
]
```

---

## 八、依赖

- **Python 3.10+**（已有）
- **tomli / tomli_w**（TOML 解析，可选）
- **PyYAML**（TRAE 配置解析，可选）
- **零外部服务依赖**

---

## 九、交付物清单

- [ ] `backend/app/services/import_service.py`（~800 行）
- [ ] `backend/app/core/import_converters/{base,claude_code,cursor,codex,trae}.py`（~780 行）
- [ ] `backend/app/api/import.py`（~250 行）
- [ ] `tests/test_import_units.py`（~700 行 60+ 单元测试）
- [ ] `tests/test_e2e_import.sh`（~350 行 40+ E2E 断言）
- [ ] `frontend/src/components/ImportPanel.tsx`（~600 行）
- [ ] `frontend/src/pages/ImportPage.tsx`（~80 行）
- [ ] `frontend/src/hooks/useImportApi.ts`（~200 行）
- [ ] `frontend/src/router/router.tsx`（修改：+路由）
- [ ] `backend/app/main.py`（修改：+路由注册 v6.12.0）
- [ ] `CYCLE11_P3_1_SUMMARY.md`（完整总结）
- [ ] `代码修改日志.md`（追加 P3-1 记录）

---

## 十、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 4 源格式差异大 | 解析失败 | 专用转换器 + try/except + 降级 |
| 大量 MCP 配置迁移耗时 | 用户等待 | 异步 + 进度回调 |
| 敏感信息泄露 | 安全 | 脱敏 + 提示用户重新输入 |
| 文件权限 | 读取失败 | 友好错误信息 + chmod 建议 |
| 跨平台路径 | Windows/Linux 差异 | pathlib + 跨平台测试 |

---

## 十一、参考

- [Codex v0.145.0 release notes](https://github.com/openai/codex/releases/tag/rust-v0.145.0)
- [Codex External Agent Migration](https://codex.danielvaughan.com/2026/05/06/codex-cli-external-agent-migration-detect-import-api-cross-agent-portability/)
- [OpenAI Codex Migrate Guide](https://developers.openai.com/codex/migrate)

