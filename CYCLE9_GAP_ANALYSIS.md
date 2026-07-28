# Cycle 9 差距分析报告

> **周期**: Cycle 9
> **日期**: 2026-07-28
> **状态**: ✅ 差距识别完成
> **关联**: [CYCLE9_RESEARCH_REPORT.md](../CYCLE9_RESEARCH_REPORT.md) | [CYCLE9_PLANNING.md](../CYCLE9_PLANNING.md)

---

## 一、差距总览

### 1.1 整体覆盖率

| 维度 | 已实现 | 目标 | 覆盖率 |
|------|--------|------|--------|
| **Codex v0.135+** Slash Commands | 14/15 | 15+ | 93% |
| **TRAE Solo v3.5+** 核心特性 | 9/12 | 12+ | 75% |
| **`.codex` / `.trae` 目录** | 4/8 | 8+ | 50% |
| **Hooks 事件** | 5/6 | 6+ | 83% |
| **Multi-Agent 路由** | 1/2 | 2+ | 50% |
| **Skills 性能** | 基础/优化 | 优化 | 70% |
| **整体覆盖率** | - | - | **78%** |

### 1.2 优先级分布

| 优先级 | 任务数 | 预估工时 |
|--------|--------|----------|
| P0（核心） | 2 | 7h |
| P1（增强） | 6 | 21h |
| P2（长期） | 5 | 29h |
| **总计** | **13** | **57h** |

---

## 二、详细差距分析

### 2.1 P0 核心差距

#### 2.1.1 P0-17 `.trae/agents/` 子智能体目录路由

**当前状态**：
- ✅ Multi-Agent v2 path-based addressing（Cycle 7 P0-10）已实现
- ❌ 缺少 `.trae/agents/*.md` 文件扫描注册
- ❌ 缺少从 markdown frontmatter 解析可调用子智能体

**TRAE v3.5.67 规范**：
- 项目级 `.trae/agents/<identifier>.md`
- YAML frontmatter: name, prompt, callable, when_to_call
- Built-in "Agent" 自动加载

**实现方案**：
```
backend/app/services/project_agents/
├── __init__.py
├── scanner.py          # 扫描 .trae/agents/
├── parser.py           # 解析 frontmatter
└── registry.py         # 注册到 multi-agent registry
backend/app/api/project_agents.py  # REST API
```

**验收标准**：
- [ ] 创建 `.trae/agents/code-architect.md` 自动注册
- [ ] 单元测试 10+ 验证 frontmatter 解析
- [ ] E2E 测试 5+ 验证路由
- [ ] 调用方式：`@code-architect 优化模块X`

---

#### 2.1.2 P0-18 Hooks 事件增强

**当前状态**：
- ✅ 基础 hooks 事件（已实现 5 种类型）
- ❌ 缺少用户定义 shell 命令
- ❌ 缺少 lifecycle hook 完整覆盖

**TRAE v3.5.66 / Codex 规范**：
- Hook 类型：pre-tool, post-tool, pre-commit, session-start, session-end
- 配置文件：`.trae/hooks/<type>/<name>.sh`
- 错误处理：block_on_error 标志

**实现方案**：
```
backend/app/services/hooks_engine.py  # 增强
.trae/hooks/
├── pre-tool/
│   └── security-check.sh
├── post-tool/
│   └── log-execution.sh
├── pre-commit/
│   └── run-tests.sh
└── session-start/
    └── load-context.sh
```

**验收标准**：
- [ ] Hooks 引擎支持 6 种类型
- [ ] 用户可定义 shell 命令
- [ ] 单元测试 15+ 验证各种 hook 触发
- [ ] E2E 测试 6+ 验证实际执行

---

### 2.2 P1 增强差距

#### 2.2.1 P1-5 SKILL.md Progressive Disclosure

**当前状态**：
- ✅ Custom Skills 系统（Cycle 8 P0-13）已实现
- ❌ 缺少 progressive disclosure（8K cap + on-demand loading）
- ❌ 缺少完整 frontmatter 规范（2 必填 + 4 可选）

