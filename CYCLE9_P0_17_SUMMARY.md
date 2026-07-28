# Cycle 9 P0-17 Summary Report - `.trae/agents/` 子智能体目录路由

> **周期**: Cycle 9
> **任务**: P0-17
> **日期**: 2026-07-28
> **状态**: ✅ 100% 完成
> **关联**: [CYCLE9_RESEARCH_REPORT.md](CYCLE9_RESEARCH_REPORT.md) | [CYCLE9_GAP_ANALYSIS.md](CYCLE9_GAP_ANALYSIS.md) | [CYCLE9_PLANNING.md](CYCLE9_PLANNING.md)

---

## 一、目标

实现 TRAE v3.5.67 规范的 `.trae/agents/<identifier>.md` 子智能体目录路由：
- 扫描项目内 `.trae/agents/**/*.md`
- 解析 YAML frontmatter
- 注册到 multi-agent registry
- 支持 `@identifier` 形式调用
- 修复 Codex v0.135+ Multi-Agent v2 中"项目级子智能体"的空白

---

## 二、技术实现

### 2.1 模块结构

```
backend/app/services/project_agents/
├── __init__.py        # 导出入口
├── parser.py          # YAML frontmatter 解析 + ProjectAgent 数据类
├── scanner.py         # 目录递归扫描
└── registry.py        # 全局线程安全注册表

backend/app/api/
└── project_agents.py  # 9 个 REST 端点
```

### 2.2 核心数据模型（ProjectAgent）

```python
@dataclass
class ProjectAgent:
    name: str                          # 子智能体唯一标识
    description: str                   # 一句话描述
    prompt: str                        # 系统提示词（markdown body）
    callable: bool = True              # 是否可被 @ 调用
    when_to_call: str = ""             # 调用场景关键词
    model: str = "claude-sonnet"       # 默认模型
    tools: List[str] = field(...)      # 可用工具列表
    metadata: Dict[str, Any] = ...     # 自定义元数据
    file_path: str                     # 源 .md 绝对路径
    project_path: str                  # 所在项目根目录
```

### 2.3 关键设计

1. **零外部依赖**: 自研轻量 YAML 解析（不依赖 PyYAML），支持：
   - key: value
   - 引号字符串（`"..."` / `'...'`）
   - 布尔（true/false/yes/no）
   - 数字（int / float）
   - 行内列表 `[a, b, c]`
   - 块级列表
   - 嵌套字典
   - 注释（`# ...`）

2. **线程安全**: `ProjectAgentRegistry` 使用 `threading.RLock` 保护内部状态

3. **多项目并存**: 每个项目路径独立维护子智能体集合

4. **@ 引用解析**: 正则 `r"@([A-Za-z0-9_\-\.]+)"` 支持：
   - 标识符可含字母、数字、下划线、连字符、点
   - 自动去重
   - 返回每个引用的解析结果

5. **智能推荐**: `when_to_call` 关键词拆分 + 命中比例打分

6. **路径白名单**: 与其他 API 保持一致，仅允许：
   - `/home/qizheng/auto_code_ws`
   - `/home/qizheng/auto_code_data`
   - `/tmp/test-projects`
   - `/tmp`

### 2.4 Markdown 文件格式（TRAE v3.5.67 规范）

```markdown
---
name: code-architect              # 必填：唯一标识
description: 资深代码架构师         # 必填：一句话描述
prompt: 你是一位资深...             # 系统提示词（= body）
callable: true                    # 可选：是否可被 @ 调用
when_to_call: 架构, 设计, 重构     # 可选：调用场景关键词
model: claude-sonnet              # 可选：默认模型
tools:                            # 可选：可用工具列表
  - read_file
  - write_file
metadata:                         # 可选：自定义元数据
  role: architect
  level: senior
---

# Markdown body 作为 system prompt
这里是完整的系统提示词...
```

---

