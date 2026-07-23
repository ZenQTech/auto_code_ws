# Tasks: Loop Engineering 完整工作流

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/loop-engineering-full-workflow/spec.md)

---

## Task 1: 增强 Hermes 智能调度逻辑

- [x] 1.1 在 `hermes_service.py` 中新增 `_create_chief_architect()` 方法：创建总架构师智能体实例
- [x] 1.2 在 `hermes_service.py` 中新增 `_create_evaluator()` 方法：复用 CriticalReviewer 创建评判师实例
- [x] 1.3 在 `hermes_service.py` 中新增 `dispatch_by_stage()` 方法：根据工作流阶段激活对应智能体
- [x] 1.4 实现智能体生命周期管理：创建、激活、销毁、持久化到 AgentManager
- [x] 1.5 在 `chat_with_hermes_streaming()` 中集成智能体调度逻辑

## Task 2: 增强总架构师交互引导能力

- [x] 2.1 在 `chief_architect.py` 中新增 `gather_requirements()` 方法：分析需求 → 识别缺口 → 生成引导问题
- [x] 2.2 实现 6 维度信息收集框架（功能目标/技术栈/性能指标/安全要求/部署环境/约束条件）
- [x] 2.3 实现信息充分性判定逻辑（6 维度中至少 4 个有明确答案）
- [x] 2.4 实现 `generate_task_framework()` 方法：输出结构化任务框架
- [x] 2.5 通过 SSE 推送引导问题到前端，接收用户回复并逐轮迭代

## Task 3: 实现协作验收标准制定

- [x] 3.1 在 `chief_architect.py` 中新增 `generate_draft_acceptance()` 方法：生成初步验收标准
- [x] 3.2 在 `critical_reviewer.py` 中新增 `review_acceptance_criteria()` 方法：审查验收标准完备性
- [x] 3.3 实现协作讨论循环：总架构师起草 → 评判师审查 → 总架构师修订 → 评判师再审查
- [x] 3.4 实现 100% 可验证性校验：逐条检查验证方法、量化条件、可执行性
- [x] 3.5 验收标准结构包含 8 个章节（模块级/集成/系统级/代码质量/性能/安全/兼容性/环境要求）

## Task 4: 增强提示词工程

- [x] 4.1 在 `prompt_engineer.py` 中增强 `optimize_prompt()` 方法：添加上下文感知（模块依赖、全局接口规范、架构约束）
- [x] 4.2 实现质量闭环校验：歧义检测 + 约束覆盖率检测 + 自动重优化（最多 3 轮）
- [x] 4.3 增强 `inject_to_claude_cli()` 方法：确保注入的提示词包含完整上下文
- [x] 4.4 实现并行执行策略：无依赖模块并行、有依赖模块串行、最大并行数控制

## Task 5: 实现全链路智能评审

- [x] 5.1 在 `critical_reviewer.py` 中新增 `review_single_module()` 方法：语义级单模块代码审查
- [x] 5.2 新增 `review_cross_module()` 方法：跨模块接口一致性、数据类型一致、调用时序检查
- [x] 5.3 新增 `verify_traceability()` 方法：需求-代码可追溯性验证，生成覆盖率矩阵
- [x] 5.4 新增 `generate_review_report()` 方法：输出结构化评审报告（评分 + 缺陷清单 + 判定）
- [x] 5.5 评审报告通过 SSE 推送到前端展示

## Task 6: 实现智能迭代闭环

- [x] 6.1 在 `workflow_engine.py` 中增强 `start_iteration()` 方法：传递精确缺陷定位和修复建议
- [x] 6.2 实现迭代跟踪：记录每次迭代的缺陷修复情况，确保无回归
- [x] 6.3 实现智能升级：迭代 2 次仍不通过自动升级为人工审核
- [x] 6.4 实现迭代终止条件：全部通过 / 达到上限 / 人工强制终止

## Task 7: 实现全链路自动化测试流水线

- [x] 7.1 在 `workflow_engine.py` 中新增 `run_full_pipeline_test()` 方法：编排全链路 6 步骤
- [x] 7.2 实现流水线步骤状态追踪：通过 SSE 实时推送每个步骤状态
- [x] 7.3 实现全链路成功判定：所有步骤 completed + 所有模块评审通过 + Git 提交成功
- [x] 7.4 新增 API 端点 `POST /api/workflow/{id}/pipeline-test` 触发全链路测试

## Task 8: 实现 Goal 导向任务循环

- [x] 8.1 在 `workflow_engine.py` 中新增 `create_goal()` 方法：创建 Goal 对象并分解子目标
- [x] 8.2 实现子目标依赖解析和拓扑排序
- [x] 8.3 实现 Goal 循环执行：选择子目标 → 分配 CLI → 生成代码 → 评审 → 标记完成
- [x] 8.4 实现 Goal 完成判定：所有子目标完成 + 全链路验证通过
- [x] 8.5 新增 `goal_id` 字段到 Workflow 模型

## Task 9: 前端适配

- [x] 9.1 新增 `ReviewReport.tsx` 组件：展示结构化评审报告（评分、缺陷清单、判定）
- [x] 9.2 新增 `PipelineProgress.tsx` 组件：展示全链路测试流水线进度
- [x] 9.3 新增 `GoalProgress.tsx` 组件：展示 Goal 子目标执行进度
- [x] 9.4 在 `App.tsx` 中集成新组件，监听对应 SSE 事件

## Task 10: 全链路集成测试

- [x] 10.1 全链路导入验证：13 项检查点全部通过
- [x] 10.2 新 dataclass 类型验证：10 个全部可用
- [x] 10.3 新方法签名验证：23 个全部存在
- [x] 10.4 API 新端点验证：pipeline-test + pipeline-status 正确注册
- [x] 10.5 前端 TypeScript 编译：零错误

---

# Task Dependencies

```
Task 1 (Hermes 调度) → Task 2 (总架构师引导) → Task 3 (协作验收标准)
Task 2 (总架构师引导) → Task 4 (提示词工程增强)
Task 3 (协作验收标准) + Task 5 (全链路评审) → Task 6 (智能迭代闭环)
Task 4 (提示词工程) + Task 5 (全链路评审) → Task 7 (全链路测试流水线)
Task 6 (迭代闭环) + Task 7 (测试流水线) → Task 8 (Goal 导向循环)
Task 5-8 → Task 9 (前端适配)
Task 1-9 → Task 10 (集成测试)
```

并行执行建议：
- Task 1 和 Task 5 可并行（无依赖）
- Task 9 可在 Task 5-8 完成后独立并行