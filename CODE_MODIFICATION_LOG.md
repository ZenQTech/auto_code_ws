# 代码修改日志

## 2026-07-23 | v5.5.0 | 修复 Loop Engineering 5 大 Bug

### 修改文件
- `cli_integration/curl_executor.py`
- `backend/app/services/agent_roles/prompt_engineer.py`
- `backend/app/services/agent_roles/chief_architect.py`
- `backend/app/services/architecture_workflow_service.py`
- `backend/app/services/workflow_engine.py`
- `backend/app/services/git_manager.py`

### 完成的任务

#### Bug 1 修复：LLM 输出被 max_tokens=4096 截断
- `CurlLLMExecutor.DEFAULT_MAX_TOKENS` 从 4096 提升至 16384
- `_iterate_requirements` 调用 timeout 从 300 提升至 600
- `_generate_acceptance_criteria` 中 QA 调用 timeout 从 180 提升至 300
- `ChiefArchitect.design_architecture` timeout 从 300 提升至 600
- `ChiefArchitect.generate_acceptance_criteria` timeout 从 300 提升至 600
- `ChiefArchitect._build_task_framework` timeout 从 300 提升至 600
- `PromptEngineer.optimize_prompt` timeout 从 180 提升至 300
- 解决架构设计四文档单文档可能达 8K-12K tokens 时的截断问题

#### Bug 2 修复：模板覆盖真实 LLM 输出
- 删除 `finalize_designing_phase` 中基于 `len(doc) < 200/100` 的覆盖逻辑
- 新增 `_llm_attempted` 标志跟踪 LLM 是否实际被调用
- 仅在以下情况使用模板兜底：
  1. LLM 不可用（ChiefArchitect 为 None）
  2. LLM 调用异常（try/except 捕获）
  3. LLM 调用成功但返回为空字符串
- 保留并改进了 LLM 失败时的兜底机制

#### Bug 3 修复：confirm_stage("designing") 的 stale read
- 将 `await db.commit()` 和 `await db.refresh(workflow)` 移到 `workflow.human_confirmed_architecture = True` 之后
- 必须在 `advance_stage` 之前完成 commit，避免 `validate_stage_boundary` 读到 stale 数据
- 重构异常处理：拆分 `advance_stage` 和 `_run_prompting_phase` 调用，
  即使 advance 失败也会调度 prompting 阶段后台任务

#### Bug 4 修复：缺失的 GitManager.init_and_push_docs 方法
- 在 `GitManager` 中新增 `init_and_push_docs` 异步方法
- 签名匹配 `ArchitectureWorkflowService` 实际调用方式：
  `init_and_push_docs(project_name, files, commit_message)`
- 实现步骤：复用或初始化仓库 → 写入文件 → 检查并设置 git user.name/email
  → git add → git status 检查变更 → git commit → 返回 commit_sha
- 增加 git 身份兜底配置（user.name=auto-code-bot, user.email=auto-code-bot@local）
  解决干净环境下 commit 失败的问题

#### Bug 5 修复：designing 阶段未标 COMPLETED
- 在 `confirm_stage("designing")` 中显式调用 `_complete_current_stage(db, workflow_id, "designing")`
- 防止 `asyncio.create_task` 后台任务与 `advance_stage` 的 `_complete_current_stage` 竞态
- 异常时仅 warning，不阻塞主流程

### 验证结果
- [x] `from backend.app.services.workflow_engine import WorkflowEngine` - OK
- [x] `from backend.app.services.architecture_workflow_service import ArchitectureWorkflowService` - OK
- [x] `from backend.app.services.git_manager import GitManager` - OK
- [x] `GitManager.init_and_push_docs` 烟雾测试 - PASSED
  - commit_sha 正确返回
  - 文件正确写入
  - git log 显示提交
  - 幂等性测试通过（无变更时正确返回 success）
- [x] 所有修改文件语法检查通过
- [x] 5 大 Bug 全部修复，无新引入的 template fallback

### 状态
所有任务已完成，无需进一步跟进。
