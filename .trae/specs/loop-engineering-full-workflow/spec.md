# Loop Engineering 完整工作流 Spec

> **来源**: 用户需求 - 搭建完整的 Loop Engineering 工作流
> **优先级**: P0（核心工作流，最优先完成）
> **依赖**: loop-engineering-workflow-engine（已完成）、architecture-critique-iteration（部分完成）

## Why

当前系统已具备基础工作流引擎和 5 个智能体角色，但缺乏完整的端到端 Loop Engineering 闭环。现有工作流是线性的阶段推进，缺少真正的智能迭代评审、跨模块一致性验证、以及全链路自动化测试。用户需要的是一个以目标为导向的、能够自我纠正的智能工作流，而非简单的错误自动重试 + 完成通知。

## What Changes

- **增强 Hermes 调度逻辑**：Hermes 同时作为总调度师和评判师，在用户输入时创建总架构师 + 评判师两个智能体
- **增强总架构师交互**：总架构师主动引导用户讨论、收集信息、编写任务框架和目标
- **新增协作验收标准制定**：总架构师 + 评判师讨论生成详细验收标准，100% 确保可验证 Claude Code CLI 团队代码
- **增强提示词工程**：上下文感知注入 + 质量闭环校验
- **新增全链路智能评审**：语义级代码审查、跨模块接口一致性、需求-代码可追溯性、自动化测试
- **新增 goal 导向任务循环**：使用 Trae /goal 功能创建目标导向循环，直到所有目标实现
- **新增全链路自动化测试流水线**：提示词注入 → 需求细化 → 提示词注入 → 任务完成评判 → Git 提交

## Impact

- Affected specs: loop-engineering-workflow-engine、architecture-critique-iteration
- Affected code:
  - `backend/app/services/hermes_service.py` — 增强调度逻辑
  - `backend/app/services/agent_roles/chief_architect.py` — 增强交互引导能力
  - `backend/app/services/agent_roles/critical_reviewer.py` — 增强全链路评审能力
  - `backend/app/services/agent_roles/prompt_engineer.py` — 增强上下文感知 + 质量闭环
  - `backend/app/services/workflow_engine.py` — 新增 goal 导向循环
  - `backend/app/api/workflow.py` — 新增全链路端点
  - `frontend/src/components/` — 新增评审报告展示组件

---

## ADDED Requirements

### Requirement: Hermes 智能调度增强

Hermes SHALL 在用户输入开发需求时，自动创建「总架构师」和「评判师」两个智能体实例，并管理它们的完整生命周期。

#### Scenario: 智能体创建
- **WHEN** 用户在 coding 模式下提交开发需求
- **THEN** Hermes 自动创建 ChiefArchitect 和 CriticalReviewer 两个智能体实例
- **AND** 两个智能体分别加载各自的 system prompt
- **AND** 智能体实例注册到 AgentManager 并持久化到数据库

#### Scenario: 评判师角色复用
- **WHEN** Hermes 作为评判师时
- **THEN** Hermes 复用 CriticalReviewer 的 5 维度评审能力，并额外增强：
  - 全链路语义级代码审查
  - 跨模块接口一致性检查
  - 需求-代码可追溯性验证
  - 自动化测试生成与执行判定

#### Scenario: 调度决策
- **WHEN** 工作流进入不同阶段
- **THEN** Hermes 根据阶段状态决定激活哪个智能体：
  - clarifying → 激活 RequirementClarifier
  - designing → 激活 ChiefArchitect + CriticalReviewer + QualityManager
  - prompting → 激活 PromptEngineer（按模块创建多个实例）
  - executing → 激活 Claude Code CLI 团队
  - reviewing → 激活 CriticalReviewer + QualityManager（评判模式）

---

### Requirement: 总架构师交互引导

总架构师 SHALL 主动与用户进行多轮讨论，引导用户说出尽可能多的信息，在获取足够信息后编写任务框架和任务目标。

#### Scenario: 引导式信息收集
- **WHEN** 总架构师被激活
- **THEN** 总架构师分析用户原始需求，识别信息缺口
- **AND** 生成结构化引导问题，覆盖以下维度：
  - 功能目标：期望实现的具体功能
  - 技术栈：编程语言、框架、工具链
  - 性能指标：响应时间、吞吐量、并发数
  - 安全要求：认证授权、数据加密、审计日志
  - 部署环境：操作系统、硬件配置、网络拓扑
  - 约束条件：时间限制、资源限制、兼容性要求
