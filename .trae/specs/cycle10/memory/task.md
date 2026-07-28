# P1-8 Memory System - 任务清单

> **关联 Spec**: [./spec.md](./spec.md)
> **执行顺序**: 按依赖关系排序

---

## 阶段 1：后端核心服务（预估 4-5h）

### 1.1 数据模型与常量
- [ ] 创建 `backend/app/services/memory.py` 核心服务
- [ ] 定义 `MemoryEntity` / `MemoryRelation` / `MemoryObservation` / `CoreMemoryEntry` 数据类
- [ ] 定义 `EntityType` / `RelationType` 枚举
- [ ] 定义 `QUALITY_GATE_FORBIDDEN_PATTERNS`（拒绝 secrets/tokens）
- [ ] 定义命名校验正则 `^[a-z][a-z0-9_]+$`

### 1.2 JSONL 存储层
- [ ] 实现 `MCPMemoryStore` 类
  - [ ] `__init__`: 初始化 `~/.hermes/memory/` 目录
  - [ ] `_load_all()`: 启动时加载所有 JSONL
  - [ ] `_build_index()`: 构建内存索引（按 name / type / project）
  - [ ] `_save_atomic()`: 原子写入 JSONL（防止写入中途崩溃）
  - [ ] `create_entity(entity)`: 创建实体
  - [ ] `get_entity(name)`: 查询实体
  - [ ] `update_entity(name, updates)`: 更新实体
  - [ ] `delete_entity(name)`: 删除实体
  - [ ] `add_observation(entity_name, content)`: 添加 observation
  - [ ] `search(keywords, limit)`: 关键词搜索
  - [ ] `get_all()`: 获取整个图谱
  - [ ] 线程安全（RLock）

### 1.3 SQLite Core Memory
- [ ] `backend/app/models.py` 新增 `CoreMemory` 模型
- [ ] `backend/app/database.py` 添加自动迁移
- [ ] 实现 `CoreMemoryStore` 类
  - [ ] `create(session_id, key, value, scope)`: 创建
  - [ ] `get(session_id, key)`: 查询
  - [ ] `list_by_session(session_id)`: 列出 session 所有
  - [ ] `cleanup_expired()`: 清理过期
  - [ ] `search(session_id, keywords)`: 关键词搜索

### 1.4 Memory Router（Step 0 Pre-check）
- [ ] 实现 `MemoryRouter` 类
  - [ ] `step0_precheck(task_context)`: 优先 MCP → 降级 Core → None
  - [ ] 关键词提取（基于任务描述）
  - [ ] 相关性评分

### 1.5 memory-kernel Skill
- [ ] 实现 `MemoryKernelSkill` 类
  - [ ] `read(query)`: 关键词搜索
  - [ ] `write(entity)`: 创建（通过质量门控）
  - [ ] `update(name, observations)`: 追加 observations
  - [ ] `delete(name, force)`: 删除（public_ 保护）
  - [ ] `_pass_quality_gate(entity)`: 质量门控
  - [ ] `_validate_observation(content)`: 检查 [YYYY-MM-DD] 格式
  - [ ] `_validate_name(name)`: 命名规范

### 1.6 self-improvement Skill
- [ ] 实现 `SelfImprovementSkill` 类
  - [ ] `check_and_promote(error_solution)`: 检查是否值得晋升
  - [ ] `_count_occurrences(error_type)`: 错误频率统计
  - [ ] `_verify_solution(solution)`: 验证解决方案有效
  - [ ] `_create_pattern_entity(solution)`: 创建 pattern 实体
  - [ ] `_update_existing_pattern(name, observation)`: 更新现有 pattern

---

## 阶段 2：API 层（预估 1-2h）

### 2.1 Pydantic Schema
- [ ] 创建 `backend/app/api/memory.py` 路由
- [ ] 定义 `CreateEntityRequest` / `EntityResponse` / `SearchResponse` / `RelationRequest` 等 Pydantic 模型

### 2.2 REST 端点
- [ ] `POST /api/memory/entities` - 创建实体
- [ ] `GET /api/memory/entities` - 列出实体
- [ ] `GET /api/memory/entities/{name}` - 查询实体
- [ ] `PUT /api/memory/entities/{name}` - 更新实体
- [ ] `DELETE /api/memory/entities/{name}` - 删除实体
- [ ] `POST /api/memory/relations` - 创建关系
- [ ] `GET /api/memory/relations` - 列出关系
- [ ] `DELETE /api/memory/relations/{id}` - 删除关系
- [ ] `POST /api/memory/observations` - 添加观察
- [ ] `DELETE /api/memory/observations/{id}` - 删除观察
- [ ] `GET /api/memory/search?q=...` - 关键词搜索
- [ ] `GET /api/memory/graph` - 整个图谱
- [ ] `POST /api/memory/skill/memory-kernel` - 协议接口
- [ ] `POST /api/memory/skill/self-improvement` - 晋升接口
- [ ] `POST /api/memory/skill/memory-recall` - 检索接口
- [ ] `GET /api/memory/health` - 健康检查
- [ ] `GET /api/memory/stats` - 统计信息

