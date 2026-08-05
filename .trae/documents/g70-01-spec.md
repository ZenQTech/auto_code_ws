# G70-01 Spec: AGENTS.md + Skill Registry 完整化

**Cycle**: 70
**优先级**: P0
**对标**: Codex CLI v0.124.0+ 五层架构 / Trae SOLO v3.5+ Skills
**创建日期**: 2026-08-05
**模块版本**: v1.0.0

---

## 一、功能需求描述

### 1.1 功能目标

本任务将当前项目对 AGENTS.md 和 Skills 的支持升级为对标 Codex CLI v0.124.0+ 的五层架构（AGENTS.md + Skills + MCP + Subagents + Plugins）。本任务聚焦前两层的完整化：

1. **AGENTS.md 多层级发现**：从全局 → 项目 → CWD 完整遍历，支持 override 替换机制、字节限制、根目录标记检测
2. **SKILL.md 5 个存储位置**：REPO/USER/ADMIN/SYSTEM/DEFAULTS 完整支持
3. **Skill 显式/隐式调用**：基于关键词匹配的隐式调用 + `$skill-name` 显式调用
4. **Plugin 基础注册**：本地 plugin 安装、依赖追踪、启用/禁用
5. **REST API 完整化**：提供 12 个新端点覆盖所有功能

### 1.2 用户场景

**场景 A：项目级规则自动注入**
用户打开一个项目，前端调用 `/api/agents-md/load` 接口，后端从全局（`~/.hermes/AGENTS.md`）开始，沿项目根 → CWD 依次拼接每个目录的 `AGENTS.md`/`AGENTS.override.md` 内容，并在总字节数达到 `project_doc_max_bytes`（默认 32 KiB）时停止。结果以字符串形式返回，前端注入到 LLM system prompt。

**场景 B：多位置 Skill 注册**
用户在 USER 目录 `~/.hermes/skills/` 放置 `my-skill/SKILL.md`，项目 REPO `.hermes/skills/` 放置 `team-skill/SKILL.md`。后端在 `list_skills()` 时合并所有位置（去重时 REPO 优先于 USER）。每个 skill 标记 `location` 字段（repo/user/admin/system/defaults）。

**场景 C：隐式 Skill 触发**
用户输入 `请帮我审查这段代码的 bug`。后端解析请求，匹配所有 skill 的 description 关键词，激活 `code-reviewer` skill，将 system_prompt 注入到 LLM 上下文。匹配结果记录到 `skill_invocations` 表。

**场景 D：显式 Skill 调用**
用户输入 `$code-reviewer 检查 src/api/users.py`。后端识别 `$` 前缀的显式调用，立即激活指定 skill（不依赖关键词匹配），返回 skill 内容 + 调用结果。

**场景 E：Plugin 本地安装**
用户从本地 zip 安装 plugin（包含 SKILL.md + MCP 配置 + 依赖声明）。后端解压、解析 `plugin.toml`、注册到 plugin 注册表，追踪依赖关系。

### 1.3 使用流程

```
┌──────────────────────────────────────────────────────────────┐
│ 1. 启动时初始化 SkillRegistry（扫描 5 位置 + 加载插件）        │
│ 2. 启动时初始化 AGENTSmdResolver（加载全局 + 项目根规则）     │
│ 3. 用户输入请求                                                 │
│ 4. 前端 → /api/skills/match → 后端返回隐式匹配的 skill         │
│ 5. 前端 → /api/agents-md/load?cwd=... → 后端返回拼接结果       │
│ 6. 前端组装 system prompt → 调用 LLM                          │
│ 7. 用户使用 $skill-name → 前端 → /api/skills/{name}/invoke    │
│ 8. 用户安装 plugin → 前端 → POST /api/plugins/install         │
└──────────────────────────────────────────────────────────────┘
```

---

## 二、技术实现方案

### 2.1 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 后端服务 | FastAPI + asyncio | 与现有栈一致 |
| YAML 解析 | PyYAML | 已使用（skill_md.py） |
| 路径解析 | pathlib | 跨平台 |
| LRU 缓存 | functools.lru_cache + 自实现失效 | 标准库 |
| 配置存储 | 内存 + JSON 文件（~/.hermes/config/） | 避免新增数据库表 |
| 文件监听 | 复用现有 fs_watcher | 已有基础设施 |
| 前端 UI | React + TypeScript + Tailwind | 与现有栈一致 |
| 状态管理 | React Hooks (useState/useReducer) | 与现有栈一致 |