**Codex v0.135+ 规范**：
- 初始加载：name + description（cap 8K char）
- 选中后加载：完整 SKILL.md body
- Frontmatter: name (required), description (required), when_to_use, tools, model, metadata (optional)

**实现方案**：
```python
# backend/app/services/custom_commands/skills_registry.py
class SkillsRegistry:
    def list_summary(self) -> List[SkillSummary]:  # 8K cap
        ...
    def get_full(self, name: str) -> Optional[Skill]:  # on-demand
        ...
```

**验收标准**：
- [ ] 8K char cap 自动截断
- [ ] 完整 SKILL.md 按需加载
- [ ] Frontmatter 2+4 字段支持
- [ ] 单元测试 12+ + E2E 4+

---

#### 2.2.2 P1-6 `.trae/rules/` 多级嵌套

**当前状态**：
- ⚠️ 基础 rules 扫描（部分实现）
- ❌ 缺少 3 级嵌套支持
- ❌ 缺少子目录规则自动应用

**TRAE v3.5.51 规范**：
- `.trae/rules/` 3 级嵌套目录
- 任何子目录可创建 `.trae/rules/` 配置模块级规则
- 智能提及文件时自动应用

**实现方案**：
```
.trae/rules/
├── coding-style/        # Level 1
│   ├── python/
│   │   └── style.md
│   └── typescript/
│       └── style.md
├── git-commit/
│   └── commit-msg.md
└── security/
    └── check.md
```

**验收标准**：
- [ ] 3 级嵌套扫描
- [ ] 子目录规则自动应用
- [ ] 单元测试 10+ + E2E 3+

---

#### 2.2.3 P1-7 DiffView 增强

**当前状态**：
- ✅ DiffView 基础（Cycle 7 P1-3 已实现）
- ❌ 缺少影响文件数 + 修改行数统计
- ❌ 缺少文件列表
- ❌ 缺少行号

**TRAE Solo 规范**：
- DiffView 窗口：影响文件数 + 总修改行数 + 文件列表
- 点击查看具体 diff
- 统计在打开 DiffView 时显示

**实现方案**：
```typescript
// frontend/src/components/DiffView.tsx (增强)
const stats = {
  filesChanged: number,
  totalLinesAdded: number,
  totalLinesRemoved: number,
  files: Array<{ path: string, changes: number }>,
};
```

**验收标准**：
- [ ] 影响文件数显示
- [ ] 总修改行数显示
- [ ] 文件列表可点击
- [ ] 单元测试 + 浏览器测试

---

#### 2.2.4 P1-8 Memory 功能（Beta）

**当前状态**：
- ❌ 智能体长期记忆未实现

**TRAE v3.5.21 规范**：
- 跨会话记忆
- 关键信息持久化
- Beta 阶段，可选启用

**实现方案**：
```python
# backend/app/services/memory/
├── store.py        # 长期记忆存储
├── retriever.py    # 检索相关记忆
└── summarizer.py   # 摘要压缩
```

**验收标准**：
- [ ] 记忆存储 + 检索
- [ ] 摘要压缩（避免 token 爆炸）
- [ ] 单元测试 8+ + E2E 3+

---

#### 2.2.5 P1-9 对话自动折叠

**当前状态**：
- ✅ Multi-Agent v2 node auto-collapse（Cycle 7 P0-10）已实现
- ⚠️ 全局对话折叠（部分）

**TRAE Solo 规范**：
- Settings > Conversation > To-Do List > Conversation Auto-Fold
- 已完成任务自动折叠并摘要
- 可展开查看详情

**实现方案**：
- 扩展 useModals 状态
- ConversationNode 组件增强折叠逻辑

**验收标准**：
- [ ] 全局开关控制
- [ ] 自动折叠已完成任务
- [ ] 摘要压缩显示

---

