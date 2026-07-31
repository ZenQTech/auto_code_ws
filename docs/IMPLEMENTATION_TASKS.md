# 全栈优化与 TRAE SOLO + Codex 功能整合 - 实施任务

> **版本**: v2.1.0
> **创建日期**: 2026-07-25
> **关联文档**:
> - Spec: `.trae/specs/fullstack-optimization/spec.md` v2.0.0
> - 调研报告: `/home/qizheng/auto_code_ws/CODEX_TRAE_RESEARCH.md`
> - 差距分析: `/home/qizheng/auto_code_ws/GAP_ANALYSIS_REPORT.md`
> - Checklist: `/home/qizheng/auto_code_ws/.trae/specs/fullstack-optimization/checklist.md`

## 任务执行总览

**核心原则**: 按 P0 → P1 → P2 顺序执行；所有 P0 项必须 100% 完成才能进入下一阶段。

**高风险模块刚性标记**:
- 🔴 **极高风险**: Plan 模式后端、SubAgent 上下文隔离、代码自动提交
- 🟡 **高风险**: 巨型文件拆分、对话节点折叠、WebSocket 实时通信
- 🟢 **中等风险**: UI 优化、API 速率限制、骨架屏

---

## 🔴 P0 任务：阻塞性差距（必须 100% 完成）

### P0-1: workflow_engine.py 真正拆分 🔴极高风险
**目标**: 将 5241 行 WorkflowEngine 类的真实实现逻辑按阶段方法下沉到独立模块

**风险标记**: 极高（核心工作流引擎，改动影响所有任务执行路径）

**输入**:
- `backend/app/services/workflow_engine.py` (5241 行)
- 7 个 re-export 桩文件（stage_clarify.py 等 22-52 行）

**输出**:
- `backend/app/services/workflow/engine.py` (~300 行主入口)
- `backend/app/services/workflow/stage_clarify.py` (~1000 行真实实现)
- `backend/app/services/workflow/stage_design.py` (~1100 行真实实现)
- `backend/app/services/workflow/stage_prompting.py` (~1000 行真实实现)
- `backend/app/services/workflow/stage_execute.py` (~1100 行真实实现)
- `backend/app/services/workflow/stage_review.py` (~1000 行真实实现)
- `backend/app/services/workflow/stage_common.py` (~500 行公共工具)
- `workflow_engine.py` 删除或改为兼容层

**执行步骤**:
1. ✅ **接口先行**: 定义 5 个阶段模块对外暴露的 API 接口（`run_stage_clarify()` 等）
2. ✅ **公共工具下沉**: 将 `WorkflowEngine` 中所有 `_*` 私有工具方法 → `stage_common.py`
3. ✅ **按阶段方法迁移**:
   - `_clarify_iteration()` `_process_clarify_questions()` 等 → `stage_clarify.py`
   - `_design_architecture()` `_generate_architecture_doc()` 等 → `stage_design.py`
   - `_optimize_prompts()` `_generate_prompts()` 等 → `stage_prompting.py`
   - `_execute_claude_code()` `_monitor_execution()` 等 → `stage_execute.py`
   - `_review_code()` `_verify_acceptance()` 等 → `stage_review.py`
4. ✅ **主入口瘦身**: `engine.py` 仅保留 `WorkflowEngine.__init__` + `run()` + 阶段调度逻辑
5. ✅ **删除原文件**: 删除 `workflow_engine.py`，更新所有 `import` 引用
6. ✅ **回归测试**: 跑通完整 5 阶段工作流

**验证标准**:
- [ ] `workflow_engine.py` 已删除
- [ ] 7 个子模块总计 < 5000 行（避免逻辑膨胀）
- [ ] 后端启动无 ImportError
- [ ] 5 阶段工作流端到端跑通（用同一测试用例前后对比）
- [ ] 现有 Git 提交历史保留

**预估工时**: 3-5 天

---

### P0-2: App.tsx 真正拆分 🟡高风险
**目标**: 将 2258 行 App.tsx 真实实现逻辑下沉到 5 个子组件

**风险标记**: 高（前端核心入口，改动影响所有页面渲染）

**输入**:
- `frontend/src/App.tsx` (2258 行)
- 2 个 re-export 桩文件 (ChatView.tsx 95 行, InputArea.tsx 85 行)

