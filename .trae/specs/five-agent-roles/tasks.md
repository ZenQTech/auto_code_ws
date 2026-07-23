# Tasks: 5 个智能体角色实现

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/five-agent-roles/spec.md)

---

## Task 1: 需求澄清智能体

- [x] 1.1 创建 `backend/app/services/agent_roles/__init__.py`（模块导出）
- [x] 1.2 创建 `backend/app/services/agent_roles/requirement_clarifier.py`
- [x] 1.3 实现 `ClarificationQuestion` 和 `ChangeAnalysis` 数据类
- [x] 1.4 编写 `REQUIREMENT_CLARIFIER_SYSTEM_PROMPT` 常量（含 6 维度引导、对话规则、输出规范）
- [x] 1.5 实现 `RequirementClarifier.__init__(hermes_service)`
- [x] 1.6 实现 `clarify(user_input, context) -> str`
- [x] 1.7 实现 `generate_requirement_doc(conversation_history) -> str`
- [x] 1.8 实现 `handle_change(change_request, current_doc) -> ChangeAnalysis`

## Task 2: 总架构师智能体

- [x] 2.1 创建 `backend/app/services/agent_roles/chief_architect.py`
- [x] 2.2 实现 `ArchitectureOutput`、`AdaptationResult`、`ScopeAssessment`、`RedlineCheck` 数据类
- [x] 2.3 编写 `CHIEF_ARCHITECT_SYSTEM_PROMPT` 常量（含权责红线、强制升级条件、四文档输出规范）
- [x] 2.4 实现 `ChiefArchitect.__init__(hermes_service)`
- [x] 2.5 实现 `design_architecture(requirement_doc) -> ArchitectureOutput`
- [x] 2.6 实现 `adapt_local(change_request, current_arch) -> AdaptationResult`
- [x] 2.7 实现 `evaluate_scope(change, current_arch) -> ScopeAssessment`
- [x] 2.8 实现 `check_redline(adaptation, current_arch) -> RedlineCheck`
- [x] 2.9 实现 `generate_spec(architecture) -> str`
- [x] 2.10 实现 `generate_checklist(architecture) -> str`
- [x] 2.11 实现 `generate_tasks(architecture) -> str`
- [x] 2.12 实现 `generate_acceptance_criteria(architecture, critic_feedback) -> str`
- [x] 2.13 实现 `_parse_architecture_output(output) -> ArchitectureOutput`

## Task 3: 提示词工程智能体

- [x] 3.1 创建 `backend/app/services/agent_roles/prompt_engineer.py`
- [x] 3.2 实现 `ModuleTask`、`AgentInstance`、`ValidationResult` 数据类
- [x] 3.3 编写 `PROMPT_ENGINEER_SYSTEM_PROMPT` 常量（含优化规则、输出格式模板）
- [x] 3.4 实现 `PromptEngineer.__init__(hermes_service, agent_manager, worktree_manager)`
- [x] 3.5 实现 `parse_tasks(task_md) -> List[ModuleTask]`
- [x] 3.6 实现 `optimize_prompt(module_task, architecture_context) -> str`
- [x] 3.7 实现 `inject_to_claude_cli(optimized_prompt, module_name, repo_path) -> Optional[AgentInstance]`
- [x] 3.8 实现 `validate_prompt(optimized_prompt) -> ValidationResult`

## Task 4: 批判反思智能体

- [x] 4.1 创建 `backend/app/services/agent_roles/critical_reviewer.py`
- [x] 4.2 实现 `DefectItem`、`ReviewReport`、`ComplianceReport`、`RiskReviewReport`、`DiffReport` 数据类
- [x] 4.3 编写 `CRITICAL_REVIEWER_SYSTEM_PROMPT` 常量（含 5 维度评审标准、缺陷等级定义）
- [x] 4.4 实现 `CriticalReviewer.__init__(hermes_service)`
- [x] 4.5 实现 `review_architecture(spec, checklist, tasks, acceptance) -> ReviewReport`
- [x] 4.6 实现 `check_compliance(adaptation_result) -> ComplianceReport`
- [x] 4.7 实现 `review_risk_labels(tasks) -> RiskReviewReport`
- [x] 4.8 实现 `compare_versions(old_docs, new_docs) -> DiffReport`
- [x] 4.9 实现 `_parse_review_report(output) -> ReviewReport`

## Task 5: 质量保障与迭代管理智能体

- [x] 5.1 创建 `backend/app/services/agent_roles/quality_manager.py`
- [x] 5.2 实现 `SafetyReport`、`TestScripts`、`IntegrationReport`、`EvaluationReport`、`DeliveryPackage`、`BoundaryCheck`、`EscalationDecision` 数据类
- [x] 5.3 编写 `QUALITY_MANAGER_SYSTEM_PROMPT` 常量（含 5 阶段职责、刚性边界、强制升级条件）
- [x] 5.4 实现 `QualityManager.__init__(hermes_service)`
- [x] 5.5 实现 `execute_stage_1(module_code) -> SafetyReport`
- [x] 5.6 实现 `execute_stage_2(module_spec) -> TestScripts`
- [x] 5.7 实现 `execute_stage_3(all_modules) -> IntegrationReport`
- [x] 5.8 实现 `execute_stage_4(integrated_code) -> EvaluationReport`
- [x] 5.9 实现 `execute_stage_5(project_context) -> DeliveryPackage`
- [x] 5.10 实现 `check_stage_boundary(current_stage, action) -> BoundaryCheck`
- [x] 5.11 实现 `evaluate_escalation(findings) -> EscalationDecision`
- [x] 5.12 实现解析辅助方法（`_parse_safety_report`、`_parse_test_scripts`、`_parse_integration_report`、`_parse_evaluation_report`、`_parse_delivery_package`）

## Task 6: 验证

- [x] 6.1 Python 导入测试：所有 5 个角色模块正确导入
- [x] 6.2 每个角色的 system prompt 包含核心定位、职责、红线、输出规范
- [x] 6.3 每个角色的核心方法签名正确
- [x] 6.4 所有数据类字段完整

---

## 任务依赖关系

```
Task 1 (需求澄清) ─┐
Task 2 (总架构师)  ├── 可并行开发
Task 3 (提示词工程) │
Task 4 (批判反思)  ├── 可并行开发
Task 5 (质量保障) ─┘
Task 6 (验证) 在所有任务完成后执行
```
