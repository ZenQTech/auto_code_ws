# Checklist: 项目优化路线图 — Loop Engineering 工作流

> **基于 Spec**: [spec.md v2.0.0](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)

---

## Task 1: Loop Engineering 工作流引擎

### 数据模型
- [ ] Workflow 模型已添加到 `backend/app/models.py`（id, session_id, status, current_stage, created_at, updated_at）
- [ ] WorkflowStage 模型已添加到 `backend/app/models.py`（id, workflow_id, stage_name, status, agent_role, input_doc, output_doc, started_at, completed_at）
- [ ] AgentRole 模型已添加到 `backend/app/models.py`（id, name, description, system_prompt, trigger_rules JSON）
- [ ] Session 模型已扩展（新增 workflow_id, workflow_stage 字段）
- [ ] 数据库迁移脚本已执行（workflows, workflow_stages, agent_roles 表已创建）

### 工作流引擎
- [ ] `backend/app/services/workflow_engine.py` 已创建
- [ ] `start_workflow(session_id, user_input)` 方法已实现
- [ ] `advance_stage(workflow_id)` 方法已实现
- [ ] `rollback_stage(workflow_id, target_stage)` 方法已实现
- [ ] `get_workflow_status(workflow_id)` 方法已实现
- [ ] 阶段状态机已实现: `pending → clarifying → designing → prompting → executing → reviewing → (iterating → executing) | completed | failed`
- [ ] 迭代闭环控制已实现（最大 3 轮自动终止）
- [ ] 阶段超时机制已实现

### 工作流 API
- [ ] `backend/app/api/workflow.py` 已创建
- [ ] `POST /api/workflow/start` 端点已实现
- [ ] `GET /api/workflow/{id}/status` 端点已实现
- [ ] `POST /api/workflow/{id}/advance` 端点已实现
- [ ] `POST /api/workflow/{id}/rollback` 端点已实现
- [ ] `GET /api/workflow/{id}/stages` 端点已实现

### HermesService 增强
- [ ] `backend/app/services/hermes_service.py` 已增强（工作流编排方法）
- [ ] `start_workflow(session_id, user_input)` 方法已实现
- [ ] `execute_agent_role(role, context)` 方法已实现（以指定角色身份调用 Hermes）
- [ ] 角色 system prompt 注入机制已实现

### 验证
- [ ] 6 阶段工作流正确串联执行
- [ ] 阶段切换延迟 < 2 秒
- [ ] 迭代闭环最多 3 轮自动终止
- [ ] 工作流中断后可恢复

---

## Task 2: 5 个智能体角色实现

### 需求澄清智能体
- [ ] `backend/app/services/agent_roles/requirement_clarifier.py` 已创建
- [ ] `clarify(user_input, context)` 多轮对话流式输出已实现
- [ ] `generate_requirement_doc(conversation_history)` 标准化需求文档生成已实现
- [ ] `handle_change(change_request, current_doc)` 需求变更处理已实现
- [ ] system prompt 已编写（需求翻译官与标准化专家，含 6 个关键维度引导）
- [ ] 已集成到工作流引擎的 clarifying 阶段
- [ ] 需求文档覆盖 6 个关键维度（功能/性能/安全/约束/环境/验收）
- [ ] 对话轮次 3-5 轮内完成澄清
- [ ] 需求变更响应时间 < 30 秒

### 总架构师智能体
- [ ] `backend/app/services/agent_roles/chief_architect.py` 已创建
- [ ] `design_architecture(requirement_doc)` 全局架构设计已实现
- [ ] `adapt_local(change_request, current_arch)` 局部适配已实现
- [ ] `evaluate_scope(change)` 影响范围评估已实现
- [ ] `check_redline(adaptation)` 红线自检已实现
- [ ] `generate_spec(architecture)` 生成 spec.md 已实现
- [ ] `generate_checklist(architecture)` 生成 checklist.md 已实现
- [ ] `generate_tasks(architecture)` 生成 task.md 已实现
- [ ] `generate_acceptance_criteria(architecture, critic_feedback)` 生成验收标准.md 已实现
- [ ] system prompt 已编写（含权责红线、强制升级条件、输出规范）
- [ ] 已集成到工作流引擎的 designing 阶段
- [ ] 四文档（spec/checklist/task/验收标准）完整输出
- [ ] 影响范围评估准确率 > 90%
- [ ] 红线自检覆盖率 100%
- [ ] 局部适配升级判定零漏报