#### 2.2.6 P1-10 Verification Loop in AGENTS.md

**当前状态**：
- ✅ AGENTS.md 存在
- ❌ 缺少强制验证循环

**Codex Mastery 核心原则**：
```markdown
After every code change, run `npm test` and fix failures before responding.
```

**实现方案**：
- 在 AGENTS.md 头部添加 Verification Loop 段落
- 在 workflow_engine 启动时强制读取并应用

**验收标准**：
- [ ] AGENTS.md 包含验证循环
- [ ] 工作流启动时应用
- [ ] 单元测试 5+ 验证读取

---

### 2.3 P2 长期差距

#### 2.3.1 P2-1 Playwright E2E

**当前状态**：
- ❌ 完整前端 E2E 自动化未实现

**实现方案**：
```
tests/playwright/
├── config.ts
├── fixtures/
├── pages/
└── specs/
    ├── loop_command.spec.ts
    ├── custom_models.spec.ts
    └── slash_commands.spec.ts
```

---

#### 2.3.2 P2-2 Codex doctor 诊断

**当前状态**：
- ❌ 系统诊断命令未实现

**Codex v0.135+ 规范**：
- `/codex doctor` 检查配置、依赖、网络
- 输出可读报告

---

#### 2.3.3 P2-3 `/plugins` 插件管理

**当前状态**：
- ❌ 第三方插件支持未实现

---

#### 2.3.4 P2-4 Figma to code

**当前状态**：
- ❌ Figma 集成未实现

---

#### 2.3.5 P2-5 codex exec pipeline

**当前状态**：
- ⚠️ 基础非交互执行（部分）
- ❌ 完整 pipeline 模式

---

## 三、对比矩阵

### 3.1 Slash Commands 对比

| # | 命令 | Codex | TRAE | 当前 | 差距 |
|---|------|-------|------|------|------|
| 1 | `/init` | ✅ | ✅ | ✅ | 0% |
| 2 | `/status` | ✅ | ✅ | ✅ | 0% |
| 3 | `/plan` | ✅ | ✅ | ✅ | 0% |
| 4 | `/spec` | ✅ | ✅ | ✅ | 0% |
| 5 | `/review` | ✅ | ✅ | ✅ | 0% |
| 6 | `/mcp` | ✅ | ✅ | ✅ | 0% |
| 7 | `/agents` | ✅ | ✅ | ✅ | 0% |
| 8 | `/skills` | ✅ | ✅ | ✅ | 0% |
| 9 | `/hooks` | ✅ | ✅ | ✅ | 0% |
| 10 | `/model` | ✅ | ✅ | ✅ | 0% |
| 11 | `/approvals` | ✅ | ✅ | ✅ | 0% |
| 12 | `/next` | ✅ | ✅ | ✅ | 0% |
| 13 | `/goal` | ✅ | ✅ | ✅ | 0% |
| 14 | `/new` | ✅ | ✅ | ✅ | 0% |
| 15 | `/loop` | ✅ | ✅ | ✅ | 0% |
| **16** | `/plugins` | ✅ | ❌ | ❌ | **100%** |
| **17** | `/doctor` | ✅ | ❌ | ❌ | **100%** |

### 3.2 目录结构对比

| 目录 | Codex | TRAE | 当前 | 差距 |
|------|-------|------|------|------|
| `.codex/AGENTS.md` | ✅ | - | ✅ | 0% |
| `.codex/skills/` | ✅ | - | - | 100% |
| `.codex/subagents/` | ✅ | - | - | 100% |
| `.codex/profiles/` | ✅ | - | - | 100% |
| `.codex/hooks/` | ✅ | - | - | 100% |
| `.trae/commands/` | - | ✅ | ✅ | 0% |
| `.trae/agents/` | - | ✅ | ❌ | 100% |
| `.trae/rules/` | - | ✅ | ⚠️ | 50% |
| `.trae/skills/` | - | ✅ | ✅ | 0% |
| `.trae/specs/` | - | ✅ | ✅ | 0% |

