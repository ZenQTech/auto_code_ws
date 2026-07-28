# P3-1 /import - 任务清单

> **任务 ID**: P3-1
> **关联**: [spec.md](spec.md)
> **日期**: 2026-07-28
> **状态**: 📋 待执行

---

## 任务分解

### 阶段 1: 核心服务实现（预计 4-6h）

- [ ] T1.1 创建 `backend/app/core/import_converters/base.py` 基础抽象（~80 行）
  - BaseConverter ABC
  - 通用路径校验
  - 文件大小限制
  
- [ ] T1.2 创建 `backend/app/core/import_converters/claude_code.py`（~200 行）
  - detect: 扫描 ~/.claude/
  - list_data: 列出 settings/MCP/commands/sessions/memories
  - convert: settings.json → config.toml 转换
  - get_version: 从 package.json 读取
  
- [ ] T1.3 创建 `backend/app/core/import_converters/cursor.py`（~200 行）
  - detect: 扫描 ~/.cursor/
  - convert: .cursor/mcp.json → 内部 MCP 格式
  
- [ ] T1.4 创建 `backend/app/core/import_converters/codex.py`（~150 行）
  - detect: 扫描 ~/.codex/
  - convert: config.toml → JSON
  - AGENTS.md 合并策略
  
- [ ] T1.5 创建 `backend/app/core/import_converters/trae.py`（~150 行）
  - detect: 扫描 ~/.trae/
  - YAML 配置解析
  
- [ ] T1.6 创建 `backend/app/services/import_service.py` 核心服务（~800 行）
  - ImportService 主类
  - 4 源检测
  - dry-run 预览
  - 异步执行（threading + 进度回调）
  - 失败回滚
  - JSONL 持久化
  - 路径白名单

### 阶段 2: REST API（预计 1-2h）

- [ ] T2.1 创建 `backend/app/api/import.py`（~250 行）
  - 8 个端点（health/detect/preview/run/status/list/cancel/formats）
  - Pydantic 模型（ImportSource/DataType/ImportStatus/DetectedSource/ImportTask）
  - 错误处理 + 路径白名单

- [ ] T2.2 注册路由到 `backend/app/main.py`
  - v6.12.0 路由注册
  - /api/import prefix + import tag

### 阶段 3: 单元测试（预计 2-3h）

- [ ] T3.1 创建 `tests/test_import_units.py`（~700 行 60+ 用例）
  - TestImportService（15 用例）
  - TestClaudeCodeConverter（10 用例）
  - TestCursorConverter（10 用例）
  - TestCodexConverter（8 用例）
  - TestTraeConverter（8 用例）
  - TestPathWhitelist（5 用例）
  - TestRollback（4 用例）

### 阶段 4: E2E 测试（预计 1-2h）

- [ ] T4.1 创建 `tests/test_e2e_import.sh`（~350 行 40+ 断言）
  - 10 个测试模块
  - mock 数据源（fixtures）
  - 完整工作流验证

### 阶段 5: 前端 UI（预计 3-4h）

- [ ] T5.1 创建 `frontend/src/hooks/useImportApi.ts`（~200 行）
  - 封装 8 个 API 端点
  - 完整 TypeScript 类型
  
- [ ] T5.2 创建 `frontend/src/components/ImportPanel.tsx`（~600 行）
  - 4 步向导（检测/预览/确认/执行）
  - 进度条 + 实时日志
  - 失败回滚按钮
  - 状态徽章
  
- [ ] T5.3 创建 `frontend/src/pages/ImportPage.tsx`（~80 行）
  - 独立访问页面
  - ?project= 参数解析
  
- [ ] T5.4 修改 `frontend/src/router/router.tsx`
  - /import 路由 + React.lazy 懒加载
  
- [ ] T5.5 修改 `frontend/src/components/BrandHeader.tsx`
  - 新增 "📥 跨平台导入" 菜单项

### 阶段 6: 文档（预计 1h）

- [ ] T6.1 创建 `CYCLE11_P3_1_SUMMARY.md`
  - 完整总结报告
  
- [ ] T6.2 更新 `代码修改日志.md`
  - v6.12.0 记录
  - P3-1 实现细节 + 测试结果

### 阶段 7: 浏览器端测试（预计 1h）

- [ ] T7.1 启动 dev server + 验证 4 步向导
- [ ] T7.2 测试 mock 数据源
- [ ] T7.3 测试失败回滚 UI
- [ ] T7.4 验证 0 TypeScript errors + npm run build 成功

### 阶段 8: Git 提交（预计 0.5h）

- [ ] T8.1 git add 新增/修改文件
- [ ] T8.2 git commit -m "Cycle 11 P3-1: /import 跨平台配置迁移"

---

## 任务依赖图

```
T1.1 → T1.2 → T1.3 → T1.4 → T1.5
                              ↓
                            T1.6 (核心服务)
                              ↓
                            T2.1 (API)
                              ↓
                            T2.2 (路由)
                              ↓
                            T3.1 (单元测试)
                              ↓
                            T4.1 (E2E 测试)
                              ↓
                            T5.x (前端)
                              ↓
                            T6.x (文档)
                              ↓
                            T7.x (浏览器测试)
                              ↓
                            T8.x (Git)
```

---

## 执行工时

| 阶段 | 任务 | 预估 | 实际 |
|------|------|------|------|
| 1 | 核心服务 | 4-6h | |
| 2 | REST API | 1-2h | |
| 3 | 单元测试 | 2-3h | |
| 4 | E2E 测试 | 1-2h | |
| 5 | 前端 UI | 3-4h | |
| 6 | 文档 | 1h | |
| 7 | 浏览器测试 | 1h | |
| 8 | Git | 0.5h | |
| **总计** | - | **13-19.5h** | |

---

## 验收门

每个阶段完成后必须通过：
- ✅ 类型检查（TypeScript / mypy）
- ✅ 单元测试（pytest）
- ✅ E2E 测试（bash）
- ✅ 浏览器端手动测试
- ✅ 代码评审

