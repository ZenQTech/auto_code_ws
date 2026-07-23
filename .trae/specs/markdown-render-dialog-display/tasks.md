# Tasks

- [x] Task 1: 增强 renderMarkdown() 支持表格和分隔线
  - 在 `frontend/src/utils/markdown.ts` 中新增表格解析逻辑
  - 表格支持：标准 `|...|` 语法 + `|:---|:---:|---:|` 对齐行
  - 分隔线支持：独立 `---` 行渲染为 `<hr>`
  - 表格输出带 Tailwind CSS 样式的 `<table>`（边框、斑马纹、表头加粗）
  - **验证**：用包含表格的需求文档测试渲染输出

- [x] Task 2: ArchitectureDesignModal 文档预览改用 Markdown 渲染
  - 在 `ArchitectureDesignModal.tsx` 中导入 `renderMarkdown`
  - 将预览标签页的 `<pre>{requirementV2}</pre>` 替换为 `useMemo(renderMarkdown) + dangerouslySetInnerHTML`
  - 空文档时显示灰色提示文字
  - **验证**：在弹窗预览标签页确认表格、标题、列表等格式正确渲染

- [x] Task 3: ClarificationCard summary 改用 Markdown 渲染
  - 在 `ClarificationCard.tsx` 中导入 `renderMarkdown`
  - 将 summary 的纯文本 `<p>` 替换为 `useMemo(renderMarkdown) + dangerouslySetInnerHTML`
  - **验证**：在澄清卡片中确认 summary 的 Markdown 格式正确渲染

# Task Dependencies
- Task 2 依赖 Task 1（需要增强后的 renderMarkdown）
- Task 3 依赖 Task 1（需要增强后的 renderMarkdown）
- Task 2 和 Task 3 可并行执行
