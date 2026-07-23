# Tasks

- [ ] Task 1: 创建批判反思智能体（critique_architect）
  - [ ] 1.1 创建 `backend/app/services/agent_roles/critique_architect.py`
  - [ ] 1.2 定义系统提示词：覆盖架构批判、需求迭代、缺陷清单输出
  - [ ] 1.3 实现 `critique_architecture(requirement_doc)` 方法：调用 LLM 执行全维度架构批判分析
  - [ ] 1.4 实现 `iterate_requirement(requirement_doc, critique_result)` 方法：生成需求文档 V2.0

- [ ] Task 2: 创建质量保障与迭代管理智能体（quality_manager）
  - [ ] 2.1 创建 `backend/app/services/agent_roles/quality_manager.py`
  - [ ] 2.2 定义系统提示词：覆盖验收标准制定、代码质量检查、迭代管理
  - [ ] 2.3 实现 `generate_acceptance_criteria(requirement_doc, architecture_doc)` 方法：生成验收标准

- [ ] Task 3: 实现 designing 阶段工作流逻辑
  - [ ] 3.1 在 `workflow_engine.py` 的 `advance_stage` 中添加 designing 阶段处理
  - [ ] 3.2 实现 `_execute_designing_phase` 方法：编排 7 个子步骤
  - [ ] 3.3 通过 SSE 事件向前端推送各步骤进度（`designing_progress` 事件）
  - [ ] 3.4 需求文档 V2.0 生成后发送 `architecture_result` SSE 事件

- [ ] Task 4: 创建 ArchitectureModal 前端弹窗组件
  - [ ] 4.1 创建 `frontend/src/components/ArchitectureModal.tsx`
  - [ ] 4.2 标题固定为"架构设计与批判迭代阶段"
  - [ ] 4.3 包含文档预览区（Markdown 渲染）
  - [ ] 4.4 包含"确认通过"和"返回修改"两个按钮

- [ ] Task 5: 集成 ArchitectureModal 到 App.tsx
  - [ ] 5.1 监听 `architecture_result` SSE 事件
  - [ ] 5.2 事件到达时打开 ArchitectureModal
  - [ ] 5.3 实现"确认通过"回调：调用 `/api/workflow/{id}/designing/confirm` → 进入验收标准制定
  - [ ] 5.4 实现"返回修改"回调：调用 `/api/workflow/{id}/designing/revise` → 重新批判迭代

- [ ] Task 6: 实现验收标准制定流程
  - [ ] 6.1 总架构师 + 质量保障智能体协作生成验收标准
  - [ ] 6.2 通过 SSE 向前端推送验收标准文档

- [ ] Task 7: 实现文档生成与 Git 初始化
  - [ ] 7.1 生成 spec.md（系统架构设计、模块划分、接口规范、安全架构、技术选型）
  - [ ] 7.2 生成 tasks.md（任务分解、责任分配、依赖关系）
  - [ ] 7.3 生成 checklist.md（开发/测试/部署检查项）
  - [ ] 7.4 自动创建 Git 仓库，初始化项目结构，提交文档至主分支

# Task Dependencies
- Task 3 依赖 Task 1、Task 2（智能体就绪后才能编排工作流）
- Task 5 依赖 Task 4（弹窗组件就绪后才能集成）
- Task 6 依赖 Task 5（用户确认后触发验收标准制定）
- Task 7 依赖 Task 6（验收标准完成后生成文档）
