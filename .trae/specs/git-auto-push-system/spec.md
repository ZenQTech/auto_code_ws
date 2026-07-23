# Git 自动推送系统 Spec

> **来源**: 用户需求
> **优先级**: P0（核心工作流，依赖 git-auto-commit-push、git-worktree-isolation）
> **依赖**: git-auto-commit-push（auto_push、generate_commit_message）、git-worktree-isolation（WorktreeManager）

## Why

当前 git-auto-commit-push 仅支持本地 Git 操作，缺少远程仓库管理和自动推送能力。用户需要：每个编程任务自动在 GitHub 创建独立仓库，Claude Code CLI 实例通过 hook 通知调度平台代码修改完成，由调度平台统一向模块分支提交代码，全部模块完成后由测试审查智能体验证，验证通过后向 main 分支推送完整代码。实现"CLI 写代码、平台管提交、智能体验收"的全自动 Git 工作流。

## What Changes

- **新增 GitHubRepoManager 服务**：GitHub API 封装（创建仓库、管理分支）
- **新增 CommitHook 机制**：Claude Code CLI 通过 hook 通知调度平台代码修改完成
- **增强 GitManager**：集成 GitHubRepoManager，由调度平台统一执行 commit + push
- **新增测试审查智能体**：所有模块完成后自动生成测试审查智能体，验证代码完整性
- **集成到工作流引擎**：任务启动时创建仓库，模块完成时提交分支，全部验证通过后推送 main
- **Token 安全存储**：通过环境变量 `GITHUB_TOKEN` 注入，永不写入代码或配置文件

## Impact

- Affected specs: git-auto-commit-push（增强）、git-worktree-isolation（集成）、loop-engineering-workflow-engine（集成）、five-agent-roles（新增测试审查智能体）
- Affected code:
  - `backend/app/services/github_repo_manager.py` — 新建
  - `backend/app/services/git_manager.py` — 增强（调度平台统一提交）
  - `backend/app/services/commit_hook_handler.py` — 新建（CLI hook 处理）
  - `backend/app/services/agent_roles/test_reviewer.py` — 新建（测试审查智能体）
  - `backend/app/services/workflow_engine.py` — 集成
  - `backend/app/models.py` — Workflow 模型扩展
  - `config/auto_code_config.yaml` — 新增 github 配置节

---

## ADDED Requirements

### Requirement: GitHub 仓库管理器

系统 SHALL 在 `backend/app/services/github_repo_manager.py` 中实现 GitHubRepoManager 类，封装 GitHub REST API v3 操作。

#### Scenario: 初始化认证
- **WHEN** GitHubRepoManager 初始化
- **THEN** SHALL 从环境变量 `GITHUB_TOKEN` 读取 Personal Access Token
- **AND** Token 不存在时记录 WARNING 日志，所有 GitHub 操作返回失败（不阻塞主流程）
- **AND** Token 永不写入配置文件或日志

#### Scenario: 创建仓库
- **WHEN** 编程任务启动
- **THEN** `create_repository(repo_name, description, private)` 方法 SHALL：
  1. 调用 `POST https://api.github.com/user/repos` 创建仓库
  2. 仓库名格式：`{repo_name}`（即项目名称）
  3. 返回 `{ success, repo_url, clone_url, html_url, message }`
- **AND** 仓库已存在时复用已有仓库（不报错）
- **AND** 创建失败时返回 `{ success: false, message: <error> }`

#### Scenario: 获取仓库信息
- **WHEN** 需要获取已有仓库信息
- **THEN** `get_repository(repo_name) -> Optional[Dict]` 方法 SHALL 调用 GitHub API 返回仓库信息

#### Scenario: 获取仓库列表
- **WHEN** 需要查看所有仓库
- **THEN** `list_repositories() -> List[Dict]` 方法 SHALL 返回仓库列表

#### Scenario: 删除仓库
- **WHEN** 任务完成且用户确认清理
- **THEN** `delete_repository(repo_name) -> Dict` 方法 SHALL 调用 GitHub API 删除仓库

---

### Requirement: Commit Hook 机制

系统 SHALL 在 `backend/app/services/commit_hook_handler.py` 中实现 CommitHookHandler 类，接收 Claude Code CLI 实例的代码修改通知。