### 2.2 架构设计

#### 2.2.1 后端模块

```
backend/app/services/
├── agents_md_resolver.py        # 多层级 AGENTS.md 解析（增强版）
├── skill_registry.py            # 5 位置 Skill 注册表
├── skill_invocation.py          # 显式/隐式调用引擎
├── plugin_registry.py           # Plugin 注册表
└── skill_md.py                  # 已有：SKILL.md 解析

backend/app/api/
├── agents_md_v2.py              # 新增：增强版 AGENTS.md API
├── skills_v2.py                 # 新增：Skill Registry API
├── skill_invocation.py          # 新增：调用 API
└── plugins_v2.py                # 新增：Plugin API
```

#### 2.2.2 前端组件

```
frontend/src/
├── hooks/
│   ├── useSkillRegistry.ts      # Skill 注册表 Hook
│   ├── useAgentsMdResolver.ts   # AGENTS.md 解析 Hook
│   ├── useSkillInvocation.ts    # Skill 调用 Hook
│   └── usePluginRegistry.ts     # Plugin Hook
├── components/
│   ├── SkillsRegistryPanel.tsx  # Skill 列表 + 5 位置显示
│   ├── AgentsMdResolverPanel.tsx # 多层级预览
│   ├── SkillInvocationPanel.tsx # 调用测试 UI
│   └── PluginManagerPanel.tsx   # Plugin 管理 UI
```

### 2.3 核心算法

#### 2.3.1 AGENTS.md 多层级发现算法

```python
def resolve_agents_md(cwd: str, config: AgentsMdConfig) -> ResolvedAgentsMd:
    """
    Codex 风格 AGENTS.md 多层级发现算法
    
    算法：
    1. 检测项目根（从 cwd 向上查找 .git 等 markers）
    2. 加载全局作用域（~/.hermes/AGENTS.md 或 AGENTS.override.md）
    3. 从项目根 → CWD 依次加载每个目录的 AGENTS.md
    4. 拼接策略：
       - 同目录 AGENTS.override.md 替换 AGENTS.md
       - 不同目录内容按从根到叶顺序拼接
       - 累计字节数达 project_doc_max_bytes 时停止
    5. 注入 developer_instructions（如果在 AGENTS.md 之前）
    
    时间复杂度：O(N * D)
    - N = 目录数（<= max_depth）
    - D = 每个 AGENTS.md 的字节数（读文件 O(D)）
    
    空间复杂度：O(N * D)（缓存所有内容）
    """
    project_root = detect_project_root(cwd, config.project_root_markers)
    layers: List[AgentsMdLayer] = []
    total_bytes = 0
    
    # 1. 全局作用域
    global_content = load_global_agents_md(config.global_paths)
    if global_content:
        layers.append(AgentsMdLayer(scope="global", content=global_content))
        total_bytes += len(global_content.encode())
    
    # 2. 项目根 → CWD
    for directory in walk_from_root_to_cwd(project_root, cwd, max_depth=config.max_depth):
        content = load_agents_md_in_dir(directory, fallback_names=config.fallback_filenames)
        if content:
            truncated = truncate_to_budget(content, config.max_bytes - total_bytes)
            layers.append(AgentsMdLayer(scope=directory, content=truncated))
            total_bytes += len(truncated.encode())
            if total_bytes >= config.max_bytes:
                layers[-1].truncated = True
                break
    
    # 3. 注入 developer_instructions
    if config.developer_instructions:
        layers.insert(0, AgentsMdLayer(scope="developer", content=config.developer_instructions))
    
    return ResolvedAgentsMd(
        layers=layers,
        total_bytes=total_bytes,
        cwd=cwd,
        project_root=project_root,
    )
```

#### 2.3.2 Skill 隐式调用匹配算法

