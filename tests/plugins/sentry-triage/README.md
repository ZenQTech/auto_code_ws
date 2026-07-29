# Sentry Triage Plugin

Sentry 错误自动分诊和修复 PR 生成 Plugin。

## 依赖

- `hermes-core` Plugin（必需）
- Sentry API Token

## 安装

```bash
# 1. 先安装 hermes-core
curl -X POST http://localhost:8765/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"source_path": "/path/to/hermes-core"}'

# 2. 再安装 sentry-triage
curl -X POST http://localhost:8765/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"source_path": "/path/to/sentry-triage"}'
```

## 配置

设置环境变量 `SENTRY_API_TOKEN` 和 `SENTRY_PROJECT_ID`。
