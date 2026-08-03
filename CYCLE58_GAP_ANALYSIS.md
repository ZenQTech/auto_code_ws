# CYCLE58 功能差距分析报告

> **日期**: 2026-08-03
> **对比对象**: Codex 0.146.0 + TRAE Solo + Hermes 58 cycles
> **方法**: MCP 抓取 + 已实现能力核对 + 用户决策（5 大 P0 实施）

---

## 1. 总结差距（按用户 7 大问题分类）

### Q1: vibe coding 完整流程
| 阶段 | codex/trae | Hermes | 差距 |
|------|-----------|--------|------|
| 触发 | `codex` / 模式切换 | chat/coding 二元 | 🔴 缺 vibe-coding 模式 |
| 参数 | config.toml | 部分 | ✅ 接近 |
| 上下文 | AGENTS.md + Skills + Memories | Memory 27k | ⚠️ 缺 AGENTS.md |
| 计划 | Plan + 用户确认 | ComposerPanel plan | ✅ 接近 |
| 执行 | CLI + 工具 | Loop V7 | ✅ |
| 返回 | TUI/IDE | ChatView | ✅ |

### Q2: 循环工作流
| 维度 | codex/trae | Hermes | 差距 |
|------|-----------|--------|------|
| 触发 | Goal mode `/goal` | 用户输入 | 🟠 缺 Goal mode UI |
| 状态 | Activity view | LoopV7Runner 弹窗 | 🔴 缺持续可见状态机 |
| 并行 | sub-agents | Loop V7 并行 | ✅ |
| 异常 | Rate limit / recovery | Hook + 重试 | ✅ |
| 中断 | pause/resume | 缺 UI | 🟠 缺 |

### Q3: 思考过程可视化
| 维度 | codex/trae | Hermes | 差距 |
|------|-----------|--------|------|
| 阶段标签 | 4 阶段 | 4 阶段 | ✅ |
| Token 流 | ✅ | ✅ | ✅ |
| 折叠 | ✅ | ✅ | ✅ |
| 主题感知 | ✅ 状态栏 | ❌ | 🟡 |
| Token 计数 | ✅ | ❌ | 🟡 |

### Q4: 渐进式呈现
| 维度 | codex/trae | Hermes | 差距 |
|------|-----------|--------|------|
| 增量 | Token 级 | Chunk 级 | ⚠️ |
| 断点续传 | ✅ | ✅ | ✅ |
| 背压 | ✅ | ⚠️ | 🟡 |
| Token 流 | ✅ | ❌ | 🟡 |

### Q5: 代码实时编写
| 维度 | codex/trae | Hermes | 差距 |
|------|-----------|--------|------|
| 实时编辑 | Inline annotations | ComposerPanel | ✅ |
| 选中→AI | ✅ | ✅ @ mention | ✅ |
| 多文件 | ✅ | ✅ | ✅ |
| 实时跟随 | ✅ TRAE | ❌ | 🔴 缺 Auto-Follow |
| 双向绑定 | ✅ | ✅ | ✅ |

### Q6: 代码修改比对
| 维度 | codex/trae | Hermes | 差距 |
|------|-----------|--------|------|
| DiffView | ✅ | ✅ | ✅ |
| Multi-repo | ✅ | ❌ | 🟠 |
| Inline review | ✅ | ❌ | 🟠 |
| 折叠/展开 | ✅ | ✅ | ✅ |
| 主题色 | ✅ | ⚠️ | 🟡 |

### Q7: 代码回退
| 维度 | codex/trae | Hermes | 差距 |
|------|-----------|--------|------|
| Auto commit | ✅ | ✅ hook | ✅ |
| Worktree | ✅ | ✅ | ✅ |
| Undo/Redo | ✅ | ✅ Composer | ✅ |
| 一键回退 | ❌ | ❌ | 🔴 缺 |
| 对话流折叠 | ✅ TRAE | ❌ | 🟠 缺 |
| /undo 命令 | ✅ | ❌ | 🟠 缺 |

---

## 2. 5 大 P0 任务差距量化

