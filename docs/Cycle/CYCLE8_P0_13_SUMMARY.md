# Cycle 8 P0-13: Custom Skills/Commands 系统 (v5.9.0)

> **任务**: Cycle 8 P0-13 - .trae/commands/ 自定义命令
> **版本**: v5.9.0
> **日期**: 2026-07-27
> **状态**: ✅ 100% 完成
> **关联调研**: [CYCLE8_RESEARCH_REPORT.md](../../../CYCLE8_RESEARCH_REPORT.md)
> **关联差距**: [CYCLE8_GAP_ANALYSIS.md](../../../CYCLE8_GAP_ANALYSIS.md)
> **关联 P0-12**: [../slash-commands/spec.md](../slash-commands/spec.md) - Slash Commands 基础
> **关联 Spec**: [./spec.md](./spec.md)

---

## 一、任务背景

### 1.1 现状

Hermes 平台已实现 Slash Commands 系统（P0-12 v5.8.0），但 TRAE 风格的 `.trae/commands/` 目录扫描 + 用户自定义命令功能尚未实现。用户无法定义/分享自己的 Slash Command。

### 1.2 目标

实现 **Custom Skills/Commands v1.0**：
1. 扫描 `<project>/.trae/commands/` 项目级命令目录
2. 扫描 `~/.trae/commands/` 全局级命令目录
3. 解析 YAML + Markdown frontmatter 格式
4. 支持 3 级嵌套目录分类
5. 项目级 + 全局级命令自动合并（项目级优先）
6. 集成到 SlashCommandRegistry，可在 `/` 触发器中显示

---

## 二、技术实现

### 2.1 后端实现

#### `parser.py` (255 行)
- `CommandArg` 数据类（name/required/type/description/choices/default）
- `CustomCommand` 数据类（含完整元数据 + scope + parent_category）
- `extract_frontmatter()` - 解析 YAML frontmatter
- `extract_instructions()` - 提取 Instructions 块
- `parse_command_content()` / `parse_command_file()` - 解析入口
- `render_instructions()` - 占位符替换

#### `scanner.py` (296 行)
- `ScanResult` 数据类（含 commands/errors/project_count/global_count/categories）
- `CustomCommandsScanner` 单例
  - `scan_project(project_path)` - 扫描项目级
  - `scan_global()` - 扫描全局级
  - `scan_all(project_path)` - 合并扫描（项目级优先）
- 支持 3 级嵌套目录深度
- 仅扫描 `.md`/`.markdown` 文件
- `create_sample_command()` - 创建示例命令

#### `service.py` (240 行)
- `CommandExecutionResult` 数据类
- `CustomCommandsService` 单例
  - `refresh(project_path)` - 重新扫描 + 同步到 SlashCommandRegistry
  - `list_commands(scope, category)` - 列出命令
  - `get_command(name)` - 按名称获取（支持 user- 前缀）
  - `execute_command(name, args)` - 执行（生成 LLM 提示词）
  - `register/unregister` - 手动 CRUD
  - `get_summary()` - 摘要统计
  - `_sync_to_slash_registry()` - 同步到 SlashCommandRegistry

#### `api/custom_commands.py` (240 行)
9 个 REST API 端点:
- `GET /api/custom-commands/summary` - 摘要
- `GET /api/custom-commands` - 列出所有
- `GET /api/custom-commands/categories` - 分类
- `GET /api/custom-commands/scope/{project|global}` - 按 scope
- `GET /api/custom-commands/{name}` - 详情
- `POST /api/custom-commands/{name}/execute` - 执行
- `POST /api/custom-commands/refresh` - 重新扫描
- `POST /api/custom-commands` - 创建
- `DELETE /api/custom-commands/{name}` - 删除

### 2.2 前端实现

#### `hooks/useCustomCommands.ts` (270 行)
- TypeScript 类型: `CustomCommand`, `CustomCommandArg`, `CustomCommandSummary`, `CommandExecutionResult`
- `useCustomCommandsList()` - 列表 Hook
- `useCustomCommandSummary()` - 摘要 Hook
- `useExecuteCustomCommand()` - 执行 Hook
- `useRefreshCustomCommands()` - 刷新 Hook
- `useDeleteCustomCommand()` - 删除 Hook