#### Scenario: CLI 实例通知代码修改完成
- **WHEN** Claude Code CLI 实例完成一项 checklist 任务
- **THEN** CLI 实例 SHALL 通过 hook 调用调度平台 API，传递以下信息：
  - `module_name`: 模块名称
  - `checklist_item`: 完成的 checklist 项描述
  - `changed_files`: 变更文件列表
  - `change_summary`: 代码修改摘要
  - `commit_message_suggestion`: 建议的 commit message
- **AND** 调度平台接收后返回确认响应

#### Scenario: 调度平台处理 hook
- **WHEN** CommitHookHandler 收到 CLI 实例的 hook 通知
- **THEN** `handle_commit_hook(workflow_id, module_name, hook_data)` 方法 SHALL：
  1. 验证 hook 数据完整性
  2. 调用 GitManager 执行 commit（使用 CLI 建议的 commit message）
  3. 调用 GitManager 推送到模块分支
  4. 更新 WorkflowStage 记录（记录 checklist 完成状态）
  5. 返回 `{ success, commit_hash, message }`
- **AND** 处理失败时记录错误日志，不阻塞 CLI 实例继续工作

#### Scenario: Hook API 端点
- **WHEN** CLI 实例需要通知调度平台
- **THEN** 系统 SHALL 提供 `POST /api/workflow/{workflow_id}/commit-hook` 端点：
  - 接收 `{ module_name, checklist_item, changed_files, change_summary, commit_message_suggestion }`
  - 返回 `{ success, commit_hash, message }`

---

### Requirement: GitManager 统一提交增强

系统 SHALL 增强 `backend/app/services/git_manager.py`，由调度平台统一执行所有 Git 操作。

#### Scenario: 调度平台统一 commit
- **WHEN** CommitHookHandler 收到 CLI 通知
- **THEN** `commit_module_changes(module_name, changed_files, commit_message)` 方法 SHALL：
  1. 切换到模块 worktree 目录
  2. 执行 `git add` 添加变更文件
  3. 执行 `git commit -m "<message>"`
  4. 返回 `{ success, commit_hash, message }`
- **AND** 无变更时返回 `{ success: true, message: "无变更" }`

#### Scenario: 设置远程仓库
- **WHEN** 任务启动后需要关联远程仓库
- **THEN** `setup_remote(repo_name)` 方法 SHALL：
  1. 调用 GitHubRepoManager.create_repository 创建远程仓库
  2. 设置本地 Git remote origin
  3. 返回 `{ success, repo_url, message }`

#### Scenario: 推送模块分支
- **WHEN** 调度平台完成模块代码 commit
- **THEN** `push_module_branch(module_name)` 方法 SHALL：
  1. 确定模块分支名（`module/{module_name}`）
  2. 执行 `git push origin module/{module_name}`
  3. 返回 `{ success, message, branch }`

#### Scenario: 推送 main 分支
- **WHEN** 测试审查智能体验证通过
- **THEN** `push_main_branch()` 方法 SHALL：
  1. 切换到 main 分支
  2. 合并所有模块分支到 main
  3. 执行 `git push origin main`
  4. 返回 `{ success, message }`

#### Scenario: 兜底提交（CLI 未通知）
- **WHEN** 模块标记为完成但调度平台未收到该模块的 hook 通知
- **THEN** 调度平台 SHALL：
  1. 检测模块 worktree 中是否有未提交的变更
  2. 若有，自动执行 `git add -A && git commit -m "auto: {module_name} 模块代码"`
  3. 推送到模块分支
  4. 记录日志 "模块 {module_name} 未通过 hook 通知，由调度平台兜底提交"

---

### Requirement: 测试审查智能体

系统 SHALL 在 `backend/app/services/agent_roles/test_reviewer.py` 中实现 TestReviewer 类，在所有模块代码完成后验证代码完整性。

#### Scenario: 生成测试审查智能体
- **WHEN** 所有模块代码修改完成
- **THEN** `create_test_reviewer(workflow_id)` 方法 SHALL：
  1. 收集所有模块的代码变更信息
  2. 分析任务需求文档和验收标准
  3. 生成测试审查智能体（使用 Hermes 创建）
  4. 返回智能体实例信息

