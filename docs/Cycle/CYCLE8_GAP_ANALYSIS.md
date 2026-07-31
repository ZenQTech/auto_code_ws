# Cycle 8 差距分析报告 - Slash Commands 集成缺口

> **日期**: 2026-07-27
> **关联调研**: CYCLE8_RESEARCH_REPORT.md
> **关联版本**: 当前 v5.7.0
> **目标**: 整合 Codex/TRAE 标志性 Slash Commands 交互模式

---

## 一、核心差距

### 1.1 Slash Commands 系统 ❌ 完全缺失

**当前状态**:
- 项目无 slash command 概念
- 用户必须通过 UI 按钮触发功能
- Plan/Spec/Review/MCP/Skills/Hooks 等功能需通过 BrandHeader 菜单逐项点击

**应有状态 (Codex + TRAE 标准)**:
- 在输入框输入 `/` 弹出命令选择器
- 快速触发预设工作流
- 支持 12+ 核心命令

**影响范围**: 5/5 (核心交互模式)
**用户影响**: 严重 - 影响所有高级用户

### 1.2 Custom Skills/Commands ❌ 缺失

**当前状态**:
- 无 `.trae/commands/` 目录结构
- 无项目级或全局级命令注册机制
- 无 YAML 格式的 command 定义

**应有状态**:
- `.trae/commands/*.md` 目录扫描
- 项目级 (`<project>/.trae/commands/`) + 全局级 (`~/.trae/commands/`)
- 支持 3 级嵌套目录分类
- 包含 Name/Description/Instructions 字段

**影响范围**: 4/5 (扩展性关键)
**用户影响**: 高 - 影响用户自定义能力

### 1.3 Custom Models ❌ 缺失

**当前状态**:
- 仅有固定模型列表 (通过 ModelSelector 组件)
- 无 bearer token 刷新机制
- 无自定义 OpenAI-compatible 提供商注册

**应有状态**:
- 动态模型注册 API
- Bearer token 自动刷新
- 支持 DeepSeek/GLM/MiniMax/Kimi 等
- 5.3-Codex-Spark 1,000+ TPS 模型选择

**影响范围**: 4/5 (多模型支持)
**用户影响**: 中 - 影响高级用户

---

## 二、详细功能清单

### 2.1 P0-12 Slash Commands 系统 - 12+ 核心命令

| # | Command | 功能 | 状态 |
|---|---------|------|------|
| 1 | `/init` | 创建 AGENTS.md 项目记忆 | ❌ 缺失 |
| 2 | `/status` | 显示当前会话/token/limits | ❌ 缺失 |
| 3 | `/plan <task>` | 进入 Plan 模式生成计划 | ✅ PlanEditor 已有，UI 未对接 |
| 4 | `/spec <task>` | 进入 Spec 模式生成 spec.md | ✅ Spec 已有，UI 未对接 |
| 5 | `/review` | 触发代码审查 | ✅ reviewCode 已有，UI 未对接 |
| 6 | `/mcp` | 查看/管理 MCP 服务器 | ✅ McpPanel 已有，UI 未对接 |
| 7 | `/agents` | 配置智能体 | ✅ MultiAgentTreePanel 已有，UI 未对接 |
| 8 | `/skills` | 管理 Skills | ✅ SkillsPanelContent 已有，UI 未对接 |
| 9 | `/hooks` | 管理 Hook 事件 | ✅ HooksPanel 已有，UI 未对接 |
| 10 | `/model` | 选择模型 | ✅ ModelSelector 已有，UI 未对接 |
| 11 | `/approvals` | 切换批准模式 | ❌ 缺失 |
| 12 | `/help` | 显示命令帮助 | ❌ 缺失 |

**核心实现**:
- 后端: SlashCommandRegistry (注册/解析/执行)
- 前端: SlashCommandPicker (输入 `/` 触发)
- 统一 SlashCommandService Hook (前端调用)
- 命令执行结果通过 Toast 显示

### 2.2 P0-13 Custom Skills/Commands

