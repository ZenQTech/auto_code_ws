# Hermes Vibe Coding + Loop Engineering 多周期循环实施方案

**版本**: v1.0
**日期**: 2026-08-03
**作者**: 智能体调度平台（总架构师视角）
**目标完成度**: codex + trae solo 模式功能 100% 对齐

---

## 1. Context（背景与目标）

### 1.1 现状与目标差距
经过深度探索，Hermes 智能体调度平台已完成 **58 个迭代周期**，7743+ 测试 100% 通过。后端 118+ Python 服务、60+ API、Loop V7 15 步 SOP；前端 781 源文件、265 组件、41 panel。最近 5 个周期（C53~C57）全部围绕 MCP 集成展开（可观测性/K8s/Serverless/Stream）。

**核心能力已部分实现**：
- ✅ 实时流式对话 (StreamingBuffer + SSE)
- ✅ 思考过程可视化 (ThinkingBlock 4 阶段)
- ✅ Composer 多文件编辑 (edit/plan/preview 三模式)
- ✅ 41 个 panel 工具矩阵
- ✅ 7 类智能体角色
- ✅ 完整 Hook 体系
- ✅ LoopEngineeringV7 15 步 SOP

**关键缺失**（P0）：
1. 🔴 Vibe Coding 模式入口（当前只有 chat/coding 二元）
2. 🔴 Claude Code CLI 进程级控制（当前仅配置导入 + 自建 LLM HTTP）
3. 🟠 Loop Engineering 状态机持续可见 UI（只有弹窗）
4. 🟠 Auto-Follow 联动（Stream 事件不自动 open panel）
5. 🟡 ComposerPlan 真正可执行（Plan 是文档，不直接驱动 LLM）

### 1.2 本次循环总体战略
**多周期一次性规划**：C58（调研+Spec+完整 P0 实施）→ C59（P1 增强）→ C60（P2 优化），由循环机制自动接续，每周期维护 CYCLE_NN_STARTUP.md 作为下一轮启动文档。

---

## 2. 三周期路线图

### 2.1 Cycle 58: 调研 + Spec + 完整 P0 实施

#### 阶段 1: 互联网调研（MCP 真实抓取）
通过 WebFetch / WebSearch 抓取 codex 与 trae 官方资料，7 大主题独立报告：

| 主题 | 文件 | 抓取目标 |
|------|------|----------|
| a) vibe coding 完整流程 | CYCLE58_TOPIC_RESEARCH_a_vibe_coding_flow.md | codex: openai/codex README + Codex docs；trae: trae.ai 文档 |
| b) 循环工作流 | CYCLE58_TOPIC_RESEARCH_b_loop_workflow.md | openai/codex CLI 工作循环；trae loop 机制 |
| c) 思考过程可视化 | CYCLE58_TOPIC_RESEARCH_c_thinking_visualization.md | codex 推理流；trae 思考面板 |
| d) 渐进式呈现 | CYCLE58_TOPIC_RESEARCH_d_streaming_render.md | codex streaming；trae 渐进式输出 |
| e) 代码实时编写渲染 | CYCLE58_TOPIC_RESEARCH_e_live_code_render.md | codex 实时编辑；trae live edit |
| f) 代码修改追踪/比对 | CYCLE58_TOPIC_RESEARCH_f_diff_tracking.md | codex diff 视图；trae 比对工具 |
| g) 代码回退功能 | CYCLE58_TOPIC_RESEARCH_g_code_rollback.md | codex checkpoint/undo；trae 回退机制 |

**调研要求**：
- 所有引用必须标注来源 URL + 发布机构 + 时间
- 仅使用 `.gov` / `.edu` / 官方文档站
- 调研报告需含图表（架构图/流程图）+ 优势/不足分析

