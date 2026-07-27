# T8: AGENTS.md 多文件类型支持 - 规格说明

## 1. 功能需求描述

### 1.1 功能目标
支持多种 AI 助手规则文件类型（AGENTS.md、CLAUDE.md、GEMINI.md、.cursorrules、README.md），实现 4 层加载架构。

### 1.2 用户场景
- 用户使用多种 AI 工具，需要统一管理项目规则
- 用户在 monorepo 中有多个子项目，需要不同层级的规则
- 用户希望为特定子目录配置专属规则

### 1.3 使用流程
1. 用户打开 AGENTS.md 面板
2. 选择项目路径 + 扫描深度 + 文件类型
3. 后端递归扫描项目目录，匹配规则文件
4. 前端展示所有发现的规则文件，按层级分组
5. 用户启用/禁用某个规则文件
6. 注入到 LLM system prompt 时按层级合并

## 2. 技术实现方案

### 2.1 技术选型
- **文件扫描**: `pathlib.rglob`（递归扫描）
- **优先级管理**: `Enum` + `dataclass`
- **合并算法**: 4 层叠加（override > sub-directory > project > user）

### 2.2 4 层加载架构

```
┌─────────────────────────────────────┐
│ Layer 1: User (~/.hermes/rules.md) │  ← 用户级
├─────────────────────────────────────┤
│ Layer 2: Project (<root>/AGENTS.md) │  ← 项目级
├─────────────────────────────────────┤
│ Layer 3: Sub-dir (<dir>/CLAUDE.md)  │  ← 子目录级
├─────────────────────────────────────┤
│ Layer 4: Override                   │  ← 覆盖级
└─────────────────────────────────────┘
```

**优先级**: Override > Sub-dir > Project > User

### 2.3 核心算法
- **文件匹配**: 多扩展名匹配（无扩展名 + 有扩展名）
- **冲突检测**: 同名文件按路径深度优先
- **合并**: 4 层顺序拼接，override 强制最高优先级

## 3. 接口设计规范

### 3.1 数据模型

```python
class RuleFileType(str, Enum):
    AGENTS_MD = "AGENTS.md"
    CLAUDE_MD = "CLAUDE.md"
    GEMINI_MD = "GEMINI.md"
    CURSORRULES = ".cursorrules"
    README_MD = "README.md"

class RuleLayer(str, Enum):
    USER = "user"
    PROJECT = "project"
    SUB_DIRECTORY = "sub_directory"
    OVERRIDE = "override"

class RuleFile(BaseModel):
    id: str
    file_type: RuleFileType
    file_path: str
    relative_path: str
    project_path: str
    layer: RuleLayer
    priority: int          # 1=user, 2=project, 3=sub_dir, 4=override
    content: str
    content_hash: str
    size: int
    enabled: bool = True
    last_loaded_at: str
```

### 3.2 REST API 端点

```http
# 扫描项目规则
POST /api/rules/scan
{
  "project_path": "/path/to/project",
  "file_types": ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
  "max_depth": 3
}
Response: { "found_count": 5, "rules": [...] }

# 列出所有规则
GET /api/rules/list?project_path=...&enabled_only=true

# 启用/禁用规则
POST /api/rules/{id}/enable
POST /api/rules/{id}/disable

# 预览合并后的注入内容
GET /api/rules/preview?project_path=...&session_id=...
Response: { "merged_content": "...", "layers": [...] }

# 删除规则记录
DELETE /api/rules/{id}
```

## 4. 数据结构定义

### 4.1 数据库表

```sql
CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    file_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    project_path TEXT NOT NULL,
    layer TEXT NOT NULL,           -- user/project/sub_directory/override
    priority INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_loaded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_path)
);
```

## 5. 性能与安全要求

### 5.1 性能指标
- 1000 个文件的扫描 ≤ 2s
- 4 层合并 ≤ 100ms
- 注入到 system prompt 延迟 < 50ms

### 5.2 安全要求
- 文件大小限制：单个文件 ≤ 5MB
- 总注入大小限制：≤ 16KB（避免撑爆上下文）
- 排除目录：.git、node_modules、venv 等

## 6. 验收标准

### 6.1 功能验收
- 5 种文件类型全部支持
- 4 层加载架构正确
- 优先级机制准确
- 冲突检测 100%

### 6.2 测试用例
- **正常场景**: 单文件/多文件/嵌套目录
- **异常场景**: 权限拒绝、符号链接循环
- **边界场景**: 1000 个文件、深度 10 层

### 6.3 通过条件
- 自动化测试通过率 100%
- 浏览器 E2E 测试通过
- TypeScript 编译 0 错误