```python
def match_implicit_skills(query: str, skills: List[Skill]) -> List[SkillMatch]:
    """
    基于 description 关键词匹配的隐式 skill 激活
    
    算法：
    1. 分词 query（支持中英文混合）
    2. 对每个 skill：
       - 提取 description 中的关键词
       - 计算与 query 的 Jaccard 相似度
       - 如果相似度 >= 阈值（默认 0.2），激活
    3. 按相似度降序排序
    
    时间复杂度：O(N * M)
    - N = skill 数量
    - M = query 词数
    
    阈值（crossModalityThresholdMultiplier 类比）：
    - 中文：0.2（Jaccard）
    - 英文：0.3（Jaccard）
    - 可由 SKILL_THRESHOLD 环境变量覆盖
    """
    query_tokens = set(tokenize(query))
    matches = []
    
    for skill in skills:
        if not skill.enabled:
            continue
        desc_tokens = set(tokenize(skill.description))
        if not desc_tokens:
            continue
        intersection = query_tokens & desc_tokens
        union = query_tokens | desc_tokens
        similarity = len(intersection) / len(union) if union else 0.0
        
        # 阈值判断
        threshold = SKILL_THRESHOLD  # 0.2 中文
        if similarity >= threshold:
            matches.append(SkillMatch(
                skill=skill,
                similarity=similarity,
                matched_tokens=list(intersection),
            ))
    
    matches.sort(key=lambda m: m.similarity, reverse=True)
    return matches
```

#### 2.3.3 5 位置 Skill 优先级解析

```python
LOCATION_PRIORITY = {
    "defaults": 0,   # 最低
    "system": 1,
    "admin": 2,
    "user": 3,
    "repo": 4,       # 最高（项目级覆盖用户级）
}

def resolve_skill_conflicts(skills_by_location: Dict[str, List[Skill]]) -> Dict[str, Skill]:
    """
    5 位置 skill 冲突解决
    
    规则：
    - 同一 skill name 出现在多个位置时，按 LOCATION_PRIORITY 选择
    - 较高优先级位置的 skill 完全替换较低优先级
    - 同一位置内出现同名 skill → 抛出错误（不自动去重）
    
    时间复杂度：O(N * L)
    - N = 总 skill 数
    - L = 位置数（=5）
    """
    resolved: Dict[str, Skill] = {}
    conflicts: List[SkillConflict] = []
    
    # 按优先级从低到高处理（高优先级覆盖低优先级）
    for location in ["defaults", "system", "admin", "user", "repo"]:
        for skill in skills_by_location.get(location, []):
            if skill.name in resolved:
                # 检测冲突
                existing = resolved[skill.name]
                conflicts.append(SkillConflict(
                    skill_name=skill.name,
                    kept=existing,
                    overridden=skill,
                    override_location=location,
                ))
            resolved[skill.name] = skill
    
    return resolved
```

---

## 三、接口设计规范

### 3.1 AGENTS.md 增强 API

#### `POST /api/agents-md-v2/load`
**功能**：加载当前 cwd 的完整 AGENTS.md 拼接结果
**请求体**：
```json
{
  "cwd": "/home/user/project/src",
  "config": {
    "max_bytes": 32768,
    "max_depth": 10,
    "fallback_filenames": ["TEAM_GUIDE.md", ".agents.md"],
    "project_root_markers": [".git", ".hg"],
    "developer_instructions": "Always use TypeScript."
  }
}
```
**响应**：
```json
{
  "success": true,
  "layers": [
    {"scope": "developer", "relative_path": null, "content": "Always use TypeScript.", "size": 24, "truncated": false},
    {"scope": "global", "relative_path": "~/.hermes/AGENTS.md", "content": "## Personal Conventions\n...", "size": 1024, "truncated": false},
    {"scope": "project", "relative_path": "/home/user/project/AGENTS.md", "content": "# Project Rules\n...", "size": 2048, "truncated": false},
    {"scope": "subdir", "relative_path": "src/AGENTS.md", "content": "## Module Rules\n...", "size": 512, "truncated": false}
  ],
  "total_bytes": 3608,
  "max_bytes": 32768,
  "truncated_at": null,
  "project_root": "/home/user/project",
  "merged_content": "## Developer Instructions\nAlways use TypeScript.\n\n---\n## Global\n..."
}
```

#### `GET /api/agents-md-v2/config`
**功能**：获取当前 AGENTS.md 配置
**响应**：
```json
{
  "success": true,
  "config": {
    "max_bytes": 32768,
    "max_depth": 10,
    "fallback_filenames": ["AGENTS.md", "TEAM_GUIDE.md"],
    "project_root_markers": [".git"],
    "developer_instructions": "",
    "global_paths": ["~/.hermes/AGENTS.override.md", "~/.hermes/AGENTS.md"]
  }
}
```

#### `PUT /api/agents-md-v2/config`
**功能**：更新 AGENTS.md 配置
**请求体**：同 GET 响应
**响应**：`{"success": true, "config": {...}}`

#### `POST /api/agents-md-v2/detect-root`
**功能**：从给定路径向上检测项目根
**请求体**：`{"cwd": "/path/to/dir", "markers": [".git", ".hg"]}`
**响应**：`{"success": true, "project_root": "/path/to", "matched_marker": ".git"}`

