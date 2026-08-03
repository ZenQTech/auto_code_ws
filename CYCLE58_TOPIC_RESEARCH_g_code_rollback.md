# CYCLE58 - 主题 g 调研：代码回退功能

> **调研日期**: 2026-08-03
> **来源**: Codex git/sandbox + TRAE 编辑器 + Hermes git_manager

---

## 1. Codex 代码回退与回放

### 1.1 Worktree 机制
**来源**: https://developers.openai.com/codex/changelog/

**2026-06-09** - iOS Codex:
- 添加选择分支、创建 worktree、运行环境设置脚本

**2026-05-29** - Codex App 26.527:
- **Thread coordination for local projects and worktrees**：本地项目和 worktree 的线程协调
- 包括显式请求时的独立后台线程

**2026-05-21** - Appshots & Goal mode:
- Goal mode 稳定版
- 支持自动保存点（类 checkpoint）

### 1.2 沙箱回退
- **Workspace-write sandbox**：所有写入限制在工作区
- **Sandbox approval**：所有外部操作需用户批准
- **Git integration**：每次操作前可创建 commit 作为回退点

### 1.3 `/undo` 命令
- Codex CLI 支持 `/undo` 撤销上一步
- 与 editor 的 undo stack 集成

### 1.4 PR Chat 撤销
**2026-07-09**:
- 在 PR Chat 中编辑/接受/拒绝 patches
- 不离开 app 即可回退 patch

### 1.5 Record & Replay（2026-06-18）
- macOS 独有功能
- 将演示的工作流转为可复用 skill
- 也可用于"回放"历史操作

---

## 2. TRAE 代码回退

### 2.1 编辑器工具回退
**来源**: https://docs.trae.ai/ide/tool-panels

- 代码生成完毕后**自动接受**（用户可关闭）
- 可**手动编辑代码**
- 选中代码片段 → 发送至 AI 对话
- **删除文件/代码**操作：智能体提前征求确认

### 2.2 撤销栈
- 标准编辑器 undo/redo
- 不依赖 git

### 2.3 工作流级回退
- **对话流节点自动折叠**：设置 > 对话流 > 待办清单
- 启用后已完成任务在对话框中**被折叠并生成摘要**
- 可展开任一折叠部分查看细节
- 折叠节点可视为"回退到该节点状态"

---

## 3. Hermes 代码回退现状

### 3.1 Git 自动化
**文件**: [backend/app/services/git_manager.py](file:///home/qizheng/auto_code_ws/backend/app/services/git_manager.py) (102k)

**已实现**：
- ✅ GitPython 集成
- ✅ Per-module worktree
- ✅ Auto commit on hook
- ✅ Branch 保护
- ✅ Push to bare remote
- ✅ Commit timeline UI
- ✅ Version timeline UI

### 3.2 UI 组件
- **GitPanel**: [frontend/src/components/GitPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/GitPanel.tsx)
- **CommitTimeline**: [frontend/src/components/CommitTimeline.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/CommitTimeline.tsx)
- **VersionTimeline**: [frontend/src/components/VersionTimeline.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/VersionTimeline.tsx)

### 3.3 ComposerPanel Undo/Redo
- Undo/Redo 按钮
- 编辑历史栈
- 不依赖 git

### 3.4 Hook 触发
- `task_completed` hook → auto commit
- 每次任务完成自动 git commit
- 可视为自动 checkpoint

### 3.5 缺失
- ❌ 显式 `/undo` 命令
- ❌ 一键回退到任意 commit
- ❌ 编辑器内 inline undo（类似 Cmd+Z）
- ❌ 回退前的 diff 预览
- ❌ 对话流节点折叠（TRAE 那种）

---

## 4. 三方对比

| 维度 | Codex | TRAE | Hermes |
|------|-------|------|--------|
| Git commit | ✅ 自动 | ⚠️ 需手动 | ✅ 自动 hook |
| Worktree | ✅ | ❌ | ✅ |
| Undo/Redo | ✅ 编辑器 | ✅ 编辑器 | ✅ ComposerPanel |
| Sandbox | ✅ 多层 | ⚠️ 工具级 | ⚠️ 部分 |
| /undo 命令 | ✅ | ❌ | ❌ 缺 |
| 回退预览 | ✅ | ❌ | ⚠️ DiffView |
| 对话节点折叠 | ❌ | ✅ | ❌ 缺 |
| 恢复点 | ✅ checkpoint | ❌ | ✅ hook commit |

---

## 5. 实施建议

### P0 - 代码回退增强
- **一键回退**：点击 commit → "回退到该 commit" 按钮
- **回退前 diff 预览**：显示回退将撤销/重做的内容
- **回退确认弹窗**：避免误操作

### P0 - 对话流节点自动折叠
- 已完成任务自动折叠 + 摘要
- 可展开任一节点查看
- 折叠节点可视为"回退到该节点状态"

### P1 - `/undo` 命令
- 在 composer 输入 `/undo` → 撤销上一步
- 与 ComposerPanel undo stack 集成

### P1 - 沙箱增强
- 文件级回退（不仅是整个 commit）
- 多步回退（任意 N 步）
