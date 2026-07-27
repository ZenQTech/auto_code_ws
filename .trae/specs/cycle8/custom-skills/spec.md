# Cycle 8 P0-13: Custom Skills/Commands (.trae/commands/) 系统 (v5.9.0)

> **任务**: Cycle 8 P0-13
> **版本**: v5.9.0
> **日期**: 2026-07-27
> **状态**: 实施阶段
> **关联调研**: [CYCLE8_RESEARCH_REPORT.md](../../../CYCLE8_RESEARCH_REPORT.md)
> **关联差距**: [CYCLE8_GAP_ANALYSIS.md](../../../CYCLE8_GAP_ANALYSIS.md)
> **关联 P0-12**: [./slash-commands/spec.md](../slash-commands/spec.md) - Slash Commands 基础

---

## 一、任务背景

### 1.1 现状

Hermes 平台已实现 Slash Commands 系统（P0-12），包含 18 个内置命令。但 TRAE 风格的 `.trae/commands/` 目录扫描 + 用户自定义命令功能尚未实现。

### 1.2 问题

- **扩展性受限**: 用户无法定义自己的 Slash Command
- **无法共享**: 团队成员之间无法共享自定义命令
- **不符合 TRAE 标准**: 偏离行业最佳实践

### 1.3 目标

实现 **Custom Skills/Commands v1.0**：
1. 扫描 `<project>/.trae/commands/` 项目级命令目录
2. 扫描 `~/.trae/commands/` 全局级命令目录
3. 解析 YAML + Markdown frontmatter 格式
4. 支持 3 级嵌套目录分类
5. 项目级 + 全局级命令自动合并
6. 集成到 SlashCommandRegistry 中，可在 `/` 触发器中显示

---

## 二、技术调研

