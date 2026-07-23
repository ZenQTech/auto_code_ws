# 修复"跳过不确定项"按钮 Bug Spec

## Why
用户点击「跳过不确定项，进入架构设计」按钮后，平台未进入架构设计阶段，而是重新调用需求澄清智能体。根因：(1) 后端 `confirm_stage("clarifying")` 在 `clarification_complete=False` 时拒绝确认；(2) 前端未检查 API 响应即继续执行；(3) 可能存在同时发送 chat/stream 请求导致澄清智能体被触发的竞态。

## What Changes
- **后端**: `confirm_stage("clarifying")` 允许用户显式跳过不确定项，移除 `clarification_complete` 强制校验
- **后端**: 确认时自动将 `clarification_complete` 设为 True
- **前端**: `onConfirm` 回调检查 clarify/confirm API 响应，失败时提示用户
- **前端**: 防止"跳过不确定项"操作触发 chat/stream 请求

## Impact
- Affected specs: `architecture-critique-iteration`
- Affected code:
  - `backend/app/services/workflow_engine.py` - confirm_stage("clarifying") 逻辑
  - `frontend/src/App.tsx` - onConfirm 回调 + handleStartDesignPhase 调用链

## MODIFIED Requirements

### Requirement: 跳过不确定项确认
原：`confirm_stage("clarifying")` 强制要求 `clarification_complete=True`
新：`confirm_stage("clarifying")` SHALL 允许用户在澄清未完成时显式确认跳过，自动将 `clarification_complete` 设为 True 并推进到 designing 阶段。

#### Scenario: 用户点击"跳过不确定项"（clarification_complete=False）
- **WHEN** 用户点击「跳过不确定项，进入架构设计」且 `clarification_complete=False`
- **THEN** 后端允许确认，自动设 `clarification_complete=True`，推进到 designing 阶段

#### Scenario: 用户点击"确认需求文档"（clarification_complete=True）
- **WHEN** 澄清已完成且用户确认
- **THEN** 行为不变，正常推进到 designing 阶段

### Requirement: 前端检查确认响应
`onConfirm` 回调 SHALL 检查 clarify/confirm API 返回的 `success` 字段，仅当 `success=True` 时才关闭弹窗并调用 `handleStartDesignPhase()`。

#### Scenario: 确认成功
- **WHEN** API 返回 `success: true`
- **THEN** 关闭弹窗，调用 `handleStartDesignPhase()`

#### Scenario: 确认失败
- **WHEN** API 返回 `success: false`
- **THEN** 保持弹窗打开，显示错误提示，不调用 `handleStartDesignPhase()`