**输出**:
- `frontend/src/App.tsx` (~200 行，仅保留路由 + 全局 Provider)
- `frontend/src/components/chat/ChatView.tsx` (~400 行真实实现)
- `frontend/src/components/chat/InputArea.tsx` (~250 行真实实现)
- `frontend/src/components/chat/MessageBubble.tsx` (增强现有)
- `frontend/src/components/workflow/ClarificationHandler.tsx` (~350 行真实实现)
- `frontend/src/components/workflow/WorkflowStageRenderer.tsx` (~300 行真实实现)
- `frontend/src/components/workflow/DesignPhaseHandler.tsx` (~350 行真实实现)

**执行步骤**:
1. ✅ **拆分 useState 状态**: 标识 App.tsx 中所有顶层 state，分类到子组件
2. ✅ **按职责迁移 JSX**:
   - 对话消息渲染 + 滚动到底部 → `ChatView`
   - 输入框 + 发送按钮 + 防抖 → `InputArea`
   - 澄清阶段问题展示 + 用户回答 → `ClarificationHandler`
   - 阶段进度条 + 阶段切换 → `WorkflowStageRenderer`
   - 架构设计阶段特殊UI → `DesignPhaseHandler`
3. ✅ **回调向上**: 子组件通过 props 回调通知父组件状态变更
4. ✅ **React.memo 优化**: 每个子组件包裹 memo + useCallback
5. ✅ **类型定义**: 提取 Props 类型到独立 `.types.ts`
6. ✅ **删除原 App.tsx 逻辑**: 仅保留根组件 + Provider

**验证标准**:
- [ ] App.tsx < 250 行
- [ ] 每个子组件 < 500 行
- [ ] `npm run build` 成功
- [ ] 浏览器实操所有交互正常
- [ ] 无运行时 React warning

**预估工时**: 2-3 天

---

### P0-3: useApi.ts 真正拆分 🟡高风险
**目标**: 将 1872 行 useApi.ts 真实实现逻辑下沉到 5 个模块化 hooks

**风险标记**: 高（所有 API 调用的核心 hook，改动影响所有组件）

**输入**:
- `frontend/src/hooks/useApi.ts` (1872 行)
- 4 个 re-export 桩文件（useSessionsApi.ts 等）

**输出**:
- `frontend/src/hooks/useApi.ts` (~80 行，仅保留 `apiFetch` + 通用类型)
- `frontend/src/hooks/useSessionsApi.ts` (~400 行)
- `frontend/src/hooks/useHermesApi.ts` (~500 行)
- `frontend/src/hooks/useWorkflowApi.ts` (~500 行)
- `frontend/src/hooks/useProjectApi.ts` (~400 行)