### G58-01: VibeCoding 模式入口
- **现状**: ModeSelector 只有 chat/coding 二元
- **目标**: 新增 vibe-coding 作为一等模式
- **代码量**: ~800 行（前端 + 路由 + Hook）
- **风险**: 🟢 低
- **依赖**: —

### G58-02: ClaudeCodeShell 进程化
- **现状**: 仅有 import_service 配置导入层，缺真实 subprocess shell-out
- **目标**: 完整 Claude Code CLI 进程化调用
- **代码量**: ~1200 行（cli_integration + API + Hook）
- **风险**: 🟠 高（子进程 + 沙箱 + 真实 LLM）
- **依赖**: G58-01
- **降级**: 若 `claude` CLI 不在 PATH，自动降级为 LLM HTTP

### G58-03: LoopStateMachine 持续可见 UI
- **现状**: 仅 LoopV7Runner 弹窗
- **目标**: LoopStatusBar（顶部持续可见）+ LoopStateMachineView（状态机迁移图）
- **代码量**: ~1000 行（前端 + 后端）
- **风险**: 🟢 低
- **依赖**: G58-01

### G58-04: Auto-Follow 联动
- **现状**: Stream 事件不自动 open/聚焦 panel
- **目标**: 监听 SSE 事件，根据阶段自动 open/聚焦 panel
- **代码量**: ~800 行（前端 + 后端 + Hook）
- **风险**: 🟢 低
- **依赖**: G58-01, G58-03

### G58-05: ComposerPlan 真正可执行
- **现状**: Plan 是文档，不直接驱动 LLM
- **目标**: Plan → 自动驱动 LLM 持续生成 → 每步可暂停/恢复
- **代码量**: ~1200 行（前端 + 后端）
- **风险**: 🟡 中（LLM 死循环防护）
- **依赖**: G58-01, G58-02

### G58-INTEGRATION
- **现状**: 5 大任务独立
- **目标**: 主面板集成 + 端到端验证 + 推 main
- **代码量**: ~500 行
- **风险**: 🟡 中
- **依赖**: G58-01~05

**总计**: ~5500 行新代码

---

## 3. 验收清单映射

| 调研主题 | 验收项 | 优先级 |
|----------|--------|--------|
| a) vibe coding 流程 | 3 模式入口、Plan 驱动、实时跟随 | P0 |
| b) 循环工作流 | 持续可见状态条、Goal mode UI、pause/resume | P0 + P1 |
| c) 思考可视化 | 阶段徽章、Token 计数、主题色 | P0 |
| d) 渐进式呈现 | StreamingBuffer、Token 级流式、背压 | 已有 + P1 |
| e) 代码实时编写 | Auto-Follow、选中→AI、Inline annotations | P0 |
| f) 代码修改比对 | DiffView、Multi-repo、Inline review | 已有 + P1 |
| g) 代码回退 | Auto commit、一键回退、对话流折叠 | 已有 + P0 |

---

## 4. 实施优先级决策

### 必须 (P0) - Cycle 58
1. VibeCoding 模式入口
2. ClaudeCodeShell 进程化
3. LoopStateMachine 持续可见 UI
4. Auto-Follow 联动
5. ComposerPlan 真正可执行

### 应该 (P1) - Cycle 59
- Central Agent 状态可视化
- 连续对话驱动循环
- Sub-agent Tree 心智图
- To-Do List 自动折叠
- 桌面控制 mock

### 锦上添花 (P2) - Cycle 60
- AGENTS.md 自动发现
- 语音输入
- TUI 增强
- CUE 行内补全
- 模板市场

---

## 5. 风险与回退矩阵

| 风险 | 概率 | 影响 | 回退策略 |
|------|------|------|----------|
| `claude` CLI 不在 PATH | 高 | 中 | 自动降级为 LLM HTTP |
| Auto-Follow 引发用户困扰 | 中 | 低 | 关闭开关 |
| Loop 状态机 UI 性能 | 低 | 中 | 节流更新 |
| Plan 死循环 | 中 | 高 | 超时/最大步数 |
| 与现有 mode 冲突 | 低 | 中 | 保留 chat/coding |

---

**差距分析完成，下一步创建 spec/task/checklist 文档。**
