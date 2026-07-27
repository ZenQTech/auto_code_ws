# Cycle 2 任务清单

## P0 任务（必做，本轮重点实施）

### T1: MCP (Model Context Protocol) 集成
- [ ] 后端：创建 mcp_server.py（内置 server 启动）
- [ ] 后端：创建 mcp_client.py（客户端调用封装）
- [ ] 后端：实现 4 个内置工具（read_file/write_file/run_command/list_directory）
- [ ] 后端：实现 5 个 REST API 端点
- [ ] 后端：添加数据库表 mcp_servers
- [ ] 前端：创建 McpPanel 组件（设置面板）
- [ ] 前端：集成到 SettingsPanel
- [ ] 测试：自动化测试 + 前端 E2E

### T2: 长会话压缩 (Compaction)
- [ ] 后端：实现 TokenCounter（使用 tiktoken）
- [ ] 后端：实现 SummaryGenerator（调用 LLM）
- [ ] 后端：实现 CompactionService
- [ ] 后端：实现 3 个 API 端点
- [ ] 前端：创建 CompactionIndicator 组件
- [ ] 前端：添加"压缩历史"按钮
- [ ] 测试：自动化测试 + 前端 E2E

### T3: 会话 fork / resume
- [ ] 后端：扩展 Session 模型（parent_session_id 等）
- [ ] 后端：实现 fork 算法
- [ ] 后端：实现 resume 算法
- [ ] 后端：实现 lineage 查询
- [ ] 前端：会话列表右键菜单（分叉选项）
- [ ] 前端：Lineage 可视化（可选）
- [ ] 测试：自动化测试 + 前端 E2E

## P1 任务（可选，本轮如有时间实施）

### T4: Skills 插件系统
- [ ] 数据模型：Skill
- [ ] CRUD API
- [ ] 前端 UI

### T5: AGENTS.md Memory System
- [ ] 后端：自动读取项目根 AGENTS.md
- [ ] 注入到 system prompt
- [ ] 前端：项目设置显示

## 完成标准

- 所有 P0 任务完成
- 自动化测试通过率 100%
- 前端 E2E 全部通过
- TypeScript 编译 0 错误
- Vite 构建成功

## 验收日期
预计 2026-07-27
