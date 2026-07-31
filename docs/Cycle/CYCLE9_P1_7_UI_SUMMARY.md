# Cycle 9 P1-7 DiffView 增强 — 前端 UI 集成总结

## 概述

在 Cycle 9 P1-7 阶段，继后端 DiffView 服务（[CYCLE9_P1_7_SUMMARY.md](CYCLE9_P1_7_SUMMARY.md)）完成后，前端完成完整的 UI 集成，实现企业级 DiffView 体验，与 Codex v0.140+ / TRAE Solo v3.5+ 的视觉与交互规范对齐。

**目标**：将后端 11 个 DiffView API 端点无缝对接前端，提供直观、高效的多格式 diff 查看、快照管理、ref 对比、暂存控制等交互能力。

## 交付物

| 文件 | 行数 | 角色 | 版本 |
|---|---|---|---|
| `frontend/src/components/DiffView.tsx` | 1170 | 主 DiffView 组件（多格式 + 快照 + ref 对比） | v2.0.0 |
| `frontend/src/pages/DiffViewPage.tsx` | 75 | 独立访问页面（支持 ?project= 参数） | v1.0.0 |
| `frontend/src/hooks/useDiffViewApi.ts` | 320 | 前端 API Hook（11 个端点封装） | v1.0.0 |
| `frontend/src/router/router.tsx` | +3 | 路由配置（/diff-view 懒加载） | v1.0.0 |
| `frontend/src/components/BrandHeader.tsx` | +18 | 菜单项（📋 DiffView 增强入口） | v2.0.0 |
| `frontend/src/components/AppLayout.tsx` | +6 | onOpenDiffView prop 透传 | v6.17.0 |
| `frontend/src/App.tsx` | +20 | handleOpenDiffView 路由跳转 | v6.17.0 |
| `backend/app/main.py` | +75 | SPA 路由兜底（解决 /diff-view 404） | v6.8.0 |

## 核心 UI 能力

### 1. 项目路径配置

- **多源解析**：`prop > localStorage > 用户输入`，三级 fallback
- **持久化**：输入路径后自动写入 `localStorage('diffview.projectPath')`
- **可编辑**：顶部输入框允许直接修改（带目录图标 📁 + 修改按钮）
- **空状态**：未输入时显示"请先选择项目目录"提示

### 2. 多格式 diff 切换（4 种）

| 格式 | 图标 | 渲染效果 |
|---|---|---|
| Unified | ≡ 统一 | 标准 unified diff 文本，带 + / - / context 行内着色 |
| Side-by-Side | ⫴ 并排 | 双列布局，左原文件/右新文件，同步滚动 |
| JSON Patch | { } JSON | RFC 6902 风格结构化输出，带语法高亮 |
| Stats | Σ 统计 | 精简统计视图（仅文件数/新增/删除行数） |

- **切换无刷新**：纯前端状态切换，立即重新拉取对应格式数据
- **视觉反馈**：当前选中格式按钮高亮 + 背景色变化

### 3. 暂存控制面板

| 按钮 | 行为 | 状态 |
|---|---|---|
| 未暂存 / 已暂存 | 切换 `staged` 标志，重新加载数据 | 互斥按钮组 |
| ⬆ 全部暂存 | 调用 `/api/diff-view/stage-all` | 顶部工具栏 |
| ⬆ Stage（单文件） | 调用 `/api/diff-view/stage` | 文件行右侧 |
| ↶ 回退 | 调用 `git checkout -- <path>` | 文件行右侧 |

### 4. 完整快照管理 UI

**入口**：顶部工具栏 "📸 快照" 按钮 → 弹出模态面板

**面板布局**：
- 顶部：`+ 新建` 按钮 + `✕` 关闭按钮
- 列表区：每个快照卡片显示
  - 标签（label） + 短哈希（8 字符）
  - 创建时间（ISO 8601 格式）
  - 文件数 + 总大小
  - `恢复` + `删除` 按钮

**创建表单**：
- 标签输入（可选）
- 描述输入（可选）
- `创建快照` / `取消` 按钮

**操作反馈**：
- 成功：toast 提示
- 失败：toast 红色错误提示
- 列表自动刷新

### 5. Ref 对比对话框

**入口**：顶部工具栏 "⇄ Ref 对比" 按钮 → 弹出模态对话框

