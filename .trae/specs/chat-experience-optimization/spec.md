# 对话体验优化与设置中心 Spec

## Why
当前平台存在三个体验问题：① 新对话界面禁止新建对话按钮未做限制，用户可在空白页无限新建空对话；② 平台缺少参数设置界面，用户无法通过 UI 修改配置；③ 历史对话仅支持单条删除，缺少批量删除和回收站机制，误删无法恢复。

## What Changes
- **修复**: 新建对话按钮在空对话页面禁用，防止无限制创建空会话
- **新增**: 参数设置页面，用户可通过 UI 修改全局配置并保存
- **新增**: 历史对话批量删除功能，含复选框多选和回收站（7 天自动清理）
- **新增**: `SessionStatus.DELETED` 状态 + `deleted_at` 字段实现软删除
- **BREAKING**: 无

## Impact
- Affected specs: conversation-history-sidebar（侧边栏交互增强）
- Affected code:
  - `frontend/src/App.tsx` — 新建按钮禁用逻辑
  - `frontend/src/components/Sidebar.tsx` — 批量删除入口
  - `frontend/src/components/SessionListItem.tsx` — 复选框 + 批量模式
  - `frontend/src/components/SettingsPanel.tsx` — 新建设置面板
  - `backend/app/models.py` — Session 新增 deleted_at 字段 + DELETED 枚举
  - `backend/app/api/sessions.py` — 新增批量删除/回收站/恢复/清空端点
  - `backend/app/api/config_endpoint.py` — 新增配置读写 API
  - `config/auto_code_config.yaml` — 无需变更（已有完整配置）

---

## ADDED Requirements

### Requirement: 新对话页面禁止无限新建
系统 SHALL 在当前会话为空（无任何对话消息）时，禁用"新建对话"按钮，防止创建无意义的空会话。

#### Scenario: 空对话时按钮禁用
- **WHEN** 当前激活会话的消息列表为空（messages.length === 0）
- **THEN** 头部"新建对话"按钮呈现禁用状态（灰色、不可点击、cursor: not-allowed）

#### Scenario: 有对话时按钮可用
- **WHEN** 当前激活会话至少有一条消息
- **THEN** "新建对话"按钮恢复正常可用状态

---

### Requirement: 参数设置界面
系统 SHALL 提供参数设置页面，用户可通过 UI 查看和修改全局配置参数。

#### Scenario: 打开设置页面
- **WHEN** 用户点击侧边栏底部"设置"按钮
- **THEN** 主内容区切换为设置页面，展示所有可配置参数分组

#### Scenario: 配置分组展示
- **WHEN** 设置页面加载
- **THEN** 按分组展示配置项：服务配置、配额管控、上下文管理、架构设计、系统评测、人工审核、Git 管理、记忆库、安全管控、告警通知

#### Scenario: 修改并保存配置
- **WHEN** 用户修改某个配置项的值并点击"保存"
- **THEN** 系统调用后端 API 将变更写入 `config/auto_code_config.yaml`，并提示"配置已保存"

#### Scenario: 关闭设置页返回对话
- **WHEN** 用户在设置页面点击"返回"或侧边栏选择会话
- **THEN** 主内容区恢复对话界面

---

### Requirement: 历史对话批量删除
系统 SHALL 支持用户通过复选框多选历史对话，一键批量删除。

#### Scenario: 进入批量删除模式
- **WHEN** 用户点击侧边栏顶部的"批量删除"按钮（垃圾桶图标）
- **THEN** 所有历史会话项左侧出现复选框，侧边栏顶部出现"取消"和"删除所选"按钮

#### Scenario: 选择要删除的对话
- **WHEN** 用户在批量删除模式下点击某个会话项的复选框
- **THEN** 该会话被选中，复选框显示勾选状态；再次点击取消选中

#### Scenario: 执行批量删除
- **WHEN** 用户选中至少一个会话并点击"删除所选"
- **THEN** 弹出二次确认，确认后所有选中会话被移入回收站

#### Scenario: 取消批量删除
- **WHEN** 用户在批量删除模式下点击"取消"
- **THEN** 退出批量删除模式，所有复选框消失，恢复正常视图

---

### Requirement: 回收站功能
系统 SHALL 将删除的会话移入回收站而非直接硬删除，回收站保留 7 天后自动清理。

#### Scenario: 会话进入回收站
- **WHEN** 会话被删除（单条或批量）
- **THEN** 会话状态变更为 `deleted`，记录 `deleted_at` 时间戳，从活跃会话列表中隐藏

#### Scenario: 查看回收站
- **WHEN** 用户打开回收站面板（侧边栏底部"回收站"入口）
- **THEN** 显示所有已删除会话列表，每项显示标题、删除时间、剩余天数

#### Scenario: 恢复会话
- **WHEN** 用户在回收站中点击某会话的"恢复"按钮
- **THEN** 会话状态恢复为 `active`，重新出现在活跃会话列表中

#### Scenario: 7 天自动清理
- **WHEN** 会话的 `deleted_at` 距今超过 7 天
- **THEN** 系统后台任务自动硬删除该会话及其所有关联数据

#### Scenario: 手动清空回收站
- **WHEN** 用户点击"清空回收站"按钮并确认
- **THEN** 回收站中所有会话被永久删除