### 3.2 Skill Registry API

#### `GET /api/skills-v2/list`
**Query**: `?location=repo&enabled_only=true`
**响应**：
```json
{
  "success": true,
  "skills": [
    {
      "id": "repo:code-reviewer",
      "name": "code-reviewer",
      "display_name": "Code Reviewer",
      "description": "Review code for bugs, performance, security",
      "location": "repo",
      "path": "/home/user/project/.hermes/skills/code-reviewer/SKILL.md",
      "enabled": true,
      "source": "skill_md",
      "version": "1.0.0",
      "tags": ["review", "code-quality"]
    }
  ],
  "count": 1,
  "by_location": {
    "defaults": 3, "system": 0, "admin": 0, "user": 2, "repo": 1
  },
  "conflicts": [
    {"skill_name": "code-reviewer", "kept": "repo:code-reviewer", "overridden": "user:code-reviewer"}
  ]
}
```

#### `GET /api/skills-v2/locations`
**功能**：列出 5 个位置的扫描状态
**响应**：
```json
{
  "success": true,
  "locations": [
    {"name": "defaults", "path": "/app/defaults/skills/", "exists": true, "skill_count": 3, "scanned_at": "..."},
    {"name": "system", "path": "/opt/hermes/skills/", "exists": false, "skill_count": 0},
    {"name": "admin", "path": "/etc/hermes/skills/", "exists": false, "skill_count": 0},
    {"name": "user", "path": "/home/user/.hermes/skills/", "exists": true, "skill_count": 2, "scanned_at": "..."},
    {"name": "repo", "path": "/home/user/project/.hermes/skills/", "exists": true, "skill_count": 1, "scanned_at": "..."}
  ]
}
```

#### `POST /api/skills-v2/rescan`
**功能**：强制重新扫描所有 5 个位置
**响应**：`{"success": true, "scanned": 5, "skills_found": 6, "duration_ms": 12}`

#### `POST /api/skills-v2/{name}/enable`
#### `POST /api/skills-v2/{name}/disable`

### 3.3 Skill 调用 API

#### `POST /api/skill-invocation/match`
**功能**：基于 query 隐式匹配 skill
**请求体**：`{"query": "请帮我审查代码", "top_k": 3, "threshold": 0.2}`
**响应**：
```json
{
  "success": true,
  "matches": [
    {
      "skill_id": "defaults:code-reviewer",
      "skill_name": "code-reviewer",
      "similarity": 0.45,
      "matched_tokens": ["代码", "审查"],
      "system_prompt": "你是一位资深的代码审查专家..."
    }
  ],
  "count": 1,
  "threshold": 0.2,
  "inference_ms": 3
}
```

#### `POST /api/skill-invocation/invoke`
**功能**：显式调用 `$skill-name` 形式
**请求体**：
```json
{
  "skill_name": "code-reviewer",
  "args": {"file_path": "src/api/users.py"},
  "context": "请审查这段代码"
}
```
**响应**：
```json
{
  "success": true,
  "skill_name": "code-reviewer",
  "skill_id": "defaults:code-reviewer",
  "invocation_id": "inv-20260805-xxx",
  "system_prompt": "...",
  "tools": ["read_file", "list_directory"],
  "duration_ms": 1
}
```

#### `GET /api/skill-invocation/history?limit=50`
**响应**：
```json
{
  "success": true,
  "history": [
    {
      "invocation_id": "inv-...",
      "skill_name": "code-reviewer",
      "invocation_type": "explicit",
      "args": {"file_path": "..."},
      "duration_ms": 1,
      "created_at": "2026-08-05T13:00:00Z"
    }
  ],
  "count": 1
}
```

### 3.4 Plugin Registry API

#### `GET /api/plugins-v2/list`
**响应**：
```json
{
  "success": true,
  "plugins": [
    {
      "id": "plugin-abc",
      "name": "github-helper",
      "version": "1.2.0",
      "description": "GitHub integration plugin",
      "enabled": true,
      "dependencies": ["mcp-github"],
      "skills": ["github-pr-reviewer"],
      "mcp_servers": ["github"],
      "installed_at": "2026-08-01T..."
    }
  ],
  "count": 1
}
```

