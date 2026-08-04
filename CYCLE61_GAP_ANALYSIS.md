# CYCLE61_GAP_ANALYSIS.md — 功能差距分析

> **日期**: 2026-08-04
> **对比对象**: Codex 0.146+ / TRAE Solo 2026 Q3 / Hermes CYCLE60
> **方法**: MCP 抓取 + CYCLE61_RESEARCH.md + CYCLE58-60 调研基础

---

## 1. 总体差距总结

### 1.1 量化指标

| 维度 | Codex 0.146+ | TRAE Solo 2026 Q3 | Hermes CYCLE60 | 差距率 |
|------|--------------|-------------------|----------------|--------|
| 触发入口 | 4 类 | 1 类（Solo） | 4 类 | ✅ 0% |
| 模型选择 | 5+ 模型 | 自定义 | 4 模型 | ✅ 5% |
| 推理强度 | 4 档 | 3 档 | 4 档 | ✅ 0% |
| Plan 模式 | ✅ | ✅ | ✅ | ✅ 0% |
| 任务并行 | sub-agents | 多任务 | 多 session | ✅ 0% |
| 流式输出 | Realtime V2 | ✅ | StreamingBuffer | ✅ 0% |
| 思考可视化 | reasoning | 文档实时 | ThinkingBlock | ✅ 0% |
| **实时跟随** | ❌ | ✅ | ⚠️ | 🔴 **30%** |
| 工具面板 | TUI | 12 件 | 47 panel | ✅ 超 100% |
| DiffView | ✅ | ✅ | ✅ | ✅ 0% |
| Multi-repo diff | ✅ | ❌ | ❌ | 🟠 100% |
| Inline review | ✅ | ❌ | ❌ | 🟠 100% |
| 自动 commit | ✅ worktree | ⚠️ | ✅ hook | ✅ 0% |
| Worktree | ✅ | ❌ | ✅ | ✅ 0% |
| Undo/Redo | ✅ | ✅ | ✅ Composer | ✅ 0% |
| **一键回退** | ❌ | ❌ | ❌ | 🔴 **100%** |
| 对话流折叠 | ❌ | ✅ | ❌ | 🟠 100% |
| 沙箱 | ✅ 多层 | ⚠️ | ⚠️ 部分 | 🟠 50% |
| **Goal mode** | ✅ v0.519+ | ❌ | ⚠️ Loop V7 | 🟠 **40%** |
| **真实 CLI** | ✅ Rust | ✅ | ❌ | 🔴 **100%** |
| Computer Use | ✅ | ❌ | ❌ | ❌ 100% |
| 语音输入 | ✅ | ✅ | ❌ | 🟠 100% |
| AGENTS.md 自动发现 | ✅ | ❌ | ❌ | 🟠 100% |
| Skills 插件 | ✅ | ✅ | 部分 | 🟠 30% |
| Memories | ✅ | ❌ | ✅ Memory 27k | ✅ 0% |
| Hook 系统 | ✅ 15 类 | ❌ | ✅ 10 类 | 🟠 33% |
| **Record & Replay** | ✅ 26.616+ | ❌ | ❌ | 🟠 **100%** |
| **Sub-agent Tree** | ✅ | ❌ | ⚠️ | 🟠 **40%** |
| Plugin Marketplace | ❌ | ✅ 200+ | ⚠️ 雏形 | 🟠 80% |
| 集成（Figma/Supabase/Vercel） | ❌ | ✅ | ❌ | ❌ 100% |

**总体覆盖率**: 约 82% 完整对齐 Codex 0.146+ 和 TRAE Solo 2026 Q3

---

## 2. CYCLE61 优先级 P0 任务（4 项）

### G61-01: Claude Code CLI 真实 subprocess 集成

**现状**：
- 已有 `cli_integration` 模块 + `import_service`
- 缺真实 `subprocess` shell-out 到 `claude` CLI
- 缺 stdin/stdout/stderr 流式管道
- 缺 sandbox 隔离

