# Cycle 2 验收清单

## T1: MCP 集成
- [ ] MCP server 启动后 `/api/mcp/tools` 列出内置工具
- [ ] 至少 4 个内置工具：read_file / write_file / run_command / list_directory
- [ ] `/api/mcp/servers` GET 端点正常
- [ ] `/api/mcp/servers` POST 注册新 server 正常
- [ ] `/api/mcp/tools/call` POST 端点正常
- [ ] LLM 能够通过 MCP 工具调用读取文件
- [ ] 工具调用结果显示在前端
- [ ] 工具调用错误正确处理
- [ ] 前端设置面板显示 MCP server 列表
- [ ] 前端测试：触发文件读取成功

## T2: Compaction 长会话压缩
- [ ] TokenCounter 准确（误差 < 5%）
- [ ] 消息数 > 50 自动触发压缩
- [ ] 压缩后 token 数 < 15K
- [ ] 压缩摘要包含关键决策点
- [ ] 最近 10 条消息保留
- [ ] `/api/sessions/{id}/compact` 端点正常
- [ ] `/api/sessions/{id}/tokens` 端点正常
- [ ] `/api/compaction/config` 端点正常
- [ ] 前端显示"压缩历史"按钮
- [ ] 前端显示压缩进度和结果
- [ ] 压缩后能继续正常对话

## T3: 会话 fork / resume
- [ ] Session 模型扩展完成（parent_session_id 等字段）
- [ ] `/api/sessions/{id}/fork` 端点正常
- [ ] Fork 创建新会话，复制消息
- [ ] Fork 后两个会话独立演化
- [ ] `/api/sessions/{id}/resume` 端点正常
- [ ] Resume 恢复完整历史
- [ ] `/api/sessions/{id}/lineage` 端点正常
- [ ] 前端会话列表右键菜单显示"分叉"选项
- [ ] 前端点击分叉成功创建新会话
- [ ] 前端新会话包含原会话前 N 条消息

## 全局验收
- [ ] TypeScript 编译 0 错误
- [ ] Vite 生产构建成功
- [ ] 后端所有 API 端点测试通过
- [ ] 自动化测试覆盖率 ≥ 90%
- [ ] 前端 E2E 测试通过率 100%
- [ ] 数据库迁移成功
- [ ] 代码注释完整
- [ ] 代码修改日志已更新

## 通过条件
所有 P0 任务全部通过，方可视为本轮循环完成。
