---
name: sentry-triage
description: 自动分诊 Sentry 错误并生成修复 PR
version: 1.0.0
---

# Sentry Triage

自动分析 Sentry 错误，按严重程度分组并生成修复建议。

## 核心能力

1. 错误聚合：按 fingerprint 分组
2. 严重程度评估：基于影响用户数和频率
3. 自动分配：P0/P1/P2/P3 自动分派
4. 修复建议：根据错误类型生成代码修复草案
5. PR 创建：自动 fork + 创建 PR

## 输入

- Sentry API Token
- 项目 ID
- 时间范围

## 输出

- 错误分诊报告
- 修复 PR 列表
- 趋势分析
