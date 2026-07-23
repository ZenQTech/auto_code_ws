# Tasks: Git 自动推送系统

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/git-auto-push-system/spec.md)

---

## Task 1: GitHub 仓库管理器

- [x] 1.1 创建 `backend/app/services/github_repo_manager.py`
- [x] 1.2 实现 `GitHubRepoManager.__init__()` — 从环境变量 `GITHUB_TOKEN` 读取 Token
- [x] 1.3 实现 `create_repository(repo_name, description, private) -> Dict`
- [x] 1.4 实现 `get_repository(repo_name) -> Optional[Dict]`
- [x] 1.5 实现 `list_repositories() -> List[Dict]`
- [x] 1.6 实现 `delete_repository(repo_name) -> Dict`
- [x] 1.7 实现 `get_username() -> str`
- [x] 1.8 实现 Token 不存在时的优雅降级

## Task 2: Commit Hook 机制

- [x] 2.1 创建 `backend/app/services/commit_hook_handler.py`
- [x] 2.2 实现 `CommitHookHandler.__init__(git_manager, session_factory)`
- [x] 2.3 实现 `handle_commit_hook(workflow_id, module_name, hook_data) -> Dict`
- [x] 2.4 实现 hook 数据验证（module_name、changed_files、commit_message_suggestion 必填）
- [x] 2.5 实现 `POST /api/workflow/{workflow_id}/commit-hook` API 端点
- [x] 2.6 实现 hook 处理失败时的错误日志记录

## Task 3: GitManager 统一提交增强

- [x] 3.1 在 `backend/app/services/git_manager.py` 中集成 `GitHubRepoManager`
- [x] 3.2 实现 `commit_module_changes(module_name, changed_files, commit_message) -> Dict`
- [x] 3.3 实现 `setup_remote(repo_name) -> Dict` — 创建远程仓库 + 设置 remote
- [x] 3.4 实现 `push_module_branch(module_name) -> Dict` — 推送模块分支
- [x] 3.5 实现 `push_main_branch() -> Dict` — 合并所有模块分支 + 推送 main
- [x] 3.6 实现 `check_uncommitted_changes(module_name) -> bool` — 检测未提交变更
- [x] 3.7 实现兜底提交逻辑：模块完成但未收到 hook 时自动提交

## Task 4: 测试审查智能体

- [x] 4.1 创建 `backend/app/services/agent_roles/test_reviewer.py`
- [x] 4.2 实现 `TestReviewReport` 数据类
- [x] 4.3 实现 `TestReviewer.__init__(hermes_service, git_manager)`
- [x] 4.4 实现 `review_all_modules(workflow_id) -> TestReviewReport`
- [x] 4.5 实现代码完整性检查（checklist 项 vs 实际代码）
- [x] 4.6 实现编译检查
- [x] 4.7 实现依赖检查和接口检查
- [x] 4.8 实现验收标准检查

## Task 5: 工作流引擎集成

- [x] 5.1 在 `WorkflowEngine` 中注入 `GitManager` 和 `CommitHookHandler`
- [x] 5.2 在 `start_workflow` 中集成仓库创建
- [x] 5.3 在 `mark_completed` 前集成测试审查 + main 推送
- [x] 5.4 在 `Workflow` 模型中新增 `repo_name` 字段
- [x] 5.5 在 `WorkflowStatusInfo` 中新增推送状态字段

## Task 6: 配置管理

- [x] 6.1 在 `config/auto_code_config.yaml` 中新增 `github` 配置节
- [x] 6.2 在 `backend/app/config.py` 中新增 `github` 配置属性
- [x] 6.3 在 `backend/app/main.py` 中初始化 `GitHubRepoManager`

## Task 7: 验证

- [x] 7.1 Python 导入测试：所有新模块正确导入
- [x] 7.2 GitHub API 测试：创建/获取/删除仓库
- [x] 7.3 Commit Hook 测试：接收 hook → commit → push 流程
- [x] 7.4 兜底提交测试：未收到 hook 时自动提交
- [x] 7.5 测试审查测试：全部通过 / 部分失败场景
- [x] 7.6 Token 不存在时优雅降级

---

## 任务依赖关系

```
Task 1 (GitHubRepoManager) ─┐
Task 2 (CommitHook)         ├── Task 3 (GitManager 增强) ── Task 5 (工作流集成)
Task 4 (测试审查智能体) ────┘
Task 6 (配置管理) 可与 Task 1 并行
Task 7 (验证) 在所有任务完成后执行
```
