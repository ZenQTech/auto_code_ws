# VSCode 风格资源管理器 + 代码查看器 Spec

> **✅ 全部完成（与代码 v3.0.0 同步）** — 2026-06-24 同步

## Why
当前编程模式缺乏项目管理和代码浏览能力。用户在编程模式下需要选择或创建项目，查看项目文件结构，并能点击文件查看代码内容。需要实现类似 VSCode IDE 的资源管理器和代码查看器。

## What Changes
- 新增后端 workspace API（项目创建/列表、文件树遍历、文件读写）
- 新增项目选择对话框（新建项目 / 打开已有项目）
- 新增 VSCode 风格文件资源管理器（右侧可折叠树形目录）
- 新增代码查看器（支持多语言语法高亮、行号显示）
- 查看代码时聊天框缩小并移至左侧 Sidebar 区域
- **BREAKING**: 无

## Impact
- Affected specs: dual-mode-entry（编程模式增强）
- Affected code: `backend/app/api/workspace.py`(新建), `frontend/src/components/ProjectSelector.tsx`(新建), `FileExplorer.tsx`(新建), `CodeViewer.tsx`(新建), `frontend/src/App.tsx`(布局适配)

---

## ADDED Requirements

### Requirement: 项目管理
进入编程模式后，系统 SHALL 展示项目选择界面，用户可选择"新建项目"或"打开已有项目"。

#### Scenario: 进入编程模式无项目
- **WHEN** 用户进入编程模式且未选择项目
- **THEN** 显示两个按钮：「📁 新建项目」「📂 打开已有项目」
- **AND** 主对话区不可用，直到选择项目

#### Scenario: 新建项目
- **WHEN** 用户点击"新建项目"
- **THEN** 弹出输入框，输入项目名称
- **AND** 系统在服务器 `workspace/` 目录下创建项目文件夹
- **AND** 创建完成后自动进入该项目的文件浏览界面

#### Scenario: 打开已有项目
- **WHEN** 用户点击"打开已有项目"
- **THEN** 弹出已有项目列表（从 `workspace/` 目录读取）
- **AND** 用户选择后进入该项目的文件浏览界面

---

### Requirement: VSCode 风格文件资源管理器
系统 SHALL 在右侧侧边栏提供树形文件目录浏览器，功能与 VSCode 资源管理器一致。

#### Scenario: 目录树展示
- **WHEN** 用户选择了项目
- **THEN** 右侧面板显示项目根目录下的完整文件树
- **AND** 文件夹前有展开/折叠箭头图标
- **AND** 文件前有对应语言的文件图标（.py=🐍, .ts=🔷, .json=📋, .md=📝 等）

#### Scenario: 文件夹展开/折叠
- **WHEN** 用户点击文件夹左侧箭头
- **THEN** 展开或折叠子目录，带平滑过渡动画

#### Scenario: 空目录提示
- **WHEN** 项目目录为空
- **THEN** 资源管理器显示"项目为空，等待代码生成..."

#### Scenario: 文件排序
- **WHEN** 显示目录内容
- **THEN** 文件夹排在文件前面，各自按字母序排列

---

### Requirement: 代码查看器
系统 SHALL 支持在前端查看任意代码文件内容，提供语法高亮和行号。

#### Scenario: 点击文件查看代码
- **WHEN** 用户在资源管理器中单击文件
- **THEN** 主内容区显示代码查看器，包含：行号列（左）、代码内容（右，语法高亮）
- **AND** 资源管理器中被选中的文件高亮

#### Scenario: 语法高亮
- **WHEN** 显示代码文件
- **THEN** 根据文件扩展名自动选择语言（.py/.ts/.tsx/.js/.json/.yaml/.md/.html/.css/.cpp/.h 等）
- **AND** 关键字、字符串、注释、数字等分别着色

#### Scenario: 文件类型支持
- **WHEN** 打开不支持的文件类型（图片、二进制等）
- **THEN** 显示"不支持预览该文件类型"提示

---

### Requirement: 查看代码时布局调整
当用户查看代码文件时，聊天框 SHALL 缩小并移至左侧历史会话栏区域。

#### Scenario: 打开文件时的布局
- **WHEN** 用户点击文件查看代码
- **THEN** 右侧资源管理器保持展开
- **AND** 中间区域变为代码查看器
- **AND** 左侧 Sidebar 区域上方显示聊天框（紧凑模式）
- **AND** 左侧 Sidebar 区域下方显示历史会话列表

#### Scenario: 关闭文件恢复布局
- **WHEN** 用户关闭代码查看器（点击关闭按钮或资源管理器的空白区域）
- **THEN** 布局恢复：左侧 Sidebar 恢复全高度会话列表，中间恢复全宽对话区