#### `POST /api/plugins-v2/install`
**请求体**：
```json
{
  "source": "local",
  "plugin_path": "/tmp/my-plugin.zip",
  "force": false
}
```
**响应**：`{"success": true, "plugin_id": "plugin-abc", "name": "github-helper", "dependencies_resolved": 2}`

#### `POST /api/plugins-v2/{id}/enable`
#### `POST /api/plugins-v2/{id}/disable`
#### `DELETE /api/plugins-v2/{id}`

### 3.5 错误码

| 错误码 | HTTP | 含义 |
|--------|------|------|
| `AGENTS_MD_NOT_FOUND` | 404 | cwd 无任何 AGENTS.md |
| `AGENTS_MD_TOO_LARGE` | 413 | 总字节数超出 max_bytes |
| `SKILL_NOT_FOUND` | 404 | 指定 name 的 skill 不存在 |
| `SKILL_DISABLED` | 403 | skill 已禁用 |
| `SKILL_THRESHOLD_NOT_MET` | 200 | 隐式匹配低于阈值（仍返回 success=true 但 matches=[]） |
| `PLUGIN_CONFLICT` | 409 | 同名 plugin 已存在（除非 force=true） |
| `PLUGIN_DEPENDENCY_MISSING` | 424 | 依赖未安装 |
| `CONFIG_INVALID` | 400 | 配置参数非法 |

---

## 四、数据结构定义

### 4.1 AGENTS.md 解析

```python
@dataclass
class AgentsMdConfig:
    """AGENTS.md 多层级解析配置"""
    max_bytes: int = 32768  # Codex 默认
    max_depth: int = 10
    fallback_filenames: List[str] = field(default_factory=lambda: ["AGENTS.md", "TEAM_GUIDE.md"])
    project_root_markers: List[str] = field(default_factory=lambda: [".git"])
    developer_instructions: str = ""
    model_instructions_file: Optional[str] = None  # 完全替换
    global_paths: List[str] = field(default_factory=lambda: [
        "~/.hermes/AGENTS.override.md",
        "~/.hermes/AGENTS.md",
    ])

@dataclass
class AgentsMdLayer:
    """单个 AGENTS.md 层级"""
    scope: str  # "developer" | "global" | "project" | "subdir" | "model"
    relative_path: Optional[str]
    content: str
    size: int
    truncated: bool = False
    is_override: bool = False

@dataclass
class ResolvedAgentsMd:
    """完整解析结果"""
    layers: List[AgentsMdLayer]
    total_bytes: int
    max_bytes: int
    truncated_at: Optional[int]
    project_root: str
    merged_content: str
```

### 4.2 Skill Registry

```python
@dataclass
class Skill:
    """Skill 完整模型"""
    id: str  # "{location}:{name}" 格式
    name: str
    display_name: str
    description: str
    location: str  # "defaults" | "system" | "admin" | "user" | "repo"
    path: str  # SKILL.md 文件绝对路径
    enabled: bool = True
    source: str  # "builtin" | "skill_md" | "plugin"
    version: str = "1.0.0"
    tags: List[str] = field(default_factory=list)
    argument_hint: Optional[str] = None
    allowed_tools: List[str] = field(default_factory=list)
    user_invocable: bool = True
    disable_model_invocation: bool = False
    agent: Optional[str] = None
    system_prompt: str = ""
    scripts: List[str] = field(default_factory=list)  # 关联脚本
    references: List[str] = field(default_factory=list)  # 关联资源
    last_scanned_at: str = ""

@dataclass
class SkillConflict:
    """跨位置冲突"""
    skill_name: str
    kept: Skill
    overridden: Skill
    override_location: str
```

### 4.3 Skill Invocation

```python
@dataclass
class SkillMatch:
    """隐式匹配结果"""
    skill: Skill
    similarity: float  # 0.0-1.0
    matched_tokens: List[str]
    system_prompt: str

@dataclass
class SkillInvocation:
    """调用记录"""
    invocation_id: str
    skill_name: str
    skill_id: str
    invocation_type: str  # "explicit" | "implicit"
    args: Dict[str, Any]
    duration_ms: int
    created_at: str
```

### 4.4 Plugin

```python
@dataclass
class Plugin:
    """Plugin 完整模型"""
    id: str
    name: str
    version: str
    description: str
    enabled: bool = True
    source: str  # "local" | "marketplace"
    install_path: str
    dependencies: List[str] = field(default_factory=list)
    skills: List[str] = field(default_factory=list)
    mcp_servers: List[str] = field(default_factory=list)
    agents: List[str] = field(default_factory=list)
    installed_at: str = ""
    plugin_toml_path: str = ""

@dataclass
class PluginDependency:
    """Plugin 依赖"""
    name: str
    version_spec: str  # e.g. ">=1.0.0"
    installed: bool = False
    installed_version: Optional[str] = None
```

