# Tasks: 项目优化路线图 — Loop Engineering 工作流

> **基于 Spec**: [spec.md v2.0.0](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **说明**: 本 tasks.md 为顶层路线图任务列表，各阶段任务在实施时将拆分为独立 spec 进行详细设计。

---

## P0 任务：核心工作流（必须最先完成）

### Task 1: Loop Engineering 工作流引擎

- [ ] **1.1 数据模型**
  - [ ] 1.1.1: 在 `backend/app/models.py` 中新增 Workflow 模型（id, session_id, status, current_stage, created_at, updated_at）
  - [ ] 1.1.2: 在 `backend/app/models.py` 中新增 WorkflowStage 模型（id, workflow_id, stage_name, status, agent_role, input_doc, output_doc, started_at, completed_at）
  - [ ] 1.1.3: 在 `backend/app/models.py` 中新增 AgentRole 模型（id, name, description, system_prompt, trigger_rules JSON）
  - [ ] 1.1.4: 扩展 Session 模型（新增 workflow_id, workflow_stage 字段）
  - [ ] 1.1.5: 数据库迁移脚本

- [ ] **1.2 工作流引擎**
  - [ ] 1.2.1: 创建 `backend/app/services/workflow_engine.py` — WorkflowEngine 类
  - [ ] 1.2.2: 实现 `start_workflow(session_id, user_input) -> Workflow`
  - [ ] 1.2.3: 实现 `advance_stage(workflow_id) -> WorkflowStage`
  - [ ] 1.2.4: 实现 `rollback_stage(workflow_id, target_stage) -> WorkflowStage`
  - [ ] 1.2.5: 实现 `get_workflow_status(workflow_id) -> WorkflowStatus`
  - [ ] 1.2.6: 实现阶段状态机: `pending → clarifying → designing → prompting → executing → reviewing → (iterating → executing) | completed | failed`
  - [ ] 1.2.7: 实现迭代闭环控制（最大 3 轮自动终止）
  - [ ] 1.2.8: 实现阶段超时机制

- [ ] **1.3 工作流 API**
  - [ ] 1.3.1: 创建 `backend/app/api/workflow.py`
  - [ ] 1.3.2: `POST /api/workflow/start` — 启动工作流
  - [ ] 1.3.3: `GET /api/workflow/{id}/status` — 获取工作流状态
  - [ ] 1.3.4: `POST /api/workflow/{id}/advance` — 推进到下一阶段
  - [ ] 1.3.5: `POST /api/workflow/{id}/rollback` — 回退到指定阶段
  - [ ] 1.3.6: `GET /api/workflow/{id}/stages` — 获取所有阶段详情

- [ ] **1.4 HermesService 增强**
  - [ ] 1.4.1: 增强 `backend/app/services/hermes_service.py` — 新增工作流编排方法
  - [ ] 1.4.2: 实现 `start_workflow(session_id, user_input)` 方法
  - [ ] 1.4.3: 实现 `execute_agent_role(role, context)` 方法 — 以指定角色身份调用 Hermes
  - [ ] 1.4.4: 实现角色 system prompt 注入机制

- [ ] **1.5 验证**
  - [ ] 1.5.1: 6 阶段工作流正确串联执行
  - [ ] 1.5.2: 阶段切换延迟 < 2 秒
  - [ ] 1.5.3: 迭代闭环最多 3 轮自动终止
  - [ ] 1.5.4: 工作流中断后可恢复

---

### Task 2: 5 个智能体角色实现

- [ ] **2.1 需求澄清智能体**
  - [ ] 2.1.1: 创建 `backend/app/services/agent_roles/requirement_clarifier.py`
  - [ ] 2.1.2: 实现 `clarify(user_input, context) -> AsyncIterator[Message]` — 多轮对话流式输出
  - [ ] 2.1.3: 实现 `generate_requirement_doc(conversation_history) -> str` — 生成标准化需求文档
  - [ ] 2.1.4: 实现 `handle_change(change_request, current_doc) -> ChangeAnalysis` — 需求变更处理
  - [ ] 2.1.5: 编写 system prompt（需求翻译官与标准化专家，含 6 个关键维度引导）
  - [ ] 2.1.6: 集成到工作流引擎的 clarifying 阶段
  - [ ] 2.1.7: 验证：需求文档覆盖 6 个关键维度，对话轮次 3-5 轮

- [ ] **2.2 总架构师智能体**
  - [ ] 2.2.1: 创建 `backend/app/services/agent_roles/chief_architect.py`
  - [ ] 2.2.2: 实现 `design_architecture(requirement_doc) -> ArchitectureOutput` — 全局架构设计
  - [ ] 2.2.3: 实现 `adapt_local(change_request, current_arch) -> AdaptationResult` — 局部适配
  - [ ] 2.2.4: 实现 `evaluate_scope(change) -> ScopeAssessment` — 影响范围评估
  - [ ] 2.2.5: 实现 `check_redline(adaptation) -> RedlineCheck` — 红线自检
  - [ ] 2.2.6: 实现 `generate_spec(architecture) -> str` — 生成 spec.md
  - [ ] 2.2.7: 实现 `generate_checklist(architecture) -> str` — 生成 checklist.md
  - [ ] 2.2.8: 实现 `generate_tasks(architecture) -> str` — 生成 task.md
  - [ ] 2.2.9: 实现 `generate_acceptance_criteria(architecture, critic_feedback) -> str` — 生成验收标准.md
  - [ ] 2.2.10: 编写 system prompt（全系统架构统一治理者，含权责红线、强制升级条件、输出规范）
  - [ ] 2.2.11: 集成到工作流引擎的 designing 阶段
  - [ ] 2.2.12: 验证：四文档完整输出，红线自检覆盖率 100%，升级判定零漏报

- [ ] **2.3 提示词工程智能体**
  - [ ] 2.3.1: 创建 `backend/app/services/agent_roles/prompt_engineer.py`
  - [ ] 2.3.2: 实现 `parse_tasks(task_md) -> List[ModuleTask]` — 解析 task.md
  - [ ] 2.3.3: 实现 `optimize_prompt(module_task, architecture_context) -> str` — 提示词优化
  - [ ] 2.3.4: 实现 `inject_to_claude_cli(optimized_prompt, worktree) -> AgentInstance` — 注入 Claude Code CLI
  - [ ] 2.3.5: 实现 `validate_prompt(optimized_prompt) -> ValidationResult` — 提示词质量校验
  - [ ] 2.3.6: 编写 system prompt（架构提示词标准化专家）
  - [ ] 2.3.7: 集成到工作流引擎的 prompting 阶段
  - [ ] 2.3.8: 验证：提示词语义歧义消除率 100%，核心约束覆盖率 100%

- [ ] **2.4 批判反思智能体**
  - [ ] 2.4.1: 创建 `backend/app/services/agent_roles/critical_reviewer.py`
  - [ ] 2.4.2: 实现 `review_architecture(spec, checklist, tasks, acceptance) -> ReviewReport` — 5 维度全维度评审
  - [ ] 2.4.3: 实现 `check_compliance(adaptation_result) -> ComplianceReport` — 合规性校验
  - [ ] 2.4.4: 实现 `review_risk_labels(tasks) -> RiskReviewReport` — 风险等级复核
  - [ ] 2.4.5: 实现 `compare_versions(old_docs, new_docs) -> DiffReport` — 版本对比评审
  - [ ] 2.4.6: 编写 system prompt（架构风险官与合规专家，含 5 维度评审标准）
  - [ ] 2.4.7: 集成到工作流引擎的 designing 阶段（总架构师输出后触发，仅此一次）
  - [ ] 2.4.8: 验证：5 维度评审覆盖率 100%，高风险模块漏标率 = 0%

- [ ] **2.5 质量保障与迭代管理智能体**
  - [ ] 2.5.1: 创建 `backend/app/services/agent_roles/quality_manager.py`
  - [ ] 2.5.2: 实现 `execute_stage_1(module_code) -> SafetyReport` — 单模块安全校验
  - [ ] 2.5.3: 实现 `execute_stage_2(module_spec) -> TestScripts` — 测试脚本生成
  - [ ] 2.5.4: 实现 `execute_stage_3(all_modules) -> IntegrationReport` — 多模块集成校验
  - [ ] 2.5.5: 实现 `execute_stage_4(integrated_code) -> EvaluationReport` — 全局系统评测
  - [ ] 2.5.6: 实现 `execute_stage_5(project_context) -> DeliveryPackage` — 迭代闭环与版本管理
  - [ ] 2.5.7: 实现 `check_stage_boundary(current_stage, action) -> BoundaryCheck` — 阶段边界校验
  - [ ] 2.5.8: 实现 `evaluate_escalation(findings) -> EscalationDecision` — 升级判定
  - [ ] 2.5.9: 编写 system prompt（全系统质量与项目生命周期统一管理者，含 5 阶段职责、刚性边界、强制升级条件）
  - [ ] 2.5.10: 集成到工作流引擎的 reviewing 阶段
  - [ ] 2.5.11: 验证：5 阶段全部正确执行，刚性边界零违规，升级条件零漏报

---

## P1 任务：支撑能力

### Task 3: Git Worktree 隔离

- [ ] **3.1 数据模型与 API**
  - [ ] 3.1.1: 在 `backend/app/models.py` 中新增 Worktree 模型（id, agent_id, task_id, repo_path, worktree_path, branch_name, status, created_at）
  - [ ] 3.1.2: 数据库迁移脚本
  - [ ] 3.1.3: 创建 `backend/app/api/worktree.py`（GET/POST/DELETE 端点）

- [ ] **3.2 WorktreeManager 服务**
  - [ ] 3.2.1: 创建 `backend/app/services/worktree_manager.py`
  - [ ] 3.2.2: 实现 `create_worktree(repo_path, module_name, instance_id) -> WorktreeInfo`
  - [ ] 3.2.3: 实现 `merge_worktree(worktree_id) -> MergeResult`
  - [ ] 3.2.4: 实现 `cleanup_worktree(worktree_id)`
  - [ ] 3.2.5: 实现 `list_worktrees(repo_path) -> List[WorktreeInfo]`
  - [ ] 3.2.6: 实现自动清理策略（质量评审通过后触发）

- [ ] **3.3 集成**
  - [ ] 3.3.1: 提示词工程智能体 `inject_to_claude_cli()` 集成 WorktreeManager
  - [ ] 3.3.2: AgentManager `create_agent()` 支持 worktree 参数

- [ ] **3.4 验证**
  - [ ] 3.4.1: worktree 创建耗时 < 2 秒
  - [ ] 3.4.2: 多模块并行操作零冲突
  - [ ] 3.4.3: worktree 自动清理成功率 > 95%

---

### Task 4: Web Dashboard 工作流监控

- [ ] **4.1 后端**
  - [ ] 4.1.1: 创建 `backend/app/api/dashboard.py` — Dashboard API
  - [ ] 4.1.2: `GET /api/dashboard/workflow/{id}` — 获取工作流 Dashboard 数据
  - [ ] 4.1.3: WebSocket 广播工作流阶段变更事件

- [ ] **4.2 前端**
  - [ ] 4.2.1: 创建 `frontend/src/components/WorkflowDashboard.tsx` — 工作流主面板
  - [ ] 4.2.2: 实现 6 阶段进度条（需求澄清 → 架构设计 → 提示词工程 → 执行 → 质量评审 → 迭代闭环）
  - [ ] 4.2.3: 实现阶段状态图标（pending/running/completed/failed）
  - [ ] 4.2.4: 实现阶段切换动画
  - [ ] 4.2.5: 创建 `frontend/src/components/StageViewer.tsx` — 阶段详情查看器
  - [ ] 4.2.6: 实现阶段输入/输出文档展示
  - [ ] 4.2.7: 实现智能体对话记录展示
  - [ ] 4.2.8: 实现阶段操作按钮（重试/跳过）
  - [ ] 4.2.9: 集成 WebSocket 实时更新
  - [ ] 4.2.10: 集成到 App.tsx 编程模式面板

- [ ] **4.3 验证**
  - [ ] 4.3.1: Dashboard 加载时间 < 1 秒
  - [ ] 4.3.2: 状态更新延迟 < 500ms
  - [ ] 4.3.3: 阶段切换动画流畅（60fps）

---

### Task 5: Git 自动 Commit + Push

- [ ] **5.1 后端**
  - [ ] 5.1.1: 增强 `backend/app/services/git_manager.py`
  - [ ] 5.1.2: 实现 `auto_commit(instance_id, changed_files) -> CommitResult`
  - [ ] 5.1.3: 实现 `generate_commit_message(changes, module_context) -> str` — LLM 生成 commit message
  - [ ] 5.1.4: 实现 `auto_push(branch) -> PushResult`
  - [ ] 5.1.5: 添加配置项 `git.auto_commit`, `git.auto_push`

- [ ] **5.2 前端**
  - [ ] 5.2.1: 增强 `frontend/src/components/GitPanel.tsx` — 自动 commit 历史、开关

- [ ] **5.3 验证**
  - [ ] 5.3.1: 代码修改后 3 秒内自动 commit
  - [ ] 5.3.2: commit message 描述准确率 > 80%

---

### Task 6: Monaco Editor 升级 CodeViewer

- [ ] **6.1 依赖与基础**
  - [ ] 6.1.1: 安装 `@monaco-editor/react`
  - [ ] 6.1.2: 重构 `frontend/src/components/CodeViewer.tsx` 为 Monaco Editor 封装
  - [ ] 6.1.3: 实现代码分割 + 懒加载

- [ ] **6.2 功能实现**
  - [ ] 6.2.1: 语法高亮（TypeScript/Python/C++/JavaScript/JSON/YAML/CMake）
  - [ ] 6.2.2: 智能补全（TypeScript 内置）
  - [ ] 6.2.3: 错误诊断（红色波浪线 + 悬停详情）
  - [ ] 6.2.4: 多 Tab 文件编辑

- [ ] **6.3 验证**
  - [ ] 6.3.1: Monaco Editor 首次加载 < 2 秒
  - [ ] 6.3.2: 支持至少 6 种语言语法高亮
  - [ ] 6.3.3: TypeScript 智能补全可用

---

## P2 任务：智能化增强

### Task 7: 跨 Session Memory（Hermes 内核管理）

- [ ] **7.1 Hermes 集成**
  - [ ] 7.1.1: 增强 `hermes_integration/hermes_executor.py`
  - [ ] 7.1.2: 实现 `summarize_session(session_id) -> SessionSummary` — 对话总结
  - [ ] 7.1.3: 实现 `extract_preferences(session_id) -> UserPreferences` — 用户偏好提取
  - [ ] 7.1.4: 实现 `generate_skills(project_context) -> List[Skill]` — 自动编写 Skills

- [ ] **7.2 存储**
  - [ ] 7.2.1: 增强 `backend/app/services/memory_store.py` — 记忆持久化
  - [ ] 7.2.2: 实现 `.hermes/memory/` 目录管理

- [ ] **7.3 验证**
  - [ ] 7.3.1: 对话总结覆盖率 100%
  - [ ] 7.3.2: Skills 自动生成准确率 > 70%
  - [ ] 7.3.3: 记忆加载时间 < 500ms

---

## 任务依赖关系

```
Task 1 (工作流引擎) ──→ Task 2 (智能体角色)
                    ──→ Task 4 (Dashboard)

Task 2 ──→ Task 3 (Worktree，提示词工程阶段需要)

Task 5 (Git 自动) — 独立
Task 6 (Monaco) — 独立
Task 7 (Memory) — 独立
```

## 实施建议

1. **Task 1 和 Task 2 必须顺序执行**（先有引擎，再有角色）
2. **Task 3 在 Task 2 的提示词工程智能体开发时同步进行**
3. **Task 5、6、7 可与其他任务并行开发**
4. **每个 Task 完成后进行集成测试**，确保工作流端到端可用
5. **各 Task 在实施时拆分为独立 spec**，进行详细设计和任务分解
