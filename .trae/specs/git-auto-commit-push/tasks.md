# Tasks: Git 自动 Commit + Push

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/git-auto-commit-push/spec.md)

---

## Task 1: 后端增强

- [x] 1.1 在 `backend/app/services/git_manager.py` 中新增 `auto_push(branch) -> Dict` 方法
- [x] 1.2 在 `backend/app/services/git_manager.py` 中新增 `generate_commit_message(changes, module_context) -> str` 方法
- [x] 1.3 实现文件类型到 commit 前缀的映射（feat/chore/docs/style）
- [x] 1.4 实现 scope 推断逻辑（从 module_context 或文件路径）
- [x] 1.5 实现描述生成逻辑（单文件用文件名，多文件用数量）

## Task 2: 前端增强

- [x] 2.1 增强 `frontend/src/components/GitPanel.tsx`：新增自动 commit 开关（toggle）
- [x] 2.2 增强 `frontend/src/components/GitPanel.tsx`：新增自动 push 开关（toggle）
- [x] 2.3 增强 `frontend/src/components/GitPanel.tsx`：提交记录中标注自动 commit（🤖 图标）

## Task 3: 验证

- [x] 3.1 auto_push 正确推送到远程分支
- [x] 3.2 generate_commit_message 生成语义化 commit message
- [x] 3.3 Push 失败不阻塞主流程
- [x] 3.4 前端开关正确控制自动 commit/push 行为

---

## 任务依赖关系

```
Task 1 (后端) 和 Task 2 (前端) 可并行开发
Task 3 (验证) 在所有任务完成后执行
```
