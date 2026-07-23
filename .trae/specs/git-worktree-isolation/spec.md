# Git Worktree 隔离 Spec

> **来源**: [project-optimization-roadmap Task 3](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **优先级**: P0（核心工作流，依赖 Task 2 的提示词工程阶段）
> **依赖**: five-agent-roles（prompt_engineer 需要 worktree）

## Why

当提示词工程智能体为多个模块创建 Claude Code CLI 实例时，所有实例共享同一个工作目录会导致代码冲突。借鉴 Composio Agent Orchestrator（Workspace slot）和 Claude Squad（Git worktree 隔离）的设计，为每个 CLI 实例创建独立的 Git worktree 和分支，确保多模块并行开发时互不干扰。

## What Changes

- **新增 Worktree 数据模型**：worktrees 表
- **新增 WorktreeManager 服务**：创建、合并、清理、列表
- **新增 Worktree API 端点**：create、merge、delete、list
- **集成到提示词工程智能体**：inject_to_claude_cli 自动创建 worktree
- **注册到应用**：main.py 初始化 WorktreeManager

## Impact

- Affected specs: five-agent-roles（prompt_engineer 依赖本 spec）
- Affected code:
  - `backend/app/models.py` — 新增 Worktree 模型
  - `backend/app/services/worktree_manager.py` — 新建
  - `backend/app/api/worktree.py` — 新建
  - `backend/app/api/__init__.py` — 注册路由
  - `backend/app/main.py` — 注册 WorktreeManager

---

## ADDED Requirements

### Requirement: Worktree 数据模型

系统 SHALL 在 `backend/app/models.py` 中新增 Worktree ORM 模型。

#### Scenario: Worktree 模型定义
- **WHEN** 系统创建新的 worktree 记录
- **THEN** Worktree 模型 SHALL 包含以下字段：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String(36) | PK, UUID | Worktree 唯一标识 |
| agent_id | String(36) | NULLABLE, INDEX | 关联智能体 ID |
| task_id | String(36) | NULLABLE, INDEX | 关联任务 ID |
| repo_path | String(512) | NOT NULL | 仓库路径 |
| worktree_path | String(512) | NOT NULL | Worktree 路径 |
| branch_name | String(256) | NOT NULL | 分支名称 |
| status | String(32) | DEFAULT "active" | 状态：active/merged/cleaned |
| created_at | DateTime | DEFAULT now | 创建时间 |

---

### Requirement: WorktreeManager 服务

系统 SHALL 在 `backend/app/services/worktree_manager.py` 中实现 WorktreeManager 类，管理 Git worktree 的完整生命周期。

#### Scenario: 创建 worktree
- **WHEN** 提示词工程智能体为模块创建 Claude Code CLI 实例
- **THEN** `create_worktree(repo_path, module_name, instance_id)` 方法 SHALL：
  1. 确定 worktree 路径：`<repo>/.worktrees/<module-name>-<worktree-id>`
  2. 创建独立分支：`module/<module-name>/<worktree-id>`
  3. 执行 `git worktree add <path> <branch>`
  4. 返回 WorktreeInfo 对象（worktree_id, repo_path, worktree_path, branch_name, module_name, instance_id, status）
- **AND** worktree 创建耗时 < 2 秒
- **AND** 若 git 命令不可用，降级为直接创建目录（不阻塞主流程）

#### Scenario: 合并 worktree
- **WHEN** 质量评审通过后
- **THEN** `merge_worktree(worktree_id, repo_path)` 方法 SHALL：
  1. 查找 worktree 路径
  2. 切换到主分支（main/master）
  3. 执行 `git merge <branch> --no-ff`
  4. 删除 worktree：`git worktree remove <path> --force`
  5. 删除分支：`git branch -D <branch>`
  6. 返回 MergeResult 对象（success, worktree_id, branch_name, conflicts, message）
- **AND** 合并冲突时返回 conflicts 列表

#### Scenario: 清理 worktree
- **WHEN** 需要清理单个 worktree（不合并）
- **THEN** `cleanup_worktree(worktree_id, repo_path)` 方法 SHALL：
  1. 查找 worktree 目录
  2. 执行 `git worktree remove <path> --force`
  3. 若目录仍存在，手动删除

#### Scenario: 列出所有 worktree
- **WHEN** 需要查看当前所有 worktree
- **THEN** `list_worktrees(repo_path)` 方法 SHALL：
  1. 执行 `git worktree list --porcelain`
  2. 解析输出
  3. 返回 WorktreeInfo 列表
- **AND** 若 git 不可用，扫描 `.worktrees/` 目录

#### Scenario: 批量清理 worktree
- **WHEN** 质量评审通过后
- **THEN** `cleanup_all_worktrees(repo_path)` 方法 SHALL：
  1. 列出所有 worktree
  2. 跳过主 worktree
  3. 逐个清理

---

### Requirement: Worktree API

系统 SHALL 在 `backend/app/api/worktree.py` 中提供 Git Worktree 管理端点。

#### Scenario: 创建 worktree 端点
- **WHEN** 前端调用 `POST /api/worktree/create`
- **THEN** 接收 `{ repo_path, module_name, instance_id }`
- **AND** 调用 WorktreeManager.create_worktree
- **AND** 返回 WorktreeResponse

#### Scenario: 合并 worktree 端点
- **WHEN** 前端调用 `POST /api/worktree/merge`
- **THEN** 接收 `{ worktree_id, repo_path }`
- **AND** 调用 WorktreeManager.merge_worktree
- **AND** 返回 MergeResponse

#### Scenario: 删除 worktree 端点
- **WHEN** 前端调用 `DELETE /api/worktree/{worktree_id}`
- **THEN** 调用 WorktreeManager.cleanup_worktree
- **AND** 返回 `{ success, message }`

#### Scenario: 列出 worktree 端点
- **WHEN** 前端调用 `GET /api/worktree/list`
- **THEN** 返回所有 worktree 列表

---

### Requirement: 集成到提示词工程智能体

系统 SHALL 在提示词工程智能体的 `inject_to_claude_cli` 方法中集成 WorktreeManager。

#### Scenario: 自动创建 worktree
- **WHEN** `inject_to_claude_cli(optimized_prompt, module_name, repo_path)` 被调用
- **THEN** 方法 SHALL：
  1. 调用 WorktreeManager.create_worktree 创建独立 worktree
  2. 在 worktree 路径下创建 Claude Code CLI 实例
  3. 返回的 AgentInstance 包含 worktree_path 和 branch_name
- **AND** worktree 创建失败时不阻塞实例创建（降级使用默认工作空间）

---

### Requirement: 注册到应用

系统 SHALL 在 `backend/app/main.py` 中初始化并注册 WorktreeManager。

#### Scenario: 启动时初始化
- **WHEN** FastAPI 应用启动
- **THEN** 创建 WorktreeManager 实例
- **AND** 存储到 `app.state.worktree_manager`
- **AND** 记录日志 "Git Worktree 管理器已初始化"

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| Git worktree 磁盘占用过大 | 磁盘空间 | 中 | 自动清理策略 + 磁盘告警 |
| git 命令不可用 | worktree 功能 | 低 | 降级为目录创建，不阻塞主流程 |
| worktree 合并冲突 | 代码合并 | 中 | 冲突检测 + 人工介入提示 |
| 多 worktree 并发创建 | 性能 | 低 | 异步创建，互不阻塞 |

## 成功标准

- worktree 创建耗时 < 2 秒
- 多模块并行操作零冲突
- worktree 自动清理成功率 > 95%
- git 不可用时优雅降级，不阻塞主流程
