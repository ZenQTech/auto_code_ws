# Cycle 12 P0-1 Plugin System - 总结报告

## 概述

完成 Hermes 智能体调度平台的 **Plugin 系统**（Cycle 12 P0-1），实现 Codex v0.150+ 风格的 Plugin 打包分发机制，支持将 skills/agents/rules/hooks/commands 等组件打包为可分发 bundle。

## 版本

**v6.18.0** - 2026-07-28

## 核心能力

### 1. 数据模型 (`app/core/plugins/base.py`)
- **PluginManifest**: Plugin 元数据（id/name/version/description/author/license/dependencies/components/permissions/verification）
- **Plugin**: 运行时实体（manifest + base_path + status + enabled + installed_at/loaded_at）
- **PluginAuthor/Components/Dependencies/Permissions/Verification/Repository**: 嵌套数据模型
- **PluginStatus**: 枚举（AVAILABLE/INSTALLED/ENABLED/ERROR/UNINSTALLED）
- **ComponentType**: 枚举（SKILL/AGENT/RULE/HOOK/COMMAND）

### 2. 异常体系 (`app/core/plugins/exceptions.py`)
- PluginError（基础异常）
- PluginNotFoundError / PluginAlreadyExistsError
- ManifestError / ManifestValidationError
- DependencyError / VersionConflictError / CircularDependencyError
- SignatureError / PermissionError
- ComponentNotFoundError / InstallError

### 3. 加载器 (`app/core/plugins/loader.py`)
- 目录扫描（隐藏目录/_template 跳过）
- manifest.json 解析与验证
- 路径白名单（防止任意目录访问）
- 错误隔离（单个 Plugin 失败不影响整体）
- 加载历史记录

### 4. 注册表 (`app/core/plugins/registry.py`)
- 线程安全（RLock）
- 多索引（id/name/category/status）
- CRUD 操作
- enable/disable 生命周期管理
- 全文搜索
- 统计信息

### 5. 依赖解析器 (`app/core/plugins/resolver.py`)
- semver 版本比较（eq/lt/gt/le/ge/~^）
- hermes_version 检查
- python_version 检查
- 循环依赖检测（DFS）
- 拓扑排序（Kahn 算法）
- 依赖完整检查

### 6. 验证器 (`app/core/plugins/validator.py`)
- manifest 字段验证（id kebab-case / version semver / email 等）
- 路径白名单检查
- 组件存在性验证
- 校验和计算
- 一致性验证

### 7. 安装器 (`app/core/plugins/installer.py`)
- install（从源目录安装并复制到安装目录）
- uninstall（清理目录 + 注册表）
- enable/disable（启用/禁用）
- reload（重新加载）
- scan_and_register（扫描并注册）
- 依赖检查（缺失依赖报错）
- 卸载保护（有依赖者禁止卸载）

### 8. REST API (`app/api/plugins.py`)
提供 12 个 REST 端点：
- `GET /api/plugins/health` - 健康检查
- `GET /api/plugins/list` - 列出 Plugin（支持 status/category/enabled_only 过滤）
- `GET /api/plugins/stats` - 统计信息
- `POST /api/plugins/scan` - 扫描目录
- `POST /api/plugins/install` - 安装 Plugin
- `POST /api/plugins/uninstall` - 卸载 Plugin
- `POST /api/plugins/enable` - 启用 Plugin
- `POST /api/plugins/disable` - 禁用 Plugin
- `GET /api/plugins/{plugin_id}` - Plugin 详情
- `POST /api/plugins/{plugin_id}/reload` - 重新加载
- `GET /api/plugins/marketplace/search` - 搜索
- `GET /api/plugins/categories/list` - 分类列表

## 测试结果

### 单元测试
- 文件: `tests/test_plugin_units.py`
- 数量: 92 个测试用例
- 覆盖: 数据模型、异常、加载器、注册表、依赖解析器、验证器、安装器、生命周期
- 通过率: 100% (92/92)

### E2E 测试
- 文件: `tests/test_e2e_plugin.sh`
- 数量: 48 个断言
- 覆盖: health/list/stats/scan/install/get/enable/disable/reload/search/categories/错误处理
- 通过率: 100% (48/48)

### 总计
- 单元测试: 92/92 ✓
- E2E 测试: 48/48 ✓
- 总断言: 140/140 ✓
- 通过率: 100%

## 示例 Plugin