### 2.3 路由注册
- [ ] `backend/app/main.py` 注册 `app.include_router(memory_router, prefix="/api/memory", tags=["memory"])`

---

## 阶段 3：测试（预估 2-3h）

### 3.1 单元测试
- [ ] `tests/test_memory_units.py`（80+ 用例）
  - [ ] 数据类测试（5 用例）
  - [ ] MCPMemoryStore 测试（20 用例）
  - [ ] CoreMemoryStore 测试（10 用例）
  - [ ] MemoryRouter 测试（8 用例）
  - [ ] memory-kernel skill 测试（15 用例）
  - [ ] self-improvement skill 测试（8 用例）
  - [ ] 质量门控测试（8 用例）
  - [ ] 命名校验测试（5 用例）
  - [ ] 并发安全测试（3 用例）

### 3.2 E2E 测试
- [ ] `tests/test_e2e_memory.sh`（50+ 断言）
  - [ ] 健康检查
  - [ ] 创建项目实体
  - [ ] 创建 pattern 实体
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

### 3.3 验证运行
- [ ] 单元测试 100% 通过
- [ ] E2E 测试 100% 通过

---

## 阶段 4：前端 UI（预估 3-4h）

### 4.1 API Hook
- [ ] `frontend/src/hooks/useMemoryApi.ts`（300 行）
  - [ ] 类型定义：MemoryEntity / MemoryRelation / MemoryObservation
  - [ ] fetchEntities / createEntity / updateEntity / deleteEntity
  - [ ] fetchRelations / createRelation / deleteRelation
  - [ ] searchMemory / fetchGraph
  - [ ] memoryKernel / selfImprovement / memoryRecall

### 4.2 组件开发
- [ ] `frontend/src/components/MemoryGraphView.tsx`（D3.js 知识图谱）
  - [ ] 节点渲染（实体）
  - [ ] 边渲染（关系）
  - [ ] 拖动/缩放
  - [ ] 节点点击查看详情
- [ ] `frontend/src/components/MemoryListPanel.tsx`
  - [ ] 实体列表
  - [ ] 类型过滤
  - [ ] 关键词搜索
- [ ] `frontend/src/components/MemoryEditor.tsx`
  - [ ] 创建/编辑表单
  - [ ] 字段校验
  - [ ] 质量门控提示
- [ ] `frontend/src/components/MemoryRecallButton.tsx`
  - [ ] 顶部入口按钮
  - [ ] recall 对话框
  - [ ] 关键词输入

### 4.3 路由与菜单
- [ ] `frontend/src/pages/MemoryPage.tsx` - 独立访问页
- [ ] `frontend/src/router/router.tsx` - 添加 /memory 路由
- [ ] `frontend/src/components/BrandHeader.tsx` - 菜单项"🧠 智能体记忆"
- [ ] `frontend/src/components/AppLayout.tsx` - 透传 onOpenMemory
- [ ] `frontend/src/App.tsx` - 跳转逻辑

### 4.4 SPA 路由兜底
- [ ] `backend/app/main.py` 确认 `/memory` 路由可访问

### 4.5 验证
- [ ] TypeScript 编译 0 errors
- [ ] 前端生产构建成功
- [ ] 浏览器端 4 个核心场景实测通过

---

## 阶段 5：文档与交付（预估 1h）

- [ ] 创建 `CYCLE10_P1_8_SUMMARY.md`
- [ ] 更新 `代码修改日志.md`（v6.9.0）
- [ ] 创建 `CYCLE10_P1_8_UI_SUMMARY.md`（UI 集成后）
- [ ] 清理测试脚本与临时文件

---

## 总预估工时

| 阶段 | 工时 |
|---|---|
| 阶段 1：后端核心 | 4-5h |
| 阶段 2：API 层 | 1-2h |
| 阶段 3：测试 | 2-3h |
| 阶段 4：前端 UI | 3-4h |
| 阶段 5：文档 | 1h |
| **总计** | **11-15h** |
