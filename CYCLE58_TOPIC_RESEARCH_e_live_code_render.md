# CYCLE58 - 主题 e 调研：代码实时编写的前端渲染

> **调研日期**: 2026-08-03
> **来源**: Codex Live Edit + TRAE 编辑器 + Hermes ComposerPanel

---

## 1. Codex 实时代码编辑

### 1.1 Edit in-app（2026-07-09）
**来源**: https://developers.openai.com/codex/changelog/

- 直接在 app 中编辑 Markdown 和代码
- 使用 inline annotations（行内批注）
- 让 Codex 修订选中的内容
- **PR Chat 集成**：在 GitHub PR 中修订 Codex
- 发送内联 review feedback → 检查 proposed patches → 编辑/接受/拒绝
- 不离开 app 即可完成整个 PR review

### 1.2 App 内置编辑器
- 选中代码 → Cmd+K → 选择"Ask Codex"
- 选中代码 → 直接输入编辑指令
- 流式应用 diff 到文件

### 1.3 Multi-folder local projects
- 一个项目多个相关文件夹
- 主文件夹用于 AGENTS.md/skills/config.toml 发现
- 次要文件夹提供文件搜索/读取/编辑

---

## 2. TRAE 实时代码编辑

### 2.1 编辑器工具
**来源**: https://docs.trae.ai/ide/tool-panels

- 展示**编码过程**和最终代码
- 代码生成完毕后**自动接受**
- 可点击"查看变更"在代码变更工具中查看
- 手动编辑代码
- **选中代码片段** → 发送至 AI 对话进行进一步处理
- **删除文件/代码**操作：智能体提前征求确认

### 2.2 实时跟随模式
- 工具面板左上角"实时跟随"按钮
- 开启后系统根据 AI 当前工作阶段自动切换工具
- 例: AI 生成 PRD 时自动打开"文档"工具；AI 编写代码时自动切换至"编辑器"工具
- AI 处理任务时工具处于只读状态
- 双击或滚动内容可退出实时跟随模式

---

## 3. Hermes 现状

### 3.1 ComposerPanel（v6.36.0）
**文件**: [frontend/src/components/ComposerPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ComposerPanel.tsx)

**已实现**：
- ✅ 多文件 diff 列表
- ✅ Accept/Reject 单个文件
- ✅ Undo/Redo
- ✅ Plan/Preview/Edit 三模式
- ✅ `@` mention fuzzy search
- ✅ 上下文窗口监控

**Hook**: [frontend/src/hooks/useComposer.tsx](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useComposer.tsx) (18.8k)

**Engine**: [frontend/src/utils/composerEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/composerEngine.ts)

### 3.2 实时渲染
- 流式接收 LLM 输出
- shiki 代码高亮
- Monaco Editor 集成
- MarkdownContent 实时渲染

### 3.3 双向数据绑定
- Composer state ↔ Backend
- WebSocket 流式更新
- 上下文状态同步

---

## 4. 三方对比

| 维度 | Codex | TRAE | Hermes |
|------|-------|------|--------|
| 实时编辑 | ✅ Inline annotations | ✅ 自动接受 | ⚠️ Composer |
| 选中→AI | ✅ Cmd+K | ✅ 发送至对话 | ✅ @ mention |
| 多文件 diff | ✅ PR Chat | ✅ 代码变更 | ✅ Composer |
| 删除确认 | ✅ | ✅ | ✅ |
| 实时跟随 | ❌ | ✅ | ❌ 缺 |
| 双向绑定 | ✅ | ✅ | ✅ |

---

## 5. 实施建议

### P0 - Auto-Follow 联动（实时跟随 Hermes 版）
- **AutoFollowController**：监听 SSE 事件
- 阶段检测：plan → document → code → test
- 自动打开对应 panel 并滚动到最新

### P0 - 选中 → AI 优化
- **CodeBlock 增强**：选中代码 → 弹出"Ask"按钮
- 弹出 Mini composer 输入指令

### P1 - Inline Annotations
- ComposerPanel 文件树支持行内批注
- 批注 → 自动生成修复指令

### P2 - PR Chat 集成
- Hermes 与 GitHub PR 集成
- PR 评审内嵌 Hermes 对话