### 1. hermes-core (`tests/plugins/hermes-core/`)
- id: `hermes-core`
- version: 1.0.0
- components: 2 skills, 2 agents, 1 hook
- skills: memory-kernel, verification-loop
- agents: architect.md, critic.md
- hooks: session-start.json

### 2. sentry-triage (`tests/plugins/sentry-triage/`)
- id: `sentry-triage`
- version: 1.0.0
- components: 2 agents, 1 hook
- agents: triage.md, escalation.md
- hooks: error-detect.json

## 关键设计

### 1. 安全性
- **路径白名单**: 仅允许 `/home/qizheng/auto_code_ws`、`/home/qizheng/.hermes/plugins`、`/tmp/hermes-plugins`、`/tmp/test-plugins` 等已知安全路径
- **manifest 严格校验**: id kebab-case、version semver、email 格式、URL 格式
- **路径遍历保护**: 组件路径不允许 `..` 跳出 base_path

### 2. 可靠性
- **错误隔离**: 单个 Plugin 加载失败不影响其他 Plugin
- **线程安全**: Registry 使用 RLock 保护
- **原子操作**: install/uninstall 失败自动回滚

### 3. 可扩展性
- **多组件类型**: 支持 skills/agents/rules/hooks/commands
- **依赖管理**: semver 范围 + 循环检测
- **权限系统**: Plugin 声明所需权限

### 4. 易用性
- **全局单例**: `get_installer()` / `get_registry()` / `get_loader()` / `get_resolver()` / `get_validator()`
- **统一响应格式**: `{success, plugin, message}` 或 `{success, data}`
- **RESTful 设计**: 12 个端点覆盖完整生命周期

## 依赖与版本变化

### 新增文件
- `backend/app/core/plugins/__init__.py`
- `backend/app/core/plugins/exceptions.py`
- `backend/app/core/plugins/base.py`
- `backend/app/core/plugins/loader.py`
- `backend/app/core/plugins/registry.py`
- `backend/app/core/plugins/resolver.py`
- `backend/app/core/plugins/validator.py`
- `backend/app/core/plugins/installer.py`
- `backend/app/api/plugins.py`
- `tests/test_plugin_units.py`
- `tests/test_e2e_plugin.sh`
- `tests/plugins/hermes-core/manifest.json`
- `tests/plugins/hermes-core/skills/memory-kernel.md`
- `tests/plugins/hermes-core/skills/verification-loop.md`
- `tests/plugins/hermes-core/agents/architect.md`
- `tests/plugins/hermes-core/agents/critic.md`
- `tests/plugins/hermes-core/hooks/session-start.json`
- `tests/plugins/sentry-triage/manifest.json`
- `tests/plugins/sentry-triage/agents/triage.md`
- `tests/plugins/sentry-triage/agents/escalation.md`
- `tests/plugins/sentry-triage/hooks/error-detect.json`

### 修改文件
- `backend/app/api/__init__.py` - 添加 Plugin 路由注册
- `backend/app/core/plugins/loader.py` - 添加 E2E 测试路径白名单

## 使用方法

### 安装 Plugin

```bash
# 从本地目录安装
curl -X POST http://localhost:8765/api/plugins/install \
    -H "Content-Type: application/json" \
    -d '{"source_path":"/path/to/plugin"}'

# 扫描并注册所有 Plugin
curl -X POST http://localhost:8765/api/plugins/scan

# 启用 Plugin
curl -X POST http://localhost:8765/api/plugins/enable \
    -H "Content-Type: application/json" \
    -d '{"plugin_id":"hermes-core"}'
```

### manifest.json 示例

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com"
  },
  "license": "MIT",
  "hermes_version": ">=6.18.0",
  "dependencies": {
    "plugins": [],
    "python": ">=3.10"
  },
  "components": {
    "skills": ["skills/skill1.md"],
    "agents": ["agents/agent1.md"],
    "hooks": ["hooks/hook1.json"]
  },
  "permissions": {
    "network": false,
    "filesystem": ["read"],
    "execute": false
  }
}
```

## 后续计划

### Cycle 12 P0-2: /goal 长时域模式
- Three-File Trust 架构（GOAL.md / VERIFY.md / PROGRESS.md）
- 持久化目标状态
- 暂停/恢复机制
- Token 预算控制
- Checkpoint 机制

### Cycle 12 P1-7: Plugin 市场 UI
- 前端 Plugin 管理面板
- 启用/禁用开关
- 详细信息展示
- 安装向导

### Cycle 12 P1-8: Plugin 签名验证
- RSA 签名验证
- 公钥管理
- 签名流程
