# Cycle 70 功能差距分析

**日期**：2026-08-05
**对比对象**：Codex CLI v0.124.0+ / Trae SOLO v3.5+
**当前项目版本**：Cycle 69 完成后

---

## 一、Codex 风格五层架构对齐

| 层 | 当前实现 | Codex 标准 | 差距 |
|----|---------|-----------|------|
| **AGENTS.md** | AgentsMdMemoryService（基础扫描） | 多层级 + 字节限制 + override | 中 |
| **Skills** | SkillService（3 个内置） | SKILL.md + 5 位置 + 隐式调用 | 大 |
| **MCP** | 部分支持（multimodal-chat） | 标准 MCP 协议 | 中 |
| **Subagents** | ArchitectureDesigner/Critic | TOML 配置 + 内置 3 个 | 中 |
| **Plugins** | 无 | Marketplace + install | 大 |

---

## 二、详细差距分析

### 2.1 AGENTS.md 增强（高优先级）

**当前实现**：
- 简单扫描 `AGENTS.md` 文件
- 无 override 机制
- 无字节限制
- 无项目根检测标记

**Codex 标准**：
- 多层级发现（根 → CWD）
- `AGENTS.override.md` 替换机制
- `project_doc_max_bytes` 限制（默认 32 KiB）
- `project_doc_fallback_filenames` 配置
- `project_root_markers` 检测
- `developer_instructions` 内联指令
- `model_instructions_file` 完全替换

**差距分**：8/10（核心机制缺失）

### 2.2 SKILL.md 格式与 5 位置（中优先级）

**当前实现**：
- 自定义 skill 格式
- 仅 3 个内置 skill
- 无 SKILL.md YAML frontmatter
- 无 5 个存储位置

**Codex 标准**：
- SKILL.md 格式（YAML + markdown）
- 5 个存储位置：REPO/USER/ADMIN/SYSTEM/DEFAULTS
- 显式（`$skill-name`）+ 隐式（关键词）调用
- 优先级解析（多位置同名时）
- 启用/禁用配置

**差距分**：9/10（核心系统缺失）

### 2.3 Plugin Marketplace（低优先级）

**当前实现**：无

**Codex 标准**：
- Plugin 注册表（远程）
- `/plugins install` CLI
- 桌面/Web app 浏览器
- 依赖树 + 权限预览
- 启用/禁用 per-project

**差距分**：10/10（完全缺失）

### 2.4 MCP 协议对齐（中优先级）

**当前实现**：
- multimodal-chat 自定义 API
- 部分 MCP 概念借用
- 无标准 MCP server 端点

**Codex/Trae 标准**：
- 标准 MCP server 端点
- 工具注册（tools/list, tools/call）
- 资源（resources/list, resources/read）
- 提示（prompts/list, prompts/get）
- 传输协议（stdio/SSE/HTTP）

**差距分**：7/10

### 2.5 Subagent TOML 配置（中优先级）

**当前实现**：
- Python dataclass 定义
- 内置 3 个：Architect/Critic/QA
- 无配置文件

**Codex 标准**：
- `.codex/agents/<name>.toml` 配置
- `[agents.<name>]` 段
- 内置 3 个：default/explorer/reviewer
- 并行编排 + CSV 批处理

**差距分**：6/10

### 2.6 Hooks 可视化配置（中优先级）

**当前实现**：
- 后端 Hook 处理器（Commit/Task）
- 通过 main.py 初始化
- 无前端 UI

**Trae 标准**：
- 设置 → Hooks 可视化配置
- 事件触发：pre/post commit, task start/end
- 多种动作：shell, api call, notification

**差距分**：5/10

---

## 三、Cycle 70 P0 任务选择

### 选项 A：G70-01 Skill Registry 完整化
**范围**：
- AGENTS.md 多层级 + 字节限制 + override
- SKILL.md 格式 + 5 位置 + 显式/隐式调用
- Plugin 基础注册（非 marketplace）

**工作量**：中高
**价值**：高（直接提升 Loop Engineering 工作流）

### 选项 B：G70-02 MCP Server 桥接
**范围**：
- 标准 MCP server 端点
- 工具/资源/提示注册
- stdio + HTTP 传输

**工作量**：中
**价值**：高（生态系统接入）

### 选项 C：G70-03 Browser Use 工具
**范围**：
- 内嵌浏览器组件
- DOM 元素选择
- 截图 + 交互

**工作量**：高
**价值**：中（独立工具）

### 选择：选项 A

**理由**：
1. 直接服务于 Loop Engineering 工作流（Skill 触发 + AGENTS.md 规则注入）
2. Codex 风格与 Trae SOLO 模式兼容
3. 已有 AgentsMdMemoryService 基础，复用成本低
4. 完成度高（不依赖外部系统）

---

## 四、Spec 任务清单（Cycle 70）

### G70-01: AGENTS.md + Skill Registry 完整化
1. **AGENTS.md 增强**：
   - 多层级发现（global → project → CWD）
   - override 替换机制
   - 字节限制 + 配置项
   - project_root_markers 检测

2. **SKILL.md 格式支持**：
   - YAML frontmatter 解析
   - 5 个存储位置扫描
   - 优先级解析
   - 启用/禁用

3. **Skill 显式/隐式调用**：
   - `$skill-name` 显式
   - 关键词匹配隐式
   - 调用历史 + 缓存

4. **Plugin 基础**：
   - 本地 plugin 安装
   - 依赖追踪
   - 启用/禁用

5. **REST API**：
   - `/api/skills/list` - 列出所有 skill
   - `/api/skills/{name}` - 详情
   - `/api/skills/{name}/invoke` - 调用
   - `/api/agents-md/load` - 加载 AGENTS.md 拼接结果
   - `/api/agents-md/config` - 更新配置

---

## 五、成功标准

- [ ] 5 位置 skill 扫描全部工作
- [ ] SKILL.md YAML 正确解析
- [ ] AGENTS.md 多层级拼接 + 字节限制生效
- [ ] override 替换机制正确
- [ ] 隐式调用基于 description 匹配
- [ ] 显式调用 `$skill-name` 解析
- [ ] 前后端测试通过率 100%
- [ ] 性能：skill 扫描 < 100ms
- [ ] 缓存：skill 元数据 LRU 缓存

---

**分析完成时间**：2026-08-05
**Cycle 70 优先级**：G70-01（P0）
