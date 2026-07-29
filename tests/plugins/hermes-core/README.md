# Hermes Core Plugin

Hermes 智能体调度平台的核心 Plugin。

## 包含组件

### 技能
- **memory-kernel**: 双轨记忆管理
- **verification-loop**: 4 维度验证循环

### 智能体
- **architect**: 总体架构师
- **critic**: 批判反思智能体

### 钩子
- **session-start**: 会话开始时触发
- **post-tool-use**: 工具调用后触发

## 安装

```bash
curl -X POST http://localhost:8765/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"source_path": "/path/to/hermes-core"}'
```

## 版本

v1.0.0 - 2026-07-28