参考 [TRAE Custom Commands 文档](https://docs.trae.ai/ide/slash-commands)：

| 特性 | TRAE 实现 |
|------|----------|
| 项目级命令 | `.trae/commands/*.md` |
| 全局级命令 | `~/.trae/commands/*.md` |
| 文件格式 | YAML frontmatter + Markdown body |
| 嵌套目录 | 支持 3 级目录分类 |
| 文件格式示例 | 见下文 |

### 2.1 文件格式

```markdown
---
Name: summarize-pr-info
Description: 总结 PR 信息
---

Instructions: |
  Review the code changes in the current pull request, compare the code
  before and after the changes, and summarize the main changes of this
  pull request.
```

### 2.2 嵌套目录示例

```
.trae/commands/
├── code-review/
│   ├── security.md
│   ├── performance.md
│   └── style.md
├── test/
│   ├── unit.md
│   └── e2e.md
└── documentation/
    ├── api.md
    └── user-guide.md
```

---

## 三、技术实现

### 3.1 后端实现

#### 3.1.1 `skills_parser.py` (~120 行)
- `parse_skill_file(path)` - 解析单个 .md 文件
- `parse_frontmatter(content)` - 解析 YAML frontmatter
- `extract_name(content)` - 提取命令名
- `extract_description(content)` - 提取描述
- `extract_instructions(content)` - 提取指令内容

#### 3.1.2 `skills_scanner.py` (~200 行)
- `SkillsScanner` 类
  - `scan_project(project_path)` - 扫描项目级命令
  - `scan_global()` - 扫描全局级命令
  - `scan_all(project_path)` - 合并扫描（项目+全局）
  - `categorize(path)` - 提取分类（最多 3 级目录）
- 单例 + 启动时扫描 + 缓存
- 热加载：监听文件变化

#### 3.1.3 `skills_service.py` (~180 行)
- `Skill` 数据模型（id/name/display_name/description/instructions/category/path/scope）
- `SkillsService` 类
  - `list_skills(scope=None)` - 列出所有/项目级/全局级
  - `get_skill(name)` - 按名称获取
  - `execute_skill(name, args)` - 执行（调用 LLM with skill instructions）
  - `register_skill(skill)` - 注册
  - `unregister_skill(name)` - 注销

#### 3.1.4 `skills.py` API 端点 (~250 行)
- `GET /api/skills` - 列出所有 skills
- `GET /api/skills/scope/{project|global|all}` - 按 scope 列出
- `GET /api/skills/categories` - 列出所有分类
- `GET /api/skills/{name}` - 查询 skill 详情
- `POST /api/skills/{name}/execute` - 执行 skill
- `POST /api/skills` - 创建 skill（仅管理员/测试用）
- `DELETE /api/skills/{name}` - 删除 skill（仅管理员/测试用）
- `POST /api/skills/reload` - 重新扫描目录

### 3.2 前端实现

#### 3.2.1 `useSkillsApi.ts` (~250 行)
- `useSkillsList(scope)` - 获取 skill 列表
- `useSkillDetail(name)` - 获取 skill 详情
- `useSkillCategories()` - 获取分类
- `useExecuteSkill()` - 执行 skill
- `useReloadSkills()` - 重新扫描
- `useCreateSkill()` - 创建 skill
- `useDeleteSkill()` - 删除 skill

#### 3.2.2 `SkillsPanelContent.tsx` v2.0.0 (~300 行)
- **项目级 / 全局级 Tab 切换**
- **分类树形展示**（3 级嵌套）
- **搜索/过滤**
- **创建/删除 Skill**
- **执行 Skill 预览**
- **统计卡片**（总技能数/启用/分类数）

#### 3.2.3 SlashCommand 集成
- `slash_command_registry.py` 添加 `_register_custom_skills()` 方法
- 启动时自动扫描 + 注册到 SlashCommandRegistry
- 用户在 `/` 触发器中可直接看到自定义命令

### 3.3 集成修改

| 文件 | 修改内容 |
|------|---------|
| `backend/app/main.py` | 注册 `/api/skills` 路由 + 启动时扫描 |
| `backend/app/services/slash_command_registry.py` | 集成自定义 skill 命令 |
| `frontend/src/hooks/useModals.ts` | 已有 skills panel（保留兼容） |
| `frontend/src/components/AppLayout.tsx` | 集成 v2.0 升级后的 SkillsPanelContent |
| `frontend/src/components/SlashCommandHelp.tsx` | 显示自定义 skill 数量统计 |

---

## 四、文件格式规范

### 4.1 必需字段

| 字段 | 类型 | 说明 |
|------|------|------|
| Name | string | 命令名（kebab-case） |
| Description | string | 一句话描述 |

### 4.2 可选字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| Category | string | 目录名 | 自定义分类 |
| Icon | string | "📦" | 显示图标 |
| Aliases | list | [] | 命令别名 |
| Permission | string | "user" | 权限级别 |
| Args | list | [] | 参数定义 |
| AllowedTools | list | [] | 允许使用的工具 |

### 4.3 完整示例

```markdown
---
Name: code-review-security
Description: 审查代码中的安全漏洞
Category: code-review
Icon: 🔒
Aliases: [crs, sec-review]
Permission: user
Args:
  - name: focus
    required: false
    type: string
    description: 重点关注的安全领域（如 sql-injection, xss, auth）
AllowedTools: [code_search, file_read]
---

Instructions: |
  You are a security-focused code reviewer. Analyze the code for:
  1. SQL injection vulnerabilities
  2. XSS attack vectors
  3. Authentication/authorization issues
  4. Sensitive data exposure
  5. Insecure deserialization

  Focus on: {focus}

  Output a structured report with severity levels (Critical/High/Medium/Low)
  and provide specific code locations with line numbers.
```

---

## 五、测试要求

### 5.1 单元测试

- T1: SkillsParser - 解析各种格式（最少 10 个测试）
- T2: SkillsScanner - 扫描目录结构（最少 8 个测试）
- T3: SkillsService - CRUD + 执行（最少 10 个测试）
- T4: 集成 - 与 SlashCommandRegistry 集成（最少 5 个测试）
- **合计**: ≥ 33 个单元测试

### 5.2 E2E 测试

- [1] 列出 skills API
- [2] 按 scope 列出
- [3] 查询 skill 详情
- [4] 执行 skill
- [5] 创建/删除 skill
- [6] 重新扫描目录
- [7] 与 SlashCommandRegistry 集成
- **合计**: ≥ 14 个 E2E 测试

### 5.3 验收标准

- ✅ 项目级 `.trae/commands/` 扫描可用
- ✅ 全局级 `~/.trae/commands/` 扫描可用
- ✅ YAML frontmatter 解析正确
- ✅ 3 级嵌套目录分类支持
- ✅ 项目+全局命令合并无重复
- ✅ 集成到 SlashCommandRegistry
- ✅ 0 TypeScript 错误
- ✅ 100% 自动化测试通过率

---

## 六、风险评估

### 6.1 文件系统访问
- **风险**: 项目路径不存在或权限不足
- **缓解**: 优雅降级（返回空列表 + 警告日志）

### 6.2 解析失败
- **风险**: 用户编写错误格式的 .md 文件
- **缓解**: 跳过错误文件 + 错误详情记录

### 6.3 与 SlashCommandRegistry 冲突
- **风险**: 自定义 skill 名称与内置命令冲突
- **缓解**: 自定义 skill 名称加 `user-` 前缀或优先级处理

---

## 七、交付清单

- ✅ 4 个新后端文件（parser + scanner + service + api）
- ✅ 2 个新前端文件（hook + upgraded component）
- ✅ 5 个修改文件（main + registry + modals + AppLayout + help）
- ✅ 1 个单元测试文件（≥ 33 测试）
- ✅ 1 个 E2E 测试文件（≥ 14 测试）
- ✅ 1 个总结报告（CYCLE8_P0_13_SUMMARY.md）

---

## 八、下一轮规划

完成 P0-13 后，继续推进：
- **P0-14 Custom Models + Bearer Token Auto-Refresh**
- **P1-3 DiffView 组件**
- **P1-4 Loop Engineering /loop 命令集**