#### `components/SkillsPanelContent.tsx` v2.0.0 (476 行)
- **双视图**: 项目级 / 全局级 / 内置 Skills 三个 Tab
- **统计卡片**: 4 维统计（总命令/项目级/全局级/分类数）
- **搜索 + 分类过滤**
- **创建表单**: 名称/描述/分类/图标/Instructions
- **执行预览**: 渲染后的提示词实时展示
- **详情弹窗**: 完整命令元数据 + 路径
- **分类树形**: 按 parent_category 分组

### 2.3 示例命令（演示用）

创建了 4 个示例命令展示 .trae/commands/ 用法:
- `.trae/commands/code-review/security.md` - 安全漏洞审查
- `.trae/commands/code-review/performance.md` - 性能审查
- `.trae/commands/test/generate.md` - 单元测试生成
- `.trae/commands/docs/api.md` - API 文档生成

### 2.4 集成修改

| 文件 | 修改内容 |
|------|---------|
| `backend/app/main.py` | 注册 `/api/custom-commands` 路由 + 启动时扫描 |
| `backend/app/services/custom_commands/service.py` | 集成到 SlashCommandRegistry（user- 前缀） |

---

## 三、文件格式

### 3.1 YAML Frontmatter

```yaml
---
Name: command-name           # 必需
Description: 一句话描述       # 必需
Category: code-review        # 可选
Icon: 🔒                      # 可选，默认 📦
Aliases: [alias1, alias2]     # 可选
Permission: user              # 可选，默认 user
Args:                         # 可选
  - name: focus
    required: false
    type: string
    description: ...
    choices: [a, b, c]
    default: all
AllowedTools: [tool1, tool2]  # 可选
---
```

### 3.2 Body（Markdown + Instructions）

```markdown
Instructions: |
  Multi-line
  LLM instructions
  with {arg_name} placeholders
```

---

## 四、测试结果

### 4.1 单元测试

**文件**: `tests/test_custom_commands_units.py` (568 行, 31 个测试)

| 测试类 | 数量 | 通过率 |
|--------|------|--------|
| T1: CustomCommandParser | 10 | 100% |
| T2: CustomCommandsScanner | 8 | 100% |
| T3: CustomCommandsService | 10 | 100% |
| T4: 与 SlashCommandRegistry 集成 | 3 | 100% |
| **合计** | **31** | **100%** |

测试覆盖：
- Frontmatter 解析（基本/带参数/别名图标/无效 YAML/空内容）
- 扫描器（空目录/单文件/嵌套目录/非 .md 跳过/深度限制/合并/优先级）
- 服务（refresh/list/get/execute/参数校验/占位符替换/CRUD/summary）
- 集成（同步到 registry/多命令同步/列表包含用户命令）

### 4.2 E2E 测试

**文件**: `tests/test_e2e_custom_commands.sh` (215 行, 12 个测试)

| 测试组 | 数量 | 通过率 |
|--------|------|--------|
| [1] 摘要端点 | 1 | 100% |
| [2] 列出所有命令 | 1 | 100% |
| [3] 分类端点 | 1 | 100% |
| [4] 按 scope 列出 | 1 | 100% |
| [5] 创建 + 刷新 | 2 | 100% |
| [6] 查询命令详情 | 1 | 100% |
| [7] 执行命令 | 2 | 100% |
| [8] 查询不存在的命令 | 1 | 100% |
| [9] 与 SlashCommandRegistry 集成 | 1 | 100% |
| [10] 注销命令 | 1 | 100% |
| **合计** | **12** | **100%** |

### 4.3 编译与构建

| 检查项 | 结果 |
|--------|------|
| TypeScript 严格模式编译 | ✅ 0 错误 |
| Vite 生产构建 | ✅ 11.52s 成功 |
| 后端服务启动 | ✅ /api/custom-commands 正常 |

### 4.4 实际扫描结果

```json
{
  "success": true,
  "scan": {
    "project_count": 4,
    "global_count": 0,
    "total": 4,
    "categories": ["code-review", "docs", "test"]
  }
}
```

---

## 五、交付清单

### 5.1 新增文件 (12 个)

