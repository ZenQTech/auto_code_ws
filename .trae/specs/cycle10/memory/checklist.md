# P1-8 Memory System - 验收清单

> **关联 Spec**: [./spec.md](./spec.md)
> **关联 Task**: [./task.md](./task.md)

## A. 后端核心服务

### A.1 数据模型
- [ ] `MemoryEntity` 数据类完整（name, entity_type, project, observations, metadata, created_at, updated_at）
- [ ] `MemoryRelation` 数据类完整（source, target, relation_type, weight, created_at）
- [ ] `MemoryObservation` 数据类完整（entity_name, content, source, confidence, created_at）
- [ ] `CoreMemoryEntry` 数据类完整（session_id, key, value, scope, expires_at, created_at）
- [ ] 枚举类型：EntityType, RelationType, Source

### A.2 JSONL 存储
- [ ] `MCPMemoryStore` 类完整实现
- [ ] 启动时自动加载所有 JSONL 到内存
- [ ] 内存索引：按 name / type / project
- [ ] 原子写入（防崩溃数据丢失）
- [ ] 线程安全（RLock）
- [ ] 存储路径固定 `~/.hermes/memory/`
- [ ] entities.jsonl / relations.jsonl / observations.jsonl 三个文件

### A.3 SQLite Core Memory
- [ ] `CoreMemory` 模型定义
- [ ] 自动迁移在 database.py 中
- [ ] `CoreMemoryStore` CRUD + 过期清理
- [ ] 按 session_id 隔离

### A.4 Memory Router
- [ ] Step 0 Pre-check 优先级：MCP → Core → None
- [ ] 关键词提取
- [ ] 相关性评分

### A.5 memory-kernel Skill
- [ ] read / write / update / delete 操作完整
- [ ] 质量门控：必填 [YYYY-MM-DD] + secrets 拒绝
- [ ] public_ 前缀保护
- [ ] 命名规范校验

### A.6 self-improvement Skill
- [ ] 错误频率统计（≥ 3 次触发）
- [ ] 解决方案验证
- [ ] 创建/更新 pattern 实体
- [ ] 跨项目隔离

## B. API 层

### B.1 Pydantic Schema
- [ ] CreateEntityRequest 字段校验（min_length, max_length, regex）
- [ ] EntityResponse 包含完整字段
- [ ] SearchResponse 包含 source 标识
- [ ] 错误码 400/404/409/422/500

### B.2 REST 端点（17 个）
- [ ] POST /api/memory/entities
- [ ] GET /api/memory/entities
- [ ] GET /api/memory/entities/{name}
- [ ] PUT /api/memory/entities/{name}
- [ ] DELETE /api/memory/entities/{name}
- [ ] POST /api/memory/relations
- [ ] GET /api/memory/relations
- [ ] DELETE /api/memory/relations/{id}
- [ ] POST /api/memory/observations
- [ ] DELETE /api/memory/observations/{id}
- [ ] GET /api/memory/search
- [ ] GET /api/memory/graph
- [ ] POST /api/memory/skill/memory-kernel
- [ ] POST /api/memory/skill/self-improvement
- [ ] POST /api/memory/skill/memory-recall
- [ ] GET /api/memory/health
- [ ] GET /api/memory/stats

### B.3 路由注册
- [ ] main.py v6.9.0 注册 memory 路由

## C. 测试覆盖

### C.1 单元测试（80+ 用例）
- [ ] 数据类测试（5 用例）
- [ ] MCPMemoryStore（20 用例）
- [ ] CoreMemoryStore（10 用例）
- [ ] MemoryRouter（8 用例）
- [ ] memory-kernel（15 用例）
- [ ] self-improvement（8 用例）
- [ ] 质量门控（8 用例）
- [ ] 命名校验（5 用例）
- [ ] 并发安全（3 用例）

### C.2 E2E 测试（50+ 断言）
- [ ] 健康检查
- [ ] 创建项目/pattern/preference 实体
- [ ] 创建关系
- [ ] 添加观察
- [ ] 关键词搜索
- [ ] 列出图谱
- [ ] 更新实体
- [ ] 删除实体
- [ ] 跨会话保留
- [ ] 质量门控拒绝
- [ ] public_ 保护
- [ ] self-improvement 触发
- [ ] 异常路径

### C.3 测试通过率
- [ ] 单元测试 100% 通过
- [ ] E2E 测试 100% 通过

## D. 前端 UI

### D.1 API Hook
- [ ] useMemoryApi.ts 完整封装 17 个端点
- [ ] TypeScript 类型定义完整
- [ ] 错误处理统一

### D.2 组件
- [ ] MemoryGraphView（D3.js 知识图谱可视化）
  - [ ] 节点渲染
  - [ ] 边渲染
  - [ ] 拖动/缩放
  - [ ] 节点点击查看详情
- [ ] MemoryListPanel
  - [ ] 实体列表
  - [ ] 类型过滤
  - [ ] 关键词搜索
- [ ] MemoryEditor
  - [ ] 创建/编辑表单
  - [ ] 字段校验
  - [ ] 质量门控提示
- [ ] MemoryRecallButton
  - [ ] 顶部入口
  - [ ] recall 对话框
  - [ ] 关键词输入

### D.3 路由与菜单
- [ ] /memory 路由可访问
- [ ] BrandHeader 菜单项"🧠 智能体记忆"
- [ ] SPA 兜底正常

### D.4 验证
- [ ] TypeScript 编译 0 errors
- [ ] 前端生产构建成功
- [ ] 浏览器端实测 4 个核心场景

## E. 性能与安全

### E.1 性能
- [ ] 单实体查询 < 10ms
- [ ] 关键词搜索 < 100ms（1000 实体）
- [ ] 整图序列化 < 200ms
- [ ] 文件加载 < 500ms
- [ ] 并发写入 10 并发无丢失
- [ ] 实体容量 100,000+

### E.2 安全
- [ ] 路径白名单 `~/.hermes/memory/`
- [ ] 命名校验正则
- [ ] 内容过滤（拒绝 secrets）
- [ ] public_ 保护
- [ ] 跨项目隔离
- [ ] 线程安全（RLock）

## F. 文档与交付

- [ ] CYCLE10_P1_8_SUMMARY.md 创建
- [ ] CYCLE10_P1_8_UI_SUMMARY.md 创建
- [ ] 代码修改日志.md 更新到 v6.9.0
- [ ] 测试脚本清理
- [ ] 最终验证清单完成

## G. 浏览器端实测（使用 MCP 浏览器工具）

### G.1 MemoryGraphView
- [ ] 打开 /memory 路由
- [ ] 验证图谱渲染
- [ ] 点击节点查看详情
- [ ] 拖动节点测试交互

### G.2 MemoryListPanel
- [ ] 实体列表显示
- [ ] 搜索功能
- [ ] 类型过滤

### G.3 MemoryEditor
- [ ] 创建实体表单
- [ ] 编辑现有实体
- [ ] 删除实体（带确认）

### G.4 MemoryRecallButton
- [ ] 顶部按钮点击
- [ ] 弹出 recall 对话框
- [ ] 输入查询词
- [ ] 显示相关实体

## 最终验收

- [ ] 所有自动化测试 100% 通过
- [ ] 前端网页测试 4 个场景全部通过
- [ ] TypeScript 编译 0 errors
- [ ] 前端生产构建成功
- [ ] 性能指标达标
- [ ] 安全要求全部满足
- [ ] 文档完整
- [ ] 代码提交到 git