### 4.5 持久化

- `~/.hermes/config/agents_md.json`：AGENTS.md 配置
- `~/.hermes/config/skill_registry.json`：Skill 注册表缓存（仅元数据，不含内容）
- `~/.hermes/config/plugins.json`：Plugin 注册表
- `~/.hermes/skill_invocations.jsonl`：调用历史（追加）
- 实际 SKILL.md 文件保存在 5 个位置的目录树中

---

## 五、性能与安全要求

### 5.1 性能指标

| 指标 | 目标 | 测试方法 |
|------|------|---------|
| 5 位置 skill 扫描 | < 100ms (空) / < 500ms (满载 100 skills) | 单元测试 |
| AGENTS.md 拼接 | < 50ms (10 个文件) | 单元测试 |
| 隐式 skill 匹配 | < 20ms (100 skills) | 单元测试 |
| 显式 skill 解析 | < 5ms | 单元测试 |
| Plugin 安装（本地 zip） | < 200ms (1MB) | 单元测试 |
| API 响应时间 P95 | < 100ms | 压测 |

### 5.2 资源限制

- 单个 SKILL.md 文件最大 1 MB
- 单次扫描目录数上限 1000
- Plugin 总数上限 100
- 缓存的 skill 元数据 LRU 上限 500
- 加载历史最多保留 1000 条（超出自动滚动）

### 5.3 安全要求

1. **路径遍历防护**：
   - 所有路径必须在 `~/.hermes/` 或 `/etc/hermes/` 或配置白名单内
   - 拒绝包含 `..` 的相对路径
   - 拒绝符号链接指向白名单外的文件

2. **YAML 安全解析**：
   - 使用 `yaml.safe_load`，禁止 `yaml.load`
   - frontmatter 字段类型严格校验（pydantic）
   - description 长度上限 512
   - name 长度上限 64，仅允许 `[a-z0-9-]`

3. **Plugin 沙箱**：
   - 依赖解析不允许 `eval`/`exec`
   - MCP server 启动时验证命令白名单
   - 安装路径必须在 `~/.hermes/plugins/` 下

4. **Skill 调用限制**：
   - 显式调用仅当 `user_invocable=True`
   - 隐式调用仅当 `disable_model_invocation=False`
   - 调用频率限制：60 calls/min per skill

5. **审计日志**：
   - 所有 skill 调用写入 `~/.hermes/skill_invocations.jsonl`
   - 所有 plugin 安装/卸载写入 `~/.hermes/plugin_audit.jsonl`
   - 包含 timestamp + user + skill_name + args

---

## 六、验收标准

### 6.1 功能验收

- [ ] **AGENTS.md 多层级发现**：从 `cwd` 正确拼接 global → project → CWD 内容
- [ ] **AGENTS.override.md 替换**：在同目录 override 完全替换 AGENTS.md
- [ ] **字节限制生效**：总字节数达 `max_bytes` 时停止，且标记 `truncated_at`
- [ ] **项目根检测**：从 `cwd` 向上查找 `.git` 等 markers
- [ ] **developer_instructions 注入**：在所有 AGENTS.md 之前
- [ ] **5 位置扫描**：REPO/USER/ADMIN/SYSTEM/DEFAULTS 全部工作
- [ ] **SKILL.md YAML frontmatter 解析**：所有字段（name/description/allowed_tools/version/tags）正确
- [ ] **优先级解析**：同 name 多位置时 REPO 覆盖 USER
- [ ] **隐式调用**：基于 description 关键词匹配
- [ ] **显式调用**：识别 `$skill-name` 格式
- [ ] **Plugin 本地安装**：解压 zip + 解析 plugin.toml + 注册
- [ ] **Plugin 依赖追踪**：记录 dependencies 列表
- [ ] **Plugin 启用/禁用**：影响加载到 LLM 的 prompt

### 6.2 API 验收

