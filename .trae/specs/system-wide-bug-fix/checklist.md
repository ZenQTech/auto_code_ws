# Checklist

## 前端编译
- [x] `tsc -b` 编译零错误，无类型缺失（`StageDetail`/`LoopWorkflowStatus` 在 `types/index.ts` 已定义）

## 前端功能
- [x] SSE 流式请求可通过 AbortController 取消（`useApi.ts:270` 含 `signal?: AbortSignal`）
- [x] React ErrorBoundary 包裹根组件，异常时显示回退 UI（`ErrorBoundary.tsx` 存在）
- [x] 配额面板从 API 获取上限，无硬编码 10000（`App.tsx:117` `useQuota` 动态获取）
- [x] 归档按钮调用后端 API 更新会话状态
- [x] 消息工具栏按钮（重新生成/点赞/踩/朗读）实现真实逻辑
- [x] 复制到剪贴板成功后显示 Toast 提示
- [x] FileExplorer 错误提示使用 Toast 而非 alert()

## 前端代码质量
- [x] `renderMarkdown` 提取为共享工具函数（`utils/markdown.ts`）
- [x] `formatRelativeTime` 提取为共享工具函数（`utils/time.ts`）
- [x] `getFileIcon` / `FILE_ICONS` 提取为共享工具函数（`utils/fileIcon.ts`）
- [x] `severityColorMap` 提取为共享工具函数（`utils/severity.ts`）
- [x] `ThinkingBlock` 统一为独立组件实现
- [x] `index.css` 中无重复 `@keyframes` 定义

## 后端代码质量
- [ ] 全局无 `datetime.utcnow()` 调用（agent_manager.py 仍有 5 处需修）
- [x] 全局无 `asyncio.ensure_future()` 调用
- [x] `AgentManager._agents` 访问受 `asyncio.Lock` 保护
- [x] `HermesMemoryManager` 文件 I/O 使用 `asyncio.to_thread` 异步操作
- [x] 全局无 `except Exception: pass` 裸异常吞没

## 后端 datetime Python 3.10 兼容性
- [ ] 全局无 `datetime.now(datetime.UTC)` 调用（Python 3.10 不兼容，**严重 bug**）
  - 目标文件：`backend/app/api/workflow.py` (3 处)、`backend/app/error_handler.py` (1 处)、`backend/app/services/workflow_engine.py` (1 处)
  - 正确替换：`datetime.now(timezone.utc)` + `from datetime import timezone`

## 后端 /health 端点
- [ ] `GET /health` 返回 200 + `{"status":"ok",...}`（当前被 StaticFiles mount 拦截返回 404）
  - 修复：将 `app.mount("/", StaticFiles(...))` 移到所有显式路由之后

## 后端安全
- [x] 配置文件中无硬编码 API Token（已用 `${ANTHROPIC_AUTH_TOKEN}` 占位符）
- [x] API Token 从环境变量读取

## 回归测试
- [ ] 后端启动无 `AttributeError: type object 'datetime.datetime' has no attribute 'UTC'`
- [ ] `curl /health` 返回 200
- [ ] `POST /api/workflow/start` 不再 500
- [ ] `POST /api/architecture/design` 不再 500

## 验收刚性标准
> 判定本 spec 完成必须同时满足：
> 1. 后端进程能成功启动且无 `datetime.UTC` AttributeError
> 2. `GET /health` 返回 200
> 3. `POST /api/workflow/start` 与 `POST /api/architecture/design` 不再返回 500
> 4. 证据文件落 `data/runtime_test_evidence/api_responses_after_bug_fix/`

# 更新记录
- 2026-06-26: Task 1-6、8-10 标记为 [x]（代码已实现，online-runtime-testing 验证）。Task 7/11/12 仍未完成。
