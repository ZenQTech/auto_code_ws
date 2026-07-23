# Git 自动 Commit + Push Spec

> **来源**: [project-optimization-roadmap Task 5](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **优先级**: P1（支撑能力，独立开发）
> **依赖**: 无

## Why

借鉴 Aider（原子 Git commit + 智能 message）的设计，在 Claude Code CLI 实例完成代码修改后自动执行 Git commit 和 push，生成语义化的 commit message。减少手动 Git 操作，确保每次代码变更都有清晰的版本记录。

## What Changes

- **增强 GitManager**：新增 `auto_push` 和 `generate_commit_message` 方法
- **增强 GitPanel 前端组件**：显示自动 commit 历史、提供开关控制

## Impact

- Affected specs: 无
- Affected code:
  - `backend/app/services/git_manager.py` — 新增方法
  - `frontend/src/components/GitPanel.tsx` — 增强

---

## ADDED Requirements

### Requirement: 自动 Push

系统 SHALL 在 `backend/app/services/git_manager.py` 的 GitManager 类中新增 `auto_push` 方法。

#### Scenario: 自动 Push 到远程
- **WHEN** Claude Code CLI 实例完成代码修改
- **THEN** `auto_push(branch)` 方法 SHALL：
  1. 确定推送分支（默认当前分支）
  2. 检查远程 origin 是否存在
  3. 执行 `git push origin <branch>`
  4. 返回推送结果字典 `{ success, message, branch }`
- **AND** 远程不存在时返回 `{ success: false, message: "未配置远程仓库 origin" }`
- **AND** 远程已是最新时返回 `{ success: true, message: "远程已是最新" }`

#### Scenario: Push 失败处理
- **WHEN** push 遇到错误（如网络问题、权限不足）
- **THEN** 方法 SHALL 捕获异常并返回 `{ success: false, message: <error> }`
- **AND** 记录错误日志

---

### Requirement: 智能 Commit Message 生成

系统 SHALL 在 GitManager 类中新增 `generate_commit_message` 方法，基于文件变更自动生成语义化 commit message。

#### Scenario: 基于文件类型生成 commit message
- **WHEN** 需要为代码变更生成 commit message
- **THEN** `generate_commit_message(changes, module_context)` 方法 SHALL：
  1. 统计变更文件的扩展名分布
  2. 根据主要文件类型确定前缀：
     - `.py/.ts/.tsx/.js/.cpp/.c/.h/.html` → `feat`
     - `.json/.yaml/.yml` → `chore`
     - `.md` → `docs`
     - `.css` → `style`
  3. 从 module_context 或文件路径推断 scope
  4. 生成描述（单文件用文件名，多文件用文件数量）
  5. 返回格式：`<prefix>(<scope>): <description>`

#### Scenario: Commit message 示例
- **WHEN** 变更文件为 `src/perception/lidar_detector.py`
- **THEN** 生成 `feat(perception): 更新 lidar_detector.py`
- **WHEN** 变更文件为 `config/params.yaml`, `config/sensors.yaml`
- **THEN** 生成 `chore(config): 更新 2 个文件`

#### Scenario: 空变更处理
- **WHEN** 变更文件列表为空
- **THEN** 返回 `"chore: 自动提交"`

---

### Requirement: 前端 GitPanel 增强

系统 SHALL 增强 `frontend/src/components/GitPanel.tsx`，支持显示自动 commit 历史和开关控制。

#### Scenario: 自动 commit 开关
- **WHEN** 用户在 GitPanel 中操作
- **THEN** GitPanel SHALL 提供：
  - 自动 commit 开关（toggle）
  - 自动 push 开关（toggle）
- **AND** 开关状态持久化到后端配置

#### Scenario: 自动 commit 历史
- **WHEN** 系统执行了自动 commit
- **THEN** GitPanel SHALL 在提交记录中标注自动 commit（如 🤖 图标）
- **AND** 显示 commit message 和提交时间

---

## MODIFIED Requirements

### Requirement: GitManager 增强（原 backend/app/services/git_manager.py）

**原行为**: GitManager 提供仓库初始化、分支管理、自动 commit、版本标签、合并冲突检测。

**新行为**: 新增 `auto_push` 和 `generate_commit_message` 方法，支持自动 push 和智能 commit message 生成。

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| Push 失败（网络/权限） | 代码同步 | 中 | 异常捕获 + 错误日志 + 不阻塞主流程 |
| Commit message 不准确 | 版本记录 | 低 | 基于文件类型和路径的规则生成，可人工修改 |

## 成功标准

- 代码修改后 3 秒内自动 commit
- commit message 描述准确率 > 80%
- auto_push 失败不阻塞主流程