# Checklist: Git Worktree 隔离

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/git-worktree-isolation/spec.md)

---

## 数据模型

- [x] Worktree 模型已添加到 models.py（9 个字段）

## WorktreeManager 服务

- [x] worktree_manager.py 已创建
- [x] WorktreeInfo 数据类已实现
- [x] MergeResult 数据类已实现
- [x] WorktreeManager.__init__ 已实现
- [x] create_worktree 方法已实现（创建分支 + git worktree add）
- [x] merge_worktree 方法已实现（切换主分支 + merge + 删除 worktree + 删除分支）
- [x] cleanup_worktree 方法已实现（git worktree remove + 手动删除）
- [x] list_worktrees 方法已实现（git worktree list --porcelain 解析）
- [x] cleanup_all_worktrees 方法已实现
- [x] git 不可用时降级方案已实现（目录创建）

## Worktree API

- [x] worktree.py 已创建
- [x] POST /api/worktree/create 端点已实现
- [x] POST /api/worktree/merge 端点已实现
- [x] DELETE /api/worktree/{id} 端点已实现
- [x] GET /api/worktree/list 端点已实现
- [x] Pydantic 请求/响应模型已添加

## 注册与集成

- [x] api/__init__.py 中 worktree 路由已注册
- [x] main.py 中 WorktreeManager 已初始化并存储到 app.state

## 验证

- [x] Python 导入测试通过
- [x] API 端点测试通过（所有 4 个端点）
- [x] worktree 创建耗时 < 2 秒
- [x] git 不可用时降级方案正常工作