- **AND** 通过 SSE 逐轮推送给前端

#### Scenario: 信息充分性判定
- **WHEN** 用户回答引导问题后
- **THEN** 总架构师评估信息充分性：
  - 若信息不足 → 继续追问，最多 5 轮
  - 若信息充分 → 输出「信息收集完成」信号
- **AND** 评估标准：6 个维度中至少 4 个维度有明确答案

#### Scenario: 任务框架生成
- **WHEN** 信息收集完成
- **THEN** 总架构师生成任务框架，包含：
  - 项目概述：一句话描述项目目标
  - 模块划分：按功能拆分模块，标注优先级
  - 依赖关系：模块间依赖 DAG 图
  - 技术选型：推荐技术栈及理由
  - 风险识别：潜在风险及缓解措施

---

### Requirement: 协作验收标准制定

总架构师 SHALL 与评判师进行协作讨论，共同制定详细的任务验收标准，100% 确保使用该验收标准可以完美确认 Claude Code CLI 团队提交的代码能够实现功能。

#### Scenario: 协作讨论流程
- **WHEN** 任务框架生成后
- **THEN** 总架构师生成初步验收标准
- **AND** 评判师从以下维度审查验收标准的完备性：
  - 功能覆盖率：是否覆盖所有功能点
  - 可执行性：每个验收项是否可实际执行验证
  - 可衡量性：是否有明确的量化指标
  - 边界覆盖：是否包含异常场景和边界条件
- **AND** 评判师输出审查意见，标注缺失项和模糊项
- **AND** 总架构师根据审查意见修订验收标准
- **AND** 重复此过程直到评判师确认「100% 可验证」

#### Scenario: 验收标准结构
- **WHEN** 验收标准最终生成
- **THEN** 验收标准 SHALL 包含以下章节：
  - 模块级验收：每个模块的功能验证方法与通过条件
  - 集成验收：模块间接口对接验证
  - 系统级验收：端到端功能验证
  - 代码质量验收：lint 规则、测试覆盖率、注释完整性
  - 性能验收：响应时间、吞吐量、资源占用
  - 安全验收：安全红线、认证授权、数据保护
  - 兼容性验收：多环境运行验证
  - 验收环境要求：测试环境、测试数据、测试工具

#### Scenario: 100% 可验证性校验
- **WHEN** 评判师确认验收标准
- **THEN** 评判师执行以下校验：
  - 逐条检查验收项是否有明确的验证方法
  - 逐条检查验收项是否有量化的通过条件
  - 抽查验收项是否可实际执行
  - 若任一项不满足，标记为「不可验证」并打回
- **AND** 仅当所有验收项通过校验后，标记 `acceptance_verified = True`

---

### Requirement: 模块任务分发

总架构师 SHALL 按照模块划分分发任务，为每个模块生成一个 PromptEngineer 智能体负责优化提示词并注入 Claude Code CLI。

#### Scenario: 任务分发
- **WHEN** 验收标准制定完成
- **THEN** 总架构师解析 task.md，提取所有模块任务
- **AND** 按依赖关系排序模块（依赖优先执行）
- **AND** 为每个模块创建独立的 PromptEngineer 实例
- **AND** 将模块任务描述、架构上下文、验收标准传递给 PromptEngineer

#### Scenario: 提示词优化与注入
- **WHEN** PromptEngineer 收到模块任务
- **THEN** PromptEngineer 执行以下步骤：
  1. 上下文感知优化：结合模块依赖、全局接口规范、架构约束生成优化后的提示词
  2. 质量闭环校验：对优化后的提示词做歧义检测（歧义评分 < 0.3）和约束覆盖率检测（覆盖率 > 0.8）
  3. 若校验不通过，自动重优化（最多 3 轮）
  4. 创建 Claude Code CLI 实例并注入优化后的提示词
  5. 创建独立 Git worktree 隔离工作空间