**对话框组件**：
- Base Ref 输入框（默认 `HEAD~1`，支持 commit hash / branch / tag）
- Target Ref 输入框（默认 `HEAD`）
- 输出格式选择（统一/并排/JSON/统计）
- `开始对比` / `取消` 按钮

**对比结果**：
- 头部标识切换为"代码变更 (ref 对比: HEAD~1 → HEAD)"
- 顶部出现"返回"按钮，跳回工作区 diff 视图
- 统计信息同步更新（变更文件数/新增/删除行数）

### 6. 文件展开/收起

- **可点击文件名**：点击展开该文件的 diff 详情
- **可点击状态徽章**：M 修改(1) / U 未跟踪(1) 等可点击过滤
- **可点击路径过滤输入框**：实时过滤文件列表
- **展开后操作**：显示 `Stage` / `回退` 按钮 + diff 详情

### 7. 视觉与可达性

- **暗色主题**：与 Hermes 平台统一（surface-50/100/300/500 渐变）
- **图标语言**：使用 Unicode 符号（📁/📸/⬆/↶/⇄）替代图标字体
- **响应式**：flex-wrap 工具栏，窄屏自动换行
- **键盘可达**：所有按钮支持 Tab 聚焦 + Enter 触发

## 状态管理设计

### 组件级状态（DiffView.tsx）

```typescript
// 数据状态
const [data, setData] = useState<WorkspaceDiffResponse['data'] | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

// 用户配置
const [projectPath, setProjectPath] = useState<string>(loadInitialProjectPath);
const [format, setFormat] = useState<DiffFormatName>('unified');
const [staged, setStaged] = useState(false);
const [pathFilter, setPathFilter] = useState('');
const [statusFilter, setStatusFilter] = useState<DiffStatus[] | null>(null);

// 展开/折叠
const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

// 模态面板
const [snapshotPanelOpen, setSnapshotPanelOpen] = useState(false);
const [refCompareOpen, setRefCompareOpen] = useState(false);

// 反馈
const [toast, setToast] = useState<ToastMessage | null>(null);
```

### 数据流

```
用户操作 → setState → useEffect 监听 → useDiffViewApi 调用 → 后端 API
                                                      ↓
                                                  setData 更新
                                                      ↓
                                                  组件重新渲染
```

## TypeScript 类型系统

### API 响应类型

```typescript
export type DiffFormatName = 'unified' | 'side_by_side' | 'json_patch' | 'stats';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'meta';
  content: string;
  old_line_no: number | null;
  new_line_no: number | null;
  tag: string;
}

export interface FileDiffData {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  additions: number;
  deletions: number;
  old_path: string | null;
  is_staged: boolean;
  patch_unified: string;
  lines: DiffLine[];
  side_by_side: SideBySideData;
  json_patch: JsonPatchOp[];
  error: string | null;
}

export interface WorkspaceDiffResponse {
  success: boolean;
  action: string;
  data: {
    project_path: string;
    format: DiffFormatName;
    is_staged: boolean;
    files: FileDiffData[];
    stats: DiffStats;
  };
}
```

## SPA 路由集成

### 路由配置（router.tsx）

```typescript
const DiffViewPage = lazy(() => import('../pages/DiffViewPage'));
// ...
<Route path="diff-view" element={lazyPage(DiffViewPage)} />
```

### 后端 SPA 兜底（main.py v6.8.0）

FastAPI 增加了通用 SPA 路由处理：

```python
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_catch_all(full_path: str):
    # 1. 排除 API 与 WebSocket
    if full_path.startswith("api/") or full_path.startswith("ws/"):
        raise HTTPException(status_code=404, detail="Not Found")
    # 2. 安全检查：拒绝路径遍历
    if ".." in full_path.split("/"):
        raise HTTPException(status_code=400, detail="Invalid path")
    # 3. 尝试读取静态文件
    target = frontend_dist / full_path
    if target.is_file():
        return FileResponse(str(target))
    # 4. 文件不存在：返回 index.html（前端 React Router 处理）
    if _index_html_content:
        return HTMLResponse(content=_index_html_content, media_type="text/html")
    raise HTTPException(status_code=404, detail="Frontend index.html not found")
```

**解决的问题**：访问 `/diff-view` 等前端路由时，后端不返回 404，而是返回 `index.html`，由前端 React Router 接管。

## 验证清单

### 类型检查
- [x] TypeScript `--noEmit` 检查 100% 通过（0 errors）
- [x] 前端生产构建 `npm run build` 成功
- [x] DiffViewPage bundle: 37 kB（gzip 9.63 kB）

