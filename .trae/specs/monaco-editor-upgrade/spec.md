# Monaco Editor 升级 CodeViewer Spec

> **来源**: [project-optimization-roadmap Task 6](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **优先级**: P1（支撑能力，独立开发）
> **依赖**: 无

## Why

当前 CodeViewer 使用正则表达式实现语法高亮，功能有限（无智能补全、无错误诊断、无 Minimap）。借鉴 OpenCode（内置 LSP）和 OMC（LSP 集成）的设计，将 CodeViewer 升级为 Monaco Editor，提供 IDE 级代码查看与编辑体验。

## What Changes

- **安装 @monaco-editor/react** 依赖
- **重构 CodeViewer.tsx**：从正则语法高亮升级为 Monaco Editor 封装
- **支持功能**：20+ 语言语法高亮、智能补全、错误诊断、Minimap、多 Tab 编辑
- **性能优化**：代码分割 + 懒加载

## Impact

- Affected specs: 无
- Affected code:
  - `frontend/package.json` — 新增依赖
  - `frontend/src/components/CodeViewer.tsx` — 重构

---

## ADDED Requirements

### Requirement: Monaco Editor 集成

系统 SHALL 将 `frontend/src/components/CodeViewer.tsx` 重构为使用 Monaco Editor。

#### Scenario: 依赖安装
- **WHEN** 系统构建前端
- **THEN** `@monaco-editor/react` SHALL 已安装为项目依赖

#### Scenario: 懒加载
- **WHEN** CodeViewer 组件首次渲染
- **THEN** Monaco Editor SHALL 通过 `React.lazy` 懒加载
- **AND** 加载期间显示骨架屏（旋转加载器 + "加载编辑器..."文字）

#### Scenario: 语法高亮
- **WHEN** 用户打开任意代码文件
- **THEN** Monaco Editor SHALL 根据文件扩展名自动选择语言模式：
  - `.py` → python
  - `.ts/.tsx` → typescript
  - `.js/.jsx` → javascript
  - `.json` → json
  - `.md` → markdown
  - `.html` → html
  - `.css` → css
  - `.yaml/.yml` → yaml
  - `.cpp/.c/.h/.hpp` → cpp
  - `.sh/.bash` → shell
  - `.xml` → xml
  - `.toml/.cfg/.ini` → ini
  - `.dockerfile` → dockerfile
  - `.rs` → rust
  - `.go` → go
  - `.java` → java
  - 其他 → plaintext

#### Scenario: 智能补全
- **WHEN** 用户在编辑器中输入代码
- **THEN** Monaco Editor SHALL 提供：
  - 关键字补全（showKeywords: true）
  - 代码片段补全（showSnippets: true）
  - TypeScript 内置语言服务补全

#### Scenario: 错误诊断
- **WHEN** 代码存在语法错误
- **THEN** Monaco Editor SHALL 显示红色波浪线标记
- **AND** 悬停时显示错误详情

#### Scenario: Minimap
- **WHEN** 代码文件较长
- **THEN** Monaco Editor SHALL 在右侧显示 Minimap（代码缩略图）
- **AND** 用户可通过 Minimap 快速导航

#### Scenario: 编辑器配置
- **WHEN** Monaco Editor 渲染
- **THEN** SHALL 使用以下配置：
  - `readOnly: false` — 允许编辑
  - `minimap: { enabled: true }` — 启用 Minimap
  - `fontSize: 13` — 字体大小
  - `lineNumbers: 'on'` — 显示行号
  - `scrollBeyondLastLine: false` — 不滚动超出最后一行
  - `wordWrap: 'on'` — 自动换行
  - `automaticLayout: true` — 自动布局
  - `tabSize: 2` — Tab 大小
  - `renderWhitespace: 'selection'` — 选中时显示空白字符
  - `bracketPairColorization: { enabled: true }` — 括号对着色
  - `theme: 'vs-dark'` — 深色主题

#### Scenario: 顶部栏保留
- **WHEN** CodeViewer 渲染
- **THEN** 顶部栏 SHALL 保留：
  - 文件图标（基于扩展名的 emoji）
  - 文件名
  - 语言标识
  - 行数统计
  - 修改状态指示（● 已修改）
  - 关闭按钮

#### Scenario: 修改状态追踪
- **WHEN** 用户在编辑器中修改代码
- **THEN** `onChange` 回调 SHALL 检测内容变化
- **AND** 设置 `isDirty` 状态为 true
- **AND** 顶部栏显示"● 已修改"指示

#### Scenario: 加载态与错误态
- **WHEN** 文件内容加载中
- **THEN** 显示骨架屏（加载器 + "加载中..."）
- **WHEN** 文件加载失败
- **THEN** 显示错误信息（红色警告图标 + 错误描述）

---

## MODIFIED Requirements

### Requirement: CodeViewer 重构（原 frontend/src/components/CodeViewer.tsx）

**原行为**: 使用正则表达式实现语法高亮，无智能补全、无错误诊断。

**新行为**: 使用 Monaco Editor 提供 IDE 级代码查看与编辑。

**变更原因**: 提升代码查看体验，支持智能补全和错误诊断。

**迁移**: 保留原有 Props 接口（project, filePath, onClose），保留文件图标映射和语言检测逻辑，仅替换渲染层。

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| Monaco Editor 包体积大 | 前端加载性能 | 中 | 代码分割 + React.lazy 懒加载 |
| 首次加载慢 | 用户体验 | 中 | 加载骨架屏 + CDN 加速 |
| 与现有 UI 风格不一致 | 视觉一致性 | 低 | vs-dark 主题与现有深色主题匹配 |

## 成功标准

- Monaco Editor 首次加载 < 2 秒
- 支持至少 20 种语言语法高亮
- TypeScript 智能补全可用
- 错误诊断（红色波浪线）可用
- 不影响现有文件浏览功能
