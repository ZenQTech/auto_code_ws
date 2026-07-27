# Cycle 3 任务清单

## P0 任务（必做，本轮重点实施）

### T6: 外部 MCP 服务器注册
- [ ] 后端：实现 ExternalMCPServer 子类（stdio / streamable_http / sse）
- [ ] 后端：实现子进程管理（asyncio.create_subprocess_exec）
- [ ] 后端：实现配置持久化（`~/.hermes/mcp_servers.json` + 项目级）
- [ ] 后端：实现 5 个 REST API 端点（register/list/remove/restart/status）
- [ ] 后端：实现 OAuth 2.0 流程（远程 server）
- [ ] 前端：创建 ExternalMcpPanel 组件
- [ ] 前端：实现注册/管理/启动/停止/查看日志 UI
- [ ] 测试：自动化测试 + 前端 E2E

### T7: SKILL.md 导入/导出
- [ ] 后端：实现 SKILL.md 解析器（pyyaml + Markdown）
- [ ] 后端：实现 4 个 API 端点（import/import-zip/export/export-zip）
- [ ] 后端：实现严格 schema 验证
- [ ] 前端：扩展 SkillsPanelContent 组件
- [ ] 前端：实现拖拽上传/下载/预览 UI
- [ ] 测试：自动化测试 + 前端 E2E

### T8: AGENTS.md 多文件类型支持
- [ ] 后端：重写 agents_md_memory 扫描逻辑
- [ ] 后端：实现 4 层加载架构（enterprise → user → project → sub-directory）
- [ ] 后端：实现多文件类型支持（AGENTS.md、CLAUDE.md、GEMINI.md、.cursorrules、README.md）
- [ ] 后端：实现优先级机制 + 冲突检测
- [ ] 前端：扩展 AgentsMdPanelContent 组件
- [ ] 前端：实现多类型选择/优先级预览 UI
- [ ] 测试：自动化测试 + 前端 E2E

### T9: Compaction 双触发机制
- [ ] 后端：实现 pre-turn trigger（消息前自动检测）
- [ ] 后端：实现 mid-turn trigger（长工具链 loop 边界）
- [ ] 后端：实现 local 路径（已有 SummaryGenerator 扩展）
- [ ] 后端：实现 remote 路径（OpenAI `/v1/responses/compact`）
- [ ] 后端：实现 pending user request 保留与 replay
- [ ] 前端：扩展 CompactionIndicator 组件
- [ ] 前端：双触发状态可视化
- [ ] 测试：自动化测试 + 前端 E2E

### T10: MCP 细粒度权限控制
- [ ] 后端：实现 3 种权限模式（auto / manual / blocked）
- [ ] 后端：实现工具级白名单/黑名单
- [ ] 后端：实现 WebSocket 实时审批流
- [ ] 后端：实现审计日志
- [ ] 前端：扩展 McpPanel 组件
- [ ] 前端：实现权限配置 + 审批中心 UI
- [ ] 测试：自动化测试 + 前端 E2E

## 完成标准

- 所有 P0 任务完成
- 自动化测试通过率 100%
- 前端 E2E 全部通过
- TypeScript 编译 0 错误
- Vite 构建成功

## 验收日期

预计 2026-07-27