- [ ] `POST /api/agents-md-v2/load` 返回完整 layers
- [ ] `GET /api/agents-md-v2/config` 返回当前配置
- [ ] `PUT /api/agents-md-v2/config` 更新并持久化配置
- [ ] `GET /api/skills-v2/list` 按 location 过滤
- [ ] `GET /api/skills-v2/locations` 列出 5 位置状态
- [ ] `POST /api/skills-v2/rescan` 强制重新扫描
- [ ] `POST /api/skill-invocation/match` 返回隐式匹配
- [ ] `POST /api/skill-invocation/invoke` 显式调用
- [ ] `GET /api/skill-invocation/history` 返回调用历史
- [ ] `GET /api/plugins-v2/list` 列出所有 plugin
- [ ] `POST /api/plugins-v2/install` 安装 plugin
- [ ] `POST /api/plugins-v2/{id}/enable|disable` 启用/禁用

### 6.3 测试项目

#### 6.3.1 脚本自动测试（必须 100% 通过）

**后端 pytest 测试**（`backend/tests/`）：

1. `test_agents_md_resolver.py`（30+ 用例）：
   - `test_load_global_only`
   - `test_load_project_root_only`
   - `test_load_cwd_nested`（3 层嵌套）
   - `test_override_replaces_agents_md`
   - `test_byte_limit_truncation`
   - `test_byte_limit_stops_loading`
   - `test_project_root_detection_with_git`
   - `test_project_root_detection_with_hg`
   - `test_developer_instructions_prepend`
   - `test_model_instructions_file_replace`
   - `test_fallback_filenames`
   - `test_max_depth_limit`
   - `test_invalid_path_returns_empty`
   - `test_path_traversal_blocked`
   - `test_symlink_outside_blocked`
   - `test_concurrent_load`（线程安全）
   - `test_cache_invalidation`
   - `test_persistence_to_disk`
   - `test_load_with_special_chars_in_path`
   - `test_truncation_marker`

2. `test_skill_registry.py`（30+ 用例）：
   - `test_scan_5_locations`
   - `test_location_priority_repo_over_user`
   - `test_location_priority_user_over_system`
   - `test_parse_skill_md_yaml`
   - `test_parse_skill_md_invalid_yaml`
   - `test_parse_skill_md_missing_required`
   - `test_list_skills_by_location`
   - `test_enable_disable_skill`
   - `test_rescan_forces_reload`
   - `test_concurrent_scan`（线程安全）
   - `test_lru_cache_eviction`
   - `test_skill_with_assets_dir`
   - `test_skill_with_scripts_dir`
   - `test_skill_with_references_dir`
   - `test_skill_with_agents_openai_yaml`
   - `test_persistence_to_disk`
   - `test_scan_nonexistent_location`
   - `test_scan_empty_location`
   - `test_skill_md_max_size_limit`
   - `test_yaml_injection_blocked`

3. `test_skill_invocation.py`（20+ 用例）：
   - `test_implicit_match_high_similarity`
   - `test_implicit_match_below_threshold`
   - `test_implicit_match_chinese_tokens`
   - `test_implicit_match_english_tokens`
   - `test_implicit_match_returns_top_k`
   - `test_explicit_invoke_by_name`
   - `test_explicit_invoke_with_args`
   - `test_explicit_invoke_user_invocable_false`
   - `test_explicit_invoke_disabled_skill`
   - `test_invocation_history_recorded`
   - `test_invocation_history_limit`
   - `test_invocation_concurrent`
   - `test_threshold_configurable`
   - `test_match_empty_query`
   - `test_match_no_enabled_skills`

4. `test_plugin_registry.py`（20+ 用例）：
   - `test_install_local_zip`
   - `test_install_invalid_zip`
   - `test_install_conflict_without_force`
   - `test_install_with_force`
   - `test_parse_plugin_toml`
   - `test_parse_plugin_toml_missing_required`
   - `test_resolve_dependencies`
   - `test_dependency_missing`
   - `test_enable_disable_plugin`
   - `test_uninstall_plugin`
   - `test_uninstall_builtin_blocked`
   - `test_plugin_audit_log`
   - `test_plugin_skills_loaded`
   - `test_plugin_mcp_servers_registered`

5. `test_agents_md_v2_api.py`（10+ 用例）：
   - `test_load_endpoint`
   - `test_config_get_endpoint`
   - `test_config_put_endpoint`
   - `test_detect_root_endpoint`
   - `test_load_invalid_cwd`

6. `test_skills_v2_api.py`（10+ 用例）：
   - `test_list_endpoint`
   - `test_locations_endpoint`
   - `test_rescan_endpoint`
   - `test_enable_disable_endpoint`

7. `test_skill_invocation_api.py`（10+ 用例）：
   - `test_match_endpoint`
   - `test_invoke_endpoint`
   - `test_history_endpoint`

