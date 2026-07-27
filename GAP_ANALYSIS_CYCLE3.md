# Cycle 3 功能差距分析报告

**分析周期**: Cycle 3
**分析时间**: 2026-07-27
**分析方法**: 基于 Cycle 3 调研报告 + Cycle 2 已实现功能对照
**目标**: 识别本项目在 Codex v0.146+ / TRAE v3.5.69+ 高级功能上的差距

---

## 1. 总体功能对比

| 功能维度 | Codex v0.146+ | TRAE v3.5.69+ | 本项目（Cycle 2） | Cycle 3 目标 |
|---------|--------------|--------------|------------------|-------------|
| Agent Loop | ✅ 完整 | ✅ 完整 | ✅ 基础 | ✅ 增强 |
| Compaction | ✅ 双触发 | ✅ hybrid | ✅ 单一触发 | ✅ 双触发 |
| MCP | ✅ 6 子命令 | ✅ 完整 | ✅ 仅内置 | ✅ 完整 |
| Skills | ✅ 渐进式 | ✅ 完整 | ✅ CRUD | ✅ 导入导出 |
| Rules 多层级 | ✅ 4 层 | ✅ 3 层 | ✅ 1 层 | ✅ 4 层 |
| OAuth MCP | ✅ 完整 | ✅ 完整 | ❌ 无 | ✅ 完整 |
| Plan/Spec Mode | ✅ /plan | ✅ /spec | ✅ Plan only | ✅ Spec mode |
| Sub-agent | ✅ context:fork | ✅ SOLO Agent | ❌ 无 | ✅ 基础 |

**当前覆盖率**: 约 78%
**Cycle 3 目标覆盖率**: 95%+

---

## 2. P0 缺失功能（必做，本轮重点）

### 2.1 T6: 外部 MCP 服务器注册

**现状**:
- 仅支持内置 in-process MCP server（hermes-builtin）
- 已预留 `external_servers` 字段和 `register_external_server()` API
- 客户端空目录未实现

**Codex 参考**:
- `codex mcp add <name> -- npx -y @scope/server`（stdio）
- `codex mcp add <name> --url https://...`（HTTP）
- 6 个子命令：add/list/get/remove/login/logout

**TRAE 参考**:
- `.trae/mcp.json` 项目级配置
- 完整 OAuth 授权流程（v3.5.51）

**本项目实现目标**:
1. 实现 `POST /api/mcp/servers` 注册 stdio 类型
2. 实现 `POST /api/mcp/servers` 注册 streamable_http/sse 类型
3. 实现 `POST /api/mcp/servers/{id}/restart` 重启子进程
4. 实现 `GET /api/mcp/servers/{id}/status` 健康检查
5. 实现配置持久化（`~/.hermes/mcp_servers.json`）
6. 前端面板：注册/管理/启动/停止/查看日志

**影响范围**:
- 后端: `backend/app/services/mcp/`（已有 4 个文件 + 需新增 2 个）
- 后端 API: `backend/app/api/mcp.py`（已有 + 需扩展 4 个端点）
- 前端: `McpPanel.tsx`（已有 + 需扩展外部 server 管理 UI）
- 数据库: 新增 `mcp_external_servers` 表

**风险等级**: 🟡 中
- 子进程管理 + 资源回收

### 2.2 T7: SKILL.md 导入/导出

**现状**:
- 仅有 CRUD（create/read/update/delete）
- 存储格式：内存数据库字段
- 无文件格式标准

**Codex 参考**:
- `SKILL.md` 格式：YAML 头 + Markdown 体
- `npx skills add <owner>/<repo>` 导入
- `npx skills export` 导出

**Vercel Skills CLI 生态**:
- 20,000+ stars
- 27+ 代理支持

**本项目实现目标**:
1. 实现 `POST /api/skills/import` 上传 SKILL.md
2. 实现 `POST /api/skills/import-zip` 批量导入
3. 实现 `GET /api/skills/{id}/export` 导出为 SKILL.md
4. 实现 `GET /api/skills/export-zip` 批量导出
5. 严格字段验证（YAML schema）
6. 前端面板：拖拽上传/下载/预览

**影响范围**:
- 后端: `backend/app/services/skills.py`（已有 + 需扩展 4 个方法）
- 后端 API: `backend/app/api/skills.py`（已有 + 需扩展 4 个端点）
- 前端: `SkillsPanelContent.tsx`（已有 + 需扩展导入/导出 UI）
- 新增: `SKILL.md` 解析器（pyyaml）

**风险等级**: 🟢 低
- 文件解析 + 验证

### 2.3 T8: AGENTS.md 多文件类型支持

**现状**:
- 仅支持 `AGENTS.md` 单文件类型
- 扫描深度 3 层
- 注入到 system prompt

**Codex + Claude 参考**:
- 4 层加载架构（enterprise → user → project → sub-directory）
- 多文件类型：AGENTS.md、CLAUDE.md、GEMINI.md、README.md
- 优先级：override > sub-directory > project > user

**本项目实现目标**:
1. 支持多文件类型：AGENTS.md、CLAUDE.md、GEMINI.md、.cursorrules、README.md
2. 实现 4 层加载架构
3. 优先级机制：sub-directory > project > user
4. 冲突检测：同名文件警告
5. 前端面板：多文件类型选择/优先级预览

**影响范围**:
- 后端: `backend/app/services/agents_md_memory.py`（已有 + 需重写扫描逻辑）
- 后端 API: `backend/app/api/agents_md.py`（已有 + 需扩展 2 个端点）
- 前端: `AgentsMdPanelContent.tsx`（已有 + 需扩展多类型支持）
- 新增: `rules_resolver.py`（层级合并器）