| # | 功能 | 状态 |
|---|------|------|
| 1 | 项目级 `.trae/commands/` 目录扫描 | ❌ 缺失 |
| 2 | 全局级 `~/.trae/commands/` 目录扫描 | ❌ 缺失 |
| 3 | YAML/MD 格式解析 | ❌ 缺失 |
| 4 | 3 级嵌套目录分类 | ❌ 缺失 |
| 5 | 项目+全局命令合并 | ❌ 缺失 |
| 6 | 命令执行 API | ❌ 缺失 |
| 7 | Skills 管理 UI | ✅ SkillsPanelContent 已有，但只读 |

**核心实现**:
- 后端: SkillsScanner (启动时扫描 + 热加载)
- 后端: SkillsService (执行命令)
- 前端: SkillsPanelContent v2.0.0 (项目/全局双视图)
- 前端: 命令注册表

### 2.3 P0-14 Custom Models + Bearer Token Auto-Refresh

| # | 功能 | 状态 |
|---|------|------|
| 1 | 自定义模型注册 API | ❌ 缺失 |
| 2 | Bearer Token 自动刷新 | ❌ 缺失 |
| 3 | OpenAI-compatible 多 provider 支持 | ❌ 缺失 |
| 4 | 5.3-Codex-Spark 1,000+ TPS 模型 | ❌ 缺失 |
| 5 | ModelSelector 动态加载 | ❌ 缺失 |

**核心实现**:
- 后端: CustomModelRegistry
- 后端: BearerTokenRefresher (定时刷新 + 自动续期)
- 前端: CustomModelsPanel (添加/编辑/删除)
- 前端: ModelSelector 动态模式

---

## 三、实施优先级

| 任务 | 影响 | 工作量 | 优先级 | 建议周期 |
|------|------|--------|--------|----------|
| P0-12 Slash Commands | 5/5 | 中 | **高** | Cycle 8 |
| P0-13 Custom Skills | 4/5 | 中高 | **高** | Cycle 8 |
| P0-14 Custom Models | 4/5 | 中 | **高** | Cycle 8 |

**总工作量估计**: ~3000 行代码 (后端 ~1500 + 前端 ~1500)
**测试工作量**: ~40-50 个测试用例
**目标完成率**: 100%

---

## 四、风险评估

### 4.1 技术风险
- **Slash Command 与现有 UI 重叠**: 风险中等 - 需设计为补充而非替代
- **Custom Skills 路径冲突**: 风险低 - 使用标准 .trae/commands
- **Bearer Token 刷新安全**: 风险中 - 需加密存储 + 错误处理

### 4.2 兼容性风险
- **已有 BrandHeader 菜单**: 需保留兼容
- **PlanEditor/McpPanel 等已有 UI**: 通过 Slash Command 触发但保留面板打开
- **localStorage 存储兼容**: 新增 skills/custom_models key 不冲突

### 4.3 实施风险
- **命令解析的歧义性**: 需明确命令名唯一性规则
- **Skills 与 Commands 边界**: Skills 是更广义的 agent capability，Commands 是 Slash-triggered instructions

---

## 五、成功标准

### 5.1 功能完成度
- ✅ 12+ slash commands 全部可用
- ✅ `.trae/commands/` 项目级命令扫描可用
- ✅ `~/.trae/commands/` 全局级命令扫描可用
- ✅ Custom models 注册 + 刷新可用
- ✅ 3 级嵌套目录分类支持

### 5.2 质量标准
- ✅ 0 TypeScript 错误
- ✅ 0 关键 bug
- ✅ 100% 自动化测试通过率
- ✅ 单元测试 ≥ 30
- ✅ E2E 测试 ≥ 15

### 5.3 用户体验
- ✅ 输入 `/` 自动弹出命令选择器
- ✅ 命令描述清晰
- ✅ 错误处理友好
- ✅ 与已有功能无缝集成
- ✅ 无破坏性变更

---

## 六、下一阶段任务

完成 P0-12/P0-13/P0-14 后，进入：
- **Cycle 8 P1-3**: DiffView 组件
- **Cycle 8 P1-4**: Loop Engineering /loop 命令集
- **Cycle 8 P1-5**: Custom Agents 路由层 (借鉴 TRAE Kit)
- **Cycle 9**: 下一轮互联网调研 + 集成新一代 codex/trae 功能