| 路径 | 行数 | 说明 |
|------|------|------|
| `backend/app/services/custom_commands/parser.py` | 255 | 解析器 |
| `backend/app/services/custom_commands/scanner.py` | 296 | 扫描器 |
| `backend/app/services/custom_commands/service.py` | 240 | 服务层 |
| `backend/app/api/custom_commands.py` | 240 | REST API |
| `frontend/src/hooks/useCustomCommands.ts` | 270 | API Hook |
| `frontend/src/components/SkillsPanelContent.tsx` | 476 | v2.0.0 UI |
| `tests/test_custom_commands_units.py` | 568 | 单元测试 |
| `tests/test_e2e_custom_commands.sh` | 215 | E2E 测试 |
| `.trae/specs/cycle8/custom-skills/spec.md` | - | 技术规范 |
| `CYCLE8_P0_13_SUMMARY.md` | - | 总结报告 |
| `.trae/commands/code-review/security.md` | - | 示例命令 |
| `.trae/commands/code-review/performance.md` | - | 示例命令 |
| `.trae/commands/test/generate.md` | - | 示例命令 |
| `.trae/commands/docs/api.md` | - | 示例命令 |

### 5.2 修改文件 (2 个)

| 路径 | 修改内容 |
|------|---------|
| `backend/app/main.py` | 注册路由 + 启动时扫描 |
| `frontend/src/components/SkillsPanelContent.tsx` | 完全重写为 v2.0.0 |

### 5.3 测试统计

| 测试维度 | 数量 | 通过率 |
|----------|------|--------|
| 单元测试 | 31 | 100% |
| E2E 测试 | 12 | 100% |
| TypeScript 严格模式 | - | 0 错误 |
| Vite 生产构建 | - | 11.52s 成功 |
| 后端 API 端点 | 9 | 100% 可用 |
| **总计** | **43** | **100%** |

---

## 六、关键设计决策

### 6.1 单例服务 + 启动时扫描

`CustomCommandsService` 使用单例模式，应用启动时自动扫描 `.trae/commands/`，避免每次请求都重新扫描。

### 6.2 项目级优先

合并时项目级命令覆盖同名全局级命令，遵循"项目特化 > 全局默认"原则。

### 6.3 user- 前缀避免冲突

集成到 SlashCommandRegistry 时，自定义命令统一加 `user-` 前缀，避免与内置 18 个命令冲突。

### 6.4 3 级嵌套目录分类

通过 `parent_category` 字段记录目录层级（如 `code-review/security`），支持 UI 中的分类树形展示。

### 6.5 占位符替换

Instructions 中支持 `{arg_name}` 占位符，execute 时根据 args 字典替换，符合 prompt engineering 最佳实践。

---

## 七、与 P0-12 集成

P0-13 复用 P0-12 的 SlashCommandRegistry：
- 自定义命令以 `user-` 前缀注册到 registry
- 用户在 `/` 触发器中可见所有内置 + 自定义命令
- Picker 中通过 `built_in=False` 字段区分
- Category 统一归入 `CUSTOM` 分类

---

## 八、下一轮规划

完成 P0-13 后继续推进：
- **P0-14 Custom Models + Bearer Token Auto-Refresh**
- **P1-3 DiffView 组件**
- **P1-4 Loop Engineering /loop 命令集**

---

## 九、总结

Cycle 8 P0-13 Custom Skills/Commands 系统已 100% 完成并通过所有测试：
- ✅ 项目级 + 全局级 .trae/commands/ 扫描
- ✅ YAML frontmatter 解析 + 3 级嵌套目录分类
- ✅ 9 个 REST API 端点
- ✅ SkillsPanelContent v2.0.0（双视图 + 统计 + 搜索 + 创建 + 执行 + 详情）
- ✅ 集成到 SlashCommandRegistry（user- 前缀）
- ✅ 31 个单元测试 + 12 个 E2E 测试 = 100% 通过
- ✅ TypeScript 编译 0 错误 + Vite 构建 11.52s
- ✅ 4 个示例命令覆盖 code-review/test/docs 分类

**Cycle 8 P0-13 完成度**: 100%
**交付日期**: 2026-07-27
**下一任务**: Cycle 8 P0-14 Custom Models + Bearer Token Auto-Refresh