#### Scenario: 测试审查流程
- **WHEN** 测试审查智能体启动
- **THEN** SHALL 执行以下检查：
  1. **代码完整性检查**：所有 checklist 项是否都有对应代码
  2. **编译检查**：项目是否能成功编译
  3. **依赖检查**：模块间依赖是否正确
  4. **接口检查**：模块间接口是否匹配
  5. **验收标准检查**：是否满足任务需求文档中的验收标准
- **AND** 每项检查生成通过/失败结果

#### Scenario: 审查结果处理
- **WHEN** 测试审查完成
- **THEN** SHALL 返回 `TestReviewReport` 对象：
  - `all_passed`: 是否全部通过
  - `check_results`: 各项检查结果列表
  - `failed_items`: 失败项详情
  - `summary`: 审查摘要
- **AND** 全部通过时触发 main 分支推送
- **AND** 存在失败时返回失败详情，由质量保障智能体决定是否迭代

---

### Requirement: 工作流引擎集成

系统 SHALL 在 Loop Engineering 工作流引擎中集成 Git 自动推送流程。

#### Scenario: 任务启动时创建仓库
- **WHEN** `start_workflow(session_id, user_input)` 被调用
- **THEN** 工作流引擎 SHALL：
  1. 从 user_input 中提取项目名称
  2. 调用 GitManager.setup_remote(project_name) 创建远程仓库
  3. 将 repo_name 存储到 Workflow 记录中
  4. 记录日志 "GitHub 仓库已创建: {repo_url}"

#### Scenario: 模块代码修改完成
- **WHEN** Claude Code CLI 实例通过 hook 通知代码修改完成
- **THEN** 调度平台 SHALL：
  1. 接收 hook 数据
  2. 调用 GitManager.commit_module_changes 提交代码
  3. 调用 GitManager.push_module_branch 推送到模块分支
  4. 更新 WorkflowStage 记录

#### Scenario: 全部模块完成后
- **WHEN** 所有模块的 Claude Code CLI 实例完成工作
- **THEN** 调度平台 SHALL：
  1. 兜底检查所有模块是否有未提交代码
  2. 生成测试审查智能体
  3. 执行测试审查流程
  4. 审查通过后：合并所有模块分支到 main → 推送 main → 记录日志 "代码编写任务完成，全部代码已推送到 main 分支"
  5. 审查不通过：返回失败详情，进入迭代流程

#### Scenario: 推送失败处理
- **WHEN** 任何推送步骤失败
- **THEN** 系统 SHALL：
  1. 记录详细错误日志
  2. 不阻塞工作流继续执行
  3. 在 Workflow 记录中保存错误信息

---

### Requirement: 配置管理

系统 SHALL 在 `config/auto_code_config.yaml` 中新增 GitHub 配置节。

#### Scenario: GitHub 配置
- **WHEN** 系统读取配置
- **THEN** SHALL 包含以下配置项：

```yaml
github:
  token: "${GITHUB_TOKEN}"
  default_visibility: "private"
  auto_push_enabled: true
  max_push_retries: 3
  push_retry_delay: 5
```

---

### Requirement: 分支命名规范

#### Scenario: 分支命名
- **WHEN** 创建模块分支
- **THEN** 分支名格式 SHALL 为：`module/{module_name}`
- **WHEN** 推送最终代码
- **THEN** 目标分支为 `main`

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| GitHub Token 泄露 | 账号安全 | 中 | 仅通过环境变量注入，永不写入文件或日志 |
| CLI hook 通知丢失 | 代码提交 | 中 | 兜底提交机制 + 模块完成时检查未提交代码 |
| 测试审查不准确 | 代码质量 | 中 | 多维度检查 + 人工审核兜底 |
| 网络不稳定导致推送失败 | 代码同步 | 中 | 重试机制 + 不阻塞主流程 |

## 成功标准

- 任务启动后 5 秒内完成 GitHub 仓库创建
- CLI hook 通知后 3 秒内完成 commit + push
- 测试审查覆盖率 100%（所有 checklist 项均有对应检查）
- 推送失败不阻塞工作流执行
- Token 零泄露
