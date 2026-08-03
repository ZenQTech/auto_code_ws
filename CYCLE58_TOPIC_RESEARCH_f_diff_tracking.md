# CYCLE58 - 主题 f 调研：代码修改细节追踪/比对/展示

> **调研日期**: 2026-08-03
> **来源**: Codex diff + TRAE DiffView + Hermes DiffView

---

## 1. Codex Diff 能力

### 1.1 多种 Diff 模式
**来源**: https://developers.openai.com/codex/changelog/

**2026-07-06** - iOS Codex:
- 添加 stage/unstage/branch/last-turn 变更过滤器
- 添加分支比较控制

**2026-06-15** - macOS Codex:
- **expand/collapse all diffs**：评审变更文件时可一键展开/折叠所有 diff

**2026-06-04** - Codex App:
- **animated diff stat alignment**：动画 diff 统计对齐

**2026-06-02** - iOS Codex:
- **line wrapping toggle**：diff 换行切换
- **Face ID / passcode lock**：Codex 锁

### 1.2 Multi-repository review（2026-07-30）
- 多文件夹项目 → 显示所有 repo 的变更
- **Review button** → 跨 repo 检查 diffs 而不切换
- 一致的 diff ordering with file tree（2026-06-09）

### 1.3 Workspace diff
- Workspace diff accuracy（2026-07-06）：改进工作区 diff 准确性
- expand-and-collapse navigation（2026-07-06）

### 1.4 Inline review comments（2026-06-09）
- 在变更文件中加内联评论
- 评论 → 发送给 Codex → 修订

### 1.5 TUI 语法高亮
- 主题感知的 diff 颜色
- 语法高亮 fenced code blocks
- 语法高亮 diffs

---

## 2. TRAE DiffView

### 2.1 核心能力
**来源**: https://docs.trae.ai/ide/solo-mode

- 完成任务后通过对话面板"**查看变更**"按钮打开 DiffView
- 窗口显示：
  - **受影响文件数量**
  - **变更行数**（+/-）
  - **变更文件列表**
- 点击任一文件查看具体 diff 视图
- 标准的 +/- diff 显示

### 2.2 代码变更工具
**来源**: https://docs.trae.ai/ide/tool-panels

- 展示当前任务的代码变更情况
- 包括变更的文件数量、文件名称、变更的代码行数
- 可打开某个文件查看具体变更

---

## 3. Hermes DiffView 现状

### 3.1 DiffView 组件
**文件**: [frontend/src/components/DiffView.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/DiffView.tsx) (56k 完整)

**已实现**：
- ✅ 完整 diff 视图
- ✅ 文件树
- ✅ +/- 标记
- ✅ 语法高亮

### 3.2 DiffPreviewModal
**文件**: [frontend/src/components/DiffPreviewModal.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/DiffPreviewModal.tsx)

### 3.3 ComposerPanel 多文件 diff
- 多文件列表
- Accept/Reject
- Undo/Redo

### 3.4 后端 git diff API
**文件**: [backend/app/api/git.py](file:///home/qizheng/auto_code_ws/backend/app/api/git.py) (17k)

- git diff 检索
- commit history
- branch comparison

### 3.5 差异算法
- **unified diff**（git 默认）
- **side-by-side diff**（Hermes 自定义）
- **行内 inline diff**（Hermes 自定义）

---

## 4. 三方对比

| 维度 | Codex | TRAE | Hermes |
|------|-------|------|--------|
| Diff 视图 | ✅ | ✅ | ✅ DiffView (56k) |
| 多文件列表 | ✅ | ✅ | ✅ ComposerPanel |
| +/- 行数 | ✅ | ✅ | ✅ |
| 折叠/展开 | ✅ | ⚠️ | ✅ |
| Multi-repo | ✅ | ❌ | ⚠️ 部分 |
| Inline comments | ✅ | ❌ | ❌ 缺 |
| 主题感知颜色 | ✅ | N/A | ⚠️ 需优化 |
| 行内 diff | ✅ | ✅ | ✅ |

---

## 5. 实施建议

### P0 - DiffView 增强
- **expand/collapse all**：一键展开/折叠所有 diff
- **branch comparison**：分支比较视图
- **stage/unstage 切换**：stage 模式切换

### P1 - Inline review comments
- 在 diff 视图加内联评论
- 评论 → 自动生成修复 prompt

### P1 - Multi-repo Diff
- Hermes 支持多工作区 diff
- 跨项目文件树对比

### P2 - Diff 历史与回放
- 每次 commit 的 diff snapshot
- 可重放历史 diff 演变