### 提示词工程智能体
- [ ] `backend/app/services/agent_roles/prompt_engineer.py` 已创建
- [ ] `parse_tasks(task_md)` 解析 task.md 已实现
- [ ] `optimize_prompt(module_task, architecture_context)` 提示词优化已实现
- [ ] `inject_to_claude_cli(optimized_prompt, worktree)` 注入 Claude Code CLI 已实现
- [ ] `validate_prompt(optimized_prompt)` 提示词质量校验已实现
- [ ] system prompt 已编写（架构提示词标准化专家）
- [ ] 已集成到工作流引擎的 prompting 阶段
- [ ] 提示词优化后语义歧义消除率 100%
- [ ] 核心约束（安全红线/性能指标/接口规范）覆盖率 100%
- [ ] 多模块并行注入成功率 > 95%

### 批判反思智能体
- [ ] `backend/app/services/agent_roles/critical_reviewer.py` 已创建
- [ ] `review_architecture(spec, checklist, tasks, acceptance)` 5 维度全维度评审已实现
- [ ] `check_compliance(adaptation_result)` 合规性校验已实现
- [ ] `review_risk_labels(tasks)` 风险等级复核已实现
- [ ] `compare_versions(old_docs, new_docs)` 版本对比评审已实现
- [ ] system prompt 已编写（架构风险官与合规专家，含 5 维度评审标准）
- [ ] 已集成到工作流引擎的 designing 阶段（总架构师输出后触发，仅此一次）
- [ ] 5 个维度评审覆盖率 100%
- [ ] 缺陷等级分类准确率 > 90%
- [ ] 高风险模块漏标率 = 0%
- [ ] 架构迭代对比评审覆盖率 100%

### 质量保障与迭代管理智能体
- [ ] `backend/app/services/agent_roles/quality_manager.py` 已创建
- [ ] `execute_stage_1(module_code)` 单模块安全校验已实现
- [ ] `execute_stage_2(module_spec)` 测试脚本生成已实现
- [ ] `execute_stage_3(all_modules)` 多模块集成校验已实现
- [ ] `execute_stage_4(integrated_code)` 全局系统评测已实现
- [ ] `execute_stage_5(project_context)` 迭代闭环与版本管理已实现
- [ ] `check_stage_boundary(current_stage, action)` 阶段边界校验已实现
- [ ] `evaluate_escalation(findings)` 升级判定已实现
- [ ] system prompt 已编写（含 5 阶段职责、刚性边界、强制升级条件）
- [ ] 已集成到工作流引擎的 reviewing 阶段
- [ ] 5 阶段全部正确执行
- [ ] 阶段间刚性边界零违规
- [ ] 强制升级条件零漏报
- [ ] 安全校验覆盖率 100%（高安全风险模块）
- [ ] 全局评测终审结论准确率 > 95%

---

## Task 3: Git Worktree 隔离

- [ ] Worktree 模型已添加到 `backend/app/models.py`
- [ ] 数据库迁移脚本已执行（worktrees 表已创建）
- [ ] `backend/app/api/worktree.py` 已创建（GET/POST/DELETE 端点）
- [ ] `backend/app/services/worktree_manager.py` 已创建
- [ ] `create_worktree(repo_path, module_name, instance_id)` 已实现
- [ ] `merge_worktree(worktree_id)` 已实现
- [ ] `cleanup_worktree(worktree_id)` 已实现
- [ ] `list_worktrees(repo_path)` 已实现
- [ ] 自动清理策略已实现（质量评审通过后触发）
- [ ] 提示词工程智能体 `inject_to_claude_cli()` 已集成 WorktreeManager
- [ ] AgentManager `create_agent()` 已支持 worktree 参数
- [ ] worktree 创建耗时 < 2 秒
- [ ] 多模块并行操作零冲突
- [ ] worktree 自动清理成功率 > 95%