### 3.3 Hooks 事件对比

| Hook | Codex | TRAE | 当前 | 差距 |
|------|-------|------|------|------|
| pre-tool | ✅ | ✅ | ✅ | 0% |
| post-tool | ✅ | ✅ | ✅ | 0% |
| pre-commit | ✅ | ✅ | ✅ | 0% |
| session-start | ✅ | ✅ | ✅ | 0% |
| session-end | ✅ | ✅ | ✅ | 0% |
| **pre-message** | ✅ | ✅ | ❌ | **100%** |

### 3.4 性能优化对比

| 维度 | Codex | 当前 | 差距 |
|------|-------|------|------|
| Skills progressive disclosure | ✅ 8K cap | ❌ 全量加载 | 100% |
| Frontmatter strict spec | ✅ 2+4 | ⚠️ 基础 | 50% |
| Implicit auto-invoke | ✅ | ❌ | 100% |

---

## 四、关键差距总结

### 4.1 P0 关键（必做）

1. **`.trae/agents/` 子智能体目录路由** - 与现有 Multi-Agent v2 集成
2. **Hooks 事件增强** - pre-message 钩子缺失

### 4.2 P1 重要（建议做）

1. **SKILL.md progressive disclosure** - 性能优化关键
2. **`.trae/rules/` 多级嵌套** - 与 TRAE 规范对齐
3. **DiffView 增强** - 影响文件数 + 修改行数
4. **Memory 功能** - 智能体长期记忆
5. **对话自动折叠** - 全局开关
6. **Verification Loop** - AGENTS.md 强化

### 4.3 P2 长期（可做）

1. **Playwright E2E** - 完整前端自动化
2. **Codex doctor** - 系统诊断
3. **Plugins 管理** - 第三方扩展
4. **Figma to code** - 设计稿转代码
5. **codex exec pipeline** - CI/CD 集成

---

## 五、优先级建议

### 5.1 本轮（Cycle 9）目标

1. ✅ P0-16 TypeScript 修复（已完成）
2. ⏳ P0-17 `.trae/agents/` 路由（必做）
3. ⏳ P0-18 Hooks 事件增强（必做）

### 5.2 下一轮（Cycle 10）目标

1. P1-5 SKILL.md progressive disclosure
2. P1-6 `.trae/rules/` 多级嵌套
3. P1-7 DiffView 增强
4. P1-8 Memory 功能
5. P1-9 对话自动折叠
6. P1-10 Verification Loop

### 5.3 长期（Cycle 11+）目标

1. P2-1 Playwright E2E
2. P2-2 Codex doctor
3. P2-3 Plugins 管理
4. P2-4 Figma to code
5. P2-5 codex exec pipeline

---

## 六、风险评估

| 风险 | 等级 | 影响 | 缓解 |
|------|------|------|------|
| Multi-Agent 集成冲突 | 中 | P0-17 实现受阻 | 详细测试 + 增量发布 |
| Hooks 性能开销 | 中 | 系统延迟 | 异步执行 + 超时 |
| Memory 存储膨胀 | 中 | 存储成本 | 摘要压缩 + 定期清理 |
| Progressive disclosure 边界 | 低 | 用户体验 | 默认 8K cap + 可配置 |
| 第三方插件安全 | 高 | 系统安全 | 沙箱执行 + 权限控制 |

---

## 七、结论

### 7.1 差距覆盖率
- **整体覆盖率**: 78%
- **P0 任务**: 0% 完成（2 个待做）
- **P1 任务**: 0% 完成（6 个待做）
- **P2 任务**: 0% 完成（5 个待做）

### 7.2 下一步行动
1. 进入 P0-17 `.trae/agents/` 路由实现
2. 进入 P0-18 Hooks 事件增强
3. 进入 P1-5 SKILL.md progressive disclosure
4. 完成本轮 Cycle 9 目标后启动 Cycle 10
