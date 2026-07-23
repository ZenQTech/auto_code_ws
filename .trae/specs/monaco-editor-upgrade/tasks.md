# Tasks: Monaco Editor 升级 CodeViewer

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/monaco-editor-upgrade/spec.md)

---

## Task 1: 依赖安装

- [x] 1.1 安装 `@monaco-editor/react` 到 frontend 项目

## Task 2: CodeViewer 重构

- [x] 2.1 重构 `frontend/src/components/CodeViewer.tsx`：引入 Monaco Editor
- [x] 2.2 实现 `React.lazy` 懒加载 Monaco Editor
- [x] 2.3 实现 Monaco 加载骨架屏（MonacoLoading 组件）
- [x] 2.4 保留语言检测逻辑（LANGUAGE_MAP，20+ 语言）
- [x] 2.5 保留文件图标映射（FILE_ICONS）
- [x] 2.6 配置 Monaco Editor 选项（readOnly、minimap、fontSize、lineNumbers、wordWrap、theme 等）
- [x] 2.7 实现 onChange 回调追踪修改状态（isDirty）
- [x] 2.8 保留顶部栏（文件图标、文件名、语言、行数、修改状态、关闭按钮）
- [x] 2.9 保留加载态和错误态处理

## Task 3: 验证

- [x] 3.1 TypeScript 编译通过
- [x] 3.2 Vite 构建通过（代码分割正确）
- [x] 3.3 Monaco Editor 首次加载 < 2 秒
- [x] 3.4 支持至少 20 种语言语法高亮
- [x] 3.5 TypeScript 智能补全可用
- [x] 3.6 错误诊断（红色波浪线）可用
- [x] 3.7 不影响现有文件浏览功能

---

## 任务依赖关系

```
Task 1 (依赖安装) → Task 2 (重构) → Task 3 (验证)
```