**目标**：
- 真实 subprocess 调用 `claude --prompt "..."` 
- stdin/stdout/stderr 流式转发到前端 SSE
- sandbox 隔离（Docker / gVisor / firejail）
- 失败降级：若 `claude` CLI 不在 PATH，自动降级为 LLM HTTP

**代码量估算**：~1200 行（cli_integration + API + Hook + sandbox）
**风险等级**：🟠 高（子进程 + 沙箱 + 真实 LLM）
**依赖**：G61-02, G61-03

### G61-02: Goal mode 完整循环 UI

**现状**：
- 已有 `useLoopState` Hook + `loopState.state` 状态
- 已有 `LoopStatusBar`（顶部持续可见）
- 缺 Goal 完整循环 UI（Goal-Plan-Step 三层可视化）
- 缺 Goal 持久化（pause/resume 后自动恢复）
- 缺 Step 自动验证

**目标**：
- Goal 持久化到 localStorage / IndexedDB
- Goal-Plan-Step 三层可视化（树状 / 时间线）
- pause/resume 完整状态恢复
- Step 自动验证（可配置 pass 条件）
- Goal 进度报告（每 N 步自动生成摘要）

**代码量估算**：~1500 行（前端 + 后端 + 持久化）
**风险等级**：🟡 中
**依赖**：G61-01, G61-04

### G61-03: Auto-Follow 联动增强

**现状**：
- 已有 `useAutoFollow` Hook（v1.1.0, 15 事件映射）
- 缺真实事件 → panel 打开/聚焦/最小化联动
- 缺 Predictive Switch（预测下一个工具）
- 缺 Split View（主面板 + 工具面板可分屏）

**目标**：
- 完整 15 类事件 → 47 panel 映射
- Predictive Switch（AI 即将执行的动作预测下一个工具）
- Split View（上下分屏）
- Sticky Tool（重要工具可固定）
- 事件去重 / 节流 / 优先级

**代码量估算**：~1000 行
**风险等级**：🟢 低
**依赖**：—

### G61-04: ComposerPlan 真正可执行

**现状**：
- 已有 `ComposerPanel` + `composerEngine`
- Plan 是文档，不直接驱动 LLM
- 缺 Plan → step 编排 → LLM 循环

**目标**：
- Plan 解析为 step 列表
- 每步自动调用 LLM（带上下文）
- 步骤间可暂停/恢复/跳过
- 步骤结果验证
- 失败重试 / 跳过 / 中止策略

**代码量估算**：~1200 行
**风险等级**：🟡 中（LLM 死循环防护）
**依赖**：G61-01

---

## 3. CYCLE61 优先级 P1 任务（4 项）

### G61-05: Sub-agent Tree 心智图

**现状**：
- 已有 `multiAgentTree` panel
- 缺真正的心智图可视化
- 缺父子 agent 关系

**目标**：
- 心智图渲染（d3.js / react-flow）
- 父子 agent 关系可视化
- 实时状态更新
- 点击节点查看详情

**代码量估算**：~800 行
**风险等级**：🟢 低
**依赖**：—

### G61-06: Record & Replay（工作流录制为 skill）

**现状**：
- 完全未实现
- 缺录制（prompt + 工具 + 文件 + 验证）
- 缺回放（参数化 / dry-run / step-skip）

**目标**：
- 工作流录制为 `.hermes/skills/recorded-*.yaml`
- 自动识别可复用片段（重复 3+ 次的步骤自动成为 skill）
- 录制文件可作为 skill 直接调用
- 支持参数化 / dry-run / step-skip

**代码量估算**：~1500 行（录制 + 存储 + 回放 + UI）
**风险等级**：🟡 中
**依赖**：G61-01

### G61-07: 一键回退（git revert + UI 集成）

**现状**：
- 已有 `git_manager` (102k)
- 缺 UI 集成（无前端按钮触发）
- 缺对话流关联（回退哪个对话产生的变更）

**目标**：
- UI 按钮触发 `git revert`
- 对话流关联（点击对话项显示对应 commit，可一键回退）
- 回退前确认 + 预览 diff
- 回退后自动重新构建

