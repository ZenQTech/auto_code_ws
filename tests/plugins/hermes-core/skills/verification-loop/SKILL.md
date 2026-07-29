---
name: verification-loop
description: 4 维度验证循环（语法/模块/集成/性能）+ 自动修复
version: 1.0.0
---

# Verification Loop

4 维度验证循环，集成 Verification Loop 服务。

## 核心能力

1. **Syntax 验证**：编译/语法检查
2. **Module 验证**：单元测试
3. **Integration 验证**：集成测试
4. **Performance 验证**：性能基线对比
5. **自动修复**：错误分类 + Agent 路由 + 3 次重试

## 使用方式

```bash
curl -X POST http://localhost:8765/api/verification/tasks \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual","commit_sha":"...","project_path":"..."}'
```
