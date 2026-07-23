# Checklist: Monaco Editor 升级 CodeViewer

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/monaco-editor-upgrade/spec.md)

---

## 依赖安装

- [x] @monaco-editor/react 已安装到 frontend 项目

## CodeViewer 重构

- [x] CodeViewer.tsx 已重构为使用 Monaco Editor
- [x] React.lazy 懒加载已实现
- [x] Monaco 加载骨架屏已实现（MonacoLoading 组件）
- [x] 语言检测逻辑已保留（LANGUAGE_MAP，20+ 语言）
- [x] 文件图标映射已保留（FILE_ICONS）
- [x] Monaco Editor 选项已配置（readOnly、minimap、fontSize、lineNumbers、wordWrap、theme 等）
- [x] onChange 回调已实现（追踪 isDirty 状态）
- [x] 顶部栏已保留（文件图标、文件名、语言、行数、修改状态、关闭按钮）
- [x] 加载态和错误态处理已保留

## 验证

- [x] TypeScript 编译通过
- [x] Vite 构建通过（代码分割正确）
- [x] Monaco Editor 首次加载 < 2 秒
- [x] 支持至少 20 种语言语法高亮
- [x] TypeScript 智能补全可用
- [x] 错误诊断（红色波浪线）可用
- [x] 不影响现有文件浏览功能