---

## Task 4: Web Dashboard 工作流监控

- [ ] `backend/app/api/dashboard.py` 已创建
- [ ] `GET /api/dashboard/workflow/{id}` 端点已实现
- [ ] WebSocket 广播工作流阶段变更事件已实现
- [ ] `frontend/src/components/WorkflowDashboard.tsx` 已创建
- [ ] 6 阶段进度条已实现（需求澄清 → 架构设计 → 提示词工程 → 执行 → 质量评审 → 迭代闭环）
- [ ] 阶段状态图标已实现（pending/running/completed/failed）
- [ ] 阶段切换动画已实现
- [ ] `frontend/src/components/StageViewer.tsx` 已创建
- [ ] 阶段输入/输出文档展示已实现
- [ ] 智能体对话记录展示已实现
- [ ] 阶段操作按钮已实现（重试/跳过）
- [ ] WebSocket 实时更新已集成
- [ ] 已集成到 App.tsx 编程模式面板
- [ ] Dashboard 加载时间 < 1 秒
- [ ] 状态更新延迟 < 500ms
- [ ] 阶段切换动画流畅（60fps）

---

## Task 5: Git 自动 Commit + Push

- [ ] `backend/app/services/git_manager.py` 已增强
- [ ] `auto_commit(instance_id, changed_files)` 已实现
- [ ] `generate_commit_message(changes, module_context)` LLM 生成 commit message 已实现
- [ ] `auto_push(branch)` 已实现
- [ ] 配置项 `git.auto_commit`, `git.auto_push` 已添加
- [ ] 前端 `GitPanel.tsx` 已增强（自动 commit 历史、开关）
- [ ] 代码修改后 3 秒内自动 commit
- [ ] commit message 描述准确率 > 80%

---

## Task 6: Monaco Editor 升级 CodeViewer

- [ ] `@monaco-editor/react` 已安装
- [ ] `CodeViewer.tsx` 已重构为 Monaco Editor 封装
- [ ] 代码分割 + 懒加载已实现
- [ ] 语法高亮已实现（TypeScript/Python/C++/JavaScript/JSON/YAML/CMake）
- [ ] 智能补全已实现（TypeScript 内置）
- [ ] 错误诊断已实现（红色波浪线 + 悬停详情）
- [ ] 多 Tab 文件编辑已实现
- [ ] Monaco Editor 首次加载 < 2 秒
- [ ] 支持至少 6 种语言语法高亮
- [ ] TypeScript 智能补全可用

---

## Task 7: 跨 Session Memory（Hermes 内核管理）

- [ ] `hermes_integration/hermes_executor.py` 已增强
- [ ] `summarize_session(session_id)` 对话总结已实现
- [ ] `extract_preferences(session_id)` 用户偏好提取已实现
- [ ] `generate_skills(project_context)` 自动编写 Skills 已实现
- [ ] `backend/app/services/memory_store.py` 已增强（记忆持久化）
- [ ] `.hermes/memory/` 目录管理已实现
- [ ] 对话总结覆盖率 100%
- [ ] Skills 自动生成准确率 > 70%
- [ ] 记忆加载时间 < 500ms

---

## 全局检查点

- [ ] 所有 P0 任务（Task 1, 2, 3）已完成并通过验证
- [ ] 所有 P1 任务（Task 4, 5, 6）已完成并通过验证
- [ ] 工作流端到端可用（从需求澄清到迭代闭环全流程）
- [ ] 现有功能无回归（双模式、对话体验、文件浏览器、用量监控）
- [ ] 差异化优势保持（Web 优先、双模式、强对话体验、豆包风格）
- [ ] 数据库迁移脚本全部执行成功
- [ ] API 文档已更新（如有新增/修改端点）
- [ ] 代码修改日志已更新