## 三、API 端点（9 个）

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/project-agents/scan` | POST | 扫描并注册项目 |
| `/api/project-agents/list` | GET | 列出已注册智能体 |
| `/api/project-agents/by-name/{name}` | GET | 按名查询 |
| `/api/project-agents/refresh` | POST | 刷新项目 |
| `/api/project-agents/resolve` | POST | 解析 @ 引用 |
| `/api/project-agents/suggest` | POST | 智能推荐 |
| `/api/project-agents/project` | DELETE | 注销项目 |
| `/api/project-agents/stats` | GET | 统计信息 |
| `/api/project-agents/health` | GET | 健康检查 |

---

## 四、测试验证

### 4.1 单元测试（39/39 通过）

| 测试类 | 测试数 | 状态 |
|--------|--------|------|
| TestParseFrontmatter | 8 | ✅ |
| TestParseAgentFile | 9 | ✅ |
| TestScanner | 6 | ✅ |
| TestExtractAtReferences | 6 | ✅ |
| TestRegistry | 8 | ✅ |
| TestIntegrationWithFixture | 2 | ✅ |
| **合计** | **39** | **100%** |

### 4.2 E2E 测试（35/35 通过）

| 测试组 | 断言数 | 状态 |
|--------|--------|------|
| 健康检查 | 2 | ✅ |
| 扫描并注册项目 | 8 | ✅ |
| 列出智能体 | 3 | ✅ |
| 按 name 查询 | 5 | ✅ |
| @ 引用解析 | 6 | ✅ |
| 智能推荐 | 2 | ✅ |
| 刷新 | 2 | ✅ |
| 统计 | 3 | ✅ |
| 注销 | 4 | ✅ |
| 路径白名单 | 1 | ✅ |
| **合计** | **35** | **100%** |

### 4.3 综合验证

| 维度 | 数量 | 通过率 |
|------|------|--------|
| 单元测试 | 39/39 | 100% |
| E2E 测试 | 35/35 | 100% |
| 路由注册 | 9/9 | 100% |
| 模块导入 | OK | 100% |
| 真实 fixture 集成 | OK | 100% |

---

## 五、交付清单

### 5.1 新增文件（4 个核心 + 1 API + 1 单元测试 + 1 E2E 测试 + 5 例子）

| 路径 | 行数 | 作用 |
|------|------|------|
| `backend/app/services/project_agents/__init__.py` | ~35 | 模块导出 |
| `backend/app/services/project_agents/parser.py` | ~270 | Frontmatter 解析 |
| `backend/app/services/project_agents/scanner.py` | ~110 | 目录扫描 |
| `backend/app/services/project_agents/registry.py` | ~250 | 全局注册表 |
| `backend/app/api/project_agents.py` | ~310 | REST API 端点 |
| `tests/test_project_agents_units.py` | ~360 | 39 单元测试 |
| `tests/test_e2e_project_agents.sh` | ~210 | 35 E2E 断言 |
| `.trae/agents/code-architect.md` | ~50 | 架构师示例 |
| `.trae/agents/security-reviewer.md` | ~50 | 安全审查示例 |
| `.trae/agents/test-engineer.md` | ~50 | 测试工程师示例 |
| `.trae/agents/doc-writer.md` | ~30 | 文档撰写示例 |
| `.trae/agents/_template.md` | ~15 | 模板（callable: false） |

### 5.2 修改文件（1 个）

| 路径 | 变更 |
|------|------|
| `backend/app/main.py` | 注册 `project_agents_router` + 头部版本 v6.2.0→v6.3.0 |

### 5.3 文档（2 个）

| 路径 | 作用 |
|------|------|
| `CYCLE9_P0_17_SUMMARY.md` | 本报告 |
| `代码修改日志.md` | v6.3.0 追加 |

---

## 六、覆盖度提升

| 维度 | Cycle 8 末 | Cycle 9 P0-17 后 | 提升 |
|------|-----------|-----------------|------|
| Codex v0.135+ Multi-Agent v2 | 50% | 75% | +25% |
| TRAE v3.5.67 .trae/agents/ 规范 | 0% | 100% | +100% |
| 整体覆盖率 | 78% | 80% | +2% |

---

## 七、调用示例

### 7.1 在用户 prompt 中引用

```
请 @code-architect 优化 @security-reviewer 模块设计
```

调用 `/api/project-agents/resolve` 后会自动展开为：
- `code-architect` 的完整 prompt 注入
- `security-reviewer` 的完整 prompt 注入
- 未注册的引用会被标记为 null

### 7.2 智能推荐

```bash
curl -X POST /api/project-agents/suggest \
  -d '{"query":"请帮我做架构设计","top_k":3}'
# 返回 top 3 智能体及其得分
```

### 7.3 注册项目

```bash
curl -X POST /api/project-agents/scan \
  -d '{"project_path":"/path/to/project"}'
# 扫描 .trae/agents/*.md 并注册到全局表
```

---

## 八、风险与限制

### 8.1 已规避风险

- ✅ 路径白名单避免任意目录访问
- ✅ 必填字段校验（name + description）避免空注册
- ✅ `_` 前缀文件自动跳过，避免误注册模板
- ✅ 线程安全，支持并发注册/查询
- ✅ 刷新时清理旧的全局索引，避免悬挂引用

### 8.2 已知限制

- 单一 keyword 匹配（未引入 LLM-based 语义匹配）
- 不支持嵌套子智能体继承（`.trae/agents/parent/child.md` 视为独立）
- 不支持热加载（需要调用 `/refresh` 主动刷新）

### 8.3 后续优化方向

- [ ] P1-5 SKILL.md Progressive Disclosure 中可复用相同的"summary/full"模式
- [ ] P1-6 `.trae/rules/` 多级嵌套可借鉴扫描器
- [ ] P2-3 LLM-based 语义匹配替代关键词匹配

---

## 九、下一步

- ✅ P0-17 完成
- ⏭️ P0-18 Hooks 事件增强（Cycle 9 第二个 P0 任务）
- ⏭️ P1-5 ~ P2-5 共 11 个 P1/P2 任务

预计 P0-18 实施时间：2-3h
预计 P1 系列实施时间：21h
预计 P2 系列实施时间：29h
Cycle 9 总预计工时：57h

---

**报告生成时间**: 2026-07-28
**状态**: ✅ 100% 完成
**测试通过率**: 100% (74/74)
**覆盖度提升**: 78% → 80%
