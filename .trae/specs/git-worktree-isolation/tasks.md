# Tasks: Git Worktree 隔离

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/git-worktree-isolation/spec.md)

---

## Task 1: 数据模型

- [x] 1.1 在 `backend/app/models.py` 中新增 `Worktree` ORM 模型（9 个字段）

## Task 2: WorktreeManager 服务

- [x] 2.1 创建 `backend/app/services/worktree_manager.py`
- [x] 2.2 实现 `WorktreeInfo` 和 `MergeResult` 数据类
- [x] 2.3 实现 `WorktreeManager.__init__(base_worktree_dir)`
- [x] 2.4 实现 `create_worktree(repo_path, module_name, instance_id) -> WorktreeInfo`
- [x] 2.5 实现 `merge_worktree(worktree_id, repo_path) -> MergeResult`
- [x] 2.6 实现 `cleanup_worktree(worktree_id, repo_path)`
- [x] 2.7 实现 `list_worktrees(repo_path) -> List[WorktreeInfo]`
- [x] 2.8 实现 `cleanup_all_worktrees(repo_path)`
- [x] 2.9 实现 git 不可用时的降级方案（目录创建）

## Task 3: Worktree API

- [x] 3.1 创建 `backend/app/api/worktree.py`
- [x] 3.2 实现 `POST /api/worktree/create` — 创建 Worktree
- [x] 3.3 实现 `POST /api/worktree/merge` — 合并 Worktree
- [x] 3.4 实现 `DELETE /api/worktree/{id}` — 清理 Worktree
- [x] 3.5 实现 `GET /api/worktree/list` — 列出所有 Worktree
- [x] 3.6 新增 Pydantic 请求/响应模型

## Task 4: 注册与集成

- [x] 4.1 在 `backend/app/api/__init__.py` 中注册 worktree 路由
- [x] 4.2 在 `backend/app/main.py` 中初始化 WorktreeManager 并存储到 app.state

## Task 5: 验证

- [x] 5.1 Python 导入测试：WorktreeManager 正确导入
- [x] 5.2 API 端点测试：所有 4 个端点返回正确响应
- [x] 5.3 worktree 创建耗时 < 2 秒
- [x] 5.4 git 不可用时降级方案正常工作

---

## 任务依赖关系

```
Task 1 (数据模型) → Task 2 (WorktreeManager) → Task 3 (API)
                                              → Task 4 (注册)
Task 5 (验证) 在所有任务完成后执行
```