**执行步骤**:
1. ✅ **按业务域分类**: 扫描所有 hook 调用，按 sessions/hermes/workflow/project/通用 分组
2. ✅ **apiFetch 抽离**: 通用 fetch 封装 + 错误处理 + retry 逻辑 → 保留在 useApi.ts
3. ✅ **逐个迁移**:
   - 会话 CRUD (createSession, listSessions, getSession, deleteSession) → useSessionsApi
   - Hermes (chatWithHermes, chatWithHermesStreaming, /api/hermes/*) → useHermesApi
   - 工作流 (startWorkflow, getWorkflowStatus, /api/workflow/*) → useWorkflowApi
   - 项目 (createProject, listProjects, /api/project/*, /api/git/*) → useProjectApi
4. ✅ **更新 import**: 全局替换 `from 'hooks/useApi'` → 对应的子 hooks
5. ✅ **删除原 hook 逻辑**

**验证标准**:
- [ ] useApi.ts < 100 行
- [ ] 4 个子 hooks 总计 < 2000 行
- [ ] `npm run build` 成功
- [ ] 所有功能页面正常工作

**预估工时**: 1-2 天

---

### P0-4: Plan 模式后端实现 🔴极高风险
**目标**: 实现 plan_mode.py 服务和 /api/workflow/{id}/plan/* 端点

**风险标记**: 极高（影响整个 spec/task/checklist 生成后到代码执行的过渡流程）

**输出**:
- `backend/app/services/plan_mode.py` (~500 行)
- `backend/app/api/plan.py` (~200 行)
- `backend/app/services/schemas/plan.py` (Pydantic schemas)

**核心数据模型**:
```python
class PlanTask(BaseModel):
    task_id: str
    title: str
    description: str
    estimated_minutes: int
    risk_level: Literal["low", "medium", "high", "extreme"]
    files_involved: List[str]
    dependencies: List[str]  # 其他 task_id

class PlanStage(BaseModel):
    stage: Literal["analyzing", "planning", "coding", "testing", "reviewing"]
    tasks: List[PlanTask]
    risks: List[str]
    alternatives: List[str]

class PlanDocument(BaseModel):
    plan_id: str
    workflow_id: str
    stages: List[PlanStage]
    generated_at: datetime
    status: Literal["pending", "confirmed", "modified", "rejected"]
    user_modifications: Optional[str]
```

**核心端点**:
- `POST /api/workflow/{workflow_id}/plan/generate` - LLM 生成 plan
- `POST /api/workflow/{workflow_id}/plan/confirm` - 用户确认 plan
- `POST /api/workflow/{workflow_id}/plan/modify` - 用户修改 plan
- `GET /api/workflow/{workflow_id}/plan` - 获取当前 plan

**执行步骤**:
1. ✅ **Pydantic schemas 定义** (`schemas/plan.py`)
2. ✅ **LLM Prompt 工程**: 构造 plan 生成 prompt，要求结构化输出
3. ✅ **PlanModeService 类**: generate_plan / confirm_plan / modify_plan
4. ✅ **FastAPI 路由**: 4 个端点 + 错误处理
5. ✅ **前端 PlanViewer 对接**: 确认按钮触发 confirm 端点
6. ✅ **集成到工作流引擎**: prompting 阶段后增加 plan 阶段

**验收测试**:
- [ ] 脚本测试: `pytest tests/test_plan_mode.py` 100% 通过
- [ ] 浏览器测试: 完整流程跑通 (生成→展示→修改→确认→执行)
- [ ] 性能测试: plan 生成 < 30s
- [ ] 边界测试: LLM 返回无效 JSON 时回退到默认 plan
- [ ] 异常测试: 用户拒绝 plan 时正确回滚

**预估工时**: 2-3 天

---

### P0-5: React Router 启用 🟡高风险
**目标**: 解决 react-router-dom 安装问题，启用路由系统

**风险标记**: 高（前端路由基础，影响所有页面导航）

**执行步骤**:
1. ✅ **解决安装问题**:
   - 尝试 `npm install react-router-dom@6 --save`
   - 失败时降级到 `npm install react-router-dom@5`
   - 仍失败则手动下载到 `frontend/src/vendor/react-router-dom/`
2. ✅ **AppRouter.tsx 完善**:
   - `/chat` → ChatView
   - `/coding` → CodingMode
   - `/workflow/:id` → WorkflowView
   - `/settings` → SettingsView
3. ✅ **main.tsx 包裹 BrowserRouter**
4. ✅ **侧边栏和模式切换**: 改用 `useNavigate()` 替代 state 切换
5. ✅ **测试所有路由跳转**

**验证标准**:
- [ ] 路由切换不刷新页面
- [ ] 浏览器前进/后退正常
- [ ] URL 反映当前状态

**预估工时**: 0.5 天

---

## 🟡 P1 任务：重要差距

### P1-1: 对话节点自动折叠 🟡高风险
**目标**: 已完成子任务对话节点自动折叠为摘要，可展开查看完整过程

**输出**:
- `frontend/src/components/chat/MessageGroup.tsx` (~200 行)
- `frontend/src/components/chat/MessageSummary.tsx` (~150 行)

**验收测试**:
- [ ] SubAgent 完成任务后 1s 内自动折叠
- [ ] 摘要卡片显示任务名/状态/耗时/文件变更数
- [ ] 点击摘要展开完整对话过程
- [ ] 折叠/展开动画 < 300ms

**预估工时**: 1-2 天

---

### P1-2: 用户干预按钮 🟡高风险
**目标**: 用户可在任意思考阶段点击"干预"暂停 AI 并输入修改建议

**输出**:
- `frontend/src/components/chat/InterveneButton.tsx` (~150 行)
- `backend/app/api/intervention.py` (~200 行)
- `WebSocket` 事件: `intervention_request` / `intervention_resume`

**验收测试**:
- [ ] AI 处于 reasoning_stage 任何阶段都可点击干预
- [ ] 点击后立即停止当前推理
- [ ] 用户输入修改建议后 AI 重新推理
- [ ] 干预历史在对话流中可追溯

**预估工时**: 1-2 天

---

### P1-3: CodeViewer 完整集成 code_stream 🟡高风险
**目标**: CodeViewer 完整消费 WebSocket code_stream 事件，编辑器修改可回传 AI

**输出**:
- `frontend/src/components/CodeViewer.tsx` 增强 (~400 行)
- 集成 Monaco Editor 实时显示
- 编辑器 onChange → WebSocket `editor_change` 事件

**验收测试**:
- [ ] AI 生成代码时 Monaco Editor 逐 token 显示
- [ ] 生成中/已完成状态明确区分
- [ ] 用户编辑后 AI 下次回复可感知到变更
- [ ] 性能测试: 1000 token/s 流不卡顿

**预估工时**: 1 天

---

### P1-4: ThinkingBlock 消费 reasoning_stage 🟡高风险
**目标**: ThinkingBlock 分阶段展示 reasoning_stage (analyzing/planning/coding/testing)

**输出**:
- `frontend/src/components/ThinkingBlock.tsx` 增强 (~250 行)
- 状态机: idle → analyzing → planning → coding → testing → done

**验收测试**:
- [ ] 每个阶段有独立 UI (icon + label + progress bar)
- [ ] 阶段切换有动画过渡
- [ ] 全部完成后显示"完成"徽章

**预估工时**: 0.5 天

---

### P1-5: docker-compose 集成 nginx service 🟢中等风险
**目标**: docker-compose.yml 中添加 nginx service

**输出**:
- `docker-compose.yml` 修订
- `nginx.conf` 已在 (确认完整)

**验证**:
- [ ] `docker-compose up` 启动 3 个 service: backend + db + nginx
- [ ] nginx 反向代理 /api 到 backend
- [ ] 静态文件由 nginx 服务

**预估工时**: 0.5 天

---

### P1-6: PG 迁移脚本 🟢中等风险
**目标**: `scripts/migrate_sqlite_to_pg.py` 数据迁移脚本

**输出**:
- `scripts/migrate_sqlite_to_pg.py` (~300 行)
- 支持所有表的结构映射和数据迁移
- 支持 dry-run 模式

**验证**:
- [ ] SQLite → PG 迁移 100% 数据完整性
- [ ] 迁移后可正常读写

**预估工时**: 1 天

---

## 🟢 P2 任务：体验增强

### P2-1: SubAgent 工作区前端展示
**目标**: 前端展示各 SubAgent 独立工作区状态 (分支名/进度/文件数)

**预估工时**: 1 天

### P2-2: 面板手动切换 + 恢复跟随
**目标**: 工具面板支持用户手动切换 Tab + "跟随"模式恢复

**预估工时**: 0.5 天

### P2-3: SettingsPanel 集成 PanelSkeleton
**目标**: SettingsPanel 加载时显示 PanelSkeleton 骨架屏

**预估工时**: 0.2 天

---

## 执行时序与并行规则

### 串行依赖
```
P0-1 (workflow_engine 拆分) ─→ P0-4 (Plan模式) ─→ Phase 4 测试
P0-2 (App.tsx 拆分)     ─→ P1-1 (对话节点折叠) ─→ P1-2 (用户干预)
P0-3 (useApi.ts 拆分)    ─→ P0-4 (Plan模式前端对接)
P0-5 (React Router)     ─→ P1-3 (CodeViewer 路由)
```

### 可并行
- P0-1, P0-2, P0-3, P0-5 之间可并行（不依赖彼此）
- P1-1, P1-2, P1-3, P1-4, P1-5, P1-6 之间可并行

### 严禁并行
- P0 任何任务未通过验收测试，禁止进入 P1

---

## 测试策略

### 每个 P0 任务完成后必须执行
1. **单元测试**: 对应的 `tests/test_*.py` 通过
2. **集成测试**: 后端 `pytest tests/integration/` 通过
3. **端到端测试**: 浏览器实操 (调用 MCP browser tools)
4. **性能测试**: 对应性能指标达标
5. **回归测试**: 现有 5 阶段工作流未破坏

### 全栈回归测试 (所有 P0 完成)
1. 完整 15 步工作流: 需求输入 → Git 提交
2. 7 大 vibe coding 维度逐项验证
3. checklist 中所有已完成项端到端实操
4. checklist 中所有未完成项确认状态

---

## 验收文档清单

每个 P0 任务完成后必须产出:
1. **代码修改日志**: 修改了哪些文件、为什么修改
2. **测试报告**: 单元 + 集成 + E2E 测试结果
3. **实操截图**: 浏览器实际操作截图 (MCP browser_take_screenshot)
4. **性能基准**: 关键指标的 baseline 数据
5. **更新 checklist.md**: 标记完成项，提供证据

---

**任务清单结束** - 严格执行，按序推进，每个任务完成后立即产出验收文档。
