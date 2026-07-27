# Cycle 8 P0-12: Slash Commands 系统 (v5.8.0)

> **任务**: Cycle 8 P0-12
> **版本**: v5.8.0
> **日期**: 2026-07-27
> **状态**: 实施阶段
> **关联调研**: CYCLE8_RESEARCH_REPORT.md
> **关联差距**: CYCLE8_GAP_ANALYSIS.md

---

## 一、任务背景

### 1.1 现状

项目当前缺乏 Codex/TRAE 标志性的 Slash Commands 交互模式。用户必须通过 BrandHeader 菜单逐项点击触发 Plan/Spec/Review/MCP/Skills/Hooks 等功能，无法快速通过键盘输入 `/` 触发。

### 1.2 问题

- **效率低**: 触发常用功能需多次点击
- **不可发现**: 用户难以发现所有可用功能
- **不可编程**: 无法通过命令组合批量触发
- **不符合 codex/trae 标准**: 偏离行业最佳实践

### 1.3 目标

实现 **Slash Commands v1.0**，整合 12+ 核心命令：
1. 输入 `/` 弹出命令选择器
2. 支持命令搜索/过滤
3. 整合已有功能（Plan/Spec/Review/MCP/Skills/Hooks/Model/Agents）
4. 新增内置命令（/init /status /approvals /help /next）
5. 支持命令参数解析

---

## 二、技术调研

### 2.1 参考实现

| 来源 | 关键特性 |
|------|----------|
| Codex CLI v0.150+ | 40+ commands, 6 大类, Tab 补全 |
| TRAE v2.0+ | /plan /spec 内置, .trae/commands/*.md 自定义 |
| Claude Code | /skill-name "args" 模式 |
| Loop System | /loop triage/plan/execute/verify |

### 2.2 关键技术点

1. **命令注册表**: 后端 + 前端双注册
2. **命令解析**: `/command [args]` 模式
3. **命令选择器 UI**: 浮动下拉 + 键盘导航
4. **命令执行**: 异步 + 进度反馈 + 错误处理
5. **命令历史**: localStorage 持久化
6. **命令权限**: 用户可启用/禁用

---

## 三、技术实现

### 3.1 后端架构

#### 3.1.1 数据模型 (SlashCommand)
```python
{
    "name": str,             # 命令名（不含 /）
    "description": str,       # 命令描述
    "category": str,          # 分类 (navigation/workspace/ux/agent/...)
    "args": List[Arg],        # 参数定义
    "aliases": List[str],     # 别名
    "handler": str,           # 处理函数路径
    "enabled": bool,          # 是否启用
    "built_in": bool,         # 是否内置
    "permission": str,        # 所需权限
}
```

#### 3.1.2 核心服务
- `SlashCommandRegistry`: 命令注册/查询
- `SlashCommandExecutor`: 命令执行
- `SlashCommandHistory`: 历史记录
- API 端点:
  - `GET /api/slash-commands` - 列出所有命令
  - `POST /api/slash-commands/execute` - 执行命令
  - `GET /api/slash-commands/history` - 查询历史

### 3.2 前端架构

#### 3.2.1 核心组件
- `SlashCommandPicker`: 命令选择器 UI
- `useSlashCommands`: 命令注册表 Hook
- `useSlashCommandExecutor`: 命令执行 Hook
- `SlashCommandInput`: 增强的输入框（检测 `/` 触发）

#### 3.2.2 12+ 核心命令实现

| Command | Handler | UI 集成 |
|---------|---------|---------|
| `/init` | 创建 AGENTS.md | 触发新工作流 |
| `/status` | 显示会话信息 | 弹出 StatusPanel |
| `/plan` | 进入 Plan 模式 | 打开 PlanEditorModal |
| `/spec` | 进入 Spec 模式 | 触发 Spec 生成 |
| `/review` | 触发代码审查 | 调用 reviewCode |
| `/mcp` | MCP 管理 | 打开 McpPanel |
| `/agents` | Agent 管理 | 打开 MultiAgentTreePanel |
| `/skills` | Skills 管理 | 打开 SkillsPanelContent |
| `/hooks` | Hooks 管理 | 打开 HooksPanel |
| `/model` | 模型选择 | 打开 ModelSelector |
| `/approvals` | 批准模式 | 切换 ask/auto/sandbox |
| `/help` | 显示帮助 | 弹出命令列表 |

#### 3.2.3 SlashCommandPicker UI
```
+----------------------------------+
| 🔍 搜索命令...                    |
+----------------------------------+
| 📋 Plan & Spec                   |
|   /plan [task]   进入 Plan 模式  |
|   /spec [task]   进入 Spec 模式  |
+----------------------------------+
| 🔧 Workspace                     |
|   /init           创建 AGENTS.md |
|   /status         显示会话状态   |
+----------------------------------+
```

---

## 四、交付清单

### 4.1 后端 (5 个新文件)
1. `backend/app/services/slash_command_registry.py` - 命令注册表
2. `backend/app/services/slash_command_executor.py` - 命令执行器
3. `backend/app/api/slash_commands.py` - API 端点
4. `backend/app/models/slash_command.py` - 数据模型
5. `tests/test_slash_command_units.py` - 单元测试

### 4.2 前端 (6 个新文件 + 2 个修改)
1. `frontend/src/hooks/useSlashCommands.ts` - 命令 Hook
2. `frontend/src/hooks/useSlashCommandExecutor.ts` - 执行 Hook
3. `frontend/src/components/SlashCommandPicker.tsx` - 命令选择器
4. `frontend/src/components/SlashCommandInput.tsx` - 增强输入框
5. `frontend/src/components/SlashCommandHelp.tsx` - 帮助面板
6. `frontend/src/utils/slashCommandParser.ts` - 命令解析
7. **修改**: `AppLayout.tsx` - 集成 SlashCommandPicker
8. **修改**: `useModals.ts` - 添加 slashCommandPanel

### 4.3 测试
- 单元测试: 25 个
- E2E 测试: 15 个

---

## 五、测试要求

### 5.1 单元测试
- SlashCommandRegistry 注册/查询/过滤
- SlashCommandExecutor 执行/错误处理/超时
- SlashCommandParser 解析多种命令格式
- 12 个内置命令全部有测试

### 5.2 E2E 测试
- 输入 `/` 触发选择器
- 键盘上下选择
- Enter 执行命令
- 命令参数解析
- 错误处理

### 5.3 浏览器测试
- 7 个命令的实际执行流程
- UI 响应性
- 错误提示

---

## 六、验收标准

| 标准 | 量化指标 |
|------|----------|
| 12+ 命令可用 | ≥ 12 个内置命令 |
| 命令选择器响应 | 输入 `/` 后 < 200ms 显示 |
| 单元测试通过 | 25/25 通过 |
| E2E 测试通过 | 15/15 通过 |
| TypeScript 编译 | 0 错误 |
| Vite 构建 | 成功 |
| 浏览器实际测试 | 7+ URL 通过 |
| 与已有功能集成 | 12 个命令全部可触发对应面板 |

---

## 七、修改记录

- 2026-07-27 | v5.8.0 | Cycle 8 P0-12 实施 - Slash Commands 系统