### 单元与 E2E 测试
- [x] 71 个单元测试 100% 通过
- [x] 90 个 E2E 断言 100% 通过

### 浏览器端实测（已完成）
- [x] `/diff-view?project=/tmp/diffview-ui-test` 页面正常加载
- [x] 项目路径输入 / localStorage 持久化
- [x] 4 种格式切换（统一/并排/JSON/统计）
- [x] 文件展开 / Stage / 回退按钮
- [x] 暂存切换（未暂存/已暂存）
- [x] 全部暂存操作
- [x] 路径过滤
- [x] 状态徽章过滤（M 修改/U 未跟踪）
- [x] 快照面板（创建/列表/恢复/删除）
- [x] Ref 对比对话框（HEAD~1/HEAD + 无差异空状态）
- [x] 返回工作区按钮

### API 集成
- [x] `POST /api/diff-view/workspace` 工作区 diff
- [x] `POST /api/diff-view/compare` 任意 ref 对比
- [x] `GET/POST /api/diff-view/snapshots` 快照管理
- [x] `POST /api/diff-view/snapshots/{id}/restore` 恢复快照
- [x] `DELETE /api/diff-view/snapshots/{id}` 删除快照
- [x] `POST /api/diff-view/stage/unstage/stage-all` 暂存控制
- [x] `GET /api/diff-view/health` 健康检查
- [x] `GET /api/diff-view/formats` 格式列表

## 设计亮点

1. **零外部依赖**：仅使用 React Hooks + fetch API，无新增 npm 包
2. **代码分割**：`DiffViewPage` 通过 `React.lazy` 懒加载，首屏不引入
3. **类型安全**：完整的 TypeScript 接口，与后端 Pydantic schema 一一对应
4. **可访问性**：所有交互元素支持键盘导航 + 屏幕阅读器
5. **错误隔离**：每个 API 调用 try/catch，toast 友好提示
6. **持久化**：用户输入的 projectPath 写入 localStorage，刷新不丢失
7. **响应式**：flex-wrap 工具栏，移动端友好

## 截图证据

### 1. 初始加载（side_by_side 模式）
- 显示 M 修改(1) + U 未跟踪(1) 文件分类
- 2 变更文件 / +2 新增行 / -0 删除行 统计
- a.py 已展开，显示并排视图
- Stage / 回退按钮可用

### 2. JSON Patch 格式
- 6 变更文件 / +23 新增行
- a.py diff 显示结构化 JSON：
  ```json
  {
    "op": "add",
    "line": 2,
    "content": "modified"
  }
  ```
- 语法高亮渲染

### 3. 快照管理面板
- 标签 "UI测试快照" + 短哈希 (beecd548)
- 时间戳 2026-07-28 10:54:50
- 2 文件 + 32 B 大小
- 恢复 / 删除按钮

### 4. Ref 对比结果
- 标题改为"代码变更 (ref 对比: HEAD~1 → HEAD)"
- 返回按钮出现在工具栏
- 无差异空状态："两个 ref 之间无差异" + "请尝试其他 ref"

## 下一步

- **Phase 5 UI/UX 优化**：基于 Codex v0.140+ / TRAE Solo v3.5+ 视觉规范继续打磨
- **P1-7 后续迭代**：行级评论 / 提交信息关联 / blame 集成 / 文件树联动
- **Phase 6**：loop engineering 工作流端到端验证（含 DiffView 审查节点）
- **Phase 7**：循环重启准备

## 文件清单

- `frontend/src/components/DiffView.tsx` — 主组件（v2.0.0）
- `frontend/src/pages/DiffViewPage.tsx` — 独立访问页面（v1.0.0）
- `frontend/src/hooks/useDiffViewApi.ts` — API Hook（v1.0.0）
- `frontend/src/router/router.tsx` — 路由配置（v1.0.0）
- `frontend/src/components/BrandHeader.tsx` — 菜单项（v2.0.0）
- `frontend/src/components/AppLayout.tsx` — 透传（v6.17.0）
- `frontend/src/App.tsx` — 路由跳转（v6.17.0）
- `backend/app/main.py` — SPA 兜底（v6.8.0）
- `CYCLE9_P1_7_SUMMARY.md` — 后端总结（已存在）
- `CYCLE9_P1_7_UI_SUMMARY.md` — 本文档（前端 UI 总结）
- `代码修改日志.md` — 项目变更记录（待追加 P1-7 UI 章节）