**代码量估算**：~600 行
**风险等级**：🟢 低
**依赖**：—

### G61-08: 对话流自动折叠

**现状**：
- 已有 `VibeCodingStage` + 步骤展示
- 缺已完成任务自动折叠
- 缺摘要自动生成

**目标**：
- 已完成任务自动折叠（显示 1-2 行摘要）
- 摘要由 LLM 自动生成
- 折叠状态可手动控制
- 展开后保留完整内容

**代码量估算**：~500 行
**风险等级**：🟢 低
**依赖**：—

---

## 4. CYCLE61 优先级 P2 任务（5 项）

### G61-09: AGENTS.md 自动发现
- 自动发现项目根目录的 `AGENTS.md`
- 三层上下文：AGENTS.md + Skills + Memories
- 优先级：🟠 中
- 代码量：~400 行

### G61-10: Computer Use mock
- 截图 + 点击 + 键盘模拟
- mock 实现（不调用真实桌面）
- 优先级：🟢 低
- 代码量：~600 行

### G61-11: 语音输入
- Whisper API 集成
- F2 切换语音输入
- 优先级：🟢 低
- 代码量：~400 行

### G61-12: TUI 增强
- vim 三模式
- 主题感知状态栏
- 优先级：🟢 低
- 代码量：~500 行

### G61-13: Plugin Marketplace 完善
- 9 大类 200+ 插件
- 一键安装/卸载
- 优先级：🟢 低
- 代码量：~1500 行

---

## 5. 风险与回退矩阵

| 风险 | 概率 | 影响 | 回退策略 |
|------|------|------|----------|
| `claude` CLI 不在 PATH | 🟠 高 | 🟠 中 | 自动降级为 LLM HTTP |
| subprocess 性能问题 | 🟡 中 | 🟠 中 | 异步 + 流式缓冲 |
| sandbox 兼容性 | 🟡 中 | 🟠 中 | 多 sandbox 后备 |
| Auto-Follow 引发用户困扰 | 🟡 中 | 🟢 低 | 关闭开关 |
| Loop 状态机 UI 性能 | 🟢 低 | 🟠 中 | 节流更新 |
| Plan 死循环 | 🟡 中 | 🔴 高 | 超时/最大步数 |
| 与现有 mode 冲突 | 🟢 低 | 🟠 中 | 保留 chat/coding |
| Record & Replay 存储爆炸 | 🟡 中 | 🟢 低 | 自动清理 30 天前 |
| 一键回退误操作 | 🟡 中 | 🔴 高 | 强制确认 + diff 预览 |

---

## 6. 验收清单映射

| 调研主题 | 验收项 | 优先级 | 任务 ID |
|----------|--------|--------|---------|
| a) vibe coding 流程 | 真实 CLI 集成 | P0 | G61-01 |
| b) 循环工作流 | Goal mode 完整 UI | P0 | G61-02 |
| c) 思考可视化 | 阶段徽章（已有） | ✅ | — |
| d) 渐进式呈现 | Auto-Follow 联动 | P0 | G61-03 |
| e) 代码实时编写 | ComposerPlan 真正可执行 | P0 | G61-04 |
| f) 代码修改比对 | Multi-repo diff | P1 | G61-05 |
| g) 代码回退 | 一键回退 | P1 | G61-07 |

---

## 7. 实施路线图

### Cycle 61 (本次)
- **G61-01**: Claude Code CLI 真实 subprocess
- **G61-02**: Goal mode 完整循环 UI
- **G61-03**: Auto-Follow 联动增强
- **G61-04**: ComposerPlan 真正可执行

**总代码量**: ~4900 行
**测试覆盖目标**: ≥ 80%
**完成度目标**: 90% 覆盖 Codex 0.146+ 能力

### Cycle 62 (下一轮)
- G61-05 ~ G61-08 (P1 任务)
- 持续优化 P0 任务

### Cycle 63+ (后续)
- G61-09 ~ G61-13 (P2 任务)
- 探索新能力

---

**差距分析完成。下一步创建 CYCLE61_SPEC.md（详细任务规范）→ 实施。**