**风险等级**: 🟡 中
- 多文件类型冲突解决

### 2.4 T9: Compaction 双触发机制

**现状**:
- 单一手动触发（API: `POST /api/sessions/{id}/compact`）
- 单一 hybrid 策略
- 一次性压缩

**Codex v0.139+ 参考**:
- Pre-turn trigger：用户发送消息前静默触发
- Mid-turn trigger：长工具链 loop 边界触发
- 双路径：local（客户端 LLM 摘要）+ remote（OpenAI `/v1/responses/compact`）

**本项目实现目标**:
1. 实现 pre-turn trigger（自动，无感）
2. 实现 mid-turn trigger（长工具链检测）
3. 实现 local 路径（已有 `SummaryGenerator` 扩展）
4. 实现 remote 路径（对接 OpenAI 压缩 API）
5. 保留 pending user request，replay 到压缩后上下文
6. 前端面板：双触发状态可视化

**影响范围**:
- 后端: `backend/app/services/compaction.py`（已有 + 需扩展触发器）
- 后端 API: `backend/app/api/compaction.py`（已有 + 需扩展配置）
- 前端: `CompactionIndicator.tsx`（已有 + 需扩展双触发状态）
- HermesService: 集成 pre-turn 触发器

**风险等级**: 🟡 中
- 触发时机的精确性 + 数据完整性

### 2.5 T10: MCP 细粒度权限控制

**现状**:
- 所有内置工具自由调用
- 无审批机制
- 无审计日志

**Codex v0.143+ 参考**:
- Approval modes: auto / manual / blocked
- 工具级权限配置
- 单次放行/永久阻止

**本项目实现目标**:
1. 实现 3 种权限模式：auto / manual / blocked
2. 工具级白名单/黑名单
3. 危险操作（write_file、run_command）默认 manual
4. WebSocket 实时审批流
5. 审计日志：所有调用记录
6. 前端面板：权限配置 + 审批中心

**影响范围**:
- 后端: `backend/app/services/mcp/`（已有 + 需新增 permissions 模块）
- 后端 API: `backend/app/api/mcp.py`（已有 + 需扩展 5 个端点）
- 前端: `McpPanel.tsx`（已有 + 需扩展权限配置 UI）
- WebSocket: 新增审批通道

**风险等级**: 🟠 中高
- 权限边界 + 用户体验平衡

---

## 3. P1 推荐功能（可选，本轮时间允许则实施）

### 3.1 T11: OAuth 2.0 集成 MCP
- 远程 server 自动 OAuth 流程
- Token 加密存储
- 自动刷新机制

### 3.2 T12: Spec mode 集成
- `spec.md/tasks.md/checklist.md` 自动生成
- 与 Loop Engineering 平台深度集成
- 状态自动同步

### 3.3 T13: Sub-agent 调度框架
- 独立上下文子代理
- 主代理 ↔ 子代理通信
- 任务分解与编排

---

## 4. 验收标准

### 4.1 功能验收

- [ ] **T6**: 外部 MCP server 注册成功率 100%，stdio 启动 ≤ 5s，HTTP 健康检查 ≤ 1s
- [ ] **T7**: SKILL.md 导入/导出格式兼容 Vercel skills CLI，10 个 skills 批量导入 ≤ 3s
- [ ] **T8**: 多文件类型扫描深度 3 层，4 层优先级准确，冲突检测 100%
- [ ] **T9**: Pre-turn 触发器延迟 < 100ms，mid-turn 触发准确率 ≥ 95%
- [ ] **T10**: 3 种权限模式切换正常，审计日志完整率 100%

### 4.2 UI 验收

- [ ] 每个功能都有独立的弹窗/面板
- [ ] 关闭按钮工作正常
- [ ] 数据加载状态显示
- [ ] TypeScript 编译 0 错误
- [ ] Vite 生产构建成功

### 4.3 测试验收

- [ ] 自动化 E2E 测试 100% 通过
- [ ] 单元测试覆盖率 ≥ 90%
- [ ] 浏览器 E2E 测试通过
- [ ] MCP 浏览器实际操作验证

### 4.4 集成验收

- [ ] 前后端 API 100% 对接
- [ ] 数据库迁移成功
- [ ] 性能指标：API P95 < 500ms

---

## 5. 任务依赖关系

```
T6 (外部 MCP) ─── T10 (权限控制)
   │                  │
   └──────┬───────────┘
          ↓
T7 (Skills 导入) ─── T8 (Rules 多层)
                          │
                          ↓
                       T9 (Compaction 双触发)
```

**执行顺序**: T6 → T10 → T7 → T8 → T9

---

## 6. 总结

**本轮循环重点**: 实现 5 个 P0 功能（T6-T10），使本项目达到 **95%+ codex/trae 等价能力**。

**关键技术决策**:
- T6 复用现有 MCPServer，仅添加 ExternalServer 子类
- T7 新增 SKILL.md 解析器，兼容 Vercel 生态
- T8 重写扫描逻辑，支持 4 层优先级
- T9 集成 pre-turn 触发器到 HermesService
- T10 新增 permissions 模块 + WebSocket 审批流

**预期收益**:
- API 端点新增 20+ 个
- 前端组件新增/扩展 5+ 个
- 自动化测试新增 30+ 个
- 文档更新 5 份

---

**报告生成时间**: 2026-07-27
**报告版本**: v1.0.0
**下一阶段**: 创建 Spec 任务文档
