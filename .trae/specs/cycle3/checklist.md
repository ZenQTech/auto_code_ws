# Cycle 3 验收清单

## T6: 外部 MCP 服务器注册
- [ ] stdio 类型 server 注册成功（5s 内启动）
- [ ] streamable_http 类型 server 注册成功
- [ ] sse 类型 server 注册成功（已废弃但保留兼容）
- [ ] 子进程崩溃自动重启
- [ ] 配置持久化到 `~/.hermes/mcp_servers.json`
- [ ] `/api/mcp/servers` GET 端点正常
- [ ] `/api/mcp/servers` POST 注册新 server 正常
- [ ] `/api/mcp/servers/{id}` DELETE 注销 server 正常
- [ ] `/api/mcp/servers/{id}/restart` POST 重启正常
- [ ] `/api/mcp/servers/{id}/status` GET 健康检查正常
- [ ] 前端显示所有外部 server 状态
- [ ] 前端测试：注册/启动/停止/注销成功

## T7: SKILL.md 导入/导出
- [ ] SKILL.md 格式正确解析（YAML 头 + Markdown 体）
- [ ] 字段验证：name、description、allowed-tools、model 等
- [ ] 单个 SKILL.md 导入成功
- [ ] 批量 zip 包导入成功
- [ ] 单个 skill 导出为 SKILL.md 正确
- [ ] 批量 zip 导出包含所有 skill
- [ ] 与 Vercel skills 生态格式兼容
- [ ] `/api/skills/import` POST 端点正常
- [ ] `/api/skills/import-zip` POST 端点正常
- [ ] `/api/skills/{id}/export` GET 端点正常
- [ ] `/api/skills/export-zip` GET 端点正常
- [ ] 前端拖拽上传 SKILL.md 成功
- [ ] 前端下载 SKILL.md 成功
- [ ] 前端预览导入内容

## T8: AGENTS.md 多文件类型支持
- [ ] 支持 AGENTS.md 文件类型
- [ ] 支持 CLAUDE.md 文件类型
- [ ] 支持 GEMINI.md 文件类型
- [ ] 支持 .cursorrules 文件类型
- [ ] 支持 README.md 文件类型（特定章节）
- [ ] 4 层加载架构：enterprise > user > project > sub-directory
- [ ] 优先级：sub-directory > project > user
- [ ] 冲突检测：同名文件警告
- [ ] 扫描深度 3 层
- [ ] 注入到 system prompt 正确
- [ ] `/api/rules/scan` POST 端点正常
- [ ] `/api/rules/list` GET 端点正常
- [ ] 前端显示多类型规则文件
- [ ] 前端预览合并后的注入内容
- [ ] 前端按优先级排序

## T9: Compaction 双触发机制
- [ ] Pre-turn trigger：消息前自动检测 token 数
- [ ] Pre-turn trigger：超阈值时静默压缩
- [ ] Mid-turn trigger：长工具链 loop 边界检测
- [ ] Mid-turn trigger：超阈值时压缩 + replay
- [ ] Local 压缩路径：客户端 LLM 摘要
- [ ] Remote 压缩路径：OpenAI `/v1/responses/compact`
- [ ] Pending user request 保留
- [ ] 压缩后上下文注入正确
- [ ] 自动触发延迟 < 100ms
- [ ] Mid-turn 触发准确率 ≥ 95%
- [ ] 前端显示双触发状态
- [ ] 前端压缩历史可视化

## T10: MCP 细粒度权限控制
- [ ] 3 种权限模式：auto / manual / blocked
- [ ] 工具级白名单配置
- [ ] 工具级黑名单配置
- [ ] 危险操作（write_file、run_command）默认 manual
- [ ] WebSocket 实时审批通知
- [ ] 单次放行机制
- [ ] 永久阻止机制
- [ ] 审计日志：所有调用记录
- [ ] `/api/mcp/permissions` GET 端点正常
- [ ] `/api/mcp/permissions` PUT 更新正常
- [ ] `/api/mcp/tools/{name}/approve` 单次放行
- [ ] `/api/mcp/tools/{name}/block` 永久阻止
- [ ] `/api/mcp/audit-log` GET 端点正常
- [ ] 前端权限配置 UI
- [ ] 前端审批中心
- [ ] 前端审计日志查看

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
