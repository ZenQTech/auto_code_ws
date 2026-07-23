# 对话框 Markdown 渲染支持 Spec

## Why
当前架构设计模态弹窗（ArchitectureDesignModal）和需求澄清卡片（ClarificationCard）中的需求文档、AI 总结等内容以纯文本 `<pre>` 标签展示，用户完全无法阅读结构化内容。项目已有 `renderMarkdown()` 工具函数，但未在对话框组件中使用。

## What Changes
- ArchitectureDesignModal 的「需求文档 V2.0 预览」标签页从 `<pre>` 纯文本改为 Markdown 渲染
- `renderMarkdown()` 工具函数增强：新增**表格**（`|...|`）和**分隔线**（`---`）渲染支持
- ClarificationCard 的 summary 区域改为 Markdown 渲染
- 所有使用 `dangerouslySetInnerHTML` 的地方添加 XSS 防护注释说明

## Impact
- Affected specs: `architecture-critique-iteration`（新增 MODIFIED Requirement）
- Affected code:
  - `frontend/src/components/ArchitectureDesignModal.tsx` - 预览区渲染方式
  - `frontend/src/components/ClarificationCard.tsx` - summary 渲染方式
  - `frontend/src/utils/markdown.ts` - 新增表格和分隔线支持

## ADDED Requirements

### Requirement: Markdown 表格渲染
`renderMarkdown()` SHALL 支持 Markdown 表格（`|...|` 语法）渲染为 HTML `<table>`。

#### Scenario: 标准表格
- **WHEN** Markdown 文本包含 `| 列1 | 列2 |` 格式的表格
- **THEN** 渲染为带边框、斑马纹的 HTML `<table>`，表头加粗居中

#### Scenario: 含对齐符的表格
- **WHEN** Markdown 文本包含 `|:---|:---:|---:|` 对齐行
- **THEN** 正确识别并对齐各列

### Requirement: Markdown 分隔线渲染
`renderMarkdown()` SHALL 支持 `---` 分隔线渲染为 `<hr>`。

#### Scenario: 分隔线
- **WHEN** Markdown 文本包含独立的 `---` 行
- **THEN** 渲染为视觉分隔线

## MODIFIED Requirements

### Requirement: ArchitectureDesignModal 文档预览
原：以 `<pre>` 纯文本展示需求文档 V2.0
新：ArchitectureDesignModal 的「需求文档 V2.0 预览」标签页 SHALL 使用 `renderMarkdown()` 渲染 Markdown 格式内容，包含标题层次、表格、代码块、列表、粗体/斜体等完整 Markdown 格式。

#### Scenario: 需求文档预览
- **WHEN** 用户在架构设计模态弹窗中切换到「需求文档 V2.0 预览」标签页
- **THEN** 文档以格式化 Markdown 渲染，标题有层级区分、表格有边框、代码块有背景色

#### Scenario: 空文档
- **WHEN** 需求文档内容为空
- **THEN** 显示「（暂无需求文档内容）」灰色提示文字

### Requirement: ClarificationCard summary 渲染
原：以 `<p>` 纯文本展示 AI 需求理解总结
新：ClarificationCard 的 summary 区域 SHALL 使用 `renderMarkdown()` 渲染，支持 Markdown 格式。

#### Scenario: Markdown 总结展示
- **WHEN** AI 返回的 summary 包含 Markdown 格式（如列表、粗体）
- **THEN** 以格式化 HTML 渲染，保持视觉层次