#### Scenario: 并行执行策略
- **WHEN** 多个模块之间无依赖关系
- **THEN** 对应的 Claude Code CLI 实例 SHALL 并行执行
- **AND** 有依赖关系的模块按拓扑顺序串行执行
- **AND** 最大并行实例数由配置控制（默认 5）

---

### Requirement: 全链路智能评审

评判师 SHALL 对所有 Claude Code CLI 团队提交的代码执行全链路智能评审，包含语义级审查、跨模块一致性检查、需求-代码可追溯性验证。

#### Scenario: 单模块代码评审
- **WHEN** 单个 Claude Code CLI 实例完成代码提交
- **THEN** 评判师执行以下审查：
  1. 语义正确性：代码逻辑是否满足模块需求
  2. 边界条件覆盖：异常输入、极端值、空值处理
  3. 安全漏洞扫描：注入风险、权限校验、敏感信息泄露
  4. 规范合规性：命名规范、注释完整性、代码风格
  5. 验收标准匹配：逐条对照验收标准检查是否通过

#### Scenario: 跨模块集成评审
- **WHEN** 所有模块代码提交完成
- **THEN** 评判师执行跨模块集成评审：
  1. 接口一致性：模块间接口定义是否匹配
  2. 数据类型一致：传递的数据类型是否兼容
  3. 调用时序：调用顺序是否满足依赖约束
  4. 循环依赖检测：是否存在隐式循环依赖
  5. 全局状态一致性：共享状态访问是否安全

#### Scenario: 需求-代码可追溯性
- **WHEN** 评审执行时
- **THEN** 评判师自动验证：
  - 每个需求功能点是否都有对应的代码实现
  - 每段核心代码是否可追溯到需求文档
  - 生成需求覆盖率矩阵（需求项 → 代码文件 → 行号）

#### Scenario: 评审结论
- **WHEN** 评审完成
- **THEN** 评判师输出结构化评审报告：
  - 综合评分（0-100）
  - 各维度评分（正确性/安全性/规范性/完整性）
  - 缺陷清单（ID、严重程度、位置、描述、修复建议）
  - 通过/不通过判定
- **AND** 评审报告通过 SSE 推送到前端展示

---

### Requirement: 智能迭代闭环

当评审不通过时，系统 SHALL 进入智能迭代闭环，而非简单的自动重试。

#### Scenario: 评审不通过处理
- **WHEN** 评判师评审不通过
- **THEN** 系统执行以下步骤：
  1. 将评审报告（含缺陷清单和修复建议）发送给对应的 Claude Code CLI 实例
  2. Claude Code CLI 实例根据缺陷清单修复代码
  3. 修复完成后重新提交评审
  4. 重复此过程直到评审通过或达到最大迭代次数（3 轮）
- **AND** 迭代次数超过上限时，标记为 FAILED 并通知人工介入

#### Scenario: 智能迭代 vs 简单重试
- **WHEN** 进入迭代
- **THEN** 系统 SHALL 做到以下区别（非简单 Reaction 系统）：
  - 传递精确的缺陷定位信息，而非仅告知"失败"
  - 提供具体的修复建议，而非仅告知"重试"
  - 跟踪每次迭代的缺陷修复情况，确保无回归
  - 迭代 2 次仍不通过时，自动升级为人工审核

#### Scenario: 迭代终止条件
- **WHEN** 以下任一条件满足
- **THEN** 迭代终止：
  - 所有模块评审通过
  - 达到最大迭代次数（3 轮）
  - 人工介入强制终止

---

### Requirement: 全链路自动化测试流水线

系统 SHALL 实现完整的全链路自动化测试：提示词注入 → 需求细化 → 提示词注入 → 任务完成评判 → Git 提交。

#### Scenario: 测试流水线步骤
- **WHEN** 启动全链路测试
- **THEN** 系统按顺序执行：
  1. **提示词注入**：将优化后的提示词注入 Claude Code CLI 实例
  2. **需求细化**：Claude Code CLI 根据提示词理解需求并细化实现方案
  3. **代码生成**：Claude Code CLI 生成代码
  4. **任务完成评判**：评判师评审代码质量
  5. **Git 提交**：评审通过后自动提交到 Git 仓库
  6. **集成测试**：所有模块完成后执行集成测试