**汇总输出**：[CYCLE58_RESEARCH_REPORT.md](file:///home/qizheng/auto_code_ws/CYCLE58_RESEARCH_REPORT.md)

#### 阶段 2: 功能差距分析与 Spec 创建
- 整合 7 主题调研结果 vs Hermes 现状 → [CYCLE58_GAP_ANALYSIS.md](file:///home/qizheng/auto_code_ws/CYCLE58_GAP_ANALYSIS.md)
- 5 大 P0 任务 spec 文档：
  - [CYCLE58_SPEC.md](file:///home/qizheng/auto_code_ws/CYCLE58_SPEC.md) — 总体规范
  - [CYCLE58_task.md](file:///home/qizheng/auto_code_ws/CYCLE58_task.md) — 任务分解
  - [CYCLE58_checklist.md](file:///home/qizheng/auto_code_ws/CYCLE58_checklist.md) — 验收清单
- 与质量保障智能体讨论验收标准（每项含可量化指标）

#### 阶段 3: 实施 P0-1 → P0-5（按依赖顺序）
| ID | 任务 | 模块 | 风险 | 依赖 |
|----|------|------|------|------|
| G58-01 | VibeCoding 模式入口 | 前端 + 路由 + Mode | 🟢 | — |
| G58-02 | ClaudeCodeShell 进程化 | cli_integration | 🟠 | G58-01 |
| G58-03 | LoopStateMachine 持续可见 UI | 前端 | 🟢 | G58-01 |
| G58-04 | Auto-Follow 联动 | 前端 + 后端 | 🟢 | G58-01, G58-03 |
| G58-05 | ComposerPlan 真正可执行 | 前端 + 后端 | 🟡 | G58-01, G58-02 |
| G58-INTEGRATION | 主面板集成 + 端到端验证 | 全部 | 🟡 | G58-01~05 |

**每个任务的交付流程**：
1. 创建独立 git 分支 `cycle58/G58-NN-<name>`
2. 总架构师分发 → 提示词优化智能体优化 → claude code cli 注入
3. claude code cli 任务规划 → 生成 plan/check list/task
4. 智能体调度平台整合原子任务清单 + 高风险标记 + 全局接口
5. claude code cli 每完成一项 task 通过 hook 发送完成信号
6. 智能体调度平台接受 hook → 对应分支 git commit
7. 完成后合并到主分支

#### 阶段 4: 测试与 UI/UX 优化
- 单元测试覆盖率 ≥ 90%
- 端到端测试（TRAE-browseruse 工具）— 100% 通过
- UI/UX 对标 codex/trae 视觉风格

#### 阶段 5: 验收与交付
- 质量保障智能体全系统评测
- 项目实际运行（`npm run dev` + 端口探测）
- 推 main 分支

### 2.2 Cycle 59: P1 增强（基于 C58 反馈）
| 任务 | 描述 |
|------|------|
| G59-01 | Central Agent 状态可视化（HermesService 前端 dashboard） |
| G59-02 | 连续对话驱动循环（`/loop status` / `/loop pause` / `/loop resume`） |
| G59-03 | Sub-agent Tree 心智图 |
| G59-04 | To-Do List 自动折叠 |
| G59-05 | 桌面控制 mock 子系统 |
| G59-INTEGRATION | 端到端验证 + 推 main |

### 2.3 Cycle 60: P2 优化（基于 C59 反馈）
| 任务 | 描述 |
|------|------|
| G60-01 | CUE 行内补全（Tab 多行建议） |
| G60-02 | TUI 增强入口（Modal Vim 风格） |
| G60-03 | 语音全局输入 |
| G60-04 | Vibe Coding 模板市场 |
| G60-05 | Trae 风格 Figma/Supabase 真实集成 |
| G60-INTEGRATION | 端到端验证 + 推 main |

---

## 3. 7 大调研主题的具体抓取目标

### 3.1 Codex (openai/codex)
- GitHub: https://github.com/openai/codex
- 官方公告: https://openai.com/index (codex 相关)
- Codex CLI 文档: https://github.com/openai/codex/blob/main/README.md
- Codex 内部 docs/ 子目录

### 3.2 TRAE
- 官方网站: https://trae.ai
- 文档中心: https://docs.trae.ai
- TRAE IDE 下载页: https://trae.ai/download
- TRAE Solo 模式专题页

### 3.3 每个主题的具体抓取 URL（候选）
| 主题 | Codex URL 候选 | TRAE URL 候选 |
|------|----------------|---------------|
| a | openai/codex README + codex-cli 子目录 | trae.ai/docs/solo |
| b | codex CLI 源码 + config.toml 注释 | trae.ai/docs/loop |
| c | codex reasoning docs | trae.ai/docs/thinking |
| d | codex streaming implementation | trae.ai/docs/streaming |
| e | codex editor integration | trae.ai/docs/editor |
| f | codex diff views | trae.ai/docs/diff |
| g | codex undo/rollback | trae.ai/docs/rollback |

---

## 4. 关键文件清单

### 4.1 后端（待创建/修改）

| 路径 | 操作 | 说明 |
|------|------|------|
| `cli_integration/claude_code_shell.py` | 新建 | Claude Code CLI 进程化封装（subprocess + 流式解析） |
| `backend/app/services/vibe_coding_orchestrator.py` | 新建 | Vibe Coding 编排器（对话驱动的持续循环） |
| `backend/app/services/loop_state_machine.py` | 新建 | Loop 状态机服务（对外可观测状态） |
| `backend/app/api/vibe_coding.py` | 新建 | Vibe Coding REST 端点 |
| `backend/app/api/auto_follow.py` | 新建 | Auto-Follow 联动端点 |
| `backend/app/api/loop_state.py` | 新建 | Loop 状态查询端点 |
| `backend/app/services/loop_engineering_v7.py` | 加固 | 接入 LoopStateMachine + VibeCoding |
| `backend/app/services/hermes_service.py` | 加固 | 暴露 Central Agent 状态 |
| `backend/app/main.py` | 注册新路由 | 5 个新 router |

### 4.2 前端（待创建/修改）

| 路径 | 操作 | 说明 |
|------|------|------|
| `frontend/src/pages/VibeCodingPage.tsx` | 新建 | Vibe Coding 一等页面 |
| `frontend/src/components/LoopStatusBar.tsx` | 新建 | 顶部持续可见 Loop 状态条 |
| `frontend/src/components/AutoFollowController.tsx` | 新建 | Auto-Follow 联动控制器 |
| `frontend/src/components/VibeCodingStage.tsx` | 新建 | Vibe Coding 主舞台组件 |
| `frontend/src/components/PlanExecutorPanel.tsx` | 新建 | Plan 执行面板 |
| `frontend/src/components/LoopStateMachineView.tsx` | 新建 | 状态机可视化 |
| `frontend/src/hooks/useVibeCoding.ts` | 新建 | Vibe Coding Hook |
| `frontend/src/hooks/useClaudeCodeShell.ts` | 新建 | Claude Code Shell 客户端 Hook |
| `frontend/src/hooks/useAutoFollow.ts` | 新建 | Auto-Follow Hook |
| `frontend/src/hooks/useLoopState.ts` | 新建 | Loop 状态查询 Hook |
| `frontend/src/hooks/useMode.ts` | 修改 | 新增 `vibe-coding` 模式 |
| `frontend/src/router/router.tsx` | 修改 | 新增 `/vibe-coding` 路由 |
| `frontend/src/App.tsx` | 修改 | 接入 LoopStatusBar + VibeCodingPage |
| `frontend/src/pages/ModeSelectorPage.tsx` | 修改 | 3 模式卡片（chat/coding/vibe-coding） |
| `frontend/src/hooks/useModals.ts` | 修改 | 新增 4 panel：vibeCoding / planExecutor / loopState / autoFollow |
| `frontend/src/components/AppLayout.tsx` | 修改 | 顶部插入 LoopStatusBar |
| `frontend/src/components/BrandHeader.tsx` | 修改 | 新增 Vibe Coding 菜单项 |

### 4.3 文档（待创建）

| 路径 | 操作 | 说明 |
|------|------|------|
| `CYCLE58_STARTUP.md` | 新建 | Cycle 58 启动文档 |
| `CYCLE58_RESEARCH_REPORT.md` | 新建 | 7 主题调研汇总 |
| `CYCLE58_TOPIC_RESEARCH_a_vibe_coding_flow.md` | 新建 | 主题 a 调研 |
| `CYCLE58_TOPIC_RESEARCH_b_loop_workflow.md` | 新建 | 主题 b 调研 |
| `CYCLE58_TOPIC_RESEARCH_c_thinking_visualization.md` | 新建 | 主题 c 调研 |
| `CYCLE58_TOPIC_RESEARCH_d_streaming_render.md` | 新建 | 主题 d 调研 |
| `CYCLE58_TOPIC_RESEARCH_e_live_code_render.md` | 新建 | 主题 e 调研 |
| `CYCLE58_TOPIC_RESEARCH_f_diff_tracking.md` | 新建 | 主题 f 调研 |
| `CYCLE58_TOPIC_RESEARCH_g_code_rollback.md` | 新建 | 主题 g 调研 |
| `CYCLE58_GAP_ANALYSIS.md` | 新建 | 功能差距分析报告 |
| `CYCLE58_SPEC.md` | 新建 | 5 大 P0 任务规范 |
| `CYCLE58_task.md` | 新建 | 任务分解清单 |
| `CYCLE58_checklist.md` | 新建 | 验收清单 |
| `CYCLE58_ACCEPTANCE_REPORT.md` | 新建 | 验收报告（阶段 5） |
| `CYCLE58_CODE_MODIFICATION_LOG.md` | 新建 | 代码修改日志 |
| `CYCLE59_STARTUP.md` | 新建 | C58 完成后启动 C59 |

---

## 5. 实施时序与并行规则

```
Phase 1 (串行):  调研 ── 7 主题并行抓取 ── 汇总
                            ↓
Phase 2 (串行):  差距分析 ── spec 撰写 ── 验收标准
                            ↓
Phase 3a (串行):  G58-01 模式入口（其他依赖它）
                            ↓
Phase 3b (并行):  G58-02 ┐
                G58-03 ├─ 4 任务并行
                G58-04 │
                G58-05 ┘
                            ↓
Phase 3c (串行):  G58-INTEGRATION 端到端集成
                            ↓
Phase 4 (串行):  测试 ── UI/UX 优化
                            ↓
Phase 5 (串行):  验收 ── 推 main
                            ↓
                         C58 完成
                            ↓
                    （自动接续 C59）
```

**关键约束**：
- 每个 P0 任务必须经 Hook 通知 + Git 原子提交才能进入下一任务
- 智能体调度平台监听 `task_completed` Hook 自动 git commit
- 高风险任务必须经批判反思智能体 + 质量保障智能体双重审核
- INTEGRATION 阶段必须实际运行项目（`npm run dev` + 端口探测）

---

## 6. 高风险模块标记

| 模块 | 风险等级 | 风险描述 | 缓解措施 |
|------|----------|----------|----------|
| G58-02 ClaudeCodeShell | 🟠 高 | 子进程管理 + 真实 LLM 调用，可能沙箱逃逸/资源耗尽 | 超时熔断 + 资源限制 + 路径净化 + 用户确认 |
| G58-04 Auto-Follow | 🟢 低 | UI 副作用，不影响数据 | 可关闭开关 + 防抖 |
| G58-05 ComposerPlan | 🟡 中 | LLM 驱动执行可能死循环 | 超时/最大步数/手动中断 |
| G58-INTEGRATION | 🟡 中 | 端到端集成涉及多个子系统 | 灰度发布 + 失败回滚 + smoke test |

---

## 7. 全局接口定义清单

### 7.1 新增 REST 端点

| 端点 | 方法 | 功能 | 输入 | 输出 |
|------|------|------|------|------|
| `/api/vibe-coding/session` | POST | 创建 Vibe Coding 会话 | `{prompt, model, mode}` | `{session_id, state}` |
| `/api/vibe-coding/session/{id}` | GET | 查询会话状态 | — | `{state, plan, steps}` |
| `/api/vibe-coding/session/{id}/pause` | POST | 暂停循环 | — | `{success}` |
| `/api/vibe-coding/session/{id}/resume` | POST | 恢复循环 | — | `{success}` |
| `/api/vibe-coding/plan/execute` | POST | 执行 Plan | `{plan_id}` | `{execution_id}` |
| `/api/loop-state/machine` | GET | 查询 Loop 状态机 | — | `{stage, progress, eta}` |
| `/api/loop-state/machine` | WS | 实时状态变更 | — | SSE events |
| `/api/auto-follow/enable` | POST | 启用 Auto-Follow | `{panel_id}` | `{success}` |
| `/api/auto-follow/disable` | POST | 关闭 Auto-Follow | — | `{success}` |
| `/api/claude-shell/invoke` | POST | 触发 Claude Code CLI | `{prompt, args}` | `{output_stream}` |
| `/api/claude-shell/invoke` | WS | 流式输出 | — | chunk events |

### 7.2 新增 SSE 事件类型

| 事件 | Payload | 触发时机 |
|------|---------|----------|
| `vibe_session_started` | `{session_id}` | 会话创建 |
| `vibe_plan_generated` | `{plan_id, steps[]}` | Plan 生成 |
| `vibe_step_started` | `{step_id, name}` | 单步开始 |
| `vibe_step_completed` | `{step_id, output}` | 单步完成 |
| `auto_follow_panel_opened` | `{panel_id, reason}` | 自动开 panel |
| `loop_state_changed` | `{from, to, progress}` | 状态机迁移 |
| `claude_shell_output` | `{chunk, stream}` | Claude Code 流式输出 |

### 7.3 新增 WS 消息类型

| 类型 | Payload | 方向 |
|------|---------|------|
| `VIBE_CONTROL` | `{action: pause/resume/cancel}` | C→S |
| `VIBE_STATE_PUSH` | `{state}` | S→C |
| `CLAUDE_SHELL_INVOKE` | `{prompt, args}` | C→S |
| `CLAUDE_SHELL_CHUNK` | `{chunk}` | S→C |
| `AUTO_FOLLOW_TRIGGER` | `{panel_id, action}` | S→C |

### 7.4 前端 Hook 签名

```ts
// Vibe Coding 会话管理
useVibeCoding(): {
  session: VibeSession | null;
  state: 'idle' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'done';
  startSession(prompt: string, model?: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
}

// Claude Code Shell 客户端
useClaudeCodeShell(): {
  invoke(prompt: string, args?: string[]): AsyncIterator<string>;
  cancel(): void;
  isRunning: boolean;
  output: string;
}

// Auto-Follow 联动
useAutoFollow(): {
  enabled: boolean;
  follow(event: SSEEvent): void;
  setEnabled(b: boolean): void;
}

// Loop 状态机
useLoopState(): {
  state: LoopState;
  progress: number;
  eta: number;
  history: LoopTransition[];
}
```

---

## 8. 依赖版本统一规范

### 8.1 新增 npm 包
- 无新增外部 npm 包（全部用现有依赖：React 18.3 / TypeScript 5.6 / Vite 6 / TailwindCSS 3.4 / Monaco / shiki / zustand / @tanstack/react-virtual）

### 8.2 新增 pip 包
- `pexpect>=4.9.0` — Claude Code CLI 交互式 shell-out（如不可用则降级 subprocess）

### 8.3 系统依赖
- `claude` CLI 已安装在 PATH（若未安装则降级为 LLM HTTP 模式）

---

## 9. 验收标准（量化指标）

### 9.1 代码质量
- TypeScript 编译 0 错误
- Vite 构建成功（< 30s）
- 单元测试覆盖率 ≥ 90%
- ESLint 0 error

### 9.2 功能验收
- 5 大 P0 任务全部实现并通过验收清单
- 7 大调研主题的报告完整
- Loop V7 工作流加固并能持续运行

### 9.3 测试验收
- 单元测试 100% 通过
- 集成测试 100% 通过
- 端到端测试 100% 通过（TRAE-browseruse 工具模拟用户操作）
- 浏览器兼容性测试通过（Chrome / Firefox / Safari / Edge）

### 9.4 性能指标
- 页面首屏加载 < 2s
- 流式响应首字节延迟 < 200ms
- Loop 状态查询 API P95 < 100ms
- Claude Code Shell 命令启动延迟 < 1s

### 9.5 功能对标验收
- codex + trae solo 模式功能集合 100% 匹配
- 项目实运行效果与用户需求完全一致

---

## 10. 循环接续机制

```
C58 完成 → 生成 CYCLE58_ACCEPTANCE_REPORT.md → 识别剩余 P1/P2 任务
                                              ↓
                                         生成 CYCLE59_STARTUP.md
                                              ↓
C59 开始（自动或手动）→ 实施 P1 增强 → 验收
                                              ↓
                                         生成 CYCLE60_STARTUP.md
                                              ↓
C60 开始 → 实施 P2 优化 → 验收
                                              ↓
                                         目标完成判定
```

**目标完成判定**：
- 5 P0 + 5 P1 + 5 P2 共 15 大功能点全部实现并通过验收
- 总测试用例 ≥ 8000，100% 通过
- 累计 18+ 原子 Git 提交（C58×6 + C59×6 + C60×6）
- 累计 ~15000+ 行新代码

---

## 11. 风险与回退策略

| 风险 | 回退策略 |
|------|----------|
| ClaudeCodeShell 在沙箱环境不可用 | 降级为 LLM HTTP 调用（保留配置导入） |
| Auto-Follow 引发用户困扰 | 提供关闭开关 + 不影响 chat/coding 模式 |
| Vibe Coding 模式与现有模式冲突 | 保留 chat/coding 二元模式，vibe-coding 作为可选 |
| MCP 抓取失败 | 降级为基于已有 `docs/Cycle/CODEX_TRAE_RESEARCH.md` |
| 端到端测试不通过 | 自动打回对应任务修复 + 重测，最多 3 轮 |
| 浏览器工具不可用 | 改用 Playwright/Selenium 替代 |

---

## 12. 验证方法

### 12.1 单元级验证
- 每个 P0 任务完成后立即跑对应的单测
- 阶段 4 完成后跑全套 vitest + pytest
- 覆盖率报告嵌入 CYCLE58_ACCEPTANCE_REPORT.md

### 12.2 集成级验证
- 启动后端：`uvicorn backend.app.main:app --reload --port 8000`
- 启动前端：`cd frontend && npm run dev` (端口 5173)
- 验证 5 大 P0 任务端到端串联工作

### 12.3 端到端验证（TRAE-browseruse）
- 模拟用户输入"创建一个 React TODO 应用"
- 验证 Vibe Coding 模式启动 → 总架构师澄清 → Plan 生成 → Plan 执行 → Loop 状态机持续可见 → Auto-Follow 联动 → ComposerPlan 持续生成代码
- 验证 ClaudeCodeShell 真实进程调用（如可用）
- 验证代码回退、差异比对

### 12.4 项目实运行验证
- 智能体调度平台完整执行 Loop V7 15 步 SOP
- 实际运行 Hermes 平台前端
- 模拟用户完整对话流程
- 确认项目运行效果与用户需求一致

---

## 13. 待用户确认事项

1. **调研资料来源**：是否需要额外提供 codex/trae 的私有访问凭证？（默认仅抓取公开资料）
2. **ClaudeCodeShell 真实进程调用**：是否允许实际执行 `claude` CLI？（如不允许则全部降级为 LLM HTTP）
3. **浏览器工具执行**：是否授权使用 TRAE-browseruse 工具进行端到端测试？（需要外部网络）
4. **C58 周期长度**：是否允许 C58 在 P0 实施 5 任务 + 完整测试后结束？（预计 6 个原子提交）

---

**等待用户确认以上问题后，进入 Cycle 58 阶段 1（互联网调研）开始执行。**