8. `test_plugins_v2_api.py`（10+ 用例）：
   - `test_list_endpoint`
   - `test_install_endpoint`
   - `test_enable_disable_endpoint`
   - `test_uninstall_endpoint`

**总计后端**: 130+ 用例

**前端 vitest 测试**（`frontend/src/`）：

1. `useSkillRegistry.test.ts`（10+ 用例）
2. `useAgentsMdResolver.test.ts`（10+ 用例）
3. `useSkillInvocation.test.ts`（8+ 用例）
4. `usePluginRegistry.test.ts`（8+ 用例）
5. `SkillsRegistryPanel.test.tsx`（8+ 用例）
6. `AgentsMdResolverPanel.test.tsx`（8+ 用例）
7. `SkillInvocationPanel.test.tsx`（5+ 用例）
8. `PluginManagerPanel.test.tsx`（5+ 用例）

**总计前端**: 60+ 用例

**总测试数**: 190+ 用例

#### 6.3.2 前端网页手动测试（必须 100% 通过）

启动前端 dev server 后，使用 `TRAE-browseruse` skill 进行以下手动测试：

1. **Skill Registry 页面**：
   - 打开页面，确认 5 位置列表正确显示
   - 点击"Rescan"按钮，验证 skills 列表刷新
   - 切换 skill enabled 状态，验证 UI 反馈
   - 测试响应式布局（1920x1080、1366x768、375x667）

2. **AGENTS.md Resolver 页面**：
   - 输入 cwd 路径，确认 layers 列表正确显示
   - 修改 max_bytes 配置，确认 truncation 标记正确
   - 配置 developer_instructions，确认内容注入到顶层

3. **Skill Invocation 页面**：
   - 输入 "请审查代码" 测试隐式匹配
   - 输入 "$code-reviewer" 测试显式调用
   - 查看调用历史

4. **Plugin Manager 页面**：
   - 列出已安装 plugin
   - 启用/禁用 plugin
   - 卸载 plugin

5. **完整工作流测试**：
   - 创建新会话
   - 注入 AGENTS.md 内容
   - 触发隐式 skill 匹配
   - 显式调用 `$skill-name`
   - 验证 LLM 响应中包含 skill system_prompt

**通过标准**：所有上述手动测试用例均无错误。

### 6.4 代码质量

- [ ] 单元测试覆盖率 ≥ 90%
- [ ] 所有公共函数有 docstring（中文）
- [ ] 所有文件有 header comment（中文）
- [ ] 所有复杂逻辑有 inline comment（中文）
- [ ] 关键算法有复杂度分析
- [ ] 错误处理完整（无裸露 except）
- [ ] 路径遍历防护 100% 覆盖
- [ ] YAML 注入防护 100% 覆盖
- [ ] 无硬编码路径（全部走配置）

### 6.5 集成验证

- [ ] 与现有 `agents_md_memory.py` 服务共存（不破坏）
- [ ] 与现有 `skills.py` 服务共存（不破坏）
- [ ] 与现有 `skill_md.py` 解析器集成
- [ ] 与现有 `fs_watcher.py` 集成（自动 rescan）
- [ ] 与现有 frontend store 集成（状态同步）
- [ ] 与现有 WebSocket 集成（实时通知 skill 状态变化）

### 6.6 交付物

- [ ] 后端 5 个新服务 + 4 个新 API 模块
- [ ] 前端 4 个 Hook + 4 个 Panel 组件
- [ ] 130+ 后端单元测试 + 60+ 前端单元测试
- [ ] `g70-01-spec.md`（本文件）
- [ ] `CYCLE70_FINAL_REPORT.md`
- [ ] `CODE_MODIFICATION_LOG_CYCLE70.md`
- [ ] Git 提交到 main 分支
- [ ] 推送到 origin/main

---

## 七、技术风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 5 位置扫描性能 | 中 | LRU 缓存 + 增量扫描 |
| 隐式匹配准确率 | 中 | 可配置阈值 + 显式 override |
| YAML 解析安全 | 高 | 严格 pydantic + safe_load |
| Plugin 依赖冲突 | 中 | 明确优先级 + 冲突报告 |
| 与现有 API 冲突 | 低 | 新增 v2 后缀路由，不修改 v1 |
| 文件系统权限 | 中 | 错误降级 + 友好提示 |

---

**Spec 完成时间**：2026-08-05
**预计实现时间**：6-8 小时
**目标完成度**：100%