#### Scenario: 流水线状态追踪
- **WHEN** 测试流水线执行中
- **THEN** 系统 SHALL 通过 SSE 实时推送每个步骤的状态：
  - `step: prompt_injection` → `status: running/completed/failed`
  - `step: requirement_refinement` → `status: running/completed/failed`
  - `step: code_generation` → `status: running/completed/failed`
  - `step: review` → `status: running/completed/failed`
  - `step: git_commit` → `status: running/completed/failed`

#### Scenario: 全链路成功标准
- **WHEN** 全链路测试流水线完成
- **THEN** 判定为成功的条件：
  - 所有步骤状态为 completed
  - 所有模块评审通过
  - 所有 Git 提交成功
  - 集成测试通过
- **AND** 任一条件不满足，判定为任务未完成

---

### Requirement: Goal 导向任务循环

系统 SHALL 支持使用 Trae /goal 功能创建目标导向的任务循环，持续执行直到所有目标实现。

#### Scenario: Goal 创建
- **WHEN** 用户通过 /goal 启动 Loop Engineering 工作流
- **THEN** 系统创建 Goal 对象，包含：
  - objective: 用户原始需求描述
  - token_budget: 可选 token 预算
  - sub_goals: 自动分解的子目标列表
  - status: active

#### Scenario: Goal 子目标分解
- **WHEN** Goal 创建后
- **THEN** 总架构师将用户目标分解为可验证的子目标：
  - 每个子目标对应一个功能模块
  - 每个子目标有明确的验收标准
  - 子目标之间有依赖关系标注
- **AND** 子目标列表持久化到 workflow.goals JSON 字段

#### Scenario: Goal 循环执行
- **WHEN** Goal 处于 active 状态
- **THEN** 系统循环执行：
  1. 选择下一个可执行的子目标（依赖已满足）
  2. 为该子目标创建 Claude Code CLI 实例
  3. 执行代码生成
  4. 评判师评审
  5. 若通过 → 标记子目标完成，继续下一个
  6. 若不通过 → 进入迭代闭环
  7. 所有子目标完成 → Goal 标记为 completed
  8. 任一子目标无法完成 → Goal 标记为 blocked

#### Scenario: Goal 完成判定
- **WHEN** 所有子目标完成
- **THEN** 系统执行最终全链路验证：
  - 全链路自动化测试流水线运行
  - 所有步骤通过
  - 集成测试通过
- **AND** 仅当全链路验证通过后，Goal 标记为 completed

---

## MODIFIED Requirements

### Requirement: 工作流阶段扩展

原有 5 阶段工作流 SHALL 扩展为包含 goal 导向循环和全链路测试的阶段。

#### Scenario: 扩展后的阶段
- **WHEN** 工作流启动
- **THEN** 阶段扩展为：
  ```
  pending → clarifying → designing → prompting → executing → reviewing
  reviewing → completed（全链路测试通过）
  reviewing → iterating → executing（评审不通过，智能迭代）
  iterating → failed（超过最大迭代次数）
  ```
- **AND** 新增 `goal_id` 字段关联 Trae Goal

---

## 成功标准

### 核心验收标准

1. **全链路自动化测试通过**
   - 提示词注入 → 需求细化 → 代码生成 → 任务评判 → Git 提交 全流程自动执行
   - 所有模块的 Claude Code CLI 实例成功生成代码并通过评审
   - 集成测试通过

2. **智能迭代闭环验证**
   - 评审不通过时自动将缺陷信息传递给 CLI 实例
   - CLI 实例能根据缺陷信息修复代码
   - 版本对比确认无回归

3. **Goal 导向任务循环验证**
   - Goal 创建后自动分解子目标
   - 子目标按依赖顺序执行
   - 所有子目标完成后全链路验证通过

4. **验收标准完备性**
   - 评判师确认验收标准 100% 可验证
   - 每个验收项有明确的验证方法和量化通过条件

5. **提示词质量闭环**
   - 歧义评分 < 0.3
   - 约束覆盖率 > 0.8
   - 不达标自动重优化

### 任务未完成判定标准

以下任一情况判定为任务未完成：
- 全链路自动化测试流水线任一步骤失败
- 任一模块经过 3 轮迭代仍评审不通过
- 集成测试未通过
- Goal 标记为 blocked 而非 completed
- 验收标准未通过评判师的 100% 可验证性校验